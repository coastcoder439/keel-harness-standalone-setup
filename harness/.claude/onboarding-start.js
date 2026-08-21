#!/usr/bin/env node
// SessionStart-Hook: startet das Onboarding von selbst -- genau so lange, wie es
// noch aussteht. Der Mensch soll nach der Installation nichts tippen muessen.
//
// Woran "aussteht" gemessen wird: CLAUDE.md enthaelt noch die Pflicht-Marke
// "[AUSFUELLEN]". Frueher war das "[?]" -- verworfen 20.08.2026: dasselbe "[?]" steht
// in der Vorlage AUCH in Erklaersaetzen und in dauerhaft offenen Platzhaltern
// (Projekt-Zeile, Abschnitt 6), die NICHT zum Onboarding gehoeren -- der Hook wurde
// damit nie still, obwohl alle Pflichtangaben standen. Eine eigene Marke nur fuer
// Pflicht-Onboarding-Felder trennt "jetzt auszufuellen" von "spaeter" und "erwaehnt".
// Weiter keine zweite Wahrheit: der Zustand kommt aus den Feldern selbst, nur praeziser.
//
// Warum ein eigener Hook und nicht ein Abschnitt in CLAUDE.md: CLAUDE.md laedt in
// JEDER Sitzung und wird als Wahrheit ueber den Workspace gelesen. Eine einmalige
// Prozedur ("frage nacheinander ..., dann loesche mich") ist keine Wahrheit, sondern
// eine Rolle. Rollen gehoeren in Befehle; der Ausloeser gehoert in einen Hook.
// [Auftraggeber, 18.08.2026]
//
// NUR BEI "startup" -- aus demselben Grund wie in session-roles.js: SessionStart feuert
// auch bei resume, clear und compact. Ein Slash-Befehl, der mitten in ein laufendes
// Gespraech faellt, verdraengt die echte Frage des Menschen. Der Onboarding-Befehl ist
// eine Nutzer-Anweisung und gilt fuer die ganze Sitzung, nicht pro Ereignis.

const fs = require("fs");
const path = require("path");

const WURZEL = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..");
const CLAUDE_MD = path.join(WURZEL, "CLAUDE.md");
const MARKE = "[AUSFUELLEN]";

function anlass() {
  try {
    return JSON.parse(fs.readFileSync(0, "utf8")).source || "";
  } catch {
    return "";
  }
}

function onboardingOffen() {
  try {
    return fs.readFileSync(CLAUDE_MD, "utf8").includes(MARKE);
  } catch {
    return false; // keine CLAUDE.md -> nichts auszufuellen -> Hook bleibt still
  }
}

if (anlass() !== "startup" || !onboardingOffen()) process.exit(0);

// initialUserMessage wird wie eine ECHTE Nutzer-Nachricht verarbeitet, Slash-Befehle
// eingeschlossen. Der Befehl selbst steht in .claude/commands/onboarding.md.
process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext:
        "Onboarding offen: CLAUDE.md enthaelt noch [AUSFUELLEN]-Pflichtstellen. Der Befehl /onboarding wurde " +
        "als erste Nachricht gesetzt -- ihn zuerst ausfuehren, bevor irgendetwas anderes.",
      initialUserMessage: "/onboarding",
    },
  })
);
