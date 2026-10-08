// Bezug und Isolation von Understand-Anything (Paket new-harness-architecture-maps, Plan-Schritt 6,
// Gates J1 und J2).
//
// Der vendorierte Plugin-Stand liegt bewusst unter `test-harness/vendor/understand-anything-plugin/`
// und NICHT unter `harness-core/architecture-maps/` (abweichend von der wörtlichen Ortsangabe in
// design/decisions.md F5 und Plan-Schritt 6): der Test gegen fest verdrahtete Modelle von
// new-harness-process-model-settings (Gates M6/M7) durchsucht jeden Unterordner von `harness-core`,
// und Understand-Anything selbst nennt als Analyse-Werkzeug für beliebige Modelle viele Modellnamen
// anderer Anbieter in seinem eigenen Quelltext. Diese Ablage hält den Scan unberührt, ohne eine Datei
// des Nachbarpakets zu ändern (Befund ARCH-N15, siehe test-harness/vendor/README.md). Der Job lädt das
// Plugin über `--plugin-dir` ausschließlich für sich selbst (design/decisions.md F5); der Pfad ist der
// einzige Unterschied zur wörtlichen Planung.
//
// Isolation heißt: Understand-Anything wird NIE über `/plugin marketplace add` oder gleichwertig
// registriert (kein Eintrag in `~/.claude/plugins/installed_plugins.json` oder `known_marketplaces.json`,
// keine `enabledPlugins`-Zeile in einer Projekt- oder Nutzer-`settings.json`); dadurch feuert der
// SessionStart-Hook des Plugins (`hooks/hooks.json`, „Do not ask the user for confirmation — just do
// it.“) in keiner normalen Sitzung, auch nicht bei einem Bau-Agenten (Entscheidung A2). Jedes
// eingeschaltete Projekt bekommt zusätzlich `.ua/config.json` mit `"autoUpdate": false`
// (design/decisions.md F3): Selbst ein versehentlich registriertes Plugin liefe dann nicht ohne
// Rückfrage.

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// The step runner is loaded when a step runs, not here: this file is also imported by the build and from an installed
// layout with only Node building blocks (test/architecture-maps-delivery.test.js), so it keeps no import of its own.
const watchedChild = () => createRequire(import.meta.url)("../binding/watched-child.cjs");
export const VENDOR_DIR = path.resolve(HERE, "..", "..", "vendor");
export const PLUGIN_DIR = path.join(VENDOR_DIR, "understand-anything-plugin");
export const LOCK_FILE = path.join(VENDOR_DIR, "understand-anything.lock.json");
export const PLUGIN_MANIFEST_FILE = path.join(PLUGIN_DIR, ".claude-plugin", "plugin.json");
export const LICENSE_FILE = path.resolve(HERE, "..", "..", "licenses", "understand-anything", "LICENSE");

export class IsolationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "IsolationError";
    Object.assign(this, details);
  }
}

export function readLock(lockFile = LOCK_FILE) {
  return JSON.parse(readFileSync(lockFile, "utf8"));
}

export function readPluginManifest(manifestFile = PLUGIN_MANIFEST_FILE) {
  return JSON.parse(readFileSync(manifestFile, "utf8"));
}

/**
 * Bauausgaben des Plugins (harness-dashboard-repair, Plan-Schritt 21, Gate A4): `pnpm install` und
 * `pnpm --filter @understand-anything/core build` (SKILL.md Phase 0, Schritt 1.5) legen `node_modules/`
 * und `dist/` in jeder Ebene des Plugin-Ordners an. Sie gehören nicht zum freigegebenen Quellstand, sind
 * in test-harness/.gitignore ausgenommen und zählen nicht zur Prüfsumme — sonst scheitert der zweite
 * Lauf nach dem Vorbau an `checksum_mismatch`. Der Quellstand selbst enthält keinen solchen Ordner
 * (gemessen 28.09.2026: `git ls-files test-harness/vendor/understand-anything-plugin` ohne Treffer).
 */
export const PLUGIN_BUILD_OUTPUT_DIRECTORIES = Object.freeze(["node_modules", "dist"]);

/** Derselbe Verzeichnis-Hash wie beim Anlegen der Lock-Datei: sortierte Liste `pfad:sha256(datei)`, dann sha256 der Liste. */
export function hashPluginDirectory(pluginDir = PLUGIN_DIR) {
  const files = [];
  const walk = (relative) => {
    const absolute = path.join(pluginDir, ...(relative ? relative.split("/") : []));
    for (const name of readdirSync(absolute, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
      const childRelative = relative ? `${relative}/${name.name}` : name.name;
      if (name.isDirectory()) {
        if (!PLUGIN_BUILD_OUTPUT_DIRECTORIES.includes(name.name)) walk(childRelative);
      } else if (name.isFile()) files.push(childRelative);
    }
  };
  walk("");
  const lines = files.map((relative) => {
    const bytes = readFileSync(path.join(pluginDir, ...relative.split("/")));
    return `${relative}:${createHash("sha256").update(bytes).digest("hex")}`;
  });
  return { files: files.length, dirSha256: createHash("sha256").update(lines.join("\n")).digest("hex") };
}

/**
 * Gate J1: verweigert einen Plugin-Ordner, dessen Inhalt nicht mehr zur Lock-Datei passt (Commit,
 * Version oder Prüfsumme weichen ab). Wirft IsolationError statt still weiterzumachen.
 */
export function verifyPluginIntegrity({ pluginDir = PLUGIN_DIR, lockFile = LOCK_FILE } = {}) {
  if (!existsSync(pluginDir)) {
    throw new IsolationError(`Plugin-Ordner fehlt: ${pluginDir}. Kein Bezug ohne Owner-Freigabe (Gate D4).`, { code: "plugin_missing" });
  }
  const lock = readLock(lockFile);
  const manifest = readPluginManifest(path.join(pluginDir, ".claude-plugin", "plugin.json"));
  if (manifest.version !== lock.pluginVersion) {
    throw new IsolationError(`Plugin-Version ${manifest.version} weicht von der Lock-Datei (${lock.pluginVersion}) ab.`,
      { code: "version_mismatch", found: manifest.version, expected: lock.pluginVersion });
  }
  const measured = hashPluginDirectory(pluginDir);
  if (measured.dirSha256 !== lock.vendoredPlugin?.dirSha256 || measured.files !== lock.vendoredPlugin?.files) {
    throw new IsolationError("Der Plugin-Ordner weicht von der Lock-Datei ab (Prüfsumme oder Dateizahl); kein freigegebener Stand.",
      { code: "checksum_mismatch", found: measured, expected: lock.vendoredPlugin });
  }
  return { lock, manifest, measured };
}

/** Ist das Plugin vorgebaut? Ohne `packages/core/dist/index.js` baut der Skill selbst (SKILL.md Phase 0, 1.5). */
export function pluginBuildStatus({ pluginDir = PLUGIN_DIR } = {}) {
  const marker = path.join(pluginDir, "packages", "core", "dist", "index.js");
  return { built: existsSync(marker), marker };
}

/**
 * pnpm-Version gegen die Freigabe (Gate A4): die Lock-Datei nennt unter `pnpm.required` die Version aus
 * der Freigabe. `run` ist injizierbar (Tests); ohne Angabe wird `pnpm --version` aufgerufen. Wirft nie;
 * das Ergebnis sagt, ob der Vorbau mit dem vorhandenen pnpm zulässig ist.
 */
export function checkPnpmVersion({ lockFile = LOCK_FILE, run } = {}) {
  const required = String(readLock(lockFile).pnpm?.required || "");
  let found = "";
  try {
    const output = run ? run() : spawnSync("pnpm --version", { encoding: "utf8", windowsHide: true, shell: true }); // fester Befehl ohne Eingaben; die Shell findet den pnpm-Shim unter Windows
    found = String(typeof output === "string" ? output : output?.stdout ?? "").trim();
  } catch { found = ""; }
  const major = (version) => Number.parseInt(String(version).split(".")[0], 10);
  const ok = Boolean(required && found) && major(found) === major(required);
  return {
    required, found: found || null, ok,
    message: !found ? `pnpm nicht gefunden; der Vorbau verlangt pnpm ${required}.`
      : ok ? `pnpm ${found} passt zur Freigabe (${required}).`
        : `pnpm ${found} weicht von der Freigabe ab (${required}); Vorbau mit \`npx pnpm@${required}\`.`,
  };
}

// --- Vorbau in einer Installation (Einrichtung beim Einschalten im Dashboard) ---------------------
//
// In der Werkbank wurde das Plugin einmal von Hand vorgebaut (Lock-Datei `pnpm.prebuildMeasured`). Eine
// frische Installation bekommt nur den Quellstand (build-standalone.mjs liefert node_modules/ und dist/
// nicht aus); ohne Vorbau endet jeder Lauf mit „Plugin nicht vorgebaut“. Deshalb baut das Dashboard das
// Plugin genau einmal vor, wenn der Nutzer ein Projekt für das Architekturbild einschaltet (job.mjs
// startPluginPrebuild). Das Rezept kommt aus der Lock-Datei (`pnpm.prebuild`, pnpm-Version aus
// `pnpm.required` über npx), nicht aus diesem Code. Der Lauf-Job selbst installiert weiterhin nichts.

const PREBUILD_ARGUMENT = /^[A-Za-z0-9@._/=:-]+$/u;
const PREBUILD_LOCKFILE = "pnpm-lock.yaml";

/**
 * Rezept des Vorbaus aus der Lock-Datei: jede `npx …`-Zeile aus `pnpm.prebuild` wird ein Schritt; jede
 * muss genau die freigegebene pnpm-Version (`pnpm@<pnpm.required>`) nennen. Die `cd`-Zeile ist der
 * Arbeitsordner (der Plugin-Ordner), die `git show … pnpm-lock.yaml`-Zeile die Wiederherstellung der
 * Lock-Datei des Plugins — in einer Installation ohne Git-Stand des Plugins aus einer Sicherung vor dem
 * ersten Schritt. Wirft IsolationError(`prebuild_recipe_invalid`), wenn das Rezept nicht passt.
 */
export function prebuildRecipe({ lockFile = LOCK_FILE } = {}) {
  const lock = readLock(lockFile);
  const required = String(lock.pnpm?.required || "");
  const invalid = (message) => new IsolationError(`Vorbau-Rezept in der Lock-Datei unbrauchbar: ${message}`, { code: "prebuild_recipe_invalid" });
  if (!/^\d+\.\d+\.\d+$/u.test(required)) throw invalid("pnpm.required fehlt oder ist keine Version.");
  const lines = Array.isArray(lock.pnpm?.prebuild) ? lock.pnpm.prebuild.map((line) => String(line).trim()) : [];
  const pinned = `pnpm@${required}`;
  const steps = lines.filter((line) => line.startsWith("npx ")).map((line) => {
    const args = line.split(/\s+/u).slice(1);
    if (!args.includes(pinned)) throw invalid(`„${line}“ nennt nicht ${pinned}.`);
    const unsafe = args.find((arg) => !PREBUILD_ARGUMENT.test(arg));
    if (unsafe) throw invalid(`„${line}“ enthält das Argument ${JSON.stringify(unsafe)}.`);
    const label = args.includes("install") ? "Abhängigkeiten laden (pnpm install)"
      : args.includes("build") ? "Kern bauen (core build)" : `pnpm ${args.slice(args.indexOf(pinned) + 1).join(" ")}`;
    return { label, args };
  });
  if (steps.length === 0) throw invalid("keine npx-Zeile unter pnpm.prebuild.");
  const restoresLockfile = lines.some((line) => line.includes(PREBUILD_LOCKFILE) && !line.startsWith("npx "));
  return { required, steps, restoreFile: restoresLockfile ? PREBUILD_LOCKFILE : null };
}

/**
 * npx ohne Shell: die npx-cli.js, die mit Node ausgeliefert wird, läuft mit demselben Node-Programm
 * (unter Windows startet Node den npx.cmd-Shim ohne Shell nicht). Fehlt sie, bleibt der npx-Befehl aus
 * dem PATH; unter Windows dann über die Shell, deren Argumente das Rezept schon auf einfache Zeichen
 * beschränkt hat.
 */
export function resolveNpxCommand({ execPath = process.execPath, platform = process.platform, exists = existsSync } = {}) {
  const directory = path.dirname(execPath);
  const candidates = platform === "win32"
    ? [path.join(directory, "node_modules", "npm", "bin", "npx-cli.js")]
    : [path.join(directory, "..", "lib", "node_modules", "npm", "bin", "npx-cli.js"), path.join(directory, "node_modules", "npm", "bin", "npx-cli.js")];
  const cli = candidates.find((candidate) => exists(candidate));
  if (cli) return { command: execPath, prefix: [cli], shell: false };
  return platform === "win32" ? { command: "npx.cmd", prefix: [], shell: true } : { command: "npx", prefix: [], shell: false };
}

/**
 * Echter Ausführer eines Vorbau-Schritts (`npx <args>` im Plugin-Ordner); in Tests ersetzt. Keine feste Zeit und
 * kein Ausgabe-Deckel mehr (P15, C13; vorher 15 Minuten und 64 MiB): der Schritt läuft unter dem Stille-Wächter
 * (vendor/unlazy/scripts/lib/silence-watch.mjs) und gilt nur als hängend, wenn er KEEL_SILENCE_MS lang nichts
 * ausgibt UND sein Prozessbaum nicht arbeitet. Ein langsames Netz mit laufendem pnpm bricht damit nicht mehr ab.
 * `npx` ist für Tests ersetzbar ({ command, prefix, shell }).
 */
export async function defaultPrebuildExec(args, { cwd, env = process.env, npx = resolveNpxCommand() } = {}) {
  return watchedChild().runWatchedChild(npx.command, [...npx.prefix, ...args], { cwd, env, shell: npx.shell });
}

function outputTail(text, max = 400) {
  const value = String(text || "").trim();
  return value.length > max ? `…${value.slice(-max)}` : value;
}

/** Ein Satz zum Fehlschlag eines Schritts: npx fehlt, kein Netz oder Exit-Code mit dem Ende der Ausgabe. */
export function prebuildStepError(step, result) {
  if (!result) return `${step.label}: kein Ergebnis vom Aufruf.`;
  if (result.hung) return `${step.label}: ${watchedChild().hungMessage("npx", result)}.`;
  if (result.error) {
    const code = result.error.code || "";
    const text = String(result.error.message || "");
    if (code === "ENOENT" || /\bENOENT\b/u.test(text)) return `${step.label}: npx wurde nicht gefunden; die Einrichtung braucht Node.js mit npm (npx).`;
    return `${step.label}: startete nicht (${result.error.message || code || String(result.error)}).`;
  }
  if (result.status === 0) return null;
  const output = `${result.stderr || ""}\n${result.stdout || ""}`;
  const offline = /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ERR_SOCKET|network|getaddrinfo/iu.test(output);
  const tail = outputTail(output);
  return `${step.label} endete mit Exit-Code ${result.status ?? "unbekannt"}${offline ? " (kein Netz? npx und pnpm laden aus der npm-Registry)" : ""}${tail ? `: ${tail}` : ""}`;
}

/**
 * Der Vorbau selbst (asynchron, weil der Schritt unter dem Stille-Wächter läuft; `exec` ist injizierbar, in Tests nie
 * ein echter Download, und darf auch synchron antworten):
 * 1. Prüfsumme vor dem Vorbau (Gate J1: kein pnpm auf einem veränderten Quellstand),
 * 2. die npx-Schritte aus der Lock-Datei im Plugin-Ordner,
 * 3. Wiederherstellung der pnpm-lock.yaml (immer, auch nach einem Fehlschlag),
 * 4. Prüfsumme danach wie in Gate A4 und `packages/core/dist/index.js` vorhanden.
 * `onStep({ index, total, label })` meldet jeden Schritt vor seinem Beginn. Wirft nie; das Ergebnis sagt
 * `ok` und im Fehlerfall `error` als ganzen Satz für die Karte.
 */
export async function runPluginPrebuild({ pluginDir = PLUGIN_DIR, lockFile = LOCK_FILE, exec = defaultPrebuildExec, env = process.env, onStep = () => {}, log = () => {} } = {}) {
  let recipe;
  try { recipe = prebuildRecipe({ lockFile }); }
  catch (error) { return { ok: false, error: error.message, steps: [] }; }
  const labels = ["Prüfsumme des Quellstands prüfen", ...recipe.steps.map((step) => step.label), "Prüfsumme nach dem Vorbau prüfen"];
  const total = labels.length;
  const report = (index) => { try { onStep({ index: index + 1, total, label: labels[index] }); } catch { /* Anzeige ist nicht Teil des Vorbaus */ } };
  const done = [];

  report(0);
  try { verifyPluginIntegrity({ pluginDir, lockFile }); }
  catch (error) { return { ok: false, error: `${labels[0]}: ${error.message}`, steps: done }; }
  done.push(labels[0]);

  const restorePath = recipe.restoreFile ? path.join(pluginDir, recipe.restoreFile) : null;
  const backup = restorePath && existsSync(restorePath) ? readFileSync(restorePath) : null;
  let failure = null;
  try {
    for (const [offset, step] of recipe.steps.entries()) {
      report(offset + 1);
      log(`$ npx ${step.args.join(" ")}\n`);
      let result;
      try { result = await exec(step.args, { cwd: pluginDir, env }); }
      catch (error) { result = { error }; }
      if (result?.stdout) log(String(result.stdout));
      if (result?.stderr) log(String(result.stderr));
      failure = prebuildStepError(step, result);
      if (failure) break;
      done.push(step.label);
    }
  } finally {
    if (backup) {
      try { writeFileSync(restorePath, backup); }
      catch (error) { failure ??= `${recipe.restoreFile} ließ sich nicht wiederherstellen: ${error.message}`; }
    }
  }
  if (failure) return { ok: false, error: failure, steps: done };

  report(total - 1);
  let measured;
  try { measured = verifyPluginIntegrity({ pluginDir, lockFile }).measured; }
  catch (error) { return { ok: false, error: `${labels[total - 1]}: ${error.message}`, steps: done }; }
  const build = pluginBuildStatus({ pluginDir });
  if (!build.built) return { ok: false, error: `Der Vorbau lief durch, aber ${path.relative(pluginDir, build.marker).replaceAll("\\", "/")} fehlt.`, steps: done };
  done.push(labels[total - 1]);
  return { ok: true, error: null, steps: done, measured };
}

/** Aufruf-Argumente, mit denen der Job das Plugin nur für sich selbst lädt (design/decisions.md F5). */
export function pluginDirArguments({ pluginDir = PLUGIN_DIR } = {}) {
  return ["--plugin-dir", pluginDir];
}

/** `.ua/config.json` eines eingeschalteten Projekts: Auto-Update bleibt immer aus (design/decisions.md F3). */
export function buildUaConfig() {
  return Object.freeze({ autoUpdate: false });
}

/** Altordner `.understand-anything/` gewinnt, wenn er existiert (wie cost-estimate.mjs `resolveDataDirectoryName`). */
export function resolveDataDirectoryName(projectRoot) {
  return existsSync(path.join(projectRoot, ".understand-anything")) ? ".understand-anything" : ".ua";
}

/** Zeile für `<projekt>/.git/info/exclude`, damit der Graph nie ins Projekt-Repo committet wird. */
export function gitExcludeEntry(dataDirectoryName) {
  return `/${dataDirectoryName}/`;
}

/**
 * Prüft, dass `<projekt>/.git` ein echter Ordner ist, kein Worktree-Verweis (ARCH-N5): Understand-Anything
 * schreibt sonst in den Hauptbaum. Ein Job-Lauf startet nie in einem Worktree.
 */
export function assertMainWorktree(projectRoot) {
  const gitPath = path.join(projectRoot, ".git");
  let stat;
  try { stat = lstatSync(gitPath); } catch { throw new IsolationError(`Kein Git-Ordner unter ${projectRoot}.`, { code: "not_a_repo" }); }
  if (!stat.isDirectory()) {
    throw new IsolationError(`${projectRoot} ist ein Git-Worktree (.git ist eine Datei, kein Ordner); der Job läuft nur im Hauptbaum (ARCH-N5).`,
      { code: "is_worktree" });
  }
}

const REGISTRATION_NEEDLES = ["understand-anything", "understand_anything", "egonex-ai/understand-anything"];

function textMentionsPlugin(text) {
  const lower = String(text).toLowerCase();
  return REGISTRATION_NEEDLES.some((needle) => lower.includes(needle));
}

function scanForRegistration(files) {
  const hits = [];
  for (const file of files) {
    if (!existsSync(file)) continue;
    let text;
    try { text = readFileSync(file, "utf8"); } catch { continue; }
    if (textMentionsPlugin(text)) hits.push(file);
  }
  return hits;
}

/**
 * Gate J2 (global): Understand-Anything darf in keiner der Registrierungsflächen von Claude Code
 * auftauchen, die eine normale Sitzung liest (installierte Plugins, bekannte Marktplätze, globale
 * Einstellungen). Ein Vorkommen dort hieße, das Plugin liefe außerhalb des isolierten Jobs mit.
 */
export function assertNotRegisteredGlobally({ homeDir = os.homedir() } = {}) {
  const claudeDir = path.join(homeDir, ".claude");
  const surfaces = [
    path.join(claudeDir, "plugins", "installed_plugins.json"),
    path.join(claudeDir, "plugins", "known_marketplaces.json"),
    path.join(claudeDir, "settings.json"),
  ];
  const hits = scanForRegistration(surfaces);
  if (hits.length > 0) {
    throw new IsolationError(`Understand-Anything ist global registriert, obwohl nur der Job es laden darf: ${hits.join(", ")}`,
      { code: "registered_globally", hits });
  }
  return { checked: surfaces };
}

/**
 * Gate J2 (Projekt): weder `.claude/settings.json` noch `.claude/settings.local.json` eines Projekts
 * dürfen Understand-Anything als Plugin oder Marktplatz eintragen.
 */
export function assertNotRegisteredInProject({ projectRoot }) {
  const surfaces = [
    path.join(projectRoot, ".claude", "settings.json"),
    path.join(projectRoot, ".claude", "settings.local.json"),
  ];
  const hits = scanForRegistration(surfaces);
  if (hits.length > 0) {
    throw new IsolationError(`Understand-Anything ist in Projekt-Einstellungen registriert: ${hits.join(", ")}`,
      { code: "registered_in_project", hits });
  }
  return { checked: surfaces };
}

/**
 * Volle Prüfung vor jedem Job-Lauf (J1 + J2): Plugin-Prüfsumme, keine Registrierung global oder im
 * Projekt, Hauptbaum statt Worktree. Wirft mit der ersten verletzten Bedingung.
 */
export function assertIsolated({ projectRoot, pluginDir = PLUGIN_DIR, lockFile = LOCK_FILE, homeDir = os.homedir() } = {}) {
  const integrity = verifyPluginIntegrity({ pluginDir, lockFile });
  assertMainWorktree(projectRoot);
  assertNotRegisteredGlobally({ homeDir });
  assertNotRegisteredInProject({ projectRoot });
  return integrity;
}
