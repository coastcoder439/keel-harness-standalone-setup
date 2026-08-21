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
   Abschnitt 6 -- sind KEINE Onboarding-Pflicht und bleiben unangetastet.)
3. **Werkzeug-Landschaft -- "Womit arbeitest du?"** Frage den Menschen, mit welchen
   Programmen und Diensten er arbeitet. Er nennt sie im Klartext, freie Worte
   ("GitHub", "Vercel", "Notion", "Photoshop"). Fuer JEDE Nennung ordnest DU ein, der
   Mensch entscheidet -- nie umgekehrt (der Agent legt vor, der Mensch waehlt):
   - **Vier Rubriken, jede EINZELN geprueft:** CLIs, MCPs, APIs, Zugaenge. Ein Dienst kann
     in MEHREREN stehen -- GitHub hat eine CLI (`gh`), eine API UND einen Token. Also nicht
     beim ersten Treffer aufhoeren: pro Dienst alle vier Fragen stellen und jede zutreffende
     Rubrik fuellen. (Modelle und Abos NICHT -- das Harness kennt sein Modell, Abos sind ein
     Produktthema.)
   - **CLI?** (a) lokal installiert: `command -v <name>` (Bash) bzw. `Get-Command <name>`
     (PowerShell) -- ein lokaler Fund ist BELEGT. (b) sonst offizielle CLI im Paketregister,
     aber NUR mit dem Paketmanager, der lokal da ist (vorher `command -v npm pip brew cargo`
     bzw. `Get-Command` -- `brew`/`cargo` fehlen unter Windows meist): `npm view <name> version`
     · `pip index versions <name>` · `brew info <name>` · `cargo search <name>`. Registertreffer
     = Kandidat, nicht Beleg (npm `gh` ist NICHT die GitHub-CLI). Fehlt der Paketmanager selbst,
     ist das "nicht pruefbar", NICHT "nicht gefunden".
   - **MCP?** offizielles Registry abfragen -- ueber das Bash-Werkzeug `curl.exe -s
     "https://registry.modelcontextprotocol.io/v0/servers?search=<name>"`, in PowerShell
     `Invoke-RestMethod "...?search=<name>"` (das blosse `curl` ist dort ein Alias und scheitert
     an `-s`). Herkunft festhalten (vom Hersteller oder Community; Community sichtbar markieren).
     Ein totes Register meldest du als Stoerung, nicht als Nein.
   - **API?** Hat der genannte Dienst eine dokumentierte HTTP-/REST-API? Dann eine Zeile in
     *APIs* -- die Methode/den Einstieg festhalten, keinen Schluessel.
   - **Zugang?** Existiert schon ein Schluessel als Umgebungsvariable? Nur den NAMEN lesen,
     nie den Wert: `printenv | cut -d= -f1 | grep -i <name>` (Bash) bzw.
     `Get-ChildItem Env: | Select-Object -ExpandProperty Name | Select-String <name>`
     (PowerShell). Jeder gefundene oder vom Menschen genannte Zugang: eine Zeile in *Zugaenge*.
   - **Rangfolge nur als Vorzug, nicht als Abbruch:** CLI vor offiziellem MCP vor Community-MCP
     vor Browser (`werkzeuge.md` -- dort die Begruendung) sagt, welchen Weg der Agent SPAETER
     bevorzugt nutzt. Sie sagt NICHT, wann man beim Erheben aufhoert -- erhoben wird jede Rubrik.
   - **"Nicht gefunden" ist ein ehrliches Ergebnis, kein Raten.** Fehlt fuer ein genanntes
     Programm ueberall ein Werkzeug: nur VORMERKEN, nicht bauen. Eine CLI selbst zu erzeugen
     ist ein spaeterer, bewusster Schritt -- nicht Teil des Onboardings.
   - **Zugaenge: Namen ja, Werte nein.** Trag nur den NAMEN eines Zugangs ein (etwa
     "ANTHROPIC_API_KEY in der Umgebung"), NIE den Wert. Schluessel bleiben im Schluesselbund
     oder in Umgebungsvariablen; ein einmal committeter Schluessel bleibt in der Historie,
     auch nach dem Loeschen der Zeile.
   - Trag das Ergebnis nach `docs/werkzeug-landschaft.md` ein (liegt als Vorlage bereit) --
     ergaenzt, nicht ueberschrieben. Nichts, was der Mensch nicht bestaetigt hat.
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
   - **Eigene Regeln:** Abschnitt 6 der `CLAUDE.md` -- erst fuellen, wenn ein eigener
     Fall da ist. Jetzt nur ansagen.
5. Committen, mit pathspec: `git commit -m "harness: onboarding" -- CLAUDE.md docs/werkzeug-landschaft.md`
6. Abschluss in einem Satz: was eingetragen wurde, was als `[AUSFUELLEN]` offen blieb, welche
   Werkzeuge erkannt/vorgemerkt wurden, ob ein Remote fehlt. Dann `/repo-status`.

Bricht der Mensch ab, bleibt `[AUSFUELLEN]` stehen -- die naechste Sitzung startet den Befehl erneut.
