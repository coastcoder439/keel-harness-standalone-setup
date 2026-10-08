// CLI-Einstieg für den Hintergrund-Job „Architekturbilder“ (new-harness-architecture-maps, Plan-Schritt 2 F5;
// repariert in harness-dashboard-repair, Plan-Schritte 18 und 23, Gates A1 und A6):
// `node run.mjs --project <pfad> [--force]`; dazu `node run.mjs --prebuild [--plugin-dir <pfad>]` für die
// einmalige Einrichtung des Werkzeugs in einer Installation (runPrebuild, gestartet beim Einschalten).
// Ruft `runArchitectureMapsJob` mit dem echten Läufer auf; derselbe Weg dient dem Dashboard-Knopf
// „Jetzt aktualisieren“ (lib/harness/architecture.ts startet diese Datei abgelöst); der Auslöser
// (`startArchitectureMapsTrigger` in job.mjs) wird seit dem Owner-Entscheid vom 28.09.2026 („nur auf
// knopfdruck“) von keinem Starter mehr gestartet. Kein Modellname hier: `resolveProcessModelForRun` in
// job.mjs liest ihn bei jedem Lauf frisch aus dem Prozess-Register und den Einstellungen (Gate J5).
//
// Exit-Code (Gate A1): 0 bei einem erfolgreichen Lauf und bei einem erwarteten Nicht-Start (nicht
// eingeschaltet, kein neuer Commit, Beruhigungszeit, schon ein Lauf aktiv); 1 bei jedem Fehler — CLI
// startet nicht, CLI endet mit Fehler, Isolation verletzt, Modell nicht wählbar, Plugin nicht vorgebaut.
// Jeder Fehler steht zusätzlich im Protokoll des Projekts, damit das Dashboard ihn als letzten Lauf zeigt.

import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PROCESS_ID, appendRunLog, architectureMapsDataDirectory, projectKey, runArchitectureMapsJob, runPluginPrebuildJob } from "./job.mjs";

const harnessRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const { runWatchedChild } = createRequire(import.meta.url)("../binding/watched-child.cjs");

export function parseArgs(argv) {
  let project = null;
  let force = false;
  let prebuild = false;
  let pluginDir = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--project") {
      project = argv[i + 1];
      i += 1;
    } else if (arg === "--force") {
      force = true;
    } else if (arg === "--prebuild") {
      prebuild = true;
    } else if (arg === "--plugin-dir") {
      pluginDir = argv[i + 1];
      i += 1;
    } else {
      throw new Error(`Unbekanntes Argument: ${arg} (erwartet --project <pfad> [--force] oder --prebuild [--plugin-dir <pfad>])`);
    }
  }
  if (prebuild) {
    if (project || force) throw new Error("--prebuild richtet nur das Werkzeug ein; --project und --force gehören zu einem Lauf.");
    return { prebuild: true, ...(pluginDir ? { pluginDir: path.resolve(pluginDir) } : {}) };
  }
  if (pluginDir) throw new Error("--plugin-dir gilt nur mit --prebuild.");
  if (!project) throw new Error("--project <pfad> fehlt.");
  return { project: path.resolve(project), force };
}

/**
 * Echter Läufer: startet die aufgelöste claude.exe ohne Shell mit der Umgebung des Jobs
 * (CLAUDE_PLUGIN_ROOT, Gate A1), sammelt die JSON-Ausgabe für die Token-Zahlen und reicht stderr durch.
 * Der Aufruf hatte keinen Zeitschutz (D12) und einen Deckel von 256 MiB für die Ausgabe; jetzt läuft er unter dem
 * Stille-Wächter (P15, vendor/unlazy/scripts/lib/silence-watch.mjs): kein Zeitlimit, kein Ausgabe-Deckel, ein
 * Abbruch nur, wenn die CLI KEEL_SILENCE_MS lang nichts ausgibt UND ihr Prozessbaum nicht arbeitet. Das Ergebnis
 * hat die Form des früheren spawnSync-Ergebnisses plus { hung, hungReason }. `runChild` und `baseEnv` sind für Tests.
 */
export async function defaultCliRunner(invocation, options, { runChild = runWatchedChild, baseEnv = process.env } = {}) {
  const result = await runChild(invocation.executable, invocation.args, {
    cwd: options.cwd,
    env: { ...baseEnv, ...(invocation.env || {}) },
  });
  if (result.stderr) process.stderr.write(result.stderr);
  return result;
}

/**
 * Reine Ablauf-Funktion (kein `process.exit`): `argv` ohne die ersten beiden Node-Argumente, ein
 * injizierbarer `cliRunner`/`freeMemoryBytes`/`pluginStatus` für Tests. Liefert das Job-Ergebnis und den
 * Exit-Code; Fehler werden ins Protokoll des Projekts geschrieben und als `exitCode: 1` gemeldet.
 */
export async function run(argv, { cliRunner = defaultCliRunner, freeMemoryBytes = os.freemem(), dataDir, env = process.env, pluginStatus, now = new Date() } = {}) {
  const { project, force, prebuild } = parseArgs(argv);
  if (prebuild) throw new Error("--prebuild läuft über runPrebuild, nicht über run.");
  const directory = dataDir ?? architectureMapsDataDirectory({ env });
  try {
    const result = await runArchitectureMapsJob({ projectRoot: project, dataDir: directory, harnessRoot, env, freeMemoryBytes, forced: force, cliRunner, pluginStatus, now });
    const failed = Boolean(result.error) || (result.started === false && typeof result.reason === "string" && result.reason.startsWith("Plugin nicht vorgebaut"));
    return { ...result, exitCode: failed ? 1 : 0 };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      appendRunLog(directory, project, { at: now.toISOString(), processId: PROCESS_ID, project: projectKey(project), started: false, reason: message, error: message, code: error?.code ?? null });
    } catch { /* Das Protokoll ist nicht schreibbar; die Meldung geht trotzdem nach stderr. */ }
    return { started: false, reason: message, error: message, exitCode: 1 };
  }
}

/**
 * Einrichtung des Werkzeugs im abgelösten Kindprozess (job.mjs startPluginPrebuild startet
 * `node run.mjs --prebuild --plugin-dir <pfad>`): Vorbau des Plugins nach dem Rezept der Lock-Datei, Stand
 * in der Statusdatei, die die Dashboard-Karte liest. Exit-Code 0 bei Erfolg oder wenn nichts zu tun war,
 * 1 bei einem Fehlschlag (der Grund steht in der Statusdatei). `exec` ist für Tests injizierbar.
 */
export async function runPrebuild(argv, { dataDir, env = process.env, exec, lockFile, now = new Date(), log = (text) => process.stdout.write(text) } = {}) {
  const { prebuild, pluginDir } = parseArgs(argv);
  if (!prebuild) throw new Error("runPrebuild erwartet --prebuild.");
  const directory = dataDir ?? architectureMapsDataDirectory({ env });
  const result = await runPluginPrebuildJob({
    dataDir: directory, env, now, log, ...(pluginDir ? { pluginDir } : {}), ...(exec ? { exec } : {}), ...(lockFile ? { lockFile } : {}),
  });
  return { ...result, exitCode: result.ok || result.skipped ? 0 : 1 };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  let result;
  try {
    if (process.argv.slice(2).includes("--prebuild")) {
      const prebuild = await runPrebuild(process.argv.slice(2));
      console.log(JSON.stringify({ ok: prebuild.ok, skipped: prebuild.skipped ?? false, reason: prebuild.reason ?? null, error: prebuild.error ?? null, steps: prebuild.steps ?? [] }, null, 2));
      if (prebuild.error) console.error(prebuild.error);
      process.exit(prebuild.exitCode);
    }
    result = await run(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
  const { result: cliResult, ...summary } = result;
  console.log(JSON.stringify({ ...summary, cliStatus: cliResult?.status ?? null, cliStdout: cliResult?.stdout ?? null }, null, 2));
  if (result.error) console.error(result.error);
  process.exit(result.exitCode);
}
