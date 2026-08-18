# Entwurf: Anleitung des Standalone-Harness neu angelegt

Stand: 2026-08-18 · bezieht sich auf das generierte Paket aus Werkbank-Commit `e165ec6`
(PAKET.json gebaut 2026-08-06). Dieser Ordner ist ein **Vorschlag für die Werkbank**, kein
Eingriff ins generierte Repo.

Enthalten:

| Datei | Ersetzt im Paket |
|---|---|
| `README.md` | `README.md` |
| `PAKET-ANLEITUNG.md` | `PAKET-ANLEITUNG.md` |
| `ONBOARDING-FUER-CLAUDE.md` | die bisherige Paket-`CLAUDE.md` (die entfällt ersatzlos) |
| diese Datei | — (Begründung, Änderungsliste, Abnahmetest) |

---

## 1. Das Modell, auf das alles umgestellt ist

**Ein Ordner zählt: der Harness-Ordner.** Alles andere ist Werkzeug oder Zufall.

| Größe | Rolle | Regel |
|---|---|---|
| **Harness-Ordner** `<HARNESS>` | Der Workspace, in dem gearbeitet wird. Hier landet die Nutzlast, hier läuft danach jede Sitzung. | Wird in **jedem** Befehl explizit genannt (`--ziel <HARNESS>`, `git -C <HARNESS>`). |
| **Paket** `<PAKET>` | Der geklonte/heruntergeladene Bausatz. Ein Installer plus Nutzlast. | Liegt **irgendwo außerhalb** von `<HARNESS>` (typisch: Downloads). Wird nur per Pfad angesprochen. Ist nach dem Onboarding entbehrlich. |
| **Sitzungs-Ort** | Wo Claude Code gerade geöffnet ist. | **Spielt keine Rolle.** Kein Schritt hängt vom aktuellen Verzeichnis ab. Empfohlen ist `<HARNESS>`, weil dort weitergearbeitet und neu gestartet wird — vorausgesetzt wird es nirgends. |

Zwei Verbote, die aus dem Modell folgen:

1. `<PAKET>` liegt nie in `<HARNESS>` und `<HARNESS>` nie in `<PAKET>`.
2. Im Paket liegt **keine `CLAUDE.md`**. Eine `CLAUDE.md` lädt sich per Ordner selbst und macht damit den Ordner zum operativen Ort — genau das, was das Paket nicht sein darf. Die Anweisung für Claude ist ein gewöhnliches Dokument, auf das der Mensch zeigt.

## 2. Was am bisherigen Stand falsch angelegt war

Nicht Formulierungen, sondern das Modell: die bisherige Anleitung macht den **Ort des Pakets** zum operativen Ort.

| Bisher | Wirkung | Im Entwurf |
|---|---|---|
| README: „Claude Code **im geklonten Ordner** öffnen (nicht daneben, nicht darüber)" | Sitzung muss im Download laufen. Wer im Harness-Ordner arbeiten will, muss das Paket dorthin kopieren — dann liegen Installer, `harness/`, `vorlagen/`, `pruefung/`, `PAKET.json` … dauerhaft im Harness und in dessen Git-Historie. | Sitzung irgendwo, empfohlen `<HARNESS>`. Paket bleibt, wo es ist. |
| `CLAUDE.md` im Paket = Rolle „Harness Control" | Koppelt eine Rolle an den Paketordner. Liegt das Paket im Harness-Ordner, verhindert diese Datei Schritt [7] des Installers („CLAUDE.md nur wenn keine da ist") — die echte `CLAUDE.md` mit den `[?]` wird nie installiert, der Harness trägt dauerhaft die Onboarding-Rolle, jede neue Sitzung dort beginnt wieder als Onboarding-Konsole. | Keine `CLAUDE.md` im Paket. Stattdessen `ONBOARDING-FUER-CLAUDE.md`, per Pfad vorgelegt. |
| Schritt 7: „Harness-Control-Session schließen, neue Session im Ziel öffnen" | Zwei Ordner, zwei Sitzungen, eine wird weggeworfen. | Eine Sitzung. Nach dem Commit: Claude Code neu starten, **selben** Ordner öffnen. |
| PAKET-ANLEITUNG: `cd <paket-ordner>` … `cd /pfad/zu/deinem/workspace` | Befehle hängen vom aktuellen Verzeichnis ab; Unix-Pfade ohne Windows-Gegenstück. | Jeder Befehl nennt beide Pfade; `git -C <HARNESS>`; Windows und Unix nebeneinander. |

Das Werkzeug selbst passt bereits zum Modell: `onboarding.mjs` nimmt `--paket` und `--ziel` als Pfade und braucht kein bestimmtes Arbeitsverzeichnis. Die Anleitung widersprach ihrem eigenen Installer.

## 3. Änderungen an der Werkbank (Quelle), die der Entwurf voraussetzt

### 3a. Text (dieser Entwurf)

- `README.md` ersetzen.
- `PAKET-ANLEITUNG.md` ersetzen. Verweise auf `LIESMICH.md` (README, PAKET.json-Posten) auf den tatsächlichen Namen bringen — **ein** Name, überall.
- Paket-`CLAUDE.md` aus dem Generator streichen; `ONBOARDING-FUER-CLAUDE.md` als neuen Posten aufnehmen (und in `PAKET.json` zählen).
- `pruefung/frisch-geklont.mjs` gegenlesen: prüft er auf das Vorhandensein einer Paket-`CLAUDE.md`, muss die Prüfung auf `ONBOARDING-FUER-CLAUDE.md` umgestellt werden.
- Klon-URL in der README: bisher `github.com/leonpoesken/keel-harness-standalone.git`, das tatsächliche Repo liegt unter `coastcoder439/`. Der Entwurf trägt `coastcoder439`; die Werkbank sollte die URL aus einer Stelle beziehen.

### 3b. Code (`onboarding.mjs`)

| Zeile | Befund | Änderung |
|---|---|---|
| 53 | `path.dirname(decodeURIComponent(new URL(import.meta.url).pathname))` liefert auf Windows `/C:/…` — der Rückfall auf den eigenen Ordner scheitert, `--paket` wird Pflicht. | `import { fileURLToPath } from "node:url"; const HIER = path.dirname(fileURLToPath(import.meta.url));` |
| 158–161 | `SKILLS` enthält nur `domain-modeling` und `resolving-merge-conflicts`. `harness/.claude/skills/i-have-adhd/SKILL.md` liegt im Paket, wird aber nicht installiert — obwohl `ausgabeform.md` (installierte Dauer-Regel), `session-roles.js` (`/i-have-adhd` beim Start) und die PAKET-ANLEITUNG („3 Skills") ihn voraussetzen. Der `.gitignore`-Block schaltet ihn ebenfalls nicht frei. | `["i-have-adhd", ["SKILL.md"]]` ergänzen; `vorlagen/gitignore-block.txt` um `!.claude/skills/i-have-adhd/` erweitern. Oder die drei Verweise entfernen — aber nicht der jetzige Zwischenzustand. |
| `erlaubteWurzeln()` in `harness/.claude/danger-guard.js` | Erlaubt ab Werk `/tmp`, `/private/tmp`, `/var/folders`, `~/.claude`. Kein Windows-Temp. | `os.tmpdir()` aufnehmen (deckt `%TEMP%` und die Unix-Fälle ab). |
| Schritt [7] | „CLAUDE.md — nur wenn keine da ist" bleibt richtig. Zusätzlich sinnvoll: eine Vorprüfung, die abbricht (RC 2), wenn `<PAKET>` innerhalb von `<HARNESS>` liegt oder umgekehrt — dann kann der Fall „Paket im Harness" gar nicht erst entstehen. | Optional, aber billig. |

Die Befehle im Entwurf geben `--paket <PAKET>` **immer** an — bewusst, nicht als Notbehelf: zwei ausgeschriebene Pfade lesen auf jedem System gleich und lassen keinen Spielraum, wo etwas landet. PAKET-ANLEITUNG und ONBOARDING-FUER-CLAUDE tragen zusätzlich einen markierten **Windows-Hinweis**, der erklärt, warum der Schalter dort derzeit Pflicht ist (Zeile 53). Nach der Korrektur in der Werkbank entfällt nur dieser Absatz; die Befehle bleiben.

## 3c. Belege (2026-08-18, Windows 11, Node 24.16, Paket in `Downloads`, cwd = `%USERPROFILE%`)

- Ohne `--paket`, `--trocken` in leeren Scratch-Ordner → RC 2:
  `ABBRUCH: Paket nicht gefunden (gesucht: … /C:/Users/…/keel-harness-standalone · C:\C:\Users\…\paket …)`.
  Das ist Zeile 53.
- Mit `--paket <PAKET> --ziel <leerer Ordner> --trocken` → RC 0, 35 Posten,
  **`[7] CLAUDE.md wuerde anlegen`**. Das Modell „Paket außerhalb, Sitzungs-Ort egal,
  nur der Harness-Ordner zählt" funktioniert mit dem heutigen Werkzeug — es fehlte nur die
  Anleitung dazu.

## 4. Abnahmetest — Schritt „1" aus dem Gespräch, jetzt in der richtigen Reihenfolge

Der Test führt den Entwurf **wörtlich** aus. Weicht der Ablauf ab, ist der Entwurf falsch, nicht der Ordner.

**Vorbereitung (destruktiv, Entscheidung des Menschen):**
`C:\Users\Lonsinator\WORKSPACES\keel-harness-standalone-test` leeren — inklusive `.git`. Der Ordner ist heute ein Hybrid aus Paket und Installation; nur ein leerer Ordner testet das Modell.

**Durchführung:** `PAKET-ANLEITUNG.md` (Entwurf) Schritt 1–5 mit
`<PAKET>` = `C:\Users\Lonsinator\Downloads\keel-harness-standalone` und
`<HARNESS>` = `C:\Users\Lonsinator\WORKSPACES\keel-harness-standalone-test`.
Alternativ `ONBOARDING-FUER-CLAUDE.md` einer Sitzung vorlegen, die **in `<HARNESS>`** läuft (Sitzungs-Ort ist egal — aber genau das soll der Test auch zeigen: es klappt dort, wo man hinterher arbeitet).

**Erwartung (Prüfliste):**

- [ ] `<PAKET>` unverändert; kein Paketbestandteil in `<HARNESS>` (kein `onboarding.mjs`, kein `harness/`, kein `vorlagen/`, kein `PAKET.json`, kein `pruefung/`, kein `beileger/`).
- [ ] `<HARNESS>/CLAUDE.md` existiert und stammt aus `vorlagen/CLAUDE.md` — enthält `[?]`.
- [ ] Onboarding-Ausgabe: Schritt [7] „angelegt", nicht „uebersprungen"; RC 0 oder 1 (1 nur mit den erwarteten Hinweisen, z. B. „kein git-Repo" vor Schritt 4).
- [ ] Nach `git init` + Commit in `<HARNESS>`: `git -C <HARNESS> ls-files` zeigt ausschließlich Nutzlast (`.claude/…`, `.gitignore`, `CLAUDE.md`, `docs/…`, `lizenzen/…`, `oberflaeche/…`, `zustand/…`).
- [ ] Neustart, Sitzung in `<HARNESS>`: `/repo-status` läuft; die Statusleiste zeigt Repo/Branch; keine Onboarding-Rolle mehr aktiv.
- [ ] Zweiter Lauf desselben `onboarding.mjs`-Befehls: nur „unveraendert" (Wiederholbarkeit).
- [ ] Windows-Hinweis war nötig (Zeile 53 noch offen) — oder nicht mehr (dann Hinweis streichen).

**Ergebnis 2026-08-18 (durchgeführt, Ordner vorher geleert):** alle Punkte bestanden, bis auf den
Neustart-Punkt (kann nur der Mensch). Echtlauf RC 1 (einzig „kein git-Repo", erwartet), `[7] angelegt`,
`git ls-files` = 35 Nutzlast-Dateien, keine Paketreste, 8 × `[?]` in `CLAUDE.md`, zweiter Lauf 0 neu / RC 0.
Nebenbei: `git init` legt `master` an — falls `main` gewünscht, in Schritt 4 `git -C <HARNESS> init -b main`.
