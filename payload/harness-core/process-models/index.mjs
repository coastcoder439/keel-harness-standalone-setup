// Gemeinsame Modellwahl je Harness-Prozess (new-harness-process-model-settings).
// Einstieg für harness-core (package-executor.mjs, künftig architecture-maps) und für das
// Dashboard (lib/harness/process-models.ts lädt genau diese Datei).

import { resolveProcessModelSync } from "./resolve.mjs";
import { appendAutoResolution, processModelsDataDirectory, readProcessModelStore, recordProcessModelFallback } from "./store.mjs";

export * from "./registry.mjs";
export * from "./catalog.mjs";
export * from "./store.mjs";
export * from "./resolve.mjs";
export * from "./login.mjs";

/**
 * Hält einen Rückfall fest. Ein Schreibfehler verdeckt nie den eigentlichen Grund des Abbruchs; er
 * bleibt still, weil die CLI ihren Fehler als eine JSON-Zeile auf stderr meldet.
 */
function keepFallback(dataDir, processId, fallback) {
  try { recordProcessModelFallback(dataDir, processId, fallback); }
  catch { /* Die Meldung des Abbruchs trägt Grund und Zeit weiter. */ }
}

/**
 * Synchrone Auflösung für harness-core-Prozesse, die als eigener Node-Prozess laufen (Paket-Ausführung,
 * künftig der Architektur-Job, Gate J5): liest die Wahl aus process-models.json der Installation,
 * speichert jeden Rückfall mit Grund und Zeit in `lastFallback` (design/process-models.md Punkt 6),
 * bevor der Fehler weitergeht, und protokolliert „automatisch“. Ein Klassifizierer wird hier nie
 * gefragt: er ist nur im Dashboard-Prozess angeschlossen (design Punkt 7, Befund PMS-N18); es gilt
 * die Platzhalter-Regel. Wirft ProcessModelError/-UnavailableError.
 */
export function resolveProcessModelForRun({ processId, harnessRoot, env = process.env, owns = [], call = {}, now = new Date() }) {
  const dataDir = processModelsDataDirectory({ harnessRoot, env });
  const store = readProcessModelStore(dataDir);
  let resolution;
  try {
    resolution = resolveProcessModelSync({ processId, store, env, owns, call, now });
  } catch (error) {
    if (error?.name === "ProcessModelUnavailableError" && error.fallback) keepFallback(dataDir, processId, error.fallback);
    throw error;
  }
  if (resolution.fallback) keepFallback(dataDir, processId, resolution.fallback);
  if (resolution.source === "auto") {
    try { appendAutoResolution(dataDir, { at: now.toISOString(), processId, task: {}, provider: resolution.provider, model: resolution.model, reason: resolution.reason, classifierId: null }); }
    catch { /* Das Protokoll ist Messgrundlage, kein Grund, den Lauf nicht zu starten. */ }
  }
  return resolution;
}

/**
 * Modell der Paket-Ausführung (Plan-Schritt 10, Gate M7): wie resolveProcessModelForRun; ein
 * ausdrückliches --provider/--model wird gegen die Regeln geprüft (Codex-Sperre für Dashboard-Pakete).
 */
export function resolvePackageExecutionModel({ harnessRoot, env = process.env, owns = [], call = {}, now = new Date() }) {
  return resolveProcessModelForRun({ processId: "package-execution", harnessRoot, env, owns, call, now });
}

/** Zusätzliche Argumente für einen Claude-Worker: das aufgelöste Modell als --model (design Punkt 8). */
export function claudeWorkerModelArgs(delegation) {
  return delegation && delegation.provider === "claude" && typeof delegation.model === "string" && delegation.model ? ["--model", delegation.model] : [];
}
