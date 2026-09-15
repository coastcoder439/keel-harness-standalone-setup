#!/usr/bin/env node

// Startweg der installierten Auslieferung. Die Runtime kommt aus dem verifizierten
// Runtime-Archiv. Sprachlaufzeit: --voice | --speech | --microphone starten die
// lokalen Dienste aus ../voice VOR dem Web-Start; --no-inference pausiert die KI
// (ohne Flag bleibt sie an, wie bisher).

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

let child;
try {
  child = spawn(process.execPath, [serverFile], {
    cwd: runtimeRoot,
    env: {
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
    },
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
