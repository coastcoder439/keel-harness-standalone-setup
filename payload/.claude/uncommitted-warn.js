#!/usr/bin/env node
// Stop hook: bounded local backup warning. It never mutates a repository and
// deliberately performs no network request in the latency-sensitive Stop path.

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

// P20, D14: the real git.exe (one process instead of the cmd\git.exe wrapper plus git.exe) and --no-optional-locks on reading
// calls. A Harness tree without the helper keeps working with plain "git".
let gitBinary = null;
try { gitBinary = require("../harness-core/git/git-binary.cjs"); } catch { /* plain git */ }

const WORKSPACE = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..");
const WORKSPACES_ROOT = path.resolve(WORKSPACE, "..");
const THROTTLE_MIN = 15;
const FILE_THRESHOLD = 8;
const AGE_THRESHOLD_MIN = 120;
const COMMAND_TIMEOUT_MS = 700;
const TOTAL_BUDGET_MS = 10_000; // Budget eines Laufs; der Rest folgt im naechsten Lauf (Runden, A14)
const SKIP = new Set(["node_modules", ".git", ".next", "dist", "build", "vendor", ".venv"]);

function runGit(args, cwd, options = {}) {
  const runner = options.spawnSyncImpl || spawnSync;
  const spawnOptions = {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    shell: false,
    timeout: options.timeoutMs || COMMAND_TIMEOUT_MS,
    stdio: ["ignore", "pipe", "ignore"],
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  };
  const result = gitBinary
    ? gitBinary.gitSync(args, spawnOptions, { spawnSync: runner, executable: options.gitExecutable })
    : runner(options.gitExecutable || "git", args, spawnOptions);
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

// --- Runden statt "Gesamtdeadline erreicht" (P4 A14) ---
// Alle Repos bleiben drin. Ist das Zeitbudget eines Laufs erreicht, merkt sich der Lauf in der Stempeldatei,
// bei welchem Repo er war; der naechste Lauf macht dort weiter. Eine Runde ist ein Durchgang ueber alle
// Repos. Gemeldet wird, was in der laufenden Runde gefunden wurde, und fuer die Repos, die diese Runde noch
// nicht erreicht hat, der Befund der letzten vollstaendigen Runde: Ungesichertes wird nie wegen des Budgets
// unsichtbar. Der Stempel ist JSON (frueher nur die Zeit als Zahl; die alte Form bleibt lesbar).
const STAMP_SCHEMA = 2;

function emptyRound() {
  return { checked: [], findings: {} };
}

function cleanRound(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.checked) ||
      !value.findings || typeof value.findings !== "object" || Array.isArray(value.findings)) return emptyRound();
  return { checked: value.checked.filter((item) => typeof item === "string"), findings: { ...value.findings } };
}

function readStamp(file) {
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch { return { lastRun: null, cursor: null, round: emptyRound(), previous: null }; }
  try {
    const value = JSON.parse(text);
    if (value && typeof value === "object" && value.schema === STAMP_SCHEMA) {
      return {
        lastRun: Number.isFinite(value.lastRun) ? value.lastRun : null,
        cursor: typeof value.cursor === "string" ? value.cursor : null,
        round: cleanRound(value.round),
        previous: value.previous && typeof value.previous === "object" ? { findings: cleanRound({ checked: [], findings: value.previous.findings }).findings } : null,
      };
    }
  } catch { /* the old form: a bare number */ }
  const last = Number(text);
  return { lastRun: Number.isFinite(last) ? last : null, cursor: null, round: emptyRound(), previous: null };
}

function writeStamp(file, stamp) {
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify({ schema: STAMP_SCHEMA, ...stamp }), "utf8");
    fs.renameSync(temporary, file);
  } catch {
    try { fs.unlinkSync(temporary); } catch { /* no temporary */ }
  }
}

function describeFinding(label, result) {
  const finding = { worktree: null, backup: result.backup.length ? `${label}: ${result.backup.join(" · ")}` : null };
  if (result.worktree) {
    const age = result.worktree.ageMinutes >= 60
      ? `${Math.floor(result.worktree.ageMinutes / 60)}h${result.worktree.ageMinutes % 60}m`
      : `${result.worktree.ageMinutes}m`;
    finding.worktree = `${label}: ${result.worktree.count} Datei(en) NICHT COMMITTET (letzter Commit vor ${age})`;
  }
  return finding.worktree || finding.backup ? finding : null;
}

// One run: which repositories it inspects and what the report is. Pure apart from the inspection calls.
function runRound({ repositories, stamp, budgetMs, inspect, now }) {
  const started = now();
  let round = stamp.round;
  let previous = stamp.previous;
  let start = stamp.cursor ? repositories.indexOf(stamp.cursor) : 0;
  if (start < 0) start = 0;
  let processed = 0;
  for (let step = 0; step < repositories.length; step++) {
    if (processed > 0 && now() - started >= budgetMs) break;
    const index = (start + step) % repositories.length;
    const directory = repositories[index];
    const finding = isRepo(directory) ? inspect(directory) : null;
    const checked = round.checked.includes(directory) ? round.checked : [...round.checked, directory];
    const findings = { ...round.findings };
    delete findings[directory];
    if (finding) findings[directory] = finding;
    round = { checked, findings };
    processed += 1;
    if (index === repositories.length - 1) {
      previous = { findings: round.findings };
      round = emptyRound();
    }
  }
  const cursor = repositories.length ? repositories[(start + processed) % repositories.length] : null;
  const checkedCount = repositories.filter((directory) => round.checked.includes(directory)).length;
  const partial = checkedCount > 0 && checkedCount < repositories.length;
  const report = [];
  for (const directory of repositories) {
    const source = round.checked.includes(directory) ? round : { findings: previous ? previous.findings : {} };
    if (source.findings[directory]) report.push(source.findings[directory]);
  }
  return { cursor, round, previous, report, partial, checkedCount };
}

function main(rawInput, options = {}) {
  let sessionId = "global";
  try {
    const value = JSON.parse(rawInput || "{}");
    if (value.session_id) sessionId = String(value.session_id).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40) || "global";
  } catch { /* malformed hook input stays global */ }
  const stampPath = path.join(options.stampDir || os.tmpdir(), `harness-uncommitted-warn-${sessionId}.stamp`);
  const now = options.now || Date.now;
  const stamp = options.noThrottle ? { lastRun: null, cursor: null, round: emptyRound(), previous: null } : readStamp(stampPath);
  if (!options.noThrottle && stamp.lastRun !== null && now() - stamp.lastRun < THROTTLE_MIN * 60_000) return null;

  const repositories = options.repositories ||
    [...new Set([WORKSPACE, ...findNestedRepos(path.join(WORKSPACE, "user-projects")).sort()])];
  const label = (directory) => (directory === WORKSPACE ? path.basename(directory) : path.relative(WORKSPACES_ROOT, directory));
  const outcome = runRound({
    repositories,
    stamp,
    budgetMs: options.totalBudgetMs || TOTAL_BUDGET_MS,
    inspect: (directory) => describeFinding(label(directory), (options.inspect || inspectRepository)(directory, options)),
    now,
  });
  if (!options.noThrottle) {
    writeStamp(stampPath, { lastRun: now(), cursor: outcome.cursor, round: outcome.round, previous: outcome.previous });
  }

  const worktree = outcome.report.map((item) => item.worktree).filter(Boolean);
  const backup = outcome.report.map((item) => item.backup).filter(Boolean);
  if (!worktree.length && !backup.length) return null;
  const messages = [];
  if (worktree.length) messages.push("NICHT COMMITTET (ein Absturz kostet Arbeit):\n  - " + worktree.join("\n  - "));
  if (backup.length) messages.push("NICHT IM BEKANNTEN FERNSTAND:\n  - " + backup.join("\n  - "));
  if (outcome.partial) {
    messages.push(`Sicherungsrunde laeuft: ${outcome.checkedCount} von ${repositories.length} Repos in dieser Runde geprueft; der naechste Lauf macht weiter.`);
  }
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
      return { status: 0, stdout: values.get(args.filter((word) => word !== "--no-optional-locks").join(" ")) || "" };
    },
  });
  const failures = [];
  if (!result.backup.some((line) => /lokale Commits/.test(line))) failures.push("local tracking mismatch not reported");
  if (calls.some((call) => call.args.includes("ls-remote"))) failures.push("Stop path still performs a network command");
  if (calls.some((call) => call.spawnOptions.shell !== false || call.spawnOptions.timeout !== COMMAND_TIMEOUT_MS)) {
    failures.push("child command is not shell-free and bounded");
  }
  const expectedProgram = gitBinary ? gitBinary.gitExecutable() : "git";
  if (calls.some((call) => call.command !== expectedProgram)) failures.push("unexpected executable in fixture");
  if (gitBinary && calls.some((call) => ["status", "rev-parse", "log"].includes(call.args.find((word) => !word.startsWith("-"))) &&
      !call.args.includes("--no-optional-locks"))) failures.push("a reading call lacks --no-optional-locks");
  if (failures.length) {
    console.error("uncommitted-warn self-test: " + failures.join("; "));
    return 1;
  }
  console.log("uncommitted-warn self-test: 5/5 passed (local-only, bounded, shell-free, tracking-aware, no optional locks)");
  return 0;
}

module.exports = { findNestedRepos, inspectRepository, isRepo, main, runGit, runRound, readStamp };

if (require.main === module) {
  if (process.argv.includes("--selbsttest")) process.exitCode = selfTest();
  else if (process.stdin.isTTY) main("");
  else {
    let input = "";
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => main(input));
  }
}
