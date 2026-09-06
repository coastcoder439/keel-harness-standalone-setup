#!/usr/bin/env node
"use strict";

// Portable host adapter for the complete vendored Unlazy Stop hook. It owns no
// workflow policy: stdin, stdout, stderr and the exit result are forwarded to
// the upstream implementation. The adapter exists only so both project hosts
// can use a repository-relative command instead of a machine-specific path.

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

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

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  if (!script) {
    process.stderr.write(`unlazy-stop adapter: expected exactly one vendored stop-hook.mjs; found ${candidates.length}\n`);
    process.exit(2);
  }
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
});
