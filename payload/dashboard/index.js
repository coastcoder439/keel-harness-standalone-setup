#!/usr/bin/env node
// ZUSTANDSSEITE — der Aufruf, der die vier Stufen verbindet.
//
//     messen  ->  strukturierte Daten (JSON)  ->  rendern  ->  Datei
//     messen.js    --json / --daten             rendern.js   --html
//     regeln.js
//
// Diese Datei enthaelt SELBST keine Messung und keine Darstellung. Sie
// verdrahtet nur -- damit sich die Anzeige austauschen laesst (Keel Light),
// ohne die Messung anzufassen, und die Messung ohne die Anzeige laufen kann.
//
// AUFRUF
//   node dashboard/index.js                        HTML nach dashboard.html
//   node dashboard/index.js --html <datei>         HTML woandershin
//   node dashboard/index.js --json                 nur Daten, nach stdout
//   node dashboard/index.js --daten <datei>        Daten in eine Datei
//   node dashboard/index.js --wurzel <pfad>        andere Werkbank messen
//   node dashboard/index.js --mit-github           GitHub-Abfragen zulassen (Netz)
//   node dashboard/index.js --exit-code            1 bei Befund, 2 bei "nicht pruefbar"
//
// RUECKGABE ohne --exit-code immer 0 (die Seite ist erzeugt), mit --exit-code
// nach Gesamtstatus. "nicht pruefbar" bekommt den HOEHEREN Rueckgabewert als
// "Befund": ein Werkzeugausfall darf nie milder aussehen als ein Fund.

const fs = require("fs");
const path = require("path");

const { messen } = require("./measure");
const { regeln } = require("./rules");
// Anzeige im Keel-Design: Seitenleiste, Ordnerbaum, Dateiansicht, Eigenschaften.
// Sie zerfaellt in Woerter (render/worte.js), Daten (render/data.js), Aussehen
// (render/styles.js), Symbole, Markdown, Schale und vier Browser-Teile.
// Die Messung kennt keine Darstellung -- deshalb laesst sich die Anzeige
// austauschen, ohne measure.js anzufassen.
const { daten } = require("./render/data.js");
const { renderHTML } = require("./render/shell.js");
const { ZUGANGS_MUSTER } = require("./inventar.js");

function argumenteLesen(argv) {
  const a = argv.slice(2);
  const o = { wurzel: null, html: null, daten: null, nurJson: false, mitGithub: false, exitCode: false, hilfe: false };
  const wert = (i, name) => {
    if (i + 1 >= a.length) throw new Error(`${name} braucht einen Wert`);
    return a[i + 1];
  };
  for (let i = 0; i < a.length; i++) {
    switch (a[i]) {
      case "--help":
      case "-h":
        o.hilfe = true;
        break;
      case "--wurzel":
        o.wurzel = path.resolve(wert(i, "--wurzel"));
        i++;
        break;
      case "--html":
        o.html = path.resolve(wert(i, "--html"));
        i++;
        break;
      case "--daten":
        o.daten = path.resolve(wert(i, "--daten"));
        i++;
        break;
      case "--json":
        o.nurJson = true;
        break;
      case "--mit-github":
        o.mitGithub = true;
        break;
      case "--exit-code":
        o.exitCode = true;
        break;
      default:
        throw new Error(`Unbekanntes Argument: ${a[i]}`);
    }
  }
  return o;
}

function hilfe() {
  process.stdout.write(
    [
      "Dashboard des Harness — messen -> Daten -> rendern -> Datei",
      "",
      "  --html <datei>    HTML-Datei (Vorgabe: ./dashboard.html; entfaellt bei --json)",
      "  --daten <datei>   die gemessenen Daten als JSON in eine Datei",
      "  --json            nur die Daten nach stdout, kein HTML",
      "  --wurzel <pfad>   Werkbank-Wurzel (Vorgabe: aufwaerts gesucht, Ordner mit .claude/)",
      "  --mit-github      GitHub-Abfragen des Betriebsberichts zulassen (braucht Netz)",
      "  --exit-code       0 = ok/Hinweis · 1 = Befund · 2 = nicht pruefbar",
      "",
    ].join("\n")
  );
}

function main() {
  let o;
  try {
    o = argumenteLesen(process.argv);
  } catch (e) {
    process.stderr.write(`FEHLER: ${e.message}\n`);
    hilfe();
    process.exit(2);
  }
  if (o.hilfe) return hilfe();

  // 1 — MESSEN
  let messung;
  try {
    messung = messen({ wurzel: o.wurzel, mitGithub: o.mitGithub });
  } catch (e) {
    process.stderr.write(`FEHLER beim Messen: ${e.message}\n`);
    process.exit(2);
  }

  // 2 — REGELN ZIEHEN (eigene Stufe, damit eine fehlende Regel die Messung nicht kippt)
  const regelDaten = regeln(messung.wurzel);

  const gebuendelt = { messung, regeln: regelDaten };

  // 3 + 4 — RENDERN und SCHREIBEN
  if (o.daten) {
    fs.mkdirSync(path.dirname(o.daten), { recursive: true });
    fs.writeFileSync(o.daten, JSON.stringify(gebuendelt, null, 2) + "\n", "utf8");
  }

  if (o.nurJson) {
    process.stdout.write(JSON.stringify(gebuendelt, null, 2) + "\n");
  } else {
    const ziel = o.html || path.resolve(process.cwd(), "dashboard.html");
    fs.mkdirSync(path.dirname(ziel), { recursive: true });

    const seite = renderHTML(daten(messung, regelDaten));

    // AUSGABE-WAECHTER -- der dritte Riegel (Spezifikation 7.3).
    // Die beiden anderen sitzen in inventar.js und koennen umgangen werden, wenn
    // ein neues Modul einen String einbaut, ohne ihn durch textSichern zu geben.
    // Dieser hier prueft, was WIRKLICH auf die Platte geht. Bei Verdacht wird
    // KEINE Datei geschrieben: eine halbe Warnung neben einer geschriebenen
    // Datei mit einem Zugang darin hilft niemandem.
    const verdacht = [];
    const zeilen = seite.split("\n");
    for (let i = 0; i < zeilen.length; i++) {
      for (const muster of ZUGANGS_MUSTER) {
        if (muster.test(zeilen[i])) { verdacht.push(i + 1); break; }
      }
    }
    if (verdacht.length) {
      process.stderr.write(
        "ABBRUCH: die erzeugte Seite enthaelt " + verdacht.length + " Zeile(n), die wie ein Zugang aussehen.\n" +
        "  Zeilen: " + verdacht.slice(0, 10).join(", ") + (verdacht.length > 10 ? " …" : "") + "\n" +
        "  Es wurde KEINE Datei geschrieben. Pruefe die Quelle und den Filter in dashboard/inventar.js.\n"
      );
      process.exit(2);
    }

    fs.writeFileSync(ziel, seite, "utf8");

    const z = messung.zaehlung;
    process.stdout.write(
      `Dashboard geschrieben: ${ziel}\n` +
        `  Werkbank        : ${messung.wurzel}\n` +
        `  Gesamtstatus    : ${messung.gesamtstatus}\n` +
        `  Bereiche        : ${Object.entries(z).map(([k, v]) => `${v}× ${k}`).join(" · ")}\n` +
        `  Regeln gelesen  : ${regelDaten.liste.length - regelDaten.unlesbar - (regelDaten.entfaellt || 0)} von ${regelDaten.liste.length}` +
        (regelDaten.entfaellt ? ` (${regelDaten.entfaellt} gehoeren nicht zu diesem Harness)` : "") +
        (regelDaten.unlesbar ? ` (${regelDaten.unlesbar} nicht ziehbar — siehe Seite)` : "") +
        "\n" +
        (o.daten ? `  Daten           : ${o.daten}\n` : "")
    );
  }

  if (o.exitCode) {
    const s = messung.gesamtstatus;
    if (s === "unlesbar") process.exit(2);
    if (s === "befund" || s === "fehlt") process.exit(1);
  }
}

if (require.main === module) main();

module.exports = { argumenteLesen };
