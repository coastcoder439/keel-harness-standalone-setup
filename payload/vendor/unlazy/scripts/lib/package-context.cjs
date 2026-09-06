"use strict";

const fs = require("node:fs");
const path = require("node:path");
const repository = require("./repository.cjs");

const PACKAGE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const PACKAGES_RELATIVE = path.join("docs", "packages");

function fail(message) {
  const error = new Error(message);
  error.code = "UNLAZY_PACKAGE_CONTEXT";
  throw error;
}

function pathKey(value, options = {}) {
  return repository.pathKey(value, options);
}

function samePath(left, right, options = {}) {
  return repository.samePath(left, right, options);
}

function isPathInside(parent, child, options = {}) {
  return repository.isPathInside(parent, child, options);
}

function validatePackageId(value, label = "packageId") {
  if (typeof value !== "string" || !PACKAGE_ID_RE.test(value)) {
    return label + " must match " + PACKAGE_ID_RE + ", got " + JSON.stringify(value);
  }
  return null;
}

function assertUniqueNames(names, options = {}) {
  const platform = options.platform || process.platform;
  const seen = new Map();
  for (const name of names) {
    const invalid = validatePackageId(name, options.label || "name");
    if (invalid) fail(invalid);
    const key = platform === "win32" ? name.toLowerCase() : name;
    if (seen.has(key)) {
      fail("case-ambiguous " + (options.label || "name") + " values: " + seen.get(key) + " and " + name);
    }
    seen.set(key, name);
  }
  return names;
}

function resolveRepositoryRoot(startPath = process.cwd()) {
  try { return repository.resolveRepositoryRoot(startPath); }
  catch (error) { fail(error.message); }
}

function assertRepositoryRoot(root) {
  try { return repository.assertRepositoryRoot(root); }
  catch (error) { fail(error.message); }
}

function assertNoLinkedComponent(root, target) {
  const canonicalRoot = fs.realpathSync(root);
  const absoluteTarget = path.resolve(target);
  if (!isPathInside(canonicalRoot, absoluteTarget)) fail("path escapes repository: " + absoluteTarget);
  const relative = path.relative(canonicalRoot, absoluteTarget);
  let current = canonicalRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) break;
    const info = fs.lstatSync(current);
    if (info.isSymbolicLink()) fail("linked path component is not allowed: " + current);
  }
}

function assertRegularFile(root, file, label) {
  assertNoLinkedComponent(root, file);
  const info = fs.lstatSync(file);
  if (info.isSymbolicLink() || !info.isFile() || (typeof info.nlink === "number" && info.nlink !== 1)) {
    fail(label + " must be a single-link regular file: " + file);
  }
  const canonical = fs.realpathSync(file);
  if (!isPathInside(root, canonical)) fail(label + " escapes repository: " + file);
  return canonical;
}

function assertRealDirectory(root, directory, label) {
  assertNoLinkedComponent(root, directory);
  const info = fs.lstatSync(directory);
  if (info.isSymbolicLink() || !info.isDirectory()) fail(label + " must be a real directory: " + directory);
  const canonical = fs.realpathSync(directory);
  if (!isPathInside(root, canonical)) fail(label + " escapes repository: " + directory);
  return canonical;
}

function packagesDirectory(repoRoot) {
  return path.join(repoRoot, PACKAGES_RELATIVE);
}

function listPackageBundles(repoRoot, options = {}) {
  const root = options.assertRoot === false ? fs.realpathSync(repoRoot) : assertRepositoryRoot(repoRoot);
  const directory = packagesDirectory(root);
  if (!fs.existsSync(directory)) return [];
  assertRealDirectory(root, directory, "packages directory");
  const candidates = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || !entry.isDirectory() || entry.isSymbolicLink()) continue;
    if (validatePackageId(entry.name)) continue;
    const packageDir = path.join(directory, entry.name);
    const packageFile = path.join(packageDir, "PACKAGE.md");
    if (!fs.existsSync(packageFile)) continue;
    const canonicalDir = assertRealDirectory(root, packageDir, "package directory");
    const canonicalFile = assertRegularFile(root, packageFile, "PACKAGE.md");
    candidates.push({ packageId: entry.name, packageDir: canonicalDir, packageFile: canonicalFile });
  }
  candidates.sort((left, right) => left.packageId.localeCompare(right.packageId, "en"));
  assertUniqueNames(candidates.map((item) => item.packageId), { label: "packageId" });
  return candidates;
}

function listBundleGateFiles(repoRoot, packageDir) {
  const root = fs.realpathSync(repoRoot);
  const directory = fs.realpathSync(packageDir);
  if (!isPathInside(root, directory)) fail("package directory escapes repository: " + packageDir);
  const files = [];
  const rootLedger = path.join(directory, "GATES.md");
  if (fs.existsSync(rootLedger)) files.push(assertRegularFile(root, rootLedger, "GATES.md"));
  const sidecarDir = path.join(directory, "gates");
  if (fs.existsSync(sidecarDir)) {
    assertRealDirectory(root, sidecarDir, "gates directory");
    const names = fs.readdirSync(sidecarDir, { withFileTypes: true })
      .filter((entry) => entry.name.endsWith(".md"))
      .sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of names) {
      if (!entry.isFile() || entry.isSymbolicLink()) fail("gate sidecar must be a regular file: " + entry.name);
      files.push(assertRegularFile(root, path.join(sidecarDir, entry.name), "gate sidecar"));
    }
  }
  return files;
}

function resolvePackageBundle(repoRoot, packageId, options = {}) {
  const invalid = validatePackageId(packageId);
  if (invalid) fail(invalid);
  const root = options.assertRoot === false ? fs.realpathSync(repoRoot) : assertRepositoryRoot(repoRoot);
  const candidates = listPackageBundles(root, { assertRoot: false });
  const key = process.platform === "win32" ? packageId.toLowerCase() : packageId;
  const matches = candidates.filter((item) =>
    (process.platform === "win32" ? item.packageId.toLowerCase() : item.packageId) === key);
  if (matches.length !== 1) {
    const have = candidates.map((item) => item.packageId).join(", ") || "none";
    fail("no unique package " + JSON.stringify(packageId) + " in repository (have: " + have + ")");
  }
  const bundle = matches[0];
  return { ...bundle, gateFiles: listBundleGateFiles(root, bundle.packageDir) };
}

// Resolve from the path that owns the work, never from a control/workbench
// directory. This is the package entry point for nested repositories and
// linked worktrees: Git selects the real root first, then only that root's
// docs/packages tree is considered.
function resolveOwningPackageBundle(workTarget, packageId) {
  const repoRoot = resolveRepositoryRoot(workTarget);
  const bundle = resolvePackageBundle(repoRoot, packageId, { assertRoot: false });
  return { repoRoot, ...bundle };
}

function selfTest() {
  if (validatePackageId("alpha-1") !== null || validatePackageId("../bad") === null) {
    throw new Error("package-context identifier self-test failed");
  }
  assertUniqueNames(["Alpha", "alpha"], { platform: "linux" });
  let rejected = false;
  try { assertUniqueNames(["Alpha", "alpha"], { platform: "win32" }); } catch { rejected = true; }
  if (!rejected) throw new Error("package-context case-fold self-test failed");
  if (!isPathInside(path.resolve("a"), path.resolve("a", "b"))) {
    throw new Error("package-context containment self-test failed");
  }
  return true;
}

module.exports = {
  PACKAGE_ID_RE,
  PACKAGES_RELATIVE,
  assertNoLinkedComponent,
  assertRegularFile,
  assertRepositoryRoot,
  assertUniqueNames,
  isPathInside,
  listBundleGateFiles,
  listPackageBundles,
  pathKey,
  resolvePackageBundle,
  resolveOwningPackageBundle,
  resolveRepositoryRoot,
  samePath,
  selfTest,
  validatePackageId,
};

if (require.main === module) {
  if (process.argv.length === 3 && process.argv[2] === "--selbsttest") {
    selfTest();
    console.log("package-context self-test passed");
  } else {
    console.error("usage: package-context.cjs --selbsttest");
    process.exitCode = 2;
  }
}
