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
// Selbsttest: node write-guard.js --selbsttest

const { execFileSync, execSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const packageContext = require("./package-context.js");

// MSYS/Git-Bash schreibt Laufwerke als /c/... (Muster: danger-guard, belegt 22.08.2026).
function msysPfad(p) {
  if (process.platform !== "win32" || !p) return p;
  return String(p).replace(/^\/([A-Za-z])(?=\/|$)/, "$1:");
}

const norm = (p) => path.resolve(msysPfad(String(p))).split(path.sep).join("/").toLowerCase();
const liegtUnter = (kind, wurzel) => kind === wurzel || kind.startsWith(wurzel + "/");

// Gespiegelt aus danger-guard erlaubteWurzeln() -- erweitert der Owner dort,
// muss diese Liste mitziehen (Onboarding Punkt "Schreibziele des Waechters").
function erlaubteWurzeln(projectRoot = process.env.CLAUDE_PROJECT_DIR || null) {
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

function pruefen(toolInput, deps) {
  const ziel = toolInput.file_path || toolInput.notebook_path || "";
  const inhalt = toolInput.content ?? toolInput.new_string ?? toolInput.new_source ?? "";
  if (!ziel) return null;
  const zielNorm = norm(ziel);

  // W1 -- Schreibziel
  if (!deps.wurzeln.some((w) => liegtUnter(zielNorm, w))) {
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

function echteDeps(projectRoot = process.env.CLAUDE_PROJECT_DIR || null) {
  return {
    wurzeln: erlaubteWurzeln(projectRoot),
    werkbank: projectRoot,
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
    let daten = {};
    try {
      daten = JSON.parse(eingabe || "{}");
    } catch {}
    const grund = pruefen(daten?.tool_input || {}, echteDeps());
    if (grund) {
      process.stderr.write(`write-guard hat den Schreibzugriff NICHT ausgefuehrt.\n\n  ${grund}\n`);
      process.exit(2);
    }
    process.exit(0);
  });
}

module.exports = { echteDeps, gitignoreVerstoss, pruefen, selfTest, schreibwurzelnAusText, leseSchreibwurzeln };
