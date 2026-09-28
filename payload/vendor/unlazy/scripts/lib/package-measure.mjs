// The one package measurement (Keel package standard).
//
// Every bundle of one repository is resolved once and inspected with the same
// inspectPackageBundle() that `package-cli status` uses, so plan, gate and
// status numbers are identical. Each record adds the package fields (Problem
// to Planned end) and the plan steps exactly as the schema read them, so a
// consumer needs no second Markdown parser. `package-cli measure --json`
// prints it; the dashboard imports this module in-process (no process per
// package, no process at all) with a repository root it has already verified.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { inspectPackageBundle, publicPackageStatus, PACKAGE_SCHEMA_VERSION } from "./package-schema.mjs";
import { resolveAllPackageTargets } from "./packages.mjs";

function collisionDiagnostics(root, packageId) {
  const flat = join(root, "docs", "packages", packageId + ".md");
  const directory = join(root, "docs", "packages", packageId, "PACKAGE.md");
  return existsSync(flat) && existsSync(directory)
    ? [{ code: "PACKAGE_LEGACY_COLLISION", file: "docs/packages/" + packageId + ".md", message: "flat package and bundle are both discoverable" }]
    : [];
}

export function packageMeasurement(status) {
  const parsed = status._internal.parsed;
  const title = parsed.text.match(/^# Work package: (\S.*)$/mu)?.[1]?.trim() || status.packageId;
  const pig = parsed.pig;
  return {
    ...publicPackageStatus(status),
    title,
    fields: {
      problem: pig.problem || "",
      intent: pig.intent || "",
      goal: pig.goal || "",
      scope: pig.scope || "",
      context: pig.context || "",
      plannedStart: pig.plannedStart || null,
      plannedEnd: pig.plannedEnd || null,
    },
    steps: parsed.plan.map((step) => ({ number: step.number, done: step.done, text: step.text })),
    offen: parsed.conclusion.offen || "",
  };
}

/**
 * options.root: repository root; options.repoKey: display key (default ".");
 * options.verifiedRoot: true when the caller already verified the root as the
 * real repository (skips the Git process of the resolver).
 */
export function measureRepositoryPackages(options = {}) {
  const targets = resolveAllPackageTargets(options);
  const repoRoot = targets[0]?.repoRoot ?? null;
  const packages = targets.map((target) => {
    const status = inspectPackageBundle(target);
    status.diagnostics.push(...collisionDiagnostics(target.repoRoot, status.packageId));
    return packageMeasurement(status);
  });
  return {
    schemaVersion: PACKAGE_SCHEMA_VERSION,
    repoRoot,
    repoKey: options.repoKey || ".",
    packageCount: packages.length,
    packages,
  };
}
