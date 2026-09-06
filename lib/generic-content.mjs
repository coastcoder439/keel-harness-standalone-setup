const textTargets = /\.(?:c?js|mjs|json|md|toml|txt|cmd|ps1)$/iu;
const dashboardBuildPath = /[A-Za-z]:(?:\\+|\/+)(?:[^"'\\/\r\n]+(?:\\+|\/+))*user-projects(?:\\+|\/+)harness-lab(?:\\+|\/+)test-harness(?:\\+|\/+)dashboard(?:\\+|\/+)?/giu;

const installedRunAll = `#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { runBounded } from "./bounded-runner.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const phases = [
  { name: "installed contract", command: process.execPath,
    args: [path.join(root, "checks", "installed-harness.mjs")], timeoutMs: 60_000 },
  { name: "installed React Dashboard runtime", command: process.execPath,
    args: [path.join(root, "dashboard", "runtime-check.mjs")], timeoutMs: 2 * 60_000 },
  { name: "full installed Unlazy suite", command: process.execPath,
    args: [path.join(root, "vendor", "unlazy", "tests", "full-suite.mjs")], timeoutMs: 15 * 60_000 },
];

for (const phase of phases) {
  const result = await runBounded({ ...phase, cwd: root, heartbeatMs: 20_000 });
  if (result.exitCode !== 0) {
    process.stderr.write(\`KEEL_HARNESS_FAILED ${"${phase.name}"} exit=${"${result.exitCode}"}\\n\`);
    process.exit(result.exitCode);
  }
}
process.stdout.write("KEEL_HARNESS_OK\\n");
`;

export const staleSourceOnlyTargets = new Set(["checks/audit-lib.mjs"]);

export const forbiddenDistributionIdentity = [
  "Harness Lab Control",
  "harness-lab",
  "isolierte Testwerkbank",
  "Lab-Harness",
  "Entwicklung im Lab",
  "Beispielbenutzer",
  "coastcoder439",
];

export function genericDistributionContent(target, value, { productVersion = "1.1.0" } = {}) {
  const input = Buffer.isBuffer(value) ? value : Buffer.from(value);
  if (!textTargets.test(target)) return input;
  if (target === "checks/run-all.mjs") return Buffer.from(installedRunAll, "utf8");
  if (target === "package.json") {
    const value = JSON.parse(input.toString("utf8"));
    value.name = "keel-harness-installed";
    value.version = productVersion;
    value.private = true;
    value.description = "Project-local Keel Harness with integrated Unlazy package bundles.";
    return Buffer.from(JSON.stringify(value, null, 2) + "\n", "utf8");
  }
  if (target === ".claude/launch.json") {
    const value = JSON.parse(input.toString("utf8"));
    for (const configuration of value.configurations || []) {
      if (configuration.name === "dashboard") {
        configuration.runtimeExecutable = "node";
        configuration.runtimeArgs = ["dashboard/serve.mjs", "--port", String(configuration.port || 8766)];
      }
    }
    return Buffer.from(JSON.stringify(value, null, 2) + "\n", "utf8");
  }

  let text = input.toString("utf8");
  if (target.startsWith("dashboard/runtime/")) {
    text = text.replace(dashboardBuildPath, (match) =>
      /[\\/]$/u.test(match) ? "/keel-dashboard-source/" : "/keel-dashboard-source");
  }
  if (target === "AGENTS.md" || target === "CLAUDE.md") {
    text = text
      .replace(/^# Keel Reference Harness$/mu, "# Keel Harness")
      .replace(
        /- Dies ist das isolierte Referenz-Harness\. Entwicklung im Lab schaltet keine\r?\n  andere Werkbank live und verändert kein fremdes Projekt-Repo\./u,
        "- Dies ist eine projektlokale Keel-Harness-Installation. Änderungen bleiben\n" +
          "  im besitzenden Repository und verändern kein anderes Projekt-Repo.",
      );
  }
  if (target === "checks/governance-hardening.mjs") {
    text = text
      .replaceAll("/harness-lab/iu", "/harness[-_]lab/iu")
      .replaceAll("/Harness Lab Control/iu", "/Harness\\s+Lab\\s+Control/iu")
      .replaceAll("/isolierte Testwerkbank/iu", "/isolierte\\s+Testwerkbank/iu")
      .replaceAll("/Entwicklung im Lab/iu", "/Entwicklung\\s+im\\s+Lab/iu");
  }
  text = text
    .replaceAll("Keel Reference Harness", "Keel Harness")
    .replaceAll("Reference Harness decision", "Keel Harness decision");
  return Buffer.from(text, "utf8");
}

// Next writes its manifests in the order the parallel compilation finishes, so
// two builds of one unchanged source tree emit the same map with a different
// key order -- measured 02.09.2026 over two consecutive builds:
// .next/app-build-manifest.json, .next/app-path-routes-manifest.json,
// .next/server/app-paths-manifest.json and
// .next/server/functions-config-manifest.json differed by key order alone, at
// identical byte length. Every Next manifest is a lookup map; sorting its
// object keys keeps every value and, above all, every array order (chunk load
// order, dynamic route priority) untouched and makes the delivered archive
// byte-reproducible. The `.nft.json` trace files and `.next/package.json` do
// not carry the `-manifest.json` suffix and are delivered unchanged.
const nextManifestTarget = /^dashboard\/runtime\/\.next\/(?:[^\r\n]*\/)?[^/\r\n]*-manifest\.json$/u;

export function sortedJsonKeys(value) {
  if (Array.isArray(value)) return value.map(sortedJsonKeys);
  if (!value || typeof value !== "object") return value;
  const sorted = {};
  for (const key of Object.keys(value).sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))) {
    sorted[key] = sortedJsonKeys(value[key]);
  }
  return sorted;
}

export function deterministicRuntimeContent(target, value) {
  const input = Buffer.isBuffer(value) ? value : Buffer.from(value);
  if (!nextManifestTarget.test(target)) return input;
  const text = input.toString("utf8");
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`Next manifest is not valid JSON and cannot be made deterministic: ${target}: ${error.message}`);
  }
  // Next writes each manifest either indented by two spaces or compact and
  // without a trailing newline; the measured shape is kept so only the key
  // order moves.
  return Buffer.from(JSON.stringify(sortedJsonKeys(parsed), null, text.includes("\n") ? 2 : 0), "utf8");
}

export function distributionIdentityFailures(files) {
  const failures = [];
  for (const file of files) {
    if (!textTargets.test(file.target)) continue;
    const text = Buffer.isBuffer(file.content) ? file.content.toString("utf8") : String(file.content);
    for (const token of forbiddenDistributionIdentity) {
      if (text.includes(token)) failures.push(`${file.target}: distributor identity ${JSON.stringify(token)}`);
    }
    if (file.target === "docs/08-sessions-rollen.md") {
      const roleRows = text.split(/\r?\n/u).filter((line) =>
        /^\|/u.test(line) && !/^\|\s*(?:Session-Titel|Session title|-)/iu.test(line));
      for (const row of roleRows) failures.push(`${file.target}: distributor session role ${JSON.stringify(row)}`);
    }
  }
  return failures;
}
