---
description: Bereitet das nächste Unlazy-Leaf für einen begrenzten Claude- oder offiziellen Codex-Plugin-Lauf vor.
---

1. Prüfe zuerst, dass `OWNER.md` unverändert ist. Führe exakt
   `node <HARNESS_ROOT>/harness-core/execution/package-executor.mjs next --harness-root <HARNESS_ROOT> --root <REPO> --package <ID> --scope <SCOPE> --session <SESSION> --provider claude|codex --json`
   aus.
2. Starte den Provider nur mit `package-dispatch`. Der Executor benutzt bei Codex
   Claude -> offizielles Projekt-Plugin `codex@openai-codex` mit
   `gpt-5.6-sol`/`max`; kein direkter `codex exec` und kein selbst gebauter Prompt.
   Der Rückgabewert `delegation.pluginCommand` dokumentiert diesen exakten Aufruf;
   `dispatch` führt ihn aus, nicht der aufrufende Agent daneben.
3. Erfinde weder Run-ID noch nativen Task-Handle. Beide entstehen dauerhaft aus
   dem echten Provider-Lauf. Provider-Erfolg ist keine Evidence.
