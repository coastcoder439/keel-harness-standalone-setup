"use strict";

// Cross-package ownership boundary (completeness audit 06.09.2026, B1).
//
// The vendored Unlazy schema proves disjoint OWNS only INSIDE one package. Two packages that are
// active at the same time in one repository could each claim the same file, and every guard that
// authorizes a write through "the bound leaf owns this path" would accept both. This module reads
// every active scope (`.unlazy/<scope>/package.ref`) and compares the OWNS declarations of the
// package being activated against every other active package; the executor refuses activation
// with PACKAGE_CROSS_OWNERSHIP_OVERLAP while such a claim exists.
//
// normalizeOwnsGlob and globsOverlap are a verbatim port of vendor/unlazy/scripts/lib/gates.mjs
// (ESM, which this CommonJS binding layer cannot require synchronously).
// test/package-ownership.test.js measures both implementations against the same pattern table,
// so a drift fails a test instead of silently relaxing the boundary.

const fs = require("node:fs");
const path = require("node:path");
const packageBinding = require("./package-binding.cjs");

const PACKAGE_REF = /^docs\/packages\/([A-Za-z0-9][A-Za-z0-9._-]{0,63})\r?\n?$/u;

function normalizeOwnsGlob(value) {
  const raw = String(value || "").trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (!raw) return { error: "OWNS path is blank" };
  if (path.isAbsolute(raw) || /^[A-Za-z]:\//.test(raw) || raw.startsWith("//")) {
    return { error: "OWNS path must be relative: " + value };
  }
  const parts = raw.split("/");
  if (raw.includes("\0") || parts.some((part) => part === "..")) {
    return { error: "OWNS path cannot contain traversal: " + value };
  }
  const normalized = parts.filter((part) => part !== "" && part !== ".").join("/");
  if (!normalized || normalized === ".") return { error: "OWNS path cannot claim an implicit root" };
  return { value: normalized };
}

function globsOverlap(left, right) {
  const a = normalizeOwnsGlob(left);
  const b = normalizeOwnsGlob(right);
  if (a.error || b.error) return true;
  const as = a.value.split("/");
  const bs = b.value.split("/");
  const count = Math.min(as.length, bs.length);
  for (let index = 0; index < count; index++) {
    const av = as[index], bv = bs[index];
    if (/[*?[{]/.test(av) || /[*?[{]/.test(bv)) return true;
    if (av !== bv) return false;
  }
  // An exact prefix may denote a directory ownership claim, so it can overlap
  // every descendant. Treat common-prefix length differences as conflicts.
  if (as.length !== bs.length) return true;
  return true;
}

function regularFile(file) {
  try {
    const info = fs.lstatSync(file);
    return info.isFile() && !info.isSymbolicLink() && (typeof info.nlink !== "number" || info.nlink === 1);
  } catch {
    return false;
  }
}

// Every scope whose package.ref names a package bundle. A scope with an unreadable reference is
// reported as invalid, never silently skipped.
function activeScopes(repoRoot) {
  const runtime = path.join(repoRoot, ".unlazy");
  if (!fs.existsSync(runtime)) return { scopes: [], invalid: [] };
  const scopes = [];
  const invalid = [];
  for (const entry of fs.readdirSync(runtime, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name === "locks" || entry.name.startsWith(".")) continue;
    const ref = path.join(runtime, entry.name, "package.ref");
    if (!fs.existsSync(ref)) continue;
    if (!regularFile(ref)) { invalid.push({ scope: entry.name, reason: "package.ref is not one regular file" }); continue; }
    const match = fs.readFileSync(ref, "utf8").match(PACKAGE_REF);
    if (!match) { invalid.push({ scope: entry.name, reason: "package.ref is malformed" }); continue; }
    scopes.push({ scope: entry.name, packageId: match[1] });
  }
  scopes.sort((left, right) => left.scope.localeCompare(right.scope, "en"));
  return { scopes, invalid };
}

// OWNS claims of one package: every gates/leaf-*.md with exactly one OWNS line. A leaf without a
// valid OWNS line owns nothing here and is reported; the package schema rejects it on activation.
function packageOwnership(repoRoot, packageId) {
  const gatesDir = path.join(repoRoot, "docs", "packages", packageId, "gates");
  const claims = [];
  const invalid = [];
  if (!fs.existsSync(gatesDir)) return { claims, invalid };
  const entries = fs.readdirSync(gatesDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, "en"));
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink() || !/^leaf-[A-Za-z0-9][A-Za-z0-9._-]*\.md$/u.test(entry.name)) continue;
    const leaf = entry.name.replace(/\.md$/u, "");
    let owns;
    try { owns = packageBinding.leafOwnsFromText(fs.readFileSync(path.join(gatesDir, entry.name), "utf8")); }
    catch (error) { invalid.push({ leaf, reason: error.message }); continue; }
    for (const pattern of owns) claims.push({ leaf, pattern });
  }
  return { claims, invalid };
}

function crossPackageOverlaps(repoRoot, packageId, scope) {
  const { scopes } = activeScopes(repoRoot);
  const own = packageOwnership(repoRoot, packageId).claims;
  const conflicts = [];
  for (const other of scopes) {
    if (other.scope === scope) continue;
    if (other.packageId === packageId) {
      conflicts.push({ kind: "same-package", scope: other.scope, packageId: other.packageId });
      continue;
    }
    const theirs = packageOwnership(repoRoot, other.packageId).claims;
    for (const mine of own) {
      for (const claim of theirs) {
        if (!globsOverlap(mine.pattern, claim.pattern)) continue;
        conflicts.push({ kind: "owns-overlap", scope: other.scope, packageId: other.packageId,
          leaf: mine.leaf, pattern: mine.pattern, otherLeaf: claim.leaf, otherPattern: claim.pattern });
      }
    }
  }
  return conflicts;
}

function describeConflict(conflict) {
  if (conflict.kind === "same-package") return "package " + conflict.packageId + " is already active in scope " + conflict.scope;
  return conflict.packageId + " (scope " + conflict.scope + ") " + conflict.otherLeaf + " OWNS " + conflict.otherPattern +
    " overlaps " + conflict.leaf + " OWNS " + conflict.pattern;
}

// The refusal text for an activation blocked by another active package. The first line is the
// executor's historic message byte for byte; each distinct blocking package with an OWNS overlap
// then gets one NEXT line with the resolve preview that offers to merge, update or withdraw it,
// because a refusal without a way out left the caller stuck (Owner 01.10.2026: "Blockiert ein
// aktives Paket ein neues, nennt die Meldung das blockierende Paket und diesen Befehl.").
function overlapMessage(conflicts, options = {}) {
  const list = Array.isArray(conflicts) ? conflicts : [];
  const harnessRoot = path.resolve(options.harnessRoot || path.resolve(__dirname, "..", ".."));
  const repoRoot = path.resolve(options.repoRoot || process.cwd());
  const script = path.join(harnessRoot, "harness-core", "execution", "package-resolve.mjs");
  const lines = ["another active package claims ownership this package needs: " +
    list.slice(0, 5).map(describeConflict).join("; ")];
  const blocking = [];
  for (const conflict of list) {
    if (conflict.kind !== "owns-overlap" || blocking.includes(conflict.packageId)) continue;
    blocking.push(conflict.packageId);
  }
  for (const packageId of blocking) {
    lines.push("NEXT: node \"" + script + "\" resolve --harness-root \"" + harnessRoot + "\" --root \"" + repoRoot +
      "\" --package " + packageId + " --json (Vorschau: zusammenführen, aktualisieren oder stilllegen)");
  }
  return lines.join("\n");
}

module.exports = { activeScopes, crossPackageOverlaps, describeConflict, globsOverlap, normalizeOwnsGlob, overlapMessage, packageOwnership };
