// Eine Untergrenze für freien Arbeitsspeicher, für alle (P13, C2).
//
// Vorher: fünf getrennte, fest eingebaute Schwellen (Stimme 3 GB, Voice-Agent 4 GB, Ollama 4 GB, Architekturbilder
// 4 GB, Modellprüfung) und höchstens 8 Agenten je Welle. Jetzt gilt ein Wert: Gestartet wird nur, wenn danach der
// eingestellte freie Arbeitsspeicher bleibt (Owner 16:08: „Vier Gigabyte oder auch zwei Gigabyte … in den
// Einstellungen vielleicht selber einstellen“).
//
// Die Untergrenze steht in <harnessRoot>/runtime/voice/system-profile.json unter overrides.freeRamFloorGb und wird
// über die vorhandenen Helfer von voice/system-profile.mjs gelesen (readProfile). Erlaubt sind 2 bis 4 GB
// (Kommazahlen erlaubt); ein Wert außerhalb, kein Wert, `overrides: null` oder keine Datei ergeben die Vorgabe 4.
// Die Einstellung in der Karte „Leistung“ baut das Dashboard-Paket; hier liegen der Wert, das Lesen und die Anwendung.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { readProfile } from "../../voice/system-profile.mjs";

export const DEFAULT_FLOOR_GB = 4;
export const FLOOR_RANGE_GB = Object.freeze({ min: 2, max: 4 });
/** Pauschalbedarf eines Agenten in GB (Auftrag P13: 1 GB je Agent). */
export const AGENT_NEED_GB = 1;
const GIB = 1024 ** 3;
const TREE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function voiceEnv(harnessRoot, env) {
  if (harnessRoot === undefined || harnessRoot === null || harnessRoot === "") return env;
  return { ...env, KEEL_VOICE_ROOT: path.join(path.resolve(String(harnessRoot)), "runtime", "voice") };
}

/** Ob ein Wert als Untergrenze taugt: eine endliche Zahl von 2 bis 4. */
export function validFloorGb(value) {
  return typeof value === "number" && Number.isFinite(value) &&
    value >= FLOOR_RANGE_GB.min && value <= FLOOR_RANGE_GB.max;
}

/**
 * Die eingestellte Untergrenze in GB. Ohne `harnessRoot` gilt der Harness, in dem diese Datei liegt (oder
 * KEEL_VOICE_ROOT aus `env`, wie überall in voice/).
 */
export function ramFloorGb(harnessRoot, env = process.env) {
  let profile = null;
  try { profile = readProfile(voiceEnv(harnessRoot === undefined ? TREE_ROOT : harnessRoot, env)); } catch { profile = null; }
  const value = profile?.overrides?.freeRamFloorGb;
  return validFloorGb(value) ? value : DEFAULT_FLOOR_GB;
}

export function ramFloorBytes(harnessRoot, env = process.env) {
  return ramFloorGb(harnessRoot, env) * GIB;
}

/**
 * Freier Arbeitsspeicher in GB. Nur im Testmodus des Executors (KEEL_EXECUTOR_TEST_MODE=1) lässt sich der Wert
 * über KEEL_TEST_FREE_RAM_GB einspeisen: eine Zahl, oder der Pfad einer Datei, die bei jedem Aufruf neu gelesen
 * wird (so ändert ein Test den Wert, während der Executor läuft). Eine Shell mit Wächtern kann die Variable nicht setzen.
 */
export function freeRamGb(env = process.env) {
  if (env.KEEL_EXECUTOR_TEST_MODE === "1" && env.KEEL_TEST_FREE_RAM_GB) {
    const raw = String(env.KEEL_TEST_FREE_RAM_GB).trim();
    let text = raw;
    if (!Number.isFinite(Number(raw))) {
      try { text = fs.readFileSync(raw, "utf8").trim(); } catch { text = ""; }
    }
    const injected = Number(text);
    if (text !== "" && Number.isFinite(injected)) return injected;
  }
  return os.freemem() / GIB;
}

/** Bleibt nach `needGb` mindestens die Untergrenze frei? */
export function hasRoomFor(needGb, harnessRoot, env = process.env) {
  return freeRamGb(env) - Number(needGb) >= ramFloorGb(harnessRoot, env);
}
