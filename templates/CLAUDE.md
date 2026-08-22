# CLAUDE.md — <WORKSPACE>

> Diese Datei laedt in JEDER Sitzung, in diesem Ordner und in allen Unterordnern.
> Was hier steht, wird als Wahrheit gelesen. Deshalb sind offene Pflichtangaben mit einer
> **Ausfuell-Marke** gekennzeichnet: lieber die offene Marke als eine geratene Angabe.
> (Ein blosses `[?]` ist dagegen ein spaeterer Platzhalter, kein Onboarding-Ausloeser.)
>
> Angelegt von der Harness-Installation. Die Abschnitte 1-2 und 5 gehoeren dir, 3-4
> beschreiben, was installiert ist und hier gilt. Solange eine Ausfuell-Pflichtmarke offen
> steht, startet jede neue Sitzung von selbst `/onboarding` und fuellt sie mit dir aus.

## 1. Was das hier ist

- **`[AUSFUELLEN]` Zweck dieses Workspace** — ein Satz, was hier gebaut wird.
- **`[AUSFUELLEN]` Wer arbeitet daran** — Rollen und Zustaendigkeiten.
- **`[AUSFUELLEN]` Projektsprache** — Vorgabe dieses Harness: Deutsch.

## 2. Ebenen und Repo-Struktur

Regel: **Ordnername == Repo-Name.** Jedes separat gebaute Teil bekommt ein
eigenes Repo; die Projekt-Repos liegen als Geschwister unter `user-projects/`,
nicht ineinander.

| Ebene | Ordner | Repo |
|---|---|---|
| Workspace | `.` (dieser Ordner) | `[AUSFUELLEN]` |
| Projekt | `user-projects/[?]` | `[?]` |

**Reihenfolge bei einem neuen Projekt, nicht vertauschbar:** erst eigenes Repo
anlegen und **verifiziert pushen**, DANN die Ignorier-Zeile in die `.gitignore`
eintragen. Andersherum wird das Projekt unsichtbar und ungesichert zugleich.

## 3. Was installiert ist (vom Onboarding gesetzt)

**Waechter — laufen automatisch, ohne dass jemand etwas tippt:**

| Werkzeug | Wann | Was es tut |
|---|---|---|
| `danger-guard.js` | vor jedem Bash-Befehl | blockiert zerstoerende Befehle ausserhalb der erlaubten Schreibziele |
| `git-guard.js` | vor jedem git-Befehl | sagt das ZIEL-Repo an und raeumt verwaiste `index.lock` |
| `commit-pathspec-guard.js` | vor jedem git-Befehl | erzwingt `git commit -- <pfad>` im Workspace-Repo |
| `uncommitted-warn.js` | am Sitzungsende | warnt bei ungesicherter Arbeit (nur Hinweis, blockiert nie) |
| `session-roles.js` | bei Sitzungsstart | laedt die Rollen aus `docs/08-sessions-rollen.md`, falls vorhanden |
| `onboarding-start.js` | bei Sitzungsstart | startet `/onboarding`, solange eine Ausfuell-Marke offen ist — danach still |
| `project-context.js` | bei Sitzungsstart | fragt beim Start nach Projekt/Rolle dieser Sitzung (AskUserQuestion) |
| `statusline.js` | dauerhaft | Repo · Branch · Sicherungsstand in der Statusleiste |
| `repo-status.js` | auf Aufruf (`/repo-status`) | lokales Git vs. GitHub vs. Sync, rekursiv |

**Befehle:** `/repo-status` · `/save-work` · `/session-map` · `/tell-session` · `/onboarding` (einmalig)

**Zustandsseite:** `node zustand/zustand.js --json --daten zustand.json` misst,
`node oberflaeche/befuellen.mjs oberflaeche/dist/index.html zustand.json zustand.html`
zeigt an. Die Messung kennt keine Darstellung — die Anzeige laesst sich
austauschen, ohne die Messung anzufassen.

## 4. Konventionen, die hier gelten

- **Im Workspace-Repo NIE `git add` + `git commit` und nie `git commit -a`** —
  sondern `git commit -m "…" -- <pfad>`. Grund: mehrere Sitzungen teilen einen
  Arbeitsbaum UND einen Index; `git commit` committet den Index, nicht deine
  Auswahl. Das Pruefkommando dazu ist `git diff HEAD -- <pfad>`, **nicht**
  `git diff --cached` — die pathspec-Form committet die Arbeitsbaum-Fassung.
  Der `commit-pathspec-guard` erzwingt das.
- **Verschachtelte Repos immer via `git -C <repo>`** committen — nie ins falsche Repo.
- **Keine Zugaenge in Dateien.** Schluesselbund oder Umgebungsvariablen.
- **Werkzeuge: CLI vor MCP vor Browser** — Begruendung in `.claude/rules/ecc/common/tools.md`.
- **Automatisch geladene Regeln:** `.claude/rules/ecc/common/` — fuenf Dateien,
  bewusst ohne Frontmatter, damit sie Dauer-Kontext sind und nicht nur abrufbar.

## 5. `[?]` Deine eigenen Regeln

Die mitgelieferten Regeln **gelten und werden befolgt** — aber ihre Beweislage
stammt aus der Ursprungs-Werkbank, ist also fremd. Verlass dich nicht auf geerbte
Autoritaet: erlebst du hier eigene Faelle, schreib sie in die Regel hinein — mit
Datum und Messwert, damit sie hier verankert ist.
