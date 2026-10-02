#!/usr/bin/env node
"use strict";

// Codex exposes file changes as one apply_patch command. Claude Code exposes
// Write/Edit calls with file_path. This adapter is the only translation layer:
// it enumerates every source/destination path in the patch and sends each one
// through the existing write policy and exact package-leaf OWNS decision.

const fs = require("node:fs");
const path = require("node:path");

const GUARD_TARGET = ".codex/apply-patch-guard.cjs";

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

let writeGuard;
let packageGate;
let hookContext;
let ownerHandoff;
try {
  writeGuard = require("../.claude/write-guard.js");
  packageGate = require("../.claude/paket-gate.js");
  hookContext = require("../harness-core/guards/hook-context.cjs");
  ownerHandoff = require("../harness-core/guards/owner-handoff.cjs");
} catch (error) {
  if (require.main === module) block("codex-apply-patch-guard: dependency load failed; patch blocked: " + error.message);
  throw error;
}

function parsePatch(command) {
  if (typeof command !== "string") throw new Error("apply_patch tool_input.command must be a string");
  const lines = command.replaceAll("\r\n", "\n").split("\n");
  if (lines[0] !== "*** Begin Patch" || !lines.includes("*** End Patch")) {
    throw new Error("patch is missing exact Begin/End markers");
  }
  const entries = new Map();
  let current = null;

  function addTarget(rawPath) {
    const value = String(rawPath || "").trim();
    if (!value || value.includes("\0")) throw new Error("patch contains an empty or invalid path");
    if (!entries.has(value)) entries.set(value, { filePath: value, added: [] });
    return entries.get(value);
  }

  for (const line of lines.slice(1)) {
    const file = line.match(/^\*\*\* (Add|Update|Delete) File: (.+)$/u);
    if (file) {
      current = addTarget(file[2]);
      continue;
    }
    const move = line.match(/^\*\*\* Move to: (.+)$/u);
    if (move) {
      if (!current) throw new Error("Move to appears before a file header");
      current = addTarget(move[1]);
      continue;
    }
    if (/^\*\*\* (?:Add|Update|Delete) File:/u.test(line)) {
      throw new Error("patch contains a malformed file header");
    }
    if (current && line.startsWith("+") && !line.startsWith("+++")) current.added.push(line.slice(1));
  }
  if (!entries.size) throw new Error("patch contains no file operation");
  return [...entries.values()].map((entry) => ({ ...entry, content: entry.added.join("\n") }));
}

// The patch as file operations for the Owner template (guard-parity E9): an added file is
// written, a deleted one removed, and every hunk of an updated file replaces its old lines
// (context and removed) by its new lines (context and added) exactly once. A move, or a
// hunk with no old line to anchor it, has no exact form, so the whole patch gets none.
function patchOperations(command, base) {
  const lines = String(command).replaceAll("\r\n", "\n").split("\n");
  const operations = [];
  let current = null;
  let hunk = null;
  const closeHunk = () => {
    if (!hunk) return;
    if (!hunk.old.length) { operations.push(null); hunk = null; return; }
    operations.push({ kind: "edit", file: current.file, oldText: hunk.old.join("\n"), newText: hunk.new.join("\n") });
    hunk = null;
  };
  const closeFile = () => {
    closeHunk();
    if (current && current.kind === "write") {
      operations.push({ kind: "write", file: current.file, content: current.added.length ? current.added.join("\n") + "\n" : "" });
    }
    current = null;
  };
  for (const line of lines.slice(1)) {
    const header = line.match(/^\*\*\* (Add|Update|Delete) File: (.+)$/u);
    if (header || line === "*** End Patch") {
      closeFile();
      if (!header) break;
      const file = path.resolve(base, header[2].trim());
      if (header[1] === "Delete") operations.push({ kind: "delete", file });
      else current = { kind: header[1] === "Add" ? "write" : "update", file, added: [] };
      continue;
    }
    if (!current) continue;
    if (/^\*\*\* Move to: /u.test(line)) return [];
    if (current.kind === "write") {
      if (line.startsWith("+")) current.added.push(line.slice(1));
      continue;
    }
    if (line.startsWith("@@")) { closeHunk(); hunk = { old: [], new: [] }; continue; }
    if (line === "*** End of File") continue;
    if (!hunk) hunk = { old: [], new: [] };
    if (line.startsWith("-")) hunk.old.push(line.slice(1));
    else if (line.startsWith("+")) hunk.new.push(line.slice(1));
    else { const text = line.startsWith(" ") ? line.slice(1) : line; hunk.old.push(text); hunk.new.push(text); }
  }
  closeFile();
  return operations.every(Boolean) ? operations : [];
}

function inspect(payload, projectRoot, dependencies = {}) {
  if (String(payload?.tool_name || "") !== "apply_patch") {
    return { allowed: false, code: "NOT_APPLY_PATCH", detail: "canonical Codex tool_name must be apply_patch" };
  }
  let entries;
  try { entries = parsePatch(payload?.tool_input?.command); }
  catch (error) { return { allowed: false, code: "INVALID_PATCH", detail: error.message }; }

  const deps = dependencies.writeDeps || writeGuard.echteDeps(projectRoot);
  const inspected = [];
  // Codex writes relative patch paths from its session directory, which is the leaf's own
  // repository for a package worker, not the Harness root (guard-parity E8).
  const base = payload?.cwd ? path.resolve(String(payload.cwd)) : projectRoot;
  for (const entry of entries) {
    const absolute = path.resolve(base, entry.filePath);
    const writeReason = writeGuard.pruefen({ file_path: absolute, content: entry.content }, deps);
    if (writeReason) return { allowed: false, code: "WRITE_POLICY", detail: writeReason, target: absolute };
    const packageDecision = (dependencies.packageDecide || packageGate.decide)({
      ...payload,
      tool_name: "Edit",
      tool_input: { file_path: absolute },
    }, projectRoot);
    if (!packageDecision.allowed) {
      return {
        allowed: false,
        code: packageDecision.code || "PACKAGE_OWNS",
        detail: packageDecision.detail || "file is not owned by the bound package leaf",
        next: packageDecision.next,
        target: absolute,
      };
    }
    inspected.push(absolute);
  }
  return { allowed: true, code: "PATCH_AUTHORIZED", targets: inspected };
}

function main() {
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => { input += chunk; });
  process.stdin.on("end", () => {
    let payload;
    try { payload = JSON.parse(input || "{}"); }
    catch {
      return block("codex-apply-patch-guard: invalid hook JSON");
    }
    const root = hookContext.ruleRoot();
    let decision;
    try { decision = inspect(payload, root); }
    catch (error) { return block("codex-apply-patch-guard: policy evaluation failed; patch blocked: " + error.message); }
    if (decision.allowed) return process.exit(0);
    let template;
    try {
      // The write policy decides per W rule; outside OWNS is agent work, so it names the
      // package route and carries no command.
      if (decision.code === "WRITE_POLICY") {
        const base = payload?.cwd ? path.resolve(String(payload.cwd)) : root;
        template = writeGuard.vorlage(decision.detail, patchOperations(payload?.tool_input?.command, base), writeGuard.echteDeps(root));
      } else {
        template = ownerHandoff.handoffText({ what: "Codex-Patch ausserhalb des gebundenen Paket-Leaf (" + decision.code + ")",
          route: (decision.next || packageGate.exactNextStep(root)) + "; Leaf-Bindung ueber package-executor next/start" });
      }
    } catch (error) {
      template = "\n(Owner-Vorlage nicht erzeugbar: " + error.message + ")";
    }
    return block("codex-apply-patch-guard: " + decision.code + ": " + decision.detail +
      (decision.target ? "\nTARGET: " + decision.target : "") +
      (decision.next ? "\nNEXT: " + decision.next : "") + "\n" + template);
  });
}

if (require.main === module) main();
module.exports = { inspect, parsePatch, patchOperations };

