#!/usr/bin/env node
// Stop hook: bounded local backup warning. It never mutates a repository and
// deliberately performs no network request in the latency-sensitive Stop path.

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const WORKSPACE = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..");
const WORKSPACES_ROOT = path.resolve(WORKSPACE, "..");
const THROTTLE_MIN = 15;
const FILE_THRESHOLD = 8;
const AGE_THRESHOLD_MIN = 120;
const COMMAND_TIMEOUT_MS = 700;
const TOTAL_BUDGET_MS = 10_000;
const SKIP = new Set(["node_modules", ".git", ".next", "dist", "build", "vendor", ".venv"]);

function runGit(args, cwd, options = {}) {
  const runner = options.spawnSyncImpl || spawnSync;
  const result = runner(options.gitExecutable || "git", args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    shell: false,
    timeout: options.timeoutMs || COMMAND_TIMEOUT_MS,
    stdio: ["ignore", "pipe", "ignore"],
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  });
  if (result.error || result.status !== 0) return null;
  return String(result.stdout || "").trim();
}

function isRepo(directory) {
  try {
    const info = fs.lstatSync(path.join(directory, ".git"));
    return info.isDirectory() || (info.isFile() && !info.isSymbolicLink());
  } catch { return false; }
}

function findNestedRepos(root, depth = 0, acc = []) {
  if (depth > 4 || !fs.existsSync(root)) return acc;
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); }
  catch { return acc; }
  for (const entry of entries) {
    if (SKIP.has(entry.name) || !entry.isDirectory() || entry.isSymbolicLink()) continue;
    const directory = path.join(root, entry.name);
    if (isRepo(directory)) acc.push(directory);
    findNestedRepos(directory, depth + 1, acc);
  }
  return acc;
}

function inspectRepository(directory, options = {}) {
  const git = (args) => runGit(args, directory, options);
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]) || "?";
  const remoteUrl = git(["remote", "get-url", "origin"]);
  const localHash = git(["rev-parse", "HEAD"]);
  const upstream = git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  const upstreamHash = upstream ? git(["rev-parse", upstream]) : null;
  const backup = [];
  if (!remoteUrl) backup.push("KEIN GitHub-Remote (nur lokal)");
  else if (!upstream || !upstreamHash) backup.push(`Branch "${branch}" ohne bekannten Fernstand`);
  else if (localHash && upstreamHash !== localHash) backup.push("lokale Commits nicht im bekannten Fernstand");

  const dirty = git(["status", "--porcelain"]);
  const count = dirty ? dirty.split(/\r?\n/).filter(Boolean).length : 0;
  let worktree = null;
  if (count) {
    const epoch = Number(git(["log", "-1", "--format=%ct"]) || 0);
    const ageMinutes = epoch ? Math.floor((Date.now() / 1000 - epoch) / 60) : 99_999;
    if (count > FILE_THRESHOLD || ageMinutes > AGE_THRESHOLD_MIN) worktree = { count, ageMinutes };
  }
  return { backup, worktree };
}

function main(rawInput, options = {}) {
  let sessionId = "global";
  try {
    const value = JSON.parse(rawInput || "{}");
    if (value.session_id) sessionId = String(value.session_id).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40) || "global";
  } catch { /* malformed hook input stays global */ }
  const stamp = path.join(os.tmpdir(), `harness-uncommitted-warn-${sessionId}.stamp`);
  if (!options.noThrottle) {
    try {
      const last = Number(fs.readFileSync(stamp, "utf8"));
      if (Number.isFinite(last) && Date.now() - last < THROTTLE_MIN * 60_000) return null;
    } catch { /* first run */ }
  }

  const started = Date.now();
  const repositories = [WORKSPACE, ...findNestedRepos(path.join(WORKSPACE, "user-projects"))];
  const worktree = [];
  const backup = [];
  let skipped = 0;
  for (let index = 0; index < repositories.length; index++) {
    if (Date.now() - started >= (options.totalBudgetMs || TOTAL_BUDGET_MS)) {
      skipped = repositories.length - index;
      break;
    }
    const directory = repositories[index];
    if (!isRepo(directory)) continue;
    const label = directory === WORKSPACE ? path.basename(directory) : path.relative(WORKSPACES_ROOT, directory);
    const result = inspectRepository(directory, options);
    if (result.backup.length) backup.push(`${label}: ${result.backup.join(" · ")}`);
    if (result.worktree) {
      const age = result.worktree.ageMinutes >= 60
        ? `${Math.floor(result.worktree.ageMinutes / 60)}h${result.worktree.ageMinutes % 60}m`
        : `${result.worktree.ageMinutes}m`;
      worktree.push(`${label}: ${result.worktree.count} Datei(en) NICHT COMMITTET (letzter Commit vor ${age})`);
    }
  }
  if (!options.noThrottle) {
    try { fs.writeFileSync(stamp, String(Date.now())); } catch { /* warning still useful */ }
  }

  if (!worktree.length && !backup.length && !skipped) return null;
  const messages = [];
  if (worktree.length) messages.push("NICHT COMMITTET (ein Absturz kostet Arbeit):\n  - " + worktree.join("\n  - "));
  if (backup.length) messages.push("NICHT IM BEKANNTEN FERNSTAND:\n  - " + backup.join("\n  - "));
  if (skipped) messages.push(`BACKUP-CHECK TEILWEISE: Gesamtdeadline erreicht; ${skipped} Repo(s) nicht bewertet.`);
  const output = JSON.stringify({ systemMessage: messages.join("\n\n") });
  if (!options.capture) console.log(output);
  return output;
}

function selfTest() {
  const calls = [];
  const values = new Map([
    ["rev-parse --abbrev-ref HEAD", "main\n"],
    ["remote get-url origin", "https://example.invalid/repo\n"],
    ["rev-parse HEAD", "aaaa\n"],
    ["rev-parse --abbrev-ref --symbolic-full-name @{u}", "origin/main\n"],
    ["rev-parse origin/main", "bbbb\n"],
    ["status --porcelain", ""],
  ]);
  const result = inspectRepository(WORKSPACE, {
    spawnSyncImpl(command, args, spawnOptions) {
      calls.push({ command, args, spawnOptions });
      return { status: 0, stdout: values.get(args.join(" ")) || "" };
    },
  });
  const failures = [];
  if (!result.backup.some((line) => /lokale Commits/.test(line))) failures.push("local tracking mismatch not reported");
  if (calls.some((call) => call.args.includes("ls-remote"))) failures.push("Stop path still performs a network command");
  if (calls.some((call) => call.spawnOptions.shell !== false || call.spawnOptions.timeout !== COMMAND_TIMEOUT_MS)) {
    failures.push("child command is not shell-free and bounded");
  }
  if (calls.some((call) => call.command !== "git")) failures.push("unexpected executable in fixture");
  if (failures.length) {
    console.error("uncommitted-warn self-test: " + failures.join("; "));
    return 1;
  }
  console.log("uncommitted-warn self-test: 4/4 passed (local-only, bounded, shell-free, tracking-aware)");
  return 0;
}

module.exports = { findNestedRepos, inspectRepository, isRepo, main, runGit };

if (require.main === module) {
  if (process.argv.includes("--selbsttest")) process.exitCode = selfTest();
  else if (process.stdin.isTTY) main("");
  else {
    let input = "";
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => main(input));
  }
}
