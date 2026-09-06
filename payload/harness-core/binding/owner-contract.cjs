"use strict";

const fs = require("node:fs");
const path = require("node:path");

const candidates = [
  path.resolve(__dirname, "..", "..", "..", "vendor", "unlazy", "scripts", "lib", "owner-contract.cjs"),
  path.resolve(__dirname, "..", "..", "vendor", "unlazy", "scripts", "lib", "owner-contract.cjs"),
];
const implementations = [...new Set(candidates.filter((file) => fs.existsSync(file)).map((file) => fs.realpathSync(file)))];
if (implementations.length !== 1) {
  throw new Error("expected exactly one canonical Unlazy owner-contract implementation; found " + implementations.length);
}

module.exports = require(implementations[0]);
