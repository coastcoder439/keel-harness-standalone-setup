// Prozess-Register der Modellwahl (new-harness-process-model-settings, Plan-Schritte 4 und 5).
//
// Einzige Stelle, an der Modellnamen, Modell-Voreinstellungen und die Umgebungsvariablen für
// Modelle stehen. Dashboard (lib/harness/process-models.ts) und harness-core
// (execution/package-executor.mjs) lesen sie von hier; der Test gegen fest verdrahtete Modelle
// (dashboard/test/process-model-hardwire.test.ts, test/process-models.test.js) lässt Modellnamen
// außerhalb dieses Ordners nicht zu. Festlegungen und Gründe: docs/packages/
// new-harness-process-model-settings/design/process-models.md (Punkte 1, 2, 5, 6, 8, 9).
//
// Reines JavaScript ohne Abhängigkeiten außer der Codex-Pin-Quelle.

import { CODEX_EFFORT, CODEX_MODEL } from "../execution/codex-pin.mjs";

export const PROCESS_MODELS_SCHEMA = 1;

/** Installationsmodell für lokale Prozesse, wenn keine Umgebungsvariable gesetzt ist. */
export const DEFAULT_LOCAL_MODEL = "gemma4:latest";

/**
 * Lokale Modelle, die die Karte „Modell des Assistenten“ zum Herunterladen empfiehlt (harness-dashboard-repair
 * Plan-Schritt 41, Gate V9). Nur hier stehen Namen; die Empfehlung nach Arbeitsspeicher liefert
 * lib/companion/system-profile.ts (recommendations.ollama.maxParamsB). `paramsB` = Parameter in Milliarden.
 * Beleg der Namen: `ollama list` auf dem Owner-Rechner (evidence/voice/inventar.md EM-3, 28.09.2026); ein frischer
 * `ollama pull` ist damit nicht belegt.
 */
export const RECOMMENDED_LOCAL_MODELS = Object.freeze([
  Object.freeze({ model: "qwen3.5:4b", paramsB: 4, note: "klein und schnell, läuft auch mit wenig Arbeitsspeicher" }),
  Object.freeze({ model: "gemma4:12b", paramsB: 12, note: "größer und besser, braucht deutlich mehr Arbeitsspeicher" }),
]);

/** Empfohlene Modelle, die nicht größer sind als die Grenze des Systemprofils; größte zuerst. */
export function recommendedLocalModels(maxParamsB) {
  const limit = Number.isFinite(maxParamsB) ? Number(maxParamsB) : 0;
  return RECOMMENDED_LOCAL_MODELS.filter((entry) => entry.paramsB <= limit).sort((a, b) => b.paramsB - a.paramsB);
}

/** Umgebungsvariablen, die ein Modell oder einen Anbieter vorgeben; nur hier gelesen. */
export const MODEL_ENVIRONMENT = Object.freeze({
  localModel: "ACCOUNTABILITY_OLLAMA_MODEL",
  specialistsLocalModel: "ACCOUNTABILITY_COACH_MODEL",
  onlineTranscriptionModel: "KEEL_ONLINE_STT_MODEL",
  onlineSpeechModel: "KEEL_ONLINE_TTS_MODEL",
});

export const PROVIDERS = Object.freeze({
  ollama: Object.freeze({ id: "ollama", label: "Ollama", side: "local", group: "Lokal" }),
  claude: Object.freeze({ id: "claude", label: "Claude", side: "cloud", group: "Cloud" }),
  codex: Object.freeze({ id: "codex", label: "Codex", side: "cloud", group: "Cloud" }),
});
export const PROVIDER_IDS = Object.freeze(Object.keys(PROVIDERS));
export const EFFORTS = Object.freeze(["low", "medium", "high", "max"]);

/** Kontextfenster lokaler Modelle, wie das Chat-Menü sie anbietet (Beschriftung -> num_ctx). */
export const LOCAL_CONTEXTS = Object.freeze({ "8K": 8192, "24K": 24576, "32K": 32768 });
/** Lokale Modelle, die „Denken“ (think) können; Erkennung am Namen wie bisher im Chat-Menü. */
export const LOCAL_THINKING_MODELS = /qwen3|deepseek|gemma3|gemma4/i;

/**
 * Cloud-Modelle je Anbieter. Keine der beiden CLIs liefert eine Modellliste ohne Modellaufruf
 * (design/process-models.md Punkt 5); deshalb steht die Liste hier, jedes Modell mit Beleg.
 * Codex läuft mit der Voreinstellung des Abos (Modell leer); ihr Name ist der Pin aus codex-pin.mjs.
 */
export const CLOUD_MODELS = Object.freeze([
  Object.freeze({ provider: "claude", model: "claude-opus-5-5", label: "Claude Opus 5.5", note: "stärkstes Modell für Bau-Arbeit",
    evidence: "Modelltabelle der Claude-API-Referenz (Stand 24.06.2026) und Modell-ID der Bau-Sitzung 26.09.2026" }),
  Object.freeze({ provider: "claude", model: "claude-opus-5", label: "Claude Opus 5", note: "starkes Modell",
    evidence: "Modelltabelle der Claude-API-Referenz (Stand 24.06.2026); bisherige Chat-Liste Dashboard.tsx:269" }),
  Object.freeze({ provider: "claude", model: "claude-sonnet-5", label: "Claude Sonnet 5", note: "schnell und günstig",
    evidence: "Modelltabelle der Claude-API-Referenz (Stand 24.06.2026); bisherige Chat-Liste Dashboard.tsx:269" }),
  Object.freeze({ provider: "claude", model: "claude-haiku-4-5", label: "Claude Haiku 4.5", note: "kleinstes Modell",
    evidence: "Modelltabelle der Claude-API-Referenz (Stand 24.06.2026)" }),
  Object.freeze({ provider: "codex", model: "", label: CODEX_MODEL, note: "Voreinstellung des Abos",
    evidence: "Codex-Pin harness-core/execution/codex-pin.mjs" }),
]);

export const CODEX_PIN = Object.freeze({ model: CODEX_MODEL, effort: CODEX_EFFORT });

/** Voreinstellung des Prozesses Architekturbilder (Owner 26.09.2026: nur Haiku; Gate A2 in harness-dashboard-repair). */
export const ARCHITECTURE_MAPS_DEFAULT = Object.freeze({ model: "claude-haiku-4-5", effort: "low" });

/** Ein Dashboard-Paket (OWNS unter diesem Pfad) bekommt kein Codex (Owner, 18.09.2026). */
export const CODEX_LOCKED_OWNS_PREFIX = "test-harness/dashboard/";
export const CODEX_LOCK_MESSAGE = "Codex ist für Dashboard-Pakete gesperrt (Owner, 18.09.2026).";

export const CLASSIFIER_MISSING = "Klassifizierer noch nicht angeschlossen";

/**
 * Die Prozessliste aus design/process-models.md Punkt 1. `sides`: erlaubte Seite; `providers`:
 * Anbieter, die der Prozess tatsächlich starten kann; `choosable`: Wahl in der Prozessliste
 * (Sprache wird in „Sprache & Stimme“ gewählt); `auto`: Platz „automatisch“ erlaubt;
 * `fallback`: Regel bei nicht verfügbarem Modell (Punkt 6).
 */
export const PROCESSES = Object.freeze([
  Object.freeze({ id: "chat", label: "Chat", trigger: "Nachricht im Arbeitsraum, im Control Center oder im Sprachgespräch", mode: "onDemand",
    sides: ["local", "cloud"], providers: ["ollama", "claude", "codex"], choosable: true, auto: true,
    fallback: { kind: "stop", label: "Anhalten und melden, kein Ersatzmodell" } }),
  Object.freeze({ id: "specialists", label: "Fachrollen", trigger: "Facharbeit aus einer Chat-Antwort oder direkt aus einem Board", mode: "onDemand",
    sides: ["local", "cloud"], providers: ["ollama", "claude", "codex"], choosable: true, auto: true,
    fallback: { kind: "stop", label: "Anhalten und melden, kein Ersatzmodell; der bisherige Plan bleibt" } }),
  // Cloud für die Mail-Sortierung (design Punkt 1: „nur wenn Mail-Sortierung nur lokal aus ist“) ist
  // nicht angebunden: der Aufruf kennt nur Ollama, und die Mail-Sortierung ist geparkt (P41).
  Object.freeze({ id: "mail-sorting", label: "Mail-Sortierung", trigger: "Server-Start plus 2 Minuten, danach alle 24 Stunden", mode: "passive",
    sides: ["local"], providers: ["ollama"], choosable: true, auto: true,
    fallback: { kind: "rules", label: "Regeln statt Modell, gemeldet; nie Ersatz in der Cloud" } }),
  Object.freeze({ id: "package-execution", label: "Paket-Ausführung", trigger: "Freigegebener Lauf aus dem Arbeitsraum oder package-executor.mjs next", mode: "onDemand",
    sides: ["cloud"], providers: ["claude", "codex"], choosable: true, auto: true,
    fallback: { kind: "stop", label: "Lauf startet nicht, Meldung im Laufstatus; kein anderer Anbieter" } }),
  // Welche Anbieter der Job starten kann, trägt new-harness-architecture-maps hier ein (Punkt 9);
  // vorläufig nur die Claude-CLI (dortiger Aufrufweg mit --plugin-dir). Auslöser nur der Knopf „Jetzt aktualisieren“
  // (Owner-Entscheid 28.09.2026: „nur auf knopfdruck mit angabe wieviel änderungen seit wielange her“).
  Object.freeze({ id: "architecture-maps", label: "Architekturbilder", trigger: "Auf Knopfdruck", mode: "passive",
    sides: ["local", "cloud"], providers: ["claude"], choosable: true, auto: true,
    fallback: { kind: "stop", label: "Lauf wird ausgesetzt und gemeldet; das Bild zeigt die Änderungen seit der letzten Aktualisierung; kein Ersatz" } }),
  Object.freeze({ id: "speech-recognition", label: "Spracherkennung", trigger: "Mikrofonaufnahme", mode: "onDemand",
    sides: ["local", "cloud"], providers: [], choosable: false, auto: false,
    fallback: { kind: "stop", label: "Meldung mit dem nächsten Schritt; kein Wechsel lokal und online" } }),
  Object.freeze({ id: "speech-output", label: "Stimme", trigger: "Vorlesen einer Antwort", mode: "onDemand",
    sides: ["local", "cloud"], providers: [], choosable: false, auto: false,
    fallback: { kind: "stop", label: "Antwort bleibt Text, Meldung; kein Wechsel lokal und online" } }),
]);
export const PROCESS_IDS = Object.freeze(PROCESSES.map((process) => process.id));

export function processDefinition(processId) {
  return PROCESSES.find((process) => process.id === processId) || null;
}

function envValue(env, name) {
  const value = env && typeof env[name] === "string" ? env[name].trim() : "";
  return value || "";
}

/** Lokales Voreinstellungsmodell eines Prozesses (Installationsmodell). */
export function localDefaultModel(processId, env = {}) {
  if (processId === "specialists") return envValue(env, MODEL_ENVIRONMENT.specialistsLocalModel) || DEFAULT_LOCAL_MODEL;
  return envValue(env, MODEL_ENVIRONMENT.localModel) || DEFAULT_LOCAL_MODEL;
}

/**
 * Voreinstellung eines Prozesses ohne gespeicherte Wahl (design Punkt 1). `legacy` ist die
 * bisherige Anbieterwahl aus assistant-runtime.json (Anbieter, Modelle, Denkaufwand, Kontext,
 * Denken) und gilt für Chat und Fachrollen. Ergebnis null: keine Voreinstellung (Prozess startet nicht).
 */
export function defaultChoice(processId, { env = {}, legacy = null } = {}) {
  if (processId === "chat" || processId === "specialists") {
    const provider = legacy && PROVIDERS[legacy.provider] ? legacy.provider : "ollama";
    const saved = legacy && legacy.models && typeof legacy.models[provider] === "string" ? legacy.models[provider].trim() : "";
    const choice = { kind: "model", provider, model: saved || (provider === "ollama" ? localDefaultModel(processId, env) : "") };
    if (legacy && EFFORTS.includes(legacy.effort)) choice.effort = legacy.effort;
    if (provider === "ollama" && legacy && Number.isInteger(legacy.ollamaContext)) choice.context = legacy.ollamaContext;
    if (provider === "ollama" && legacy && typeof legacy.ollamaThink === "boolean") choice.thinking = legacy.ollamaThink;
    return choice;
  }
  if (processId === "mail-sorting") return { kind: "model", provider: "ollama", model: localDefaultModel(processId, env) };
  if (processId === "package-execution") return { kind: "model", provider: "claude", model: "" };
  // Architekturbilder: nur Haiku 4.5, Stufe low (Owner-Zwischennachricht 26.09.2026 „… daer skill das
  // plugin nur mit haiku benutzen …“, PACKAGE.md harness-dashboard-repair Status; Gate A2).
  if (processId === "architecture-maps") return { kind: "model", provider: "claude", model: ARCHITECTURE_MAPS_DEFAULT.model, effort: ARCHITECTURE_MAPS_DEFAULT.effort };
  return null;
}

/** Anzeige eines Modells in Meldungen. */
export function modelLabel(provider, model) {
  const known = CLOUD_MODELS.find((entry) => entry.provider === provider && entry.model === String(model || "").replace(/\[1m\]$/u, ""));
  if (known) return known.label;
  if (!model) return `${PROVIDERS[provider]?.label || provider} (Voreinstellung der CLI)`;
  return `${PROVIDERS[provider]?.label || provider} ${model}`;
}

// --- Sprache (design Punkt 2): Voreinstellungen der Online-Sprache ---------------------------

const ONLINE_DEFAULTS = Object.freeze({
  official: Object.freeze({ transcription: "gpt-transcribe", speech: "gpt-4o-mini-tts" }),
  compatible: Object.freeze({ transcription: "whisper-1", speech: "tts-1" }),
});

/** Voreinstellung der Online-Sprachmodelle; die Umgebungsvariable gewinnt. */
export function onlineSpeechDefaults({ official, env = {} }) {
  const defaults = official ? ONLINE_DEFAULTS.official : ONLINE_DEFAULTS.compatible;
  return {
    transcriptionModel: envValue(env, MODEL_ENVIRONMENT.onlineTranscriptionModel) || defaults.transcription,
    speechModel: envValue(env, MODEL_ENVIRONMENT.onlineSpeechModel) || defaults.speech,
  };
}

/** Standardstimme eines Online-Sprech-Modells. */
export function defaultOnlineVoice(speechModel) {
  return String(speechModel || "").startsWith(ONLINE_DEFAULTS.official.speech) ? "marin" : "alloy";
}

/** Was ein Online-Erkennungsmodell kann: Sprachenliste, Antwortformat, eigene Spracherkennung. */
export function onlineTranscriptionCapabilities(transcriptionModel) {
  const model = String(transcriptionModel || "");
  const languagesList = /^gpt-transcribe(?:-|$)/u.test(model);
  const family4o = model.startsWith("gpt-4o-");
  return {
    languagesList,
    responseFormat: family4o ? "json" : "verbose_json",
    autoLanguage: !/^gpt-4o-(?:mini-)?transcribe(?:-|$)/u.test(model),
  };
}
