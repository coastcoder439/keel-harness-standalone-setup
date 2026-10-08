#!/usr/bin/env node
// Approvals must hold across shells (Git Bash vs PowerShell PATH), a foreign
// PATH entry must still invalidate them, and --approve must record approvals
// for already-met gates without running them. Zero dependencies.

import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync,
  rmSync, writeFileSync,
} from "node:fs";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { delimiter, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { hardenWindowsPrivateDirectory } from "../scripts/lib/windows-acl.mjs";
import { emitTestCounts } from "./helpers/test-counts.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const GATE_CHECK = join(HERE, "..", "scripts", "gate-check.mjs");
const WINDOWS = process.platform === "win32";
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const sha256 = (text) => createHash("sha256").update(text).digest("hex");

const PROFILE = "C:\\Users\\tester";
const GIT = "C:\\Program Files\\Git";
const REAL_PATH = String(process.env.PATH || process.env.Path || "");

function sandbox() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "unlazy-approval-path-")));
  const approvals = realpathSync(mkdtempSync(join(tmpdir(), "unlazy-approval-path-store-")));
  if (WINDOWS) hardenWindowsPrivateDirectory(approvals);
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
        catch { /* temporary directory; leave it to the OS */ }
      }
    },
  };
}

// PATH as seen from a Git Bash session on Windows: its runtime comes first and
// last. Elsewhere there is no such runtime, so the PATH is just the real one.
function bashPath() {
  if (!WINDOWS) return REAL_PATH;
  return [
    PROFILE + "\\bin", GIT + "\\mingw64\\bin", GIT + "\\usr\\bin", REAL_PATH,
    GIT + "\\usr\\bin\\vendor_perl", GIT + "\\usr\\bin\\core_perl",
  ].join(delimiter);
}

const powershellPath = () => REAL_PATH;
const foreignPath = () => REAL_PATH + delimiter + (WINDOWS ? "C:\\evil\\bin" : "/evil/bin");

function gateCheck(s, args, pathValue) {
  return new Promise((done) => {
    const env = { ...process.env, UNLAZY_APPROVAL_DIR: s.approvals };
    for (const key of Object.keys(env)) if (/^path$/i.test(key)) delete env[key];
    env.PATH = pathValue;
    if (WINDOWS) env.USERPROFILE = PROFILE;
    execFile(process.execPath, [GATE_CHECK, "--legacy", ...args], {
      cwd: s.dir, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, env,
    }, (error, stdout, stderr) => {
      done({ code: error ? (typeof error.code === "number" ? error.code : 1) : 0, out: (stdout || "") + (stderr || "") });
    });
  });
}

const CHECK = "import { writeFileSync } from 'node:fs'; writeFileSync('ran.txt', 'yes'); console.log('OK');\n";
const UNMET = "- [ ] G1: approval path\n  CHECK: node check.mjs\n  EXPECT: OK\n  EVIDENCE: pending\n";
const MET = "- [x] G1: approval path\n  CHECK: node check.mjs\n  EXPECT: OK\n  EVIDENCE: exit=0; earlier run\n";

function tokens(s) {
  return readdirSync(s.approvals).filter((name) => name.endsWith(".json"));
}

test("an approval granted under the Git Bash PATH holds under the PowerShell PATH", async () => {
  const s = sandbox();
  try {
    s.write("check.mjs", CHECK);
    s.write("GATES.md", UNMET);
    const granted = await gateCheck(s, ["--approve"], bashPath());
    assert(granted.code === 0, "approval under the bash PATH failed\n" + granted.out);
    assert(tokens(s).length === 1, "expected exactly one approval token");
    rmSync(s.path("ran.txt"), { force: true });
    s.write("GATES.md", UNMET);
    const replay = await gateCheck(s, [], powershellPath());
    assert(replay.code === 0, "approval did not hold under the PowerShell PATH\n" + replay.out);
    assert(!replay.out.includes("APPROVAL REQUIRED"), "PowerShell run asked for a new approval\n" + replay.out);
    assert(existsSync(s.path("ran.txt")), "approved CHECK did not run");
    assert(tokens(s).length === 1, "the replay must not create a second token");
  } finally { s.cleanup(); }
});

test("an approval granted under the PowerShell PATH holds under the Git Bash PATH", async () => {
  const s = sandbox();
  try {
    s.write("check.mjs", CHECK);
    s.write("GATES.md", UNMET);
    assert((await gateCheck(s, ["--approve"], powershellPath())).code === 0, "approval failed");
    s.write("GATES.md", UNMET);
    const replay = await gateCheck(s, [], bashPath());
    assert(replay.code === 0 && !replay.out.includes("APPROVAL REQUIRED"), "bash replay needed approval\n" + replay.out);
  } finally { s.cleanup(); }
});

test("trailing separators, duplicates, and (Windows) case do not change the approval", async () => {
  const s = sandbox();
  try {
    s.write("check.mjs", CHECK);
    s.write("GATES.md", UNMET);
    assert((await gateCheck(s, ["--approve"], REAL_PATH)).code === 0, "approval failed");
    const first = REAL_PATH.split(delimiter).filter(Boolean)[0];
    const variant = [first + (WINDOWS ? "\\" : "/"), ...REAL_PATH.split(delimiter), first].join(delimiter);
    const cased = WINDOWS ? variant.toUpperCase() : variant;
    s.write("GATES.md", UNMET);
    const replay = await gateCheck(s, [], cased);
    assert(replay.code === 0 && !replay.out.includes("APPROVAL REQUIRED"), "cosmetic PATH change needed approval\n" + replay.out);
  } finally { s.cleanup(); }
});

test("an approval does not hold once a foreign PATH entry is added", async () => {
  const s = sandbox();
  try {
    s.write("check.mjs", CHECK);
    s.write("GATES.md", UNMET);
    assert((await gateCheck(s, ["--approve"], bashPath())).code === 0, "approval failed");
    rmSync(s.path("ran.txt"), { force: true });
    s.write("GATES.md", UNMET);
    const denied = await gateCheck(s, [], foreignPath());
    assert(denied.code === 1, "foreign PATH entry should leave the gate unmet, got " + denied.code + "\n" + denied.out);
    assert(denied.out.includes("APPROVAL REQUIRED"), "missing approval request\n" + denied.out);
    assert(denied.out.includes("NOT RUN"), "the CHECK must not run\n" + denied.out);
    assert(!existsSync(s.path("ran.txt")), "CHECK ran under an unapproved PATH");
  } finally { s.cleanup(); }
});

// The approval is granted under REAL_PATH plus an extra entry and then checked
// under REAL_PATH, which has lost that entry. This does not depend on which entry
// the shell puts first: a Git Bash PATH repeats entries and carries its own
// runtime directories, and normalization (correctly) makes those irrelevant, so
// dropping "the first raw entry" of the real PATH is not a reliable way to make
// a PATH foreign. An entry that exists in no shell's PATH is.
test("an approval does not hold once a PATH entry is lost", async () => {
  const s = sandbox();
  try {
    s.write("check.mjs", CHECK);
    s.write("GATES.md", UNMET);
    const probe = WINDOWS ? "C:\\keel-approval-probe\\bin" : "/keel-approval-probe/bin";
    assert((await gateCheck(s, ["--approve"], REAL_PATH + delimiter + probe)).code === 0, "approval failed");
    rmSync(s.path("ran.txt"), { force: true });
    s.write("GATES.md", UNMET);
    const lost = await gateCheck(s, [], REAL_PATH);
    assert(lost.code !== 0 && !existsSync(s.path("ran.txt")), "a PATH that lost an entry must not reuse the approval\n" + lost.out);
    assert(lost.out.includes("APPROVAL REQUIRED"), "missing approval request\n" + lost.out);
  } finally { s.cleanup(); }
});

test("a PATH with a duplicate at the front keeps the approval", async () => {
  const s = sandbox();
  try {
    s.write("check.mjs", CHECK);
    s.write("GATES.md", UNMET);
    assert((await gateCheck(s, ["--approve"], REAL_PATH)).code === 0, "approval failed");
    rmSync(s.path("ran.txt"), { force: true });
    s.write("GATES.md", UNMET);
    const first = REAL_PATH.split(delimiter).filter(Boolean)[0];
    const duplicated = [first, REAL_PATH].join(delimiter);
    const replay = await gateCheck(s, [], duplicated);
    assert(replay.code === 0 && !replay.out.includes("APPROVAL REQUIRED"), "a duplicated first entry needed a new approval\n" + replay.out);
    assert(existsSync(s.path("ran.txt")), "approved CHECK did not run");
  } finally { s.cleanup(); }
});

test("an approval written with the old raw-PATH signature still holds when the normalized PATH matches", async () => {
  const s = sandbox();
  try {
    s.write("check.mjs", CHECK);
    s.write("GATES.md", UNMET);
    assert((await gateCheck(s, ["--approve"], powershellPath())).code === 0, "approval failed");
    // Rewrite it the way the previous version filed it: schema 1 with the
    // 120 s time limit and the raw Git Bash PATH.
    refileAsOld(s, 120000, (oracle) => ({ ...oracle, path: bashPath() }));
    s.write("GATES.md", UNMET);
    const replay = await gateCheck(s, [], powershellPath());
    assert(replay.code === 0 && !replay.out.includes("APPROVAL REQUIRED"), "legacy approval was not honored\n" + replay.out);
    // And a legacy record for a different PATH set is not.
    rmSync(s.path("ran.txt"), { force: true });
    s.write("GATES.md", UNMET);
    const denied = await gateCheck(s, [], foreignPath());
    assert(denied.code === 1 && !existsSync(s.path("ran.txt")), "legacy approval leaked to a foreign PATH\n" + denied.out);
  } finally { s.cleanup(); }
});

// ---- the time limit is not part of the approval key any more (B11) ----------

const OLD_KEY_ORDER = [
  "schema", "check", "expect", "cwd", "shell", "timeoutMs", "maxOutputBytes",
  "regexTimeoutMs", "regexStartupTimeoutMs", "maxRegexWorkers", "platform", "path",
];

// Files the single current approval the way version 2 and earlier did: schema 1,
// the time limit and the output cap inside the oracle, the signature over that.
function refileAsOld(s, timeoutMs, mutate = (oracle) => oracle) {
  const [name] = tokens(s);
  const record = JSON.parse(readFileSync(join(s.approvals, name), "utf8"));
  const current = record.oracle;
  const old = {};
  for (const key of OLD_KEY_ORDER) {
    if (key === "schema") old.schema = 1;
    else if (key === "timeoutMs") old.timeoutMs = timeoutMs;
    else if (key === "maxOutputBytes") old.maxOutputBytes = 1048576;
    else old[key] = current[key];
  }
  const oracle = mutate(old);
  record.oracle = oracle;
  record.signature = sha256(JSON.stringify(oracle));
  rmSync(join(s.approvals, name));
  const legacyName = sha256(resolve(record.file) + "\0" + record.gate + "\0" + record.signature) + ".json";
  writeFileSync(join(s.approvals, legacyName), JSON.stringify(record, null, 2) + "\n", { mode: 0o600 });
  return legacyName;
}

test("a new approval carries no time limit and no output cap, and --timeout does not change it", async () => {
  const s = sandbox();
  try {
    s.write("check.mjs", CHECK);
    s.write("GATES.md", UNMET);
    assert((await gateCheck(s, ["--approve", "--timeout", "900"], powershellPath())).code === 0, "approval failed");
    const [name] = tokens(s);
    const record = JSON.parse(readFileSync(join(s.approvals, name), "utf8"));
    assert(!("timeoutMs" in record.oracle) && !("maxOutputBytes" in record.oracle), "the key still holds a limit: " + JSON.stringify(record.oracle));
    assert(record.oracle.schema === 2, "new approvals are schema 2");
    rmSync(s.path("ran.txt"), { force: true });
    s.write("GATES.md", UNMET);
    // Another --timeout value, or none, must not ask for a new approval.
    for (const extra of [[], ["--timeout", "1500"], ["--timeout", "5"]]) {
      rmSync(s.path("ran.txt"), { force: true });
      s.write("GATES.md", UNMET);
      const replay = await gateCheck(s, extra, powershellPath());
      assert(replay.code === 0 && !replay.out.includes("APPROVAL REQUIRED"), "--timeout changed the approval key\n" + replay.out);
      assert(existsSync(s.path("ran.txt")), "approved CHECK did not run");
    }
    assert(tokens(s).length === 1, "no second approval token may appear");
  } finally { s.cleanup(); }
});

test("an approval filed with the old time-limit key still holds, whatever limit it stored", async () => {
  for (const timeoutMs of [120000, 900000, 1500000]) {
    const s = sandbox();
    try {
      s.write("check.mjs", CHECK);
      s.write("GATES.md", UNMET);
      assert((await gateCheck(s, ["--approve"], powershellPath())).code === 0, "approval failed");
      const legacyName = refileAsOld(s, timeoutMs);
      assert(tokens(s).length === 1 && tokens(s)[0] === legacyName, "setup: one old-key record expected");
      s.write("GATES.md", UNMET);
      const replay = await gateCheck(s, [], powershellPath());
      assert(replay.code === 0 && !replay.out.includes("APPROVAL REQUIRED"),
        "old approval with timeoutMs " + timeoutMs + " was not honored\n" + replay.out);
      assert(existsSync(s.path("ran.txt")), "the CHECK did not run under the old approval");
      assert(tokens(s).length === 1 && tokens(s)[0] === legacyName, "the old record must stay as it was, no new token");
      // --status never needs it, and an old approval also allows a plain --reverify.
      const reverify = await gateCheck(s, ["--reverify"], powershellPath());
      assert(reverify.code === 0 && !reverify.out.includes("APPROVAL REQUIRED"), "reverify under the old approval\n" + reverify.out);
    } finally { s.cleanup(); }
  }
});

test("an old approval holds under the Git Bash PATH as well (old key and raw PATH together)", async () => {
  const s = sandbox();
  try {
    s.write("check.mjs", CHECK);
    s.write("GATES.md", UNMET);
    assert((await gateCheck(s, ["--approve"], powershellPath())).code === 0, "approval failed");
    refileAsOld(s, 900000, (oracle) => ({ ...oracle, path: bashPath() }));
    s.write("GATES.md", UNMET);
    const replay = await gateCheck(s, [], powershellPath());
    assert(replay.code === 0 && !replay.out.includes("APPROVAL REQUIRED"), "old key plus raw PATH was not honored\n" + replay.out);
  } finally { s.cleanup(); }
});

test("an old approval is never taken for another command, expectation, directory or PATH", async () => {
  const s = sandbox();
  try {
    s.write("check.mjs", CHECK);
    s.write("other.mjs", CHECK);
    s.write("GATES.md", UNMET);
    assert((await gateCheck(s, ["--approve"], powershellPath())).code === 0, "approval failed");
    refileAsOld(s, 900000);
    const variants = [
      ["another CHECK", "- [ ] G1: approval path\n  CHECK: node other.mjs\n  EXPECT: OK\n  EVIDENCE: pending\n", powershellPath()],
      ["another EXPECT", "- [ ] G1: approval path\n  CHECK: node check.mjs\n  EXPECT: /OK|FINE/\n  EVIDENCE: pending\n", powershellPath()],
      ["another CWD", "- [ ] G1: approval path\n  CHECK: node check.mjs\n  EXPECT: OK\n  CWD: sub\n  EVIDENCE: pending\n", powershellPath()],
      ["another PATH", UNMET, foreignPath()],
    ];
    s.write("sub/check.mjs", CHECK);
    for (const [label, ledger, pathValue] of variants) {
      rmSync(s.path("ran.txt"), { force: true });
      s.write("GATES.md", ledger);
      const denied = await gateCheck(s, [], pathValue);
      assert(denied.code === 1 && denied.out.includes("APPROVAL REQUIRED") && denied.out.includes("NOT RUN"),
        label + " reused an old approval\n" + denied.out);
      assert(!existsSync(s.path("ran.txt")), label + ": the CHECK ran");
    }
  } finally { s.cleanup(); }
});

test("a damaged or altered old approval does not count", async () => {
  const cases = [
    ["oracle edited, signature kept", (oracle) => oracle, (record) => { record.oracle.check = "node other.mjs"; }],
    ["unknown extra field", (oracle) => ({ ...oracle, extra: true }), () => {}],
    ["unknown schema", (oracle) => ({ ...oracle, schema: 7 }), () => {}],
    ["signature does not belong to the oracle", (oracle) => oracle, (record) => { record.signature = "0".repeat(64); }],
  ];
  for (const [label, mutate, tamper] of cases) {
    const s = sandbox();
    try {
      s.write("check.mjs", CHECK);
      s.write("GATES.md", UNMET);
      assert((await gateCheck(s, ["--approve"], powershellPath())).code === 0, "approval failed");
      const legacyName = refileAsOld(s, 900000, mutate);
      const file = join(s.approvals, legacyName);
      const record = JSON.parse(readFileSync(file, "utf8"));
      tamper(record);
      writeFileSync(file, JSON.stringify(record, null, 2) + "\n", { mode: 0o600 });
      rmSync(s.path("ran.txt"), { force: true });
      s.write("GATES.md", UNMET);
      const denied = await gateCheck(s, [], powershellPath());
      assert(denied.code === 1 && denied.out.includes("APPROVAL REQUIRED") && !existsSync(s.path("ran.txt")),
        label + " was honored\n" + denied.out);
    } finally { s.cleanup(); }
  }
});

test("--approve records an approval for an already met gate without running it", async () => {
  const s = sandbox();
  try {
    s.write("check.mjs", CHECK);
    s.write("GATES.md", MET);
    const before = s.read("GATES.md");
    const approved = await gateCheck(s, ["--approve"], powershellPath());
    assert(approved.code === 0, "approve on a met gate failed\n" + approved.out);
    assert(approved.out.includes("APPROVED"), "no approval was recorded for the met gate\n" + approved.out);
    assert(tokens(s).length === 1, "expected one approval token for the met gate");
    assert(!existsSync(s.path("ran.txt")), "--approve without --reverify must not run the CHECK");
    assert(s.read("GATES.md") === before, "--approve without --reverify changed the ledger");
    // A second --approve is a no-op.
    const again = await gateCheck(s, ["--approve"], powershellPath());
    assert(again.code === 0 && tokens(s).length === 1, "repeated --approve must not add tokens\n" + again.out);
    // The recorded approval lets --reverify run without a prompt.
    const reverify = await gateCheck(s, ["--reverify"], powershellPath());
    assert(reverify.code === 0, "reverify with the recorded approval failed\n" + reverify.out);
    assert(existsSync(s.path("ran.txt")), "reverify did not run the approved CHECK");
  } finally { s.cleanup(); }
});

test("without --approve a met gate is still skipped and records nothing", async () => {
  const s = sandbox();
  try {
    s.write("check.mjs", CHECK);
    s.write("GATES.md", MET);
    const result = await gateCheck(s, [], powershellPath());
    assert(result.code === 0, result.out);
    assert(tokens(s).length === 0 && !existsSync(s.path("ran.txt")), "a plain run touched a met gate");
  } finally { s.cleanup(); }
});

let failed = 0;
for (const { name, fn } of tests) {
  try { await fn(); console.log("ok - " + name); }
  catch (error) { failed++; console.log("not ok - " + name + "\n" + (error && error.message ? error.message : error)); }
}
emitTestCounts("gate-approval-path-tests", {
  tests: tests.length, pass: tests.length - failed, fail: failed, skip: 0,
});
if (failed) {
  console.log(failed + " of " + tests.length + " tests failed");
  process.exit(1);
}
console.log("GATE_APPROVAL_PATH_OK");
