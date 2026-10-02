// Dashboard beim Sitzungsstart sicherstellen. Owner 01.10.2026: „das dashboard muss immer gesatartet sein wenn der
// harness läuft“. Der SessionStart-Hook .claude/dashboard-ensure.js ruft main(): läuft das installierte Dashboard
// nicht (keine lebende Lease, keine Antwort auf dem Port), startet es losgelöst über dashboard/serve.mjs; sonst
// geschieht nichts. Im Quellbaum (ohne dashboard/runtime.keel.gz) wird nie gestartet.
//
// Abschalten: KEEL_DASHBOARD_AUTOSTART=0. Protokoll eines Starts: <os.tmpdir()>/keel-dashboard-start/<port>/dashboard.log.
//
// Nichts hier wird nachgebaut: Probe und Start kommen aus dem Hilfsprozess der Selbst-Aktualisierung, Lease-Lesen und
// Prozessprüfung aus update-core, die Harness-Wurzel aus hook-context. Der Import hat keine Seiteneffekte.

import { existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { dashboardAnswers, startDashboard } from "../self-update/update-helper.mjs";
import { processAlive, readJson } from "../self-update/update-core.mjs";

const require = createRequire(import.meta.url);
const { ruleRoot } = require("../guards/hook-context.cjs");

const DEFAULT_PORT = 4190;
const PROBE_TIMEOUT_MS = 1500;

/** Port nach derselben Regel wie dashboard/lib/harness/autostart.ts: PORT mit 2 bis 5 Ziffern, sonst 4190. */
export function dashboardPort(env = process.env) {
  return /^\d{2,5}$/u.test(env.PORT ?? "") ? Number(env.PORT) : DEFAULT_PORT;
}

/** Wirft nie; liefert { state, port, url, log, error } mit state disabled|not-installed|running|started|failed. */
export async function ensureDashboard({
  root,
  env = process.env,
  tmp = os.tmpdir(),
  probe = dashboardAnswers,
  start = startDashboard,
  readLease = readJson,
  alive = processAlive,
  exists = existsSync,
} = {}) {
  const result = { state: "failed", port: null, url: null, log: null, error: null };
  try {
    const port = dashboardPort(env);
    result.port = port;
    result.url = "http://127.0.0.1:" + port;
    if (env.KEEL_DASHBOARD_AUTOSTART === "0") return { ...result, state: "disabled" };
    if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error("invalid dashboard port: " + port);
    if (!root) throw new Error("no harness root");
    if (!exists(path.join(root, "dashboard", "serve.mjs")) || !exists(path.join(root, "dashboard", "runtime.keel.gz"))) {
      return { ...result, state: "not-installed" };
    }
    const lease = readLease(path.join(root, ".keel-harness", "runtime", "dashboard", "active.json"));
    if (lease && alive(lease.ownerPid)) return { ...result, state: "running" };
    if (await probe(port, { timeoutMs: PROBE_TIMEOUT_MS })) return { ...result, state: "running" };
    // Ein Ordner je Port: zwei Sitzungen auf verschiedenen Ports überschreiben nicht dasselbe Protokoll.
    // startDashboard öffnet dashboard.log darin, legt den Ordner aber nicht an.
    const directory = path.join(tmp, "keel-dashboard-start", String(port));
    mkdirSync(directory, { recursive: true });
    await start({ root, port, flags: [], updateDirectory: directory }, { env });
    return { ...result, state: "started", log: path.join(directory, "dashboard.log") };
  } catch (error) {
    return { ...result, state: "failed", error: error instanceof Error ? error.message : String(error) };
  }
}

/** Einstieg des SessionStart-Hooks: liest kein stdin, jede Quelle gilt gleich, Exitcode bleibt 0. */
export async function main({ env = process.env } = {}) {
  let outcome;
  try {
    outcome = await ensureDashboard({ root: ruleRoot(env, process.cwd()), env });
  } catch (error) {
    outcome = { state: "failed", error: error instanceof Error ? error.message : String(error) };
  }
  if (outcome.state === "started") {
    process.stdout.write(JSON.stringify({ systemMessage: "Dashboard gestartet: " + outcome.url }) + "\n");
  } else if (outcome.state === "failed") {
    process.stderr.write("dashboard-ensure: " + outcome.error + "\n");
  }
  process.exitCode = 0;
  return outcome;
}
