---
description: Sichert genau den verifizierten Stand des gebundenen Arbeitspakets ueber die endliche Git-Intent-API.
---

1. Lies den exakten Paket-, Scope-, Session- und Leaf-Bindungszustand. Ohne gueltige
   Bindung wird nichts gesichert und kein Repo geraten.
2. Fuehre `node harness-core/git/git-intent.mjs inspect --root <REPO> --session <SESSION> --json`
   aus. Verwende ausschliesslich die dort gebundenen Pfade.
3. Ein Leaf commitet waehrend einer parallelen Welle nicht selbst. Nach Ruecklauf aller
   Leaves fuehrt der Parent genau einmal
   `node harness-core/execution/package-executor.mjs integrate --harness-root <HARNESS_ROOT> --root <REPO> --package <ID> --scope <ID> --message "<TEXT>" --approve-checks --json`
   aus. `--approve-checks` erlaubt nur die im Ledger sichtbaren pending CHECK-Orakel;
   es ist keine blinde Gate-Freigabe.
4. Nur wenn fuer einen gebundenen, nicht parallelen Sonderfall ein einzelner Checkpoint
   ausdruecklich vorgesehen ist, verwende `git-intent.mjs checkpoint` mit den exakten
   `--path`-Werten. Versuche nie einen alternativen rohen Git-Befehl.
5. Eine Veroeffentlichung beginnt erst nach dem Package-Close. Der Owner sagt sein OK im
   Chat; danach laeuft genau ein Befehl:
   `package-executor.mjs publish --harness-root <HARNESS_ROOT> --root <REPO> --package <ID> --scope <SCOPE> --closure-receipt <CLOSURE_RECEIPT> --owner-ok "<WORTLAUT>" --json`.
   Er plant den Push, zeigt Repo, Branch, HEAD und Remote und legt die Owner-OK-Zeile im
   Publish-Beleg ab. Ohne `--owner-ok` bricht er ab; direkter `git-intent publish` ist
   kein Bedienweg.
6. Berichte Receipt, Commit und lokalen Reverify-Stand. Ein Commit oder Provider-Erfolg
   ersetzt weder Evidence noch Fulfillment des unveraenderlichen Owner-Auftrags.

Rohes `git add`, `git commit`, `git push`, `git restore`, `git checkout`, `git reset`
oder `git revert` ist kein Ausweichweg. Der Guard nennt fuer jede Absicht genau einen
getesteten Intent; fehlt er, stoppt die Arbeit mit einer Owner-Entscheidung.
