# Guard coverage

Stand: 2026-10-01; die Zusagen der Shell-Mutationsgrenze (fail-closed bei
Ladefehler/ungültiger Eingabe, Werkzeugnamen-Unabhängigkeit, Geltung ohne aktives
Paket) am 2026-09-09 ergänzt. Den Zuschnitt je Wächter (was er sperrt, warum,
welcher Weg bleibt und welche Handlungen allein der Owner darf) beschreibt
docs/guard-scope.md. Maßgeblich sind die aktiven Host-Konfigurationen,
Package-Lifecycle-Funktionen und ausführbaren Tests. Injizierte Prosa wird nie
als technischer Zwang gezählt.

| Lebenszykluspunkt | Claude Code | Codex | Technischer Besitzer |
|---|---|---|---|
| SessionStart | fünf native Hooks, zuletzt `dashboard-ensure.js` | die ersten vier Programme über den root-bewussten Adapter, ohne `dashboard-ensure.js` | Rollen, Onboarding, Projektkontext, Verschmutzungswarnung; Dashboard-Start, wenn es nicht läuft (nur mit Runtime-Archiv, abschaltbar mit `KEEL_DASHBOARD_AUTOSTART=0`) |
| UserPromptSubmit | `prompt-form.js` | dasselbe Programm über `.codex/hook-runner.cjs` | knappe Kommunikation und Anzeige der bereits gebundenen Identität |
| Shell vor Ausführung | `git-intent-guard.js`, dann `shell-mutation-guard.js`, dann `danger-guard.js`, für `Bash` und `PowerShell` | identische Reihenfolge für `Bash`, `exec_command`, `shell` und `local_shell` | endliche Git-Intents; endliche Shell-Mutationsgrenze (deklarierte Prüfer, Tests, Dienste); Schutz vor sonstiger Zerstörung. Frei bleibt harmlose Arbeit nach docs/guard-scope.md: Git-Lesebefehle, Versionsabfragen, Zusammenführen und Verwerfen von Ausgabeströmen, Schleifen über lesende Befehle, lesende package-cli-Unterbefehle sowie `rm`, `mkdir` und `mv` im gebundenen `OWNS` |
| Dateischreibung vor Ausführung | `write-guard.js` und `paket-gate.js` für Write/Edit | `apply-patch-guard.cjs` zerlegt Add/Update/Delete/Move und prüft jeden Pfad durch beide gemeinsamen Guards | erlaubte Wurzel, Secrets, exakte Repo/Paket/Session/Leaf-Bindung und `OWNS` |
| MCP-Werkzeug vor Ausführung | `mcp-write-guard.js` für `mcp__.*` und `EnterWorktree`; `sessionpost-guard.js` für das Senden zwischen Sitzungen | dieselben Programme über `.codex/hook-runner.cjs`, `mcp-write-guard.js` für `^mcp__` | App-Werkzeuge sind immer frei; `run_in_terminal` (MCP_SHELL_SURFACE) und Selbst-Verschieben (SELF_MOVE) sind gesperrt; alles andere fällt bei aktivem Paket unter Lese-Verben oder die Owner-Allowlist, sonst fail-closed |
| Owner-Vorlage nur für Owner-Handlungen | alle Wächter nutzen `harness-core/guards/owner-handoff.cjs` | dieselben Programme | Satz, Warnzeile und einzeiliger bash-Block mit Ausführen-Knopf (in PowerShell ausgeführt) gibt es nur für die Handlungen, die allein der Owner darf (docs/guard-scope.md); jede andere Sperre nennt den Agentenweg ohne Befehl |
| Owner-Politik | `.claude/mutation-policy.json` (nur der Owner; write-guard W4) | dieselbe Datei | Owner-Erweiterungen der endlichen Shell-Grenze und die MCP-Allowlist; ungültige Einträge sperren fail-closed |
| Werkzeug nach Ausführung | Claude-DoD liest seinen Host-Turn | `dod-guard.cjs` merkt stabile PostToolUse-Arbeitsfakten | Berichtsformat, nicht Paket-Fulfillment |
| Stop | vollständiger Unlazy-Stop, DoD, lokaler Backup-Hinweis | dieselbe Reihenfolge; Codex-DoD nutzt `last_assistant_message` | offene Gates/Leaves/Waves blockieren; Bericht und Warnung bleiben getrennt |
| Paketaktivierung | colspan | colspan | Schema bindet Originalauftrag, PIG, R→C→Gate, Depth Tree und disjunkte `OWNS` vor Arbeit |
| Fan-out/Return | colspan | colspan | Claims, Leases, versiegelte Dispatch-Wellen, exakte native Handles und lokale Leaf-Reverify |
| Integration/Close | colspan | colspan | einmaliger Integrations-Checkpoint, Node→Root-Reverify, Coverage/Fulfillment und Close-Receipt |
| Auslieferung | colspan | colspan | Hash-Manifest, konfliktblockierender Installer, Installer-Onboarding-Paket und Frischinstallation |

Die beiden `colspan`-Zeilen bedeuten keine HTML-Funktion. Sie markieren bewusst
hostunabhängige Produktmechanik: Claude und Codex rufen denselben Package-
Executor und dieselbe vendorte Unlazy-Runtime auf.

## Belegte Gegenproben

- `test/shell-mutation-boundary.test.js` prüft die endliche Shell-Mutationsgrenze:
  Redirection/Direktschreiben/Interpreter/undeklarierte Skripte blockieren ohne
  Filesystem- oder Git-Änderung, deklarierte Prüfer/Tests/Dienste bleiben erreichbar,
  die Grenze greift auch ohne aktives Paket (H6), fällt fail-closed bei fehlender
  Abhängigkeit und ungültiger Eingabe (Exit 2) und blockiert unabhängig vom
  Werkzeugnamen (`Bash`/`shell`/fehlend).
- `test/guard-handoff.test.js` prüft an echten Hook-Prozessen, dass nur die
  Owner-Handlungen aus docs/guard-scope.md einen einzeiligen bash-Block tragen,
  den Windows PowerShell genau so ausführt, und jede andere Sperre den
  Agentenweg ohne Befehl nennt.
- `test/guard-parity.test.js` prüft, dass jede Risikoklasse für Bash und das
  PowerShell-Werkzeug gleich entschieden wird.
- `test/mcp-write-guard.test.js` prüft App-Werkzeuge, Rückkehr, Selbst-
  Verschieben, Terminal-Werkzeuge und die Owner-Allowlist im echten Hook-Prozess.
- `test/guard-lifecycle.test.js` führt die gemeinsamen Hook-Selbsttests und
  Lifecycle-Smokes begrenzt aus.
- `test/codex-hooks.test.js` prüft native Codex-Felder, Root-Auflösung sowie
  Add/Update/Delete/Move, Secret-Block und Leaf-`OWNS`.
- `test/git-intent.test.js` prüft erlaubte Intents, Recovery und den frühen
  Block roher mutierender Git-Alternativen.
- `test/endgoal-e2e.test.js` prüft Repo-Grenzen, stale Evidence, Timeout, Crash,
  Abbruch, fehlende Referenz, Legacy und Ownership-Überlappung.
- `standalone/checks/fresh-install.mjs` führt die installierten Hooks, ein echtes
  Paket und den Codex-`apply_patch`-Block aus einem Unterordner aus.

## Ehrliche Grenzen

- Hooks koordinieren Claude Code und Codex; sie sind keine Betriebssystem-
  Sandbox. Direkte Prozesse außerhalb dieser Hosts bleiben Aufgabe der
  jeweiligen Sandbox und der Owner-Freigaben.
- Ein manuelles Gate kann menschliches Urteil dokumentieren, aber nicht in eine
  automatisch gemessene Tatsache verwandeln.
- `uncommitted-warn.js` warnt absichtlich und verändert oder blockiert nichts.
- Der Legacy-Migrator bleibt bis zum im vendorten Unlazy dokumentierten
  2026-10-31 explizit aufrufbar. Produktive Discovery besitzt keinen
  automatischen Flatfile-Fallback.
