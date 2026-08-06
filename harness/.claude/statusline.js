#!/usr/bin/env node
// Statusline fuer den Workspace: zeigt NICHT den Workspace-Namen,
// sondern das Repo, dessen .git fuer den aktuellen cwd tatsaechlich zustaendig
// ist (Werkbank ODER eines der verschachtelten Projekt-Repos unter
// user-projects/), plus Branch und Sicherungsstatus (ungepushte Commits +
// ungesicherte Dateien). Bekommt das Session-JSON von Claude Code auf stdin.
//
// Rein lokal, keine Netzwerkaufrufe / kein `git fetch`: der ahead-Zaehler
// basiert auf dem zuletzt bekannten Remote-Tracking-Stand -- genau wie bei
// jedem normalen Shell-Prompt (starship, oh-my-zsh & Co). Jeder Git-Aufruf
// ist per Timeout gedeckelt und nutzt --no-optional-locks, damit weder ein
// haengender Prozess noch ein Index-Lock-Konflikt die Statusleiste blockiert.
//
// Vorlage/Referenz: .claude/repo-status.js (dort: voller Report statt Einzeiler).

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const WORKSPACE = path.resolve(__dirname, '..'); // = <WORKSPACE>
const GIT_TIMEOUT_MS = 800;

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); }
  catch (e) { return ''; }
}

function sh(cmd, cwd) {
  try {
    return execSync(cmd, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: GIT_TIMEOUT_MS }).trim();
  } catch (e) {
    return null;
  }
}

// Naechstes .git ab startDir nach oben suchen -- das ist "das zustaendige Repo".
// .git kann Verzeichnis (normales Repo) ODER Datei (Worktree) sein.
function findRepoRoot(startDir) {
  let dir = startDir;
  while (dir) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null; // Dateisystem-Wurzel erreicht
    dir = parent;
  }
  return null;
}

// Kompaktes Label: Werkbank -> Ordnername; verschachteltes Projekt-Repo ->
// Pfad relativ zur Werkbank, ohne das immer gleiche "user-projects/"-Praefix
// (z.B. "projekt/feature" statt "user-projects/projekt/feature").
function repoLabel(repoRoot) {
  if (repoRoot === WORKSPACE) return path.basename(WORKSPACE);
  const rel = path.relative(WORKSPACE, repoRoot).split(path.sep).join('/');
  // Liegt das Repo NICHT unterhalb der Werkbank (fremder Ordner, anderer
  // Nachbau), waere der relative Pfad eine "../../.."-Kette. Dann nur der
  // Ordnername -- sonst ist die Leiste in jedem fremden Repo unlesbar.
  if (rel.startsWith('..')) return path.basename(repoRoot);
  return rel.replace(/^user-projects\//, '');
}

// -- ANSI-Farben -- die Statusleiste wird sonst gedimmt dargestellt, eigene
// Codes bleiben aber sichtbar (nicht entfernen).
const c = {
  reset: '\x1b[0m', dim: '\x1b[2m',
  cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m',
};
const paint = (color, text) => `${color}${text}${c.reset}`;
const SEP = paint(c.dim, ' · ');

let input = {};
try { input = JSON.parse(readStdin() || '{}'); } catch (e) { input = {}; }

const cwd = (input.workspace && input.workspace.current_dir) || input.cwd || process.cwd();
const repoRoot = findRepoRoot(cwd); // findRepoRoot ist bereits fs.existsSync-sicher

if (!repoRoot) {
  console.log(paint(c.dim, `${path.basename(cwd)} (kein Git-Repo)`));
  process.exit(0);
}

const branch = sh('git --no-optional-locks rev-parse --abbrev-ref HEAD', repoRoot) || '?';

// -- Push-Status: rein lokal --------------------------------------------------
const remoteUrl = sh('git --no-optional-locks remote get-url origin', repoRoot);
const upstream = sh('git --no-optional-locks rev-parse --abbrev-ref --symbolic-full-name @{u}', repoRoot);

let syncLabel = null; // nur im Ausnahmefall gesetzt (kein Remote / nie gepusht)
let ahead = 0;
if (!remoteUrl) {
  syncLabel = paint(c.red, 'kein Remote');
} else if (!upstream) {
  syncLabel = paint(c.red, 'nie gepusht');
} else {
  const aheadStr = sh(`git --no-optional-locks rev-list --count ${upstream}..HEAD`, repoRoot);
  ahead = aheadStr ? parseInt(aheadStr, 10) || 0 : 0;
}

// -- ungesicherte Dateien -------------------------------------------------
const statusOut = sh('git --no-optional-locks status --porcelain', repoRoot);
const dirty = statusOut ? statusOut.split('\n').filter(Boolean).length : 0;

// -- Zusammenbauen ----------------------------------------------------------
const statusBits = [];
if (syncLabel) statusBits.push(syncLabel);
else if (ahead > 0) statusBits.push(paint(c.yellow, `↑${ahead}`));
if (dirty > 0) statusBits.push(paint(c.red, `✗${dirty}`));

const statusSegment = statusBits.length ? statusBits.join(' ') : paint(c.green, '✓');

console.log([paint(c.cyan, repoLabel(repoRoot)), paint(c.dim, branch), statusSegment].join(SEP));
