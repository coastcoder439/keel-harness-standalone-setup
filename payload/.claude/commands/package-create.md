---
description: Erfasst den unveraenderlichen Owner-Auftrag und baut ein neues Unlazy-Paket im exakt besitzenden Git-Repo.
---

Ein Paket entsteht auf genau einem Weg, in fuenf Schritten:

1. Bestimme das echte Git-Repo, das die Arbeit besitzt, und lege das Paket an:
   `node <HARNESS_ROOT>/.claude/skills/package-standard/package-standard.mjs create --root <REPO> --package <ID> --session <PLANER_SESSION> --problem "<TEXT>" --intent "<TEXT>" --goal "<TEXT>" --scope-in "<TEXT>" --scope-out "<TEXT>" --context "<TEXT>" --step "<TEXT>" [--step "<TEXT>" ...] --requirement "<TEXT>" --requirement "<TEXT>" [--requirement "<TEXT>" ...] [--leaf leaf-<id>=<glob>[,<glob>] ...] [--planned-start JJJJ-MM-TT --planned-end JJJJ-MM-TT] [--owner-request-file <DATEI> | --owner-request "<TEXT>"] [--harness-root <HARNESS_ROOT>] [--takeover] --json`.
   Der Aufruf oeffnet die Planungsbindung ueber `package-bootstrap begin`.
   `<PLANER_SESSION>` ist die eigene Sitzungskennung: ohne bestehende Bindung laesst
   der Shell-Waechter `create` nur fuer die eigene Sitzung zu. Der Originalauftrag des
   Owners steht woertlich in `OWNER.md` oder kommt ueber `--owner-request-file`.
   Die `--leaf`-Muster prueft `create` wie OWNS gegen aktive Pakete und meldet
   Ueberschneidungen als `OVERLAP`-Zeilen. `BOOTSTRAP_TAKEOVER_REQUIRED` heisst: das
   Paket haelt eine andere Planungssitzung; die Meldung nennt sie samt Uebernahme-Befehl,
   und derselbe `create`-Aufruf mit `--takeover` uebernimmt. Findet der Harness zwei
   Unlazy-Laufzeiten (ein Repo mit eigener `vendor/unlazy`), nennt die Meldung beide
   Pfade; dann waehlt `create` die Laufzeit mit `--unlazy <DIR>`, und `plan` sowie jeder
   spaetere Executor-Aufruf fuer dieses Paket nennen denselben Ordner als
   `--unlazy-root <DIR>`.
2. Unter der Bindung verfeinern: Requirements `R -> C`, Abnahme, vollstaendiger Depth
   Tree, Leaf-Ledger mit disjunkten `OWNS`, Gates mit `CHECK`, `CWD` und `EXPECT` oder
   als manuelles Gate. Optional legt eine Zeile `MODEL: <provider> <model id> <effort>`
   (fuer Codex nur `MODEL: codex`) im Kopf eines Leaf-Ledgers vor dem ersten Gate oder in
   `GATES.md` Modell und Stufe fest. Die Bindung erlaubt ausschliesslich `OWNER.md`,
   `PACKAGE.md`, `GATES.md` und unmittelbare `gates/*.md`.
3. Pruefe den fertigen Vertrag read-only mit
   `node <HARNESS_ROOT>/vendor/unlazy/scripts/package-cli.mjs doctor --root <REPO> --package <ID>`.
   Keine Platzhalter, Ueberschneidungen, ungemappten Requirements oder zweiten Statusorte
   duerfen verbleiben.
4. Lege das Paket als geplant ab und beende die Bindung:
   `node <HARNESS_ROOT>/harness-core/execution/package-bootstrap.mjs plan --harness-root <HARNESS_ROOT> --session <PLANER_SESSION> [--unlazy-root <DIR>] --json`.
   Danach kann dieselbe Sitzung das naechste Paket anlegen. Sichere das geschriebene
   Buendel mit
   `node <HARNESS_ROOT>/harness-core/git/git-intent.mjs checkpoint --root <REPO> --package <ID> --message "<TEXT>"`.
5. Gestartet wird nur auf das Startsignal des Owners: entweder steht im Abschnitt
   `## Status` des Pakets die Zeile `Owner-Start: YYYY-MM-DD "<Owner-Wortlaut>"`,
   woertlich aus dem Chat des Owners uebernommen, oder der Start laeuft mit
   `--run <LAUF_PAKET>`, dessen `## Status` eine Zeile `Owner-Go: YYYY-MM-DD "<Owner-Wortlaut>"`
   traegt und das Paket nennt. Dann
   `node <HARNESS_ROOT>/harness-core/execution/package-executor.mjs start --harness-root <HARNESS_ROOT> --root <REPO> --package <ID> --scope <ID> --session <LEAF_SESSION> --leaf <LEAF> [--run <LAUF_PAKET>] --json`.
   Ohne Anbieter-Schalter kommen Anbieter, Modell und Stufe aus der `MODEL`-Zeile oder
   der Einstellung Paket-Ausfuehrung; Dashboard-Pakete laufen nie auf Codex
   (`PROVIDER_LOCKED`). Erst dieser Start aktiviert die normale Unlazy-Laufzeit.

Alte Pakete (flache Paketdateien, P-Dateien, TODO-Listen) wandelt
`package-standard.mjs import` um: zuerst die Vorschau, dann derselbe Aufruf mit `--apply`,
zurueck mit `package-standard.mjs undo`. Ein Repo ohne Paket-Vorbereitung bereitet
`package-standard.mjs prepare --root <REPO> [--apply]` vor.

Ab dem Start gelten nur noch Claims, Leaf-Bindungen, Dispatch-Waves und lokale Evidence.
Der Originalauftrag bleibt unveraenderlich; Plan und Goal ersetzen ihn nie.
