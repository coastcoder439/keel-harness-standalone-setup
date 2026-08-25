---
description: Onboarding des frisch installierten Harness -- fuellt die [AUSFUELLEN]-Stellen der CLAUDE.md gemeinsam mit dem Menschen aus, einmalig
---
Laeuft genau einmal: der SessionStart-Hook `onboarding-start.js` schickt diesen Befehl,
solange `CLAUDE.md` noch `[AUSFUELLEN]` enthaelt. Du fragst, der Mensch antwortet, du
traegst ein -- eine Frage pro Nachricht, nie raten, unbeantwortete Marken stehen lassen.

1. Ein Satz an den Menschen: der Harness ist installiert, jetzt werden die offenen
   Angaben in `CLAUDE.md` ausgefuellt. Kein Vorspann.
2. `grep -n '\[AUSFUELLEN\]' CLAUDE.md` ist die Agenda -- jede Antwort SOFORT eintragen.
   (Spaetere `[?]`-Platzhalter sind keine Onboarding-Pflicht und bleiben unangetastet.)
3. Werkzeug-Landschaft -- "Womit arbeitest du?": Fuer jede Nennung gilt CLI zuerst --
   findet die lokale Befehlssuche (`Get-Command`/`command -v`) nichts, im Register und
   Web weitersuchen (mehrere Namenskandidaten, offizielle Installer zaehlen), den Fund
   mit Zustimmung installieren und mit `<cli> --version` belegen; MCP/API erst, wo
   nachweislich keine CLI existiert. Zugaenge nur als NAMEN, nie Werte. Ergebnis nach
   `docs/tool-landscape.md` -- nichts, was der Mensch nicht bestaetigt hat.
4. Entscheidungen, die nur der Mensch trifft -- je ein kurzer Absatz, dann warten:
   fehlendes Remote (Sicherung; er legt es an, nicht du) · Schreibziele des Waechters
   (`danger-guard.js`, `erlaubteWurzeln()`) · `docs/08-sessions-rollen.md` nur bei
   parallel laufenden Sitzungen.
5. Committen, mit pathspec: `git commit -m "harness: onboarding" -- CLAUDE.md docs/tool-landscape.md`
6. Abschluss in einem Satz (eingetragen · offen · Werkzeuge installiert/nicht gefunden ·
   Remote ja/nein), dann `/repo-status`.

Bricht der Mensch ab, bleibt `[AUSFUELLEN]` stehen -- die naechste Sitzung startet erneut.
