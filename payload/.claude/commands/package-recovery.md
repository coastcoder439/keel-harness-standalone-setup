---
description: Behandelt Provider-Ausfall, Abbruch, Deadline, Retry, Reassignment und Wave-Recovery als dauerhafte Übergänge.
---

Nutze ausschließlich diese exakten Executor-Kommandos mit dem gemeinsamen Präfix
`node <HARNESS_ROOT>/harness-core/execution/package-executor.mjs <COMMAND> --harness-root <HARNESS_ROOT> --root <REPO> --package <ID> --scope <SCOPE>`:

- Zustand: `heartbeat --session <SESSION> --json` oder `liveness --session <SESSION> --json`.
- Abbruch: `abort --session <SESSION> --reason "<TEXT>" --json`.
- Timeout: `timeout --session <SESSION> --reason "<TEXT>" --json`.
- Ganze Welle aufgeben: `abandon --wave <WAVE> --reason "<TEXT>" --json`.
- Derselbe Besitz, neuer Versuch: `retry --session <SESSION> --json`, danach eine
  neue `dispatch --wave <NEUE_WELLE> --session <SESSION> ...`.
- Besitz übertragen: `reassign --session <ALT> --new-session <NEU> [--provider
  claude|codex] --json`, danach neue Dispatch-Welle.
- Erst wenn die Ersatzwelle lokal vollständig verifiziert ist:
  `recover --wave <ABGEBROCHENE_WELLE> --replacement-wave <VOLLSTÄNDIGE_WELLE> --json`.

Provider-Startfehler, Deadline und Liveness werden dauerhaft gespeichert. Erfinde
keine Handles und lösche keine Laufdateien, um einen Zustand zu überspringen.
