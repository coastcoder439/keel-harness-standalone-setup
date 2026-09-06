#!/usr/bin/env node
"use strict";

// PreToolUse for Write/Edit/NotebookEdit. A write is allowed only when the
// current session is bound to one active package leaf and the target matches
// that leaf's exact OWNS declaration. No prompt scoring or filename guessing.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const packageBinding = require("../harness-core/binding/package-binding.cjs");
const packageBootstrap = require("../harness-core/binding/package-bootstrap.cjs");

function msysPath(value) {
  if (process.platform !== "win32" || !value) return value;
  return String(value).replace(/^\/([A-Za-z])(?=\/|$)/u, "$1:");
}

function writeTarget(projectRoot, toolName, input) {
  if (!/^(Write|Edit|NotebookEdit)$/u.test(String(toolName || ""))) return null;
  const raw = input.file_path || input.notebook_path;
  if (!raw || typeof raw !== "string" || raw.includes("\0")) return null;
  return path.resolve(projectRoot, msysPath(raw));
}

function exactNextStep(projectRoot) {
  const executable = path.join(projectRoot, "harness-core", "execution", "package-bootstrap.mjs");
  return "node \"" + executable + "\" begin --harness-root \"" + projectRoot +
    "\" --root <exactGitRepo> --package <packageId> --scope <packageId> --session <sessionId> --json";
}

function decide(payload, projectRoot) {
  const target = writeTarget(projectRoot, payload.tool_name, payload.tool_input || {});
  if (!target) return { allowed: true, code: "NOT_A_FILE_WRITE" };
  const sessionId = String(payload.session_id || "").trim();
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
  if (!binding) {
    try {
      const record = packageBootstrap.find({ harnessRoot: projectRoot, sessionId });
      const bootstrapDecision = packageBootstrap.authorizeWrite(record, target);
      if (bootstrapDecision.allowed) return bootstrapDecision;
      return { ...bootstrapDecision, detail: bootstrapDecision.detail || bindingError?.message,
        next: bootstrapDecision.next || exactNextStep(projectRoot) };
    } catch (bootstrapError) {
      return { allowed: false, code: "MISSING_OR_STALE_BINDING",
        detail: (bindingError?.message || "no active leaf binding") + "; " + bootstrapError.message,
        next: exactNextStep(projectRoot) };
    }
  }
  const decision = packageBinding.authorizeWrite(binding, target);
  if (!decision.allowed) return { ...decision, next: decision.next || exactNextStep(projectRoot) };
  return { ...decision, packageId: binding.packageId, scope: binding.scope, leaf: binding.leaf };
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
      process.stderr.write("paket-gate: invalid hook input; write blocked\n");
      return process.exit(2);
    }
    const projectRoot = msysPath(process.env.CLAUDE_PROJECT_DIR || process.cwd());
    const decision = decide(payload, projectRoot);
    if (!decision.allowed) {
      process.stderr.write("paket-gate: " + decision.code + ". " +
        (decision.detail || "write has no exact package leaf ownership") + "\nNEXT: " + decision.next + "\n");
      return process.exit(2);
    }
    process.exit(0);
  });
}

module.exports = { decide, exactNextStep, writeTarget };
