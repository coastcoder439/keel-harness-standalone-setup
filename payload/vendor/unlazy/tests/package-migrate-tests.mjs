import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  SimulatedMigrationCrash,
  applyLegacyMigration,
  dryRunLegacyMigration,
  prepareLegacyMigration,
  resumeLegacyMigration,
  rollbackLegacyMigration,
} from "../scripts/lib/package-migration.mjs";
import { git, initRepository } from "./helpers/git-repo.mjs";
import { emitTestCounts } from "./helpers/test-counts.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MIGRATOR = join(ROOT, "scripts", "package-migrate.mjs");
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (error) {
    failed++;
    console.error("FAIL " + name + "\n" + (error.stack || error));
  }
}

function validLegacy(packageId, options = {}) {
  const marker = options.marker || " ";
  const extra = options.extra || "";
  return `# Work package: Human readable ${packageId}

**Problem:** A legacy flat package is the only current truth.
**Intent:** Move the same meaning into one repository-owned bundle.
**Goal:** The flat source is gone and the bundle is valid.

## Plan

1. [${marker}] Prepare the contract before implementation fan-out.
2. [x] Verify the repository boundary.

${extra}## Status

Migration rehearsal is pending.

## Abnahme

- the package exists only as a bundle
- repository ownership remains isolated

## Abschluss

Coverage: 2/2 mapped; 0/2 met.
Fulfillment: nicht erfuellt - gates are pending.
Geprueft gegen: migration dry-run.
Offen: gate execution and package closure.

## Anhang

Synthetic fixture; no user-project content.
`;
}

function makeRepo(name = "repo", options = {}) {
  const parent = mkdtempSync(join(tmpdir(), "unlazy-migrate-"));
  const root = join(parent, name);
  const separateGitDir = options.gitFile ? join(parent, "gitdirs", name) : null;
  initRepository(root, separateGitDir ? { separateGitDir } : {});
  writeFileSync(join(root, ".gitignore"), ".unlazy/\n");
  mkdirSync(join(root, "docs", "packages"), { recursive: true });
  writeFileSync(join(root, "docs", "packages", "TEMPLATE.md"), "# template\n");
  return { parent, root, gitDir: git(root, "rev-parse", "--absolute-git-dir") };
}

function putLegacy(root, packageId, text = validLegacy(packageId)) {
  const file = join(root, "docs", "packages", packageId + ".md");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
  return file;
}

function cleanup(repo) {
  rmSync(repo.parent, { recursive: true, force: true });
}

test("dry-run emits a complete semantic mapping and changes no file", () => {
  const repo = makeRepo();
  try {
    const source = putLegacy(repo.root, "alpha");
    const before = readFileSync(source, "utf8");
    const result = dryRunLegacyMigration({ root: repo.root, packageId: "alpha" });
    assert.equal(result.migrationBlocked, false);
    assert.equal(result.semantic.plan.length, 2);
    assert.deepEqual(result.semantic.contract.map((item) => item.gateId), ["G1", "G2"]);
    assert.equal(readFileSync(source, "utf8"), before);
    assert.equal(existsSync(join(repo.root, "docs", "packages", "alpha")), false);
    assert.equal(existsSync(join(repo.root, ".unlazy")), false);
  } finally { cleanup(repo); }
});

test("apply cuts over to bundle-only without importing runtime or approval data", () => {
  const repo = makeRepo();
  try {
    putLegacy(repo.root, "alpha");
    mkdirSync(join(repo.root, ".unlazy", "old-scope"), { recursive: true });
    writeFileSync(join(repo.root, ".unlazy", "old-scope", "status.log"), "legacy-log\n");
    const result = applyLegacyMigration({ root: repo.root, packageId: "alpha" });
    assert.equal(result.state, "bundle-only");
    assert.equal(result.approvalInvalidated, true);
    assert.equal(result.runtimeImported, false);
    assert.equal(existsSync(join(repo.root, "docs", "packages", "alpha.md")), false);
    assert.equal(existsSync(join(repo.root, "docs", "packages", "alpha", "PACKAGE.md")), true);
    assert.equal(readFileSync(join(repo.root, ".unlazy", "old-scope", "status.log"), "utf8"), "legacy-log\n");
    const packageText = readFileSync(join(repo.root, "docs", "packages", "alpha", "PACKAGE.md"), "utf8");
    assert.match(packageText, /disabled flat package docs\/packages\/alpha\.md/);
    assert.doesNotMatch(packageText, /legacy-log/);
  } finally { cleanup(repo); }
});

test("an existing target and an unassigned root ledger fail before mutation", () => {
  for (const mode of ["target", "ledger"]) {
    const repo = makeRepo(mode);
    try {
      const source = putLegacy(repo.root, "alpha");
      if (mode === "target") mkdirSync(join(repo.root, "docs", "packages", "alpha"));
      else writeFileSync(join(repo.root, "GATES.md"), "# ambiguous\n");
      assert.throws(
        () => dryRunLegacyMigration({ root: repo.root, packageId: "alpha" }),
        /collide|unclear gate source/i,
      );
      assert.equal(existsSync(source), true);
    } finally { cleanup(repo); }
  }
});

test("partial plan state and unknown sections are preserved as blockers, never guessed", () => {
  const partial = prepareLegacyMigration("alpha", validLegacy("alpha", { marker: "~" }));
  assert.equal(partial.migrationBlocked, true);
  assert.ok(partial.blockers.some((item) => item.code === "PARTIAL_PLAN_STATE"));
  assert.match(partial.packageText, /Migration blockers preserved: legacy \[~\] step\(s\) 1/);
  const unknown = prepareLegacyMigration("alpha", validLegacy("alpha", { extra: "## Owner decision\n\nKeep this exact decision.\n\n" }));
  assert.ok(unknown.blockers.some((item) => item.code === "UNKNOWN_SECTIONS"));
  assert.match(unknown.packageText, /Keep this exact decision/);
});

test("a migration lock returns ownership conflict exit semantics", () => {
  const repo = makeRepo();
  try {
    putLegacy(repo.root, "alpha");
    mkdirSync(join(repo.root, ".unlazy", "locks"), { recursive: true });
    writeFileSync(join(repo.root, ".unlazy", "locks", "package-migration.lock"), JSON.stringify({ token: "other", packageId: "beta" }));
    assert.throws(
      () => applyLegacyMigration({ root: repo.root, packageId: "alpha" }),
      (error) => error.exitCode === 3 && /owns/.test(error.message),
    );
  } finally { cleanup(repo); }
});

test("changed Git index aborts before cutover and leaves legacy-only", () => {
  const repo = makeRepo();
  try {
    putLegacy(repo.root, "alpha");
    assert.throws(
      () => applyLegacyMigration({
        root: repo.root,
        packageId: "alpha",
        failpoint: (point) => {
          if (point === "after-prepare") {
            writeFileSync(join(repo.root, "index-change.txt"), "change\n");
            git(repo.root, "add", "index-change.txt");
          }
        },
      }),
      (error) => error.exitCode === 3 && /index changed/.test(error.message),
    );
    assert.equal(existsSync(join(repo.root, "docs", "packages", "alpha.md")), true);
    assert.equal(existsSync(join(repo.root, "docs", "packages", "alpha")), false);
    assert.equal(existsSync(join(repo.root, ".unlazy", "migrations", "alpha.json")), false);
    assert.equal(existsSync(join(repo.root, ".unlazy", "locks", "package-migration.lock")), false);
  } finally { cleanup(repo); }
});

test("crash after target visibility resumes without a second truth", () => {
  const repo = makeRepo();
  try {
    putLegacy(repo.root, "alpha");
    assert.throws(
      () => applyLegacyMigration({ root: repo.root, packageId: "alpha", killpoint: "after-target" }),
      SimulatedMigrationCrash,
    );
    assert.equal(existsSync(join(repo.root, "docs", "packages", "alpha.md")), true);
    assert.equal(existsSync(join(repo.root, "docs", "packages", "alpha")), true);
    const result = resumeLegacyMigration({ root: repo.root, packageId: "alpha" });
    assert.equal(result.state, "bundle-only");
    assert.equal(existsSync(join(repo.root, "docs", "packages", "alpha.md")), false);
  } finally { cleanup(repo); }
});

test("crash after source removal can roll back byte-exactly", () => {
  const repo = makeRepo();
  try {
    const source = putLegacy(repo.root, "alpha");
    const before = readFileSync(source, "utf8").replace(/\r\n/g, "\n");
    assert.throws(
      () => applyLegacyMigration({ root: repo.root, packageId: "alpha", killpoint: "after-source-remove" }),
      SimulatedMigrationCrash,
    );
    assert.equal(existsSync(source), false);
    const result = rollbackLegacyMigration({ root: repo.root, packageId: "alpha" });
    assert.equal(result.state, "legacy-only");
    assert.equal(readFileSync(source, "utf8"), before);
    assert.equal(existsSync(join(repo.root, "docs", "packages", "alpha")), false);
  } finally { cleanup(repo); }
});

test("regular .git files/worktrees are valid migration repository boundaries", () => {
  const repo = makeRepo("worktree", { gitFile: true });
  try {
    putLegacy(repo.root, "alpha");
    const result = applyLegacyMigration({ root: repo.root, packageId: "alpha" });
    assert.equal(result.state, "bundle-only");
  } finally { cleanup(repo); }
});

test("21-package landscape migrates per repository plus same-id isolation", () => {
  const landscape = {
    workbench: ["access-go-live", "dashboard-v3", "global-rules-bloat", "google-full-access", "harness-completion", "injection-not-effective", "keel-unlazy-integration", "learn-process-harness", "order-enforcement", "package-hygiene", "project-packages", "repo-structure-standard", "session-messages", "work-loop-enforcement"],
    karriereplanung: ["jobcenter-freistellung", "portfolio-seite", "zertifikate"],
    accountability: ["today-cockpit"],
    funnel: ["recherche-funnel-grundlagen", "v1-vollausbau"],
    social: ["ausgruendung"],
  };
  const base = mkdtempSync(join(tmpdir(), "unlazy-landscape-"));
  try {
    let migrated = 0;
    const repos = new Map();
    for (const [name, ids] of Object.entries(landscape)) {
      const root = join(base, name === "workbench" ? "workspace" : "workspace", name === "workbench" ? "" : join("user-projects", name));
      if (name === "social") {
        const gitDir = join(base, "gitdirs", name);
        initRepository(root, { separateGitDir: gitDir });
      } else {
        initRepository(root);
      }
      writeFileSync(join(root, ".gitignore"), ".unlazy/\n");
      mkdirSync(join(root, "docs", "packages"), { recursive: true });
      writeFileSync(join(root, "docs", "packages", "TEMPLATE.md"), "# template\n");
      repos.set(name, root);
      for (const id of ids) {
        putLegacy(root, id);
        applyLegacyMigration({ root, packageId: id });
        migrated++;
      }
    }
    assert.equal(migrated, 21);
    putLegacy(repos.get("workbench"), "shared-release");
    putLegacy(repos.get("karriereplanung"), "shared-release");
    applyLegacyMigration({ root: repos.get("workbench"), packageId: "shared-release" });
    applyLegacyMigration({ root: repos.get("karriereplanung"), packageId: "shared-release" });
    for (const root of repos.values()) {
      const immediateMarkdown = readdirSync(join(root, "docs", "packages"), { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && entry.name !== "TEMPLATE.md");
      assert.deepEqual(immediateMarkdown, []);
    }
    assert.equal(existsSync(join(repos.get("workbench"), "docs", "packages", "shared-release", "PACKAGE.md")), true);
    assert.equal(existsSync(join(repos.get("karriereplanung"), "docs", "packages", "shared-release", "PACKAGE.md")), true);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("CLI exposes expected exit 1 for semantic blocker and exit 2 for collision", () => {
  const repo = makeRepo("cli");
  try {
    putLegacy(repo.root, "partial", validLegacy("partial", { marker: "~" }));
    const blocked = spawnSync(process.execPath, [MIGRATOR, "--dry-run", "--root", repo.root, "--package", "partial"], { encoding: "utf8" });
    assert.equal(blocked.status, 1, blocked.stdout + blocked.stderr);
    assert.match(blocked.stdout, /PARTIAL_PLAN_STATE/);
    putLegacy(repo.root, "collision");
    mkdirSync(join(repo.root, "docs", "packages", "collision"));
    const collision = spawnSync(process.execPath, [MIGRATOR, "--apply", "--root", repo.root, "--package", "collision"], { encoding: "utf8" });
    assert.equal(collision.status, 2, collision.stdout + collision.stderr);
    assert.match(collision.stderr, /collide/i);
  } finally { cleanup(repo); }
});

emitTestCounts("package-migrate-tests", {
  tests: passed + failed, pass: passed, fail: failed, skip: 0,
});
console.log(`package-migrate-tests: ${passed}/${passed + failed} passed, 0 skipped`);
if (failed) process.exitCode = 1;
