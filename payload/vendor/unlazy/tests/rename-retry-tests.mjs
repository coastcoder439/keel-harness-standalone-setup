#!/usr/bin/env node
// Rename retry on transient Windows locks (package-lifecycle renameWithRetry). Node 16+.

import assert from "node:assert/strict";
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
const test = (name, fn) => tests.push({ name, fn });

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

let passed = 0;
for (const { name, fn } of tests) {
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
  tests: tests.length, pass: passed, fail: tests.length - passed, skip: 0,
});
if (!process.exitCode) console.log(`\n${passed}/${tests.length} passed, 0 skipped`);
