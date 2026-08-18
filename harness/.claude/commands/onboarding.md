---
description: Onboarding des frisch installierten Harness -- fuellt die [?]-Stellen der CLAUDE.md gemeinsam mit dem Menschen aus, einmalig
---
Dieser Befehl laeuft genau einmal: in der ersten Sitzung nach der Installation. Der
SessionStart-Hook `onboarding-start.js` schickt ihn von selbst, solange in `CLAUDE.md`
noch `[?]` steht. Der Mensch tippt nichts von sich aus -- du fragst, er antwortet, du
traegst ein.

1. Sag dem Menschen in EINEM Satz: der Harness ist installiert, jetzt werden die offenen
   Angaben in `CLAUDE.md` gemeinsam ausgefuellt. Kein Vorspann, keine Erklaerung des Harness.
2. `grep -n '\[?\]' CLAUDE.md` -- die offenen Stellen sind die Agenda. Frage sie
   nacheinander ab, EINE Frage pro Nachricht, und trag jede Antwort SOFORT ein:
   - Wozu dient dieser Workspace? (ein Satz)
   - Wer arbeitet daran, mit welchen Rollen?
   - Welche Sprache gilt hier? (Vorgabe: Deutsch -- nur bestaetigen lassen)
   - Wie heisst das Repo dieses Workspace? Gibt es Projekt-Repos unter `user-projects/`?
   - Was ist noch offen und muss entschieden werden?
   Will der Mensch etwas nicht beantworten: `[?]` stehen lassen. NIE raten, NIE
   Platzhalter mit Vermutungen fuellen.
3. Danach die Punkte, die nur der Mensch entscheiden kann -- je ein kurzer Absatz mit
   Handlung und Wirkung, dann seine Entscheidung abwarten, nichts selbst annehmen:
   - **Sicherung:** `git -C . remote -v` -- kein Remote? Dann ist Remote anlegen und pushen
     SEINE Handlung (`gh auth login`, Repo unter seinem Konto). Bis dahin liegt alles nur
     auf einer Platte. Du legst kein Remote an.
   - **Schreibziele des Waechters:** `.claude/danger-guard.js`, Funktion `erlaubteWurzeln()`
     -- schreibt er regelmaessig ausserhalb dieses Ordners, gehoert der Pfad dort hinein.
   - **`settings.json` versionieren:** Vorgabe ja (nur `$CLAUDE_PROJECT_DIR`, kein
     Rechnerpfad). Nur erwaehnen, wenn er absolute Pfade eintragen will.
   - **Sitzungs-Rollen:** `docs/08-sessions-rollen.md` NUR anlegen, wenn mehrere
     Sitzungen parallel laufen -- jede Zeile kostet in jeder Sitzung Kontext.
   - **Eigene Regeln:** Abschnitt 6 der `CLAUDE.md` -- erst fuellen, wenn ein eigener
     Fall da ist. Jetzt nur ansagen.
4. Committen, mit pathspec: `git commit -m "harness: onboarding" -- CLAUDE.md`
5. Abschluss in einem Satz: was eingetragen wurde, was als `[?]` offen blieb, ob ein Remote
   fehlt. Dann `/repo-status`.

Bricht der Mensch ab, bleibt `[?]` stehen -- die naechste Sitzung startet den Befehl erneut.
