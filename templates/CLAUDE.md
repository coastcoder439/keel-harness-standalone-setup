# CLAUDE.md — <WORKSPACE>

> Laedt in jeder Sitzung und wird als Wahrheit gelesen. Offene Pflichtangaben tragen
> die **Ausfuell-Marke** `[AUSFUELLEN]` — lieber die offene Marke als eine geratene
> Angabe; ein blosses `[?]` ist ein spaeterer Platzhalter, kein Onboarding-Ausloeser.
> Solange eine Pflichtmarke offen steht, startet jede neue Sitzung von selbst
> `/onboarding` und fuellt sie mit dir aus.

## 1. Was das hier ist

- **`[AUSFUELLEN]` Zweck dieses Workspace** — ein Satz, was hier gebaut wird.
- **`[AUSFUELLEN]` Wer arbeitet daran** — Rollen und Zustaendigkeiten.
- **`[AUSFUELLEN]` Projektsprache** — Vorgabe dieses Harness: Deutsch.

## 2. Repo-Struktur

**Ordnername == Repo-Name.** Jedes separat gebaute Teil bekommt ein eigenes Repo;
Projekt-Repos liegen als Geschwister unter `user-projects/<name>`, nie ineinander.

| Ebene | Ordner | Repo |
|---|---|---|
| Workspace | `.` (dieser Ordner) | `[AUSFUELLEN]` |
| Projekt | `user-projects/[?]` | `[?]` |

**Neues Projekt, Reihenfolge nicht vertauschbar:** erst eigenes Repo anlegen und
verifiziert pushen, DANN die Ignorier-Zeile in die `.gitignore` — andersherum wird
das Projekt unsichtbar und ungesichert zugleich.

**Ordnung heisst Zugehoerigkeit:** Jede Datei lebt im Repo ihres Projekts, dort bei
ihrem Thema — Arbeitspakete gebuendelt unter `docs/packages/`, Doku bei Doku, Tests
bei Tests, Code bei Code; neue Themen duerfen neue Ordner bilden. Was keinem Projekt
dient (Versuche, Wegwerf-Dateien), geht ins Session-Scratchpad, nie in ein Repo.
Pruefsatz: Zu jeder Datei laesst sich in einem Satz sagen, zu welchem Projekt und
Thema sie gehoert — sonst liegt sie falsch. Coding-Namen (Dateien, Ordner, Felder,
Identifier) sind englisch; Deutsch nur in Erklaer-Prosa und Anzeige-Texten.

## 3. Konventionen

- **Workspace-Repo: nur `git commit -m "…" -- <pfad>`** (nie `add`+`commit`, nie `-a`) —
  mehrere Sitzungen teilen einen Index; das Pruefkommando ist `git diff HEAD -- <pfad>`,
  nicht `--cached`. Der `commit-pathspec-guard` erzwingt das.
- **Verschachtelte Repos via `git -C <repo>`** committen — nie ins falsche Repo.
- **Keine Zugaenge in Dateien** — Schluesselbund oder Umgebungsvariablen.

Waechter und Hooks laufen automatisch; Verdrahtung in `.claude/settings.json`, Befehle in
`.claude/commands/`, Dauer-Regeln in `.claude/rules/keel/`. Dashboard:
`node dashboard/index.js --html dashboard.html` (Messung `measure.js` und Anzeige
`render/` bleiben getrennt).

## 4. `[?]` Deine eigenen Regeln

Die mitgelieferten Regeln gelten — aber ihre Beweislage stammt aus der
Ursprungs-Werkbank, ist also fremd. Erlebst du hier eigene Faelle, schreib sie mit
Datum und Messwert in die Regel hinein, damit sie hier verankert sind.
