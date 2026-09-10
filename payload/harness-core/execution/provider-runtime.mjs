#!/usr/bin/env node

// Durable adapter between package dispatch state and Claude Code's native
// stream-json protocol. The adapter never accepts caller-supplied provider
// handles: a handle is recorded only after Claude emits session_id itself.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { replaceFileSync } from "./atomic-file.mjs";
import { CODEX_MODEL, CODEX_EFFORT } from "./codex-pin.mjs";

const hereFile = fileURLToPath(import.meta.url);
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const ACTIVE = new Set(["queued", "starting", "running", "abort-requested", "timeout-requested"]);
const TERMINAL = new Set(["provider-start-failed", "provider-returned", "provider-failed", "aborted", "timed-out", "vanished"]);
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;

function runtimeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function identifier(value, label) {
  const text = String(value || "");
  if (!IDENTIFIER.test(text)) throw runtimeError("PROVIDER_RUNTIME_INPUT", label + " is invalid");
  return text;
}

function boundedInteger(value, label, minimum, maximum) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw runtimeError("PROVIDER_RUNTIME_INPUT", label + " must be an integer from " + minimum + " to " + maximum);
  }
  return number;
}

function safeLine(value, label, maximum = 1_000) {
  const text = String(value || "").trim();
  if (!text || text.length > maximum || /[\0\r\n]/u.test(text)) {
    throw runtimeError("PROVIDER_RUNTIME_INPUT", label + " must be one printable line of at most " + maximum + " characters");
  }
  return text;
}

function sha256(value) {
  return "sha256:" + crypto.createHash("sha256").update(value).digest("hex");
}

function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = file + "." + process.pid + "." + crypto.randomBytes(8).toString("hex") + ".tmp";
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
  try { replaceFileSync(temporary, file); }
  finally { try { fs.unlinkSync(temporary); } catch { /* renamed or absent */ } }
}

function runDirectory(repoRoot, scope, runId) {
  identifier(scope, "scope");
  if (!RUN_ID.test(String(runId || ""))) throw runtimeError("PROVIDER_RUNTIME_INPUT", "runId is invalid");
  return path.join(path.resolve(repoRoot), ".unlazy", scope, "executor", "runs", runId);
}

export function providerRunPath(repoRoot, scope, runId) {
  return path.join(runDirectory(repoRoot, scope, runId), "state.json");
}

function manifestPath(repoRoot, scope, runId) {
  return path.join(runDirectory(repoRoot, scope, runId), "manifest.json");
}

function controlPath(repoRoot, scope, runId) {
  return path.join(runDirectory(repoRoot, scope, runId), "control.json");
}

function validateRun(value, expected = {}) {
  if (!value || value.schemaVersion !== 1 || !RUN_ID.test(String(value.runId || "")) ||
      !IDENTIFIER.test(String(value.packageId || "")) || !IDENTIFIER.test(String(value.scope || "")) ||
      !IDENTIFIER.test(String(value.leaf || "")) || !["claude", "codex"].includes(value.provider) ||
      (!ACTIVE.has(value.state) && !TERMINAL.has(value.state))) {
    throw runtimeError("PROVIDER_RUN_INVALID", "provider run state has an invalid shape");
  }
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (expectedValue !== undefined && value[key] !== expectedValue) {
      throw runtimeError("PROVIDER_RUN_IDENTITY", "provider run " + key + " does not match its package session");
    }
  }
  if (value.nativeHandle !== null && value.nativeHandle !== undefined) safeLine(value.nativeHandle, "native handle", 256);
  if (!Number.isFinite(Date.parse(value.createdAt)) || !Number.isFinite(Date.parse(value.deadlineAt)) ||
      !Number.isFinite(Date.parse(value.lastHeartbeatAt))) {
    throw runtimeError("PROVIDER_RUN_INVALID", "provider run timestamps are invalid");
  }
  return value;
}

function readJson(file, label) {
  let value;
  try { value = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) { throw runtimeError("PROVIDER_RUN_INVALID", label + " is invalid JSON: " + error.message); }
  return value;
}

export function readProviderRun(repoRoot, scope, runId, expected = {}) {
  const file = providerRunPath(repoRoot, scope, runId);
  if (!fs.existsSync(file)) throw runtimeError("PROVIDER_RUN_MISSING", "provider run does not exist: " + runId);
  const info = fs.lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink() || (typeof info.nlink === "number" && info.nlink !== 1)) {
    throw runtimeError("PROVIDER_RUN_INVALID", "provider run state must be one regular file");
  }
  return validateRun(readJson(file, "provider run state"), { runId, scope, ...expected });
}

function writeRun(repoRoot, scope, runId, transform) {
  const current = readProviderRun(repoRoot, scope, runId);
  const next = transform({ ...current });
  validateRun(next, { runId, scope });
  atomicJson(providerRunPath(repoRoot, scope, runId), next);
  return next;
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === "EPERM"; }
}

function terminalFailure(run) {
  const error = runtimeError("PROVIDER_START_FAILED", run.failure?.message || "provider did not emit a native session handle");
  error.run = run;
  return error;
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function launchProviderRun(options) {
  const repoRoot = fs.realpathSync(path.resolve(options.repoRoot));
  const scope = identifier(options.scope, "scope");
  const packageId = identifier(options.packageId, "packageId");
  const sessionId = safeLine(options.sessionId, "sessionId", 256);
  const leaf = identifier(options.leaf, "leaf");
  const provider = String(options.provider || "");
  if (!new Set(["claude", "codex"]).has(provider)) throw runtimeError("PROVIDER_RUNTIME_INPUT", "provider must be claude or codex");
  const briefFile = fs.realpathSync(path.resolve(options.briefFile));
  const relativeBrief = path.relative(repoRoot, briefFile);
  if (!relativeBrief || relativeBrief.startsWith(".." + path.sep) || path.isAbsolute(relativeBrief)) {
    throw runtimeError("PROVIDER_RUNTIME_INPUT", "briefFile must be inside the package repository");
  }
  const deadlineSeconds = boundedInteger(options.deadlineSeconds ?? 900, "deadlineSeconds", 1, 86_400);
  const startTimeoutSeconds = boundedInteger(options.startTimeoutSeconds ?? 30, "startTimeoutSeconds", 1, 300);
  const maxTurns = boundedInteger(options.maxTurns ?? 32, "maxTurns", 1, 128);
  const executable = safeLine(options.claudeExecutable || "claude", "Claude executable", 2_000);
  const prefixArgs = Array.isArray(options.claudePrefixArgs) ? options.claudePrefixArgs.map((item) => safeLine(item, "Claude prefix argument", 2_000)) : [];
  const runId = crypto.randomUUID();
  const directory = runDirectory(repoRoot, scope, runId);
  fs.mkdirSync(path.dirname(directory), { recursive: true });
  fs.mkdirSync(directory, { recursive: false });
  const createdAt = new Date().toISOString();
  const deadlineAt = new Date(Date.now() + deadlineSeconds * 1_000).toISOString();
  const manifest = {
    schemaVersion: 1,
    runId,
    repoRoot,
    packageId,
    scope,
    sessionId,
    leaf,
    provider,
    briefFile,
    executable,
    prefixArgs,
    maxTurns,
    deadlineAt,
    model: provider === "codex" ? CODEX_MODEL : null,
    effort: provider === "codex" ? CODEX_EFFORT : null,
    permissionMode: "bypassPermissions",
  };
  atomicJson(manifestPath(repoRoot, scope, runId), manifest);
  atomicJson(providerRunPath(repoRoot, scope, runId), {
    schemaVersion: 1,
    runId,
    packageId,
    scope,
    sessionId,
    leaf,
    provider,
    state: "queued",
    nativeHandle: null,
    workerPid: null,
    providerPid: null,
    attempt: boundedInteger(options.attempt ?? 1, "attempt", 1, 1_000),
    createdAt,
    deadlineAt,
    lastHeartbeatAt: createdAt,
    providerOutputEvidence: false,
  });

  let worker;
  try {
    worker = spawn(process.execPath, [hereFile, "worker", "--manifest", manifestPath(repoRoot, scope, runId)], {
      cwd: repoRoot,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      env: { ...process.env, UNLAZY_PACKAGE: packageId, UNLAZY_SCOPE: scope, KEEL_PACKAGE_SESSION: sessionId },
    });
    worker.unref();
  } catch (error) {
    writeRun(repoRoot, scope, runId, (run) => ({ ...run, state: "provider-start-failed",
      failure: { code: "WORKER_SPAWN", message: error.message }, finishedAt: new Date().toISOString() }));
    throw terminalFailure(readProviderRun(repoRoot, scope, runId));
  }

  const startDeadline = Date.now() + startTimeoutSeconds * 1_000;
  while (Date.now() < startDeadline) {
    const run = readProviderRun(repoRoot, scope, runId);
    if ((run.state === "running" || run.state === "provider-returned") && run.nativeHandle) return run;
    if (TERMINAL.has(run.state)) throw terminalFailure(run);
    await delay(50);
  }
  await requestProviderStop({ repoRoot, scope, runId, action: "timeout", reason: "native handle start deadline expired" });
  const run = readProviderRun(repoRoot, scope, runId);
  const error = runtimeError("PROVIDER_START_TIMEOUT", "provider emitted no native session handle within " + startTimeoutSeconds + " seconds");
  error.run = run;
  throw error;
}

export async function requestProviderStop(options) {
  const run = readProviderRun(options.repoRoot, options.scope, options.runId);
  if (TERMINAL.has(run.state)) return run;
  const action = String(options.action || "");
  if (!new Set(["abort", "timeout"]).has(action)) throw runtimeError("PROVIDER_RUNTIME_INPUT", "stop action must be abort or timeout");
  const control = controlPath(options.repoRoot, options.scope, options.runId);
  const value = { schemaVersion: 1, runId: run.runId, action,
    reason: safeLine(options.reason, "stop reason", 500), requestedAt: new Date().toISOString() };
  if (fs.existsSync(control)) {
    const existing = readJson(control, "provider control");
    if (existing.runId !== value.runId || existing.action !== value.action) {
      throw runtimeError("PROVIDER_CONTROL_CONFLICT", "provider run already has a different stop request");
    }
  } else atomicJson(control, value);
  return writeRun(options.repoRoot, options.scope, options.runId, (current) => ({
    ...current,
    state: action === "abort" ? "abort-requested" : "timeout-requested",
    stopRequest: value,
    lastHeartbeatAt: new Date().toISOString(),
  }));
}

export async function refreshProviderRun(options) {
  let run = readProviderRun(options.repoRoot, options.scope, options.runId, options.expected || {});
  if (!ACTIVE.has(run.state)) return run;
  const now = options.now ? new Date(options.now) : new Date();
  if (!Number.isFinite(now.getTime())) throw runtimeError("PROVIDER_RUNTIME_INPUT", "now must be an ISO timestamp");
  if (now.getTime() >= Date.parse(run.deadlineAt) && run.state !== "timeout-requested") {
    await requestProviderStop({ ...options, action: "timeout", reason: "provider run deadline expired" });
    run = readProviderRun(options.repoRoot, options.scope, options.runId, options.expected || {});
  }
  if (["abort-requested", "timeout-requested"].includes(run.state) && run.stopRequest &&
      now.getTime() - Date.parse(run.stopRequest.requestedAt) >= (options.stopGraceMs ?? 2_000)) {
    if (run.providerPid && isProcessAlive(run.providerPid)) terminateProcessTree(run.providerPid);
    if (run.workerPid && isProcessAlive(run.workerPid)) terminateProcessTree(run.workerPid);
    run = writeRun(options.repoRoot, options.scope, options.runId, (current) => ({
      ...current,
      state: current.stopRequest?.action === "abort" ? "aborted" : "timed-out",
      finishedAt: now.toISOString(),
      lastHeartbeatAt: now.toISOString(),
      stopEscalated: true,
    }));
    return run;
  }
  const heartbeatAge = now.getTime() - Date.parse(run.lastHeartbeatAt);
  if (run.workerPid && !isProcessAlive(run.workerPid) && heartbeatAge >= (options.vanishedAfterMs ?? 2_000)) {
    if (run.providerPid && isProcessAlive(run.providerPid)) terminateProcessTree(run.providerPid);
    run = writeRun(options.repoRoot, options.scope, options.runId, (current) => ({
      ...current,
      state: "vanished",
      finishedAt: now.toISOString(),
      failure: { code: "WORKER_VANISHED", message: "provider worker exited without a terminal transition" },
    }));
  }
  return run;
}

function readManifest(file) {
  const resolved = fs.realpathSync(path.resolve(file));
  const value = readJson(resolved, "provider manifest");
  if (!value || value.schemaVersion !== 1 || !RUN_ID.test(String(value.runId || "")) ||
      !["claude", "codex"].includes(value.provider) || !Array.isArray(value.prefixArgs)) {
    throw runtimeError("PROVIDER_MANIFEST", "provider manifest has an invalid shape");
  }
  const expected = manifestPath(value.repoRoot, value.scope, value.runId);
  if (fs.realpathSync(expected) !== resolved) throw runtimeError("PROVIDER_MANIFEST", "provider manifest path does not match its run identity");
  return value;
}

function terminateProcessTree(pid) {
  if (!Number.isInteger(pid) || pid < 1) return;
  if (process.platform === "win32") {
    const killed = spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      encoding: "utf8", windowsHide: true, timeout: 15_000,
    });
    if (killed.error || killed.status !== 0) {
      try { process.kill(pid, "SIGKILL"); } catch { /* already gone or inaccessible */ }
    }
    return;
  }
  try { process.kill(-pid, "SIGTERM"); }
  catch { try { process.kill(pid, "SIGTERM"); } catch { /* already gone */ } }
  setTimeout(() => {
    try { process.kill(-pid, "SIGKILL"); }
    catch { try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ } }
  }, 2_000).unref();
}

function appendBounded(file, bytes) {
  const current = fs.existsSync(file) ? fs.statSync(file).size : 0;
  if (current >= MAX_OUTPUT_BYTES) return;
  const remaining = MAX_OUTPUT_BYTES - current;
  fs.appendFileSync(file, bytes.subarray(0, remaining));
}

function routePrompt(manifest) {
  const brief = JSON.stringify(manifest.briefFile);
  if (manifest.provider === "codex") {
    return `/codex:rescue --wait --fresh --model ${manifest.model} --effort ${manifest.effort} ` +
      `Read ${brief}, execute exactly that bound leaf contract, and return the Codex runtime result unchanged.`;
  }
  return `Read ${brief} and execute exactly that bound leaf contract. Do not widen OWNS. ` +
    "Return a concise result; the parent will reverify locally.";
}

async function workerMain(manifestFile) {
  const manifest = readManifest(manifestFile);
  const stateFile = providerRunPath(manifest.repoRoot, manifest.scope, manifest.runId);
  const stdoutFile = path.join(path.dirname(stateFile), "provider.stdout.ndjson");
  const stderrFile = path.join(path.dirname(stateFile), "provider.stderr.log");
  let stopAction = null;
  let resultErrored = false;
  let stdoutBuffer = "";
  let finalized = false;
  let child = null;

  const update = (transform) => writeRun(manifest.repoRoot, manifest.scope, manifest.runId, transform);
  update((run) => ({ ...run, state: "starting", workerPid: process.pid, startedAt: new Date().toISOString(),
    lastHeartbeatAt: new Date().toISOString() }));

  const heartbeat = setInterval(() => {
    try {
      const run = readProviderRun(manifest.repoRoot, manifest.scope, manifest.runId);
      if (ACTIVE.has(run.state)) update((current) => ({ ...current, lastHeartbeatAt: new Date().toISOString() }));
    } catch { /* the final transition reports the primary failure */ }
  }, 1_000);
  heartbeat.unref();

  const controlPoll = setInterval(() => {
    const file = controlPath(manifest.repoRoot, manifest.scope, manifest.runId);
    if (!fs.existsSync(file) || stopAction) return;
    try {
      const control = readJson(file, "provider control");
      if (control.runId !== manifest.runId || !["abort", "timeout"].includes(control.action)) return;
      stopAction = control.action;
      if (child) terminateProcessTree(child.pid);
    } catch { /* invalid control is ignored here and remains diagnosable on disk */ }
  }, 200);
  controlPoll.unref();

  const deadlineTimer = setTimeout(() => {
    if (finalized) return;
    stopAction = "timeout";
    if (child) terminateProcessTree(child.pid);
  }, Math.max(1, Date.parse(manifest.deadlineAt) - Date.now()));
  deadlineTimer.unref();

  const recordEvent = (event) => {
    if (!event || typeof event !== "object") return;
    if (event.type === "result" && (event.is_error === true || String(event.subtype || "").startsWith("error"))) {
      resultErrored = true;
    }
    const nativeHandle = typeof event.session_id === "string" ? event.session_id.trim() : "";
    if (!nativeHandle) return;
    safeLine(nativeHandle, "native handle", 256);
    update((run) => ({ ...run, state: run.state === "starting" || run.state === "queued" ? "running" : run.state,
      nativeHandle: run.nativeHandle || nativeHandle, providerPid: child?.pid || run.providerPid,
      nativeStartedAt: run.nativeStartedAt || new Date().toISOString(), lastHeartbeatAt: new Date().toISOString() }));
  };

  try {
    child = spawn(manifest.executable, [
      ...manifest.prefixArgs,
      "-p",
      "--output-format", "stream-json",
      "--verbose",
      "--max-turns", String(manifest.maxTurns),
      // A print-mode worker has no interactive operator who could answer a
      // permission prompt. Package binding, OWNS and mutation policy remain
      // enforced by the project hooks; provider output still is not evidence.
      "--permission-mode", manifest.permissionMode,
      routePrompt(manifest),
    ], {
      cwd: manifest.repoRoot,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: { ...process.env, UNLAZY_PACKAGE: manifest.packageId, UNLAZY_SCOPE: manifest.scope,
        KEEL_PACKAGE_SESSION: manifest.sessionId },
    });
    update((run) => ({ ...run, providerPid: child.pid, lastHeartbeatAt: new Date().toISOString() }));
  } catch (error) {
    clearInterval(heartbeat); clearInterval(controlPoll); clearTimeout(deadlineTimer);
    update((run) => ({ ...run, state: "provider-start-failed", finishedAt: new Date().toISOString(),
      failure: { code: "PROVIDER_SPAWN", message: error.message }, lastHeartbeatAt: new Date().toISOString() }));
    return;
  }

  child.stdout.on("data", (chunk) => {
    appendBounded(stdoutFile, chunk);
    stdoutBuffer += chunk.toString("utf8");
    const lines = stdoutBuffer.split(/\r?\n/u);
    stdoutBuffer = lines.pop() || "";
    for (const line of lines.filter(Boolean)) {
      try { recordEvent(JSON.parse(line)); } catch { /* provider diagnostics remain in the raw log */ }
    }
  });
  child.stderr.on("data", (chunk) => appendBounded(stderrFile, chunk));
  child.on("error", (error) => {
    appendBounded(stderrFile, Buffer.from("provider process error: " + error.message + "\n"));
  });

  await new Promise((resolve) => child.once("close", (code, signal) => {
    finalized = true;
    clearInterval(heartbeat); clearInterval(controlPoll); clearTimeout(deadlineTimer);
    if (stdoutBuffer.trim()) {
      try { recordEvent(JSON.parse(stdoutBuffer)); } catch { /* raw output is retained */ }
    }
    const current = readProviderRun(manifest.repoRoot, manifest.scope, manifest.runId);
    let state;
    let failure = null;
    if (stopAction === "abort") state = "aborted";
    else if (stopAction === "timeout") state = "timed-out";
    else if (!current.nativeHandle) {
      state = "provider-start-failed";
      failure = { code: "NO_NATIVE_HANDLE", message: "Claude emitted no native session_id" };
    } else if (code !== 0 || resultErrored) {
      state = "provider-failed";
      failure = { code: "PROVIDER_EXIT", message: "provider exited " + code + (signal ? " via " + signal : "") };
    } else state = "provider-returned";
    const stdout = fs.existsSync(stdoutFile) ? fs.readFileSync(stdoutFile) : Buffer.alloc(0);
    const stderr = fs.existsSync(stderrFile) ? fs.readFileSync(stderrFile) : Buffer.alloc(0);
    update((run) => ({ ...run, state, exitCode: code, signal: signal || null,
      finishedAt: new Date().toISOString(), lastHeartbeatAt: new Date().toISOString(),
      providerOutputDigest: sha256(Buffer.concat([stdout, Buffer.from("\0"), stderr])),
      providerOutputBytes: stdout.length + stderr.length, providerOutputEvidence: false,
      ...(failure ? { failure } : {}) }));
    resolve();
  }));
}

async function cli() {
  const args = process.argv.slice(2);
  if (args.shift() !== "worker" || args.shift() !== "--manifest" || args.length !== 1) {
    throw runtimeError("PROVIDER_RUNTIME_USAGE", "provider-runtime.mjs is an internal worker; use package-executor.mjs");
  }
  await workerMain(args[0]);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(hereFile)) {
  cli().catch((error) => {
    process.stderr.write("provider-runtime: " + (error.code || "FAILED") + ": " + error.message + "\n");
    process.exitCode = 2;
  });
}
