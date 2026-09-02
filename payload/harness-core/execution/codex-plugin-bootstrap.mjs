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

const require = createRequire(import.meta.url);
const repository = require("../binding/repository.cjs");
const scriptHarnessRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const MARKETPLACE = "openai/codex-plugin-cc";
const MARKETPLACE_NAME = "openai-codex";
const PLUGIN = "codex@openai-codex";

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
  if (!/^model = "gpt-5\.6-sol"$/mu.test(config) || !/^model_reasoning_effort = "max"$/mu.test(config)) {
    fail("project Codex config must select gpt-5.6-sol with max effort");
  }
  if (/(?:token|secret|password|client_secret)\s*=/iu.test(config)) fail("project Codex config contains a credential-shaped field");
  return {
    marketplace: MARKETPLACE,
    marketplaceName: MARKETPLACE_NAME,
    plugin: PLUGIN,
    scope: "project",
    model: "gpt-5.6-sol",
    effort: "max",
    harnessRoot,
    commands: commands(),
    postInstall: ["/reload-plugins", "/codex:setup"],
  };
}

function run(executable, args, cwd, timeout = 120_000) {
  const result = spawnSync(executable, args, { cwd, encoding: "utf8", windowsHide: true, timeout });
  if (result.error) {
    const missing = result.error.code === "ENOENT";
    fail(result.error.message, 1, missing ? "CLAUDE_CLI_MISSING" : "CODEX_ROUTE_PROCESS");
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

export function runtime(root, options) {
  const codex = run(options.codex || "codex", ["--version"], root);
  if (codex.status !== 0) fail("Codex CLI is not runnable: " + String(codex.stderr || codex.stdout).trim(), 1, "CODEX_CLI_UNAVAILABLE");
  const claudeExecutable = resolveClaudeExecutable(options.claude);
  const claude = run(claudeExecutable, ["plugin", "list", "--json"], root);
  if (claude.status !== 0) fail("Claude Code CLI is not runnable or plugin list failed: " +
    String(claude.stderr || claude.stdout).trim(), 1, "CLAUDE_PLUGIN_LIST_FAILED");
  let plugins;
  try { plugins = JSON.parse(claude.stdout); }
  catch { fail("Claude plugin list did not return JSON", 1, "CLAUDE_PLUGIN_LIST_INVALID"); }
  const serialized = JSON.stringify(plugins);
  if (!serialized.includes("codex") || !serialized.includes("openai-codex")) {
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
  const prompt = `/codex:rescue --wait --fresh --model gpt-5.6-sol --effort max ` +
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
    model: "gpt-5.6-sol",
    effort: "max",
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
