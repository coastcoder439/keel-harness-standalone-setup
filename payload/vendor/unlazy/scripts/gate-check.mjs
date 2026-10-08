#!/usr/bin/env node
// Execute gate oracles, update evidence, coordinate scopes, and manage leases.
// Zero dependencies. Node 16+.
//
// A CHECK has no time limit and no output limit. It is started through
// lib/silence-watch.mjs (runWatched) and is stopped only when it is hung: a long
// stretch with no output and no CPU or I/O activity anywhere in its process tree
// (KEEL_SILENCE_MS, default 30 min). A hung CHECK is red with the message HUNG.
// Its output goes to files in a private work directory outside the repository
// (removed at the end of the run), and EXPECT is checked on those files: plain
// text block by block with overlap (lib/output-scan.mjs), a regular expression
// on the whole content in a disposable worker. The 250 ms budget of that worker
// and its 5 s startup limit, the four-worker cap and the 1000-character pattern
// limit are inherited from the Unlazy original (they guard against catastrophic
// patterns, not against slow checks); only the budget for very large outputs
// grows with their size (see regexBudgetMs).

import {
  closeSync, constants as fsConstants, existsSync, fstatSync, lstatSync,
  mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, realpathSync, rmSync,
  statSync, unlinkSync, writeFileSync,
} from "node:fs";
import { Worker } from "node:worker_threads";
import { randomBytes } from "node:crypto";
import { delimiter, dirname, basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { homedir, tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  UNLAZY_DIR, appendStatus, claimLeases, formatDocument, gateState,
  hookStatePath, listScopes, parseGates, releaseLeases, resolveTarget,
  scopeRoot, sha256, sleep, validateScopeId, withFileLock, writeAtomic,
} from "./lib/gates.mjs";
import { dispatchStatus } from "./lib/dispatch.mjs";
import { listActiveScopes, resolvePackageTarget, resolveRepository } from "./lib/packages.mjs";
import { hardenWindowsPrivateDirectory, verifyWindowsPrivateDirectory } from "./lib/windows-acl.mjs";
import { runWatched } from "./lib/silence-watch.mjs";
import {
  fingerprintOutput, includesText, outputSegments, readWindows, segmentsBytes,
} from "./lib/output-scan.mjs";
import { AMEND_OPEN, AMEND_UNCLEAR, findOpenAmendmentsForFiles } from "./lib/open-amend.mjs";
import {
  cacheable, checkerVersion, codeStateKey, findProof, gitTopLevel, locateGitIntent, makeNoteWriter,
  nodeModulesWorkspaceLinks, proofKeyFor,
  resolveCommit, withCleanCheckout, writeProof,
} from "./lib/proof-store.mjs";

const HELP = `usage: gate-check.mjs [options] [file ...]

run modes:
  (default)             run unmet runnable gates and update their ledgers
  --status              report only; never execute, approve, or write
  --reverify            re-run every runnable gate and demote stale failures
  --approve             approve each exact pending oracle, then run it
  --jobs N              rolling concurrency, integer 1..64 (default 1)
  --timeout S           accepted and ignored: a check has no time limit and is
                        stopped only when hung (no output and no CPU/I-O activity
                        for KEEL_SILENCE_MS, default 30 min)
  --shell PATH          command shell (UNLAZY_SHELL, then platform default)
  --cwd DIR             default CHECK directory (explicit: file dir; discovered: --root)
  --at COMMIT           package runs only: check the code state of COMMIT, not the working
                        copy. The CHECKs run in one clean copy of that commit (git
                        worktree), shared by all gates of the run. A green result
                        is stored on the commit (Git note keel-proof, written through the
                        Harness's git-intent only) and reused, with PROOF_REUSED and no
                        run, wherever the same command meets the same code state again.
                        Implies --reverify: a tick in the ledger is never a proof
  --tree PATHS          with --at: the subtree(s) a result depends on, comma separated,
                        relative to the repository, each naming something in the commit
                        in its exact spelling (default: the whole repository)

pipeline actions:
  --claim --scope ID [--leaf NAME]   atomically claim the leaf's OWNS paths
  --release --scope ID [--leaf NAME] release serialized ownership leases
  --log TEXT --scope ID              append one status line
  --bind SESSION --scope ID          bind a session to one pipeline
  --list-scopes                      list .unlazy pipelines

targeting:
  --package ID           use docs/packages/ID/{GATES.md,gates/*.md}
  --leaf leaf-ID         select one exact package leaf ledger for run/status/reverify
  --legacy               explicitly diagnose legacy root/.unlazy ledgers
  --scope ID             use .unlazy/ID (or UNLAZY_SCOPE)
  --root DIR             repository/pipeline root (default current directory)
  file ...               explicit regular ledger files; all are honored

CHECK execution requires prior approval keyed to the exact CHECK, EXPECT,
resolved CWD, resolved shell, regex limits, platform, and PATH (no time or
output limit is part of the key; approvals made with one stay valid). In a
package run the key uses the ledger's and the CWD's path inside the repository,
so an approval also holds in another checkout of the repository; approvals made
with the absolute path stay valid.
Approvals live outside the repository under ~/.unlazy/approved by default.

exit codes: 0 all met/action succeeded; 1 unmet; 2 usage/parse/infrastructure;
            3 lease conflict.`;

const FLAG_OPTIONS = new Set([
  "--status", "--reverify", "--approve", "--claim", "--release",
  "--list-scopes", "--legacy", "--help", "-h",
]);
const VALUE_OPTIONS = new Set([
  "--package", "--scope", "--leaf", "--timeout", "--jobs", "--cwd", "--root", "--at", "--tree",
  "--log", "--bind", "--shell",
]);
const MAX_APPROVAL_BYTES = 256 * 1024;
// Unlazy original: guard against catastrophic regular expressions (F1).
const REGEX_TIMEOUT_MS = 250;
const REGEX_STARTUP_TIMEOUT_MS = 5000;
const MAX_REGEX_WORKERS = 4;
// Output of this size and up gets proportionally more regex budget (see regexBudgetMs).
const REGEX_BUDGET_STEP_BYTES = 8 * 1024 * 1024;
const REGEX_BUDGET_CAP_MS = 60000;
// Keys of an approval oracle that older versions bound and this one does not.
const RETIRED_ORACLE_KEYS = ["timeoutMs", "maxOutputBytes"];
// The first characters of a proof key, in messages and in EVIDENCE (--at).
const PROOF_PREFIX = 16;
const PROOF_EVIDENCE_RE = /(?:^|;\s*)proof=([0-9a-f]{16})@[0-9a-f]+/;
const CHECK_SUPERVISOR = fileURLToPath(new URL("./lib/check-supervisor.mjs", import.meta.url));

// Repository-controlled titles, paths, commands, and output must not be able
// to rewrite terminal history, set a window title, or visually reorder text.
// Strip every C0/C1 control plus Unicode bidi formatting markers at the final
// sink. Each console call still receives its own trailing newline.
const UNSAFE_TERMINAL_RE = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
const terminalSafe = (value) => String(value).replace(UNSAFE_TERMINAL_RE, " ");
for (const method of ["log", "error"]) {
  const write = console[method].bind(console);
  console[method] = (...values) => write(...values.map(terminalSafe));
}

function parseArgs(argv) {
  const options = {};
  const files = [];
  let positional = false;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--") { positional = true; continue; }
    if (!positional && FLAG_OPTIONS.has(arg)) {
      const key = arg.replace(/^-+/, "");
      if (options[key] !== undefined) return { error: "duplicate option " + arg };
      options[key] = true;
      continue;
    }
    if (!positional && arg.startsWith("--")) {
      const equals = arg.indexOf("=");
      const name = equals === -1 ? arg : arg.slice(0, equals);
      if (!VALUE_OPTIONS.has(name)) return { error: "unknown option " + name };
      const key = name.slice(2);
      if (options[key] !== undefined) return { error: "duplicate option " + name };
      const value = equals === -1 ? argv[++index] : arg.slice(equals + 1);
      if (value === undefined || value === "") return { error: name + " needs a value" };
      options[key] = value;
      continue;
    }
    if (!positional && arg.startsWith("-")) return { error: "unknown option " + arg };
    files.push(arg);
  }
  return { options, files };
}

function failUsage(message) {
  console.error("gate-check: " + message);
  console.error("run gate-check.mjs --help for usage");
  process.exit(2);
}

function asDirectory(path, label) {
  try {
    if (!statSync(path).isDirectory()) failUsage(label + " is not a directory: " + path);
  } catch (error) {
    if (error.code === "ENOENT") failUsage(label + " does not exist: " + path);
    failUsage("cannot inspect " + label + " " + path + ": " + error.message);
  }
}

// --timeout is still validated so that a bad call keeps failing the way it did,
// but its value is not used: a CHECK has no time limit (it is stopped only when hung).
function acceptIgnoredTimeout(value) {
  if (value === undefined) return;
  const number = Number(value);
  if (!Number.isFinite(number) || !Number.isInteger(number) || number < 1 || number > 86400) {
    failUsage("--timeout needs an integer from 1 through 86400, got " + JSON.stringify(value));
  }
  // P12 removes the --timeout the executor still passes through; until then it
  // sets KEEL_GATE_QUIET_TIMEOUT so the notice does not push the cause of a failure off stderr.
  if (process.env.KEEL_GATE_QUIET_TIMEOUT) return;
  console.error("gate-check: --timeout is ignored; checks stop only when hung (silence-watch)");
}

function jobCount(value) {
  if (value === undefined) return 1;
  const number = Number(value);
  if (!Number.isFinite(number) || !Number.isInteger(number) || number < 1 || number > 64) {
    failUsage("--jobs needs an integer from 1 through 64, got " + JSON.stringify(value));
  }
  return number;
}

const parsedArgs = parseArgs(process.argv.slice(2));
if (parsedArgs.error) failUsage(parsedArgs.error);
const { options: opt, files: fileArgs } = parsedArgs;
if (opt.help || opt.h) {
  // HELP is a fixed local constant, so preserve its intentional layout instead
  // of routing it through the untrusted-value terminal sanitizer.
  process.stdout.write(HELP + "\n");
  process.exit(0);
}

const actionNames = [];
for (const key of ["claim", "release", "list-scopes"]) if (opt[key]) actionNames.push("--" + key);
for (const key of ["log", "bind"]) if (opt[key] !== undefined) actionNames.push("--" + key);
if (actionNames.length > 1) failUsage("pipeline actions are mutually exclusive: " + actionNames.join(", "));
const action = actionNames[0] || null;

if (opt.status && opt.reverify) failUsage("--status and --reverify are mutually exclusive");
if (opt.status && opt.approve) failUsage("--status never approves commands; remove --approve");
if (action && (opt.status || opt.reverify || opt.approve)) failUsage(action + " cannot be combined with a run mode");
if (action && fileArgs.length) failUsage(action + " cannot be combined with explicit files");
if (fileArgs.length && opt.scope) failUsage("explicit files and --scope are mutually exclusive");
if (fileArgs.length && opt.package) failUsage("explicit files and --package are mutually exclusive");
if (opt.package && opt.legacy) failUsage("--package and --legacy are mutually exclusive");
if (opt.leaf && !opt.package && !opt.claim && !opt.release) {
  failUsage("--leaf run selection requires --package ID");
}
if ((opt.timeout || opt.jobs || opt.shell || opt.cwd) && (action || opt.status)) {
  failUsage("--timeout, --jobs, --shell, and --cwd are execution options only");
}
if ((opt.at || opt.tree) && (action || opt.status)) failUsage("--at and --tree are execution options only");
if (opt.tree && !opt.at) failUsage("--tree needs --at COMMIT");
// A tick in the ledger is never a proof for a commit (A21): with --at every runnable gate is
// checked, either by a stored result of the same key or by a run in the clean copy.
if (opt.at) opt.reverify = true;

let root = resolve(opt.root || process.cwd());
asDirectory(root, "--root");
acceptIgnoredTimeout(opt.timeout);
const jobs = jobCount(opt.jobs);

if (action === "--list-scopes") {
  const scopes = listScopes(root);
  if (scopes.length) {
    for (const scope of scopes) console.log(scope);
  } else console.log("(no pipelines under " + UNLAZY_DIR + "/)");
  process.exit(0);
}

if (opt.scope) {
  const error = validateScopeId(opt.scope);
  if (error) failUsage(error);
}

let packageRepoRoot = null;
try {
  packageRepoRoot = resolveRepository(opt.root ? { root: opt.root } : { cwd: process.cwd() });
} catch (error) {
  if (opt.package || process.env.UNLAZY_PACKAGE) failUsage(error.message);
}
let packageRuntimePresent = false;
if (packageRepoRoot && !fileArgs.length) {
  try { packageRuntimePresent = listActiveScopes(packageRepoRoot, { assertRoot: false, includeInvalid: true }).length > 0; }
  catch { packageRuntimePresent = true; }
}
const packageIntent = !opt.legacy && !fileArgs.length && Boolean(opt.package || process.env.UNLAZY_PACKAGE || packageRuntimePresent);
let target;
if (packageIntent) {
  let packageTarget;
  try {
    packageTarget = resolvePackageTarget({
      ...(opt.root ? { root: opt.root } : { cwd: process.cwd() }),
      packageId: opt.package,
      scope: opt.scope,
    });
  } catch (error) {
    // Recovery is deliberately narrower than normal package resolution. A
    // caller that names both identities may release only that package's lease
    // records even after package.ref disappeared. It cannot claim, bind, log,
    // execute, or delete another package's/legacy records through this path.
    if (action === "--release" && opt.package && opt.scope) {
      try {
        packageTarget = resolvePackageTarget({
          ...(opt.root ? { root: opt.root } : { cwd: process.cwd() }),
          packageId: opt.package,
          env: {},
        });
        packageTarget = { ...packageTarget, scope: opt.scope, recovery: true };
      } catch { failUsage(error.message); }
    } else failUsage(error.message);
  }
  if (opt.package && opt.scope) {
    const expected = process.platform === "win32" ? opt.scope.toLowerCase() : opt.scope;
    const actual = packageTarget.scope && (process.platform === "win32" ? packageTarget.scope.toLowerCase() : packageTarget.scope);
    if (actual !== expected) {
      if (action === "--release") packageTarget = { ...packageTarget, scope: opt.scope, recovery: true };
      else failUsage("--package " + opt.package + " is not active in --scope " + opt.scope);
    }
  }
  root = packageTarget.repoRoot;
  target = { ...packageTarget, mode: "package", files: packageTarget.gateFiles };
} else {
  target = resolveTarget({ root, scope: opt.scope, files: fileArgs, legacy: Boolean(opt.legacy) });
}
if (opt.leaf && !action) {
  const error = validateScopeId(opt.leaf, "leaf");
  if (error) failUsage(error);
  if (target.mode !== "package" || !opt.leaf.startsWith("leaf-")) {
    failUsage("--leaf run selection requires an exact package leaf-* ledger");
  }
  const exact = join(target.packageDir, "gates", opt.leaf + ".md");
  const selected = target.files.filter((file) => resolve(file) === resolve(exact));
  if (selected.length !== 1) failUsage("unknown package leaf " + opt.leaf);
  target = { ...target, files: selected };
}
// A deleted/crashed pipeline can leave coordination leases behind after its
// ledger directory is gone. An explicit, validated release target must remain
// usable for that recovery path; claims still require a live exact ledger.
if (target.error && action === "--release" && opt.scope) {
  target = { mode: "scope", scope: opt.scope, files: [] };
} else if (target.error) failUsage(target.error);
const scope = target.scope;
const defaultCwd = resolve(root, opt.cwd || ".");
if (!action && !opt.status) asDirectory(defaultCwd, "--cwd");

if (action === "--log") {
  if (!scope) failUsage("--log needs --scope ID or exactly one discoverable pipeline");
  if (!String(opt.log).trim()) failUsage("--log needs non-blank text");
  try {
    const path = await appendStatus(root, scope, opt.log);
    console.log("appended to " + path);
    process.exit(0);
  } catch (error) {
    console.error("gate-check: cannot append status: " + error.message);
    process.exit(2);
  }
}

if (action === "--bind") {
  if (!scope) failUsage("--bind needs --scope ID or exactly one discoverable pipeline");
  if (!String(opt.bind).trim()) failUsage("--bind needs a non-blank session id");
  const path = join(scopeRoot(root, scope), "session");
  try {
    writeAtomic(path, String(opt.bind).trim() + "\n", { root });
    console.log("bound session " + opt.bind + " to scope " + scope);
    process.exit(0);
  } catch (error) {
    console.error("gate-check: cannot bind session: " + error.message);
    process.exit(2);
  }
}

if (!target.files.length && action !== "--release") {
  failUsage("no gate files found for resolved target under " + root);
}

for (const file of target.files) {
  try {
    if (!statSync(file).isFile()) failUsage("gate target is not a regular file: " + file);
  } catch (error) {
    if (error.code === "ENOENT") failUsage("no such gate file: " + file);
    failUsage("cannot inspect gate file " + file + ": " + error.message);
  }
}

function loadLedger(file) {
  let text;
  try { text = readFileSync(file, "utf8"); }
  catch (error) { failUsage("cannot read " + file + ": " + error.message); }
  const doc = parseGates(text);
  for (const warning of doc.warnings) console.error("gate-check: " + file + ": warning: " + warning);
  if (doc.errors.length) {
    for (const error of doc.errors) console.error("gate-check: " + file + ": " + error);
    process.exit(2);
  }
  return { file, doc };
}

function qualified(file, gateId) {
  if (target.mode !== "package") return basename(String(file)).replace(/\.md$/i, "") + ":" + gateId;
  const ledger = relative(root, resolve(file)).replaceAll("\\", "/");
  return target.packageId + "/" + ledger + ":" + gateId;
}

if (action === "--claim" || action === "--release") {
  if (!scope) failUsage(action + " needs --scope ID or exactly one discoverable pipeline");
  const stems = target.files.map((file) => basename(file).replace(/\.md$/i, ""));
  if (target.mode === "package" && action === "--claim" && !opt.leaf) {
    failUsage("package --claim requires an exact --leaf leaf-* selector");
  }
  if (opt.leaf) {
    const error = validateScopeId(opt.leaf, "leaf");
    if (error) failUsage(error);
    if (target.mode === "package" && !opt.leaf.startsWith("leaf-")) {
      failUsage("package claims and leaf releases require a leaf-* id, got " + opt.leaf);
    }
    if (stems.length && !stems.includes(opt.leaf)) failUsage("unknown --leaf " + opt.leaf + " (have: " + stems.join(", ") + ")");
  }
  if (action === "--release") {
    try {
      const count = await releaseLeases(root, {
        scope,
        packageId: target.mode === "package" ? target.packageId : null,
        leaf: opt.leaf || null,
      });
      console.log("released " + count + " lease(s) for " + scope + (opt.leaf ? "/" + opt.leaf : ""));
      process.exit(0);
    } catch (error) {
      console.error("gate-check: cannot release leases: " + error.message);
      process.exit(2);
    }
  }

  const leaf = opt.leaf || (stems.length === 1 ? stems[0] : null);
  if (!leaf) failUsage("--claim needs --leaf NAME when a scope has several gate files");
  const selectedFile = target.files.find((file) => basename(file).replace(/\.md$/i, "") === leaf);
  if (target.mode === "package") {
    const exact = join(target.packageDir, "gates", leaf + ".md");
    if (!selectedFile || resolve(selectedFile) !== resolve(exact)) {
      failUsage("package claim must address exact leaf ledger " + relative(root, exact).replaceAll("\\", "/"));
    }
  }
  const selected = loadLedger(selectedFile);
  if (!selected.doc.owns.length) failUsage(basename(selected.file) + " declares no OWNS paths");
  let result;
  try {
    result = await claimLeases(root, {
      scope,
      packageId: target.mode === "package" ? target.packageId : null,
      leaf,
      ledger: target.mode === "package" ? relative(root, selected.file).replaceAll("\\", "/") : null,
      globs: selected.doc.owns,
    });
  }
  catch (error) {
    console.error("gate-check: cannot claim leases: " + error.message);
    process.exit(2);
  }
  for (const orphan of result.releasedOrphans || []) {
    console.log("RELEASED ORPHAN " + orphan.packageId + "/" + orphan.scope + "/" + orphan.leaf +
      " (scope no longer binds the package)");
  }
  if (!result.ok) {
    if (result.error) failUsage(result.error);
    for (const conflict of result.conflicts) {
      console.log("CONFLICT " + conflict.glob + " overlaps " + conflict.theirGlob + " held by " + conflict.with);
    }
    console.log("CLAIM REFUSED (" + result.conflicts.length + " conflict(s))");
    process.exit(3);
  }
  console.log("CLAIMED " + result.globs.length + " path(s) for " + scope + "/" + leaf + ": " + result.globs.join(", "));
  process.exit(0);
}

let ledgers = target.files.map(loadLedger);

function executableCandidates(name) {
  if (process.platform !== "win32") return [name];
  if (/\.[A-Za-z0-9]+$/.test(name)) return [name];
  const extensions = (process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
  return [name, ...extensions.map((extension) => name + extension.toLowerCase()), ...extensions.map((extension) => name + extension.toUpperCase())];
}

function resolveShell(raw) {
  const requested = raw || process.env.UNLAZY_SHELL || (process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : "/bin/sh");
  const containsSeparator = requested.includes("/") || requested.includes("\\") || isAbsolute(requested);
  const candidates = [];
  if (containsSeparator) candidates.push(resolve(process.cwd(), requested));
  else {
    for (const directory of String(process.env.PATH || "").split(delimiter).filter(Boolean)) {
      for (const name of executableCandidates(requested)) candidates.push(join(directory, name));
    }
  }
  for (const candidate of candidates) {
    try { if (statSync(candidate).isFile()) return candidate; } catch { /* keep looking */ }
  }
  failUsage("cannot resolve command shell " + JSON.stringify(requested) + " from PATH");
}

const shell = opt.status ? "(not used: status mode)" : resolveShell(opt.shell);
const shellId = opt.status ? "unused" : process.platform + ":" + basename(shell).toLowerCase();
const CHECKER_DIR = dirname(fileURLToPath(import.meta.url));

// --at COMMIT: the commit, the subtree its results depend on, and the way to store a
// result. The way to store is the Harness's git-intent next to this checker; without
// one (plain Unlazy) results are produced in the clean copy but never stored or reused.
// The long, real spelling of a path (Windows 8.3 short names expanded), for comparing with what Git reports.
const nativeRealpath = (value) => (realpathSync.native || realpathSync)(value);

function proofContext() {
  if (!opt.at) return null;
  // --at writes back package ledgers only; outside a package run there is no ledger the proof
  // key could leave unchanged (it would rewrite itself on every run).
  if (target.mode !== "package") failUsage("--at works only in a package run (--package ID)");
  const top = gitTopLevel(root);
  if (!top) failUsage("--at needs a Git repository at " + root);
  const commit = resolveCommit(top, opt.at);
  if (!commit) failUsage("--at: not a commit of this repository: " + opt.at);
  let scope = ["."];
  if (opt.tree) {
    scope = opt.tree.split(",").map((item) => item.trim()).filter(Boolean);
    if (!scope.length) failUsage("--tree needs at least one path");
  }
  // Every --tree entry must name something in the commit, in its exact spelling; a key over
  // nothing would hold for any code.
  try {
    for (const item of scope) codeStateKey(top, commit, { scope: [item] });
    codeStateKey(top, commit, { scope });
  } catch (error) { failUsage("--at/--tree: " + error.message); }
  const notes = [];
  // The version of the checker is that of the bytes that run. A checker inside the repository
  // that differs from the commit's (changed, not committed) makes results nobody can attribute
  // to the commit: they are neither stored nor reused.
  let checker;
  try { checker = checkerVersion(top, commit, { checkerDir: CHECKER_DIR }); }
  catch (error) { failUsage("--at: cannot read the running checker: " + error.message); }
  if (checker.inRepository && !checker.matchesCommit) {
    notes.push("the running checker (" + checker.directory + ") differs from the one in commit " + commit.slice(0, 8));
  }
  // A workspace or file: dependency linked in node_modules points into the working tree: the
  // clean copy would read uncommitted code through it.
  const workspace = nodeModulesWorkspaceLinks(top, commit);
  if (workspace.length) {
    notes.push("node_modules links into the working tree (workspace or file: dependency): " +
      workspace.slice(0, 3).map((item) => relative(top, item.link).replaceAll("\\", "/")).join(", ") +
      (workspace.length > 3 ? " and " + (workspace.length - 3) + " more" : ""));
  }
  for (const note of notes) console.error("gate-check: PROOF_NOT_CACHEABLE: " + note + "; results are neither stored nor reused");
  const intent = locateGitIntent(top, { checkerDir: CHECKER_DIR });
  return {
    top, canonicalTop: nativeRealpath(top), commit, scope, checker, cacheOff: notes.length > 0,
    noteWriter: intent ? makeNoteWriter(top, intent) : null,
  };
}
const proofCtx = opt.status ? null : proofContext();

const pathValue = String(process.env.PATH || "");
const normalizedPath = normalizePathValue(pathValue);
const pathHash = sha256(pathValue).slice(0, 12);
const pathCount = pathValue ? pathValue.split(delimiter).length : 0;
const pathEvidence = pathHash + "/" + pathCount + " entries";
const pathTranscript = pathValue.replace(/[\r\n]/g, " ").slice(0, 800) + (pathValue.length > 800 ? "..." : "");

function resolvedGateCwd(gate, file) {
  // Explicit ledgers are self-contained: absent --cwd, relative commands and
  // CWD attributes anchor beside that ledger instead of wherever the caller
  // happened to launch the checker. Scoped and legacy discovery anchor at root.
  const base = opt.cwd ? defaultCwd : (target.mode === "explicit" ? dirname(resolve(file)) : root);
  const candidate = gate.cwd ? resolve(base, gate.cwd) : base;
  try { return realpathSync(candidate); } catch { return candidate; }
}

// Approvals must hold no matter which shell granted them. Git Bash prepends its
// own runtime directories to PATH, so the signature uses a normalized PATH
// without that runtime; every other entry still invalidates an approval.
function normalizePathValue(value) {
  const windows = process.platform === "win32";
  const profile = windows ? normalizePathEntry(process.env.USERPROFILE || homedir()) : "";
  const gitBashBin = profile ? profile + "\\bin" : null;
  const seen = new Set();
  const entries = [];
  for (const raw of String(value || "").split(delimiter)) {
    const entry = normalizePathEntry(raw);
    if (!entry || seen.has(entry)) continue;
    seen.add(entry);
    if (windows) {
      const probe = entry + "\\";
      if (probe.includes("\\git\\usr\\") || probe.includes("\\git\\mingw64\\") ||
          probe.includes("\\vendor_perl\\") || probe.includes("\\core_perl\\") || entry === gitBashBin) continue;
    }
    entries.push(entry);
  }
  return entries.join(delimiter);
}

function normalizePathEntry(raw) {
  let entry = String(raw).trim();
  if (process.platform === "win32") entry = entry.replaceAll("/", "\\").toLowerCase();
  while (entry.length > 1 && /[\\/]$/.test(entry) && !/^[a-z]:\\$/.test(entry)) entry = entry.slice(0, -1);
  return entry;
}

// The approval key. Schema 1 also bound timeoutMs and maxOutputBytes; neither
// exists any more (a CHECK has no time or output limit), so a limit that changes
// can no longer invalidate an approval. Records written under schema 1 are still
// found by legacyApprovalExists.
//
// In a package run the key does not hold the absolute paths of the ledger and of the
// CWD but their paths inside the repository (schema 3), so an approval also holds in
// another checkout of the repository, for instance the clean copy of a commit.
// Approvals made with the absolute path (schema 2) stay valid: the current key is
// asked for first, the old one second. Legacy, scoped and explicit runs keep the
// absolute key, because their root is the directory the checker was started in.
function oracleWith(gate, cwd, schema) {
  return {
    schema,
    check: gate.check,
    expect: gate.expect,
    cwd,
    shell,
    regexTimeoutMs: REGEX_TIMEOUT_MS,
    regexStartupTimeoutMs: REGEX_STARTUP_TIMEOUT_MS,
    maxRegexWorkers: MAX_REGEX_WORKERS,
    platform: process.platform,
    path: normalizedPath,
  };
}

function oracleAbsolute(file, gate) {
  return oracleWith(gate, resolvedGateCwd(gate, file), 2);
}

// The path of `value` inside the repository (posix, "." for the root), or null outside.
function repoRelative(value) {
  for (const base of [root, canonicalRoot]) {
    const rel = relative(base, value);
    if (rel === "") return ".";
    if (rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel)) return rel.replaceAll("\\", "/");
  }
  return null;
}

function portableApproval(file, gate) {
  if (target.mode !== "package") return null;
  const ledger = repoRelative(resolve(file));
  const cwd = repoRelative(resolvedGateCwd(gate, file));
  if (ledger === null || ledger === "." || cwd === null) return null;
  return { ledger, cwd };
}

function oraclePortable(file, gate) {
  const portable = portableApproval(file, gate);
  return portable ? oracleWith(gate, portable.cwd, 3) : null;
}

// What a new approval records.
function oracle(file, gate) {
  return oraclePortable(file, gate) || oracleAbsolute(file, gate);
}

function signature(file, gate) {
  return sha256(JSON.stringify(oracle(file, gate)));
}

function pathIsInside(parent, child) {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || (!rel.startsWith(".." + sep) && rel !== ".." && !isAbsolute(rel));
}

function portablePath(value) {
  const rel = relative(root, value);
  if (rel === "") return ".";
  if (rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) {
    throw new Error("package gate CWD escapes repository: " + value);
  }
  return rel.replaceAll("\\", "/");
}

const approvalDir = resolve(process.env.UNLAZY_APPROVAL_DIR || join(homedir(), ".unlazy", "approved"));
const canonicalRoot = realpathSync(root);
const windowsAclCache = new Map();
if (!opt.status && pathIsInside(root, approvalDir)) failUsage("UNLAZY_APPROVAL_DIR must be outside the repository root");

// The identity of an approval record: ledger path inside the repository when the key
// is portable, the absolute path otherwise.
function approvalIdentity(file, gate) {
  const portable = portableApproval(file, gate);
  const value = oracle(file, gate);
  const signed = sha256(JSON.stringify(value));
  if (portable) return { portable: true, ledger: portable.ledger, signature: signed, name: sha256(portable.ledger + "\0" + gate.id + "\0" + signed) };
  return { portable: false, signature: signed, name: sha256(resolve(file) + "\0" + gate.id + "\0" + signed) };
}

// The record of the key before schema 3: absolute ledger path, absolute CWD.
function absoluteIdentity(file, gate) {
  const signed = sha256(JSON.stringify(oracleAbsolute(file, gate)));
  return { signature: signed, name: sha256(resolve(file) + "\0" + gate.id + "\0" + signed) };
}

function approvalPath(file, gate, directory = approvalDir) {
  return join(directory, approvalIdentity(file, gate).name + ".json");
}

function assertPrivateApprovalEntry(path, info, kind) {
  if (info.isSymbolicLink() || (kind === "directory" ? !info.isDirectory() : !info.isFile())) {
    throw new Error(path + " must be a real " + kind);
  }
  const uid = typeof process.geteuid === "function" ? process.geteuid()
    : typeof process.getuid === "function" ? process.getuid() : null;
  if (uid !== null && info.uid !== uid) {
    throw new Error(path + " must be owned by the current user");
  }
  if (process.platform !== "win32" && (info.mode & 0o077) !== 0) {
    throw new Error(path + " must not grant group or other permissions");
  }
}

function validatedApprovalDir({ create = false } = {}) {
  const existed = existsSync(approvalDir);
  if (create) {
    mkdirSync(approvalDir, { recursive: true, mode: 0o700 });
    if (!existed && process.platform === "win32") hardenWindowsPrivateDirectory(approvalDir);
  }
  else if (!existsSync(approvalDir)) return null;
  const info = lstatSync(approvalDir);
  assertPrivateApprovalEntry(approvalDir, info, "directory");
  const canonical = realpathSync(approvalDir);
  if (pathIsInside(canonicalRoot, canonical)) {
    throw new Error("approval directory resolves inside the repository root: " + canonical);
  }
  const canonicalInfo = lstatSync(canonical);
  assertPrivateApprovalEntry(canonical, canonicalInfo, "directory");
  if (process.platform === "win32") {
    const cacheKey = canonical.toLowerCase() + "\0" + canonicalInfo.dev + "\0" + canonicalInfo.ino + "\0" + canonicalInfo.mtimeMs;
    if (!windowsAclCache.has(cacheKey)) {
      verifyWindowsPrivateDirectory(canonical);
      windowsAclCache.clear();
      windowsAclCache.set(cacheKey, true);
    }
  }
  return { path: canonical, dev: canonicalInfo.dev, ino: canonicalInfo.ino };
}

function assertApprovalDirUnchanged(store) {
  const current = lstatSync(store.path);
  assertPrivateApprovalEntry(store.path, current, "directory");
  if (current.dev !== store.dev || current.ino !== store.ino) {
    throw new Error("approval directory changed during use: " + store.path);
  }
}

function readApprovalFile(path) {
  let fd = null;
  try {
    const noFollow = process.platform === "win32" ? 0 : (fsConstants.O_NOFOLLOW || 0);
    fd = openSync(path, fsConstants.O_RDONLY | (fsConstants.O_NONBLOCK || 0) | noFollow);
    const opened = fstatSync(fd);
    const named = lstatSync(path);
    assertPrivateApprovalEntry(path, opened, "file");
    if (opened.size > MAX_APPROVAL_BYTES) {
      throw new Error("approval record exceeds " + MAX_APPROVAL_BYTES + " bytes: " + path);
    }
    if (named.isSymbolicLink() || !named.isFile() || named.nlink !== 1 || opened.nlink !== 1 ||
        named.dev !== opened.dev || named.ino !== opened.ino) {
      throw new Error("refusing linked or replaced approval record " + path);
    }
    const text = readFileSync(fd, "utf8");
    const after = lstatSync(path);
    if (after.isSymbolicLink() || !after.isFile() || after.nlink !== 1 ||
        after.dev !== opened.dev || after.ino !== opened.ino) {
      throw new Error("approval record changed while it was read: " + path);
    }
    return text;
  } finally {
    if (fd !== null) try { closeSync(fd); } catch { /* ignore */ }
  }
}

// Reads the record filed under `name`: null when there is none, otherwise whether it
// is intact and `matches(value)` holds.
function checkApprovalRecord(store, name, matches) {
  let text;
  try { text = readApprovalFile(join(store.path, name + ".json")); }
  catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  let value;
  try { value = JSON.parse(text); }
  catch { return false; }
  assertApprovalDirUnchanged(store);
  return Boolean(value && matches(value));
}

// The current key first (portable in a package run), then the key made with the
// absolute path (schema 2), then the records of schema 1.
function approvalExists(file, gate) {
  const store = validatedApprovalDir();
  if (!store) return false;
  const current = approvalIdentity(file, gate);
  const found = checkApprovalRecord(store, current.name, current.portable
    ? (value) => value.ledger === current.ledger && value.gate === gate.id && value.signature === current.signature
    : (value) => value.file === resolve(file) && value.gate === gate.id && value.signature === current.signature);
  if (found === true) return true;
  if (!current.portable) return found === null ? legacyApprovalExists(store, file, gate) : false;
  const old = absoluteIdentity(file, gate);
  const older = checkApprovalRecord(store, old.name,
    (value) => value.file === resolve(file) && value.gate === gate.id && value.signature === old.signature);
  if (older === true) return true;
  return older === null ? legacyApprovalExists(store, file, gate) : false;
}

// Approvals written by earlier versions are filed under a signature of the oracle
// as it was then: schema 1, with the time limit and the output cap in it and,
// before PATH normalization, the raw PATH. They stay valid, so no approval has to
// be given again. The old filename cannot be rebuilt (the time limit that was
// current when the owner approved is only stored inside the record), so the
// records of this ledger and gate are read and compared field by field: the stored
// oracle, without the two retired limits and with its PATH normalized, must equal
// the current oracle in every other field, and the record must be intact (its
// signature is the hash of its own oracle). Anything else (another CHECK, EXPECT,
// CWD, shell, regex limit, platform or PATH, or an unknown extra field) does not match.
let legacyApprovals = null;

function legacyApprovalIndex(store) {
  if (legacyApprovals) return legacyApprovals;
  legacyApprovals = new Map();
  let names;
  try { names = readdirSync(store.path); }
  catch { return legacyApprovals; }
  for (const name of names) {
    if (!/^[0-9a-f]{64}\.json$/.test(name)) continue;
    let value;
    try { value = JSON.parse(readApprovalFile(join(store.path, name))); }
    catch { continue; }
    if (!value || typeof value.file !== "string" || typeof value.gate !== "string") continue;
    const key = value.file + "\0" + value.gate;
    if (!legacyApprovals.has(key)) legacyApprovals.set(key, []);
    legacyApprovals.get(key).push(value);
  }
  return legacyApprovals;
}

function legacyMatches(record, current) {
  const old = record.oracle;
  if (!old || typeof old !== "object" || Array.isArray(old) || typeof old.path !== "string") return false;
  if (old.schema !== 1) return false;
  if (record.signature !== sha256(JSON.stringify(old))) return false;
  const known = new Set([...Object.keys(current), ...RETIRED_ORACLE_KEYS]);
  if (Object.keys(old).some((key) => !known.has(key))) return false;
  const rebuilt = {};
  for (const key of Object.keys(current)) {
    if (key === "schema") rebuilt.schema = current.schema;
    else if (key === "path") rebuilt.path = normalizePathValue(old.path);
    else rebuilt[key] = old[key];
  }
  return JSON.stringify(rebuilt) === JSON.stringify(current);
}

function legacyApprovalExists(store, file, gate) {
  const records = legacyApprovalIndex(store).get(resolve(file) + "\0" + gate.id);
  if (!records) return false;
  const current = oracleAbsolute(file, gate);
  if (!records.some((record) => legacyMatches(record, current))) return false;
  assertApprovalDirUnchanged(store);
  return true;
}

async function recordApproval(file, gate) {
  const store = validatedApprovalDir({ create: true });
  const token = approvalPath(file, gate, store.path);
  const lock = token + ".lock";
  const deadline = Date.now() + 10000;
  const owner = randomBytes(16).toString("hex");
  let fd = null;
  for (;;) {
    try { fd = openSync(lock, "wx", 0o600); break; }
    catch (error) {
      if (error.code !== "EEXIST") throw error;
      // Fail closed instead of trying to steal by path: an owner can release
      // and a successor can acquire between stat and unlink.
      try { statSync(lock); } catch (statError) {
        if (statError.code === "ENOENT") continue;
        throw statError;
      }
      if (Date.now() >= deadline) throw new Error("timed out waiting for approval lock");
      await sleep(20);
    }
  }
  try {
    writeFileSync(fd, JSON.stringify({ owner, pid: process.pid, at: Date.now() }));
    const identity = approvalIdentity(file, gate);
    const value = identity.portable
      ? { schema: 2, ledger: identity.ledger, gate: gate.id, signature: identity.signature,
        oracle: oracle(file, gate), approvedAt: new Date().toISOString() }
      : { schema: 1, file: resolve(file), gate: gate.id, signature: identity.signature,
        oracle: oracle(file, gate), approvedAt: new Date().toISOString() };
    writeAtomic(token, JSON.stringify(value, null, 2) + "\n");
    assertApprovalDirUnchanged(store);
  } finally {
    try { closeSync(fd); } catch { /* ignore */ }
    try {
      const current = JSON.parse(readFileSync(lock, "utf8"));
      if (current.owner === owner) unlinkSync(lock);
    } catch { /* manual cleanup or a successor owns the lock */ }
  }
}

function printOracle(file, gate, prefix) {
  const value = oracleAbsolute(file, gate);
  console.log(prefix + " " + qualified(file, gate.id));
  console.log("    CHECK: " + value.check);
  console.log("    EXPECT: " + value.expect);
  console.log("    CWD: " + value.cwd);
  console.log("    SHELL: " + value.shell);
  console.log("    PATH: " + pathTranscript);
}

let activeRegexWorkers = 0;
const regexWaiters = [];

function acquireRegexWorker() {
  if (activeRegexWorkers < MAX_REGEX_WORKERS) {
    activeRegexWorkers++;
    return Promise.resolve();
  }
  return new Promise((done) => regexWaiters.push(done));
}

function releaseRegexWorker() {
  const next = regexWaiters.shift();
  if (next) next();
  else activeRegexWorkers--;
}

// The 250 ms budget is the Unlazy original's. It protects against catastrophic
// patterns and normally stays exactly 250 ms. A pattern that is merely linear
// still needs time in proportion to the text it scans, so an output of
// REGEX_BUDGET_STEP_BYTES or more gets another 250 ms per full step (capped), or
// a long, correct output would turn red for its size alone.
function regexBudgetMs(bytes) {
  return Math.min(REGEX_BUDGET_CAP_MS, REGEX_TIMEOUT_MS * (1 + Math.floor(bytes / REGEX_BUDGET_STEP_BYTES)));
}

// EXPECT on the captured output (segments of files, see lib/output-scan.mjs).
async function safeExpectMatch(expectation, segments) {
  if (expectation.kind === "text") {
    try { return { matched: await includesText(segments, expectation.value) }; }
    catch (error) { return { matched: false, error: "cannot read the check output: " + error.message }; }
  }
  const budgetMs = regexBudgetMs(segmentsBytes(segments));
  await acquireRegexWorker();
  try {
    return await new Promise((done) => {
      let worker;
      let settled = false;
      let startupTimer = null;
      let matchTimer = null;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        if (startupTimer) clearTimeout(startupTimer);
        if (matchTimer) clearTimeout(matchTimer);
        if (worker) worker.terminate().catch(() => {});
        done(value);
      };
      try { worker = new Worker(new URL("./lib/regex-worker.mjs", import.meta.url)); }
      catch (error) {
        finish({ matched: false, error: "EXPECT worker could not start: " + error.message });
        return;
      }
      startupTimer = setTimeout(() => finish({
        matched: false,
        error: "EXPECT worker startup exceeded " + REGEX_STARTUP_TIMEOUT_MS + "ms",
      }), REGEX_STARTUP_TIMEOUT_MS);
      worker.once("online", () => {
        if (settled) return;
        clearTimeout(startupTimer);
        startupTimer = null;
        // The worker reads the output file(s) itself and answers { ready }. The
        // catastrophic-backtracking budget starts only then: process startup, a
        // busy --jobs queue and reading a large output are not regex time.
        try { worker.postMessage({ source: expectation.source, flags: expectation.flags, segments }); }
        catch (error) { finish({ matched: false, error: error.message }); }
      });
      worker.on("message", (message) => {
        if (settled) return;
        if (message && message.ready === true) {
          matchTimer = setTimeout(() => finish({
            matched: false,
            error: "EXPECT regex exceeded " + budgetMs + "ms",
          }), budgetMs);
          try { worker.postMessage({ go: true }); }
          catch (error) { finish({ matched: false, error: error.message }); }
          return;
        }
        finish(message);
      });
      worker.once("error", (error) => finish({ matched: false, error: error.message }));
      worker.once("exit", (code) => {
        finish({ matched: false, error: "EXPECT worker exited " + code + " without a result" });
      });
    });
  } finally {
    releaseRegexWorker();
  }
}

// Check output lives in files inside a private work directory that is never
// inside the repository, and is removed when the run ends (also on exit and on
// SIGINT/SIGTERM). A relocated TMPDIR that points into the repository is not used.
let workDir = null;
let workCleanupRegistered = false;

function removeWorkDirectory() {
  if (!workDir) return;
  const directory = workDir;
  workDir = null;
  try { rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
  catch (error) {
    console.error("gate-check: warning: could not remove work directory " + directory + ": " + error.message);
  }
}

// A run killed hard (SIGKILL, power loss) cannot clean up after itself. Work
// directories of this tool that nobody touched for a week are removed by the next run.
const STALE_WORK_DIR_MS = 7 * 24 * 60 * 60 * 1000;
const WORK_DIR_PREFIX = "unlazy-gate-";

function sweepStaleWorkDirectories(base) {
  let names;
  try { names = readdirSync(base); } catch { return; }
  for (const name of names) {
    if (!name.startsWith(WORK_DIR_PREFIX)) continue;
    const path = join(base, name);
    try {
      const info = lstatSync(path);
      if (!info.isDirectory() || Date.now() - info.mtimeMs < STALE_WORK_DIR_MS) continue;
      rmSync(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    } catch { /* in use or not ours to remove: leave it */ }
  }
}

function workDirectory() {
  if (workDir) return workDir;
  const bases = [tmpdir(), join(homedir(), ".unlazy", "work")];
  let lastError = null;
  for (const base of bases) {
    try {
      mkdirSync(base, { recursive: true, mode: 0o700 });
      if (pathIsInside(canonicalRoot, realpathSync(base))) continue;
      sweepStaleWorkDirectories(base);
      workDir = mkdtempSync(join(base, WORK_DIR_PREFIX));
      break;
    } catch (error) { lastError = error; }
  }
  if (!workDir) {
    throw new Error("no work directory outside the repository for check output" + (lastError ? ": " + lastError.message : ""));
  }
  if (!workCleanupRegistered) {
    workCleanupRegistered = true;
    process.on("exit", removeWorkDirectory);
    for (const [name, code] of [["SIGINT", 130], ["SIGTERM", 143]]) process.once(name, () => process.exit(code));
  }
  return workDir;
}

const forgetFile = (path) => { try { unlinkSync(path); } catch { /* the directory removal retries */ } };
let checkCounter = 0;

const failedResult = (task, error, extra = {}) => ({
  ...task, ok: false, exitCode: null, signal: null, matched: false, error,
  outputBytes: 0, outputSha256: sha256(""), outputDisplay: "", ...extra,
});

// A green result found in the proof store: nothing runs.
function reusedResult(task) {
  const { entry, commit } = task.reuse;
  return {
    ...task, ok: true, reused: true, exitCode: 0, signal: null, matched: true, error: null,
    outputBytes: entry.outputBytes, outputSha256: entry.outputSha256, outputDisplay: "", provedAt: commit,
  };
}

// With --at the CHECK runs in the clean copy of the commit (one per run, shared by all gates
// of the run, see below), never in the working copy.
let cleanCopy = null;

async function runCheck(task) {
  if (task.reuse) return reusedResult(task);
  if (!proofCtx) return runCheckIn(task, task.cwd);
  if (!cleanCopy) return failedResult(task, "clean copy of " + proofCtx.commit.slice(0, 8) + " is missing");
  const parts = task.proof.relCwd === "." ? [] : task.proof.relCwd.split("/");
  return { ...await runCheckIn(task, join(cleanCopy, ...parts)), cleanCopy: true };
}

// All gates of one --at run share one clean copy of the commit; it is made once, before the
// first CHECK, and removed once, after the last one.
async function runAll(tasks) {
  if (!proofCtx || !tasks.some((task) => !task.reuse)) return runRolling(tasks, jobs);
  try {
    return await withCleanCheckout(proofCtx.top, proofCtx.commit, async (directory) => {
      cleanCopy = directory;
      try { return await runRolling(tasks, jobs); }
      finally { cleanCopy = null; }
    });
  } catch (error) {
    const message = "clean copy of " + proofCtx.commit.slice(0, 8) + ": " + error.message;
    return tasks.map((task) => (task.reuse ? reusedResult(task) : failedResult(task, message)));
  }
}

async function runCheckIn(task, cwd) {
  const failed = (error, extra = {}) => failedResult(task, error, extra);
  let outFile;
  try { outFile = join(workDirectory(), "check-" + (++checkCounter) + ".out"); }
  catch (error) { return failed(error.message); }
  const errFile = outFile + ".stderr";
  try {
    let watched;
    try {
      // The supervisor keeps the process group alive until the shell and every
      // inherited stdout/stderr descriptor close; runWatched starts it like
      // spawn did, and ends the whole tree only if it is hung.
      watched = await runWatched(process.execPath, [CHECK_SUPERVISOR, shell, task.gate.check], {
        cwd, outputFile: outFile,
      });
    } catch (error) { return failed(error.message); }
    const segments = outputSegments(outFile, errFile);
    let fingerprint;
    let display;
    try {
      fingerprint = await fingerprintOutput(segments);
      display = (await readWindows(segments)).text;
    } catch (error) {
      return failed("cannot read the check output: " + error.message, { exitCode: watched.code, signal: watched.signal });
    }
    const runFault = watched.hung ? "HUNG: " + watched.hungReason
      : watched.spawnError ? String(watched.spawnError) : null;
    // A hung, unspawned or truncated run is red whatever the output says.
    const match = runFault ? { matched: false } : await safeExpectMatch(task.gate.expectation, segments);
    const error = runFault || match.error || null;
    return {
      ...task, exitCode: watched.code, signal: watched.signal, matched: Boolean(match.matched), error,
      outputBytes: fingerprint.bytes, outputSha256: fingerprint.sha256, outputDisplay: display,
      ok: !error && watched.code === 0 && Boolean(match.matched),
    };
  } finally {
    forgetFile(outFile);
    forgetFile(errFile);
  }
}

async function runRolling(tasks, limit) {
  const results = new Array(tasks.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const index = next++;
      if (index >= tasks.length) return;
      results[index] = await runCheck(tasks[index]);
    }
  }
  const workers = [];
  for (let index = 0; index < Math.min(limit, tasks.length); index++) workers.push(worker());
  await Promise.all(workers);
  return results;
}

// The path of `value` inside the repository --at looks at (posix, "." for its top), or null.
function topRelative(value) {
  let real = value;
  try { real = nativeRealpath(value); } catch { /* compare as given */ }
  for (const base of [proofCtx.top, proofCtx.canonicalTop]) {
    const rel = relative(base, real);
    if (rel === "") return ".";
    if (rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel)) return rel.replaceAll("\\", "/");
  }
  return null;
}

const pending = [];
for (const ledger of ledgers) {
  for (const gate of ledger.doc.gates) {
    if (ledger.doc.abandoned.has(gate.id) || !gate.check) continue;
    const state = gateState(gate, ledger.doc.abandoned);
    const approveOnly = !opt.reverify && state === "met" && opt.approve;
    if (opt.status || (!opt.reverify && state === "met" && !approveOnly)) continue;
    const cwd = resolvedGateCwd(gate, ledger.file);
    try {
      if (!statSync(cwd).isDirectory()) failUsage("gate " + qualified(ledger.file, gate.id) + " CWD is not a directory: " + cwd);
    } catch (error) {
      if (error.code === "ENOENT") failUsage("gate " + qualified(ledger.file, gate.id) + " CWD does not exist: " + cwd);
      failUsage("cannot inspect gate CWD " + cwd + ": " + error.message);
    }
    if (target.mode === "package" && !pathIsInside(root, cwd)) {
      failUsage("gate " + qualified(ledger.file, gate.id) + " CWD escapes repository: " + cwd);
    }
    let proofCwd = null;
    if (proofCtx && !approveOnly) {
      proofCwd = topRelative(cwd);
      if (proofCwd === null) {
        failUsage("gate " + qualified(ledger.file, gate.id) + " CWD is outside the Git repository, --at cannot check it: " + cwd);
      }
    }
    pending.push({ file: ledger.file, gate, cwd, proofCwd, wasMet: state === "met", approveOnly, signature: signature(ledger.file, gate) });
  }
}

// An open package amendment (<harnessRoot>/.unlazy/.amend/*.json) must be
// finished before any gate runs: this run would tick boxes and write EVIDENCE
// into the package, and `finish` would then fail with AMEND_EVIDENCE_CHANGED.
// The test comes before the first approval or check, writes nothing, and names
// the way out. A run that would not write (--status, a run with nothing to run,
// --approve of already met gates) is not affected.
//
// Prints why the run (or one write) must stop and returns true; false when
// nothing stands in the way. `late` names the single ledger whose write is
// refused after its checks ran (the repeat under the file lock); without it
// nothing has run yet.
function reportAmendStop(amendments, late = null) {
  // The warnings were printed by the test before the run; the repeat does not say them again.
  if (!late) for (const warning of amendments.warnings) console.error("gate-check: warning: " + warning);
  const outcome = late ? late + " was not written." : "Nothing was run or written.";
  if (amendments.unclear.length) {
    for (const item of amendments.unclear) {
      if (item.kind === "file") {
        console.error("gate-check: " + AMEND_UNCLEAR + ": cannot tell whether " + item.record + " belongs to an amended package: " +
          item.reason + ". " + outcome);
      } else {
        console.error("gate-check: " + AMEND_UNCLEAR + ": cannot tell whether " + item.record + " is an open amendment of" +
          " this package (" + item.reason + "). " + outcome);
      }
    }
    if (amendments.unclear.some((item) => item.kind === "file")) {
      console.error("NEXT: make git usable for the named file (git on PATH, the repository readable and trusted: safe.directory), then run gate-check again.");
    }
    if (amendments.unclear.some((item) => item.kind !== "file")) {
      console.error("NEXT: repair or remove the named file (package-amend.cjs deletes a record when its amendment is closed), then run gate-check again.");
    }
    return true;
  }
  if (amendments.open.length) {
    for (const amend of amendments.open) {
      console.error("gate-check: " + AMEND_OPEN + ": package " + amend.packageId + " has an open amendment" +
        " (session " + amend.sessionId + (amend.createdAt ? ", opened " + amend.createdAt : "") + ")." +
        " A run now would write checkboxes and EVIDENCE into the package and the amendment could no longer be finished" +
        " (AMEND_EVIDENCE_CHANGED). " + outcome);
      console.error("NEXT: finish the amendment: " + amend.finish);
      if (amend.undo) console.error("  or abort it and restore the package: " + amend.undo);
    }
    console.error("NEXT: then run gate-check again.");
    return true;
  }
  return false;
}

if (!opt.status && pending.some((task) => !task.approveOnly)) {
  // Repository and package id come from the ledger files themselves, never from
  // the working directory or --root: an absolute path from outside, or a foreign
  // --root, writes into the very same package.
  if (reportAmendStop(findOpenAmendmentsForFiles(target.files))) process.exit(2);
}

const runnable = [];
const notRun = [];
let approvalInfrastructureFailures = 0;
for (const task of pending) {
  let approved = false;
  try { approved = approvalExists(task.file, task.gate); }
  catch (error) {
    console.error("gate-check: could not validate approval for " + qualified(task.file, task.gate.id) + ": " + error.message);
    approvalInfrastructureFailures++;
    notRun.push(task);
    continue;
  }
  if (task.approveOnly && approved) continue;
  if (!approved) {
    printOracle(task.file, task.gate, "APPROVAL REQUIRED");
    if (!opt.approve) {
      console.log("    NOT RUN: inspect this oracle, then re-run with --approve");
      notRun.push(task);
      continue;
    }
    try {
      await recordApproval(task.file, task.gate);
      console.log("    APPROVED: " + approvalPath(task.file, task.gate, validatedApprovalDir().path));
    } catch (error) {
      console.error("gate-check: could not record approval for " + qualified(task.file, task.gate.id) + ": " + error.message);
      approvalInfrastructureFailures++;
      notRun.push(task);
      continue;
    }
  }
  if (task.approveOnly) continue;
  runnable.push(task);
}

if (process.platform === "win32" && runnable.length) {
  try {
    const store = validatedApprovalDir();
    if (!store) throw new Error("approval directory disappeared before execution");
    verifyWindowsPrivateDirectory(store.path);
  } catch (error) {
    console.error("gate-check: Windows approval ACL preflight failed: " + error.message);
    process.exit(2);
  }
}

// With --at: the key of each result, and a green result already stored for it.
function attachProof(task) {
  const parts = proofKeyFor(proofCtx.top, proofCtx.commit,
    { check: task.gate.check, expect: task.gate.expect, cwd: task.proofCwd, shell: shellId },
    { scope: proofCtx.scope, checker: proofCtx.checker });
  task.proof = {
    key: parts.key, relCwd: task.proofCwd, cacheable: cacheable(task.gate) && !proofCtx.cacheOff, checker: parts.checker.digest,
  };
  // A gate that is not cacheable (CACHE: no, a model, the network, a run whose checker or
  // node_modules the commit does not pin) never reuses a result, whatever is stored.
  if (task.proof.cacheable) {
    const found = findProof(proofCtx.top, proofCtx.commit, parts.key);
    if (found) task.reuse = found;
  }
}

if (proofCtx && !opt.status) {
  try { for (const task of runnable) attachProof(task); }
  catch (error) {
    console.error("gate-check: cannot compute the code state of " + proofCtx.commit + ": " + error.message);
    process.exit(2);
  }
}

for (const task of runnable) {
  if (task.reuse) continue;
  console.log("  RUN  " + qualified(task.file, task.gate.id) + " shell=" + shell + " cwd=" + task.cwd +
    (proofCtx ? " at=" + proofCtx.commit.slice(0, 8) + " (clean copy)" : "") + " PATH=" + pathTranscript);
}
const results = opt.status ? [] : await runAll(runnable);
removeWorkDirectory();
for (const result of results) {
  // Length and SHA-256 stand in for the output text; the shortened display text
  // is for the message only and never takes part in a verdict.
  const outputSummary = result.ok
    ? "sha256=" + result.outputSha256 + "; bytes=" + result.outputBytes
    : failureOutput(result.outputDisplay) + "; sha256=" + result.outputSha256 + "; bytes=" + result.outputBytes;
  const outcome = "exit=" + (result.exitCode === null ? "none" : result.exitCode) +
    (result.signal ? " signal=" + result.signal : "") +
    "; EXPECT=" + (result.matched ? "matched" : "not matched") +
    "; output=" + outputSummary;
  if (result.ok) {
    console.log("  PASS " + qualified(result.file, result.gate.id) + ": " + result.gate.title);
    console.log("       " + outcome);
    if (result.reused) {
      console.log("       PROOF_REUSED " + result.proof.key.slice(0, PROOF_PREFIX) + " (proved on " + result.provedAt.slice(0, 8) + ", nothing ran)");
    }
  } else {
    console.log("  FAIL " + qualified(result.file, result.gate.id) + ": " + result.gate.title);
    console.log("       " + (result.error ? result.error + "; " : "") + outcome);
  }
}

function failureOutput(output, max = 480) {
  const lines = String(output).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length <= 8) return (lines.join(" | ") || "(no output)").slice(0, max);
  const summary = [...lines.slice(0, 6), "...", ...lines.slice(-2)].join(" | ");
  return summary.slice(0, max);
}

// With --at the result carries the key of the code state it was made for, and the commit
// it was proved on (this one, or the earlier one a reused result hangs on).
function proofEvidence(result) {
  if (!result.proof) return "";
  const commit = result.reused ? result.provedAt : proofCtx.commit;
  return "; proof=" + result.proof.key.slice(0, PROOF_PREFIX) + "@" + commit.slice(0, 8);
}

function evidenceFor(result) {
  const clean = (value) => terminalSafe(value).replace(/[\r\n\t]+/g, " ");
  const fingerprint = { sha256: result.outputSha256, bytes: result.outputBytes };
  if (target.mode === "package") {
    return ("schema=2; exit=0; shellId=" + clean(shellId) + "; cwd=" + portablePath(result.cwd) +
      "; EXPECT=matched; output-sha256=" + fingerprint.sha256 +
      "; output-bytes=" + fingerprint.bytes).slice(0, 900) + proofEvidence(result);
  }
  return ("exit=0; shell=" + clean(shell) + "; cwd=" + clean(result.cwd) +
    "; path=" + pathEvidence + "; EXPECT=matched; output-sha256=" + fingerprint.sha256 +
    "; output-bytes=" + fingerprint.bytes).slice(0, 900) + proofEvidence(result);
}

function insertOrUpdateEvidence(doc, gate, value) {
  if (gate.evidenceLine !== -1) {
    const indent = (doc.lines[gate.evidenceLine].match(/^\s*/) || ["  "])[0];
    doc.lines[gate.evidenceLine] = indent + "EVIDENCE: " + value;
    return;
  }
  let line = gate.line + 1;
  while (line < doc.lines.length && /^\s+(CHECK|EXPECT|EVIDENCE|CWD|CACHE):/.test(doc.lines[line])) line++;
  doc.lines.splice(line, 0, "  EVIDENCE: " + value);
}

const resultKey = (file, id) => resolve(file) + "\0" + id;
const staleResults = new Map();
for (const result of results) {
  if (!result.ok && !(opt.reverify && result.wasMet)) continue;
  try {
    await withFileLock(root, result.file, () => {
      // The checks of this run took time: an amendment may have been opened since the
      // test before them. Repeat it for exactly this file, now that nobody else can
      // write it, and write nothing if it no longer passes.
      if (reportAmendStop(findOpenAmendmentsForFiles([result.file]), result.file)) {
        process.exitCode = 2;
        return;
      }
      let doc = parseGates(readFileSync(result.file, "utf8"));
      if (doc.errors.length) throw new Error("fresh ledger became invalid: " + doc.errors.join("; "));
      const fresh = doc.gates.find((gate) => gate.id === result.gate.id);
      if (!fresh || signature(result.file, fresh) !== result.signature) {
        staleResults.set(resultKey(result.file, result.gate.id), qualified(result.file, result.gate.id));
        console.log("  STALE " + qualified(result.file, result.gate.id) + ": CHECK/EXPECT/CWD/shell signature changed; result not written");
        return;
      }
      if (result.ok) {
        // The output hash changes with every run and is no reason to write the package again:
        // when the gate is already met under the same key, the file stays as it is (B10).
        const recorded = fresh.evidence ? PROOF_EVIDENCE_RE.exec(fresh.evidence) : null;
        if (result.proof && fresh.checked && recorded && recorded[1] === result.proof.key.slice(0, PROOF_PREFIX)) {
          console.log("  UNCHANGED " + qualified(result.file, result.gate.id) + ": same proof key, ledger not rewritten");
          return;
        }
        doc.lines[fresh.line] = doc.lines[fresh.line].replace(/^- \[( |x|X)\]/, "- [x]");
        insertOrUpdateEvidence(doc, fresh, evidenceFor(result));
      } else {
        doc.lines[fresh.line] = doc.lines[fresh.line].replace(/^- \[(x|X)\]/, "- [ ]");
        insertOrUpdateEvidence(doc, fresh, "pending");
      }
      writeAtomic(result.file, formatDocument(doc));
    });
  } catch (error) {
    console.error("gate-check: cannot update " + result.file + ": " + error.message);
    process.exitCode = 2;
  }
}
if (process.exitCode === 2) process.exit(2);

// Green results made in a clean copy go onto the commit, through the Harness's git-intent only.
// Red never, nothing that is not cacheable, and nothing that was only reused.
if (proofCtx) {
  const seen = new Set();
  const storable = results.filter((result) => {
    if (!result.ok || result.reused || !result.cleanCopy || !result.proof || !result.proof.cacheable) return false;
    if (seen.has(result.proof.key)) return false;
    seen.add(result.proof.key);
    return true;
  });
  if (storable.length && !proofCtx.noteWriter) {
    console.error("gate-check: note: " + storable.length + " green result(s) not stored, no Harness git-intent next to this" +
      " checker (plain Unlazy); they are not reused");
  } else if (storable.length) {
    const at = new Date().toISOString();
    const stored = writeProof(proofCtx.top, proofCtx.commit, storable.map((result) => ({
      key: result.proof.key, result: "green", outputSha256: result.outputSha256, outputBytes: result.outputBytes,
      checker: result.proof.checker, at, gate: { package: target.packageId || null, id: result.gate.id },
    })), { noteWriter: proofCtx.noteWriter });
    if (stored.written) {
      console.log("  PROOF_STORED " + stored.written + " result(s) on " + proofCtx.commit.slice(0, 8));
    } else {
      console.error("gate-check: PROOF_NOT_STORED: " + (stored.error || stored.reason));
    }
  }
}

ledgers = target.files.map(loadLedger);
let totalMet = 0;
let totalUnmet = 0;
let totalAbandoned = 0;
let reverified = 0;
const unmetIds = [];
const abandonedIds = [];
const finalStates = new Map();
for (const result of results) {
  if (opt.reverify && result.wasMet && !staleResults.has(resultKey(result.file, result.gate.id))) reverified++;
}

for (const ledger of ledgers) {
  for (const gate of ledger.doc.gates) {
    const state = gateState(gate, ledger.doc.abandoned);
    finalStates.set(resultKey(ledger.file, gate.id), state);
    if (state === "abandoned") {
      totalAbandoned++;
      abandonedIds.push(qualified(ledger.file, gate.id));
    }
    else if (state === "met") totalMet++;
    else {
      totalUnmet++;
      unmetIds.push(qualified(ledger.file, gate.id));
      if (opt.status) {
        console.log("  UNMET " + qualified(ledger.file, gate.id) + " (" +
          (state === "unmet" ? "unchecked" : "checked but EVIDENCE pending") + "): " + gate.title);
      }
    }
  }
  console.log(basename(ledger.file) + ": " + ledger.doc.gates.length + " gates");
}

// A scoped pipeline is complete only when both its ledgers and its native
// dispatch waves are resolved. Per-wave `dispatch-check status` is useful for
// inspection, but completion cannot depend on callers remembering a second
// command (or on the optional Stop hook being installed).
// An exact leaf run verifies only that leaf before its dispatch return can be
// recorded. The package-wide run remains responsible for unfinished waves.
const aggregateDispatch = opt.leaf && !action
  ? { blocking: [], abandoned: [], resolved: [], errors: [] }
  : dispatchStatus(root, scope, target.mode === "package" ? target.packageId : null);
if (aggregateDispatch.errors.length) {
  for (const error of aggregateDispatch.errors) console.error("gate-check: " + error);
  process.exit(2);
}
totalAbandoned += aggregateDispatch.abandoned.length;
abandonedIds.push(...aggregateDispatch.abandoned);
if (opt.status) {
  for (const blocker of aggregateDispatch.blocking) console.log("  UNMET " + blocker);
}

const where = scope ? " [scope " + scope + "]" : "";
const verifyNote = opt.reverify
  ? ", reran: " + results.length + ", previously met reverified: " + reverified
  : "";
const unverifiedMet = opt.reverify ? notRun.filter((task) => task.wasMet) : [];
const extraUnmet = new Map();
for (const task of unverifiedMet) {
  const key = resultKey(task.file, task.gate.id);
  const state = finalStates.get(key);
  if (state === "met" || state === undefined) extraUnmet.set(key, qualified(task.file, task.gate.id) + " (reverify not run)");
}
for (const [key, label] of staleResults) {
  const state = finalStates.get(key);
  if (state === "met" || state === undefined) extraUnmet.set(key, label + " (stale result discarded)");
}
const effectiveUnmet = totalUnmet + extraUnmet.size + aggregateDispatch.blocking.length;
unmetIds.push(...extraUnmet.values());
unmetIds.push(...aggregateDispatch.blocking);
if (approvalInfrastructureFailures) {
  console.error("gate-check: infrastructure failure prevented " + approvalInfrastructureFailures + " approval(s)");
  process.exit(2);
}
if (effectiveUnmet === 0 && totalAbandoned === 0) {
  console.log("ALL MET (" + totalMet + " met" + verifyNote + ")" + where);
  process.exit(0);
}
if (totalAbandoned) {
  console.log("HANDOFF REQUIRED: " + totalAbandoned + " abandoned (met: " +
    Math.max(0, totalMet - extraUnmet.size) + (effectiveUnmet ? ", unmet: " + effectiveUnmet : "") +
    verifyNote + ")" + where);
  console.log("  " + abandonedIds.slice(0, 12).join(", ") +
    (abandonedIds.length > 12 ? ", +" + (abandonedIds.length - 12) + " more" : ""));
}
if (effectiveUnmet) {
  console.log("UNMET: " + effectiveUnmet + " (met: " + Math.max(0, totalMet - extraUnmet.size) +
    (totalAbandoned ? ", abandoned: " + totalAbandoned : "") + verifyNote + ")" + where);
  console.log("  " + unmetIds.slice(0, 12).join(", ") + (unmetIds.length > 12 ? ", +" + (unmetIds.length - 12) + " more" : ""));
}
process.exit(1);
