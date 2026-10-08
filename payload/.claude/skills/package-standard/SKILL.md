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
mit `package-cli doctor`. Jeder `package-cli`-Aufruf laeuft ohne feste Zeit unter dem Stille-Wächter
(`KEEL_SILENCE_MS`): ein langsamer `doctor` bricht nicht mehr nach 60 s ab, nur ein Aufruf ohne Ausgabe und ohne Arbeit.

## Neues Paket

Derselbe eine Weg wie `/package-create`, in denselben fuenf Schritten:

1. Anlegen: `package-standard.mjs create --root <REPO> --package <ID> --session <PLANER_SESSION>
   --problem "…" --intent "…" --goal "…" --scope-in "…" --scope-out "…" --context "…"
   --step "…" [--step "…"] --requirement "…" --requirement "…" [--requirement "…"]
   [--leaf leaf-<id>=<glob>[,<glob>] ...] [--planned-start JJJJ-MM-TT --planned-end JJJJ-MM-TT]
   [--owner-request-file <DATEI> | --owner-request "…"] [--harness-root <HARNESS_ROOT>] [--takeover [--reason "…"]]`.
   Der Originalauftrag des Owners steht woertlich in `OWNER.md` oder kommt ueber
   `--owner-request-file` (nie umformulieren, nie kuerzen: der Auftrag wird vollstaendig
   uebernommen und endet am Marker `<!-- owner-end -->` in `OWNER.md`, nie an einer
   Ueberschrift `##` in seinem Text; es gibt keine Mindestlaenge, nur leer ist verboten).
   Der Aufruf oeffnet die Planungsbindung der
   eigenen Sitzung ueber `package-bootstrap begin`; jedes Leaf braucht eine Anforderung,
   die Wurzel nimmt die letzte, sonst wiederholt sie die letzte als Gesamtabnahme: ein Schritt
   und eine Anforderung sind ein vollstaendiges Paket. Fehlt ein Feld, meldet das Werkzeug es unter `missing` und
   legt nichts an; Ueberschneidungen mit aktiven Paketen stehen unter `overlaps`, Hinweise unter
   `warnings`.
   Zuschnitt: Arbeitsschritte (`--leaf`) werden nach zusammenhaengenden Dateien geschnitten, nicht
   nach Bereichen; ein Leaf sind die Dateien, die zusammen geaendert und geprueft werden (eine
   Komponente samt Test), nie "frontend" oder "backend" (Warnung `LEAF_BY_AREA`). Eine
   Kleinstaenderung (eine Kennung, ein Text) ist ein Schritt oder geht den leichten Weg: der
   Orchestrator schreibt `evidence/` und `design/` seines Pakets selbst.
   Titel: der Titel ist der Paketname `<ID>`. Er muss aus Woertern des Owner-Auftrags stammen oder ein
   vom Owner genannter Name sein; ein allgemeiner wie `offene-pakete` ergibt die Warnung
   `TITLE_NOT_FROM_ORDER` mit einem Vorschlag aus den ersten Woertern des Auftrags (keine Sperre).
   Wird dieselbe Unterhaltung wieder aufgenommen (neue Sitzungskennung), geht die Planungsbindung
   von selbst auf die neue Kennung ueber, wenn das Transkript die alte nennt. Von Hand: `--takeover
   --reason "…"`; nur, wenn die alte Sitzung seit `silenceMs` (30 Minuten) keinen Hook ausgeloest
   hat, ob das Paket aktiv ist oder nicht.
2. Unter der Bindung verfeinern: Requirements, Abnahme, Depth Tree, Leaf-Ledger mit
   disjunkten OWNS, Gates mit CHECK, CWD und EXPECT oder manuell, optional eine Zeile
   `MODEL: <provider> <model id> <effort>` (Codex: `MODEL: codex`). Erlaubt sind nur
   `OWNER.md`, `PACKAGE.md`, `GATES.md` und unmittelbare `gates/*.md`.
3. `package-cli.mjs doctor --root <REPO> --package <ID>`.
4. Vor `plan` die Zeile `Owner-Start: YYYY-MM-DD "<Owner-Wortlaut>"` in `## Status` der PACKAGE.md
   eintragen, sobald die Startnachricht des Owners vorliegt (nach `plan` ist die PACKAGE.md nicht mehr
   beschreibbar, `start` und `next` endeten in `OWNER_START_MISSING`); liegt sie noch nicht vor, bleibt die
   Bindung offen, bis sie da ist. Dann `package-bootstrap.mjs plan --harness-root <HARNESS_ROOT>
   --session <PLANER_SESSION> --json` legt das Paket als geplant ab und beendet die Bindung; danach das
   Buendel sichern mit `git-intent.mjs checkpoint --root <REPO> --package <ID> --message "<TEXT>"`.
5. Gestartet wird nur auf das Startsignal des Owners (Zeile `Owner-Start:` im Status oder
   `--run` mit der `Owner-Go:`-Zeile eines Lauf-Pakets), mit `package-executor.mjs start`. Du liest
   das Startsignal aus dem Gespraech und legst die Nachricht des Owners als woertliches Zitat ab;
   eine Satzform fragst du nie ab. Ein langes, mehrzeiliges oder Anfuehrungszeichen enthaltendes Zitat
   steht als Block: die Zeile ohne Wortlaut, darunter jede Zitatzeile mit vier Leerzeichen und `>`.
   Belege und Berichte des Pakets (`docs/packages/<ID>/evidence/**` und `design/**`) schreibt die
   Planungs- oder Orchestrator-Sitzung auch nach dem Start direkt, ohne Arbeitsagent; Vertrag,
   Gates und `OWNER.md` bleiben gesperrt.

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
