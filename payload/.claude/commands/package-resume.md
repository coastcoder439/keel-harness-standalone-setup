---
description: Setzt ausschließlich die exakt gebundene Paket-Session fort, ohne Pakete oder Leaves zu erraten.
---

Fuehre
`node <HARNESS_ROOT>/harness-core/execution/package-executor.mjs resume --harness-root <HARNESS_ROOT> --root <REPO> --package <ID> --scope <ID> --session <SESSION> --json`
aus. Lies anschließend den erzeugten Leaf-Brief. Bei fehlender oder veralteter
Bindung stoppen; nicht nach ähnlich benannten Paketen scannen und keine neue
Wahrheit im Chat anlegen.
