---
description: Onboarding des frisch installierten Harness -- fuellt die [AUSFUELLEN]-Stellen der CLAUDE.md gemeinsam mit dem Menschen aus, einmalig
---
Dieser Befehl laeuft genau einmal: in der ersten Sitzung nach der Installation. Der
SessionStart-Hook `onboarding-start.js` schickt ihn von selbst, solange in `CLAUDE.md`
noch `[AUSFUELLEN]` steht. Der Mensch tippt nichts von sich aus -- du fragst, er antwortet,
du traegst ein.

1. Sag dem Menschen in EINEM Satz: der Harness ist installiert, jetzt werden die offenen
   Angaben in `CLAUDE.md` gemeinsam ausgefuellt. Kein Vorspann, keine Erklaerung des Harness.
2. `grep -n '\[AUSFUELLEN\]' CLAUDE.md` -- die offenen Stellen sind die Agenda. Frage sie
   nacheinander ab, EINE Frage pro Nachricht, und trag jede Antwort SOFORT ein:
   - Wozu dient dieser Workspace? (ein Satz)
   - Wer arbeitet daran, mit welchen Rollen?
   - Welche Sprache gilt hier? (Vorgabe: Deutsch -- nur bestaetigen lassen)
   - Wie heisst das Repo dieses Workspace? Gibt es Projekt-Repos unter `user-projects/`?
   - Was ist noch offen und muss entschieden werden?
   Will der Mensch etwas nicht beantworten: `[AUSFUELLEN]` stehen lassen. NIE raten, NIE
   Platzhalter mit Vermutungen fuellen. (Die spaeteren `[?]`-Platzhalter -- Projekt-Zeile,
   Abschnitt „Deine eigenen Regeln" -- sind KEINE Onboarding-Pflicht und bleiben unangetastet.)
3. **Werkzeug-Landschaft -- "Womit arbeitest du?"** Der Mensch nennt Programme und
   Dienste in freien Worten ("GitHub", "Vercel", "Photoshop"); fuer JEDE Nennung legst
   DU die Einordnung vor, er entscheidet. Vier Rubriken, ein Dienst darf in mehreren
   stehen (GitHub: CLI + API + Token). Abos sind kein Werkzeug, AUSSER sie bringen
   einen CLI-Login mit (ChatGPT-Abo -> Codex CLI, "Sign in with ChatGPT", kein API-Key).
   - **CLI zuerst, gesucht bis zum Beleg:** lokal (`Get-Command <name>` bzw.
     `command -v <name>`) -> Paketregister mit den vorhandenen Managern (`npm view` ·
     `pip index versions` · `brew info` · `cargo search`) -> GitHub-Releases und
     offizielle Installer (`gh search repos`, Herstellerseite). Mehrere Namenskandidaten
     probieren; Treffer auf Hersteller verifizieren (npm `gh` ist NICHT die GitHub-CLI).
     **Verifizierter Fund: Installation anbieten, auf Ja installieren** (`npm i -g` ·
     `pip install --user` · offizieller Installer) **und mit `<cli> --version` belegen.**
     **Installiert ist NICHT fertig** [Owner, 25.08.2026]: fertig ist ein Werkzeug erst,
     wenn der Zugang VERBUNDEN und GEMESSEN ist (Login/Token, per Status-Befehl wie
     `gh auth status` belegt) -- oder ein "bei Erstnutzung"-Beschluss mit Weg in
     `.secrets/AI-ZUGAENGE.md` dokumentiert steht. Interaktive Browser-Logins fuehrt
     der Mensch aus; du nennst den exakten Befehl und misst danach.
     Fehlender Paketmanager = "nicht pruefbar", nicht "nicht gefunden". Existiert
     NIRGENDS eine CLI: vormerken -- eine selbst zu erzeugen ist ein spaeterer,
     bewusster Schritt.
   - **MCP notieren, nie als Wahl vorlegen:** Registry `curl.exe -s
     "https://registry.modelcontextprotocol.io/v0/servers?search=<name>"` (PowerShell:
     `Invoke-RestMethod`) UND Hersteller-Doku/-Website pruefen -- in Apps gebuendelte
     offizielle MCPs stehen in keinem Registry (Beleg 26.08.2026: Spline V2 Desktop).
     Herkunft Hersteller/Community festhalten. Wo eine CLI belegt
     ist, entscheidet die Rangfolge CLI vor MCP vor Browser (`tools.md`) -- dem Menschen
     wird dazu KEINE Frage gestellt. Totes Register = Stoerung, nicht Nein.
   - **API:** hat der Dienst eine dokumentierte HTTP-API, eine Zeile mit dem Einstieg --
     kein Schluessel.
   - **Zugaenge: Namen ja, Werte nie.** Nur Variablen-NAMEN lesen (`Get-ChildItem Env: |
     Select-Object -ExpandProperty Name` bzw. `printenv | cut -d= -f1`); ein einmal
     committeter Schluessel bleibt fuer immer in der Historie. Die Zugangs-Uebersicht
     (Konten, Stores, Status -- nur Namen) lebt in `.secrets/AI-ZUGAENGE.md`
     (gitignoriert; anlegen, falls sie fehlt).
   - Ergebnis nach `docs/tool-landscape.md` (Vorlage liegt bereit), ergaenzt statt
     ueberschrieben -- nichts, was der Mensch nicht bestaetigt hat.
   - **Google (Gmail/Drive/Docs/Sheets/Kalender/Tasks/Kontakte/YouTube):** kein
     Einzel-Dienst suchen -- es gibt einen fertigen Weg, `docs/google-zugang.md`
     (Workspace-MCP + YouTube-CLI, ein OAuth-User-Token). Bei Bedarf dorthin verweisen.
4. Danach die Punkte, die nur der Mensch entscheiden kann -- je ein kurzer Absatz mit
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
   - **Eigene Regeln:** Abschnitt „Deine eigenen Regeln" der `CLAUDE.md` -- erst fuellen,
     wenn ein eigener Fall da ist. Jetzt nur ansagen.
5. Committen, mit pathspec: `git commit -m "harness: onboarding" -- CLAUDE.md docs/tool-landscape.md`
6. Abschluss in einem Satz: was eingetragen wurde, was als `[AUSFUELLEN]` offen blieb, welche
   Werkzeuge erkannt/vorgemerkt wurden, ob ein Remote fehlt. Dann `/repo-status`.

Bricht der Mensch ab, bleibt `[AUSFUELLEN]` stehen -- die naechste Sitzung startet den Befehl erneut.
