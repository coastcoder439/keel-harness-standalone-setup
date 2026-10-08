// What a provider's event stream says about its run, read event by event (P12, Konzept 3.6).
// provider-runtime.mjs feeds every parsed line of Claude stream-json or Codex exec --json into one
// tracker (and, for Codex, the answered tool calls that codex-rollout.mjs reads from the rollout file) and asks it
// four questions:
//  - openTools: is a tool call running right now (the silence watcher must not end such a run)?
//  - result: what did the last result of the session say (error subtype, failed turn)?
//  - budget: did the run end at its cost frame (Claude) or has it used its token frame (Codex, from turn.completed and from the rollout file)?
//  - repeatedBlock: was the same tool input refused by a PreToolUse hook three times in a row?
// Pure functions and one small object: no process, no file, so every rule is testable on its own.

import crypto from "node:crypto";

// Claude Code's result subtype for --max-budget-usd (checked in the claude binary, 2.1.183).
export const CLAUDE_BUDGET_SUBTYPE = "error_max_budget_usd";
// A guard refuses a tool three times in a row for the same input: the run stops (Konzept 3.6).
export const REPEATED_BLOCK_LIMIT = 3;

// What counts as a refusal: only the real answer of a PreToolUse hook that stopped the call, never the text
// of a call that ran (a red test that prints a guard's name is an ordinary result).
//  - Claude Code (measured 06.10.2026 in 320+ recorded results of the Harness sessions): a tool_result with
//    is_error true whose text starts with `PreToolUse:<Tool> hook error: [<hook command>]: <guard text>`.
//    The refused command never ran.
//  - Codex: the tool result starts with `Command blocked by PreToolUse hook: <guard text>` (also
//    `Tool call blocked by PreToolUse hook:`), in code mode behind `Script error:`. Fundort: the rollout file of a
//    `codex exec` run (~/.codex/sessions/**/rollout-*-<thread id>.jsonl, originator codex_exec, Codex 0.153.4;
//    56 refused calls in the files of 09.09. to 02.10.2026), as the response_item `custom_tool_call_output` (code
//    mode: the second text part of the answer, after the "Script failed ... Output:" part) or
//    `function_call_output` of the call, joined to its custom_tool_call / function_call by call_id. A call that a
//    hook refuses leaves NO item in the `codex exec --json` stream (finding of the Orchestrator, 06.10.2026),
//    so the refusals of a Codex run come from codex-rollout.mjs, which hands every answered call (refused or not)
//    to noteToolResult below; the same counter then counts them. The item.completed route further down is kept
//    for a refusal that a stream item may carry; it looks at every text field and matches only at the start.
const CLAUDE_HOOK_BLOCK = /^\s*PreToolUse:\S+ hook error:/u;
const CODEX_HOOK_BLOCK = /^\s*(?:Script error:\s*)?(?:Command|Tool call) blocked by PreToolUse hook:/u;
const MAX_STORED_TEXT = 2_000;

export function isClaudeHookBlock(text) {
  return CLAUDE_HOOK_BLOCK.test(String(text ?? ""));
}

export function isCodexHookBlock(text) {
  return CODEX_HOOK_BLOCK.test(String(text ?? ""));
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

// Shell tools are the same input when the command is the same; every other field (description, timeout,
// run_in_background, ...) only describes how the call was made.
const SHELL_TOOLS = new Set(["bash", "powershell", "command_execution"]);
// Fields of other tools that describe the call to a human and do not decide what it does.
const DESCRIPTIVE_FIELDS = new Set(["description", "action_summary", "summary", "explanation", "reason", "rationale",
  "comment", "statusMessage", "status_message"]);

function identityOf(name, input) {
  if (SHELL_TOOLS.has(String(name).toLowerCase()) && typeof input?.command === "string") return input.command;
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return stable(Object.fromEntries(Object.entries(input).filter(([key]) => !DESCRIPTIVE_FIELDS.has(key))));
  }
  return stable(input ?? null);
}

// Hash of tool name and the fields that decide the call, the identity of "the same input".
export function toolInputHash(name, input) {
  return crypto.createHash("sha256").update(String(name) + "\0" + JSON.stringify(identityOf(name, input))).digest("hex");
}

function commandOf(input) {
  if (input && typeof input === "object") {
    for (const key of ["command", "file_path", "path", "pattern", "url", "patch"]) {
      if (typeof input[key] === "string" && input[key]) return input[key].slice(0, MAX_STORED_TEXT);
    }
  }
  return JSON.stringify(input ?? null).slice(0, MAX_STORED_TEXT);
}

// The text of a Claude tool_result block: a string, or a list of { type: "text", text } parts.
function resultText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => (typeof part === "string" ? part : typeof part?.text === "string" ? part.text : "")).join("\n");
  }
  return "";
}

// Codex items that are a tool call or a command; messages, reasoning, plans and errors are not.
const NON_TOOL_ITEMS = new Set(["agent_message", "reasoning", "todo_list", "error", "user_message"]);

export function isCodexToolItem(item) {
  return Boolean(item) && typeof item.type === "string" && !NON_TOOL_ITEMS.has(item.type);
}

function codexInput(item) {
  if (item.type === "command_execution") return { command: item.command };
  const input = {};
  for (const key of ["server", "tool", "arguments", "query", "changes", "path"]) if (item[key] !== undefined) input[key] = item[key];
  return Object.keys(input).length ? input : { type: item.type };
}

// Every text an item.completed carries, one entry per field (a refusal is recognized at the start of a field).
function codexTexts(item) {
  const parts = [];
  for (const key of ["aggregated_output", "output", "stderr", "stdout", "message"]) {
    if (typeof item[key] === "string") parts.push(item[key]);
  }
  if (typeof item.error === "string") parts.push(item.error);
  else if (typeof item.error?.message === "string") parts.push(item.error.message);
  if (item.result !== undefined) parts.push(typeof item.result === "string" ? item.result : resultText(item.result?.content));
  return parts.filter((part) => typeof part === "string" && part);
}

// What turn.completed.usage and the rollout's total_token_usage both count: input and output tokens (the
// cached and reasoning tokens are parts of those two, measured on real rollouts: total_tokens = input + output).
export function usageTokens(usage) {
  if (!usage || typeof usage !== "object") return 0;
  const used = Number(usage.input_tokens || 0) + Number(usage.output_tokens || 0);
  return Number.isFinite(used) && used > 0 ? used : 0;
}

export function createEventTracker({ provider, tokenBudget = null } = {}) {
  const open = new Map();
  const inputs = new Map();
  // Refusals in a row per tool input (hash). A call of the same input that was not refused removes its entry.
  const blocks = new Map();
  const state = {
    resultErrored: false,
    resultSubtype: "",
    // What the provider said about a failed result (Claude: the result text of an is_error result, e.g. "Not logged in",
    // an API error), on one line. Without it a run that ended with exit 1 only says "provider exited 1".
    resultMessage: "",
    budgetReached: false,
    // Codex: tokens counted from turn.completed (streamTokens) and from the rollout file (rolloutTokens, the
    // tokens of this run only); tokensUsed is the larger of the two.
    tokensUsed: 0,
    streamTokens: 0,
    rolloutTokens: 0,
    // A turn.completed or turn.failed was seen and no turn started after it: the run is wrapping up.
    turnDone: false,
    // Set only when the rollout file showed the frame used up while a turn was still running. The frame
    // reached at turn.completed never stops a run (the process ends by itself).
    budgetStop: false,
    repeatedBlock: null,
    nativeHandle: "",
  };

  const frameSet = () => provider === "codex" && Number.isFinite(tokenBudget) && tokenBudget > 0;
  const tokensChanged = () => {
    state.tokensUsed = Math.max(state.streamTokens, state.rolloutTokens);
    if (frameSet() && state.tokensUsed >= tokenBudget) state.budgetReached = true;
  };

  const noteResult = (name, input, refusal) => {
    const hash = toolInputHash(name, input);
    if (refusal === null) { blocks.delete(hash); return; }
    const count = (blocks.get(hash) || 0) + 1;
    blocks.set(hash, count);
    if (count >= REPEATED_BLOCK_LIMIT && !state.repeatedBlock) {
      state.repeatedBlock = { tool: String(name), command: commandOf(input), input: stable(input ?? null), hash, count,
        message: String(refusal).trim().slice(0, MAX_STORED_TEXT) };
    }
  };

  const claudeBlocks = (event) => {
    const content = event.message?.content;
    if (!Array.isArray(content)) return;
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      if (event.type === "assistant" && block.type === "tool_use" && typeof block.id === "string") {
        open.set(block.id, block.name);
        inputs.set(block.id, block.input);
      } else if (event.type === "user" && block.type === "tool_result" && typeof block.tool_use_id === "string") {
        const name = open.get(block.tool_use_id);
        const input = inputs.get(block.tool_use_id);
        open.delete(block.tool_use_id);
        inputs.delete(block.tool_use_id);
        if (name !== undefined) {
          const text = resultText(block.content);
          noteResult(name, input, block.is_error === true && isClaudeHookBlock(text) ? text : null);
        }
      }
    }
  };

  const codexItem = (event) => {
    const item = event.item;
    if (!item || typeof item.id !== "string" || !isCodexToolItem(item)) return;
    if (event.type === "item.started") {
      open.set(item.id, item.type);
      inputs.set(item.id, codexInput(item));
    } else if (event.type === "item.completed") {
      const input = inputs.get(item.id) ?? codexInput(item);
      open.delete(item.id);
      inputs.delete(item.id);
      const refusal = codexTexts(item).find(isCodexHookBlock);
      noteResult(item.type === "command_execution" ? "command_execution" : String(item.tool || item.type), input,
        refusal === undefined ? null : refusal);
    }
  };

  const turnEnded = () => { open.clear(); inputs.clear(); state.turnDone = true; };

  return {
    state,
    // Number of tool calls started and not yet answered.
    get openTools() { return open.size; },
    // An answered tool call from outside the event stream: for Codex the rollout file (codex-rollout.mjs), where a
    // call that a hook refused is recorded and the stream shows nothing. `refusal` is the text of the hook's
    // refusal or null for a call that ran; it goes through the same counter as the stream's results: a refusal
    // adds to the series of its input, a call of the same input that ran ends it. Text that is no hook refusal
    // never counts, whoever hands it over.
    noteToolResult({ name, input, refusal = null } = {}) {
      if (name === undefined || name === null || String(name) === "") return;
      const text = refusal === null || refusal === undefined ? "" : String(refusal);
      noteResult(name, input, isCodexHookBlock(text) || isClaudeHookBlock(text) ? text : null);
    },
    // The tokens of this run as the Codex rollout file reports them (see codex-rollout.mjs). They only grow.
    noteRolloutTokens(total) {
      if (!Number.isFinite(total) || total <= state.rolloutTokens) return;
      state.rolloutTokens = total;
      tokensChanged();
      if (state.budgetReached && !state.turnDone) state.budgetStop = true;
    },
    feed(event) {
      if (!event || typeof event !== "object") return;
      if (event.type === "assistant" || event.type === "user") claudeBlocks(event);
      else if (event.type === "item.started" || event.type === "item.completed") codexItem(event);
      // Claude: the last result event of a session decides (measured 05.10.2026: error_max_turns followed
      // by success in the same session, exit 0). A result ends the turn: calls still open are over.
      if (event.type === "result") {
        const subtype = String(event.subtype || "");
        state.resultErrored = event.is_error === true || subtype.startsWith("error");
        state.resultSubtype = state.resultErrored ? (subtype || "error") : "";
        state.resultMessage = state.resultErrored && typeof event.result === "string"
          ? event.result.replace(/\s+/gu, " ").trim().slice(0, 300) : "";
        // The last result decides here too: a run that went on after the cost frame is not "at" it.
        state.budgetReached = subtype === CLAUDE_BUDGET_SUBTYPE;
        turnEnded();
      }
      if (event.type === "turn.started") state.turnDone = false;
      // Codex reports a failed turn as turn.failed; its "error" events are often warnings (measured
      // 01.10.2026: "Skill descriptions were shortened ...") and fail nothing. A later turn.completed of
      // the same session takes the failure back.
      if (event.type === "turn.failed") { state.resultErrored = true; state.resultSubtype = "turn.failed"; turnEnded(); }
      if (event.type === "turn.completed") {
        state.resultErrored = false;
        state.resultSubtype = "";
        turnEnded();
        // Codex has no budget switch (codex exec --help, 0.153.4). The usage of every completed turn is
        // counted here; during a turn the rollout file is the only source (usage comes only at the end of
        // a turn). The frame reached here never ends the run: it ends by itself after turn.completed.
        state.streamTokens += usageTokens(event.usage);
        tokensChanged();
      }
      const nativeValue = typeof event.session_id === "string" ? event.session_id
        : event.type === "thread.started" && typeof event.thread_id === "string" ? event.thread_id : "";
      if (nativeValue.trim() && !state.nativeHandle) state.nativeHandle = nativeValue.trim();
    },
  };
}
