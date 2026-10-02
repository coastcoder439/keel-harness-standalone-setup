import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, openSync, closeSync,
  readFileSync, readdirSync, realpathSync, renameSync, rmSync, rmdirSync, statSync,
  unlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import {
  distributionIdentityFailures, genericDistributionContent, staleSourceOnlyTargets,
} from "./generic-content.mjs";
import { inspectAccountabilityData } from "./accountability-data.mjs";

export const MANAGEMENT_DIRECTORY = ".keel-harness";
export const STATE_SCHEMA = "keel-harness-install-state.v1";
export const TRANSACTION_SCHEMA = "keel-harness-install-transaction.v1";
const MANIFEST_SCHEMA = "keel-harness-standalone.v2";
const STATE_FILE = "state.json";
const LOCK_FILE = "transaction.lock";
const PROMOTION_JOURNAL_BATCH = 128;
const PLUGIN = "codex@openai-codex";
const MARKETPLACE = "openai-codex";
// Instance data, not distribution content: the installation only lays a template down when the file is
// absent, an existing file stays untouched, and later edits are local changes, never drift.
// launch.json (the dev-server list) and 08-sessions-rollen.md (the running session roles) joined in 1.3.10;
// before that every entry in either file blocked the Dashboard update button as drift.
const OWNER_MUTABLE_TARGETS = new Set([
  ".claude/launch.json",
  ".claude/mutation-policy.json",
  "docs/08-sessions-rollen.md",
  "docs/harness-instance.md",
  "docs/tool-landscape.md",
]);
// An installation older than 1.3.10 recorded the two targets above as "distribution" in its state. That
// stored value is accepted and re-derived, otherwise every installed version would refuse its own upgrade.
const OWNERSHIP_WIDENED_TO_OWNER = new Set([
  ".claude/launch.json",
  "docs/08-sessions-rollen.md",
]);
const LIFECYCLE_OWNED_TARGETS = new Set([
  "docs/packages/harness-onboarding/PACKAGE.md",
  "docs/packages/harness-onboarding/GATES.md",
  "docs/packages/harness-onboarding/gates/leaf-instance.md",
]);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const folded = (value) => process.platform === "win32" ? value.toLowerCase() : value;
const samePath = (left, right) => folded(realpathSync.native(left)) === folded(realpathSync.native(right));

export class DistributionError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "DistributionError";
    this.details = details;
    this.exitCode = 2;
  }
}

function fail(message, details) {
  throw new DistributionError(message, details);
}

function normalizeTarget(value) {
  if (typeof value !== "string") fail("manifest target must be a string");
  const target = value.replaceAll("\\", "/").replace(/^\.\//u, "");
  if (!target || target.startsWith("/") || /^[A-Za-z]:/u.test(target)) fail(`unsafe absolute target: ${value}`);
  const parts = target.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) fail(`unsafe relative target: ${value}`);
  const first = parts[0].toLowerCase();
  if (first === ".git" || first === MANAGEMENT_DIRECTORY.toLowerCase()) {
    fail(`reserved target is not installable: ${value}`);
  }
  return target;
}

function targetOwnership(target) {
  if (OWNER_MUTABLE_TARGETS.has(target)) return "owner";
  if (LIFECYCLE_OWNED_TARGETS.has(target)) return "lifecycle";
  return "distribution";
}

function isLocallyMutable(value) {
  const ownership = typeof value === "string" ? targetOwnership(value) : value.ownership;
  return ownership === "owner" || ownership === "lifecycle";
}

function inside(root, relativePath, label = "path") {
  const target = normalizeTarget(relativePath);
  const base = resolve(root);
  const full = resolve(base, ...target.split("/"));
  if (folded(full) !== folded(base) && !folded(full).startsWith(folded(base + sep))) {
    fail(`${label} escapes ${base}: ${relativePath}`);
  }
  return full;
}

function managementPaths(target) {
  const root = join(target, MANAGEMENT_DIRECTORY);
  return {
    root,
    state: join(root, STATE_FILE),
    lock: join(root, LOCK_FILE),
    transactions: join(root, "transactions"),
    backups: join(root, "backups"),
    runtime: join(root, "runtime"),
    dashboardRuntime: join(root, "runtime", "dashboard"),
  };
}

function assertDirectoryNoLink(path, label) {
  const info = lstatSync(path);
  if (!info.isDirectory() || info.isSymbolicLink()) fail(`${label} must be one real directory: ${path}`);
}

function assertSafeParents(root, relativePath) {
  const parts = normalizeTarget(relativePath).split("/");
  let current = resolve(root);
  for (const part of parts.slice(0, -1)) {
    current = join(current, part);
    if (!existsSync(current)) break;
    assertDirectoryNoLink(current, "target parent");
  }
}

function readRegular(path, label) {
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) {
    fail(`${label} must be one regular single-link file: ${path}`);
  }
  return { content: readFileSync(path), mode: info.mode & 0o777 };
}

function readTarget(root, target) {
  assertSafeParents(root, target);
  const path = inside(root, target, "target");
  if (!existsSync(path)) return { exists: false, content: null, mode: null };
  const value = readRegular(path, `target ${target}`);
  return { exists: true, ...value };
}

function fileShape(content, mode = 0o600) {
  if (content === null) return { exists: false, bytes: 0, sha256: null, mode: null };
  return { exists: true, bytes: content.length, sha256: sha256(content), mode };
}

function sameContent(left, right) {
  return left === null ? right === null : right !== null && left.equals(right);
}

// A Windows checkout with core.autocrlf=true writes every text file with CRLF although git stores
// the delivered LF bytes. Such a file is the same file: comparing bytes alone reported foreign
// ownership of the onboarding package, conflicts on install and drift on every update (Owner,
// 30.09.2026: "Das ist doch kein nutzerfreundliches Produkt"). Binary content (a NUL byte) is
// always compared byte for byte.
function isText(value) {
  return !value.includes(0);
}

function withLf(value) {
  return isText(value) ? Buffer.from(value.toString("utf8").replace(/\r\n/gu, "\n"), "utf8") : value;
}

function sameTextContent(left, right) {
  if (left.equals(right)) return true;
  return isText(left) && isText(right) && withLf(left).equals(withLf(right));
}

function listFiles(root) {
  const output = [];
  const walk = (current, prefix = "") => {
    for (const entry of readdirSync(current, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name, "en"))) {
      const target = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = join(current, entry.name);
      const info = lstatSync(full);
      if (info.isSymbolicLink()) fail(`linked artifact path is forbidden: ${target}`);
      if (entry.isDirectory()) walk(full, target);
      else if (entry.isFile()) output.push(target);
      else fail(`special artifact path is forbidden: ${target}`);
    }
  };
  walk(root);
  return output;
}

function treeDigest(entries) {
  const digest = createHash("sha256");
  for (const entry of [...entries].sort((left, right) => left.target.localeCompare(right.target, "en"))) {
    digest.update(`${entry.target}\0${entry.bytes}\0${entry.sha256}\n`);
  }
  return digest.digest("hex");
}

function validateMaintenance(manifest, options = {}) {
  const maintenance = manifest.maintenance;
  if (!isObject(maintenance) || typeof maintenance.updateOwner !== "string" || !maintenance.updateOwner.trim()) {
    fail("manifest has no update owner");
  }
  const upgrade = maintenance.upgradeContract;
  if (!isObject(upgrade) || upgrade.command !== "node install.mjs install --target <repository> --upgrade" ||
      upgrade.versionPolicy !== "monotonic-semver" || upgrade.requiresCleanManagedFiles !== true ||
      upgrade.preservesOriginalBackups !== true) {
    fail("manifest upgrade contract is incomplete");
  }
  if (!Array.isArray(maintenance.deprecations)) fail("manifest deprecations must be an array");
  const now = options.now === undefined ? new Date() : new Date(options.now);
  if (!Number.isFinite(now.getTime())) fail("maintenance verifier received an invalid clock");
  assertDeprecationsUnexpired(maintenance, now);
}

// Jeder Abkuendigungs-Eintrag ist ein datierter, besessener Vertrag; ein abgelaufener Eintrag
// sperrt die Verifikation fail-closed. Es wird KEIN bestimmter Eintrag verlangt -- eine
// Auslieferung ohne offene Abkuendigung ist der Normalzustand (ein hartkodierter Vertrag fuer
// eine laengst entfernte Flaeche haette ab 2026-11-01 jeden Empfaenger gesperrt).
export function assertDeprecationsUnexpired(maintenance, now = new Date()) {
  for (const entry of maintenance.deprecations) {
    if (!isObject(entry) || typeof entry.id !== "string" || !entry.id || typeof entry.surface !== "string" ||
        entry.owner !== maintenance.updateOwner || typeof entry.replacement !== "string" || !entry.replacement) {
      fail("manifest deprecation entry is malformed or not owned by the update owner");
    }
    const removalDate = String(entry.removalDate);
    const deadline = Date.parse(removalDate + "T23:59:59.999Z");
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(removalDate) || !Number.isFinite(deadline)) {
      fail(`manifest deprecation ${entry.id} has an invalid removal date`);
    }
    if (now.getTime() > deadline) {
      fail(`manifest follow-up ${entry.id} expired on ${removalDate}; remove the deprecated surface or publish a new owned contract`);
    }
  }
}

export function loadVerifiedArtifact(distributionRoot, options = {}) {
  const root = resolve(distributionRoot);
  assertDirectoryNoLink(root, "distribution root");
  const payloadRoot = join(root, "payload");
  assertDirectoryNoLink(payloadRoot, "payload root");
  const manifestPath = join(root, "manifest.json");
  const manifestFile = readRegular(manifestPath, "manifest").content;
  let manifest;
  try { manifest = JSON.parse(manifestFile.toString("utf8")); }
  catch (error) { fail(`manifest is not JSON: ${error.message}`); }
  if (manifest.schema !== MANIFEST_SCHEMA || !Array.isArray(manifest.files)) fail("unsupported or malformed manifest");
  if (!isObject(manifest.product) || manifest.product.id !== "keel-harness" ||
      manifest.product.name !== "Keel Harness" || !/^\d+\.\d+\.\d+$/u.test(manifest.product.version || "")) {
    fail("manifest product identity or version is invalid");
  }
  if (!isObject(manifest.payload) || !/^[a-f0-9]{64}$/u.test(manifest.payload.treeSha256 || "")) {
    fail("manifest payload fingerprint is missing");
  }
  const unlazy = manifest.provenance?.unlazy;
  if (!isObject(unlazy) || unlazy.repository !== "https://github.com/Leonxlnx/unlazy" ||
      !/^[a-f0-9]{40}$/u.test(unlazy.revision || "") || !/^\d+\.\d+\.\d+$/u.test(unlazy.version || "") ||
      !/^[a-f0-9]{64}$/u.test(unlazy.vendoredTreeSha256 || "")) {
    fail("manifest Unlazy pin/provenance is incomplete");
  }
  validateMaintenance(manifest, options);
  if (manifest.fileCount !== manifest.files.length) fail("manifest fileCount differs from files");

  const keys = new Set();
  const files = [];
  for (const rawEntry of manifest.files) {
    if (!isObject(rawEntry) || !["copy", "merge-lines", "merge-hooks"].includes(rawEntry.mode) ||
        !Number.isSafeInteger(rawEntry.bytes) || rawEntry.bytes < 0 || !/^[a-f0-9]{64}$/u.test(rawEntry.sha256 || "")) {
      fail("malformed manifest file entry");
    }
    const target = normalizeTarget(rawEntry.target);
    const key = target.toLowerCase();
    if (keys.has(key)) fail(`case-folding manifest collision: ${target}`);
    keys.add(key);
    const source = inside(payloadRoot, target, "payload source");
    const payload = readRegular(source, `payload ${target}`);
    if (payload.content.length !== rawEntry.bytes || sha256(payload.content) !== rawEntry.sha256) {
      fail(`payload integrity mismatch: ${target}`);
    }
    files.push({ ...rawEntry, target, content: payload.content, permission: payload.mode });
  }
  const actual = listFiles(payloadRoot).map((value) => value.toLowerCase()).sort();
  const declared = files.map((entry) => entry.target.toLowerCase()).sort();
  if (JSON.stringify(actual) !== JSON.stringify(declared)) fail("payload file list differs from manifest");
  if (treeDigest(files) !== manifest.payload.treeSha256) fail("payload tree fingerprint differs from manifest");
  const vendored = files.filter((entry) => entry.target.startsWith("vendor/unlazy/"));
  if (!vendored.length || treeDigest(vendored) !== unlazy.vendoredTreeSha256) {
    fail("vendored Unlazy tree differs from its exact manifest pin");
  }

  const installFiles = files.filter((entry) => !staleSourceOnlyTargets.has(entry.target)).map((entry) => ({
    ...entry,
    content: genericDistributionContent(entry.target, entry.content, { productVersion: manifest.product.version }),
  }));
  const identityFailures = distributionIdentityFailures(installFiles);
  if (identityFailures.length) fail("payload contains distributor-specific identity: " + identityFailures.join("; "));
  return {
    root, payloadRoot, manifest, files, installFiles,
    manifestDigest: sha256(manifestFile),
  };
}

export function assertRepository(targetValue) {
  const target = resolve(targetValue);
  if (!existsSync(target)) fail(`target does not exist: ${target}`);
  assertDirectoryNoLink(target, "target");
  const marker = join(target, ".git");
  if (!existsSync(marker)) fail("target has no .git directory or .git file marker");
  const markerInfo = lstatSync(marker);
  if (markerInfo.isSymbolicLink() || (!markerInfo.isDirectory() && !markerInfo.isFile())) {
    fail(".git marker must be a regular file or directory, never a link");
  }
  const result = spawnSync("git", ["-C", target, "rev-parse", "--show-toplevel"], {
    encoding: "utf8", windowsHide: true, timeout: 20_000,
  });
  if (result.status !== 0) fail("target is not a Git-recognized repository: " + String(result.stderr || result.stdout).trim());
  const actual = String(result.stdout).trim();
  if (!samePath(actual, target)) fail("target is inside another repository instead of being its own Git root");
  return realpathSync.native(target);
}

function assertNoLegacy(target) {
  const packageRoot = join(target, "docs", "packages");
  if (!existsSync(packageRoot)) return;
  assertDirectoryNoLink(packageRoot, "docs/packages");
  const legacy = readdirSync(packageRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && entry.name !== "TEMPLATE.md")
    .map((entry) => entry.name).sort((left, right) => left.localeCompare(right, "en"));
  if (legacy.length) fail("legacy flat package truth blocks installation: " + legacy.join(", "));
}

function parseJsonObject(content, target) {
  try {
    const value = JSON.parse(content || "{}");
    if (!isObject(value)) fail(`${target} JSON root must be an object`);
    return value;
  } catch (error) {
    if (error instanceof DistributionError) throw error;
    fail(`${target} is not mergeable JSON: ${error.message}`);
  }
}

// Alternatives of a hook matcher; a pattern with parentheses counts as one alternative.
function matcherAlternatives(group) {
  const matcher = String(group?.matcher || "");
  return /[()]/u.test(matcher) ? [matcher] : matcher.split("|");
}

// Install and upgrade add every matcher alternative a product hook is missing, so a later product
// alternative (e.g. "Bash|PowerShell") also reaches an installation whose pre-install file listed the
// guard under "Bash" only. Existing groups and hooks are never changed, narrowed, reordered or removed;
// user hooks are never copied. A product hook only joins a group that holds nothing but product hooks.
export function mergeHooks(existingText, incomingText, target) {
  const existing = parseJsonObject(existingText, target);
  const incoming = parseJsonObject(incomingText, target);
  const output = structuredClone(existing);
  if (!isObject(output.hooks)) output.hooks = {};
  for (const field of ["extraKnownMarketplaces", "enabledPlugins"]) {
    if (!isObject(incoming[field])) continue;
    if (!isObject(output[field])) output[field] = {};
    for (const [key, value] of Object.entries(incoming[field])) {
      if (output[field][key] !== undefined && JSON.stringify(output[field][key]) !== JSON.stringify(value)) {
        fail(`${target} conflicts at ${field}.${key}`);
      }
      output[field][key] = structuredClone(value);
    }
  }
  const hooksOf = (group) => isObject(group) && Array.isArray(group.hooks) ? group.hooks : [];
  for (const [event, incomingGroups] of Object.entries(incoming.hooks || {})) {
    if (!Array.isArray(incomingGroups)) fail(`${target} incoming hooks.${event} is not an array`);
    if (!Array.isArray(output.hooks[event])) output.hooks[event] = [];
    const groups = output.hooks[event];
    const productCommands = new Set(incomingGroups.flatMap(hooksOf)
      .map((hook) => hook?.command).filter((command) => typeof command === "string"));
    for (const group of incomingGroups) {
      if (!isObject(group) || !Array.isArray(group.hooks)) fail(`${target} incoming hook group is malformed`);
      const wanted = matcherAlternatives(group);
      for (const hook of group.hooks) {
        if (typeof hook?.command !== "string") continue;
        const covered = new Set(groups
          .filter((item) => hooksOf(item).some((present) => present?.command === hook.command))
          .flatMap(matcherAlternatives));
        if (covered.has("") || covered.has("*")) continue;
        const missing = wanted.filter((alternative) => !covered.has(alternative));
        if (!missing.length) continue;
        const matcher = missing.join("|");
        const productGroup = groups.find((item) => isObject(item) && String(item.matcher || "") === matcher &&
          Array.isArray(item.hooks) && item.hooks.every((present) => productCommands.has(present?.command)));
        if (productGroup) productGroup.hooks.push(structuredClone(hook));
        else if (missing.length === wanted.length) groups.push({ ...structuredClone(group), hooks: [structuredClone(hook)] });
        else groups.push({ matcher, hooks: [structuredClone(hook)] });
      }
    }
  }
  if (incoming.statusLine !== undefined && output.statusLine === undefined) {
    output.statusLine = structuredClone(incoming.statusLine);
  }
  return JSON.stringify(output, null, 2) + "\n";
}

function mergeLines(existingText, incomingText) {
  const existing = existingText ? existingText.replace(/\r\n/g, "\n") : "";
  const lines = existing.split("\n");
  const present = new Set(lines);
  const additions = incomingText.replace(/\r\n/g, "\n").split("\n")
    .filter((line) => line && !present.has(line));
  if (!additions.length) return existing && !existing.endsWith("\n") ? existing + "\n" : existing;
  const prefix = existing && !existing.endsWith("\n") ? existing + "\n" : existing;
  return prefix + (prefix && !prefix.endsWith("\n\n") ? "\n" : "") + additions.join("\n") + "\n";
}

const onboardingFiles = {
  "OWNER.md": `# Owner contract: harness-onboarding
Schema: 1
Source: Keel Harness installer
Captured: <INSTALL_DATE>

## Original request

Configure this Harness instance only from Owner-confirmed values, keep credentials out of files, and prove the result locally before normal project work.

## Requirements

- R1 -> C1: The complete instance profile contains only Owner-confirmed values.
- R2 -> C2: The profile and tool landscape contain no onboarding marker or credential-shaped value.
`,
  "PACKAGE.md": `# Work package: harness-onboarding

**Problem:** Installation-specific Owner and project values are not confirmed yet.
**Intent:** Capture them once without changing the shared Harness contract.
**Goal:** The installed Harness instance profile and tool landscape contain only Owner-confirmed values and pass the local onboarding verifier.
**Scope:** Drin: the instance profile docs/harness-instance.md and the tool landscape docs/tool-landscape.md Nicht drin: the shared Harness contract and all project work, which live in their own packages
**Context:** Fresh installation by the Keel Harness installer; both files still carry onboarding markers until the Owner confirms each value.

## Plan

1. [ ] Confirm and record every installation-specific value.

## Status

The installer created this package before the first host session.

## Abnahme

- C1 -> gates/leaf-instance.md:PROFILE: The complete instance profile contains only Owner-confirmed values.
- C2 -> GATES.md:ONBOARDING: The profile and tool landscape contain no marker or credential-shaped value.

## Abschluss

Coverage: 2/2 contract outcomes mapped; 0/2 met.
Fulfillment: nicht erfuellt - Owner confirmation and local verification are pending.
Geprueft gegen: pending local Evidence.
Offen: onboarding leaf and integration.

## Anhang

### Depth Tree

- ROOT GATES.md <- none: Complete installed-instance outcome.
- LEAF gates/leaf-instance.md <- GATES.md: Owner-confirmed instance profile and tool inventory.
`,
  "GATES.md": `# Onboarding root gates

- [ ] ONBOARDING: installed instance is complete and credential-free
  CHECK: node checks/onboarding-ready.mjs --root . --mode all
  EXPECT: ONBOARDING READY
  EVIDENCE: pending
`,
  "gates/leaf-instance.md": `# Instance profile

OWNS: docs/harness-instance.md, docs/tool-landscape.md

- [ ] PROFILE: every installation-specific value is Owner-confirmed
  CHECK: node checks/onboarding-ready.mjs --root . --mode profile
  EXPECT: PROFILE READY
  EVIDENCE: pending
`,
};

function onboardingRoot(target) {
  return join(target, "docs", "packages", "harness-onboarding");
}

function onboardingExists(target) {
  const root = onboardingRoot(target);
  if (!existsSync(root)) return false;
  assertDirectoryNoLink(root, "harness-onboarding package");
  const owner = join(root, "OWNER.md");
  const packageFile = join(root, "PACKAGE.md");
  // withLf: the heading line of a CRLF checkout ends in \r\n and is still the installer's own package.
  if (!existsSync(owner) || !existsSync(packageFile) ||
      !withLf(readRegular(owner, "onboarding OWNER.md").content).toString("utf8").startsWith("# Owner contract: harness-onboarding\n") ||
      !withLf(readRegular(packageFile, "onboarding PACKAGE.md").content).toString("utf8").startsWith("# Work package: harness-onboarding\n")) {
    fail("docs/packages/harness-onboarding is owned by another or incomplete package");
  }
  return true;
}

function onboardingDefinitions(installDate) {
  return Object.entries(onboardingFiles).map(([local, value]) => ({
    target: `docs/packages/harness-onboarding/${local}`,
    mode: "generated-copy",
    content: Buffer.from(value.replaceAll("<INSTALL_DATE>", installDate), "utf8"),
    permission: 0o644,
    generated: true,
  }));
}

function ensureManagementRoot(target) {
  const paths = managementPaths(target);
  if (existsSync(paths.root)) assertDirectoryNoLink(paths.root, "distribution state directory");
  else {
    mkdirSync(paths.root, { mode: 0o700 });
    try { chmodSync(paths.root, 0o700); } catch { /* Windows ACLs are verified through target isolation. */ }
  }
  return paths;
}

function writeAtomicJson(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", { encoding: "utf8", mode: 0o600, flag: "wx" });
  try { chmodSync(temporary, 0o600); } catch { /* best effort on Windows */ }
  try { renameSync(temporary, path); }
  catch (error) {
    if (!existsSync(path)) throw error;
    unlinkSync(path);
    renameSync(temporary, path);
  }
}

function writeBuffer(path, content, mode = 0o600) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, content, { flag: "wx", mode });
  try { chmodSync(path, mode); } catch { /* best effort on Windows */ }
  const actual = readRegular(path, "staged file").content;
  if (!actual.equals(content)) fail(`staged file verification failed: ${path}`);
}

function copyBuffer(source, destination, expected, mode = 0o600) {
  mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
  copyFileSync(source, destination);
  try { chmodSync(destination, mode); } catch { /* best effort on Windows */ }
  const actual = readRegular(destination, "backup file").content;
  if (actual.length !== expected.bytes || sha256(actual) !== expected.sha256) {
    fail(`backup verification failed: ${destination}`);
  }
}

function safeRemoveTree(target, candidate, label) {
  const base = resolve(target);
  const full = resolve(candidate);
  if (folded(full) === folded(base) || !folded(full).startsWith(folded(base + sep))) {
    fail(`${label} cleanup escaped target: ${full}`);
  }
  if (existsSync(full)) rmSync(full, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
}

// Windows refuses to delete or rename a directory that is the working directory of a live process:
// rmSync empties the contents then fails with EPERM, and renameSync fails with EBUSY. The update helper
// up to 1.3.11 inherits the Dashboard server's working directory -- exactly the old runtime cache being
// cleaned -- and keeps running during the installer, so the first upgrade away from 1.3.10/1.3.11 must
// tolerate a stale cache a live process still stands in (proven 30.09.2026). The cache is renamed aside
// first (a name validateDashboardRuntimeCaches already accepts) and only then removed; a live process
// blocking the rename leaves the cache untouched, and a leftover .staging- rest is removed on the next
// run. Returns true when the cache is gone, false when it survived; other errors throw.
function removeStaleRuntimeCache(target, candidate) {
  const base = resolve(target);
  const full = resolve(candidate);
  if (folded(full) === folded(base) || !folded(full).startsWith(folded(base + sep))) {
    fail(`Dashboard runtime cache cleanup escaped target: ${full}`);
  }
  if (!existsSync(full)) return true;
  const blocking = (error) => ["EBUSY", "EPERM", "EACCES"].includes(error?.code);
  let staged = full;
  if (!basename(full).startsWith(".staging-")) {
    const sibling = join(dirname(full), `.staging-${process.pid}-${randomBytes(8).toString("hex")}`);
    try { renameSync(full, sibling); }
    catch (error) { if (blocking(error)) return false; throw error; }
    staged = sibling;
  }
  try { rmSync(staged, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 }); return true; }
  catch (error) { if (blocking(error)) return false; throw error; }
}

function assertSafeRuntimeTree(root) {
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      const info = lstatSync(full);
      if (info.isSymbolicLink()) fail(`Dashboard runtime cache contains a link: ${full}`);
      if (entry.isDirectory()) walk(full);
      else if (!entry.isFile()) fail(`Dashboard runtime cache contains a special file: ${full}`);
    }
  };
  walk(root);
}

function runtimeProcessAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error?.code === "EPERM"; }
}

function dashboardRuntimeLease(target) {
  const file = join(managementPaths(target).dashboardRuntime, "active.json");
  if (!existsSync(file)) return null;
  const value = readJsonFile(file, "Dashboard runtime lease");
  if (value?.schema !== "keel-dashboard-runtime-lease.v1" ||
      !/^[a-f0-9]{32}$/u.test(value.id || "") || !/^[a-f0-9]{64}$/u.test(value.treeSha256 || "") ||
      !Number.isSafeInteger(value.ownerPid) || value.ownerPid < 1 ||
      !(value.childPid === null || Number.isSafeInteger(value.childPid) && value.childPid > 0) ||
      typeof value.startedAt !== "string") fail("Dashboard runtime lease is malformed");
  return {
    file,
    value,
    active: runtimeProcessAlive(value.ownerPid) || runtimeProcessAlive(value.childPid),
  };
}

function assertNoActiveDashboardRuntime(target) {
  const lease = dashboardRuntimeLease(target);
  if (lease?.active) {
    fail(`Dashboard runtime is active (PID ${lease.value.childPid || lease.value.ownerPid}); stop it before install, upgrade, or uninstall`);
  }
}

function validateDashboardRuntimeCaches(target) {
  const paths = managementPaths(target);
  if (!existsSync(paths.runtime)) return;
  assertDirectoryNoLink(paths.runtime, "runtime cache root");
  for (const entry of readdirSync(paths.runtime, { withFileTypes: true })) {
    if (entry.name !== "dashboard" || !entry.isDirectory()) {
      fail(`unexpected managed runtime cache entry: ${entry.name}`);
    }
  }
  if (!existsSync(paths.dashboardRuntime)) return;
  assertDirectoryNoLink(paths.dashboardRuntime, "Dashboard runtime cache root");
  for (const entry of readdirSync(paths.dashboardRuntime, { withFileTypes: true })) {
    if (entry.name === "active.json") {
      if (!entry.isFile()) fail("Dashboard runtime lease is not a regular file");
      dashboardRuntimeLease(target);
      continue;
    }
    if (!entry.isDirectory() ||
        (!/^[a-f0-9]{64}$/u.test(entry.name) && !/^\.staging-\d+-[a-f0-9]{16}$/u.test(entry.name))) {
      fail(`unexpected Dashboard runtime cache entry: ${entry.name}`);
    }
    const full = join(paths.dashboardRuntime, entry.name);
    assertDirectoryNoLink(full, "Dashboard runtime cache");
    assertSafeRuntimeTree(full);
  }
}

function installedDashboardDigest(target) {
  const file = join(target, "dashboard", "runtime-manifest.json");
  if (!existsSync(file)) return null;
  const manifest = readJsonFile(file, "installed Dashboard runtime manifest");
  if (manifest?.schema !== "keel-dashboard-runtime-manifest.v1" ||
      !/^[a-f0-9]{64}$/u.test(manifest.treeSha256 || "")) {
    fail("installed Dashboard runtime manifest is malformed");
  }
  return manifest.treeSha256;
}

// Returns the names of runtime caches that could not be removed. Install, upgrade and the same-version
// no-op pass a keepDigest and tolerate a stale cache a live pre-1.3.12 update helper still stands in
// (see removeStaleRuntimeCache); the lease file and the uninstall call (no keepDigest) stay strict.
function cleanupDashboardRuntimeCaches(target, keepDigest = null) {
  const paths = managementPaths(target);
  validateDashboardRuntimeCaches(target);
  if (!existsSync(paths.dashboardRuntime)) return [];
  assertNoActiveDashboardRuntime(target);
  const retained = [];
  for (const entry of readdirSync(paths.dashboardRuntime, { withFileTypes: true })) {
    if (keepDigest && entry.name === keepDigest) continue;
    const full = join(paths.dashboardRuntime, entry.name);
    if (keepDigest && entry.isDirectory()) {
      if (!removeStaleRuntimeCache(target, full)) retained.push(entry.name);
    } else {
      safeRemoveTree(target, full, "Dashboard runtime cache");
    }
  }
  try { rmdirSync(paths.dashboardRuntime); } catch { /* current digest or concurrent non-empty cache retained */ }
  try { rmdirSync(paths.runtime); } catch { /* current Dashboard cache retained */ }
  return retained;
}

function removeEmptyParents(target, targets) {
  const candidates = new Set();
  for (const item of targets) {
    let current = dirname(inside(target, item));
    while (folded(current) !== folded(target)) {
      if (folded(current) === folded(join(target, MANAGEMENT_DIRECTORY))) break;
      candidates.add(current);
      current = dirname(current);
    }
  }
  for (const directory of [...candidates].sort((left, right) => right.length - left.length)) {
    try { rmdirSync(directory); } catch { /* non-empty or concurrently retained */ }
  }
}

function readJsonFile(path, label) {
  let value;
  try { value = JSON.parse(readRegular(path, label).content.toString("utf8")); }
  catch (error) {
    if (error instanceof DistributionError) throw error;
    fail(`${label} is invalid JSON: ${error.message}`);
  }
  return value;
}

function validateState(target, state) {
  if (!isObject(state) || state.schema !== STATE_SCHEMA || state.product?.id !== "keel-harness" ||
      !/^\d+\.\d+\.\d+$/u.test(state.product?.version || "") || !Array.isArray(state.entries) ||
      typeof state.backupRoot !== "string") {
    fail("installed distribution state is malformed");
  }
  const backupRoot = resolve(managementPaths(target).root, ...state.backupRoot.split("/"));
  if (dirname(backupRoot) !== managementPaths(target).backups) fail("installed backup root escapes managed backups");
  const keys = new Set();
  for (const entry of state.entries) {
    const item = normalizeTarget(entry?.target);
    if (keys.has(item.toLowerCase())) fail(`duplicate installed state target: ${item}`);
    keys.add(item.toLowerCase());
    if (!isObject(entry.installed) || !/^[a-f0-9]{64}$/u.test(entry.installed.sha256 || "") ||
        !Number.isSafeInteger(entry.installed.bytes) || !isObject(entry.original) ||
        typeof entry.original.existed !== "boolean") fail(`malformed installed state entry: ${item}`);
    const ownership = targetOwnership(item);
    const widened = entry.ownership === "distribution" && ownership === "owner" &&
      OWNERSHIP_WIDENED_TO_OWNER.has(item);
    if (entry.ownership !== undefined && entry.ownership !== ownership && !widened) {
      fail(`installed state assigns invalid ownership to ${item}`);
    }
    if (entry.preserveOnUninstall !== undefined && typeof entry.preserveOnUninstall !== "boolean") {
      fail(`installed state has invalid uninstall preservation for ${item}`);
    }
    if (entry.preserveOnUninstall === true && !isLocallyMutable({ ownership })) {
      fail(`immutable installed state cannot opt out of uninstall restoration: ${item}`);
    }
    entry.ownership = ownership;
    entry.preserveOnUninstall = Boolean(entry.preserveOnUninstall);
    if (entry.original.existed) {
      if (!/^[a-f0-9]{64}$/u.test(entry.original.sha256 || "") ||
          !Number.isSafeInteger(entry.original.bytes) || typeof entry.original.backup !== "string") {
        fail(`malformed original backup state: ${item}`);
      }
      const backup = resolve(managementPaths(target).root, ...entry.original.backup.split("/"));
      if (!folded(backup).startsWith(folded(managementPaths(target).backups + sep))) {
        fail(`backup path escapes managed backup root: ${item}`);
      }
    } else if (entry.original.backup !== null) fail(`created target has an unexpected backup: ${item}`);
  }
  return state;
}

function readState(target) {
  const paths = managementPaths(target);
  if (!existsSync(paths.root)) return null;
  assertDirectoryNoLink(paths.root, "distribution state directory");
  if (!existsSync(paths.state)) return null;
  return validateState(target, readJsonFile(paths.state, "installed distribution state"));
}

function pendingTransactions(target) {
  const paths = managementPaths(target);
  if (!existsSync(paths.transactions)) return [];
  assertDirectoryNoLink(paths.transactions, "transaction directory");
  return readdirSync(paths.transactions, { withFileTypes: true })
    .map((entry) => {
      if (!entry.isDirectory() || entry.isSymbolicLink()) fail("transaction root contains a non-directory entry");
      const root = join(paths.transactions, entry.name);
      const journal = join(root, "journal.json");
      if (!existsSync(journal)) fail(`transaction ${entry.name} has no journal`);
      return { id: entry.name, root, journal, value: readJsonFile(journal, `transaction ${entry.name}`) };
    })
    .sort((left, right) => left.id.localeCompare(right.id, "en"));
}

function originalBuffer(target, entry) {
  if (!entry.original.existed) return null;
  const root = managementPaths(target).root;
  const path = resolve(root, ...entry.original.backup.split("/"));
  const value = readRegular(path, `backup for ${entry.target}`).content;
  if (value.length !== entry.original.bytes || sha256(value) !== entry.original.sha256) {
    fail(`backup drift for ${entry.target}`);
  }
  return value;
}

function matchesInstalled(current, entry) {
  if (!current.exists) return false;
  if (current.content.length === entry.installed.bytes && sha256(current.content) === entry.installed.sha256) return true;
  // The same delivered text after a CRLF checkout is not drift (see sameTextContent).
  const lf = withLf(current.content);
  return lf.length === entry.installed.bytes && sha256(lf) === entry.installed.sha256;
}

function inspectManagedState(target, state) {
  const drift = [];
  const localChanges = [];
  const backupErrors = [];
  for (const entry of state.entries) {
    try {
      const current = readTarget(target, entry.target);
      const matches = matchesInstalled(current, entry);
      if (!current.exists) drift.push(entry.target);
      else if (!matches && isLocallyMutable(entry)) localChanges.push(entry.target);
      else if (!matches) drift.push(entry.target);
    } catch (error) { drift.push(`${entry.target}: ${error.message}`); }
    if (entry.original.existed) {
      try { originalBuffer(target, entry); }
      catch (error) { backupErrors.push(`${entry.target}: ${error.message}`); }
    }
  }
  return { drift, localChanges, backupErrors };
}

function semver(value) {
  if (!/^\d+\.\d+\.\d+$/u.test(value)) fail(`unsupported semantic version: ${value}`);
  return value.split(".").map(Number);
}

function compareVersions(left, right) {
  const a = semver(left);
  const b = semver(right);
  for (let index = 0; index < 3; index++) if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  return 0;
}

function desiredContent(definition, baseline, options, alreadyManaged) {
  const existing = baseline?.content || null;
  const incoming = definition.content;
  let desired;
  if (definition.mode === "copy" || definition.mode === "generated-copy") desired = incoming;
  else if (definition.mode === "merge-lines") {
    desired = Buffer.from(mergeLines(existing?.toString("utf8") || "", incoming.toString("utf8")), "utf8");
  } else if (definition.mode === "merge-hooks") {
    desired = Buffer.from(mergeHooks(existing?.toString("utf8") || "{}", incoming.toString("utf8"), definition.target), "utf8");
  } else fail(`unsupported install mode ${definition.mode}`);
  if (definition.target === ".gitignore") {
    desired = Buffer.from(mergeLines(desired.toString("utf8"), `${MANAGEMENT_DIRECTORY}/\n`), "utf8");
  }
  const conflict = existing && definition.mode === "copy" && !alreadyManaged && !options.force && !sameTextContent(existing, desired)
    ? definition.target : null;
  return { desired, conflict };
}

function artifactDefinitions(artifact) {
  return artifact.installFiles.map((entry) => ({
    target: entry.target, mode: entry.mode, content: entry.content,
    permission: entry.permission || 0o644, generated: false,
  }));
}

function operation(target, definition, before, uninstallOriginal, desired, keepManaged, preserveOnUninstall = false) {
  const ownership = targetOwnership(definition.target);
  if (preserveOnUninstall && !isLocallyMutable({ ownership })) {
    fail(`immutable target cannot opt out of uninstall restoration: ${definition.target}`);
  }
  return {
    target: definition.target,
    entryMode: definition.mode,
    generated: Boolean(definition.generated),
    ownership,
    preserveOnUninstall: Boolean(preserveOnUninstall),
    before: before.content,
    beforeMode: before.mode || 0o644,
    uninstallOriginal: uninstallOriginal.content,
    uninstallMode: uninstallOriginal.mode || 0o644,
    desired,
    desiredMode: before.exists ? before.mode : definition.permission || 0o644,
    keepManaged,
  };
}

function freshPlan(target, artifact, options) {
  if (pendingTransactions(target).length) fail("unfinished transaction exists; run rollback before install");
  const paths = managementPaths(target);
  if (existsSync(paths.root)) fail(`unowned or incomplete ${MANAGEMENT_DIRECTORY}/ state blocks installation; run doctor or rollback`);
  assertNoLegacy(target);
  const hasOnboarding = onboardingExists(target);
  const installDate = new Date().toISOString().slice(0, 10);
  const definitions = artifactDefinitions(artifact);
  if (!hasOnboarding) definitions.push(...onboardingDefinitions(installDate));
  definitions.sort((left, right) => left.target.localeCompare(right.target, "en"));
  const operations = [];
  const conflicts = [];
  for (const definition of definitions) {
    const before = readTarget(target, definition.target);
    try {
      const result = isLocallyMutable(definition.target) && before.exists
        ? { desired: before.content, conflict: null }
        : desiredContent(definition, before, options, false);
      if (result.conflict) conflicts.push(result.conflict);
      operations.push(operation(target, definition, before, before, result.desired, true));
    } catch (error) { conflicts.push(`${definition.target}: ${error.message}`); }
  }
  if (conflicts.length) fail("existing files differ; no writes performed (use --force): " + conflicts.join(", "), { conflicts });
  return { kind: "install", operations, installDate, previousState: null, previousBackupRoot: null };
}

function upgradePlan(target, artifact, state, options) {
  const health = inspectManagedState(target, state);
  if (health.drift.length || health.backupErrors.length) {
    fail("managed files or backups drifted; upgrade is unsafe", health);
  }
  const comparison = compareVersions(state.product.version, artifact.manifest.product.version);
  if (comparison === 0) {
    if (state.manifestDigest !== artifact.manifestDigest) {
      fail("artifact changed without a product version bump");
    }
    return { noOp: true, state, health };
  }
  if (comparison > 0) fail("downgrade is not supported; uninstall explicitly first");
  if (!options.upgrade) fail(`installed ${state.product.version}; rerun with --upgrade for ${artifact.manifest.product.version}`);
  assertNoLegacy(target);
  const previous = new Map(state.entries.map((entry) => [entry.target, entry]));
  const installDate = String(state.installedAt || "").slice(0, 10) || new Date().toISOString().slice(0, 10);
  const definitions = artifactDefinitions(artifact);
  const ownedOnboarding = state.entries.some((entry) => entry.target.startsWith("docs/packages/harness-onboarding/"));
  if (ownedOnboarding) definitions.push(...onboardingDefinitions(installDate));
  else onboardingExists(target);
  const definitionTargets = new Set(definitions.map((entry) => entry.target));
  const operations = [];
  const conflicts = [];
  for (const definition of definitions.sort((left, right) => left.target.localeCompare(right.target, "en"))) {
    const before = readTarget(target, definition.target);
    const previousEntry = previous.get(definition.target);
    const locallyMutable = isLocallyMutable(definition.target);
    const preserveOnUninstall = Boolean(previousEntry?.preserveOnUninstall ||
      previousEntry && locallyMutable && !matchesInstalled(before, previousEntry));
    let uninstallOriginal;
    if (previousEntry) {
      const content = originalBuffer(target, previousEntry);
      uninstallOriginal = { exists: previousEntry.original.existed, content, mode: previousEntry.original.mode || 0o644 };
    } else uninstallOriginal = before;
    try {
      const result = locallyMutable && before.exists
        ? { desired: before.content, conflict: null }
        : desiredContent(definition, uninstallOriginal, options, Boolean(previousEntry));
      if (result.conflict) conflicts.push(result.conflict);
      operations.push(operation(target, definition, before, uninstallOriginal, result.desired, true, preserveOnUninstall));
    } catch (error) { conflicts.push(`${definition.target}: ${error.message}`); }
  }
  for (const entry of state.entries.filter((item) => !definitionTargets.has(item.target))
    .sort((left, right) => left.target.localeCompare(right.target, "en"))) {
    const before = readTarget(target, entry.target);
    const content = originalBuffer(target, entry);
    const definition = { target: entry.target, mode: "restore-removed", generated: false, permission: entry.original.mode || 0o644 };
    const original = { exists: entry.original.existed, content, mode: entry.original.mode || 0o644 };
    const preserveOnUninstall = Boolean(entry.preserveOnUninstall ||
      isLocallyMutable(entry) && !matchesInstalled(before, entry));
    operations.push(operation(target, definition, before, original,
      preserveOnUninstall ? before.content : content, false, preserveOnUninstall));
  }
  if (conflicts.length) fail("upgrade conflicts; no writes performed: " + conflicts.join(", "), { conflicts });
  return { kind: "upgrade", operations, installDate, previousState: state };
}

function stateBackupRoot(target, state) {
  if (!state?.backupRoot) return null;
  const root = resolve(managementPaths(target).root, ...state.backupRoot.split("/"));
  if (dirname(root) !== managementPaths(target).backups) fail("installed backup root escapes managed backups");
  return root;
}

function transactionLock(target) {
  const path = managementPaths(target).lock;
  if (!existsSync(path)) return { present: false, alive: false, pid: null };
  let value;
  try { value = readJsonFile(path, "distribution transaction lock"); }
  catch (error) { return { present: true, alive: true, pid: null, error: error.message }; }
  const pid = Number(value.pid);
  if (!Number.isInteger(pid) || pid <= 0) return { present: true, alive: true, pid: null, error: "invalid pid" };
  try {
    process.kill(pid, 0);
    return { present: true, alive: true, pid };
  } catch (error) {
    if (error.code === "ESRCH") return { present: true, alive: false, pid };
    return { present: true, alive: true, pid, error: error.code || error.message };
  }
}

function acquireLock(paths, command) {
  if (existsSync(paths.lock)) fail("distribution transaction lock exists; run doctor or rollback");
  const fd = openSync(paths.lock, "wx", 0o600);
  try { writeFileSync(fd, JSON.stringify({ schema: 1, pid: process.pid, command }) + "\n", "utf8"); }
  finally { closeSync(fd); }
}

function releaseLock(paths) {
  if (existsSync(paths.lock)) unlinkSync(paths.lock);
}

function relativeFrom(root, path) {
  return relative(root, path).replaceAll("\\", "/");
}

function journalOperation(operationValue, transactionRoot, backupRoot, managementRoot) {
  return {
    target: operationValue.target,
    entryMode: operationValue.entryMode,
    generated: operationValue.generated,
    ownership: operationValue.ownership,
    preserveOnUninstall: operationValue.preserveOnUninstall,
    before: fileShape(operationValue.before, operationValue.beforeMode),
    desired: fileShape(operationValue.desired, operationValue.desiredMode),
    uninstallOriginal: fileShape(operationValue.uninstallOriginal, operationValue.uninstallMode),
    keepManaged: operationValue.keepManaged,
    rollbackBackup: operationValue.before === null ? null : relativeFrom(transactionRoot,
      inside(join(transactionRoot, "rollback"), operationValue.target)),
    persistentBackup: operationValue.keepManaged && operationValue.uninstallOriginal !== null
      ? relativeFrom(managementRoot, inside(backupRoot, operationValue.target)) : null,
    stage: operationValue.desired === null ? null : relativeFrom(transactionRoot,
      inside(join(transactionRoot, "stage"), operationValue.target)),
    promotion: sameContent(operationValue.before, operationValue.desired) ? "unchanged" : "pending",
  };
}

function testInjection(target, event, count = null) {
  const spec = process.env.KEEL_HARNESS_TEST_FAILURE || "";
  if (!spec) return;
  if (process.env.KEEL_HARNESS_TESTING !== "1") fail("test failure injection requires KEEL_HARNESS_TESTING=1");
  const temp = realpathSync.native(tmpdir());
  const actual = realpathSync.native(target);
  if (folded(actual) !== folded(temp) && !folded(actual).startsWith(folded(temp + sep))) {
    fail("test failure injection is restricted to the operating-system temp directory");
  }
  if (spec === event || (count !== null && spec === `${event}:${count}`)) {
    throw new DistributionError(`injected ${event}${count === null ? "" : `:${count}`} failure`);
  }
  if (event === "promote" && count !== null && spec === `crash:${count}`) process.exit(86);
}

function currentMatches(root, target, shape) {
  const current = readTarget(root, target);
  if (!shape.exists) return !current.exists;
  return current.exists && current.content.length === shape.bytes && sha256(current.content) === shape.sha256;
}

function promoteOperation(target, transactionRoot, entry) {
  if (entry.promotion === "unchanged") return;
  if (!currentMatches(target, entry.target, entry.before)) {
    fail(`target changed after preflight: ${entry.target}`);
  }
  const destination = inside(target, entry.target);
  mkdirSync(dirname(destination), { recursive: true });
  const quarantine = inside(join(transactionRoot, "quarantine"), entry.target);
  if (entry.before.exists) {
    mkdirSync(dirname(quarantine), { recursive: true, mode: 0o700 });
    renameSync(destination, quarantine);
    entry.promotion = "quarantined";
  }
  if (entry.desired.exists) {
    const stage = resolve(transactionRoot, ...entry.stage.split("/"));
    renameSync(stage, destination);
    try { chmodSync(destination, entry.desired.mode || 0o644); } catch { /* best effort on Windows */ }
  }
  entry.promotion = "promoted";
}

function verifyShape(target, entry, field) {
  const shape = entry[field];
  if (!currentMatches(target, entry.target, shape)) fail(`${field} verification failed: ${entry.target}`);
}

function assertPluginProjectScope(target) {
  const helper = join(target, "harness-core", "execution", "codex-plugin-bootstrap.mjs");
  const source = readRegular(helper, "Codex plugin bootstrap").content.toString("utf8");
  const projectScopes = [...source.matchAll(/"--scope",\s*"project"/gu)].length;
  if (projectScopes < 2 || /"--scope",\s*"(?:user|global)"/u.test(source)) {
    fail("Codex plugin bootstrap is not exclusively project-scoped");
  }
  return helper;
}

function runPluginInstall(target, options) {
  const helper = assertPluginProjectScope(target);
  const args = [helper, "apply", "--yes", "--root", target, "--harness-root", target];
  if (options.claude) args.push("--claude", options.claude);
  const result = spawnSync(process.execPath, args, {
    cwd: target, encoding: "utf8", windowsHide: true, timeout: 120_000,
  });
  if (result.status !== 0) fail("official project-scoped Codex plugin install failed: " +
    String(result.stderr || result.stdout).trim());
}

function runPluginUninstall(target, options) {
  const executable = options.claude || "claude";
  const failures = [];
  for (const args of [
    ["plugin", "uninstall", PLUGIN, "--scope", "project"],
    ["plugin", "marketplace", "remove", MARKETPLACE, "--scope", "project"],
  ]) {
    const result = spawnSync(executable, args, {
      cwd: target, encoding: "utf8", windowsHide: true, timeout: 120_000,
    });
    if (result.status !== 0) failures.push(`${args.slice(0, 3).join(" ")}: ` +
      String(result.stderr || result.stdout || result.error?.message).trim());
  }
  if (failures.length) fail("project-scoped Codex plugin uninstall failed: " + failures.join("; "));
}

function restoreStateFile(target, journal, transactionRoot) {
  const paths = managementPaths(target);
  const stateBefore = join(transactionRoot, "state-before.json");
  if (journal.stateBefore) {
    if (!existsSync(stateBefore)) fail("transaction lost its previous state backup");
    const value = readRegular(stateBefore, "previous state backup").content;
    writeAtomicJson(paths.state, JSON.parse(value.toString("utf8")));
  } else if (existsSync(paths.state) && journal.kind === "install") unlinkSync(paths.state);
}

function rollbackJournal(target, item, { cleanup = true } = {}) {
  const journal = item.value || item;
  const transactionRoot = item.root || resolve(managementPaths(target).transactions, journal.id);
  if (journal.schema !== TRANSACTION_SCHEMA || !Array.isArray(journal.operations)) {
    fail("transaction journal is malformed");
  }
  if (journal.phase === "committed") {
    if (cleanup) safeRemoveTree(target, transactionRoot, "committed transaction");
    return { restored: 0, committed: true };
  }
  let externalError = null;
  if (journal.external?.action === "plugin-install" && journal.external.status !== "compensated") {
    try {
      runPluginUninstall(target, { claude: journal.external.executable });
      journal.external.status = "compensated";
      delete journal.external.error;
    } catch (error) {
      externalError = error;
      journal.external.status = "compensation-failed";
      journal.external.error = error.message;
    }
  }
  journal.phase = "rolling-back";
  writeAtomicJson(join(transactionRoot, "journal.json"), journal);
  let restored = 0;
  for (const entry of [...journal.operations].reverse()) {
    if (currentMatches(target, entry.target, entry.before)) continue;
    const destination = inside(target, entry.target);
    if (existsSync(destination)) {
      const info = lstatSync(destination);
      if (!info.isFile() || info.isSymbolicLink()) fail(`rollback target became unsafe: ${entry.target}`);
      unlinkSync(destination);
    }
    if (entry.before.exists) {
      const quarantine = inside(join(transactionRoot, "quarantine"), entry.target);
      mkdirSync(dirname(destination), { recursive: true });
      if (existsSync(quarantine)) renameSync(quarantine, destination);
      else {
        const backup = resolve(transactionRoot, ...entry.rollbackBackup.split("/"));
        copyBuffer(backup, destination, entry.before, entry.before.mode || 0o644);
      }
      try { chmodSync(destination, entry.before.mode || 0o644); } catch { /* best effort on Windows */ }
    }
    restored += 1;
  }
  for (const entry of journal.operations) verifyShape(target, entry, "before");
  restoreStateFile(target, journal, transactionRoot);
  if (journal.external?.action === "plugin-uninstall" && journal.external.status !== "compensated") {
    try {
      runPluginInstall(target, { claude: journal.external.executable });
      journal.external.status = "compensated";
      delete journal.external.error;
    } catch (error) {
      externalError = error;
      journal.external.status = "compensation-failed";
      journal.external.error = error.message;
    }
  }
  if (journal.newBackupRoot) {
    const backup = resolve(managementPaths(target).root, ...journal.newBackupRoot.split("/"));
    safeRemoveTree(target, backup, "rolled-back backup");
  }
  if (externalError) {
    journal.phase = "rollback-external-failed";
    journal.filesystemRollbackVerified = true;
    journal.rollbackVerified = false;
    writeAtomicJson(join(transactionRoot, "journal.json"), journal);
    fail(`project plugin compensation failed after verified filesystem rollback: ${externalError.message}`);
  }
  journal.phase = "rolled-back";
  journal.rollbackVerified = true;
  writeAtomicJson(join(transactionRoot, "journal.json"), journal);
  if (cleanup) safeRemoveTree(target, transactionRoot, "rolled-back transaction");
  removeEmptyParents(target, journal.operations.map((entry) => entry.target));
  return { restored, committed: false };
}

function cleanupManagement(target) {
  const paths = managementPaths(target);
  cleanupDashboardRuntimeCaches(target);
  for (const directory of [paths.transactions, paths.backups]) {
    if (existsSync(directory)) {
      try { rmdirSync(directory); } catch { /* retained state or recovery data */ }
    }
  }
  if (existsSync(paths.root)) {
    try { rmdirSync(paths.root); } catch { /* retained state or recovery data */ }
  }
}

function executeTransaction(target, artifact, plan, options) {
  const paths = ensureManagementRoot(target);
  acquireLock(paths, plan.kind);
  const transactionId = `${Date.now()}-${process.pid}-${randomBytes(6).toString("hex")}`;
  const transactionRoot = join(paths.transactions, transactionId);
  const newInstallationId = plan.kind === "uninstall" ? null : transactionId;
  const newBackupRoot = newInstallationId ? join(paths.backups, newInstallationId) : null;
  mkdirSync(transactionRoot, { recursive: true, mode: 0o700 });
  if (newBackupRoot) mkdirSync(newBackupRoot, { recursive: true, mode: 0o700 });
  const previousState = plan.previousState;
  const stateBeforePath = join(transactionRoot, "state-before.json");
  if (previousState) writeBuffer(stateBeforePath, Buffer.from(JSON.stringify(previousState, null, 2) + "\n"), 0o600);
  const journal = {
    schema: TRANSACTION_SCHEMA,
    id: transactionId,
    kind: plan.kind,
    product: artifact.manifest.product,
    manifestDigest: artifact.manifestDigest,
    phase: "preparing",
    createdAt: new Date().toISOString(),
    stateBefore: Boolean(previousState),
    newBackupRoot: newBackupRoot ? relativeFrom(paths.root, newBackupRoot) : null,
    operations: [],
  };
  try {
    const orderedOperations = [...plan.operations].sort((left, right) => {
      if (left.target === ".gitignore") return plan.kind === "uninstall" ? 1 : -1;
      if (right.target === ".gitignore") return plan.kind === "uninstall" ? -1 : 1;
      return left.target.localeCompare(right.target, "en");
    });
    for (const value of orderedOperations) {
      const entry = journalOperation(value, transactionRoot, newBackupRoot || join(paths.backups, "none"), paths.root);
      journal.operations.push(entry);
    }
    writeAtomicJson(join(transactionRoot, "journal.json"), journal);
    for (let index = 0; index < orderedOperations.length; index++) {
      const value = orderedOperations[index];
      const entry = journal.operations[index];
      if (value.before !== null) {
        const path = inside(join(transactionRoot, "rollback"), value.target);
        writeBuffer(path, value.before, 0o600);
      }
      if (value.desired !== null) {
        const path = inside(join(transactionRoot, "stage"), value.target);
        writeBuffer(path, value.desired, value.desiredMode || 0o644);
      }
      if (newBackupRoot && value.keepManaged && value.uninstallOriginal !== null) {
        const path = inside(newBackupRoot, value.target);
        writeBuffer(path, value.uninstallOriginal, 0o600);
      }
    }
    journal.phase = "prepared";
    writeAtomicJson(join(transactionRoot, "journal.json"), journal);
    let promotions = 0;
    journal.phase = "promoting";
    writeAtomicJson(join(transactionRoot, "journal.json"), journal);
    for (const entry of journal.operations) {
      if (entry.promotion === "unchanged") continue;
      promoteOperation(target, transactionRoot, entry);
      promotions += 1;
      // Recovery never trusts this progress flag: rollback compares every live
      // file with its journaled before/desired hashes and restores quarantine.
      // Batching therefore remains crash-safe while avoiding O(files^2) journal
      // rewrites for the compiled Dashboard runtime.
      if (promotions % PROMOTION_JOURNAL_BATCH === 0) {
        writeAtomicJson(join(transactionRoot, "journal.json"), journal);
      }
      testInjection(target, "promote", promotions);
    }
    journal.phase = "promoted";
    writeAtomicJson(join(transactionRoot, "journal.json"), journal);

    if (plan.kind === "uninstall" && previousState?.plugin?.codexProjectInstalled) {
      journal.external = {
        action: "plugin-uninstall", executable: options.claude || "claude", status: "attempting",
      };
      journal.phase = "external";
      writeAtomicJson(join(transactionRoot, "journal.json"), journal);
      runPluginUninstall(target, options);
      journal.external.status = "applied";
      writeAtomicJson(join(transactionRoot, "journal.json"), journal);
    } else if (options.installCodexPlugin) {
      testInjection(target, "plugin");
      journal.external = {
        action: "plugin-install", executable: options.claude || "claude", status: "attempting",
      };
      journal.phase = "external";
      writeAtomicJson(join(transactionRoot, "journal.json"), journal);
      runPluginInstall(target, options);
      journal.external.status = "applied";
      writeAtomicJson(join(transactionRoot, "journal.json"), journal);
    }
    for (const entry of journal.operations) verifyShape(target, entry, "desired");

    let state = null;
    if (plan.kind !== "uninstall") {
      const entries = journal.operations.filter((entry) => entry.keepManaged).map((entry) => ({
        target: entry.target,
        entryMode: entry.entryMode,
        generated: entry.generated,
        ownership: entry.ownership,
        preserveOnUninstall: entry.preserveOnUninstall,
        installed: entry.desired,
        original: {
          existed: entry.uninstallOriginal.exists,
          bytes: entry.uninstallOriginal.bytes,
          sha256: entry.uninstallOriginal.sha256,
          mode: entry.uninstallOriginal.mode,
          backup: entry.uninstallOriginal.exists ? entry.persistentBackup : null,
        },
      }));
      state = {
        schema: STATE_SCHEMA,
        product: artifact.manifest.product,
        manifestDigest: artifact.manifestDigest,
        backupRoot: relativeFrom(paths.root, newBackupRoot),
        installedAt: new Date().toISOString(),
        installDate: plan.installDate,
        plugin: { codexProjectInstalled: Boolean(options.installCodexPlugin || previousState?.plugin?.codexProjectInstalled) },
        entries,
      };
      writeAtomicJson(paths.state, state);
    } else if (existsSync(paths.state)) unlinkSync(paths.state);
    let retainedRuntimeCaches = [];
    if (plan.kind === "uninstall") cleanupDashboardRuntimeCaches(target);
    else retainedRuntimeCaches = cleanupDashboardRuntimeCaches(target, installedDashboardDigest(target));
    journal.phase = "committed";
    journal.committedAt = new Date().toISOString();
    writeAtomicJson(join(transactionRoot, "journal.json"), journal);

    const previousBackupRoot = stateBackupRoot(target, previousState);
    if (previousBackupRoot && (!newBackupRoot || folded(previousBackupRoot) !== folded(newBackupRoot))) {
      safeRemoveTree(target, previousBackupRoot, "superseded backup");
    }
    safeRemoveTree(target, transactionRoot, "committed transaction");
    releaseLock(paths);
    if (plan.kind === "uninstall") {
      removeEmptyParents(target, journal.operations.map((entry) => entry.target));
      cleanupManagement(target);
    }
    return {
      command: plan.kind,
      state: plan.kind === "uninstall" ? "not-installed" : "installed",
      product: artifact.manifest.product,
      promotions,
      managedFiles: state?.entries.length || 0,
      rollback: "available",
      plugin: options.installCodexPlugin ? "project-installed" : previousState?.plugin?.codexProjectInstalled ? "project-preserved" : "declared",
      ...(retainedRuntimeCaches.length ? { retainedRuntimeCaches } : {}),
    };
  } catch (error) {
    let rollback;
    try { rollback = rollbackJournal(target, { root: transactionRoot, value: journal }); }
    catch (rollbackError) {
      releaseLock(paths);
      throw new DistributionError(`${error.message}; rollback failed: ${rollbackError.message}`, {
        rollback: "failed", transaction: transactionId,
      });
    }
    releaseLock(paths);
    if (!previousState) cleanupManagement(target);
    throw new DistributionError(`${error.message}; rollback=verified`, {
      rollback: "verified", restored: rollback.restored,
    });
  }
}

export function installDistribution({ distributionRoot, target: targetValue, ...options }) {
  const artifact = loadVerifiedArtifact(distributionRoot);
  const target = assertRepository(targetValue);
  const state = readState(target);
  if (state) {
    validateDashboardRuntimeCaches(target);
    assertNoActiveDashboardRuntime(target);
  }
  let plan;
  if (state) plan = upgradePlan(target, artifact, state, options);
  else plan = freshPlan(target, artifact, options);
  if (plan.noOp) {
    const retainedRuntimeCaches = cleanupDashboardRuntimeCaches(target, installedDashboardDigest(target));
    return {
      command: "install", state: "installed", noOp: true,
      product: artifact.manifest.product, promotions: 0, managedFiles: state.entries.length,
      plugin: state.plugin?.codexProjectInstalled ? "project-installed" : "declared",
      ...(retainedRuntimeCaches.length ? { retainedRuntimeCaches } : {}),
    };
  }
  const changed = plan.operations.filter((entry) => !sameContent(entry.before, entry.desired)).length;
  if (options.dryRun) {
    return {
      command: plan.kind, state: "planned", dryRun: true, product: artifact.manifest.product,
      changedFiles: changed, managedFiles: plan.operations.filter((entry) => entry.keepManaged).length,
      conflicts: 0, writes: 0,
    };
  }
  return executeTransaction(target, artifact, plan, options);
}

function uninstallPlan(target, state, options) {
  const operations = [];
  const conflicts = [];
  const current = new Map(state.entries.map((entry) => [entry.target, readTarget(target, entry.target)]));
  const preserveOnboardingBundle = state.entries.some((entry) =>
    entry.ownership === "lifecycle" && current.get(entry.target).exists &&
    (entry.preserveOnUninstall || !matchesInstalled(current.get(entry.target), entry)));
  for (const entry of [...state.entries].sort((left, right) => left.target.localeCompare(right.target, "en"))) {
    const before = current.get(entry.target);
    const matches = matchesInstalled(before, entry);
    const locallyMutable = isLocallyMutable(entry);
    if ((!before.exists || !locallyMutable && !matches) && !options.force) conflicts.push(entry.target);
    const original = originalBuffer(target, entry);
    const definition = {
      target: entry.target, mode: entry.entryMode || "restore", generated: entry.generated,
      permission: entry.original.mode || 0o644,
    };
    const uninstallOriginal = { exists: entry.original.existed, content: original, mode: entry.original.mode || 0o644 };
    const preserveCurrent = before.exists && (
      locallyMutable && (entry.preserveOnUninstall || !matches) ||
      preserveOnboardingBundle && entry.target.startsWith("docs/packages/harness-onboarding/") && matches
    );
    operations.push(operation(target, definition, before, uninstallOriginal,
      preserveCurrent ? before.content : original, false,
      locallyMutable && preserveCurrent));
  }
  if (conflicts.length) fail("managed files drifted; no uninstall writes performed (use --force): " + conflicts.join(", "), { conflicts });
  return { kind: "uninstall", operations, previousState: state, installDate: state.installDate };
}

export function uninstallDistribution({ distributionRoot, target: targetValue, ...options }) {
  const target = assertRepository(targetValue);
  const pending = pendingTransactions(target);
  if (pending.length) fail("unfinished transaction exists; run rollback before uninstall");
  const state = readState(target);
  if (!state) {
    cleanupManagement(target);
    return withRuntimeActivation(
      withAccountabilityData({ command: "uninstall", state: "not-installed", noOp: true, promotions: 0 }, targetValue),
      target, false);
  }
  validateDashboardRuntimeCaches(target);
  assertNoActiveDashboardRuntime(target);
  const artifact = { manifest: { product: state.product }, manifestDigest: state.manifestDigest };
  const plan = uninstallPlan(target, state, options);
  if (options.dryRun) {
    return withRuntimeActivation(withAccountabilityData({ command: "uninstall", state: "planned", dryRun: true,
      changedFiles: plan.operations.filter((entry) => !sameContent(entry.before, entry.desired)).length,
      writes: 0, conflicts: 0 }, targetValue), target, false);
  }
  // The transaction restores the repository tree; clearing the runtime activation pointers and the
  // installer's system profile runs after it, mirroring the post-transaction Accountability handling.
  const result = withRuntimeActivation(
    withAccountabilityData(executeTransaction(target, artifact, plan, options), targetValue),
    target, true);
  return { ...result, systemProfile: removeInstallerSystemProfile(target) };
}

// The system profile (package system-profile, 21.09.2026) is written by install.mjs AFTER the
// install transaction: it runs <target>/voice/system-profile.mjs, which writes through
// resolveVoiceRoot (voice/config.mjs) to <target>/runtime/voice/system-profile.json unless
// KEEL_VOICE_ROOT points elsewhere. No journal names that file, so the uninstall transaction
// cannot restore it. A real uninstall therefore removes exactly this one in-target file and then
// the two directories only while they are empty -- other runtime state of the voice layer stays.
// A failed install never reaches the scan, so the install compensation has nothing to remove.
export const SYSTEM_PROFILE_TARGET = "runtime/voice/system-profile.json";
function removeInstallerSystemProfile(target) {
  const file = join(target, ...SYSTEM_PROFILE_TARGET.split("/"));
  let info;
  try { info = lstatSync(file); }
  catch (error) { if (error?.code === "ENOENT") return "absent"; throw error; }
  // The repository tree is already restored at this point: a link or a linked parent is reported
  // and left in place instead of failing a completed uninstall.
  if (!info.isFile() || info.isSymbolicLink()) return "left-not-regular-file";
  try { assertSafeParents(target, SYSTEM_PROFILE_TARGET); } catch { return "left-linked-parent"; }
  unlinkSync(file);
  // Prune runtime/voice and runtime only while empty; rmdir never removes a non-empty directory.
  for (const directory of [join(target, "runtime", "voice"), join(target, "runtime")]) {
    try { rmdirSync(directory); } catch { /* other runtime state remains */ }
  }
  return "removed";
}

// Uninstall restores the repository tree only. The Accountability data of this installation --
// including the Google OAuth token and the OAuth client file -- lives outside the repository and
// is therefore NAMED with every uninstall result (also dry-run); removing it is the explicit
// Owner choice `--purge-accountability-data`, executed by the installer after the transaction.
// The RAW target spelling is inspected, not the canonical repository path: the Dashboard hashes
// the spelling it was started with, and harnessRootCandidates adds the canonical form itself.
// Completeness audit 06.09.2026, H1. Measured by "uninstall names the accountability data
// outside the repository and purges it only on explicit request".
function withAccountabilityData(result, rawTarget) {
  return { ...result, accountabilityData: inspectAccountabilityData(rawTarget, { env: process.env }) };
}

// Runtime activation lives in the ignored .unlazy/ tree: .unlazy/<scope>/package.ref binds an
// active package, and git-intent-guard.hasPackageRef treats any surviving package.ref as an
// active package -- so a follow-up installation into the same repository would inherit a stale
// activation (completeness audit 06.09.2026, finding 378). Uninstall clears ONLY these activation
// pointers and preserves recoverable git state under .unlazy/<scope>/git/recovery. The accepted
// pointer shape mirrors the guard so exactly the pointers it would honor are the ones cleared.
const PACKAGE_REF_RE = /^docs\/packages\/[A-Za-z0-9][A-Za-z0-9._-]{0,63}\r?\n$/u;
function resolveRuntimeActivation(target, remove) {
  const runtime = join(target, ".unlazy");
  const activation = { directory: ".unlazy", packageRefs: [], cleared: [], recoveryPreserved: [] };
  let entries;
  try { entries = readdirSync(runtime, { withFileTypes: true }); }
  catch { return activation; }
  for (const entry of [...entries].sort((left, right) => left.name.localeCompare(right.name, "en"))) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.startsWith(".") || entry.name === "locks") continue;
    const scope = entry.name;
    const ref = join(runtime, scope, "package.ref");
    let bound = false;
    try {
      const info = lstatSync(ref);
      bound = !info.isSymbolicLink() && info.isFile() && PACKAGE_REF_RE.test(readFileSync(ref, "utf8"));
    } catch { bound = false; }
    if (!bound) continue;
    activation.packageRefs.push(scope);
    let hasRecovery = false;
    try { hasRecovery = readdirSync(join(runtime, scope, "git", "recovery")).length > 0; }
    catch { hasRecovery = false; }
    if (hasRecovery) activation.recoveryPreserved.push(scope);
    if (remove) {
      rmSync(ref, { force: true });
      activation.cleared.push(scope);
      // Prune the now-empty scope directory only when nothing else remains; a surviving
      // git/ (recovery receipts included) or other runtime state keeps it in place.
      try { rmdirSync(join(runtime, scope)); } catch { /* recovery or other runtime state remains */ }
    }
  }
  if (remove) { try { rmdirSync(runtime); } catch { /* recovery, locks, or other runtime state remains */ } }
  return activation;
}

function withRuntimeActivation(result, target, remove) {
  return { ...result, runtimeActivation: resolveRuntimeActivation(target, remove) };
}

function managementUnknownEntries(target, allowRuntime = true) {
  const paths = managementPaths(target);
  if (!existsSync(paths.root)) return [];
  const allowed = new Set([STATE_FILE, LOCK_FILE, "transactions", "backups", ...(allowRuntime ? ["runtime"] : [])]);
  return readdirSync(paths.root).filter((name) => !allowed.has(name)).sort();
}

export function distributionStatus({ distributionRoot, target: targetValue }) {
  const artifact = loadVerifiedArtifact(distributionRoot);
  const target = assertRepository(targetValue);
  const pending = pendingTransactions(target);
  const state = readState(target);
  const unknown = managementUnknownEntries(target, Boolean(state));
  const lock = transactionLock(target);
  if (!state) {
    return {
      command: "status", state: pending.length || lock.present ? "recovery-required" : unknown.length ? "corrupt" : "not-installed",
      healthy: pending.length === 0 && unknown.length === 0 && !lock.present,
      pendingTransactions: pending.map((entry) => ({ id: entry.id, kind: entry.value.kind, phase: entry.value.phase })),
      transactionLock: lock,
      unknownStateEntries: unknown,
      available: artifact.manifest.product,
    };
  }
  const health = inspectManagedState(target, state);
  const versionComparison = compareVersions(state.product.version, artifact.manifest.product.version);
  const repacked = versionComparison === 0 && state.manifestDigest !== artifact.manifestDigest;
  let runtimeCacheErrors = [];
  try { validateDashboardRuntimeCaches(target); }
  catch (error) { runtimeCacheErrors = [error.message]; }
  const healthy = !pending.length && !lock.present && !unknown.length && !health.drift.length &&
    !health.backupErrors.length && !runtimeCacheErrors.length && !repacked;
  return {
    command: "status", state: healthy ? "installed" : "degraded", healthy,
    installed: state.product,
    available: artifact.manifest.product,
    upgradeAvailable: versionComparison < 0,
    repackedWithoutVersion: repacked,
    managedFiles: state.entries.length,
    drift: health.drift,
    localChanges: health.localChanges,
    backupErrors: health.backupErrors,
    pendingTransactions: pending.map((entry) => ({ id: entry.id, kind: entry.value.kind, phase: entry.value.phase })),
    transactionLock: lock,
    unknownStateEntries: unknown,
    runtimeCacheErrors,
    plugin: state.plugin || { codexProjectInstalled: false },
  };
}

export function doctorDistribution(options) {
  const status = distributionStatus(options);
  if (!status.healthy) fail("distribution doctor found recovery or integrity failures", status);
  return { ...status, command: "doctor", doctor: "healthy" };
}

export function rollbackDistribution({ distributionRoot, target: targetValue }) {
  const target = assertRepository(targetValue);
  const paths = managementPaths(target);
  const transactions = pendingTransactions(target);
  const lock = transactionLock(target);
  if (lock.present && lock.alive) fail("distribution transaction still has a live or unverifiable owner", lock);
  if (!transactions.length) {
    if (lock.present) {
      releaseLock(paths);
      if (!readState(target)) cleanupManagement(target);
      return { command: "rollback", state: readState(target) ? "installed" : "not-installed",
        rollback: "stale-lock-cleared", restored: 0 };
    }
    return { command: "rollback", state: readState(target) ? "installed" : "not-installed", noOp: true };
  }
  if (transactions.length !== 1) fail("multiple unfinished transactions require manual isolation before rollback");
  const item = transactions[0];
  const result = rollbackJournal(target, item);
  releaseLock(paths);
  if (!readState(target)) cleanupManagement(target);
  return {
    command: "rollback", state: readState(target) ? "installed" : "not-installed",
    rollback: result.committed ? "committed-cleanup" : "verified", restored: result.restored,
  };
}
