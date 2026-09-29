// Modellkatalog wie im Chat (Plan-Schritt 4, Gate M1) und Prüfung einer Wahl (Plan-Schritt 5, Gate M2).
//
// Der Katalog hat die Form, die das Chat-Menü liest (AiModel in dashboard/components/ui/
// ai-prompt-input.tsx: id, label, description, group Lokal/Cloud, provider, efforts, contexts,
// supportsThinking, disabled), dazu je Eintrag providerId, model, side, available und reason.
// Angeboten wird nur, was erkannt ist: lokale Modelle aus Ollama, Cloud-Modelle nur bei
// installierter UND angemeldeter CLI. Nicht Verfügbares bleibt mit Grund sichtbar.

import {
  CLASSIFIER_MISSING, CLOUD_MODELS, CODEX_LOCK_MESSAGE, CODEX_LOCKED_OWNS_PREFIX, EFFORTS,
  LOCAL_CONTEXTS, LOCAL_THINKING_MODELS, PROVIDERS, PROVIDER_IDS, processDefinition,
} from "./registry.mjs";

export class ProcessModelError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    this.name = "ProcessModelError";
    this.status = status;
    this.code = code;
    Object.assign(this, details);
  }
}

const SIDE_LABEL = { local: "lokal", cloud: "Cloud" };

function localEntry(name, { available = true, reason = "", description } = {}) {
  return {
    id: `ollama:${name}`, label: name || "Ollama", description: description || (available ? "Ollama auf diesem Rechner" : reason),
    group: PROVIDERS.ollama.group, provider: PROVIDERS.ollama.label, providerId: "ollama", model: name, side: "local",
    efforts: ["high", "medium", "low"], contexts: Object.keys(LOCAL_CONTEXTS), supportsFast: false,
    supportsThinking: LOCAL_THINKING_MODELS.test(name), defaultEffort: "medium", defaultContext: "32K",
    disabled: !available, available, reason: available ? "" : reason,
  };
}

function cloudReason(provider, login, expired) {
  const label = PROVIDERS[provider].label;
  if (!login || !login.installed) return login?.reason || `${label} CLI nicht installiert`;
  if (expired) return "Anmeldung abgelaufen – neu anmelden";
  if (login.signedIn === false) return `Bei ${label} nicht angemeldet`;
  if (login.signedIn !== true) return login.reason || `Anmeldung bei ${label} konnte nicht geprüft werden`;
  return "";
}

/**
 * detection = {
 *   ollama: { reachable, models: string[], reason? },
 *   logins: { claude: { installed, signedIn: true|false|null, reason? }, codex: {…} },
 *   expired: { claude?: iso, codex?: iso },
 *   keepLocal?: string[]   // gewählte lokale Modelle, die in Ollama fehlen (bleiben mit Grund sichtbar)
 * }
 */
export function buildModelCatalog(detection = {}) {
  const ollama = detection.ollama || { reachable: false, models: [] };
  const entries = [];
  const names = [...new Set((ollama.models || []).map((item) => String(typeof item === "string" ? item : item?.name || "").trim()).filter(Boolean))];
  if (!ollama.reachable) entries.push(localEntry("", { available: false, reason: ollama.reason || "Ollama nicht erreichbar" }));
  else if (!names.length) entries.push(localEntry("", { available: false, reason: "Kein lokales Modell installiert" }));
  for (const name of names) entries.push(localEntry(name));
  for (const name of new Set(detection.keepLocal || [])) {
    if (name && !names.includes(name)) entries.push(localEntry(name, { available: false, reason: ollama.reachable ? "Modell in Ollama nicht vorhanden" : ollama.reason || "Ollama nicht erreichbar" }));
  }
  for (const item of CLOUD_MODELS) {
    const reason = cloudReason(item.provider, detection.logins?.[item.provider], detection.expired?.[item.provider]);
    const codex = item.provider === "codex";
    entries.push({
      id: `${item.provider}:${item.model}`, label: item.label,
      description: reason || `${PROVIDERS[item.provider].label} CLI, ${item.note}`,
      group: PROVIDERS[item.provider].group, provider: PROVIDERS[item.provider].label, providerId: item.provider, model: item.model, side: "cloud",
      efforts: codex ? ["max", "high", "medium", "low"] : ["high", "medium", "low"],
      ...(codex ? {} : { contexts: ["200K", "1M"], defaultContext: "200K" }),
      supportsFast: false, supportsThinking: false, defaultEffort: codex ? "max" : "medium",
      disabled: Boolean(reason), available: !reason, reason, evidence: item.evidence,
    });
  }
  return entries;
}

export function codexLockedFor(owns) {
  return Array.isArray(owns) && owns.some((pattern) => String(pattern).replaceAll("\\", "/").replace(/^\.\//u, "").startsWith(CODEX_LOCKED_OWNS_PREFIX));
}

/** Grund, warum ein Anbieter/Seite für den Prozess nicht erlaubt ist, sonst "". */
export function processRuleReason(processId, provider, { owns } = {}) {
  const definition = processDefinition(processId);
  if (!definition) return "Unbekannter Prozess";
  if (!definition.choosable) return "Wird unter Sprache & Stimme gewählt";
  const side = PROVIDERS[provider]?.side;
  if (!side) return "Unbekannter Anbieter";
  if (!definition.sides.includes(side)) return `Für diesen Prozess nicht erlaubt: nur ${definition.sides.map((item) => SIDE_LABEL[item]).join(" und ")}`;
  if (!definition.providers.includes(provider)) return `${definition.label} kann ${PROVIDERS[provider].label} nicht starten`;
  if (processId === "package-execution" && provider === "codex" && codexLockedFor(owns)) return CODEX_LOCK_MESSAGE;
  return "";
}

/** Der Katalog aus Sicht eines Prozesses: Einträge, die der Prozess nicht nutzen darf, sind mit Grund gesperrt. */
export function catalogForProcess(catalog, processId, options = {}) {
  return catalog.map((entry) => {
    const rule = processRuleReason(processId, entry.providerId, options);
    if (!rule) return entry;
    return { ...entry, disabled: true, available: false, reason: rule, description: rule };
  });
}

function invalid(message) {
  throw new ProcessModelError(400, "process_model_choice_invalid", message);
}

function cleanModel(value) {
  if (typeof value !== "string" || value.length > 200 || /[\r\n\0]/u.test(value) || value.trim().startsWith("-")) invalid("Das Modell ist ungültig.");
  return value.trim();
}

/**
 * Prüft die Form einer Wahl und die Regeln des Prozesses; mit `catalog` zusätzlich, dass die
 * Wahl ein verfügbarer, für den Prozess erlaubter Katalogeintrag ist. Liefert die bereinigte Wahl.
 */
export function validateChoice(processId, choice, { catalog, owns } = {}) {
  const definition = processDefinition(processId);
  if (!definition) throw new ProcessModelError(404, "process_model_unknown", `Unbekannter Prozess „${String(processId).slice(0, 60)}“.`);
  if (!definition.choosable) invalid(`${definition.label} wird unter Sprache & Stimme gewählt, nicht in der Prozessliste.`);
  if (!choice || typeof choice !== "object" || Array.isArray(choice)) invalid("Die Modellwahl fehlt.");
  if (choice.kind === "auto") {
    if (!definition.auto) invalid(`Für ${definition.label} gibt es „automatisch“ nicht.`);
    return { kind: "auto" };
  }
  if (choice.kind !== "model") invalid("Die Modellwahl ist weder ein Modell noch „automatisch“.");
  if (!PROVIDER_IDS.includes(choice.provider)) invalid("Unbekannter Anbieter.");
  const clean = { kind: "model", provider: choice.provider, model: cleanModel(choice.model ?? "") };
  if (choice.effort !== undefined) {
    if (!EFFORTS.includes(choice.effort)) invalid("Der Denkaufwand ist ungültig.");
    clean.effort = choice.effort;
  }
  if (choice.context !== undefined) {
    if (choice.provider === "ollama") {
      if (!Number.isInteger(choice.context) || choice.context < 4096 || choice.context > 262144) invalid("Das Kontextfenster muss eine ganze Zahl zwischen 4096 und 262144 sein.");
    } else if (!(choice.provider === "claude" && ["200K", "1M"].includes(choice.context))) invalid("Das Kontextfenster passt nicht zum Anbieter.");
    clean.context = choice.context;
  }
  if (choice.thinking !== undefined) {
    if (typeof choice.thinking !== "boolean") invalid("„Denken“ muss an oder aus sein.");
    clean.thinking = choice.thinking;
  }
  const rule = processRuleReason(processId, clean.provider, { owns });
  if (rule) invalid(`${definition.label}: ${rule}.`);
  if (catalog) {
    if (clean.effort === "max" && clean.provider !== "codex") invalid("Der Denkaufwand „max“ gibt es nur für Codex.");
    const entry = catalogForProcess(catalog, processId, { owns }).find((item) => item.id === `${clean.provider}:${clean.model.replace(/\[1m\]$/u, "")}`);
    if (!entry) invalid(`${PROVIDERS[clean.provider].label} ${clean.model || "(Voreinstellung)"} steht nicht im Modellkatalog.`);
    if (!entry.available) invalid(`${entry.label} ist nicht wählbar: ${entry.reason}.`);
  }
  return clean;
}

export { CLASSIFIER_MISSING };
