import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
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
// .claude/mutation-policy.json is no longer delivered (package P30 removed the guards that read it); it stays on this
// list only because an installation made before that records it as an owner target, and a state is refused whose
// ownership differs from this list (see RETIRED_OWNER_TARGETS).
const OWNER_MUTABLE_TARGETS = new Set([
  ".claude/launch.json",
  ".claude/mutation-policy.json",
  "docs/08-sessions-rollen.md",
  "docs/harness-instance.md",
  "docs/tool-landscape.md",
]);
// Owner files of earlier releases that the product no longer delivers. An upgrade drops them from the managed entries and
// leaves the installed copy exactly as it is (it belongs to the project now): not deleted, not changed, also when it is
// still the delivered text. Same handover as the files of the earlier onboarding package.
const RETIRED_OWNER_TARGETS = new Set([
  ".claude/mutation-policy.json",
]);
// An installation older than 1.3.10 recorded the two targets above as "distribution" in its state. That
// stored value is accepted and re-derived, otherwise every installed version would refuse its own upgrade.
const OWNERSHIP_WIDENED_TO_OWNER = new Set([
  ".claude/launch.json",
  "docs/08-sessions-rollen.md",
]);
// Legacy: only an installed state written before the installer stopped creating the onboarding package lists these entries;
// state validation still needs their ownership (see retireOnboardingPackage).
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
    // Derived data of the write guard of earlier releases (it kept the managed paths of state.json here); the release no
    // longer delivers that guard. The installer owns the folder in that it tolerates it and removes it with the rest of the state.
    cache: join(root, "cache"),
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

// P20, D14: the real git.exe through the Harness Git helper. This tree is delivered on its own (standalone/), so the helper comes
// from the delivered payload next to it (verified with the rest of the payload), never from a folder beside the tree or from the
// target repository, whose code the installer must not run. A payload without it (not yet rebuilt) runs the plain "git", as before.
let gitBinaryModule;
function gitSync(args, options) {
  if (gitBinaryModule === undefined) {
    try { gitBinaryModule = createRequire(import.meta.url)("../payload/harness-core/git/git-binary.cjs"); }
    catch { gitBinaryModule = null; }
  }
  return gitBinaryModule ? gitBinaryModule.gitSync(args, options) : spawnSync("git", args, options);
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
  const result = gitSync(["-C", target, "rev-parse", "--show-toplevel"], {
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

// A hook's identity: its command and, in exec form, its arguments ("command": "node" alone names no hook).
function hookIdentity(hook) {
  if (typeof hook?.command !== "string") return null;
  return Array.isArray(hook.args) ? JSON.stringify([hook.command, ...hook.args.map(String)]) : hook.command;
}

// The product hooks earlier releases delivered and the current one no longer does. Package P5 (A1) merged the seven
// single PreToolUse guards into one process (.claude/pretool-guards.js); package P30 (agenten-nicht-mehr-sperren) removed
// every blocking hook: the only PreToolUse hook left is the GitHub delete protection (.claude/github-delete-guard.js).
// An installed file that still lists them would start a script the update no longer delivers (and removes) on every
// tool call. What is listed is the identity (hookIdentity) a hook had in the release that delivered it, per delivered
// hook file and event:
//   - .claude/settings.json, release before P5: a whole command line, no args;
//   - .claude/settings.json, releases P5 to before P30: command "node" with the args [script, route];
//   - .codex/hooks.json: a whole command line of the hook runner (node -e ... ".claude/<name>.js"), no args.
// A user hook never has these identities unless it is the product's own. dod-guard, unlazy-stop and every other
// product hook stay (they are delivered by this release, or simply not listed).
const CLAUDE_SINGLE_GUARDS = ["git-intent-guard", "shell-mutation-guard", "danger-guard", "write-guard", "paket-gate",
  "sessionpost-guard", "mcp-write-guard"];
const CLAUDE_PRETOOL_ROUTES = ["shell", "write", "mcp"];
const CODEX_RUNNER_COMMAND = "node -e \"let p=require('path'),f=require('fs'),d=process.cwd();while(!f.existsSync(p.join(d," +
  "'.keel-harness.json'))){let n=p.dirname(d);if(n===d)throw Error('Keel Harness root not found');d=n}" +
  "process.env.KEEL_HOOK_TARGET=process.argv[1];require(p.join(d,'.codex/hook-runner.cjs'))\" ";
const CODEX_RETIRED_TARGETS = [".claude/git-intent-guard.js", ".claude/shell-mutation-guard.js", ".claude/danger-guard.js",
  ".codex/apply-patch-guard.cjs", ".claude/sessionpost-guard.js", ".claude/mcp-write-guard.js"];
export const RETIRED_PRODUCT_HOOKS = Object.freeze({
  ".claude/settings.json": Object.freeze({
    PreToolUse: Object.freeze([
      ...CLAUDE_SINGLE_GUARDS.map((name) => "node \"$CLAUDE_PROJECT_DIR/.claude/" + name + ".js\""),
      ...CLAUDE_PRETOOL_ROUTES.map((route) => hookIdentity({ command: "node",
        args: ["${CLAUDE_PROJECT_DIR}/.claude/pretool-guards.js", route] })),
    ]),
  }),
  ".codex/hooks.json": Object.freeze({
    PreToolUse: Object.freeze(CODEX_RETIRED_TARGETS.map((script) => CODEX_RUNNER_COMMAND + "\"" + script + "\"")),
  }),
});

// Install and upgrade add every matcher alternative a product hook is missing, so a later product
// alternative (e.g. "Bash|PowerShell") also reaches an installation whose pre-install file listed the
// guard under "Bash" only. User hooks are never copied, changed or removed. A product hook only joins a
// group that holds nothing but product hooks. Two changes reach installed product hooks (package P5):
//   - a hook of RETIRED_PRODUCT_HOOKS (by its identity, so also one in exec form with args, in .claude/settings.json and
//     .codex/hooks.json) is withdrawn, and a group it leaves empty goes with it;
//   - an installed hook with the identity of a delivered product hook takes the delivered attributes
//     (timeout, async, statusMessage, ...), so an installation never keeps a hook without the product's time
//     limit (A14: the backup warning stood in the workbench without one).
export function mergeHooks(existingText, incomingText, target) {
  const existing = parseJsonObject(existingText, target);
  const incoming = parseJsonObject(incomingText, target);
  const output = structuredClone(existing);
  if (!isObject(output.hooks)) output.hooks = {};
  const retired = RETIRED_PRODUCT_HOOKS[target] || {};
  for (const [event, commands] of Object.entries(retired)) {
    if (!Array.isArray(output.hooks[event])) continue;
    // Withdrawn is only what this release no longer delivers itself (an older payload still carries the single guards).
    const stillDelivered = new Set((isObject(incoming.hooks) && Array.isArray(incoming.hooks[event]) ? incoming.hooks[event] : [])
      .flatMap((group) => isObject(group) && Array.isArray(group.hooks) ? group.hooks : []).map(hookIdentity));
    const gone = new Set(commands.filter((command) => !stillDelivered.has(command)));
    if (!gone.size) continue;
    output.hooks[event] = output.hooks[event].flatMap((group) => {
      if (!isObject(group) || !Array.isArray(group.hooks)) return [group];
      const kept = group.hooks.filter((hook) => !gone.has(hookIdentity(hook)));
      if (kept.length === group.hooks.length) return [group];
      return kept.length ? [{ ...group, hooks: kept }] : [];
    });
  }
  for (const [event, groups] of Object.entries(output.hooks)) {
    const incomingGroups = isObject(incoming.hooks) && Array.isArray(incoming.hooks[event]) ? incoming.hooks[event] : [];
    const delivered = new Map();
    for (const group of incomingGroups) for (const hook of (isObject(group) && Array.isArray(group.hooks) ? group.hooks : [])) {
      const identity = hookIdentity(hook);
      if (identity !== null && !delivered.has(identity)) delivered.set(identity, hook);
    }
    if (!Array.isArray(groups) || !delivered.size) continue;
    for (const group of groups) {
      if (!isObject(group) || !Array.isArray(group.hooks)) continue;
      group.hooks = group.hooks.map((hook) => {
        const wanted = delivered.get(hookIdentity(hook));
        return wanted && JSON.stringify(wanted) !== JSON.stringify(hook) ? structuredClone(wanted) : hook;
      });
    }
  }
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
      .map(hookIdentity).filter((identity) => identity !== null));
    for (const group of incomingGroups) {
      if (!isObject(group) || !Array.isArray(group.hooks)) fail(`${target} incoming hook group is malformed`);
      const wanted = matcherAlternatives(group);
      for (const hook of group.hooks) {
        const identity = hookIdentity(hook);
        if (identity === null) continue;
        const covered = new Set(groups
          .filter((item) => hooksOf(item).some((present) => hookIdentity(present) === identity))
          .flatMap(matcherAlternatives));
        if (covered.has("") || covered.has("*")) continue;
        const missing = wanted.filter((alternative) => !covered.has(alternative));
        if (!missing.length) continue;
        const matcher = missing.join("|");
        const productGroup = groups.find((item) => isObject(item) && String(item.matcher || "") === matcher &&
          Array.isArray(item.hooks) && item.hooks.every((present) => productCommands.has(hookIdentity(present))));
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

// The installer no longer creates the work package docs/packages/harness-onboarding (Karte Arbeitsweise, 07.10.2026; Owner:
// the user did not get through onboarding because it produced work packages that nobody could accept). Onboarding is a
// proposal of the SessionStart hook plus the command /onboarding: the session asks the human and writes docs/harness-instance.md
// itself. An installation made before that carries the installer-shaped package (OWNER.md "Source: Keel Harness installer",
// PACKAGE.md, GATES.md, gates/leaf-instance.md). An upgrade hands those four files to the project (nothing is deleted, the
// profile docs/harness-instance.md and docs/tool-landscape.md stay as they are), and the package is retired if it is still
// open: its runtime scope is moved to .unlazy/.suspended/ and PACKAGE.md gets one "BLOCKED: stillgelegt" status entry, the
// state package-resolve.mjs withdraw leaves behind. The installer needs no Owner-OK for that: the package is its own and
// no Owner started work in it that it would overrule; a package that is closed, foreign or busy is left alone, and so is one
// somebody started work in (an Owner start in executor.json, a session beyond "prepared", an integration, a living binding).
const ONBOARDING_PACKAGE = "harness-onboarding";
const RETIRED_LABEL = "BLOCKED: stillgelegt";
const RETIRED_STATUS = /\bBLOCKED:\s*stillgelegt\b/u;
const ENDED_RUN_STATES = new Set(["provider-start-failed", "provider-returned", "provider-failed", "aborted", "timed-out",
  "vanished", "hung", "budget-reached", "repeated-block"]);

function onboardingRoot(target) {
  return join(target, "docs", "packages", ONBOARDING_PACKAGE);
}

function isLegacyOnboardingTarget(targetName) {
  return targetName.startsWith(`docs/packages/${ONBOARDING_PACKAGE}/`);
}

// The installer-shaped package of an earlier installation: { kind: "absent" | "foreign" | "installer", ... }. A package of
// the same name that another hand wrote is "foreign" and never touched.
function inspectOnboardingPackage(target) {
  const root = onboardingRoot(target);
  if (!existsSync(root)) return { kind: "absent" };
  const info = lstatSync(root);
  if (!info.isDirectory() || info.isSymbolicLink()) return { kind: "foreign", reason: "not one real directory" };
  let ownerText;
  let packageRaw;
  try {
    ownerText = withLf(readRegular(join(root, "OWNER.md"), "onboarding OWNER.md").content).toString("utf8");
    packageRaw = readRegular(join(root, "PACKAGE.md"), "onboarding PACKAGE.md").content.toString("utf8");
  } catch { return { kind: "foreign", reason: "incomplete" }; }
  // withLf: the heading line of a CRLF checkout ends in \r\n and is still the installer's own package.
  if (!ownerText.startsWith(`# Owner contract: ${ONBOARDING_PACKAGE}\n`) || !/^Source:\s*Keel Harness installer\s*$/mu.test(ownerText) ||
      !packageRaw.replace(/\r\n/gu, "\n").startsWith(`# Work package: ${ONBOARDING_PACKAGE}\n`)) {
    return { kind: "foreign", reason: "another package of this name" };
  }
  return { kind: "installer", root, packageFile: join(root, "PACKAGE.md"), packageRaw };
}

// Closed packages stay project history: a close receipt, or an Abschluss that claims fulfilment with nothing open.
function onboardingClosed(found) {
  if (existsSync(join(found.root, "evidence", "close", "close-receipt.json"))) return true;
  const section = (found.packageRaw.replace(/\r\n/gu, "\n").split(/^## Abschluss[ \t]*$/mu)[1] || "").split(/^## /mu)[0];
  return /^Fulfillment:\s*(?:erfuellt|fulfilled)\b/imu.test(section) && /^Offen:\s*(?:nichts|nothing|none)\s*$/imu.test(section);
}

// The runtime scopes bound to the package: .unlazy/<scope>/package.ref names exactly docs/packages/harness-onboarding.
function onboardingScopes(target) {
  const runtime = join(target, ".unlazy");
  let entries;
  try { entries = readdirSync(runtime, { withFileTypes: true }); } catch { return []; }
  const scopes = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, "en"))) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.startsWith(".") || entry.name === "locks") continue;
    try {
      const ref = readFileSync(join(runtime, entry.name, "package.ref"), "utf8").replace(/\r?\n$/u, "");
      if (ref === `docs/packages/${ONBOARDING_PACKAGE}`) scopes.push(entry.name);
    } catch { /* this scope is bound to no package */ }
  }
  return scopes;
}

// The silence limit of a planning holder: the rule of silenceMs() in vendor/unlazy/scripts/lib/silence-watch.mjs and of
// harness-core/binding/hook-activity.cjs (KEEL_SILENCE_MS, default 30 minutes, at least one second), repeated here because
// the installer loads nothing from the installation it updates.
function silenceLimitMs(env = process.env) {
  const text = String(env?.KEEL_SILENCE_MS ?? "").trim();
  const value = /^\d+$/u.test(text) ? Number(text) : null;
  return value !== null && Number.isSafeInteger(value) && value >= 1000 ? value : 30 * 60 * 1000;
}

// The sessions bound to the scope: every binding file under <scope>/bindings and every session-index entry of the
// installation root (.unlazy/.session-index) whose binding file lies in the scope and exists. A stale index entry (its
// binding gone) binds nothing.
function scopeBindings(target, scope) {
  const sessions = new Set();
  const directory = join(target, ".unlazy", scope, "bindings");
  let names = [];
  try { names = readdirSync(directory); } catch { names = []; }
  for (const name of names) {
    if (!/^[0-9a-f]{64}\.json$/u.test(name)) continue;
    try {
      const value = JSON.parse(readFileSync(join(directory, name), "utf8"));
      if (typeof value?.sessionId === "string" && value.sessionId.trim()) sessions.add(value.sessionId.trim());
    } catch { /* a binding without a readable session names no holder */ }
  }
  const index = join(target, ".unlazy", ".session-index");
  try { names = readdirSync(index); } catch { names = []; }
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      const value = JSON.parse(readFileSync(join(index, name), "utf8"));
      if (value?.scope !== scope || typeof value.sessionId !== "string" || typeof value.bindingRelative !== "string") continue;
      if (existsSync(resolve(target, String(value.repoRelative ?? "."), value.bindingRelative))) sessions.add(value.sessionId.trim());
    } catch { /* an unreadable index entry binds nothing */ }
  }
  return [...sessions].filter(Boolean).sort();
}

// A bound session lives when it is a session of the executor whose binding (file or session-index entry) exists, prepared
// included: a step prepared by start --session holds a living binding exactly as livingBinding of
// harness-core/guards/session-scope.cjs counts it (Nachpruefung 07.10.2026; the rule is repeated here because the installer
// loads nothing from the installation it updates). A session the executor did not start lives when its planning record
// (.unlazy/.bootstrap/<sha256>.json), which every hook of the session touches (hook-activity.cjs), was touched within the
// silence limit.
function livingBinding(target, scope, sessions, now) {
  const limit = silenceLimitMs();
  for (const sessionId of scopeBindings(target, scope)) {
    const entry = Object.values(sessions).find((item) => item && (item.sessionId || "") === sessionId) || sessions[sessionId];
    if (entry && typeof entry === "object") return sessionId;
    const record = join(target, ".unlazy", ".bootstrap", createHash("sha256").update(sessionId).digest("hex") + ".json");
    try {
      const info = lstatSync(record);
      if (info.isFile() && !info.isSymbolicLink() && now.getTime() - info.mtimeMs < limit) return sessionId;
    } catch { /* no planning record: no sign of life */ }
  }
  return null;
}

// Whether somebody started work in the scope, or null: the Owner start the executor recorded (executor.json ownerStart), a
// session beyond "prepared", an integration, or a living binding. Such a package is no longer only the installer's own: it
// is left as it is. An executor.json that cannot be read is doubt and counts as started.
function startedScope(target, scope, now) {
  const file = join(target, ".unlazy", scope, "executor.json");
  if (!existsSync(file)) {
    const holder = livingBinding(target, scope, {}, now);
    return holder ? `a living binding of session ${holder}` : null;
  }
  let state;
  try { state = JSON.parse(readFileSync(file, "utf8")); } catch { return "executor.json is unreadable"; }
  if (!state || typeof state !== "object" || Array.isArray(state)) return "executor.json is unreadable";
  if (state.ownerStart) return "the Owner started the package (executor.json ownerStart)";
  const sessions = state.sessions && typeof state.sessions === "object" && !Array.isArray(state.sessions) ? state.sessions : {};
  for (const [key, entry] of Object.entries(sessions).sort(([left], [right]) => left.localeCompare(right, "en"))) {
    if (!entry || typeof entry !== "object" || entry.state !== "prepared") {
      return `session ${entry?.sessionId || key} is ${entry?.state || "unknown"}`;
    }
  }
  if (state.integration) return `an integration is recorded (${state.integration.state || "unknown"})`;
  const holder = livingBinding(target, scope, sessions, now);
  return holder ? `a living binding of session ${holder}` : null;
}

// Why a scope is in use right now, or null: a living executor or provider process, or a dispatch wave with a deadline ahead.
// Quiet files prove nothing; a worker that thinks for hours is still a holder.
function busyScope(directory, now) {
  const read = (file) => { try { return JSON.parse(readFileSync(file, "utf8")); } catch { return null; } };
  const lock = read(join(directory, "executor.lock"));
  if (lock && runtimeProcessAlive(lock.pid)) return `executor.lock held by process ${lock.pid}`;
  const runs = join(directory, "executor", "runs");
  let names = [];
  try { names = readdirSync(runs); } catch { names = []; }
  for (const name of names) {
    const run = read(join(runs, name, "state.json"));
    if (!run || typeof run !== "object" || ENDED_RUN_STATES.has(run.state)) continue;
    for (const pid of [run.workerPid, run.providerPid]) {
      if (runtimeProcessAlive(pid)) return `provider run ${name} has process ${pid}`;
    }
  }
  const deadlines = [];
  const collect = (value) => {
    if (!value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
      if (/deadline/iu.test(key) && typeof item === "string") deadlines.push(Date.parse(item));
      else if (item && typeof item === "object") collect(item);
    }
  };
  collect(read(join(directory, "dispatch.json"))?.waves);
  if (deadlines.some((deadline) => Number.isFinite(deadline) && deadline > now.getTime())) return "a dispatch wave deadline lies ahead";
  return null;
}

function sleepSync(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

// Windows holds a directory a process stands in: the rename is tried a few times before it is given up.
function renameWithRetries(from, to) {
  for (let attempt = 1; ; attempt += 1) {
    try { renameSync(from, to); return; }
    catch (error) {
      if (attempt >= 5 || !["EBUSY", "EPERM", "EACCES"].includes(error?.code)) throw error;
      sleepSync(100 * attempt);
    }
  }
}

// The newest status entry stands directly under "## Status", one blank line before and after (as package-resolve writes it).
function withStatusEntry(text, entry) {
  const eol = /\r\n/u.test(text) ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/u);
  const start = lines.findIndex((line) => /^##\s+Status\s*$/u.test(line));
  if (start === -1) return null;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s/u.test(lines[index])) { end = index; break; }
  }
  let rest = start + 1;
  while (rest < end && lines[rest].trim() === "") rest += 1;
  return [...lines.slice(0, start + 1), "", entry, "", ...lines.slice(rest)].join(eol);
}

function localDate(now) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// Retires the open onboarding package of an earlier installation. Result: { state } with
//   absent | left-foreign | closed | already-retired   nothing to do (nothing changed)
//   retired                                            PACKAGE.md marked, runtime scopes moved aside ({ scopes: [{ scope, movedTo }] })
//   left-busy                                          a holder is alive or work was started; nothing changed ({ reason })
//   failed                                             a step failed and was undone ({ error })
// It never throws for a state it does not understand: the installation itself is complete when this runs.
export function retireOnboardingPackage(targetValue, options = {}) {
  const target = resolve(targetValue);
  const now = options.now instanceof Date ? options.now : new Date();
  let found;
  try { found = inspectOnboardingPackage(target); }
  catch (error) { return { state: "failed", error: error.message }; }
  if (found.kind === "absent") return { state: "absent" };
  if (found.kind === "foreign") return { state: "left-foreign", reason: found.reason };
  if (onboardingClosed(found)) return { state: "closed" };
  const scopes = onboardingScopes(target);
  const retired = RETIRED_STATUS.test(found.packageRaw);
  if (retired && !scopes.length) return { state: "already-retired" };
  for (const scope of scopes) {
    const reason = busyScope(join(target, ".unlazy", scope), now) || startedScope(target, scope, now);
    if (reason) return { state: "left-busy", scopes, reason: `${scope}: ${reason}` };
  }
  const stamp = now.toISOString().replace(/[:.]/gu, "-");
  const moved = [];
  try {
    for (const scope of scopes) {
      const suspended = join(target, ".unlazy", ".suspended");
      mkdirSync(suspended, { recursive: true });
      const destination = join(suspended, `${scope}-${stamp}`);
      renameWithRetries(join(target, ".unlazy", scope), destination);
      moved.push({ scope, movedTo: relativeFrom(target, destination) });
    }
    if (!retired) {
      const where = moved.length ? `; Laufzeit nach ${moved.map((item) => item.movedTo).join(", ")} verschoben (zurueckverschieben reaktiviert sie)` : "";
      const entry = `${localDate(now)} - ${RETIRED_LABEL}, Grund: ` +
        "Das Onboarding laeuft ohne Paket: die Sitzung fragt den Menschen und schreibt das Profil docs/harness-instance.md selbst; " +
        `das Profil bleibt unveraendert${where}.`;
      const next = withStatusEntry(found.packageRaw, entry);
      if (next === null) throw new Error("PACKAGE.md has no ## Status section");
      const temporary = `${found.packageFile}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
      writeFileSync(temporary, next, { encoding: "utf8", flag: "wx" });
      try { renameSync(temporary, found.packageFile); }
      catch (error) { try { unlinkSync(temporary); } catch { /* already gone */ } throw error; }
    }
  } catch (error) {
    // The PACKAGE.md entry is the last step: a failure before it leaves the file as it was, only the scopes return.
    for (const item of moved.reverse()) {
      try { renameWithRetries(join(target, ...item.movedTo.split("/")), join(target, ".unlazy", item.scope)); } catch { /* reported below */ }
    }
    return { state: "failed", error: error.message };
  }
  return { state: "retired", scopes: moved };
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
  const installDate = new Date().toISOString().slice(0, 10);
  const definitions = artifactDefinitions(artifact);
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
    // The files of the earlier onboarding package and the retired owner files (RETIRED_OWNER_TARGETS) are handed to the project
    // whole, unchanged and no longer managed: restoring the original would delete the package (and its Owner contract) or the
    // Owner policy the project may already have worked in.
    const handedOver = (isLegacyOnboardingTarget(entry.target) || RETIRED_OWNER_TARGETS.has(entry.target)) && before.exists;
    operations.push(operation(target, definition, before, original,
      preserveOnUninstall || handedOver ? before.content : content, false, preserveOnUninstall));
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
  // No time limit (Owner 05.10.2026 15:17, P21): the installation of the plugin downloads, and it ends by itself.
  const result = spawnSync(process.execPath, args, {
    cwd: target, encoding: "utf8", windowsHide: true, maxBuffer: Infinity,
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
      cwd: target, encoding: "utf8", windowsHide: true, maxBuffer: Infinity,
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
  // The guard cache is derived and rebuilt on demand: it goes with the state, never blocks the removal of the folder.
  if (existsSync(paths.cache)) {
    try { safeRemoveTree(target, paths.cache, "guard cache"); } catch { /* retained: the folder stays with its cache */ }
  }
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

// The Claude Code that will run the delivered guards must know the hook field `args` (P5: the guards start in exec form; an
// older Claude Code starts node without a program and lets every tool call through). The rule and the version reader are one
// module of the delivered tree (harness-core/system/claude-version.cjs), taken from the verified payload, else from the source
// tree this installer lives in. A payload without it carries the earlier hook form, which every Claude Code runs. An older
// Claude Code stops install and upgrade before any write; a missing claude program only warns (it may be installed later).
let claudeVersionModule;
function claudeVersionRule(payloadRoot) {
  if (claudeVersionModule !== undefined) return claudeVersionModule;
  const load = createRequire(import.meta.url);
  for (const file of [join(payloadRoot, "harness-core", "system", "claude-version.cjs"),
    fileURLToPath(new URL("../../harness-core/system/claude-version.cjs", import.meta.url))]) {
    if (!existsSync(file)) continue;
    claudeVersionModule = load(file);
    return claudeVersionModule;
  }
  claudeVersionModule = null;
  return null;
}

export function assertClaudeCodeVersion(payloadRoot, options = {}) {
  const rule = options.claudeVersionRule || claudeVersionRule(payloadRoot);
  if (!rule) return { state: "not-required" };
  const read = options.readClaudeVersion ? options.readClaudeVersion() : rule.readClaudeVersion();
  if (read.missing) {
    return { state: "missing", minimum: rule.MIN_CLAUDE_CODE_VERSION,
      warning: "no claude program answered --version (" + (read.error || read.program) + "); the Harness guards need Claude Code " +
        rule.MIN_CLAUDE_CODE_VERSION + " or newer, check it before the first session" };
  }
  const verdict = rule.judgeClaudeVersion(read.text);
  if (verdict.state !== "ok") fail("Claude Code check: " + verdict.message, { claudeCode: verdict });
  return { state: "ok", version: verdict.version, minimum: verdict.minimum };
}

export function installDistribution({ distributionRoot, target: targetValue, ...options }) {
  const artifact = loadVerifiedArtifact(distributionRoot);
  const target = assertRepository(targetValue);
  const claudeCode = assertClaudeCodeVersion(artifact.payloadRoot, options);
  const withClaude = (result) => claudeCode.state === "missing" ? { ...result, claudeCode } : result;
  const state = readState(target);
  if (state) {
    validateDashboardRuntimeCaches(target);
    assertNoActiveDashboardRuntime(target);
  }
  let plan;
  if (state) plan = upgradePlan(target, artifact, state, options);
  else plan = freshPlan(target, artifact, options);
  // The earlier onboarding package (see retireOnboardingPackage): retired after the files are in place, never part of the
  // transaction, and reported only when something was found.
  const withOnboarding = (result) => {
    const onboardingPackage = retireOnboardingPackage(target);
    return onboardingPackage.state === "absent" ? result : { ...result, onboardingPackage };
  };
  if (plan.noOp) {
    const retainedRuntimeCaches = cleanupDashboardRuntimeCaches(target, installedDashboardDigest(target));
    return withClaude(withOnboarding({
      command: "install", state: "installed", noOp: true,
      product: artifact.manifest.product, promotions: 0, managedFiles: state.entries.length,
      plugin: state.plugin?.codexProjectInstalled ? "project-installed" : "declared",
      ...(retainedRuntimeCaches.length ? { retainedRuntimeCaches } : {}),
    }));
  }
  const changed = plan.operations.filter((entry) => !sameContent(entry.before, entry.desired)).length;
  if (options.dryRun) {
    return withClaude({
      command: plan.kind, state: "planned", dryRun: true, product: artifact.manifest.product,
      changedFiles: changed, managedFiles: plan.operations.filter((entry) => entry.keepManaged).length,
      conflicts: 0, writes: 0,
    });
  }
  return withClaude(withOnboarding(executeTransaction(target, artifact, plan, options)));
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
  const allowed = new Set([STATE_FILE, LOCK_FILE, "transactions", "backups", "cache", ...(allowRuntime ? ["runtime"] : [])]);
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
