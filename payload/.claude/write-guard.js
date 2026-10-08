#!/usr/bin/env node
// PreToolUse-Hook fuer Write/Edit/NotebookEdit -- drei Regeln, ein Node-Start.
// Schliesst die am 24.08.2026 bewiesene Luecke, dass danger-guard nur Bash sieht:
// ueber die Editier-Werkzeuge liess sich ausserhalb der erlaubten Wurzeln
// schreiben (Downloads), Secrets waeren ungeprueft in Dateien gelandet, und die
// .gitignore-Reihenfolge-Regel (erst Repo gepusht, DANN Ignorier-Zeile) war
// reine Prosa. [Owner-Freigabe 24.08.2026, Haertegrad-Analyse]
//   W1  Schreibziel ausserhalb der erlaubten Wurzeln        -> Block
//   W2  Zugangs-Muster (Token/Key-WERTE) im Inhalt          -> Block
//   W3  .gitignore-Zeile macht ein existierendes Projekt ohne
//       eigenen echten Git-Root + origin unsichtbar          -> Block
//   W4  Owner-Politikdatei .claude/mutation-policy.json       -> Block
//   W5  vom Installer verwaltete Harness-Datei der Installation -> Block
//       (guard-parity E10: den Harness selbst aendert keine Sitzung direkt; die Sperre nennt
//       dem Agenten seinen Weg ueber Produkt-Quellbaum, Release und Harness-Update)
// W1 und W4 darf allein der Owner aendern (ownerOnly); W3 und W5 nennen den Agentenweg.
// Ziel und Wurzeln werden in derselben kanonischen Form verglichen (hook-context
// canonicalPath): ein Windows-Kurzpfad (8.3) ist derselbe Ort wie seine Langform.
// Selbsttest: node write-guard.js --selbsttest

const { execFileSync, spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const GUARD_TARGET = ".claude/write-guard.js";

// Inline deny transport (identical in every PreToolUse guard; guard-parity E5): a missing
// sibling module must never turn a denial into an allow. Under the Codex hook runner a
// JSON deny with exit 0 survives Windows PowerShell, which maps a native exit 2 to 1.
// Every other error of the hook process denies the same way (guard-parity A9, fail closed): the
// two handlers are armed here, before any helper module loads, so a failure while loading, a throw
// inside the decision and an unhandled rejection all end in block(). Only the hook main program is
// armed; a library require and --self-test are not. KEEL_GUARD_TEST_THROW forces an error for the
// tests: "1" throws at load, "reject" leaves an unhandled rejection, "late" throws after the input ended.
function block(message) {
  const reason = String(message).trim() || GUARD_TARGET + ": tool denied";
  if (process.env.KEEL_HARNESS_ROOT && process.env.KEEL_HOOK_TARGET === GUARD_TARGET) {
    fs.writeSync(1, JSON.stringify({ hookSpecificOutput: {
      hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason,
    } }) + "\n");
    process.exit(0);
  }
  fs.writeSync(2, reason + "\n");
  process.exit(2);
}
if (require.main === module && !process.argv.some((arg) => arg === "--self-test" || arg === "--selbsttest")) {
  const failClosed = (error) => {
    try {
      block(GUARD_TARGET.replace(/^.*\//u, "").replace(/\.c?js$/u, "") + ": internal error; tool blocked: " +
        ((error && error.message) || error));
    } catch { process.exit(2); }
  };
  process.on("uncaughtException", failClosed);
  process.on("unhandledRejection", failClosed);
  const forced = process.env.KEEL_GUARD_TEST_THROW;
  if (forced === "reject") Promise.reject(new Error("forced test error"));
  if (forced === "late") process.stdin.once("end", () => { throw new Error("forced test error"); });
  if (forced === "1") throw new Error("forced test error");
}
// End inline deny transport

// Fehlt eine Nachbardatei, sperrt der Waechter, statt abzustuerzen (ein Absturz waere fuer
// Claude ein nicht blockierender Hook-Fehler).
let packageContext;
let ownerHandoff;
let guardRoutes;
let hookContext;
try {
  packageContext = require("./package-context.js");
  ownerHandoff = require("../harness-core/guards/owner-handoff.cjs");
  guardRoutes = require("../harness-core/guards/guard-routes.cjs");
  hookContext = require("../harness-core/guards/hook-context.cjs");
} catch (error) {
  if (require.main === module) block("write-guard: dependency load failed; write blocked: " + error.message);
  throw error;
}

// P20, D14: der echte git.exe statt Shell (cmd.exe) plus Wrapper cmd\git.exe plus git.exe: drei Prozesse je Aufruf.
// Fehlt der Helfer, bleibt es beim einfachen "git"; das ist keine Sperrgrundlage.
let gitBinary = null;
try { gitBinary = require("../harness-core/git/git-binary.cjs"); } catch { /* einfaches git */ }
const gitProgram = () => (gitBinary ? gitBinary.gitExecutable() : "git");

// Die Regelwurzel: die Harness-Wurzel, die ein Arbeitsagent oder der Codex-Runner nennt,
// sonst das Projektverzeichnis der Sitzung (hook-context, guard-parity E6).
const REGELWURZEL = hookContext.ruleRoot();

const norm = (p) => hookContext.canonicalPath(String(p)).split(path.sep).join("/").toLowerCase();
const liegtUnter = (kind, wurzel) => kind === wurzel || kind.startsWith(wurzel + "/");

// Gespiegelt aus danger-guard erlaubteWurzeln() -- erweitert der Owner dort,
// muss diese Liste mitziehen (Onboarding Punkt "Schreibziele des Waechters").
function erlaubteWurzeln(projectRoot = REGELWURZEL) {
  const w = [];
  if (projectRoot) w.push(projectRoot);
  w.push(os.tmpdir(), "/tmp");
  w.push(path.join(os.homedir(), ".claude"), path.join(os.homedir(), ".codex"));
  for (const e of [process.env.TEMP, process.env.TMP]) if (e) w.push(e);
  return w.map(norm);
}

// --- Projekt-Container-/Schreibwurzeln aus dem Instanzprofil (Fund 424) ---
// Installationsspezifische Container-Ordner leben ausschliesslich in
// docs/harness-instance.md (Feld "Additional allowed write roots") -- KEIN fest
// eingebauter Name wie "user-projects" (CLAUDE.md: "keinen fest eingebauten ...
// Workspace-Namen"). schreibwurzelnAusText ist rein und wortgleich in repo-status.js
// gespiegelt (wie erlaubteWurzeln zwischen danger-/write-guard); aendert sich das Muster,
// zieht die andere Kopie mit. Ordnernamen sind entweder explizite Referenzen
// (`back-quoted` oder mit Schraegstrich) oder -- ganz ohne Prosa -- eine reine, getrennte
// Liste blosser Bezeichner. "none"/"keine"/leer/[AUSFUELLEN] => keine Wurzel, Regel inaktiv.
function schreibwurzelnAusText(md) {
  const zeile = String(md).match(/^[ \t]*[-*][ \t]*Additional allowed write roots:[ \t]*(.*)$/im);
  if (!zeile) return [];
  const wert = zeile[1].trim();
  if (!wert || /^\[AUSFUELLEN\]/i.test(wert) || /^(none|keine)\b/i.test(wert)) return [];
  const gefunden = [];
  const merke = (roh) => {
    const t = String(roh).trim().replace(/^[`'"]+|[`'"]+$/g, "").replace(/\/+$/, "");
    if (t && /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(t) && !gefunden.includes(t)) gefunden.push(t);
  };
  // 1) Explizite Ordner-Referenzen: `back-quoted` oder mit Schraegstrich, irgendwo im Text.
  const explizit = /`([^`]+)`|(?:^|[\s,;(])([A-Za-z0-9._-]+\/(?:[A-Za-z0-9._-]+\/?)*)/g;
  let treffer;
  while ((treffer = explizit.exec(wert))) merke(treffer[1] || treffer[2]);
  if (gefunden.length) return gefunden;
  // 2) Keine Marker -> nur eine reine, getrennte Liste blosser Ordnernamen zaehlt; Prosa mit
  //    Leerzeichen bleibt bewusst wirkungslos (Regel inaktiv statt geratenem Ordnernamen).
  const teile = wert.split(/\s*[,;]\s*|\s+(?:and|und|or|oder|&|\+)\s+/i).map((s) => s.trim()).filter(Boolean);
  if (teile.length && teile.every((p) => /^[A-Za-z0-9._-]+$/.test(p))) teile.forEach(merke);
  return gefunden;
}

function leseSchreibwurzeln(projektWurzel) {
  if (!projektWurzel) return [];
  try {
    return schreibwurzelnAusText(fs.readFileSync(path.join(projektWurzel, "docs", "harness-instance.md"), "utf8"));
  } catch {
    return [];
  }
}

// --- W2: Zugangs-Muster. Nur WERT-Formate (Prefix+Laenge), keine Woerter --
// ein Muster auf "password" wuerde jede Doku blocken. Die Muster sind
// zerstueckelt geschrieben, damit dieser Guard sich nicht selbst trifft.
const ZUGANGS_MUSTER = [
  new RegExp("gh[posur]_" + "[A-Za-z0-9]{36}"),            // GitHub-Token
  new RegExp("github_pat_" + "[A-Za-z0-9_]{22,}"),          // GitHub fine-grained
  new RegExp("sk-ant-" + "[A-Za-z0-9-]{20,}"),              // Anthropic
  new RegExp("sk-" + "[A-Za-z0-9]{32,}"),                   // OpenAI u.a.
  new RegExp("AKIA" + "[0-9A-Z]{16}"),                      // AWS Access Key
  new RegExp("xox" + "[baprs]-[A-Za-z0-9-]{10,}"),          // Slack
  new RegExp("AIza" + "[0-9A-Za-z_-]{35}"),                 // Google API
  new RegExp("npm_" + "[A-Za-z0-9]{36}"),                   // npm
  new RegExp("-----BEGIN [A-Z ]*" + "PRIVATE KEY-----"),    // PEM
];
// Wartbare Orte, an denen Beispiel-Werte legitim sind: die Testtabellen des
// Zugangsfilters (muss-fallen-Faelle) und dieser Guard selbst.
const W2_AUSNAHMEN = [/\/dashboard\/test\//, /\/\.claude\/write-guard\.js$/];

// --- W3: .gitignore-Reihenfolge (CLAUDE.md Abschnitt 2) ---
// Blockt nur den messbaren Schadensfall: eine konkrete (glob-freie) Zeile unter einer
// installationsspezifischen Projekt-Container-Wurzel (deps.containerWurzeln aus
// docs/harness-instance.md -- NICHT fest "user-projects", Fund 424) zeigt auf einen
// EXISTIERENDEN Ordner, der nicht selbst der naechste echte Git-Root ist oder kein
// origin hat. Beliebig tiefe Projektpfade sind erlaubt; "eigenes Repo" meint exakt
// dieses User-Projekt, nicht ein zufaelliges Eltern-Repo. Nicht existente Ordner bleiben
// frei. Ohne definierte Container-Wurzel ist die Regel ehrlich inaktiv -- kein Fehlalarm
// UND keine Scheinaktivitaet in einer Fremdinstallation ohne dieses Layout.
function gitignoreVerstoss(inhalt, werkbank, deps) {
  const wurzeln = (deps.containerWurzeln || []).map((w) => String(w).replace(/\/+$/, "")).filter(Boolean);
  if (!wurzeln.length) return null;
  const zeilen = String(inhalt).split(/\r?\n/);
  for (const roh of zeilen) {
    const z = roh.trim();
    for (const wurzel of wurzeln) {
      const prefix = wurzel + "/";
      if (!z.startsWith(prefix)) continue;
      const m = z.slice(prefix.length).match(/^([^\s!#*?\[\]]+?)\/?$/);
      if (!m) continue;
      const rel = wurzel + "/" + m[1];
      const ordner = path.join(werkbank, rel.replaceAll("/", path.sep));
      if (!deps.existiert(ordner)) continue;
      if (!deps.istEigenesRepo(ordner)) return { zeile: rel, grund: "ist kein eigener echter Git-Root" };
      if (!deps.hatRemote(ordner)) return { zeile: rel, grund: "hat kein origin-Remote (nie gepusht)" };
    }
  }
  return null;
}

// --- W5: vom Installer verwaltete Harness-Dateien (guard-parity E10) ---
// Der Installer fuehrt jede Datei, die er ausliefert, in .keel-harness/state.json. Wer eine
// davon direkt aendert, aendert den Harness, unter dem gerade gearbeitet wird; der Installer
// saehe die Abweichung erst beim naechsten Update. Gesperrt sind Eintraege mit ownership
// "distribution" -- ausser entryMode "merge-lines" (etwa .gitignore: dort gehoeren nur die
// Installer-Zeilen der Distribution) --, dazu der Installer-Zustand selbst und die lokalen
// Freigaben. Owner-Daten (ownership "owner") bleiben frei. Ohne state.json keine Regel:
// ein Produkt-Quellbaum ist keine Installation.
//
// A16: state.json ist gross (428 KB bei 2500 Eintraegen) und jedes Schreiben braucht daraus nur die
// verwalteten Pfade. Der Waechter haelt sie in einer abgeleiteten Zwischendatei
// .keel-harness/cache/write-guard-paths.json, samt mtimeMs und size der state.json, aus der sie stammt.
// Weichen beide ab, passt die Regelwurzel nicht oder fehlt die Datei, liest er state.json neu und schreibt
// die Zwischendatei atomar (temp + rename). Die Zwischendatei liegt unter .keel-harness und ist damit selbst
// durch W5 gegen jedes Schreiben der Agenten geschuetzt. Ein Lesefehler an state.json sperrt (fail-closed:
// der Aufrufer faengt den Fehler und sperrt das Schreiben); nur ein fehlendes state.json heisst "keine
// Installation". Die Zwischendatei ist nie Pflicht: ein Fehler beim Lesen oder Schreiben kostet nur Zeit.
const CACHE_SCHEMA = 1;
const cacheDatei = (werkbank) => path.join(werkbank, ".keel-harness", "cache", "write-guard-paths.json");

function zielAusStateEintrag(eintrag) {
  return eintrag && typeof eintrag.target === "string" && eintrag.ownership === "distribution" &&
    eintrag.entryMode !== "merge-lines" ? eintrag.target : null;
}

// Die Form, in der ein Ziel mit norm() verglichen wird, ohne Dateisystemzugriff: Wurzel plus Ziel.
const lexikalisch = (wurzelNorm, ziel) => path.posix.normalize(wurzelNorm + "/" + String(ziel).split("\\").join("/")).toLowerCase();

function ziele2Set(wurzelNorm, ziele, abweichend) {
  const menge = new Set();
  for (const ziel of ziele) {
    menge.add(lexikalisch(wurzelNorm, ziel));
    // Ist die Aufloesung durch das Dateisystem (Link, Kurzname) eine andere, gelten beide Formen.
    if (Object.prototype.hasOwnProperty.call(abweichend, ziel)) menge.add(abweichend[ziel]);
  }
  return menge;
}

function leseZwischendatei(datei, wurzelNorm, info) {
  try {
    const wert = JSON.parse(fs.readFileSync(datei, "utf8"));
    if (!wert || wert.schema !== CACHE_SCHEMA || wert.root !== wurzelNorm ||
        wert.stateMtimeMs !== info.mtimeMs || wert.stateSize !== info.size ||
        !Array.isArray(wert.targets) || !wert.targets.every((ziel) => typeof ziel === "string") ||
        !wert.resolved || typeof wert.resolved !== "object" || Array.isArray(wert.resolved) ||
        !Object.values(wert.resolved).every((ziel) => typeof ziel === "string")) return null;
    return wert;
  } catch {
    return null;
  }
}

function schreibeZwischendatei(datei, inhalt) {
  const temporaer = datei + "." + process.pid + "." + Math.random().toString(16).slice(2) + ".tmp";
  try {
    fs.mkdirSync(path.dirname(datei), { recursive: true });
    fs.writeFileSync(temporaer, JSON.stringify(inhalt), { encoding: "utf8", flag: "wx" });
    fs.renameSync(temporaer, datei);
  } catch {
    try { fs.unlinkSync(temporaer); } catch { /* keine temporaere Datei */ }
  }
}

function verwalteteZiele(werkbank) {
  if (!werkbank) return null;
  const stateDatei = path.join(werkbank, ".keel-harness", "state.json");
  let info;
  try { info = fs.statSync(stateDatei); }
  catch (fehler) {
    if (fehler && (fehler.code === "ENOENT" || fehler.code === "ENOTDIR")) return null; // Produkt-Quellbaum: keine Installation
    throw fehler;
  }
  const wurzelNorm = norm(werkbank);
  const datei = cacheDatei(werkbank);
  const zwischen = leseZwischendatei(datei, wurzelNorm, info);
  if (zwischen) return ziele2Set(wurzelNorm, zwischen.targets, zwischen.resolved);
  // state.json wird nach dem stat gelesen: aendert sie sich dazwischen, passt die Zwischendatei beim naechsten
  // Mal nicht mehr zu stat und wird neu gebaut, nie umgekehrt.
  const zustand = JSON.parse(fs.readFileSync(stateDatei, "utf8"));
  const gesehen = new Set();
  for (const eintrag of Array.isArray(zustand?.entries) ? zustand.entries : []) {
    const ziel = zielAusStateEintrag(eintrag);
    if (ziel !== null) gesehen.add(ziel);
  }
  const ziele = [...gesehen];
  const abweichend = {};
  for (const ziel of ziele) {
    const aufgeloest = norm(path.join(werkbank, ziel));
    if (aufgeloest !== lexikalisch(wurzelNorm, ziel)) abweichend[ziel] = aufgeloest;
  }
  schreibeZwischendatei(datei, { schema: CACHE_SCHEMA, root: wurzelNorm, stateMtimeMs: info.mtimeMs, stateSize: info.size,
    targets: ziele, resolved: abweichend });
  return ziele2Set(wurzelNorm, ziele, abweichend);
}

function istVerwaltet(zielNorm, deps) {
  if (!deps.werkbank || !deps.verwaltet) return false;
  const wurzel = norm(deps.werkbank);
  return deps.verwaltet.has(zielNorm) || liegtUnter(zielNorm, wurzel + "/.keel-harness") ||
    zielNorm === wurzel + "/.claude/settings.local.json";
}

// --- A19 GIT_INTERNALS: <gitdir>/config und <gitdir>/hooks/** ---
// Ein Agent, der dort schreibt, laesst beim naechsten Git-Schritt fremden Code laufen (core.hooksPath,
// core.fsmonitor, Hook-Skripte). Gesperrt ist das Schreiben in <gitdir>/config, <gitdir>/config.worktree und
// <gitdir>/hooks/** fuer jedes Repo, auch fuer das gitdir eines Worktrees (die .git-Datei zeigt auf
// <haupt-gitdir>/worktrees/<name>; Konfiguration und Hooks liegen im commondir), fuer Submodul-gitdirs
// (<gitdir>/modules/<name>/...) und fuer einen separaten Git-Ordner, den eine .git-Datei benennt. Auch die
// .git-Datei selbst ist gesperrt: wer sie umschreibt, waehlt das gitdir und damit dessen Config und Hooks.
// Der Pfad wird in der kanonischen Form verglichen (8.3-Namen, Verbindungspunkte); unter Windows zaehlen
// nachgestellte Punkte und Leerzeichen sowie ein :Datenstrom-Anhang nicht zum Namen.
const segmentSchluessel = (segment) => {
  const klein = String(segment).toLowerCase();
  return process.platform === "win32" ? klein.replace(/:.*$/u, "").replace(/[. ]+$/u, "") : klein;
};

// rest: die Namen unterhalb eines gitdir. true, wenn sie Config oder Hooks treffen.
function gitInterna(rest) {
  if (!rest.length) return false;
  const [kopf] = rest;
  if (rest.length === 1 && (kopf === "config" || kopf === "config.worktree")) return true;
  if (kopf === "hooks") return true;
  if ((kopf === "worktrees" || kopf === "modules") && rest.length >= 3) return gitInterna(rest.slice(2));
  return false;
}

function kleinerText(datei) {
  try {
    const info = fs.lstatSync(datei);
    if (!info.isFile() || info.size > 4096) return null;
    return fs.readFileSync(datei, "utf8");
  } catch { return null; }
}

// Die Git-Ordner, die ein Verzeichnis durch seine .git-Datei benennt: das gitdir und dessen commondir.
function gitOrdnerAusDatei(verzeichnis) {
  const text = kleinerText(path.join(verzeichnis, ".git"));
  const treffer = text && text.match(/^gitdir:[ \t]*(.+?)[ \t]*$/mu);
  if (!treffer) return [];
  const gitdir = path.resolve(verzeichnis, treffer[1]);
  const ordner = [gitdir];
  const gemeinsam = kleinerText(path.join(gitdir, "commondir"));
  if (gemeinsam && gemeinsam.trim()) ordner.push(path.resolve(gitdir, gemeinsam.trim()));
  return ordner;
}

// Ein Ordner, der wie ein Git-Ordner aussieht (HEAD und objects oder commondir), auch ohne .git-Datei davor.
function siehtAusWieGitdir(ordner) {
  try {
    return fs.statSync(path.join(ordner, "HEAD")).isFile() &&
      (fs.existsSync(path.join(ordner, "objects")) || fs.existsSync(path.join(ordner, "commondir")));
  } catch { return false; }
}

function gitInternaVerstoss(ziel) {
  const kanonisch = hookContext.canonicalPath(String(ziel));
  const teile = kanonisch.split(/[\\/]+/u).filter((teil) => teil !== "");
  const schluessel = teile.map(segmentSchluessel);
  // 1. Schreibweise: ein .git-Ordner im Pfad, darunter Config oder Hooks; oder die .git-Datei selbst.
  if (schluessel[schluessel.length - 1] === ".git") return true;
  for (let index = 0; index < schluessel.length - 1; index += 1) {
    if (schluessel[index] === ".git" && gitInterna(schluessel.slice(index + 1))) return true;
  }
  // 2. Ein Git-Ordner ausserhalb des Pfades, den eine .git-Datei eines Elternordners benennt.
  const kleinNorm = norm(kanonisch);
  for (let ordner = path.dirname(kanonisch); ; ordner = path.dirname(ordner)) {
    for (const gitOrdner of gitOrdnerAusDatei(ordner)) {
      const wurzel = norm(hookContext.canonicalPath(gitOrdner));
      if (kleinNorm.startsWith(wurzel + "/") &&
          gitInterna(kleinNorm.slice(wurzel.length + 1).split("/").map(segmentSchluessel))) return true;
    }
    if (path.dirname(ordner) === ordner) break;
  }
  // 3. Ein Git-Ordner ohne .git davor (separater oder bloesser Ordner): config oder hooks in einem Ordner,
  //    der HEAD und objects traegt.
  for (let stelle = kanonisch; path.dirname(stelle) !== stelle; stelle = path.dirname(stelle)) {
    const name = segmentSchluessel(path.basename(stelle));
    const istConfig = stelle === kanonisch && (name === "config" || name === "config.worktree");
    if ((name === "hooks" || istConfig) && siehtAusWieGitdir(path.dirname(stelle))) return true;
  }
  return false;
}

// --- A21 HARNESS_STATE_WRITE: Pruefergebnisse und Executor-Zustand ---
// Freigaben unter ~/.unlazy/approved und der Zustand des Executors (.unlazy/<scope>/executor.json und
// .unlazy/<scope>/executor/**) entstehen nur ueber gate-check und den Package-Executor, die keine
// Werkzeugaufrufe sind. Direktes Schreiben ueber Write/Edit, Shell oder Codex-Patch faelscht sie.
// Ehrliche Grenze (docs/guard-scope.md): beliebiger Testcode unter node --test kann diese Dateien weiter
// schreiben; dagegen hilft nur ein eigenes Windows-Konto.
function freigabeOrdner() {
  const ordner = [path.join(os.homedir(), ".unlazy", "approved")];
  if (process.env.UNLAZY_APPROVAL_DIR) ordner.push(path.resolve(process.env.UNLAZY_APPROVAL_DIR));
  return ordner.map(norm);
}

function harnessZustandVerstoss(zielNorm) {
  if (freigabeOrdner().some((ordner) => liegtUnter(zielNorm, ordner))) return true;
  const schluessel = zielNorm.split("/").map(segmentSchluessel);
  for (let index = 0; index + 2 < schluessel.length; index += 1) {
    if (schluessel[index] !== ".unlazy") continue;
    const name = schluessel[index + 2];
    if (name === "executor.json" && index + 3 === schluessel.length) return true;
    if (name === "executor") return true;
  }
  return false;
}

// --- HOST_TRANSCRIPT_WRITE: der Transkriptspeicher des Hosts ---
// Die Planungsbindung wandert ueber die erste sessionId-Zeile der Transkriptdatei (P4 D15,
// package-bootstrap.cjs adoptByTranscript). Diese Datei schreibt allein der Host. Ein Agent, der sein eigenes
// Transkript beschreibt, faelscht den Beleg und uebernimmt die Bindung einer lebenden fremden Sitzung.
// Gesperrt sind <Benutzerordner>/.claude/projects/** und <CLAUDE_CONFIG_DIR>/projects/** samt der Ordner
// darueber (wer ~/.claude verschiebt und zurueckholt, tauscht den Speicher), dazu der transcript_path der
// Hook-Eingabe, wo immer er liegt. Verglichen wird Segment fuer Segment in der kanonischen Form wie bei A19.
function transkriptSpeicher() {
  const ordner = [path.join(os.homedir(), ".claude", "projects")];
  if (process.env.CLAUDE_CONFIG_DIR) ordner.push(path.join(path.resolve(hookContext.msysPath(process.env.CLAUDE_CONFIG_DIR)), "projects"));
  return ordner;
}

const segmente = (ort) => hookContext.canonicalPath(String(ort)).split(/[\\/]+/u).filter((teil) => teil !== "").map(segmentSchluessel);
const beginntMit = (lang, kurz) => kurz.length <= lang.length && kurz.every((teil, index) => teil === lang[index]);

function transkriptVerstoss(ziel, transkriptPfad) {
  const zielTeile = segmente(ziel);
  for (const speicher of transkriptSpeicher()) {
    const speicherTeile = segmente(speicher);
    if (beginntMit(zielTeile, speicherTeile) || beginntMit(speicherTeile, zielTeile)) return true;
  }
  if (transkriptPfad) {
    const eigenes = segmente(hookContext.msysPath(String(transkriptPfad)));
    if (eigenes.length === zielTeile.length && beginntMit(zielTeile, eigenes)) return true;
  }
  return false;
}

// Der Weg des Agenten zu einer Aenderung am Harness der Installation (guard-scope R9, R10):
// das Update laeuft wie der Aktualisieren-Knopf ueber das Dashboard der Installation
// (Standard-Port des Produkts, dashboard/serve.mjs). Kein Owner-Befehl: die Arbeit macht der
// Agent, der Owner gibt nur sein OK.
const W5_AGENT_ROUTE = "Aenderung im Produkt-Quellbaum (Test-Harness), Release, dann nach dem OK des Owners das " +
  "Harness-Update: der Agent klickt Aktualisieren im Dashboard (Standard-Port 4190, POST /api/harness-update) im Browser-Bereich";

// Es gibt keinen Agentenweg zu <gitdir>/config und <gitdir>/hooks; den Remote und die Git-Einstellungen
// des Repos aendert der Owner ausserhalb einer Agentensitzung. Der Agent meldet die Sperre unter Offen:.
const GIT_INTERNALS_ROUTE = "kein Agentenweg: .git/config und .git/hooks aendert allein der Owner ausserhalb einer Agentensitzung; " +
  "der Agent meldet die Sperre unter Offen:";

// Das Transkript schreibt allein der Host; es gibt keinen Agentenweg dorthin.
const HOST_TRANSCRIPT_ROUTE = "kein Agentenweg: das Transkript der Sitzung schreibt allein der Host (Claude Code); " +
  "eine fremde Planungsbindung uebernimmt der Agent nur von Hand, wenn ihr Halter still ist (package-bootstrap.mjs begin --takeover --reason)";

// Pruefergebnisse schreibt gate-check, den Executor-Zustand schreibt der Package-Executor (beide keine Werkzeugaufrufe).
const HARNESS_STATE_ROUTE = "Pruefergebnisse entstehen durch gate-check (Freigabe der CHECK-Zeilen mit --approve) und " +
  "der Executor-Zustand durch node harness-core/execution/package-executor.mjs (next, start, dispatch, return, integrate); " +
  "diese Dateien schreibt der Agent nie selbst";

// Der Weg des Agenten bei W3 (CLAUDE.md, Reihenfolge fuer ein neues Projekt).
const W3_AGENT_ROUTE = "erst das eigene Repo anlegen und verifiziert pushen, danach die Ignorier-Zeile schreiben";

// Die Vorlage zu einer Sperre (guard-parity E9). W5 und W3: der Agentenweg, kein Befehl.
// W2: ein Zugang erscheint nie in einem Befehl im Chat. W1 und W4 darf allein der Owner
// (ownerOnly): die gesperrte Dateiaenderung als PowerShell-Befehl.
function vorlage(grund, operationen, deps) {
  const code = String(grund || "").match(/^([A-Z][A-Z0-9_]+):/u)?.[1] || "";
  if (code === "GIT_INTERNALS") {
    return ownerHandoff.handoffText({ what: "Aenderung an .git/config oder .git/hooks", route: GIT_INTERNALS_ROUTE });
  }
  if (code === "HOST_TRANSCRIPT_WRITE") {
    return ownerHandoff.handoffText({ what: "Schreiben in den Transkriptspeicher des Hosts", route: HOST_TRANSCRIPT_ROUTE });
  }
  if (code === "HARNESS_STATE_WRITE") {
    return ownerHandoff.handoffText({ what: "direktes Schreiben eines Pruefergebnisses oder des Executor-Zustands",
      route: HARNESS_STATE_ROUTE });
  }
  const regel = String(grund || "").slice(0, 2);
  if (regel === "W5") {
    return ownerHandoff.handoffText({ what: "Aenderung an einer vom Installer verwalteten Harness-Datei",
      route: W5_AGENT_ROUTE });
  }
  if (regel === "W2") {
    return ownerHandoff.handoffText({ what: "ein Zugang soll in eine Datei",
      ownerAction: "Ein Zugang erscheint nie in einem Befehl im Chat. Der Owner legt ihn selbst in den Schluesselbund " +
        "oder eine Umgebungsvariable; der Agent liest ihn von dort." });
  }
  const files = (operationen || []).filter(Boolean);
  if (regel === "W3") {
    return ownerHandoff.handoffText({ what: "Dateiaenderung, die der write-guard sperrt (W3)", route: W3_AGENT_ROUTE, files });
  }
  return ownerHandoff.handoffText({ what: "Dateiaenderung, die der write-guard sperrt (" + regel + ")", files, ownerOnly: true });
}

function pruefen(toolInput, deps) {
  const ziel = toolInput.file_path || toolInput.notebook_path || "";
  const inhalt = toolInput.content ?? toolInput.new_string ?? toolInput.new_source ?? "";
  if (!ziel) return null;
  const zielNorm = norm(ziel);

  // W5 -- Harness selbst (vor W1: auch innerhalb der Werkbank gesperrt)
  if (istVerwaltet(zielNorm, deps)) {
    return (
      `W5: "${ziel}" ist eine vom Installer verwaltete Harness-Datei (.keel-harness/state.json). ` +
      `Den Harness, unter dem gearbeitet wird, aendert keine Sitzung direkt. Weg des Agenten: ${W5_AGENT_ROUTE}.`
    );
  }

  // A19 -- Git-Interna: <gitdir>/config und <gitdir>/hooks/** (vor W1: auch ausserhalb der Wurzeln mit dem eigenen Code)
  if (gitInternaVerstoss(ziel)) {
    return (
      `GIT_INTERNALS: "${ziel}" gehoert zu den Git-Interna (<gitdir>/config, <gitdir>/hooks oder die .git-Datei eines Worktrees). ` +
      `Was dort steht, laeuft beim naechsten Git-Schritt als Code. Weg des Agenten: ${GIT_INTERNALS_ROUTE}.`
    );
  }

  // HOST_TRANSCRIPT_WRITE -- der Transkriptspeicher des Hosts (vor W1: ~/.claude ist sonst ein erlaubtes Schreibziel)
  if (transkriptVerstoss(ziel, deps.transkriptPfad)) {
    return (
      `HOST_TRANSCRIPT_WRITE: "${ziel}" gehoert zum Transkriptspeicher des Hosts (~/.claude/projects, ` +
      `<CLAUDE_CONFIG_DIR>/projects oder transcript_path der Sitzung). Er belegt, welche Unterhaltung eine Planungsbindung ` +
      `traegt. Weg des Agenten: ${HOST_TRANSCRIPT_ROUTE}.`
    );
  }

  // A21 -- Pruefergebnisse und Executor-Zustand nur ueber die vorgesehenen Wege
  if (harnessZustandVerstoss(zielNorm)) {
    return (
      `HARNESS_STATE_WRITE: "${ziel}" ist ein Pruefergebnis (~/.unlazy/approved) oder Executor-Zustand ` +
      `(.unlazy/<scope>/executor.json, .unlazy/<scope>/executor/**). Weg des Agenten: ${HARNESS_STATE_ROUTE}.`
    );
  }

  // W1 -- Schreibziel
  if (!deps.wurzeln.map(norm).some((w) => liegtUnter(zielNorm, w))) {
    return (
      `W1: "${ziel}" liegt ausserhalb der erlaubten Schreibziele ` +
      `(Werkbank, tmp, ~/.claude, ~/.codex). Gewollt? Der Mensch traegt den Ort in ` +
      `danger-guard erlaubteWurzeln() UND die Spiegel-Liste hier ein.`
    );
  }
  if (deps.werkbank && zielNorm === norm(path.join(deps.werkbank, ".claude", "mutation-policy.json"))) {
    return (
      `W4: "${ziel}" ist die Owner-Politikdatei der Mutationsgrenze (.claude/mutation-policy.json). ` +
      `Nur der Owner aendert sie, ausserhalb einer Agentensitzung; der Agent nennt ihm den gewuenschten Eintrag.`
    );
  }

  // W2 -- Zugaenge
  if (!W2_AUSNAHMEN.some((re) => re.test(zielNorm))) {
    for (const muster of ZUGANGS_MUSTER) {
      const treffer = String(inhalt).match(muster);
      if (treffer) {
        return (
          `W2: Der Inhalt enthaelt ein Zugangs-Muster (${treffer[0].slice(0, 12)}…). ` +
          `Keine Zugaenge in Dateien -- Schluesselbund oder Umgebungsvariablen (CLAUDE.md).`
        );
      }
    }
  }

  // W3 -- .gitignore-Reihenfolge
  if (path.basename(zielNorm) === ".gitignore" && deps.werkbank && liegtUnter(zielNorm, norm(deps.werkbank))) {
    const v = gitignoreVerstoss(inhalt, deps.werkbank, deps);
    if (v) {
      return (
        `W3: Die Zeile "${v.zeile}/" wuerde einen Ordner unsichtbar machen, ` +
        `der ${v.grund}. Reihenfolge (CLAUDE.md): erst Repo anlegen und verifiziert pushen, ` +
        `DANN die Ignorier-Zeile.`
      );
    }
  }

  return null;
}

// eingabe.transcriptPath: transcript_path der Hook-Eingabe; dieses Transkript ist zusaetzlich gesperrt.
function echteDeps(projectRoot = REGELWURZEL, eingabe = {}) {
  return {
    transkriptPfad: eingabe && eingabe.transcriptPath ? String(eingabe.transcriptPath) : "",
    wurzeln: erlaubteWurzeln(projectRoot),
    werkbank: projectRoot,
    verwaltet: verwalteteZiele(projectRoot),
    containerWurzeln: leseSchreibwurzeln(projectRoot),
    existiert: fs.existsSync,
    istEigenesRepo: (ordner) => {
      try {
        return packageContext.samePath(packageContext.resolveRepositoryRoot(ordner), ordner);
      } catch {
        return false;
      }
    },
    hatRemote: (ordner) => {
      try {
        const frage = { cwd: ordner, windowsHide: true, shell: false, stdio: ["ignore", "pipe", "ignore"] };
        const antwort = gitBinary ? gitBinary.gitSync(["remote", "get-url", "origin"], frage)
          : spawnSync("git", ["remote", "get-url", "origin"], frage);
        return !antwort.error && antwort.status === 0;
      } catch {
        return false;
      }
    },
  };
}

// --- Selbsttest: Analyse pur, deps gefaked ---
function selfTest() {
  const wb = "C:\\werkbank";
  const vorhanden = new Set([
    norm(path.join(wb, "user-projects", "ohne-git")),
    norm(path.join(wb, "user-projects", "mit-git")),
    norm(path.join(wb, "user-projects", "mit-git", ".git")),
    norm(path.join(wb, "user-projects", "gruppe", "nested")),
    norm(path.join(wb, "user-projects", "gruppe", "nested", ".git")),
    norm(path.join(wb, "user-projects", "gruppe", "nur-eltern")),
  ]);
  const deps = {
    wurzeln: [norm(wb), norm(os.tmpdir())],
    werkbank: wb,
    verwaltet: new Set([norm(path.join(wb, ".claude", "danger-guard.js"))]),
    containerWurzeln: ["user-projects"],
    existiert: (p) => vorhanden.has(norm(p)),
    istEigenesRepo: (ordner) => vorhanden.has(norm(path.join(ordner, ".git"))),
    hatRemote: (ordner) => norm(ordner).endsWith("mit-git") || norm(ordner).endsWith("gruppe/nested"),
  };
  const gh = "ghp_" + "a".repeat(36);
  const faelle = [
    // [name, toolInput, erwartetBlock]
    ["W1 ausserhalb", { file_path: "C:\\anderswo\\x.txt", content: "hi" }, true],
    ["W1 innerhalb", { file_path: wb + "\\docs\\x.md", content: "hi" }, false],
    ["W1 Bundle-Pfad innerhalb", { file_path: wb + "\\docs\\packages\\release\\PACKAGE.md", content: "hi" }, false],
    ["W1 Runtime-Pfad innerhalb", { file_path: wb + "\\.unlazy\\main\\package.ref", content: "hi" }, false],
    ["W2 GitHub-Token", { file_path: wb + "\\a.js", content: "const t = '" + gh + "';" }, true],
    ["W2 blosses Wort", { file_path: wb + "\\a.md", content: "Das Passwort steht im Schluesselbund." }, false],
    ["W2 Ausnahme Testtabelle", { file_path: wb + "\\dashboard\\test\\z.test.js", content: gh }, false],
    ["W3 Ordner ohne .git", { file_path: wb + "\\.gitignore", content: "user-projects/ohne-git/\n" }, true],
    ["W3 Repo mit Remote", { file_path: wb + "\\.gitignore", content: "user-projects/mit-git/\n" }, false],
    ["W3 tiefes Projekt mit eigenem Repo", { file_path: wb + "\\.gitignore", content: "user-projects/gruppe/nested/\n" }, false],
    ["W3 tiefes Projekt nur im Eltern-Repo", { file_path: wb + "\\.gitignore", content: "user-projects/gruppe/nur-eltern/\n" }, true],
    ["W3 Ordner existiert nicht", { file_path: wb + "\\.gitignore", content: "user-projects/geplant/\n" }, false],
    ["W3 .unlazy-Regel bleibt frei", { file_path: wb + "\\.gitignore", content: ".unlazy/\n" }, false],
    ["W5 verwaltete Harness-Datei", { file_path: wb + "\\.claude\\danger-guard.js", content: "x" }, true],
    ["W5 lokale Freigaben", { file_path: wb + "\\.claude\\settings.local.json", content: "{}" }, true],
    ["W5 Installer-Zustand", { file_path: wb + "\\.keel-harness\\state.json", content: "{}" }, true],
    ["W5 Owner-Datei bleibt frei", { file_path: wb + "\\docs\\harness-instance.md", content: "x" }, false],
    ["A19 .git/config", { file_path: wb + "\\user-projects\\app\\.git\\config", content: "x" }, true],
    ["A19 .git/hooks/pre-commit", { file_path: wb + "\\.git\\hooks\\pre-commit", content: "x" }, true],
    ["A19 Worktree-gitdir config.worktree", { file_path: wb + "\\.git\\worktrees\\wt1\\config.worktree", content: "x" }, true],
    ["A19 .git-Datei eines Worktrees", { file_path: wb + "\\wt\\P4\\.git", content: "gitdir: x" }, true],
    ["A19 .git/info bleibt frei", { file_path: wb + "\\.git\\info\\exclude", content: "x" }, false],
    ["A19 Ordner namens config bleibt frei", { file_path: wb + "\\docs\\config", content: "x" }, false],
    ["A21 Executor-Zustand", { file_path: wb + "\\.unlazy\\main\\executor.json", content: "{}" }, true],
    ["A21 Executor-Lauf", { file_path: wb + "\\.unlazy\\main\\executor\\runs\\r1\\state.json", content: "{}" }, true],
    ["A21 Freigaben", { file_path: path.join(os.homedir(), ".unlazy", "approved", "x.json"), content: "{}" }, true],
    ["Transkript des Hosts", { file_path: path.join(os.homedir(), ".claude", "projects", "p", "s.jsonl"), content: "{}" }, true],
    ["A21 Paketbuendel bleibt frei", { file_path: wb + "\\docs\\packages\\a\\evidence\\x.md", content: "x" }, false],
  ];
  let fehler = 0;
  for (const [name, input, soll] of faelle) {
    const ist = pruefen(input, deps) !== null;
    const ok = ist === soll;
    if (!ok) fehler++;
    console.log(`${ok ? "ok  " : "FEHL"} ${soll ? "BLOCK" : "frei "} ${name}`);
  }
  // --- Fund 424: Container-Wurzeln aus dem Instanzprofil; "none"/leer/Prosa => keine Wurzel ---
  const wurzelFaelle = [
    ["none-Prosa (Lab)", "- Additional allowed write roots: none beyond the owning repository and bounded temporary storage\n", []],
    ["Platzhalter", "- Additional allowed write roots: [AUSFUELLEN]\n", []],
    ["Zeile fehlt", "# Instance\n- Owner role: eine Person\n", []],
    ["blosse Liste", "- Additional allowed write roots: user-projects, work\n", ["user-projects", "work"]],
    ["Backtick/Schraegstrich", "- Additional allowed write roots: `clients/` and `vendor/`\n", ["clients", "vendor"]],
    ["Einzelordner", "- Additional allowed write roots: projekte\n", ["projekte"]],
    ["reine Prosa ohne none", "- Additional allowed write roots: only the owning repository here\n", []],
  ];
  for (const [name, md, soll] of wurzelFaelle) {
    const ist = schreibwurzelnAusText(md);
    const ok = JSON.stringify(ist) === JSON.stringify(soll);
    if (!ok) fehler++;
    console.log(`${ok ? "ok  " : "FEHL"} wurzeln ${name.padEnd(24)} -> [${ist.join(", ")}]`);
  }
  // W3 bleibt ohne definierte Container-Wurzel ehrlich inaktiv (Fremdinstallation).
  const w3Inaktiv = pruefen({ file_path: wb + "\\.gitignore", content: "user-projects/ohne-git/\n" }, { ...deps, containerWurzeln: [] });
  if (w3Inaktiv !== null) fehler++;
  console.log(`${w3Inaktiv === null ? "ok  " : "FEHL"} frei  W3 inaktiv ohne Container-Wurzel im Instanzprofil`);
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "write-guard-package-context-"));
  let childResolved = false;
  try {
    const child = path.join(fixture, "child");
    fs.mkdirSync(child, { recursive: true });
    execFileSync(gitProgram(), ["-C", fixture, "init", "--quiet"], { windowsHide: true });
    execFileSync(gitProgram(), ["-C", child, "init", "--quiet"], { windowsHide: true });
    const target = path.join(child, "docs", "packages", "release", "PACKAGE.md");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    childResolved = packageContext.samePath(packageContext.resolveRepositoryRoot(target), child);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
  if (!childResolved) fehler++;
  console.log(`${childResolved ? "ok  " : "FEHL"} frei  Paketresolver bindet Schreibziel an Kind-Repo`);
  const gesamt = faelle.length + wurzelFaelle.length + 2; // + W3-inaktiv + Paketresolver
  console.log(`${gesamt - fehler} von ${gesamt} Faellen richtig.`);
  return fehler;
}

if (require.main === module && (process.argv.includes("--self-test") || process.argv.includes("--selbsttest"))) {
  process.exit(selfTest() ? 1 : 0);
}

// Every hook of a session is a sign of life of its planning binding (P4 D15); the touch never decides
// anything and never fails the hook.
function noteActivity(payload) {
  try { require("../harness-core/binding/hook-activity.cjs").noteHookInput(payload); } catch { /* a record, not a decision */ }
}

// The decision of one hook call (package P5, A1): null lets the write pass, a string is the denial text. The hook main
// program and the one guard process (.claude/pretool-guards.js) both use it.
function hookDecision(daten) {
  const werkzeugEingabe = daten?.tool_input || {};
  let deps;
  let grund;
  try {
    deps = echteDeps(hookContext.ruleRoot(), { transcriptPath: daten?.transcript_path }); // the rule root of this call (P5: one process, read at call time)
    grund = pruefen(werkzeugEingabe, deps);
  } catch (error) {
    return "write-guard: policy evaluation failed; write blocked: " + error.message;
  }
  if (!grund) return null;
  // The denial itself must not depend on the Owner template (guard-parity A9).
  let text;
  try {
    const ziel = werkzeugEingabe.file_path ? path.resolve(hookContext.msysPath(String(werkzeugEingabe.file_path))) : "";
    text = vorlage(grund, [ownerHandoff.toolFileOperation(daten.tool_name, werkzeugEingabe, ziel)], deps);
  } catch (error) {
    text = "(Owner-Vorlage nicht erzeugbar: " + error.message + ")";
  }
  const code = String(grund).match(/^([A-Z][A-Z0-9_]+):/u)?.[1] || String(grund).slice(0, 2);
  return `write-guard hat den Schreibzugriff NICHT ausgefuehrt.\n\n  ${grund}\n` + guardRoutes.referenceLine("write-guard", code) + "\n" + text;
}

if (require.main === module) {
  let eingabe = "";
  process.stdin.on("data", (c) => (eingabe += c));
  process.stdin.on("end", () => {
    let daten;
    try {
      daten = JSON.parse(eingabe || "{}");
    } catch {
      return block("write-guard: invalid hook input; write blocked");
    }
    noteActivity(daten); // sign of life of the planning session (D15), before anything is judged
    const denial = hookDecision(daten);
    return denial === null ? process.exit(0) : block(denial);
  });
}

module.exports = { echteDeps, gitignoreVerstoss, hookDecision, gitInternaVerstoss, harnessZustandVerstoss, pruefen, selfTest,
  schreibwurzelnAusText, leseSchreibwurzeln, transkriptVerstoss, verwalteteZiele, vorlage };
