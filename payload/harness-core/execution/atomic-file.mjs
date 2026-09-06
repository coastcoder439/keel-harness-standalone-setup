// Bounded atomic replacement for execution state. Windows scanners and indexers
// can hold the destination briefly; retry only those transient rename failures.

import fs from "node:fs";
import process from "node:process";

const TRANSIENT_RENAME = new Set(["EACCES", "EBUSY", "EPERM"]);
const sleepCell = new Int32Array(new SharedArrayBuffer(4));

function wait(milliseconds) {
  Atomics.wait(sleepCell, 0, 0, milliseconds);
}

export function replaceFileSync(source, target, options = {}) {
  const renameSync = options.renameSync || fs.renameSync;
  const pause = options.wait || wait;
  const platform = options.platform || process.platform;
  const maxAttempts = options.maxAttempts || (platform === "win32" ? 12 : 1);
  let delay = 10;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      renameSync(source, target);
      return;
    } catch (error) {
      if (attempt === maxAttempts || !TRANSIENT_RENAME.has(error?.code)) throw error;
      pause(delay);
      delay = Math.min(delay * 2, 250);
    }
  }
}
