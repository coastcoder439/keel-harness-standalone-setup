#!/usr/bin/env node
"use strict";

// One process for all PreToolUse guards of one tool call (package P5, A1, A2, A3, A8, A10).
//
// Claude Code starts every hook of a matcher group as its own process, under Windows through Git Bash (bash -> bash ->
// node). Three shell guards made nine processes per Bash call, each loading the same 300 KB of guard code, the
// PowerShell parser ran three times and the Git judgement twice. This program is the only PreToolUse hook of
// .claude/settings.json; it is started in exec form (`"command": "node", "args": [<this file>, <group>]`, no shell) and
// runs the guards of its group one after another in this process, with the guards' own decision functions
// (`hookDecision`, the same code their own hook main program uses):
//
//   shell  Bash, PowerShell                git-intent-guard, shell-mutation-guard, danger-guard
//   write  Write, Edit, NotebookEdit       write-guard, paket-gate
//   mcp    mcp__.*, EnterWorktree          mcp-write-guard; sessionpost-guard for mcp__ccd_session_mgmt__send_message
//                                          and list_sessions (its old matcher)
//
// The decision is the one the single guards made as separate hooks: every guard of the group says its word (as when the
// host started them side by side), the call is denied when one of them denies, and the denial carries every denial
// text. A guard that cannot load or throws denies with its own name (fail closed, guard-parity A9); so does an unknown
// group. The guards share one parse of a PowerShell command (command-model.cjs, A2) and git-intent-guard's Git findings
// (A3). The single guard files stay hook programs of their own: Codex starts them through .codex/hook-runner.cjs, which
// loads them into its own process the same way (C12), and their tests start them directly.
//
// AUFRUF    PreToolUse: node .claude/pretool-guards.js shell|write|mcp   (Hook-Eingabe auf stdin)
// RUECKGABE 0 = durch · 2 = blockiert, Grund auf stderr

const fs = require("node:fs");

const GUARD_TARGET = ".claude/pretool-guards.js";

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

// The guards of each group, in the order of the former hook entries. tools: the tool names the guard's former matcher
// reached inside its group (null: every tool of the group).
const GROUPS = Object.freeze({
  shell: Object.freeze([
    { name: "git-intent-guard", file: "./git-intent-guard.js", tools: null },
    { name: "shell-mutation-guard", file: "./shell-mutation-guard.js", tools: null },
    { name: "danger-guard", file: "./danger-guard.js", tools: null },
  ]),
  write: Object.freeze([
    { name: "write-guard", file: "./write-guard.js", tools: null },
    { name: "paket-gate", file: "./paket-gate.js", tools: null },
  ]),
  mcp: Object.freeze([
    { name: "mcp-write-guard", file: "./mcp-write-guard.js", tools: null },
    { name: "sessionpost-guard", file: "./sessionpost-guard.js", tools: /^mcp__ccd_session_mgmt__(?:send_message|list_sessions)$/u },
  ]),
});

// The denial texts of every guard of the group for one hook input; empty when the call may run.
function decide(group, payload) {
  const members = Object.hasOwn(GROUPS, String(group)) ? GROUPS[group] : null;
  if (!members) return ["pretool-guards: unknown guard group \"" + String(group) + "\"; tool blocked"];
  const shared = {};
  const denials = [];
  for (const member of members) {
    if (member.tools && !member.tools.test(String(payload?.tool_name || ""))) continue;
    let guard;
    try { guard = require(member.file); }
    catch (error) {
      denials.push(member.name + ": dependency load failed; tool blocked: " + ((error && error.message) || error));
      continue;
    }
    try {
      const denial = guard.hookDecision(payload, shared);
      if (denial !== null) denials.push(String(denial).trim() || member.name + ": tool denied");
    } catch (error) {
      denials.push(member.name + ": internal error; tool blocked: " + ((error && error.message) || error));
    }
  }
  return denials;
}

function selfTest() {
  const { spawnSync } = require("node:child_process");
  const path = require("node:path");
  const root = path.resolve(__dirname, "..");
  const run = (group, payload) => spawnSync(process.execPath, [__filename, group], {
    cwd: root, input: JSON.stringify({ hook_event_name: "PreToolUse", session_id: "pretool-self-test", cwd: root, ...payload }),
    encoding: "utf8", windowsHide: true,
    env: { ...process.env, CLAUDE_PROJECT_DIR: root, KEEL_HARNESS_ROOT: "", KEEL_HOOK_TARGET: "", KEEL_PACKAGE_SESSION: "", KEEL_GUARD_TEST_THROW: "" },
  });
  const cases = [
    ["a read passes all three shell guards", "shell", { tool_name: "Bash", tool_input: { command: "ls" } }, 0, null],
    ["raw Git is denied by git-intent-guard", "shell", { tool_name: "Bash", tool_input: { command: "git reset --hard" } }, 2, /git-intent-guard/u],
    ["removing the home folder is denied by both other shell guards", "shell", { tool_name: "Bash", tool_input: { command: "rm -rf ~" } }, 2,
      /shell-mutation-guard[\s\S]*danger-guard/u],
    ["a browser click passes", "mcp", { tool_name: "mcp__Claude_Browser__computer", tool_input: { action: "left_click" } }, 0, null],
    ["sending between sessions is denied", "mcp", { tool_name: "mcp__ccd_session_mgmt__send_message", tool_input: { message: "x" } }, 2, /sessionpost-guard/u],
    ["an unknown group is denied", "nothing", { tool_name: "Bash", tool_input: { command: "ls" } }, 2, /unknown guard group/u],
  ];
  let failed = 0;
  for (const [name, group, payload, status, text] of cases) {
    const result = run(group, payload);
    const ok = result.status === status && (!text || text.test(String(result.stderr || "")));
    if (!ok) failed += 1;
    process.stdout.write((ok ? "ok  " : "FAIL") + " " + name + (ok ? "" : " (status " + result.status + ")") + "\n");
  }
  process.stdout.write(String(cases.length - failed) + "/" + String(cases.length) + " passed\n");
  return failed;
}

if (require.main === module && (process.argv.includes("--self-test") || process.argv.includes("--selbsttest"))) {
  process.exit(selfTest() ? 1 : 0);
}

if (require.main === module) {
  const group = process.argv[2];
  let input = "";
  process.stdin.on("data", (chunk) => { input += chunk; });
  process.stdin.on("end", () => {
    let payload;
    try { payload = JSON.parse(input || "{}"); }
    catch {
      return block("pretool-guards: invalid hook input; tool blocked");
    }
    // One sign of life of the planning session per tool call (D15); it never decides and never fails the hook.
    try { require("../harness-core/binding/hook-activity.cjs").noteHookInput(payload); } catch { /* a record, not a decision */ }
    const denials = decide(group, payload);
    return denials.length ? block(denials.join("\n\n")) : process.exit(0);
  });
}

module.exports = { GROUPS, decide, selfTest };
