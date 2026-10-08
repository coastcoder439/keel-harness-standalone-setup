import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { execFile, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { claimLeases, readLeases } from "../scripts/lib/gates.mjs";
import {
  activatePackage,
  closePackage,
  SimulatedLifecycleCrash,
} from "../scripts/lib/package-lifecycle.mjs";
import { inspectPackageBundle } from "../scripts/lib/package-schema.mjs";
import { resolvePackageTarget } from "../scripts/lib/packages.mjs";
import { hardenWindowsPrivateDirectory } from "../scripts/lib/windows-acl.mjs";
import { git, initRepository } from "./helpers/git-repo.mjs";
import { emitTestCounts } from "./helpers/test-counts.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const packageCli = join(here, "..", "scripts", "package-cli.mjs");
const gateCheck = join(here, "..", "scripts", "gate-check.mjs");
const suiteRoot = mkdtempSync(join(tmpdir(), "unlazy-package-lifecycle-"));
const approvals = mkdtempSync(join(suiteRoot, "approvals-"));
if (process.platform === "win32") hardenWindowsPrivateDirectory(approvals);

function repo(name, ignored = true) {
  const root = join(suiteRoot, name);
  initRepository(root);
  writeFileSync(join(root, ".gitignore"), ignored ? ".unlazy/\n" : "# runtime is not ignored\n", "utf8");
  return root;
}

function packageText(packageId, options = {}) {
  const plan = options.plan || "1. [x] Implement the observable package outcome.";
  const status = options.status || "Implementation is complete; executable verification remains authoritative.";
  const fulfillment = options.fulfillment || "nicht erfuellt - close has not reverified the gate.";
  const open = options.open || "Gate re-verification and close.";
  return `# Work package: ${packageId}

**Problem:** The outcome needs a deterministic lifecycle.
**Intent:** Bind runtime state to exactly one versioned package bundle.
**Goal:** Activation and closure are machine-validated.

## Plan

${plan}

## Status

${status}

## Abnahme

- C1 -> GATES.md:G1: The lifecycle verifier observes the package outcome.

## Abschluss

Coverage: 1/1 contract outcomes mapped; 0/1 met.
Fulfillment: ${fulfillment}
Geprueft gegen: pending package-cli close.
Offen: ${open}

## Anhang

Lifecycle fixture.
`;
}

function gateText(options = {}) {
  if (options.abandon) {
    return `# Gates: lifecycle

- [ ] G1: the lifecycle outcome is explicitly handed off
  EVIDENCE: pending

ABANDON: G1 owner decision is required
`;
  }
  if (options.manualMet) {
    return `# Gates: lifecycle

- [x] G1: the lifecycle outcome is manually measured
  EVIDENCE: measured by the fixture
`;
  }
  return `# Gates: lifecycle

- [ ] G1: the lifecycle verifier observes the package outcome
  CHECK: node scripts/check-lifecycle.mjs
  EXPECT: LIFECYCLE VERIFIED
  EVIDENCE: pending
`;
}

function ownerText(packageId, request = "Build the exact lifecycle outcome requested by the Owner.") {
  return `# Owner contract: ${packageId}
Schema: 1
Source: lifecycle fixture
Captured: 2026-08-30

## Original request

${request}

## Requirements

- R1 -> C1: The lifecycle outcome is proven, not merely planned.
`;
}

function bundle(root, packageId, options = {}) {
  const directory = join(root, "docs", "packages", packageId);
  mkdirSync(join(directory, "gates"), { recursive: true });
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(join(directory, "PACKAGE.md"), packageText(packageId, options), "utf8");
  writeFileSync(join(directory, "GATES.md"), options.gates || gateText(options), "utf8");
  if (options.owner) {
    writeFileSync(join(root, ".keel-harness.json"),
      JSON.stringify({ schemaVersion: 1, packageContract: { ownerContractRequired: true } }, null, 2) + "\n", "utf8");
    writeFileSync(join(directory, "OWNER.md"), ownerText(packageId), "utf8");
  }
  writeFileSync(join(directory, "gates", ".gitkeep"), "", "utf8");
  writeFileSync(join(root, "scripts", "check-lifecycle.mjs"),
    options.checkScript || "console.log('LIFECYCLE VERIFIED');\n", "utf8");
  git(root, "add", ".");
  git(root, "commit", "--quiet", "-m", "lifecycle fixture");
  return directory;
}

function run(script, root, ...args) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    timeout: 60000,
    env: {
      ...process.env,
      UNLAZY_APPROVAL_DIR: approvals,
      UNLAZY_PACKAGE: "",
      UNLAZY_SCOPE: "",
    },
  });
}

function runAsync(script, root, ...args) {
  return new Promise((resolveResult) => {
    execFile(process.execPath, [script, ...args], {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
      timeout: 60000,
      maxBuffer: 4 * 1024 * 1024,
      env: {
        ...process.env,
        UNLAZY_APPROVAL_DIR: approvals,
        UNLAZY_PACKAGE: "",
        UNLAZY_SCOPE: "",
      },
    }, (error, stdout, stderr) => resolveResult({
      status: error ? (typeof error.code === "number" ? error.code : 1) : 0,
      stdout: stdout || "",
      stderr: stderr || "",
    }));
  });
}

function activate(root, packageId, scope = "main", session = "session-one") {
  return run(packageCli, root, "activate", "--root", root, "--package", packageId,
    "--scope", scope, "--session", session);
}

function approve(root, packageId, scope = "main") {
  return run(gateCheck, root, "--approve", "--root", root, "--package", packageId, "--scope", scope);
}

function status(root, packageId) {
  return inspectPackageBundle(resolvePackageTarget({ root, packageId, env: {} }));
}

function assessDuties(root, packageId, scope = "main") {
  return run(packageCli, root, "duty-assess", "--root", root, "--package", packageId,
    "--scope", scope, "--gate", "GATES.md:G1");
}

function forceAssessedDuties(root, packageId, scope = "main") {
  const file = join(root, ".unlazy", scope, "duties.json");
  const duties = JSON.parse(readFileSync(file, "utf8"));
  duties.assessment = {
    state: "complete",
    gate: "GATES.md:G1",
    assessedAt: "2026-08-30T00:00:00.000Z",
  };
  writeFileSync(file, JSON.stringify(duties, null, 2) + "\n", "utf8");
  return duties;
}

function todayLocal(now = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate());
}

// Der Freigabebeleg ist die Owner-OK-Zeile im Abschnitt "## Abschluss" der PACKAGE.md.
function writeCloseOwnerOk(root, packageId, wording = "Owner-OK lifecycle fixture") {
  const file = join(root, "docs", "packages", packageId, "PACKAGE.md");
  const head = `Owner-OK: close ${todayLocal()} ${git(root, "rev-parse", "--verify", "HEAD")}`;
  // P14 (D13): a short one-line wording stands in the line, any other wording as a block of quoted lines under the head
  const line = /^[^"\r\n]{1,500}$/u.test(wording) ? head + ' "' + wording + '"'
    : [head, ...wording.split("\n").map((entry) => (entry === "" ? "    >" : "    > " + entry))].join("\n");
  const lines = readFileSync(file, "utf8").split("\n");
  const start = lines.findIndex((entry) => entry.trim() === "## Abschluss");
  assert.notEqual(start, -1, "fixture package needs an Abschluss section");
  let end = lines.findIndex((entry, index) => index > start && entry.startsWith("## "));
  if (end === -1) end = lines.length;
  while (end > start + 1 && !lines[end - 1].trim()) end -= 1;
  lines.splice(end, 0, ...line.split("\n"));
  writeFileSync(file, lines.join("\n"), "utf8");
  return line;
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test("activate publishes the complete runtime atomically and rejects duplicate package bindings", () => {
  const root = repo("activate");
  bundle(root, "alpha");
  const activated = activate(root, "alpha", "main", "session-a");
  assert.equal(activated.status, 0, activated.stderr + activated.stdout);
  const runtime = join(root, ".unlazy", "main");
  assert.deepEqual(readdirSync(runtime).sort(), [
    "dispatch.json", "duties.json", "hook-state.json", "owner.ref.json", "package.ref", "session", "status.log",
  ]);
  assert.equal(readFileSync(join(runtime, "package.ref"), "utf8"), "docs/packages/alpha\n");
  assert.equal(readFileSync(join(runtime, "session"), "utf8"), "session-a\n");
  assert.deepEqual(JSON.parse(readFileSync(join(runtime, "dispatch.json"), "utf8")), {
    schema: 2, scope: "main", packageId: "alpha", waves: {},
  });
  assert.equal(JSON.parse(readFileSync(join(runtime, "hook-state.json"), "utf8")).schema, 1);
  assert.deepEqual(JSON.parse(readFileSync(join(runtime, "duties.json"), "utf8")), {
    schema: 1,
    packageId: "alpha",
    scope: "main",
    assessment: { state: "unknown", gate: null, assessedAt: null },
    duties: {},
  });
  assert.deepEqual(JSON.parse(readFileSync(join(runtime, "owner.ref.json"), "utf8")), {
    schema: 1, packageId: "alpha", required: false, present: false, digest: null, requestDigest: null,
  });
  assert.equal(status(root, "alpha").status, "active");

  const duplicate = activate(root, "alpha", "other", "session-b");
  assert.equal(duplicate.status, 3, duplicate.stderr + duplicate.stdout);
  assert.match(duplicate.stderr, /already active in scope main/);
  assert.equal(existsSync(join(root, ".unlazy", "other")), false);
});

test("activation crash remnants are undiscoverable and the next activation recovers them", async () => {
  const root = repo("activate-recovery");
  bundle(root, "recover");
  await assert.rejects(() => activatePackage({
    root,
    packageId: "recover",
    scope: "main",
    failpoint(point) {
      if (point === "activate-before-publish") throw new SimulatedLifecycleCrash(point);
    },
  }), /simulated lifecycle crash/);
  assert.equal(existsSync(join(root, ".unlazy", "main")), false);
  assert.equal(readdirSync(join(root, ".unlazy")).filter((name) => name.startsWith(".main.activating-")).length, 1);
  const recovered = activate(root, "recover");
  assert.equal(recovered.status, 0, recovered.stderr + recovered.stdout);
  assert.equal(readdirSync(join(root, ".unlazy")).filter((name) => name.startsWith(".main.activating-")).length, 0);
});

test("activation fails before runtime writes when .unlazy is not ignored", () => {
  const root = repo("ignore-preflight", false);
  bundle(root, "alpha");
  const result = activate(root, "alpha");
  assert.equal(result.status, 2, result.stderr + result.stdout);
  assert.match(result.stderr, /requires an effective exact \.unlazy/);
  assert.equal(existsSync(join(root, ".unlazy")), false);
});

test("activation freezes the complete Owner contract and direct activate/close reject later replacement", () => {
  const root = repo("owner-binding");
  const directory = bundle(root, "alpha", { owner: true });
  const activated = activate(root, "alpha");
  assert.equal(activated.status, 0, activated.stderr + activated.stdout);
  const binding = JSON.parse(readFileSync(join(root, ".unlazy", "main", "owner.ref.json"), "utf8"));
  assert.equal(binding.required, true);
  assert.match(binding.digest, /^sha256:[a-f0-9]{64}$/u);
  writeFileSync(join(directory, "OWNER.md"), ownerText("alpha",
    "Replace the original outcome with a later and easier Owner-shaped request."), "utf8");

  const repeated = activate(root, "alpha");
  assert.equal(repeated.status, 3, repeated.stderr + repeated.stdout);
  assert.match(repeated.stderr, /immutable Owner contract changed/);
  const closed = run(packageCli, root, "close", "--root", root, "--package", "alpha", "--scope", "main");
  assert.equal(closed.status, 3, closed.stderr + closed.stdout);
  assert.match(closed.stderr, /immutable Owner contract changed/);
  assert.equal(existsSync(join(root, ".unlazy", "main")), true);
});

test("missing or legacy runtime refs fail closed in package resolution", () => {
  const root = repo("missing-ref");
  bundle(root, "alpha");
  mkdirSync(join(root, ".unlazy", "broken"), { recursive: true });
  writeFileSync(join(root, ".unlazy", "broken", "GATES.md"), "# legacy\n", "utf8");
  const result = run(packageCli, root, "status", "--root", root, "--scope", "broken");
  assert.equal(result.status, 2, result.stderr + result.stdout);
  assert.match(result.stderr, /missing package\.ref|invalid scope/);
});

test("activation retires the runtime of a removed package and reports it, while other invalid runtime still blocks", async () => {
  const root = repo("orphan-runtime");
  bundle(root, "alpha");
  mkdirSync(join(root, ".unlazy", "removed"), { recursive: true });
  writeFileSync(join(root, ".unlazy", "removed", "package.ref"), "docs/packages/gone\n", "utf8");
  writeFileSync(join(root, ".unlazy", "removed", "status.log"), "2026-09-09T00:00:00.000Z package gone activated\n", "utf8");
  const result = await activatePackage({ root, packageId: "alpha", scope: "main", sessionId: "session-orphan" });
  assert.equal(result.activated, true);
  assert.equal(result.retiredScopes.length, 1);
  assert.equal(result.retiredScopes[0].scope, "removed");
  assert.equal(result.retiredScopes[0].packageId, "gone");
  assert.match(result.retiredScopes[0].movedTo, /^\.unlazy\/\.retired\/removed-/u);
  assert.equal(existsSync(join(root, ".unlazy", "removed")), false);
  const retired = readdirSync(join(root, ".unlazy", ".retired"));
  assert.equal(retired.length, 1);
  assert.equal(readFileSync(join(root, ".unlazy", ".retired", retired[0], "package.ref"), "utf8"), "docs/packages/gone\n");
  assert.equal(status(root, "alpha").status, "active");

  const blocked = repo("broken-runtime-still-blocks");
  bundle(blocked, "alpha");
  mkdirSync(join(blocked, ".unlazy", "broken"), { recursive: true });
  writeFileSync(join(blocked, ".unlazy", "broken", "GATES.md"), "# legacy\n", "utf8");
  const refused = activate(blocked, "alpha");
  assert.equal(refused.status, 2, refused.stderr + refused.stdout);
  assert.match(refused.stderr, /invalid active runtime blocks activation/u);
  assert.equal(existsSync(join(blocked, ".unlazy", "broken")), true);
  assert.equal(existsSync(join(blocked, ".unlazy", ".retired")), false);
});

test("close actually reverifies, writes a valid receipt, releases only its leases, and removes only its scope", async () => {
  const root = repo("close-success");
  bundle(root, "alpha");
  assert.equal(activate(root, "alpha").status, 0);
  const approved = approve(root, "alpha");
  assert.equal(approved.status, 0, approved.stderr + approved.stdout);
  const assessed = assessDuties(root, "alpha");
  assert.equal(assessed.status, 0, assessed.stderr + assessed.stdout);
  assert.equal((await claimLeases(root, {
    scope: "main", packageId: "alpha", leaf: "leaf-owned",
    ledger: "docs/packages/alpha/gates/leaf-owned.md", globs: ["src/alpha/**"],
  })).ok, true);
  assert.equal((await claimLeases(root, { scope: "foreign", leaf: "owned", globs: ["src/foreign/**"] })).ok, true);

  writeCloseOwnerOk(root, "alpha");
  const closed = run(packageCli, root, "close", "--root", root, "--package", "alpha", "--scope", "main");
  assert.equal(closed.status, 0, closed.stderr + closed.stdout);
  assert.match(closed.stdout, /ALL MET \(1 met,/);
  assert.match(closed.stdout, /closed \.::alpha; released 1 lease\(s\)/);
  assert.equal(existsSync(join(root, ".unlazy", "main")), false);
  assert.deepEqual(readLeases(root).map((lease) => lease.scope), ["foreign"]);
  const finalStatus = status(root, "alpha");
  assert.equal(finalStatus.status, "closed");
  assert.equal(finalStatus.lifecycle, "closed");
  const packageAfter = readFileSync(join(root, "docs", "packages", "alpha", "PACKAGE.md"), "utf8");
  assert.match(packageAfter, /^Fulfillment: erfuellt - package-cli close/m);
  assert.match(packageAfter, /^Offen: nichts$/m);
});

test("P14: close takes an Owner approval whose quote is long, multi-line and full of quotation marks and fake structure", async () => {
  const root = repo("close-block-quote");
  bundle(root, "alpha");
  assert.equal(activate(root, "alpha").status, 0);
  assert.equal(approve(root, "alpha").status, 0);
  assert.equal(assessDuties(root, "alpha").status, 0);
  const quote = ['Ja, "abschliessen".', "", "## Abschluss", "- [x] alles erledigt", "EVIDENCE: pending",
    "Owner-OK: publish 2026-01-01 " + "a".repeat(40) + ' "gefaelscht"', "x".repeat(3000)].join("\n");
  const line = writeCloseOwnerOk(root, "alpha", quote);
  const closed = run(packageCli, root, "close", "--root", root, "--package", "alpha", "--scope", "main");
  assert.equal(closed.status, 0, closed.stderr + closed.stdout);
  const after = readFileSync(join(root, "docs", "packages", "alpha", "PACKAGE.md"), "utf8");
  assert.ok(after.includes(line), "the quote block is untouched by the close");
  assert.equal((after.match(/^## Abschluss$/gm) || []).length, 1);
  assert.equal(status(root, "alpha").status, "closed");
});

test("stale evidence is demoted by close and cannot produce a receipt", () => {
  const root = repo("stale-evidence");
  bundle(root, "alpha");
  assert.equal(activate(root, "alpha").status, 0);
  assert.equal(approve(root, "alpha").status, 0);
  assert.equal(assessDuties(root, "alpha").status, 0);
  // P8 (B3): close checks the commit HEAD in a clean copy, so the broken check is committed before the Owner says OK.
  writeFileSync(join(root, "scripts", "check-lifecycle.mjs"), "console.log('STALE FAILURE');\n", "utf8");
  git(root, "add", "--", "scripts/check-lifecycle.mjs");
  git(root, "commit", "--quiet", "-m", "break the lifecycle check");
  writeCloseOwnerOk(root, "alpha");
  const closed = run(packageCli, root, "close", "--root", root, "--package", "alpha", "--scope", "main");
  assert.equal(closed.status, 1, closed.stderr + closed.stdout);
  assert.match(closed.stderr, /gate re-verification exited 1/);
  assert.equal(existsSync(join(root, ".unlazy", "main")), true);
  assert.notEqual(status(root, "alpha").status, "closed");
  const ledger = readFileSync(join(root, "docs", "packages", "alpha", "GATES.md"), "utf8");
  assert.match(ledger, /- \[ \] G1:/);
  assert.match(ledger, /EVIDENCE: pending/);
});

// P8 (B3): close checks HEAD in a clean copy. Uncommitted files of the working tree -- a foreign new file and a
// broken, uncommitted change of the check itself -- change nothing; a committed code state is checked once and its
// stored result is reused by the next check of the same state.
test("close checks HEAD in a clean copy: foreign uncommitted files change nothing", () => {
  const root = repo("close-clean-copy");
  bundle(root, "alpha");
  assert.equal(activate(root, "alpha").status, 0);
  assert.equal(approve(root, "alpha").status, 0);
  assert.equal(assessDuties(root, "alpha").status, 0);
  const head = git(root, "rev-parse", "HEAD");
  const proved = run(gateCheck, root, "--reverify", "--at", head, "--root", root, "--package", "alpha", "--scope", "main");
  assert.equal(proved.status, 0, proved.stderr + proved.stdout);
  writeFileSync(join(root, "foreign-session-notes.txt"), "uncommitted work of another session\n", "utf8");
  writeFileSync(join(root, "scripts", "check-lifecycle.mjs"), "process.exit(7);\n", "utf8");
  writeCloseOwnerOk(root, "alpha");
  const closed = run(packageCli, root, "close", "--root", root, "--package", "alpha", "--scope", "main", "--json");
  assert.equal(closed.status, 0, closed.stderr + closed.stdout);
  const result = JSON.parse(closed.stdout);
  assert.equal(result.closed, true);
  assert.equal(result.checkedAt, head);
  assert.match(result.gateOutput, /PROOF_REUSED/u);
  assert.doesNotMatch(result.gateOutput, /^ {2}RUN /mu);
  const packageAfter = readFileSync(join(root, "docs", "packages", "alpha", "PACKAGE.md"), "utf8");
  assert.ok(packageAfter.includes("Fulfillment: erfuellt - package-cli close verified every executable gate at commit " + head),
    packageAfter);
  assert.equal(readFileSync(join(root, "foreign-session-notes.txt"), "utf8"), "uncommitted work of another session\n");
  assert.equal(readFileSync(join(root, "scripts", "check-lifecycle.mjs"), "utf8"), "process.exit(7);\n");
});

test("close rejects handoff, deferred owner decisions, and unfinished dispatch before a receipt", () => {
  const handoffRoot = repo("handoff");
  bundle(handoffRoot, "alpha", { abandon: true });
  assert.equal(activate(handoffRoot, "alpha").status, 0);
  forceAssessedDuties(handoffRoot, "alpha");
  const handoff = run(packageCli, handoffRoot, "close", "--root", handoffRoot,
    "--package", "alpha", "--scope", "main");
  assert.equal(handoff.status, 1, handoff.stderr + handoff.stdout);
  assert.match(handoff.stderr, /unresolved decisions.*ABANDON/);

  const deferredRoot = repo("deferred");
  bundle(deferredRoot, "alpha", { manualMet: true, status: "DEFER OWNER_DECISION remains unresolved." });
  assert.equal(activate(deferredRoot, "alpha").status, 0);
  assert.equal(assessDuties(deferredRoot, "alpha").status, 0);
  const deferred = run(packageCli, deferredRoot, "close", "--root", deferredRoot,
    "--package", "alpha", "--scope", "main");
  assert.equal(deferred.status, 1, deferred.stderr + deferred.stdout);
  assert.match(deferred.stderr, /unresolved decisions/);

  const dispatchRoot = repo("dispatch-open");
  bundle(dispatchRoot, "alpha", { manualMet: true });
  assert.equal(activate(dispatchRoot, "alpha").status, 0);
  assert.equal(assessDuties(dispatchRoot, "alpha").status, 0);
  const at = new Date().toISOString();
  writeFileSync(join(dispatchRoot, ".unlazy", "main", "dispatch.json"), JSON.stringify({
    schema: 2,
    scope: "main",
    packageId: "alpha",
    waves: {
      wave: {
        scope: "main", packageId: "alpha", leaves: ["leaf"], state: "open", openedAt: at,
        started: {}, returned: {},
      },
    },
  }, null, 2) + "\n", "utf8");
  const dispatch = run(packageCli, dispatchRoot, "close", "--root", dispatchRoot,
    "--package", "alpha", "--scope", "main");
  assert.equal(dispatch.status, 1, dispatch.stderr + dispatch.stdout);
  assert.match(dispatch.stderr, /dispatch is unfinished/);
});

test("close crash after the package receipt resumes cleanup without a second receipt", async () => {
  const root = repo("close-recovery");
  bundle(root, "alpha");
  assert.equal(activate(root, "alpha").status, 0);
  assert.equal(approve(root, "alpha").status, 0);
  assert.equal(assessDuties(root, "alpha").status, 0);
  writeCloseOwnerOk(root, "alpha");
  await assert.rejects(() => closePackage({
    root,
    packageId: "alpha",
    scope: "main",
    env: { ...process.env, UNLAZY_APPROVAL_DIR: approvals },
    failpoint(point) {
      if (point === "close-after-package-write") throw new SimulatedLifecycleCrash(point);
    },
  }), /simulated lifecycle crash/);
  assert.equal(status(root, "alpha").status, "closed");
  assert.equal(existsSync(join(root, ".unlazy", "main", "lifecycle.json")), true);
  const recovered = run(packageCli, root, "close", "--root", root, "--package", "alpha", "--scope", "main");
  assert.equal(recovered.status, 0, recovered.stderr + recovered.stdout);
  assert.match(recovered.stdout, /recovered closed/);
  assert.equal(existsSync(join(root, ".unlazy", "main")), false);
});

test("parallel package reverify writeback remains valid and deterministic", async () => {
  const root = repo("parallel-writeback");
  bundle(root, "alpha");
  assert.equal(activate(root, "alpha").status, 0);
  assert.equal(approve(root, "alpha").status, 0);
  const results = await Promise.all(Array.from({ length: 8 }, () => runAsync(
    gateCheck, root, "--root", root, "--package", "alpha", "--scope", "main", "--reverify",
  )));
  assert.equal(results.every((result) => result.status === 0), true,
    results.map((result) => result.stderr + result.stdout).join("\n---\n"));
  const ledger = readFileSync(join(root, "docs", "packages", "alpha", "GATES.md"), "utf8");
  assert.equal((ledger.match(/- \[x\] G1:/g) || []).length, 1);
  assert.equal((ledger.match(/EVIDENCE: schema=2;/g) || []).length, 1);
  assert.equal(status(root, "alpha").status, "closable");
});

test("legacy collisions never fall through package mode and legacy discovery is explicit", () => {
  const flatRoot = repo("flat-collision");
  bundle(flatRoot, "alpha");
  writeFileSync(join(flatRoot, "docs", "packages", "alpha.md"), "# old package\n", "utf8");
  const flat = run(packageCli, flatRoot, "status", "--root", flatRoot, "--package", "alpha");
  assert.equal(flat.status, 2, flat.stderr + flat.stdout);
  assert.match(flat.stderr, /legacy fach state/);

  const rootGate = repo("root-gate-collision");
  bundle(rootGate, "alpha");
  writeFileSync(join(rootGate, "GATES.md"), gateText({ manualMet: true }), "utf8");
  const packageMode = run(gateCheck, rootGate, "--status", "--root", rootGate, "--package", "alpha");
  assert.equal(packageMode.status, 2, packageMode.stderr + packageMode.stdout);
  assert.match(packageMode.stderr, /legacy fach state/);

  const legacyRoot = repo("legacy-explicit");
  writeFileSync(join(legacyRoot, "GATES.md"), gateText({ manualMet: true }), "utf8");
  const implicit = run(gateCheck, legacyRoot, "--status", "--root", legacyRoot);
  assert.equal(implicit.status, 2, implicit.stderr + implicit.stdout);
  assert.match(implicit.stderr, /legacy fach state is opt-in/);
  const explicit = run(gateCheck, legacyRoot, "--legacy", "--status", "--root", legacyRoot);
  assert.equal(explicit.status, 0, explicit.stderr + explicit.stdout);
  assert.match(explicit.stdout, /ALL MET \(1 met\)/);
});

let passed = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    passed += 1;
    console.log("ok   " + name);
  } catch (error) {
    console.error("FAIL " + name);
    console.error("     " + (error.stack || error.message));
    process.exitCode = 1;
  }
}

process.on("exit", () => {
  try { rmSync(suiteRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); } catch { /* best effort */ }
});

emitTestCounts("package-lifecycle-tests", {
  tests: tests.length, pass: passed, fail: tests.length - passed, skip: 0,
});
if (!process.exitCode) console.log(`\n${passed}/${tests.length} passed, 0 skipped`);
