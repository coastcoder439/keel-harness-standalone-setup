#!/usr/bin/env node
"use strict";

// One semantic Git gate for Claude Code and Codex. Harmless Git reads (read-only
// subcommands, version, branch, tag-listing, remote and keel-proof-note read forms, git grep
// without a pager or external grep) pass with and without an active package, direct or
// wrapped. A read escalated by -c, --config-env, --exec-path, --output, --ext-diff,
// --textconv, --upload-pack, --exec, or grep -O / --ext-grep routes to inspect; every
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

let packageBinding;
let commandModel;
let ownerHandoff;
let guardRoutes;
let hookContext;
let runtimeScopes;
let sessionScope;
try {
  packageBinding = require("../harness-core/binding/package-binding.cjs");
  runtimeScopes = require("../harness-core/binding/runtime-scopes.cjs");
  commandModel = require("../harness-core/guards/command-model.cjs");
  ownerHandoff = require("../harness-core/guards/owner-handoff.cjs");
  guardRoutes = require("../harness-core/guards/guard-routes.cjs");
  hookContext = require("../harness-core/guards/hook-context.cjs");
  sessionScope = require("../harness-core/guards/session-scope.cjs");
} catch (error) {
  if (require.main === module) block("git-intent-guard: dependency load failed; command blocked: " + error.message);
  throw error;
}

const { commandStart, executableName, segments, tokens } = commandModel;

const READ_ONLY = new Set([
  "status", "diff", "log", "show", "rev-parse", "rev-list", "ls-files",
  "check-ignore", "describe", "name-rev", "cat-file", "for-each-ref",
  "diff-tree", "show-ref", "merge-base", "check-ref-format", "grep",
]);

// git tag is a read only as a listing. Creating, deleting, signing or forcing a tag is a write, and
// a positional argument is a tag NAME to create unless a flag puts git tag into list mode (measured:
// "git tag --sort=refname v1" creates v1, "git tag -n1 v1" and "git tag --contains HEAD v1" do not).
const TAG_LIST_TRIGGER = /^(?:-l|--list|-n\d*|--(?:contains|no-contains|points-at|merged|no-merged)(?:=.*)?)$/u;
const TAG_LIST_OPTION = /^(?:--sort=.*|--format=.*|--column(?:=.*)?|--no-column)$/u;
const REMOTE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const NOTES_OBJECT = /^[0-9A-Za-z][0-9A-Za-z._/~^-]{0,127}$/u;

function tagIsListing(args) {
  let triggered = false;
  let positional = 0;
  for (const raw of args) {
    const arg = String(raw);
    if (TAG_LIST_TRIGGER.test(arg)) triggered = true;
    else if (TAG_LIST_OPTION.test(arg)) continue;
    else if (arg.startsWith("-")) return false;
    else positional += 1;
  }
  return triggered || positional === 0;
}

// git remote is a read with no argument, with -v, as "show <name>" or as "get-url <name>". add,
// remove, rename, set-url, set-head, set-branches, prune and update stay closed. The name is a
// plain remote name, never a URL: a URL would make git talk to a transport of the caller's choice.
function remoteIsReading(args) {
  if (!args.length || args.every((arg) => ["-v", "--verbose"].includes(arg))) return true;
  const [verb, ...rest] = args;
  if (verb === "show") {
    const names = rest.filter((arg) => arg !== "-n");
    return names.length === 1 && REMOTE_NAME.test(names[0]);
  }
  if (verb === "get-url") {
    const names = rest.filter((arg) => !["--push", "--all"].includes(arg));
    return names.length === 1 && REMOTE_NAME.test(names[0]);
  }
  return false;
}

// Review notes of the Harness (ref keel-proof) may be read: git notes --ref keel-proof show|list [object].
function notesIsReading(args) {
  let ref;
  let rest;
  if (args[0] === "--ref") { ref = args[1]; rest = args.slice(2); }
  else if (/^--ref=/u.test(String(args[0] || ""))) { ref = String(args[0]).slice("--ref=".length); rest = args.slice(1); }
  else return false;
  if (!["keel-proof", "refs/notes/keel-proof"].includes(ref)) return false;
  const [verb, ...objects] = rest;
  return ["show", "list"].includes(verb) && objects.length <= 1 && objects.every((item) => NOTES_OBJECT.test(String(item)));
}

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
  if (command.subcommand === "remote") return remoteIsReading(command.args);
  if (command.subcommand === "tag") return tagIsListing(command.args);
  if (command.subcommand === "notes") return notesIsReading(command.args);
  if (command.subcommand === "clean") return command.args.some((arg) => arg === "-n" || arg === "--dry-run");
  return false;
}

// Options that run configured programs or write files turn a read into inspect.
function escalated(command) {
  const globals = Array.isArray(command.globals) ? command.globals : [];
  const args = Array.isArray(command.args) ? command.args : [];
  return globals.some((word) => /^(?:-c|--config-env|--exec-path)(?:=|$)/u.test(String(word))) ||
    args.some((word) => /^(?:--output|--upload-pack|--exec)(?:=|$)|^--(?:ext-diff|textconv)$/u.test(String(word))) ||
    (command.subcommand === "grep" && grepOpensProgram(args));
}

// git grep -O / --open-files-in-pager starts a pager on the matches, --ext-grep an external grep. Git
// accepts any unique prefix of a long option, so every prefix of those two names counts, and -O
// inside a short-option cluster (-nO, -inOless) counts as well. Only the arguments before "--" are
// options.
function grepOpensProgram(args) {
  for (const raw of args) {
    const arg = String(raw);
    if (arg === "--") return false;
    if (/^--[A-Za-z]/u.test(arg)) {
      const name = arg.slice(2).split("=")[0];
      if (name && ("open-files-in-pager".startsWith(name) || "ext-grep".startsWith(name))) return true;
    } else if (/^-[A-Za-z0-9]*O/u.test(arg)) return true;
  }
  return false;
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

// --- Git maintenance (Karte Arbeitsweise, 07.10.2026) -------------------------------------------------------------
// fetch, pull as fast-forward, switch and checkout of a branch, creating a branch with switch -c or checkout -b, and
// stash push/list/show/apply/pop change no product file: every session that is not bound to a work step runs them
// itself, directly in the Bash or PowerShell tool. pull, switch, checkout and stash push/apply/pop change the working
// tree and wait while a dispatch wave of the repository is open (WAVE_IN_PROGRESS), so no running worker loses
// anything. Everything else stays where it was: O2 (reset, history, stash drop/clear), force forms, clean, restore and
// checkout -- (discard-working), config, remote and hooks.
const MAINTENANCE_SUBCOMMANDS = new Set(["fetch", "pull", "switch", "checkout", "stash"]);
const MAINTENANCE_REF = /^(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/u;
const STASH_REF = /^(?:stash@\{[0-9]{1,4}\}|[0-9]{1,4})$/u;
const FETCH_SWITCHES = new Set(["--all", "--prune", "-p", "--tags", "--no-tags", "-q", "--quiet", "-v", "--verbose", "--unshallow"]);

function maintenanceKind(command) {
  if (!command || !MAINTENANCE_SUBCOMMANDS.has(command.subcommand)) return false;
  if (command.subcommand === "stash") return !["drop", "clear"].includes(String((command.args || [])[0] || ""));
  return true;
}

// The places a remote transfer names: one remote name (never a URL), then plain branch names (no refspec with : or +).
function transferProblem(positionals) {
  if (positionals.length && !REMOTE_NAME.test(positionals[0])) return "the remote must be a configured remote name, not a URL or path";
  if (positionals.slice(1).some((ref) => !MAINTENANCE_REF.test(ref))) return "only plain branch names follow the remote (no refspec with : or +)";
  return null;
}

// null when the form is one of the maintenance forms, otherwise why not. cwd: the directory the command runs in
// (checkout of a name that is a path would discard changes of that path).
function maintenanceProblem(command, cwd) {
  const args = (command.args || []).map(String);
  const globals = Array.isArray(command.globals) ? command.globals.map(String) : [];
  for (let index = 0; index < globals.length; index += 1) {
    if (globals[index] === "-C" && globals[index + 1] !== undefined) { index += 1; continue; }
    if (globals[index] === "--no-pager") continue;
    return "only git -C <repo> and --no-pager may stand before the subcommand";
  }
  if (args.includes("--")) return "a pathspec after -- is no maintenance form";
  const positionals = [];
  const flags = [];
  const takeValue = new Set(command.subcommand === "switch" ? ["-c", "--create"] : command.subcommand === "checkout" ? ["-b"]
    : command.subcommand === "stash" ? ["-m", "--message"] : []);
  let created = null;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (takeValue.has(arg)) {
      const value = args[index + 1];
      if (value === undefined) return arg + " needs a value";
      if (arg !== "-m" && arg !== "--message") {
        if (!MAINTENANCE_REF.test(value)) return "the new branch name " + JSON.stringify(value) + " is no plain branch name";
        created = value;
      }
      flags.push(arg);
      index += 1;
    } else if (/^-/u.test(arg) && arg !== "-") flags.push(arg);
    else positionals.push(arg);
  }
  const unknown = (allowed) => flags.find((flag) => !allowed.has(flag) &&
    !(["fetch", "pull"].includes(command.subcommand) && /^--depth=[0-9]{1,6}$/u.test(flag)) &&
    !(command.subcommand === "stash" && /^--message=./u.test(flag)));
  if (command.subcommand === "fetch") {
    const flag = unknown(FETCH_SWITCHES);
    return flag ? "git fetch takes only " + [...FETCH_SWITCHES].join(" ") + " and --depth=<n>, not " + flag : transferProblem(positionals);
  }
  if (command.subcommand === "pull") {
    if (!flags.includes("--ff-only")) return "git pull runs only as a fast-forward: git pull --ff-only";
    const flag = unknown(new Set([...FETCH_SWITCHES, "--ff-only"]));
    return flag ? "git pull --ff-only takes no " + flag + " (no rebase, no merge, no force)" : transferProblem(positionals);
  }
  if (command.subcommand === "switch" || command.subcommand === "checkout") {
    const flag = unknown(new Set([...takeValue, "-t", "--track", "--no-track", "-q", "--quiet", "--guess", "--no-guess"]));
    if (flag) return "git " + command.subcommand + " takes no " + flag + " (no force, no merge, no detach, no orphan, no patch)";
    if (created ? positionals.length > 1 : positionals.length !== 1) {
      return created ? "at most one start point follows the new branch" : "git " + command.subcommand + " names exactly one branch";
    }
    if (positionals.some((name) => name !== "-" && !MAINTENANCE_REF.test(name))) return "only plain branch names (no path, no pattern)";
    if (command.subcommand === "checkout") {
      const base = path.resolve(cwd || process.cwd(), ...gitDirectoryArgument(globals));
      const named = positionals.find((name) => name !== "-" && fs.existsSync(path.resolve(base, name)));
      if (named) return "\"" + named + "\" is a path in the working tree; checkout of a path discards changes (discard-working), switch to a branch with git switch";
    }
    return null;
  }
  // stash
  const verb = positionals.length && ["push", "list", "show", "apply", "pop"].includes(positionals[0]) ? positionals.shift() : (args.length ? null : "push");
  if (verb === null) return "git stash runs as push, list, show, apply or pop";
  if (verb === "push") {
    const flag = unknown(new Set(["-m", "--message", "-u", "--include-untracked", "-q", "--quiet", "-k", "--keep-index"]));
    if (flag) return "git stash push takes no " + flag + " (--all would stash the ignored runtime)";
    return positionals.length ? "git stash push takes no pathspec" : null;
  }
  if (verb === "list") return flags.length || positionals.length ? "git stash list takes no options" : null;
  const flag = unknown(verb === "show" ? new Set(["-p", "--patch", "--stat", "--name-only"]) : new Set(["--index", "-q", "--quiet"]));
  if (flag) return "git stash " + verb + " takes no " + flag;
  return positionals.length > 1 || positionals.some((ref) => !STASH_REF.test(ref)) ? "git stash " + verb + " names at most one stash (stash@{n})" : null;
}

function gitDirectoryArgument(globals) {
  const parts = [];
  for (let index = 0; index < globals.length; index += 1) if (globals[index] === "-C" && globals[index + 1] !== undefined) parts.push(hookContext.msysPath(String(globals[index + 1])));
  return parts;
}

// Whether the form changes the working tree (and so waits for an open wave).
function maintenanceChangesTree(command) {
  if (["pull", "switch", "checkout"].includes(command.subcommand)) return true;
  if (command.subcommand !== "stash") return false;
  const verb = (command.args || []).map(String).find((arg) => !arg.startsWith("-"));
  return !["list", "show"].includes(verb || "push");
}

// The decision for one finding: { allowed: true } for a maintenance form of an unbound session outside an open wave,
// otherwise { allowed: false, code, detail }. context: projectRoot, sessionId, cwd, env, changesDirectory.
function maintenanceAllowed(finding, context = {}) {
  if (!finding || finding.intent !== "maintain") return { allowed: false, code: finding ? finding.intent : "explain", detail: "" };
  // Direct, or the one form Codex runs every Bash command in on Windows: a PowerShell line & bash.exe -c '<payload>'
  // (the shell guard judges that payload with the whole Bash policy).
  if (finding.wrapper !== "direct" && !(context.dialect === "powershell" && finding.wrapper === "bash")) {
    return { allowed: false, code: "maintain", detail: "Git maintenance runs directly in the Bash or PowerShell tool, not through " + finding.wrapper };
  }
  const problem = maintenanceProblem(finding, context.cwd);
  if (problem) return { allowed: false, code: "maintain", detail: problem };
  const bound = context.bound !== undefined ? context.bound : sessionScope.boundToStep({ harnessRoot: context.projectRoot,
    sessionId: context.sessionId, cwd: context.cwd, env: context.env || process.env });
  if (bound) {
    return { allowed: false, code: "maintain", detail: "this session is bound to a work step; Git maintenance is the work of the session that is not bound (a step saves through checkpoint)" };
  }
  if (!maintenanceChangesTree(finding)) return { allowed: true };
  if (context.changesDirectory) {
    return { allowed: false, code: "maintain", detail: "the command changes directory; name the repository with git -C <repo> instead of cd" };
  }
  const start = path.resolve(context.cwd || context.projectRoot || process.cwd(), ...gitDirectoryArgument(finding.globals || []));
  const found = gitDirectoryOf(start);
  const wave = sessionScope.openWave(found ? found.repoRoot : start);
  if (wave) {
    return { allowed: false, code: "WAVE_IN_PROGRESS", repoRoot: found ? found.repoRoot : start,
      detail: "git " + finding.subcommand + " changes the working tree while dispatch wave " + wave.waveId + " of scope " + wave.scope +
        " is " + wave.state + "; running workers would lose their files" };
  }
  // A leaf bound to another session (prepared by start --session or running) works on this working tree as well.
  const living = sessionScope.livingBinding(found ? found.repoRoot : start, { harnessRoot: context.projectRoot,
    exceptSession: context.sessionId });
  if (living) {
    return { allowed: false, code: "WAVE_IN_PROGRESS", repoRoot: found ? found.repoRoot : start,
      detail: "git " + finding.subcommand + " changes the working tree while session " + living.sessionId + " holds a living binding on " +
        living.leaf + " of scope " + living.scope + " (" + living.source + "); its step would lose or mix its files. Wait until the step " +
        "is returned and integrated, or end the prepared step (package-executor rebind/abort)" };
  }
  return { allowed: true };
}

const DIRECTORY_CHANGES = new Set(["cd", "chdir", "pushd", "popd", "set-location", "sl", "push-location", "pop-location"]);

// The context maintenanceAllowed needs for one command line: does the line change directory anywhere (then a relative
// repository is unknown)? model: the PowerShell model already parsed for this line.
function maintenanceContext(command, { projectRoot, sessionId, cwd, dialect, model, env = process.env } = {}) {
  let changesDirectory;
  if (dialect === "powershell") {
    changesDirectory = !model || !model.ok || model.invocations.some((invocation) => DIRECTORY_CHANGES.has(String(invocation.name || "").toLowerCase()));
  } else {
    changesDirectory = segments(String(command || "")).some((segment) => {
      const words = tokens(segment);
      return DIRECTORY_CHANGES.has(executableName(words[commandStart(words)] || ""));
    });
  }
  return { projectRoot, sessionId, cwd, env, changesDirectory, dialect };
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
  if (maintenanceKind(command)) return "maintain";
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
  if (intent === "plan-publish") {
    // The real way, in order (C8): a project the Owner listed in publishProjects needs no closed package
    // and no Owner-OK (plan-publish, then publish with the plan receipt); any other repository is published
    // by the package executor after its package is closed and the Owner said OK in the chat (it plans and
    // pushes in one call). The --session form of plan-publish is no agent route.
    const executor = path.join(projectRoot, "harness-core", "execution", "package-executor.mjs");
    return prefix + "plan-publish --root <exactGitRepo> (project listed in publishProjects of .claude/mutation-policy.json), then " +
      prefix + "publish --root <exactGitRepo> --receipt <planReceipt>" +
      " or, for a package closed with the Owner's OK: node " + shellQuote(executor) + " publish --harness-root " + shellQuote(projectRoot) +
      " --root <exactGitRepo> --package <packageId> --scope <scope> --closure-receipt <closureReceipt> --owner-ok <ownerWording>";
  }
  if (intent === "release-stale-lock") return prefix + "release-stale-lock --root <exactGitRepo>";
  if (intent === "maintain") {
    return "git fetch | git pull --ff-only | git switch <branch> | git switch -c <new> | git checkout <branch> | git checkout -b <new> | " +
      "git stash [push|list|show|apply|pop] directly in the Bash or PowerShell tool (git -C <repo> instead of cd), in the session that is " +
      "not bound to a work step; a bound step saves through " + prefix + "checkpoint --session " + session + " --message <message> --path <ownedPath>";
  }
  if (intent === "WAVE_IN_PROGRESS") {
    const executor = path.join(projectRoot, "harness-core", "execution", "package-executor.mjs");
    return "wait until the workers returned and the parent integrated the wave (node " + shellQuote(executor) +
      " status|return|integrate --root <exactGitRepo> --package <packageId>), then run the same Git command again";
  }
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

// A12: a Git command or an intent that fails on index.lock needs the one agent route for an orphaned
// lock. The guard cannot see that failure, but it can see the lock: when the repository of the working
// directory holds an index.lock, every Git denial names the route (release-stale-lock removes only an
// empty lock older than five minutes in an own repository). File system reads only, no Git process.
function gitDirectoryOf(startDir) {
  let dir = path.resolve(startDir);
  for (;;) {
    const marker = path.join(dir, ".git");
    try {
      const info = fs.lstatSync(marker);
      if (info.isDirectory()) return { repoRoot: dir, gitDir: marker };
      if (info.isFile()) {
        const match = /^gitdir:\s*(.+)$/mu.exec(fs.readFileSync(marker, "utf8"));
        return match ? { repoRoot: dir, gitDir: path.resolve(dir, match[1].trim()) } : null;
      }
    } catch { /* no .git here */ }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function staleLockLines(projectRoot, cwd) {
  const found = gitDirectoryOf(cwd || projectRoot);
  if (!found) return [];
  let info;
  try { info = fs.lstatSync(path.join(found.gitDir, "index.lock")); } catch { return []; }
  const intent = path.join(projectRoot, "harness-core", "git", "git-intent.mjs");
  return ["Sperre index.lock im Repo " + found.repoRoot + " (" + info.size + " Byte, " + Math.max(0, Math.round((Date.now() - info.mtimeMs) / 1000)) +
    " s alt); ist sie verwaist (0 Byte, älter als 5 Minuten, eigenes Repo), entfernt sie: node " + shellQuote(intent) +
    " release-stale-lock --root " + shellQuote(found.repoRoot)];
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
    if (!options.model) options.model = model;
    parsed = model.ok ? powershellGitCommands(model, 0, options) : [];
  } else {
    parsed = segments(String(command || "")).flatMap((segment) => wrappedGitCommands(segment, 0, options));
  }
  const findings = [];
  for (const item of parsed) {
    if (harmlessRead(item)) continue;
    const escalatedRead = escalated(item) && (isReadOnly(item) || ["--version", "version"].includes(item.subcommand));
    const intent = escalatedRead ? "inspect" : semanticIntent({ ...item, cwd: options.cwd });
    findings.push({
      subcommand: item.subcommand || "unknown",
      args: item.args,
      globals: item.globals || [],
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
    ["git grep passes", "git grep -n needle -- src", false, "", true],
    ["git grep -O opens a pager and routes to inspect", "git grep -O needle", true, " inspect ", true],
    ["git tag lists", "git tag -l \"v*\"", false, "", true],
    ["git tag v1 creates a tag", "git tag v1", true, "explain", true],
    ["git remote -v lists", "git remote -v", false, "", true],
    ["git remote add is a write", "git remote add x y", true, "explain", true],
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

// Every hook of a session is a sign of life of its planning binding (P4 D15); the touch never decides
// anything and never fails the hook.
function noteActivity(payload) {
  try { require("../harness-core/binding/hook-activity.cjs").noteHookInput(payload); } catch { /* a record, not a decision */ }
}

// The decision of one hook call (package P5, A1/A3): null lets the command pass, a string is the denial text. The hook
// main program and the one guard process (.claude/pretool-guards.js) both use it. shared (optional) is the scratch of one
// call that the guards of the same process hand on: the Git findings land there, so shell-mutation-guard does not judge
// Git a second time (A3).
function hookDecision(payload, shared = {}) {
  const command = payload?.tool_input?.command || "";
  let projectRoot;
  let dialect;
  let found;
  try {
    projectRoot = hookContext.ruleRoot();
    dialect = commandModel.dialectFor(payload);
    const options = { cwd: payload.cwd, dialect };
    found = inspect(command, projectRoot, hookContext.hookSession(payload), options);
    shared.gitFindings = { command, projectRoot, sessionId: hookContext.hookSession(payload), dialect, found };
    // Git maintenance of a session that is not bound to a work step passes (Karte Arbeitsweise 07.10.2026).
    const context = maintenanceContext(command, { projectRoot, sessionId: hookContext.hookSession(payload),
      cwd: payload.cwd || projectRoot, dialect, model: options.model });
    found = found.map((item) => ({ ...item, maintenance: maintenanceAllowed(item, context) }))
      .filter((item) => !item.maintenance.allowed);
  } catch (error) {
    return "git-intent-guard: policy evaluation failed; command blocked: " + error.message;
  }
  if (!found.length) return null;
  const first = found[0];
  const code = first.maintenance.code === "WAVE_IN_PROGRESS" ? "WAVE_IN_PROGRESS" : first.intent;
  if (first.intent === "maintain") first.next = canonicalRoute(code, projectRoot, hookContext.hookSession(payload), first.subcommand);
  const why = first.maintenance.detail ? first.maintenance.detail + "\n" : "";
  // The denial itself must not depend on the orphan hint or the Owner template: what cannot be
  // built is left out and named, the Git block stands (guard-parity A9).
  let orphans = "";
  let template;
  try { orphans = orphanLines(projectRoot, payload.cwd).map((line) => line + "\n").join(""); }
  catch (error) { orphans = "(orphan hint not available: " + error.message + ")\n"; }
  try { orphans += staleLockLines(projectRoot, payload.cwd).map((line) => line + "\n").join(""); }
  catch (error) { orphans += "(lock hint not available: " + error.message + ")\n"; }
  try {
    template = ownerHandoff.handoffText({ what: "roher Git-Befehl git " + first.subcommand + " ausserhalb der Harness-Git-Wege",
      route: first.next, command, dialect, cwd: payload.cwd || projectRoot, ownerOnly: ownerOnlyGit(first) });
  } catch (error) {
    template = "\n(Owner-Vorlage nicht erzeugbar: " + error.message + ")";
  }
  return "git-intent-guard: raw direct or wrapped Git blocked before execution: " +
    first.wrapper + " -> git " + first.subcommand + (first.intent === "maintain" ? " (" + code + ")" : "") + "\n" + why +
    "NEXT: " + first.next + "\n" + guardRoutes.referenceLine("git-intent-guard", code) +
    "\n" + orphans + template;
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
    noteActivity(payload); // sign of life of the planning session (D15), before anything is judged
    const denial = hookDecision(payload);
    return denial === null ? process.exit(0) : block(denial);
  });
}

module.exports = {
  READ_ONLY,
  activePackage,
  hookDecision,
  canonicalRoute,
  gitCommand,
  gitFromWords,
  staleLockLines,
  harmlessRead,
  inspect,
  isReadOnly,
  maintenanceAllowed,
  maintenanceContext,
  maintenanceProblem,
  ownerOnlyGit,
  powershellGitCommands,
  segments,
  semanticIntent,
  tokens,
  wrappedGitCommands,
};
