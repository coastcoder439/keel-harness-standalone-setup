#!/usr/bin/env node
// Claude Code Stop hook for one unlazy pipeline. Zero dependencies. Node 16+.
//
// The decision lives in runStopHook(): it takes the hook input and returns the JSON line for stdout and
// the exit code, and it never exits the process itself. Run as a program (node stop-hook.mjs ...) the file
// reads stdin, calls runStopHook() and exits, exactly as before. A host adapter that loads the file with
// import() sets globalThis[EMBEDDED] first, so loading it starts nothing; it then calls runStopHook() in its
// own process (P4 A16: one Node process per Stop instead of two).

import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import {
  UNLAZY_DIR, gateState, hookStatePath, parseGates, qualify, resolveTarget, scopeRoot,
  sha256, validateScopeId, withFileLock, writeAtomic,
} from "./lib/gates.mjs";
import { dispatchStatus } from "./lib/dispatch.mjs";
import { resolvePackageTarget } from "./lib/packages.mjs";

// Safety valve: after MAX_BLOCKS consecutive blocks without gate progress the agent is released.
// Origin: Unlazy original (upstream Stop hook, six-block no-progress release; see CHANGELOG.md of this
// vendor tree and README "progress guard"), kept as it is -- F1 (origin of every limit) and F2 of the
// harness rebuild. The valve stops endless loops and aborts no work. P4 F2 keeps it and makes the release
// visible: the message lists the open items and a marker file in the runtime folder of the package
// (RELEASE_MARKER) records it, so executor and orchestrator can see that the agent left with open checks.
export const MAX_BLOCKS = 6;
export const RELEASE_MARKER = "stop-released.json";
// Set by an adapter before import() so that loading this file runs nothing.
export const EMBEDDED = Symbol.for("keel.unlazy.stop-hook.embedded");

const MAX_LISTED_ITEMS = 10;
const MAX_MARKED_ITEMS = 50;

const safeHostText = (value, max = 500) => String(value)
  .replace(/[\u0000-\u001f\u007f-\u009f؜‎‏‪-‮⁦-⁩]/g, " ")
  .replace(/\s+/g, " ")
  .trim()
  .slice(0, max);

function normalizeHookState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.schema !== 1 ||
      !value.sessions || typeof value.sessions !== "object" || Array.isArray(value.sessions)) {
    return { schema: 1, sessions: {} };
  }
  const sessions = {};
  for (const [key, current] of Object.entries(value.sessions)) {
    if (!/^[a-f0-9]{24}$/.test(key) || !current || typeof current !== "object" || Array.isArray(current) ||
        !/^[a-f0-9]{24}$/.test(String(current.hash || "")) ||
        !Number.isInteger(current.blocks) || current.blocks < 0 ||
        typeof current.updatedAt !== "string" || Number.isNaN(Date.parse(current.updatedAt))) continue;
    sessions[key] = current;
  }
  return { schema: 1, sessions };
}

function optionValue(args, name) {
  const indexes = args.map((value, index) => value === name ? index : -1).filter((index) => index >= 0);
  if (indexes.length !== 1) return indexes.length ? { error: "duplicate " + name } : { value: null };
  const value = args[indexes[0] + 1];
  return !value || value.startsWith("--") ? { error: name + " needs a value" } : { value };
}

// The release marker: one small file next to hook-state.json, newest release first. It is a record for
// the executor and the orchestrator, never an input of any decision. Failing to write it never traps the
// session; the caller learns the outcome and says so in its message.
function markRelease(root, target, sessionKey, blocks, outstanding) {
  const file = target.scope ? join(scopeRoot(root, target.scope), RELEASE_MARKER) : join(root, ".unlazy-stop-released.json");
  let previous = { releases: 0 };
  try {
    const value = JSON.parse(readFileSync(file, "utf8"));
    if (value && Number.isInteger(value.releases) && value.releases >= 0) previous = value;
  } catch { /* first release or unreadable marker */ }
  const record = {
    schema: 1,
    event: "stop-released-with-open-items",
    releasedAt: new Date().toISOString(),
    session: sessionKey,
    blocks,
    maxBlocks: MAX_BLOCKS,
    package: target.mode === "package" ? target.packageId : null,
    scope: target.scope || null,
    releases: previous.releases + 1,
    openCount: outstanding.length,
    open: outstanding.slice(0, MAX_MARKED_ITEMS),
  };
  try {
    writeAtomic(file, JSON.stringify(record, null, 2) + "\n", { root });
    return { file, written: true };
  } catch (error) {
    return { file, written: false, error: safeHostText(error.message, 200) };
  }
}

// args: the command line after the script name (--scope, --package, --legacy; --unlazy-hook-v2 is ignored).
// input: the hook payload as text. cwd: the directory used when the payload names none.
// Returns { exitCode, stdout }; stdout is "" or one JSON line with a trailing newline.
export async function runStopHook({ args = [], input = "", cwd = process.cwd() } = {}) {
  const allow = (message) => ({
    exitCode: 0,
    stdout: message ? JSON.stringify({ systemMessage: message }) + "\n" : "",
  });
  const scopeOption = optionValue(args, "--scope");
  const packageOption = optionValue(args, "--package");
  const scopeArg = scopeOption.value;
  const packageArg = packageOption.value;
  const legacy = args.includes("--legacy");

  if (scopeOption.error || packageOption.error || (scopeArg && validateScopeId(scopeArg))) {
    return allow("unlazy: installed hook has invalid package targeting; not blocking.");
  }
  if (legacy && packageArg) {
    return allow("unlazy: installed hook combines --legacy and --package; not blocking.");
  }

  let payload = {};
  try { payload = JSON.parse(input || "{}"); }
  catch { return allow(null); }
  if (payload.stop_hook_active === true) return allow(null);

  const invocationCwd = resolve(typeof payload.cwd === "string" && payload.cwd ? payload.cwd : cwd);
  const sessionId = payload.session_id || payload.sessionId || "anonymous";
  const sessionKey = sha256(String(sessionId)).slice(0, 24);
  let root = invocationCwd;
  let target;
  if (legacy) {
    target = resolveTarget({ root, scope: scopeArg, sessionId, legacy: true });
  } else {
    try {
      const packageTarget = resolvePackageTarget({
        cwd: invocationCwd,
        ...(packageArg ? { packageId: packageArg } : {}),
        ...(scopeArg ? { scope: scopeArg } : {}),
        sessionId,
      });
      if (!packageTarget.scope) throw new Error("resolved package has no active scope with a valid package.ref");
      if (packageArg && scopeArg) {
        const expected = process.platform === "win32" ? scopeArg.toLowerCase() : scopeArg;
        const actual = process.platform === "win32" ? packageTarget.scope.toLowerCase() : packageTarget.scope;
        if (actual !== expected) throw new Error("--package " + packageArg + " is not active in --scope " + scopeArg);
      }
      root = packageTarget.repoRoot;
      target = { ...packageTarget, mode: "package", files: packageTarget.gateFiles };
    } catch (error) {
      return allow("unlazy: " + safeHostText(error.message) + "; not blocking. Run package-cli doctor for the same repository state.");
    }
  }

  if (target.ambiguous) {
    return allow("unlazy: " + target.ambiguous.length + " pipelines under " + UNLAZY_DIR +
      "/ (" + target.ambiguous.join(", ") + ") and none bound to this session; not blocking.");
  }
  if (target.error && !target.ambiguous) return allow("unlazy: " + safeHostText(target.error) + "; not blocking.");

  const statePath = hookStatePath(root, target.scope);
  const qualified = (file, gateId) => target.mode === "package"
    ? target.packageId + "/" + relative(root, resolve(file)).replaceAll("\\", "/") + ":" + gateId
    : qualify(file, gateId);

  async function clearSessionState() {
    if (!existsSync(statePath)) return;
    try {
      await withFileLock(root, statePath, () => {
        let state = { schema: 1, sessions: {} };
        try { state = JSON.parse(readFileSync(statePath, "utf8")); } catch { /* replace invalid local state */ }
        state = normalizeHookState(state);
        delete state.sessions[sessionKey];
        if (!Object.keys(state.sessions).length) {
          if (target.mode === "package") {
            writeAtomic(statePath, JSON.stringify({ schema: 1, sessions: {} }, null, 2) + "\n", { root });
          } else {
            try { unlinkSync(statePath); } catch { /* already absent */ }
          }
        } else writeAtomic(statePath, JSON.stringify(state, null, 2) + "\n", { root });
      }, { timeoutMs: 10000 });
    } catch {
      // State cleanup must never trap a session after the gates are complete.
    }
  }

  const dispatch = dispatchStatus(root, target.scope, target.mode === "package" ? target.packageId : null);

  if (!target.files.length && !dispatch.blocking.length && !dispatch.abandoned.length) {
    await clearSessionState();
    return allow(null);
  }

  const unmet = [...dispatch.blocking];
  const invalid = [];
  const handoffs = [...dispatch.abandoned];
  const handoffMessage = () => {
    if (!handoffs.length) return "";
    const shown = handoffs.slice(0, 5).join(", ") +
      (handoffs.length > 5 ? ", +" + (handoffs.length - 5) + " more" : "");
    return " HANDOFF REQUIRED: " + handoffs.length + " abandoned item(s): " + safeHostText(shown) + ".";
  };
  // The loop guard compares resolved gate state between stops, not raw bytes.
  // Byte comparison counted any edit as progress: a comment, a reflowed line, or
  // the checker rewriting an evidence line with a fresh PATH hash. That rearmed
  // the guard indefinitely, so the six-block release could only ever fire for an
  // agent doing literally nothing, which is the one case least in need of it.
  // Dispatch issue strings encode only canonical state and counts, not raw JSON
  // bytes or timestamps, so metadata-only edits do not reset the same guard.
  const resolved = [...dispatch.resolved];
  const orderedFiles = target.mode === "package" ? [...target.files] : [...target.files].sort();
  for (const file of orderedFiles) {
    let text;
    try { text = readFileSync(file, "utf8"); }
    catch (error) {
      invalid.push(qualified(file, "PARSE") + " unreadable: " + safeHostText(error.message));
      resolved.push(qualified(file, "PARSE") + "=unreadable");
      continue;
    }
    const doc = parseGates(text);
    if (doc.errors.length) {
      invalid.push(qualified(file, "PARSE") + " " + doc.errors.slice(0, 2).map((error) => safeHostText(error)).join("; "));
      // Record only that the ledger is invalid. Diagnostic text carries line
      // numbers, which shift on an unrelated edit and would restore byte coupling.
      resolved.push(qualified(file, "PARSE") + "=invalid");
      continue;
    }
    for (const gate of doc.gates) {
      const state = gateState(gate, doc.abandoned);
      resolved.push(qualified(file, gate.id) + "=" + state);
      if (state === "unmet" || state === "unmet-no-evidence") unmet.push(qualified(file, gate.id));
      else if (state === "abandoned") handoffs.push(qualified(file, gate.id));
    }
  }

  if (!unmet.length && !invalid.length) {
    await clearSessionState();
    if (!handoffs.length) return allow(null);
    const where = target.mode === "package" ? " [" + (target.repoKey || ".") + "::" + target.packageId +
      ", scope " + target.scope + "]" : target.scope ? " [scope " + target.scope + "]" : "";
    return allow("unlazy" + where + ":" + handoffMessage());
  }

  const progressHash = sha256(resolved.sort().join("\0")).slice(0, 24);
  let sessionState;
  try {
    sessionState = await withFileLock(root, statePath, () => {
      let state = { schema: 1, sessions: {} };
      try { state = JSON.parse(readFileSync(statePath, "utf8")); } catch { /* new or corrupt local state */ }
      state = normalizeHookState(state);
      let current = state.sessions[sessionKey];
      if (!current || current.hash !== progressHash) current = { hash: progressHash, blocks: 0 };
      current.blocks += 1;
      current.updatedAt = new Date().toISOString();
      state.sessions[sessionKey] = current;
      // Bound abandoned session debris without mixing counters between sessions.
      const entries = Object.entries(state.sessions).sort((a, b) => String(b[1].updatedAt).localeCompare(String(a[1].updatedAt)));
      state.sessions = Object.fromEntries(entries.slice(0, 64));
      writeAtomic(statePath, JSON.stringify(state, null, 2) + "\n", { root });
      return current;
    }, { timeoutMs: 10000 });
  } catch (error) {
    return allow("unlazy: could not update the serialized hook state (" + safeHostText(error.message) + "); not blocking to avoid a trap.");
  }

  const where = target.mode === "package" ? " [" + (target.repoKey || ".") + "::" + target.packageId +
    ", scope " + target.scope + "]" : target.scope ? " [scope " + target.scope + "]" : "";
  const outstanding = [...invalid, ...unmet].map((item) => safeHostText(item));
  if (sessionState.blocks > MAX_BLOCKS) {
    // F2: the release stays, but it is never silent. The message names every open item (up to
    // MAX_LISTED_ITEMS) and the marker file tells the executor and the orchestrator.
    const marker = markRelease(root, target, sessionKey, sessionState.blocks, outstanding);
    const listed = outstanding.slice(0, MAX_LISTED_ITEMS).join(", ") +
      (outstanding.length > MAX_LISTED_ITEMS ? ", +" + (outstanding.length - MAX_LISTED_ITEMS) + " more" : "");
    const markerText = marker.written
      ? " Marker: " + relative(root, marker.file).replaceAll("\\", "/") + "."
      : " Marker could not be written (" + marker.error + ").";
    return allow("unlazy: releasing after " + MAX_BLOCKS + " blocks without gate progress" + where +
      "; " + outstanding.length + " item(s) remain (" + listed + "). " +
      "RELEASED WITH OPEN CHECKS: these checks stay open in the package and are verified again at integration." +
      markerText + handoffMessage());
  }

  const list = outstanding.slice(0, 5).join(", ") + (outstanding.length > 5 ? ", +" + (outstanding.length - 5) + " more" : "");
  return {
    exitCode: 0,
    stdout: JSON.stringify({
      decision: "block",
      reason: "unlazy" + where + ": " + outstanding.length + " gate/ledger/dispatch item(s) need work: " + list +
        ". Run gate-check.mjs --package <id> --scope <id> --status to inspect without execution. To run inherited CHECK lines, inspect them and use --approve. " +
        "Use ABANDON: <id> <non-blank reason> only when a gate is genuinely impossible." + handoffMessage(),
    }) + "\n",
  };
}

// Run as a program: unchanged contract (stdin in, one JSON line out, exit 0).
if (!globalThis[EMBEDDED]) {
  let input = null;
  try { input = readFileSync(0, "utf8"); } catch { /* an unreadable stdin never blocks */ }
  const result = input === null ? { exitCode: 0, stdout: "" } : await runStopHook({ args: process.argv.slice(2), input });
  if (result.stdout) process.stdout.write(result.stdout, () => process.exit(result.exitCode));
  else process.exit(result.exitCode);
}
