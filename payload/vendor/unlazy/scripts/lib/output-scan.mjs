// Reads a check's captured output from disk instead of from memory.
// Zero dependencies. Node 16+.
//
// The output of a CHECK is no longer held as one string and no longer capped:
// runWatched streams stdout to a file and stderr to a second file. The logical
// output is the same text the old in-memory code built: stdout, then a single
// "\n" when both streams produced bytes, then stderr. This module describes that
// text as a list of segments (files and one literal) and offers the few
// operations the gate runner needs on it, all by streaming blocks:
//  - fingerprintOutput: length and SHA-256 of the whole output;
//  - includesText: substring search that finds a match across block boundaries
//    (each block is searched together with the last needle.length - 1 bytes of
//    the previous one, so no match can fall between two blocks);
//  - readWindows: the first and last bytes, for a short display text only;
//  - decodeSegments: the whole output as a string (used by the regex worker).
// A substring is searched as UTF-8 bytes. For valid UTF-8 this is exactly the
// string search the old code did (UTF-8 is self-synchronizing, so a byte match
// is always a character match).

import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { open } from "node:fs/promises";

export const BLOCK_BYTES = 256 * 1024;
const SEPARATOR = "\n";

function sizeOf(path) {
  try {
    const info = statSync(path);
    return info.isFile() ? info.size : 0;
  } catch { return 0; }
}

// Segments of the logical output: { path, bytes } for a file, { literal } for text.
export function outputSegments(stdoutPath, stderrPath) {
  const segments = [];
  const out = sizeOf(stdoutPath);
  const err = sizeOf(stderrPath);
  if (out > 0) segments.push({ path: stdoutPath, bytes: out });
  if (out > 0 && err > 0) segments.push({ literal: SEPARATOR, bytes: Buffer.byteLength(SEPARATOR) });
  if (err > 0) segments.push({ path: stderrPath, bytes: err });
  return segments;
}

export const segmentsBytes = (segments) => segments.reduce((sum, segment) => sum + segment.bytes, 0);

// Yields the output as Buffers of at most `blockBytes`. A file that vanishes
// mid-read ends that segment; the caller's byte count then no longer matches
// segmentsBytes, which is how a truncated read stays visible.
export async function* readBlocks(segments, blockBytes = BLOCK_BYTES) {
  for (const segment of segments) {
    if (segment.literal !== undefined) {
      yield Buffer.from(segment.literal, "utf8");
      continue;
    }
    let handle;
    try { handle = await open(segment.path, "r"); }
    catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    try {
      for (;;) {
        const buffer = Buffer.allocUnsafe(blockBytes);
        const { bytesRead } = await handle.read(buffer, 0, blockBytes, null);
        if (bytesRead === 0) break;
        yield bytesRead === blockBytes ? buffer : buffer.subarray(0, bytesRead);
      }
    } finally { await handle.close().catch(() => {}); }
  }
}

export async function fingerprintOutput(segments) {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const block of readBlocks(segments)) {
    hash.update(block);
    bytes += block.length;
  }
  return { bytes, sha256: hash.digest("hex") };
}

// True when `needle` occurs anywhere in the output, including across blocks.
export async function includesText(segments, needle, blockBytes = BLOCK_BYTES) {
  const wanted = Buffer.isBuffer(needle) ? needle : Buffer.from(String(needle), "utf8");
  if (wanted.length === 0) return true;
  const keep = wanted.length - 1;
  let carry = Buffer.alloc(0);
  for await (const block of readBlocks(segments, Math.max(blockBytes, wanted.length * 2))) {
    const window = carry.length ? Buffer.concat([carry, block]) : block;
    if (window.indexOf(wanted) !== -1) return true;
    carry = keep > 0 ? Buffer.from(window.subarray(Math.max(0, window.length - keep))) : Buffer.alloc(0);
  }
  return false;
}

// First `headBytes` and last `tailBytes` of the output as text, for messages
// only. When the output is not longer than both together it is returned whole.
export async function readWindows(segments, headBytes = 16 * 1024, tailBytes = 16 * 1024) {
  const total = segmentsBytes(segments);
  if (total === 0) return { text: "", truncated: false };
  const wholeRead = total <= headBytes + tailBytes;
  const head = [];
  let headLength = 0;
  const tail = [];
  let tailLength = 0;
  for await (const block of readBlocks(segments)) {
    if (headLength < headBytes || wholeRead) {
      const take = wholeRead ? block : block.subarray(0, headBytes - headLength);
      head.push(take);
      headLength += take.length;
    }
    if (!wholeRead) {
      tail.push(block);
      tailLength += block.length;
      while (tail.length > 1 && tailLength - tail[0].length >= tailBytes) tailLength -= tail.shift().length;
    }
  }
  if (wholeRead) return { text: Buffer.concat(head).toString("utf8"), truncated: false };
  const lastBytes = Buffer.concat(tail);
  return {
    text: Buffer.concat(head).toString("utf8") + "\n...\n" + lastBytes.subarray(Math.max(0, lastBytes.length - tailBytes)).toString("utf8"),
    truncated: true,
  };
}

// The whole output as one string (synchronous; for the regex worker, where the
// text is needed in one piece). Throws when it exceeds the V8 string limit.
export function decodeSegments(segments) {
  const parts = [];
  for (const segment of segments) {
    if (segment.literal !== undefined) parts.push(Buffer.from(segment.literal, "utf8"));
    else parts.push(readFileSync(segment.path));
  }
  return Buffer.concat(parts).toString("utf8");
}
