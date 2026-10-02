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
    else if (key === "--takeover") options.takeover = true;
    else if (["--harness-root", "--root", "--package", "--scope", "--session", "--unlazy-root", "--owns"].includes(key)) {
      const value = argv.shift();
      if (!value || value.startsWith("--")) throw new Error(key + " requires a value");
      if (key === "--owns") options.owns = [...(options.owns || []), ...value.split(",")];
      else options[{ "--harness-root": "harnessRoot", "--root": "root", "--package": "packageId",
        "--scope": "scope", "--session": "sessionId", "--unlazy-root": "unlazyRoot" }[key]] = value;
    } else throw new Error("unknown option " + key);
  }
  if (!["begin", "status", "finish", "plan"].includes(options.command)) throw new Error("command must be begin, status, finish, or plan");
  if (!options.harnessRoot || !options.sessionId) throw new Error("--harness-root and --session are required");
  if (options.command === "begin" && (!options.root || !options.packageId)) throw new Error("begin requires --root and --package");
  return options;
}

function text(command, result) {
  const lines = [command + " " + result.packageId + (result.state ? " " + result.state : "")];
  for (const overlap of result.overlaps || []) lines.push("OVERLAP " + overlap.text);
  return lines.join("\n");
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    process.stdout.write("usage: package-bootstrap.mjs <begin|status|finish|plan> --harness-root DIR --session ID " +
      "[--root REPO --package ID --scope ID] [--unlazy-root DIR] [--owns GLOB ...] [--takeover] --json\n");
    return;
  }
  try {
    const options = parse(process.argv.slice(2));
    const result = options.command === "begin" ? bootstrap.begin(options) :
      options.command === "finish" ? bootstrap.finish(options) :
        options.command === "plan" ? bootstrap.plan(options) : bootstrap.find(options);
    process.stdout.write((options.json ? JSON.stringify(result) : text(options.command, result)) + "\n");
  } catch (error) {
    process.stderr.write("PACKAGE_BOOTSTRAP_" + (error.code || "FAILED") + ": " + error.message + "\n");
    for (const diagnostic of error.diagnostics || []) process.stderr.write("  " + diagnostic + "\n");
    if (error.next) process.stderr.write("NEXT: " + error.next + "\n");
    process.exitCode = Number.isInteger(error.exitCode) ? error.exitCode : 2;
  }
}

const current = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(current)) main();
