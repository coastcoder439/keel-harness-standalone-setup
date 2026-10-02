#!/usr/bin/env node
"use strict";

// Portable host adapter for the complete vendored Unlazy Stop hook. It owns
// exactly one policy: not-started packages do not block. When the package the
// vendored hook would resolve has an active scope without any dispatch wave
// (dispatch.json missing or its waves object empty), the adapter ends silently;
// everything else -- stdin, stdout, stderr and the exit result -- is forwarded
// to the upstream implementation unchanged. Its own failures never block, they
// forward. The adapter also lets both project hosts use a repository-relative
// command instead of a machine-specific path.

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const harnessRoot = path.resolve(__dirname, "..");
const candidates = [
  path.join(harnessRoot, "vendor", "unlazy", "scripts", "stop-hook.mjs"),
  path.join(harnessRoot, "..", "vendor", "unlazy", "scripts", "stop-hook.mjs"),
].filter((candidate) => fs.existsSync(candidate));
const script = candidates.length === 1 ? fs.realpathSync.native(candidates[0]) : null;

if (process.argv.includes("--self-test") || process.argv.includes("--selbsttest")) {
  if (!script || !fs.statSync(script).isFile()) {
    process.stderr.write(`unlazy-stop adapter: expected exactly one vendored stop-hook.mjs; found ${candidates.length}\n`);
    process.exit(1);
  }
  const source = fs.readFileSync(script, "utf8");
  if (!source.includes("resolvePackageTarget") || !source.includes("MAX_BLOCKS")) {
    process.stderr.write("unlazy-stop adapter: vendored package-aware Stop contract missing\n");
    process.exit(1);
  }
  process.stdout.write("unlazy-stop adapter self-test passed\n");
  process.exit(0);
}

// True only when the resolved package has a scope and no dispatch wave yet.
// Any doubt returns false, so the vendored hook decides as before.
async function notStarted(input) {
  let payload;
  try { payload = JSON.parse(input || "{}"); } catch { return false; }
  if (!payload || typeof payload !== "object" || payload.stop_hook_active === true) return false;
  try {
    const cwd = path.resolve(typeof payload.cwd === "string" && payload.cwd
      ? payload.cwd : process.env.CLAUDE_PROJECT_DIR || process.cwd());
    const packages = await import(pathToFileURL(path.join(path.dirname(script), "lib", "packages.mjs")).href);
    const target = packages.resolvePackageTarget({ cwd, sessionId: payload.session_id || "anonymous" });
    if (!target || !target.scope) return false;
    const dispatch = path.join(target.repoRoot, ".unlazy", target.scope, "dispatch.json");
    if (!fs.existsSync(dispatch)) return true;
    const state = JSON.parse(fs.readFileSync(dispatch, "utf8"));
    return Boolean(state && state.waves && typeof state.waves === "object" && !Array.isArray(state.waves) &&
      Object.keys(state.waves).length === 0);
  } catch {
    return false;
  }
}

function forward(input) {
  const result = spawnSync(process.execPath, [script, "--unlazy-hook-v2"], {
    cwd: process.env.CLAUDE_PROJECT_DIR || process.cwd(),
    input,
    encoding: "utf8",
    windowsHide: true,
    timeout: 20_000,
    env: process.env,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) {
    process.stderr.write(`unlazy-stop adapter failed: ${result.error.message}\n`);
    process.exit(2);
  }
  process.exit(Number.isInteger(result.status) ? result.status : 2);
}

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  if (!script) {
    process.stderr.write(`unlazy-stop adapter: expected exactly one vendored stop-hook.mjs; found ${candidates.length}\n`);
    process.exit(2);
  }
  notStarted(input).then((silent) => {
    if (silent) process.exit(0);
    forward(input);
  }, () => forward(input));
});
