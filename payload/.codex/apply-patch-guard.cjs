#!/usr/bin/env node
"use strict";

// Codex exposes file changes as one apply_patch command. Claude Code exposes
// Write/Edit calls with file_path. This adapter is the only translation layer:
// it enumerates every source/destination path in the patch and sends each one
// through the existing write policy and exact package-leaf OWNS decision.

const path = require("node:path");
const writeGuard = require("../.claude/write-guard.js");
const packageGate = require("../.claude/paket-gate.js");

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

function inspect(payload, projectRoot, dependencies = {}) {
  if (String(payload?.tool_name || "") !== "apply_patch") {
    return { allowed: false, code: "NOT_APPLY_PATCH", detail: "canonical Codex tool_name must be apply_patch" };
  }
  let entries;
  try { entries = parsePatch(payload?.tool_input?.command); }
  catch (error) { return { allowed: false, code: "INVALID_PATCH", detail: error.message }; }

  const deps = dependencies.writeDeps || writeGuard.echteDeps(projectRoot);
  const inspected = [];
  for (const entry of entries) {
    const absolute = path.resolve(projectRoot, entry.filePath);
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
      process.stderr.write("codex-apply-patch-guard: invalid hook JSON\n");
      return process.exit(2);
    }
    const root = process.env.KEEL_HARNESS_ROOT || process.env.CLAUDE_PROJECT_DIR;
    if (!root) {
      process.stderr.write("codex-apply-patch-guard: Harness root is missing\n");
      return process.exit(2);
    }
    const decision = inspect(payload, root);
    if (!decision.allowed) {
      process.stderr.write("codex-apply-patch-guard: " + decision.code + ": " + decision.detail +
        (decision.target ? "\nTARGET: " + decision.target : "") +
        (decision.next ? "\nNEXT: " + decision.next : "") + "\n");
      return process.exit(2);
    }
    process.exit(0);
  });
}

if (require.main === module) main();
module.exports = { inspect, parsePatch };

