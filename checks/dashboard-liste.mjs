#!/usr/bin/env node
// Haelt die Dateiliste des Installateurs und den tatsaechlichen Dashboard-Inhalt
// des Pakets auf EINEM Stand.
//
// WARUM ES DAS GIBT
// install.mjs traegt eine Liste DASHBOARD. Sie ist die einzige Wahrheit darueber,
// welche Dashboard-Dateien eine frische Installation bekommt -- was dort fehlt,
// kommt nicht an. Am 23.08.2026 wuchs das Dashboard von sieben auf zwanzig
// Dateien, waehrend die Liste bei sieben stand: eine Installation haette ein
// index.js erhalten, das vier nicht vorhandene Module laedt. Beim Nachziehen
// derselbe Fehler noch einmal, mit den vier neuen Testdateien.
//
// paket-manifest.mjs faengt das NICHT ab: es vergleicht manifest.json mit dem
// Paketinhalt. Eine Datei kann im Paket liegen, im Manifest stehen -- und
// trotzdem nie installiert werden, weil die Liste sie nicht nennt. Genau diese
// Luecke schliesst diese Pruefung.
//
// AUFRUF   node checks/dashboard-liste.mjs
// RUECKGABE 0 = deckungsgleich · 1 = Abweichung · 2 = nicht pruefbar

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HIER = path.dirname(fileURLToPath(import.meta.url));
const BAUSATZ = path.resolve(HIER, "..");
const INSTALL = path.join(BAUSATZ, "install.mjs");
const PAYLOAD = path.join(BAUSATZ, "payload", "dashboard");

function abbruch(text) {
  process.stderr.write("dashboard-liste: " + text + "\n");
  process.exit(2);
}

// --- 1. Die Liste aus install.mjs lesen ------------------------------------
// Kein Ausfuehren, kein Auswerten: der Block wird als Text herausgeschnitten.
// Ein Prueferwerkzeug, das die gepruefte Datei ausfuehrt, prueft nichts.
function listeLesen() {
  let text;
  try {
    text = fs.readFileSync(INSTALL, "utf8");
  } catch (e) {
    abbruch("install.mjs nicht lesbar: " + e.message);
  }
  const von = text.indexOf("const DASHBOARD = [");
  if (von < 0) abbruch("in install.mjs steht kein 'const DASHBOARD = [' -- wurde die Liste umbenannt?");
  const bis = text.indexOf("\n];", von);
  if (bis < 0) abbruch("die Liste DASHBOARD in install.mjs ist nicht geschlossen");

  const block = text.slice(von, bis);
  const namen = [];
  for (const zeile of block.split(/\r?\n/)) {
    const ohneKommentar = zeile.replace(/\/\/.*$/, "");
    const treffer = ohneKommentar.match(/["']([^"']+)["']/);
    if (treffer) namen.push(treffer[1]);
  }
  return namen;
}

// --- 2. Den tatsaechlichen Inhalt lesen ------------------------------------
function inhaltLesen() {
  if (!fs.existsSync(PAYLOAD)) abbruch("payload/dashboard fehlt");
  const raus = [];
  (function lauf(ordner) {
    for (const e of fs.readdirSync(ordner, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(ordner, e.name);
      if (e.isDirectory()) lauf(p);
      else raus.push(path.relative(PAYLOAD, p).split(path.sep).join("/"));
    }
  })(PAYLOAD);
  return raus;
}

// --- 3. Vergleichen ---------------------------------------------------------
const liste = listeLesen();
const inhalt = inhaltLesen();

const inListe = new Set(liste);
const imPaket = new Set(inhalt);

const nichtInstalliert = inhalt.filter((f) => !inListe.has(f));
const fehltImPaket = liste.filter((f) => !imPaket.has(f));

const doppelt = [];
const gesehen = new Set();
for (const f of liste) {
  if (gesehen.has(f)) doppelt.push(f);
  gesehen.add(f);
}

for (const f of nichtInstalliert) {
  process.stdout.write(`  NICHT INSTALLIERT   ${f}  -- liegt im Paket, steht aber nicht in DASHBOARD\n`);
}
for (const f of fehltImPaket) {
  process.stdout.write(`  FEHLT IM PAKET      ${f}  -- steht in DASHBOARD, liegt aber nicht unter payload/dashboard\n`);
}
for (const f of doppelt) {
  process.stdout.write(`  DOPPELT             ${f}  -- steht zweimal in DASHBOARD\n`);
}

const abweichungen = nichtInstalliert.length + fehltImPaket.length + doppelt.length;

process.stdout.write(
  `\n${inhalt.length} Dateien unter payload/dashboard · ${liste.length} Eintraege in DASHBOARD · ` +
    `${abweichungen} Abweichung(en).\n`
);

if (abweichungen === 0) process.exit(0);

process.stdout.write(
  "\nDie Liste DASHBOARD in install.mjs ist die einzige Wahrheit darueber, was\n" +
    "eine frische Installation bekommt. Was dort fehlt, kommt beim Empfaenger\n" +
    "nicht an -- und faellt erst auf, wenn das Dashboard dort nicht startet.\n" +
    "Nachtragen (oder die Datei entfernen, wenn sie nicht ausgeliefert werden soll).\n"
);
process.exit(1);
