#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { runBounded } from "./bounded-runner.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const phases = [
  { name: "installed contract", command: process.execPath,
    args: [path.join(root, "checks", "installed-harness.mjs")], timeoutMs: 60_000 },
  { name: "installed React Dashboard runtime", command: process.execPath,
    args: [path.join(root, "dashboard", "runtime-check.mjs")], timeoutMs: 2 * 60_000 },
  { name: "full installed Unlazy suite", command: process.execPath,
    args: [path.join(root, "vendor", "unlazy", "tests", "full-suite.mjs")], timeoutMs: 15 * 60_000 },
];

for (const phase of phases) {
  const result = await runBounded({ ...phase, cwd: root, heartbeatMs: 20_000 });
  if (result.exitCode !== 0) {
    process.stderr.write(`KEEL_HARNESS_FAILED ${phase.name} exit=${result.exitCode}\n`);
    process.exit(result.exitCode);
  }
}
process.stdout.write("KEEL_HARNESS_OK\n");
