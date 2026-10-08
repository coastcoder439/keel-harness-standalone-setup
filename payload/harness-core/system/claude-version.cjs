"use strict";

// The oldest Claude Code that starts the Harness guards safely (package P5, follow-up of the review).
//
// Since P5 the PreToolUse guards stand in exec form in .claude/settings.json ("command": "node", "args": [...]). A Claude Code
// that does not know the field `args` starts `node` without a program: the hook ends with an error and the host lets the tool
// call through (fail open). 2.1.183 knows the field (read in its code: `if(e.args!==void 0)`, substitution of
// ${CLAUDE_PROJECT_DIR} per argument). The installer refuses an older Claude Code, and the SessionStart hook warns loudly when
// the running one is older.
//
// Pure functions (parse, compare, judge) plus two small readers: the running version from the hook environment
// (AI_AGENT = "claude-code_2-1-288_agent", set by Claude Code for its child processes) and `claude --version` without a shell.

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const MIN_CLAUDE_CODE_VERSION = "2.1.183";

// "2.1.183 (Claude Code)", "claude-code_2-1-288_agent", "v2.1.4" -> [2, 1, 183]; null when no version is in the text.
function parseClaudeVersion(text) {
  const value = String(text ?? "");
  const agent = /claude-code[_/](\d+)[-.](\d+)[-.](\d+)/u.exec(value);
  const plain = agent || /(?:^|[^\d.])v?(\d+)\.(\d+)\.(\d+)(?![\d])/u.exec(value);
  return plain ? plain.slice(1, 4).map(Number) : null;
}

// < 0, 0, > 0 like a sort comparator; both sides are version texts or parsed arrays.
function compareVersions(left, right) {
  const a = Array.isArray(left) ? left : parseClaudeVersion(left);
  const b = Array.isArray(right) ? right : parseClaudeVersion(right);
  if (!a || !b) throw new Error("not a version: " + (a ? right : left));
  for (let index = 0; index < 3; index += 1) {
    const difference = (a[index] || 0) - (b[index] || 0);
    if (difference) return difference;
  }
  return 0;
}

// { state: "ok" | "old" | "unknown", version, minimum, message } for a version text (or null when none was found).
function judgeClaudeVersion(text, minimum = MIN_CLAUDE_CODE_VERSION) {
  const parsed = parseClaudeVersion(text);
  if (!parsed) {
    return { state: "unknown", version: null, minimum,
      message: "Claude Code version not found; the Harness guards need at least " + minimum + " (hook field args)" };
  }
  const version = parsed.join(".");
  if (compareVersions(parsed, minimum) < 0) {
    return { state: "old", version, minimum,
      message: "Claude Code " + version + " is older than " + minimum + ": it does not know the hook field args, starts the " +
        "Harness guards without their program and lets every tool call through. Update Claude Code to " + minimum + " or newer." };
  }
  return { state: "ok", version, minimum, message: "" };
}

function regularFile(file) {
  try { return fs.statSync(file).isFile() ? file : null; } catch { return null; }
}

// The claude program to ask, without a shell: on Windows npm installs only .cmd/.ps1 shims, so the native claude.exe of the
// package beside a shim (the same rule as codex-plugin-bootstrap.mjs resolveClaudeExecutable).
function claudeProgram(env = process.env, platform = process.platform) {
  if (platform !== "win32") return "claude";
  for (const raw of String(env.PATH || env.Path || "").split(path.delimiter)) {
    const directory = raw.trim().replace(/^"|"$/gu, "");
    if (!directory) continue;
    const direct = regularFile(path.join(directory, "claude.exe"));
    if (direct) return direct;
    if (!regularFile(path.join(directory, "claude.cmd")) && !regularFile(path.join(directory, "claude.ps1"))) continue;
    const native = regularFile(path.join(directory, "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe"));
    if (native) return native;
  }
  return "claude";
}

// The output of `claude --version`; { missing: true } when no claude program starts.
function readClaudeVersion(options = {}) {
  const program = options.program || claudeProgram(options.env, options.platform);
  const result = (options.spawn || spawnSync)(program, ["--version"], { encoding: "utf8", windowsHide: true, env: options.env || process.env });
  if (result.error || result.status !== 0) return { missing: true, program, error: result.error ? result.error.message : "exit " + result.status };
  return { missing: false, program, text: String(result.stdout || "") };
}

// The version of the Claude Code that runs this hook: AI_AGENT when Claude Code set it, else null (caller may ask claude).
function runningVersionFromEnv(env = process.env) {
  const agent = String(env.AI_AGENT || "");
  return /^claude-code[_/]/u.test(agent) ? agent : null;
}

module.exports = { MIN_CLAUDE_CODE_VERSION, claudeProgram, compareVersions, judgeClaudeVersion, parseClaudeVersion,
  readClaudeVersion, runningVersionFromEnv };
