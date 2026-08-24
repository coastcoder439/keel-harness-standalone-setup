# Guard-Abdeckung — jede Regel erzwungen oder ehrlich „nur Prosa"

Gemessen 24.08.2026 (Haertegrad-Analyse; Belege: `.claude/settings.json`,
Selbsttests der Waechter). Jede Regel des Harness traegt hier ihren Stempel:
**Code** (deterministisch erzwungen, unumgehbar) oder **Prosa** (Urteils-Verhalten,
per Grundsatz 5 bewusst NICHT erzwingbar — reiner Text hat H4 als Maximum).

| Regel | Stempel | Erzwungen durch | Beleg |
|---|---|---|---|
| Keine zerstoerenden Befehle | **Code** | `danger-guard.js` (Bash) | `--selbsttest` 14/14 |
| Schreiben nur in erlaubte Wurzeln | **Code** | `danger-guard.js` (Bash) + `write-guard.js` W1 (Write/Edit) | `--selbsttest` 8/8 |
| Workspace-Commit nur mit pathspec | **Code** | `commit-pathspec-guard.js` | Kopf: Vorfall e37b798 |
| Kein Werkbank-Commit mit Projekt-Repo-Pfad | **Code** | `git-guard.js` (Block-Fall, Owner-Freigabe 24.08.) | `--selbsttest` 6/6 |
| Keine Zugaenge in Dateien | **Code** | `write-guard.js` W2 (Wert-Muster) | `--selbsttest` 8/8 |
| Erst Repo gepusht, dann .gitignore-Zeile | **Code** | `write-guard.js` W3 | `--selbsttest` 8/8 |
| Inter-Session-Nachrichten knapp (3 Zeilen) | **Code** | `sessionpost-guard.js` | settings.json Matcher |
| Sicherungs-Warnung am Sitzungsende | **Code** (meldet) | `uncommitted-warn.js` | Stop-Hook, blockt nie (Design) |
| Kontext-Check als erste Handlung | **Prosa** | `project-context.js` (Injektion) | Text ≠ Tool-Aufruf, nicht gate-bar |
| Kein One-Shot, erst pruefen | **Prosa** | `rules/keel/no-oneshot.md` | Aussagen sind nicht gate-bar (03.08.) |
| Zieldefinition + zwei Abschluss-Messungen | **Prosa** | `rules/keel/working-method.md` | Urteils-Verhalten |
| CLI vor MCP vor Browser | **Prosa** | `rules/keel/tools.md` | Urteils-Verhalten |
| Antwortform (ADHD) | **Prosa** | Skill `i-have-adhd` (laedt via `session-roles.js`) | Text ≠ Tool-Aufruf |

Grenzen der Code-Stempel (ehrlich): Waechter sehen Bash und die Editier-Werkzeuge —
nicht, was ein Skript zur Laufzeit selbst schreibt (`node x.js`, das intern Dateien
anlegt, laeuft durch). Kaputtes Hook-JSON ist fail-open (alle Waechter). W2 kennt
Wert-FORMATE, keine beliebigen Geheimnisse.

Pflege: neue Regel => hier eine Zeile mit Stempel, ehe sie gilt. Eine Regel ohne
Zeile hier ist ein Fund.
