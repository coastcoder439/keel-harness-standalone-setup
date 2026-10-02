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

const GUARD_TARGET = ".claude/shell-mutation-guard.js";

// Inline deny transport (identical in every PreToolUse guard; guard-parity E5): a missing
// sibling module must never turn a denial into an allow. Under the Codex hook runner a
// JSON deny with exit 0 survives Windows PowerShell, which maps a native exit 2 to 1.
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
// A partial or corrupted guard install (e.g. a deleted sibling guard) must block, not
// pass: dependency failures emit a protocol-specific denial (Codex exit-0 JSON,
// direct Claude exit 2), not a bare crash (audit follow-up 425, 09.09.2026). As an imported module
// the real error is surfaced so tests and callers never see a silently stubbed guard.
let gitGuard;
let commandModel;
let ownerHandoff;
let hookContext;
let ownedShellWrite;
let writeGuard;
let packageBootstrap;
let repository;
let paketGate;
try {
  gitGuard = require("./git-intent-guard.js");
  commandModel = require("../harness-core/guards/command-model.cjs");
  ownerHandoff = require("../harness-core/guards/owner-handoff.cjs");
  hookContext = require("../harness-core/guards/hook-context.cjs");
  ownedShellWrite = require("../harness-core/guards/owned-shell-write.cjs");
  writeGuard = require("./write-guard.js");
  packageBootstrap = require("../harness-core/binding/package-bootstrap.cjs");
  repository = require("../harness-core/binding/repository.cjs");
  paketGate = require("./paket-gate.js");
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
]);

const WRITE_COMMANDS = new Set([
  "add-content", "ac", "clear-content", "copy-item", "cp", "del", "erase", "install", "mkdir", "move-item",
  "mv", "new-item", "ni", "out-file", "remove-item", "rename-item", "ren", "rm", "rmdir", "rsync", "sc",
  "set-content", "tee", "touch", "truncate", "writealltext", "writefile", "writefilesync",
  // PowerShell aliases and item writers of the same kinds (guard-parity E3).
  "ri", "rd", "copy", "cpi", "move", "mi", "rni", "md", "clc", "tee-object", "set-item", "si", "clear-item",
  "cli", "new-itemproperty", "set-itemproperty", "sp", "remove-itemproperty", "rp", "rename-itemproperty",
  "rnp", "export-csv", "epcsv", "export-clixml", "expand-archive", "compress-archive",
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
  "format", "normalize", "getstring", "getbytes", "where", "foreach"]);
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
  "checks/reference-boundary.mjs",
  "checks/refresh-inventory.mjs",
  "checks/requirements-audit.mjs",
  "checks/run-all.mjs",
  "checks/test-matrix.mjs",
  "voice/check.mjs",
  "standalone/checks/dashboard-list.mjs",
  "standalone/checks/fresh-install.mjs",
  "standalone/checks/manifest-check.mjs",
  "standalone/checks/run-all.mjs",
  "vendor/unlazy/scripts/dispatch-check.mjs",
  "vendor/unlazy/scripts/gate-check.mjs",
  "vendor/unlazy/tests/full-suite.mjs",
]);

const TEST_PATHS = new Set([
  "test/mcp-write-guard.test.js",
  "test/voice-sidecar.test.js",
  "test/package-ownership.test.js",
  "test/architecture-maps-cost.test.js",
  "test/architecture-maps-delivery.test.js",
  "test/architecture-maps-isolation.test.js",
  "test/architecture-maps-job.test.js",
  "test/architecture-maps-prebuild.test.js",
  "test/architecture-maps-run.test.js",
  "test/bounded-runner-hardening.test.js",
  "test/bounded-runner.test.js",
  "test/claude-fanout-e2e.test.js",
  "test/codex-hooks.test.js",
  "test/codex-hook-enforcement.test.js",
  "test/codex-plugin-e2e.test.js",
  "test/codex-plugin-integration.test.js",
  "test/dashboard-runtime-archive.test.js",
  "test/distribution-lifecycle.test.js",
  "test/harness-self-update.test.js",
  "test/endgoal-e2e.test.js",
  "test/evidence-integrity.test.js",
  "test/external-boundary.test.js",
  "test/final-audits.test.js",
  "test/full-harness-contract.test.js",
  "test/git-intent-empty-repository.test.js",
  "test/git-intent-hardening.test.js",
  "test/git-intent.test.js",
  "test/governance-hardening.test.js",
  "test/guard-handoff.test.js",
  "test/guard-lifecycle.test.js",
  "test/guard-parity-codex.test.js",
  "test/guard-parity-workers.test.js",
  "test/guard-parity.test.js",
  "test/guard-single-source.test.js",
  "test/harness-self-write.test.js",
  "test/installed-run-all-counts.test.js",
  "test/inventory-refresh.test.js",
  "test/lifecycle-gate-evidence.test.js",
  "test/manual-gate-review.test.js",
  "test/no-google-identity.test.js",
  "test/owner-ok.test.js",
  "test/owned-shell-write.test.js",
  "test/command-model.test.js",
  "test/orchestrator-role.test.js",
  "test/owner-start.test.js",
  "test/package-amend.test.js",
  "test/package-resolve.test.js",
  "test/package-bootstrap.test.js",
  "test/package-execution-lifecycle.test.js",
  "test/package-execution.test.js",
  "test/package-runtime-audit.test.js",
  "test/package-standard-skill.test.js",
  "test/process-models.test.js",
  "test/project-work.test.js",
  "test/reference-boundary.test.js",
  "test/repository-binding.test.js",
  "test/session-roles-handoff.test.js",
  "test/shell-mutation-boundary.test.js",
  "test/standalone-build-transaction.test.js",
  "test/windows-launchers.test.js",
]);

// Bibliotheken unter checks/: keine Einstiegspunkte, deshalb nicht ausfuehrbar und nicht in
// VERIFIER_PATHS -- aber ausdruecklich benannt, damit der Pflegetest jeden Pfad unter checks/,
// standalone/checks/ und test/ entweder hier oder dort findet (Audit B8).
const LIBRARY_PATHS = new Set([
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
    mcpAllow: new Set(), productRoots: [] };
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

// Under an Owner product root every test file directly in the product's test/ folder runs
// (guard-parity E11). The product's declared list names its tests at release time; a test
// written since the last release has to run before it can be released, and work on the
// product needs no confirmation by the Owner's own decision. Outside product roots the finite
// list holds.
function productTest(raw, context) {
  if (!raw || typeof raw !== "string" || raw.includes("\0") || !raw.endsWith(".test.js")) return false;
  const candidate = path.resolve(context.cwd || context.projectRoot, raw);
  return productRootsFor(context).some((root) =>
    normalized(path.dirname(candidate)) === normalized(path.join(root, "test")) && safeRegular(candidate));
}

function denial(code, detail, next) {
  return { allowed: false, code, detail, next };
}

function editRoute() {
  return "Use Claude Write/Edit/NotebookEdit on one exact path inside the active leaf OWNS.";
}

function verifierRoute(projectRoot) {
  return "Run the declared verifier directly: node \"" + path.join(projectRoot, "checks", "run-all.mjs") + "\".";
}

function classifyNode(words, start, context) {
  const args = words.slice(start + 1);
  if (args.length === 1 && ["-v", "--version", "-h", "--help"].includes(args[0])) return { allowed: true, code: "NODE_INFORMATION" };
  if (!args.length || args.some((arg) => ["-e", "--eval", "-p", "--print", "--input-type"].includes(arg))) {
    return denial("INLINE_INTERPRETER", "inline Node execution is not statically decidable", editRoute());
  }
  if (args.some((arg) => /^--(?:require|import|loader|experimental-loader)(?:=|$)/u.test(arg) || arg === "-r")) {
    return denial("NODE_PRELOAD", "Node preload hooks can execute undeclared code", verifierRoute(context.projectRoot));
  }
  if (args[0] === "--check" || args[0] === "-c") {
    return args.length === 2 ? { allowed: true, code: "NODE_SYNTAX_CHECK" }
      : denial("NODE_CHECK_FORM", "node --check accepts one file in this boundary", "Run: node --check <file>.");
  }
  if (args[0] === "--test") {
    const tests = declarations(context, "test", TEST_PATHS);
    if (!tests) return policyDenial(context);
    if (args.length < 2 || args.slice(1).some((arg) => arg.startsWith("-") ||
        (!declared(arg, context, tests) && !productTest(arg, context)))) {
      return denial("UNDECLARED_TEST", "node --test may execute only the finite declared test files", verifierRoute(context.projectRoot));
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

function packageToolUnbound(detail, context) {
  return denial("PACKAGE_TOOL_UNBOUND", detail, paketGate.exactNextStep(context.projectRoot));
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
    if (!sessionId) return packageToolUnbound("a writing package tool call needs a package session", context);
    const sessions = optionValues(list, "--session");
    if (sessions.some((value) => value !== sessionId)) {
      return packageToolUnbound("--session names another session than the calling one", context);
    }
    let record = null;
    try { record = packageBootstrap.find({ harnessRoot: context.projectRoot, sessionId }); } catch { record = null; }
    if (record) {
      const roots = optionValues(list, "--root");
      if (!roots.length || roots.some((value) => !value ||
          !repository.samePath(path.resolve(context.cwd, hookContext.msysPath(value)), record.repoRoot))) {
        return packageToolUnbound("--root must name the repository bound to this session", context);
      }
      const ids = [...optionValues(list, "--package"), ...(command === "import" ? optionValues(list, "--into") : [])];
      if (ids.some((value) => !samePackageId(value, record.packageId))) {
        return packageToolUnbound("the package tool may write only the bundle bound to this session (" + record.packageId + ")", context);
      }
      return { allowed: true, code: "PACKAGE_TOOL_BOUND" };
    }
    if (command === "create" && sessions.length && sessions.every((value) => value === sessionId)) {
      return { allowed: true, code: "PACKAGE_TOOL_BOUND" };
    }
    return packageToolUnbound("this session has no package binding; only create with --session of this session opens one", context);
  } catch (error) {
    return denial("PACKAGE_TOOL_UNBOUND", "package tool check failed: " + String(error && error.message || error),
      "Run the package tool with --root and --package of the bundle bound to this session.");
  }
}

function classifyPowerShell(words, start, context) {
  const args = words.slice(start + 1);
  if (args.length === 1 && ["-v", "--version", "-version"].includes(args[0].toLowerCase())) return { allowed: true, code: "SHELL_INFORMATION" };
  const fileIndex = args.findIndex((arg) => /^-(?:file|f)$/iu.test(arg));
  if (fileIndex >= 0 && declared(args[fileIndex + 1], context, new Set(["checks/windows-smoke.ps1"]))) {
    return { allowed: true, code: "DECLARED_WINDOWS_VERIFIER" };
  }
  return denial("SHELL_WRAPPER", "PowerShell command/file wrappers can hide repository writes", editRoute());
}

function classifyCmd(words, start, context) {
  const args = words.slice(start + 1);
  const marker = args.findIndex((arg) => /^\/(?:c|k)$/iu.test(arg));
  if (marker >= 0 && args.length === marker + 2 &&
      declared(args[marker + 1], context, new Set(["checks/windows-smoke.cmd"]))) {
    return { allowed: true, code: "DECLARED_WINDOWS_VERIFIER" };
  }
  return denial("SHELL_WRAPPER", "cmd /c and /k can hide repository writes", editRoute());
}

// Deleting, moving and creating directories on literal paths inside the bound leaf OWNS
// (guard-scope E16: the same as Codex apply_patch). Returns null to keep DIRECT_SHELL_WRITE.
// Two checks beyond owned-shell-write.cjs: a command that changes directory anywhere gets no
// owned write (the module checks against cwd, the shell would delete in the new directory),
// and every path operand passes the write-guard rules W1, W4 and W5 as apply_patch does.
function ownedWrite(name, words, context) {
  const decision = ownedShellWrite.decideOwnedWrite({ name, words, staticArguments: context.staticArguments,
    dialect: context.dialect || "bash", cwd: context.cwd, projectRoot: context.projectRoot, sessionId: context.sessionId });
  if (!decision) return null;
  if (!decision.allowed) return denial("DIRECT_SHELL_WRITE", decision.detail, editRoute());
  if (context.changesDirectory) {
    return denial("DIRECT_SHELL_WRITE", "the command changes directory; owned shell writes are checked against the starting directory only", editRoute());
  }
  const deps = writeGuard.echteDeps(context.projectRoot);
  for (const word of words.slice(1)) {
    if (String(word).startsWith("-")) continue;
    const reason = writeGuard.pruefen({ file_path: path.resolve(context.cwd, hookContext.msysPath(String(word))), content: "" }, deps);
    if (reason) return denial("DIRECT_SHELL_WRITE", reason, editRoute());
  }
  return { allowed: true, code: "OWNED_SHELL_WRITE", paths: decision.paths };
}

const DIRECTORY_CHANGES = new Set(["cd", "chdir", "pushd", "popd", "set-location", "sl", "push-location", "pop-location"]);

// One invocation, as [name, ...arguments] from either shell (guard-parity E1). A Bash
// segment that starts with an assignment, &, (, env or command never reaches the name
// check: those are refused as environment overrides or second dispatch surfaces.
function classifyWords(words, context) {
  const first = String(words[0] || "");
  const firstName = path.basename(first).toLowerCase();
  if (/^[A-Za-z_][A-Za-z0-9_]*=/u.test(first)) {
    return denial("ENVIRONMENT_OVERRIDE", "per-command environment overrides can preload or replace executable code", "Run the canonical command without an environment prefix.");
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
  if (DYNAMIC_COMMANDS.has(name)) {
    return denial("DYNAMIC_WRAPPER", name + " can execute a second command outside static policy", editRoute());
  }
  // A version query of a bare program name reads only (guard-scope R2); a path or a script file
  // is code and stays with the branches below. There is no general `version` subcommand
  // (npm version writes package.json).
  if (args.length === 1 && args[0] === "--version" && !/[\\/]/u.test(raw) && !/\.(?:js|mjs|cjs|ps1|sh|bat|cmd|py)$/iu.test(raw)) {
    return { allowed: true, code: "VERSION_QUERY" };
  }
  if (["git", "git.exe"].includes(name)) {
    if (gitGuard.harmlessRead(gitGuard.gitFromWords(words))) return { allowed: true, code: "READ_ONLY_GIT" };
    return denial("UNCLASSIFIED_GIT", "Git must be owned by git-intent-guard", gitGuard.canonicalRoute("explain", context.projectRoot, context.sessionId, "unknown"));
  }
  if (["node", "node.exe"].includes(name)) return classifyNode(words, start, context);
  if (["python", "python.exe", "python3", "python3.exe", "ruby", "ruby.exe", "perl", "perl.exe", "deno", "deno.exe", "bun", "bun.exe"].includes(name)) {
    if (args.length === 1 && ["-v", "--version"].includes(args[0].toLowerCase())) return { allowed: true, code: "INTERPRETER_INFORMATION" };
    return denial("INTERPRETER_EXECUTION", name + " code and scripts are not in the finite executable policy", editRoute());
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
    return denial("SHELL_WRAPPER", name + " scripts and -c forms can hide repository writes", editRoute());
  }
  if (["npm", "npm.cmd", "npx", "npx.cmd", "pnpm", "pnpm.cmd", "yarn", "yarn.cmd"].includes(name)) {
    return denial("PACKAGE_SCRIPT_RUNNER", name + " is an indirect executable-script surface", verifierRoute(context.projectRoot));
  }
  if (WRITE_COMMANDS.has(name)) {
    const owned = ownedWrite(name, words, context);
    if (owned) return owned;
    return denial("DIRECT_SHELL_WRITE", name + " can mutate files without package/OWNS checks", editRoute());
  }
  if ((name === "sed" && args.some((arg) => /^-.*i/u.test(arg))) ||
      (name === "find" && args.some((arg) => ["-delete", "-exec", "-execdir", "-ok", "-okdir"].includes(arg)))) {
    return denial("DIRECT_SHELL_WRITE", name + " can mutate files without package/OWNS checks", editRoute());
  }
  const readEscalation =
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
  return denial("UNDECLARED_EXECUTABLE", name + " is not in the finite read/verifier/mutation policy", verifierRoute(context.projectRoot));
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
  const words = commandModel.tokens(segment);
  const kind = commandModel.bashSegmentKind(words);
  const start = commandModel.commandStart(words);
  const foreign = words.slice(0, start).findIndex((word) => !CONTROL_KEYWORDS.has(word));
  if (foreign >= 0) return classifyWords(withoutFreeRedirections(words.slice(foreign)), context);
  if (kind === "keyword-only" || kind === "loop-header") return { allowed: true, code: "SHELL_CONTROL" };
  return classifyWords(withoutFreeRedirections(kind), context);
}

function memberAllowed(member) {
  const name = member.member.toLowerCase();
  if (!member.static) return READ_ONLY_INSTANCE_MEMBERS.has(name);
  const members = READ_ONLY_STATIC_MEMBERS.get(member.type.toLowerCase());
  return Boolean(members && members.has(name));
}

// The PowerShell form of the same policy (guard-parity E3). PowerShell's parser sees every
// command a line runs -- in pipelines, script blocks, subexpressions and control flow -- so
// each is judged by classifyWords; what Bash can only refuse as undecidable ($(...)) is
// decided here command by command.
function inspectPowerShell(command, context) {
  const model = context.model || commandModel.parse(String(command || ""), "powershell");
  if (!model.ok) return denial("POWERSHELL_PARSE", model.error, "Write the command so PowerShell can parse it, or split it into simple commands.");
  const gitFindings = gitGuard.inspect(command, context.projectRoot, context.sessionId,
    { cwd: context.cwd, dialect: "powershell", model });
  if (gitFindings.length) return { allowed: true, code: "GIT_OWNED_BY_INTENT_GUARD", git: gitFindings[0] };
  // Merging streams (2>&1) and discarding into $null write no file; every other target does.
  if (model.redirections.some((redirection) => !/^\$null$/iu.test(String(redirection.target)))) {
    return denial("OUTPUT_REDIRECTION", "output redirection can write arbitrary paths before file guards run", editRoute());
  }
  if (model.envAssignments.length) {
    return denial("ENVIRONMENT_OVERRIDE", "per-command environment overrides can preload or replace executable code", "Run the canonical command without an environment prefix.");
  }
  const member = model.members.find((item) => !memberAllowed(item));
  if (member) {
    return denial("DYNAMIC_EVALUATION", ".NET call " + (member.text || member.member) + " is inline code outside the finite policy", editRoute());
  }
  policyFor(context);
  const changesDirectory = model.invocations.some((invocation) => DIRECTORY_CHANGES.has(String(invocation.name || "")));
  for (const invocation of model.invocations) {
    if (invocation.dynamicName) {
      return denial("DYNAMIC_WRAPPER", "a command whose name is computed at run time is a second command-dispatch surface", "Run the declared command directly without a wrapper.");
    }
    const decision = classifyWords(invocation.words, { ...context, dialect: "powershell",
      staticArguments: invocation.staticArguments, changesDirectory });
    if (!decision.allowed) return decision;
  }
  return { allowed: true, code: "FINITE_POLICY_ALLOW" };
}

function inspect(command, context = {}) {
  const projectRoot = path.resolve(context.projectRoot || process.cwd());
  const cwd = path.resolve(context.cwd || projectRoot);
  const sessionId = context.sessionId || "";
  const policyContext = { projectRoot, cwd, sessionId };
  if (context.dialect === "powershell") return inspectPowerShell(command, { ...policyContext, model: context.model });
  return inspectBash(command, policyContext);
}

// The Bash form of the policy. changesDirectory carries a directory change of an enclosing
// PowerShell line into a bash -c payload judged here.
function inspectBash(command, context) {
  const { projectRoot, cwd, sessionId } = context;
  const policyContext = { projectRoot, cwd, sessionId };
  // The finite executable policy holds whether or not a package is bound (audit H6):
  // rm/Set-Content/undeclared Node scripts/redirection stay blocked with no active
  // package. Mutating Git stays owned by git-intent-guard; harmless Git reads, read-only
  // inspection plus the declared Dashboard service (SERVICE_PATHS/DECLARED_SERVICE) remain
  // reachable.
  const gitFindings = gitGuard.inspect(command, projectRoot, sessionId, { cwd });
  if (gitFindings.length) return { allowed: true, code: "GIT_OWNED_BY_INTENT_GUARD", git: gitFindings[0] };
  if (commandModel.hasOutputRedirection(command)) {
    return denial("OUTPUT_REDIRECTION", "output redirection can write arbitrary paths before file guards run", editRoute());
  }
  if (commandModel.hasDynamicEvaluation(command)) {
    return denial("DYNAMIC_EVALUATION", "command substitution is an undeclared executable surface", editRoute());
  }

  const commandSegments = commandModel.segments(command);
  policyContext.dialect = "bash";
  policyContext.changesDirectory = Boolean(context.changesDirectory) || commandSegments.some((segment) => {
    const words = commandModel.tokens(segment);
    return DIRECTORY_CHANGES.has(commandModel.executableName(words[commandModel.commandStart(words)]));
  });
  for (const segment of commandSegments) {
    const decision = classifySegment(segment, policyContext);
    if (!decision.allowed) return decision;
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

if (require.main === module) {
  let input = "";
  process.stdin.on("data", (chunk) => { input += chunk; });
  process.stdin.on("end", () => {
    let payload;
    try { payload = JSON.parse(input || "{}"); }
    catch {
      return block("shell-mutation-guard: invalid hook input; command blocked");
    }
    const projectRoot = hookContext.ruleRoot();
    const command = payload?.tool_input?.command || "";
    const dialect = commandModel.dialectFor(payload);
    let decision;
    try {
      decision = inspect(command, {
        projectRoot,
        cwd: payload.cwd || projectRoot,
        sessionId: hookContext.hookSession(payload),
        dialect,
      });
    } catch (error) {
      return block("shell-mutation-guard: policy evaluation failed; command blocked: " + error.message);
    }
    if (decision.allowed) return process.exit(0);
    // POLICY_INVALID is Owner action O3: the Owner repairs the policy, there is no command to
    // hand over. Every other block is agent work with an allowed route.
    const what = "Shell-Befehl ausserhalb der endlichen Befehlsliste (" + decision.code + ")";
    const handoff = decision.code === "POLICY_INVALID"
      ? ownerHandoff.handoffText({ what, route: decision.next,
        ownerAction: "Der Owner repariert .claude/mutation-policy.json (nur er darf sie aendern)." })
      : ownerHandoff.handoffText({ what, route: decision.next, command, dialect, cwd: payload.cwd || projectRoot });
    block("shell-mutation-guard: blocked before execution: " + decision.code +
      "\n" + decision.detail + "\nNEXT: " + decision.next + "\n" + handoff);
  });
}

module.exports = {
  CANONICAL_MUTATION_PATHS,
  LIBRARY_PATHS,
  MCP_TOOL_NAME,
  PACKAGE_TOOL_PATHS,
  READ_ONLY_TOOL_COMMANDS,
  POLICY_FILE,
  loadMutationPolicy,
  SERVICE_PATHS,
  SERVICE_VOICE_FLAGS,
  TEST_PATHS,
  VERIFIER_PATHS,
  classifyPackageTool,
  classifyWords,
  declaredPath,
  inspect,
  outputRedirection: commandModel.hasOutputRedirection,
  selfTest,
};
