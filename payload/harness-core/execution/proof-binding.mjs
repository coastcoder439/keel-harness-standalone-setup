// P8: how the executor binds its checks to a code state instead of to the working tree.
//
// - workingCommit: a commit object of HEAD plus exactly selected working-tree changes, built in a temporary index
//   (read-tree, add, write-tree, commit-tree). No branch moves, the shared index and the working tree stay as they
//   are. The return of a step (B16) and the confirmation of a manual gate (B12) are bound to such an object.
// - copyProofs: green proof entries of one commit (the clean-copy results of a return) are written onto another
//   (the integration commit) through the Harness's own proof-note-write. A proof entry is keyed by its code state,
//   command, EXPECT, CWD, shell, lockfiles and checker, so a copied entry is reused only where that key is computed
//   again; it can never make a gate green for code it was not proved on.
// - manual gates (B12): the confirmation carries the code state of its gate scope, a stale one is named with the
//   changed files.
//
// Zero dependencies beyond the vendored Unlazy proof store, loaded from the Unlazy root the executor located.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const stores = new Map();

export async function loadProofStore(unlazyRoot) {
  const file = path.join(unlazyRoot, "scripts", "lib", "proof-store.mjs");
  if (stores.has(file)) return stores.get(file);
  if (!fs.existsSync(file)) {
    const error = new Error("proof-store.mjs not found next to the gate runner: " + file);
    error.code = "PROOF_STORE_MISSING";
    error.exitCode = 2;
    throw error;
  }
  const module = await import(pathToFileURL(file).href);
  stores.set(file, module);
  return module;
}

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const posix = (value) => String(value).replaceAll("\\", "/");
const ID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;

function failWith(code, message, exitCode = 2) {
  const error = new Error(message);
  error.code = code;
  error.exitCode = exitCode;
  throw error;
}

function zeroList(value) {
  return String(value || "").split("\0").filter(Boolean).map(posix);
}

// git(args, env) -> { status, stdout, stderr }; the caller's runner (silence-watched in the executor).
async function checked(git, args, env, operation) {
  const result = await git(args, env);
  if (result.error || result.status !== 0) {
    failWith("WORKING_COMMIT", operation + " failed: " + String(result.stderr || result.stdout || (result.error && result.error.message) || "").trim().slice(0, 500));
  }
  return String(result.stdout || "");
}

// A commit object of `head` plus the working-tree changes of every path `select(relative)` accepts (changed, new or
// deleted). Built in a temporary index file under `tmpDirectory`; nothing but the Git object store is written.
// Without a selected change the result is `head` itself.
export async function workingCommit({ git, head, select, label, tmpDirectory }) {
  if (!ID.test(String(head || ""))) failWith("WORKING_COMMIT", "HEAD is not a commit");
  fs.mkdirSync(tmpDirectory, { recursive: true });
  const indexFile = path.join(tmpDirectory, "index-" + process.pid + "-" + crypto.randomBytes(6).toString("hex"));
  const listFile = indexFile + ".paths";
  const env = {
    GIT_INDEX_FILE: indexFile, GIT_OPTIONAL_LOCKS: "0", GIT_LITERAL_PATHSPECS: "1",
    GIT_AUTHOR_NAME: "Keel Harness", GIT_AUTHOR_EMAIL: "harness@keel.invalid",
    GIT_COMMITTER_NAME: "Keel Harness", GIT_COMMITTER_EMAIL: "harness@keel.invalid",
  };
  try {
    await checked(git, ["read-tree", head], env, "read-tree");
    const tracked = zeroList(await checked(git, ["diff", "--name-only", "-z", "--no-renames", head], env, "diff"));
    const untracked = zeroList(await checked(git, ["ls-files", "--others", "--exclude-standard", "-z"], env, "ls-files"));
    const paths = [...new Set([...tracked, ...untracked])].filter((relative) => select(relative))
      .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
    if (!paths.length) return { commit: head, head, paths };
    fs.writeFileSync(listFile, paths.join("\0") + "\0");
    await checked(git, ["add", "-A", "--pathspec-from-file=" + listFile, "--pathspec-file-nul"], env, "add");
    const tree = (await checked(git, ["write-tree"], env, "write-tree")).trim();
    const commit = (await checked(git, ["commit-tree", tree, "-p", head, "-m", "keel: " + label], env, "commit-tree")).trim();
    if (!ID.test(commit)) failWith("WORKING_COMMIT", "commit-tree returned no commit id");
    return { commit, head, paths };
  } finally {
    for (const file of [indexFile, indexFile + ".lock", listFile]) {
      try { fs.rmSync(file, { force: true }); } catch { /* temporary */ }
    }
  }
}

// Green entries proved on `fromCommits` are written onto `toCommit` (merged with what is there).
export function copyProofs(store, repoRoot, fromCommits, toCommit, intentFile) {
  const seen = new Set();
  const entries = [];
  for (const from of fromCommits) {
    if (!ID.test(String(from || "")) || from === toCommit) continue;
    for (const entry of store.readProofs(repoRoot, from)) {
      if (entry.result !== "green" || seen.has(entry.key)) continue;
      seen.add(entry.key);
      entries.push(entry);
    }
  }
  if (!entries.length) return { copied: 0 };
  const written = store.writeProof(repoRoot, toCommit, entries, { noteWriter: store.makeNoteWriter(repoRoot, intentFile) });
  if (written.error) failWith("PROOF_COPY", "proofs could not be carried to " + toCommit.slice(0, 8) + ": " + written.error, 1);
  return { copied: written.written || 0 };
}

// ---- manual gates (B12) ----------------------------------------------------------------------------

// The fixed part of an OWNS glob: the folders before its first wildcard ("src/work/**" -> "src/work").
export function staticPrefix(glob) {
  const parts = [];
  for (const part of posix(glob).replace(/^\.\//u, "").split("/")) {
    if (!part || /[*?[\]{}!]/u.test(part)) break;
    parts.push(part);
  }
  return parts.length ? parts.join("/") : ".";
}

// The code a manual confirmation is bound to: the OWNS of EVERY leaf of the package, whichever ledger the gate stands
// in (P8 narrowed a leaf gate to its own leaf; P21 takes that back, because the order says "the code state of the
// package scope": a change in another leaf of the same package makes a manual leaf confirmation stale as well). The
// package bundle itself is never part of it: its ledgers are runtime state and its evidence is bound by its own
// checksum. The ledger argument stays for the callers; it no longer narrows the scope.
export function manualScope(packageId, _ledgerRelative, leafOwns) {
  const owns = Object.values(leafOwns).flat();
  const scope = [...new Set(owns.map(staticPrefix))].sort();
  return { scope: scope.includes(".") ? ["."] : scope, exclude: ["docs/packages/" + packageId] };
}

// The scope of a partial save (integrate --ready-only, same shape as manualScope): the OWNS of every leaf the held
// commit carries, that is of every ready leaf. A change in any of them after a confirmation makes it stale, also a
// change in another ready leaf than the gate's own. A leaf that is not saved is not part of the commit, so its code
// state cannot be part of the comparison: its unsaved work never keeps a confirmation of the save stale.
export function readyScope(packageId, leafOwns, readyLeaves) {
  return manualScope(packageId, null, Object.fromEntries(readyLeaves.map((leaf) => [leaf, leafOwns[leaf] || []])));
}

export function manualSelect(spec) {
  const inside = (relative, base) => base === "." || relative === base || relative.startsWith(base + "/");
  return (relative) => spec.scope.some((base) => inside(relative, base)) && !spec.exclude.some((base) => inside(relative, base));
}

const EMPTY = sha256("keel-manual-scope:empty");

export function manualCodeState(store, repoRoot, commit, spec) {
  const present = spec.scope.filter((item) => store.treeEntries(repoRoot, commit, [item]).length);
  if (!present.length) return EMPTY;
  try { return store.codeStateKey(repoRoot, commit, { scope: present, exclude: spec.exclude }).digest; }
  catch (error) {
    if (/is empty/u.test(String(error.message))) return EMPTY;
    throw error;
  }
}

const CODE_RE = /(?:^|;\s*)code=([0-9a-f]{64})@((?:[0-9a-f]{40}|[0-9a-f]{64}))(?=;|\s*$)/u;

export function manualCodeOf(evidence) {
  const match = CODE_RE.exec(String(evidence || ""));
  return match ? { digest: match[1], commit: match[2] } : null;
}

export function formatManualCode(digest, commit) {
  return "code=" + digest + "@" + commit;
}

// Paths whose tree entry differs between the two commits inside the gate scope; null when an object is gone.
export function changedInScope(store, repoRoot, fromCommit, toCommit, spec) {
  const select = manualSelect(spec);
  const list = (commit) => {
    const map = new Map();
    for (const entry of store.treeEntries(repoRoot, commit, ["."])) {
      if (select(entry.path)) map.set(entry.path, entry.mode + " " + entry.id);
    }
    return map;
  };
  let before;
  let after;
  try { before = list(fromCommit); after = list(toCommit); } catch { return null; }
  const changed = [];
  for (const [file, value] of after) if (before.get(file) !== value) changed.push(file);
  for (const file of before.keys()) if (!after.has(file)) changed.push(file);
  return changed.sort();
}

export const manualEvidenceDigest = (evidence) => sha256(String(evidence || ""));
