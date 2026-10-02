#!/usr/bin/env node
"use strict";

// Codex runs project hooks with the session cwd, which may be a subdirectory.
// The hooks themselves need the immutable Harness root. hooks.json locates this
// runner via .keel-harness.json; this runner then permits only this finite list
// of repository-owned hook programs and supplies the same root variable Claude
// Code supplies natively.

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ALLOWED = new Set([
  ".claude/danger-guard.js",
  ".claude/git-intent-guard.js",
  ".claude/mcp-write-guard.js",
  ".claude/shell-mutation-guard.js",
  ".claude/onboarding-start.js",
  ".claude/pollution-warn.js",
  ".claude/project-context.js",
  ".claude/prompt-form.js",
  ".claude/session-roles.js",
  ".claude/sessionpost-guard.js",
  ".claude/uncommitted-warn.js",
  ".claude/unlazy-stop.js",
  ".codex/apply-patch-guard.cjs",
  ".codex/dod-guard.cjs",
]);

const harnessRoot = path.resolve(__dirname, "..");
const requested = String(process.env.KEEL_HOOK_TARGET || process.argv[2] || "").replaceAll("\\", "/");

// A failing runner must not let a tool call through (guard-parity E5): Codex on Windows runs
// hooks through PowerShell, which turns a native exit 2 into 1, and Codex treats 1 as a hook
// error and runs the tool. Before a tool call the runner therefore denies in Codex's JSON form
// with exit 0; for the other events exit 2 keeps its meaning.
function fail(message, event) {
  const reason = "codex-hook-runner: " + message;
  if (event === "PreToolUse") {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: {
      hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason,
    } }) + "\n");
    process.exit(0);
  }
  process.stderr.write(reason + "\n");
  process.exit(2);
}

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  let event = "";
  try { event = String(JSON.parse(input || "{}").hook_event_name || ""); }
  catch { event = ""; }
  if (!fs.existsSync(path.join(harnessRoot, ".keel-harness.json"))) fail("Harness root marker is missing", event);
  if (!ALLOWED.has(requested)) fail("hook target is not in the finite allowlist: " + requested, event);
  const target = path.join(harnessRoot, ...requested.split("/"));
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) fail("hook target is missing: " + requested, event);
  const result = spawnSync(process.execPath, [target], {
    cwd: harnessRoot,
    input,
    encoding: "utf8",
    windowsHide: true,
    timeout: 25_000,
    maxBuffer: 4 * 1024 * 1024,
    // KEEL_HOOK_TARGET names the guard for its Codex deny format. The hooks.json launcher
    // sets it; hooks the package executor hands to `codex exec` name the target as an
    // argument, so the runner sets it here too (guard-parity E8).
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: harnessRoot,
      KEEL_HARNESS_ROOT: harnessRoot,
      KEEL_HOOK_TARGET: requested,
    },
  });
  if (result.error) fail(result.error.message, event);
  if (result.stderr) process.stderr.write(result.stderr);
  // A guard that ends without a decision before a tool call (crash, signal, plain exit 2)
  // denies too, with its own words as the reason.
  if (event === "PreToolUse" && result.status !== 0 && !/"permissionDecision"\s*:\s*"deny"/u.test(String(result.stdout || ""))) {
    fail("hook " + requested + " ended with status " + result.status + " and no decision" +
      (result.stderr ? ": " + String(result.stderr).trim().slice(0, 4_000) : ""), event);
  }
  if (result.stdout) process.stdout.write(result.stdout);
  process.exit(Number.isInteger(result.status) ? result.status : 2);
});
