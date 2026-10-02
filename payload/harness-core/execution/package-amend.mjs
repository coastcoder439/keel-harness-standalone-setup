#!/usr/bin/env node

// Command for the amendment route of an activated package; the logic lives in
// harness-core/binding/package-amend.cjs, this file only parses and prints.

import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const amend = require("../binding/package-amend.cjs");

const USAGE = `usage:
  package-amend.mjs begin --harness-root DIR --root REPO --package ID --scope ID --session ID [--json]
  package-amend.mjs finish --harness-root DIR --session ID [--unlazy-root DIR] [--json]
  package-amend.mjs undo --harness-root DIR --root REPO --receipt FILE [--json]

begin    snapshot the bundle of an active, idle package and bind this session to it
finish   prove OWNER.md, Goal, contract set, checkboxes and evidence unchanged, run doctor, write the receipt
undo     restore the exact bytes of an open snapshot or of a finished receipt
`;

const VALUES = { "--harness-root": "harnessRoot", "--root": "root", "--package": "packageId", "--scope": "scope",
  "--session": "sessionId", "--unlazy-root": "unlazyRoot", "--receipt": "receipt" };

function usageError(message) {
  const error = new Error(message);
  error.code = "HARNESS_AMEND";
  return error;
}

function parse(argv) {
  const options = { command: argv.shift() || "" };
  while (argv.length) {
    const key = argv.shift();
    if (key === "--json") options.json = true;
    else if (Object.hasOwn(VALUES, key)) {
      const value = argv.shift();
      if (!value || value.startsWith("--")) throw usageError(key + " requires a value");
      options[VALUES[key]] = value;
    } else throw usageError("unknown option " + key);
  }
  if (!["begin", "finish", "undo"].includes(options.command)) throw usageError("command must be begin, finish, or undo");
  if (!options.harnessRoot) throw usageError("--harness-root is required");
  if (options.command === "begin" && (!options.root || !options.packageId || !options.scope || !options.sessionId)) {
    throw usageError("begin requires --root, --package, --scope and --session");
  }
  if (options.command === "finish" && !options.sessionId) throw usageError("finish requires --session");
  if (options.command === "undo" && (!options.root || !options.receipt)) throw usageError("undo requires --root and --receipt");
  return options;
}

function text(command, result) {
  if (command === "begin") return "amending " + result.packageId + " in scope " + result.scope + "; snapshot " + result.snapshot +
    "\nNEXT: " + result.next;
  if (command === "finish") return "finished amendment of " + result.packageId + "; receipt " + result.receipt + "\nNEXT: " + result.next;
  return "restored " + result.packageId + " from " + result.receipt;
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(USAGE);
    return;
  }
  try {
    const options = parse(argv);
    const result = amend[options.command](options);
    process.stdout.write((options.json ? JSON.stringify(result) : text(options.command, result)) + "\n");
  } catch (error) {
    const message = String(error.message || error).replace(/\r?\n/gu, " ");
    process.stderr.write((error.code || "HARNESS_AMEND") + ": " + message + "\n" + (error.next ? "NEXT: " + error.next + "\n" : ""));
    process.exitCode = 2;
  }
}

const current = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(current)) main();
