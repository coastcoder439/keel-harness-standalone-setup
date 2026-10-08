#!/usr/bin/env node

// Finite package execution surface. It prepares exact Unlazy leaf contracts,
// records native Claude/Codex handles before any wait, and accepts a return
// only after local gate re-verification. Provider output is never Evidence.

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { replaceFileSync } from "./atomic-file.mjs";
import { EXECUTOR_USAGE_HEAD, executorCommandHelp } from "./executor-commands.mjs";
import { executionRules, guidanceSections, restartSection } from "./brief-sections.mjs";
import { resolveClaudeExecutable, resolveCodexCommand } from "./codex-plugin-bootstrap.mjs";
import { CODEX_PIN, claudeWorkerModelArgs, declaredModelChoice, resolvePackageExecutionModel } from "../process-models/index.mjs";
import { DORMANT_MS, livingHolderOfScope, newestRuntimeChange, setAsideScope, waveDeadlineAhead } from "./package-resolve.mjs";
import { holderLives, lockTimeMs } from "../system/process-identity.mjs";
import { hasRoomFor } from "../system/ram-floor.mjs";
import { bundleContractPath, changedBetween, contractChangeOnlyRuntime, contractDigests, isRuntimePath, readSnapshot, takeSnapshot,
  writeSnapshot } from "./worktree-snapshot.mjs";
import { adoptStepCopy, collectStepCopy, createStepCopy, removeStepCopy, stepCopyPath } from "./step-copy.mjs";
import { assertNotOrchestrator, callerSession, recordOrchestrator } from "./orchestrator-role.mjs";
import { verifyOwnerStart } from "./owner-start.mjs";
import {
  DEFAULT_COST_BUDGET_USD,
  DEFAULT_TOKEN_BUDGET,
  launchProviderRun,
  readProviderRun,
  refreshProviderRun,
  requestProviderStop,
  TERMINAL_STATES as TERMINAL_RUN_STATES,
} from "./provider-runtime.mjs";
import {
  readExecutionReceipt,
  writeConsequentialReceipt,
  writeImmutableRecordFile,
  writeWritebackWitness,
} from "./execution-receipts.mjs";
import {
  findOwnerOk,
  formatOwnerOkLine,
  insertOwnerOkLine,
  ownerWordingFolders,
  readOwnerWordingFile,
  replaceOwnerOkRecord,
  todayLocal,
  validateOwnerOk,
  wordingProblem,
} from "./owner-ok.mjs";
import {
  callingSession,
  heldByOtherSession,
  idleSession,
  integrationSessions,
  isBundleLedger,
  neverRan,
  loadGateParser,
  loadLedgerNormalize,
  locateUnlazy,
  normalizedLedger,
} from "../git/git-intent.mjs";
import {
  changedInScope,
  copyProofs,
  formatManualCode,
  loadProofStore,
  manualCodeOf,
  manualCodeState,
  manualEvidenceDigest,
  manualScope,
  manualSelect,
  readyScope,
  workingCommit,
} from "./proof-binding.mjs";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const packageBinding = require("../binding/package-binding.cjs");
const packageOwnership = require("../binding/package-ownership.cjs");
const repository = require("../binding/repository.cjs");
const ownerContracts = require("../binding/owner-contract.cjs");
const packageBootstrap = require("../binding/package-bootstrap.cjs");
const runtimeScopes = require("../binding/runtime-scopes.cjs");
const hookActivity = require("../binding/hook-activity.cjs");
const sessionScope = require("../guards/session-scope.cjs");
const { renameWithRetry } = require("../binding/rename-retry.cjs");

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const PROVIDERS = new Set(["claude", "codex"]);
const COMMANDS = new Set([
  "start", "next", "dispatch", "return", "verify", "resume", "integrate", "status", "close",
  "abort", "abandon", "heartbeat", "liveness", "timeout", "retry", "reassign", "recover",
  "duty-assess", "duty-add", "duty-resolve", "duty-waive",
  "recover-close", "publish", "review-manual", "rebind", "cleanup-runtime", "restart", "reopen", "orchestrator-takeover",
]);
// Provider run states in which the worker is gone for good; reaching one of them
// frees the leaf lease and binding (runtime-state-recovery R2).
const RELEASING_STATES = new Set(["aborted", "timed-out", "vanished", "provider-failed", "provider-start-failed"]);
// Runs that ended without an answer and wait for the Orchestrator (P12): hung, at the cost frame, a guard refused
// the same input three times, or (P13, C4) returned without changing any file of its OWNS. Their lease and
// binding stay, so resume can continue the native session; retry, reassign, restart and abort lead out of them
// like out of provider-failed.
const STOPPED_FOR_DECISION = new Set(["hung", "budget-reached", "repeated-block", "returned-unchanged"]);
// P13, C2: a member of a sealed wave that waits for free memory, and (C6) one whose start failed while other members
// of its wave started; retry puts the latter back into the queue of its wave.
const QUEUED_STATE = "queued";
const START_FAILED_STATE = "start-failed";

// What package-cli activate writes into a fresh scope plus what this executor adds;
// a rollback removes an activated scope only while it holds nothing else.
const ACTIVATION_ENTRIES = new Set(["package.ref", "owner.ref.json", "session", "status.log", "hook-state.json",
  "dispatch.json", "duties.json", "executor.json", "executor.lock", "executor", "bindings"]);

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

// Der Wortlaut des Owners ist sein wortgetreues Zitat (D13, D16): keine Laengengrenze, Zeilenumbrueche
// und Anfuehrungszeichen sind erlaubt. Nur ein leeres Zitat ist es nicht; eine Satzform wird nie verlangt.
function ownerWording(value) {
  const text = String(value ?? "");
  const problem = wordingProblem(text);
  if (problem) fail("USAGE", "--owner-ok: " + problem);
  return text;
}

// Das Zitat des Owners aus --owner-ok oder --owner-ok-file, oder null, wenn keines gegeben ist. Die Datei
// darf nur im Temp-Ordner der Sitzung oder im Laufzeitordner (.unlazy) des Repos bzw. der Harness-Wurzel liegen.
function ownerWordingOf(context, options) {
  if (options.ownerOk !== undefined) return options.ownerOk;
  if (options.ownerOkFile === undefined) return null;
  try { return readOwnerWordingFile(options.ownerOkFile, ownerWordingFolders(context.repoRoot, context.harnessRoot)); }
  catch (error) { fail(error.code || "OWNER_OK_FILE", error.message, error.exitCode || 2); }
  return null;
}

// Ein Text, der als Datei an ein Kindprogramm geht (Owner-Zitat, Commit-Text): keine Befehlszeilen-Grenze,
// keine Zeilenumbruch- und Anfuehrungszeichen-Frage. Die Datei lebt nur fuer diesen einen Aufruf im Temp-Ordner.
async function withTextFile(text, run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "keel-executor-text-"));
  const file = path.join(directory, "text.txt");
  try {
    fs.writeFileSync(file, String(text), { encoding: "utf8", flag: "wx" });
    return await run(file);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}

// Der Wert einer Option, die freien Text tragen kann (Owner-Zitat, Commit-Text): fehlt er, ist es ein
// Aufruffehler; beginnt er mit "--", ist aber keine Option, ist es der Text selbst.
function takeFreeText(args, key) {
  const value = args.shift();
  if (value === undefined || value === "" || /^--[a-z][a-z-]*$/u.test(String(value))) fail("USAGE", key + " requires a value");
  return value;
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
    else if (key === "--ready-only") options.readyOnly = true;
    else if (key === "--step-copy") options.stepCopy = true;
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
    else if (key === "--message") options.message = takeFreeText(args, key);
    else if (key === "--deadline-seconds") options.deadlineSeconds = take(key);
    else if (key === "--max-turns") options.maxTurns = take(key);
    else if (key === "--cost-budget-usd") options.costBudgetUsd = take(key);
    else if (key === "--token-budget") options.tokenBudget = take(key);
    else if (key === "--claude-executable") options.claudeExecutable = take(key);
    else if (key === "--claude-prefix-arg") options.claudePrefixArgs.push(take(key));
    else if (key === "--codex-executable") options.codexExecutable = take(key);
    else if (key === "--reason") options.reason = take(key);
    else if (key === "--accept-outside") options.acceptOutside = take(key);
    else if (key === "--new-session") options.newSessionId = take(key);
    else if (key === "--replacement-wave") options.replacementWave = take(key);
    else if (key === "--duty") options.dutyId = take(key);
    else if (key === "--owner") options.owner = take(key);
    else if (key === "--trigger") options.trigger = take(key);
    else if (key === "--due-state") options.dueState = take(key);
    else if (key === "--gate") options.gate = take(key);
    else if (key === "--evidence") options.evidence = take(key);
    else if (key === "--evidence-file") options.evidenceFile = take(key);
    else if (key === "--owner-ok") options.ownerOk = ownerWording(takeFreeText(args, key));
    else if (key === "--owner-ok-file") options.ownerOkFile = take(key);
    else if (key === "--reverify") options.reverify = true;
    else if (key === "--receipt") options.receipt = take(key);
    else if (key === "--closure-receipt") options.closureReceipt = take(key);
    else if (key === "--run") options.run = take(key);
    else if (key === "--apply") options.apply = true;
    else fail("USAGE", "unknown option " + key);
  }
  if (!COMMANDS.has(options.command)) fail("USAGE", "command must be one of " + [...COMMANDS].join(", "));
  if (options.run !== undefined && options.command !== "start" && options.command !== "next") {
    fail("USAGE", "--run is only accepted by start and next");
  }
  for (const [flag, key] of [["--deadline-seconds", "deadlineSeconds"], ["--max-turns", "maxTurns"], ["--token-budget", "tokenBudget"]]) {
    if (options[key] !== undefined && !(Number.isSafeInteger(Number(options[key])) && Number(options[key]) >= 1)) {
      fail("USAGE", flag + " must be a whole number of at least 1");
    }
  }
  if (options.costBudgetUsd !== undefined && !(Number.isFinite(Number(options.costBudgetUsd)) && Number(options.costBudgetUsd) > 0)) {
    fail("USAGE", "--cost-budget-usd must be a number above 0");
  }
  if ((options.costBudgetUsd !== undefined || options.tokenBudget !== undefined) &&
      !["dispatch", "resume", "restart", "reopen"].includes(options.command)) {
    fail("USAGE", "--cost-budget-usd and --token-budget are only accepted by dispatch, resume, restart and reopen");
  }
  if (options.ownerOk !== undefined && options.ownerOkFile !== undefined) {
    fail("USAGE", "use either --owner-ok or --owner-ok-file, not both");
  }
  if (options.ownerOkFile !== undefined && !["close", "publish", "duty-waive"].includes(options.command)) {
    fail("USAGE", "--owner-ok-file is only accepted by close, publish and duty-waive");
  }
  if (options.apply && options.command !== "cleanup-runtime") fail("USAGE", "--apply is only accepted by cleanup-runtime");
  if (options.acceptOutside !== undefined) {
    if (options.command !== "return") fail("USAGE", "--accept-outside is only accepted by return");
    if (options.acceptOutside.length > 500 || /[\0\r\n]/u.test(options.acceptOutside)) {
      fail("USAGE", "--accept-outside must be one line of 1..500 characters naming why the change came from outside");
    }
  }
  if (options.readyOnly && options.command !== "integrate") fail("USAGE", "--ready-only is only accepted by integrate");
  if (options.stepCopy && options.command !== "dispatch") fail("USAGE", "--step-copy is only accepted by dispatch");
  return options;
}

// Every child program of the executor runs through the silence watcher (P12, C13): no time limit of our own
// and no output cap (the former blocking call ended gate runs at 180 s and at its 1 MiB default buffer, measured B17).
// A child is ended only when it is really hung: no output for KEEL_SILENCE_MS and an idle process tree.
// The runtime is the Unlazy one the executor already locates (silence-watch.mjs next to the gate runner); a
// huge output can go to a file through options.outputFile.
let silenceWatchRoot = null;
let silenceWatchModule = null;

async function silenceWatch() {
  if (silenceWatchModule) return silenceWatchModule;
  const tree = path.resolve(here, "..", "..");
  const files = [silenceWatchRoot, path.join(tree, "vendor", "unlazy"), path.join(path.dirname(tree), "vendor", "unlazy")]
    .filter(Boolean).map((root) => path.join(root, "scripts", "lib", "silence-watch.mjs"));
  const file = files.find((candidate) => fs.existsSync(candidate));
  if (!file) fail("SILENCE_WATCH", "silence-watch.mjs not found: " + files.join(", "));
  const module = await import(pathToFileURL(file).href);
  if (typeof module.runWatched !== "function") fail("SILENCE_WATCH", "silence-watch.mjs exports no runWatched");
  silenceWatchModule = module;
  return module;
}

// The result has the shape of the former blocking call (status, signal, stdout, stderr), so callers keep reading it alike.
async function runProgram(command, args, options = {}) {
  const watch = await silenceWatch();
  const result = await watch.runWatched(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...(options.env || {}) },
    ...(options.outputFile ? { outputFile: options.outputFile } : {}),
  });
  if (result.spawnError) fail("CHILD_FAILED", result.spawnError);
  if (result.hung) fail("CHILD_HUNG", path.basename(String(args[0] || command)) + " hung: " + result.hungReason);
  return { status: result.code, signal: result.signal, stdout: result.stdout, stderr: result.stderr };
}

// gate-check ignores --timeout (P7a) and says so on stderr; the executor no longer passes it, and
// KEEL_GATE_QUIET_TIMEOUT=1 keeps that hint from pushing the real cause out of a failure message. package-cli
// close runs gate-check itself and inherits the variable.
const GATE_RUNNERS = new Set(["gate-check.mjs", "package-cli.mjs"]);

export function runNode(script, args, options = {}) {
  const quiet = GATE_RUNNERS.has(path.basename(String(script))) ? { KEEL_GATE_QUIET_TIMEOUT: "1" } : {};
  return runProgram(process.execPath, [script, ...args], { ...options, env: { ...quiet, ...(options.env || {}) } });
}

// P20, D14: the real git.exe (no cmd\git.exe wrapper process), --no-optional-locks on reading calls. A found program that
// cannot be started at all falls back to plain "git" once.
async function runGitProgram(args, options) {
  const gitBinary = require("../git/git-binary.cjs");
  const executable = gitBinary.gitExecutable();
  try { return await runProgram(executable, gitBinary.readGitArgs(args), options); }
  catch (error) {
    if (executable === "git" || error?.code !== "CHILD_FAILED") throw error;
    gitBinary.forgetGitExecutable();
    return runProgram("git", gitBinary.readGitArgs(args), options);
  }
}

function runGit(repoRoot, args) {
  return runGitProgram(["-C", repoRoot, ...args], { cwd: repoRoot });
}

// A git read the callers judge themselves: a git that cannot run is an error entry like the former blocking call gave, not a throw.
async function gitResult(repoRoot, args) {
  try { return await runGit(repoRoot, args); }
  catch (error) { return { status: null, stdout: "", stderr: "", error }; }
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

function bundleLedgerFiles(packageInfo, leaf) {
  if (leaf) return [path.join(packageInfo.packageDir, "gates", id(leaf, "leaf") + ".md")];
  const gatesDir = path.join(packageInfo.packageDir, "gates");
  const files = [path.join(packageInfo.packageDir, "GATES.md")];
  if (fs.existsSync(gatesDir)) {
    for (const entry of fs.readdirSync(gatesDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".md")) files.push(path.join(gatesDir, entry.name));
    }
  }
  return files;
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
      // Written since the one-orchestrator rule (Pruefung 07.10.2026); a state without it is an older package whose
      // orchestrator is taken over from its planning session or the orchestrator index (adoptOrchestrator).
      orchestratorTracked: true,
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
  migrateReplacedSessions(value);
  adoptOrchestrator(context, value);
  return value;
}

// A replaced session (reassigned, reopened) that has a successor is history, not open work (P13, E4c). A state written
// before reassign moved its source aside still holds such sessions in `sessions` (measured: rootwork package 51), where
// they kept integration from starting. Reading the state moves them, whole, to history.sessions; the next write keeps it.
function migrateReplacedSessions(state) {
  for (const [sessionId, entry] of Object.entries(state.sessions)) {
    if (!entry || !["reassigned", "reopened"].includes(entry.state)) continue;
    const successorId = entry.replacedBy;
    const successor = successorId ? (state.sessions[successorId] || state.history.sessions[successorId]) : null;
    if (!successor) continue;
    state.history.sessions[sessionId] = { ...entry, archivedAt: entry.archivedAt || new Date().toISOString() };
    delete state.sessions[sessionId];
    const wave = entry.wave ? state.waves[entry.wave] : null;
    if (wave && Array.isArray(wave.sessions) && wave.sessions.includes(sessionId) && !wave.sessions.includes(successorId) &&
        successor.wave === entry.wave) {
      wave.sessions = wave.sessions.map((value) => (value === sessionId ? successorId : value));
    }
    transition(state, "session-archived", sessionId, entry.state, entry.state, { replacedBy: successorId, migrated: true });
  }
}

// executor-state-autonomy, decision 1: every change of executor.json goes through updateState. It takes
// the scope lock, reads the CURRENT state again, applies the mutation to that fresh state, writes it
// atomically and frees the lock. Measured 02.10.2026: two simultaneous returns read the same state and
// wrote one after the other, so one verified member fell back to provider-returned. Long work (gate runs,
// provider starts, child processes) never runs under the lock. The Unlazy withFileLock fails closed on a
// crashed holder instead of taking it over, so it does not carry this meaning; this is the one lock of
// executor.json.
const STATE_LOCK_WAIT_MS = 120_000;
// Only a lock without a process number (older format) is judged by this time; see orphanedLock (P13, C10).
const STATE_LOCK_STALE_MS = 120_000;
const TRANSIENT_LOCK_ERRORS = new Set(["EPERM", "EACCES", "EBUSY"]);
let stateLockHeld = false;

function stateLockPath(context) {
  return path.join(context.repoRoot, ".unlazy", context.scope, "executor.lock");
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function readLockHolder(file) {
  try {
    const info = fs.statSync(file);
    let value = null;
    try { value = JSON.parse(fs.readFileSync(file, "utf8")); } catch { value = null; }
    return { value: value && typeof value === "object" ? value : null, mtimeMs: info.mtimeMs };
  } catch (error) {
    if (error.code === "ENOENT" || TRANSIENT_LOCK_ERRORS.has(error.code)) return null;
    throw error;
  }
}

// A lock is orphaned when its holder process is gone (P13, C10): the process number is checked together with the
// start time, so a process number the system handed out again does not keep the lock alive, and a living holder
// keeps it however long it works. Only a lock without a process number (an older format, or one its holder is still
// writing) is judged by its time, as before: STATE_LOCK_STALE_MS from its start or, without content, its file time.
export function orphanedLock(holder, now) {
  const pid = holder.value?.pid;
  if (Number.isSafeInteger(pid) && pid > 0) return !holderLives(pid, lockTimeMs(holder.value));
  const started = Date.parse(holder.value?.startedAt || "") || holder.mtimeMs;
  return now - started > STATE_LOCK_STALE_MS;
}

// The orphaned lock is moved aside by rename and checked: when a successor took the lock between the
// judgement and the rename, its lock is put back and the takeover does not happen.
// Only one process judges and moves a lock at a time (measured 04.10.2026: two waiters moved a successor's
// lock aside, one put it back after its holder had already released, and that stale copy was taken over a
// second time). The takeover guard is a second lock file created exclusively; whoever does not get it goes
// on waiting, and whoever gets it judges the lock again before moving it. A guard left by a crashed process
// is removed once it is older than the takeover itself can last.
const TAKEOVER_GUARD_STALE_MS = 10_000;

function takeOverLock(file, holder) {
  const guard = file + ".takeover";
  let fd = null;
  try { fd = fs.openSync(guard, "wx"); }
  catch (error) {
    if (error.code !== "EEXIST" && !TRANSIENT_LOCK_ERRORS.has(error.code)) throw error;
    try {
      if (Date.now() - fs.statSync(guard).mtimeMs > TAKEOVER_GUARD_STALE_MS) fs.rmSync(guard, { force: true });
    } catch { /* the guard went away */ }
    return null;
  }
  fs.closeSync(fd);
  try {
    const current = readLockHolder(file);
    if (!current || (current.value?.token ?? null) !== (holder.value?.token ?? null) ||
        !orphanedLock(current, Date.now())) return null;
    const aside = file + "." + process.pid + "." + crypto.randomBytes(6).toString("hex") + ".orphaned";
    try { fs.renameSync(file, aside); } catch { return null; }
    let moved = null;
    try { moved = JSON.parse(fs.readFileSync(aside, "utf8")); } catch { moved = null; }
    const same = holder.value ? moved?.token === holder.value.token : moved === null;
    if (!same) {
      try { fs.linkSync(aside, file); } catch { /* the lock name is taken again; that holder goes on */ }
      fs.rmSync(aside, { force: true });
      return null;
    }
    fs.rmSync(aside, { force: true });
    return { pid: holder.value?.pid ?? null, startedAt: holder.value?.startedAt ?? null };
  } finally {
    fs.rmSync(guard, { force: true });
  }
}

function acquireStateLock(context) {
  if (stateLockHeld) fail("STATE_LOCK", "the executor state lock is not re-entrant");
  const file = stateLockPath(context);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const token = crypto.randomBytes(16).toString("hex");
  const deadline = Date.now() + STATE_LOCK_WAIT_MS;
  const takenOver = [];
  for (;;) {
    let fd = null;
    try { fd = fs.openSync(file, "wx"); }
    catch (error) {
      if (error.code !== "EEXIST" && !TRANSIENT_LOCK_ERRORS.has(error.code)) throw error;
    }
    if (fd !== null) {
      try { fs.writeSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), token })); }
      finally { fs.closeSync(fd); }
      stateLockHeld = true;
      return { file, token, takenOver };
    }
    const holder = readLockHolder(file);
    if (holder && orphanedLock(holder, Date.now())) {
      const previous = takeOverLock(file, holder);
      if (previous) { takenOver.push(previous); continue; }
    }
    if (Date.now() >= deadline) {
      fail("STATE_LOCKED", "executor state of scope " + context.scope + " stayed locked for " +
        STATE_LOCK_WAIT_MS / 1_000 + " s by pid " + (holder?.value?.pid ?? "unknown"), 1);
    }
    sleepSync(10 + Math.floor(Math.random() * 30));
  }
}

function releaseStateLock(lock) {
  stateLockHeld = false;
  try {
    const value = JSON.parse(fs.readFileSync(lock.file, "utf8"));
    if (value?.token === lock.token) fs.rmSync(lock.file, { force: true });
  } catch { /* already taken over as orphaned */ }
}

// mutate(freshState) applies one change to the state as it is NOW and must not wait. Returning false
// means nothing changed and nothing is written. updateState returns the written state.
export function updateState(context, mutate, { create = false } = {}) {
  const lock = acquireStateLock(context);
  try {
    const state = readState(context, create);
    for (const previous of lock.takenOver) {
      transition(state, "state-lock-taken-over", context.scope, null, null, previous);
    }
    const result = mutate(state);
    if (result && typeof result.then === "function") fail("STATE_LOCK", "a state mutation must not wait under the lock");
    if (result !== false || lock.takenOver.length) atomicJson(statePath(context.repoRoot, context.scope), state);
    return state;
  } finally {
    releaseStateLock(lock);
  }
}

function sessionOf(state, sessionId) {
  const entry = state.sessions[sessionId];
  if (!entry) fail("SESSION_STATE", "unknown session " + sessionId, 1);
  return entry;
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

// A scope is dormant when its runtime has not changed for DORMANT_MS, has no wave deadline ahead and no
// living holder process (P13, C10). This is the read-only half of setAsideScope (package-resolve.mjs):
// phase 1 of a start only decides, phase 2 moves.
function dormantScope(context, scope, now) {
  if (scope === context.scope || scope.startsWith(".")) return false;
  const directory = path.join(context.repoRoot, ".unlazy", scope);
  let info;
  try { info = fs.lstatSync(directory); } catch { return false; }
  if (info.isSymbolicLink() || !info.isDirectory()) return false;
  return now - newestRuntimeChange(directory) >= DORMANT_MS && !waveDeadlineAhead(directory, now) &&
    !livingHolderOfScope(directory);
}

// Overlaps split into the dormant scopes that may be set aside and the young conflicts that block.
// Only an owns-overlap can be dormant; every other conflict, same-package included, is young.
function splitOverlaps(context, overlaps, now = Date.now()) {
  const dormant = [...new Set(overlaps.filter((item) => item.kind === "owns-overlap").map((item) => item.scope))]
    .filter((scope) => dormantScope(context, scope, now));
  const young = overlaps.filter((item) => item.kind !== "owns-overlap" || !dormant.includes(item.scope));
  return { dormant, young };
}

// The refusal for a young overlap: the historic first line, one resolve route per blocking package
// (overlapMessage), and for every overlapping scope without a holder the cleanup route. An orphaned
// scope still blocks; it is never set aside here (runtime-state-recovery R3).
function failOverlap(context, conflicts) {
  let message = packageOwnership.overlapMessage(conflicts, { harnessRoot: context.harnessRoot, repoRoot: context.repoRoot });
  let classified = { scopes: [] };
  try { classified = runtimeScopes.classifyRuntime(context.repoRoot); } catch { /* the overlap itself still blocks */ }
  const script = path.join(context.harnessRoot, "harness-core", "execution", "package-executor.mjs");
  for (const scope of [...new Set(conflicts.map((item) => item.scope))]) {
    const record = classified.scopes.find((item) => item.scope === scope && item.state === "orphaned");
    if (!record) continue;
    message += "\n[verwaist: " + record.reasons.join(", ") + "; aufräumen: node \"" + script + "\" cleanup-runtime --root \"" +
      context.repoRoot + "\" --apply]";
  }
  fail("PACKAGE_CROSS_OWNERSHIP_OVERLAP", message, 1);
}

// Owner 30.09.2026: "dass der Paketstarter sich weigert, ein neues Paket ... zu starten. Wenn du das fixst,
// dann muss ich hier auch nichts verschieben." A package activated weeks ago and never touched again still
// held its OWNS and blocked every later package on the same files (measured: six scopes idle for three weeks).
// A dormant scope is one whose runtime has not changed for DORMANT_DAYS and has no wave deadline ahead; only
// such a scope that actually overlaps is set aside, unchanged, to .unlazy/.suspended/ and reported. Its
// package bundle stays untouched and can be started again. A younger overlap keeps blocking.
function setAsideDormant(context, scopes, now = Date.now()) {
  const suspended = [];
  for (const scope of scopes) {
    const moved = setAsideScope(context.repoRoot, scope, now);
    if (moved) suspended.push(moved);
  }
  return suspended;
}

// Audit 06.09.2026, B1: the schema proves disjoint OWNS inside one package only. Two packages
// active in the same repository must not claim the same files, or every "bound leaf owns this
// path" authorization would accept both. Measured by "[ownership] a second active package with
// overlapping OWNS blocks activation until it is gone".
function overlapCheck(context) {
  const overlaps = packageOwnership.crossPackageOverlaps(context.repoRoot, context.packageId, context.scope);
  if (!overlaps.length) return;
  const { dormant, young } = splitOverlaps(context, overlaps);
  if (young.length) failOverlap(context, young);
  const suspended = setAsideDormant(context, dormant);
  if (suspended.length) context.suspendedScopes = [...(context.suspendedScopes || []), ...suspended];
  const remaining = packageOwnership.crossPackageOverlaps(context.repoRoot, context.packageId, context.scope);
  if (remaining.length) failOverlap(context, remaining);
}

function packageRefMatches(context) {
  let text;
  try { text = fs.readFileSync(path.join(context.repoRoot, ".unlazy", context.scope, "package.ref"), "utf8"); }
  catch { return false; }
  return text.trim().toLowerCase() === ("docs/packages/" + context.packageId).toLowerCase();
}

function startCommand(context) {
  return "node \"" + path.join(context.harnessRoot, "harness-core", "execution", "package-executor.mjs") + "\" start --root \"" +
    context.repoRoot + "\" --package " + context.packageId + " --scope " + context.scope +
    " --session <leaf session> --leaf <leaf>";
}

function assertPackageRef(context) {
  if (packageRefMatches(context)) return;
  fail("PACKAGE_NOT_ACTIVE", "package " + context.packageId + " is not active in scope " + context.scope +
    "; only start and next activate it\nNEXT: " + startCommand(context) + " (or next instead of start --leaf for the next open leaf)", 1);
}

async function doctor(context) {
  childOk(await runNode(context.tools.packageCli, ["doctor", "--root", context.repoRoot, "--package", context.packageId],
    { cwd: context.repoRoot }), "package doctor");
}

// Every command except start/next works on an already active package: it never activates
// (runtime-state-recovery R1), but it runs the same doctor and overlap checks as before.
async function assertActive(context) {
  assertPackageRef(context);
  await doctor(context);
  overlapCheck(context);
}

function hasHarnessConfig(root) {
  try {
    const info = fs.lstatSync(path.join(root, ".keel-harness.json"));
    return info.isFile() && !info.isSymbolicLink();
  } catch { return false; }
}

// A package has exactly one orchestrator (Pruefung 07.10.2026): the session that planned it, or else the first
// session whose start or executor action SUCCEEDED. executor.json keeps it as state.orchestrator; it is entered in
// the orchestrator index so it can never be bound as a leaf later (orchestrator-rules-enforcement R1) and so it holds
// the fix right of session-scope.cjs. Every other session is entered nowhere, however often it calls the executor;
// a failing call (dispatch --wave bogus) enters nobody, because noteOrchestrator runs only after the action. The
// orchestrator changes only through the explicit step orchestrator-takeover --reason TEXT, recorded in the state, once
// the previous one has been silent for silenceMs (KEEL_SILENCE_MS). An older package takes its orchestrator over on read.
// A Harness root without its configuration keeps no index, exactly like createBinding keeps no session index there.
function packageOrchestrator(state) {
  const value = state?.orchestrator;
  return value && typeof value.sessionId === "string" && value.sessionId ? value.sessionId : null;
}

function leafSessionOf(state, sessionId) {
  return Boolean(state.sessions?.[sessionId] || state.history?.sessions?.[sessionId]);
}

// Nachpruefung 07.10.2026 (2): an older package (its state has no orchestratorTracked) has no state.orchestrator; its
// orchestrator is the one it had (session-scope.cjs legacyOrchestrator: planning session, else the first entry of the
// orchestrator index). Without any, nobody is taken over, and later calls enter nobody but the planning session.
function legacyOrchestrator(context, state) {
  return sessionScope.legacyOrchestrator({ harnessRoot: context.harnessRoot, repoRoot: context.repoRoot,
    packageId: context.packageId, state });
}

// Reading an older state takes its orchestrator over (in memory; noteOrchestrator and every later write keep it).
function adoptOrchestrator(context, state) {
  if (state.orchestratorTracked || packageOrchestrator(state) || !context.harnessRoot) return;
  const found = legacyOrchestrator(context, state);
  if (!found) return;
  state.orchestrator = { sessionId: found.sessionId, via: "adopted", source: found.source, at: new Date().toISOString() };
}

// Enters sessionId as the package's orchestrator when the package has none yet. A leaf session of the package is never
// entered. An older package (no orchestratorTracked) enters only its planning session (via "bootstrap"); a package whose
// state the one-orchestrator rule wrote enters its planning session or else the first session whose action succeeded. An
// adopted orchestrator is written to the state and the index on the first call.
function noteOrchestrator(context, sessionId, via) {
  if (!sessionId || !hasHarnessConfig(context.harnessRoot)) return null;
  if (!fs.existsSync(statePath(context.repoRoot, context.scope))) return null;
  let entered = null;
  updateState(context, (fresh) => {
    const current = fresh.orchestrator;
    if (packageOrchestrator(fresh)) {
      if (current.via !== "adopted" || current.recordedAt) return false;
      current.recordedAt = new Date().toISOString();
      transition(fresh, "orchestrator-adopted", current.sessionId, null, current.sessionId, { source: current.source });
      entered = { sessionId: current.sessionId, via: "adopted" };
      return true;
    }
    if (leafSessionOf(fresh, sessionId)) return false;
    if (!fresh.orchestratorTracked && via !== "bootstrap") return false;
    fresh.orchestrator = { sessionId, via, at: new Date().toISOString() };
    transition(fresh, "orchestrator-recorded", sessionId, null, sessionId, { via });
    entered = { sessionId, via };
    return true;
  });
  if (!entered) return null;
  return recordOrchestrator({ harnessRoot: context.harnessRoot, sessionId: entered.sessionId, via: entered.via,
    packageRef: { repoRoot: context.repoRoot, packageId: context.packageId, scope: context.scope } });
}

// The executor commands after whose success the calling session is noted (never before: a refused or failing call
// enters nobody).
const NOTED_COMMANDS = Object.freeze({ dispatch: "dispatch", reassign: "reassign", restart: "restart", reopen: "reopen",
  resume: "resume", integrate: "integrate", "review-manual": "review-manual" });

// orchestrator-takeover --reason TEXT: the explicit, recorded change of the package's orchestrator to the calling
// session. The calling session is CLAUDE_CODE_SESSION_ID; --session is the fallback only where the host gives none, and
// the state says which one named it. A worker and a leaf session of the package never take it over. Like a planning
// takeover (package-bootstrap --takeover, P4 D15), the previous orchestrator must have been silent for silenceMs
// (KEEL_SILENCE_MS): no hook of that session touched its planning or orchestrator record (hook-activity.cjs). The previous
// orchestrator keeps its index record but loses the fix right, which reads the state.
function callingTakeoverSession(options) {
  const host = String(process.env.CLAUDE_CODE_SESSION_ID || "").trim();
  if (host) {
    const sessionId = callerSession(process.env);
    if (options.sessionId !== undefined && session(options.sessionId) !== sessionId) {
      fail("USAGE", "orchestrator-takeover takes the calling session " + sessionId + " (CLAUDE_CODE_SESSION_ID); --session is only " +
        "for a host without one and must not name another session");
    }
    return { sessionId, source: "CLAUDE_CODE_SESSION_ID" };
  }
  if (options.sessionId === undefined) {
    fail("USAGE", "orchestrator-takeover needs the calling session (CLAUDE_CODE_SESSION_ID) or, where the host has none, --session ID");
  }
  return { sessionId: session(options.sessionId), source: "--session (no CLAUDE_CODE_SESSION_ID)" };
}

// The milliseconds the previous orchestrator has been silent (null: no record of it at all), or a refusal while it is
// younger than silenceMs.
function assertPreviousSilent(context, previous, sessionId, reason) {
  if (!previous || previous === sessionId) return null;
  const limit = hookActivity.silenceLimitMs(process.env);
  const silent = hookActivity.sessionSilentForMs(context.harnessRoot, previous);
  if (silent < limit) {
    fail("ORCHESTRATOR_ACTIVE", "the orchestrator " + previous + " of package " + context.packageId + " was active " +
      Math.round(silent / 1000) + " s ago; it can be taken over once it has been silent for " + Math.round(limit / 1000) +
      " s (no hook of that session ran; KEEL_SILENCE_MS changes the limit)\nNEXT: wait, then run orchestrator-takeover --root \"" +
      context.repoRoot + "\" --package " + context.packageId + " --scope " + context.scope + " --reason " + JSON.stringify(reason), 1);
  }
  return Number.isFinite(silent) ? Math.round(silent) : null;
}

async function takeoverOrchestrator(context, options) {
  await assertActive(context);
  if (String(process.env.KEEL_PACKAGE_SESSION || "").trim()) {
    fail("ORCHESTRATOR_TAKEOVER", "a bound worker never takes over the orchestration of its package", 1);
  }
  if (options.reason === undefined) fail("USAGE", "orchestrator-takeover requires --reason TEXT");
  const { sessionId, source } = callingTakeoverSession(options);
  const reason = transitionReason(options);
  const before = readState(context);
  if (leafSessionOf(before, sessionId)) {
    fail("ORCHESTRATOR_TAKEOVER", "session " + sessionId + " is a leaf session of this package; a leaf never orchestrates it", 1);
  }
  const silentMs = assertPreviousSilent(context, packageOrchestrator(before), sessionId, reason);
  let previous = null;
  updateState(context, (fresh) => {
    previous = packageOrchestrator(fresh);
    if (previous === sessionId) return false;
    if (previous !== packageOrchestrator(before)) fail("ORCHESTRATOR_TAKEOVER", "the orchestrator changed concurrently; run the takeover again", 1);
    const silence = silentMs !== null ? { previousSilentMs: silentMs } : {};
    fresh.orchestrator = { sessionId, via: "takeover", at: new Date().toISOString(), reason, previous, sessionSource: source, ...silence };
    transition(fresh, "orchestrator-taken-over", sessionId, previous, sessionId, { reason, sessionSource: source, ...silence });
    return true;
  });
  const record = hasHarnessConfig(context.harnessRoot) ? recordOrchestrator({ harnessRoot: context.harnessRoot, sessionId,
    via: "takeover", packageRef: { repoRoot: context.repoRoot, packageId: context.packageId, scope: context.scope } }) : null;
  return { orchestrator: sessionId, previous, reason, sessionSource: source, idempotent: previous === sessionId,
    ...(record ? { record: record.record } : {}) };
}

function gateCheckLeaf(context, action, leaf) {
  return runNode(context.tools.gateCheck, [action, "--root", context.repoRoot, "--package", context.packageId,
    "--scope", context.scope, "--leaf", leaf], { cwd: context.repoRoot });
}

function samePackage(left, right) {
  return process.platform === "win32" ? String(left).toLowerCase() === String(right).toLowerCase() : left === right;
}

function leafLeases(context, leaf) {
  return runtimeScopes.classifyRuntime(context.repoRoot).leases.filter((lease) =>
    lease.scope !== null && samePackage(lease.scope, context.scope) && lease.packageId !== null &&
    samePackage(lease.packageId, context.packageId) && lease.leaf === leaf);
}

// Leases of exactly this leaf without a living holder. Whether a lease has a holder is decided by
// classifyRuntime alone; the pid inside a lease belongs to the short-lived gate-check call.
async function releaseOrphanedLeases(context, leaf) {
  const released = [];
  for (const lease of leafLeases(context, leaf)) {
    if (lease.state !== "orphaned" || lease.reason !== "no-holder") continue;
    childOk(await gateCheckLeaf(context, "--release", leaf), "orphaned lease release");
    released.push({ scope: lease.scope, packageId: lease.packageId, leaf: lease.leaf,
      file: path.relative(context.repoRoot, lease.file).split(path.sep).join("/") });
  }
  return released;
}

// The leaf lease exists afterwards: orphaned leases are released first, then the leaf is claimed
// when no lease of exactly this package/scope/leaf is left. A refused claim changes nothing.
async function ensureLease(context, leaf) {
  const released = await releaseOrphanedLeases(context, leaf);
  if (leafLeases(context, leaf).length) return { claimed: false, released };
  const claim = await gateCheckLeaf(context, "--claim", leaf);
  if (claim.status !== 0) {
    const output = String(claim.stdout || "") + String(claim.stderr || "");
    if (/CLAIM REFUSED/u.test(output)) fail("SESSION_STATE", "leaf claim refused for " + leaf + ": " + output.trim().slice(0, 2_000), 1);
    childOk(claim, "leaf claim");
  }
  return { claimed: true, released };
}

// Frees the lease and the binding of a session whose worker is gone, never while another session of
// the same scope and leaf still works (runtimeScopes.WORKING_STATES is the one busy set).
// The release itself runs outside the state lock; only its record goes through updateState.
async function releaseLeaf(context, sessionId, reason) {
  const current = readState(context);
  const entry = current.sessions[sessionId];
  if (!entry || entry.leaseReleasedAt) return false;
  const busy = Object.values(current.sessions).some((other) => other.sessionId !== sessionId && other.leaf === entry.leaf &&
    runtimeScopes.WORKING_STATES.includes(other.state));
  if (busy) return false;
  childOk(await gateCheckLeaf(context, "--release", entry.leaf), "leaf release");
  restoreMainBinding(context, sessionId);
  packageBinding.removeBinding({ repoRoot: context.repoRoot, scope: context.scope, sessionId,
    controlRoot: context.harnessRoot });
  updateState(context, (state) => {
    const target = state.sessions[sessionId];
    if (!target || target.leaseReleasedAt) return false;
    target.leaseReleasedAt = new Date().toISOString();
    transition(state, "leaf-released", sessionId, target.state, target.state, { leaf: target.leaf, reason });
    return true;
  });
  return true;
}

function runTerminal(context, entry) {
  if (!entry.runId) return RELEASING_STATES.has(entry.state);
  try { return TERMINAL_RUN_STATES.has(readProviderRun(context.repoRoot, context.scope, entry.runId).state); }
  catch { return false; }
}

// After abort, abandon or timeout: every session of the wave whose run is terminal lets go.
async function releaseWave(context, waveId, reason) {
  const state = readState(context);
  const wave = state.waves[waveId];
  if (!wave) return;
  for (const sessionId of wave.sessions) {
    const entry = state.sessions[sessionId];
    if (!entry || ["verified", "reassigned", "reopened"].includes(entry.state) || !runTerminal(context, entry)) continue;
    await releaseLeaf(context, sessionId, reason);
  }
}

function contextFor(options, requirePackage = true) {
  const snapshot = repository.repositorySnapshot(options.root || process.cwd());
  const harnessRoot = path.resolve(options.harnessRoot || snapshot.repoRoot);
  const packageId = requirePackage ? id(options.packageId, "package") : options.packageId;
  const scope = id(options.scope || packageId, "scope");
  const unlazyRoot = locateUnlazy(snapshot.repoRoot, options.unlazyRoot);
  silenceWatchRoot = unlazyRoot;
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
    .filter((entry) => ["prepared", "starting", "running", "provider-returned", "abort-requested", "timeout-requested",
      QUEUED_STATE, START_FAILED_STATE, ...STOPPED_FOR_DECISION].includes(entry.state)).map((entry) => entry.leaf));
  const next = context.packageInfo.leaves.find((leaf) => ledgerRecord(context.packageInfo, leaf).open && !busy.has(leaf));
  if (!next) fail("NO_READY_LEAF", "no unclaimed open leaf remains");
  return next;
}

function safeModel(value, fallback) {
  const text = String(value || fallback);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(text)) fail("USAGE", "invalid model or effort identifier");
  return text;
}

// Modell eines Claude-Workers; „[1m]“ am Ende ist die Kontextwahl 1M (resolve.mjs, cliModel).
export function workerModel(value) {
  const text = String(value || "");
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}(?:\[1m\])?$/u.test(text)) fail("USAGE", "invalid model or effort identifier");
  return text;
}

// OWNS-Pfade eines Leafs; die Codex-Sperre für Dashboard-Pakete hängt an genau diesen Werten.
export function leafOwns(ledgerText) {
  const line = String(ledgerText).match(/^OWNS:\s*(.+)$/mu);
  return line ? line[1].split(",").map((item) => item.trim()).filter(Boolean) : [];
}

// Modellwahl je Prozess (new-harness-process-model-settings, Plan-Schritt 10): Anbieter und Modell der
// Paket-Ausführung kommen aus harness-core/process-models (Einstellung, Voreinstellung Claude, oder
// ausdrücklich im Aufruf, dann gegen die Regeln geprüft). Codex ist für Dashboard-Pakete gesperrt.
// Eine MODEL-Zeile im Kopf des Leaf-Ledgers oder in GATES.md legt Modell und Stufe je Leaf oder Paket
// fest (executor-model-effort R4); Vorrang: Aufruf, Leaf, Paket, Einstellung, Voreinstellung.
function packageModel(context, options, ledgerText, fallbackProvider, leafFile = null) {
  const provider = options.provider !== undefined ? String(options.provider) : fallbackProvider;
  if (provider !== undefined && !PROVIDERS.has(provider)) fail("USAGE", "provider must be claude or codex");
  const owns = leafOwns(ledgerText);
  let resolution;
  try {
    const gatesPath = path.join(context.packageInfo.packageDir, "GATES.md");
    const gatesText = fs.existsSync(gatesPath) ? fs.readFileSync(gatesPath, "utf8") : "";
    const relative = (file) => path.relative(context.repoRoot, file).split(path.sep).join("/");
    const declared = declaredModelChoice({ leafText: ledgerText, leafFile: leafFile ? relative(leafFile) : "leaf ledger",
      gatesText, gatesFile: relative(gatesPath) });
    resolution = resolvePackageExecutionModel({ harnessRoot: context.harnessRoot, env: process.env, owns, declared,
      call: { provider, model: options.model, effort: options.effort } });
  } catch (error) {
    if (error?.name === "ProcessModelError" || error?.name === "ProcessModelUnavailableError") {
      fail(error.code === "process_model_not_allowed" ? "PROVIDER_LOCKED" : "PROCESS_MODEL", error.message);
    }
    throw error;
  }
  if (resolution.provider === "codex" && ((options.model && options.model !== CODEX_PIN.model) || (options.effort && options.effort !== CODEX_PIN.effort))) {
    fail("CODEX_DEFAULTS", `delegated Codex package work requires ${CODEX_PIN.model} with effort ${CODEX_PIN.effort}`);
  }
  return resolution;
}

// The exact provider call of a leaf, as the dispatch will start it (field name kept for the
// Dashboard). Both providers run under the Harness root's guards (guard-parity E6/E8): Claude
// with the root's PreToolUse hooks as its only settings, Codex through `codex exec` with the
// same guards handed over as hooks -- no longer through /codex:rescue, which runs no Harness
// hooks in a nested project repository (measured 10.09.2026 and 01.10.2026).
export function delegation(resolution, briefFile) {
  const prompt = `Read ${JSON.stringify(briefFile)} and execute exactly that bound leaf contract. Do not widen OWNS. ` +
    "Return a concise result; the parent will reverify locally.";
  const modelChoice = { source: resolution.source, label: resolution.label, side: resolution.side, ...(resolution.reason ? { reason: resolution.reason } : {}) };
  if (resolution.provider === "codex") {
    const model = safeModel(resolution.model, CODEX_PIN.model);
    const effort = safeModel(resolution.effort, CODEX_PIN.effort);
    return {
      provider: "codex",
      model,
      effort,
      modelChoice,
      pluginCommand: `codex exec --json --dangerously-bypass-hook-trust -s workspace-write -m ${model} ` +
        `-c model_reasoning_effort='${effort}' -c hooks.PreToolUse=<Harness guards> ${JSON.stringify(prompt)}`,
    };
  }
  const model = resolution.cliModel ? workerModel(resolution.cliModel) : null;
  // Die gewählte Stufe erreicht den Aufruf (executor-model-effort R3); ohne gültige Stufe kein --effort.
  const effort = resolution.effort && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(String(resolution.effort))
    ? String(resolution.effort) : null;
  return {
    provider: "claude",
    model,
    effort,
    modelChoice,
    pluginCommand: `claude ${model ? `--model ${model} ` : ""}${effort ? `--effort ${effort} ` : ""}-p --output-format stream-json --verbose ` +
      `--permission-mode bypassPermissions --setting-sources "" --settings <Harness guards> ${JSON.stringify(prompt)}`,
  };
}

function briefPath(context, sessionId) {
  return path.join(context.repoRoot, ".unlazy", context.scope, "executor", "briefs",
    crypto.createHash("sha256").update(sessionId).digest("hex") + ".md");
}

function writeBrief(context, state, entry, ledger) {
  const file = briefPath(context, entry.sessionId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
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
    ...restartSection(entry.restart),
    "## Original Owner request (immutable)",
    "",
    "<!-- owner-request-begin: the Owner's complete text, verbatim; headings and lists inside it are part of the text -->",
    // The complete text (C7): an older OWNER.md without end marker keeps a request digest that stops at its first
    // heading, but the order the agent gets runs to the requirements.
    context.packageInfo.owner.requestText || state.originalOwnerRequest,
    "<!-- owner-request-end -->",
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
    // Command index, Owner grants, check of Owner statements and the way to publish (A18, D6, D8, C8, D17): the
    // worker sees neither the instructions nor the rules of the Harness, so they are part of every brief.
    ...guidanceSections({ harnessRoot: context.harnessRoot, sessionId: entry.sessionId }),
    "## Execution rules",
    "",
    "- Write only inside the exact OWNS patterns above; hooks verify the session binding.",
    `- Create and change files only with the provider's write tool (${entry.provider === "codex" ? "apply_patch" : "Write/Edit"}), ` +
      "never by shell redirection (`>`, `>>`, `tee`, `Set-Content`, `Out-File`) and never with `node -e`.",
    "- Run tests as `node --test <files>` (files directly in a test/ folder); the only switches are the ones the command index lists, never a loader, a reporter module or inline code.",
    "- If the guard denies a call, do not work around it: name the command and the denial code in your return; the orchestrator re-verifies locally.",
    "- Use the finite Git intent interface; do not search for alternate mutating Git commands.",
    "- Do not mark gates or package plan items complete yourself.",
    "- Return facts and the native provider handle. The parent locally reverifies the gate.",
    "- Provider success is not Evidence and does not satisfy the original Owner request.",
    ...executionRules(),
    "",
  ].join("\n");
  fs.writeFileSync(file, value, { encoding: "utf8", flag: fs.existsSync(file) ? "w" : "wx" });
  return { file, digest: digest(value), binding };
}

// Removes an activated scope during a rollback, but only while it holds nothing that activation and
// this executor did not write; anything else stays and is named.
function removeActivatedScope(context, leftInPlace) {
  const directory = path.join(context.repoRoot, ".unlazy", context.scope);
  let entries;
  try { entries = fs.readdirSync(directory); } catch { return; }
  const foreign = entries.filter((name) => !ACTIVATION_ENTRIES.has(name));
  if (foreign.length) {
    leftInPlace.push(path.relative(context.repoRoot, directory).split(path.sep).join("/") + " (holds " + foreign.join(", ") + ")");
    return;
  }
  fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
}

// The undo of a prepared session under the lock: a state file this start created and that holds
// nothing else goes away; otherwise only this session leaves, recorded as an event.
function rollbackPreparedSession(context, sessionId, existedBefore) {
  const file = statePath(context.repoRoot, context.scope);
  const lock = acquireStateLock(context);
  try {
    if (!fs.existsSync(file)) return;
    const state = readState(context);
    delete state.sessions[sessionId];
    const own = state.events.every((event) => event.subject === sessionId || event.type === "owner-start-verified");
    if (!existedBefore && own && !Object.keys(state.sessions).length && !Object.keys(state.waves).length) {
      fs.rmSync(file, { force: true });
      return;
    }
    transition(state, "session-rolled-back", sessionId, "prepared", null, {});
    atomicJson(file, state);
  } finally {
    releaseStateLock(lock);
  }
}

// Runtime-state-recovery R1: activation and leaf preparation are one step. Phase 1 decides everything
// without writing under .unlazy or in the bundle; phase 2 writes with a rollback journal, so a refused
// start leaves no activated scope, lease, binding, index entry or executor state behind.
async function prepare(context, options, explicitLeaf) {
  // Phase 1: read and decide only.
  const sessionId = session(options.sessionId);
  const bootstrapSessionId = options.bootstrapSession ? session(options.bootstrapSession) : null;
  assertNotOrchestrator({ harnessRoot: context.harnessRoot, sessionId, env: process.env, bootstrapSession: bootstrapSessionId });
  if (bootstrapSessionId) {
    const bootstrapRecord = packageBootstrap.find({ harnessRoot: context.harnessRoot, sessionId: bootstrapSessionId });
    if (!repository.samePath(bootstrapRecord.repoRoot, context.repoRoot) ||
        bootstrapRecord.packageId !== context.packageId || bootstrapRecord.scope !== context.scope) {
      fail("BOOTSTRAP_IDENTITY", "bootstrap session does not own this repository, package, and scope");
    }
  }
  const stateExisted = fs.existsSync(statePath(context.repoRoot, context.scope));
  const state = readState(context, true);
  if (state.sessions[sessionId]) {
    const existing = state.sessions[sessionId];
    if (existing.state !== "prepared") fail("SESSION_EXISTS", "session already exists in state " + existing.state);
    return { state, entry: existing, idempotent: true, releasedLeases: [] };
  }
  // Ein Paket startet erst mit einem Owner-Startsatz (orchestrator-rules-enforcement R3); geprueft wird
  // nur der erste Start, spaetere Leaves desselben Pakets tragen state.ownerStart.
  const ownerStart = stateExisted ? null : verifyOwnerStart({ harnessRoot: context.harnessRoot, repoRoot: context.repoRoot,
    packageId: context.packageId, runPackageId: options.run ?? null });
  const leaf = leafForNext(context, state, explicitLeaf);
  const ledger = ledgerRecord(context.packageInfo, leaf);
  const modelResolution = packageModel(context, options, ledger.text, undefined, ledger.file);
  const provider = modelResolution.provider;
  await doctor(context);
  const { dormant, young } = splitOverlaps(context,
    packageOwnership.crossPackageOverlaps(context.repoRoot, context.packageId, context.scope));
  if (young.length) failOverlap(context, young);
  const occupied = packageBinding.sessionConflict({ repoRoot: context.repoRoot, scope: context.scope, sessionId, leaf,
    controlRoot: context.harnessRoot });
  if (occupied) fail("SESSION_OCCUPIED", occupied, 1);

  // Phase 2: every step carries its undo.
  const journal = [];
  try {
    // (1) Leases of this leaf without a living holder are orphaned; releasing them needs no undo.
    const releasedLeases = await releaseOrphanedLeases(context, leaf);
    // (2) Dormant overlaps are set aside, unchanged.
    const now = Date.now();
    const suspended = [];
    for (const scope of dormant) {
      const moved = setAsideScope(context.repoRoot, scope, now);
      if (!moved) continue;
      suspended.push(moved);
      journal.push({ step: "set-aside " + scope, undo: () => renameWithRetry(path.join(context.repoRoot, ...moved.movedTo.split("/")),
        path.join(context.repoRoot, ".unlazy", scope)) });
    }
    if (suspended.length) context.suspendedScopes = suspended;
    const remaining = packageOwnership.crossPackageOverlaps(context.repoRoot, context.packageId, context.scope);
    if (remaining.length) failOverlap(context, remaining);
    // (3) Activation.
    const activation = childOk(await runNode(context.tools.packageCli, ["activate", "--root", context.repoRoot,
      "--package", context.packageId, "--scope", context.scope, "--json"], { cwd: context.repoRoot }), "package activation");
    let report = null;
    try { report = JSON.parse(activation); } catch { /* an older Unlazy prints no JSON report */ }
    if (Array.isArray(report?.retiredScopes) && report.retiredScopes.length) context.retiredScopes = report.retiredScopes;
    if (report?.activated === true) {
      journal.push({ step: "activation", undo: (leftInPlace) => removeActivatedScope(context, leftInPlace) });
    }
    // (4) Leaf claim.
    childOk(await gateCheckLeaf(context, "--claim", leaf), "leaf claim");
    journal.push({ step: "leaf claim", undo: async () => childOk(await gateCheckLeaf(context, "--release", leaf), "leaf release") });
    // (5) Binding.
    const hadBinding = fs.existsSync(packageBinding.bindingPath(context.repoRoot, context.scope, sessionId));
    packageBinding.createBinding({ startPath: context.repoRoot, packageId: context.packageId,
      scope: context.scope, sessionId, leaf, controlRoot: context.harnessRoot });
    if (!hadBinding) {
      journal.push({ step: "binding", undo: () => packageBinding.removeBinding({ repoRoot: context.repoRoot,
        scope: context.scope, sessionId, controlRoot: context.harnessRoot }) });
    }
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
    // (6) Brief.
    const briefFile = briefPath(context, sessionId);
    const hadBrief = fs.existsSync(briefFile);
    const brief = writeBrief(context, state, entry, ledger);
    if (!hadBrief) journal.push({ step: "brief", undo: () => fs.rmSync(briefFile, { force: true }) });
    Object.assign(entry, { briefFile: path.relative(context.repoRoot, brief.file).replaceAll("\\", "/"),
      briefDigest: brief.digest, owns: brief.binding.owns, delegation: delegation(modelResolution, brief.file),
      checkOnly: leafCheckOnly(ledger.text) });
    // (6b) The working tree at the start of this step (C4, C11); launch takes it again when the agent really starts.
    const hadSnapshot = fs.existsSync(snapshotFile(context, sessionId));
    await recordSnapshot(context, sessionId);
    if (!hadSnapshot) journal.push({ step: "snapshot", undo: () => fs.rmSync(snapshotFile(context, sessionId), { force: true }) });
    // (7) Executor state, the last state step, applied to the state as it is now.
    const file = statePath(context.repoRoot, context.scope);
    const existedBefore = fs.existsSync(file);
    const written = updateState(context, (fresh) => {
      if (fresh.sessions[sessionId] || fresh.history.sessions[sessionId]) {
        fail("SESSION_EXISTS", "session " + sessionId + " was prepared concurrently", 1);
      }
      fresh.sessions[sessionId] = entry;
      if (ownerStart && !fresh.ownerStart) {
        fresh.ownerStart = { kind: ownerStart.kind, date: ownerStart.date, wording: ownerStart.wording,
          runPackageId: ownerStart.runPackageId, lineDigest: ownerStart.lineDigest };
        transition(fresh, "owner-start-verified", context.packageId, null, ownerStart.kind, fresh.ownerStart);
      }
      transition(fresh, "session-prepared", sessionId, null, "prepared", { leaf, provider, attempt: 1 });
    }, { create: true });
    Object.assign(state, written);
    journal.push({ step: "executor state", undo: () => rollbackPreparedSession(context, sessionId, existedBefore) });
    // (8) The planning session orchestrates; without one, the first starting session does. Any later starter is
    // entered nowhere (one orchestrator per package).
    noteOrchestrator(context, bootstrapSessionId, "bootstrap");
    noteOrchestrator(context, callerSession(process.env), options.command === "next" ? "next" : "start");
    // (9) The planning binding ends.
    if (bootstrapSessionId) packageBootstrap.finish({ harnessRoot: context.harnessRoot, sessionId: bootstrapSessionId });
    return { state, entry, idempotent: false, releasedLeases };
  } catch (error) {
    const rolledBack = [];
    const leftInPlace = [];
    for (const item of journal.reverse()) {
      try { await item.undo(leftInPlace); rolledBack.push(item.step); }
      catch (undoError) { leftInPlace.push(item.step + " (" + undoError.message + ")"); }
    }
    if (rolledBack.length) error.message += "; rolled back: " + rolledBack.join(", ");
    if (leftInPlace.length) error.message += "; left in place: " + leftInPlace.join("; ");
    throw error;
  }
}

// --- The working tree at the start of a step and at its return (P13, C4 and C11; worktree-snapshot.mjs) ----------------

function snapshotFile(context, sessionId) {
  return path.join(context.repoRoot, ".unlazy", context.scope, "executor", "snapshots",
    crypto.createHash("sha256").update(sessionId).digest("hex") + ".json");
}

function snapshotGit(context) {
  return (args) => gitResult(context.repoRoot, args);
}

// Stores the working tree as the baseline of a step. A failing Git leaves no baseline, and without one a return is judged
// by the gate re-verification alone, as before.
async function recordSnapshot(context, sessionId) {
  const snapshot = await takeSnapshot({ repoRoot: context.repoRoot, git: snapshotGit(context) });
  if (!snapshot) return false;
  // The package contract files in their normalized form (ticks, Status, Abschluss and EVIDENCE values left out): a later
  // change that only touches those is the executor's and the gates' own writing.
  snapshot.contracts = contractDigests(context.repoRoot, context.packageId, await packageContractNormalizer());
  try { writeSnapshot(snapshotFile(context, sessionId), snapshot); return true; } catch { return false; }
}

// normalizePackageContractContent of the vendored Unlazy (scripts/lib/ledger-normalize.cjs), the one definition of
// what in a package contract file is runtime writing (P7b). git-intent loads it for the source tree and the installed
// payload alike; a missing module fails loudly instead of falling back to a copy.
async function packageContractNormalizer() {
  return loadLedgerNormalize().normalizePackageContractContent;
}

// A step whose agent really ran at some time in [windowStart, windowEnd] (P13, C11): it is starting, running or has
// returned its provider, or one of its runs (the current one, a failed one, an earlier attempt) overlaps the window by
// the start and end time of that run. prepared, queued, start-failed and steps stopped before the window do not count.
const RUNNING_STEP_STATES = new Set(["starting", "running", "provider-returned"]);

function stepRanInWindow(context, step, windowStart, windowEnd) {
  if (RUNNING_STEP_STATES.has(step.state)) return true;
  const runIds = new Set([step.runId, step.failedRunId, ...(Array.isArray(step.attempts) ? step.attempts.map((item) => item?.runId) : [])]
    .filter((value) => typeof value === "string" && value));
  for (const runId of runIds) {
    let run;
    try { run = readProviderRun(context.repoRoot, context.scope, runId); } catch { continue; }
    const started = Date.parse(run.startedAt || "");
    if (!Number.isFinite(started)) continue; // the worker never started: nothing of it ran
    let ended = Date.parse(run.finishedAt || "");
    if (!Number.isFinite(ended)) ended = TERMINAL_RUN_STATES.has(run.state) ? Date.parse(run.lastHeartbeatAt || "") : windowEnd;
    if (!Number.isFinite(ended)) ended = started;
    if (started <= windowEnd && ended >= windowStart) return true;
  }
  return false;
}

function ownsMatcher(owns) {
  const patterns = (owns || []).map((item) => packageBinding.globRegex(item));
  return (relative) => patterns.some((pattern) => pattern.test(relative));
}

// A leaf whose head (before its first gate) carries `READ-ONLY: yes` is a pure check: it changes no file, so its return
// needs no change in its OWNS (C4). A leaf without OWNS is one as well (the binding itself requires OWNS today).
export function leafCheckOnly(ledgerText) {
  for (const line of String(ledgerText).split(/\r?\n/u)) {
    if (/^- \[[ xX]\] /u.test(line)) break;
    if (/^READ-ONLY:\s*(?:yes|ja|true)\s*$/iu.test(line.trim())) return true;
  }
  return false;
}

// What changed in the working tree since the step started: the files in its own OWNS (C4) and the files outside the OWNS
// of every step whose agent really ran in that window (C11). Not judged are the runtime of the harness and, in this
// package's bundle, only what the executor and the gates write themselves: the brief of a step, and in PACKAGE.md,
// GATES.md and gates/*.md the ticks, Status, Abschluss and EVIDENCE values (equal normalized form before and after).
// OWNER.md and everything else in the bundle is judged. Nothing is ever reverted.
async function judgeWorktree(context, state, entry) {
  const before = readSnapshot(snapshotFile(context, entry.sessionId));
  if (!before) return { judged: false };
  const git = snapshotGit(context);
  const after = await takeSnapshot({ repoRoot: context.repoRoot, git });
  if (!after) return { judged: false };
  const changed = await changedBetween({ repoRoot: context.repoRoot, git, before, after });
  const inOwns = changed.filter(ownsMatcher(entry.owns));
  const windowStart = Date.parse(before.takenAt);
  const windowEnd = Date.now();
  const others = [...Object.values(state.sessions), ...Object.values(state.history.sessions)]
    .filter((other) => other && other.sessionId !== entry.sessionId && stepRanInWindow(context, other, windowStart, windowEnd));
  const allowed = [entry, ...others].map((item) => ownsMatcher(item.owns));
  const fold = (value) => (process.platform === "win32" ? value.toLowerCase() : value);
  const briefs = new Set([...Object.values(state.sessions), ...Object.values(state.history.sessions)]
    .map((item) => item?.briefFile).filter(Boolean).map((value) => fold(String(value).replaceAll("\\", "/"))));
  const normalize = await packageContractNormalizer();
  const executorWritten = (relative) => briefs.has(fold(relative)) || contractChangeOnlyRuntime({ repoRoot: context.repoRoot,
    packageId: context.packageId, relative, before: before.contracts, normalize });
  const outside = changed.filter((relative) => !isRuntimePath(relative) && !allowed.some((match) => match(relative)) &&
    !executorWritten(relative));
  return { judged: true, changed, inOwns, outside };
}

function dispatchSessions(state, values) {
  const selected = values.length ? values.map((value) => session(value)) :
    Object.values(state.sessions).filter((entry) => entry.state === "prepared").map((entry) => entry.sessionId);
  if (!selected.length) fail("USAGE", "dispatch requires at least one prepared --session");
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

// A stop the parent requested stays requested (decision 3): the measured 02.10.2026 run showed abandonWave
// setting abort-requested and a later sync overwriting it with provider-returned. Sessions that left
// the provider route (verified, reassigned, reopened) keep their state as well.
const REQUESTED_STATES = new Set(["abort-requested", "timeout-requested"]);
const SETTLED_STATES = new Set(["verified", "reassigned", "reopened", "transferred"]);
const CLOSED_STOP_STATES = new Set(["aborted", "timed-out"]);

// A requested stop ends in aborted (timed-out) once its worker is gone and its wave is abandoned: the
// worker of an abandoned wave has nothing left to do, and a session that stays on abort-requested keeps the
// scope busy for package-amend (measured 02.10.2026: AMEND_BUSY after "abandon", no command closed it).
// A requested session whose provider still lives stays requested.
function closedStopState(state, entry, providerEnded, needAbandoned = true) {
  if (!REQUESTED_STATES.has(entry.state) || !providerEnded) return null;
  // A wave that already left the state (closed as unknown to the dispatch, P13) counts as abandoned.
  const wave = state.waves[entry.wave];
  if (needAbandoned && (!entry.wave || (wave && wave.state !== "abandoned"))) return null;
  return entry.state === "timeout-requested" ? "timed-out" : "aborted";
}

// Applies the closing to the session of a fresh state; false means nothing was closed.
function closeRequestedStop(state, sessionId, providerEnded, closedBy, extra = {}, needAbandoned = true) {
  const entry = state.sessions[sessionId];
  const next = entry && closedStopState(state, entry, providerEnded, needAbandoned);
  if (!next) return false;
  setSessionState(state, entry, next, "stop-closed", { closedBy, closedAt: new Date().toISOString(), ...extra });
  return true;
}

// Reads the provider run outside the lock and applies its result to the fresh session: the run's handle,
// end and output always land in the session's fields; the session state follows the run unless the
// session is requested or settled. Returns the fresh session entry.
async function synchronizeSession(context, sessionId) {
  const known = sessionOf(readState(context), sessionId);
  if (!known.runId) {
    // A requested stop of an abandoned wave that never had a run has no worker to wait for.
    if (known.wave && REQUESTED_STATES.has(known.state)) {
      let closed = false;
      updateState(context, (fresh) => { closed = closeRequestedStop(fresh, sessionId, true, "sync"); return closed; });
      if (closed) await releaseLeaf(context, sessionId, "requested stop closed: the session has no provider run");
    }
    return readState(context).sessions[sessionId] || known;
  }
  const run = await refreshProviderRun({ repoRoot: context.repoRoot, scope: context.scope, runId: known.runId,
    expected: { packageId: context.packageId, sessionId, leaf: known.leaf, provider: known.provider } });
  let released = null;
  const state = updateState(context, (fresh) => {
    const entry = fresh.sessions[sessionId];
    if (!entry || entry.runId !== run.runId) return false;
    const closedState = closedStopState(fresh, entry, TERMINAL_RUN_STATES.has(run.state));
    // A closed stop (aborted, timed-out) stays closed: a later sync only refreshes the run fields.
    const next = closedState || (REQUESTED_STATES.has(entry.state) || SETTLED_STATES.has(entry.state) ||
      CLOSED_STOP_STATES.has(entry.state) || entry.state === "returned-unchanged" ? entry.state : providerSessionState(run));
    const detail = {
      runId: run.runId,
      handle: run.nativeHandle || entry.handle || null,
      deadlineAt: run.deadlineAt,
      lastHeartbeatAt: run.lastHeartbeatAt,
      providerRunState: run.state,
      providerFinishedAt: run.finishedAt || null,
      providerExitCode: run.exitCode ?? null,
      providerOutputDigest: run.providerOutputDigest || entry.providerOutputDigest || null,
      providerOutputEvidence: false,
      ...(run.failure ? { failure: run.failure } : {}),
      ...(run.blocked ? { blocked: run.blocked } : {}),
      // D12: a log that was cut at its size bound is named, here and in status.
      ...(run.logTruncated === true ? { logTruncated: true } : {}),
      ...(Array.isArray(run.hints) && run.hints.length ? { hints: run.hints } : {}),
    };
    if (entry.state === next && entry.lastHeartbeatAt === detail.lastHeartbeatAt && entry.handle === detail.handle &&
        entry.providerRunState === detail.providerRunState) return false;
    const before = entry.state;
    setSessionState(fresh, entry, next, closedState ? "stop-closed" : "provider-sync",
      closedState ? { ...detail, closedBy: "sync", closedAt: new Date().toISOString() } : detail);
    // Only the transition into a releasing state frees lease and binding, not every later status call; a
    // requested stop whose run has ended lets go as well, because its worker is gone.
    if ((before !== next && RELEASING_STATES.has(next)) || (REQUESTED_STATES.has(next) && RELEASING_STATES.has(run.state))) {
      released = "provider run " + run.state;
    }
    return true;
  });
  if (released) await releaseLeaf(context, sessionId, released);
  return readState(context).sessions[sessionId] || state.sessions[sessionId];
}

// Own provider programs (--claude-executable, --claude-prefix-arg, --codex-executable) are
// test fixtures only. Outside the test mode they would let this declared Harness tool start
// any program without the guards and without a permission prompt (guard-parity E7). The test
// mode is an environment variable an agent cannot set through a guarded shell, because the
// shell guard refuses environment overrides in Bash and PowerShell alike.
export function assertProviderOverrides(options, env = process.env) {
  const overrides = [options.claudeExecutable && "--claude-executable", options.claudePrefixArgs.length && "--claude-prefix-arg",
    options.codexExecutable && "--codex-executable"].filter(Boolean);
  if (overrides.length && env.KEEL_EXECUTOR_TEST_MODE !== "1") {
    fail("PROVIDER_OVERRIDE", overrides.join(", ") + " is only available to the executor's own tests (KEEL_EXECUTOR_TEST_MODE=1)", 1);
  }
}

// The call values a queued member starts with later (the call that dispatched the wave is long over by then).
function launchSettings(options) {
  const settings = {};
  for (const key of ["deadlineSeconds", "maxTurns", "costBudgetUsd", "tokenBudget"]) {
    if (options[key] !== undefined) settings[key] = options[key];
  }
  // P18: the wave remembers that its steps work in copies of their own; a queued member starts later with the same setting.
  if (options.stepCopy) settings.stepCopy = true;
  return settings;
}

// The handle a queued member holds in the Unlazy wave until its provider starts: the dispatch seals only a wave whose
// members all hold one, and restart replaces it by the real handle (P13, C2).
function queuedHandle(wave, sessionId) {
  return "queued-" + crypto.createHash("sha256").update(wave + ":" + sessionId).digest("hex").slice(0, 24);
}

function startFailureOf(error) {
  return { code: error.code || "PROVIDER_START_FAILED", message: String(error.message || error).slice(0, 2_000) };
}

// A member leaves its wave unstarted (P13, C6): back to prepared without a wave, the attempt kept, so the next dispatch can
// take it at once. Used when no agent of the wave could start, for the queued and start-failed members of a wave whose
// dispatch broke down, and for the members of a wave the Unlazy dispatch does not know.
function releaseFromWave(fresh, sessionId, wave, why, failure = null) {
  const target = fresh.sessions[sessionId];
  if (!target) return false;
  target.attempts ||= [];
  target.attempts.push({ attempt: target.attempt || 1, state: target.state, wave, runId: target.failedRunId || target.runId || null,
    handle: null, failure: failure || target.failure || null, archivedAt: new Date().toISOString() });
  const before = target.state;
  Object.assign(target, { state: "prepared", attempt: (target.attempt || 1) + 1, wave: null, runId: null, handle: null,
    failedRunId: null, failure: null, ...(failure ? { startFailure: failure } : {}), deadlineAt: null, lastHeartbeatAt: null,
    updatedAt: new Date().toISOString() });
  transition(fresh, "session-start-undone", sessionId, before, "prepared", { wave, why, ...(failure ? { failure } : {}) });
  return true;
}

// The history key of a wave that leaves the state: the wave id, or wave~2, wave~3 ... when the id is there already, so a
// second failure under the same id keeps the reason of the first.
function historyWaveKey(fresh, wave) {
  let key = wave;
  for (let number = 2; fresh.history.waves[key]; number += 1) key = wave + "~" + number;
  return key;
}

// Unlazy accepts a printable reason of at most 500 characters.
function dispatchReason(text) {
  return String(text).replace(/[\u0000-\u001f\u007f-\u009f]/gu, " ").replace(/\s+/gu, " ").trim().slice(0, 480) || "dispatch failed";
}

// A wave in which no agent could start (P13, C6): the members are prepared again and the wave moves to the history with
// its reason, so nothing of it stays open in the executor. The Unlazy wave was opened before any start and is discarded
// with the same reason by the caller (unlazy: "discarded", or "abandoned" when the discard was refused).
function discardFailedWave(context, wave, sessionIds, failures, forced, unlazy) {
  const unlazyAbandoned = unlazy === "abandoned";
  const unlazyDiscarded = unlazy === "discarded";
  const reason = "no agent of wave " + wave + " could start: " + failures.map((item) => item.sessionId + " (" + item.failure.code +
    ": " + item.failure.message + ")").join("; ");
  updateState(context, (fresh) => {
    const record = fresh.waves[wave];
    for (const sessionId of sessionIds) {
      const failure = failures.find((item) => item.sessionId === sessionId)?.failure || null;
      if (fresh.sessions[sessionId] && fresh.sessions[sessionId].wave === wave) releaseFromWave(fresh, sessionId, wave, "no agent of the wave started", failure);
    }
    const key = historyWaveKey(fresh, wave);
    if (record) {
      fresh.history.waves[key] = { ...record, state: "failed-start", reason, failedAt: new Date().toISOString(),
        failures: failures.map((item) => ({ sessionId: item.sessionId, ...item.failure })), forcedStart: forced,
        unlazyAbandoned, unlazyDiscarded };
      delete fresh.waves[wave];
    }
    transition(fresh, "wave-start-failed", wave, "open", "failed-start", { reason, sessions: sessionIds, historyKey: key, unlazyAbandoned, unlazyDiscarded });
  });
  return reason;
}

// dispatch (P13, C2 and C6). The order is the one from before P13: the executor checks the wave and its members, the
// Unlazy wave is opened, and only then the wave enters the state and the first provider starts. A refused open leaves
// nothing behind: no wave in the state, no agent, the members stay prepared.
// A wave may have any number of members. They start in order while the free memory still leaves the floor after one
// more agent (1 GB each, ram-floor.mjs); the rest wait as "queued" in the wave and start when an agent ends (every
// return, and status). With no room at all one member starts anyway so the wave does not starve; that is reported.
// The queued and the start-failed members hold a placeholder handle in the Unlazy wave until they really start.
// When no agent could start, the Unlazy wave is discarded with the reason (Unlazy removes a wave only while no leaf of it
// started), the executor wave moves to the history with it and every member is prepared again; the same wave id is free
// for the next dispatch at once. Should the discard be refused, the Unlazy wave is abandoned instead (recover ends it).
async function dispatch(context, options) {
  await assertActive(context);
  assertProviderOverrides(options);
  const state = readState(context);
  const wave = id(options.wave, "wave");
  if (state.waves[wave]) fail("WAVE_EXISTS", "wave already recorded: " + wave);
  const entries = dispatchSessions(state, options.sessions);
  const leaves = entries.map((entry) => entry.leaf);
  if (new Set(leaves).size !== leaves.length) fail("WAVE_DUPLICATE_LEAF", "a wave may start each leaf only once");
  const base = ["--root", context.repoRoot, "--package", context.packageId, "--scope", context.scope, "--wave", wave];
  const sessionIds = entries.map((entry) => entry.sessionId);
  const launch = launchSettings(options);
  const abandonUnlazy = async (reason) => {
    try { await runNode(context.tools.dispatchCheck, ["abandon", ...base, "--reason", dispatchReason(reason)], { cwd: context.repoRoot }); }
    catch { /* the original failure is reported; the wave can still be abandoned through abandon --wave */ }
  };
  // No leaf of the Unlazy wave started: discard it, so no handoff stays and the wave id is free again (P13, C6).
  const discardUnlazy = async (reason) => {
    try {
      const discarded = await runNode(context.tools.dispatchCheck, ["discard", ...base, "--reason", dispatchReason(reason)],
        { cwd: context.repoRoot });
      if (discarded.status === 0) return "discarded";
    } catch { /* fall back to abandon below */ }
    await abandonUnlazy(reason);
    return "abandoned";
  };
  // (1) Unlazy open, before the state and before any provider: a refused open leaves nothing behind.
  childOk(await runNode(context.tools.dispatchCheck, ["open", ...base, ...leaves.flatMap((leaf) => ["--leaf", leaf])],
    { cwd: context.repoRoot }), "dispatch open");
  // (2) The wave enters the state, checked against the state as it is now.
  try {
    updateState(context, (fresh) => {
      if (fresh.waves[wave]) fail("WAVE_EXISTS", "wave already recorded: " + wave);
      for (const sessionId of sessionIds) {
        if (fresh.sessions[sessionId]?.state !== "prepared") fail("SESSION_STATE", sessionId + " is not prepared");
      }
      fresh.waves[wave] = { state: "open", leaves, sessions: sessionIds, openedAt: new Date().toISOString(),
        ...(Object.keys(launch).length ? { launch } : {}) };
      transition(fresh, "wave-opened", wave, null, "open", { leaves, sessions: sessionIds });
    });
  } catch (error) {
    await discardUnlazy("executor refused the wave before any start: " + (error.message || error));
    throw error;
  }
  // (3) The providers, while there is room.
  const launched = new Map();
  const failures = [];
  const queued = [];
  let forced = false;
  for (const entry of entries) {
    const room = hasRoomFor(launched.size + 1, context.harnessRoot);
    if (!room && launched.size > 0) { queued.push(entry.sessionId); continue; }
    if (!room) forced = true;
    try {
      launched.set(entry.sessionId, await launchMember(context, options, entry.sessionId, wave, { failState: START_FAILED_STATE }));
    } catch (error) {
      failures.push({ sessionId: entry.sessionId, failure: startFailureOf(error), error });
    }
  }
  if (!launched.size) {
    const reason = "no agent of wave " + wave + " could start: " + failures.map((item) => item.sessionId + " (" +
      item.failure.code + ")").join("; ");
    const unlazy = await discardUnlazy(reason);
    discardFailedWave(context, wave, sessionIds, failures, forced, unlazy);
    throw failures[0].error;
  }
  if (queued.length) {
    updateState(context, (fresh) => {
      for (const sessionId of queued) {
        setSessionState(fresh, sessionOf(fresh, sessionId), QUEUED_STATE, "wave-queued", { wave, queuedAt: new Date().toISOString() });
      }
    });
  }
  // (4) Every member is registered (a real handle or the placeholder of a queued or failed one), then the wave is sealed.
  try {
    for (const entry of entries) {
      const run = launched.get(entry.sessionId);
      childOk(await runNode(context.tools.dispatchCheck, ["start", ...base, "--leaf", entry.leaf, "--handle",
        run ? run.nativeHandle : queuedHandle(wave, entry.sessionId)], { cwd: context.repoRoot }), "dispatch start");
    }
    childOk(await runNode(context.tools.dispatchCheck, ["seal", ...base], { cwd: context.repoRoot }), "dispatch seal");
  } catch (error) {
    const stopped = [];
    for (const run of launched.values()) {
      try {
        await requestProviderStop({ repoRoot: context.repoRoot, scope: context.scope, runId: run.runId,
          action: "abort", reason: "another provider failed before dispatch sealing" });
        stopped.push(run);
      } catch { /* preserve the original start failure and durable run state */ }
    }
    await abandonUnlazy("executor dispatch failed before wait");
    updateState(context, (fresh) => {
      for (const run of stopped) {
        const entry = fresh.sessions[run.sessionId];
        if (entry && !SETTLED_STATES.has(entry.state)) {
          setSessionState(fresh, entry, "abort-requested", "provider-abort-requested", {
            runId: run.runId, wave, reason: "dispatch wave could not be sealed" });
        }
      }
      // A queued or start-failed member never ran: it leaves the broken wave and is prepared for the next dispatch.
      for (const sessionId of sessionIds) {
        const entry = fresh.sessions[sessionId];
        if (entry && entry.wave === wave && [QUEUED_STATE, START_FAILED_STATE].includes(entry.state)) {
          releaseFromWave(fresh, sessionId, wave, "the dispatch of its wave broke down before wait");
        }
      }
      const record = fresh.waves[wave];
      if (record && ["open", "sealed"].includes(record.state)) {
        const before = record.state;
        Object.assign(record, { state: "abandoned", abandonedAt: new Date().toISOString(),
          reason: "executor dispatch failed before wait" });
        transition(fresh, "wave-abandoned", wave, before, "abandoned", { reason: record.reason });
      }
    });
    throw error;
  }
  const sealed = updateState(context, (fresh) => {
    Object.assign(fresh.waves[wave], { state: "sealed", sealedAt: new Date().toISOString() });
    transition(fresh, "wave-sealed", wave, "open", "sealed", { members: entries.length, started: launched.size,
      queued: queued.length, startFailed: failures.length, forcedStart: forced });
  });
  return { wave, state: "sealed", members: sessionIds.map((sessionId) => {
    const entry = sealed.sessions[sessionId];
    return { sessionId, leaf: entry.leaf, runId: entry.runId, handle: entry.handle, provider: entry.provider, state: entry.state };
  }), queued, startFailed: failures.map((item) => ({ sessionId: item.sessionId, ...item.failure })),
  ...(forced ? { forcedStart: true, note: "no free memory above the floor: one agent started anyway so the wave does not starve" } : {}) };
}

// Starts the queued members of sealed waves while there is room (P13, C2). Called after every return and by status.
// An agent of the same wave that still runs is waited for; with none running one member starts even without room.
// The member that starts takes the place of its placeholder handle in the Unlazy wave through restart.
async function advanceQueue(context, options = {}) {
  assertProviderOverrides({ claudePrefixArgs: [], ...options });
  const report = { started: [], failed: [], forced: [] };
  let startedNow = 0;
  for (const waveId of Object.keys(readState(context).waves)) {
    let startedInWave = 0;
    const runningIn = async () => {
      const current = readState(context);
      const members = (current.waves[waveId]?.sessions || []).map((value) => current.sessions[value]).filter(Boolean);
      for (const member of members) {
        if (member.runId && ["starting", "running"].includes(member.state)) await synchronizeSession(context, member.sessionId);
      }
      const after = readState(context);
      return (after.waves[waveId]?.sessions || []).filter((value) => ["starting", "running"].includes(after.sessions[value]?.state)).length;
    };
    for (const sessionId of [...(readState(context).waves[waveId]?.sessions || [])]) {
      const current = readState(context);
      if (current.waves[waveId]?.state !== "sealed" || current.sessions[sessionId]?.state !== QUEUED_STATE) continue;
      let force = false;
      if (!hasRoomFor(startedNow + 1, context.harnessRoot)) {
        if (startedInWave > 0 || await runningIn() > 0) break;
        force = true;
      }
      const settings = { ...(current.waves[waveId].launch || {}), ...launchSettings(options) };
      const result = await startQueued(context, { ...options, ...settings }, waveId, sessionId);
      if (result.skipped) continue;
      if (result.failure) { report.failed.push({ sessionId, ...result.failure }); continue; }
      startedNow += 1;
      startedInWave += 1;
      report.started.push(sessionId);
      if (force) report.forced.push(sessionId);
    }
  }
  return report;
}

async function startQueued(context, options, waveId, sessionId) {
  let run;
  try {
    run = await launchMember(context, options, sessionId, waveId, { failState: START_FAILED_STATE });
  } catch (error) {
    if (error.notClaimed) return { skipped: true };
    return { failure: startFailureOf(error) };
  }
  const leaf = readState(context).sessions[sessionId].leaf;
  try {
    childOk(await runNode(context.tools.dispatchCheck, ["restart", "--root", context.repoRoot, "--package", context.packageId,
      "--scope", context.scope, "--wave", waveId, "--leaf", leaf, "--handle", run.nativeHandle], { cwd: context.repoRoot }),
    "dispatch queued start");
  } catch (error) {
    try {
      await requestProviderStop({ repoRoot: context.repoRoot, scope: context.scope, runId: run.runId, action: "abort",
        reason: "the dispatch refused the handle of a queued member" });
    } catch { /* it ended meanwhile */ }
    updateState(context, (fresh) => {
      setSessionState(fresh, sessionOf(fresh, sessionId), START_FAILED_STATE, "start-failed", { runId: null, handle: null,
        failedRunId: run.runId, failure: startFailureOf(error), failedAt: new Date().toISOString() });
    });
    return { failure: startFailureOf(error) };
  }
  updateState(context, (fresh) => {
    transition(fresh, "wave-member-started", waveId, fresh.waves[waveId].state, fresh.waves[waveId].state,
      { sessionId, handle: run.nativeHandle, via: "queue" });
  });
  return { run };
}

// The Claude program a worker starts (decision 8). An explicitly named program that exists is used as it
// is. Otherwise Windows takes the newest claude.exe the Claude app keeps under
// %APPDATA%\Claude\claude-code\<version>\ or one folder deeper (measured 02.10.2026: the app moved it
// from 2.1.284\claude.exe to 2.1.286\635c1867224a\claude.exe, and every start with the old path failed
// with ENOENT); everywhere else, and when the app holds none, the claude program from PATH.
export function claudeExecutableFor(requested, env = process.env, platform = process.platform) {
  const isFile = (file) => { try { return fs.statSync(file).isFile(); } catch { return false; } };
  if (requested && isFile(requested)) return requested;
  if (platform === "win32" && env.APPDATA) {
    const found = newestAppClaude(path.join(env.APPDATA, "Claude", "claude-code"), isFile);
    if (found) return found;
  }
  return resolveClaudeExecutable(undefined, env, platform);
}

function versionParts(name) {
  return /^\d+(?:\.\d+)*$/u.test(name) ? name.split(".").map((part) => Number(part)) : null;
}

function compareVersions(left, right) {
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const difference = (left[index] || 0) - (right[index] || 0);
    if (difference) return difference;
  }
  return 0;
}

function newestAppClaude(directory, isFile) {
  let names;
  try { names = fs.readdirSync(directory, { withFileTypes: true }); } catch { return null; }
  const versions = names.filter((item) => item.isDirectory() && versionParts(item.name))
    .sort((left, right) => compareVersions(versionParts(right.name), versionParts(left.name)));
  for (const version of versions) {
    const folder = path.join(directory, version.name);
    const direct = path.join(folder, "claude.exe");
    if (isFile(direct)) return direct;
    let inner = [];
    try { inner = fs.readdirSync(folder, { withFileTypes: true }).filter((item) => item.isDirectory()); } catch { inner = []; }
    const nested = inner.map((item) => path.join(folder, item.name, "claude.exe")).filter(isFile)
      .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);
    if (nested.length) return nested[0];
  }
  return null;
}

// Starts the provider of one prepared session for a wave and records its handle. The provider start is
// long work and runs outside the state lock; the state changes before and after it go through updateState.
// failState is where a failed start leaves the member: provider-start-failed (the member leaves its wave through
// retry or restart) or, for a wave that goes on without it, start-failed (retry queues it again) (P13, C6).
// --- A working copy of its own for a step (P18; step-copy.mjs) ---------------------------------------------------------
// The copy gets its own binding (the guards find a binding from the repository of the written file, and the copy is a
// repository of its own), the package.ref of the scope, and a brief that names the copy as the repository.
function stepCopyGit(context) {
  return (args) => gitResult(context.repoRoot, args);
}

// While a step works in its copy, its binding in the shared folder is set aside (renamed, no guard reads it): the agent can
// write only where the copy's own binding allows it. It comes back when the agent is done (return) or the lease is released.
function suspendedBindingFile(context, sessionId) {
  return packageBinding.bindingPath(context.repoRoot, context.scope, sessionId) + ".suspended";
}

function suspendMainBinding(context, sessionId) {
  const file = packageBinding.bindingPath(context.repoRoot, context.scope, sessionId);
  if (fs.existsSync(file)) fs.renameSync(file, suspendedBindingFile(context, sessionId));
}

function restoreMainBinding(context, sessionId) {
  const suspended = suspendedBindingFile(context, sessionId);
  const file = packageBinding.bindingPath(context.repoRoot, context.scope, sessionId);
  if (fs.existsSync(suspended)) {
    if (fs.existsSync(file)) fs.rmSync(suspended, { force: true });
    else fs.renameSync(suspended, file);
  }
}

function stepCopyBaselineFile(context, sessionId) {
  return path.join(context.repoRoot, ".unlazy", context.scope, "executor", "step-baselines",
    crypto.createHash("sha256").update(sessionId).digest("hex").slice(0, 16) + ".json");
}

async function prepareStepCopy(context, entry) {
  const sessionId = entry.sessionId;
  const copyPath = stepCopyPath(context.repoRoot, context.scope, sessionId);
  // A copy left by an earlier start of this session is not reused: its baseline belongs to that start.
  if (fs.existsSync(copyPath)) await removeStepCopy({ repoRoot: context.repoRoot, copyPath, git: stepCopyGit(context) });
  const made = await createStepCopy({ repoRoot: context.repoRoot, copyPath, git: stepCopyGit(context) });
  try {
    const ref = path.join(context.repoRoot, ".unlazy", context.scope, "package.ref");
    fs.mkdirSync(path.join(copyPath, ".unlazy", context.scope), { recursive: true });
    fs.copyFileSync(ref, path.join(copyPath, ".unlazy", context.scope, "package.ref"));
    packageBinding.createBinding({ startPath: copyPath, packageId: context.packageId, scope: context.scope, sessionId,
      leaf: entry.leaf });
    const original = fs.readFileSync(path.resolve(context.repoRoot, entry.briefFile), "utf8");
    const briefFile = path.join(path.dirname(path.resolve(context.repoRoot, entry.briefFile)),
      path.basename(entry.briefFile, ".md") + ".copy.md");
    const text = original.replace("Repository: " + context.repoRoot, () =>
      "Repository: " + copyPath + "\nWorking copy: this step runs in a copy of the repository of its own; write only there, the Harness adopts the files of your OWNS at the return");
    fs.writeFileSync(briefFile, text, "utf8");
    writeSnapshot(stepCopyBaselineFile(context, sessionId), { schema: 1, dirty: {}, mainBaseline: made.mainBaseline, copyBaseline: made.copyBaseline });
    const recorded = { path: path.relative(context.repoRoot, copyPath).replaceAll("\\", "/"),
      briefFile: path.relative(context.repoRoot, briefFile).replaceAll("\\", "/"), createdAt: new Date().toISOString() };
    updateState(context, (fresh) => { sessionOf(fresh, sessionId).stepCopy = recorded; });
    suspendMainBinding(context, sessionId);
    return { copyPath, briefFile };
  } catch (error) {
    await removeStepCopy({ repoRoot: context.repoRoot, copyPath, git: stepCopyGit(context) });
    throw error;
  }
}

// What the step wrote in its copy, in the shape judgeWorktree answers: exact, whatever else happened in the shared folder.
async function judgeStepCopy(context, entry) {
  const baselines = readSnapshot(stepCopyBaselineFile(context, entry.sessionId));
  if (!baselines) return { judged: false };
  const collected = await collectStepCopy({ copyPath: path.resolve(context.repoRoot, entry.stepCopy.path),
    copyBaseline: baselines.copyBaseline, git: stepCopyGit(context), owns: ownsMatcher(entry.owns),
    ignore: (relative) => bundleContractPath(relative, context.packageId) });
  return collected.judged ? { judged: true, changed: collected.changed, inOwns: collected.inOwns, outside: collected.outside, baselines } : { judged: false };
}

async function dropStepCopy(context, entry) {
  if (!entry.stepCopy) return;
  await removeStepCopy({ repoRoot: context.repoRoot, copyPath: path.resolve(context.repoRoot, entry.stepCopy.path), git: stepCopyGit(context) });
  fs.rmSync(stepCopyBaselineFile(context, entry.sessionId), { force: true });
}

async function launchMember(context, options, sessionId, wave, { failState = "provider-start-failed" } = {}) {
  let claimed;
  try {
    claimed = updateState(context, (fresh) => {
      const target = sessionOf(fresh, sessionId);
      if (target.state !== "prepared" && target.state !== QUEUED_STATE) fail("SESSION_STATE", sessionId + " is not prepared", 1);
      setSessionState(fresh, target, "starting", "provider-starting", { wave, startedAt: new Date().toISOString() });
    });
  } catch (error) {
    if (error.code === "SESSION_STATE") error.notClaimed = true;
    throw error;
  }
  const entry = sessionOf(claimed, sessionId);
  // The work of this member starts now: the working tree as it is becomes its baseline (C4, C11).
  await recordSnapshot(context, sessionId);
  let copy = null;
  if (options.stepCopy) {
    try { copy = await prepareStepCopy(context, entry); }
    catch (error) {
      updateState(context, (fresh) => {
        setSessionState(fresh, sessionOf(fresh, sessionId), failState, failState, { wave, failure: { code: error.code || "STEP_COPY", message: error.message },
          failedAt: new Date().toISOString() });
      });
      throw error;
    }
  }
  let run;
  try {
    run = await launchProviderRun({
      repoRoot: context.repoRoot,
      packageId: context.packageId,
      scope: context.scope,
      sessionId,
      leaf: entry.leaf,
      provider: entry.provider,
      briefFile: copy ? copy.briefFile : path.resolve(context.repoRoot, entry.briefFile),
      workDir: copy ? copy.copyPath : undefined,
      // No default and no upper bound (C1): a deadline and a step limit exist only when the caller names them.
      deadlineSeconds: options.deadlineSeconds,
      maxTurns: options.maxTurns,
      costBudgetUsd: options.costBudgetUsd ?? DEFAULT_COST_BUDGET_USD,
      tokenBudget: options.tokenBudget ?? DEFAULT_TOKEN_BUDGET,
      unlazyRoot: context.unlazyRoot,
      claudeExecutable: claudeExecutableFor(options.claudeExecutable),
      claudePrefixArgs: [...options.claudePrefixArgs, ...claudeWorkerModelArgs(entry.delegation)],
      codexCommand: entry.provider === "codex" ? resolveCodexCommand(options.codexExecutable) : null,
      harnessRoot: context.harnessRoot,
      attempt: entry.attempt || 1,
    });
  } catch (error) {
    const failed = error.run || null;
    const keepsWave = failState === START_FAILED_STATE;
    updateState(context, (fresh) => {
      setSessionState(fresh, sessionOf(fresh, sessionId), failState, failState, {
        wave,
        // A start-failed member holds no run: a sync would turn a failed run back into provider-start-failed and free its lease.
        runId: keepsWave ? null : failed?.runId || null,
        handle: keepsWave ? null : failed?.nativeHandle || null,
        ...(keepsWave ? { failedRunId: failed?.runId || null } : {}),
        failure: failed?.failure || { code: error.code || "PROVIDER_START_FAILED", message: error.message },
        failedAt: new Date().toISOString(),
      });
    });
    throw error;
  }
  updateState(context, (fresh) => {
    setSessionState(fresh, sessionOf(fresh, sessionId), providerSessionState(run), "provider-started", {
      wave,
      runId: run.runId,
      handle: run.nativeHandle,
      deadlineAt: run.deadlineAt,
      lastHeartbeatAt: run.lastHeartbeatAt,
      nativeStartedAt: run.nativeStartedAt || new Date().toISOString(),
      providerOutputEvidence: false,
    });
  });
  return run;
}

// A git call of the executor with its own environment (a temporary index for a commit object, P8).
function gitWith(context, root = context.repoRoot) {
  return async (args, env = {}) => {
    try { return await runGitProgram(["-C", root, ...args], { cwd: root, env }); }
    catch (error) { return { status: null, stdout: "", stderr: "", error }; }
  };
}

function proofTmp(context) {
  return path.join(context.repoRoot, ".unlazy", context.scope, "executor", "tmp");
}

// gate-check at one commit, in a clean copy of it (P7b --at). The count of checks that really ran and of results that
// were reused from a stored proof of the same code state comes from its own RUN and PROOF_REUSED lines.
async function gateCheckAt(context, modes, commit, operation, extra = []) {
  const result = await runNode(context.tools.gateCheck, [...modes, "--at", commit, "--root", context.repoRoot,
    "--package", context.packageId, ...(extra.includes("--no-scope") ? [] : ["--scope", context.scope]),
    ...extra.filter((item) => item !== "--no-scope")], { cwd: context.repoRoot });
  childOk(result, operation + " at " + commit.slice(0, 8) + " (clean copy)");
  const output = String(result.stdout || "");
  return { output, ran: (output.match(/^ {2}RUN {2}/gmu) || []).length, reused: (output.match(/PROOF_REUSED /gu) || []).length };
}

// B16: the return of a step is checked once, by the Harness, at a commit object of HEAD plus exactly the changes in
// the step's OWNS (temporary index, write-tree, commit-tree; no branch, no shared index, no working-tree write). What
// the agent ran itself never counts, and neither does a tick it wrote: --at re-runs every gate of the leaf there. A
// green result is stored on that object, and integrate carries it to the integration commit.
async function verifyLeaf(context, entry, workRoot = context.repoRoot) {
  const head = await currentHead(workRoot);
  const built = await workingCommit({ git: gitWith(context, workRoot), head, select: ownsMatcher(entry.owns),
    label: "return " + entry.leaf, tmpDirectory: proofTmp(context) });
  const run = await gateCheckAt(context, ["--reverify"], built.commit,
    "local leaf re-verification (HEAD plus the step's OWNS changes)", ["--leaf", entry.leaf]);
  return { output: run.output, commit: built.commit, head, ran: run.ran, reused: run.reused };
}

// The dispatch wave as the dispatch itself reads it.
async function dispatchWave(context, waveId) {
  const module = await import(pathToFileURL(path.join(context.unlazyRoot, "scripts", "lib", "dispatch.mjs")).href);
  return module.getDispatchWave(context.repoRoot, context.scope, waveId, context.packageId);
}

async function returnLeaf(context, options) {
  await assertActive(context);
  const sessionId = session(options.sessionId);
  sessionOf(readState(context), sessionId);
  const entry = await synchronizeSession(context, sessionId);
  if (entry.state !== "provider-returned") {
    fail("SESSION_STATE", "session provider has not returned successfully; current state is " + entry.state, 1);
  }
  // The working tree against the baseline of this step, before the gates run (their own writes are not the agent's).
  // The agent is done: its shared-folder binding comes back (set aside while it worked in its copy).
  if (entry.stepCopy) restoreMainBinding(context, sessionId);
  const worktree = entry.stepCopy ? await judgeStepCopy(context, entry) : await judgeWorktree(context, readState(context), entry);
  if (entry.stepCopy && worktree.judged) {
    // Nothing may have been written in the shared folder either (its guard binding was set aside): what changed there outside
    // the OWNS of every active step is reported like a stray file of a step without a copy.
    const shared = await judgeWorktree(context, readState(context), entry);
    if (shared.judged) worktree.outside = [...worktree.outside, ...shared.outside.map((relative) => relative + " (shared folder)")];
  }
  let acceptedOutside = null;
  if (worktree.judged && worktree.outside.length) {
    const shown = worktree.outside.slice(0, 50).join(", ") + (worktree.outside.length > 50 ? ", ... (" + worktree.outside.length + " files)" : "");
    if (!options.acceptOutside) {
      fail("OUTSIDE_OWNS_CHANGED", worktree.outside.length + " file(s) changed outside the OWNS of every step active since " +
        sessionId + " started: " + shown + ". Nothing was reverted. If another session wrote them, repeat return with " +
        "--accept-outside \"<why this came from outside>\"; otherwise the step wrote where it must not", 1);
    }
    acceptedOutside = { reason: options.acceptOutside, files: worktree.outside.slice(0, 200), count: worktree.outside.length,
      acceptedAt: new Date().toISOString() };
  }
  // C4: a step that changed no file of its OWNS did not do its work, however cleanly its process ended.
  if (worktree.judged && !entry.checkOnly && Array.isArray(entry.owns) && entry.owns.length && !worktree.inOwns.length) {
    updateState(context, (fresh) => {
      const target = sessionOf(fresh, sessionId);
      if (target.state !== "provider-returned") fail("SESSION_STATE", "session " + sessionId + " changed to " + target.state + " during its return", 1);
      setSessionState(fresh, target, "returned-unchanged", "leaf-returned-unchanged", { unchangedAt: new Date().toISOString(),
        providerOutputEvidence: false, ...(acceptedOutside ? { acceptedOutside } : {}) });
    });
    fail("RETURNED_UNCHANGED", "session " + sessionId + " ended without changing any file of its OWNS (" + entry.owns.join(", ") +
      "); that is no success. Decide: restart --new-session with the reason, resume --message to continue the native session, " +
      "or mark a pure check leaf with READ-ONLY: yes in its ledger head", 1);
  }
  // P18: first the one verification, at a commit object made from the copy (HEAD plus the changes of the step's OWNS there); a
  // red gate leaves nothing in the shared folder. Only then the files of the OWNS come from the copy into the shared folder.
  if (entry.stepCopy && !worktree.judged) {
    fail("STEP_COPY_UNREADABLE", "the baseline or the state of the copy of " + sessionId + " cannot be read; nothing was adopted", 1);
  }
  const verified = await verifyLeaf(context, entry, entry.stepCopy ? path.resolve(context.repoRoot, entry.stepCopy.path) : context.repoRoot);
  let adopted = null;
  if (entry.stepCopy) {
    try {
      adopted = await adoptStepCopy({ repoRoot: context.repoRoot, copyPath: path.resolve(context.repoRoot, entry.stepCopy.path),
        mainBaseline: worktree.baselines.mainBaseline, git: stepCopyGit(context), files: worktree.inOwns });
    } catch (error) {
      if (typeof error.code === "string" && error.code.startsWith("STEP_COPY_")) fail(error.code, error.message, 1);
      throw error;
    }
    if (adopted.conflicts.length) {
      fail("STEP_COPY_CONFLICT", adopted.conflicts.length + " file(s) of the OWNS of " + sessionId + " were changed in the shared folder " +
        "while the step worked in its copy: " + adopted.conflicts.slice(0, 50).join(", ") + ". Nothing was adopted and nothing reverted; " +
        "decide which version stands (restart --new-session with the reason)", 1);
    }
  }
  const gateOutput = verified.output;
  const base = ["--root", context.repoRoot, "--package", context.packageId, "--scope", context.scope,
    "--wave", entry.wave, "--leaf", entry.leaf];
  // Decision 2: a return the dispatch already holds for exactly this leaf in exactly this wave is
  // completed here instead of failing; every other dispatch refusal stays an error.
  const recorded = await runNode(context.tools.dispatchCheck, ["return", ...base], { cwd: context.repoRoot });
  let alreadyRecorded = false;
  let dispatchComplete = false;
  if (recorded.status !== 0) {
    let wave = null;
    try { wave = await dispatchWave(context, entry.wave); } catch { wave = null; }
    if (!wave?.returned?.[entry.leaf]) childOk(recorded, "dispatch return");
    alreadyRecorded = true;
    dispatchComplete = wave.state === "complete";
  } else {
    dispatchComplete = /^COMPLETE /mu.test(String(recorded.stdout || ""));
  }
  childOk(await runNode(context.tools.gateCheck, ["--release", "--root", context.repoRoot, "--package", context.packageId,
    "--scope", context.scope, "--leaf", entry.leaf], { cwd: context.repoRoot }), "leaf release");
  let resultDigest = null;
  if (options.resultFile) {
    const resultFile = path.resolve(context.repoRoot, options.resultFile);
    if (!repository.isPathInside(context.repoRoot, resultFile) || !fs.existsSync(resultFile) || !fs.statSync(resultFile).isFile()) {
      fail("RESULT_FILE", "result file must be a regular file inside the repository");
    }
    resultDigest = digest(fs.readFileSync(resultFile));
  }
  const state = updateState(context, (fresh) => {
    const target = sessionOf(fresh, sessionId);
    if (target.state !== "provider-returned" || target.wave !== entry.wave) {
      fail("SESSION_STATE", "session " + sessionId + " changed to " + target.state + " during its return", 1);
    }
    setSessionState(fresh, target, "verified", "leaf-returned", { returnedAt: new Date().toISOString(),
      gateOutputDigest: digest(gateOutput), resultDigest, providerOutputEvidence: false, locallyReverified: true,
      proofCommit: verified.commit, proofHead: verified.head,
      ...(worktree.judged ? { ownsChanged: worktree.inOwns.length } : {}),
      ...(adopted ? { stepCopyAdopted: adopted.adopted.length } : {}),
      ...(acceptedOutside ? { acceptedOutside } : {}),
      ...(alreadyRecorded ? { dispatchReturnAlreadyRecorded: true } : {}) });
    if (acceptedOutside) transition(fresh, "outside-change-accepted", sessionId, null, null, acceptedOutside);
    const wave = fresh.waves[target.wave];
    if (!wave || wave.state === "complete") return;
    const members = wave.sessions.map((value) => fresh.sessions[value]);
    const complete = alreadyRecorded ? dispatchComplete : members.every((value) => value?.state === "verified");
    if (complete) {
      const before = wave.state;
      wave.state = "complete";
      wave.completedAt = new Date().toISOString();
      transition(fresh, "wave-complete", target.wave, before, "complete", { sessions: wave.sessions,
        ...(alreadyRecorded ? { dispatchComplete: true } : {}) });
    }
  });
  const result = state.sessions[sessionId];
  if (entry.stepCopy) { try { await dropStepCopy(context, entry); } catch { /* a left-over copy sits in the ignored runtime folder */ } }
  // An agent ended, so a queued member may start now (C2). The return itself never fails because of that.
  let queue = null;
  try { queue = await advanceQueue(context, options); } catch (error) { queue = { error: String(error.message || error) }; }
  const queueNews = queue && (queue.error || queue.started.length || queue.failed.length);
  return { sessionId, leaf: result.leaf, state: result.state, wave: result.wave, runId: result.runId,
    handle: result.handle, providerOutputEvidence: false, locallyReverified: true,
    provedAt: verified.commit, checksRun: verified.ran, proofsReused: verified.reused,
    ...(alreadyRecorded ? { dispatchReturnAlreadyRecorded: true } : {}),
    ...(acceptedOutside ? { acceptedOutside: { reason: acceptedOutside.reason, count: acceptedOutside.count } } : {}),
    ...(queueNews ? { queue } : {}) };
}

function transitionReason(options, fallback) {
  const value = String(options.reason || fallback || "").trim();
  if (!value || value.length > 500 || /[\0\r\n]/u.test(value)) fail("USAGE", "--reason must be one line of 1..500 characters");
  return value;
}

// The terminal provider states a stop request does not overwrite.
const STOPPED_STATES = new Set(["provider-start-failed", START_FAILED_STATE, "provider-failed", "aborted", "timed-out", "vanished",
  ...STOPPED_FOR_DECISION]);

async function abandonWave(context, waveId, reason, timeoutSession = null) {
  const state = readState(context);
  const wave = state.waves[waveId];
  if (!wave || !["open", "sealed"].includes(wave.state)) {
    fail("WAVE_STATE", "wave must be open or sealed before abandon; current state is " + (wave?.state || "missing"));
  }
  for (const sessionId of wave.sessions) {
    const entry = state.sessions[sessionId];
    if (!entry || SETTLED_STATES.has(entry.state)) continue;
    const action = sessionId === timeoutSession ? "timeout" : "abort";
    if (entry.runId) {
      try {
        await requestProviderStop({ repoRoot: context.repoRoot, scope: context.scope, runId: entry.runId, action, reason });
      } catch (error) {
        if (!TERMINAL_RUN_STATES.has(readProviderRun(context.repoRoot, context.scope, entry.runId).state)) throw error;
      }
    }
  }
  const base = ["--root", context.repoRoot, "--package", context.packageId, "--scope", context.scope,
    "--wave", waveId, "--reason", dispatchReason(reason)];
  const abandoned = await runNode(context.tools.dispatchCheck, ["abandon", ...base], { cwd: context.repoRoot });
  if (abandoned.status !== 0 && unknownToDispatch(abandoned, waveId)) {
    return closeUnregisteredWave(context, waveId, reason, timeoutSession);
  }
  childOk(abandoned, "dispatch abandon");
  const written = updateState(context, (fresh) => {
    const record = fresh.waves[waveId];
    if (!record || !["open", "sealed"].includes(record.state)) {
      fail("WAVE_STATE", "wave " + waveId + " changed to " + (record?.state || "missing") + " during abandon", 1);
    }
    for (const sessionId of record.sessions) {
      const entry = fresh.sessions[sessionId];
      if (!entry || SETTLED_STATES.has(entry.state) || STOPPED_STATES.has(entry.state)) continue;
      const action = sessionId === timeoutSession ? "timeout" : "abort";
      setSessionState(fresh, entry, action + "-requested", action + "-requested", { reason, requestedAt: new Date().toISOString() });
    }
    const before = record.state;
    Object.assign(record, { state: "abandoned", reason, abandonedAt: new Date().toISOString() });
    transition(fresh, "wave-abandoned", waveId, before, "abandoned", { reason, timeoutSession });
  });
  return written.waves[waveId];
}

// The Unlazy dispatch answers "unknown wave <id>" for a wave it never recorded.
function unknownToDispatch(result, waveId) {
  const output = String(result.stderr || "") + "\n" + String(result.stdout || "");
  return output.includes("unknown wave " + waveId);
}

// A dispatch that was interrupted between the wave entering the executor state and its Unlazy registration (or a state
// written before P13 restored the order) leaves a wave the Unlazy dispatch does not know (P13). Abandon and abort then
// close the executor state alone: the wave moves to the history with its reason, a member that never ran is prepared
// again, and a member whose provider was started keeps its requested stop (its run was asked to stop above).
function closeUnregisteredWave(context, waveId, reason, timeoutSession) {
  let closed = null;
  updateState(context, (fresh) => {
    const record = fresh.waves[waveId];
    if (!record || !["open", "sealed"].includes(record.state)) {
      fail("WAVE_STATE", "wave " + waveId + " changed to " + (record?.state || "missing") + " during abandon", 1);
    }
    for (const sessionId of record.sessions) {
      const entry = fresh.sessions[sessionId];
      if (!entry || entry.wave !== waveId || SETTLED_STATES.has(entry.state)) continue;
      if (!entry.runId) {
        releaseFromWave(fresh, sessionId, waveId, "its wave is unknown to the dispatch and was closed: " + reason);
        continue;
      }
      if (STOPPED_STATES.has(entry.state) || REQUESTED_STATES.has(entry.state)) continue;
      const action = sessionId === timeoutSession ? "timeout" : "abort";
      setSessionState(fresh, entry, action + "-requested", action + "-requested", { reason, requestedAt: new Date().toISOString() });
    }
    const key = historyWaveKey(fresh, waveId);
    closed = { ...record, state: "abandoned", reason, abandonedAt: new Date().toISOString(), unregistered: true };
    fresh.history.waves[key] = closed;
    delete fresh.waves[waveId];
    transition(fresh, "wave-abandoned", waveId, record.state, "abandoned", { reason, timeoutSession, unregistered: true,
      historyKey: key });
  });
  return closed;
}

async function abortExecution(context, options) {
  await assertActive(context);
  const state = readState(context);
  const sessionId = session(options.sessionId);
  const entry = sessionOf(state, sessionId);
  const reason = transitionReason(options, "Owner or parent aborted the bounded provider run");
  if (!entry.wave) {
    updateState(context, (fresh) => {
      const target = sessionOf(fresh, sessionId);
      if (target.state !== "prepared" || target.wave) fail("SESSION_STATE", "unlaunched abort requires a prepared session");
      setSessionState(fresh, target, "aborted", "session-aborted", { reason, abortedAt: new Date().toISOString() });
    });
    await releaseLeaf(context, sessionId, reason);
    return publicEntry(readState(context).sessions[sessionId]);
  }
  if (REQUESTED_STATES.has(entry.state)) {
    const closed = await closeRequestedSession(context, entry, reason);
    if (closed) return closed;
  } else if (["aborted", "timed-out"].includes(entry.state) &&
      !["open", "sealed"].includes(state.waves[entry.wave]?.state)) {
    return { ...publicEntry(entry), reason }; // already closed, e.g. by a sync: abort stays idempotent
  }
  const wave = await abandonWave(context, entry.wave, reason);
  await releaseWave(context, entry.wave, reason);
  return { sessionId, wave: entry.wave, state: wave.state, reason };
}

// abort of a session that already waits on a requested stop closes it instead of abandoning its wave
// again: its provider is gone, or its wave is already abandoned (then a provider that still runs is
// stopped for good first). Returns null when the wave is not abandoned and the provider still runs;
// the caller then takes the ordinary abandon route.
async function closeRequestedSession(context, entry, reason) {
  const { sessionId } = entry;
  // A wave that left the state (closed as unknown to the dispatch, P13) is over like an abandoned one.
  const waveRecord = readState(context).waves[entry.wave];
  const waveAbandoned = !waveRecord || waveRecord.state === "abandoned";
  const identity = { repoRoot: context.repoRoot, scope: context.scope, runId: entry.runId,
    expected: { packageId: context.packageId, sessionId, leaf: entry.leaf, provider: entry.provider } };
  let run = null;
  if (entry.runId) {
    try { run = await refreshProviderRun(identity); } catch { run = null; }
  }
  let ended = !run || TERMINAL_RUN_STATES.has(run.state);
  if (!ended && !waveAbandoned) return null;
  if (!ended) {
    const action = entry.state === "timeout-requested" ? "timeout" : "abort";
    if (!["abort-requested", "timeout-requested"].includes(run.state)) {
      try { await requestProviderStop({ ...identity, action, reason }); } catch { /* it ended meanwhile */ }
    }
    run = await refreshProviderRun({ ...identity, stopGraceMs: 0 });
    ended = TERMINAL_RUN_STATES.has(run.state);
    if (!ended) fail("SESSION_STATE", "the provider of " + sessionId + " still runs (" + run.state + ") and did not stop", 1);
  }
  updateState(context, (fresh) => {
    const entryNow = fresh.sessions[sessionId];
    if (entryNow && entryNow.runId === entry.runId && run) {
      Object.assign(entryNow, { providerRunState: run.state, providerFinishedAt: run.finishedAt || null,
        providerExitCode: run.exitCode ?? null });
    }
    closeRequestedStop(fresh, sessionId, true, "abort", { reason }, false);
  });
  await releaseLeaf(context, sessionId, reason);
  const closed = sessionOf(readState(context), sessionId);
  return { ...publicEntry(closed), reason };
}

async function abandonExecution(context, options) {
  await assertActive(context);
  const wave = id(options.wave, "wave");
  const reason = transitionReason(options, "parent abandoned the dispatch wave");
  const record = await abandonWave(context, wave, reason);
  await releaseWave(context, wave, reason);
  return { wave, state: record.state, reason };
}

async function timeoutExecution(context, options) {
  await assertActive(context);
  const state = readState(context);
  const sessionId = session(options.sessionId);
  const entry = state.sessions[sessionId];
  if (!entry || !entry.wave) fail("SESSION_STATE", "timeout requires a dispatched session");
  const reason = transitionReason(options, "provider heartbeat or deadline timed out");
  await abandonWave(context, entry.wave, reason, sessionId);
  await releaseWave(context, entry.wave, reason);
  return { sessionId, wave: entry.wave, state: "timeout-requested", reason };
}

async function liveness(context, options) {
  await assertActive(context);
  const sessionId = session(options.sessionId);
  sessionOf(readState(context), sessionId);
  const entry = await synchronizeSession(context, sessionId);
  const run = entry.runId ? readProviderRun(context.repoRoot, context.scope, entry.runId) : null;
  return {
    sessionId,
    leaf: entry.leaf,
    state: entry.state,
    runId: entry.runId,
    handle: entry.handle,
    providerRunState: run?.state || null,
    heartbeatAt: run?.lastHeartbeatAt || null,
    deadlineAt: run?.deadlineAt || null,
    // A run without a deadline (deadlineAt null) never expires.
    deadlineExpired: run && run.deadlineAt ? Date.now() >= Date.parse(run.deadlineAt) : false,
    providerOutputEvidence: false,
    ...(run?.logTruncated === true ? { logTruncated: true } : {}),
    ...(Array.isArray(run?.hints) && run.hints.length ? { hints: run.hints } : {}),
    ...(run?.failure ? { failure: run.failure } : {}),
    ...(run?.blocked ? { blocked: run.blocked } : {}),
    ...(run?.tokensUsed !== undefined ? { tokensUsed: run.tokensUsed } : {}),
  };
}

// retry holds the leaf again: lease ensured, binding and brief written anew, before the state changes.
const RETRYABLE_STATES = new Set(["provider-start-failed", START_FAILED_STATE, "provider-failed", "aborted", "timed-out", "vanished",
  "abort-requested", "timeout-requested", ...STOPPED_FOR_DECISION]);

// A member whose start failed while the rest of its wave went on (start-failed, P13 C6) is put back into the queue of its
// wave; every other retry needs its wave abandoned first.
function requeues(state, entry) {
  return entry?.state === START_FAILED_STATE && Boolean(entry.wave) && state.waves[entry.wave]?.state === "sealed";
}

function assertRetryable(state, entry) {
  if (!entry || !RETRYABLE_STATES.has(entry.state)) fail("SESSION_STATE", "session is not in a retryable terminal state");
  if (requeues(state, entry)) return;
  if (entry.wave && state.waves[entry.wave] && state.waves[entry.wave].state !== "abandoned") {
    fail("WAVE_STATE", "retry requires the prior dispatch wave to be abandoned first");
  }
}

async function retryExecution(context, options) {
  await assertActive(context);
  const state = readState(context);
  const sessionId = session(options.sessionId);
  const entry = state.sessions[sessionId];
  assertRetryable(state, entry);
  if (requeues(state, entry)) {
    assertProviderOverrides(options);
    updateState(context, (fresh) => {
      const target = fresh.sessions[sessionId];
      if (!requeues(fresh, target)) fail("SESSION_STATE", "session " + sessionId + " changed during retry", 1);
      target.attempts ||= [];
      target.attempts.push({ attempt: target.attempt || 1, state: target.state, wave: target.wave, runId: target.failedRunId || null,
        handle: null, failure: target.failure || null, archivedAt: new Date().toISOString() });
      setSessionState(fresh, target, QUEUED_STATE, "session-requeued", { attempt: (target.attempt || 1) + 1, failure: null,
        failedRunId: null, queuedAt: new Date().toISOString() });
    });
    await advanceQueue(context, options);
    return publicEntry(readState(context).sessions[sessionId]);
  }
  const ledger = ledgerRecord(context.packageInfo, entry.leaf);
  await ensureLease(context, entry.leaf);
  packageBinding.createBinding({ startPath: context.repoRoot, packageId: context.packageId,
    scope: context.scope, sessionId, leaf: entry.leaf, controlRoot: context.harnessRoot });
  const brief = writeBrief(context, state, entry, ledger);
  const written = updateState(context, (fresh) => {
    const target = fresh.sessions[sessionId];
    assertRetryable(fresh, target);
    target.attempts ||= [];
    target.attempts.push({ attempt: target.attempt || 1, state: target.state, wave: target.wave || null,
      runId: target.runId || null, handle: target.handle || null, failure: target.failure || null,
      archivedAt: new Date().toISOString() });
    const before = target.state;
    Object.assign(target, { state: "prepared", attempt: (target.attempt || 1) + 1, wave: null, runId: null,
      handle: null, failure: null, preparedAt: new Date().toISOString(), deadlineAt: null, lastHeartbeatAt: null,
      leaseReleasedAt: null, briefDigest: brief.digest, owns: brief.binding.owns });
    transition(fresh, "session-retry-prepared", sessionId, before, "prepared", { attempt: target.attempt });
  });
  return publicEntry(written.sessions[sessionId]);
}

// A new session for the leaf of an old one, with lease, binding and a fresh brief from the current leaf
// ledger (reassign, restart, reopen). The old binding is removed; the state is not touched here.
async function prepareSuccessor(context, state, source, targetId, options, restart = null) {
  assertNotOrchestrator({ harnessRoot: context.harnessRoot, sessionId: targetId, env: process.env });
  if (state.sessions[targetId] || state.history.sessions[targetId]) {
    fail("SESSION_EXISTS", "target session " + targetId + " is already known to this package", 1);
  }
  const ledger = ledgerRecord(context.packageInfo, source.leaf);
  const modelResolution = packageModel(context, options, ledger.text, source.provider, ledger.file);
  const provider = modelResolution.provider;
  await ensureLease(context, source.leaf);
  packageBinding.createBinding({ startPath: context.repoRoot, packageId: context.packageId,
    scope: context.scope, sessionId: targetId, leaf: source.leaf, controlRoot: context.harnessRoot });
  packageBinding.removeBinding({ repoRoot: context.repoRoot, scope: context.scope, sessionId: source.sessionId,
    controlRoot: context.harnessRoot });
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
    // Why this session exists (restart, reopen; C3): the brief names it, and every later write of the brief does too.
    ...(restart ? { restart } : {}),
  };
  const brief = writeBrief(context, state, target, ledger);
  Object.assign(target, { briefFile: path.relative(context.repoRoot, brief.file).replaceAll("\\", "/"),
    briefDigest: brief.digest, owns: brief.binding.owns, delegation: delegation(modelResolution, brief.file),
    checkOnly: leafCheckOnly(ledger.text) });
  return target;
}

const REASSIGNABLE_STATES = new Set(["provider-start-failed", START_FAILED_STATE, "provider-failed", "aborted", "timed-out", "vanished",
  "abort-requested", "timeout-requested", ...STOPPED_FOR_DECISION]);

function assertReassignable(state, source) {
  if (!source) fail("SESSION_STATE", "unknown source session");
  if (source.wave && state.waves[source.wave] && state.waves[source.wave].state !== "abandoned") {
    fail("WAVE_STATE", "reassignment requires the prior dispatch wave to be abandoned first");
  }
  if (!REASSIGNABLE_STATES.has(source.state)) fail("SESSION_STATE", "source session is not reassignable");
}

async function reassignExecution(context, options) {
  await assertActive(context);
  const state = readState(context);
  const sourceId = session(options.sessionId);
  const targetId = session(options.newSessionId);
  assertNotOrchestrator({ harnessRoot: context.harnessRoot, sessionId: targetId, env: process.env });
  const source = state.sessions[sourceId];
  if (!source) fail("SESSION_STATE", "unknown source session");
  if (state.sessions[targetId]) fail("SESSION_EXISTS", "reassignment target session already exists");
  assertReassignable(state, source);
  const target = await prepareSuccessor(context, state, source, targetId, options);
  const written = updateState(context, (fresh) => {
    const current = fresh.sessions[sourceId];
    assertReassignable(fresh, current);
    if (fresh.sessions[targetId] || fresh.history.sessions[targetId]) fail("SESSION_EXISTS", "reassignment target session already exists");
    // The replaced session leaves for history, like a restarted one (P13, E4c): it no longer counts as open work.
    // Its wave is abandoned or it never had one, so the wave record keeps its member list.
    replaceMember(fresh, current, target, "reassigned", "session-reassigned", {}, { fromKey: "reassignedFrom", waveless: true });
  });
  return { from: publicEntry(written.history.sessions[sourceId]), to: publicEntry(written.sessions[targetId]), ownershipPreserved: true };
}

// Decision 4: restart one member. Allowed for a member of a sealed wave whose return failed, whose provider
// ended or whose stop was requested, and for a provider-returned member of an abandoned wave.
const RESTARTABLE_IN_SEALED = new Set(["provider-returned", "provider-failed", "provider-start-failed", START_FAILED_STATE, "aborted",
  "timed-out", "vanished", "abort-requested", "timeout-requested", ...STOPPED_FOR_DECISION]);

function restartMode(state, entry) {
  const wave = entry?.wave ? state.waves[entry.wave] : null;
  if (!entry || !wave) fail("SESSION_STATE", "restart requires a dispatched session of a current wave", 1);
  if (wave.state === "sealed" && RESTARTABLE_IN_SEALED.has(entry.state)) return "sealed";
  if (wave.state === "abandoned" && entry.state === "provider-returned") return "abandoned";
  fail("SESSION_STATE", "restart is not possible for " + entry.sessionId + " in state " + entry.state +
    " of a " + wave.state + " wave", 1);
}

async function restartExecution(context, options) {
  await assertActive(context);
  assertProviderOverrides(options);
  if (!options.newSessionId) fail("USAGE", "restart requires --new-session ID");
  if (options.reason === undefined) fail("USAGE", "restart requires --reason TEXT");
  const reason = transitionReason(options);
  const sourceId = session(options.sessionId);
  const targetId = session(options.newSessionId);
  let state = readState(context);
  const source = sessionOf(state, sourceId);
  if (source.runId) {
    try {
      await requestProviderStop({ repoRoot: context.repoRoot, scope: context.scope, runId: source.runId,
        action: "abort", reason: "restart: " + reason });
    } catch (error) {
      // A run that already ended is no error.
      if (!TERMINAL_RUN_STATES.has(readProviderRun(context.repoRoot, context.scope, source.runId).state)) throw error;
    }
  }
  state = readState(context);
  const mode = restartMode(state, sessionOf(state, sourceId));
  const target = await prepareSuccessor(context, state, state.sessions[sourceId], targetId, options,
    { kind: "restart", from: sourceId, reason });
  const waveId = source.wave;
  updateState(context, (fresh) => {
    const current = sessionOf(fresh, sourceId);
    if (restartMode(fresh, current) !== mode) fail("SESSION_STATE", "session " + sourceId + " changed during restart", 1);
    if (fresh.sessions[targetId] || fresh.history.sessions[targetId]) fail("SESSION_EXISTS", "target session already exists", 1);
    replaceMember(fresh, current, target, "reassigned", "session-restarted", { reason, mode });
  });
  if (mode === "abandoned") return { from: sourceId, to: publicEntry(readState(context).sessions[targetId]), wave: waveId,
    mode, reason, next: "dispatch --wave <new wave> --session " + targetId };
  return { from: sourceId, ...(await startInWave(context, options, targetId, waveId, "restart")), mode, reason };
}

// Decision 5: rework a verified member in its wave.
async function reopenExecution(context, options) {
  await assertActive(context);
  assertProviderOverrides(options);
  if (!options.newSessionId) fail("USAGE", "reopen requires --new-session ID");
  if (options.reason === undefined) fail("USAGE", "reopen requires --reason TEXT");
  const reason = transitionReason(options);
  const sourceId = session(options.sessionId);
  const targetId = session(options.newSessionId);
  const state = readState(context);
  const source = sessionOf(state, sourceId);
  if (source.state !== "verified") fail("SESSION_STATE", "reopen requires a verified session; " + sourceId + " is " + source.state, 1);
  const waveId = source.wave;
  // recover moves its wave to history as "recovered"; the verified member stays behind with that wave id.
  // Such a member is reworked like a member of an abandoned wave: the successor waits prepared for a new wave.
  if (waveId && !state.waves[waveId] && state.history.waves[waveId]?.state === "recovered") {
    const successor = await prepareSuccessor(context, state, source, targetId, options, { kind: "reopen", from: sourceId, reason });
    updateState(context, (fresh) => {
      const current = sessionOf(fresh, sourceId);
      if (current.state !== "verified" || current.wave !== waveId || fresh.waves[waveId]) {
        fail("SESSION_STATE", "session " + sourceId + " changed during reopen", 1);
      }
      if (fresh.sessions[targetId] || fresh.history.sessions[targetId]) fail("SESSION_EXISTS", "target session already exists", 1);
      replaceMember(fresh, current, successor, "reopened", "session-reopened", { reason, mode: "recovered" });
    });
    return { from: sourceId, to: publicEntry(readState(context).sessions[targetId]), mode: "recovered", reason,
      next: "dispatch --wave <new wave> --session " + targetId };
  }
  if (!waveId || !state.waves[waveId] || !["sealed", "complete"].includes(state.waves[waveId].state)) {
    fail("WAVE_STATE", "reopen requires the session's wave to be sealed, complete or recovered", 1);
  }
  const target = await prepareSuccessor(context, state, source, targetId, options, { kind: "reopen", from: sourceId, reason });
  childOk(await runNode(context.tools.dispatchCheck, ["reopen", "--root", context.repoRoot, "--package", context.packageId,
    "--scope", context.scope, "--wave", waveId, "--leaf", source.leaf, "--reason", reason], { cwd: context.repoRoot }),
  "dispatch reopen");
  updateState(context, (fresh) => {
    const current = sessionOf(fresh, sourceId);
    if (current.state !== "verified" || current.wave !== waveId) fail("SESSION_STATE", "session " + sourceId + " changed during reopen", 1);
    if (fresh.sessions[targetId] || fresh.history.sessions[targetId]) fail("SESSION_EXISTS", "target session already exists", 1);
    const wave = fresh.waves[waveId];
    if (wave.state === "complete") {
      wave.state = "sealed";
      delete wave.completedAt;
      transition(fresh, "wave-reopened", waveId, "complete", "sealed", { leaf: current.leaf, reason });
    }
    replaceMember(fresh, current, target, "reopened", "session-reopened", { reason });
  });
  return { from: sourceId, ...(await startInWave(context, options, targetId, waveId, "reopen")), reason };
}

// The old session leaves for history in its final state, the new one takes its place in the wave (a
// sealed wave) or stays prepared for a new wave (an abandoned one).
function replaceMember(state, current, target, finalState, type, detail, { fromKey = null, waveless: forceWaveless = false } = {}) {
  const waveId = current.wave;
  const wave = state.waves[waveId];
  const waveless = forceWaveless || detail.mode === "abandoned" || detail.mode === "recovered";
  setSessionState(state, current, finalState, type, { ...detail, replacedBy: target.sessionId,
    [finalState + "At"]: new Date().toISOString() });
  state.history.sessions[current.sessionId] = { ...current, archivedAt: new Date().toISOString() };
  delete state.sessions[current.sessionId];
  if (!waveless) {
    wave.sessions = wave.sessions.map((value) => (value === current.sessionId ? target.sessionId : value));
    wave.replacedSessions = [...(wave.replacedSessions || []), { from: current.sessionId, to: target.sessionId,
      kind: finalState, at: new Date().toISOString() }];
  }
  state.sessions[target.sessionId] = target;
  transition(state, "session-prepared", target.sessionId, null, "prepared", { leaf: target.leaf, provider: target.provider,
    [fromKey || (finalState === "reopened" ? "reopenedFrom" : "restartedFrom")]: current.sessionId, wave: waveless ? null : waveId });
}

// A prepared member of a sealed wave starts like a dispatch member; the dispatch takes its handle through
// the restart action. A start that fails leaves the member provider-start-failed in its sealed wave, from
// where restart can try again.
async function startInWave(context, options, sessionId, waveId, why) {
  const run = await launchMember(context, options, sessionId, waveId);
  childOk(await runNode(context.tools.dispatchCheck, ["restart", "--root", context.repoRoot, "--package", context.packageId,
    "--scope", context.scope, "--wave", waveId, "--leaf", run.leaf || readState(context).sessions[sessionId].leaf,
    "--handle", run.nativeHandle], { cwd: context.repoRoot }), "dispatch " + why);
  const state = updateState(context, (fresh) => {
    transition(fresh, "wave-member-started", waveId, fresh.waves[waveId].state, fresh.waves[waveId].state,
      { sessionId, handle: run.nativeHandle, via: why });
  });
  return { wave: waveId, member: publicEntry(state.sessions[sessionId]) };
}

// resume (P12, C1/C12): a run that ended at its cost frame (budget-reached), hung or was refused three times by a
// guard (repeated-block) is continued, not restarted. The native session of the run goes on (Claude --resume
// <session id>, codex exec resume <thread id>) in a new provider run of the same session and wave, with a new cost
// frame (--cost-budget-usd, --token-budget), so neither the work nor the money spent is lost. Any other session is
// only synchronized, as before. The old run stays on record under session.resumes.
const RESUMABLE_STATES = STOPPED_FOR_DECISION;

function resumeTarget(state, options) {
  if (options.sessionId) return sessionOf(state, session(options.sessionId));
  if (!options.leaf) fail("USAGE", "resume requires --session ID or --leaf LEAF");
  const leaf = id(options.leaf, "leaf");
  const candidates = Object.values(state.sessions).filter((item) => item.leaf === leaf && RESUMABLE_STATES.has(item.state));
  if (candidates.length !== 1) {
    fail("USAGE", "resume --leaf needs exactly one resumable session of " + leaf + " (" + [...RESUMABLE_STATES].join(", ") +
      "); sessions of the leaf: " + (Object.values(state.sessions).filter((item) => item.leaf === leaf)
      .map((item) => item.sessionId + "=" + item.state).join(", ") || "none"));
  }
  return candidates[0];
}

async function resumeExecution(context, options) {
  const known = resumeTarget(readState(context), options);
  packageBinding.findSessionBinding(context.harnessRoot, known.sessionId, { controlRoot: context.harnessRoot });
  let entry = await synchronizeSession(context, known.sessionId);
  let resumed = null;
  if (RESUMABLE_STATES.has(entry.state)) {
    resumed = await continueRun(context, options, entry);
    entry = readState(context).sessions[known.sessionId];
  }
  const state = readState(context);
  return { originalOwnerDigest: state.originalOwnerDigest,
    originalOwnerRequestDigest: state.originalOwnerRequestDigest,
    originalGoal: state.originalGoal, originalGoalDigest: state.originalGoalDigest, ...publicEntry(entry),
    ...(resumed ? { resumed } : {}) };
}

async function continueRun(context, options, entry) {
  await assertActive(context);
  assertProviderOverrides(options);
  const { sessionId } = entry;
  const waveId = entry.wave;
  if (!entry.handle) fail("SESSION_STATE", "session " + sessionId + " has no native handle to resume", 1);
  if (!waveId || readState(context).waves[waveId]?.state !== "sealed") {
    fail("WAVE_STATE", "resume continues a session inside its sealed wave; for an abandoned wave use retry or reassign", 1);
  }
  const previous = { runId: entry.runId, state: entry.state, handle: entry.handle };
  if (entry.stepCopy) suspendMainBinding(context, sessionId);
  updateState(context, (fresh) => {
    const target = sessionOf(fresh, sessionId);
    if (!RESUMABLE_STATES.has(target.state) || target.runId !== previous.runId) {
      fail("SESSION_STATE", "session " + sessionId + " changed to " + target.state + " during resume", 1);
    }
    target.resumes = [...(target.resumes || []), { runId: previous.runId, state: previous.state, handle: previous.handle,
      resumedAt: new Date().toISOString() }];
    setSessionState(fresh, target, "starting", "provider-resuming", { startedAt: new Date().toISOString() });
  });
  const undo = (error, run) => updateState(context, (fresh) => {
    const target = sessionOf(fresh, sessionId);
    target.resumes = (target.resumes || []).slice(0, -1);
    setSessionState(fresh, target, previous.state, "provider-resume-failed", { resumeFailure: {
      code: error.code || "PROVIDER_START_FAILED", message: error.message, runId: run?.runId || error.run?.runId || null,
      at: new Date().toISOString() } });
  });
  let run;
  try {
    run = await launchProviderRun({
      repoRoot: context.repoRoot,
      packageId: context.packageId,
      scope: context.scope,
      sessionId,
      leaf: entry.leaf,
      provider: entry.provider,
      briefFile: entry.stepCopy ? path.resolve(context.repoRoot, entry.stepCopy.briefFile) : path.resolve(context.repoRoot, entry.briefFile),
      // (the shared binding is set aside again just before, see below)
      workDir: entry.stepCopy ? path.resolve(context.repoRoot, entry.stepCopy.path) : undefined,
      deadlineSeconds: options.deadlineSeconds,
      maxTurns: options.maxTurns,
      costBudgetUsd: options.costBudgetUsd ?? DEFAULT_COST_BUDGET_USD,
      tokenBudget: options.tokenBudget ?? DEFAULT_TOKEN_BUDGET,
      unlazyRoot: context.unlazyRoot,
      claudeExecutable: claudeExecutableFor(options.claudeExecutable),
      claudePrefixArgs: [...options.claudePrefixArgs, ...claudeWorkerModelArgs(entry.delegation)],
      codexCommand: entry.provider === "codex" ? resolveCodexCommand(options.codexExecutable) : null,
      harnessRoot: context.harnessRoot,
      attempt: entry.attempt || 1,
      resume: { nativeHandle: previous.handle, fromRunId: previous.runId, provider: entry.provider, reason: previous.state,
        message: options.message },
    });
  } catch (error) {
    undo(error);
    throw error;
  }
  try {
    // The same native session keeps its handle and needs no new dispatch registration; a different one is a restart.
    if (run.nativeHandle !== previous.handle) {
      childOk(await runNode(context.tools.dispatchCheck, ["restart", "--root", context.repoRoot, "--package", context.packageId,
        "--scope", context.scope, "--wave", waveId, "--leaf", entry.leaf, "--handle", run.nativeHandle],
      { cwd: context.repoRoot }), "dispatch resume");
    }
  } catch (error) {
    try {
      await requestProviderStop({ repoRoot: context.repoRoot, scope: context.scope, runId: run.runId, action: "abort",
        reason: "the dispatch refused the resumed handle" });
    } catch { /* it ended meanwhile */ }
    undo(error, run);
    throw error;
  }
  updateState(context, (fresh) => {
    const target = sessionOf(fresh, sessionId);
    setSessionState(fresh, target, providerSessionState(run), "provider-resumed", {
      runId: run.runId,
      handle: run.nativeHandle,
      deadlineAt: run.deadlineAt,
      lastHeartbeatAt: run.lastHeartbeatAt,
      nativeStartedAt: run.nativeStartedAt || new Date().toISOString(),
      providerOutputEvidence: false,
      failure: null,
      blocked: null,
      resumeFailure: null,
    });
  });
  return { fromRunId: previous.runId, fromState: previous.state, runId: run.runId, handle: run.nativeHandle,
    ...(entry.provider === "claude" ? { costBudgetUsd: run.costBudgetUsd } : { tokenBudget: run.tokenBudget }) };
}

function assertReplacementCovers(state, wave, replacementWave) {
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
}

// Decision 7: without --replacement-wave every leaf of the abandoned wave needs a verified session, in
// the wave itself or in another complete wave. Returns leaf -> wave of that verified session.
function verifiedCoverage(state, wave) {
  const abandoned = state.waves[wave];
  if (!abandoned || abandoned.state !== "abandoned") fail("WAVE_STATE", "recover requires an abandoned source wave");
  const coverage = {};
  const missing = [];
  for (const leaf of abandoned.leaves) {
    const verified = Object.values(state.sessions).find((entry) => entry.leaf === leaf && entry.state === "verified" &&
      (entry.wave === wave || state.waves[entry.wave]?.state === "complete"));
    if (verified) coverage[leaf] = verified.wave;
    else missing.push(leaf);
  }
  if (missing.length) {
    fail("RECOVERY_INCOMPLETE", "wave " + wave + " cannot be recovered without a replacement wave: no verified session for " +
      missing.join(", ") + " in it or in a complete wave", 1);
  }
  return coverage;
}

async function recoverExecution(context, options) {
  await assertActive(context);
  const state = readState(context);
  const wave = id(options.wave, "wave");
  const replacementWave = options.replacementWave === undefined ? null : id(options.replacementWave, "replacement wave");
  // A wave in which no agent could start (P13, C6) is already history in the executor. Its Unlazy wave is discarded
  // today; where it was abandoned (older state, or a refused discard) recover ends that one through the wave that did the work. Its members were prepared again and live on in
  // other waves, so none of them is archived here.
  const failedStart = (current) => (!current.waves[wave] && current.history.waves[wave]?.state === "failed-start" &&
    current.history.waves[wave].unlazyAbandoned ? current.history.waves[wave] : null);
  const withSource = (current) => {
    const record = failedStart(current);
    return record ? { ...current, waves: { ...current.waves, [wave]: { ...record, state: "abandoned" } } } : current;
  };
  if (replacementWave) assertReplacementCovers(withSource(state), wave, replacementWave);
  else verifiedCoverage(withSource(state), wave);
  childOk(await runNode(context.tools.dispatchCheck, ["recover", "--root", context.repoRoot, "--package", context.packageId,
    "--scope", context.scope, "--wave", wave, ...(replacementWave ? ["--replacement-wave", replacementWave] : [])],
  { cwd: context.repoRoot }), "dispatch recovery");
  let coverage = null;
  updateState(context, (fresh) => {
    if (replacementWave) assertReplacementCovers(withSource(fresh), wave, replacementWave);
    else coverage = verifiedCoverage(withSource(fresh), wave);
    const failed = failedStart(fresh);
    if (failed) {
      fresh.history.waves[wave] = { ...failed, state: "recovered", recoveredAt: new Date().toISOString(), failedStart: true,
        ...(replacementWave ? { replacementWave } : { recoveredBy: coverage }) };
      transition(fresh, "wave-recovered", wave, "failed-start", "recovered",
        replacementWave ? { replacementWave } : { recoveredBy: coverage });
      return;
    }
    const abandoned = fresh.waves[wave];
    fresh.history.waves[wave] = { ...abandoned, state: "recovered", recoveredAt: new Date().toISOString(),
      ...(replacementWave ? { replacementWave } : { recoveredBy: coverage }) };
    delete fresh.waves[wave];
    for (const sessionId of abandoned.sessions) {
      const entry = fresh.sessions[sessionId];
      if (!entry || entry.state === "verified" || (replacementWave && entry.wave === replacementWave)) continue;
      fresh.history.sessions[sessionId] = { ...entry, archivedAt: new Date().toISOString() };
      delete fresh.sessions[sessionId];
    }
    transition(fresh, "wave-recovered", wave, "abandoned", "recovered",
      replacementWave ? { replacementWave } : { recoveredBy: coverage });
  });
  return { wave, state: "recovered", ...(replacementWave ? { replacementWave } : { recoveredBy: coverage }),
    ownershipPreserved: true };
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

async function currentHead(repoRoot) {
  const result = await gitResult(repoRoot, ["rev-parse", "--verify", "HEAD"]);
  if (result.error || result.status !== 0) fail("GIT_HEAD", "cannot resolve current Git HEAD");
  return String(result.stdout).trim();
}

// Die Owner-OK-Zeile fuer eine Aktion, die NICHT in PACKAGE.md steht (publish,
// waive-duty): gebildet, validiert und sofort wieder gelesen, damit der Datensatz
// exakt dieselbe Form und denselben Zeilen-Digest traegt wie eine gelesene Zeile.
function ownerOkRecord(action, target, head, wording) {
  const line = formatOwnerOkLine({ action, target, date: todayLocal(), commit: head, wording });
  return validateOwnerOk(findOwnerOk(line, action, target), { action, target, head, today: todayLocal() });
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

async function packageCliJson(context, args, operation) {
  const result = await runNode(context.tools.packageCli, [...args, "--json", "--root", context.repoRoot,
    "--package", context.packageId, "--scope", context.scope], { cwd: context.repoRoot });
  const output = childOk(result, operation);
  try { return JSON.parse(output); }
  catch { fail("CHILD_FAILED", operation + " returned invalid JSON"); }
}

async function dutyTransition(context, options) {
  await assertActive(context);
  const command = options.command;
  const args = [command];
  if (options.dutyId) args.push("--duty", id(options.dutyId, "duty"));
  if (options.owner) args.push("--owner", options.owner);
  if (options.trigger) args.push("--trigger", options.trigger);
  if (options.dueState) args.push("--due-state", options.dueState);
  if (options.gate) args.push("--gate", options.gate);
  return await packageCliJson(context, args, command);
}

// Eine Pflicht wird nur mit dem Wort des Owners erlassen. Der Beleg ist dieselbe
// Owner-OK-Zeile wie beim Abschluss, nur mit der Aktion `waive-duty:<id>`; sie
// steht nicht in PACKAGE.md, sondern im Beleg und im Pflichtstand.
async function waiveDuty(context, options) {
  await assertActive(context);
  const wording = ownerWordingOf(context, options);
  if (wording === null) fail("USAGE", "duty-waive requires --owner-ok TEXT or --owner-ok-file FILE");
  const before = readDuties(context);
  const duty = before.duties[id(options.dutyId, "duty")];
  if (!duty || !["open", "due"].includes(duty.dueState)) fail("DUTY_STATE", "a waiver requires an open or due duty");
  const record = ownerOkRecord("waive-duty", duty.id, await currentHead(context.repoRoot), wording);
  // The quote travels as a file: no command line limit, no line break or quotation mark can bend it.
  const result = await withTextFile(record.wording + "\n", (file) =>
    packageCliJson(context, ["duty-waive", "--duty", duty.id, "--owner-ok-file", file], "duty waiver"));
  const receipt = writeConsequentialReceipt({ repoRoot: context.repoRoot, action: "waive-duty",
    packageId: context.packageId, scope: context.scope, ownerOk: record,
    result: { dutyId: duty.id, dueState: "waived", dutiesDigest: dutyStateDigest(result) } });
  return { duty: result.duties[duty.id], ownerOk: record, waiverReceipt: receipt.receipt };
}

// Owner 30.09.2026, "los" auf den Vorschlag: "Neuer Befehl im Harness, etwa package-executor.mjs
// review-manual --gate [id] --evidence [datei], nur der Orchestrator darf ihn aufrufen; er hakt nur Gates
// ohne Pruefbefehl ab, verlangt eine Beleg-Datei im Paket und schreibt Datum und Sitzung mit; freie
// Aenderungen an Gate-Dateien bleiben gesperrt." Anlass: im Paket owner-rules-from-memory konnte kein
// Agent die drei manuellen Gates abhaken -- gate-check setzt [x] nur aus CHECK-Ergebnissen, und paket-gate
// sperrt Gate-Dateien fuer jede Sitzung (OUTSIDE_LEAF_OWNS). Diese Grenzen bleiben: der Befehl ist der eine
// Weg, ein Gate OHNE CHECK abzuhaken, und er schreibt nur die Haken- und EVIDENCE-Zeile genau dieses Gates.
// Proven by test/manual-gate-review.test.js.
const REVIEW_SESSION = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const WORKING_LEAF_STATES = new Set(["prepared", "starting", "running", "abort-requested", "timeout-requested"]);

// LEDGER:GATE in der Schreibweise, die gate-check selbst ausgibt (GATES:M1, leaf-work:L2) oder als Datei
// (GATES.md:M1, gates/leaf-work.md:L2). Der Doppelpunkt vor der Gate-ID ist der letzte.
function reviewTarget(context, value) {
  const text = String(value || "");
  const split = text.lastIndexOf(":");
  if (split <= 0 || split === text.length - 1) {
    fail("USAGE", "review-manual requires --gate LEDGER:GATE, for example GATES.md:M1 or leaf-work:L2");
  }
  const ledger = text.slice(0, split).replaceAll("\\", "/");
  const gateId = id(text.slice(split + 1), "gate");
  let relative;
  if (/^GATES(?:\.md)?$/u.test(ledger)) relative = "GATES.md";
  else {
    const match = ledger.match(/^(?:gates\/)?((?:leaf|node)-[A-Za-z0-9][A-Za-z0-9._-]{0,58}?)(?:\.md)?$/u);
    if (!match) fail("USAGE", "unknown ledger " + ledger + "; use GATES.md or gates/<leaf-|node-name>.md");
    relative = "gates/" + match[1] + ".md";
  }
  const file = path.join(context.packageInfo.packageDir, ...relative.split("/"));
  if (!fs.existsSync(file) || !fs.lstatSync(file).isFile()) fail("GATE_MISSING", "ledger does not exist in this package: " + relative, 1);
  const leaf = relative.startsWith("gates/leaf-") ? relative.slice("gates/".length, -".md".length) : null;
  if (leaf && !context.packageInfo.leaves.includes(leaf)) fail("GATE_MISSING", "leaf ledger is not in the Depth Tree: " + leaf, 1);
  return { relative, file, gateId, leaf };
}

// Der Beleg liegt unter evidence/ DIESES Pakets (nicht unter evidence/close/, das gehoert dem Abschluss),
// ist eine einzelne regulaere, nicht leere Datei und wird mit seiner Pruefsumme gebunden.
function reviewEvidence(context, value) {
  const raw = String(value || "").replaceAll("\\", "/");
  if (!raw) fail("USAGE", "review-manual requires --evidence evidence/<file> or --evidence-file <absolute path outside the repository>");
  const packagePrefix = "docs/packages/" + context.packageId + "/";
  const inside = raw.startsWith(packagePrefix) ? raw.slice(packagePrefix.length) : raw;
  const absolute = path.resolve(context.packageInfo.packageDir, ...inside.split("/"));
  const evidenceDir = path.join(context.packageInfo.packageDir, "evidence");
  if (!repository.isPathInside(evidenceDir, absolute) ||
      repository.samePath(path.join(evidenceDir, "close"), absolute) ||
      repository.isPathInside(path.join(evidenceDir, "close"), absolute)) {
    fail("REVIEW_EVIDENCE", "the evidence file must lie under evidence/ of package " + context.packageId +
      " (evidence/close/ belongs to close)", 1);
  }
  if (!fs.existsSync(absolute)) fail("REVIEW_EVIDENCE", "evidence file does not exist: " + raw, 1);
  const info = fs.lstatSync(absolute);
  if (!info.isFile() || info.isSymbolicLink() || (typeof info.nlink === "number" && info.nlink !== 1)) {
    fail("REVIEW_EVIDENCE", "evidence must be one single-link regular file: " + raw, 1);
  }
  if (!repository.isPathInside(fs.realpathSync(evidenceDir), fs.realpathSync(absolute))) {
    fail("REVIEW_EVIDENCE", "evidence path leaves evidence/ through a link: " + raw, 1);
  }
  const bytes = fs.readFileSync(absolute);
  if (!bytes.length) fail("REVIEW_EVIDENCE", "evidence file is empty: " + raw, 1);
  const relative = path.relative(context.packageInfo.packageDir, absolute).replaceAll("\\", "/");
  if (/[;\0-\x1f]/u.test(relative)) fail("REVIEW_EVIDENCE", "evidence path must not contain ';' or control characters", 1);
  return { relative, sha256: crypto.createHash("sha256").update(bytes).digest("hex") };
}

// --evidence-file: the orchestrator may not write under evidence/ of the package (paket-gate), so the executor
// copies the Owner's file itself. The source is an absolute path outside the repository; the copy is named after
// the gate and bound by its checksum like any other evidence. Nothing is written here: the copy happens only
// after the review is accepted (see writeStagedEvidence).
function stageOwnerEvidence(context, gateId, value) {
  const raw = String(value || "");
  if (!path.isAbsolute(raw)) fail("REVIEW_EVIDENCE", "--evidence-file must be an absolute path: " + raw, 1);
  const source = path.resolve(raw);
  if (repository.isPathInside(context.repoRoot, source)) {
    fail("REVIEW_EVIDENCE", "--evidence-file must lie outside the repository; use --evidence for a file under evidence/", 1);
  }
  if (!fs.existsSync(source)) fail("REVIEW_EVIDENCE", "evidence file does not exist: " + raw, 1);
  const info = fs.lstatSync(source);
  if (!info.isFile() || info.isSymbolicLink()) fail("REVIEW_EVIDENCE", "evidence must be a regular file: " + raw, 1);
  const bytes = fs.readFileSync(source);
  if (!bytes.length) fail("REVIEW_EVIDENCE", "evidence file is empty: " + raw, 1);
  const relative = "evidence/" + gateId.toLowerCase() + "-owner-ok.md";
  return { relative, sha256: crypto.createHash("sha256").update(bytes).digest("hex"), bytes,
    file: path.join(context.packageInfo.packageDir, ...relative.split("/")) };
}

function writeStagedEvidence(evidence) {
  if (!evidence.bytes) return;
  fs.mkdirSync(path.dirname(evidence.file), { recursive: true });
  const temporary = evidence.file + "." + process.pid + "." + crypto.randomBytes(8).toString("hex") + ".tmp";
  fs.writeFileSync(temporary, evidence.bytes, { flag: "wx" });
  try { replaceFileSync(temporary, evidence.file); }
  finally { try { fs.unlinkSync(temporary); } catch { /* renamed or absent */ } }
}

// Nur der Orchestrator: kein Prozess eines gestarteten Leaf-Arbeiters (provider-runtime setzt
// KEEL_PACKAGE_SESSION), keine Leaf-Sitzung dieses Pakets, keine Sitzung mit einer Leaf-Bindung.
function assertReviewer(context, state, sessionId) {
  const worker = String(process.env.KEEL_PACKAGE_SESSION || "").trim();
  if (worker) {
    fail("REVIEW_NOT_ORCHESTRATOR", "review-manual runs only in the orchestrating session; this process belongs to " +
      "the bound leaf worker " + worker, 1);
  }
  const leafSessions = new Set([...Object.keys(state.sessions || {}), ...Object.keys(state.history?.sessions || {})]);
  if (leafSessions.has(sessionId)) {
    fail("REVIEW_NOT_ORCHESTRATOR", "session " + sessionId + " is a leaf session of this package; " +
      "a leaf never reviews a gate", 1);
  }
  try {
    packageBinding.findSessionBinding(context.repoRoot, sessionId, { controlRoot: context.harnessRoot });
  } catch (error) {
    if (/found 0|no active Harness runtime/u.test(String(error.message))) return;
  }
  fail("REVIEW_NOT_ORCHESTRATOR", "session " + sessionId + " holds a leaf binding; review-manual runs only " +
    "in the orchestrating session", 1);
}

// Zeitpunkt: kein Leaf-Gate, solange ein Arbeiter an dem Leaf ist (seine Bindung haengt am Ledger-Text);
// Knoten- und Wurzel-Gates bottom-up erst, wenn jedes Leaf-Gate erfuellt ist; nichts mehr, sobald die
// Integration begonnen hat, denn deren Checkpoint friert die Ledger ein.
// The integration moment is judged after the code state of the gate is known (assertNotIntegrated): a confirmation
// that went stale may be renewed once the integration is committed, since close checks it against HEAD (P8, B12).
function assertNotIntegrated(state, renewal) {
  if (state.integration?.state === "prepared" || (state.integration?.state === "committed" && !renewal)) {
    fail("REVIEW_AFTER_INTEGRATION", "the integration checkpoint already froze the ledgers; a manual review " +
      "now would change integrated content", 1);
  }
}

function assertReviewMoment(context, state, target) {
  const working = Object.values(state.sessions || {})
    .filter((entry) => WORKING_LEAF_STATES.has(entry.state) && (!target.leaf || entry.leaf === target.leaf));
  if (working.length) {
    fail("REVIEW_LEAF_BUSY", "a bound leaf worker is still on " + working.map((entry) => entry.leaf + "=" +
      entry.state).join(", ") + "; review after the provider returned", 1);
  }
  if (!target.leaf) {
    const open = context.packageInfo.leaves.filter((leaf) => ledgerRecord(context.packageInfo, leaf).open);
    if (open.length) {
      fail("REVIEW_ORDER", "root and node gates are reviewed bottom-up after every leaf gate is met; open: " +
        open.join(", "), 1);
    }
  }
}

async function reviewManual(context, options) {
  await assertActive(context);
  if (!options.sessionId) fail("USAGE", "review-manual requires --session ID of the orchestrating session");
  const sessionId = String(options.sessionId);
  if (!REVIEW_SESSION.test(sessionId)) fail("USAGE", "--session must match " + REVIEW_SESSION);
  const state = readState(context, true);
  assertReviewer(context, state, sessionId);
  const target = reviewTarget(context, options.gate);
  const parseGates = await loadGateParser(context.repoRoot, context.unlazyRoot);
  const before = fs.readFileSync(target.file, "utf8");
  const doc = parseGates(before);
  if (doc.errors.length) fail("LEDGER_INVALID", target.relative + ": " + doc.errors.join("; "), 1);
  const gate = doc.gates.find((item) => item.id === target.gateId);
  if (!gate) fail("GATE_MISSING", "gate " + target.gateId + " is not in " + target.relative, 1);
  if (doc.abandoned.has(gate.id)) fail("GATE_ABANDONED", "gate " + target.gateId + " is abandoned", 1);
  if (gate.check) {
    fail("GATE_EXECUTABLE", "gate " + target.relative + ":" + gate.id + " has a CHECK; only gate-check ticks it " +
      "from its own result", 1);
  }
  assertReviewMoment(context, state, target);
  if (options.evidence !== undefined && options.evidenceFile !== undefined) {
    fail("USAGE", "review-manual takes either --evidence or --evidence-file, never both");
  }
  const evidence = options.evidenceFile !== undefined ? stageOwnerEvidence(context, gate.id, options.evidenceFile)
    : reviewEvidence(context, options.evidence);
  const qualified = target.relative + ":" + gate.id;
  const bound = "file=" + evidence.relative + "; sha256=" + evidence.sha256;
  // B12: the confirmation is bound to the code state of its gate scope right now, so integrate and close can tell
  // whether the code changed since. The snapshot selects its uncommitted paths exactly like the integration commit:
  // HEAD plus the changes to files the OWNS globs match (never the bundle). The fixed prefixes of those globs only
  // delimit the key computed at the commit; they never pick uncommitted files, so a foreign file under a prefix but
  // outside the OWNS is neither bound here nor in the integration commit.
  const store = await loadProofStore(context.unlazyRoot);
  const owns = leafOwnsMap(context);
  const spec = manualScope(context.packageId, target.relative, owns);
  const snapshot = await workingCommit({ git: gitWith(context), head: await currentHead(context.repoRoot),
    select: manualSnapshotSelect(spec, owns), label: "manual " + qualified, tmpDirectory: proofTmp(context) });
  const codeDigest = manualCodeState(store, context.repoRoot, snapshot.commit, spec);
  const met = gate.checked && gate.evidence && !/^pending$/iu.test(gate.evidence);
  const verdict = met ? manualVerdict(context, store, snapshot.commit, state, target.relative, gate, spec) : null;
  // A met confirmation is renewed when it went stale, or when it is our own older form without a code state.
  const renewal = Boolean(verdict && (verdict.stale ||
    (!manualCodeOf(gate.evidence) && gate.evidence.startsWith("manual-review;") && gate.evidence.endsWith(bound))));
  assertNotIntegrated(state, renewal);
  if (met && !renewal) {
    if (gate.evidence.startsWith("manual-review;") && gate.evidence.endsWith(bound)) {
      return { packageId: context.packageId, scope: context.scope, gate: qualified, reviewed: true,
        idempotent: true, evidence: evidence.relative, evidenceSha256: evidence.sha256, evidenceLine: gate.evidence };
    }
    fail("GATE_ALREADY_MET", "gate " + qualified + " is already met with other evidence: " + gate.evidence, 1);
  }
  const date = todayLocal();
  const value = "manual-review; date=" + date + "; session=" + sessionId + "; " +
    formatManualCode(codeDigest, snapshot.commit) + "; " + bound;
  const lines = [...doc.lines];
  lines[gate.line] = lines[gate.line].replace(/^- \[( |x|X)\]/u, "- [x]");
  if (gate.evidenceLine !== -1) {
    const indent = (lines[gate.evidenceLine].match(/^\s*/u) || ["  "])[0];
    lines[gate.evidenceLine] = indent + "EVIDENCE: " + value;
  } else {
    let line = gate.line + 1;
    while (line < lines.length && /^\s+(CHECK|EXPECT|EVIDENCE|CWD|CACHE|WRITES):/u.test(lines[line])) line++;
    lines.splice(line, 0, "  EVIDENCE: " + value);
  }
  let next = lines.join(doc.eol);
  if (doc.finalNewline && !next.endsWith(doc.eol)) next += doc.eol;
  const after = parseGates(next);
  const written = after.gates.find((item) => item.id === gate.id);
  if (after.errors.length || !written || !written.checked || written.evidence !== value) {
    fail("LEDGER_INVALID", "the reviewed ledger would not parse back to exactly this gate", 2);
  }
  if (fs.readFileSync(target.file, "utf8") !== before) {
    fail("LEDGER_CHANGED", target.relative + " changed during the review; repeat review-manual", 1);
  }
  writeStagedEvidence(evidence);
  const temporary = target.file + "." + process.pid + "." + crypto.randomBytes(8).toString("hex") + ".tmp";
  fs.writeFileSync(temporary, next, { encoding: "utf8", flag: "wx" });
  try { replaceFileSync(temporary, target.file); }
  finally { try { fs.unlinkSync(temporary); } catch { /* renamed or absent */ } }
  updateState(context, (fresh) => {
    transition(fresh, "manual-gate-reviewed", qualified, renewal ? "stale" : "unmet", "met",
      { reviewer: sessionId, date, evidence: evidence.relative, evidenceSha256: evidence.sha256,
        codeState: codeDigest, codeCommit: snapshot.commit, ...(renewal ? { renewed: true } : {}) });
    if (fresh.manualAdoptions) delete fresh.manualAdoptions[qualified];
  }, { create: true });
  return { packageId: context.packageId, scope: context.scope, gate: qualified, reviewed: true, idempotent: false,
    renewed: renewal, date, session: sessionId, evidence: evidence.relative, evidenceSha256: evidence.sha256,
    evidenceLine: value, codeState: codeDigest, codeCommit: snapshot.commit };
}

// Which uncommitted paths the snapshot of a manual confirmation takes: a file the OWNS globs of the package's leaves
// match (the integration commit's own selection), inside the key scope of the gate, outside the bundle. The key
// scope spans the OWNS of every leaf of the package for every gate (leaf, node and root, P21), so a change in any
// leaf's OWNS enters here exactly as it enters the integration commit.
function manualSnapshotSelect(spec, owns) {
  const owned = ownsMatcher(Object.values(owns).flat());
  const inKey = manualSelect(spec);
  return (relative) => owned(relative) && inKey(relative);
}

// The OWNS of every leaf of the Depth Tree, as its ledger states them.
function leafOwnsMap(context) {
  const owns = {};
  for (const leaf of context.packageInfo.leaves) {
    const file = path.join(context.packageInfo.packageDir, "gates", leaf + ".md");
    try { owns[leaf] = leafOwns(fs.readFileSync(file, "utf8")); } catch { owns[leaf] = []; }
  }
  return owns;
}

// B12: whether one met manual confirmation still holds at `commit`. A confirmation with a code state holds while the
// code state of its scope is the same. An older one without (written before this rule) holds until its scope changes:
// the first integrate after the rule records the code state it met (manualAdoptions), and from then on it is judged
// like a new one.
function manualVerdict(context, store, commit, state, relative, gate, spec, { adopt = false } = {}) {
  const qualified = relative + ":" + gate.id;
  const current = manualCodeState(store, context.repoRoot, commit, spec);
  const recorded = manualCodeOf(gate.evidence);
  if (recorded) {
    if (recorded.digest === current) return { stale: false, qualified };
    return { stale: true, qualified, changed: changedInScope(store, context.repoRoot, recorded.commit, commit, spec) };
  }
  const evidenceDigest = manualEvidenceDigest(gate.evidence);
  const known = state?.manualAdoptions?.[qualified];
  if (known && known.evidenceDigest === evidenceDigest && /^[a-f0-9]{40,64}$/u.test(String(known.commit || ""))) {
    if (known.digest === current) return { stale: false, qualified };
    return { stale: true, legacy: true, qualified, changed: changedInScope(store, context.repoRoot, known.commit, commit, spec) };
  }
  return { stale: false, qualified,
    adopt: adopt ? { digest: current, commit, evidenceDigest, adoptedAt: new Date().toISOString() } : null };
}

// Every met manual gate of the bundle (no CHECK, not abandoned) judged at `commit`. A stale one stops the caller and
// is named with the files that changed in its scope since it was confirmed.
async function assertManualGatesCurrent(context, commit, state, { adopt = false } = {}) {
  const store = await loadProofStore(context.unlazyRoot);
  const parseGates = await loadGateParser(context.repoRoot, context.unlazyRoot);
  const owns = leafOwnsMap(context);
  const stale = [];
  const adoptions = {};
  for (const file of bundleLedgerFiles(context.packageInfo, null)) {
    if (!fs.existsSync(file)) continue;
    const relative = path.relative(context.packageInfo.packageDir, file).replaceAll("\\", "/");
    const doc = parseGates(fs.readFileSync(file, "utf8"));
    if (doc.errors.length) continue; // gate-check refuses an invalid ledger itself
    for (const gate of doc.gates) {
      if (gate.check || doc.abandoned.has(gate.id)) continue;
      if (!gate.checked || !gate.evidence || /^pending$/iu.test(gate.evidence)) continue;
      const verdict = manualVerdict(context, store, commit, state, relative, gate,
        manualScope(context.packageId, relative, owns), { adopt });
      if (verdict.adopt) adoptions[verdict.qualified] = verdict.adopt;
      if (verdict.stale) stale.push(verdict);
    }
  }
  if (stale.length) {
    const named = stale.map((item) => item.qualified + " (" + (item.legacy ? "confirmed before code-state binding; " : "") +
      (item.changed === null ? "changed files unknown: the confirmed code state is no longer in the object store"
        : item.changed.length ? "changed: " + item.changed.slice(0, 20).join(", ") + (item.changed.length > 20 ? ", ... (" +
          item.changed.length + " files)" : "") : "changed") + ")");
    fail("MANUAL_GATE_STALE", "manual gate confirmation(s) no longer match the code they were confirmed for: " +
      named.join("; ") + ". Renew each with review-manual --gate <LEDGER:GATE> --evidence evidence/<file> --session " +
      "<orchestrating session>", 1);
  }
  return adoptions;
}

function recordAdoptions(context, adoptions) {
  if (!Object.keys(adoptions).length) return;
  updateState(context, (fresh) => {
    fresh.manualAdoptions = { ...(fresh.manualAdoptions || {}) };
    for (const [qualified, value] of Object.entries(adoptions)) {
      if (!fresh.manualAdoptions[qualified]) fresh.manualAdoptions[qualified] = value;
    }
  });
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

// Every regular file of the bundle with its current digest. Cheap enough to run
// three times around one oracle run: a package bundle is a handful of files.
function bundleFileDigests(context) {
  const digests = new Map();
  const walk = (directory) => {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) { walk(absolute); continue; }
      if (!entry.isFile()) continue;
      digests.set(path.relative(context.repoRoot, absolute).replaceAll("\\", "/"),
        digest(fs.readFileSync(absolute)));
    }
  };
  walk(path.join(context.repoRoot, "docs", "packages", context.packageId));
  return digests;
}

// The witness the writeback tolerance rests on. A ledger declaration says which
// artifacts an oracle MAY refresh; it can never say that THIS run refreshed
// them, and the two differ exactly where it matters -- an Owner proof that sits
// under evidence/ inside a declared surface but that no oracle ever writes. So a
// candidate counts only when its bytes changed ACROSS the mandated
// re-verification (before != after) and the file still carries the bytes that
// run left behind (after == current). A hand edit before the run fails the first
// half, a hand edit after it fails the second.
function oracleRunWitness(before, after, current) {
  const witnessed = [];
  for (const [relative, afterDigest] of after) {
    if (before.get(relative) === afterDigest) continue;
    if (current.get(relative) !== afterDigest) continue;
    witnessed.push(relative);
  }
  return witnessed.sort((left, right) => left.localeCompare(right, "en"));
}

// What the working tree holds differently from the checkpoint commit, over the
// checkpoint's exact recorded path set. The pair is the same one git-intent's
// closureCheckpoint uses, and both halves are needed: `git diff` never reports an
// UNTRACKED file, so a path the checkpoint committed as a DELETION and that
// something recreates afterwards was invisible to the diff alone (measured
// 02.09.2026 in a scratch repository: after committing the deletion of a.txt and
// recreating it, `git diff --name-only <commit> -- a.txt` printed nothing while
// `git status --porcelain -- a.txt` printed "?? a.txt"). The deletion half is
// proven by "two verified leaves receive one integration checkpoint, bottom-up
// reverify, plan completion and close" in test/package-execution.test.js, which
// recreates a deleted evidence artifact before a repeat integrate.
// An empty recorded path set is refused instead of probed: with no pathspec both
// commands silently answer for the WHOLE worktree instead of the recorded set
// (measured 02.09.2026 in the same scratch repository).
async function checkpointTurnover(context, checkpoint) {
  const paths = [...new Set((checkpoint.paths || []).map((item) => String(item)))];
  if (!paths.length) {
    fail("POST_VERIFY_DIRTY", "the integration checkpoint recorded no path set to compare against", 1);
  }
  const probe = async (args) => {
    const result = await gitResult(context.repoRoot, [...args, "--", ...paths]);
    if (result.error || result.status !== 0) {
      fail("POST_VERIFY_DIRTY", "the integrated paths cannot be compared against their checkpoint", 1);
    }
    return String(result.stdout || "").split("\0").filter(Boolean).map((item) => item.replaceAll("\\", "/"));
  };
  return [...new Set([
    ...await probe(["diff", "--name-only", "-z", checkpoint.commit]),
    ...await probe(["ls-files", "--others", "--exclude-standard", "-z"]),
  ])];
}

async function sameNormalizedLedger(context, commit, relative) {
  const committed = await gitResult(context.repoRoot, ["show", commit + ":" + relative]);
  if (committed.error || committed.status !== 0) return false;
  const absolute = path.join(context.repoRoot, relative);
  if (!fs.existsSync(absolute) || !fs.lstatSync(absolute).isFile()) return false;
  return normalizedLedger(String(committed.stdout)) === normalizedLedger(fs.readFileSync(absolute, "utf8"));
}

// What the working tree holds differently from the integration commit, over its exact path set, after the check.
// The check ran in a clean copy of the commit, so it wrote nothing into these paths; only the ticks and EVIDENCE values
// gate-check writes back into a ledger (the same normalized ledger) are runtime state. Anything else moved after the
// commit was built and is refused, so the working tree never claims a content the integration did not check.
async function assertCheckpointClean(context, checkpoint) {
  const changed = await checkpointTurnover(context, checkpoint);
  for (const relative of changed) {
    if (isBundleLedger(relative, context.packageId) &&
        await sameNormalizedLedger(context, checkpoint.commit, relative)) continue;
    fail("POST_VERIFY_DIRTY", "integrated content differs from the checked integration commit " +
      String(checkpoint.commit).slice(0, 8) + ": " + relative, 1);
  }
}

// integrate --ready-only (harness-gaps-2026-10-04, decision 3): a finished fix could only be saved through
// integrate, which wants every session verified and every wave complete -- impossible in a 34-leaf package with
// abandoned waves. This saves exactly the verified sessions: their OWNS plus the package bundle, after the gates
// of those leaves alone were re-run. Open, aborted or abandoned sessions and waves are ignored, the root and node
// gates are neither run nor ticked, and nothing of this lands in state.integration, so a later plain integrate
// stays what it was. git-intent's integration-checkpoint reads executor.json of the scope it is given and
// refuses unless that state is fully verified; it is handed a filtered copy of the verified part under a
// short-lived scope next to the real one and does all the Git work itself (clean index, exact path set, exact
// tree). The copy and its scope are removed afterwards; the receipt moves into the real scope.
// The scope names its holder (process number and start in holder.json). It is cleared only when that process is gone
// (P13, C10); a scope without a holder file (older format, or one its holder is still writing) falls back to its age.
const PARTIAL_SCOPE_STALE_MS = 10 * 60_000;
const PARTIAL_HOLDER_FILE = "holder.json";

function partialScopeName(scope) {
  return "partial-" + crypto.createHash("sha256").update(scope).digest("hex").slice(0, 12);
}

export function openPartialScope(context, name) {
  const directory = path.join(context.repoRoot, ".unlazy", name);
  try { fs.mkdirSync(directory); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    let holder = null;
    try { holder = JSON.parse(fs.readFileSync(path.join(directory, PARTIAL_HOLDER_FILE), "utf8")); } catch { holder = null; }
    let orphaned;
    if (Number.isSafeInteger(holder?.pid) && holder.pid > 0) orphaned = !holderLives(holder.pid, lockTimeMs(holder));
    else {
      let age = 0;
      try { age = Date.now() - fs.statSync(directory).mtimeMs; } catch { /* gone again; created below */ }
      orphaned = age >= PARTIAL_SCOPE_STALE_MS;
    }
    if (!orphaned) {
      fail("PARTIAL_IN_PROGRESS", "another integrate --ready-only is saving this scope; repeat it when that call ended", 1);
    }
    fs.rmSync(directory, { recursive: true, force: true });
    fs.mkdirSync(directory);
  }
  fs.writeFileSync(path.join(directory, PARTIAL_HOLDER_FILE),
    JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }) + "\n", "utf8");
  return directory;
}

// P21 (P8 follow-up, B2/B3): the partial save is judged like the full integration, at a COMMIT OBJECT and not in the
// working tree: git-intent builds the held commit of the ready leaves' OWNS plus the bundle (--hold), gate-check --at
// re-runs the gates of those leaves in a clean copy of it, the manual confirmations of those leaves are compared with
// the code of every ready leaf (the OWNS the held commit carries), and only a green result moves the branch
// (--advance). A red or stale result leaves the branch, the shared index and the working tree as they were, so a green
// can no longer rest on someone else's unsaved files.
async function integrateReady(context, options) {
  await assertActive(context);
  if (options.resultFile || options.expectedResultDigest) {
    fail("USAGE", "integrate --ready-only takes no accepted result; save the finished leaves first, then integrate the package");
  }
  const state = readState(context);
  const ready = Object.values(state.sessions).filter((entry) => entry.state === "verified");
  const skipped = Object.values(state.sessions).filter((entry) => entry.state !== "verified")
    .map((entry) => ({ sessionId: entry.sessionId, leaf: entry.leaf, state: entry.state }));
  if (!ready.length) fail("NOTHING_READY", "no leaf session is locally verified yet; nothing to save with --ready-only", 1);
  const leaves = [...new Set(ready.map((entry) => entry.leaf))].sort((left, right) => left.localeCompare(right, "en"));
  const gateModes = options.approveChecks ? ["--reverify", "--approve"] : ["--reverify"];
  const store = await loadProofStore(context.unlazyRoot);
  const name = partialScopeName(context.scope);
  const directory = openPartialScope(context, name);
  let checkpoint;
  let run = { ran: 0, reused: 0 };
  try {
    // git-intent reads the binding of the partial scope; gate-check must see the package in ONE scope only, so the
    // reference is present while git-intent runs and absent while the gates run.
    const reference = path.join(directory, "package.ref");
    const bind = () => fs.writeFileSync(reference, "docs/packages/" + context.packageId + "\n", "utf8");
    const unbind = () => fs.rmSync(reference, { force: true });
    bind();
    const { integration, partialIntegrations, ...rest } = state;
    atomicJson(path.join(directory, "executor.json"), { ...rest, scope: name,
      sessions: Object.fromEntries(ready.map((entry) => [entry.sessionId, entry])), waves: {} });
    const wording = String(options.message || "").trim() || "leaves " + leaves.join(", ");
    const message = "partial: " + wording;
    const intent = (extra) => withTextFile(message + "\n", (file) =>
      runNode(context.tools.gitIntent, ["integration-checkpoint", "--root", context.repoRoot, "--package", context.packageId,
        "--scope", name, ...extra, "--message-file", file], { cwd: context.repoRoot }))
      .then((result) => parseIntentOutput(childOk(result, "partial integration checkpoint")));
    let advanced = false;
    try {
      const held = await intent(["--hold"]);
      if (held.held !== true) fail("INTEGRATION_CHANGED", "the partial integration could not be built as a held commit", 1);
      copyProofs(store, context.repoRoot, ready.map((entry) => entry.proofCommit), held.commit, context.tools.gitIntent);
      await assertReadyManualGatesCurrent(context, held.commit, leaves);
      unbind();
      try {
        for (const leaf of leaves) {
          const leafRun = await gateCheckAt(context, gateModes, held.commit,
            "re-verification of leaf " + leaf, ["--leaf", leaf]);
          run = { ran: run.ran + leafRun.ran, reused: run.reused + leafRun.reused };
        }
      } finally { bind(); }
      // The ticks and EVIDENCE lines gate-check wrote back belong to the saved bundle: the commit that reaches the
      // branch carries them, and it must be exactly the code state that was checked.
      const final = await intent(["--hold"]);
      if (final.held !== true) fail("INTEGRATION_CHANGED", "the partial integration could not be built again after its check", 1);
      if (store.codeStateKey(context.repoRoot, final.commit).digest !== store.codeStateKey(context.repoRoot, held.commit).digest) {
        fail("INTEGRATION_CHANGED", "saved code changed while the partial commit " + held.commit.slice(0, 8) +
          " was checked; nothing was moved, repeat --ready-only", 1);
      }
      copyProofs(store, context.repoRoot, [held.commit], final.commit, context.tools.gitIntent);
      checkpoint = await intent(["--advance", final.commit]);
      advanced = true;
    } catch (error) {
      if (!advanced && error && typeof error.message === "string") error.message += "; the branch was not moved";
      throw error;
    }
    const receipts = path.join(context.repoRoot, ".unlazy", context.scope, "git", "receipts");
    fs.mkdirSync(receipts, { recursive: true });
    const moved = path.join(receipts, path.basename(checkpoint.receipt));
    fs.renameSync(path.join(context.repoRoot, ...String(checkpoint.receipt).split("/")), moved);
    checkpoint.receipt = path.relative(context.repoRoot, moved).replaceAll("\\", "/");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
  updateState(context, (fresh) => {
    fresh.partialIntegrations = [...(fresh.partialIntegrations || []), { partial: true, commit: checkpoint.commit,
      paths: checkpoint.paths, leaves, sessions: ready.map((entry) => entry.sessionId), receipt: checkpoint.receipt,
      at: new Date().toISOString() }];
    transition(fresh, "integration-partial", context.scope, null, null, { commit: checkpoint.commit, leaves });
  });
  return { ...checkpoint, partial: true, leaves, skipped, rootGatesChecked: false, locallyReverified: true,
    checksRun: run.ran, proofsReused: run.reused };
}

// The manual confirmations of the ready leaves, judged for a partial save: each holds while the code of the save (the
// OWNS of EVERY ready leaf, the leaves the held commit carries) is the code it was confirmed for, so a change in
// another ready leaf after the confirmation makes it stale as well (B12, "the code state of the package scope", as far
// as the saved commit holds it). The package-wide scope of a full integrate cannot be used here: the saved commit
// holds the ready leaves only, so unfinished work of a leaf that is not saved would keep every confirmation stale for
// as long as that work exists. A confirmation without a recorded code state is left to the full integrate (it has
// nothing to compare). A gone object counts as stale (fail closed).
async function assertReadyManualGatesCurrent(context, commit, leaves) {
  const store = await loadProofStore(context.unlazyRoot);
  const parseGates = await loadGateParser(context.repoRoot, context.unlazyRoot);
  const spec = readyScope(context.packageId, leafOwnsMap(context), leaves);
  const stale = [];
  for (const leaf of leaves) {
    const relative = "gates/" + leaf + ".md";
    const file = path.join(context.packageInfo.packageDir, relative);
    if (!fs.existsSync(file)) continue;
    const doc = parseGates(fs.readFileSync(file, "utf8"));
    if (doc.errors.length) continue; // gate-check refuses an invalid ledger itself
    for (const gate of doc.gates) {
      if (gate.check || doc.abandoned.has(gate.id)) continue;
      if (!gate.checked || !gate.evidence || /^pending$/iu.test(gate.evidence)) continue;
      const recorded = manualCodeOf(gate.evidence);
      if (!recorded) continue;
      const changed = changedInScope(store, context.repoRoot, recorded.commit, commit, spec);
      if (changed === null || changed.length) stale.push(relative + ":" + gate.id + " (" +
        (changed === null ? "changed files unknown: the confirmed code state is no longer in the object store"
          : "changed: " + changed.slice(0, 20).join(", ")) + ")");
    }
  }
  if (stale.length) {
    fail("MANUAL_GATE_STALE", "manual gate confirmation(s) of the ready leaves no longer match their code: " +
      stale.join("; ") + ". Renew each with review-manual --gate <LEDGER:GATE> --evidence evidence/<file> --session " +
      "<orchestrating session>", 1);
  }
}

// A given integrate message is judged BEFORE any re-verification (measured 05.10.2026: a missing message was
// only refused by git-intent after about 15 minutes of gates). It has no length limit and may span lines (D13);
// like git-intent, the executor refuses only what cannot be a commit text (a NUL character).
function integrateMessage(options) {
  const given = String(options.message || "").trim();
  if (given.includes("\0")) fail("USAGE", "--message must not contain a NUL character");
  return given;
}

async function integrate(context, options) {
  if (options.readyOnly) return integrateReady(context, options);
  const givenMessage = integrateMessage(options);
  await assertActive(context);
  const state = readState(context);
  // Replaced sessions (reassigned, reopened, with a successor) do not count (decision 7). The same function decides in
  // git-intent, and it is asked here, BEFORE the long re-verification, so a refusal comes at once (P13, E4c, C14).
  // A session that never ran an agent is no open execution here either (mixed leaves, Pruefung 07.10.2026): close proves
  // its gates at HEAD, exactly as assertCloseReady leaves it out -- unless a session other than the calling one holds a
  // living binding on its leaf (Nachpruefung 07.10.2026): that one may still be building, so it counts as open.
  const where = idleWhere(context);
  const counted = integrationSessions(state).filter((entry) => !idleSession(entry, where));
  if (!counted.length || counted.some((entry) => entry.state !== "verified")) {
    fail("OPEN_EXECUTION", "every bound leaf session must return with local Evidence before integration" +
      (counted.length ? ": " + openList(counted, where) : ""), 1);
  }
  if (Object.values(state.waves).some((entry) => entry.state !== "complete")) {
    fail("OPEN_EXECUTION", "every dispatch wave must be complete before integration", 1);
  }
  const acceptedResult = acceptedResultConstraint(context, state, options);
  // P8 (B2): the gates are checked at the integration COMMIT, in a clean copy of it (gate-check --at), never in the
  // working tree. A gate proved for the same code state is not run again (PROOF_REUSED): neither the green return of a
  // single step (its proof is carried over from the return commit) nor a second integrate of the same state. A tick in
  // a ledger is never a proof. --approve-checks additionally authorizes the first execution of still-unapproved oracles.
  const gateModes = options.approveChecks ? ["--reverify", "--approve"] : ["--reverify"];
  const message = givenMessage || "integrate(" + context.packageId + "): " + counted.length + " leaves";
  const integrationArgs = ["integration-checkpoint", "--root", context.repoRoot,
    "--package", context.packageId, "--scope", context.scope];
  if (acceptedResult) integrationArgs.push("--expected-result-file", acceptedResult.file,
    "--expected-result-digest", acceptedResult.digest);
  // The commit text reaches git-intent as a file (D13): no length limit, several lines, no command line limit.
  const intent = (extra, operation) => withTextFile(message + "\n", (file) =>
    runNode(context.tools.gitIntent, [...integrationArgs, ...extra, "--message-file", file], { cwd: context.repoRoot }))
    .then((result) => parseIntentOutput(childOk(result, operation)));

  // Whether this call REPEATS an existing checkpoint is git-intent's answer: every branch that returns
  // `recovered: true` first proves the recorded commit against HEAD and its path set against the commit's own tree.
  if (state.integration?.state === "committed") {
    return finishIntegration(context, options, await intent([], "integration checkpoint"), gateModes, acceptedResult, state);
  }
  // Commit first, branch later: the commit object is built without moving anything (--hold), checked, and only a green
  // check moves the branch (--advance). A red check leaves the branch, the shared index and the working tree as they
  // were, and the held commit is forgotten.
  const store = await loadProofStore(context.unlazyRoot);
  const held = await intent(["--hold"], "integration checkpoint");
  if (held.held !== true) return finishIntegration(context, options, held, gateModes, acceptedResult, state);
  let checkpoint;
  let run;
  let planCompleted;
  let adoptions;
  try {
    copyProofs(store, context.repoRoot, counted.map((entry) => entry.proofCommit), held.commit, context.tools.gitIntent);
    adoptions = await assertManualGatesCurrent(context, held.commit, state, { adopt: true });
    run = await gateCheckAt(context, gateModes, held.commit, "bottom-up integration re-verification");
    if (acceptedResult) acceptedResultConstraint(context, state, options);
    // The ticks and EVIDENCE lines gate-check wrote back and the plan ticks derived from them are runtime state of the
    // bundle: the commit that reaches the branch carries them, and it must be the checked code state exactly.
    planCompleted = completePlanFromEvidence(context);
    const final = await intent(["--hold"], "integration checkpoint");
    if (final.held !== true) fail("INTEGRATION_CHANGED", "the integration could not be built again after its check", 1);
    if (store.codeStateKey(context.repoRoot, final.commit).digest !== store.codeStateKey(context.repoRoot, held.commit).digest) {
      fail("INTEGRATION_CHANGED", "integrated code changed while the integration commit " + held.commit.slice(0, 8) +
        " was checked; nothing was moved, integrate again", 1);
    }
    copyProofs(store, context.repoRoot, [held.commit], final.commit, context.tools.gitIntent);
    checkpoint = await intent(["--advance", final.commit], "integration checkpoint");
  } catch (error) {
    dropHeldIntegration(context);
    if (error && typeof error.message === "string") error.message += "; the branch was not moved";
    throw error;
  }
  recordAdoptions(context, adoptions);
  return finishIntegration(context, options, checkpoint, gateModes, acceptedResult, state,
    { run, planCompleted, provedAt: held.commit });
}

// The read-only audit after the checkpoint and the turnover probe, shared by a first and a repeated integrate. A
// repeat checks the committed integration commit once more at --at: its stored proofs are reused, so nothing runs
// again unless a gate cannot be stored (CACHE: no, a model, the network).
async function finishIntegration(context, options, checkpoint, gateModes, acceptedResult, state, first = null) {
  let run = first?.run || null;
  if (!first) {
    recordAdoptions(context, await assertManualGatesCurrent(context, checkpoint.commit, readState(context), { adopt: true }));
    run = await gateCheckAt(context, gateModes, checkpoint.commit, "bottom-up integration re-verification");
    if (acceptedResult) acceptedResultConstraint(context, state, options);
  }
  // The read-only status audit reads the ledgers the check wrote back; it executes, approves and writes nothing.
  const postCommit = await runNode(context.tools.gateCheck, ["--status", "--root", context.repoRoot,
    "--package", context.packageId, "--scope", context.scope], { cwd: context.repoRoot });
  childOk(postCommit, "post-checkpoint gate status audit");
  await assertCheckpointClean(context, checkpoint);
  return { ...checkpoint, locallyReverified: true, gateStatusAudited: true, planCompleted: first?.planCompleted ?? false,
    reintegration: checkpoint.recovered === true, provedAt: first?.provedAt || checkpoint.commit,
    checksRun: run ? run.ran : 0, proofsReused: run ? run.reused : 0,
    gateOutputDigest: digest(String(postCommit.stdout || "")) };
}

// A held integration commit whose check was red (or that could not be advanced) is forgotten: nothing of it was on
// the branch or in the shared index.
function dropHeldIntegration(context) {
  try {
    updateState(context, (fresh) => {
      if (fresh.integration?.state !== "prepared" || fresh.integration.held !== true) return;
      transition(fresh, "integration-held-dropped", context.scope, "prepared", null,
        { commit: fresh.integration.expectedCommit || null });
      fresh.integration = null;
    });
  } catch { /* the next integrate drops it as well */ }
}

async function status(context, options = {}) {
  // status of a package that was never started activates nothing (runtime-state-recovery R1).
  if (!packageRefMatches(context)) {
    const result = await runNode(context.tools.packageCli, ["status", "--json", "--root", context.repoRoot,
      "--package", context.packageId], { cwd: context.repoRoot });
    return { active: false, executor: null, package: JSON.parse(childOk(result, "package status", [0, 1])) };
  }
  await assertActive(context);
  for (const entry of Object.values(readState(context, true).sessions)) {
    if ((entry.runId || REQUESTED_STATES.has(entry.state)) && !SETTLED_STATES.has(entry.state)) {
      await synchronizeSession(context, entry.sessionId);
    }
  }
  // An agent that ended frees a place: the queued members of the sealed waves start now (C2).
  const queue = await advanceQueue(context, options);
  const state = readState(context, true);
  const result = await runNode(context.tools.packageCli, ["status", "--json", "--root", context.repoRoot,
    "--package", context.packageId], { cwd: context.repoRoot });
  const output = childOk(result, "package status", [0, 1]);
  return { active: true, executor: state, package: JSON.parse(output),
    ...(queue.started.length || queue.failed.length ? { queue } : {}) };
}

// Where the never-run rule looks for living bindings of other sessions (git-intent heldByOtherSession).
function idleWhere(context) {
  return { repoRoot: context.repoRoot, harnessRoot: context.harnessRoot, scope: context.scope, caller: callingSession(process.env) };
}

function openList(entries, where) {
  return entries.filter((entry) => entry.state !== "verified").map((entry) => {
    const held = neverRan(entry) ? heldByOtherSession(entry, where) : null;
    return entry.sessionId + "=" + entry.state + (held ? " (never ran; session " + held.sessionId + " holds a living binding on " +
      held.leaf + ")" : "");
  }).join(", ");
}

function assertCloseReady(context, state) {
  const where = idleWhere(context);
  const worked = Object.values(state.sessions).filter((entry) => !idleSession(entry, where));
  const notVerified = worked.filter((entry) => entry.state !== "verified");
  if (notVerified.length) {
    fail("OPEN_EXECUTION", "every retained leaf session must be locally verified before close: " + openList(notVerified, where), 1);
  }
  const openWaves = Object.entries(state.waves).filter(([, wave]) => wave.state !== "complete");
  if (openWaves.length) fail("OPEN_EXECUTION", "every retained dispatch wave must be complete before close", 1);
  if (worked.length && state.integration?.state !== "committed") {
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

// Every bundle ledger of this package as its repo-relative path. A bundle-wide
// gate-runner invocation covers exactly this set.
function bundleLedgerRelatives(context) {
  return bundleLedgerFiles(context.packageInfo, null)
    .filter((file) => fs.existsSync(file))
    .map((file) => path.relative(context.repoRoot, file).replaceAll("\\", "/"))
    .filter((relative) => isBundleLedger(relative, context.packageId))
    .sort((left, right) => left.localeCompare(right, "en"));
}

// The witness of ONE mandated re-verification, written as an execution receipt
// and handed to git-intent by receipt path. git-intent verifies the receipt
// itself (plan-close identity, HEAD, and each recorded digest against the file's
// current bytes) and intersects it with the ledger declarations it reads itself,
// so neither half alone can widen the closure writeback window -- and neither
// half is a claim this executor makes on the command line any more.
// `ledgers` names what the invocation covered: the vendored close and the
// recovery re-verification both run the WHOLE bundle in one process, which is
// the documented limit here -- the gate runner's exact selector (--leaf) exists
// for leaf ledgers only, and neither close path may skip the root ledger.
function closureWitnessArgs(context, planReceipt, head, before, after) {
  const files = oracleRunWitness(before, after, bundleFileDigests(context))
    .map((relative) => ({ relative, digest: after.get(relative) }));
  const witness = writeWritebackWitness({ repoRoot: context.repoRoot, packageId: context.packageId,
    scope: context.scope, planReceipt, head, ledgers: bundleLedgerRelatives(context), files });
  return ["--writeback-receipt", witness.receipt];
}

// Die Owner-OK-Zeile in PACKAGE.md wird atomar geschrieben, genau wie die
// Planhaken der Integration: erst eine Temporaerdatei, dann ein Rename.
function writeOwnerOkLine(context, line) {
  const file = context.packageInfo.packageFile;
  const next = insertOwnerOkLine(fs.readFileSync(file, "utf8"), line);
  const temporary = file + "." + process.pid + "." + crypto.randomBytes(8).toString("hex") + ".tmp";
  fs.writeFileSync(temporary, next, { encoding: "utf8", flag: "wx" });
  try { replaceFileSync(temporary, file); }
  finally { try { fs.unlinkSync(temporary); } catch { /* renamed or absent */ } }
}

// Der Abschluss ist der einzige Schritt, der die Owner-OK-Zeile in PACKAGE.md
// schreibt: sie wird mit dem Schluss-Commit versioniert und ist danach der
// dauerhafte Beleg der Owner-Entscheidung. `--owner-ok TEXT` traegt den Wortlaut
// des Owners aus dem Chat; ohne den Schalter muss die Zeile schon dastehen.
// Nach dem Schreiben wird der Paket-Kontext neu eingelesen, weil jeder spaetere
// Vergleich (Plan-Digest, completePlanFromEvidence) gegen die Bytes der Datei laeuft.
function ownerOkForClose(context, options, head) {
  const today = todayLocal();
  const wording = ownerWordingOf(context, options);
  if (wording !== null) {
    const existing = findOwnerOk(context.packageInfo.packageText, "close");
    // Ein zweites OK des Owners ist nie ein Fehler: gilt die vorhandene Zeile noch fuer
    // diesen HEAD, bleibt sie stehen (ein abgebrochener Abschluss darf einfach wiederholt
    // werden); ist sie veraltet, ersetzt das neue Wort des Owners die alte Zeile. Ohne
    // diese Regel endete jeder gescheiterte Abschluss in einer Sackgasse, aus der nur
    // Handarbeit an der PACKAGE.md fuehrte (Review 08.09.2026).
    if (!existing || existing.commit !== head) {
      const line = formatOwnerOkLine({ action: "close", target: null, date: today, commit: head, wording });
      if (existing) replaceOwnerOkLine(context, existing, line);
      else writeOwnerOkLine(context, line);
      context.packageInfo = packageRecord(context.repoRoot, context.packageId);
    }
  }
  try {
    return validateOwnerOk(findOwnerOk(context.packageInfo.packageText, "close"),
      { action: "close", target: null, head, today });
  } catch (error) {
    if (error.code === "OWNER_OK_STALE") {
      error.message += "; repeat close with the Owner's words (--owner-ok TEXT or --owner-ok-file FILE) to replace the stale entry";
    }
    throw error;
  }
}

// Ein veralteter close-Eintrag (Kurzform oder Zitatblock) wird durch den neuen ersetzt, an derselben Stelle.
function replaceOwnerOkLine(context, record, newLine) {
  const file = context.packageInfo.packageFile;
  const text = fs.readFileSync(file, "utf8");
  const next = replaceOwnerOkRecord(text, record, newLine);
  const temporary = file + "." + process.pid + "." + crypto.randomBytes(8).toString("hex") + ".tmp";
  fs.writeFileSync(temporary, next, { encoding: "utf8", flag: "wx" });
  try { replaceFileSync(temporary, file); }
  finally { try { fs.unlinkSync(temporary); } catch { /* renamed or absent */ } }
}

// The commit text of a close: the given one, or the default. No length limit, no cutting (D13); several lines are fine.
function commitTextOf(options, fallback) {
  const text = String(options.message || fallback).trim();
  if (text.includes("\0")) fail("USAGE", "--message must not contain a NUL character");
  return text;
}

async function close(context, options) {
  await assertActive(context);
  const state = readState(context);
  assertCloseReady(context, state);
  const duties = readDuties(context);
  assertDutiesReady(duties);
  const head = await currentHead(context.repoRoot);
  // B12: every manual confirmation still holds for the code at HEAD, before the Owner-OK line is written.
  await assertManualGatesCurrent(context, head, state);
  // Without new words of the Owner the line must already stand; that is checked first, before any gate runs.
  if (ownerWordingOf(context, options) === null) ownerOkForClose(context, options, head);
  // Leaves no agent ran for (the calling session built them itself; all of them, or some beside integrated ones): no
  // integration proved their gates. The gates are proven here, at HEAD in a clean copy (a result stored for the same code
  // state counts), and only a green proof derives the plan ticks, exactly as integrate does. This comes BEFORE the
  // Owner-OK line is written and before the close plan, which binds the plan ticks: a red gate or a check that is not
  // approved stops the close with PACKAGE.md unchanged, and the same close can simply be repeated (Pruefung 07.10.2026).
  const idleSessions = Object.values(state.sessions).filter((entry) => idleSession(entry, idleWhere(context))).map((entry) => entry.sessionId);
  if (idleSessions.length) {
    await gateCheckAt(context, ["--reverify"], head, "close re-verification (no agent ran for " + idleSessions.join(", ") + ")");
    completePlanFromEvidence(context);
    context.packageInfo = packageRecord(context.repoRoot, context.packageId);
  }
  const ownerOk = ownerOkForClose(context, options, head);
  const closeMessage = commitTextOf(options, "chore: close package " + context.packageId);
  const planned = parseIntentOutput(childOk(await runNode(context.tools.gitIntent,
    ["plan-close", "--root", context.repoRoot, "--package", context.packageId, "--scope", context.scope],
    { cwd: context.repoRoot }), "close checkpoint plan"));
  // P8 (B3): the vendored close checks every gate at HEAD in a clean copy (gate-check --at HEAD). A result stored for
  // the same code state (the integration's) counts, every other gate runs there; files of other sessions that are not
  // committed play no part, so the close no longer depends on a clean repository. --reverify is accepted and changes
  // nothing: there is no cheaper path to force away from.
  // The vendored close re-verifies the whole bundle, so the digests taken around
  // it are the witness of what that mandated run actually rewrote. Without it a
  // file hand-edited between the close plan and this call would ride through the
  // declared writeback window unchanged.
  const witnessBefore = bundleFileDigests(context);
  const closeArgs = ["close", "--root", context.repoRoot,
    "--package", context.packageId, "--scope", context.scope];
  const closed = await runNode(context.tools.packageCli, [...closeArgs, "--json"], { cwd: context.repoRoot });
  const witnessAfter = bundleFileDigests(context);
  let packageClose;
  try { packageClose = JSON.parse(childOk(closed, "package close")); }
  catch (error) { if (error.code) throw error; fail("CHILD_FAILED", "package close returned invalid JSON"); }
  const reverified = packageClose.reverified !== false;
  const durableClose = writeConsequentialReceipt({ repoRoot: context.repoRoot, action: "close",
    packageId: context.packageId, scope: context.scope, ownerOk, duties,
    result: { packageClosed: true, planReceipt: planned.receipt, packageClose, reverified,
      ...(idleSessions.length ? { idleSessions } : {}) } });
  const closeEvidence = mirrorCloseEvidence(context, durableClose.receipt, duties);
  let closure;
  try {
    closure = parseIntentOutput(childOk(await withTextFile(closeMessage + "\n", (file) => runNode(context.tools.gitIntent,
      ["closure-checkpoint", "--root", context.repoRoot, "--package", context.packageId,
        "--message-file", file, "--receipt", planned.receipt,
        "--unlazy-root", context.unlazyRoot,
        ...closureWitnessArgs(context, planned.receipt, planned.head, witnessBefore, witnessAfter)],
      { cwd: context.repoRoot })), "closure checkpoint"));
  } catch (error) {
    error.message += "; package is closed and recoverable with close receipt " + durableClose.receipt;
    throw error;
  }
  const completed = writeConsequentialReceipt({ repoRoot: context.repoRoot, action: "close",
    packageId: context.packageId, scope: context.scope, ownerOk, duties,
    result: { packageClosed: true, planReceipt: planned.receipt, packageClose, closure, reverified,
      ...(idleSessions.length ? { idleSessions } : {}) } });
  // The sessions that never ran an agent leave their binding index entries behind (the runtime scope is gone).
  for (const sessionId of idleSessions) {
    try { packageBinding.removeBinding({ repoRoot: context.repoRoot, scope: context.scope, sessionId, controlRoot: context.harnessRoot }); }
    catch { /* a stale index entry is harmless and is retired with the next cleanup */ }
  }
  return { packageId: context.packageId, scope: context.scope, originalOwnerDigest: state.originalOwnerDigest,
    originalGoalDigest: state.originalGoalDigest, closed: true, ownerOk, reverified, checkedAt: head,
    checksRun: (String(packageClose.gateOutput || "").match(/^ {2}RUN {2}/gmu) || []).length,
    proofsReused: (String(packageClose.gateOutput || "").match(/PROOF_REUSED /gu) || []).length,
    closeReceipt: completed.receipt, recoveryReceipt: durableClose.receipt,
    closeEvidence, closure, locallyReverified: reverified, providerOutputEvidence: false,
    ...(idleSessions.length ? { idleSessions } : {}) };
}

// Audit 06.09.2026, B23: the durable truth of a close no longer lives only in gitignored
// .unlazy/. The close receipt and the duty state are mirrored as immutable records into the
// bundle before the closure checkpoint, which admits exactly them (git-intent
// closeMirrorRecord) and commits them with the closure. Der Freigabebeleg selbst braucht
// keine Spiegelung mehr: die Owner-OK-Zeile steht in der PACKAGE.md desselben Commits.
function mirrorCloseEvidence(context, closeReceipt, duties) {
  const directory = path.join(context.packageInfo.packageDir, "evidence", "close");
  fs.mkdirSync(directory, { recursive: true });
  const files = [];
  for (const [name, source] of [
    ["close-receipt.json", closeReceipt],
  ]) {
    const target = path.join(directory, name);
    fs.writeFileSync(target, fs.readFileSync(source));
    files.push(path.relative(context.repoRoot, target).replaceAll("\\", "/"));
  }
  const dutiesTarget = path.join(directory, "duties-state.json");
  fs.rmSync(dutiesTarget, { force: true });
  writeImmutableRecordFile(dutiesTarget, { operation: "duties-state", packageId: context.packageId, scope: context.scope, duties });
  files.push(path.relative(context.repoRoot, dutiesTarget).replaceAll("\\", "/"));
  return { directory: path.relative(context.repoRoot, directory).replaceAll("\\", "/"), files: files.sort() };
}

async function recoverClose(context, options) {
  if (!options.receipt) fail("USAGE", "recover-close requires --receipt CLOSE_RECEIPT");
  const source = readExecutionReceipt(context.repoRoot, options.receipt, "close-receipt");
  if (source.value.packageId !== context.packageId || source.value.scope !== context.scope ||
      source.value.result?.packageClosed !== true) fail("CLOSE_RECOVERY", "receipt does not bind this closed package");
  if (source.value.result.closure) return { recovered: true, idempotent: true, closeReceipt: source.file,
    closure: source.value.result.closure, locallyReverified: false };
  // recover-close writes the same closure commit close writes, so it carries
  // the same duty: close re-verifies bottom-up through its package-cli run, and
  // the recovery must not become the one closure path that commits a package
  // whose gates were only ever green before the interruption. The successful
  // close already removed the scope runtime, so this run addresses the exact
  // bundle by package identity; the ledger set and the resolved CWD are the
  // same ones close re-verified.
  // P8 (B3): checked at HEAD in a clean copy like close itself; a stored result of the same code state counts. HEAD is
  // the commit the close plan binds (closure-checkpoint refuses any other), so the manual confirmations close judged
  // there still hold; those with a code state are judged again.
  const head = await currentHead(context.repoRoot);
  await assertManualGatesCurrent(context, head, null);
  const witnessBefore = bundleFileDigests(context);
  const reverified = await runNode(context.tools.gateCheck, ["--reverify", "--at", head, "--root", context.repoRoot,
    "--package", context.packageId], { cwd: context.repoRoot });
  // A red recovery re-verification must not read as "the harness broke". The
  // package is already closed, so recovery is the only route left to the missing
  // closure commit, and refusing it silently would strand the package half
  // closed. Name the state and the Owner route instead of failing with the
  // generic child error.
  if (reverified.status !== 0) {
    const detail = String(reverified.stderr || reverified.stdout || "").trim().slice(0, 1_000);
    fail("CLOSE_RECOVERY_REVERIFY", "bottom-up close recovery re-verification is red, so the interrupted closure " +
      "checkpoint stays unwritten and the package stays half closed: " + (detail || "exit " + reverified.status) +
      ". Repair the red gate and repeat recover-close with the same close receipt; if it cannot go green again, the " +
      "Owner route is a NEW Owner-OK line and a new close -- recovery never commits an unverified bundle.",
    1);
  }
  const witnessAfter = bundleFileDigests(context);
  const closeMessage = commitTextOf(options, "chore: close package " + context.packageId);
  const recoveryWitnessArgs = closureWitnessArgs(context, source.value.result.planReceipt, await currentHead(context.repoRoot),
    witnessBefore, witnessAfter);
  const closure = parseIntentOutput(childOk(await withTextFile(closeMessage + "\n", (file) => runNode(context.tools.gitIntent,
    ["closure-checkpoint", "--root", context.repoRoot, "--package", context.packageId,
      "--message-file", file, "--receipt", source.value.result.planReceipt,
      "--unlazy-root", context.unlazyRoot, ...recoveryWitnessArgs],
    { cwd: context.repoRoot })), "closure checkpoint recovery"));
  const completed = writeConsequentialReceipt({ repoRoot: context.repoRoot, action: "close",
    packageId: context.packageId, scope: context.scope, ownerOk: source.value.ownerOk,
    duties: source.value.duties, result: { ...source.value.result, closure, recovered: true } });
  return { recovered: true, idempotent: false, closeReceipt: completed.receipt, closure, locallyReverified: true };
}

// Publish ist die zweite folgenreiche Transition. Der Owner sagt im Chat OK, der
// Agent bildet daraus dieselbe Owner-OK-Zeile -- hier gebunden an den HEAD des
// Publish-Plans -- und reicht ihren Wortlaut an git-intent weiter.
async function publish(context, options) {
  if (!options.closureReceipt) fail("USAGE", "publish requires --closure-receipt");
  const wording = ownerWordingOf(context, options);
  if (wording === null) fail("USAGE", "publish requires --owner-ok TEXT or --owner-ok-file FILE");
  const planned = parseIntentOutput(childOk(await runNode(context.tools.gitIntent,
    ["plan-publish", "--root", context.repoRoot, "--receipt", options.closureReceipt],
  { cwd: context.repoRoot }), "publish plan"));
  const ownerOk = ownerOkRecord("publish", null, planned.head, wording);
  const published = parseIntentOutput(childOk(await withTextFile(ownerOk.wording + "\n", (file) =>
    runNode(context.tools.gitIntent, ["publish", "--root", context.repoRoot, "--receipt", planned.receipt,
      "--owner-ok-file", file], { cwd: context.repoRoot })), "Owner-OK publish"));
  const receipt = writeConsequentialReceipt({ repoRoot: context.repoRoot, action: "publish",
    packageId: context.packageId, scope: context.scope, ownerOk, result: published });
  return { ...published, ownerOk, publishReceipt: receipt.receipt };
}

// The stored binding of a session, read raw: validateBinding would refuse it exactly because the
// contract changed, which is the case rebind exists for.
function rawBinding(context, sessionId) {
  const file = packageBinding.bindingPath(context.repoRoot, context.scope, sessionId);
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return null; }
}

function bindingFacts(value, fallbackOwns) {
  return { packageDigest: value?.packageDigest ?? null, leafDigest: value?.leafDigest ?? null,
    ownerDigest: value?.ownerDigest ?? null, headOid: value?.headOid ?? null, owns: value?.owns ?? fallbackOwns ?? [] };
}

// Renew: the prepared session keeps its id and gets a binding for the current contract. OWNS that
// changed move the lease; a refused claim takes the old lease back byte for byte and changes nothing.
async function renewBinding(context, state, entry, reason, options) {
  const ledger = ledgerRecord(context.packageInfo, entry.leaf);
  const old = rawBinding(context, entry.sessionId);
  const modelResolution = packageModel(context, options, ledger.text, entry.provider, ledger.file);
  const before = bindingFacts(old, entry.owns);
  const owns = packageBinding.leafOwnsFromText(ledger.text);
  if (JSON.stringify(owns) !== JSON.stringify(before.owns)) {
    const held = leafLeases(context, entry.leaf).map((lease) => ({ file: lease.file, bytes: fs.readFileSync(lease.file) }));
    childOk(await gateCheckLeaf(context, "--release", entry.leaf), "leaf release");
    const claim = await gateCheckLeaf(context, "--claim", entry.leaf);
    if (claim.status !== 0) {
      for (const lease of held) {
        try { fs.writeFileSync(lease.file, lease.bytes, { flag: "wx" }); } catch { /* the claim prints what holds it */ }
      }
      fail("CLAIM_REFUSED", "the renewed OWNS of " + entry.leaf + " cannot be claimed; the old lease and binding stay: " +
        (String(claim.stdout || "") + String(claim.stderr || "")).trim().slice(0, 2_000), 1);
    }
  }
  packageBinding.createBinding({ startPath: context.repoRoot, packageId: context.packageId,
    scope: context.scope, sessionId: entry.sessionId, leaf: entry.leaf, controlRoot: context.harnessRoot });
  const brief = writeBrief(context, state, entry, ledger);
  const after = bindingFacts(rawBinding(context, entry.sessionId));
  const written = updateState(context, (fresh) => {
    const target = sessionOf(fresh, entry.sessionId);
    if (target.state !== "prepared") fail("SESSION_STATE", entry.sessionId + " changed to " + target.state + " during rebind", 1);
    Object.assign(target, { provider: modelResolution.provider, briefDigest: brief.digest, owns: brief.binding.owns,
      delegation: delegation(modelResolution, brief.file), updatedAt: new Date().toISOString() });
    transition(fresh, "session-rebound", target.sessionId, target.state, target.state, { reason, before, after });
  });
  return { rebound: true, transferred: false, before, after, ...publicEntry(written.sessions[entry.sessionId]) };
}

// Transfer: a continued session takes over the prepared leaf under its new id. The lease stays and no
// file of the OWNS is touched, so no work is lost.
function transferBinding(context, state, entry, newSessionId, reason) {
  assertNotOrchestrator({ harnessRoot: context.harnessRoot, sessionId: newSessionId, env: process.env });
  if (state.sessions[newSessionId] || state.history.sessions[newSessionId]) {
    fail("SESSION_EXISTS", "session " + newSessionId + " is already known to this package", 1);
  }
  const occupied = packageBinding.sessionConflict({ repoRoot: context.repoRoot, scope: context.scope,
    sessionId: newSessionId, leaf: entry.leaf, controlRoot: context.harnessRoot });
  if (occupied) fail("SESSION_OCCUPIED", occupied, 1);
  const ledger = ledgerRecord(context.packageInfo, entry.leaf);
  const old = rawBinding(context, entry.sessionId);
  if (JSON.stringify(packageBinding.leafOwnsFromText(ledger.text)) !== JSON.stringify(old?.owns ?? entry.owns ?? [])) {
    fail("SESSION_STATE", "the OWNS of " + entry.leaf + " changed since " + entry.sessionId + " was bound; renew first: " +
      "rebind --session " + entry.sessionId + " --reason <text>, then transfer", 1);
  }
  packageBinding.createBinding({ startPath: context.repoRoot, packageId: context.packageId,
    scope: context.scope, sessionId: newSessionId, leaf: entry.leaf, controlRoot: context.harnessRoot });
  const target = { ...entry, sessionId: newSessionId, attempts: [...(entry.attempts || [])], transferredFrom: entry.sessionId,
    updatedAt: new Date().toISOString() };
  const brief = writeBrief(context, state, target, ledger);
  const stored = entry.delegation || {};
  const choice = stored.modelChoice || {};
  target.delegation = delegation({ provider: stored.provider || entry.provider, model: stored.model, cliModel: stored.model,
    effort: stored.effort, source: choice.source, label: choice.label, side: choice.side,
    ...(choice.reason ? { reason: choice.reason } : {}) }, brief.file);
  Object.assign(target, { briefFile: path.relative(context.repoRoot, brief.file).replaceAll("\\", "/"),
    briefDigest: brief.digest, owns: brief.binding.owns });
  packageBinding.removeBinding({ repoRoot: context.repoRoot, scope: context.scope, sessionId: entry.sessionId,
    controlRoot: context.harnessRoot });
  updateState(context, (fresh) => {
    const current = sessionOf(fresh, entry.sessionId);
    if (current.state !== "prepared") fail("SESSION_STATE", entry.sessionId + " changed to " + current.state + " during rebind", 1);
    if (fresh.sessions[newSessionId] || fresh.history.sessions[newSessionId]) {
      fail("SESSION_EXISTS", "session " + newSessionId + " is already known to this package", 1);
    }
    fresh.history.sessions[entry.sessionId] = { ...current, state: "transferred", transferredTo: newSessionId,
      transferredAt: new Date().toISOString() };
    delete fresh.sessions[entry.sessionId];
    fresh.sessions[newSessionId] = target;
    transition(fresh, "session-transferred", newSessionId, "prepared", "prepared",
      { reason, from: entry.sessionId, to: newSessionId, leaf: entry.leaf });
  });
  return { rebound: false, transferred: true, from: entry.sessionId, ...publicEntry(target) };
}

// Runtime-state-recovery R4: a prepared leaf binding is renewed after a contract change or transferred
// to a new session id. A started session goes through abort, then retry or reassign.
async function rebindExecution(context, options) {
  if (options.reason === undefined) fail("USAGE", "rebind requires --reason TEXT");
  const reason = transitionReason(options);
  assertPackageRef(context);
  const state = readState(context);
  await doctor(context);
  overlapCheck(context);
  let sourceId;
  if (options.sessionId) sourceId = session(options.sessionId);
  else if (options.leaf) {
    if (!options.newSessionId) fail("USAGE", "rebind --leaf requires --new-session");
    const leaf = id(options.leaf, "leaf");
    const candidates = Object.values(state.sessions).filter((item) => item.leaf === leaf && item.state === "prepared");
    if (candidates.length !== 1) {
      fail("USAGE", "rebind --leaf needs exactly one prepared session of " + leaf + "; candidates: " +
        (Object.values(state.sessions).filter((item) => item.leaf === leaf)
          .map((item) => item.sessionId + "=" + item.state).join(", ") || "none"));
    }
    sourceId = candidates[0].sessionId;
  } else fail("USAGE", "rebind requires --session ID or --leaf LEAF with --new-session ID");
  const entry = state.sessions[sourceId];
  if (!entry) fail("SESSION_STATE", "unknown session " + sourceId, 1);
  if (entry.state !== "prepared") {
    fail("SESSION_STATE", "rebind renews or transfers only a prepared session; " + sourceId + " is " + entry.state +
      ": abort it, then retry or reassign", 1);
  }
  if (options.newSessionId) return transferBinding(context, state, entry, session(options.newSessionId), reason);
  return await renewBinding(context, state, entry, reason, options);
}

function isRepositoryRoot(dir) {
  try {
    const info = fs.lstatSync(path.join(dir, ".git"));
    return info.isDirectory() || info.isFile();
  } catch { return false; }
}

// Runtime-state-recovery R3: runtime remnants without a bundle or a living holder are retired on
// purpose, never in passing. Without --apply this is a preview that changes nothing.
async function cleanupRuntimeCommand(options) {
  if (!options.root) fail("USAGE", "cleanup-runtime requires --root DIR");
  if (options.packageId || options.scope || options.sessions.length) {
    fail("USAGE", "cleanup-runtime takes no --package, --scope or --session");
  }
  const dir = path.resolve(options.root);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) fail("USAGE", "--root must be a directory: " + dir);
  const controlRoot = path.resolve(options.harnessRoot || dir);
  const apply = options.apply === true;
  let tools = null;
  if (apply && isRepositoryRoot(dir)) {
    silenceWatchRoot = locateUnlazy(dir, options.unlazyRoot);
    tools = scripts(silenceWatchRoot);
  }
  const notReleasedLeases = [];
  let invalidPlanningRecords = [];
  // The leases are released first, before any scope moves (the order cleanupRuntime keeps), through the async
  // child runner: the sync callback of cleanupRuntime cannot wait for one.
  const orphanedLeases = tools ? runtimeScopes.classifyRuntime(dir).leases.filter((lease) => lease.state === "orphaned") : null;
  for (const { file, scope, packageId, leaf } of orphanedLeases || []) {
    const result = await runNode(tools.gateCheck, ["--release", "--root", dir, "--package", packageId, "--scope", scope,
      "--leaf", leaf], { cwd: dir });
    if (result.status !== 0 || fs.existsSync(file)) {
      notReleasedLeases.push({ file, scope, packageId, leaf, status: result.status,
        output: (String(result.stderr || "") + String(result.stdout || "")).trim().slice(0, 2_000) });
    }
  }
  const pruneRecords = ({ apply: write }) => {
    if (!hasHarnessConfig(controlRoot)) return [];
    const pruned = packageBootstrap.pruneOrphanedRecords({ harnessRoot: controlRoot, dryRun: !write });
    invalidPlanningRecords = pruned.invalidRecords || [];
    return pruned.prunedRecords;
  };
  const result = runtimeScopes.cleanupRuntime({ dir, controlRoot, apply, pruneRecords });
  return { ...result, ...(orphanedLeases ? { orphanedLeases } : {}), apply, notReleasedLeases, invalidPlanningRecords };
}

function publicEntry(entry) {
  return { sessionId: entry.sessionId, leaf: entry.leaf, provider: entry.provider, state: entry.state,
    wave: entry.wave, runId: entry.runId, handle: entry.handle, attempt: entry.attempt,
    deadlineAt: entry.deadlineAt || null, lastHeartbeatAt: entry.lastHeartbeatAt || null,
    providerOutputEvidence: false, briefFile: entry.briefFile, owns: entry.owns, delegation: entry.delegation,
    // D12 and the stop reasons of a run that waits for the Orchestrator (hung, budget-reached, repeated-block).
    ...(entry.logTruncated === true ? { logTruncated: true } : {}),
    ...(Array.isArray(entry.hints) && entry.hints.length ? { hints: entry.hints } : {}),
    ...(entry.failure ? { failure: entry.failure } : {}),
    ...(entry.blocked ? { blocked: entry.blocked } : {}) };
}

const HELP = `${EXECUTOR_USAGE_HEAD}

commands:
${executorCommandHelp()}

start and next activate the package and prepare the leaf in one step: every check
(session id, orchestrator, Owner start, model, doctor, overlap, occupied session)
runs before anything is written, and a later failure rolls back activation, claim,
binding, brief and executor state (the message names what was rolled back). The
output reports retiredScopes, suspendedScopes and releasedLeases. Every other
command needs an active package and refuses with PACKAGE_NOT_ACTIVE and the start
command; status of a package that was never started activates nothing and
reports active:false with executor:null.

The calling session orchestrates and is never bound as a leaf: start, next,
reassign and rebind refuse the calling session, the package planning session and
every recorded orchestrator (ORCHESTRATOR_AS_LEAF); hand the build work to a new
leaf session through dispatch. A package has exactly one orchestrator, kept in
executor.json: the planning session, or else the first session whose start or
command succeeded; a refused call enters nobody, and another session is never
entered. orchestrator-takeover --reason TEXT moves the role to the calling session
(--session only without CLAUDE_CODE_SESSION_ID) as an explicit, recorded step, once
the previous orchestrator has been silent for KEEL_SILENCE_MS (ORCHESTRATOR_ACTIVE
before). An older package without a recorded orchestrator takes over its planning
session or the first orchestrator index entry. With packageContract.ownerStartRequired in
.keel-harness.json the first start of a package needs the Owner start quote in
its "## Status" section,
  Owner-Start: <YYYY-MM-DD> "<wording>"
or --run RUN-PACKAGE whose "## Status" carries
  Owner-Go: <YYYY-MM-DD> "<wording>"
and names the package. The wording is the Owner's own message from the chat: a long, multi-line quote or one with
quotation marks stands as the head without wording (Owner-Start: <YYYY-MM-DD>) followed by lines that each start
with four spaces and ">". A missing key means off.

A leaf ledger or GATES.md may fix model and effort in its head, before the first
gate:
  MODEL: <provider> <model id> <effort>      (MODEL: codex runs the Codex pin)
Precedence: call (--provider/--model/--effort), leaf, package, setting, default.
The chosen effort reaches the Claude worker call as --effort before -p.

abort, abandon and timeout free the leaf lease and binding of every session whose
run is terminal, and so does a provider run that ends aborted, timed-out,
vanished, provider-failed or provider-start-failed; retry and reassign claim and
bind again. A lease without a living holder is released at the next claim of its
leaf. rebind renews a prepared binding after a contract change (moving the lease
when OWNS changed) or transfers it to a new session id without touching any file;
a started session goes through abort, then retry or reassign. cleanup-runtime
previews orphaned scopes, leases, stale session-index entries and planning
records; --apply releases the leases, moves the scopes unchanged to
.unlazy/.retired and never touches docs/packages.

No run of the executor needs a hand edit under .unlazy. Every change of
executor.json takes the scope lock .unlazy/<scope>/executor.lock, reads the
current state again and writes atomically, so parallel calls keep each other's
changes; a lock whose process is gone (process number and start time, no fixed time;
a lock without a process number: older than 120 s) is taken over and recorded.
Only a dead holder makes a lock, a partial-integration folder (holder.json), an architecture-maps job
or a build orphaned, and only a scope without a living holder process counts as dormant (P13, C10). A sync never overwrites a requested stop (abort-requested,
timeout-requested). A return the dispatch already holds for exactly that leaf
and wave is completed instead of refused. restart replaces one member: in a
sealed wave (return failed, provider ended, stop requested) the new session
joins the same wave and starts at once; a provider-returned member of an
abandoned wave gets a prepared session for a new dispatch. reopen reworks a
verified member: it leaves as reopened, the wave is sealed again and the new
session starts in it. recover without --replacement-wave resolves an abandoned
wave whose every leaf has a verified session in it or in a complete wave.
Without --claude-executable, or when that path is no file, Windows starts the
newest claude.exe under %APPDATA%\\Claude\\claude-code\\<version>[\\<folder>]\\,
otherwise the claude program from PATH; the run manifest names it.
A session on abort-requested/timeout-requested is closed (aborted/timed-out) by abort --session ID --reason TEXT or by status once its provider ended.

The one Owner record is the Owner-OK entry, formed as
  Owner-OK: <close|publish|waive-duty:ID|resolve:ID> <YYYY-MM-DD> <commit-sha> "<wording>"
for a short one-line wording, and for every other wording (long, several lines, quotation marks) as the same head
without the quoted wording, followed by the wording as a block of lines that each start with four spaces and ">".
--owner-ok TEXT or --owner-ok-file FILE carries the Owner's own words from the chat, stored as they are: no length
limit, line breaks and quotation marks are fine, only an empty text is refused. No sentence form is asked for: read the
Owner's approval from the conversation and record his words. The file must lie in the session temp folder or in the
run folder (.unlazy); a file of the working tree is refused. close writes that entry into the "## Abschluss" section of
PACKAGE.md and commits it with the closure; without the switch the entry has to be there already (OWNER_OK_MISSING).
With the switch an entry that still names HEAD is kept (a failed close is simply repeated) and a stale one is replaced
by the Owner's words, passed again. The entry binds the commit it names: once HEAD moves on it is OWNER_OK_STALE and the
words are recorded again against the current state (judge from the conversation whether they still cover what changed).
publish and waive-duty form the same entry and keep it in their receipt instead of PACKAGE.md, because a closed
package is not edited any more. A commit text (--message) has no length limit either and may span lines.

Checks run at a commit, in a clean copy of it (gate-check --at), never in the
working tree, and a result stored for the same code state counts (PROOF_REUSED):
return checks HEAD plus exactly the step's OWNS changes as a commit object (no
branch, no shared index, no working-tree write); integrate builds the integration
commit without moving the branch, checks it and moves the branch only when it is
green (a red check leaves branch, index and working tree as they were); close and
recover-close check HEAD. Uncommitted files of other sessions play no part, and
close reports checkedAt:<HEAD>. --reverify is accepted and changes nothing.

--timeout S is accepted and ignored: the gate runner has no per-CHECK time (P7a) and the executor does
not pass the switch on; it sets KEEL_GATE_QUIET_TIMEOUT=1 for the gate runner so that no hint hides the
cause of a failure. The executor itself starts every child program (gate runner,
dispatch, Git interface, Git) through the silence watcher and gives it no time limit and
no output limit; a child ends only when it is really hung (no output for KEEL_SILENCE_MS,
30 minutes by default, and an idle process tree; CHILD_HUNG). Without --provider the package-execution model choice applies (settings,
otherwise Claude); Codex always runs its pin and never for dashboard packages. A provider return is
accepted only after local gate re-verification. First execution of pending
integration oracles requires the explicit integrate --approve-checks switch.
integrate is idempotent: a repeat call checks the same commit again, reuses its
stored results (checksRun:0 unless a gate cannot be stored: CACHE: no, a model,
the network) and returns the same checkpoint receipt instead of a second one.
integrate --ready-only saves only the verified sessions (their OWNS plus the package
bundle). Like the full integrate it builds the commit first without moving the
branch (held commit), re-runs the gates of those leaves in a clean copy of it
(gate-check --at, stored proofs of the returns are reused), compares each manual
confirmation of those leaves with the code of all ready leaves (MANUAL_GATE_STALE
otherwise), and moves the branch only on green; a red or stale result leaves
branch, index and working tree as they were. Open, aborted or abandoned sessions
and waves are ignored, root and node gates are not run or ticked, and the commit
message starts with "partial:". A later plain integrate is unaffected.
recover-close continues an interrupted closure checkpoint and checks HEAD
like close before writing it; once that commit exists it returns
unchanged and without re-verifying (locallyReverified: false). A red recovery
re-verification writes no closure commit and reports CLOSE_RECOVERY_REVERIFY:
repair the gate and repeat, or ask the Owner for a new Owner-OK line and close
again.

review-manual is the one way to tick a gate WITHOUT a CHECK. Only the
orchestrating session calls it: a bound leaf worker (KEEL_PACKAGE_SESSION), a
leaf session of the package and a session holding a leaf binding are refused.
It needs an evidence file under evidence/ of the package, writes
  EVIDENCE: manual-review; date=YYYY-MM-DD; session=ID; code=STATE@COMMIT; file=evidence/FILE; sha256=HEX
and records the event in the executor state. code= binds the confirmation to the
code state of its scope (every gate, leaf, node or root: the OWNS of every leaf of
the package, so a change in another leaf makes it stale too; never the bundle itself; an uncommitted file counts only
when an OWNS glob matches it, as in the integration commit). integrate and close accept it only
while that code state is unchanged; otherwise MANUAL_GATE_STALE names the gate
and the changed files, and review-manual renews it (also after integration). A
confirmation without code= holds until its scope changes after the first
integrate that meets it. A leaf gate is reviewed after its worker returned
(before return); root and node gates after every leaf gate is met; nothing else
after integration began. Gates with a CHECK stay gate-check's, and
the ledger files stay closed to every session's own writes.

A wave has any number of members. dispatch starts them in order while the free memory still leaves the
floor after one more agent (1 GB each; the floor is overrides.freeRamFloorGb in
<harness root>/runtime/voice/system-profile.json, 2 to 4 GB, default 4); the others wait as "queued" in the
wave and start, one after the other as room allows, at every return and every status. With no room at all one
member starts anyway while none of its wave runs (reported as forcedStart/forced). The Unlazy wave is opened before
the wave enters the state and before any agent starts; a refused open leaves nothing behind. When no agent of a wave
could start, the Unlazy wave is discarded with the reason (dispatch-check discard: only a wave in which no leaf ever
started; it leaves no handoff), the wave moves to history with it and its members are prepared again; dispatch takes
the same wave id again at once. A wave with a started leaf is abandoned and ended with recover. When some started, the others are "start-failed", and
retry puts them back into the queue. A dispatch that breaks down after the open frees its queued and start-failed
members the same way. abandon and abort close a wave the Unlazy dispatch does not know (an interrupted dispatch) in
the executor state alone: history with the reason, members that never ran prepared again.
return compares the working tree with the one taken when the step started (nothing is ever reverted; .unlazy is not
judged, and in this package's bundle only what the executor and the gates write: ticks, Status, Abschluss and
EVIDENCE values of PACKAGE.md, GATES.md and gates/*.md; OWNER.md and every other bundle file are judged). A step with
OWNS that changed no file of its OWNS ends as "returned-unchanged" (RETURNED_UNCHANGED, exit 1; restart, resume or
retry decide); a pure check leaf says READ-ONLY: yes in its ledger head. A change outside the OWNS of every step whose
agent ran since the start (starting, running, provider-returned, or a run overlapping that time; not prepared,
queued or start-failed) blocks the return (OUTSIDE_OWNS_CHANGED with the file list); --accept-outside TEXT states
that it came from another session and is kept in the state.

dispatch starts every worker under the guards of the Harness root:
  Claude  claude -p --permission-mode bypassPermissions --setting-sources ""
          --settings <the root's PreToolUse guards with fixed paths>
  Codex   codex exec --json --dangerously-bypass-hook-trust -s workspace-write
          -m <pin> -c model_reasoning_effort='<pin>' -c hooks.PreToolUse=<the same guards>
A worker has no step limit, no time limit and no start time. --max-turns and
--deadline-seconds exist only when the call names them (--max-turns goes to Claude only
then; a run without --deadline-seconds has deadlineAt null and no deadline timer). A worker
is ended in three cases only:
  hung            no tool call open and no event for KEEL_SILENCE_MS (30 minutes by default)
                  while the process tree is idle: the process tree is ended, status hung.
  budget-reached  the cost frame is used up: Claude gets --max-budget-usd (default 20 USD,
                  --cost-budget-usd N); Codex has no such switch, so its tokens are counted
                  while it works from its rollout file (~/.codex/sessions/**/rollout-*-<thread id>.jsonl,
                  read incrementally) and from the usage of turn.completed (default 2,000,000,
                  --token-budget N). A run that ends by itself with success after turn.completed is
                  never stopped for the frame: it is provider-returned, with a hint in "hints".
                  Without a rollout file the count stays at turn.completed, also noted in "hints".
  repeated-block  a PreToolUse hook refused the same tool input three times in a row (the real
                  hook answer only; a call of that input that ran in between starts the count anew).
                  Claude's refusals are read from its event stream; Codex leaves no item for a
                  refused call in codex exec --json, so they are read from the same rollout file
                  (the answer to each tool call, joined to the call by its call id).
All three leave the lease and binding in place and wait for the Orchestrator. resume
continues the native session (claude --resume <session id>, codex exec resume <thread id>)
in the sealed wave with a new frame instead of starting over; retry, reassign, restart and
abort lead out of these states like out of provider-failed. A log that grows past 32 MiB is
cut with a keel_log_truncated line and reported as logTruncated in the session and in status.
Both run with KEEL_PACKAGE_SESSION (the leaf's package session) and
KEEL_HARNESS_ROOT (the rule root). A root without its guards starts no worker
(PROVIDER_GUARDS). --claude-executable, --claude-prefix-arg and
--codex-executable replace the provider program and exist for the executor's
own tests only: without KEEL_EXECUTOR_TEST_MODE=1 they are refused
(PROVIDER_OVERRIDE).`;

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    process.stdout.write(HELP + "\n");
    return;
  }
  const options = parseArgs(process.argv.slice(2));
  if (options.command === "cleanup-runtime") {
    process.stdout.write(JSON.stringify(await cleanupRuntimeCommand(options), null, 2) + "\n");
    return;
  }
  const context = contextFor(options);
  let result;
  if ((options.command === "start" || options.command === "next") && options.sessions.length !== 1) {
    fail("USAGE", options.command + " requires exactly one --session");
  }
  if (options.command !== "dispatch" && options.command !== "start" && options.command !== "next" &&
      options.sessions.length > 1) fail("USAGE", options.command + " accepts at most one --session");
  if (options.command === "start" || options.command === "next") {
    const prepared = await prepare(context, options, options.command === "start" ? options.leaf : null);
    result = { idempotent: prepared.idempotent, originalOwnerDigest: prepared.state.originalOwnerDigest,
      originalOwnerRequestDigest: prepared.state.originalOwnerRequestDigest,
      originalGoal: prepared.state.originalGoal, originalGoalDigest: prepared.state.originalGoalDigest,
      ...(context.retiredScopes ? { retiredScopes: context.retiredScopes } : {}),
      ...(context.suspendedScopes ? { suspendedScopes: context.suspendedScopes } : {}),
      releasedLeases: prepared.releasedLeases,
      ...publicEntry(prepared.entry) };
  } else if (options.command === "dispatch") result = await dispatch(context, options);
  else if (options.command === "return") result = await returnLeaf(context, options);
  else if (options.command === "verify") {
    const state = readState(context);
    const entry = state.sessions[session(options.sessionId)];
    if (!entry) fail("SESSION_STATE", "unknown session");
    result = { sessionId: entry.sessionId, leaf: entry.leaf, locallyReverified: true,
      outputDigest: digest((await verifyLeaf(context, entry)).output) };
  } else if (options.command === "resume") result = await resumeExecution(context, options);
  else if (options.command === "abort") result = await abortExecution(context, options);
  else if (options.command === "abandon") result = await abandonExecution(context, options);
  else if (options.command === "timeout") result = await timeoutExecution(context, options);
  else if (options.command === "heartbeat" || options.command === "liveness") result = await liveness(context, options);
  else if (options.command === "retry") result = await retryExecution(context, options);
  else if (options.command === "reassign") result = await reassignExecution(context, options);
  else if (options.command === "rebind") result = await rebindExecution(context, options);
  else if (options.command === "recover") result = await recoverExecution(context, options);
  else if (options.command === "restart") result = await restartExecution(context, options);
  else if (options.command === "reopen") result = await reopenExecution(context, options);
  else if (["duty-assess", "duty-add", "duty-resolve"].includes(options.command)) {
    result = await dutyTransition(context, options);
  } else if (options.command === "duty-waive") result = await waiveDuty(context, options);
  else if (options.command === "review-manual") result = await reviewManual(context, options);
  else if (options.command === "integrate") result = await integrate(context, options);
  else if (options.command === "status") result = await status(context, options);
  else if (options.command === "close") result = await close(context, options);
  else if (options.command === "recover-close") result = await recoverClose(context, options);
  else if (options.command === "publish") result = await publish(context, options);
  else if (options.command === "orchestrator-takeover") result = await takeoverOrchestrator(context, options);
  else fail("USAGE", "unhandled command " + options.command);
  // Only after the action succeeded (Pruefung 07.10.2026): a refused call enters nobody as orchestrator.
  // review-manual enters the calling session, never the --session it names (Nachpruefung 07.10.2026).
  if (NOTED_COMMANDS[options.command]) noteOrchestrator(context, callerSession(process.env), NOTED_COMMANDS[options.command]);
  if (options.json) process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  else process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

// Run the CLI only when this module IS the process entry, exactly like
// git-intent.mjs. Without the guard an `import` of this module ran main(), which
// failed with USAGE and set a non-zero exit code on its importer -- so nothing
// could unit-test the helpers above. The comparison is by realpath so a relative
// or 8.3-short spelling of the same file still counts as the entry, and a
// missing argv[1] falls back to running: a false "imported" verdict would make
// the CLI exit silently without doing its work.
function isProcessEntry() {
  const entry = process.argv[1];
  if (!entry) return true;
  const self = fileURLToPath(import.meta.url);
  try { return fs.realpathSync(entry) === fs.realpathSync(self); }
  catch { return path.resolve(entry) === path.resolve(self); }
}

if (isProcessEntry()) {
  main().catch((error) => {
    const code = error.code || "PACKAGE_EXECUTOR";
    const output = { error: { code, message: error.message } };
    if (process.argv.includes("--json")) process.stderr.write(JSON.stringify(output) + "\n");
    else console.error("package-executor: " + code + ": " + error.message);
    process.exitCode = error.exitCode || 2;
  });
}
