---
description: Startet eine begrenzte native Provider-Welle, registriert echte Handles und versiegelt sie vor dem ersten Wait.
---

Führe genau einen Aufruf
`node <HARNESS_ROOT>/harness-core/execution/package-executor.mjs dispatch --harness-root <HARNESS_ROOT> --root <REPO> --package <ID> --scope <SCOPE> --wave <WAVE> --session <SESSION> [--session <SESSION> ...] --deadline-seconds <S> --start-timeout-seconds <S> --json`
aus. Maximal acht vorbereitete Leaves stehen vollständig in diesem Aufruf. Der
Executor startet Claude nativ beziehungsweise Codex ausschließlich über das
offizielle Claude-Projekt-Plugin und übernimmt nur dessen echten nativen Handle.
`--member` existiert nicht. Warte erst nach versiegeltem Dispatch.
