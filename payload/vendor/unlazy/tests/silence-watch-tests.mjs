#!/usr/bin/env node
// Silence-watcher regressions: a child is aborted only when it is really hung.
// Zero dependencies. The children are small `node -e` programs.

import { spawn } from "node:child_process";
import { constants as bufferConstants } from "node:buffer";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Writable } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  DEFAULT_SILENCE_MS, TreeSample, decodeOutput, listProcesses, noteLastSeen, parseProcStatChildCpu, runWatched, silenceMs, treeActivity,
  treeMembers,
} from "../scripts/lib/silence-watch.mjs";
import { terminateProcessTree } from "../scripts/lib/process-tree.mjs";
import { emitTestCounts, skipTest, SkippedTest } from "./helpers/test-counts.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MODULE = join(HERE, "..", "scripts", "lib", "silence-watch.mjs");
const NODE = process.execPath;
const SHORT_ENV = { ...process.env, KEEL_SILENCE_MS: "1500", KEEL_SILENCE_SAMPLE_MS: "500" };
const tests = [];
const filter = process.argv[2] || "";
const test = (name, fn) => tests.push({ name, fn });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function assertEqual(actual, expected, message) {
  if (actual !== expected) throw new Error(message + " (expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual) + ")");
}

const dirs = [];
function scratch() {
  const dir = mkdtempSync(join(tmpdir(), "unlazy-silence-"));
  dirs.push(dir);
  return dir;
}
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const alive = (pid) => {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === "EPERM"; }
};
async function waitDead(pid, ms = 5000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (!alive(pid)) return true;
    await sleep(100);
  }
  return !alive(pid);
}
const watch = (code, options = {}) => runWatched(NODE, ["-e", code], { env: SHORT_ENV, ...options });
const countingProbe = (values) => {
  const probe = async () => { probe.calls += 1; return values(probe.calls); };
  probe.calls = 0;
  return probe;
};

test("a chatty child is not aborted and the CPU measurement never runs", async () => {
  const probe = countingProbe(() => 0);
  const result = await watch(
    "let n=0;const t=setInterval(()=>{process.stdout.write('tick '+(++n)+'\\n');if(n>=14){clearInterval(t)}},300)",
    { cpuProbe: probe },
  );
  assertEqual(result.hung, false, "chatty child must not be hung");
  assertEqual(result.code, 0, "exit code");
  assert(result.durationMs >= 3500, "child ran its whole 4 s: " + result.durationMs);
  assertEqual(probe.calls, 0, "no measurement while output flows (no process flood)");
  assert(result.stdout.includes("tick 14"), "output collected");
});

test("a silent sleeping child is aborted after silence plus measurement", async () => {
  const dir = scratch();
  const pidFile = join(dir, "pid");
  const result = await watch(
    "require('fs').writeFileSync(" + JSON.stringify(pidFile) + ",String(process.pid));setTimeout(()=>{},60000)",
  );
  assertEqual(result.hung, true, "sleeping child must be hung");
  assert(result.durationMs < 30000, "must end well under the 60 s sleep: " + result.durationMs);
  assert(result.durationMs >= 1500, "must wait for the silence threshold: " + result.durationMs);
  assert(/no output for/.test(result.hungReason) && /CPU time/.test(result.hungReason), "reason names silence and CPU: " + result.hungReason);
  if (process.platform === "win32" || process.platform === "linux") {
    // A sleeping process raises none of the I/O / child-CPU counters: the real
    // measurement saw them standing still, which is what makes the hang visible.
    assert(/no I\/O or operation counter grew/.test(result.hungReason), "reason names the standing counters: " + result.hungReason);
  }
  assert(await waitDead(Number(readFileSync(pidFile, "utf8"))), "the hung child is dead");
});

test("the hang is killed through the shared process-tree helper", async () => {
  const calls = [];
  const result = await watch("setTimeout(()=>{},60000)", {
    terminateTree: (child) => { calls.push(child.pid); return terminateProcessTree(child); },
  });
  assertEqual(result.hung, true, "hung");
  assertEqual(calls.length, 1, "terminateTree called once");
  assert(Number.isInteger(calls[0]) && calls[0] > 0, "called with the child handle");
});

test("a silent child whose CPU time grows is not aborted (injected measurement)", async () => {
  const probe = countingProbe((call) => call * 2);
  const result = await watch("setTimeout(()=>{},4000)", { cpuProbe: probe });
  assertEqual(result.hung, false, "growing CPU time means active");
  assertEqual(result.code, 0, "exit code");
  assert(probe.calls >= 2, "measured at least once per silence period: " + probe.calls);
});

test("a silent child whose CPU time stands still is aborted (injected measurement)", async () => {
  const result = await watch("setTimeout(()=>{},60000)", { cpuProbe: countingProbe(() => 5) });
  assertEqual(result.hung, true, "no growth means hung");
  assert(result.durationMs < 20000, "ended early: " + result.durationMs);
  assert(/grew only 0\.00 s/.test(result.hungReason), "growth reported: " + result.hungReason);
});

test("a silent computing child is not aborted (real measurement)", async () => {
  const result = await watch("const e=Date.now()+6000;while(Date.now()<e){}", {
    silenceMs: 1500, sampleMs: 1500,
  });
  assertEqual(result.hung, false, "computing child must not be hung: " + result.hungReason);
  assertEqual(result.code, 0, "exit code");
  assert(result.durationMs >= 5500, "ran to the end: " + result.durationMs);
});

test("a grandchild holding the pipes after the child exited is ended and dies", async () => {
  const dir = scratch();
  const pidFile = join(dir, "grandchild.pid");
  const grandchild = "require('fs').writeFileSync(" + JSON.stringify(pidFile) + ",String(process.pid));setTimeout(()=>{},60000)";
  const parent =
    "const c=require('child_process').spawn(process.execPath,['-e'," + JSON.stringify(grandchild) + "]," +
    // Windows: libuv puts a plain Node child into a kill-on-close job owned by
    // its parent, so it would die with the parent. Detached children escape that
    // job and survive, which is what a real pipe-holding grandchild does. POSIX:
    // a plain child stays in the leader's process group, where the kill reaches it.
    "{stdio:['ignore','inherit','inherit'],detached:process.platform==='win32'});c.unref();" +
    "const f=require('fs'),p=" + JSON.stringify(pidFile) + ";" +
    "const w=setInterval(()=>{if(f.existsSync(p)&&f.readFileSync(p,'utf8')){clearInterval(w);process.exit(0)}},50)";
  const result = await watch(parent);
  assertEqual(result.hung, true, "pipe holder is a hang");
  assertEqual(result.code, 0, "the child's own exit code is kept");
  assert(result.durationMs < 30000, "ended long before the grandchild's 60 s: " + result.durationMs);
  assert(await waitDead(Number(readFileSync(pidFile, "utf8"))), "the grandchild is dead");
});

test("outputFile receives 3 MiB completely, with byte count and hash", async () => {
  const dir = scratch();
  const file = join(dir, "out.txt");
  const code =
    "const b=(i)=>Buffer.alloc(1024,i%251);" +
    "for(let i=0;i<3072;i++)process.stdout.write(b(i));process.stderr.write('done\\n')";
  const expected = createHash("sha256");
  for (let i = 0; i < 3072; i++) expected.update(Buffer.alloc(1024, i % 251));
  const result = await watch(code, { outputFile: file });
  assertEqual(result.code, 0, "exit code");
  assertEqual(result.hung, false, "not hung");
  assertEqual(result.stdoutBytes, 3 * 1024 * 1024, "stdoutBytes");
  assertEqual(statSync(file).size, 3 * 1024 * 1024, "file size");
  assertEqual(result.stdoutSha256, expected.digest("hex"), "stdoutSha256 from the stream");
  assertEqual(createHash("sha256").update(readFileSync(file)).digest("hex"), result.stdoutSha256, "file matches hash");
  assertEqual(result.outputFile, file, "outputFile echoed");
  assert(result.stdout.length <= 64 * 1024, "memory holds only the tail: " + result.stdout.length);
  assertEqual(readFileSync(file + ".stderr", "utf8"), "done\n", "stderr goes to <outputFile>.stderr");
  assertEqual(result.stderrBytes, 5, "stderrBytes");
  assertEqual(result.spawnError, null, "a normal close of the output files is not reported");
});

test("without outputFile there is no output cap", async () => {
  const result = await watch(
    "const b=Buffer.alloc(1024,65);for(let i=0;i<2560;i++)process.stdout.write(b)",
  );
  assertEqual(result.code, 0, "exit code");
  assertEqual(result.stdout.length, 2560 * 1024, "all 2.5 MiB kept in memory (the old cap was 1 MiB)");
  assertEqual(result.stdoutBytes, 2560 * 1024, "stdoutBytes");
  assertEqual(result.outputFile, null, "no outputFile");
});

test("a failed CPU measurement counts as active, with one note", async () => {
  const probe = async () => { probe.calls += 1; throw new Error("probe boom"); };
  probe.calls = 0;
  const result = await watch("setTimeout(()=>{},4500)", { cpuProbe: probe });
  assertEqual(result.hung, false, "measurement failure must not abort");
  assertEqual(result.code, 0, "exit code");
  assert(probe.calls >= 2, "measurement was retried on later silence periods: " + probe.calls);
  const notes = result.stderr.split("\n").filter((line) => line.includes("CPU measurement failed"));
  assertEqual(notes.length, 1, "noted exactly once in stderr");
  assert(notes[0].includes("probe boom"), "note carries the cause");
});

test("silenceMs() reads KEEL_SILENCE_MS and falls back to 30 minutes", () => {
  assertEqual(DEFAULT_SILENCE_MS, 30 * 60 * 1000, "default is 30 min");
  assertEqual(silenceMs({ KEEL_SILENCE_MS: "1500" }), 1500, "valid value");
  assertEqual(silenceMs({ KEEL_SILENCE_MS: "1000" }), 1000, "lower bound accepted");
  assertEqual(silenceMs({ KEEL_SILENCE_MS: " 90000 " }), 90000, "whitespace tolerated");
  for (const bad of ["abc", "999", "0", "-5", "1.5e3", "1500.5", "", "  ", "NaN", "Infinity", "99999999999999999999"]) {
    assertEqual(silenceMs({ KEEL_SILENCE_MS: bad }), DEFAULT_SILENCE_MS, "rejects " + JSON.stringify(bad));
  }
  assertEqual(silenceMs({}), DEFAULT_SILENCE_MS, "unset");
  assertEqual(silenceMs(), silenceMs(process.env), "defaults to process.env");
});

test("stdin input reaches the child and onOutput sees the chunks", async () => {
  const seen = [];
  const result = await watch(
    "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(s.toUpperCase()))",
    { input: "hello watch", onOutput: (kind, chunk) => seen.push([kind, Buffer.from(chunk).toString("utf8")]) },
  );
  assertEqual(result.stdout, "HELLO WATCH", "stdout");
  assertEqual(result.code, 0, "exit code");
  assert(seen.length >= 1 && seen.every(([kind]) => kind === "stdout") && seen.map((item) => item[1]).join("") === "HELLO WATCH",
    "onOutput saw the output");
});

test("a command that cannot start yields spawnError instead of a throw", async () => {
  const result = await runWatched("keel-no-such-command-" + process.pid, [], { env: SHORT_ENV });
  assert(typeof result.spawnError === "string" && result.spawnError.length > 0, "spawnError set");
  assertEqual(result.hung, false, "not a hang");
  assertEqual(result.code, null, "no exit code");
});

test("a hung child with outputFile keeps what it wrote before the silence", async () => {
  const dir = scratch();
  const file = join(dir, "partial.txt");
  const result = await watch("process.stdout.write('before the hang\\n');setTimeout(()=>{},60000)", { outputFile: file });
  assertEqual(result.hung, true, "hung");
  assertEqual(readFileSync(file, "utf8"), "before the hang\n", "partial output survives");
  assertEqual(result.stdoutBytes, 16, "stdoutBytes");
});

test("the module carries no total duration, timeout option or buffer cap", () => {
  const source = readFileSync(MODULE, "utf8").replace(/^\s*\/\/.*$/gm, "");
  assert(!/maxBuffer/.test(source), "maxBuffer present");
  assert(!/options\.timeout\b|timeoutMs|\btimeout\s*:/.test(source.replace(/PROBE_TIMEOUT_MS/g, "")), "timeout option present");
  assert(!/node:child_process"[^;]*\b(execFile|exec|spawnSync)\b/.test(source), "unexpected blocking child_process use");
});

test("treeMembers follows ppid, orphans of a dead root, process groups, and rejects reused PIDs", () => {
  const rows = [
    { pid: 10, ppid: 1, pgid: 10, cpu: 0, created: 1000 },
    { pid: 11, ppid: 10, pgid: 10, cpu: 0, created: 1100 },
    { pid: 12, ppid: 11, pgid: 10, cpu: 0, created: 1200 },
    { pid: 13, ppid: 1, pgid: 10, cpu: 0, created: 1300 },
    { pid: 99, ppid: 1, pgid: 99, cpu: 0, created: 1000 },
  ];
  const alivePids = (list) => list.map((row) => row.pid).sort((a, b) => a - b);
  assertEqual(alivePids(treeMembers(rows, 10)).join(","), "10,11,12,13", "live root: descendants plus its group");
  const orphaned = rows.filter((row) => row.pid !== 10);
  assertEqual(alivePids(treeMembers(orphaned, 10)).join(","), "11,12,13", "dead root: orphans still found");
  const windows = [
    { pid: 21, ppid: 20, pgid: null, cpu: 0, created: 10_000 },
    { pid: 22, ppid: 21, pgid: null, cpu: 0, created: 10_100 },
    { pid: 23, ppid: 20, pgid: null, cpu: 0, created: 1_000 },
  ];
  assertEqual(alivePids(treeMembers(windows, 20, 10_000)).join(","), "21,22", "a process older than the watched child is a reused PID, not a member");
});

// ---- review fixes ----------------------------------------------------------

const row = (pid, ppid, created, extra = {}) => ({ pid, ppid, pgid: null, cpu: 0, created, ...extra });
const pidList = (list) => list.map((item) => item.pid).sort((a, b) => a - b).join(",");

test("treeActivity: a change of tree membership is activity even below the CPU threshold", () => {
  const before = new Map([[100, 0.1], [200, 0.05]]);
  const joined = treeActivity(before, new Map([[100, 0.1], [200, 0.05], [300, 0.02]]), 1);
  assertEqual(joined.changed, true, "a new PID joined");
  assertEqual(joined.active, true, "joined PID counts as activity");
  const replaced = treeActivity(before, new Map([[100, 0.1], [300, 0.2]]), 1);
  assertEqual(replaced.changed, true, "a PID left and another joined");
  assertEqual(replaced.active, true, "chain of short-lived children is active");
  assert(replaced.growth < 1, "the growth alone stays below the threshold: " + replaced.growth);
  const left = treeActivity(before, new Map([[100, 0.1]]), 1);
  assertEqual(left.active, true, "a PID that left counts as activity");
  const still = treeActivity(before, new Map([[100, 0.1], [200, 0.05]]), 1);
  assertEqual(still.active, false, "same members, no growth: idle");
  assertEqual(still.changed, false, "no change");
  const busy = treeActivity(before, new Map([[100, 1.3], [200, 0.05]]), 1);
  assertEqual(busy.active, true, "growth above the threshold");
  assertEqual(busy.changed, false, "growth without a membership change");
});

test("a silent child with a chain of short-lived computing grandchildren is not aborted (real measurement)", async () => {
  const code =
    "const {spawnSync}=require('child_process');const end=Date.now()+5000;" +
    "while(Date.now()<end){spawnSync(process.execPath,['-e','const e=Date.now()+60;while(Date.now()<e){}'])}";
  const result = await watch(code);
  assertEqual(result.hung, false, "a busy chain of short processes is not a hang: " + result.hungReason);
  assertEqual(result.code, 0, "exit code");
  assert(result.durationMs >= 4500, "ran to the end: " + result.durationMs);
});

test("treeMembers accepts the root only with the identity of the spawned child", () => {
  // Windows style (creation times). Child spawned at 10 000; the root PID 20 was reused later.
  const reusedRoot = [
    row(20, 1, 500_000),
    row(21, 20, 500_100),       // child of the stranger
    row(22, 20, 10_200),        // orphan of our dead root, older than the stranger
    row(23, 20, 1_000),         // far older than the spawn: a stale PID, not ours
  ];
  assertEqual(pidList(treeMembers(reusedRoot, 20, 10_000)), "22", "reused root PID: the stranger and its children are not members");
  assertEqual(pidList(treeMembers(reusedRoot, 20, 10_000, { rootExited: true })), "22", "same after the exit");
  const ownRoot = [row(20, 1, 10_100), row(21, 20, 10_200), row(22, 20, 10_000)];
  assertEqual(pidList(treeMembers(ownRoot, 20, 10_000)), "20,21", "root created within the window of the spawn is accepted");
  assertEqual(pidList(treeMembers(ownRoot, 20, 10_000, { rootExited: true })), "22",
    "after the exit a row with this PID is never trusted as the root; only rows older than it can be orphans");
  const lateRoot = [row(20, 1, 10_000 + 60_000)];
  assertEqual(pidList(treeMembers(lateRoot, 20, 10_000)), "", "root created long after the spawn is rejected");
  // POSIX style (process groups, no creation times). The child exited and PID 30 is a stranger's now.
  const posixReused = [
    { pid: 30, ppid: 1, pgid: 30, cpu: 0, created: 0 },
    { pid: 31, ppid: 30, pgid: 30, cpu: 0, created: 0 },
  ];
  assertEqual(pidList(treeMembers(posixReused, 30, 1_000, { rootExited: true })), "", "POSIX: no members from a reused root PID or its group");
  assertEqual(pidList(treeMembers(posixReused, 30, 1_000)), "30,31", "POSIX: a live child keeps its tree and group");
  const posixGroup = [{ pid: 31, ppid: 1, pgid: 30, cpu: 0, created: 0 }];
  assertEqual(pidList(treeMembers(posixGroup, 30, 1_000, { rootExited: true })), "31", "POSIX: the group of an exited leader is still found");
});

test("treeMembers assigns orphans of an intermediate parent seen earlier, with identity", () => {
  const seen = new Map([[80_001, 10_060]]);
  const lastSeenAt = new Map([[80_001, 10_500]]);
  const orphan = row(80_002, 80_001, 10_070);
  assertEqual(pidList(treeMembers([orphan], 5, 10_000, { seen, lastSeenAt })), "80002", "the parent was a member and is gone");
  assertEqual(pidList(treeMembers([orphan], 5, 10_000)), "", "without the earlier sighting the orphan cannot be assigned");
  assertEqual(pidList(treeMembers([orphan], 5, 10_000, { seen })), "",
    "a seen parent without a last-sighting time cannot tell its orphans from a stranger's children");
  assertEqual(pidList(treeMembers([row(80_003, 80_001, 10_050)], 5, 10_000, { seen, lastSeenAt })), "", "a process older than the seen parent is not its child");
  const reusedParent = [row(80_001, 1, 20_000), row(80_004, 80_001, 20_100)];
  assertEqual(pidList(treeMembers(reusedParent, 5, 10_000, { seen, lastSeenAt })), "", "the parent PID was reused by a stranger: its children are not members");
});

test("a reused root PID after the exit: strangers are not measured and not killed", async () => {
  const dir = scratch();
  const pidFile = join(dir, "grandchild.pid");
  const t0 = Date.now();
  const grandchild = "require('fs').writeFileSync(" + JSON.stringify(pidFile) + ",String(process.pid));setTimeout(()=>{},60000)";
  const parent =
    "process.stdout.write('P:'+process.pid+'\\n');" +
    "const c=require('child_process').spawn(process.execPath,['-e'," + JSON.stringify(grandchild) + "]," +
    "{stdio:['ignore','inherit','inherit'],detached:process.platform==='win32'});c.unref();" +
    "const f=require('fs'),p=" + JSON.stringify(pidFile) + ";" +
    "const w=setInterval(()=>{if(f.existsSync(p)&&f.readFileSync(p,'utf8')){clearInterval(w);process.exit(0)}},50)";
  let childPid = 0;
  const killed = [];
  const result = await runWatched(NODE, ["-e", parent], {
    env: SHORT_ENV,
    platform: "win32",
    onOutput: (kind, chunk) => {
      const match = /P:(\d+)/.exec(Buffer.from(chunk).toString("utf8"));
      if (match) childPid = Number(match[1]);
    },
    listProcesses: async () => {
      const gc = Number(readFileSync(pidFile, "utf8"));
      return [
        row(childPid, 1, t0 + 600_000),             // the PID now belongs to a stranger
        row(70_001, childPid, t0 + 600_100),        // a child of that stranger
        row(gc, childPid, t0 + 200),                // the real grandchild holding the pipes
        row(70_002, childPid, t0 - 3_600_000),      // a stale PID from long before the spawn
      ].filter((item) => !killed.includes(item.pid)); // what was ended is gone from the next listing
    },
    terminateTree: (handle) => {
      killed.push(handle.pid);
      if (handle.pid !== childPid) { try { process.kill(handle.pid, "SIGKILL"); } catch { /* gone */ } }
      return { ok: true, fallback: false, diagnostic: null };
    },
  });
  const gc = Number(readFileSync(pidFile, "utf8"));
  assertEqual(result.hung, true, "the pipe holder is a hang");
  assertEqual(killed.join(","), String(gc), "only the real grandchild was addressed, never the stranger or its children");
  assert(await waitDead(gc), "the grandchild is dead");
});

test("a live child's orphans whose parent ended are ended too, with identity (injected listing)", async () => {
  const t0 = Date.now();
  let childPid = 0;
  let listCalls = 0;
  const handled = [];
  const listProcesses = async () => {
    listCalls += 1;
    const me = row(childPid, 1, t0 + 20, { cpu: 1 });
    const parent = row(80_001, childPid, t0 + 60, { cpu: 1 });
    const orphan = row(80_002, 80_001, t0 + 70, { cpu: 1 });
    const stranger = row(80_003, 99_999, t0 + 80, { cpu: 1 });   // orphan of someone else
    const old = row(80_004, 99_998, t0 - 3_600_000, { cpu: 1 });
    // Two measurements see the whole tree; at the kill the intermediate is gone;
    // the control listing after the kill finds nothing of ours left.
    if (listCalls <= 2) return [me, parent, orphan, stranger, old];
    return listCalls === 3 ? [orphan, stranger, old] : [stranger, old];
  };
  const result = await runWatched(NODE, ["-e", "process.stdout.write(String(process.pid));setTimeout(()=>{},60000)"], {
    env: SHORT_ENV,
    platform: "win32",
    listProcesses,
    onOutput: (kind, chunk) => { childPid = Number(Buffer.from(chunk).toString("utf8")) || childPid; },
    terminateTree: (handle) => {
      handled.push(handle.pid);
      return handle.pid === childPid ? terminateProcessTree(handle) : { ok: true, fallback: false, diagnostic: null };
    },
  });
  assertEqual(result.hung, true, "hung");
  assertEqual(handled.join(","), childPid + ",80002", "the live child, then only the orphan of the known intermediate");
  assertEqual(listCalls, 4, "two measurements, the kill listing and one control listing");
  assert(!/termination not confirmed/.test(result.hungReason), "everything was confirmed: " + result.hungReason);
});

test("pipes closed by force after the grace period are named in hungReason", async () => {
  let childPid = 0;
  const result = await watch("process.stdout.write(String(process.pid));setTimeout(()=>{},60000)", {
    onOutput: (kind, chunk) => { childPid = Number(Buffer.from(chunk).toString("utf8")) || childPid; },
    // A termination that reports success but ends nothing: the child keeps the pipes.
    terminateTree: () => ({ ok: true, fallback: false, diagnostic: null }),
  });
  try {
    assertEqual(result.hung, true, "hung");
    assert(/termination not confirmed: stdout\/stderr still open 3 s after the kill and closed by force/.test(result.hungReason),
      "reason names the forced close: " + result.hungReason);
    assert(result.durationMs < 30000, "settled after the grace period: " + result.durationMs);
  } finally {
    try { process.kill(childPid, "SIGKILL"); } catch { /* gone */ }
    try { process.kill(-childPid, "SIGKILL"); } catch { /* not a group or gone */ }
  }
});

test("an orphan whose parent ended before any listing is reported, not guessed (live child)", async () => {
  const dir = scratch();
  const pidFile = join(dir, "orphan.pid");
  const orphan = "require('fs').writeFileSync(" + JSON.stringify(pidFile) + ",String(process.pid));setTimeout(()=>{},60000)";
  const middle =
    "const c=require('child_process').spawn(process.execPath,['-e'," + JSON.stringify(orphan) + "]," +
    "{stdio:['ignore','inherit','inherit'],detached:process.platform==='win32'});c.unref();" +
    "const f=require('fs'),p=" + JSON.stringify(pidFile) + ";" +
    "const w=setInterval(()=>{if(f.existsSync(p)&&f.readFileSync(p,'utf8')){clearInterval(w);process.exit(0)}},50)";
  const top =
    "require('child_process').spawn(process.execPath,['-e'," + JSON.stringify(middle) + "],{stdio:['ignore','inherit','inherit']});" +
    "setTimeout(()=>{},60000)";
  const result = await watch(top);
  let orphanPid = 0;
  try {
    orphanPid = Number(readFileSync(pidFile, "utf8"));
    assertEqual(result.hung, true, "hung");
    if (process.platform === "win32") {
      // The parent of the orphan ended before the first listing: no identity to
      // assign it to the tree. The pipe holder must show up in the reason instead.
      if (alive(orphanPid)) {
        assert(/termination not confirmed/.test(result.hungReason), "a surviving pipe holder is reported: " + result.hungReason);
      }
    } else {
      assert(await waitDead(orphanPid), "POSIX: the process group kill reaches the orphan");
      assert(!/termination not confirmed/.test(result.hungReason), "confirmed: " + result.hungReason);
    }
  } finally {
    if (orphanPid) { try { process.kill(orphanPid, "SIGKILL"); } catch { /* gone */ } }
  }
});

test("a child that ends during a measurement stops the sample timer and starts no second measurement", async () => {
  const dir = scratch();
  const script = join(dir, "run.mjs");
  writeFileSync(script, [
    "const { runWatched } = await import(" + JSON.stringify(pathToFileURL(MODULE).href) + ");",
    "let calls = 0;",
    "const result = await runWatched(process.execPath, ['-e', 'setTimeout(()=>{},1800)'], {",
    "  silenceMs: 1000, sampleMs: 15000, cpuProbe: async () => { calls += 1; return 0; },",
    "});",
    "console.log(JSON.stringify({ calls, hung: result.hung, code: result.code }));",
  ].join("\n"));
  const started = Date.now();
  const outcome = await new Promise((done) => {
    const out = [];
    const proc = spawn(NODE, [script], { stdio: ["ignore", "pipe", "inherit"], windowsHide: true });
    proc.stdout.on("data", (chunk) => out.push(chunk));
    proc.once("close", (code) => done({ code, text: Buffer.concat(out).toString("utf8") }));
  });
  const elapsed = Date.now() - started;
  assertEqual(outcome.code, 0, "the helper script ended cleanly");
  const parsed = JSON.parse(outcome.text.trim());
  assertEqual(parsed.calls, 1, "no second measurement after the run ended");
  assertEqual(parsed.hung, false, "not hung");
  assertEqual(parsed.code, 0, "child exit code");
  assert(elapsed < 8000, "the 15 s sample timer did not keep the process alive: " + elapsed + " ms");
});

test("a failing output file hands the paused pipe back: the child is not stuck", async () => {
  const dir = scratch();
  const stalling = new Writable({ highWaterMark: 16, write() { /* never completes: write() returns false */ } });
  const sink = new Writable({ write(chunk, encoding, done) { done(); } });
  let opened = 0;
  setTimeout(() => stalling.destroy(new Error("disk full")), 600);
  const code = "const b=Buffer.alloc(1024,66);for(let i=0;i<3072;i++)process.stdout.write(b)";
  const result = await watch(code, {
    outputFile: join(dir, "out.txt"),
    createFileStream: () => (opened++ === 0 ? stalling : sink),
  });
  assertEqual(result.hung, false, "the child was not stuck behind a paused pipe: " + result.hungReason);
  assertEqual(result.code, 0, "exit code");
  assertEqual(result.stdoutBytes, 3 * 1024 * 1024, "all output was still counted");
  assert(/output file error: disk full/.test(String(result.spawnError)), "the file error is reported: " + result.spawnError);
});

test("decodeOutput replaces text beyond the string limit by a notice with the byte count", () => {
  const chunks = [Buffer.from("hello "), Buffer.from("world, and more")];
  assertEqual(decodeOutput(chunks, 21, "stdout"), "hello world, and more", "normal output is decoded");
  const notice = decodeOutput(chunks, 21, "stdout", 10);
  assert(/stdout is 21 bytes/.test(notice) && /outputFile/.test(notice), "notice names kind, bytes and outputFile: " + notice);
  assert(!notice.includes("hello"), "no partial text");
});

test("output beyond the real V8 string limit does not crash the result", () => {
  // About 0.55 GiB, decoded in place. The free memory of the machine is no guard: it swings with the load of the day and
  // would make the skip count of the suite depend on it; only a buffer the system cannot give is a reason to skip.
  let big;
  try { big = Buffer.alloc(bufferConstants.MAX_STRING_LENGTH + 16, 65); } catch (error) {
    if (error instanceof RangeError || error?.code === "ERR_MEMORY_ALLOCATION_FAILED") skipTest("cannot allocate about 0.55 GiB: " + error.message);
    throw error;
  }
  const text = decodeOutput([big], big.length, "stdout");
  assert(text.startsWith("[silence-watch] stdout is " + big.length + " bytes"), "notice instead of a throw: " + text.slice(0, 80));
});

test("the module header documents the POSIX session and the Windows limits", () => {
  const head = readFileSync(MODULE, "utf8").split(/\r?\n/).filter((line) => line.startsWith("//")).join("\n");
  assert(/detached/.test(head) && /session/.test(head) && /controlling terminal/.test(head), "POSIX detached/session consequences");
  assert(/Windows limits/.test(head) && /ParentProcessId/.test(head) && /termination not confirmed/.test(head), "Windows limits");
  assert(/outputFile/.test(head) && /string limit/.test(head), "large output points to outputFile");
  assert(/macOS/.test(head) && /counter/.test(head) && /cutime/.test(head), "activity counters and the macOS limit are documented");
});

// ---- second review round ---------------------------------------------------

const holderParent = (pidFile) =>
  "process.stdout.write('P:'+process.pid+'\\n');" +
  "const c=require('child_process').spawn(process.execPath,['-e'," +
  JSON.stringify("require('fs').writeFileSync(" + JSON.stringify(pidFile) + ",String(process.pid));setTimeout(()=>{},60000)") + "]," +
  "{stdio:['ignore','inherit','inherit'],detached:process.platform==='win32'});c.unref();" +
  "const f=require('fs'),p=" + JSON.stringify(pidFile) + ";" +
  "const w=setInterval(()=>{if(f.existsSync(p)&&f.readFileSync(p,'utf8')){clearInterval(w);process.exit(0)}},50)";

test("treeMembers: a dead root PID that a stranger took, used for a child and left is not trusted (exitedAt)", () => {
  // The child was spawned at 10 000 and exited at 12 000. Its PID 20 was taken at 50 000 by a stranger,
  // which started 21 and ended itself: 21 now shows ppid 20 and no row 20 exists.
  const gone = [row(21, 20, 50_100), row(22, 20, 10_300), row(23, 20, 12_900), row(24, 20, 13_100)];
  assertEqual(pidList(treeMembers(gone, 20, 10_000, { rootExited: true })), "21,22,23,24",
    "without the exit time the stranger child cannot be told apart");
  assertEqual(pidList(treeMembers(gone, 20, 10_000, { rootExited: true, exitedAt: 12_000 })), "22,23",
    "created after the exit (plus 1 s tolerance): not a member; before it: a member");
  // The stranger is still alive and holds the PID: only rows older than it were candidates before.
  const held = [row(20, 1, 50_000), row(21, 20, 50_100), row(25, 20, 30_000), row(26, 20, 11_000)];
  assertEqual(pidList(treeMembers(held, 20, 10_000, { rootExited: true })), "25,26", "older than the holder");
  assertEqual(pidList(treeMembers(held, 20, 10_000, { rootExited: true, exitedAt: 12_000 })), "26",
    "older than the holder but born after the exit: not ours either");
  // Rows without creation time (POSIX listing) cannot be judged by time; the group rules apply.
  const posix = [{ pid: 31, ppid: 30, pgid: 31, cpu: 0, created: 0 }];
  assertEqual(pidList(treeMembers(posix, 30, 10_000, { rootExited: true, exitedAt: 12_000 })), "31",
    "no creation time, no time filter");
});

test("treeMembers: orphans of a seen member are taken only up to its last sighting plus 100 ms (lastSeenAt)", () => {
  const seen = new Map([[80_001, 10_060]]);
  const rows = [
    row(80_002, 80_001, 10_070),   // born while the parent was seen
    row(80_003, 80_001, 20_000),   // at the last sighting
    row(80_004, 80_001, 20_100),   // boundary: still inside the clock slack
    row(80_005, 80_001, 20_101),   // 1 ms later: could be a stranger's child
    row(80_006, 80_001, 21_100),   // the old window (first missing listing plus 1 s) would have taken these
    row(80_007, 80_001, 90_000),
  ];
  const lastSeenAt = new Map([[80_001, 20_000]]);
  assertEqual(pidList(treeMembers(rows, 5, 10_000, { seen, lastSeenAt })), "80002,80003,80004",
    "children born after the last sighting (plus 100 ms) are not assigned to the tree");
  assertEqual(pidList(treeMembers(rows, 5, 10_000, { seen })), "", "without a sighting time nothing is assigned");
  assertEqual(pidList(treeMembers(rows, 5, 10_000, { seen, lastSeenAt: new Map([[99, 1]]) })), "",
    "a sighting time of another PID gives this parent no window");
  assertEqual(pidList(treeMembers(rows, 5, 10_000, { seen, lastSeenAt: new Map([[80_001, 90_000]]) })), "80002,80003,80004,80005,80006,80007",
    "a later sighting widens the window to exactly that time");
});

test("treeMembers: orphans of a dead root are never older than OUR root (no 5 s tolerance for children)", () => {
  // Spawned at 10 000. PID 20 belonged to somebody else before; an orphan of that
  // previous holder was created 2 s before our start. Our root died.
  const previousHolderOrphan = row(70_003, 20, 8_000);
  const ours = row(70_004, 20, 10_200);
  const free = [previousHolderOrphan, ours];
  assertEqual(pidList(treeMembers(free, 20, 10_000, { rootExited: true, exitedAt: 12_000 })), "70004",
    "PID free: the orphan of the previous holder is not a member, ours is");
  assertEqual(pidList(treeMembers(free, 20, 10_000)), "70004", "the same while our root has not been reported as exited");
  const held = [row(20, 1, 600_000), previousHolderOrphan, ours];
  assertEqual(pidList(treeMembers(held, 20, 10_000, { rootExited: true, exitedAt: 12_000 })), "70004",
    "PID held by a stranger: older than the holder is not enough, it must not be older than our root");
  // The boundary is spawn minus 100 ms (clock granularity), not minus 5 s.
  const edge = [row(70_005, 20, 9_900), row(70_006, 20, 9_899)];
  assertEqual(pidList(treeMembers(edge, 20, 10_000, { rootExited: true })), "70005", "spawn minus 100 ms is the limit");
  // An earlier listing saw our root: its creation time is the lower bound.
  const seen = new Map([[20, 10_050]]);
  const afterRoot = [row(70_007, 20, 10_010), row(70_008, 20, 10_050), row(70_009, 20, 10_060)];
  assertEqual(pidList(treeMembers(afterRoot, 20, 10_000, { rootExited: true, exitedAt: 12_000, seen })), "70008,70009",
    "a row older than our own root cannot be its child, although it is younger than the spawn");
  assertEqual(pidList(treeMembers(afterRoot, 20, 10_000, { rootExited: true, exitedAt: 12_000 })), "70007,70008,70009",
    "without the sighting only the spawn time is known");
  // The 5 s tolerance still decides whether a LIVE root row is ours.
  const liveOwn = [row(20, 1, 13_000), row(21, 20, 13_100)];
  assertEqual(pidList(treeMembers(liveOwn, 20, 10_000)), "20,21", "live root created 3 s after the spawn is accepted");
  // Accepted by that tolerance (8 000 is within 5 s of 10 000), the root is ours; its children are not
  // measured with it: 9 000 is younger than the root but older than the spawn minus 100 ms.
  const liveEarlyRoot = [row(20, 1, 8_000), row(21, 20, 10_300), row(22, 20, 9_000)];
  assertEqual(pidList(treeMembers(liveEarlyRoot, 20, 10_000)), "20,21", "children get no 5 s tolerance below a live root either");
});

test("noteLastSeen records the start of the last listing that still held a seen member, by identity", () => {
  const seen = new Map([[1, 100], [2, 200], [3, 300]]);
  const lastSeenAt = new Map();
  noteLastSeen(seen, lastSeenAt, [row(1, 0, 100), row(2, 0, 999)], 5_000);
  assertEqual([...lastSeenAt.keys()].join(","), "1", "a different creation time (reused PID) and an absent PID are not sightings");
  assertEqual(lastSeenAt.get(1), 5_000, "present with the same identity");
  noteLastSeen(seen, lastSeenAt, [row(1, 0, 100), row(2, 0, 200)], 9_000);
  assertEqual(lastSeenAt.get(1), 9_000, "every listing that still holds it moves the time forward");
  assertEqual(lastSeenAt.get(2), 9_000, "first sighting of the real holder");
  noteLastSeen(seen, lastSeenAt, [row(2, 0, 200)], 7_000);
  assertEqual(lastSeenAt.get(2), 9_000, "an older listing never moves the time back");
  noteLastSeen(seen, lastSeenAt, [row(1, 0, 555)], 12_000);
  assertEqual(lastSeenAt.get(1), 9_000, "a stranger on the PID is no sighting: the time stays at the last real one");
  assertEqual(lastSeenAt.has(3), false, "a member that was never held by a listing has no sighting time");
});

test("a reused root PID whose stranger already ended: its child is neither measured nor killed", async () => {
  const dir = scratch();
  const pidFile = join(dir, "grandchild.pid");
  const t0 = Date.now();
  let childPid = 0;
  const killed = [];
  const result = await runWatched(NODE, ["-e", holderParent(pidFile)], {
    env: SHORT_ENV,
    platform: "win32",
    onOutput: (kind, chunk) => {
      const match = /P:(\d+)/.exec(Buffer.from(chunk).toString("utf8"));
      if (match) childPid = Number(match[1]);
    },
    // No row for the root PID: the stranger that took it has ended again, but its child lives on.
    listProcesses: async () => {
      const gc = Number(readFileSync(pidFile, "utf8"));
      return [
        row(70_001, childPid, t0 + 600_100),
        row(gc, childPid, t0 + 200),
      ].filter((item) => !killed.includes(item.pid));
    },
    terminateTree: (handle) => {
      killed.push(handle.pid);
      if (handle.pid !== childPid) { try { process.kill(handle.pid, "SIGKILL"); } catch { /* gone */ } }
      return { ok: true, fallback: false, diagnostic: null };
    },
  });
  const gc = Number(readFileSync(pidFile, "utf8"));
  assertEqual(result.hung, true, "the pipe holder is a hang");
  assertEqual(killed.join(","), String(gc), "only the real grandchild was addressed, never the stranger child");
  assert(await waitDead(gc), "the grandchild is dead");
});

test("a seen parent's PID reused by a stranger whose child outlived it: not killed (injected listing)", async () => {
  const t0 = Date.now();
  let childPid = 0;
  let listCalls = 0;
  const handled = [];
  const listProcesses = async () => {
    listCalls += 1;
    const me = row(childPid, 1, t0 + 20, { cpu: 1 });
    const parent = row(80_001, childPid, t0 + 60, { cpu: 1 });
    const orphan = row(80_002, 80_001, t0 + 70, { cpu: 1 });
    const strangerChild = row(80_005, 80_001, t0 + 600_000, { cpu: 1 }); // a stranger took 80001, started this, died
    if (listCalls <= 2) return [me, parent, orphan];
    return listCalls === 3 ? [orphan, strangerChild] : [];
  };
  const result = await runWatched(NODE, ["-e", "process.stdout.write(String(process.pid));setTimeout(()=>{},60000)"], {
    env: SHORT_ENV,
    platform: "win32",
    listProcesses,
    onOutput: (kind, chunk) => { childPid = Number(Buffer.from(chunk).toString("utf8")) || childPid; },
    terminateTree: (handle) => {
      handled.push(handle.pid);
      return handle.pid === childPid ? terminateProcessTree(handle) : { ok: true, fallback: false, diagnostic: null };
    },
  });
  assertEqual(result.hung, true, "hung");
  assertEqual(handled.join(","), childPid + ",80002", "the orphan of the seen parent is ended, the stranger child is not");
});

// ---- third review round: no tolerance for children, last sighting as the limit ----

// The parent of an orphan left before our start: its PID is the PID of our (dead)
// root, either free or held by a stranger now.
async function previousHolderOrphanRun({ holderAlive }) {
  const dir = scratch();
  const pidFile = join(dir, "grandchild.pid");
  const t0 = Date.now();
  let childPid = 0;
  let calls = 0;
  const killed = [];
  const grandchildPid = () => { try { return Number(readFileSync(pidFile, "utf8")) || 0; } catch { return 0; } };
  const result = await runWatched(NODE, ["-e", holderParent(pidFile)], {
    env: SHORT_ENV,
    platform: "win32",
    onOutput: (kind, chunk) => {
      const match = /P:(\d+)/.exec(Buffer.from(chunk).toString("utf8"));
      if (match) childPid = Number(match[1]);
    },
    listProcesses: async () => {
      calls += 1;
      const rows = [
        row(grandchildPid(), childPid, t0 + 200),                       // the real grandchild holding the pipes
        // Left by the PID's previous holder 2 s before our start (inside the old 5 s tolerance). Its CPU
        // grows with every listing: if it were measured, the tree would count as active for good.
        row(70_003, childPid, t0 - 2_000, { cpu: calls * 10 }),
      ];
      if (holderAlive) rows.push(row(childPid, 1, t0 + 600_000));        // a stranger holds the PID now
      return rows.filter((item) => !killed.includes(item.pid));
    },
    terminateTree: (handle) => {
      killed.push(handle.pid);
      // Only the real grandchild is ever signalled, so a regression cannot hit a bystander's PID.
      if (handle.pid === grandchildPid()) { try { process.kill(handle.pid, "SIGKILL"); } catch { /* gone */ } }
      return { ok: true, fallback: false, diagnostic: null };
    },
  });
  return { result, killed, grandchild: grandchildPid() };
}

test("an orphan of the PID's previous holder, created 2 s before our start, PID free: not measured, not ended", async () => {
  const { result, killed, grandchild } = await previousHolderOrphanRun({ holderAlive: false });
  assertEqual(result.hung, true, "the pipe holder is a hang, the foreign orphan did not keep the tree active: " + result.hungReason);
  assert(result.durationMs < 20000, "ended after one silence period, not kept alive by a foreign CPU counter: " + result.durationMs);
  assertEqual(killed.join(","), String(grandchild), "only the real grandchild was addressed, never the orphan of the previous holder");
  assert(await waitDead(grandchild), "the grandchild is dead");
});

test("an orphan of the PID's previous holder, created 2 s before our start, PID held by a stranger: not measured, not ended", async () => {
  const { result, killed, grandchild } = await previousHolderOrphanRun({ holderAlive: true });
  assertEqual(result.hung, true, "the pipe holder is a hang, the foreign orphan did not keep the tree active: " + result.hungReason);
  assert(result.durationMs < 20000, "ended after one silence period, not kept alive by a foreign CPU counter: " + result.durationMs);
  assertEqual(killed.join(","), String(grandchild), "only the real grandchild was addressed, neither the holder nor the old orphan");
  assert(await waitDead(grandchild), "the grandchild is dead");
});

// A seen parent dies after the first listing; a stranger takes its PID and starts a
// child 300 ms after that listing, before the first listing that lacks the parent.
async function strangerTookSeenParentRun({ strangerAlive }) {
  const t0 = Date.now();
  let childPid = 0;
  let calls = 0;
  let firstListingAt = 0;
  const handled = [];
  const listProcesses = async () => {
    calls += 1;
    const me = row(childPid, 1, t0 + 20, { cpu: 1 });
    const parent = row(80_001, childPid, t0 + 60, { cpu: 1 });
    const orphan = row(80_002, 80_001, t0 + 70, { cpu: 1 });
    let rows;
    if (calls === 1) {
      firstListingAt = Date.now();
      rows = [me, parent, orphan];
    } else {
      // Its CPU grows with every listing: if it were measured, the tree would count as active for good.
      rows = [me, orphan, row(80_005, 80_001, firstListingAt + 300, { cpu: calls * 10 })];
      if (strangerAlive) rows.push(row(80_001, 1, firstListingAt + 250, { cpu: 1 }));
    }
    return rows.filter((item) => !handled.includes(item.pid));
  };
  const result = await runWatched(NODE, ["-e", "process.stdout.write(String(process.pid));setTimeout(()=>{},60000)"], {
    env: SHORT_ENV,
    platform: "win32",
    listProcesses,
    onOutput: (kind, chunk) => { childPid = Number(Buffer.from(chunk).toString("utf8")) || childPid; },
    terminateTree: (handle) => {
      handled.push(handle.pid);
      return handle.pid === childPid ? terminateProcessTree(handle) : { ok: true, fallback: false, diagnostic: null };
    },
  });
  return { result, handled, childPid };
}

test("a seen parent dies, a stranger takes its PID and starts a child before the first listing without it: not measured, not ended", async () => {
  const { result, handled, childPid } = await strangerTookSeenParentRun({ strangerAlive: false });
  assertEqual(result.hung, true, "the stranger's child did not keep the tree active: " + result.hungReason);
  assert(result.durationMs < 20000, "ended after the second silence period: " + result.durationMs);
  assertEqual(handled.join(","), childPid + ",80002", "the orphan of the seen parent is ended, the stranger's child never");
});

test("the same while the stranger still holds the parent's PID: not measured, not ended", async () => {
  const { result, handled, childPid } = await strangerTookSeenParentRun({ strangerAlive: true });
  assertEqual(result.hung, true, "the stranger and its child did not keep the tree active: " + result.hungReason);
  assertEqual(handled.join(","), childPid + ",80002", "the orphan of the seen parent is ended, neither the stranger nor its child");
});

test("a real orphan born before its parent's last sighting is ended (injected listing)", async () => {
  const t0 = Date.now();
  let childPid = 0;
  let calls = 0;
  let secondListingAt = 0;
  const handled = [];
  const listProcesses = async () => {
    calls += 1;
    const me = row(childPid, 1, t0 + 20, { cpu: 1 });
    const parent = row(80_001, childPid, t0 + 60, { cpu: 1 });
    let rows;
    if (calls === 1) {
      rows = [me, parent];
    } else if (calls === 2) {
      secondListingAt = Date.now();
      rows = [me, parent, row(80_002, 80_001, secondListingAt - 200, { cpu: 1 })];   // born just before this sighting
    } else {
      rows = [me, row(80_002, 80_001, secondListingAt - 200, { cpu: 1 })];           // the parent is gone
    }
    return rows.filter((item) => !handled.includes(item.pid));
  };
  const result = await runWatched(NODE, ["-e", "process.stdout.write(String(process.pid));setTimeout(()=>{},60000)"], {
    env: SHORT_ENV,
    platform: "win32",
    listProcesses,
    onOutput: (kind, chunk) => { childPid = Number(Buffer.from(chunk).toString("utf8")) || childPid; },
    terminateTree: (handle) => {
      handled.push(handle.pid);
      return handle.pid === childPid ? terminateProcessTree(handle) : { ok: true, fallback: false, diagnostic: null };
    },
  });
  assertEqual(result.hung, true, "hung");
  assertEqual(handled.join(","), childPid + ",80002", "the orphan that existed at the last sighting of its parent is ended");
  assert(!/termination not confirmed/.test(result.hungReason), "everything was confirmed: " + result.hungReason);
});

test("treeActivity: growth of an activity counter is activity, a standing counter is not", () => {
  const sample = (cpu, counters) => new TreeSample(cpu, counters && new Map(counters));
  const before = sample([[100, 0.1], [200, 0.05]], [[100, 500], [200, 60]]);
  const grew = treeActivity(before, sample([[100, 0.1], [200, 0.05]], [[100, 620], [200, 60]]), 1);
  assertEqual(grew.active, true, "a parent that started and awaited children raised its counter");
  assertEqual(grew.counterGrowth, 120, "growth amount");
  assertEqual(grew.changed, false, "no membership change");
  assertEqual(grew.growth, 0, "no CPU growth");
  const still = treeActivity(before, sample([[100, 0.1], [200, 0.05]], [[100, 500], [200, 60]]), 1);
  assertEqual(still.active, false, "sleeping tree: nothing grew");
  assertEqual(still.countersMeasured, true, "counters were part of the verdict");
  const shrank = treeActivity(before, sample([[100, 0.1], [200, 0.05]], [[100, 400], [200, 60]]), 1);
  assertEqual(shrank.active, false, "a smaller number is no activity");
  const blind = treeActivity(new TreeSample([[100, 0.1]]), new TreeSample([[100, 0.1]]), 1);
  assertEqual(blind.countersMeasured, false, "macOS style: no counters, CPU and membership only");
  assertEqual(blind.active, false, "and idle stays idle");
  const half = treeActivity(sample([[100, 0.1]], [[100, 5]]), sample([[100, 0.1]], null), 1);
  assertEqual(half.countersMeasured, false, "counters on one side only are not compared");
  const missingBefore = treeActivity(sample([[100, 0.1]], []), sample([[100, 0.1]], [[100, 9]]), 1);
  assertEqual(missingBefore.counterGrowth, 0, "a counter without a base value is no growth");
});

test("parseProcStatChildCpu sums cutime and cstime and survives odd command names", () => {
  const line = "4242 (my (weird) cmd) S 1 4242 4242 0 -1 4194560 100 200 3 0 10 20 30 40 20 0 1 0 5000 1000 100";
  assertEqual(parseProcStatChildCpu(line), 70, "cutime 30 + cstime 40");
  let failed = false;
  try { parseProcStatChildCpu("garbage"); } catch { failed = true; }
  assertEqual(failed, true, "an unreadable line is an error, not zero");
});

test("a silent tree whose activity counter grows is not aborted, a standing one is (injected listing)", async () => {
  const t0 = Date.now();
  const run = (activityOf, endMs) => {
    let childPid = 0;
    let calls = 0;
    return runWatched(NODE, ["-e", "process.stdout.write(String(process.pid));setTimeout(()=>{}," + endMs + ")"], {
      env: SHORT_ENV,
      platform: "win32",
      listProcesses: async () => { calls += 1; return [row(childPid, 1, t0 + 20, { cpu: 1, activity: activityOf(calls) })]; },
      onOutput: (kind, chunk) => { childPid = Number(Buffer.from(chunk).toString("utf8")) || childPid; },
    });
  };
  const growing = await run((call) => 1000 + call * 25, 4500);
  assertEqual(growing.hung, false, "counter growth is activity: " + growing.hungReason);
  assertEqual(growing.code, 0, "exit code");
  const standing = await run(() => 1000, 60000);
  assertEqual(standing.hung, true, "a counter that stands still does not keep a silent tree alive");
  assert(/no I\/O or operation counter grew/.test(standing.hungReason), "reason names the counters: " + standing.hungReason);
  assert(standing.durationMs < 30000, "ended early: " + standing.durationMs);
});

test("a silent tree with periodic short parallel compute processes is not aborted (10 phase-shifted runs)", async () => {
  if (process.platform === "darwin") skipTest("macOS has no activity counters (documented limit)");
  // 4 parallel compute processes of 300 ms, then a pause: between two snapshots a
  // tree can hold no living grandchild at all. Each run shifts the phase.
  const load = (offset, total) =>
    "const {spawn}=require('child_process');const end=Date.now()+" + total + ";" +
    "const one=()=>new Promise(r=>spawn(process.execPath,['-e','const e=Date.now()+300;while(Date.now()<e){}'],{stdio:'ignore'}).on('exit',r));" +
    "(async()=>{await new Promise(r=>setTimeout(r," + offset + "));" +
    "while(Date.now()<end){await Promise.all([one(),one(),one(),one()]);await new Promise(r=>setTimeout(r,500))}})()";
  const offsets = Array.from({ length: 10 }, (_, index) => index * 37 + 11);
  const aborted = [];
  for (let at = 0; at < offsets.length; at += 2) {
    const batch = offsets.slice(at, at + 2);
    const results = await Promise.all(batch.map(async (offset) => {
      let listings = 0;
      const result = await runWatched(NODE, ["-e", load(offset, 6500)], {
        env: SHORT_ENV, silenceMs: 1000, sampleMs: 1000,
        listProcesses: async (platform) => { listings += 1; return listProcesses(platform); },
      });
      return { offset, result, listings };
    }));
    for (const { offset, result, listings } of results) {
      assert(listings >= 2, "the measurement really ran (offset " + offset + "): " + listings + " listings");
      if (result.hung) aborted.push(offset + ": " + result.hungReason);
    }
  }
  assertEqual(aborted.length, 0, "no active run may be aborted: " + aborted.join(" | "));
});

test("a child that ends during a slow first measurement does not keep the caller alive", async () => {
  const dir = scratch();
  const script = join(dir, "slow.mjs");
  writeFileSync(script, [
    "const { runWatched } = await import(" + JSON.stringify(pathToFileURL(MODULE).href) + ");",
    "let calls = 0;",
    "const result = await runWatched(process.execPath, ['-e', 'setTimeout(()=>{},1800)'], {",
    // The probe starts at about 1.0 s and returns at about 2.5 s; the child ended at 1.8 s.
    "  silenceMs: 1000, sampleMs: 15000, cpuProbe: async () => { calls += 1; await new Promise((r) => setTimeout(r, 1500)); return 0; },",
    "});",
    "console.log(JSON.stringify({ calls, hung: result.hung, code: result.code }));",
  ].join("\n"));
  const started = Date.now();
  const outcome = await new Promise((done) => {
    const out = [];
    const proc = spawn(NODE, [script], { stdio: ["ignore", "pipe", "inherit"], windowsHide: true });
    proc.stdout.on("data", (chunk) => out.push(chunk));
    proc.once("close", (code) => done({ code, text: Buffer.concat(out).toString("utf8") }));
  });
  const elapsed = Date.now() - started;
  assertEqual(outcome.code, 0, "the helper script ended cleanly");
  const parsed = JSON.parse(outcome.text.trim());
  assertEqual(parsed.calls, 1, "no second measurement after the run ended");
  assertEqual(parsed.hung, false, "not hung");
  assertEqual(parsed.code, 0, "child exit code");
  assert(elapsed < 9000, "no 15 s sample timer started after the end: " + elapsed + " ms");
});

test("Windows kill: every identity-checked member is ended on its own, then a control listing ends leftovers", async () => {
  const t0 = Date.now();
  let childPid = 0;
  let listCalls = 0;
  const handled = [];
  const listProcesses = async () => {
    listCalls += 1;
    const me = row(childPid, 1, t0 + 20, { cpu: 1 });
    const x = row(80_001, childPid, t0 + 60, { cpu: 1 });
    const y = row(80_002, 80_001, t0 + 70, { cpu: 1 });
    const z = row(80_003, 80_002, t0 + 80, { cpu: 1 });
    const stranger = row(80_099, 99_999, t0 + 90, { cpu: 1 });
    // The control listing finds a grandchild that z started while the kill was running.
    const late = row(80_009, 80_003, t0 + 500, { cpu: 1 });
    if (listCalls <= 3) return [me, x, y, z, stranger];
    return listCalls === 4 ? [late, stranger] : [stranger];
  };
  const result = await runWatched(NODE, ["-e", "process.stdout.write(String(process.pid));setTimeout(()=>{},60000)"], {
    env: SHORT_ENV,
    platform: "win32",
    listProcesses,
    onOutput: (kind, chunk) => { childPid = Number(Buffer.from(chunk).toString("utf8")) || childPid; },
    terminateTree: (handle) => {
      handled.push(handle.pid);
      return handle.pid === childPid ? terminateProcessTree(handle) : { ok: true, fallback: false, diagnostic: null };
    },
  });
  assertEqual(result.hung, true, "hung");
  assertEqual(handled.join(","), [childPid, 80001, 80002, 80003, 80009].join(","),
    "the live child by handle, each member one by one (not only the root of the remainder), then the leftover; never the stranger");
  assertEqual(listCalls, 4, "two measurements, the kill listing and the control listing");
  assert(!/termination not confirmed/.test(result.hungReason), "everything was confirmed: " + result.hungReason);
});

test("an output file that is closed early without an error is reported in spawnError", async () => {
  const dir = scratch();
  const early = new Writable({ write(chunk, encoding, done) { done(); } });
  const sink = new Writable({ write(chunk, encoding, done) { done(); } });
  let opened = 0;
  setTimeout(() => early.destroy(), 500);
  const code = "let n=0;const t=setInterval(()=>{process.stdout.write(Buffer.alloc(1024,67));if(++n>=20)clearInterval(t)},100)";
  const result = await watch(code, {
    outputFile: join(dir, "out.txt"),
    createFileStream: () => (opened++ === 0 ? early : sink),
  });
  assertEqual(result.hung, false, "not hung");
  assertEqual(result.code, 0, "exit code");
  assertEqual(result.stdoutBytes, 20 * 1024, "all output was still counted");
  assert(/output file closed early/.test(String(result.spawnError)), "the early close is reported: " + result.spawnError);
  assert(!/output file error/.test(String(result.spawnError)), "it was not an error: " + result.spawnError);
});

test("activity(): a silent child that the caller knows to be busy is not aborted, without any CPU measurement", async () => {
  const probe = countingProbe(() => 5); // would count as hung: CPU time stands still
  let asked = 0;
  const result = await watch("setTimeout(()=>{},4500)", { cpuProbe: probe, activity: () => { asked += 1; return true; } });
  assertEqual(result.hung, false, "known activity must keep the run alive: " + result.hungReason);
  assertEqual(result.code, 0, "exit code");
  assert(asked >= 2, "asked at every silence period, not once: " + asked);
  assertEqual(probe.calls, 0, "no measurement while the caller reports activity");
});

test("activity(): the silence counter starts over, so a verdict comes one silence period after the last true", async () => {
  const startedAt = Date.now();
  let lastTrueAt = 0;
  const result = await watch("setTimeout(()=>{},60000)", {
    cpuProbe: countingProbe(() => 5),
    activity: () => {
      if (Date.now() - startedAt < 3200) { lastTrueAt = Date.now(); return true; }
      return false;
    },
  });
  assertEqual(result.hung, true, "once the caller reports no activity the silent, idle child is hung");
  assert(lastTrueAt - startedAt >= 1400, "activity was reported during the first silence periods: " + (lastTrueAt - startedAt));
  assert(startedAt + result.durationMs >= lastTrueAt + 1400, "the verdict is a full silence period after the last true: " + result.durationMs);
  assert(result.durationMs < 30000, "ended early: " + result.durationMs);
});

test("activity(): a function that throws or returns something other than true counts as not busy", async () => {
  const thrown = await watch("setTimeout(()=>{},60000)", {
    cpuProbe: countingProbe(() => 5), activity: () => { throw new Error("activity boom"); },
  });
  assertEqual(thrown.hung, true, "a throwing activity() must not keep a hung child alive");
  const truthy = await watch("setTimeout(()=>{},60000)", { cpuProbe: countingProbe(() => 5), activity: () => 1 });
  assertEqual(truthy.hung, true, "only true counts, not a truthy value");
});

test("activity(): busy reported only while the CPU measurement runs still saves the child (second ask before the verdict)", async () => {
  let asked = 0;
  const result = await runWatched(NODE, ["-e", "setTimeout(()=>{},3800)"], {
    env: SHORT_ENV, silenceMs: 1000, sampleMs: 10,
    cpuProbe: async () => { await sleep(300); return 5; },
    activity: () => { asked += 1; return asked % 2 === 0; },
  });
  assertEqual(result.hung, false, "the verdict asks again after the measurement: " + result.hungReason);
  assertEqual(result.code, 0, "exit code");
  assert(asked >= 2, "asked before and after the measurement: " + asked);
});

test("discardOutput keeps nothing in memory but counts, hashes and reports every byte; onSpawn gets the child", async () => {
  const seen = [];
  let spawned = null;
  const result = await watch("process.stdout.write('abc');process.stderr.write('de')", {
    discardOutput: true,
    onOutput: (kind, chunk) => seen.push(kind + ":" + Buffer.from(chunk).toString("utf8")),
    onSpawn: (child) => { spawned = child; },
  });
  assertEqual(result.stdout, "", "no stdout kept");
  assertEqual(result.stderr, "", "no stderr kept");
  assertEqual(result.stdoutBytes, 3, "stdout bytes counted");
  assertEqual(result.stderrBytes, 2, "stderr bytes counted");
  assertEqual(result.stdoutSha256, createHash("sha256").update("abc").digest("hex"), "hash of the output");
  assert(seen.includes("stdout:abc") && seen.includes("stderr:de"), "onOutput saw the chunks: " + seen.join(","));
  assert(spawned && Number.isInteger(spawned.pid) && spawned.pid > 0, "onSpawn received the child process");
});

const selectedTests = filter ? tests.filter((item) => item.name.includes(filter)) : tests;
let passed = 0;
let skipped = 0;
const failures = [];
for (const item of selectedTests) {
  try {
    await item.fn();
    passed++;
    console.log("ok   " + item.name);
  } catch (error) {
    if (error instanceof SkippedTest) {
      skipped += 1;
      console.log("skip " + item.name + " # " + error.message);
      continue;
    }
    failures.push(item.name);
    console.log("FAIL " + item.name + "\n     " + String(error.message).replace(/\n/g, "\n     "));
  }
}
for (const dir of dirs) {
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
  catch (error) { console.error("warning: fixture cleanup failed for " + dir + ": " + error.message); }
}
emitTestCounts("silence-watch-tests", {
  tests: selectedTests.length, pass: passed, fail: failures.length, skip: skipped,
});
console.log("\n" + passed + "/" + selectedTests.length + " passed, " + skipped + " skipped");
if (failures.length) {
  console.log("failed: " + failures.join(", "));
  process.exitCode = 1;
}
