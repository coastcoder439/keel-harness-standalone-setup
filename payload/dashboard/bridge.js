#!/usr/bin/env node
// COMMAND BRIDGE -- die Logik hinter der Orchestrations-Seite (bridge.html).
//
// Owner-Zweck [24.08.2026]: sehen UND bedienen statt lesen. Vier Faehigkeiten:
//   1. Alle Paket-Artefakte ueber die EINE Struktur <repo>/docs/packages/*.md
//      (Werkbank + jedes user-projects-Repo) -- lesen und Haken setzen.
//   2. Sessions dieses Workspace (aus ~/.claude/projects/<slug>/*.jsonl --
//      ohne MCP: Titel aus custom-title-Eintraegen, Aktivitaet aus mtime),
//      Rollen aus docs/08-sessions-rollen.md.
//   3. Waechter-Selbsttests auf Knopfdruck (feste Whitelist, kein Pfad-Input).
//   4. Auftraege an Sessions: die Bridge schreibt .claude/orders/<ts>.json;
//      prompt-form.js stellt sie am Wirkzeitpunkt zu (jede Nutzer-Nachricht).
//
// Reine Logik, testbar: Dateizugriffe laufen ueber injizierbare deps.

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");

// Nur diese Waechter haben einen --selbsttest; die Liste ist die Whitelist --
// der Endpunkt akzeptiert NUR diese Namen (kein Pfad vom Client).
const SELFTEST_GUARDS = ["danger-guard", "git-guard", "write-guard", "dod-guard", "prompt-form"];

const CHECKBOX = /^(\s*[-*0-9.\[\]() ]*?)\[( |x)\]/;

// --- 1. Packages ------------------------------------------------------------

function packageRepos(root) {
  const repos = [{ name: path.basename(root), dir: root, kind: "workbench" }];
  const up = path.join(root, "user-projects");
  if (fs.existsSync(up)) {
    for (const e of fs.readdirSync(up, { withFileTypes: true })) {
      if (e.isDirectory()) repos.push({ name: e.name, dir: path.join(up, e.name), kind: "project" });
    }
  }
  return repos;
}

function parsePackage(text) {
  const lines = String(text).split(/\r?\n/);
  const out = { title: "", problem: "", goal: "", status: "", steps: [], openLine: "" };
  let section = "";
  let box = -1;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!out.title && /^#\s+/.test(l)) out.title = l.replace(/^#\s+/, "").trim();
    if (/^\*\*Problem:\*\*/.test(l)) out.problem = l.replace(/^\*\*Problem:\*\*\s*/, "").trim();
    if (/^\*\*Goal:\*\*/.test(l)) out.goal = l.replace(/^\*\*Goal:\*\*\s*/, "").trim();
    if (/^##\s+/.test(l)) section = l.replace(/^##\s+/, "").trim().toLowerCase();
    else if (section.startsWith("status") && l.trim() && !out.status) out.status = l.trim();
    const m = l.match(CHECKBOX);
    if (m) {
      box += 1;
      out.steps.push({ index: box, done: m[2] === "x", text: l.replace(CHECKBOX, "").trim(), line: i + 1 });
    }
    if (/^Offen:/i.test(l.trim())) out.openLine = l.trim();
  }
  return out;
}

function scanPackages(root) {
  const result = [];
  for (const repo of packageRepos(root)) {
    const dir = path.join(repo.dir, "docs", "packages");
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".md") && n !== "TEMPLATE.md")) {
      const rel = path
        .relative(root, path.join(dir, f))
        .split(path.sep)
        .join("/");
      try {
        const parsed = parsePackage(fs.readFileSync(path.join(dir, f), "utf8"));
        const done = parsed.steps.filter((s) => s.done).length;
        result.push({ repo: repo.name, kind: repo.kind, file: rel, ...parsed, doneSteps: done, totalSteps: parsed.steps.length });
      } catch (e) {
        result.push({ repo: repo.name, kind: repo.kind, file: rel, error: e.message });
      }
    }
  }
  return result;
}

// Haken umschalten: n-te Checkbox der Datei kippen. Liefert den neuen Text
// oder einen Fehler -- geschrieben wird beim Aufrufer (serve.js, nach pfadPruefen).
function toggleStep(text, index) {
  const lines = String(text).split(/\r?\n/);
  let box = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(CHECKBOX);
    if (!m) continue;
    box += 1;
    if (box === Number(index)) {
      const neu = m[2] === "x" ? "[ ]" : "[x]";
      lines[i] = lines[i].replace(/\[( |x)\]/, neu);
      return { ok: true, text: lines.join("\n"), nowDone: neu === "[x]" };
    }
  }
  return { ok: false, error: "Checkbox " + index + " nicht gefunden" };
}

// --- 2. Sessions ------------------------------------------------------------

function workspaceSlug(root) {
  return String(root).replace(/[:\\/]/g, "-");
}

function readSessionTitle(file, maxBytes) {
  // custom-title-Eintraege ({type:"custom-title", customTitle:"..."} -- Feldname
  // am echten Transcript gemessen, 24.08.2026) stehen frueh UND spaet (Umbenennung).
  // Deshalb Kopf UND Schwanz der Datei scannen; der letzte Treffer gewinnt.
  let title = "";
  try {
    const size = fs.statSync(file).size;
    const fd = fs.openSync(file, "r");
    const teile = [];
    const kopf = Buffer.alloc(Math.min(maxBytes, size));
    fs.readSync(fd, kopf, 0, kopf.length, 0);
    teile.push(kopf.toString("utf8"));
    if (size > maxBytes) {
      const schwanz = Buffer.alloc(maxBytes);
      fs.readSync(fd, schwanz, 0, schwanz.length, size - maxBytes);
      teile.push(schwanz.toString("utf8"));
    }
    fs.closeSync(fd);
    for (const line of teile.join("\n").split("\n")) {
      if (!line.includes('"custom-title"')) continue;
      try {
        const e = JSON.parse(line);
        if (e.customTitle) title = e.customTitle;
      } catch {}
    }
  } catch {}
  return title;
}

function parseRoles(rolesText) {
  const roles = {};
  for (const line of String(rolesText || "").split(/\r?\n/)) {
    const m = line.match(/^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/);
    if (m && !/^Session-Titel|^---/.test(m[1])) roles[m[1].trim()] = m[2].trim();
  }
  return roles;
}

// Projekt aus der ROLLE lesen -- die Konvention existiert schon, sie wird hier
// nur geparst, nicht erfunden [Owner 26.08.2026: "die Projekte sind laengst
// festgelegt im Harness und Rollen zugewiesen"]. Zwei belegte Muster:
//   "... (Paket docs/packages/dashboard.md)"           -> Workbench-Paket
//   "... Projekt keel-showcase (user-projects) ..."     -> benanntes Projekt
// Ohne Treffer: kein Projekt zugewiesen (kein Rateersatz) -- ausser die Rolle
// nennt "Harness" ausdruecklich, dann ist die Workbench selbst gemeint.
function projectForRole(role, root) {
  if (!role) return null;
  const workbench = path.basename(root);
  const paket = role.match(/(?:^|[\s(])((?:user-projects\/([\w.-]+)\/)?docs\/packages\/([\w.-]+\.md))/);
  if (paket) {
    return { repo: paket[2] || workbench, file: paket[1] };
  }
  const benannt = role.match(/Projekt\s+([\w.-]+)\s*\(user-projects\)/i);
  if (benannt) return { repo: benannt[1], file: null };
  if (/harness/i.test(role)) return { repo: workbench, file: null };
  return null;
}

function scanSessions(root, opts = {}) {
  const dir = opts.sessionsDir || path.join(os.homedir(), ".claude", "projects", workspaceSlug(root));
  const activeMinutes = opts.activeMinutes || 10;
  let roles = {};
  try {
    roles = parseRoles(fs.readFileSync(path.join(root, "docs", "08-sessions-rollen.md"), "utf8"));
  } catch {}
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".jsonl"))) {
    const full = path.join(dir, f);
    const st = fs.statSync(full);
    const title = readSessionTitle(full, 512 * 1024) || f.replace(/\.jsonl$/, "");
    const ageMin = (Date.now() - st.mtimeMs) / 60000;
    const role = roles[title] || null;
    out.push({
      id: f.replace(/\.jsonl$/, ""),
      title,
      role,
      project: projectForRole(role, root),
      lastActivity: st.mtime.toISOString(),
      active: ageMin < activeMinutes,
    });
  }
  return out.sort((a, b) => (a.lastActivity < b.lastActivity ? 1 : -1));
}

// --- 3. Guard self-tests ----------------------------------------------------

function runSelftest(root, guard) {
  if (!SELFTEST_GUARDS.includes(guard)) return { ok: false, error: "unbekannter Waechter" };
  const lauf = spawnSync(process.execPath, [path.join(root, ".claude", guard + ".js"), "--selbsttest"], {
    cwd: root,
    encoding: "utf8",
    timeout: 20000,
  });
  return {
    ok: lauf.status === 0,
    guard,
    output: ((lauf.stdout || "") + (lauf.stderr || "")).trim().split("\n").slice(-8).join("\n"),
  };
}

// --- 4. Orders --------------------------------------------------------------

function writeOrder(root, target, text) {
  const t = String(text || "").trim();
  if (!t) return { ok: false, error: "leerer Auftrag" };
  if (t.length > 2000) return { ok: false, error: "Auftrag laenger als 2000 Zeichen" };
  const dir = path.join(root, ".claude", "orders");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, Date.now() + "-" + Math.random().toString(36).slice(2, 8) + ".json");
  fs.writeFileSync(file, JSON.stringify({ target: String(target || "all"), text: t, from: "bridge", ts: new Date().toISOString() }), "utf8");
  return { ok: true, file: path.basename(file) };
}

module.exports = {
  SELFTEST_GUARDS,
  packageRepos,
  parsePackage,
  scanPackages,
  toggleStep,
  workspaceSlug,
  parseRoles,
  projectForRole,
  scanSessions,
  runSelftest,
  writeOrder,
};
