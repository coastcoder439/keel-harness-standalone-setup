// Einstellungsspeicher je Prozess (Plan-Schritt 5, Gate M2): process-models.json im Datenordner
// der Installation, neben assistant-runtime.json (design/process-models.md Punkt 3).
//
// Form: { schema, revision, choices: { <processId>: { kind: "model", provider, model, effort?,
// context?, thinking? } | { kind: "auto" } }, lastFallback: { <processId>: { at, from, to, reason } },
// expiredLogins: { claude?: iso, codex?: iso } }. Ein fehlender Eintrag heißt „Voreinstellung“.
// Schreiben unter Sperre mit atomarem Ersetzen; nur Änderungen der Wahl erhöhen die Revision.

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { replaceFileSync } from "../execution/atomic-file.mjs";
import { ProcessModelError } from "./catalog.mjs";
import { PROCESS_IDS, PROCESS_MODELS_SCHEMA, PROVIDER_IDS } from "./registry.mjs";

export const STORE_FILE = "process-models.json";
export const AUTO_LOG_FILE = "process-models-auto.jsonl";
export const AUTO_LOG_LIMIT = 1000;

/**
 * Datenordner mit derselben Regel wie das Dashboard (lib/accountability/harness.ts,
 * accountabilityDataDirectory und accountabilityDataDirectoryForHarnessRoot).
 */
export function processModelsDataDirectory({ harnessRoot, env = process.env, platform = process.platform, home = os.homedir() }) {
  const direct = typeof env.ACCOUNTABILITY_DATA_DIR === "string" ? env.ACCOUNTABILITY_DATA_DIR.trim() : "";
  if (direct) return path.resolve(direct);
  const base = env.KEEL_ACCOUNTABILITY_DATA_DIR
    ? path.resolve(env.KEEL_ACCOUNTABILITY_DATA_DIR)
    : platform === "win32"
      ? path.join(env.LOCALAPPDATA || path.join(home, "AppData", "Local"), "KeelHarness")
      : path.join(env.XDG_DATA_HOME || path.join(home, ".local", "share"), "keel-harness");
  const key = crypto.createHash("sha256").update(path.resolve(harnessRoot)).digest("hex").slice(0, 16);
  return path.join(base, "accountability", key);
}

const empty = () => ({ schema: PROCESS_MODELS_SCHEMA, revision: 0, choices: {}, lastFallback: {}, expiredLogins: {} });

function unreadable(cause) {
  const error = new ProcessModelError(500, "process_models_invalid", "Die gespeicherte Modellwahl je Prozess ist nicht lesbar; es wird kein Ersatzmodell verwendet.");
  error.cause = cause;
  return error;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function storedChoice(value) {
  if (!isRecord(value)) return null;
  if (value.kind === "auto") return { kind: "auto" };
  if (value.kind !== "model" || !PROVIDER_IDS.includes(value.provider) || typeof value.model !== "string") return null;
  const choice = { kind: "model", provider: value.provider, model: value.model };
  for (const key of ["effort", "context", "thinking"]) if (value[key] !== undefined) choice[key] = value[key];
  return choice;
}

export function readProcessModelStore(dataDir) {
  let raw;
  try { raw = fs.readFileSync(path.join(dataDir, STORE_FILE), "utf8"); }
  catch (error) { if (error?.code === "ENOENT") return empty(); throw unreadable(error); }
  let value;
  try { value = JSON.parse(raw); } catch (error) { throw unreadable(error); }
  if (!isRecord(value) || value.schema !== PROCESS_MODELS_SCHEMA || !Number.isSafeInteger(value.revision) || value.revision < 0 || !isRecord(value.choices)) throw unreadable(new Error("shape"));
  const store = empty();
  store.revision = value.revision;
  for (const id of PROCESS_IDS) {
    const choice = storedChoice(value.choices[id]);
    if (choice) store.choices[id] = choice;
    const fallback = isRecord(value.lastFallback) ? value.lastFallback[id] : undefined;
    if (isRecord(fallback) && typeof fallback.at === "string" && typeof fallback.reason === "string") {
      store.lastFallback[id] = { at: fallback.at, from: typeof fallback.from === "string" ? fallback.from : null, to: typeof fallback.to === "string" ? fallback.to : null, reason: fallback.reason };
    }
  }
  if (isRecord(value.expiredLogins)) for (const id of ["claude", "codex"]) if (typeof value.expiredLogins[id] === "string") store.expiredLogins[id] = value.expiredLogins[id];
  return store;
}

const sleepCell = new Int32Array(new SharedArrayBuffer(4));

function acquire(lock) {
  const deadline = Date.now() + 2_000;
  for (;;) {
    try {
      const handle = fs.openSync(lock, "wx", 0o600);
      fs.writeSync(handle, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
      return handle;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
    let stale = false;
    try {
      const owner = JSON.parse(fs.readFileSync(lock, "utf8"));
      if (!Number.isSafeInteger(owner?.pid) || owner.pid <= 0) throw new Error("incomplete");
      try { process.kill(owner.pid, 0); } catch (probe) { stale = probe?.code === "ESRCH"; }
    } catch {
      const stat = fs.statSync(lock, { throwIfNoEntry: false });
      stale = Boolean(stat && Date.now() - stat.mtimeMs > 120_000);
    }
    if (stale) { try { fs.unlinkSync(lock); } catch { /* another writer took it */ } continue; }
    if (Date.now() > deadline) throw new ProcessModelError(409, "process_models_busy", "Die Modellwahl wird gerade geändert. Bitte neu laden.");
    Atomics.wait(sleepCell, 0, 0, 25);
  }
}

/** Ändert den Speicher unter Sperre. `mutate(store)` ändert die Kopie; `bump` erhöht die Revision. */
export function updateProcessModelStore(dataDir, mutate, { expectedRevision, bump = true } = {}) {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const file = path.join(dataDir, STORE_FILE);
  const lock = `${file}.lock`;
  const handle = acquire(lock);
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    const current = readProcessModelStore(dataDir);
    if (expectedRevision !== undefined && current.revision !== expectedRevision) {
      throw new ProcessModelError(409, "process_models_revision_conflict", "Die Modellwahl wurde inzwischen geändert. Bitte neu laden.");
    }
    const next = structuredClone(current);
    mutate(next);
    if (bump) next.revision = current.revision + 1;
    fs.writeFileSync(temporary, JSON.stringify(next, null, 2), { encoding: "utf8", mode: 0o600 });
    replaceFileSync(temporary, file);
    return next;
  } finally {
    fs.closeSync(handle);
    try { fs.unlinkSync(temporary); } catch { /* already renamed */ }
    try { fs.unlinkSync(lock); } catch { /* released */ }
  }
}

/** Setzt (Wahl) oder entfernt (null) die Wahl mehrerer Prozesse; bereits geprüfte Werte. */
export function saveProcessModelChoices(dataDir, updates, { expectedRevision } = {}) {
  return updateProcessModelStore(dataDir, (store) => {
    for (const [processId, choice] of Object.entries(updates)) {
      if (!PROCESS_IDS.includes(processId)) throw new ProcessModelError(404, "process_model_unknown", `Unbekannter Prozess „${processId}“.`);
      if (choice === null) delete store.choices[processId];
      else store.choices[processId] = choice;
    }
  }, { expectedRevision });
}

/** Hält den letzten Rückfall eines Prozesses fest (ändert die Revision nicht). */
export function recordProcessModelFallback(dataDir, processId, fallback) {
  return updateProcessModelStore(dataDir, (store) => {
    store.lastFallback[processId] = { at: fallback.at, from: fallback.from ?? null, to: fallback.to ?? null, reason: String(fallback.reason).slice(0, 500) };
  }, { bump: false });
}

export function markProviderLoginExpired(dataDir, provider, at) {
  return updateProcessModelStore(dataDir, (store) => { store.expiredLogins[provider] = at; }, { bump: false });
}

export function clearProviderLoginExpired(dataDir, provider) {
  if (!readProcessModelStore(dataDir).expiredLogins[provider]) return;
  updateProcessModelStore(dataDir, (store) => { delete store.expiredLogins[provider]; }, { bump: false });
}

/**
 * Protokoll jeder automatischen Auflösung (design Punkt 7): Zeit, Prozess, Aufgabenkontext ohne
 * Inhalte außer `domain`, gewähltes Modell, Grund, Klassifizierer; die letzten 1000 Einträge.
 */
export function appendAutoResolution(dataDir, entry) {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const file = path.join(dataDir, AUTO_LOG_FILE);
  const line = JSON.stringify({
    at: entry.at, processId: entry.processId,
    task: entry.task?.domain ? { domain: String(entry.task.domain).slice(0, 40) } : {},
    provider: entry.provider ?? null, model: entry.model ?? null, reason: String(entry.reason || "").slice(0, 300), classifierId: entry.classifierId ?? null,
  });
  let lines = [];
  try { lines = fs.readFileSync(file, "utf8").split(/\r?\n/u).filter(Boolean); } catch (error) { if (error?.code !== "ENOENT") throw error; }
  lines.push(line);
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, lines.slice(-AUTO_LOG_LIMIT).join("\n") + "\n", { encoding: "utf8", mode: 0o600 });
  try { replaceFileSync(temporary, file); } finally { try { fs.unlinkSync(temporary); } catch { /* renamed */ } }
}
