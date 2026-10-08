// Check results per code state: the key of a result, its storage as a Git note,
// and the clean copy a result is produced in. Zero dependencies. Node 16+.
//
// A result is valid for exactly one code state. It is made in a clean copy of one
// commit (git worktree) and stored on that commit, as a note of ref keel-proof,
// only through the Harness's own Git interface (git-intent proof-note-write).
// Whoever finds the same key again does not run the check again.
//
// The normalization of package contract files (ticks, Status, Abschluss, EVIDENCE
// are runtime state, not code) lives in ledger-normalize.cjs (CommonJS, so git-intent
// can load it synchronously on any Node); this module re-exports it and
// test-harness/checks/audit-lib.mjs imports it from here, so there is one source.

import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync,
  rmdirSync, statSync, symlinkSync, unlinkSync, writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import ledgerNormalize from "./ledger-normalize.cjs";
import gitBinary from "./git-binary.cjs";

const {
  PROOF_SCHEMA, PROOF_ENTRY_SCHEMA,
  packageContractPath, replaceMarkdownSectionBody, normalizeLedgerText, normalizePackageContractContent,
} = ledgerNormalize;

export const PROOF_NOTES_REF = "keel-proof";
// The old note form (keel-proof.v1, one JSON document) is still read; written is only the line
// form (PROOF_ENTRY_SCHEMA). Both names live in ledger-normalize.cjs, which git-intent loads too.
export { PROOF_SCHEMA, PROOF_ENTRY_SCHEMA };
export const CODE_STATE_ALGORITHM = "git-tree-normalized-v1";
export const PROOF_KEY_SCHEMA = "keel-proof-key.v1";

// Not part of the code state, exactly as in test-harness/checks/audit-lib.mjs (a
// test asserts the two spellings stay equal).
export const reportRelative = "docs/packages/keel-harness-reference-completeness-repair/evidence/final-test-report.json";
export const lifecycleEvidenceRelative = "docs/packages/keel-harness-reference-completeness-repair/evidence/lifecycle-gates.json";

// The checker of a standard layout: this is what a proof depends on besides the code.
export const CHECKER_DIRECTORY = "vendor/unlazy/scripts";
export const CHECKER_ENTRY = "gate-check.mjs";
export const CHECKER_LIBRARY = "lib";

// A command that talks to a model, the network or the account is never stored.
const UNCACHEABLE_COMMAND_PATTERNS = Object.freeze([
  "claude-fanout-e2e", "codex-plugin-e2e", "codex-runtime-smoke",
  "npm ci", "npm install", "curl ", "gh ", "--live", "keel_live",
]);

export const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const posix = (value) => String(value).replaceAll("\\", "/");
const nativeRealpath = (value) => (realpathSync.native || realpathSync)(value);

// ---- package contract normalization (one source: ledger-normalize.cjs) ------

export {
  packageContractPath, replaceMarkdownSectionBody, normalizeLedgerText, normalizePackageContractContent,
};

// ---- Git ----------------------------------------------------------------------

function gitRun(repoRoot, args, options = {}) {
  return gitBinary.gitSync(["-C", repoRoot, ...args], {
    encoding: options.binary ? "buffer" : "utf8",
    input: options.input === undefined ? undefined : Buffer.from(options.input, "utf8"),
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
}

function gitOut(repoRoot, args, label) {
  const result = gitRun(repoRoot, args);
  if (result.error || result.status !== 0) {
    throw new Error("git " + (label || args[0]) + " failed" +
      (result.error ? ": " + result.error.message : ": " + String(result.stderr || result.stdout).trim()));
  }
  return String(result.stdout);
}

// The full commit id of a revision, or null.
export function resolveCommit(repoRoot, revision) {
  const result = gitRun(repoRoot, ["rev-parse", "--verify", "--quiet", String(revision) + "^{commit}"]);
  if (result.error || result.status !== 0) return null;
  const id = String(result.stdout).trim();
  return /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(id) ? id : null;
}

// The top directory of the working tree that holds `directory`, or null.
export function gitTopLevel(directory) {
  const result = gitRun(directory, ["rev-parse", "--show-toplevel"]);
  if (result.error || result.status !== 0) return null;
  const top = String(result.stdout).trim();
  return top ? resolve(top) : null;
}

// ---- code state ---------------------------------------------------------------

function normalizeScope(scope) {
  const list = (Array.isArray(scope) ? scope : [scope]).map((item) => {
    let value = posix(item === undefined || item === null ? "." : item).trim();
    value = value.replace(/^(?:\.\/)+/u, "").replace(/\/+$/u, "");
    return value === "" ? "." : value;
  });
  for (const item of list) {
    if (isAbsolute(item) || /^[A-Za-z]:/u.test(item) || item.split("/").includes("..") || item.includes("\0")) {
      throw new Error("code-state scope must be relative to the repository: " + item);
    }
  }
  if (list.includes(".") || list.length === 0) return ["."];
  return [...new Set(list)].sort();
}

const treeMemo = new Map();

// [{ path, mode, kind, id }] of a commit, from Git objects (never the working tree).
export function treeEntries(repoRoot, commit, scope = ["."]) {
  const paths = normalizeScope(scope);
  const memoKey = resolve(repoRoot) + "\0" + commit + "\0" + paths.join("\n");
  const known = treeMemo.get(memoKey);
  if (known) return known;
  const args = ["ls-tree", "-r", "-z", "--full-tree", commit];
  if (!(paths.length === 1 && paths[0] === ".")) args.push("--", ...paths);
  const text = gitOut(repoRoot, args, "ls-tree");
  const entries = [];
  for (const record of text.split("\0")) {
    if (!record) continue;
    const tab = record.indexOf("\t");
    const head = record.slice(0, tab).split(" ");
    if (tab < 0 || head.length !== 3) throw new Error("unreadable git ls-tree record: " + JSON.stringify(record));
    entries.push({ path: record.slice(tab + 1), mode: head[0], kind: head[1], id: head[2] });
  }
  // Git may match a pathspec without regard to case (core.ignorecase); a scope names its
  // subtree exactly, so only paths below the exact spelling count.
  if (!(paths.length === 1 && paths[0] === ".")) {
    const exact = entries.filter((entry) => paths.some((item) => entry.path === item || entry.path.startsWith(item + "/")));
    entries.length = 0;
    entries.push(...exact);
  }
  entries.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  Object.freeze(entries);
  treeMemo.set(memoKey, entries);
  return entries;
}

// Contents of Git blobs in one call (git cat-file --batch).
function readBlobs(repoRoot, ids) {
  const wanted = [...new Set(ids)];
  const contents = new Map();
  if (!wanted.length) return contents;
  const result = gitRun(repoRoot, ["cat-file", "--batch"], { binary: true, input: wanted.join("\n") + "\n" });
  if (result.error || result.status !== 0) {
    throw new Error("git cat-file failed: " + String(result.stderr || (result.error && result.error.message)).trim());
  }
  const buffer = result.stdout;
  let offset = 0;
  for (const id of wanted) {
    const end = buffer.indexOf(0x0a, offset);
    if (end < 0) throw new Error("git cat-file --batch ended early");
    const header = buffer.toString("utf8", offset, end).split(" ");
    offset = end + 1;
    if (header[1] === "missing") throw new Error("git object is missing: " + id);
    const size = Number(header[2]);
    contents.set(id, buffer.subarray(offset, offset + size));
    offset += size + 1;
  }
  return contents;
}

const codeStateMemo = new Map();

// The key of the code a check may read. Built from the Git objects of `commit`
// below `scope`, so it does not depend on line endings or on the working tree.
// A package contract file counts by the hash of its normalized text (ticks, Status,
// Abschluss and EVIDENCE are runtime state); every other blob counts by its object
// id. The file mode counts. The report and the lifecycle receipt are not counted.
// `exclude` (P8): subtrees left out of the key, relative to the repository like `scope`. A manual gate binds the code
// of its package without the bundle itself, whose evidence is bound by its own checksum.
export function codeStateKey(repoRoot, commit, { scope = ["."], exclude = [] } = {}) {
  const paths = normalizeScope(scope);
  const left = Array.isArray(exclude) ? exclude : [exclude];
  const excluded = left.length ? normalizeScope(left).filter((item) => item !== ".") : [];
  const memoKey = resolve(repoRoot) + "\0" + commit + "\0" + paths.join("\n") + "\0" + excluded.join("\n");
  const known = codeStateMemo.get(memoKey);
  if (known) return { ...known, scope: [...known.scope] };
  const entries = treeEntries(repoRoot, commit, paths)
    .filter((entry) => entry.path !== reportRelative && entry.path !== lifecycleEvidenceRelative)
    .filter((entry) => !excluded.some((item) => entry.path === item || entry.path.startsWith(item + "/")));
  const contracts = entries.filter((entry) => entry.kind === "blob" && packageContractPath(entry.path));
  const blobs = readBlobs(repoRoot, contracts.map((entry) => entry.id));
  const digest = createHash("sha256");
  for (const entry of entries) {
    let kind = entry.kind;
    let id = entry.id;
    if (entry.kind === "blob" && packageContractPath(entry.path)) {
      kind = "contract";
      id = sha256(normalizePackageContractContent(entry.path, blobs.get(entry.id)));
    }
    digest.update(entry.path + "\0" + entry.mode + "\0" + kind + "\0" + id + "\n");
  }
  // A scope that holds no file proves nothing: an empty code state is never a key.
  if (!entries.length) throw new Error("the code state of " + commit + " is empty: scope " + paths.join(",") + " matches nothing");
  const value = { algorithm: CODE_STATE_ALGORITHM, digest: digest.digest("hex"), fileCount: entries.length, scope: paths };
  codeStateMemo.set(memoKey, value);
  return { ...value, scope: [...value.scope] };
}

// Object ids of every package-lock.json below `scope` (never one inside node_modules).
export function lockfileBlobs(repoRoot, commit, { scope = ["."] } = {}) {
  return treeEntries(repoRoot, commit, scope)
    .filter((entry) => entry.kind === "blob" && basename(entry.path) === "package-lock.json" &&
      !entry.path.split("/").includes("node_modules"))
    .map((entry) => ({ path: entry.path, blob: entry.id }));
}

// What produced the result besides the code: the checker. Its version is a hash over the
// files gate-check.mjs and lib/** with line endings unified, each by its path below the
// checker directory. The same rule gives the version of the checker in a commit (from
// its blobs) and of the checker that runs (from its bytes on disk), so the two compare.
const unifyLineEndings = (value) => (Buffer.isBuffer(value) ? value.toString("utf8") : String(value)).replace(/\r\n?/gu, "\n");

function checkerDigest(files) {
  const lines = files.map(([path, content]) => path + "\0" + sha256(unifyLineEndings(content))).sort();
  return { digest: sha256(lines.join("\n")), fileCount: lines.length };
}

// The checker as the commit holds it below `directory` (posix, relative to the repository).
function committedChecker(repoRoot, commit, directory) {
  const prefix = directory + "/";
  const blobs = treeEntries(repoRoot, commit, ["."])
    .filter((entry) => entry.kind === "blob" &&
      (entry.path === prefix + CHECKER_ENTRY || entry.path.startsWith(prefix + CHECKER_LIBRARY + "/")));
  const contents = readBlobs(repoRoot, blobs.map((entry) => entry.id));
  return checkerDigest(blobs.map((entry) => [entry.path.slice(prefix.length), contents.get(entry.id)]));
}

// The checker that runs, from its bytes in `checkerDir`.
export function runningChecker(checkerDir) {
  const files = [[CHECKER_ENTRY, readFileSync(join(checkerDir, CHECKER_ENTRY))]];
  const collect = (folder, label) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      if (entry.isDirectory()) collect(join(folder, entry.name), label + entry.name + "/");
      else if (entry.isFile()) files.push([label + entry.name, readFileSync(join(folder, entry.name))]);
    }
  };
  collect(join(checkerDir, CHECKER_LIBRARY), CHECKER_LIBRARY + "/");
  return checkerDigest(files);
}

// Without checkerDir: the checker of the commit at the standard place (vendor/unlazy/scripts).
// With checkerDir (the running checker): its bytes on disk. When it lives inside the checked
// repository, matchesCommit says whether its bytes are those of the commit's blobs at the same
// place; a checker changed and not committed (or not committed at all) does not match, and a
// result it makes is then neither stored nor reused. Outside the repository matchesCommit is null.
export function checkerVersion(repoRoot, commit, { checkerDir = null } = {}) {
  if (!checkerDir) return { source: "commit", ...committedChecker(repoRoot, commit, CHECKER_DIRECTORY) };
  const running = runningChecker(checkerDir);
  let rel = null;
  try { rel = posix(relative(nativeRealpath(repoRoot), nativeRealpath(checkerDir))); } catch { rel = null; }
  const inside = rel !== null && rel !== "" && rel !== ".." && !rel.startsWith("../") && !isAbsolute(rel);
  if (!inside) return { source: "disk", ...running, inRepository: false, matchesCommit: null };
  const committed = committedChecker(repoRoot, commit, rel);
  return {
    source: "disk", ...running, inRepository: true, directory: rel,
    matchesCommit: committed.fileCount > 0 && committed.digest === running.digest,
  };
}

// ---- the key of one result ----------------------------------------------------

function canonicalJson(value) {
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + canonicalJson(value[key])).join(",") + "}";
  }
  return JSON.stringify(value === undefined ? null : value);
}

// parts: { codeState: { digest, scope? }, check, expect, cwd (relative to the repo), shell,
//          lockfiles: [{ path, blob }], checkerVersion (string or { digest }), nodeVersion? }
// No time limit and no absolute path takes part.
export function proofKey(parts) {
  const checker = parts.checkerVersion && typeof parts.checkerVersion === "object"
    ? parts.checkerVersion.digest : parts.checkerVersion;
  return sha256(canonicalJson({
    schema: PROOF_KEY_SCHEMA,
    codeState: parts.codeState && parts.codeState.digest,
    scope: parts.codeState && Array.isArray(parts.codeState.scope) ? [...parts.codeState.scope].sort() : null,
    check: parts.check,
    expect: parts.expect,
    cwd: posix(parts.cwd === undefined || parts.cwd === null ? "." : parts.cwd),
    shell: parts.shell,
    node: parts.nodeVersion || process.version,
    lockfiles: (parts.lockfiles || []).map((item) => ({ path: item.path, blob: item.blob }))
      .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0)),
    checker: checker || null,
  }));
}

// All parts for one gate at one commit, and its key.
// gate: { check, expect, cwd (relative to the repository), shell }
// checker: a version computed before (checkerVersion), so a run reads its own files once.
export function proofKeyFor(repoRoot, commit, gate, { scope = ["."], checkerDir = null, checker: known = null, nodeVersion } = {}) {
  const codeState = codeStateKey(repoRoot, commit, { scope });
  const checker = known || checkerVersion(repoRoot, commit, { checkerDir });
  const lockfiles = lockfileBlobs(repoRoot, commit, { scope });
  const key = proofKey({
    codeState, check: gate.check, expect: gate.expect, cwd: gate.cwd, shell: gate.shell,
    lockfiles, checkerVersion: checker, nodeVersion,
  });
  return { key, codeState, checker, lockfiles };
}

// A result of this gate may be stored and reused.
export function cacheable(gate) {
  if (!gate || typeof gate.check !== "string" || !gate.check.trim()) return false;
  if (typeof gate.cache === "string" && gate.cache.trim().toLowerCase() === "no") return false;
  const command = gate.check.toLowerCase();
  return !UNCACHEABLE_COMMAND_PATTERNS.some((pattern) => command.includes(pattern));
}

// ---- storage: Git notes of ref keel-proof -------------------------------------
//
// A note holds one compact JSON entry per line, each with schema keel-proof.v2-entry. Line
// by line, because proof-notes-sync merges the notes of two sides with cat_sort_uniq: that
// strategy sorts and joins LINES, so a note of one multi-line JSON document (keel-proof.v1)
// would come out as broken JSON. Lines survive it; entries of the same key are joined by
// key. Notes of the old form (one JSON document, keel-proof.v1) are still read.

const validKey = (entry) => entry && typeof entry === "object" && !Array.isArray(entry) && typeof entry.key === "string";

// Of two entries with the same key, the later one (by its time `at`) stays.
function joinByKey(entries) {
  const byKey = new Map();
  for (const entry of entries) {
    const known = byKey.get(entry.key);
    if (!known || String(entry.at || "") >= String(known.at || "")) byKey.set(entry.key, entry);
  }
  return [...byKey.values()];
}

// The entries of a note text: a whole keel-proof.v1 document first, otherwise every line that
// is a keel-proof.v2-entry; any other line is ignored.
export function parseNoteText(text) {
  const value = String(text || "");
  try {
    const whole = JSON.parse(value);
    if (whole && typeof whole === "object" && !Array.isArray(whole)) {
      if (whole.schema === PROOF_SCHEMA) return Array.isArray(whole.entries) ? joinByKey(whole.entries.filter(validKey)) : [];
      if (whole.schema === PROOF_ENTRY_SCHEMA) return validKey(whole) ? [whole] : [];
      return [];
    }
  } catch { /* lines below */ }
  const entries = [];
  for (const line of value.split(/\r?\n/u)) {
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (validKey(entry) && entry.schema === PROOF_ENTRY_SCHEMA) entries.push(entry);
  }
  return joinByKey(entries);
}

// The text of a note: one compact keel-proof.v2-entry per line, sorted by key.
export function formatNoteText(entries) {
  return [...entries]
    .sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0))
    .map((entry) => JSON.stringify({ ...entry, schema: PROOF_ENTRY_SCHEMA }))
    .join("\n") + "\n";
}

// The entries of the note on `commit` itself; an empty list when there is none.
export function readProofs(repoRoot, commit) {
  const result = gitRun(repoRoot, ["notes", "--ref", PROOF_NOTES_REF, "show", commit]);
  if (result.error || result.status !== 0) return [];
  return parseNoteText(result.stdout);
}

const indexMemo = new Map();

function proofIndex(repoRoot, commit) {
  const memoKey = resolve(repoRoot) + "\0" + commit;
  const known = indexMemo.get(memoKey);
  if (known) return known;
  const index = new Map();
  const result = gitRun(repoRoot, ["log", "--first-parent", "--notes=" + PROOF_NOTES_REF,
    "--format=%H%x00%N%x1e", commit]);
  if (!result.error && result.status === 0) {
    for (const record of String(result.stdout).split("\x1e")) {
      const cut = record.indexOf("\0");
      if (cut < 0) continue;
      const at = record.slice(0, cut).trim();
      if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(at)) continue;
      for (const entry of parseNoteText(record.slice(cut + 1))) {
        if (entry.result === "green" && !index.has(entry.key)) index.set(entry.key, { entry, commit: at });
      }
    }
  }
  indexMemo.set(memoKey, index);
  return index;
}

// A green entry with this key on `commit` or one of its first-parent ancestors; the
// nearest one wins. Returns { entry, commit } (the commit the entry hangs on) or null.
// The key hangs on content, not on a commit id, so a proof of an earlier commit holds
// for a later one whose checked subtree did not change.
export function findProof(repoRoot, commit, key) {
  return proofIndex(repoRoot, commit).get(key) || null;
}

function validEntry(entry) {
  return entry && typeof entry === "object" && entry.result === "green" &&
    /^[a-f0-9]{64}$/u.test(String(entry.key)) && typeof entry.outputSha256 === "string" &&
    Number.isInteger(entry.outputBytes) && entry.gate && typeof entry.gate === "object";
}

// Stores green entries on `commit` (merged with the entries already there; the same
// key is replaced). Red is never written. Without a noteWriter nothing is stored.
// noteWriter(file, commit) writes the note; it is the Harness's git-intent. The note is
// always written in the line form (keel-proof.v2-entry), old entries included.
export function writeProof(repoRoot, commit, entries, { noteWriter = null } = {}) {
  const list = (Array.isArray(entries) ? entries : [entries]).filter(validEntry);
  if (!noteWriter) return { written: 0, reason: "no noteWriter" };
  if (!list.length) return { written: 0, reason: "nothing green to store" };
  const keys = new Set(list.map((entry) => entry.key));
  const merged = [...readProofs(repoRoot, commit).filter((entry) => !keys.has(entry.key)), ...list];
  const folder = join(tmpdir(), "keel-proof", "notes");
  mkdirSync(folder, { recursive: true });
  const file = join(folder, "note-" + process.pid + "-" + randomBytes(6).toString("hex") + ".jsonl");
  writeFileSync(file, formatNoteText(merged), "utf8");
  try {
    noteWriter(file, commit);
  } catch (error) {
    return { written: 0, error: error && error.message ? error.message : String(error) };
  } finally {
    try { unlinkSync(file); } catch { /* the temp folder is the system's */ }
    for (const key of [...indexMemo.keys()]) if (key.startsWith(resolve(repoRoot) + "\0")) indexMemo.delete(key);
  }
  return { written: list.length };
}

// The Harness's own git-intent that belongs to the running checker, found only relative to
// the checker directory, never in the checked repository (unless that is the repository the
// checker comes from, which the source layout covers):
//   source layout:       <repo>/vendor/unlazy/scripts    -> <repo>/test-harness/harness-core/git/git-intent.mjs
//   installed layout:    <harness>/vendor/unlazy/scripts -> <harness>/harness-core/git/git-intent.mjs
// null when the checker is in neither layout or there is no git-intent (plain Unlazy). A
// git-intent that a checked repository brings along is code under check, not the Harness.
export function locateGitIntent(_repoRoot, { checkerDir = null } = {}) {
  const here = resolve(checkerDir || join(dirname(fileURLToPath(import.meta.url)), ".."));
  const unlazy = dirname(here);
  const vendor = dirname(unlazy);
  if (basename(here) !== "scripts" || basename(unlazy) !== "unlazy" || basename(vendor) !== "vendor") return null;
  const base = dirname(vendor);
  for (const rel of [["test-harness", "harness-core", "git", "git-intent.mjs"], ["harness-core", "git", "git-intent.mjs"]]) {
    const candidate = join(base, ...rel);
    try { if (statSync(candidate).isFile()) return candidate; } catch { /* keep looking */ }
  }
  return null;
}

// noteWriter that calls git-intent proof-note-write.
export function makeNoteWriter(repoRoot, intentFile) {
  return (file, commit) => {
    const result = spawnSync(process.execPath, [intentFile, "proof-note-write", "--root", repoRoot,
      "--commit", commit, "--file", file], { encoding: "utf8", windowsHide: true, env: { ...process.env } });
    if (result.error || result.status !== 0) {
      throw new Error("proof-note-write failed: " + String((result.stderr || (result.error && result.error.message) || result.stdout)).trim());
    }
  };
}

// ---- the clean copy -----------------------------------------------------------

const activeCheckouts = new Set();
let exitHookRegistered = false;

function removeLink(link) {
  let info;
  try { info = lstatSync(link); } catch (error) { if (error.code === "ENOENT") return; throw error; }
  // Only a link is ever removed here, never a directory with contents: the target
  // of the link is the real node_modules and must not be touched.
  if (!info.isSymbolicLink()) throw new Error("not a link, left alone: " + link);
  try { unlinkSync(link); }
  catch { rmdirSync(link); }
  if (existsSync(link)) throw new Error("link is still there: " + link);
}

// Removes the links first, and the worktree only when no link is left. Synchronous, so
// it also runs when the process ends.
function cleanupCheckout(entry) {
  if (!activeCheckouts.has(entry)) return [];
  const problems = [];
  for (const link of [...entry.links].reverse()) {
    try { removeLink(link); } catch (error) { problems.push(error.message); }
  }
  if (problems.length) return problems;
  const removed = gitRun(entry.repoRoot, ["worktree", "remove", "--force", entry.directory]);
  if (removed.error || removed.status !== 0 || existsSync(entry.directory)) {
    try { rmSync(entry.directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
    catch (error) { problems.push("cannot remove " + entry.directory + ": " + error.message); }
    gitRun(entry.repoRoot, ["worktree", "prune"]);
  }
  if (existsSync(entry.directory)) problems.push("worktree is still there: " + entry.directory);
  if (!problems.length) activeCheckouts.delete(entry);
  return problems;
}

function registerExitHook() {
  if (exitHookRegistered) return;
  exitHookRegistered = true;
  process.on("exit", () => { for (const entry of [...activeCheckouts]) cleanupCheckout(entry); });
}

// The node_modules of the main working copy that a clean copy would get as a link: one for
// every package-lock.json whose object id equals the one of the file in the main working copy
// and which has a node_modules beside it.
function nodeModulesPlan(repoRoot, commit) {
  const plan = [];
  const locks = treeEntries(repoRoot, commit, ["."])
    .filter((entry) => entry.kind === "blob" && basename(entry.path) === "package-lock.json" &&
      !entry.path.split("/").includes("node_modules"));
  for (const lock of locks) {
    const folder = dirname(lock.path) === "." ? "" : dirname(lock.path);
    const source = join(repoRoot, folder, "node_modules");
    const lockFile = join(repoRoot, lock.path);
    try {
      if (!statSync(source).isDirectory() || !statSync(lockFile).isFile()) continue;
    } catch { continue; }
    const hashed = gitRun(repoRoot, ["hash-object", "--", lockFile]);
    if (hashed.error || hashed.status !== 0 || String(hashed.stdout).trim() !== lock.id) continue;
    plan.push({ folder, source });
  }
  return plan;
}

// Links in those node_modules (top level and @scope folders) whose target lies in the working
// tree of the repository, outside any node_modules: a workspace or file: dependency. The
// repository root itself (a file:../.. dependency) and any folder above it (it contains the
// working tree) count as well. Through such a link the clean copy would read the uncommitted
// code of the main working copy, so a result made with it says nothing about the commit.
// [{ link, target }]
export function nodeModulesWorkspaceLinks(repoRoot, commit) {
  let top;
  try { top = nativeRealpath(repoRoot); } catch { top = resolve(repoRoot); }
  const found = [];
  const inspect = (path) => {
    let info;
    try { info = lstatSync(path); } catch { return; }
    if (!info.isSymbolicLink()) return;
    let target;
    try { target = nativeRealpath(path); } catch { return; }
    const rel = posix(relative(top, target));
    const down = posix(relative(target, top));
    // The root itself, or a folder that contains the root.
    const holdsRoot = rel === "" || (!isAbsolute(down) && down !== ".." && !down.startsWith("../"));
    if (!holdsRoot) {
      if (rel === ".." || rel.startsWith("../") || isAbsolute(rel)) return;
      if (rel.split("/").includes("node_modules")) return;
    }
    found.push({ link: path, target });
  };
  for (const { source } of nodeModulesPlan(repoRoot, commit)) {
    let names;
    try { names = readdirSync(source, { withFileTypes: true }); } catch { continue; }
    for (const entry of names) {
      const path = join(source, entry.name);
      inspect(path);
      if (entry.name.startsWith("@") && entry.isDirectory()) {
        let scoped;
        try { scoped = readdirSync(path); } catch { continue; }
        for (const name of scoped) inspect(join(path, name));
      }
    }
  }
  return found;
}

// A node_modules the copy cannot have (Git ignores it) is provided as a link to the real one
// (see nodeModulesPlan). Otherwise it stays without, and a check that needs it turns red (and
// is not stored). linkFolder(folder) decides per folder (repository-relative, "/"-separated, "" for
// the root); a folder it refuses stays without, for the caller to install for real.
function linkNodeModules(repoRoot, checkout, commit, linkFolder = () => true) {
  const links = [];
  for (const { folder, source } of nodeModulesPlan(repoRoot, commit)) {
    if (!linkFolder(folder.split(/[\\/]/u).join("/"))) continue;
    const target = join(checkout, folder, "node_modules");
    if (existsSync(target)) continue;
    try {
      symlinkSync(source, target, process.platform === "win32" ? "junction" : "dir");
      links.push(target);
    } catch { /* without the link the check fails honestly */ }
  }
  return links;
}

// fn(directory) runs in a clean detached copy of `commit`; the copy is removed afterwards,
// also when fn throws. linkFolder: see linkNodeModules.
export async function withCleanCheckout(repoRoot, commit, fn, { baseDirectory = null, linkFolder = () => true } = {}) {
  const root = resolve(repoRoot);
  const base = join(baseDirectory || tmpdir(), "keel-proof");
  mkdirSync(base, { recursive: true });
  gitRun(root, ["worktree", "prune"]);
  const directory = join(base, sha256(root + "\0" + commit + "\0" + process.pid + "\0" + randomBytes(8).toString("hex")).slice(0, 12));
  const added = gitRun(root, ["-c", "core.longpaths=true", "worktree", "add", "--detach", directory, commit]);
  if (added.error || added.status !== 0) {
    throw new Error("cannot create a clean copy of " + commit + ": " +
      String((added.stderr || (added.error && added.error.message) || added.stdout)).trim());
  }
  const entry = { repoRoot: root, directory, links: [] };
  activeCheckouts.add(entry);
  registerExitHook();
  let failure = null;
  try {
    entry.links = linkNodeModules(root, directory, commit, linkFolder);
    return await fn(directory);
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    const problems = cleanupCheckout(entry);
    if (problems.length) {
      const message = "clean copy not fully removed (left in place so no real node_modules is touched): " + problems.join("; ");
      if (failure) console.error("proof-store: " + message);
      else throw new Error(message);
    }
  }
}
