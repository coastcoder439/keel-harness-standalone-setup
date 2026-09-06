"use strict";

// Product adapter to the one canonical resolver shipped with Unlazy. Source
// development uses the sibling vendor tree; standalone delivery embeds vendor
// below the installed Harness root. Exactly one candidate must exist.

const fs = require("node:fs");
const path = require("node:path");

const candidates = [
  path.resolve(__dirname, "..", "..", "vendor", "unlazy", "scripts", "lib", "repository.cjs"),
  path.resolve(__dirname, "..", "..", "..", "vendor", "unlazy", "scripts", "lib", "repository.cjs"),
].filter((file) => fs.existsSync(file));

if (candidates.length !== 1) {
  throw new Error("expected exactly one canonical Unlazy repository resolver; found " + candidates.length);
}

module.exports = require(candidates[0]);
