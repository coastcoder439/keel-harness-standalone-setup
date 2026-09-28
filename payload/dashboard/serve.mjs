#!/usr/bin/env node

// Startweg der installierten Auslieferung (Gegenstueck zu dashboard/serve.mjs im Quellbaum).
// Die Runtime kommt aus dem verifizierten Runtime-Archiv.
//
// Was mit dem Server wirklich startet (Stand 28.09.2026):
// - der Web-Prozess (materialisierte Runtime, server.js) mit den Pfaden der Sprachlaufzeit in
//   seiner Umgebung (voiceEnvironment in ../voice/launcher.mjs). Das sind Pfade, keine Dienste.
// - --voice | --speech | --microphone schalten Sprachausgabe und Mikrofon frei, --no-inference
//   pausiert die KI (ohne Flag: Sprache und Mikrofon aus, KI an). Vor dem Web-Start startet
//   dabei KEIN Sprachdienst (startConfiguredVoice ist leer): Voicebox startet erst bei Bedarf aus
//   dem Dashboard (Knopf „Stimmendienst starten“, POST /api/accountability/voice/service).
// - KEIN Hintergrund-Auslöser für das Architekturbild, wie in dashboard/serve.mjs: es wird nur
//   auf Knopfdruck aktualisiert (Knopf „Jetzt aktualisieren“ auf der Projektseite), und die Karte
//   sagt daneben, wie viele Dateien sich seit der letzten Aktualisierung geändert haben und wie
//   lange die her ist (Owner-Entscheid 28.09.2026: „nur auf knopfdruck mit angabe wieviel
//   änderungen seit wielange her“). startArchitectureMapsTrigger in
//   ../harness-core/architecture-maps/job.mjs bleibt bestehen, wird aber nicht gestartet.

import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { acquireDashboardRuntimeLease, materializeDashboardRuntime } from "./runtime-archive.mjs";
import { parseVoiceFlags, startConfiguredVoice, voiceEnvironment, voiceStatusLine } from "../voice/launcher.mjs";

const dashboardRoot = path.dirname(fileURLToPath(import.meta.url));
const harnessRoot = path.resolve(dashboardRoot, "..");

function parsePort(argv) {
  const index = argv.indexOf("--port");
  const value = index >= 0 ? argv[index + 1] : process.env.PORT || "4190";
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Ungueltiger Dashboard-Port: ${JSON.stringify(value)}`);
  }
  return port;
}

const argv = process.argv.slice(2);
let port;
let flags;
try {
  port = parsePort(argv);
  flags = parseVoiceFlags(argv);
} catch (error) {
  process.stderr.write(`FEHLER: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(2);
}

// Sprachdienste vor jeder Materialisierung: eine fehlende Installation soll keinen
// halben Start hinterlassen.
let voice = { children: [], stop: async () => {} };
try {
  voice = await startConfiguredVoice({ flags });
} catch (error) {
  process.stderr.write(`FEHLER: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(2);
}

const runtimeRoot = materializeDashboardRuntime({ dashboardRoot, harnessRoot });
const serverFile = path.join(runtimeRoot, "server.js");
const lease = acquireDashboardRuntimeLease({ harnessRoot, runtimeRoot });

const webEnv = {
  ...process.env,
  HOSTNAME: "127.0.0.1",
  PORT: String(port),
  NODE_ENV: "production",
  KEEL_HARNESS_ROOT: harnessRoot,
  KEEL_HARNESS_REPOSITORY_ROOT: harnessRoot,
  // Sprach-, Mikrofon- und KI-Zustand, die Pfade der Sprachlaufzeit und der
  // gelieferte roles/-Ordner (der Quell-Fallback "../roles" zeigt aus dem
  // materialisierten Runtime-Verzeichnis ins Leere).
  ...voiceEnvironment({ harnessRoot, flags }).env,
};

let child;
try {
  child = spawn(process.execPath, [serverFile], {
    cwd: runtimeRoot,
    env: webEnv,
    stdio: "inherit",
    windowsHide: true,
  });
  lease.updateChild(child.pid);
} catch (error) {
  lease.release();
  await voice.stop();
  throw error;
}

process.stdout.write(`Dashboard: http://127.0.0.1:${port} — ${voiceStatusLine(flags)}\n`);

let stopping = false;
function stop(signal) {
  if (stopping || child.exitCode !== null) return;
  stopping = true;
  void voice.stop();
  child.kill(signal);
}
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => stop(signal));
}
child.once("error", (error) => {
  lease.release();
  void voice.stop();
  console.error(`Dashboard-Runtime konnte nicht gestartet werden: ${error.message}`);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  lease.release();
  void voice.stop();
  if (signal && !stopping) console.error(`Dashboard-Runtime endete durch ${signal}`);
  process.exitCode = Number.isInteger(code) ? code : signal && stopping ? 0 : 1;
});
