---
name: resolving-merge-conflicts
description: "Use when you need to resolve an in-progress git merge/rebase conflict."
---

> Kuratierte Kopie aus `mattpocock/skills` (MIT, © 2026 Matt Pocock), uebernommen 01.08.2026
> [Beschluss D3, Auftraggeber]. Original + Lizenz: `lizenzen/LICENSE-mattpocock-skills.txt` (im Paket). Punkt 6 ist
> eine **[Werkbank]**-Ergaenzung.

1. **See the current state** of the merge/rebase. Check git history, and the conflicting files.

2. **Find the primary sources** for each conflict. Understand deeply why each change was made, and what the original intent was. Read the commit messages, check the PRs, check original issues/tickets.

3. **Resolve each hunk.** Preserve both intents where possible. Where incompatible, pick the one matching the merge's stated goal and note the trade-off. Do **not** invent new behaviour. Always resolve; never `--abort`.

4. Discover the project's **automated checks** and run them — typically typecheck, then tests, then format. Fix anything the merge broke.

5. **Finish the merge/rebase.** Stage everything and commit. If rebasing, continue the rebase process until all commits are rebased.

6. **[Werkbank]** Im geteilten Werkbank-Repo (mehrere Sitzungen, EIN Index — CLAUDE.md,
   Abschnitt Sichern) vor dem Abschluss `git status` lesen und pruefen, dass nichts
   **Fremdes** gestaged ist: Der Merge-Commit nimmt den ganzen Index mit; fremd Gestagedes
   erst ausklammern (`git restore --staged <fremd>`), dann abschliessen.
