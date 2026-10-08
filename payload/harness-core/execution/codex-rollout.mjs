// What a running Codex session says in the rollout file Codex writes while it works (P12): its token count and the
// answers to its tool calls.
//
// Tokens. `codex exec --json` reports usage only in turn.completed, at the end of a turn, so a frame that is only
// counted there never brakes a run. Codex appends
//   {"timestamp":"...","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{...}}}}
// to ~/.codex/sessions/YYYY/MM/DD/rollout-<local time>-<thread id>.jsonl after every model call (format
// checked on real files of Codex 0.153.4, 06.10.2026; `info` is null in some events, total_tokens equals
// input_tokens + output_tokens, the same two fields turn.completed.usage is counted from here).
// total_token_usage is the total of the whole thread. A resumed run appends to the same file, so the
// events from before this run's start are its baseline and only the growth after it counts.
//
// Tool calls and their answers. A call that a PreToolUse hook refuses leaves no item in `codex exec --json`
// (finding of the Orchestrator, 06.10.2026); it is recorded only here, as a response_item pair
//   {"type":"response_item","payload":{"type":"custom_tool_call","call_id":"c","name":"exec","input":"<script>"}}
//   {"type":"response_item","payload":{"type":"custom_tool_call_output","call_id":"c","output":[
//      {"type":"input_text","text":"Script failed\nWall time 1.2 seconds\nOutput:\n"},
//      {"type":"input_text","text":"Script error:\nCommand blocked by PreToolUse hook: <guard text>"}]}}
// Measured on 56 refused calls in the rollout files of `codex exec` runs on this machine (originator
// codex_exec, Codex 0.153.4, 09.09. to 02.10.2026): all of them are answers of the code-mode tool `exec`, an
// array of two text parts whose second part is the refusal. The same pair as a function_call and a
// function_call_output (shell tools outside code mode) has not been recorded yet; the reader treats its answer,
// a string or a list of parts, the same way. Every answered call is handed over, refused or not
// (takeToolResults), because a call of the same input that ran takes the count back (provider-events.mjs).
// The input of a call is its identity as the tracker hashes it: for a shell tool the command only, for the
// code-mode script the one exec_command or apply_patch it holds (never an arbitrary expression: anything that
// is not exactly one call with a literal command or patch stays the script itself).
//
// The file is only read, and incrementally: a poll reads the bytes that came since the last one.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { isCodexHookBlock, usageTokens } from "./provider-events.mjs";

export function codexSessionsRoot(codexHome = null, env = process.env) {
  return path.join(codexHome || env.CODEX_HOME || path.join(os.homedir(), ".codex"), "sessions");
}

// The day directories sessions/YYYY/MM/DD of yesterday, today and tomorrow in local time (Codex names the day
// by local time, measured: a file stamped 22:30 UTC lies in the directory of the next day at UTC+2).
function nearDayDirectories(sessionsRoot, now) {
  const pad = (value) => String(value).padStart(2, "0");
  return [-1, 0, 1].map((offset) => {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    return path.join(sessionsRoot, String(day.getFullYear()), pad(day.getMonth() + 1), pad(day.getDate()));
  });
}

// The rollout file of a thread: sessions/**/rollout-*-<thread id>.jsonl. A new file is in a day directory near
// today (cheap to look at); only a file that is not there is searched for in the whole tree, newest first.
export function findRolloutFile(sessionsRoot, threadId, { now = new Date(), deep = true } = {}) {
  const suffix = "-" + String(threadId) + ".jsonl";
  const visit = (directory) => {
    let entries;
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { return null; }
    entries.sort((left, right) => (left.name < right.name ? 1 : left.name > right.name ? -1 : 0));
    for (const entry of entries) {
      if (entry.isFile() && entry.name.startsWith("rollout-") && entry.name.endsWith(suffix)) return path.join(directory, entry.name);
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const found = visit(path.join(directory, entry.name));
      if (found) return found;
    }
    return null;
  };
  if (!String(threadId || "")) return null;
  for (const directory of nearDayDirectories(sessionsRoot, now)) {
    let names;
    try { names = fs.readdirSync(directory); } catch { continue; }
    const name = names.find((candidate) => candidate.startsWith("rollout-") && candidate.endsWith(suffix));
    if (name) return path.join(directory, name);
  }
  return deep ? visit(sessionsRoot) : null;
}

// ---- the answers to tool calls ------------------------------------------------------------------------------

// Tools of Codex that run a shell command: their input is the command, whatever else the call says (working
// directory, yield time, output limit) only describes how it was made.
const SHELL_CALLS = new Set(["exec_command", "shell", "shell_command", "local_shell", "container.exec"]);
const MAX_OPEN_CALLS = 512;
const MAX_REFUSAL_CHARS = 4_000;
// The wrapper the code-mode tool puts in front of a text: "Script failed|completed\nWall time N seconds\nOutput:\n".
const SCRIPT_WRAPPER = /^Script (?:failed|completed)[^\n]*\nWall time[^\n]*\nOutput:[ \t]*\r?\n/u;
const LINE_STAMP = /^\{"timestamp":"([^"]+)"/u;

const skipSpace = (text, index) => {
  let position = index;
  while (position < text.length && /\s/u.test(text[position])) position += 1;
  return position;
};

// The end (index after the closing quote) of the quoted text that starts at `start`, or -1.
function quotedEnd(text, start) {
  const quote = text[start];
  for (let position = start + 1; position < text.length; position += 1) {
    if (text[position] === "\\") { position += 1; continue; }
    if (text[position] === quote) return position + 1;
  }
  return -1;
}

// The index of the comma or closing brace that ends the expression starting at `start` (brackets and quoted
// texts are skipped), or -1.
function expressionEnd(text, start) {
  let depth = 0;
  for (let position = start; position < text.length; position += 1) {
    const char = text[position];
    if (char === "\"" || char === "'" || char === "`") {
      const end = quotedEnd(text, position);
      if (end < 0) return -1;
      position = end - 1;
    } else if (char === "(" || char === "[" || char === "{") depth += 1;
    else if (char === ")" || char === "]") { if (depth === 0) return -1; depth -= 1; }
    else if (char === "}") { if (depth === 0) return position; depth -= 1; }
    else if (char === "," && depth === 0) return position;
  }
  return -1;
}

// A string literal ('...', "..." or `...` without ${}) at `start`: { value, end } with the escapes decoded, or null
// for anything else (an expression is never evaluated).
function readStringLiteral(text, start) {
  const quote = text[start];
  if (quote !== "\"" && quote !== "'" && quote !== "`") return null;
  let value = "";
  let position = start + 1;
  while (position < text.length) {
    const char = text[position];
    if (char === quote) return { value, end: position + 1 };
    if (quote !== "`" && (char === "\n" || char === "\r")) return null;
    if (quote === "`" && char === "$" && text[position + 1] === "{") return null;
    if (char !== "\\") { value += char; position += 1; continue; }
    const escaped = text[position + 1];
    position += 2;
    if (escaped === undefined) return null;
    if (escaped === "n") value += "\n";
    else if (escaped === "r") value += "\r";
    else if (escaped === "t") value += "\t";
    else if (escaped === "b") value += "\b";
    else if (escaped === "f") value += "\f";
    else if (escaped === "v") value += "\v";
    else if (escaped === "0") value += "\0";
    else if (escaped === "\n") continue;
    else if (escaped === "\r") { if (text[position] === "\n") position += 1; }
    else if (escaped === "x") {
      const hex = text.slice(position, position + 2);
      if (!/^[0-9a-fA-F]{2}$/u.test(hex)) return null;
      value += String.fromCharCode(Number.parseInt(hex, 16));
      position += 2;
    } else if (escaped === "u") {
      let hex;
      if (text[position] === "{") {
        const close = text.indexOf("}", position);
        hex = close < 0 ? "" : text.slice(position + 1, close);
        if (!/^[0-9a-fA-F]{1,6}$/u.test(hex) || Number.parseInt(hex, 16) > 0x10ffff) return null;
        position = close + 1;
      } else {
        hex = text.slice(position, position + 4);
        if (!/^[0-9a-fA-F]{4}$/u.test(hex)) return null;
        position += 4;
      }
      value += String.fromCodePoint(Number.parseInt(hex, 16));
    } else value += escaped;
  }
  return null;
}

// The value of the property `wanted` of the object literal that starts at `start` (just after the opening
// parenthesis of the call), when that value is a plain string literal; null for everything else.
function objectStringField(text, start, wanted) {
  let position = skipSpace(text, start);
  if (text[position] !== "{") return null;
  position += 1;
  for (;;) {
    position = skipSpace(text, position);
    if (position >= text.length || text[position] === "}") return null;
    let key;
    const quoted = readStringLiteral(text, position);
    if (quoted) { key = quoted.value; position = quoted.end; } else {
      const bare = /^[A-Za-z_$][\w$]*/u.exec(text.slice(position, position + 80));
      if (!bare) return null;
      key = bare[0];
      position += key.length;
    }
    position = skipSpace(text, position);
    if (text[position] !== ":") return null;
    position = skipSpace(text, position + 1);
    const end = expressionEnd(text, position);
    if (end < 0) return null;
    if (key === wanted) {
      const literal = readStringLiteral(text, position);
      return literal && skipSpace(text, literal.end) === end ? literal.value : null;
    }
    if (text[end] === "}") return null;
    position = end + 1;
  }
}

// The patch that is the argument of tools.apply_patch(...): a string literal, or a constant that is declared once
// as a string literal in the same script. Null for everything else.
function patchArgument(text, start) {
  const closes = (index) => { const next = text[skipSpace(text, index)]; return next === ")" || next === ","; };
  const position = skipSpace(text, start);
  const literal = readStringLiteral(text, position);
  if (literal) return closes(literal.end) ? literal.value : null;
  const identifier = /^[A-Za-z_$][\w$]*/u.exec(text.slice(position, position + 80));
  if (!identifier || !closes(position + identifier[0].length)) return null;
  const escaped = identifier[0].replace(/[$]/gu, "\\$");
  const declarations = [...text.matchAll(new RegExp("(?:^|[^\\w$.])(?:const|let|var)\\s+" + escaped + "\\s*=\\s*", "gu"))];
  if (declarations.length !== 1) return null;
  const valueAt = declarations[0].index + declarations[0][0].length;
  const value = readStringLiteral(text, valueAt);
  if (!value) return null;
  const rest = /^[ \t]*([;\r\n]|$)/u.exec(text.slice(value.end, value.end + 80));
  return rest ? value.value : null;
}

// The identity of a code-mode script: the command of the one exec_command, or the patch of the one apply_patch,
// that it calls. A script with no such call, with more than one tool call, or whose command or patch is not a
// literal is the script itself: the refused call cannot be named, so only the same script counts as the same input.
function codeModeIdentity(script) {
  const text = String(script ?? "");
  const calls = [...text.matchAll(/\btools\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/gu)];
  if (calls.length === 1) {
    const [call] = calls;
    const open = call.index + call[0].length;
    if (call[1] === "exec_command") {
      const command = objectStringField(text, open, "cmd") ?? objectStringField(text, open, "command");
      if (command) return { name: "exec_command", input: { command } };
    } else if (call[1] === "apply_patch") {
      const patch = patchArgument(text, open);
      if (patch) return { name: "apply_patch", input: { patch } };
    }
  }
  return { name: "exec", input: { command: text } };
}

function argumentsOf(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch { return null; }
}

function shellCommand(args) {
  if (!args) return null;
  if (typeof args.cmd === "string" && args.cmd) return args.cmd;
  if (typeof args.command === "string" && args.command) return args.command;
  if (Array.isArray(args.command) && args.command.length && args.command.every((part) => typeof part === "string")) return args.command.join(" ");
  return null;
}

// The input of a call recorded in the rollout file (a response_item payload of type function_call or
// custom_tool_call) as { name, input } for the tracker's hash: tool name and what decides the call.
export function toolCallIdentity(payload) {
  const name = String(payload?.name ?? payload?.type ?? "");
  if (payload?.type === "function_call") {
    const args = argumentsOf(payload.arguments);
    if (SHELL_CALLS.has(name)) {
      const command = shellCommand(args);
      if (command !== null) return { name, input: { command } };
    }
    return { name: payload.namespace ? payload.namespace + "." + name : name, input: args ?? { arguments: String(payload.arguments ?? "") } };
  }
  const input = typeof payload?.input === "string" ? payload.input : JSON.stringify(payload?.input ?? null);
  if (name === "exec") return codeModeIdentity(input);
  if (name === "apply_patch") return { name, input: { patch: input } };
  return { name, input: { input } };
}

// The text parts of the answer to a call: one string, or a list of strings and { type: "input_text", text } parts.
function answerTexts(output) {
  if (typeof output === "string") return [output];
  if (Array.isArray(output)) {
    return output.flatMap((part) => (typeof part === "string" ? [part] : typeof part?.text === "string" ? [part.text] : []));
  }
  if (output && typeof output === "object") return answerTexts(output.content ?? output.text);
  return [];
}

// The refusal of a PreToolUse hook that an answer holds: a text part that starts with the hook's words (the
// wrapper of the code-mode tool in front of a string is not part of the text), null for an answer that ran.
// A part that only mentions the words further down is the output of a call that ran.
export function refusalOf(output) {
  for (const text of answerTexts(output)) {
    const body = text.replace(SCRIPT_WRAPPER, "");
    if (isCodexHookBlock(body)) return body.trim().slice(0, MAX_REFUSAL_CHARS);
  }
  return null;
}

// since: epoch milliseconds of this run's start; token_count events and tool calls stamped before it belong to
// earlier runs of the thread (the baseline of the tokens; calls and answers of the earlier runs are not read).
export function createRolloutReader({ sessionsRoot, threadId, since = 0, findIntervalMs = 2_000 }) {
  const reader = {
    file: null,
    offset: 0,
    baseline: 0,
    total: 0,
    runTokens: 0,
    // How often poll() looked for a file that was not there yet.
    searches: 0,
    // Number of token_count events read.
    events: 0,
    // Number of tool calls whose answer was read.
    toolAnswers: 0,
  };
  let partial = "";
  const decoder = new StringDecoder("utf8");
  let lastDeepSearch = 0;
  // Calls read and not answered yet, and the answered ones not handed over yet.
  const openCalls = new Map();
  let results = [];

  const noteTokens = (line) => {
    let event;
    try { event = JSON.parse(line); } catch { return; }
    const payload = event?.payload;
    if (event?.type !== "event_msg" || payload?.type !== "token_count") return;
    const total = usageTokens(payload.info?.total_token_usage);
    if (!total) return;
    reader.events += 1;
    reader.total = Math.max(reader.total, total);
    const stamp = Date.parse(event.timestamp);
    if (Number.isFinite(stamp) && stamp < since) reader.baseline = Math.max(reader.baseline, total);
    reader.runTokens = Math.max(reader.runTokens, reader.total - reader.baseline);
  };

  const noteTool = (line) => {
    const stamp = Date.parse(LINE_STAMP.exec(line)?.[1] ?? "");
    if (Number.isFinite(stamp) && stamp < since) return;
    let event;
    try { event = JSON.parse(line); } catch { return; }
    const payload = event?.payload;
    const callId = payload?.call_id;
    if (event?.type !== "response_item" || typeof callId !== "string" || !callId) return;
    if (payload.type === "custom_tool_call" || payload.type === "function_call") {
      openCalls.set(callId, toolCallIdentity(payload));
      if (openCalls.size > MAX_OPEN_CALLS) openCalls.delete(openCalls.keys().next().value);
    } else if (payload.type === "custom_tool_call_output" || payload.type === "function_call_output") {
      const call = openCalls.get(callId);
      if (!call) return;
      openCalls.delete(callId);
      reader.toolAnswers += 1;
      results.push({ name: call.name, input: call.input, refusal: refusalOf(payload.output) });
    }
  };

  const note = (line) => {
    if (line.includes("token_count")) noteTokens(line);
    if (line.includes("_call")) noteTool(line);
  };

  // The answers read since the last call, in file order: { name, input, refusal } with the refusal text of a
  // PreToolUse hook or null for a call that ran. Each answer is handed over once.
  reader.takeToolResults = () => {
    const taken = results;
    results = [];
    return taken;
  };

  reader.poll = (now = Date.now()) => {
    if (!reader.file) {
      // Near days at every poll; the whole tree only every findIntervalMs.
      const deep = reader.searches === 0 || now - lastDeepSearch >= findIntervalMs;
      if (deep) lastDeepSearch = now;
      reader.searches += 1;
      reader.file = findRolloutFile(sessionsRoot, threadId, { deep });
      if (!reader.file) return reader;
    }
    let descriptor;
    try { descriptor = fs.openSync(reader.file, "r"); } catch { return reader; }
    try {
      const size = fs.fstatSync(descriptor).size;
      if (size < reader.offset) {
        reader.offset = 0; partial = ""; reader.total = 0; reader.baseline = 0; reader.runTokens = 0;
        openCalls.clear(); results = [];
      }
      const chunk = Buffer.alloc(1024 * 1024);
      while (reader.offset < size) {
        const read = fs.readSync(descriptor, chunk, 0, Math.min(chunk.length, size - reader.offset), reader.offset);
        if (read <= 0) break;
        reader.offset += read;
        const lines = (partial + decoder.write(chunk.subarray(0, read))).split("\n");
        partial = lines.pop() ?? "";
        for (const line of lines) note(line);
      }
    } catch { /* a file that cannot be read now is read at the next poll */ }
    finally { fs.closeSync(descriptor); }
    return reader;
  };
  return reader;
}
