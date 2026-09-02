import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  hardenWindowsPrivateDirectory,
  verifyWindowsPrivateDirectory,
  windowsPowerShellPath,
} from "../scripts/lib/windows-acl.mjs";
import { initRepository } from "./helpers/git-repo.mjs";
import { emitTestCounts, SkippedTest, skipTest } from "./helpers/test-counts.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const gateCheck = join(here, "..", "scripts", "gate-check.mjs");
const gateLint = join(here, "..", "scripts", "gate-lint.mjs");
const suiteRoot = mkdtempSync(join(tmpdir(), "unlazy-package-gates-"));

function repo(name) {
  const root = join(suiteRoot, name);
  initRepository(root);
  return root;
}

function approvalStore(name, secure = true) {
  const directory = mkdtempSync(join(suiteRoot, name + "-"));
  if (secure && process.platform === "win32") hardenWindowsPrivateDirectory(directory);
  return directory;
}

function ledger(gates, eol = "\n") {
  const text = `# Gates: fixture

${gates.map((gate) => `- [ ] ${gate.id}: ${gate.title}
  CHECK: ${gate.check}
  EXPECT: ${gate.expect}
${gate.cwd ? `  CWD: ${gate.cwd}\n` : ""}  EVIDENCE: pending`).join("\n\n")}
`;
  return eol === "\r\n" ? text.replaceAll("\n", "\r\n") : text;
}

function bundle(root, packageId, options = {}) {
  const directory = join(root, "docs", "packages", packageId);
  mkdirSync(join(directory, "gates"), { recursive: true });
  writeFileSync(join(directory, "PACKAGE.md"), `# Work package: ${packageId}\n`, "utf8");
  writeFileSync(join(directory, "GATES.md"), options.rootLedger || ledger([{
    id: "G1",
    title: "root verifier observes its artifact",
    check: "node scripts/check-root.mjs",
    expect: "ROOT VERIFIED",
  }]), "utf8");
  for (const [name, text] of Object.entries(options.sidecars || {})) {
    writeFileSync(join(directory, "gates", name), text, "utf8");
  }
  return directory;
}

function run(script, root, approvals, ...args) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      UNLAZY_APPROVAL_DIR: approvals,
      UNLAZY_PACKAGE: "",
      UNLAZY_SCOPE: "",
    },
    timeout: 30000,
  });
}

function evidenceLines(root, packageId) {
  const directory = join(root, "docs", "packages", packageId);
  const files = [join(directory, "GATES.md"), join(directory, "gates", "leaf-1.md")].filter(existsSync);
  return files.flatMap((file) => readFileSync(file, "utf8").split(/\r?\n/).filter((line) => line.includes("EVIDENCE:")));
}

function grantBuiltinUsersWrite(directory) {
  const helper = windowsPowerShellPath();
  assert.ok(helper && existsSync(helper), "trusted PowerShell helper unavailable");
  const script = String.raw`
$ErrorActionPreference = 'Stop'
$p = [Environment]::GetEnvironmentVariable('UNLAZY_ACL_TARGET', 'Process')
$acl = [System.IO.Directory]::GetAccessControl($p)
$sid = New-Object System.Security.Principal.SecurityIdentifier('S-1-5-32-545')
$inherit = [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
  $sid, [System.Security.AccessControl.FileSystemRights]::Write,
  $inherit, [System.Security.AccessControl.PropagationFlags]::None,
  [System.Security.AccessControl.AccessControlType]::Allow)
[void]$acl.AddAccessRule($rule)
[System.IO.Directory]::SetAccessControl($p, $acl)
`;
  const result = spawnSync(helper, ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
    cwd: dirname(helper),
    encoding: "utf8",
    windowsHide: true,
    timeout: 5000,
    env: { ...process.env, UNLAZY_ACL_TARGET: directory },
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
}

let passed = 0;
let skipped = 0;
let total = 0;
const test = (name, fn) => {
  total += 1;
  try {
    fn();
    passed += 1;
    console.log("ok   " + name);
  } catch (error) {
    if (error instanceof SkippedTest) {
      skipped += 1;
      console.log("skip " + name + " # " + error.message);
      return;
    }
    console.error("FAIL " + name);
    console.error("     " + error.message);
    process.exitCode = 1;
  }
};

test("package checker and linter consume the same root-first ledger set", () => {
  const root = repo("shared-ledger-set");
  mkdirSync(join(root, "scripts"));
  writeFileSync(join(root, "scripts", "check-root.mjs"), "console.log('ROOT VERIFIED');\n", "utf8");
  writeFileSync(join(root, "scripts", "check-leaf.mjs"), "console.log('LEAF VERIFIED');\n", "utf8");
  bundle(root, "fanout", {
    sidecars: {
      "leaf-1.md": ledger([{
        id: "L1",
        title: "leaf verifier observes its artifact",
        check: "node scripts/check-leaf.mjs",
        expect: "LEAF VERIFIED",
      }]),
    },
  });
  const approvals = approvalStore("shared-ledger-approvals");

  const status = run(gateCheck, root, approvals, "--status", "--root", root, "--package", "fanout");
  assert.equal(status.status, 1, status.stderr + status.stdout);
  assert.match(status.stdout, /fanout\/docs\/packages\/fanout\/GATES\.md:G1/);
  assert.match(status.stdout, /fanout\/docs\/packages\/fanout\/gates\/leaf-1\.md:L1/);

  const linted = run(gateLint, root, approvals, "--json", "--root", root, "--package", "fanout");
  assert.equal(linted.status, 0, linted.stderr);
  assert.deepEqual(JSON.parse(linted.stdout).files, [
    "fanout/docs/packages/fanout/GATES.md",
    "fanout/docs/packages/fanout/gates/leaf-1.md",
  ]);

  const checked = run(gateCheck, root, approvals, "--approve", "--root", root, "--package", "fanout");
  assert.equal(checked.status, 0, checked.stderr + checked.stdout);
  assert.match(checked.stdout, /ALL MET \(2 met\)/);
});

test("package evidence is portable and byte-identical across clone paths", () => {
  const evidences = [];
  for (const name of ["clone-one", "clone-two-with-a-longer-name"]) {
    const root = repo(name);
    mkdirSync(join(root, "scripts"));
    writeFileSync(join(root, "scripts", "check-root.mjs"), "console.log('ROOT VERIFIED');\n", "utf8");
    bundle(root, "portable");
    const approvals = approvalStore(name + "-approvals");
    const checked = run(gateCheck, root, approvals, "--approve", "--root", root, "--package", "portable");
    assert.equal(checked.status, 0, checked.stderr + checked.stdout);
    const lines = evidenceLines(root, "portable");
    assert.equal(lines.length, 1);
    assert.match(lines[0], /schema=2; exit=0; shellId=(?:win32|linux|darwin):[^;]+; cwd=\.; oracleDigest=sha256:[a-f0-9]{64}/);
    assert.equal(lines[0].toLowerCase().includes(root.toLowerCase()), false);
    assert.doesNotMatch(lines[0], /; shell=[A-Za-z]:|; cwd=[A-Za-z]:/i);
    evidences.push(lines[0]);
  }
  assert.equal(evidences[0], evidences[1]);
});

test("Windows cmd.exe handles spaces, CRLF, and special output without corrupting evidence", () => {
  if (process.platform !== "win32") skipTest("requires Windows cmd.exe");
  const root = repo("repo with spaces");
  const cwd = join(root, "workspace with spaces");
  mkdirSync(cwd, { recursive: true });
  writeFileSync(join(cwd, "check special.mjs"), "console.log('WINDOWS ^&|%! OK');\n", "utf8");
  const crlf = ledger([{
    id: "W1",
    title: "Windows special-character fixture is observed",
    check: "node \"check special.mjs\"",
    expect: "WINDOWS ^&|%! OK",
    cwd: "workspace with spaces",
  }], "\r\n");
  bundle(root, "windows", { rootLedger: crlf });
  const approvals = approvalStore("windows-approvals");
  const checked = run(gateCheck, root, approvals, "--approve", "--root", root, "--package", "windows");
  assert.equal(checked.status, 0, checked.stderr + checked.stdout);
  const after = readFileSync(join(root, "docs", "packages", "windows", "GATES.md"), "utf8");
  assert.equal((after.match(/(?<!\r)\n/g) || []).length, 0, "writeback introduced lone LF into CRLF ledger");
  assert.match(after, /shellId=win32:cmd\.exe/);
  assert.match(after, /cwd=workspace with spaces/);
});

test("package CWD traversal is rejected before command execution", () => {
  const root = repo("cwd-escape");
  const outside = join(suiteRoot, "cwd-outside");
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(outside, "marker.mjs"), "console.log('SHOULD NOT RUN');\n", "utf8");
  bundle(root, "escape", {
    rootLedger: ledger([{
      id: "E1",
      title: "outside command must not execute",
      check: "node marker.mjs",
      expect: "SHOULD NOT RUN",
      cwd: "../cwd-outside",
    }]),
  });
  const approvals = approvalStore("escape-approvals");
  const checked = run(gateCheck, root, approvals, "--approve", "--root", root, "--package", "escape");
  assert.equal(checked.status, 2, checked.stderr + checked.stdout);
  assert.match(checked.stderr + checked.stdout, /CWD escapes repository/);
});

test("unsafe Windows approval DACL blocks execution with exit 2", () => {
  if (process.platform !== "win32") skipTest("requires Windows ACLs");
  const root = repo("unsafe-acl");
  mkdirSync(join(root, "scripts"));
  writeFileSync(join(root, "scripts", "check-root.mjs"), [
    "import { writeFileSync } from 'node:fs';",
    "writeFileSync('marker.txt', 'executed');",
    "console.log('ROOT VERIFIED');",
    "",
  ].join("\n"), "utf8");
  bundle(root, "acl");
  const approvals = approvalStore("unsafe-approvals");
  grantBuiltinUsersWrite(approvals);
  assert.throws(() => verifyWindowsPrivateDirectory(approvals), /untrusted SID/);
  const checked = run(gateCheck, root, approvals, "--approve", "--root", root, "--package", "acl");
  assert.equal(checked.status, 2, checked.stderr + checked.stdout);
  assert.equal(existsSync(join(root, "marker.txt")), false, "CHECK ran despite unsafe approval DACL");
  assert.match(checked.stderr + checked.stdout, /infrastructure failure prevented|approval ACL/);
});

test("Windows helper resolution never trusts PATH or an arbitrary SystemRoot", () => {
  assert.equal(windowsPowerShellPath({ SystemRoot: "C:\\repo\\Windows", PATH: "C:\\repo" }), null);
  if (process.platform === "win32") {
    const helper = windowsPowerShellPath();
    assert.ok(helper && isAbsolute(helper));
    assert.equal(basename(helper).toLowerCase(), "powershell.exe");
  }
});

test("Windows helper resolution accepts a missing WINDIR alias but never a conflicting one", () => {
  if (process.platform !== "win32") skipTest("requires trusted Windows environment aliases");
  const trusted = windowsPowerShellPath({
    SystemRoot: process.env.SystemRoot,
    SystemDrive: process.env.SystemDrive,
    PATH: "C:\\attacker",
  });
  assert.ok(trusted && isAbsolute(trusted));
  assert.equal(windowsPowerShellPath({
    SystemRoot: process.env.SystemRoot,
    WINDIR: "D:\\Windows",
    SystemDrive: process.env.SystemDrive,
  }), null);
});

process.on("exit", () => {
  try { rmSync(suiteRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); } catch { /* best effort */ }
});

emitTestCounts("package-gate-tests", {
  tests: total, pass: passed, fail: total - passed - skipped, skip: skipped,
});
if (!process.exitCode) console.log(`\n${passed}/${total} passed, ${skipped} skipped`);
