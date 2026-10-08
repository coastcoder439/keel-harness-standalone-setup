#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { runBounded } from "./bounded-runner.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Die Anleitung verlangt Node >= 20; ohne diesen Guard stirbt eine fremde
// Installation auf altem Node erst tief in einer Teilpruefung, unverstaendlich.
const nodeMajor = Number(process.versions.node.split(".")[0]);
if (!(nodeMajor >= 20)) {
  process.stderr.write("NODE_TOO_OLD running=" + process.version + " required=>=20\n");
  process.exit(1);
}

// --layout-only (P9, B6): the fresh installation checks the installed layout and contract, not the
// Unlazy suite a second time; the suite of the same code state runs once as the matrix phase
// unlazy:full-suite. Without the switch the recipient runs its complete matrix. No phase has a
// fixed time: bounded-runner ends a phase only when it is hung (silence watcher, KEEL_SILENCE_MS).
const layoutOnly = process.argv.slice(2).includes("--layout-only");
const unknownOptions = process.argv.slice(2).filter((value) => value !== "--layout-only");
if (unknownOptions.length) {
  process.stderr.write("usage: node checks/run-all.mjs [--layout-only]; unknown: " + unknownOptions.join(" ") + "\n");
  process.exit(2);
}

const phases = [
  { name: "installed contract", countMode: "harness", expectedSkips: 0, command: process.execPath,
    args: [path.join(root, "checks", "installed-harness.mjs")] },
  { name: "installed React Dashboard runtime", countMode: "check", expectedSkips: 0, command: process.execPath,
    args: [path.join(root, "dashboard", "runtime-check.mjs")] },
  layoutOnly
    ? { name: "installed Unlazy layout", countMode: "unlazy-layout", expectedSkips: 0, command: process.execPath,
      args: [path.join(root, "vendor", "unlazy", "tests", "full-suite.mjs"), "--layout-only"] }
    : { name: "full installed Unlazy suite", countMode: "unlazy", expectedSkips: 8, command: process.execPath,
      args: [path.join(root, "vendor", "unlazy", "tests", "full-suite.mjs")] },
];

// Zaehlsaetze der Phasen: HARNESS_CHECK_COUNTS {json} (installed-harness) und
// UNLAZY_TEST_COUNTS {json, suite full-suite}. Ein Skip-Ueberschuss ist rot -- eine still
// uebersprungene Pruefung ist kein bestandener Empfaenger-Lauf (Audit B12).
function countRecord(output, prefix, suite) {
  const records = String(output).split(/\r?\n/u)
    .filter((line) => line.startsWith(prefix))
    .map((line) => JSON.parse(line.slice(prefix.length)))
    .filter((record) => suite === null || record.suite === suite);
  if (records.length !== 1) throw new Error(prefix.trim() + ": " + records.length + " count records, expected 1");
  const counts = records[0];
  if (counts.schema !== 1 || !["tests", "pass", "fail", "skip"].every((key) => Number.isInteger(counts[key]) && counts[key] >= 0)) {
    throw new Error(prefix.trim() + ": invalid count record");
  }
  if (counts.pass + counts.fail + counts.skip !== counts.tests) throw new Error(prefix.trim() + ": inconsistent counts");
  return { tests: counts.tests, pass: counts.pass, fail: counts.fail, skip: counts.skip };
}

for (const phase of phases) {
  const result = await runBounded({ ...phase, cwd: root, heartbeatMs: 20_000 });
  const output = String(result.stdout || "") + String(result.stderr || "");
  let counts;
  let countError = null;
  try {
    counts = phase.countMode === "harness" ? countRecord(output, "HARNESS_CHECK_COUNTS ", null)
      : phase.countMode === "unlazy" ? countRecord(output, "UNLAZY_TEST_COUNTS ", "full-suite")
      : phase.countMode === "unlazy-layout" ? countRecord(output, "UNLAZY_TEST_COUNTS ", "full-suite-layout")
        : { tests: 1, pass: result.exitCode === 0 ? 1 : 0, fail: result.exitCode === 0 ? 0 : 1, skip: 0 };
  } catch (error) {
    countError = error.message;
    counts = { tests: 1, pass: 0, fail: 1, skip: 0 };
  }
  const passed = result.exitCode === 0 && !result.hung && !countError && counts.fail === 0 && counts.skip === phase.expectedSkips;
  process.stdout.write("KEEL_HARNESS_PHASE " + JSON.stringify({ name: phase.name, exitCode: result.exitCode, ...counts, expectedSkips: phase.expectedSkips }) + "\n");
  if (!passed) {
    process.stderr.write("KEEL_HARNESS_FAILED " + phase.name + " exit=" + result.exitCode + " counts=" + JSON.stringify(counts) +
      " expectedSkips=" + phase.expectedSkips + (countError ? " reason=" + countError : "") + "\n");
    process.exit(result.exitCode !== 0 ? result.exitCode : 1);
  }
}
process.stdout.write((layoutOnly ? "KEEL_HARNESS_LAYOUT_OK\n" : "") + "KEEL_HARNESS_OK\n");
