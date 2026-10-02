---
name: package-standard
description: Legt ein Arbeitspaket im Paketstandard an (Problem, Intent, Goal, Scope, Context, Schritte) oder uebernimmt ein bestehendes Projekt (flache Paketdatei, P-Datei, TODO-Liste) mit Vorschau, Uebernehmen und Rueckgaengig.
---

# Paketstandard

Jedes Paket ist ein Unlazy-Bundle `docs/packages/<id>/` mit `OWNER.md`, `PACKAGE.md`,
`GATES.md` und `gates/`. `PACKAGE.md` beginnt mit genau diesen Zeilen, in dieser Reihenfolge,
je eine Zeile:

- `**Problem:**` was konkret kaputt ist oder fehlt
- `**Intent:**` warum es getan wird
- `**Goal:**` woran man das Ende erkennt (pruefbarer Zielzustand)
- `**Scope:** Drin: … Nicht drin: …` was dazugehoert und was ausdruecklich nicht (mit dem
  Paket, das es stattdessen besitzt); die `OWNS:`-Listen der Leaves bleiben die Dateizustaendigkeit
- `**Context:**` kurzer gemessener Ausgangspunkt
- optional `**Planned start:**` und `**Planned end:**` als `JJJJ-MM-TT`, Beginn nicht nach Ende

Darunter `## Plan` mit abhakbaren Schritten `1. [ ] …`, genau eine Zeile je Schritt. Braucht
ein Schritt Unterpunkte, werden daraus eigene Schritte. `package-cli lint` erzwingt Scope und
Context, sobald `.keel-harness.json` `packageContract.standardFormatRequired: true` setzt;
Datumsfelder prueft es immer.

Das Werkzeug liegt neben dieser Datei: `node <HARNESS_ROOT>/.claude/skills/package-standard/package-standard.mjs`.
Es baut auf `package-cli create` auf (Standardformat samt `OWNER.md`) und prueft jedes Ergebnis
mit `package-cli doctor`.

## Neues Paket

Derselbe eine Weg wie `/package-create`, in denselben fuenf Schritten:

1. Anlegen: `package-standard.mjs create --root <REPO> --package <ID> --session <PLANER_SESSION>
   --problem "…" --intent "…" --goal "…" --scope-in "…" --scope-out "…" --context "…"
   --step "…" [--step "…"] --requirement "…" --requirement "…" [--requirement "…"]
   [--leaf leaf-<id>=<glob>[,<glob>] ...] [--planned-start JJJJ-MM-TT --planned-end JJJJ-MM-TT]
   [--owner-request-file <DATEI> | --owner-request "…"] [--harness-root <HARNESS_ROOT>] [--takeover]`.
   Der Originalauftrag des Owners steht woertlich in `OWNER.md` oder kommt ueber
   `--owner-request-file` (nie umformulieren). Der Aufruf oeffnet die Planungsbindung der
   eigenen Sitzung ueber `package-bootstrap begin`; jedes Leaf braucht eine Anforderung,
   die Wurzel eine weitere. Fehlt ein Feld, meldet das Werkzeug es unter `missing` und
   legt nichts an; Ueberschneidungen mit aktiven Paketen stehen unter `overlaps`.
2. Unter der Bindung verfeinern: Requirements, Abnahme, Depth Tree, Leaf-Ledger mit
   disjunkten OWNS, Gates mit CHECK, CWD und EXPECT oder manuell, optional eine Zeile
   `MODEL: <provider> <model id> <effort>` (Codex: `MODEL: codex`). Erlaubt sind nur
   `OWNER.md`, `PACKAGE.md`, `GATES.md` und unmittelbare `gates/*.md`.
3. `package-cli.mjs doctor --root <REPO> --package <ID>`.
4. `package-bootstrap.mjs plan --harness-root <HARNESS_ROOT> --session <PLANER_SESSION> --json`
   legt das Paket als geplant ab und beendet die Bindung; danach das Buendel sichern mit
   `git-intent.mjs checkpoint --root <REPO> --package <ID> --message "<TEXT>"`.
5. Gestartet wird nur auf das Startsignal des Owners (Zeile `Owner-Start:` im Status oder
   `--run` mit der `Owner-Go:`-Zeile eines Lauf-Pakets), mit `package-executor.mjs start`.

## Bestehendes Projekt uebernehmen

1. Vorschau (schreibt nichts): `package-standard.mjs import --root <REPO> --kind flat|pfile|todo
   --source <DATEI oder ORDNER> (--package <NEUE_ID> | --into <BESTEHENDE_ID>)`.
   Sie zeigt je Schritt die Quellzeile, die erkannten Felder und was fehlt.
2. Dem Owner die Zuordnung zeigen. Fehlende Felder als Optionen nachreichen, nie erfinden.
   Bei P-Dateien: jede P-Datei wird ein Schritt des bestehenden Pakets (`--into`); welche
   erledigt sind, wird gegen Commits und Code geprueft und mit `--done P13,P14` angegeben.
3. Uebernehmen: denselben Aufruf mit `--apply`. Neues Bundle: die Quelle liegt danach
   unveraendert unter `design/imported-<datei>`. Das Undo-Journal liegt ignoriert unter
   `.unlazy/package-standard/undo/<id>.json`.
4. Rueckgaengig: `package-standard.mjs undo --root <REPO> --package <ID>`. Es verweigert,
   wenn das Paket seit dem Import von Hand geaendert wurde.

Nie gleichzeitig eine flache Datei `docs/packages/<id>.md` und ein Bundle gleichen Namens
stehen lassen; die flache Quelle nach dem Import archivieren (nicht loeschen).

## Repo vorbereiten

`package-standard.mjs prepare --root <REPO>` zeigt als Vorschau, ob Git `.unlazy/` in der
`.gitignore` des Repos ignoriert; mit `--apply` traegt es die Zeile ein (legt die Datei an,
schreibt eine UTF-16-Datei als UTF-8, behaelt die Zeilenenden). Rueckgaengig:
`package-standard.mjs undo --root <REPO> --prepare`, solange sich seitdem nichts geaendert hat.
