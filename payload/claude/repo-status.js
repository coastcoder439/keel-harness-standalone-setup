#!/usr/bin/env node
// Repo-Status der Werkbank: das Werkbank-Repo selbst + jedes Projekt-Repo
// darunter. Zeigt getrennt: lokales Git / GitHub-Remote / Sync / ungesicherte
// Dateien. Rein lesend, veraendert nichts.
//
// Die Suche ist REKURSIV, und das ist kein Luxus: Projekt-Repos liegen auch
// zwei Ebenen tief (user-projects/<projekt>/<feature>). Eine flache Suche
// uebersieht sie und meldet "alles gesichert", waehrend dort ungepushte
// Arbeit liegt -- gemessen am 01.08.2026: flach 5 Repos, rekursiv 7.
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const WORKSPACE = path.resolve(__dirname, '..');            // = Wurzel der Werkbank

// --lokal: keine Netzabfrage. Gemessen am 23.08.2026: `git ls-remote` kostet
// 1,85 s je Repo, bei 20 Repos also rund 37 s -- das ist die GESAMTE Laufzeit
// dieses Skripts, alles andere sind Millisekunden. Wer nur wissen will, ob
// ungesicherte Aenderungen herumliegen, soll darauf nicht 37 Sekunden warten.
// Ohne Netz bleibt der Sync-Stand ehrlich unbekannt -- er wird NICHT geraten.
const NUR_LOKAL = process.argv.includes('--lokal');

function sh(cmd, cwd) {
  try { return execSync(cmd, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim(); }
  catch (e) { return null; }
}

function isRepo(dir) {
  // .git kann Verzeichnis (normales Repo) ODER Datei (Worktree) sein
  return fs.existsSync(path.join(dir, '.git'));
}

// Worktree oder eigenstaendiges Repo? Seit die Suche auch UNTERHALB gefundener
// Repos weitergeht (02.08.2026), tauchen Worktrees auf. Sie als gleichrangiges
// Projekt zu melden waere falsch: ein Worktree hat kein eigenes Remote und
// keine eigene Sicherungspflicht -- er haengt am Mutter-Repo.
function worktreeVon(dir) {
  const g = path.join(dir, '.git');
  try {
    if (fs.statSync(g).isDirectory()) return null;
    const m = fs.readFileSync(g, 'utf8').match(/gitdir:\s*(.+)/);
    if (!m) return null;
    // .../<mutter>/.git/worktrees/<name>  ->  <mutter>
    const treffer = m[1].trim().match(/^(.*)\/\.git\/worktrees\//);
    return treffer ? treffer[1] : null;
  } catch (e) {
    return null;
  }
}

function repoInfo(dir, label) {
  if (!isRepo(dir))
    return `  ${label}\n      Lokales Git   : NEIN (kein .git -- nicht versioniert!)`;
  const mutter = worktreeVon(dir);
  if (mutter) {
    const zweig = sh('git rev-parse --abbrev-ref HEAD', dir) || '?';
    const kopf = sh('git rev-parse HEAD', dir) || '';
    const u = ungesichertZaehlen(dir);

    // NICHT behaupten, ein Worktree brauche keine Sicherung -- das MESSEN.
    // Ein Worktree mit abgetrenntem HEAD, dessen Commit in keinem Zweig auf dem
    // Server steckt, ist die gefaehrlichste Stelle im ganzen Baum: die Arbeit
    // sieht vorhanden aus und haengt an nichts. Genau deshalb steht hier eine
    // Messung und kein beruhigender Satz.
    const inFern = (sh(`git branch -r --contains ${kopf}`, mutter) || '')
      .split('\n').map((s) => s.trim()).filter(Boolean);
    const inNah = (sh(`git branch --contains ${kopf}`, mutter) || '')
      .split('\n').map((s) => s.replace(/^\*\s*/, '').trim()).filter(Boolean);

    let lage;
    if (inFern.length) lage = `gesichert -- Commit steckt in ${inFern.join(', ')}`;
    else if (inNah.length) lage = `NUR LOKAL -- Commit steckt in ${inNah.join(', ')}, aber in KEINEM Server-Zweig`;
    else lage = 'NIRGENDS ERREICHBAR -- Commit haengt in keinem Zweig, weder lokal noch auf dem Server!';

    return [
      `  ${label}`,
      `      WORKTREE      : Arbeitskopie von ${path.relative(WORKSPACE, mutter) || mutter}`,
      `      Zweig         : ${zweig} @ ${kopf.slice(0, 7)}`,
      `      Erreichbar    : ${lage}`,
      `      Ungesichert   : ${u.dateien} Datei(en) im Arbeitsbaum`,
    ].join('\n');
  }
  const branch = sh('git rev-parse --abbrev-ref HEAD', dir) || '?';
  const commits = sh('git rev-list --count HEAD', dir) || '0';
  const remoteUrl = sh('git remote get-url origin', dir);
  const ghRepo = remoteUrl
    ? remoteUrl.replace(/.*github\.com[:/]/, '').replace(/\.git$/, '')
    : null;
  let sync;
  if (!remoteUrl) sync = 'KEIN GitHub-Remote -- nur lokal, NICHT gesichert!';
  else if (NUR_LOKAL) {
    // Ohne Netz gibt es zwei ehrliche Auskuenfte, aber keine dritte erfundene:
    // der zuletzt bekannte Fernstand (refs/remotes/origin/<branch> im lokalen
    // Git) sagt, ob seit dem letzten Abgleich etwas liegengeblieben ist. Ob
    // jemand ANDERES seither gepusht hat, weiss man ohne Abfrage nicht -- und
    // genau das steht dann auch da, statt "synchron" zu behaupten.
    const localHash = sh('git rev-parse HEAD', dir);
    const bekannteFerne = sh(`git rev-parse refs/remotes/origin/${branch}`, dir);
    if (!bekannteFerne) sync = `Branch "${branch}" ohne bekannten Fernstand (nicht abgefragt)`;
    else if (bekannteFerne === localHash) sync = 'synchron zum zuletzt bekannten Fernstand (nicht abgefragt)';
    else sync = 'NICHT synchron -- lokale Commits noch nicht gepusht (Fernstand nicht abgefragt)';
  }
  else {
    const localHash = sh('git rev-parse HEAD', dir);
    const ls = sh(`git ls-remote origin refs/heads/${branch}`, dir);
    const remoteHash = ls ? ls.split(/\s/)[0] : '';
    if (!remoteHash) sync = `Branch "${branch}" NICHT auf GitHub (noch nie gepusht)`;
    else if (remoteHash === localHash) sync = 'synchron -- alles gepusht';
    else sync = 'NICHT synchron -- lokale Commits noch nicht gepusht';
  }
  const u = ungesichertZaehlen(dir);
  const zeilen = [
    `  ${label}`,
    `      Lokales Git   : JA (Branch ${branch}, ${commits} Commits)`,
    `      GitHub-Repo   : ${ghRepo || '(keins)'}`,
    `      Sync          : ${sync}`,
    `      Ungesichert   : ${u.dateien} Datei(en) uncommitted` +
      (u.ordner.length ? `  (in ${u.zeilen} Eintraegen, davon ${u.ordner.length} ungetrackte Ordner)` : ''),
  ];
  // Ein ungetrackter Ordner MIT eigenem .git ist der schlimmste Fall: ein ganzes
  // Projekt, das weder hier noch dort gesichert ist. Er bekommt eine eigene Zeile.
  for (const o of u.ordner) {
    const marke = o.istRepo ? '!! EIGENES REPO' : o.repostDrin ? '!! ENTHAELT REPOS' : '   Ordner       ';
    const nachsatz = o.istRepo
      ? ' -- eigenes .git, hier NICHT mitgesichert'
      : o.repostDrin
        ? ` -- ${o.repostDrin} eigene Repo(s) darin, hier NICHT mitgesichert`
        : '';
    zeilen.push(`      ${marke} : ${o.pfad} (${o.anzahl} Datei(en))${nachsatz}`);
  }
  return zeilen.join('\n');
}

// Projekt-Repos finden (max. 4 Ebenen tief).
//
// BERICHTIGT 02.08.2026: Hier stand "Ein gefundenes Repo wird NICHT weiter
// durchsucht -- was darin liegt, gehoert ihm, nicht der Werkbank." Das klang
// vernuenftig und war der Fehler: ein Repo IM Repo wurde nie gefunden.
// Gemessen im Wegwerf-Ordner: user-projects/projekt-a (Repo) mit feature-b
// (eigenes Repo) darin -> feature-b tauchte in KEINER Zeile auf.
// Genau davor warnt die .gitignore dieser Werkbank ("sonst werden ungesicherte
// Projekte unsichtbar + ungeschuetzt zugleich") -- der Pruefer, der das
// aufdecken soll, hatte die Luecke selbst.
const UEBERSPRINGEN = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'vendor', '.venv', 'venv', 'target']);

function findNestedRepos(root, depth = 0, acc = []) {
  if (depth > 4 || !fs.existsSync(root)) return acc;
  let namen; try { namen = fs.readdirSync(root); } catch (e) { return acc; }
  for (const name of namen) {
    if (UEBERSPRINGEN.has(name)) continue;
    const d = path.join(root, name);
    let st; try { st = fs.statSync(d); } catch (e) { continue; }
    if (!st.isDirectory()) continue;
    if (isRepo(d)) acc.push(d);
    // In BEIDEN Faellen weitersuchen -- auch unterhalb eines gefundenen Repos.
    findNestedRepos(d, depth + 1, acc);
  }
  return acc;
}

// Was "git status --porcelain" verschweigt.
//
// Ein ungetrackter ORDNER erscheint als EINE Zeile ("?? projekt-a/"), egal ob
// drei oder dreitausend Dateien darin liegen. Ein komplett ungesichertes Projekt
// zaehlte damit als "1 Datei" -- und blieb unter jeder Warnschwelle.
// Deshalb wird jede Ordner-Zeile aufgeloest und ein darin liegendes .git
// ausdruecklich benannt: DAS ist der gefaehrliche Fall.
function ordnerAufloesen(dir, eintrag) {
  const abs = path.join(dir, eintrag);
  let anzahl = 0, istRepo = false, repostDrin = 0;
  const gehen = (p, tiefe) => {
    if (tiefe > 6 || anzahl > 5000) return;
    let e; try { e = fs.readdirSync(p, { withFileTypes: true }); } catch (x) { return; }
    for (const x of e) {
      // Ein .git GANZ OBEN heisst: der ungetrackte Ordner IST ein Repo.
      // Ein .git weiter unten heisst nur: er ENTHAELT Repos. Zwei verschiedene
      // Aussagen -- die erste Fassung machte daraus eine und log damit ueber
      // user-projects/, das selbst nie ein Repo war.
      if (x.name === '.git') { if (tiefe === 0) istRepo = true; else repostDrin++; continue; }
      if (UEBERSPRINGEN.has(x.name)) continue;
      if (x.isDirectory()) gehen(path.join(p, x.name), tiefe + 1);
      else anzahl++;
    }
  };
  gehen(abs, 0);
  return { anzahl, istRepo, repostDrin };
}

function ungesichertZaehlen(dir) {
  const roh = sh('git status --porcelain', dir);
  const zeilen = roh ? roh.split('\n').filter(Boolean) : [];
  let dateien = 0;
  const ordner = [];
  for (const z of zeilen) {
    const pfad = z.slice(3).replace(/^"|"$/g, '');
    if (pfad.endsWith('/')) {
      const auf = ordnerAufloesen(dir, pfad);
      dateien += auf.anzahl;
      ordner.push({ pfad, ...auf });
    } else dateien++;
  }
  return { dateien, ordner, zeilen: zeilen.length };
}

console.log('\n############  REPO-STATUS  ############\n');

console.log('=== WERKBANK / HARNESS ===');
console.log(repoInfo(WORKSPACE, path.basename(WORKSPACE) + '  <- das zeigt die Statusleiste (Repo-Name)'));

console.log('\n=== PROJEKT-REPOS in user-projects/ (je eigenes GitHub-Repo) ===');
const nested = findNestedRepos(path.join(WORKSPACE, 'user-projects'));
if (!nested.length) console.log('  (keine)');
for (const d of nested.sort()) console.log(repoInfo(d, path.relative(WORKSPACE, d)));

console.log('\n######################################\n');
