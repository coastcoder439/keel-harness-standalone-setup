"use strict";

// Narrow pre-activation state. It permits one session to author only the
// versioned OWNER/PACKAGE/GATES bundle in one exact Git repository. Once the
// package is active this capability stops, even if its runtime record remains.
// plan files a written bundle as planned (bundle, no package.ref, no record)
// so one session can write several packages in a row; begin and plan report
// OWNS overlaps with active packages, prune orphaned records, and a planning
// binding moves to a new session id in exactly two ways (P4 D15): automatically,
// when the transcript of the new session proves it is the same conversation as
// the holder (adoptByTranscript: the first sessionId line of the transcript names
// the holder; the proof alone decides, never the time), or by
// hand through --takeover, which takes a holder only once it has been silent for
// silenceMs (an active package also needs --reason). A live foreign session keeps
// its binding either way.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const repository = require("./repository.cjs");
const unlazyRuntime = require("./unlazy-runtime.cjs");
const bundleFiles = require("./bundle-files.cjs");
const ownership = require("./package-ownership.cjs");
const hookActivity = require("./hook-activity.cjs");
const { renameWithRetry } = require("./rename-retry.cjs");
const { hungMessage, runWatchedChild } = require("./watched-child.cjs");

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

// The one rename-with-retry of the Harness tree lives in rename-retry.cjs (P15); it is re-exported below.

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

// The repository snapshots of ONE run (P15, B15): the same repository is asked once per run, however many
// records and steps of that run need it (each snapshot is three Git processes). The memory lives and dies with
// the run that made it: a later run asks Git again, so a repository that changed in between (new HEAD, other
// git dir, gone) is never answered from an old run. A failed probe is not remembered.
function runSnapshots() {
  const known = new Map();
  return (startPath) => {
    const key = repository.pathKey(startPath);
    if (!known.has(key)) known.set(key, repository.repositorySnapshot(startPath));
    return known.get(key);
  };
}

function orphanReason(value, snapshotOf = repository.repositorySnapshot) {
  let snapshot;
  try { snapshot = snapshotOf(value.repoRoot); }
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
    const state = orphanReason(record.value, options.snapshotOf);
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

function takeoverCommand(options, harnessRoot, repoRoot, packageId, scope, sessionId, reason) {
  const parts = ["node", quote(path.join(__dirname, "..", "execution", "package-bootstrap.mjs")), "begin",
    "--harness-root", quote(harnessRoot), "--root", quote(repoRoot), "--package", packageId,
    "--scope", scope, "--session", quote(sessionId)];
  if (options.unlazyRoot) parts.push("--unlazy-root", quote(options.unlazyRoot));
  for (const claim of ownsArgument(options.owns)) parts.push("--owns", quote(claim.pattern));
  parts.push("--takeover", "--reason", quote(reason || "<Grund>"));
  if (options.json) parts.push("--json");
  return parts.join(" ");
}

// The planning bindings other sessions hold for one package of one repository, newest first.
function holdersOf(harnessRoot, repoRoot, packageId, sessionId) {
  return readRecords(harnessRoot).records.filter((item) => item.value.sessionId !== sessionId &&
    sameId(item.value.packageId, packageId) && repository.samePath(item.value.repoRoot, repoRoot))
    .sort((left, right) => recordTime(right.value) - recordTime(left.value));
}

const REASON_LIMIT = 500;

function takeoverReason(value) {
  const text = String(value === undefined || value === null ? "" : value).trim();
  if (/[\0\r\n]/u.test(text)) fail("--reason must be one line of text", "TAKEOVER_REASON_INVALID");
  return text.slice(0, REASON_LIMIT);
}

// A planning binding may be taken over by hand only from holders that have been silent for silenceMs (P4 D15),
// whether the package is active or not; an active package also needs a reason. The one exception is the proof
// that it is the same conversation: options.transcriptPath (passed by a hook from its input, never read from the
// command line) names the holder in its sessionId field. Returns the holders to retire.
function checkedTakeover(options, harnessRoot, snapshot, packageId, scope, sessionId, reason, isActive) {
  const holders = holdersOf(harnessRoot, snapshot.repoRoot, packageId, sessionId);
  if (!holders.length) {
    if (isActive) fail("package " + packageId + " is active; a planning binding cannot be taken over", "PACKAGE_ACTIVE", { next: ACTIVE_NEXT });
    return holders;
  }
  if (isActive && !reason) {
    fail("package " + packageId + " is active; taking over its planning binding needs a reason: " +
      takeoverCommand(options, harnessRoot, snapshot.repoRoot, packageId, scope, sessionId), "TAKEOVER_REASON_REQUIRED");
  }
  const named = options.transcriptPath ? transcriptSessionIds(path.resolve(String(options.transcriptPath))) : new Set();
  named.delete(sessionId);
  const limit = options.silenceMs === undefined ? hookActivity.silenceLimitMs(options.env || process.env) : options.silenceMs;
  const now = options.now === undefined ? Date.now() : options.now;
  for (const holder of holders) {
    if (named.has(holder.value.sessionId)) continue;
    const silent = hookActivity.silentForMs(holder.file, now);
    if (silent < limit) {
      fail("package " + packageId + " is held by session " + holder.value.sessionId + ", which was active " + Math.round(silent / 1000) +
        " s ago; a planning binding can be taken over once its holder has been silent for " +
        Math.round(limit / 1000) + " s (no hook of that session ran; KEEL_SILENCE_MS changes the limit)", "PLANNER_ACTIVE",
      { holder: holder.value.sessionId, silentMs: Math.round(silent), limitMs: limit,
        next: "wait until the holder has been silent for " + Math.round(limit / 1000) + " s, then run: " +
          takeoverCommand(options, harnessRoot, snapshot.repoRoot, packageId, scope, sessionId, reason) });
    }
  }
  return holders;
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
  const reason = takeoverReason(options.reason);
  // Read before the pruning below: an active package's record counts as obsolete there and is removed.
  const checkedHolders = options.takeover
    ? checkedTakeover(options, harnessRoot, snapshot, packageId, scope, sessionId, reason, packageActive(snapshot.repoRoot, packageId)) : null;
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
  const holders = checkedHolders || holdersOf(harnessRoot, snapshot.repoRoot, packageId, sessionId);
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
    value.takenOverVia = "manual";
    if (reason) value.takenOverReason = reason;
  }
  atomicJson(file, value);
  for (const holder of holders) removeQuietly(holder.file);
  return report({ ...value, record: file, packageDir, idempotent: false });
}

function find(options, snapshotOf = repository.repositorySnapshot) {
  const harnessRoot = harnessControlRoot(options.harnessRoot);
  const sessionId = validSession(options.sessionId);
  const file = recordPath(harnessRoot, sessionId);
  const value = regularJson(file);
  if (!value) fail("no package bootstrap for this session");
  if (value.schemaVersion !== 1 || value.sessionId !== sessionId || !IDENTIFIER.test(value.packageId) ||
      !IDENTIFIER.test(value.scope) || !repository.samePath(value.harnessRoot, harnessRoot)) {
    fail("package bootstrap identity is invalid");
  }
  const snapshot = snapshotOf(value.repoRoot);
  if (!repository.samePath(snapshot.gitDir, value.gitDir)) fail("package bootstrap repository changed");
  const expected = path.join(snapshot.repoRoot, "docs", "packages", value.packageId);
  if (!fs.existsSync(expected) || !fs.lstatSync(expected).isDirectory() || fs.lstatSync(expected).isSymbolicLink()) {
    fail("package bootstrap directory is missing or unsafe");
  }
  return { ...value, repoRoot: snapshot.repoRoot, packageDir: expected, record: file };
}

// --- D15: the planning binding survives a resumed conversation -------------------------------------
// Claude Code gives a resumed conversation a new session id; the harness then treats its own session as a
// foreign one. The transcript file of the new session (transcript_path of the hook input) starts with the
// replayed history of the old one: its first lines carry the old id in their top-level sessionId field, the new
// id follows only later. Measured on real resumed files of this machine (7 of 949 files, line 1 each):
// docs/harness-rebuild/packages/P4-evidence-resume.md. A fresh conversation starts with its own id.
// The proof is therefore the FIRST complete line that carries a sessionId field: it names the conversation the
// transcript continues, and no line with another id stands before it. A line further down proves nothing, even
// with the right field: the transcript grows by appending, so whoever could append a line could forge one. The
// host writes the transcript; the agent cannot, because write-guard refuses the transcript store and the
// transcript_path of the session for Write/Edit, the shell and Codex patches (HOST_TRANSCRIPT_WRITE). Only that
// field counts, never the text of a message: a session id in a tool result or a chat line (an error message
// names the holder of a package) proves nothing. The proof alone decides; there is no time after which a
// binding moves by itself (a holder silent for silenceMs moves only by hand, --takeover).
const TRANSCRIPT_HEAD_BYTES = 256 * 1024;

// The session id the transcript continues: the sessionId field of the first complete line within the first
// TRANSCRIPT_HEAD_BYTES that has one. null when there is none, when that field is empty or no string, and for an
// unreadable file or a link. Never throws.
function transcriptOriginSessionId(file, limit = TRANSCRIPT_HEAD_BYTES) {
  let fd = null;
  try {
    const info = fs.lstatSync(file);
    if (!info.isFile() || info.isSymbolicLink()) return null;
    fd = fs.openSync(file, "r");
    const buffer = Buffer.alloc(Math.min(limit, info.size));
    let filled = 0;
    while (filled < buffer.length) {
      const read = fs.readSync(fd, buffer, filled, buffer.length - filled, filled);
      if (read === 0) break;
      filled += read;
    }
    const lines = buffer.subarray(0, filled).toString("utf8").split("\n");
    // A line cut by the limit is no complete JSON.
    if (info.size > filled) lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      let entry;
      try { entry = JSON.parse(line); } catch { continue; }
      if (!entry || typeof entry !== "object" || Array.isArray(entry) || !Object.prototype.hasOwnProperty.call(entry, "sessionId")) continue;
      return typeof entry.sessionId === "string" && entry.sessionId ? entry.sessionId : null;
    }
  } catch { /* an unreadable transcript proves nothing */ }
  finally { if (fd !== null) { try { fs.closeSync(fd); } catch { /* closed */ } } }
  return null;
}

// The session ids the transcript proves to be the same conversation: at most one, the origin. Never throws.
function transcriptSessionIds(file, limit = TRANSCRIPT_HEAD_BYTES) {
  const origin = transcriptOriginSessionId(file, limit);
  return new Set(origin ? [origin] : []);
}

// Moves the planning binding of the same conversation to the new session id. Returns
// { adopted: false, reason } or { adopted: true, from, record }; never throws. reason is one of
// no-record-dir, has-record, no-transcript, no-match, ambiguous (two records of the named session), error. Only
// the session named by the first sessionId line of the transcript can be adopted (transcriptOriginSessionId); a
// transcript that begins with the caller's own id adopts nothing, whatever follows. The holder's activity plays
// no part: the transcript proves it is the same conversation (Orchestrator decision on P4 D15).
function adoptByTranscript(options) {
  try {
    const harnessRoot = harnessControlRoot(options.harnessRoot);
    const sessionId = validSession(options.sessionId);
    const file = recordPath(harnessRoot, sessionId);
    if (fs.existsSync(file)) return { adopted: false, reason: "has-record" };
    if (!fs.existsSync(path.dirname(file))) return { adopted: false, reason: "no-record-dir" };
    if (!options.transcriptPath) return { adopted: false, reason: "no-transcript" };
    const { records } = readRecords(harnessRoot);
    if (!records.length) return { adopted: false, reason: "no-match" };
    const named = transcriptSessionIds(path.resolve(String(options.transcriptPath)));
    const hadIds = named.size > 0;
    named.delete(sessionId);
    const holders = records.filter((item) => named.has(item.value.sessionId));
    if (!holders.length) return { adopted: false, reason: hadIds ? "no-match" : "no-transcript" };
    if (holders.length > 1) return { adopted: false, reason: "ambiguous" };
    const holder = holders[0];
    // The record must still describe a usable planning binding: its repository and bundle are checked like
    // find does; one that cannot be used is no binding to carry over. An active package is no reason to refuse:
    // its record stays only until the next cleanup, and the new session may still write evidence and design.
    const state = orphanReason(holder.value);
    if (state.reason && state.reason !== "package-active") return { adopted: false, reason: "no-match" };
    const at = new Date().toISOString();
    const transfers = Array.isArray(holder.value.transfers) ? holder.value.transfers.slice(-19) : [];
    transfers.push({ at, from: holder.value.sessionId, to: sessionId, via: "transcript" });
    const value = { ...holder.value, sessionId, takenOverFrom: holder.value.sessionId, takenOverAt: at, takenOverVia: "transcript",
      transfers };
    atomicJson(file, value);
    removeQuietly(holder.file);
    return { adopted: true, from: holder.value.sessionId, record: file, packageId: value.packageId };
  } catch (error) {
    return { adopted: false, reason: "error", message: String(error && error.message || error) };
  }
}

// The planning bindings of other sessions a refusal may name, with the exact command that takes each over by
// hand (D15). Only two kinds are named, so a refusal never shows one session the package of another live one:
//   - holders the transcript of the calling session names in its sessionId field (options.transcriptPath, from
//     the hook input): the same conversation;
//   - holders of the SAME package (options.packageId) in the SAME repository (options.repoRoot) that ran no
//     hook for silenceMs: only those can be taken over by hand.
// Without a transcript and without a package and repository, nothing is named. Never throws.
function planningHolders(options) {
  try {
    const harnessRoot = harnessControlRoot(options.harnessRoot);
    const sessionId = validSession(options.sessionId);
    const now = options.now === undefined ? Date.now() : options.now;
    const limit = options.silenceMs === undefined ? hookActivity.silenceLimitMs(options.env || process.env) : options.silenceMs;
    const named = options.transcriptPath ? transcriptSessionIds(path.resolve(String(options.transcriptPath))) : new Set();
    named.delete(sessionId);
    const repoRoot = options.repoRoot ? path.resolve(String(options.repoRoot)) : null;
    const packageId = options.packageId ? String(options.packageId) : null;
    return readRecords(harnessRoot).records.filter((item) => item.value.sessionId !== sessionId)
      .map((item) => {
        const silent = hookActivity.silentForMs(item.file, now);
        const proven = named.has(item.value.sessionId);
        const silentSame = Boolean(repoRoot && packageId && silent >= limit && sameId(item.value.packageId, packageId) &&
          repository.samePath(item.value.repoRoot, repoRoot));
        return { item, silent, proven, show: proven || silentSame };
      })
      .filter((entry) => entry.show)
      .sort((left, right) => recordTime(right.item.value) - recordTime(left.item.value)).slice(0, 5).map(({ item, silent, proven }) => {
        const scope = IDENTIFIER.test(String(item.value.scope)) ? item.value.scope : item.value.packageId;
        return { sessionId: item.value.sessionId, packageId: item.value.packageId, scope, repoRoot: item.value.repoRoot,
          silentMs: Math.round(silent), via: proven ? "transcript" : "silence",
          command: takeoverCommand({ unlazyRoot: item.value.unlazyRoot }, harnessRoot, item.value.repoRoot, item.value.packageId,
            scope, sessionId) };
      });
  } catch {
    return [];
  }
}

// --- D1: the light route for evidence and design -------------------------------------------------
// The session that holds the planning binding of a package, or that orchestrates it, writes
// docs/packages/<id>/evidence/** and docs/packages/<id>/design/** of THAT package directly. PACKAGE.md,
// GATES.md, gates/**, OWNER.md and everything else stay closed; this is no widening of OWNS but the one
// place where the Orchestrator keeps proof and reports, which no worker has to write for it.
const REPORT_FOLDERS = new Set(["evidence", "design"]);

function foldName(name) {
  const lower = String(name).toLowerCase();
  return process.platform === "win32" ? lower.replace(/:.*$/u, "").replace(/[. ]+$/u, "") : lower;
}

// null when the target is not below evidence/ or design/ of the package directory; otherwise
// { allowed, code, relative, next }.
function reportTarget(packageDir, targetPath) {
  const target = path.resolve(targetPath);
  if (!repository.isPathInside(packageDir, target) || repository.samePath(packageDir, target)) return null;
  const relative = path.relative(packageDir, target).replaceAll("\\", "/");
  const parts = relative.split("/");
  if (parts.length < 2 || !REPORT_FOLDERS.has(foldName(parts[0])) || parts.some((part) => part === "" || part === "..")) return null;
  for (let parent = path.dirname(target); repository.isPathInside(packageDir, parent) && !repository.samePath(parent, packageDir);
    parent = path.dirname(parent)) {
    if (fs.existsSync(parent) && fs.lstatSync(parent).isSymbolicLink()) {
      return { allowed: false, code: "BOOTSTRAP_LINK", next: "replace linked package components with real directories" };
    }
  }
  try {
    const info = fs.lstatSync(target);
    if (info.isSymbolicLink() || !info.isFile() || (typeof info.nlink === "number" && info.nlink !== 1)) {
      return { allowed: false, code: "BOOTSTRAP_LINK", next: "write only regular files with one name below evidence/ and design/" };
    }
  } catch { /* a new file */ }
  return { allowed: true, code: "BOUND_REPORT_WRITE", relative };
}

// The orchestrator record of a session (orchestrator-role.mjs): packages the session started, dispatched or
// planned. Read-only here; the file is written by recordOrchestrator.
function orchestratedPackages(harnessRoot, sessionId) {
  try {
    const root = realpath(path.resolve(String(harnessRoot || "")));
    const key = crypto.createHash("sha256").update(validSession(sessionId)).digest("hex") + ".json";
    const file = path.join(root, ".unlazy", ".orchestrators", key);
    const info = fs.lstatSync(file);
    if (!info.isFile() || info.isSymbolicLink() || (typeof info.nlink === "number" && info.nlink !== 1)) return [];
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!value || value.schemaVersion !== 1 || value.sessionId !== String(sessionId).trim() || !Array.isArray(value.packages)) return [];
    return value.packages.filter((item) => item && typeof item.repoRoot === "string" && IDENTIFIER.test(String(item.packageId)));
  } catch {
    return [];
  }
}

// Decision for a session that orchestrates packages: null when no recorded package of it owns the target.
function authorizeOrchestratorWrite(options) {
  for (const item of orchestratedPackages(options.harnessRoot, options.sessionId)) {
    const packageDir = path.join(item.repoRoot, "docs", "packages", item.packageId);
    let info;
    try { info = fs.lstatSync(packageDir); } catch { continue; }
    if (!info.isDirectory() || info.isSymbolicLink()) continue;
    const decision = reportTarget(packageDir, options.targetPath);
    if (decision) return { ...decision, packageId: item.packageId, scope: item.scope };
  }
  return null;
}

function doctorDiagnostics(result) {
  if (result.hung) return [hungMessage("package-cli doctor", result)];
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
//
// doctor has no time limit of its own (P15, C13): it runs through the silence watcher and counts as hung only
// when it is silent and its process tree does no work, so a slow doctor no longer makes the package "not ready".
// plan is async for that reason. The repository is asked once per run (runSnapshots).
async function plan(options) {
  const snapshotOf = runSnapshots();
  const record = find(options, snapshotOf);
  if (packageActive(record.repoRoot, record.packageId)) {
    fail("package " + record.packageId + " is active", "PACKAGE_ACTIVE", { next: ACTIVE_NEXT });
  }
  const { prunedRecords, invalidRecords } = pruneOrphanedRecords({ harnessRoot: record.harnessRoot, snapshotOf });
  const unlazy = bootstrapRuntime(record.repoRoot, options.unlazyRoot);
  const result = await runWatchedChild(process.execPath, [path.join(unlazy, "scripts", "package-cli.mjs"), "doctor",
    "--root", record.repoRoot, "--package", record.packageId, "--json"],
  { unlazyRoot: unlazy });
  const diagnostics = doctorDiagnostics(result);
  if (result.status !== 0 || result.error || result.hung || diagnostics.length) {
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
  if (active(record)) {
    // The planning binding no longer writes the contract, but its session still keeps the proof and the
    // design notes of its own package (D1): evidence/** and design/** below docs/packages/<packageId>/.
    const report = reportTarget(record.packageDir, targetPath);
    if (report) return report.allowed ? { ...report, packageId: record.packageId, scope: record.scope } : report;
    return { allowed: false, code: "BOOTSTRAP_ENDED",
      detail: "the planning binding ended when the package started; the planning session may still write docs/packages/" +
        record.packageId + "/evidence/** and design/** directly",
      next: "use the active package leaf binding; the planning session may still write docs/packages/" + record.packageId +
        "/evidence/** and design/** directly" };
  }
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

module.exports = { TRANSCRIPT_HEAD_BYTES, adoptByTranscript, authorizeOrchestratorWrite, authorizeWrite, begin, find, finish,
  noteHookActivity: hookActivity.noteHookActivity, plan, planningHolders, pruneOrphanedRecords, recordPath, renameWithRetry, scaffoldStatus,
  transcriptOriginSessionId, transcriptSessionIds };
