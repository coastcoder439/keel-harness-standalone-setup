"use strict";

// Narrow post-activation state, the twin of package-bootstrap.cjs. An activated
// package is updated (status, plan, leaves) only through one session record:
// begin takes a recovery snapshot of the bundle, the session then writes
// PACKAGE.md, GATES.md and gates/*.md -- never OWNER.md -- and finish proves that
// the original request, the Goal, the contract set, every existing checkbox and
// every EVIDENCE line are unchanged before the package doctor runs. undo restores
// the exact bytes of the snapshot or of a finished receipt.
// Owner: "Ein aktiviertes Paket laesst sich auf einem erlaubten Weg aktualisieren
// (Status, Plan, Leaves), ohne den Originalauftrag zu aendern".
// Paths are compared only through repository.cjs, bundle files only through
// bundle-files.cjs, active scopes only through package-ownership.cjs and busy
// scopes only through runtime-scopes.cjs.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const repository = require("./repository.cjs");
const bundleFiles = require("./bundle-files.cjs");
const packageOwnership = require("./package-ownership.cjs");
const runtimeScopes = require("./runtime-scopes.cjs");
const unlazyRuntime = require("./unlazy-runtime.cjs");
const { hungMessage, runWatchedChild } = require("./watched-child.cjs");

// The only codes this module returns as a write denial; every other refusal is a
// thrown command error with error.code.
const GUARD_CODES = Object.freeze(["AMEND_OWNER_IMMUTABLE", "OUTSIDE_AMEND_PACKAGE", "AMEND_LINK", "AMEND_STALE"]);

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const realpath = fs.realpathSync.native || fs.realpathSync;

function fail(code, message, extra = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, extra);
  throw error;
}

function id(value, label) {
  const text = String(value || "");
  if (!IDENTIFIER.test(text)) fail("HARNESS_AMEND", label + " must match " + IDENTIFIER);
  return text;
}

function validSession(value) {
  const text = String(value || "").trim();
  if (!text || text.length > 256 || /[\0\r\n]/u.test(text)) fail("HARNESS_AMEND", "sessionId is invalid");
  return text;
}

function harnessControlRoot(value) {
  const root = realpath(path.resolve(String(value || "")));
  const config = path.join(root, ".keel-harness.json");
  if (!fs.existsSync(config) || !fs.lstatSync(config).isFile() || fs.lstatSync(config).isSymbolicLink()) {
    fail("HARNESS_AMEND", "Harness root must contain a regular .keel-harness.json");
  }
  return root;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sessionHash(sessionId) {
  return sha256(validSession(sessionId));
}

function recordPath(harnessRoot, sessionId) {
  return path.join(harnessRoot, ".unlazy", ".amend", sessionHash(sessionId) + ".json");
}

function atomicWrite(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = file + "." + process.pid + "." + crypto.randomBytes(8).toString("hex") + ".tmp";
  fs.writeFileSync(temporary, content, { flag: "wx" });
  try { fs.renameSync(temporary, file); }
  finally { try { fs.unlinkSync(temporary); } catch { /* renamed or absent */ } }
}

function atomicJson(file, value) {
  atomicWrite(file, Buffer.from(JSON.stringify(value, null, 2) + "\n", "utf8"));
}

function regularJson(file, label) {
  if (!fs.existsSync(file)) return null;
  const info = fs.lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink() || (typeof info.nlink === "number" && info.nlink !== 1)) {
    fail("HARNESS_AMEND", label + " must be a single-link regular file");
  }
  let value;
  try { value = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { fail("HARNESS_AMEND", label + " is not valid JSON"); }
  return value;
}

function slash(value) {
  return String(value).replaceAll("\\", "/");
}

function argument(value) {
  return /^[A-Za-z0-9._:@+=-]+$/u.test(String(value)) ? String(value) : JSON.stringify(String(value));
}

function command(harnessRoot, verb, parts) {
  return "node \"" + path.join(harnessRoot, "harness-core", "execution", "package-amend.mjs") + "\" " + verb +
    " --harness-root \"" + harnessRoot + "\" " + parts.join(" ") + " --json";
}

function beginCommand(harnessRoot, repoRoot, packageId, scope, sessionId) {
  return command(harnessRoot, "begin", ["--root \"" + repoRoot + "\"", "--package " + packageId,
    "--scope " + scope, "--session " + argument(sessionId)]);
}

function finishCommand(harnessRoot, sessionId) {
  return command(harnessRoot, "finish", ["--session " + argument(sessionId)]);
}

function undoCommand(harnessRoot, repoRoot, receipt) {
  return command(harnessRoot, "undo", ["--root \"" + repoRoot + "\"", "--receipt \"" + receipt + "\""]);
}

function createCommand(harnessRoot) {
  return "node \"" + path.join(harnessRoot, ".claude", "skills", "package-standard", "package-standard.mjs") + "\" create";
}

// The active scope of a package: a package.ref that names docs/packages/<id>,
// the package id compared without case.
function activeScope(repoRoot, packageId) {
  const wanted = String(packageId).toLowerCase();
  return packageOwnership.activeScopes(repoRoot).scopes.find((entry) => entry.packageId.toLowerCase() === wanted) || null;
}

function packageDirectory(repoRoot, packageId) {
  return path.join(repoRoot, "docs", "packages", packageId);
}

// Repo-relative paths of every bundle file (OWNER.md included) that exists now.
function bundleList(repoRoot, packageId) {
  const directory = packageDirectory(repoRoot, packageId);
  const found = [];
  const collect = (folder) => {
    let entries;
    try { entries = fs.readdirSync(folder, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const relative = slash(path.relative(repoRoot, path.join(folder, entry.name)));
      if (bundleFiles.isBundleFile(relative, packageId)) found.push(relative);
    }
  };
  collect(directory);
  collect(path.join(directory, "gates"));
  return found.sort();
}

function readBytes(repoRoot, relative) {
  const file = path.join(repoRoot, ...relative.split("/"));
  if (!fs.existsSync(file)) return null;
  const info = fs.lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink()) fail("HARNESS_AMEND", "bundle file is not a regular file: " + relative);
  return fs.readFileSync(file);
}

function digestOf(bytes) {
  return bytes === null ? null : sha256(bytes);
}

// The one **Goal:** line, read like packageRecord in package-executor.mjs.
function goalLine(text) {
  const matches = [...String(text).matchAll(/^\*\*Goal:\*\*\s*(\S.*)$/gmu)];
  return matches.length === 1 ? matches[0][1] : null;
}

function contractIds(text) {
  return [...new Set([...String(text).matchAll(/^- (C\d+) -> /gmu)].map((match) => match[1]))].sort();
}

function depthLeaves(text) {
  return new Set([...String(text).matchAll(/^- LEAF gates\/(leaf-[A-Za-z0-9][A-Za-z0-9._-]{0,58})\.md <- [^:]+: \S.*$/gmu)]
    .map((match) => match[1]));
}

function planSteps(text) {
  const steps = [];
  let inPlan = false;
  for (const line of String(text).split(/\r?\n/u)) {
    if (/^## /u.test(line)) { inPlan = /^## Plan\s*$/u.test(line); continue; }
    if (!inPlan) continue;
    const match = line.match(/^\d+\.\s+\[( |x|X)\]\s+(.*)$/u);
    if (match) steps.push({ mark: match[1], text: match[2].trim() });
  }
  return steps;
}

function packagePathOf(packageId) {
  return "docs/packages/" + packageId;
}

function snapshotDirectory(repoRoot, scope) {
  return path.join(repoRoot, ".unlazy", scope, "amend");
}

function begin(options) {
  const harnessRoot = harnessControlRoot(options.harnessRoot);
  const snapshot = repository.repositorySnapshot(options.root);
  if (!repository.samePath(harnessRoot, snapshot.repoRoot) && !repository.isPathInside(harnessRoot, snapshot.repoRoot)) {
    fail("HARNESS_AMEND", "repository is outside the Harness root");
  }
  const requested = id(options.packageId, "packageId");
  const scope = id(options.scope || requested, "scope");
  const sessionId = validSession(options.sessionId);
  const active = activeScope(snapshot.repoRoot, requested);
  if (!active || active.scope !== scope) {
    fail("AMEND_NOT_ACTIVE", "package " + requested + " is not active in scope " + scope +
      (active ? " (its active scope is " + active.scope + ")" : "") +
      "; a package that is not yet active is written through the planning binding (package-standard.mjs create)",
    { next: active ? beginCommand(harnessRoot, snapshot.repoRoot, active.packageId, active.scope, sessionId) :
      createCommand(harnessRoot) + " --harness-root \"" + harnessRoot + "\" --root \"" + snapshot.repoRoot +
        "\" --package " + requested + " --session " + argument(sessionId) });
  }
  const packageId = active.packageId;
  const busy = runtimeScopes.busyReason(snapshot.repoRoot, scope);
  if (busy) {
    fail("AMEND_BUSY", busy + "; every change to PACKAGE.md invalidates the leaf bindings of running sessions");
  }
  const file = recordPath(harnessRoot, sessionId);
  const existing = regularJson(file, "amend record");
  if (existing) {
    if (existing.schemaVersion !== 1 || existing.sessionId !== sessionId ||
        String(existing.packageId).toLowerCase() !== packageId.toLowerCase() || existing.scope !== scope ||
        !repository.samePath(existing.repoRoot, snapshot.repoRoot)) {
      fail("AMEND_EXISTS", "session already amends package " + existing.packageId + " in scope " + existing.scope,
        { next: finishCommand(harnessRoot, sessionId) });
    }
    return { ...existing, record: file, idempotent: true, next: finishCommand(harnessRoot, sessionId) };
  }
  const packageDir = packageDirectory(snapshot.repoRoot, packageId);
  if (!fs.existsSync(packageDir) || !fs.lstatSync(packageDir).isDirectory() || fs.lstatSync(packageDir).isSymbolicLink()) {
    fail("HARNESS_AMEND", "package directory is missing or linked: " + packagePathOf(packageId));
  }
  const createdAt = new Date().toISOString();
  const files = bundleList(snapshot.repoRoot, packageId).map((relative) => {
    const bytes = readBytes(snapshot.repoRoot, relative);
    return { path: relative, base64: bytes.toString("base64"), sha256: sha256(bytes) };
  });
  const packageText = (readBytes(snapshot.repoRoot, packagePathOf(packageId) + "/PACKAGE.md") || Buffer.alloc(0)).toString("utf8");
  const snapshotFile = path.join(snapshotDirectory(snapshot.repoRoot, scope),
    createdAt.replace(/[:.]/gu, "-") + "-" + sessionHash(sessionId).slice(0, 16) + ".json");
  atomicJson(snapshotFile, { schemaVersion: 1, kind: "package-amend", state: "open", harnessRoot,
    repoRoot: snapshot.repoRoot, packageId, scope, sessionId, createdAt,
    goal: goalLine(packageText), contractIds: contractIds(packageText), files });
  const value = { schemaVersion: 1, harnessRoot, repoRoot: snapshot.repoRoot, gitDir: snapshot.gitDir,
    packageId, scope, sessionId, packagePath: packagePathOf(packageId), snapshot: snapshotFile, createdAt };
  atomicJson(file, value);
  return { ...value, record: file, idempotent: false, next: finishCommand(harnessRoot, sessionId) };
}

function find(options) {
  const harnessRoot = harnessControlRoot(options.harnessRoot);
  const sessionId = validSession(options.sessionId);
  const file = recordPath(harnessRoot, sessionId);
  const value = regularJson(file, "amend record");
  if (!value) fail("HARNESS_AMEND", "no package amendment for this session");
  if (value.schemaVersion !== 1 || value.sessionId !== sessionId || !IDENTIFIER.test(value.packageId) ||
      !IDENTIFIER.test(value.scope) || !repository.samePath(value.harnessRoot, harnessRoot) ||
      value.packagePath !== packagePathOf(value.packageId) || typeof value.snapshot !== "string") {
    fail("HARNESS_AMEND", "package amendment identity is invalid");
  }
  const snapshot = repository.repositorySnapshot(value.repoRoot);
  if (!repository.samePath(snapshot.gitDir, value.gitDir)) fail("HARNESS_AMEND", "package amendment repository changed");
  const active = activeScope(snapshot.repoRoot, value.packageId);
  if (!active || active.scope !== value.scope) {
    fail("AMEND_STALE", "package " + value.packageId + " is no longer active in scope " + value.scope,
      { repoRoot: snapshot.repoRoot, snapshot: value.snapshot, next: undoCommand(harnessRoot, snapshot.repoRoot, value.snapshot) });
  }
  return { ...value, repoRoot: snapshot.repoRoot, packageDir: packageDirectory(snapshot.repoRoot, value.packageId), record: file };
}

function allowedFilesText(record) {
  return "only " + record.packagePath + "/PACKAGE.md, GATES.md and gates/<name>.md are writable; then " +
    finishCommand(record.harnessRoot, record.sessionId);
}

function authorizeWrite(record, targetPath) {
  const target = path.resolve(targetPath);
  if (repository.samePath(target, path.join(record.packageDir, "OWNER.md"))) {
    return { allowed: false, code: "AMEND_OWNER_IMMUTABLE",
      detail: "OWNER.md holds the original Owner request and stays unchanged during an amendment",
      next: allowedFilesText(record) };
  }
  const relative = repository.isPathInside(record.repoRoot, target) ? slash(path.relative(record.repoRoot, target)) : null;
  if (!relative || !bundleFiles.bundleFilePattern(record.packageId, { owner: false }).test(relative)) {
    return { allowed: false, code: "OUTSIDE_AMEND_PACKAGE",
      detail: "an amendment writes only the contract bundle of package " + record.packageId,
      next: allowedFilesText(record) };
  }
  let current = target;
  while (repository.isPathInside(record.packageDir, current) || repository.samePath(current, record.packageDir)) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) {
      return { allowed: false, code: "AMEND_LINK", detail: "linked package component: " + current,
        next: "replace linked package components with real files and directories; " + allowedFilesText(record) };
    }
    if (repository.samePath(current, record.packageDir)) break;
    current = path.dirname(current);
  }
  return { allowed: true, code: "BOUND_AMEND_WRITE", relative, packageId: record.packageId, scope: record.scope };
}

function readExecutor(repoRoot, scope) {
  const file = path.join(repoRoot, ".unlazy", scope, "executor.json");
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return {}; }
}

function readSnapshot(file, label) {
  const value = regularJson(file, label);
  if (!value || value.schemaVersion !== 1 || value.kind !== "package-amend" || !Array.isArray(value.files) ||
      !IDENTIFIER.test(value.packageId) || !IDENTIFIER.test(value.scope)) {
    fail("HARNESS_AMEND", label + " is missing or invalid: " + file);
  }
  return value;
}

// Gates of one ledger text through the vendored Unlazy gate parser (no second parser).
function ledgerGates(parseGates, text) {
  if (text === null) return new Map();
  const parsed = parseGates(text);
  const gates = new Map();
  for (const gate of parsed.gates) {
    gates.set(gate.id, { mark: parsed.lines[gate.line].match(/^- \[( |x|X)\]/u)?.[1] || "",
      checked: gate.checked, evidence: gate.evidence,
      evidenceLine: gate.evidenceLine >= 0 ? parsed.lines[gate.evidenceLine] : null });
  }
  return gates;
}

function evidenceChanges(parseGates, record, before, after) {
  const changes = [];
  const ledgers = new Set([...before.keys(), ...after.keys()].filter((relative) =>
    relative.endsWith("/GATES.md") || relative.includes("/gates/")));
  for (const relative of [...ledgers].sort()) {
    const old = ledgerGates(parseGates, before.has(relative) ? before.get(relative).toString("utf8") : null);
    const now = ledgerGates(parseGates, after.has(relative) ? after.get(relative).toString("utf8") : null);
    for (const [gateId, gate] of old) {
      const current = now.get(gateId);
      if (current) {
        if (current.mark !== gate.mark || current.evidenceLine !== gate.evidenceLine) {
          changes.push(relative + ":" + gateId + " changed its checkbox or EVIDENCE line");
        }
      } else if (gate.checked || (gate.evidence !== null && gate.evidence.trim() !== "pending")) {
        changes.push(relative + ":" + gateId + " was ticked or carries evidence and disappeared");
      }
    }
    for (const [gateId, gate] of now) {
      if (old.has(gateId)) continue;
      if (gate.mark !== " " || gate.evidence === null || gate.evidence.trim() !== "pending") {
        changes.push(relative + ":" + gateId + " is new and must be \"[ ]\" with \"EVIDENCE: pending\"");
      }
    }
  }
  const packageFile = record.packagePath + "/PACKAGE.md";
  const oldSteps = planSteps(before.has(packageFile) ? before.get(packageFile).toString("utf8") : "");
  const newSteps = planSteps(after.has(packageFile) ? after.get(packageFile).toString("utf8") : "");
  for (const step of oldSteps) {
    const current = newSteps.find((item) => item.text === step.text);
    if (current && current.mark !== step.mark) changes.push("plan step \"" + step.text + "\" changed its checkbox");
    if (!current && step.mark !== " ") changes.push("ticked plan step \"" + step.text + "\" disappeared");
  }
  for (const step of newSteps) {
    if (!oldSteps.some((item) => item.text === step.text) && step.mark !== " ") {
      changes.push("new plan step \"" + step.text + "\" must start as \"[ ]\"");
    }
  }
  return changes;
}

function leavesInUse(record, snapshotValue, packageText, state) {
  if (!state || typeof state !== "object") return [];
  const tree = depthLeaves(packageText);
  const used = new Set();
  for (const group of [state.sessions, state.history?.sessions]) {
    if (!group || typeof group !== "object") continue;
    for (const entry of Object.values(group)) if (entry && typeof entry.leaf === "string") used.add(entry.leaf);
  }
  const missing = [];
  for (const item of snapshotValue.files) {
    const match = item.path.match(/\/gates\/(leaf-[A-Za-z0-9][A-Za-z0-9._-]*)\.md$/u);
    if (!match) continue;
    const gone = !fs.existsSync(path.join(record.repoRoot, ...item.path.split("/"))) || !tree.has(match[1]);
    if (gone && used.has(match[1])) missing.push(match[1]);
  }
  return missing;
}

// doctor has no time limit of its own (P15, C13): it runs through the silence watcher and counts as hung only when
// it is silent and its process tree does no work, so a slow doctor no longer refuses a correct amendment.
async function runDoctor(record, unlazyRoot) {
  const cli = path.join(unlazyRoot, "scripts", "package-cli.mjs");
  const result = await runWatchedChild(process.execPath, [cli, "doctor", "--root", record.repoRoot, "--package", record.packageId, "--json"],
    { cwd: record.repoRoot, unlazyRoot });
  if (result.hung) return hungMessage("package-cli doctor", result);
  if (result.status === 0) return null;
  let findings = [];
  try {
    const parsed = JSON.parse(result.stdout);
    findings = (parsed.packages || []).flatMap((item) => (item.diagnostics || []).map((d) => d.code + ": " + d.message));
  } catch { /* fall back to the raw output */ }
  return findings.length ? findings.join("; ") :
    String(result.stderr || result.stdout || (result.error && result.error.message) || "doctor exited " + result.status).trim();
}

async function finish(options) {
  const record = find(options);
  const undo = undoCommand(record.harnessRoot, record.repoRoot, record.snapshot);
  const snapshotValue = readSnapshot(record.snapshot, "amend snapshot");
  if (snapshotValue.state !== "open" || snapshotValue.sessionId !== record.sessionId) {
    fail("HARNESS_AMEND", "amend snapshot does not belong to this open amendment");
  }
  const before = new Map(snapshotValue.files.map((item) => [item.path, Buffer.from(item.base64, "base64")]));
  const after = new Map();
  for (const relative of bundleList(record.repoRoot, record.packageId)) after.set(relative, readBytes(record.repoRoot, relative));
  const ownerPath = record.packagePath + "/OWNER.md";
  const ownerBefore = snapshotValue.files.find((item) => item.path === ownerPath)?.sha256 || null;
  const ownerAfter = digestOf(after.get(ownerPath) || null);
  if (ownerBefore !== ownerAfter) {
    fail("AMEND_OWNER_CHANGED", "OWNER.md changed during the amendment (sha256 " + ownerBefore + " -> " + ownerAfter + ")",
      { next: undo });
  }
  const packageText = (after.get(record.packagePath + "/PACKAGE.md") || Buffer.alloc(0)).toString("utf8");
  const state = readExecutor(record.repoRoot, record.scope);
  const expectedGoal = state && typeof state.originalGoal === "string" ? state.originalGoal : snapshotValue.goal;
  const goal = goalLine(packageText);
  if (goal !== expectedGoal) {
    fail("AMEND_GOAL_CHANGED", "PACKAGE.md must keep exactly the one Goal line: " + JSON.stringify(expectedGoal),
      { next: "restore the Goal line, then " + finishCommand(record.harnessRoot, record.sessionId) });
  }
  const contracts = contractIds(packageText);
  if (JSON.stringify(contracts) !== JSON.stringify(snapshotValue.contractIds)) {
    fail("AMEND_CONTRACT_CHANGED", "the contract set is frozen by OWNER.md: expected " +
      snapshotValue.contractIds.join(", ") + ", found " + contracts.join(", "),
    { next: "restore the contract lines, then " + finishCommand(record.harnessRoot, record.sessionId) });
  }
  let unlazyRoot;
  let parseGates;
  try {
    unlazyRoot = unlazyRuntime.locateUnlazy(record.repoRoot, options.unlazyRoot);
    parseGates = require(path.join(unlazyRoot, "scripts", "lib", "gates.mjs")).parseGates;
  } catch (error) {
    fail("AMEND_DOCTOR", "Unlazy runtime not found: " + error.message, { next: undo });
  }
  const changes = evidenceChanges(parseGates, record, before, after);
  if (changes.length) {
    fail("AMEND_EVIDENCE_CHANGED", changes.join("; "),
      { next: "restore these checkboxes and EVIDENCE lines, then " + finishCommand(record.harnessRoot, record.sessionId) });
  }
  const inUse = leavesInUse(record, snapshotValue, packageText, state);
  if (inUse.length) {
    fail("AMEND_LEAF_IN_USE", "the executor history names " + inUse.join(", ") + "; its ledger and Depth Tree line stay",
      { next: "restore " + inUse.join(", ") + ", then " + finishCommand(record.harnessRoot, record.sessionId) });
  }
  const doctor = await runDoctor(record, unlazyRoot);
  if (doctor) {
    fail("AMEND_DOCTOR", "package doctor refused the amended bundle: " + doctor,
      { next: "fix the findings, then " + finishCommand(record.harnessRoot, record.sessionId) });
  }
  const finishedAt = new Date().toISOString();
  const paths = [...new Set([...before.keys(), ...after.keys()])].sort();
  const files = paths.map((relative) => ({
    path: relative,
    before: before.has(relative) ? before.get(relative).toString("base64") : null,
    sha256Before: before.has(relative) ? sha256(before.get(relative)) : null,
    sha256After: after.has(relative) ? sha256(after.get(relative)) : null,
  }));
  atomicJson(record.snapshot, { ...snapshotValue, state: "finished", files,
    ownerSha256Before: ownerBefore, ownerSha256After: ownerAfter, finishedAt });
  fs.unlinkSync(record.record);
  return { packageId: record.packageId, scope: record.scope, sessionId: record.sessionId, finished: true,
    receipt: record.snapshot, ownerSha256Before: ownerBefore, ownerSha256After: ownerAfter,
    changed: files.filter((item) => item.sha256Before !== item.sha256After).map((item) => item.path), next: undo };
}

function receiptLocation(repoRoot, receipt) {
  const file = path.resolve(String(receipt || ""));
  const runtime = path.join(repoRoot, ".unlazy");
  const parts = repository.isPathInside(runtime, file) ? slash(path.relative(runtime, file)).split("/") : [];
  if (parts.length !== 3 || !IDENTIFIER.test(parts[0]) || parts[1] !== "amend" || !/^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/u.test(parts[2]) ||
      parts[2].endsWith(".undone.json")) {
    fail("HARNESS_AMEND", "--receipt must name a snapshot or receipt under .unlazy/<scope>/amend/ of the repository");
  }
  return { file: path.join(runtime, ...parts), scope: parts[0] };
}

function safeBundleTarget(repoRoot, packageId, relative) {
  if (!bundleFiles.isBundleFile(relative, packageId)) fail("HARNESS_AMEND", "receipt names a non-bundle file: " + relative);
  const packageDir = packageDirectory(repoRoot, packageId);
  const target = path.join(repoRoot, ...relative.split("/"));
  let current = path.dirname(target);
  while (repository.isPathInside(packageDir, current) || repository.samePath(current, packageDir)) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) fail("HARNESS_AMEND", "linked package component: " + current);
    if (repository.samePath(current, packageDir)) break;
    current = path.dirname(current);
  }
  return target;
}

function undo(options) {
  harnessControlRoot(options.harnessRoot);
  const repoRoot = repository.repositorySnapshot(options.root).repoRoot;
  const location = receiptLocation(repoRoot, options.receipt);
  const value = readSnapshot(location.file, "amend receipt");
  if (value.scope !== location.scope || !repository.samePath(value.repoRoot, repoRoot)) {
    fail("HARNESS_AMEND", "amend receipt belongs to another repository or scope");
  }
  const restore = [];
  const remove = [];
  if (value.state === "finished") {
    const known = new Set(value.files.map((item) => item.path));
    const drift = value.files.filter((item) => digestOf(readBytes(repoRoot, item.path)) !== item.sha256After).map((item) => item.path);
    drift.push(...bundleList(repoRoot, value.packageId).filter((relative) => !known.has(relative)));
    if (drift.length) {
      fail("AMEND_UNDO_CHANGED", "bundle changed after the amendment finished: " + drift.join(", ") + "; nothing was restored");
    }
    for (const item of value.files) {
      if (item.before === null) remove.push(item.path);
      else restore.push([item.path, Buffer.from(item.before, "base64")]);
    }
  } else if (value.state === "open") {
    const known = new Set(value.files.map((item) => item.path));
    for (const item of value.files) restore.push([item.path, Buffer.from(item.base64, "base64")]);
    remove.push(...bundleList(repoRoot, value.packageId).filter((relative) => !known.has(relative)));
  } else fail("HARNESS_AMEND", "amend receipt state is invalid: " + value.state);
  const targets = new Map([...restore.map(([relative]) => relative), ...remove]
    .map((relative) => [relative, safeBundleTarget(repoRoot, value.packageId, relative)]));
  for (const [relative, bytes] of restore) {
    const target = targets.get(relative);
    const current = readBytes(repoRoot, relative);
    if (current === null || !current.equals(bytes)) atomicWrite(target, bytes);
  }
  for (const relative of remove) {
    const target = targets.get(relative);
    if (fs.existsSync(target)) fs.unlinkSync(target);
  }
  let recordRemoved = false;
  if (value.state === "open") {
    const file = recordPath(value.harnessRoot, value.sessionId);
    let record = null;
    try { record = regularJson(file, "amend record"); } catch { record = null; }
    if (record && typeof record.snapshot === "string" && repository.samePath(record.snapshot, location.file)) {
      fs.unlinkSync(file);
      recordRemoved = true;
    }
  }
  const undone = location.file.replace(/\.json$/u, ".undone.json");
  fs.renameSync(location.file, undone);
  return { packageId: value.packageId, scope: value.scope, undone: true, state: value.state, receipt: undone,
    restored: restore.map(([relative]) => relative), removed: remove, recordRemoved };
}

// The one answer, for the guard and the command alike, whether a write target is a
// bundle file of an active package that only the amendment route may change: OWNER.md
// is never one (owner:false). hints.repoRoot comes from a leaf or planning binding;
// otherwise the target's own repository decides.
function activeBundleTarget(target, hints = {}) {
  try {
    const resolved = path.resolve(String(target));
    const repoRoot = hints.repoRoot ? path.resolve(hints.repoRoot) : repository.resolveRepositoryRoot(resolved);
    if (!repository.isPathInside(repoRoot, resolved)) return null;
    const relative = slash(path.relative(repoRoot, resolved));
    const packageId = relative.match(/^docs\/packages\/([A-Za-z0-9][A-Za-z0-9._-]{0,63})\//u)?.[1];
    if (!packageId || !bundleFiles.bundleFilePattern(packageId, { owner: false }).test(relative)) return null;
    const active = activeScope(repoRoot, packageId);
    if (!active) return null;
    return { repoRoot, packageId: active.packageId, scope: active.scope, relative };
  } catch {
    return null;
  }
}

module.exports = { GUARD_CODES, activeBundleTarget, authorizeWrite, begin, beginCommand, find, finish, recordPath, undo };
