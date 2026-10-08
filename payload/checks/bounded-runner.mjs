#!/usr/bin/env node
// Observable child-process runner under the silence watcher. Node 18+, zero dependencies.

import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const printable = (value) => String(value).replace(/[\x00-\x1f\x7f]/gu,
  (character) => `\\x${character.charCodeAt(0).toString(16).padStart(2, "0")}`);
const quote = (value) => /[\s"]/u.test(printable(value))
  ? '"' + printable(value).replaceAll('"', '\\"') + '"'
  : printable(value);

const childExited = (child) => child.exitCode !== null && child.exitCode !== undefined ||
  child.signalCode !== null && child.signalCode !== undefined;

function syncFailure(result) {
  if (!result) return "taskkill returned no result";
  if (result.error) return result.error.code || result.error.message || "taskkill spawn error";
  if (result.signal) return "taskkill signal " + result.signal;
  if (result.status !== 0) {
    const detail = (String(result.stdout || "") + " " + String(result.stderr || ""))
      .replace(/[\r\n\t]+/gu, " ").replace(/\s+/gu, " ").trim().slice(0, 300);
    return `taskkill exit ${String(result.status)}${detail ? `: ${detail}` : ""}`;
  }
  return null;
}

export function terminateTree(child, options = {}) {
  const platform = options.platform || process.platform;
  const spawnSyncImpl = options.spawnSyncImpl || spawnSync;
  const existsSyncImpl = options.existsSyncImpl || existsSync;
  if (!Number.isInteger(child?.pid) || child.pid <= 0) {
    return { ok: false, fallback: false, diagnostic: "child PID is unavailable" };
  }
  if (childExited(child)) return { ok: true, fallback: false, diagnostic: "child already exited" };

  if (platform !== "win32") {
    try {
      const requested = child.kill("SIGKILL");
      return requested === false
        ? { ok: false, fallback: false, diagnostic: "child kill returned false" }
        : { ok: true, fallback: false, diagnostic: null };
    } catch (error) {
      return { ok: false, fallback: false, diagnostic: "child kill failed: " + (error.code || error.message) };
    }
  }

  const systemRoot = options.env?.SystemRoot || options.env?.WINDIR ||
    process.env.SystemRoot || process.env.WINDIR || "C:\\Windows";
  const taskkill = options.taskkillPath || join(systemRoot, "System32", "taskkill.exe");
  let failure = null;
  if (!existsSyncImpl(taskkill)) failure = "trusted taskkill executable is unavailable";
  else {
    try {
      failure = syncFailure(spawnSyncImpl(taskkill, ["/PID", String(child.pid), "/T", "/F"], {
        encoding: "utf8",
        windowsHide: true,
        timeout: 10_000,
      }));
    } catch (error) {
      failure = error.code || error.message || "taskkill threw";
    }
  }
  if (!failure) return { ok: true, fallback: false, diagnostic: null, command: taskkill };
  if (childExited(child)) {
    return { ok: true, fallback: true, diagnostic: `${failure}; child already exited`, command: taskkill };
  }
  try {
    const requested = child.kill("SIGKILL");
    if (requested === false) {
      return { ok: false, fallback: true, diagnostic: `${failure}; child fallback returned false`, command: taskkill };
    }
    return { ok: true, fallback: true, diagnostic: `${failure}; child fallback requested`, command: taskkill };
  } catch (error) {
    return {
      ok: false,
      fallback: true,
      diagnostic: `${failure}; child fallback failed: ${error.code || error.message}`,
      command: taskkill,
    };
  }
}

// The silence watcher of the vendored Unlazy (P01). Source layout: test-harness/checks ->
// ../../vendor/unlazy; installed layout: <harness>/checks -> ../vendor/unlazy. Loaded lazily, so a
// caller that only uses terminateTree never needs it. Without it no phase runs: there is no
// fallback onto a fixed time.
const here = dirname(fileURLToPath(import.meta.url));
export const SILENCE_WATCH_CANDIDATES = Object.freeze([
  join(here, "..", "..", "vendor", "unlazy", "scripts", "lib", "silence-watch.mjs"),
  join(here, "..", "vendor", "unlazy", "scripts", "lib", "silence-watch.mjs"),
]);
let silenceWatch = null;

export async function loadSilenceWatch(candidates = SILENCE_WATCH_CANDIDATES) {
  const standard = candidates === SILENCE_WATCH_CANDIDATES;
  if (standard && silenceWatch) return silenceWatch;
  const file = candidates.find((candidate) => existsSync(candidate));
  if (!file) throw new Error("silence watcher (vendor/unlazy/scripts/lib/silence-watch.mjs) not found: " + candidates.join(", "));
  const module = await import(pathToFileURL(file).href);
  if (typeof module.runWatched !== "function") throw new Error("silence-watch.mjs exports no runWatched: " + file);
  if (standard) silenceWatch = module;
  return module;
}

// Runs one child under the silence watcher (B9, P9): no total duration and no timeout. A child
// that writes output or computes runs as long as it needs; only a child that is silent AND idle
// for KEEL_SILENCE_MS (default 30 minutes; spec.silenceMs for tests) is declared hung and its
// tree is ended. Heartbeat and the passing-through of the output stay. A spec.timeoutMs of an
// older caller is ignored.
// Result: exitCode (the child's code; 124 hung; 125 spawn or watcher error; 126 hung and the
// tree termination was not confirmed), hung, hungReason, stdout, stderr. timedOut and
// drainTimedOut stay in the shape for older readers and are always false.
export async function runBounded(spec, dependencies = {}) {
  const heartbeatMs = Number(spec.heartbeatMs || 10_000);
  if (!spec.command || !Array.isArray(spec.args)) throw new Error("runBounded requires command and args");
  if (!Number.isFinite(heartbeatMs) || heartbeatMs < 1_000) throw new Error("heartbeatMs must be at least 1000");
  const quiet = spec.quiet === true;
  const out = (text) => { if (!quiet) process.stdout.write(text); };
  const err = (text) => { if (!quiet) process.stderr.write(text); };

  const startedAt = Date.now();
  const rendered = [spec.command, ...spec.args].map(quote).join(" ");
  const label = spec.name || rendered;
  const cwd = spec.cwd || process.cwd();
  out(`[START] ${label}\n  cwd: ${cwd}\n  cmd: ${rendered}\n`);
  const base = {
    name: label, command: rendered, cwd, signal: null, timedOut: false, drainTimedOut: false,
    cleanupAttempted: false, cleanupFailed: false, cleanupFallback: false, cleanupDiagnostic: null,
  };
  const spawnFailure = (message, stdout = "", stderr = "") => {
    const durationMs = Date.now() - startedAt;
    err(`[SPAWN-ERROR] ${message}\n`);
    out(`[END] ${label} exit=125 durationMs=${durationMs}\n`);
    return { ...base, exitCode: 125, childExitCode: null, durationMs, hung: false, hungReason: null,
      stdout, stderr: stderr + message };
  };
  let watch;
  try { watch = dependencies.runWatched || (await loadSilenceWatch()).runWatched; }
  catch (error) { return spawnFailure(error.message); }

  const heartbeat = setInterval(() => {
    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    out(`[HEARTBEAT] ${label} elapsed=${elapsed}s state=running\n`);
  }, heartbeatMs);
  heartbeat.unref();
  let result;
  try {
    result = await watch(spec.command, spec.args, {
      cwd,
      env: spec.env || process.env,
      ...(spec.silenceMs !== undefined ? { silenceMs: spec.silenceMs } : {}),
      ...(spec.sampleMs !== undefined ? { sampleMs: spec.sampleMs } : {}),
      ...(dependencies.terminateTree ? { terminateTree: dependencies.terminateTree } : {}),
      ...(dependencies.cpuProbe ? { cpuProbe: dependencies.cpuProbe } : {}),
      ...(dependencies.listProcesses ? { listProcesses: dependencies.listProcesses } : {}),
      ...(typeof spec.onSpawn === "function" ? { onSpawn: spec.onSpawn } : {}),
      onOutput: (kind, chunk) => (kind === "stdout" ? out : err)(String(chunk)),
    });
  } catch (error) {
    clearInterval(heartbeat);
    return spawnFailure(error.message);
  }
  clearInterval(heartbeat);
  if (result.spawnError && result.code === null && result.signal === null && !result.hung) {
    return spawnFailure(result.spawnError, result.stdout || "", result.stderr || "");
  }
  const durationMs = Date.now() - startedAt;
  const hung = result.hung === true;
  const cleanupFailed = hung && /termination not confirmed/u.test(String(result.hungReason || ""));
  let stderr = result.stderr || "";
  if (hung) {
    const message = `[HUNG] ${label}: ${result.hungReason}\n`;
    stderr += message;
    err(message);
    if (cleanupFailed) {
      const cleanup = `[TREE-CLEANUP-FAILED] ${result.hungReason}\n`;
      stderr += cleanup;
      err(cleanup);
    }
  }
  const status = cleanupFailed ? 126 : hung ? 124 : Number.isInteger(result.code) ? result.code : 125;
  out(`[END] ${label} exit=${status} durationMs=${durationMs}${hung ? " hung=true" : ""}` +
    `${cleanupFailed ? " cleanupFailed=true" : ""}\n`);
  return {
    ...base,
    exitCode: status,
    childExitCode: Number.isInteger(result.code) ? result.code : null,
    signal: result.signal || null,
    durationMs,
    hung,
    hungReason: result.hungReason || null,
    cleanupAttempted: hung,
    cleanupFailed,
    cleanupDiagnostic: cleanupFailed ? result.hungReason : null,
    stdout: result.stdout || "",
    stderr,
  };
}

async function main() {
  const argv = process.argv.slice(2);
  let heartbeatMs = 10_000;
  while (argv.length && argv[0] !== "--") {
    const option = argv.shift();
    if (option === "--timeout-ms") {
      argv.shift();
      process.stderr.write("bounded-runner: --timeout-ms is ignored; a run ends only when it is hung " +
        "(no output and no CPU for KEEL_SILENCE_MS)\n");
    } else if (option === "--heartbeat-ms") heartbeatMs = Number(argv.shift());
    else throw new Error("unknown option " + option);
  }
  if (argv.shift() !== "--" || !argv.length) {
    throw new Error("usage: bounded-runner.mjs [--heartbeat-ms N] -- COMMAND [ARG ...]");
  }
  const command = argv.shift();
  const result = await runBounded({ command, args: argv, heartbeatMs });
  process.exitCode = result.exitCode;
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error("bounded-runner: " + error.message);
    process.exitCode = 125;
  });
}
