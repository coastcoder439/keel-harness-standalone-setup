#!/usr/bin/env node
"use strict";

// PreToolUse mutation boundary for MCP tools (completeness audit 06.09.2026, B6).
//
// The finite mutation boundary covered Bash, Write/Edit and Codex apply_patch. Every other
// write-capable tool in the same host -- above all MCP servers (mail, calendar, drive, browser,
// session messaging) -- could mutate an external system during an active package without any
// guard seeing it. This hook closes that gap fail-closed: while a package is active, an MCP tool
// runs only when its name is a read-only verb or when the Owner allowlisted the exact tool name
// in .claude/mutation-policy.json (mcpWriteTools.allow). Unknown verbs are denied, not guessed.
// Outside an active package nothing changes, exactly like shell-mutation-guard.
//
// AUFRUF    PreToolUse, matcher: mcp__.* (Claude) / ^mcp__ (Codex via hook-runner)
// RUECKGABE 0 = durch · 2 = blockiert (mit Begruendung und NEXT auf stderr)

const gitGuard = require("./git-intent-guard.js");
const shellGuard = require("./shell-mutation-guard.js");

// Read-only verbs at the start of the tool name (after mcp__<server>__). The list is finite on
// purpose; a verb that is not here is treated as a write.
const READ_ONLY_VERBS = /^(?:get|list|search|read|find|fetch|query|status|describe|show|lookup|resolve|check|count|inspect|preview|tabs_context|screenshot)(?:_|$)/iu;
const MCP_NAME = /^mcp__([A-Za-z0-9-]+(?:_[A-Za-z0-9-]+)*)__(.+)$/u;

function toolSuffix(name) {
  const match = String(name || "").match(MCP_NAME);
  return match ? match[2] : "";
}

function allow(code) {
  return { allowed: true, code };
}

function deny(code, detail, next) {
  return { allowed: false, code, detail, next };
}

function decide(toolName, options = {}) {
  const name = String(toolName || "");
  if (!name.startsWith("mcp__")) return allow("NOT_MCP");
  if (!options.active) return allow("NO_ACTIVE_PACKAGE");
  const policy = options.policy || { error: "no policy loaded", mcpAllow: new Set() };
  if (policy.error) {
    return deny("POLICY_INVALID", ".claude/mutation-policy.json is invalid: " + policy.error,
      "The Owner repairs the policy file; MCP tools stay blocked while a package is active.");
  }
  if (policy.mcpAllow.has(name)) return allow("MCP_ALLOWLISTED");
  const suffix = toolSuffix(name);
  if (suffix && READ_ONLY_VERBS.test(suffix)) return allow("MCP_READ_ONLY");
  return deny("MCP_WRITE_UNDECLARED",
    "MCP tool " + name + " is not a read-only verb and not allowlisted: it could mutate an external system outside the finite mutation boundary",
    "The Owner adds the exact tool name to .claude/mutation-policy.json (mcpWriteTools.allow), or the work takes the canonical repository route.");
}

function selfTest() {
  const policy = { error: null, mcpAllow: new Set(["mcp__mail__send_message"]) };
  const cases = [
    ["non-MCP tools are not this guard's business", "Write", { active: true, policy }, true],
    ["read-only verb passes", "mcp__google__list_events", { active: true, policy }, true],
    ["read-only verb with prefix passes", "mcp__browser__get_page_text", { active: true, policy }, true],
    ["allowlisted write passes", "mcp__mail__send_message", { active: true, policy }, true],
    ["write verb blocks", "mcp__google__create_event", { active: true, policy }, false],
    ["unknown verb blocks", "mcp__x__frobnicate", { active: true, policy }, false],
    ["invalid policy blocks every MCP tool", "mcp__google__list_events", { active: true, policy: { error: "broken", mcpAllow: new Set() } }, false],
    ["no active package leaves MCP alone", "mcp__google__create_event", { active: false, policy }, true],
  ];
  let failed = 0;
  for (const [name, tool, options, allowed] of cases) {
    const decision = decide(tool, options);
    const ok = decision.allowed === allowed;
    if (!ok) failed += 1;
    process.stdout.write((ok ? "ok  " : "FAIL") + " " + name + "\n");
  }
  process.stdout.write(String(cases.length - failed) + "/" + String(cases.length) + " passed\n");
  return failed;
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
      process.stderr.write("mcp-write-guard: invalid hook input; tool blocked\n");
      return process.exit(2);
    }
    const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();
    let decision;
    try {
      const active = gitGuard.activePackage(projectRoot, payload.session_id, payload.cwd || projectRoot);
      decision = decide(payload.tool_name, { active, policy: shellGuard.loadMutationPolicy(projectRoot) });
    } catch (error) {
      process.stderr.write("mcp-write-guard: policy evaluation failed; tool blocked: " + error.message + "\n");
      return process.exit(2);
    }
    if (decision.allowed) return process.exit(0);
    process.stderr.write("mcp-write-guard: blocked before execution: " + decision.code + "\n" + decision.detail + "\nNEXT: " + decision.next + "\n");
    return process.exit(2);
  });
}

module.exports = { READ_ONLY_VERBS, decide, selfTest, toolSuffix };
