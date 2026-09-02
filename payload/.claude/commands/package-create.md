---
description: Erfasst den unveraenderlichen Owner-Auftrag und baut ein neues Unlazy-Paket im exakt besitzenden Git-Repo.
---

1. Bestimme das echte Git-Repo, das die Arbeit besitzt. Starte genau eine begrenzte
   Planungsbindung:
   `node <HARNESS_ROOT>/harness-core/execution/package-bootstrap.mjs begin --harness-root <HARNESS_ROOT> --root <REPO> --package <ID> --scope <ID> --session <PLANER_SESSION> --json`.
2. Schreibe in diesem Bundle zuerst den Originalauftrag unveraendert nach `OWNER.md`.
   Leite danach Requirements `R -> C`, PIG, Plan, den vollstaendigen Depth Tree,
   disjunkte `OWNS`, Abhaengigkeiten und Gate-Orakel ab. Die Bootstrap-Bindung erlaubt
   ausschliesslich `OWNER.md`, `PACKAGE.md`, `GATES.md` und unmittelbare `gates/*.md`.
3. Pruefe den fertigen Vertrag read-only mit
   `node <HARNESS_ROOT>/vendor/unlazy/scripts/package-cli.mjs doctor --root <REPO> --package <ID>`.
   Keine Platzhalter, Ueberschneidungen, ungemappten Requirements oder zweiten Statusorte
   duerfen verbleiben.
4. Bereite das erste Leaf ueber
   `package-executor.mjs start --harness-root <HARNESS_ROOT> --root <REPO> --package <ID> --scope <ID> --session <LEAF_SESSION> --leaf <LEAF> --provider codex --bootstrap-session <PLANER_SESSION> --json`
   vor. Erst dieser erfolgreiche Schritt beendet die Planungsbindung und aktiviert die
   normale Unlazy-Laufzeit.
5. Ab jetzt gelten nur noch Claims, Leaf-Bindungen, Dispatch-Waves und lokale Evidence.
   Der Originalauftrag bleibt unveraenderlich; Plan und Goal ersetzen ihn nie.
