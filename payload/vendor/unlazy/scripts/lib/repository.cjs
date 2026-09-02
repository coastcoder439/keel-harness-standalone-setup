"use strict";

// Canonical repository discovery for Unlazy and every Harness adapter. Git
// itself decides the worktree root. An arbitrary directory or file named
// `.git` is never accepted as a repository boundary.

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const DEFAULT_TIMEOUT_MS = 5_000;
const realpath = fs.realpathSync.native || fs.realpathSync;

function fail(message, details = {}) {
  const error = new Error(message);
  error.code = "UNLAZY_REPOSITORY";
  Object.assign(error, details);
  throw error;
}

function nearestExistingDirectory(startPath) {
  let candidate = path.resolve(String(startPath || process.cwd()));
  while (!fs.existsSync(candidate)) {
    const parent = path.dirname(candidate);
    if (parent === candidate) fail("no existing ancestor for " + candidate);
    candidate = parent;
  }
  const info = fs.lstatSync(candidate);
  if (info.isSymbolicLink()) candidate = realpath(candidate);
  else if (!info.isDirectory()) candidate = path.dirname(candidate);
  return realpath(candidate);
}

function canonicalPath(value) {
  return realpath(path.resolve(String(value)));
}

function canonicalLexicalPath(value) {
  const requested = path.resolve(String(value));
  let anchor = requested;
  while (!fs.existsSync(anchor)) {
    const parent = path.dirname(anchor);
    if (parent === anchor) return requested;
    anchor = parent;
  }
  const tail = path.relative(anchor, requested);
  return path.resolve(realpath(anchor), tail);
}

function pathKey(value, options = {}) {
  const platform = options.platform || process.platform;
  // Git and Node can name the same Windows file through long and 8.3-short
  // paths. Canonicalize the nearest existing anchor while preserving a lexical
  // tail for future files, otherwise an inside-repository path can fail closed
  // merely because one side used LONSIN~1 and the other the long profile name.
  const normalized = path.normalize(canonicalLexicalPath(value));
  return platform === "win32" ? normalized.toLowerCase() : normalized;
}

function samePath(left, right, options = {}) {
  try {
    const a = fs.statSync(left, { bigint: true });
    const b = fs.statSync(right, { bigint: true });
    if (a.dev === b.dev && a.ino === b.ino) return true;
  } catch { /* fall back to lexical comparison for absent paths */ }
  return pathKey(left, options) === pathKey(right, options);
}

function isPathInside(parent, child, options = {}) {
  const parentKey = pathKey(parent, options);
  const childKey = pathKey(child, options);
  return childKey === parentKey || childKey.startsWith(parentKey + path.sep);
}

function cleanGitEnv(extra = {}) {
  const env = {
    ...process.env,
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0",
    ...extra,
  };
  for (const inherited of [
    "GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY",
  ]) delete env[inherited];
  return env;
}

function runGit(cwd, args, options = {}) {
  const result = (options.runner || spawnSync)(options.gitExecutable || "git", ["-C", cwd, ...args], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    timeout: options.timeoutMs || DEFAULT_TIMEOUT_MS,
    env: cleanGitEnv(options.env),
  });
  if (result.error) fail("git repository probe failed: " + result.error.message, { cause: result.error });
  return result;
}

function oneLine(result, operation) {
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || "").trim().split(/\r?\n/u)[0] ||
      "git exited " + result.status;
    fail(operation + " failed: " + detail, { gitExitCode: result.status });
  }
  const lines = String(result.stdout || "").trim().split(/\r?\n/u).filter(Boolean);
  if (lines.length !== 1) fail(operation + " returned no unique path");
  return lines[0];
}

function resolveRepositoryRoot(startPath = process.cwd(), options = {}) {
  const existing = nearestExistingDirectory(startPath);
  const raw = oneLine(runGit(existing, ["rev-parse", "--show-toplevel"], options), "git worktree discovery");
  return canonicalPath(raw);
}

function assertRepositoryRoot(root, options = {}) {
  const input = path.resolve(String(root));
  if (!fs.existsSync(input) || !fs.lstatSync(input).isDirectory()) {
    fail("--root is not a directory: " + input);
  }
  const requested = canonicalPath(root);
  const resolved = resolveRepositoryRoot(requested, options);
  const prefix = runGit(requested, ["rev-parse", "--show-prefix"], options);
  if (prefix.status !== 0 || String(prefix.stdout || "").trim() !== "" || !samePath(requested, resolved, options)) {
    fail("--root must name the Git worktree root itself; nearest root is " + resolved);
  }
  return resolved;
}

function repositorySnapshot(startPath = process.cwd(), options = {}) {
  const repoRoot = resolveRepositoryRoot(startPath, options);
  const gitDir = canonicalPath(oneLine(
    runGit(repoRoot, ["rev-parse", "--absolute-git-dir"], options),
    "git directory discovery",
  ));
  const head = runGit(repoRoot, ["rev-parse", "--verify", "HEAD"], options);
  const headOid = head.status === 0 ? String(head.stdout).trim() : null;
  if (headOid !== null && !/^[a-f0-9]{40,64}$/iu.test(headOid)) fail("git returned an invalid HEAD object id");
  return { repoRoot, gitDir, headOid };
}

function repositoryRelativePath(repoRoot, targetPath, options = {}) {
  const expected = repositorySnapshot(repoRoot, options);
  const actual = repositorySnapshot(targetPath, options);
  if (!samePath(expected.gitDir, actual.gitDir, options)) fail("target belongs to another Git repository");
  const requested = path.resolve(String(targetPath));
  let lexicalAnchor = requested;
  while (!fs.existsSync(lexicalAnchor)) {
    const parent = path.dirname(lexicalAnchor);
    if (parent === lexicalAnchor) fail("cannot resolve target path inside repository");
    lexicalAnchor = parent;
  }
  if (!fs.lstatSync(lexicalAnchor).isDirectory()) lexicalAnchor = path.dirname(lexicalAnchor);
  const tail = path.relative(lexicalAnchor, requested).replaceAll("\\", "/");
  const existing = canonicalPath(lexicalAnchor);
  const prefixResult = runGit(existing, ["rev-parse", "--show-prefix"], options);
  if (prefixResult.status !== 0) fail("cannot resolve target path inside repository");
  const prefix = String(prefixResult.stdout || "").trim().replaceAll("\\", "/");
  const relative = [prefix, tail].filter(Boolean).join("/")
    .replace(/\/{2,}/gu, "/").replace(/^\.\//u, "");
  if (!relative || relative === "." || relative.startsWith("../") || relative.includes("/../")) {
    fail("target has no safe repository-relative path");
  }
  return relative;
}

module.exports = {
  assertRepositoryRoot,
  isPathInside,
  nearestExistingDirectory,
  pathKey,
  repositoryRelativePath,
  repositorySnapshot,
  resolveRepositoryRoot,
  runGit,
  samePath,
};
