# Distribution update contract

- Product: `keel-harness`
- Current version: `1.1.0`
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

The production Dashboard is delivered as a platform-neutral verified archive.
Rebuild its production Next runtime before rebuilding the standalone payload;
never carry forward `runtime.keel.gz` across a Dashboard or lockfile change.
Upgrade fails closed while the installed Dashboard lease is live, then removes
obsolete Dashboard digest caches after the new manifest is promoted. Uninstall
removes the archive files, stale lease and all materialized Dashboard caches.

## Owned deprecations

There is currently **no open deprecation**. The previously listed removal of the vendored
Unlazy explicit `--legacy` diagnostic mode is complete: the surface no longer exists in the
vendored tree, so its dated contract was retired with version 1.1.1 (it would otherwise
have failed every recipient's verification from 2026-11-01).

The mechanism stays: `manifest.maintenance.deprecations` lists owned, dated removals, and
artifact verification refuses an expired entry fail-closed. Any future deprecation must
therefore be planned as a package with a named owner and a removal date, and the owner
must remove the surface, bump the product version, rebuild the standalone payload and
rerun the complete distribution lifecycle check before that date.

