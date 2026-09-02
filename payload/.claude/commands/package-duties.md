---
description: Erfasst Follow-up-Pflichten strukturiert und blockiert Close bei unbekanntem oder offenem Zustand.
---

Verwende den gemeinsamen Executor-Präfix mit genau einem dieser Kommandos:

- `duty-assess --gate <LEDGER:GATE> --json`
- `duty-add --duty <ID> --owner "<OWNER>" --trigger "<TRIGGER>" --due-state open|due --gate <LEDGER:GATE> --json`
- `duty-resolve --duty <ID> [--gate <LEDGER:GATE>] --json`
- `plan-duty-waiver --duty <ID> --json`
- nach separatem externem Owner-Artefakt:
  `duty-waive --duty <ID> --challenge <CHALLENGE_RECEIPT> --approval-file <EXTERNES_ARTEFAKT> --json`

Ohne vollständige Assessment-Evidence bleibt der Zustand `unknown`; der Executor
schreibt niemals automatisch `Offen: nichts`.
