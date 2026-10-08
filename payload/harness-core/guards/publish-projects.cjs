"use strict";

// Owner list publishProjects of .claude/mutation-policy.json (package P3, E1): the project
// repositories below the installation root whose current branch an agent may publish through
// git-intent (plan-publish, then publish) without a closed package. An entry is the Owner's
// general OK for that project (D16): no sentence per push, and never a force push, another
// branch or another remote. Agents never write the policy file (write-guard W4).
//
// One reader for every consumer, so that the shell guard (which blocks every executable
// classification while the policy is invalid) and git-intent (which publishes) judge the same
// entry the same way. Invalid entries are fail-closed: the reader reports an error and no project.

const fs = require("node:fs");
const path = require("node:path");

const POLICY_RELATIVE = [".claude", "mutation-policy.json"];

function key(value) {
  const text = path.resolve(String(value)).split(path.sep).join("/");
  return process.platform === "win32" ? text.toLowerCase() : text;
}

function realDirectory(target) {
  try {
    const info = fs.lstatSync(target);
    return !info.isSymbolicLink() && info.isDirectory();
  } catch { return false; }
}

// null when the entry is a usable publish project, else the reason. The entry must be a relative
// path below the installation root that names one real directory carrying its own .git (a
// directory, or the regular file of a worktree); it can never be the installation root itself.
function publishProjectProblem(root, entry) {
  if (typeof entry !== "string" || !entry.trim()) return "entries must be non-empty strings";
  if (entry.includes("\0") || /^[A-Za-z]:/u.test(entry) || /^[\\/]/u.test(entry) ||
      entry.split(/[\\/]/u).some((part) => part === ".." || part === "." || part === "")) {
    return "unsafe path " + JSON.stringify(entry);
  }
  const full = path.join(root, ...entry.split(/[\\/]/u));
  if (!key(full).startsWith(key(root) + "/")) return "path escapes the installation root: " + entry;
  if (!realDirectory(full)) return "project is not one real directory: " + entry;
  let marker;
  try { marker = fs.lstatSync(path.join(full, ".git")); }
  catch { return "project is not a Git repository root (no .git): " + entry; }
  if (marker.isSymbolicLink() || !(marker.isDirectory() || marker.isFile())) {
    return "project .git is neither a directory nor a regular file: " + entry;
  }
  return null;
}

// Validates the publishProjects value of an already parsed policy. { error, projects } with the
// projects as absolute paths below root. A missing value is the empty list.
function publishProjectsFromValue(root, value) {
  const list = value === undefined ? [] : value;
  if (!Array.isArray(list)) return { error: "publishProjects must be an array", projects: [] };
  const projects = [];
  for (const entry of list) {
    const problem = publishProjectProblem(root, entry);
    if (problem) return { error: "publishProjects: " + problem, projects: [] };
    projects.push(path.join(root, ...String(entry).split(/[\\/]/u)));
  }
  return { error: null, projects };
}

// Reads the policy file of the installation root and returns { present, error, projects }.
// No file is no list (present: false). An unreadable or invalid file is an error, never a list.
function loadPublishProjects(installationRoot) {
  const root = path.resolve(String(installationRoot || ""));
  const file = path.join(root, ...POLICY_RELATIVE);
  let info;
  try { info = fs.lstatSync(file); }
  catch { return { present: false, error: null, projects: [] }; }
  if (!info.isFile() || info.isSymbolicLink()) {
    return { present: true, error: "policy file must be one regular file", projects: [] };
  }
  let value;
  try { value = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) { return { present: true, error: "policy file is not valid JSON: " + error.message, projects: [] }; }
  if (!value || typeof value !== "object" || Array.isArray(value) || value.schemaVersion !== 1) {
    return { present: true, error: "schemaVersion must be 1", projects: [] };
  }
  return { present: true, ...publishProjectsFromValue(root, value.publishProjects) };
}

module.exports = { loadPublishProjects, publishProjectProblem, publishProjectsFromValue };
