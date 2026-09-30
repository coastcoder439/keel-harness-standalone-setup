#!/usr/bin/env node
// Hilfsprozess der Selbst-Aktualisierung (Paket harness-self-update, Owner 29.09.2026). Das Dashboard startet ihn
// losgelöst (`node update-helper.mjs <auftrag.json>`) und beendet sich danach; er arbeitet, wenn das Dashboard schon
// steht, weil der Installer bei laufendem Dashboard fail-closed ablehnt (Sperre „live Dashboard lease“ in
// standalone/lib/distribution-lifecycle.mjs).
//
// Ablauf: Setup-Repo in einen temporären Ordner laden -> `install.mjs status` der neuen Fassung prüft dabei ihre
// Unversehrtheit UND den Zustand der Installation (bei verändertem Verwaltetem bricht alles ab, bevor etwas steht) ->
// Dashboard beenden -> `install.mjs install --upgrade` (transaktional, stellt bei Fehlern den Vorzustand wieder her) ->
// Dashboard neu starten -> Endstand nach status.json, jeder Schritt ins Protokoll update.log.
//
// Angefasst wird nur, was der Installer verwaltet; der Hilfsprozess selbst schreibt ausschließlich in den Datenordner
// der Installation (harness-update/) und in seinen temporären Ordner. Nutzer-Projekte, eigene Dateien und Git-Stand
// des Ordners bleiben unberührt (Beleg: test/harness-self-update.test.js, Vorher-Nachher-Vergleich).
//
// Alle Außenwelt-Schritte sind einsetzbar (deps): der Test ersetzt Klonen, Beenden, Neustart und Bereitschaft und lässt
// den echten Installer laufen.

import { spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, realpathSync, rmSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  JOB_SCHEMA, STATUS_SCHEMA, appendLog, compareVersions, isNewerVersion,
  processAlive, readInstalledState, readJson, updateDirectory, writeJsonAtomic,
} from "./update-core.mjs";

const TEMPORARY_PREFIX = "keel-harness-update-";
const CLONE_TIMEOUT_MS = 5 * 60 * 1000;
const INSTALL_TIMEOUT_MS = 20 * 60 * 1000;
const READY_TIMEOUT_MS = 180 * 1000;

/** Umgebung für den Installer: ohne die Laufzeit-Variablen des Web-Prozesses. */
export function installerEnvironment(env) {
  const result = { ...env, GIT_TERMINAL_PROMPT: "0" };
  for (const key of Object.keys(result)) {
    if (/^(__)?NEXT_/u.test(key) || ["PORT", "HOSTNAME", "NODE_ENV", "KEEL_HARNESS_ROOT", "KEEL_HARNESS_REPOSITORY_ROOT"].includes(key)) delete result[key];
  }
  return result;
}

/** Umgebung für den Neustart: die des Web-Prozesses (Datenordner, Schalter), ohne die Next-internen Variablen. */
export function restartEnvironment(env) {
  const result = { ...env };
  for (const key of Object.keys(result)) if (/^(__)?NEXT_/u.test(key)) delete result[key];
  return result;
}

const tail = (text, lines = 12) => String(text || "").trim().split(/\r?\n/u).slice(-lines).join("\n");

function defaultFetchSetup({ url, branch, directory, env }) {
  const result = spawnSync("git", ["clone", "--quiet", "--depth", "1", "--branch", branch, url, directory], {
    encoding: "utf8", windowsHide: true, timeout: CLONE_TIMEOUT_MS, env: { ...env, GIT_TERMINAL_PROMPT: "0" },
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Das Setup-Repo ließ sich nicht laden: ${tail(result.stderr || result.error?.message || "unbekannter Fehler", 3)}`);
  }
}

function defaultRunNode(args, { cwd, env }) {
  const result = spawnSync(process.execPath, args, {
    cwd, env, encoding: "utf8", windowsHide: true, timeout: INSTALL_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024,
  });
  return { status: result.status ?? 1, stdout: result.stdout || "", stderr: result.stderr || result.error?.message || "" };
}

const validPid = (pid) => Number.isSafeInteger(pid) && pid > 1;

/**
 * Beendet das Dashboard. Vertraut wird der Sperrdatei nur, wenn ihr Kindprozess der Web-Prozess ist, der den Auftrag
 * gestellt hat; sonst würde eine veraltete Sperre mit wiederverwendeter Prozessnummer einen fremden Prozess treffen.
 * Ohne /T: der Hilfsprozess ist selbst ein Nachkomme des Web-Prozesses.
 */
async function defaultStopDashboard(job, { sleep, portWaitMs = 10_000 }) {
  const lease = readJson(path.join(job.root, ".keel-harness", "runtime", "dashboard", "active.json"));
  const pids = new Set();
  if (validPid(job.dashboardPid)) pids.add(job.dashboardPid);
  if (lease && validPid(lease.ownerPid) && validPid(job.dashboardPid) && lease.childPid === job.dashboardPid) pids.add(lease.ownerPid);
  pids.delete(process.pid);
  const signal = (name) => { for (const pid of pids) { try { process.kill(pid, name); } catch { /* schon beendet */ } } };
  const anyAlive = () => [...pids].some((pid) => processAlive(pid));
  signal("SIGTERM");
  for (let waited = 0; waited < 10_000 && anyAlive(); waited += 250) await sleep(250);
  if (anyAlive()) {
    signal("SIGKILL");
    for (let waited = 0; waited < 5_000 && anyAlive(); waited += 250) await sleep(250);
  }
  if (anyAlive()) throw new Error("Das Dashboard ließ sich nicht beenden.");
  await sleep(500);
  // Antwortet der Port noch, hängt ein weiterer Prozess des Dashboards daran (etwa ein Elternprozess): dann nicht
  // installieren und nicht „bereit“ melden, weil der alte Server antwortet.
  if (Number.isSafeInteger(job.port)) {
    let busy = await portAnswers(job.port);
    for (let waited = 0; busy && waited < portWaitMs; waited += 500) { await sleep(500); busy = await portAnswers(job.port); }
    if (busy) throw new Error(`Der Port ${job.port} wird nach dem Beenden weiter bedient; ein anderer Prozess hält das Dashboard fest.`);
  }
}

function portAnswers(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host: "127.0.0.1" });
    socket.setTimeout(1_500);
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("timeout", () => { socket.destroy(); resolve(false); });
    socket.once("error", () => resolve(false));
  });
}

function defaultStartDashboard(job, { env }) {
  const launcher = path.join(job.root, "dashboard", "serve.mjs");
  if (!existsSync(launcher)) throw new Error(`Die Startdatei ${launcher} fehlt.`);
  const log = openSync(path.join(job.updateDirectory, "dashboard.log"), "w");
  try {
    const child = spawn(process.execPath, [launcher, "--port", String(job.port), ...(job.flags || [])], {
      cwd: job.root, env: restartEnvironment(env), detached: true, stdio: ["ignore", log, log], windowsHide: true,
    });
    let failure = null;
    child.once("error", (error) => { failure = error; });
    child.unref();
    return { pid: child.pid, alive: () => !failure && child.exitCode === null && child.signalCode === null };
  } finally { closeSync(log); }
}

/**
 * Antwortet das Dashboard auf dem Port mit einem Status unter 500? Bewusst node:http und nicht fetch: fetch verweigert
 * die Ports der „bad ports“-Liste des Fetch-Standards, darunter 4190, den Standardport des Dashboards („fetch failed |
 * bad port“). Bis 1.3.11 meldete der Helfer deshalb auf 4190 nach drei Minuten immer „ließ sich nicht neu starten“,
 * obwohl das Dashboard lief (Aktualisierung vom 30.09.2026).
 */
export function dashboardAnswers(port, { timeoutMs = 3_000 } = {}) {
  return new Promise((resolve) => {
    const request = http.get({ host: "127.0.0.1", port, path: "/", timeout: timeoutMs }, (response) => {
      response.resume();
      resolve((response.statusCode ?? 500) < 500);
    });
    request.once("timeout", () => { request.destroy(); resolve(false); });
    request.once("error", () => resolve(false));
  });
}

async function defaultWaitReady(job, { sleep, handle }) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (handle && !handle.alive()) return false;
    if (await dashboardAnswers(job.port)) return true;
    await sleep(1_000);
  }
  return false;
}

function defaultRemove(directory) {
  // Nur unser eigener temporärer Ordner, nie ein fremder Pfad.
  if (!path.basename(directory).startsWith(TEMPORARY_PREFIX)) return;
  rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

function parseJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

/**
 * Führt einen Aktualisierungsauftrag aus und liefert den Endstand (derselbe Inhalt steht in status.json).
 * Wirft nie: jeder Fehler wird Endstand „failed“ mit Satz und Protokoll.
 */
export async function runUpdateJob(job, overrides = {}) {
  const deps = {
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    env: process.env,
    temporaryRoot: tmpdir(),
    fetchSetup: defaultFetchSetup,
    runNode: defaultRunNode,
    stopDashboard: defaultStopDashboard,
    startDashboard: defaultStartDashboard,
    waitReady: defaultWaitReady,
    removeDirectory: defaultRemove,
    ...overrides,
  };
  const directory = job.updateDirectory;
  const statusFile = path.join(directory, "status.json");
  const log = (line) => { try { appendLog(directory, line, new Date(deps.now())); } catch { /* das Protokoll ist Beiwerk */ } };
  let status = {
    schema: STATUS_SCHEMA, id: job.id, kind: "update", state: "running", phase: "vorbereiten",
    from: job.fromVersion, to: job.expectedVersion, startedAt: new Date(deps.now()).toISOString(), finishedAt: null,
    helperPid: process.pid, port: job.port, message: "", installer: null, restarted: false,
  };
  const write = (patch) => { status = { ...status, ...patch }; writeJsonAtomic(statusFile, status); return status; };
  const phase = (name, message) => { log(`${name}: ${message}`); write({ phase: name, message }); };
  const finish = (state, message, patch = {}) => {
    log(`ENDE ${state}: ${message}`);
    return write({ state, message, finishedAt: new Date(deps.now()).toISOString(), ...patch });
  };

  let temporary = null;
  let dashboardStopped = false;
  let handle = null;
  try {
    mkdirSync(directory, { recursive: true });
    write({});
    const installed = readInstalledState(job.root);
    if (installed.mode !== "installed") return finish("failed", "Dieser Ordner ist keine vom Installer verwaltete Installation.");
    write({ from: installed.version });

    phase("laden", `Setup-Repo ${job.repository} (${job.branch}) in einen temporären Ordner laden`);
    temporary = mkdtempSync(path.join(deps.temporaryRoot, TEMPORARY_PREFIX));
    const setup = path.join(temporary, "setup");
    await deps.fetchSetup({ url: job.repository, branch: job.branch, directory: setup, env: deps.env });
    const manifest = readJson(path.join(setup, "manifest.json"));
    const remoteVersion = manifest?.product?.id === "keel-harness" ? manifest.product.version : null;
    const installerFile = path.join(setup, "install.mjs");
    if (compareVersions(remoteVersion, remoteVersion) === null || !existsSync(installerFile)) {
      return finish("failed", "Das geladene Setup-Repo enthält kein Keel-Harness-Manifest oder keinen Installer.");
    }
    write({ to: remoteVersion });
    if (!isNewerVersion(remoteVersion, installed.version)) {
      return finish("current", `Installiert ist bereits ${installed.version}; das Setup-Repo hat ${remoteVersion}.`, { to: installed.version });
    }

    phase("prüfen", `Fassung ${remoteVersion} und Zustand der Installation ${installed.version} mit dem Installer prüfen`);
    const check = deps.runNode([installerFile, "status", "--target", job.root, "--json"], { cwd: setup, env: installerEnvironment(deps.env) });
    const checked = parseJson(check.stdout);
    if (check.status !== 0 || !checked) {
      return finish("failed", `Die Prüfung durch den Installer schlug fehl: ${tail(check.stderr || check.stdout, 3)}`, { installer: { step: "status", exitCode: check.status, output: tail(check.stderr || check.stdout) } });
    }
    if (checked.state !== "installed" || !checked.healthy) {
      const changed = [...(checked.drift || []), ...(checked.backupErrors || [])].slice(0, 6).join(", ");
      return finish("failed", `Die Installation ist nicht unverändert${changed ? ` (${changed})` : ""}; der Installer würde nichts überschreiben. Es wurde nichts angefasst.`, { installer: { step: "status", exitCode: check.status, output: tail(check.stdout) } });
    }
    if (!checked.upgradeAvailable) return finish("failed", "Der Installer sieht keine neuere Fassung als die installierte.", { installer: { step: "status", exitCode: check.status, output: tail(check.stdout) } });

    phase("beenden", "Dashboard beenden (der Installer lehnt bei laufendem Dashboard ab)");
    await deps.stopDashboard(job, deps);
    dashboardStopped = true;

    phase("installieren", `install --upgrade auf ${remoteVersion}`);
    const install = deps.runNode([installerFile, "install", "--target", job.root, "--upgrade", "--json"], { cwd: setup, env: installerEnvironment(deps.env) });
    const installResult = parseJson(install.stdout);
    const installerOk = install.status === 0 && installResult?.state === "installed";
    const installerInfo = { step: "install", exitCode: install.status, output: tail(installerOk ? install.stdout : install.stderr || install.stdout) };
    log(`Installer Rückgabewert ${install.status}: ${tail(install.stderr || install.stdout, 4)}`);

    phase("neu starten", "Dashboard neu starten");
    let ready = false;
    let restartError = "";
    try {
      handle = deps.startDashboard(job, { ...deps, handle: null });
      ready = await deps.waitReady(job, { ...deps, handle });
    } catch (error) { restartError = error instanceof Error ? error.message : String(error); }
    const after = readInstalledState(job.root);
    const restartHint = `Starte das Dashboard von Hand: node dashboard/serve.mjs --port ${job.port}`;
    if (!installerOk) {
      const rolledBack = /rollback=verified/u.test(install.stderr);
      return finish("failed", `Der Installer hat abgebrochen${rolledBack ? " und den Vorzustand wiederhergestellt" : ""}: ${tail(install.stderr || install.stdout, 2)}${ready ? "" : ` Das Dashboard ließ sich danach nicht neu starten. ${restartHint}`}`, { installer: installerInfo, restarted: ready, to: remoteVersion });
    }
    if (!ready) return finish("failed", `Aktualisiert auf ${after.version}, aber das Dashboard startete nicht neu${restartError ? ` (${restartError})` : ""}. ${restartHint}`, { installer: installerInfo, restarted: false, to: after.version });
    return finish("succeeded", `Aktualisiert von ${installed.version} auf ${after.version}.`, { installer: installerInfo, restarted: true, to: after.version });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (dashboardStopped && !handle) {
      try { handle = deps.startDashboard(job, { ...deps, handle: null }); await deps.waitReady(job, { ...deps, handle }); } catch { /* der Satz unten nennt den Handstart */ }
    }
    return finish("failed", `${message}${dashboardStopped ? ` Starte das Dashboard bei Bedarf von Hand: node dashboard/serve.mjs --port ${job.port}` : ""}`, { restarted: Boolean(handle) });
  } finally {
    if (temporary) { try { deps.removeDirectory(temporary); } catch (error) { log(`Aufräumen: ${error instanceof Error ? error.message : String(error)}`); } }
  }
}

/** Auftrag aus der Datei lesen und prüfen; der Ordner der Ergebnisdateien muss zum Datenordner passen. */
export function loadJob(file) {
  const job = readJson(file);
  if (!job || job.schema !== JOB_SCHEMA) throw new Error("Der Auftrag ist keine Aktualisierungsanweisung.");
  for (const key of ["id", "root", "dataDirectory", "updateDirectory", "repository", "branch"]) {
    if (typeof job[key] !== "string" || !job[key]) throw new Error(`Im Auftrag fehlt ${key}.`);
  }
  if (path.resolve(job.updateDirectory) !== path.resolve(updateDirectory(job.dataDirectory))) throw new Error("Der Ordner der Ergebnisdateien passt nicht zum Datenordner.");
  if (!Number.isSafeInteger(job.port) || job.port < 1 || job.port > 65535) throw new Error("Im Auftrag fehlt der Port.");
  if (!Array.isArray(job.flags) || job.flags.some((flag) => !["--voice", "--speech", "--microphone", "--no-inference"].includes(flag))) throw new Error("Die Startschalter im Auftrag sind ungültig.");
  return job;
}

/**
 * Wechselt in den Ergebnisordner des Auftrags. Der Hilfsprozess erbt sonst den Arbeitsordner des Dashboard-Servers, und
 * der liegt im Laufzeitordner .keel-harness/runtime/dashboard/<digest>, den der Installer beim Upgrade entfernt. Unter
 * Windows lässt sich ein Ordner nicht löschen, solange er Arbeitsordner eines lebenden Prozesses ist: der Installer
 * brach mit „EPERM, Permission denied: …\runtime\dashboard\<digest>“ ab (Aktualisierung vom 30.09.2026).
 */
export function leaveRuntimeFolder(job, chdir = (directory) => process.chdir(directory)) {
  const directory = path.resolve(job.updateDirectory);
  mkdirSync(directory, { recursive: true });
  chdir(directory);
  return directory;
}

const invokedDirectly = process.argv[1] && realpathSync(path.resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  try {
    const job = loadJob(path.resolve(process.argv[2] || ""));
    const workingDirectory = leaveRuntimeFolder(job);
    try { appendLog(workingDirectory, `Arbeitsordner: ${process.cwd()}`); } catch { /* das Protokoll ist Beiwerk */ }
    const status = await runUpdateJob(job);
    process.exitCode = status.state === "succeeded" || status.state === "current" ? 0 : 1;
  } catch (error) {
    process.stderr.write(`update-helper: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}

// Die Standard-Schritte, einzeln erreichbar für den Test mit echten Prozessen.
export { defaultStopDashboard as stopDashboard, defaultStartDashboard as startDashboard, defaultWaitReady as waitReady };
