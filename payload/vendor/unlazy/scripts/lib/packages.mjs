import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import { join } from "node:path";
import { TextDecoder } from "node:util";
import packageContext from "./package-context.cjs";

const {
  assertNoLinkedComponent,
  assertRepositoryRoot,
  assertUniqueNames,
  isPathInside,
  listBundleGateFiles,
  listPackageBundles,
  resolvePackageBundle,
  resolveRepositoryRoot,
  validatePackageId,
} = packageContext;

const SCOPE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const utf8 = new TextDecoder("utf-8", { fatal: true });

function fail(message) {
  const error = new Error(message);
  error.code = "UNLAZY_PACKAGE_RESOLVER";
  throw error;
}

export function validateScopeId(value, label = "scope") {
  if (typeof value !== "string" || !SCOPE_RE.test(value)) {
    return label + " must match " + SCOPE_RE + ", got " + JSON.stringify(value);
  }
  return null;
}

function comparisonKey(value) {
  return process.platform === "win32" ? value.toLowerCase() : value;
}

export function samePackageId(left, right) {
  return comparisonKey(String(left)) === comparisonKey(String(right));
}

export function packageLegacyCollisions(repoRoot, packageId = null) {
  const collisions = [];
  for (const relativePath of ["GATES.md", "gates"]) {
    if (existsSync(join(repoRoot, relativePath))) collisions.push(relativePath);
  }
  if (packageId !== null) {
    const invalid = validatePackageId(packageId);
    if (invalid) fail(invalid);
    const flat = join("docs", "packages", packageId + ".md");
    if (existsSync(join(repoRoot, flat))) collisions.push(flat.replaceAll("\\", "/"));
  }
  return collisions;
}

export function assertPackageModeBoundary(repoRoot, packageId = null) {
  const collisions = packageLegacyCollisions(repoRoot, packageId);
  if (collisions.length) {
    fail("package mode conflicts with legacy fach state: " + collisions.join(", ") +
      "; move or migrate it, or use an explicit --legacy diagnostic command");
  }
}

function exactNamedRecord(records, name, label) {
  const key = comparisonKey(name);
  const matches = records.filter((record) => comparisonKey(record[label]) === key);
  if (matches.length !== 1) return null;
  return matches[0];
}

export function parsePackageRefText(text) {
  if (typeof text !== "string") fail("package.ref must be UTF-8 text");
  if (text.includes("\0")) fail("package.ref contains NUL");
  if (text.includes("\\")) fail("package.ref must use / separators");
  if (/^(?:[A-Za-z]:|\/\/|\\\\|\/)/.test(text)) fail("package.ref must be repository-relative");
  const match = text.match(/^docs\/packages\/([A-Za-z0-9][A-Za-z0-9._-]{0,63})\r?\n$/);
  if (!match) fail("package.ref must contain exactly one line: docs/packages/<packageId>");
  if (text.includes("/./") || text.includes("/../") || text.endsWith("/..\n")) {
    fail("package.ref traversal is not allowed");
  }
  const invalid = validatePackageId(match[1]);
  if (invalid) fail(invalid);
  return { packageId: match[1], relative: "docs/packages/" + match[1] };
}

export function readPackageRef(repoRoot, scope) {
  const invalid = validateScopeId(scope);
  if (invalid) fail(invalid);
  const refPath = join(repoRoot, ".unlazy", scope, "package.ref");
  if (!existsSync(refPath)) fail("missing package.ref for scope " + scope);
  assertNoLinkedComponent(repoRoot, refPath);
  const info = lstatSync(refPath);
  if (info.isSymbolicLink() || !info.isFile() || (typeof info.nlink === "number" && info.nlink !== 1)) {
    fail("package.ref must be a single-link regular file: " + refPath);
  }
  const bytes = readFileSync(refPath);
  if (bytes.length > 4096) fail("package.ref is too large");
  let text;
  try { text = utf8.decode(bytes); }
  catch { fail("package.ref is not valid UTF-8"); }
  const parsed = parsePackageRefText(text);
  const runtimeRoot = join(repoRoot, ".unlazy", scope);
  const fachState = ["GATES.md", "gates", "PLAN.md"].filter((name) => existsSync(join(runtimeRoot, name)));
  if (fachState.length) {
    fail("package scope " + scope + " contains legacy fach state under .unlazy: " + fachState.join(", "));
  }
  const bundle = resolvePackageBundle(repoRoot, parsed.packageId, { assertRoot: false });
  if (!isPathInside(repoRoot, bundle.packageDir)) fail("package.ref target escapes repository");
  return { scope, refPath: realpathSync(refPath), ...parsed, ...bundle };
}

function readSession(repoRoot, scope) {
  const sessionPath = join(repoRoot, ".unlazy", scope, "session");
  if (!existsSync(sessionPath)) return null;
  assertNoLinkedComponent(repoRoot, sessionPath);
  const info = lstatSync(sessionPath);
  if (info.isSymbolicLink() || !info.isFile() || info.size > 4096) fail("invalid session binding for scope " + scope);
  const value = readFileSync(sessionPath, "utf8").trim();
  return value || null;
}

export function listActiveScopes(repoRoot, options = {}) {
  const root = options.assertRoot === false ? realpathSync(repoRoot) : assertRepositoryRoot(repoRoot);
  const runtime = join(root, ".unlazy");
  if (!existsSync(runtime)) return [];
  assertNoLinkedComponent(root, runtime);
  const runtimeInfo = lstatSync(runtime);
  if (runtimeInfo.isSymbolicLink() || !runtimeInfo.isDirectory()) fail(".unlazy must be a real directory");
  const entries = readdirSync(runtime, { withFileTypes: true })
    .filter((entry) => entry.name !== "locks" && !entry.name.startsWith("."))
    .sort((left, right) => left.name.localeCompare(right.name, "en"));
  const scopeNames = entries.filter((entry) => entry.isDirectory() && !entry.isSymbolicLink()).map((entry) => entry.name);
  assertUniqueNames(scopeNames, { label: "scope" });
  const records = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      if (options.includeInvalid) records.push({ scope: entry.name, error: "scope runtime must be a real directory" });
      continue;
    }
    const invalid = validateScopeId(entry.name);
    if (invalid) {
      if (options.includeInvalid) records.push({ scope: entry.name, error: invalid });
      continue;
    }
    try {
      const binding = readPackageRef(root, entry.name);
      records.push({ ...binding, sessionId: readSession(root, entry.name), error: null });
    } catch (error) {
      if (options.includeInvalid) records.push({ scope: entry.name, error: error.message });
    }
  }
  return records;
}

function repositoryForOptions(options) {
  if (options.root !== undefined && options.root !== null) return assertRepositoryRoot(options.root);
  return resolveRepositoryRoot(options.cwd || process.cwd());
}

function validateRepoKey(value) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0") || value.includes("\\")) {
    fail("repoKey must be a non-empty /-separated display key");
  }
  if (value !== "." && (value.startsWith("/") || value.split("/").some((part) => !part || part === "." || part === ".."))) {
    fail("repoKey must be . or a contained relative display key");
  }
  return value;
}

function assertUniquePackageBindings(records) {
  const seen = new Map();
  for (const record of records.filter((item) => !item.error)) {
    const key = comparisonKey(record.packageId);
    if (seen.has(key)) {
      fail("package " + record.packageId + " is active in two scopes: " + seen.get(key) + " and " + record.scope);
    }
    seen.set(key, record.scope);
  }
}

function selectScope(records, scope, source) {
  const record = exactNamedRecord(records, scope, "scope");
  if (!record) fail(source + " names no unique active scope " + JSON.stringify(scope));
  if (record.error) fail(source + " names invalid scope " + JSON.stringify(scope) + ": " + record.error);
  return record;
}

function targetFromBundle(repoRoot, repoKey, bundle, scope = null) {
  return {
    repoRoot,
    repoKey,
    packageId: bundle.packageId,
    packageDir: bundle.packageDir,
    packageFile: bundle.packageFile,
    gateFiles: [...bundle.gateFiles],
    scope,
  };
}

export function resolvePackageTarget(options = {}) {
  const repoRoot = repositoryForOptions(options);
  const repoKey = validateRepoKey(options.repoKey || ".");
  const env = options.env || process.env;
  const records = listActiveScopes(repoRoot, { assertRoot: false, includeInvalid: true });
  assertUniquePackageBindings(records);

  const explicitPackage = options.packageId ?? options.package ?? null;
  if (explicitPackage !== null) {
    const invalid = validatePackageId(explicitPackage);
    if (invalid) fail(invalid);
    assertPackageModeBoundary(repoRoot, explicitPackage);
    const bundle = resolvePackageBundle(repoRoot, explicitPackage, { assertRoot: false });
    const active = records.filter((record) => !record.error && comparisonKey(record.packageId) === comparisonKey(bundle.packageId));
    return targetFromBundle(repoRoot, repoKey, bundle, active.length === 1 ? active[0].scope : null);
  }

  if (options.scope !== undefined && options.scope !== null) {
    const invalid = validateScopeId(options.scope);
    if (invalid) fail(invalid);
    const record = selectScope(records, options.scope, "--scope");
    assertPackageModeBoundary(repoRoot, record.packageId);
    return targetFromBundle(repoRoot, repoKey, record, record.scope);
  }

  if (env.UNLAZY_PACKAGE) {
    const invalid = validatePackageId(env.UNLAZY_PACKAGE, "UNLAZY_PACKAGE");
    if (invalid) fail(invalid);
    assertPackageModeBoundary(repoRoot, env.UNLAZY_PACKAGE);
    const bundle = resolvePackageBundle(repoRoot, env.UNLAZY_PACKAGE, { assertRoot: false });
    const active = records.filter((record) => !record.error && comparisonKey(record.packageId) === comparisonKey(bundle.packageId));
    return targetFromBundle(repoRoot, repoKey, bundle, active.length === 1 ? active[0].scope : null);
  }

  if (env.UNLAZY_SCOPE) {
    const invalid = validateScopeId(env.UNLAZY_SCOPE, "UNLAZY_SCOPE");
    if (invalid) fail(invalid);
    const record = selectScope(records, env.UNLAZY_SCOPE, "UNLAZY_SCOPE");
    assertPackageModeBoundary(repoRoot, record.packageId);
    return targetFromBundle(repoRoot, repoKey, record, record.scope);
  }

  if (options.sessionId !== undefined && options.sessionId !== null) {
    const session = String(options.sessionId).trim();
    const matches = records.filter((record) => !record.error && record.sessionId === session);
    if (matches.length > 1) fail("session binding is ambiguous across scopes: " + matches.map((item) => item.scope).join(", "));
    if (matches.length === 1) {
      assertPackageModeBoundary(repoRoot, matches[0].packageId);
      return targetFromBundle(repoRoot, repoKey, matches[0], matches[0].scope);
    }
  }

  const valid = records.filter((record) => !record.error);
  if (valid.length === 1) {
    assertPackageModeBoundary(repoRoot, valid[0].packageId);
    return targetFromBundle(repoRoot, repoKey, valid[0], valid[0].scope);
  }
  if (valid.length > 1) fail("multiple active scopes (" + valid.map((item) => item.scope).join(", ") + "); refusing to guess");
  const invalidScopes = records.filter((record) => record.error);
  if (invalidScopes.length) fail("no valid active scope; " + invalidScopes.map((item) => item.scope + ": " + item.error).join("; "));
  fail("no package target; pass --package or activate exactly one scope");
}

// Every bundle of one repository as targets, resolved once: one repository
// check, one scan of the active scopes and one listing of docs/packages. The
// per-package checks are the same as resolvePackageTarget({ packageId }) so a
// status built from these targets equals `package-cli status` for each one;
// resolving each package separately repeated the Git call and the directory
// listing per package (quadratic in the package count).
export function resolveAllPackageTargets(options = {}) {
  // verifiedRoot: the caller already bound this exact directory as the real
  // repository root (the dashboard does so before it measures), so the Git
  // process of assertRepositoryRoot is skipped; the path is still canonicalised.
  const repoRoot = options.verifiedRoot === true && typeof options.root === "string"
    ? realpathSync(options.root)
    : repositoryForOptions(options);
  const repoKey = validateRepoKey(options.repoKey || ".");
  const records = listActiveScopes(repoRoot, { assertRoot: false, includeInvalid: true });
  assertUniquePackageBindings(records);
  return listPackageBundles(repoRoot, { assertRoot: false }).map((bundle) => {
    assertPackageModeBoundary(repoRoot, bundle.packageId);
    const active = records.filter((record) => !record.error && comparisonKey(record.packageId) === comparisonKey(bundle.packageId));
    return targetFromBundle(repoRoot, repoKey, {
      ...bundle,
      gateFiles: listBundleGateFiles(repoRoot, bundle.packageDir),
    }, active.length === 1 ? active[0].scope : null);
  });
}

export function resolveRepository(options = {}) {
  return repositoryForOptions(options);
}
