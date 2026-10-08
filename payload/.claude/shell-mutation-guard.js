#!/usr/bin/env node
"use strict";

// Application-level PreToolUse mutation boundary for every governed agent shell call.
// It holds whether or not a package is bound (audit H6, 09.09.2026): the shell is not
// statically decidable, so executable code is fail-closed -- only named repository
// verifiers, canonical mutation tools and the declared Dashboard service may run.
// Ordinary read-only inspection remains available. This does not claim OS sandboxing;
// a human terminal and trusted allowlisted programs are outside it.

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const GUARD_TARGET = ".claude/shell-mutation-guard.js";

// Inline deny transport (identical in every PreToolUse guard; guard-parity E5): a missing
// sibling module must never turn a denial into an allow. Under the Codex hook runner a
// JSON deny with exit 0 survives Windows PowerShell, which maps a native exit 2 to 1.
// Every other error of the hook process denies the same way (guard-parity A9, fail closed): the
// two handlers are armed here, before any helper module loads, so a failure while loading, a throw
// inside the decision and an unhandled rejection all end in block(). Only the hook main program is
// armed; a library require and --self-test are not. KEEL_GUARD_TEST_THROW forces an error for the
// tests: "1" throws at load, "reject" leaves an unhandled rejection, "late" throws after the input ended.
function block(message) {
  const reason = String(message).trim() || GUARD_TARGET + ": tool denied";
  if (process.env.KEEL_HARNESS_ROOT && process.env.KEEL_HOOK_TARGET === GUARD_TARGET) {
    fs.writeSync(1, JSON.stringify({ hookSpecificOutput: {
      hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason,
    } }) + "\n");
    process.exit(0);
  }
  fs.writeSync(2, reason + "\n");
  process.exit(2);
}
if (require.main === module && !process.argv.some((arg) => arg === "--self-test" || arg === "--selbsttest")) {
  const failClosed = (error) => {
    try {
      block(GUARD_TARGET.replace(/^.*\//u, "").replace(/\.c?js$/u, "") + ": internal error; tool blocked: " +
        ((error && error.message) || error));
    } catch { process.exit(2); }
  };
  process.on("uncaughtException", failClosed);
  process.on("unhandledRejection", failClosed);
  const forced = process.env.KEEL_GUARD_TEST_THROW;
  if (forced === "reject") Promise.reject(new Error("forced test error"));
  if (forced === "late") process.stdin.once("end", () => { throw new Error("forced test error"); });
  if (forced === "1") throw new Error("forced test error");
}
// End inline deny transport
// A partial or corrupted guard install (e.g. a deleted sibling guard) must block, not
// pass: dependency failures emit a protocol-specific denial (Codex exit-0 JSON,
// direct Claude exit 2), not a bare crash (audit follow-up 425, 09.09.2026). As an imported module
// the real error is surfaced so tests and callers never see a silently stubbed guard.
let gitGuard;
let commandModel;
let ownerHandoff;
let guardRoutes;
let hookContext;
let ownedShellWrite;
let writeGuard;
let packageBootstrap;
let repository;
let paketGate;
let publishProjects;
let sessionScope;
try {
  gitGuard = require("./git-intent-guard.js");
  commandModel = require("../harness-core/guards/command-model.cjs");
  ownerHandoff = require("../harness-core/guards/owner-handoff.cjs");
  guardRoutes = require("../harness-core/guards/guard-routes.cjs");
  hookContext = require("../harness-core/guards/hook-context.cjs");
  ownedShellWrite = require("../harness-core/guards/owned-shell-write.cjs");
  writeGuard = require("./write-guard.js");
  packageBootstrap = require("../harness-core/binding/package-bootstrap.cjs");
  repository = require("../harness-core/binding/repository.cjs");
  paketGate = require("./paket-gate.js");
  publishProjects = require("../harness-core/guards/publish-projects.cjs");
  sessionScope = require("../harness-core/guards/session-scope.cjs");
} catch (error) {
  if (require.main === module) {
    block("shell-mutation-guard: dependency load failed; command blocked: " + error.message);
  }
  throw error;
}

const READ_ONLY_COMMANDS = new Set([
  "[", "cat", "cd", "cmp", "command", "cut", "diff", "dir", "echo", "exit", "false", "fd", "file",
  "findstr", "format-list", "format-table", "gc", "gci", "get-childitem", "get-content", "get-filehash",
  "get-item", "get-location", "grep", "head", "jq", "less", "ls", "measure-object", "more", "pop-location",
  "printf", "push-location", "pwd", "readlink", "realpath", "resolve-path", "rg", "select-object", "select-string",
  "sls", "sort", "stat", "tail", "test", "test-path", "tr", "tree", "true", "type", "uniq", "wc", "where",
  "where.exe", "which", "write-output",
  // PowerShell forms of the same read-only work (guard-parity E3): filtering and shaping the
  // output of a read (Where-Object ~ grep, ForEach-Object ~ awk -- its script block is judged
  // command by command --, Sort-/Group-/Compare-Object ~ sort/uniq/diff, JSON ~ jq), changing
  // the working directory, printing, and pausing.
  "?", "%", "foreach", "foreach-object", "where-object", "sort-object", "group-object", "compare-object",
  "convertfrom-json", "convertto-json", "out-string", "out-null", "out-host", "split-path", "join-path",
  "set-location", "sl", "chdir", "gl", "gi", "select", "measure", "ft", "fl", "write-host", "get-date",
  "start-sleep", "sleep",
  // Loop and condition helpers that only read or compute (guard-scope R2): reading a line,
  // testing, path parts, counting, the date and leaving a loop. awk, export, set, source and
  // xargs stay out: they run code or change the shell.
  "read", "[[", "basename", "dirname", "seq", "date", "break", "continue", "get-command", "gcm",
  // Process and port queries that only read (harness-gaps R1): Get-CimInstance and Get-WmiObject
  // are judged by classifyCim, Stop-Process and taskkill by classifyProcessStop.
  "get-process", "get-nettcpconnection",
  // Harmless reading and formatting (package shell-grants, A4): disk use, process lists, CSV
  // conversion, object inspection, and Measure-Command, whose script block is judged command
  // by command like that of ForEach-Object (inspectPowerShell reads every command of the block).
  // awk and gawk are judged by classifyAwk, ollama, gh and claude by their own classifiers.
  "du", "ps", "tasklist", "convertto-csv", "convertfrom-csv", "import-csv", "get-member", "add-member",
  "measure-command",
]);

const WRITE_COMMANDS = new Set([
  "add-content", "ac", "clear-content", "copy-item", "cp", "del", "erase", "install", "mkdir", "move-item",
  "mv", "new-item", "ni", "out-file", "remove-item", "rename-item", "ren", "rm", "rmdir", "rsync", "sc",
  "set-content", "tee", "touch", "truncate", "writealltext", "writefile", "writefilesync",
  // PowerShell aliases and item writers of the same kinds (guard-parity E3).
  "ri", "rd", "copy", "cpi", "move", "mi", "rni", "md", "clc", "tee-object", "set-item", "si", "clear-item",
  "cli", "new-itemproperty", "set-itemproperty", "sp", "remove-itemproperty", "rp", "rename-itemproperty",
  "rnp", "export-csv", "epcsv", "export-clixml", "expand-archive", "compress-archive",
  // Writers of files in the working directory (package shell-grants, A6).
  "split", "csplit",
]);

// Commands that run a second command outside static policy, in either shell.
const DYNAMIC_COMMANDS = new Set(["sudo", "eval", "invoke-expression", "iex", "xargs", "start-process", "saps",
  "start", "invoke-command", "icm", "start-job", "sajb", "invoke-item", "ii"]);

// .NET members a PowerShell command may call: string, path and conversion helpers that read
// and compute only -- the counterpart of the text tools Bash may run. Every other method call
// is inline code, refused like `node -e` (guard-parity E3).
const READ_ONLY_INSTANCE_MEMBERS = new Set(["trim", "trimstart", "trimend", "replace", "split", "substring",
  "tolower", "toupper", "tolowerinvariant", "toupperinvariant", "contains", "startswith", "endswith", "indexof",
  "lastindexof", "padleft", "padright", "tostring", "equals", "gettype", "compareto", "containskey", "join",
  "format", "normalize", "getstring", "getbytes", "where", "foreach",
  // Collections and hashtables in memory (package shell-grants, A4): `$list.Add($x)`,
  // `$map.Remove('k')`. Static calls such as [System.IO.File]::Delete stay on the list below.
  "add", "addrange", "remove", "removeat", "insert", "clear", "push", "pop", "enqueue", "dequeue", "set_item",
  "get_item", "trygetvalue", "toarray", "sort"]);
const READ_ONLY_STATIC_MEMBERS = new Map([
  ["string", new Set(["join", "format", "isnullorempty", "isnullorwhitespace", "concat", "equals", "compare"])],
  ["system.string", new Set(["join", "format", "isnullorempty", "isnullorwhitespace", "concat", "equals", "compare"])],
  ["io.path", new Set(["combine", "getfilename", "getdirectoryname", "getextension", "getfilenamewithoutextension",
    "getfullpath", "isrooted", "getpathroot", "gettemppath", "join"])],
  ["system.io.path", new Set(["combine", "getfilename", "getdirectoryname", "getextension", "getfilenamewithoutextension",
    "getfullpath", "isrooted", "getpathroot", "gettemppath", "join"])],
  ["convert", new Set(["tobase64string", "frombase64string", "toint32", "toint64", "todouble", "toboolean", "tostring"])],
  ["system.convert", new Set(["tobase64string", "frombase64string", "toint32", "toint64", "todouble", "toboolean", "tostring"])],
  ["math", new Set(["min", "max", "round", "floor", "ceiling", "abs", "pow", "sqrt"])],
  ["system.math", new Set(["min", "max", "round", "floor", "ceiling", "abs", "pow", "sqrt"])],
  ["regex", new Set(["escape", "match", "matches", "ismatch", "replace", "split", "unescape"])],
  ["system.text.regularexpressions.regex", new Set(["escape", "match", "matches", "ismatch", "replace", "split", "unescape"])],
  ["text.encoding", new Set(["getencoding"])],
  ["system.text.encoding", new Set(["getencoding"])],
  ["environment", new Set(["getenvironmentvariable", "getfolderpath"])],
  ["system.environment", new Set(["getenvironmentvariable", "getfolderpath"])],
  ["datetime", new Set(["parse", "tryparse", "parseexact", "fromfiletime"])],
  ["system.datetime", new Set(["parse", "tryparse", "parseexact", "fromfiletime"])],
  ["guid", new Set(["newguid", "parse"])],
  ["system.guid", new Set(["newguid", "parse"])],
]);

const VERIFIER_PATHS = new Set([
  "checks/codex-runtime-smoke.mjs",
  "checks/completeness-repair.mjs",
  "checks/dashboard-e2e.mjs",
  "checks/distribution-lifecycle.mjs",
  "checks/evidence-integrity.mjs",
  "checks/execution-lifecycle.mjs",
  "checks/external-boundary.mjs",
  "checks/governance-hardening.mjs",
  "checks/installed-harness.mjs",
  "checks/integration-contract.mjs",
  "checks/lifecycle-gate-evidence.mjs",
  "checks/mutation-boundary.mjs",
  "checks/no-google-identity.mjs",
  "checks/onboarding-ready.mjs",
  "checks/package-runtime-audit.mjs",
  // Prints the scope of a matrix phase (P9); reads only.
  "checks/phase-scope.mjs",
  "checks/reference-boundary.mjs",
  "checks/refresh-inventory.mjs",
  "checks/requirements-audit.mjs",
  "checks/run-all.mjs",
  "checks/test-matrix.mjs",
  "checks/ui-shots.mjs",
  "voice/check.mjs",
  "standalone/checks/dashboard-list.mjs",
  "standalone/checks/fresh-install.mjs",
  "standalone/checks/manifest-check.mjs",
  "standalone/checks/run-all.mjs",
  "vendor/unlazy/scripts/dispatch-check.mjs",
  "vendor/unlazy/scripts/gate-check.mjs",
  "vendor/unlazy/tests/full-suite.mjs",
  // The measuring tool of the agents (package shell-grants, A5): free memory, process lists
  // and a sampled series, one JSON object on stdout, nothing written.
  "harness-core/tools/measure.mjs",
  // The command index of the guards (package P6, D17): prints the allowed way of every intent and every
  // block code, built from these very lists; it writes nothing.
  "harness-core/guards/command-index.mjs",
]);

// Test files are not listed (package shell-grants, A20): node --test runs every file that lies
// directly in a test/ folder of the installation root or of an Owner product root and ends in
// .test.js, .test.mjs or .test.cjs (productTest). Further test files an installation Owner
// declares in .claude/mutation-policy.json (testPaths) run as well.
const NO_BUILT_IN_TESTS = new Set();

// Bibliotheken unter checks/: keine Einstiegspunkte, deshalb nicht ausfuehrbar und nicht in
// VERIFIER_PATHS -- aber ausdruecklich benannt, damit der Pflegetest jeden Pfad unter checks/ und
// standalone/checks/ entweder hier oder dort findet (Audit B8).
const LIBRARY_PATHS = new Set([
  "checks/matrix-reuse.mjs",
  "checks/audit-lib.mjs",
  "checks/bounded-runner.mjs",
]);

// Langlaufende, empfaengerseitige Dienste: der einzige Dashboard-Startweg des Vertrags.
// Ohne diese Deklaration war `node dashboard/serve.mjs` fuer jeden Agenten gesperrt
// (Audit H5). Erlaubt ist die Form `node dashboard/serve.mjs [--port <n>]` plus die
// Sprachflags des Starters (--voice | --speech | --microphone | --no-inference); ohne sie
// waere die portierte Sprachlaufzeit fuer Agenten unerreichbar.
const SERVICE_VOICE_FLAGS = new Set(["--voice", "--speech", "--microphone", "--no-inference"]);

const SERVICE_PATHS = new Set([
  "dashboard/serve.mjs",
]);

// The package tools that write package state themselves under their own checks: bootstrap,
// executor, amendment (package-amend.mjs) and resolution (package-resolve.mjs) of a package
// bundle, and the one Git route. scripts/release-standalone.mjs exists only in a product source
// tree: the one release route of the product (guard-parity E11); in an installation the path
// names no file and stays closed.
const CANONICAL_MUTATION_PATHS = new Set([
  "harness-core/execution/package-amend.mjs",
  "harness-core/execution/package-bootstrap.mjs",
  "harness-core/execution/package-executor.mjs",
  "harness-core/execution/package-resolve.mjs",
  "harness-core/git/git-intent.mjs",
  "scripts/build-standalone.mjs",
  "scripts/release-standalone.mjs",
]);

// Read-only subcommands of the vendored package CLI that the package instructions prescribe
// (harness-gaps R2): they inspect package state and write nothing. create, activate, close and
// duty-* write and stay undeclared.
const READ_ONLY_TOOL_COMMANDS = new Map([
  ["vendor/unlazy/scripts/package-cli.mjs", new Set(["doctor", "status", "lint", "list", "measure"])],
]);

// The package tool of the package instructions (package-write-only R4). It reads freely and
// writes only the bundle bound to the calling session (classifyPackageTool).
const PACKAGE_TOOL_PATHS = [".claude/skills/package-standard/package-standard.mjs"];
const PACKAGE_TOOL_COMMANDS = new Set(["create", "import", "undo", "prepare"]);

const GUARD_SELF_TESTS = new Set([
  ".claude/danger-guard.js",
  ".claude/dod-guard.js",
  ".claude/git-intent-guard.js",
  ".claude/package-context.js",
  ".claude/paket-gate.js",
  ".claude/pretool-guards.js",
  ".claude/prompt-form.js",
  ".claude/shell-mutation-guard.js",
  ".claude/uncommitted-warn.js",
  ".claude/unlazy-stop.js",
  ".claude/write-guard.js",
]);

// Owner mutation policy (audit 06.09.2026, B7). The finite policy above is the product's own;
// an installation Owner extends it in .claude/mutation-policy.json without touching guard code.
// Every entry must be a relative path inside the installation root that names one regular file.
// An invalid policy blocks every executable classification fail-closed (POLICY_INVALID) while
// read-only inspection keeps working; agents may not edit the file (write-guard W4).
const POLICY_FILE = ".claude/mutation-policy.json";
const POLICY_LISTS = { verifierPaths: "verifier", testPaths: "test", servicePaths: "service", mutationPaths: "mutation" };
const MCP_TOOL_NAME = /^mcp__[A-Za-z0-9_-]+__[A-Za-z0-9_-]+$/u;

function emptyPolicy(file) {
  return { file, present: false, error: null, verifier: new Set(), test: new Set(), service: new Set(), mutation: new Set(),
    mcpAllow: new Set(), productRoots: [], publishProjects: [] };
}

// Owner list productRoots (guard-parity E11): directories inside the installation root that
// hold a Keel Harness product source tree. The product's own declared verifiers, tests,
// service and mutation tools then run relative to that tree too, so work on the product
// needs no confirmation from a session rooted in the installation. A root is accepted only
// when it carries the product marker (its own .claude/shell-mutation-guard.js).
function productRootProblem(root, entry) {
  if (typeof entry !== "string" || !entry.trim()) return "entries must be non-empty strings";
  if (entry.includes("\0") || /^[A-Za-z]:/u.test(entry) || /^[\\/]/u.test(entry) ||
      entry.split(/[\\/]/u).some((part) => part === ".." || part === "." || part === "")) {
    return "unsafe path " + JSON.stringify(entry);
  }
  const full = path.join(root, ...entry.split(/[\\/]/u));
  if (!normalized(full).startsWith(normalized(root) + "/")) return "path escapes the installation root: " + entry;
  try {
    const info = fs.lstatSync(full);
    if (info.isSymbolicLink() || !info.isDirectory()) return "product root is not one real directory: " + entry;
  } catch { return "product root does not exist: " + entry; }
  if (!safeRegular(path.join(full, ".claude", "shell-mutation-guard.js"))) return "product root carries no Keel Harness product source: " + entry;
  return null;
}

function policyPathProblem(root, entry) {
  if (typeof entry !== "string" || !entry.trim()) return "entries must be non-empty strings";
  if (entry.includes("\0") || /^[A-Za-z]:/u.test(entry) || /^[\\/]/u.test(entry) ||
      entry.split(/[\\/]/u).some((part) => part === ".." || part === "." || part === "")) {
    return "unsafe path " + JSON.stringify(entry);
  }
  const full = path.join(root, ...entry.split(/[\\/]/u));
  if (!normalized(full).startsWith(normalized(root) + "/")) return "path escapes the installation root: " + entry;
  if (!safeRegular(full)) return "path is not one regular file: " + entry;
  return null;
}

function loadMutationPolicy(projectRoot) {
  const root = path.resolve(projectRoot || process.cwd());
  const file = path.join(root, ".claude", "mutation-policy.json");
  const policy = emptyPolicy(file);
  let info;
  try { info = fs.lstatSync(file); }
  catch { return policy; }
  policy.present = true;
  const invalid = (error) => ({ ...emptyPolicy(file), present: true, error });
  if (!info.isFile() || info.isSymbolicLink()) return invalid("policy file must be one regular file");
  let value;
  try { value = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) { return invalid("policy file is not valid JSON: " + error.message); }
  if (!value || typeof value !== "object" || Array.isArray(value) || value.schemaVersion !== 1) return invalid("schemaVersion must be 1");
  for (const [key, setName] of Object.entries(POLICY_LISTS)) {
    const list = value[key] === undefined ? [] : value[key];
    if (!Array.isArray(list)) return invalid(key + " must be an array");
    for (const entry of list) {
      const problem = policyPathProblem(root, entry);
      if (problem) return invalid(key + ": " + problem);
      policy[setName].add(String(entry).replace(/\\/g, "/"));
    }
  }
  const mcp = value.mcpWriteTools === undefined ? {} : value.mcpWriteTools;
  if (!mcp || typeof mcp !== "object" || Array.isArray(mcp)) return invalid("mcpWriteTools must be an object");
  const allow = mcp.allow === undefined ? [] : mcp.allow;
  if (!Array.isArray(allow)) return invalid("mcpWriteTools.allow must be an array");
  for (const name of allow) {
    if (typeof name !== "string" || !MCP_TOOL_NAME.test(name)) return invalid("mcpWriteTools.allow: not an exact MCP tool name: " + JSON.stringify(name));
    policy.mcpAllow.add(name);
  }
  const roots = value.productRoots === undefined ? [] : value.productRoots;
  if (!Array.isArray(roots)) return invalid("productRoots must be an array");
  for (const entry of roots) {
    const problem = productRootProblem(root, entry);
    if (problem) return invalid("productRoots: " + problem);
    policy.productRoots.push(path.join(root, ...String(entry).split(/[\\/]/u)));
  }
  // Owner list publishProjects (package P3, E1): project repositories below the installation root whose
  // current branch git-intent may publish without a closed package. The shell guard only validates the
  // entries here (an invalid entry blocks like every other list); git-intent reads the same file through
  // the same module and does the publishing.
  const publish = publishProjects.publishProjectsFromValue(root, value.publishProjects);
  if (publish.error) return invalid(publish.error);
  policy.publishProjects = publish.projects;
  return policy;
}

function policyFor(context) {
  if (!context.policy) context.policy = loadMutationPolicy(context.projectRoot);
  return context.policy;
}

function declarations(context, name, builtIn) {
  const policy = policyFor(context);
  if (policy.error) return null;
  return policy[name].size ? new Set([...builtIn, ...policy[name]]) : builtIn;
}

function policyDenial(context) {
  return denial("POLICY_INVALID", POLICY_FILE + " is invalid: " + policyFor(context).error,
    "The Owner repairs " + POLICY_FILE + " (agents may not edit it); executable commands stay blocked while a package is active.");
}

function normalized(value) {
  const result = path.resolve(String(value || "")).replaceAll("\\", "/");
  return process.platform === "win32" ? result.toLowerCase() : result;
}

function safeRegular(file) {
  try {
    const info = fs.lstatSync(file);
    return !info.isSymbolicLink() && info.isFile() && (typeof info.nlink !== "number" || info.nlink === 1);
  } catch { return false; }
}

function expectedFiles(root, relative) {
  const values = [path.join(root, ...relative.split("/"))];
  if (path.basename(root).toLowerCase() === "test-harness" && relative.startsWith("vendor/unlazy/")) {
    values.push(path.join(path.dirname(root), ...relative.split("/")));
  }
  return values;
}

// extraRoots: the Owner's productRoots (guard-parity E11); a declared path may sit under the
// installation root or under one of them.
function declaredPath(raw, cwd, projectRoot, declarations, extraRoots = []) {
  if (!raw || typeof raw !== "string" || raw.includes("\0")) return null;
  const candidates = path.isAbsolute(raw)
    ? [path.resolve(raw)]
    : [path.resolve(cwd || projectRoot, raw), path.resolve(projectRoot, raw)];
  for (const relative of declarations) {
    for (const root of [projectRoot, ...extraRoots]) {
      for (const expected of expectedFiles(root, relative)) {
        if (candidates.some((candidate) => normalized(candidate) === normalized(expected)) && safeRegular(expected)) return relative;
      }
    }
  }
  return null;
}

function productRootsFor(context) {
  const policy = policyFor(context);
  return policy.error ? [] : policy.productRoots;
}

function declared(raw, context, set) {
  return declaredPath(raw, context.cwd, context.projectRoot, set, productRootsFor(context));
}

// Every test file directly in a product's test/ folder runs (guard-parity E11, A20): a test
// written since the last release has to run before it can be released, and work on the product
// needs no confirmation by the Owner's own decision.
// harness-gaps R1: node --test also runs the compiled Dashboard tests (dashboard/.test-build/test)
// and, where the setup repository's vendored package tests sit beside the product tree, those
// (../vendor/unlazy/tests). Files lie directly in the folder; nesting stays closed.
// package shell-grants, A20: no fixed list. A test file is any file directly in <root>/test/ that
// ends in .test.js, .test.mjs or .test.cjs, for the installation root itself (the product tree
// carries its tests there) and for every Owner product root; a file in a subfolder, outside
// test/ or without the .test. name never is one.
const TEST_FILE_NAME = /\.test\.(?:js|mjs|cjs)$/u;

function productTest(raw, context) {
  if (!raw || typeof raw !== "string" || raw.includes("\0")) return false;
  const candidate = path.resolve(context.cwd || context.projectRoot, raw);
  const inDirectory = (directory) => normalized(path.dirname(candidate)) === normalized(directory) && safeRegular(candidate);
  if (TEST_FILE_NAME.test(candidate) && [context.projectRoot, ...productRootsFor(context)]
    .some((root) => inDirectory(path.join(root, "test")))) return true;
  return productRootsFor(context).some((root) =>
    /\.(?:c|m)?js$/u.test(candidate) && (inDirectory(path.join(root, "dashboard", ".test-build", "test")) ||
      (vendoredUnlazy(root) && inDirectory(path.join(vendoredUnlazy(root), "tests")))));
}

// <root>/../vendor/unlazy, only where it exists as a real directory.
function vendoredUnlazy(root) {
  const directory = path.join(path.dirname(root), "vendor", "unlazy");
  try {
    const info = fs.lstatSync(directory);
    return !info.isSymbolicLink() && info.isDirectory() ? directory : null;
  } catch { return null; }
}

// One file by exact path, relative paths against the working directory of the command.
function sameFile(raw, context, expected) {
  if (!raw || typeof raw !== "string" || raw.includes("\0")) return false;
  return normalized(path.resolve(context.cwd || context.projectRoot, raw)) === normalized(expected) && safeRegular(expected);
}

const NEXT_COMMANDS = new Set(["build", "dev", "start"]);
const NEXT_VALUE_FLAGS = new Set(["-p", "--port", "-H", "--hostname"]);

// next build|dev|start with no positional directory (a project directory would run its
// next.config): only the port and host flags carry a value.
function nextArguments(rest) {
  if (!rest.length || !NEXT_COMMANDS.has(rest[0])) return false;
  for (let index = 1; index < rest.length; index += 1) {
    const arg = rest[index];
    if (NEXT_VALUE_FLAGS.has(arg)) {
      if (!/^[A-Za-z0-9.:_-]+$/u.test(rest[index + 1] || "")) return false;
      index += 1;
    } else if (!/^-[A-Za-z0-9-]+(?:=[A-Za-z0-9.:_-]+)?$/u.test(arg)) return false;
  }
  return true;
}

// The Owner product root's own build and test tools (harness-gaps R1, decision 1): under a
// productRoots entry the Dashboard's Next.js and TypeScript, its test runner and the vendored
// package tests run. Returns null for a script that is none of them.
function productToolKind(script, context) {
  if (!script || typeof script !== "string" || script.startsWith("-")) return null;
  const roots = productRootsFor(context);
  const at = (...parts) => roots.some((root) => sameFile(script, context, path.join(root, ...parts)));
  if (at("dashboard", "node_modules", "next", "dist", "bin", "next")) return "next";
  if (at("dashboard", "node_modules", "typescript", "bin", "tsc")) return "tsc";
  if (at("dashboard", "scripts", "test.mjs")) return "dashboard-test";
  const candidate = path.resolve(context.cwd || context.projectRoot, script);
  if (/\.mjs$/u.test(candidate) && roots.some((root) => {
    const vendor = vendoredUnlazy(root);
    return vendor && normalized(path.dirname(candidate)) === normalized(path.join(vendor, "tests")) && safeRegular(candidate);
  })) return "vendor-test";
  return null;
}

function classifyProductTool(script, rest, context) {
  const kind = productToolKind(script, context);
  if (kind === "next") {
    return nextArguments(rest) ? { allowed: true, code: "PRODUCT_BUILD_TOOL" }
      : denial("UNDECLARED_NODE_SCRIPT", "next runs as build, dev or start with at most --port and --hostname",
        "Run: node dashboard/node_modules/next/dist/bin/next build.");
  }
  if (kind === "tsc") return { allowed: true, code: "PRODUCT_BUILD_TOOL" };
  if (kind === "dashboard-test") {
    return rest.length ? denial("UNDECLARED_NODE_SCRIPT", "the Dashboard test runner takes no arguments", "Run: node dashboard/scripts/test.mjs.")
      : { allowed: true, code: "PRODUCT_TEST_RUNNER" };
  }
  return kind ? { allowed: true, code: "PRODUCT_TEST_RUNNER" } : null;
}

// The setup repository's installer against the installation itself (decision 5):
// node <dir>/install.mjs install|status|doctor --target <installation root> [--upgrade] [--json].
// <dir> is the setup repository when it carries its manifest and its lifecycle library.
function classifyInstaller(script, rest, context) {
  if (!script || path.basename(script).toLowerCase() !== "install.mjs") return null;
  const file = path.resolve(context.cwd || context.projectRoot, script);
  const directory = path.dirname(file);
  if (!safeRegular(file) || !safeRegular(path.join(directory, "manifest.json")) ||
      !safeRegular(path.join(directory, "lib", "distribution-lifecycle.mjs"))) return null;
  const wrong = (detail) => denial("INSTALLER_ARGUMENTS", detail,
    "Run: node install.mjs install|status|doctor --target \"" + context.projectRoot + "\" [--upgrade] [--json].");
  if (!["install", "status", "doctor"].includes(rest[0])) return wrong("the installer runs as install, status or doctor");
  let target = null;
  const seen = new Set();
  for (let index = 1; index < rest.length; index += 1) {
    const arg = rest[index];
    if (["--upgrade", "--json"].includes(arg) && !seen.has(arg)) { seen.add(arg); continue; }
    const inline = /^--target=(.+)$/su.exec(arg);
    if ((arg === "--target" || inline) && target === null) {
      target = inline ? inline[1].replace(/^(["'])(.*)\1$/su, "$2") : rest[index + 1];
      if (!inline) index += 1;
      continue;
    }
    return wrong("the installer accepts only --target, --upgrade and --json");
  }
  if (!target || normalized(path.resolve(context.cwd || context.projectRoot, hookContext.msysPath(target))) !== normalized(context.projectRoot)) {
    return wrong("--target must be the installation root of this session");
  }
  return { allowed: true, code: "INSTALLER_OWN_TARGET" };
}

function denial(code, detail, next) {
  return { allowed: false, code, detail, next };
}

function editRoute() {
  return "Use Claude Write/Edit/NotebookEdit on one exact path inside the active leaf OWNS.";
}

// The routes of the denials that are no write: the command itself in the one tool, a command of the finite
// list, a literal command. They say what the command index (package P6) says for the same code.
function directRoute() {
  return "Run the command itself in the Bash or PowerShell tool, without bash -c, cmd /c, powershell -Command or another wrapper.";
}

function declaredRoute() {
  return "Use a command of the finite list (a read, a declared verifier, a test under test/, a canonical tool); " +
    "code you need to run goes into a file with Write/Edit and runs as a test under test/.";
}

function literalRoute() {
  return "Write the command out literally, without substitution, expansion or a computed name.";
}

function verifierRoute(projectRoot) {
  return "Run the declared verifier directly: node \"" + path.join(projectRoot, "checks", "run-all.mjs") + "\".";
}

// node --test (package shell-grants, A20): the test runner's own switches, nothing that loads or
// evaluates code. A reporter is one of the built-in ones (a module path would run its code); a
// reporter destination is stdout, stderr or a file below the temp folder of the session.
const NODE_TEST_SWITCHES = new Set(["--test-only", "--test-force-exit"]);
const NODE_TEST_VALUES = new Set(["--test-concurrency", "--test-reporter", "--test-name-pattern", "--test-skip-pattern",
  "--test-reporter-destination"]);
const NODE_TEST_REPORTERS = new Set(["spec", "dot", "tap", "junit", "lcov"]);

function nodeTestArguments(rest, context) {
  const files = [];
  const refused = (detail) => ({ denial: denial("UNDECLARED_TEST", detail, verifierRoute(context.projectRoot)) });
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (!arg.startsWith("-")) { files.push(arg); continue; }
    if (NODE_TEST_SWITCHES.has(arg)) continue;
    const inline = /^(--test-[a-z-]+)=([\s\S]*)$/u.exec(arg);
    const name = inline ? inline[1] : arg;
    if (!NODE_TEST_VALUES.has(name)) {
      return refused("node --test accepts only --test-concurrency, --test-reporter, --test-name-pattern, --test-skip-pattern, --test-reporter-destination, --test-only and --test-force-exit, not " + arg);
    }
    const value = inline ? inline[2] : rest[index + 1];
    if (!inline) index += 1;
    if (value === undefined || value === "" || /[\0\r\n]/u.test(value)) return refused(name + " needs a value");
    if (name === "--test-concurrency" && !/^[0-9]{1,3}$/u.test(value)) return refused("--test-concurrency takes a number");
    if (name === "--test-reporter" && !NODE_TEST_REPORTERS.has(value)) {
      return refused("--test-reporter takes a built-in reporter (spec, dot, tap, junit, lcov); a module path would run its code");
    }
    if (name === "--test-reporter-destination" && !["stdout", "stderr"].includes(value)) {
      const target = ownedShellWrite.decideSessionTempTarget({ target: value, dialect: context.dialect, cwd: context.startCwd || context.cwd,
        sessionId: context.sessionId, changesDirectory: context.changesDirectory });
      if (!target.allowed) return refused("--test-reporter-destination writes only below the temp folder of this session: " + target.detail);
    }
  }
  return { files };
}

function classifyNode(words, start, context) {
  const args = words.slice(start + 1);
  if (args.length === 1 && ["-v", "--version", "-h", "--help"].includes(args[0])) return { allowed: true, code: "NODE_INFORMATION" };
  // A product build tool takes its own arguments (tsc -p, next start -p): for it only the words up
  // to the script are Node options, and those may be the harmless warning flags alone.
  let headIndex = 0;
  while (headIndex < args.length && ["--no-warnings", "--trace-warnings", "--enable-source-maps"].includes(args[headIndex])) headIndex += 1;
  const scanned = productToolKind(args[headIndex], context) ? args.slice(0, headIndex + 1) : args;
  if (!args.length || scanned.some((arg) => ["-e", "--eval", "-p", "--print", "--input-type"].includes(arg))) {
    return denial("INLINE_INTERPRETER", "inline Node execution is not statically decidable", editRoute());
  }
  if (scanned.some((arg) => /^--(?:require|import|loader|experimental-loader)(?:=|$)/u.test(arg) || arg === "-r")) {
    return denial("NODE_PRELOAD", "Node preload hooks can execute undeclared code", verifierRoute(context.projectRoot));
  }
  if (args[0] === "--check" || args[0] === "-c") {
    return args.length === 2 ? { allowed: true, code: "NODE_SYNTAX_CHECK" }
      : denial("NODE_CHECK_FORM", "node --check accepts one file in this boundary", "Run: node --check <file>.");
  }
  if (args[0] === "--test") {
    const tests = declarations(context, "test", NO_BUILT_IN_TESTS);
    if (!tests) return policyDenial(context);
    const parsed = nodeTestArguments(args.slice(1), context);
    if (parsed.denial) return parsed.denial;
    if (!parsed.files.length || parsed.files.some((arg) => !declared(arg, context, tests) && !productTest(arg, context))) {
      return denial("UNDECLARED_TEST", "node --test may execute only test files that lie directly in a test/ folder of the installation or of a product root and end in .test.js, .test.mjs or .test.cjs",
        verifierRoute(context.projectRoot));
    }
    return { allowed: true, code: "DECLARED_TESTS" };
  }
  let scriptIndex = 0;
  while (scriptIndex < args.length && ["--no-warnings", "--trace-warnings", "--enable-source-maps"].includes(args[scriptIndex])) scriptIndex += 1;
  const script = args[scriptIndex];
  if (!script) return denial("NODE_SCRIPT_REQUIRED", "Node would start an unrestricted REPL", verifierRoute(context.projectRoot));
  const verifiers = declarations(context, "verifier", VERIFIER_PATHS);
  if (!verifiers) return policyDenial(context);
  const verifier = declared(script, context, verifiers);
  if (verifier) return { allowed: true, code: "DECLARED_VERIFIER", path: verifier };
  const service = declared(script, context, declarations(context, "service", SERVICE_PATHS));
  if (service) {
    const rest = args.slice(scriptIndex + 1);
    let index = 0;
    let port = false;
    const seen = new Set();
    while (index < rest.length) {
      if (rest[index] === "--port" && !port && /^[0-9]{1,5}$/u.test(rest[index + 1] || "")) { port = true; index += 2; continue; }
      if (SERVICE_VOICE_FLAGS.has(rest[index]) && !seen.has(rest[index])) { seen.add(rest[index]); index += 1; continue; }
      break;
    }
    return index === rest.length
      ? { allowed: true, code: "DECLARED_SERVICE", path: service }
      : denial("SERVICE_ARGUMENTS", "the Dashboard service accepts only --port <n> and the voice flags --voice, --speech, --microphone, --no-inference",
        "Run: node dashboard/serve.mjs [--port <n>] [--voice|--speech|--microphone] [--no-inference].");
  }
  const mutation = declared(script, context, declarations(context, "mutation", CANONICAL_MUTATION_PATHS));
  if (mutation) return { allowed: true, code: "CANONICAL_MUTATION_TOOL", path: mutation };
  const guard = declared(script, context, GUARD_SELF_TESTS);
  if (guard && args.slice(scriptIndex + 1).length === 1 && ["--self-test", "--selbsttest"].includes(args[scriptIndex + 1])) {
    return { allowed: true, code: "GUARD_SELF_TEST", path: guard };
  }
  const readTool = declared(script, context, new Set(READ_ONLY_TOOL_COMMANDS.keys()));
  if (readTool && READ_ONLY_TOOL_COMMANDS.get(readTool).has(args[scriptIndex + 1])) {
    return { allowed: true, code: "READ_ONLY_TOOL", path: readTool };
  }
  if (declared(script, context, new Set(PACKAGE_TOOL_PATHS))) return classifyPackageTool(args.slice(scriptIndex + 1), context);
  const rest = args.slice(scriptIndex + 1);
  const productTool = classifyProductTool(script, rest, context);
  if (productTool) return productTool;
  const installer = classifyInstaller(script, rest, context);
  if (installer) return installer;
  return denial("UNDECLARED_NODE_SCRIPT", "repository Node scripts execute with write capability unless explicitly reviewed", verifierRoute(context.projectRoot));
}

function optionValues(args, name) {
  const values = [];
  args.forEach((arg, index) => { if (arg === name) values.push(args[index + 1]); });
  return values;
}

function samePackageId(left, right) {
  return process.platform === "win32" ? String(left).toLowerCase() === String(right).toLowerCase() : left === right;
}

// A session without a planning record may be a resumed conversation: its binding sits on the old session id (D15).
// The refusal names both ways back, but only for holders this session may take: one its transcript names (the same
// conversation; the hooks move that binding on their own), or one of the SAME package and repository the call
// names (--package, --root) that ran no hook for silenceMs. A live foreign session is never named (P4 review).
function resumeHint(context, args) {
  const list = Array.from(args || [], String);
  const root = optionValues(list, "--root").find(Boolean);
  const holders = packageBootstrap.planningHolders({ harnessRoot: context.projectRoot, sessionId: context.sessionId,
    transcriptPath: context.transcriptPath || undefined,
    repoRoot: root ? path.resolve(context.cwd || context.projectRoot, hookContext.msysPath(root)) : undefined,
    packageId: optionValues(list, "--package").find(Boolean) });
  if (!holders.length) return "";
  return "; Wiederaufnahme: nennt das Transkript dieser Sitzung die alte Kennung, geht die Planungsbindung beim naechsten " +
    "Hook von selbst auf diese Sitzung ueber. Von Hand erst, wenn die alte Sitzung seit silenceMs (KEEL_SILENCE_MS, " +
    "Standard 30 Minuten) keinen Hook mehr ausgeloest hat: " + holders.map((holder) => holder.command).join(" | ");
}

function packageToolUnbound(detail, context, args) {
  let hint = "";
  try { hint = resumeHint(context, args); } catch { hint = ""; }
  return denial("PACKAGE_TOOL_UNBOUND", detail, paketGate.exactNextStep(context.projectRoot) + hint);
}

// The package tool (package-write-only step 5): args are the tool's own arguments after the
// script path, the same in both shells. Reading its arguments is no second command parser.
// Reads pass without a binding; a write passes only for the bundle bound to the hook session,
// or as the create that opens that binding itself (create calls package-bootstrap begin, which
// holds one binding per session and one repository inside the Harness root). Never throws.
function classifyPackageTool(args, context) {
  try {
    const list = Array.from(args || [], String);
    if (list.includes("--unlazy")) {
      return denial("PACKAGE_TOOL_OVERRIDE", "--unlazy selects package code outside the declared tool", "Run the package tool without --unlazy.");
    }
    const help = (arg) => arg === "--help" || arg === "-h";
    if (!list.length || (list.length === 1 && help(list[0])) || (list.length === 2 && help(list[1])) ||
        (["import", "prepare"].includes(list[0]) && !list.includes("--apply"))) {
      return { allowed: true, code: "PACKAGE_TOOL_READ" };
    }
    const command = PACKAGE_TOOL_COMMANDS.has(list[0]) ? list[0] : "";
    const sessionId = String(context.sessionId || "");
    if (!sessionId) return packageToolUnbound("a writing package tool call needs a package session", context, list);
    const sessions = optionValues(list, "--session");
    if (sessions.some((value) => value !== sessionId)) {
      return packageToolUnbound("--session names another session than the calling one", context, list);
    }
    let record = null;
    try { record = packageBootstrap.find({ harnessRoot: context.projectRoot, sessionId }); } catch { record = null; }
    if (record) {
      const roots = optionValues(list, "--root");
      if (!roots.length || roots.some((value) => !value ||
          !repository.samePath(path.resolve(context.cwd, hookContext.msysPath(value)), record.repoRoot))) {
        return packageToolUnbound("--root must name the repository bound to this session", context, list);
      }
      const ids = [...optionValues(list, "--package"), ...(command === "import" ? optionValues(list, "--into") : [])];
      if (ids.some((value) => !samePackageId(value, record.packageId))) {
        return packageToolUnbound("the package tool may write only the bundle bound to this session (" + record.packageId + ")", context, list);
      }
      return { allowed: true, code: "PACKAGE_TOOL_BOUND" };
    }
    if (command === "create" && sessions.length && sessions.every((value) => value === sessionId)) {
      return { allowed: true, code: "PACKAGE_TOOL_BOUND" };
    }
    return packageToolUnbound("this session has no package binding; only create with --session of this session opens one", context, list);
  } catch (error) {
    return denial("PACKAGE_TOOL_UNBOUND", "package tool check failed: " + String(error && error.message || error),
      "Run the package tool with --root and --package of the bundle bound to this session.");
  }
}

// --- Project tools (Karte Arbeitsweise, 07.10.2026) ----------------------------------------------------------------
// Installing, building, testing and type checking a project is the work of the session that is not bound to a work
// step: npm/pnpm/yarn install or ci from the project's own package.json (never global, never another folder, never a
// new dependency), a script the project's package.json declares, and npx/pnpm exec of a program in the project's own
// node_modules/.bin. A bound session (worker or leaf) stays with its declared verifiers: it could write package.json
// and then run it (PACKAGE_SCRIPT_RUNNER). Writes into ignored folders (node_modules, dist) are no product change.
const INSTALL_SWITCHES = new Set(["--no-audit", "--no-fund", "--prefer-offline", "--offline", "--ignore-scripts", "--legacy-peer-deps",
  "--frozen-lockfile", "--immutable", "--silent", "-s", "--quiet", "-q", "--no-progress", "--production", "--prod"]);
const INSTALL_VALUES = /^--(?:omit|include|loglevel)=[a-z]+$/u;
const RUN_SWITCHES = new Set(["--silent", "-s", "--if-present"]);
const NPX_SWITCHES = new Set(["--no-install", "--no", "--offline", "-q", "--quiet"]);
// Forms that install globally, act in another folder or pick a workspace: refused before anything else.
const ELSEWHERE = /^(?:-g|--global|--location(?:=.*)?|--prefix(?:=.*)?|-C|--dir(?:=.*)?|--cwd(?:=.*)?|-w|--workspaces?(?:=.*)?|--filter(?:=.*)?|-r|--recursive|-p|--package(?:=.*)?|-c|--call(?:=.*)?|-y|--yes)$/u;
const BIN_NAME = /^[A-Za-z0-9@][A-Za-z0-9._@-]{0,127}$/u;
// Writing forms (Pruefung 07.10.2026): a formatter, fixer or codemod changes product files, which a session not bound to
// a work step does not do. Known forms only: --write and -w (prettier), --fix (eslint, stylelint and others) anywhere in
// the command, a script whose name has a word fix, codemod, format, fmt or prettier (format:check and other check forms
// read), and the codemod programs. A test or build script still runs project code (honest limit, docs/guard-scope.md).
// Nachpruefung 07.10.2026: also the snapshot and apply forms (-u, --update, --updateSnapshot of jest and vitest; --apply,
// --apply-unsafe, --unsafe of biome; biome format|check --write through --write), dprint fmt, and the text of the script
// that npm|pnpm|yarn run <script> and npm test run: "test": "jest -u" writes like the command line form (scriptWritingForm).
const WRITING_ARGUMENT = /^(?:--write(?:=.*)?|-w|--fix(?:=.*)?|--fix-type(?:=.*)?|-u|--update|--update-?snapshots?|--updateSnapshot|--apply|--apply-unsafe|--unsafe)$/u;
const WRITING_PROGRAM_VERBS = Object.freeze({ dprint: new Set(["fmt"]) });
const PACKAGE_MANAGERS = new Set(["npm", "pnpm", "yarn"]);
const WRITING_SCRIPT_WORDS = new Set(["fix", "codemod", "codemods"]);
const FORMAT_SCRIPT_WORDS = new Set(["format", "fmt", "prettier", "prettify"]);
const CHECK_SCRIPT_WORDS = new Set(["check", "verify", "lint", "test", "ci"]);
const WRITING_PROGRAMS = new Set(["jscodeshift", "codemod", "putout"]);
const WRITING_WAY = "Files that formatters, fixers and codemods change are product files: bind a work step for it (a small package " +
  "or a leaf: package-executor next|start, then dispatch), or run the checking form (--check, format:check, lint without --fix).";
const INSTALL_WAY = "Add --ignore-scripts: npm ci --ignore-scripts, npm|pnpm|yarn install --ignore-scripts (install scripts of the " +
  "dependencies run code no guard sees).";

function writingScript(name) {
  const words = String(name).toLowerCase().split(/[:._-]+/u).filter(Boolean);
  if (words.some((word) => WRITING_SCRIPT_WORDS.has(word))) return true;
  return words.some((word) => FORMAT_SCRIPT_WORDS.has(word)) && !words.some((word) => CHECK_SCRIPT_WORDS.has(word));
}

function programName(word) {
  return path.basename(String(word)).toLowerCase().replace(/\.(?:cmd|exe|ps1|js|cjs|mjs)$/u, "");
}

// The script another package manager call inside a script text runs (npm run x, npm test, pnpm x, yarn x), or null.
function nestedScript(tokens, index) {
  const tool = programName(tokens[index]);
  if (!PACKAGE_MANAGERS.has(tool)) return null;
  let rest = tokens.slice(index + 1).filter((token) => !RUN_SWITCHES.has(token));
  if (["run", "run-script"].includes(rest[0])) rest = rest.slice(1);
  else if (["test", "t"].includes(rest[0])) return "test";
  else if (tool === "npm") return null;
  return rest[0] && !rest[0].startsWith("-") ? rest[0] : null;
}

// The writing form the script runs, or null: a writing argument, a writing program (jscodeshift, dprint fmt), a script name
// that formats or fixes, or the same in a script it calls (npm run x inside the text). pre<name> and post<name> run with it.
function scriptWritingForm(scripts, name, seen = new Set()) {
  for (const current of ["pre" + name, name, "post" + name]) {
    if (seen.has(current) || !Object.hasOwn(scripts, current) || typeof scripts[current] !== "string") continue;
    seen.add(current);
    if (writingScript(current)) return "the script " + JSON.stringify(current);
    for (const segment of scripts[current].split(/&&|\|\||[;|&\n]/u)) {
      const tokens = segment.trim().split(/\s+/u).map((token) => token.replace(/^["']|["']$/gu, "")).filter(Boolean);
      for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index];
        if (WRITING_ARGUMENT.test(token)) return token + " in the script " + JSON.stringify(current);
        const program = programName(token);
        if (WRITING_PROGRAMS.has(program)) return program + " in the script " + JSON.stringify(current);
        if (WRITING_PROGRAM_VERBS[program]?.has(String(tokens[index + 1] || "").toLowerCase())) {
          return program + " " + tokens[index + 1] + " in the script " + JSON.stringify(current);
        }
        const nested = nestedScript(tokens, index);
        if (nested && nested !== current) {
          const found = scriptWritingForm(scripts, nested, seen);
          if (found) return found + " (called by " + JSON.stringify(current) + ")";
        }
      }
    }
  }
  return null;
}

// The project of the command: the nearest folder at or above cwd that holds a regular package.json.
function projectOf(cwd) {
  let current = path.resolve(cwd);
  for (;;) {
    const file = path.join(current, "package.json");
    if (safeRegular(file)) {
      let scripts = {};
      try {
        const value = JSON.parse(fs.readFileSync(file, "utf8"));
        scripts = value && typeof value.scripts === "object" && value.scripts && !Array.isArray(value.scripts) ? value.scripts : {};
      } catch { scripts = null; }
      return { directory: current, scripts };
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function localBin(project, name) {
  if (!BIN_NAME.test(name)) return false;
  const directory = path.join(project.directory, "node_modules", ".bin");
  return [name, name + ".cmd", name + ".ps1"].some((file) => {
    try { return fs.lstatSync(path.join(directory, file)).isFile() || fs.lstatSync(path.join(directory, file)).isSymbolicLink(); }
    catch { return false; }
  });
}

function projectToolForm(detail, way) {
  return denial("PROJECT_TOOL_FORM", detail, (way ? way + " " : "") +
    "Run the project's own tools from its folder: npm|pnpm|yarn install or npm ci with --ignore-scripts (no package names, no -g), " +
    "npm|pnpm|yarn run <script of package.json>, npm test, npx|pnpm exec <program in node_modules/.bin>; no --write, -w or --fix.");
}

function classifyProjectTool(tool, words, context) {
  const args = words.slice(1).map(String);
  if (sessionScope.boundToStep({ harnessRoot: context.projectRoot, sessionId: context.sessionId, cwd: context.startCwd || context.cwd })) {
    return denial("PACKAGE_SCRIPT_RUNNER", tool + " runs project scripts; a session bound to a work step uses the declared verifiers",
      verifierRoute(context.projectRoot) + " Installing, building and testing with the project's tools is the work of the session that is not bound to a work step.");
  }
  if (computedArguments(words, context)) return computedDenial(tool);
  // The words that are the tool's own: before -- , and for a program run (npx, exec) only those before the program.
  const separator = args.indexOf("--");
  let own = separator < 0 ? args : args.slice(0, separator);
  const runsProgram = tool === "npx" || ["exec"].includes(args[0]);
  if (runsProgram) {
    const from = tool === "npx" ? 0 : 1;
    const program = own.findIndex((arg, index) => index >= from && !arg.startsWith("-"));
    own = program < 0 ? own : own.slice(0, program);
  }
  const elsewhere = own.find((arg) => ELSEWHERE.test(arg));
  if (elsewhere) return projectToolForm(tool + " " + elsewhere + " installs globally, acts in another folder or loads another package");
  const writing = args.find((arg) => WRITING_ARGUMENT.test(arg));
  if (writing) return projectToolForm(tool + " with " + writing + " writes product files; a session not bound to a work step changes none", WRITING_WAY);
  const project = projectOf(context.cwd);
  if (!project) return projectToolForm("no package.json at or above " + context.cwd);
  if (project.scripts === null) return projectToolForm("the package.json of " + project.directory + " is not valid JSON");
  const allowed = { allowed: true, code: "PROJECT_TOOL", project: project.directory };
  const install = (rest) => {
    const bad = rest.find((arg) => !INSTALL_SWITCHES.has(arg) && !INSTALL_VALUES.test(arg));
    if (bad !== undefined) {
      return projectToolForm(bad.startsWith("-") ? tool + " install takes no " + bad
        : tool + " install adds the package " + bad + " to package.json; installing uses the project's own package.json only");
    }
    return rest.includes("--ignore-scripts") ? allowed
      : projectToolForm(tool + " install without --ignore-scripts runs the install scripts of every dependency", INSTALL_WAY);
  };
  const script = (rest) => {
    let index = 0;
    while (index < rest.length && RUN_SWITCHES.has(rest[index])) index += 1;
    if (index >= rest.length) return allowed; // lists the scripts
    const scriptName = rest[index];
    if (!Object.hasOwn(project.scripts, scriptName)) {
      return projectToolForm("the script " + JSON.stringify(scriptName) + " is not in " + path.join(project.directory, "package.json"));
    }
    if (writingScript(scriptName)) {
      return projectToolForm("the script " + JSON.stringify(scriptName) + " formats, fixes or rewrites product files; a session not bound to a work step changes none", WRITING_WAY);
    }
    const form = scriptWritingForm(project.scripts, scriptName);
    if (form) {
      return projectToolForm("the script " + JSON.stringify(scriptName) + " runs a writing form (" + form + "); a session not bound to a work step changes no product file", WRITING_WAY);
    }
    return allowed; // the words after the script name go to the script
  };
  const program = (rest) => {
    let index = 0;
    while (index < rest.length && NPX_SWITCHES.has(rest[index])) index += 1;
    const bin = rest[index];
    if (!bin || bin.startsWith("-")) return projectToolForm(tool + " takes a program name of node_modules/.bin" + (bin ? ", not " + bin : ""));
    if (WRITING_PROGRAMS.has(bin.toLowerCase())) return projectToolForm("the program " + JSON.stringify(bin) + " rewrites product files", WRITING_WAY);
    if (WRITING_PROGRAM_VERBS[bin.toLowerCase()]?.has(String(rest[index + 1] || "").toLowerCase())) {
      return projectToolForm(bin + " " + rest[index + 1] + " rewrites product files", WRITING_WAY);
    }
    return localBin(project, bin) ? allowed
      : projectToolForm("the program " + JSON.stringify(bin) + " is not in " + path.join(project.directory, "node_modules", ".bin") + "; install the project first");
  };
  const [verb, ...rest] = args;
  if (tool === "npx") return program(args);
  if (tool === "npm") {
    if (["ci", "clean-install", "install", "i"].includes(verb)) return install(rest);
    if (["run", "run-script"].includes(verb)) return script(rest);
    if (["test", "t"].includes(verb)) return script(["test", ...rest]);
    if (verb === "exec") return program(rest);
  }
  if (tool === "pnpm") {
    if (["install", "i"].includes(verb)) return install(rest);
    if (verb && writingScript(verb)) return script([verb, ...rest]);
    if (verb === "run") return script(rest);
    if (verb === "test" || verb === "t") return script(["test", ...rest]);
    if (verb === "exec") return program(rest);
  }
  if (tool === "yarn") {
    if (verb === undefined || verb.startsWith("-")) return install(args); // yarn alone installs from package.json
    if (verb === "install") return install(rest);
    if (writingScript(verb)) return script([verb, ...rest]);
    if (verb === "run") return script(rest);
    if (verb === "test") return script(["test", ...rest]);
  }
  return projectToolForm(tool + (verb ? " " + verb : "") + " is no project tool form (install, ci, run <script>, test, exec <program>)");
}

function classifyPowerShell(words, start, context) {
  const args = words.slice(start + 1);
  if (args.length === 1 && ["-v", "--version", "-version"].includes(args[0].toLowerCase())) return { allowed: true, code: "SHELL_INFORMATION" };
  const fileIndex = args.findIndex((arg) => /^-(?:file|f)$/iu.test(arg));
  if (fileIndex >= 0 && declared(args[fileIndex + 1], context, new Set(["checks/windows-smoke.ps1"]))) {
    return { allowed: true, code: "DECLARED_WINDOWS_VERIFIER" };
  }
  return denial("SHELL_WRAPPER", "PowerShell command/file wrappers can hide repository writes", directRoute());
}

function classifyCmd(words, start, context) {
  const args = words.slice(start + 1);
  const marker = args.findIndex((arg) => /^\/(?:c|k)$/iu.test(arg));
  if (marker >= 0 && args.length === marker + 2 &&
      declared(args[marker + 1], context, new Set(["checks/windows-smoke.cmd"]))) {
    return { allowed: true, code: "DECLARED_WINDOWS_VERIFIER" };
  }
  return denial("SHELL_WRAPPER", "cmd /c and /k can hide repository writes", directRoute());
}

// Get-CimInstance and Get-WmiObject read only the process and operating-system classes
// (harness-gaps R1, decision 3). Every other class, namespace or parameter stays undeclared.
const CIM_CLASSES = new Set(["win32_process", "win32_operatingsystem"]);
const CIM_VALUE_PARAMETERS = new Set(["-classname", "-class", "-filter", "-property", "-erroraction", "-ea"]);

function classifyCim(name, words) {
  let className = null;
  for (let index = 1; index < words.length; index += 1) {
    const word = String(words[index]);
    const lower = word.toLowerCase();
    if (lower.startsWith("-")) {
      if (!CIM_VALUE_PARAMETERS.has(lower) || words[index + 1] === undefined) return null;
      if ((lower === "-classname" || lower === "-class") && className !== null) return null;
      if (lower === "-classname" || lower === "-class") className = String(words[index + 1]);
      index += 1;
    } else if (className === null) className = word;
    else return null;
  }
  return className !== null && CIM_CLASSES.has(className.toLowerCase()) ? { allowed: true, code: "READ_ONLY_PROCESS_QUERY" } : null;
}

// The command line of one process, read through Win32_Process (ps elsewhere). null when the
// process is gone or unreadable.
function processCommandLine(pid) {
  try {
    const result = process.platform === "win32"
      ? spawnSync(commandModel.powershellExecutable() || "powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
        "(Get-CimInstance Win32_Process -Filter 'ProcessId=" + pid + "').CommandLine"],
      { encoding: "utf8", windowsHide: true, timeout: 15_000 })
      : spawnSync("ps", ["-o", "args=", "-p", String(pid)], { encoding: "utf8", timeout: 8_000 });
    const line = result.status === 0 ? String(result.stdout || "").trim() : "";
    return line || null;
  } catch { return null; }
}

// Stop-Process -Id and taskkill /PID end a process whose command line holds a path inside the
// installation root or a product root; every other process is FOREIGN_PROCESS (decision 4).
// Name-based ending (Stop-Process -Name, taskkill /IM) is no declared form.
function classifyProcessStop(name, words, context) {
  const args = words.slice(1).map(String);
  let pid = null;
  const note = (value) => {
    if (pid !== null || !/^[1-9][0-9]{0,9}$/u.test(String(value))) return false;
    pid = String(value);
    return true;
  };
  let valid = true;
  for (let index = 0; index < args.length && valid; index += 1) {
    const lower = args[index].toLowerCase();
    if (name === "stop-process") {
      if (lower === "-id") valid = note(args[(index += 1)]);
      else if (lower === "-force" || lower === "-passthru") continue;
      else if (lower === "-erroraction" || lower === "-ea") valid = /^[A-Za-z]+$/u.test(args[(index += 1)] || "");
      else valid = false;
    } else if (lower === "/pid" || lower === "//pid") valid = note(args[(index += 1)]);
    else if (["/t", "//t", "/f", "//f"].includes(lower)) continue;
    else valid = false;
  }
  if (!valid || pid === null) {
    return denial("UNDECLARED_EXECUTABLE", name + " ends a process only by its numeric id (-Id <pid> or /PID <pid>)", verifierRoute(context.projectRoot));
  }
  const line = processCommandLine(pid);
  if (line) {
    const text = line.replaceAll("\\", "/");
    const haystack = process.platform === "win32" ? text.toLowerCase() : text;
    const roots = [context.projectRoot, ...productRootsFor(context)];
    if (roots.some((root) => [normalized(root), normalized(hookContext.canonicalPath(root))].some((form) => haystack.includes(form + "/")))) {
      return { allowed: true, code: "OWN_PROCESS_STOP" };
    }
  }
  return denial("FOREIGN_PROCESS", "process " + pid + (line ? " runs no path inside the installation or a product root" : " is not running or its command line is unreadable"),
    "End only processes that run files of this installation or its product roots; report any other process under Offen.");
}

// Deleting, moving and creating directories on literal paths inside the bound leaf OWNS
// (guard-scope E16: the same as Codex apply_patch). Returns null to keep DIRECT_SHELL_WRITE.
// Two checks beyond owned-shell-write.cjs: a command that changes directory anywhere gets no
// owned write (the module checks against cwd, the shell would delete in the new directory),
// and every path operand passes the write-guard rules W1, W4 and W5 as apply_patch does.
function ownedWrite(name, words, context) {
  const decision = ownedShellWrite.decideOwnedWrite({ name, words, staticArguments: context.staticArguments,
    dialect: context.dialect || "bash", cwd: context.startCwd || context.cwd, projectRoot: context.projectRoot, sessionId: context.sessionId });
  if (!decision) return null;
  if (!decision.allowed) return denial("DIRECT_SHELL_WRITE", decision.detail, editRoute());
  if (context.changesDirectory) {
    return denial("DIRECT_SHELL_WRITE", "the command changes directory; owned shell writes are checked against the starting directory only", editRoute());
  }
  const deps = writeGuard.echteDeps(context.projectRoot, { transcriptPath: context.transcriptPath });
  if (decision.code === "SESSION_TEMP_WRITE") {
    // The written places are known exactly; the arguments between them (values, options) are no paths.
    for (const place of decision.paths) {
      const reason = writeGuard.pruefen({ file_path: place, content: "" }, deps);
      if (reason) return denial("DIRECT_SHELL_WRITE", reason, editRoute());
    }
    return { allowed: true, code: "SESSION_TEMP_WRITE", paths: decision.paths };
  }
  for (const word of words.slice(1)) {
    if (String(word).startsWith("-")) continue;
    const reason = writeGuard.pruefen({ file_path: path.resolve(context.startCwd || context.cwd, hookContext.msysPath(String(word))), content: "" }, deps);
    if (reason) return denial("DIRECT_SHELL_WRITE", reason, editRoute());
  }
  return { allowed: true, code: "OWNED_SHELL_WRITE", paths: decision.paths };
}

// The context of git-intent-guard's maintenance decision for this shell context.
function maintenanceContext(context) {
  return { projectRoot: context.projectRoot, sessionId: context.sessionId, cwd: context.startCwd || context.cwd,
    changesDirectory: Boolean(context.changesDirectory), dialect: context.dialect };
}

const DIRECTORY_CHANGES = new Set(["cd", "chdir", "pushd", "popd", "set-location", "sl", "push-location", "pop-location"]);

// The directory a command line starts in (harness-gaps R1, decision 2): a first command
// `Set-Location <path>` or `cd <path>` with one literal path to an existing directory. The
// commands after it resolve their relative paths against it, as the shell does. null for every
// other first command, a computed or pattern path, and a path that is no directory.
function leadingDirectory(words, cwd) {
  const name = path.basename(String(words[0] || "")).toLowerCase();
  if (!["cd", "chdir", "set-location", "sl"].includes(name)) return null;
  const args = words.slice(1).map(String).filter((word) => !["-path", "-literalpath"].includes(word.toLowerCase()));
  if (args.length !== 1 || !args[0] || args[0].startsWith("-") || args[0].startsWith("~") || /[$`*?\0]/u.test(args[0])) return null;
  const target = path.resolve(cwd, hookContext.msysPath(args[0]));
  try { return fs.statSync(target).isDirectory() ? target : null; } catch { return null; }
}

// --- Commands judged by their options and program text (package shell-grants, A4 and A6) --------
// Each classifier reads the words of one invocation, never runs anything, and refuses what it
// cannot read: an unknown option, a program in a file, a computed argument.

function readOnlyAllow() {
  return { allowed: true, code: "READ_ONLY_COMMAND" };
}

function escalation(name, detail, next) {
  return denial("READ_COMMAND_ESCALATION", name + " " + detail, next || "Run the same read command without execution or output-file options.");
}

// awk and gawk: a program that runs a command, pipes, writes a file, loads code or comes from a
// file is refused. The switches that only shape reading and parsing pass; every other switch
// (-f, -i, -E, -l, -o, -p, -d, -D, -g, -M, ...) is refused, so an option spelled in a way this
// list does not know cannot slip through.
const AWK_SWITCHES = new Set(["-b", "-c", "-n", "-N", "-P", "-r", "-s", "-S", "-t", "-O", "--characters-as-bytes",
  "--traditional", "--non-decimal-data", "--posix", "--re-interval", "--sandbox", "--no-optimize", "--optimize",
  "--use-lc-numeric"]);

// Keywords after which a / starts a regular expression, not a division.
const AWK_REGEX_KEYWORDS = new Set(["print", "printf", "return", "else", "do", "in", "getline"]);

// The program with its string literals, its regular expressions and its comments taken out
// (strings become "", regular expressions //), so that a ; { } > or quote inside them hides and
// shows nothing. Whether a / opens a regular expression depends on what precedes it, and a
// program can be written to make one reading wrong. The caller therefore reads the program under
// every reading that can differ: regexAfterParen (a / after a closing parenthesis opens a
// regular expression), brackets (a / inside [...] does not close the expression) and
// divisionOnly (no regular expressions at all).
function awkCodeView(text, { regexAfterParen = false, brackets = true, divisionOnly = false, allRegex = false }) {
  let out = "";
  let operand = false;
  let paren = false;
  for (let index = 0; index < text.length;) {
    const char = text[index];
    if (char === "\"") {
      index += 1;
      while (index < text.length && text[index] !== "\"") index += text[index] === "\\" ? 2 : 1;
      index += 1;
      out += "\"\"";
      operand = true; paren = false;
    } else if (char === "#") {
      while (index < text.length && text[index] !== "\n") index += 1;
    } else if (char === "/" && !divisionOnly && (allRegex || !operand || (paren && regexAfterParen))) {
      index += 1;
      let inBracket = false;
      while (index < text.length && text[index] !== "\n" && (inBracket || text[index] !== "/")) {
        if (text[index] === "\\") index += 1;
        else if (brackets && text[index] === "[") inBracket = true;
        else if (brackets && text[index] === "]") inBracket = false;
        index += 1;
      }
      index += 1;
      out += "//";
      operand = true; paren = false;
    } else if (/[A-Za-z0-9_.]/u.test(char)) {
      let end = index;
      while (end < text.length && /[A-Za-z0-9_.]/u.test(text[end])) end += 1;
      operand = !AWK_REGEX_KEYWORDS.has(text.slice(index, end));
      paren = false;
      out += text.slice(index, end);
      index = end;
    } else {
      if (!/\s/u.test(char)) { operand = char === ")" || char === "]"; paren = char === ")"; }
      out += char;
      index += 1;
    }
  }
  return out;
}

// The statements of a program as strings. A ; { or } ends one. A line break ends one only when
// the line is complete: it ends in a word, a number, a string, ) or ], and the next line does not
// start with > or | (a line that ends in a comma, an operator or an opening bracket goes on, and so
// does an unusual line break nobody wrote on purpose; the doubt goes to refusing).
function awkStatements(code) {
  const statements = [];
  let current = "";
  for (let index = 0; index < code.length; index += 1) {
    const char = code[index];
    if (char === ";" || char === "{" || char === "}") { statements.push(current); current = ""; }
    else if (char === "\n") {
      const last = current.trimEnd().slice(-1);
      const next = code.slice(index + 1).trimStart()[0] || "";
      if (last === "" || (/[A-Za-z0-9_")\]]/u.test(last) && next !== ">" && next !== "|")) { statements.push(current); current = ""; }
      else current += " ";
    } else current += char;
  }
  statements.push(current);
  return statements;
}

// What an awk program may not contain; null when it contains none of it. The program is read as
// the shell passes it and as awk reads it (a backslash before a line break is a continuation and
// vanishes first). Refused in any form: system( ; every @ (gawk calls a function by the name in a
// variable, @f(...), and loads code with @include, @load and @namespace; a name put together from
// pieces runs through it, so no @ is judged); every | (a pipe to or from a command, |&); the
// network file names /inet; a name written with :: (a namespace function); and print or printf
// followed by > or >> in one statement, however the statement is wrapped (line breaks after a
// comma, parentheses, BEGIN, END). The statement is read under several readings of the program
// (see awkCodeView) and the raw text; any reading that finds a redirection refuses.
function awkProgramProblem(program) {
  const text = String(program).replace(/\\r?\n/gu, "");
  if (/system\s*\(/iu.test(text)) return "calls system()";
  if (text.includes("@")) return "uses @ (an indirect call by name, @include, @load or @namespace), which cannot be checked";
  if (/\/inet[46]?\//iu.test(text)) return "opens a network file name (/inet)";
  // A logical or (||) is no pipe; every other | is one (print | cmd, cmd | getline, |&).
  if (text.replaceAll("||", "").includes("|")) return "pipes to or from a command";
  const views = [
    ...[true, false].flatMap((brackets) => [true, false].map((regexAfterParen) => awkCodeView(text, { brackets, regexAfterParen }))),
    awkCodeView(text, { divisionOnly: true }),
    awkCodeView(text, { allRegex: true }),
  ];
  if (views.some((view) => view.includes("::"))) return "calls a function by a namespace name (::)";
  const redirects = (code) => awkStatements(code).some((part) => /\bprint(?:f)?\b[\s\S]*>/u.test(part));
  if (views.some(redirects) || ((text.includes("/") || text.includes("#")) && redirects(text))) return "redirects print or printf with > or >>";
  return null;
}

function classifyAwk(name, words, context) {
  if (computedArguments(words, context)) return computedDenial(name);
  const args = words.slice(1).map(String);
  const programs = [];
  let hasSource = false;
  let index = 0;
  for (; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") { index += 1; break; }
    if (!arg.startsWith("-") || arg === "-") break;
    if (AWK_SWITCHES.has(arg)) continue;
    const long = /^(--(?:field-separator|assign|source))(?:=([\s\S]*))?$/u.exec(arg);
    const short = /^(-[Fve])([\s\S]*)$/u.exec(arg);
    const option = long ? long[1] : short ? short[1] : null;
    if (!option) return escalation(name, "option " + arg + " is not one of the reading switches (-f, -i, -E, -l, -o, -p and similar are refused)");
    let value = long ? long[2] : short[2];
    if (value === undefined || (short && value === "")) {
      index += 1;
      value = args[index];
    }
    if (value === undefined) return escalation(name, "option " + arg + " has no value");
    if (option === "-e" || option === "--source") { programs.push(value); hasSource = true; }
  }
  if (args.some((arg) => /(?:^|=)\/inet[46]?\//iu.test(arg))) return escalation(name, "names a network file (/inet), which opens a connection");
  if (!hasSource) {
    if (index >= args.length) return escalation(name, "has no program");
    programs.push(args[index]);
  }
  // Several -e / --source programs are also read as one text, in case a runtime joins them.
  for (const program of programs.length > 1 ? [...programs, programs.join("\n")] : programs) {
    const problem = awkProgramProblem(program);
    if (problem) return escalation(name, "program " + problem, "Run awk with a program that only reads and prints, or use the Write and Edit tools.");
  }
  return readOnlyAllow();
}

// gh api: reading only. The method is GET; no field, raw field or input file (they turn the call
// into a POST); no other host (the token would go there); graphql with a mutation is refused.
const GH_API_SWITCHES = new Set(["-i", "--include", "--paginate", "--silent", "--slurp", "--verbose", "-h", "--help"]);
const GH_API_VALUES = new Set(["-H", "--header", "-q", "--jq", "-t", "--template", "-p", "--preview", "--cache"]);

function classifyGhApi(words, context) {
  const refuse = (detail) => denial("READ_COMMAND_ESCALATION", "gh api " + detail,
    "Run gh api with a GET request and without -X other than GET, -f, -F, --field, --raw-field or --input.");
  if (computedArguments(words, context)) return computedDenial("gh");
  const args = words.slice(2).map(String);
  let endpoint = null;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("-") || arg === "-") {
      if (endpoint !== null) return refuse("takes one endpoint");
      endpoint = arg;
      continue;
    }
    let option = arg;
    let value = null;
    if (arg.startsWith("--")) {
      const equals = arg.indexOf("=");
      if (equals >= 0) { option = arg.slice(0, equals); value = arg.slice(equals + 1); }
    } else if (arg.length > 2) {
      option = arg.slice(0, 2);
      value = arg.slice(2).replace(/^=/u, "");
    }
    if (["-f", "-F", "--field", "--raw-field", "--input"].includes(option)) return refuse("option " + option + " makes the call a write");
    if (GH_API_SWITCHES.has(option)) {
      if (value !== null) return refuse("option " + option + " takes no value");
      continue;
    }
    if (option === "-X" || option === "--method" || GH_API_VALUES.has(option)) {
      if (value === null) { index += 1; value = args[index]; }
      if (value === undefined) return refuse("option " + option + " has no value");
      if ((option === "-X" || option === "--method") && !/^GET$/iu.test(value)) return refuse("method " + value + " is not GET");
      if ((option === "-H" || option === "--header") && /method-override/iu.test(value)) return refuse("header " + value + " overrides the method");
      continue;
    }
    return refuse("option " + arg + " is not one of the reading options");
  }
  if (endpoint === null) return args.some((arg) => arg === "-h" || arg === "--help") ? readOnlyAllow() : refuse("needs an endpoint");
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//u.test(endpoint) || endpoint.startsWith("//")) return refuse("endpoint " + endpoint + " names another host");
  if (/^\/?graphql\/?$/iu.test(endpoint) && args.some((arg) => /mutation/iu.test(arg))) return refuse("graphql with a mutation writes");
  return readOnlyAllow();
}

// ollama: process list, model list and one model's details; every other subcommand (run, pull,
// rm, create, serve, push, cp, stop ...) stays closed. `ollama --version` is a version query.
const OLLAMA_SHOW_SWITCHES = new Set(["--license", "--modelfile", "--parameters", "--system", "--template", "--verbose", "-v"]);

function classifyOllama(args) {
  if (args.length === 1 && (args[0] === "ps" || args[0] === "list")) return readOnlyAllow();
  if (args[0] !== "show") return null;
  const rest = args.slice(1).map(String);
  const models = rest.filter((arg) => !arg.startsWith("-"));
  if (models.length === 1 && /^[A-Za-z0-9][A-Za-z0-9._:/@-]*$/u.test(models[0]) &&
      rest.filter((arg) => arg.startsWith("-")).every((arg) => OLLAMA_SHOW_SWITCHES.has(arg))) return readOnlyAllow();
  return null;
}

// claude: help for the program or for one of its subcommands (words, then --help or -h).
function classifyClaude(args) {
  const last = args[args.length - 1];
  if (args.length >= 1 && (last === "--help" || last === "-h") &&
      args.slice(0, -1).every((word) => /^[A-Za-z][A-Za-z0-9_-]*$/u.test(word))) return readOnlyAllow();
  return null;
}

// `time <command>` in Bash: the command after time (and -p) is judged by the same policy.
function classifyTime(words, context) {
  const rest = words.slice(String(words[1]) === "-p" ? 2 : 1);
  if (rest.length === 0) return { allowed: true, code: "EMPTY" };
  if (String(rest[0]).startsWith("-")) {
    return denial("DYNAMIC_WRAPPER", "time accepts -p only; another option belongs to a program that can write a file", "Run the command without time options.");
  }
  return classifyWords(rest, context);
}

// sed: a script that writes (w, W, the s flag w), executes (e, the s flag e) or comes from a file
// (-f) is a write; in-place editing (-i) is one already. The script is read by a small parser of
// sed's own grammar; what it cannot read it refuses.
const SED_SWITCHES = new Set(["--quiet", "--silent", "--regexp-extended", "--separate", "--unbuffered", "--null-data",
  "--posix", "--debug", "--sandbox", "--binary", "--follow-symlinks", "--help", "--version"]);

function sedScriptProblem(script) {
  const text = String(script);
  const writes = (detail) => ({ code: "DIRECT_SHELL_WRITE", detail });
  const unreadable = (detail) => ({ code: "READ_COMMAND_ESCALATION", detail: "the sed script cannot be checked (" + detail + ")" });
  let index = 0;
  // Reads up to and past the closing delimiter of a regular expression or a replacement.
  const delimited = (delimiter) => {
    while (index < text.length) {
      const char = text[index];
      if (char === "\\") { index += 2; continue; }
      index += 1;
      if (char === delimiter) return true;
    }
    return false;
  };
  const toLineEnd = () => {
    while (index < text.length && text[index] !== "\n") index += text[index] === "\\" ? 2 : 1;
  };
  const skipBlank = () => { while (index < text.length && /[ \t]/u.test(text[index])) index += 1; };
  const digits = () => { while (index < text.length && /[0-9]/u.test(text[index])) index += 1; };
  const address = () => {
    const char = text[index];
    if (/[0-9]/u.test(char)) { digits(); if (text[index] === "~") { index += 1; digits(); } return true; }
    if (char === "$") { index += 1; return true; }
    if (char === "+" || char === "~") { index += 1; digits(); return true; }
    if (char === "/" || (char === "\\" && index + 1 < text.length)) {
      const delimiter = char === "/" ? "/" : text[index + 1];
      index += char === "/" ? 1 : 2;
      if (!delimited(delimiter)) return null;
      while (/[IM]/u.test(text[index] || "")) index += 1;
      return true;
    }
    return false;
  };
  while (index < text.length) {
    const char = text[index];
    if (/[\s;]/u.test(char)) { index += 1; continue; }
    const first = address();
    if (first === null) return unreadable("an address is not closed");
    if (first) {
      skipBlank();
      if (text[index] === ",") {
        index += 1;
        skipBlank();
        if (address() !== true) return unreadable("the second address is missing");
      }
    }
    skipBlank();
    while (text[index] === "!") { index += 1; skipBlank(); }
    if (index >= text.length) break;
    const command = text[index];
    index += 1;
    if (command === "{" || command === "}") continue;
    if (command === "#") { toLineEnd(); continue; }
    if (command === "w" || command === "W") return writes("sed command " + command + " writes a file");
    if (command === "e") return writes("sed command e executes a command");
    if (command === "s") {
      const delimiter = text[index];
      if (delimiter === undefined || delimiter === "\n" || delimiter === "\\") return unreadable("the s command has no delimiter");
      index += 1;
      if (!delimited(delimiter) || !delimited(delimiter)) return unreadable("an s command is not closed");
      while (index < text.length && /[a-zA-Z0-9]/u.test(text[index])) {
        const flag = text[index];
        if (flag === "w" || flag === "e") return writes("the sed s flag " + flag + " " + (flag === "w" ? "writes a file" : "executes a command"));
        if (!"gpIiMm0123456789".includes(flag)) return unreadable("unknown s flag " + flag);
        index += 1;
      }
      continue;
    }
    if (command === "y") {
      const delimiter = text[index];
      if (delimiter === undefined || delimiter === "\n" || delimiter === "\\") return unreadable("the y command has no delimiter");
      index += 1;
      if (!delimited(delimiter) || !delimited(delimiter)) return unreadable("a y command is not closed");
      continue;
    }
    if ("aicrR".includes(command)) { toLineEnd(); continue; }
    if (command === ":" || "btT".includes(command)) {
      skipBlank();
      while (index < text.length && !/[\s;]/u.test(text[index])) index += 1;
      continue;
    }
    if ("lLqQ".includes(command)) { skipBlank(); digits(); continue; }
    if ("=dDgGhHnNpPxzF".includes(command)) continue;
    return unreadable("unknown command " + command);
  }
  return null;
}

// null, or { code, detail } for the form of sed that writes or cannot be read.
function sedProblem(args) {
  const writes = (detail) => ({ code: "DIRECT_SHELL_WRITE", detail });
  const scripts = [];
  const operands = [];
  let scripted = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") { operands.push(...args.slice(index + 1)); break; }
    if (arg.startsWith("--")) {
      const equals = arg.indexOf("=");
      const option = equals < 0 ? arg : arg.slice(0, equals);
      if (option === "--in-place") return writes("sed --in-place edits files");
      if (option === "--file") return writes("sed --file runs a script from a file, which cannot be checked");
      if (option === "--expression" || option === "--line-length") {
        let value = equals < 0 ? undefined : arg.slice(equals + 1);
        if (value === undefined) { index += 1; value = args[index]; }
        if (value === undefined) return { code: "READ_COMMAND_ESCALATION", detail: "sed option " + option + " has no value" };
        if (option === "--expression") { scripts.push(value); scripted = true; }
        continue;
      }
      if (SED_SWITCHES.has(option) && equals < 0) continue;
      return { code: "READ_COMMAND_ESCALATION", detail: "sed option " + arg + " is not known" };
    }
    if (arg.startsWith("-") && arg.length > 1) {
      for (let at = 1; at < arg.length; at += 1) {
        const letter = arg[at];
        if (letter === "i") return writes("sed -i edits files");
        if (letter === "f") return writes("sed -f runs a script from a file, which cannot be checked");
        if (letter === "e" || letter === "l") {
          let value = arg.slice(at + 1);
          if (value === "") { index += 1; value = args[index]; }
          if (value === undefined) return { code: "READ_COMMAND_ESCALATION", detail: "sed option -" + letter + " has no value" };
          if (letter === "e") { scripts.push(value); scripted = true; }
          break;
        }
        if (!"nErsuzb".includes(letter)) return { code: "READ_COMMAND_ESCALATION", detail: "sed option -" + letter + " is not known" };
      }
      continue;
    }
    operands.push(arg);
  }
  if (!scripted && operands.length > 0) scripts.push(operands[0]);
  for (const script of scripts) {
    const problem = sedScriptProblem(script);
    if (problem) return problem;
  }
  return null;
}

// uniq INPUT OUTPUT writes OUTPUT. Options that take a value (-f, -s, -w and their long forms)
// are skipped with it; every other word without a leading dash, and a lone -, is an operand.
function uniqWritesFile(args) {
  let operands = 0;
  let operandsOnly = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!operandsOnly && arg === "--") { operandsOnly = true; continue; }
    if (!operandsOnly && arg.startsWith("--")) {
      const equals = arg.indexOf("=");
      if (equals < 0 && ["--skip-fields", "--skip-chars", "--check-chars"].includes(arg)) index += 1;
      continue;
    }
    if (!operandsOnly && arg.startsWith("-") && arg.length > 1) {
      const at = [...arg.slice(1)].findIndex((letter) => "fsw".includes(letter));
      if (at >= 0 && at === arg.length - 2) index += 1;
      continue;
    }
    operands += 1;
  }
  return operands >= 2;
}

// tar with a mode that writes (create, extract, append, update, delete, concatenate) in any
// spelling: bundled letters with or without a leading dash, or a long option.
function tarWrites(args) {
  return args.some((arg, index) => {
    if (arg.startsWith("--")) return ["create", "extract", "get", "append", "update", "delete", "catenate", "concatenate"].includes(arg.slice(2).split("=")[0]);
    if (arg.startsWith("-")) return /^-[A-Za-z]*[xcruA]/u.test(arg);
    return index === 0 && /^[A-Za-z]+$/u.test(arg) && /[xcruA]/u.test(arg);
  });
}

// The write forms of commands that are otherwise read-only: null, or { code, detail }.
function writingForm(name, args) {
  if (name === "find") {
    const flag = args.find((arg) => ["-delete", "-exec", "-execdir", "-ok", "-okdir", "-fprint", "-fprint0", "-fprintf", "-fls"].includes(arg));
    return flag ? { code: "DIRECT_SHELL_WRITE", detail: "find " + flag + " writes or executes" } : null;
  }
  if (name === "sed") return sedProblem(args);
  if (name === "uniq" && uniqWritesFile(args)) return { code: "DIRECT_SHELL_WRITE", detail: "uniq with an output file writes it" };
  if (name === "tar" && tarWrites(args)) return { code: "DIRECT_SHELL_WRITE", detail: "tar in a creating or extracting mode writes files" };
  return null;
}

// A variable before a Bash command (`NAME=value command`, package shell-grants, A4): the command
// is judged, the variable passes unless its name loads code, replaces a program or steers the
// Harness. The expression is the Owner list of the package (PATH ... TMPDIR) plus the names that
// make the programs this policy allows run other code: a ripgrep config (--pre), the pager and
// editor commands, awk's library path, shell functions imported from the environment, the
// variables that change how the shell reads a command (IFS, CDPATH, GLOBIGNORE), and the
// Harness's own KEEL_, CLAUDE_ and CODEX_ variables (a package session or rule root), and the
// variables that decide where gh api sends its token or which settings it reads: every GH_* and
// GITHUB_* name (GH_HOST, GH_TOKEN, GH_CONFIG_DIR, GH_REPO, GITHUB_API_URL ...) plus the proxy,
// XDG and certificate-store names.
const ENVIRONMENT_ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)=/u;
const DANGEROUS_ENVIRONMENT = new RegExp("^(?:PATH|PATHEXT|NODE_OPTIONS|NODE_PATH|LD_.*|DYLD_.*|GIT_.*|GH_.*|GITHUB_.*|BASH_ENV|ENV|" +
  "PROMPT_COMMAND|PS4|SHELLOPTS|BASHOPTS|PYTHONSTARTUP|PYTHONPATH|PERL5OPT|PERL5LIB|RUBYOPT|COMSPEC|SHELL|HOME|" +
  "USERPROFILE|APPDATA|TEMP|TMP|TMPDIR|KEEL_.*|CLAUDE_.*|CODEX_.*|RIPGREP_CONFIG_PATH|LESSOPEN|LESSCLOSE|AWKPATH|" +
  "AWKLIBPATH|GREP_OPTIONS|PAGER|EDITOR|VISUAL|BASH_FUNC_.*|IFS|CDPATH|GLOBIGNORE|" +
  "(?:HTTPS?|ALL|NO)_PROXY|XDG_.*|SSL_CERT_.*|CURL_CA_BUNDLE|NODE_EXTRA_CA_CERTS|NODE_TLS_.*)$", "iu");

function classifyAssignmentPrefix(words, context) {
  let index = 0;
  while (index < words.length && ENVIRONMENT_ASSIGNMENT.test(String(words[index]))) {
    const name = ENVIRONMENT_ASSIGNMENT.exec(String(words[index]))[1];
    if (DANGEROUS_ENVIRONMENT.test(name)) {
      return denial("ENVIRONMENT_OVERRIDE", "the environment override " + name + " can preload or replace executable code", "Run the canonical command without an environment prefix.");
    }
    index += 1;
  }
  if (index >= words.length) {
    return denial("ENVIRONMENT_OVERRIDE", "an assignment without a command leaves a shell variable behind", "Put the command after the assignment on the same line, or run it without the variable.");
  }
  return classifyWords(words.slice(index), context);
}

// The arguments of a command whose options or program text the policy reads must be the text the
// shell passes on: no command substitution, no quoting or brace expansion that is decided later
// (Bash), and in PowerShell no argument computed at run time. optionsOnly: an expansion counts only
// where it could make an option (a word that starts with a dash or a brace), for commands whose
// other arguments are paths (src/{a,b}.js stays free).
function computedArguments(words, context, optionsOnly = false) {
  if (context.dialect === "powershell") return context.staticArguments === false;
  return words.slice(1).some((word) => commandModel.isSubstitutedWord(word) ||
    (commandModel.isExpandedWord(word) && (!optionsOnly || /^[-{]/u.test(word))));
}

function computedDenial(name) {
  return denial("DYNAMIC_EVALUATION", name + " has an argument that is computed at run time (substitution, expansion or variable)",
    "Write the arguments out literally.");
}

// Commands that read their arguments as data only: a command substitution may fill an argument
// of these (the substituted command itself is judged first). The commands whose options can
// write, execute or read a program (rg --pre, sort -o, uniq in out, ...) are left out: the
// result of a substitution could be such an option.
const SUBSTITUTION_TOLERANT = new Set([...READ_ONLY_COMMANDS].filter((name) =>
  !["rg", "fd", "sort", "tree", "diff", "file", "uniq", "date", "less", "more"].includes(name)));

// One invocation, as [name, ...arguments] from either shell (guard-parity E1). A Bash
// segment that starts with &, (, env or command never reaches the name check: those are
// refused as second dispatch surfaces. A leading assignment is judged by its name.
function classifyWords(words, context) {
  const first = String(words[0] || "");
  const firstName = path.basename(first).toLowerCase();
  if (ENVIRONMENT_ASSIGNMENT.test(first)) {
    if (context.dialect === "powershell") {
      return denial("ENVIRONMENT_OVERRIDE", "per-command environment overrides can preload or replace executable code", "Run the canonical command without an environment prefix.");
    }
    return classifyAssignmentPrefix(words, context);
  }
  if (["&", "("].includes(first) || ["env", "command"].includes(firstName)) {
    return denial("DYNAMIC_WRAPPER", (firstName || first) + " is a second command-dispatch surface", "Run the declared command directly without a wrapper.");
  }
  const start = 0;
  const raw = words[start] || "";
  const executable = path.basename(raw.replace(/^[(&]+|[)]$/gu, "")).toLowerCase();
  const name = executable.endsWith(".exe") ? executable.slice(0, -4) : executable;
  const args = words.slice(start + 1);
  if (!name || name.startsWith("#")) return { allowed: true, code: "EMPTY" };
  // `time <command>` in Bash: the command is judged, time is only a prefix (package shell-grants, A4).
  if (name === "time" && context.dialect !== "powershell" && !/[\\/]/u.test(raw)) return classifyTime(words, context);
  if (context.dialect !== "powershell") {
    if (commandModel.isSubstitutedWord(raw) || commandModel.isExpandedWord(raw)) {
      return denial("DYNAMIC_EVALUATION", "the command name is computed at run time", "Write the command name out literally.");
    }
    if (args.some((word) => commandModel.isSubstitutedWord(word)) && !SUBSTITUTION_TOLERANT.has(name)) return computedDenial(name);
  }
  if (DYNAMIC_COMMANDS.has(name)) {
    return denial("DYNAMIC_WRAPPER", name + " can execute a second command outside static policy", "Run the declared command directly without a wrapper.");
  }
  // A version query of a bare program name reads only (guard-scope R2); a path or a script file
  // is code and stays with the branches below. There is no general `version` subcommand
  // (npm version writes package.json).
  if (args.length === 1 && args[0] === "--version" && !/[\\/]/u.test(raw) && !/\.(?:js|mjs|cjs|ps1|sh|bat|cmd|py)$/iu.test(raw)) {
    return { allowed: true, code: "VERSION_QUERY" };
  }
  if (["git", "git.exe"].includes(name)) {
    const git = gitGuard.gitFromWords(words);
    if (gitGuard.harmlessRead(git)) return { allowed: true, code: "READ_ONLY_GIT" };
    // Git maintenance of a session not bound to a work step (git-intent-guard decides the same way).
    if (git && gitGuard.maintenanceAllowed({ ...git, intent: gitGuard.semanticIntent({ ...git, cwd: context.cwd }) },
      maintenanceContext(context)).allowed) return { allowed: true, code: "GIT_MAINTENANCE" };
    return denial("UNCLASSIFIED_GIT", "Git must be owned by git-intent-guard", gitGuard.canonicalRoute("explain", context.projectRoot, context.sessionId, "unknown"));
  }
  if (["node", "node.exe"].includes(name)) return classifyNode(words, start, context);
  if (["python", "python.exe", "python3", "python3.exe", "ruby", "ruby.exe", "perl", "perl.exe", "deno", "deno.exe", "bun", "bun.exe"].includes(name)) {
    if (args.length === 1 && ["-v", "--version"].includes(args[0].toLowerCase())) return { allowed: true, code: "INTERPRETER_INFORMATION" };
    return denial("INTERPRETER_EXECUTION", name + " code and scripts are not in the finite executable policy", declaredRoute());
  }
  if (["powershell", "powershell.exe", "pwsh", "pwsh.exe"].includes(name)) return classifyPowerShell(words, start, context);
  if (["cmd", "cmd.exe"].includes(name)) return classifyCmd(words, start, context);
  if (["bash", "bash.exe", "sh", "zsh", "dash", "fish"].includes(name)) {
    if (args.length === 1 && args[0] === "--version") return { allowed: true, code: "SHELL_INFORMATION" };
    // Codex on Windows runs every Bash command as a PowerShell line `& '...\bash.exe' -c '<payload>'`.
    // In the PowerShell dialect exactly one static -c payload is judged by the full Bash policy;
    // script files, -lc, -s, stdin, several payloads, other shells and every Bash-dialect bash -c
    // stay SHELL_WRAPPER.
    if (context.dialect === "powershell" && name === "bash" && context.staticArguments === true &&
        args.length === 2 && args[0] === "-c") {
      const payloads = commandModel.wrapperPayloadsFromWords(words);
      if (payloads.length === 1 && payloads[0].dialect === "bash") {
        return inspectBash(payloads[0].value, { projectRoot: context.projectRoot, cwd: context.cwd,
          sessionId: context.sessionId, changesDirectory: Boolean(context.changesDirectory) });
      }
    }
    return denial("SHELL_WRAPPER", name + " scripts and -c forms can hide repository writes", directRoute());
  }
  if (["npm", "npm.cmd", "npx", "npx.cmd", "pnpm", "pnpm.cmd", "yarn", "yarn.cmd"].includes(name)) {
    return classifyProjectTool(name.replace(/\.cmd$/u, ""), words, context);
  }
  if (name === "get-ciminstance" || name === "get-wmiobject") {
    const query = classifyCim(name, words);
    if (query) return query;
    return denial("UNDECLARED_EXECUTABLE", name + " reads only the classes Win32_Process and Win32_OperatingSystem", verifierRoute(context.projectRoot));
  }
  if (name === "stop-process" || name === "taskkill") return classifyProcessStop(name, words, context);
  if (WRITE_COMMANDS.has(name)) {
    const owned = ownedWrite(name, words, context);
    if (owned) return owned;
    return denial("DIRECT_SHELL_WRITE", name + " can mutate files without package/OWNS checks", editRoute());
  }
  // Harmless reading and formatting commands judged by their options (package shell-grants, A4).
  if (name === "awk" || name === "gawk") return classifyAwk(name, words, context);
  if (name === "gh" && args[0] === "api") return classifyGhApi(words, context);
  if (name === "ollama") {
    const ollama = classifyOllama(args);
    if (ollama) return ollama;
  }
  if (name === "claude") {
    const help = classifyClaude(args);
    if (help) return help;
  }
  // The write forms of sed, find, uniq and tar (package shell-grants, A6).
  if (["sed", "find", "uniq", "tar"].includes(name)) {
    if (context.dialect === "powershell" ? name === "sed" && context.staticArguments === false : computedArguments(words, context, name !== "sed")) {
      return computedDenial(name);
    }
    const form = writingForm(name, args);
    if (form) return denial(form.code, form.detail, form.code === "DIRECT_SHELL_WRITE" ? editRoute()
      : "Run the same read command without execution or output-file options.");
  }
  const readEscalation =
    (["rg", "fd", "sort", "tree", "diff", "file"].includes(name) && context.dialect !== "powershell" &&
      args.some((arg) => commandModel.isExpandedWord(arg) && /^[-{]/u.test(arg))) ||
    (name === "rg" && args.some((arg) => /^--pre(?:=|$)/u.test(arg))) ||
    (name === "fd" && args.some((arg) => /^(?:-x|-X|--exec(?:-batch)?)(?:=|$|.)/u.test(arg))) ||
    (["sort", "tree"].includes(name) && args.some((arg) => arg === "-o" || /^-o.+/u.test(arg) || /^--output(?:=|$)/u.test(arg))) ||
    (name === "diff" && args.some((arg) => /^--output(?:=|$)/u.test(arg))) ||
    (name === "file" && args.some((arg) => arg === "-C" || arg === "--compile"));
  if (readEscalation) {
    return denial("READ_COMMAND_ESCALATION", name + " option escapes read-only behavior", "Run the same read command without execution or output-file options.");
  }
  if (name === "sed" || name === "find" || READ_ONLY_COMMANDS.has(name)) return { allowed: true, code: "READ_ONLY_COMMAND" };
  const directVerifiers = declarations(context, "verifier", VERIFIER_PATHS);
  if (!directVerifiers) return policyDenial(context);
  const directVerifier = declared(raw, context, directVerifiers);
  if (directVerifier) return { allowed: true, code: "DECLARED_VERIFIER", path: directVerifier };
  return denial("UNDECLARED_EXECUTABLE", name + " is not in the finite read/verifier/mutation policy", declaredRoute());
}

// Control-flow words this policy lets a segment start with (guard-scope R2). commandStart
// skips more (assignments, &, (, env, command, ...); every other skipped word is judged by
// classifyWords from that word on, so overrides and wrappers stay blocked.
const CONTROL_KEYWORDS = new Set(["do", "then", "else", "elif", "if", "while", "until", "!", "{"]);

// Merging and discarding output streams (2>&1, >&2, 2>/dev/null, &>/dev/null, 2>&-) write no
// file; their words leave the arguments before classification. The kind comes from
// command-model alone; the command name always stays, and a word that only ends in such an
// operator (x.test.js>&1) is an argument Bash passes on.
function withoutFreeRedirections(words) {
  return words.filter((word, index) => {
    if (index === 0) return true;
    const found = commandModel.bashRedirections(word);
    return !(found.length === 1 && ["merge", "discard"].includes(found[0].kind) &&
      String(word).startsWith((found[0].fd ?? "") + found[0].operator));
  });
}

function classifySegment(segment, context) {
  const words = commandModel.shellWords(segment);
  const kind = commandModel.bashSegmentKind(words);
  const start = commandModel.commandStart(words);
  const foreign = words.slice(0, start).findIndex((word) => !CONTROL_KEYWORDS.has(word));
  if (foreign >= 0) return classifyWords(withoutFreeRedirections(words.slice(foreign)), context);
  if (kind === "keyword-only" || kind === "loop-header") return { allowed: true, code: "SHELL_CONTROL" };
  return classifyWords(withoutFreeRedirections(kind), context);
}

// A method call on the result of Get-Date, `(Get-Date).AddMinutes(28)`: the result is a DateTime,
// whose Add*, Subtract and To* methods compute a new value and write nothing. The text must start
// with the parenthesised Get-Date command (no nested parentheses); inner calls are judged on
// their own as members.
const GET_DATE_RESULT = /^\(\s*get-date(?:\s[^()]*)?\)\s*\./iu;
const DATE_METHODS = /^(?:add[a-z]*|subtract|to[a-z]+|compareto|equals|gethashcode|isdaylightsavingtime|gettype)$/u;

function memberAllowed(member) {
  const name = member.member.toLowerCase();
  if (!member.static && GET_DATE_RESULT.test(member.text) && DATE_METHODS.test(name)) return true;
  if (!member.static) return READ_ONLY_INSTANCE_MEMBERS.has(name);
  const members = READ_ONLY_STATIC_MEMBERS.get(member.type.toLowerCase());
  return Boolean(members && members.has(name));
}

// The PowerShell form of the same policy (guard-parity E3). PowerShell's parser sees every
// command a line runs -- in pipelines, script blocks, subexpressions and control flow -- so
// each is judged by classifyWords; what Bash can only refuse as undecidable ($(...)) is
// decided here command by command.
function redirectionDenial() {
  return denial("OUTPUT_REDIRECTION", "output redirection can write arbitrary paths before file guards run; only a literal target below the temp folder of this session is free", editRoute());
}

function inspectPowerShell(command, context) {
  const model = context.model || commandModel.parse(String(command || ""), "powershell");
  if (!model.ok) return denial("POWERSHELL_PARSE", model.error, "Write the command so PowerShell can parse it, or split it into simple commands.");
  const gitFindings = context.gitFindings || gitGuard.inspect(command, context.projectRoot, context.sessionId,
    { cwd: context.cwd, dialect: "powershell", model });
  const changesDirectory = model.invocations.some((invocation) => DIRECTORY_CHANGES.has(String(invocation.name || "")));
  // Git the intent guard refuses stays its business; allowed Git maintenance is judged below with every other command.
  const gitBlocking = gitFindings.filter((item) => !gitGuard.maintenanceAllowed(item, maintenanceContext({ ...context, changesDirectory, dialect: "powershell" })).allowed);
  if (gitBlocking.length) return { allowed: true, code: "GIT_OWNED_BY_INTENT_GUARD", git: gitBlocking[0] };
  // Merging streams (2>&1) and discarding into $null write no file; every other target does,
  // except a literal target below the temp folder of the session (package shell-grants, A5).
  for (const redirection of model.redirections) {
    if (/^\$null$/iu.test(String(redirection.target))) continue;
    const target = redirection.staticTarget
      ? ownedShellWrite.decideSessionTempTarget({ target: redirection.target, dialect: "powershell", cwd: context.cwd,
        sessionId: context.sessionId, changesDirectory })
      : { allowed: false };
    if (!target.allowed) return redirectionDenial();
  }
  if (model.envAssignments.length) {
    return denial("ENVIRONMENT_OVERRIDE", "per-command environment overrides can preload or replace executable code", "Run the canonical command without an environment prefix.");
  }
  const member = model.members.find((item) => !memberAllowed(item));
  if (member) {
    return denial("DYNAMIC_EVALUATION", ".NET call " + (member.text || member.member) + " is inline code outside the finite policy", literalRoute());
  }
  policyFor(context);
  let cwd = context.cwd;
  for (const [index, invocation] of model.invocations.entries()) {
    if (invocation.dynamicName) {
      return denial("DYNAMIC_WRAPPER", "a command whose name is computed at run time is a second command-dispatch surface", "Run the declared command directly without a wrapper.");
    }
    const decision = classifyWords(invocation.words, { ...context, cwd, startCwd: context.cwd, dialect: "powershell",
      staticArguments: invocation.staticArguments, changesDirectory });
    if (!decision.allowed) return decision;
    if (index === 0 && invocation.staticArguments) cwd = leadingDirectory(invocation.words, cwd) || cwd;
  }
  return { allowed: true, code: "FINITE_POLICY_ALLOW" };
}

function inspect(command, context = {}) {
  const projectRoot = path.resolve(context.projectRoot || process.cwd());
  const cwd = path.resolve(context.cwd || projectRoot);
  const sessionId = context.sessionId || "";
  const policyContext = { projectRoot, cwd, sessionId, transcriptPath: context.transcriptPath || "" };
  // A3: the Git findings git-intent-guard took for exactly this command, rule root, session and dialect in the same
  // process (.claude/pretool-guards.js) are used as they are; anything else is judged here.
  const shared = context.gitFindings;
  const gitFindings = shared && shared.command === String(command || "") && shared.projectRoot === context.projectRoot &&
    shared.sessionId === sessionId && shared.dialect === context.dialect && Array.isArray(shared.found) ? shared.found : null;
  if (context.dialect === "powershell") return inspectPowerShell(command, { ...policyContext, model: context.model, gitFindings });
  return inspectBash(command, { ...policyContext, gitFindings });
}

// The Bash form of the policy. changesDirectory carries a directory change of an enclosing
// PowerShell line into a bash -c payload judged here.
function inspectBash(command, context) {
  const { projectRoot, cwd, sessionId, transcriptPath } = context;
  const sharedGit = context.gitFindings || null;
  const policyContext = { projectRoot, cwd, startCwd: cwd, sessionId, transcriptPath };
  // The finite executable policy holds whether or not a package is bound (audit H6):
  // rm/Set-Content/undeclared Node scripts/redirection stay blocked with no active
  // package. Mutating Git stays owned by git-intent-guard; harmless Git reads, read-only
  // inspection plus the declared Dashboard service (SERVICE_PATHS/DECLARED_SERVICE) remain
  // reachable.
  const gitFindings = sharedGit || gitGuard.inspect(command, projectRoot, sessionId, { cwd });
  // Command substitution (package shell-grants, A4): every substituted command is judged by this
  // policy as a line of its own, and the outer line with an inert word in place of each result.
  const substitutions = commandModel.commandSubstitutions(command);
  const commandSegments = commandModel.segments(substitutions.ok ? substitutions.outer : command);
  policyContext.dialect = "bash";
  policyContext.changesDirectory = Boolean(context.changesDirectory) || commandSegments.some((segment) => {
    const words = commandModel.shellWords(segment);
    return DIRECTORY_CHANGES.has(commandModel.executableName(words[commandModel.commandStart(words)]));
  });
  // Git the intent guard refuses stays its business; allowed Git maintenance is judged below with every other command.
  const gitBlocking = gitFindings.filter((item) => !gitGuard.maintenanceAllowed(item, maintenanceContext(policyContext)).allowed);
  if (gitBlocking.length) return { allowed: true, code: "GIT_OWNED_BY_INTENT_GUARD", git: gitBlocking[0] };
  // A file redirection is refused unless every one targets a literal path below the temp folder
  // of the session (A5); redirections inside a substitution count.
  for (const redirection of commandModel.bashRedirections(command).filter((item) => item.kind === "file")) {
    const target = redirection.operator === "<>" ? { allowed: false }
      : ownedShellWrite.decideSessionTempTarget({ target: redirection.target, dialect: "bash", cwd: policyContext.startCwd,
        sessionId, changesDirectory: policyContext.changesDirectory });
    if (!target.allowed) return redirectionDenial();
  }
  if (!substitutions.ok || substitutions.other) {
    return denial("DYNAMIC_EVALUATION", "process substitution, arithmetic expansion and an unclosed substitution are undeclared executable surfaces", literalRoute());
  }
  for (const inner of substitutions.inner) {
    const decision = inspectBash(inner, { projectRoot, cwd, sessionId, transcriptPath, changesDirectory: policyContext.changesDirectory });
    if (!decision.allowed) {
      return denial("DYNAMIC_EVALUATION", "a command substitution runs a command the policy refuses (" + decision.code + "): " + decision.detail,
        decision.next || literalRoute());
    }
  }
  for (const [index, segment] of commandSegments.entries()) {
    const decision = classifySegment(segment, policyContext);
    if (!decision.allowed) return decision;
    if (index === 0) {
      const words = commandModel.shellWords(segment);
      if (commandModel.commandStart(words) === 0) policyContext.cwd = leadingDirectory(words, policyContext.cwd) || policyContext.cwd;
    }
  }
  return { allowed: true, code: "FINITE_POLICY_ALLOW" };
}

function selfTest() {
  const projectRoot = path.resolve(__dirname, "..");
  const verifier = safeRegular(path.join(projectRoot, "checks", "mutation-boundary.mjs"))
    ? "checks/mutation-boundary.mjs --gate bypass"
    : "checks/run-all.mjs";
  // The relative form runs from the directory that holds vendor/ (beside a product tree
  // test-harness, that is its parent).
  const cliFile = expectedFiles(projectRoot, "vendor/unlazy/scripts/package-cli.mjs").find(safeRegular);
  const packageCli = cliFile
    ? ["a package-cli read passes", "node vendor/unlazy/scripts/package-cli.mjs doctor --all", true,
      path.resolve(path.dirname(cliFile), "..", "..", "..")]
    : ["the aggregate verifier passes", "node checks/run-all.mjs", true];
  const cases = [
    ["rg remains available", "rg -n package docs", true],
    ["Get-Content remains available", "Get-Content -Raw CLAUDE.md", true],
    ["declared gate verifier remains available", "node " + verifier, true],
    ["canonical Git tool remains available", "node harness-core/git/git-intent.mjs inspect --session s", true],
    ["redirection blocks", "echo value > src/a.txt", false],
    ["PowerShell content write blocks", "Set-Content src/a.txt value", false],
    ["inline Node blocks", "node -e \"require('fs').writeFileSync('src/a','x')\"", false],
    ["inline Python blocks", "python -c \"open('src/a','w').write('x')\"", false],
    ["arbitrary repository script blocks", "node scripts/write-anything.mjs", false],
    ["raw Git is deferred to its one owner", "cmd /c git reset --hard", true],
    ["a Git read passes", "git status", true],
    ["a version query passes", "codex --version", true],
    ["merging output streams passes", "ls 2>&1", true],
    ["discarding output passes", "cat x 2>/dev/null", true],
    ["a loop over a read passes", "for f in a b; do cat \"$f\"; done", true],
    ["awk that only prints passes", "awk '{print $1}' README.md", true],
    ["awk with system() blocks", "awk 'BEGIN{system(\"x\")}'", false],
    ["a substituted read passes", "echo $(date)", true],
    ["a substituted write blocks", "echo $(rm src/a.txt)", false],
    ["sed that writes a file blocks", "sed 's/a/b/w out.txt' README.md", false],
    ["gh api with a field blocks", "gh api repos/o/r -f a=b", false],
    ["node --test with an import blocks", "node --test --import ./x.mjs test/x.test.js", false],
    ["a formatter that writes blocks", "npx prettier --write .", false],
    ["install without --ignore-scripts blocks", "npm ci", false],
    packageCli,
  ];
  let failed = 0;
  for (const [name, command, allowed, cwd] of cases) {
    const decision = inspect(command, { projectRoot, cwd: cwd || projectRoot, sessionId: "self", active: true });
    const ok = decision.allowed === allowed;
    if (!ok) failed += 1;
    process.stdout.write((ok ? "ok  " : "FAIL") + " " + name + "\n");
  }
  process.stdout.write(String(cases.length - failed) + "/" + String(cases.length) + " passed\n");
  return failed;
}

if (require.main === module && (process.argv.includes("--self-test") || process.argv.includes("--selbsttest"))) {
  process.exit(selfTest() ? 1 : 0);
}

// Every hook of a session is a sign of life of its planning binding (P4 D15); the touch never decides
// anything and never fails the hook.
function noteActivity(payload) {
  try { require("../harness-core/binding/hook-activity.cjs").noteHookInput(payload); } catch { /* a record, not a decision */ }
}

// The decision of one hook call (package P5, A1): null lets the command pass, a string is the denial text. The hook main
// program and the one guard process (.claude/pretool-guards.js) both use it; shared.gitFindings, when git-intent-guard
// judged the same command in the same process, saves the second Git judgement (A3).
function hookDecision(payload, shared = {}) {
  const command = payload?.tool_input?.command || "";
  let projectRoot;
  let dialect;
  let decision;
  try {
    projectRoot = hookContext.ruleRoot();
    // A resumed conversation gets its planning binding back before the command is judged (D15); never fails the hook.
    if (payload.transcript_path) {
      packageBootstrap.adoptByTranscript({ harnessRoot: projectRoot, sessionId: hookContext.hookSession(payload),
        transcriptPath: hookContext.msysPath(String(payload.transcript_path)) });
    }
    dialect = commandModel.dialectFor(payload);
    decision = inspect(command, {
      projectRoot,
      cwd: payload.cwd || projectRoot,
      sessionId: hookContext.hookSession(payload),
      transcriptPath: payload.transcript_path ? hookContext.msysPath(String(payload.transcript_path)) : "",
      dialect,
      gitFindings: shared.gitFindings,
    });
  } catch (error) {
    return "shell-mutation-guard: policy evaluation failed; command blocked: " + error.message;
  }
  if (decision.allowed) return null;
  // POLICY_INVALID is Owner action O3: the Owner repairs the policy, there is no command to
  // hand over. Every other block is agent work with an allowed route.
  const what = "Shell-Befehl ausserhalb der endlichen Befehlsliste (" + decision.code + ")";
  // The denial itself must not depend on the Owner template (guard-parity A9).
  let handoff;
  try {
    handoff = decision.code === "POLICY_INVALID"
      ? ownerHandoff.handoffText({ what, route: decision.next,
        ownerAction: "Der Owner repariert .claude/mutation-policy.json (nur er darf sie aendern)." })
      : ownerHandoff.handoffText({ what, route: decision.next, command, dialect, cwd: payload.cwd || projectRoot });
  } catch (error) {
    handoff = "(Owner-Vorlage nicht erzeugbar: " + error.message + ")";
  }
  return "shell-mutation-guard: blocked before execution: " + decision.code +
    "\n" + decision.detail + "\nNEXT: " + decision.next + "\n" + guardRoutes.referenceLine("shell-mutation-guard", decision.code) +
    "\n" + handoff;
}

if (require.main === module) {
  let input = "";
  process.stdin.on("data", (chunk) => { input += chunk; });
  process.stdin.on("end", () => {
    let payload;
    try { payload = JSON.parse(input || "{}"); }
    catch {
      return block("shell-mutation-guard: invalid hook input; command blocked");
    }
    noteActivity(payload); // sign of life of the planning session (D15), for every Bash and PowerShell call
    const denial = hookDecision(payload);
    return denial === null ? process.exit(0) : block(denial);
  });
}

module.exports = {
  CANONICAL_MUTATION_PATHS,
  GUARD_SELF_TESTS,
  LIBRARY_PATHS,
  MCP_TOOL_NAME,
  NODE_TEST_REPORTERS,
  NODE_TEST_SWITCHES,
  NODE_TEST_VALUES,
  PACKAGE_TOOL_COMMANDS,
  PACKAGE_TOOL_PATHS,
  READ_ONLY_COMMANDS,
  READ_ONLY_TOOL_COMMANDS,
  POLICY_FILE,
  TEST_FILE_NAME,
  loadMutationPolicy,
  SERVICE_PATHS,
  SERVICE_VOICE_FLAGS,
  VERIFIER_PATHS,
  classifyPackageTool,
  classifyWords,
  declaredPath,
  hookDecision,
  inspect,
  outputRedirection: commandModel.hasOutputRedirection,
  selfTest,
};
