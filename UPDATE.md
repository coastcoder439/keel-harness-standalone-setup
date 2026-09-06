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

## Owned deprecation

The **Keel Harness distribution maintainer** owns removal of the vendored
Unlazy explicit `--legacy` diagnostic mode on **2026-10-31**. Before removal,
the owner must prove that repo-owned `docs/packages/<packageId>/` bundles and
`vendor/unlazy/scripts/package-migrate.mjs` cover remaining transition needs,
remove the legacy CLI/tests/docs together, bump the product version, rebuild
the standalone payload, and rerun the complete distribution lifecycle check.
