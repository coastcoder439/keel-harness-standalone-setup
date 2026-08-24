#!/usr/bin/env node
// Stop-Hook: Definition-of-Done-Format-Check.
// Hat der Turn ARBEIT geleistet (Write/Edit/NotebookEdit oder ein git commit),
// muss die Schluss-Nachricht das Abschluss-Format tragen:
//   "Geprueft gegen: ..." UND "Offen: ..."
// Sonst wird das Turn-Ende geblockt (exit 2) und die Nacharbeit angefordert.
//
// Warum FORMAT-Check statt Wortmuster-Raten [Owner, 24.08.2026]: ein Verbot
// ("sag nie fertig") ist Prosa und wurde am selben Tag live verfehlt; ein
// Format ist eine messbare Struktur. Der Ausloeser ist ebenfalls messbar:
// nicht "klingt nach Abschluss", sondern "es wurde geschrieben/committet".
// Evidenz-Hintergrund: Compliance sinkt mit dem SESSION-FORTSCHRITT
// (arXiv 2605.10039: -5,6% Odds je generierter Funktion) -- genau dafuer
// braucht es eine Schranke, die am ENDE des Turns greift, nicht am Anfang.
// Selbsttest: node dod-guard.js --selbsttest

const fs = require("fs");

// MSYS/Git-Bash schreibt Laufwerke als /c/... (Muster: danger-guard, belegt 22.08.2026).
function msysPfad(p) {
  if (process.platform !== "win32" || !p) return p;
  return String(p).replace(/^\/([A-Za-z])(?=\/|$)/, "$1:");
}

const ARBEITS_TOOLS = new Set(["Write", "Edit", "NotebookEdit"]);
const DOD_GEPRUEFT = /gepr(ue|ü)ft gegen\s*:/i;
const DOD_OFFEN = /\boffen\s*:/i;

// Echte User-Nachricht = string-Content oder Liste mit text-Block und OHNE
// tool_result (Werkzeug-Rueckgaben laufen als type:user mit tool_result-Bloecken).
function istEchteUserNachricht(e) {
  if (e.type !== "user") return false;
  const c = e.message && e.message.content;
  if (typeof c === "string") return true;
  if (!Array.isArray(c)) return false;
  if (c.some((b) => b && b.type === "tool_result")) return false;
  return c.some((b) => b && b.type === "text");
}

// Analyse pur, testbar: bekommt die geparsten Transcript-Eintraege.
function pruefen(eintraege) {
  let letzterUser = -1;
  for (let i = eintraege.length - 1; i >= 0; i--) {
    if (istEchteUserNachricht(eintraege[i])) { letzterUser = i; break; }
  }
  let arbeit = false;
  let schlussText = "";
  for (let i = letzterUser + 1; i < eintraege.length; i++) {
    const e = eintraege[i];
    if (e.type !== "assistant") continue;
    const c = e.message && e.message.content;
    if (!Array.isArray(c)) continue;
    for (const b of c) {
      if (!b) continue;
      if (b.type === "tool_use") {
        if (ARBEITS_TOOLS.has(b.name)) arbeit = true;
        else if (b.name === "Bash" && /\bgit\b[^\n]*\bcommit\b/.test(String((b.input && b.input.command) || ""))) arbeit = true;
      } else if (b.type === "text" && b.text && b.text.trim()) {
        schlussText = b.text;
      }
    }
  }
  if (!arbeit) return null;
  if (!schlussText) return null; // kein Text zu pruefen -- nicht Aufgabe dieses Waechters
  if (DOD_GEPRUEFT.test(schlussText) && DOD_OFFEN.test(schlussText)) return null;
  return (
    "Dieser Turn hat Dateien geschrieben oder committet, aber die Schluss-Nachricht " +
    "traegt kein Definition-of-Done-Format. Ergaenze am Ende der Meldung zwei Zeilen: " +
    '"Geprueft gegen: <Quellen/Tests/Kommandos>" und "Offen: <Liste oder nichts>". ' +
    "(working-method.md; Format statt Fertig-Behauptung.)"
  );
}

// --- Selbsttest: Fixtures in-memory ---
if (process.argv.includes("--selbsttest")) {
  const user = (t) => ({ type: "user", message: { content: t } });
  const toolResult = () => ({ type: "user", message: { content: [{ type: "tool_result", content: "ok" }] } });
  const edit = () => ({ type: "assistant", message: { content: [{ type: "tool_use", name: "Edit", input: {} }] } });
  const bash = (cmd) => ({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: { command: cmd } }] } });
  const text = (t) => ({ type: "assistant", message: { content: [{ type: "text", text: t }] } });
  const DOD = "Alles gebaut.\nGeprueft gegen: Tests 5/5\nOffen: nichts";
  const faelle = [
    ["Arbeit + DoD -> frei", [user("bau"), edit(), toolResult(), text(DOD)], false],
    ["Arbeit ohne DoD -> BLOCK", [user("bau"), edit(), toolResult(), text("Fertig, alles erledigt!")], true],
    ["Commit ohne DoD -> BLOCK", [user("sichern"), bash('git commit -m "x" -- a.md'), toolResult(), text("Committet.")], true],
    ["keine Arbeit -> frei", [user("was ist X?"), text("X ist Y.")], false],
    ["Arbeit, Umlaut-Form -> frei", [user("bau"), edit(), toolResult(), text("Done.\nGeprüft gegen: Lauf\nOffen: A")], false],
    ["git status ist keine Arbeit -> frei", [user("status?"), bash("git status"), toolResult(), text("Sauber.")], false],
  ];
  let fehler = 0;
  for (const [name, eintraege, sollBlock] of faelle) {
    const ist = pruefen(eintraege) !== null;
    const ok = ist === sollBlock;
    if (!ok) fehler++;
    console.log(`${ok ? "ok  " : "FEHL"} ${sollBlock ? "BLOCK" : "frei "} ${name}`);
  }
  console.log(`${faelle.length - fehler} von ${faelle.length} Faellen richtig.`);
  process.exit(fehler ? 1 : 0);
}

let eingabe = "";
process.stdin.on("data", (c) => (eingabe += c));
process.stdin.on("end", () => {
  let daten = {};
  try {
    daten = JSON.parse(eingabe || "{}");
  } catch {}
  // Einmal blocken genuegt: im Block-Zyklus (stop_hook_active) nicht erneut.
  if (daten.stop_hook_active) return process.exit(0);
  const pfad = msysPfad(daten.transcript_path);
  if (!pfad) return process.exit(0);
  let eintraege = [];
  try {
    eintraege = fs
      .readFileSync(pfad, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((z) => { try { return JSON.parse(z); } catch { return null; } })
      .filter(Boolean);
  } catch {
    return process.exit(0); // fail-open wie alle Waechter
  }
  const grund = pruefen(eintraege);
  if (grund) {
    process.stderr.write("dod-guard: " + grund + "\n");
    process.exit(2);
  }
  process.exit(0);
});
