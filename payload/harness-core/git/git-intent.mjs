#!/usr/bin/env node

// Finite Git operation surface. Agents choose an intent, never a raw mutating
// Git command. Every mutation is bound to one session leaf and emits a receipt.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { readExecutionReceipt } from "../execution/owner-approval.mjs";

const require = createRequire(import.meta.url);
const repository = require("../binding/repository.cjs");
const packageBinding = require("../binding/package-binding.cjs");
const ownerContract = require("../binding/owner-contract.cjs");
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;

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
    fail("GIT_ACCEPTED_RESULT_STAGE_FAILED", detail, 1);
  }
  return result.stdout || Buffer.alloc(0);
}

function parseArgs(argv) {
  const values = { paths: [] };
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
    else if (option === "--approval-receipt") values.approvalReceipt = args.shift();
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

function checkpoint(options) {
  const binding = exactBinding(options);
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

function assertIntegrationTree(context, tree, paths, constraint) {
  const changed = parseZeroList(commandResult(git(context.snapshot.repoRoot,
    integrationTreePathArgs(tree, context.state.integration.headBefore)),
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
    if (currentHead(context.binding) !== context.state.integration.commit) {
      fail("INTEGRATION_STALE", "HEAD moved after the integration checkpoint", 1);
    }
    assertCommittedResultBlob(context, context.state.integration.commit, resultConstraint);
    return integrationReceipt(context, context.state.integration.commit, context.state.integration.paths, true);
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
      assertIntegrationTree(context, expectedTree, context.state.integration.paths, resultConstraint);
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
      assertIntegrationTree(context, preparedTree, context.state.integration.paths, resultConstraint);
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

function packageFiles(repoRoot, packageId) {
  const packageDir = path.join(repoRoot, "docs", "packages", packageId);
  if (!fs.existsSync(packageDir) || !fs.lstatSync(packageDir).isDirectory() || fs.lstatSync(packageDir).isSymbolicLink()) {
    fail("CLOSE_PACKAGE", "package directory is missing or unsafe");
  }
  const records = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) fail("CLOSE_PACKAGE", "package bundle contains a symbolic link");
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) {
        const relative = path.relative(repoRoot, absolute).replaceAll("\\", "/");
        records.push({ relative, digest: sha256(fs.readFileSync(absolute)) });
      } else fail("CLOSE_PACKAGE", "package bundle contains a non-regular entry");
    }
  };
  walk(packageDir);
  return records.sort((left, right) => left.relative.localeCompare(right.relative, "en"));
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

function closureCheckpoint(options) {
  const snapshot = repository.repositorySnapshot(options.root || process.cwd());
  const packageId = identifier(options.packageId, "package");
  const source = globalReceiptRecord(snapshot.repoRoot, options.receipt, "plan-close").value;
  if (source.packageId !== packageId || source.head !== snapshot.headOid) {
    fail("CLOSE_PLAN_STALE", "package or HEAD changed after the close plan", 1);
  }
  const message = String(options.message || "").trim();
  if (!message || message.length > 200 || /[\r\n\0]/u.test(message)) {
    fail("USAGE", "--message must be one line of 1..200 characters");
  }
  const packageDir = path.join(snapshot.repoRoot, "docs", "packages", packageId);
  const packageFile = path.join(packageDir, "PACKAGE.md");
  const packageText = fs.readFileSync(packageFile, "utf8");
  if (!/^Fulfillment:\s*(?:erfuellt|fulfilled)\b/imu.test(packageText) ||
      !/^Offen:\s*(?:nichts|nothing|none)\s*$/imu.test(packageText)) {
    fail("CLOSE_NOT_FINAL", "PACKAGE.md does not carry a closed Fulfillment/Offen claim", 1);
  }
  if (sha256(normalizedClosure(packageText)) !== source.normalizedPackageDigest) {
    fail("CLOSE_WRITEBACK", "package close changed content outside the four closure fields", 1);
  }
  const currentFiles = packageFiles(snapshot.repoRoot, packageId);
  if (JSON.stringify(currentFiles.map((item) => item.relative)) !== JSON.stringify(source.files.map((item) => item.relative))) {
    fail("CLOSE_WRITEBACK", "package file set changed during close", 1);
  }
  const beforeByFile = new Map(source.files.map((item) => [item.relative, item.digest]));
  for (const current of currentFiles) {
    if (current.relative !== "docs/packages/" + packageId + "/PACKAGE.md" &&
        beforeByFile.get(current.relative) !== current.digest) {
      fail("CLOSE_WRITEBACK", "package close changed non-PACKAGE metadata: " + current.relative, 1);
    }
  }
  const contractIds = [...packageText.matchAll(/^- (C\d+) -> /gmu)].map((match) => match[1]);
  const owner = ownerContract.inspectOwnerContract(snapshot.repoRoot, packageDir, packageId, contractIds);
  if (!owner.complete || owner.digest !== source.ownerDigest || owner.requestDigest !== source.ownerRequestDigest) {
    fail("CLOSE_OWNER", "Owner contract changed during close", 1);
  }
  for (const item of currentFiles.filter((entry) => /(?:^|\/)GATES\.md$|\/gates\/[^/]+\.md$/u.test(entry.relative))) {
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
  commandResult(git(snapshot.repoRoot, ["add", "--", ...paths]), "closure-stage");
  const committed = git(snapshot.repoRoot, ["commit", "-m", message, "--", ...paths], { timeoutMs: 120_000 });
  if (committed.status !== 0) {
    git(snapshot.repoRoot, ["reset", "--", ...paths]);
    commandResult(committed, "closure-commit");
  }
  const commit = commandResult(git(snapshot.repoRoot, ["rev-parse", "--verify", "HEAD"]), "closure-head").trim();
  const receipt = writeGlobalReceipt(snapshot.repoRoot, { operation: "closure-checkpoint", packageId,
    scope: source.scope,
    headBefore: source.head, head: commit, commit, paths, planReceipt: options.receipt });
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
    code: "OWNER_APPROVAL_REQUIRED",
    branch,
    remote: remoteValue.replace(/:\/\/[^/@\s]+@/u, "://[credential]@"),
    head,
    receipt: receiptPath,
    next: "Show this exact plan to the Owner. Publish only through the package executor after it consumes an external Owner approval artifact; raw git push remains blocked.",
  };
}

function publish(options) {
  if (!options.approvalReceipt) {
    fail("OWNER_APPROVAL_REQUIRED", "publish requires a consumed, one-time --approval-receipt from package execution", 1);
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
  let approval;
  try {
    approval = readExecutionReceipt(repoRoot, options.approvalReceipt, "owner-approval-consumption");
  } catch (error) {
    fail(error.code || "OWNER_APPROVAL_RECEIPT", error.message, error.exitCode || 2);
  }
  const expectedScope = binding ? binding.scope : source.scope;
  const approvedPlan = path.resolve(repoRoot, String(approval.value.subject?.planReceipt || ""));
  const actualPlan = path.resolve(repoRoot, options.receipt || "");
  if (approval.value.action !== "publish" || approval.value.packageId !== source.packageId ||
      approval.value.scope !== expectedScope || !repository.samePath(approvedPlan, actualPlan) ||
      approval.value.subject?.head !== source.head || approval.value.subject?.branch !== source.branch ||
      (source.closureReceipt || null) !== (approval.value.subject?.closureReceipt || null)) {
    fail("OWNER_APPROVAL_MISMATCH", "approval receipt does not bind this exact publish plan", 1);
  }
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
    scope: expectedScope, planReceipt: options.receipt, approvalReceipt: approval.file,
    approvalDigest: approval.value.approvalDigest, remoteDigest: source.remoteDigest, paths: [] };
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
    syntax: "closure-checkpoint --root <repo> --package <packageId> --receipt <closePlanReceipt> --message <message>" },
  { name: "plan-publish", mutates: true,
    syntax: "plan-publish --root <repo> (--session <sessionId> | --receipt <closureReceipt>)" },
  { name: "publish", mutates: true,
    syntax: "publish --root <repo> --receipt <publishPlanReceipt> --approval-receipt <consumedApprovalReceipt> [--session <sessionId>]" },
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
