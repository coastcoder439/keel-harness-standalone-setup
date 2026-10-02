// Atomic host-dispatch wave state. Zero dependencies. Node 16+.

import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  appendStatus, scopeRoot, validateScopeId, withFileLock, writeAtomic,
} from "./gates.mjs";

const SCHEMA = 2;
const LEGACY_SCHEMA = 1;
const STATES = new Set(["open", "sealed", "complete", "abandoned", "recovered"]);
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/;
const CONTROL_GLOBAL = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

const record = (value = {}) => Object.assign(Object.create(null), value);
const emptyState = (scope, packageId) => packageId === null
  ? { schema: LEGACY_SCHEMA, waves: record() }
  : { schema: SCHEMA, scope, packageId, waves: record() };
const count = (record) => Object.keys(record).length;

function fail(message) { throw new Error(message); }
const safeDiagnostic = (value) => String(value).replace(CONTROL_GLOBAL, " ").replace(/\s+/g, " ").trim().slice(0, 500);

function validId(value, label) {
  if (typeof value !== "string") fail(label + " must be a string");
  const error = validateScopeId(value, label);
  if (error) fail(error);
  return value;
}

function validHandle(value) {
  if (typeof value !== "string") fail("handle must be a string");
  const handle = value.trim();
  if (!handle || handle.length > 256 || CONTROL.test(handle)) {
    fail("handle must be printable, nonblank, and at most 256 characters");
  }
  return handle;
}

function validReason(value) {
  if (typeof value !== "string") fail("reason must be a string");
  const reason = value.trim();
  if (!reason || reason.length > 500 || CONTROL.test(reason)) {
    fail("reason must be printable, nonblank, and at most 500 characters");
  }
  return reason;
}

function validTime(value, label) {
  if (typeof value !== "string" || !value || Number.isNaN(Date.parse(value))) {
    fail(label + " must be an ISO timestamp");
  }
  return Date.parse(value);
}

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function validateState(state, expected = {}) {
  const packageMode = expected.packageId !== undefined && expected.packageId !== null;
  const expectedScope = validId(expected.scope, "scope");
  const expectedPackage = packageMode ? validId(expected.packageId, "packageId") : null;
  if (!state || typeof state !== "object" || Array.isArray(state) ||
      !state.waves || typeof state.waves !== "object" || Array.isArray(state.waves)) {
    fail("dispatch state must be an object with a waves object");
  }
  if (packageMode) {
    if (state.schema !== SCHEMA || state.scope !== expectedScope || state.packageId !== expectedPackage) {
      fail("expected schema 2 identity " + expectedScope + "::" + expectedPackage);
    }
  } else if (state.schema !== LEGACY_SCHEMA) {
    fail("legacy dispatch requires schema 1; package dispatch requires an active package target");
  }
  state.waves = record(state.waves);

  for (const [waveId, wave] of Object.entries(state.waves)) {
    validId(waveId, "wave");
    if (!wave || typeof wave !== "object" || Array.isArray(wave) || !STATES.has(wave.state) ||
        !Array.isArray(wave.leaves) || !wave.leaves.length ||
        !wave.started || typeof wave.started !== "object" || Array.isArray(wave.started) ||
        !wave.returned || typeof wave.returned !== "object" || Array.isArray(wave.returned)) {
      fail("wave " + waveId + " has an invalid shape");
    }
    if (packageMode && (wave.scope !== expectedScope || wave.packageId !== expectedPackage)) {
      fail("wave " + waveId + " identity does not match " + expectedScope + "::" + expectedPackage);
    }
    wave.started = record(wave.started);
    wave.returned = record(wave.returned);
    const openedAt = validTime(wave.openedAt, "wave " + waveId + " openedAt");
    let abandonedAt = null;
    if (wave.state === "abandoned" || wave.state === "recovered") {
      abandonedAt = validTime(wave.abandonedAt, "wave " + waveId + " abandonedAt");
      wave.reason = validReason(wave.reason);
      if (wave.state === "recovered") {
        validTime(wave.recoveredAt, "wave " + waveId + " recoveredAt");
        if (hasOwn(wave, "recoveredBy")) {
          // Recovered without a replacement wave: every leaf names the wave in
          // which its return stands, the abandoned wave itself included.
          if (hasOwn(wave, "replacementWave")) fail("wave " + waveId + " names both a replacement wave and recoveredBy");
          if (!wave.recoveredBy || typeof wave.recoveredBy !== "object" || Array.isArray(wave.recoveredBy)) {
            fail("wave " + waveId + " has an invalid recoveredBy");
          }
          wave.recoveredBy = record(wave.recoveredBy);
          for (const leaf of wave.leaves) validId(wave.recoveredBy[leaf], "recovering wave of " + leaf);
          for (const leaf of Object.keys(wave.recoveredBy)) {
            if (!wave.leaves.includes(leaf)) fail("wave " + waveId + " recoveredBy names unknown leaf " + leaf);
          }
        } else {
          validId(wave.replacementWave, "replacement wave");
          if (wave.replacementWave === waveId) fail("wave " + waveId + " cannot recover through itself");
        }
      }
    } else if (hasOwn(wave, "abandonedAt") || hasOwn(wave, "reason")) {
      fail(wave.state + " wave " + waveId + " contains abandonment metadata");
    }
    const leaves = new Set();
    for (const leaf of wave.leaves) {
      const id = validId(leaf, "leaf");
      if (leaves.has(id)) fail("wave " + waveId + " has duplicate leaf " + id);
      leaves.add(id);
    }

    const handles = new Set();
    const startTimes = record();
    let latestStart = openedAt;
    // Additive history of the restart and reopen actions. A wave without them
    // validates exactly as before.
    const restarts = validLeafHistory(wave, "restarts", leaves, waveId);
    const reopened = validLeafHistory(wave, "reopened", leaves, waveId);
    const firstStart = record();
    for (const [leaf, entries] of Object.entries(restarts)) {
      let previous = openedAt;
      for (const entry of entries) {
        const handle = validHandle(entry.handle);
        if (handles.has(handle)) fail("wave " + waveId + " reuses handle " + handle);
        handles.add(handle);
        const startedAt = validTime(entry.startedAt, "wave " + waveId + " restarted start time for " + leaf);
        const restartedAt = validTime(entry.at, "wave " + waveId + " restart time for " + leaf);
        if (startedAt < previous || restartedAt < startedAt) fail("wave " + waveId + " restarts " + leaf + " out of order");
        if (!(leaf in firstStart)) firstStart[leaf] = startedAt;
        previous = restartedAt;
      }
      if (!wave.started[leaf]) fail("wave " + waveId + " restarted unstarted leaf " + leaf);
    }
    for (const [leaf, entries] of Object.entries(reopened)) {
      for (const entry of entries) {
        validReason(entry.reason);
        const returnedAt = validTime(entry.returnedAt, "wave " + waveId + " reopened return time for " + leaf);
        const at = validTime(entry.at, "wave " + waveId + " reopen time for " + leaf);
        if (at < returnedAt) fail("wave " + waveId + " reopens " + leaf + " before its return");
      }
      if (!wave.started[leaf]) fail("wave " + waveId + " reopened unstarted leaf " + leaf);
    }
    for (const [leaf, start] of Object.entries(wave.started)) {
      if (!leaves.has(leaf)) fail("wave " + waveId + " started unknown leaf " + leaf);
      if (!start || typeof start !== "object" || Array.isArray(start)) fail("wave " + waveId + " has invalid start for " + leaf);
      const handle = validHandle(start.handle);
      if (handles.has(handle)) fail("wave " + waveId + " reuses handle " + handle);
      handles.add(handle);
      const at = validTime(start.at, "wave " + waveId + " start time for " + leaf);
      if (at < openedAt) fail("wave " + waveId + " starts " + leaf + " before it opened");
      startTimes[leaf] = at;
      // A restarted leaf was sealed with its first start; its replacement start
      // follows the seal by design.
      latestStart = Math.max(latestStart, leaf in firstStart ? firstStart[leaf] : at);
    }

    const returnTimes = [];
    for (const [leaf, returned] of Object.entries(wave.returned)) {
      if (!leaves.has(leaf) || !wave.started[leaf]) fail("wave " + waveId + " returned unstarted leaf " + leaf);
      if (!returned || typeof returned !== "object" || Array.isArray(returned)) fail("wave " + waveId + " has invalid return for " + leaf);
      const at = validTime(returned.at, "wave " + waveId + " return time for " + leaf);
      if (at < startTimes[leaf]) fail("wave " + waveId + " returns " + leaf + " before it started");
      returnTimes.push(at);
    }

    const allStarted = count(wave.started) === wave.leaves.length;
    const allReturned = count(wave.returned) === wave.leaves.length;
    if (wave.state === "open" && count(wave.returned)) fail("open wave " + waveId + " contains returns");
    if (wave.state !== "open" && wave.state !== "abandoned" && wave.state !== "recovered" && !allStarted) {
      fail(wave.state + " wave " + waveId + " is missing starts");
    }
    if (wave.state === "complete" && !allReturned) fail("complete wave " + waveId + " is missing returns");
    if (wave.state === "sealed" && allReturned) fail("sealed wave " + waveId + " should be complete");

    const needsSeal = wave.state === "sealed" || wave.state === "complete" ||
      ((wave.state === "abandoned" || wave.state === "recovered") && hasOwn(wave, "sealedAt"));
    let sealedAt = null;
    if (needsSeal) {
      sealedAt = validTime(wave.sealedAt, "wave " + waveId + " sealedAt");
      if (!allStarted) fail(wave.state + " wave " + waveId + " is missing starts after sealing");
      if (sealedAt < latestStart) fail("wave " + waveId + " was sealed before its final start");
    } else if (hasOwn(wave, "sealedAt")) {
      fail(wave.state + " wave " + waveId + " contains seal metadata");
    }

    if (returnTimes.length) {
      if (sealedAt === null) fail(wave.state + " wave " + waveId + " contains returns without being sealed");
      if (returnTimes.some((at) => at < sealedAt)) fail("wave " + waveId + " contains a return before sealing");
    }

    if (wave.state === "complete") {
      const completedAt = validTime(wave.completedAt, "wave " + waveId + " completedAt");
      if (completedAt < Math.max(sealedAt, ...returnTimes)) {
        fail("wave " + waveId + " completed before its final return");
      }
    } else if (hasOwn(wave, "completedAt")) {
      fail(wave.state + " wave " + waveId + " contains completion metadata");
    }

    if (wave.state === "abandoned" || wave.state === "recovered") {
      if (allReturned) fail("abandoned wave " + waveId + " already has every return and must be complete");
      if (abandonedAt < Math.max(openedAt, latestStart, sealedAt || openedAt, ...returnTimes)) {
        fail("wave " + waveId + " was abandoned before its latest transition");
      }
      if (wave.state === "recovered" && Date.parse(wave.recoveredAt) < abandonedAt) {
        fail("wave " + waveId + " was recovered before it was abandoned");
      }
    } else if (hasOwn(wave, "recoveredAt") || hasOwn(wave, "replacementWave") || hasOwn(wave, "recoveredBy")) {
      fail(wave.state + " wave " + waveId + " contains recovery metadata");
    }
  }
  return state;
}

// restarts[leaf] and reopened[leaf]: optional per-leaf lists, absent in every
// wave that never used restart or reopen.
function validLeafHistory(wave, key, leaves, waveId) {
  if (!hasOwn(wave, key)) return record();
  const value = wave[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("wave " + waveId + " has an invalid " + key);
  wave[key] = record(value);
  for (const [leaf, entries] of Object.entries(wave[key])) {
    if (!leaves.has(leaf)) fail("wave " + waveId + " " + key + " names unknown leaf " + leaf);
    if (!Array.isArray(entries) || !entries.length ||
        entries.some((entry) => !entry || typeof entry !== "object" || Array.isArray(entry))) {
      fail("wave " + waveId + " has an invalid " + key + " list for " + leaf);
    }
  }
  return wave[key];
}

function readState(path, expected) {
  if (!existsSync(path)) return emptyState(expected.scope, expected.packageId);
  try {
    if (lstatSync(path).isSymbolicLink()) fail("refusing dispatch state symlink");
    return validateState(JSON.parse(readFileSync(path, "utf8")), expected);
  } catch (error) {
    if (String(error.message).startsWith("invalid dispatch state:")) throw error;
    throw new Error("invalid dispatch state: " + error.message);
  }
}

export function dispatchStatePath(root, scope) {
  return join(scopeRoot(resolve(root), validId(scope, "scope")), "dispatch.json");
}

export function initialDispatchState(scope, packageId) {
  return emptyState(validId(scope, "scope"), validId(packageId, "packageId"));
}

export function getDispatchWave(root, scope, waveId, packageId = null) {
  const wave = validId(waveId, "wave");
  const state = readState(dispatchStatePath(root, scope), { scope, packageId });
  if (!state.waves[wave]) fail("unknown wave " + wave);
  return state.waves[wave];
}

export function dispatchIssues(root, scope, packageId = null) {
  return dispatchStatus(root, scope, packageId).blocking;
}

export function dispatchStatus(root, scope, packageId = null) {
  if (!scope) return { blocking: [], abandoned: [], resolved: [], errors: [] };
  let state;
  try { state = readState(dispatchStatePath(root, scope), { scope, packageId }); }
  catch (error) {
    const message = safeDiagnostic(error.message);
    return {
      blocking: ["dispatch:PARSE invalid dispatch state"],
      abandoned: [],
      resolved: ["dispatch:PARSE=invalid"],
      errors: ["invalid dispatch state for scope " + scope + ": " + message],
    };
  }
  const result = { blocking: [], abandoned: [], resolved: [], errors: [] };
  for (const [id, wave] of Object.entries(state.waves).sort(([left], [right]) => left.localeCompare(right))) {
    const started = count(wave.started);
    const returned = count(wave.returned);
    result.resolved.push("dispatch:" + id + "=" + wave.state + ";started=" + started + "/" +
      wave.leaves.length + ";returned=" + returned + "/" + wave.leaves.length);
    if (wave.state === "complete" || wave.state === "recovered") continue;
    if (wave.state === "abandoned") {
      result.abandoned.push("dispatch:" + id);
    } else if (wave.state === "open") {
      result.blocking.push("dispatch:" + id + " open (" + started + "/" + wave.leaves.length + " started)");
    } else {
      result.blocking.push("dispatch:" + id + " sealed (" + returned + "/" + wave.leaves.length + " returned)");
    }
  }
  return result;
}

export async function updateDispatch(root, spec) {
  const scope = validId(spec.scope, "scope");
  const packageId = spec.packageId === undefined || spec.packageId === null
    ? null : validId(spec.packageId, "packageId");
  const waveId = validId(spec.wave, "wave");
  const path = dispatchStatePath(root, scope);
  let event = "";

  const wave = await withFileLock(root, path, () => {
    const state = readState(path, { scope, packageId });
    const now = spec.now || new Date().toISOString();
    validTime(now, "timestamp");

    if (spec.action === "open") {
      if (state.waves[waveId]) fail("wave " + waveId + " already exists");
      const leaves = (spec.leaves || []).map((leaf) => validId(leaf, "leaf"));
      if (!leaves.length) fail("open requires at least one --leaf");
      const seen = new Set();
      for (const leaf of leaves) {
        if (seen.has(leaf)) fail("duplicate leaf " + leaf);
        seen.add(leaf);
      }
      state.waves[waveId] = {
        ...(packageId === null ? {} : { scope, packageId }),
        leaves, state: "open", openedAt: now, started: record(), returned: record(),
      };
      event = "dispatch " + waveId + " opened: " + leaves.join(", ");
    } else {
      const current = state.waves[waveId];
      if (!current) fail("unknown wave " + waveId);
      if (spec.action === "abandon") {
        if (!new Set(["open", "sealed"]).has(current.state)) {
          fail("wave " + waveId + " is " + current.state + "; abandon requires an open or sealed wave");
        }
        current.state = "abandoned";
        current.reason = validReason(spec.reason);
        current.abandonedAt = now;
        event = "dispatch " + waveId + " abandoned: " + current.reason;
      } else if (spec.action === "recover") {
        if (current.state !== "abandoned") {
          fail("wave " + waveId + " is " + current.state + "; recover requires an abandoned wave");
        }
        if (spec.replacementWave === undefined || spec.replacementWave === null) {
          // Without a replacement wave: every leaf returned in this wave before it
          // was abandoned, or in a complete wave of the same scope.
          const recoveredBy = record();
          const missing = [];
          for (const leaf of current.leaves) {
            if (current.returned[leaf]) { recoveredBy[leaf] = waveId; continue; }
            const other = Object.keys(state.waves).sort().find((id) => id !== waveId &&
              state.waves[id].state === "complete" && state.waves[id].returned[leaf]);
            if (other) recoveredBy[leaf] = other;
            else missing.push(leaf);
          }
          if (missing.length) {
            fail("wave " + waveId + " cannot recover without a replacement wave: no return for " + missing.join(", "));
          }
          current.state = "recovered";
          current.recoveredAt = now;
          current.recoveredBy = recoveredBy;
          event = "dispatch " + waveId + " recovered through existing returns";
        } else {
          const replacementWave = validId(spec.replacementWave, "replacement wave");
          if (replacementWave === waveId) fail("wave " + waveId + " cannot recover through itself");
          const replacement = state.waves[replacementWave];
          if (!replacement || replacement.state !== "complete") {
            fail("replacement wave " + replacementWave + " must exist and be complete before recovery");
          }
          const replacementLeaves = new Set(replacement.leaves);
          const missingLeaves = current.leaves.filter((leaf) => !replacementLeaves.has(leaf));
          if (missingLeaves.length) {
            fail("replacement wave " + replacementWave + " does not cover " + missingLeaves.join(", "));
          }
          current.state = "recovered";
          current.recoveredAt = now;
          current.replacementWave = replacementWave;
          event = "dispatch " + waveId + " recovered through " + replacementWave;
        }
      } else if (spec.action === "start") {
        const leaf = validId(spec.leaf, "leaf");
        const handle = validHandle(spec.handle);
        if (current.state !== "open") fail("wave " + waveId + " is " + current.state + "; start requires an open wave");
        if (!current.leaves.includes(leaf)) fail("unknown leaf " + leaf + " in wave " + waveId);
        if (current.started[leaf]) fail("leaf " + leaf + " already started");
        const owner = Object.entries(current.started).find(([, start]) => start.handle === handle);
        if (owner) fail("handle is already assigned to " + owner[0]);
        current.started[leaf] = { handle, at: now };
        event = "dispatch " + waveId + " started " + leaf + " as " + handle;
      } else if (spec.action === "seal") {
        if (current.state !== "open") fail("wave " + waveId + " is " + current.state + "; seal requires an open wave");
        const missing = current.leaves.filter((leaf) => !current.started[leaf]);
        if (missing.length) fail("cannot seal " + waveId + ": missing starts for " + missing.join(", "));
        current.state = "sealed";
        current.sealedAt = now;
        event = "dispatch " + waveId + " sealed";
      } else if (spec.action === "return") {
        const leaf = validId(spec.leaf, "leaf");
        if (current.state !== "sealed") fail("return requires a sealed wave; " + waveId + " is " + current.state);
        if (!current.leaves.includes(leaf)) fail("unknown leaf " + leaf + " in wave " + waveId);
        if (current.returned[leaf]) fail("leaf " + leaf + " already returned");
        current.returned[leaf] = { at: now };
        if (count(current.returned) === current.leaves.length) {
          current.state = "complete";
          current.completedAt = now;
        }
        event = "dispatch " + waveId + " returned " + leaf;
      } else if (spec.action === "restart") {
        // One member of a sealed wave starts again under a new native handle; the
        // old start moves into restarts[leaf].
        const leaf = validId(spec.leaf, "leaf");
        const handle = validHandle(spec.handle);
        if (current.state !== "sealed") fail("restart requires a sealed wave; " + waveId + " is " + current.state);
        if (!current.leaves.includes(leaf)) fail("unknown leaf " + leaf + " in wave " + waveId);
        if (!current.started[leaf]) fail("leaf " + leaf + " was never started in wave " + waveId);
        if (current.returned[leaf]) fail("leaf " + leaf + " already returned; reopen it first");
        const used = [
          ...Object.values(current.started).map((start) => start.handle),
          ...Object.values(current.restarts || {}).flat().map((entry) => entry.handle),
        ];
        if (used.includes(handle)) fail("handle is already used in wave " + waveId);
        if (!current.restarts) current.restarts = record();
        current.restarts[leaf] = [...(current.restarts[leaf] || []),
          { handle: current.started[leaf].handle, startedAt: current.started[leaf].at, at: now }];
        current.started[leaf] = { handle, at: now };
        event = "dispatch " + waveId + " restarted " + leaf + " as " + handle;
      } else if (spec.action === "reopen") {
        // A returned member is reworked: its return moves into reopened[leaf] and
        // the wave is sealed again until the reworked return arrives.
        const leaf = validId(spec.leaf, "leaf");
        const reason = validReason(spec.reason);
        if (current.state !== "sealed" && current.state !== "complete") {
          fail("reopen requires a sealed or complete wave; " + waveId + " is " + current.state);
        }
        if (!current.leaves.includes(leaf)) fail("unknown leaf " + leaf + " in wave " + waveId);
        if (!current.returned[leaf]) fail("leaf " + leaf + " has not returned in wave " + waveId);
        if (!current.reopened) current.reopened = record();
        current.reopened[leaf] = [...(current.reopened[leaf] || []),
          { returnedAt: current.returned[leaf].at, at: now, reason }];
        delete current.returned[leaf];
        current.state = "sealed";
        delete current.completedAt;
        event = "dispatch " + waveId + " reopened " + leaf + ": " + reason;
      } else fail("unknown dispatch action " + spec.action);
    }

    validateState(state, { scope, packageId });
    writeAtomic(path, JSON.stringify(state, null, 2) + "\n", { root });
    return state.waves[waveId];
  });

  await appendStatus(root, scope, new Date().toISOString() + " " + event);
  return wave;
}
