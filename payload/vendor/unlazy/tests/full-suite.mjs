#!/usr/bin/env node

// Product-level Unlazy regression, including the consuming repository fixture.
//
// Every suite runs, also after a red one; at the end every red suite is named
// (UNLAZY_SUITES_FAILED). No suite has a fixed time: each runs under the silence
// watcher (scripts/lib/silence-watch.mjs) and is ended only when it is hung (no
// output and no CPU for KEEL_SILENCE_MS).
//
// --layout-only checks the installed layout instead of executing the suites: every
// suite, the count helper and every script of this Unlazy tree exist and parse
// (node --check). A fresh installation uses it; the suites themselves run once, as
// the matrix phase unlazy:full-suite of the same code state (P9, B6).

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runWatched } from "../scripts/lib/silence-watch.mjs";
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
  "gate-check-limits-tests.mjs",
  "package-hook-tests.mjs",
  "package-lifecycle-tests.mjs",
  "rename-retry-tests.mjs",
  "package-contract-tests.mjs",
  "package-migrate-tests.mjs",
  "package-standard-tests.mjs",
  "project-roadmap-tests.mjs",
  "mvp-workbench-tests.mjs",
  "silence-watch-tests.mjs",
  "proof-store-tests.mjs",
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

// options: suites (names below testsRoot), testsRoot, run (a runWatched-shaped function; tests only).
export async function runFullSuite(repositoryRoot = consumingRepositoryRoot(), options = {}) {
  const suites = options.suites || UNLAZY_SUITES;
  const testsRoot = options.testsRoot || root;
  const run = options.run || runWatched;
  const aggregate = { tests: 0, pass: 0, fail: 0, skip: 0 };
  const failedSuites = [];
  for (const suite of suites) {
    const args = [join(testsRoot, suite)];
    if (suite === "mvp-workbench-tests.mjs") args.push(repositoryRoot);
    const result = await run(process.execPath, args, {
      cwd: dirname(testsRoot),
      onOutput: (kind, chunk) => (kind === "stdout" ? process.stdout : process.stderr).write(chunk),
    });
    let counts;
    try { counts = parseSuiteCounts(result.stdout, suite); }
    catch (error) {
      process.stderr.write(`UNLAZY_SUITE_COUNTS_FAILED ${suite}: ${error.message}\n`);
      counts = { tests: 1, pass: 0, fail: 1, skip: 0 };
    }
    for (const key of Object.keys(aggregate)) aggregate[key] += counts[key];
    const red = result.spawnError || result.hung || result.code !== 0 || counts.fail !== 0;
    if (red) {
      process.stderr.write("UNLAZY_SUITE_FAILED " + suite + " exit=" +
        String(result.code ?? (result.hung ? "hung" : result.spawnError ? "spawn" : result.signal)) +
        (result.hung ? " hung: " + result.hungReason : "") + "\n");
      if (!failedSuites.includes(suite)) failedSuites.push(suite);
      // A suite that turned red without a failed test (exit, hang, count record) still counts once.
      if (counts.fail === 0) { aggregate.tests += 1; aggregate.fail += 1; }
    }
  }
  emitTestCounts("full-suite", aggregate);
  if (failedSuites.length) {
    process.stderr.write(`UNLAZY_SUITES_FAILED ${failedSuites.length}/${suites.length}: ${failedSuites.join(", ")}\n`);
    return { ok: false, failedSuite: failedSuites[0], failedSuites, ...aggregate };
  }
  process.stdout.write(`Unlazy full suite: ${suites.length}/${suites.length} phases; ` +
    `${aggregate.tests} tests, ${aggregate.pass} passed, ${aggregate.fail} failed, ${aggregate.skip} skipped\n`);
  process.stdout.write("UNLAZY_FULL_SUITE_OK\n");
  return { ok: true, failedSuite: null, failedSuites: [], ...aggregate };
}

function scriptFiles(directory) {
  const found = [];
  const walk = (current) => {
    if (!existsSync(current)) return;
    for (const entry of readdirSync(current, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name, "en"))) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) { if (entry.name !== "node_modules") walk(full); }
      else if (entry.isFile() && /\.(?:mjs|cjs|js)$/u.test(entry.name)) found.push(full);
    }
  };
  walk(directory);
  return found;
}

// The installed layout: every suite, the count helper and every script exist and parse.
export function runLayoutCheck(options = {}) {
  const testsRoot = options.testsRoot || root;
  const unlazyRoot = dirname(testsRoot);
  const suites = options.suites || UNLAZY_SUITES;
  const files = [
    ...suites.map((suite) => join(testsRoot, suite)),
    join(testsRoot, "helpers", "test-counts.mjs"),
    ...scriptFiles(join(unlazyRoot, "scripts")),
  ];
  const failures = [];
  for (const file of files) {
    const name = relative(unlazyRoot, file).replaceAll("\\", "/");
    if (!existsSync(file)) { failures.push(name + " is missing"); continue; }
    const checked = spawnSync(process.execPath, ["--check", file], { encoding: "utf8", windowsHide: true });
    if (checked.error || checked.status !== 0) {
      failures.push(name + " does not parse: " + String(checked.stderr || checked.error?.message || "").trim().split(/\r?\n/u)[0]);
    }
  }
  for (const failure of failures) process.stderr.write("UNLAZY_LAYOUT_FAILED " + failure + "\n");
  emitTestCounts("full-suite-layout", { tests: files.length, pass: files.length - failures.length, fail: failures.length, skip: 0 });
  if (!failures.length) process.stdout.write(`UNLAZY_LAYOUT_OK ${suites.length} suites, ${files.length} files\n`);
  return { ok: failures.length === 0, failures, files: files.length };
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  const argv = process.argv.slice(2);
  const layoutOnly = argv.includes("--layout-only");
  const positional = argv.filter((value) => value !== "--layout-only");
  if (layoutOnly) {
    if (!runLayoutCheck().ok) process.exitCode = 1;
  } else {
    const result = await runFullSuite(positional[0] ? resolve(positional[0]) : consumingRepositoryRoot());
    if (!result.ok) process.exitCode = 1;
  }
}
