---
name: source-command-save-work
description: Sichert genau den verifizierten Stand des gebundenen Arbeitspakets ueber die endliche Git-Intent-API.
---

# Save work

1. Lies die exakte Repo-, Paket-, Scope-, Session- und Leaf-Bindung. Ohne gueltige
   Bindung wird nichts gesichert und kein Repo geraten.
2. Pruefe den Stand mit
   `node harness-core/git/git-intent.mjs inspect --root <REPO> --session <SESSION> --json`.
3. Ein Leaf commitet nicht waehrend einer parallelen Welle. Der Parent nimmt alle lokal
   re-verifizierten Leaves an und fuehrt genau eine
   `package-executor.mjs integrate --harness-root <HARNESS_ROOT> --root <REPO> --package <ID> --scope <ID> --message "<TEXT>" --approve-checks --json`
   aus. Die Option erlaubt nur die sichtbaren pending CHECK-Orakel.
4. Nutze fuer einen ausdruecklich vorgesehenen einzelnen Checkpoint nur
   `git-intent.mjs checkpoint` mit exakten gebundenen Pfaden.
5. Veroeffentlichen ist nach Package-Close ein Schritt: der Owner sagt im Chat OK, dann
   laeuft `package-executor.mjs publish --closure-receipt <RECEIPT> --owner-ok "<WORTLAUT>"`.
   Der Befehl zeigt Repo, Branch, HEAD und Remote und legt die Owner-OK-Zeile im
   Publish-Beleg ab; ohne `--owner-ok` bricht er ab.
6. Berichte Receipts und lokalen Reverify-Stand. Commit und Provider-Erfolg sind keine
   Fulfillment-Evidence.

Rohes mutierendes Git ist kein Ausweichweg. Bei einer nicht abgedeckten Absicht stoppt
`git-intent.mjs explain` fuer eine Owner-Entscheidung.
