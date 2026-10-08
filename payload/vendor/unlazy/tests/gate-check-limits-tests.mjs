#!/usr/bin/env node
// gate-check without time and output limits (B9, B11, B17) and the open-amendment
// stop (C14c): output of any size, EXPECT on the output file across block
// boundaries, a hang as the only reason to stop a CHECK, output files that do not
// stay behind, and AMEND_OPEN before anything is written. Zero dependencies.

import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, utimesSync, writeFileSync,
} from "node:fs";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { hardenWindowsPrivateDirectory } from "../scripts/lib/windows-acl.mjs";
import {
  BLOCK_BYTES, decodeSegments, fingerprintOutput, includesText, outputSegments, readWindows,
} from "../scripts/lib/output-scan.mjs";
import {
  amendCommands, findOpenAmendments, harnessRootsFor, packageIdsOfLedgers, probeRepository,
} from "../scripts/lib/open-amend.mjs";
import { initRepository } from "./helpers/git-repo.mjs";
import { emitTestCounts } from "./helpers/test-counts.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const GATE_CHECK = join(HERE, "..", "scripts", "gate-check.mjs");
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const has = (text, value, label = "output") => assert(text.includes(value), label + " missing " + JSON.stringify(value) + "\n" + text.slice(-3000));
const lacks = (text, value, label = "output") => assert(!text.includes(value), label + " unexpectedly includes " + JSON.stringify(value) + "\n" + text.slice(-3000));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const HANG_ENV = { KEEL_SILENCE_MS: "1000", KEEL_SILENCE_SAMPLE_MS: "200" };
const deferredCleanup = new Set();

function sandbox() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "unlazy-limits-")));
  const approvals = realpathSync(mkdtempSync(join(tmpdir(), "unlazy-limits-store-")));
  if (process.platform === "win32") hardenWindowsPrivateDirectory(approvals);
  return {
    dir, approvals,
    path(rel) { return join(dir, rel); },
    write(rel, text) {
      const path = join(dir, rel);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text);
      return path;
    },
    read(rel) { return readFileSync(join(dir, rel), "utf8"); },
    cleanup() {
      for (const target of [dir, approvals]) {
        try { rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
        catch { deferredCleanup.add(target); }
      }
    },
  };
}

function run(args, options) {
  return new Promise((done) => {
    const env = { ...process.env, ...(options.env || {}) };
    // Windows names the variable Path: an explicit PATH replaces it instead of sitting beside it.
    if (options.env && "PATH" in options.env) {
      for (const key of Object.keys(env)) if (key !== "PATH" && /^path$/iu.test(key)) delete env[key];
    }
    execFile(process.execPath, [GATE_CHECK, ...args], {
      cwd: options.cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env,
    }, (error, stdout, stderr) => {
      done({ code: error ? (typeof error.code === "number" ? error.code : 1) : 0, stdout, stderr, out: stdout + stderr });
    });
  });
}

// Legacy ledger mode: the ledger is <dir>/GATES.md, approvals are recorded on the way.
function gateRun(s, args = [], env = {}) {
  const actual = ["--legacy", ...(args.includes("--status") ? [] : ["--approve"]), ...args];
  return run(actual, { cwd: s.dir, env: { UNLAZY_APPROVAL_DIR: s.approvals, ...env } });
}

const gate = (id, title, check, expect, extra = "") =>
  "- [ ] " + id + ": " + title + "\n  CHECK: " + check + "\n  EXPECT: " + expect + "\n" + extra + "  EVIDENCE: pending\n";

async function waitForProcessExit(pid, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try { process.kill(pid, 0); } catch { return true; }
    if (Date.now() >= deadline) return false;
    await new Promise((done) => setTimeout(done, 50));
  }
}

// ---- output-scan: the file reader behind EXPECT -----------------------------

test("output-scan: a substring is found wherever it falls relative to the block boundaries", async () => {
  const s = sandbox();
  try {
    const stdoutText = "0123456789abcdefghijklmnopqrstuvwxyz".repeat(5);
    const stderrText = "ERR-LINE-one\nERR-LINE-two\n";
    s.write("out.txt", stdoutText);
    s.write("err.txt", stderrText);
    const segments = outputSegments(s.path("out.txt"), s.path("err.txt"));
    const whole = stdoutText + "\n" + stderrText;
    for (const blockBytes of [1, 3, 8, 16, 64, 4096]) {
      for (let length = 1; length <= 13; length++) {
        for (let start = 0; start + length <= whole.length; start += 1) {
          const needle = whole.slice(start, start + length);
          assert(await includesText(segments, needle, blockBytes), "missed " + JSON.stringify(needle) + " at block size " + blockBytes);
        }
      }
    }
    assert(!await includesText(segments, "xyz0123456789abcdefghijklmnopqrstuvwxyz0123456789abcdefg-"), "found a near miss");
    // stdout and stderr are joined by one newline; text does not run across it without that newline.
    assert(await includesText(segments, "wxyz\nERR-LINE-one", 8), "separator not seen");
    assert(!await includesText(segments, "wxyzERR-LINE-one", 8), "stdout and stderr were glued together");
    const fingerprint = await fingerprintOutput(segments);
    assert(fingerprint.bytes === Buffer.byteLength(whole) && fingerprint.sha256 === sha256(whole), "fingerprint differs from the joined text");
    assert(decodeSegments(segments) === whole, "decodeSegments differs from the joined text");
  } finally { s.cleanup(); }
});

test("output-scan: empty, one-sided and truncated-for-display outputs", async () => {
  const s = sandbox();
  try {
    s.write("empty.txt", "");
    s.write("some.txt", "only stdout\n");
    const none = outputSegments(s.path("empty.txt"), s.path("missing.txt"));
    assert(none.length === 0 && !await includesText(none, "x") && (await fingerprintOutput(none)).sha256 === sha256(""), "empty output");
    const one = outputSegments(s.path("some.txt"), s.path("empty.txt"));
    assert(one.length === 1 && (await fingerprintOutput(one)).sha256 === sha256("only stdout\n"), "one-sided output gets no separator");
    s.write("big.txt", "a".repeat(100000) + "MIDDLE" + "z".repeat(100000));
    const window = await readWindows(outputSegments(s.path("big.txt"), s.path("empty.txt")), 100, 50);
    assert(window.truncated && window.text.startsWith("a".repeat(100)) && window.text.endsWith("z".repeat(50)) && !window.text.includes("MIDDLE"), "display windows");
    const whole = await readWindows(one, 100, 50);
    assert(!whole.truncated && whole.text === "only stdout\n", "short output is returned whole");
  } finally { s.cleanup(); }
});

// ---- B17: output in files, EXPECT on the file -------------------------------

test("expect: a match across the internal block boundary is found, at every offset", async () => {
  const s = sandbox();
  try {
    s.write("mark.mjs", [
      "const offset = Number(process.argv[2]);",
      "const block = " + BLOCK_BYTES + ";",
      "process.stdout.write('x'.repeat(block - offset) + 'BOUNDARY_MARK' + 'y'.repeat(100) + '\\n');",
      "",
    ].join("\n"));
    let ledger = "";
    const offsets = [];
    for (let offset = 1; offset <= 12; offset++) {
      offsets.push(offset);
      ledger += gate("T" + offset, "marker at offset " + offset, "node mark.mjs " + offset, "BOUNDARY_MARK");
      ledger += gate("R" + offset, "regex at offset " + offset, "node mark.mjs " + offset, "/x+BOUNDARY_MARK(y{100})$/m");
    }
    s.write("GATES.md", ledger);
    const result = await gateRun(s, ["--jobs", "4"]);
    assert(result.code === 0, result.out.slice(-3000));
    for (const offset of offsets) { has(result.out, "PASS GATES:T" + offset); has(result.out, "PASS GATES:R" + offset); }
  } finally { s.cleanup(); }
});

test("expect: 3 MiB of output with EXPECT at the very end is green, its fingerprint is the SHA-256 of the output", async () => {
  const s = sandbox();
  try {
    s.write("large.mjs", "process.stdout.write('x'.repeat(3 * 1024 * 1024)); console.log('FINAL_TOKEN');\n");
    s.write("GATES.md", gate("G1", "3 MiB", "node large.mjs", "FINAL_TOKEN") + gate("G2", "3 MiB regex", "node large.mjs", "/^x+FINAL_TOKEN$/m"));
    const result = await gateRun(s);
    assert(result.code === 0, result.out.slice(-3000));
    const expected = "x".repeat(3 * 1024 * 1024) + "FINAL_TOKEN\n";
    has(s.read("GATES.md"), "output-sha256=" + sha256(expected));
    has(s.read("GATES.md"), "output-bytes=" + Buffer.byteLength(expected));
    lacks(result.out, "x".repeat(2000), "transcript");
  } finally { s.cleanup(); }
});

test("expect: stdout and stderr are one output joined by a newline, and a split token is not a match", async () => {
  const s = sandbox();
  try {
    s.write("both.mjs", "process.stdout.write('A\\n'); process.stderr.write('B\\n');\n");
    s.write("split.mjs", "process.stdout.write('BOUNDARY_'); process.stderr.write('MARK');\n");
    s.write("onlyerr.mjs", "console.error('ONLY_STDERR');\n");
    s.write("GATES.md",
      gate("G1", "both", "node both.mjs", "/^A\\n\\nB$/m") +
      gate("G2", "stderr alone", "node onlyerr.mjs", "ONLY_STDERR") +
      gate("G3", "token split over the two streams", "node split.mjs", "BOUNDARY_MARK") +
      gate("G4", "regex over the split streams", "node split.mjs", "/BOUNDARY_MARK/"));
    const result = await gateRun(s);
    assert(result.code === 1, result.out.slice(-3000));
    has(result.out, "PASS GATES:G1");
    has(result.out, "PASS GATES:G2");
    has(result.out, "FAIL GATES:G3");
    has(result.out, "FAIL GATES:G4");
    // The same bytes the old in-memory code hashed: stdout, "\n", stderr.
    has(s.read("GATES.md"), "output-sha256=" + sha256("A\n\nB\n"));
  } finally { s.cleanup(); }
});

test("expect: a catastrophic pattern is still cut off after 250 ms, a large linear one is not", async () => {
  const s = sandbox();
  try {
    s.write("evil.mjs", "console.log('a'.repeat(30000) + '!');\n");
    s.write("big.mjs", "process.stdout.write('word '.repeat(2 * 1024 * 1024)); console.log('DONE 42');\n");
    s.write("GATES.md", gate("G1", "catastrophic", "node evil.mjs", "/(a+)+$/") + gate("G2", "linear on 10 MiB", "node big.mjs", "/(word )+DONE \\d+/"));
    const result = await gateRun(s);
    assert(result.code === 1, result.out.slice(-3000));
    has(result.out, "EXPECT regex exceeded 250ms");
    has(result.out, "FAIL GATES:G1");
    has(result.out, "PASS GATES:G2");
  } finally { s.cleanup(); }
});

// ---- B9: no time limit, a hang is the only reason to stop -------------------

test("hang: silence without any activity is red with HUNG, never TIMEOUT, and nothing is left running", async () => {
  const s = sandbox();
  try {
    s.write("child.mjs", "import { writeFileSync } from 'node:fs'; writeFileSync('child.pid', String(process.pid)); setInterval(() => {}, 1000);\n");
    s.write("hang.mjs", [
      "import { spawn } from 'node:child_process';",
      "import { writeFileSync } from 'node:fs';",
      "writeFileSync('hang.pid', String(process.pid));",
      "spawn(process.execPath, ['child.mjs'], { stdio: 'inherit' });",
      "setInterval(() => {}, 1000);",
      "",
    ].join("\n"));
    s.write("GATES.md", gate("G1", "hangs", "node hang.mjs", "NEVER"));
    const started = Date.now();
    const result = await gateRun(s, [], HANG_ENV);
    const elapsed = Date.now() - started;
    assert(result.code === 1, result.out);
    has(result.out, "HUNG");
    lacks(result.out.toLowerCase(), "timed out");
    lacks(result.out, "TIMEOUT");
    assert(elapsed < 40000, "the hang was judged after " + elapsed + "ms");
    assert(s.read("GATES.md").includes("EVIDENCE: pending"), "a hung check must not certify the gate");
    for (const file of ["hang.pid", "child.pid"]) {
      const pid = Number(s.read(file));
      assert(await waitForProcessExit(pid), file + " (" + pid + ") is still running after the hang");
    }
  } finally { s.cleanup(); }
});

// The sample window is long here on purpose: on POSIX the CPU time of a tree comes from ps in whole
// seconds, so a 200 ms window cannot show the growth of a busy process.
const BUSY_ENV = { KEEL_SILENCE_MS: "1000", KEEL_SILENCE_SAMPLE_MS: "2200" };

test("hang: a check that works is never stopped, whether it prints, computes, or just takes long", async () => {
  const s = sandbox();
  try {
    s.write("prints.mjs", "let n = 0; const t = setInterval(() => { console.log('tick ' + (++n)); if (n === 12) { clearInterval(t); console.log('PRINTED_OK'); } }, 300);\n");
    s.write("computes.mjs", "const end = Date.now() + 6000; let x = 0; while (Date.now() < end) x += Math.sqrt(x + 1); console.log('COMPUTED_OK');\n");
    s.write("spawns.mjs", [
      "import { spawnSync } from 'node:child_process';",
      "for (let i = 0; i < 14; i++) spawnSync(process.execPath, ['-e', 'let e = Date.now() + 400; while (Date.now() < e);']);",
      "console.log('SPAWNED_OK');",
      "",
    ].join("\n"));
    s.write("GATES.md",
      gate("G1", "prints", "node prints.mjs", "PRINTED_OK") +
      gate("G2", "computes silently", "node computes.mjs", "COMPUTED_OK") +
      gate("G3", "chain of short children", "node spawns.mjs", "SPAWNED_OK"));
    const result = await gateRun(s, ["--jobs", "3"], BUSY_ENV);
    assert(result.code === 0, result.out.slice(-3000));
    lacks(result.out, "HUNG");
  } finally { s.cleanup(); }
});

test("hang: --timeout is accepted and ignored with a notice, a long silent check still passes", async () => {
  const s = sandbox();
  try {
    s.write("slow.mjs", "setTimeout(() => console.log('SLOW_OK'), 2500);\n");
    s.write("GATES.md", gate("G1", "slow", "node slow.mjs", "SLOW_OK"));
    const result = await gateRun(s, ["--timeout", "1"]);
    assert(result.code === 0, result.out);
    has(result.stderr, "--timeout is ignored; checks stop only when hung (silence-watch)");
    lacks(result.out, "timed out");
    const plain = await gateRun(s, ["--reverify"]);
    assert(plain.code === 0, plain.out);
    lacks(plain.stderr, "--timeout is ignored");
    const help = await run(["--help"], { cwd: s.dir });
    has(help.stdout, "accepted and ignored");
    lacks(help.stdout, "default 120");
  } finally { s.cleanup(); }
});

test("hang: the --timeout notice can be switched off with KEEL_GATE_QUIET_TIMEOUT and never replaces a failure cause", async () => {
  const s = sandbox();
  try {
    s.write("bad.mjs", "console.error('REAL_CAUSE_OF_FAILURE'); process.exit(3);\n");
    s.write("GATES.md", gate("G1", "fails", "node bad.mjs", "NEVER_PRINTED"));
    const loud = await gateRun(s, ["--timeout", "5"]);
    assert(loud.code !== 0, loud.out);
    has(loud.stderr, "--timeout is ignored");
    const quiet = await gateRun(s, ["--timeout", "5"], { KEEL_GATE_QUIET_TIMEOUT: "1" });
    assert(quiet.code !== 0, quiet.out);
    lacks(quiet.out, "--timeout is ignored");
    has(quiet.out, "REAL_CAUSE_OF_FAILURE");
    // A bad value is still refused, quiet or not.
    const refused = await gateRun(s, ["--timeout", "0"], { KEEL_GATE_QUIET_TIMEOUT: "1" });
    assert(refused.code === 2, refused.out);
    has(refused.stderr, "--timeout needs an integer");
    // Not passed: no notice.
    const none = await gateRun(s, ["--reverify"]);
    lacks(none.out, "--timeout is ignored");
  } finally { s.cleanup(); }
});

// ---- B17: files of the run do not stay behind and are not in the repository -

const tempEnv = (dir) => ({ TEMP: dir, TMP: dir, TMPDIR: dir });
const leftovers = (dir) => readdirSync(dir).filter((name) => name.startsWith("unlazy-gate-"));

test("work files: removed after a passing, a failing and a hung run", async () => {
  const s = sandbox();
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), "unlazy-limits-tmp-")));
  try {
    s.write("pass.mjs", "process.stdout.write('x'.repeat(1024 * 1024)); console.log('PASS_OK');\n");
    s.write("fail.mjs", "console.error('failing'); process.exit(3);\n");
    s.write("hang.mjs", "setInterval(() => {}, 1000);\n");
    s.write("GATES.md", gate("G1", "pass", "node pass.mjs", "PASS_OK") + gate("G2", "fail", "node fail.mjs", "NEVER") + gate("G3", "hang", "node hang.mjs", "NEVER"));
    const result = await gateRun(s, [], { ...HANG_ENV, ...tempEnv(scratch) });
    assert(result.code === 1, result.out.slice(-2000));
    has(result.out, "PASS GATES:G1");
    has(result.out, "HUNG");
    assert(leftovers(scratch).length === 0, "work files stayed behind: " + readdirSync(scratch).join(", "));
  } finally {
    s.cleanup();
    try { rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch { deferredCleanup.add(scratch); }
  }
});

test("work files: leftovers of a killed run older than a week are swept, anything else is left alone", async () => {
  const s = sandbox();
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), "unlazy-limits-tmp-")));
  try {
    for (const name of ["unlazy-gate-old", "unlazy-gate-recent", "unrelated-old"]) mkdirSync(join(scratch, name));
    const eightDays = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    for (const name of ["unlazy-gate-old", "unrelated-old"]) utimesSync(join(scratch, name), eightDays, eightDays);
    s.write("ok.mjs", "console.log('SWEEP_OK');\n");
    s.write("GATES.md", gate("G1", "sweep", "node ok.mjs", "SWEEP_OK"));
    const result = await gateRun(s, [], tempEnv(scratch));
    assert(result.code === 0, result.out.slice(-2000));
    const left = readdirSync(scratch).sort();
    assert(left.join(",") === "unlazy-gate-recent,unrelated-old", "left over: " + left.join(", "));
  } finally {
    s.cleanup();
    try { rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch { deferredCleanup.add(scratch); }
  }
});

test("work files: never inside the repository, even when TEMP points there", async () => {
  const s = sandbox();
  const home = realpathSync(mkdtempSync(join(tmpdir(), "unlazy-limits-home-")));
  try {
    mkdirSync(s.path("scratch"));
    s.write("look.mjs", [
      "import { readdirSync } from 'node:fs';",
      "const inside = readdirSync('scratch').filter((name) => name.startsWith('unlazy-gate-'));",
      "console.log('INSIDE=' + inside.length);",
      "",
    ].join("\n"));
    s.write("GATES.md", gate("G1", "no work files in the repo", "node look.mjs", "INSIDE=0"));
    const result = await gateRun(s, [], { ...tempEnv(s.path("scratch")), HOME: home, USERPROFILE: home });
    assert(result.code === 0, result.out.slice(-3000));
    assert(leftovers(s.path("scratch")).length === 0, "work files stayed in the repository");
    const fallback = join(home, ".unlazy", "work");
    assert(!existsSync(fallback) || readdirSync(fallback).length === 0, "work files stayed in the fallback directory");
  } finally {
    s.cleanup();
    try { rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch { deferredCleanup.add(home); }
  }
});

// ---- C14c: an open amendment stops the run before anything is written ------

function harnessFixture(name, { packageId = "demo", repoInHarness = false } = {}) {
  const s = sandbox();
  // The records name canonical paths, so the fixture uses the native canonical form.
  const harnessRoot = realpathSync.native(s.dir);
  const repoRoot = repoInHarness ? join(harnessRoot, "child") : harnessRoot;
  initRepository(repoRoot);
  writeFileSync(join(harnessRoot, ".keel-harness.json"), JSON.stringify({ schemaVersion: 1 }) + "\n");
  const base = repoInHarness ? "child/" : "";
  s.write(base + "scripts/check.mjs", "console.log('CHECK_OK');\n");
  s.write(base + "docs/packages/" + packageId + "/PACKAGE.md", "# Work package: " + packageId + "\n");
  s.write(base + "docs/packages/" + packageId + "/GATES.md",
    "# Gates\n\n" + gate("G1", "root", "node scripts/check.mjs", "CHECK_OK"));
  return { s, harnessRoot, repoRoot, packageId, ledger: base + "docs/packages/" + packageId + "/GATES.md" };
}

function writeAmendRecord(f, overrides = {}) {
  const sessionId = overrides.sessionId || "session-one";
  const record = {
    schemaVersion: 1, harnessRoot: f.harnessRoot, repoRoot: f.repoRoot, gitDir: join(f.repoRoot, ".git"),
    packageId: f.packageId, scope: f.packageId, sessionId, packagePath: "docs/packages/" + f.packageId,
    snapshot: join(f.repoRoot, ".unlazy", f.packageId, "amend", "snapshot.json"),
    createdAt: "2026-10-06T10:00:00.000Z", ...overrides,
  };
  const file = join(f.harnessRoot, ".unlazy", ".amend", sha256(sessionId) + ".json");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(record, null, 2) + "\n");
  return { file, record };
}

const packageRun = (f, extra = []) => run([...(extra.includes("--status") ? [] : ["--approve"]), "--root", f.repoRoot, "--package", f.packageId, ...extra], {
  cwd: f.repoRoot, env: { UNLAZY_APPROVAL_DIR: f.s.approvals, UNLAZY_PACKAGE: "", UNLAZY_SCOPE: "" },
});

function snapshotTree(root) {
  const out = new Map();
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === ".git") continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path); else out.set(path, readFileSync(path, "utf8"));
    }
  };
  visit(root);
  return out;
}

test("amend: an open amendment stops the run with AMEND_OPEN, names finish and undo, and writes nothing", async () => {
  const f = harnessFixture("open");
  try {
    const { file } = writeAmendRecord(f);
    const before = snapshotTree(f.s.dir);
    const approvalsBefore = readdirSync(f.s.approvals).length;
    const result = await packageRun(f);
    assert(result.code === 2, "expected exit 2, got " + result.code + "\n" + result.out);
    has(result.stderr, "AMEND_OPEN");
    has(result.stderr, "demo");
    has(result.stderr, "session-one");
    const script = join(f.harnessRoot, "harness-core", "execution", "package-amend.mjs");
    has(result.stderr, "node \"" + script + "\" finish --harness-root \"" + f.harnessRoot + "\" --session session-one --json");
    has(result.stderr, "node \"" + script + "\" undo --harness-root \"" + f.harnessRoot + "\" --root \"" + f.repoRoot + "\" --receipt \"");
    lacks(result.stdout, "RUN ");
    lacks(result.stdout, "APPROVAL REQUIRED");
    const after = snapshotTree(f.s.dir);
    assert(after.size === before.size && [...before].every(([path, text]) => after.get(path) === text), "the run changed files in the repository");
    assert(f.s.read(f.ledger).includes("- [ ] G1") && f.s.read(f.ledger).includes("EVIDENCE: pending"), "the ledger was touched");
    assert(readdirSync(f.s.approvals).length === approvalsBefore, "an approval was recorded");
    // Without --approve and in explicit-file mode the stop is the same.
    const plain = await run([f.ledger], { cwd: f.repoRoot, env: { UNLAZY_APPROVAL_DIR: f.s.approvals } });
    has(plain.stderr, "AMEND_OPEN");
    // The record closes the way package-amend.cjs closes it: it is deleted.
    rmSync(file);
    const free = await packageRun(f);
    assert(free.code === 0, "after the record is gone the run must pass\n" + free.out);
    has(f.s.read(f.ledger), "- [x] G1");
  } finally { f.s.cleanup(); }
});

test("amend: only a record of this package in this repository stops a run; --status and quiet runs go on", async () => {
  const f = harnessFixture("others");
  try {
    // Another package and another repository do not stop it.
    writeAmendRecord(f, { sessionId: "other-package", packageId: "somethingelse", scope: "somethingelse" });
    writeAmendRecord(f, { sessionId: "other-repo", repoRoot: join(f.s.dir, "elsewhere") });
    const status = await packageRun(f, ["--status"]);
    assert(status.code === 1 && !status.stderr.includes("AMEND_OPEN"), "status of an unmet package\n" + status.out);
    const result = await packageRun(f);
    assert(result.code === 0, result.out);
    // (An unreadable record is not skipped any more: see the AMEND_UNCLEAR test.)
    // The same package, but case-folded: package ids compare without case.
    const { file } = writeAmendRecord(f, { sessionId: "upper", packageId: "DEMO", scope: "DEMO" });
    const demo = await packageRun(f, ["--reverify"]);
    has(demo.stderr, "AMEND_OPEN");
    assert(demo.code === 2, demo.out);
    // --status is a read and is never refused.
    const readOnly = await packageRun(f, ["--status"]);
    assert(!readOnly.stderr.includes("AMEND_OPEN"), "--status was refused\n" + readOnly.out);
    rmSync(file);
    // Nothing to run and nothing written: an open amendment does not matter.
    writeAmendRecord(f);
    const quiet = await packageRun(f);
    assert(quiet.code === 0 && !quiet.stderr.includes("AMEND_OPEN"), "a run with nothing to run was refused\n" + quiet.out);
  } finally { f.s.cleanup(); }
});

test("amend: the Harness root may sit above the repository (Harness root and repository differ)", async () => {
  const f = harnessFixture("above", { repoInHarness: true });
  try {
    writeAmendRecord(f);
    const result = await packageRun(f);
    assert(result.code === 2, "expected exit 2, got " + result.code + "\n" + result.out);
    has(result.stderr, "AMEND_OPEN");
    has(result.stderr, "--harness-root \"" + f.harnessRoot + "\"");
    assert(f.s.read(f.ledger).includes("EVIDENCE: pending"), "the ledger was touched");
  } finally { f.s.cleanup(); }
});

// A run that names the ledger by absolute path, from a directory that is not the
// repository, or with a --root of another repository, must still see the record.
test("amend: an absolute ledger path from outside the repository, or with a foreign --root, still gives AMEND_OPEN and changes nothing", async () => {
  const f = harnessFixture("outside");
  const outside = realpathSync.native(mkdtempSync(join(tmpdir(), "unlazy-outside-")));
  const foreign = realpathSync.native(mkdtempSync(join(tmpdir(), "unlazy-foreign-")));
  try {
    initRepository(foreign);
    writeAmendRecord(f);
    const ledger = f.s.path(f.ledger);
    const before = snapshotTree(f.s.dir);
    const foreignBefore = snapshotTree(foreign);
    const env = { UNLAZY_APPROVAL_DIR: f.s.approvals, UNLAZY_PACKAGE: "", UNLAZY_SCOPE: "" };
    const cases = {
      "cwd outside, no --root": run(["--approve", ledger], { cwd: outside, env }),
      "foreign --root": run(["--approve", "--root", foreign, ledger], { cwd: f.repoRoot, env }),
      "cwd outside and foreign --root": run(["--approve", "--root", foreign, ledger], { cwd: outside, env }),
      "cwd in the foreign repository": run(["--approve", ledger], { cwd: foreign, env }),
    };
    for (const [label, pending] of Object.entries(cases)) {
      const result = await pending;
      assert(result.code === 2, label + ": expected exit 2, got " + result.code + "\n" + result.out);
      has(result.stderr, "AMEND_OPEN", label);
      has(result.stderr, "session-one", label);
      lacks(result.stdout, "RUN ", label);
    }
    const after = snapshotTree(f.s.dir);
    assert(after.size === before.size && [...before].every(([path, text]) => after.get(path) === text), "a run changed files in the repository");
    assert(f.s.read(f.ledger).includes("EVIDENCE: pending"), "the ledger was touched");
    assert(readdirSync(f.s.approvals).length === 0, "an approval was recorded");
    assert(snapshotTree(foreign).size === foreignBefore.size, "the foreign repository was touched");
    // Without the record the same call runs and writes.
    rmSync(join(f.harnessRoot, ".unlazy", ".amend"), { recursive: true, force: true });
    const free = await run(["--approve", "--cwd", f.repoRoot, "--root", foreign, ledger], { cwd: outside, env });
    assert(free.code === 0, free.out);
    has(f.s.read(f.ledger), "- [x] G1");
  } finally {
    f.s.cleanup();
    for (const dir of [outside, foreign]) {
      try { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch { deferredCleanup.add(dir); }
    }
  }
});

test("amend: an unreadable or unknown record stops the run with AMEND_UNCLEAR, names the file, and writes nothing", async () => {
  const cases = {
    "broken JSON": (file) => writeFileSync(file, "{ not json"),
    "unknown schemaVersion": (file) => writeFileSync(file, JSON.stringify({ schemaVersion: 2, packageId: "other", repoRoot: "/x", sessionId: "s" })),
    "no schemaVersion": (file) => writeFileSync(file, JSON.stringify({ packageId: "other", repoRoot: "/x", sessionId: "s" })),
    "missing repoRoot": (file) => writeFileSync(file, JSON.stringify({ schemaVersion: 1, packageId: "other", sessionId: "s" })),
    "invalid package id": (file) => writeFileSync(file, JSON.stringify({ schemaVersion: 1, packageId: "../x", repoRoot: "/x", sessionId: "s" })),
    "JSON null": (file) => writeFileSync(file, "null"),
    "not a regular file": (file) => mkdirSync(file),
  };
  const outside = realpathSync.native(mkdtempSync(join(tmpdir(), "unlazy-outside-")));
  for (const [label, make] of Object.entries(cases)) {
    const f = harnessFixture("unclear");
    try {
      const file = join(f.harnessRoot, ".unlazy", ".amend", sha256(label) + ".json");
      mkdirSync(dirname(file), { recursive: true });
      make(file);
      const before = snapshotTree(f.s.dir);
      const results = [
        await packageRun(f),
        await run(["--approve", f.s.path(f.ledger)], { cwd: outside, env: { UNLAZY_APPROVAL_DIR: f.s.approvals } }),
      ];
      for (const result of results) {
        assert(result.code === 2, label + ": expected exit 2, got " + result.code + "\n" + result.out);
        has(result.stderr, "AMEND_UNCLEAR", label);
        has(result.stderr, file, label);
        lacks(result.stderr, "AMEND_OPEN", label);
        lacks(result.stdout, "RUN ", label);
      }
      const after = snapshotTree(f.s.dir);
      assert(after.size === before.size && [...before].every(([path, text]) => after.get(path) === text), label + ": the run changed files");
      assert(f.s.read(f.ledger).includes("EVIDENCE: pending"), label + ": the ledger was touched");
      assert(readdirSync(f.s.approvals).length === 0, label + ": an approval was recorded");
      // --status is a read and goes on.
      const status = await packageRun(f, ["--status"]);
      lacks(status.stderr, "AMEND_UNCLEAR", label);
      // Removing the file clears the stop.
      rmSync(file, { recursive: true });
      const free = await packageRun(f);
      assert(free.code === 0, label + ": after removing the record the run must pass\n" + free.out);
    } finally { f.s.cleanup(); }
  }
  try { rmSync(outside, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch { deferredCleanup.add(outside); }
});

test("amend: a stray file in the amend directory that is no record name does not stop a run", async () => {
  const f = harnessFixture("stray");
  try {
    const directory = join(f.harnessRoot, ".unlazy", ".amend");
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "notes.txt"), "not a record");
    writeFileSync(join(directory, "x.json"), "{ not json");
    const result = await packageRun(f);
    assert(result.code === 0, result.out);
  } finally { f.s.cleanup(); }
});

// ---- C14c: a failed Git probe is not "no repository" ------------------------

// A PATH that holds no git: every probe of the repository fails to start.
const withoutGit = () => realpathSync.native(mkdtempSync(join(tmpdir(), "unlazy-nogit-bin-")));

test("amend: git not on PATH is a failed probe, not 'no repository': a package file stops the run with AMEND_UNCLEAR and nothing is written", async () => {
  const f = harnessFixture("nogit");
  const outside = realpathSync.native(mkdtempSync(join(tmpdir(), "unlazy-outside-")));
  const bin = withoutGit();
  try {
    const { file } = writeAmendRecord(f);
    const ledger = f.s.path(f.ledger);
    const before = snapshotTree(f.s.dir);
    const env = { UNLAZY_APPROVAL_DIR: f.s.approvals, UNLAZY_PACKAGE: "", UNLAZY_SCOPE: "", PATH: bin };
    const unchanged = (label) => {
      const after = snapshotTree(f.s.dir);
      assert(after.size === before.size && [...before].every(([path, text]) => after.get(path) === text), label + ": the run changed files");
      assert(f.s.read(f.ledger).includes("- [ ] G1") && f.s.read(f.ledger).includes("EVIDENCE: pending"), label + ": the ledger was touched");
      assert(readdirSync(f.s.approvals).length === 0, label + ": an approval was recorded");
    };
    // An absolute path from a directory that is no repository, the record is open.
    const open = await run(["--approve", ledger], { cwd: outside, env });
    assert(open.code === 2, "expected exit 2, got " + open.code + "\n" + open.out);
    assert(/AMEND_(OPEN|UNCLEAR)/u.test(open.stderr), "neither AMEND_OPEN nor AMEND_UNCLEAR\n" + open.out);
    has(open.stderr, ledger, "the ledger is named");
    lacks(open.stdout, "RUN ", "open record");
    unchanged("open record");
    // Without any record the package path alone is enough: an amendment cannot be ruled out.
    rmSync(file);
    const before2 = snapshotTree(f.s.dir);
    const unclear = await run(["--approve", ledger], { cwd: outside, env });
    assert(unclear.code === 2, "expected exit 2, got " + unclear.code + "\n" + unclear.out);
    has(unclear.stderr, "AMEND_UNCLEAR", "no record");
    has(unclear.stderr, ledger, "no record");
    has(unclear.stderr, "docs/packages/demo", "the reason names the package segment");
    lacks(unclear.stderr, "AMEND_OPEN", "no record");
    lacks(unclear.stdout, "RUN ", "no record");
    const after2 = snapshotTree(f.s.dir);
    assert(after2.size === before2.size && [...before2].every(([path, text]) => after2.get(path) === text), "no record: the run changed files");
    assert(f.s.read(f.ledger).includes("- [ ] G1"), "no record: the ledger was touched");
    assert(readdirSync(f.s.approvals).length === 0, "no record: an approval was recorded");
    // --status never writes and is not refused.
    const status = await run(["--status", ledger], { cwd: outside, env });
    lacks(status.stderr, "AMEND_UNCLEAR", "status");
    // With git back on PATH the same package runs and writes.
    const free = await packageRun(f);
    assert(free.code === 0, "with git the run must pass\n" + free.out);
    has(f.s.read(f.ledger), "- [x] G1");
  } finally {
    f.s.cleanup();
    for (const dir of [outside, bin]) {
      try { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch { deferredCleanup.add(dir); }
    }
  }
});

test("amend: a failed probe also stops a file outside docs/packages when a record sits above it, and only warns when nothing speaks for an amendment", async () => {
  const bin = withoutGit();
  const s = sandbox();
  try {
    const ledger = s.write("work/GATES.md", "# Gates\n\n" + gate("G1", "echo", "echo CHECK_OK", "CHECK_OK"));
    const env = { UNLAZY_APPROVAL_DIR: s.approvals, UNLAZY_PACKAGE: "", UNLAZY_SCOPE: "", PATH: bin };
    // Nothing names a package and no record exists above the file: the run goes on, with a warning.
    const warned = await run(["--approve", ledger], { cwd: s.dir, env });
    assert(warned.code === 0, "no package path and no record: the run must pass\n" + warned.out);
    has(warned.stderr, "warning", "probe warning");
    has(warned.stderr, ledger, "probe warning");
    lacks(warned.stderr, "AMEND_", "probe warning");
    has(s.read("work/GATES.md"), "- [x] G1");
    // A record above the file: it cannot be ruled out, so the run stops.
    s.write("work/GATES.md", "# Gates\n\n" + gate("G1", "echo", "echo CHECK_OK", "CHECK_OK"));
    const approvalsBefore = readdirSync(s.approvals).length;
    const record = s.write(".unlazy/.amend/" + sha256("some-session") + ".json",
      JSON.stringify({ schemaVersion: 1, packageId: "elsewhere", repoRoot: join(s.dir, "x"), sessionId: "some-session" }));
    const stopped = await run(["--approve", ledger], { cwd: s.dir, env });
    assert(stopped.code === 2, "expected exit 2, got " + stopped.code + "\n" + stopped.out);
    has(stopped.stderr, "AMEND_UNCLEAR");
    has(stopped.stderr, ledger);
    has(stopped.stderr, join(s.dir, ".unlazy", ".amend"), "the reason names the amend directory");
    lacks(stopped.stdout, "RUN ");
    has(s.read("work/GATES.md"), "- [ ] G1");
    assert(readdirSync(s.approvals).length === approvalsBefore, "an approval was recorded");
    // A stray file that is no record name does not count.
    rmSync(record);
    writeFileSync(join(s.dir, ".unlazy", ".amend", "notes.txt"), "not a record");
    const stray = await run(["--approve", ledger], { cwd: s.dir, env });
    assert(stray.code === 0, "a stray file must not stop the run\n" + stray.out);
  } finally {
    s.cleanup();
    try { rmSync(bin, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch { deferredCleanup.add(bin); }
  }
});

test("amend: a file that Git says is in no repository is skipped silently, as before", async () => {
  const s = sandbox();
  try {
    s.write("GATES.md", "# Gates\n\n" + gate("G1", "echo", "echo CHECK_OK", "CHECK_OK"));
    const result = await gateRun(s);
    assert(result.code === 0, result.out);
    lacks(result.stderr, "AMEND_", "no repository");
    lacks(result.stderr, "warning", "no repository");
  } finally { s.cleanup(); }
});

test("amend: the probe tells 'not a git repository' from every other failure", () => {
  const s = sandbox();
  try {
    const answer = (result) => probeRepository(s.dir, { runner: () => result });
    const none = answer({ status: 128, stdout: "", stderr: "fatal: not a git repository (or any of the parent directories): .git\n" });
    assert(none.state === "none", "not a git repository: " + JSON.stringify(none));
    const dubious = answer({ status: 128, stdout: "", stderr: "fatal: detected dubious ownership in repository at '/x'\n" });
    assert(dubious.state === "failed" && dubious.reason.includes("dubious ownership"), "safe.directory: " + JSON.stringify(dubious));
    const timeout = answer({ status: null, error: Object.assign(new Error("spawnSync git ETIMEDOUT"), { code: "ETIMEDOUT" }), stdout: "", stderr: "" });
    assert(timeout.state === "failed" && timeout.reason.includes("ETIMEDOUT"), "timeout: " + JSON.stringify(timeout));
    const missing = answer({ status: null, error: Object.assign(new Error("spawnSync git ENOENT"), { code: "ENOENT" }), stdout: "", stderr: "" });
    assert(missing.state === "failed" && missing.reason.includes("ENOENT"), "git missing: " + JSON.stringify(missing));
    // An error plus the words of a missing repository is still an error.
    const both = answer({ status: 128, error: new Error("boom"), stdout: "", stderr: "fatal: not a git repository\n" });
    assert(both.state === "failed", "error wins: " + JSON.stringify(both));
    const other = answer({ status: 1, stdout: "", stderr: "something else\n" });
    assert(other.state === "failed" && other.reason.includes("1"), "other exit: " + JSON.stringify(other));
    const silent = answer({ status: 128, stdout: "", stderr: "" });
    assert(silent.state === "failed", "exit 128 without the message: " + JSON.stringify(silent));
    const ok = answer({ status: 0, stdout: s.dir + "\n", stderr: "" });
    assert(ok.state === "repo" && ok.repoRoot, "repository: " + JSON.stringify(ok));
    const empty = answer({ status: 0, stdout: "", stderr: "" });
    assert(empty.state === "failed", "no path from git: " + JSON.stringify(empty));
    // Git's messages are asked for in English whatever the locale is.
    let seenEnv = null;
    probeRepository(s.dir, { runner: (command, args, options) => { seenEnv = options.env; return { status: 0, stdout: s.dir + "\n", stderr: "" }; } });
    assert(seenEnv && seenEnv.LC_ALL === "C" && seenEnv.LANGUAGE === "C", "the probe does not pin the message language");
  } finally { s.cleanup(); }
});

test("amend: the write block repeats the check for its own file under the lock", async () => {
  const f = harnessFixture("late");
  try {
    // The check itself opens the amendment while it runs: after the first test, before the write.
    const record = {
      schemaVersion: 1, harnessRoot: f.harnessRoot, repoRoot: f.repoRoot, gitDir: join(f.repoRoot, ".git"),
      packageId: f.packageId, scope: f.packageId, sessionId: "late-session", packagePath: "docs/packages/" + f.packageId,
      snapshot: join(f.repoRoot, ".unlazy", f.packageId, "amend", "snapshot.json"), createdAt: "2026-10-06T10:00:00.000Z",
    };
    const target = join(f.harnessRoot, ".unlazy", ".amend", sha256("late-session") + ".json");
    f.s.write("scripts/open-now.mjs",
      "import { mkdirSync, writeFileSync } from 'node:fs';\n" +
      "import { dirname } from 'node:path';\n" +
      "const target = " + JSON.stringify(target) + ";\n" +
      "mkdirSync(dirname(target), { recursive: true });\n" +
      "writeFileSync(target, " + JSON.stringify(JSON.stringify(record)) + ");\n" +
      "console.log('OPENED');\n");
    f.s.write(f.ledger, "# Gates\n\n" + gate("G1", "opens an amendment", "node scripts/open-now.mjs", "OPENED"));
    const before = f.s.read(f.ledger);
    const result = await packageRun(f);
    assert(result.code === 2, "expected exit 2, got " + result.code + "\n" + result.out);
    has(result.stderr, "AMEND_OPEN");
    has(result.stderr, "late-session");
    has(result.stderr, join("docs", "packages", f.packageId, "GATES.md") + " was not written", "the refused file is named");
    assert(f.s.read(f.ledger) === before, "the ledger was written although an amendment had opened");
  } finally { f.s.cleanup(); }
});

test("amend: library helpers find the Harness roots and read only well-formed records", () => {
  const s = sandbox();
  try {
    const top = realpathSync.native(s.dir);
    s.write(".keel-harness.json", "{}\n");
    s.write("inner/.keel-harness.json", "{}\n");
    mkdirSync(s.path("inner/repo"), { recursive: true });
    const roots = harnessRootsFor(s.path("inner/repo"));
    assert(roots[0] === join(top, "inner") && roots[1] === top, "roots: " + JSON.stringify(roots));
    assert(harnessRootsFor(s.path("inner/repo")).every((root) => !root.endsWith("repo")), "a directory without the file is no root");
    const commands = amendCommands(s.dir, { sessionId: "a b", repoRoot: s.dir, snapshot: join(s.dir, "x.json") });
    has(commands.finish, "--session \"a b\"");
    assert(findOpenAmendments(s.path("inner/repo"), []).open.length === 0, "no package id, nothing to find");
    const ids = packageIdsOfLedgers(s.dir, [s.path("docs/packages/one/GATES.md"), s.path("docs/packages/two/gates/leaf-a.md"), s.path("elsewhere/GATES.md")]);
    assert([...ids].sort().join(",") === "one,two", "ids: " + [...ids].join(","));
  } finally { s.cleanup(); }
});

let passed = 0;
const failures = [];
for (const item of tests) {
  try { await item.fn(); passed++; console.log("ok   " + item.name); }
  catch (error) { failures.push(item.name); console.log("FAIL " + item.name + "\n     " + String(error.message).replace(/\n/g, "\n     ")); }
}
for (const target of deferredCleanup) {
  for (let attempt = 0; attempt < 50; attempt++) {
    try { rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }); break; }
    catch { await new Promise((done) => setTimeout(done, 100)); }
  }
}
emitTestCounts("gate-check-limits-tests", { tests: tests.length, pass: passed, fail: failures.length, skip: 0 });
console.log("\n" + passed + "/" + tests.length + " passed");
if (failures.length) process.exit(1);
