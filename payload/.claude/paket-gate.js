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

let packageBinding;
let packageBootstrap;
let packageAmend;
let repository;
let hookContext;
let ownerHandoff;
try {
  packageBinding = require("../harness-core/binding/package-binding.cjs");
  packageBootstrap = require("../harness-core/binding/package-bootstrap.cjs");
  packageAmend = require("../harness-core/binding/package-amend.cjs");
  repository = require("../harness-core/binding/repository.cjs");
  hookContext = require("../harness-core/guards/hook-context.cjs");
  ownerHandoff = require("../harness-core/guards/owner-handoff.cjs");
} catch (error) {
  if (require.main === module) block("paket-gate: dependency load failed; write blocked: " + error.message);
  throw error;
}

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
function exactNextStep(projectRoot, { target, sessionId } = {}) {
  const tool = quoted(path.join(projectRoot, ".claude", "skills", "package-standard", "package-standard.mjs"));
  let targetRepo = null;
  if (target) {
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
  let binding;
  let bindingError;
  try {
    binding = packageBinding.findSessionBinding(target, sessionId);
  } catch (error) {
    bindingError = error;
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
  let bootstrapError;
  try {
    bootstrapRecord = packageBootstrap.find({ harnessRoot: projectRoot, sessionId });
  } catch (error) {
    bootstrapError = error;
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
  let amendRecord = null;
  try {
    amendRecord = packageAmend.find({ harnessRoot: projectRoot, sessionId });
  } catch (error) {
    if (error.code === "AMEND_STALE") {
      return { allowed: false, code: "AMEND_STALE", detail: error.message, next: error.next };
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
  const git = (...args) => spawnSync("git", ["-C", root, ...args], { encoding: "utf8", windowsHide: true });
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

if (require.main === module) {
  let input = "";
  process.stdin.on("data", (chunk) => { input += chunk; });
  process.stdin.on("end", () => {
    let payload;
    try { payload = JSON.parse(input || "{}"); }
    catch {
      return block("paket-gate: invalid hook input; write blocked");
    }
    const projectRoot = hookContext.ruleRoot();
    let decision;
    try { decision = decide(payload, projectRoot); }
    catch (error) {
      return block("paket-gate: policy evaluation failed; write blocked: " + error.message);
    }
    if (decision.allowed) return process.exit(0);
    const toolInput = payload.tool_input || {};
    const operation = ownerHandoff.toolFileOperation(payload.tool_name, toolInput,
      writeTarget(projectRoot, payload.tool_name, toolInput));
    block("paket-gate: " + decision.code + ". " +
      (decision.detail || "write has no exact package leaf ownership") + "\nNEXT: " + decision.next + "\n" +
      ownerHandoff.handoffText({ what: "Dateiaenderung ausserhalb des gebundenen Paket-Leaf (" + decision.code + ")",
        route: "Leaf-Bindung ueber package-executor next/start oder Planungsbindung ueber package-standard.mjs create", files: operation ? [operation] : [] }));
  });
}

module.exports = { decide, exactNextStep, insideRepository, writeTarget };
