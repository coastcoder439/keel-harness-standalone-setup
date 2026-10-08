---
description: Schließt ein vollständig integriertes Paket mit der Owner-OK-Zeile in einem Befehl.
---

1. Lies `package-executor status`. Alle Sessions müssen lokal verifiziert, alle
   Waves vollständig, der Integrations-Checkpoint vorhanden und alle Follow-up-
   Duties bekannt sowie erfüllt oder separat freigegeben sein.
   Hat nie ein Arbeitsagent für dieses Paket gelaufen (die Sitzung hat selbst gebaut; ihre
   Leaf-Sitzungen stehen auf `prepared`), entfällt der Integrations-Checkpoint: `close` beweist
   die Gates an `HEAD` in einer sauberen Kopie, leitet daraus die Plan-Haken ab und schließt;
   ungesicherter Code zählt nicht (erst sichern), ein unbewiesenes Gate sperrt wie immer. Eine
   laufende oder angehaltene Ausführung sperrt weiter (`OPEN_EXECUTION`).
2. Der Owner gibt sein OK im Chat; du liest es aus dem Gesprächszusammenhang und fragst nie
   nach einer Satzform. Es gibt keine Freigabedatei, keine Challenge und keinen owner-privaten
   Ordner mehr; der Beleg ist genau ein Eintrag in der PACKAGE.md des Pakets, Abschnitt
   `## Abschluss`: bei einem kurzen Wortlaut eine Zeile
   `Owner-OK: close <YYYY-MM-DD> <40-stelliger Commit-SHA> "<Wortlaut des Owners>"`, sonst
   (lang, mehrzeilig, mit Anführungszeichen) dieselbe Zeile ohne Wortlaut mit dem Zitat als
   Block darunter, jede Zeile mit vier Leerzeichen und `>` davor.
3. Führe exakt
   `node <HARNESS_ROOT>/harness-core/execution/package-executor.mjs close --harness-root <HARNESS_ROOT> --root <REPO> --package <ID> --scope <SCOPE> --owner-ok "<WORTLAUT>" --message "<TEXT>" --json`
   aus; bei Mehrzeiligem oder Anführungszeichen statt `--owner-ok` die Datei:
   `--owner-ok-file <DATEI>` (UTF-8-Text im Temp-Ordner der Sitzung oder im Laufzeitordner
   `.unlazy`). Der Schalter schreibt den Eintrag mit dem heutigen Datum und dem
   aktuellen `HEAD` selbst in die PACKAGE.md; steht dort schon ein Eintrag für diesen
   `HEAD`, bleibt er (ein abgebrochener Abschluss wird einfach wiederholt), ein
   veralteter wird durch die neu übergebenen Worte des Owners ersetzt. Ohne Schalter muss der
   Eintrag vorhanden sein, sonst `OWNER_OK_MISSING`; nennt er einen anderen Commit als `HEAD`,
   ist es `OWNER_OK_STALE` (das Zitat erneut gegen den aktuellen Stand ablegen; ob es die
   Änderungen noch deckt, beurteilst du aus dem Gespräch), bei zwei close-Einträgen
   `OWNER_OK_AMBIGUOUS`. `--message` hat keine Längengrenze und darf mehrzeilig sein.
4. Nachpruefung: `close` prueft jedes Gate an `HEAD` in einer sauberen Kopie
   (`gate-check --at HEAD`, `checkedAt: <SHA>`); ein gespeichertes Ergebnis desselben
   Code-Stands (das der Integration) gilt, sonst laeuft das Gate dort neu. Fremde
   ungesicherte Dateien spielen keine Rolle. Manuelle Gates gelten nur, solange der
   Code-Stand ihrer Bestaetigung gleich ist (sonst `MANUAL_GATE_STALE`). `--reverify` und
   `--timeout S` werden angenommen und aendern nichts. Liegen nach dem Integrations-Checkpoint
   weitere Commits auf `HEAD`, ist der Abschluss trotzdem moeglich, wenn der Checkpoint ein
   Vorfahr von `HEAD` ist und jeder Commit seither von `origin/main` erreichbar ist (also
   gepusht); sonst `INTEGRATION_REQUIRED`.
5. Gib Close-, Recovery- und Closure-Receipt aus. Sie erlauben noch keinen Push;
   ein unterbrochener Closure-Checkpoint darf nur mit `recover-close --receipt
   <CLOSE_RECEIPT>` fortgesetzt werden.

Hinweis: Der Owner-OK-Eintrag wird mit dem Schluss-Commit versioniert und ist damit der
dauerhafte Freigabebeleg. Der Wortlaut sind die Worte des Owners, wie er sie geschrieben hat
(keine Längengrenze, Zeilenumbrüche und Anführungszeichen erlaubt, nur nicht leer).
