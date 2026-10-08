import { parentPort } from "node:worker_threads";
import { decodeSegments } from "./output-scan.mjs";

// Two steps, so the caller can start its match budget when the work really
// starts and not while a large output file is still being read:
//  1. { source, flags, segments }  -> the worker reads the output from disk and
//     answers { ready: true } (or { error });
//  2. { go: true }                 -> the worker matches and answers { matched }.
// { source, flags, output } (the text itself) is still accepted and matches at once.
let regex = null;
let subject = "";

parentPort.on("message", (message) => {
  try {
    if (message && message.go === true) {
      parentPort.postMessage({ matched: regex.test(subject) });
      return;
    }
    const { source, flags, segments, output } = message;
    regex = new RegExp(source, flags);
    if (Array.isArray(segments)) {
      subject = decodeSegments(segments);
      parentPort.postMessage({ ready: true });
    } else {
      subject = String(output);
      parentPort.postMessage({ matched: regex.test(subject) });
    }
  } catch (error) {
    parentPort.postMessage({ error: error.message });
  }
});
