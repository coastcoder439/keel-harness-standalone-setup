#!/usr/bin/env node
// SessionStart-Hook: gibt jeder neuen Sitzung die Rollen-Tabelle aus
// docs/08-sessions-rollen.md mit -- damit Sitzungen voneinander wissen,
// ohne dass jemand einen Befehl tippt. Plus die Melde-Regel.
//
// Bewusst kurz gehalten: laeuft in JEDER Sitzung, kostet also dauerhaft Kontext.
// Nur Titel + Ebene + Kurzzweck, kein Fliesstext.

const fs = require("fs");
const path = require("path");

const WURZEL = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..");
const QUELLE = path.join(WURZEL, "docs", "08-sessions-rollen.md");
const MAX_ZWECK = 110; // Zeichen je Zweck-Spalte

// SessionStart feuert bei VIER Anlaessen: startup · resume · clear · compact.
// Bis zum 03.08.2026 las dieses Skript die Hook-Eingabe gar nicht und schickte
// darum bei JEDEM davon "/i-have-adhd" erneut in den Gespraechsverlauf -- also
// auch mitten in der Arbeit bei jedem Auto-Compact, ohne dass ein Mensch etwas
// getippt hatte. Bei zwei Anlaessen kurz hintereinander doppelt.
// [Anlass: der Befehl feuerte doppelt hintereinander, ohne Nutzereingabe.]
//
// Die Rollen-Tabelle bleibt bei ALLEN vier richtig -- nach einem Compact ist sie
// aus dem Fenster und wird gebraucht. Nur der Slash-Befehl darf sich nicht
// wiederholen: er ist eine Nutzer-Anweisung, und die gilt fuer die ganze Sitzung.
function anlass() {
  try {
    const roh = fs.readFileSync(0, "utf8");
    return JSON.parse(roh).source || "";
  } catch {
    return ""; // keine Eingabe lesbar -> unten als "nicht startup" behandelt
  }
}

function zeilen() {
  let text;
  try {
    text = fs.readFileSync(QUELLE, "utf8");
  } catch {
    return null; // Datei fehlt (z.B. frischer Nachbau) -> Hook bleibt still
  }
  const treffer = [];
  for (const z of text.split("\n")) {
    // Nur Datenzeilen der Rollen-Tabelle: | **Titel** | Ebene | Zweck | ... |
    if (!z.startsWith("|") || z.includes("---") || z.includes("Session (Titel)")) continue;
    const sp = z.split("|").map((s) => s.trim()).filter(Boolean);
    if (sp.length < 3) continue;
    const titel = sp[0].replace(/\*\*/g, "").replace(/\s*\(diese[^)]*\)/, "").trim();
    const ebene = sp[1].replace(/\*\*/g, "").trim();
    let zweck = sp[2].replace(/\*\*/g, "").replace(/`/g, "").trim();
    if (zweck.length > MAX_ZWECK) zweck = zweck.slice(0, MAX_ZWECK).replace(/\s\S*$/, "") + " …";
    if (titel && ebene) treffer.push(`- ${titel} [${ebene}]: ${zweck}`);
  }
  return treffer.length ? treffer : null;
}

const rollen = zeilen();
if (!rollen) process.exit(0);

const text = [
  "Sitzungs-Rollen dieses Workspace (aus docs/08-sessions-rollen.md, automatisch geladen).",
  "Es arbeiten mehrere Sitzungen parallel im selben Ordner:",
  ...rollen,
  "",
  "MELDE-REGEL: Aenderst oder findest du einen Fakt, auf dem eine ANDERE Rolle aufbaut",
  "(Pfad, Repo-/Branch-Name, Datenbank, ein Beschluss), dann schick ihn ihr per /tell-session,",
  "statt ihn nur zu notieren. Gehoert eine Aufgabe erkennbar einer anderen Rolle: dorthin",
  "uebergeben, nicht selbst machen. Ueberblick: /session-map",
].join("\n");

// initialUserMessage wird wie eine ECHTE Nutzer-Nachricht verarbeitet, Slash-Befehle
// eingeschlossen (offizielle Doku, Beispiel dort: "/read CLAUDE.md"). Damit laedt der
// Antwortform-Skill beim Sitzungsstart von selbst.
//
// NUR BEI "startup" -- und der Grund ist ein Schaden, kein Schoenheitsfehler
// [Auftraggeber, 03.08.2026, mit Bildbeleg]: Bis heute las dieses Skript die Hook-Eingabe nicht
// und feuerte bei ALLEN VIER Anlaessen. Bei "resume" und "compact" faellt der Slash-Befehl
// damit MITTEN IN EIN LAUFENDES GESPRAECH. Die Sitzung verarbeitet ihn als aktuelle
// Nutzer-Nachricht -- und beantwortet daraufhin die echte Frage des Menschen nicht mehr.
// Gemessen im Protokoll dieser Sitzung: sechs Einschuebe, zweimal unmittelbar
// hintereinander ohne jede Nutzer-Eingabe dazwischen (Positionen 1652/1653 und 1771/1772).
//
// Die Rollen-Tabelle bleibt bei allen vier Anlaessen richtig: nach einem Compact ist sie
// aus dem Fenster und wird gebraucht. Nur der Slash-Befehl darf sich nicht wiederholen --
// eine Nutzer-Anweisung gilt fuer die ganze Sitzung, nicht pro Ereignis.
//
// WARUM NICHT DEN SKILL-TEXT EINBLENDEN: der Aufruf kostet 14 Zeichen, der Volltext
// 6.848 -- und nur der Aufruf hat das Gewicht einer Nutzer-Anweisung.
const ausgabe = {
  hookEventName: "SessionStart",
  additionalContext: text,
};
if (anlass() === "startup") ausgabe.initialUserMessage = "/i-have-adhd";

process.stdout.write(JSON.stringify({ hookSpecificOutput: ausgabe }));
