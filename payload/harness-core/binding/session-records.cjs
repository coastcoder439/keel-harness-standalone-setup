"use strict";

// Is this session bound at all? (P4 A16)
//
// The package hooks (prompt-form for every message) used to run their whole
// Git-based binding search for every session, up to 14 Git calls with a binding. A session that holds no
// record of any kind cannot pass that search, so the answer needs no Git: this module only looks for the
// files that make a session bound. Each is a regular file named by the SHA-256 of the session id:
//   leaf binding      <harness root>/.unlazy/.session-index/<key>.json   (index of createBinding)
//                     <repo>/.unlazy/<scope>/bindings/<key>.json          (the binding itself)
//   planning binding  <harness root>/.unlazy/.bootstrap/<key>.json        (package-bootstrap.cjs)
//   amendment         <harness root>/.unlazy/.amend/<key>.json            (package-amend.cjs)
//   orchestrator      <harness root>/.unlazy/.orchestrators/<key>.json    (orchestrator-role.mjs)
// A positive answer only means "ask the real search"; the decision stays with the modules that own the
// records. The nearest repository is found by walking up to a .git entry, no Git process involved.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function sessionKey(sessionId) {
  const session = String(sessionId || "").trim();
  if (!session || session.length > 256 || /[\0\r\n]/u.test(session)) return null;
  return crypto.createHash("sha256").update(session).digest("hex") + ".json";
}

function isRegularFile(file) {
  try {
    const info = fs.lstatSync(file);
    return info.isFile() && !info.isSymbolicLink();
  } catch {
    return false;
  }
}

// The nearest directory at or above startPath that holds a .git directory or a regular .git file.
function nearestRepositoryRoot(startPath) {
  if (!startPath) return null;
  let current = path.resolve(String(startPath));
  for (;;) {
    try {
      const info = fs.lstatSync(path.join(current, ".git"));
      if (info.isDirectory() || info.isFile()) return current;
    } catch { /* no repository boundary here */ }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function localBindingExists(repoRoot, key) {
  if (!repoRoot) return false;
  const runtime = path.join(repoRoot, ".unlazy");
  let entries;
  try { entries = fs.readdirSync(runtime, { withFileTypes: true }); } catch { return false; }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === "locks" || entry.name.startsWith(".")) continue;
    if (isRegularFile(path.join(runtime, entry.name, "bindings", key))) return true;
  }
  return false;
}

// Whether the session holds a leaf binding: the index of the harness root, or a binding file of the
// repository the start path lies in.
function hasLeafRecord(harnessRoot, sessionId, startPath) {
  const key = sessionKey(sessionId);
  if (!key) return false;
  if (harnessRoot && isRegularFile(path.join(path.resolve(String(harnessRoot)), ".unlazy", ".session-index", key))) return true;
  return localBindingExists(nearestRepositoryRoot(startPath || harnessRoot), key);
}

// Every kind of record the session holds. any is false only when no search could succeed.
function sessionRecords(harnessRoot, sessionId, startPath) {
  const key = sessionKey(sessionId);
  const result = { leaf: false, planning: false, amend: false, orchestrator: false, any: false };
  if (!key || !harnessRoot) return result;
  const runtime = path.join(path.resolve(String(harnessRoot)), ".unlazy");
  result.leaf = hasLeafRecord(harnessRoot, sessionId, startPath);
  result.planning = isRegularFile(path.join(runtime, ".bootstrap", key));
  result.amend = isRegularFile(path.join(runtime, ".amend", key));
  result.orchestrator = isRegularFile(path.join(runtime, ".orchestrators", key));
  result.any = result.leaf || result.planning || result.amend || result.orchestrator;
  return result;
}

module.exports = { hasLeafRecord, nearestRepositoryRoot, sessionKey, sessionRecords };
