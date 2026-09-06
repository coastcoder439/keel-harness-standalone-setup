#!/usr/bin/env node
"use strict";

// One semantic Git gate for Claude Code. During an active package every raw
// Git command, including read-only inspection and nested shell/interpreter
// wrappers, is redirected to one finite Harness intent. Outside a package,
// direct or wrapped mutations remain blocked while ordinary inspection stays
// available. This is a PreToolUse boundary, not an OS sandbox.

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const packageBinding = require("../harness-core/binding/package-binding.cjs");

const READ_ONLY = new Set([
  "status", "diff", "log", "show", "rev-parse", "rev-list", "ls-files",
  "check-ignore", "describe", "name-rev", "cat-file", "for-each-ref",
  "diff-tree", "show-ref", "merge-base", "check-ref-format",
]);

function segments(command) {
  const output = [];
  let current = "";
  let quote = null;
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (quote) {
      current += char;
      if (char === quote && command[index - 1] !== "\\") quote = null;
      continue;
    }
    if (char === "\"" || char === "'") { quote = char; current += char; continue; }
    if (char === "\n" || char === ";" || char === "|") {
      if (current.trim()) output.push(current.trim());
      current = "";
      if (char === "|" && command[index + 1] === "|") index += 1;
      continue;
    }
    if (char === "&" && command[index + 1] === "&") {
      if (current.trim()) output.push(current.trim());
      current = "";
      index += 1;
      continue;
    }
    current += char;
  }
  if (current.trim()) output.push(current.trim());
  return output;
}

function tokens(segment) {
  const result = [];
  const pattern = /"((?:\\.|[^"])*)"|'((?:\\.|[^'])*)'|([^\s]+)/gu;
  for (const match of segment.matchAll(pattern)) result.push(match[1] ?? match[2] ?? match[3]);
  return result;
}

function executableName(value) {
  return path.basename(String(value || "").replace(/^[(&]+|[)]$/gu, "")).toLowerCase();
}

function commandStart(words) {
  let index = 0;
  while (index < words.length) {
    const word = words[index];
    if (/^[A-Za-z_][A-Za-z0-9_]*=/u.test(word) || word === "&" || word === "(") {
      index += 1;
      continue;
    }
    const name = executableName(word);
    if (name === "env") {
      index += 1;
      while (index < words.length && (/^-\w/u.test(words[index]) || /^[A-Za-z_][A-Za-z0-9_]*=/u.test(words[index]))) {
        index += 1;
      }
      continue;
    }
    if (["command", "exec", "nohup", "time", "nice", "sudo"].includes(name)) {
      index += 1;
      while (index < words.length && /^-/u.test(words[index])) index += 1;
      continue;
    }
    break;
  }
  return index;
}

function gitCommand(segment) {
  const words = tokens(segment);
  let index = commandStart(words);
  if (!["git", "git.exe"].includes(executableName(words[index]))) return null;
  index += 1;
  while (index < words.length) {
    const word = words[index];
    if (["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path"].includes(word)) {
      index += 2;
      continue;
    }
    if (/^--(?:git-dir|work-tree|namespace|exec-path)=/u.test(word) ||
        /^--(?:no-pager|no-optional-locks|literal-pathspecs|glob-pathspecs|noglob-pathspecs)$/u.test(word)) {
      index += 1;
      continue;
    }
    break;
  }
  return {
    subcommand: String(words[index] || "").toLowerCase(),
    args: words.slice(index + 1),
    wrapper: "direct",
  };
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
      wrapper,
    });
  }
  return found;
}

function dynamicPayloads(segment) {
  const payloads = [];
  for (const match of segment.matchAll(/\$\(([^()]*)\)/gu)) payloads.push({ value: match[1], wrapper: "command-substitution" });
  for (const match of segment.matchAll(/`([^`]*)`/gu)) payloads.push({ value: match[1], wrapper: "backtick-substitution" });
  return payloads;
}

function wrapperPayloads(segment) {
  const words = tokens(segment);
  const start = commandStart(words);
  const name = executableName(words[start]);
  const rest = words.slice(start + 1);
  const payloads = [];

  if (["cmd", "cmd.exe"].includes(name)) {
    const marker = rest.findIndex((word) => /^\/(?:c|k)$/iu.test(word));
    if (marker >= 0 && rest[marker + 1]) payloads.push({ value: rest.slice(marker + 1).join(" "), wrapper: "cmd" });
  } else if (["powershell", "powershell.exe", "pwsh", "pwsh.exe"].includes(name)) {
    const marker = rest.findIndex((word) => /^-(?:c|command)$/iu.test(word));
    if (marker >= 0 && rest[marker + 1]) payloads.push({ value: rest.slice(marker + 1).join(" "), wrapper: "powershell" });
  } else if (["bash", "bash.exe", "sh", "zsh", "dash", "fish"].includes(name)) {
    const marker = rest.findIndex((word) => /^-[^-]*c[^-]*$/iu.test(word));
    if (marker >= 0 && rest[marker + 1]) {
      payloads.push({ value: rest.slice(marker + 1).join(" "), wrapper: name.replace(/\.exe$/u, "") });
    }
  } else if (["node", "node.exe", "deno", "deno.exe", "bun", "bun.exe", "python", "python.exe",
    "python3", "python3.exe", "ruby", "ruby.exe", "perl", "perl.exe"].includes(name)) {
    const marker = rest.findIndex((word) => /^(?:-[ceEp]|--eval|--print|--command)$/u.test(word));
    if (marker >= 0 && rest[marker + 1]) {
      payloads.push({ value: rest.slice(marker + 1).join(" "), wrapper: name.replace(/\.exe$/u, "") + "-inline" });
    }
  }
  return [...payloads, ...dynamicPayloads(segment)];
}

function wrappedGitCommands(segment, depth = 0) {
  if (depth > 6) return [];
  const direct = gitCommand(segment);
  if (direct) return [direct];
  const found = [];
  for (const payload of wrapperPayloads(segment)) {
    const nested = segments(payload.value).flatMap((part) => wrappedGitCommands(part, depth + 1));
    if (nested.length) {
      found.push(...nested.map((item) => ({ ...item,
        wrapper: payload.wrapper + (item.wrapper === "direct" ? "" : " -> " + item.wrapper) })));
    } else {
      found.push(...embeddedGitCommands(payload.value, payload.wrapper));
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
  if (intent === "checkpoint") return prefix + "checkpoint --session " + session + " --message <message> --path <ownedPath>";
  if (intent === "unstage") return prefix + "unstage --session " + session + " --path <ownedPath>";
  if (intent === "discard-working") return prefix + "discard-working --session " + session + " --path <exactOwnedFile>";
  if (intent === "revert-checkpoint") return prefix + "revert-checkpoint --session " + session + " --receipt <checkpointReceipt>";
  if (intent === "integration-checkpoint") {
    return prefix + "integration-checkpoint --root <exactGitRepo> --package <packageId> --scope <scope> --message <message>";
  }
  if (intent === "plan-publish") return prefix + "plan-publish --root <exactGitRepo> --session " + session;
  return prefix + "explain --operation " + String(operation || "unknown").replace(/[^a-z0-9-]/giu, "").slice(0, 40);
}

function hasPackageRef(root) {
  if (!root) return false;
  const runtime = path.join(path.resolve(root), ".unlazy");
  let entries;
  try { entries = fs.readdirSync(runtime, { withFileTypes: true }); }
  catch { return false; }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const ref = path.join(runtime, entry.name, "package.ref");
    try {
      const info = fs.lstatSync(ref);
      if (!info.isSymbolicLink() && info.isFile() && /^docs\/packages\/[A-Za-z0-9][A-Za-z0-9._-]{0,63}\r?\n$/u.test(fs.readFileSync(ref, "utf8"))) {
        return true;
      }
    } catch { /* another scope may still be active */ }
  }
  return false;
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

function inspect(command, projectRoot, sessionId, options = {}) {
  const active = options.active ?? activePackage(projectRoot, sessionId, options.cwd);
  const findings = [];
  for (const segment of segments(String(command || ""))) {
    for (const parsed of wrappedGitCommands(segment)) {
      if (!active && isReadOnly(parsed)) continue;
      const intent = semanticIntent(parsed);
      findings.push({
        subcommand: parsed.subcommand || "unknown",
        wrapper: parsed.wrapper,
        intent,
        next: canonicalRoute(intent, projectRoot, sessionId, parsed.subcommand),
      });
    }
  }
  return findings;
}

function selfTest() {
  const root = "C:\\reference";
  const cases = [
    ["inspection outside a package passes", "git status --short", false, "", false],
    ["active inspection uses inspect", "git status --short", true, " inspect ", true],
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
      process.stderr.write("git-intent-guard: invalid hook input; command blocked\n");
      return process.exit(2);
    }
    const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();
    let found;
    try { found = inspect(payload?.tool_input?.command || "", projectRoot, payload.session_id, { cwd: payload.cwd }); }
    catch (error) {
      process.stderr.write("git-intent-guard: policy evaluation failed; command blocked: " + error.message + "\n");
      return process.exit(2);
    }
    if (!found.length) return process.exit(0);
    const first = found[0];
    process.stderr.write("git-intent-guard: raw direct or wrapped Git blocked before execution: " +
      first.wrapper + " -> git " + first.subcommand + "\nNEXT: " + first.next + "\n");
    process.exit(2);
  });
}

module.exports = {
  activePackage,
  canonicalRoute,
  gitCommand,
  inspect,
  isReadOnly,
  segments,
  semanticIntent,
  tokens,
  wrappedGitCommands,
};
