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
// Keep the transport local: a missing output-adapter dependency must not turn
// a denial into an exit-1 hook error that Codex would ignore on Windows.
function block(message) {
  const reason = String(message).trim() || "shell-mutation-guard: tool denied";
  if (process.env.KEEL_HARNESS_ROOT && process.env.KEEL_HOOK_TARGET === ".claude/shell-mutation-guard.js") {
    fs.writeSync(1, JSON.stringify({ hookSpecificOutput: {
      hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason,
    } }) + "\n");
    process.exit(0); // PowerShell maps native exit 2 to 1; valid JSON survives.
  }
  fs.writeSync(2, reason + "\n");
  process.exit(2); // Preserve the direct Claude hook contract.
}
// A partial or corrupted guard install (e.g. a deleted sibling guard) must block, not
// pass: dependency failures emit a protocol-specific denial (Codex exit-0 JSON,
// direct Claude exit 2), not a bare crash (audit follow-up 425, 09.09.2026). As an imported module
// the real error is surfaced so tests and callers never see a silently stubbed guard.
let gitGuard;
try {
  gitGuard = require("./git-intent-guard.js");
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
]);

const WRITE_COMMANDS = new Set([
  "add-content", "ac", "clear-content", "copy-item", "cp", "del", "erase", "install", "mkdir", "move-item",
  "mv", "new-item", "ni", "out-file", "remove-item", "rename-item", "ren", "rm", "rmdir", "rsync", "sc",
  "set-content", "tee", "touch", "truncate", "writealltext", "writefile", "writefilesync",
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
  "test/guard-lifecycle.test.js",
  "test/installed-run-all-counts.test.js",
  "test/inventory-refresh.test.js",
  "test/lifecycle-gate-evidence.test.js",
  "test/no-google-identity.test.js",
  "test/owner-ok.test.js",
  "test/package-bootstrap.test.js",
  "test/package-execution-lifecycle.test.js",
  "test/package-execution.test.js",
  "test/package-runtime-audit.test.js",
  "test/package-standard-skill.test.js",
  "test/process-models.test.js",
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

const CANONICAL_MUTATION_PATHS = new Set([
  "harness-core/execution/package-bootstrap.mjs",
  "harness-core/execution/package-executor.mjs",
  "harness-core/git/git-intent.mjs",
  "scripts/build-standalone.mjs",
]);

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
  return { file, present: false, error: null, verifier: new Set(), test: new Set(), service: new Set(), mutation: new Set(), mcpAllow: new Set() };
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

function expectedFiles(projectRoot, relative) {
  const values = [path.join(projectRoot, ...relative.split("/"))];
  if (path.basename(projectRoot).toLowerCase() === "test-harness" && relative.startsWith("vendor/unlazy/")) {
    values.push(path.join(path.dirname(projectRoot), ...relative.split("/")));
  }
  return values;
}

function declaredPath(raw, cwd, projectRoot, declarations) {
  if (!raw || typeof raw !== "string" || raw.includes("\0")) return null;
  const candidates = path.isAbsolute(raw)
    ? [path.resolve(raw)]
    : [path.resolve(cwd || projectRoot, raw), path.resolve(projectRoot, raw)];
  for (const relative of declarations) {
    for (const expected of expectedFiles(projectRoot, relative)) {
      if (candidates.some((candidate) => normalized(candidate) === normalized(expected)) && safeRegular(expected)) return relative;
    }
  }
  return null;
}

function commandStart(words) {
  let index = 0;
  while (index < words.length) {
    const word = words[index];
    if (/^[A-Za-z_][A-Za-z0-9_]*=/u.test(word) || word === "&" || word === "(") { index += 1; continue; }
    const name = path.basename(word).toLowerCase();
    if (name === "env") {
      index += 1;
      while (index < words.length && (/^-\w/u.test(words[index]) || /^[A-Za-z_][A-Za-z0-9_]*=/u.test(words[index]))) index += 1;
      continue;
    }
    if (name === "command") { index += 1; continue; }
    break;
  }
  return index;
}

function outputRedirection(command) {
  let quote = null;
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (quote) {
      if (char === quote && command[index - 1] !== "\\") quote = null;
      continue;
    }
    if (char === "\"" || char === "'") { quote = char; continue; }
    if (char === ">") return true;
  }
  return false;
}

function dynamicEvaluation(command) {
  let quote = null;
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (quote === "'") {
      if (char === "'" && command[index - 1] !== "\\") quote = null;
      continue;
    }
    if (quote === "\"") {
      if (char === "\"" && command[index - 1] !== "\\") quote = null;
      else if (char === "$" && command[index + 1] === "(") return true;
      else if (char === "`") return true;
      continue;
    }
    if (char === "\"" || char === "'") { quote = char; continue; }
    if ((char === "$" && command[index + 1] === "(") || char === "`") return true;
  }
  return false;
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
    if (args.length < 2 || args.slice(1).some((arg) => arg.startsWith("-") || !declaredPath(arg, context.cwd, context.projectRoot, tests))) {
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
  const verifier = declaredPath(script, context.cwd, context.projectRoot, verifiers);
  if (verifier) return { allowed: true, code: "DECLARED_VERIFIER", path: verifier };
  const service = declaredPath(script, context.cwd, context.projectRoot, declarations(context, "service", SERVICE_PATHS));
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
  const mutation = declaredPath(script, context.cwd, context.projectRoot, declarations(context, "mutation", CANONICAL_MUTATION_PATHS));
  if (mutation) return { allowed: true, code: "CANONICAL_MUTATION_TOOL", path: mutation };
  const guard = declaredPath(script, context.cwd, context.projectRoot, GUARD_SELF_TESTS);
  if (guard && args.slice(scriptIndex + 1).length === 1 && ["--self-test", "--selbsttest"].includes(args[scriptIndex + 1])) {
    return { allowed: true, code: "GUARD_SELF_TEST", path: guard };
  }
  return denial("UNDECLARED_NODE_SCRIPT", "repository Node scripts execute with write capability unless explicitly reviewed", verifierRoute(context.projectRoot));
}

function classifyPowerShell(words, start, context) {
  const args = words.slice(start + 1);
  if (args.length === 1 && ["-v", "--version", "-version"].includes(args[0].toLowerCase())) return { allowed: true, code: "SHELL_INFORMATION" };
  const fileIndex = args.findIndex((arg) => /^-(?:file|f)$/iu.test(arg));
  if (fileIndex >= 0 && declaredPath(args[fileIndex + 1], context.cwd, context.projectRoot, new Set(["checks/windows-smoke.ps1"]))) {
    return { allowed: true, code: "DECLARED_WINDOWS_VERIFIER" };
  }
  return denial("SHELL_WRAPPER", "PowerShell command/file wrappers can hide repository writes", editRoute());
}

function classifyCmd(words, start, context) {
  const args = words.slice(start + 1);
  const marker = args.findIndex((arg) => /^\/(?:c|k)$/iu.test(arg));
  if (marker >= 0 && args.length === marker + 2 &&
      declaredPath(args[marker + 1], context.cwd, context.projectRoot, new Set(["checks/windows-smoke.cmd"]))) {
    return { allowed: true, code: "DECLARED_WINDOWS_VERIFIER" };
  }
  return denial("SHELL_WRAPPER", "cmd /c and /k can hide repository writes", editRoute());
}

function classifySegment(segment, context) {
  const words = gitGuard.tokens(segment);
  const first = String(words[0] || "");
  const firstName = path.basename(first).toLowerCase();
  if (/^[A-Za-z_][A-Za-z0-9_]*=/u.test(first)) {
    return denial("ENVIRONMENT_OVERRIDE", "per-command environment overrides can preload or replace executable code", "Run the canonical command without an environment prefix.");
  }
  if (["&", "("].includes(first) || ["env", "command"].includes(firstName)) {
    return denial("DYNAMIC_WRAPPER", (firstName || first) + " is a second command-dispatch surface", "Run the declared command directly without a wrapper.");
  }
  const start = commandStart(words);
  const raw = words[start] || "";
  const executable = path.basename(raw.replace(/^[(&]+|[)]$/gu, "")).toLowerCase();
  const name = executable.endsWith(".exe") ? executable.slice(0, -4) : executable;
  const args = words.slice(start + 1);
  if (!name || name.startsWith("#")) return { allowed: true, code: "EMPTY" };
  if (["sudo", "eval", "invoke-expression", "iex", "xargs", "start-process"].includes(name)) {
    return denial("DYNAMIC_WRAPPER", name + " can execute a second command outside static policy", editRoute());
  }
  if (["git", "git.exe"].includes(name)) {
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
    return denial("SHELL_WRAPPER", name + " scripts and -c forms can hide repository writes", editRoute());
  }
  if (["npm", "npm.cmd", "npx", "npx.cmd", "pnpm", "pnpm.cmd", "yarn", "yarn.cmd"].includes(name)) {
    return denial("PACKAGE_SCRIPT_RUNNER", name + " is an indirect executable-script surface", verifierRoute(context.projectRoot));
  }
  if (WRITE_COMMANDS.has(name) || (name === "sed" && args.some((arg) => /^-.*i/u.test(arg))) ||
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
  const directVerifier = declaredPath(raw, context.cwd, context.projectRoot, directVerifiers);
  if (directVerifier) return { allowed: true, code: "DECLARED_VERIFIER", path: directVerifier };
  return denial("UNDECLARED_EXECUTABLE", name + " is not in the finite read/verifier/mutation policy", verifierRoute(context.projectRoot));
}

function inspect(command, context = {}) {
  const projectRoot = path.resolve(context.projectRoot || process.cwd());
  const cwd = path.resolve(context.cwd || projectRoot);
  const sessionId = context.sessionId || "";
  // The finite executable policy holds whether or not a package is bound (audit H6):
  // rm/Set-Content/undeclared Node scripts/redirection stay blocked with no active
  // package. Git stays owned by git-intent-guard, and read-only inspection plus the
  // declared Dashboard service (SERVICE_PATHS/DECLARED_SERVICE) remain reachable.
  const gitFindings = gitGuard.inspect(command, projectRoot, sessionId, { active: true, cwd });
  if (gitFindings.length) return { allowed: true, code: "GIT_OWNED_BY_INTENT_GUARD", git: gitFindings[0] };
  if (outputRedirection(String(command || ""))) {
    return denial("OUTPUT_REDIRECTION", "output redirection can write arbitrary paths before file guards run", editRoute());
  }
  if (dynamicEvaluation(String(command || ""))) {
    return denial("DYNAMIC_EVALUATION", "command substitution is an undeclared executable surface", editRoute());
  }

  for (const segment of gitGuard.segments(String(command || ""))) {
    const decision = classifySegment(segment, { projectRoot, cwd, sessionId });
    if (!decision.allowed) return decision;
  }
  return { allowed: true, code: "FINITE_POLICY_ALLOW" };
}

function selfTest() {
  const projectRoot = path.resolve(__dirname, "..");
  const verifier = safeRegular(path.join(projectRoot, "checks", "mutation-boundary.mjs"))
    ? "checks/mutation-boundary.mjs --gate bypass"
    : "checks/run-all.mjs";
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
  ];
  let failed = 0;
  for (const [name, command, allowed] of cases) {
    const decision = inspect(command, { projectRoot, cwd: projectRoot, sessionId: "self", active: true });
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
    const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();
    let decision;
    try {
      decision = inspect(payload?.tool_input?.command || "", {
        projectRoot,
        cwd: payload.cwd || projectRoot,
        sessionId: payload.session_id,
      });
    } catch (error) {
      return block("shell-mutation-guard: policy evaluation failed; command blocked: " + error.message);
    }
    if (decision.allowed) return process.exit(0);
    block("shell-mutation-guard: blocked before execution: " + decision.code +
      "\n" + decision.detail + "\nNEXT: " + decision.next + "\n");
  });
}

module.exports = {
  CANONICAL_MUTATION_PATHS,
  LIBRARY_PATHS,
  POLICY_FILE,
  loadMutationPolicy,
  SERVICE_PATHS,
  SERVICE_VOICE_FLAGS,
  TEST_PATHS,
  VERIFIER_PATHS,
  declaredPath,
  inspect,
  outputRedirection,
  selfTest,
};
