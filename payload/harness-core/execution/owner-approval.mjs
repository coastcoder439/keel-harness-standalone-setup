// One-time Owner approvals for consequential package transitions. The agent
// execution CLI can create a challenge and consume an existing artifact, but
// deliberately has no operation that creates the external Owner artifact.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const ACTIONS = new Set(["close", "publish", "waive-duty", "accept"]);
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const NONCE = /^[A-Za-z0-9_-]{43,128}$/u;

function approvalError(code, message, exitCode = 2) {
  const error = new Error(message);
  error.code = code;
  error.exitCode = exitCode;
  return error;
}

function sha256(value) {
  return "sha256:" + crypto.createHash("sha256").update(value).digest("hex");
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function recordValue(value) {
  const body = canonical({ schemaVersion: 1, ...value });
  return { ...body, recordDigest: sha256(JSON.stringify(body)) };
}

function sameFileSystemObject(left, right) {
  const a = fs.statSync(left, { bigint: true });
  const b = fs.statSync(right, { bigint: true });
  return a.dev === b.dev && a.ino === b.ino;
}

function insideByIdentity(root, candidate) {
  const base = fs.realpathSync(path.resolve(root));
  let current = fs.realpathSync(path.resolve(candidate));
  while (true) {
    if (sameFileSystemObject(base, current)) return true;
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

function regularFile(file, label) {
  if (!fs.existsSync(file)) throw approvalError("OWNER_APPROVAL_MISSING", label + " does not exist");
  const info = fs.lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink() || (typeof info.nlink === "number" && info.nlink !== 1)) {
    throw approvalError("OWNER_APPROVAL_FILE", label + " must be one single-link regular file");
  }
  return info;
}

function atomicImmutableJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const text = JSON.stringify(value, null, 2) + "\n";
  try { fs.writeFileSync(file, text, { encoding: "utf8", flag: "wx", mode: 0o600 }); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    if (fs.readFileSync(file, "utf8") !== text) {
      throw approvalError("RECEIPT_COLLISION", "immutable receipt path already contains different bytes");
    }
  }
  return file;
}

export function executionReceiptDirectory(repoRoot) {
  return path.join(fs.realpathSync(path.resolve(repoRoot)), ".unlazy", ".execution-receipts");
}

function receiptPath(repoRoot, value) {
  return path.join(executionReceiptDirectory(repoRoot), value.operation + "-" + value.recordDigest.slice(7) + ".json");
}

function writeReceipt(repoRoot, value) {
  const record = recordValue(value);
  const file = receiptPath(repoRoot, record);
  atomicImmutableJson(file, record);
  return { file, value: record };
}

// SELF-CONSISTENCY, NOT IDENTITY -- the limit of what a receipt can prove.
//
// This function verifies exactly three things: the file is one direct, regular
// entry of the repository receipt directory (no symlink, no hardlink, no file
// smuggled in from elsewhere), its bytes still hash to the recordDigest they
// carry, and that digest still derives the path the file actually occupies. An
// EXISTING receipt therefore cannot be edited, renamed or swapped unnoticed,
// and atomicImmutableJson refuses to rewrite one with different bytes.
//
// It proves nothing about WHO wrote the receipt. `.unlazy/` is agent-writable
// (welle-2c-design.md, threat model): whoever can write that directory can mint
// a fresh receipt whose digest and path are correct by construction -- the
// fixture `closeAuthorization` in test/endgoal-e2e.test.js does exactly that
// with plain fs writes, and it is accepted. A receipt is thus a PROCESS control
// over the executor's own steps, not a cryptographic anchor.
//
// The anchors are the other two named in that model: `origin/main`, reachable
// only through an Owner-released publish, and Git objects at an anchor commit
// (`origin/main` or the `headBefore` bound in the receipt). The external Owner
// approval artifact is likewise a process control on the same OS user, hardened
// by file ACLs -- not cryptography and not proof of a person. Consequence for
// callers: a check that could read its before-state from an anchor must do so;
// a receipt is only ever the sanctioned chain BETWEEN two anchor reads.
export function readExecutionReceipt(repoRoot, file, operation = null) {
  const directory = executionReceiptDirectory(repoRoot);
  const candidate = path.resolve(file || "");
  regularFile(candidate, "execution receipt");
  const resolvedDirectory = fs.realpathSync(directory);
  const resolved = fs.realpathSync(candidate);
  if (!sameFileSystemObject(resolvedDirectory, path.dirname(resolved))) {
    throw approvalError("RECEIPT_SCOPE", "execution receipt must be a direct file in the repository receipt directory");
  }
  let value;
  try { value = JSON.parse(fs.readFileSync(resolved, "utf8")); }
  catch (error) { throw approvalError("RECEIPT_JSON", "execution receipt is invalid JSON: " + error.message); }
  if (!value || value.schemaVersion !== 1 || !DIGEST.test(String(value.recordDigest || "")) ||
      (operation && value.operation !== operation)) {
    throw approvalError("RECEIPT_IDENTITY", "execution receipt has the wrong schema or operation");
  }
  const { recordDigest, ...body } = value;
  const expectedPath = receiptPath(repoRoot, value);
  if (sha256(JSON.stringify(canonical(body))) !== recordDigest || !sameFileSystemObject(expectedPath, resolved)) {
    throw approvalError("RECEIPT_DIGEST", "execution receipt bytes do not match their immutable identity");
  }
  return { file: resolved, value };
}

function subjectDigest(subject) {
  return sha256(JSON.stringify(canonical(subject)));
}

// One gate-runner invocation the executor started itself, recorded as an
// execution receipt so that git-intent can verify the witness of a closure
// writeback instead of accepting a path list on its command line.
// `ledgers` are the bundle ledgers that invocation covered (an exact --leaf run
// covers one, a bundle run covers all of them) and `files` are the bundle paths
// whose bytes it rewrote, each with the digest it left behind. git-intent
// re-checks those digests against the working tree, so a file changed again
// after the run loses its witness. Proven by the CLOSE_WRITEBACK probes of "two
// verified leaves receive one integration checkpoint, bottom-up reverify, plan
// completion and close" in test/package-execution.test.js.
export function writeWritebackWitness(options) {
  const files = [...(options.files || [])]
    .map((item) => ({ relative: String(item.relative), digest: String(item.digest) }))
    .sort((left, right) => left.relative.localeCompare(right.relative, "en"));
  const ledgers = [...new Set((options.ledgers || []).map((item) => String(item)))]
    .sort((left, right) => left.localeCompare(right, "en"));
  const receipt = writeReceipt(options.repoRoot, {
    operation: "oracle-writeback-witness",
    packageId: String(options.packageId || ""),
    scope: String(options.scope || ""),
    planReceipt: String(options.planReceipt || ""),
    head: String(options.head || ""),
    ledgers,
    files,
    recordedAt: options.recordedAt || new Date().toISOString(),
  });
  return { receipt: receipt.file, value: receipt.value };
}

export function createApprovalChallenge(options) {
  const action = String(options.action || "");
  if (!ACTIONS.has(action)) throw approvalError("OWNER_APPROVAL_ACTION", "unsupported Owner approval action " + action);
  const createdAt = options.createdAt || new Date().toISOString();
  if (!Number.isFinite(Date.parse(createdAt))) throw approvalError("OWNER_APPROVAL_TIME", "challenge time must be ISO");
  const subject = canonical(options.subject || {});
  const receipt = writeReceipt(options.repoRoot, {
    operation: "owner-approval-challenge",
    action,
    packageId: String(options.packageId || ""),
    scope: String(options.scope || ""),
    dutyId: options.dutyId || null,
    subject,
    subjectDigest: subjectDigest(subject),
    createdAt,
  });
  return { challenge: receipt.file, challengeDigest: receipt.value.recordDigest, action,
    packageId: receipt.value.packageId, scope: receipt.value.scope, subjectDigest: receipt.value.subjectDigest };
}

async function assertPrivateApprovalArtifact(repoRoot, file, unlazyRoot) {
  const resolved = path.resolve(file || "");
  const info = regularFile(resolved, "Owner approval artifact");
  if (insideByIdentity(repoRoot, resolved)) {
    throw approvalError("OWNER_APPROVAL_SCOPE", "Owner approval artifact must be outside the repository and its agent-writable runtime");
  }
  const directory = path.dirname(resolved);
  const directoryInfo = fs.lstatSync(directory);
  if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) {
    throw approvalError("OWNER_APPROVAL_DIRECTORY", "Owner approval directory must be one real directory");
  }
  if (process.platform === "win32") {
    if (!unlazyRoot) throw approvalError("OWNER_APPROVAL_ACL", "Windows approval validation requires the selected Unlazy runtime");
    const moduleFile = path.join(unlazyRoot, "scripts", "lib", "windows-acl.mjs");
    const acl = await import(pathToFileURL(moduleFile).href);
    try { acl.verifyWindowsPrivateDirectory(directory); }
    catch (error) { throw approvalError("OWNER_APPROVAL_ACL", "Owner approval directory is not owner-private: " + error.message); }
  } else {
    if (typeof process.getuid === "function" && info.uid !== process.getuid()) {
      throw approvalError("OWNER_APPROVAL_OWNER", "Owner approval artifact is not owned by the current OS owner");
    }
    if ((directoryInfo.mode & 0o077) !== 0 || (info.mode & 0o077) !== 0) {
      throw approvalError("OWNER_APPROVAL_MODE", "Owner approval artifact and directory must not grant group/other access");
    }
  }
  return resolved;
}

function readOwnerArtifact(file) {
  let value;
  try { value = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) { throw approvalError("OWNER_APPROVAL_JSON", "Owner approval artifact is invalid JSON: " + error.message); }
  if (!value || value.schemaVersion !== 1 || value.kind !== "keel-owner-approval" || value.owner !== "Owner" ||
      !ACTIONS.has(value.action) || !DIGEST.test(String(value.challengeDigest || "")) || !NONCE.test(String(value.nonce || ""))) {
    throw approvalError("OWNER_APPROVAL_SCHEMA", "Owner approval artifact has an invalid schema, action, challenge, owner, or nonce");
  }
  const issuedAt = Date.parse(value.issuedAt);
  const expiresAt = Date.parse(value.expiresAt);
  const now = Date.now();
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || issuedAt > now + 5 * 60_000 ||
      expiresAt <= now || expiresAt - issuedAt > 24 * 60 * 60_000) {
    throw approvalError("OWNER_APPROVAL_EXPIRED", "Owner approval artifact time window is invalid or expired");
  }
  return value;
}

function assertUnusedNonce(repoRoot, nonceDigest) {
  const directory = executionReceiptDirectory(repoRoot);
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith(".json")) continue;
    let value;
    try { value = JSON.parse(fs.readFileSync(path.join(directory, entry.name), "utf8")); }
    catch { continue; }
    if (value.operation === "owner-approval-consumption" && value.nonceDigest === nonceDigest) {
      throw approvalError("OWNER_APPROVAL_REPLAY", "Owner approval nonce has already been consumed", 1);
    }
  }
}

export async function consumeOwnerApproval(options) {
  const challenge = readExecutionReceipt(options.repoRoot, options.challenge, "owner-approval-challenge");
  const artifactFile = await assertPrivateApprovalArtifact(options.repoRoot, options.approvalFile, options.unlazyRoot);
  const artifact = readOwnerArtifact(artifactFile);
  if (artifact.action !== challenge.value.action || artifact.challengeDigest !== challenge.value.recordDigest ||
      artifact.packageId !== challenge.value.packageId || artifact.scope !== challenge.value.scope ||
      (artifact.dutyId || null) !== (challenge.value.dutyId || null)) {
    throw approvalError("OWNER_APPROVAL_MISMATCH", "Owner approval artifact does not bind this exact challenge and package transition", 1);
  }
  const nonceDigest = sha256(artifact.nonce);
  assertUnusedNonce(options.repoRoot, nonceDigest);
  const approvalDigest = sha256(fs.readFileSync(artifactFile));
  const receipt = writeReceipt(options.repoRoot, {
    operation: "owner-approval-consumption",
    action: artifact.action,
    packageId: artifact.packageId,
    scope: artifact.scope,
    dutyId: artifact.dutyId || null,
    challengeReceipt: challenge.file,
    challengeDigest: challenge.value.recordDigest,
    subject: challenge.value.subject,
    subjectDigest: challenge.value.subjectDigest,
    approvalDigest,
    nonceDigest,
    issuedAt: artifact.issuedAt,
    expiresAt: artifact.expiresAt,
    consumedAt: new Date().toISOString(),
  });
  return { approvalReceipt: receipt.file, approvalDigest, nonceDigest, challenge: challenge.file,
    action: artifact.action, subject: challenge.value.subject, subjectDigest: challenge.value.subjectDigest };
}

export function writeConsequentialReceipt(options) {
  const approval = readExecutionReceipt(options.repoRoot, options.approvalReceipt, "owner-approval-consumption");
  if (approval.value.action !== options.action || approval.value.packageId !== options.packageId ||
      approval.value.scope !== options.scope) {
    throw approvalError("OWNER_APPROVAL_MISMATCH", "approval consumption does not bind this consequential result");
  }
  const result = canonical(options.result || {});
  const receipt = writeReceipt(options.repoRoot, {
    operation: options.action + "-receipt",
    action: options.action,
    packageId: options.packageId,
    scope: options.scope,
    approvalReceipt: approval.file,
    approvalDigest: approval.value.approvalDigest,
    nonceDigest: approval.value.nonceDigest,
    subjectDigest: approval.value.subjectDigest,
    result,
    resultDigest: subjectDigest(result),
    duties: options.duties || null,
    completedAt: new Date().toISOString(),
  });
  return { receipt: receipt.file, value: receipt.value };
}

// Immutable records outside the receipt directory (audit 06.09.2026, B23 and B21): the close
// mirror inside the package bundle and the recorded Owner acceptance carry the same
// self-identifying shape as execution receipts, so any reader proves their bytes from the record
// itself instead of trusting their location.
export function immutableRecord(value) {
  return recordValue(value);
}

export function writeImmutableRecordFile(file, value) {
  return atomicImmutableJson(file, recordValue(value));
}

export function validateImmutableRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.schemaVersion !== 1) {
    throw approvalError("RECEIPT_IDENTITY", "immutable record has the wrong schema");
  }
  const { recordDigest, ...body } = value;
  if (!DIGEST.test(String(recordDigest || "")) || sha256(JSON.stringify(canonical(body))) !== recordDigest) {
    throw approvalError("RECEIPT_DIGEST", "immutable record bytes do not match their identity");
  }
  return value;
}
