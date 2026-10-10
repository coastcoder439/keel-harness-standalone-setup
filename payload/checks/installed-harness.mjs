#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vendorCandidates = [join(root, "vendor", "unlazy"), join(root, "..", "vendor", "unlazy")]
  .filter((candidate) => existsSync(join(candidate, "scripts", "package-cli.mjs")));
const vendorRoot = vendorCandidates.length === 1 ? vendorCandidates[0] : null;
const failures = [];
let checksRun = 0;
const check = (condition, message) => {
  checksRun += 1;
  if (!condition) failures.push(message);
};
const read = (...parts) => readFileSync(join(root, ...parts), "utf8");
// The hook programs of .claude: the GitHub delete protection is the only PreToolUse hook, the others start a session, answer a
// prompt, check the result of the work at Stop or show the status.
const guards = [
  "dashboard-ensure.js", "dod-guard.js", "github-delete-guard.js", "onboarding-start.js",
  "package-context.js", "pollution-warn.js", "project-context.js",
  "prompt-form.js", "repo-status.js", "session-roles.js",
  "statusline.js", "uncommitted-warn.js", "unlazy-stop.js",
].sort();
const selfTests = ["package-context.js", "github-delete-guard.js", "dod-guard.js", "prompt-form.js",
  "uncommitted-warn.js", "unlazy-stop.js"];

check(/^(?:#[^\n]*\n+)?@AGENTS\.md\s*$/u.test(read("CLAUDE.md").replace(/\r\n/gu, "\n")), "CLAUDE.md is not only the @AGENTS.md import (D3)");
const actualGuards = readdirSync(join(root, ".claude"), { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".js")).map((entry) => entry.name).sort();
check(JSON.stringify(actualGuards) === JSON.stringify(guards), "active hook inventory differs");
check(!existsSync(join(root, ".claude", "git-guard.js")) &&
  !existsSync(join(root, ".claude", "commit-pathspec-guard.js")), "superseded Git hooks are present");
check(!existsSync(join(root, ".claude", "settings.local.json")), "machine-local Claude settings entered the payload");
for (const required of [
  [".codex", "hook-runner.cjs"], [".codex", "dod-guard.cjs"],
  ["harness-core", "binding", "package-bootstrap.cjs"],
  ["harness-core", "binding", "package-binding.cjs"],
  ["harness-core", "execution", "package-bootstrap.mjs"],
  // Ohne das Modul tut der SessionStart-Hook dashboard-ensure.js still nichts.
  ["harness-core", "dashboard", "ensure-dashboard.mjs"],
  ["harness-core", "execution", "package-executor.mjs"],
  ["harness-core", "execution", "owner-ok.mjs"],
  ["harness-core", "execution", "execution-receipts.mjs"],
  ["harness-core", "git", "git-intent.mjs"],
  // The hook context (root and session of a hook) is shared by the hooks; publish-projects and session-scope are loaded by
  // the executor and the Git tool.
  ["harness-core", "guards", "hook-context.cjs"], ["harness-core", "guards", "publish-projects.cjs"],
  ["harness-core", "guards", "session-scope.cjs"],
  // Both Stop hooks (dod-guard, unlazy-stop) and the Codex DoD adapter ask it whether an answer claims finished work.
  ["harness-core", "guards", "done-claim.cjs"],
  ["harness-core", "execution", "executor-commands.mjs"], ["harness-core", "execution", "brief-sections.mjs"],
  ["templates", "OWNER.md"], ["templates", "GATES-ROOT.md"], ["templates", "GATES-LEAF.md"],
  ["checks", "onboarding-ready.mjs"], ["docs", "harness-instance.md"],
]) check(existsSync(join(root, ...required)), "missing " + required.join("/"));
check(vendorRoot !== null, "expected exactly one full vendored Unlazy runtime");
if (vendorRoot) for (const file of ["package-cli.mjs", "gate-check.mjs", "dispatch-check.mjs", "stop-hook.mjs"]) {
  check(existsSync(join(vendorRoot, "scripts", file)), "missing vendored Unlazy script " + file);
}

for (const configPath of [[".claude", "settings.json"], [".codex", "hooks.json"]]) {
  const config = JSON.parse(read(...configPath));
  for (const name of ["SessionStart", "UserPromptSubmit", "PreToolUse", "Stop"]) {
    check(Array.isArray(config.hooks?.[name]) && config.hooks[name].length > 0,
      configPath.join("/") + " misses " + name);
  }
  for (const groups of Object.values(config.hooks || {})) for (const group of groups) {
    for (const hook of group.hooks || []) {
      check(Number.isFinite(hook.timeout) && hook.timeout > 0 && hook.timeout <= 20,
        configPath.join("/") + " has an unbounded hook");
    }
  }
}
const codexHooks = JSON.parse(read(".codex", "hooks.json"));
check(Array.isArray(codexHooks.hooks?.PostToolUse) && codexHooks.hooks.PostToolUse.length > 0,
  "Codex native PostToolUse state adapter is missing");
check(JSON.stringify(codexHooks).includes("github-delete-guard.js") && JSON.stringify(codexHooks).includes("dod-guard.cjs"),
  "Codex does not wire the GitHub delete protection and the DoD adapter");
check(JSON.stringify(read(".claude", "settings.json")).includes("github-delete-guard.js"),
  "Claude does not wire the GitHub delete protection");
check(/\[features\]\s+hooks = true/mu.test(read(".codex", "config.toml")), "Codex hooks are not explicitly enabled");

const claude = JSON.parse(read(".claude", "settings.json"));
check(claude.enabledPlugins?.["codex@openai-codex"] === true, "official project Codex plugin is not enabled");
check(claude.extraKnownMarketplaces?.["openai-codex"]?.source?.repo === "openai/codex-plugin-cc",
  "official Codex marketplace source differs");
check(read(".agents", "skills", "package-execution", "SKILL.md") ===
  read(".claude", "skills", "package-execution", "SKILL.md"), "Claude/Codex package lifecycle differs");

const packageEntries = readdirSync(join(root, "docs", "packages")).sort();
const sourcePackages = JSON.stringify(packageEntries) === JSON.stringify(["TEMPLATE.md"]);
// The installer creates no onboarding package any more (Karte Arbeitsweise, 07.10.2026): a fresh installation holds only the
// template. An installation upgraded from an earlier installer may still carry the retired package harness-onboarding as
// project history; if it is there it must be whole.
const earlierInstallation = JSON.stringify(packageEntries) === JSON.stringify(["TEMPLATE.md", "harness-onboarding"]);
check(sourcePackages || earlierInstallation, "payload contains copied live work packages");
// Installation or source tree? The installer's receipt says it (the onboarding package used to; a fresh installation has none now).
const installedLayout = existsSync(join(root, ".keel-harness", "state.json")) || earlierInstallation;
if (earlierInstallation) for (const file of ["OWNER.md", "PACKAGE.md", "GATES.md", "gates/leaf-instance.md"]) {
  check(existsSync(join(root, "docs", "packages", "harness-onboarding", ...file.split("/"))),
    "incomplete onboarding package of an earlier installation: " + file);
}
const inventoryLines = read("docs", "active-harness-inventory.md").split(/\r?\n/u);
const inventoryHeader = inventoryLines.findIndex((line) => /^\|\s*Capability\s*\|/u.test(line) && line.includes("Acceptance command"));
check(inventoryHeader >= 0, "active Harness inventory has no capability/acceptance table");
if (inventoryHeader >= 0) {
  const headers = inventoryLines[inventoryHeader].split("|").slice(1, -1).map((value) => value.trim());
  const acceptanceIndex = headers.indexOf("Acceptance command");
  check(acceptanceIndex >= 0, "active Harness inventory has no Acceptance command column");
  for (let index = inventoryHeader + 2; index < inventoryLines.length && /^\|/u.test(inventoryLines[index]); index += 1) {
    const columns = inventoryLines[index].split("|").slice(1, -1).map((value) => value.trim());
    const command = columns[acceptanceIndex] || "";
    const match = command.match(/^`node\s+([^`\s]+)(?:\s+[^`]*)?`$/u);
    check(Boolean(match), `inventory acceptance command is not one finite local Node route: ${command}`);
    if (!match) continue;
    const target = match[1].replace(/^\.\//u, "");
    const safeTarget = target && !target.startsWith("/") && !/^[A-Za-z]:/u.test(target) &&
      target.split("/").every((part) => part && part !== "." && part !== "..");
    check(Boolean(safeTarget), `inventory acceptance target is unsafe: ${match[1]}`);
    if (!safeTarget) continue;
    const full = resolve(root, ...target.split("/"));
    const foldedRoot = process.platform === "win32" ? root.toLowerCase() : root;
    const foldedFull = process.platform === "win32" ? full.toLowerCase() : full;
    check(foldedFull.startsWith(foldedRoot + sep),
      `inventory acceptance command escapes installation root: ${command}`);
    if (existsSync(full)) {
      const info = lstatSync(full);
      check(info.isFile() && !info.isSymbolicLink(), `inventory acceptance target is not one regular file: ${match[1]}`);
    } else check(false, `inventory acceptance target is missing: ${match[1]}`);
  }
}
// The completeness contract may only name checks that exist in THIS installation and must name
// the installed success marker, never the source-tree marker as its own (audit 06.09.2026, H4).
const completenessContract = read("docs", "completeness-check.md");
for (const match of completenessContract.matchAll(/`(?:node )?((?:checks|dashboard|vendor)\/[A-Za-z0-9_./-]+\.mjs)`/gu)) {
  check(existsSync(resolve(root, ...match[1].split("/"))), "completeness contract names a check that is not installed: " + match[1]);
}
// The same check runs in the source tree (matrix phase "installed source contract"), where the
// source reference and its marker HARNESS_REFERENCE_OK are the truth; only an installation must
// carry the installed marker.
const expectedMarker = installedLayout ? "KEEL_HARNESS_OK" : "HARNESS_REFERENCE_OK";
check(completenessContract.includes("`" + expectedMarker + "`"), "completeness contract does not name the success marker of this layout: " + expectedMarker);
if (installedLayout) {
  check(!/`HARNESS_REFERENCE_OK` nur aus/u.test(completenessContract), "completeness contract still presents the source-tree marker as the installed one");
}
if (installedLayout) {
  const dashboardFiles = readdirSync(join(root, "dashboard")).sort();
  check(JSON.stringify(dashboardFiles) === JSON.stringify([
    "runtime-archive.mjs", "runtime-check.mjs", "runtime-manifest.json", "runtime.keel.gz", "serve.mjs",
  ]), "installed Dashboard is not the sole five-file React runtime archive");
  const runtimeManifest = JSON.parse(read("dashboard", "runtime-manifest.json"));
  check(runtimeManifest.schema === "keel-dashboard-runtime-manifest.v1" &&
    /^[a-f0-9]{64}$/u.test(runtimeManifest.treeSha256 || ""), "installed Dashboard runtime manifest is malformed");
  check(!existsSync(join(root, "dashboard", "index.js")) && !existsSync(join(root, "dashboard", "serve.js")) &&
    !existsSync(join(root, "dashboard", "render")) && !existsSync(join(root, "dashboard", "runtime")),
  "legacy or unpacked Dashboard entered the installation tree");
  check(!existsSync(join(root, "checks", "governance-hardening.mjs")),
    "source-only governance gate entered the installed command surface");
  const launch = JSON.parse(read(".claude", "launch.json"));
  const dashboardLaunch = (launch.configurations || []).find((entry) => entry.name === "dashboard");
  check(JSON.stringify(dashboardLaunch?.runtimeArgs) === JSON.stringify(["dashboard/serve.mjs", "--port", "8766"]),
    "installed Dashboard launch route does not use the sole archive launcher on its declared port");
}
check(read(".gitignore").split(/\r?\n/u).includes(".unlazy/"), ".unlazy runtime is not ignored");
check(!/(?:token|secret|password|client_secret)\s*=/iu.test(read(".codex", "config.toml")),
  "Codex config contains a credential-looking assignment");

for (const file of selfTests) {
  const result = spawnSync(process.execPath, [join(root, ".claude", file), "--selbsttest"], {
    cwd: root, encoding: "utf8", windowsHide: true, timeout: 20_000,
  });
  check(result.status === 0, file + " self-test failed: " + String(result.stderr || result.stdout).trim());
}

if (failures.length) {
  for (const failure of failures) console.error("not ok installed harness: " + failure);
  console.log("HARNESS_CHECK_COUNTS " + JSON.stringify({
    schema: 1, suite: "installed-harness", tests: checksRun,
    pass: checksRun - failures.length, fail: failures.length, skip: 0,
  }));
  process.exitCode = 1;
} else {
  console.log("HARNESS_CHECK_COUNTS " + JSON.stringify({
    schema: 1, suite: "installed-harness", tests: checksRun,
    pass: checksRun, fail: 0, skip: 0,
  }));
  console.log("installed harness: full Unlazy lifecycle, " + guards.length +
    " shared hooks plus the native Codex DoD adapter, no live package copy");
}
