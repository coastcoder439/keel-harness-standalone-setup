#!/usr/bin/env node
// Rename retry on transient Windows locks (package-lifecycle renameWithRetry). Node 16+.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { renameWithRetry } from "../scripts/lib/package-lifecycle.mjs";
import { emitTestCounts } from "./helpers/test-counts.mjs";

function lockError(code) {
  const error = new Error(code + ": operation not permitted, rename");
  error.code = code;
  return error;
}

function harness(failures) {
  const calls = [];
  const waits = [];
  const queue = [...failures];
  const rename = (from, to) => {
    calls.push([from, to]);
    if (queue.length) throw queue.shift();
  };
  return { calls, waits, options: (platform) => ({ rename, sleep: (ms) => waits.push(ms), platform }) };
}

const tests = [];
const test = (name, optionsOrFn, maybeFn) => {
  const fn = typeof optionsOrFn === "function" ? optionsOrFn : maybeFn;
  const skip = typeof optionsOrFn === "object" && optionsOrFn.skip === true;
  tests.push({ name, fn, skip });
};

test("[gaps3] two EPERM then success renames after three attempts", () => {
  const h = harness([lockError("EPERM"), lockError("EPERM")]);
  renameWithRetry("a", "b", h.options("win32"));
  assert.equal(h.calls.length, 3);
  assert.deepEqual(h.waits, [50, 100]);
});

test("[gaps3] persistent EPERM returns the original error after six attempts", () => {
  const errors = Array.from({ length: 10 }, () => lockError("EPERM"));
  const h = harness(errors);
  assert.throws(() => renameWithRetry("a", "b", h.options("win32")), (error) => error === errors[5]);
  assert.equal(h.calls.length, 6);
  assert.deepEqual(h.waits, [50, 100, 200, 400, 800]);
});

test("[gaps3] EBUSY and EACCES are retried on win32", () => {
  for (const code of ["EBUSY", "EACCES"]) {
    const h = harness([lockError(code)]);
    renameWithRetry("a", "b", h.options("win32"));
    assert.equal(h.calls.length, 2, code);
  }
});

test("[gaps3] ENOENT is not retried", () => {
  const error = lockError("ENOENT");
  const h = harness([error]);
  assert.throws(() => renameWithRetry("a", "b", h.options("win32")), (thrown) => thrown === error);
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.waits, []);
});

test("[gaps3] platform linux does not retry", () => {
  const error = lockError("EPERM");
  const h = harness([error]);
  assert.throws(() => renameWithRetry("a", "b", h.options("linux")), (thrown) => thrown === error);
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.waits, []);
});

// ---- P15, E4d: every directory rename of the package tools goes through renameWithRetry ----------------------------------------

const scripts = fileURLToPath(new URL("../scripts/", import.meta.url));

test("package-cli create and the migration cutover use renameWithRetry, not a bare renameSync", () => {
  for (const file of ["package-cli.mjs", "lib/package-migration.mjs"]) {
    const source = readFileSync(join(scripts, file), "utf8");
    assert.doesNotMatch(source, /\brenameSync\b/u, file + " still renames with a bare renameSync");
    assert.match(source, /renameWithRetry\(/u, file);
  }
});

// A preload that makes the first two renames of a DIRECTORY fail with EPERM (a scanner holding the fresh directory) and says how
// often it did. Windows only: that is where the retry applies and where the lock exists.
test("package-cli create survives two EPERM on the cutover rename of its new bundle directory (Windows)", { skip: process.platform !== "win32" }, () => {
  const work = mkdtempSync(join(tmpdir(), "unlazy-rename-"));
  try {
    const preload = join(work, "preload.mjs");
    writeFileSync(preload, `import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const real = fs.renameSync;
let refused = 0;
fs.renameSync = (from, to) => {
  let directory = false;
  try { directory = fs.statSync(from).isDirectory(); } catch { /* the real call reports it */ }
  if (directory && refused < 2) { refused += 1; throw Object.assign(new Error("EPERM: operation not permitted, rename"), { code: "EPERM" }); }
  return real(from, to);
};
syncBuiltinESMExports();
process.on("exit", () => process.stderr.write("DIRECTORY_RENAMES_REFUSED=" + refused + "\\n"));
`);
    const repo = join(work, "repo");
    spawnSync("git", ["init", "-q", repo], { encoding: "utf8", windowsHide: true });
    const result = spawnSync(process.execPath, ["--import", "file:///" + preload.replaceAll("\\", "/"), join(scripts, "package-cli.mjs"), "create", "--package", "retry",
      "--root", repo, "--owner-request", "Ein Testauftrag mit genug Text fuer den Eigentuemer.", "--json"], { encoding: "utf8", windowsHide: true });
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.match(result.stderr, /DIRECTORY_RENAMES_REFUSED=2/u);
    assert.equal(existsSync(join(repo, "docs", "packages", "retry", "PACKAGE.md")), true);
  } finally { rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});

let passed = 0;
let skipped = 0;
for (const { name, fn, skip } of tests) {
  if (skip) { skipped += 1; console.log("skip " + name); continue; }
  try {
    await fn();
    passed += 1;
    console.log("ok   " + name);
  } catch (error) {
    console.error("FAIL " + name);
    console.error("     " + (error.stack || error.message));
    process.exitCode = 1;
  }
}

emitTestCounts("rename-retry-tests", {
  tests: tests.length, pass: passed, fail: tests.length - passed - skipped, skip: skipped,
});
if (!process.exitCode) console.log(`\n${passed}/${tests.length} passed, ${skipped} skipped`);
