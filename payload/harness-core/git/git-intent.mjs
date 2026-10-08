#!/usr/bin/env node

// Finite Git operation surface. Agents choose an intent, never a raw mutating
// Git command. Every mutation is bound to one session leaf and emits a receipt.
//
// Package P3 added: release-stale-lock (an orphaned, empty, old index.lock of an own repository),
// publish for the project repositories the Owner lists in publishProjects (no closed package, only the
// current branch to origin as a fast-forward), proof-note-write and proof-notes-sync (review notes of ref
// keel-proof). Commit texts travel in a file and have no length limit. Short Git questions keep their
// 30 s protection; long Git operations (commit, revert, commit-tree, push, fetch, notes merge) run through
// the Unlazy silence watcher and end only when they are really hung, never after a fixed time.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readExecutionReceipt, validateImmutableRecord } from "../execution/execution-receipts.mjs";
import {
  findOwnerOk,
  formatOwnerOkLine,
  ownerWordingFolders,
  readOwnerWordingFile,
  readTextFromFolders,
  todayLocal,
  validateOwnerOk,
} from "../execution/owner-ok.mjs";

const require = createRequire(import.meta.url);
// P20, D14: the real git.exe (no cmd\git.exe wrapper process) and --no-optional-locks on reading calls.
const gitBinary = require("./git-binary.cjs");
const here = path.dirname(fileURLToPath(import.meta.url));
const repository = require("../binding/repository.cjs");
const packageBinding = require("../binding/package-binding.cjs");
const ownerContract = require("../binding/owner-contract.cjs");
const hookContext = require("../guards/hook-context.cjs");
const publishProjects = require("../guards/publish-projects.cjs");
const sessionScope = require("../guards/session-scope.cjs");
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;

// ONE resolver for the Unlazy tree lives in harness-core/binding/unlazy-runtime.cjs
// and is re-exported here under the same names: the gate parser below, the gate
// RUNNER in package-executor.mjs (it imports locateUnlazy from here) and the
// CommonJS package bootstrap all see exactly the same candidates and boundary.
const unlazyRuntime = require("../binding/unlazy-runtime.cjs");
const bundleFiles = require("../binding/bundle-files.cjs");

export function unlazyRootCandidates(repoRoot, explicit) {
  return unlazyRuntime.unlazyRootCandidates(repoRoot, explicit);
}

export function locateUnlazy(repoRoot, explicit) {
  return unlazyRuntime.locateUnlazy(repoRoot, explicit);
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

// Inherited repository redirections are always dropped; a caller may set one on purpose (P8: the held integration
// commit is built in a temporary GIT_INDEX_FILE, so the shared index is never touched).
function cleanGitEnv(extra = {}) {
  const env = { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" };
  for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY"]) {
    delete env[name];
  }
  return { ...env, ...extra };
}

// Short queries keep their protection: one Git question must not hang the caller (concept 3.6,
// "Schutz einzelner Git-Abfragen"; it ends no work). Long operations never use this function, they
// go through gitWatched below, which has no fixed time.
function git(repoRoot, args, options = {}) {
  const result = gitBinary.gitSync(["-C", repoRoot, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    windowsHide: true,
    timeout: options.timeoutMs || 30_000,
    env: cleanGitEnv(options.env),
  }, { executable: options.gitExecutable });
  if (result.error) fail("GIT_EXECUTION_FAILED", result.error.message);
  result.repoRoot = repoRoot;
  return result;
}

// The silence watcher of the vendored Unlazy tree (P01), loaded lazily like the gate parser: a
// top-level import would break every intent when the tree sits somewhere unusual. The Harness
// tree's own runtime is the single candidate (harnessRuntime); an Unlazy tree without the module
// is an installation error, never a reason to fall back to a fixed time.
let silenceWatchModule = null;

export async function loadSilenceWatch() {
  if (silenceWatchModule) return silenceWatchModule;
  const runtime = unlazyRuntime.harnessRuntime();
  const file = runtime ? path.join(runtime, "scripts", "lib", "silence-watch.mjs") : null;
  if (!file || !fs.existsSync(file)) {
    fail("SILENCE_WATCH_MISSING", "the Unlazy silence watcher (scripts/lib/silence-watch.mjs) is not installed next to the Harness; update the Harness");
  }
  const module = await import(pathToFileURL(fs.realpathSync(file)).href);
  if (typeof module.runWatched !== "function") fail("SILENCE_WATCH_MISSING", "silence-watch.mjs exports no runWatched");
  silenceWatchModule = module;
  return module;
}

// A long Git operation (commit, revert, commit-tree, push, fetch, notes merge): no fixed time, no
// output cap. It is declared hung only by silence (silence-watch.mjs). The result has the shape of a
// spawnSync result, so commandResult and the callers read it unchanged.
async function gitWatched(repoRoot, args, options = {}) {
  const { runWatched } = await loadSilenceWatch();
  const startedAt = Date.now();
  const watched = () => runWatched(options.gitExecutable || gitBinary.gitExecutable(), gitBinary.readGitArgs(["-C", repoRoot, ...args]), {
    cwd: repoRoot,
    env: cleanGitEnv(options.env),
    ...(options.silenceMs !== undefined ? { silenceMs: options.silenceMs } : {}),
    ...(options.sampleMs !== undefined ? { sampleMs: options.sampleMs } : {}),
  });
  let result = await watched();
  // A found git.exe that cannot be started at all (removed meanwhile): plain "git" once, never a failure for that reason alone.
  if (result.spawnError && !options.gitExecutable && gitBinary.gitExecutable() !== "git") {
    gitBinary.forgetGitExecutable();
    result = await watched();
  }
  if (result.spawnError) fail("GIT_EXECUTION_FAILED", String(result.spawnError));
  if (result.hung) {
    const lockRelease = releaseLockOfHungOperation(repoRoot, startedAt, options);
    const error = new Error("git " + String(args[0] || "") + " made no progress (" + String(result.hungReason || "silent") +
      "); it was stopped as hung, not for taking long; " + lockRelease.message +
      (lockRelease.lockRemains ? staleLockHint({ repoRoot, stderr: "index.lock" }) : ""));
    error.code = "GIT_HUNG";
    error.exitCode = 1;
    error.lockRelease = lockRelease;
    throw error;
  }
  return { status: result.code === null ? 1 : result.code, signal: result.signal, stdout: result.stdout,
    stderr: result.stderr, repoRoot };
}

// Who works in a repository right now? Used only to decide whether the index.lock of a stopped
// operation may be removed. { checked, blocking, unknown }: blocking = Git processes whose working
// folder is the repository or lies in it; unknown = Git processes whose working folder cannot be
// read. Whatever cannot be read counts against removal.
const GIT_PROCESS_NAME = /^git(?:-[\w.-]+)?(?:\.exe)?$/iu;

// Windows has no call for the working folder of another process; it is read from the process
// environment block (PEB) of each Git process of the same user. 64-bit targets only; every failure
// yields "?" (unknown), which keeps the lock.
const WINDOWS_CWD_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "Add-Type -TypeDefinition @'",
  "using System; using System.Runtime.InteropServices; using System.Text;",
  "public static class KeelProcCwd {",
  "  [StructLayout(LayoutKind.Sequential)] struct PBI { public IntPtr Exit; public IntPtr Peb; public IntPtr Aff; public IntPtr Prio; public IntPtr Pid; public IntPtr Parent; }",
  "  [DllImport(\"ntdll.dll\")] static extern int NtQueryInformationProcess(IntPtr h, int cls, ref PBI info, int len, out int ret);",
  "  [DllImport(\"kernel32.dll\")] static extern IntPtr OpenProcess(int access, bool inherit, int pid);",
  "  [DllImport(\"kernel32.dll\")] static extern bool ReadProcessMemory(IntPtr h, IntPtr addr, byte[] buf, int size, out IntPtr read);",
  "  [DllImport(\"kernel32.dll\")] static extern bool IsWow64Process(IntPtr h, out bool wow);",
  "  [DllImport(\"kernel32.dll\")] static extern bool CloseHandle(IntPtr h);",
  "  public static string Get(int pid) {",
  "    if (IntPtr.Size != 8) return null;",
  "    IntPtr h = OpenProcess(0x0410, false, pid);",
  "    if (h == IntPtr.Zero) return null;",
  "    try {",
  "      bool wow; if (!IsWow64Process(h, out wow) || wow) return null;",
  "      PBI pbi = new PBI(); int ret; IntPtr n;",
  "      if (NtQueryInformationProcess(h, 0, ref pbi, Marshal.SizeOf(pbi), out ret) != 0) return null;",
  "      byte[] b = new byte[8];",
  "      if (!ReadProcessMemory(h, IntPtr.Add(pbi.Peb, 0x20), b, 8, out n)) return null;",
  "      IntPtr pp = (IntPtr)BitConverter.ToInt64(b, 0);",
  "      byte[] us = new byte[16];",
  "      if (!ReadProcessMemory(h, IntPtr.Add(pp, 0x38), us, 16, out n)) return null;",
  "      int len = BitConverter.ToUInt16(us, 0); IntPtr buf = (IntPtr)BitConverter.ToInt64(us, 8);",
  "      if (len <= 0) return null;",
  "      byte[] str = new byte[len];",
  "      if (!ReadProcessMemory(h, buf, str, len, out n)) return null;",
  "      return Encoding.Unicode.GetString(str);",
  "    } finally { CloseHandle(h); }",
  "  }",
  "}",
  "'@",
  "foreach ($p in [System.Diagnostics.Process]::GetProcesses()) {",
  "  if ($p.ProcessName -like 'git*') {",
  "    $c = [KeelProcCwd]::Get($p.Id)",
  "    if ($c) { '' + $p.Id + [char]9 + $c; continue }",
  "    $ended = $false; try { $p.Refresh(); $ended = $p.HasExited } catch { $ended = $false }",
  "    if (-not $ended) { '' + $p.Id + [char]9 + '?' }",
  "  }",
  "}",
].join("\n");

function gitProcessWorkingFolders() {
  if (process.platform === "win32") {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "keel-git-cwd-"));
    try {
      const script = path.join(directory, "git-working-folders.ps1");
      fs.writeFileSync(script, WINDOWS_CWD_SCRIPT, "utf8");
      const run = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script], {
        encoding: "utf8", windowsHide: true, timeout: 30_000 });
      if (run.error || run.status !== 0) return null;
      return String(run.stdout || "").split(/\r?\n/u).filter(Boolean).map((line) => {
        const [pid, folder] = line.split("\t");
        return { pid: Number(pid), folder: folder === "?" ? null : folder };
      });
    } finally {
      fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  }
  const listing = spawnSync("ps", ["-A", "-o", "pid=,comm="], { encoding: "utf8", timeout: 30_000 });
  if (listing.error || listing.status !== 0) return null;
  const found = [];
  for (const line of String(listing.stdout || "").split(/\r?\n/u)) {
    const match = /^\s*(\d+)\s+(.+)$/u.exec(line);
    if (!match || !GIT_PROCESS_NAME.test(path.basename(match[2].trim()))) continue;
    const pid = Number(match[1]);
    let folder = null;
    if (process.platform === "linux") {
      try { folder = fs.readlinkSync("/proc/" + pid + "/cwd"); } catch { folder = null; }
    } else if (process.platform === "darwin") {
      const probe = spawnSync("lsof", ["-a", "-d", "cwd", "-p", String(pid), "-Fn"], { encoding: "utf8", timeout: 30_000 });
      const hit = probe.status === 0 ? /^n(.+)$/mu.exec(String(probe.stdout || "")) : null;
      folder = hit ? hit[1] : null;
    }
    found.push({ pid, folder });
  }
  return found;
}

export function gitProcessesInRepository(repoRoot, options = {}) {
  const listed = (options.listGitProcesses || gitProcessWorkingFolders)();
  if (!Array.isArray(listed)) return { checked: false, blocking: [], unknown: [] };
  const blocking = [];
  const unknown = [];
  for (const entry of listed) {
    if (!entry.folder) unknown.push(entry.pid);
    else if (repository.samePath(entry.folder, repoRoot) || repository.isPathInside(repoRoot, entry.folder)) blocking.push(entry.pid);
  }
  return { checked: true, blocking, unknown };
}

// Decision of the Orchestrator (review of P3): when git-intent stopped its own Git operation as hung,
// the index.lock it leaves behind is removed again if (1) the lock was written after this operation
// started (so it is the operation's own, not an older orphan) and (2) no other Git process works in this
// repository, as far as that can be read. When in doubt it stays and the result says why. The intent
// release-stale-lock keeps its own, stricter rule (0 bytes, older than five minutes).
const LOCK_CLOCK_TOLERANCE_MS = 50; // coarse file-time resolution: a lock may look a few ms older than the start

export function releaseLockOfHungOperation(repoRoot, startedAt, options = {}) {
  const stays = (message, lockRemains = true) => ({ removed: false, lockRemains, message });
  let lockFile;
  try { lockFile = path.join(repository.repositorySnapshot(repoRoot).gitDir, "index.lock"); }
  catch (error) { return stays("index.lock not checked (" + error.message + ")", false); }
  let info;
  try { info = fs.lstatSync(lockFile); }
  catch { return stays("no index.lock remained", false); }
  if (info.isSymbolicLink() || !info.isFile()) return stays("index.lock stays: it is not a regular file");
  if (info.mtimeMs < startedAt - LOCK_CLOCK_TOLERANCE_MS) {
    return stays("index.lock stays: it is older than this operation and does not come from it");
  }
  let processes;
  try { processes = gitProcessesInRepository(repoRoot, options); }
  catch { processes = { checked: false, blocking: [], unknown: [] }; }
  if (!processes.checked) return stays("index.lock stays: the running Git processes could not be listed");
  if (processes.blocking.length) {
    return stays("index.lock stays: another Git process works in this repository (pid " + processes.blocking.join(", ") + ")");
  }
  if (processes.unknown.length) {
    return stays("index.lock stays: the working folder of Git process " + processes.unknown.join(", ") + " cannot be read");
  }
  try {
    const again = fs.lstatSync(lockFile);
    if (again.ino !== info.ino || again.mtimeMs !== info.mtimeMs || again.size !== info.size) {
      return stays("index.lock stays: it changed while it was checked");
    }
    fs.unlinkSync(lockFile);
  } catch (error) { return stays("index.lock stays: " + error.message); }
  return { removed: true, lockRemains: false, lock: lockFile,
    message: "the index.lock it left behind (" + info.size + " bytes, written after the operation started, no other Git process in this repository) was removed" };
}

function gitBytes(repoRoot, args, options = {}) {
  const result = gitBinary.gitSync(["-C", repoRoot, ...args], {
    cwd: repoRoot,
    encoding: null,
    windowsHide: true,
    timeout: options.timeoutMs || 30_000,
    env: cleanGitEnv(options.env),
  }, { executable: options.gitExecutable });
  if (result.error) fail("GIT_EXECUTION_FAILED", result.error.message);
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || "").trim().split(/\r?\n/u)[0] || "exit " + result.status;
    fail(options.failCode || "GIT_ACCEPTED_RESULT_STAGE_FAILED", detail, 1);
  }
  return result.stdout || Buffer.alloc(0);
}

function parseArgs(argv) {
  const values = { paths: [], writebackReceipts: [], packageIds: [] };
  const args = [...argv];
  values.intent = args.shift() || "";
  while (args.length) {
    const option = args.shift();
    if (option === "--root") values.root = args.shift();
    else if (option === "--session") values.sessionId = args.shift();
    else if (option === "--package") {
      // Every --package is collected; packageId stays the first value so every
      // intent except the checkpoint bundle mode reads exactly what it read before.
      values.packageIds.push(args.shift());
      if (values.packageIds.length === 1) values.packageId = values.packageIds[0];
    }
    else if (option === "--scope") values.scope = args.shift();
    else if (option === "--message") values.message = args.shift();
    else if (option === "--message-file") values.messageFile = args.shift();
    else if (option === "--owner-ok-file") values.ownerOkFile = args.shift();
    else if (option === "--expected-result-file") values.expectedResultFile = args.shift();
    else if (option === "--expected-result-digest") values.expectedResultDigest = args.shift();
    else if (option === "--path") values.paths.push(args.shift());
    else if (option === "--operation") values.operation = args.shift();
    else if (option === "--rev") values.rev = args.shift();
    else if (option === "--receipt") values.receipt = args.shift();
    else if (option === "--owner-ok") values.ownerOk = args.shift();
    else if (option === "--unlazy-root") values.unlazyRoot = args.shift();
    else if (option === "--commit") values.commit = args.shift();
    else if (option === "--file") values.file = args.shift();
    else if (option === "--writeback-receipt") values.writebackReceipts.push(args.shift());
    else if (option === "--json") values.json = true;
    else if (option === "--hold") values.hold = true;
    else if (option === "--advance") values.advance = args.shift();
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

// A failure on index.lock names the one agent route for an orphaned lock (A12): the lock of a
// running Git process is never removed, an empty old lock of an own repository is.
function staleLockHint(result) {
  if (!result || !result.repoRoot || !/index\.lock/u.test(String(result.stderr || ""))) return "";
  return "; if no Git process is running, release the orphaned lock: node " +
    path.join(here, "git-intent.mjs") + " release-stale-lock --root " + result.repoRoot;
}

function commandResult(result, operation) {
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || "").trim().split(/\r?\n/u)[0] || "exit " + result.status;
    fail("GIT_" + operation.toUpperCase() + "_FAILED", detail + staleLockHint(result), 1);
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

// The read half of the finite Git surface. During an active package the guard
// redirects EVERY raw Git command -- read-only status/log/diff/show included --
// to this one intent (git-intent-guard.js), so the contract sentence "raw
// MUTATING Git is locked" (CLAUDE.md) only holds if the read intent actually
// serves those reads; without them a bound agent had no route to `git log/diff/
// show` at all (audit 06.09.2026 line 380). Every operation stays strictly
// read-only and is constrained to the bound leaf OWNS paths, so a read can never
// widen past the session's own surface. An optional --rev is resolved to a
// committed OID BEFORE use, so it can neither inject a Git option nor reach a path
// outside the "-- <ownedPaths>" limiter (the `<rev>:<path>` form is never built).
// Proven by "inspect serves read-only log, diff and show for owned paths" in
// test/git-intent.test.js.
const READ_OPERATIONS = new Set(["status", "log", "diff", "show"]);

function resolveReadRev(repoRoot, rev) {
  const text = String(rev);
  if (!/^[0-9A-Za-z][0-9A-Za-z._/~^-]{0,127}$/u.test(text)) fail("USAGE", "--rev must be a plain commit-ish");
  const resolved = git(repoRoot, ["rev-parse", "--verify", "--quiet", text + "^{commit}"]);
  if (resolved.status !== 0) fail("INSPECT_REV", "--rev does not resolve to a commit: " + text, 1);
  return String(resolved.stdout).trim();
}

function inspect(options) {
  const binding = exactBinding(options);
  const paths = options.paths.length ? authorizedPaths(binding, options.paths) : binding.owns;
  const operation = String(options.operation || "status");
  if (!READ_OPERATIONS.has(operation)) {
    fail("USAGE", "inspect --operation must be one of status, log, diff, show");
  }
  if (operation === "status") {
    const status = commandResult(git(binding.repoRoot, ["status", "--porcelain=v2", "--branch", "--", ...paths]), "inspect");
    return { operation: "inspect", read: "status", packageId: binding.packageId, scope: binding.scope,
      leaf: binding.leaf, head: binding.headOid, paths, status: status.split(/\r?\n/u).filter(Boolean) };
  }
  const base = options.rev ? resolveReadRev(binding.repoRoot, options.rev) : binding.headOid;
  let args;
  if (operation === "log") {
    args = ["log", "--max-count", "50", "--pretty=format:%H %ad %s", "--date=iso-strict",
      ...(base ? [base] : []), "--", ...paths];
  } else if (operation === "diff") {
    args = ["diff", ...(base ? [base] : []), "--", ...paths];
  } else {
    if (!base) fail("INSPECT_REV", "show needs at least one commit; the repository is unborn", 1);
    args = ["show", base, "--", ...paths];
  }
  const output = commandResult(git(binding.repoRoot, args), "inspect");
  return { operation: "inspect", read: operation, packageId: binding.packageId, scope: binding.scope,
    leaf: binding.leaf, head: binding.headOid, rev: base || null, paths, output: output.split(/\r?\n/u) };
}

async function unstage(options) {
  const binding = exactBinding(options);
  const paths = authorizedPaths(binding, options.paths);
  let result = await gitWatched(binding.repoRoot, ["restore", "--staged", "--", ...paths]);
  if (result.status !== 0 && binding.headOid === null) {
    result = await gitWatched(binding.repoRoot, ["rm", "--cached", "-r", "--ignore-unmatch", "--", ...paths]);
  }
  commandResult(result, "unstage");
  const receiptPath = writeReceipt(binding, { operation: "unstage", head: binding.headOid || "unborn", paths });
  return { operation: "unstage", paths, receipt: receiptPath };
}

// Fund 377 (triage 09.09.2026): when the session that staged paths disappears its
// binding file is gone, so the session-bound unstage intent above can never clear
// them and every checkpoint stays refused with SHARED_INDEX_DIRTY -- a dead end,
// because raw Git is blocked and no other session may unstage a path it does not
// own. This is the package/scope-authorized recovery for exactly that shared-index
// orphan. It authorizes a staged path against the WHOLE package surface (every
// leaf OWNS of the bundle plus docs/packages/<id>/**), never a single session, so
// a vanished leaf's paths stay recoverable. It stays session-locked: a staged path
// a LIVE session binding still owns is refused (that session runs unstage itself),
// and any staged path outside this package's surface is refused (another owner's
// decision). It only unstages -- the working tree is preserved. Unreadable binding
// state fails closed, so recovery never unstages while blind to a possibly-live
// claim. Proven by "recover-index clears staged paths of a disappeared session"
// and its guard test in test/git-intent.test.js.
function packageAuthorizedPatterns(repoRoot, packageId) {
  const patterns = new Set(["docs/packages/" + packageId + "/**"]);
  const gatesDir = path.join(repoRoot, "docs", "packages", packageId, "gates");
  let entries = [];
  try { entries = fs.readdirSync(gatesDir, { withFileTypes: true }); } catch { /* a package may ship no leaf ledgers */ }
  for (const entry of entries) {
    if (!entry.isFile() || !/^leaf-[A-Za-z0-9][A-Za-z0-9._-]{0,58}\.md$/u.test(entry.name)) continue;
    let owns;
    try { owns = packageBinding.leafOwnsFromText(fs.readFileSync(path.join(gatesDir, entry.name), "utf8")); }
    catch { continue; }
    for (const pattern of owns) patterns.add(pattern);
  }
  return [...patterns];
}

function liveSessionOwners(repoRoot) {
  const runtime = path.join(repoRoot, ".unlazy");
  const owners = [];
  let scopes = [];
  try { scopes = fs.readdirSync(runtime, { withFileTypes: true }); } catch { return owners; }
  for (const scope of scopes) {
    if (!scope.isDirectory() || scope.name === "locks" || scope.name.startsWith(".")) continue;
    const directory = path.join(runtime, scope.name, "bindings");
    let files = [];
    try { files = fs.readdirSync(directory, { withFileTypes: true }); } catch { continue; }
    for (const file of files) {
      if (!file.isFile() || !/^[a-f0-9]{64}\.json$/u.test(file.name)) continue;
      const relative = path.relative(repoRoot, path.join(directory, file.name)).replaceAll("\\", "/");
      let value;
      try { value = JSON.parse(fs.readFileSync(path.join(directory, file.name), "utf8")); }
      catch { fail("RECOVERY_STATE_UNREADABLE", "a session binding is unreadable; recovery cannot prove staged paths are orphaned: " + relative); }
      if (!value || value.schemaVersion !== 1 || !Array.isArray(value.owns)) {
        fail("RECOVERY_STATE_UNREADABLE", "a session binding is invalid; recovery cannot prove staged paths are orphaned: " + relative);
      }
      owners.push({ sessionId: value.sessionId, owns: value.owns.map((pattern) => packageBinding.globRegex(pattern)) });
    }
  }
  return owners;
}

async function recoverIndex(options) {
  const snapshot = repository.repositorySnapshot(options.root || process.cwd());
  const packageId = identifier(options.packageId, "package");
  const scope = identifier(options.scope || packageId, "scope");
  const refFile = path.join(snapshot.repoRoot, ".unlazy", scope, "package.ref");
  if (!fs.existsSync(refFile) || fs.readFileSync(refFile, "utf8") !== "docs/packages/" + packageId + "\n") {
    fail("RECOVERY_BINDING", "scope does not bind the requested package");
  }
  const staged = parseZeroList(commandResult(git(snapshot.repoRoot,
    ["diff", "--cached", "--name-only", "-z"]), "recover-preflight"));
  if (!staged.length) fail("NOTHING_TO_RECOVER", "the shared index contains no staged paths", 1);
  const authorized = packageAuthorizedPatterns(snapshot.repoRoot, packageId).map((pattern) => packageBinding.globRegex(pattern));
  const owners = liveSessionOwners(snapshot.repoRoot);
  const foreign = [];
  const held = [];
  const recoverable = [];
  for (const relative of staged) {
    if (!authorized.some((pattern) => pattern.test(relative))) { foreign.push(relative); continue; }
    const owner = owners.find((entry) => entry.owns.some((pattern) => pattern.test(relative)));
    if (owner) { held.push(relative + " (" + owner.sessionId + ")"); continue; }
    recoverable.push(relative);
  }
  if (foreign.length) {
    fail("RECOVERY_OUT_OF_SCOPE", "staged paths are outside the authorized surface of package " + packageId +
      "; recovery cannot authorize them: " + foreign.join(", "), 1);
  }
  if (held.length) {
    fail("RECOVERY_SESSION_LIVE", "staged paths are still owned by a live session that must unstage them itself: " +
      held.join(", "), 1);
  }
  recoverable.sort((left, right) => left.localeCompare(right, "en"));
  let result = await gitWatched(snapshot.repoRoot, ["restore", "--staged", "--", ...recoverable]);
  if (result.status !== 0 && snapshot.headOid === null) {
    result = await gitWatched(snapshot.repoRoot, ["rm", "--cached", "-r", "--ignore-unmatch", "--", ...recoverable]);
  }
  commandResult(result, "recover-index");
  const binding = { repoRoot: snapshot.repoRoot, packageId, scope, sessionId: "recovery", leaf: "recovery",
    headOid: snapshot.headOid };
  const receiptPath = writeReceipt(binding, { operation: "recover-index", head: snapshot.headOid || "unborn", paths: recoverable });
  return { operation: "recover-index", paths: recoverable, receipt: receiptPath };
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
    // A null leaf (the bundle checkpoint) is held by every open or sealed wave of the scope.
    if (binding.leaf !== null && (!Array.isArray(wave.leaves) || !wave.leaves.includes(binding.leaf))) continue;
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

// D13: a commit text has no length limit. It must not be empty and must not contain a NUL character;
// several lines are fine. It always travels in a file (git commit -F, git commit-tree -F), never in
// -m, so neither its length, nor a line break, nor the Windows command line limit can bend it, and
// --cleanup=verbatim keeps every byte (no comment stripping, no blank line folding).
function commitMessage(value) {
  const message = String(value === undefined || value === null ? "" : value).trim();
  if (!message || message.includes("\0")) fail("USAGE", "--message must not be empty and must not contain a NUL character");
  return message;
}

async function withMessageFile(message, run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "keel-commit-message-"));
  const file = path.join(directory, "message.txt");
  try {
    fs.writeFileSync(file, message + "\n", { encoding: "utf8", flag: "wx" });
    return await run(file);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}

// Commits the staged paths. Whatever ends the commit -- a failed Git run or a stop of a hung one -- puts
// exactly those paths back out of the index, so a refused checkpoint never leaves the shared index dirty.
async function commitPaths(repoRoot, message, paths) {
  let committed;
  try {
    committed = await withMessageFile(message, (file) =>
      gitWatched(repoRoot, ["commit", "-F", file, "--cleanup=verbatim", "--", ...paths]));
  } catch (error) {
    // The paths go back out of the index. When that is not possible (a lock that stays, a failed reset) the
    // error says so, so nobody finds staged paths without being told.
    let unstaged = "";
    try {
      const reset = git(repoRoot, ["reset", "--", ...paths]);
      if (reset.status !== 0) unstaged = String(reset.stderr || reset.stdout || "git reset failed").trim().split(/\r?\n/u)[0];
    } catch (resetError) { unstaged = resetError.message; }
    if (unstaged) {
      error.message += "; the paths are STILL STAGED (" + unstaged + "); run the unstage intent for them once the lock is gone";
      error.pathsStillStaged = true;
    }
    throw error;
  }
  if (committed.status !== 0) {
    git(repoRoot, ["reset", "--", ...paths]);
    commandResult(committed, "commit");
  }
  return committed;
}

async function checkpoint(options) {
  const packageIds = requestedPackageIds(options);
  if (packageIds.length && (options.sessionId || (options.paths && options.paths.length))) {
    fail("USAGE", "checkpoint takes either --session <sessionId> --path <ownedPath> (leaf checkpoint) or --root <repo> --package <packageId> (bundle checkpoint), never both");
  }
  if (!options.sessionId && !packageIds.length) {
    fail("USAGE", "checkpoint requires --session <sessionId> --path <ownedPath> (leaf checkpoint) or --root <repo> --package <packageId> (bundle checkpoint of a written, not started package)");
  }
  if (!options.sessionId) return bundleCheckpoint(options, packageIds);
  const binding = exactBinding(options);
  assertLeafOutsideWave(binding);
  const paths = authorizedPaths(binding, options.paths);
  const message = commitMessage(options.message);

  const staged = commandResult(git(binding.repoRoot, ["diff", "--cached", "--name-only", "-z"]), "preflight");
  if (staged.length) {
    fail("SHARED_INDEX_DIRTY", "checkpoint refused: Git index already contains staged paths; the owning session must run the unstage intent, or run the recover-index intent (package/scope authorized) when that session is gone");
  }
  const changed = commandResult(git(binding.repoRoot, ["status", "--porcelain=v1", "-z", "--", ...paths]), "preflight");
  if (!changed.length) fail("NOTHING_TO_CHECKPOINT", "none of the bound paths changed", 1);

  commandResult(await gitWatched(binding.repoRoot, ["add", "--", ...paths]), "stage");
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
  await commitPaths(binding.repoRoot, message, paths);
  const after = commandResult(git(binding.repoRoot, ["rev-parse", "--verify", "HEAD"]), "head").trim();
  if (!after || after === before) fail("GIT_COMMIT_FAILED", "checkpoint did not advance HEAD");
  const refreshed = packageBinding.createBinding({ root: binding.repoRoot, packageId: binding.packageId,
    scope: binding.scope, sessionId: binding.sessionId, leaf: binding.leaf,
    controlRoot: binding.controlRoot || undefined });
  const receiptPath = writeReceipt(refreshed, { operation: "checkpoint", headBefore: before,
    head: after, commit: after, message, paths: committedPaths });
  return { operation: "checkpoint", commit: after, paths: committedPaths, receipt: receiptPath };
}

function requestedPackageIds(options) {
  if (Array.isArray(options.packageIds) && options.packageIds.length) return options.packageIds;
  return options.packageId ? [options.packageId] : [];
}

// Owner 01.10.2026: "Ein geschriebenes, noch nicht gestartetes Paket laesst sich
// ueber die Git-Schnittstelle des Harness sichern." Before this mode the leaf
// checkpoint above saved only leaf OWNS of a bound session and the package
// directory reached Git only through the closure checkpoint, so a freshly
// written package had no route at all. This mode saves exactly the bundle files
// (bundle-files.cjs) of packages no scope has started, never design/, evidence/
// or anything else, and needs no session: only sessions paket-gate admits could
// write those files in the first place. Proven by "the checkpoint bundle mode
// saves exactly the bundle files of a written, not started package" in
// test/git-intent.test.js.
function assertBundleDirectory(repoRoot, relative) {
  let info;
  try { info = fs.lstatSync(path.join(repoRoot, ...relative.split("/"))); }
  catch { fail("BUNDLE_PACKAGE", "package bundle directory is missing: " + relative); }
  if (info.isSymbolicLink() || !info.isDirectory()) fail("BUNDLE_PACKAGE", "package bundle directory must be a real directory: " + relative);
}

function bundleFilePresent(repoRoot, relative, required) {
  let info;
  try { info = fs.lstatSync(path.join(repoRoot, ...relative.split("/"))); }
  catch {
    if (required) fail("BUNDLE_PACKAGE", "package bundle file is missing: " + relative);
    return false;
  }
  if (info.isSymbolicLink() || !info.isFile()) fail("BUNDLE_PACKAGE", "package bundle file must be a regular file: " + relative);
  return true;
}

function runtimeScopes(repoRoot) {
  let entries = [];
  try { entries = fs.readdirSync(path.join(repoRoot, ".unlazy"), { withFileTypes: true }); } catch { return []; }
  return entries.filter((entry) => entry.isDirectory() && entry.name !== "locks" && !entry.name.startsWith("."))
    .map((entry) => entry.name).sort((left, right) => left.localeCompare(right, "en"));
}

function assertPackageNotStarted(repoRoot, packageId) {
  for (const scope of runtimeScopes(repoRoot)) {
    let text;
    try { text = fs.readFileSync(path.join(repoRoot, ".unlazy", scope, "package.ref"), "utf8"); } catch { continue; }
    if (text === "docs/packages/" + packageId + "\n") {
      fail("PACKAGE_STARTED", "package " + packageId + " is already started in scope " + scope +
        "; use the leaf checkpoint (--session) or package-executor integrate", 1);
    }
  }
}

function assertNoWaveInProgress(repoRoot) {
  for (const scope of runtimeScopes(repoRoot)) {
    const wave = waveInProgressFor({ repoRoot, scope, leaf: null });
    if (!wave) continue;
    fail("WAVE_IN_PROGRESS", "checkpoint refused: scope " + scope + " has wave " + wave.waveId + " (" + wave.state +
      "); nothing is committed mid-wave -- the parent integrates every verified disjoint path once", 1);
  }
}

// Bundle files present in the working tree plus tracked bundle files of HEAD, so a
// deleted ledger is saved as a deletion. With an unborn HEAD only the tree counts.
function bundlePaths(repoRoot, packageId, headOid) {
  const prefix = "docs/packages/" + packageId + "/";
  const pattern = bundleFiles.bundleFilePattern(packageId);
  const paths = new Set();
  for (const name of ["OWNER.md", "PACKAGE.md", "GATES.md"]) {
    bundleFilePresent(repoRoot, prefix + name, true);
    paths.add(prefix + name);
  }
  const gatesDir = path.join(repoRoot, "docs", "packages", packageId, "gates");
  let gatesPresent = false;
  try { fs.lstatSync(gatesDir); gatesPresent = true; } catch { /* a package may ship no leaf ledgers */ }
  if (gatesPresent) {
    assertBundleDirectory(repoRoot, prefix + "gates");
    for (const entry of fs.readdirSync(gatesDir)) {
      const relative = prefix + "gates/" + entry;
      if (pattern.test(relative) && bundleFilePresent(repoRoot, relative, false)) paths.add(relative);
    }
  }
  if (headOid) {
    const tracked = parseZeroList(commandResult(git(repoRoot,
      ["ls-tree", "-r", "--name-only", "-z", "HEAD", "--", prefix]), "bundle-tracked"));
    for (const relative of tracked) if (pattern.test(relative)) paths.add(relative);
  }
  return [...paths];
}

async function bundleCheckpoint(options, requested) {
  const packages = requested.map((value) => identifier(value, "package"));
  if (new Set(packages).size !== packages.length) fail("USAGE", "each --package may be named only once");
  const message = commitMessage(options.message);
  const snapshot = repository.repositorySnapshot(options.root || process.cwd());
  const repoRoot = snapshot.repoRoot;
  const headBefore = snapshot.headOid || null;

  const collected = new Set();
  for (const packageId of packages) {
    assertBundleDirectory(repoRoot, "docs/packages/" + packageId);
    for (const relative of bundlePaths(repoRoot, packageId, headBefore)) collected.add(relative);
  }
  const paths = [...collected].sort((left, right) => left.localeCompare(right, "en"));
  for (const packageId of packages) assertPackageNotStarted(repoRoot, packageId);
  assertNoWaveInProgress(repoRoot);

  const staged = commandResult(git(repoRoot, ["diff", "--cached", "--name-only", "-z"]), "preflight");
  if (staged.length) {
    fail("SHARED_INDEX_DIRTY", "checkpoint refused: Git index already contains staged paths; the owning session must run the unstage intent, or run the recover-index intent (package/scope authorized) when that session is gone");
  }
  const changed = commandResult(git(repoRoot, ["status", "--porcelain=v1", "-z", "--", ...paths]), "preflight");
  if (!changed.length) fail("NOTHING_TO_CHECKPOINT", "none of the package bundle files changed", 1);

  commandResult(await gitWatched(repoRoot, ["add", "--", ...paths]), "stage");
  const committedPaths = parseZeroList(commandResult(git(repoRoot,
    ["diff", "--cached", "--name-only", "-z", "--", ...paths]), "checkpoint-paths"))
    .sort((left, right) => left.localeCompare(right, "en"));
  if (!committedPaths.length) {
    git(repoRoot, ["reset", "--", ...paths]);
    fail("NOTHING_TO_CHECKPOINT", "package bundle files produced no staged change", 1);
  }
  const outside = committedPaths.filter((relative) => !collected.has(relative));
  if (outside.length) {
    git(repoRoot, ["reset", "--", ...paths]);
    fail("BUNDLE_SCOPE", "staged paths are outside the package bundle files: " + outside.join(", "));
  }

  await commitPaths(repoRoot, message, paths);
  const head = commandResult(git(repoRoot, ["rev-parse", "--verify", "HEAD"]), "head").trim();
  if (!head || head === headBefore) fail("GIT_COMMIT_FAILED", "checkpoint did not advance HEAD");
  const receipt = writeGlobalReceipt(repoRoot, { operation: "bundle-checkpoint", packages,
    paths: committedPaths, headBefore, head, commit: head, message });
  return { operation: "bundle-checkpoint", packages, commit: head, paths: committedPaths, receipt };
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

async function discardWorking(options) {
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
      if (record.tracked) commandResult(await gitWatched(binding.repoRoot,
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

async function revertCheckpoint(options) {
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
  const reverted = await gitWatched(binding.repoRoot, ["revert", "--no-edit", source.commit]);
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

// The sessions an integration counts. A session that was replaced (reassigned or reopened) and has a successor is
// history, not open work: the executor moves it there itself, and an older state that still holds it in `sessions` is
// read the same way here, as a second safeguard (P13, E4c). Without a recorded successor it still counts as open.
export function integrationSessions(state) {
  const known = (sessionId) => Boolean(sessionId && (state.sessions?.[sessionId] || state.history?.sessions?.[sessionId]));
  return Object.values(state.sessions || {}).filter((entry) =>
    !(["reassigned", "reopened"].includes(entry?.state) && known(entry.replacedBy)));
}

// A leaf session that was prepared and never ran an agent (no run, no wave, no earlier attempt that ran one): the calling
// session built the leaf itself, or nobody did yet. It is no open execution (Owner 07.10.2026: close judges the result, not
// the way). The executor uses the same definition for its close.
export function neverRan(entry) {
  return entry?.state === "prepared" && !entry.runId && !entry.wave && !entry.failedRunId &&
    !(Array.isArray(entry.attempts) && entry.attempts.some((attempt) => attempt?.runId));
}

// The calling session of integrate, close and plan-close: the bound package session of a worker, else the host session.
export function callingSession(env = process.env) {
  const value = String(env?.KEEL_PACKAGE_SESSION || env?.CLAUDE_CODE_SESSION_ID || "").trim();
  return value || null;
}

// Nachpruefung 07.10.2026 (6): a never-run session is idle only while no session other than the calling one holds a living
// binding on its leaf; such a binding (the step prepared by start --session included) is somebody who may still be
// building, so the session counts as open execution. The one rule of session-scope.cjs livingBinding decides, the same the
// guards use for the orchestrator's fix right and for Git maintenance. where: { repoRoot, harnessRoot, scope, caller }.
export function heldByOtherSession(entry, where) {
  const leaf = String(entry?.leaf || "").replace(/^gates\//u, "").replace(/\.md$/u, "");
  if (!leaf || !where?.repoRoot) return null;
  return sessionScope.livingBinding(where.repoRoot, { harnessRoot: where.harnessRoot || null,
    exceptSession: where.caller || null, scope: where.scope || null, leaf });
}

export function idleSession(entry, where) {
  return neverRan(entry) && !heldByOtherSession(entry, where);
}

// `allowIdle` (plan-close only): a package whose sessions all never ran an agent and that has no integration is judged by
// its gates at HEAD alone; there is no integration checkpoint to wait for. Mixed leaves (Pruefung 07.10.2026): a session
// that never ran is no open execution in integrate and plan-close either, exactly like in the executor's assertCloseReady;
// it is neither required to be verified nor counted in the integration's OWNS, and close proves its gates at HEAD.
function integrationContext(options, { allowIdle = false } = {}) {
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
  const counted = integrationSessions(state);
  const where = { repoRoot: snapshot.repoRoot, harnessRoot: state.harnessRoot || null, scope, caller: callingSession() };
  const sessions = counted.filter((entry) => !idleSession(entry, where));
  const idle = allowIdle && counted.length > 0 && !state.integration && !sessions.length;
  if (!idle && (!sessions.length || sessions.some((entry) => entry.state !== "verified"))) {
    const held = sessions.filter((entry) => neverRan(entry)).map((entry) => entry.sessionId + " (living binding of " +
      (heldByOtherSession(entry, where)?.sessionId || "?") + ")");
    fail("INTEGRATION_SESSIONS", "all bound leaf sessions must be locally verified before integration" +
      (held.length ? "; never ran but bound by another session than the calling one: " + held.join(", ") : ""), 1);
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
  return { snapshot, packageId, scope, stateFile, state, patterns, binding, idle };
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

// The commit text comes from a file (-F), never from the command line (D13).
export function integrationCommitTreeArgs(tree, headBefore, messageFile) {
  const parentArgs = headBefore ? ["-p", headBefore] : [];
  return ["commit-tree", tree, ...parentArgs, "-F", messageFile];
}

export function integrationUpdateRefArgs(commit, headBefore) {
  const expectedOld = headBefore || "0".repeat(String(commit).length);
  return ["update-ref", "HEAD", commit, expectedOld];
}

// P8 (B2): the integration commit exists before the branch moves. --hold builds the commit object of the exact
// integration path set in a temporary index (write-tree, commit-tree) and records it as a HELD prepared integration:
// no branch, no shared index and no working-tree file changes. The executor checks that object (gate-check --at) and
// only a green result moves the branch, through --advance <commit>. A held commit is advanced by nothing else: any
// other call drops it and starts over, so a red check never leaves an integrated-looking branch behind.
async function holdIntegrationCommit(context, resultConstraint, message, paths) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "keel-integration-index-"));
  const env = { GIT_INDEX_FILE: path.join(directory, "index") };
  try {
    const headBefore = context.snapshot.headOid || null;
    commandResult(git(context.snapshot.repoRoot, headBefore ? ["read-tree", headBefore] : ["read-tree", "--empty"], { env }),
      "integration-hold-index");
    context.state.integration = { state: "prepared", held: true, headBefore: context.snapshot.headOid, message, paths,
      preparedAt: new Date().toISOString(), expectedResultFile: resultConstraint?.file,
      expectedResultDigest: resultConstraint?.digest };
    atomicJson(context.stateFile, context.state);
    commandResult(await gitWatched(context.snapshot.repoRoot, ["add", "--", ...paths], { env }), "integration-hold-stage");
    if (resultConstraint) {
      context.state.integration.expectedResultBlob = commandResult(git(context.snapshot.repoRoot,
        ["rev-parse", "--verify", ":" + resultConstraint.file], { env }), "accepted-result-stage").trim();
      const stagedDigest = sha256(gitBytes(context.snapshot.repoRoot,
        ["cat-file", "blob", context.state.integration.expectedResultBlob]));
      if (stagedDigest !== resultConstraint.digest) {
        fail("ACCEPTED_RESULT_CHANGED", "staged result blob differs from the semantically accepted result", 1);
      }
    }
    const tree = commandResult(git(context.snapshot.repoRoot, ["write-tree"], { env }), "integration-tree").trim();
    assertIntegrationTree(context, tree, paths, resultConstraint);
    context.state.integration.expectedTree = tree;
    atomicJson(context.stateFile, context.state);
    const commit = commandResult(await withMessageFile(message, (file) => gitWatched(context.snapshot.repoRoot,
      integrationCommitTreeArgs(tree, context.state.integration.headBefore, file))), "integration-commit").trim();
    context.state.integration.expectedCommit = commit;
    atomicJson(context.stateFile, context.state);
    return { operation: "integration-checkpoint", held: true, commit, tree, paths,
      headBefore: context.state.integration.headBefore, acceptedResultDigest: resultConstraint?.digest };
  } catch (error) {
    context.state.integration = null;
    atomicJson(context.stateFile, context.state);
    throw error;
  } finally {
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}

// --advance <commit>: the one way a held integration commit reaches the branch, after its check was green. HEAD must
// still be the base the commit was built on, and the commit must still be exactly the recorded tree and path set.
// The shared index then follows the new HEAD for exactly the integrated paths (their working-tree bytes are the
// committed ones), and no working-tree file is written.
function advanceHeldIntegration(context, options, resultConstraint) {
  const integration = context.state.integration;
  const wanted = String(options.advance || "");
  if (!integration || integration.state !== "prepared" || integration.held !== true || !integration.expectedCommit ||
      integration.expectedCommit !== wanted) {
    fail("INTEGRATION_ADVANCE", "--advance names no held integration commit of this scope; integrate again", 1);
  }
  if (currentHead(context.binding) !== integration.headBefore) {
    fail("INTEGRATION_STALE", "HEAD moved while the held integration commit was checked; the branch was not moved, integrate again", 1);
  }
  const tree = commandResult(git(context.snapshot.repoRoot,
    ["rev-parse", "--verify", wanted + "^{tree}"]), "integration-advance").trim();
  if (tree !== integration.expectedTree) fail("INTEGRATION_RECOVERY", "held integration commit no longer resolves to its exact tree", 1);
  assertIntegrationTree(context, tree, integration.paths, resultConstraint, wanted);
  assertCommittedResultBlob(context, wanted, resultConstraint);
  const index = git(context.snapshot.repoRoot, ["diff", "--cached", "--quiet"]);
  if (index.status === 1) fail("SHARED_INDEX_DIRTY", "integration refused: Git index contains staged paths");
  if (index.status !== 0) commandResult(index, "integration-advance");
  commandResult(git(context.snapshot.repoRoot, integrationUpdateRefArgs(wanted, integration.headBefore)), "integration-head");
  const { held, ...rest } = integration;
  context.state.integration = { ...rest, state: "committed", commit: wanted, committedAt: new Date().toISOString(),
    recovered: false };
  atomicJson(context.stateFile, context.state);
  // The branch is moved and recorded; a failing index refresh leaves the integrated paths looking staged-backwards in
  // `git status`, never a second commit, and the receipt says so.
  const synced = git(context.snapshot.repoRoot, ["reset", "-q", "--", ...integration.paths]);
  const receipt = integrationReceipt(context, wanted, integration.paths, false);
  return synced.status === 0 ? receipt : { ...receipt, indexSynced: false };
}

async function integrationCheckpoint(options) {
  const context = integrationContext(options);
  let resultConstraint = boundIntegrationResult(context, options);
  const message = commitMessage(options.message);
  if (options.hold && options.advance) fail("USAGE", "--hold and --advance are mutually exclusive");
  if (options.advance) return advanceHeldIntegration(context, options, resultConstraint);
  // A held commit never moves the branch except through --advance: any other call drops it. Nothing of it was
  // staged in the shared index, so dropping is only forgetting the record.
  if (context.state.integration?.state === "prepared" && context.state.integration.held === true) {
    context.state.integration = null;
    atomicJson(context.stateFile, context.state);
    resultConstraint = boundIntegrationResult(context, options);
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
    // With --hold an older prepared commit on the unchanged base is never advanced unchecked: it is dropped below
    // (its staged paths leave the shared index) and the held commit is built anew.
    if (!options.hold && context.state.integration.expectedCommit && context.state.integration.expectedTree) {
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
  if (options.hold) return holdIntegrationCommit(context, resultConstraint, message, paths);
  context.state.integration = { state: "prepared", headBefore: context.snapshot.headOid, message, paths,
    preparedAt: new Date().toISOString(), expectedResultFile: resultConstraint?.file,
    expectedResultDigest: resultConstraint?.digest };
  atomicJson(context.stateFile, context.state);
  commandResult(await gitWatched(context.snapshot.repoRoot, ["add", "--", ...paths]), "integration-stage");
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
  const commit = commandResult(await withMessageFile(message, (file) => gitWatched(context.snapshot.repoRoot,
    integrationCommitTreeArgs(tree, context.state.integration.headBefore, file))),
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
//
// There is exactly one such normalization: normalizeLedgerText of the vendored Unlazy
// (scripts/lib/ledger-normalize.cjs), which the proof store (scripts/lib/proof-store.mjs)
// imports to key the stored check results (P7b). It is loaded lazily, like the gate parser,
// from the runtime next to this Harness tree. It is CommonJS, so the plain require of
// createRequire loads it on every supported Node (a synchronous require of an ES module
// would need Node 20.19 or 22.12).
let ledgerNormalizeModule = null;

export function loadLedgerNormalize() {
  if (ledgerNormalizeModule) return ledgerNormalizeModule;
  const runtime = unlazyRuntime.harnessRuntime();
  const file = runtime ? path.join(runtime, "scripts", "lib", "ledger-normalize.cjs") : null;
  if (!file || !fs.existsSync(file)) {
    fail("LEDGER_NORMALIZE_MISSING", "the Unlazy ledger normalization (scripts/lib/ledger-normalize.cjs) is not installed next to the Harness; update the Harness");
  }
  const module = require(fs.realpathSync(file));
  if (typeof module.normalizeLedgerText !== "function" || typeof module.PROOF_ENTRY_SCHEMA !== "string" ||
    typeof module.PROOF_SCHEMA !== "string") {
    fail("LEDGER_NORMALIZE_MISSING", "ledger-normalize.cjs exports no normalizeLedgerText or proof schema names");
  }
  ledgerNormalizeModule = module;
  return module;
}

export function normalizedLedger(value) {
  return loadLedgerNormalize().normalizeLedgerText(value);
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

// Commits, die NACH dem Integrations-Checkpoint auf HEAD liegen, sperren den Abschluss
// nicht mehr grundsaetzlich (Owner-Rueckbau 08.09.2026: Integration am 07.09., danach
// veroeffentlichte Rueckbau-Commits, weder integrate noch close waren moeglich). Erlaubt
// sind sie genau dann, wenn der Checkpoint ein Vorfahr von HEAD ist und jeder Commit
// seither von origin/main erreichbar ist -- derselbe Owner-Veroeffentlichungs-Proxy wie
// in checks/reference-boundary.mjs. Der Abschluss prueft dann auf HEAD voll nach (die
// Wiederverwendung der Integrations-Nachpruefung gilt nur bei HEAD == Checkpoint), und
// die Owner-OK-Zeile bindet HEAD. Der Beleg nennt die Commits seit dem Checkpoint.
function publishedCommitsSinceIntegration(context, integrationCommit, head) {
  const repoRoot = context.snapshot.repoRoot;
  const ancestor = git(repoRoot, ["merge-base", "--is-ancestor", integrationCommit, head]);
  if (ancestor.status !== 0) {
    fail("INTEGRATION_REQUIRED", "package close requires the integration checkpoint to be an ancestor of HEAD", 1);
  }
  const originMain = git(repoRoot, ["rev-parse", "--verify", "--quiet", "refs/remotes/origin/main"]);
  if (originMain.status !== 0) {
    fail("INTEGRATION_REQUIRED", "commits after the integration checkpoint need origin/main to prove Owner publication; none is present", 1);
  }
  const unpublished = commandResult(git(repoRoot, ["rev-list", "refs/remotes/origin/main.." + head]), "close-plan-origin").trim();
  if (unpublished) {
    fail("INTEGRATION_REQUIRED", "commits after the integration checkpoint are not reachable from origin/main: " +
      unpublished.split(/\r?\n/u).length + " unpublished; publish them first", 1);
  }
  return commandResult(git(repoRoot, ["rev-list", integrationCommit + ".." + head]), "close-plan-since")
    .trim().split(/\r?\n/u).filter(Boolean);
}

function planClose(options) {
  const context = integrationContext(options, { allowIdle: true });
  if (!context.idle && context.state.integration?.state !== "committed") {
    fail("INTEGRATION_REQUIRED", "package close requires a committed integration checkpoint", 1);
  }
  const integrationCommit = context.idle ? null : context.state.integration.commit;
  const head = currentHead(context.binding);
  const publishedSince = integrationCommit === null || head === integrationCommit ? []
    : publishedCommitsSinceIntegration(context, integrationCommit, head);
  const packageFile = path.join(context.snapshot.repoRoot, "docs", "packages", context.packageId, "PACKAGE.md");
  const packageText = fs.readFileSync(packageFile, "utf8");
  const files = packageFiles(context.snapshot.repoRoot, context.packageId);
  const receipt = writeGlobalReceipt(context.snapshot.repoRoot, {
    operation: "plan-close",
    packageId: context.packageId,
    scope: context.scope,
    head,
    integrationCommit,
    publishedSince,
    ownerDigest: context.state.originalOwnerDigest,
    ownerRequestDigest: context.state.originalOwnerRequestDigest,
    normalizedPackageDigest: sha256(normalizedClosure(packageText)),
    files,
  });
  return { operation: "plan-close", packageId: context.packageId, scope: context.scope,
    head, integrationCommit, publishedSince, receipt };
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
  const message = commitMessage(options.message);
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
  commandResult(await gitWatched(snapshot.repoRoot, ["add", "--", ...paths]), "closure-stage");
  let commit;
  try {
    const tree = commandResult(git(snapshot.repoRoot, ["write-tree"]), "closure-tree").trim();
    const changed = parseZeroList(commandResult(git(snapshot.repoRoot,
      integrationTreePathArgs(tree, snapshot.headOid)), "closure-tree"));
    if (!samePathSet(changed, paths)) {
      fail("CLOSE_PATHS_CHANGED", "closure tree contains paths outside the exact package metadata set", 1);
    }
    commit = commandResult(await withMessageFile(message, (file) => gitWatched(snapshot.repoRoot,
      integrationCommitTreeArgs(tree, snapshot.headOid, file))), "closure-commit").trim();
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

// The rule root of this session: the Harness root whose rules apply (KEEL_HARNESS_ROOT, then
// CLAUDE_PROJECT_DIR, as every guard reads it) and, without both, the Harness tree this file ships
// in -- never the working directory, which for a worker is the very repository to be judged. An
// agent cannot move it: KEEL_* and CLAUDE_* overrides are blocked in front of every command
// (shell-mutation-guard ENVIRONMENT_OVERRIDE). options.ruleRoot exists for in-process callers.
const harnessTree = path.resolve(here, "..", "..");

function sessionRuleRoot(options = {}) {
  const explicit = options && options.ruleRoot ? String(options.ruleRoot) : null;
  return path.resolve(explicit || hookContext.ruleRoot(process.env, harnessTree));
}

// A repository is the session's own when it is the rule root itself or lies below it, the same test
// package-amend applies to its --root (package-amend.cjs begin).
function ownRepository(repoRoot, options) {
  const root = sessionRuleRoot(options);
  return repository.samePath(root, repoRoot) || repository.isPathInside(root, repoRoot);
}

// A12: release an orphaned index.lock of an own repository. Three conditions, all of them: the file
// is 0 bytes, it is older than five minutes (mtime), and the repository is the session's own. A lock
// with content, a younger lock or a foreign repository is refused with the reasons and nothing is
// deleted: the lock of a running Git process must never be taken away.
const STALE_LOCK_MIN_AGE_MS = 5 * 60 * 1000;

function releaseStaleLock(options) {
  if (!options.root) fail("USAGE", "release-stale-lock requires --root <repo>");
  const snapshot = repository.repositorySnapshot(options.root);
  const lockFile = path.join(snapshot.gitDir, "index.lock");
  let info;
  try { info = fs.lstatSync(lockFile); }
  catch { fail("NO_STALE_LOCK", "there is no index.lock in " + snapshot.gitDir + "; nothing to release", 1); }
  const reasons = [];
  if (info.isSymbolicLink() || !info.isFile()) reasons.push("index.lock is not a regular file");
  if (info.size !== 0) reasons.push("index.lock has content (" + info.size + " bytes): a running Git process holds it");
  const ageMs = Date.now() - info.mtimeMs;
  if (ageMs <= STALE_LOCK_MIN_AGE_MS) {
    reasons.push("index.lock is younger than 5 minutes (" + Math.max(0, Math.round(ageMs / 1000)) + " s): a Git process may still be running");
  }
  if (!ownRepository(snapshot.repoRoot, options)) {
    reasons.push("repository " + snapshot.repoRoot + " is not the session's own (rule root " + sessionRuleRoot(options) + ")");
  }
  if (reasons.length) fail("STALE_LOCK_REFUSED", "index.lock is not released: " + reasons.join("; "), 1);
  // The file may have been replaced by a live holder between the check and now: the same file or none.
  const again = fs.lstatSync(lockFile);
  if (again.size !== 0 || again.mtimeMs !== info.mtimeMs || again.ino !== info.ino) {
    fail("STALE_LOCK_REFUSED", "index.lock changed while it was checked; a Git process is working", 1);
  }
  fs.unlinkSync(lockFile);
  return { operation: "release-stale-lock", repoRoot: snapshot.repoRoot, lock: lockFile, ageSeconds: Math.round(ageMs / 1000),
    released: true };
}

// E1: the Owner's general OK for a project is one entry of publishProjects in
// .claude/mutation-policy.json (agents never write that file, write-guard W4). Returns the entry as a
// relative path when repoRoot is listed, else null; an invalid policy is fail-closed.
function listedPublishProject(repoRoot, options) {
  const root = sessionRuleRoot(options);
  const loaded = publishProjects.loadPublishProjects(root);
  if (loaded.error) {
    fail("PUBLISH_POLICY_INVALID", ".claude/mutation-policy.json is invalid: " + loaded.error +
      "; only the Owner repairs the policy file", 1);
  }
  const hit = loaded.projects.find((project) => repository.samePath(project, repoRoot));
  return hit ? path.relative(root, hit).split(path.sep).join("/") : null;
}

function notListedMessage(repoRoot) {
  return "repository " + repoRoot + " is not in publishProjects of .claude/mutation-policy.json (the Owner's list of projects that may be " +
    "published without a closed package). Publish it the package way: close the package, let the Owner say OK in the chat, then " +
    "package-executor publish --root <repo> --package <packageId> --scope <scope> --closure-receipt <closureReceipt> --owner-ok <ownerWording>";
}

function planPublish(options) {
  let repoRoot;
  let head;
  let binding = null;
  let packageId = null;
  let scope = null;
  let project = null;
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
  } else if (options.sessionId) {
    binding = exactBinding(options);
    repoRoot = binding.repoRoot;
    head = binding.headOid;
    packageId = binding.packageId;
    scope = binding.scope;
  } else {
    // E1: no session and no closure receipt -- allowed for a project the Owner listed.
    const snapshot = repository.repositorySnapshot(options.root || process.cwd());
    project = listedPublishProject(snapshot.repoRoot, options);
    if (!project) fail("PUBLISH_PROJECT_NOT_LISTED", notListedMessage(snapshot.repoRoot), 1);
    repoRoot = snapshot.repoRoot;
    head = snapshot.headOid;
    if (!head) fail("PUBLISH_NOT_CONFIGURED", "the repository has no commit to publish", 1);
  }
  const branch = commandResult(git(repoRoot, ["branch", "--show-current"]), "branch").trim();
  const remote = git(repoRoot, ["remote", "get-url", "origin"]);
  if (!branch || remote.status !== 0) fail("PUBLISH_NOT_CONFIGURED", "current branch or origin remote is missing", 1);
  commandResult(git(repoRoot, ["check-ref-format", "--branch", branch]), "branch");
  const remoteValue = String(remote.stdout).trim();
  // The push goes to the push URL when one is configured: it is part of the plan, so a later
  // redirection of the push target makes the plan stale.
  const pushRemote = git(repoRoot, ["remote", "get-url", "--push", "origin"]);
  const pushValue = pushRemote.status === 0 ? String(pushRemote.stdout).trim() : null;
  const value = { operation: "plan-publish", head, branch, remoteDigest: sha256(remoteValue),
    ...(pushValue !== null ? { pushDigest: sha256(pushValue) } : {}),
    packageId, scope, closureReceipt: options.receipt || null, ...(project ? { projectPublish: project } : {}), paths: [] };
  const receiptPath = binding ? writeReceipt(binding, value) : writeGlobalReceipt(repoRoot, value);
  const shown = remoteValue.replace(/:\/\/[^/@\s]+@/u, "://[credential]@");
  if (project) {
    return {
      operation: "plan-publish",
      code: "PUBLISH_READY",
      project,
      branch,
      remote: shown,
      head,
      receipt: receiptPath,
      next: "No Owner-OK is needed: " + project + " is in publishProjects. Publish with: node " + path.join(here, "git-intent.mjs") +
        " publish --root " + repoRoot + " --receipt " + receiptPath +
        ". Only the current branch goes to origin, as a fast-forward; never a force push.",
    };
  }
  return {
    operation: "plan-publish",
    code: "OWNER_OK_REQUIRED",
    branch,
    remote: shown,
    head,
    receipt: receiptPath,
    next: "Show this exact plan to the Owner. Publish only through the package executor once the Owner says OK in the chat, whose words become the Owner-OK line; raw git push remains blocked.",
  };
}

// The one push of this Harness: the current branch to origin, nothing else, never forced. Git itself
// refuses a push that is not a fast-forward; that refusal is named, with the way out. The user's push
// settings must not widen it: push.followTags would send tags and push.recurseSubmodules would push
// submodule repositories, so both are switched off on the command line (the command line wins).
async function pushCurrentBranch(repoRoot, branch) {
  const result = await gitWatched(repoRoot, ["push", "--porcelain", "--no-follow-tags", "--recurse-submodules=no",
    "origin", "HEAD:refs/heads/" + branch]);
  if (result.status !== 0) {
    const text = String(result.stdout || "") + "\n" + String(result.stderr || "");
    if (/\[rejected\]|non-fast-forward|fetch first|stale info/iu.test(text)) {
      fail("PUBLISH_NOT_FAST_FORWARD", "origin has commits that " + branch + " does not contain, so this push would not be a fast-forward and " +
        "this Harness never forces. Fetch and merge origin/" + branch + " into " + branch + " first (the Owner can do it with git pull in the project, " +
        "or report it under Offen:), then run plan-publish again", 1);
    }
    commandResult(result, "publish");
  }
  return result;
}

// A project plan (E1) read from the global receipts, or null. Never throws: whatever is not a valid
// project plan falls through to the Owner-OK path with its own errors.
function projectPublishPlan(options) {
  try {
    const snapshot = repository.repositorySnapshot(options.root || process.cwd());
    const resolved = path.resolve(snapshot.repoRoot, options.receipt || "");
    if (!options.receipt || !repository.isPathInside(globalReceiptDirectory(snapshot.repoRoot), resolved)) return null;
    const source = globalReceiptRecord(snapshot.repoRoot, options.receipt, "plan-publish").value;
    return source.projectPublish ? { snapshot, source } : null;
  } catch { return null; }
}

async function publishProject(options, plan) {
  const { snapshot, source } = plan;
  const repoRoot = snapshot.repoRoot;
  const project = listedPublishProject(repoRoot, options);
  if (!project || project !== source.projectPublish) {
    fail("PUBLISH_PROJECT_NOT_LISTED", notListedMessage(repoRoot), 1);
  }
  const head = commandResult(git(repoRoot, ["rev-parse", "--verify", "HEAD"]), "head").trim();
  const branch = commandResult(git(repoRoot, ["branch", "--show-current"]), "branch").trim();
  const remote = commandResult(git(repoRoot, ["remote", "get-url", "origin"]), "remote").trim();
  const pushRemote = git(repoRoot, ["remote", "get-url", "--push", "origin"]);
  const pushDigest = pushRemote.status === 0 ? sha256(String(pushRemote.stdout).trim()) : null;
  if (source.head !== head || source.branch !== branch || source.remoteDigest !== sha256(remote) ||
      (source.pushDigest || null) !== pushDigest) {
    fail("PUBLISH_PLAN_STALE", "HEAD, branch or origin changed after the publish plan; run plan-publish again", 1);
  }
  commandResult(git(repoRoot, ["check-ref-format", "--branch", branch]), "branch");
  await pushCurrentBranch(repoRoot, branch);
  const receiptPath = writeGlobalReceipt(repoRoot, { operation: "publish", head, branch, packageId: null, scope: null,
    planReceipt: options.receipt, projectPublish: project, ownerOk: null, remoteDigest: source.remoteDigest, paths: [] });
  return { operation: "publish", project, branch, head, receipt: receiptPath, published: true };
}

async function publish(options) {
  const projectPlan = projectPublishPlan(options);
  if (projectPlan) return publishProject(options, projectPlan);
  if (!options.ownerOk) {
    fail("OWNER_OK_REQUIRED", "publish requires the Owner-OK wording of this exact publish plan (--owner-ok TEXT or --owner-ok-file FILE)", 1);
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
  await pushCurrentBranch(repoRoot, branch);
  const receiptValue = { operation: "publish", head, branch, packageId: source.packageId,
    scope: expectedScope, planReceipt: options.receipt,
    ownerOk: { action: ownerOk.action, target: ownerOk.target, date: ownerOk.date, commit: ownerOk.commit,
      wording: ownerOk.wording, line: ownerOk.line, lineDigest: ownerOk.lineDigest },
    remoteDigest: source.remoteDigest, paths: [] };
  const receiptPath = global ? writeGlobalReceipt(repoRoot, receiptValue) : writeReceipt(binding, receiptValue);
  return { operation: "publish", branch, head, receipt: receiptPath, published: true };
}

// Review notes (package P7b): results of verified checks live as Git notes of ref keel-proof, written
// only through these two intents. The honest limit (concept 3.1): agents run under the Owner's
// Windows account, so someone who writes check code on purpose can forge a note; the shell guard
// therefore does not additionally close proof-note-write, it only says that the Harness itself calls it.
const PROOF_NOTES_REF = "keel-proof";

// The JSON of a note may come only from the Harness's own temp or run folders: a run folder
// .unlazy of the repository or of the rule root, or the proof temp folder of the system temp folder.
function proofFolders(repoRoot, options) {
  return [path.join(repoRoot, ".unlazy"), path.join(sessionRuleRoot(options), ".unlazy"), path.join(os.tmpdir(), "keel-proof")];
}

function proofNoteSource(repoRoot, options) {
  if (!options.file) fail("USAGE", "proof-note-write requires --file <json>");
  const file = path.resolve(String(options.file));
  let info;
  try { info = fs.lstatSync(file); }
  catch { fail("PROOF_NOTE_FILE", "note file does not exist: " + file, 1); }
  if (info.isSymbolicLink() || !info.isFile() || (typeof info.nlink === "number" && info.nlink !== 1)) {
    fail("PROOF_NOTE_FILE", "note file must be a single-link regular file", 1);
  }
  const folders = proofFolders(repoRoot, options);
  if (!folders.some((folder) => repository.isPathInside(folder, fs.realpathSync(file)))) {
    fail("PROOF_NOTE_LOCATION", "note file must lie in the Harness temp or run folder (" + folders.join(", ") + ")", 1);
  }
  const text = fs.readFileSync(file, "utf8");
  // Two forms: one JSON document of schema keel-proof.v1 (old), or one compact JSON entry per
  // line, each of schema keel-proof.v2-entry (what the proof store writes; lines survive the
  // cat_sort_uniq merge of proof-notes-sync). Both schema names are the proof store's own.
  const { PROOF_SCHEMA, PROOF_ENTRY_SCHEMA: entrySchema } = loadLedgerNormalize();
  const objectWith = (value, schema) => value && typeof value === "object" && !Array.isArray(value) && value.schema === schema;
  let value;
  try { value = JSON.parse(text); }
  catch {
    const lines = text.split(/\r?\n/u).filter((line) => line.trim());
    const parsed = lines.map((line) => { try { return JSON.parse(line); } catch { return undefined; } });
    if (!lines.length || parsed.some((item) => item === undefined)) fail("PROOF_NOTE_JSON", "note file is not valid JSON", 1);
    if (!parsed.every((item) => objectWith(item, entrySchema))) {
      fail("PROOF_NOTE_SCHEMA", "every line of the note must be an object with schema \"" + entrySchema + "\"", 1);
    }
    return text;
  }
  if (!objectWith(value, PROOF_SCHEMA) && !objectWith(value, entrySchema)) {
    fail("PROOF_NOTE_SCHEMA", "note JSON must be an object with schema \"" + PROOF_SCHEMA + "\" or lines of \"" + entrySchema + "\"", 1);
  }
  return text;
}

async function proofNoteWrite(options) {
  if (!options.root) fail("USAGE", "proof-note-write requires --root <repo>");
  const commit = String(options.commit || "");
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(commit)) fail("USAGE", "--commit must be a full commit id");
  const snapshot = repository.repositorySnapshot(options.root);
  const resolved = git(snapshot.repoRoot, ["rev-parse", "--verify", "--quiet", commit + "^{commit}"]);
  if (resolved.status !== 0 || String(resolved.stdout).trim() !== commit) {
    fail("PROOF_NOTE_COMMIT", "--commit is not a commit of this repository: " + commit, 1);
  }
  const text = proofNoteSource(snapshot.repoRoot, options);
  // The bytes that were validated are the bytes Git stores: they go through a private copy.
  await withMessageFile(text.replace(/\n+$/u, ""), async (copy) => {
    const result = await gitWatched(snapshot.repoRoot, ["notes", "--ref", PROOF_NOTES_REF, "add", "-f", "-F", copy, commit]);
    commandResult(result, "proof-note-write");
  });
  return { operation: "proof-note-write", commit, notesRef: "refs/notes/" + PROOF_NOTES_REF, bytes: Buffer.byteLength(text) };
}

// Fetch the notes of origin into a private ref, merge them with cat_sort_uniq (no note of either
// side is lost), push the merged ref without force. A missing ref on origin is no error.
async function proofNotesSync(options) {
  if (!options.root) fail("USAGE", "proof-notes-sync requires --root <repo>");
  const snapshot = repository.repositorySnapshot(options.root);
  const repoRoot = snapshot.repoRoot;
  const local = "refs/notes/" + PROOF_NOTES_REF;
  const remoteRef = "refs/notes/" + PROOF_NOTES_REF + "-remote";
  if (git(repoRoot, ["remote", "get-url", "origin"]).status !== 0) {
    fail("PROOF_NOTES_NO_ORIGIN", "the repository has no origin remote; nothing to synchronize", 1);
  }
  let fetched = true;
  const fetchResult = await gitWatched(repoRoot, ["fetch", "origin", "+" + local + ":" + remoteRef]);
  if (fetchResult.status !== 0) {
    if (/couldn't find remote ref/iu.test(String(fetchResult.stderr || ""))) fetched = false;
    else commandResult(fetchResult, "proof-notes-fetch");
  }
  let merged = false;
  if (fetched) {
    const mergeResult = await gitWatched(repoRoot, ["notes", "--ref", PROOF_NOTES_REF, "merge", "-s", "cat_sort_uniq", remoteRef]);
    if (mergeResult.status !== 0) {
      await gitWatched(repoRoot, ["notes", "--ref", PROOF_NOTES_REF, "merge", "--abort"]);
      commandResult(mergeResult, "proof-notes-merge");
    }
    merged = true;
  }
  let pushed = false;
  if (git(repoRoot, ["rev-parse", "--verify", "--quiet", local]).status === 0) {
    const pushResult = await gitWatched(repoRoot, ["push", "--porcelain", "origin", local]);
    if (pushResult.status !== 0) {
      const text = String(pushResult.stdout || "") + "\n" + String(pushResult.stderr || "");
      if (/\[rejected\]|non-fast-forward|fetch first|stale info/iu.test(text)) {
        fail("PROOF_NOTES_PUSH_REJECTED", "origin changed its notes while they were merged; run proof-notes-sync again", 1);
      }
      commandResult(pushResult, "proof-notes-push");
    }
    pushed = true;
  }
  return { operation: "proof-notes-sync", notesRef: local, fetched, merged, pushed };
}

export const CANONICAL_INTENTS = Object.freeze([
  { name: "inspect", mutates: false,
    syntax: "inspect --session <sessionId> [--path <ownedPath>]" },
  { name: "checkpoint", mutates: true,
    syntax: "checkpoint (--session <sessionId> --path <ownedPath> | --root <repo> --package <packageId>) --message <message>" },
  { name: "unstage", mutates: true,
    syntax: "unstage --session <sessionId> --path <ownedPath>" },
  { name: "recover-index", mutates: true,
    syntax: "recover-index --root <repo> --package <packageId> --scope <scope>" },
  { name: "discard-working", mutates: true,
    syntax: "discard-working --session <sessionId> --path <exactOwnedFile>" },
  { name: "recover-discard", mutates: true,
    syntax: "recover-discard --session <sessionId> --receipt <discardReceipt>" },
  { name: "revert-checkpoint", mutates: true,
    syntax: "revert-checkpoint --session <sessionId> --receipt <checkpointReceipt>" },
  { name: "integration-checkpoint", mutates: true,
    syntax: "integration-checkpoint --root <repo> --package <packageId> --scope <scope> --message <message> [--expected-result-file <path> --expected-result-digest <sha256>] [--hold | --advance <heldCommit>]" },
  { name: "plan-close", mutates: true,
    syntax: "plan-close --root <repo> --package <packageId> --scope <scope>" },
  { name: "closure-checkpoint", mutates: true,
    syntax: "closure-checkpoint --root <repo> --package <packageId> --receipt <closePlanReceipt> --message <message> [--unlazy-root <dir>] [--writeback-receipt <witnessReceipt> ...]" },
  { name: "plan-publish", mutates: true,
    syntax: "plan-publish --root <repo> [--session <sessionId> | --receipt <closureReceipt>]" },
  { name: "publish", mutates: true,
    syntax: "publish --root <repo> --receipt <publishPlanReceipt> [--owner-ok <ownerWording> | --owner-ok-file <file>] [--session <sessionId>]" },
  { name: "release-stale-lock", mutates: true,
    syntax: "release-stale-lock --root <repo>" },
  { name: "proof-note-write", mutates: true,
    syntax: "proof-note-write --root <repo> --commit <sha> --file <json>" },
  { name: "proof-notes-sync", mutates: true,
    syntax: "proof-notes-sync --root <repo>" },
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

// D13: a commit text and an Owner quote may be any length and carry line breaks and quotation marks; they
// reach this tool as a file (--message-file, --owner-ok-file) so no command line limit bends them. The file must
// lie in the session temp folder or in a run folder (.unlazy) of the repository or of the rule root; a file of the
// working tree is never read as a commit text or an Owner quote.
function withTextFiles(options) {
  if (options.messageFile === undefined && options.ownerOkFile === undefined) return options;
  const resolved = { ...options };
  const root = options.root || process.cwd();
  const folders = ownerWordingFolders(root, sessionRuleRoot(options));
  try {
    if (options.messageFile !== undefined) {
      if (options.message !== undefined) fail("USAGE", "use either --message or --message-file, not both");
      resolved.message = readTextFromFolders(options.messageFile, folders, "--message-file");
    }
    if (options.ownerOkFile !== undefined) {
      if (options.ownerOk !== undefined) fail("USAGE", "use either --owner-ok or --owner-ok-file, not both");
      resolved.ownerOk = readOwnerWordingFile(options.ownerOkFile, folders);
    }
  } catch (error) { fail(error.code || "USAGE", error.message, error.exitCode || 2); }
  return resolved;
}

export async function runIntent(input) {
  const options = withTextFiles(input);
  if (options.intent !== "checkpoint" && Array.isArray(options.packageIds) && options.packageIds.length > 1) {
    fail("USAGE", "only the checkpoint bundle mode accepts more than one --package");
  }
  if (options.intent === "inspect") return inspect(options);
  if (options.intent === "checkpoint") return checkpoint(options);
  if (options.intent === "unstage") return unstage(options);
  if (options.intent === "recover-index") return recoverIndex(options);
  if (options.intent === "discard-working") return discardWorking(options);
  if (options.intent === "recover-discard") return recoverDiscard(options);
  if (options.intent === "revert-checkpoint") return revertCheckpoint(options);
  if (options.intent === "integration-checkpoint") return integrationCheckpoint(options);
  if (options.intent === "plan-close") return planClose(options);
  if (options.intent === "closure-checkpoint") return closureCheckpoint(options);
  if (options.intent === "plan-publish") return planPublish(options);
  if (options.intent === "publish") return publish(options);
  if (options.intent === "release-stale-lock") return releaseStaleLock(options);
  if (options.intent === "proof-note-write") return proofNoteWrite(options);
  if (options.intent === "proof-notes-sync") return proofNotesSync(options);
  if (options.intent === "explain") return explain(options);
  fail("USAGE", "intent must be inspect, checkpoint, unstage, recover-index, discard-working, recover-discard, revert-checkpoint, integration-checkpoint, plan-close, closure-checkpoint, plan-publish, publish, release-stale-lock, proof-note-write, proof-notes-sync, or explain");
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
