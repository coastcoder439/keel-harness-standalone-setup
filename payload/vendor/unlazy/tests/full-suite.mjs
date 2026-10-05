#!/usr/bin/env node

// Product-level Unlazy regression, including the consuming repository fixture.

import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { emitTestCounts } from "./helpers/test-counts.mjs";

const root = dirname(fileURLToPath(import.meta.url));
export const UNLAZY_SUITES = Object.freeze([
  "run-tests.mjs",
  "dispatch-tests.mjs",
  "hardening-tests.mjs",
  "stress-tests.mjs",
  "lint-tests.mjs",
  "contract-tests.mjs",
  "package-resolver-tests.mjs",
  "package-schema-tests.mjs",
  "package-fanout-tests.mjs",
  "package-gate-tests.mjs",
  "gate-approval-path-tests.mjs",
  "package-hook-tests.mjs",
  "package-lifecycle-tests.mjs",
  "package-contract-tests.mjs",
  "package-migrate-tests.mjs",
  "package-standard-tests.mjs",
  "project-roadmap-tests.mjs",
  "mvp-workbench-tests.mjs",
  "self-check.mjs",
]);

export function parseSuiteCounts(output, suite) {
  const lines = String(output).split(/\r?\n/u).filter((line) => line.startsWith("UNLAZY_TEST_COUNTS "));
  if (lines.length !== 1) throw new Error(`${suite} emitted ${lines.length} count records`);
  const counts = JSON.parse(lines[0].slice("UNLAZY_TEST_COUNTS ".length));
  if (counts.schema !== 1 || counts.suite !== suite.replace(/\.mjs$/u, "")) {
    throw new Error(`${suite} emitted a mismatched count record`);
  }
  if (!["tests", "pass", "fail", "skip"].every((key) => Number.isInteger(counts[key]) && counts[key] >= 0) ||
      counts.pass + counts.fail + counts.skip !== counts.tests) {
    throw new Error(`${suite} emitted inconsistent counts`);
  }
  return counts;
}

export function consumingRepositoryRoot() {
  const candidate = resolve(root, "..", "..", "..");
  return (realpathSync.native || realpathSync)(candidate);
}

export function runFullSuite(repositoryRoot = consumingRepositoryRoot()) {
  const aggregate = { tests: 0, pass: 0, fail: 0, skip: 0 };
  let failedSuite = null;
  for (const suite of UNLAZY_SUITES) {
    const args = [join(root, suite)];
    if (suite === "mvp-workbench-tests.mjs") args.push(repositoryRoot);
    const result = spawnSync(process.execPath, args, {
      cwd: dirname(root),
      encoding: "utf8",
      windowsHide: true,
      timeout: 180_000,
    });
    process.stdout.write(result.stdout || "");
    process.stderr.write(result.stderr || "");
    let counts;
    try { counts = parseSuiteCounts(result.stdout, suite); }
    catch (error) {
      process.stderr.write(`UNLAZY_SUITE_COUNTS_FAILED ${suite}: ${error.message}\n`);
      failedSuite = failedSuite || suite;
      counts = { tests: 1, pass: 0, fail: 1, skip: 0 };
    }
    for (const key of Object.keys(aggregate)) aggregate[key] += counts[key];
    if (result.error || result.status !== 0 || counts.fail !== 0) {
      process.stderr.write("UNLAZY_SUITE_FAILED " + suite + " exit=" +
        String(result.status ?? result.error?.code ?? "spawn") + "\n");
      failedSuite = failedSuite || suite;
      break;
    }
  }
  emitTestCounts("full-suite", aggregate);
  if (failedSuite) return { ok: false, failedSuite, ...aggregate };
  process.stdout.write(`Unlazy full suite: ${UNLAZY_SUITES.length}/${UNLAZY_SUITES.length} phases; ` +
    `${aggregate.tests} tests, ${aggregate.pass} passed, ${aggregate.fail} failed, ${aggregate.skip} skipped\n`);
  process.stdout.write("UNLAZY_FULL_SUITE_OK\n");
  return { ok: true, failedSuite: null, ...aggregate };
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  const result = runFullSuite(process.argv[2] ? resolve(process.argv[2]) : consumingRepositoryRoot());
  if (!result.ok) process.exitCode = 1;
}
