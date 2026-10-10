// A working copy of its own for one work step (P18, concept 3.2.3; model: one worktree per task).
//
// With a copy of its own the comparison at the return is exact: everything that differs in the copy from its start is
// what this step wrote, whatever the other agents did in the shared folder meanwhile. Parallel steps never touch each
// other's files, and nothing is ever reverted in the shared folder (Owner rule of 3.2.1 stays).
//
//   create   `git worktree add --detach <copy> HEAD`, then the dirty state of the shared folder is laid over it (work of
//            earlier steps that is not committed yet), node_modules is linked as a junction, the baseline of the copy and
//            of the shared folder are taken
//   collect  what changed in the copy since its start, split by the OWNS of the step
//   adopt    the changes inside the OWNS go into the shared folder; a file the shared folder changed since the start of the
//            step (someone else wrote it) is a conflict: nothing is adopted, the files are named
//   remove   `git worktree remove --force`, with a plain delete as fallback
//
// Everything here takes the Git call as a parameter `git(args)` -> { status, stdout, stderr } (the executor's own runner), so a
// test needs no process of its own.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { changedBetween, isRuntimePath, takeSnapshot } from "./worktree-snapshot.mjs";

const slash = (value) => String(value).replaceAll("\\", "/");

/**
 * Where the copy of one step lives: inside the ignored runtime folder of the repository, named by a hash of the session.
 * Not under executor/: below .unlazy/<scope>/executor/ lies the executor state, which is not for the agent, and the
 * agent has to write in its copy. The baseline of the step stays under executor/ (executor state, not for the agent).
 */
export function stepCopyPath(repoRoot, scope, sessionId) {
  const name = crypto.createHash("sha256").update(String(sessionId)).digest("hex").slice(0, 16);
  return path.join(repoRoot, ".unlazy", scope, "step-copies", name);
}

function inside(root, relative) {
  return path.join(root, ...slash(relative).split("/"));
}

function copyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.rmSync(to, { force: true });
  fs.copyFileSync(from, to);
}

function gitIn(directory, git) {
  return (args) => git(["-C", directory, ...args]);
}

async function mustGit(git, args, operation) {
  const result = await git(args);
  if (result.status !== 0) {
    const error = new Error(`step copy: ${operation} failed (${result.status}): ${String(result.stderr || result.stdout || "").trim()}`);
    error.code = "STEP_COPY_GIT";
    throw error;
  }
  return result;
}

/**
 * Creates the copy and returns what the return needs later: { copyPath, mainBaseline, copyBaseline }.
 * `git` runs with the shared folder as its repository (`git(["-C", repoRoot, ...])` is built by the caller's runner).
 */
export async function createStepCopy({ repoRoot, copyPath, git }) {
  if (fs.existsSync(copyPath)) {
    const error = new Error("step copy already exists: " + copyPath);
    error.code = "STEP_COPY_EXISTS";
    throw error;
  }
  fs.mkdirSync(path.dirname(copyPath), { recursive: true });
  const main = await takeSnapshot({ repoRoot, git: gitIn(repoRoot, git) });
  if (!main) {
    const error = new Error("step copy: the state of the shared folder cannot be read");
    error.code = "STEP_COPY_GIT";
    throw error;
  }
  await mustGit(git, ["-C", repoRoot, "worktree", "add", "--detach", copyPath, main.head || "HEAD"], "worktree add");
  try {
    // Lay the uncommitted work of the shared folder over the clean checkout (earlier steps return into the shared folder).
    for (const relative of Object.keys(main.dirty)) {
      if (isRuntimePath(relative)) continue;
      const source = inside(repoRoot, relative);
      if (fs.existsSync(source) && fs.lstatSync(source).isFile()) copyFile(source, inside(copyPath, relative));
      else fs.rmSync(inside(copyPath, relative), { force: true });
    }
    const modules = path.join(repoRoot, "node_modules");
    if (fs.existsSync(modules) && !fs.existsSync(path.join(copyPath, "node_modules"))) {
      try { fs.symlinkSync(modules, path.join(copyPath, "node_modules"), "junction"); } catch { /* the step then lacks the installed packages */ }
    }
    const copyBaseline = await takeSnapshot({ repoRoot: copyPath, git: gitIn(copyPath, git) });
    if (!copyBaseline) {
      const error = new Error("step copy: the state of the copy cannot be read");
      error.code = "STEP_COPY_GIT";
      throw error;
    }
    return { copyPath, mainBaseline: main, copyBaseline };
  } catch (error) {
    await removeStepCopy({ repoRoot, copyPath, git });
    throw error;
  }
}

/**
 * What the step wrote: the changed files of the copy since its start, minus `ignore` (the executor's own files), split
 * into `inOwns` (matched by `owns(relative)`) and `outside`. Exact: nothing here was written by anybody else.
 */
export async function collectStepCopy({ copyPath, copyBaseline, git, owns, ignore = () => false }) {
  const after = await takeSnapshot({ repoRoot: copyPath, git: gitIn(copyPath, git) });
  if (!after) return { judged: false, changed: [], inOwns: [], outside: [] };
  const changed = (await changedBetween({ repoRoot: copyPath, git: gitIn(copyPath, git), before: copyBaseline, after }))
    .filter((relative) => !isRuntimePath(relative) && !ignore(relative));
  return { judged: true, changed, inOwns: changed.filter(owns), outside: changed.filter((relative) => !owns(relative)) };
}

/**
 * Takes `files` from the copy into the shared folder. A file the shared folder changed since the step started is a conflict;
 * with one conflict nothing is adopted. A file absent in the copy is deleted in the shared folder.
 */
export async function adoptStepCopy({ repoRoot, copyPath, mainBaseline, git, files }) {
  const now = await takeSnapshot({ repoRoot, git: gitIn(repoRoot, git) });
  if (!now) {
    const error = new Error("step copy: the state of the shared folder cannot be read; nothing is adopted");
    error.code = "STEP_COPY_UNREADABLE";
    throw error;
  }
  const sharedChanged = new Set(await changedBetween({ repoRoot, git: gitIn(repoRoot, git), before: mainBaseline, after: now }));
  const conflicts = files.filter((relative) => sharedChanged.has(relative));
  if (conflicts.length) return { adopted: [], conflicts };
  // A file whose real location lies outside the copy (a link the step made) is never taken: all sources are checked first.
  const copyReal = fs.realpathSync(copyPath);
  for (const relative of files) {
    const source = inside(copyPath, relative);
    if (!fs.existsSync(source)) continue;
    const real = fs.realpathSync(source);
    const rel = path.relative(copyReal, real);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel) || fs.lstatSync(source).isSymbolicLink()) {
      const error = new Error("step copy: " + relative + " leads out of the copy; nothing is adopted");
      error.code = "STEP_COPY_UNSAFE_SOURCE";
      throw error;
    }
  }
  const adopted = [];
  for (const relative of files) {
    const source = inside(copyPath, relative);
    const target = inside(repoRoot, relative);
    if (fs.existsSync(source) && fs.lstatSync(source).isFile()) copyFile(source, target);
    else fs.rmSync(target, { force: true });
    adopted.push(relative);
  }
  return { adopted, conflicts: [] };
}

function dropLinks(directory) {
  let entries;
  try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (entry.name === ".git") continue;
    const full = path.join(directory, entry.name);
    let link = entry.isSymbolicLink();
    if (!link) { try { link = fs.lstatSync(full).isSymbolicLink(); } catch { link = false; } }
    if (link) { try { fs.unlinkSync(full); } catch { try { fs.rmdirSync(full); } catch { /* stays */ } } }
    else if (entry.isDirectory()) dropLinks(full);
  }
}

/** Removes the copy; never throws (a left-over copy is a folder in the ignored runtime area). */
export async function removeStepCopy({ repoRoot, copyPath, git }) {
  // Every link of the copy (the junction to node_modules, any link the step made) goes first and alone: neither Git nor a
  // recursive delete may walk into what it points at.
  dropLinks(copyPath);
  try { await git(["-C", repoRoot, "worktree", "remove", "--force", copyPath]); } catch { /* fall through */ }
  try { fs.rmSync(copyPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* stays */ }
  try { await git(["-C", repoRoot, "worktree", "prune"]); } catch { /* stays */ }
  return !fs.existsSync(copyPath);
}
