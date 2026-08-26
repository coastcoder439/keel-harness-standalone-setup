#!/usr/bin/env node
// SessionStart-Hook: misst, ob der USER-Scope (~/.claude) Fremdmaterial in die
// Session laedt -- rules/, agents/, skills/ laden IMMER in jedes Projekt, ein
// Abschalt-Schalter existiert laut offizieller Doku nicht (gemessen und belegt
// 25.08.2026, docs/packages/global-rules-bloat.md: 228 KB ECC-Regeln + 365 KB
// ECC-Agenten lagen unbemerkt in JEDER Session). [Owner: "ECC darf nur
// workspace-/projekt-basiert installiert werden, nicht global"]
//
// Der Waechter loescht nichts -- er macht Verschmutzung SICHTBAR, sobald sie
// wieder entsteht. Eigene, bewusst globale Skills stehen in EIGENE_SKILLS.

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

if (funde.length) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext:
          "VERSCHMUTZUNGS-WARNUNG: Der globale User-Scope laedt Fremdmaterial in JEDE Session " +
          "dieses Rechners -- " + funde.join(" | ") + ". Regel [Owner 25.08.2026]: solche Pakete " +
          "gehoeren projekt-lokal (.claude/ des Projekts), nie nach ~/.claude. Dem Menschen melden.",
      },
    })
  );
}
