#!/usr/bin/env node
// VERWANDT -- die Kanten zwischen den Eintraegen des Datensatzes.
//
// Eine Kante ist { von, nach, art, beleg }. von/nach sind Eintrags-IDs
// (datei:<posix-pfad>, repo:<name>, mcp:<name>), art ist ein Code aus:
//   eingetragen-in | beschrieben-in | ruft-auf | lizenz | verweist-auf |
//   geaendert-in | ignoriert-in
//
// ZWEI REGELN, die dieses Modul von einer Vermutungsliste unterscheiden:
//   1. JEDE Kante traegt einen Beleg "datei:zeile" -- den Ort, an dem die Aussage
//      steht. Ohne Beleg keine Kante; nachgeschlagen wird an der Quelle, nicht im
//      Gedaechtnis.
//   2. Eine Kante, deren nach-ID im uebergebenen Bestand nicht existiert, wird
//      NICHT ausgegeben, sondern landet mit Grund in fehler[]. Eine tote Kante ist
//      ein Befund, kein Datensatz -- sie erschiene in der Oberflaeche als Sprung
//      ins Leere und behauptete damit genau das, was nicht stimmt.
//
// Quellen: Spezifikation 7.8. Richtung immer AUSSAGE -> ZIEL: von ist die Datei,
// die die Aussage macht (settings.json, CLAUDE.md, ein Command, eine Rule), nach
// ist das, worueber sie redet.
//
// Alle Pfade POSIX, alle Zeilen normalisiert (split auf \r?\n). Vergleiche gegen
// den Bestand case-insensitiv (Windows-Dateisystem).
//
// AUFRUF   const { verwandt } = require("./related");
//          verwandt(wurzel, { dateiIds, hookIds, repoIds, commitIds })

const fs = require("fs");
const path = require("path");

const SETTINGS = ".claude/settings.json";
const CLAUDE_MD = "CLAUDE.md";
const GITIGNORE = ".gitignore";
const COMMANDS = ".claude/commands";
const SKILLS = ".claude/skills";
const RULES = ".claude/rules";
const LIZENZ_ORDNER = "licenses";

// Wo ein blosser Skriptname stehen kann. Reihenfolge = Suchreihenfolge.
const SKRIPT_ORTE = [".claude/", "dashboard/", ""];

const beleg = (datei, zeile) => datei + ":" + zeile;

// ---------------------------------------------------------------------------
// Lesen -- normalisiert, damit kein Wagenruecklauf in Beleg oder Vergleich landet.
// ---------------------------------------------------------------------------
function zeilenLesen(wurzel, relPfad) {
  const voll = path.join(wurzel, relPfad);
  if (!fs.existsSync(voll)) {
    return { fehler: { code: "quelle-fehlt", datei: relPfad, grund: null } };
  }
  try {
    return { zeilen: fs.readFileSync(voll, "utf8").split(/\r?\n/) };
  } catch (e) {
    return { fehler: { code: "nicht-lesbar", datei: relPfad, grund: e.message } };
  }
}

function dateienIm(wurzel, relOrdner, endung) {
  try {
    return fs
      .readdirSync(path.join(wurzel, relOrdner))
      .filter((f) => f.endsWith(endung))
      .sort()
      .map((f) => relOrdner + "/" + f);
  } catch {
    return null;
  }
}

// Alle .md unter einem Ordner, REKURSIV und ordner-agnostisch: Regeln koennen in
// jedem Unterordner von .claude/rules/ liegen (keel, common, ein eigener Name).
// Frueher war hier fest .claude/rules/keel verdrahtet -- eine fremde Installation
// mit Regeln unter anderem Namen bekam keine Verwandtschaftskanten und einen
// falschen "quelle-fehlt"-Fehler. Gibt null zurueck, wenn der Ordner ganz fehlt.
function mdRekursiv(wurzel, relOrdner) {
  const wurzelAbs = path.join(wurzel, relOrdner);
  if (!fs.existsSync(wurzelAbs)) return null;
  const raus = [];
  (function lauf(relDir) {
    let eintraege;
    try {
      eintraege = fs.readdirSync(path.join(wurzel, relDir), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of eintraege.sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = relDir + "/" + e.name;
      if (e.isDirectory()) lauf(rel);
      else if (e.isFile() && e.name.endsWith(".md")) raus.push(rel);
    }
  })(relOrdner);
  return raus;
}

// ---------------------------------------------------------------------------
// Bestand -- der Nachschlag, gegen den jede nach-ID geprueft wird.
// Der Aufrufer darf IDs ("datei:CLAUDE.md") oder blosse Werte ("CLAUDE.md")
// liefern; beides wird auf denselben Schluessel gebracht.
// ---------------------------------------------------------------------------
function mengeAus(werte, praefix) {
  const menge = new Set();
  for (const w of werte || []) {
    if (typeof w !== "string" || w === "") continue;
    const ohne = w.startsWith(praefix + ":") ? w.slice(praefix.length + 1) : w;
    menge.add(ohne.toLowerCase());
  }
  return menge;
}

function nachschlagBauen(bestand) {
  const b = bestand || {};
  return {
    datei: mengeAus(b.dateiIds ? Array.from(b.dateiIds) : [], "datei"),
    hook: mengeAus(b.hookIds, "hook"),
    repo: mengeAus(b.repoIds, "repo"),
    commit: mengeAus(b.commitIds, "commit"),
    mcp: mengeAus(b.mcpIds, "mcp"),
  };
}

// Ein MCP-Werkzeug ist kein Ding auf der Platte. Es gibt hier kein Verzeichnis,
// gegen das man es pruefen koennte -- der Name im Command IST der Beleg. Wer
// solche Kanten wie fehlende Dateien behandelt, verwirft sie alle und meldet
// "tote Verweise", wo in Wahrheit ein Command sauber ein Werkzeug aufruft.
// Deshalb: mcp-Ziele gelten, werden aber als extern gekennzeichnet, damit die
// Oberflaeche sie als Text zeigt und nicht als Sprung anbietet.
const EXTERNE_ARTEN = new Set(["mcp"]);

function artVon(id) {
  const trenner = id.indexOf(":");
  return trenner < 1 ? null : id.slice(0, trenner);
}

function istExtern(id) {
  return EXTERNE_ARTEN.has(artVon(id));
}

function existiert(nachschlag, id) {
  const trenner = id.indexOf(":");
  if (trenner < 1) return false;
  const praefix = id.slice(0, trenner);
  if (EXTERNE_ARTEN.has(praefix)) {
    // Kein lokaler Bestand zum Vergleichen -- es sei denn, der Aufrufer liefert
    // ausdruecklich eine Liste (dann wird geprueft).
    const menge = nachschlag[praefix];
    return menge && menge.size ? menge.has(id.slice(trenner + 1).toLowerCase()) : true;
  }
  const menge = nachschlag[praefix];
  return menge ? menge.has(id.slice(trenner + 1).toLowerCase()) : false;
}

// Findet den ersten Pfad, den der Bestand kennt -- und liefert die ID in der
// Schreibweise des Kandidaten, nicht in Kleinschreibung.
function dateiIdFinden(nachschlag, kandidaten) {
  for (const k of kandidaten) {
    if (nachschlag.datei.has(k.toLowerCase())) return "datei:" + k;
  }
  return null;
}

function skriptKandidaten(name) {
  if (name.indexOf("/") !== -1) return [name];
  return SKRIPT_ORTE.map((ort) => ort + name);
}

// ---------------------------------------------------------------------------
// Sammler -- die EINE Stelle, an der ueber Aufnahme oder Befund entschieden wird.
// ---------------------------------------------------------------------------
function sammlerBauen(nachschlag) {
  const kanten = [];
  const fehler = [];
  const gesehen = new Set();
  return {
    kanten,
    fehler,
    fehlerMelden: (f) => fehler.push(f),
    // nach darf null sein: dann liess sich das Ziel gar nicht aufloesen.
    anlegen(von, nach, art, wo, name) {
      if (!nach) {
        fehler.push({ code: "ziel-unbekannt", von, nach: null, art, beleg: wo, name: name || null });
        return;
      }
      if (!existiert(nachschlag, nach)) {
        fehler.push({ code: "nach-fehlt", von, nach, art, beleg: wo, name: name || null });
        return;
      }
      const schluessel = von + "|" + nach + "|" + art + "|" + wo;
      if (gesehen.has(schluessel)) return;
      gesehen.add(schluessel);
      // extern heisst: das Ziel liegt nicht in diesem Ordner. Die Oberflaeche
      // zeigt es als Text statt als Sprung -- ein Sprung, der nirgends ankommt,
      // ist schlimmer als gar keiner.
      const kante = { von, nach, art, beleg: wo };
      if (istExtern(nach)) { kante.extern = true; kante.name = name || null; }
      kanten.push(kante);
    },
  };
}

// ---------------------------------------------------------------------------
// Quelle 1 -- settings.json: jedes command auf sein Skript (eingetragen-in).
// Gelesen wird zeilenweise, weil JSON.parse keine Zeilennummer liefert und ein
// Beleg ohne Zeile wertlos waere. JSON.parse laeuft trotzdem als Gegenprobe.
// ---------------------------------------------------------------------------
function ausSettings(wurzel, sammler, nachschlag) {
  const gelesen = zeilenLesen(wurzel, SETTINGS);
  if (gelesen.fehler) return sammler.fehlerMelden(gelesen.fehler);
  try {
    JSON.parse(gelesen.zeilen.join("\n"));
  } catch (e) {
    sammler.fehlerMelden({ code: "nicht-lesbar", datei: SETTINGS, grund: e.message });
  }
  const von = "datei:" + SETTINGS;
  gelesen.zeilen.forEach((z, i) => {
    if (!/"command"\s*:/.test(z)) return;
    const treffer = z.match(/\.claude\/([A-Za-z0-9._-]+\.js)/);
    if (!treffer) return;
    const name = ".claude/" + treffer[1];
    const ziel = dateiIdFinden(nachschlag, [name]);
    sammler.anlegen(von, ziel, "eingetragen-in", beleg(SETTINGS, i + 1), name);
  });
}

// ---------------------------------------------------------------------------
// Quelle 2 -- CLAUDE.md Abschnitt 3: jeder Skriptname (beschrieben-in).
// ---------------------------------------------------------------------------
function ausClaudeMd(wurzel, sammler, nachschlag) {
  const gelesen = zeilenLesen(wurzel, CLAUDE_MD);
  if (gelesen.fehler) return sammler.fehlerMelden(gelesen.fehler);
  const von = "datei:" + CLAUDE_MD;
  const muster = /(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.js\b/g;
  // Die Werkzeuge stehen in CLAUDE.md als TABELLE. Frueher war fest "Abschnitt 3"
  // vorausgesetzt -- eine fremde CLAUDE.md hat den nicht (der Installer
  // ueberschreibt keine vorhandene). Deshalb abschnittsfrei: jede Tabellenzeile
  // (beginnt mit |) wird nach .js-Verweisen durchsucht, genau wie
  // hooks-detail.js:claudeMdZeileFinden. Kein "abschnitt-fehlt"-Fehler mehr.
  gelesen.zeilen.forEach((z, i) => {
    if (!/^\s*\|/.test(z)) return;
    for (const name of new Set(z.match(muster) || [])) {
      const ziel = dateiIdFinden(nachschlag, skriptKandidaten(name));
      sammler.anlegen(von, ziel, "beschrieben-in", beleg(CLAUDE_MD, i + 1), name);
    }
  });
}

// ---------------------------------------------------------------------------
// Quelle 3 -- Commands: node .claude/<x>.js und mcp__<name> (ruft-auf).
// Ein blosser Dateiname ohne "node" davor ist eine Erwaehnung, kein Aufruf --
// deshalb steht das Wort im Muster.
// ---------------------------------------------------------------------------
function ausCommands(wurzel, sammler, nachschlag) {
  const dateien = dateienIm(wurzel, COMMANDS, ".md");
  if (dateien === null) {
    return sammler.fehlerMelden({ code: "quelle-fehlt", datei: COMMANDS, grund: null });
  }
  for (const datei of dateien) {
    const gelesen = zeilenLesen(wurzel, datei);
    if (gelesen.fehler) {
      sammler.fehlerMelden(gelesen.fehler);
      continue;
    }
    const von = "datei:" + datei;
    gelesen.zeilen.forEach((z, i) => {
      const skript = z.match(/\bnode\s+\S*?\.claude\/([A-Za-z0-9._-]+\.js)/);
      if (skript) {
        const name = ".claude/" + skript[1];
        const ziel = dateiIdFinden(nachschlag, [name]);
        sammler.anlegen(von, ziel, "ruft-auf", beleg(datei, i + 1), name);
      }
      for (const werkzeug of new Set(z.match(/\bmcp__[a-z0-9_]+/gi) || [])) {
        sammler.anlegen(von, "mcp:" + werkzeug, "ruft-auf", beleg(datei, i + 1), werkzeug);
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Quelle 4 -- Skills: Herkunftsblock und Lizenzfeld auf licenses/ (lizenz).
// Der Kopfblock nennt die Lizenzdatei unter einem Pfad, den es hier nicht gibt.
// Verknuepft wird deshalb ueber den HERKUNFTSNAMEN auf die Datei, die wirklich
// liegt -- und die Existenz wird geprueft wie bei jeder anderen Kante auch.
// ---------------------------------------------------------------------------
const HERKUNFT = [{ muster: /mattpocock\/skills/, datei: "LICENSE-mattpocock-skills.txt" }];

function skillZiel(zeile, ordner) {
  for (const h of HERKUNFT) {
    if (h.muster.test(zeile)) return LIZENZ_ORDNER + "/" + h.datei;
  }
  if (/^\s*license\s*:\s*\S/i.test(zeile)) return LIZENZ_ORDNER + "/LICENSE-" + ordner + ".txt";
  return null;
}

function skillOrdner(wurzel) {
  try {
    return fs
      .readdirSync(path.join(wurzel, SKILLS), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    return null;
  }
}

function ausSkills(wurzel, sammler, nachschlag) {
  const ordner = skillOrdner(wurzel);
  if (ordner === null) {
    return sammler.fehlerMelden({ code: "quelle-fehlt", datei: SKILLS, grund: null });
  }
  for (const name of ordner) {
    const datei = SKILLS + "/" + name + "/SKILL.md";
    const gelesen = zeilenLesen(wurzel, datei);
    if (gelesen.fehler) {
      sammler.fehlerMelden(gelesen.fehler);
      continue;
    }
    const von = "datei:" + datei;
    gelesen.zeilen.slice(0, 20).forEach((z, i) => {
      const ziel = skillZiel(z, name);
      if (!ziel) return;
      sammler.anlegen(von, dateiIdFinden(nachschlag, [ziel]), "lizenz", beleg(datei, i + 1), ziel);
    });
  }
}

// ---------------------------------------------------------------------------
// Quelle 5 -- Rules: docs/<x>.md-Verweise ueberall, dazu die Ziele im
// "Verwandt:"-Block. Der Block reicht bis zur naechsten Leerzeile, weil er
// umbricht (working-method.md:43-44 -- eine Zeile allein verloere die Haelfte).
// ---------------------------------------------------------------------------
function verweiseDerZeile(zeile, imBlock, relPfad) {
  const ziele = new Set();
  for (const t of zeile.match(/docs\/[A-Za-z0-9._-]+\.md\b/g) || []) ziele.add(t);
  if (!imBlock) return ziele;
  for (const t of zeile.match(/\]\(([^)\s]+)\)/g) || []) {
    const roh = t.slice(2, -1).replace(/#.*$/, "");
    if (!/\.md$/.test(roh) || /^[a-z]+:/i.test(roh)) continue;
    ziele.add(path.posix.normalize(path.posix.join(path.posix.dirname(relPfad), roh)));
  }
  return ziele;
}

function ausRules(wurzel, sammler, nachschlag) {
  const dateien = mdRekursiv(wurzel, RULES);
  if (dateien === null) {
    return sammler.fehlerMelden({ code: "quelle-fehlt", datei: RULES, grund: null });
  }
  for (const datei of dateien) {
    const gelesen = zeilenLesen(wurzel, datei);
    if (gelesen.fehler) {
      sammler.fehlerMelden(gelesen.fehler);
      continue;
    }
    const von = "datei:" + datei;
    let imBlock = false;
    gelesen.zeilen.forEach((z, i) => {
      if (/\bVerwandt:/.test(z)) imBlock = true;
      else if (z.trim() === "") imBlock = false;
      for (const ziel of verweiseDerZeile(z, imBlock, datei)) {
        const id = dateiIdFinden(nachschlag, [ziel]);
        sammler.anlegen(von, id, "verweist-auf", beleg(datei, i + 1), ziel);
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Quelle 6 -- .gitignore: jede Projektzeile auf ihr Repo (ignoriert-in).
// ---------------------------------------------------------------------------
function ausGitignore(wurzel, sammler) {
  const gelesen = zeilenLesen(wurzel, GITIGNORE);
  if (gelesen.fehler) return sammler.fehlerMelden(gelesen.fehler);
  const von = "datei:" + GITIGNORE;
  gelesen.zeilen.forEach((z, i) => {
    const treffer = z.trim().match(/^user-projects\/([A-Za-z0-9._-]+)\/?$/);
    if (!treffer) return;
    sammler.anlegen(von, "repo:" + treffer[1], "ignoriert-in", beleg(GITIGNORE, i + 1), treffer[1]);
  });
}

// ---------------------------------------------------------------------------
// Hauptzug
// ---------------------------------------------------------------------------
function verwandt(wurzel, bestand) {
  const nachschlag = nachschlagBauen(bestand);
  const sammler = sammlerBauen(nachschlag);
  ausSettings(wurzel, sammler, nachschlag);
  ausClaudeMd(wurzel, sammler, nachschlag);
  ausCommands(wurzel, sammler, nachschlag);
  ausSkills(wurzel, sammler, nachschlag);
  ausRules(wurzel, sammler, nachschlag);
  ausGitignore(wurzel, sammler);
  return { kanten: sammler.kanten, fehler: sammler.fehler };
}

module.exports = { verwandt };
