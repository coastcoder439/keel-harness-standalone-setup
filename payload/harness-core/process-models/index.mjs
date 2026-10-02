// Gemeinsame Modellwahl je Harness-Prozess (new-harness-process-model-settings).
// Einstieg für harness-core (package-executor.mjs, künftig architecture-maps) und für das
// Dashboard (lib/harness/process-models.ts lädt genau diese Datei).

import { ProcessModelError } from "./catalog.mjs";
import { CLOUD_MODELS, modelLabel } from "./registry.mjs";
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
export function resolveProcessModelForRun({ processId, harnessRoot, env = process.env, owns = [], call = {}, declared = null, now = new Date() }) {
  const dataDir = processModelsDataDirectory({ harnessRoot, env });
  const store = readProcessModelStore(dataDir);
  let resolution;
  try {
    resolution = resolveProcessModelSync({ processId, store, env, owns, call, declared, now });
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

const CLAUDE_EFFORTS = Object.freeze(["low", "medium", "high"]);
const DECLARED_PROVIDERS = Object.freeze(["claude", "codex"]);

function claudeModelIds() {
  return CLOUD_MODELS.filter((entry) => entry.provider === "claude").map((entry) => entry.model);
}

/**
 * Vollständige-ID-Regel (harness-gaps-2026-10-01 R4): ein Claude-Leaf bekommt immer die volle Modell-ID
 * des eingestellten Modells, nie einen Kurznamen oder die Voreinstellung der CLI. Gilt nur hier, nicht
 * in selectProcessModel, damit Übersicht und Architekturbilder unberührt bleiben.
 */
function requireFullClaudeModel(resolution) {
  if (resolution.provider !== "claude") return resolution;
  const model = String(resolution.cliModel || "").replace(/\[1m\]$/u, "");
  if (!model) {
    throw new ProcessModelError(400, "process_model_missing",
      `Claude-Leaves brauchen die volle Modell-ID des eingestellten Modells; eingestellt ist ${modelLabel("claude", "")}. ` +
      "Wähle in den Einstellungen unter Modelle → Paket-Ausführung ein Claude-Modell oder gib --model <volle ID> an.");
  }
  const ids = claudeModelIds();
  if (!ids.includes(model)) {
    throw new ProcessModelError(400, "process_model_not_full_id", `${model} ist keine volle Modell-ID; erlaubt: ${ids.join(", ")}`);
  }
  return resolution;
}

/**
 * Modell der Paket-Ausführung (Plan-Schritt 10, Gate M7): wie resolveProcessModelForRun; ein
 * ausdrückliches --provider/--model wird gegen die Regeln geprüft (Codex-Sperre für Dashboard-Pakete).
 * `declared` ist die Festlegung aus declaredModelChoice (MODEL-Zeile im Leaf oder in GATES.md).
 * Rangfolge: Aufruf-Felder > Leaf-MODEL > GATES.md-MODEL > Einstellung > Voreinstellung.
 */
export function resolvePackageExecutionModel({ harnessRoot, env = process.env, owns = [], call = {}, declared = null, now = new Date() }) {
  return requireFullClaudeModel(resolveProcessModelForRun({ processId: "package-execution", harnessRoot, env, owns, call, declared, now }));
}

function declarationError(file, line, message) {
  return new ProcessModelError(400, "process_model_declaration_invalid", `${file || "(ohne Datei)"}:${line}: MODEL-Zeile ungültig: ${message}`);
}

/**
 * Liest die eine optionale MODEL-Zeile eines Ledgers: in Spalte 1, vor dem ersten Gate, außerhalb von
 * Code-Blöcken, Form `MODEL: <provider> <model> <effort>` (Claude) oder `MODEL: codex` (es gilt der Pin).
 */
function parseModelDeclaration(text, file, source) {
  if (typeof text !== "string" || !text) return null;
  let fence = null;
  let gateSeen = false;
  let found = null;
  const lines = text.split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/u);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && !line.trim().slice(marker[1].length).trim()) fence = null;
      continue;
    }
    if (fence) continue;
    if (/^\s*-\s*\[[ xX]\]\s/u.test(line)) { gateSeen = true; continue; }
    if (!line.startsWith("MODEL:")) continue;
    const number = index + 1;
    if (gateSeen) throw declarationError(file, number, "steht nach dem ersten Gate; sie gehört in den Kopf vor das erste Gate.");
    if (found) throw declarationError(file, number, `zweite MODEL-Zeile; die erste steht in Zeile ${found.line}.`);
    const words = line.slice("MODEL:".length).trim().split(/\s+/u).filter(Boolean);
    const [provider, model, effort, ...rest] = words;
    if (!DECLARED_PROVIDERS.includes(provider)) throw declarationError(file, number, `unbekannter Anbieter „${provider || ""}“; erlaubt: ${DECLARED_PROVIDERS.join(", ")}.`);
    if (provider === "codex") {
      if (words.length > 1) throw declarationError(file, number, "für Codex steht nur „MODEL: codex“ (es gilt der Codex-Pin).");
      found = { provider, model: "", effort: null, source, file, line: number };
      continue;
    }
    if (!model) throw declarationError(file, number, `das Modell fehlt; erlaubt: ${claudeModelIds().join(", ")}.`);
    if (!claudeModelIds().includes(model)) throw declarationError(file, number, `unbekanntes Modell „${model}“; erlaubt: ${claudeModelIds().join(", ")}.`);
    if (!effort) throw declarationError(file, number, `die Stufe fehlt; erlaubt: ${CLAUDE_EFFORTS.join(", ")}.`);
    if (!CLAUDE_EFFORTS.includes(effort)) throw declarationError(file, number, `ungültige Stufe „${effort}“; erlaubt: ${CLAUDE_EFFORTS.join(", ")}.`);
    if (rest.length) throw declarationError(file, number, `überzählige Angabe „${rest.join(" ")}“.`);
    found = { provider, model, effort, source, file, line: number };
  }
  return found;
}

/**
 * Festlegung von Modell und Stufe je Leaf oder Paket (executor-model-effort Schritt 4): prüft beide
 * Texte und liefert die Leaf-Festlegung, sonst die des Pakets (GATES.md), sonst null, jeweils als
 * { provider, model, effort, source: "leaf"|"package", file, line }. Fehler: ProcessModelError
 * process_model_declaration_invalid mit Datei und Zeile.
 */
export function declaredModelChoice({ leafText, leafFile, gatesText, gatesFile } = {}) {
  const leaf = parseModelDeclaration(leafText, leafFile, "leaf");
  const pkg = parseModelDeclaration(gatesText, gatesFile, "package");
  return leaf || pkg || null;
}

/**
 * Zusätzliche Argumente für einen Claude-Worker: das aufgelöste Modell als --model und die Stufe als
 * --effort (design Punkt 8, executor-model-effort Schritt 3). Ohne Stufe kein --effort.
 */
export function claudeWorkerModelArgs(delegation) {
  if (!delegation || delegation.provider !== "claude" || typeof delegation.model !== "string" || !delegation.model) return [];
  const effort = delegation.effort;
  if (effort === null || effort === undefined || effort === "") return ["--model", delegation.model];
  if (!CLAUDE_EFFORTS.includes(effort)) throw new ProcessModelError(400, "process_model_choice_invalid", `Der Denkaufwand „${String(effort).slice(0, 20)}“ ist für Claude ungültig; erlaubt: ${CLAUDE_EFFORTS.join(", ")}.`);
  return ["--model", delegation.model, "--effort", effort];
}
