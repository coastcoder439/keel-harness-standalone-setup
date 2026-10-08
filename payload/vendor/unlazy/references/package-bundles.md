# Package bundle contract

This document is the normative package contract for schema version `1`. The
words MUST, MUST NOT, SHOULD, and MAY are used in their RFC 2119 sense.

## Ownership and identity

A package is owned by exactly one repository and has the identity
`{canonicalRepoRoot, packageId}`. `canonicalRepoRoot` is the real path of the
nearest ancestor that contains a real `.git` directory or a regular `.git`
file. Resolution only walks upward; it never searches child repositories.

`packageId` and `scope` MUST match
`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`. On Windows, names that differ only by case
are ambiguous within one repository. Equal names in different repositories are
independent.

The sole versioned source of truth is this bundle:

```text
docs/packages/<packageId>/
  PACKAGE.md
  GATES.md
  gates/
    .gitkeep
    leaf-*.md
    node-*.md
```

`GATES.md` is required. `gates/` is required and contains either `.gitkeep` or
immediate regular Markdown sidecars. A sidecar MUST NOT be reached through a
link. Gate order is root ledger first, then sidecars sorted by ordinal file
name. Root `GATES.md`, root `gates/`, flat `docs/packages/<id>.md`, and
`.unlazy/<scope>/{PLAN.md,GATES.md,gates/}` are legacy data. Package mode MUST
NOT discover them. A diagnostic command MAY read them only with `--legacy`.

## Runtime boundary

`.unlazy/` is ignored, disposable repository-local runtime state. It MUST NOT
contain a versioned plan or gate ledger. Activating a package creates:

```text
.unlazy/<scope>/package.ref
.unlazy/<scope>/session
.unlazy/<scope>/status.log
.unlazy/<scope>/hook-state.json
.unlazy/<scope>/dispatch.json
.unlazy/locks/
```

`package.ref` is exactly one non-empty UTF-8 line terminated by one newline:
`docs/packages/<packageId>`. Backslashes, blank lines, NUL, absolute paths,
drive or UNC prefixes, `.` and `..` segments, links, and targets outside the
same repository are invalid. Two scopes in one repository MUST NOT activate
the same package. Scope names in different repositories do not collide.

Approvals live outside the repository under `~/.unlazy/approved/` or a verified
`UNLAZY_APPROVAL_DIR`. Approval identity is machine-bound. Evidence written to
a ledger is portable: it contains only a repository-relative `cwd`, a stable
`shellId`, exit/match facts, and an output digest. It MUST
NOT contain an absolute repository, home, shell, or approval-store path.
Evidence lines written by earlier versions may still carry an `oracleDigest=sha256:...`
field. It is no longer written and is ignored when read; those lines stay valid.

## Resolver precedence

Package selection uses this exact precedence and stops on ambiguity:

1. explicit `--package`
2. explicit `--scope`
3. `UNLAZY_PACKAGE`
4. `UNLAZY_SCOPE`
5. exactly one matching session binding
6. exactly one valid active scope

`--package` permits read-only lint, status, doctor, and gate diagnostics without
runtime state. Claims, dispatch, bind, hooks, and close require a valid active
scope and matching `package.ref`. `--root` is an assertion, not a search start:
after canonicalization it MUST itself be the nearest repository root.

Package ownership claims address exactly one `gates/leaf-*.md` sidecar. `OWNS`
is read only from that addressed file; root and `node-*` ledgers cannot be
claimed. A package lease is repository-local under `.unlazy/locks/` and stores
schema `2`, `scope`, `packageId`, the exact leaf id, its repository-relative
ledger path, and normalized globs. Package release matches both `scope` and
`packageId`; legacy, malformed, and foreign lease records are never deleted by
that operation. An explicit package/scope/leaf release remains available after
loss of `package.ref`, but gains no other recovery capability.

Package dispatch state uses schema `2`. Both the dispatch document and every
wave store the same `scope` and `packageId`; every transition validates that
identity before mutation. `PackageStatus.dispatch` reduces only this exact
state. Schema-1 dispatch is accepted solely by an explicit `--legacy` command.

The canonical resolver returns a `PackageTarget` with these fields:

```json
{
  "repoRoot": "<canonical absolute adapter-only path>",
  "repoKey": ".",
  "packageId": "work-loop-enforcement",
  "packageDir": "<canonical absolute adapter-only path>",
  "packageFile": "<canonical absolute adapter-only path>",
  "gateFiles": ["<canonical absolute adapter-only path>"],
  "scope": "work-loop-enforcement"
}
```

## Bundle schema

`PACKAGE.md` has exactly this level-two section sequence:

1. `## Plan`
2. `## Status`
3. `## Abnahme`
4. `## Abschluss`
5. `## Anhang`

Before `## Plan` it contains exactly one non-empty `Problem`, `Intent`, and
`Goal` field. Plan progress counts only lines matching
`^N. [ ] text$` or `^N. [x] text$` inside `## Plan`, with consecutive numbers
starting at 1. Checkboxes outside `## Plan` are invalid. Gate definitions and
`CHECK:`, `EXPECT:`, `EVIDENCE:`, `OWNS:`, or `ABANDON:` statements are invalid
inside `PACKAGE.md`; they belong to the bundle ledgers.

For a fan-out bundle, `## Anhang` contains exactly one complete Depth Tree
before activation or dispatch:

```text
### Depth Tree

- ROOT GATES.md <- none: root integration outcome
- LEAF gates/leaf-api.md <- GATES.md: independent API outcome
- NODE gates/node-release.md <- gates/leaf-api.md: release integration outcome
```

The grammar is `- <ROOT|LEAF|NODE> <ledger> <- <comma-space dependencies|none>: <outcome>`.
Every live ledger occurs exactly once, roles match `GATES.md`,
`gates/leaf-*.md`, or `gates/node-*.md`, dependencies name live ledgers, the
graph is acyclic, and every sidecar reaches `GATES.md`. A solo bundle may omit
the Depth Tree. Fan-out without it is schema-invalid before any claim or wave.

Every non-blank `## Abnahme` line is a contract mapping with this exact form:

```text
- C1 -> GATES.md:G1: observable acceptance outcome
- C2 -> gates/leaf-1.md:G2: observable leaf outcome
```

Contract IDs are consecutive. Every live qualified gate is mapped exactly once;
an unknown, missing, or duplicate mapping is invalid. This makes
`contract.required` a stored denominator rather than an inferred count.

`PackageStatus` is one of `draft`, `active`, `blocked`, `handoff`, `closable`,
`closed`, or `invalid`. Plan completion alone never produces `closed`.
Plan, gate, dispatch, and contract coverage are independent dimensions.
`contract.required` is the denominator of required outcomes and MUST be a
positive integer for a closable or closed package. Missing or partial contract
mapping makes the package invalid or non-closable; it is never inferred from
the number of plan steps.

## Adapter JSON

`package-cli.mjs status --json` emits exactly one JSON value and no prose. Every
adapter MUST reject an unknown `schemaVersion` and a missing contract
denominator. Schema version `1` has this minimum shape:

```json
{
  "schemaVersion": 1,
  "repoRoot": "<local absolute path; adapter-only>",
  "repoKey": ".",
  "packageId": "work-loop-enforcement",
  "packageFile": "docs/packages/work-loop-enforcement/PACKAGE.md",
  "scope": "work-loop-enforcement",
  "lifecycle": "active",
  "status": "active",
  "plan": { "total": 8, "done": 3, "nextStep": 4 },
  "gates": { "total": 9, "met": 3, "unmet": 6, "handoff": 0 },
  "dispatch": { "state": "idle", "unfinished": 0 },
  "contract": { "covered": 12, "required": 12 },
  "closable": false,
  "diagnostics": [],
  "digest": "sha256:<package-content-digest>"
}
```

Multi-repository displays qualify packages as `repoKey::packageId`. Gate IDs
are `<packageId>/<repo-relative-ledger>:<gateId>`; a cockpit prepends
`repoKey::`. Bridge mutations send only `{repoKey, packageId, stepNumber,
expectedDigest}`. The server resolves the target again and changes exactly one
numbered plan line only when the digest still matches.

## Lifecycle and exit codes

`create` writes an undiscoverable temporary directory, validates it, and then
publishes the bundle atomically. `activate` validates the bundle and ignore
boundary before writing runtime. `close` re-verifies every runnable gate and
requires complete plan, contract, and dispatch coverage; it rejects `ABANDON`,
`DEFER`, open owner decisions, stale evidence, and a contradictory Abschluss.
It releases only leases belonging to that package and removes only its scope.
The versioned bundle remains as history.

All package and gate commands use the same process exit codes:

| Code | Meaning |
|---:|---|
| `0` | Valid request and all required outcomes met, or successful mutation |
| `1` | Valid request but incomplete, blocked, handoff, or gate failure |
| `2` | Usage, schema, resolver, security, parse, or infrastructure failure |
| `3` | Ownership/lease conflict |

No command may stage, commit, scan another repository, silently choose between
legacy and bundle truth, or report closure solely from plan checkboxes.
