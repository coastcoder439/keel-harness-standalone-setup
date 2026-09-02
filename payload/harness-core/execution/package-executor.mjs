#!/usr/bin/env node

// Finite package execution surface. It prepares exact Unlazy leaf contracts,
// records native Claude/Codex handles before any wait, and accepts a return
// only after local gate re-verification. Provider output is never Evidence.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { replaceFileSync } from "./atomic-file.mjs";
import { resolveClaudeExecutable } from "./codex-plugin-bootstrap.mjs";
import {
  launchProviderRun,
  readProviderRun,
  refreshProviderRun,
  requestProviderStop,
} from "./provider-runtime.mjs";
import {
  consumeOwnerApproval,
  createApprovalChallenge,
  readExecutionReceipt,
  writeConsequentialReceipt,
} from "./owner-approval.mjs";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const packageBinding = require("../binding/package-binding.cjs");
const repository = require("../binding/repository.cjs");
const ownerContracts = require("../binding/owner-contract.cjs");
const packageBootstrap = require("../binding/package-bootstrap.cjs");

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const PROVIDERS = new Set(["claude", "codex"]);
const COMMANDS = new Set([
  "start", "next", "dispatch", "return", "verify", "resume", "integrate", "status", "close",
  "abort", "abandon", "heartbeat", "liveness", "timeout", "retry", "reassign", "recover",
  "duty-assess", "duty-add", "duty-resolve", "plan-duty-waiver", "duty-waive",
  "plan-close", "recover-close", "plan-publish", "publish",
]);
const MAX_WAVE_MEMBERS = 8;

function fail(code, message, exitCode = 2) {
  const error = new Error(message);
  error.code = code;
  error.exitCode = exitCode;
  throw error;
}

function id(value, label) {
  const text = String(value || "");
  if (!IDENTIFIER.test(text)) fail("USAGE", label + " must match " + IDENTIFIER);
  return text;
}

function session(value) {
  const text = String(value || "").trim();
  if (!text || text.length > 256 || /[\0\r\n]/u.test(text)) fail("USAGE", "session must be printable and at most 256 characters");
  return text;
}

function digest(value) {
  return "sha256:" + crypto.createHash("sha256").update(value).digest("hex");
}

function parseArgs(argv) {
  const options = { sessions: [], claudePrefixArgs: [] };
  const args = [...argv];
  options.command = args.shift() || "";
  const take = (key) => {
    const value = args.shift();
    if (value === undefined || value === "" || String(value).startsWith("--")) fail("USAGE", key + " requires a value");
    return value;
  };
  while (args.length) {
    const key = args.shift();
    if (key === "--json") options.json = true;
    else if (key === "--approve-checks") options.approveChecks = true;
    else if (key === "--root") options.root = take(key);
    else if (key === "--harness-root") options.harnessRoot = take(key);
    else if (key === "--unlazy-root") options.unlazyRoot = take(key);
    else if (key === "--package") options.packageId = take(key);
    else if (key === "--scope") options.scope = take(key);
    else if (key === "--session") {
      const value = take(key);
      options.sessions.push(value);
      if (!options.sessionId) options.sessionId = value;
    }
    else if (key === "--bootstrap-session") options.bootstrapSession = take(key);
    else if (key === "--leaf") options.leaf = take(key);
    else if (key === "--provider") options.provider = take(key);
    else if (key === "--model") options.model = take(key);
    else if (key === "--effort") options.effort = take(key);
    else if (key === "--wave") options.wave = take(key);
    else if (key === "--result-file") options.resultFile = take(key);
    else if (key === "--expected-result-digest") options.expectedResultDigest = take(key);
    else if (key === "--timeout") options.timeout = take(key);
    else if (key === "--message") options.message = take(key);
    else if (key === "--deadline-seconds") options.deadlineSeconds = take(key);
    else if (key === "--start-timeout-seconds") options.startTimeoutSeconds = take(key);
    else if (key === "--max-turns") options.maxTurns = take(key);
    else if (key === "--claude-executable") options.claudeExecutable = take(key);
    else if (key === "--claude-prefix-arg") options.claudePrefixArgs.push(take(key));
    else if (key === "--reason") options.reason = take(key);
    else if (key === "--new-session") options.newSessionId = take(key);
    else if (key === "--replacement-wave") options.replacementWave = take(key);
    else if (key === "--duty") options.dutyId = take(key);
    else if (key === "--owner") options.owner = take(key);
    else if (key === "--trigger") options.trigger = take(key);
    else if (key === "--due-state") options.dueState = take(key);
    else if (key === "--gate") options.gate = take(key);
    else if (key === "--approval-file") options.approvalFile = take(key);
    else if (key === "--challenge") options.challenge = take(key);
    else if (key === "--receipt") options.receipt = take(key);
    else if (key === "--closure-receipt") options.closureReceipt = take(key);
    else fail("USAGE", "unknown option " + key);
  }
  if (!COMMANDS.has(options.command)) fail("USAGE", "command must be one of " + [...COMMANDS].join(", "));
  return options;
}

function locateUnlazy(repoRoot, explicit) {
  const candidates = explicit ? [path.resolve(explicit)] : [
    path.join(path.resolve(here, "..", "..", ".."), "vendor", "unlazy"),
    path.join(repoRoot, "vendor", "unlazy"),
  ];
  const real = [...new Set(candidates.filter((candidate) =>
    fs.existsSync(path.join(candidate, "scripts", "package-cli.mjs")) &&
    fs.existsSync(path.join(candidate, "scripts", "gate-check.mjs")),
  ).map((candidate) => fs.realpathSync(candidate)))];
  if (real.length !== 1) fail("UNLAZY_ROOT", "expected exactly one Unlazy runtime; found " + real.length);
  return real[0];
}

function runNode(script, args, options = {}) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: options.cwd,
    encoding: "utf8",
    windowsHide: true,
    timeout: options.timeoutMs || 180_000,
    env: { ...process.env, ...(options.env || {}) },
  });
  if (result.error) fail("CHILD_FAILED", result.error.message);
  return result;
}

function childOk(result, operation, allowed = [0]) {
  if (!allowed.includes(result.status)) {
    const output = String(result.stderr || result.stdout || "").trim().slice(0, 2_000);
    fail("CHILD_FAILED", operation + " exited " + result.status + (output ? ": " + output : ""), result.status === 1 ? 1 : 2);
  }
  return String(result.stdout || "");
}

function scripts(unlazyRoot) {
  return {
    packageCli: path.join(unlazyRoot, "scripts", "package-cli.mjs"),
    gateCheck: path.join(unlazyRoot, "scripts", "gate-check.mjs"),
    dispatchCheck: path.join(unlazyRoot, "scripts", "dispatch-check.mjs"),
    gitIntent: path.resolve(here, "..", "git", "git-intent.mjs"),
  };
}

function packageRecord(repoRoot, packageId) {
  const packageDir = path.join(repoRoot, "docs", "packages", packageId);
  const packageFile = path.join(packageDir, "PACKAGE.md");
  if (!fs.existsSync(packageFile)) fail("PACKAGE_MISSING", "missing " + packageFile);
  const packageText = fs.readFileSync(packageFile, "utf8");
  const goalMatches = [...packageText.matchAll(/^\*\*Goal:\*\*\s*(\S.*)$/gmu)];
  if (goalMatches.length !== 1) fail("GOAL_CONTRACT", "PACKAGE.md must contain exactly one one-line Goal");
  const depth = [...packageText.matchAll(/^- LEAF gates\/(leaf-[A-Za-z0-9][A-Za-z0-9._-]{0,58}\.md) <- [^:]+: \S.*$/gmu)]
    .map((match) => match[1].replace(/\.md$/u, ""));
  if (!depth.length || new Set(depth).size !== depth.length) fail("DEPTH_TREE", "PACKAGE.md needs a unique non-empty Depth Tree leaf set");
  for (const leaf of depth) {
    if (!fs.existsSync(path.join(packageDir, "gates", leaf + ".md"))) fail("DEPTH_TREE", "missing ledger for " + leaf);
  }
  const contractIds = [...packageText.matchAll(/^- (C\d+) -> /gmu)].map((match) => match[1]);
  const owner = ownerContracts.inspectOwnerContract(repoRoot, packageDir, packageId, contractIds);
  if (!owner.complete) {
    fail("OWNER_CONTRACT", owner.diagnostics.map((item) => item.code + " " + item.message).join("; "));
  }
  return { packageDir, packageFile, packageText, goal: goalMatches[0][1].trim(), owner, leaves: depth.sort() };
}

function ledgerRecord(packageInfo, leaf) {
  const file = path.join(packageInfo.packageDir, "gates", id(leaf, "leaf") + ".md");
  if (!fs.existsSync(file)) fail("LEAF_MISSING", "unknown leaf " + leaf);
  const text = fs.readFileSync(file, "utf8");
  const gates = [...text.matchAll(/^- \[([ xX])\] ([A-Za-z0-9][A-Za-z0-9._-]{0,63}):\s*(\S.*)$/gmu)];
  if (!gates.length) fail("LEAF_CONTRACT", "leaf ledger has no gates: " + leaf);
  const open = gates.some((match) => match[1] === " ") || /EVIDENCE:\s*pending\s*$/mu.test(text);
  return { file, text, open };
}

function statePath(repoRoot, scope) {
  return path.join(repoRoot, ".unlazy", scope, "executor.json");
}

function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = file + "." + process.pid + "." + crypto.randomBytes(8).toString("hex") + ".tmp";
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
  try { replaceFileSync(temporary, file); }
  finally { try { fs.unlinkSync(temporary); } catch { /* renamed or absent */ } }
}

function readState(context, create = false) {
  const file = statePath(context.repoRoot, context.scope);
  if (!fs.existsSync(file)) {
    if (!create) fail("EXECUTOR_STATE", "no executor state for scope " + context.scope);
    return {
      schemaVersion: 2,
      repoRoot: context.repoRoot,
      harnessRoot: context.harnessRoot,
      gitDir: context.snapshot.gitDir,
      packageId: context.packageId,
      scope: context.scope,
      originalGoal: context.packageInfo.goal,
      originalGoalDigest: digest(context.packageInfo.goal),
      originalOwnerRequest: context.packageInfo.owner.originalRequest,
      originalOwnerDigest: context.packageInfo.owner.digest,
      originalOwnerRequestDigest: context.packageInfo.owner.requestDigest,
      ownerRequirements: context.packageInfo.owner.requirements,
      sessions: {},
      waves: {},
      history: { sessions: {}, waves: {} },
      events: [],
    };
  }
  let value;
  try { value = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { fail("EXECUTOR_STATE", "executor state is invalid JSON"); }
  if (!value || value.schemaVersion !== 2 || value.packageId !== context.packageId || value.scope !== context.scope ||
      !repository.samePath(value.repoRoot, context.repoRoot) || !repository.samePath(value.gitDir, context.snapshot.gitDir) ||
      !value.sessions || !value.waves) fail("EXECUTOR_STATE", "executor state identity does not match the active package");
  if (value.harnessRoot && !repository.samePath(value.harnessRoot, context.harnessRoot)) {
    fail("EXECUTOR_STATE", "executor state Harness control root changed");
  }
  if (value.originalGoalDigest !== digest(value.originalGoal) || value.originalGoal !== context.packageInfo.goal) {
    fail("GOAL_CHANGED", "the original package Goal changed; Owner decision required");
  }
  if (value.originalOwnerDigest !== context.packageInfo.owner.digest ||
      value.originalOwnerRequestDigest !== context.packageInfo.owner.requestDigest ||
      value.originalOwnerRequest !== context.packageInfo.owner.originalRequest) {
    fail("OWNER_CONTRACT_CHANGED", "the immutable Owner request changed; Owner decision required");
  }
  if (!value.history || typeof value.history !== "object") value.history = { sessions: {}, waves: {} };
  if (!value.history.sessions) value.history.sessions = {};
  if (!value.history.waves) value.history.waves = {};
  if (!Array.isArray(value.events)) value.events = [];
  return value;
}

function saveState(context, state) {
  atomicJson(statePath(context.repoRoot, context.scope), state);
}

function transition(state, type, subject, from, to, detail = {}) {
  const previous = state.events.at(-1)?.digest || null;
  const event = {
    sequence: state.events.length + 1,
    at: new Date().toISOString(),
    type,
    subject,
    from: from ?? null,
    to: to ?? null,
    detail,
    previous,
  };
  event.digest = digest(JSON.stringify(event));
  state.events.push(event);
  return event;
}

function setSessionState(state, entry, next, type, detail = {}) {
  const before = entry.state;
  Object.assign(entry, detail, { state: next, updatedAt: new Date().toISOString() });
  if (before !== next || Object.keys(detail).length) transition(state, type, entry.sessionId, before, next, detail);
  return entry;
}

function ensureActive(context) {
  const args = ["activate", "--root", context.repoRoot, "--package", context.packageId, "--scope", context.scope];
  childOk(runNode(context.tools.packageCli, args, { cwd: context.repoRoot }), "package activation");
  childOk(runNode(context.tools.packageCli, ["doctor", "--root", context.repoRoot, "--package", context.packageId],
    { cwd: context.repoRoot }), "package doctor");
}

function contextFor(options, requirePackage = true) {
  const snapshot = repository.repositorySnapshot(options.root || process.cwd());
  const harnessRoot = path.resolve(options.harnessRoot || snapshot.repoRoot);
  const packageId = requirePackage ? id(options.packageId, "package") : options.packageId;
  const scope = id(options.scope || packageId, "scope");
  const unlazyRoot = locateUnlazy(snapshot.repoRoot, options.unlazyRoot);
  const packageInfo = packageRecord(snapshot.repoRoot, packageId);
  return { repoRoot: snapshot.repoRoot, harnessRoot, snapshot, packageId, scope, unlazyRoot, tools: scripts(unlazyRoot), packageInfo };
}

function leafForNext(context, state, explicit) {
  if (explicit) {
    const leaf = id(explicit, "leaf");
    if (!context.packageInfo.leaves.includes(leaf)) fail("LEAF_MISSING", "leaf is not in the Depth Tree: " + leaf);
    if (!ledgerRecord(context.packageInfo, leaf).open) fail("LEAF_COMPLETE", leaf + " already has current Evidence");
    return leaf;
  }
  const busy = new Set(Object.values(state.sessions)
    .filter((entry) => ["prepared", "starting", "running", "provider-returned", "abort-requested", "timeout-requested"]
      .includes(entry.state)).map((entry) => entry.leaf));
  const next = context.packageInfo.leaves.find((leaf) => ledgerRecord(context.packageInfo, leaf).open && !busy.has(leaf));
  if (!next) fail("NO_READY_LEAF", "no unclaimed open leaf remains");
  return next;
}

function safeModel(value, fallback) {
  const text = String(value || fallback);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(text)) fail("USAGE", "invalid model or effort identifier");
  return text;
}

function delegation(provider, briefFile, options) {
  const quoted = JSON.stringify(briefFile);
  if (provider === "codex") {
    const model = safeModel(options.model, "gpt-5.6-sol");
    const effort = safeModel(options.effort, "max");
    if (model !== "gpt-5.6-sol" || effort !== "max") {
      fail("CODEX_DEFAULTS", "delegated Codex package work requires gpt-5.6-sol with effort max");
    }
    return {
      provider,
      model,
      effort,
      pluginCommand: `/codex:rescue --wait --fresh --model ${model} --effort ${effort} ` +
        `Read ${quoted}, execute exactly that bound leaf contract, and return the Codex runtime result unchanged.`,
    };
  }
  return {
    provider,
    model: null,
    effort: null,
    pluginCommand: `claude -p --output-format stream-json --verbose ` +
      `${JSON.stringify(`Read ${briefFile} and execute exactly that bound leaf contract.`)}`,
  };
}

function writeBrief(context, state, entry, ledger) {
  const directory = path.join(context.repoRoot, ".unlazy", context.scope, "executor", "briefs");
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, crypto.createHash("sha256").update(entry.sessionId).digest("hex") + ".md");
  const binding = packageBinding.findSessionBinding(context.harnessRoot, entry.sessionId, { controlRoot: context.harnessRoot });
  const value = [
    "# Bound Harness leaf",
    "",
    `Repository: ${context.repoRoot}`,
    `Package: ${context.packageId}`,
    `Scope: ${context.scope}`,
    `Session: ${entry.sessionId}`,
    `Leaf: ${entry.leaf}`,
    `Leaf ledger: ${binding.leafLedger}`,
    `Original Goal digest: ${state.originalGoalDigest}`,
    `Owner contract digest: ${state.originalOwnerDigest}`,
    `Owner request digest: ${state.originalOwnerRequestDigest}`,
    "",
    "## Original Owner request (immutable)",
    "",
    state.originalOwnerRequest,
    "",
    "## Owner requirements",
    "",
    ...state.ownerRequirements.map((item) => `- ${item.requirementId} -> ${item.contractId}: ${item.text}`),
    "",
    "## Derived package Goal (immutable during this run)",
    "",
    state.originalGoal,
    "",
    "## Exact leaf contract",
    "",
    ledger.text.trimEnd(),
    "",
    "## Execution rules",
    "",
    "- Write only inside the exact OWNS patterns above; hooks verify the session binding.",
    "- Use the finite Git intent interface; do not search for alternate mutating Git commands.",
    "- Do not mark gates or package plan items complete yourself.",
    "- Return facts and the native provider handle. The parent locally reverifies the gate.",
    "- Provider success is not Evidence and does not satisfy the original Owner request.",
    "",
  ].join("\n");
  fs.writeFileSync(file, value, { encoding: "utf8", flag: fs.existsSync(file) ? "w" : "wx" });
  return { file, digest: digest(value), binding };
}

function prepare(context, options, explicitLeaf) {
  ensureActive(context);
  const state = readState(context, true);
  const sessionId = session(options.sessionId);
  const bootstrapSessionId = options.bootstrapSession ? session(options.bootstrapSession) : null;
  if (bootstrapSessionId) {
    const bootstrapRecord = packageBootstrap.find({ harnessRoot: context.harnessRoot, sessionId: bootstrapSessionId });
    if (!repository.samePath(bootstrapRecord.repoRoot, context.repoRoot) ||
        bootstrapRecord.packageId !== context.packageId || bootstrapRecord.scope !== context.scope) {
      fail("BOOTSTRAP_IDENTITY", "bootstrap session does not own this repository, package, and scope");
    }
  }
  if (state.sessions[sessionId]) {
    const existing = state.sessions[sessionId];
    if (existing.state !== "prepared") fail("SESSION_EXISTS", "session already exists in state " + existing.state);
    return { state, entry: existing, idempotent: true };
  }
  const leaf = leafForNext(context, state, explicitLeaf);
  const provider = String(options.provider || "codex");
  if (!PROVIDERS.has(provider)) fail("USAGE", "provider must be claude or codex");
  const ledger = ledgerRecord(context.packageInfo, leaf);
  childOk(runNode(context.tools.gateCheck, ["--claim", "--root", context.repoRoot, "--package", context.packageId,
    "--scope", context.scope, "--leaf", leaf], { cwd: context.repoRoot }), "leaf claim");
  try {
    packageBinding.createBinding({ startPath: context.repoRoot, packageId: context.packageId,
      scope: context.scope, sessionId, leaf, controlRoot: context.harnessRoot });
    const entry = {
      sessionId,
      leaf,
      provider,
      state: "prepared",
      preparedAt: new Date().toISOString(),
      wave: null,
      handle: null,
      runId: null,
      attempt: 1,
      attempts: [],
    };
    const brief = writeBrief(context, state, entry, ledger);
    Object.assign(entry, { briefFile: path.relative(context.repoRoot, brief.file).replaceAll("\\", "/"),
      briefDigest: brief.digest, owns: brief.binding.owns, delegation: delegation(provider, brief.file, options) });
    state.sessions[sessionId] = entry;
    transition(state, "session-prepared", sessionId, null, "prepared", { leaf, provider, attempt: 1 });
    saveState(context, state);
    if (bootstrapSessionId) packageBootstrap.finish({ harnessRoot: context.harnessRoot, sessionId: bootstrapSessionId });
    return { state, entry, idempotent: false };
  } catch (error) {
    runNode(context.tools.gateCheck, ["--release", "--root", context.repoRoot, "--package", context.packageId,
      "--scope", context.scope, "--leaf", leaf], { cwd: context.repoRoot });
    throw error;
  }
}

function dispatchSessions(state, values) {
  const selected = values.length ? values.map((value) => session(value)) :
    Object.values(state.sessions).filter((entry) => entry.state === "prepared").map((entry) => entry.sessionId);
  if (!selected.length) fail("USAGE", "dispatch requires at least one prepared --session");
  if (selected.length > MAX_WAVE_MEMBERS) fail("WAVE_BOUND", "dispatch is bounded to " + MAX_WAVE_MEMBERS + " sessions per wave");
  if (new Set(selected).size !== selected.length) fail("USAGE", "dispatch sessions must be unique");
  return selected.map((sessionId) => {
    const entry = state.sessions[sessionId];
    if (!entry || entry.state !== "prepared") fail("SESSION_STATE", sessionId + " is not prepared");
    return entry;
  });
}

function providerSessionState(run) {
  if (["queued", "starting"].includes(run.state)) return "starting";
  return run.state;
}

async function synchronizeSession(context, state, entry) {
  if (!entry.runId) return entry;
  const run = await refreshProviderRun({ repoRoot: context.repoRoot, scope: context.scope, runId: entry.runId,
    expected: { packageId: context.packageId, sessionId: entry.sessionId, leaf: entry.leaf, provider: entry.provider } });
  const next = providerSessionState(run);
  const detail = {
    runId: run.runId,
    handle: run.nativeHandle || entry.handle || null,
    deadlineAt: run.deadlineAt,
    lastHeartbeatAt: run.lastHeartbeatAt,
    providerOutputDigest: run.providerOutputDigest || entry.providerOutputDigest || null,
    providerOutputEvidence: false,
    ...(run.failure ? { failure: run.failure } : {}),
  };
  if (entry.state !== next || entry.lastHeartbeatAt !== detail.lastHeartbeatAt || entry.handle !== detail.handle) {
    setSessionState(state, entry, next, "provider-sync", detail);
    saveState(context, state);
  }
  return entry;
}

async function dispatch(context, options) {
  ensureActive(context);
  const state = readState(context);
  const wave = id(options.wave, "wave");
  if (state.waves[wave]) fail("WAVE_EXISTS", "wave already recorded: " + wave);
  const entries = dispatchSessions(state, options.sessions);
  const leaves = entries.map((entry) => entry.leaf);
  if (new Set(leaves).size !== leaves.length) fail("WAVE_DUPLICATE_LEAF", "a wave may start each leaf only once");
  const base = ["--root", context.repoRoot, "--package", context.packageId, "--scope", context.scope, "--wave", wave];
  const launched = [];
  try {
    childOk(runNode(context.tools.dispatchCheck, ["open", ...base, ...leaves.flatMap((leaf) => ["--leaf", leaf])],
      { cwd: context.repoRoot }), "dispatch open");
    state.waves[wave] = { state: "open", leaves, sessions: entries.map((entry) => entry.sessionId), openedAt: new Date().toISOString() };
    transition(state, "wave-opened", wave, null, "open", { leaves, sessions: state.waves[wave].sessions });
    saveState(context, state);
    for (const entry of entries) {
      setSessionState(state, entry, "starting", "provider-starting", { wave, startedAt: new Date().toISOString() });
      saveState(context, state);
      let run;
      try {
        run = await launchProviderRun({
          repoRoot: context.repoRoot,
          packageId: context.packageId,
          scope: context.scope,
          sessionId: entry.sessionId,
          leaf: entry.leaf,
          provider: entry.provider,
          briefFile: path.resolve(context.repoRoot, entry.briefFile),
          deadlineSeconds: options.deadlineSeconds || 900,
          startTimeoutSeconds: options.startTimeoutSeconds || 30,
          maxTurns: options.maxTurns || 32,
          claudeExecutable: resolveClaudeExecutable(options.claudeExecutable),
          claudePrefixArgs: options.claudePrefixArgs,
          attempt: entry.attempt || 1,
        });
      } catch (error) {
        run = error.run || null;
        const detail = {
          wave,
          runId: run?.runId || null,
          handle: run?.nativeHandle || null,
          failure: run?.failure || { code: error.code || "PROVIDER_START_FAILED", message: error.message },
          failedAt: new Date().toISOString(),
        };
        setSessionState(state, entry, "provider-start-failed", "provider-start-failed", detail);
        throw error;
      }
      launched.push(run);
      setSessionState(state, entry, providerSessionState(run), "provider-started", {
        wave,
        runId: run.runId,
        handle: run.nativeHandle,
        deadlineAt: run.deadlineAt,
        lastHeartbeatAt: run.lastHeartbeatAt,
        nativeStartedAt: run.nativeStartedAt || new Date().toISOString(),
        providerOutputEvidence: false,
      });
      childOk(runNode(context.tools.dispatchCheck,
        ["start", ...base, "--leaf", entry.leaf, "--handle", run.nativeHandle], { cwd: context.repoRoot }), "dispatch start");
      saveState(context, state);
    }
    childOk(runNode(context.tools.dispatchCheck, ["seal", ...base], { cwd: context.repoRoot }), "dispatch seal");
  } catch (error) {
    for (const run of launched) {
      try {
        await requestProviderStop({ repoRoot: context.repoRoot, scope: context.scope, runId: run.runId,
          action: "abort", reason: "another provider failed before dispatch sealing" });
        const entry = state.sessions[run.sessionId];
        if (entry && !["verified", "reassigned"].includes(entry.state)) {
          setSessionState(state, entry, "abort-requested", "provider-abort-requested", {
            runId: run.runId,
            wave,
            reason: "dispatch wave could not be sealed",
          });
        }
      } catch { /* preserve the original start failure and durable run state */ }
    }
    runNode(context.tools.dispatchCheck, ["abandon", ...base, "--reason", "executor dispatch failed before wait"],
      { cwd: context.repoRoot });
    if (state.waves[wave]) {
      const before = state.waves[wave].state;
      Object.assign(state.waves[wave], { state: "abandoned", abandonedAt: new Date().toISOString(),
        reason: "executor dispatch failed before wait" });
      transition(state, "wave-abandoned", wave, before, "abandoned", { reason: state.waves[wave].reason });
    }
    saveState(context, state);
    throw error;
  }
  const now = new Date().toISOString();
  Object.assign(state.waves[wave], { state: "sealed", sealedAt: now });
  transition(state, "wave-sealed", wave, "open", "sealed", { members: entries.length });
  saveState(context, state);
  return { wave, state: "sealed", members: entries.map((entry) => ({ sessionId: entry.sessionId,
    leaf: entry.leaf, runId: entry.runId, handle: entry.handle, provider: entry.provider })) };
}

function verifyLeaf(context, entry, options) {
  const timeout = String(options.timeout || "120");
  const result = runNode(context.tools.gateCheck, ["--reverify", "--timeout", timeout, "--root", context.repoRoot,
    "--package", context.packageId, "--scope", context.scope, "--leaf", entry.leaf],
  { cwd: context.repoRoot, timeoutMs: (Number(timeout) + 10) * 1_000 });
  childOk(result, "local leaf re-verification");
  return String(result.stdout || "");
}

async function returnLeaf(context, options) {
  ensureActive(context);
  const state = readState(context);
  const sessionId = session(options.sessionId);
  const entry = state.sessions[sessionId];
  if (!entry) fail("SESSION_STATE", "unknown session");
  await synchronizeSession(context, state, entry);
  if (entry.state !== "provider-returned") {
    fail("SESSION_STATE", "session provider has not returned successfully; current state is " + entry.state, 1);
  }
  const gateOutput = verifyLeaf(context, entry, options);
  const base = ["--root", context.repoRoot, "--package", context.packageId, "--scope", context.scope,
    "--wave", entry.wave, "--leaf", entry.leaf];
  childOk(runNode(context.tools.dispatchCheck, ["return", ...base], { cwd: context.repoRoot }), "dispatch return");
  childOk(runNode(context.tools.gateCheck, ["--release", "--root", context.repoRoot, "--package", context.packageId,
    "--scope", context.scope, "--leaf", entry.leaf], { cwd: context.repoRoot }), "leaf release");
  let resultDigest = null;
  if (options.resultFile) {
    const resultFile = path.resolve(context.repoRoot, options.resultFile);
    if (!repository.isPathInside(context.repoRoot, resultFile) || !fs.existsSync(resultFile) || !fs.statSync(resultFile).isFile()) {
      fail("RESULT_FILE", "result file must be a regular file inside the repository");
    }
    resultDigest = digest(fs.readFileSync(resultFile));
  }
  setSessionState(state, entry, "verified", "leaf-returned", { returnedAt: new Date().toISOString(),
    gateOutputDigest: digest(gateOutput), resultDigest, providerOutputEvidence: false, locallyReverified: true });
  const waveSessions = state.waves[entry.wave].sessions.map((value) => state.sessions[value]);
  if (waveSessions.every((value) => value.state === "verified")) {
    state.waves[entry.wave].state = "complete";
    state.waves[entry.wave].completedAt = new Date().toISOString();
    transition(state, "wave-complete", entry.wave, "sealed", "complete", { sessions: state.waves[entry.wave].sessions });
  }
  saveState(context, state);
  return { sessionId, leaf: entry.leaf, state: entry.state, wave: entry.wave, runId: entry.runId,
    handle: entry.handle, providerOutputEvidence: false, locallyReverified: true };
}

function transitionReason(options, fallback) {
  const value = String(options.reason || fallback || "").trim();
  if (!value || value.length > 500 || /[\0\r\n]/u.test(value)) fail("USAGE", "--reason must be one line of 1..500 characters");
  return value;
}

async function abandonWave(context, state, waveId, reason, timeoutSession = null) {
  const wave = state.waves[waveId];
  if (!wave || !["open", "sealed"].includes(wave.state)) {
    fail("WAVE_STATE", "wave must be open or sealed before abandon; current state is " + (wave?.state || "missing"));
  }
  for (const sessionId of wave.sessions) {
    const entry = state.sessions[sessionId];
    if (!entry || ["verified", "reassigned"].includes(entry.state)) continue;
    const action = sessionId === timeoutSession ? "timeout" : "abort";
    if (entry.runId) {
      try {
        await requestProviderStop({ repoRoot: context.repoRoot, scope: context.scope, runId: entry.runId, action, reason });
      } catch (error) {
        if (!["provider-start-failed", "provider-returned", "provider-failed", "aborted", "timed-out", "vanished"]
          .includes(readProviderRun(context.repoRoot, context.scope, entry.runId).state)) throw error;
      }
    }
    const next = action === "timeout" ? "timeout-requested" : "abort-requested";
    if (!["provider-start-failed", "provider-failed", "aborted", "timed-out", "vanished"].includes(entry.state)) {
      setSessionState(state, entry, next, action + "-requested", { reason, requestedAt: new Date().toISOString() });
    }
  }
  const base = ["--root", context.repoRoot, "--package", context.packageId, "--scope", context.scope,
    "--wave", waveId, "--reason", reason];
  childOk(runNode(context.tools.dispatchCheck, ["abandon", ...base], { cwd: context.repoRoot }), "dispatch abandon");
  const before = wave.state;
  Object.assign(wave, { state: "abandoned", reason, abandonedAt: new Date().toISOString() });
  transition(state, "wave-abandoned", waveId, before, "abandoned", { reason, timeoutSession });
  saveState(context, state);
  return wave;
}

async function abortExecution(context, options) {
  ensureActive(context);
  const state = readState(context);
  const sessionId = session(options.sessionId);
  const entry = state.sessions[sessionId];
  if (!entry) fail("SESSION_STATE", "unknown session");
  const reason = transitionReason(options, "Owner or parent aborted the bounded provider run");
  if (!entry.wave) {
    if (entry.state !== "prepared") fail("SESSION_STATE", "unlaunched abort requires a prepared session");
    setSessionState(state, entry, "aborted", "session-aborted", { reason, abortedAt: new Date().toISOString() });
    saveState(context, state);
    return publicEntry(entry);
  }
  await abandonWave(context, state, entry.wave, reason);
  return { sessionId, wave: entry.wave, state: state.waves[entry.wave].state, reason };
}

async function abandonExecution(context, options) {
  ensureActive(context);
  const state = readState(context);
  const wave = id(options.wave, "wave");
  const reason = transitionReason(options, "parent abandoned the dispatch wave");
  await abandonWave(context, state, wave, reason);
  return { wave, state: state.waves[wave].state, reason };
}

async function timeoutExecution(context, options) {
  ensureActive(context);
  const state = readState(context);
  const sessionId = session(options.sessionId);
  const entry = state.sessions[sessionId];
  if (!entry || !entry.wave) fail("SESSION_STATE", "timeout requires a dispatched session");
  const reason = transitionReason(options, "provider heartbeat or deadline timed out");
  await abandonWave(context, state, entry.wave, reason, sessionId);
  return { sessionId, wave: entry.wave, state: "timeout-requested", reason };
}

async function liveness(context, options) {
  ensureActive(context);
  const state = readState(context);
  const sessionId = session(options.sessionId);
  const entry = state.sessions[sessionId];
  if (!entry) fail("SESSION_STATE", "unknown session");
  await synchronizeSession(context, state, entry);
  const run = entry.runId ? readProviderRun(context.repoRoot, context.scope, entry.runId) : null;
  return {
    sessionId,
    leaf: entry.leaf,
    state: entry.state,
    runId: entry.runId,
    handle: entry.handle,
    heartbeatAt: run?.lastHeartbeatAt || null,
    deadlineAt: run?.deadlineAt || null,
    deadlineExpired: run ? Date.now() >= Date.parse(run.deadlineAt) : false,
    providerOutputEvidence: false,
  };
}

function retryExecution(context, options) {
  ensureActive(context);
  const state = readState(context);
  const sessionId = session(options.sessionId);
  const entry = state.sessions[sessionId];
  const retryable = new Set(["provider-start-failed", "provider-failed", "aborted", "timed-out", "vanished",
    "abort-requested", "timeout-requested"]);
  if (!entry || !retryable.has(entry.state)) fail("SESSION_STATE", "session is not in a retryable terminal state");
  if (entry.wave && state.waves[entry.wave] && state.waves[entry.wave].state !== "abandoned") {
    fail("WAVE_STATE", "retry requires the prior dispatch wave to be abandoned first");
  }
  entry.attempts ||= [];
  entry.attempts.push({ attempt: entry.attempt || 1, state: entry.state, wave: entry.wave || null,
    runId: entry.runId || null, handle: entry.handle || null, failure: entry.failure || null,
    archivedAt: new Date().toISOString() });
  const before = entry.state;
  Object.assign(entry, { state: "prepared", attempt: (entry.attempt || 1) + 1, wave: null, runId: null,
    handle: null, failure: null, preparedAt: new Date().toISOString(), deadlineAt: null, lastHeartbeatAt: null });
  transition(state, "session-retry-prepared", sessionId, before, "prepared", { attempt: entry.attempt });
  saveState(context, state);
  return publicEntry(entry);
}

function reassignExecution(context, options) {
  ensureActive(context);
  const state = readState(context);
  const sourceId = session(options.sessionId);
  const targetId = session(options.newSessionId);
  const source = state.sessions[sourceId];
  if (!source) fail("SESSION_STATE", "unknown source session");
  if (state.sessions[targetId]) fail("SESSION_EXISTS", "reassignment target session already exists");
  if (source.wave && state.waves[source.wave] && state.waves[source.wave].state !== "abandoned") {
    fail("WAVE_STATE", "reassignment requires the prior dispatch wave to be abandoned first");
  }
  if (!["provider-start-failed", "provider-failed", "aborted", "timed-out", "vanished", "abort-requested", "timeout-requested"]
    .includes(source.state)) fail("SESSION_STATE", "source session is not reassignable");
  const provider = String(options.provider || source.provider);
  if (!PROVIDERS.has(provider)) fail("USAGE", "provider must be claude or codex");
  const ledger = ledgerRecord(context.packageInfo, source.leaf);
  packageBinding.createBinding({ startPath: context.repoRoot, packageId: context.packageId,
    scope: context.scope, sessionId: targetId, leaf: source.leaf, controlRoot: context.harnessRoot });
  const target = {
    sessionId: targetId,
    leaf: source.leaf,
    provider,
    state: "prepared",
    preparedAt: new Date().toISOString(),
    wave: null,
    handle: null,
    runId: null,
    attempt: 1,
    attempts: [],
  };
  const brief = writeBrief(context, state, target, ledger);
  Object.assign(target, { briefFile: path.relative(context.repoRoot, brief.file).replaceAll("\\", "/"),
    briefDigest: brief.digest, owns: brief.binding.owns, delegation: delegation(provider, brief.file, options) });
  setSessionState(state, source, "reassigned", "session-reassigned", { replacedBy: targetId, reassignedAt: new Date().toISOString() });
  state.sessions[targetId] = target;
  transition(state, "session-prepared", targetId, null, "prepared", { leaf: target.leaf, provider, reassignedFrom: sourceId });
  saveState(context, state);
  return { from: publicEntry(source), to: publicEntry(target), ownershipPreserved: true };
}

function recoverExecution(context, options) {
  ensureActive(context);
  const state = readState(context);
  const wave = id(options.wave, "wave");
  const replacementWave = id(options.replacementWave, "replacement wave");
  const abandoned = state.waves[wave];
  const replacement = state.waves[replacementWave];
  if (!abandoned || abandoned.state !== "abandoned") fail("WAVE_STATE", "recover requires an abandoned source wave");
  if (!replacement || replacement.state !== "complete") fail("WAVE_STATE", "recover requires a complete replacement wave");
  const replacementLeaves = new Set(replacement.leaves);
  for (const leaf of abandoned.leaves) {
    if (!replacementLeaves.has(leaf)) {
      fail("RECOVERY_INCOMPLETE", "replacement wave does not own abandoned leaf " + leaf, 1);
    }
    const verified = replacement.sessions.map((sessionId) => state.sessions[sessionId])
      .find((entry) => entry?.leaf === leaf && entry.state === "verified");
    if (!verified) fail("RECOVERY_INCOMPLETE", "leaf " + leaf + " has no locally verified replacement", 1);
  }
  childOk(runNode(context.tools.dispatchCheck, ["recover", "--root", context.repoRoot, "--package", context.packageId,
    "--scope", context.scope, "--wave", wave, "--replacement-wave", replacementWave],
  { cwd: context.repoRoot }), "dispatch recovery");
  state.history.waves[wave] = { ...abandoned, state: "recovered", replacementWave, recoveredAt: new Date().toISOString() };
  delete state.waves[wave];
  for (const sessionId of abandoned.sessions) {
    const entry = state.sessions[sessionId];
    if (!entry || entry.state === "verified" || entry.wave === replacementWave) continue;
    state.history.sessions[sessionId] = { ...entry, archivedAt: new Date().toISOString() };
    delete state.sessions[sessionId];
  }
  transition(state, "wave-recovered", wave, "abandoned", "recovered", { replacementWave });
  saveState(context, state);
  return { wave, state: "recovered", replacementWave, ownershipPreserved: true };
}

function parseIntentOutput(output) {
  const line = String(output || "").split(/\r?\n/u).find((item) => item.startsWith("GIT_INTENT_OK "));
  if (!line) fail("INTEGRATION_GIT", "Git intent returned no result");
  try { return JSON.parse(line.slice("GIT_INTENT_OK ".length)); }
  catch { fail("INTEGRATION_GIT", "Git intent returned invalid JSON"); }
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function currentHead(repoRoot) {
  const result = spawnSync("git", ["-C", repoRoot, "rev-parse", "--verify", "HEAD"], {
    encoding: "utf8", windowsHide: true, timeout: 30_000,
  });
  if (result.error || result.status !== 0) fail("GIT_HEAD", "cannot resolve current Git HEAD");
  return String(result.stdout).trim();
}

function dutiesFile(context) {
  return path.join(context.repoRoot, ".unlazy", context.scope, "duties.json");
}

function readDuties(context) {
  const file = dutiesFile(context);
  if (!fs.existsSync(file)) fail("DUTIES_STATE", "active package has no durable follow-up duty state");
  let value;
  try { value = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { fail("DUTIES_STATE", "follow-up duty state is invalid JSON"); }
  if (!value || value.schema !== 1 || value.packageId !== context.packageId || value.scope !== context.scope ||
      !value.assessment || !value.duties || typeof value.duties !== "object") {
    fail("DUTIES_STATE", "follow-up duty state identity is invalid");
  }
  return value;
}

function dutyStateDigest(value) {
  return digest(JSON.stringify(canonical(value)));
}

function packageCliJson(context, args, operation) {
  const result = runNode(context.tools.packageCli, [...args, "--json", "--root", context.repoRoot,
    "--package", context.packageId, "--scope", context.scope], { cwd: context.repoRoot });
  const output = childOk(result, operation);
  try { return JSON.parse(output); }
  catch { fail("CHILD_FAILED", operation + " returned invalid JSON"); }
}

function dutyTransition(context, options) {
  ensureActive(context);
  const command = options.command;
  const args = [command];
  if (options.dutyId) args.push("--duty", id(options.dutyId, "duty"));
  if (options.owner) args.push("--owner", options.owner);
  if (options.trigger) args.push("--trigger", options.trigger);
  if (options.dueState) args.push("--due-state", options.dueState);
  if (options.gate) args.push("--gate", options.gate);
  if (options.receipt) args.push("--waiver-receipt", options.receipt);
  return packageCliJson(context, args, command);
}

function planDutyWaiver(context, options) {
  ensureActive(context);
  const duties = readDuties(context);
  const dutyId = id(options.dutyId, "duty");
  const duty = duties.duties[dutyId];
  if (!duty || !["open", "due"].includes(duty.dueState)) fail("DUTY_STATE", "waiver plan requires an open or due duty");
  return createApprovalChallenge({
    repoRoot: context.repoRoot,
    action: "waive-duty",
    packageId: context.packageId,
    scope: context.scope,
    dutyId,
    subject: { duty, dutiesDigest: dutyStateDigest(duties), ownerDigest: context.packageInfo.owner.digest,
      head: currentHead(context.repoRoot) },
  });
}

async function waiveDuty(context, options) {
  ensureActive(context);
  if (!options.challenge || !options.approvalFile) fail("USAGE", "duty-waive requires --challenge and --approval-file");
  const consumed = await consumeOwnerApproval({ repoRoot: context.repoRoot, unlazyRoot: context.unlazyRoot,
    challenge: options.challenge, approvalFile: options.approvalFile });
  const before = readDuties(context);
  const duty = before.duties[id(options.dutyId, "duty")];
  if (!duty || consumed.subject.dutiesDigest !== dutyStateDigest(before) ||
      consumed.subject.head !== currentHead(context.repoRoot) || consumed.subject.ownerDigest !== context.packageInfo.owner.digest) {
    fail("OWNER_APPROVAL_STALE", "duty waiver approval is stale", 1);
  }
  const result = packageCliJson(context, ["duty-waive", "--duty", duty.id,
    "--waiver-receipt", consumed.approvalReceipt], "duty waiver");
  const receipt = writeConsequentialReceipt({ repoRoot: context.repoRoot, action: "waive-duty",
    packageId: context.packageId, scope: context.scope, approvalReceipt: consumed.approvalReceipt,
    result: { dutyId: duty.id, dueState: "waived", dutiesDigest: dutyStateDigest(result) } });
  return { duty: result.duties[duty.id], approvalReceipt: consumed.approvalReceipt, waiverReceipt: receipt.receipt };
}

function completePlanFromEvidence(context) {
  const current = fs.readFileSync(context.packageInfo.packageFile, "utf8");
  if (current !== context.packageInfo.packageText) {
    fail("PACKAGE_CHANGED", "PACKAGE.md changed during integration; retry against current package truth");
  }
  const matches = [...current.matchAll(/^(\d+)\. \[([ xX])\] (\S.*)$/gmu)];
  if (!matches.length) fail("PACKAGE_PLAN", "PACKAGE.md has no numbered Plan steps");
  const next = current.replace(/^(\d+)\. \[[ xX]\] (\S.*)$/gmu, "$1. [x] $2");
  if (next === current) return false;
  const temporary = context.packageInfo.packageFile + "." + process.pid + "." + crypto.randomBytes(8).toString("hex") + ".tmp";
  fs.writeFileSync(temporary, next, { encoding: "utf8", flag: "wx" });
  try { replaceFileSync(temporary, context.packageInfo.packageFile); }
  finally { try { fs.unlinkSync(temporary); } catch { /* renamed or absent */ } }
  return true;
}

function acceptedResultConstraint(context, state, options) {
  if (!options.resultFile && !options.expectedResultDigest) return null;
  if (!options.resultFile || !options.expectedResultDigest) {
    fail("USAGE", "integrate requires --result-file and --expected-result-digest together");
  }
  const expectedDigest = String(options.expectedResultDigest);
  if (!/^sha256:[a-f0-9]{64}$/u.test(expectedDigest)) fail("USAGE", "--expected-result-digest must be a sha256 digest");
  if (!Object.values(state.sessions).some((entry) => entry.resultDigest === expectedDigest)) {
    fail("ACCEPTED_RESULT_UNBOUND", "accepted result digest is not bound to a locally verified leaf return", 1);
  }
  const absolute = path.resolve(context.repoRoot, options.resultFile);
  if (!repository.isPathInside(context.repoRoot, absolute) || !fs.existsSync(absolute)) {
    fail("ACCEPTED_RESULT_FILE", "accepted result file must be inside the repository", 1);
  }
  const info = fs.lstatSync(absolute);
  if (!info.isFile() || info.isSymbolicLink() || (typeof info.nlink === "number" && info.nlink !== 1)) {
    fail("ACCEPTED_RESULT_FILE", "accepted result file must be a single-link regular file", 1);
  }
  if (digest(fs.readFileSync(absolute)) !== expectedDigest) {
    fail("ACCEPTED_RESULT_CHANGED", "accepted result file changed after local verification or Owner acceptance", 1);
  }
  return {
    file: path.relative(context.repoRoot, absolute).replaceAll("\\", "/"),
    digest: expectedDigest,
  };
}

function integrate(context, options) {
  ensureActive(context);
  const state = readState(context);
  if (!Object.keys(state.sessions).length || Object.values(state.sessions).some((entry) => entry.state !== "verified")) {
    fail("OPEN_EXECUTION", "every bound leaf session must return with local Evidence before integration", 1);
  }
  if (Object.values(state.waves).some((entry) => entry.state !== "complete")) {
    fail("OPEN_EXECUTION", "every dispatch wave must be complete before integration", 1);
  }
  const acceptedResult = acceptedResultConstraint(context, state, options);
  const timeout = String(options.timeout || "120");
  const gateMode = options.approveChecks ? "--approve" : "--reverify";
  const verified = runNode(context.tools.gateCheck, [gateMode, "--timeout", timeout, "--root", context.repoRoot,
    "--package", context.packageId, "--scope", context.scope], { cwd: context.repoRoot,
    timeoutMs: (Number(timeout) + 10) * 1_000 });
  childOk(verified, "bottom-up integration re-verification");
  if (acceptedResult) acceptedResultConstraint(context, state, options);
  const planCompleted = completePlanFromEvidence(context);
  const message = String(options.message || "").trim();
  const integrationArgs = ["integration-checkpoint", "--root", context.repoRoot,
    "--package", context.packageId, "--scope", context.scope, "--message", message];
  if (acceptedResult) integrationArgs.push("--expected-result-file", acceptedResult.file,
    "--expected-result-digest", acceptedResult.digest);
  const result = runNode(context.tools.gitIntent, integrationArgs,
  { cwd: context.repoRoot, timeoutMs: 180_000 });
  const checkpoint = parseIntentOutput(childOk(result, "integration checkpoint"));
  const postCommit = runNode(context.tools.gateCheck, ["--reverify", "--timeout", timeout, "--root", context.repoRoot,
    "--package", context.packageId, "--scope", context.scope], { cwd: context.repoRoot,
    timeoutMs: (Number(timeout) + 10) * 1_000 });
  childOk(postCommit, "post-checkpoint local re-verification");
  const dirty = spawnSync("git", ["-C", context.repoRoot, "status", "--porcelain=v1", "--", ...checkpoint.paths], {
    cwd: context.repoRoot, encoding: "utf8", windowsHide: true, timeout: 30_000,
  });
  if (dirty.error || dirty.status !== 0 || String(dirty.stdout || "").trim()) {
    fail("POST_VERIFY_DIRTY", "local re-verification changed integrated paths after their checkpoint", 1);
  }
  return { ...checkpoint, locallyReverified: true, planCompleted,
    gateOutputDigest: digest(String(postCommit.stdout || "")) };
}

async function status(context) {
  ensureActive(context);
  const state = readState(context, true);
  for (const entry of Object.values(state.sessions)) {
    if (entry.runId && !["verified", "reassigned"].includes(entry.state)) await synchronizeSession(context, state, entry);
  }
  const result = runNode(context.tools.packageCli, ["status", "--json", "--root", context.repoRoot,
    "--package", context.packageId], { cwd: context.repoRoot });
  const output = childOk(result, "package status", [0, 1]);
  return { executor: state, package: JSON.parse(output) };
}

function assertCloseReady(context, state) {
  const notVerified = Object.values(state.sessions).filter((entry) => entry.state !== "verified");
  if (notVerified.length) {
    fail("OPEN_EXECUTION", "every retained leaf session must be locally verified before close: " +
      notVerified.map((entry) => entry.sessionId + "=" + entry.state).join(", "), 1);
  }
  const openWaves = Object.entries(state.waves).filter(([, wave]) => wave.state !== "complete");
  if (openWaves.length) fail("OPEN_EXECUTION", "every retained dispatch wave must be complete before close", 1);
  if (Object.keys(state.sessions).length && state.integration?.state !== "committed") {
    fail("INTEGRATION_REQUIRED", "verified leaf work must pass one integration checkpoint before close", 1);
  }
  if (state.originalGoal !== context.packageInfo.goal) fail("GOAL_CHANGED", "the derived package Goal changed");
  if (state.originalOwnerDigest !== context.packageInfo.owner.digest) {
    fail("OWNER_CONTRACT_CHANGED", "the immutable Owner request changed");
  }
}

function assertDutiesReady(duties) {
  if (duties.assessment.state !== "complete") fail("DUTIES_UNKNOWN", "follow-up duties remain unknown", 1);
  const open = Object.values(duties.duties).filter((duty) => !["fulfilled", "waived"].includes(duty.dueState));
  if (open.length) fail("DUTIES_OPEN", "open follow-up duties block close: " +
    open.map((duty) => duty.id + "=" + duty.dueState).join(", "), 1);
}

function planClose(context, options) {
  ensureActive(context);
  const state = readState(context);
  assertCloseReady(context, state);
  const timeout = String(options.timeout || "120");
  const verified = runNode(context.tools.gateCheck, ["--reverify", "--timeout", timeout, "--root", context.repoRoot,
    "--package", context.packageId, "--scope", context.scope], { cwd: context.repoRoot,
    timeoutMs: (Number(timeout) + 10) * 1_000 });
  childOk(verified, "bottom-up package re-verification");
  const duties = readDuties(context);
  assertDutiesReady(duties);
  const planned = parseIntentOutput(childOk(runNode(context.tools.gitIntent,
    ["plan-close", "--root", context.repoRoot, "--package", context.packageId, "--scope", context.scope],
    { cwd: context.repoRoot, timeoutMs: 30_000 }), "close checkpoint plan"));
  const challenge = createApprovalChallenge({
    repoRoot: context.repoRoot,
    action: "close",
    packageId: context.packageId,
    scope: context.scope,
    subject: {
      planReceipt: planned.receipt,
      head: currentHead(context.repoRoot),
      packageDigest: digest(fs.readFileSync(context.packageInfo.packageFile, "utf8")),
      ownerDigest: context.packageInfo.owner.digest,
      dutiesDigest: dutyStateDigest(duties),
    },
  });
  return { ...planned, ...challenge, duties, locallyReverified: true, providerOutputEvidence: false,
    next: "Owner creates one external approval artifact bound to challengeDigest; package-executor cannot create it." };
}

async function close(context, options) {
  ensureActive(context);
  if (!options.challenge || !options.approvalFile) fail("USAGE", "close requires --challenge and --approval-file");
  const state = readState(context);
  assertCloseReady(context, state);
  const duties = readDuties(context);
  assertDutiesReady(duties);
  const consumed = await consumeOwnerApproval({ repoRoot: context.repoRoot, unlazyRoot: context.unlazyRoot,
    challenge: options.challenge, approvalFile: options.approvalFile });
  if (consumed.action !== "close") fail("OWNER_APPROVAL_MISMATCH", "approval does not authorize close", 1);
  const closeMessage = String(options.message || ("chore: close package " + context.packageId)).trim();
  const timeout = String(options.timeout || "120");
  const closed = runNode(context.tools.packageCli, ["close", "--timeout", timeout, "--root", context.repoRoot,
    "--package", context.packageId, "--scope", context.scope, "--authorization-receipt", consumed.approvalReceipt,
    "--json"], { cwd: context.repoRoot,
    timeoutMs: (Number(timeout) + 20) * 1_000 });
  let packageClose;
  try { packageClose = JSON.parse(childOk(closed, "package close")); }
  catch (error) { if (error.code) throw error; fail("CHILD_FAILED", "package close returned invalid JSON"); }
  const durableClose = writeConsequentialReceipt({ repoRoot: context.repoRoot, action: "close",
    packageId: context.packageId, scope: context.scope, approvalReceipt: consumed.approvalReceipt, duties,
    result: { packageClosed: true, planReceipt: consumed.subject.planReceipt, packageClose } });
  let closure;
  try {
    closure = parseIntentOutput(childOk(runNode(context.tools.gitIntent,
      ["closure-checkpoint", "--root", context.repoRoot, "--package", context.packageId,
        "--message", closeMessage, "--receipt", consumed.subject.planReceipt],
      { cwd: context.repoRoot, timeoutMs: 180_000 }), "closure checkpoint"));
  } catch (error) {
    error.message += "; package is closed and recoverable with close receipt " + durableClose.receipt;
    throw error;
  }
  const completed = writeConsequentialReceipt({ repoRoot: context.repoRoot, action: "close",
    packageId: context.packageId, scope: context.scope, approvalReceipt: consumed.approvalReceipt, duties,
    result: { packageClosed: true, planReceipt: consumed.subject.planReceipt, packageClose, closure } });
  return { packageId: context.packageId, scope: context.scope, originalOwnerDigest: state.originalOwnerDigest,
    originalGoalDigest: state.originalGoalDigest, locallyReverified: true, closed: true,
    approvalReceipt: consumed.approvalReceipt, closeReceipt: completed.receipt, recoveryReceipt: durableClose.receipt,
    closure, providerOutputEvidence: false };
}

function recoverClose(context, options) {
  if (!options.receipt) fail("USAGE", "recover-close requires --receipt CLOSE_RECEIPT");
  const source = readExecutionReceipt(context.repoRoot, options.receipt, "close-receipt");
  if (source.value.packageId !== context.packageId || source.value.scope !== context.scope ||
      source.value.result?.packageClosed !== true) fail("CLOSE_RECOVERY", "receipt does not bind this closed package");
  if (source.value.result.closure) return { recovered: true, idempotent: true, closeReceipt: source.file,
    closure: source.value.result.closure };
  const closeMessage = String(options.message || ("chore: close package " + context.packageId)).trim();
  const closure = parseIntentOutput(childOk(runNode(context.tools.gitIntent,
    ["closure-checkpoint", "--root", context.repoRoot, "--package", context.packageId,
      "--message", closeMessage, "--receipt", source.value.result.planReceipt],
    { cwd: context.repoRoot, timeoutMs: 180_000 }), "closure checkpoint recovery"));
  const completed = writeConsequentialReceipt({ repoRoot: context.repoRoot, action: "close",
    packageId: context.packageId, scope: context.scope, approvalReceipt: source.value.approvalReceipt,
    duties: source.value.duties, result: { ...source.value.result, closure, recovered: true } });
  return { recovered: true, idempotent: false, closeReceipt: completed.receipt, closure };
}

function planPublish(context, options) {
  if (!options.closureReceipt) fail("USAGE", "plan-publish requires --closure-receipt");
  const planned = parseIntentOutput(childOk(runNode(context.tools.gitIntent,
    ["plan-publish", "--root", context.repoRoot, "--receipt", options.closureReceipt],
  { cwd: context.repoRoot, timeoutMs: 30_000 }), "publish plan"));
  const challenge = createApprovalChallenge({ repoRoot: context.repoRoot, action: "publish",
    packageId: context.packageId, scope: context.scope,
    subject: { planReceipt: planned.receipt, closureReceipt: options.closureReceipt, head: planned.head,
      branch: planned.branch, remote: planned.remote },
  });
  return { ...planned, ...challenge,
    next: "Owner creates one external approval artifact bound to challengeDigest; no boolean approval is accepted." };
}

async function publish(context, options) {
  if (!options.challenge || !options.approvalFile) fail("USAGE", "publish requires --challenge and --approval-file");
  const consumed = await consumeOwnerApproval({ repoRoot: context.repoRoot, unlazyRoot: context.unlazyRoot,
    challenge: options.challenge, approvalFile: options.approvalFile });
  if (consumed.action !== "publish") fail("OWNER_APPROVAL_MISMATCH", "approval does not authorize publish", 1);
  const published = parseIntentOutput(childOk(runNode(context.tools.gitIntent,
    ["publish", "--root", context.repoRoot, "--receipt", consumed.subject.planReceipt,
      "--approval-receipt", consumed.approvalReceipt],
  { cwd: context.repoRoot, timeoutMs: 180_000 }), "approval-receipt publish"));
  const receipt = writeConsequentialReceipt({ repoRoot: context.repoRoot, action: "publish",
    packageId: context.packageId, scope: context.scope, approvalReceipt: consumed.approvalReceipt,
    result: published });
  return { ...published, approvalReceipt: consumed.approvalReceipt, publishReceipt: receipt.receipt };
}

function publicEntry(entry) {
  return { sessionId: entry.sessionId, leaf: entry.leaf, provider: entry.provider, state: entry.state,
    wave: entry.wave, runId: entry.runId, handle: entry.handle, attempt: entry.attempt,
    deadlineAt: entry.deadlineAt || null, lastHeartbeatAt: entry.lastHeartbeatAt || null,
    providerOutputEvidence: false, briefFile: entry.briefFile, owns: entry.owns, delegation: entry.delegation };
}

const HELP = `usage: package-executor.mjs <command> --root DIR --harness-root DIR --package ID --scope ID [options]

commands:
  next/start --session ID [--leaf leaf-ID] [--provider codex|claude] [--bootstrap-session ID]
  dispatch --wave ID [--session ID ...] [--deadline-seconds S] [--start-timeout-seconds S]
  heartbeat|liveness --session ID
  abort|timeout --session ID --reason TEXT
  abandon --wave ID --reason TEXT
  retry --session ID
  reassign --session OLD --new-session NEW [--provider codex|claude]
  recover --wave ABANDONED --replacement-wave COMPLETE
  return --session ID [--result-file PATH] [--timeout S]
  verify --session ID [--timeout S]
  resume --session ID
  integrate --message TEXT [--approve-checks] [--timeout S]
  status
  duty-assess --gate LEDGER:GATE
  duty-add --duty ID --owner TEXT --trigger TEXT --due-state open|due --gate LEDGER:GATE
  duty-resolve --duty ID [--gate LEDGER:GATE]
  plan-duty-waiver --duty ID
  duty-waive --duty ID --challenge PATH --approval-file EXTERNAL_PATH
  plan-close [--timeout S]
  close --challenge PATH --approval-file EXTERNAL_PATH [--message TEXT]
  recover-close --receipt CLOSE_RECEIPT [--message TEXT]
  plan-publish --closure-receipt PATH
  publish --challenge PATH --approval-file EXTERNAL_PATH

Codex defaults to gpt-5.6-sol with effort max. A provider return is accepted
only after local gate re-verification. First execution of pending integration
oracles requires the explicit integrate --approve-checks switch.`;

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    process.stdout.write(HELP + "\n");
    return;
  }
  const options = parseArgs(process.argv.slice(2));
  const context = contextFor(options);
  let result;
  if ((options.command === "start" || options.command === "next") && options.sessions.length !== 1) {
    fail("USAGE", options.command + " requires exactly one --session");
  }
  if (options.command !== "dispatch" && options.command !== "start" && options.command !== "next" &&
      options.sessions.length > 1) fail("USAGE", options.command + " accepts at most one --session");
  if (options.command === "start" || options.command === "next") {
    const prepared = prepare(context, options, options.command === "start" ? options.leaf : null);
    result = { idempotent: prepared.idempotent, originalOwnerDigest: prepared.state.originalOwnerDigest,
      originalOwnerRequestDigest: prepared.state.originalOwnerRequestDigest,
      originalGoal: prepared.state.originalGoal, originalGoalDigest: prepared.state.originalGoalDigest,
      ...publicEntry(prepared.entry) };
  } else if (options.command === "dispatch") result = await dispatch(context, options);
  else if (options.command === "return") result = await returnLeaf(context, options);
  else if (options.command === "verify") {
    const state = readState(context);
    const entry = state.sessions[session(options.sessionId)];
    if (!entry) fail("SESSION_STATE", "unknown session");
    result = { sessionId: entry.sessionId, leaf: entry.leaf, locallyReverified: true,
      outputDigest: digest(verifyLeaf(context, entry, options)) };
  } else if (options.command === "resume") {
    const state = readState(context);
    const entry = state.sessions[session(options.sessionId)];
    if (!entry) fail("SESSION_STATE", "unknown session");
    packageBinding.findSessionBinding(context.harnessRoot, entry.sessionId, { controlRoot: context.harnessRoot });
    await synchronizeSession(context, state, entry);
    result = { originalOwnerDigest: state.originalOwnerDigest,
      originalOwnerRequestDigest: state.originalOwnerRequestDigest,
      originalGoal: state.originalGoal, originalGoalDigest: state.originalGoalDigest, ...publicEntry(entry) };
  } else if (options.command === "abort") result = await abortExecution(context, options);
  else if (options.command === "abandon") result = await abandonExecution(context, options);
  else if (options.command === "timeout") result = await timeoutExecution(context, options);
  else if (options.command === "heartbeat" || options.command === "liveness") result = await liveness(context, options);
  else if (options.command === "retry") result = retryExecution(context, options);
  else if (options.command === "reassign") result = reassignExecution(context, options);
  else if (options.command === "recover") result = recoverExecution(context, options);
  else if (["duty-assess", "duty-add", "duty-resolve"].includes(options.command)) {
    result = dutyTransition(context, options);
  } else if (options.command === "plan-duty-waiver") result = planDutyWaiver(context, options);
  else if (options.command === "duty-waive") result = await waiveDuty(context, options);
  else if (options.command === "integrate") result = integrate(context, options);
  else if (options.command === "status") result = await status(context);
  else if (options.command === "plan-close") result = planClose(context, options);
  else if (options.command === "close") result = await close(context, options);
  else if (options.command === "recover-close") result = recoverClose(context, options);
  else if (options.command === "plan-publish") result = planPublish(context, options);
  else result = await publish(context, options);
  if (options.json) process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  else process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

main().catch((error) => {
  const code = error.code || "PACKAGE_EXECUTOR";
  const output = { error: { code, message: error.message } };
  if (process.argv.includes("--json")) process.stderr.write(JSON.stringify(output) + "\n");
  else console.error("package-executor: " + code + ": " + error.message);
  process.exitCode = error.exitCode || 2;
});
