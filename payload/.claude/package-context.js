"use strict";

// Compatibility adapter. Repository identity comes from the one Git-backed
// Harness core; bundle parsing remains in the vendored Unlazy implementation.

const fs = require("node:fs");
const path = require("node:path");
const repository = require("../harness-core/binding/repository.cjs");

const vendorCandidates = [
  path.resolve(__dirname, "../vendor/unlazy/scripts/lib/package-context.cjs"),
  path.resolve(__dirname, "../../vendor/unlazy/scripts/lib/package-context.cjs"),
].filter((candidate) => fs.existsSync(candidate));

if (vendorCandidates.length !== 1) {
  throw new Error("expected exactly one Unlazy package-context implementation; found " + vendorCandidates.length);
}

const vendor = require(vendorCandidates[0]);

module.exports = {
  ...vendor,
  assertRepositoryRoot: repository.assertRepositoryRoot,
  isPathInside: repository.isPathInside,
  pathKey: (value, options = {}) => repository.pathKey(value, options),
  resolveRepositoryRoot: repository.resolveRepositoryRoot,
  samePath: (left, right, options = {}) => repository.samePath(left, right, options),
};

if (require.main === module) {
  if (!process.argv.includes("--self-test") && !process.argv.includes("--selbsttest")) {
    process.stderr.write("usage: package-context.js --self-test\n");
    process.exit(2);
  }
  const resolved = repository.resolveRepositoryRoot(__filename);
  if (!repository.isPathInside(resolved, __filename)) {
    process.stderr.write("package-context adapter self-test failed\n");
    process.exit(1);
  }
  process.stdout.write("package-context adapter self-test passed\n");
}
