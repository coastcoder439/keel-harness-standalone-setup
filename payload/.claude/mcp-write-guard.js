#!/usr/bin/env node
"use strict";

// PreToolUse mutation boundary for MCP tools (completeness audit 06.09.2026, B6).
//
// The finite mutation boundary covered Bash, Write/Edit and Codex apply_patch. Every other
// write-capable tool in the same host -- above all MCP servers (mail, calendar, drive, browser,
// session messaging) -- could mutate an external system during an active package without any
// guard seeing it. This hook closes that gap fail-closed: while a package is active, an MCP tool
// runs only when its name starts with a read-only verb and contains no write word anywhere, or
// when the Owner allowlisted the exact tool name in .claude/mutation-policy.json
// (mcpWriteTools.allow). The part after mcp__<server>__ is split into words at _, - and camelCase
// borders, case-insensitive: search_and_replace, get_or_create, list_and_delete and readAndUpdate
// are writes although they start with a read verb (WRITE_WORDS, a frozen list; guard-decisions E17, B39).
// A name part is also a write when it begins or ends with a LONG write word (replaceall, bulkdelete,
// overwrite); a SHORT write word counts only as a whole word, so settings, posts, runs and address stay
// reads. The read verb "query" stays in READ_ONLY_VERBS and is a known limit (guard-decisions E17).
// Unknown verbs are denied, not guessed.
// Outside an active package those tools run unchanged, exactly like shell-mutation-guard.
//
// The cut of the guard scope decides three groups in every state, package or not:
//   - the app's own tools that only operate or read (browser pane, terminal view, chapters,
//     tasks, views; APP_TOOLS) always pass, even with an invalid policy, so no session is stuck;
//   - a session never moves itself (Owner rule: never move the own session): EnterWorktree,
//     move_to_cloud and a directory change to any folder other than the rule root or its
//     marked ancestor are denied as SELF_MOVE; ExitWorktree and the return to the rule root pass;
//   - a terminal tool that runs commands executes them without any shell guard, so it is denied
//     as MCP_SHELL_SURFACE even when the Owner allowlisted it; Bash and PowerShell carry the guards.
//
// AUFRUF    PreToolUse, matcher: mcp__.* (Claude; EnterWorktree once the cut wires it) / ^mcp__ (Codex via hook-runner)
// RUECKGABE 0 = durch · 2 = blockiert (Claude) · 0 mit JSON-deny (Codex-Runner)

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const GUARD_TARGET = ".claude/mcp-write-guard.js";

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

// The Git and shell guards (with the package state they read: 2-4 Git calls, about 300 KB of code) load only for a
// decision that needs the package state (A8): the cut rules and the app's own tools -- every browser click -- are decided
// without them. A failure to load them still blocks (policy evaluation failed), never passes.
let gitGuard;
let shellGuard;
function stateGuards() {
  if (!shellGuard) {
    gitGuard = require("./git-intent-guard.js");
    shellGuard = require("./shell-mutation-guard.js");
  }
  return { gitGuard, shellGuard };
}
let hookContext;
let ownerHandoff;
let guardRoutes;
let repository;
try {
  hookContext = require("../harness-core/guards/hook-context.cjs");
  ownerHandoff = require("../harness-core/guards/owner-handoff.cjs");
  guardRoutes = require("../harness-core/guards/guard-routes.cjs");
  repository = require("../harness-core/binding/repository.cjs");
} catch (error) {
  if (require.main === module) block("mcp-write-guard: dependency load failed; tool blocked: " + error.message);
  throw error;
}

// Read-only verbs at the start of the tool name (after mcp__<server>__). The list is finite on
// purpose; a verb that is not here is treated as a write. It is matched against the words of the
// name joined with "_", so getIssue and get-issue lead with "get" like get_issue.
const READ_ONLY_VERBS = /^(?:get|list|search|read|find|fetch|query|status|describe|show|lookup|resolve|check|count|inspect|preview|tabs_context|screenshot)(?:_|$)/iu;
const MCP_NAME = /^mcp__([A-Za-z0-9-]+(?:_[A-Za-z0-9-]+)*)__(.+)$/u;

// Write words (A7): one of them anywhere in the name makes the tool a write, even when the name
// starts with a read verb. A name part is a write when it IS a write word, or when it begins or ends
// with a LONG write word, so compounds such as replaceall, bulkdelete and overwrite are writes too.
// A SHORT write word counts only as a whole word, so settings, posts, runs and address stay reads.
// The cut is by list, not by letter count: apply, patch and grant have five letters but are short
// (patches and grants read). Both lists are frozen on purpose; the Owner allowlist is the way out.
const WRITE_WORDS_LONG = Object.freeze(new Set([
  // change
  "append", "assign", "archive", "merge", "modify", "manage", "rename", "replace", "update", "insert", "import",
  "overwrite", "upsert", "truncate", "purge", "destroy",
  // create and delete
  "create", "delete", "remove", "trash", "write", "upload",
  // send and share
  "publish", "submit", "share", "invite", "transfer", "reply", "forward",
  // execute and control
  "execute", "start", "cancel", "restart", "pause", "resume",
  // install and release
  "install", "uninstall", "deploy", "approve", "accept", "reject", "revoke", "enable", "disable",
  // state
  "toggle", "clear", "reset", "restore", "commit",
]));
const WRITE_WORDS_SHORT = Object.freeze(new Set([
  "add", "apply", "set", "patch", "put", "edit", "move", "drop", "wipe", "fix",
  "send", "post", "push", "run", "stop", "kill", "buy", "pay", "grant", "mark", "sync", "save",
]));
const WRITE_WORDS = Object.freeze(new Set([...WRITE_WORDS_LONG, ...WRITE_WORDS_SHORT]));

// The words of a tool name: split at _, - and camelCase borders (also getHTMLPage -> get, html, page),
// lower-cased, empty parts dropped.
function toolWords(suffix) {
  return String(suffix || "")
    .replace(/([a-z0-9])([A-Z])/gu, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/gu, "$1_$2")
    .split(/[_-]+/u)
    .map((word) => word.toLowerCase())
    .filter(Boolean);
}

// The write word a single name part stands for: the part itself, or a long write word it begins or ends with.
function writeWordOf(word) {
  if (WRITE_WORDS.has(word)) return word;
  for (const long of WRITE_WORDS_LONG) {
    if (word.startsWith(long) || word.endsWith(long)) return long;
  }
  return null;
}

function writeWordIn(suffix) {
  for (const word of toolWords(suffix)) {
    const found = writeWordOf(word);
    if (found) return found;
  }
  return null;
}

// Read-only only with a read verb at the start and no write word anywhere in the name.
function isReadOnlyTool(suffix) {
  return READ_ONLY_VERBS.test(toolWords(suffix).join("_")) && writeWordIn(suffix) === null;
}

// The app's own tools that only operate or read; names measured 01.10.2026, case exact.
const APP_TOOLS = Object.freeze({
  exact: Object.freeze([
    "mcp__terminal__read_terminal",
    "mcp__terminal__list_terminal_tabs",
    "mcp__terminal__open_terminal_tab",
    "mcp__terminal__stop_terminal_tab",
    "mcp__ccd_session__mark_chapter",
    "mcp__ccd_session__spawn_task",
    "mcp__ccd_session__dismiss_task",
    "mcp__ccd_session__read_widget_context",
  ]),
  prefixes: Object.freeze(["mcp__Claude_Browser__", "mcp__ccd_view__", "mcp__visualize__"]),
});

// B13: the browser pane of the app is free for agents. Through a linked computer (mcp__remote-devices__Claude_Browser__*) the
// same pane can run scripts in a page, fill forms and click, so there only the preview start, a screenshot and the read
// tools pass (read tools by the ordinary read-verb rule: preview_list, preview_logs, read_page, get_page_text, find,
// tabs_context, read_console_messages, read_network_requests); everything else stays a write like any MCP tool.
const REMOTE_BROWSER_PREFIX = "mcp__remote-devices__Claude_Browser__";

function remoteBrowserAllowed(name, input) {
  const suffix = name.slice(REMOTE_BROWSER_PREFIX.length);
  if (suffix === "preview_start") return true;
  return suffix === "computer" && input && input.action === "screenshot";
}

const TERMINAL_PREFIX = "mcp__terminal__";
const CHANGE_DIRECTORY = "mcp__ccd_directory__change_directory";
const MOVE_TO_CLOUD = "mcp__ccd_session__move_to_cloud";
// A folder above the rule root that holds this marker is the installed Harness the rule root belongs to.
const HARNESS_MARKER = ".keel-harness.json";

function toolSuffix(name) {
  const match = String(name || "").match(MCP_NAME);
  return match ? match[2] : "";
}

function isAppTool(name) {
  return APP_TOOLS.exact.includes(name) || APP_TOOLS.prefixes.some((prefix) => name.startsWith(prefix));
}

function isTerminalRun(name) {
  return name.startsWith(TERMINAL_PREFIX) && name.slice(TERMINAL_PREFIX.length).startsWith("run");
}

// The folder a directory change goes to, resolved against the rule root; null when it has none.
function directoryTarget(input, ruleRoot) {
  const raw = String(input?.path ?? "").trim();
  if (!raw || !ruleRoot) return null;
  const expanded = raw.startsWith("~") ? os.homedir() + raw.slice(1) : raw;
  return path.resolve(ruleRoot, hookContext.msysPath(expanded));
}

// Only the rule root itself, or a marked Harness folder above it, is a return to the project.
function returnsToProject(input, ruleRoot) {
  const root = ruleRoot ? path.resolve(hookContext.msysPath(String(ruleRoot))) : "";
  const target = directoryTarget(input, root);
  if (!target) return false;
  if (repository.samePath(target, root)) return true;
  return repository.isPathInside(target, root) && fs.existsSync(path.join(target, HARNESS_MARKER));
}

// Local file tools (Pruefung 07.10.2026, Nachpruefung): an MCP server that reads and writes files of this computer is a
// second Write/Edit beside paket-gate and write-guard. A session not bound to a work step is judged by the measure of
// paket-gate: a target inside a Git repository needs a binding (or the planning, amend or orchestrator-fix right
// paket-gate grants); a target outside every repository stays free. Whether a package is active plays no part. A tool
// is a local file tool when
//   - its name is apply_patch, str_replace or multi_edit (the editor forms), or
//   - its server is a local file server (a server word filesystem, fs, editor, files) and the tool is no read, or
//   - its name carries a local write word (edit, replace, create, write, delete, move, rename, insert, apply; the long
//     ones also at the start or end of a name part, replaceall) and its input names a local path (path, file_path,
//     filePath, relative_path, pathInProject, source, destination, ...): desktop-commander edit_block, serena
//     create_text_file and replace_regex, jetbrains replace_text_in_file.
// Foreign services (Drive, Trello, mail) address their objects by id and name, not by a path, so they stay free.
const LOCAL_FILE_SERVER_WORDS = Object.freeze(new Set(["filesystem", "fs", "editor", "files"]));
const LOCAL_WRITE_WORDS = Object.freeze(new Set(["edit", "replace", "create", "write", "delete", "move", "rename", "insert", "apply"]));
const LOCAL_WRITE_WORDS_LONG = Object.freeze(["replace", "create", "write", "delete", "rename", "insert"]);
const LOCAL_EDIT_TOOLS = /^(?:apply_?patch|str_?replace(?:_?editor)?|multi_?edit)$/iu;
const PATH_KEYS = /^(?:path|paths|file|files|file_?path|file_?paths|filename|relative_?path|relative_?paths|path_?in_?project|source|destination|target|directory|dir|folder|old_?path|new_?path|from|to)$/iu;

function serverWords(name) {
  const match = String(name || "").match(MCP_NAME);
  return match ? toolWords(match[1]) : [];
}

function pathValues(value) {
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  return Array.isArray(value) ? value.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim()) : [];
}

// The local paths the input names, in input order.
function localPaths(input) {
  if (!input || typeof input !== "object") return [];
  return Object.entries(input).filter(([key]) => PATH_KEYS.test(key)).flatMap(([, value]) => pathValues(value));
}

function localWriteWord(suffix) {
  return toolWords(suffix).some((word) => LOCAL_WRITE_WORDS.has(word) ||
    LOCAL_WRITE_WORDS_LONG.some((long) => word.startsWith(long) || word.endsWith(long)));
}

function isLocalFileTool(name, input) {
  const suffix = toolSuffix(name);
  if (!suffix) return false;
  if (LOCAL_EDIT_TOOLS.test(suffix)) return true;
  if (isReadOnlyTool(suffix)) return false;
  if (serverWords(name).some((word) => LOCAL_FILE_SERVER_WORDS.has(word))) return true;
  return localWriteWord(suffix) && localPaths(input).length > 0;
}

// The targets of a local file tool, resolved against the folder of the call: the paths the input names or, when it names
// none (a patch text, a server that works in its own folder), that folder itself (the closed side).
function localTargets(input, cwd) {
  const base = path.resolve(hookContext.msysPath(String(cwd || ".")));
  const named = localPaths(input).filter((item) => !item.includes("\0"));
  // A file inside that folder: the repository test of paket-gate starts at the folder of its target.
  if (!named.length) return [path.join(base, "mcp-unnamed-target")];
  return named.map((item) => path.resolve(base, hookContext.msysPath(item.startsWith("~") ? os.homedir() + item.slice(1) : item)));
}

// paket-gate's measure for each target of the call: null when every target may be written, otherwise
// { code, detail, target } of the first refused one. A target outside every Git repository is free.
function repositoryWriteRefusal(payload, projectRoot, env = process.env) {
  const paketGate = require("./paket-gate.js");
  for (const target of localTargets(payload.tool_input, payload.cwd || projectRoot)) {
    if (!paketGate.insideRepository(target)) continue;
    const decision = paketGate.decide({ ...payload, tool_name: "Write", tool_input: { file_path: target } }, projectRoot, env);
    if (!decision.allowed) return { code: decision.code, detail: decision.detail || "", target };
  }
  return null;
}

function allow(code) {
  return { allowed: true, code };
}

function deny(code, detail, next) {
  return { allowed: false, code, detail, next };
}

function selfMove(ruleRoot) {
  return deny("SELF_MOVE",
    "a session does not move itself to another working folder or project (Owner-Regel: nie die eigene Sitzung verschieben)",
    "work for another repository goes to a worker through package-executor (start --root <REPO> ..., then dispatch); " +
      "read other folders by absolute path; a session in that folder is opened by the Owner in the app; returning to " +
      (ruleRoot ? String(ruleRoot) : "the rule root") + " and ExitWorktree stay allowed.");
}

// options: active (a live package binding), policy (loadMutationPolicy), input (tool_input),
// ruleRoot (hookContext.ruleRoot()). The cut rules come first and hold in every state.
// The rules that hold in every state, package or not (A8): their answer needs neither the package state nor the policy.
// null when the call needs them.
function decideWithoutState(toolName, options = {}) {
  const name = String(toolName || "");
  if (name === "EnterWorktree") return selfMove(options.ruleRoot);
  if (name === "ExitWorktree") return allow("RETURN_TO_PROJECT");
  if (name === CHANGE_DIRECTORY) {
    return returnsToProject(options.input, options.ruleRoot) ? allow("RETURN_TO_PROJECT") : selfMove(options.ruleRoot);
  }
  if (name === MOVE_TO_CLOUD) return selfMove(options.ruleRoot);
  if (isTerminalRun(name)) {
    return deny("MCP_SHELL_SURFACE",
      "MCP tool " + name + " fuehrt Befehle ohne Shell-Waechter aus (Gefahr G4 aus dem Zuschnitt): no git, shell or danger guard sees the command",
      "Bash- oder PowerShell-Werkzeug (dieselben Waechter)");
  }
  if (name.startsWith(REMOTE_BROWSER_PREFIX)) {
    if (remoteBrowserAllowed(name, options.input)) return allow("APP_TOOL");
    // The read verb is judged on the tool's own name, not on "Claude_Browser__..." (the server part of the name is a pane, not a verb).
    const own = name.slice(REMOTE_BROWSER_PREFIX.length);
    if (isReadOnlyTool(own) && options.policy && !options.policy.error) return allow("MCP_READ_ONLY");
  }
  if (isAppTool(name)) return allow("APP_TOOL");
  if (!name.startsWith("mcp__")) return allow("NOT_MCP");
  return null;
}

function decide(toolName, options = {}) {
  const stateless = decideWithoutState(toolName, options);
  if (stateless) return stateless;
  const name = String(toolName || "");
  const policy = options.policy || { error: "no policy loaded", mcpAllow: new Set() };
  // options.active: the session is bound to a work step (session-scope.cjs boundToStep); every other session uses
  // MCP freely, whatever package is active elsewhere in the repository -- except a local file tool whose target paket-gate
  // would refuse (options.repositoryWrite: null when free, { code, detail, target } when refused, or a function asked only
  // for such a tool; missing counts as refused). Whether a package is active plays no part for it (Nachpruefung
  // 07.10.2026); every other MCP tool stays free.
  if (!options.active) {
    if (!isLocalFileTool(name, options.input)) return allow("NO_ACTIVE_PACKAGE");
    if (!policy.error && policy.mcpAllow.has(name)) return allow("MCP_ALLOWLISTED");
    const refusal = typeof options.repositoryWrite === "function" ? options.repositoryWrite()
      : options.repositoryWrite === undefined ? { code: "TARGET_NOT_JUDGED", detail: "" } : options.repositoryWrite;
    if (!refusal) return allow("LOCAL_FILE_PERMITTED");
    return deny("MCP_LOCAL_FILE_UNBOUND",
      "MCP tool " + name + " changes local files inside a repository" + (refusal.target ? " (" + refusal.target + ")" : "") +
        " that paket-gate refuses for this session: " + refusal.code + (refusal.detail ? " (" + refusal.detail + ")" : "") +
        "; a session not bound to a work step changes no product file, with or without an active package, and an MCP file " +
        "server writes past paket-gate and write-guard",
      "Write/Edit (paket-gate judges the same target); a product file through a work step of a package (a small package or a " +
        "leaf: package-executor next|start, then dispatch); files outside every repository stay free.");
  }
  if (policy.error) {
    return deny("POLICY_INVALID", ".claude/mutation-policy.json is invalid: " + policy.error,
      "The Owner repairs the policy file; MCP tools stay blocked while a package is active; the app tools stay free.");
  }
  if (policy.mcpAllow.has(name)) return allow("MCP_ALLOWLISTED");
  const suffix = toolSuffix(name);
  if (suffix && isReadOnlyTool(suffix)) return allow("MCP_READ_ONLY");
  const writeWord = suffix ? writeWordIn(suffix) : null;
  return deny("MCP_WRITE_UNDECLARED",
    "MCP tool " + name + (writeWord
      ? " contains the write word \"" + writeWord + "\" and is not allowlisted"
      : " is not a read-only verb and not allowlisted") +
      ": it could mutate an external system outside the finite mutation boundary",
    "The Owner adds the exact tool name to .claude/mutation-policy.json (mcpWriteTools.allow), or the work takes the canonical repository route.");
}

// The Owner template (guard-parity E9). An MCP action has no shell form, so the command is
// the harness's own route for it: the Owner permits exactly this tool in his policy file,
// which holds for every later package too. A name the policy could not hold gets no command,
// because it would turn the whole policy invalid. The policy file is the Owner's alone, so its
// repair carries no command either. SELF_MOVE and MCP_SHELL_SURFACE name the agent's own way
// (ownerOnly: false); they never become a command for the Owner.
function ownerTemplate(toolName, projectRoot, code = "MCP_WRITE_UNDECLARED") {
  if (code === "SELF_MOVE") {
    return ownerHandoff.handoffText({ what: "Wechsel der eigenen Sitzung mit " + toolName, ownerOnly: false,
      ownerAction: "Eine Sitzung im Zielordner oeffnet der Owner selbst in der App; Arbeit fuer ein anderes Repository geht ueber einen Arbeitsagenten." });
  }
  if (code === "MCP_SHELL_SURFACE") {
    return ownerHandoff.handoffText({ what: "Befehl ueber " + toolName + " ohne Shell-Waechter", ownerOnly: false,
      ownerAction: "Keiner: der Agent nimmt das Bash- oder PowerShell-Werkzeug (dieselben Waechter)." });
  }
  if (code === "MCP_LOCAL_FILE_UNBOUND") {
    return ownerHandoff.handoffText({ what: "Lokale Dateiaenderung ueber " + toolName + " in einem Repository ohne Bindung", ownerOnly: false,
      ownerAction: "Keiner: der Agent schreibt mit Write/Edit oder bindet einen Arbeitsschritt des Pakets." });
  }
  if (code === "POLICY_INVALID") {
    return ownerHandoff.handoffText({ what: "MCP-Werkzeug " + toolName + " bei ungueltiger .claude/mutation-policy.json", ownerOnly: true,
      ownerAction: "Der Owner repariert .claude/mutation-policy.json (nur er darf sie aendern)." });
  }
  const what = "Aktion " + toolName + " in einem externen Dienst waehrend eines aktiven Pakets";
  if (!stateGuards().shellGuard.MCP_TOOL_NAME.test(String(toolName || ""))) {
    return ownerHandoff.handoffText({ what, ownerOnly: true, ownerAction: "Der Owner fuehrt die Aktion selbst in der App des Dienstes aus." });
  }
  const file = path.join(projectRoot, ".claude", "mutation-policy.json");
  const command = "$keelFile = " + ownerHandoff.powershellQuote(file) + "; " +
    "$keelPolicy = [IO.File]::ReadAllText($keelFile) | ConvertFrom-Json; " +
    "$keelPolicy.mcpWriteTools.allow = @(@($keelPolicy.mcpWriteTools.allow) + " + ownerHandoff.powershellQuote(toolName) +
    " | Select-Object -Unique); " +
    "[IO.File]::WriteAllText($keelFile, ($keelPolicy | ConvertTo-Json -Depth 10), (New-Object Text.UTF8Encoding $false))";
  return ownerHandoff.handoffText({ what, route: "Aktion selbst in der App des Dienstes ausfuehren", command,
    dialect: "powershell", cwd: projectRoot, ownerOnly: true,
    warning: "Der Befehl gibt " + toolName + " dauerhaft frei, solange ein Paket aktiv ist; zuruecknehmen: den Eintrag " +
      "in .claude/mutation-policy.json wieder loeschen." });
}

function selfTest() {
  const policy = { error: null, mcpAllow: new Set(["mcp__mail__send_message"]) };
  const broken = { error: "broken", mcpAllow: new Set() };
  const ruleRoot = path.resolve(__dirname, "..");
  const other = path.join(path.dirname(ruleRoot), path.basename(ruleRoot) + "-other");
  const cases = [
    ["non-MCP tools are not this guard's business", "Write", { active: true, policy }, true],
    ["read-only verb passes", "mcp__google__list_events", { active: true, policy }, true],
    ["read-only verb with prefix passes", "mcp__browser__get_page_text", { active: true, policy }, true],
    ["allowlisted write passes", "mcp__mail__send_message", { active: true, policy }, true],
    ["write verb blocks", "mcp__google__create_event", { active: true, policy }, false],
    ["unknown verb blocks", "mcp__x__frobnicate", { active: true, policy }, false],
    ["write word behind a read verb blocks", "mcp__x__search_and_replace", { active: true, policy }, false],
    ["camelCase write word behind a read verb blocks", "mcp__x__readAndUpdate", { active: true, policy }, false],
    ["write word behind a read verb passes without a package", "mcp__x__search_and_replace", { active: false, policy }, true],
    ["invalid policy blocks every MCP tool", "mcp__google__list_events", { active: true, policy: broken }, false],
    ["no active package leaves MCP alone", "mcp__google__create_event", { active: false, policy }, true],
    ["app browser tool passes while a package is active", "mcp__Claude_Browser__navigate", { active: true, policy }, true],
    ["app browser tool passes with an invalid policy", "mcp__Claude_Browser__navigate", { active: true, policy: broken }, true],
    ["preview start passes while a package is active", "mcp__Claude_Browser__preview_start", { active: true, policy }, true],
    ["linked-computer preview start passes while a package is active", "mcp__remote-devices__Claude_Browser__preview_start", { active: true, policy }, true],
    ["linked-computer page script stays a write", "mcp__remote-devices__Claude_Browser__javascript_tool", { active: true, policy }, false],
    ["linked-computer page text is a read", "mcp__remote-devices__Claude_Browser__get_page_text", { active: true, policy }, true],
    ["linked-computer desktop control stays a write", "mcp__remote-devices__computer_click", { active: true, policy }, false],
    ["terminal view passes while a package is active", "mcp__terminal__read_terminal", { active: true, policy }, true],
    ["terminal view passes with an invalid policy", "mcp__terminal__read_terminal", { active: true, policy: broken }, true],
    ["return to the rule root passes", CHANGE_DIRECTORY, { active: true, policy, ruleRoot, input: { path: ruleRoot } }, true],
    ["directory change elsewhere blocks", CHANGE_DIRECTORY, { active: true, policy, ruleRoot, input: { path: other } }, false],
    ["directory change elsewhere blocks without a package", CHANGE_DIRECTORY, { active: false, policy, ruleRoot, input: { path: other } }, false],
    ["terminal run blocks without a package", "mcp__terminal__run_in_terminal", { active: false, policy }, false],
    ["EnterWorktree blocks", "EnterWorktree", { active: false, policy, ruleRoot }, false],
    ["ExitWorktree passes", "ExitWorktree", { active: true, policy, ruleRoot }, true],
    ["move to cloud blocks", MOVE_TO_CLOUD, { active: false, policy, ruleRoot }, false],
    ["unbound local file write paket-gate refuses blocks", "mcp__filesystem__write_file", { active: false, repositoryWrite: { code: "MISSING_OR_STALE_BINDING" }, policy, input: { path: "a" } }, false],
    ["unbound local file write outside every repository passes", "mcp__filesystem__write_file", { active: false, repositoryWrite: null, policy, input: { path: "a" } }, true],
    ["unbound edit_block with a path blocks inside a repository", "mcp__desktop-commander__edit_block", { active: false, repositoryWrite: { code: "MISSING_OR_STALE_BINDING" }, policy, input: { file_path: "a" } }, false],
    ["unbound foreign service file passes", "mcp__google_drive__create_file", { active: false, repositoryWrite: { code: "MISSING_OR_STALE_BINDING" }, policy, input: { name: "a" } }, true],
  ];
  let failed = 0;
  for (const [name, tool, options, allowed] of cases) {
    const decision = decide(tool, options);
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

// The decision of one hook call (package P5, A1/A8): null lets the tool pass, a string is the denial text. The hook main
// program and the one guard process (.claude/pretool-guards.js) both use it.
function hookDecision(payload) {
  let projectRoot;
  let decision;
  try {
    projectRoot = hookContext.ruleRoot();
    decision = decideWithoutState(payload.tool_name, { input: payload.tool_input, ruleRoot: projectRoot });
    if (!decision) {
      let loaded;
      try { loaded = stateGuards(); }
      catch (error) { return "mcp-write-guard: dependency load failed; tool blocked: " + error.message; }
      // MCP_WRITE_UNDECLARED holds for a session bound to a work step (a worker or a leaf binding), not for every
      // session of a repository in which some package is active (Karte Arbeitsweise 07.10.2026).
      const active = require("../harness-core/guards/session-scope.cjs").boundToStep({ harnessRoot: projectRoot,
        sessionId: hookContext.hookSession(payload), cwd: payload.cwd || projectRoot });
      // paket-gate's measure is asked only for a local file tool of an unbound session (MCP_LOCAL_FILE_UNBOUND).
      const repositoryWrite = () => repositoryWriteRefusal(payload, projectRoot);
      decision = decide(payload.tool_name, { active, repositoryWrite, policy: loaded.shellGuard.loadMutationPolicy(projectRoot),
        input: payload.tool_input, ruleRoot: projectRoot });
    }
  } catch (error) {
    return "mcp-write-guard: policy evaluation failed; tool blocked: " + error.message;
  }
  if (decision.allowed) return null;
  // The denial itself must not depend on the Owner template (guard-parity A9).
  let template;
  try { template = ownerTemplate(payload.tool_name, projectRoot, decision.code); }
  catch (error) { template = "(Owner-Vorlage nicht erzeugbar: " + error.message + ")"; }
  return "mcp-write-guard: blocked before execution: " + decision.code + "\n" + decision.detail + "\nNEXT: " + decision.next +
    "\n" + guardRoutes.referenceLine("mcp-write-guard", decision.code) + "\n" + template;
}

if (require.main === module) {
  let input = "";
  process.stdin.on("data", (chunk) => { input += chunk; });
  process.stdin.on("end", () => {
    let payload;
    try { payload = JSON.parse(input || "{}"); }
    catch {
      return block("mcp-write-guard: invalid hook input; tool blocked");
    }
    noteActivity(payload); // sign of life of the planning session (D15), before anything is judged
    const denial = hookDecision(payload);
    return denial === null ? process.exit(0) : block(denial);
  });
}

module.exports = { APP_TOOLS, READ_ONLY_VERBS, isLocalFileTool, localTargets, repositoryWriteRefusal, WRITE_WORDS, WRITE_WORDS_LONG, WRITE_WORDS_SHORT, decide, decideWithoutState, hookDecision, isReadOnlyTool, ownerTemplate, selfTest, toolSuffix, toolWords };
