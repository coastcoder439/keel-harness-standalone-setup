# Guard coverage

Stand: 2026-08-30; die Zusagen der Shell-Mutationsgrenze (fail-closed bei
Ladefehler/ungültiger Eingabe, Werkzeugnamen-Unabhängigkeit, Geltung ohne aktives
Paket) am 2026-09-09 ergänzt. Maßgeblich sind die aktiven Host-Konfigurationen,
Package-Lifecycle-Funktionen und ausführbaren Tests. Injizierte Prosa wird nie
als technischer Zwang gezählt.

| Lebenszykluspunkt | Claude Code | Codex | Technischer Besitzer |
|---|---|---|---|
| SessionStart | vier native Hooks | dieselben vier Programme über den root-bewussten Adapter | Rollen, Onboarding, Projektkontext, Verschmutzungswarnung |
| UserPromptSubmit | `prompt-form.js` | dasselbe Programm über `.codex/hook-runner.cjs` | knappe Kommunikation und Anzeige der bereits gebundenen Identität |
| Shell vor Ausführung | `git-intent-guard.js`, dann `shell-mutation-guard.js`, dann `danger-guard.js` | identische Reihenfolge für `Bash` | endliche Git-Intents; endliche Shell-Mutationsgrenze (deklarierte Prüfer, Tests, Dienste); Schutz vor sonstiger Zerstörung |
| Dateischreibung vor Ausführung | `write-guard.js` und `paket-gate.js` für Write/Edit | `apply-patch-guard.cjs` zerlegt Add/Update/Delete/Move und prüft jeden Pfad durch beide gemeinsamen Guards | erlaubte Wurzel, Secrets, exakte Repo/Paket/Session/Leaf-Bindung und `OWNS` |
| MCP-Werkzeug vor Ausführung | `mcp-write-guard.js` für `mcp__*` | dasselbe Programm über `.codex/hook-runner.cjs` für `^mcp__` | bei aktivem Paket nur Lese-Verben oder exakt vom Owner allowlistete Werkzeuge, sonst fail-closed |
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
