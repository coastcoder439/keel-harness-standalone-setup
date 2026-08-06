# flowcode-harness-standalone

Dies ist der **Standalone-Keel-Harness**: eine Claude-Code-Ausstattung — Wächter-Hooks,
Dauer-Regeln, Befehle, Skills —, die eine Claude-Code-Session diszipliniert arbeiten lässt.
Kein Produkt, kein Framework. Ein Bausatz, der in einen Zielordner installiert wird.

## Loslegen — drei Schritte

1. **Klonen:**
   ```
   git clone https://github.com/leonpoesken/flowcode-harness-standalone.git
   ```
2. **Claude Code IM geklonten Ordner öffnen** (nicht daneben, nicht darüber).
3. Der ersten Session einfach schreiben:
   ```
   Lies CLAUDE.md und leg los
   ```
   Diese erste Session ist die **Harness Control**. Sie führt zusammen mit dir das
   Onboarding in einen Zielordner — dort entsteht der eigentliche Arbeits-Harness.

## Warnung — dieses Repo ist generiert

Der Inhalt hier entsteht automatisch aus der Werkbank (Quell-Commit: `b90d1fb`).
**Handänderungen an diesem Repo werden beim nächsten Generator-Lauf überschrieben.**
Wer etwas ändern will, ändert es an der Quelle in der Werkbank — nicht hier.

## Was danach existiert

Nach abgeschlossenem Onboarding hat der Zielordner:

- einen eingerichteten `.claude/`-Workspace (Wächter, Regeln, Befehle, Skills installiert)
- die erste echte Arbeits-Session in diesem Workspace
- `/repo-status` als Kontrollbefehl, um den Stand jederzeit zu prüfen

Diese Harness-Control-Session hier im Bausatz-Repo ist danach fertig.

## Voraussetzungen

- Claude Code installiert
- Node ≥ 18
- Git

## Enthalten

| Teil | Zweck |
|---|---|
| `harness/` | Die Nutzlast: `.claude` mit Wächter-Hooks, 4 Dauer-Regeln, Befehlen (`/repo-status`, `/save-work`, `/session-map`), Skills, `settings.json`- und `CLAUDE.md`-Vorlagen |
| `onboarding.mjs` | Installiert die Nutzlast in einen Zielordner (fragt selbst nichts ab) |
| `pruefung/frisch-geklont.mjs` | Abnahmetest |
| `LIESMICH.md` | Technische Paket-Anleitung |
| `PAKET.json` | Paket-Metadaten |

Details zur technischen Installation stehen in `LIESMICH.md`.
