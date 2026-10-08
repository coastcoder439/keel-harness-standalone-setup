"use strict";

// What a session may do beside product work (Karte Arbeitsweise, 07.10.2026, korrigiert): the same rules for every
// session, read once for the PreToolUse guards.
//
//   boundToStep   -- is the session bound to a work step? A worker agent (KEEL_PACKAGE_SESSION, set by the
//                    package executor, no tool call can change it) or a session with a leaf binding. A bound
//                    session works only on its step: no Git maintenance, no project tools, MCP writes declared.
//   openWave      -- an open or sealed dispatch wave in a repository: while it runs, nothing changes the working
//                    tree beside the workers (git pull, switch, stash push wait for integrate).
//   orchestratorFix -- the session that orchestrates a package ("Fix zwischendurch", coordinator 07.10.2026) may
//                    change files inside the OWNS of a leaf of that package while no worker runs on that leaf.
//                    integrate and close judge those changes at the code state like any agent work. Only the one
//                    orchestrator the package records (executor.json "orchestrator": the planning session or the
//                    first starter, changed only by orchestrator-takeover --reason) has this right (Pruefung 07.10.2026).
//   livingBinding -- a leaf binding of another session (binding file or session index entry, a step prepared by
//                    start --session included): that leaf counts as running, and Git maintenance that changes the
//                    working tree waits like for an open wave.
//
// File system reads only, no Git process, except the binding validation of a session that holds a leaf record.
// Never throws: a failure answers on the closed side (bound, wave open, leaf running).

const fs = require("node:fs");
const path = require("node:path");

const sessionRecords = require("../binding/session-records.cjs");
const packageBinding = require("../binding/package-binding.cjs");
const { canonicalPath, isWorkerSession } = require("./hook-context.cjs");

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const OPEN_WAVE_STATES = new Set(["open", "sealed"]);
// A worker runs or is about to run on the leaf: started, running, its result not yet taken back, or waiting in a
// wave for memory. A step only "prepared" (next/start without dispatch) runs no worker yet, but its session holds a
// living binding on the leaf; livingBinding below makes that leaf count as running as well (Pruefung 07.10.2026).
const RUNNING_STATES = new Set(["queued", "starting", "running", "provider-returned", "abort-requested", "timeout-requested"]);

function plainDirectory(directory) {
  try {
    const info = fs.lstatSync(directory);
    return info.isDirectory() && !info.isSymbolicLink();
  } catch { return false; }
}

// undefined: no file; null: present but unreadable (counts as closed); otherwise the value.
function readJson(file) {
  let info;
  try { info = fs.lstatSync(file); } catch { return undefined; }
  if (info.isSymbolicLink() || !info.isFile()) return null;
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

function scopes(repoRoot) {
  const runtime = path.join(repoRoot, ".unlazy");
  try {
    return fs.readdirSync(runtime, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== "locks" && !entry.name.startsWith(".") && IDENTIFIER.test(entry.name))
      .map((entry) => entry.name).sort();
  } catch { return []; }
}

// Bound to a work step: a worker, or a leaf binding whose repository still has its package active. A session without
// any leaf record is answered without Git.
function boundToStep({ harnessRoot, sessionId, cwd, env = process.env } = {}) {
  try {
    if (isWorkerSession(env)) return true;
    const session = String(sessionId || "").trim();
    if (!session || !harnessRoot) return false;
    const starts = [cwd, harnessRoot].filter(Boolean);
    if (!starts.some((start) => sessionRecords.hasLeafRecord(harnessRoot, session, start))) return false;
    for (const start of starts) {
      try {
        packageBinding.findSessionBinding(start, session, { controlRoot: harnessRoot });
        return true;
      } catch { /* stale or elsewhere: the index decides below */ }
    }
    return indexedActive(harnessRoot, session);
  } catch { return true; }
}

// The session index names the repository of the leaf binding; while that repository has an active package the
// session counts as bound even when the binding itself is stale (HEAD moved).
function indexedActive(harnessRoot, sessionId) {
  const key = sessionRecords.sessionKey(sessionId);
  if (!key) return false;
  const value = readJson(path.join(path.resolve(harnessRoot), ".unlazy", ".session-index", key));
  if (!value || typeof value.repoRelative !== "string") return false;
  const repoRoot = path.resolve(harnessRoot, value.repoRelative);
  return scopes(repoRoot).some((scope) => readRef(repoRoot, scope) !== null);
}

function readRef(repoRoot, scope) {
  try {
    const text = fs.readFileSync(path.join(repoRoot, ".unlazy", scope, "package.ref"), "utf8");
    const match = /^docs\/packages\/([A-Za-z0-9][A-Za-z0-9._-]{0,63})\r?\n$/u.exec(text);
    return match ? match[1] : null;
  } catch { return null; }
}

// The first open or sealed dispatch wave of the repository, or null. An unreadable dispatch state counts as open.
function openWave(repoRoot) {
  if (!repoRoot) return null;
  const root = path.resolve(String(repoRoot));
  for (const scope of scopes(root)) {
    const dispatch = readJson(path.join(root, ".unlazy", scope, "dispatch.json"));
    if (dispatch === undefined) continue;
    if (dispatch === null) return { scope, waveId: "?", state: "unreadable" };
    const waves = dispatch && typeof dispatch.waves === "object" && dispatch.waves ? dispatch.waves : {};
    for (const [waveId, wave] of Object.entries(waves)) {
      if (wave && OPEN_WAVE_STATES.has(wave.state)) return { scope, waveId, state: wave.state };
    }
  }
  return null;
}

function leafName(value) {
  return String(value || "").replace(/^gates\//u, "").replace(/\.md$/u, "");
}

function samePath(left, right) {
  const a = path.resolve(String(left));
  const b = path.resolve(String(right));
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

// The first living leaf binding of a session other than exceptSession in the repository (one scope, one leaf, or
// all of them), or null: a binding file under .unlazy/<scope>/bindings, or an entry of the session index of the
// Harness root that names this repository. Both count while they exist; a step prepared by start --session holds
// one. An unreadable binding counts as living (closed side).
function livingBinding(repoRoot, { harnessRoot = null, exceptSession = null, scope = null, leaf = null } = {}) {
  if (!repoRoot) return null;
  const root = path.resolve(String(repoRoot));
  const except = String(exceptSession || "").trim();
  const sameScope = (left, right) => String(left).toLowerCase() === String(right).toLowerCase();
  const matches = (value, itemScope) => {
    if (!value || typeof value !== "object") return true;
    if (except && String(value.sessionId || "").trim() === except) return false;
    if (scope && itemScope && !sameScope(itemScope, scope)) return false;
    if (leaf && leafName(value.leaf) !== leaf) return false;
    return true;
  };
  const found = (source, itemScope, value) => ({ source, scope: itemScope || "?",
    sessionId: value && value.sessionId ? String(value.sessionId) : "?", leaf: value && value.leaf ? leafName(value.leaf) : "?" });
  for (const itemScope of scopes(root)) {
    if (scope && !sameScope(itemScope, scope)) continue;
    const directory = path.join(root, ".unlazy", itemScope, "bindings");
    let names = [];
    try { names = fs.readdirSync(directory).filter((name) => name.endsWith(".json")).sort(); } catch { continue; }
    for (const name of names) {
      const value = readJson(path.join(directory, name));
      if (value === undefined || !matches(value, itemScope)) continue;
      return found("binding", itemScope, value);
    }
  }
  if (harnessRoot) {
    const index = path.join(path.resolve(String(harnessRoot)), ".unlazy", ".session-index");
    let names = [];
    try { names = fs.readdirSync(index).filter((name) => name.endsWith(".json")).sort(); } catch { names = []; }
    for (const name of names) {
      const value = readJson(path.join(index, name));
      if (value === undefined) continue;
      if (value && typeof value.repoRelative === "string" &&
          !samePath(path.resolve(String(harnessRoot), value.repoRelative), root)) continue;
      const itemScope = value && typeof value.scope === "string" ? value.scope : null;
      if (!matches(value, itemScope)) continue;
      return found("session index", itemScope, value);
    }
  }
  return null;
}

function sameId(left, right) {
  return process.platform === "win32" ? String(left).toLowerCase() === String(right).toLowerCase() : String(left) === String(right);
}

function sessionFiles(directory) {
  let names = [];
  try { names = fs.readdirSync(directory).filter((name) => /^[0-9a-f]{64}\.json$/u.test(name)).sort(); } catch { return []; }
  return names.map((name) => readJson(path.join(directory, name)))
    .filter((value) => value && typeof value === "object" && typeof value.sessionId === "string" && value.sessionId.trim());
}

// Nachpruefung 07.10.2026 (2): the orchestrator of an older package, whose executor.json has no orchestratorTracked and no
// orchestrator: its planning session (a planning record of the package under .unlazy/.bootstrap, or an orchestrator
// record under .unlazy/.orchestrators that names the package with via "bootstrap"), else the first session the
// orchestrator index names for the package (the old order entered every caller; the earliest orchestrated first). Leaf
// sessions of the package never count. null when there is none. The package executor takes the same answer over into
// its state; the guards read it here until then.
function legacyOrchestrator({ harnessRoot, repoRoot, packageId, state } = {}) {
  if (!harnessRoot || !repoRoot || !packageId) return null;
  const control = path.resolve(String(harnessRoot));
  const home = canonicalPath(repoRoot);
  const sessions = state && typeof state === "object" ? state : {};
  const leaf = (sessionId) => Boolean(sessions.sessions?.[sessionId] || sessions.history?.sessions?.[sessionId]);
  for (const value of sessionFiles(path.join(control, ".unlazy", ".bootstrap"))) {
    if (sameId(value.packageId, packageId) && typeof value.repoRoot === "string" && samePath(canonicalPath(value.repoRoot), home) &&
        !leaf(value.sessionId)) return { sessionId: value.sessionId, source: "planning record" };
  }
  const named = sessionFiles(path.join(control, ".unlazy", ".orchestrators")).filter((value) => value.schemaVersion === 1 &&
    Array.isArray(value.packages) && value.packages.some((item) => item && sameId(item.packageId, packageId) &&
      typeof item.repoRoot === "string" && samePath(canonicalPath(item.repoRoot), home)) && !leaf(value.sessionId))
    .sort((left, right) => String(left.firstAt || "").localeCompare(String(right.firstAt || "")));
  const planner = named.find((value) => Array.isArray(value.via) && value.via.includes("bootstrap"));
  if (planner) return { sessionId: planner.sessionId, source: "orchestrator index (planning session)" };
  return named.length ? { sessionId: named[0].sessionId, source: "orchestrator index (first entry)" } : null;
}

// The orchestrator a scope of a package records in executor.json, or null. An older state (no orchestratorTracked) without
// one answers with its legacyOrchestrator when harnessRoot is given.
function packageOrchestrator(repoRoot, scope, harnessRoot = null) {
  const state = readJson(path.join(repoRoot, ".unlazy", scope, "executor.json"));
  const value = state && typeof state === "object" ? state.orchestrator : null;
  if (value && typeof value.sessionId === "string" && value.sessionId.trim()) return value.sessionId.trim();
  if (!harnessRoot || !state || typeof state !== "object" || state.orchestratorTracked) return null;
  const legacy = legacyOrchestrator({ harnessRoot, repoRoot, packageId: readRef(repoRoot, scope), state });
  return legacy ? legacy.sessionId : null;
}

// Why a worker counts as running on the leaf, or null. options.harnessRoot and options.exceptSession widen the check
// to living bindings of other sessions on the leaf.
function leafRunning(repoRoot, scope, leaf, options = {}) {
  const directory = path.join(repoRoot, ".unlazy", scope);
  const state = readJson(path.join(directory, "executor.json"));
  if (state === null) return "executor.json of scope " + scope + " is unreadable";
  const sessions = state && typeof state.sessions === "object" && state.sessions ? state.sessions : {};
  for (const [key, entry] of Object.entries(sessions)) {
    if (entry && leafName(entry.leaf) === leaf && RUNNING_STATES.has(entry.state)) {
      return "worker " + (entry.sessionId || key) + " is " + entry.state + " on " + leaf;
    }
  }
  const dispatch = readJson(path.join(directory, "dispatch.json"));
  if (dispatch === null) return "dispatch.json of scope " + scope + " is unreadable";
  const waves = dispatch && typeof dispatch.waves === "object" && dispatch.waves ? dispatch.waves : {};
  for (const [waveId, wave] of Object.entries(waves)) {
    if (wave && OPEN_WAVE_STATES.has(wave.state) && Array.isArray(wave.leaves) && wave.leaves.map(leafName).includes(leaf)) {
      return "dispatch wave " + waveId + " (" + wave.state + ") holds " + leaf;
    }
  }
  const bound = livingBinding(repoRoot, { harnessRoot: options.harnessRoot || null, exceptSession: options.exceptSession || null,
    scope, leaf });
  if (bound) return "session " + bound.sessionId + " holds a living binding on " + leaf + " (" + bound.source + ")";
  return null;
}

// The packages the session orchestrates, from its record under .unlazy/.orchestrators (orchestrator-role.mjs).
function orchestratedPackages(harnessRoot, sessionId) {
  const key = sessionRecords.sessionKey(sessionId);
  if (!key || !harnessRoot) return [];
  const file = path.join(canonicalPath(harnessRoot), ".unlazy", ".orchestrators", key);
  try {
    const info = fs.lstatSync(file);
    if (!info.isFile() || info.isSymbolicLink() || (typeof info.nlink === "number" && info.nlink !== 1)) return [];
  } catch { return []; }
  const value = readJson(file);
  if (!value || value.schemaVersion !== 1 || value.sessionId !== String(sessionId).trim() || !Array.isArray(value.packages)) return [];
  return value.packages.filter((item) => item && typeof item.repoRoot === "string" && path.isAbsolute(item.repoRoot) &&
    IDENTIFIER.test(String(item.packageId)));
}

function leaves(repoRoot, packageId) {
  const directory = path.join(repoRoot, "docs", "packages", packageId, "gates");
  if (!plainDirectory(directory)) return [];
  const found = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !/^leaf-[A-Za-z0-9][A-Za-z0-9._-]{0,58}\.md$/u.test(entry.name)) continue;
    try {
      const owns = packageBinding.leafOwnsFromText(fs.readFileSync(path.join(directory, entry.name), "utf8"));
      found.push({ leaf: entry.name.slice(0, -3), owns });
    } catch { /* a ledger without one valid OWNS line grants nothing */ }
  }
  return found;
}

function relativeInside(repoRoot, target) {
  const relative = path.relative(canonicalPath(repoRoot), canonicalPath(target));
  if (!relative || relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) return null;
  const posix = relative.split(path.sep).join("/");
  // The runtime, the Git directory and the bundles are never a leaf's product file.
  if (/^(?:\.git|\.unlazy)(?:\/|$)/iu.test(posix) || /^docs\/packages(?:\/|$)/iu.test(posix)) return null;
  return posix;
}

// The decision for one write target of an orchestrating session: null when no leaf of an active package it
// orchestrates owns the target (the caller keeps its own answer), { allowed: true, ... } when the owning leaf is at
// rest, { allowed: false, running, ... } when a worker runs on it.
function orchestratorFix({ harnessRoot, sessionId, target } = {}) {
  try {
    if (!target) return null;
    for (const item of orchestratedPackages(harnessRoot, sessionId)) {
      const repoRoot = item.repoRoot;
      // Only the orchestrator the package records has the fix right; a session that merely ran a command of the
      // package, or one whose package was taken over, has none.
      const active = scopes(repoRoot).filter((scope) => readRef(repoRoot, scope) === item.packageId &&
        packageOrchestrator(repoRoot, scope, harnessRoot) === String(sessionId).trim());
      if (!active.length) continue;
      const relative = relativeInside(repoRoot, target);
      if (!relative) continue;
      const owning = leaves(repoRoot, item.packageId)
        .filter((leaf) => leaf.owns.some((pattern) => packageBinding.globRegex(pattern).test(relative)));
      if (!owning.length) continue;
      for (const leaf of owning) {
        for (const scope of active) {
          const running = leafRunning(repoRoot, scope, leaf.leaf, { harnessRoot, exceptSession: sessionId });
          if (running) {
            return { allowed: false, running, packageId: item.packageId, scope, leaf: leaf.leaf, repoRoot, relative };
          }
        }
      }
      return { allowed: true, packageId: item.packageId, scope: active[0], leaf: owning[0].leaf, repoRoot, relative };
    }
    return null;
  } catch (error) {
    return { allowed: false, running: "orchestrator check failed: " + String(error && error.message || error), relative: String(target) };
  }
}

module.exports = { RUNNING_STATES, boundToStep, leafRunning, legacyOrchestrator, livingBinding, openWave, orchestratedPackages,
  orchestratorFix, packageOrchestrator };
