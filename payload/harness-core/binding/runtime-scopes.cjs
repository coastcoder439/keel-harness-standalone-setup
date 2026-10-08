"use strict";

// Classification of .unlazy runtime remnants. A scope directory or a lease is
// only "orphaned" when nothing can still be working on it; everything doubtful
// counts as active, so cleanup only ever touches unambiguous remnants.
// Owner finding this module serves: „Alte .unlazy-Reste täuschen ein aktives
// Paket vor“. Guard hooks load this file: node:fs and node:path only, no Git
// process and no require of repository.cjs (rename-retry.cjs is the same kind: node:fs only). Linked paths are
// never followed.

const fs = require("node:fs");
const path = require("node:path");
const { renameWithRetry } = require("./rename-retry.cjs");

// Exactly the busy set of leafForNext in the package executor. hung, budget-reached and repeated-block (P12) are
// runs that ended without an answer and wait for the orchestrator's decision (resume, retry, abort): their lease and
// binding stay.
const WORKING_STATES = Object.freeze([
  "prepared", "starting", "running", "provider-returned", "abort-requested", "timeout-requested",
  "hung", "budget-reached", "repeated-block",
  // P13: queued waits in a wave for free memory, start-failed waits for retry, returned-unchanged waits for the
  // Orchestrator; all three keep their lease and binding.
  "queued", "start-failed", "returned-unchanged",
]);
// These states wait for the orchestrator and hold without a process check.
const WAITING_STATES = new Set(["prepared", "provider-returned", "verified", "hung", "budget-reached", "repeated-block",
  "queued", "start-failed", "returned-unchanged"]);
// Terminal provider run states, as in provider-runtime.mjs.
const TERMINAL_RUN_STATES = new Set([
  "provider-start-failed", "provider-returned", "provider-failed", "aborted", "timed-out", "vanished",
  "hung", "budget-reached", "repeated-block",
]);
const OPEN_WAVE_STATES = new Set(["open", "sealed"]);
const IDENTIFIER_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const PACKAGE_REF_RE = /^docs\/packages\/([A-Za-z0-9][A-Za-z0-9._-]{0,63})\r?\n$/u;
const BINDING_FILE_RE = /^[a-f0-9]{64}\.json$/u;

function lstat(file) {
  try { return fs.lstatSync(file); } catch { return null; }
}

function isPlainDirectory(file) {
  const info = lstat(file);
  return Boolean(info && !info.isSymbolicLink() && info.isDirectory());
}

function isPlainFile(file) {
  const info = lstat(file);
  return Boolean(info && !info.isSymbolicLink() && info.isFile());
}

function samePackageId(left, right) {
  if (process.platform === "win32") return String(left).toLowerCase() === String(right).toLowerCase();
  return String(left) === String(right);
}

// Same rule as activePackage in package-binding.cjs: one regular single-link
// file with exactly one docs/packages/<id> line.
function readPackageRef(scopeDirectory) {
  const file = path.join(scopeDirectory, "package.ref");
  const info = lstat(file);
  if (!info) return { present: false, packageId: null };
  if (info.isSymbolicLink() || !info.isFile() || (typeof info.nlink === "number" && info.nlink !== 1)) {
    return { present: true, packageId: null };
  }
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch { return { present: true, packageId: null }; }
  const match = text.match(PACKAGE_REF_RE);
  return { present: true, packageId: match ? match[1] : null };
}

// undefined: file absent; null: present but unreadable or not JSON.
function readJson(file) {
  const info = lstat(file);
  if (!info) return undefined;
  if (info.isSymbolicLink() || !info.isFile()) return null;
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

function isRepositoryRoot(dir) {
  const info = lstat(path.join(dir, ".git"));
  return Boolean(info && (info.isDirectory() || info.isFile()));
}

function processAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === "EPERM"; }
}

function sessionEntries(state) {
  if (!state || typeof state.sessions !== "object" || state.sessions === null) return [];
  return Object.entries(state.sessions)
    .filter(([, entry]) => entry && typeof entry === "object")
    .map(([key, entry]) => ({ ...entry, sessionId: entry.sessionId || key }));
}

// A running session holds only while its provider run is not terminal and its
// worker process lives. Missing run ids or unreadable run state are doubt.
function runningSessionHolds(scopeDirectory, entry) {
  const runId = entry.runId;
  if (typeof runId !== "string" || !IDENTIFIER_RE.test(runId)) return true;
  const run = readJson(path.join(scopeDirectory, "executor", "runs", runId, "state.json"));
  if (!run || typeof run !== "object") return true;
  if (TERMINAL_RUN_STATES.has(run.state)) return false;
  if (!Number.isInteger(run.workerPid) || run.workerPid < 1) return true;
  return processAlive(run.workerPid);
}

function executorHolds(scopeDirectory) {
  const state = readJson(path.join(scopeDirectory, "executor.json"));
  if (state === undefined) return false;
  if (state === null || typeof state !== "object") return true;
  if (state.sessions !== undefined && (typeof state.sessions !== "object" || state.sessions === null)) return true;
  return sessionEntries(state).some((entry) => {
    if (WAITING_STATES.has(entry.state)) return true;
    if (!WORKING_STATES.includes(entry.state)) return false;
    return runningSessionHolds(scopeDirectory, entry);
  });
}

function bindingHolds(scopeDirectory) {
  const directory = path.join(scopeDirectory, "bindings");
  if (!isPlainDirectory(directory)) return false;
  try {
    return fs.readdirSync(directory, { withFileTypes: true })
      .some((entry) => entry.isFile() && BINDING_FILE_RE.test(entry.name));
  } catch { return true; }
}

function openWaves(dispatch) {
  if (!dispatch || typeof dispatch !== "object" || !dispatch.waves || typeof dispatch.waves !== "object") return [];
  return Object.entries(dispatch.waves)
    .filter(([, wave]) => wave && OPEN_WAVE_STATES.has(wave.state))
    .map(([id, wave]) => ({ id, state: wave.state }));
}

function dispatchHolds(scopeDirectory) {
  const dispatch = readJson(path.join(scopeDirectory, "dispatch.json"));
  if (dispatch === undefined) return false;
  if (dispatch === null) return true;
  return openWaves(dispatch).length > 0;
}

function holders(scopeDirectory) {
  const found = [];
  if (executorHolds(scopeDirectory)) found.push("executor-session");
  if (bindingHolds(scopeDirectory)) found.push("binding");
  if (dispatchHolds(scopeDirectory)) found.push("dispatch-wave");
  if (lstat(path.join(scopeDirectory, "lifecycle.json"))) found.push("lifecycle-journal");
  return found;
}

function scopeDirectories(runtime) {
  let entries;
  try { entries = fs.readdirSync(runtime, { withFileTypes: true }); } catch { return []; }
  return entries
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() &&
      !entry.name.startsWith(".") && entry.name !== "locks")
    .map((entry) => entry.name)
    .sort();
}

function classifyScopes(dir, runtime) {
  const repositoryRoot = isRepositoryRoot(dir);
  const scopes = [];
  for (const scope of scopeDirectories(runtime)) {
    const scopeDirectory = path.join(runtime, scope);
    const ref = readPackageRef(scopeDirectory);
    if (!ref.present) continue;
    const reasons = [];
    if (!ref.packageId) reasons.push("package-ref-invalid");
    else if (!isPlainFile(path.join(dir, "docs", "packages", ref.packageId, "PACKAGE.md"))) reasons.push("bundle-missing");
    if (!repositoryRoot) reasons.push("not-repository-root");
    const found = holders(scopeDirectory);
    if (!found.length) reasons.push("no-holder");
    scopes.push(reasons.length
      ? { scope, packageId: ref.packageId, state: "orphaned", reasons }
      : { scope, packageId: ref.packageId, state: "active", reasons: found });
  }
  return scopes;
}

function readLeaseFile(file) {
  let value;
  try { value = JSON.parse(fs.readFileSync(file, "utf8")); } catch { return { invalid: true }; }
  if (!value || typeof value !== "object") return { invalid: true };
  if (value.schema === undefined) return { legacy: true, value };
  if (value.schema !== 2 || typeof value.scope !== "string" || !IDENTIFIER_RE.test(value.scope) ||
      typeof value.packageId !== "string" || !IDENTIFIER_RE.test(value.packageId) ||
      typeof value.leaf !== "string" || !IDENTIFIER_RE.test(value.leaf)) return { invalid: true };
  return { value };
}

function findScopeRecord(scopes, scope) {
  return scopes.find((record) => process.platform === "win32"
    ? record.scope.toLowerCase() === scope.toLowerCase() : record.scope === scope) || null;
}

function classifyLease(runtime, scopes, file) {
  const parsed = readLeaseFile(file);
  if (parsed.invalid) return { file, scope: null, packageId: null, leaf: null, state: "unknown", reason: "invalid-lease" };
  const value = parsed.value;
  if (parsed.legacy) {
    return { file, scope: typeof value.scope === "string" ? value.scope : null, packageId: null,
      leaf: typeof value.leaf === "string" ? value.leaf : null, state: "unknown", reason: "legacy-lease" };
  }
  const record = { file, scope: value.scope, packageId: value.packageId, leaf: value.leaf };
  const scopeDirectory = path.join(runtime, value.scope);
  if (!lstat(scopeDirectory)) return { ...record, state: "orphaned", reason: "scope-gone" };
  if (!isPlainDirectory(scopeDirectory)) return { ...record, state: "held", reason: "no-executor-state" };
  const ref = readPackageRef(scopeDirectory);
  if (!ref.present) return { ...record, state: "orphaned", reason: "scope-gone" };
  if (ref.packageId && !samePackageId(ref.packageId, value.packageId)) {
    return { ...record, state: "orphaned", reason: "scope-gone" };
  }
  const scopeRecord = findScopeRecord(scopes, value.scope);
  if (scopeRecord && scopeRecord.state === "orphaned") return { ...record, state: "orphaned", reason: "scope-gone" };
  const state = readJson(path.join(scopeDirectory, "executor.json"));
  if (state === undefined) return { ...record, state: "held", reason: "no-executor-state" };
  if (state === null || typeof state !== "object") return { ...record, state: "held", reason: "working-session" };
  const working = sessionEntries(state).some((entry) => entry.leaf === value.leaf && WORKING_STATES.includes(entry.state));
  return working
    ? { ...record, state: "held", reason: "working-session" }
    : { ...record, state: "orphaned", reason: "no-holder" };
}

// lease.pid is the short-lived pid of the gate-check call that wrote the lease
// and is never read as a sign of life here.
function classifyLeases(runtime, scopes) {
  const directory = path.join(runtime, "locks");
  if (!isPlainDirectory(directory)) return [];
  let entries;
  try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { return []; }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".lease"))
    .map((entry) => entry.name)
    .sort()
    .map((name) => classifyLease(runtime, scopes, path.join(directory, name)));
}

function classifyRuntime(dir) {
  const runtime = path.join(path.resolve(String(dir)), ".unlazy");
  if (!isPlainDirectory(runtime)) return { scopes: [], leases: [] };
  const scopes = classifyScopes(path.resolve(String(dir)), runtime);
  return { scopes, leases: classifyLeases(runtime, scopes) };
}

// Used by package amendment and package resolution: a package scope is busy
// while a session works on it or a dispatch wave is open or sealed.
function busyReason(repoRoot, scope) {
  if (typeof scope !== "string" || !IDENTIFIER_RE.test(scope)) throw new Error("scope is invalid: " + JSON.stringify(scope));
  const scopeDirectory = path.join(path.resolve(String(repoRoot)), ".unlazy", scope);
  const busy = [];
  const state = readJson(path.join(scopeDirectory, "executor.json"));
  if (state === null) busy.push("executor.json is unreadable");
  for (const entry of sessionEntries(state)) {
    if (WORKING_STATES.includes(entry.state)) {
      busy.push("session " + entry.sessionId + " works on " + entry.leaf + " (" + entry.state + ")");
    }
  }
  const dispatch = readJson(path.join(scopeDirectory, "dispatch.json"));
  if (dispatch === null) busy.push("dispatch.json is unreadable");
  for (const wave of openWaves(dispatch)) busy.push("dispatch wave " + wave.id + " is " + wave.state);
  return busy.length ? "scope " + scope + " is busy: " + busy.join("; ") : null;
}

function staleSessionIndex(controlRoot) {
  if (!controlRoot) return [];
  const root = path.resolve(String(controlRoot));
  const directory = path.join(root, ".unlazy", ".session-index");
  if (!isPlainDirectory(directory)) return [];
  let entries;
  try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { return []; }
  const stale = [];
  for (const entry of entries.filter((item) => item.isFile() && item.name.endsWith(".json")).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    const file = path.join(directory, entry.name);
    const value = readJson(file);
    if (!value || typeof value !== "object" || typeof value.repoRelative !== "string" ||
        typeof value.bindingRelative !== "string") continue;
    const bindingFile = path.resolve(root, value.repoRelative, value.bindingRelative);
    if (!lstat(bindingFile)) stale.push({ file, sessionId: value.sessionId || null, bindingFile });
  }
  return stale;
}

function quoteArgument(value) {
  return /[\s"]/u.test(value) ? JSON.stringify(value) : value;
}

function retiredName(scope, now) {
  return scope + "-" + String(now).replace(/[:.]/gu, "-");
}

// Preview without apply writes nothing. With apply: release orphaned leases
// (only in a repository root), move orphaned scopes unchanged to
// .unlazy/.retired, delete stale session-index files, then prune planning
// records. Unknown leases and docs/packages are never touched. releaseLease
// receives { file, scope, packageId, leaf } and must not depend on package.ref;
// the executor wires releaseLeases from vendor/unlazy/scripts/lib/gates.mjs.
function cleanupRuntime(options = {}) {
  const dir = path.resolve(String(options.dir));
  const controlRoot = options.controlRoot ? path.resolve(String(options.controlRoot)) : null;
  const apply = options.apply === true;
  const classified = classifyRuntime(dir);
  const orphanedScopes = classified.scopes.filter((record) => record.state === "orphaned");
  const orphanedLeases = classified.leases.filter((record) => record.state === "orphaned");
  const stale = staleSessionIndex(controlRoot);
  if (!apply) {
    const orphanedPlanningRecords = typeof options.pruneRecords === "function" ? options.pruneRecords({ apply: false }) : [];
    const next = "package-executor.mjs cleanup-runtime --root " + quoteArgument(dir) +
      (controlRoot ? " --harness-root " + quoteArgument(controlRoot) : "") + " --apply";
    return { orphanedScopes, orphanedLeases, staleSessionIndex: stale, orphanedPlanningRecords: orphanedPlanningRecords || [], next };
  }
  if (isRepositoryRoot(dir) && typeof options.releaseLease === "function") {
    for (const lease of orphanedLeases) {
      options.releaseLease({ file: lease.file, scope: lease.scope, packageId: lease.packageId, leaf: lease.leaf });
    }
  }
  if (orphanedScopes.length) {
    const now = options.now || new Date().toISOString();
    const retiredRoot = path.join(dir, ".unlazy", ".retired");
    if (process.platform === "win32") fs.mkdirSync(retiredRoot, { recursive: true });
    else fs.mkdirSync(retiredRoot, { recursive: true, mode: 0o700 });
    if (!isPlainDirectory(retiredRoot)) throw new Error("retired runtime directory is not a plain directory: " + retiredRoot);
    for (const record of orphanedScopes) {
      const source = path.join(dir, ".unlazy", record.scope);
      const destination = path.join(retiredRoot, retiredName(record.scope, now));
      if (lstat(destination)) throw new Error("retired destination already exists: " + destination);
      // A scanner or indexer may hold the scope directory for a moment (Windows EPERM/EBUSY/EACCES): retry (P15, E4d).
      renameWithRetry(source, destination);
    }
  }
  for (const record of stale) {
    try { fs.unlinkSync(record.file); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  const orphanedPlanningRecords = typeof options.pruneRecords === "function" ? options.pruneRecords({ apply: true }) : [];
  return { orphanedScopes, orphanedLeases, staleSessionIndex: stale, orphanedPlanningRecords: orphanedPlanningRecords || [], next: null };
}

module.exports = {
  WORKING_STATES,
  busyReason,
  classifyRuntime,
  cleanupRuntime,
  staleSessionIndex,
};
