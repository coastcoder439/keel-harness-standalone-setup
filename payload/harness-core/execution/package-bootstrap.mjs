#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const bootstrap = require("../binding/package-bootstrap.cjs");

function parse(argv) {
  const options = { command: argv.shift() || "" };
  while (argv.length) {
    const key = argv.shift();
    if (key === "--json") options.json = true;
    else if (["--harness-root", "--root", "--package", "--scope", "--session"].includes(key)) {
      const value = argv.shift();
      if (!value || value.startsWith("--")) throw new Error(key + " requires a value");
      options[{ "--harness-root": "harnessRoot", "--root": "root", "--package": "packageId",
        "--scope": "scope", "--session": "sessionId" }[key]] = value;
    } else throw new Error("unknown option " + key);
  }
  if (!["begin", "status", "finish"].includes(options.command)) throw new Error("command must be begin, status, or finish");
  if (!options.harnessRoot || !options.sessionId) throw new Error("--harness-root and --session are required");
  if (options.command === "begin" && (!options.root || !options.packageId)) throw new Error("begin requires --root and --package");
  return options;
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    process.stdout.write("usage: package-bootstrap.mjs <begin|status|finish> --harness-root DIR --session ID [--root REPO --package ID --scope ID] --json\n");
    return;
  }
  try {
    const options = parse(process.argv.slice(2));
    const result = options.command === "begin" ? bootstrap.begin(options) :
      options.command === "finish" ? bootstrap.finish(options) : bootstrap.find(options);
    process.stdout.write((options.json ? JSON.stringify(result) : options.command + " " + result.packageId) + "\n");
  } catch (error) {
    process.stderr.write("PACKAGE_BOOTSTRAP_" + (error.code || "FAILED") + ": " + error.message + "\n");
    process.exitCode = 2;
  }
}

const current = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(current)) main();
