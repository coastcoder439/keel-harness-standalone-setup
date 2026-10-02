// Project roadmap: one docs/roadmap.json per repository with ordered
// milestones and the packages linked to them. The roadmap is optional and
// lives outside docs/packages, so package bundles stay the only package truth.
// Zero dependencies. Node 16+.
//
// The module never writes to stdout and never exits the process, so a reader
// such as a dashboard can load it with a dynamic import in its own process.

import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { writeAtomic } from "./gates.mjs";

const require = createRequire(import.meta.url);
const { assertNoLinkedComponent, validatePackageId } = require("./package-context.cjs");

export const PROJECT_ROADMAP_SCHEMA_VERSION = 1;
export const PROJECT_ROADMAP_PATH = "docs/roadmap.json";

const ABSENT_REVISION = "absent";
const MILESTONE_ID_RE = /^m[1-9][0-9]*$/;
const DUE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const LINE_BREAK_RE = /[\r\n\u0085\u2028\u2029]/u;
const MAX_TITLE_LENGTH = 120;
const MILESTONE_KEYS = ["id", "title", "due", "packages"];
const ROOT_KEYS = ["schemaVersion", "milestones"];

const HINT = "optional: this project has no roadmap yet; plan milestones with package-cli roadmap-add " +
  "--title TEXT [--due YYYY-MM-DD] and link packages with package-cli roadmap-assign --package ID --milestone ID";

export function roadmapHint() {
  return HINT;
}

function roadmapError(code, message) {
  const error = new Error(code + ": " + message);
  error.code = code;
  error.exitCode = 2;
  return error;
}

function canonicalRoot(root) {
  return (realpathSync.native || realpathSync)(String(root));
}

function roadmapFile(root) {
  return join(root, "docs", "roadmap.json");
}

function idKey(value) {
  return process.platform === "win32" ? value.toLowerCase() : value;
}

function sameKeys(value, keys) {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function titleProblem(title) {
  if (typeof title !== "string") return "title must be a string";
  const length = Array.from(title).length;
  if (length < 1 || length > MAX_TITLE_LENGTH) {
    return "title must have 1 to " + MAX_TITLE_LENGTH + " characters, got " + length;
  }
  if (LINE_BREAK_RE.test(title)) return "title must be one line";
  return null;
}

function dueProblem(due) {
  if (due === null) return null;
  const match = typeof due === "string" ? DUE_RE.exec(due) : null;
  if (!match) return "due must be a calendar date YYYY-MM-DD or null, got " + JSON.stringify(due);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return "due is not a real calendar date: " + due;
  }
  return null;
}

// Validates the parsed document; returns the first reason it is invalid or null.
function schemaProblem(document) {
  if (!isPlainObject(document)) return "the roadmap must be a JSON object";
  if (!sameKeys(document, ROOT_KEYS)) return "the roadmap must have exactly the keys " + ROOT_KEYS.join(", ");
  if (document.schemaVersion !== PROJECT_ROADMAP_SCHEMA_VERSION) {
    return "schemaVersion must be " + PROJECT_ROADMAP_SCHEMA_VERSION;
  }
  if (!Array.isArray(document.milestones)) return "milestones must be an array";
  const ids = new Set();
  const packages = new Map();
  for (let index = 0; index < document.milestones.length; index++) {
    const milestone = document.milestones[index];
    const label = "milestone " + (index + 1);
    if (!isPlainObject(milestone)) return label + " must be an object";
    if (!sameKeys(milestone, MILESTONE_KEYS)) return label + " must have exactly the keys " + MILESTONE_KEYS.join(", ");
    if (typeof milestone.id !== "string" || !MILESTONE_ID_RE.test(milestone.id)) {
      return label + " has an invalid id " + JSON.stringify(milestone.id);
    }
    if (ids.has(milestone.id)) return "milestone id " + milestone.id + " is not unique";
    ids.add(milestone.id);
    const title = titleProblem(milestone.title);
    if (title) return milestone.id + ": " + title;
    if (milestone.title !== milestone.title.trim()) return milestone.id + ": title must be stored trimmed";
    const due = dueProblem(milestone.due);
    if (due) return milestone.id + ": " + due;
    if (!Array.isArray(milestone.packages)) return milestone.id + ": packages must be an array";
    for (const packageId of milestone.packages) {
      const invalid = validatePackageId(packageId);
      if (invalid) return milestone.id + ": " + invalid;
      const key = idKey(packageId);
      if (packages.has(key)) {
        return "package " + packageId + " is linked twice (" + packages.get(key) + " and " + milestone.id + ")";
      }
      packages.set(key, milestone.id);
    }
  }
  return null;
}

function cloneMilestones(milestones) {
  return milestones.map((milestone) => ({
    id: milestone.id,
    title: milestone.title,
    due: milestone.due,
    packages: milestone.packages.slice(),
  }));
}

// Reads the raw state of docs/roadmap.json without judging package links.
function loadRoadmap(root) {
  const file = roadmapFile(root);
  let info;
  try { info = lstatSync(file); }
  catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") {
      return { present: false, revision: ABSENT_REVISION, milestones: [], problem: null };
    }
    throw error;
  }
  if (info.isSymbolicLink()) return { present: true, revision: "linked", milestones: [], problem: "the roadmap must not be a link" };
  if (!info.isFile()) return { present: true, revision: "not-a-file", milestones: [], problem: "the roadmap must be a regular file" };
  const bytes = readFileSync(file);
  const revision = createHash("sha256").update(bytes).digest("hex");
  let problem = null;
  try { assertNoLinkedComponent(root, file); }
  catch { problem = "a path component of the roadmap is a link"; }
  if (!problem && typeof info.nlink === "number" && info.nlink !== 1) problem = "the roadmap must be a single-link file";
  let document = null;
  if (!problem) {
    try { document = JSON.parse(bytes.toString("utf8")); }
    catch (error) { problem = "the roadmap is not valid JSON: " + error.message; }
  }
  if (!problem) problem = schemaProblem(document);
  if (problem) return { present: true, revision, milestones: [], problem };
  return { present: true, revision, milestones: cloneMilestones(document.milestones), problem: null };
}

// One readdirSync of docs/packages per call: bundle directories and flat
// package files keyed like resolvePackageBundle (case-folded on Windows).
function packageIndex(root) {
  const directory = join(root, "docs", "packages");
  const bundles = new Map();
  const flat = new Map();
  let entries = [];
  try {
    const info = lstatSync(directory);
    if (!info.isSymbolicLink() && info.isDirectory()) entries = readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (!validatePackageId(entry.name)) bundles.set(idKey(entry.name), entry.name);
    } else if (entry.isFile() && idKey(entry.name).endsWith(".md")) {
      const name = entry.name.slice(0, -3);
      if (!validatePackageId(name)) flat.set(idKey(name), name);
    }
  }
  const lookup = (packageId) => {
    const key = idKey(packageId);
    const bundle = bundles.get(key);
    if (bundle !== undefined) {
      try {
        const info = lstatSync(join(directory, bundle, "PACKAGE.md"));
        if (!info.isSymbolicLink() && info.isFile()) return bundle;
      } catch (error) {
        if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
      }
    }
    const flatName = flat.get(key);
    return flatName === undefined ? null : flatName;
  };
  return { lookup };
}

function publicRoadmap(root, loaded) {
  const diagnostics = [];
  if (loaded.problem) {
    diagnostics.push({ code: "ROADMAP_INVALID", file: PROJECT_ROADMAP_PATH, message: loaded.problem });
  } else if (loaded.milestones.some((milestone) => milestone.packages.length)) {
    const index = packageIndex(root);
    for (const milestone of loaded.milestones) {
      for (const packageId of milestone.packages) {
        if (index.lookup(packageId) === null) {
          diagnostics.push({
            code: "ROADMAP_PACKAGE_MISSING",
            file: PROJECT_ROADMAP_PATH,
            message: "package " + packageId + " linked to milestone " + milestone.id + " does not exist",
          });
        }
      }
    }
  }
  return {
    schemaVersion: PROJECT_ROADMAP_SCHEMA_VERSION,
    path: PROJECT_ROADMAP_PATH,
    present: loaded.present,
    revision: loaded.revision,
    milestones: loaded.problem ? [] : loaded.milestones,
    diagnostics,
  };
}

export function readProjectRoadmap(root) {
  const repoRoot = canonicalRoot(root);
  return publicRoadmap(repoRoot, loadRoadmap(repoRoot));
}

// Reloads the file right before a write: revision first, then validity.
function loadForWrite(root, expectedRevision) {
  if (typeof expectedRevision !== "string") throw new TypeError("expectedRevision must be a string");
  const loaded = loadRoadmap(root);
  if (loaded.revision !== expectedRevision) {
    throw roadmapError("ROADMAP_CHANGED", PROJECT_ROADMAP_PATH + " changed (expected revision " +
      expectedRevision + ", found " + loaded.revision + ")");
  }
  if (loaded.problem) {
    throw roadmapError("ROADMAP_INVALID", PROJECT_ROADMAP_PATH + " is invalid and is never overwritten: " + loaded.problem);
  }
  return loaded;
}

function existingPackage(root, packageId) {
  const invalid = typeof packageId === "string" ? validatePackageId(packageId) : "packageId must be a string";
  if (invalid) throw roadmapError("ROADMAP_PACKAGE_UNKNOWN", invalid);
  const name = packageIndex(root).lookup(packageId);
  if (name === null) {
    throw roadmapError("ROADMAP_PACKAGE_UNKNOWN", "no package bundle docs/packages/" + packageId +
      "/PACKAGE.md and no flat package docs/packages/" + packageId + ".md");
  }
  return name;
}

function withoutPackage(milestones, packageId) {
  const key = idKey(packageId);
  let removed = false;
  for (const milestone of milestones) {
    const kept = milestone.packages.filter((item) => idKey(item) !== key);
    if (kept.length !== milestone.packages.length) removed = true;
    milestone.packages = kept;
  }
  return removed;
}

function writeRoadmap(root, milestones) {
  const file = roadmapFile(root);
  assertNoLinkedComponent(root, file);
  const document = {
    schemaVersion: PROJECT_ROADMAP_SCHEMA_VERSION,
    milestones: milestones.map((milestone) => ({
      id: milestone.id,
      title: milestone.title,
      due: milestone.due,
      packages: milestone.packages,
    })),
  };
  writeAtomic(file, JSON.stringify(document, null, 2) + "\n");
}

export function addRoadmapMilestone(root, { title, due = null, packageId = null, expectedRevision } = {}) {
  const repoRoot = canonicalRoot(root);
  const loaded = loadForWrite(repoRoot, expectedRevision);
  const stored = typeof title === "string" ? title.trim() : title;
  const titleInvalid = titleProblem(stored);
  if (titleInvalid) throw roadmapError("ROADMAP_TITLE", titleInvalid);
  const dueInvalid = dueProblem(due);
  if (dueInvalid) throw roadmapError("ROADMAP_DUE", dueInvalid);
  const linked = packageId === null ? null : existingPackage(repoRoot, packageId);
  const milestones = loaded.milestones;
  const highest = milestones.reduce((max, milestone) => Math.max(max, Number(milestone.id.slice(1))), 0);
  const milestone = { id: "m" + (highest + 1), title: stored, due, packages: [] };
  if (linked !== null) {
    withoutPackage(milestones, linked);
    milestone.packages.push(linked);
  }
  milestones.push(milestone);
  writeRoadmap(repoRoot, milestones);
  const roadmap = publicRoadmap(repoRoot, loadRoadmap(repoRoot));
  const written = roadmap.milestones.find((item) => item.id === milestone.id) || milestone;
  return { roadmap, milestone: written };
}

export function assignRoadmapPackage(root, { packageId, milestoneId, expectedRevision } = {}) {
  const repoRoot = canonicalRoot(root);
  const loaded = loadForWrite(repoRoot, expectedRevision);
  const milestones = loaded.milestones;
  if (milestoneId === null) {
    const invalid = typeof packageId === "string" ? validatePackageId(packageId) : "packageId must be a string";
    if (invalid) throw roadmapError("ROADMAP_PACKAGE_UNKNOWN", invalid);
    if (withoutPackage(milestones, packageId)) writeRoadmap(repoRoot, milestones);
    return { roadmap: publicRoadmap(repoRoot, loadRoadmap(repoRoot)) };
  }
  const target = milestones.find((milestone) => milestone.id === milestoneId);
  if (!target) throw roadmapError("ROADMAP_MILESTONE_UNKNOWN", "no milestone " + JSON.stringify(milestoneId));
  const linked = existingPackage(repoRoot, packageId);
  const key = idKey(linked);
  const alreadyThere = target.packages.some((item) => item === linked) &&
    milestones.every((milestone) => milestone === target || !milestone.packages.some((item) => idKey(item) === key));
  if (!alreadyThere) {
    withoutPackage(milestones, linked);
    target.packages.push(linked);
    writeRoadmap(repoRoot, milestones);
  }
  return { roadmap: publicRoadmap(repoRoot, loadRoadmap(repoRoot)) };
}
