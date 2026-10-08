const textTargets = /\.(?:c?js|mjs|json|md|toml|txt|cmd|ps1)$/iu;
const dashboardBuildPath = /[A-Za-z]:(?:\\+|\/+)(?:[^"'\\/\r\n]+(?:\\+|\/+))*user-projects(?:\\+|\/+)harness-lab(?:\\+|\/+)test-harness(?:\\+|\/+)dashboard(?:\\+|\/+)?/giu;

const installedRunAll = `#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { runBounded } from "./bounded-runner.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Die Anleitung verlangt Node >= 20; ohne diesen Guard stirbt eine fremde
// Installation auf altem Node erst tief in einer Teilpruefung, unverstaendlich.
const nodeMajor = Number(process.versions.node.split(".")[0]);
if (!(nodeMajor >= 20)) {
  process.stderr.write("NODE_TOO_OLD running=" + process.version + " required=>=20\\n");
  process.exit(1);
}

// --layout-only (P9, B6): the fresh installation checks the installed layout and contract, not the
// Unlazy suite a second time; the suite of the same code state runs once as the matrix phase
// unlazy:full-suite. Without the switch the recipient runs its complete matrix. No phase has a
// fixed time: bounded-runner ends a phase only when it is hung (silence watcher, KEEL_SILENCE_MS).
const layoutOnly = process.argv.slice(2).includes("--layout-only");
const unknownOptions = process.argv.slice(2).filter((value) => value !== "--layout-only");
if (unknownOptions.length) {
  process.stderr.write("usage: node checks/run-all.mjs [--layout-only]; unknown: " + unknownOptions.join(" ") + "\\n");
  process.exit(2);
}

const phases = [
  { name: "installed contract", countMode: "harness", expectedSkips: 0, command: process.execPath,
    args: [path.join(root, "checks", "installed-harness.mjs")] },
  { name: "installed React Dashboard runtime", countMode: "check", expectedSkips: 0, command: process.execPath,
    args: [path.join(root, "dashboard", "runtime-check.mjs")] },
  layoutOnly
    ? { name: "installed Unlazy layout", countMode: "unlazy-layout", expectedSkips: 0, command: process.execPath,
      args: [path.join(root, "vendor", "unlazy", "tests", "full-suite.mjs"), "--layout-only"] }
    : { name: "full installed Unlazy suite", countMode: "unlazy", expectedSkips: 8, command: process.execPath,
      args: [path.join(root, "vendor", "unlazy", "tests", "full-suite.mjs")] },
];

// Zaehlsaetze der Phasen: HARNESS_CHECK_COUNTS {json} (installed-harness) und
// UNLAZY_TEST_COUNTS {json, suite full-suite}. Ein Skip-Ueberschuss ist rot -- eine still
// uebersprungene Pruefung ist kein bestandener Empfaenger-Lauf (Audit B12).
function countRecord(output, prefix, suite) {
  const records = String(output).split(/\\r?\\n/u)
    .filter((line) => line.startsWith(prefix))
    .map((line) => JSON.parse(line.slice(prefix.length)))
    .filter((record) => suite === null || record.suite === suite);
  if (records.length !== 1) throw new Error(prefix.trim() + ": " + records.length + " count records, expected 1");
  const counts = records[0];
  if (counts.schema !== 1 || !["tests", "pass", "fail", "skip"].every((key) => Number.isInteger(counts[key]) && counts[key] >= 0)) {
    throw new Error(prefix.trim() + ": invalid count record");
  }
  if (counts.pass + counts.fail + counts.skip !== counts.tests) throw new Error(prefix.trim() + ": inconsistent counts");
  return { tests: counts.tests, pass: counts.pass, fail: counts.fail, skip: counts.skip };
}

for (const phase of phases) {
  const result = await runBounded({ ...phase, cwd: root, heartbeatMs: 20_000 });
  const output = String(result.stdout || "") + String(result.stderr || "");
  let counts;
  let countError = null;
  try {
    counts = phase.countMode === "harness" ? countRecord(output, "HARNESS_CHECK_COUNTS ", null)
      : phase.countMode === "unlazy" ? countRecord(output, "UNLAZY_TEST_COUNTS ", "full-suite")
      : phase.countMode === "unlazy-layout" ? countRecord(output, "UNLAZY_TEST_COUNTS ", "full-suite-layout")
        : { tests: 1, pass: result.exitCode === 0 ? 1 : 0, fail: result.exitCode === 0 ? 0 : 1, skip: 0 };
  } catch (error) {
    countError = error.message;
    counts = { tests: 1, pass: 0, fail: 1, skip: 0 };
  }
  const passed = result.exitCode === 0 && !result.hung && !countError && counts.fail === 0 && counts.skip === phase.expectedSkips;
  process.stdout.write("KEEL_HARNESS_PHASE " + JSON.stringify({ name: phase.name, exitCode: result.exitCode, ...counts, expectedSkips: phase.expectedSkips }) + "\\n");
  if (!passed) {
    process.stderr.write("KEEL_HARNESS_FAILED " + phase.name + " exit=" + result.exitCode + " counts=" + JSON.stringify(counts) +
      " expectedSkips=" + phase.expectedSkips + (countError ? " reason=" + countError : "") + "\\n");
    process.exit(result.exitCode !== 0 ? result.exitCode : 1);
  }
}
process.stdout.write((layoutOnly ? "KEEL_HARNESS_LAYOUT_OK\\n" : "") + "KEEL_HARNESS_OK\\n");
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
  // Der vendorierte Understand-Anything-Quellstand ist per Verzeichnis-Pruefsumme an seine Lock-Datei
  // gebunden (isolation.mjs verifyPluginIntegrity, Gate J1/A4); er wird byte-exakt ausgeliefert, nie
  // umgeschrieben -- auch kein UTF-8-Hin-und-Zurueck.
  if (target.startsWith("vendor/understand-anything-plugin/")) return input;
  if (target === "checks/run-all.mjs") return Buffer.from(installedRunAll, "utf8");
  if (target === "package.json") {
    const value = JSON.parse(input.toString("utf8"));
    value.name = "keel-harness-installed";
    value.version = productVersion;
    value.private = true;
    value.engines = { node: ">=20" };
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
      // „Dashboard-Orchestrator“ ist die Produktrolle des Dashboard-Agenten (A11, Owner 19.09.2026) und wird
      // mit jeder Installation ausgeliefert; alle anderen Zeilen wären angenommene Sitzungen des Distributors.
      const roleRows = text.split(/\r?\n/u).filter((line) =>
        /^\|/u.test(line) && !/^\|\s*(?:Session-Titel|Session title|-|Dashboard-Orchestrator\s*\|)/iu.test(line));
      for (const row of roleRows) failures.push(`${file.target}: distributor session role ${JSON.stringify(row)}`);
    }
  }
  return failures;
}

// The completeness contract ships with every installation, but its "executable counter-check"
// section described the SOURCE reference (requirements-audit, integration-contract, test-matrix,
// marker HARNESS_REFERENCE_OK) -- none of which exists in an installation (completeness audit
// 06.09.2026, H4). The build keeps the eight questions from the source document and replaces only
// that section with the installed route; checks/installed-harness.mjs verifies in every
// installation that each named check exists and that the named marker is the installed one.
export const INSTALLED_COMPLETENESS_HEADING = "## Ausführbare Gegenprobe";
const installedCompletenessSection = [
  INSTALLED_COMPLETENESS_HEADING,
  "",
  "In einer Installation läuft der unabhängige Abgleich in drei Phasen, alle über den",
  "einen Gesamtbefehl `node checks/run-all.mjs`:",
  "",
  "- `installed contract` — `checks/installed-harness.mjs` prüft den gemeinsamen",
  "  Hostvertrag, die aktiven Schutzschichten, die Inventur samt Abnahmerouten und",
  "  diesen Vertrag selbst.",
  "- `installed React Dashboard runtime` — `dashboard/runtime-check.mjs` startet die",
  "  gelieferte Dashboard-Laufzeit lokal und prüft ihre Routen.",
  "- `full installed Unlazy suite` — `vendor/unlazy/tests/full-suite.mjs` führt die",
  "  vollständige vendorierte Unlazy-Methode aus (acht erklärte Plattform-Skips).",
  "",
  "`node checks/run-all.mjs` zählt je Phase pass, fail und skip gegen die erwarteten",
  "Skips und gibt `KEEL_HARNESS_OK` nur aus, wenn alle drei Phasen grün sind. Mit",
  "`--layout-only` prüft die dritte Phase nur das installierte Unlazy-Layout (die",
  "Frischinstallation der Quelle; die Suite läuft dort einmal je Code-Stand). Die",
  "Quell-Referenz des Harness (requirements-audit, integration-contract, test-matrix und",
  "der Marker HARNESS_REFERENCE_OK) gehört zum Quellbaum des Harness und ist nicht Teil",
  "dieser Installation. Ein einzelnes grünes Gate beweist ausschließlich das, was sein",
  "`CHECK` tatsächlich misst.",
];

export function installedCompletenessCheck(sourceText) {
  const text = String(sourceText);
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/u);
  const start = lines.findIndex((line) => line.trim() === INSTALLED_COMPLETENESS_HEADING);
  if (start === -1) throw new Error("completeness contract has no section " + INSTALLED_COMPLETENESS_HEADING);
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s/u.test(lines[index])) { end = index; break; }
  }
  const replaced = [...lines.slice(0, start), ...installedCompletenessSection, "", ...lines.slice(end)];
  const joined = replaced.join(eol).replace(/(\r?\n){3,}$/u, eol);
  return joined.endsWith(eol) ? joined : joined + eol;
}
