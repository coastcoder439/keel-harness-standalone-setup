#!/usr/bin/env node
// Check results per code state (B1, B10, A21 storage): the key of a code state and of
// a result, the proof store on Git notes, the clean copy a result is made in, and
// gate-check --at (reuse, no false green, B10, approvals by repository path).
// Everything runs in temporary repositories. Zero dependencies.

import {
  existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync,
  rmSync, writeFileSync, copyFileSync, cpSync, symlinkSync,
} from "node:fs";
import { execFile, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { hardenWindowsPrivateDirectory } from "../scripts/lib/windows-acl.mjs";
import { parseGates } from "../scripts/lib/gates.mjs";
import { initRepository } from "./helpers/git-repo.mjs";
import { emitTestCounts } from "./helpers/test-counts.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
// PROOF_STORE_TEST_SCRIPTS points the suite at another checker tree (vendor/unlazy/scripts
// layout), for instance an earlier state, to show that a test is red there.
const SCRIPTS = process.env.PROOF_STORE_TEST_SCRIPTS ? resolve(process.env.PROOF_STORE_TEST_SCRIPTS) : join(HERE, "..", "scripts");
const {
  cacheable, checkerVersion, codeStateKey, findProof, lockfileBlobs, normalizePackageContractContent,
  packageContractPath, proofKey, proofKeyFor, readProofs, withCleanCheckout, writeProof,
  lifecycleEvidenceRelative, reportRelative, parseNoteText, normalizeLedgerText, nodeModulesWorkspaceLinks, locateGitIntent,
} = await import(pathToFileURL(join(SCRIPTS, "lib", "proof-store.mjs")).href);
const GATE_CHECK = join(SCRIPTS, "gate-check.mjs");
const WINDOWS = process.platform === "win32";
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const suiteRoot = realpathSync(mkdtempSync(join(tmpdir(), "unlazy-proof-")));
let counter = 0;

function git(root, ...args) {
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8", windowsHide: true, timeout: 60_000 });
  if (result.status !== 0) throw new Error("git " + args.join(" ") + ": " + (result.stderr || result.stdout));
  return String(result.stdout).trim();
}

// A repository whose line-ending handling does not depend on the machine's global Git config.
function repository(name) {
  const root = join(suiteRoot, name + "-" + (++counter));
  initRepository(root);
  git(root, "config", "core.autocrlf", "false");
  return root;
}

function write(root, rel, text) {
  const file = join(root, ...rel.split("/"));
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
  return file;
}

function commit(root, message = "c") {
  git(root, "add", "-A");
  git(root, "commit", "--quiet", "--allow-empty", "-m", message);
  return git(root, "rev-parse", "HEAD");
}

// A note writer standing in for git-intent in the unit tests of the store.
function plainNoteWriter(root) {
  return (file, sha) => { git(root, "notes", "--ref", "keel-proof", "add", "-f", "-F", file, sha); };
}

const entryFor = (key, extra = {}) => ({
  key, result: "green", outputSha256: sha256(key), outputBytes: 7, checker: "c", at: "2026-10-06T00:00:00.000Z",
  gate: { package: "p", id: "G1" }, ...extra,
});

const PACKAGE_MD = (ticks = "[ ]", status = "started", close = "open") => `# Work package: p1

## Plan
1. ${ticks} first step

## Status
${status}

## Abnahme
- C1 -> GATES.md:G1: it works

## Abschluss
${close}

## Anhang
none
`;

const GATES_MD = (tick = "[ ]", evidence = "pending", extra = "") => `- ${tick} G1: it works
  CHECK: node scripts/check.cjs g1
  EXPECT: RESULT_OK
${extra}  EVIDENCE: ${evidence}
`;

// ---- code state ---------------------------------------------------------------

test("the code state key is the same for a checkout with core.autocrlf=true and with false", () => {
  const origin = repository("autocrlf-origin");
  write(origin, "src/a.txt", "one\ntwo\n");
  write(origin, "scripts/check.cjs", "console.log('RESULT_OK');\n");
  write(origin, "docs/packages/p1/PACKAGE.md", PACKAGE_MD());
  const sha = commit(origin);
  const keys = [];
  for (const setting of ["true", "false"]) {
    const clone = join(suiteRoot, "autocrlf-clone-" + setting);
    git(suiteRoot, "clone", "--quiet", "-c", "core.autocrlf=" + setting, origin, clone);
    const onDisk = readFileSync(join(clone, "src", "a.txt"), "utf8");
    assert(setting === "true" ? onDisk.includes("\r\n") : !onDisk.includes("\r\n"),
      "setup: the checkout with autocrlf=" + setting + " has the wrong line endings on disk");
    keys.push(codeStateKey(clone, sha).digest);
  }
  assert(keys[0] === keys[1], "the key depends on the line endings of the checkout");
  assert(keys[0] === codeStateKey(origin, sha).digest, "the key of a clone differs from the key of the origin");
});

test("the code state key changes with a code file and not with ticks, EVIDENCE, Status or Abschluss", () => {
  const root = repository("state");
  write(root, "src/a.txt", "one\n");
  write(root, "scripts/check.cjs", "console.log('RESULT_OK');\n");
  write(root, "docs/packages/p1/PACKAGE.md", PACKAGE_MD());
  write(root, "docs/packages/p1/GATES.md", GATES_MD());
  write(root, "docs/packages/p1/gates/leaf-a.md", GATES_MD());
  const base = codeStateKey(root, commit(root, "base"));
  assert(base.algorithm === "git-tree-normalized-v1" && /^[0-9a-f]{64}$/.test(base.digest), "unexpected shape " + JSON.stringify(base));
  assert(base.fileCount === 5 && base.scope.length === 1 && base.scope[0] === ".", "unexpected count or scope " + JSON.stringify(base));

  // Runtime state of package files: ticks, EVIDENCE, Status, Abschluss.
  write(root, "docs/packages/p1/PACKAGE.md", PACKAGE_MD("[x]", "step 1 done on 06.10.\nmore status", "owner ok recorded"));
  write(root, "docs/packages/p1/GATES.md", GATES_MD("[x]", "schema=2; exit=0; output-sha256=" + "a".repeat(64)));
  write(root, "docs/packages/p1/gates/leaf-a.md", GATES_MD("[X]", "manual-review; date=2026-10-06"));
  const runtimeOnly = codeStateKey(root, commit(root, "runtime"));
  assert(runtimeOnly.digest === base.digest, "ticks, EVIDENCE, Status and Abschluss changed the key");
  // CRLF in a package file is not a change either.
  write(root, "docs/packages/p1/GATES.md", GATES_MD("[x]", "other evidence").replace(/\n/g, "\r\n"));
  assert(codeStateKey(root, commit(root, "crlf")).digest === base.digest, "line endings of a package file changed the key");
  // The report and the lifecycle receipt are not part of the state.
  write(root, reportRelative, "{\"ok\":true}\n");
  write(root, lifecycleEvidenceRelative, "{\"receipt\":1}\n");
  assert(codeStateKey(root, commit(root, "report")).digest === base.digest, "the report or the lifecycle receipt changed the key");

  // Contract text is code: the CHECK of a gate, the text of the Abnahme.
  write(root, "docs/packages/p1/GATES.md", GATES_MD().replace("g1", "g2"));
  const changedCheck = codeStateKey(root, commit(root, "check"));
  assert(changedCheck.digest !== base.digest, "a changed CHECK did not change the key");
  write(root, "docs/packages/p1/GATES.md", GATES_MD());
  write(root, "docs/packages/p1/PACKAGE.md", PACKAGE_MD().replace("C1 -> GATES.md:G1: it works", "C1 -> GATES.md:G1: it works differently"));
  assert(codeStateKey(root, commit(root, "abnahme")).digest !== base.digest, "a changed Abnahme did not change the key");
  write(root, "docs/packages/p1/PACKAGE.md", PACKAGE_MD());

  // Code files.
  write(root, "src/a.txt", "two\n");
  assert(codeStateKey(root, commit(root, "code")).digest !== base.digest, "a changed code file did not change the key");
  write(root, "src/a.txt", "one\n");
  assert(codeStateKey(root, commit(root, "back")).digest === base.digest, "the same content did not give the same key again");
  // The mode counts.
  git(root, "update-index", "--chmod=+x", "scripts/check.cjs");
  assert(codeStateKey(root, commit(root, "mode")).digest !== base.digest, "a changed file mode did not change the key");
});

test("a scope narrows the code state to a subtree", () => {
  const root = repository("scope");
  write(root, "src/a.txt", "one\n");
  write(root, "notes/b.txt", "one\n");
  const first = commit(root, "first");
  write(root, "notes/b.txt", "two\n");
  const second = commit(root, "second");
  const narrow = { scope: ["src"] };
  assert(codeStateKey(root, first, narrow).digest === codeStateKey(root, second, narrow).digest, "a change outside the scope changed the key");
  assert(codeStateKey(root, first).digest !== codeStateKey(root, second).digest, "the whole repository ignored a change");
  assert(codeStateKey(root, first, narrow).fileCount === 1, "scope src should hold one file");
  let refused = false;
  try { codeStateKey(root, first, { scope: ["../other"] }); } catch { refused = true; }
  assert(refused, "a scope outside the repository was accepted");
});

test("one normalization: the contract path and text rules are those of the proof store", () => {
  assert(packageContractPath("docs/packages/p/GATES.md") && packageContractPath("docs/packages/p/gates/leaf-a.md") &&
    packageContractPath("docs/packages/p/OWNER.md") && !packageContractPath("docs/packages/p/evidence/x.md") &&
    !packageContractPath("docs/other/GATES.md"), "packageContractPath");
  const normalized = normalizePackageContractContent("docs/packages/p/PACKAGE.md", PACKAGE_MD("[x]", "s", "a")).toString("utf8");
  assert(normalized.includes("1. [ ] first step") && normalized.includes("<runtime-status>") && normalized.includes("<runtime-abschluss>"),
    "PACKAGE.md normalization: " + normalized);
  const gates = normalizePackageContractContent("docs/packages/p/GATES.md", GATES_MD("[x]", "something")).toString("utf8");
  assert(gates.includes("- [ ] G1") && gates.includes("EVIDENCE: <runtime-evidence>") && !gates.includes("something"), "GATES.md normalization: " + gates);
});

// ---- the key of a result --------------------------------------------------------

test("the proof key changes with command, EXPECT, CWD, shell, Node, lockfile, checker and scope; not with the repository path", () => {
  const origin = repository("key-origin");
  write(origin, "scripts/check.cjs", "console.log('RESULT_OK');\n");
  write(origin, "package-lock.json", "{\"lockfileVersion\":3}\n");
  write(origin, "vendor/unlazy/scripts/gate-check.mjs", "// checker\n");
  write(origin, "vendor/unlazy/scripts/lib/a.mjs", "export const a = 1;\n");
  const sha = commit(origin);
  const gate = { check: "node scripts/check.cjs", expect: "RESULT_OK", cwd: ".", shell: "win32:cmd.exe" };
  const base = proofKeyFor(origin, sha, gate);
  assert(/^[0-9a-f]{64}$/.test(base.key), "key shape");
  assert(base.checker.source === "commit" && base.checker.fileCount === 2, "the checker version should come from the commit: " + JSON.stringify(base.checker));
  assert(base.lockfiles.length === 1 && base.lockfiles[0].path === "package-lock.json", "lockfiles: " + JSON.stringify(base.lockfiles));
  const keyOf = (changes, parts = {}) => proofKey({
    codeState: base.codeState, check: gate.check, expect: gate.expect, cwd: gate.cwd, shell: gate.shell,
    lockfiles: base.lockfiles, checkerVersion: base.checker, ...parts, ...changes,
  });
  assert(keyOf({}) === base.key, "proofKey is not what proofKeyFor computed");
  const others = {
    command: keyOf({ check: "node scripts/check.cjs --other" }),
    expect: keyOf({ expect: "RESULT_OK " }),
    cwd: keyOf({ cwd: "scripts" }),
    shell: keyOf({ shell: "win32:powershell.exe" }),
    node: keyOf({ nodeVersion: "v0.0.1" }),
    lockfile: keyOf({ lockfiles: [{ path: "package-lock.json", blob: "0".repeat(40) }] }),
    checker: keyOf({ checkerVersion: "deadbeef" }),
    code: keyOf({ codeState: { ...base.codeState, digest: "f".repeat(64) } }),
    scope: keyOf({ codeState: { ...base.codeState, scope: ["scripts"] } }),
  };
  for (const [name, value] of Object.entries(others)) {
    assert(value !== base.key, "the key does not depend on the " + name);
  }
  assert(new Set(Object.values(others)).size === Object.keys(others).length, "two different changes gave the same key");

  // A changed lockfile and a changed checker file, as Git objects.
  write(origin, "package-lock.json", "{\"lockfileVersion\":2}\n");
  const lockChanged = commit(origin, "lock");
  assert(proofKeyFor(origin, lockChanged, gate).key !== base.key, "a changed lockfile did not change the key");
  assert(lockfileBlobs(origin, lockChanged)[0].blob !== base.lockfiles[0].blob, "lockfile blob unchanged");
  write(origin, "package-lock.json", "{\"lockfileVersion\":3}\n");
  write(origin, "vendor/unlazy/scripts/lib/a.mjs", "export const a = 2;\n");
  const checkerChanged = commit(origin, "checker");
  assert(checkerVersion(origin, checkerChanged).digest !== checkerVersion(origin, sha).digest, "a changed checker file did not change its version");
  assert(proofKeyFor(origin, checkerChanged, gate).key !== base.key, "a changed checker did not change the key");

  // Another absolute path of the same code: the same key.
  const clone = join(suiteRoot, "key-clone");
  git(suiteRoot, "clone", "--quiet", origin, clone);
  assert(proofKeyFor(clone, sha, gate).key === base.key, "the key depends on the absolute path of the repository");
});

test("cacheable: CACHE: no, models, network and installs are never cacheable; the CACHE line parses", () => {
  assert(cacheable({ check: "node scripts/check.cjs", cache: null }), "a plain gate should be cacheable");
  assert(!cacheable({ check: "node scripts/check.cjs", cache: "no" }) && !cacheable({ check: "x", cache: "NO" }), "CACHE: no");
  for (const command of [
    "node test/claude-fanout-e2e.test.js", "node --test test/codex-plugin-e2e.test.js", "node checks/codex-runtime-smoke.mjs",
    "npm ci", "npm install --no-save", "curl https://example.invalid", "gh pr view 1", "node run.mjs --live", "KEEL_LIVE=1 node run.mjs",
  ]) assert(!cacheable({ check: command }), command + " must not be cacheable");
  assert(!cacheable({ check: "" }) && !cacheable(null), "an empty gate is not cacheable");

  const doc = parseGates("- [ ] G1: a\n  CHECK: node a.mjs\n  EXPECT: OK\n  CACHE: no\n  EVIDENCE: pending\n- [ ] G2: b\n  CHECK: node b.mjs\n  EXPECT: OK\n  EVIDENCE: pending\n");
  assert(!doc.errors.length, "CACHE line errors: " + doc.errors.join("; "));
  assert(doc.gates[0].cache === "no" && doc.gates[1].cache === null, "CACHE not read: " + JSON.stringify(doc.gates.map((g) => g.cache)));
  assert(!cacheable(doc.gates[0]) && cacheable(doc.gates[1]), "cacheable on parsed gates");
  const bad = parseGates("- [ ] G1: a\n  CHECK: node a.mjs\n  EXPECT: OK\n  CACHE: yes\n  EVIDENCE: pending\n");
  assert(bad.errors.some((error) => /CACHE accepts only "no"/.test(error)), "CACHE: yes accepted: " + bad.errors.join("; "));
  const twice = parseGates("- [ ] G1: a\n  CHECK: node a.mjs\n  EXPECT: OK\n  CACHE: no\n  CACHE: no\n  EVIDENCE: pending\n");
  assert(twice.errors.some((error) => /duplicate CACHE/.test(error)), "a second CACHE line was accepted");
});

// ---- the store ------------------------------------------------------------------

test("proof notes: red is never written, entries merge, the same key is replaced, forged notes are ignored", () => {
  const root = repository("store");
  write(root, "a.txt", "1\n");
  const first = commit(root, "first");
  const writer = plainNoteWriter(root);
  const k1 = "1".repeat(64);
  const k2 = "2".repeat(64);
  const k3 = "3".repeat(64);
  assert(readProofs(root, first).length === 0, "a commit without a note has proofs");
  assert(writeProof(root, first, entryFor(k1, { result: "red" }), { noteWriter: writer }).written === 0, "red was written");
  assert(readProofs(root, first).length === 0, "red reached the note");
  assert(writeProof(root, first, entryFor(k1), {}).written === 0 && readProofs(root, first).length === 0, "something was written without a noteWriter");
  assert(writeProof(root, first, { ...entryFor(k1), outputSha256: undefined }, { noteWriter: writer }).written === 0, "an invalid entry was written");
  assert(writeProof(root, first, entryFor(k1), { noteWriter: writer }).written === 1, "green not written");
  assert(writeProof(root, first, entryFor(k2), { noteWriter: writer }).written === 1, "second entry not written");
  assert(readProofs(root, first).map((e) => e.key).join() === [k1, k2].join(), "entries were not merged");
  writeProof(root, first, entryFor(k1, { outputBytes: 99 }), { noteWriter: writer });
  const merged = readProofs(root, first);
  assert(merged.length === 2 && merged.find((e) => e.key === k1).outputBytes === 99, "the same key was not replaced");
  // The note is one compact keel-proof.v2-entry per line.
  const rawLines = git(root, "notes", "--ref", "keel-proof", "show", first).split(/\r?\n/u);
  assert(rawLines.length === 2 && rawLines.every((line) => JSON.parse(line).schema === "keel-proof.v2-entry"), "note form: " + rawLines.join(" | "));

  // A note of a writer that failed is reported, nothing is half written.
  const failing = writeProof(root, first, entryFor(k3), { noteWriter: () => { throw new Error("intent refused"); } });
  assert(failing.written === 0 && /intent refused/.test(failing.error) && readProofs(root, first).length === 2, "a failing writer changed the note");

  // Nothing but a keel-proof.v1 note with a green entry is believed.
  const second = (write(root, "a.txt", "2\n"), commit(root, "second"));
  write(root, "forged.json", JSON.stringify({ schema: "other", entries: [entryFor(k3)] }));
  git(root, "notes", "--ref", "keel-proof", "add", "-f", "-F", join(root, "forged.json"), second);
  assert(readProofs(root, second).length === 0 && !findProof(root, second, k3), "a note of another schema was believed");
  write(root, "red.json", JSON.stringify({ schema: "keel-proof.v1", entries: [entryFor(k3, { result: "red" })] }));
  git(root, "notes", "--ref", "keel-proof", "add", "-f", "-F", join(root, "red.json"), second);
  assert(!findProof(root, second, k3), "a red entry was found as a proof");
});

test("findProof: one search over the first-parent ancestors, the nearest entry wins", () => {
  const root = repository("find");
  write(root, "a.txt", "1\n");
  const c1 = commit(root, "c1");
  const c2 = (write(root, "b.txt", "1\n"), commit(root, "c2"));
  const c3 = (write(root, "c.txt", "1\n"), commit(root, "c3"));
  const key = "a".repeat(64);
  const writer = plainNoteWriter(root);
  writeProof(root, c1, entryFor(key, { outputBytes: 1 }), { noteWriter: writer });
  const found = findProof(root, c3, key);
  assert(found && found.commit === c1 && found.entry.outputBytes === 1, "the proof of an ancestor was not found: " + JSON.stringify(found));
  writeProof(root, c2, entryFor(key, { outputBytes: 2 }), { noteWriter: writer });
  const nearer = findProof(root, c3, key);
  assert(nearer && nearer.commit === c2 && nearer.entry.outputBytes === 2, "the nearest proof did not win (the cache must follow writes)");
  assert(findProof(root, c1, key).commit === c1, "an older commit found a later proof");
  assert(!findProof(root, c3, "b".repeat(64)), "an unknown key was found");
});

// ---- the clean copy -------------------------------------------------------------

function nodeModulesRepository(name, { crlf = false } = {}) {
  const root = repository(name);
  write(root, "package-lock.json", "{\"lockfileVersion\":3}\n");
  write(root, "src/a.txt", "one\n");
  const sha = commit(root);
  write(root, ".gitignore", "node_modules/\n");
  mkdirSync(join(root, "node_modules", "dep"), { recursive: true });
  writeFileSync(join(root, "node_modules", "dep", "index.js"), "module.exports = 1;\n");
  write(root, ".gitignore", "node_modules/\n");
  return { root, sha: commit(root), first: sha, crlf };
}

test("withCleanCheckout: a clean copy with the real node_modules linked, removed afterwards without touching them", async () => {
  const { root, sha } = nodeModulesRepository("checkout");
  write(root, "src/a.txt", "dirty working copy\n");
  write(root, "untracked.txt", "untracked\n");
  let seen = null;
  await withCleanCheckout(root, sha, async (directory) => {
    seen = {
      directory,
      a: readFileSync(join(directory, "src", "a.txt"), "utf8"),
      untracked: existsSync(join(directory, "untracked.txt")),
      linked: lstatSync(join(directory, "node_modules")).isSymbolicLink(),
      dep: readFileSync(join(directory, "node_modules", "dep", "index.js"), "utf8"),
    };
  });
  assert(seen.a === "one\n" && !seen.untracked, "the copy is not clean: " + JSON.stringify(seen));
  assert(seen.linked && seen.dep.includes("module.exports"), "node_modules was not linked into the copy");
  assert(!existsSync(seen.directory), "the clean copy is still there");
  assert(readFileSync(join(root, "node_modules", "dep", "index.js"), "utf8") === "module.exports = 1;\n", "the real node_modules was damaged");
  assert(readdirSync(join(root, "node_modules")).join() === "dep", "the real node_modules lost content");
  assert(git(root, "worktree", "list", "--porcelain").split("\n").filter((line) => line.startsWith("worktree ")).length === 1, "a worktree is left");
  assert(readFileSync(join(root, "src", "a.txt"), "utf8") === "dirty working copy\n", "the working copy was touched");
});

test("withCleanCheckout: a folder linkFolder refuses gets no link, a real install there is removed with the copy", async () => {
  const { root, sha } = nodeModulesRepository("checkout-real-install");
  const asked = [];
  let seen = null;
  await withCleanCheckout(root, sha, async (directory) => {
    seen = { directory, present: existsSync(join(directory, "node_modules")) };
    // what the caller installs for real (npm ci in the test matrix) is a plain folder of the copy
    mkdirSync(join(directory, "node_modules", "dep"), { recursive: true });
    writeFileSync(join(directory, "node_modules", "dep", "index.js"), "module.exports = 2;\n");
  }, { linkFolder: (folder) => { asked.push(folder); return folder !== ""; } });
  assert(JSON.stringify(asked) === '[""]', "linkFolder was asked for the repository-relative folder: " + JSON.stringify(asked));
  assert(seen.present === false, "node_modules was linked although linkFolder refused the folder");
  assert(!existsSync(seen.directory), "the clean copy with a real install is still there");
  assert(readFileSync(join(root, "node_modules", "dep", "index.js"), "utf8") === "module.exports = 1;\n", "the real node_modules was touched");
});

test("withCleanCheckout: also removed (junction first) when the callback throws; no link without an equal lockfile", async () => {
  const { root, sha } = nodeModulesRepository("checkout-throw");
  let directory = null;
  let thrown = null;
  try {
    await withCleanCheckout(root, sha, async (dir) => { directory = dir; throw new Error("boom"); });
  } catch (error) { thrown = error; }
  assert(thrown && thrown.message === "boom", "the error of the callback was not passed on");
  assert(directory && !existsSync(directory), "the copy is still there after an error");
  assert(readFileSync(join(root, "node_modules", "dep", "index.js"), "utf8") === "module.exports = 1;\n", "node_modules damaged after an error");
  assert(!git(root, "worktree", "list").split("\n").some((line) => line.includes("keel-proof")), "a worktree is registered after an error");

  // The lockfile of the working copy is not the one of the commit: no link, the copy stays without node_modules.
  write(root, "package-lock.json", "{\"lockfileVersion\":2}\n");
  let linked = null;
  await withCleanCheckout(root, sha, async (dir) => { linked = existsSync(join(dir, "node_modules")); });
  assert(linked === false, "node_modules was linked although the lockfile differs");
  assert(readFileSync(join(root, "node_modules", "dep", "index.js"), "utf8") === "module.exports = 1;\n", "node_modules damaged");
});

test("withCleanCheckout: the lockfile is recognized in a checkout with CRLF line endings", async () => {
  const origin = repository("checkout-crlf-origin");
  write(origin, "package-lock.json", "{\n  \"lockfileVersion\": 3\n}\n");
  write(origin, ".gitignore", "node_modules/\n");
  const sha = commit(origin);
  const clone = join(suiteRoot, "checkout-crlf-clone");
  git(suiteRoot, "clone", "--quiet", "-c", "core.autocrlf=true", origin, clone);
  assert(readFileSync(join(clone, "package-lock.json"), "utf8").includes("\r\n"), "setup: the clone has no CRLF");
  mkdirSync(join(clone, "node_modules", "dep"), { recursive: true });
  writeFileSync(join(clone, "node_modules", "dep", "index.js"), "1\n");
  let linked = null;
  await withCleanCheckout(clone, sha, async (dir) => { linked = existsSync(join(dir, "node_modules", "dep", "index.js")); });
  assert(linked === true, "a lockfile with CRLF on disk was not matched to its object id");
  assert(existsSync(join(clone, "node_modules", "dep", "index.js")), "node_modules damaged");
});

// ---- gate-check --at ------------------------------------------------------------

function sandbox(name) {
  const dir = join(suiteRoot, name + "-" + (++counter));
  mkdirSync(dir, { recursive: true });
  const approvals = join(dir, "approvals");
  mkdirSync(approvals);
  if (WINDOWS) hardenWindowsPrivateDirectory(approvals);
  return { dir, approvals, probe: join(dir, "probe.log") };
}

function gate(args, repo, box, env = {}, script = GATE_CHECK, timeout = 0) {
  return new Promise((done) => {
    execFile(process.execPath, [script, ...args], {
      cwd: repo, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout,
      env: { ...process.env, UNLAZY_APPROVAL_DIR: box.approvals, UNLAZY_PACKAGE: "", UNLAZY_SCOPE: "", PROBE_LOG: box.probe, ...env },
    }, (error, stdout, stderr) => {
      done({ code: error ? (typeof error.code === "number" ? error.code : 1) : 0, out: stdout + stderr });
    });
  });
}

const probeLines = (box) => (existsSync(box.probe) ? readFileSync(box.probe, "utf8").split("\n").filter(Boolean) : []);
const ran = (box, id) => probeLines(box).filter((line) => line === id).length;

const CHECK_SCRIPT = `const fs = require("fs");
const id = process.argv[2] || "g";
fs.appendFileSync(process.env.PROBE_LOG, id + "\\n");
if (id === "red") { console.log("RESULT_BAD"); process.exit(1); }
if (id === "marker") { console.log(fs.existsSync("marker.txt") ? "RESULT_OK" : "RESULT_NO_MARKER"); }
else if (id === "data") { console.log("RESULT_" + fs.readFileSync("data.txt", "utf8").trim()); }
else console.log("RESULT_OK");
`;

function ledger(gates) {
  return gates.map((g) => `- [ ] ${g.id}: ${g.title || g.id}
  CHECK: ${g.check}
  EXPECT: ${g.expect || "RESULT_OK"}
${g.cwd ? `  CWD: ${g.cwd}\n` : ""}${g.cache ? `  CACHE: ${g.cache}\n` : ""}  EVIDENCE: pending
`).join("");
}

function packageRepository(name, gates) {
  const box = sandbox(name);
  const repo = join(box.dir, "repo");
  initRepository(repo);
  git(repo, "config", "core.autocrlf", "false");
  write(repo, "scripts/check.cjs", CHECK_SCRIPT);
  write(repo, "src/lib.txt", "one\n");
  write(repo, "notes/other.txt", "one\n");
  write(repo, "docs/packages/p1/PACKAGE.md", "# Work package: p1\n");
  write(repo, "docs/packages/p1/GATES.md", ledger(gates));
  return { box, repo, ledgerFile: join(repo, "docs", "packages", "p1", "GATES.md"), sha: commit(repo) };
}

const atArgs = (repo, ...extra) => ["--root", repo, "--package", "p1", "--approve", ...extra];
// The entries of a note, read by the suite itself (both forms), so it does not trust the reader under test.
function noteText(text) {
  try {
    const whole = JSON.parse(text);
    if (whole && whole.schema === "keel-proof.v1") return whole.entries || [];
  } catch { /* lines */ }
  return String(text).split(/\r?\n/).filter((line) => line.trim()).map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter((entry) => entry && entry.schema === "keel-proof.v2-entry");
}

const noteEntries = (repo, sha) => {
  const result = spawnSync("git", ["-C", repo, "notes", "--ref", "keel-proof", "show", sha], { encoding: "utf8", windowsHide: true });
  return result.status === 0 ? noteText(result.stdout) : [];
};

test("--at: a second run on the same commit and one on a later commit outside the subtree reuse the result; a code change runs again", async () => {
  const { box, repo, sha } = packageRepository("reuse", [{ id: "G1", check: "node scripts/check.cjs g1" }]);
  const tree = ["--tree", "scripts,src"];
  const first = await gate(atArgs(repo, "--at", sha, ...tree), repo, box);
  assert(first.code === 0 && first.out.includes("PROOF_STORED") && !first.out.includes("PROOF_REUSED"), "first run\n" + first.out);
  assert(ran(box, "g1") === 1, "the check did not run once");
  assert(noteEntries(repo, sha).length === 1, "no proof was stored on the commit");
  assert(!existsSync(join(repo, "marker.txt")), "setup");

  const second = await gate([...atArgs(repo, "--at", sha, ...tree), "--reverify"], repo, box);
  assert(second.code === 0 && second.out.includes("PROOF_REUSED"), "second run on the same commit did not reuse\n" + second.out);
  assert(ran(box, "g1") === 1, "the check ran again although a proof exists");
  assert(/PROOF_REUSED [0-9a-f]{16} /.test(second.out), "the message names no key prefix\n" + second.out);

  // Later commit, only a file outside the subtree changes.
  write(repo, "notes/other.txt", "two\n");
  const later = commit(repo, "outside the subtree");
  const third = await gate([...atArgs(repo, "--at", later, ...tree), "--reverify"], repo, box);
  assert(third.code === 0 && third.out.includes("PROOF_REUSED") && third.out.includes(sha.slice(0, 8)), "later commit did not reuse the earlier proof\n" + third.out);
  assert(ran(box, "g1") === 1, "the check ran on the later commit although the subtree did not change");
  assert(noteEntries(repo, later).length === 0, "a reused result was stored again");

  // The whole repository is the default subtree: the same change is a change there.
  const whole = await gate([...atArgs(repo, "--at", later), "--reverify"], repo, box);
  assert(whole.code === 0 && !whole.out.includes("PROOF_REUSED") && ran(box, "g1") === 2, "the default subtree is not the whole repository\n" + whole.out);

  // A change inside the subtree runs the check again and stores a new proof.
  write(repo, "src/lib.txt", "two\n");
  const changed = commit(repo, "inside the subtree");
  const fourth = await gate([...atArgs(repo, "--at", changed, ...tree), "--reverify"], repo, box);
  assert(fourth.code === 0 && !fourth.out.includes("PROOF_REUSED") && fourth.out.includes("PROOF_STORED"), "a code change did not run again\n" + fourth.out);
  assert(ran(box, "g1") === 3, "the check did not run after the code change");
  assert(noteEntries(repo, changed).length === 1, "the new proof was not stored");
  const fifth = await gate([...atArgs(repo, "--at", changed, ...tree), "--reverify"], repo, box);
  assert(fifth.out.includes("PROOF_REUSED") && ran(box, "g1") === 3, "the new proof was not reused\n" + fifth.out);
});

test("--at never stores red, CACHE: no, nor a model, network or install command", async () => {
  const { box, repo, sha } = packageRepository("never", [
    { id: "G1", check: "node scripts/check.cjs g1" },
    { id: "G2", check: "node scripts/check.cjs red", expect: "RESULT_BAD" },
    { id: "G3", check: "node scripts/check.cjs nocache", cache: "no" },
    { id: "G4", check: "node scripts/check.cjs live --live" },
    { id: "G5", check: "node scripts/check.cjs smoke codex-runtime-smoke" },
    { id: "G6", check: "node scripts/check.cjs install npm install" },
  ]);
  // G2 matches EXPECT but exits 1: red.
  const first = await gate(atArgs(repo, "--at", sha), repo, box);
  assert(first.code === 1, "the red gate should leave the run unmet\n" + first.out);
  const stored = noteEntries(repo, sha);
  assert(stored.length === 1 && stored[0].gate.id === "G1", "only the green, cacheable gate may be stored: " + JSON.stringify(stored.map((e) => e.gate)));
  const second = await gate([...atArgs(repo, "--at", sha), "--reverify"], repo, box);
  assert(ran(box, "g1") === 1, "the stored result was not reused");
  for (const id of ["red", "nocache", "live", "smoke", "install"]) {
    assert(ran(box, id) === 2, id + " should run again every time, it ran " + ran(box, id) + " time(s)\n" + second.out);
  }
  assert(noteEntries(repo, sha).length === 1, "a second run stored something it must not store");
  // A gate marked CACHE: no later does not reuse an entry that exists for its key.
  write(repo, "docs/packages/p1/GATES.md", ledger([{ id: "G1", check: "node scripts/check.cjs g1", cache: "no" }]));
  const later = commit(repo, "g1 is marked CACHE: no");
  const marked = await gate(atArgs(repo, "--at", later), repo, box);
  assert(!marked.out.includes("PROOF_REUSED") && ran(box, "g1") === 2, "a CACHE: no gate reused a stored result\n" + marked.out);
});

test("--at does not see uncommitted changes of the working copy", async () => {
  const { box, repo, sha } = packageRepository("clean", [
    { id: "G1", check: "node scripts/check.cjs marker", expect: "RESULT_OK" },
    { id: "G2", check: "node scripts/check.cjs data", expect: "RESULT_committed" },
  ]);
  write(repo, "data.txt", "committed\n");
  const withData = commit(repo, "data");
  write(repo, "marker.txt", "untracked\n");
  write(repo, "data.txt", "dirty\n");
  const dirty = await gate(atArgs(repo, "--at", withData), repo, box);
  assert(dirty.code === 1 && dirty.out.includes("FAIL") && dirty.out.includes("G1") && dirty.out.includes("RESULT_NO_MARKER"),
    "the untracked file was seen in the clean copy\n" + dirty.out);
  assert(/PASS [^\n]*G2/.test(dirty.out), "the committed content was not seen (G2)\n" + dirty.out);
  assert(readFileSync(join(repo, "data.txt"), "utf8") === "dirty\n" && existsSync(join(repo, "marker.txt")), "the working copy was touched");
  // The same gate without --at sees the working copy.
  const plain = await gate(["--root", repo, "--package", "p1", "--approve", "--reverify"], repo, box);
  assert(plain.out.includes("PASS") && /PASS [^\n]*G1/.test(plain.out) && /FAIL [^\n]*G2/.test(plain.out), "the plain run does not see the working copy\n" + plain.out);
  assert(noteEntries(repo, withData).every((entry) => entry.gate.id !== "G1"), "a red result of the clean copy was stored");
  assert(!git(repo, "worktree", "list").split("\n").some((line) => line.includes("keel-proof")), "a clean copy is left behind");
  assert(sha !== withData, "setup");
});

test("--at without the Harness's git-intent next to the checker runs in the clean copy and stores nothing", async () => {
  const { box, repo, sha } = packageRepository("plain", [{ id: "G1", check: "node scripts/check.cjs g1" }]);
  const bare = join(box.dir, "bare-unlazy", "scripts");
  mkdirSync(bare, { recursive: true });
  copyFileSync(GATE_CHECK, join(bare, "gate-check.mjs"));
  cpSync(join(SCRIPTS, "lib"), join(bare, "lib"), { recursive: true });
  const args = atArgs(repo, "--at", sha);
  const first = await gate(args, repo, box, {}, join(bare, "gate-check.mjs"));
  assert(first.code === 0 && first.out.includes("PASS") && /not stored/.test(first.out), "plain Unlazy run\n" + first.out);
  assert(noteEntries(repo, sha).length === 0, "plain Unlazy stored a result");
  const second = await gate([...args, "--reverify"], repo, box, {}, join(bare, "gate-check.mjs"));
  assert(!second.out.includes("PROOF_REUSED") && ran(box, "g1") === 2, "a result that was not stored was reused\n" + second.out);
});

test("B10: verifying twice leaves the package file byte-identical", async () => {
  const { box, repo, sha, ledgerFile } = packageRepository("b10", [{ id: "G1", check: "node scripts/check.cjs g1" }]);
  const first = await gate(atArgs(repo, "--at", sha), repo, box);
  assert(first.code === 0, first.out);
  const afterFirst = readFileSync(ledgerFile);
  const text = afterFirst.toString("utf8");
  assert(/- \[x\] G1/.test(text) && /proof=[0-9a-f]{16}@[0-9a-f]{8}/.test(text), "the evidence carries no proof key\n" + text);
  const outputHash = /output-sha256=([0-9a-f]{64})/.exec(text)[1];
  for (let round = 1; round <= 2; round++) {
    const again = await gate([...atArgs(repo, "--at", sha), "--reverify"], repo, box);
    assert(again.code === 0 && again.out.includes("PROOF_REUSED"), "round " + round + "\n" + again.out);
    assert(readFileSync(ledgerFile).equals(afterFirst), "round " + round + " wrote the package file again");
  }
  assert(ran(box, "g1") === 1, "the check ran again");
  // A different key is a reason to write again; the output hash alone is not.
  write(repo, "src/lib.txt", "two\n");
  const changed = commit(repo, "code");
  const third = await gate([...atArgs(repo, "--at", changed), "--reverify"], repo, box);
  assert(third.code === 0, third.out);
  const rewritten = readFileSync(ledgerFile, "utf8");
  assert(rewritten !== text && /proof=[0-9a-f]{16}@/.test(rewritten), "a changed key did not rewrite the evidence\n" + rewritten);
  assert(outputHash.length === 64, "setup");
});

test("approvals hold by the path in the repository: in a checkout elsewhere, and the old absolute approvals stay valid", async () => {
  const { box, repo } = packageRepository("approvals", [{ id: "G1", check: "node scripts/check.cjs g1" }]);
  const run = (cwd, ...extra) => gate(["--root", cwd, "--package", "p1", ...extra], cwd, box);
  const first = await run(repo, "--approve");
  assert(first.code === 0 && first.out.includes("APPROVED"), "first approval\n" + first.out);
  const tokens = () => readdirSync(box.approvals).filter((name) => name.endsWith(".json"));
  assert(tokens().length === 1, "expected one approval record");
  const record = JSON.parse(readFileSync(join(box.approvals, tokens()[0]), "utf8"));
  assert(record.oracle.schema === 3 && record.oracle.cwd === "." && record.ledger === "docs/packages/p1/GATES.md" && !("file" in record),
    "the record is not keyed by the repository path: " + JSON.stringify(record));

  // A checkout at another path: the ledger there is committed as pending, the approval still holds.
  const elsewhere = join(box.dir, "elsewhere", "deeper");
  git(box.dir, "clone", "--quiet", repo, elsewhere);
  const moved = await run(elsewhere);
  assert(moved.code === 0 && moved.out.includes("PASS") && !moved.out.includes("APPROVAL REQUIRED"), "the approval did not hold in another checkout\n" + moved.out);
  assert(tokens().length === 1, "a second approval record appeared");

  // Another command is not approved by it.
  write(elsewhere, "docs/packages/p1/GATES.md", ledger([{ id: "G1", check: "node scripts/check.cjs g1 other" }]));
  const other = await run(elsewhere);
  assert(other.code === 1 && other.out.includes("APPROVAL REQUIRED") && other.out.includes("NOT RUN"), "another command was approved\n" + other.out);

  // An approval made the old way (absolute ledger path and CWD, schema 2) still holds.
  rmSync(join(box.approvals, tokens()[0]));
  const real = realpathSync.native(repo);
  const ledgerPath = join(real, "docs", "packages", "p1", "GATES.md");
  const oldOracle = { ...record.oracle, schema: 2, cwd: real };
  const signature = sha256(JSON.stringify(oldOracle));
  const oldRecord = { schema: 1, file: ledgerPath, gate: "G1", signature, oracle: oldOracle, approvedAt: record.approvedAt };
  writeFileSync(join(box.approvals, sha256(ledgerPath + "\0G1\0" + signature) + ".json"), JSON.stringify(oldRecord, null, 2) + "\n", { mode: 0o600 });
  write(repo, "docs/packages/p1/GATES.md", ledger([{ id: "G1", check: "node scripts/check.cjs g1" }]));
  const old = await run(repo, "--reverify");
  assert(old.code === 0 && old.out.includes("PASS") && !old.out.includes("APPROVAL REQUIRED"), "the old absolute approval was lost\n" + old.out);
  assert(tokens().length === 1, "the old record must stay as it was, no new token");
});

test("A21: a tick and a proof= line in the text are no proof; only a note written through the Harness counts", async () => {
  const { box, repo, sha, ledgerFile } = packageRepository("forged", [{ id: "G1", check: "node scripts/check.cjs g1" }]);
  const first = await gate(atArgs(repo, "--at", sha), repo, box);
  assert(first.code === 0 && ran(box, "g1") === 1, first.out);
  const ticked = readFileSync(ledgerFile, "utf8");
  assert(/- \[x\] G1/.test(ticked) && /proof=[0-9a-f]{16}@/.test(ticked), "setup: the ledger carries tick and proof key");
  // The note goes away; tick and EVIDENCE with the very same key stay in the text.
  git(repo, "notes", "--ref", "keel-proof", "remove", sha);
  // Without --reverify too: --at never skips a gate because it is ticked.
  const again = await gate(atArgs(repo, "--at", sha), repo, box);
  assert(again.code === 0 && !again.out.includes("PROOF_REUSED") && ran(box, "g1") === 2, "text was taken for a proof\n" + again.out);
  assert(noteEntries(repo, sha).length === 1, "the new run did not store its own result");
  // A note someone put there with plain Git for another key is not the key of this gate either.
  write(repo, "note.json", JSON.stringify({ schema: "keel-proof.v1", entries: [entryFor("e".repeat(64))] }));
  git(repo, "notes", "--ref", "keel-proof", "add", "-f", "-F", join(repo, "note.json"), sha);
  const other = await gate([...atArgs(repo, "--at", sha), "--reverify"], repo, box);
  assert(!other.out.includes("PROOF_REUSED") && ran(box, "g1") === 3, "a foreign key was reused\n" + other.out);
});

test("--at needs a commit of a Git repository and is an execution option only", async () => {
  const { box, repo } = packageRepository("usage", [{ id: "G1", check: "node scripts/check.cjs g1" }]);
  const bad = await gate(atArgs(repo, "--at", "no-such-revision"), repo, box);
  assert(bad.code === 2 && /not a commit/.test(bad.out), "unknown revision\n" + bad.out);
  const status = await gate(["--root", repo, "--package", "p1", "--status", "--at", "HEAD"], repo, box);
  assert(status.code === 2 && /execution options only/.test(status.out), "--status with --at\n" + status.out);
  const tree = await gate(atArgs(repo, "--tree", "src"), repo, box);
  assert(tree.code === 2 && /--tree needs --at/.test(tree.out), "--tree without --at\n" + tree.out);
  const escaping = await gate(atArgs(repo, "--at", "HEAD", "--tree", "../elsewhere"), repo, box);
  assert(escaping.code === 2 && /relative to the repository/.test(escaping.out), "--tree outside the repository\n" + escaping.out);
  assert(ran(box, "g1") === 0, "a refused call ran a check");
});

// ---- review findings (second round) -----------------------------------------------

// A stand-in for the Harness's git-intent: writes the note with plain Git and records that it ran.
const INTENT_STUB = `import { appendFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const args = process.argv.slice(2);
const get = (name) => args[args.indexOf(name) + 1];
if (process.env.INTENT_PROBE) appendFileSync(process.env.INTENT_PROBE, "ran\\n");
const result = spawnSync("git", ["-C", get("--root"), "notes", "--ref", "keel-proof", "add", "-f", "-F", get("--file"), get("--commit")], { stdio: "inherit" });
process.exit(result.status === null ? 2 : result.status);
`;

// The checker of this suite copied into `repo` in the source layout, with a git-intent stub beside it.
function vendorChecker(repo) {
  const scripts = join(repo, "vendor", "unlazy", "scripts");
  mkdirSync(scripts, { recursive: true });
  copyFileSync(GATE_CHECK, join(scripts, "gate-check.mjs"));
  cpSync(join(SCRIPTS, "lib"), join(scripts, "lib"), { recursive: true });
  write(repo, "test-harness/harness-core/git/git-intent.mjs", INTENT_STUB);
  return join(scripts, "gate-check.mjs");
}

test("finding 1: a running checker that differs from the commit's (changed, not committed) neither stores nor reuses", async () => {
  const { box, repo } = packageRepository("checker-bytes", [{ id: "G1", check: "node scripts/check.cjs g1" }]);
  const checker = vendorChecker(repo);
  const sha = commit(repo, "vendored checker");
  const first = await gate(atArgs(repo, "--at", sha), repo, box, {}, checker);
  assert(first.code === 0 && first.out.includes("PROOF_STORED") && !first.out.includes("PROOF_NOT_CACHEABLE"),
    "the committed checker should store\n" + first.out);
  assert(noteEntries(repo, sha).length === 1, "setup: one proof stored");
  // The checker in the working copy changes and is not committed.
  writeFileSync(checker, readFileSync(checker, "utf8") + "\n// changed, not committed\n");
  const second = await gate([...atArgs(repo, "--at", sha), "--reverify"], repo, box, {}, checker);
  assert(second.code === 0 && !second.out.includes("PROOF_REUSED") && ran(box, "g1") === 2,
    "a changed checker reused the result of the committed one\n" + second.out);
  assert(/PROOF_NOT_CACHEABLE: the running checker/.test(second.out), "no visible message\n" + second.out);
  assert(!second.out.includes("PROOF_STORED") && noteEntries(repo, sha).length === 1, "a changed checker stored a result\n" + second.out);
  // Line endings alone are no change of the checker.
  writeFileSync(checker, readFileSync(join(SCRIPTS, "gate-check.mjs"), "utf8").replace(/\r?\n/g, "\r\n"));
  const crlf = await gate([...atArgs(repo, "--at", sha), "--reverify"], repo, box, {}, checker);
  assert(crlf.out.includes("PROOF_REUSED") && ran(box, "g1") === 2, "CRLF line endings changed the checker version\n" + crlf.out);
});

test("finding 2: node_modules with a workspace link into the working tree is not cacheable; links inside node_modules are", async () => {
  const { box, repo } = packageRepository("workspace", [{ id: "G1", check: "node scripts/check.cjs g1" }]);
  write(repo, "package-lock.json", "{\"lockfileVersion\":3}\n");
  write(repo, ".gitignore", "node_modules/\n");
  write(repo, "packages/ws/index.js", "module.exports = 'committed';\n");
  const sha = commit(repo, "workspace");
  mkdirSync(join(repo, "node_modules", ".pnpm", "dep"), { recursive: true });
  mkdirSync(join(repo, "node_modules", "@scope"), { recursive: true });
  const linkType = WINDOWS ? "junction" : "dir";
  symlinkSync(join(repo, "node_modules", ".pnpm", "dep"), join(repo, "node_modules", "dep"), linkType);
  symlinkSync(join(repo, "packages", "ws"), join(repo, "node_modules", "@scope", "ws"), linkType);
  const first = await gate(atArgs(repo, "--at", sha), repo, box);
  assert(first.code === 0 && /PROOF_NOT_CACHEABLE: node_modules links into the working tree/.test(first.out) &&
    first.out.includes("node_modules/@scope/ws"), "no visible message\n" + first.out);
  assert(!first.out.includes("PROOF_STORED") && noteEntries(repo, sha).length === 0, "a result with a workspace link was stored\n" + first.out);
  // A proof stored before (by a run without the link) is not reused while the link exists either.
  symlinkSync(join(repo, "packages", "ws"), join(repo, "node_modules", "ws-top"), linkType);
  const second = await gate([...atArgs(repo, "--at", sha), "--reverify"], repo, box);
  assert(!second.out.includes("PROOF_REUSED") && ran(box, "g1") === 2, "reused with a workspace link\n" + second.out);
  assert(readFileSync(join(repo, "packages", "ws", "index.js"), "utf8").includes("committed"), "the workspace was touched");
  assert(existsSync(join(repo, "node_modules", "@scope", "ws")), "the real link was removed");
  // The detection itself: the two links into packages/ count, the link into node_modules/.pnpm does not.
  const found = nodeModulesWorkspaceLinks(repo, sha).map((item) => item.link.replaceAll("\\", "/")).sort();
  assert(found.length === 2 && found[0].endsWith("node_modules/@scope/ws") && found[1].endsWith("node_modules/ws-top"),
    "workspace links: " + JSON.stringify(found));
});

test("a node_modules link onto the repository root itself or onto a folder above it is not cacheable either", async () => {
  const linkType = WINDOWS ? "junction" : "dir";
  // The repository root (a file:../.. dependency of a subfolder package): through it the clean
  // copy reads the whole uncommitted working copy.
  const rooted = packageRepository("workspace-root", [{ id: "G1", check: "node scripts/check.cjs g1" }]);
  write(rooted.repo, ".gitignore", "node_modules/\n");
  write(rooted.repo, "tools/sub/package-lock.json", "{\"lockfileVersion\":3}\n");
  const rootSha = commit(rooted.repo, "sub package");
  mkdirSync(join(rooted.repo, "tools", "sub", "node_modules"), { recursive: true });
  symlinkSync(rooted.repo, join(rooted.repo, "tools", "sub", "node_modules", "mylib"), linkType);
  const found = nodeModulesWorkspaceLinks(rooted.repo, rootSha).map((item) => item.link.replaceAll("\\", "/"));
  assert(found.length === 1 && found[0].endsWith("tools/sub/node_modules/mylib"), "root link not detected: " + JSON.stringify(found));
  const first = await gate(atArgs(rooted.repo, "--at", rootSha), rooted.repo, rooted.box);
  assert(first.code === 0 && /PROOF_NOT_CACHEABLE: node_modules links into the working tree/.test(first.out) &&
    first.out.includes("tools/sub/node_modules/mylib"), "no visible message for the root link\n" + first.out);
  assert(!first.out.includes("PROOF_STORED") && noteEntries(rooted.repo, rootSha).length === 0, "a result with a root link was stored\n" + first.out);
  assert(existsSync(join(rooted.repo, "tools", "sub", "node_modules", "mylib", "scripts", "check.cjs")), "the real link or the repository was touched");

  // A folder above the repository (it contains the repository): a proof stored before is not reused.
  const above = packageRepository("workspace-above", [{ id: "G1", check: "node scripts/check.cjs g1" }]);
  write(above.repo, ".gitignore", "node_modules/\n");
  write(above.repo, "tools/sub/package-lock.json", "{\"lockfileVersion\":3}\n");
  const aboveSha = commit(above.repo, "sub package");
  mkdirSync(join(above.repo, "tools", "sub", "node_modules"), { recursive: true });
  const stored = await gate(atArgs(above.repo, "--at", aboveSha), above.repo, above.box);
  assert(stored.out.includes("PROOF_STORED") || noteEntries(above.repo, aboveSha).length === 1, "setup: no proof stored\n" + stored.out);
  symlinkSync(above.box.dir, join(above.repo, "tools", "sub", "node_modules", "parent"), linkType);
  const ancestors = nodeModulesWorkspaceLinks(above.repo, aboveSha).map((item) => item.link.replaceAll("\\", "/"));
  assert(ancestors.length === 1 && ancestors[0].endsWith("tools/sub/node_modules/parent"), "ancestor link not detected: " + JSON.stringify(ancestors));
  const second = await gate([...atArgs(above.repo, "--at", aboveSha), "--reverify"], above.repo, above.box);
  assert(/PROOF_NOT_CACHEABLE: node_modules links into the working tree/.test(second.out) && !second.out.includes("PROOF_REUSED") &&
    ran(above.box, "g1") === 2, "reused with an ancestor link\n" + second.out);
  assert(noteEntries(above.repo, aboveSha).length === 1, "a result with an ancestor link was stored");
});

test("finding 3: a --tree entry that names nothing in the commit (also by case) is a usage error; an empty code state is never a key", async () => {
  const { box, repo, sha } = packageRepository("tree-nothing", [{ id: "G1", check: "node scripts/check.cjs g1" }]);
  for (const tree of ["nothing", "SRC", "src,nothing"]) {
    const result = await gate(atArgs(repo, "--at", sha, "--tree", tree), repo, box);
    assert(result.code === 2 && /matches nothing/.test(result.out), "--tree " + tree + " was accepted\n" + result.out);
  }
  assert(ran(box, "g1") === 0 && noteEntries(repo, sha).length === 0, "a refused --tree ran or stored");
  let refused = false;
  try { codeStateKey(repo, sha, { scope: ["nothing"] }); } catch { refused = true; }
  assert(refused, "codeStateKey accepted a scope with no file");
  assert(codeStateKey(repo, sha, { scope: ["src"] }).fileCount === 1, "the exact spelling must still work");
});

test("finding 4: notes of two sides on the same commit, merged with cat_sort_uniq, keep every entry readable", () => {
  const root = repository("notes-merge");
  write(root, "a.txt", "1\n");
  const sha = commit(root, "c");
  const writer = plainNoteWriter(root);
  const k1 = "1".repeat(64);
  const k2 = "2".repeat(64);
  const k3 = "3".repeat(64);
  // Side one.
  assert(writeProof(root, sha, [entryFor(k1), entryFor(k3)], { noteWriter: writer }).written === 2, "side one not written");
  git(root, "update-ref", "refs/notes/side-one", "refs/notes/keel-proof");
  // Side two, written without knowing side one.
  git(root, "update-ref", "-d", "refs/notes/keel-proof");
  assert(readProofs(root, sha).length === 0, "setup: side two starts empty");
  assert(writeProof(root, sha, entryFor(k2, { outputBytes: 2 }), { noteWriter: writer }).written === 1, "side two not written");
  git(root, "notes", "--ref", "keel-proof", "merge", "-s", "cat_sort_uniq", "refs/notes/side-one");
  const merged = readProofs(root, sha);
  assert(merged.map((entry) => entry.key).sort().join() === [k1, k2, k3].join(), "an entry was lost in the merge: " + JSON.stringify(merged));
  for (const key of [k1, k2, k3]) assert(findProof(root, sha, key), "findProof misses " + key.slice(0, 4) + " after the merge");
  // Writing again after the merge keeps all entries.
  writeProof(root, sha, entryFor(k3, { outputBytes: 33 }), { noteWriter: writer });
  const again = readProofs(root, sha);
  assert(again.length === 3 && again.find((entry) => entry.key === k3).outputBytes === 33, "a write after the merge lost or kept stale entries");
  // The old form (one JSON document) is still read; an invalid line is ignored.
  assert(parseNoteText(JSON.stringify({ schema: "keel-proof.v1", entries: [entryFor(k1)] }, null, 2)).length === 1, "v1 not read");
  const mixed = JSON.stringify({ ...entryFor(k1), schema: "keel-proof.v2-entry" }) + "\nnot json\n" +
    JSON.stringify({ ...entryFor(k2), schema: "other" }) + "\n";
  assert(parseNoteText(mixed).map((entry) => entry.key).join() === k1, "invalid lines were not ignored");
});

test("finding 5: the ledger normalization is line-local, an empty EVIDENCE line does not swallow the next line", () => {
  const ledgerWith = (check) => "- [x] G1: works\n  EVIDENCE:\n  CHECK: " + check + "\n  EXPECT: OK\n";
  const one = normalizePackageContractContent("docs/packages/p/GATES.md", ledgerWith("node one.mjs")).toString("utf8");
  const two = normalizePackageContractContent("docs/packages/p/GATES.md", ledgerWith("node two.mjs")).toString("utf8");
  assert(one !== two && one.includes("CHECK: node one.mjs"), "an empty EVIDENCE line swallowed the CHECK line:\n" + one);
  assert(normalizeLedgerText(ledgerWith("x")) === "- [ ] G1: works\n  EVIDENCE: <runtime-evidence>\n  CHECK: x\n  EXPECT: OK\n",
    "normalizeLedgerText: " + JSON.stringify(normalizeLedgerText(ledgerWith("x"))));
  // In the code state as well.
  const root = repository("line-local");
  write(root, "docs/packages/p1/GATES.md", ledgerWith("node one.mjs"));
  const first = codeStateKey(root, commit(root, "one"));
  write(root, "docs/packages/p1/GATES.md", ledgerWith("node two.mjs"));
  assert(codeStateKey(root, commit(root, "two")).digest !== first.digest, "a changed CHECK after an empty EVIDENCE kept the key");
  // A PACKAGE.md step tick is line-local too.
  const step = normalizePackageContractContent("docs/packages/p/PACKAGE.md", "1.\n[x] not a step\n").toString("utf8");
  assert(step.includes("[x] not a step"), "a tick on the next line was taken for a step tick");
});

test("finding 6: --at outside a package run is refused", async () => {
  const { box, repo, sha } = packageRepository("at-explicit", [{ id: "G1", check: "node scripts/check.cjs g1" }]);
  write(repo, "ledgers/LOOSE.md", ledger([{ id: "G1", check: "node scripts/check.cjs g1" }]));
  const loose = commit(repo, "a ledger outside docs/packages");
  const result = await gate(["--root", repo, "--approve", "--at", loose, join(repo, "ledgers", "LOOSE.md")], repo, box, {}, GATE_CHECK, 120_000);
  assert(result.code === 2 && /--at works only in a package run/.test(result.out), "--at with an explicit ledger was accepted\n" + result.out);
  assert(ran(box, "g1") === 0 && noteEntries(repo, loose).length === 0 && sha !== loose, "a refused --at ran or stored");
});

test("finding 7: git-intent is looked for next to the checker only, never in the checked repository", async () => {
  const { box, repo } = packageRepository("foreign-intent", [{ id: "G1", check: "node scripts/check.cjs g1" }]);
  write(repo, "test-harness/harness-core/git/git-intent.mjs", INTENT_STUB);
  write(repo, "harness-core/git/git-intent.mjs", INTENT_STUB);
  const sha = commit(repo, "a repository that brings its own git-intent");
  const bare = join(box.dir, "plain-unlazy", "scripts");
  mkdirSync(bare, { recursive: true });
  copyFileSync(GATE_CHECK, join(bare, "gate-check.mjs"));
  cpSync(join(SCRIPTS, "lib"), join(bare, "lib"), { recursive: true });
  assert(locateGitIntent(repo, { checkerDir: bare }) === null, "plain Unlazy found the repository's git-intent");
  const intentProbe = join(box.dir, "intent.log");
  const result = await gate(atArgs(repo, "--at", sha), repo, box, { INTENT_PROBE: intentProbe }, join(bare, "gate-check.mjs"));
  assert(result.code === 0 && /not stored/.test(result.out), "plain Unlazy run\n" + result.out);
  assert(!existsSync(intentProbe), "the repository's git-intent was executed");
  assert(noteEntries(repo, sha).length === 0, "something was stored");
  // The source layout of this tree: the Harness's own git-intent beside vendor/unlazy.
  const own = locateGitIntent(repo, { checkerDir: SCRIPTS });
  assert(own === null || own === join(SCRIPTS, "..", "..", "..", "test-harness", "harness-core", "git", "git-intent.mjs"),
    "the source layout resolved elsewhere: " + own);
});

test("finding 8: one --at run makes exactly one clean copy for all its gates", async () => {
  const gates = [1, 2, 3, 4, 5].map((n) => ({ id: "G" + n, check: "node scripts/check.cjs g" + n }));
  const { box, repo, sha } = packageRepository("one-copy", gates);
  const trace = join(box.dir, "git-trace.log");
  const result = await gate(atArgs(repo, "--at", sha), repo, box, { GIT_TRACE: trace });
  assert(result.code === 0 && [1, 2, 3, 4, 5].every((n) => ran(box, "g" + n) === 1), "five gates should run once\n" + result.out);
  const adds = readFileSync(trace, "utf8").split(/\r?\n/).filter((line) => /built-in: git worktree add\b/.test(line));
  assert(adds.length === 1, "expected exactly one git worktree add, got " + adds.length + "\n" + adds.join("\n"));
  assert(!git(repo, "worktree", "list").split("\n").some((line) => line.includes("keel-proof")), "the clean copy is left behind");
});

let failed = 0;
for (const { name, fn } of tests) {
  try { await fn(); console.log("ok - " + name); }
  catch (error) { failed++; console.log("not ok - " + name + "\n" + (error && error.message ? error.message : error)); }
}
try { rmSync(suiteRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
catch { /* temporary directory; leave it to the OS */ }
emitTestCounts("proof-store-tests", { tests: tests.length, pass: tests.length - failed, fail: failed, skip: 0 });
if (failed) {
  console.log(failed + " of " + tests.length + " tests failed");
  process.exit(1);
}
console.log("PROOF_STORE_OK");
