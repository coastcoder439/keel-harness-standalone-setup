#!/usr/bin/env node

// Finite Git operation surface. Agents choose an intent, never a raw mutating
// Git command. Every mutation is bound to one session leaf and emits a receipt.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readExecutionReceipt, validateImmutableRecord } from "../execution/execution-receipts.mjs";
import { findOwnerOk, formatOwnerOkLine, todayLocal, validateOwnerOk } from "../execution/owner-ok.mjs";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const repository = require("../binding/repository.cjs");
const packageBinding = require("../binding/package-binding.cjs");
const ownerContract = require("../binding/owner-contract.cjs");
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;

// ONE resolver for the Unlazy tree, shared by the gate parser below and by the
// gate RUNNER in package-executor.mjs (it imports locateUnlazy from here). Two
// resolvers meant an explicit --unlazy-root could hand the tolerance decision to
// a different parser than the one that executed the gates; the shared candidate
// list and the shared boundary below remove that second answer.
// The boundary is a realpath containment test, not a string prefix: an explicit
// root is accepted only when its own scripts/ files really live under the
// addressed repository's vendor/unlazy or under the Harness tree that ships
// next to this file. Proven by "the gate parser resolves from the Unlazy tree
// the caller runs, lazily and inside the bound trees" in test/git-intent.test.js,
// which drives both shipped layouts.
const harnessTree = path.resolve(here, "..", "..");

function unlazyBases(repoRoot) {
  const root = repoRoot ? path.resolve(repoRoot) : null;
  const bases = [path.join(harnessTree, "vendor", "unlazy")];
  if (root) bases.push(path.join(root, "vendor", "unlazy"));
  // The source layout keeps the Harness tree as a SUBDIRECTORY of the repository
  // that vendors Unlazy at its own root, so the directory ABOVE the Harness tree
  // is a base there. The standalone layout ships harness-core/ and vendor/ as
  // siblings AT the repository root, where that same directory sits outside the
  // repository -- so it is a base only while the Harness tree is not itself the
  // addressed repository root. Measured 02.09.2026 in the standalone-shaped
  // fixture of the test above: without this condition locateUnlazy accepted a
  // vendor/unlazy copy one level above the repository.
  if (!root || !repository.samePath(harnessTree, root)) {
    bases.push(path.join(path.dirname(harnessTree), "vendor", "unlazy"));
  }
  return [...new Set(bases)];
}

function insideAnyBase(bases, candidate) {
  for (const base of bases) {
    let resolvedBase = path.resolve(base);
    try { resolvedBase = fs.realpathSync(resolvedBase); } catch { /* absent base cannot contain anything */ }
    const relative = path.relative(resolvedBase, candidate);
    if (relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)) return true;
  }
  return false;
}

// The single existence probe for an Unlazy tree: the parser this module needs
// and the two runner entry points package-executor.mjs spawns.
const UNLAZY_MARKERS = [
  ["scripts", "lib", "gates.mjs"],
  ["scripts", "package-cli.mjs"],
  ["scripts", "gate-check.mjs"],
];

export function unlazyRootCandidates(repoRoot, explicit) {
  // An explicit root is the ONLY candidate: silently falling back to another
  // vendored tree would let a different parser decide the tolerance than the one
  // that executed the gates, which is the whole reason this is bound at all.
  return explicit ? [path.resolve(explicit)] : unlazyBases(repoRoot);
}

export function locateUnlazy(repoRoot, explicit) {
  const bases = unlazyBases(repoRoot);
  const found = [...new Set(unlazyRootCandidates(repoRoot, explicit)
    .filter((root) => UNLAZY_MARKERS.every((marker) => fs.existsSync(path.join(root, ...marker))))
    .map((root) => fs.realpathSync(root)))];
  // Without an explicit root, two differing vendored trees are an ambiguity to
  // refuse rather than to resolve by candidate order.
  if (found.length !== 1) {
    fail("GATE_PARSER", "expected exactly one canonical Unlazy runtime; found " + found.length);
  }
  const resolved = found[0];
  if (!insideAnyBase(bases, fs.realpathSync(path.join(resolved, ...UNLAZY_MARKERS[0])))) {
    fail("GATE_PARSER", "Unlazy runtime is outside the repository vendor tree and the Harness tree: " + resolved);
  }
  return resolved;
}

// The close writeback tolerance below reads ledgers with the SAME parser
// gate-check runs, never with a private regex scan: a hand-written scan
// honours declarations the gate runner ignores. Measured 02.09.2026 on a
// ledger carrying a fenced example block before its first gate -- the vendored
// parser returned one CHECK and owns=["src/beta/**"], the regex scan two CHECKs
// and a second OWNS glob that turned every evidence/ file into a free-byte
// window during close.
// It loads LAZILY: a top-level await import made an unusual vendor location
// break every package-executor command at all, since package-executor.mjs
// imports this module statically.
const gateParsers = new Map();

export function gateParserCandidates(repoRoot, explicit) {
  return unlazyRootCandidates(repoRoot, explicit).map((root) => path.join(root, "scripts", "lib", "gates.mjs"));
}

export async function loadGateParser(repoRoot, explicit) {
  const resolved = fs.realpathSync(path.join(locateUnlazy(repoRoot, explicit), "scripts", "lib", "gates.mjs"));
  if (!gateParsers.has(resolved)) {
    const module = await import(pathToFileURL(resolved).href);
    if (typeof module.parseGates !== "function") fail("GATE_PARSER", "Unlazy gate parser exports no parseGates");
    gateParsers.set(resolved, module.parseGates);
  }
  return gateParsers.get(resolved);
}

function fail(code, message, exitCode = 2) {
  const error = new Error(message);
  error.code = code;
  error.exitCode = exitCode;
  throw error;
}

function cleanGitEnv(extra = {}) {
  const env = { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0", ...extra };
  for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY"]) {
    delete env[name];
  }
  return env;
}

function git(repoRoot, args, options = {}) {
  const result = spawnSync(options.gitExecutable || "git", ["-C", repoRoot, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    windowsHide: true,
    timeout: options.timeoutMs || 30_000,
    env: cleanGitEnv(options.env),
  });
  if (result.error) fail("GIT_EXECUTION_FAILED", result.error.message);
  return result;
}

function gitBytes(repoRoot, args, options = {}) {
  const result = spawnSync(options.gitExecutable || "git", ["-C", repoRoot, ...args], {
    cwd: repoRoot,
    encoding: null,
    windowsHide: true,
    timeout: options.timeoutMs || 30_000,
    env: cleanGitEnv(options.env),
  });
  if (result.error) fail("GIT_EXECUTION_FAILED", result.error.message);
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || "").trim().split(/\r?\n/u)[0] || "exit " + result.status;
    fail(options.failCode || "GIT_ACCEPTED_RESULT_STAGE_FAILED", detail, 1);
  }
  return result.stdout || Buffer.alloc(0);
}

function parseArgs(argv) {
  const values = { paths: [], writebackReceipts: [] };
  const args = [...argv];
  values.intent = args.shift() || "";
  while (args.length) {
    const option = args.shift();
    if (option === "--root") values.root = args.shift();
    else if (option === "--session") values.sessionId = args.shift();
    else if (option === "--package") values.packageId = args.shift();
    else if (option === "--scope") values.scope = args.shift();
    else if (option === "--message") values.message = args.shift();
    else if (option === "--expected-result-file") values.expectedResultFile = args.shift();
    else if (option === "--expected-result-digest") values.expectedResultDigest = args.shift();
    else if (option === "--path") values.paths.push(args.shift());
    else if (option === "--operation") values.operation = args.shift();
    else if (option === "--receipt") values.receipt = args.shift();
    else if (option === "--owner-ok") values.ownerOk = args.shift();
    else if (option === "--unlazy-root") values.unlazyRoot = args.shift();
    else if (option === "--writeback-receipt") values.writebackReceipts.push(args.shift());
    else if (option === "--json") values.json = true;
    else fail("USAGE", "unknown option " + option);
  }
  return values;
}

function exactBinding(options) {
  if (!options.sessionId) fail("USAGE", "--session is required");
  const root = options.root || process.cwd();
  return packageBinding.findSessionBinding(root, String(options.sessionId));
}

function authorizedPaths(binding, requested) {
  if (!requested.length) fail("USAGE", "at least one --path is required");
  const unique = [];
  const seen = new Set();
  for (const candidate of requested) {
    if (!candidate) fail("USAGE", "--path requires a value");
    const absolute = path.resolve(binding.repoRoot, candidate);
    const decision = packageBinding.authorizeWrite(binding, absolute);
    if (!decision.allowed) fail(decision.code, decision.next + ": " + (decision.relative || candidate));
    const key = process.platform === "win32" ? decision.relative.toLowerCase() : decision.relative;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(decision.relative);
    }
  }
  unique.sort((left, right) => left.localeCompare(right, "en"));
  return unique;
}

function commandResult(result, operation) {
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || "").trim().split(/\r?\n/u)[0] || "exit " + result.status;
    fail("GIT_" + operation.toUpperCase() + "_FAILED", detail, 1);
  }
  return String(result.stdout || "");
}

function writeReceipt(binding, receipt) {
  const directory = path.join(binding.repoRoot, ".unlazy", binding.scope, "git", "receipts");
  fs.mkdirSync(directory, { recursive: true });
  const id = (receipt.commit || receipt.operation + "-" + (receipt.head || "unborn")) + "-" +
    Date.now() + "-" + randomBytes(4).toString("hex");
  const file = path.join(directory, id.replace(/[^a-f0-9._-]/giu, "_") + ".json");
  const temporary = file + "." + process.pid + ".tmp";
  fs.writeFileSync(temporary, JSON.stringify({ schemaVersion: 1, packageId: binding.packageId,
    scope: binding.scope, sessionId: binding.sessionId, leaf: binding.leaf, ...receipt }, null, 2) + "\n",
  { encoding: "utf8", flag: "wx" });
  fs.renameSync(temporary, file);
  return path.relative(binding.repoRoot, file).replaceAll("\\", "/");
}

function receiptRecord(binding, receiptPath, expectedOperation) {
  if (!receiptPath) fail("USAGE", "--receipt is required");
  const directory = path.join(binding.repoRoot, ".unlazy", binding.scope, "git", "receipts");
  const file = path.resolve(binding.repoRoot, receiptPath);
  if (!repository.isPathInside(directory, file)) fail("RECEIPT_SCOPE", "receipt must be inside the bound scope receipt directory");
  if (!fs.existsSync(file)) fail("RECEIPT_MISSING", "receipt does not exist");
  const info = fs.lstatSync(file);
  if (info.isSymbolicLink() || !info.isFile() || (typeof info.nlink === "number" && info.nlink !== 1)) {
    fail("RECEIPT_FILE", "receipt must be a single-link regular file");
  }
  let value;
  try { value = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { fail("RECEIPT_JSON", "receipt is not valid JSON"); }
  if (!value || value.schemaVersion !== 1 || value.packageId !== binding.packageId || value.scope !== binding.scope ||
      value.sessionId !== binding.sessionId || value.leaf !== binding.leaf || value.operation !== expectedOperation) {
    fail("RECEIPT_IDENTITY", "receipt does not belong to this exact package/session/leaf operation");
  }
  return { file, value };
}

function globalReceiptDirectory(repoRoot) {
  return path.join(repoRoot, ".unlazy", ".global-receipts");
}

function writeGlobalReceipt(repoRoot, receipt) {
  const directory = globalReceiptDirectory(repoRoot);
  fs.mkdirSync(directory, { recursive: true });
  const id = receipt.operation + "-" + Date.now() + "-" + randomBytes(8).toString("hex") + ".json";
  const file = path.join(directory, id);
  atomicJson(file, { schemaVersion: 1, repoRoot, ...receipt });
  return path.relative(repoRoot, file).replaceAll("\\", "/");
}

function globalReceiptRecord(repoRoot, receiptPath, expectedOperation) {
  if (!receiptPath) fail("USAGE", "--receipt is required");
  const directory = globalReceiptDirectory(repoRoot);
  const file = path.resolve(repoRoot, receiptPath);
  if (!repository.isPathInside(directory, file)) fail("RECEIPT_SCOPE", "receipt must be inside the repository global receipt directory");
  if (!fs.existsSync(file)) fail("RECEIPT_MISSING", "receipt does not exist");
  const info = fs.lstatSync(file);
  if (info.isSymbolicLink() || !info.isFile() || (typeof info.nlink === "number" && info.nlink !== 1)) {
    fail("RECEIPT_FILE", "receipt must be a single-link regular file");
  }
  let value;
  try { value = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { fail("RECEIPT_JSON", "receipt is not valid JSON"); }
  if (!value || value.schemaVersion !== 1 || value.operation !== expectedOperation ||
      !repository.samePath(value.repoRoot, repoRoot)) {
    fail("RECEIPT_IDENTITY", "global receipt does not belong to this repository and operation");
  }
  return { file, value };
}

function sha256(bytes) {
  return "sha256:" + createHash("sha256").update(bytes).digest("hex");
}

function parseZeroList(value) {
  return String(value || "").split("\0").filter(Boolean).map((item) => item.replaceAll("\\", "/"));
}

function currentHead(binding) {
  return commandResult(git(binding.repoRoot, ["rev-parse", "--verify", "HEAD"]), "head").trim();
}

function identifier(value, label) {
  const text = String(value || "");
  if (!IDENTIFIER.test(text)) fail("USAGE", label + " must match " + IDENTIFIER);
  return text;
}

function atomicJson(file, value) {
  const temporary = file + "." + process.pid + "." + randomBytes(8).toString("hex") + ".tmp";
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
  try { fs.renameSync(temporary, file); }
  finally { try { fs.unlinkSync(temporary); } catch { /* renamed or absent */ } }
}

function inspect(options) {
  const binding = exactBinding(options);
  const paths = options.paths.length ? authorizedPaths(binding, options.paths) : binding.owns;
  const status = commandResult(git(binding.repoRoot, ["status", "--porcelain=v2", "--branch", "--", ...paths]), "inspect");
  return { operation: "inspect", packageId: binding.packageId, scope: binding.scope,
    leaf: binding.leaf, head: binding.headOid, paths, status: status.split(/\r?\n/u).filter(Boolean) };
}

function unstage(options) {
  const binding = exactBinding(options);
  const paths = authorizedPaths(binding, options.paths);
  let result = git(binding.repoRoot, ["restore", "--staged", "--", ...paths]);
  if (result.status !== 0 && binding.headOid === null) {
    result = git(binding.repoRoot, ["rm", "--cached", "-r", "--ignore-unmatch", "--", ...paths]);
  }
  commandResult(result, "unstage");
  const receiptPath = writeReceipt(binding, { operation: "unstage", head: binding.headOid || "unborn", paths });
  return { operation: "unstage", paths, receipt: receiptPath };
}

// Contract sentence (CLAUDE.md/AGENTS.md, skill package-execution): "Leaf-Agenten committen
// nicht mitten in einer parallelen Welle; der Parent integriert alle verifizierten disjunkten
// Pfade einmal." Until 07.09.2026 no code enforced it (completeness audit 06.09.2026, H7).
// The dispatch state of the bound scope is the durable wave truth: a leaf listed in a wave
// that is still open or sealed may not checkpoint. Unreadable state fails closed. Measured by
// "checkpoint is refused while the bound leaf is inside an open or sealed dispatch wave".
function waveInProgressFor(binding) {
  const file = path.join(binding.repoRoot, ".unlazy", binding.scope, "dispatch.json");
  if (!fs.existsSync(file)) return null;
  let state;
  try {
    if (fs.lstatSync(file).isSymbolicLink()) throw new Error("dispatch state is a symbolic link");
    state = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    fail("WAVE_STATE_UNREADABLE", "checkpoint refused: dispatch state of scope " + binding.scope +
      " is unreadable (" + error.message + "); repair .unlazy/" + binding.scope + "/dispatch.json before committing");
  }
  const waves = state && typeof state === "object" && state.waves && typeof state.waves === "object" ? state.waves : {};
  for (const [waveId, wave] of Object.entries(waves)) {
    if (!wave || typeof wave !== "object") continue;
    if (wave.state !== "open" && wave.state !== "sealed") continue;
    if (!Array.isArray(wave.leaves) || !wave.leaves.includes(binding.leaf)) continue;
    return { waveId, state: wave.state };
  }
  return null;
}

function assertLeafOutsideWave(binding) {
  const wave = waveInProgressFor(binding);
  if (!wave) return;
  fail("WAVE_IN_PROGRESS", "checkpoint refused: leaf " + binding.leaf + " is part of wave " + wave.waveId +
    " (" + wave.state + "); leaf agents do not commit mid-wave -- return to the parent, which integrates every verified disjoint path once", 1);
}

function checkpoint(options) {
  const binding = exactBinding(options);
  assertLeafOutsideWave(binding);
  const paths = authorizedPaths(binding, options.paths);
  const message = String(options.message || "").trim();
  if (!message || message.length > 200 || /[\r\n\0]/u.test(message)) fail("USAGE", "--message must be one line of 1..200 characters");

  const staged = commandResult(git(binding.repoRoot, ["diff", "--cached", "--name-only", "-z"]), "preflight");
  if (staged.length) fail("SHARED_INDEX_DIRTY", "checkpoint refused: Git index already contains staged paths; run the unstage intent for their owning session");
  const changed = commandResult(git(binding.repoRoot, ["status", "--porcelain=v1", "-z", "--", ...paths]), "preflight");
  if (!changed.length) fail("NOTHING_TO_CHECKPOINT", "none of the bound paths changed", 1);

  commandResult(git(binding.repoRoot, ["add", "--", ...paths]), "stage");
  const stagedTarget = git(binding.repoRoot, ["diff", "--cached", "--quiet", "--", ...paths]);
  if (stagedTarget.status === 0) {
    git(binding.repoRoot, ["reset", "--", ...paths]);
    fail("NOTHING_TO_CHECKPOINT", "bound paths produced no staged change", 1);
  }
  if (stagedTarget.status !== 1) {
    git(binding.repoRoot, ["reset", "--", ...paths]);
    fail("GIT_STAGE_FAILED", String(stagedTarget.stderr || "cannot inspect staged paths"));
  }
  const committedPaths = parseZeroList(commandResult(git(binding.repoRoot,
    ["diff", "--cached", "--name-only", "-z", "--", ...paths]), "checkpoint-paths"));
  if (!committedPaths.length) {
    git(binding.repoRoot, ["reset", "--", ...paths]);
    fail("GIT_COMMIT_FAILED", "checkpoint contains no paths");
  }
  authorizedPaths(binding, committedPaths);

  const before = binding.headOid;
  const committed = git(binding.repoRoot, ["commit", "-m", message, "--", ...paths], { timeoutMs: 120_000 });
  if (committed.status !== 0) {
    git(binding.repoRoot, ["reset", "--", ...paths]);
    commandResult(committed, "commit");
  }
  const after = commandResult(git(binding.repoRoot, ["rev-parse", "--verify", "HEAD"]), "head").trim();
  if (!after || after === before) fail("GIT_COMMIT_FAILED", "checkpoint did not advance HEAD");
  const refreshed = packageBinding.createBinding({ root: binding.repoRoot, packageId: binding.packageId,
    scope: binding.scope, sessionId: binding.sessionId, leaf: binding.leaf,
    controlRoot: binding.controlRoot || undefined });
  const receiptPath = writeReceipt(refreshed, { operation: "checkpoint", headBefore: before,
    head: after, commit: after, message, paths: committedPaths });
  return { operation: "checkpoint", commit: after, paths: committedPaths, receipt: receiptPath };
}

function changedPathKind(binding, relative) {
  const absolute = path.join(binding.repoRoot, relative);
  if (fs.existsSync(absolute)) {
    const info = fs.lstatSync(absolute);
    if (info.isSymbolicLink() || !info.isFile()) fail("UNDO_FILE", "discard-working accepts exact regular files only: " + relative);
  }
  const tracked = git(binding.repoRoot, ["ls-files", "--error-unmatch", "--", relative]).status === 0;
  if (!tracked && !fs.existsSync(absolute)) fail("NOTHING_TO_DISCARD", "path is neither tracked nor present: " + relative, 1);
  return { absolute, relative, tracked, existed: fs.existsSync(absolute) };
}

function backupForDiscard(binding, records) {
  const id = Date.now() + "-" + randomBytes(8).toString("hex");
  const directory = path.join(binding.repoRoot, ".unlazy", binding.scope, "git", "recovery", id);
  const files = path.join(directory, "files");
  fs.mkdirSync(files, { recursive: true });
  let total = 0;
  const entries = records.map((record, index) => {
    let backup = null;
    let digest = null;
    let bytes = 0;
    if (record.existed) {
      const value = fs.readFileSync(record.absolute);
      total += value.length;
      if (total > 32 * 1024 * 1024) fail("UNDO_TOO_LARGE", "discard recovery exceeds 32 MiB; split the operation");
      backup = "files/" + String(index).padStart(4, "0") + ".bin";
      fs.writeFileSync(path.join(directory, backup), value, { flag: "wx" });
      digest = sha256(value);
      bytes = value.length;
    }
    return { path: record.relative, tracked: record.tracked, existed: record.existed, backup, digest, bytes };
  });
  const manifest = { schemaVersion: 1, packageId: binding.packageId, scope: binding.scope,
    sessionId: binding.sessionId, leaf: binding.leaf, head: binding.headOid, entries };
  fs.writeFileSync(path.join(directory, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
  return { directory, manifest, relative: path.relative(binding.repoRoot, path.join(directory, "manifest.json")).replaceAll("\\", "/") };
}

function restoreBackup(binding, backup) {
  for (const entry of backup.manifest.entries) {
    const absolute = path.join(binding.repoRoot, entry.path);
    if (!entry.existed) {
      if (fs.existsSync(absolute)) fs.unlinkSync(absolute);
      continue;
    }
    const value = fs.readFileSync(path.join(backup.directory, entry.backup));
    if (sha256(value) !== entry.digest || value.length !== entry.bytes) fail("RECOVERY_CORRUPT", "recovery backup digest mismatch");
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, value);
  }
}

function sealDiscardState(binding, backup) {
  for (const entry of backup.manifest.entries) {
    const absolute = path.join(binding.repoRoot, entry.path);
    entry.postExisted = fs.existsSync(absolute);
    if (entry.postExisted) {
      const info = fs.lstatSync(absolute);
      if (info.isSymbolicLink() || !info.isFile()) fail("UNDO_POSTSTATE", "discard produced a non-file target: " + entry.path);
      const value = fs.readFileSync(absolute);
      entry.postDigest = sha256(value);
      entry.postBytes = value.length;
    } else {
      entry.postDigest = null;
      entry.postBytes = 0;
    }
  }
  fs.writeFileSync(path.join(backup.directory, "manifest.json"), JSON.stringify(backup.manifest, null, 2) + "\n", "utf8");
}

function discardWorking(options) {
  const binding = exactBinding(options);
  const paths = authorizedPaths(binding, options.paths);
  const records = paths.map((relative) => changedPathKind(binding, relative));
  for (const record of records) {
    const staged = git(binding.repoRoot, ["diff", "--cached", "--quiet", "--", record.relative]);
    if (staged.status === 1) fail("STAGED_UNDO_REFUSED", "unstage the path before discard-working: " + record.relative);
    if (staged.status !== 0) commandResult(staged, "undo-preflight");
    const changed = commandResult(git(binding.repoRoot, ["status", "--porcelain=v1", "-z", "--", record.relative]), "undo-preflight");
    if (!changed.length) fail("NOTHING_TO_DISCARD", "path has no working-tree change: " + record.relative, 1);
  }
  const backup = backupForDiscard(binding, records);
  try {
    for (const record of records) {
      if (record.tracked) commandResult(git(binding.repoRoot,
        ["restore", "--source=HEAD", "--worktree", "--", record.relative]), "discard-working");
      else fs.unlinkSync(record.absolute);
    }
  } catch (error) {
    restoreBackup(binding, backup);
    throw error;
  }
  sealDiscardState(binding, backup);
  const receiptPath = writeReceipt(binding, { operation: "discard-working", head: binding.headOid,
    paths, recovery: backup.relative });
  return { operation: "discard-working", paths, recovery: backup.relative, receipt: receiptPath,
    reversible: true };
}

function recoveryRecord(binding, receiptPath) {
  const receipt = receiptRecord(binding, receiptPath, "discard-working").value;
  const manifestFile = path.resolve(binding.repoRoot, receipt.recovery || "");
  const expectedRoot = path.join(binding.repoRoot, ".unlazy", binding.scope, "git", "recovery");
  if (!repository.isPathInside(expectedRoot, manifestFile) || path.basename(manifestFile) !== "manifest.json") {
    fail("RECOVERY_SCOPE", "receipt recovery manifest escapes the bound scope");
  }
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8")); }
  catch { fail("RECOVERY_JSON", "recovery manifest is missing or invalid"); }
  if (!manifest || manifest.schemaVersion !== 1 || manifest.packageId !== binding.packageId ||
      manifest.scope !== binding.scope || manifest.sessionId !== binding.sessionId || manifest.leaf !== binding.leaf ||
      manifest.head !== binding.headOid || !Array.isArray(manifest.entries)) {
    fail("RECOVERY_IDENTITY", "recovery manifest does not match the current binding");
  }
  return { directory: path.dirname(manifestFile), manifest, relative: receipt.recovery };
}

function recoverDiscard(options) {
  const binding = exactBinding(options);
  const backup = recoveryRecord(binding, options.receipt);
  const paths = authorizedPaths(binding, backup.manifest.entries.map((entry) => entry.path));
  for (const entry of backup.manifest.entries) {
    const absolute = path.join(binding.repoRoot, entry.path);
    if (!!fs.existsSync(absolute) !== !!entry.postExisted) {
      fail("RECOVERY_CONFLICT", "path existence changed after discard: " + entry.path, 1);
    }
    if (entry.postExisted) {
      const info = fs.lstatSync(absolute);
      const value = !info.isSymbolicLink() && info.isFile() ? fs.readFileSync(absolute) : null;
      if (!value || value.length !== entry.postBytes || sha256(value) !== entry.postDigest) {
        fail("RECOVERY_CONFLICT", "path changed after discard; recovery refuses overwrite: " + entry.path, 1);
      }
    }
  }
  restoreBackup(binding, backup);
  const receiptPath = writeReceipt(binding, { operation: "recover-discard", head: binding.headOid,
    sourceReceipt: options.receipt, paths });
  return { operation: "recover-discard", paths, receipt: receiptPath };
}

function revertCheckpoint(options) {
  const binding = exactBinding(options);
  const source = receiptRecord(binding, options.receipt, "checkpoint").value;
  if (!source.commit || source.head !== source.commit || binding.headOid !== source.commit || currentHead(binding) !== source.commit) {
    fail("REVERT_NOT_LATEST", "only the current HEAD checkpoint of this exact session/leaf can be reverted", 1);
  }
  const paths = authorizedPaths(binding, source.paths || []);
  const index = git(binding.repoRoot, ["diff", "--cached", "--quiet"]);
  if (index.status === 1) fail("SHARED_INDEX_DIRTY", "revert-checkpoint refused: Git index contains staged paths");
  if (index.status !== 0) commandResult(index, "revert-preflight");
  const changed = commandResult(git(binding.repoRoot, ["status", "--porcelain=v1", "-z", "--", ...paths]), "revert-preflight");
  if (changed.length) fail("REVERT_WORKTREE_DIRTY", "checkpoint paths changed after commit; revert refused", 1);
  const reverted = git(binding.repoRoot, ["revert", "--no-edit", source.commit], { timeoutMs: 120_000 });
  if (reverted.status !== 0) {
    git(binding.repoRoot, ["revert", "--abort"]);
    commandResult(reverted, "revert");
  }
  const after = currentHead(binding);
  const refreshed = packageBinding.createBinding({ root: binding.repoRoot, packageId: binding.packageId,
    scope: binding.scope, sessionId: binding.sessionId, leaf: binding.leaf,
    controlRoot: binding.controlRoot || undefined });
  const receiptPath = writeReceipt(refreshed, { operation: "revert-checkpoint", headBefore: source.commit,
    head: after, commit: after, revertedCommit: source.commit, paths });
  return { operation: "revert-checkpoint", revertedCommit: source.commit, commit: after, paths, receipt: receiptPath };
}

function integrationContext(options) {
  const snapshot = repository.repositorySnapshot(options.root || process.cwd());
  const packageId = identifier(options.packageId, "package");
  const scope = identifier(options.scope || packageId, "scope");
  const refFile = path.join(snapshot.repoRoot, ".unlazy", scope, "package.ref");
  if (!fs.existsSync(refFile) || fs.readFileSync(refFile, "utf8") !== "docs/packages/" + packageId + "\n") {
    fail("INTEGRATION_BINDING", "scope does not bind the requested package");
  }
  const stateFile = path.join(snapshot.repoRoot, ".unlazy", scope, "executor.json");
  let state;
  try { state = JSON.parse(fs.readFileSync(stateFile, "utf8")); }
  catch { fail("INTEGRATION_STATE", "executor state is missing or invalid"); }
  if (!state || state.schemaVersion !== 2 || state.packageId !== packageId || state.scope !== scope ||
      !repository.samePath(state.repoRoot, snapshot.repoRoot) || !repository.samePath(state.gitDir, snapshot.gitDir) ||
      !state.sessions || !state.waves) fail("INTEGRATION_STATE", "executor state identity is invalid");
  const packageDir = path.join(snapshot.repoRoot, "docs", "packages", packageId);
  const packageText = fs.readFileSync(path.join(packageDir, "PACKAGE.md"), "utf8");
  const goals = [...packageText.matchAll(/^\*\*Goal:\*\*\s*(\S.*)$/gmu)];
  const contractIds = [...packageText.matchAll(/^- (C\d+) -> /gmu)].map((match) => match[1]);
  const owner = ownerContract.inspectOwnerContract(snapshot.repoRoot, packageDir, packageId, contractIds);
  if (!owner.complete || goals.length !== 1 || owner.digest !== state.originalOwnerDigest ||
      owner.requestDigest !== state.originalOwnerRequestDigest || goals[0][1].trim() !== state.originalGoal) {
    fail("INTEGRATION_CONTRACT_CHANGED", "Owner contract or derived Goal changed before integration");
  }
  const sessions = Object.values(state.sessions);
  if (!sessions.length || sessions.some((entry) => entry.state !== "verified")) {
    fail("INTEGRATION_SESSIONS", "all bound leaf sessions must be locally verified before integration", 1);
  }
  if (Object.values(state.waves).some((entry) => entry.state !== "complete")) {
    fail("INTEGRATION_WAVES", "all dispatch waves must be complete before integration", 1);
  }
  const patterns = [...new Set([
    ...sessions.flatMap((entry) => entry.owns || []),
    "docs/packages/" + packageId + "/**",
  ])];
  if (!patterns.length) fail("INTEGRATION_OWNS", "verified sessions contain no OWNS paths");
  const binding = { repoRoot: snapshot.repoRoot, packageId, scope, sessionId: "integration", leaf: "integration",
    headOid: snapshot.headOid, owns: patterns };
  return { snapshot, packageId, scope, stateFile, state, patterns, binding };
}

function integrationChangedPaths(context) {
  const tracked = parseZeroList(commandResult(git(context.snapshot.repoRoot,
    ["diff", "--name-only", "-z"]), "integration-preflight"));
  const untracked = parseZeroList(commandResult(git(context.snapshot.repoRoot,
    ["ls-files", "--others", "--exclude-standard", "-z"]), "integration-preflight"));
  const patterns = context.patterns.map((item) => packageBinding.globRegex(item));
  const paths = [...new Set([...tracked, ...untracked])]
    .filter((item) => patterns.some((pattern) => pattern.test(item)))
    .sort((left, right) => left.localeCompare(right, "en"));
  if (!paths.length) fail("NOTHING_TO_INTEGRATE", "verified leaf OWNS paths contain no uncommitted change", 1);
  return paths;
}

function integrationReceipt(context, commit, paths, recovered = false) {
  const receipt = writeReceipt({ ...context.binding, headOid: commit }, { operation: "integration-checkpoint",
    headBefore: context.state.integration.headBefore, head: commit, commit,
    message: context.state.integration.message, paths, recovered,
    acceptedResult: context.state.integration.expectedResultDigest ? {
      file: context.state.integration.expectedResultFile,
      digest: context.state.integration.expectedResultDigest,
      blob: context.state.integration.expectedResultBlob,
    } : undefined });
  return { operation: "integration-checkpoint", commit, paths, receipt, recovered,
    acceptedResultDigest: context.state.integration.expectedResultDigest };
}

function requestedIntegrationResult(context, options) {
  if (!options.expectedResultFile && !options.expectedResultDigest) return null;
  if (!options.expectedResultFile || !options.expectedResultDigest) {
    fail("USAGE", "--expected-result-file and --expected-result-digest are required together");
  }
  const digestValue = String(options.expectedResultDigest);
  if (!/^sha256:[a-f0-9]{64}$/u.test(digestValue)) fail("USAGE", "--expected-result-digest must be a sha256 digest");
  const absolute = path.resolve(context.snapshot.repoRoot, options.expectedResultFile);
  if (!repository.isPathInside(context.snapshot.repoRoot, absolute) || !fs.existsSync(absolute)) {
    fail("ACCEPTED_RESULT_FILE", "accepted result file must be inside the repository", 1);
  }
  const info = fs.lstatSync(absolute);
  if (!info.isFile() || info.isSymbolicLink() || (typeof info.nlink === "number" && info.nlink !== 1)) {
    fail("ACCEPTED_RESULT_FILE", "accepted result file must be a single-link regular file", 1);
  }
  if (sha256(fs.readFileSync(absolute)) !== digestValue) {
    fail("ACCEPTED_RESULT_CHANGED", "accepted result file changed before its integration checkpoint", 1);
  }
  return { file: path.relative(context.snapshot.repoRoot, absolute).replaceAll("\\", "/"), digest: digestValue };
}

function boundIntegrationResult(context, options) {
  const requested = requestedIntegrationResult(context, options);
  const integration = context.state.integration;
  if (!integration?.expectedResultDigest) return requested;
  if (requested && (requested.file !== integration.expectedResultFile || requested.digest !== integration.expectedResultDigest)) {
    fail("ACCEPTED_RESULT_STALE", "accepted result binding changed during integration recovery", 1);
  }
  if (!requested) {
    const absolute = path.join(context.snapshot.repoRoot, integration.expectedResultFile);
    if (!fs.existsSync(absolute) || sha256(fs.readFileSync(absolute)) !== integration.expectedResultDigest) {
      fail("ACCEPTED_RESULT_CHANGED", "accepted result file changed during integration recovery", 1);
    }
  }
  return requested ?? { file: integration.expectedResultFile, digest: integration.expectedResultDigest };
}

function assertCommittedResultBlob(context, commit, constraint) {
  if (!constraint) return;
  const expectedBlob = context.state.integration.expectedResultBlob;
  if (!expectedBlob) fail("ACCEPTED_RESULT_BLOB", "accepted result has no staged blob binding", 1);
  const actualBlob = commandResult(git(context.snapshot.repoRoot,
    ["rev-parse", "--verify", commit + ":" + constraint.file]), "accepted-result-blob").trim();
  if (actualBlob !== expectedBlob) fail("ACCEPTED_RESULT_CHANGED", "integration checkpoint does not contain the accepted result blob", 1);
}

function samePathSet(actual, expected) {
  return JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort());
}

export function integrationTreePathArgs(tree, headBefore) {
  return headBefore
    ? ["diff-tree", "--no-commit-id", "--name-only", "-r", "-z", headBefore, tree]
    : ["ls-tree", "-r", "--name-only", "-z", tree];
}

// The recorded diff base, proven against Git instead of read out of the
// agent-writable executor state: a checkpoint commit's parent IS its base, so a
// recovery branch that hands over a commit gets its base from `rev-parse
// <commit>^` and refuses a recorded headBefore that disagrees. Without it the
// recorded base could name the checkpoint commit itself, where the tree diff is
// empty by construction and an empty recorded path set then matched anything
// (measured 02.09.2026: `git diff-tree --no-commit-id --name-only -r -z <commit>
// <commit>^{tree}` prints nothing). An empty recorded path set is refused
// outright for the same reason. Proven by "two verified leaves receive one
// integration checkpoint, bottom-up reverify, plan completion and close" in
// test/package-execution.test.js.
function assertIntegrationTree(context, tree, paths, constraint, commit = null) {
  const headBefore = String(context.state.integration.headBefore || "");
  if (commit) {
    const parent = git(context.snapshot.repoRoot, ["rev-parse", "--verify", "--quiet", commit + "^"]);
    const recorded = parent.status === 0 ? String(parent.stdout).trim() : "";
    if (recorded !== headBefore) {
      fail("INTEGRATION_RECOVERY", "recorded integration base is not the checkpoint commit's parent", 1);
    }
  }
  if (!paths.length) fail("INTEGRATION_PATHS_CHANGED", "integration checkpoint recorded an empty path set", 1);
  const changed = parseZeroList(commandResult(git(context.snapshot.repoRoot,
    integrationTreePathArgs(tree, headBefore || null)),
  "integration-tree"));
  if (!samePathSet(changed, paths)) {
    fail("INTEGRATION_PATHS_CHANGED", "integration tree contains paths outside the exact prepared set", 1);
  }
  if (!constraint) return;
  const treeBlob = commandResult(git(context.snapshot.repoRoot,
    ["rev-parse", "--verify", tree + ":" + constraint.file]), "accepted-result-tree").trim();
  if (treeBlob !== context.state.integration.expectedResultBlob) {
    fail("ACCEPTED_RESULT_CHANGED", "integration tree does not contain the accepted staged result blob", 1);
  }
}

export function integrationCommitTreeArgs(tree, headBefore, message) {
  const parentArgs = headBefore ? ["-p", headBefore] : [];
  return ["commit-tree", tree, ...parentArgs, "-m", message];
}

export function integrationUpdateRefArgs(commit, headBefore) {
  const expectedOld = headBefore || "0".repeat(String(commit).length);
  return ["update-ref", "HEAD", commit, expectedOld];
}

function integrationCheckpoint(options) {
  const context = integrationContext(options);
  let resultConstraint = boundIntegrationResult(context, options);
  const message = String(options.message || "").trim();
  if (!message || message.length > 200 || /[\r\n\0]/u.test(message)) {
    fail("USAGE", "--message must be one line of 1..200 characters");
  }
  if (context.state.integration?.state === "committed") {
    const committed = context.state.integration.commit;
    if (currentHead(context.binding) !== committed) {
      fail("INTEGRATION_STALE", "HEAD moved after the integration checkpoint", 1);
    }
    // The same evidence the two prepared-recovery branches below demand, and for
    // the same reason: everything this branch reads out of executor.json is
    // agent-writable, so "recovered: true" has to be proven against Git objects.
    // The commit's own tree is compared with the recorded path set INDEPENDENTLY
    // of an accepted-result constraint -- without a --result-file there was no
    // constraint and therefore no check at all, so a rewritten commit/paths pair
    // in executor.json turned any commit that happened to be HEAD into an
    // approved checkpoint. assertIntegrationTree takes the diff base from the
    // commit's own parent, so the recorded headBefore cannot make that comparison
    // vacuous. Proven by "two verified leaves receive one integration checkpoint,
    // bottom-up reverify, plan completion and close" in test/package-execution.test.js.
    const committedTree = commandResult(git(context.snapshot.repoRoot,
      ["rev-parse", "--verify", committed + "^{tree}"]), "integration-recovery").trim();
    assertIntegrationTree(context, committedTree, context.state.integration.paths, resultConstraint, committed);
    assertCommittedResultBlob(context, committed, resultConstraint);
    return integrationReceipt(context, committed, context.state.integration.paths, true);
  }
  if (context.state.integration?.state === "prepared") {
    const head = currentHead(context.binding);
    if (head !== context.state.integration.headBefore) {
      const expectedCommit = context.state.integration.expectedCommit;
      const expectedTree = context.state.integration.expectedTree;
      if (!expectedCommit || !expectedTree || head !== expectedCommit) {
        fail("INTEGRATION_RECOVERY", "HEAD is not the exact prepared integration commit; Owner inspection required", 1);
      }
      const committedTree = commandResult(git(context.snapshot.repoRoot,
        ["rev-parse", "--verify", head + "^{tree}"]), "integration-recovery").trim();
      if (committedTree !== expectedTree) fail("INTEGRATION_RECOVERY", "prepared integration tree identity changed", 1);
      assertIntegrationTree(context, expectedTree, context.state.integration.paths, resultConstraint, head);
      assertCommittedResultBlob(context, head, resultConstraint);
      context.state.integration = { ...context.state.integration, state: "committed", commit: head,
        committedAt: new Date().toISOString(), recovered: true };
      atomicJson(context.stateFile, context.state);
      return integrationReceipt(context, head, context.state.integration.paths, true);
    }
    if (context.state.integration.expectedCommit && context.state.integration.expectedTree) {
      const preparedTree = commandResult(git(context.snapshot.repoRoot,
        ["rev-parse", "--verify", context.state.integration.expectedCommit + "^{tree}"]), "integration-recovery").trim();
      if (preparedTree !== context.state.integration.expectedTree) {
        fail("INTEGRATION_RECOVERY", "prepared commit no longer resolves to its exact tree", 1);
      }
      assertIntegrationTree(context, preparedTree, context.state.integration.paths, resultConstraint,
        context.state.integration.expectedCommit);
      commandResult(git(context.snapshot.repoRoot,
        integrationUpdateRefArgs(context.state.integration.expectedCommit, context.state.integration.headBefore)),
      "integration-head");
      assertCommittedResultBlob(context, context.state.integration.expectedCommit, resultConstraint);
      context.state.integration = { ...context.state.integration, state: "committed",
        commit: context.state.integration.expectedCommit, committedAt: new Date().toISOString(), recovered: true };
      atomicJson(context.stateFile, context.state);
      return integrationReceipt(context, context.state.integration.commit, context.state.integration.paths, true);
    }
    const staged = parseZeroList(commandResult(git(context.snapshot.repoRoot,
      ["diff", "--cached", "--name-only", "-z"]), "integration-recovery"));
    if (staged.length) {
      if (!samePathSet(staged, context.state.integration.paths)) {
        fail("INTEGRATION_RECOVERY", "prepared index contains paths outside the exact integration set", 1);
      }
      commandResult(git(context.snapshot.repoRoot,
        ["reset", "--", ...context.state.integration.paths]), "integration-recovery");
    }
    context.state.integration = null;
  }

  const index = git(context.snapshot.repoRoot, ["diff", "--cached", "--quiet"]);
  if (index.status === 1) fail("SHARED_INDEX_DIRTY", "integration refused: Git index contains staged paths");
  if (index.status !== 0) commandResult(index, "integration-preflight");
  const paths = integrationChangedPaths(context);
  if (resultConstraint && !paths.includes(resultConstraint.file)) {
    fail("ACCEPTED_RESULT_SCOPE", "accepted result file is not part of the exact integration paths", 1);
  }
  context.state.integration = { state: "prepared", headBefore: context.snapshot.headOid, message, paths,
    preparedAt: new Date().toISOString(), expectedResultFile: resultConstraint?.file,
    expectedResultDigest: resultConstraint?.digest };
  atomicJson(context.stateFile, context.state);
  commandResult(git(context.snapshot.repoRoot, ["add", "--", ...paths]), "integration-stage");
  try {
    resultConstraint = boundIntegrationResult(context, options);
    if (resultConstraint) {
      context.state.integration.expectedResultBlob = commandResult(git(context.snapshot.repoRoot,
        ["rev-parse", "--verify", ":" + resultConstraint.file]), "accepted-result-stage").trim();
      const stagedDigest = sha256(gitBytes(context.snapshot.repoRoot,
        ["cat-file", "blob", context.state.integration.expectedResultBlob]));
      if (stagedDigest !== resultConstraint.digest) {
        fail("ACCEPTED_RESULT_CHANGED", "staged result blob differs from the semantically accepted result", 1);
      }
      atomicJson(context.stateFile, context.state);
    }
  } catch (error) {
    git(context.snapshot.repoRoot, ["reset", "--", ...paths]);
    context.state.integration = null;
    atomicJson(context.stateFile, context.state);
    throw error;
  }
  const tree = commandResult(git(context.snapshot.repoRoot, ["write-tree"]), "integration-tree").trim();
  assertIntegrationTree(context, tree, paths, resultConstraint);
  context.state.integration.expectedTree = tree;
  atomicJson(context.stateFile, context.state);
  const commit = commandResult(git(context.snapshot.repoRoot,
    integrationCommitTreeArgs(tree, context.state.integration.headBefore, message), { timeoutMs: 120_000 }),
  "integration-commit").trim();
  context.state.integration.expectedCommit = commit;
  atomicJson(context.stateFile, context.state);
  commandResult(git(context.snapshot.repoRoot,
    integrationUpdateRefArgs(commit, context.state.integration.headBefore)), "integration-head");
  assertCommittedResultBlob(context, commit, resultConstraint);
  context.state.integration = { ...context.state.integration, state: "committed", commit,
    committedAt: new Date().toISOString(), recovered: false };
  atomicJson(context.stateFile, context.state);
  return integrationReceipt(context, commit, paths, false);
}

function ledgerPathPattern(packageId) {
  const exact = packageId.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp("^docs/packages/" + exact + "/(?:GATES\\.md|gates/[^/]+\\.md)$", "u");
}

// Mirrors the exact ledger writeback surface of the vendored gate-check and the
// evidence-fingerprint normalization: only gate checkboxes and EVIDENCE values
// are runtime state. Every contract line (gate ids, titles, CHECK, EXPECT, CWD,
// OWNS) stays byte-bound. The EVIDENCE indent class is the vendored parser's own
// (ATTR_RE indents with `\s+` inside one already split line, so [^\S\n] is that
// class here, and the swap in writebackDeclarations below reads the same one):
// an evidence line the gate runner writes back is runtime state here too,
// whatever whitespace indents it. Every pattern stays strictly line-local
// ([^\S\n] and [^\n] never span a newline): a pattern that could span one lets
// an empty EVIDENCE line swallow the following line, which masks a tampered gate
// title. Proven by "ledger normalization stays line-local so an empty EVIDENCE
// cannot mask the next contract line" in test/git-intent.test.js.
export function normalizedLedger(value) {
  return String(value)
    .replace(/\r\n?/gu, "\n")
    .replace(/^([ \t]*-[ \t]+)\[[ xX]\]([ \t]+[^\n]+)$/gmu, "$1[ ]$2")
    .replace(/^([^\S\n]*EVIDENCE:)[^\n]*$/gmu, "$1 <runtime-evidence>");
}

function packageFiles(repoRoot, packageId) {
  const packageDir = path.join(repoRoot, "docs", "packages", packageId);
  if (!fs.existsSync(packageDir) || !fs.lstatSync(packageDir).isDirectory() || fs.lstatSync(packageDir).isSymbolicLink()) {
    fail("CLOSE_PACKAGE", "package directory is missing or unsafe");
  }
  const ledger = ledgerPathPattern(packageId);
  const records = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) fail("CLOSE_PACKAGE", "package bundle contains a symbolic link");
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) {
        const relative = path.relative(repoRoot, absolute).replaceAll("\\", "/");
        const bytes = fs.readFileSync(absolute);
        records.push({ relative, digest: sha256(bytes),
          ...(ledger.test(relative) ? { normalizedDigest: sha256(normalizedLedger(bytes.toString("utf8"))) } : {}) });
      } else fail("CLOSE_PACKAGE", "package bundle contains a non-regular entry");
    }
  };
  walk(packageDir);
  return records.sort((left, right) => left.relative.localeCompare(right.relative, "en"));
}

// Anchored to the one pattern that decides normalizedDigest above, so a nested
// docs/packages/<id>/evidence/gates/*.md can never act as a bundle ledger.
export function isBundleLedger(relative, packageId) {
  return ledgerPathPattern(packageId).test(relative);
}

// The bundle's before-state at an anchor commit, read from Git objects instead
// of from a receipt under .unlazy/: the anchor commit is a trust anchor, the
// receipt is agent-writable JSON (welle-2c-design.md, threat model).
//   carried  -- the bundle paths the anchor commit holds.
//   changed  -- those whose working-tree content differs from the anchor, asked
//               of Git itself (`git diff <anchor>`), so a repository that checks
//               text files out with CRLF while the blob holds LF is compared
//               exactly the way Git checked it out. Comparing sha256 over the
//               two byte strings instead would call every text file changed
//               there (measured 02.09.2026 with core.autocrlf=true: a freshly
//               cloned file reads CRLF from the worktree and LF from `git show`
//               while `git diff --name-only` reports it unchanged).
//   normalized -- the runtime-normalized digest of every anchor ledger, which is
//               EOL-independent because normalizedLedger folds CRLF first.
function anchorBundleState(repoRoot, packageId, head) {
  const prefix = "docs/packages/" + packageId + "/";
  const carried = parseZeroList(commandResult(git(repoRoot,
    ["ls-tree", "-r", "--name-only", "-z", head, "--", prefix]), "closure-anchor"))
    .filter((relative) => relative.startsWith(prefix));
  const changed = new Set(parseZeroList(commandResult(git(repoRoot,
    ["diff", "--name-only", "-z", head, "--", prefix]), "closure-anchor")));
  const normalized = new Map();
  for (const relative of carried) {
    if (!isBundleLedger(relative, packageId)) continue;
    normalized.set(relative, sha256(normalizedLedger(
      gitBytes(repoRoot, ["show", head + ":" + relative], { failCode: "CLOSE_ANCHOR" }).toString("utf8"))));
  }
  return { carried: new Set(carried), changed, normalized };
}

function bundleLedgerPaths(repoRoot, packageId) {
  const prefix = "docs/packages/" + packageId + "/";
  const packageDir = path.join(repoRoot, "docs", "packages", packageId);
  const relatives = [];
  const rootLedger = path.join(packageDir, "GATES.md");
  if (fs.existsSync(rootLedger) && fs.lstatSync(rootLedger).isFile()) relatives.push(prefix + "GATES.md");
  const gatesDir = path.join(packageDir, "gates");
  if (fs.existsSync(gatesDir) && fs.lstatSync(gatesDir).isDirectory()) {
    for (const entry of fs.readdirSync(gatesDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".md")) relatives.push(prefix + "gates/" + entry.name);
    }
  }
  return relatives.sort((left, right) => left.localeCompare(right, "en"));
}

// Every ledger of the bundle as {relative, text}, read from the working tree.
// Callers that must not trust the working tree pass their own texts instead.
export function bundleLedgers(repoRoot, packageId) {
  return bundleLedgerPaths(repoRoot, packageId).map((relative) => ({
    relative, text: fs.readFileSync(path.join(repoRoot, relative), "utf8"),
  }));
}

// A gate declares the exact artifacts its own CHECK rewrites with an indented
// WRITES: line, next to CHECK/EXPECT/CWD. The vendored gate parser accepts only
// CHECK/EXPECT/EVIDENCE/CWD as gate attributes, so a WRITES: line is invisible
// to gate-check and changes no gate execution -- and it is byte-bound like every
// other contract line, because normalizedLedger below rewrites only checkboxes
// and EVIDENCE values.
// It is read through EXACTLY the vendored parser's gate segmentation, fence
// handling and indentation rule -- never a private scan -- by parsing the ledger
// a second time through a line-local, line-count preserving swap: WRITES takes
// the EVIDENCE attribute's place while the real EVIDENCE line becomes an ignored
// line. Both halves use the parser's own indent class ([^\S\n], the whitespace
// ATTR_RE accepts inside one already split line), because a narrower [ \t] left
// an EVIDENCE line indented with any other whitespace untouched by the first
// half and read back as the gate's declaration by the second (measured
// 02.09.2026 with a U+00A0 indent: one declared path from a line the gate runner
// reads as ordinary runtime evidence). Anything but a
// literal repo-relative path under the bundle's evidence/ directory is dropped,
// so a malformed or glob-shaped declaration declares nothing (the close then
// names the file it refused).
export function writebackDeclarations(parseGates, packageId, ledgerRelative, text) {
  const evidencePrefix = "docs/packages/" + packageId + "/evidence/";
  const swapped = String(text)
    .replace(/^([^\S\n]+)EVIDENCE:/gmu, "$1x-EVIDENCE:")
    .replace(/^([^\S\n]+)WRITES:/gmu, "$1EVIDENCE:");
  const parsed = parseGates(swapped, { requireGates: false });
  // A ledger whose WRITES lines do not survive the swap is refused instead of
  // read half-way: two WRITES lines on one gate become two EVIDENCE lines, and
  // the vendored parser then keeps only the LAST value while reporting a
  // duplicate error. Silently dropping the first would let a bundle declare a
  // second artifact that this tolerance never sees. gate-check itself exits on
  // ledger errors (vendor/unlazy/scripts/gate-check.mjs, doc.errors branch), so
  // every ledger the runner accepts passes this parse too.
  if (parsed.errors.length) {
    fail("GATE_PARSER", "WRITES declarations of " + ledgerRelative + " do not parse as one line per gate: " +
      parsed.errors[0]);
  }
  const declared = new Set();
  for (const gate of parsed.gates) {
    if (gate.evidence === null) continue;
    for (const item of String(gate.evidence).split(",").map((value) => value.trim()).filter(Boolean)) {
      if (item.includes("\\") || item.startsWith("/") || /^[A-Za-z]:/u.test(item) ||
          /[*?[\]{}]/u.test(item) || item.split("/").some((part) => part === ".." || part === "." || part === "")) {
        continue;
      }
      if (item.startsWith(evidencePrefix) && item.length > evidencePrefix.length) declared.add(item);
    }
  }
  return declared;
}

// The bundle marker that opts a legacy bundle into the wide OWNS fallback. It
// starts at column 1, so the vendored parser reads it as neither a gate
// attribute nor an OWNS line, and normalizedLedger below leaves it byte-bound.
// The trailing [ \t\r]* is the Windows half of the portability rule: these
// ledgers are checked out with CRLF endings, and a bare `$` would never match
// the marker line there.
const LEGACY_WRITEBACK_MARKER = /^WRITEBACK:[ \t]+legacy-owns[ \t\r]*$/mu;

// Which ledger of this bundle declares that an oracle regenerates which evidence
// artifact. The answer is a MAP from artifact to the declaring ledgers, not a
// flat set, because the caller intersects it with a per-ledger run witness: the
// tolerance needs to know WHICH ledger's re-verification would legitimately have
// rewritten those bytes.
//   WRITES -- the per-gate declaration above, and the only automatic source. It
//     says "an oracle rewrites these bytes", which is the question asked here.
//   OWNS -- legacy fallback for a bundle that has not migrated. It is OPT-IN
//     through the WRITEBACK: legacy-owns marker, never a silent default: OWNS is
//     a leaf's write authority DURING EXECUTION, not a statement that a
//     re-verification rewrites those bytes, and the two are measurably different
//     sets (02.09.2026, reference bundle
//     keel-harness-reference-completeness-repair: its evidence leaf OWNS the
//     whole docs/packages/<id>/evidence/** surface while its oracles regenerate
//     two named reports).
// A CHECK line that happens to contain a path declares NOTHING here. Substring
// matching over a shell command line is guessing, not a declaration: it turned
// every path a CHECK mentions for any reason -- an input, a --exclude argument,
// a longer path this one is a prefix of -- into a free-byte window.
// Read this together with the run witness the caller applies on top: a
// declaration says which artifacts an oracle MAY refresh, never that this run
// did refresh them, so a file hand-edited before the run is refused even while
// its declaration stands.
// No declaration can widen during a close: WRITES, OWNS and the marker all
// survive normalizedLedger below, so an injected line changes the ledger's
// normalized digest and fails the same close.
export function oracleWritebackDeclarations(parseGates, packageId, ledgers, candidates) {
  const prefix = "docs/packages/" + packageId + "/";
  const evidencePrefix = prefix + "evidence/";
  const writesByLedger = new Map();
  const ownsByLedger = new Map();
  let legacy = false;
  for (const ledger of ledgers) {
    const relative = String(ledger.relative);
    if (!isBundleLedger(relative, packageId)) continue;
    const text = String(ledger.text);
    if (LEGACY_WRITEBACK_MARKER.test(text)) legacy = true;
    writesByLedger.set(relative, writebackDeclarations(parseGates, packageId, relative, text));
    const name = relative.slice(prefix.length);
    if (!/^gates\/leaf-[A-Za-z0-9][A-Za-z0-9._-]{0,58}\.md$/u.test(name)) continue;
    try {
      ownsByLedger.set(relative,
        packageBinding.leafOwnsFromText(text).map((pattern) => packageBinding.globRegex(pattern)));
    } catch { continue; }
  }
  const declarations = new Map();
  const declare = (relative, ledger) => {
    if (!declarations.has(relative)) declarations.set(relative, new Set());
    declarations.get(relative).add(ledger);
  };
  for (const relative of candidates) {
    if (!relative.startsWith(evidencePrefix)) continue;
    for (const [ledger, writes] of writesByLedger) if (writes.has(relative)) declare(relative, ledger);
    if (!legacy) continue;
    for (const [ledger, patterns] of ownsByLedger) {
      if (patterns.some((pattern) => pattern.test(relative))) declare(relative, ledger);
    }
  }
  return declarations;
}

// The intersection of declaration and witness, ledger by ledger. A witness is
// one gate-runner invocation the executor started itself: `ledgers` are the
// bundle ledgers that invocation covered (an exact --leaf run covers one, a
// bundle run covers all of them) and `files` are the bundle paths whose bytes it
// actually rewrote. An artifact is tolerable only when the SAME invocation that
// rewrote it also ran the ledger that declares it, so a declaration in ledger A
// can never license bytes only ledger B's re-verification touched.
export function toleratedWriteback(declarations, witnesses) {
  const tolerated = new Set();
  for (const [relative, declaring] of declarations) {
    for (const witness of witnesses) {
      if (!witness.files.has(relative)) continue;
      if (![...declaring].some((ledger) => witness.ledgers.has(ledger))) continue;
      tolerated.add(relative);
      break;
    }
  }
  return tolerated;
}

function normalizedClosure(text) {
  let value = String(text);
  for (const name of ["Coverage", "Fulfillment", "Geprueft gegen", "Offen"]) {
    const pattern = new RegExp("^" + name.replace(" ", "\\s+") + ":[^\\r\\n]*", "gmi");
    const matches = value.match(pattern) || [];
    if (matches.length !== 1) fail("CLOSE_PACKAGE", "PACKAGE.md must contain exactly one " + name + " field");
    value = value.replace(pattern, name + ": <closure-value>");
  }
  return value;
}

function planClose(options) {
  const context = integrationContext(options);
  if (context.state.integration?.state !== "committed" ||
      currentHead(context.binding) !== context.state.integration.commit) {
    fail("INTEGRATION_REQUIRED", "package close requires the current exact integration checkpoint", 1);
  }
  const packageFile = path.join(context.snapshot.repoRoot, "docs", "packages", context.packageId, "PACKAGE.md");
  const packageText = fs.readFileSync(packageFile, "utf8");
  const files = packageFiles(context.snapshot.repoRoot, context.packageId);
  const receipt = writeGlobalReceipt(context.snapshot.repoRoot, {
    operation: "plan-close",
    packageId: context.packageId,
    scope: context.scope,
    head: context.state.integration.commit,
    ownerDigest: context.state.originalOwnerDigest,
    ownerRequestDigest: context.state.originalOwnerRequestDigest,
    normalizedPackageDigest: sha256(normalizedClosure(packageText)),
    files,
  });
  return { operation: "plan-close", packageId: context.packageId, scope: context.scope,
    head: context.state.integration.commit, receipt };
}

// The witnesses of the mandated re-verification, read as EXECUTION RECEIPTS
// rather than taken from the command line. The previous surface was a free
// --oracle-writeback path list: the caller simply named the files it wanted
// tolerated, so the "witness" half of the tolerance was the caller's own word.
// A receipt cannot be reduced to a word: readExecutionReceipt binds it to its
// immutable digest-derived path and operation, and every receipt has to name
// THIS close plan, THIS HEAD and the exact ledgers its run covered -- exactly
// how the close plan itself is bound to this exact package and HEAD.
// A receipt is still written by the same OS user as the repository, so it is the
// sanctioned chain, not cryptography (welle-2c-design.md, threat model). What it
// buys over argv is that the executor must have RUN the re-verification whose
// digests it records, and that the recorded digest must still be the file's
// current digest at close time.
function writebackWitnesses(repoRoot, packageId, source, planReceipt, receiptPaths) {
  const witnesses = [];
  for (const value of receiptPaths || []) {
    let record;
    try { record = readExecutionReceipt(repoRoot, value, "oracle-writeback-witness"); }
    catch (error) { fail(error.code || "WRITEBACK_WITNESS", error.message, error.exitCode || 2); }
    const witness = record.value;
    const boundPlan = path.resolve(repoRoot, String(witness.planReceipt || ""));
    if (witness.packageId !== packageId || (witness.scope || null) !== (source.scope || null) ||
        witness.head !== source.head || !repository.samePath(boundPlan, path.resolve(repoRoot, planReceipt))) {
      fail("WRITEBACK_WITNESS", "writeback witness receipt does not bind this exact close plan and HEAD", 1);
    }
    const ledgers = new Set((Array.isArray(witness.ledgers) ? witness.ledgers : [])
      .map((item) => String(item)).filter((item) => isBundleLedger(item, packageId)));
    const files = new Map();
    for (const item of Array.isArray(witness.files) ? witness.files : []) {
      if (!item || typeof item.relative !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(String(item.digest || ""))) continue;
      files.set(item.relative, String(item.digest));
    }
    witnesses.push({ ledgers, files });
  }
  return witnesses;
}

// The close mirror (audit 06.09.2026, B23): package execution copies its own immutable receipts
// -- the close receipt and the duty state -- into docs/packages/<id>/evidence/close/ so that
// follow-up duties survive the runtime cleanup of .unlazy/. The closure checkpoint admits exactly
// these files, each proven by its own record digest and bound to this package and scope; anything
// else under the bundle that the close plan did not snapshot still fails CLOSE_WRITEBACK.
// Der Freigabebeleg selbst wird nicht mehr gespiegelt: die Owner-OK-Zeile steht in der
// PACKAGE.md, die dieser Checkpoint selbst committet (Rueckbau 08.09.2026).
export const CLOSE_MIRROR_FILES = Object.freeze({
  "close-receipt.json": "close-receipt",
  "duties-state.json": "duties-state",
});

export function closeMirrorRecord(repoRoot, relative, packageId, scope) {
  const prefix = "docs/packages/" + packageId + "/evidence/close/";
  if (!relative.startsWith(prefix)) return { ok: false, reason: "outside the close mirror" };
  const name = relative.slice(prefix.length);
  const operation = CLOSE_MIRROR_FILES[name];
  if (!operation) return { ok: false, reason: "not a close mirror record" };
  let value;
  try { value = JSON.parse(fs.readFileSync(path.join(repoRoot, ...relative.split("/")), "utf8")); }
  catch (error) { return { ok: false, reason: "invalid JSON: " + error.message }; }
  try { validateImmutableRecord(value); }
  catch (error) { return { ok: false, reason: error.message }; }
  if (value.operation !== operation) return { ok: false, reason: "operation " + value.operation + " does not belong to " + name };
  if (value.packageId !== packageId || (value.scope || null) !== (scope || null)) {
    return { ok: false, reason: "record binds another package or scope" };
  }
  return { ok: true, operation };
}

async function closureCheckpoint(options) {
  const snapshot = repository.repositorySnapshot(options.root || process.cwd());
  const packageId = identifier(options.packageId, "package");
  const source = globalReceiptRecord(snapshot.repoRoot, options.receipt, "plan-close").value;
  if (source.packageId !== packageId || source.head !== snapshot.headOid) {
    fail("CLOSE_PLAN_STALE", "package or HEAD changed after the close plan", 1);
  }
  const packageDir = path.join(snapshot.repoRoot, "docs", "packages", packageId);
  const packageFile = path.join(packageDir, "PACKAGE.md");
  const packageText = fs.readFileSync(packageFile, "utf8");
  // The same Owner bar publish carries. A closure checkpoint writes a commit for
  // a package the Owner said OK to closing, so it reads that Owner-OK line out of
  // the PACKAGE.md it is about to commit instead of trusting that its caller did:
  // the executor's own state file is plain agent-writable JSON, and without this
  // check a direct git-intent call closed a package with no Owner word at all.
  // The line binds the exact commit the close plan is bound to, so an Owner-OK
  // written for an older state is stale here (Rueckbau 08.09.2026).
  let ownerOk;
  try { ownerOk = findOwnerOk(packageText, "close"); }
  catch (error) { fail(error.code || "OWNER_OK_INVALID", error.message, error.exitCode || 2); }
  try { validateOwnerOk(ownerOk, { action: "close", target: null, head: source.head, today: todayLocal() }); }
  catch (error) { fail(error.code || "OWNER_OK_INVALID", error.message, error.exitCode || 2); }
  const message = String(options.message || "").trim();
  if (!message || message.length > 200 || /[\r\n\0]/u.test(message)) {
    fail("USAGE", "--message must be one line of 1..200 characters");
  }
  if (!/^Fulfillment:\s*(?:erfuellt|fulfilled)\b/imu.test(packageText) ||
      !/^Offen:\s*(?:nichts|nothing|none)\s*$/imu.test(packageText)) {
    fail("CLOSE_NOT_FINAL", "PACKAGE.md does not carry a closed Fulfillment/Offen claim", 1);
  }
  if (sha256(normalizedClosure(packageText)) !== source.normalizedPackageDigest) {
    fail("CLOSE_WRITEBACK", "package close changed content outside the four closure fields", 1);
  }
  const currentFiles = packageFiles(snapshot.repoRoot, packageId);
  const plannedRelatives = new Set(source.files.map((item) => item.relative));
  for (const extra of currentFiles.filter((item) => !plannedRelatives.has(item.relative))) {
    const verdict = closeMirrorRecord(snapshot.repoRoot, extra.relative, packageId, source.scope);
    if (!verdict.ok) fail("CLOSE_WRITEBACK", "package file set changed during close: " + extra.relative + " (" + verdict.reason + ")", 1);
  }
  const currentPlanned = currentFiles.map((item) => item.relative).filter((relative) => plannedRelatives.has(relative));
  if (JSON.stringify(currentPlanned) !== JSON.stringify(source.files.map((item) => item.relative))) {
    fail("CLOSE_WRITEBACK", "package file set changed during close", 1);
  }
  // The package close MUST re-verify gates after the Owner said OK (the
  // vendored close runs its gate runner, or reuses the current integration
  // checkpoint when nothing changed since it), and that mandated re-execution
  // legitimately refreshes runtime evidence: ledger checkboxes/EVIDENCE values
  // and exactly those evidence/ artifacts a gate of this bundle declares it
  // regenerates. Only that turnover is tolerated here; the file set stays locked
  // above, and every contract byte (OWNER.md, ledger contract lines, undeclared
  // evidence proof, everything else in the bundle) stays bound to the recorded
  // close plan.
  // Two independent conditions have to agree, because a declaration alone is a
  // permission, not a fact: the witness receipts record which paths the mandated
  // re-verification actually rewrote (digest before the run != digest after it),
  // and this close re-checks that each recorded digest is still the file's
  // CURRENT digest. Without that witness the tolerance is empty, which is why a
  // file hand-edited between the recorded close plan and the run -- an Owner
  // proof no oracle ever writes -- is refused even inside a bundle whose
  // declaration would cover it.
  // The ledgers are read from the working tree here on purpose: a widened WRITES
  // or OWNS line survives normalizedLedger, so it changes the ledger's own
  // normalized digest, and the loop below refuses that ledger (ledgers never sit
  // under evidence/ and are therefore never tolerable). Proven by "two verified
  // leaves receive one integration checkpoint, bottom-up reverify, plan
  // completion and close" in test/package-execution.test.js, which rewrites a
  // gate title after the recorded close plan.
  // The BEFORE state of every path the anchor commit carries comes from that
  // commit (source.head is asserted to be HEAD above), not from the plan
  // receipt: the receipt is agent-writable, the commit is not. The receipt stays
  // the before state only for a path the anchor does not carry -- an artifact the
  // mandated re-verification created after the checkpoint.
  const anchor = anchorBundleState(snapshot.repoRoot, packageId, source.head);
  const beforeByFile = new Map(source.files.map((item) => [item.relative, item]));
  const witnesses = writebackWitnesses(snapshot.repoRoot, packageId, source, options.receipt,
    options.writebackReceipts);
  const currentDigests = new Map(currentFiles.map((item) => [item.relative, item.digest]));
  for (const witness of witnesses) {
    for (const [relative, digest] of [...witness.files]) {
      if (currentDigests.get(relative) !== digest) witness.files.delete(relative);
    }
  }
  const declared = oracleWritebackDeclarations(await loadGateParser(snapshot.repoRoot, options.unlazyRoot),
    packageId, bundleLedgers(snapshot.repoRoot, packageId), currentFiles.map((item) => item.relative));
  const oracleWriteback = toleratedWriteback(declared, witnesses);
  for (const current of currentFiles) {
    if (current.relative === "docs/packages/" + packageId + "/PACKAGE.md") continue;
    if (!plannedRelatives.has(current.relative)) continue;
    if (anchor.carried.has(current.relative)) {
      if (!anchor.changed.has(current.relative)) continue;
      const anchorNormalized = anchor.normalized.get(current.relative);
      if (anchorNormalized && current.normalizedDigest && anchorNormalized === current.normalizedDigest) continue;
    } else {
      const before = beforeByFile.get(current.relative);
      if (before.digest === current.digest) continue;
      if (before.normalizedDigest && current.normalizedDigest &&
          before.normalizedDigest === current.normalizedDigest) continue;
    }
    if (oracleWriteback.has(current.relative)) continue;
    fail("CLOSE_WRITEBACK", "package close changed non-PACKAGE metadata: " + current.relative, 1);
  }
  const contractIds = [...packageText.matchAll(/^- (C\d+) -> /gmu)].map((match) => match[1]);
  const owner = ownerContract.inspectOwnerContract(snapshot.repoRoot, packageDir, packageId, contractIds);
  if (!owner.complete || owner.digest !== source.ownerDigest || owner.requestDigest !== source.ownerRequestDigest) {
    fail("CLOSE_OWNER", "Owner contract changed during close", 1);
  }
  for (const item of currentFiles.filter((entry) => isBundleLedger(entry.relative, packageId))) {
    const ledger = fs.readFileSync(path.join(snapshot.repoRoot, item.relative), "utf8");
    if (/^- \[ \]/mu.test(ledger) || /^\s*EVIDENCE:\s*pending\s*$/imu.test(ledger) || /^ABANDON:/imu.test(ledger)) {
      fail("CLOSE_GATES", "closed package contains an unmet or abandoned gate: " + item.relative, 1);
    }
  }
  const index = git(snapshot.repoRoot, ["diff", "--cached", "--quiet"]);
  if (index.status === 1) fail("SHARED_INDEX_DIRTY", "closure checkpoint refused: Git index contains staged paths");
  if (index.status !== 0) commandResult(index, "closure-preflight");
  const prefix = "docs/packages/" + packageId + "/";
  const tracked = parseZeroList(commandResult(git(snapshot.repoRoot, ["diff", "--name-only", "-z", "--", prefix]), "closure-preflight"));
  const untracked = parseZeroList(commandResult(git(snapshot.repoRoot,
    ["ls-files", "--others", "--exclude-standard", "-z", "--", prefix]), "closure-preflight"));
  const paths = [...new Set([...tracked, ...untracked])].sort((left, right) => left.localeCompare(right, "en"));
  if (!paths.length || paths.some((item) => !item.startsWith(prefix))) {
    fail("CLOSE_NOTHING", "closure checkpoint found no exact package metadata change", 1);
  }
  // Hook-free, exactly like the integration checkpoint: `git commit` would run
  // the repository's commit hooks, and a hook can stage and commit files far
  // outside the approved closure path set. write-tree/diff-tree/commit-tree/
  // update-ref writes the same commit without ever handing control to a hook,
  // and the diff-tree assertion binds the committed tree to those exact paths.
  commandResult(git(snapshot.repoRoot, ["add", "--", ...paths]), "closure-stage");
  let commit;
  try {
    const tree = commandResult(git(snapshot.repoRoot, ["write-tree"]), "closure-tree").trim();
    const changed = parseZeroList(commandResult(git(snapshot.repoRoot,
      integrationTreePathArgs(tree, snapshot.headOid)), "closure-tree"));
    if (!samePathSet(changed, paths)) {
      fail("CLOSE_PATHS_CHANGED", "closure tree contains paths outside the exact package metadata set", 1);
    }
    commit = commandResult(git(snapshot.repoRoot,
      integrationCommitTreeArgs(tree, snapshot.headOid, message), { timeoutMs: 120_000 }), "closure-commit").trim();
    commandResult(git(snapshot.repoRoot, integrationUpdateRefArgs(commit, snapshot.headOid)), "closure-head");
  } catch (error) {
    git(snapshot.repoRoot, ["reset", "--", ...paths]);
    throw error;
  }
  const receipt = writeGlobalReceipt(snapshot.repoRoot, { operation: "closure-checkpoint", packageId,
    scope: source.scope,
    headBefore: source.head, head: commit, commit, paths, planReceipt: options.receipt,
    ownerOk: { action: ownerOk.action, target: ownerOk.target, date: ownerOk.date, commit: ownerOk.commit,
      wording: ownerOk.wording, line: ownerOk.line, lineDigest: ownerOk.lineDigest } });
  return { operation: "closure-checkpoint", packageId, commit, paths, receipt };
}

function explain(options) {
  const operation = String(options.operation || "unknown").replace(/[^a-z0-9-]/giu, "").slice(0, 40) || "unknown";
  return {
    operation: "explain",
    requested: operation,
    code: "OWNER_DECISION_REQUIRED",
    next: "Stop. Ask the Owner whether the exact repository state may be changed; do not try another Git command.",
  };
}

function planPublish(options) {
  let repoRoot;
  let head;
  let binding = null;
  let packageId;
  let scope;
  if (options.receipt) {
    const snapshot = repository.repositorySnapshot(options.root || process.cwd());
    const closure = globalReceiptRecord(snapshot.repoRoot, options.receipt, "closure-checkpoint").value;
    if (closure.commit !== snapshot.headOid) fail("PUBLISH_PLAN_STALE", "closed package checkpoint is not current HEAD", 1);
    repoRoot = snapshot.repoRoot;
    head = snapshot.headOid;
    packageId = closure.packageId;
    scope = closure.scope;
    if (!scope && closure.planReceipt) {
      scope = globalReceiptRecord(snapshot.repoRoot, closure.planReceipt, "plan-close").value.scope;
    }
  } else {
    binding = exactBinding(options);
    repoRoot = binding.repoRoot;
    head = binding.headOid;
    packageId = binding.packageId;
    scope = binding.scope;
  }
  const branch = commandResult(git(repoRoot, ["branch", "--show-current"]), "branch").trim();
  const remote = git(repoRoot, ["remote", "get-url", "origin"]);
  if (!branch || remote.status !== 0) fail("PUBLISH_NOT_CONFIGURED", "current branch or origin remote is missing", 1);
  commandResult(git(repoRoot, ["check-ref-format", "--branch", branch]), "branch");
  const remoteValue = String(remote.stdout).trim();
  const value = { operation: "plan-publish", head, branch, remoteDigest: sha256(remoteValue),
    packageId, scope, closureReceipt: options.receipt || null, paths: [] };
  const receiptPath = binding ? writeReceipt(binding, value) : writeGlobalReceipt(repoRoot, value);
  return {
    operation: "plan-publish",
    code: "OWNER_OK_REQUIRED",
    branch,
    remote: remoteValue.replace(/:\/\/[^/@\s]+@/u, "://[credential]@"),
    head,
    receipt: receiptPath,
    next: "Show this exact plan to the Owner. Publish only through the package executor once the Owner says OK in the chat, whose words become the Owner-OK line; raw git push remains blocked.",
  };
}

function publish(options) {
  if (!options.ownerOk) {
    fail("OWNER_OK_REQUIRED", "publish requires the Owner-OK wording of this exact publish plan (--owner-ok TEXT)", 1);
  }
  const snapshot = repository.repositorySnapshot(options.root || process.cwd());
  const resolvedReceipt = path.resolve(snapshot.repoRoot, options.receipt || "");
  const global = repository.isPathInside(globalReceiptDirectory(snapshot.repoRoot), resolvedReceipt);
  let binding = null;
  let source;
  if (global) source = globalReceiptRecord(snapshot.repoRoot, options.receipt, "plan-publish").value;
  else {
    binding = exactBinding(options);
    source = receiptRecord(binding, options.receipt, "plan-publish").value;
  }
  const repoRoot = binding ? binding.repoRoot : snapshot.repoRoot;
  const expectedScope = binding ? binding.scope : source.scope;
  // Die Owner-OK-Zeile fuer publish steht nicht in einer Datei des Repos: ein
  // geschlossenes Paket wird nicht mehr editiert. Sie wird hier aus dem Wortlaut
  // des Owners und dem HEAD DIESES Publish-Plans gebildet und im Beleg gehalten.
  let ownerOk;
  try {
    const line = formatOwnerOkLine({ action: "publish", target: null, date: todayLocal(),
      commit: source.head, wording: String(options.ownerOk) });
    ownerOk = validateOwnerOk(findOwnerOk(line, "publish"),
      { action: "publish", target: null, head: source.head, today: todayLocal() });
  } catch (error) { fail(error.code || "OWNER_OK_INVALID", error.message, error.exitCode || 2); }
  const head = commandResult(git(repoRoot, ["rev-parse", "--verify", "HEAD"]), "head").trim();
  const branch = commandResult(git(repoRoot, ["branch", "--show-current"]), "branch").trim();
  const remote = commandResult(git(repoRoot, ["remote", "get-url", "origin"]), "remote").trim();
  if ((!global && source.head !== binding.headOid) || source.head !== head || source.branch !== branch ||
      source.remoteDigest !== sha256(remote)) {
    fail("PUBLISH_PLAN_STALE", "HEAD, branch or origin changed after the approved publish plan", 1);
  }
  const result = git(repoRoot, ["push", "--porcelain", "origin", "HEAD:refs/heads/" + branch],
    { timeoutMs: 120_000 });
  commandResult(result, "publish");
  const receiptValue = { operation: "publish", head, branch, packageId: source.packageId,
    scope: expectedScope, planReceipt: options.receipt,
    ownerOk: { action: ownerOk.action, target: ownerOk.target, date: ownerOk.date, commit: ownerOk.commit,
      wording: ownerOk.wording, line: ownerOk.line, lineDigest: ownerOk.lineDigest },
    remoteDigest: source.remoteDigest, paths: [] };
  const receiptPath = global ? writeGlobalReceipt(repoRoot, receiptValue) : writeReceipt(binding, receiptValue);
  return { operation: "publish", branch, head, receipt: receiptPath, published: true };
}

export const CANONICAL_INTENTS = Object.freeze([
  { name: "inspect", mutates: false,
    syntax: "inspect --session <sessionId> [--path <ownedPath>]" },
  { name: "checkpoint", mutates: true,
    syntax: "checkpoint --session <sessionId> --message <message> --path <ownedPath>" },
  { name: "unstage", mutates: true,
    syntax: "unstage --session <sessionId> --path <ownedPath>" },
  { name: "discard-working", mutates: true,
    syntax: "discard-working --session <sessionId> --path <exactOwnedFile>" },
  { name: "recover-discard", mutates: true,
    syntax: "recover-discard --session <sessionId> --receipt <discardReceipt>" },
  { name: "revert-checkpoint", mutates: true,
    syntax: "revert-checkpoint --session <sessionId> --receipt <checkpointReceipt>" },
  { name: "integration-checkpoint", mutates: true,
    syntax: "integration-checkpoint --root <repo> --package <packageId> --scope <scope> --message <message> [--expected-result-file <path> --expected-result-digest <sha256>]" },
  { name: "plan-close", mutates: true,
    syntax: "plan-close --root <repo> --package <packageId> --scope <scope>" },
  { name: "closure-checkpoint", mutates: true,
    syntax: "closure-checkpoint --root <repo> --package <packageId> --receipt <closePlanReceipt> --message <message> [--unlazy-root <dir>] [--writeback-receipt <witnessReceipt> ...]" },
  { name: "plan-publish", mutates: true,
    syntax: "plan-publish --root <repo> (--session <sessionId> | --receipt <closureReceipt>)" },
  { name: "publish", mutates: true,
    syntax: "publish --root <repo> --receipt <publishPlanReceipt> --owner-ok <ownerWording> [--session <sessionId>]" },
  { name: "explain", mutates: false,
    syntax: "explain --operation <unsupportedGitOperation>" },
]);

export function canonicalHelp() {
  return [
    "usage: node harness-core/git/git-intent.mjs <intent> [options]",
    "",
    "Canonical Git intents (raw direct or wrapped Git is not an alternative):",
    ...CANONICAL_INTENTS.map((entry) => "  " + entry.syntax),
  ].join("\n") + "\n";
}

export async function runIntent(options) {
  if (options.intent === "inspect") return inspect(options);
  if (options.intent === "checkpoint") return checkpoint(options);
  if (options.intent === "unstage") return unstage(options);
  if (options.intent === "discard-working") return discardWorking(options);
  if (options.intent === "recover-discard") return recoverDiscard(options);
  if (options.intent === "revert-checkpoint") return revertCheckpoint(options);
  if (options.intent === "integration-checkpoint") return integrationCheckpoint(options);
  if (options.intent === "plan-close") return planClose(options);
  if (options.intent === "closure-checkpoint") return closureCheckpoint(options);
  if (options.intent === "plan-publish") return planPublish(options);
  if (options.intent === "publish") return publish(options);
  if (options.intent === "explain") return explain(options);
  fail("USAGE", "intent must be inspect, checkpoint, unstage, discard-working, recover-discard, revert-checkpoint, integration-checkpoint, plan-close, closure-checkpoint, plan-publish, publish, or explain");
}

async function main() {
  try {
    if (process.argv.slice(2).some((value) => value === "--help" || value === "-h")) {
      process.stdout.write(canonicalHelp());
      return;
    }
    const options = parseArgs(process.argv.slice(2));
    const result = await runIntent(options);
    process.stdout.write("GIT_INTENT_OK " + JSON.stringify(result) + "\n");
  } catch (error) {
    process.stderr.write("GIT_INTENT_" + (error.code || "FAILED") + ": " + error.message + "\n");
    process.exitCode = error.exitCode || 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main();
}
