#!/usr/bin/env node
// ZU TUN AUS DOKUMENTEN -- die Offenpunkte, die in Dateien stehen statt in der Messung.
//
// Dieses Modul liefert DATEN, keine Saetze fuer Menschen. Jeder Eintrag traegt einen
// artCode (checkbox | offen-ueberschrift | offen-inline | platzhalter | leere-vorlage)
// und seinen Fundort. Die deutschen Labels entstehen spaeter in render/data.js -- so
// bleibt die Messung sprachneutral, und die Wortliste ist an EINER Stelle pruefbar.
//
// Quellen und Muster: Spezifikation 7.5. rebuild-guide.md nur der Kopf (Zeile 1-60).
// Die Muster laufen auf NORMALISIERTEN Zeilen (split auf \r?\n) -- sonst haengt ein
// Wagenruecklauf am Zeilenende und macht jedes Muster mit $ und jeden Vergleich falsch.
//
// FEHLER WERDEN NIE GESCHLUCKT: fehlende oder unlesbare Quellen landen mit Code und
// Grund in fehler[]. Eine fehlende Quelle stumm als "nichts offen" zu zeigen waere
// dieselbe Falle wie ein Werkzeugausfall, der aussieht wie ein bestandener Test.
//
// AUFRUF   const { zuTunDoku } = require("./zutun-docs"); zuTunDoku(wurzel)

const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// Quellen -- exakt nach Spezifikation 7.5.
//   bisZeile   > 0 begrenzt den gelesenen Kopf (rebuild-guide.md: 60)
//   platzhalter true sucht zusaetzlich die Ausfuell-Marken (nur CLAUDE.md)
// ---------------------------------------------------------------------------
// Feste Quellen: docs/-Konventionen des Bausatzes und CLAUDE.md. Die
// output-shape-Regel steht NICHT fest hier -- sie kann in jedem Unterordner von
// .claude/rules/ liegen (keel, common, eigen) und wird zur Laufzeit gesucht
// (regelDateiFinden), sonst meldete ein fremder Workspace einen falschen
// "quelle-fehlt" und uebersaehe die echte Regel. [Review-Fund W]
const QUELLEN = [
  { pfad: "docs/harness-issues.md", bisZeile: 0, platzhalter: false },
  { pfad: "docs/kit-backport.md", bisZeile: 0, platzhalter: false },
  { pfad: "docs/rebuild-guide.md", bisZeile: 60, platzhalter: false },
  { pfad: "CLAUDE.md", bisZeile: 0, platzhalter: true },
];

// output-shape.md irgendwo unter .claude/rules/ finden (rekursiv). Gibt den
// rel. POSIX-Pfad zurueck oder null.
function regelDateiFinden(wurzel, name) {
  const start = path.join(wurzel, ".claude", "rules");
  let treffer = null;
  (function lauf(dir) {
    if (treffer) return;
    let eintraege;
    try {
      eintraege = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of eintraege.sort((a, b) => a.name.localeCompare(b.name))) {
      if (treffer) return;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) lauf(p);
      else if (e.name === name) treffer = p;
    }
  })(start);
  return treffer ? String(path.relative(wurzel, treffer)).split(path.sep).join("/") : null;
}

// Die leere Vorlage ist eine eigene Quelle: hier zaehlt nicht eine Zeile, sondern
// dass die Tabellen NICHTS tragen.
const VORLAGE_QUELLE = "docs/tool-landscape.md";

// Reihenfolge ist bedeutsam: der erste Treffer gewinnt, damit eine Zeile genau einen
// artCode bekommt ("# Offen: ..." ist eine Ueberschrift, keine Inline-Stelle).
const MUSTER = [
  { artCode: "checkbox", muster: /^\s*[-*]\s*\[ \]/ },
  { artCode: "offen-ueberschrift", muster: /^#+\s*Offen/ },
  { artCode: "offen-inline", muster: /\bOffen:/ },
  { artCode: "offen-inline", muster: /noch offen/ },
];

const PLATZHALTER_MUSTER = /\[\?\]|\[AUSFUELLEN\]/;

// Vorlagen-Erkennung: eine Tabellenzelle gilt als leer, wenn sie nichts traegt oder
// nur den Vorlagen-Vermerk. Der Vermerk wird als Muster gesucht, nicht verglichen --
// er steht mal kursiv, mal in Klammern.
const VORLAGEN_ZELLE = /noch nichts erhoben/i;

// ---------------------------------------------------------------------------
// Lesen und normalisieren
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

// ---------------------------------------------------------------------------
// Einordnen einer Zeile
// ---------------------------------------------------------------------------
// Ein Zitat schliesst NICHT allgemein aus: in docs/rebuild-guide.md steht ein
// echter Offenpunkt in einem Merkkasten (Zeile 8, "> - **Offen:** ...").
//
// Ausgeschlossen wird nur die schwache Marke im Zitat. Gemessen am 23.08.2026
// stand CLAUDE.md:6 in der Aufgabenliste -- eine Zeile, die woertlich erklaert,
// dass ein blosses [?] KEIN Ausloeser ist. Wer eine Marke beschreibt, benutzt
// sie nicht; sonst nimmt die Liste ihre eigene Gebrauchsanweisung als Auftrag.
// "Offen:" dagegen ist ein Wort mit Absicht -- das gilt auch im Zitat.
const IST_ZITAT = /^\s*>/;

function artBestimmen(zeile, platzhalter) {
  for (const m of MUSTER) {
    if (m.muster.test(zeile)) return m.artCode;
  }
  if (platzhalter && PLATZHALTER_MUSTER.test(zeile) && !IST_ZITAT.test(zeile)) return "platzhalter";
  return null;
}

// ---------------------------------------------------------------------------
// Tabellen einer Markdown-Datei: Kopf- und Trennzeilen zaehlen nicht als Inhalt.
// Trennzeile = | --- | --- |, Kopfzeile = die Zeile direkt darueber.
// ---------------------------------------------------------------------------
const istTabellenzeile = (z) => /^\s*\|/.test(z);
const istTrennzeile = (z) => /^\s*\|[\s:|-]+\|\s*$/.test(z) && z.indexOf("-") !== -1;

function datenzeilen(zeilen) {
  const treffer = [];
  for (let i = 0; i < zeilen.length; i++) {
    const z = zeilen[i];
    if (!istTabellenzeile(z) || istTrennzeile(z)) continue;
    if (zeilen[i + 1] !== undefined && istTrennzeile(zeilen[i + 1])) continue; // Kopfzeile
    treffer.push({ zeile: i + 1, text: z });
  }
  return treffer;
}

function zelleLeer(zelle) {
  const t = zelle.trim();
  return t === "" || VORLAGEN_ZELLE.test(t);
}

function zeileLeer(text) {
  const zellen = text.trim().replace(/^\|/, "").replace(/\|$/, "").split("|");
  return zellen.every(zelleLeer);
}

// Gibt die erste leere Datenzeile zurueck, wenn ALLE Datenzeilen leer sind --
// sonst null. Ohne Datenzeile ist es keine Vorlage, sondern eine Datei ohne Tabelle.
function vorlageFinden(zeilen) {
  const daten = datenzeilen(zeilen);
  if (daten.length === 0) return null;
  if (!daten.every((d) => zeileLeer(d.text))) return null;
  return daten[0];
}

// ---------------------------------------------------------------------------
// Hauptzug
// ---------------------------------------------------------------------------
function zuTunDoku(wurzel) {
  const eintraege = [];
  const fehler = [];
  let laufend = 0;
  const anlegen = (text, datei, zeile, artCode) => {
    laufend += 1;
    eintraege.push({ id: "zutundoku:" + laufend, text, datei, zeile, artCode });
  };

  // Die feste Liste plus die zur Laufzeit gefundene output-shape-Regel (falls es
  // sie gibt -- fehlt sie, wird sie NICHT als Fehler gemeldet, denn sie ist nicht
  // in jedem Workspace vorhanden).
  const outputShape = regelDateiFinden(wurzel, "output-shape.md");
  const quellen = outputShape
    ? [...QUELLEN, { pfad: outputShape, bisZeile: 0, platzhalter: false }]
    : QUELLEN;
  for (const q of quellen) {
    const gelesen = zeilenLesen(wurzel, q.pfad);
    if (gelesen.fehler) {
      fehler.push(gelesen.fehler);
      continue;
    }
    const grenze = q.bisZeile > 0 ? Math.min(q.bisZeile, gelesen.zeilen.length) : gelesen.zeilen.length;
    for (let i = 0; i < grenze; i++) {
      const artCode = artBestimmen(gelesen.zeilen[i], q.platzhalter);
      if (artCode) anlegen(gelesen.zeilen[i].trim(), q.pfad, i + 1, artCode);
    }
  }

  const vorlage = zeilenLesen(wurzel, VORLAGE_QUELLE);
  if (vorlage.fehler) {
    fehler.push(vorlage.fehler);
  } else {
    const treffer = vorlageFinden(vorlage.zeilen);
    // text ist immer der Wortlaut von datei:zeile -- auch hier. Der erklaerende Satz
    // dazu gehoert nach render/data.js, nicht in die Messung.
    if (treffer) anlegen(treffer.text.trim(), VORLAGE_QUELLE, treffer.zeile, "leere-vorlage");
  }

  return { eintraege, fehler };
}

module.exports = { zuTunDoku };

if (require.main === module) {
  const wurzel = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
  process.stdout.write(JSON.stringify(zuTunDoku(wurzel), null, 2) + "\n");
}
