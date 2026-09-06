# Work package: <packageId>

> Work artifact per `working-method.md`: lives in the repository that owns the
> work (`user-projects/<name>/docs/packages/<packageId>/PACKAGE.md`; workbench
> work: `docs/packages/<packageId>/PACKAGE.md`). `GATES.md` and immediate
> `gates/*.md` sidecars are the executable acceptance contract. `.unlazy/` is
> ignored runtime only. Copy this file into the bundle as `PACKAGE.md` and
> create `OWNER.md` from `templates/OWNER.md` before activation.
> Sections stay in exactly this order; nothing appears between the PIG block
> and `## Plan`.

**Problem:** <what is concretely broken or wanted>
**Intent:** <why - what the solution shall achieve>
**Goal:** <the checkable target state>

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
