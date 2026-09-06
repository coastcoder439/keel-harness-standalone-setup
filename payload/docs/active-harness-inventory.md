# Active Harness inventory

This is the product contract of the installed Keel Harness. Every path is
relative to the recipient repository. Distributor-only build gates, source
tests, machine state and project-specific work packages are intentionally not
advertised as installed commands.

## Installed capability governance

| Capability | Decision | Installed source | Lifecycle owner | Acceptance command |
|---|---|---|---|---|
| Repository ownership | retained | `.keel-harness.json`; `vendor/unlazy/scripts/lib/repository.cjs`; `harness-core/binding/repository.cjs` | canonical repository resolver | `node checks/installed-harness.mjs` |
| Immutable Owner request | retained | `templates/OWNER.md`; `vendor/unlazy/scripts/lib/owner-contract.cjs` | Owner-contract parser | `node vendor/unlazy/tests/full-suite.mjs` |
| Repo-owned package bundles | retained | `docs/packages/TEMPLATE.md`; `vendor/unlazy/scripts/package-cli.mjs`; `vendor/unlazy/scripts/lib/packages.mjs` | package resolver | `node vendor/unlazy/tests/full-suite.mjs` |
| Read before action | retained | `.claude/rules/keel/read-before-act.md`; `.claude/rules/keel/no-oneshot.md` | host rules and activation preflight | `node checks/installed-harness.mjs` |
| Seven-stage lifecycle | retained | `.claude/rules/keel/working-method.md`; `harness-core/execution/package-executor.mjs`; `vendor/unlazy/scripts/lib/package-lifecycle.mjs` | package executor | `node vendor/unlazy/tests/full-suite.mjs` |
| Bounded parallel fan-out | retained | `harness-core/execution/package-executor.mjs`; `vendor/unlazy/scripts/lib/dispatch.mjs` | package executor | `node vendor/unlazy/tests/full-suite.mjs` |
| Tool selection order | retained | `.claude/rules/keel/tools.md`; `docs/tool-sourcing.md` | tool-selection rule | `node checks/installed-harness.mjs` |
| Finite Git mutations | retained | `harness-core/git/git-intent.mjs`; `.claude/git-intent-guard.js`; `.codex/hook-runner.cjs` | Git intent API | `node checks/installed-harness.mjs` |
| Recoverable correction | retained | `harness-core/git/git-intent.mjs` | Git intent API | `node checks/installed-harness.mjs` |
| Destructive shell protection | retained | `.claude/danger-guard.js`; `.claude/shell-mutation-guard.js`; `.codex/hook-runner.cjs` | finite shell boundary | `node checks/installed-harness.mjs` |
| Write and secret boundary | retained | `.claude/write-guard.js`; `.claude/paket-gate.js`; `.codex/apply-patch-guard.cjs`; `harness-core/binding/package-binding.cjs` | exact package binding | `node checks/installed-harness.mjs` |
| Package assignment | retained | `.claude/package-context.js`; `harness-core/binding/package-bootstrap.cjs`; `harness-core/binding/package-binding.cjs` | package binding | `node checks/installed-harness.mjs` |
| Response reporting | retained | `.claude/prompt-form.js`; `.claude/dod-guard.js`; `.codex/dod-guard.cjs` | communication adapters | `node checks/installed-harness.mjs` |
| Local backup warning | retained | `.claude/uncommitted-warn.js` | local warning hook | `node checks/installed-harness.mjs` |
| Session roles and handoff | retained | `.claude/session-roles.js`; `.claude/sessionpost-guard.js`; `.claude/commands/tell-session.md`; `docs/08-sessions-rollen.md` | installation Owner | `node checks/installed-harness.mjs` |
| Onboarding and repository status | retained | `.claude/onboarding-start.js`; `.claude/repo-status.js`; `.claude/statusline.js`; `docs/harness-instance.md` | installation-context adapter | `node checks/onboarding-ready.mjs` |
| Completeness audit | retained | `.claude/skills/completeness/`; `.agents/skills/completeness/`; `docs/completeness-check.md` | package reviewer | `node checks/installed-harness.mjs` |
| Software Factory approvals | retained | `.claude/skills/software-factory/`; `.agents/skills/software-factory/` | package Gate ledgers and Owner decisions | `node checks/installed-harness.mjs` |
| Dashboard and UI verification | adapted | `dashboard/serve.mjs`; `dashboard/runtime-archive.mjs`; `dashboard/runtime-manifest.json`; `dashboard/runtime.keel.gz`; `dashboard/runtime-check.mjs` | installation Owner and verified runtime archive | `node dashboard/runtime-check.mjs` |
| Owner approval governance | retained | `harness-core/execution/owner-approval.mjs`; `harness-core/execution/package-executor.mjs` | external one-time approval consumer | `node vendor/unlazy/tests/full-suite.mjs` |
| Standalone delivery and maintenance | adapted | `.keel-harness/state.json`; `checks/installed-harness.mjs`; `checks/run-all.mjs`; `dashboard/runtime-manifest.json` | distribution maintainer and transactional installer | `node checks/run-all.mjs` |
| Claude and Codex execution | retained | `.claude/settings.json`; `.codex/hooks.json`; `.codex/config.toml`; `harness-core/execution/provider-runtime.mjs` | package executor through host-native adapters | `node checks/installed-harness.mjs` |

## Dashboard runtime contract

- `dashboard/serve.mjs` is the only Dashboard entry point. It verifies and
  atomically materializes the archive under
  `.keel-harness/runtime/dashboard/<tree-sha256>` before starting the local
  server with the recipient repository as both Harness and repository root.
- `dashboard/runtime-check.mjs` starts only the local HTTP runtime and checks
  `/` plus `/api/state`. It does not start a model, Voice provider, microphone
  or audio process.
- A live launcher owns an exclusive PID lease. Install, upgrade and uninstall
  fail closed while that lease is live. Stale leases and obsolete digest
  caches are removed by the transactional lifecycle.
- The former Vanilla renderer, Dashboard source tree, Sharp packages and all
  platform-specific `.node`, `.dll`, `.so`, `.dylib` and `.exe` files are not
  installed.

## Delivery exclusions

- Distributor-only browser, mutation, lifecycle, requirements and provenance
  gates stay in the distribution source and are not presented as recipient
  commands.
- `.unlazy/`, approval stores, credentials, local settings, Git internals and
  project-specific packages are runtime or Owner state, never payload truth.
- Voice/provider execution requires an explicit later user action. Neither
  installation nor any acceptance command in this inventory starts it.

`node checks/installed-harness.mjs` validates that every acceptance command in
this inventory resolves to a real installed regular file. `node checks/run-all.mjs`
then runs that contract, the React Dashboard HTTP smoke and the complete
vendored Unlazy suite.
