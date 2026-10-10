// Hintergrund-Job „Architekturbilder“ (Paket new-harness-architecture-maps, Plan-Schritt 7,
// Gates J3 und J5; repariert im Paket harness-dashboard-repair, Plan-Schritte 18 bis 23, Gates A1 bis A6).
// Vertrag: design/decisions.md F1 (Auslöser), F2 (Meldung), F3 (Ablage), F5 (Aufruf je Anbieter).
// Ruft NIE selbst ein Modell auf; `cliRunner` ist immer von außen übergeben (run.mjs mit der echten CLI,
// ein Stub in jedem Test).
//
// Modellwahl: Dieses Modul nennt nirgends einen Modellnamen. Das Modell kommt bei jedem Lauf neu aus
// new-harness-process-model-settings über `resolveProcessModelForRun({ processId: PROCESS_ID, ... })`
// (Gate J5); die Voreinstellung (Stufe low, Owner 26.09.2026) steht im Prozess-Register
// harness-core/process-models/registry.mjs, der einzigen Stelle für Modellnamen.

import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, realpathSync, statSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { replaceFileSync } from "../execution/atomic-file.mjs";
import gitBinary from "../git/git-binary.cjs";
import { resolveClaudeExecutable } from "../execution/codex-plugin-bootstrap.mjs";
import { resolveProcessModelForRun } from "../process-models/index.mjs";
import { holderLives, lockTimeMs } from "../system/process-identity.mjs";
import { DEFAULT_FLOOR_GB, ramFloorBytes } from "../system/ram-floor.mjs";
import { IGNORE_FILE_NAME, buildUnderstandIgnore } from "./ignore-proposal.mjs";
import { createHash } from "node:crypto";
import { LOCK_FILE, PLUGIN_DIR, assertIsolated, buildUaConfig, gitExcludeEntry, pluginBuildStatus, pluginDirArguments, resolveDataDirectoryName, runPluginPrebuild } from "./isolation.mjs";

export const PROCESS_ID = "architecture-maps";
export const COOLDOWN_MS = 10 * 60 * 1000; // Beruhigungszeit (design/decisions.md F1)
export const TRIGGER_INTERVAL_MS = 10 * 60 * 1000; // Auslöser alle 10 Minuten (Gate A6)
// Die Speichergrenze ist die eine Untergrenze für freien Arbeitsspeicher (harness-core/system/ram-floor.mjs, Vorgabe 4 GB,
// einstellbar von 2 bis 4 GB); diese Konstante ist nur noch die Vorgabe (P13, C2).
export const MEMORY_MINIMUM_BYTES = DEFAULT_FLOOR_GB * 1024 ** 3;
export const SUPPORTED_PROVIDERS = Object.freeze(["claude"]);
export const RUN_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "run.mjs");

export class ArchitectureMapsJobError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "ArchitectureMapsJobError";
    Object.assign(this, details);
  }
}

// --- Datenordner der Installation (design/decisions.md F3: neben accountability/, nicht darin) ----
//
// Dieselbe Basis-Regel wie `processModelsDataDirectory` in harness-core/process-models/store.mjs,
// hier dupliziert statt importiert: jene Funktion liefert den je-Harness gehashten
// `accountability/<hash>`-Ordner für genau ein Projekt, der Architektur-Job braucht dagegen einen
// Ordner für BELIEBIG VIELE eingeschaltete Projekte auf derselben Installation
// (`architecture-maps/`, Geschwister von `accountability/`). Vorschlag an new-harness-process-model-settings,
// die Basis-Berechnung gemeinsam zu nutzen: ARCH-N16 (siehe PACKAGE.md Anhang).
export function installationDataRoot({ env = process.env, platform = process.platform, home = os.homedir() } = {}) {
  if (env.KEEL_ACCOUNTABILITY_DATA_DIR) return path.resolve(env.KEEL_ACCOUNTABILITY_DATA_DIR, "..");
  return platform === "win32"
    ? path.join(env.LOCALAPPDATA || path.join(home, "AppData", "Local"), "KeelHarness")
    : path.join(env.XDG_DATA_HOME || path.join(home, ".local", "share"), "keel-harness");
}

export function architectureMapsDataDirectory(options = {}) {
  const direct = typeof options.env?.ARCHITECTURE_MAPS_DATA_DIR === "string" ? options.env.ARCHITECTURE_MAPS_DATA_DIR.trim() : "";
  if (direct) return path.resolve(direct);
  return path.join(installationDataRoot(options), "architecture-maps");
}

/** Projektschlüssel = die Repository-Wurzel selbst (ARCH-N7), nicht ein frei gewählter Name. */
export function projectKey(projectRoot) {
  return path.resolve(projectRoot).replace(/[\\/]+$/u, "");
}

const PROJECTS_FILE = "projects.json";
const emptyRegistry = () => ({ schema: 1, projects: {} });

export function readProjectsRegistry(dataDir) {
  try {
    const value = JSON.parse(readFileSync(path.join(dataDir, PROJECTS_FILE), "utf8"));
    if (value && typeof value === "object" && value.projects && typeof value.projects === "object") return value;
  } catch (error) {
    if (error?.code !== "ENOENT") throw new ArchitectureMapsJobError("Die Projektliste ist nicht lesbar.", { cause: error });
  }
  return emptyRegistry();
}

function writeProjectsRegistry(dataDir, registry) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const file = path.join(dataDir, PROJECTS_FILE);
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, JSON.stringify(registry, null, 2), { encoding: "utf8", mode: 0o600 });
  replaceFileSync(temporary, file);
}

/** Schaltet ein Projekt ein: bestätigte Kostenschätzung ist Pflicht (Gate V2, F3). */
export function setProjectEnabled(dataDir, projectRoot, { confirmedEstimate, now = new Date() } = {}) {
  if (!confirmedEstimate) throw new ArchitectureMapsJobError("Ein Projekt wird nur mit bestätigter Kostenschätzung eingeschaltet.");
  const registry = readProjectsRegistry(dataDir);
  const key = projectKey(projectRoot);
  registry.projects[key] = { root: key, enabled: true, enabledAt: now.toISOString(), confirmedEstimate };
  writeProjectsRegistry(dataDir, registry);
  return registry.projects[key];
}

export function setProjectDisabled(dataDir, projectRoot) {
  const registry = readProjectsRegistry(dataDir);
  const key = projectKey(projectRoot);
  if (registry.projects[key]) registry.projects[key].enabled = false;
  writeProjectsRegistry(dataDir, registry);
}

export function isProjectEnabled(dataDir, projectRoot) {
  return Boolean(readProjectsRegistry(dataDir).projects[projectKey(projectRoot)]?.enabled);
}

/** Alle eingeschalteten Projektwurzeln (für den Auslöser). */
export function enabledProjects(dataDir) {
  return Object.values(readProjectsRegistry(dataDir).projects).filter((entry) => entry?.enabled && typeof entry.root === "string").map((entry) => entry.root);
}

/** Trägt `.git/info/exclude`, `.ua/config.json` und `.ua/.understandignore` ein (design/decisions.md F3, Gate A3), idempotent. */
export function ensureProjectPrepared(projectRoot, options = {}) {
  const dataDirectoryName = resolveDataDirectoryName(projectRoot);
  const excludeFile = path.join(projectRoot, ".git", "info", "exclude");
  const entry = gitExcludeEntry(dataDirectoryName);
  let current = "";
  try { current = readFileSync(excludeFile, "utf8"); } catch (error) { if (error?.code !== "ENOENT") throw error; }
  if (!current.split(/\r?\n/u).map((line) => line.trim()).includes(entry)) {
    mkdirSync(path.dirname(excludeFile), { recursive: true });
    writeFileSync(excludeFile, `${current}${current && !current.endsWith("\n") ? "\n" : ""}${entry}\n`, "utf8");
  }
  const configFile = path.join(projectRoot, dataDirectoryName, "config.json");
  mkdirSync(path.dirname(configFile), { recursive: true });
  writeFileSync(configFile, `${JSON.stringify(buildUaConfig(), null, 2)}\n`, "utf8");
  const ignore = writeApprovedIgnoreFile(projectRoot, dataDirectoryName, options);
  return { dataDirectoryName, excludeFile, configFile, ignoreFile: ignore.file, ignoreWritten: ignore.written };
}

export const MANAGED_IGNORE_HEADER = "# Angelegt vom Architekturbild-Job";

/**
 * Gate A3 (harness-dashboard-repair Plan-Schritt 20): der Job legt die freigegebene Ignore-Datei selbst als
 * `<datenordner>/.understandignore` an (ignore-proposal.mjs: Owner-Vorschlag plus unversionierte Pfade).
 * Eine Datei, die nicht vom Job stammt (erste Zeile ohne Kennung), bleibt unangetastet: dann hat jemand
 * den Umfang bewusst von Hand gesetzt. Die Datei des Jobs wird bei jedem Lauf neu geschrieben, damit ein
 * neu entstandener unversionierter Ordner draußen bleibt.
 */
export function writeApprovedIgnoreFile(projectRoot, dataDirectoryName = resolveDataDirectoryName(projectRoot), { untracked } = {}) {
  const file = path.join(projectRoot, dataDirectoryName, IGNORE_FILE_NAME);
  let current = null;
  try { current = readFileSync(file, "utf8"); } catch (error) { if (error?.code !== "ENOENT") throw error; }
  if (current !== null && !current.startsWith(MANAGED_IGNORE_HEADER)) return { file, written: false };
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, buildUnderstandIgnore(projectRoot, { untracked, dataDirectoryName }), "utf8");
  return { file, written: true };
}

// --- Protokoll je Projekt (design/decisions.md F2, F3) ---------------------------------------------

function projectDataFolder(dataDir, projectRoot) {
  return path.join(dataDir, projectKey(projectRoot).replace(/^([A-Za-z]):/u, "$1").replace(/[\\/:]+/gu, "_"));
}

function runsLogFile(dataDir, projectRoot) {
  return path.join(projectDataFolder(dataDir, projectRoot), "runs.jsonl");
}

export function appendRunLog(dataDir, projectRoot, entry) {
  const file = runsLogFile(dataDir, projectRoot);
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  let lines = [];
  try { lines = readFileSync(file, "utf8").split(/\r?\n/u).filter(Boolean); } catch (error) { if (error?.code !== "ENOENT") throw error; }
  lines.push(JSON.stringify(entry));
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, lines.slice(-500).join("\n") + "\n", "utf8");
  replaceFileSync(temporary, file);
  return file;
}

export function readRunLog(dataDir, projectRoot) {
  try { return readFileSync(runsLogFile(dataDir, projectRoot), "utf8").split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line)); }
  catch (error) { if (error?.code === "ENOENT") return []; throw error; }
}

// --- Graph-Stand und Vergleichsstand (design/decisions.md F1, F2; Gate A6) ------------------------

/**
 * Graph-Stand aus `.ua/meta.json`. Der Skill schreibt dort `lastAnalyzedAt` (SKILL.md Phase 7 Schritt 3,
 * finalize-incremental.mjs), nicht `analyzedAt`; Probe 3 mit Sonnet 5 (28.09.2026) schrieb einen vollständigen Graphen
 * samt meta.json zum richtigen Commit, und der Job meldete trotzdem „kein .ua/meta.json“. Beide Schreibweisen
 * gelten; zurück kommt immer `analyzedAt` (so liest es das Dashboard).
 */
export function readGraphMeta(projectRoot) {
  const dataDirectoryName = resolveDataDirectoryName(projectRoot);
  try {
    const meta = JSON.parse(readFileSync(path.join(projectRoot, dataDirectoryName, "meta.json"), "utf8"));
    const analyzedAt = typeof meta?.analyzedAt === "string" ? meta.analyzedAt : typeof meta?.lastAnalyzedAt === "string" ? meta.lastAnalyzedAt : null;
    if (typeof meta?.gitCommitHash === "string" && analyzedAt) return { ...meta, analyzedAt };
  } catch (error) { if (error?.code !== "ENOENT") throw new ArchitectureMapsJobError("Der Graph-Stand ist nicht lesbar.", { cause: error }); }
  return null;
}

function git(args, projectRoot) {
  const result = gitBinary.gitSync(args, { cwd: projectRoot, encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new ArchitectureMapsJobError(`git ${args.join(" ")} schlug fehl: ${result.stderr || result.status}`);
  return result.stdout.trim();
}

/**
 * Stand, gegen den Graph und Veraltet-Hinweis verglichen werden (Gate A6): HEAD des Arbeitsbaums, den der
 * Owner vor sich hat. Früher wurde gegen den lokalen Zweig `main` (bzw. origin/HEAD) verglichen; der kann
 * hinter dem ausgecheckten Stand zurückliegen (Befund 28.09.2026), und der Skill selbst schreibt
 * `git rev-parse HEAD` als `gitCommitHash` (SKILL.md Phase 0, Schritt 2). `branch` ist der Name des
 * ausgecheckten Zweigs, bei abgelöstem HEAD „HEAD“. Der Name der Funktion bleibt für bestehende Aufrufer.
 */
export function resolveDefaultBranchHead(projectRoot) {
  let branch = "";
  try { branch = git(["branch", "--show-current"], projectRoot); } catch { branch = ""; }
  branch = branch || "HEAD";
  const commit = git(["rev-parse", "--verify", "HEAD"], projectRoot);
  const committedAtSeconds = Number(git(["show", "-s", "--format=%ct", commit], projectRoot));
  return { branch, commit, committedAtMs: committedAtSeconds * 1000 };
}

export function changedFilesSince(fromCommit, toCommit, projectRoot) {
  if (!fromCommit || fromCommit === toCommit) return [];
  const out = git(["diff", `${fromCommit}..${toCommit}`, "--name-only"], projectRoot);
  return out ? out.split("\n").filter(Boolean) : [];
}

/**
 * F1: der Job läuft, wenn (a) HEAD vom Graph-Commit abweicht und mindestens `cooldownMs` alt ist, oder
 * (b) `forced` (Owner-Knopf „jetzt aktualisieren“, ohne Beruhigungszeit).
 */
export function shouldRun({ graphMeta, head, now = new Date(), cooldownMs = COOLDOWN_MS, forced = false }) {
  if (!graphMeta) return { run: true, reason: "erste Analyse: noch kein Graph vorhanden" };
  if (graphMeta.gitCommitHash === head.commit) return { run: false, reason: "kein neuer Commit seit dem letzten Graphen" };
  if (forced) return { run: true, reason: "Owner-Knopf „jetzt aktualisieren“" };
  const age = now.getTime() - head.committedAtMs;
  if (age < cooldownMs) return { run: false, reason: `Beruhigungszeit: Commit ist erst ${Math.round(age / 1000)}s alt (Grenze ${cooldownMs / 1000}s)` };
  return { run: true, reason: `neuer Commit ${head.commit.slice(0, 12)}, Beruhigungszeit verstrichen` };
}

// --- Speichergrenze -----------------------------------------------------------------------------

const gigabytes = (bytes) => String(Math.round((bytes / 1024 ** 3) * 10) / 10);

export function assertMemoryAvailable({ freeBytes, harnessRoot, env = process.env, minimumBytes = ramFloorBytes(harnessRoot, env) }) {
  if (!Number.isFinite(freeBytes)) throw new ArchitectureMapsJobError("Freier Speicher ist nicht gemessen; kein Start ohne Messung.");
  if (freeBytes < minimumBytes) {
    throw new ArchitectureMapsJobError(`Zu wenig freier Speicher (${gigabytes(freeBytes)} GB < ${gigabytes(minimumBytes)} GB); kein Start unter der Speichergrenze.`,
      { code: "memory_below_limit", freeBytes, minimumBytes });
  }
}

// --- Höchstens ein Lauf gleichzeitig (Sperre nach dem Muster von process-models/store.mjs) --------

function lockFilePath(dataDir) {
  return path.join(dataDir, "job.lock");
}

function defaultIsAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error?.code !== "ESRCH"; }
}

/** Erwirbt die Job-Sperre oder wirft, wenn schon ein Lauf läuft (kein Warten: „höchstens ein Job gleichzeitig“). */
export function acquireJobLock(dataDir, { now = new Date(), isAlive = defaultIsAlive, lock = lockFilePath(dataDir) } = {}) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  try {
    const handle = openSync(lock, "wx", 0o600);
    // acquiredAt is the real time of this process (startedAt may be an injected clock): with the process number it
    // proves who holds the lock (P13, C10).
    writeSync(handle, JSON.stringify({ pid: process.pid, startedAt: now.toISOString(), acquiredAt: new Date().toISOString() }));
    return { release: () => { try { closeSync(handle); } catch { /* schon geschlossen */ } try { unlinkSync(lock); } catch { /* schon entfernt */ } } };
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  let owner = null;
  try { owner = JSON.parse(readFileSync(lock, "utf8")); } catch { /* unlesbar: als verwaist behandeln */ }
  // Verwaist ist die Sperre nur, wenn ihr Halter tot ist (Prozessnummer und Startzeit, keine feste Zeit: ein Lauf darf
  // beliebig lange dauern; P13, C10). Eine unlesbare Sperre oder eine ohne Prozessnummer (älteres Format) gilt wie bisher als verwaist.
  const stale = !owner || !Number.isSafeInteger(owner.pid) || !holderLives(owner.pid, lockTimeMs(owner), { alive: isAlive });
  if (!stale) {
    throw new ArchitectureMapsJobError("Es läuft schon ein Architekturbild-Job; höchstens ein Lauf gleichzeitig.", { code: "job_already_running", owner });
  }
  try { unlinkSync(lock); } catch { /* schon entfernt */ }
  return acquireJobLock(dataDir, { now, isAlive, lock });
}

/** Läuft gerade ein Job? (lesend, ohne die Sperre zu nehmen; für den Auslöser) */
export function isJobRunning(dataDir, { isAlive = defaultIsAlive } = {}) {
  try {
    const owner = JSON.parse(readFileSync(lockFilePath(dataDir), "utf8"));
    return Number.isSafeInteger(owner?.pid) && isAlive(owner.pid);
  } catch { return false; }
}

// --- Aufruf (design/decisions.md F5; Gates A1, A2, A5) ----------------------------------------------
//
// Diese Datei nennt bewusst kein Modell (hardwire-scan.mjs deckt harness-core/architecture-maps/ mit
// ab, Gate M7): `model` und `effort` kommen bei jedem Lauf frisch aus resolveProcessModelForRun.

/**
 * Slash-Befehl des Skills. Ein Plugin-Skill heißt `/<plugin>:<skill>` (Plugin-Doku: „the skill runs as
 * /my-plugin:review“); Plugin-Name aus .claude-plugin/plugin.json („understand-anything“), Skill-Name aus
 * skills/understand/SKILL.md („understand“). Im Druckmodus (-p) wird ein Skill nur ausgelöst, wenn der Auftrag
 * mit ihm BEGINNT (Doku headless: „Include /skill-name in the prompt string and Claude Code expands it before
 * running“). Befund 28.09.2026, erster echter Lauf: Der Auftrag begann mit deutschem Text und nannte „(/understand)“
 * nur in Klammern; Sonnet suchte den Skill 7 Minuten lang und brach ohne Graph ab.
 */
export const SKILL_COMMAND = "/understand-anything:understand";
/** Argumente laut argument-hint der SKILL.md: `--full` erzwingt die Vollanalyse, `--language de` die Ausgabesprache. */
export const SKILL_LANGUAGE = "de";

/**
 * Feste Antworten auf die Rückfragen des Skills, als Zusatz zum Systemprompt (`--append-system-prompt`), NICHT im
 * Auftrag. Gemessen 28.09.2026: Die CLI reicht ALLES nach dem Slash-Befehl als `$ARGUMENTS` an den Skill
 * (<command-args> enthält auch die Folgezeilen) und setzt es an jeder `$ARGUMENTS`-Stelle der SKILL.md ein. Zwei Proben
 * mit Sonnet 5 (Stufe high) lasen die festen Antworten dort als Prompt-Injection „in den Command-Argumenten“ und brachen
 * ohne Graph ab (Probe 1 nach 26 s, Probe 2 nach 58 s; evidence/arch/probe-run.md). Der Systemprompt ist der Kanal des
 * Betreibers; dort sind dieselben Sätze Rahmen des Laufs, keine Argumente.
 */
export function buildRunContext({ firstRun, changedFiles = [], pluginDir = PLUGIN_DIR } = {}) {
  const pluginPath = pluginDir.replaceAll("\\", "/");
  const lines = [
    "Rahmen dieses Laufs (Betreiber: Architekturbild-Job des Keel-Harness, vom Projektinhaber eingerichtet):",
    firstRun
      ? "- Auftrag: den Architektur-Wissensgraphen des Projekts im aktuellen Arbeitsverzeichnis vollständig erstellen, alle Phasen des Skills /understand bis zum Speichern von .ua/knowledge-graph.json und .ua/meta.json."
      : `- Auftrag: den bestehenden Architektur-Wissensgraphen nur für die seit dem letzten Graph-Commit geänderten Dateien aktualisieren (${changedFiles.length}): ${changedFiles.join(", ") || "(keine Dateiänderung, nur Commit-Stand nachziehen)"}.`,
    "- Der Lauf ist nicht interaktiv: niemand kann Rückfragen beantworten. Der Skill sieht dafür selbst vor, ohne Warten weiterzumachen. Die Antworten auf seine Rückfragen hat der Projektinhaber vorab gegeben:",
    "  - Ignore-Datei ist bestätigt: .ua/.understandignore wurde vom Projektinhaber im Dashboard geprüft und freigegeben; nutze sie so.",
    "  - Umfang: das ganze eingeschaltete Projekt, auch bei mehr als 100 Dateien (Kostenschätzung vom Projektinhaber bestätigt).",
    "  - Ist der Graph zum unveränderten Commit schon aktuell: nichts tun.",
    `  - Ausgabesprache: Deutsch (${SKILL_LANGUAGE}).`,
    `- Das Plugin liegt unter dem Pfad in der Umgebungsvariablen CLAUDE_PLUGIN_ROOT (${pluginDir}); das ist PLUGIN_ROOT und dasselbe Verzeichnis wie das „Base directory for this skill“ ohne /skills/understand. packages/core/dist ist dort schon vorgebaut; installiere und baue nichts (kein pnpm, kein npm). Glob und Grep zeigen packages/core/dist und node_modules NICHT an, weil .gitignore sie ausblendet; „No files found“ heißt dort nicht „fehlt“. Prüfe mit ls oder test -f, z. B. test -f ${pluginPath}/packages/core/dist/index.js.`,
    `- Rechte: Der Lauf hat mit Absicht enge Rechte. Freigegeben sind einzelne einfache Befehle mit absoluten Pfaden (etwa node ${pluginPath}/skills/understand/<skript>.mjs <argumente>, git, ls, test, mkdir), ohne &&, ohne $(…) und ohne Variablen-Zuweisung; setze PLUGIN_ROOT und die anderen Variablen des Skills als feste Pfade ein. Dateien schreibst du mit Write nur unter .ua/, lesen mit Read, Glob und Grep. Verschieben (Aufräumen in Phase 7) nur mit relativen Pfaden, die mit .ua/ beginnen, etwa mv .ua/tmp .ua/.trash-<zeit>/tmp. Ändere keine andere Datei.`,
  ];
  return lines.join("\n");
}

/**
 * Auftrag an die CLI (Gate J3): genau der Slash-Befehl des Skills mit seinen Schaltern, damit `-p` ihn auslöst; beim
 * ersten Lauf mit `--full`, sonst ohne (der Skill erkennt die geänderten Dateien selbst über seine Fingerabdrücke).
 * Die festen Antworten stehen in buildRunContext.
 */
export function buildTask({ firstRun } = {}) {
  return `${SKILL_COMMAND} ${firstRun ? "--full " : ""}--language ${SKILL_LANGUAGE}`;
}

export function providerSupportError(resolution) {
  if (SUPPORTED_PROVIDERS.includes(resolution.provider)) return null;
  return `Anbieter für Architekturbilder nicht unterstützt: ${resolution.provider || "(keiner)"} (F5, nur ${SUPPORTED_PROVIDERS.join(", ")}).`;
}

/**
 * Rechte des Laufs (Gate A5). Statt `bypassPermissions` (alle Rückfragen übergangen, jedes Werkzeug frei)
 * läuft die CLI im Modus `dontAsk`: was nicht ausdrücklich erlaubt ist, wird ohne Rückfrage abgelehnt.
 * Werkzeuge: nur die eingebauten, die der Skill braucht (SKILL.md: Bash für die Skripte des Skills,
 * Read/Glob/Grep zum Lesen, Write/Edit für die Zwischenergebnisse, Agent für die Unteragenten
 * project-scanner, file-analyzer, architecture-analyzer, tour-builder, assemble-reviewer). Schreiben
 * mit Write/Edit nur unter `.ua/`. Bash nur für die Programme, die der Skill aufruft. Netz, Installation
 * und Löschen bleiben gesperrt. Grenze: Bash-Befehle selbst schreiben über die Skripte des Skills nach
 * `.ua/`; einen Schreibschutz auf Dateisystem-Ebene gibt es unter Windows nicht (kein Sandbox-Modus der
 * CLI), er gilt nur über diese Befehlsliste. Beleg des Probe-Laufs: evidence/arch/rechte.md.
 */
export const RUN_TOOLS = Object.freeze(["Bash", "Read", "Write", "Edit", "Glob", "Grep", "Agent"]);
export const RUN_ALLOWED_RULES = Object.freeze([
  "Read", "Glob", "Grep", "Agent",
  "Edit(./.ua/**)", "Write(./.ua/**)",
  "Bash(cd:*)", "Bash(node:*)", "Bash(python:*)", "Bash(python3:*)", "Bash(git:*)",
  "Bash(mkdir:*)", "Bash(find:*)", "Bash(test:*)", "Bash(ls:*)", "Bash(cat:*)", "Bash(head:*)", "Bash(wc:*)",
  "Bash(realpath:*)", "Bash(readlink:*)", "Bash(dirname:*)", "Bash(pwd)", "Bash(echo:*)", "Bash(mv .ua/:*)",
]);
export const RUN_DENIED_RULES = Object.freeze([
  "WebFetch", "WebSearch",
  "Bash(rm:*)", "Bash(curl:*)", "Bash(wget:*)", "Bash(npm:*)", "Bash(npx:*)", "Bash(pnpm:*)", "Bash(git push:*)", "Bash(git commit:*)",
]);
export const RUN_PERMISSION_MODE = "dontAsk";

/**
 * Argumente der Claude-CLI für genau diesen Lauf (design/decisions.md F5): Plugin nur für diese
 * Sitzung, aufgelöstes Modell und Stufe (`--effort`, der Schalter aus `claude --help`), weder Nutzer-
 * noch Projekt-Hooks des Harness (`--setting-sources ""`), JSON-Ausgabe mit Token-Zahlen. `executable`
 * ist claude.exe statt des npm-Shims (Gate A1): unter Windows startet Node den .cmd/.ps1-Shim ohne Shell
 * nicht; der Pfad ist über `CLAUDE_EXE` einstellbar (dieselbe Variable wie im Dashboard,
 * lib/accountability/assistant-runtime.ts) und wird sonst wie im Package-Executor neben dem Shim gesucht
 * (resolveClaudeExecutable). `env` geht zusätzlich an den Kindprozess: CLAUDE_PLUGIN_ROOT, damit der Skill
 * das vendorierte Plugin findet (SKILL.md Phase 0, 1.5). `runContext` (buildRunContext) geht als
 * `--append-system-prompt` mit: die festen Antworten gehören in den Kanal des Betreibers, nicht hinter den
 * Slash-Befehl (Proben 28.09.2026). Reine Datenfunktion, ruft nichts auf.
 */
export function buildInvocation({ task, runContext, model, effort, settingsFile, pluginDir = PLUGIN_DIR, env = process.env, platform = process.platform } = {}) {
  if (!task) throw new ArchitectureMapsJobError("Kein Auftrag für den Lauf gebildet.");
  if (!model) throw new ArchitectureMapsJobError("Kein Modell aufgelöst; kein Lauf ohne ausdrückliche Wahl.");
  const requested = typeof env.CLAUDE_EXE === "string" && env.CLAUDE_EXE.trim() ? env.CLAUDE_EXE.trim() : undefined;
  return {
    executable: resolveClaudeExecutable(requested, env, platform),
    args: [
      "-p", task,
      ...(runContext ? ["--append-system-prompt", runContext] : []),
      ...pluginDirArguments({ pluginDir }),
      "--model", model,
      ...(effort ? ["--effort", effort] : []),
      "--permission-mode", RUN_PERMISSION_MODE,
      "--tools", RUN_TOOLS.join(","),
      "--allowedTools", ...RUN_ALLOWED_RULES,
      "--disallowedTools", ...RUN_DENIED_RULES,
      "--output-format", "json",
      ...(settingsFile ? ["--settings", settingsFile] : []),
      "--setting-sources", "",
    ],
    env: { CLAUDE_PLUGIN_ROOT: pluginDir },
  };
}

/** Token-Zahlen und Kosten aus der JSON-Ausgabe der CLI (`--output-format json`), sonst null. */
export function parseCliUsage(stdout) {
  if (typeof stdout !== "string" || !stdout.trim()) return null;
  let value;
  try { value = JSON.parse(stdout.trim().split(/\r?\n/u).filter(Boolean).pop()); } catch { return null; }
  if (!value || typeof value !== "object") return null;
  const usage = value.usage && typeof value.usage === "object" ? value.usage : {};
  const number = (field) => (Number.isFinite(usage[field]) ? usage[field] : 0);
  const modelUsage = value.modelUsage && typeof value.modelUsage === "object" ? value.modelUsage : null;
  // `usage` zählt nur die Hauptsitzung; `modelUsage` enthält alle Unteragenten des Skills (Probe-Lauf 28.09.2026:
  // usage 2.615 Ausgabe-Tokens, modelUsage 42.672). Deshalb gewinnt die Summe über modelUsage.
  const sum = (field) => Object.values(modelUsage ?? {}).reduce((total, entry) => total + (Number.isFinite(entry?.[field]) ? entry[field] : 0), 0);
  return {
    inputTokens: modelUsage ? sum("inputTokens") : number("input_tokens"),
    cacheCreationInputTokens: modelUsage ? sum("cacheCreationInputTokens") : number("cache_creation_input_tokens"),
    cacheReadInputTokens: modelUsage ? sum("cacheReadInputTokens") : number("cache_read_input_tokens"),
    outputTokens: modelUsage ? sum("outputTokens") : number("output_tokens"),
    costUsd: Number.isFinite(value.total_cost_usd) ? value.total_cost_usd : null,
    numTurns: Number.isFinite(value.num_turns) ? value.num_turns : null,
    durationMs: Number.isFinite(value.duration_ms) ? value.duration_ms : null,
    permissionDenials: Array.isArray(value.permission_denials) ? value.permission_denials.length : 0,
    isError: value.is_error === true,
    subtype: typeof value.subtype === "string" ? value.subtype : null,
    resultText: typeof value.result === "string" ? value.result.slice(0, 600) : null,
    modelUsage,
  };
}

/**
 * Hat der Lauf einen Graphen zum aktuellen Stand geschrieben? Die CLI meldet auch dann „success“ mit Exit 0,
 * wenn der Skill wegen abgelehnter Rechte aufgibt (Probe-Lauf 28.09.2026); erst `.ua/meta.json` mit dem
 * Commit des Laufs und `knowledge-graph.json` belegen ein Ergebnis.
 */
export function graphWrittenError(projectRoot, headCommit, usage) {
  const meta = readGraphMeta(projectRoot);
  const graphFile = path.join(projectRoot, resolveDataDirectoryName(projectRoot), "knowledge-graph.json");
  let graphPresent = false;
  try { graphPresent = statSync(graphFile).isFile(); } catch { graphPresent = false; }
  if (meta?.gitCommitHash === headCommit && graphPresent) return null;
  const denials = usage?.permissionDenials ? `, ${usage.permissionDenials} abgelehnte Werkzeugaufrufe` : "";
  const said = usage?.resultText ? ` Antwort: ${tail(usage.resultText, 300)}` : "";
  return `Lauf endete ohne neuen Graphen (kein .ua/meta.json zu ${headCommit.slice(0, 12)}${denials}).${said}`;
}

/** Echte Langform eines Pfads (löst 8.3-Kurznamen und Verknüpfungen auf); ohne Zugriff der Pfad selbst. */
export function realProjectRoot(projectRoot) {
  try { return realpathSync.native(projectRoot); } catch { return path.resolve(projectRoot); }
}

/**
 * Claude Code schützt Schreibzugriffe unter `~/.claude` in jedem Modus außer bypassPermissions (gemessen
 * 28.09.2026: Edit(./.ua/**) erlaubt im Projekt außerhalb, unter ~/.claude/wt abgelehnt). Ein Projekt dort
 * kann der abgesicherte Lauf nicht analysieren; der Job sagt das, statt still zu scheitern.
 */
export function protectedLocationError(projectRoot, { home = os.homedir() } = {}) {
  const claudeDir = path.resolve(home, ".claude").toLowerCase() + path.sep;
  return (path.resolve(projectRoot).toLowerCase() + path.sep).startsWith(claudeDir)
    ? `Das Projekt liegt unter ${path.join(home, ".claude")}; Claude Code lässt dort keine Schreibzugriffe ohne bypassPermissions zu, der abgesicherte Lauf (Gate A5) kann es nicht analysieren.`
    : null;
}

function tail(text, max = 600) {
  const value = typeof text === "string" ? text.trim() : "";
  return value.length > max ? `…${value.slice(-max)}` : value;
}

/** Fehlertext eines CLI-Ergebnisses (Startfehler, Exit-Code, Fehlerergebnis der CLI), sonst null. */
export function cliResultError(result) {
  if (!result) return "Kein Ergebnis vom Aufruf.";
  if (result.hung) return `CLI hing (keine Ausgabe und keine Arbeit, kein Zeitlimit erreicht): ${tail(result.hungReason)}`;
  if (result.error) return `CLI startete nicht: ${result.error.message || result.error.code || String(result.error)}`;
  if (result.status !== 0) return `CLI endete mit Exit-Code ${result.status ?? "unbekannt"}${result.stderr ? `: ${tail(result.stderr)}` : ""}`;
  const usage = parseCliUsage(result.stdout);
  if (usage?.isError) return `CLI meldete einen Fehler (${usage.subtype || "unbekannt"})`;
  return null;
}

/**
 * Ein vollständiger Lauf (Gates J3, J5): Isolation, Speichergrenze, Sperre, Auslöser, Vorbau, Modellwahl,
 * Auftrag, Aufruf über `cliRunner` (nie die echte CLI in einem Test; er darf auch asynchron antworten, die echte läuft
 * unter dem Stille-Wächter, P15), Protokoll mit Fehler und Tokens.
 * `pluginStatus` ist injizierbar (Tests); ohne Angabe wird der Vorbau im Plugin-Ordner geprüft.
 */
export async function runArchitectureMapsJob({
  projectRoot, dataDir, harnessRoot, env = process.env, now = new Date(), freeMemoryBytes,
  forced = false, cliRunner, owns = [], settingsFile, pluginStatus,
}) {
  assertMemoryAvailable({ freeBytes: freeMemoryBytes, harnessRoot, env });
  assertIsolated({ projectRoot });
  if (!isProjectEnabled(dataDir, projectRoot)) return { started: false, reason: "not_enabled" };

  let lock;
  try {
    lock = acquireJobLock(dataDir, { now });
  } catch (error) {
    if (error?.code === "job_already_running") return { started: false, reason: "job_already_running" };
    throw error;
  }

  const logBase = { at: now.toISOString(), processId: PROCESS_ID, project: projectKey(projectRoot) };
  try {
    ensureProjectPrepared(projectRoot);
    const graphMeta = readGraphMeta(projectRoot);
    const head = resolveDefaultBranchHead(projectRoot);
    const decision = shouldRun({ graphMeta, head, now, forced });
    if (!decision.run) {
      appendRunLog(dataDir, projectRoot, { ...logBase, started: false, reason: decision.reason });
      return { started: false, reason: decision.reason };
    }

    const resolution = resolveProcessModelForRun({ processId: PROCESS_ID, harnessRoot, env, owns });
    const unsupported = providerSupportError(resolution);
    if (unsupported) {
      appendRunLog(dataDir, projectRoot, { ...logBase, started: false, reason: unsupported, resolution });
      return { started: false, reason: unsupported, resolution };
    }

    const build = pluginStatus ?? pluginBuildStatus();
    if (!build.built) {
      const reason = "Plugin nicht vorgebaut (packages/core/dist fehlt); der Vorbau mit pnpm laut Freigabe kommt vor dem ersten Lauf, der Job installiert nichts selbst.";
      appendRunLog(dataDir, projectRoot, { ...logBase, started: false, reason, error: reason });
      return { started: false, reason };
    }

    const protectedError = protectedLocationError(realProjectRoot(projectRoot), { home: realProjectRoot(env.USERPROFILE || os.homedir()) });
    if (protectedError) {
      appendRunLog(dataDir, projectRoot, { ...logBase, started: false, reason: protectedError, error: protectedError });
      return { started: false, reason: protectedError, error: protectedError };
    }

    const changedFiles = graphMeta ? changedFilesSince(graphMeta.gitCommitHash, head.commit, projectRoot) : [];
    const task = buildTask({ firstRun: !graphMeta });
    const runContext = buildRunContext({ firstRun: !graphMeta, changedFiles });
    const invocation = buildInvocation({ task, runContext, model: resolution.cliModel, effort: resolution.effort, settingsFile, env });
    const startedAt = new Date();
    // Arbeitsordner als echte Langform (Gate A5): mit einem 8.3-Kurznamen wie C:\Users\BENUTZ~1 vergleicht Claude Code
    // die Pfadregel Edit(./.ua/**) gegen die andere Schreibweise und lehnt jedes Schreiben ab (gemessen 28.09.2026).
    const result = await cliRunner(invocation, { cwd: realProjectRoot(projectRoot) });
    const finishedAt = new Date();
    const usage = parseCliUsage(result?.stdout);
    const error = cliResultError(result) ?? graphWrittenError(projectRoot, head.commit, usage);
    appendRunLog(dataDir, projectRoot, {
      ...logBase, started: true, firstRun: !graphMeta, changedFiles: changedFiles.length,
      model: resolution.model, effort: resolution.effort ?? null, provider: resolution.provider, source: resolution.source,
      startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString(),
      status: result?.status ?? null, error, usage: usage ? { ...usage, modelUsage: undefined, resultText: undefined } : null,
    });
    return { started: true, invocation, resolution, result, error };
  } finally {
    lock.release();
  }
}

// --- Abgelöster Start und Auslöser (Gate A6) ------------------------------------------------------

/**
 * Startet `node run.mjs --project <wurzel> [--force]` als abgelösten Kindprozess und kehrt sofort zurück
 * (der Dashboard-Knopf blockiert den Server nicht mehr). Ausgabe landet in
 * `<datenordner>/<projekt>/last-run.log`. `spawnImpl` ist injizierbar (Tests).
 */
export function spawnDetachedRun({ projectRoot, dataDir, forced = false, env = process.env, spawnImpl = spawn, nodePath = process.execPath }) {
  const folder = projectDataFolder(dataDir, projectRoot);
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  const logFile = path.join(folder, "last-run.log");
  const out = openSync(logFile, "w");
  try {
    const child = spawnImpl(nodePath, [RUN_SCRIPT, "--project", projectRoot, ...(forced ? ["--force"] : [])], {
      cwd: projectRoot, detached: true, windowsHide: true, stdio: ["ignore", out, out],
      env: { ...env, ARCHITECTURE_MAPS_DATA_DIR: dataDir },
    });
    child.unref?.();
    return { started: true, pid: child.pid ?? null, logFile, reason: "Lauf im Hintergrund gestartet" };
  } finally {
    try { closeSync(out); } catch { /* schon geschlossen */ }
  }
}

// --- Einrichtung des Werkzeugs: Vorbau des Plugins beim Einschalten (Installation) -----------------
//
// Eine frische Installation liefert das Plugin ohne node_modules/ und dist/ aus (build-standalone.mjs).
// Schaltet der Nutzer im Dashboard ein Projekt für das Architekturbild ein, startet das Dashboard den
// Vorbau (isolation.mjs runPluginPrebuild) genau einmal im Hintergrund: `node run.mjs --prebuild`,
// abgelöst wie spawnDetachedRun. Der Stand steht je Plugin-Ordner in `<datenordner>/prebuild-<kennung>.json`
// (der Datenordner gilt für alle Installationen eines Nutzers, der Plugin-Ordner je Installation) und wird
// von der Karte gelesen. Der Lauf-Job selbst installiert weiterhin nichts.

export const PREBUILD_STALE_START_MS = 2 * 60 * 1000;

function prebuildKey(pluginDir) {
  return createHash("sha256").update(path.resolve(pluginDir).toLowerCase()).digest("hex").slice(0, 16);
}

export function prebuildStatusFile(dataDir, pluginDir = PLUGIN_DIR) {
  return path.join(dataDir, `prebuild-${prebuildKey(pluginDir)}.json`);
}

function prebuildLogFile(dataDir, pluginDir) {
  return path.join(dataDir, `prebuild-${prebuildKey(pluginDir)}.log`);
}

function prebuildLockFile(dataDir, pluginDir) {
  return path.join(dataDir, `prebuild-${prebuildKey(pluginDir)}.lock`);
}

function readPrebuildRecord(dataDir, pluginDir) {
  try { return JSON.parse(readFileSync(prebuildStatusFile(dataDir, pluginDir), "utf8")); }
  catch { return null; }
}

function writePrebuildRecord(dataDir, pluginDir, record) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const file = prebuildStatusFile(dataDir, pluginDir);
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, JSON.stringify({ schema: 1, pluginDir: path.resolve(pluginDir), ...record }, null, 2), { encoding: "utf8", mode: 0o600 });
  replaceFileSync(temporary, file);
}

/**
 * Stand der Einrichtung für die Karte: `built` (vorgebaut, ohne dass hier eine Einrichtung lief, z. B.
 * in der Werkbank), `done` (Einrichtung erfolgreich, Prüfsumme bestätigt), `running` (mit Schritt x von y),
 * `failed` (mit Grund) oder `missing` (nicht vorgebaut, noch keine Einrichtung gestartet). Ein `running`
 * ohne lebenden Prozess wird als abgebrochen gemeldet.
 */
export function readPluginPrebuildState({ dataDir, pluginDir = PLUGIN_DIR, now = new Date(), isAlive = defaultIsAlive, buildStatus } = {}) {
  const built = (buildStatus ?? pluginBuildStatus({ pluginDir })).built;
  const record = readPrebuildRecord(dataDir, pluginDir);
  const base = { built, step: null, error: null, startedAt: record?.startedAt ?? null, finishedAt: record?.finishedAt ?? null };
  if (record?.state === "running") {
    const alive = Number.isSafeInteger(record.pid) ? isAlive(record.pid)
      : now.getTime() - new Date(record.startedAt ?? 0).getTime() < PREBUILD_STALE_START_MS;
    if (alive) return { ...base, state: "running", step: record.step ?? null };
    return { ...base, state: "failed", error: "Die Einrichtung wurde abgebrochen (der Hintergrundprozess lebt nicht mehr)." };
  }
  if (record?.state === "failed") return { ...base, state: "failed", error: record.error ?? "Grund unbekannt." };
  if (built) return { ...base, state: record?.state === "done" ? "done" : "built" };
  return { ...base, state: "missing" };
}

/** Hält eine Einrichtung einen Lauf auf (läuft gerade oder schlug fehl)? Grund als Satz, sonst null. */
export function prebuildBlocksRun(state) {
  if (state?.state === "running") return "Werkzeug wird eingerichtet; der Lauf startet erst danach.";
  if (state?.state === "failed") return `Werkzeug nicht eingerichtet: ${state.error}`;
  return null;
}

/**
 * Startet die Einrichtung abgelöst (`node run.mjs --prebuild`) und kehrt sofort zurück. Nichts passiert,
 * wenn das Plugin schon vorgebaut ist oder eine Einrichtung läuft. Der Stand „running“ wird VOR dem Start
 * geschrieben, damit die Karte sofort „Werkzeug wird eingerichtet …“ zeigt; alles Weitere schreibt der
 * Kindprozess. `spawnImpl` und `buildStatus` sind injizierbar (Tests: kein echter Download).
 */
export function startPluginPrebuild({ dataDir, pluginDir = PLUGIN_DIR, env = process.env, spawnImpl = spawn, nodePath = process.execPath, now = new Date(), isAlive, buildStatus } = {}) {
  const state = readPluginPrebuildState({ dataDir, pluginDir, now, isAlive, buildStatus });
  if (state.built) return { started: false, reason: "already_built", state: state.state };
  if (state.state === "running") return { started: false, reason: "already_running", state: state.state };
  writePrebuildRecord(dataDir, pluginDir, {
    state: "running", pid: null, startedAt: now.toISOString(), finishedAt: null, error: null,
    step: { index: 0, total: null, label: "Werkzeug wird eingerichtet …" },
  });
  const out = openSync(prebuildLogFile(dataDir, pluginDir), "w");
  try {
    const child = spawnImpl(nodePath, [RUN_SCRIPT, "--prebuild", "--plugin-dir", pluginDir], {
      cwd: pluginDir, detached: true, windowsHide: true, stdio: ["ignore", out, out],
      env: { ...env, ARCHITECTURE_MAPS_DATA_DIR: dataDir },
    });
    child.on?.("error", (error) => {
      writePrebuildRecord(dataDir, pluginDir, { state: "failed", pid: null, startedAt: now.toISOString(), finishedAt: new Date().toISOString(), error: `Die Einrichtung startete nicht: ${error.message}` });
    });
    child.unref?.();
    return { started: true, reason: "Werkzeug wird eingerichtet", pid: child.pid ?? null, state: "running" };
  } catch (error) {
    const message = `Die Einrichtung startete nicht: ${error instanceof Error ? error.message : String(error)}`;
    writePrebuildRecord(dataDir, pluginDir, { state: "failed", pid: null, startedAt: now.toISOString(), finishedAt: new Date().toISOString(), error: message });
    return { started: false, reason: message, state: "failed" };
  } finally {
    try { closeSync(out); } catch { /* schon geschlossen */ }
  }
}

/**
 * Die Einrichtung im Kindprozess (run.mjs --prebuild): Sperre je Plugin-Ordner, dann runPluginPrebuild mit
 * Schritt-Meldungen in die Statusdatei; Ergebnis `done` oder `failed` mit Grund. `exec` ist injizierbar.
 */
export async function runPluginPrebuildJob({ dataDir, pluginDir = PLUGIN_DIR, lockFile = LOCK_FILE, exec, env = process.env, now = new Date(), log = () => {} } = {}) {
  let lock;
  try {
    lock = acquireJobLock(dataDir, { now, lock: prebuildLockFile(dataDir, pluginDir) });
  } catch (error) {
    if (error?.code === "job_already_running") return { ok: false, skipped: true, reason: "already_running" };
    throw error;
  }
  try {
    const startedAt = now.toISOString();
    if (pluginBuildStatus({ pluginDir }).built) {
      writePrebuildRecord(dataDir, pluginDir, { state: "done", pid: process.pid, startedAt, finishedAt: new Date().toISOString(), error: null, step: null });
      return { ok: true, skipped: true, reason: "already_built" };
    }
    const result = await runPluginPrebuild({
      pluginDir, lockFile, env, log, ...(exec ? { exec } : {}),
      onStep: (step) => writePrebuildRecord(dataDir, pluginDir, { state: "running", pid: process.pid, startedAt, finishedAt: null, error: null, step }),
    });
    writePrebuildRecord(dataDir, pluginDir, {
      state: result.ok ? "done" : "failed", pid: process.pid, startedAt, finishedAt: new Date().toISOString(),
      error: result.ok ? null : result.error, step: null, steps: result.steps, measured: result.measured ?? null,
    });
    return result;
  } finally {
    lock.release();
  }
}

/**
 * Ein Durchgang des Auslösers (Gate A6): für jedes eingeschaltete Projekt prüfen, ob ein neuer Commit
 * mindestens 10 Minuten ruhig liegt (shouldRun), nie unter der Speichergrenze und nie, solange ein Lauf
 * läuft; dann den Lauf abgelöst starten. Höchstens ein Start je Durchgang. Läuft die Einrichtung des
 * Werkzeugs noch oder schlug sie fehl, startet kein Lauf (das Projekt bleibt ohne Lauf, die Karte nennt den Grund).
 */
export function architectureMapsTriggerTick({ dataDir, env = process.env, now = new Date(), freeMemoryBytes = os.freemem(), startRun, isAlive, harnessRoot } = {}) {
  if (isJobRunning(dataDir, { isAlive })) return [{ project: null, started: false, reason: "job_already_running" }];
  if (readPrebuildRecord(dataDir, PLUGIN_DIR)) {
    const prebuild = readPluginPrebuildState({ dataDir, now, ...(isAlive ? { isAlive } : {}) });
    if (prebuildBlocksRun(prebuild)) return [{ project: null, started: false, reason: `prebuild_${prebuild.state}` }];
  }
  if (!Number.isFinite(freeMemoryBytes) || freeMemoryBytes < ramFloorBytes(harnessRoot, env)) {
    return [{ project: null, started: false, reason: "memory_below_limit" }];
  }
  const start = startRun ?? ((projectRoot) => spawnDetachedRun({ projectRoot, dataDir, env }));
  const decisions = [];
  for (const projectRoot of enabledProjects(dataDir)) {
    let decision;
    try {
      decision = shouldRun({ graphMeta: readGraphMeta(projectRoot), head: resolveDefaultBranchHead(projectRoot), now });
    } catch (error) {
      decisions.push({ project: projectRoot, started: false, reason: error instanceof Error ? error.message : String(error) });
      continue;
    }
    if (!decision.run) { decisions.push({ project: projectRoot, started: false, reason: decision.reason }); continue; }
    const started = start(projectRoot);
    decisions.push({ project: projectRoot, started: true, reason: decision.reason, pid: started?.pid ?? null });
    break; // höchstens ein Lauf gleichzeitig; der nächste Durchgang nimmt das nächste Projekt
  }
  return decisions;
}

/**
 * Hintergrund-Auslöser (Gate A6): alle `intervalMs` (Vorgabe 10 Minuten) ein Durchgang. Liefert `stop`.
 * Seit dem Owner-Entscheid vom 28.09.2026 („nur auf knopfdruck …“) startet ihn kein Starter mehr: weder
 * dashboard/serve.mjs noch standalone/templates/dashboard-serve.mjs. Die Funktion bleibt für einen späteren Entscheid.
 */
export function startArchitectureMapsTrigger({ dataDir = architectureMapsDataDirectory(), env = process.env, intervalMs = TRIGGER_INTERVAL_MS, tick = architectureMapsTriggerTick, onResult } = {}) {
  const run = () => {
    let decisions;
    try { decisions = tick({ dataDir, env }); }
    catch (error) { decisions = [{ project: null, started: false, reason: error instanceof Error ? error.message : String(error) }]; }
    onResult?.(decisions);
  };
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  return { stop: () => clearInterval(timer), intervalMs };
}
