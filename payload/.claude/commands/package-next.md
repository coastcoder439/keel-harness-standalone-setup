---
description: Bereitet das nächste Unlazy-Leaf für einen begrenzten Claude- oder offiziellen Codex-Plugin-Lauf vor.
---

1. Prüfe zuerst, dass `OWNER.md` unverändert ist. Führe exakt
   `node <HARNESS_ROOT>/harness-core/execution/package-executor.mjs next --harness-root <HARNESS_ROOT> --root <REPO> --package <ID> --scope <SCOPE> --session <SESSION> --provider claude|codex --json`
   aus.
2. Starte den Provider nur mit `package-dispatch`. Der Executor startet
   Codex-Leaves mit `codex exec`, ohne Wächter-Hooks; delegierte Codex-Arbeit
   nutzt `gpt-5.6-sol` mit `max`. `dispatch` führt den Start aus, nicht der
   aufrufende Agent daneben. Den Aufruf nennt die Ausgabe von next in
   `delegation.pluginCommand`; `dispatch` führt genau diesen Start aus.
3. Erfinde weder Run-ID noch nativen Task-Handle. Beide entstehen dauerhaft aus
   dem echten Provider-Lauf. Provider-Erfolg ist keine Evidence.
