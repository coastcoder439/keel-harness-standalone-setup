"use strict";

// P20, D14 (process flood caused by Git): the one place that decides WHICH Git program the Harness starts and
// whether a read call carries --no-optional-locks.
//
// Why: on Windows `git` on the PATH is usually Git for Windows' `cmd\git.exe`, a wrapper that starts the real
// `mingw64\bin\git.exe` as a second process. Every Git call of a hook therefore cost two processes, and a hook
// that polls Git in the background multiplies that. A background `git status` without --no-optional-locks also
// may write the index (opportunistic refresh) and so take index.lock, a likely cause of orphaned locks.
//
// What it does (CommonJS, so hooks can load it; a byte-identical copy lives in vendor/unlazy/scripts/lib/git-binary.cjs,
// because Unlazy must not load anything from the Harness. test/git-binary.test.js keeps both equal):
//  - gitExecutable(): the real git.exe, found once per process and remembered. It is found WITHOUT starting a
//    process: the first git.exe of the PATH is looked at, and the real binary is its sibling in the same Git for
//    Windows installation (cmd\git.exe -> mingw64\bin\git.exe). Only an unknown layout (a shim) asks that Git for
//    its exec path (`git --exec-path` = <root>\mingw64\libexec\git-core, so <root>\mingw64\bin\git.exe).
//    A candidate counts only when the file exists next to a libexec\git-core folder. GIT_EXEC_PATH of the
//    environment is never believed (it would let a foreign folder pick the program). Nothing found, or any error:
//    plain "git", exactly what ran before. The helper never throws.
//  - readGitArgs(args): prepends --no-optional-locks to a call whose Git subcommand only reads (status, diff,
//    rev-parse, ls-files, ...). A writing or unknown subcommand is returned unchanged, so a mutation never changes.
//  - gitSync(args, spawnOptions): spawnSync of both; when the found program cannot be started at all (removed,
//    not executable) it forgets it and runs plain "git" once. A timeout is not such a failure.

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const REAL_GIT_FOLDERS = ["mingw64", "clangarm64", "mingw32"];
const EXEC_PATH_TIMEOUT_MS = 5_000; // protection of one single question to Git; it ends no work
const UNSTARTABLE = new Set(["ENOENT", "EACCES", "EPERM", "ENOTDIR"]);

// Subcommands that never write a ref, the index or the object store. `branch`, `remote`, `config`, `notes`,
// `worktree`, `hash-object` and the like are left out on purpose: some of their forms write.
const READ_ONLY_SUBCOMMANDS = new Set([
  "status", "diff", "diff-index", "diff-files", "diff-tree", "ls-files", "ls-tree", "rev-parse", "rev-list", "log", "show",
  "cat-file", "check-ignore", "show-ref", "for-each-ref", "merge-base", "describe", "name-rev", "ls-remote", "blame", "grep",
  "shortlog",
]);

// Global options that take their value as the NEXT word.
const GLOBAL_OPTIONS_WITH_VALUE = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--super-prefix", "--config-env"]);

function lower(value) { return String(value).toLowerCase(); }

function environmentValue(env, name) {
  const wanted = lower(name);
  for (const key of Object.keys(env || {})) if (lower(key) === wanted) return env[key];
  return undefined;
}

function defaultIsFile(file) {
  try { return fs.statSync(file).isFile(); } catch { return false; }
}

function defaultIsDirectory(directory) {
  try { return fs.statSync(directory).isDirectory(); } catch { return false; }
}

// The first git.exe of the PATH, the way the system would find it, minus the current folder and relative entries:
// those depend on where the caller stands, and a git.exe lying in a repository must never be preferred.
function firstGitOnPath(env, platformPath, isFile) {
  const value = environmentValue(env, "PATH");
  if (typeof value !== "string") return null;
  for (const raw of value.split(";")) {
    const directory = raw.trim().replace(/^"(.*)"$/u, "$1");
    if (!directory || !platformPath.isAbsolute(directory)) continue;
    const file = platformPath.join(directory, "git.exe");
    if (isFile(file)) return file;
  }
  return null;
}

// <root>\<mingw>\bin\git.exe is only trusted next to <root>\<mingw>\libexec\git-core, the folder `git --exec-path` names.
function realBinaryIn(root, platformPath, isFile, isDirectory) {
  for (const folder of REAL_GIT_FOLDERS) {
    const candidate = platformPath.join(root, folder, "bin", "git.exe");
    if (isFile(candidate) && isDirectory(platformPath.join(root, folder, "libexec", "git-core"))) return candidate;
  }
  return null;
}

// The real binary for the git.exe found on the PATH, or null when its folder layout says nothing.
function siblingOfWrapper(found, platformPath, isFile, isDirectory) {
  const directory = platformPath.dirname(found);
  const parent = platformPath.dirname(directory);
  const name = lower(platformPath.basename(directory));
  if (name === "bin" && REAL_GIT_FOLDERS.includes(lower(platformPath.basename(parent)))
      && isDirectory(platformPath.join(parent, "libexec", "git-core"))) return found; // already the real one
  if (name === "cmd" || name === "bin") return realBinaryIn(parent, platformPath, isFile, isDirectory);
  return null;
}

// `git --exec-path` is <root>\<mingw>\libexec\git-core; the real binary is <root>\<mingw>\bin\git.exe.
function fromExecPath(found, env, platformPath, run, isFile) {
  const clean = { ...env };
  for (const key of Object.keys(clean)) if (lower(key) === "git_exec_path") delete clean[key];
  let result;
  try {
    result = run(found, ["--exec-path"], {
      encoding: "utf8", windowsHide: true, shell: false, timeout: EXEC_PATH_TIMEOUT_MS, env: clean,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch { return null; }
  if (!result || result.error || result.status !== 0) return null;
  const first = String(result.stdout || "").trim().split(/\r?\n/u)[0];
  if (!first) return null;
  const execPath = platformPath.normalize(first);
  const gitCore = platformPath.dirname(execPath);
  if (lower(platformPath.basename(execPath)) !== "git-core" || lower(platformPath.basename(gitCore)) !== "libexec") return null;
  const mingw = platformPath.dirname(gitCore);
  if (!REAL_GIT_FOLDERS.includes(lower(platformPath.basename(mingw)))) return null;
  const candidate = platformPath.join(mingw, "bin", "git.exe");
  return isFile(candidate) ? candidate : null;
}

// Pure and injectable (tests): platform, env, isFile, isDirectory, run. Returns a path or the plain word "git".
function resolveGitExecutable(options = {}) {
  try {
    const platform = options.platform || process.platform;
    if (platform !== "win32") return "git";
    const env = options.env || process.env;
    const isFile = options.isFile || defaultIsFile;
    const isDirectory = options.isDirectory || defaultIsDirectory;
    const found = firstGitOnPath(env, path.win32, isFile);
    if (!found) return "git";
    const sibling = siblingOfWrapper(found, path.win32, isFile, isDirectory);
    if (sibling) return sibling;
    return fromExecPath(found, env, path.win32, options.run || spawnSync, isFile) || "git";
  } catch { return "git"; }
}

let remembered = null;

// Once per process. A caller that passes nothing gets the remembered answer.
function gitExecutable() {
  if (remembered === null) remembered = resolveGitExecutable();
  return remembered;
}

// The remembered program could not be started: plain "git" from now on (and in tests: start over with null).
function forgetGitExecutable(replacement = "git") {
  remembered = replacement;
}

function resetGitExecutable() {
  remembered = null;
}

// The Git subcommand of an argument list, after the global options (-C <dir>, -c <k=v>, --git-dir=..., --no-pager, ...).
function gitSubcommand(args) {
  const list = Array.isArray(args) ? args : [];
  for (let index = 0; index < list.length; index++) {
    const word = String(list[index]);
    if (GLOBAL_OPTIONS_WITH_VALUE.has(word)) { index += 1; continue; }
    if (word.startsWith("-")) continue;
    return word;
  }
  return null;
}

// Reading calls get --no-optional-locks (no opportunistic index refresh, so no index.lock); anything else is unchanged.
function readGitArgs(args) {
  const list = Array.isArray(args) ? args.map(String) : [];
  if (list.includes("--no-optional-locks")) return list;
  const subcommand = gitSubcommand(list);
  return subcommand !== null && READ_ONLY_SUBCOMMANDS.has(subcommand) ? ["--no-optional-locks", ...list] : list;
}

function isUnstartable(error) {
  return Boolean(error) && UNSTARTABLE.has(error.code);
}

// spawnSync(real git, readGitArgs(args)); a program that cannot be started falls back to "git" once.
function gitSync(args, spawnOptions = {}, deps = {}) {
  const spawn = deps.spawnSync || spawnSync;
  const injected = Boolean(deps.executable); // a program the caller named is the caller's business, never replaced
  const executable = deps.executable || gitExecutable();
  const list = readGitArgs(args);
  const result = spawn(executable, list, spawnOptions);
  if (!injected && result && isUnstartable(result.error) && executable !== "git") {
    forgetGitExecutable();
    return spawn("git", list, spawnOptions);
  }
  return result;
}

module.exports = {
  REAL_GIT_FOLDERS,
  READ_ONLY_SUBCOMMANDS,
  forgetGitExecutable,
  gitExecutable,
  gitSubcommand,
  gitSync,
  isUnstartable,
  readGitArgs,
  resetGitExecutable,
  resolveGitExecutable,
};
