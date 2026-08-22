// Aufzaehlung von Agenten, Faehigkeiten, Befehlen und MCP-Servern -- mit Bordmitteln.
//
// WARUM ES DAS GIBT
// Der Bestands-Bereich der Zustandsseite lud diese Listen aus einem Skript der
// Ursprungs-Werkbank (.ecc-src/scripts/dashboard-web.js). Das liegt einem
// Standalone-Harness nicht bei -- und ohne das Skript stieg der ganze Bereich mit
// "unlesbar" aus. Gemeldet wurde damit ein Defekt, wo nur eine fremde Abhaengigkeit
// fehlte: Genau die Uebersicht, wofuer die Seite da ist (welche Skills und Hooks
// laufen, was zum Lesen bereitliegt), blieb leer.
//
// Hier wird stattdessen gelesen, was da ist. Kein Modul, keine Fremdquelle.
//
// Die Rueckgabe-Formen entsprechen denen des Werkbank-Skripts, damit der Aufrufer
// nicht unterscheiden muss:
//   Agenten  { n: Name, d: Beschreibung, m: Modell }
//   Skills   { n, d }
//   Befehle  { n, d, c: Gruppe }
//   MCP      { f: Datei, s: [{ n: Name, cmd: Startbefehl }] }

const fs = require("fs");
const path = require("path");

// Kopfblock (Frontmatter) lesen: --- ... --- am Dateianfang. Fehlt er, ist das
// kein Fehler -- viele Befehlsdateien haben keinen.
function kopf(datei) {
  let text;
  try {
    text = fs.readFileSync(datei, "utf8");
  } catch {
    return {};
  }
  const zeilen = text.split(/\r?\n/);
  if (zeilen[0].trim() !== "---") return {};
  const felder = {};
  for (let i = 1; i < zeilen.length; i++) {
    if (zeilen[i].trim() === "---") break;
    const m = zeilen[i].match(/^([A-Za-z_-]+):\s*(.*)$/);
    if (m) felder[m[1].toLowerCase()] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return felder;
}

function mdDateien(ordner) {
  try {
    return fs.readdirSync(ordner).filter((f) => f.endsWith(".md")).sort();
  } catch {
    return [];
  }
}

function loadAgents(harness) {
  const ordner = path.join(harness, "agents");
  return mdDateien(ordner).map((f) => {
    const k = kopf(path.join(ordner, f));
    return { n: k.name || f.replace(/\.md$/, ""), d: k.description || "", m: k.model || "" };
  });
}

function loadSkills(harness) {
  const ordner = path.join(harness, "skills");
  let eintraege = [];
  try {
    eintraege = fs.readdirSync(ordner, { withFileTypes: true }).filter((e) => e.isDirectory());
  } catch {
    return [];
  }
  return eintraege
    .map((e) => {
      const k = kopf(path.join(ordner, e.name, "SKILL.md"));
      return { n: k.name || e.name, d: k.description || "" };
    })
    .sort((a, b) => a.n.localeCompare(b.n));
}

function loadCommands(harness) {
  const ordner = path.join(harness, "commands");
  return mdDateien(ordner).map((f) => {
    const k = kopf(path.join(ordner, f));
    return { n: "/" + f.replace(/\.md$/, ""), d: k.description || "", c: k.gruppe || k.group || "" };
  });
}

function loadMcps(harness) {
  const ordner = path.join(harness, "mcp-configs");
  let dateien = [];
  try {
    dateien = fs.readdirSync(ordner).filter((f) => f.endsWith(".json")).sort();
  } catch {
    return [];
  }
  return dateien.map((f) => {
    let daten = {};
    try {
      daten = JSON.parse(fs.readFileSync(path.join(ordner, f), "utf8"));
    } catch {
      return { f, s: [] };
    }
    const server = daten.mcpServers || daten.servers || {};
    const s = Object.entries(server).map(([n, v]) => ({
      n,
      cmd: [v.command, ...(v.args || [])].filter(Boolean).join(" ") || v.url || "",
    }));
    return { f, s };
  });
}

module.exports = { loadAgents, loadSkills, loadCommands, loadMcps };

// Regelsaetze: .claude/rules/<zwischen>/<paket>/*.md. Der Aufrufer laeuft die
// verschachtelte Form selbst ab, wenn die flache Liste leer ist -- dafuer reicht
// es, die Zwischenebene zu nennen (hier "ecc").
function loadRules(harness) {
  const dir = path.join(harness, "rules");
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => ({ l: e.name, f: [] }));
  } catch {
    return [];
  }
}

// Hooks im ECC-Ordnerformat (.claude/hooks/*.md) gibt es in diesem Harness nicht --
// die Waechter haengen in settings.json und werden im Bereich "Waechter" gemessen.
function loadHooks() {
  return [];
}

module.exports.loadRules = loadRules;
module.exports.loadHooks = loadHooks;
