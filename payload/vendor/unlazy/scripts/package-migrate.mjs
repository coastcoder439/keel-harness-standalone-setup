#!/usr/bin/env node

import {
  applyLegacyMigration,
  dryRunLegacyMigration,
  resumeLegacyMigration,
  rollbackLegacyMigration,
} from "./lib/package-migration.mjs";

const HELP = `usage: package-migrate.mjs [--dry-run | --apply | --resume | --rollback] --package ID [--root DIR] [--json]

Migrates exactly one docs/packages/<id>.md into one repository-owned bundle.
Dry-run is the default. Apply requires an unambiguous semantic mapping, an
ignored .unlazy/ runtime, an unchanged source and unchanged Git index bytes.
Resume and rollback are explicit crash-recovery actions.

exit codes: 0 success; 1 semantic migration blocker; 2 usage/schema;
            3 lock, index, ownership, or concurrent-change conflict.`;

function parseArgs(argv) {
  const options = { mode: "dry-run", json: false };
  const modes = new Set(["--dry-run", "--apply", "--resume", "--rollback"]);
  let selected = false;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") return { help: true };
    if (modes.has(arg)) {
      if (selected) throw new Error("migration modes are mutually exclusive");
      selected = true;
      options.mode = arg.slice(2);
      continue;
    }
    if (arg === "--json") { options.json = true; continue; }
    if (arg === "--root" || arg === "--package") {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new Error(arg + " needs a value");
      const key = arg === "--root" ? "root" : "packageId";
      if (options[key]) throw new Error("duplicate " + arg);
      options[key] = value;
      continue;
    }
    throw new Error("unknown option " + arg);
  }
  if (!options.packageId) throw new Error("--package ID is required");
  return options;
}

let options;
try { options = parseArgs(process.argv.slice(2)); }
catch (error) {
  console.error("package-migrate: " + error.message);
  process.exitCode = 2;
}

if (options?.help) {
  console.log(HELP);
} else if (options) {
  try {
    const common = { root: options.root, packageId: options.packageId };
    const result = options.mode === "apply"
      ? applyLegacyMigration(common)
      : options.mode === "resume"
        ? resumeLegacyMigration(common)
        : options.mode === "rollback"
          ? rollbackLegacyMigration(common)
          : dryRunLegacyMigration(common);
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else if (options.mode === "dry-run") {
      console.log((result.migrationBlocked ? "BLOCKED " : "READY ") + result.packageId +
        "; " + result.semantic.plan.length + " plan step(s), " + result.semantic.contract.length + " gate mapping(s)");
      for (const blocker of result.blockers) console.log("  " + blocker.code + ": " + blocker.message);
      if (result.migrationBlocked) process.exitCode = 1;
    } else {
      console.log(result.state + " " + result.packageId);
    }
  } catch (error) {
    console.error("package-migrate: " + error.message);
    process.exitCode = error.exitCode || 2;
  }
}
