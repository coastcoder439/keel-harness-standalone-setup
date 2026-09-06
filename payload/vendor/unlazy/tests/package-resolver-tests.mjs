import assert from "node:assert/strict";
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  listActiveScopes,
  parsePackageRefText,
  readPackageRef,
  resolvePackageTarget,
} from "../scripts/lib/packages.mjs";
import { initRepository } from "./helpers/git-repo.mjs";
import { emitTestCounts } from "./helpers/test-counts.mjs";

const require = createRequire(import.meta.url);
const context = require("../scripts/lib/package-context.cjs");
const suiteRoot = mkdtempSync(join(tmpdir(), "unlazy-package-resolver-"));
const cleanups = [];

function repo(name, marker = "directory") {
  const root = join(suiteRoot, name);
  initRepository(root, marker === "file"
    ? { separateGitDir: join(suiteRoot, "gitdirs", name) }
    : {});
  return context.resolveRepositoryRoot(realpathSync(root));
}

function bundle(root, packageId, sidecars = []) {
  const directory = join(root, "docs", "packages", packageId);
  mkdirSync(join(directory, "gates"), { recursive: true });
  writeFileSync(join(directory, "PACKAGE.md"), `# Work package: ${packageId}\n`, "utf8");
  writeFileSync(join(directory, "GATES.md"), `# Gates: ${packageId}\n`, "utf8");
  for (const sidecar of sidecars) writeFileSync(join(directory, "gates", sidecar), `# ${sidecar}\n`, "utf8");
  return directory;
}

function scope(root, scopeId, packageId, sessionId = null) {
  const directory = join(root, ".unlazy", scopeId);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "package.ref"), `docs/packages/${packageId}\n`, "utf8");
  if (sessionId !== null) writeFileSync(join(directory, "session"), String(sessionId) + "\n", "utf8");
  return directory;
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
    console.error("     " + error.message);
    process.exitCode = 1;
  }
};

test("nearest repository root is found from deep and not-yet-created paths", () => {
  const root = repo("upward");
  const deep = join(root, "src", "feature");
  mkdirSync(deep, { recursive: true });
  assert.equal(context.resolveRepositoryRoot(deep), root);
  assert.equal(context.resolveRepositoryRoot(join(deep, "future", "file.js")), root);
});

test("a regular .git file is a repository boundary", () => {
  const root = repo("git-file", "file");
  const deep = join(root, "nested");
  mkdirSync(deep);
  assert.equal(context.resolveRepositoryRoot(deep), root);
  assert.equal(context.assertRepositoryRoot(root), root);
});

test("explicit --root must be the repository root itself", () => {
  const root = repo("root-assertion");
  const deep = join(root, "nested");
  mkdirSync(deep);
  const file = join(root, "not-a-root.txt");
  writeFileSync(file, "not a directory\n", "utf8");
  assert.throws(() => context.assertRepositoryRoot(deep), /root itself/);
  assert.throws(() => context.assertRepositoryRoot(file), /not a directory/);
});

test("parent discovery never descends into a child repository", () => {
  const parent = repo("workbench");
  bundle(parent, "same");
  const child = join(parent, "user-projects", "child");
  initRepository(child);
  bundle(child, "same");
  const parentDeep = join(parent, "dashboard", "render");
  const childDeep = join(child, "src", "deep");
  mkdirSync(parentDeep, { recursive: true });
  mkdirSync(childDeep, { recursive: true });
  assert.equal(resolvePackageTarget({ cwd: parentDeep, packageId: "same" }).repoRoot, parent);
  assert.equal(resolvePackageTarget({ cwd: childDeep, packageId: "same" }).repoRoot, child);
  assert.deepEqual(context.listPackageBundles(parent).map((item) => item.packageId), ["same"]);
});

test("equal package and scope names remain isolated across repositories", () => {
  const left = repo("isolation-left");
  const right = repo("isolation-right");
  bundle(left, "release");
  bundle(right, "release");
  scope(left, "main", "release");
  scope(right, "main", "release");
  const a = resolvePackageTarget({ root: left, scope: "main" });
  const b = resolvePackageTarget({ root: right, scope: "main" });
  assert.equal(a.packageId, b.packageId);
  assert.notEqual(a.repoRoot, b.repoRoot);
  assert.notEqual(a.packageFile, b.packageFile);
});

test("bundle gate files are root-first and sorted sidecars", () => {
  const root = repo("gate-order");
  bundle(root, "fanout", ["node-2.md", "leaf-1.md", "node-1.md"]);
  const target = resolvePackageTarget({ root, packageId: "fanout" });
  assert.deepEqual(target.gateFiles.map((file) => relative(root, file).replaceAll("\\", "/")), [
    "docs/packages/fanout/GATES.md",
    "docs/packages/fanout/gates/leaf-1.md",
    "docs/packages/fanout/gates/node-1.md",
    "docs/packages/fanout/gates/node-2.md",
  ]);
});

test("selection precedence is package, scope, environment, session, singleton", () => {
  const root = repo("precedence");
  bundle(root, "alpha");
  bundle(root, "beta");
  scope(root, "scope-a", "alpha", "session-a");
  scope(root, "scope-b", "beta", "session-b");
  assert.equal(resolvePackageTarget({ root, packageId: "alpha", scope: "scope-b", env: { UNLAZY_PACKAGE: "beta" } }).packageId, "alpha");
  assert.equal(resolvePackageTarget({ root, scope: "scope-b", env: { UNLAZY_PACKAGE: "alpha" } }).packageId, "beta");
  assert.equal(resolvePackageTarget({ root, env: { UNLAZY_PACKAGE: "alpha", UNLAZY_SCOPE: "scope-b" } }).packageId, "alpha");
  assert.equal(resolvePackageTarget({ root, env: { UNLAZY_SCOPE: "scope-b" }, sessionId: "session-a" }).packageId, "beta");
  assert.equal(resolvePackageTarget({ root, env: {}, sessionId: "session-a" }).packageId, "alpha");
  rmSync(join(root, ".unlazy", "scope-b"), { recursive: true, force: true });
  assert.equal(resolvePackageTarget({ root, env: {} }).packageId, "alpha");
});

test("ambiguity and duplicate package activation fail deterministically", () => {
  const ambiguous = repo("ambiguous");
  bundle(ambiguous, "alpha");
  bundle(ambiguous, "beta");
  scope(ambiguous, "one", "alpha");
  scope(ambiguous, "two", "beta");
  assert.throws(() => resolvePackageTarget({ root: ambiguous, env: {} }), /multiple active scopes/);

  const duplicate = repo("duplicate-binding");
  bundle(duplicate, "alpha");
  scope(duplicate, "one", "alpha");
  scope(duplicate, "two", "alpha");
  assert.throws(() => resolvePackageTarget({ root: duplicate, packageId: "alpha", env: {} }), /active in two scopes/);
});

test("Windows case folding rejects ambiguous identifiers", () => {
  assert.doesNotThrow(() => context.assertUniqueNames(["Foo", "foo"], { platform: "linux", label: "packageId" }));
  assert.throws(() => context.assertUniqueNames(["Foo", "foo"], { platform: "win32", label: "packageId" }), /case-ambiguous/);
});

test("package.ref rejects traversal, drive, UNC, slash, NUL, and extra lines", () => {
  const invalid = [
    "../outside\n",
    "docs/packages/../outside\n",
    "C:/docs/packages/alpha\n",
    "//server/share/docs/packages/alpha\n",
    "\\\\server\\share\\alpha\n",
    "docs\\packages\\alpha\n",
    "docs/packages/alpha\0\n",
    "docs/packages/alpha\nextra\n",
    "docs/packages/alpha",
    "\n",
  ];
  for (const value of invalid) assert.throws(() => parsePackageRefText(value), /package\.ref/);
  assert.deepEqual(parsePackageRefText("docs/packages/alpha\r\n"), {
    packageId: "alpha",
    relative: "docs/packages/alpha",
  });
});

test("linked package targets and linked refs are rejected", () => {
  const root = repo("link-attacks");
  mkdirSync(join(root, "docs", "packages"), { recursive: true });
  const outside = join(suiteRoot, "outside-bundle");
  bundle(repo("outside-repo"), "outside");
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(outside, "PACKAGE.md"), "# outside\n", "utf8");
  writeFileSync(join(outside, "GATES.md"), "# outside gates\n", "utf8");
  mkdirSync(join(outside, "gates"));
  symlinkSync(outside, join(root, "docs", "packages", "evil"), "junction");
  assert.throws(() => resolvePackageTarget({ root, packageId: "evil" }), /no unique package|linked/);

  bundle(root, "safe");
  const runtime = join(root, ".unlazy", "main");
  mkdirSync(runtime, { recursive: true });
  const outsideRef = join(suiteRoot, "outside-package.ref");
  writeFileSync(outsideRef, "docs/packages/safe\n", "utf8");
  linkSync(outsideRef, join(runtime, "package.ref"));
  assert.throws(() => readPackageRef(root, "main"), /single-link regular file/);
});

test("invalid active refs do not become valid singleton targets", () => {
  const root = repo("invalid-active-ref");
  bundle(root, "safe");
  const runtime = join(root, ".unlazy", "broken");
  mkdirSync(runtime, { recursive: true });
  writeFileSync(join(runtime, "package.ref"), "docs/packages/../safe\n", "utf8");
  const records = listActiveScopes(root, { includeInvalid: true });
  assert.equal(records.length, 1);
  assert.match(records[0].error, /package\.ref/);
  assert.throws(() => resolvePackageTarget({ root, env: {} }), /no valid active scope/);
});

process.on("exit", () => {
  for (const cleanup of cleanups) cleanup();
  try { rmSync(suiteRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 }); } catch { /* best effort */ }
});

emitTestCounts("package-resolver-tests", {
  tests: total, pass: passed, fail: total - passed, skip: 0,
});
if (!process.exitCode) console.log(`\n${passed}/${total} passed, 0 skipped`);
