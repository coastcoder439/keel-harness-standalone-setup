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
// Blockt nur den messbaren Schadensfall: eine konkrete (glob-freie) Zeile unter
// user-projects/ zeigt auf einen EXISTIERENDEN Ordner, der nicht selbst der
// naechste echte Git-Root ist oder kein origin hat. Beliebig tiefe Projektpfade
// sind erlaubt; "eigenes Repo" meint damit exakt dieses User-Projekt, nicht ein
// zufaelliges Eltern-Repo. Nicht existente Ordner bleiben frei.
function gitignoreVerstoss(inhalt, werkbank, deps) {
  const zeilen = String(inhalt).split(/\r?\n/);
  for (const z of zeilen) {
    const m = z.trim().match(/^user-projects\/([^\s!#*?\[\]]+?)\/?$/);
    if (!m) continue;
    const relProjekt = m[1].replaceAll("/", path.sep);
    const ordner = path.join(werkbank, "user-projects", relProjekt);
    if (!deps.existiert(ordner)) continue;
    if (!deps.istEigenesRepo(ordner)) return { projekt: m[1], grund: "ist kein eigener echter Git-Root" };
    if (!deps.hatRemote(ordner)) return { projekt: m[1], grund: "hat kein origin-Remote (nie gepusht)" };
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
        `W3: Die Zeile "user-projects/${v.projekt}/" wuerde einen Ordner unsichtbar machen, ` +
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
  console.log(`${faelle.length + 1 - fehler} von ${faelle.length + 1} Faellen richtig.`);
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

module.exports = { echteDeps, gitignoreVerstoss, pruefen, selfTest };
