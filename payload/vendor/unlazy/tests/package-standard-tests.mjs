// Keel package standard: Scope, Context and planned dates in PACKAGE.md,
// package-cli create with an Owner contract skeleton, and the one package
// measurement (package-cli measure) that reads every bundle in one process.

import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolvePackageTarget } from "../scripts/lib/packages.mjs";
import { inspectPackageBundle, parsePackageDocument } from "../scripts/lib/package-schema.mjs";
import { prepareLegacyMigration } from "../scripts/lib/package-migration.mjs";
import { initRepository } from "./helpers/git-repo.mjs";
import { emitTestCounts } from "./helpers/test-counts.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, "..", "scripts", "package-cli.mjs");
const suiteRoot = mkdtempSync(join(tmpdir(), "unlazy-package-standard-"));

const STANDARD_CONFIG = { schemaVersion: 1, packageContract: { ownerContractRequired: true, standardFormatRequired: true } };
const OWNER_ONLY_CONFIG = { schemaVersion: 1, packageContract: { ownerContractRequired: true } };

function repo(name, config = STANDARD_CONFIG) {
  const root = join(suiteRoot, name);
  initRepository(root);
  if (config) writeFileSync(join(root, ".keel-harness.json"), JSON.stringify(config, null, 2) + "\n", "utf8");
  return root;
}

const DEFAULT_FIELDS = [
  "**Problem:** A concrete outcome is missing.",
  "**Intent:** Build it under an executable acceptance contract.",
  "**Goal:** The observable outcome is present and verified.",
  "**Scope:** Drin: the observable outcome and its test. Nicht drin: any neighbouring package.",
  "**Context:** Measured today; nothing is built yet.",
];

function packageText(packageId, fields = DEFAULT_FIELDS) {
  return `# Work package: ${packageId}

${fields.join("\n")}

## Plan

1. [ ] Implement the observable outcome.
2. [x] Measure the starting point.

## Status

Draft package; work has not started.

## Abnahme

- C1 -> GATES.md:G1: The observable outcome is verified.

## Abschluss

Coverage: contract mapping recorded.
Fulfillment: nicht erfuellt - work remains.
Geprueft gegen: bundle gates.
Offen: Implementation and verification.

## Anhang

No additional material.
`;
}

function ownerText(packageId) {
  return `# Owner contract: ${packageId}

Schema: 1
Source: package standard regression fixture
Captured: 2026-09-25

## Original request

The Owner asked for one observable outcome with a verified test.

## Requirements

- R1 -> C1: The observable outcome is present and verified.
`;
}

function writeBundle(root, packageId, packageSource = packageText(packageId)) {
  const directory = join(root, "docs", "packages", packageId);
  mkdirSync(join(directory, "gates"), { recursive: true });
  writeFileSync(join(directory, "PACKAGE.md"), packageSource, "utf8");
  writeFileSync(join(directory, "OWNER.md"), ownerText(packageId), "utf8");
  writeFileSync(join(directory, "GATES.md"), "# Gates: fixture\n\n- [ ] G1: observable fixture outcome\n  EVIDENCE: pending\n", "utf8");
  writeFileSync(join(directory, "gates", ".gitkeep"), "", "utf8");
}

function inspect(root, packageId) {
  return inspectPackageBundle(resolvePackageTarget({ root, packageId, env: {} }));
}

function codes(status) {
  return status.diagnostics.map((item) => item.code);
}

function withFields(replacements) {
  const fields = [...DEFAULT_FIELDS];
  for (const [prefix, value] of Object.entries(replacements)) {
    const index = fields.findIndex((line) => line.startsWith("**" + prefix + ":**"));
    if (value === null) fields.splice(index, 1);
    else if (index === -1) fields.push(value);
    else fields[index] = value;
  }
  return fields;
}

function run(root, ...args) {
  return spawnSync(process.execPath, [cli, ...args, "--root", root], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, UNLAZY_PACKAGE: "", UNLAZY_SCOPE: "" },
  });
}

let passed = 0;
let total = 0;
const test = (name, fn) => {
  total += 1;
  try {
    fn();
    passed += 1;
    console.log("ok   " + name);
  } catch (error) {
    console.error("FAIL " + name);
    console.error("     " + (error.stack || error.message));
    process.exitCode = 1;
  }
};

// --- Step 3: schema and lint -------------------------------------------------

test("a complete standard package is valid and exposes Scope, Context and planned dates", () => {
  const root = repo("standard-valid");
  writeBundle(root, "valid", packageText("valid", withFields({
    "Planned start": "**Planned start:** 2026-09-26",
    "Planned end": "**Planned end:** 2026-10-02",
  })));
  const status = inspect(root, "valid");
  assert.deepEqual(status.diagnostics, []);
  const pig = status._internal.parsed.pig;
  assert.equal(pig.scope, "Drin: the observable outcome and its test. Nicht drin: any neighbouring package.");
  assert.equal(pig.context, "Measured today; nothing is built yet.");
  assert.equal(pig.plannedStart, "2026-09-26");
  assert.equal(pig.plannedEnd, "2026-10-02");
});

test("without the repository switch Scope and Context stay optional (upstream compatibility)", () => {
  const root = repo("owner-only", OWNER_ONLY_CONFIG);
  writeBundle(root, "legacy", packageText("legacy", withFields({ Scope: null, Context: null })));
  assert.deepEqual(inspect(root, "legacy").diagnostics, []);
});

test("a missing Scope field is a lint diagnostic", () => {
  const root = repo("missing-scope");
  writeBundle(root, "noscope", packageText("noscope", withFields({ Scope: null })));
  assert.ok(codes(inspect(root, "noscope")).includes("PACKAGE_SCOPE"));
  const lint = run(root, "lint", "--package", "noscope", "--json");
  assert.equal(lint.status, 2, lint.stderr);
  assert.ok(JSON.parse(lint.stdout).diagnostics.some((item) => item.code === "PACKAGE_SCOPE"));
});

test("a Scope without 'Drin:' is a lint diagnostic", () => {
  const root = repo("scope-no-drin");
  writeBundle(root, "nodrin", packageText("nodrin", withFields({
    Scope: "**Scope:** the observable outcome. Nicht drin: any neighbouring package.",
  })));
  assert.ok(codes(inspect(root, "nodrin")).includes("PACKAGE_SCOPE_FORM"));
  const lint = run(root, "lint", "--package", "nodrin");
  assert.equal(lint.status, 2);
  assert.match(lint.stdout, /PACKAGE_SCOPE_FORM/u);
});

test("a Scope without 'Nicht drin:' is a lint diagnostic", () => {
  const root = repo("scope-no-nicht");
  writeBundle(root, "nonicht", packageText("nonicht", withFields({
    Scope: "**Scope:** Drin: the observable outcome and everything else.",
  })));
  assert.ok(codes(inspect(root, "nonicht")).includes("PACKAGE_SCOPE_FORM"));
});

test("a Scope with an empty 'Drin:' part is a lint diagnostic", () => {
  const root = repo("scope-empty-drin");
  writeBundle(root, "emptydrin", packageText("emptydrin", withFields({
    Scope: "**Scope:** Drin: Nicht drin: any neighbouring package.",
  })));
  assert.ok(codes(inspect(root, "emptydrin")).includes("PACKAGE_SCOPE_FORM"));
});

test("a missing Context field is a lint diagnostic, and 'Kontext' does not replace it", () => {
  const root = repo("missing-context");
  writeBundle(root, "nocontext", packageText("nocontext", withFields({
    Context: "**Kontext:** German label instead of the field name.",
  })));
  assert.ok(codes(inspect(root, "nocontext")).includes("PACKAGE_CONTEXT"));
});

test("a malformed planned date is a lint diagnostic", () => {
  const root = repo("bad-date");
  writeBundle(root, "baddate", packageText("baddate", withFields({
    "Planned start": "**Planned start:** 2026-9-26",
    "Planned end": "**Planned end:** 2026-02-30",
  })));
  const found = codes(inspect(root, "baddate"));
  assert.ok(found.includes("PACKAGE_PLANNED_START"), found.join(","));
  assert.ok(found.includes("PACKAGE_PLANNED_END"), found.join(","));
});

test("a planned date is validated even without the repository switch", () => {
  const root = repo("bad-date-compat", OWNER_ONLY_CONFIG);
  writeBundle(root, "compatdate", packageText("compatdate", withFields({
    Scope: null,
    Context: null,
    "Planned end": "**Planned end:** next week",
  })));
  assert.deepEqual(codes(inspect(root, "compatdate")), ["PACKAGE_PLANNED_END"]);
});

test("a planned start after the planned end is a lint diagnostic", () => {
  const root = repo("date-range");
  writeBundle(root, "range", packageText("range", withFields({
    "Planned start": "**Planned start:** 2026-10-03",
    "Planned end": "**Planned end:** 2026-10-02",
  })));
  assert.deepEqual(codes(inspect(root, "range")), ["PACKAGE_PLANNED_RANGE"]);
});

test("Scope and Context must follow Goal in the standard order", () => {
  const root = repo("field-order");
  const fields = withFields({});
  const swapped = [fields[0], fields[1], fields[2], fields[4], fields[3]];
  writeBundle(root, "order", packageText("order", swapped));
  assert.deepEqual(codes(inspect(root, "order")), ["PACKAGE_FIELD_ORDER"]);
});

test("a wrapped field line is a lint diagnostic under the package standard", () => {
  const root = repo("field-continuation");
  const fields = withFields({});
  fields[2] = "**Goal:** The observable outcome is present\nand verified.";
  writeBundle(root, "wrapped", packageText("wrapped", fields));
  assert.deepEqual(codes(inspect(root, "wrapped")), ["PACKAGE_FIELD_CONTINUATION"]);
});

test("a duplicated Scope field is a lint diagnostic", () => {
  const root = repo("scope-twice");
  const fields = withFields({});
  writeBundle(root, "twice", packageText("twice", [...fields, fields[3]]));
  assert.ok(codes(inspect(root, "twice")).includes("PACKAGE_SCOPE"));
});

test("a non-boolean repository switch is a configuration diagnostic", () => {
  const root = repo("bad-switch", { schemaVersion: 1, packageContract: { ownerContractRequired: true, standardFormatRequired: "yes" } });
  writeBundle(root, "switch");
  assert.ok(codes(inspect(root, "switch")).includes("HARNESS_CONFIG_SCHEMA"));
});

test("parsePackageDocument reads the standard fields without a repository", () => {
  const parsed = parsePackageDocument(packageText("plain"), { packageId: "plain", standardFormat: true });
  assert.deepEqual(parsed.diagnostics, []);
  assert.equal(parsed.pig.context, "Measured today; nothing is built yet.");
});

// --- Step 4: create with the standard format and an Owner contract ----------

test("create with an Owner request writes a complete standard bundle under ownerContractRequired=true", () => {
  const root = repo("create-owner");
  const created = run(root, "create", "--package", "fresh", "--owner-request",
    "Bitte lege ein Paket an, das den Paketstandard vollständig erfüllt.", "--owner-source", "fixture chat", "--json");
  assert.equal(created.status, 0, created.stderr);
  const status = JSON.parse(created.stdout);
  assert.deepEqual(status.diagnostics, []);
  assert.equal(status.owner.complete, true);
  const directory = join(root, "docs", "packages", "fresh");
  const owner = readFileSync(join(directory, "OWNER.md"), "utf8");
  assert.match(owner, /^# Owner contract: fresh$/mu);
  assert.match(owner, /^Source: fixture chat$/mu);
  assert.match(owner, /^Captured: \d{4}-\d{2}-\d{2}$/mu);
  assert.match(owner, /den Paketstandard vollständig erfüllt\./u);
  assert.match(owner, /^- R1 -> C1: /mu);
  const pkg = readFileSync(join(directory, "PACKAGE.md"), "utf8");
  assert.match(pkg, /^\*\*Scope:\*\* Drin: .+ Nicht drin: .+$/mu);
  assert.match(pkg, /^\*\*Context:\*\* \S/mu);
  const doctor = run(root, "doctor", "--package", "fresh");
  assert.equal(doctor.status, 0, doctor.stdout + doctor.stderr);
});

test("create reads the Owner request from a file", () => {
  const root = repo("create-owner-file");
  const requestFile = join(suiteRoot, "request.txt");
  writeFileSync(requestFile, "Der Owner will ein Paket aus einer Datei anlegen lassen.\r\n", "utf8");
  const created = run(root, "create", "--package", "fromfile", "--owner-request-file", requestFile);
  assert.equal(created.status, 0, created.stderr);
  const owner = readFileSync(join(root, "docs", "packages", "fromfile", "OWNER.md"), "utf8");
  assert.match(owner, /aus einer Datei anlegen lassen\.\n\n## Requirements/u);
});

test("create without an Owner request no longer fails under ownerContractRequired=true and leaves an honest skeleton", () => {
  const root = repo("create-skeleton");
  const created = run(root, "create", "--package", "skeleton");
  assert.equal(created.status, 0, created.stderr);
  assert.match(created.stdout, /OWNER\.md is a skeleton/u);
  assert.equal(existsSync(join(root, "docs", "packages", "skeleton", "OWNER.md")), true);
  const lint = run(root, "lint", "--package", "skeleton", "--json");
  assert.equal(lint.status, 2);
  assert.deepEqual(JSON.parse(lint.stdout).diagnostics.map((item) => item.code), ["OWNER_REQUEST"]);
});

test("create without a harness config keeps the upstream bundle without OWNER.md", () => {
  const root = repo("create-upstream", null);
  const created = run(root, "create", "--package", "upstream", "--json");
  assert.equal(created.status, 0, created.stderr);
  assert.equal(existsSync(join(root, "docs", "packages", "upstream", "OWNER.md")), false);
  assert.deepEqual(JSON.parse(created.stdout).diagnostics, []);
});

test("create rejects both Owner request options together", () => {
  const root = repo("create-both");
  const created = run(root, "create", "--package", "both", "--owner-request", "Ein Auftrag mit genug Text.",
    "--owner-request-file", join(suiteRoot, "request.txt"));
  assert.equal(created.status, 2);
  assert.match(created.stderr, /either --owner-request or --owner-request-file/u);
  assert.equal(existsSync(join(root, "docs", "packages", "both")), false);
});

// --- Step 5: the one package measurement --------------------------------------

test("measure returns every bundle with the same numbers as status, plus fields and steps", () => {
  const root = repo("measure");
  writeBundle(root, "alpha");
  writeBundle(root, "beta", packageText("beta", withFields({
    "Planned start": "**Planned start:** 2026-09-26",
    "Planned end": "**Planned end:** 2026-10-02",
  })));
  writeBundle(root, "gamma", packageText("gamma", withFields({ Scope: null })));
  const measured = run(root, "measure", "--json");
  assert.equal(measured.status, 0, measured.stderr);
  const result = JSON.parse(measured.stdout);
  assert.equal(result.packageCount, 3);
  for (const item of result.packages) {
    const status = run(root, "status", "--package", item.packageId, "--json");
    const expected = JSON.parse(status.stdout);
    assert.deepEqual(item.plan, expected.plan, item.packageId);
    assert.deepEqual(item.gates, expected.gates, item.packageId);
    assert.equal(item.status, expected.status, item.packageId);
    assert.deepEqual(item.diagnostics, expected.diagnostics, item.packageId);
  }
  const beta = result.packages.find((item) => item.packageId === "beta");
  assert.equal(beta.title, "beta");
  assert.equal(beta.fields.intent, "Build it under an executable acceptance contract.");
  assert.equal(beta.fields.context, "Measured today; nothing is built yet.");
  assert.equal(beta.fields.plannedStart, "2026-09-26");
  assert.equal(beta.fields.plannedEnd, "2026-10-02");
  assert.deepEqual(beta.steps, [
    { number: 1, done: false, text: "Implement the observable outcome." },
    { number: 2, done: true, text: "Measure the starting point." },
  ]);
  assert.equal(beta.offen, "Implementation and verification.");
  const gamma = result.packages.find((item) => item.packageId === "gamma");
  assert.ok(gamma.diagnostics.some((item) => item.code === "PACKAGE_SCOPE"));
  assert.equal(gamma.status, "invalid");
});

test("measure refuses package targeting options", () => {
  const root = repo("measure-options");
  writeBundle(root, "alpha");
  const measured = run(root, "measure", "--package", "alpha");
  assert.equal(measured.status, 2);
  assert.match(measured.stderr, /measure does not accept/u);
});

// package-migrate writes the standard header too (PSTD-N12): a migrated
// bundle must stay valid once a repository sets standardFormatRequired.
function legacyText(packageId, extraFields = []) {
  return [
    `# Work package: ${packageId}`,
    "",
    "**Problem:** A legacy flat package is the only current truth.",
    "**Intent:** Move the same meaning into one repository-owned bundle.",
    "**Goal:** The flat source is gone and the bundle is valid.",
    ...extraFields,
    "",
    "## Plan",
    "",
    "1. [ ] Prepare the contract.",
    "",
    "## Status",
    "",
    "Pending.",
    "",
    "## Abnahme",
    "",
    "- the package exists only as a bundle",
    "",
    "## Abschluss",
    "",
    "Coverage: 1/1 mapped; 0/1 met.",
    "Fulfillment: nicht erfuellt - pending.",
    "Geprueft gegen: dry-run.",
    "Offen: gate execution.",
    "",
  ].join("\n");
}

test("migrate without Scope/Context writes a scaffold that passes the standard lint", () => {
  const result = prepareLegacyMigration("legacy-plain", legacyText("legacy-plain"));
  assert.equal(result.migrationBlocked, false, JSON.stringify(result.blockers));
  assert.match(result.packageText, /^\*\*Scope:\*\* Drin: .+ Nicht drin: .+$/mu);
  assert.match(result.packageText, /^\*\*Context:\*\* Migrated by package-migrate from docs\/packages\/legacy-plain\.md;/mu);
  assert.deepEqual(result.warnings.map((entry) => entry.code).sort(), ["SCAFFOLD_CONTEXT", "SCAFFOLD_SCOPE"]);
  const parsed = parsePackageDocument(result.packageText, { packageId: "legacy-plain", standardFormat: true });
  assert.deepEqual(parsed.diagnostics, []);
});

test("migrate carries over legacy Scope, Context and planned dates without swallowing them into Goal", () => {
  const result = prepareLegacyMigration("legacy-standard", legacyText("legacy-standard", [
    "**Scope:** Drin: the bundle move. Nicht drin: any other package.",
    "**Context:** Measured on 2026-09-26.",
    "**Planned start:** 2026-10-01",
    "**Planned end:** 2026-10-09",
  ]));
  assert.equal(result.migrationBlocked, false, JSON.stringify(result.blockers));
  assert.deepEqual(result.warnings, []);
  assert.match(result.packageText, /^\*\*Goal:\*\* The flat source is gone and the bundle is valid\.$/mu);
  assert.match(result.packageText, /^\*\*Scope:\*\* Drin: the bundle move\. Nicht drin: any other package\.$/mu);
  assert.match(result.packageText, /^\*\*Context:\*\* Measured on 2026-09-26\.$/mu);
  assert.match(result.packageText, /^\*\*Planned start:\*\* 2026-10-01$/mu);
  assert.match(result.packageText, /^\*\*Planned end:\*\* 2026-10-09$/mu);
  const parsed = parsePackageDocument(result.packageText, { packageId: "legacy-standard", standardFormat: true });
  assert.deepEqual(parsed.diagnostics, []);
});

test("migrate blocks a legacy Scope without the Drin/Nicht drin form instead of rewriting it", () => {
  const result = prepareLegacyMigration("legacy-bad-scope", legacyText("legacy-bad-scope", ["**Scope:** everything"]));
  assert.equal(result.migrationBlocked, true);
  assert.ok(result.blockers.some((entry) => entry.code === "GENERATED_PACKAGE_SCOPE_FORM"), JSON.stringify(result.blockers));
});

rmSync(suiteRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
emitTestCounts("package-standard-tests", { tests: total, pass: passed, fail: total - passed, skip: 0 });
console.log(`package-standard-tests: ${passed}/${total} passed, 0 skipped`);
if (passed !== total) process.exitCode = 1;
