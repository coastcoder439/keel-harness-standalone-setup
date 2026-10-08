#!/usr/bin/env node
// SessionStart-Hook: schlaegt das Onboarding vor -- solange das Installationsprofil noch offen ist, danach still.
// Der Mensch soll nach der Installation nichts tippen muessen und doch nie zu etwas gezwungen werden.
//
// Seit 07.10.2026 (Karte Arbeitsweise statt Paketpflicht; Owner: der Nutzer kam nicht durchs Onboarding, weil dafuer
// Arbeitspakete entstanden, die niemand abnehmen konnte) ist das ein VORSCHLAG im Kontext der Sitzung, kein gesetzter
// Befehl: frueher setzte dieser Hook "/onboarding" als erste Nutzer-Nachricht (initialUserMessage) und der Installer legte
// dafuer ein Paket an. Jetzt fragt die Sitzung den Menschen und schreibt nur das Profil docs/harness-instance.md; es gibt
// weder ein Paket noch einen Arbeitsagenten, und lehnt der Mensch ab, arbeitet die Sitzung an seiner Sache weiter.
//
// Woran "offen" gemessen wird: docs/harness-instance.md enthaelt noch die Pflicht-Marke "[AUSFUELLEN]". Sobald der Mensch
// jede Stelle bestaetigt hat, ist die Marke weg und der Hook schweigt fuer immer. Der bytegleiche Hostvertrag bleibt
// unveraendert; installationsspezifische Werte besitzen genau diese eine Projektdatei. Fehlt die Datei ganz, ist das keine
// Installation mit Profil-Vorlage: der Hook schweigt.
//
// Warum ein eigener Hook und nicht ein Abschnitt in CLAUDE.md: CLAUDE.md laedt in
// JEDER Sitzung und wird als Wahrheit ueber den Workspace gelesen. Eine einmalige
// Prozedur ("frage nacheinander ..., dann loesche mich") ist keine Wahrheit, sondern
// eine Rolle. Rollen gehoeren in Befehle; der Ausloeser gehoert in einen Hook.
// [Auftraggeber, 18.08.2026]
//
// NUR BEI "startup" -- aus demselben Grund wie in session-roles.js: SessionStart feuert
// auch bei resume, clear und compact. Ein Vorschlag, der mitten in ein laufendes
// Gespraech faellt, verdraengt die echte Frage des Menschen. Ein Arbeitsagent (KEEL_PACKAGE_SESSION) bekommt keinen
// Vorschlag: er hat keinen Menschen, den er fragen koennte.

const fs = require("fs");
const path = require("path");
const { isWorkerSession } = require("../harness-core/guards/hook-context.cjs");

const WURZEL = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..");
const INSTANZ = path.join(WURZEL, "docs", "harness-instance.md");
const MARKE = "[AUSFUELLEN]";

function anlass() {
  try {
    return JSON.parse(fs.readFileSync(0, "utf8")).source || "";
  } catch {
    return "";
  }
}

function profilOffen() {
  try {
    return fs.readFileSync(INSTANZ, "utf8").includes(MARKE);
  } catch {
    return false;
  }
}

// Der Vorschlag selbst. Er laeuft in jeder neuen Sitzung, solange das Profil offen ist, kostet also Kontext: kurz halten.
const VORSCHLAG =
  "Installationsprofil offen: docs/harness-instance.md enthaelt noch [AUSFUELLEN]-Pflichtstellen. Schlage dem Menschen " +
  "einmal vor, /onboarding auszufuehren (nur ein Vorschlag: er kann es ablehnen oder spaeter starten). Das Onboarding " +
  "braucht kein Paket und keinen Arbeitsagenten: die Sitzung fragt die offenen Werte einzeln ab und schreibt nur das " +
  "Profil docs/harness-instance.md. Will der Mensch erst etwas anderes, arbeite daran und erwaehne das Onboarding " +
  "in dieser Sitzung nicht noch einmal.";

if (anlass() !== "startup" || isWorkerSession(process.env) || !profilOffen()) process.exit(0);

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: VORSCHLAG,
    },
  })
);
