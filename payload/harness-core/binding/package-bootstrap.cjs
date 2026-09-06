"use strict";

// Narrow pre-activation state. It permits one session to author only the
// versioned OWNER/PACKAGE/GATES bundle in one exact Git repository. Once the
// package is active this capability stops, even if its runtime record remains.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const repository = require("./repository.cjs");

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const realpath = fs.realpathSync.native || fs.realpathSync;

function fail(message) {
  const error = new Error(message);
  error.code = "HARNESS_BOOTSTRAP";
  throw error;
}

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

function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = file + "." + process.pid + "." + crypto.randomBytes(8).toString("hex") + ".tmp";
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
  try { fs.renameSync(temporary, file); }
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

function untouchedScaffold(target, packageId) {
  if (!fs.existsSync(target) || !fs.lstatSync(target).isDirectory() || fs.lstatSync(target).isSymbolicLink()) return false;
  const owner = path.join(target, "OWNER.md");
  if (!fs.existsSync(owner)) return false;
  const date = fs.readFileSync(owner, "utf8").match(/^Captured:\s*(\d{4}-\d{2}-\d{2})\s*$/mu)?.[1];
  if (!date) return false;
  const expected = scaffoldContents(packageId, date);
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
  if (!safe || JSON.stringify(actual.sort()) !== JSON.stringify([...expected.keys()].sort())) return false;
  return [...expected].every(([relative, content]) => fs.readFileSync(path.join(target, relative), "utf8") === content);
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
    fs.renameSync(temporary, target);
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

function begin(options) {
  const harnessRoot = harnessControlRoot(options.harnessRoot);
  const snapshot = repository.repositorySnapshot(options.root);
  if (!repository.samePath(harnessRoot, snapshot.repoRoot) && !repository.isPathInside(harnessRoot, snapshot.repoRoot)) {
    fail("repository is outside the Harness root");
  }
  const packageId = id(options.packageId, "packageId");
  const scope = id(options.scope || packageId, "scope");
  const sessionId = validSession(options.sessionId);
  const file = recordPath(harnessRoot, sessionId);
  const existing = regularJson(file);
  if (existing) {
    if (existing.schemaVersion !== 1 || existing.sessionId !== sessionId || existing.packageId !== packageId ||
        existing.scope !== scope || !repository.samePath(existing.repoRoot, snapshot.repoRoot)) {
      fail("session already owns another package bootstrap");
    }
    return { ...existing, record: file, idempotent: true };
  }
  const packageDir = path.join(snapshot.repoRoot, "docs", "packages", packageId);
  const createdAt = new Date().toISOString();
  if (fs.existsSync(packageDir)) {
    if (!untouchedScaffold(packageDir, packageId)) {
      fail("package target exists without this session record and is not an untouched recoverable scaffold");
    }
  } else writeScaffold(snapshot.repoRoot, packageId, createdAt.slice(0, 10));
  const value = { schemaVersion: 1, harnessRoot, repoRoot: snapshot.repoRoot, gitDir: snapshot.gitDir,
    packageId, scope, sessionId, packagePath: "docs/packages/" + packageId,
    createdAt };
  atomicJson(file, value);
  return { ...value, record: file, packageDir, idempotent: false };
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
  const allowed = /^(?:OWNER\.md|PACKAGE\.md|GATES\.md|gates\/[A-Za-z0-9][A-Za-z0-9._-]*\.md)$/u.test(relative);
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

module.exports = { authorizeWrite, begin, find, finish, recordPath };
