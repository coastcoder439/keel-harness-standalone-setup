#!/usr/bin/env node
"use strict";

// Codex transcripts are explicitly not a stable hook interface. This native
// adapter evaluates the stable Stop.last_assistant_message field and, for a working
// agent, records the stable PostToolUse facts needed by the old DoD rule.
//
// Same split as .claude/dod-guard.js (Karte Arbeitsweise, 07.10.2026; the role is the host's, isWorkerSession): a main
// session is blocked only when its last answer claims finished work (harness-core/guards/done-claim.cjs) without both
// report lines; writing or committing alone triggers nothing. A working agent keeps the rule "work in the turn needs the
// report lines".

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { isWorkerSession } = require("../harness-core/guards/hook-context.cjs");
const { doneClaim } = require("../harness-core/guards/done-claim.cjs");

const CHECKED = /gepr(ue|ü)ft gegen\s*:/iu;
const OPEN = /\boffen\s*:/iu;
const MUTATING_INTENTS = /\b(?:checkpoint|unstage|discard|recover|revert|integration|plan-close|closure|plan-publish|publish)\b/iu;
const PACKAGE_TRANSITIONS = /\bpackage-(?:executor|bootstrap)\.mjs\b/iu;
const DIRECT_COMMIT = /\bgit(?:\.exe)?\b[^\n]{0,400}\bcommit\b/iu;
const MESSAGE =
  "Dieser Codex-Turn hat Dateien oder Package-/Git-Zustand geaendert, aber die Schluss-Nachricht " +
  "enthaelt nicht beide Zeilen `Geprueft gegen:` und `Offen:`. Das Berichtsformat ersetzt weder " +
  "Unlazy-Reverify noch das Close-Receipt von package-cli close.";

function claimMessage(claim) {
  return "Die letzte Antwort meldet Fertigsein (\"" + claim + "\"), enthaelt aber nicht beide Zeilen `Geprueft gegen:` und `Offen:`. " +
    "Weg: beide Zeilen am Ende ergaenzen oder den Anspruch zurueknehmen und sagen, was noch fehlt. " +
    "Das Berichtsformat ersetzt weder Unlazy-Reverify noch das Close-Receipt von package-cli close.";
}

function statePath(root, sessionId) {
  const key = crypto.createHash("sha256").update(String(sessionId || "missing")).digest("hex").slice(0, 24);
  return path.join(root, ".unlazy", ".harness", "codex-dod", key + ".json");
}

function isWork(payload) {
  if (payload?.tool_name === "apply_patch") return true;
  if (payload?.tool_name !== "Bash") return false;
  const command = String(payload?.tool_input?.command || "");
  if (DIRECT_COMMIT.test(command) || PACKAGE_TRANSITIONS.test(command)) return true;
  return /\bgit-intent\.mjs\b/iu.test(command) && MUTATING_INTENTS.test(command);
}

function writeState(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = file + ".tmp-" + process.pid;
  fs.writeFileSync(temporary, JSON.stringify(value) + "\n", "utf8");
  fs.renameSync(temporary, file);
}

function removeState(file) {
  try { fs.rmSync(file, { force: true }); } catch { /* runtime cleanup is best effort */ }
}

function handle(payload, root, env = process.env) {
  const event = String(payload?.hook_event_name || "");
  const file = statePath(root, payload?.session_id);
  const worker = isWorkerSession(env);
  if (event === "PostToolUse") {
    // Only a working agent's work is a fact the Stop decision needs; a main session is judged by its words.
    if (worker && isWork(payload)) writeState(file, { turnId: payload.turn_id || null, recordedAt: new Date().toISOString() });
    return { allowed: true, code: "RECORDED_OR_IGNORED" };
  }
  if (event !== "Stop") return { allowed: true, code: "IRRELEVANT_EVENT" };
  if (payload?.stop_hook_active === true) {
    removeState(file);
    return { allowed: true, code: "CONTINUATION_ALREADY_REQUESTED" };
  }
  if (!worker) {
    const message = String(payload?.last_assistant_message || "");
    const claim = doneClaim(message);
    if (!claim) return { allowed: true, code: "NO_DONE_CLAIM" };
    if (CHECKED.test(message) && OPEN.test(message)) return { allowed: true, code: "DOD_FORMAT_PRESENT" };
    return { allowed: false, code: "DOD_FORMAT_MISSING", detail: claimMessage(claim) };
  }
  let state;
  try { state = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return { allowed: true, code: "NO_WORK_RECORDED" }; }
  if (state.turnId && payload?.turn_id && state.turnId !== payload.turn_id) {
    removeState(file);
    return { allowed: true, code: "STALE_TURN_STATE" };
  }
  const message = String(payload?.last_assistant_message || "");
  if (CHECKED.test(message) && OPEN.test(message)) {
    removeState(file);
    return { allowed: true, code: "DOD_FORMAT_PRESENT" };
  }
  return { allowed: false, code: "DOD_FORMAT_MISSING", detail: MESSAGE };
}

// Under the Codex hook runner a Stop block is the JSON decision with exit 0: Windows
// PowerShell maps a native exit 2 to 1, which Codex treats as a failed hook and ignores
// (guard-parity E5). A PostToolUse call only records facts and never blocks.
function block(reason) {
  if (process.env.KEEL_HARNESS_ROOT && process.env.KEEL_HOOK_TARGET === ".codex/dod-guard.cjs") {
    fs.writeSync(1, JSON.stringify({ decision: "block", reason }) + "\n");
    process.exit(0);
  }
  fs.writeSync(2, reason + "\n");
  process.exit(2);
}

function main() {
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => { input += chunk; });
  process.stdin.on("end", () => {
    let payload;
    try { payload = JSON.parse(input || "{}"); }
    catch {
      return block("codex-dod-guard: invalid hook JSON");
    }
    const root = process.env.KEEL_HARNESS_ROOT || process.env.CLAUDE_PROJECT_DIR;
    if (!root) return block("codex-dod-guard: Harness root is missing");
    const decision = handle(payload, root);
    if (!decision.allowed) return block("codex-dod-guard: " + decision.detail);
    process.exit(0);
  });
}

if (require.main === module) main();
module.exports = { handle, isWork, statePath };

