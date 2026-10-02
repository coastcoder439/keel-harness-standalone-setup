"use strict";

// The one definition of a package bundle's contract files: OWNER.md, PACKAGE.md,
// GATES.md and the leaf/node ledgers directly under gates/. design/, evidence/
// and everything else in the package directory are not bundle files. The
// bundle-checkpoint mode of git-intent.mjs saves exactly this set; the package
// bootstrap and the package amendment route read the same pattern (the latter
// with owner:false, because OWNER.md stays immutable there).

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function bundleFilePattern(packageId, { owner = true } = {}) {
  const names = [...(owner ? ["OWNER\\.md"] : []), "PACKAGE\\.md", "GATES\\.md", "gates/[A-Za-z0-9][A-Za-z0-9._-]*\\.md"];
  return new RegExp("^docs/packages/" + escapeRegExp(packageId) + "/(" + names.join("|") + ")$", "u");
}

function isBundleFile(relative, packageId, options) {
  return bundleFilePattern(packageId, options).test(String(relative).replaceAll("\\", "/"));
}

module.exports = { bundleFilePattern, isBundleFile };
