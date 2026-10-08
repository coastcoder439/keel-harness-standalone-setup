#!/usr/bin/env node
"use strict";

// Portable host adapter for the complete vendored Unlazy Stop hook. It splits by role (Karte Arbeitsweise, 07.10.2026);
// the role is the host's, never the agent's (isWorkerSession: KEEL_PACKAGE_SESSION in the environment of the hook).
//
// Working agent (started by the Package-Executor): as before. Not-started packages do not block: when the package the
// vendored hook would resolve has an active scope without any dispatch wave (dispatch.json missing or its waves object
// empty), the adapter ends silently. Everything else is the vendored hook's decision, including its block for open
// checks with the six-block release, which this adapter never touches.
//
// Every other session: the vendored hook is not asked at all, because it binds the one active package of a repository to
// every session that stops in it. Such a session is blocked only when it orchestrates a package (its record under
// .unlazy/.orchestrators, written by the executor on next, start, dispatch, integrate ...), the last answer claims
// finished work (harness-core/guards/done-claim.cjs) and that package is started (a dispatch wave, or the Owner start in
// executor.json) and still has open gates or an open dispatch wave.
// The block comes once per Stop cycle (stop_hook_active ends it) and names the way out; there is no counter and no
// state file. A session that does not orchestrate the package, or says nothing about being finished, is never blocked.
//
// For both roles a problem of the adapter's own never blocks the end of a turn (P4 A10): a hang past the inner limit or
// an internal error ends with exit 0 and a visible message, because a Stop hook that blocks under load holds the agent in
// a loop. The open checks stay open in the package and are verified again at integration.
//
// The vendored hook runs in this process (P4 A16: one Node process per Stop, not
// two): stop-hook.mjs is loaded with import() and called with the hook input. The
// inner limit is 15 s under the hook limit of 20 s in settings.json and hooks.json,
// so the adapter can still speak when the limit is near.
//
// The adapter also lets both project hosts use a repository-relative command
// instead of a machine-specific path.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { canonicalPath, isWorkerSession, msysPath, ruleRoot } = require("../harness-core/guards/hook-context.cjs");
const { doneClaim } = require("../harness-core/guards/done-claim.cjs");

const harnessRoot = path.resolve(__dirname, "..");
const candidates = [
  path.join(harnessRoot, "vendor", "unlazy", "scripts", "stop-hook.mjs"),
  path.join(harnessRoot, "..", "vendor", "unlazy", "scripts", "stop-hook.mjs"),
].filter((candidate) => fs.existsSync(candidate));
const script = candidates.length === 1 ? fs.realpathSync.native(candidates[0]) : null;

// The hook limit in .claude/settings.json and .codex/hooks.json is 20 s; the inner limit stays below it.
const HOOK_LIMIT_MS = 20_000;
const INNER_TIMEOUT_MS = 15_000;
const EMBEDDED = Symbol.for("keel.unlazy.stop-hook.embedded");

class InnerTimeout extends Error {
  constructor(milliseconds) {
    super("Zeitueberschreitung nach " + Math.round(milliseconds / 1000) + " s");
    this.name = "InnerTimeout";
  }
}

const safeText = (value, max = 300) => String(value)
  .replace(/[\u0000-\u001f\u007f-\u009f؜‎‏‪-‮⁦-⁩]/gu, " ")
  .replace(/\s+/gu, " ").trim().slice(0, max);

// The one message of an adapter failure: visible, never blocking.
function passThrough(reason) {
  return {
    exitCode: 0,
    stdout: JSON.stringify({ systemMessage: "Unlazy-Prüfung konnte nicht laufen: " + safeText(reason) }) + "\n",
  };
}

// Loads the vendored hook without starting it: the marker tells stop-hook.mjs it is embedded.
async function loadStopHook() {
  globalThis[EMBEDDED] = true;
  return import(pathToFileURL(script).href);
}

function deadline(promise, milliseconds) {
  let timer;
  const expired = new Promise((_, reject) => { timer = setTimeout(() => reject(new InnerTimeout(milliseconds)), milliseconds); });
  return Promise.race([promise, expired]).finally(() => clearTimeout(timer));
}

// True only when the resolved package has a scope and no dispatch wave yet.
// Any doubt returns false, so the vendored hook decides as before.
async function notStarted(input) {
  let payload;
  try { payload = JSON.parse(input || "{}"); } catch { return false; }
  if (!payload || typeof payload !== "object" || payload.stop_hook_active === true) return false;
  try {
    const cwd = path.resolve(typeof payload.cwd === "string" && payload.cwd
      ? payload.cwd : process.env.CLAUDE_PROJECT_DIR || process.cwd());
    const packages = await import(pathToFileURL(path.join(path.dirname(script), "lib", "packages.mjs")).href);
    const target = packages.resolvePackageTarget({ cwd, sessionId: payload.session_id || "anonymous" });
    if (!target || !target.scope) return false;
    const dispatch = path.join(target.repoRoot, ".unlazy", target.scope, "dispatch.json");
    if (!fs.existsSync(dispatch)) return true;
    const state = JSON.parse(fs.readFileSync(dispatch, "utf8"));
    return Boolean(state && state.waves && typeof state.waves === "object" && !Array.isArray(state.waves) &&
      Object.keys(state.waves).length === 0);
  } catch {
    return false;
  }
}

// --- Every session that is no working agent ---------------------------------------------------------------------

const PACKAGE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;

// The packages a session orchestrates: its record under <harness root>/.unlazy/.orchestrators/<sha256 of the session>.json
// (orchestrator-role.mjs writes it when the session starts, dispatches or integrates). Read only. No record, a record of
// another session, a link or a damaged file means: it orchestrates nothing.
function orchestratedPackages(root, sessionId) {
  const session = String(sessionId ?? "").trim();
  if (!root || !session || session.length > 256 || /[\0\r\n]/u.test(session)) return [];
  try {
    const key = crypto.createHash("sha256").update(session).digest("hex") + ".json";
    const file = path.join(canonicalPath(root), ".unlazy", ".orchestrators", key);
    const info = fs.lstatSync(file);
    if (!info.isFile() || info.isSymbolicLink()) return [];
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!value || value.schemaVersion !== 1 || value.sessionId !== session || !Array.isArray(value.packages)) return [];
    return value.packages.filter((item) => item && typeof item.repoRoot === "string" && path.isAbsolute(item.repoRoot) &&
      PACKAGE_ID.test(String(item.packageId)));
  } catch {
    return [];
  }
}

// The last answer of the session: the host's own field when it has one (Codex always, newer Claude Code too), else the end
// of the Claude transcript (the reader of dod-guard, which only reads the last 512 KiB).
function lastAnswer(payload) {
  if (typeof payload.last_assistant_message === "string" && payload.last_assistant_message.trim()) {
    return payload.last_assistant_message;
  }
  const file = msysPath(payload.transcript_path);
  if (!file) return "";
  const reader = require("./dod-guard.js");
  return reader.schlussTextUndArbeit(reader.leseEintraegeAbLetztemUser(file).eintraege).schlussText;
}

const importLib = (...names) => Promise.all(names.map((name) =>
  import(pathToFileURL(path.join(path.dirname(script), "lib", name)).href)));

// True when the executor recorded the verified Owner start of the scope (executor.json ownerStart, written at the first
// start before any wave). Read only; a missing, linked or damaged file means: no Owner start.
function ownerStarted(repoRoot, scope) {
  try {
    const file = path.join(repoRoot, ".unlazy", scope, "executor.json");
    const info = fs.lstatSync(file);
    if (!info.isFile() || info.isSymbolicLink()) return false;
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    return Boolean(value && value.ownerStart && typeof value.ownerStart === "object" && !Array.isArray(value.ownerStart));
  } catch {
    return false;
  }
}

// What is still open in one orchestrated package, read only (no counter, no state): the unmet gates and ledgers of its
// bundle and the open dispatch waves. null when the package is not active, not started or complete. Started means a
// dispatch wave exists or the Owner start is recorded (executor.json ownerStart): a package the Owner started counts as
// started before its first wave, so a finished claim with open gates is blocked there too.
async function openItems(entry) {
  const [packages, gates, dispatch] = await importLib("packages.mjs", "gates.mjs", "dispatch.mjs");
  const target = packages.resolvePackageTarget({ root: entry.repoRoot, verifiedRoot: true, packageId: entry.packageId });
  if (!target.scope) return null;
  const dispatchFile = path.join(target.repoRoot, ".unlazy", target.scope, "dispatch.json");
  let waves = false;
  if (fs.existsSync(dispatchFile)) {
    const state = JSON.parse(fs.readFileSync(dispatchFile, "utf8"));
    waves = !(state && state.waves && typeof state.waves === "object" && !Array.isArray(state.waves) &&
      Object.keys(state.waves).length === 0);
  }
  if (!waves && !ownerStarted(target.repoRoot, target.scope)) return null;
  const outstanding = [...dispatch.dispatchStatus(target.repoRoot, target.scope, target.packageId).blocking];
  for (const file of target.gateFiles) {
    const label = target.packageId + "/" + path.relative(target.repoRoot, path.resolve(file)).replaceAll("\\", "/");
    let text;
    try { text = fs.readFileSync(file, "utf8"); }
    catch { outstanding.push(label + ":PARSE unreadable"); continue; }
    const doc = gates.parseGates(text);
    if (doc.errors.length) { outstanding.push(label + ":PARSE invalid"); continue; }
    for (const gate of doc.gates) {
      const gateState = gates.gateState(gate, doc.abandoned);
      if (gateState === "unmet" || gateState === "unmet-no-evidence") outstanding.push(label + ":" + gate.id);
    }
  }
  if (!outstanding.length) return null;
  return { packageId: target.packageId, scope: target.scope, outstanding: outstanding.map((item) => safeText(item, 120)) };
}

function mainBlock(claim, open) {
  const list = (item) => item.outstanding.slice(0, 5).join(", ") +
    (item.outstanding.length > 5 ? ", +" + (item.outstanding.length - 5) + " weitere" : "");
  const where = open.map((item) => item.packageId + " (Scope " + item.scope + "): " + item.outstanding.length + " offen: " + list(item));
  return {
    exitCode: 0,
    stdout: JSON.stringify({
      decision: "block",
      reason: "unlazy: Die Antwort meldet Fertigsein (\"" + safeText(claim, 140) + "\"), aber das Paket, das diese Sitzung orchestriert, " +
        "hat noch offene Gates oder eine offene Welle: " + where.join("; ") + ". " +
        "Weg: node vendor/unlazy/scripts/gate-check.mjs --package <id> --scope <id> --status zeigt den Stand ohne Ausfuehrung " +
        "(package-executor status nennt den naechsten Schritt: return, integrate, close). Ist es noch nicht fertig, sag das und " +
        "nenne die offenen Punkte; diese Sperre kommt in diesem Zyklus nicht noch einmal.",
    }) + "\n",
  };
}

// The Stop decision of a session that is no working agent: { exitCode, stdout }. Silent unless all three hold: the session
// orchestrates a package, its last answer claims finished work, and a package of it still has open items.
async function mainSessionDecision(input, env = process.env) {
  const silent = { exitCode: 0, stdout: "" };
  let payload;
  try { payload = JSON.parse(input || "{}"); } catch { return silent; }
  if (!payload || typeof payload !== "object" || payload.stop_hook_active === true) return silent;
  const session = String(payload.session_id ?? payload.sessionId ?? "").trim();
  const cwd = typeof payload.cwd === "string" && payload.cwd ? payload.cwd : process.cwd();
  const roots = [...new Set([ruleRoot(env, cwd), harnessRoot])];
  const packages = roots.flatMap((root) => orchestratedPackages(root, session));
  if (!packages.length) return silent;
  const claim = doneClaim(lastAnswer(payload));
  if (!claim) return silent;
  const open = [];
  const seen = new Set();
  for (const entry of [...packages].reverse()) {
    const key = process.platform === "win32" ? (entry.repoRoot + "\n" + entry.packageId).toLowerCase() : entry.repoRoot + "\n" + entry.packageId;
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      const item = await openItems(entry);
      if (item) open.push(item);
    } catch { /* an unreadable package is no reason to hold the session */ }
  }
  return open.length ? mainBlock(claim, open) : silent;
}

// A Stop is a sign of life of the planning session (P4 D15); the touch never fails the hook.
function noteActivity(input) {
  try {
    require("../harness-core/binding/hook-activity.cjs").noteHookInput(JSON.parse(input || "{}"));
  } catch { /* activity is a record, not a decision */ }
}

// The whole Stop decision: { exitCode, stdout }. Options (timeoutMs, load, env) exist for the tests only.
async function handle(input, options = {}) {
  const timeoutMs = options.timeoutMs === undefined ? INNER_TIMEOUT_MS : options.timeoutMs;
  const env = options.env || process.env;
  const work = async () => {
    noteActivity(input);
    if (!script) throw new Error("erwartet genau eine mitgelieferte stop-hook.mjs, gefunden " + candidates.length);
    // The role is the host's: only a worker the executor started carries KEEL_PACKAGE_SESSION. Every other session is
    // judged by its own record and its own words, never by the one active package of the repository.
    if (!isWorkerSession(env)) return mainSessionDecision(input, env);
    if (await notStarted(input)) return { exitCode: 0, stdout: "" };
    const hook = options.load ? await options.load() : await loadStopHook();
    return hook.runStopHook({ args: [], input, cwd: process.env.CLAUDE_PROJECT_DIR || process.cwd() });
  };
  try {
    return await deadline(work(), timeoutMs);
  } catch (error) {
    return passThrough(error && error.message ? error.message : error);
  }
}

async function selfTest() {
  if (!script || !fs.statSync(script).isFile()) {
    process.stderr.write(`unlazy-stop adapter: expected exactly one vendored stop-hook.mjs; found ${candidates.length}\n`);
    return 1;
  }
  try {
    const hook = await loadStopHook();
    const packages = await import(pathToFileURL(path.join(path.dirname(script), "lib", "packages.mjs")).href);
    if (typeof hook.runStopHook !== "function" || typeof packages.resolvePackageTarget !== "function" ||
        !Number.isInteger(hook.MAX_BLOCKS) || hook.MAX_BLOCKS < 1) {
      process.stderr.write("unlazy-stop adapter: vendored package-aware Stop contract missing\n");
      return 1;
    }
    if (!doneClaim("Fertig.") || doneClaim("Noch nicht fertig.") || typeof orchestratedPackages !== "function") {
      process.stderr.write("unlazy-stop adapter: the done-claim contract of the main-session decision is broken\n");
      return 1;
    }
    if (INNER_TIMEOUT_MS >= HOOK_LIMIT_MS) {
      process.stderr.write("unlazy-stop adapter: inner limit must stay under the hook limit\n");
      return 1;
    }
  } catch (error) {
    process.stderr.write(`unlazy-stop adapter: vendored stop hook does not load: ${safeText(error && error.message)}\n`);
    return 1;
  }
  process.stdout.write("unlazy-stop adapter self-test passed\n");
  return 0;
}

function finish(result) {
  if (result.stdout) process.stdout.write(result.stdout, () => process.exit(result.exitCode));
  else process.exit(result.exitCode);
}

if (require.main === module) {
  if (process.argv.includes("--self-test") || process.argv.includes("--selbsttest")) {
    selfTest().then((code) => process.exit(code), () => process.exit(1));
  } else {
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => { handle(input).then(finish, (error) => finish(passThrough(error && error.message))); });
  }
}

module.exports = { HOOK_LIMIT_MS, INNER_TIMEOUT_MS, handle, mainSessionDecision, orchestratedPackages, passThrough };
