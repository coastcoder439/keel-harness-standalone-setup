---
description: Plant einen sicheren Publish nach Close und verbraucht dafür eine eigene externe Owner-Freigabe.
---

1. Nach erfolgreichem `package-close` führe exakt
   `node <HARNESS_ROOT>/harness-core/execution/package-executor.mjs plan-publish --harness-root <HARNESS_ROOT> --root <REPO> --package <ID> --scope <SCOPE> --closure-receipt <CLOSURE_RECEIPT> --json`
   aus.
2. Zeige dem Owner Ziel-Remote, Branch, Commit und Challenge-Receipt. Stoppe. Close
   ist keine Publish-Freigabe.
3. Nur der Owner erstellt außerhalb des Repos ein neues privates, kurzlebiges
   `keel-owner-approval`-Artefakt für `action: "publish"`, gebunden an diese
   Challenge und eine neue Nonce.
4. Nach Erhalt des externen Pfads führe exakt
   `node <HARNESS_ROOT>/harness-core/execution/package-executor.mjs publish --harness-root <HARNESS_ROOT> --root <REPO> --package <ID> --scope <SCOPE> --challenge <CHALLENGE_RECEIPT> --approval-file <EXTERNES_ARTEFAKT> --json`
   aus. Bei jeder Änderung an HEAD, Branch oder Remote neu planen. Kein
   `--owner-approved` und kein roher Git-Push.

Hinweis: Die JSON-Ausgabe des Plans enthaelt unter `ownerApproval` das ausgefuellte Artefakt-Template (Schema, challengeDigest, Paket, Scope, Zeitfenster), den Befehl zur Nonce-Erzeugung, den Ablageort-Vorschlag ausserhalb des Repos, unter Windows den ACL-Haertungsbefehl und den exakten Folgebefehl. Der Owner fuellt nur die Nonce ein und speichert die Datei ausserhalb des Repos.
