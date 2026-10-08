// Silence watcher: runs a child process and aborts it only when it is really hung.
// Zero dependencies. Node 16+.
//
// There is no total duration, no timeout option and no output cap. A child that
// writes output or computes may run for as long as it likes. A child is declared
// hung only when (1) neither stdout nor stderr produced a byte for `silenceMs`
// AND (2) the CPU time of its whole process tree did not grow between two
// measurements `sampleMs` apart. Without outputFile the output is collected in
// memory; with outputFile it streams to disk, so nothing has to be capped.
//
// The CPU measurement runs only when the silence threshold is reached, never on
// a fixed beat (a beat would start processes continuously). If the measurement
// itself fails, the child counts as active: better to keep running than to kill
// productive work. The same rule applies after the child exited while a
// grandchild still holds the output pipes open: the pipes are not force-closed
// after a fixed time, the silence rule decides.
//
// Caller-known activity: a caller that can see more than the pipes may pass
// options.activity, a function returning true while the process is known to be busy
// although it is silent (an agent run whose tool call is still open: the event
// stream is quiet, the tool works). It is asked whenever the silence threshold is
// reached, before the CPU measurement and once more before the verdict; true counts
// as activity and the silence counter starts over. It never ends a run and it
// replaces none of the other rules: a throwing function counts as "not known busy".
//
// A change of the tree itself counts as activity: if between the two
// measurements a process joined or left the tree (a chain of short-lived
// children, each below the CPU threshold), the tree is not hung.
//
// Activity counters: short-lived children can fall entirely between two
// snapshots (both see a tree without living grandchildren and no CPU growth),
// although the tree is busy. A parent that starts children and waits for them
// raises per-process counters at every start; a sleeping process, also one that
// only holds a pipe, raises none (measured, see the P01 report). So any growth
// of such a counter in a process present in both snapshots counts as activity:
//  - Windows: the six I/O counters of Win32_Process (read, write and other
//    operations and transfer bytes), read in the same listing as the CPU time.
//  - Linux: cutime + cstime of /proc/<pid>/stat (CPU of terminated, reaped
//    children; clock ticks, only the growth matters).
//  - macOS: no such counters via ps; only CPU time and membership count. A tree
//    of short-lived children that falls into the gaps between two snapshots can
//    still be misjudged as hung there (known limit).
// A process that wakes now and then for a small I/O burst (a PowerShell
// Start-Sleep showed one) postpones the verdict by one silence period; it does
// not prevent it, because the following windows are quiet again.
//
// Output size: without outputFile the whole output is held in memory and decoded
// as text at the end. Beyond the V8 string limit (about 512 MiB) the text is
// replaced by a notice that names the byte count; stdoutBytes and stdoutSha256
// stay correct. Large output belongs in outputFile (streamed to disk, no limit).
//
// options.discardOutput: true keeps no output in memory at all (the caller reads it
// through options.onOutput and stores what it wants itself); stdoutBytes, stderrBytes
// and stdoutSha256 stay correct, stdout and stderr in the result are empty.
// options.onSpawn(child) is called once with the ChildProcess right after the start,
// for a caller that has to know the pid (a state file, its own stop request).
//
// POSIX: the child is started `detached`, which makes it a session and process
// group leader (setsid). Consequences: Ctrl+C / SIGHUP of the controlling
// terminal no longer reach it (this module's caller must end it, and a dying
// caller leaves it running), it has no controlling terminal, and the whole tree
// can be signalled through the group (kill(-pid)). A descendant that leaves the
// group itself (setsid, double fork) is neither found nor killed.
//
// Windows limits (no process groups; the tree is rebuilt from the ParentProcessId
// of a Win32_Process listing, which is not updated when the parent dies):
//  - Descendants are found by walking ParentProcessId and creation times. A
//    descendant whose intermediate parent already ended is found only if an
//    earlier listing of this run saw that parent (identity: PID plus creation
//    time). One whose parent ended before the first listing cannot be assigned to
//    the tree; if it holds the pipes they are closed by force after a grace
//    period and the result says "termination not confirmed".
//  - A live root PID is accepted only if its creation time lies within a few
//    seconds of the spawn; after the exit the PID is never trusted again (PID
//    reuse). That tolerance applies to the root alone, never to children.
//  - Orphans below a dead root PID are taken only if they were created at or
//    after OUR root (its creation time from an earlier listing that saw it, else
//    the spawn minus 100 ms) and not after the exit event (plus 1 s): a child is
//    never created after the death of its parent. So an orphan of the PID's
//    previous holder (older than our spawn) and a child of a stranger that took
//    the PID (younger than our exit) are never measured or ended, whether the
//    stranger still holds the PID or not.
//  - Seen intermediate parents (identity: PID plus creation time) get the same
//    rule: for each one the start of the last listing that still contained it is
//    kept, and the orphans of a dead one are taken only if created at or after
//    it and not after that listing (plus 100 ms). An orphan that may have been
//    born later is not assigned. Principle: better an orphan left alive, reported
//    as "termination not confirmed" when it holds the pipes, than ever a
//    stranger measured or ended.
//  - On the kill every identity-checked member is ended on its own (not only the
//    roots of the remainder), then the tree is listed once more and leftovers are
//    ended.
//  - taskkill addresses a PID, so a PID reused between listing and kill is a
//    residual (millisecond) risk.
//  - Each CPU measurement is a PowerShell call (about a second of its own CPU),
//    made only at the silence threshold, never in a beat.
//
// Windows pitfalls inherited from checks/bounded-runner.mjs: wait for `close`
// (not `exit`) so inherited pipes drain, never signal a PID after Node reported
// its exit unless identity is checked (taskkill addresses a stored PID that may
// have been reused), and never rely on a still-open pipe to end the process.

import { constants as bufferConstants } from "node:buffer";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { win32 } from "node:path";
import { terminateProcessTree } from "./process-tree.mjs";

export const DEFAULT_SILENCE_MS = 30 * 60 * 1000;
export const DEFAULT_SAMPLE_MS = 15000;
export const MIN_SILENCE_MS = 1000;
export const TAIL_BYTES = 64 * 1024;
// Grace after the kill for the pipes to close. It bounds only the cleanup of an
// already-declared hang, never the work itself.
const POST_KILL_GRACE_MS = 3000;
const PROBE_TIMEOUT_MS = 20000;
// Windows: pause between the kill and the control listing for leftovers.
const WINDOWS_RELIST_DELAY_MS = 200;
// Acceptance of the LIVE root PID only: its creation time may differ from the
// spawn time by this much (clock granularity between Date.now() and the OS).
// Children and orphans get no such tolerance, see ORPHAN_SLACK_MS.
const CREATION_SLACK_MS = 5000;
// A child is never created before the spawn, nor before its parent, nor after
// its parent's last sighting (or exit). Only clock granularity between Date.now()
// and the OS creation time needs slack for these comparisons.
const ORPHAN_SLACK_MS = 100;
// A child is never created after the death of its parent. Only clock granularity
// between Date.now() and the OS creation time needs slack here, not the latency
// of the exit event (that makes the recorded exit later, never earlier).
const EXIT_SLACK_MS = 1000;
// Linux reports child CPU in clock ticks (USER_HZ); only the growth matters.
const PROC_STAT_CHILD_FIELDS = [13, 14]; // cutime, cstime after "(comm) "

const wholeNumber = (value) => {
  const text = String(value ?? "").trim();
  return /^\d+$/.test(text) ? Number(text) : null;
};

export function silenceMs(env = process.env) {
  const value = wholeNumber(env && env.KEEL_SILENCE_MS);
  return value !== null && Number.isSafeInteger(value) && value >= MIN_SILENCE_MS ? value : DEFAULT_SILENCE_MS;
}

function sampleMsFrom(env) {
  const value = wholeNumber(env && env.KEEL_SILENCE_SAMPLE_MS);
  return value !== null && Number.isSafeInteger(value) && value >= 10 ? value : DEFAULT_SAMPLE_MS;
}

// ---- CPU measurement of the process tree -----------------------------------

function parsePsTime(text) {
  // [[dd-]hh:]mm:ss[.ff]
  const match = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/.exec(String(text).trim());
  if (!match) return null;
  return Number(match[1] || 0) * 86400 + Number(match[2] || 0) * 3600 + Number(match[3]) * 60 + Number(match[4]);
}

// One call returns, per process: PID, parent PID, kernel and user CPU time,
// creation time, and the six I/O counters (operations and bytes: read, write,
// other). A parent that starts children and waits for them raises the "other"
// counters at every start; a sleeping process raises none (measured).
const WINDOWS_LIST_SCRIPT =
  "Get-CimInstance Win32_Process | ForEach-Object { '{0} {1} {2} {3} {4} {5} {6} {7} {8} {9} {10}' -f " +
  "$_.ProcessId,$_.ParentProcessId,$_.KernelModeTime,$_.UserModeTime," +
  "$(if ($_.CreationDate) { $_.CreationDate.ToFileTimeUtc() } else { 0 })," +
  "[uint64]$_.ReadOperationCount,[uint64]$_.WriteOperationCount,[uint64]$_.OtherOperationCount," +
  "[uint64]$_.ReadTransferCount,[uint64]$_.WriteTransferCount,[uint64]$_.OtherTransferCount }";

function windowsPowerShell() {
  const root = String(process.env.SystemRoot || "").replace(/\//g, "\\").replace(/\\+$/, "");
  // Only the standard drive-root Windows directory is trusted; a bare name would
  // consult cwd/PATH. No trusted path means no measurement, which counts as active.
  if (!/^[A-Za-z]:\\Windows$/i.test(root)) return null;
  const path = win32.join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  return existsSync(path) ? path : null;
}

function runLister(command, args) {
  return new Promise((resolveList, rejectList) => {
    let child;
    try {
      child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    } catch (error) { rejectList(error); return; }
    const out = [];
    const err = [];
    let done = false;
    const finish = (error, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (error) rejectList(error); else resolveList(value);
    };
    // A wedged lister must not wedge the watcher: its failure means "active".
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* already gone */ }
      finish(new Error("process listing timed out"));
    }, PROBE_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => out.push(chunk));
    child.stderr.on("data", (chunk) => err.push(chunk));
    child.once("error", (error) => finish(error));
    child.once("close", (code) => {
      if (code !== 0) {
        finish(new Error("process listing exit " + code + ": " + Buffer.concat(err).toString("utf8").trim().slice(0, 200)));
      } else finish(null, Buffer.concat(out).toString("utf8"));
    });
  });
}

// One process listing: [{ pid, ppid, pgid, cpu (seconds), created (ms epoch or 0),
// activity (Windows: sum of the six I/O counters; otherwise absent) }].
export async function listProcesses(platform = process.platform) {
  if (platform === "win32") {
    const powershell = windowsPowerShell();
    if (!powershell) throw new Error("trusted powershell.exe is unavailable");
    const text = await runLister(powershell, ["-NoProfile", "-NonInteractive", "-Command", WINDOWS_LIST_SCRIPT]);
    const rows = [];
    for (const line of text.split(/\r?\n/)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length !== 11) continue;
      const numbers = parts.map(Number);
      if (!numbers.every(Number.isFinite)) continue;
      const [pid, ppid, kernel, user, created] = numbers;
      // KernelModeTime/UserModeTime are 100 ns units; creation is a FILETIME.
      rows.push({
        pid, ppid, pgid: null,
        cpu: (kernel + user) / 1e7,
        created: created > 0 ? created / 1e4 - 11644473600000 : 0,
        activity: numbers.slice(5).reduce((sum, value) => sum + value, 0),
      });
    }
    if (!rows.length) throw new Error("process listing was empty");
    return rows;
  }
  const text = await runLister("ps", ["-A", "-o", "pid=,ppid=,pgid=,time="]);
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length !== 4) continue;
    const cpu = parsePsTime(parts[3]);
    const [pid, ppid, pgid] = parts.slice(0, 3).map(Number);
    if (cpu === null || ![pid, ppid, pgid].every(Number.isFinite)) continue;
    rows.push({ pid, ppid, pgid, cpu, created: 0 });
  }
  if (!rows.length) throw new Error("process listing was empty");
  return rows;
}

// Members of the tree below rootPid. The root may already be gone: on Windows
// orphans keep their stale ppid, on POSIX the detached child is a group leader
// and its group outlives it (a pgid cannot be reused while a member lives).
//
// Identity rules (a PID alone is not an identity; the bias is always towards
// leaving an orphan alone rather than ever taking a stranger):
//  - The LIVE root row counts only if the child has not exited and, where
//    creation times exist, it was created within CREATION_SLACK_MS of the spawn.
//    Otherwise the PID was reused: the row and its children are strangers, and
//    the root is handled like a dead one. That tolerance applies to the root
//    alone, never to children.
//  - A process created before the spawn (minus ORPHAN_SLACK_MS) cannot be a
//    member.
//  - options.rootExited: the caller knows the child has exited.
//  - Orphans below a dead root PID are taken only if created at or after OUR
//    root (options.seen.get(rootPid) if an earlier listing saw it, else the spawn
//    minus ORPHAN_SLACK_MS). An orphan of the PID's previous holder is older than
//    that, whether the PID is free or held by a stranger now.
//  - A child is never created after the death of its parent. options.exitedAt
//    (ms epoch of the child's exit event) rejects rows below a dead root PID that
//    were created later: a stranger took the PID, started a child and died.
//  - options.seen (Map pid -> creation time of earlier members) with
//    options.lastSeenAt (Map pid -> start of the last listing that still held
//    that member): orphans of an intermediate parent that has since died are
//    taken only if created at or after that parent and not after its last
//    sighting (plus ORPHAN_SLACK_MS). What may have been born later could belong
//    to a stranger that took the PID, so it is not assigned. Without a lastSeenAt
//    entry no orphan of that parent is taken.
export function treeMembers(rows, rootPid, spawnedAt = 0, options = {}) {
  const rootExited = options.rootExited === true;
  const seen = options.seen instanceof Map ? options.seen : null;
  const lastSeenAt = options.lastSeenAt instanceof Map ? options.lastSeenAt : null;
  const exitedAt = Number.isFinite(options.exitedAt) ? options.exitedAt : null;
  const earliest = spawnedAt ? spawnedAt - ORPHAN_SLACK_MS : 0;
  const byParent = new Map();
  for (const row of rows) {
    if (!byParent.has(row.ppid)) byParent.set(row.ppid, []);
    byParent.get(row.ppid).push(row);
  }
  const members = new Map();
  const live = new Map(rows.map((row) => [row.pid, row]));
  const visit = (row) => {
    if (members.has(row.pid)) return;
    members.set(row.pid, row);
    for (const child of byParent.get(row.pid) || []) {
      // A PID reused after the parent died shows up as a "child" that is older
      // than the parent: not part of this tree.
      if (child.created && row.created && child.created < row.created) continue;
      if (child.created && earliest && child.created < earliest) continue;
      visit(child);
    }
  };
  const root = live.get(rootPid);
  const rootIsOurs = Boolean(root) && !rootExited &&
    (!root.created || !spawnedAt || Math.abs(root.created - spawnedAt) <= CREATION_SLACK_MS);
  if (rootIsOurs) {
    visit(root);
  } else {
    // Nothing below the dead root can be older than the root itself.
    const rootCreated = seen ? seen.get(rootPid) : undefined;
    const notBefore = Math.max(rootCreated || 0, earliest);
    for (const row of byParent.get(rootPid) || []) {
      if (row.created && notBefore && row.created < notBefore) continue;
      // The root is dead: nothing below its PID can be younger than its death.
      if (exitedAt !== null && row.created && row.created > exitedAt + EXIT_SLACK_MS) continue;
      // The PID is held by a stranger: its children are born after it. Only
      // rows older than the holder can be orphans of our dead root.
      if (root && !(row.created && root.created && row.created < root.created)) continue;
      visit(row);
    }
  }
  if (seen && spawnedAt) {
    for (const [pid, seenCreated] of seen) {
      if (pid === rootPid || !seenCreated) continue;
      const holder = live.get(pid);
      if (holder && (!holder.created || holder.created === seenCreated)) continue; // alive: reached by the walk
      const lastSeen = lastSeenAt ? lastSeenAt.get(pid) : undefined;
      // No sighting time, no way to tell its orphans from a stranger's children.
      if (lastSeen === undefined) continue;
      for (const row of byParent.get(pid) || []) {
        if (!row.created || row.created < seenCreated) continue;
        if (holder && holder.created && row.created >= holder.created) continue;
        // Possibly born after the parent's last sighting: a stranger may have
        // taken the PID in between, and its child outlived it.
        if (row.created > lastSeen + ORPHAN_SLACK_MS) continue;
        visit(row);
      }
    }
  }
  // POSIX process group. If the root PID is alive although the child exited, the
  // PID was reused, which cannot happen while a member of the group lives: the
  // group is empty and any row with that pgid belongs to a stranger.
  if (!(rootExited && root)) {
    for (const row of rows) {
      if (row.pgid !== null && row.pgid === rootPid) visit(row);
    }
  }
  return [...members.values()];
}

// Remembers the identity (PID plus creation time) of every member this listing
// attributed to the tree, and when it was last seen.
function rememberMembers(seen, lastSeenAt, members, listedAt) {
  for (const row of members) {
    if (!row.created) continue;
    seen.set(row.pid, row.created);
    lastSeenAt.set(row.pid, listedAt);
  }
}

// Updates, for every seen member that this listing still holds (identity: PID
// plus creation time), the start time of the last listing that contained it.
// Orphans of a member that is gone are taken only up to that time, see
// treeMembers. listedAt is taken BEFORE the listing was requested, so it never
// lies after the snapshot the rows come from.
export function noteLastSeen(seen, lastSeenAt, rows, listedAt) {
  const live = new Map(rows.map((row) => [row.pid, row]));
  for (const [pid, seenCreated] of seen) {
    const holder = live.get(pid);
    const present = holder && (!holder.created || holder.created === seenCreated);
    if (present && !(lastSeenAt.get(pid) >= listedAt)) lastSeenAt.set(pid, listedAt);
  }
}

// Linux: CPU time of terminated, reaped children (cutime + cstime of
// /proc/<pid>/stat, clock ticks). A parent that starts short-lived children and
// waits for them gains it at every reaped child, while the parent itself sleeps.
export function parseProcStatChildCpu(text) {
  // The command name is in parentheses and may contain spaces or parentheses.
  const close = String(text).lastIndexOf(")");
  const fields = close < 0 ? [] : String(text).slice(close + 2).trim().split(/\s+/);
  const ticks = PROC_STAT_CHILD_FIELDS.map((index) => Number(fields[index]));
  if (!ticks.every((value) => Number.isFinite(value) && value >= 0)) throw new Error("unreadable /proc stat line");
  return ticks[0] + ticks[1];
}

export async function readProcChildCpu(pid) {
  return parseProcStatChildCpu(await readFile("/proc/" + pid + "/stat", "utf8"));
}

// A CPU sample (pid -> CPU seconds of the tree) that also carries an activity
// counter per pid (pid -> number, only ever growing) where the platform has one:
// Windows I/O counters, Linux CPU of reaped children. Without counters (macOS)
// the sample is just the CPU map.
export class TreeSample extends Map {
  constructor(entries, counters = null) {
    super(entries);
    this.counters = counters;
  }
}

// Default probe: CPU seconds per PID for the whole tree. An injected cpuProbe
// may return the same Map, a { pid: seconds } object, or a single number.
async function defaultCpuProbe(rootPid, context) {
  const rows = await (context.listProcesses || listProcesses)(context.platform);
  const members = treeMembers(rows, rootPid, context.spawnedAt, {
    rootExited: context.rootExited, seen: context.seen, exitedAt: context.exitedAt, lastSeenAt: context.lastSeenAt,
  });
  if (context.seen && context.lastSeenAt) rememberMembers(context.seen, context.lastSeenAt, members, context.listedAt);
  if (!members.length) return new TreeSample([]);
  let counters = null;
  if (context.platform === "win32") {
    counters = new Map(members.filter((row) => Number.isFinite(row.activity)).map((row) => [row.pid, row.activity]));
  } else if (context.platform === "linux") {
    counters = new Map();
    const read = context.readChildCpu || readProcChildCpu;
    await Promise.all(members.map(async (row) => {
      try { counters.set(row.pid, await read(row.pid)); } catch { /* ended meanwhile */ }
    }));
  }
  return new TreeSample(members.map((row) => [row.pid, row.cpu]), counters);
}

function toCpuMap(value) {
  if (value instanceof Map) return value;
  if (typeof value === "number" && Number.isFinite(value)) return new Map([["tree", value]]);
  if (value && typeof value === "object") return new Map(Object.entries(value).map(([key, seconds]) => [key, Number(seconds)]));
  throw new Error("cpu probe returned no usable measurement");
}

// Activity of the tree between two samples (Maps of pid -> CPU seconds).
// - growth: CPU time gained, per PID, so a process leaving the tree cannot hide
//   the growth of the others; a process that appeared in between counts with
//   its whole CPU time.
// - changed: a process joined or left the tree. Many short-lived children can
//   each stay below the CPU threshold while the tree as a whole is busy, so any
//   change of membership is activity.
// - counterGrowth: growth of the activity counters (TreeSample.counters), per
//   PID among the processes present in both samples. Short-lived children can
//   fall entirely between two samples and leave no CPU and no membership trace;
//   the parent that started and awaited them still shows it in its counters,
//   while a sleeping process shows none. Any growth is activity.
export function treeActivity(before, after, threshold = 1) {
  let growth = 0;
  for (const [pid, seconds] of after) {
    const base = before.get(pid) || 0;
    if (Number.isFinite(seconds) && seconds > base) growth += seconds - base;
  }
  let changed = false;
  for (const pid of after.keys()) if (!before.has(pid)) { changed = true; break; }
  if (!changed) for (const pid of before.keys()) if (!after.has(pid)) { changed = true; break; }
  let counterGrowth = 0;
  const countersMeasured = before.counters instanceof Map && after.counters instanceof Map;
  if (countersMeasured) {
    for (const [pid, value] of after.counters) {
      const base = before.counters.get(pid);
      if (base !== undefined && Number.isFinite(value) && value > base) counterGrowth += value - base;
    }
  }
  return { growth, changed, counterGrowth, countersMeasured, active: changed || growth >= threshold || counterGrowth > 0 };
}

// ---- watched run -----------------------------------------------------------

function pseudoHandle(pid, platform) {
  // terminateProcessTree wants a ChildProcess-like handle. For an orphan whose
  // leader is already gone, a handle that is explicitly "not exited" lets the
  // shared code address the numeric PID/group (taskkill /t or kill(-pgid)).
  // Windows: the handle's own kill is the fallback when taskkill fails; a PID
  // that no longer exists counts as terminated. POSIX: after the group kill
  // failed there is no fallback onto the bare PID (it may have been reused),
  // so the helper reports the failure instead.
  if (platform === "win32") {
    return {
      pid, exitCode: null, signalCode: null,
      kill: (signal) => { try { return process.kill(pid, signal); } catch (error) { return error.code === "ESRCH"; } },
    };
  }
  return { pid, exitCode: null, signalCode: null, kill: () => false };
}

function tailBuffer(chunks, limit) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  return total <= limit ? chunks : [Buffer.concat(chunks).subarray(total - limit)];
}

// Output as text. Beyond the V8 string limit (or when the buffer cannot even be
// joined) toString throws; the text is then replaced by a notice with the byte
// count. Large output belongs in outputFile.
export function decodeOutput(chunks, bytes, kind = "output", limit = bufferConstants.MAX_STRING_LENGTH) {
  try {
    // A single chunk is decoded in place: a second copy of a text near the string limit would double the memory for nothing.
    const text = (chunks.length === 1 ? chunks[0] : Buffer.concat(chunks)).toString("utf8");
    if (text.length <= limit) return text;
  } catch { /* beyond the string or buffer limit */ }
  return "[silence-watch] " + kind + " is " + bytes + " bytes, too large to hold as text in memory; use outputFile for large output.";
}

export function runWatched(command, args = [], options = {}) {
  const env = options.env || process.env;
  const pick = (key) => (options.env && options.env[key] !== undefined ? options.env : process.env);
  const silenceLimit = options.silenceMs !== undefined ? Number(options.silenceMs) : silenceMs(pick("KEEL_SILENCE_MS"));
  const sampleMs = options.sampleMs !== undefined ? Number(options.sampleMs) : sampleMsFrom(pick("KEEL_SILENCE_SAMPLE_MS"));
  if (!Number.isFinite(silenceLimit) || silenceLimit <= 0) throw new TypeError("silenceMs must be a positive number");
  if (!Number.isFinite(sampleMs) || sampleMs <= 0) throw new TypeError("sampleMs must be a positive number");
  if (typeof command !== "string" || !command) throw new TypeError("runWatched requires a command");
  if (!Array.isArray(args)) throw new TypeError("runWatched requires an argument array");
  // cpuProbe, terminateTree, listProcesses, platform and createFileStream can be
  // injected for tests only.
  const cpuProbe = options.cpuProbe || defaultCpuProbe;
  const terminate = options.terminateTree || terminateProcessTree;
  const baseListRows = options.listProcesses || listProcesses;
  const platform = options.platform || process.platform;
  const openFile = options.createFileStream || createWriteStream;
  const outputFile = options.outputFile ? String(options.outputFile) : null;
  const hasInput = options.input !== undefined && options.input !== null;
  const discardOutput = options.discardOutput === true;
  // Activity the caller knows about although the pipes are quiet (see the header).
  const callerBusy = () => {
    if (typeof options.activity !== "function") return false;
    try { return options.activity() === true; } catch { return false; }
  };
  // Below this growth the tree counts as idle. 1 s as specified, scaled down
  // for short sample windows (a busy process cannot gain 1 s in 0.5 s).
  const growthThreshold = Math.min(1, sampleMs / 2000);

  const startedAt = Date.now();
  return new Promise((resolveResult) => {
    const streams = { stdout: { chunks: [], bytes: 0 }, stderr: { chunks: [], bytes: 0 } };
    const hash = createHash("sha256");
    const files = outputFile
      ? { stdout: openFile(outputFile), stderr: openFile(outputFile + ".stderr") }
      : null;
    // Drain listeners of file streams that currently hold their pipe paused.
    const paused = { stdout: null, stderr: null };
    // Identities (pid -> creation time) of every tree member any listing saw, and
    // the start time of the last listing that still held each of them.
    const seen = new Map();
    const lastSeenAt = new Map();
    // Start of the most recent listing (read by the probe right after it).
    let listedAt = 0;
    // Every listing goes through here, so each one notes which seen members it
    // still holds (and when), whoever asked for it. The time is taken before the
    // request: it never lies after the snapshot the rows come from.
    const listRows = async (listPlatform) => {
      const startedListing = Math.max(Date.now(), listedAt);
      const rows = await baseListRows(listPlatform);
      listedAt = startedListing;
      noteLastSeen(seen, lastSeenAt, rows, startedListing);
      return rows;
    };
    let fileError = null;
    let fileClosedEarly = null;
    let closingFiles = false;
    let exitedAt = null;
    let killRun = null;
    let child = null;
    let spawnError = null;
    let exitCode = null;
    let exitSignal = null;
    let exited = false;
    let hung = false;
    let hungReason = null;
    let settled = false;
    let checking = false;
    let timer = null;
    let graceTimer = null;
    let sampleTimer = null;
    let sampleWake = null;
    let lastActivityAt = Date.now();
    let lastOutputAt = lastActivityAt;
    let probeNote = null;
    const notes = [];

    // Also ends a running sample wait, so the measurement code returns at once
    // instead of keeping the event loop alive for up to sampleMs.
    const clearTimers = () => {
      clearTimeout(timer);
      clearTimeout(graceTimer);
      clearTimeout(sampleTimer);
      if (sampleWake) { const wake = sampleWake; sampleWake = null; wake(); }
    };
    const waitSample = (ms) => new Promise((done) => {
      // A run that ended already must not start a timer that outlives it.
      if (settled) { done(); return; }
      sampleWake = () => { sampleWake = null; done(); };
      sampleTimer = setTimeout(sampleWake, ms);
    });

    const closeFiles = () => Promise.all(files ? ["stdout", "stderr"].map((kind) => new Promise((done) => {
      closingFiles = true;
      const target = files[kind];
      if (target.destroyed || target.writableFinished) { done(); return; }
      target.once("error", () => done());
      target.end(() => done());
    })) : []);

    // A file stream that failed or closed can never drain: give the pipe back.
    const resumeKind = (kind) => {
      const onDrain = paused[kind];
      if (!onDrain) return;
      paused[kind] = null;
      try { files[kind].removeListener("drain", onDrain); } catch { /* gone */ }
      try { child[kind].resume(); } catch { /* gone */ }
    };

    const finish = async () => {
      if (settled) return;
      settled = true;
      clearTimers();
      // A kill that is still cleaning up (second listing, leftovers) finishes
      // first, so the result reports its outcome.
      if (killRun) await killRun;
      await closeFiles();
      const text = (kind) => decodeOutput(streams[kind].chunks, streams[kind].bytes, kind);
      let stderr = text("stderr");
      if (notes.length) stderr += (stderr && !stderr.endsWith("\n") ? "\n" : "") + notes.join("\n") + "\n";
      resolveResult({
        code: exitCode,
        signal: exitSignal,
        stdout: text("stdout"),
        stderr,
        stdoutBytes: streams.stdout.bytes,
        stderrBytes: streams.stderr.bytes,
        stdoutSha256: hash.digest("hex"),
        outputFile,
        hung,
        hungReason,
        durationMs: Date.now() - startedAt,
        spawnError: spawnError || (fileError ? "output file error: " + fileError : null) || fileClosedEarly,
      });
    };

    const onData = (kind) => (chunk) => {
      const stream = streams[kind];
      stream.bytes += chunk.length;
      if (kind === "stdout") hash.update(chunk);
      lastOutputAt = Date.now();
      lastActivityAt = lastOutputAt;
      if (files) {
        // Memory keeps only the tail; the file keeps everything.
        if (!discardOutput) {
          stream.chunks.push(chunk);
          stream.chunks = tailBuffer(stream.chunks, TAIL_BYTES);
        }
        const target = files[kind];
        if (!target.destroyed && !fileError) {
          if (target.write(chunk) === false && !paused[kind]) {
            paused[kind] = () => resumeKind(kind);
            child[kind].pause();
            target.once("drain", paused[kind]);
          }
        }
      } else if (!discardOutput) stream.chunks.push(chunk);
      if (typeof options.onOutput === "function") {
        try { options.onOutput(kind, chunk); } catch { /* a broken observer must not stop the run */ }
      }
    };

    const schedule = (delay) => {
      clearTimeout(timer);
      if (settled) return;
      timer = setTimeout(onSilence, Math.max(10, delay));
    };

    const measure = async () => {
      const context = {
        spawnedAt: startedAt, silenceMs: silenceLimit, sampleMs, platform, seen, listProcesses: listRows,
        get rootExited() { return exited; },
        get exitedAt() { return exitedAt; },
        get listedAt() { return listedAt; },
        lastSeenAt,
      };
      const checkStart = Date.now();
      let first;
      let second;
      try {
        first = toCpuMap(await cpuProbe(child.pid, context));
        // The run may end during the first measurement (the probe can take a
        // second): then no sample timer is started and no second measurement made.
        if (settled) return { active: true, reason: "run ended during measurement" };
        await waitSample(sampleMs);
        // The run ended during the wait: no second measurement, no process call.
        if (settled) return { active: true, reason: "run ended during measurement" };
        second = toCpuMap(await cpuProbe(child.pid, context));
        if (settled) return { active: true, reason: "run ended during measurement" };
      } catch (error) {
        if (!probeNote) {
          probeNote = "[silence-watch] CPU measurement failed (" + (error && error.message || error) +
            "); the process counts as active.";
          notes.push(probeNote);
        }
        return { active: true, reason: "measurement failed" };
      }
      if (lastOutputAt > checkStart) return { active: true, reason: "output during measurement" };
      const activity = treeActivity(first, second, growthThreshold);
      return {
        active: activity.active, growth: activity.growth, countersMeasured: activity.countersMeasured,
        reason: activity.changed ? "process tree changed" : activity.counterGrowth > 0 ? "counters grew" : "idle",
      };
    };

    const killTree = async () => {
      const results = [];
      const list = async () => {
        try { return await listRows(platform); } catch (error) {
          results.push({ ok: false, diagnostic: "process listing failed: " + (error && error.message || error) });
          return null;
        }
      };
      // The members of the tree that are provably ours (identity-checked).
      const members = (rows) => treeMembers(rows, child.pid, startedAt, {
        rootExited: exited, seen, exitedAt, lastSeenAt,
      }).filter((row) => row.pid !== process.pid);
      // A live child is still addressable by its own handle: taskkill /t or the
      // process-group kill reaches everything linked to it.
      if (!exited) results.push(terminate(child));
      if (platform === "win32") {
        // Descendants whose intermediate parent already ended are not reachable
        // by taskkill /t (their ParentProcessId points at a dead process), and
        // after an exit taskkill cannot address the leader at all. Every member
        // that treeMembers proves to be ours is ended individually, not only the
        // roots of the remainder: a ParentProcessId can point at a stranger that
        // reused the PID, and then /t from the "root" would miss the member.
        const rows = await list();
        if (rows) {
          for (const row of members(rows)) {
            // A live child was handled through its own handle just above.
            if (row.pid === child.pid && !exited) continue;
            results.push(terminate(pseudoHandle(row.pid, platform)));
          }
          // Processes may have been started between the listing and the kill
          // (a parent that had not yet died), or died slowly: list once more and
          // end what is left.
          await new Promise((done) => setTimeout(done, WINDOWS_RELIST_DELAY_MS));
          const rest = await list();
          if (rest) {
            for (const row of members(rest)) {
              if (row.pid === child.pid && !exited) continue;
              results.push(terminate(pseudoHandle(row.pid, platform)));
            }
          }
        }
      } else if (exited) {
        // POSIX: the detached child was the group leader and its group outlives
        // it. The numeric group is addressed only while a member proves that the
        // PID has not been reused (a pgid cannot be reused while a member lives).
        const rows = await list();
        if (rows) {
          if (rows.some((row) => row.pid === child.pid)) {
            results.push({ ok: false, diagnostic: "process id " + child.pid + " was reused after the exit; process group not signalled" });
          } else if (!rows.some((row) => row.pgid === child.pid)) {
            results.push({ ok: false, diagnostic: "no member of the child's process group is left; the holder of the pipes is outside it" });
          } else {
            results.push(terminate(pseudoHandle(child.pid, platform)));
          }
        }
      }
      return results;
    };

    async function onSilence() {
      if (checking || settled || !child) return;
      checking = true;
      try {
        const idle = Date.now() - lastActivityAt;
        if (idle < silenceLimit) { schedule(silenceLimit - idle); return; }
        // Known busy although silent: the counter starts over, no measurement needed.
        if (callerBusy()) {
          lastActivityAt = Date.now();
          schedule(silenceLimit);
          return;
        }
        const verdict = await measure();
        if (settled) return;
        // The caller may have learned of activity while the measurement ran.
        if (verdict.active || callerBusy()) {
          lastActivityAt = Date.now();
          schedule(silenceLimit);
          return;
        }
        const silentFor = Date.now() - lastOutputAt;
        hung = true;
        hungReason = "no output for " + (silentFor / 1000).toFixed(1) + " s and CPU time of the process tree grew only " +
          verdict.growth.toFixed(2) + " s within " + sampleMs + " ms" +
          (verdict.countersMeasured ? ", no I/O or operation counter grew" : "") + " (tree membership unchanged)";
        // finish() waits for this, so a result never reports the kill half-done.
        killRun = (async () => {
          let results = [];
          try { results = await killTree(); } catch (error) {
            results = [{ ok: false, diagnostic: error && error.message || String(error) }];
          }
          const failed = results.filter((item) => !item || item.ok !== true);
          if (failed.length) {
            hungReason += "; tree termination not confirmed: " + failed.map((item) => item && item.diagnostic || "unknown").join("; ");
          }
        })();
        await killRun;
        // The pipes normally close right after the kill. If something escaped
        // the tree and keeps them open, settle anyway: the hang is already judged.
        if (!settled) {
          graceTimer = setTimeout(() => {
            hungReason += "; termination not confirmed: stdout/stderr still open " + (POST_KILL_GRACE_MS / 1000) +
              " s after the kill and closed by force (a process outside the known tree may still hold them)";
            for (const kind of ["stdout", "stderr"]) { try { child[kind].destroy(); } catch { /* closed */ } }
            void finish();
          }, POST_KILL_GRACE_MS);
        }
      } finally {
        checking = false;
      }
    }

    try {
      child = spawn(command, args, {
        cwd: options.cwd || process.cwd(),
        env,
        shell: options.shell === true,
        windowsHide: true,
        // POSIX: own session and process group (setsid), so the tree (and
        // orphans) can be signalled as a group.
        detached: platform !== "win32",
        stdio: [hasInput ? "pipe" : "ignore", "pipe", "pipe"],
      });
    } catch (error) {
      spawnError = error && error.message || String(error);
      void finish();
      return;
    }
    if (typeof options.onSpawn === "function") {
      try { options.onSpawn(child); } catch { /* a broken observer must not stop the run */ }
    }

    if (files) {
      for (const kind of ["stdout", "stderr"]) {
        files[kind].on("error", (error) => { fileError = fileError || error.message; resumeKind(kind); });
        files[kind].on("close", () => {
          // Closed without an error before the run ended: later output is not
          // written. The caller must learn that the file is incomplete.
          if (!closingFiles && !fileError && !fileClosedEarly) {
            fileClosedEarly = "output file closed early (" + (kind === "stdout" ? outputFile : outputFile + ".stderr") +
              "): later output was not written";
          }
          resumeKind(kind);
        });
      }
    }
    child.stdout.on("data", onData("stdout"));
    child.stderr.on("data", onData("stderr"));
    if (hasInput) {
      child.stdin.on("error", () => { /* the child may exit before reading its input */ });
      child.stdin.end(options.input);
    }
    child.once("error", (error) => {
      spawnError = error && error.message || String(error);
      void finish();
    });
    child.once("exit", (code, signal) => {
      exited = true;
      // A child of this process cannot have been created after this moment.
      exitedAt = Date.now();
      exitCode = code;
      exitSignal = signal;
    });
    // Settle on close, not exit: grandchildren may still hold the pipes, and the
    // silence rule (not a fixed drain time) decides when that counts as a hang.
    child.once("close", (code, signal) => {
      if (exitCode === null && exitSignal === null) { exitCode = code; exitSignal = signal; }
      void finish();
    });
    schedule(silenceLimit);
  });
}
