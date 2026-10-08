"use strict";

// What every guard reads from its hook environment, defined once (package guard-parity, E6).
//
// Rule root: the Harness root whose rules apply. A worker the package executor starts and
// the Codex hook runner name it in KEEL_HARNESS_ROOT, because their working directory is a
// project repository; the Owner's own Claude session names it in CLAUDE_PROJECT_DIR.
//
// Package session: the session a package leaf is bound to. A worker -- Claude CLI or
// Codex -- runs with its own native session id, but the executor bound the leaf to its
// package session and hands that name over as KEEL_PACKAGE_SESSION. Hooks inherit the
// environment of the host process, which the worker's own tool calls cannot change
// (measured 01.10.2026 for Claude CLI and Codex).

const fs = require("node:fs");
const path = require("node:path");

// Git Bash writes drives as /c/...; Node needs C:/...
function msysPath(value, platform = process.platform) {
  if (platform !== "win32" || !value) return value;
  return String(value).replace(/^\/([A-Za-z])(?=\/|$)/u, "$1:");
}

// One spelling per place, so a guard compares a target and its roots in the same form. On
// win32 the longest existing ancestor is resolved by the file system, which expands 8.3 short
// names (C:/Users/ABCDEF~1) and follows junctions; segments that do not exist yet are joined
// back unchanged. Other platforms keep path.resolve. Never throws: a throw in a guard would
// deny every write, so any failure falls back to the path.resolve form.
function canonicalPath(value, platform = process.platform) {
  let resolved;
  try {
    resolved = path.resolve(msysPath(String(value), platform));
  } catch {
    return String(value);
  }
  if (platform !== "win32") return resolved;
  try {
    const rest = [];
    let current = resolved;
    for (;;) {
      try {
        return path.join(fs.realpathSync.native(current), ...rest.reverse());
      } catch {
        const parent = path.dirname(current);
        if (parent === current) return resolved;
        rest.push(path.basename(current));
        current = parent;
      }
    }
  } catch {
    return resolved;
  }
}

function ruleRoot(env = process.env, cwd = process.cwd()) {
  return msysPath(env.KEEL_HARNESS_ROOT || env.CLAUDE_PROJECT_DIR || cwd);
}

function hookSession(payload, env = process.env) {
  return String(env.KEEL_PACKAGE_SESSION || payload?.session_id || "").trim();
}

// The role of the session a hook judges (Karte Arbeitsweise, 07.10.2026): a worker agent is started by the
// Package-Executor, which puts KEEL_PACKAGE_SESSION into the environment of the Claude or Codex process; the hook
// inherits it from the host, and no tool call can change it. Every other session is a main session (Owner,
// orchestrator, onboarding, normal work). The same rules hold for both; what a session not bound to a work step may do
// beside product work (Git maintenance, project tools, MCP) is decided in session-scope.cjs.
function isWorkerSession(env = process.env) {
  return String(env.KEEL_PACKAGE_SESSION || "").trim() !== "";
}

module.exports = { canonicalPath, hookSession, isWorkerSession, msysPath, ruleRoot };
