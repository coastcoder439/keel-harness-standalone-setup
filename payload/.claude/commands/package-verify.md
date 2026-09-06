---
description: Reverifiziert ein exakt gebundenes Leaf lokal; Provider-Erfolg gilt nicht als Evidence.
---

Fuehre ausschließlich
`node <HARNESS_ROOT>/harness-core/execution/package-executor.mjs verify --harness-root <HARNESS_ROOT> --root <REPO> --package <ID> --scope <ID> --session <SESSION> --json`
aus. Das echte Git-Repo und die gebundene Session müssen übereinstimmen. Berichte
das lokale Ergebnis; ändere weder Planhaken noch Gate-Text von Hand.
