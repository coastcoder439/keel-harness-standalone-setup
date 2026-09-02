# Guard coverage

Stand: 2026-08-30. Maßgeblich sind die aktiven Host-Konfigurationen,
Package-Lifecycle-Funktionen und ausführbaren Tests. Injizierte Prosa wird nie
als technischer Zwang gezählt.

| Lebenszykluspunkt | Claude Code | Codex | Technischer Besitzer |
|---|---|---|---|
| SessionStart | vier native Hooks | dieselben vier Programme über den root-bewussten Adapter | Rollen, Onboarding, Projektkontext, Verschmutzungswarnung |
| UserPromptSubmit | `prompt-form.js` | dasselbe Programm über `.codex/hook-runner.cjs` | knappe Kommunikation und Anzeige der bereits gebundenen Identität |
| Shell vor Ausführung | `git-intent-guard.js`, danach `danger-guard.js` | identische Reihenfolge für `Bash` | endliche Git-Intents; Schutz vor sonstiger Zerstörung |
| Dateischreibung vor Ausführung | `write-guard.js` und `paket-gate.js` für Write/Edit | `apply-patch-guard.cjs` zerlegt Add/Update/Delete/Move und prüft jeden Pfad durch beide gemeinsamen Guards | erlaubte Wurzel, Secrets, exakte Repo/Paket/Session/Leaf-Bindung und `OWNS` |
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
