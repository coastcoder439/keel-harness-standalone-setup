#!/usr/bin/env node
"use strict";

// PreToolUse mutation boundary for MCP tools (completeness audit 06.09.2026, B6).
//
// The finite mutation boundary covered Bash, Write/Edit and Codex apply_patch. Every other
// write-capable tool in the same host -- above all MCP servers (mail, calendar, drive, browser,
// session messaging) -- could mutate an external system during an active package without any
// guard seeing it. This hook closes that gap fail-closed: while a package is active, an MCP tool
// runs only when its name is a read-only verb or when the Owner allowlisted the exact tool name
// in .claude/mutation-policy.json (mcpWriteTools.allow). Unknown verbs are denied, not guessed.
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

let gitGuard;
let shellGuard;
let hookContext;
let ownerHandoff;
let repository;
try {
  gitGuard = require("./git-intent-guard.js");
  shellGuard = require("./shell-mutation-guard.js");
  hookContext = require("../harness-core/guards/hook-context.cjs");
  ownerHandoff = require("../harness-core/guards/owner-handoff.cjs");
  repository = require("../harness-core/binding/repository.cjs");
} catch (error) {
  if (require.main === module) block("mcp-write-guard: dependency load failed; tool blocked: " + error.message);
  throw error;
}

// Read-only verbs at the start of the tool name (after mcp__<server>__). The list is finite on
// purpose; a verb that is not here is treated as a write.
const READ_ONLY_VERBS = /^(?:get|list|search|read|find|fetch|query|status|describe|show|lookup|resolve|check|count|inspect|preview|tabs_context|screenshot)(?:_|$)/iu;
const MCP_NAME = /^mcp__([A-Za-z0-9-]+(?:_[A-Za-z0-9-]+)*)__(.+)$/u;

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
function decide(toolName, options = {}) {
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
  if (isAppTool(name)) return allow("APP_TOOL");
  if (!name.startsWith("mcp__")) return allow("NOT_MCP");
  if (!options.active) return allow("NO_ACTIVE_PACKAGE");
  const policy = options.policy || { error: "no policy loaded", mcpAllow: new Set() };
  if (policy.error) {
    return deny("POLICY_INVALID", ".claude/mutation-policy.json is invalid: " + policy.error,
      "The Owner repairs the policy file; MCP tools stay blocked while a package is active; the app tools stay free.");
  }
  if (policy.mcpAllow.has(name)) return allow("MCP_ALLOWLISTED");
  const suffix = toolSuffix(name);
  if (suffix && READ_ONLY_VERBS.test(suffix)) return allow("MCP_READ_ONLY");
  return deny("MCP_WRITE_UNDECLARED",
    "MCP tool " + name + " is not a read-only verb and not allowlisted: it could mutate an external system outside the finite mutation boundary",
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
  if (code === "POLICY_INVALID") {
    return ownerHandoff.handoffText({ what: "MCP-Werkzeug " + toolName + " bei ungueltiger .claude/mutation-policy.json", ownerOnly: true,
      ownerAction: "Der Owner repariert .claude/mutation-policy.json (nur er darf sie aendern)." });
  }
  const what = "Aktion " + toolName + " in einem externen Dienst waehrend eines aktiven Pakets";
  if (!shellGuard.MCP_TOOL_NAME.test(String(toolName || ""))) {
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
    ["invalid policy blocks every MCP tool", "mcp__google__list_events", { active: true, policy: broken }, false],
    ["no active package leaves MCP alone", "mcp__google__create_event", { active: false, policy }, true],
    ["app browser tool passes while a package is active", "mcp__Claude_Browser__navigate", { active: true, policy }, true],
    ["app browser tool passes with an invalid policy", "mcp__Claude_Browser__navigate", { active: true, policy: broken }, true],
    ["terminal view passes while a package is active", "mcp__terminal__read_terminal", { active: true, policy }, true],
    ["terminal view passes with an invalid policy", "mcp__terminal__read_terminal", { active: true, policy: broken }, true],
    ["return to the rule root passes", CHANGE_DIRECTORY, { active: true, policy, ruleRoot, input: { path: ruleRoot } }, true],
    ["directory change elsewhere blocks", CHANGE_DIRECTORY, { active: true, policy, ruleRoot, input: { path: other } }, false],
    ["directory change elsewhere blocks without a package", CHANGE_DIRECTORY, { active: false, policy, ruleRoot, input: { path: other } }, false],
    ["terminal run blocks without a package", "mcp__terminal__run_in_terminal", { active: false, policy }, false],
    ["EnterWorktree blocks", "EnterWorktree", { active: false, policy, ruleRoot }, false],
    ["ExitWorktree passes", "ExitWorktree", { active: true, policy, ruleRoot }, true],
    ["move to cloud blocks", MOVE_TO_CLOUD, { active: false, policy, ruleRoot }, false],
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

if (require.main === module) {
  let input = "";
  process.stdin.on("data", (chunk) => { input += chunk; });
  process.stdin.on("end", () => {
    let payload;
    try { payload = JSON.parse(input || "{}"); }
    catch {
      return block("mcp-write-guard: invalid hook input; tool blocked");
    }
    const projectRoot = hookContext.ruleRoot();
    let decision;
    try {
      const active = gitGuard.activePackage(projectRoot, hookContext.hookSession(payload), payload.cwd || projectRoot);
      decision = decide(payload.tool_name, { active, policy: shellGuard.loadMutationPolicy(projectRoot),
        input: payload.tool_input, ruleRoot: projectRoot });
    } catch (error) {
      return block("mcp-write-guard: policy evaluation failed; tool blocked: " + error.message);
    }
    if (decision.allowed) return process.exit(0);
    return block("mcp-write-guard: blocked before execution: " + decision.code + "\n" + decision.detail + "\nNEXT: " + decision.next +
      "\n" + ownerTemplate(payload.tool_name, projectRoot, decision.code));
  });
}

module.exports = { APP_TOOLS, READ_ONLY_VERBS, decide, ownerTemplate, selfTest, toolSuffix };
