# Zuschnitt der Wächter

Owner-Auftrag des Pakets guard-scope: „Zuerst lege ich dort einen gemeinsamen Zuschnitt fest: was die Wächter sperren sollen, nämlich deine Regeln und echte Gefahr, und was Claude und Codex selbst regeln.“

Diese Datei legt für jeden Wächter fest, was er sperrt und warum. Jede Sperre nennt entweder eine
Owner-Regel (wörtlich, mit Quelle) oder eine Gefahrklasse aus dem nächsten Abschnitt, dazu den
erlaubten Weg des Agenten oder die Owner-Handlung, die allein der Owner ausführt. Wie die Wächter
in Claude Code und Codex verdrahtet sind (Hook-Ereignis, Matcher, Werkzeugnamen), steht in
docs/guard-abdeckung.md und wird hier nicht wiederholt.

Die Code-Spalte nennt jeden Sperrcode genau so, wie er im Quelltext des Wächters steht;
test/guard-single-source.test.js liest die Codes aus dem Quelltext und verlangt für jeden eine
Zeile in seinem Abschnitt. Als „geplant“ markierte Codes entstehen mit Harness 1.3.16.

## Gefahrklassen

- **G1 Schreiben ohne Paket-/OWNS-Prüfung:** eine Datei entsteht, ändert sich oder verschwindet,
  ohne dass Paketbindung und OWNS des gebundenen Leaf geprüft wurden.
- **G2 Ausführung nicht statisch entscheidbaren Codes:** ein Aufruf startet Code, dessen Wirkung
  der Wächter vor der Ausführung nicht beurteilen kann (Interpreter, nicht deklarierte Skripte und
  Programme, dynamische Auswertung).
- **G3 Zerstörung/Datenverlust:** Löschen, Formatieren oder Überschreiben, das nicht rückholbar ist
  oder außerhalb des Arbeitsbereichs wirkt.
- **G4 Umgehung der Wächter:** Shell-Hüllen, dynamische Auswertung, Umgebungs-Überschreibung,
  unbewachte Shell- oder Codex-Wege und ungültige Regeldateien.
- **G5 Zugangsdaten im Klartext:** ein Schlüssel, Token oder Passwort landet in einer Datei, einem
  Commit oder einem Befehl im Chat.
- **G6 Wirkung in fremden Diensten:** ein Werkzeug schreibt in einen Dienst außerhalb des
  Repositorys (Konten, Karten, Dokumente, Nachrichten).
- **G7 Selbständerung des Harness:** ein Agent ändert die Harness-Dateien oder Regeldateien, die
  ihn selbst bewachen.
- **G8 Nicht rückholbare Git-Historie:** Historie wird umgeschrieben oder Objekte werden endgültig
  gelöscht.

## .claude/git-intent-guard.js

Die Codes sind die Absichten (Intents), die der Wächter einem rohen Git-Befehl zuordnet. Lesende
Git-Befehle sind frei, auch in einem Paket; nur erhöhte Lesebefehle gehen auf inspect.

| Code | Sperrt | Grund | Weg |
|---|---|---|---|
| inspect | (nach E15 nur noch) Git-Lesebefehle mit -c, --config-env, --exec-path, --output, --ext-diff, --textconv, --upload-pack oder --exec | Gefahr G2: diese Schalter führen eigenen Code aus oder schreiben Dateien | Intent inspect von harness-core/git/git-intent.mjs |
| checkpoint | git add und git commit | Owner-Regel: „Rohe mutierende Git-Befehle sind gesperrt.“ (CLAUDE.md) | Intent checkpoint von harness-core/git/git-intent.mjs |
| unstage | git restore --staged und git reset ohne --hard, --keep, --merge oder --soft | Owner-Regel: „Rohe mutierende Git-Befehle sind gesperrt.“ (CLAUDE.md) | Intent unstage von harness-core/git/git-intent.mjs |
| discard-working | git restore auf den Arbeitsbaum, git clean und git checkout -- | Owner-Regel: „Rohe mutierende Git-Befehle sind gesperrt.“ (CLAUDE.md) | Intent discard-working von harness-core/git/git-intent.mjs mit Recovery-Receipt |
| revert-checkpoint | git revert | Owner-Regel: „Rohe mutierende Git-Befehle sind gesperrt.“ (CLAUDE.md) | Intent revert-checkpoint von harness-core/git/git-intent.mjs |
| integration-checkpoint | git merge, git rebase und git cherry-pick | Owner-Regel: „Rohe mutierende Git-Befehle sind gesperrt.“ (CLAUDE.md) | Intent integration-checkpoint von harness-core/git/git-intent.mjs |
| plan-publish | git push | Owner-Regel: „Rohe mutierende Git-Befehle sind gesperrt.“ (CLAUDE.md) | Intent plan-publish von harness-core/git/git-intent.mjs, Veröffentlichen nur nach Owner-Handlung O5 |
| explain | jeder übrige schreibende Git-Befehl, darunter breite Historienumschreibung und nicht rückholbares Löschen | Owner-Regel: „Breite Historienumschreibungen und nicht recoverable Löschungen bleiben Owner-Entscheidungen.“ (CLAUDE.md) | Owner-Handlung O2 |

## .claude/shell-mutation-guard.js

Der Wächter ist eine endliche Freigabeliste für Bash und PowerShell. Zusammenführen und Verwerfen
von Ausgabeströmen, Versionsabfragen und Schleifen über Lesebefehle sind frei (siehe „Was Claude
und Codex selbst regeln“).

| Code | Sperrt | Grund | Weg |
|---|---|---|---|
| ENVIRONMENT_OVERRIDE | Umgebungs-Überschreibung vor einem Befehl (X=… befehl, $env:X = …) | Gefahr G4: eine Variable kann Regelwurzel, Paketsitzung oder Testmodus der Wächter verstellen | Befehl ohne Überschreibung ausführen |
| DYNAMIC_WRAPPER | Hüllen, die einen zweiten Befehl starten (etwa env oder xargs), und Befehle, deren Name erst zur Laufzeit entsteht | Gefahr G4: der eigentliche Befehl entgeht der Prüfung | den Befehl direkt ausführen |
| SHELL_WRAPPER | Shell-Hüllen und Shell-Skripte wie bash -c, sh -c, powershell -Command oder -File, pwsh -c, cmd /c | Gefahr G4: die Nutzlast entgeht der Prüfung. bash -c mit genau einer statischen Nutzlast wird im PowerShell-Dialekt nach seiner Nutzlast beurteilt, weil Codex unter Windows Bash so aufruft | den Befehl direkt im Bash- oder PowerShell-Werkzeug ausführen |
| UNCLASSIFIED_GIT | Git-Aufrufe, die keiner Absicht zugeordnet werden können | Gefahr G4: ein Git-Weg an git-intent-guard vorbei | harness-core/git/git-intent.mjs |
| INTERPRETER_EXECUTION | Start eines anderen Interpreters (python, ruby, perl und andere) mit Code oder Skript | Gefahr G2: der Inhalt des Skripts ist nicht geprüft | deklarierte Prüfer, Tests und Werkzeuge |
| INLINE_INTERPRETER | node mit Code auf der Kommandozeile (-e, -p, --eval, --print) | Gefahr G2: der Code ist nicht statisch prüfbar | Code in einer Datei im OWNS und als deklarierter Test ausführen |
| NODE_PRELOAD | node mit --require, --import, --loader oder NODE_OPTIONS | Gefahr G2: vorab geladener Code läuft vor jedem Skript | node ohne Vorabladen |
| NODE_CHECK_FORM | node --check mit weiteren Schaltern oder mehreren Dateien | Gefahr G2: die Prüfform wird zur Ausführung | node --check mit genau einer Datei |
| UNDECLARED_TEST | node --test auf eine nicht deklarierte Testdatei | Gefahr G2: der Testcode ist nicht freigegeben | deklarierte Testdateien und die Tests der Produkt-Wurzel |
| NODE_SCRIPT_REQUIRED | node ohne Skriptdatei (REPL, Standardeingabe) | Gefahr G2: der Code kommt nicht aus einer Datei | node mit einem deklarierten Skript |
| SERVICE_ARGUMENTS | Start des Dashboard-Dienstes mit anderen Argumenten als --port <n> und den Sprach-Schaltern | Gefahr G2: Argumente ändern, was der Dienst ausführt | den Dienst mit den vorgesehenen Argumenten starten |
| UNDECLARED_NODE_SCRIPT | node auf ein nicht deklariertes Repository-Skript | Gefahr G2: das Skript kann schreiben, ohne geprüft zu sein | deklarierte Prüfer und Werkzeuge, lesende package-cli-Unterbefehle |
| UNDECLARED_EXECUTABLE | Programme außerhalb der Lese-, Prüfer- und Schreibliste | Gefahr G2: die Wirkung des Programms ist unbekannt | ein Befehl aus der Freigabeliste |
| DYNAMIC_EVALUATION | Befehlsersetzung ($(...), Backticks) und .NET-Aufrufe außerhalb der Lese-Helfer | Gefahr G2: der ausgeführte Befehl entsteht erst zur Laufzeit | den Befehl ausgeschrieben angeben |
| POWERSHELL_PARSE | PowerShell-Befehle, die PowerShells Parser nicht fehlerfrei zerlegt | Gefahr G2: ein nicht zerlegter Befehl ist nicht beurteilbar | den Befehl syntaktisch korrekt schreiben |
| DIRECT_SHELL_WRITE | Schreibbefehle der Shell (cp, tee, sed -i, Set-Content, Copy-Item und andere) | Gefahr G1: die Shell schreibt an der OWNS-Prüfung vorbei | Datei-Werkzeuge Write und Edit; rm, mkdir und mv im gebundenen OWNS |
| READ_COMMAND_ESCALATION | Lesebefehle mit schreibenden oder ausführenden Schaltern (find -delete, sort -o und ähnliche) | Gefahr G1: ein Lesebefehl schreibt | den Lesebefehl ohne diese Schalter |
| OUTPUT_REDIRECTION | Umleitung von Ausgabe in eine Datei (>, >>, 2> auf einen Pfad, *>, Out-File über >) | Gefahr G1: Umleitung in Dateien schreibt an der OWNS-Prüfung vorbei; Zusammenführen (2>&1) ist frei; Verwerfen ist im Bash-Dialekt nach /dev/null frei, im PowerShell-Dialekt nur nach $null, weil Windows PowerShell 2>/dev/null in eine Datei \dev\null schreibt | Datei-Werkzeug Write |
| PACKAGE_SCRIPT_RUNNER | npm, pnpm, yarn und npx als Skriptstarter | Owner-Regel: „npm-Skripte sind fuer Agenten gesperrt“ (CLAUDE.md) | node mit dem deklarierten Skript direkt |
| POLICY_INVALID | jeden Befehl, solange .claude/mutation-policy.json ungültig ist | Gefahr G4: ohne gültige Politik ist keine Freigabe entscheidbar | Owner-Handlung O3 |
| PACKAGE_TOOL_UNBOUND | (geplant) schreibende Aufrufe von package-standard.mjs für ein anderes als das gebundene Bündel | Gefahr G1: schreibende Aufrufe von package-standard.mjs nur für das gebundene Bündel | create mit --session gleich der eigenen Sitzung öffnet die Bindung selbst; mit bestehender Bindung müssen --root und --package zu ihr passen |
| PACKAGE_TOOL_OVERRIDE | (geplant) package-standard.mjs mit --unlazy | Gefahr G2: --unlazy wählt nicht deklarierten Code | Aufruf ohne --unlazy |
| FOREIGN_PROCESS | Stop-Process -Id und taskkill /PID auf einen Prozess, dessen Befehlszeile keinen Pfad der Installations- oder einer Produkt-Wurzel enthält, oder der nicht läuft | Gefahr G3: das Beenden eines fremden Prozesses wirkt außerhalb des Arbeitsbereichs | nur Prozesse beenden, die Dateien dieser Installation oder ihrer Produkt-Wurzeln ausführen; jeden anderen Prozess unter Offen melden |
| INSTALLER_ARGUMENTS | der Installer des Setup-Repos mit anderem Unterbefehl als install, status oder doctor, anderen Schaltern als --target, --upgrade und --json, oder mit einem --target, das nicht die Installationswurzel ist | Gefahr G3: der Installer würde eine fremde Installation überschreiben | node <Setup-Repo>/install.mjs install, status oder doctor mit --target gleich der Installationswurzel |

Im Produktbaum erlaubte Arbeit (Paket harness-gaps-2026-10-04, Anforderung R1). Unter einer
Owner-Produkt-Wurzel (productRoots) und für Agenten wie Orchestrator gelten zusätzlich:

- **Entscheidung 1, Werkzeuge der Produkt-Wurzel:** `node <Wurzel>/dashboard/node_modules/next/dist/bin/next build|dev|start`
  (nur mit --port und --hostname, kein Projektverzeichnis), `node <Wurzel>/dashboard/node_modules/typescript/bin/tsc`
  mit beliebigen Argumenten (auch -p), `node <Wurzel>/dashboard/scripts/test.mjs` ohne Argumente, `node --test` mit
  Dateien direkt in `<Wurzel>/dashboard/.test-build/test/` und `<Wurzel>/test/`, sowie `node <Wurzel>/../vendor/unlazy/tests/*.mjs`
  und `node --test` mit Dateien direkt in `<Wurzel>/../vendor/unlazy/tests/`, wenn `<Wurzel>/../vendor/unlazy` existiert.
  Dieselben Werkzeuge in einem fremden Baum bleiben UNDECLARED_NODE_SCRIPT bzw. UNDECLARED_TEST.
- **Entscheidung 2, Arbeitsverzeichnis:** ein `Set-Location <Pfad>` oder `cd <Pfad>` als erster Befehl derselben Zeile
  mit wörtlichem Pfad auf ein vorhandenes Verzeichnis bestimmt, wogegen die folgenden Befehle relative Pfade auflösen;
  berechnete, gesuchte oder fehlende Pfade und ein späteres cd ändern nichts.
- **Entscheidung 3, lesende Abfragen:** immer erlaubt sind `Get-Process`, `Get-NetTCPConnection`, `Get-CimInstance` und
  `Get-WmiObject` nur für Win32_Process und Win32_OperatingSystem (Schalter -ClassName, -Class, -Filter, -Property,
  -ErrorAction), `Get-Date` samt Methodenaufrufen auf dem Ergebnis (`(Get-Date).AddMinutes(28)`), `Test-Path`, `Get-Item`
  und `Get-ChildItem`; jede andere Klasse und jeder andere .NET-Aufruf bleibt gesperrt.
- **Entscheidung 4, eigene Prozesse:** `Stop-Process -Id <Zahl>` (auch mit -Force) und `taskkill /PID <Zahl> [/T] [/F]`
  (in Git Bash auch `//PID`) beenden einen Prozess, dessen über Win32_Process gelesene Befehlszeile einen Pfad innerhalb
  der Installationswurzel oder einer Produkt-Wurzel enthält; sonst FOREIGN_PROCESS. Name-basiertes Beenden
  (Stop-Process -Name, taskkill /IM) bleibt UNDECLARED_EXECUTABLE.
- **Entscheidung 5, Installer:** `node <Verzeichnis>/install.mjs install|status|doctor --target <Installationswurzel> [--upgrade] [--json]`,
  wenn `<Verzeichnis>/manifest.json` und `<Verzeichnis>/lib/distribution-lifecycle.mjs` existieren; ein anderes --target
  ist INSTALLER_ARGUMENTS. Der Wächter nennt keinen Workspace-, Projekt- oder Nutzernamen.
- **Entscheidung 6, unverändert gesperrt:** rohes Git schreibend (git-intent-guard), Shell-Umleitungen, `node -e`,
  Inline-Interpreter, Löschen außerhalb des OWNS, npm und Netzwerk-Cmdlets wie Invoke-WebRequest.

## .claude/danger-guard.js

Die Codes sind die Namen der REGELN im Quelltext. Der Wächter prüft Bash und PowerShell; Git gehört
allein git-intent-guard.

| Code | Sperrt | Grund | Weg |
|---|---|---|---|
| rm mit Wucht auf Heimat oder Wurzel | rm -rf auf das Benutzerverzeichnis oder die Laufwerkswurzel | Gefahr G3: nicht rückholbarer Verlust ganzer Datenbestände | Owner-Handlung O1 |
| rm -rf auf die Werkbank-Wurzel | rekursives Löschen der Arbeitswurzel | Gefahr G3: der gesamte Arbeitsbereich geht verloren | Owner-Handlung O1 |
| Schreiben oder Loeschen ausserhalb des Arbeitsbereichs | Schreib- und Löschbefehle auf Ziele außerhalb des Arbeitsbereichs | Gefahr G3: Wirkung außerhalb des Arbeitsbereichs | Owner-Handlung O1 |
| rm -r auf einen Systempfad | rekursives Löschen in Systemordnern | Gefahr G3: das Betriebssystem wird beschädigt | Owner-Handlung O1 |
| Geraete-Schreibzugriff / Dateisystem formatieren | dd auf Geräte, mkfs, format und ähnliche | Gefahr G3: ein Datenträger wird überschrieben | Owner-Handlung O1 |
| Rechte flaechendeckend aufreissen | chmod -R 777, icacls mit Vollzugriff für alle und ähnliche | Gefahr G3: Schutz der Dateien wird flächig aufgehoben | Owner-Handlung O1 |
| Loeschen mit Systemrechten | sudo rm, Löschen mit erhöhten Rechten | Gefahr G3: Löschen ohne Schutz durch Dateirechte | Owner-Handlung O1 |
| Destruktives im Interpreter-Umweg (-c/-e) | zerstörende Befehle in einer Interpreter-Nutzlast (python -c, node -e und ähnliche) | Gefahr G3: Zerstörung über einen Umweg an den übrigen Regeln vorbei | Owner-Handlung O1 |

## .claude/write-guard.js

| Code | Sperrt | Grund | Weg |
|---|---|---|---|
| W1 | Schreibziele außerhalb der erlaubten Schreibwurzeln | Gefahr G3: Wirkung außerhalb des Arbeitsbereichs | Owner-Handlung O1 |
| W2 | Inhalte mit einem Zugangs-Muster (Schlüssel- oder Token-Format) | Owner-Regel: „Zugangsdaten, lokale Freigaben und settings.local.json werden nie versioniert oder ausgeliefert.“ (CLAUDE.md) | Owner-Handlung O4 |
| W3 | eine .gitignore-Zeile, die ein noch nicht gesichertes Projekt-Repo unsichtbar machen würde | Owner-Regel: „erst eigenes Repo anlegen und verifiziert pushen, DANN die Ignorier-Zeile in die .gitignore“ (Werkbank-Regeldatei owner-rules.md) | erst das Projekt-Repo anlegen und verifiziert sichern, danach die Ignorier-Zeile schreiben |
| W4 | Änderungen an der Owner-Politikdatei .claude/mutation-policy.json | Gefahr G7: die Politik legt fest, was die Wächter freigeben | Owner-Handlung O3 |
| W5 | Änderungen an vom Installer verwalteten Harness-Dateien einer Installation | Gefahr G7: der Harness bewacht sich selbst; Owner-Auftrag des Pakets guard-scope R10 | Änderung im Produkt-Quellbaum, Release, und nach Owner-Handlung O6 löst der Agent das Harness-Update aus |

## .claude/paket-gate.js

Die Codes stammen aus dem Wächter und aus den Modulen der Paketbindung, des Paket-Starts und der
geplanten Paketänderung, deren Entscheidung der Wächter weiterreicht.

| Code | Sperrt | Grund | Weg |
|---|---|---|---|
| MISSING_SESSION | Schreiben ohne erkennbare Paketsitzung | Gefahr G1: ohne Sitzung ist keine Bindung prüfbar | Arbeit über den Package-Executor mit gebundener Sitzung |
| MISSING_OR_STALE_BINDING | Schreiben ohne gültige Paketbindung der Sitzung | Gefahr G1: ohne gültige Bindung gilt kein OWNS | Bindung über den Package-Executor (next, start, dispatch) neu setzen |
| OUTSIDE_REPOSITORY | Schreibziele außerhalb des gebundenen Repositorys | Gefahr G1: das Ziel gehört nicht zum gebundenen Paket | nur im gebundenen Repository schreiben |
| OUTSIDE_LEAF_OWNS | Schreibziele außerhalb des OWNS des gebundenen Leaf | Owner-Regel: „Nur gebundene Sessions schreiben in ihr Leaf-OWNS.“ (.claude/rules/keel/working-method.md) | nur im eigenen Leaf-OWNS schreiben; andere Pfade gehören ihrem Leaf |
| BOOTSTRAP_ENDED | Schreiben über eine Paket-Start-Bindung, nachdem das Paket angelegt ist | Gefahr G1: die Start-Bindung gilt nur bis zum Anlegen | Leaf-Bindung über den Package-Executor |
| OUTSIDE_BOOTSTRAP_PACKAGE | Schreiben außerhalb des Bündels, das gerade angelegt wird | Gefahr G1: der Paket-Start darf nur sein eigenes Bündel schreiben | nur im eigenen Bündel docs/packages/<packageId>/ schreiben |
| BOOTSTRAP_FILE | Dateien im Bündel, die der Paket-Start nicht anlegen darf | Gefahr G1: nur die Dateien des Paket-Schemas entstehen beim Start | nur die Bündel-Dateien des Paket-Schemas anlegen |
| BOOTSTRAP_LINK | Ziele über symbolische Links oder Verbindungspunkte beim Paket-Start | Gefahr G4: ein Link führt aus dem Bündel heraus | Ziele ohne Link schreiben |
| AMEND_OWNER_IMMUTABLE | (geplant) Änderungen am Originalauftrag in OWNER.md bei einer Paketänderung | Owner-Regel: „OWNER.md hält den unveränderlichen Originalauftrag“ (CLAUDE.md) | neue Anforderung als weitere R-Zeile anhängen, nie den Originalauftrag ändern |
| OUTSIDE_AMEND_PACKAGE | (geplant) Schreiben außerhalb des geänderten Bündels | Gefahr G1: die Paketänderung gilt nur für ihr Bündel | nur im geänderten Bündel schreiben |
| AMEND_LINK | (geplant) Ziele über Links bei einer Paketänderung | Gefahr G4: ein Link führt aus dem Bündel heraus | Ziele ohne Link schreiben |
| AMEND_STALE | (geplant) Schreiben mit einer veralteten Änderungsbindung | Gefahr G1: der Stand des Bündels hat sich seit der Bindung geändert | die Änderung neu binden |

## .claude/mcp-write-guard.js

| Code | Sperrt | Grund | Weg |
|---|---|---|---|
| POLICY_INVALID | schreibende MCP-Werkzeuge, solange .claude/mutation-policy.json ungültig ist | Gefahr G4: ohne gültige Politik ist keine Freigabe entscheidbar | Owner-Handlung O3 |
| MCP_WRITE_UNDECLARED | schreibende MCP-Werkzeuge, die nicht in der MCP-Allowlist stehen | Gefahr G6: das Werkzeug wirkt in einem fremden Dienst | Owner-Handlung O3 |
| MCP_SHELL_SURFACE | (geplant) run_in_terminal und andere Shell-Oberflächen über MCP | Gefahr G4: ein Shell-Weg ohne Shell-Wächter | Bash- oder PowerShell-Werkzeug |
| SELF_MOVE | (geplant) jede Selbstverschiebung der Sitzung (anderer Ordner, Worktree, Cloud) | Owner-Regel: „nie die eigene Sitzung verschieben“ (Owner-Auftrag des Pakets orchestrator-rules-enforcement) | in der eigenen Sitzung im Arbeitsordner bleiben; Arbeit an einem anderen Ort über einen eigenen Arbeitsauftrag |

## .claude/sessionpost-guard.js

| Code | Sperrt | Grund | Weg |
|---|---|---|---|
| Senden abgestellt | Nachrichten einer Sitzung direkt an eine andere Sitzung | Owner-Regel: „Senden ist ABGESTELLT“ (Owner-Entscheid 27.08.2026) | Notiz per /tell-session |

## .claude/dod-guard.js

| Code | Sperrt | Grund | Weg |
|---|---|---|---|
| Abschlussformat | Arbeitsmeldungen ohne Abschlusszeilen | Owner-Regel: „Eine Arbeitsmeldung endet mit Geprueft gegen: und Offen:“ (CLAUDE.md, Owner 24.08.2026) | die Meldung mit „Geprueft gegen:“ und „Offen:“ beenden |

## .codex/apply-patch-guard.cjs

| Code | Sperrt | Grund | Weg |
|---|---|---|---|
| NOT_APPLY_PATCH | Aufrufe, die kein apply_patch sind, über den Patch-Weg | Gefahr G1: nur ein zerlegter Patch ist auf seine Ziele prüfbar | apply_patch im gültigen Format |
| INVALID_PATCH | Patches, die sich nicht eindeutig zerlegen lassen | Gefahr G1: ohne Zerlegung sind die Ziele unbekannt | einen gültigen Patch senden |
| PACKAGE_OWNS | Patch-Ziele, die paket-gate ablehnt (weitergereichte paket-gate-Entscheidung) | Gefahr G1: Schreiben außerhalb von Paketbindung und Leaf-OWNS | nur im eigenen Leaf-OWNS schreiben |
| WRITE_POLICY | Patch-Ziele oder Inhalte, die eine W-Regel des write-guard sperrt | Gefahr G1: es gilt der Grund der jeweiligen W-Regel (W1 bis W5) im Abschnitt .claude/write-guard.js | der Weg der jeweiligen W-Regel |

## Was Claude und Codex selbst regeln

Diese Handlungen sperrt kein Wächter; Claude und Codex entscheiden sie selbst:

- lesende Untersuchung samt Git-Lesebefehlen (git status, log, diff, show, auch mit -C), innerhalb
  und außerhalb von Paketen;
- Versionsabfragen wie --version;
- Zusammenführen von Ausgabeströmen (2>&1) und Verwerfen: im Bash-Dialekt nach /dev/null, im
  PowerShell-Dialekt nur nach $null, weil Windows PowerShell 2>/dev/null in eine Datei \dev\null
  schreibt;
- Schleifen und Bedingungen über lesende Befehle;
- die lesenden package-cli-Unterbefehle doctor, status, lint, list und measure;
- die Paketwerkzeuge package-executor.mjs, package-bootstrap.mjs, package-amend.mjs,
  package-resolve.mjs, git-intent.mjs und package-standard.mjs: Lesen immer, Schreiben nur für das
  gebundene Bündel;
- rm, mkdir und mv auf wörtliche Pfade im OWNS des gebundenen Leaf;
- App-Werkzeuge: Browser-Bereich mit der Freigabe je Website durch die App, Terminal-Ansicht nur in
  Tabs, die der Agent selbst geöffnet hat, Rückkehr in den Arbeitsordner;
- den eigenen Schutz von Claude Code für Remove-Item und kritische Pfade (B19);
- die Codex-Sandbox workspace-write (E12).

## Handlungen, die allein der Owner darf

| Nr | Handlung | Waechter und Code | Quelle | Vorlage |
|---|---|---|---|---|
| O1 | Zerstörung und Schreiben außerhalb des Arbeitsbereichs | `danger-guard.js:*` `write-guard.js:W1` | Owner-Regel (Kopf von danger-guard.js): „Wer den Befehl wirklich braucht, fuehrt ihn von Hand aus“ | Befehl |
| O2 | breite Historienumschreibung und nicht rückholbares Löschen (reset --hard/--keep/--merge/--soft, filter-branch, filter-repo, reflog, gc, prune, update-ref, replace, branch -D/-d, tag -d, stash drop/clear) | `git-intent-guard.js:HISTORY` | Owner-Regel (CLAUDE.md): „Breite Historienumschreibungen und nicht recoverable Löschungen bleiben Owner-Entscheidungen.“ | Befehl |
| O3 | Änderungen an .claude/mutation-policy.json samt MCP-Allowlist und productRoots | `write-guard.js:W4` `mcp-write-guard.js:MCP_WRITE_UNDECLARED` `mcp-write-guard.js:POLICY_INVALID` `shell-mutation-guard.js:POLICY_INVALID` | Owner-Regel (CLAUDE.md): „Owner-Erweiterungen und MCP-Allowlist in .claude/mutation-policy.json“ | Befehl: `write-guard.js:W4`, `mcp-write-guard.js:MCP_WRITE_UNDECLARED`; Satz: `mcp-write-guard.js:POLICY_INVALID`, `shell-mutation-guard.js:POLICY_INVALID` |
| O4 | Zugangsdaten anlegen oder ändern | `write-guard.js:W2` | Owner-Regel (CLAUDE.md): „Zugangsdaten, lokale Freigaben und settings.local.json werden nie versioniert oder ausgeliefert.“ | Satz |
| O5 | OK-Satz für close und publish oder Release | kein Wächter; close und publish verlangen den Owner-OK-Wortlaut | Owner-Regel (CLAUDE.md): „der Owner sagt im Chat OK“ | Satz |
| O6 | OK-Satz für Änderungen an den Harness-Dateien einer Installation und für das Harness-Update; danach führt der Agent aus | write-guard W5, Weg nach E19 | Owner-Auftrag des Pakets guard-scope R10 | Satz |
| O7 | Entfernen, Zusammenlegen oder Verstecken nur mit wörtlichem Owner-Satz | kein Wächter | Owner-Regel (Werkbank-Regeldatei owner-rules.md): „Entfernen nur mit woertlichem Owner-Satz“ | Satz |
| O8 | Freigabe eines Codex-Hooks mit /hooks in seiner eigenen Codex-Sitzung (B23) | kein Wächter; Codex selbst verlangt die Freigabe | Codex-Doku hooks: „Use `/hooks` in the CLI to … review new or changed hooks, trust hooks“ | Klickfolge |
