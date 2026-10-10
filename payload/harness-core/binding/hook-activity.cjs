"use strict";

// Hook activity of a planning session (P4 D15). A planning binding (.unlazy/.bootstrap/<sha256>.json)
// may move to another session id by hand only when the holder has been silent for silenceMs. Nothing
// else records that a session is alive, so every hook of the session touches its record at its entry
// (noteHookInput: prompt-form and the Stop hook unlazy-stop): the time of the
// last touch is the modification time of the record file. utimes never creates a file, so a hook of
// an old session cannot bring a taken-over record back; an unreadable or missing record is no activity
// and never an error. The module needs nothing but the standard library and hook-context.cjs, so the
// hooks can load it for free.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

// A touch more often than this adds no information; it only costs a write per tool call.
const TOUCH_INTERVAL_MS = 15_000;

// How long a holder may be silent before its planning binding can be taken over by hand. The rule of
// silenceMs() in vendor/unlazy/scripts/lib/silence-watch.mjs (KEEL_SILENCE_MS, default 30 minutes, at least
// one second), repeated here because this module is CommonJS and loaded by synchronous hooks; the test
// "the silence limit of the takeover is the one of the silence watcher" holds both to the same answer.
const DEFAULT_SILENCE_MS = 30 * 60 * 1000;
const MIN_SILENCE_MS = 1000;

function silenceLimitMs(env = process.env) {
  const text = String(env && env.KEEL_SILENCE_MS === undefined ? "" : env.KEEL_SILENCE_MS).trim();
  const value = /^\d+$/u.test(text) ? Number(text) : null;
  return value !== null && Number.isSafeInteger(value) && value >= MIN_SILENCE_MS ? value : DEFAULT_SILENCE_MS;
}

function recordFile(harnessRoot, sessionId) {
  const session = String(sessionId || "").trim();
  if (!harnessRoot || !session || session.length > 256 || /[\0\r\n]/u.test(session)) return null;
  const key = crypto.createHash("sha256").update(session).digest("hex") + ".json";
  return path.join(path.resolve(String(harnessRoot)), ".unlazy", ".bootstrap", key);
}

// The orchestrator record of the session (.unlazy/.orchestrators/<sha256>.json, orchestrator-role.mjs). The hooks touch it
// like the planning record, so a package's orchestrator shows signs of life after its planning binding ended (Nachpruefung
// 07.10.2026: orchestrator-takeover waits for silenceMs like a planning takeover).
function orchestratorRecordFile(harnessRoot, sessionId) {
  const file = recordFile(harnessRoot, sessionId);
  return file ? path.join(path.dirname(path.dirname(file)), ".orchestrators", path.basename(file)) : null;
}

function touch(file, options) {
  try {
    if (!file) return false;
    const info = fs.lstatSync(file);
    if (!info.isFile() || info.isSymbolicLink()) return false;
    const now = options.now === undefined ? Date.now() : options.now;
    if (now - info.mtimeMs < (options.intervalMs === undefined ? TOUCH_INTERVAL_MS : options.intervalMs)) return false;
    fs.utimesSync(file, now / 1000, now / 1000);
    return true;
  } catch {
    return false;
  }
}

// Marks the planning record and the orchestrator record of the session as active now. Returns true when it wrote the
// time of the planning record (the orchestrator record is touched beside it and never decides the answer).
function noteHookActivity(harnessRoot, sessionId, options = {}) {
  try {
    touch(orchestratorRecordFile(harnessRoot, sessionId), options);
    return touch(recordFile(harnessRoot, sessionId), options);
  } catch {
    return false;
  }
}

// The entry of every hook: the rule root and the session of the hook input, as the hooks read them. Never
// throws and never decides anything; a session without planning and orchestrator record costs two lstat calls.
function noteHookInput(payload, env = process.env, options = {}) {
  try {
    const hookContext = require("../guards/hook-context.cjs");
    return noteHookActivity(hookContext.ruleRoot(env), hookContext.hookSession(payload, env), options);
  } catch {
    return false;
  }
}

// Milliseconds since the last hook activity of a record file; Infinity when it cannot be read.
function silentForMs(file, now = Date.now()) {
  try {
    const info = fs.lstatSync(file);
    if (!info.isFile() || info.isSymbolicLink()) return Infinity;
    return Math.max(0, now - info.mtimeMs);
  } catch {
    return Infinity;
  }
}

// Milliseconds since the last sign of life of a session: the younger of its planning and its orchestrator record;
// Infinity when it has neither.
function sessionSilentForMs(harnessRoot, sessionId, now = Date.now()) {
  return Math.min(silentForMs(recordFile(harnessRoot, sessionId), now), silentForMs(orchestratorRecordFile(harnessRoot, sessionId), now));
}

module.exports = { DEFAULT_SILENCE_MS, TOUCH_INTERVAL_MS, noteHookActivity, noteHookInput, orchestratorRecordFile, recordFile,
  sessionSilentForMs, silenceLimitMs, silentForMs };
