# Distribution update contract

- Product: `keel-harness`
- Current version: see `manifest.json` `product.version` (single source of truth; no version number is kept in this file)
- Update owner: **Keel Harness distribution maintainer**
- Version policy: monotonic SemVer; a changed artifact without a version bump
  is rejected.

## Upgrade route

1. Rebuild `manifest.json` and `payload/` from the integrated source tree.
2. Run the distribution lifecycle and manifest checks on Windows without a
   live target.
3. Inspect with `status` and `doctor`.
4. Upgrade only through
   `node install.mjs install --target <repository> --upgrade`.

Upgrade requires clean managed files and intact original backups. It renders
the new payload from those originals, stages the complete result, promotes it
through the journal, and restores the previously installed version if any
step fails. Downgrade requires an explicit uninstall followed by installation
of the chosen older artifact.

Four targets are Owner data, not distribution content, and are exempt from the
clean-files rule: `.claude/launch.json` (dev servers), `docs/08-sessions-rollen.md`
(running session roles), `docs/harness-instance.md` and `docs/tool-landscape.md`. A fresh
installation lays the template down only where the file is absent; an existing file
stays untouched, and every later edit is a local change that never blocks `status`,
`doctor` or `--upgrade`. An upgrade never rewrites such a file and an uninstall keeps an
edited one. `launch.json` and `08-sessions-rollen.md` became Owner data in 1.3.10
(before, each edit there was drift and locked the Dashboard update button); state
written by an older release is accepted and reclassified by the next upgrade.

An Owner file that an earlier release delivered and this one no longer does (`RETIRED_OWNER_TARGETS` in
`lib/distribution-lifecycle.mjs`, today the policy file of the removed blocking hooks) is still listed as
Owner data by an installation made by that release. The next upgrade leaves the installed copy exactly as it
is, edited or not (not deleted, not changed), and stops managing it.

Hooks of earlier releases are withdrawn on install and upgrade. `mergeHooks` removes the blocking
PreToolUse hooks the product delivered before (`RETIRED_PRODUCT_HOOKS`: Claude entries in both the whole-command
form and the exec form with args, and the Codex runner entries in `.codex/hooks.json`) from `.claude/settings.json`
and `.codex/hooks.json`, recognised by their exact identity (command and args); `dod-guard`, `unlazy-stop` and
every user hook stay. The only PreToolUse hook left is `github-delete-guard`. Files the product no longer
delivers (the scripts of the removed hooks) are removed from the installation by the upgrade because the
installer created them; a managed file with local edits blocks the upgrade as drift.

The production Dashboard is delivered as a platform-neutral verified archive.
Rebuild its production Next runtime before rebuilding the standalone payload;
never carry forward `runtime.keel.gz` across a Dashboard or lockfile change.
Upgrade fails closed while the installed Dashboard lease is live, then removes
obsolete Dashboard digest caches after the new manifest is promoted. Uninstall
removes the archive files, stale lease and all materialized Dashboard caches.

## Owned deprecations

There is currently **no open deprecation**. The vendored Unlazy explicit `--legacy`
diagnostic mode still exists and stays explicitly callable without a removal date; its
dated contract (removal on 2026-10-31) was retired with version 1.1.1 and is not planned
again.

The mechanism stays: `manifest.maintenance.deprecations` lists owned, dated removals, and
artifact verification refuses an expired entry fail-closed. Any future deprecation must
therefore be planned as a package with a named owner and a removal date, and the owner
must remove the surface, bump the product version, rebuild the standalone payload and
rerun the complete distribution lifecycle check before that date.

## Uninstall and Accountability data

`node install.mjs uninstall --target <repository>` restores the repository tree
and reports the installation's Accountability data directory outside the
repository (Google OAuth token `google-token.json`, OAuth client file
`google-client-secrets.json`, local assistant store). Nothing outside the
repository is removed unless the Owner passes `--purge-accountability-data`,
which revokes the stored token at Google best effort and removes the directory.
The installer and the Dashboard derive that directory identically (instance key =
first 16 hex characters of the SHA-256 of the resolved Harness root); the
Dashboard test `google-credential-paths.test.ts` measures the two derivations
against each other, so an update that moves the directory must change both. The
installer checks the canonical and the resolved spelling of the target, because
a Windows 8.3 short name and the long name of one directory hash to different
instance keys; every existing instance directory is reported and, on purge,
removed.
