#!/usr/bin/env node
// MESSDATEN IN DIE GEBAUTE HUELLE SPRITZEN.
//
// Diese Datei ist die einzige, die der Empfaenger des Bausatzes wirklich
// ausfuehrt -- deshalb benutzt sie NUR node:fs und node:path. Kein npm, kein
// Vite, keine Abhaengigkeit. Wer hier ein Paket importiert, verlangt vom
// Empfaenger eine Toolchain, die er nicht hat.
//
// AUFRUF
//   node befuellen.mjs <huelle.html> <daten.json> <ziel.html>
//   node befuellen.mjs --pruefe [huelle.html]      nur pruefen, nichts schreiben
//
// RUECKGABE 0 = in Ordnung · 1 = Fehler (mit Meldung auf stderr)

import fs from "node:fs";
import path from "node:path";

// Der eigene Ordner, damit --pruefe von ueberall aus dieselbe Huelle findet.
// decodeURIComponent ist kein Zierrat: in einer file:-URL ist ein Leerzeichen
// als %20 kodiert. Liegt der Baum in einem Pfad mit Leerzeichen -- auf dem
// Bau-Rechner dieses Bausatzes tut er das --, sucht die Pruefung ohne die
// Rueckwandlung in einem Ordner, den es nicht gibt.
const HIER = path.dirname(decodeURIComponent(new URL(import.meta.url).pathname));
const VORGABE_HUELLE = path.join(HIER, "dist", "index.html");

// Ein Element, eine Kennung. Das <script type="application/json"> ueberlebt die
// Minifizierung unveraendert -- ein Platzhalter im gebuendelten JS waere nach
// dem Bau nicht mehr auffindbar.
const PLATZHALTER = /(<script\b[^>]*\bid="zustand-daten"[^>]*>)([\s\S]*?)(<\/script>)/g;

// Externe Verweise. Die Datei muss sich per Mail verschicken und von der Platte
// oeffnen lassen -- eine Seite, die beim Oeffnen ins Netz greift, tut das beim
// Kunden im Zweifel gar nicht und sieht dann kaputt aus.
const EXTERN = [
  [/\ssrc="https?:/i, 'src="http…'],
  [/\shref="https?:/i, 'href="http…'],
  [/@import\b/i, "@import"],
];

const fehler = (text) => {
  process.stderr.write(`FEHLER: ${text}\n`);
  process.exit(1);
};

/* Ein "<" im Text wuerde das Dokument aufreissen: ein Commit-Betreff aus dem
   git-Verlauf, der zufaellig "</script>" enthaelt, beendet sonst mitten in den
   Messdaten das Element. In JSON steht "<" ausschliesslich innerhalb von
   Zeichenketten, deshalb ist der pauschale Austausch gegen die Escape-Form
   sicher -- und der Parser im Browser liest denselben Wert. */
const entschaerfen = (json) => json.replace(/</g, "\\u003c");

function lesen(datei, was) {
  try {
    return fs.readFileSync(datei, "utf8");
  } catch (e) {
    fehler(`${was} nicht lesbar: ${datei} (${e.code || e.message})`);
  }
}

// Zaehlt die Platzhalter. Null heisst: falsche Datei oder Bau ohne die Huelle.
// Mehr als einer heisst: irgendwo wurde kopiert -- dann ist nicht mehr
// entscheidbar, welcher gilt, und stilles Ueberschreiben waere geraten.
function platzhalterZaehlen(html) {
  PLATZHALTER.lastIndex = 0;
  let n = 0;
  while (PLATZHALTER.exec(html)) n += 1;
  return n;
}

function pruefen(huelle) {
  const html = lesen(huelle, "Hülle");
  const n = platzhalterZaehlen(html);
  const meldungen = [];

  if (n !== 1) meldungen.push(`${n} Platzhalter <script id="zustand-daten"> gefunden, erwartet genau 1`);
  for (const [muster, name] of EXTERN) {
    if (muster.test(html)) meldungen.push(`externer Verweis gefunden: ${name}`);
  }

  if (meldungen.length) {
    process.stderr.write(`FEHLER: Hülle nicht verwendbar — ${huelle}\n`);
    for (const m of meldungen) process.stderr.write(`  · ${m}\n`);
    process.exit(1);
  }

  const kb = (Buffer.byteLength(html, "utf8") / 1024).toFixed(1);
  process.stdout.write(`Hülle in Ordnung: ${huelle}\n  1 Platzhalter · keine externen Verweise · ${kb} kB\n`);
  process.exit(0);
}

function befuellen(huelle, datenDatei, ziel) {
  const html = lesen(huelle, "Hülle");
  const roh = lesen(datenDatei, "Messdaten");

  // Erst parsen, dann einsetzen: kaputtes JSON wuerde im Browser zur leeren
  // Hinweisseite fuehren, und der Grund stuende dann nirgends.
  let daten;
  try {
    daten = JSON.parse(roh);
  } catch (e) {
    fehler(`Messdaten sind kein gültiges JSON: ${datenDatei} (${e.message})`);
  }
  if (!daten || typeof daten !== "object") fehler(`Messdaten sind leer oder kein Objekt: ${datenDatei}`);

  const n = platzhalterZaehlen(html);
  if (n !== 1) fehler(`${n} Platzhalter <script id="zustand-daten"> in ${huelle} — erwartet genau 1`);

  PLATZHALTER.lastIndex = 0;
  const neu = html.replace(PLATZHALTER, (_, auf, __, zu) => auf + entschaerfen(JSON.stringify(daten)) + zu);

  fs.mkdirSync(path.dirname(ziel), { recursive: true });
  fs.writeFileSync(ziel, neu, "utf8");

  const kb = (Buffer.byteLength(neu, "utf8") / 1024).toFixed(1);
  const m = daten.messung || daten;
  process.stdout.write(
    `Seite befüllt: ${ziel}\n` +
      `  Hülle           : ${huelle}\n` +
      `  Messdaten       : ${datenDatei}\n` +
      `  Gemessen am     : ${m.gemessenAm || "—"}\n` +
      `  Gesamtstatus    : ${m.gesamtstatus || "—"}\n` +
      `  Größe           : ${kb} kB\n`
  );
}

function main(argv) {
  const a = argv.slice(2);

  if (a[0] === "--help" || a[0] === "-h" || a.length === 0) {
    process.stdout.write(
      [
        "Messdaten in die gebaute Hülle spritzen — reines node:fs, keine Abhängigkeit.",
        "",
        "  node befuellen.mjs <huelle.html> <daten.json> <ziel.html>",
        "  node befuellen.mjs --pruefe [huelle.html]   (Vorgabe: dist/index.html)",
        "",
      ].join("\n")
    );
    process.exit(a.length === 0 ? 1 : 0);
  }

  if (a[0] === "--pruefe") {
    if (a.length > 2) fehler("--pruefe nimmt höchstens einen Pfad");
    return pruefen(path.resolve(a[1] || VORGABE_HUELLE));
  }

  if (a.length !== 3) fehler(`3 Argumente erwartet, ${a.length} bekommen — <huelle.html> <daten.json> <ziel.html>`);
  return befuellen(path.resolve(a[0]), path.resolve(a[1]), path.resolve(a[2]));
}

main(process.argv);
