#!/usr/bin/env node
// Records and checks the all-starts-before-wait dispatch contract. Node 16+.

import { resolve } from "node:path";
import { getDispatchWave, updateDispatch } from "./lib/dispatch.mjs";
import { resolvePackageTarget } from "./lib/packages.mjs";
import { inspectPackageBundle } from "./lib/package-schema.mjs";

const COMMANDS = new Set(["open", "start", "seal", "return", "abandon", "recover", "status"]);
const args = process.argv.slice(2);

function usage() {
  return [
    "Usage:",
    "  dispatch-check.mjs open --scope ID [--package ID] --wave ID --leaf ID [--leaf ID ...] [--root PATH]",
    "  dispatch-check.mjs start --scope ID [--package ID] --wave ID --leaf ID --handle OPAQUE_ID [--root PATH]",
    "  dispatch-check.mjs seal --scope ID [--package ID] --wave ID [--root PATH]",
    "  dispatch-check.mjs return --scope ID [--package ID] --wave ID --leaf ID [--root PATH]",
    "  dispatch-check.mjs abandon --scope ID [--package ID] --wave ID --reason TEXT [--root PATH]",
    "  dispatch-check.mjs recover --scope ID [--package ID] --wave ID --replacement-wave ID [--root PATH]",
    "  dispatch-check.mjs status --scope ID [--package ID] --wave ID [--root PATH]",
    "",
    "Normal commands resolve an active package.ref and persist schema-2 scope/package identity.",
    "Use --legacy only for explicit schema-1 diagnosis during migration.",
  ].join("\n");
}

function die(message) {
  const safe = String(message).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 500);
  console.error("unlazy dispatch: " + safe);
  process.exit(2);
}

if (!args.length || args[0] === "--help" || args[0] === "-h") {
  console.log(usage());
  process.exit(args.length ? 0 : 2);
}

const command = args.shift();
if (!COMMANDS.has(command)) die("unknown command " + command + "\n" + usage());

const options = {
  root: process.cwd(), package: null, scope: null, wave: null, leaves: [], handle: null, reason: null,
  replacementWave: null, legacy: false,
};
const single = new Set();
while (args.length) {
  const option = args.shift();
  if (option === "--legacy") {
    if (options.legacy) die("--legacy may be provided only once");
    options.legacy = true;
    continue;
  }
  if (!["--root", "--package", "--scope", "--wave", "--leaf", "--handle", "--reason", "--replacement-wave"].includes(option)) die("unknown option " + option);
  if (!args.length || args[0].startsWith("--")) die(option + " requires a value");
  const value = args.shift();
  if (option === "--leaf") options.leaves.push(value);
  else {
    if (single.has(option)) die(option + " may be provided only once");
    single.add(option);
    options[option === "--replacement-wave" ? "replacementWave" : option.slice(2)] = value;
  }
}

if (!options.wave) die("--wave is required");
options.root = resolve(options.root);
if (options.legacy && options.package) die("--legacy and --package are mutually exclusive");
if (command !== "recover" && options.replacementWave !== null) {
  die(command + " does not accept --replacement-wave");
}

if (command === "open") {
  if (!options.leaves.length) die("open requires at least one --leaf");
  if (options.handle !== null || options.reason !== null) die("open does not accept --handle or --reason");
} else if (command === "start") {
  if (options.leaves.length !== 1) die("start requires exactly one --leaf");
  if (options.handle === null) die("start requires --handle");
  if (options.reason !== null) die("start does not accept --reason");
} else if (command === "return") {
  if (options.leaves.length !== 1) die("return requires exactly one --leaf");
  if (options.handle !== null || options.reason !== null) die("return does not accept --handle or --reason");
} else if (command === "abandon") {
  if (options.leaves.length || options.handle !== null) die("abandon does not accept --leaf or --handle");
  if (options.reason === null || !options.reason.trim()) die("abandon requires --reason");
} else if (command === "recover") {
  if (options.leaves.length || options.handle !== null || options.reason !== null) {
    die("recover does not accept --leaf, --handle, or --reason");
  }
  if (options.replacementWave === null) die("recover requires --replacement-wave");
} else if (options.leaves.length || options.handle !== null || options.reason !== null) {
  die(command + " does not accept --leaf, --handle, or --reason");
}

let identity;
if (options.legacy) {
  if (!options.scope) die("--legacy requires --scope");
  identity = { scope: options.scope, packageId: null };
} else {
  let target;
  try {
    target = resolvePackageTarget({
      root: options.root,
      ...(options.package ? { packageId: options.package } : {}),
      ...(options.scope ? { scope: options.scope } : {}),
    });
  } catch (error) { die(error.message); }
  if (options.package && options.scope) {
    const expected = process.platform === "win32" ? options.scope.toLowerCase() : options.scope;
    const actual = target.scope && (process.platform === "win32" ? target.scope.toLowerCase() : target.scope);
    if (actual !== expected) die("--package " + options.package + " is not active in --scope " + options.scope);
  }
  if (!target.scope) die("dispatch requires an active scope with a valid package.ref");
  if (command === "open") {
    const packageStatus = inspectPackageBundle(target);
    if (packageStatus.diagnostics.length) {
      die("fan-out contract is invalid before dispatch: " +
        packageStatus.diagnostics.map((item) => item.code).join(", "));
    }
    if (!packageStatus.depthTree.defined || packageStatus.depthTree.ledgers < 2) {
      die("dispatch open requires a fan-out bundle with a complete Depth Tree and contract mapping");
    }
    const declaredLeaves = new Set(target.gateFiles
      .map((file) => file.replaceAll("\\", "/").match(/\/gates\/leaf-([^/]+)\.md$/))
      .filter(Boolean)
      .map((match) => "leaf-" + match[1]));
    const unknownLeaves = options.leaves.filter((leaf) => !declaredLeaves.has(leaf));
    if (unknownLeaves.length) die("dispatch leaves have no owning Depth Tree leaf ledger: " + unknownLeaves.join(", "));
  }
  identity = { scope: target.scope, packageId: target.packageId };
}

const summary = (wave, id) => {
  const started = Object.keys(wave.started).length;
  const returned = Object.keys(wave.returned).length;
  if (wave.state === "complete") return "COMPLETE " + id + " (" + returned + "/" + wave.leaves.length + " returned)";
  if (wave.state === "abandoned") return "ABANDONED " + id + " (" + started + "/" + wave.leaves.length +
    " started, " + returned + "/" + wave.leaves.length + " returned): " + wave.reason;
  if (wave.state === "recovered") return "RECOVERED " + id + " -> " + wave.replacementWave;
  return wave.state.toUpperCase() + " " + id + " (" + started + "/" + wave.leaves.length +
    " started, " + returned + "/" + wave.leaves.length + " returned)";
};

try {
  if (command === "status") {
    const wave = getDispatchWave(options.root, identity.scope, options.wave, identity.packageId);
    console.log(summary(wave, options.wave));
    process.exit(wave.state === "complete" ? 0 : 1);
  }

  const wave = await updateDispatch(options.root, {
    action: command,
    scope: identity.scope,
    packageId: identity.packageId,
    wave: options.wave,
    leaves: options.leaves,
    leaf: options.leaves[0],
    handle: options.handle,
    reason: options.reason,
    replacementWave: options.replacementWave,
  });
  const started = Object.keys(wave.started).length;
  const returned = Object.keys(wave.returned).length;
  if (command === "open") console.log("OPEN " + options.wave + " (0/" + wave.leaves.length + " started, 0/" + wave.leaves.length + " returned)");
  else if (command === "start") console.log("STARTED " + options.wave + " " + options.leaves[0] + " (" + started + "/" + wave.leaves.length + " started)");
  else if (command === "seal") console.log("SEALED " + options.wave + " (" + started + "/" + wave.leaves.length + " started)");
  else if (command === "abandon") console.log(summary(wave, options.wave));
  else if (command === "recover") console.log(summary(wave, options.wave));
  else if (wave.state === "complete") console.log("COMPLETE " + options.wave + " (" + returned + "/" + wave.leaves.length + " returned)");
  else console.log("RETURNED " + options.wave + " " + options.leaves[0] + " (" + returned + "/" + wave.leaves.length + " returned)");
} catch (error) {
  die(error.message);
}
