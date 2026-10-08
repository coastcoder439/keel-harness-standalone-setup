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

Ein Fehler im Wächter selbst ist keine Regel und hat keinen Code: jeder der acht PreToolUse-Wächter
sperrt dann mit `<wächter>: internal error; tool blocked: <Meldung>` (Claude: Rückgabe 2, Codex:
JSON-deny mit Rückgabe 0), auch bei einem Fehler außerhalb seiner Auswertung (guard-decisions E5, B38). Im einen
Wächter-Prozess `.claude/pretool-guards.js` sperrt ein Wächter, der nicht lädt oder wirft, mit seinem eigenen Namen, die
übrigen Wächter des Aufrufs sagen trotzdem ihr Wort (guard-decisions E26).

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
| plan-publish | git push | Owner-Regel: „Rohe mutierende Git-Befehle sind gesperrt.“ (CLAUDE.md) | Intent plan-publish von harness-core/git/git-intent.mjs, dann publish: für ein Projekt aus publishProjects ohne Owner-Satz, für jedes andere Repo nach Paketabschluss und Owner-Handlung O5 |
| explain | jeder übrige schreibende Git-Befehl, darunter breite Historienumschreibung und nicht rückholbares Löschen | Owner-Regel: „Breite Historienumschreibungen und nicht recoverable Löschungen bleiben Owner-Entscheidungen.“ (CLAUDE.md) | Owner-Handlung O2 |
| maintain | Git-Pflege (git fetch, git pull --ff-only, git switch [-c], git checkout <branch> / -b, git stash push/list/show/apply/pop) einer Sitzung, die an einen Arbeitsschritt gebunden ist (Arbeitsagent mit KEEL_PACKAGE_SESSION oder Leaf-Bindung), in einem Wrapper (außer der Codex-Form & bash.exe -c), nach cd, oder in einer anderen Form (git pull ohne --ff-only, --rebase, -f, --discard-changes, stash -a, Refspec mit : oder +, Remote als URL, checkout eines Pfads) | Owner-Regel: „Produktdateien ändert nur, wer an einen Arbeitsschritt eines Pakets gebunden ist; was keine Produktdatei ändert, braucht kein eigenes Paket“ (Owner 07.10.2026, docs/harness-rebuild/arbeitsweise-karte.md) | die Formen der Git-Pflege direkt in der Sitzung ohne Bindung, git -C <repo> statt cd; ein gebundener Schritt sichert über den Intent checkpoint |
| WAVE_IN_PROGRESS | git pull, git switch, git checkout und git stash push/apply/pop, solange im Repo eine Dispatch-Welle offen oder versiegelt ist oder eine andere Sitzung eine lebende Leaf-Bindung im Repo hält (Bindungsdatei oder Eintrag im Sitzungsindex, auch ein nur vorbereiteter Schritt aus start --session) (git fetch und stash list/show bleiben frei) | Gefahr G1: der Arbeitsbaum ändert sich unter laufenden oder gebundenen Arbeitsagenten, sie verlieren ihre Dateien | warten, bis die Arbeitsagenten zurück sind und integrate die Welle abgeschlossen hat, oder den vorbereiteten Schritt beenden (rebind/abort); dann derselbe Befehl |

Lesende Git-Befehle (Paket P3, A4) sind frei, solange sie nur lesen. Die Freigabe prüft jede Form einzeln:

- `git grep` ist frei, außer mit `-O`/`--open-files-in-pager` (startet einen Pager) und `--ext-grep` (startet ein
  externes grep). Git nimmt jede eindeutige Abkürzung einer langen Option an, deshalb zählt jedes Präfix dieser beiden
  Namen und jedes `-O` in einem Bündel kurzer Optionen (`-nO`); solche Aufrufe gehen auf inspect.
- `git tag` ist frei nur zum Auflisten: ohne Argument, mit `-l`/`--list` (und Muster), `-n<num>`, `--contains`,
  `--no-contains`, `--points-at`, `--merged`, `--no-merged`, `--sort=…`, `--format=…`, `--column`. Ein Wort, das kein
  Schalter ist, legt einen Tag an, es sei denn, ein Auflistungsschalter ist dabei (gemessen: `git tag --sort=refname v1`
  legt v1 an, `git tag -n1 v1` und `git tag --contains HEAD v1` nicht). Anlegen, Löschen (O2), Signieren und Erzwingen
  bleiben gesperrt.
- `git remote` ist frei ohne Argument, mit `-v`, als `show [-n] <name>` und als `get-url [--push|--all] <name>`; der Name
  ist ein schlichter Remote-Name, nie eine URL. `add`, `remove`/`rm`, `rename`, `set-url`, `set-head`, `set-branches`,
  `prune` und `update` bleiben gesperrt.
- `git notes --ref keel-proof show|list [<Objekt>]` liest die Prüfnotizen des Harness und ist frei; jede andere Notiz-Form
  bleibt gesperrt. Geschrieben werden Prüfnotizen nur über die Absichten `proof-note-write` und `proof-notes-sync`
  von harness-core/git/git-intent.mjs.

Verwaiste Sperre (Paket P3, A12): `release-stale-lock --root <Repo>` von harness-core/git/git-intent.mjs entfernt
`<git-dir>/index.lock` nur, wenn alle drei Bedingungen gelten: die Datei ist 0 Byte groß, ihre Änderungszeit liegt mehr als
5 Minuten zurück, und das Repo ist das eigene (die Regel-Wurzel selbst oder ein Repo darunter, derselbe Test wie bei
package-amend). Eine Sperre mit Inhalt (ein laufender Git-Prozess, auch ein abgebrochener Commit hinterlässt sie mit Inhalt),
eine jüngere Sperre oder ein fremdes Repo endet mit STALE_LOCK_REFUSED samt Gründen; gelöscht wird dann nichts. Jede
Sperrmeldung dieses Wächters nennt den Weg, sobald das Repo des Arbeitsverzeichnisses eine index.lock enthält, und ein
Git-Aufruf einer Absicht, der an index.lock scheitert, nennt ihn in seiner Fehlermeldung.

Sperre nach hängendem Vorgang (Paket P3, C13): Bricht git-intent eine eigene Git-Operation über den Stille-Wächter als
hängend ab (GIT_HUNG), entfernt es danach die index.lock dieses Repos, wenn ihre Änderungszeit nach dem Start dieser
Operation liegt (sie stammt also von ihr) und kein anderer Git-Prozess mit diesem Repo (oder einem Ordner darin) als
Arbeitsordner läuft. Der Arbeitsordner wird gelesen (Linux /proc, macOS lsof, Windows aus dem Prozessblock; nur für Prozesse
desselben Benutzers). Ist ein Arbeitsordner nicht lesbar oder die Prozessliste nicht zu erhalten, bleibt die Sperre. Die
Fehlermeldung nennt das Ergebnis (entfernt oder warum nicht, Feld lockRelease), und die Pfade eines gescheiterten
Checkpoint-Commits werden wieder aus dem Index genommen; gelingt das nicht, steht „STILL STAGED“ in der Meldung. Die Absicht
release-stale-lock behält ihre Regel (0 Byte, älter als 5 Minuten). Auch add und restore laufen über den Stille-Wächter, nicht
mit festen 30 s (große Dateien).

Feste Abbruchzeiten der übrigen Kindprozesse (Paket P15, C13): `package-cli doctor` in `package-amend finish`,
`package-bootstrap plan` und `package-resolve`, das Paketwerkzeug `package-standard.mjs`, der Architekturbild-Vorbau und
-Lauf und das Klonen und der Installer des Harness-Updates laufen über den Stille-Wächter, ohne Zeitlimit und ohne
Ausgabe-Deckel. Abgebrochen wird nur ein Kind, das `KEEL_SILENCE_MS` lang nichts ausgibt und dessen Prozessbaum nichts
arbeitet; die Meldung sagt „hung … not for taking long“. Das Warten auf das Dashboard nach einem Update endet an einem
gestorbenen Startprozess oder an `KEEL_SILENCE_MS` Stille in `dashboard.log`. Die Wächter (Hooks) rufen nichts davon auf;
ihre kurzen Zeitlimits bleiben.

Veröffentlichen (Paket P3, E1 und C8): `git push` geht auf plan-publish. Der Weg, in dieser Reihenfolge:

1. Projekt-Repo, das der Owner in `publishProjects` von `.claude/mutation-policy.json` eingetragen hat:
   `plan-publish --root <Repo>`, dann `publish --root <Repo> --receipt <Plan-Beleg>`. Kein Paketabschluss und kein
   Owner-Satz: der Eintrag ist das allgemeine OK des Owners je Projekt (D16). Die Datei schreibt nur der Owner
   (write-guard W4, Owner-Handlung O3). Gepusht wird immer nur der aktuelle Branch nach origin, nur als Fast-Forward,
   nie mit `--force` oder `--force-with-lease`, ohne anderen Branch oder anderes Remote und ohne Löschen entfernter Branches.
   Ist der Push kein Fast-Forward, endet er mit PUBLISH_NOT_FAST_FORWARD (erst holen und zusammenführen, dann neu planen).
   Ändern sich HEAD, Branch, origin oder die Eintragung nach dem Plan, ist der Plan ungültig (PUBLISH_PLAN_STALE,
   PUBLISH_PROJECT_NOT_LISTED). Ein ungültiger Eintrag sperrt fail-closed (PUBLISH_POLICY_INVALID; in den Wächtern
   POLICY_INVALID).
2. Jedes andere Repo: Paket abschließen, der Owner sagt im Chat OK (O5), dann
   `package-executor.mjs publish --closure-receipt <Beleg> --owner-ok "<Wortlaut>"`. Der Weg über `plan-publish --session`
   ist kein Agentenweg und steht nicht mehr in der Sperrmeldung.

Ehrliche Grenze der Prüfnotizen (Paket P3, Konzept 3.1): Agenten laufen unter dem Windows-Konto des Owners. Wer absichtlich
Prüfcode schreibt, der `proof-note-write` aufruft, kann eine Notiz fälschen; der Shell-Wächter sperrt die Absicht deshalb nicht
zusätzlich. `proof-note-write` verlangt eine Datei mit je einem JSON-Eintrag `schema: "keel-proof.v2-entry"` pro Zeile (so übersteht
sie das zeilenweise `cat_sort_uniq` von `proof-notes-sync`; ein JSON-Dokument `schema: "keel-proof.v1"` gilt weiter) im Lauf-Ordner `.unlazy` des Repos oder
der Regel-Wurzel oder im Ordner `keel-proof` des System-Temp-Ordners und einen vollständigen Commit des Repos; es ersetzt nur die
Notiz dieses Commits. `proof-notes-sync` holt den Notiz-Ref von origin in einen eigenen Ref, führt beide Seiten mit
`cat_sort_uniq` zusammen (keine Notiz geht verloren) und pusht ohne Überschreiben; fehlt der Ref auf origin, ist das kein Fehler.

## .claude/shell-mutation-guard.js

Der Wächter ist eine endliche Freigabeliste für Bash und PowerShell. Zusammenführen und Verwerfen
von Ausgabeströmen, Versionsabfragen und Schleifen über Lesebefehle sind frei (siehe „Was Claude
und Codex selbst regeln“).

| Code | Sperrt | Grund | Weg |
|---|---|---|---|
| ENVIRONMENT_OVERRIDE | Umgebungs-Überschreibung vor einem Befehl, die Code einschleust, ein Programm austauscht oder den Harness verstellt (PATH, PATHEXT, NODE_OPTIONS, NODE_PATH, LD_*, DYLD_*, GIT_*, BASH_ENV, ENV, PROMPT_COMMAND, PS4, SHELLOPTS, BASHOPTS, PYTHONSTARTUP, PYTHONPATH, PERL5OPT, PERL5LIB, RUBYOPT, COMSPEC, SHELL, HOME, USERPROFILE, APPDATA, TEMP, TMP, TMPDIR sowie KEEL_*, CLAUDE_*, CODEX_*, RIPGREP_CONFIG_PATH, LESSOPEN, LESSCLOSE, AWKPATH, AWKLIBPATH, GREP_OPTIONS, PAGER, EDITOR, VISUAL, BASH_FUNC_*, IFS, CDPATH, GLOBIGNORE sowie GH_*, GITHUB_*, HTTP_PROXY, HTTPS_PROXY, ALL_PROXY, NO_PROXY, XDG_*, SSL_CERT_*, CURL_CA_BUNDLE, NODE_EXTRA_CA_CERTS, NODE_TLS_*, ohne Rücksicht auf Groß-/Kleinschreibung), eine Zuweisung ohne Befehl und im PowerShell-Dialekt $env:X = … | Gefahr G4: eine Variable kann Regelwurzel, Paketsitzung oder Testmodus der Wächter verstellen oder ein erlaubtes Programm fremden Code laden lassen. Eine andere Variable vor einem Befehl (FOO=1 cat datei) ist frei; beurteilt wird der Befehl | Befehl ohne Überschreibung ausführen |
| DYNAMIC_WRAPPER | Hüllen, die einen zweiten Befehl starten (etwa env oder xargs), und Befehle, deren Name erst zur Laufzeit entsteht | Gefahr G4: der eigentliche Befehl entgeht der Prüfung | den Befehl direkt ausführen |
| SHELL_WRAPPER | Shell-Hüllen und Shell-Skripte wie bash -c, sh -c, powershell -Command oder -File, pwsh -c, cmd /c | Gefahr G4: die Nutzlast entgeht der Prüfung. bash -c mit genau einer statischen Nutzlast wird im PowerShell-Dialekt nach seiner Nutzlast beurteilt, weil Codex unter Windows Bash so aufruft | den Befehl direkt im Bash- oder PowerShell-Werkzeug ausführen |
| UNCLASSIFIED_GIT | Git-Aufrufe, die keiner Absicht zugeordnet werden können | Gefahr G4: ein Git-Weg an git-intent-guard vorbei | harness-core/git/git-intent.mjs |
| INTERPRETER_EXECUTION | Start eines anderen Interpreters (python, ruby, perl und andere) mit Code oder Skript | Gefahr G2: der Inhalt des Skripts ist nicht geprüft | deklarierte Prüfer, Tests und Werkzeuge |
| INLINE_INTERPRETER | node mit Code auf der Kommandozeile (-e, -p, --eval, --print) | Gefahr G2: der Code ist nicht statisch prüfbar | Code in einer Datei im OWNS und als deklarierter Test ausführen |
| NODE_PRELOAD | node mit --require, --import, --loader oder NODE_OPTIONS | Gefahr G2: vorab geladener Code läuft vor jedem Skript | node ohne Vorabladen |
| NODE_CHECK_FORM | node --check mit weiteren Schaltern oder mehreren Dateien | Gefahr G2: die Prüfform wird zur Ausführung | node --check mit genau einer Datei |
| UNDECLARED_TEST | node --test auf eine Datei, die nicht direkt in einem Ordner test/ der Installation oder einer Produkt-Wurzel liegt und auf .test.js, .test.mjs oder .test.cjs endet; node --test mit anderen Schaltern als --test-concurrency=<n>, --test-reporter=<spec, dot, tap, junit oder lcov>, --test-name-pattern=<p>, --test-skip-pattern=<p>, --test-only, --test-force-exit und --test-reporter-destination (stdout, stderr oder ein Ziel im Temp-Ordner der eigenen Sitzung) | Gefahr G2: ein Test ist ausführbarer Code; ein Reporter ist ein Modul und ein Reporter-Ziel eine geschriebene Datei. Eine neue Testdatei in test/ braucht keinen Listeneintrag (--import, --require, -r, --loader, --experimental-loader, --eval, -e und --inspect* bleiben gesperrt: NODE_PRELOAD, INLINE_INTERPRETER, UNDECLARED_TEST) | Testdateien in test/ mit den freigegebenen Schaltern; weitere Testdateien trägt der Owner in .claude/mutation-policy.json ein |
| NODE_SCRIPT_REQUIRED | node ohne Skriptdatei (REPL, Standardeingabe) | Gefahr G2: der Code kommt nicht aus einer Datei | node mit einem deklarierten Skript |
| SERVICE_ARGUMENTS | Start des Dashboard-Dienstes mit anderen Argumenten als --port <n> und den Sprach-Schaltern | Gefahr G2: Argumente ändern, was der Dienst ausführt | den Dienst mit den vorgesehenen Argumenten starten |
| UNDECLARED_NODE_SCRIPT | node auf ein nicht deklariertes Repository-Skript | Gefahr G2: das Skript kann schreiben, ohne geprüft zu sein | deklarierte Prüfer und Werkzeuge, lesende package-cli-Unterbefehle |
| UNDECLARED_EXECUTABLE | Programme außerhalb der Lese-, Prüfer- und Schreibliste | Gefahr G2: die Wirkung des Programms ist unbekannt | ein Befehl aus der Freigabeliste |
| DYNAMIC_EVALUATION | Befehlsersetzung ($(...), Backticks) mit einem gesperrten inneren Befehl, mit berechnetem Befehlsnamen oder als Argument eines Befehls, dessen Schalter schreiben oder ein Programm lesen (rg, sort, uniq, find, sed, awk, node, gh und andere); Prozess- und Arithmetik-Ersetzung; ein Argument, dessen Text erst eine Quotierung ($'...') oder Klammererweiterung ({a,b}) festlegt; .NET-Aufrufe außerhalb der Lese-Helfer | Gefahr G2: der ausgeführte Befehl oder Schalter entsteht erst zur Laufzeit. Frei ist eine Befehlsersetzung, deren innerer Befehl die Politik besteht und deren Ergebnis nur Daten für einen lesenden Befehl ist (echo $(date), cat $(ls docs)); .NET-Instanzmethoden add, addrange, remove, removeat, insert, clear, push, pop, enqueue, dequeue, set_item, get_item, trygetvalue, toarray und sort auf Variablen sind Lese-Helfer | den Befehl ausgeschrieben angeben |
| POWERSHELL_PARSE | PowerShell-Befehle, die PowerShells Parser nicht fehlerfrei zerlegt | Gefahr G2: ein nicht zerlegter Befehl ist nicht beurteilbar | den Befehl syntaktisch korrekt schreiben |
| DIRECT_SHELL_WRITE | Schreibbefehle der Shell (cp, tee, split, csplit, Set-Content, Copy-Item und andere), sed mit den Befehlen w, W oder e, mit den s-Schaltern w oder e, mit -f (Skriptdatei) oder -i, find mit -delete, -exec, -execdir, -ok, -okdir, -fprint, -fprint0, -fprintf oder -fls, uniq mit einer zweiten Datei (Ausgabedatei), tar im Modus x, c, r, u oder A | Gefahr G1: die Shell schreibt an der OWNS-Prüfung vorbei | Datei-Werkzeuge Write und Edit; rm, mkdir und mv im gebundenen OWNS; Schreiben im Temp-Ordner der eigenen Sitzung (SESSION_TEMP_WRITE) |
| READ_COMMAND_ESCALATION | Lesebefehle mit schreibenden oder ausführenden Schaltern (sort -o und ähnliche); awk und gawk mit system(…), mit einem Pipe-Zeichen an irgendeiner Stelle des Programms (ein logisches Oder aus zwei Strichen ausgenommen), mit print oder printf und einem späteren > oder >> in derselben Anweisung (auch über einen Zeilenumbruch nach Komma oder Operator, über eine Zeilenfortsetzung mit Backslash und über Klammern hinweg), mit einem @ an irgendeiner Stelle des Programms (gawk-Indirektaufruf @f(…), @include, @load, @namespace), mit /inet-Dateinamen (Netzverbindung), mit :: (Namensraum-Aufruf), mit einem Programm aus einer Datei (-f) und mit den Schaltern -i, -E, -l, -o, -p und jedem weiteren, der nicht nur das Lesen formt; gh api mit einer anderen Methode als GET, mit -f, -F, --field, --raw-field, --input, mit --hostname oder fremdem Host und graphql mit mutation; ein sed-Skript, das nicht lesbar ist | Gefahr G1: ein Lesebefehl schreibt oder führt Code aus | den Lesebefehl ohne diese Schalter; awk-Programme, die nur lesen und ausgeben (awk '{print $1}' datei, awk '$3 > 5' datei) |
| OUTPUT_REDIRECTION | Umleitung von Ausgabe in eine Datei (>, >>, 2> auf einen Pfad, *>, Out-File über >), außer auf einen wörtlichen Pfad im Temp-Ordner der eigenen Sitzung | Gefahr G1: Umleitung in Dateien schreibt an der OWNS-Prüfung vorbei; Zusammenführen (2>&1) ist frei; Verwerfen ist im Bash-Dialekt nach /dev/null frei, im PowerShell-Dialekt nur nach $null, weil Windows PowerShell 2>/dev/null in eine Datei \dev\null schreibt | Datei-Werkzeug Write; Ausgabe in den Temp-Ordner der eigenen Sitzung |
| SESSION_TEMP_WRITE | (Freigabe, keine Sperre) Schreiben und Löschen im Temp-Ordner der eigenen Sitzung: Umleitung, New-Item, Set-Content, Add-Content, Out-File, tee, Remove-Item, rm, rmdir, mkdir, cp, Copy-Item, mv, Move-Item mit wörtlichen Zielen in <os.tmpdir()>/claude/<ein Ordnername>/<session_id>/ | Gefahr G1: der Ordner gehört der Sitzung und ist ihr Arbeitsraum für Messungen und Hilfsdateien; verglichen wird der aufgelöste Pfad (8.3-Kurznamen, Verbindungspunkte, Links, Groß-/Kleinschreibung unter Windows), kein fremder Sitzungsordner, kein Pfad mit .., kein Link, keine Datei mit mehreren Namen, ohne session_id keine Freigabe; Programme und Skripte aus diesem Ordner auszuführen bleibt gesperrt | Ziele im Ordner der eigenen Sitzung wählen; messen mit node harness-core/tools/measure.mjs ram, procs oder watch |
| PACKAGE_SCRIPT_RUNNER | npm, pnpm, yarn und npx in einer Sitzung, die an einen Arbeitsschritt gebunden ist (Arbeitsagent oder Leaf-Bindung): sie könnte package.json schreiben und dann ausführen | Gefahr G2: ein Skript aus einer selbst geschriebenen package.json ist Code ohne Prüfung | im gebundenen Schritt die deklarierten Prüfer direkt; installieren, bauen und testen mit den Projektwerkzeugen macht die Sitzung ohne Bindung |
| PROJECT_TOOL_FORM | in der Sitzung ohne Bindung jede andere Form der Projektwerkzeuge: -g, --global, --location, --prefix, -C, --dir, Workspaces, install mit Paketnamen (ändert package.json), ein Skript, das nicht in der package.json des Projekts steht, npx eines Programms außerhalb von node_modules/.bin oder mit --package/-y, jeder andere Unterbefehl (publish, add, ...); dazu die bekannten schreibenden Formen (Prüfung 07.10.2026): die Argumente `--write`, `-w` (prettier) und `--fix` (eslint u. a.) an jeder Stelle, auch nach `--` und hinter dem Programm, ein Skript, dessen Name ein Wort fix oder codemod trägt oder format, fmt, prettier ohne check, verify, lint, test oder ci (`npm run format`, `pnpm format`, `yarn lint:fix`; `format:check` liest), die Programme jscodeshift, codemod und putout, und install/ci ohne `--ignore-scripts` (auch `yarn` allein); seit der Nachprüfung 07.10.2026 auch `-u`, `--update`, `--updateSnapshot` (jest, vitest), `--apply`, `--apply-unsafe`, `--unsafe` (biome), `--write=…`, `dprint fmt` und `biome format/check --write`, und bei `npm/pnpm/yarn run <Skript>` und `npm test` der Text des Skripts aus package.json (mit pre-/post-Skript und den Skripten, die er per npm run aufruft) auf dieselben Formen (`"test": "jest -u"` sperrt `npm test`) | Gefahr G2: fremder oder neuer Code statt der Werkzeuge des Projekts, Gefahr G1: ein Formatierer oder Fixer schreibt Produktdateien ohne Bindung, die Install-Skripte der Abhängigkeiten führen Code aus, den kein Wächter sieht; Owner-Regel: „Werkzeuge und Prüfungen des Projekts ausführen ist Orchestrator-Arbeit (Installieren, Bauen, Testen)“ (Owner 07.10.2026, docs/harness-rebuild/arbeitsweise-karte.md) | npm/pnpm/yarn install oder npm ci mit `--ignore-scripts` ohne Paketnamen, npm/pnpm/yarn run <Skript aus package.json>, npm test, npx/npm exec/pnpm exec <Programm aus node_modules/.bin>, im Ordner des Projekts; formatieren, fixen und Codemods nur gebunden an einen Arbeitsschritt (Kleinpaket oder Leaf), sonst die prüfende Form (`--check`, `format:check`, lint ohne `--fix`) |
| POLICY_INVALID | jeden Befehl, solange .claude/mutation-policy.json ungültig ist | Gefahr G4: ohne gültige Politik ist keine Freigabe entscheidbar | Owner-Handlung O3 |
| PACKAGE_TOOL_UNBOUND | schreibende Aufrufe von package-standard.mjs für ein anderes als das gebundene Bündel | Gefahr G1: schreibende Aufrufe von package-standard.mjs nur für das gebundene Bündel | create mit --session gleich der eigenen Sitzung öffnet die Bindung selbst; mit bestehender Bindung müssen --root und --package zu ihr passen |
| PACKAGE_TOOL_OVERRIDE | package-standard.mjs mit --unlazy | Gefahr G2: --unlazy wählt nicht deklarierten Code | Aufruf ohne --unlazy |
| FOREIGN_PROCESS | Stop-Process -Id und taskkill /PID auf einen Prozess, dessen Befehlszeile keinen Pfad der Installations- oder einer Produkt-Wurzel enthält, oder der nicht läuft | Gefahr G3: das Beenden eines fremden Prozesses wirkt außerhalb des Arbeitsbereichs | nur Prozesse beenden, die Dateien dieser Installation oder ihrer Produkt-Wurzeln ausführen; jeden anderen Prozess unter Offen melden |
| INSTALLER_ARGUMENTS | der Installer des Setup-Repos mit anderem Unterbefehl als install, status oder doctor, anderen Schaltern als --target, --upgrade und --json, oder mit einem --target, das nicht die Installationswurzel ist | Gefahr G3: der Installer würde eine fremde Installation überschreiben | node <Setup-Repo>/install.mjs install, status oder doctor mit --target gleich der Installationswurzel |

Ehrliche Grenze der Projektwerkzeuge (Prüfung 07.10.2026): PROJECT_TOOL_FORM kennt nur die genannten schreibenden Formen.
Ein Test- oder Build-Skript der package.json (`npm test`, `npm run build`) führt Projektcode aus, der Dateien schreiben
kann, wie gate-check heute beim Prüfen; der Wächter sieht diesen Code nicht, sondern nur den Aufruf. Ein Skript, das
anders heißt und trotzdem formatiert, fällt ebenso durch. `-w` ist an jeder Stelle gesperrt, auch wo es nur „watch“
heißt (`tsc -w`); der Weg ist `--watch`.

Harmlose Lese- und Formatbefehle (Paket shell-grants, A4) sind einzeln auf ihre Schreib- und Ausführungsschalter
geprüft und frei, jeder nur in der genannten Form; die Freigabeliste bleibt das Prinzip:

- `awk` und `gawk`: das Programm (erstes Argument ohne Schalter, auch `-e`/`--source`) enthält kein `system(`, kein
  einzelnes Pipe-Zeichen, kein `@` (gawk ruft mit `@f(…)` eine Funktion über den Namen in einer Variablen auf und lädt mit
  `@include`, `@load`, `@namespace` Code; ein aus Teilen zusammengesetzter Name läuft ebenfalls nur über `@`; deshalb
  wird jedes `@` gesperrt, auch in Zeichenketten), kein `::`, keinen Dateinamen `/inet/…` (auch nicht als Schalterwert oder
  Dateiargument) und kein `print` oder `printf` mit späterem `>` oder `>>` in derselben Anweisung. Vor der Prüfung
  werden Backslash-Zeilenfortsetzungen entfernt; eine Anweisung endet an `;`, `{`, `}` und an einem Zeilenumbruch, der
  die Zeile abschließt (Wort, Zahl, Zeichenkette, `)` oder `]` am Ende und keine `>`/`|`-Zeile danach), nicht nach
  Komma oder Operator. Das Programm wird unter mehreren Lesarten geprüft (Zeichenketten, Regex und Kommentare
  herausgenommen; `/` als Teilung oder Regex-Anfang; Klammerausdrücke; roher Text); findet eine Lesart eine
  Umleitung, ist es gesperrt. Im Zweifel wird gesperrt. Nicht auf der Liste und damit ohnehin gesperrt: `mawk`,
  `busybox awk`, `original-awk` (UNDECLARED_EXECUTABLE); freie Schalter sind `-F`, `-v` und die Lese-Schalter `-b -c -n -N -P -r -s -S -t -O`;
  `-f/--file`, `-i`, `-E`, `-l`, `-o`, `-p`, `-d`, `-D` und jeder andere Schalter sind gesperrt. `close()`, `fflush()`,
  `getline var < "datei"`, `ENVIRON` und `PROCINFO` (lesend) bleiben frei; `PROCINFO["sorted_in"]` ruft in gawk nur
  Funktionen auf, die das Programm selbst definiert. Vergleiche mit `>`
  außerhalb von `print` (`$3 > 5`) bleiben erlaubt.
- `du`, `ps`, `tasklist`: alle Schalter. `ConvertTo-Csv`, `ConvertFrom-Csv`, `Import-Csv`, `Get-Member`, `Add-Member`.
- `Measure-Command { … }`: der Skriptblock wird Befehl für Befehl wie bei ForEach-Object beurteilt; ein gesperrter
  innerer Befehl sperrt den ganzen Befehl. `time <befehl>` (Bash, nur `-p` als Schalter): beurteilt wird `<befehl>`.
- `ollama ps`, `ollama list`, `ollama show <modell>` und `ollama --version`; alle anderen Unterbefehle bleiben gesperrt.
- `gh api` nur lesend: kein `-X/--method` außer GET, kein `-f`, `-F`, `--field`, `--raw-field`, `--input`, kein
  `--hostname`, kein fremder Host, kein `graphql` mit `mutation`; jeder andere `gh`-Unterbefehl bleibt gesperrt.
- `claude --help`, `claude -h` und `claude <unterbefehl> --help` oder `-h`; `--version` war schon frei.
- Befehlsersetzung `$(…)` und Backticks (Bash): der innere Befehl wird mit derselben Politik beurteilt; ist er erlaubt und
  nimmt der äußere Befehl das Ergebnis als Daten (echo, cat, head, ls, grep und andere lesende Befehle ohne schreibenden
  Schalter), ist alles erlaubt. Ein berechneter Befehlsname und ein berechnetes Argument für rg, sort, uniq, find, sed,
  awk, node, gh, rm und die übrigen Befehle bleiben DYNAMIC_EVALUATION.
- Variable vor dem Befehl (`NAME=wert befehl`, Bash): beurteilt wird `befehl`; gesperrt sind die Namen aus
  ENVIRONMENT_OVERRIDE, darunter alle `GH_*` und `GITHUB_*` (GH_HOST, GH_TOKEN, GH_CONFIG_DIR, GH_REPO, GITHUB_API_URL
  …), weil sie Host, Token und Einstellungen von `gh api` verstellen und so den Host-Schutz aushebeln würden.
- `sed -n 1,5p` ohne Anführungszeichen: in Bash frei. In PowerShell gilt die Form mit Anführungszeichen
  (`sed -n '1,5p' datei`); ohne sie macht PowerShell aus `1,5p` ein Feld, der Wächter sperrt das als DYNAMIC_EVALUATION.
- .NET-Instanzmethoden auf Variablen im Speicher (`$liste.Add($x)`, `$h.Remove('k')` und die übrigen Lese-Helfer aus
  DYNAMIC_EVALUATION); statische Aufrufe bleiben auf die vorhandene Liste beschränkt.

Temp-Ordner und Messen (Paket shell-grants, A5): im Temp-Ordner der eigenen Sitzung schreibt und löscht die Shell
(SESSION_TEMP_WRITE, OUTPUT_REDIRECTION); der Mess-Prüfer `node harness-core/tools/measure.mjs ram`, `procs [--name <teil>]`
und `watch --seconds <n> [--every <s>]` gibt genau ein JSON-Objekt aus, schreibt nichts und ist ein Werkzeug für Agenten.

Testliste (Paket shell-grants, A20): `node --test` führt jede Datei aus, die direkt in einem Ordner test/ der Installation
oder einer Produkt-Wurzel liegt und auf .test.js, .test.mjs oder .test.cjs endet; eine feste Liste gibt es nicht mehr.

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
| GIT_INTERNALS | Schreiben in `<gitdir>/config`, `<gitdir>/config.worktree`, `<gitdir>/hooks/**` und in die `.git`-Datei eines Worktrees, auch für das gitdir eines Worktrees, den commondir, Submodul-gitdirs (`modules/<name>/…`), einen separaten Git-Ordner und ein bloßes Repo | Gefahr G7: was dort steht (core.hooksPath, core.fsmonitor, Hook-Skripte) läuft beim nächsten Git-Schritt als Code des Schreibers | kein Agentenweg: `.git/config` und `.git/hooks` ändert allein der Owner außerhalb einer Agentensitzung; der Agent meldet die Sperre unter Offen: |
| HARNESS_STATE_WRITE | direktes Schreiben von Prüfergebnissen und Executor-Zustand: `~/.unlazy/approved/**` (und der Ordner aus `UNLAZY_APPROVAL_DIR`), `.unlazy/<scope>/executor.json`, `.unlazy/<scope>/executor/**` | Gefahr G7: die Dateien belegen, was geprüft und gelaufen ist; ein Agent, der sie schreibt, fälscht den Nachweis | Prüfergebnisse entstehen durch gate-check (`--approve`), der Executor-Zustand durch `package-executor.mjs`; beide sind keine Werkzeugaufrufe |
| HOST_TRANSCRIPT_WRITE | Schreiben in den Transkriptspeicher des Hosts: `<Benutzerordner>/.claude/projects/**`, `<CLAUDE_CONFIG_DIR>/projects/**` (samt der Ordner darüber) und die Datei aus `transcript_path` der Hook-Eingabe, wo immer sie liegt | Gefahr G7: die erste `sessionId`-Zeile des Transkripts belegt, welche Planungsbindung eine Sitzung übernimmt (D15); ein Agent, der sein Transkript schreibt, fälscht den Beleg und übernimmt die Bindung einer lebenden fremden Sitzung | kein Agentenweg: das Transkript schreibt allein der Host; eine fremde Bindung übernimmt der Agent nur von Hand über `package-bootstrap.mjs begin --takeover`, wenn ihr Halter still ist |

Schreibschutz für Git-Interna, Prüfzustand und Transkript (Paket P4, A19, A21 und HOST_TRANSCRIPT_WRITE): Die Regeln stehen vor W1 und gelten für Write/Edit,
für Codex-Patches und für die Shell auf demselben Weg (`pruefen`; die Shell fragt sie bei jedem erlaubten Löschen, Verschieben
und Anlegen im OWNS und im Temp-Ordner der Sitzung). Geprüft wird der kanonische Pfad (8.3-Kurznamen, Verbindungspunkte); unter
Windows zählen nachgestellte Punkte und Leerzeichen und ein `:Datenstrom` nicht zum Namen. Die Git-Seite von A19 sperrt
`git config` jeder Form, `git remote add/set-url` und `-c core.hooksPath` schon über git-intent-guard (Absicht explain bzw.
inspect); dort kamen nur Tests hinzu.
Ehrliche Grenze von A21: Beliebiger Testcode unter `node --test` ist Code des Agenten und kann diese Dateien weiter schreiben,
denn er ist kein Werkzeugaufruf, den ein Wächter sieht. Dagegen hilft nur ein eigenes Windows-Konto für Agenten (Konzept
3.1). Dasselbe gilt für `.git/config` und `.git/hooks`: ein Test, der sie schreibt, wird nicht gesehen; die Regel hält die
Werkzeuge, nicht den Code, den ein Test startet.
Zwischendatei von write-guard (Paket P4, A16): Der Wächter braucht aus `.keel-harness/state.json` (428 KB) nur die verwalteten
Pfade und hält sie in `.keel-harness/cache/write-guard-paths.json` samt `mtimeMs` und `size` der state.json, aus der sie
stammt. Weicht eines ab, passt die Regel-Wurzel nicht oder fehlt die Datei, liest er neu und schreibt sie atomar (temp +
rename). Die Datei ist durch W5 gegen jedes Schreiben geschützt; geprüft wird der Stempel (Zeit und Größe), nicht der Inhalt.
Ein Lesefehler an state.json sperrt das Schreiben (fail-closed), nur ein fehlendes state.json heißt „keine Installation“.
Der Installer kennt den Ordner `cache` in `.keel-harness/` und entfernt ihn mit dem Zustand.

## .claude/paket-gate.js

Die Codes stammen aus dem Wächter und aus den Modulen der Paketbindung, des Paket-Starts und der
geplanten Paketänderung, deren Entscheidung der Wächter weiterreicht.

| Code | Sperrt | Grund | Weg |
|---|---|---|---|
| MISSING_SESSION | Schreiben ohne erkennbare Paketsitzung | Gefahr G1: ohne Sitzung ist keine Bindung prüfbar | Arbeit über den Package-Executor mit gebundener Sitzung |
| MISSING_OR_STALE_BINDING | Schreiben ohne gültige Paketbindung der Sitzung | Gefahr G1: ohne gültige Bindung gilt kein OWNS | Bindung über den Package-Executor (next, start, dispatch) neu setzen |
| OUTSIDE_REPOSITORY | Schreibziele außerhalb des gebundenen Repositorys | Gefahr G1: das Ziel gehört nicht zum gebundenen Paket | nur im gebundenen Repository schreiben |
| OUTSIDE_LEAF_OWNS | Schreibziele außerhalb des OWNS des gebundenen Leaf | Owner-Regel: „Nur gebundene Sessions schreiben in ihr Leaf-OWNS.“ (.claude/rules/keel/working-method.md) | nur im eigenen Leaf-OWNS schreiben; andere Pfade gehören ihrem Leaf |
| BOOTSTRAP_ENDED | Schreiben über eine Paket-Start-Bindung, nachdem das Paket angelegt ist, mit Ausnahme von `docs/packages/<paket>/evidence/**` und `design/**` des eigenen Pakets (D1) | Gefahr G1: die Start-Bindung gilt nur bis zum Anlegen | Leaf-Bindung über den Package-Executor; Belege und Berichte schreibt die Planungs- oder Orchestrator-Sitzung des Pakets direkt |
| OUTSIDE_BOOTSTRAP_PACKAGE | Schreiben außerhalb des Bündels, das gerade angelegt wird | Gefahr G1: der Paket-Start darf nur sein eigenes Bündel schreiben | nur im eigenen Bündel docs/packages/<packageId>/ schreiben |
| BOOTSTRAP_FILE | Dateien im Bündel, die der Paket-Start nicht anlegen darf | Gefahr G1: nur die Dateien des Paket-Schemas entstehen beim Start | nur die Bündel-Dateien des Paket-Schemas anlegen |
| BOOTSTRAP_LINK | Ziele über symbolische Links oder Verbindungspunkte beim Paket-Start | Gefahr G4: ein Link führt aus dem Bündel heraus | Ziele ohne Link schreiben |
| AMEND_OWNER_IMMUTABLE | (geplant) Änderungen am Originalauftrag in OWNER.md bei einer Paketänderung | Owner-Regel: „OWNER.md hält den unveränderlichen Originalauftrag“ (CLAUDE.md) | neue Anforderung als weitere R-Zeile anhängen, nie den Originalauftrag ändern |
| OUTSIDE_AMEND_PACKAGE | (geplant) Schreiben außerhalb des geänderten Bündels | Gefahr G1: die Paketänderung gilt nur für ihr Bündel | nur im geänderten Bündel schreiben |
| AMEND_LINK | (geplant) Ziele über Links bei einer Paketänderung | Gefahr G4: ein Link führt aus dem Bündel heraus | Ziele ohne Link schreiben |
| AMEND_STALE | (geplant) Schreiben mit einer veralteten Änderungsbindung | Gefahr G1: der Stand des Bündels hat sich seit der Bindung geändert | die Änderung neu binden |
| LEAF_RUNNING | Schreiben der Orchestrator-Sitzung des Pakets im OWNS eines Leaf ihres aktiven Pakets, solange auf diesem Leaf ein Arbeitsagent läuft (queued, starting, running, provider-returned, abort-/timeout-requested oder Leaf einer offenen Welle) oder eine andere Sitzung eine lebende Bindung darauf hält (Bindungsdatei oder Sitzungsindex, auch „prepared“ aus start --session); Write/Edit und Schreiben über die Shell (DIRECT_SHELL_WRITE mit diesem Grund) | Gefahr G1: zwei Schreiber im selben OWNS, der Rücklauf des Arbeitsagenten nähme fremde Änderungen mit | warten, bis der Arbeitsagent zurück ist (return, integrate), oder die Änderung diesem Leaf überlassen; ruht das Leaf (nicht dispatcht), schreibt die Orchestrator-Sitzung im OWNS selbst (Fix zwischendurch), geprüft wie Agentenarbeit bei integrate und close |

Freigaben ohne Arbeitsschritt (Owner 07.10.2026, docs/harness-rebuild/arbeitsweise-karte.md): `docs/harness-instance.md` der
Installationswurzel (das Installationsprofil, das das Onboarding schreibt) schreibt jede Sitzung, die an keinen Arbeitsschritt
gebunden ist, solange kein Leaf eines aktiven Pakets die Datei im OWNS hat (INSTANCE_PROFILE). Die Orchestrator-Sitzung eines
Pakets schreibt im OWNS eines ruhenden Leaf dieses Pakets selbst (ORCHESTRATOR_FIX, auch rm/mkdir/mv auf wörtliche Pfade);
läuft dort ein Arbeitsagent oder hält eine andere Sitzung dort eine lebende Bindung, gilt LEAF_RUNNING. Ein Paket hat genau einen
Orchestrator, festgehalten in `executor.json` (`orchestrator`): die Planungssitzung, sonst die erste Sitzung, deren start oder
Executor-Befehl gelungen ist (review-manual trägt die aufrufende Sitzung ein, nie die mit --session genannte). Nur er hat das
Fix-Recht; ein gescheiterter Aufruf trägt niemanden ein, eine andere Sitzung und eine Leaf-Sitzung des Pakets werden nie eingetragen.
Ein älteres Paket ohne `orchestrator` (und ohne `orchestratorTracked`) übernimmt beim Lesen seinen bisherigen Orchestrator: die
Planungssitzung (Planungsdatensatz oder Orchestrator-Datensatz mit via bootstrap), sonst den ersten Eintrag des Orchestrator-Index für
das Paket; gibt es keinen, wird niemand automatisch eingetragen außer der Planungssitzung (Nachprüfung 07.10.2026). Die Rolle wechselt
nur über `package-executor.mjs orchestrator-takeover --reason TEXT` und erst, wenn der bisherige Orchestrator länger als silenceMs
(KEEL_SILENCE_MS) still ist (kein Hook dieser Sitzung hat ihren Planungs- oder Orchestrator-Datensatz berührt; sonst
ORCHESTRATOR_ACTIVE), wie bei package-bootstrap --takeover; die übernehmende Sitzung ist CLAUDE_CODE_SESSION_ID, --session nur ohne
sie. Im Zustand als Ereignis `orchestrator-taken-over` mit Grund, Herkunft der Sitzung (`sessionSource`) und Stille des Vorgängers
festgehalten. Eine nie gelaufene Leaf-Sitzung, auf deren Leaf eine andere als die aufrufende Sitzung eine lebende Bindung hält, zählt
in integrate, close und git-intent plan-close als offene Ausführung (OPEN_EXECUTION, INTEGRATION_SESSIONS). Logik:
`harness-core/guards/session-scope.cjs`.

Leichter Weg für Belege und Berichte (Paket P4, D1): Die Sitzung, die ein Paket als Planer gebunden hat (Planungsbindung, auch nach
dem Anlegen) oder als Orchestrator führt (Datensatz unter `.unlazy/.orchestrators`, geschrieben nur für den einen Orchestrator des Pakets, nach erfolgreichem next, start,
dispatch, reassign, restart, reopen, resume, integrate oder orchestrator-takeover des Package-Executors), schreibt `docs/packages/<paket>/evidence/**` und `docs/packages/<paket>/design/**` genau
dieses Pakets direkt, ohne Arbeitsagent. `PACKAGE.md`, `GATES.md`, `gates/**`, `OWNER.md` und alles andere bleiben gesperrt;
Links und Dateien mit mehreren Namen unter diesen Ordnern bleiben gesperrt (BOOTSTRAP_LINK). Eine Arbeitsschritt-Sitzung
(Leaf-Bindung) bekommt dadurch nichts dazu. Keine Git-Prozesse (A16): Eine Sitzung ohne jeden Datensatz (Leaf-Index,
Leaf-Bindung, Planungsbindung, Änderungsbindung, Orchestrator) wird ohne Git abgewiesen; nur eine gebundene Sitzung zahlt
die Git-Suche.
Planungsbindung nach einer Wiederaufnahme (D15): Zwei Wege. Automatisch geht die Bindung auf die neue Sitzungskennung über,
wenn die erste vollständige Zeile der Transkriptdatei (`transcript_path` der Hook-Eingabe, gelesen werden die ersten 256 KiB),
die ein Feld `sessionId` trägt, die alte Kennung nennt; davor steht dann keine Zeile mit einer anderen Kennung. Eine weiter
unten angehängte Zeile belegt nichts, und das Transkript selbst schreibt allein der Host (write-guard HOST_TRANSCRIPT_WRITE für
Write/Edit, Shell und Codex-Patch); nur dieser Beleg entscheidet, nie eine Zeit (es gibt keinen Automatismus „nach N Sekunden Stille“). Das Ereignis steht im
Datensatz (`takenOverVia: "transcript"`, `transfers`). Beleg an echten wiederaufgenommenen Transkripten:
`docs/harness-rebuild/packages/P4-evidence-resume.md` (alte Kennung ab Zeile 1). Ehrliche Grenze: Eine abgespaltene Unterhaltung
(Fork) trägt dieselbe alte Kennung und übernimmt damit auch von einem noch offenen Fenster. Beliebiger Testcode unter `node --test` kann das Transkript wie bei A21
weiter schreiben; die Regel hält die Werkzeuge, nicht den Code, den ein Test startet. Von Hand mit
`package-bootstrap.mjs begin ... --takeover` (bei aktivem Paket zusätzlich `--reason <Text>`), ob das Paket aktiv ist oder
nicht, erst wenn die alte Sitzung seit `silenceMs` (`KEEL_SILENCE_MS`, Standard 30 Minuten) keinen Hook ausgelöst hat; sonst
PLANNER_ACTIVE. Lebenszeichen: Jeder Hook der Sitzung berührt am Eingang den Datensatz ihrer Planungsbindung (höchstens
alle 15 s, `TOUCH_INTERVAL_MS`): git-intent-guard, shell-mutation-guard und danger-guard bei jedem Bash- und PowerShell-Aufruf,
write-guard und paket-gate bei jedem Schreiben, mcp-write-guard bei jedem MCP-Aufruf, prompt-form bei jeder Nachricht und
unlazy-stop beim Stop. Nicht berührt wird bei Werkzeugen ohne Hook (Lesen, Suchen) und bei Hooks, die vor dem Eingang
scheitern (ungültige Eingabe). Eine lebende fremde Sitzung behält ihre Bindung. Die Sperrmeldung PACKAGE_TOOL_UNBOUND nennt
beide Wege mit dem genauen Befehl, aber nur für Halter, die diese Sitzung übernehmen darf: einen, den ihr Transkript nennt,
oder einen Halter desselben Pakets im selben Repo (`--package`, `--root` des Aufrufs), der seit `silenceMs` still ist. Eine
lebende fremde Sitzung und ihr Paket erscheinen dort nie.

## .claude/mcp-write-guard.js

| Code | Sperrt | Grund | Weg |
|---|---|---|---|
| POLICY_INVALID | schreibende MCP-Werkzeuge, solange .claude/mutation-policy.json ungültig ist | Gefahr G4: ohne gültige Politik ist keine Freigabe entscheidbar | Owner-Handlung O3 |
| MCP_WRITE_UNDECLARED | in einer Sitzung, die an einen Arbeitsschritt gebunden ist (Arbeitsagent mit KEEL_PACKAGE_SESSION oder Leaf-Bindung), jedes MCP-Werkzeug, das nicht in der MCP-Allowlist steht und nicht mit einem Lesewort beginnt oder irgendwo im Namen ein Schreibwort trägt (`search_and_replace`, `get_or_create`, `readAndUpdate`; Wörter an `_`, `-` und camelCase-Grenzen; ein Namensteil gilt auch als schreibend, wenn er mit einem langen Schreibwort beginnt oder endet: `replaceall`, `bulkdelete`, `overwrite`; kurze Schreibwörter zählen nur als ganzes Wort, `settings`, `posts`, `runs`, `address` bleiben lesend); jede andere Sitzung nutzt MCP frei, auch wenn im Repo ein fremdes Paket aktiv ist (Ausnahme: MCP_LOCAL_FILE_UNBOUND) | Gefahr G6: das Werkzeug wirkt in einem fremden Dienst | Owner-Handlung O3 |
| MCP_LOCAL_FILE_UNBOUND | in einer Sitzung ohne Bindung an einen Arbeitsschritt MCP-Werkzeuge mit lokalem Dateizugriff, deren Ziel paket-gate für diese Sitzung sperren würde (gleicher Maßstab: Ziel in einem Git-Repository ohne Leaf-Bindung, Planungs-, Änderungs- oder Orchestrator-Fix-Recht), unabhängig davon, ob ein Paket aktiv ist (Nachprüfung 07.10.2026); ein Ziel außerhalb jedes Repositorys bleibt frei, ohne Pfad in der Eingabe gilt der Ordner des Aufrufs. Lokale Dateiwerkzeuge: `apply_patch`, `str_replace`, `multi_edit`; jedes nicht lesende Werkzeug eines Servers, dessen Name ein Wort filesystem, fs, editor oder files trägt; und Werkzeuge mit einem Schreibwort edit, replace, create, write, delete, move, rename, insert oder apply im Namen, deren Eingabe einen Pfad nennt (path, file_path, filePath, relative_path, pathInProject, source, destination, ...): desktop-commander `edit_block`, serena `create_text_file` und `replace_regex`, jetbrains `replace_text_in_file`. Fremde Dienste (Drive, Trello, Mail) adressieren über Kennungen, nicht über Pfade, und bleiben frei; ein Eintrag in mcpWriteTools.allow geht vor | Gefahr G1: ein MCP-Dateiserver schreibt Produktdateien an paket-gate und write-guard vorbei | Write/Edit (paket-gate prüft dasselbe Ziel); eine Produktdatei über einen Arbeitsschritt eines Pakets (Kleinpaket oder Leaf) |
| MCP_SHELL_SURFACE | run_in_terminal und andere Shell-Oberflächen über MCP | Gefahr G4: ein Shell-Weg ohne Shell-Wächter | Bash- oder PowerShell-Werkzeug |
| SELF_MOVE | jede Selbstverschiebung der Sitzung (anderer Ordner, Worktree, Cloud) | Owner-Regel: „nie die eigene Sitzung verschieben“ (Owner-Auftrag des Pakets orchestrator-rules-enforcement) | in der eigenen Sitzung im Arbeitsordner bleiben; Arbeit an einem anderen Ort über einen eigenen Arbeitsauftrag |

## .claude/sessionpost-guard.js

| Code | Sperrt | Grund | Weg |
|---|---|---|---|
| Senden abgestellt | Nachrichten einer Sitzung direkt an eine andere Sitzung | Owner-Regel: „Senden ist ABGESTELLT“ (Owner-Entscheid 27.08.2026) | Notiz per /tell-session |

Alle anderen Aufrufe, auch `list_sessions`, lässt der Wächter durch. Die Sende-Sperre ist eine lebende
Owner-Entscheidung und bleibt. Weggefallen ist nur der Teil zu `list_sessions`; der Matcher
(`send_message|list_sessions`) bleibt bis zum Zurückziehen durch P5 eingetragen, und P5 darf nur den
`list_sessions`-Teil zurückziehen, nicht die Sende-Sperre.

## .claude/dod-guard.js

| Code | Sperrt | Grund | Weg |
|---|---|---|---|
| Abschlussformat | Fertig-Meldungen ohne Abschlusszeilen: die letzte Antwort einer Sitzung, die kein Arbeitsagent ist, behauptet Fertigsein über die eigene Arbeit (`harness-core/guards/done-claim.cjs`), und `Geprueft gegen:` oder `Offen:` fehlt (einmal je Zyklus); ein Arbeitsagent: Arbeit im Turn ohne die Zeilen | Owner-Regel: „Eine Arbeitsmeldung endet mit Geprueft gegen: und Offen:“ (CLAUDE.md, Owner 24.08.2026), seit 07.10.2026 für jede Sitzung nur beim Fertig-Anspruch | die Meldung mit „Geprueft gegen:“ und „Offen:“ beenden oder den Anspruch zurücknehmen |

Lesen (Paket P4, A15): dod-guard liest vom Gespräch nur das Ende, die letzten 512 KiB ab dem ersten vollständigen Zeilenanfang, und liest in
weiteren 512-KiB-Blöcken rückwärts nach, bis die letzte echte Nutzernachricht samt allem danach vorliegt. Das Urteil ist das der ganzen Datei.

## Rollen der Hooks ohne Sperrcode: unlazy-stop und Onboarding

unlazy-stop (`.claude/unlazy-stop.js`; Rollen, Owner 07.10.2026, guard-decisions E27): Der Host bestimmt die Rolle, ein Arbeitsagent trägt `KEEL_PACKAGE_SESSION`. Ein Arbeitsagent bekommt den
vollständigen Unlazy-Stop (Gates, Wellen, Sechser-Zähler). Jede andere Sitzung fragt ihn nie; gesperrt wird nur die Sitzung, die das Paket
orchestriert (Datensatz unter `.unlazy/.orchestrators`), und nur wenn ihre letzte Antwort Fertigsein behauptet, während Gates oder eine Welle
des aktiven, gestarteten Pakets offen sind (gestartet: eine Dispatch-Welle oder der Owner-Start in `.unlazy/<scope>/executor.json`, `ownerStart`). Das Stop-Format ist unverändert dem Unlazy-Hook überlassen; der Wächter hat keine eigenen Sperrcodes.

Onboarding (`.claude/onboarding-start.js`): Das Onboarding legt kein Paket an. Beim Sitzungsstart (nur `startup`, nie bei einem Arbeitsagenten) schlägt der Hook `/onboarding` vor, solange
`docs/harness-instance.md` noch `[AUSFUELLEN]` trägt; die Sitzung fragt den Menschen und schreibt nur das Installationsprofil, ohne Arbeitsschritt
(INSTANCE_PROFILE im Abschnitt .claude/paket-gate.js). Er sperrt nichts und hat keine Sperrcodes.

## .codex/apply-patch-guard.cjs

| Code | Sperrt | Grund | Weg |
|---|---|---|---|
| NOT_APPLY_PATCH | Aufrufe, die kein apply_patch sind, über den Patch-Weg | Gefahr G1: nur ein zerlegter Patch ist auf seine Ziele prüfbar | apply_patch im gültigen Format |
| INVALID_PATCH | Patches, die sich nicht eindeutig zerlegen lassen | Gefahr G1: ohne Zerlegung sind die Ziele unbekannt | einen gültigen Patch senden |
| PACKAGE_OWNS | Patch-Ziele, die paket-gate ablehnt (weitergereichte paket-gate-Entscheidung) | Gefahr G1: Schreiben außerhalb von Paketbindung und Leaf-OWNS | nur im eigenen Leaf-OWNS schreiben |
| WRITE_POLICY | Patch-Ziele oder Inhalte, die eine W-Regel des write-guard sperrt | Gefahr G1: es gilt der Grund der jeweiligen W-Regel (W1 bis W5) im Abschnitt .claude/write-guard.js | der Weg der jeweiligen W-Regel |

## Befehlsindex und Weg-Zeile (Paket P6, D17)

Owner (abends): „Wir haben keine vernünftige Indexierung der Git-Befehle, der Sachen, die auszuführen sind. Die Modelle versuchen immer noch, Sachen auszuführen, die sie dann nicht ausführen sollen.“ Jede Sitzung bekommt deshalb ein Verzeichnis, in dem sie vor dem Handeln nachsieht, wo alles liegt, was erlaubt ist und wie der Weg heißt.

- **Erzeuger:** `harness-core/guards/command-index.mjs`. Er schreibt nichts und ist als Prüfer in `VERIFIER_PATHS` des Shell-Wächters deklariert (`--compact`, `--full`, `--section "<Abschnitt>"`, `--json`, `--session <id>`). Er baut den Index aus den Regeln selbst: die Absichten und ihre Syntax aus `CANONICAL_INTENTS` (`git-intent.mjs`), die freien Git-Lesebefehle aus `READ_ONLY` des git-intent-guard, die Listen des Shell-Wächters (`VERIFIER_PATHS`, `READ_ONLY_COMMANDS`, `CANONICAL_MUTATION_PATHS`, `READ_ONLY_TOOL_COMMANDS`, `SERVICE_PATHS`, `GUARD_SELF_TESTS`, die Schalter von `node --test` und die Testdatei-Regel) samt den Ergänzungen aus `.claude/mutation-policy.json`, die Executor-Befehle aus `harness-core/execution/executor-commands.mjs` (daraus baut der Executor auch sein `--help`), den Mess-Prüfer (`MEASURE_USAGE`), den Temp-Ordner der Sitzung (P2) und die Orte (Pakete, Laufzeit, Owner-Politik). Ändert sich eine dieser Regeln, ändert sich der Index ohne Handarbeit; die Texte, die eine Regel nicht selbst trägt (Zweck einer Absicht, Weg einer Sperre), stehen genau einmal im Erzeuger und in `guard-routes.cjs`.
- **Sperrcode → Weg:** `harness-core/guards/guard-routes.cjs` ist die eine Tabelle, die die Wächter und der Index gemeinsam lesen. Jede Zeile nennt Abschnitt, Eintrag und den Weg in einem Satz. `test/command-index.test.js` liest die Sperrcodes aus den Quelltexten der Wächter und verlangt für jeden eine Zeile (und umgekehrt keine Zeile ohne Code), und er führt jeden Befehl, den der Index zeigt, durch den echten Shell-Wächter: ein Index, der einen gesperrten Weg nennt, fällt dort durch.
- **Weg-Zeile:** Jede Sperrmeldung aller Wächter trägt die Zeile `Weg: siehe Befehlsindex, Abschnitt <Abschnitt> -> <Eintrag> - <Weg>. Nachschlagen: node harness-core/guards/command-index.mjs --section "<Abschnitt>"`, zum Beispiel `Abschnitt Git -> checkpoint`. Die NEXT-Texte des Shell-Wächters widersprechen ihr nicht: SHELL_WRAPPER und DYNAMIC_WRAPPER schickten früher zu Write/Edit, obwohl ein Wrapper keine Schreibfrage ist; sie nennen jetzt den Befehl selbst im Bash- oder PowerShell-Werkzeug, INTERPRETER_EXECUTION und UNDECLARED_EXECUTABLE die endliche Liste, DYNAMIC_EVALUATION den ausgeschriebenen Befehl.
- **Laden:** beim Sitzungsstart über `session-roles.js` als zusätzlicher Kontext, bei allen vier Anlässen (startup, resume, clear, compact), vor der Rollen-Tabelle, weil der Host zu langen Hook-Kontext am Ende kappt. Codex führt denselben Hook über `.codex/hooks.json` und die Liste des `hook-runner.cjs` aus. Die kompakte Form bleibt unter 6.000 Zeichen (`COMPACT_LIMIT`), auch bei langen Owner-Listen (die Listen schrumpfen auf Zahlen, dann die Prüfer auf Ordner, auf eine Zahl und zuletzt auf einen Verweis); was nicht passt, steht in `--full`. Der Auftrag eines Arbeitsagenten nutzt die Form ohne dieses Schrumpfen (`unbounded`). Der Text ist reines ASCII, weil Codex Hooks über Windows PowerShell startet und alles andere umkodiert. Lässt sich der Index nicht erzeugen, meldet das der Hook (stderr und eine Zeile im Kontext, Rückgabe 0, weil der Host das JSON nur dann auswertet), er schweigt nicht.
- **Arbeitsagenten:** `writeBrief` des Executors trägt feste Abschnitte (`harness-core/execution/brief-sections.mjs`): den Befehlsindex, die Freigaben des Owners aus `.claude/mutation-policy.json` (`mcpWriteTools.allow`, `productRoots`, `publishProjects`, genau die Listen der Datei; bei ungültiger Datei steht das da und keine Freigabe), die Prüfung von Owner-Aussagen (D8), den Veröffentlichungsweg (C8, für jedes Projekt aus `publishProjects` der Weg aus P3), die Ausführungsregeln (lange Tests im Vordergrund C9, Build und Test getrennt, nie selbst committen, ein Rücklauf ohne Änderung ist kein Erfolg C4, dieselbe Sperre dreimal heißt Halt P12) und bei `restart` und `reopen` die Begründung in einem eigenen Abschnitt vor dem Originalauftrag (C3; sie steht im Datensatz der Sitzung und überlebt jedes erneute Schreiben des Auftrags). Kein Abschnitt wird auf eine Länge gekürzt.

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
| O3 | Änderungen an .claude/mutation-policy.json samt MCP-Allowlist, productRoots und publishProjects (die Eintragung eines Projekts ist das allgemeine Publish-OK des Owners) | `write-guard.js:W4` `mcp-write-guard.js:MCP_WRITE_UNDECLARED` `mcp-write-guard.js:POLICY_INVALID` `shell-mutation-guard.js:POLICY_INVALID` | Owner-Regel (CLAUDE.md): „Owner-Erweiterungen und MCP-Allowlist in .claude/mutation-policy.json“ | Befehl: `write-guard.js:W4`, `mcp-write-guard.js:MCP_WRITE_UNDECLARED`; Satz: `mcp-write-guard.js:POLICY_INVALID`, `shell-mutation-guard.js:POLICY_INVALID` |
| O4 | Zugangsdaten anlegen oder ändern | `write-guard.js:W2` | Owner-Regel (CLAUDE.md): „Zugangsdaten, lokale Freigaben und settings.local.json werden nie versioniert oder ausgeliefert.“ | Satz |
| O5 | Zustimmung des Owners für close und publish oder Release, aus dem Gesprächszusammenhang gelesen (publish eines Projekts aus publishProjects braucht keine) | kein Wächter; close und publish legen die Owner-Nachricht als wörtliches Zitat ab (Owner-OK-Eintrag), ohne Längengrenze und ohne Satzform | Owner-Regel (CLAUDE.md): „der Owner sagt im Chat OK“; Owner 05.10.2026: „ich werde dir nie den einen wörtlichen Satz geben für irgendwas. Du musst Sachen aus dem Kontext herauslesen.“ | Kontext |
| O6 | Zustimmung des Owners für Änderungen an den Harness-Dateien einer Installation und für das Harness-Update, aus dem Gesprächszusammenhang gelesen; danach führt der Agent aus | write-guard W5, Weg nach E19 | Owner-Auftrag des Pakets guard-scope R10; Regel D16: kein vorgeschriebener Satz | Kontext |
| O7 | Entfernen, Zusammenlegen oder Verstecken nur, was ein Owner-Auftrag im Kontext deckt, belegt mit seinem Zitat | kein Wächter | Owner-Regel (Werkbank-Regeldatei owner-rules.md): „Entfernen nur, wenn ein Owner-Auftrag es deckt“, mit Zitat (D16) | Kontext |
| O8 | Freigabe eines Codex-Hooks mit /hooks in seiner eigenen Codex-Sitzung (B23) | kein Wächter; Codex selbst verlangt die Freigabe | Codex-Doku hooks: „Use `/hooks` in the CLI to … review new or changed hooks, trust hooks“ | Klickfolge |

Zustimmung des Owners (O5 bis O7) wird nie als Satzform verlangt oder erfragt (D16, Owner 05.10.2026: „ich werde dir nie den einen wörtlichen Satz geben für irgendwas. Du musst Sachen aus dem Kontext herauslesen.“). Der Agent liest die Zustimmung aus dem Gesprächszusammenhang, beurteilt dort, ob sie die Handlung deckt, und legt die tatsächliche Owner-Nachricht als wörtliches Zitat samt Zeitpunkt ab: bei close, publish und duty-waive als Owner-OK-Eintrag (`owner-ok.mjs`: Kurzform in einer Zeile, sonst Zitatblock; keine Längengrenze, Zeilenumbrüche und Anführungszeichen erlaubt, `--owner-ok` oder `--owner-ok-file`), beim Start als `Owner-Start:`- oder `Owner-Go:`-Eintrag im Status (`owner-start.mjs`). Geprüft wird nur, dass das Zitat nicht leer ist; weder Paketname noch Version noch eine Formel müssen darin vorkommen.
