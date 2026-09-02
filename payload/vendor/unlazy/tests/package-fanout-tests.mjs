#!/usr/bin/env node
// Package-bundle fan-out, claim identity, and dispatch aggregation tests. Node 16+.

import assert from "node:assert/strict";
import {
  mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { claimLeases, readLeases } from "../scripts/lib/gates.mjs";
import { inspectPackageBundle } from "../scripts/lib/package-schema.mjs";
import { resolvePackageTarget } from "../scripts/lib/packages.mjs";
import { hardenWindowsPrivateDirectory } from "../scripts/lib/windows-acl.mjs";
import { initRepository } from "./helpers/git-repo.mjs";
import { emitTestCounts } from "./helpers/test-counts.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const gateCheck = join(here, "..", "scripts", "gate-check.mjs");
const dispatchCheck = join(here, "..", "scripts", "dispatch-check.mjs");
const packageCli = join(here, "..", "scripts", "package-cli.mjs");
const suiteRoot = mkdtempSync(join(tmpdir(), "unlazy-package-fanout-"));
const approvals = join(suiteRoot, "approvals");
mkdirSync(approvals, { recursive: true, mode: 0o700 });
if (process.platform === "win32") hardenWindowsPrivateDirectory(approvals);

function repo(name) {
  const root = join(suiteRoot, name);
  initRepository(root);
  writeFileSync(join(root, ".gitignore"), ".unlazy/\n", "utf8");
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(join(root, "scripts", "check-fanout.mjs"),
    "console.log(String(process.argv[2]) + ' OK');\n", "utf8");
  return root;
}

function packageText(packageId) {
  return `# Work package: ${packageId}

**Problem:** Fan-out must preserve one package identity.
**Intent:** Bind root, leaf, node, claims, and dispatch to this bundle.
**Goal:** Every fan-out transition is machine-verifiable.

## Plan

1. [x] Build and verify the fan-out fixture.

## Status

The fixture is ready for executable verification.

## Abnahme

- C1 -> GATES.md:ROOT: Root verification runs.
- C2 -> gates/leaf-shared.md:LEAF: The addressed leaf owns only its declared paths.
- C3 -> gates/node-integrate.md:NODE: Node integration runs after the leaf.

## Abschluss

Coverage: 3/3 contract outcomes mapped; 0/3 met.
Fulfillment: nicht erfuellt - package close has not run.
Geprueft gegen: pending fan-out gate.
Offen: Package close.

## Anhang

### Depth Tree

- ROOT GATES.md <- none: Root contract and final integration.
- LEAF gates/leaf-shared.md <- GATES.md: Independent leaf outcome.
- NODE gates/node-integrate.md <- gates/leaf-shared.md: Bottom-up integration outcome.
`;
}

function ledger(kind, owns = null) {
  const id = kind === "root" ? "ROOT" : kind === "leaf" ? "LEAF" : "NODE";
  const token = kind.toUpperCase();
  return `# ${token} gates

${owns ? `OWNS: ${owns}\n\n` : ""}- [ ] ${id}: ${kind} outcome is executable
  CHECK: node scripts/check-fanout.mjs ${token}
  EXPECT: ${token} OK
  EVIDENCE: pending
`;
}

function bundle(root, packageId, options = {}) {
  const directory = join(root, "docs", "packages", packageId);
  mkdirSync(join(directory, "gates"), { recursive: true });
  writeFileSync(join(directory, "PACKAGE.md"), packageText(packageId), "utf8");
  writeFileSync(join(directory, "GATES.md"), ledger("root"), "utf8");
  writeFileSync(join(directory, "gates", "leaf-shared.md"),
    ledger("leaf", options.leafOwn || `src/${packageId}/**`), "utf8");
  writeFileSync(join(directory, "gates", "node-integrate.md"),
    ledger("node", options.nodeOwn || `integration/${packageId}/**`), "utf8");
  return directory;
}

function run(script, root, ...args) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    timeout: 60000,
    env: {
      ...process.env,
      UNLAZY_APPROVAL_DIR: approvals,
      UNLAZY_PACKAGE: "",
      UNLAZY_SCOPE: "",
    },
  });
}

function activate(root, packageId, scope) {
  const result = run(packageCli, root, "activate", "--root", root, "--package", packageId,
    "--scope", scope, "--session", "fanout-" + scope);
  assert.equal(result.status, 0, result.stderr + result.stdout);
}

function claim(root, packageId, scope, leaf = "leaf-shared") {
  return run(gateCheck, root, "--root", root, "--package", packageId, "--scope", scope,
    "--leaf", leaf, "--claim");
}

function dispatch(root, command, packageId, scope, ...args) {
  return run(dispatchCheck, root, command, "--root", root, "--package", packageId,
    "--scope", scope, "--wave", "ready-1", ...args);
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test("bundle fan-out resolves root first, sorted leaf/node sidecars, and re-verifies qualified gates", () => {
  const root = repo("sorted");
  bundle(root, "alpha");
  const target = resolvePackageTarget({ root, packageId: "alpha", env: {} });
  assert.deepEqual(target.gateFiles.map((file) => relative(target.packageDir, file).replaceAll("\\", "/")), [
    "GATES.md", "gates/leaf-shared.md", "gates/node-integrate.md",
  ]);

  const approved = run(gateCheck, root, "--root", root, "--package", "alpha", "--approve");
  assert.equal(approved.status, 0, approved.stderr + approved.stdout);
  const reverified = run(gateCheck, root, "--root", root, "--package", "alpha", "--reverify");
  assert.equal(reverified.status, 0, reverified.stderr + reverified.stdout);
  const ids = [
    "alpha/docs/packages/alpha/GATES.md:ROOT",
    "alpha/docs/packages/alpha/gates/leaf-shared.md:LEAF",
    "alpha/docs/packages/alpha/gates/node-integrate.md:NODE",
  ];
  let cursor = -1;
  for (const id of ids) {
    const next = reverified.stdout.indexOf(id);
    assert(next > cursor, `missing or unsorted qualified id ${id}\n${reverified.stdout}`);
    cursor = next;
  }
  assert.equal(inspectPackageBundle(target).gates.met, 3);
});

test("package claims require an exact leaf and read OWNS only from that package ledger", () => {
  const root = repo("exact-leaf");
  bundle(root, "alpha", { leafOwn: "src/alpha/**" });
  bundle(root, "beta", { leafOwn: "src/beta/**" });
  activate(root, "alpha", "alpha-scope");
  activate(root, "beta", "beta-scope");

  const missing = run(gateCheck, root, "--root", root, "--package", "alpha", "--scope", "alpha-scope", "--claim");
  assert.equal(missing.status, 2, missing.stderr + missing.stdout);
  assert.match(missing.stderr, /requires an exact --leaf/);
  const node = claim(root, "alpha", "alpha-scope", "node-integrate");
  assert.equal(node.status, 2, node.stderr + node.stdout);
  assert.match(node.stderr, /leaf-\*/);

  const alpha = claim(root, "alpha", "alpha-scope");
  assert.equal(alpha.status, 0, alpha.stderr + alpha.stdout);
  let leases = readLeases(root);
  assert.equal(leases.length, 1);
  assert.deepEqual({
    schema: leases[0].schema,
    scope: leases[0].scope,
    packageId: leases[0].packageId,
    leaf: leases[0].leaf,
    ledger: leases[0].ledger,
    globs: leases[0].globs,
  }, {
    schema: 2,
    scope: "alpha-scope",
    packageId: "alpha",
    leaf: "leaf-shared",
    ledger: "docs/packages/alpha/gates/leaf-shared.md",
    globs: ["src/alpha/**"],
  });

  const beta = claim(root, "beta", "beta-scope");
  assert.equal(beta.status, 0, beta.stderr + beta.stdout);
  leases = readLeases(root);
  assert.deepEqual(leases.map((lease) => lease.packageId).sort(), ["alpha", "beta"]);
});

test("overlapping claims conflict across packages in one repo and name the full owner identity", () => {
  const root = repo("cross-package-conflict");
  bundle(root, "alpha", { leafOwn: "src/shared/**" });
  bundle(root, "beta", { leafOwn: "src/shared/file.js" });
  activate(root, "alpha", "alpha-scope");
  activate(root, "beta", "beta-scope");
  assert.equal(claim(root, "alpha", "alpha-scope").status, 0);
  const refused = claim(root, "beta", "beta-scope");
  assert.equal(refused.status, 3, refused.stderr + refused.stdout);
  assert.match(refused.stdout, /held by alpha\/alpha-scope\/leaf-shared/);
});

test("same package, scope, leaf, and OWNS remain isolated in separate repositories", () => {
  const left = repo("repo-left");
  const right = repo("repo-right");
  for (const root of [left, right]) {
    bundle(root, "alpha", { leafOwn: "src/shared/**" });
    activate(root, "alpha", "same-scope");
  }
  assert.equal(claim(left, "alpha", "same-scope").status, 0);
  assert.equal(claim(right, "alpha", "same-scope").status, 0);
  assert.equal(readLeases(left).length, 1);
  assert.equal(readLeases(right).length, 1);
});

test("lost package.ref recovery releases only the exact package lease and preserves foreign records", async () => {
  const root = repo("release-recovery");
  bundle(root, "alpha", { leafOwn: "src/alpha/**" });
  bundle(root, "beta", { leafOwn: "src/beta/**" });
  activate(root, "alpha", "alpha-scope");
  activate(root, "beta", "beta-scope");
  assert.equal(claim(root, "alpha", "alpha-scope").status, 0);
  assert.equal(claim(root, "beta", "beta-scope").status, 0);
  const foreign = await claimLeases(root, {
    scope: "alpha-scope",
    packageId: "foreign",
    leaf: "leaf-foreign",
    ledger: "docs/packages/foreign/gates/leaf-foreign.md",
    globs: ["src/foreign/**"],
  });
  assert.equal(foreign.ok, true);
  const legacy = await claimLeases(root, {
    scope: "alpha-scope", leaf: "leaf-legacy", globs: ["src/legacy/**"],
  });
  assert.equal(legacy.ok, true);

  rmSync(join(root, ".unlazy", "alpha-scope", "package.ref"));
  const released = run(gateCheck, root, "--root", root, "--package", "alpha", "--scope", "alpha-scope",
    "--leaf", "leaf-shared", "--release");
  assert.equal(released.status, 0, released.stderr + released.stdout);
  assert.match(released.stdout, /released 1 lease/);
  const remaining = readLeases(root).map((lease) => `${lease.packageId || "legacy"}:${lease.scope}:${lease.leaf}`).sort();
  assert.deepEqual(remaining, [
    "beta:beta-scope:leaf-shared",
    "foreign:alpha-scope:leaf-foreign",
    "legacy:alpha-scope:leaf-legacy",
  ]);
});

test("dispatch persists scope/package identity through every transition and PackageStatus aggregates it", () => {
  const root = repo("dispatch-identity");
  bundle(root, "alpha");
  bundle(root, "beta");
  activate(root, "alpha", "alpha-scope");
  activate(root, "beta", "beta-scope");

  let result = dispatch(root, "open", "alpha", "alpha-scope", "--leaf", "leaf-shared");
  assert.equal(result.status, 0, result.stderr + result.stdout);
  let state = JSON.parse(readFileSync(join(root, ".unlazy", "alpha-scope", "dispatch.json"), "utf8"));
  assert.equal(state.schema, 2);
  assert.equal(state.scope, "alpha-scope");
  assert.equal(state.packageId, "alpha");
  assert.equal(state.waves["ready-1"].scope, "alpha-scope");
  assert.equal(state.waves["ready-1"].packageId, "alpha");

  let status = inspectPackageBundle(resolvePackageTarget({ root, packageId: "alpha", env: {} }));
  assert.deepEqual(status.dispatch, { state: "active", unfinished: 1 });
  assert.equal(status.status, "blocked");

  const mismatched = dispatch(root, "status", "beta", "alpha-scope");
  assert.equal(mismatched.status, 2, mismatched.stderr + mismatched.stdout);
  assert.match(mismatched.stderr, /not active in --scope/);

  result = dispatch(root, "start", "alpha", "alpha-scope", "--leaf", "leaf-shared", "--handle", "codex:one");
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(dispatch(root, "seal", "alpha", "alpha-scope").status, 0);
  assert.equal(dispatch(root, "return", "alpha", "alpha-scope", "--leaf", "leaf-shared").status, 0);
  state = JSON.parse(readFileSync(join(root, ".unlazy", "alpha-scope", "dispatch.json"), "utf8"));
  assert.equal(state.waves["ready-1"].scope, state.scope);
  assert.equal(state.waves["ready-1"].packageId, state.packageId);
  status = inspectPackageBundle(resolvePackageTarget({ root, packageId: "alpha", env: {} }));
  assert.deepEqual(status.dispatch, { state: "idle", unfinished: 0 });
});

test("dispatch refuses inactive packages and PackageStatus fails closed on identity tampering", () => {
  const inactive = repo("dispatch-inactive");
  bundle(inactive, "alpha");
  const refused = dispatch(inactive, "open", "alpha", "missing", "--leaf", "leaf-shared");
  assert.equal(refused.status, 2, refused.stderr + refused.stdout);
  assert.match(refused.stderr, /not active in --scope|active scope/);

  const root = repo("dispatch-tamper");
  bundle(root, "alpha");
  activate(root, "alpha", "alpha-scope");
  const path = join(root, ".unlazy", "alpha-scope", "dispatch.json");
  const state = JSON.parse(readFileSync(path, "utf8"));
  state.packageId = "other";
  writeFileSync(path, JSON.stringify(state, null, 2) + "\n", "utf8");
  const status = inspectPackageBundle(resolvePackageTarget({ root, packageId: "alpha", env: {} }));
  assert.equal(status.status, "invalid");
  assert.equal(status.dispatch.state, "invalid");
  assert(status.diagnostics.some((item) => item.code === "PACKAGE_DISPATCH"), JSON.stringify(status.diagnostics));
});

let passed = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    passed += 1;
    console.log("ok   " + name);
  } catch (error) {
    console.error("FAIL " + name);
    console.error("     " + (error.stack || error.message));
    process.exitCode = 1;
  }
}

process.on("exit", () => {
  try { rmSync(suiteRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); } catch { /* best effort */ }
});

emitTestCounts("package-fanout-tests", {
  tests: tests.length, pass: passed, fail: tests.length - passed, skip: 0,
});
if (!process.exitCode) console.log(`\n${passed}/${tests.length} passed, 0 skipped`);
