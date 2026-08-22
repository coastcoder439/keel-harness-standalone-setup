#!/usr/bin/env node
// Stop-Hook: warnt (systemMessage), wenn irgendein Repo eine BACKUP-LUECKE hat
// -- kein GitHub-Remote, ungepushte Commits, oder viel/altes Ungesichertes.
// Committet/pusht NICHTS. Throttle gegen Spam. Deckt Harness + work/-Repos + Fork.
//
// Drossel-Stempel PRO SITZUNG [Beschluss D8, Auftraggeber 01.08.2026]: Der alte globale
// Stempel liess bei 9 parallelen Sitzungen jede Sitzung das 15-Minuten-Fenster
// ALLER anderen zuruecksetzen -- Warnungen verschwanden zufaellig. session_id
// liefert der Stop-Hook via stdin-JSON; ohne stdin (Handaufruf) gilt "global".
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const WORKSPACE = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, '..');
const WORKSPACES_ROOT = path.resolve(WORKSPACE, '..');
const THROTTLE_MIN = 15, FILE_THRESHOLD = 8, AGE_THRESHOLD_MIN = 120;

function sh(c, cwd) {
  try { return execSync(c, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim(); }
  catch (e) { return null; }
}
function isRepo(d) { return fs.existsSync(path.join(d, '.git')); }

function findNestedRepos(root, depth = 0, acc = []) {
  if (depth > 3 || !fs.existsSync(root)) return acc;
  for (const name of fs.readdirSync(root)) {
    if (name === 'node_modules' || name === '.git') continue;
    const d = path.join(root, name);
    let st; try { st = fs.statSync(d); } catch (e) { continue; }
    if (!st.isDirectory()) continue;
    if (isRepo(d)) acc.push(d); else findNestedRepos(d, depth + 1, acc);
  }
  return acc;
}

function main(rohEingabe) {
  let sid = 'global';
  try {
    const d = JSON.parse(rohEingabe || '{}');
    if (d.session_id) sid = String(d.session_id).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'global';
  } catch (e) {}
  const stamp = path.join(os.tmpdir(), `harness-uncommitted-warn-${sid}.stamp`);

  try {
    const last = parseInt(fs.readFileSync(stamp, 'utf8'), 10);
    if (Number.isFinite(last) && Date.now() - last < THROTTLE_MIN * 60000) return;
  } catch (e) {}

  const repos = [
    WORKSPACE,
    ...findNestedRepos(path.join(WORKSPACE, 'user-projects')),
  ];

  // Zwei GETRENNTE Zustaende, nicht ein Topf [Fork-Befund via HARNESS CONTROL, 01.08.2026]:
  //   offen   = Dateien im Arbeitsbaum, nicht committet -> ein Absturz kostet ARBEIT
  //   ungepusht = committet, nicht auf GitHub          -> Verlust nur der HISTORIE/Redundanz
  // Vorher standen beide gleichrangig in einer Zeile unter einer Push-lastigen Ueberschrift;
  // wer den Anfang las, sortierte den dringenderen Fall als Push-Sache ein.
  const offen = [];
  const ungepusht = [];
  for (const d of repos) {
    if (!isRepo(d)) continue;
    const label = d === WORKSPACE ? path.basename(d) : path.relative(WORKSPACES_ROOT, d);
    const reasons = [];

    const branch = sh('git rev-parse --abbrev-ref HEAD', d) || '?';
    const remoteUrl = sh('git remote get-url origin', d);
    if (!remoteUrl) {
      reasons.push('KEIN GitHub-Remote (nur lokal)');
    } else {
      const localHash = sh('git rev-parse HEAD', d);
      const ls = sh(`git ls-remote origin refs/heads/${branch}`, d);
      const remoteHash = ls ? ls.split(/\s/)[0] : '';
      if (!remoteHash) reasons.push(`Branch "${branch}" nie gepusht`);
      else if (remoteHash !== localHash) reasons.push('ungepushte Commits');
    }

    if (reasons.length) ungepusht.push(`${label}: ${reasons.join(' · ')}`);

    const dirty = sh('git status --porcelain', d);
    const count = dirty ? dirty.split('\n').filter(Boolean).length : 0;
    if (count) {
      const ep = parseInt(sh('git log -1 --format=%ct', d) || '0', 10);
      const ageMin = ep ? Math.floor((Date.now() / 1000 - ep) / 60) : 99999;
      if (count > FILE_THRESHOLD || ageMin > AGE_THRESHOLD_MIN) {
        const a = ageMin >= 60 ? `${Math.floor(ageMin / 60)}h${ageMin % 60}m` : `${ageMin}m`;
        offen.push(`${label}: ${count} Datei(en) NICHT COMMITTET (letzter Commit vor ${a})`);
      }
    }
  }

  try { fs.writeFileSync(stamp, String(Date.now())); } catch (e) {}

  if (offen.length || ungepusht.length) {
    const teile = [];
    if (offen.length) {
      teile.push(
        '⚠️  NICHT COMMITTET (ein Absturz kostet diese Arbeit):\n  - ' + offen.join('\n  - ') +
        '\n  -> Zuerst committen: git commit -m "…" -- <pfad> (im Werkbank-Repo Pflicht), dann pushen.'
      );
    }
    if (ungepusht.length) {
      teile.push(
        'ℹ️  COMMITTET, ABER NICHT AUF GITHUB (Historie ohne Zweitkopie):\n  - ' + ungepusht.join('\n  - ') +
        '\n  -> Pushen genuegt; die Arbeit selbst ist bereits gesichert.'
      );
    }
    console.log(JSON.stringify({ systemMessage: teile.join('\n\n') }));
  }
}

if (process.stdin.isTTY) {
  main('');
} else {
  let eingabe = '';
  process.stdin.on('data', (c) => (eingabe += c));
  process.stdin.on('end', () => main(eingabe));
}
