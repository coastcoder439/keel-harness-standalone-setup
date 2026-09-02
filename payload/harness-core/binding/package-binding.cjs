"use strict";

// Exact session binding: one Git worktree, one package, one active scope and
// one Unlazy leaf. Hooks consume this file; they never guess from prompt words.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const repository = require("./repository.cjs");
const ownerContracts = require("./owner-contract.cjs");

const IDENTIFIER_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const BINDING_DIRECTORY = "bindings";
const SESSION_INDEX_DIRECTORY = ".session-index";

function bindingError(message) {
  const error = new Error(message);
  error.code = "HARNESS_BINDING";
  throw error;
}

function validateIdentifier(value, label) {
  if (typeof value !== "string" || !IDENTIFIER_RE.test(value)) {
    bindingError(label + " must match " + IDENTIFIER_RE + ", got " + JSON.stringify(value));
  }
  return value;
}

function sha256(value) {
  return "sha256:" + crypto.createHash("sha256").update(value).digest("hex");
}

function readRegular(file, label) {
  if (!fs.existsSync(file)) bindingError(label + " does not exist: " + file);
  const info = fs.lstatSync(file);
  if (info.isSymbolicLink() || !info.isFile() || (typeof info.nlink === "number" && info.nlink !== 1)) {
    bindingError(label + " must be a single-link regular file: " + file);
  }
  return fs.readFileSync(file, "utf8");
}

function bundle(repoRoot, packageId) {
  validateIdentifier(packageId, "packageId");
  const packageDir = path.join(repoRoot, "docs", "packages", packageId);
  const packageFile = path.join(packageDir, "PACKAGE.md");
  const gatesFile = path.join(packageDir, "GATES.md");
  const packageText = readRegular(packageFile, "PACKAGE.md");
  readRegular(gatesFile, "GATES.md");
  if (!repository.isPathInside(repoRoot, packageDir)) bindingError("package escapes repository");
  const contractIds = [...packageText.matchAll(/^- (C\d+) -> /gmu)].map((match) => match[1]);
  const owner = ownerContracts.inspectOwnerContract(repoRoot, packageDir, packageId, contractIds);
  if (!owner.complete) {
    bindingError("Owner contract is incomplete: " + owner.diagnostics.map((item) => item.code + " " + item.message).join("; "));
  }
  return { packageDir, packageFile, packageText, gatesFile, owner };
}

function leafLedger(packageDir, leaf) {
  const name = String(leaf || "").replace(/^gates\//u, "").replace(/\.md$/u, "");
  if (!/^leaf-[A-Za-z0-9][A-Za-z0-9._-]{0,58}$/u.test(name)) {
    bindingError("leaf must name one gates/leaf-*.md ledger");
  }
  const ledger = path.join(packageDir, "gates", name + ".md");
  const text = readRegular(ledger, "leaf ledger");
  const ownsLines = [...text.matchAll(/^OWNS:\s*(.+)$/gmu)].map((match) => match[1].trim());
  if (ownsLines.length !== 1) bindingError("leaf ledger must declare exactly one OWNS line");
  const owns = ownsLines[0].split(",").map((item) => item.trim()).filter(Boolean);
  if (!owns.length) bindingError("leaf OWNS declaration is empty");
  for (const pattern of owns) {
    if (pattern.includes("\\") || pattern.startsWith("/") || /^[A-Za-z]:/u.test(pattern) ||
        pattern.split("/").some((part) => part === ".." || part === "." || part === "")) {
      bindingError("unsafe OWNS pattern: " + pattern);
    }
  }
  return { leaf: name, ledger, text, owns };
}

function activePackage(repoRoot, scope) {
  validateIdentifier(scope, "scope");
  const ref = path.join(repoRoot, ".unlazy", scope, "package.ref");
  const text = readRegular(ref, "package.ref");
  const match = text.match(/^docs\/packages\/([A-Za-z0-9][A-Za-z0-9._-]{0,63})\r?\n$/u);
  if (!match) bindingError("package.ref is invalid");
  return match[1];
}

function bindingPath(repoRoot, scope, sessionId) {
  validateIdentifier(scope, "scope");
  const session = String(sessionId || "").trim();
  if (!session || session.length > 256 || /[\0\r\n]/u.test(session)) bindingError("sessionId is invalid");
  const name = crypto.createHash("sha256").update(session).digest("hex") + ".json";
  return path.join(repoRoot, ".unlazy", scope, BINDING_DIRECTORY, name);
}

function sessionKey(sessionId) {
  const session = String(sessionId || "").trim();
  if (!session || session.length > 256 || /[\0\r\n]/u.test(session)) bindingError("sessionId is invalid");
  return crypto.createHash("sha256").update(session).digest("hex") + ".json";
}

function controlRoot(repoRoot, requested) {
  const root = requested ? path.resolve(requested) : repoRoot;
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) bindingError("Harness control root does not exist: " + root);
  const canonical = (fs.realpathSync.native || fs.realpathSync)(root);
  const config = path.join(canonical, ".keel-harness.json");
  if (!fs.existsSync(config)) {
    if (requested) bindingError("Harness control root lacks .keel-harness.json: " + canonical);
    return null;
  }
  readRegular(config, ".keel-harness.json");
  if (!repository.samePath(canonical, repoRoot) && !repository.isPathInside(canonical, repoRoot)) {
    bindingError("bound repository must be inside the Harness control root: " + repoRoot + " not under " + canonical);
  }
  return canonical;
}

function sessionIndexPath(root, sessionId) {
  return path.join(root, ".unlazy", SESSION_INDEX_DIRECTORY, sessionKey(sessionId));
}

function sessionIndexRecord(root, sessionId) {
  const file = sessionIndexPath(root, sessionId);
  if (!fs.existsSync(file)) return null;
  let value;
  try { value = JSON.parse(readRegular(file, "Harness session index")); }
  catch (error) { if (error.code === "HARNESS_BINDING") throw error; bindingError("Harness session index is not valid JSON"); }
  if (!value || value.schemaVersion !== 1 || value.sessionId !== sessionId ||
      typeof value.repoRelative !== "string" || typeof value.bindingRelative !== "string") {
    bindingError("Harness session index identity is invalid");
  }
  const repoRoot = path.resolve(root, value.repoRelative);
  if (!repository.samePath(root, repoRoot) && !repository.isPathInside(root, repoRoot)) {
    bindingError("Harness session index repository escapes the control root");
  }
  const bindingFile = path.resolve(repoRoot, value.bindingRelative);
  const runtime = path.join(repoRoot, ".unlazy");
  if (!repository.isPathInside(runtime, bindingFile)) bindingError("Harness session index binding escapes repository runtime");
  return { file, value, repoRoot, bindingFile };
}

function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = file + "." + process.pid + "." + crypto.randomBytes(8).toString("hex") + ".tmp";
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
  try { fs.renameSync(temporary, file); }
  finally { try { fs.unlinkSync(temporary); } catch { /* renamed or absent */ } }
}

function createBinding(options) {
  const snapshot = repository.repositorySnapshot(options.startPath || options.root || process.cwd(), options);
  const packageId = validateIdentifier(options.packageId, "packageId");
  const scope = validateIdentifier(options.scope, "scope");
  const sessionId = String(options.sessionId || "").trim();
  if (!sessionId || sessionId.length > 256 || /[\0\r\n]/u.test(sessionId)) bindingError("sessionId is invalid");
  const active = activePackage(snapshot.repoRoot, scope);
  if (active.toLowerCase() !== packageId.toLowerCase()) {
    bindingError("scope " + scope + " is active for " + active + ", not " + packageId);
  }
  const packageRecord = bundle(snapshot.repoRoot, packageId);
  const leafRecord = leafLedger(packageRecord.packageDir, options.leaf);
  const relativeLedger = path.relative(snapshot.repoRoot, leafRecord.ledger).replaceAll("\\", "/");
  const harnessRoot = controlRoot(snapshot.repoRoot, options.controlRoot);
  const value = {
    schemaVersion: 1,
    repoRoot: snapshot.repoRoot,
    gitDir: snapshot.gitDir,
    headOid: snapshot.headOid,
    packageId,
    packagePath: "docs/packages/" + packageId,
    packageDigest: sha256(packageRecord.packageText),
    ownerDigest: packageRecord.owner.digest,
    ownerRequestDigest: packageRecord.owner.requestDigest,
    scope,
    sessionId,
    leaf: leafRecord.leaf,
    leafLedger: relativeLedger,
    leafDigest: sha256(leafRecord.text),
    owns: leafRecord.owns,
    controlRoot: harnessRoot,
  };
  const localBinding = bindingPath(snapshot.repoRoot, scope, sessionId);
  if (harnessRoot) {
    const existing = sessionIndexRecord(harnessRoot, sessionId);
    if (existing && (!repository.samePath(existing.repoRoot, snapshot.repoRoot) ||
        existing.value.scope !== scope || existing.value.leaf !== leafRecord.leaf)) {
      bindingError("session is already indexed to another repository, scope, or leaf");
    }
  }
  atomicWrite(localBinding, value);
  if (harnessRoot) {
    atomicWrite(sessionIndexPath(harnessRoot, sessionId), {
      schemaVersion: 1,
      sessionId,
      repoRelative: path.relative(harnessRoot, snapshot.repoRoot).replaceAll("\\", "/") || ".",
      bindingRelative: path.relative(snapshot.repoRoot, localBinding).replaceAll("\\", "/"),
      packageId,
      scope,
      leaf: leafRecord.leaf,
    });
  }
  return value;
}

function parseBinding(file) {
  let value;
  try { value = JSON.parse(readRegular(file, "harness binding")); }
  catch (error) { if (error.code === "HARNESS_BINDING") throw error; bindingError("harness binding is not valid JSON"); }
  if (!value || value.schemaVersion !== 1 || !Array.isArray(value.owns)) bindingError("unsupported harness binding schema");
  validateIdentifier(value.packageId, "binding packageId");
  validateIdentifier(value.scope, "binding scope");
  return value;
}

function validateBinding(value, options = {}) {
  const snapshot = repository.repositorySnapshot(value.repoRoot, options);
  if (!repository.samePath(snapshot.repoRoot, value.repoRoot)) bindingError("binding repository changed");
  if (!repository.samePath(snapshot.gitDir, value.gitDir)) bindingError("binding Git directory changed");
  if (snapshot.headOid !== value.headOid) bindingError("binding is stale because HEAD changed");
  if (activePackage(snapshot.repoRoot, value.scope).toLowerCase() !== value.packageId.toLowerCase()) {
    bindingError("binding package.ref changed");
  }
  const packageRecord = bundle(snapshot.repoRoot, value.packageId);
  if (sha256(packageRecord.packageText) !== value.packageDigest) bindingError("binding is stale because PACKAGE.md changed");
  if (packageRecord.owner.digest !== (value.ownerDigest || null) ||
      packageRecord.owner.requestDigest !== (value.ownerRequestDigest || null)) {
    bindingError("binding is stale because OWNER.md changed");
  }
  const leafRecord = leafLedger(packageRecord.packageDir, value.leaf);
  if (sha256(leafRecord.text) !== value.leafDigest) bindingError("binding is stale because the leaf contract changed");
  if (JSON.stringify(leafRecord.owns) !== JSON.stringify(value.owns)) bindingError("binding OWNS changed");
  return { ...value, repoRoot: snapshot.repoRoot };
}

function findSessionBinding(startPath, sessionId, options = {}) {
  const repoRoot = repository.resolveRepositoryRoot(startPath, options);
  const runtime = path.join(repoRoot, ".unlazy");
  if (!fs.existsSync(runtime)) bindingError("no active Harness runtime in repository");
  const matches = [];
  for (const entry of fs.readdirSync(runtime, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === "locks" || entry.name.startsWith(".")) continue;
    const directory = path.join(repoRoot, ".unlazy", entry.name, BINDING_DIRECTORY);
    if (!fs.existsSync(directory)) continue;
    for (const bindingEntry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!bindingEntry.isFile() || !/^[a-f0-9]{64}\.json$/u.test(bindingEntry.name)) continue;
      const file = path.join(directory, bindingEntry.name);
      const value = parseBinding(file);
      if (value.sessionId === sessionId) matches.push(value);
    }
  }
  if (matches.length > 1) bindingError("session must have exactly one Harness binding; found " + matches.length);
  if (matches.length === 1) return validateBinding(matches[0], options);

  const requestedControl = options.controlRoot || (fs.existsSync(path.join(repoRoot, ".keel-harness.json")) ? repoRoot : null);
  if (requestedControl) {
    const harnessRoot = controlRoot(repoRoot, requestedControl);
    const indexed = sessionIndexRecord(harnessRoot, sessionId);
    if (indexed) {
      const value = parseBinding(indexed.bindingFile);
      if (value.sessionId !== sessionId || value.scope !== indexed.value.scope || value.leaf !== indexed.value.leaf ||
          value.packageId !== indexed.value.packageId || !repository.samePath(value.repoRoot, indexed.repoRoot)) {
        bindingError("Harness session index does not match its binding");
      }
      return validateBinding(value, options);
    }
  }
  bindingError("session must have exactly one Harness binding; found 0");
}

function globRegex(pattern, platform = process.platform) {
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "*" && pattern[index + 1] === "*") { source += ".*"; index += 1; }
    else if (char === "*") source += "[^/]*";
    else if (char === "?") source += "[^/]";
    else source += char.replace(/[|\\{}()[\]^$+?.]/gu, "\\$&");
  }
  return new RegExp("^" + source + "$", platform === "win32" ? "iu" : "u");
}

function authorizeWrite(binding, targetPath, options = {}) {
  const current = validateBinding(binding, options);
  let relative;
  try {
    relative = repository.repositoryRelativePath(current.repoRoot, targetPath, options);
  } catch {
    return { allowed: false, code: "OUTSIDE_REPOSITORY", next: "write only inside the bound repository" };
  }
  const pattern = current.owns.find((item) => globRegex(item).test(relative));
  if (!pattern) {
    return {
      allowed: false,
      code: "OUTSIDE_LEAF_OWNS",
      next: "use the bound leaf OWNS paths or start the owning leaf",
      relative,
    };
  }
  return { allowed: true, code: "BOUND_WRITE", relative, pattern };
}

module.exports = {
  authorizeWrite,
  bindingPath,
  createBinding,
  findSessionBinding,
  globRegex,
  sessionIndexPath,
  validateBinding,
};
