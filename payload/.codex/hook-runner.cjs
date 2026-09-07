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

function fail(message) {
  process.stderr.write("codex-hook-runner: " + message + "\n");
  process.exit(2);
}

if (!fs.existsSync(path.join(harnessRoot, ".keel-harness.json"))) fail("Harness root marker is missing");
if (!ALLOWED.has(requested)) fail("hook target is not in the finite allowlist: " + requested);

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  const target = path.join(harnessRoot, ...requested.split("/"));
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) fail("hook target is missing: " + requested);
  const result = spawnSync(process.execPath, [target], {
    cwd: harnessRoot,
    input,
    encoding: "utf8",
    windowsHide: true,
    timeout: 25_000,
    maxBuffer: 4 * 1024 * 1024,
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: harnessRoot,
      KEEL_HARNESS_ROOT: harnessRoot,
    },
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) fail(result.error.message);
  process.exit(Number.isInteger(result.status) ? result.status : 2);
});
