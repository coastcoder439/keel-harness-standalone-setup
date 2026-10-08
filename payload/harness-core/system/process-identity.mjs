// Lebt der Halter einer Sperre wirklich noch? (P13, C10)
//
// Eine Sperre, ein Teil-Integrationsordner oder ein Paketlauf gilt nur dann als verwaist, wenn der Prozess, der
// sie hielt, tot ist. Eine feste Zeit beweist das nicht: Arbeit unter einer Sperre kann beliebig lange dauern
// (Owner 15:17, keine Zeitgrenze, die Arbeit abbricht). Die Prozessnummer allein beweist es auch nicht, weil das
// Betriebssystem sie nach einem Absturz neu vergibt. Deshalb zusammen:
//
//   - Prozessnummer: existiert der Prozess?
//   - Startzeit: ein Prozess, der erst NACH dem Schreiben der Sperre gestartet wurde, ist nicht ihr Halter
//     (die Prozessnummer wurde neu vergeben).
//
// Im Zweifel (Startzeit nicht ermittelbar) lebt der Halter: aufgeräumt wird nur, was eindeutig verwaist ist.
// Dieses Modul lädt nur Knoten-Standardmodule, damit jeder Sperr-Code es ohne Nebenwirkung einbinden kann.

import fs from "node:fs";
import process from "node:process";
import { spawnSync } from "node:child_process";

// Ein Prozess, dessen Startzeit höchstens so viel NACH dem Sperr-Zeitpunkt liegt, gilt noch als der Halter
// (Uhren von Betriebssystem und Knoten, Rundung der Startzeit).
export const START_SLACK_MS = 2_000;
const CACHE_TTL_MS = 5_000;
const PROBE_TIMEOUT_MS = 15_000;
const startCache = new Map();

export function processAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === "EPERM"; }
}

function windowsPowerShell(env) {
  const root = env.SystemRoot || env.SYSTEMROOT || "C:\\Windows";
  const file = root + "\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
  return fs.existsSync(file) ? file : null;
}

function windowsStartMs(pid, run, env) {
  const powershell = windowsPowerShell(env);
  if (!powershell) return null;
  const script = "$p = Get-Process -Id " + pid + " -ErrorAction Stop; [string][DateTimeOffset]::new($p.StartTime).ToUnixTimeMilliseconds()";
  const result = run(powershell, ["-NoProfile", "-NonInteractive", "-Command", script],
    { encoding: "utf8", windowsHide: true, timeout: PROBE_TIMEOUT_MS });
  if (result.error || result.status !== 0) return null;
  const value = Number(String(result.stdout || "").trim());
  return Number.isFinite(value) && value > 0 ? value : null;
}

function linuxStartMs(pid, readFile) {
  try {
    const stat = readFile("/proc/" + pid + "/stat", "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    const ticks = Number(fields[19]);
    const boot = /^btime\s+(\d+)/mu.exec(readFile("/proc/stat", "utf8"));
    if (!Number.isFinite(ticks) || !boot) return null;
    return Number(boot[1]) * 1000 + Math.round(ticks * 10); // USER_HZ ist 100
  } catch { return null; }
}

function psStartMs(pid, run, env) {
  const result = run("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8", env: { ...env, LC_ALL: "C" }, timeout: PROBE_TIMEOUT_MS });
  if (result.error || result.status !== 0) return null;
  const value = Date.parse(String(result.stdout || "").trim());
  return Number.isFinite(value) ? value : null;
}

/** Startzeit des Prozesses in ms seit 1970, oder null, wenn sie sich nicht ermitteln lässt. */
export function processStartMs(pid, { platform = process.platform, run = spawnSync, env = process.env,
  readFile = fs.readFileSync, now = Date.now() } = {}) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  if (pid === process.pid) return now - Math.round(process.uptime() * 1000);
  const cached = startCache.get(pid);
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.value;
  let value = null;
  if (platform === "win32") value = windowsStartMs(pid, run, env);
  else {
    if (platform === "linux") value = linuxStartMs(pid, readFile);
    if (value === null) value = psStartMs(pid, run, env);
  }
  startCache.set(pid, { at: now, value });
  return value;
}

/**
 * Lebt der Halter, der `pid` hatte, als er die Sperre zum Zeitpunkt `sinceMs` schrieb?
 * Nein nur, wenn es den Prozess nicht mehr gibt oder er erst nach der Sperre gestartet wurde.
 * `alive` und `startMs` sind für Tests austauschbar.
 */
export function holderLives(pid, sinceMs, { alive = processAlive, startMs = processStartMs } = {}) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  if (!alive(pid)) return false;
  if (pid === process.pid) return true;
  if (!Number.isFinite(sinceMs)) return true;
  const started = startMs(pid);
  if (!Number.isFinite(started)) return true;
  return started <= sinceMs + START_SLACK_MS;
}

/** Zeitpunkt der Sperre aus den Feldern, in denen die Sperrformate ihn führen; NaN, wenn keiner lesbar ist. */
export function lockTimeMs(value) {
  if (!value || typeof value !== "object") return Number.NaN;
  for (const key of ["acquiredAt", "startedAt", "createdAt"]) {
    const parsed = Date.parse(value[key] || "");
    if (Number.isFinite(parsed)) return parsed;
  }
  return Number.NaN;
}
