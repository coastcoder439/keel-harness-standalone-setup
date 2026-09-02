---
description: Schließt ein vollständig integriertes Paket nach erneuter Root-Reverify und eigenem Closure-Checkpoint.
---

1. Lies `package-executor status`. Alle Sessions müssen lokal verifiziert, alle
   Waves vollständig, der Integrations-Checkpoint vorhanden und alle Follow-up-
   Duties bekannt sowie erfüllt oder separat freigegeben sein.
2. Führe exakt
   `node <HARNESS_ROOT>/harness-core/execution/package-executor.mjs plan-close --harness-root <HARNESS_ROOT> --root <REPO> --package <ID> --scope <SCOPE> --json`
   aus. Zeige dem Owner das Challenge-Receipt und stoppe.
3. Nur der Owner erstellt außerhalb des Repos ein privates, kurzlebiges
   `keel-owner-approval`-Artefakt für `action: "close"`, gebunden an
   `challengeDigest`, Paket, Scope und eine einmalige Nonce. Diese Agentenroute
   darf das Artefakt nicht erstellen.
4. Nach Erhalt des externen Pfads führe exakt
   `node <HARNESS_ROOT>/harness-core/execution/package-executor.mjs close --harness-root <HARNESS_ROOT> --root <REPO> --package <ID> --scope <SCOPE> --challenge <CHALLENGE_RECEIPT> --approval-file <EXTERNES_ARTEFAKT> --message "<TEXT>" --json`
   aus. Es gibt kein `--owner-approved`.
5. Gib Close-, Recovery- und Closure-Receipt aus. Sie erlauben noch keinen Push;
   ein unterbrochener Closure-Checkpoint darf nur mit `recover-close --receipt
   <CLOSE_RECEIPT>` fortgesetzt werden.
