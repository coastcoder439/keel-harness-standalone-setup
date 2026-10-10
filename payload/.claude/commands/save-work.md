---
description: Sichert genau den verifizierten Stand des Arbeitspakets per Commit.
---

1. Bestimme das echte Repo und, falls ein Paket laeuft, Paket, Scope, Session und Leaf.
   Ohne eindeutiges Repo wird nichts gesichert und kein Repo geraten.
2. Pruefe den Stand mit `git status` (wahlweise
   `node harness-core/git/git-intent.mjs inspect --root <REPO> --session <SESSION> --json`)
   und sichere nur die verifizierten Pfade.
3. Ein Leaf commitet waehrend einer parallelen Welle nicht selbst. Nach Ruecklauf aller
   Leaves fuehrt der Parent genau einmal
   `node harness-core/execution/package-executor.mjs integrate --harness-root <HARNESS_ROOT> --root <REPO> --package <ID> --scope <ID> --message "<TEXT>" --approve-checks --json`
   aus. `--approve-checks` erlaubt nur die im Ledger sichtbaren pending CHECK-Orakel;
   es ist keine blinde Gate-Freigabe.
4. Einen einzelnen Checkpoint ausserhalb einer parallelen Welle sichert ein normaler Commit
   der verifizierten Pfade (wahlweise `git-intent.mjs checkpoint` mit `--path`-Werten).
5. Ein geschriebenes, noch nicht gestartetes Paket sichert ein Commit von OWNER.md,
   PACKAGE.md, GATES.md und gates/*.md; ein gestartetes Paket sichern der Leaf-Checkpoint
   oder integrate.
6. Eine Veroeffentlichung beginnt erst nach dem Package-Close. Der Owner sagt sein OK im
   Chat; danach laeuft genau ein Befehl:
   `package-executor.mjs publish --harness-root <HARNESS_ROOT> --root <REPO> --package <ID> --scope <SCOPE> --closure-receipt <CLOSURE_RECEIPT> --owner-ok "<WORTLAUT>" --json`.
   Er plant den Push, zeigt Repo, Branch, HEAD und Remote und legt den Owner-OK-Eintrag im
   Publish-Beleg ab (das Zitat der Owner-Nachricht, nie eine Satzform; Mehrzeiliges über
   `--owner-ok-file <DATEI>`). Ohne `--owner-ok` oder `--owner-ok-file` bricht er ab.
7. Berichte Receipt, Commit und lokalen Reverify-Stand. Ein Commit oder Provider-Erfolg
   ersetzt weder Evidence noch Fulfillment des unveraenderlichen Owner-Auftrags.

Git ist lokal frei. Nur Loeschen und Ueberschreiben auf GitHub braucht die ausdrueckliche
Erlaubnis des Owners im Chat.
