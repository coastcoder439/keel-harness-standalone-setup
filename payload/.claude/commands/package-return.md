---
description: Nimmt einen Agenten-Ruecklauf erst nach lokaler Leaf-Reverify an.
---

Fuehre `node harness-core/execution/package-executor.mjs return --harness-root <HARNESS_ROOT> --root <REPO> --package <ID> --scope <ID> --session <SESSION> --json` aus. Wenn die lokale Reverify scheitert, bleibt das Leaf laufend; repariere den Befund oder hole eine Owner-Entscheidung. Hake Evidence niemals wegen einer Provider-Meldung ab.
