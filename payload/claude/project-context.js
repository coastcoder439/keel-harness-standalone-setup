#!/usr/bin/env node
// SessionStart-Hook: Projekt-Kontext-Check.
//
// Weist die frische Sitzung an, ZUERST per AskUserQuestion zu klaeren, in welchem
// Projekt-Kontext sie laeuft -- bevor sie die erste Aufgabe angeht. Das Ergebnis
// bestimmt Repo-Ziel und Rolle der Sitzung.
//
// Herkunft: dieser Hook war im AIOS-Harness (Mac) verdrahtet und in
// docs/rebuild-guide.md (Abschnitt 6.1) dokumentiert, ist aber beim Umpacken
// in den Keel-Standalone-Bausatz NIE in templates/settings.json gelandet -- die Doku
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

// Kurzfassung 24.08.2026: Injektion von ~700 auf ~440 Zeichen, Ueberspring-Klausel
// geschaerft — am 23.08. wurde der Check umgangen, weil "/skill + Begruessung" als
// eindeutiger Kontext gewertet wurde. Optionen-Details stehen in CLAUDE.md Abschnitt 2.
const text =
  "Projekt-Kontext-Check: Klaere als ALLERERSTE Handlung per AskUserQuestion, woran diese " +
  "Session arbeitet (neues Projekt / bestehender user-projects-Ordner / reine Recherche / " +
  "Harness selbst). Eine Begruessung, ein Skill-Aufruf oder eine allgemeine Frage sind KEIN " +
  "eindeutiger Kontext -- dann fragst du. Ueberspringen nur, wenn die erste Nachricht ein " +
  "Projekt woertlich benennt. Bei Parallel-Betrieb die Rolle in docs/08-sessions-rollen.md eintragen.";

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: text },
  })
);
