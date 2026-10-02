"use strict";

// ONE resolver for the Unlazy tree, shared by the gate parser in git-intent.mjs,
// by the gate RUNNER in package-executor.mjs (it imports locateUnlazy from
// git-intent.mjs, which re-exports it from here) and by the CommonJS package
// bootstrap, which must see exactly the same candidates. Two resolvers meant an
// explicit --unlazy-root could hand the tolerance decision to a different parser
// than the one that executed the gates; the shared candidate list and the shared
// boundary below remove that second answer.
// The boundary is a realpath containment test, not a string prefix: an explicit
// root is accepted only when its own scripts/ files really live under the
// addressed repository's vendor/unlazy or under the Harness tree that ships
// next to this file. Proven by "the gate parser resolves from the Unlazy tree
// the caller runs" in test/git-intent.test.js, which drives both shipped layouts.

const fs = require("node:fs");
const path = require("node:path");
const repository = require("./repository.cjs");

const harnessTree = path.resolve(__dirname, "..", "..");

function fail(code, message, exitCode = 2) {
  const error = new Error(message);
  error.code = code;
  error.exitCode = exitCode;
  throw error;
}

function unlazyBases(repoRoot) {
  const root = repoRoot ? path.resolve(repoRoot) : null;
  const bases = [path.join(harnessTree, "vendor", "unlazy")];
  if (root) bases.push(path.join(root, "vendor", "unlazy"));
  // The source layout keeps the Harness tree as a SUBDIRECTORY of the repository
  // that vendors Unlazy at its own root, so the directory ABOVE the Harness tree
  // is a base there. The standalone layout ships harness-core/ and vendor/ as
  // siblings AT the repository root, where that same directory sits outside the
  // repository -- so it is a base only while the Harness tree is not itself the
  // addressed repository root. Measured 02.09.2026 in the standalone-shaped
  // fixture of the test above: without this condition locateUnlazy accepted a
  // vendor/unlazy copy one level above the repository.
  if (!root || !repository.samePath(harnessTree, root)) {
    bases.push(path.join(path.dirname(harnessTree), "vendor", "unlazy"));
  }
  return [...new Set(bases)];
}

function insideAnyBase(bases, candidate) {
  for (const base of bases) {
    let resolvedBase = path.resolve(base);
    try { resolvedBase = fs.realpathSync(resolvedBase); } catch { /* absent base cannot contain anything */ }
    const relative = path.relative(resolvedBase, candidate);
    if (relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)) return true;
  }
  return false;
}

// The single existence probe for an Unlazy tree: the parser git-intent.mjs needs
// and the two runner entry points package-executor.mjs spawns.
const UNLAZY_MARKERS = [
  ["scripts", "lib", "gates.mjs"],
  ["scripts", "package-cli.mjs"],
  ["scripts", "gate-check.mjs"],
];

function completeRuntime(root) {
  return UNLAZY_MARKERS.every((marker) => fs.existsSync(path.join(root, ...marker)));
}

function unlazyRootCandidates(repoRoot, explicit) {
  // An explicit root is the ONLY candidate: silently falling back to another
  // vendored tree would let a different parser decide the tolerance than the one
  // that executed the gates, which is the whole reason this is bound at all.
  return explicit ? [path.resolve(explicit)] : unlazyBases(repoRoot);
}

// The runtime that ships next to this Harness tree (inside it in the standalone
// layout, beside it in the source layout), or null. It is the example the
// ambiguity message offers, because running with exactly that root is the
// measured working call for a package in a sub-repository that vendors its own
// Unlazy runtime.
function harnessRuntime() {
  for (const root of [path.join(harnessTree, "vendor", "unlazy"),
    path.join(path.dirname(harnessTree), "vendor", "unlazy")]) {
    if (completeRuntime(root)) return fs.realpathSync(root);
  }
  return null;
}

function locateUnlazy(repoRoot, explicit) {
  const bases = unlazyBases(repoRoot);
  const candidates = unlazyRootCandidates(repoRoot, explicit);
  const found = [...new Set(candidates.filter(completeRuntime).map((root) => fs.realpathSync(root)))];
  // Without an explicit root, two differing vendored trees are an ambiguity to
  // refuse rather than to resolve by candidate order. The message names every
  // runtime it found and the switch that resolves it, because the bare count
  // left the caller without a way out (Owner 01.10.2026: "Findet der Harness
  // zwei Unlazy-Laufzeiten, nennt die Meldung beide Pfade und den Schalter
  // `--unlazy-root` mit einem Beispiel.").
  if (found.length !== 1) {
    let message = "expected exactly one canonical Unlazy runtime; found " + found.length;
    if (found.length === 0) message += "; searched: " + candidates.join(", ");
    else if (!explicit) {
      const example = harnessRuntime() || found[0];
      message += ": " + found.join(", ") + ". Choose one with --unlazy-root, for example --unlazy-root \"" + example + "\"";
    }
    fail("GATE_PARSER", message);
  }
  const resolved = found[0];
  if (!insideAnyBase(bases, fs.realpathSync(path.join(resolved, ...UNLAZY_MARKERS[0])))) {
    fail("GATE_PARSER", "Unlazy runtime is outside the repository vendor tree and the Harness tree: " + resolved);
  }
  return resolved;
}

module.exports = { locateUnlazy, unlazyRootCandidates, harnessRuntime, UNLAZY_MARKERS };
