---
description: Schließt ein vollständig integriertes Paket mit der Owner-OK-Zeile in einem Befehl.
---

1. Lies `package-executor status`. Alle Sessions müssen lokal verifiziert, alle
   Waves vollständig, der Integrations-Checkpoint vorhanden und alle Follow-up-
   Duties bekannt sowie erfüllt oder separat freigegeben sein.
2. Der Owner gibt sein OK im Chat. Es gibt keine Freigabedatei, keine Challenge und
   keinen owner-privaten Ordner mehr; der Beleg ist genau eine Zeile in der PACKAGE.md
   des Pakets, Abschnitt `## Abschluss`:
   `Owner-OK: close <YYYY-MM-DD> <40-stelliger Commit-SHA> "<Wortlaut des Owners>"`
3. Führe exakt
   `node <HARNESS_ROOT>/harness-core/execution/package-executor.mjs close --harness-root <HARNESS_ROOT> --root <REPO> --package <ID> --scope <SCOPE> --owner-ok "<WORTLAUT>" --message "<TEXT>" --json`
   aus. Der Schalter `--owner-ok` schreibt die Zeile mit dem heutigen Datum und dem
   aktuellen `HEAD` selbst in die PACKAGE.md; steht dort schon eine Zeile für diesen
   `HEAD`, bleibt sie (ein abgebrochener Abschluss wird einfach wiederholt), eine
   veraltete Zeile ersetzt er durch das neue OK. Ohne Schalter muss die Zeile
   vorhanden sein, sonst `OWNER_OK_MISSING`; nennt sie einen anderen Commit als `HEAD`,
   ist es `OWNER_OK_STALE`, bei zwei close-Zeilen `OWNER_OK_AMBIGUOUS`.
4. Nachpruefung: Steht `HEAD` unveraendert auf dem Integrations-Checkpoint und ist der
   Arbeitsbaum bis auf die Owner-OK-Zeile unveraendert, uebernimmt `close` die Integrations-Reverify und
   prueft die Gates nur noch lesend (`reverified: false`, `reusedIntegration: <SHA>`).
   Sonst laeuft die volle Reverify (`reverified: true`). `--reverify` erzwingt sie
   immer; `--timeout S` ist das Budget je CHECK. Liegen nach dem Integrations-Checkpoint
   weitere Commits auf `HEAD`, ist der Abschluss trotzdem moeglich, wenn der Checkpoint ein
   Vorfahr von `HEAD` ist und jeder Commit seither von `origin/main` erreichbar ist (also
   gepusht); sonst `INTEGRATION_REQUIRED`.
5. Gib Close-, Recovery- und Closure-Receipt aus. Sie erlauben noch keinen Push;
   ein unterbrochener Closure-Checkpoint darf nur mit `recover-close --receipt
   <CLOSE_RECEIPT>` fortgesetzt werden.

Hinweis: Die Owner-OK-Zeile wird mit dem Schluss-Commit versioniert und ist damit der
dauerhafte Freigabebeleg. Der Wortlaut sind die Worte des Owners (1..500 Zeichen, keine
Anfuehrungszeichen, keine Zeilenumbrueche).
