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
import { createRequire } from "node:module";
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
  assert.match(owner, /aus einer Datei anlegen lassen\.\n<!-- owner-end -->\n\n## Requirements/u);
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

// --- P14: C7 (the Owner request ends at a marker, never at a heading) and D2 (no minimum length) --------------------

const ownerContractLib = createRequire(import.meta.url)("../scripts/lib/owner-contract.cjs");

function ownerFile(requestSection, requirements = ["- R1 -> C1: The outcome is present."]) {
  return "# Owner contract: demo\n\nSchema: 1\nSource: fixture\nCaptured: 2026-10-06\n\n" + requestSection +
    "\n## Requirements\n\n" + requirements.join("\n") + "\n";
}

test("C7: an order with headings, a Requirements heading and header lookalikes is read whole when it ends at the marker", () => {
  const request = ["Baue die Suche.", "", "## Anforderungen", "- schnell", "", "## Requirements", "- R9 -> C9: nur Text", "",
    "## Original request", "Schema: 2", "Source: fremd", "Captured: 1999-01-01", "# Owner contract: fremd", "Ende."].join("\n");
  const parsed = ownerContractLib.parseOwnerContract(ownerFile(ownerContractLib.formatOwnerRequestSection(request)), { packageId: "demo" });
  assert.deepEqual(parsed.diagnostics, []);
  assert.equal(parsed.originalRequest, request);
  assert.equal(parsed.requestText, request);
  assert.equal(parsed.endMarker, true);
  assert.deepEqual(parsed.requirements.map((item) => item.requirementId), ["R1"]);
  assert.equal(parsed.source, "fixture");
  assert.equal(parsed.captured, "2026-10-06");
  assert.equal(parsed.packageId, "demo");
  // the request digest is the digest of the whole order
  assert.equal(parsed.requestDigest, ownerContractLib.parseOwnerContract(ownerFile(ownerContractLib.formatOwnerRequestSection(request)), { packageId: "demo" }).requestDigest);
});

test("C7: a marker line inside the order does not end it; the last marker does", () => {
  const request = "Vorher.\n" + ownerContractLib.OWNER_END_MARKER + "\nNachher.";
  const parsed = ownerContractLib.parseOwnerContract(ownerFile(ownerContractLib.formatOwnerRequestSection(request)), { packageId: "demo" });
  assert.equal(parsed.originalRequest, request);
  assert.deepEqual(parsed.requirements.map((item) => item.requirementId), ["R1"]);
});

test("C7: a file of the older format (no marker) is still read as before, with the order cut at its first heading and complete in requestText", () => {
  const text = ownerFile("## Original request\n\nBaue die Suche.\n\n## Eine Überschrift\n\nText.\n");
  const parsed = ownerContractLib.parseOwnerContract(text, { packageId: "demo" });
  assert.deepEqual(parsed.diagnostics, []);
  assert.equal(parsed.endMarker, false);
  assert.equal(parsed.originalRequest, "Baue die Suche.", "unchanged: the request digest of a bound package stays");
  assert.equal(parsed.requestText, "Baue die Suche.\n\n## Eine Überschrift\n\nText.", "the order given to an agent is whole");
  assert.deepEqual(parsed.requirements.map((item) => item.requirementId), ["R1"]);
  // the digest of the older reading equals what a version before this one computed
  const crlf = ownerContractLib.parseOwnerContract(text.replaceAll("\n", "\r\n"), { packageId: "demo" });
  assert.equal(crlf.originalRequest.replace(/\r\n/gu, "\n"), "Baue die Suche.");
});

test("D2: an order of five characters is valid; an empty or whitespace-only one is not", () => {
  const tiny = ownerContractLib.parseOwnerContract(ownerFile(ownerContractLib.formatOwnerRequestSection("Mach!")), { packageId: "demo" });
  assert.deepEqual(tiny.diagnostics, []);
  const oldTiny = ownerContractLib.parseOwnerContract(ownerFile("## Original request\n\nMach!\n"), { packageId: "demo" });
  assert.deepEqual(oldTiny.diagnostics, [], "the older format has no minimum length either");
  for (const empty of ["", "   ", "\n\n"]) {
    const parsed = ownerContractLib.parseOwnerContract(ownerFile(ownerContractLib.formatOwnerRequestSection(empty)), { packageId: "demo" });
    assert.deepEqual(parsed.diagnostics.map((item) => item.code), ["OWNER_REQUEST"], JSON.stringify(empty));
  }
  const missing = ownerContractLib.parseOwnerContract(ownerFile("## Original request\n\n"), { packageId: "demo" });
  assert.deepEqual(missing.diagnostics.map((item) => item.code), ["OWNER_REQUEST"]);
});

test("placeholder: only the known template texts are a placeholder, and only when nothing else stands in the order", () => {
  const skeleton = "<Copy the original Owner request here verbatim before activation.>";
  const template = "<Copy the Owner request here without replacing it with the implementation plan.>";
  for (const text of [skeleton, template, "[AUSFUELLEN]", "\n" + template + "\n\n[AUSFUELLEN]\n", "  " + skeleton + "  "]) {
    assert.equal(ownerContractLib.isPlaceholderRequest(text), true, JSON.stringify(text));
    const parsed = ownerContractLib.parseOwnerContract(ownerFile(ownerContractLib.formatOwnerRequestSection(text)), { packageId: "demo" });
    assert.deepEqual(parsed.diagnostics.map((item) => item.code), ["OWNER_REQUEST"], JSON.stringify(text));
    const old = ownerContractLib.parseOwnerContract(ownerFile("## Original request\n\n" + text + "\n"), { packageId: "demo" });
    assert.deepEqual(old.diagnostics.map((item) => item.code), ["OWNER_REQUEST"], "older format: " + JSON.stringify(text));
  }
  for (const text of ["Baue einen <Button> in die Leiste.", "Nutze Map<string, number> statt Object.", "<div> ersetzen",
    "Map<K,V>", "<Button>", "Mach das.\n" + skeleton, "[AUSFUELLEN] heißt hier: der Owner schreibt es später, baue trotzdem."]) {
    assert.equal(ownerContractLib.isPlaceholderRequest(text), false, JSON.stringify(text));
    const parsed = ownerContractLib.parseOwnerContract(ownerFile(ownerContractLib.formatOwnerRequestSection(text)), { packageId: "demo" });
    assert.deepEqual(parsed.diagnostics, [], JSON.stringify(text));
    assert.equal(parsed.originalRequest, text);
  }
  assert.ok(ownerContractLib.PLACEHOLDER_LINES.includes(skeleton), "the skeleton of package-cli create is a known placeholder");
  assert.match(readFileSync(cli, "utf8"), /"<Copy the original Owner request here verbatim before activation\.>"/u,
    "package-cli create still writes exactly this skeleton text");
});

test("placeholder: package-cli create takes an order with <Button> and Map<K,V> word for word, and the doctor is clean", () => {
  for (const [id, order] of [["button", "Baue einen <Button> in die Kopfleiste und ein <div> darum."],
    ["generic", "Ersetze das Objekt durch Map<K,V>, genauer Map<string, number>."]]) {
    const root = repo("create-brackets-" + id);
    const created = run(root, "create", "--package", id, "--owner-request", order, "--json");
    assert.equal(created.status, 0, created.stdout + created.stderr);
    assert.deepEqual(JSON.parse(created.stdout).diagnostics, []);
    const owner = readFileSync(join(root, "docs", "packages", id, "OWNER.md"), "utf8");
    assert.equal(ownerContractLib.parseOwnerContract(owner, { packageId: id }).originalRequest, order);
    const doctor = run(root, "doctor", "--package", id, "--json");
    assert.deepEqual(JSON.parse(doctor.stdout).packages[0].diagnostics, [], doctor.stdout);
    assert.equal(doctor.status, 0, doctor.stdout + doctor.stderr);
  }
});

test("C7: package-cli create writes the marker and keeps a heading of the order inside it", () => {
  const root = repo("create-owner-heading");
  const order = "Erster Absatz.\n\n## Eine Überschrift im Auftrag\n\nZweiter Absatz.";
  const created = run(root, "create", "--package", "heading", "--owner-request", order, "--json");
  assert.equal(created.status, 0, created.stderr);
  const owner = readFileSync(join(root, "docs", "packages", "heading", "OWNER.md"), "utf8");
  assert.ok(owner.includes("## Original request\n\n" + order + "\n" + ownerContractLib.OWNER_END_MARKER + "\n\n## Requirements"), owner);
  const parsed = ownerContractLib.parseOwnerContract(owner, { packageId: "heading" });
  assert.equal(parsed.originalRequest, order);
  assert.deepEqual(parsed.diagnostics, []);
  assert.deepEqual(JSON.parse(created.stdout).diagnostics, []);
  const short = repo("create-owner-short");
  const tiny = run(short, "create", "--package", "tiny", "--owner-request", "Mach!", "--json");
  assert.equal(tiny.status, 0, tiny.stderr);
  assert.deepEqual(JSON.parse(tiny.stdout).diagnostics, [], "a five character order passes the doctor");
});

test("D13: duty-waive takes the Owner's quote from --owner-ok-file, any length and characters, and refuses a file of the working tree", () => {
  const root = repo("waive-file");
  const quoteFile = join(suiteRoot, "waive-quote.txt");
  writeFileSync(quoteFile, 'Ja, "erlassen".\n\n## Abschluss\n' + "q".repeat(3000) + "\n", "utf8");
  // a file that lies neither in the temp folder nor in a run folder (this test file itself)
  const inTree = fileURLToPath(import.meta.url);
  // the option is parsed before the package is looked at: such a file is refused with its own message
  const refused = run(root, "duty-waive", "--package", "demo", "--scope", "demo", "--duty", "d", "--owner-ok-file", inTree);
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /session temp folder or the run folder/u);
  // the fixture repository lies in the temp folder, yet a file of its working tree is still refused
  const inTempTree = join(root, "quote-in-tree.txt");
  writeFileSync(inTempTree, "Ja\n", "utf8");
  const refusedTemp = run(root, "duty-waive", "--package", "demo", "--scope", "demo", "--duty", "d", "--owner-ok-file", inTempTree);
  assert.notEqual(refusedTemp.status, 0);
  assert.match(refusedTemp.stderr, /session temp folder or the run folder \(\.unlazy\), not in a Git working tree/u);
  const both = run(root, "duty-waive", "--package", "demo", "--scope", "demo", "--duty", "d", "--owner-ok", "x", "--owner-ok-file", quoteFile);
  assert.notEqual(both.status, 0);
  assert.match(both.stderr, /either --owner-ok or --owner-ok-file/u);
  const neither = run(root, "duty-waive", "--package", "demo", "--scope", "demo", "--duty", "d");
  assert.match(neither.stderr, /requires --owner-ok TEXT or --owner-ok-file FILE/u);
  const blank = join(suiteRoot, "waive-blank.txt");
  writeFileSync(blank, "  \n", "utf8");
  const empty = run(root, "duty-waive", "--package", "demo", "--scope", "demo", "--duty", "d", "--owner-ok-file", blank);
  assert.match(empty.stderr, /holds no Owner wording/u);
});

rmSync(suiteRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
emitTestCounts("package-standard-tests", { tests: total, pass: passed, fail: total - passed, skip: 0 });
console.log(`package-standard-tests: ${passed}/${total} passed, 0 skipped`);
if (passed !== total) process.exitCode = 1;
