---
description: Erfasst Follow-up-Pflichten strukturiert und blockiert Close bei unbekanntem oder offenem Zustand.
---

Verwende den gemeinsamen Executor-Präfix mit genau einem dieser Kommandos:

- `duty-assess --gate <LEDGER:GATE> --json`
- `duty-add --duty <ID> --owner "<OWNER>" --trigger "<TRIGGER>" --due-state open|due --gate <LEDGER:GATE> --json`
- `duty-resolve --duty <ID> [--gate <LEDGER:GATE>] --json`
- nach dem OK des Owners im Chat, in einem Schritt:
  `duty-waive --duty <ID> --owner-ok "<WORTLAUT>" --json`

`duty-waive` bildet daraus die Zeile
`Owner-OK: waive-duty:<ID> <YYYY-MM-DD> <aktueller HEAD> "<WORTLAUT>"`, legt sie als
`waiver` im Pflichtstand ab und schreibt einen dauerhaften Beleg. Es gibt keine
Freigabedatei, keine Challenge und kein `plan-duty-waiver` mehr.

Ohne vollständige Assessment-Evidence bleibt der Zustand `unknown`; der Executor
schreibt niemals automatisch `Offen: nichts`.
