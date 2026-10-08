// Finds an open package amendment before gate-check writes into a package.
// Zero dependencies. Node 16+.
//
// An amendment (test-harness/harness-core/binding/package-amend.cjs) is one
// session record at <harnessRoot>/.unlazy/.amend/<sha256 of the session>.json.
// While it is open, `finish` proves that no checkbox and no EVIDENCE line of the
// package changed. gate-check ticks boxes and writes EVIDENCE, so a run during an
// open amendment would make that amendment impossible to finish
// (AMEND_EVIDENCE_CHANGED). gate-check therefore looks for the record first and
// stops before it runs or writes anything.
//
// Unlazy itself knows `.unlazy`; the exact location comes from the Harness
// configuration: a Harness root is a directory holding a regular
// `.keel-harness.json`, and `begin` only accepts a repository inside its Harness
// root (or equal to it). So every Harness root that can hold a record for a
// repository is the repository itself or one of its ancestors that carries that
// file. No environment variable or option is needed.
//
// Neither the repository nor the package id comes from the working directory or
// from --root: both are derived from each file that would be written (the Git
// worktree of the file, then docs/packages/<id>/ below it), so an absolute file
// path from outside the repository or a foreign --root cannot bypass the check.
//
// Git answers in one of three ways, and only one of them lets a file go:
//   - the worktree root                      -> the file belongs to that repository
//   - "not a git repository" (exit 128)      -> no repository: no record can name the file
//   - anything else (git not on PATH, a timeout, safe.directory, another exit,
//     an answer that is no path)             -> the probe FAILED, which says nothing
//                                               about the file
// A failed probe is never read as "no repository". The path itself then decides:
// a file below docs/packages/<id>/, or below a directory that holds a
// .unlazy/.amend with records, cannot be ruled out as part of an amended package,
// so the run stops with AMEND_UNCLEAR, names the file and the reason, and writes
// nothing. Any other file goes on with a warning.

import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

const repository = createRequire(import.meta.url)("./repository.cjs");

export const AMEND_OPEN = "AMEND_OPEN";
export const AMEND_UNCLEAR = "AMEND_UNCLEAR";
const HARNESS_CONFIG = ".keel-harness.json";
const MAX_RECORD_BYTES = 1024 * 1024;
const PACKAGE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const SAFE_ARGUMENT = /^[A-Za-z0-9._:@+=-]+$/u;

const canonical = (path) => {
  let value;
  try { value = (realpathSync.native || realpathSync)(resolve(path)); } catch { value = resolve(path); }
  return process.platform === "win32" ? value.toLowerCase() : value;
};

function regularFile(path) {
  try {
    const info = lstatSync(path);
    return info.isFile() && !info.isSymbolicLink() ? info : null;
  } catch { return null; }
}

// The repository and every ancestor holding a regular .keel-harness.json.
export function harnessRootsFor(repoRoot) {
  const roots = [];
  let current = resolve(repoRoot);
  try { current = (realpathSync.native || realpathSync)(current); } catch { /* keep the lexical path */ }
  for (;;) {
    if (regularFile(join(current, HARNESS_CONFIG))) roots.push(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return roots;
}

const quote = (value) => (SAFE_ARGUMENT.test(String(value)) ? String(value) : JSON.stringify(String(value)));

export function amendCommands(harnessRoot, record) {
  const script = join(harnessRoot, "harness-core", "execution", "package-amend.mjs");
  const base = "node \"" + script + "\"";
  const finish = base + " finish --harness-root \"" + harnessRoot + "\" --session " + quote(record.sessionId) + " --json";
  const undo = typeof record.snapshot === "string" && record.snapshot
    ? base + " undo --harness-root \"" + harnessRoot + "\" --root \"" + record.repoRoot + "\" --receipt \"" +
      record.snapshot + "\" --json"
    : null;
  return { finish, undo };
}

// Open amendments of the given packages in `repoRoot`.
// Returns { open: [{ packageId, sessionId, scope, createdAt, harnessRoot, record, finish, undo }],
//           unclear: [{ record, reason }], warnings: [] }.
// A well-formed record that names another package or another repository is
// skipped silently. A record that cannot be assigned safely to another package or
// repository (unreadable JSON, not a regular file, too large, unknown
// schemaVersion, missing or invalid fields) is reported in `unclear`: it might
// belong to this package, so the caller must stop instead of writing.
// `extraStarts` are further directories to search for Harness roots (the
// directory of each file that would be written).
export function findOpenAmendments(repoRoot, packageIds, extraStarts = []) {
  const wanted = new Set([...packageIds].map((id) => String(id).toLowerCase()));
  const result = { open: [], unclear: [], warnings: [] };
  if (!wanted.size) return result;
  const repo = canonical(repoRoot);
  const harnessRoots = new Set();
  for (const start of [repoRoot, ...extraStarts]) for (const root of harnessRootsFor(start)) harnessRoots.add(root);
  for (const harnessRoot of harnessRoots) {
    const directory = join(harnessRoot, ".unlazy", ".amend");
    if (!existsSync(directory)) continue;
    let names;
    try { names = readdirSync(directory); } catch (error) {
      result.unclear.push({ record: directory, reason: "cannot list the amend directory: " + error.message });
      continue;
    }
    for (const name of names.sort()) {
      if (!AMEND_RECORD_NAME.test(name)) continue;
      const file = join(directory, name);
      const info = regularFile(file);
      if (!info || info.size > MAX_RECORD_BYTES) {
        result.unclear.push({ record: file, reason: "not a regular file within " + MAX_RECORD_BYTES + " bytes" });
        continue;
      }
      let value;
      try { value = JSON.parse(readFileSync(file, "utf8")); } catch (error) {
        result.unclear.push({ record: file, reason: "unreadable record: " + error.message });
        continue;
      }
      if (!value || typeof value !== "object" || value.schemaVersion !== 1) {
        result.unclear.push({ record: file, reason: "unknown schemaVersion " + JSON.stringify(value && value.schemaVersion) });
        continue;
      }
      if (typeof value.sessionId !== "string" || typeof value.packageId !== "string" ||
          !PACKAGE_ID.test(value.packageId) || typeof value.repoRoot !== "string") {
        result.unclear.push({ record: file, reason: "missing or invalid sessionId, packageId or repoRoot" });
        continue;
      }
      if (!wanted.has(value.packageId.toLowerCase()) || canonical(value.repoRoot) !== repo) continue;
      const commands = amendCommands(harnessRoot, value);
      result.open.push({
        packageId: value.packageId, sessionId: value.sessionId, scope: value.scope || null,
        createdAt: value.createdAt || null, harnessRoot, record: file, ...commands,
      });
    }
  }
  return result;
}

function nearestDirectory(path) {
  let current = resolve(path);
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return current;
}

// Git's messages are matched as text, so they are asked for in English whatever
// the locale of the caller is.
const PROBE_ENV = { LC_ALL: "C", LANGUAGE: "C" };
const NOT_A_REPOSITORY = /not a git repository/iu;
const GIT_EXIT_NOT_A_REPOSITORY = 128;

const firstLine = (text) => String(text || "").trim().split(/\r?\n/u)[0] || "";

function probeFailure(error, result) {
  if (result && result.error) return "git could not be run: " + result.error.message;
  if (result && result.status !== 0) {
    const detail = firstLine(result.stderr) || firstLine(result.stdout);
    return "git exited " + result.status + (detail ? ": " + detail : "");
  }
  return error && error.message ? String(error.message) : String(error);
}

// Ask Git for the worktree root of `directory` (the same discovery as the package
// resolver). Result:
//   { state: "repo", repoRoot }   Git named the worktree root
//   { state: "none" }             Git said, explicitly, that this is no repository
//                                 (exit 128 with "not a git repository"): no
//                                 amendment record can name such a file
//   { state: "failed", reason }   the probe itself failed: git not found, a
//                                 timeout, safe.directory, any other exit, an
//                                 answer that is no path. Says nothing about the file.
// `options.runner` replaces spawnSync (tests).
export function probeRepository(directory, options = {}) {
  let last = null;
  const run = options.runner || spawnSync;
  const runner = (command, args, spawnOptions) => { last = run(command, args, spawnOptions); return last; };
  try {
    return { state: "repo", repoRoot: repository.resolveRepositoryRoot(directory, { env: PROBE_ENV, runner }) };
  } catch (error) {
    if (last && !last.error && last.status === GIT_EXIT_NOT_A_REPOSITORY && NOT_A_REPOSITORY.test(String(last.stderr || ""))) {
      return { state: "none" };
    }
    return { state: "failed", reason: probeFailure(error, last) };
  }
}

const SEPARATOR = process.platform === "win32" ? "\\" : "/";
const AMEND_RECORD_NAME = /^[0-9a-f]{64}\.json$/u;

// The package id of a path that runs through docs/packages/<id>/<something>, at
// any depth (a canonical path, so this also covers a repository we could not find).
function packageSegment(path) {
  const parts = String(path).split(/[\\/]+/u);
  for (let index = 0; index + 3 < parts.length; index++) {
    if (parts[index].toLowerCase() === "docs" && parts[index + 1].toLowerCase() === "packages" &&
        PACKAGE_ID.test(parts[index + 2])) return parts[index + 2];
  }
  return null;
}

// Why a file whose repository could not be probed must not be written to: the
// path runs through docs/packages/<id>/, or a directory above it holds amendment
// records. Null when nothing speaks for an amendment.
function probeFallback(path) {
  const id = packageSegment(path);
  if (id) return "the file lies in docs/packages/" + id + "/, so it may belong to an amended package";
  for (let directory = dirname(path); ; directory = dirname(directory)) {
    const amendDirectory = join(directory, ".unlazy", ".amend");
    if (existsSync(amendDirectory)) {
      let names;
      try { names = readdirSync(amendDirectory); } catch (error) {
        return "cannot list " + amendDirectory + " above the file: " + error.message;
      }
      if (names.some((name) => AMEND_RECORD_NAME.test(name))) {
        return amendDirectory + " above the file holds amendment records that may name it";
      }
    }
    if (dirname(directory) === directory) break;
  }
  return null;
}

// Repository root and package id of one file, found from the file itself and
// never from the working directory or --root: <repo>/docs/packages/<id>/...
// Both the lexical path and the one with symbolic links resolved are used,
// because the write lands on the real file.
// Result: { found: [{ repoRoot, packageId, directory }],
//           unclear: [{ record: <file>, reason, kind: "file" }], warnings: [] }
// `unclear` holds the files whose repository Git could not tell (see the top of
// this file); `cache` shares the probe of one directory between files.
export function locateFile(file, cache = new Map()) {
  const result = { found: [], unclear: [], warnings: [] };
  const named = resolve(file);
  const candidates = new Set([named]);
  try { candidates.add((realpathSync.native || realpathSync)(named)); } catch { /* new file: lexical only */ }
  for (const path of candidates) {
    const directory = nearestDirectory(dirname(path));
    let probe = cache.get(directory);
    if (!probe) { probe = probeRepository(directory); cache.set(directory, probe); }
    if (probe.state === "none") continue;
    if (probe.state === "failed") {
      const why = probeFallback(path);
      if (why) {
        result.unclear.push({ record: named, kind: "file", reason: "the Git repository of the file could not be determined (" + probe.reason + "); " + why });
      } else {
        result.warnings.push("the Git repository of " + named + " could not be determined (" + probe.reason +
          "); the path names no package and no amendment record lies above it, so the amendment check goes on without it");
      }
      continue;
    }
    const base = canonical(join(probe.repoRoot, "docs", "packages"));
    const here = canonical(path);
    const id = here.startsWith(base + SEPARATOR) ? here.slice(base.length + 1).split(/[\\/]/u)[0] : null;
    result.found.push({ repoRoot: probe.repoRoot, packageId: id || null, directory });
  }
  return result;
}

// Repository root and package id of one file as { repoRoot, packageId, directory }
// entries; a file whose repository could not be determined has none (see locateFile).
export function packageOfFile(file) {
  return locateFile(file).found;
}

// Open amendments for the packages that a run writing into `files` touches.
// Repository and package id come from each file itself. Result as
// findOpenAmendments; `unclear` also holds { record: <file>, kind: "file", reason }
// for each file whose repository Git could not tell and that cannot be ruled out.
export function findOpenAmendmentsForFiles(files) {
  const byRepo = new Map();
  const combined = { open: [], unclear: [], warnings: [] };
  const seen = new Set();
  const cache = new Map();
  for (const file of files) {
    const located = locateFile(file, cache);
    for (const item of located.unclear) {
      const key = "f|" + item.record + "|" + item.reason;
      if (!seen.has(key)) { seen.add(key); combined.unclear.push(item); }
    }
    for (const warning of located.warnings) {
      const key = "w|" + warning;
      if (!seen.has(key)) { seen.add(key); combined.warnings.push(warning); }
    }
    for (const item of located.found) {
      if (!item.packageId) continue;
      const entry = byRepo.get(item.repoRoot) || { ids: new Set(), starts: new Set() };
      entry.ids.add(item.packageId);
      entry.starts.add(item.directory);
      byRepo.set(item.repoRoot, entry);
    }
  }
  for (const [repoRoot, entry] of byRepo) {
    const part = findOpenAmendments(repoRoot, entry.ids, [...entry.starts]);
    for (const amend of part.open) {
      const key = amend.record + "|" + amend.packageId;
      if (!seen.has(key)) { seen.add(key); combined.open.push(amend); }
    }
    for (const item of part.unclear) {
      const key = "u|" + item.record;
      if (!seen.has(key)) { seen.add(key); combined.unclear.push(item); }
    }
    combined.warnings.push(...part.warnings);
  }
  return combined;
}

// Package ids that a run over these ledger files can write into: every file
// below <repoRoot>/docs/packages/<id>/.
export function packageIdsOfLedgers(repoRoot, files) {
  const ids = new Set();
  const base = canonical(join(repoRoot, "docs", "packages"));
  for (const file of files) {
    const path = canonical(file);
    if (!path.startsWith(base + SEPARATOR)) continue;
    const [id] = path.slice(base.length + 1).split(/[\\/]/u);
    if (id) ids.add(id);
  }
  return ids;
}
