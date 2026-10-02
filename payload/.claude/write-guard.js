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

const { execFileSync, execSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const GUARD_TARGET = ".claude/write-guard.js";

// Inline deny transport (identical in every PreToolUse guard; guard-parity E5): a missing
// sibling module must never turn a denial into an allow. Under the Codex hook runner a
// JSON deny with exit 0 survives Windows PowerShell, which maps a native exit 2 to 1.
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

// Fehlt eine Nachbardatei, sperrt der Waechter, statt abzustuerzen (ein Absturz waere fuer
// Claude ein nicht blockierender Hook-Fehler).
let packageContext;
let ownerHandoff;
let hookContext;
try {
  packageContext = require("./package-context.js");
  ownerHandoff = require("../harness-core/guards/owner-handoff.cjs");
  hookContext = require("../harness-core/guards/hook-context.cjs");
} catch (error) {
  if (require.main === module) block("write-guard: dependency load failed; write blocked: " + error.message);
  throw error;
}

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
function verwalteteZiele(werkbank) {
  if (!werkbank) return null;
  let zustand;
  try { zustand = JSON.parse(fs.readFileSync(path.join(werkbank, ".keel-harness", "state.json"), "utf8")); }
  catch { return null; }
  const ziele = new Set();
  for (const eintrag of Array.isArray(zustand?.entries) ? zustand.entries : []) {
    if (!eintrag || typeof eintrag.target !== "string") continue;
    if (eintrag.ownership === "distribution" && eintrag.entryMode !== "merge-lines") ziele.add(norm(path.join(werkbank, eintrag.target)));
  }
  return ziele;
}

function istVerwaltet(zielNorm, deps) {
  if (!deps.werkbank || !deps.verwaltet) return false;
  const wurzel = norm(deps.werkbank);
  return deps.verwaltet.has(zielNorm) || liegtUnter(zielNorm, wurzel + "/.keel-harness") ||
    zielNorm === wurzel + "/.claude/settings.local.json";
}

// Der Weg des Agenten zu einer Aenderung am Harness der Installation (guard-scope R9, R10):
// das Update laeuft wie der Aktualisieren-Knopf ueber das Dashboard der Installation
// (Standard-Port des Produkts, dashboard/serve.mjs). Kein Owner-Befehl: die Arbeit macht der
// Agent, der Owner gibt nur sein OK.
const W5_AGENT_ROUTE = "Aenderung im Produkt-Quellbaum (Test-Harness), Release, dann nach dem OK des Owners das " +
  "Harness-Update: der Agent klickt Aktualisieren im Dashboard (Standard-Port 4190, POST /api/harness-update) im Browser-Bereich";

// Der Weg des Agenten bei W3 (CLAUDE.md, Reihenfolge fuer ein neues Projekt).
const W3_AGENT_ROUTE = "erst das eigene Repo anlegen und verifiziert pushen, danach die Ignorier-Zeile schreiben";

// Die Vorlage zu einer Sperre (guard-parity E9). W5 und W3: der Agentenweg, kein Befehl.
// W2: ein Zugang erscheint nie in einem Befehl im Chat. W1 und W4 darf allein der Owner
// (ownerOnly): die gesperrte Dateiaenderung als PowerShell-Befehl.
function vorlage(grund, operationen, deps) {
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

function echteDeps(projectRoot = REGELWURZEL) {
  return {
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
        execSync("git remote get-url origin", { cwd: ordner, stdio: ["pipe", "pipe", "ignore"] });
        return true;
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
    execFileSync("git", ["-C", fixture, "init", "--quiet"], { windowsHide: true });
    execFileSync("git", ["-C", child, "init", "--quiet"], { windowsHide: true });
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
    const werkzeugEingabe = daten?.tool_input || {};
    let deps;
    let grund;
    try {
      deps = echteDeps();
      grund = pruefen(werkzeugEingabe, deps);
    } catch (error) {
      return block("write-guard: policy evaluation failed; write blocked: " + error.message);
    }
    if (!grund) return process.exit(0);
    const ziel = werkzeugEingabe.file_path ? path.resolve(hookContext.msysPath(String(werkzeugEingabe.file_path))) : "";
    block(`write-guard hat den Schreibzugriff NICHT ausgefuehrt.\n\n  ${grund}\n` +
      vorlage(grund, [ownerHandoff.toolFileOperation(daten.tool_name, werkzeugEingabe, ziel)], deps));
  });
}

module.exports = { echteDeps, gitignoreVerstoss, pruefen, selfTest, schreibwurzelnAusText, leseSchreibwurzeln,
  verwalteteZiele, vorlage };
