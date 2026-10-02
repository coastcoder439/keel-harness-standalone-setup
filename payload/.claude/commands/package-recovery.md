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
- Neue Sitzungskennung oder geänderter Leaf-Vertrag: `rebind --session <SESSION>
  --reason "<TEXT>" --json` erneuert eine vorbereitete Bindung nach einer
  Vertragsänderung, `rebind --session <ALT> --new-session <NEU> --reason "<TEXT>" --json`
  oder `rebind --leaf leaf-<ID> --new-session <NEU> --reason "<TEXT>" --json` überträgt
  sie auf eine neue Sitzungskennung, ohne eine Datei anzufassen. Eine bereits
  gestartete Sitzung geht über `abort`, danach `retry` oder `reassign`.
- Verwaiste Laufzeit-Reste: `cleanup-runtime --root <DIR> [--apply]` läuft ohne den
  gemeinsamen Präfix, weil es kein `--package`, `--scope` oder `--session` annimmt:
  `node <HARNESS_ROOT>/harness-core/execution/package-executor.mjs cleanup-runtime --root <DIR> [--harness-root <HARNESS_ROOT>] [--unlazy-root <DIR>] [--apply] [--json]`.
  Ohne `--apply` zeigt es nur die Vorschau verwaister Scopes, Leases, Sitzungseinträge
  und Planungsdatensätze; mit `--apply` gibt es die Leases frei und verschiebt die
  Scopes unverändert nach `.unlazy/.retired`, `docs/packages` bleibt unberührt.

Provider-Startfehler, Deadline und Liveness werden dauerhaft gespeichert. Erfinde
keine Handles und lösche keine Laufdateien, um einen Zustand zu überspringen.
