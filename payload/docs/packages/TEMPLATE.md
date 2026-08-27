# Work package: <name>

> Work artifact per `working-method.md`: lives IN THE REPO OF ITS PROJECT
> (`user-projects/<name>/docs/packages/<package>.md`; workbench work: workbench
> `docs/packages/`) — so the plan lands on GitHub together with its project.
> Created at planning time, updated at every package close. A plan the owner
> cannot see does not exist. The command bridge reads all packages through this
> one structure. Sections in exactly this order; nothing between the PIG block
> and `## Plan`.

**Problem:** <what is concretely broken or wanted>
**Intent:** <why — what the solution shall achieve>
**Goal:** <the checkable target state>

## Plan

1. [ ] <step — one bounded action>
2. [ ] <step>

## Status

<date> — <what happened last, with evidence; newest entry first>

## Abnahme

Criteria derived from the Goal — one runnable command or observable state per
line. Written as plain dashes, NOT checkboxes: the command bridge counts every
checkbox in the file as a plan step, so a checkbox here falsifies the progress
number.

- <criterion: command, test name, or observable state>

## Abschluss

Coverage: <everything addressed? — the `completeness` skill on handovers>
Fulfillment: <erfuellt | teilweise | nicht erfuellt — does the GOAL hold, not
merely work happened; one sentence why>
Geprueft gegen: <the tests/commands/sources that prove the Goal>
Offen: <list — empty ONLY when the package is closed; a package with an empty
Offen and unchecked plan steps is a contradiction>

## Anhang

<optional: reference material, tables, candidate lists — nowhere else>
