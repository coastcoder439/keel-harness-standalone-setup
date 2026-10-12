---
description: Fuehrt das einmalige Onboarding aus: die Sitzung fragt den Menschen und schreibt das Installationsprofil selbst.
---

Dieser Befehl laeuft nur, solange `docs/harness-instance.md` noch `[AUSFUELLEN]` enthaelt. Er braucht kein Paket und
keinen Arbeitsagenten: **du** fragst den Menschen und schreibst **nur** das Profil `docs/harness-instance.md` und, falls
der Mensch dauerhafte Workspace-Regeln nennt, `.claude/rules/workbench/owner-rules.md` (Schritt 5). Der
Installer legt kein Onboarding-Paket an; ein `harness-onboarding`-Paket einer aelteren Installation ist stillgelegt
und wird nicht fortgesetzt.

1. Lies `docs/harness-instance.md`. Jede Zeile mit `[AUSFUELLEN]` ist eine offene Angabe.
2. Frage jede offene Angabe einzeln ab, eine Frage nach der anderen (AskUserQuestion oder eine einzelne Frage im Chat).
   Raten, Standardwerte und stilles Entfernen von Platzhaltern sind verboten; nimm nur, was der Mensch bestaetigt.
3. Schreibe jede bestaetigte Antwort sofort in ihre Zeile von `docs/harness-instance.md` und lasse alle anderen
   Zeilen unveraendert. Eine Antwort bleibt so auch dann erhalten, wenn der Mensch mittendrin abbricht.
4. Entscheidungen zu Remote, erlaubten Schreibzielen, Publish-Regel und Sitzungsrichtlinie trifft der Mensch:
   frage sie ausdruecklich ab und uebernimm nie einen Vorschlag als gegeben. Andere Dateien schreibst du hier nicht:
   weder `docs/tool-landscape.md` noch Einstellungen noch `docs/08-sessions-rollen.md`. Was an Werkzeugen oder
   Zugaengen auffaellt, nennst du am Ende als Vorschlag fuer spaetere Arbeit (nur Namen, nie Zugangswerte).
5. Frage zusaetzlich, ob dauerhafte Regeln fuer diesen Workspace gelten (wie hier gearbeitet werden soll). Der Installer
   hat dafuer `.claude/rules/workbench/owner-rules.md` angelegt; Claude Code laedt sie in jede Sitzung. Schreibe nur
   Regeln hinein, die der Mensch bestaetigt hat, jede mit Datum und seinem woertlichen Zitat; allgemeine Regeln gehoeren
   ins Setup, Projektregeln ins Projekt, nicht hierher. Nennt er keine, bleibt die Datei unveraendert.
6. Pruefe das Ergebnis mit `node checks/onboarding-ready.mjs --root . --mode profile`; erwartet ist `PROFILE READY`.
   Danach ist keine Marke mehr da, und der Sitzungsstart schlaegt das Onboarding nicht mehr vor.
7. Berichte, welche Werte und Regeln gesetzt sind und was offen bleibt. Publish bleibt ein eigener, vom Owner freizugebender
   `/save-work`-Schritt.

Bricht der Mensch ab, stehen die noch offenen `[AUSFUELLEN]`-Zeilen weiter in der Datei und die schon bestaetigten
Antworten sind gespeichert. Der naechste Sitzungsstart schlaegt das Onboarding wieder vor, bis keine Marke mehr da ist;
er erzwingt es nie.
