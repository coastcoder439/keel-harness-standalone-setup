#!/usr/bin/env node
"use strict";

// One semantic Git gate for Claude Code and Codex. Harmless Git reads (read-only
// subcommands, version, branch and remote read forms) pass with and without an active
// package, direct or wrapped. A read escalated by -c, --config-env, --exec-path,
// --output, --ext-diff, --textconv, --upload-pack or --exec routes to inspect; every
// other raw Git command, including nested shell/interpreter wrappers, is redirected to
// one finite Harness intent. Runtime remnants without bundle, repository root or living
// holder (harness-core/binding/runtime-scopes.cjs) are orphaned, never an active
// package; a denial names them with the cleanup route. This is a PreToolUse boundary,
// not an OS sandbox. The same rules hold for Bash and PowerShell commands (package
// guard-parity): commands are split by harness-core/guards/command-model.cjs.

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const GUARD_TARGET = ".claude/git-intent-guard.js";

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

let packageBinding;
let commandModel;
let ownerHandoff;
let hookContext;
let runtimeScopes;
try {
  packageBinding = require("../harness-core/binding/package-binding.cjs");
  runtimeScopes = require("../harness-core/binding/runtime-scopes.cjs");
  commandModel = require("../harness-core/guards/command-model.cjs");
  ownerHandoff = require("../harness-core/guards/owner-handoff.cjs");
  hookContext = require("../harness-core/guards/hook-context.cjs");
} catch (error) {
  if (require.main === module) block("git-intent-guard: dependency load failed; command blocked: " + error.message);
  throw error;
}

const { commandStart, executableName, segments, tokens } = commandModel;

const READ_ONLY = new Set([
  "status", "diff", "log", "show", "rev-parse", "rev-list", "ls-files",
  "check-ignore", "describe", "name-rev", "cat-file", "for-each-ref",
  "diff-tree", "show-ref", "merge-base", "check-ref-format",
]);

// Program names that run a string argument as a command (PowerShell and Bash forms).
const DYNAMIC_RUNNERS = new Set(["invoke-expression", "iex", "start-process", "saps", "start", "invoke-command", "icm",
  "start-job", "sajb", "eval", "xargs"]);

// Global options before the subcommand are kept in globals; harmlessRead decides
// which of them escalate a read.
function gitFromWords(words) {
  let index = commandStart(words);
  if (!["git", "git.exe"].includes(executableName(words[index]))) return null;
  index += 1;
  const globals = [];
  while (index < words.length) {
    const word = words[index];
    if (["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path", "--config-env"].includes(word)) {
      globals.push(...words.slice(index, index + 2));
      index += 2;
      continue;
    }
    if (/^--(?:git-dir|work-tree|namespace|exec-path|config-env)=/u.test(word) ||
        /^--(?:no-pager|no-optional-locks|literal-pathspecs|glob-pathspecs|noglob-pathspecs)$/u.test(word)) {
      globals.push(word);
      index += 1;
      continue;
    }
    break;
  }
  return {
    subcommand: String(words[index] || "").toLowerCase(),
    args: words.slice(index + 1),
    globals,
    wrapper: "direct",
  };
}

function gitCommand(segment) {
  return gitFromWords(tokens(segment));
}

function normalizedEmbeddedCode(value) {
  return String(value || "")
    .replace(/\\(["'`])/gu, "$1")
    .replace(/["'`]\s*,\s*["'`]/gu, " ")
    .replace(/[()[\]{},]/gu, " ")
    .replace(/["'`]/gu, " ")
    .replace(/\s+/gu, " ");
}

function embeddedGitCommands(value, wrapper) {
  const normalized = normalizedEmbeddedCode(value);
  const found = [];
  const pattern = /(?:^|[\s;&|=])(?:[A-Za-z]:[\\/][^\s"']*[\\/])?git(?:\.exe)?\s+([A-Za-z][A-Za-z0-9-]*)([^;&|]*)/giu;
  for (const match of normalized.matchAll(pattern)) {
    found.push({
      subcommand: String(match[1] || "").toLowerCase(),
      args: tokens(String(match[2] || "")),
      globals: [],
      wrapper,
    });
  }
  return found;
}

function dynamicPayloads(segment) {
  const payloads = [];
  for (const match of segment.matchAll(/\$\(([^()]*)\)/gu)) payloads.push({ value: match[1], wrapper: "command-substitution", dialect: "bash" });
  for (const match of segment.matchAll(/`([^`]*)`/gu)) payloads.push({ value: match[1], wrapper: "backtick-substitution", dialect: "bash" });
  return payloads;
}

function prefixed(wrapper, found) {
  return found.map((item) => ({ ...item, wrapper: wrapper + (item.wrapper === "direct" ? "" : " -> " + item.wrapper) }));
}

// Git inside a nested payload: PowerShell payloads are parsed as PowerShell, everything
// else as Bash segments; a payload nothing can split (inline interpreter code) is scanned.
function payloadGitCommands(payload, depth, options) {
  if (payload.dialect === "powershell") {
    const model = commandModel.parse(payload.value, "powershell", options);
    const nested = model.ok ? powershellGitCommands(model, depth + 1, options) : [];
    return nested.length ? prefixed(payload.wrapper, nested) : embeddedGitCommands(payload.value, payload.wrapper);
  }
  const nested = segments(payload.value).flatMap((part) => wrappedGitCommands(part, depth + 1, options));
  return nested.length ? prefixed(payload.wrapper, nested) : embeddedGitCommands(payload.value, payload.wrapper);
}

function wrappedGitCommands(segment, depth = 0, options = {}) {
  if (depth > 6) return [];
  const direct = gitCommand(segment);
  if (direct) return [direct];
  const payloads = [...commandModel.wrapperPayloadsFromWords(tokens(segment)), ...dynamicPayloads(segment)];
  return payloads.flatMap((payload) => payloadGitCommands(payload, depth, options));
}

function powershellGitCommands(model, depth = 0, options = {}) {
  if (depth > 6) return [];
  const found = [];
  for (const invocation of model.invocations) {
    const direct = gitFromWords(invocation.words);
    if (direct) { found.push(direct); continue; }
    for (const payload of commandModel.wrapperPayloadsFromWords(invocation.words)) {
      found.push(...payloadGitCommands(payload, depth, options));
    }
    if (DYNAMIC_RUNNERS.has(String(invocation.name || ""))) {
      for (const word of invocation.words.slice(1)) found.push(...embeddedGitCommands(word, "powershell-" + invocation.name));
    }
  }
  return found;
}

function isReadOnly(command) {
  if (READ_ONLY.has(command.subcommand)) return true;
  if (command.subcommand === "branch") {
    return command.args.length === 0 || command.args.every((arg) =>
      ["--show-current", "--list", "-l", "-a", "-r", "-v", "-vv", "--contains", "--merged", "--no-merged"].includes(arg));
  }
  if (command.subcommand === "remote") {
    return command.args[0] === "get-url" || command.args.every((arg) => ["-v", "--verbose"].includes(arg));
  }
  if (command.subcommand === "clean") return command.args.some((arg) => arg === "-n" || arg === "--dry-run");
  return false;
}

// Options that run configured programs or write files turn a read into inspect.
function escalated(command) {
  const globals = Array.isArray(command.globals) ? command.globals : [];
  const args = Array.isArray(command.args) ? command.args : [];
  return globals.some((word) => /^(?:-c|--config-env|--exec-path)(?:=|$)/u.test(String(word))) ||
    args.some((word) => /^(?:--output|--upload-pack|--exec)(?:=|$)|^--(?:ext-diff|textconv)$/u.test(String(word)));
}

// Harmless: a read-only Git command without escalation; clean -n stays with inspect.
function harmlessRead(command) {
  if (!command || escalated(command)) return false;
  if (["--version", "version"].includes(command.subcommand)) return true;
  if (command.subcommand === "clean") return false;
  return isReadOnly(command);
}

// Owner actions: broad history rewrites and unrecoverable deletions.
const OWNER_ONLY_SUBCOMMANDS = new Set(["reset", "filter-branch", "filter-repo", "reflog", "gc", "prune", "update-ref", "replace"]);

function ownerOnlyGit(finding) {
  if (!finding || finding.intent !== "explain") return false;
  const args = Array.isArray(finding.args) ? finding.args : [];
  if (OWNER_ONLY_SUBCOMMANDS.has(finding.subcommand)) return true;
  if (finding.subcommand === "branch") return args.some((arg) => ["-D", "-d", "--delete"].includes(arg));
  if (finding.subcommand === "tag") return args.some((arg) => ["-d", "--delete"].includes(arg));
  if (finding.subcommand === "stash") return ["drop", "clear"].includes(args[0]);
  return false;
}

function semanticIntent(command) {
  if (isReadOnly(command)) return "inspect";
  if (["add", "commit"].includes(command.subcommand)) return "checkpoint";
  if (command.subcommand === "restore" && command.args.includes("--staged") && !command.args.includes("--worktree")) return "unstage";
  if (command.subcommand === "reset" && !command.args.some((arg) => ["--hard", "--keep", "--merge", "--soft"].includes(arg))) {
    return "unstage";
  }
  if (command.subcommand === "restore" || command.subcommand === "clean" ||
      (command.subcommand === "checkout" && command.args.includes("--"))) return "discard-working";
  if (command.subcommand === "revert") return "revert-checkpoint";
  if (["merge", "rebase", "cherry-pick"].includes(command.subcommand)) return "integration-checkpoint";
  if (command.subcommand === "push") return "plan-publish";
  return "explain";
}

function shellQuote(value) {
  const text = String(value);
  return /[\s"']/u.test(text) ? "\"" + text.replaceAll("\"", "\\\"") + "\"" : text;
}

function canonicalRoute(intent, projectRoot, sessionId, operation = "unknown") {
  const executable = path.join(projectRoot, "harness-core", "git", "git-intent.mjs");
  const prefix = "node " + shellQuote(executable) + " ";
  const session = sessionId ? shellQuote(sessionId) : "<sessionId>";
  if (intent === "inspect") return prefix + "inspect --session " + session + " [--path <ownedPath>]";
  if (intent === "checkpoint") {
    return prefix + "checkpoint --session " + session + " --message <message> --path <ownedPath>" +
      " or, for a written package not yet started: " +
      prefix + "checkpoint --root <exactGitRepo> --package <packageId> --message <message>";
  }
  if (intent === "unstage") return prefix + "unstage --session " + session + " --path <ownedPath>";
  if (intent === "discard-working") return prefix + "discard-working --session " + session + " --path <exactOwnedFile>";
  if (intent === "revert-checkpoint") return prefix + "revert-checkpoint --session " + session + " --receipt <checkpointReceipt>";
  if (intent === "integration-checkpoint") {
    return prefix + "integration-checkpoint --root <exactGitRepo> --package <packageId> --scope <scope> --message <message>";
  }
  if (intent === "plan-publish") return prefix + "plan-publish --root <exactGitRepo> --session " + session;
  return prefix + "explain --operation " + String(operation || "unknown").replace(/[^a-z0-9-]/giu, "").slice(0, 40);
}

// Only scopes runtime-scopes.cjs classifies as active count; remnants without bundle,
// repository root or living holder are orphaned.
function hasPackageRef(root) {
  if (!root) return false;
  return runtimeScopes.classifyRuntime(path.resolve(root)).scopes.some((record) => record.state === "active");
}

function orphanedRemnants(root) {
  if (!root) return [];
  try {
    return runtimeScopes.classifyRuntime(path.resolve(root)).scopes.filter((record) => record.state === "orphaned");
  } catch { return []; }
}

function orphanLines(projectRoot, cwd) {
  const executor = path.join(projectRoot, "harness-core", "execution", "package-executor.mjs");
  const seen = new Set();
  const lines = [];
  for (const root of [cwd, projectRoot].filter(Boolean)) {
    const resolved = path.resolve(root);
    const key = process.platform === "win32" ? resolved.toLowerCase() : resolved;
    if (seen.has(key)) continue;
    seen.add(key);
    const orphaned = orphanedRemnants(resolved);
    if (!orphaned.length) continue;
    lines.push("Verwaiste Laufzeit-Reste: " +
      orphaned.map((record) => record.scope + " (" + record.reasons.join(", ") + ")").join(", ") +
      "; aufräumen: node " + shellQuote(executor) + " cleanup-runtime --root " + shellQuote(resolved) + " --apply");
  }
  return lines;
}

function indexedPackageRef(projectRoot, sessionId) {
  if (!projectRoot || !sessionId) return false;
  const session = String(sessionId);
  if (!session || session.length > 256 || /[\0\r\n]/u.test(session)) return false;
  const name = crypto.createHash("sha256").update(session).digest("hex") + ".json";
  const file = path.join(path.resolve(projectRoot), ".unlazy", ".session-index", name);
  try {
    const info = fs.lstatSync(file);
    if (info.isSymbolicLink() || !info.isFile() || (typeof info.nlink === "number" && info.nlink !== 1)) return false;
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!value || value.schemaVersion !== 1 || value.sessionId !== session || typeof value.repoRelative !== "string") return false;
    const root = path.resolve(projectRoot);
    const repoRoot = path.resolve(root, value.repoRelative);
    const relative = path.relative(root, repoRoot);
    if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) return false;
    return hasPackageRef(repoRoot);
  } catch { return false; }
}

function activePackage(projectRoot, sessionId, cwd) {
  if (sessionId) {
    for (const start of [cwd, projectRoot].filter(Boolean)) {
      try {
        packageBinding.findSessionBinding(start, String(sessionId), { controlRoot: projectRoot });
        return true;
      } catch { /* fall back to durable package.ref detection */ }
    }
    if (indexedPackageRef(projectRoot, sessionId)) return true;
  }
  return [cwd, projectRoot].filter(Boolean).some(hasPackageRef);
}

// options.dialect: "bash" (default) or "powershell"; options.model: a PowerShell model the
// caller already parsed (shell-mutation-guard shares one parse per command).
// options.active is still accepted but no longer changes the result.
function inspect(command, projectRoot, sessionId, options = {}) {
  let parsed = [];
  if (options.dialect === "powershell") {
    const model = options.model || commandModel.parse(String(command || ""), "powershell", options);
    parsed = model.ok ? powershellGitCommands(model, 0, options) : [];
  } else {
    parsed = segments(String(command || "")).flatMap((segment) => wrappedGitCommands(segment, 0, options));
  }
  const findings = [];
  for (const item of parsed) {
    if (harmlessRead(item)) continue;
    const escalatedRead = escalated(item) && (isReadOnly(item) || ["--version", "version"].includes(item.subcommand));
    const intent = escalatedRead ? "inspect" : semanticIntent(item);
    findings.push({
      subcommand: item.subcommand || "unknown",
      args: item.args,
      wrapper: item.wrapper,
      intent,
      next: canonicalRoute(intent, projectRoot, sessionId, item.subcommand),
    });
  }
  return findings;
}

function selfTest() {
  const root = "C:\\reference";
  const cases = [
    ["inspection outside a package passes", "git status --short", false, "", false],
    ["active inspection passes", "git status --short", false, "", true],
    ["git --version passes", "git --version", false, "", true],
    ["git -c core.pager=cat log routes to inspect", "git -c core.pager=cat log", true, " inspect ", true],
    ["commit uses checkpoint", "git commit -m x -- src/a.js", true, "checkpoint", false],
    ["cmd wrapped commit uses checkpoint", "cmd /c git commit -m x -- src/a.js", true, "checkpoint", false],
    ["PowerShell wrapped restore uses safe undo", "powershell -Command \"git restore -- src/a.js\"", true, "discard-working", false],
    ["bash wrapped push uses publish plan", "bash -lc 'git push origin main'", true, "plan-publish", false],
    ["Node child_process Git is caught", "node -e \"require('node:child_process').execFileSync('git',['reset','--hard'])\"", true, "explain", false],
    ["restore staged uses unstage", "git restore --staged -- src/a.js", true, "unstage", false],
    ["working restore has one recoverable route", "git restore -- src/a.js", true, "discard-working", false],
    ["checkpoint revert needs its receipt", "git revert HEAD", true, "revert-checkpoint", false],
    ["integration alternative uses integration checkpoint", "git merge feature", true, "integration-checkpoint", false],
    ["quoted prose is not Git", "echo \"git reset --hard\"", false, "", true],
  ];
  let failed = 0;
  for (const [name, command, blocked, marker, active] of cases) {
    const found = inspect(command, root, "session", { active });
    const ok = (found.length > 0) === blocked && (!marker || found[0].next.includes(marker));
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
      return block("git-intent-guard: invalid hook input; command blocked");
    }
    const projectRoot = hookContext.ruleRoot();
    const command = payload?.tool_input?.command || "";
    const dialect = commandModel.dialectFor(payload);
    let found;
    try { found = inspect(command, projectRoot, hookContext.hookSession(payload), { cwd: payload.cwd, dialect }); }
    catch (error) {
      return block("git-intent-guard: policy evaluation failed; command blocked: " + error.message);
    }
    if (!found.length) return process.exit(0);
    const first = found[0];
    const orphans = orphanLines(projectRoot, payload.cwd);
    block("git-intent-guard: raw direct or wrapped Git blocked before execution: " +
      first.wrapper + " -> git " + first.subcommand + "\nNEXT: " + first.next + "\n" +
      orphans.map((line) => line + "\n").join("") +
      ownerHandoff.handoffText({ what: "roher Git-Befehl git " + first.subcommand + " ausserhalb der Harness-Git-Wege",
        route: first.next, command, dialect, cwd: payload.cwd || projectRoot, ownerOnly: ownerOnlyGit(first) }));
  });
}

module.exports = {
  activePackage,
  canonicalRoute,
  gitCommand,
  gitFromWords,
  harmlessRead,
  inspect,
  isReadOnly,
  ownerOnlyGit,
  powershellGitCommands,
  segments,
  semanticIntent,
  tokens,
  wrappedGitCommands,
};
