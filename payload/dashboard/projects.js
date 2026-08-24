#!/usr/bin/env node
// PROJEKTE -- was unter user-projects/ liegt, und was es sagt.
//
// WARUM ES DAS GIBT
// Bis zum 23.08.2026 war user-projects/ im Dashboard ein geschlossener Knoten
// mit einer Zahl. Man sah, DASS es neunzehn Projekte gibt, und sonst nichts:
// nicht, was eines ist, nicht, was es vorhat, nicht, woran zuletzt gearbeitet
// wurde. Die Plaene lagen da und waren nicht zu oeffnen.
//
// WAS HIER GEMESSEN WIRD -- und was ausdruecklich nicht
// Nur die WEGWEISER: die Dokumente, die sagen, was ein Projekt ist und will.
// Nicht der Quellbaum. Ein Projekt hat tausende Dateien; sie alle aufzunehmen
// wuerde die Seite unbrauchbar machen und keine einzige Frage beantworten, die
// dieses Dashboard stellt.
//
// ZWEI KLASSEN, bewusst getrennt (gemessen 23.08.2026 an 19 Projekten):
//   A) Wurzel-Dokumente -- README, ZIEL, ROADMAP, DESIGN ... 27 Dateien,
//      257 KB. Wenige, klein, beantworten "was ist das". MIT Inhalt.
//   B) docs/-Baeume -- 572 Dateien, 7,1 MB. Drei Keel-Forks allein tragen
//      546 davon. Nur GELISTET (Name, Groesse, geaendert); der Inhalt kommt
//      auf Abruf vom Vorschau-Server. Alles einzubetten haette die Seite von
//      5,9 auf 14 MB getrieben.
//
// Dieses Modul erzeugt AUSSCHLIESSLICH Daten -- Codes, keine deutschen Saetze.
// Die Formulierung setzt render/data.js.
//
// AUFRUF   const { projekte } = require("./projects"); projekte(wurzel)

const fs = require("fs");
const path = require("path");

const { textSichern } = require("./access-filter.js");

// ---------------------------------------------------------------------------
// KONSTANTEN
// ---------------------------------------------------------------------------

const ORDNER = "user-projects";

// Ein Wurzel-Dokument ist ein Wegweiser, kein beliebiges Markdown. Die Liste
// ist bewusst geschlossen: sonst zieht das erste Projekt mit fuenfzig
// Markdown-Dateien an der Wurzel die Seite auf.
const WURZEL_DOKUMENT = /^(README|LIESMICH|ZIEL|ROADMAP|PLAN|DESIGN|AGENTS|CONTRIBUTING|ARCHITEKTUR|ARCHITECTURE|CHANGELOG|TODO|NOTES|SECURITY)\.md$/i;

const DOKU_ORDNER = ["docs", "doc", "dokumentation"];

// Woran man einen Stack erkennt. Reihenfolge zaehlt: ein Projekt mit
// package.json UND requirements.txt ist beides, gemeldet wird das erste.
const STACK = [
  { datei: "package.json", code: "node" },
  { datei: "pnpm-workspace.yaml", code: "node" },
  { datei: "requirements.txt", code: "python" },
  { datei: "pyproject.toml", code: "python" },
  { datei: "Cargo.toml", code: "rust" },
  { datei: "go.mod", code: "go" },
  { datei: "composer.json", code: "php" },
  { datei: "Gemfile", code: "ruby" },
  { datei: "pubspec.yaml", code: "dart" },
  { datei: "index.html", code: "web" },
];

const MAX_DOKU_TIEFE = 4;
const MAX_DOKU_DATEIEN = 300; // je Projekt; darueber wird gekappt und gesagt
const MAX_INHALT_BYTES = 256 * 1024;

// ---------------------------------------------------------------------------
// HELFER
// ---------------------------------------------------------------------------

const posix = (p) => String(p).split("\\").join("/").split(path.sep).join("/");

function lesen(abs) {
  try {
    return fs.readFileSync(abs, "utf8");
  } catch (e) {
    return null;
  }
}

// Erster Absatz eines Markdown-Textes -- der Satz, der sagt, was das Projekt
// ist.
//
// Was uebersprungen wird, ist die eigentliche Arbeit. Ein README beginnt selten
// mit einem Satz: erst eine Ueberschrift, dann ein Banner in rohem HTML, dann
// eine Reihe Abzeichen, dann ein Zitatblock. Wer nur "die erste nichtleere
// Zeile" nimmt, bekommt genau das -- gemessen am 23.08.2026 an keel-light:
// "<p align=center> <img src=doc/assets/banner.jpg alt=..." als Beschreibung.
function ersterAbsatz(text) {
  if (!text) return null;
  const zeilen = String(text).split(/\r?\n/);
  const sammeln = [];
  let inHtml = false;

  for (const roh of zeilen) {
    const z = roh.trim();

    // Ein mehrzeiliger HTML-Block (Banner, Tabelle, Ausrichtung) wird ganz
    // uebersprungen, nicht nur seine erste Zeile.
    if (inHtml) {
      if (/^<\/(p|div|table|center|picture|h[1-6])>/i.test(z) || z === "") inHtml = false;
      continue;
    }
    if (/^<(p|div|table|center|picture|img|a|br|h[1-6])\b/i.test(z)) {
      inHtml = !/\/>$|<\/(p|div|table|center|picture|h[1-6])>$/i.test(z);
      continue;
    }

    if (!z) {
      if (sammeln.length) break;
      continue;
    }
    if (/^#/.test(z)) continue;                 // Ueberschrift
    if (/^>/.test(z)) continue;                 // Zitatblock
    if (/^!\[/.test(z)) continue;               // Abzeichen oder Bild
    if (/^\[!\[/.test(z)) continue;             // verlinktes Abzeichen
    if (/^[-*_]{3,}$/.test(z)) continue;        // Trennlinie
    if (/^\|/.test(z)) continue;                // Tabellenzeile
    if (/^(```|~~~)/.test(z)) break;            // Codeblock

    sammeln.push(z);
    if (sammeln.join(" ").length > 260) break;
  }
  if (!sammeln.length) return null;

  // Auszeichnung abraeumen: der Satz landet in einer Listenzeile, nicht in
  // gerendertem Markdown. Ein "**" dort ist kein Fettdruck, sondern Zeichensalat.
  const satz = sammeln
    .join(" ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")   // Link -> nur der Text
    .replace(/(\*\*|__)(.*?)\1/g, "$2")        // fett
    .replace(/(\*|_)(.*?)\1/g, "$2")           // kursiv
    .replace(/`([^`]+)`/g, "$1")               // Code
    .replace(/<[^>]+>/g, "")                   // uebrige Marken
    .replace(/\s+/g, " ")
    .trim();

  if (!satz) return null;
  return satz.length > 300 ? satz.slice(0, 297) + "…" : satz;
}

function stackVon(abs) {
  for (const s of STACK) {
    if (fs.existsSync(path.join(abs, s.datei))) return s.code;
  }
  return null;
}

function metaVon(abs) {
  try {
    const s = fs.statSync(abs);
    return { bytes: s.size, geaendert: s.mtime.toISOString() };
  } catch (e) {
    return { bytes: null, geaendert: null };
  }
}

// ---------------------------------------------------------------------------
// DIE DOKUMENTE EINES PROJEKTS
// ---------------------------------------------------------------------------

function wurzelDokumente(projektAbs, projektRel) {
  const raus = [];
  let eintraege;
  try {
    eintraege = fs.readdirSync(projektAbs, { withFileTypes: true });
  } catch (e) {
    return { dokumente: [], fehler: { code: "projekt-unlesbar", grund: e.message } };
  }
  // Die Beschreibung des Projekts wird HIER aus dem Text gezogen (erster
  // Absatz), der Text selbst aber NICHT gespeichert -- Server-zuerst (D1).
  // README zuerst, weil das die uebliche Stelle ist; dann ZIEL/LIESMICH.
  const rang = (n) => (/^readme/i.test(n) ? 0 : /^(ziel|liesmich)/i.test(n) ? 1 : 2);
  let beschreibung = null;
  for (const e of eintraege) {
    if (!e.isFile() || !WURZEL_DOKUMENT.test(e.name)) continue;
    const abs = path.join(projektAbs, e.name);
    const meta = metaVon(abs);
    const relDok = posix(path.join(projektRel, e.name));
    raus.push({
      name: e.name,
      pfad: relDok,
      art: "wurzel-dokument",
      bytes: meta.bytes,
      geaendert: meta.geaendert,
      // Kein Inhalt im Datensatz -- serve.js liefert ihn auf Klick.
      inhalt: null,
      aufAbruf: true,
    });
    // Fuer die Beschreibung reicht der Anfang; der Filter maskiert Zugaenge.
    const roh = meta.bytes != null && meta.bytes <= MAX_INHALT_BYTES ? lesen(abs) : null;
    if (roh !== null) {
      const satz = ersterAbsatz(textSichern(roh).text);
      if (satz) {
        const alt = beschreibung;
        if (!alt || rang(e.name) < alt._rang) beschreibung = { text: satz, quelle: "absatz", beleg: relDok + ":1", _rang: rang(e.name) };
      }
    }
  }
  raus.sort((a, b) => a.name.localeCompare(b.name));
  if (beschreibung) delete beschreibung._rang;
  return { dokumente: raus, beschreibung, fehler: null };
}

// docs/ wird nur GELISTET. Der Inhalt kommt auf Abruf -- 572 Dateien mit
// 7,1 MB in der Seite waeren die Seite selbst.
function dokuBaum(projektAbs, projektRel) {
  const raus = [];
  let gekappt = false;

  for (const ordner of DOKU_ORDNER) {
    const start = path.join(projektAbs, ordner);
    if (!fs.existsSync(start)) continue;
    (function lauf(abs, rel, tiefe) {
      if (tiefe > MAX_DOKU_TIEFE || gekappt) return;
      let eintraege;
      try {
        eintraege = fs.readdirSync(abs, { withFileTypes: true });
      } catch (e) {
        return;
      }
      for (const e of eintraege) {
        if (gekappt) return;
        if (e.name.startsWith(".") || e.name === "node_modules") continue;
        const kindAbs = path.join(abs, e.name);
        const kindRel = posix(path.join(rel, e.name));
        if (e.isDirectory()) {
          lauf(kindAbs, kindRel, tiefe + 1);
        } else if (/\.md$/i.test(e.name)) {
          if (raus.length >= MAX_DOKU_DATEIEN) {
            gekappt = true;
            return;
          }
          const meta = metaVon(kindAbs);
          raus.push({
            name: e.name,
            pfad: posix(path.join(projektRel, kindRel)),
            art: "doku",
            bytes: meta.bytes,
            geaendert: meta.geaendert,
            // KEIN Inhalt. Wer ihn sehen will, laedt ihn vom Server nach --
            // deshalb steht hier der Pfad und nicht eine Kuerzung, die
            // aussieht wie der ganze Text.
            inhalt: null,
          });
        }
      }
    })(start, ordner, 0);
  }

  raus.sort((a, b) => a.pfad.localeCompare(b.pfad));
  return { dokumente: raus, gekappt, grenze: MAX_DOKU_DATEIEN };
}

// ---------------------------------------------------------------------------
// EIN PROJEKT
// ---------------------------------------------------------------------------

function einProjekt(wurzel, name) {
  const rel = ORDNER + "/" + name;
  const abs = path.join(wurzel, ORDNER, name);

  const w = wurzelDokumente(abs, rel);
  const d = dokuBaum(abs, rel);

  return {
    id: "projekt:" + name,
    name,
    pfad: rel,
    stack: stackVon(abs),
    // Die Beschreibung kommt aus wurzelDokumente -- dort wird der Text gelesen
    // und der erste Absatz gezogen, ohne den Text zu speichern.
    beschreibung: w.beschreibung,
    wurzelDokumente: w.dokumente,
    dokuDateien: d.dokumente,
    dokuGekappt: d.gekappt,
    dokuGrenze: d.grenze,
    // Zusammen: hat dieses Projekt ueberhaupt einen Wegweiser? Sieben von
    // neunzehn hatten am 23.08.2026 keinen -- das ist eine Auskunft, kein
    // Fehler, und muss als solche in der Oberflaeche stehen.
    anzahlDokumente: w.dokumente.length + d.dokumente.length,
    fehler: w.fehler,
  };
}

// ---------------------------------------------------------------------------
// ALLE PROJEKTE
// ---------------------------------------------------------------------------

function projekte(wurzel) {
  const basis = path.join(String(wurzel || ""), ORDNER);
  if (!wurzel || !fs.existsSync(basis)) {
    // Kein Fehler: eine frische Installation hat noch keine Projekte. Ein
    // leerer Bestand ist hier der Normalfall und keine Stoerung.
    return { liste: [], anzahl: 0, ordner: ORDNER, vorhanden: false, fehler: [] };
  }

  const fehler = [];
  let namen;
  try {
    namen = fs
      .readdirSync(basis, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b));
  } catch (e) {
    return {
      liste: [], anzahl: 0, ordner: ORDNER, vorhanden: true,
      fehler: [{ code: "ordner-unlesbar", pfad: ORDNER, grund: e.message }],
    };
  }

  const liste = namen.map((n) => {
    const p = einProjekt(wurzel, n);
    if (p.fehler) fehler.push(Object.assign({ pfad: p.pfad }, p.fehler));
    return p;
  });

  return {
    liste,
    anzahl: liste.length,
    ordner: ORDNER,
    vorhanden: true,
    ohneDokumente: liste.filter((p) => p.anzahlDokumente === 0).length,
    fehler,
  };
}

module.exports = { projekte, ersterAbsatz, WURZEL_DOKUMENT, DOKU_ORDNER };
