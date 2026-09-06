import assert from "node:assert/strict";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import packageContext from "../scripts/lib/package-context.cjs";
import { assertRuntimeIgnored } from "../scripts/lib/package-lifecycle.mjs";
import { inspectPackageBundle } from "../scripts/lib/package-schema.mjs";
import { resolvePackageTarget } from "../scripts/lib/packages.mjs";
import { emitTestCounts } from "./helpers/test-counts.mjs";

const { listPackageBundles, resolveRepositoryRoot } = packageContext;
const realpath = realpathSync.native || realpathSync;
const here = dirname(fileURLToPath(import.meta.url));
const packageCli = join(here, "..", "scripts", "package-cli.mjs");
const rootArgument = process.argv[2];

if (!rootArgument) {
  console.error("usage: node tests/mvp-workbench-tests.mjs <workbenchRoot>");
  process.exit(2);
}

const root = realpath(rootArgument);
const bundles = listPackageBundles(root);
const requestedPackage = process.argv[3] || "";
const preferredPackages = [
  requestedPackage,
  "keel-harness-reference-completeness-repair",
  "harness-onboarding",
].filter(Boolean);
const packageId = preferredPackages.find((candidate) =>
  bundles.some((bundle) => bundle.packageId === candidate)) || bundles.at(-1)?.packageId;
let passed = 0;
const testCount = 5;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log("ok   " + name);
  } catch (error) {
    console.error("FAIL " + name);
    console.error("     " + (error.stack || error.message));
    process.exitCode = 1;
  }
}

function cli(...args) {
  return spawnSync(process.execPath, [packageCli, ...args], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    timeout: 30000,
    env: { ...process.env, UNLAZY_PACKAGE: "", UNLAZY_SCOPE: "" },
  });
}

test("the isolated workbench argument is exactly the resolver repository root", () => {
  assert.equal(resolveRepositoryRoot(join(root, "dashboard", "render", "client")), root);
  assert.equal(resolveRepositoryRoot(root), root);
});

test("repo-owned package bundles are visible and flat package truth is absent", () => {
  assert.ok(bundles.length > 0, "the consuming repository has no package bundle");
  assert.ok(packageId, "no current repo-owned package fixture can be selected");
  for (const bundle of bundles) {
    assert.equal(existsSync(join(root, "docs", "packages", bundle.packageId + ".md")), false);
    assert.equal(bundle.packageDir, join(root, "docs", "packages", bundle.packageId));
  }
  assert.equal(existsSync(join(root, "GATES.md")), false);
  assert.equal(existsSync(join(root, "gates")), false);
});

test("every repo-owned package is schema-valid and retains its stored contract denominator", () => {
  for (const bundle of bundles) {
    const target = resolvePackageTarget({ root, packageId: bundle.packageId, env: {} });
    const state = inspectPackageBundle(target);
    assert.deepEqual(state.diagnostics, [], `${bundle.packageId}: ${JSON.stringify(state.diagnostics)}`);
    assert.ok(state.plan.total > 0, `${bundle.packageId}: empty plan`);
    assert.ok(state.contract.required > 0, `${bundle.packageId}: missing contract denominator`);
    assert.equal(state.contract.covered, state.contract.required, `${bundle.packageId}: incomplete contract mapping`);
    assert.ok(readFileSync(target.packageFile, "utf8").includes(`Work package: ${bundle.packageId}`));
  }
});

test("runtime is ignored and the selected package resolves only inside its owning repository", () => {
  assertRuntimeIgnored(root);
  const target = resolvePackageTarget({ root, packageId, env: {} });
  assert.equal(target.repoRoot, root);
  assert.equal(target.repoKey, ".");
  assert.equal(target.packageId, packageId);
  assert.ok(target.gateFiles.length > 0);
  assert.ok(target.gateFiles.every((file) => file.startsWith(join(root, "docs", "packages", packageId))));
});

test("CLI status reports the selected repo/package identity without deriving closure", () => {
  const result = cli("status", "--json", "--root", root, "--package", packageId);
  assert.ok(result.status === 0 || result.status === 1, result.stderr + result.stdout);
  const value = JSON.parse(result.stdout);
  assert.equal(value.repoRoot, root);
  assert.equal(value.repoKey, ".");
  assert.equal(value.packageId, packageId);
  assert.equal(value.contract.covered, value.contract.required);
  assert.ok(["draft", "active", "blocked", "handoff", "closable", "closed"].includes(value.status));
});

emitTestCounts("mvp-workbench-tests", {
  tests: testCount,
  pass: passed,
  fail: testCount - passed,
  skip: 0,
});
if (!process.exitCode) console.log(`\n${passed}/${testCount} passed, 0 skipped`);
