#!/usr/bin/env node
// Owner acceptance of a package through the one existing approval mechanism
// (completeness audit 06.09.2026, B21).
//
// A roof gate "explicit Owner acceptance" used to be a checkbox anyone could tick. Acceptance
// now takes the same route as every consequential transition: the harness issues a challenge
// bound to the package's immutable Owner request and its plan, the human Owner writes ONE
// external single-use approval artifact (outside the repository, owner-private), the harness
// consumes it exactly once and records the immutable consumption receipt inside the bundle as
// docs/packages/<packageId>/evidence/owner-acceptance.json. A gate CHECK verifies that receipt
// against the CURRENT Owner request and plan, so an acceptance goes stale the moment either
// changes -- nothing here can be ticked by hand.
//
//   node checks/owner-acceptance.mjs challenge --package <id> [--root <repository>]
//   node checks/owner-acceptance.mjs consume   --package <id> --challenge <receipt> --approval-file <file> [--root <repository>]
//   node checks/owner-acceptance.mjs verify    --package <id> [--root <repository>]
//
// verify prints OWNER_ACCEPTANCE_OK (exit 0) or OWNER_ACCEPTANCE_FAILED (exit 1).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  consumeOwnerApproval, createApprovalChallenge, validateImmutableRecord,
} from "../harness-core/execution/owner-approval.mjs";
import { locateUnlazy } from "../harness-core/git/git-intent.mjs";

const require = createRequire(import.meta.url);
const repository = require("../harness-core/binding/repository.cjs");

export const ACCEPTANCE_ACTION = "accept";
export const ACCEPTANCE_SCOPE = "acceptance";
export const ACCEPTANCE_FILE = "owner-acceptance.json";
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;

class AcceptanceError extends Error {
  constructor(code, message, exitCode = 2) {
    super(message);
    this.code = code;
    this.exitCode = exitCode;
  }
}

const sha256 = (value) => "sha256:" + crypto.createHash("sha256").update(value).digest("hex");
const normalizedText = (bytes) => bytes.toString("utf8").replace(/\r\n/gu, "\n");

function parse(argv) {
  const options = { command: argv[0] || "" };
  for (let index = 1; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new AcceptanceError("USAGE", "option " + key + " requires a value");
    }
    options[key.slice(2)] = value;
    index += 1;
  }
  return options;
}

function readRegular(file, label) {
  if (!fs.existsSync(file)) throw new AcceptanceError("ACCEPTANCE_MISSING", label + " does not exist: " + file, 1);
  const info = fs.lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink()) throw new AcceptanceError("ACCEPTANCE_FILE", label + " must be one regular file", 1);
  return fs.readFileSync(file);
}

// The plan section is the accepted commitment; Status, Abschluss and Anhang may move afterwards.
export function planSection(packageText) {
  const lines = String(packageText).replace(/\r\n/gu, "\n").split("\n");
  const start = lines.findIndex((line) => /^##\s+Plan\s*$/u.test(line));
  if (start === -1) throw new AcceptanceError("ACCEPTANCE_PLAN", "PACKAGE.md has no '## Plan' section", 1);
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s/u.test(lines[index])) { end = index; break; }
  }
  return lines.slice(start, end).join("\n").trimEnd() + "\n";
}

function currentHead(repoRoot) {
  const result = spawnSync("git", ["-C", repoRoot, "rev-parse", "--verify", "HEAD"], { encoding: "utf8", windowsHide: true, timeout: 30_000 });
  return result.status === 0 ? String(result.stdout).trim() : null;
}

export function acceptanceSubject(repoRoot, packageId) {
  if (!IDENTIFIER.test(String(packageId || ""))) throw new AcceptanceError("USAGE", "--package must name one package id");
  const packageDir = path.join(repoRoot, "docs", "packages", packageId);
  const ownerText = normalizedText(readRegular(path.join(packageDir, "OWNER.md"), "OWNER.md"));
  const packageText = normalizedText(readRegular(path.join(packageDir, "PACKAGE.md"), "PACKAGE.md"));
  return {
    packageId,
    ownerDigest: sha256(ownerText),
    planDigest: sha256(planSection(packageText)),
  };
}

export function acceptanceFile(repoRoot, packageId) {
  return path.join(repoRoot, "docs", "packages", packageId, "evidence", ACCEPTANCE_FILE);
}

function resolveRoot(options) {
  return repository.resolveRepositoryRoot(options.root || process.cwd());
}

export function challenge(options) {
  const repoRoot = resolveRoot(options);
  const subject = { ...acceptanceSubject(repoRoot, options.package), head: currentHead(repoRoot) };
  const issued = createApprovalChallenge({ repoRoot, action: ACCEPTANCE_ACTION, packageId: options.package,
    scope: ACCEPTANCE_SCOPE, subject });
  const issuedAt = new Date();
  const scriptFile = fileURLToPath(import.meta.url);
  return {
    ...issued,
    subject,
    ownerApproval: {
      rule: "Only the human Owner writes this file, outside the repository, readable only by the Owner; no agent route creates it.",
      template: {
        schemaVersion: 1,
        kind: "keel-owner-approval",
        owner: "Owner",
        action: ACCEPTANCE_ACTION,
        packageId: options.package,
        scope: ACCEPTANCE_SCOPE,
        challengeDigest: issued.challengeDigest,
        nonce: "<43-128 URL-safe characters, single use: run nonceCommand>",
        issuedAt: issuedAt.toISOString(),
        expiresAt: new Date(issuedAt.getTime() + 60 * 60_000).toISOString(),
      },
      nonceCommand: "node -e \"process.stdout.write(require('node:crypto').randomBytes(32).toString('base64url'))\"",
      suggestedLocation: process.platform === "win32"
        ? `%LOCALAPPDATA%\\KeelHarness\\approvals\\${options.package}-accept.json`
        : `$HOME/.keel-harness/approvals/${options.package}-accept.json`,
      nextCommand: `node "${scriptFile}" consume --root "${repoRoot}" --package ${options.package} --challenge "${issued.challenge}" --approval-file <file>`,
    },
  };
}

export async function consume(options) {
  const repoRoot = resolveRoot(options);
  if (!options.challenge || !options["approval-file"]) throw new AcceptanceError("USAGE", "consume requires --challenge and --approval-file");
  const target = acceptanceFile(repoRoot, options.package);
  if (fs.existsSync(target)) {
    throw new AcceptanceError("ACCEPTANCE_EXISTS", "an acceptance is already recorded at " + target + "; the Owner removes it explicitly before accepting again", 1);
  }
  const expected = acceptanceSubject(repoRoot, options.package);
  const consumed = await consumeOwnerApproval({ repoRoot, unlazyRoot: locateUnlazy(repoRoot),
    challenge: options.challenge, approvalFile: options["approval-file"] });
  if (consumed.action !== ACCEPTANCE_ACTION) throw new AcceptanceError("OWNER_APPROVAL_MISMATCH", "approval does not authorize acceptance", 1);
  if (consumed.subject.packageId !== expected.packageId || consumed.subject.ownerDigest !== expected.ownerDigest ||
      consumed.subject.planDigest !== expected.planDigest) {
    throw new AcceptanceError("ACCEPTANCE_STALE", "the Owner request or the plan changed after the challenge was issued; issue a new challenge", 1);
  }
  const bytes = fs.readFileSync(consumed.approvalReceipt);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes, { flag: "wx" });
  return { recorded: target, approvalReceipt: consumed.approvalReceipt, subject: consumed.subject };
}

export function verify(options) {
  const repoRoot = resolveRoot(options);
  const file = acceptanceFile(repoRoot, options.package);
  const expected = acceptanceSubject(repoRoot, options.package);
  let value;
  try { value = JSON.parse(readRegular(file, "owner acceptance record").toString("utf8")); }
  catch (error) {
    if (error instanceof AcceptanceError) throw error;
    throw new AcceptanceError("ACCEPTANCE_JSON", "owner acceptance record is invalid JSON: " + error.message, 1);
  }
  try { validateImmutableRecord(value); }
  catch (error) { throw new AcceptanceError("ACCEPTANCE_DIGEST", "owner acceptance record bytes do not match their immutable identity: " + error.message, 1); }
  if (value.operation !== "owner-approval-consumption" || value.action !== ACCEPTANCE_ACTION ||
      value.packageId !== options.package || value.scope !== ACCEPTANCE_SCOPE || !value.subject) {
    throw new AcceptanceError("ACCEPTANCE_IDENTITY", "owner acceptance record does not bind an acceptance of this package", 1);
  }
  if (value.subject.packageId !== expected.packageId) throw new AcceptanceError("ACCEPTANCE_IDENTITY", "acceptance subject names another package", 1);
  if (value.subject.ownerDigest !== expected.ownerDigest) throw new AcceptanceError("ACCEPTANCE_STALE", "OWNER.md changed after the Owner accepted", 1);
  if (value.subject.planDigest !== expected.planDigest) throw new AcceptanceError("ACCEPTANCE_STALE", "the PACKAGE.md plan changed after the Owner accepted", 1);
  return { file, packageId: options.package, consumedAt: value.consumedAt, approvalDigest: value.approvalDigest, subject: value.subject };
}

async function main() {
  const options = parse(process.argv.slice(2));
  if (options.command === "challenge") {
    process.stdout.write(JSON.stringify(challenge(options), null, 2) + "\n");
    return;
  }
  if (options.command === "consume") {
    const result = await consume(options);
    process.stdout.write(JSON.stringify(result, null, 2) + "\nOWNER_ACCEPTANCE_RECORDED\n");
    return;
  }
  if (options.command === "verify") {
    const result = verify(options);
    process.stdout.write("owner acceptance: " + result.packageId + " accepted " + result.consumedAt + " approval " + result.approvalDigest + "\n");
    process.stdout.write("OWNER_ACCEPTANCE_OK\n");
    return;
  }
  throw new AcceptanceError("USAGE", "usage: owner-acceptance.mjs challenge|consume|verify --package <id> [--root <repository>] [--challenge <receipt> --approval-file <file>]");
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    const code = error.code || "ACCEPTANCE_ERROR";
    process.stderr.write("not ok owner acceptance: " + code + " " + error.message + "\n");
    if (String(process.argv[2]) === "verify") process.stdout.write("OWNER_ACCEPTANCE_FAILED\n");
    process.exitCode = error.exitCode || 2;
  });
}
