---
name: source-command-save-work
description: Sichert genau den verifizierten Stand des Arbeitspakets per Commit.
---

# Save work

1. Bestimme das echte Repo und, falls ein Paket laeuft, Paket, Scope, Session und Leaf.
   Ohne eindeutiges Repo wird nichts gesichert und kein Repo geraten.
2. Pruefe den Stand mit `git status` (wahlweise
   `node harness-core/git/git-intent.mjs inspect --root <REPO> --session <SESSION> --json`).
3. Ein Leaf commitet nicht waehrend einer parallelen Welle. Der Parent nimmt alle lokal
   re-verifizierten Leaves an und fuehrt genau eine
   `package-executor.mjs integrate --harness-root <HARNESS_ROOT> --root <REPO> --package <ID> --scope <ID> --message "<TEXT>" --approve-checks --json`
   aus. Die Option erlaubt nur die sichtbaren pending CHECK-Orakel.
4. Einen einzelnen Checkpoint sichert ein normaler Commit der verifizierten Pfade
   (wahlweise `git-intent.mjs checkpoint`).
5. Ein geschriebenes, noch nicht gestartetes Paket sichert ein Commit von OWNER.md,
   PACKAGE.md, GATES.md und gates/*.md; ein gestartetes Paket sichern der
   Leaf-Checkpoint oder integrate.
6. Veroeffentlichen ist nach Package-Close ein Schritt: der Owner sagt im Chat OK (aus dem
   Gespraech gelesen, nie eine Satzform erfragt), dann laeuft
   `package-executor.mjs publish --closure-receipt <RECEIPT> --owner-ok "<WORTLAUT>"` (Mehrzeiliges:
   `--owner-ok-file <DATEI>`). Der Befehl zeigt Repo, Branch, HEAD und Remote und legt den
   Owner-OK-Eintrag im Publish-Beleg ab; ohne `--owner-ok` oder `--owner-ok-file` bricht er ab.
7. Berichte Receipts und lokalen Reverify-Stand. Commit und Provider-Erfolg sind keine
   Fulfillment-Evidence.

Git ist lokal frei. Nur Loeschen und Ueberschreiben auf GitHub braucht die ausdrueckliche
Erlaubnis des Owners im Chat.
