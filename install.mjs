#!/usr/bin/env node

import process from "node:process";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DistributionError, distributionStatus, doctorDistribution, installDistribution,
  rollbackDistribution, uninstallDistribution,
} from "./lib/distribution-lifecycle.mjs";
import { purgeAccountabilityData } from "./lib/accountability-data.mjs";

const distributionRoot = dirname(fileURLToPath(import.meta.url));
const commands = new Set(["install", "uninstall", "rollback", "status", "doctor"]);

function usage(message) {
  if (message) console.error("keel harness installer: " + message);
  console.error(`usage:
  node install.mjs [install] --target DIR [--dry-run] [--force] [--upgrade] [--install-codex-plugin] [--claude FILE] [--json]
  node install.mjs uninstall --target DIR [--dry-run] [--force] [--purge-accountability-data] [--claude FILE] [--json]
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
    else if (option === "--purge-accountability-data") options.purgeAccountabilityData = true;
    else if (option === "--upgrade") options.upgrade = true;
    else if (option === "--install-codex-plugin") options.installCodexPlugin = true;
    else if (option === "--json") options.json = true;
    else if (option === "--help" || option === "-h") usage();
    else usage("unknown option " + option);
  }
  if (!options.target) usage("--target is required");
  const allowed = {
    install: new Set(["dryRun", "force", "upgrade", "installCodexPlugin", "json", "claude"]),
    uninstall: new Set(["dryRun", "force", "json", "claude", "purgeAccountabilityData"]),
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
    result.onboardingPackage ? `onboarding-package=${result.onboardingPackage.state}` : null,
    result.accountabilityData ? `accountability-data=${result.accountabilityData.directory}` : null,
    result.accountabilityData ? (result.accountabilityData.purged
      ? `accountability-data-purged=${result.accountabilityData.removedFiles.length}-files revoke=${result.accountabilityData.revoke}`
      : `accountability-data-left=${result.accountabilityData.exists
        ? `${result.accountabilityData.files.length}-files(credentials:${result.accountabilityData.credentialFiles.length})`
        : "absent"}`) : null,
    result.runtimeActivation && result.runtimeActivation.packageRefs.length ? (result.runtimeActivation.cleared.length
      ? `runtime-activation-cleared=${result.runtimeActivation.cleared.length}-package-ref` +
        (result.runtimeActivation.recoveryPreserved.length ? ` recovery-preserved=${result.runtimeActivation.recoveryPreserved.length}` : "")
      : `runtime-activation-left=${result.runtimeActivation.packageRefs.length}-package-ref`) : null,
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
    let result = run(process.argv.slice(2));
    if (options.command === "uninstall" && options.purgeAccountabilityData && !options.dryRun) {
      result = { ...result, accountabilityData: await purgeAccountabilityData(resolve(options.target), { env: process.env }) };
    }
    const data = result.accountabilityData;
    if (data && !data.purged && data.credentialFiles?.length) {
      console.error("keel harness installer: Google credentials of this installation remain outside the repository: " +
        data.directory + " (" + data.credentialFiles.join(", ") + "). Disconnect in the Dashboard first, or rerun uninstall with --purge-accountability-data.");
    }
    if (result.claudeCode?.warning) console.error("keel harness installer: WARNING " + result.claudeCode.warning + ".");
    // The earlier installation's onboarding package (installers before the profile moved to the session): retired by the
    // upgrade; a package that could not be retired is named so nothing stays open unnoticed.
    const onboardingPackage = result.onboardingPackage;
    if (onboardingPackage?.state === "retired") {
      console.error("keel harness installer: retired the open onboarding package docs/packages/harness-onboarding" +
        (onboardingPackage.scopes.length ? " (runtime moved to " + onboardingPackage.scopes.map((item) => item.movedTo).join(", ") + ")" : "") +
        "; the profile docs/harness-instance.md is unchanged. Onboarding now runs in the session (/onboarding).");
    } else if (onboardingPackage?.state === "left-busy" || onboardingPackage?.state === "failed") {
      console.error("keel harness installer: WARNING the earlier onboarding package was not retired (" +
        (onboardingPackage.reason || onboardingPackage.error) + "); rerun the installer once its work has ended.");
    }
    const activation = result.runtimeActivation;
    if (activation && activation.cleared.length) {
      console.error("keel harness installer: cleared " + activation.cleared.length +
        " stale package activation pointer(s) in .unlazy/ (" + activation.cleared.join(", ") +
        ") so a follow-up installation does not inherit an active package" +
        (activation.recoveryPreserved.length ? "; recoverable git state under .unlazy/<scope>/git/recovery was preserved" : "") + ".");
    } else if (activation && activation.packageRefs.length) {
      console.error("keel harness installer: a follow-up installation would inherit " + activation.packageRefs.length +
        " active package activation pointer(s) in .unlazy/ (" + activation.packageRefs.join(", ") +
        "); the real uninstall clears them.");
    }
    // Systemprofil (Paket system-profile, 21.09.2026): direkt nach einer echten Installation misst der
    // Harness den Rechner (CPU/RAM/GPU/Platte) und schreibt runtime/voice/system-profile.json — die
    // Voreinstellungen fuer Stimme und Hoeren kommen daraus. Ein Fehlschlag bricht die Installation
    // nicht ab; er wird gemeldet, der Scan laesst sich mit node voice/system-profile.mjs nachholen.
    // Eine No-op-Neuinstallation misst nicht neu: sie schreibt nichts (sonst aenderte measuredAt den
    // Baum). Die Deinstallation entfernt die Datei wieder (removeInstallerSystemProfile in
    // lib/distribution-lifecycle.mjs), weil sie in keinem Installations-Journal steht.
    if (options.command === "install" && !options.dryRun && !result.noOp && result.state !== "planned") {
      const scanner = resolve(options.target, "voice", "system-profile.mjs");
      if (existsSync(scanner)) {
        const scan = spawnSync(process.execPath, [scanner], { cwd: resolve(options.target), encoding: "utf8", windowsHide: true, timeout: 60000 });
        result = { ...result, systemProfile: scan.status === 0 ? "written" : "failed" };
        if (scan.status === 0) console.error(String(scan.stderr || "").trim());
        else console.error("keel harness installer: system profile not written (" + String(scan.stderr || scan.error?.message || "unknown").trim().split("\n").pop() + "); run node voice/system-profile.mjs later.");
      }
    }
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
