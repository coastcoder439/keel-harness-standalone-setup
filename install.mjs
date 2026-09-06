#!/usr/bin/env node

import process from "node:process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DistributionError, distributionStatus, doctorDistribution, installDistribution,
  rollbackDistribution, uninstallDistribution,
} from "./lib/distribution-lifecycle.mjs";

const distributionRoot = dirname(fileURLToPath(import.meta.url));
const commands = new Set(["install", "uninstall", "rollback", "status", "doctor"]);

function usage(message) {
  if (message) console.error("keel harness installer: " + message);
  console.error(`usage:
  node install.mjs [install] --target DIR [--dry-run] [--force] [--upgrade] [--install-codex-plugin] [--claude FILE] [--json]
  node install.mjs uninstall --target DIR [--dry-run] [--force] [--claude FILE] [--json]
  node install.mjs rollback --target DIR [--json]
  node install.mjs status --target DIR [--json]
  node install.mjs doctor --target DIR [--json]`);
  process.exit(2);
}

function parse(argv) {
  const values = [...argv];
  const command = commands.has(values[0]) ? values.shift() : "install";
  const options = {
    command, dryRun: false, force: false, upgrade: false,
    installCodexPlugin: false, json: false,
  };
  while (values.length) {
    const option = values.shift();
    if (option === "--target" || option === "--claude") {
      const value = values.shift();
      if (!value || value.startsWith("--")) usage(`${option} requires a value`);
      options[option === "--target" ? "target" : "claude"] = value;
    } else if (option === "--dry-run") options.dryRun = true;
    else if (option === "--force") options.force = true;
    else if (option === "--upgrade") options.upgrade = true;
    else if (option === "--install-codex-plugin") options.installCodexPlugin = true;
    else if (option === "--json") options.json = true;
    else if (option === "--help" || option === "-h") usage();
    else usage("unknown option " + option);
  }
  if (!options.target) usage("--target is required");
  const allowed = {
    install: new Set(["dryRun", "force", "upgrade", "installCodexPlugin", "json", "claude"]),
    uninstall: new Set(["dryRun", "force", "json", "claude"]),
    rollback: new Set(["json"]),
    status: new Set(["json"]),
    doctor: new Set(["json"]),
  }[command];
  for (const [name, value] of Object.entries(options)) {
    if (["command", "target"].includes(name) || !value) continue;
    if (!allowed.has(name)) usage(`--${name.replace(/[A-Z]/gu, (letter) => "-" + letter.toLowerCase())} is invalid for ${command}`);
  }
  if (options.claude && command === "install" && !options.installCodexPlugin) {
    usage("--claude requires --install-codex-plugin for install");
  }
  return options;
}

function render(result) {
  const values = [
    `command=${result.command}`,
    `state=${result.state}`,
    result.product?.version ? `version=${result.product.version}` : null,
    result.dryRun ? "dry-run=true" : null,
    result.noOp ? "no-op=true" : null,
    Number.isInteger(result.promotions) ? `promotions=${result.promotions}` : null,
    Number.isInteger(result.managedFiles) ? `managed=${result.managedFiles}` : null,
    result.doctor ? `doctor=${result.doctor}` : null,
    result.rollback ? `rollback=${result.rollback}` : null,
  ].filter(Boolean);
  return "keel harness distribution: " + values.join(" ");
}

export function run(argv = process.argv.slice(2)) {
  const options = parse(argv);
  const common = { distributionRoot, target: resolve(options.target), ...options };
  if (options.command === "install") return installDistribution(common);
  if (options.command === "uninstall") return uninstallDistribution(common);
  if (options.command === "rollback") return rollbackDistribution(common);
  if (options.command === "status") return distributionStatus(common);
  return doctorDistribution(common);
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  try {
    const options = parse(process.argv.slice(2));
    const result = run(process.argv.slice(2));
    process.stdout.write((options.json ? JSON.stringify(result, null, 2) : render(result)) + "\n");
  } catch (error) {
    const prefix = error instanceof DistributionError ? "keel harness installer" : "keel harness installer internal error";
    console.error(prefix + ": " + error.message);
    if (error.details && Object.keys(error.details).length && process.argv.includes("--json")) {
      console.error(JSON.stringify(error.details));
    }
    process.exitCode = error.exitCode || 2;
  }
}
