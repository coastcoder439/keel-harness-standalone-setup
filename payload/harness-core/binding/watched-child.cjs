"use strict";

// Child programs of the Harness that used to end at a fixed time (P15, C13): they run through the Unlazy silence
// watcher (vendor/unlazy/scripts/lib/silence-watch.mjs) instead. There is no total duration and no output cap; a
// child is declared hung only when it wrote nothing for KEEL_SILENCE_MS AND its process tree did no work (CPU,
// I/O counters, tree membership), see the header of that file.
//
// The watcher is an ES module and the callers are both CommonJS (package-amend, package-bootstrap) and ES modules,
// so it is imported lazily, per call, from the located Unlazy tree: an explicit/located Unlazy root first, then the
// runtime that ships next to this Harness tree. A tree without the module is an installation error, never a reason
// to fall back to a fixed time. Nothing is loaded by merely requiring this file (the hooks load neighbours of
// it and must stay light).
//
// The result has the shape of the former spawnSync call (status, signal, stdout, stderr, error) plus
// { hung, hungReason }: a hung child has status null and hung true, so a caller that only reads status still
// treats it as a failure, and hungMessage() gives the reason.

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const unlazyRuntime = require("./unlazy-runtime.cjs");

const modules = new Map();

function candidateFiles(unlazyRoot) {
  const roots = [];
  if (unlazyRoot) roots.push(path.resolve(String(unlazyRoot)));
  const own = unlazyRuntime.harnessRuntime();
  if (own) roots.push(own);
  return [...new Set(roots)].map((root) => path.join(root, "scripts", "lib", "silence-watch.mjs"));
}

function fail(message) {
  const error = new Error(message);
  error.code = "SILENCE_WATCH_MISSING";
  throw error;
}

async function loadSilenceWatch(unlazyRoot) {
  const files = candidateFiles(unlazyRoot);
  const file = files.find((candidate) => fs.existsSync(candidate));
  if (!file) fail("silence-watch.mjs not found (the Unlazy silence watcher must ship with the Harness; update it): " + files.join(", "));
  const key = fs.realpathSync(file);
  if (modules.has(key)) return modules.get(key);
  const loaded = await import(pathToFileURL(key).href);
  if (typeof loaded.runWatched !== "function") fail("silence-watch.mjs exports no runWatched: " + key);
  modules.set(key, loaded);
  return loaded;
}

// options: cwd, env (the COMPLETE environment of the child, default process.env: a caller that removes keys must
// not get them back), input, unlazyRoot (where silence-watch.mjs is looked for first), silenceMs/sampleMs (tests;
// otherwise KEEL_SILENCE_MS / KEEL_SILENCE_SAMPLE_MS from env decide).
async function runWatchedChild(command, args, options = {}) {
  const watch = await loadSilenceWatch(options.unlazyRoot);
  const result = await watch.runWatched(command, args, {
    ...(options.cwd ? { cwd: options.cwd } : {}),
    env: options.env || process.env,
    ...(options.shell === true ? { shell: true } : {}),
    ...(options.input !== undefined ? { input: options.input } : {}),
    ...(options.silenceMs !== undefined ? { silenceMs: options.silenceMs } : {}),
    ...(options.sampleMs !== undefined ? { sampleMs: options.sampleMs } : {}),
  });
  return {
    status: result.hung ? null : result.code,
    signal: result.signal,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    error: result.spawnError ? new Error(String(result.spawnError)) : null,
    hung: result.hung === true,
    hungReason: result.hungReason || null,
    durationMs: result.durationMs,
  };
}

// "<label> hung: <why>; it was stopped for silence, not for taking long" - one sentence for a failure message.
function hungMessage(label, result) {
  return label + " hung: " + (result.hungReason || "no output and no work") + "; it was stopped as hung, not for taking long";
}

module.exports = { hungMessage, loadSilenceWatch, runWatchedChild };
