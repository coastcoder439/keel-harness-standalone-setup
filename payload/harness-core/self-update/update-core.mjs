// Kern der Selbst-Aktualisierung (Paket harness-self-update, Owner 29.09.2026): Versionsvergleich, die installierte
// Version, die neueste Version im öffentlichen Setup-Repo, der Tagesrhythmus der Prüfung und die Dateien, in denen das
// Dashboard und der Hilfsprozess (update-helper.mjs) einander Ergebnis und Stand melden.
//
// Reines JavaScript ohne Abhängigkeiten: das Dashboard lädt diese Datei zur Laufzeit (lib/harness/update.ts, wie
// harness-core/process-models), der Hilfsprozess importiert sie direkt. Nichts hier schreibt in die Installation selbst;
// geschrieben wird nur in den Datenordner der Installation (außerhalb des Repos, `harness-update/`).
//
// Woher die Installation ihre Update-Quelle kennt: aus dem Installations-Manifest (state.json, product.updateSource), das der
// Installer aus dem Manifest der Auslieferung übernimmt (scripts/build-standalone.mjs, UPDATE_SOURCE). Im ausgelieferten
// Text steht keine Adresse: die Auslieferung darf keine Kennung des Verteilers enthalten (forbiddenDistributionIdentity in
// standalone/lib/generic-content.mjs). Eine Installation ohne dieses Feld (Fassungen vor der Selbst-Aktualisierung) kennt ihre
// Quelle nicht und fragt nie.
//
// Warum manifest.json als Quelle der neuesten Version: es ist die Datei, die der Installer selbst prüft
// (Schema keel-harness-standalone.v2, product.version), sie liegt ohne Anmeldung über raw.githubusercontent.com bereit und
// hat kein Anfragekontingent wie die API. Nur der Änderungstext kommt best effort aus der GitHub-API
// (letzter Commit); fällt sie aus, gilt die Version trotzdem, die Kurzliste bleibt leer.

import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import path from "node:path";

export const DAY_MS = 24 * 60 * 60 * 1000;
/** Nach einem Fehlschlag (kein Netz) prüft das Dashboard frühestens nach einer Stunde wieder. */
export const RETRY_AFTER_FAILURE_MS = 60 * 60 * 1000;
/** Beim Start des Dashboards wird geprüft, außer die letzte Prüfung ist jünger als das. */
export const STARTUP_MIN_GAP_MS = 10 * 60 * 1000;
export const CHECK_SCHEMA = "keel-harness-update-check.v1";
export const STATUS_SCHEMA = "keel-harness-update-status.v1";
export const JOB_SCHEMA = "keel-harness-update-job.v1";
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const SEMVER = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/u;

export function parseVersion(value) {
  const match = typeof value === "string" ? SEMVER.exec(value.trim()) : null;
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/** -1, 0, 1 wie der Installer (monotones SemVer); null, wenn eine Seite keine Version ist. */
export function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return null;
  for (let index = 0; index < 3; index += 1) if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  return 0;
}

/**
 * Die Update-Quelle aus dem Installations-Manifest: { repository, branch } eines öffentlichen GitHub-Repos. Alles andere
 * (fremder Host, Pfad mit Zusatz, Anmeldedaten in der Adresse) gilt als unbekannt.
 */
export function parseUpdateSource(value) {
  if (!value || typeof value !== "object") return null;
  const match = /^https:\/\/github\.com\/([A-Za-z0-9_.-]{1,80})\/([A-Za-z0-9_.-]{1,100})$/u.exec(typeof value.repository === "string" ? value.repository : "");
  const branch = typeof value.branch === "string" && /^[A-Za-z0-9._-]{1,60}$/u.test(value.branch) ? value.branch : null;
  if (!match || !branch || match[2].endsWith(".git")) return null;
  const [, owner, name] = match;
  return {
    repository: value.repository, branch,
    manifestUrl: `https://raw.githubusercontent.com/${owner}/${name}/${branch}/manifest.json`,
    commitUrl: `https://api.github.com/repos/${owner}/${name}/commits/${branch}`,
  };
}

export function isNewerVersion(remote, installed) {
  return compareVersions(installed, remote) === -1;
}

/**
 * Die installierte Version aus dem Installations-Manifest des Installers (.keel-harness/state.json). Ohne diese Datei
 * ist der Ordner ein Quellbaum (die Werkbank): dort aktualisiert git, nicht der Installer.
 * mode: "installed" | "source" | "damaged" (Datei da, aber nicht lesbar oder fremd).
 */
export function readInstalledState(harnessRoot) {
  const file = path.join(harnessRoot, ".keel-harness", "state.json");
  if (!existsSync(file)) return { mode: "source", version: null, installedAt: null, updateSource: null };
  try {
    const state = JSON.parse(readFileSync(file, "utf8"));
    if (state && state.schema === "keel-harness-install-state.v1" && state.product?.id === "keel-harness" && parseVersion(state.product.version)) {
      return { mode: "installed", version: state.product.version, installedAt: typeof state.installedAt === "string" ? state.installedAt : null, updateSource: parseUpdateSource(state.product.updateSource) };
    }
  } catch { /* fällt unten auf damaged */ }
  return { mode: "damaged", version: null, installedAt: null, updateSource: null };
}

/**
 * Kurzliste der Änderungen aus dem Commit-Text des Setup-Repos. Der Release-Commit trägt die Form
 * „payload: Release 1.3.3 aus <sha> (Änderung; Änderung); RELEASE_READY …“: die Klammer wird zur Liste, ohne Klammer
 * gilt die Betreffzeile ohne Kennung und ohne Prüfmarke. Trailer wie Co-Authored-By fallen weg.
 */
export function changeSummary(message) {
  if (typeof message !== "string") return [];
  const subject = message.split(/\r?\n/u).find((line) => line.trim() && !/^co-authored-by:/iu.test(line.trim())) ?? "";
  const withoutMarker = subject.replace(/;?\s*RELEASE_READY\b.*$/iu, "").trim();
  const paren = /\(([^()]*(?:\([^()]*\)[^()]*)*)\)\s*$/u.exec(withoutMarker);
  const body = paren ? paren[1] : withoutMarker.replace(/^[a-z-]+:\s*/iu, "").replace(/^Release\s+\S+(\s+aus\s+[0-9a-f]{6,40})?\s*/iu, "");
  return body.split(";").map((item) => item.trim().replace(/\s+/gu, " ")).filter(Boolean).slice(0, 8).map((item) => item.length > 160 ? `${item.slice(0, 157)}…` : item);
}

async function readLimited(response, limit) {
  const text = await response.text();
  if (text.length > limit) throw new Error("Antwort zu groß");
  return text;
}

/**
 * Fragt die neueste Version im öffentlichen Setup-Repo ab (ohne Anmeldung). Wirft bei Netzfehler, Fremdformat
 * oder Zeitüberschreitung; der Aufrufer speichert das als „nicht erreichbar“.
 */
export async function fetchRemoteRelease({ source, fetchImpl = globalThis.fetch, timeoutMs = 10_000 } = {}) {
  if (typeof fetchImpl !== "function") throw new Error("Kein Netzzugriff verfügbar");
  if (!source?.manifestUrl) throw new Error("Die Update-Quelle dieser Installation ist unbekannt");
  const { manifestUrl, commitUrl } = source;
  const manifestResponse = await fetchImpl(manifestUrl, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: "application/json" }, cache: "no-store" });
  if (!manifestResponse.ok) throw new Error(`Setup-Repo antwortet mit ${manifestResponse.status}`);
  const manifest = JSON.parse(await readLimited(manifestResponse, MAX_RESPONSE_BYTES));
  if (!manifest || typeof manifest.schema !== "string" || !manifest.schema.startsWith("keel-harness-standalone.") || manifest.product?.id !== "keel-harness" || !parseVersion(manifest.product?.version)) {
    throw new Error("Das Setup-Repo liefert kein Keel-Harness-Manifest");
  }
  const release = { version: manifest.product.version, commit: null, committedAt: null, message: "", summary: [] };
  try {
    const commitResponse = await fetchImpl(commitUrl, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: "application/vnd.github+json" }, cache: "no-store" });
    if (commitResponse.ok) {
      const commit = JSON.parse(await readLimited(commitResponse, MAX_RESPONSE_BYTES));
      if (typeof commit?.sha === "string") release.commit = commit.sha.slice(0, 40);
      const message = typeof commit?.commit?.message === "string" ? commit.commit.message : "";
      release.message = message.slice(0, 2000);
      release.summary = changeSummary(message);
      const date = commit?.commit?.committer?.date;
      if (typeof date === "string" && !Number.isNaN(Date.parse(date))) release.committedAt = new Date(date).toISOString();
    }
  } catch { /* der Änderungstext ist Beiwerk */ }
  return release;
}

/** Ordner im Datenordner der Installation, in dem Prüfstand, Auftrag, Stand und Protokoll liegen. */
export function updateDirectory(dataDirectory) {
  return path.join(dataDirectory, "harness-update");
}

export function readJson(file) {
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return null; }
}

export function writeJsonAtomic(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", "utf8");
  try { renameSync(temporary, file); }
  catch (error) { try { unlinkSync(temporary); } catch { /* schon weg */ } throw error; }
}

export function appendLog(directory, line, now = new Date()) {
  mkdirSync(directory, { recursive: true });
  const descriptor = openSync(path.join(directory, "update.log"), "a");
  try { writeSync(descriptor, `${now.toISOString()} ${line}\n`); } finally { closeSync(descriptor); }
}

/** Gespeicherter Prüfstand: { attemptedAt, ok, checkedAt, remote, error }. */
export function readCheck(directory) {
  const value = readJson(path.join(directory, "check.json"));
  if (!value || value.schema !== CHECK_SCHEMA || typeof value.attemptedAt !== "string") return null;
  return value;
}

export function checkIsDue(check, nowMs, { startup = false } = {}) {
  if (!check) return true;
  const gap = nowMs - Date.parse(check.attemptedAt);
  if (!Number.isFinite(gap) || gap < 0) return true;
  if (startup) return gap >= STARTUP_MIN_GAP_MS;
  return gap >= (check.ok ? DAY_MS : RETRY_AFTER_FAILURE_MS);
}

/**
 * Eine Prüfung ausführen und speichern. Ein Fehlschlag behält die zuletzt bekannte neueste Version (ein Netzausfall
 * versteckt keinen bekannten Hinweis) und merkt sich nur den Zeitpunkt und den Grund.
 */
export async function runCheck(directory, { now = () => Date.now(), fetchRelease } = {}) {
  const previous = readCheck(directory);
  const attemptedAt = new Date(now()).toISOString();
  let next;
  try {
    const remote = await fetchRelease();
    next = { schema: CHECK_SCHEMA, attemptedAt, ok: true, checkedAt: attemptedAt, remote, error: null };
  } catch (error) {
    next = { schema: CHECK_SCHEMA, attemptedAt, ok: false, checkedAt: previous?.checkedAt ?? null, remote: previous?.remote ?? null, error: error instanceof Error ? error.message : String(error) };
  }
  writeJsonAtomic(path.join(directory, "check.json"), next);
  return next;
}

export function processAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error?.code === "EPERM"; }
}

/**
 * Stand des letzten Aktualisierungslaufs. Ein „running“, dessen Hilfsprozess nicht mehr lebt, ist ein abgebrochener Lauf
 * und wird als Fehlschlag gemeldet (der Hilfsprozess schreibt sonst immer einen Endstand).
 */
export function readStatus(directory, { alive = processAlive } = {}) {
  const value = readJson(path.join(directory, "status.json"));
  if (!value || value.schema !== STATUS_SCHEMA || typeof value.state !== "string") return null;
  if (value.state === "running" && !alive(value.helperPid)) {
    return { ...value, state: "failed", message: "Die Aktualisierung wurde abgebrochen, bevor sie fertig war. Das Protokoll nennt den letzten Schritt." };
  }
  return value;
}

/** Startschalter des Dashboards, aus der Umgebung des laufenden Web-Prozesses gelesen (voice/launcher.mjs setzt sie). */
export function launcherFlags(env) {
  const speech = env.KEEL_PROTOTYPE_SPEECH === "1";
  const microphone = env.KEEL_PROTOTYPE_MICROPHONE === "1";
  const flags = [];
  if (speech && microphone) flags.push("--voice");
  else { if (speech) flags.push("--speech"); if (microphone) flags.push("--microphone"); }
  if (env.KEEL_PROTOTYPE_INFERENCE === "0") flags.push("--no-inference");
  return flags;
}
