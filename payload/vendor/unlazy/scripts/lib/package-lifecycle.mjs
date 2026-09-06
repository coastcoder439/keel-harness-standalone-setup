// Transactional package activation and closure. Zero dependencies. Node 16+.

import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import packageContext from "./package-context.cjs";
import {
  appendStatus,
  releaseLeases,
  scopeRoot,
  withFileLock,
  writeAtomic,
} from "./gates.mjs";
import { dispatchStatePath, initialDispatchState } from "./dispatch.mjs";
import {
  assertPackageModeBoundary,
  listActiveScopes,
  resolvePackageTarget,
  samePackageId,
  validateScopeId,
} from "./packages.mjs";
import { inspectPackageBundle, publicPackageStatus } from "./package-schema.mjs";

const {
  assertNoLinkedComponent,
  isPathInside,
  validatePackageId,
} = packageContext;

const GATE_CHECK = fileURLToPath(new URL("../gate-check.mjs", import.meta.url));
const LIFECYCLE_SCHEMA = 1;
const DUTIES_SCHEMA = 1;
const DUTY_STATES = new Set(["open", "due", "fulfilled", "waived"]);
const RUNTIME_FILES = Object.freeze([
  "package.ref",
  "owner.ref.json",
  "session",
  "status.log",
  "hook-state.json",
  "dispatch.json",
  "duties.json",
]);

const slash = (value) => value.replaceAll("\\", "/");
const digestBytes = (value) => "sha256:" + createHash("sha256").update(value).digest("hex");

function sameFileSystemObject(left, right) {
  const a = statSync(left, { bigint: true });
  const b = statSync(right, { bigint: true });
  return a.dev === b.dev && a.ino === b.ino;
}

function lifecycleError(message, exitCode = 2, code = "UNLAZY_PACKAGE_LIFECYCLE") {
  const error = new Error(message);
  error.code = code;
  error.exitCode = exitCode;
  return error;
}

function conflict(message) {
  throw lifecycleError(message, 3, "UNLAZY_PACKAGE_CONFLICT");
}

export class SimulatedLifecycleCrash extends Error {
  constructor(point) {
    super("simulated lifecycle crash at " + point);
    this.code = "UNLAZY_SIMULATED_CRASH";
    this.exitCode = 2;
  }
}

function reach(options, point) {
  if (typeof options.failpoint === "function") options.failpoint(point);
}

function validateSessionId(value) {
  if (value === undefined || value === null || value === "") return "";
  const session = String(value);
  if (!session.trim() || session.length > 4096 || /[\0\r\n]/.test(session)) {
    throw lifecycleError("session must be a nonblank single line of at most 4096 characters");
  }
  return session;
}

function parseIgnoreLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const negated = trimmed.startsWith("!");
  const pattern = (negated ? trimmed.slice(1) : trimmed).replace(/^\//, "").replace(/\/+$/, "");
  return { negated, pattern };
}

export function assertRuntimeIgnored(repoRoot) {
  const ignoreFile = join(repoRoot, ".gitignore");
  if (!existsSync(ignoreFile)) {
    throw lifecycleError("activation requires a repository .gitignore with an exact .unlazy/ rule");
  }
  assertNoLinkedComponent(repoRoot, ignoreFile);
  const info = lstatSync(ignoreFile);
  if (info.isSymbolicLink() || !info.isFile()) throw lifecycleError(".gitignore must be a regular file");
  const rules = readFileSync(ignoreFile, "utf8").split(/\r?\n/).map(parseIgnoreLine).filter(Boolean);
  let runtimeIgnored = false;
  for (const rule of rules) {
    if (rule.pattern === ".unlazy" || rule.pattern === ".unlazy/**") runtimeIgnored = !rule.negated;
    if (!rule.negated && ["docs", "docs/**", "docs/packages", "docs/packages/**"].includes(rule.pattern)) {
      throw lifecycleError(".gitignore hides versioned package bundles via rule " + JSON.stringify(rule.pattern));
    }
  }
  if (!runtimeIgnored) {
    throw lifecycleError("activation requires an effective exact .unlazy/ or /.unlazy/ ignore rule");
  }
  return ignoreFile;
}

function validateRuntimeDirectory(repoRoot, scope) {
  const directory = scopeRoot(repoRoot, scope);
  assertNoLinkedComponent(repoRoot, directory);
  const info = lstatSync(directory);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw lifecycleError("scope runtime must be a real directory: " + directory);
  }
  if (!isPathInside(repoRoot, directory)) throw lifecycleError("scope runtime escapes repository");
  for (const legacy of ["GATES.md", "gates", "PLAN.md"]) {
    if (existsSync(join(directory, legacy))) {
      throw lifecycleError("package scope contains legacy fach state: .unlazy/" + scope + "/" + legacy);
    }
  }
  return directory;
}

function validateRuntimeBaseline(repoRoot, scope, packageId) {
  const directory = validateRuntimeDirectory(repoRoot, scope);
  const dutiesFile = join(directory, "duties.json");
  if (!existsSync(dutiesFile)) {
    try {
      writeFileSync(dutiesFile, JSON.stringify(initialDuties(packageId, scope), null, 2) + "\n",
        { encoding: "utf8", flag: "wx" });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
  for (const name of RUNTIME_FILES) {
    const file = join(directory, name);
    if (!existsSync(file)) throw lifecycleError("active scope is missing runtime file .unlazy/" + scope + "/" + name);
    const info = lstatSync(file);
    if (info.isSymbolicLink() || !info.isFile() || (typeof info.nlink === "number" && info.nlink !== 1)) {
      throw lifecycleError("runtime state must be a single-link regular file: .unlazy/" + scope + "/" + name);
    }
  }
  let hook;
  let dispatch;
  try { hook = JSON.parse(readFileSync(join(directory, "hook-state.json"), "utf8")); }
  catch (error) { throw lifecycleError("invalid hook-state.json: " + error.message); }
  if (!hook || hook.schema !== 1 || !hook.sessions || typeof hook.sessions !== "object" || Array.isArray(hook.sessions)) {
    throw lifecycleError("hook-state.json must contain schema 1 and a sessions object");
  }
  try { dispatch = JSON.parse(readFileSync(join(directory, "dispatch.json"), "utf8")); }
  catch (error) { throw lifecycleError("invalid dispatch.json: " + error.message); }
  if (!dispatch || dispatch.schema !== 2 || dispatch.scope !== scope || dispatch.packageId !== packageId ||
      !dispatch.waves || typeof dispatch.waves !== "object" || Array.isArray(dispatch.waves)) {
    throw lifecycleError("dispatch.json must contain schema 2 and exact scope/packageId identity");
  }
  readOwnerBinding(directory, packageId);
  return directory;
}

function ownerBindingValue(packageId, owner) {
  return {
    schema: 1,
    packageId,
    required: !!owner.required,
    present: !!owner.present,
    digest: owner.digest ?? null,
    requestDigest: owner.requestDigest ?? null,
  };
}

function readOwnerBinding(directory, packageId) {
  let value;
  try { value = JSON.parse(readFileSync(join(directory, "owner.ref.json"), "utf8")); }
  catch (error) { throw lifecycleError("invalid owner.ref.json: " + error.message); }
  if (!value || value.schema !== 1 || value.packageId !== packageId || typeof value.required !== "boolean" ||
      typeof value.present !== "boolean" || !["string", "object"].includes(typeof value.digest) ||
      !["string", "object"].includes(typeof value.requestDigest)) {
    throw lifecycleError("owner.ref.json must contain schema 1 and exact package/Owner identity");
  }
  if ((value.digest !== null && !/^sha256:[a-f0-9]{64}$/u.test(value.digest)) ||
      (value.requestDigest !== null && !/^sha256:[a-f0-9]{64}$/u.test(value.requestDigest))) {
    throw lifecycleError("owner.ref.json contains an invalid digest");
  }
  return value;
}

function assertOwnerBinding(directory, packageId, owner) {
  const actual = readOwnerBinding(directory, packageId);
  const expected = ownerBindingValue(packageId, owner);
  for (const field of ["required", "present", "digest", "requestDigest"]) {
    if (actual[field] !== expected[field]) {
      conflict("immutable Owner contract changed after package activation (" + field + ")");
    }
  }
  return actual;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function initialDuties(packageId, scope) {
  return {
    schema: DUTIES_SCHEMA,
    packageId,
    scope,
    assessment: { state: "unknown", gate: null, assessedAt: null },
    duties: {},
  };
}

function validateDuties(value, packageId, scope) {
  if (!value || value.schema !== DUTIES_SCHEMA || value.packageId !== packageId || value.scope !== scope ||
      !value.assessment || !["unknown", "complete"].includes(value.assessment.state) ||
      !value.duties || typeof value.duties !== "object" || Array.isArray(value.duties)) {
    throw lifecycleError("duties.json must contain schema 1 and exact package/scope identity");
  }
  if (value.assessment.state === "complete") {
    if (typeof value.assessment.gate !== "string" || !value.assessment.gate.includes(":") ||
        Number.isNaN(Date.parse(value.assessment.assessedAt))) {
      throw lifecycleError("completed follow-up assessment requires a qualified gate and timestamp");
    }
  } else if (value.assessment.gate !== null || value.assessment.assessedAt !== null) {
    throw lifecycleError("unknown follow-up assessment cannot claim a gate or timestamp");
  }
  for (const [dutyId, duty] of Object.entries(value.duties)) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(dutyId) || !duty || duty.id !== dutyId ||
        typeof duty.owner !== "string" || !duty.owner.trim() || typeof duty.trigger !== "string" || !duty.trigger.trim() ||
        !DUTY_STATES.has(duty.dueState) || typeof duty.gate !== "string" || !duty.gate.includes(":") ||
        Number.isNaN(Date.parse(duty.createdAt)) || Number.isNaN(Date.parse(duty.updatedAt))) {
      throw lifecycleError("follow-up duty " + dutyId + " must define owner, trigger, dueState, and qualified gate");
    }
    if (duty.dueState === "waived" && typeof duty.waiverReceipt !== "string") {
      throw lifecycleError("waived follow-up duty " + dutyId + " requires an Owner waiver receipt");
    }
    if (duty.dueState !== "waived" && duty.waiverReceipt) {
      throw lifecycleError("non-waived follow-up duty " + dutyId + " cannot carry a waiver receipt");
    }
    if (duty.dueState === "fulfilled" && Number.isNaN(Date.parse(duty.fulfilledAt))) {
      throw lifecycleError("fulfilled follow-up duty " + dutyId + " requires a timestamp");
    }
    if (duty.dueState === "waived" && Number.isNaN(Date.parse(duty.waivedAt))) {
      throw lifecycleError("waived follow-up duty " + dutyId + " requires a timestamp");
    }
  }
  return value;
}

function readDuties(directory, packageId, scope) {
  let value;
  try { value = JSON.parse(readFileSync(join(directory, "duties.json"), "utf8")); }
  catch (error) { throw lifecycleError("invalid duties.json: " + error.message); }
  return validateDuties(value, packageId, scope);
}

function dutyDigest(value) {
  return digestBytes(JSON.stringify(canonical(value)));
}

function assertGate(status, key, requireMet) {
  const gate = status._internal.gateEntries.find((entry) => entry.key === key);
  if (!gate) throw lifecycleError("unknown qualified follow-up gate " + key);
  if (requireMet && gate.state !== "met") throw lifecycleError("follow-up gate is not locally met: " + key, 1);
  return gate;
}

function assertDutiesClosable(duties) {
  if (duties.assessment.state !== "complete") {
    throw lifecycleError("follow-up duties are unknown; run duty-assess against a locally met gate", 1);
  }
  const open = Object.values(duties.duties).filter((duty) => !["fulfilled", "waived"].includes(duty.dueState));
  if (open.length) {
    throw lifecycleError("open follow-up duties block close: " + open.map((duty) => duty.id + "=" + duty.dueState).join(", "), 1);
  }
  return duties;
}

function executionReceipt(repoRoot, receiptPath, operation) {
  const directory = resolve(repoRoot, ".unlazy", ".execution-receipts");
  const file = resolve(receiptPath || "");
  const info = lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink() || (typeof info.nlink === "number" && info.nlink !== 1)) {
    throw lifecycleError("authorization receipt must be one regular file");
  }
  const resolvedDirectory = realpathSync(directory);
  const resolvedFile = realpathSync(file);
  if (!sameFileSystemObject(resolvedDirectory, dirname(resolvedFile))) {
    throw lifecycleError("authorization receipt escapes the execution receipt directory");
  }
  let value;
  try { value = JSON.parse(readFileSync(file, "utf8")); }
  catch (error) { throw lifecycleError("invalid authorization receipt: " + error.message); }
  const recordDigest = value?.recordDigest;
  if (!value || value.schemaVersion !== 1 || value.operation !== operation || !/^sha256:[a-f0-9]{64}$/u.test(recordDigest || "")) {
    throw lifecycleError("authorization receipt has the wrong schema or operation");
  }
  const body = { ...value };
  delete body.recordDigest;
  if (digestBytes(JSON.stringify(canonical(body))) !== recordDigest) {
    throw lifecycleError("authorization receipt digest is invalid");
  }
  const expected = join(directory, value.operation + "-" + recordDigest.slice(7) + ".json");
  if (!existsSync(expected) || !sameFileSystemObject(expected, resolvedFile)) {
    throw lifecycleError("authorization receipt path does not match its immutable identity");
  }
  return { file: resolvedFile, value };
}

function approvalConsumption(repoRoot, receiptPath, action, packageId, scope, dutyId = null) {
  const receipt = executionReceipt(repoRoot, receiptPath, "owner-approval-consumption");
  const value = receipt.value;
  const challenge = executionReceipt(repoRoot, value.challengeReceipt, "owner-approval-challenge");
  if (value.action !== action || value.packageId !== packageId || value.scope !== scope ||
      (value.dutyId || null) !== dutyId || value.challengeDigest !== challenge.value.recordDigest ||
      value.subjectDigest !== challenge.value.subjectDigest || value.subjectDigest !==
        digestBytes(JSON.stringify(canonical(value.subject || {}))) ||
      challenge.value.action !== action || challenge.value.packageId !== packageId ||
      challenge.value.scope !== scope || (challenge.value.dutyId || null) !== dutyId) {
    throw lifecycleError("Owner approval consumption does not bind its immutable challenge", 1);
  }
  return receipt;
}

function closeAuthorization(repoRoot, packageId, scope, status, duties, receiptPath) {
  const receipt = approvalConsumption(repoRoot, receiptPath, "close", packageId, scope);
  const value = receipt.value;
  const subject = value.subject || {};
  const head = spawnSync("git", ["-C", repoRoot, "rev-parse", "--verify", "HEAD"], {
    encoding: "utf8", windowsHide: true, timeout: 30_000,
  });
  if (head.status !== 0) throw lifecycleError("cannot bind close authorization to current Git HEAD");
  if (subject.packageDigest !== status.digest || subject.dutiesDigest !== dutyDigest(duties) ||
      subject.ownerDigest !== status.owner.digest || subject.head !== String(head.stdout).trim() ||
      typeof subject.planReceipt !== "string" || !subject.planReceipt) {
    throw lifecycleError("Owner close approval is stale for package, duties, Owner contract, HEAD, or close plan", 1);
  }
  return receipt;
}

export function readFollowUpDuties(options) {
  const repoRoot = realpathSync(resolve(options.root));
  const directory = validateRuntimeBaseline(repoRoot, String(options.scope || ""), String(options.packageId || ""));
  return readDuties(directory, String(options.packageId || ""), String(options.scope || ""));
}

export async function transitionFollowUpDuty(options) {
  const repoRoot = realpathSync(resolve(options.root));
  const packageId = String(options.packageId || "");
  const scope = String(options.scope || "");
  const directory = validateRuntimeBaseline(repoRoot, scope, packageId);
  const file = join(directory, "duties.json");
  return withFileLock(repoRoot, file, () => {
    const duties = readDuties(directory, packageId, scope);
    const target = resolvePackageTarget({ root: repoRoot, packageId, scope, repoKey: options.repoKey || ".", env: {} });
    const status = inspectPackageBundle(target);
    const now = options.now || new Date().toISOString();
    if (Number.isNaN(Date.parse(now))) throw lifecycleError("follow-up duty transition time must be ISO");
    if (options.action === "assess") {
      const gate = String(options.gate || "");
      assertGate(status, gate, true);
      duties.assessment = { state: "complete", gate, assessedAt: now };
    } else if (options.action === "add") {
      const dutyId = String(options.dutyId || "");
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(dutyId) || duties.duties[dutyId]) {
        throw lifecycleError("duty-add requires one new valid --duty ID");
      }
      const owner = validateSessionId(options.owner);
      const trigger = validateSessionId(options.trigger);
      const dueState = String(options.dueState || "open");
      if (!["open", "due"].includes(dueState)) throw lifecycleError("new duty due state must be open or due");
      const gate = String(options.gate || "");
      assertGate(status, gate, false);
      duties.duties[dutyId] = { id: dutyId, owner, trigger, dueState, gate, waiverReceipt: null,
        createdAt: now, updatedAt: now };
    } else if (options.action === "resolve") {
      const duty = duties.duties[String(options.dutyId || "")];
      if (!duty || !["open", "due"].includes(duty.dueState)) throw lifecycleError("duty-resolve requires an open duty");
      const gate = String(options.gate || duty.gate);
      assertGate(status, gate, true);
      Object.assign(duty, { dueState: "fulfilled", gate, waiverReceipt: null, updatedAt: now, fulfilledAt: now });
    } else if (options.action === "waive") {
      const duty = duties.duties[String(options.dutyId || "")];
      if (!duty || !["open", "due"].includes(duty.dueState)) throw lifecycleError("duty-waive requires an open duty");
      const waiver = approvalConsumption(repoRoot, options.waiverReceipt, "waive-duty", packageId, scope, duty.id);
      const subject = waiver.value.subject || {};
      const head = spawnSync("git", ["-C", repoRoot, "rev-parse", "--verify", "HEAD"], {
        encoding: "utf8", windowsHide: true, timeout: 30_000,
      });
      if (head.status !== 0 || subject.dutiesDigest !== dutyDigest(duties) ||
          subject.ownerDigest !== status.owner.digest || subject.head !== String(head.stdout).trim() ||
          subject.duty?.id !== duty.id) {
        throw lifecycleError("Owner waiver receipt is stale for duty state, Owner contract, or HEAD", 1);
      }
      Object.assign(duty, { dueState: "waived", waiverReceipt: waiver.file, updatedAt: now, waivedAt: now });
    } else throw lifecycleError("unknown follow-up duty transition " + options.action);
    validateDuties(duties, packageId, scope);
    writeAtomic(file, JSON.stringify(duties, null, 2) + "\n", { root: repoRoot });
    return duties;
  });
}

function activationPrefix(scope) {
  return "." + scope + ".activating-";
}

function cleanActivationRemnants(repoRoot, scope) {
  const runtime = join(repoRoot, ".unlazy");
  if (!existsSync(runtime)) return 0;
  let removed = 0;
  for (const entry of readdirSync(runtime, { withFileTypes: true })) {
    if (!entry.name.startsWith(activationPrefix(scope))) continue;
    if (!/^\.[A-Za-z0-9][A-Za-z0-9._-]{0,63}\.activating-[a-f0-9]{16}$/.test(entry.name) ||
        !entry.isDirectory() || entry.isSymbolicLink()) {
      throw lifecycleError("unsafe activation remnant requires manual inspection: .unlazy/" + entry.name);
    }
    const target = join(runtime, entry.name);
    assertNoLinkedComponent(repoRoot, target);
    rmSync(target, { recursive: true, force: false, maxRetries: 10, retryDelay: 25 });
    removed += 1;
  }
  return removed;
}

function writeInitialRuntime(directory, packageId, scope, sessionId, now, owner) {
  writeFileSync(join(directory, "package.ref"), "docs/packages/" + packageId + "\n", { encoding: "utf8", flag: "wx" });
  writeFileSync(join(directory, "owner.ref.json"), JSON.stringify(ownerBindingValue(packageId, owner), null, 2) + "\n",
    { encoding: "utf8", flag: "wx" });
  writeFileSync(join(directory, "session"), sessionId ? sessionId + "\n" : "\n", { encoding: "utf8", flag: "wx" });
  writeFileSync(join(directory, "status.log"), now + " package " + packageId + " activated\n", { encoding: "utf8", flag: "wx" });
  writeFileSync(join(directory, "hook-state.json"), JSON.stringify({ schema: 1, sessions: {} }, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
  writeFileSync(join(directory, "dispatch.json"), JSON.stringify(initialDispatchState(scope, packageId), null, 2) + "\n", { encoding: "utf8", flag: "wx" });
  writeFileSync(join(directory, "duties.json"), JSON.stringify(initialDuties(packageId, scope), null, 2) + "\n",
    { encoding: "utf8", flag: "wx" });
}

function lifecycleRegistry(repoRoot) {
  return join(repoRoot, ".unlazy", "lifecycle-registry");
}

export async function activatePackage(options) {
  const repoRoot = realpathSync(resolve(options.root));
  const packageId = String(options.packageId || "");
  const scope = String(options.scope || "");
  const invalidPackage = validatePackageId(packageId);
  const invalidScope = validateScopeId(scope);
  if (invalidPackage) throw lifecycleError(invalidPackage);
  if (invalidScope) throw lifecycleError(invalidScope);
  const sessionId = validateSessionId(options.sessionId);
  assertRuntimeIgnored(repoRoot);
  assertPackageModeBoundary(repoRoot, packageId);

  const initialTarget = resolvePackageTarget({ root: repoRoot, packageId, repoKey: options.repoKey || ".", env: {} });
  const initialStatus = inspectPackageBundle(initialTarget);
  if (initialStatus.diagnostics.length) {
    throw lifecycleError("cannot activate invalid package: " + initialStatus.diagnostics.map((item) => item.code).join(", "));
  }
  if (initialStatus.status === "closed") throw lifecycleError("closed package history cannot be activated again");

  return withFileLock(repoRoot, lifecycleRegistry(repoRoot), async () => {
    cleanActivationRemnants(repoRoot, scope);
    const records = listActiveScopes(repoRoot, { assertRoot: false, includeInvalid: true });
    const invalidRecords = records.filter((record) => record.error);
    if (invalidRecords.length) {
      throw lifecycleError("invalid active runtime blocks activation: " +
        invalidRecords.map((record) => record.scope + ": " + record.error).join("; "));
    }
    const existingScope = records.find((record) =>
      (process.platform === "win32" ? record.scope.toLowerCase() : record.scope) ===
      (process.platform === "win32" ? scope.toLowerCase() : scope));
    if (existingScope) {
      if (!samePackageId(existingScope.packageId, packageId)) {
        conflict("scope " + scope + " already binds package " + existingScope.packageId);
      }
      const directory = validateRuntimeBaseline(repoRoot, existingScope.scope, packageId);
      assertOwnerBinding(directory, packageId, initialStatus.owner);
      return {
        action: "activate",
        activated: false,
        recovered: true,
        repoRoot,
        repoKey: options.repoKey || ".",
        packageId,
        scope: existingScope.scope,
        status: publicPackageStatus(inspectPackageBundle(resolvePackageTarget({
          root: repoRoot, packageId, scope: existingScope.scope, repoKey: options.repoKey || ".", env: {},
        }))),
      };
    }
    const duplicate = records.find((record) => samePackageId(record.packageId, packageId));
    if (duplicate) conflict("package " + packageId + " is already active in scope " + duplicate.scope);

    const runtime = join(repoRoot, ".unlazy");
    mkdirSync(runtime, { recursive: true, mode: 0o700 });
    assertNoLinkedComponent(repoRoot, runtime);
    const temporary = join(runtime, activationPrefix(scope) + randomBytes(8).toString("hex"));
    const targetDirectory = join(runtime, scope);
    try {
      mkdirSync(temporary, { recursive: false, mode: 0o700 });
      const now = options.now || new Date().toISOString();
      if (Number.isNaN(Date.parse(now))) throw lifecycleError("now must be an ISO timestamp");
      writeInitialRuntime(temporary, packageId, scope, sessionId, now, initialStatus.owner);
      reach(options, "activate-before-publish");
      renameSync(temporary, targetDirectory);
      reach(options, "activate-after-publish");
    } catch (error) {
      if (error.code !== "UNLAZY_SIMULATED_CRASH") {
        try { rmSync(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 }); } catch { /* preserve primary error */ }
      }
      throw error;
    }
    const directory = validateRuntimeBaseline(repoRoot, scope, packageId);
    const currentStatus = inspectPackageBundle(resolvePackageTarget({
      root: repoRoot, packageId, scope, repoKey: options.repoKey || ".", env: {},
    }));
    assertOwnerBinding(directory, packageId, currentStatus.owner);
    const target = resolvePackageTarget({ root: repoRoot, packageId, scope, repoKey: options.repoKey || ".", env: {} });
    return {
      action: "activate",
      activated: true,
      recovered: false,
      repoRoot,
      repoKey: options.repoKey || ".",
      packageId,
      scope,
      status: publicPackageStatus(inspectPackageBundle(target)),
    };
  });
}

function readJournal(repoRoot, scope) {
  const path = join(scopeRoot(repoRoot, scope), "lifecycle.json");
  if (!existsSync(path)) return null;
  const info = lstatSync(path);
  if (info.isSymbolicLink() || !info.isFile() || (typeof info.nlink === "number" && info.nlink !== 1)) {
    throw lifecycleError("lifecycle journal must be a single-link regular file");
  }
  let value;
  try { value = JSON.parse(readFileSync(path, "utf8")); }
  catch (error) { throw lifecycleError("invalid lifecycle journal: " + error.message); }
  if (!value || value.schema !== LIFECYCLE_SCHEMA || typeof value.state !== "string" ||
      typeof value.scope !== "string" || typeof value.packageId !== "string") {
    throw lifecycleError("invalid lifecycle journal shape");
  }
  return { path, value };
}

function writeJournal(repoRoot, scope, value) {
  const path = join(scopeRoot(repoRoot, scope), "lifecycle.json");
  writeAtomic(path, JSON.stringify({ schema: LIFECYCLE_SCHEMA, ...value }, null, 2) + "\n", { root: repoRoot });
  return path;
}

function fileSnapshot(path) {
  const bytes = readFileSync(path);
  return { path, digest: digestBytes(bytes), bytes: bytes.length };
}

function snapshots(target) {
  return [fileSnapshot(target.packageFile), ...target.gateFiles.map(fileSnapshot)];
}

function sameSnapshots(left, right) {
  return left.length === right.length && left.every((item, index) =>
    item.path === right[index].path && item.digest === right[index].digest && item.bytes === right[index].bytes);
}

function closeDecisionIssues(target) {
  const issues = [];
  for (const file of [target.packageFile, ...target.gateFiles]) {
    const text = readFileSync(file, "utf8");
    if (/\bABANDON\b/i.test(text)) issues.push(slash(relative(target.repoRoot, file)) + ": ABANDON");
    if (/\bDEFER\b/i.test(text)) issues.push(slash(relative(target.repoRoot, file)) + ": DEFER");
    if (/\bOWNER_DECISION\b/i.test(text)) issues.push(slash(relative(target.repoRoot, file)) + ": OWNER_DECISION");
  }
  return issues;
}

function assertPreclose(status, target, options = {}, duties = null) {
  if (status.diagnostics.length) {
    throw lifecycleError("package schema is invalid: " + status.diagnostics.map((item) => item.code).join(", "));
  }
  if (status.plan.done !== status.plan.total || status.plan.total === 0) {
    throw lifecycleError("package plan is incomplete", 1);
  }
  if (status.contract.required === 0 || status.contract.covered !== status.contract.required) {
    throw lifecycleError("package contract coverage is incomplete", 1);
  }
  if (status.dispatch.unfinished !== 0) throw lifecycleError("package dispatch is unfinished", 1);
  assertDutiesClosable(duties);
  const decisions = closeDecisionIssues(target);
  if (decisions.length) throw lifecycleError("package has unresolved decisions: " + decisions.join("; "), 1);
  if (options.afterReverify) {
    if (status.gates.total === 0 || status.gates.met !== status.gates.total || status.gates.handoff !== 0) {
      throw lifecycleError("package gates are not all met after re-verification", 1);
    }
    if (status.status !== "closable") {
      throw lifecycleError("package is not closable after re-verification; status is " + status.status, 1);
    }
  }
}

function finalizePackageText(status, duties) {
  assertDutiesClosable(duties);
  let text = status._internal.parsed.text;
  const replacements = {
    Coverage: status.contract.covered + "/" + status.contract.required + " contract outcomes mapped; " +
      status.gates.met + "/" + status.gates.total + " met.",
    Fulfillment: "erfuellt - package-cli close reverified every executable gate and validated all closure dimensions.",
    "Geprueft gegen": "package-cli close --reverify; package schema version " + status.schemaVersion + ".",
    Offen: "nichts",
  };
  for (const [name, value] of Object.entries(replacements)) {
    const pattern = new RegExp("^" + name.replace(" ", "\\s+") + ":[^\\r\\n]*", "mi");
    if (!pattern.test(text)) throw lifecycleError("cannot finalize missing Abschluss field " + name);
    text = text.replace(pattern, name + ": " + value);
  }
  return text;
}

async function withOrderedLocks(repoRoot, paths, fn, index = 0) {
  if (index >= paths.length) return fn();
  return withFileLock(repoRoot, paths[index], () => withOrderedLocks(repoRoot, paths, fn, index + 1));
}

function defaultGateRunner(options) {
  const args = [GATE_CHECK, "--root", options.root, "--package", options.packageId,
    "--scope", options.scope, "--reverify"];
  if (options.timeoutSeconds !== undefined) args.push("--timeout", String(options.timeoutSeconds));
  if (options.jobs !== undefined) args.push("--jobs", String(options.jobs));
  if (options.shell !== undefined) args.push("--shell", String(options.shell));
  const result = spawnSync(process.execPath, args, {
    cwd: options.root,
    encoding: "utf8",
    windowsHide: true,
    timeout: options.runnerTimeoutMs || 24 * 60 * 60 * 1000,
    maxBuffer: 16 * 1024 * 1024,
    env: {
      ...process.env,
      ...(options.env || {}),
      UNLAZY_PACKAGE: "",
      UNLAZY_SCOPE: "",
    },
  });
  if (result.error) throw lifecycleError("gate re-verification could not run: " + result.error.message);
  return { status: result.status, stdout: result.stdout || "", stderr: result.stderr || "" };
}

function gateFailure(result) {
  const combined = (result.stdout + result.stderr).trim().split(/\r?\n/).slice(-8).join(" | ");
  const code = result.status === 1 ? 1 : result.status === 3 ? 3 : 2;
  return lifecycleError("gate re-verification exited " + result.status + (combined ? ": " + combined : ""), code);
}

async function cleanupClosedRuntime(repoRoot, scope, packageId, options) {
  const releasedLeases = await releaseLeases(repoRoot, { scope, packageId });
  reach(options, "close-after-release");
  const directory = validateRuntimeDirectory(repoRoot, scope);
  rmSync(directory, { recursive: true, force: false, maxRetries: 20, retryDelay: 50 });
  return releasedLeases;
}

export async function closePackage(options) {
  const repoRoot = realpathSync(resolve(options.root));
  const packageId = String(options.packageId || "");
  const scope = String(options.scope || "");
  const invalidPackage = validatePackageId(packageId);
  const invalidScope = validateScopeId(scope);
  if (invalidPackage) throw lifecycleError(invalidPackage);
  if (invalidScope) throw lifecycleError(invalidScope);
  assertPackageModeBoundary(repoRoot, packageId);

  return withFileLock(repoRoot, lifecycleRegistry(repoRoot), async () => {
    const records = listActiveScopes(repoRoot, { assertRoot: false, includeInvalid: true });
    const record = records.find((item) =>
      (process.platform === "win32" ? item.scope.toLowerCase() : item.scope) ===
      (process.platform === "win32" ? scope.toLowerCase() : scope));
    if (!record) throw lifecycleError("close requires active scope " + scope);
    if (record.error) throw lifecycleError("active scope is invalid: " + record.error);
    if (!samePackageId(record.packageId, packageId)) {
      conflict("scope " + scope + " binds package " + record.packageId + ", not " + packageId);
    }
    const runtimeDirectory = validateRuntimeBaseline(repoRoot, record.scope, packageId);
    const priorJournal = readJournal(repoRoot, record.scope);
    if (priorJournal && (!samePackageId(priorJournal.value.packageId, packageId) || priorJournal.value.scope !== record.scope)) {
      throw lifecycleError("lifecycle journal identity does not match active package target");
    }

    let target = resolvePackageTarget({
      root: repoRoot, packageId, scope: record.scope, repoKey: options.repoKey || ".", env: {},
    });
    let status = inspectPackageBundle(target);
    assertOwnerBinding(runtimeDirectory, packageId, status.owner);
    const duties = readDuties(runtimeDirectory, packageId, record.scope);
    if (status.status === "closed") {
      if (status.diagnostics.length) throw lifecycleError("closed package is invalid");
      const journal = readJournal(repoRoot, record.scope);
      const authorization = approvalConsumption(repoRoot, options.authorizationReceipt, "close", packageId, record.scope);
      if (!journal || journal.value.authorizationDigest !== authorization.value.recordDigest ||
          !sameFileSystemObject(journal.value.authorizationReceipt, authorization.file)) {
        throw lifecycleError("closed-package recovery requires the original Owner approval receipt", 1);
      }
      const releasedLeases = await cleanupClosedRuntime(repoRoot, record.scope, packageId, options);
      return {
        action: "close",
        closed: true,
        recovered: true,
        reverified: false,
        releasedLeases,
        repoRoot,
        repoKey: options.repoKey || ".",
        packageId,
        scope: record.scope,
        status: publicPackageStatus(inspectPackageBundle({ ...target, scope: null })),
        gateOutput: "",
      };
    }

    assertPreclose(status, target, {}, duties);
    const authorization = closeAuthorization(repoRoot, packageId, record.scope, status, duties, options.authorizationReceipt);
    const before = snapshots(target);
    writeJournal(repoRoot, record.scope, {
      state: "verifying",
      scope: record.scope,
      packageId,
      packageDigest: status.digest,
      authorizationReceipt: authorization.file,
      authorizationDigest: authorization.value.recordDigest,
      startedAt: options.now || new Date().toISOString(),
    });
    reach(options, "close-after-journal");

    const runner = options.gateRunner || defaultGateRunner;
    const gateResult = await runner({
      root: repoRoot,
      packageId,
      scope: record.scope,
      timeoutSeconds: options.timeoutSeconds,
      jobs: options.jobs,
      shell: options.shell,
      runnerTimeoutMs: options.runnerTimeoutMs,
      env: options.env,
    });
    if (!gateResult || !Number.isInteger(gateResult.status)) {
      throw lifecycleError("gate runner returned no integer status");
    }
    if (gateResult.status !== 0) {
      writeJournal(repoRoot, record.scope, {
        state: "blocked",
        scope: record.scope,
        packageId,
        packageDigest: status.digest,
        authorizationReceipt: authorization.file,
        authorizationDigest: authorization.value.recordDigest,
        gateExitCode: gateResult.status,
        attemptedAt: new Date().toISOString(),
      });
      throw gateFailure(gateResult);
    }
    reach(options, "close-after-reverify");

    target = resolvePackageTarget({
      root: repoRoot, packageId, scope: record.scope, repoKey: options.repoKey || ".", env: {},
    });
    status = inspectPackageBundle(target);
    assertOwnerBinding(runtimeDirectory, packageId, status.owner);
    assertPreclose(status, target, { afterReverify: true }, duties);
    const verified = snapshots(target);
    if (before[0].digest !== verified[0].digest) {
      conflict("PACKAGE.md changed while close re-verified gates; retry against the new digest");
    }
    writeJournal(repoRoot, record.scope, {
      state: "verified",
      scope: record.scope,
      packageId,
      packageDigest: status.digest,
      authorizationReceipt: authorization.file,
      authorizationDigest: authorization.value.recordDigest,
      verifiedAt: new Date().toISOString(),
      gateDigests: verified.slice(1).map((item) => ({
        file: slash(relative(repoRoot, item.path)), digest: item.digest,
      })),
    });

    const lockPaths = [target.packageFile, ...target.gateFiles, dispatchStatePath(repoRoot, record.scope),
      join(runtimeDirectory, "duties.json")]
      .map((path) => resolve(path))
      .sort((left, right) => {
        const a = process.platform === "win32" ? left.toLowerCase() : left;
        const b = process.platform === "win32" ? right.toLowerCase() : right;
        return a.localeCompare(b, "en");
      });
    let closedStatus;
    await withOrderedLocks(repoRoot, lockPaths, async () => {
      const finalTarget = resolvePackageTarget({
        root: repoRoot, packageId, scope: record.scope, repoKey: options.repoKey || ".", env: {},
      });
      const current = snapshots(finalTarget);
      if (!sameSnapshots(verified, current)) {
        conflict("package or gate ledger changed after re-verification; close refused stale writeback");
      }
      const finalStatus = inspectPackageBundle(finalTarget);
      assertOwnerBinding(runtimeDirectory, packageId, finalStatus.owner);
      const finalDuties = readDuties(runtimeDirectory, packageId, record.scope);
      if (dutyDigest(finalDuties) !== dutyDigest(duties)) {
        conflict("follow-up duties changed after Owner approval; close refused stale writeback");
      }
      assertPreclose(finalStatus, finalTarget, { afterReverify: true }, finalDuties);
      writeAtomic(finalTarget.packageFile, finalizePackageText(finalStatus, finalDuties));
      closedStatus = inspectPackageBundle(finalTarget);
      if (closedStatus.status !== "closed" || closedStatus.diagnostics.length) {
        throw lifecycleError("internal close validation did not produce a valid closed package");
      }
      writeJournal(repoRoot, record.scope, {
        state: "package-closed",
        scope: record.scope,
        packageId,
        packageDigest: closedStatus.digest,
        authorizationReceipt: authorization.file,
        authorizationDigest: authorization.value.recordDigest,
        dutiesDigest: dutyDigest(finalDuties),
        closedAt: new Date().toISOString(),
      });
    });
    reach(options, "close-after-package-write");
    await appendStatus(repoRoot, record.scope, new Date().toISOString() + " package " + packageId + " closed");
    const releasedLeases = await cleanupClosedRuntime(repoRoot, record.scope, packageId, options);
    return {
      action: "close",
      closed: true,
      recovered: false,
      reverified: true,
      releasedLeases,
      repoRoot,
      repoKey: options.repoKey || ".",
      packageId,
      scope: record.scope,
      status: publicPackageStatus(inspectPackageBundle({ ...target, scope: null })),
      gateOutput: String(gateResult.stdout || "").trim(),
      authorizationReceipt: authorization.file,
      duties,
    };
  });
}
