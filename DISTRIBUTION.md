# Keel Harness standalone delivery

This directory is the generic, project-local Keel Harness distribution. The
manifest names product version `1.1.0`, pins the exact Unlazy upstream base and
the adapted vendored tree, and assigns update and deprecation ownership. Build
provenance may name distributor source paths; installed content never carries
distributor sessions, accounts, project identity, local settings, or secrets.

The installed `dashboard/` directory contains the one production React/Next
Dashboard as five files: launcher, runtime smoke, safe archive reader, archive
manifest and a deterministic gzip archive. The reader verifies compressed and
per-file SHA-256 values, the exact sorted tree digest/count, paths and size
limits before it atomically materializes regular files under
`.keel-harness/runtime/dashboard/<tree-sha256>`. The former Vanilla renderer is
not a fallback and is not delivered. Optional Sharp image binaries are
excluded because image optimization is disabled; the packaged runtime contains
no platform-specific `.node`, `.dll`, `.so`, `.dylib`, or `.exe` files.

The sole launcher records its owner and child PID in an exclusive lease. A
live lease blocks reinstall, upgrade and uninstall; once stopped, stale leases
and superseded digest caches are cleaned by the transactional lifecycle. The
smoke check starts only that local HTTP runtime and reads `/` plus `/api/state`;
it never starts a model, Voice provider, microphone, or audio process.

## Transaction lifecycle

Install performs every read-only check before it creates `.keel-harness/`.
It computes one sorted conflict plan, renders every merge, stages and hashes
the complete desired payload, copies verified original backups, then promotes
each changed file on the target volume. Promotion uses a Windows-compatible
pair of renames: live file to transaction quarantine, then staged file to the
live path. The durable journal records each boundary.

Any caught payload, onboarding, or project-scoped plugin failure restores and
verifies every pre-install file before returning an error. A process crash
leaves the journal and quarantine intact; `rollback` completes the same
recovery explicitly. Successful installation retains only the first originals
and a small receipt under ignored `.keel-harness/` state.

```text
node install.mjs --target <repository> --dry-run
node install.mjs --target <repository>
node install.mjs status --target <repository>
node install.mjs doctor --target <repository>
node install.mjs rollback --target <repository>
node install.mjs uninstall --target <repository>
node install.mjs uninstall --target <repository> --purge-accountability-data
```

Uninstall first refuses a live Dashboard lease and verifies that managed files
still match the receipt, then
restores exact originals and removes files that did not exist before install.
It is idempotent. Drift blocks before writes; `--force` is the explicit route
when the Owner chooses backup restoration over later edits.

Uninstall restores the repository tree only. The Accountability data of the
installation lives outside the repository -- on Windows under
`%LOCALAPPDATA%\KeelHarness\accountability\<instance>`, elsewhere under
`$XDG_DATA_HOME/keel-harness/accountability/<instance>` -- and holds the Google
OAuth token (`google-token.json`) and the OAuth client file
(`google-client-secrets.json`) next to the local assistant store. Every uninstall
result (also `--dry-run`) names that directory and its credential files
(`accountabilityData` in `--json`, `accountability-data-left=` in plain output)
and leaves it in place. Disconnect Google in the Dashboard first (that revokes
the token at Google and deletes it), or run
`uninstall --purge-accountability-data`: the installer then revokes the stored
token best effort at `https://oauth2.googleapis.com/revoke` and removes the whole
instance directory. The grant itself can always be reviewed and withdrawn at
<https://myaccount.google.com/permissions>.

## Plugin and upgrade boundaries

`--install-codex-plugin` authorizes only the official project-scoped Claude
Code commands. The installer rejects a helper that contains user/global scope,
and a partial plugin install/uninstall is compensated through project-scoped
inverse commands before the managed project files are restored. Failed
compensation remains journaled for `doctor`/`rollback` recovery. Without that
flag, marketplace and plugin configuration are declared but no external command
runs.

```text
node install.mjs --target <repository> --install-codex-plugin
node install.mjs install --target <repository> --upgrade
```

Upgrade is explicit, monotonic SemVer only, requires every managed file and
backup to be clean, keeps the original pre-install backups, and uses the same
journal/rollback path. Full ownership and the `--legacy` retirement duty are
in [UPDATE.md](UPDATE.md) and duplicated mechanically in `manifest.json`.

An active flat `docs/packages/<id>.md` remains a hard error. Migrate it with
`vendor/unlazy/scripts/package-migrate.mjs`; installation never guesses legacy
semantics or creates a second package truth.

The recipient-specific `docs/active-harness-inventory.md` advertises only
commands that exist in the installation; `checks/installed-harness.mjs`
validates every listed acceptance target. Source-only governance/browser gates
remain with the distributor and do not become broken recipient commands.

Distributor checks:

```text
node checks/manifest-check.mjs
node checks/dashboard-list.mjs
node --test ../test/dashboard-runtime-archive.test.js
node checks/fresh-install.mjs
node ../checks/distribution-lifecycle.mjs
```
