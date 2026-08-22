#!/usr/bin/env node
// Haelt PAKET.json und den tatsaechlichen Paketinhalt auf EINEM Stand.
//
// WARUM ES DAS GIBT
// PAKET.json ist das Verzeichnis dieses Bausatzes: welche Dateien er ausliefert,
// wie gross sie sind, mit welcher Pruefsumme. Erzeugt wurde es urspruenglich von
// einem Generator AUSSERHALB dieses Bausatzes -- der liegt hier nicht bei. Folge:
// Sobald hier eine Datei dazukam, log das Manifest. Stand 22.08.2026 zaehlte es
// 38 Posten, im Paket lagen 48; onboarding.md, sessionpost-guard.js,
// projekt-kontext.js, arbeitsweise.md und werkzeug-landschaft.md fehlten darin.
//
// Ein Verzeichnis, das den Bestand falsch angibt, ist schlechter als keins: es
// sieht aus wie eine Zusage. Deshalb wird es hier aus dem Paket selbst abgeleitet,
// nicht von Hand gepflegt -- und der Abgleich laeuft in der Abnahme mit.
//
// HERKUNFTS-ANGABEN bleiben erhalten: woher eine Datei urspruenglich stammt
// (herkunft/quellordner/gesaeubert) weiss nur der externe Generator. Was schon
// eingetragen ist, wird uebernommen; neue Dateien bekommen quellordner "bausatz"
// (hier entstanden). Erfunden wird nichts.
//
// AUFRUF    node pruefung/paket-manifest.mjs              prueft  (0 = gleich, 1 = Abweichung)
//           node pruefung/paket-manifest.mjs --nachziehen schreibt PAKET.json neu
//
// Pruefsummen laufen ueber den auf LF vereinheitlichten Inhalt. Sonst haette
// dieselbe Datei unter Windows und Linux verschiedene Hashes und das Manifest
// waere auf einem der beiden Systeme immer "abweichend".

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const HIER = path.dirname(fileURLToPath(import.meta.url));
const WURZEL = path.resolve(HIER, "..");
const MANIFEST = path.join(WURZEL, "PAKET.json");

// Was nicht zum ausgelieferten Paket gehoert.
const AUS = new Set([".git", "node_modules", ".DS_Store"]);

function dateienSammeln(ordner = WURZEL, rel = "") {
  const raus = [];
  for (const e of fs.readdirSync(ordner, { withFileTypes: true })) {
    if (AUS.has(e.name)) continue;
    const p = path.join(ordner, e.name);
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) raus.push(...dateienSammeln(p, r));
    else if (r !== "PAKET.json") raus.push(r);
  }
  return raus.sort();
}

function messen(rel) {
  const roh = fs.readFileSync(path.join(WURZEL, rel));
  const binaer = roh.includes(0);
  const inhalt = binaer ? roh : Buffer.from(roh.toString("utf8").split("\r\n").join("\n"), "utf8");
  return {
    bytes: inhalt.length,
    sha256: crypto.createHash("sha256").update(inhalt).digest("hex").slice(0, 16),
  };
}

function bauen(alt) {
  const bekannt = new Map((alt?.dateien || []).map((d) => [d.datei, d]));
  const dateien = dateienSammeln().map((rel) => {
    const v = bekannt.get(rel);
    const m = messen(rel);
    return {
      datei: rel,
      herkunft: v?.herkunft ?? null,
      quellordner: v?.quellordner ?? "bausatz",
      gesaeubert: v?.gesaeubert ?? 0,
      bytes: m.bytes,
      sha256: m.sha256,
    };
  });
  return {
    schema: alt?.schema || "harness.paket.v1",
    gebautAm: new Date().toISOString(),
    posten: dateien.length,
    hinweisZurZaehlung:
      "posten = alle Dateien im Paket ausser PAKET.json selbst (ohne .git und node_modules). " +
      "bytes und sha256 messen den auf LF vereinheitlichten Inhalt, damit sie plattformstabil sind. " +
      "Erzeugt von pruefung/paket-manifest.mjs --nachziehen; in der Abnahme wird gegengeprueft.",
    ersetzungen: alt?.ersetzungen ?? 0,
    bewusstNichtEnthalten: alt?.bewusstNichtEnthalten || [],
    dateien,
  };
}

const alt = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, "utf8")) : null;
const neu = bauen(alt);

if (process.argv.includes("--nachziehen")) {
  fs.writeFileSync(MANIFEST, JSON.stringify(neu, null, 2) + "\n");
  console.log(`PAKET.json neu geschrieben: ${neu.posten} Posten.`);
  process.exit(0);
}

if (!alt) {
  console.error("FEHLER: PAKET.json fehlt -- mit --nachziehen erzeugen.");
  process.exit(1);
}

const altMap = new Map((alt.dateien || []).map((d) => [d.datei, d]));
const neuMap = new Map(neu.dateien.map((d) => [d.datei, d]));
const fehlenImManifest = neu.dateien.filter((d) => !altMap.has(d.datei)).map((d) => d.datei);
const nichtMehrDa = (alt.dateien || []).filter((d) => !neuMap.has(d.datei)).map((d) => d.datei);
const geaendert = neu.dateien.filter((d) => {
  const v = altMap.get(d.datei);
  return v && (v.sha256 !== d.sha256 || v.bytes !== d.bytes);
}).map((d) => d.datei);

for (const f of fehlenImManifest) console.log(`  NICHT GELISTET  ${f}`);
for (const f of nichtMehrDa) console.log(`  NICHT MEHR DA   ${f} (steht im Manifest)`);
for (const f of geaendert) console.log(`  GEAENDERT       ${f}`);
if (alt.posten !== neu.posten) console.log(`  POSTEN          Manifest ${alt.posten} · tatsaechlich ${neu.posten}`);

const summe = fehlenImManifest.length + nichtMehrDa.length + geaendert.length + (alt.posten !== neu.posten ? 1 : 0);
console.log(`\n${neu.posten} Dateien im Paket · ${summe} Abweichung(en) zum Manifest.`);
if (summe) {
  console.log("\nManifest und Paketinhalt muessen EIN Stand sein.");
  console.log("Angleichen mit: node pruefung/paket-manifest.mjs --nachziehen");
  process.exit(1);
}
process.exit(0);
