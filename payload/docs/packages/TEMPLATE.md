# Work package: <packageId>

> Work artifact per `working-method.md`: lives in the repository that owns the
> work (`user-projects/<name>/docs/packages/<packageId>/PACKAGE.md`; workbench
> work: `docs/packages/<packageId>/PACKAGE.md`). `GATES.md` and immediate
> `gates/*.md` sidecars are the executable acceptance contract. `.unlazy/` is
> ignored runtime only. Copy this file into the bundle as `PACKAGE.md` and
> create `OWNER.md` from `templates/OWNER.md` before activation.
> Sections stay in exactly this order; nothing appears between the field block
> and `## Plan`. Package standard (enforced by `package-cli lint` when
> `.keel-harness.json` sets `packageContract.standardFormatRequired`): one line
> each for Problem, Intent, Goal, Scope and Context in this order; Scope reads
> `Drin: ... Nicht drin: ...` (Goal says how the end is recognised, Scope what
> belongs to the package and what explicitly does not; the leaf `OWNS:` lists
> stay the file ownership). Optional, directly under Context:
> `**Planned start:** YYYY-MM-DD` and `**Planned end:** YYYY-MM-DD` (real
> dates, start not after end; lint checks them wherever they appear).
> Every plan step is exactly one line; a step that needs sub-points becomes
> several numbered steps.
> UI work copies what is finished: every UI step names the finished building
> blocks it reuses (file, component) and only adapts data and labels — nothing
> new and nothing removed without an owner order [Owner 26.09.2026: „Fertiges
> kopieren und anpassen, nichts Neues"]. Dashboard work reads the work deck
> `test-harness/dashboard/DESIGN.md` first and takes its build order from its
> template (section 10).

**Problem:** <what is concretely broken or wanted>
**Intent:** <why - what the solution shall achieve>
**Goal:** <the checkable target state>
**Scope:** Drin: <what belongs to this package> Nicht drin: <what explicitly does not, with the package that owns it>
**Context:** <short measured starting point: sources, numbers, neighbouring packages>

## Plan

1. [ ] <one bounded action>
2. [ ] <one bounded action>

## Status

<date> - <what happened last, with evidence; newest entry first>

## Abnahme

Criteria derived from the immutable `OWNER.md` requirements and the Goal, then
mapped exactly once to qualified gate IDs. Every `R<n>` in `OWNER.md` names the
`C<n>` that owns its proof; the Plan is never the requirement denominator.
Write plain dashes, never checkboxes: only consecutive numbered checkboxes
inside `## Plan` are plan steps. Contract IDs are consecutive.

- C1 -> GATES.md:G1: <command, test name, or observable outcome>

## Abschluss

Coverage: <covered>/<required> contract outcomes mapped and met.
Fulfillment: <erfuellt | teilweise | nicht erfuellt - does the Goal hold?>
Geprueft gegen: <tests, commands, and sources that prove the Goal>
Offen: <empty only after `package-cli.mjs close`; plan completion alone never closes>

## Anhang

<optional reference material; never gate definitions>

Before any fan-out, replace the placeholder below with one complete, acyclic
tree. Every root and every immediate `gates/*.md` ledger occurs exactly once;
dependencies name owning ledgers and all paths lead bottom-up to `GATES.md`.
Solo packages omit this block.

### Depth Tree

- ROOT GATES.md <- none: <root outcome>
- LEAF gates/leaf-<name>.md <- GATES.md: <independent outcome>
- NODE gates/node-<name>.md <- gates/leaf-<name>.md: <integration outcome>
