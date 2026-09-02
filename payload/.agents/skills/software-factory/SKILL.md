---
name: software-factory
description: Dex Horthy's 4-gate feature workflow — Product, Architecture, Program Design, Vertical Slices — with explicit owner approval at every gate before implementation code exists. Use when the owner asks for the 4-gate/software-factory process (/software-factory) or a work package names it; not auto-triggered by diff size.
---

# The Software Factory Playbook

<!-- Aenderungsvermerk keel-harness 25.08.2026: Description situativ
     eingedampft (Auto-Trigger auf "any task with several files" wuerde mit
     den Haus-Skills um jede echte Arbeit konkurrieren, Befund Commit 499131d)
     + Abschnitt "Hausanpassung" ergaenzt. Quelle: Gist Maciejdziuba/
     88890d7e0eeefa5a8738bbe9fd5e20b8, auditiert 25.08.2026 (keine Injektion,
     keine Skripte). -->

## Hausanpassung keel-harness (gewinnt bei Widerspruch)

- Das sichtbare Bundle `docs/packages/<packageId>/` bleibt der Master:
  `OWNER.md` trägt den Originalauftrag, `PACKAGE.md` PIG, Plan, Status und
  Abschluss; `GATES.md` und `gates/*.md` tragen Approval- und ausführbare
  Contracts. Design-Dokumente dürfen unter `design/` im Bundle liegen.
  Es gibt keine zweite Statusdatei und keine Checkliste außerhalb des Pakets.
- Genehmigungsfrage auf Deutsch: **"Gate N freigeben — oder was soll sich
  aendern?"** (Projektsprache, AGENTS.md §1). Statuswerte in Dateien duerfen
  englisch bleiben.
- Jede Abschluss-Meldung endet im Hausformat "Geprueft gegen: … · Offen: …";
  vor Fertig-/Uebergabe-Aussagen laeuft der Skill `completeness` (Coverage)
  plus der Fulfillment-Blick (working-method.md).
- Verify bei UI: "browser-test it" heisst hier ECHTER Screenshot, beide
  Themes, gegen die Design-Skills und die genehmigten Entwuerfe — auch fuer Mockups.
- Mapping zur Haus-Schleife: Gate 1 ≈ Problem/Intent, Gate 2+3 ≈ Depth Tree
  und Contract vor Fan-out, Gate 4 ≈ Bau+Verify; Zahlen werden gemessen, nie
  erinnert (Befehl daneben).

Dex Horthy's (HumanLayer) workflow: make every important decision **before** implementation code exists, where changing it costs a sentence instead of a rewrite. Work through four gates in order. Stop at each gate for explicit user approval. Never merge gates. Never write implementation code before the Gate 4 slice plan is approved.

## When to run the gates

Run the full workflow when the task is a real feature: it will create or change multiple files, add an endpoint, table, or screen, or produce a diff the user would hate to review all at once (roughly 100+ lines).

Skip the gates entirely (just do the task) when any of these hold:

- Trivial tweak: rename, typo, copy change, style tweak, small config edit.
- The user explicitly says to skip the process ("just vibe it," "quick and dirty," "no process").
- The user says the code is throwaway or pure prototyping.

If unsure whether the task qualifies, ask once: "This looks big enough for the 4-gate workflow — run it, or do you want the fast version?" Respect the answer.

## Files and state

All workflow files live inside the owning package bundle:

```
docs/packages/<packageId>/
  OWNER.md
  PACKAGE.md            only plan/status/closure ledger
  GATES.md              root and manual approval gates
  gates/                leaf/node contracts
  design/
    01-product.md
    mockups/             Gate 1 screen mockups — plain HTML
    02-architecture.md
    03-program-design.md
    04-slices.md
```

Create the package and immutable Owner contract first. Represent Gate 1–4
approvals as uniquely mapped manual gates in the package ledgers. Represent
vertical slices as Depth Tree leaves and numbered `PACKAGE.md` Plan rows.

**Resume rule:** resolve the exact owning repo/package and read `OWNER.md`,
PackageStatus, the design docs and Gate ledgers. Continue from the first open
manual approval gate or ready Leaf reported by the canonical tools. Never
infer state from chat and never create a second checklist.

## The approval protocol (run at every gate)

1. Write the gate doc to disk.
2. Present a summary to the user: at most 5–10 bullet decisions, plus the doc path. Do not paste the whole doc into chat.
3. Ask exactly: **"Approve Gate N, or what should change?"**
4. Approval means the user clearly says yes / approve / continue. Anything else means: revise the doc to address their answer, then re-ask.
5. On approval, record dated Owner Evidence on that one mapped manual Gate.
6. **Backtracking:** if a later gate invalidates an earlier decision, stop,
   demote that Gate Evidence to pending, revise its design doc and re-approve.

## Gate 1 — Product (no tech talk)

Work with the user to fill this template, saved as `01-product.md`:

```markdown
# Product: <feature name>

## Problem
<the user problem, in the end-user's words — not the developer's>

## Success metric
<one real number tied to the business (conversion, latency, tickets, revenue) and how it's measured>

## Announcement — the blog post before the feature
<3–6 sentences announcing this feature to users. If you can't write it, you're building the wrong thing.>

## Screens
<one line per mockup file in ./mockups/ — or "no UI">
```

Rules for this gate:

- **Banned in this stage:** databases, schemas, endpoints, architecture, file names. If tech appears, move it to Gate 2.
- For anything with a UI: produce one plain HTML file per screen in `mockups/` — no framework, no build step, throwaway by design. Iterate on the mockups with the user until they say "yes, that."

Run the approval protocol.

## Gate 2 — Architecture

Read the relevant existing code before writing this doc — never design against an imagined codebase. Template, saved as `02-architecture.md`:

```markdown
# Architecture: <feature name>

## Fit
<which existing services/modules this touches, and how>

## Endpoints
<route + verb + purpose, one line each — or "none">

## Data
<new or changed tables/collections, with outlines of the queries that will hit them>

## Flow
<the end-to-end call order for the main path: what calls what>

## External
<third-party APIs, env var NAMES (never values), webhooks — or "none">
```

Run the approval protocol.

## Gate 3 — Program Design (the step everyone skips)

The decisions the agent would otherwise make silently mid-implementation. Template, saved as `03-program-design.md`:

```markdown
# Program Design: <feature name>

## Files
<every file created or changed, one line each on why it lives there>

## Types & signatures
<code blocks defining the types and method signatures — NO implementation bodies.
A human should be able to read these in seconds and say "right" or "wrong.">

## Call stack
<for each main flow: what calls what, top to bottom>

## Test plan
<test case names and what each one asserts — before any of them exist>

## Least confident decisions
<numbered list of the calls most worth challenging now, while changing them is free>
```

Run the approval protocol.

## Gate 4 — Vertical Slices (tracer bullets)

First write the slice plan as `04-slices.md` — one line per slice, in build order — and run the approval protocol on it. Then build one slice at a time.

Slice rules:

- **Slice 1 is the tracer bullet:** a mocked/hardcoded endpoint and a stubbed UI (or curl-able response), wired end to end. It does almost nothing — but it runs, and the user can see it.
- **Slice 2:** replace mocks with the real logic for the single happy path.
- **Slice 3+:** one capability per slice — a business rule, error handling, an edge case, polish — each ending in a working, testable state.
- **Banned:** horizontal building (all of the database, then all services, then all API, then all frontend, with nothing testable until the end).

After **every** slice:

1. Prove it works — run it, curl it, or browser-test it, and show the user the result.
2. Return the Leaf through Package Executor local reverify. Plan state is
   derived later by integration Evidence; never tick a second checklist.
3. Ask: "Continue to slice N+1, or re-steer?" If the trajectory is wrong, fix direction before adding more code.

## Standing rules (always on during the workflow)

- **Compact at every boundary.** At the end of every gate and every slice, make sure the docs contain everything decided — nothing important may exist only in chat. Tell the user this is a safe point to start a fresh session; a new session must be able to continue from the docs alone (see the resume rule). If the harness warns that context is running low, compact immediately, wherever you are.
- **Keep diffs reviewable.** Small slices. If the user hasn't looked at code in a long stretch, nudge them at a slice boundary — losing touch with the codebase costs weeks, exactly when the agent hits a bug it can't solve.
- **Real tests only.** Never write a test that passes against the pre-change code — a test that can't fail tests nothing. Never comment out, skip, or weaken a test to get to green.

## Optional: durable context in the codebase

When a gate produces a decision that outlives this feature, offer to record it as an ADR in `docs/adr/NNNN-<slug>.md` — context, decision, consequences; never rewrite old ADRs, supersede them. Record anything that lives outside the repo but that an agent needs to know exists (env var names, payment setup, test accounts, third-party dashboards) in `docs/external/`. Files on disk are free context — every future session starts smarter.
