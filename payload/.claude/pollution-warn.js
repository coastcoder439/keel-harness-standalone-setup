#!/usr/bin/env node
// SessionStart-Hook: misst, ob der USER-Scope (~/.claude) Fremdmaterial in die
// Session laedt -- rules/, agents/, skills/ laden IMMER in jedes Projekt, ein
// Abschalt-Schalter existiert laut offizieller Doku nicht (im Ursprungs-Harness
// lagen 228 KB ECC-Regeln und 365 KB ECC-Agenten unbemerkt in jeder Session).
// [Owner: "ECC darf nur
// workspace-/projekt-basiert installiert werden, nicht global"]
//
// Der Waechter loescht nichts -- er macht Verschmutzung SICHTBAR, sobald sie
// wieder entsteht. Eigene, bewusst globale Skills stehen in EIGENE_SKILLS.
//
// Zweite Messung, gleicher Ausloeser: das Agenten-Gedaechtnis des Projekts
// (~/.claude/projects/<slug>/memory). Gemeldet werden tote Index-Zeilen in MEMORY.md
// und Eintraege, die festlegen, was der Harness regelt (Modell, Effort, Git-Weg,
// Arbeitsablauf). [Owner 01.10.2026: "Weil das alles im Harness indexiert und
// festgelegt ist."] Nur melden: nichts loeschen oder aendern; der Notizinhalt
// erscheint nie in der Ausgabe.

const fs = require("fs");
const path = require("path");
const os = require("os");

const H = path.join(os.homedir(), ".claude");
const EIGENE_SKILLS = new Set(["gauntlet-loop", "learned"]);

function mdDateien(dir) {
  try {
    let n = 0, bytes = 0;
    const stapel = [dir];
    while (stapel.length) {
      const d = stapel.pop();
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) stapel.push(p);
        else if (e.name.endsWith(".md")) { n++; bytes += fs.statSync(p).size; }
      }
    }
    return { n, bytes };
  } catch { return { n: 0, bytes: 0 }; }
}

const funde = [];
const rules = mdDateien(path.join(H, "rules"));
if (rules.n > 0) funde.push(`~/.claude/rules: ${rules.n} Datei(en), ${rules.bytes} Bytes`);
const agents = mdDateien(path.join(H, "agents"));
if (agents.n > 0) funde.push(`~/.claude/agents: ${agents.n} Agent(en), ${agents.bytes} Bytes`);
// commands/ laden als Slash-Skills ebenfalls in JEDE Session (Description pro Datei
// im Dauer-Kontext) -- 26.08.2026 uebersehen gefunden: 76 ECC-Dateien, 317 KB.
const cmds = mdDateien(path.join(H, "commands"));
if (cmds.n > 0) funde.push(`~/.claude/commands: ${cmds.n} Command(s), ${cmds.bytes} Bytes`);
try {
  const fremd = fs.readdirSync(path.join(H, "skills")).filter((s) => !EIGENE_SKILLS.has(s));
  if (fremd.length) funde.push(`~/.claude/skills: fremde Skills ${fremd.join(", ")}`);
} catch {}

// Was der Harness regelt; ein Gedaechtnis-Eintrag, der darauf passt, wird gemeldet.
const MEMORY_MODEL = /\b(?:opus|sonnet|haiku)\b|\bgpt-\d|\bclaude-(?:opus|sonnet|haiku)/iu;
const MEMORY_EFFORT = /\beffort\b/iu;
const MEMORY_GIT = /\b(?:force-push|push|merge|rebase|cherry-pick|commit|worktree)\b|arbeitsb(?:a|ä)um/iu;
const MEMORY_WORKFLOW = /\b(?:welle|wellen|subagent\w*|unteragent\w*|orchestrator\w*)\b/iu;
const MEMORY_CATEGORIES = [["Modell", MEMORY_MODEL], ["Effort", MEMORY_EFFORT], ["Git-Weg", MEMORY_GIT],
  ["Arbeitsablauf", MEMORY_WORKFLOW]];
const MEMORY_LIMIT = 10;

function memoryCategories(text) {
  return MEMORY_CATEGORIES.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
}

function memoryFindings() {
  const project = process.env.CLAUDE_PROJECT_DIR || process.env.KEEL_HARNESS_ROOT || process.cwd();
  const slug = String(project).replace(/[^A-Za-z0-9]/gu, "-");
  const folder = path.join(os.homedir(), ".claude", "projects", slug, "memory");
  if (!fs.existsSync(folder)) return [];
  const findings = [];
  const index = path.join(folder, "MEMORY.md");
  if (fs.existsSync(index)) {
    fs.readFileSync(index, "utf8").split(/\r?\n/u).forEach((line, at) => {
      const link = line.match(/^\s*-\s*\[[^\]]*\]\(([^)]+\.md)\)/u);
      if (link && !fs.existsSync(path.join(folder, link[1]))) findings.push(`MEMORY.md Zeile ${at + 1}: ${link[1]} fehlt`);
      const hit = memoryCategories(line);
      if (hit.length) findings.push(`MEMORY.md Zeile ${at + 1}: ${hit.join(", ")}`);
    });
  }
  for (const name of fs.readdirSync(folder).sort()) {
    if (name === "MEMORY.md" || !name.endsWith(".md")) continue;
    const file = path.join(folder, name);
    if (!fs.statSync(file).isFile()) continue;
    const hit = memoryCategories(fs.readFileSync(file, "utf8"));
    if (hit.length) findings.push(`${name}: ${hit.join(", ")}`);
  }
  return findings;
}

const warnungen = [];
if (funde.length) {
  warnungen.push(
    "VERSCHMUTZUNGS-WARNUNG: Der globale User-Scope laedt Fremdmaterial in JEDE Session " +
    "dieses Rechners -- " + funde.join(" | ") + ". Regel [Owner 25.08.2026]: solche Pakete " +
    "gehoeren projekt-lokal (.claude/ des Projekts), nie nach ~/.claude. Dem Menschen melden.");
}
let gedaechtnis = [];
try { gedaechtnis = memoryFindings(); } catch { gedaechtnis = []; }
if (gedaechtnis.length) {
  const shown = gedaechtnis.slice(0, MEMORY_LIMIT).join(" | ") +
    (gedaechtnis.length > MEMORY_LIMIT ? ` | und ${gedaechtnis.length - MEMORY_LIMIT} weitere` : "");
  warnungen.push(
    "GEDAECHTNIS-WARNUNG: " + shown + ". Diese Eintraege legen fest, was der Harness regelt (Modell und Effort: " +
    "docs/harness-instance.md; Git: harness-core/git/git-intent.mjs; Ablauf: CLAUDE.md und " +
    ".claude/rules/keel/working-method.md). Bei Widerspruch gilt der Harness [Owner 30.09.2026: " +
    "\"DER HARNESS REGELT DAS NICHT DU\"]. Dem Menschen melden.");
}

if (warnungen.length) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: warnungen.join("\n\n"),
      },
    })
  );
}
