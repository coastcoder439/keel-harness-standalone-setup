#!/usr/bin/env node
"use strict";

// Codex runs project hooks with the session cwd, which may be a subdirectory.
// The hooks themselves need the immutable Harness root. hooks.json locates this
// runner via .keel-harness.json; this runner then permits only this finite list
// of repository-owned hook programs and supplies the same root variable Claude
// Code supplies natively.
//
// A PreToolUse guard runs in this process (package P5, C12): the runner loads it and asks its decision function
// (`hookDecision`, the code of the guard's own hook main program), instead of starting a second Node process per guard.
// Every guard keeps its own denial, in Codex's JSON form. The other hooks (session start, prompt, stop) still run as a
// child process; Codex's own hook time limit (hooks.json) is their only time limit.

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ALLOWED = new Set([
  ".claude/github-delete-guard.js",
  ".claude/onboarding-start.js",
  ".claude/pollution-warn.js",
  ".claude/project-context.js",
  ".claude/prompt-form.js",
  ".claude/session-roles.js",
  ".claude/uncommitted-warn.js",
  ".claude/unlazy-stop.js",
  ".codex/dod-guard.cjs",
]);

// The guard of the list: loaded into this process (C12).
const IN_PROCESS = new Set([
  ".claude/github-delete-guard.js",
]);

const harnessRoot = path.resolve(__dirname, "..");
const requested = String(process.env.KEEL_HOOK_TARGET || process.argv[2] || "").replaceAll("\\", "/");

// A failing runner must not let a tool call through (guard-parity E5): Codex on Windows runs
// hooks through PowerShell, which turns a native exit 2 into 1, and Codex treats 1 as a hook
// error and runs the tool. Before a tool call the runner therefore denies in Codex's JSON form
// with exit 0; for the other events exit 2 keeps its meaning.
function fail(message, event) {
  const reason = "codex-hook-runner: " + message;
  deny(reason, event);
}

// The runner's own exit; a guard loaded into this process cannot end it without a decision (see runInProcess).
const exit = process.exit.bind(process);

function deny(reason, event) {
  if (event === "PreToolUse") {
    fs.writeSync(1, JSON.stringify({ hookSpecificOutput: {
      hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason,
    } }) + "\n");
    exit(0);
  }
  fs.writeSync(2, reason + "\n");
  exit(2);
}

// The environment a guard reads its root, its target (the Codex deny form, the dialect) and its identity from.
// KEEL_HOOK_TARGET names the guard for its Codex deny format. The hooks.json launcher
// sets it; hooks the package executor hands to `codex exec` name the target as an
// argument, so the runner sets it here too (guard-parity E8).
const hookEnv = { CLAUDE_PROJECT_DIR: harnessRoot, KEEL_HARNESS_ROOT: harnessRoot, KEEL_HOOK_TARGET: requested };

// One guard in this process. Any error while loading or deciding denies with the guard's name (fail closed, A9).
function runInProcess(input, payload, event) {
  const name = requested.replace(/^.*\//u, "").replace(/\.c?js$/u, "");
  const failClosed = (error) => {
    try { deny(name + ": internal error; tool blocked: " + ((error && error.message) || error), event); }
    catch { process.exit(2); }
  };
  process.on("uncaughtException", failClosed);
  process.on("unhandledRejection", failClosed);
  // A guard that ends the process itself (a crash path, an old guard that exits while it loads) has given no decision:
  // before a tool call that denies, with what it wrote to stderr as the reason.
  let stderrText = "";
  const writeStderr = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk, ...rest) => { stderrText += String(chunk); return writeStderr(chunk, ...rest); };
  process.exit = (code) => fail("hook " + requested + " ended with status " + (code ?? process.exitCode ?? 0) + " and no decision" +
    (stderrText ? ": " + stderrText.trim().slice(0, 4_000) : ""), event);
  Object.assign(process.env, hookEnv);
  process.chdir(harnessRoot);
  // One sign of life of the planning session per tool call (D15); it never decides and never fails the hook.
  try { require(path.join(harnessRoot, "harness-core", "binding", "hook-activity.cjs")).noteHookInput(payload); } catch { /* a record */ }
  let guard;
  try { guard = require(path.join(harnessRoot, ...requested.split("/"))); }
  catch (error) { return deny(name + ": dependency load failed; tool blocked: " + error.message, event); }
  if (typeof guard.hookDecision !== "function") return fail("hook " + requested + " has no decision function", event);
  const denial = guard.hookDecision(payload, {});
  if (denial !== null) return deny(String(denial).trim() || requested + ": tool denied", event);
  exit(0);
}

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  let event = "";
  let payload = null;
  try { payload = JSON.parse(input || "{}"); event = String(payload.hook_event_name || ""); }
  catch { event = ""; }
  if (!fs.existsSync(path.join(harnessRoot, ".keel-harness.json"))) fail("Harness root marker is missing", event);
  if (!ALLOWED.has(requested)) fail("hook target is not in the finite allowlist: " + requested, event);
  const target = path.join(harnessRoot, ...requested.split("/"));
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) fail("hook target is missing: " + requested, event);
  if (IN_PROCESS.has(requested)) {
    if (payload === null) return deny(requested.replace(/^.*\//u, "").replace(/\.c?js$/u, "") + ": invalid hook input; tool blocked", event || "PreToolUse");
    return runInProcess(input, payload, event);
  }
  const result = spawnSync(process.execPath, [target], {
    cwd: harnessRoot,
    input,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, ...hookEnv },
  });
  if (result.error) fail(result.error.message, event);
  if (result.stderr) process.stderr.write(result.stderr);
  // A hook that ends without a decision before a tool call (crash, signal, plain exit 2)
  // denies too, with its own words as the reason.
  if (event === "PreToolUse" && result.status !== 0 && !/"permissionDecision"\s*:\s*"deny"/u.test(String(result.stdout || ""))) {
    fail("hook " + requested + " ended with status " + result.status + " and no decision" +
      (result.stderr ? ": " + String(result.stderr).trim().slice(0, 4_000) : ""), event);
  }
  if (result.stdout) process.stdout.write(result.stdout);
  process.exit(Number.isInteger(result.status) ? result.status : 2);
});
