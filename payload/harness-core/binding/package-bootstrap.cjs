"use strict";

// Narrow pre-activation state. It permits one session to author only the
// versioned OWNER/PACKAGE/GATES bundle in one exact Git repository. Once the
// package is active this capability stops, even if its runtime record remains.
// plan files a written bundle as planned (bundle, no package.ref, no record)
// so one session can write several packages in a row; begin and plan report
// OWNS overlaps with active packages, prune orphaned records, and a planning
// binding moves to a new session id only through an explicit --takeover.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const repository = require("./repository.cjs");
const unlazyRuntime = require("./unlazy-runtime.cjs");
const bundleFiles = require("./bundle-files.cjs");
const ownership = require("./package-ownership.cjs");

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const realpath = fs.realpathSync.native || fs.realpathSync;

function fail(message, code = "HARNESS_BOOTSTRAP", extra = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, extra);
  throw error;
}

const ACTIVE_NEXT = "die Leaf-Bindung des aktiven Pakets benutzen";
const RECORD_FILE = /^[0-9a-f]{64}\.json$/u;

function id(value, label) {
  const text = String(value || "");
  if (!IDENTIFIER.test(text)) fail(label + " must match " + IDENTIFIER);
  return text;
}

function validSession(value) {
  const text = String(value || "").trim();
  if (!text || text.length > 256 || /[\0\r\n]/u.test(text)) fail("sessionId is invalid");
  return text;
}

function harnessControlRoot(value) {
  const root = realpath(path.resolve(String(value || "")));
  const config = path.join(root, ".keel-harness.json");
  if (!fs.existsSync(config) || !fs.lstatSync(config).isFile() || fs.lstatSync(config).isSymbolicLink()) {
    fail("Harness root must contain a regular .keel-harness.json");
  }
  return root;
}

function recordPath(harnessRoot, sessionId) {
  const key = crypto.createHash("sha256").update(validSession(sessionId)).digest("hex") + ".json";
  return path.join(harnessRoot, ".unlazy", ".bootstrap", key);
}

const RENAME_RETRY_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);
const RENAME_RETRY_WAITS = Object.freeze([50, 100, 200, 400, 800]);

function sleepSync(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

// A short-lived handle of another process (virus scanner, indexer, file watcher)
// makes a Windows rename fail with EPERM/EBUSY/EACCES. Retry up to 6 attempts,
// then rethrow the original error; other codes and platforms fail at once.
function renameWithRetry(from, to, { rename = fs.renameSync, sleep = sleepSync, platform = process.platform } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try { return rename(from, to); }
    catch (error) {
      if (platform !== "win32" || !RENAME_RETRY_CODES.has(error && error.code) || attempt >= RENAME_RETRY_WAITS.length) throw error;
      sleep(RENAME_RETRY_WAITS[attempt]);
    }
  }
}

function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = file + "." + process.pid + "." + crypto.randomBytes(8).toString("hex") + ".tmp";
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
  try { renameWithRetry(temporary, file); }
  finally { try { fs.unlinkSync(temporary); } catch { /* renamed or absent */ } }
}

function regularJson(file) {
  if (!fs.existsSync(file)) return null;
  const info = fs.lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink() || (typeof info.nlink === "number" && info.nlink !== 1)) {
    fail("bootstrap record must be a single-link regular file");
  }
  let value;
  try { value = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { fail("bootstrap record is not valid JSON"); }
  return value;
}

function templateRoot() {
  return path.resolve(__dirname, "..", "..");
}

function template(name) {
  const file = path.join(templateRoot(), "templates", name);
  if (!fs.existsSync(file) || !fs.lstatSync(file).isFile()) fail("missing Harness template " + name);
  return fs.readFileSync(file, "utf8");
}

function scaffoldContents(packageId, date) {
  const replace = (text) => text.replaceAll("<packageId>", packageId).replaceAll("<YYYY-MM-DD>", date);
  return new Map([
    ["OWNER.md", replace(template("OWNER.md"))],
    ["PACKAGE.md", replace(templateRootFile())],
    ["GATES.md", replace(template("GATES-ROOT.md"))],
    ["gates/leaf-work.md", replace(template("GATES-LEAF.md")).replaceAll("<leafId>", "leaf-work")],
  ]);
}

// scaffold: exactly the four scaffold files (no links, nothing else) and
// PACKAGE.md, GATES.md and gates/leaf-work.md byte-equal to the templates at
// the Captured date of OWNER.md. ownerEdited: OWNER.md differs from its template.
function scaffoldStatus(target, packageId) {
  const status = { scaffold: false, ownerEdited: false };
  if (!fs.existsSync(target) || !fs.lstatSync(target).isDirectory() || fs.lstatSync(target).isSymbolicLink()) return status;
  const owner = path.join(target, "OWNER.md");
  if (!fs.existsSync(owner) || !fs.lstatSync(owner).isFile()) return status;
  const date = fs.readFileSync(owner, "utf8").match(/^Captured:\s*(\d{4}-\d{2}-\d{2})\s*$/mu)?.[1];
  if (!date) return { scaffold: false, ownerEdited: true };
  const expected = scaffoldContents(packageId, date);
  const same = (relative) => fs.readFileSync(path.join(target, relative)).equals(Buffer.from(expected.get(relative), "utf8"));
  status.ownerEdited = !same("OWNER.md");
  const actual = [];
  let safe = true;
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) { safe = false; return; }
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) actual.push(path.relative(target, absolute).replaceAll("\\", "/"));
      else { safe = false; return; }
    }
  };
  walk(target);
  if (!safe || JSON.stringify(actual.sort()) !== JSON.stringify([...expected.keys()].sort())) return status;
  status.scaffold = ["PACKAGE.md", "GATES.md", "gates/leaf-work.md"].every(same);
  return status;
}

function untouchedScaffold(target, packageId) {
  const status = scaffoldStatus(target, packageId);
  return status.scaffold && !status.ownerEdited;
}

function writeScaffold(repoRoot, packageId, date) {
  const packages = path.join(repoRoot, "docs", "packages");
  const target = path.join(packages, packageId);
  if (fs.existsSync(target)) fail("package target already exists: " + target);
  fs.mkdirSync(packages, { recursive: true });
  const temporary = path.join(packages, "." + packageId + ".bootstrap-" + crypto.randomBytes(8).toString("hex"));
  try {
    fs.mkdirSync(path.join(temporary, "gates"), { recursive: true });
    for (const [relative, content] of scaffoldContents(packageId, date)) {
      fs.writeFileSync(path.join(temporary, relative), content, { encoding: "utf8", flag: "wx" });
    }
    renameWithRetry(temporary, target);
  } catch (error) {
    try { fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 30 }); } catch { /* preserve primary error */ }
    throw error;
  }
  return target;
}

function templateRootFile() {
  const file = path.join(templateRoot(), "docs", "packages", "TEMPLATE.md");
  if (!fs.existsSync(file) || !fs.lstatSync(file).isFile()) fail("missing package TEMPLATE.md");
  return fs.readFileSync(file, "utf8");
}

// The Unlazy runtime of the addressed repository, checked before any scaffold
// or record exists. Two runtimes without --unlazy-root are refused with the
// shared message that names both paths and the switch.
function bootstrapRuntime(repoRoot, explicit) {
  try {
    return unlazyRuntime.locateUnlazy(repoRoot, explicit || undefined);
  } catch (error) {
    const count = Number(String(error.message).match(/found (\d+)/u)?.[1] || 0);
    if (!explicit && count > 1) {
      fail(error.message + ". every later package-executor and git-intent call for this package needs the same --unlazy-root");
    }
    fail(error.message);
  }
}

function sameId(left, right) {
  return String(left).toLowerCase() === String(right).toLowerCase();
}

// Active means: one scope of activeScopes names docs/packages/<packageId> in its package.ref.
function packageActive(repoRoot, packageId) {
  return ownership.activeScopes(repoRoot).scopes.some((item) => sameId(item.packageId, packageId));
}

function ownsArgument(values) {
  const list = (Array.isArray(values) ? values : values === undefined || values === null ? [] : [values])
    .flatMap((value) => String(value).split(","))
    .map((value) => value.trim())
    .filter(Boolean);
  return list.map((value) => {
    const normalized = ownership.normalizeOwnsGlob(value);
    if (normalized.error) fail("--owns is invalid: " + normalized.error);
    return { leaf: "--owns", pattern: normalized.value };
  });
}

function writtenClaims(repoRoot, packageId) {
  return ownership.packageOwnership(repoRoot, packageId).claims
    .filter((claim) => !claim.pattern.includes("<"))
    .map((claim) => ({ leaf: claim.leaf, pattern: claim.pattern }));
}

// Report only: every claim against every active scope of another package; the
// same package id in an active scope is reported without pattern comparison.
function overlapsFor(repoRoot, packageId, claims) {
  const overlaps = [];
  for (const other of ownership.activeScopes(repoRoot).scopes) {
    if (sameId(other.packageId, packageId)) {
      const conflict = { kind: "same-package", packageId: other.packageId, scope: other.scope,
        leaf: null, pattern: null, otherLeaf: null, otherPattern: null };
      overlaps.push({ ...conflict, text: ownership.describeConflict(conflict) });
      continue;
    }
    const theirs = ownership.packageOwnership(repoRoot, other.packageId).claims;
    for (const mine of claims) {
      for (const claim of theirs) {
        if (!ownership.globsOverlap(mine.pattern, claim.pattern)) continue;
        const conflict = { kind: "owns-overlap", packageId: other.packageId, scope: other.scope,
          leaf: mine.leaf, pattern: mine.pattern, otherLeaf: claim.leaf, otherPattern: claim.pattern };
        overlaps.push({ ...conflict, text: ownership.describeConflict(conflict) });
      }
    }
  }
  return overlaps;
}

function removeQuietly(file) {
  try { fs.unlinkSync(file); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
}

// Every record file under <harnessRoot>/.unlazy/.bootstrap/. Unreadable files are
// reported, never deleted; a record that vanished meanwhile is no error.
function readRecords(harnessRoot) {
  const directory = path.join(harnessRoot, ".unlazy", ".bootstrap");
  const records = [];
  const invalidRecords = [];
  let names = [];
  try { names = fs.readdirSync(directory); }
  catch (error) { if (error.code === "ENOENT") return { records, invalidRecords }; throw error; }
  for (const name of names.sort()) {
    if (!RECORD_FILE.test(name)) continue;
    const file = path.join(directory, name);
    try {
      const info = fs.lstatSync(file);
      if (!info.isFile() || info.isSymbolicLink() || (typeof info.nlink === "number" && info.nlink !== 1)) {
        invalidRecords.push({ file, reason: "not a single-link regular file" });
        continue;
      }
      const value = JSON.parse(fs.readFileSync(file, "utf8"));
      if (!value || value.schemaVersion !== 1 || typeof value.sessionId !== "string" ||
          !IDENTIFIER.test(String(value.packageId)) || typeof value.repoRoot !== "string") {
        invalidRecords.push({ file, reason: "record identity is invalid" });
        continue;
      }
      records.push({ file, value });
    } catch (error) {
      if (error.code === "ENOENT") continue;
      invalidRecords.push({ file, reason: error instanceof SyntaxError ? "record is not valid JSON" : error.message });
    }
  }
  return { records, invalidRecords };
}

function orphanReason(value) {
  let snapshot;
  try { snapshot = repository.repositorySnapshot(value.repoRoot); }
  catch { return { reason: "repository-missing" }; }
  if (!repository.samePath(snapshot.gitDir, value.gitDir)) return { reason: "repository-changed" };
  const bundle = path.join(snapshot.repoRoot, "docs", "packages", value.packageId);
  let info = null;
  try { info = fs.lstatSync(bundle); } catch { /* missing */ }
  if (!info || !info.isDirectory() || info.isSymbolicLink()) return { reason: "bundle-missing" };
  if (packageActive(snapshot.repoRoot, value.packageId)) return { reason: "package-active" };
  return { reason: null, repoRoot: snapshot.repoRoot };
}

function recordTime(value) {
  const time = Date.parse(value.takenOverAt || value.createdAt || "");
  return Number.isNaN(time) ? 0 : time;
}

function pruneOrphanedRecords(options = {}) {
  const harnessRoot = harnessControlRoot(options.harnessRoot);
  const { records, invalidRecords } = readRecords(harnessRoot);
  const prunedRecords = [];
  const doomed = [];
  const living = [];
  for (const record of records) {
    const state = orphanReason(record.value);
    if (state.reason) doomed.push({ record, reason: state.reason });
    else living.push({ ...record, repoRoot: state.repoRoot });
  }
  const groups = [];
  for (const record of living) {
    const group = groups.find((items) => repository.samePath(items[0].repoRoot, record.repoRoot) &&
      sameId(items[0].value.packageId, record.value.packageId));
    if (group) group.push(record); else groups.push([record]);
  }
  for (const group of groups) {
    if (group.length < 2) continue;
    group.sort((left, right) => recordTime(right.value) - recordTime(left.value));
    for (const record of group.slice(1)) doomed.push({ record, reason: "superseded" });
  }
  for (const { record, reason } of doomed) {
    if (!options.dryRun) removeQuietly(record.file);
    prunedRecords.push({ sessionId: record.value.sessionId, packageId: record.value.packageId, reason });
  }
  return { prunedRecords, invalidRecords };
}

function quote(value) {
  return "\"" + String(value).replaceAll("\"", "\\\"") + "\"";
}

function takeoverCommand(options, harnessRoot, repoRoot, packageId, scope, sessionId) {
  const parts = ["node", quote(path.join(__dirname, "..", "execution", "package-bootstrap.mjs")), "begin",
    "--harness-root", quote(harnessRoot), "--root", quote(repoRoot), "--package", packageId,
    "--scope", scope, "--session", quote(sessionId)];
  if (options.unlazyRoot) parts.push("--unlazy-root", quote(options.unlazyRoot));
  for (const claim of ownsArgument(options.owns)) parts.push("--owns", quote(claim.pattern));
  parts.push("--takeover");
  if (options.json) parts.push("--json");
  return parts.join(" ");
}

function begin(options) {
  const harnessRoot = harnessControlRoot(options.harnessRoot);
  const snapshot = repository.repositorySnapshot(options.root);
  const unlazyRoot = bootstrapRuntime(snapshot.repoRoot, options.unlazyRoot);
  if (!repository.samePath(harnessRoot, snapshot.repoRoot) && !repository.isPathInside(harnessRoot, snapshot.repoRoot)) {
    fail("repository is outside the Harness root");
  }
  const packageId = id(options.packageId, "packageId");
  const scope = id(options.scope || packageId, "scope");
  const sessionId = validSession(options.sessionId);
  const ownsClaims = ownsArgument(options.owns);
  if (options.takeover && packageActive(snapshot.repoRoot, packageId)) {
    fail("package " + packageId + " is active; a planning binding cannot be taken over", "PACKAGE_ACTIVE",
      { next: ACTIVE_NEXT });
  }
  const { prunedRecords, invalidRecords } = pruneOrphanedRecords({ harnessRoot });
  const report = (value) => {
    const ownsChecked = [...ownsClaims, ...writtenClaims(snapshot.repoRoot, packageId)];
    return { ...value, overlaps: overlapsFor(snapshot.repoRoot, packageId, ownsChecked), ownsChecked,
      prunedRecords, invalidRecords };
  };
  const file = recordPath(harnessRoot, sessionId);
  const existing = regularJson(file);
  if (existing) {
    if (existing.schemaVersion !== 1 || existing.sessionId !== sessionId || existing.packageId !== packageId ||
        existing.scope !== scope || !repository.samePath(existing.repoRoot, snapshot.repoRoot)) {
      fail("session already owns another package bootstrap");
    }
    return report({ ...existing, record: file, idempotent: true });
  }
  const holders = readRecords(harnessRoot).records.filter((item) => item.value.sessionId !== sessionId &&
    sameId(item.value.packageId, packageId) && repository.samePath(item.value.repoRoot, snapshot.repoRoot))
    .sort((left, right) => recordTime(right.value) - recordTime(left.value));
  if (holders.length && !options.takeover) {
    const holder = holders[0].value;
    fail("package " + packageId + " is held by session " + holder.sessionId + " since " + holder.createdAt +
      "; take it over with: " + takeoverCommand(options, harnessRoot, snapshot.repoRoot, packageId, scope, sessionId),
    "BOOTSTRAP_TAKEOVER_REQUIRED", { holder: holder.sessionId, holderCreatedAt: holder.createdAt });
  }
  const packageDir = path.join(snapshot.repoRoot, "docs", "packages", packageId);
  const createdAt = new Date().toISOString();
  if (holders.length) {
    if (!fs.existsSync(packageDir) || !fs.lstatSync(packageDir).isDirectory() || fs.lstatSync(packageDir).isSymbolicLink()) {
      fail("package bootstrap directory is missing or unsafe");
    }
  } else if (fs.existsSync(packageDir)) {
    if (!untouchedScaffold(packageDir, packageId)) {
      fail("package target exists without this session record and is not an untouched recoverable scaffold");
    }
  } else writeScaffold(snapshot.repoRoot, packageId, createdAt.slice(0, 10));
  const value = { schemaVersion: 1, harnessRoot, repoRoot: snapshot.repoRoot, gitDir: snapshot.gitDir,
    packageId, scope, sessionId, packagePath: "docs/packages/" + packageId,
    createdAt };
  if (options.unlazyRoot) value.unlazyRoot = unlazyRoot;
  if (holders.length) {
    value.takenOverFrom = holders[0].value.sessionId;
    value.takenOverAt = createdAt;
  }
  atomicJson(file, value);
  for (const holder of holders) removeQuietly(holder.file);
  return report({ ...value, record: file, packageDir, idempotent: false });
}

function find(options) {
  const harnessRoot = harnessControlRoot(options.harnessRoot);
  const sessionId = validSession(options.sessionId);
  const file = recordPath(harnessRoot, sessionId);
  const value = regularJson(file);
  if (!value) fail("no package bootstrap for this session");
  if (value.schemaVersion !== 1 || value.sessionId !== sessionId || !IDENTIFIER.test(value.packageId) ||
      !IDENTIFIER.test(value.scope) || !repository.samePath(value.harnessRoot, harnessRoot)) {
    fail("package bootstrap identity is invalid");
  }
  const snapshot = repository.repositorySnapshot(value.repoRoot);
  if (!repository.samePath(snapshot.gitDir, value.gitDir)) fail("package bootstrap repository changed");
  const expected = path.join(snapshot.repoRoot, "docs", "packages", value.packageId);
  if (!fs.existsSync(expected) || !fs.lstatSync(expected).isDirectory() || fs.lstatSync(expected).isSymbolicLink()) {
    fail("package bootstrap directory is missing or unsafe");
  }
  return { ...value, repoRoot: snapshot.repoRoot, packageDir: expected, record: file };
}

function doctorDiagnostics(result) {
  if (result.error) return [String(result.error.message)];
  let report = null;
  try { report = JSON.parse(String(result.stdout || "")); } catch { /* not JSON */ }
  const diagnostics = (report?.packages || []).flatMap((item) => (item.diagnostics || [])
    .map((diagnostic) => diagnostic.code + ": " + diagnostic.message));
  if (result.status !== 0 && !diagnostics.length) {
    diagnostics.push(String(result.stderr || result.stdout || "package-cli doctor exited " + result.status).trim());
  }
  return diagnostics;
}

// Files a written bundle as planned: bundle present, no package.ref, no record.
// Nothing is prepared under .unlazy/<scope>; starting stays a separate step.
function plan(options) {
  const record = find(options);
  if (packageActive(record.repoRoot, record.packageId)) {
    fail("package " + record.packageId + " is active", "PACKAGE_ACTIVE", { next: ACTIVE_NEXT });
  }
  const { prunedRecords, invalidRecords } = pruneOrphanedRecords({ harnessRoot: record.harnessRoot });
  const unlazy = bootstrapRuntime(record.repoRoot, options.unlazyRoot);
  const result = spawnSync(process.execPath, [path.join(unlazy, "scripts", "package-cli.mjs"), "doctor",
    "--root", record.repoRoot, "--package", record.packageId, "--json"],
  { windowsHide: true, timeout: 60000, encoding: "utf8" });
  const diagnostics = doctorDiagnostics(result);
  if (result.status !== 0 || result.error || diagnostics.length) {
    fail("package " + record.packageId + " is not ready to be filed as planned", "PLAN_DOCTOR",
      { exitCode: 1, diagnostics });
  }
  const overlaps = overlapsFor(record.repoRoot, record.packageId, writtenClaims(record.repoRoot, record.packageId));
  removeQuietly(record.record);
  return { packageId: record.packageId, scope: record.scope, repoRoot: record.repoRoot, state: "planned",
    activated: false, preparedLeaf: null, overlaps, prunedRecords, invalidRecords };
}

function active(record) {
  const ref = path.join(record.repoRoot, ".unlazy", record.scope, "package.ref");
  return fs.existsSync(ref) && fs.readFileSync(ref, "utf8") === record.packagePath + "\n";
}

function authorizeWrite(record, targetPath) {
  if (active(record)) return { allowed: false, code: "BOOTSTRAP_ENDED", next: "use the active package leaf binding" };
  const target = path.resolve(targetPath);
  if (!repository.isPathInside(record.packageDir, target)) {
    return { allowed: false, code: "OUTSIDE_BOOTSTRAP_PACKAGE", next: "write only the exact package contract bundle" };
  }
  const relative = path.relative(record.packageDir, target).replaceAll("\\", "/");
  const allowed = bundleFiles.bundleFilePattern(record.packageId).test(record.packagePath + "/" + relative);
  if (!allowed) return { allowed: false, code: "BOOTSTRAP_FILE", next: "bootstrap permits OWNER.md, PACKAGE.md, GATES.md and immediate gates/*.md only" };
  let parent = path.dirname(target);
  while (repository.isPathInside(record.packageDir, parent)) {
    if (fs.existsSync(parent) && fs.lstatSync(parent).isSymbolicLink()) {
      return { allowed: false, code: "BOOTSTRAP_LINK", next: "replace linked package components with real directories" };
    }
    if (repository.samePath(parent, record.packageDir)) break;
    parent = path.dirname(parent);
  }
  return { allowed: true, code: "BOUND_BOOTSTRAP_WRITE", relative, packageId: record.packageId, scope: record.scope };
}

function finish(options) {
  const record = find(options);
  if (!active(record)) fail("bootstrap can finish only after exact package activation");
  fs.unlinkSync(record.record);
  return { packageId: record.packageId, scope: record.scope, sessionId: record.sessionId, finished: true };
}

module.exports = { authorizeWrite, begin, find, finish, plan, pruneOrphanedRecords, recordPath, renameWithRetry, scaffoldStatus };
