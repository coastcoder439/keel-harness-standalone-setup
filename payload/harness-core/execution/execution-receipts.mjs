// Durable execution receipts for consequential package transitions. Every
// receipt is one immutable file whose bytes derive its own name, so an existing
// receipt cannot be edited, renamed or swapped unnoticed.
//
// Der Freigabebeleg selbst ist keine Datei mehr, sondern die Owner-OK-Zeile
// (harness-core/execution/owner-ok.mjs). Dieses Modul haelt nur noch die
// generischen Beleg-Helfer, die frueher neben Challenge und Nonce lagen
// (Rueckbau 08.09.2026).

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;

function receiptError(code, message, exitCode = 2) {
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

function regularFile(file, label) {
  if (!fs.existsSync(file)) throw receiptError("RECEIPT_MISSING", label + " does not exist");
  const info = fs.lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink() || (typeof info.nlink === "number" && info.nlink !== 1)) {
    throw receiptError("RECEIPT_FILE", label + " must be one single-link regular file");
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
      throw receiptError("RECEIPT_COLLISION", "immutable receipt path already contains different bytes");
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
// a fresh receipt whose digest and path are correct by construction. A receipt
// is thus a PROCESS control over the steps of the executor itself, not a
// cryptographic anchor.
//
// The anchors are the other ones named in that model: `origin/main`, reachable
// only through an Owner-released publish, Git objects at an anchor commit
// (`origin/main` or the `headBefore` bound in the receipt), and since 08.09.2026
// the Owner-OK line, which carries the words of the Owner and is versioned with
// the closing commit. Consequence for callers: a check that could read its
// before-state from an anchor must do so; a receipt is only ever the sanctioned
// chain BETWEEN two anchor reads.
export function readExecutionReceipt(repoRoot, file, operation = null) {
  const directory = executionReceiptDirectory(repoRoot);
  const candidate = path.resolve(file || "");
  regularFile(candidate, "execution receipt");
  const resolvedDirectory = fs.realpathSync(directory);
  const resolved = fs.realpathSync(candidate);
  if (!sameFileSystemObject(resolvedDirectory, path.dirname(resolved))) {
    throw receiptError("RECEIPT_SCOPE", "execution receipt must be a direct file in the repository receipt directory");
  }
  let value;
  try { value = JSON.parse(fs.readFileSync(resolved, "utf8")); }
  catch (error) { throw receiptError("RECEIPT_JSON", "execution receipt is invalid JSON: " + error.message); }
  if (!value || value.schemaVersion !== 1 || !DIGEST.test(String(value.recordDigest || "")) ||
      (operation && value.operation !== operation)) {
    throw receiptError("RECEIPT_IDENTITY", "execution receipt has the wrong schema or operation");
  }
  const { recordDigest, ...body } = value;
  const expectedPath = receiptPath(repoRoot, value);
  if (sha256(JSON.stringify(canonical(body))) !== recordDigest || !sameFileSystemObject(expectedPath, resolved)) {
    throw receiptError("RECEIPT_DIGEST", "execution receipt bytes do not match their immutable identity");
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

// Der durable Beleg einer folgenreichen Transition. Er traegt die Owner-OK-Zeile,
// die der Owner fuer genau diese Aktion gesagt hat -- Wortlaut, Datum, Commit und
// den Digest der Zeile, damit jeder spaetere Leser dieselbe Zeile wiedererkennt.
export function writeConsequentialReceipt(options) {
  const record = options.ownerOk;
  if (!record || typeof record !== "object" || record.action !== options.action ||
      !DIGEST.test(String(record.lineDigest || ""))) {
    throw receiptError("OWNER_OK_INVALID", "consequential receipt requires the Owner-OK record of this exact action");
  }
  const ownerOk = canonical({
    action: record.action,
    target: record.target ?? null,
    date: String(record.date || ""),
    commit: String(record.commit || ""),
    wording: String(record.wording || ""),
    line: String(record.line || ""),
    lineDigest: String(record.lineDigest),
  });
  const result = canonical(options.result || {});
  const receipt = writeReceipt(options.repoRoot, {
    operation: options.action + "-receipt",
    action: options.action,
    packageId: options.packageId,
    scope: options.scope,
    ownerOk,
    result,
    resultDigest: subjectDigest(result),
    duties: options.duties || null,
    completedAt: new Date().toISOString(),
  });
  return { receipt: receipt.file, value: receipt.value };
}

// Immutable records outside the receipt directory (audit 06.09.2026, B23): the close
// mirror inside the package bundle carries the same self-identifying shape as execution
// receipts, so any reader proves their bytes from the record itself instead of trusting
// their location.
export function immutableRecord(value) {
  return recordValue(value);
}

export function writeImmutableRecordFile(file, value) {
  return atomicImmutableJson(file, recordValue(value));
}

export function validateImmutableRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.schemaVersion !== 1) {
    throw receiptError("RECEIPT_IDENTITY", "immutable record has the wrong schema");
  }
  const { recordDigest, ...body } = value;
  if (!DIGEST.test(String(recordDigest || "")) || sha256(JSON.stringify(canonical(body))) !== recordDigest) {
    throw receiptError("RECEIPT_DIGEST", "immutable record bytes do not match their identity");
  }
  return value;
}
