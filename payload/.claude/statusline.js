#!/usr/bin/env node
// Statusline fuer den Workspace: zeigt NICHT den Workspace-Namen,
// sondern das Repo, dessen .git fuer den aktuellen cwd tatsaechlich zustaendig
// ist (Werkbank ODER eines der verschachtelten Projekt-Repos unter
// user-projects/), plus Branch und Sicherungsstatus (ungepushte Commits +
// ungesicherte Dateien). Bekommt das Session-JSON von Claude Code auf stdin.
//
// Rein lokal, keine Netzwerkaufrufe / kein `git fetch`: der ahead-Zaehler
// basiert auf dem zuletzt bekannten Remote-Tracking-Stand -- genau wie bei
// jedem normalen Shell-Prompt (starship, oh-my-zsh & Co). Es ist genau EIN Git-Aufruf
// (status --porcelain=v2 --branch) ohne Shell, per Timeout gedeckelt und mit --no-optional-locks,
// damit weder ein haengender Prozess noch ein Index-Lock-Konflikt die Statusleiste blockiert.
//
// Vorlage/Referenz: .claude/repo-status.js (dort: voller Report statt Einzeiler).

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// P20, D14: der echte git.exe (ein Prozess statt Wrapper cmd\git.exe plus git.exe), ohne dass die Statuszeile dafuer einen
// Prozess startet (der Helfer liest nur den PATH). Ohne Helfer bleibt es beim einfachen "git".
let gitBinary = null;
try { gitBinary = require('../harness-core/git/git-binary.cjs'); } catch (e) { /* einfaches git */ }

const WORKSPACE = path.resolve(__dirname, '..'); // = die Workspace-Wurzel
const GIT_TIMEOUT_MS = 800;
// Only the tests set KEEL_STATUSLINE_GIT_TIMEOUT_MS: on a machine that runs many test files at once the one Git call can need more
// than 800 ms, and the line would show "?" for it. Read only when set, and only a positive whole number counts; the product limit
// above stays what a session gets.
const GIT_TIMEOUT = /^[1-9][0-9]{0,6}$/.test(String(process.env.KEEL_STATUSLINE_GIT_TIMEOUT_MS || '')) ?
  Number(process.env.KEEL_STATUSLINE_GIT_TIMEOUT_MS) : GIT_TIMEOUT_MS;

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); }
  catch (e) { return ''; }
}

// Genau EIN Git-Aufruf je Aktualisierung, ohne Shell (weder Windows-Eingabeaufforderung noch sh): spawnSync mit
// Argumentliste und shell:false. Er liefert Branch, ahead/behind und die Zahl der Aenderungen.
// Das kurze Zeitlimit bleibt (Schutz einer einzelnen Git-Abfrage, bricht keine Arbeit ab).
function gitStatus(cwd) {
  const args = ['--no-optional-locks', 'status', '--porcelain=v2', '--branch'];
  const spawnOptions = {
    cwd, encoding: 'utf8', shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
    timeout: GIT_TIMEOUT,
  };
  const result = gitBinary ? gitBinary.gitSync(args, spawnOptions) : spawnSync('git', args, spawnOptions);
  if (result.error || result.status !== 0) return null;
  return String(result.stdout || '');
}

// Liest die Ausgabe von status --porcelain=v2 --branch. Kopfzeilen beginnen mit "# ", jede andere
// nichtleere Zeile ist eine ungesicherte Datei (geaendert, umbenannt, nicht zusammengefuehrt,
// unversioniert) -- dieselbe Zahl, die "status --porcelain" zeilenweise ergab.
function parseStatus(text) {
  const info = { branch: '?', upstream: null, ahead: 0, dirty: 0 };
  if (text === null) return info;
  let head = null;
  let initial = false;
  let counted = false; // "# branch.ab" kam: der Upstream ist wirklich vorhanden
  for (const line of text.split('\n')) {
    if (!line) continue;
    if (line.startsWith('# branch.head ')) head = line.slice('# branch.head '.length).trim();
    else if (line.startsWith('# branch.oid ')) initial = line.includes('(initial)');
    else if (line.startsWith('# branch.upstream ')) info.upstream = line.slice('# branch.upstream '.length).trim();
    else if (line.startsWith('# branch.ab ')) {
      const match = /^\+(\d+) -(\d+)/.exec(line.slice('# branch.ab '.length));
      info.ahead = match ? parseInt(match[1], 10) || 0 : 0;
      counted = true;
    } else if (!line.startsWith('#')) info.dirty += 1;
  }
  // Ein Upstream, dessen Ref gelöscht ist ([gone]), steht noch als "# branch.upstream" in der Ausgabe,
  // hat aber kein "# branch.ab". Vorher löste @{u} dann nicht auf: Label "nie gepusht", kein grünes Häkchen.
  if (!counted) info.upstream = null;
  // Vorher: rev-parse --abbrev-ref HEAD -- "HEAD" im losgeloesten Zustand, "?" ohne ersten Commit.
  if (head && !initial) info.branch = head === '(detached)' ? 'HEAD' : head;
  return info;
}

// Ob ein Remote "origin" eingerichtet ist, steht in der Git-Konfiguration des Repos. Sie wird als
// Datei gelesen statt ueber einen zweiten Git-Aufruf (die Statuszeile ruft Git genau einmal auf).
function hasOriginRemote(repoRoot) {
  try {
    let gitDir = path.join(repoRoot, '.git');
    if (fs.statSync(gitDir).isFile()) {
      const match = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(gitDir, 'utf8'));
      if (!match) return false;
      gitDir = path.resolve(repoRoot, match[1].trim());
    }
    let common = gitDir;
    try { common = path.resolve(gitDir, fs.readFileSync(path.join(gitDir, 'commondir'), 'utf8').trim()); } catch (e) { /* kein Worktree */ }
    return /^\s*\[remote\s+"origin"\]/mi.test(fs.readFileSync(path.join(common, 'config'), 'utf8'));
  } catch (e) {
    return false;
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

const status = parseStatus(gitStatus(repoRoot));
const branch = status.branch;

// -- Push-Status: rein lokal --------------------------------------------------
let syncLabel = null; // nur im Ausnahmefall gesetzt (kein Remote / nie gepusht)
const ahead = status.ahead;
if (!status.upstream) {
  syncLabel = hasOriginRemote(repoRoot) ? paint(c.red, 'nie gepusht') : paint(c.red, 'kein Remote');
}

// -- ungesicherte Dateien -------------------------------------------------
const dirty = status.dirty;

// -- Zusammenbauen ----------------------------------------------------------
const statusBits = [];
if (syncLabel) statusBits.push(syncLabel);
else if (ahead > 0) statusBits.push(paint(c.yellow, `↑${ahead}`));
if (dirty > 0) statusBits.push(paint(c.red, `✗${dirty}`));

const statusSegment = statusBits.length ? statusBits.join(' ') : paint(c.green, '✓');

console.log([paint(c.cyan, repoLabel(repoRoot)), paint(c.dim, branch), statusSegment].join(SEP));
