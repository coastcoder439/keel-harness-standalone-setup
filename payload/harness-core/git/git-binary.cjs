"use strict";

// Product adapter to the one canonical Git helper shipped with Unlazy (P20: one source, no byte-identical copy).
// Source development uses the sibling vendor tree; standalone delivery embeds vendor below the installed Harness root.
// Exactly one candidate must exist. Hooks load this file inside try/catch and fall back to plain git.

const fs = require("node:fs");
const path = require("node:path");

const candidates = [
  path.resolve(__dirname, "..", "..", "vendor", "unlazy", "scripts", "lib", "git-binary.cjs"),
  path.resolve(__dirname, "..", "..", "..", "vendor", "unlazy", "scripts", "lib", "git-binary.cjs"),
].filter((file) => fs.existsSync(file));

if (candidates.length !== 1) {
  throw new Error("expected exactly one canonical Unlazy git helper; found " + candidates.length);
}

module.exports = require(candidates[0]);
