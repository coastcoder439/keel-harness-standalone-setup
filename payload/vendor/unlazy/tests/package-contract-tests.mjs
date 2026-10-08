import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { emitTestCounts } from "./helpers/test-counts.mjs";

const root = realpathSync(join(dirname(fileURLToPath(import.meta.url)), ".."));
const read = (...parts) => readFileSync(join(root, ...parts), "utf8");
const contract = read("references", "package-bundles.md");
const normalizedContract = contract.replace(/\s+/g, " ");
const manifest = JSON.parse(read("package.json"));
const labHarnessCandidate = join(root, "..", "..", "test-harness");
const harnessRoot = realpathSync(existsSync(labHarnessCandidate)
  ? labHarnessCandidate
  : join(root, "..", ".."));
const embeddedStandalone = !existsSync(labHarnessCandidate) &&
  existsSync(join(harnessRoot, "AGENTS.md")) && existsSync(join(harnessRoot, "vendor", "unlazy"));
const harnessRead = (...parts) => readFileSync(join(harnessRoot, ...parts), "utf8");

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
    console.error("     " + error.message);
    process.exitCode = 1;
  }
};

function sectionOrder(markdown) {
  return [...markdown.matchAll(/^## (.+)$/gm)].map((match) => match[1]);
}

function parseAdapterExample(markdown) {
  const section = markdown.split("## Adapter JSON")[1];
  assert.ok(section, "Adapter JSON section missing");
  const match = section.match(/```json\s*([\s\S]*?)```/);
  assert.ok(match, "Adapter JSON example missing");
  return JSON.parse(match[1]);
}

function validateAdapterMessage(value) {
  if (!value || value.schemaVersion !== 1) throw new Error("unsupported schemaVersion");
  if (!value.contract || !Number.isInteger(value.contract.required) || value.contract.required < 1) {
    throw new Error("contract.required denominator missing");
  }
  const statuses = new Set(["draft", "active", "blocked", "handoff", "closable", "closed", "invalid"]);
  if (!statuses.has(value.status)) throw new Error("unknown PackageStatus");
  for (const field of ["repoRoot", "repoKey", "packageId", "packageFile", "lifecycle", "digest"]) {
    if (typeof value[field] !== "string" || value[field].length === 0) throw new Error(field + " missing");
  }
  for (const field of ["plan", "gates", "dispatch"]) {
    if (!value[field] || typeof value[field] !== "object") throw new Error(field + " missing");
  }
  if (!Array.isArray(value.diagnostics) || typeof value.closable !== "boolean") {
    throw new Error("diagnostics/closable missing");
  }
  return value;
}

test("release source is the durable versioned vendor checkout", () => {
  assert.equal(manifest.name, "unlazy-skill");
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  // A loose copy in a temp or scratchpad folder is no release source. A Git checkout there is: the clean copy of a
  // commit (test-matrix --at under %TEMP%\keel-proof) and the release clone both hold the versioned vendor tree.
  if (!embeddedStandalone && /(?:^|[\\/])(?:temp|tmp|scratchpad)(?:[\\/]|$)/i.test(root)) {
    const tracked = spawnSync("git", ["-C", root, "ls-files", "--error-unmatch", "--", "package.json", "references/package-bundles.md"],
      { encoding: "utf8", windowsHide: true });
    assert.equal(tracked.status, 0, "vendor tree in a temp folder is not a versioned Git checkout: " + root + " " + String(tracked.stderr).trim());
  }
  assert.match(contract, /schema version `1`/);
});

test("contract fixes repository ownership and upward-only resolution", () => {
  for (const phrase of [
    "{canonicalRepoRoot, packageId}",
    "Resolution only walks upward",
    "it never searches child repositories",
    "--root` is an assertion",
    "Two scopes in one repository MUST NOT activate the same package",
  ]) assert.ok(normalizedContract.includes(phrase), "missing normative phrase: " + phrase);
});

test("contract fixes bundle, runtime, legacy, evidence, and approval boundaries", () => {
  for (const phrase of [
    "docs/packages/<packageId>/",
    ".unlazy/<scope>/package.ref",
    "Package mode MUST NOT discover them",
    "only with `--legacy`",
    "repository-relative `cwd`",
    "stable `shellId`",
    "MUST NOT contain an absolute repository",
  ]) assert.ok(normalizedContract.includes(phrase), "missing boundary: " + phrase);
});

test("resolver precedence is complete and ordered", () => {
  const expected = ["--package", "--scope", "UNLAZY_PACKAGE", "UNLAZY_SCOPE", "session binding", "active scope"];
  let cursor = contract.indexOf("## Resolver precedence");
  assert.ok(cursor >= 0);
  for (const token of expected) {
    cursor = contract.indexOf(token, cursor + 1);
    assert.ok(cursor >= 0, "missing or out-of-order precedence token: " + token);
  }
});

test("adapter protocol accepts v1 and rejects version or denominator drift", () => {
  const valid = parseAdapterExample(contract);
  assert.equal(validateAdapterMessage(valid), valid);
  assert.throws(() => validateAdapterMessage({ ...valid, schemaVersion: 2 }), /schemaVersion/);
  const missing = { ...valid };
  delete missing.contract;
  assert.throws(() => validateAdapterMessage(missing), /denominator/);
  assert.throws(() => validateAdapterMessage({ ...valid, contract: { covered: 12 } }), /denominator/);
});

test("all PackageStatus values and shared exit codes are normative", () => {
  for (const state of ["draft", "active", "blocked", "handoff", "closable", "closed", "invalid"]) {
    assert.match(contract, new RegExp("`" + state + "`"));
  }
  for (const code of ["0", "1", "2", "3"]) {
    assert.match(contract, new RegExp("\\| `" + code + "` \\|"));
  }
});

test("harness template is a bundle PACKAGE and has no non-plan checkbox", () => {
  const template = harnessRead("docs", "packages", "TEMPLATE.md");
  assert.deepEqual(sectionOrder(template), ["Plan", "Status", "Abnahme", "Abschluss", "Anhang"]);
  assert.match(template, /docs\/packages\/<packageId>\/PACKAGE\.md/);
  const planHeading = template.match(/^## Plan$/m);
  const statusHeading = template.match(/^## Status$/m);
  assert.ok(planHeading && statusHeading && statusHeading.index > planHeading.index);
  const beforePlan = template.slice(0, planHeading.index);
  const plan = template.slice(planHeading.index + planHeading[0].length, statusHeading.index);
  const after = template.slice(statusHeading.index);
  assert.doesNotMatch(beforePlan + after, /^\s*(?:[-*]|\d+\.)\s+\[[ xX]\]/m);
  assert.match(plan, /^1\. \[ \] /m);
  assert.match(plan, /^2\. \[ \] /m);
  assert.doesNotMatch(template, /docs\/packages\/<package>\.md/);
});

test("harness permanent rules preserve bundles and delegate closure to the CLI", () => {
  const claude = harnessRead("AGENTS.md");
  const method = harnessRead(".claude", "rules", "keel", "working-method.md");
  for (const text of [claude, method]) {
    assert.match(text, /docs\/packages\/<packageId>\/PACKAGE\.md/);
    assert.match(text, /\.unlazy\/.*Runtime/si);
    assert.doesNotMatch(text, /docs\/packages\/<paket>\.md/);
  }
  assert.match(method, /package-cli\.mjs` close/);
  assert.match(method, /nicht geloescht/);
});

emitTestCounts("package-contract-tests", {
  tests: total, pass: passed, fail: total - passed, skip: 0,
});
if (!process.exitCode) console.log(`\n${passed}/${total} passed, 0 skipped`);
