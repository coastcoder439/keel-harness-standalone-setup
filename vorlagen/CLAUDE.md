# CLAUDE.md — <WORKSPACE>

> Diese Datei laedt in JEDER Sitzung, in diesem Ordner und in allen Unterordnern.
> Was hier steht, wird als Wahrheit gelesen. Deshalb: **`[?]` heisst auszufuellen** —
> lieber eine offene Markierung als eine geratene Angabe.
>
> Angelegt von der Harness-Installation. Die Abschnitte 1-3 gehoeren dir, Abschnitt 4-5
> beschreiben, was tatsaechlich installiert ist.

## 0. Onboarding — solange hier `[?]` steht, ist es offen

**An den Agenten:** Stehen in dieser Datei noch `[?]`-Stellen, ist das Onboarding nicht
gemacht. Dann fuehrst du es **jetzt, in dieser Sitzung**, bevor du irgendetwas anderes
tust. Der Mensch tippt nichts von sich aus — du fragst, er antwortet, du traegst ein.

1. Sag dem Menschen in einem Satz, dass der Harness installiert ist und du jetzt die
   offenen Angaben mit ihm ausfuellst.
2. Frage nacheinander, eine Frage pro Nachricht, und trag jede Antwort sofort ein:
   - Wozu dient dieser Workspace? (ein Satz)
   - Wer arbeitet daran, mit welchen Rollen?
   - Welche Sprache soll hier gelten? (Vorgabe: Deutsch)
   - Wie heisst das Repo dieses Workspace? Gibt es schon Projekt-Repos unter `user-projects/`?
   - Was ist noch offen und muss entschieden werden?
   Will der Mensch etwas nicht beantworten, bleibt dort `[?]` stehen. Nie raten.
3. Geh dann die Punkte durch, die nur der Mensch entscheiden kann — je einen kurzen
   Absatz mit Handlung und Wirkung, dann seine Entscheidung abwarten:
   - **Sicherung:** Hat dieser Ordner ein GitHub-Remote? Wenn nein: Remote anlegen und
     pushen ist seine Handlung (`gh auth login`, Repo anlegen). Bis dahin liegt alles nur
     auf einer Platte.
   - **Schreibziele des Waechters:** `.claude/danger-guard.js`, Funktion `erlaubteWurzeln()`
     — schreibt er regelmaessig ausserhalb dieses Ordners, muss der Pfad dort hinein.
   - **`settings.json` versionieren:** Vorgabe ja; sie enthaelt nur `$CLAUDE_PROJECT_DIR`.
   - **Sitzungs-Rollen:** `docs/08-sessions-rollen.md` nur anlegen, wenn mehrere
     Sitzungen parallel laufen.
   - **Eigene Regeln:** Abschnitt 6 unten — erst fuellen, wenn ein eigener Fall da ist.
4. Committe die ausgefuellte Datei: `git commit -m "harness: onboarding" -- CLAUDE.md`.
5. Loesche diesen Abschnitt 0 aus der Datei und committe erneut. Ab jetzt ist der Harness
   in Betrieb; `/repo-status` zeigt den Stand.

Bricht der Mensch ab, bleibt Abschnitt 0 stehen — die naechste Sitzung nimmt es wieder auf.

## 1. Was das hier ist

- **`[?]` Zweck dieses Workspace** — ein Satz, was hier gebaut wird.
- **`[?]` Wer arbeitet daran** — Rollen und Zustaendigkeiten.
- **`[?]` Projektsprache** — Vorgabe dieses Harness: Deutsch.

## 2. Ebenen und Repo-Struktur

Regel: **Ordnername == Repo-Name.** Jedes separat gebaute Teil bekommt ein
eigenes Repo; die Projekt-Repos liegen als Geschwister unter `user-projects/`,
nicht ineinander.

| Ebene | Ordner | Repo |
|---|---|---|
| Workspace | `.` (dieser Ordner) | `[?]` |
| Projekt | `user-projects/[?]` | `[?]` |

**Reihenfolge bei einem neuen Projekt, nicht vertauschbar:** erst eigenes Repo
anlegen und **verifiziert pushen**, DANN die Ignorier-Zeile in die `.gitignore`
eintragen. Andersherum wird das Projekt unsichtbar und ungesichert zugleich.

## 3. Offene Punkte

`[?]` — hier hinein, was noch entschieden werden muss. Nicht im Sitzungsverlauf
lassen: der geht verloren.

## 4. Was installiert ist (vom Onboarding gesetzt)

**Waechter — laufen automatisch, ohne dass jemand etwas tippt:**

| Werkzeug | Wann | Was es tut |
|---|---|---|
| `danger-guard.js` | vor jedem Bash-Befehl | blockiert zerstoerende Befehle ausserhalb der erlaubten Schreibziele |
| `git-guard.js` | vor jedem git-Befehl | sagt das ZIEL-Repo an und raeumt verwaiste `index.lock` |
| `commit-pathspec-guard.js` | vor jedem git-Befehl | erzwingt `git commit -- <pfad>` im Workspace-Repo |
| `uncommitted-warn.js` | am Sitzungsende | warnt bei ungesicherter Arbeit (nur Hinweis, blockiert nie) |
| `session-roles.js` | bei Sitzungsstart | laedt die Rollen aus `docs/08-sessions-rollen.md`, falls vorhanden |
| `statusline.js` | dauerhaft | Repo · Branch · Sicherungsstand in der Statusleiste |
| `repo-status.js` | auf Aufruf (`/repo-status`) | lokales Git vs. GitHub vs. Sync, rekursiv |

**Befehle:** `/repo-status` · `/save-work` · `/session-map` · `/tell-session`

**Zustandsseite:** `node zustand/zustand.js --json --daten zustand.json` misst,
`node oberflaeche/befuellen.mjs oberflaeche/dist/index.html zustand.json zustand.html`
zeigt an. Die Messung kennt keine Darstellung — die Anzeige laesst sich
austauschen, ohne die Messung anzufassen.

## 5. Konventionen, die hier gelten

- **Im Workspace-Repo NIE `git add` + `git commit` und nie `git commit -a`** —
  sondern `git commit -m "…" -- <pfad>`. Grund: mehrere Sitzungen teilen einen
  Arbeitsbaum UND einen Index; `git commit` committet den Index, nicht deine
  Auswahl. Das Pruefkommando dazu ist `git diff HEAD -- <pfad>`, **nicht**
  `git diff --cached` — die pathspec-Form committet die Arbeitsbaum-Fassung.
  Der `commit-pathspec-guard` erzwingt das.
- **Verschachtelte Repos immer via `git -C <repo>`** committen — nie ins falsche Repo.
- **Keine Zugaenge in Dateien.** Schluesselbund oder Umgebungsvariablen.
- **Werkzeuge: CLI vor MCP vor Browser** — Begruendung in `.claude/rules/ecc/common/werkzeuge.md`.
- **Automatisch geladene Regeln:** `.claude/rules/ecc/common/` — vier Dateien,
  bewusst ohne Frontmatter, damit sie Dauer-Kontext sind und nicht nur abrufbar.

## 6. `[?]` Deine eigenen Regeln

Die vier mitgelieferten Regeln tragen die Beweislage der Ursprungs-Werkbank.
**Eine uebernommene Regel ohne eigenen Anlass wird nicht befolgt.** Wenn du hier
eigene Faelle erlebst, schreib sie in die Regel hinein — mit Datum und Messwert.
