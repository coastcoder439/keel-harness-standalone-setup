# keel-harness-standalone

Dies ist der **Standalone-Keel-Harness**: eine Claude-Code-Ausstattung — Wächter-Hooks,
Dauer-Regeln, Befehle, Skills —, die eine Claude-Code-Session diszipliniert arbeiten lässt.
Kein Produkt, kein Framework. Ein Bausatz, der in einen Harness-Ordner installiert wird.

## Zwei Pfade, eine Regel

| | Was | Wo |
|---|---|---|
| `<PAKET>` | dieser Bausatz (Installer + Nutzlast) | irgendwo — z. B. Downloads. **Nicht** im Harness-Ordner. |
| `<HARNESS>` | dein Workspace, in dem du danach arbeitest | neuer leerer Ordner oder bestehendes Projekt |

**Nur `<HARNESS>` zählt.** Der Bausatz wird per Pfad angesprochen und ist nach dem
Onboarding entbehrlich. Von wo aus du Claude Code startest, ist egal — jeder Befehl nennt
beide Pfade ausdrücklich. Sinnvoll ist `<HARNESS>`, weil du dort weiterarbeitest.

Beispiel:

| | Windows | macOS / Linux |
|---|---|---|
| `<PAKET>` | `C:\Users\du\Downloads\keel-harness-standalone` | `~/Downloads/keel-harness-standalone` |
| `<HARNESS>` | `C:\Users\du\WORKSPACES\mein-workspace` | `~/workspaces/mein-workspace` |

## Loslegen — drei Schritte

1. **Klonen, irgendwohin außerhalb des Harness-Ordners:**
   ```
   git clone https://github.com/coastcoder439/keel-harness-standalone.git <PAKET>
   ```
2. **Claude Code öffnen** — am besten in `<HARNESS>` (den Ordner vorher anlegen, wenn er
   neu ist).
3. **Der Session schreiben** (Pfade einsetzen):
   ```
   Lies <PAKET>/ONBOARDING-FUER-CLAUDE.md und richte den Harness in <HARNESS> ein.
   ```
   Claude führt dann das Onboarding **mit dir** durch: Trockenlauf, Echtlauf, Platzhalter
   ausfüllen, Commit. Danach: Claude Code neu starten, `<HARNESS>` öffnen, `/repo-status`.

Ohne Claude, von Hand: `PAKET-ANLEITUNG.md` — fünf Schritte, dieselben Befehle.

## Was danach existiert

In `<HARNESS>`:

- ein eingerichteter `.claude/`-Workspace (Wächter, Regeln, Befehle, Skills, `settings.json`)
- eine `CLAUDE.md` mit `[?]`-Platzhaltern, die du ausgefüllt hast
- `/repo-status` als Kontrollbefehl, um den Stand jederzeit zu prüfen
- **kein** Bestandteil des Bausatzes — der bleibt in `<PAKET>` und kann gelöscht werden

## Warnung — dieses Repo ist generiert

Der Inhalt hier entsteht automatisch aus der Werkbank (Quell-Commit: `e165ec6`).
**Handänderungen an diesem Repo werden beim nächsten Generator-Lauf überschrieben.**
Wer etwas ändern will, ändert es an der Quelle in der Werkbank — nicht hier.

> **Ausnahme, 2026-08-18:** README, PAKET-ANLEITUNG und ONBOARDING-FUER-CLAUDE wurden von
> Hand auf das Modell „ein Ordner zählt" umgestellt; die Paket-`CLAUDE.md` ist entfallen.
> Begründung und Änderungsliste für die Werkbank: `AENDERUNGEN-ANLEITUNG-2026-08-18.md`.
> Bis die Werkbank nachgezogen ist, überschreibt der Generator diese Änderungen.

## Voraussetzungen

- Claude Code installiert (für den geführten Weg; der Weg von Hand braucht es nicht)
- Node ≥ 18
- Git

## Enthalten

| Teil | Zweck |
|---|---|
| `harness/` | Die Nutzlast: `.claude` mit Wächter-Hooks, Dauer-Regeln, Befehlen (`/repo-status`, `/save-work`, `/session-map`, `/tell-session`), Skills |
| `vorlagen/` | `CLAUDE.md`, `settings.json` und der `.gitignore`-Block, die ins Ziel geschrieben werden |
| `zustand/`, `oberflaeche/` | Zustandsseite: Messung und gebaute Hülle |
| `beileger/`, `lizenzen/` | Langfassungen, auf die die Regeln verweisen; Lizenzen der übernommenen Skills |
| `onboarding.mjs` | Installiert die Nutzlast nach `<HARNESS>` (fragt selbst nichts ab, löscht nichts) |
| `ONBOARDING-FUER-CLAUDE.md` | Die Anweisung, die du einer Claude-Code-Session vorlegst |
| `PAKET-ANLEITUNG.md` | Dieselben Schritte von Hand, mit Fehlertabelle |
| `pruefung/frisch-geklont.mjs` | Abnahmetest des Pakets |
| `PAKET.json` | Stückliste: jede Datei mit Herkunft, Größe, Prüfsumme; darunter, was bewusst fehlt |
