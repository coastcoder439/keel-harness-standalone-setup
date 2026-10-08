#!/usr/bin/env node
"use strict";

// PreToolUse for Write/Edit/NotebookEdit. A write is allowed on exactly one of three
// routes, decided in this order; no prompt scoring or filename guessing:
//   1. Leaf binding: the session is bound to one active package leaf and the target
//      matches that leaf's exact OWNS declaration (package-executor next/start).
//   2. Planning binding: before activation one session writes the contract bundle of
//      one package (package-standard.mjs create, package-bootstrap.cjs).
//   3. Amendment of an active package: after activation one session updates status,
//      plan and leaves -- PACKAGE.md, GATES.md and gates/*.md, never OWNER.md -- under
//      its amendment record (package-amend.mjs begin/finish/undo, package-amend.cjs).
// Beside the three routes the session that planned or orchestrates a package writes the
// evidence/** and design/** folders of that one package directly (D1; never PACKAGE.md,
// GATES.md, gates/**, OWNER.md). A session without any package record is refused without a
// Git process (A16, session-records.cjs); a resumed conversation gets its planning binding
// back from its transcript first (D15, package-bootstrap.cjs adoptByTranscript).
// A denial names the allowed route as NEXT: the amendment route for a bundle file of
// an active package, otherwise the planning route, with the flat-package import and the
// repository preparation when the repository needs them.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const GUARD_TARGET = ".claude/paket-gate.js";

// Inline deny transport (identical in every PreToolUse guard; guard-parity E5): a missing
// sibling module must never turn a denial into an allow. Under the Codex hook runner a
// JSON deny with exit 0 survives Windows PowerShell, which maps a native exit 2 to 1.
// Every other error of the hook process denies the same way (guard-parity A9, fail closed): the
// two handlers are armed here, before any helper module loads, so a failure while loading, a throw
// inside the decision and an unhandled rejection all end in block(). Only the hook main program is
// armed; a library require and --self-test are not. KEEL_GUARD_TEST_THROW forces an error for the
// tests: "1" throws at load, "reject" leaves an unhandled rejection, "late" throws after the input ended.
function block(message) {
  const reason = String(message).trim() || GUARD_TARGET + ": tool denied";
  if (process.env.KEEL_HARNESS_ROOT && process.env.KEEL_HOOK_TARGET === GUARD_TARGET) {
    fs.writeSync(1, JSON.stringify({ hookSpecificOutput: {
      hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason,
    } }) + "\n");
    process.exit(0);
  }
  fs.writeSync(2, reason + "\n");
  process.exit(2);
}
if (require.main === module && !process.argv.some((arg) => arg === "--self-test" || arg === "--selbsttest")) {
  const failClosed = (error) => {
    try {
      block(GUARD_TARGET.replace(/^.*\//u, "").replace(/\.c?js$/u, "") + ": internal error; tool blocked: " +
        ((error && error.message) || error));
    } catch { process.exit(2); }
  };
  process.on("uncaughtException", failClosed);
  process.on("unhandledRejection", failClosed);
  const forced = process.env.KEEL_GUARD_TEST_THROW;
  if (forced === "reject") Promise.reject(new Error("forced test error"));
  if (forced === "late") process.stdin.once("end", () => { throw new Error("forced test error"); });
  if (forced === "1") throw new Error("forced test error");
}
// End inline deny transport

let packageBinding;
let packageBootstrap;
let sessionRecords;
let hookActivity;
let packageAmend;
let repository;
let hookContext;
let ownerHandoff;
let guardRoutes;
let sessionScope;
try {
  packageBinding = require("../harness-core/binding/package-binding.cjs");
  packageBootstrap = require("../harness-core/binding/package-bootstrap.cjs");
  sessionRecords = require("../harness-core/binding/session-records.cjs");
  hookActivity = require("../harness-core/binding/hook-activity.cjs");
  packageAmend = require("../harness-core/binding/package-amend.cjs");
  repository = require("../harness-core/binding/repository.cjs");
  hookContext = require("../harness-core/guards/hook-context.cjs");
  ownerHandoff = require("../harness-core/guards/owner-handoff.cjs");
  guardRoutes = require("../harness-core/guards/guard-routes.cjs");
  sessionScope = require("../harness-core/guards/session-scope.cjs");
} catch (error) {
  if (require.main === module) block("paket-gate: dependency load failed; write blocked: " + error.message);
  throw error;
}

// P20, D14: optional, only the self-test uses Git; a tree without the helper keeps working with plain git.
let gitBinary = null;
try { gitBinary = require("../harness-core/git/git-binary.cjs"); } catch { /* plain git */ }

function writeTarget(projectRoot, toolName, input) {
  if (!/^(Write|Edit|NotebookEdit)$/u.test(String(toolName || ""))) return null;
  const raw = input.file_path || input.notebook_path;
  if (!raw || typeof raw !== "string" || raw.includes("\0")) return null;
  return path.resolve(projectRoot, hookContext.msysPath(raw));
}

function quoted(value) {
  return "\"" + value + "\"";
}

// The planning route: package-standard.mjs create, plus the flat-package import and the
// repository preparation when the target's repository needs them (one readdir and one
// text read, no further Git process).
function exactNextStep(projectRoot, { target, sessionId, repoHint } = {}) {
  const tool = quoted(path.join(projectRoot, ".claude", "skills", "package-standard", "package-standard.mjs"));
  let targetRepo = null;
  // repoHint is a repository root found without Git (an unbound session's denial needs no Git process, A16).
  if (repoHint) targetRepo = repoHint;
  else if (target) {
    try { targetRepo = repository.resolveRepositoryRoot(target); } catch { targetRepo = null; }
  }
  const repo = targetRepo || projectRoot;
  let next = "node " + tool + " create --harness-root " + quoted(projectRoot) + " --root " +
    (targetRepo ? quoted(targetRepo) : "<exactGitRepo>") + " --package <packageId> --session " +
    (sessionId || "<sessionId>") + " --owner-request-file <Datei>";
  let flat = [];
  try {
    flat = fs.readdirSync(path.join(repo, "docs", "packages"), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && entry.name !== "TEMPLATE.md")
      .map((entry) => entry.name).sort();
  } catch { flat = []; }
  if (flat.length) {
    next += "; alte Pakete umwandeln (" + flat.length + " flache Paketdateien): node " + tool + " import --kind flat --root " +
      quoted(repo) + " --source docs/packages/" + flat[0];
  }
  let ignored = false;
  try {
    ignored = fs.readFileSync(path.join(repo, ".gitignore"), "utf8").split(/\r?\n/u)
      .some((line) => line.trim() === ".unlazy/" || line.trim() === ".unlazy");
  } catch { ignored = false; }
  if (!ignored) next += "; Repo fuer Pakete vorbereiten: node " + tool + " prepare --root " + quoted(repo);
  return next;
}

// The amendment route, when the target is a bundle file of an active package.
function amendNextStep(projectRoot, target, sessionId, repoRoot) {
  const bundle = packageAmend.activeBundleTarget(target, repoRoot ? { repoRoot } : {});
  if (!bundle) return null;
  return packageAmend.beginCommand(projectRoot, bundle.repoRoot, bundle.packageId, bundle.scope, sessionId);
}

// Whether a write target lies in a Git repository: a .git directory or a regular .git file in the
// target's directory or any directory above it.
function insideRepository(target) {
  let current = path.dirname(path.resolve(target));
  for (;;) {
    try {
      const info = fs.lstatSync(path.join(current, ".git"));
      if (info.isDirectory() || info.isFile()) return true;
    } catch { /* no repository boundary here */ }
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

const INSTANCE_PROFILE = ["docs", "harness-instance.md"];

function instanceProfile(projectRoot, target) {
  return repository.samePath(hookContext.canonicalPath(target), hookContext.canonicalPath(path.join(projectRoot, ...INSTANCE_PROFILE)));
}

// Whether a leaf of an active package in the rule root's repository owns docs/harness-instance.md.
function profileOwned(projectRoot) {
  const runtime = path.join(projectRoot, ".unlazy");
  let scopes = [];
  try { scopes = fs.readdirSync(runtime, { withFileTypes: true }).filter((entry) => entry.isDirectory() && !entry.name.startsWith(".")); }
  catch { return false; }
  for (const scope of scopes) {
    let ref;
    try { ref = /^docs\/packages\/([A-Za-z0-9][A-Za-z0-9._-]{0,63})\r?\n$/u.exec(fs.readFileSync(path.join(runtime, scope.name, "package.ref"), "utf8")); }
    catch { continue; }
    if (!ref) continue;
    const gates = path.join(projectRoot, "docs", "packages", ref[1], "gates");
    let ledgers = [];
    try { ledgers = fs.readdirSync(gates).filter((name) => /^leaf-.*\.md$/u.test(name)); } catch { continue; }
    for (const name of ledgers) {
      let owns;
      // An unreadable ledger may own the file: the closed side.
      try { owns = packageBinding.leafOwnsFromText(fs.readFileSync(path.join(gates, name), "utf8")); } catch { return true; }
      if (owns.some((pattern) => packageBinding.globRegex(pattern).test(INSTANCE_PROFILE.join("/")))) return true;
    }
  }
  return false;
}

// The package session a write belongs to: a worker's package session, else the hook's own
// session (hook-context, guard-parity E6).
// A target outside every Git repository has no package to belong to: paket-gate does not block it
// and leaves the decision to write-guard and its write roots (executor-state-autonomy R2). Measured
// 02.10.2026: such writes ended in "git worktree discovery failed" and MISSING_OR_STALE_BINDING.
function decide(payload, projectRoot, env = process.env) {
  const target = writeTarget(projectRoot, payload.tool_name, payload.tool_input || {});
  if (!target) return { allowed: true, code: "NOT_A_FILE_WRITE" };
  if (!insideRepository(target)) return { allowed: true, code: "OUTSIDE_REPOSITORY" };
  const sessionId = hookContext.hookSession(payload, env);
  if (!sessionId) {
    return { allowed: false, code: "MISSING_SESSION", next: exactNextStep(projectRoot) };
  }
  // The installation profile (Karte Arbeitsweise 07.10.2026): the onboarding asks the Owner and writes
  // docs/harness-instance.md of the rule root without a package, as long as no active package holds the file in a
  // leaf OWNS (then it is that leaf's work) and the session is not bound to another work step.
  if (instanceProfile(projectRoot, target) && !profileOwned(projectRoot) &&
      !sessionScope.boundToStep({ harnessRoot: projectRoot, sessionId, cwd: payload.cwd || projectRoot, env })) {
    return { allowed: true, code: "INSTANCE_PROFILE" };
  }
  // A16: no Git process unless the session holds a record of some kind. A session that holds none cannot pass
  // the binding search below, so it is refused without it; the hint for the denial is built from the file system.
  // A resumed conversation first gets its planning binding back (D15): the transcript names the old session.
  let records = sessionRecords.sessionRecords(projectRoot, sessionId, target);
  if (!records.any && payload.transcript_path) {
    const adopted = packageBootstrap.adoptByTranscript({ harnessRoot: projectRoot, sessionId,
      transcriptPath: hookContext.msysPath(String(payload.transcript_path)) });
    if (adopted.adopted) records = sessionRecords.sessionRecords(projectRoot, sessionId, target);
  }
  if (!records.any) {
    const repoHint = sessionRecords.nearestRepositoryRoot(path.dirname(target));
    return { allowed: false, code: "MISSING_OR_STALE_BINDING",
      detail: "no active leaf binding; this session holds no package record",
      next: (repoHint && amendNextStep(projectRoot, target, sessionId, repoHint)) ||
        exactNextStep(projectRoot, { target, sessionId, repoHint }) };
  }
  let binding;
  let bindingError = new Error("no active leaf binding");
  if (records.leaf) {
    try {
      binding = packageBinding.findSessionBinding(target, sessionId);
    } catch (error) {
      bindingError = error;
    }
  }
  if (binding) {
    const decision = packageBinding.authorizeWrite(binding, target);
    if (!decision.allowed) {
      return { ...decision, next: amendNextStep(projectRoot, target, sessionId, binding.repoRoot) ||
        decision.next || exactNextStep(projectRoot, { target, sessionId }) };
    }
    return { ...decision, packageId: binding.packageId, scope: binding.scope, leaf: binding.leaf };
  }
  let bootstrapRecord = null;
  let bootstrapError = new Error("no package bootstrap for this session");
  if (records.planning) {
    try {
      bootstrapRecord = packageBootstrap.find({ harnessRoot: projectRoot, sessionId });
    } catch (error) {
      bootstrapError = error;
    }
  }
  let ended = null;
  if (bootstrapRecord) {
    const bootstrapDecision = packageBootstrap.authorizeWrite(bootstrapRecord, target);
    if (bootstrapDecision.allowed) return bootstrapDecision;
    if (bootstrapDecision.code !== "BOOTSTRAP_ENDED") {
      return { ...bootstrapDecision, detail: bootstrapDecision.detail || bindingError?.message,
        next: bootstrapDecision.next || exactNextStep(projectRoot, { target, sessionId }) };
    }
    ended = bootstrapDecision;
  }
  // D1: the session that orchestrates a package keeps its evidence and design notes (no Git needed).
  if (records.orchestrator) {
    const report = packageBootstrap.authorizeOrchestratorWrite({ harnessRoot: projectRoot, sessionId, targetPath: target });
    if (report) return report;
    // Fix zwischendurch (coordinator 07.10.2026): inside the OWNS of a leaf of its own active package, while no
    // worker runs on that leaf; integrate and close judge the change at the code state like agent work.
    const fix = sessionScope.orchestratorFix({ harnessRoot: projectRoot, sessionId, target });
    if (fix && fix.allowed) {
      return { allowed: true, code: "ORCHESTRATOR_FIX", packageId: fix.packageId, scope: fix.scope, leaf: fix.leaf, relative: fix.relative };
    }
    if (fix) {
      return { allowed: false, code: "LEAF_RUNNING",
        detail: "the target " + fix.relative + " lies in the OWNS of a leaf a worker works on: " + fix.running,
        next: "wait for the worker's return and integrate (" + path.join(projectRoot, "harness-core", "execution", "package-executor.mjs") +
          " status|return|integrate --root <repo> --package " + (fix.packageId || "<packageId>") + "), then change the file; " +
          "or leave the change to that leaf" };
    }
  }
  let amendRecord = null;
  if (records.amend) {
    try {
      amendRecord = packageAmend.find({ harnessRoot: projectRoot, sessionId });
    } catch (error) {
      if (error.code === "AMEND_STALE") {
        return { allowed: false, code: "AMEND_STALE", detail: error.message, next: error.next };
      }
    }
  }
  if (amendRecord) return packageAmend.authorizeWrite(amendRecord, target);
  const amendNext = amendNextStep(projectRoot, target, sessionId, bootstrapRecord?.repoRoot);
  if (ended) {
    return { ...ended, detail: ended.detail || bindingError?.message,
      next: amendNext || ended.next || exactNextStep(projectRoot, { target, sessionId }) };
  }
  return { allowed: false, code: "MISSING_OR_STALE_BINDING",
    detail: (bindingError?.message || "no active leaf binding") + "; " + bootstrapError.message,
    next: amendNext || exactNextStep(projectRoot, { target, sessionId }) };
}

function selfTest() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "package-gate-exact-"));
  // P20, D14: der Selbsttest ruft Git wie der Rest des Harness auf (echter git.exe, ohne Wrapper-Prozess).
  const git = (...args) => (gitBinary ? gitBinary.gitSync(["-C", root, ...args], { encoding: "utf8", windowsHide: true })
    : spawnSync("git", ["-C", root, ...args], { encoding: "utf8", windowsHide: true }));
  let failures = 0;
  try {
    if (git("init", "--quiet").status !== 0) throw new Error("git init failed");
    const packageDir = path.join(root, "docs", "packages", "release");
    fs.mkdirSync(path.join(packageDir, "gates"), { recursive: true });
    fs.writeFileSync(path.join(packageDir, "PACKAGE.md"), "# Work package: release\n", "utf8");
    fs.writeFileSync(path.join(packageDir, "GATES.md"), "# Gates\n", "utf8");
    fs.writeFileSync(path.join(packageDir, "gates", "leaf-code.md"),
      "# Leaf\n\nOWNS: src/**\n\n- [ ] L1: code\n  EVIDENCE: pending\n", "utf8");
    fs.mkdirSync(path.join(root, ".unlazy", "release"), { recursive: true });
    fs.writeFileSync(path.join(root, ".unlazy", "release", "package.ref"), "docs/packages/release\n", "utf8");
    packageBinding.createBinding({ root, packageId: "release", scope: "release", sessionId: "session-one", leaf: "leaf-code" });
    const cases = [
      ["bound OWNS write passes", decide({ tool_name: "Write", session_id: "session-one", tool_input: { file_path: path.join(root, "src", "a.js") } }, root).allowed],
      ["outside OWNS blocks", !decide({ tool_name: "Write", session_id: "session-one", tool_input: { file_path: path.join(root, "docs", "x.md") } }, root).allowed],
      ["unbound session blocks", !decide({ tool_name: "Edit", session_id: "other", tool_input: { file_path: path.join(root, "src", "a.js") } }, root).allowed],
      ["missing session blocks", !decide({ tool_name: "NotebookEdit", tool_input: { notebook_path: path.join(root, "src", "a.ipynb") } }, root).allowed],
      ["non-write tool ignored", decide({ tool_name: "Read", session_id: "other", tool_input: {} }, root).allowed],
    ];
    for (const [name, ok] of cases) {
      if (!ok) failures += 1;
      process.stdout.write((ok ? "ok  " : "FAIL") + " " + name + "\n");
    }
    process.stdout.write(String(cases.length - failures) + "/" + String(cases.length) + " passed\n");
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
  return failures;
}

if (require.main === module && (process.argv.includes("--self-test") || process.argv.includes("--selbsttest"))) {
  process.exit(selfTest() ? 1 : 0);
}

// The decision of one hook call (package P5, A1): null lets the write pass, a string is the denial text. The hook main
// program and the one guard process (.claude/pretool-guards.js) both use it.
function hookDecision(payload) {
  let projectRoot;
  let decision;
  try {
    projectRoot = hookContext.ruleRoot();
    decision = decide(payload, projectRoot);
  }
  catch (error) {
    return "paket-gate: policy evaluation failed; write blocked: " + error.message;
  }
  if (decision.allowed) return null;
  // The denial itself must not depend on the Owner template (guard-parity A9).
  let template;
  try {
    const toolInput = payload.tool_input || {};
    const operation = ownerHandoff.toolFileOperation(payload.tool_name, toolInput,
      writeTarget(projectRoot, payload.tool_name, toolInput));
    template = ownerHandoff.handoffText({ what: "Dateiaenderung ausserhalb des gebundenen Paket-Leaf (" + decision.code + ")",
      route: "Leaf-Bindung ueber package-executor next/start oder Planungsbindung ueber package-standard.mjs create", files: operation ? [operation] : [] });
  } catch (error) {
    template = "(Owner-Vorlage nicht erzeugbar: " + error.message + ")";
  }
  return "paket-gate: " + decision.code + ". " +
    (decision.detail || "write has no exact package leaf ownership") + "\nNEXT: " + decision.next + "\n" +
    guardRoutes.referenceLine("paket-gate", decision.code) + "\n" + template;
}

if (require.main === module) {
  let input = "";
  process.stdin.on("data", (chunk) => { input += chunk; });
  process.stdin.on("end", () => {
    let payload;
    try { payload = JSON.parse(input || "{}"); }
    catch {
      return block("paket-gate: invalid hook input; write blocked");
    }
    // sign of life of the planning session (D15), before anything is judged; never decides
    try { hookActivity.noteHookInput(payload); } catch { /* a record, not a decision */ }
    const denial = hookDecision(payload);
    return denial === null ? process.exit(0) : block(denial);
  });
}

module.exports = { decide, exactNextStep, hookDecision, insideRepository, writeTarget };
