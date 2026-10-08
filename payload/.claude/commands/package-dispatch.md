---
description: Startet eine begrenzte native Provider-Welle, registriert echte Handles und versiegelt sie vor dem ersten Wait.
---

Führe genau einen Aufruf
`node <HARNESS_ROOT>/harness-core/execution/package-executor.mjs dispatch --harness-root <HARNESS_ROOT> --root <REPO> --package <ID> --scope <SCOPE> --wave <WAVE> --session <SESSION> [--session <SESSION> ...] [--cost-budget-usd <N>] [--token-budget <N>] --json`
aus. Alle vorbereiteten Leaves stehen vollständig in diesem Aufruf; über acht und unter der
RAM-Untergrenze reiht der Executor sie in die Warteschlange. Der
Executor startet Claude nativ beziehungsweise Codex ausschließlich über das
offizielle Claude-Projekt-Plugin und übernimmt nur dessen echten nativen Handle.
Schneide die Leaves nach zusammenhängenden Dateien, nicht nach Bereichen: ein Leaf sind die Dateien,
die zusammen geändert und geprüft werden. Vier Agenten je Bereich kosteten 11 Wellen, eine fehlende
Kennung allein vier. Eine Kleinständerung (eine Kennung, ein Text) ist ein Schritt oder geht den
leichten Weg: der Orchestrator schreibt `evidence/` und `design/` seines Pakets selbst.
`--member` existiert nicht. Warte erst nach versiegeltem Dispatch.
