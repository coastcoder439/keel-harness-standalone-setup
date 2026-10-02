#!/usr/bin/env node

// Project-scoped declaration and opt-in bootstrap for OpenAI's official Codex
// plugin for Claude Code. Contract checks are read-only. `apply --yes` is the
// only mode allowed to call Claude's installer and never uses user scope.

import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { CODEX_MODEL, CODEX_EFFORT } from "./codex-pin.mjs";

const require = createRequire(import.meta.url);
const repository = require("../binding/repository.cjs");
const scriptHarnessRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const MARKETPLACE = "openai/codex-plugin-cc";
const MARKETPLACE_NAME = "openai-codex";
const PLUGIN = "codex@openai-codex";

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

function fail(message, exitCode = 2, code = "CODEX_PLUGIN") {
  const error = new Error(message);
  error.exitCode = exitCode;
  error.code = code;
  throw error;
}

function parse(argv) {
  const args = [...argv];
  const value = { command: args.shift() || "contract" };
  while (args.length) {
    const key = args.shift();
    if (key === "--yes") value.yes = true;
    else if (key === "--json") value.json = true;
    else if (key === "--root" || key === "--harness-root" || key === "--claude" || key === "--codex") {
      const item = args.shift();
      if (!item || item.startsWith("--")) fail(key + " requires a value");
      const names = { "--root": "root", "--harness-root": "harnessRoot", "--claude": "claude", "--codex": "codex" };
      value[names[key]] = item;
    } else fail("unknown option " + key);
  }
  if (!["contract", "plan", "runtime", "probe", "apply"].includes(value.command)) fail("unknown command " + value.command);
  return value;
}

function commands() {
  return [
    ["plugin", "marketplace", "add", MARKETPLACE, "--scope", "project"],
    ["plugin", "install", PLUGIN, "--scope", "project"],
  ];
}

export function contract(repoRoot, harnessRoot) {
  if (!repository.isPathInside(repoRoot, harnessRoot)) fail("Harness artifact must stay inside the owning Git repository");
  const settingsFile = path.join(harnessRoot, ".claude", "settings.json");
  const configFile = path.join(harnessRoot, ".codex", "config.toml");
  if (!fs.existsSync(settingsFile) || !fs.existsSync(configFile)) fail("project plugin contract files are missing");
  let settings;
  try { settings = JSON.parse(fs.readFileSync(settingsFile, "utf8")); }
  catch { fail(".claude/settings.json is invalid JSON"); }
  const source = settings.extraKnownMarketplaces?.[MARKETPLACE_NAME]?.source;
  if (!source || source.source !== "github" || source.repo !== MARKETPLACE) {
    fail("official OpenAI Codex marketplace is not declared at project scope");
  }
  if (settings.enabledPlugins?.[PLUGIN] !== true) fail("official Codex plugin is not enabled at project scope");
  const config = fs.readFileSync(configFile, "utf8");
  if (!new RegExp(`^model = "${escapeRegExp(CODEX_MODEL)}"$`, "mu").test(config) ||
      !new RegExp(`^model_reasoning_effort = "${escapeRegExp(CODEX_EFFORT)}"$`, "mu").test(config)) {
    fail(`project Codex config must select ${CODEX_MODEL} with ${CODEX_EFFORT} effort`);
  }
  if (/(?:token|secret|password|client_secret)\s*=/iu.test(config)) fail("project Codex config contains a credential-shaped field");
  return {
    marketplace: MARKETPLACE,
    marketplaceName: MARKETPLACE_NAME,
    plugin: PLUGIN,
    scope: "project",
    model: CODEX_MODEL,
    effort: CODEX_EFFORT,
    harnessRoot,
    commands: commands(),
    postInstall: ["/reload-plugins", "/codex:setup"],
  };
}

function run(executable, args, cwd, timeout = 120_000, missingCode = "CLAUDE_CLI_MISSING") {
  const result = spawnSync(executable, args, { cwd, encoding: "utf8", windowsHide: true, timeout });
  if (result.error) {
    const missing = result.error.code === "ENOENT";
    fail(result.error.message, 1, missing ? missingCode : "CODEX_ROUTE_PROCESS");
  }
  return result;
}

function regularFile(file) {
  try {
    return fs.statSync(file).isFile() ? fs.realpathSync(file) : null;
  } catch {
    return null;
  }
}

// npm's Windows shim is a .cmd/.ps1 wrapper. Modern Node deliberately does not
// execute those wrappers without a shell, and this bootstrap must not introduce
// shell parsing. Resolve the package's native claude.exe beside a discovered shim.
export function resolveClaudeExecutable(requested, env = process.env, platform = process.platform) {
  if (requested && requested !== "claude") {
    if (platform === "win32" && path.isAbsolute(requested) && /\.(?:cmd|ps1)$/iu.test(requested)) {
      const native = regularFile(path.join(path.dirname(requested), "node_modules", "@anthropic-ai",
        "claude-code", "bin", "claude.exe"));
      if (native) return native;
    }
    return requested;
  }
  if (platform !== "win32") return requested || "claude";
  for (const raw of String(env.PATH || "").split(path.delimiter)) {
    const directory = raw.trim().replace(/^"|"$/gu, "");
    if (!directory) continue;
    const direct = regularFile(path.join(directory, "claude.exe"));
    if (direct) return direct;
    const hasShim = regularFile(path.join(directory, "claude.cmd")) || regularFile(path.join(directory, "claude.ps1"));
    if (!hasShim) continue;
    const native = regularFile(path.join(directory, "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe"));
    if (native) return native;
  }
  return "claude";
}

// Codex publishes no PATH-visible executable on Windows: npm installs a
// .cmd/.ps1 shim around bin/codex.js and the desktop app keeps codex.exe outside
// PATH, so a bare "codex" reaches Node as ENOENT. Resolve a real program the same
// way the Claude shim is resolved, without introducing shell parsing.
export function resolveCodexCommand(requested, env = process.env, platform = process.platform) {
  const plain = (command) => ({ command, prefixArgs: [] });
  // A JavaScript entry runs through Node, exactly as npm's shim runs bin/codex.js.
  if (requested && /\.(?:c|m)?js$/iu.test(requested)) return { command: process.execPath, prefixArgs: [requested] };
  if (requested && requested !== "codex") return plain(requested);
  if (platform !== "win32") return plain("codex");
  const configured = regularFile(String(env.CODEX_EXECUTABLE || ""));
  if (configured) return plain(configured);
  for (const raw of String(env.PATH || "").split(path.delimiter)) {
    const directory = raw.trim().replace(/^"|"$/gu, "");
    if (!directory) continue;
    const direct = regularFile(path.join(directory, "codex.exe"));
    if (direct) return plain(direct);
    if (!regularFile(path.join(directory, "codex.cmd")) && !regularFile(path.join(directory, "codex.ps1"))) continue;
    const entry = regularFile(path.join(directory, "node_modules", "@openai", "codex", "bin", "codex.js"));
    if (entry) return { command: process.execPath, prefixArgs: [entry] };
  }
  // Same off-PATH desktop location that checks/codex-runtime-smoke.mjs reads.
  const desktop = path.join(String(env.LOCALAPPDATA || ""), "OpenAI", "Codex", "bin");
  const candidates = [];
  try {
    for (const entry of fs.readdirSync(desktop, { withFileTypes: true })) {
      const file = entry.isDirectory() ? path.join(desktop, entry.name, "codex.exe")
        : entry.name.toLowerCase() === "codex.exe" ? path.join(desktop, entry.name) : null;
      const found = file ? regularFile(file) : null;
      if (found) candidates.push(found);
    }
  } catch { /* the Codex desktop CLI is optional */ }
  return plain(candidates.length === 1 ? candidates[0] : "codex");
}

// `claude plugin list --json` returns an array of installed-plugin records shaped
// { id: "codex@openai-codex", version, scope: "project"|"user"|…, enabled: bool, … }.
// The former substring scan over JSON.stringify(list) (audit follow-up 374,
// 09.09.2026) also matched a disabled entry, a user-scoped entry, or a mere
// marketplace mention. The official route requires the exact plugin id enabled at
// project scope, so the list is parsed structurally.
export function officialCodexPluginInstalled(plugins) {
  const list = Array.isArray(plugins) ? plugins
    : Array.isArray(plugins?.plugins) ? plugins.plugins
      : [];
  return list.some((entry) => entry && typeof entry === "object" &&
    entry.id === PLUGIN && entry.scope === "project" && entry.enabled === true);
}

export function runtime(root, options) {
  const codexCommand = resolveCodexCommand(options.codex);
  const codex = run(codexCommand.command, [...codexCommand.prefixArgs, "--version"], root, 120_000, "CODEX_CLI_MISSING");
  if (codex.status !== 0) fail("Codex CLI is not runnable: " + String(codex.stderr || codex.stdout).trim(), 1, "CODEX_CLI_UNAVAILABLE");
  const claudeExecutable = resolveClaudeExecutable(options.claude);
  const claude = run(claudeExecutable, ["plugin", "list", "--json"], root);
  if (claude.status !== 0) fail("Claude Code CLI is not runnable or plugin list failed: " +
    String(claude.stderr || claude.stdout).trim(), 1, "CLAUDE_PLUGIN_LIST_FAILED");
  let plugins;
  try { plugins = JSON.parse(claude.stdout); }
  catch { fail("Claude plugin list did not return JSON", 1, "CLAUDE_PLUGIN_LIST_INVALID"); }
  if (!officialCodexPluginInstalled(plugins)) {
    fail("official project-scoped codex@openai-codex plugin is not installed", 1, "OFFICIAL_CODEX_PLUGIN_MISSING");
  }
  return { codexVersion: String(codex.stdout).trim(), pluginInstalled: true, plugin: PLUGIN };
}

function gitStatus(root) {
  const result = run("git", ["-C", root, "status", "--porcelain=v1", "--untracked-files=all"], root, 30_000);
  if (result.status !== 0) fail("isolated route local reverify could not read Git status", 2, "CODEX_ROUTE_REVERIFY");
  return String(result.stdout || "");
}

function routeFailure(output) {
  if (/Unsupported reasoning effort[\s\S]*max|none[^\r\n]+minimal[^\r\n]+xhigh/iu.test(output)) {
    return ["CODEX_PLUGIN_MAX_UNSUPPORTED", "official codex@openai-codex route rejects required effort max"];
  }
  if (/not authenticated|authentication|required.*setup|run \/codex:setup/iu.test(output)) {
    return ["CODEX_PLUGIN_AUTH_REQUIRED", "official Codex plugin requires local authentication via /codex:setup"];
  }
  return ["CODEX_PLUGIN_ROUTE_FAILED", String(output).trim().slice(0, 2_000) || "official Codex plugin route returned no result"];
}

export function probeRoute(root, options = {}) {
  const available = runtime(root, options);
  const before = gitStatus(root);
  const token = "CODEX_PLUGIN_ROUTE_" + crypto.randomBytes(12).toString("hex");
  const prompt = `/codex:rescue --wait --fresh --model ${CODEX_MODEL} --effort ${CODEX_EFFORT} ` +
    `Read-only capability probe. Do not modify files. Reply exactly with ${token}`;
  const result = run(resolveClaudeExecutable(options.claude), ["-p", "--output-format", "json", "--max-turns", "8",
    "--permission-mode", "plan", prompt], root, 10 * 60_000);
  const combined = String(result.stdout || "") + "\n" + String(result.stderr || "");
  if (result.status !== 0) {
    const [code, message] = routeFailure(combined);
    fail(message, 1, code);
  }
  let payload;
  try { payload = JSON.parse(result.stdout); }
  catch {
    fail("Claude official-plugin route did not return JSON", 1, "CODEX_PLUGIN_ROUTE_INVALID");
  }
  if (payload.is_error || !String(payload.result || "").includes(token) || !String(payload.session_id || "").trim()) {
    const [code, message] = routeFailure(combined);
    fail(message, 1, code);
  }
  const after = gitStatus(root);
  if (after !== before) fail("read-only official-plugin probe changed the isolated fixture", 1, "CODEX_ROUTE_MUTATED_FIXTURE");
  return {
    ...available,
    route: "claude:/codex:rescue",
    model: CODEX_MODEL,
    effort: CODEX_EFFORT,
    claudeSessionId: payload.session_id,
    providerOutputEvidence: false,
    locallyReverified: true,
  };
}

function apply(root, harnessRoot, options) {
  if (!options.yes) fail("apply requires --yes because it downloads and installs a project-scoped plugin");
  if (!repository.samePath(root, harnessRoot)) {
    fail("apply is allowed only after the Harness artifact is installed at the actual project root");
  }
  const executable = resolveClaudeExecutable(options.claude);
  const outputs = [];
  for (const args of commands()) {
    const result = run(executable, args, root);
    if (result.status !== 0) fail("Claude plugin command failed: " + String(result.stderr || result.stdout).trim(), 1);
    outputs.push(String(result.stdout).trim());
  }
  return { applied: true, scope: "project", outputs, next: ["/reload-plugins", "/codex:setup"] };
}

async function main() {
  const options = parse(process.argv.slice(2));
  try {
    const root = repository.assertRepositoryRoot(options.root || process.cwd());
    const harnessRoot = path.resolve(options.harnessRoot ||
      (fs.existsSync(path.join(scriptHarnessRoot, ".claude", "settings.json")) ? scriptHarnessRoot : root));
    const declared = contract(root, harnessRoot);
    let result = declared;
    if (options.command === "runtime") result = { ...declared, runtime: runtime(root, options) };
    else if (options.command === "probe") result = { ...declared, probe: probeRoute(root, options) };
    else if (options.command === "apply") result = { ...declared, installation: apply(root, harnessRoot, options) };
    if (options.json || options.command === "plan" || options.command === "probe") {
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    } else console.log(options.command === "contract" ? "CODEX_PLUGIN_CONTRACT_OK" : "CODEX_PLUGIN_RUNTIME_OK");
  } catch (error) {
    const value = { error: { code: error.code || "CODEX_PLUGIN", message: error.message } };
    if (process.argv.includes("--json")) process.stderr.write(JSON.stringify(value) + "\n");
    else console.error("codex-plugin-bootstrap: " + value.error.code + ": " + error.message);
    process.exitCode = error.exitCode || 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main();
}
