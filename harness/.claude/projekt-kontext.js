#!/usr/bin/env node
// SessionStart-Hook: Projekt-Kontext-Check.
//
// Weist die frische Sitzung an, ZUERST per AskUserQuestion zu klaeren, in welchem
// Projekt-Kontext sie laeuft -- bevor sie die erste Aufgabe angeht. Das Ergebnis
// bestimmt Repo-Ziel und Rolle der Sitzung.
//
// Herkunft: dieser Hook war im AIOS-Harness (Mac) verdrahtet und in
// docs/10-nachbau-anleitung.md (Abschnitt 6.1) dokumentiert, ist aber beim Umpacken
// in den Keel-Standalone-Bausatz NIE in vorlagen/settings.json gelandet -- die Doku
// beschrieb ihn, die installierte Vorlage hatte ihn nicht. Deshalb fragte jede frische
// Sitzung nichts. Wieder eingebaut 21.08.2026.
//
// Warum node statt des dokumentierten inline `echo '{...}'`: Das echo-Idiom ist
// bash-abhaengig; je nach Shell, die Windows fuer Hooks startet, zerlegt es die JSON
// nicht sauber. node liest/schreibt shell-unabhaengig -- wie die anderen Hooks hier.

const fs = require("fs");

// SessionStart feuert bei vier Anlaessen: startup · resume · clear · compact.
// Der Kontext-Check gehoert nur an den ANFANG (startup) und nach einem /clear --
// bei resume/compact laeuft die Sitzung schon, ihr Kontext ist geklaert; erneut zu
// fragen faellt mitten in die Arbeit.
function anlass() {
  try {
    return JSON.parse(fs.readFileSync(0, "utf8")).source || "";
  } catch {
    return "";
  }
}

const a = anlass();
if (a !== "startup" && a !== "clear") process.exit(0);

const text =
  "Projekt-Kontext-Check (Session-Start): Bevor du die erste Aufgabe angehst, klaere kurz " +
  "per AskUserQuestion den Projekt-Kontext dieser Session. Optionen: " +
  "a) NEUES Projekt -- eigener Ordner in user-projects/ plus eigenes privates GitHub-Repo, " +
  "Ordnername == Repo-Name (Reihenfolge: erst Repo anlegen und verifiziert pushen, DANN die " +
  ".gitignore-Zeile). " +
  "b) gehoert zu einem BESTEHENDEN user-projects-Ordner -- zu welchem. " +
  "c) reine Random-/Frage-/Recherche-Session -- kein Repo noetig. " +
  "d) Arbeit am Harness selbst -- das Workspace-Repo. " +
  "Macht die erste User-Nachricht den Kontext schon eindeutig, ueberspring den Dialog. " +
  "Laufen mehrere Sitzungen parallel, trag die geklaerte Rolle in docs/08-sessions-rollen.md ein.";

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: text },
  })
);
