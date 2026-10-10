"use strict";

// The one rename-with-retry of the Harness tree (P15, E4d). A short-lived handle of another process (virus
// scanner, indexer, file watcher) makes a Windows rename fail with EPERM/EBUSY/EACCES. Retry up to 6 attempts,
// then rethrow the original error; other codes and platforms fail at once.
// node:fs only, so the hooks that load runtime-scopes.cjs can use it without pulling in anything else.
// package-bootstrap.cjs re-exports it; there is no second copy in harness-core (the Unlazy tree keeps its own
// in scripts/lib/package-lifecycle.mjs because the vendored tree must not depend on the Harness).

const fs = require("node:fs");

const RENAME_RETRY_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);
const RENAME_RETRY_WAITS = Object.freeze([50, 100, 200, 400, 800]);

function sleepSync(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function renameWithRetry(from, to, { rename = fs.renameSync, sleep = sleepSync, platform = process.platform } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try { return rename(from, to); }
    catch (error) {
      if (platform !== "win32" || !RENAME_RETRY_CODES.has(error && error.code) || attempt >= RENAME_RETRY_WAITS.length) throw error;
      sleep(RENAME_RETRY_WAITS[attempt]);
    }
  }
}

module.exports = { RENAME_RETRY_CODES, RENAME_RETRY_WAITS, renameWithRetry };
