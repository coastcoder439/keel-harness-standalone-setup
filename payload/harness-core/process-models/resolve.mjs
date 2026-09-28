// Auflösung mit sichtbarem Rückfall (Plan-Schritt 6, Gate M3) und Platz „automatisch“
// (Plan-Schritt 7, Gate M4). Vertrag: design/process-models.md Punkte 6, 7 und 10.
//
// Jeder Prozess fragt bei jedem Aufruf neu. Ergebnis: { processId, provider, model, cliModel,
// effort?, context?, thinking?, side, source: setting|default|auto|call|fallback, reason?,
// fallback? }. Ist das gewählte Modell nicht verfügbar, greift die Rückfallregel des Prozesses:
// „stop“ wirft ProcessModelUnavailableError mit Grund und Zeit, „rules“ liefert source
// „fallback“ mit to „Regeln“. Nie wird still ein anderes Modell genommen.

import { ProcessModelError, processRuleReason, validateChoice } from "./catalog.mjs";
import { CLASSIFIER_MISSING, CODEX_PIN, PROVIDERS, defaultChoice, modelLabel, processDefinition } from "./registry.mjs";

export class ProcessModelUnavailableError extends ProcessModelError {
  constructor(message, { processId, fallback, code = "process_model_unavailable", status = 503 }) {
    super(status, code, message, { processId, fallback });
    this.name = "ProcessModelUnavailableError";
  }
}

function choiceLabel(choice) {
  return choice ? modelLabel(choice.provider, choice.model) : null;
}

/**
 * Welche Wahl gilt (ohne Verfügbarkeit): ausdrücklich im Aufruf, gespeichert, automatisch oder
 * Voreinstellung. `call` = { provider?, model?, effort? } (nur Paket-Ausführung);
 * `owns` = OWNS-Pfade des Leafs (Codex-Sperre).
 */
export function selectProcessModel({ processId, store, env = {}, legacy = null, owns, call }) {
  const definition = processDefinition(processId);
  if (!definition) throw new ProcessModelError(404, "process_model_unknown", `Unbekannter Prozess „${String(processId).slice(0, 60)}“.`);
  if (!definition.choosable) throw new ProcessModelError(400, "process_model_not_choosable", `${definition.label} wird unter Technik & Stimme gewählt.`);
  const stored = store?.choices?.[processId] || null;
  const fallbackDefault = defaultChoice(processId, { env, legacy });
  if (call && (call.provider || call.model || call.effort)) {
    const base = stored?.kind === "model" ? stored : fallbackDefault;
    const provider = call.provider || base?.provider;
    if (!provider) throw new ProcessModelError(400, "process_model_choice_invalid", `${definition.label}: im Aufruf fehlt der Anbieter.`);
    const rule = processRuleReason(processId, provider, { owns });
    if (rule) throw new ProcessModelError(403, "process_model_not_allowed", rule, { processId });
    const choice = validateChoice(processId, { kind: "model", provider, model: call.model ?? (base?.provider === provider ? base.model : ""), ...(call.effort ? { effort: call.effort } : {}) }, { owns });
    return { processId, definition, choice, source: "call", reason: "im Aufruf festgelegt" };
  }
  if (stored?.kind === "auto") {
    return { processId, definition, choice: fallbackDefault, source: "auto", autoRequested: true,
      reason: fallbackDefault ? `${CLASSIFIER_MISSING}; es gilt die Voreinstellung` : CLASSIFIER_MISSING,
      ...(fallbackDefault ? {} : { unresolvable: CLASSIFIER_MISSING }) };
  }
  if (stored?.kind === "model") {
    const rule = processRuleReason(processId, stored.provider, { owns });
    return { processId, definition, choice: stored, source: "setting", ...(rule ? { ruleReason: rule } : {}) };
  }
  if (!fallbackDefault) {
    return { processId, definition, choice: null, source: "default", unresolvable: `Keine Modellwahl: ${definition.label} startet erst nach einer ausdrücklichen Wahl` };
  }
  const rule = processRuleReason(processId, fallbackDefault.provider, { owns });
  return { processId, definition, choice: fallbackDefault, source: "default", ...(rule ? { ruleReason: rule } : {}) };
}

function resolved(selection) {
  const { choice, processId } = selection;
  const side = PROVIDERS[choice.provider].side;
  let model = choice.model;
  let effort = choice.effort;
  let cliModel = model;
  if (choice.provider === "codex" && processId === "package-execution") {
    // Delegierte Codex-Paketarbeit läuft nur mit dem Pin (codex-pin.mjs, design Punkt 8).
    model = CODEX_PIN.model; cliModel = CODEX_PIN.model; effort = CODEX_PIN.effort;
  }
  if (choice.provider === "claude") {
    if (effort === "max") effort = "high";
    if (choice.context === "1M" && model && !model.endsWith("[1m]")) cliModel = `${model}[1m]`;
  }
  return {
    processId, provider: choice.provider, model, cliModel, side, source: selection.source,
    label: modelLabel(choice.provider, model),
    ...(effort ? { effort } : {}),
    ...(choice.context !== undefined ? { context: choice.context } : {}),
    ...(choice.thinking !== undefined ? { thinking: choice.thinking } : {}),
    ...(selection.reason ? { reason: selection.reason } : {}),
    ...(selection.classifierId ? { classifierId: selection.classifierId } : {}),
  };
}

/**
 * Wendet Verfügbarkeit und Rückfallregel an. `availability` = { available, reason?, code? } für
 * die gewählte Wahl (vom Aufrufer gemessen; ohne Angabe gilt „verfügbar“).
 */
export function finalizeProcessModel(selection, availability = { available: true }, { now = new Date() } = {}) {
  const at = now.toISOString();
  const { definition } = selection;
  const reason = selection.unresolvable || selection.ruleReason || (availability.available === false ? availability.reason || "nicht verfügbar" : "");
  if (!reason) return resolved(selection);
  const from = choiceLabel(selection.choice);
  if (definition.fallback.kind === "rules") {
    return {
      processId: selection.processId, provider: null, model: null, cliModel: null, side: "local", source: "fallback",
      label: "Regeln", reason, fallback: { from, to: "Regeln", reason, at },
    };
  }
  const fallback = { from, to: null, reason, at };
  const text = from
    ? `${from} ist für ${definition.label} nicht verfügbar: ${reason}. Wähle ein anderes Modell oder prüfe die Anmeldung; es wird kein Ersatzmodell verwendet.`
    : `${definition.label}: ${reason}. Wähle in den Einstellungen unter „Modelle“ ein Modell; es wird kein Ersatzmodell verwendet.`;
  throw new ProcessModelUnavailableError(text,
    { processId: selection.processId, fallback, ...(availability.code ? { code: availability.code } : {}), ...(availability.status ? { status: availability.status } : {}) });
}

/** Synchrone Auflösung ohne Klassifizierer (harness-core-Prozesse). */
export function resolveProcessModelSync(options) {
  return finalizeProcessModel(selectProcessModel(options), options.availability, { now: options.now });
}

// --- Platz „automatisch“: Klassifizierer-Schnittstelle (design Punkt 7) -----------------------

let connectedClassifier = null;

/**
 * Schließt genau einen Klassifizierer an: { id, classify(input, signal) -> Promise<output> } mit
 * input = { processId, task, candidates } und output = { provider, model, effort?, reason }.
 * Liefert eine Funktion zum Abmelden.
 */
export function registerProcessModelClassifier(classifier) {
  if (!classifier || typeof classifier.classify !== "function" || typeof classifier.id !== "string" || !classifier.id.trim()) {
    throw new ProcessModelError(400, "process_model_classifier_invalid", "Ein Klassifizierer braucht eine Kennung und eine Funktion classify.");
  }
  if (connectedClassifier) throw new ProcessModelError(409, "process_model_classifier_exists", `Es ist schon ein Klassifizierer angeschlossen (${connectedClassifier.id}).`);
  connectedClassifier = classifier;
  return () => { if (connectedClassifier === classifier) connectedClassifier = null; };
}

export function connectedProcessModelClassifier() {
  return connectedClassifier;
}

export const CLASSIFIER_TIMEOUT_MS = 2_000;

async function classify(selection, { task, loadCandidates, owns, timeoutMs }) {
  const classifier = connectedClassifier;
  const candidates = (await loadCandidates()).filter((entry) => entry.available && !processRuleReason(selection.processId, entry.providerId, { owns }));
  const controller = new AbortController();
  let timer;
  try {
    const output = await Promise.race([
      Promise.resolve().then(() => classifier.classify({ processId: selection.processId, task: task || {}, candidates }, controller.signal)),
      new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error("timeout")); }, timeoutMs); }),
    ]);
    const match = candidates.find((entry) => entry.providerId === output?.provider && entry.model === String(output?.model ?? ""));
    if (!match) return { ...selection, reason: `Antwort des Klassifizierers ${classifier.id} verworfen (kein verfügbares Katalogmodell); es gilt die Voreinstellung` };
    const choice = { kind: "model", provider: match.providerId, model: match.model, ...(output.effort ? { effort: output.effort } : {}) };
    return { ...selection, choice, autoRequested: false, unresolvable: undefined, ruleReason: undefined,
      reason: String(output.reason || "vom Klassifizierer gewählt").slice(0, 300), classifierId: classifier.id };
  } catch (error) {
    const why = error?.message === "timeout" ? `Zeitüberschreitung nach ${timeoutMs} ms` : "Fehler";
    return { ...selection, reason: `Klassifizierer ${classifier.id}: ${why}; es gilt die Voreinstellung` };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Vollständige Auflösung. `availability(choice)` misst die Verfügbarkeit der gewählten Wahl;
 * `loadCandidates()` liefert den Katalog nur, wenn ein Klassifizierer angeschlossen ist.
 */
export async function resolveProcessModel(options) {
  let selection = selectProcessModel(options);
  if (selection.autoRequested && connectedClassifier && options.loadCandidates) {
    selection = await classify(selection, { task: options.task, loadCandidates: options.loadCandidates, owns: options.owns, timeoutMs: options.timeoutMs ?? CLASSIFIER_TIMEOUT_MS });
  }
  const availability = selection.choice && !selection.unresolvable && !selection.ruleReason && options.availability
    ? await options.availability(selection.choice)
    : { available: true };
  return finalizeProcessModel(selection, availability, { now: options.now });
}

/** Fingerabdruck der Wahl eines Prozesses: ändert sie sich während eines Aufrufs, gilt die Antwort nicht. */
export function choiceFingerprint(store, processId) {
  return JSON.stringify(store?.choices?.[processId] ?? null);
}
