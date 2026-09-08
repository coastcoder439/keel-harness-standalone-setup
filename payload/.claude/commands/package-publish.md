---
description: Veröffentlicht nach Close mit dem Closure-Receipt und einer eigenen Owner-OK-Zeile.
---

1. Nach erfolgreichem `package-close` gibt der Owner sein OK zum Push im Chat. Close
   ist keine Publish-Freigabe; der Wortlaut wird eigens für `publish` erhoben.
2. Führe exakt
   `node <HARNESS_ROOT>/harness-core/execution/package-executor.mjs publish --harness-root <HARNESS_ROOT> --root <REPO> --package <ID> --scope <SCOPE> --closure-receipt <CLOSURE_RECEIPT> --owner-ok "<WORTLAUT>" --json`
   aus. Der Befehl prueft den Closure-Receipt, plant den Push, bildet daraus die Zeile
   `Owner-OK: publish <YYYY-MM-DD> <HEAD des Publish-Plans> "<WORTLAUT>"` und legt sie im
   Publish-Beleg ab. Sie wandert NICHT in die PACKAGE.md: ein geschlossenes Paket wird
   nicht mehr editiert.
3. Ohne `--owner-ok` bricht der Befehl mit einer USAGE-Meldung ab. Bei jeder Änderung an
   HEAD, Branch oder Remote neu ausführen; es gibt kein `--owner-approved`, keine
   Freigabedatei und keinen rohen Git-Push.
4. Gib den Publish-Beleg mit Remote, Branch, Commit und der Owner-OK-Zeile aus.
