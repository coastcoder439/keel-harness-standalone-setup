#!/usr/bin/env node

// Durable adapter between package dispatch state and the native provider
// protocols: Claude Code stream-json and Codex exec --json. The adapter never
// accepts caller-supplied provider handles: a handle is recorded only after
// Claude emits session_id or Codex emits thread_id itself.
//
// A worker needs no hook to start. If the settings of the Harness root hold PreToolUse hooks
// (the GitHub delete protection), they go along with fixed paths: a Claude worker gets them
// through --settings (measured 01.10.2026: a nested project repo has no project hooks of its
// own, and a --settings hook denies even under bypassPermissions); a Codex worker gets them
// through -c hooks.PreToolUse (it always runs with --dangerously-bypass-hook-trust; measured 01.10.2026 on
// Codex 0.153.4: the hook fires for PowerShell commands and its JSON deny holds). If the root
// holds none, the worker starts without a hook setting. A Claude worker always runs with
// --setting-sources "" and so loads no other hooks of the user or the project (a Stop hook
// that waits for open gates would hold it until its turn limit). Both providers see their
// package session as KEEL_PACKAGE_SESSION and the rule root as KEEL_HARNESS_ROOT.
//
// Run limits (P12, C1/C12): no step count, no total time, no start time. A run
// is ended only
//  - when it is really hung: no tool call open and no event for the silence time
//    (silence-watch.mjs, KEEL_SILENCE_MS), status `hung`;
//  - at its cost frame: Claude's own --max-budget-usd. Codex has no such switch and reports usage only
//    when a turn ends, so its token frame is counted from the rollout file Codex writes while it works
//    (codex-rollout.mjs, read incrementally) and from turn.completed; the run is stopped when the rollout
//    shows the frame used up during a turn, status `budget-reached`, resumable with the native session id.
//    A process that ends by itself with success after turn.completed is never killed for the frame: it is
//    `provider-returned`, with a hint that the frame was exceeded;
//  - when a PreToolUse hook refused the same tool input three times in a row, status `repeated-block`. Claude
//    shows a refusal as a tool_result in its stream; Codex shows none in `exec --json`, so its refusals are read
//    from the same rollout file (answers to tool calls, joined to their calls by call_id).
// A deadline (--deadline-seconds) and a turn limit (--max-turns) exist only when the
// caller asks for them.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { replaceFileSync } from "./atomic-file.mjs";
import { CODEX_MODEL, CODEX_EFFORT } from "./codex-pin.mjs";
import { createEventTracker } from "./provider-events.mjs";
import { createRolloutReader, codexSessionsRoot } from "./codex-rollout.mjs";

const hereFile = fileURLToPath(import.meta.url);
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const ACTIVE = new Set(["queued", "starting", "running", "abort-requested", "timeout-requested"]);
// hung, budget-reached and repeated-block end the provider process; the Orchestrator decides what follows
// (resume, retry, reassign, abort).
const TERMINAL = new Set(["provider-start-failed", "provider-returned", "provider-failed", "aborted", "timed-out", "vanished",
  "hung", "budget-reached", "repeated-block"]);
export const TERMINAL_STATES = TERMINAL;
// Format of the run state and the manifest. 1: deadline and turn count mandatory. 2 (P12): both optional
// (deadlineAt may be null), cost frame and resume added. Version 1 runs are read and checked as before.
const RUN_FORMAT = 2;
const READABLE_FORMATS = new Set([1, 2]);
// The log of a run is cut at this size to protect the disk; it is no limit on the work. Origin: self-built
// (F1), no function of Claude Code or Codex. The cut is never silent: a keel_log_truncated line ends the log
// and the run record carries logTruncated.
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
export const DEFAULT_COST_BUDGET_USD = 20;
export const DEFAULT_TOKEN_BUDGET = 2_000_000;
// How often the Codex rollout file is read while the event stream is quiet (and at most this often while it is
// busy: a read costs a stat and the new bytes). KEEL_ROLLOUT_POLL_MS shortens it for tests.
const ROLLOUT_POLL_MS = 5_000;
const ROLLOUT_MIN_GAP_MS = 250;

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

// A whole number of at least 1 without an upper bound of our own.
function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) {
    throw runtimeError("PROVIDER_RUNTIME_INPUT", label + " must be a whole number of at least 1");
  }
  return number;
}

const absent = (value) => value === undefined || value === null || value === "";

function positiveNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw runtimeError("PROVIDER_RUNTIME_INPUT", label + " must be a number above 0");
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
  if (!value || !READABLE_FORMATS.has(value.schemaVersion) || !RUN_ID.test(String(value.runId || "")) ||
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
  // Version 1 always carried a deadline. From version 2 on it is optional: null means "no deadline".
  const deadlineOptional = value.schemaVersion >= 2 && value.deadlineAt === null;
  if (!Number.isFinite(Date.parse(value.createdAt)) || !Number.isFinite(Date.parse(value.lastHeartbeatAt)) ||
      (!deadlineOptional && !Number.isFinite(Date.parse(value.deadlineAt)))) {
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

// The PreToolUse hooks of the Harness root with fixed paths, for a worker whose working
// directory is a project repository without hooks of its own. Only they travel:
// SessionStart, UserPromptSubmit and Stop hooks serve the Owner's session, and a Stop
// hook that waits for open gates would hold a worker until its turn limit (E6).
// A root without such hooks (no settings file, no PreToolUse entry) gives an empty list:
// the worker then starts without a hook setting.
export function workerGuardHooks(harnessRoot) {
  const file = path.join(harnessRoot, ".claude", "settings.json");
  if (!fs.existsSync(file)) return [];
  const groups = readJson(file, "Harness settings")?.hooks?.PreToolUse;
  if (!Array.isArray(groups) || !groups.length) return [];
  // A hook may start in exec form ("command": "node", "args": ["${CLAUDE_PROJECT_DIR}/<program>", ...], no shell;
  // Claude Code substitutes only the braced placeholder there); the fixed root goes into the command and into
  // every argument, so the worker gets the same start form as the root.
  const root = harnessRoot.split(path.sep).join("/");
  const fixed = (value) => String(value ?? "").replaceAll("${CLAUDE_PROJECT_DIR}", root).replaceAll("$CLAUDE_PROJECT_DIR", root);
  return groups.map((group) => ({ ...group, hooks: (group.hooks || []).map((hook) => ({
    ...hook, command: fixed(hook.command), ...(Array.isArray(hook.args) ? { args: hook.args.map(fixed) } : {}),
  })) }));
}

function tomlLiteral(value) {
  const text = String(value);
  if (/['\r\n]/u.test(text)) throw runtimeError("PROVIDER_HOOKS", "a Codex hook value cannot be written as a TOML literal: " + text);
  return "'" + text + "'";
}

// The same hooks for Codex as the value of `-c hooks.PreToolUse=...`: every group of the
// root's .codex/hooks.json, each hook as `node "<root>/.codex/hook-runner.cjs" <target>`.
// The runner names the target for the hook's Codex deny format (E8). A root without PreToolUse
// hooks gives null: the worker then starts without a hook setting.
export function codexGuardHooks(harnessRoot) {
  const file = path.join(harnessRoot, ".codex", "hooks.json");
  if (!fs.existsSync(file)) return null;
  const groups = readJson(file, "Harness Codex hooks")?.hooks?.PreToolUse;
  if (!Array.isArray(groups) || !groups.length) return null;
  const runner = path.join(harnessRoot, ".codex", "hook-runner.cjs").split(path.sep).join("/");
  const entries = groups.map((group) => {
    const hooks = (group.hooks || []).map((hook) => {
      const target = String(hook.command || "").match(/"(\.(?:claude|codex)\/[A-Za-z0-9._-]+)"\s*$/u)?.[1];
      if (!target) throw runtimeError("PROVIDER_HOOKS", "a Codex hook names no hook target: " + hook.command);
      return "{type=" + tomlLiteral("command") + ",command=" + tomlLiteral("node \"" + runner + "\" " + target) +
        ",timeout=" + boundedInteger(hook.timeout ?? 10, "hook timeout", 1, 600) + "}";
    });
    return "{matcher=" + tomlLiteral(group.matcher) + ",hooks=[" + hooks.join(",") + "]}";
  });
  return "[" + entries.join(",") + "]";
}

// A resumed run continues the native session of an earlier run of the same leaf (Claude --resume <session id>,
// codex exec resume <thread id>) with a new cost frame instead of starting over.
function resumeSpec(value, provider) {
  if (value === undefined || value === null) return null;
  const nativeHandle = safeLine(value.nativeHandle, "resume native handle", 256);
  if (!RUN_ID.test(String(value.fromRunId || ""))) throw runtimeError("PROVIDER_RUNTIME_INPUT", "resume fromRunId is invalid");
  if (value.provider !== undefined && value.provider !== provider) {
    throw runtimeError("PROVIDER_RUNTIME_INPUT", "a run is resumed by the provider that started it");
  }
  return {
    nativeHandle,
    fromRunId: value.fromRunId,
    reason: value.reason ? safeLine(value.reason, "resume reason", 200) : null,
    message: value.message ? safeLine(value.message, "resume message", 500) : null,
  };
}

export async function launchProviderRun(options) {
  const repoRoot = fs.realpathSync(path.resolve(options.repoRoot));
  const scope = identifier(options.scope, "scope");
  const packageId = identifier(options.packageId, "packageId");
  const sessionId = safeLine(options.sessionId, "sessionId", 256);
  const leaf = identifier(options.leaf, "leaf");
  const provider = String(options.provider || "");
  if (!new Set(["claude", "codex"]).has(provider)) throw runtimeError("PROVIDER_RUNTIME_INPUT", "provider must be claude or codex");
  const briefFile = fs.realpathSync(path.resolve(options.briefFile));
  // P18: a step with a working copy of its own runs there; the copy lives inside the ignored runtime folder of the repository.
  let workDir = null;
  if (!absent(options.workDir)) {
    workDir = fs.realpathSync(path.resolve(options.workDir));
    const relativeWork = path.relative(repoRoot, workDir);
    if (!relativeWork || relativeWork.startsWith(".." + path.sep) || path.isAbsolute(relativeWork)) {
      throw runtimeError("PROVIDER_RUNTIME_INPUT", "workDir must be inside the package repository");
    }
  }
  const relativeBrief = path.relative(repoRoot, briefFile);
  if (!relativeBrief || relativeBrief.startsWith(".." + path.sep) || path.isAbsolute(relativeBrief)) {
    throw runtimeError("PROVIDER_RUNTIME_INPUT", "briefFile must be inside the package repository");
  }
  // No default and no upper bound: a deadline and a turn limit exist only when the caller names them.
  const deadlineSeconds = absent(options.deadlineSeconds) ? null : positiveInteger(options.deadlineSeconds, "deadlineSeconds");
  const maxTurns = absent(options.maxTurns) ? null : positiveInteger(options.maxTurns, "maxTurns");
  // The cost frame is the brake (C12): Claude's own --max-budget-usd, for Codex a token frame counted from usage.
  const costBudgetUsd = provider === "claude" ? positiveNumber(options.costBudgetUsd ?? DEFAULT_COST_BUDGET_USD, "costBudgetUsd") : null;
  const tokenBudget = provider === "codex" ? positiveInteger(options.tokenBudget ?? DEFAULT_TOKEN_BUDGET, "tokenBudget") : null;
  const resume = resumeSpec(options.resume, provider);
  const executable = safeLine(options.claudeExecutable || "claude", "Claude executable", 2_000);
  const prefixArgs = Array.isArray(options.claudePrefixArgs) ? options.claudePrefixArgs.map((item) => safeLine(item, "Claude prefix argument", 2_000)) : [];
  if (!options.harnessRoot) throw runtimeError("PROVIDER_RUNTIME_INPUT", "harnessRoot is required: it is the rule root of every worker");
  const harnessRoot = fs.realpathSync(path.resolve(options.harnessRoot));
  const unlazyRoot = absent(options.unlazyRoot) ? null : fs.realpathSync(path.resolve(options.unlazyRoot));
  let codexCommand = null;
  if (provider === "codex") {
    const requested = options.codexCommand || { command: "codex", prefixArgs: [] };
    codexCommand = { command: safeLine(requested.command, "Codex executable", 2_000),
      prefixArgs: (requested.prefixArgs || []).map((item) => safeLine(item, "Codex prefix argument", 2_000)) };
  }
  // Fail before any process starts when the root's hooks cannot be read; having none is fine.
  const guards = provider === "codex" ? codexGuardHooks(harnessRoot) : workerGuardHooks(harnessRoot);
  const attempt = positiveInteger(options.attempt ?? 1, "attempt");
  const runId = crypto.randomUUID();
  const directory = runDirectory(repoRoot, scope, runId);
  fs.mkdirSync(path.dirname(directory), { recursive: true });
  fs.mkdirSync(directory, { recursive: false });
  let settingsFile = null;
  if (provider === "claude" && guards.length) {
    settingsFile = path.join(directory, "worker-settings.json");
    atomicJson(settingsFile, { hooks: { PreToolUse: guards } });
  }
  const createdAt = new Date().toISOString();
  const deadlineAt = deadlineSeconds === null ? null : new Date(Date.now() + deadlineSeconds * 1_000).toISOString();
  if (deadlineSeconds !== null && deadlineAt === null) throw runtimeError("PROVIDER_RUNTIME_INPUT", "deadlineSeconds is too large");
  const manifest = {
    schemaVersion: RUN_FORMAT,
    runId,
    repoRoot,
    packageId,
    scope,
    sessionId,
    leaf,
    provider,
    briefFile,
    workDir,
    executable,
    prefixArgs,
    maxTurns,
    deadlineAt,
    costBudgetUsd,
    tokenBudget,
    codexHome: provider === "codex" && !absent(options.codexHome) ? path.resolve(options.codexHome) : null,
    resume,
    unlazyRoot,
    model: provider === "codex" ? CODEX_MODEL : null,
    effort: provider === "codex" ? CODEX_EFFORT : null,
    permissionMode: "bypassPermissions",
    harnessRoot,
    settingsFile,
    codexCommand,
    codexHooks: provider === "codex" ? (guards || null) : null,
  };
  atomicJson(manifestPath(repoRoot, scope, runId), manifest);
  atomicJson(providerRunPath(repoRoot, scope, runId), {
    schemaVersion: RUN_FORMAT,
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
    attempt,
    createdAt,
    deadlineAt,
    costBudgetUsd,
    tokenBudget,
    ...(resume ? { resumedFrom: resume.fromRunId } : {}),
    lastHeartbeatAt: createdAt,
    providerOutputEvidence: false,
  });

  let worker;
  const workerExit = { done: false, at: 0, code: null };
  try {
    worker = spawn(process.execPath, [hereFile, "worker", "--manifest", manifestPath(repoRoot, scope, runId)], {
      cwd: repoRoot,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      env: { ...process.env, UNLAZY_PACKAGE: packageId, UNLAZY_SCOPE: scope, KEEL_PACKAGE_SESSION: sessionId },
    });
    worker.unref();
    worker.once("exit", (code) => { workerExit.done = true; workerExit.at = Date.now(); workerExit.code = code; });
  } catch (error) {
    writeRun(repoRoot, scope, runId, (run) => ({ ...run, state: "provider-start-failed",
      failure: { code: "WORKER_SPAWN", message: error.message }, finishedAt: new Date().toISOString() }));
    throw terminalFailure(readProviderRun(repoRoot, scope, runId));
  }

  // No start time (C1): waiting for the native handle ends when the handle arrives, when the run ends, when
  // the worker is gone without a verdict, or through the silence watcher of the worker if the start hangs.
  const launched = new Set(["running", "provider-returned", "hung", "budget-reached", "repeated-block"]);
  for (;;) {
    let run = await refreshProviderRun({ repoRoot, scope, runId });
    if (launched.has(run.state) && run.nativeHandle) return run;
    if (TERMINAL.has(run.state)) throw terminalFailure(run);
    if (workerExit.done && Date.now() - workerExit.at >= 500) {
      run = readProviderRun(repoRoot, scope, runId);
      if (launched.has(run.state) && run.nativeHandle) return run;
      if (TERMINAL.has(run.state)) throw terminalFailure(run);
      writeRun(repoRoot, scope, runId, (current) => ({ ...current, state: "provider-start-failed",
        failure: { code: "WORKER_EXITED", message: "the provider worker exited (code " + workerExit.code + ") before the provider started" },
        finishedAt: new Date().toISOString() }));
      throw terminalFailure(readProviderRun(repoRoot, scope, runId));
    }
    await delay(50);
  }
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
  // A run without a deadline (deadlineAt null, the normal case) is never timed out here.
  if (run.deadlineAt !== null && run.deadlineAt !== undefined && now.getTime() >= Date.parse(run.deadlineAt) &&
      run.state !== "timeout-requested") {
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
  if (!value || !READABLE_FORMATS.has(value.schemaVersion) || !RUN_ID.test(String(value.runId || "")) ||
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

// A log file with a size bound that says so when it cuts: the bytes up to the bound stay, then one line
// {"type":"keel_log_truncated","bytes":<bytes kept>} follows, and onTruncate lets the run record carry
// logTruncated. Everything after that is only counted (dropped).
export function boundedLog(file, { limit = MAX_OUTPUT_BYTES, onTruncate = null } = {}) {
  const log = { file, written: fs.existsSync(file) ? fs.statSync(file).size : 0, dropped: 0, truncated: false };
  log.write = (bytes) => {
    if (!log.truncated && log.written + bytes.length <= limit) {
      fs.appendFileSync(file, bytes);
      log.written += bytes.length;
      return;
    }
    if (log.truncated) { log.dropped += bytes.length; return; }
    const room = Math.max(0, limit - log.written);
    if (room) fs.appendFileSync(file, bytes.subarray(0, room));
    log.written += room;
    log.dropped += bytes.length - room;
    log.truncated = true;
    fs.appendFileSync(file, "\n" + JSON.stringify({ type: "keel_log_truncated", bytes: log.written }) + "\n");
    if (onTruncate) onTruncate(log);
  };
  return log;
}

function routePrompt(manifest) {
  const brief = JSON.stringify(manifest.briefFile);
  if (manifest.resume) {
    return `Read ${brief} and continue exactly that bound leaf contract: your previous run stopped` +
      `${manifest.resume.reason ? " (" + manifest.resume.reason + ")" : ""} before it was finished. Do not widen OWNS. ` +
      `${manifest.resume.message ? manifest.resume.message + " " : ""}` +
      "Return a concise result; the parent will reverify locally.";
  }
  return `Read ${brief} and execute exactly that bound leaf contract. Do not widen OWNS. ` +
    "Return a concise result; the parent will reverify locally.";
}

// The exact provider process of a run: Claude print mode without settings sources and, if the root
// holds PreToolUse hooks, with them as its only settings, or Codex exec with the same hooks handed
// over (E6/E8); without such hooks neither gets a hook setting. A step limit goes
// to Claude only when the manifest names one; the cost frame goes along as Claude's own
// --max-budget-usd. A resumed run continues the native session instead of starting a new one.
export function providerProcess(manifest) {
  if (!manifest.harnessRoot) throw runtimeError("PROVIDER_RUNTIME_INPUT", "run manifest names no Harness root");
  const resume = manifest.resume || null;
  if (manifest.provider === "codex") {
    if (!manifest.codexCommand) throw runtimeError("PROVIDER_RUNTIME_INPUT", "run manifest carries no Codex command");
    const shared = [
      "--json",
      "--dangerously-bypass-hook-trust",
    ];
    const settings = [
      "-m", manifest.model,
      "-c", "model_reasoning_effort=" + tomlLiteral(manifest.effort),
      ...(manifest.codexHooks ? ["-c", "hooks.PreToolUse=" + manifest.codexHooks] : []),
    ];
    // codex exec resume takes neither -s nor -C (codex exec resume --help, 0.153.4): the sandbox goes as a
    // config value and the working directory is the worker's own.
    const args = resume
      ? ["exec", "resume", ...shared, "-c", "sandbox_mode=" + tomlLiteral("workspace-write"), ...settings, resume.nativeHandle, routePrompt(manifest)]
      : ["exec", ...shared, "-s", "workspace-write", "-C", manifest.workDir || manifest.repoRoot, ...settings, routePrompt(manifest)];
    return { command: manifest.codexCommand.command, args: [...manifest.codexCommand.prefixArgs, ...args] };
  }
  const turnLimit = Number.isInteger(manifest.maxTurns) && manifest.maxTurns > 0 ? ["--max-turns", String(manifest.maxTurns)] : [];
  const costFrame = Number.isFinite(manifest.costBudgetUsd) && manifest.costBudgetUsd > 0
    ? ["--max-budget-usd", String(manifest.costBudgetUsd)] : [];
  return {
    command: manifest.executable,
    args: [
      ...manifest.prefixArgs,
      "-p",
      "--output-format", "stream-json",
      "--verbose",
      ...turnLimit,
      // A print-mode worker has no operator who could answer a permission prompt. A hook denial
      // (the GitHub delete protection) holds even under bypassPermissions.
      "--permission-mode", manifest.permissionMode,
      "--setting-sources", "",
      ...(manifest.settingsFile ? ["--settings", manifest.settingsFile] : []),
      ...costFrame,
      ...(resume ? ["--resume", resume.nativeHandle] : []),
      routePrompt(manifest),
    ],
  };
}

export function providerEnvironment(manifest, base = process.env) {
  const env = { ...base, UNLAZY_PACKAGE: manifest.packageId, UNLAZY_SCOPE: manifest.scope,
    KEEL_PACKAGE_SESSION: manifest.sessionId, KEEL_HARNESS_ROOT: manifest.harnessRoot };
  // A worker is no Codex hook runner: an inherited target would switch its guards to the
  // runner's deny format and dialect.
  delete env.KEEL_HOOK_TARGET;
  return env;
}

// The silence watcher (vendor/unlazy/scripts/lib/silence-watch.mjs): from the Unlazy root the executor
// named, else from the runtime that ships next to this Harness tree (inside it in the standalone layout,
// beside it in the source layout).
async function loadSilenceWatch(manifest) {
  const tree = path.resolve(path.dirname(hereFile), "..", "..");
  const roots = [manifest.unlazyRoot, path.join(tree, "vendor", "unlazy"), path.join(path.dirname(tree), "vendor", "unlazy")]
    .filter(Boolean);
  const files = roots.map((root) => path.join(root, "scripts", "lib", "silence-watch.mjs"));
  const file = files.find((candidate) => fs.existsSync(candidate));
  if (!file) throw runtimeError("PROVIDER_SILENCE_WATCH", "silence-watch.mjs not found: " + files.join(", "));
  const module = await import(pathToFileURL(file).href);
  if (typeof module.runWatched !== "function") throw runtimeError("PROVIDER_SILENCE_WATCH", "silence-watch.mjs exports no runWatched");
  return module;
}

// The verdict of a run that has ended, from what the provider process and its event stream said.
// Precedence: a requested stop (abort, timeout), a guard that refused the same input three times,
// the cost frame, a hang, then the plain result.
export function runVerdict({ stopAction, ownStop, tracker, result, nativeHandle, manifest }) {
  const events = tracker.state;
  if (stopAction === "abort") return { state: "aborted", failure: null };
  if (stopAction === "timeout") return { state: "timed-out", failure: null };
  if (ownStop === "repeated-block" && events.repeatedBlock) {
    const block = events.repeatedBlock;
    return { state: "repeated-block", failure: { code: "REPEATED_BLOCK",
      message: "a guard refused the same " + block.tool + " input " + block.count + " times: " + block.command },
    blocked: { tool: block.tool, command: block.command, input: block.input, message: block.message, count: block.count } };
  }
  // Codex: a process that ended by itself with success finished its work, whatever the frame says, also when the silence
  // watcher judged it hung a moment before it left (its kill is SIGKILL / taskkill /F and never leaves exit 0; P27). It
  // is never stopped after turn.completed (Orchestrator, 06.10.2026): provider-returned with a hint. Claude: the frame decides.
  const endedByItself = result.code === 0 && !result.signal;
  const finishedAnyway = manifest.provider === "codex" && endedByItself;
  if (events.budgetReached && !finishedAnyway) {
    const message = manifest.provider === "claude"
      ? "provider result error_max_budget_usd: the cost frame of " + manifest.costBudgetUsd + " USD is used up"
      : "the token frame of " + manifest.tokenBudget + " is used up (" + events.tokensUsed + " counted)";
    return { state: "budget-reached", failure: { code: "BUDGET_REACHED", message } };
  }
  if (result.hung && !finishedAnyway) return { state: "hung", failure: { code: "PROVIDER_HUNG", message: String(result.hungReason || "the provider run hung") } };
  if (!nativeHandle) {
    return { state: "provider-start-failed", failure: { code: "NO_NATIVE_HANDLE",
      message: "the provider emitted no native session handle" + (result.spawnError ? " (provider process error: " + result.spawnError + ")" : "") } };
  }
  if (result.code !== 0 || events.resultErrored) {
    const message = result.code === 0 && events.resultErrored
      ? "provider result " + events.resultSubtype
      : "provider exited " + result.code + (result.signal ? " via " + result.signal : "");
    const said = events.resultErrored && events.resultMessage ? ": " + events.resultMessage : "";
    return { state: "provider-failed", failure: { code: "PROVIDER_EXIT", message: message + said } };
  }
  if (events.budgetReached) {
    return { state: "provider-returned", failure: null, hints: ["the token frame of " + manifest.tokenBudget +
      " was exceeded (" + events.tokensUsed + " counted) and the run ended by itself with success: it was not stopped"] };
  }
  return { state: "provider-returned", failure: null };
}

async function workerMain(manifestFile) {
  const manifest = readManifest(manifestFile);
  const stateFile = providerRunPath(manifest.repoRoot, manifest.scope, manifest.runId);
  const stdoutFile = path.join(path.dirname(stateFile), "provider.stdout.ndjson");
  const stderrFile = path.join(path.dirname(stateFile), "provider.stderr.log");
  const tracker = createEventTracker({ provider: manifest.provider, tokenBudget: manifest.tokenBudget });
  let stopAction = null;
  let ownStop = null;
  let stdoutBuffer = "";
  let finalized = false;
  let child = null;
  let handleRecorded = false;
  let rolloutTimer = null;

  const update = (transform) => writeRun(manifest.repoRoot, manifest.scope, manifest.runId, transform);
  const startedAtMs = Date.now();
  update((run) => ({ ...run, state: "starting", workerPid: process.pid, startedAt: new Date(startedAtMs).toISOString(),
    lastHeartbeatAt: new Date().toISOString() }));

  const heartbeat = setInterval(() => {
    try {
      const run = readProviderRun(manifest.repoRoot, manifest.scope, manifest.runId);
      if (ACTIVE.has(run.state)) update((current) => ({ ...current, lastHeartbeatAt: new Date().toISOString() }));
    } catch { /* the final transition reports the primary failure */ }
  }, 1_000);
  heartbeat.unref();

  const stopProvider = () => { if (child) terminateProcessTree(child.pid); };
  const controlPoll = setInterval(() => {
    const file = controlPath(manifest.repoRoot, manifest.scope, manifest.runId);
    if (!fs.existsSync(file) || stopAction) return;
    try {
      const control = readJson(file, "provider control");
      if (control.runId !== manifest.runId || !["abort", "timeout"].includes(control.action)) return;
      stopAction = control.action;
      stopProvider();
    } catch { /* invalid control is ignored here and remains diagnosable on disk */ }
  }, 200);
  controlPoll.unref();

  // The deadline timer exists only for a run whose caller asked for a deadline.
  let deadlineTimer = null;
  if (manifest.deadlineAt) {
    deadlineTimer = setTimeout(() => {
      if (finalized) return;
      stopAction = "timeout";
      stopProvider();
    }, Math.max(1, Date.parse(manifest.deadlineAt) - Date.now()));
    deadlineTimer.unref();
  }
  const clearTimers = () => {
    clearInterval(heartbeat);
    clearInterval(controlPoll);
    if (deadlineTimer) clearTimeout(deadlineTimer);
    if (rolloutTimer) clearInterval(rolloutTimer);
  };
  const startFailed = (code, message) => {
    clearTimers();
    update((run) => ({ ...run, state: "provider-start-failed", finishedAt: new Date().toISOString(),
      failure: { code, message }, lastHeartbeatAt: new Date().toISOString() }));
  };

  let silenceWatch;
  try { silenceWatch = await loadSilenceWatch(manifest); }
  catch (error) { startFailed(error.code || "PROVIDER_SILENCE_WATCH", error.message); return; }
  let provider;
  try { provider = providerProcess(manifest); }
  catch (error) { startFailed("PROVIDER_SPAWN", error.message); return; }

  const logs = {
    stdout: boundedLog(stdoutFile, { onTruncate: () => { try { update((run) => ({ ...run, logTruncated: true })); } catch { /* noted at the end */ } } }),
    stderr: boundedLog(stderrFile, { onTruncate: () => { try { update((run) => ({ ...run, logTruncated: true })); } catch { /* noted at the end */ } } }),
  };

  // The run stops itself in two cases only: a PreToolUse hook refused the same input three times in a row, and
  // the rollout file showed the token frame of a Codex run used up while a turn was running (Claude ends its
  // own run at --max-budget-usd). The frame reached at turn.completed stops nothing: the process ends by itself.
  const stopWhenDue = () => {
    if (ownStop || stopAction || finalized) return;
    if (tracker.state.repeatedBlock) ownStop = "repeated-block";
    else if (codex && tracker.state.budgetStop) ownStop = "budget-reached";
    if (ownStop) stopProvider();
  };

  // Codex reports usage only at the end of a turn, so during a turn its rollout file is read for the token
  // count (decision of the Orchestrator, 06.10.2026, a deliberate deviation from "counted from turn.completed").
  // The same pass reads the answers to the tool calls: a call that a PreToolUse hook refused leaves no item in
  // the event stream, only a response_item in the rollout file, and those answers go through the tracker's
  // counter of repeated refusals (provider-events.mjs, codex-rollout.mjs).
  // Read at every stream event (at most every ROLLOUT_MIN_GAP_MS) and every ROLLOUT_POLL_MS while the stream is
  // quiet. A missing file leaves the count at turn.completed and is noted in the run record.
  const codex = manifest.provider === "codex" && Number.isFinite(manifest.tokenBudget) && manifest.tokenBudget > 0;
  const rolloutRoot = codexSessionsRoot(manifest.codexHome);
  let rollout = null;
  let lastRolloutPoll = 0;
  const pollRollout = (force = false) => {
    if (!codex || !tracker.state.nativeHandle) return;
    const now = Date.now();
    if (!force && now - lastRolloutPoll < ROLLOUT_MIN_GAP_MS) return;
    lastRolloutPoll = now;
    rollout ??= createRolloutReader({ sessionsRoot: rolloutRoot, threadId: tracker.state.nativeHandle, since: startedAtMs });
    try { rollout.poll(); } catch { /* the file is read again at the next poll */ }
    tracker.noteRolloutTokens(rollout.runTokens);
    for (const answer of rollout.takeToolResults()) tracker.noteToolResult(answer);
  };
  if (codex) {
    rolloutTimer = setInterval(() => { pollRollout(true); stopWhenDue(); }, Number(process.env.KEEL_ROLLOUT_POLL_MS) || ROLLOUT_POLL_MS);
    rolloutTimer.unref();
  }

  const recordEvent = (event) => {
    if (!event || typeof event !== "object") return;
    tracker.feed(event);
    const nativeHandle = tracker.state.nativeHandle;
    if (nativeHandle && !handleRecorded) {
      safeLine(nativeHandle, "native handle", 256);
      handleRecorded = true;
      update((run) => ({ ...run, state: run.state === "starting" || run.state === "queued" ? "running" : run.state,
        nativeHandle: run.nativeHandle || nativeHandle, providerPid: child?.pid || run.providerPid,
        nativeStartedAt: run.nativeStartedAt || new Date().toISOString(), lastHeartbeatAt: new Date().toISOString() }));
    }
    pollRollout();
    stopWhenDue();
  };
  const recordLine = (line) => {
    try { recordEvent(JSON.parse(line)); } catch { /* provider diagnostics remain in the raw log */ }
  };

  let result;
  try {
    result = await silenceWatch.runWatched(provider.command, provider.args, {
      cwd: manifest.workDir || manifest.repoRoot,
      env: providerEnvironment(manifest),
      discardOutput: true,
      // A tool call that was started and not answered is work, not a hang: the stream is quiet while it runs.
      activity: () => tracker.openTools > 0,
      onSpawn: (spawned) => {
        child = spawned;
        try { update((run) => ({ ...run, providerPid: child.pid, lastHeartbeatAt: new Date().toISOString() })); } catch { /* final transition reports */ }
      },
      onOutput: (kind, chunk) => {
        if (kind === "stderr") { logs.stderr.write(chunk); return; }
        logs.stdout.write(chunk);
        stdoutBuffer += chunk.toString("utf8");
        const lines = stdoutBuffer.split(/\r?\n/u);
        stdoutBuffer = lines.pop() || "";
        for (const line of lines.filter(Boolean)) recordLine(line);
      },
    });
  } catch (error) {
    startFailed("PROVIDER_SPAWN", error.message);
    return;
  }
  finalized = true;
  clearTimers();
  if (stdoutBuffer.trim()) recordLine(stdoutBuffer);
  pollRollout(true);
  if (result.spawnError) logs.stderr.write(Buffer.from("provider process error: " + result.spawnError + "\n"));

  const current = readProviderRun(manifest.repoRoot, manifest.scope, manifest.runId);
  const verdict = runVerdict({ stopAction, ownStop, tracker, result, nativeHandle: current.nativeHandle, manifest });
  const stdout = fs.existsSync(stdoutFile) ? fs.readFileSync(stdoutFile) : Buffer.alloc(0);
  const stderr = fs.existsSync(stderrFile) ? fs.readFileSync(stderrFile) : Buffer.alloc(0);
  const truncated = logs.stdout.truncated || logs.stderr.truncated;
  const hints = [...(verdict.hints || [])];
  if (codex && tracker.state.nativeHandle && !rollout?.file) {
    hints.push("the Codex rollout file of thread " + tracker.state.nativeHandle + " was not found under " + rolloutRoot +
      "; the token frame was counted from turn.completed only");
  }
  update((run) => ({ ...run, state: verdict.state, exitCode: result.code, signal: result.signal || null,
    finishedAt: new Date().toISOString(), lastHeartbeatAt: new Date().toISOString(),
    providerOutputDigest: sha256(Buffer.concat([stdout, Buffer.from("\0"), stderr])),
    providerOutputBytes: stdout.length + stderr.length, providerOutputEvidence: false,
    ...(manifest.provider === "codex" ? { tokensUsed: tracker.state.tokensUsed } : {}),
    ...(truncated ? { logTruncated: true, logDroppedBytes: logs.stdout.dropped + logs.stderr.dropped } : {}),
    ...(hints.length ? { hints } : {}),
    ...(verdict.blocked ? { blocked: verdict.blocked } : {}),
    ...(verdict.failure ? { failure: verdict.failure } : {}) }));
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
