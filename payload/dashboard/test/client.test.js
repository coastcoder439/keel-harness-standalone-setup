// Test zu dashboard/render/client/*.js -- Bordmittel, node:test.
//
// WAS HIER BESONDERS IST
// Diese vier Dateien laufen NICHT in Node. Ihr Inhalt ist eine Zeichenkette,
// die in die erzeugte Seite geschrieben und dort vom Browser ausgefuehrt wird.
// Deshalb faellt hier kein Fehler auf, den Node sonst beim Laden meldet: ein
// Tippfehler, ein require, eine Funktion, die es nirgends gibt -- alles das
// wuerde erst beim Empfaenger auffallen, als weisse Seite.
//
// Diese Datei ist der Ersatz dafuer: sie liest die vier Zeichenketten, setzt
// sie in derselben Reihenfolge zusammen wie shell.js und prueft, was ein
// Uebersetzer pruefen wuerde -- Syntax, aufgeloeste Namen, verbotene Konstrukte.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const WURZEL = path.resolve(__dirname, "..", "..");
const CLIENT = path.join(WURZEL, "dashboard", "render", "client");

// Die Reihenfolge ist die aus shell.js. Sie wird unten gegen die Quelle
// geprueft, damit diese Liste nicht schweigend veraltet.
const TEILE = ["core", "pages", "detail", "bridge", "start"];

const quelltextVon = (name) => require(path.join(CLIENT, name + ".js")).quelltext;
const alles = () => TEILE.map(quelltextVon).join("\n");

// Kommentare heraus, Zeilenzahl erhalten. Ohne das meldet jede Namensprueflung
// die Woerter aus den Ueberschriften mit ("--- Board (nur Zu tun)") -- gemessen
// am 23.08.2026: sieben Fehlalarme, null echte Funde.
function ohneKommentare(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .split("\n")
    .map((z) => {
      // Ein // innerhalb einer Zeichenkette ist kein Kommentar (etwa "https://").
      let inStr = null;
      for (let i = 0; i < z.length; i++) {
        const c = z[i];
        if (inStr) {
          if (c === "\\") i++;
          else if (c === inStr) inStr = null;
        } else if (c === '"' || c === "'") inStr = c;
        else if (c === "/" && z[i + 1] === "/") return z.slice(0, i);
      }
      return z;
    })
    .join("\n");
}

// ---------------------------------------------------------------------------
// Die Liste oben stimmt mit der Wirklichkeit ueberein
// ---------------------------------------------------------------------------

test("die Reihenfolge in diesem Test ist die aus shell.js -- und alle Teile sind erfasst", () => {
  const shell = fs.readFileSync(path.join(WURZEL, "dashboard", "render", "shell.js"), "utf8");
  const inShell = (shell.match(/client\/([a-z]+)\.js/g) || []).map((s) => s.slice(7, -3));
  assert.deepStrictEqual(inShell, TEILE, "shell.js setzt die Teile anders zusammen als hier geprueft");

  const aufDerPlatte = fs.readdirSync(CLIENT).filter((f) => f.endsWith(".js")).map((f) => f.slice(0, -3)).sort();
  assert.deepStrictEqual(aufDerPlatte, TEILE.slice().sort(), "eine Datei unter client/ wird nicht eingesetzt oder nicht geprueft");
});

// ---------------------------------------------------------------------------
// Syntax -- der Test, den Node beim Laden nicht macht
// ---------------------------------------------------------------------------

test("jeder Teil ist fuer sich syntaktisch gueltig", () => {
  for (const name of TEILE) {
    assert.doesNotThrow(
      () => new vm.Script(quelltextVon(name), { filename: "client/" + name + ".js" }),
      "Syntaxfehler in client/" + name + ".js"
    );
  }
});

test("die vier Teile zusammen ergeben ein gueltiges Skript", () => {
  // Einzeln gueltig heisst nicht zusammen gueltig: eine offene Klammer im
  // ersten Teil kann den zweiten schlucken.
  assert.doesNotThrow(() => new vm.Script(alles(), { filename: "client/alle" }), "Syntaxfehler in der Zusammensetzung");
});

test("das zusammengesetzte Skript laeuft im strengen Modus", () => {
  // Der Browser fuehrt es im normalen Modus aus, aber der strenge deckt Fehler
  // auf, die sonst still bleiben: doppelte Parameter, Zuweisung an eine nicht
  // erklaerte Variable, geloeschte Namen.
  assert.doesNotThrow(
    () => new vm.Script('"use strict";\n' + alles(), { filename: "client/streng" }),
    "das Skript verletzt den strengen Modus"
  );
});

// ---------------------------------------------------------------------------
// Verbotene Konstrukte -- was in Node geht, aber im Browser abstuerzt
// ---------------------------------------------------------------------------

test("kein require, kein module.exports im ausgelieferten Text", () => {
  for (const name of TEILE) {
    const t = quelltextVon(name);
    assert.ok(!/\brequire\s*\(/.test(t), "require in client/" + name + ".js -- im Browser ein Absturz");
    assert.ok(!/\bmodule\.exports\b/.test(t), "module.exports in client/" + name + ".js");
    assert.ok(!/\b__dirname\b|\b__filename\b/.test(t), "Node-Pfadvariable in client/" + name + ".js");
    assert.ok(!/\bprocess\.\w/.test(t), "process in client/" + name + ".js");
  }
});

test("kein Backtick im ausgelieferten Text -- er wuerde die Zusammensetzung in shell.js zerlegen", () => {
  // shell.js setzt die Teile in eine Zeichenkette mit Backticks ein. Ein
  // Backtick im Inhalt beendet sie mitten im Skript.
  const BT = String.fromCharCode(96);
  for (const name of TEILE) {
    assert.ok(!quelltextVon(name).includes(BT), "Backtick in client/" + name + ".js");
  }
});

test("kein Skript-Schluss im ausgelieferten Text", () => {
  for (const name of TEILE) {
    assert.ok(!/<\/script/i.test(quelltextVon(name)), "Skript-Schluss in client/" + name + ".js");
  }
});

// ---------------------------------------------------------------------------
// Namen -- die haeufigste Falle bei vier Dateien, die erst im Browser
// zusammenfinden: ein Teil ruft, was kein anderer definiert.
// ---------------------------------------------------------------------------

test("jeder benutzte HD-Name wird auch irgendwo gesetzt", () => {
  // Alle vier Teile haengen an einem globalen Objekt HD. Ein Zugriff auf
  // HD.etwas, das nirgends gesetzt wird, ist im Browser "undefined is not a
  // function" -- und die Seite bleibt weiss.
  const t = alles();
  const gesetzt = new Set();
  for (const m of t.matchAll(/\bHD\.([A-Za-z_$][\w$]*)\s*=/g)) gesetzt.add(m[1]);
  for (const m of t.matchAll(/\bHD\s*=\s*\{([\s\S]*?)\}/g)) {
    for (const s of m[1].matchAll(/([A-Za-z_$][\w$]*)\s*:/g)) gesetzt.add(s[1]);
  }
  const benutzt = new Set();
  for (const m of t.matchAll(/\bHD\.([A-Za-z_$][\w$]*)/g)) benutzt.add(m[1]);

  const fehlend = [...benutzt].filter((n) => !gesetzt.has(n)).sort();
  assert.deepStrictEqual(fehlend, [], "HD-Namen werden benutzt, aber nirgends gesetzt");
});

test("jede aufgerufene eigene Funktion ist im zusammengesetzten Skript erklaert", () => {
  // Ausgefuehrt statt gelesen: das Skript wird in einer leeren Umgebung
  // uebersetzt und die Namensaufloesung geprueft. Was hier fehlt, fehlt auch
  // im Browser.
  const t = ohneKommentare(alles());
  const erklaert = new Set(["HD"]);
  for (const m of t.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)/g)) erklaert.add(m[1]);
  for (const m of t.matchAll(/\b(?:var|let|const)\s+([A-Za-z_$][\w$]*)/g)) erklaert.add(m[1]);

  // Bekannte Browser-Namen, die es zur Laufzeit gibt.
  const BROWSER = new Set([
    "window", "document", "location", "history", "localStorage", "sessionStorage",
    "navigator", "console", "setTimeout", "clearTimeout", "setInterval", "clearInterval",
    "requestAnimationFrame", "JSON", "Math", "Object", "Array", "String", "Number",
    "Boolean", "Date", "RegExp", "Error", "Map", "Set", "Promise", "encodeURIComponent",
    "decodeURIComponent", "parseInt", "parseFloat", "isNaN", "undefined", "NaN",
    "Infinity", "alert", "getComputedStyle", "matchMedia", "CustomEvent", "Event",
    "IntersectionObserver", "MutationObserver", "URL", "URLSearchParams", "TextDecoder",
    // Der Editor braucht sie: fetch spricht mit dem Vorschau-Server, confirm
    // fragt vor dem Verwerfen ungespeicherter Aenderungen nach.
    "fetch", "confirm", "encodeURI", "escape", "unescape", "structuredClone",
  ]);

  const aufgerufen = new Set();
  for (const m of t.matchAll(/(?:^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) aufgerufen.add(m[1]);
  const SCHLUESSELWORT = new Set([
    "if", "for", "while", "switch", "catch", "function", "return", "typeof", "new",
    "delete", "void", "in", "of", "do", "else", "case", "throw",
  ]);

  const fehlend = [...aufgerufen]
    .filter((n) => !erklaert.has(n) && !BROWSER.has(n) && !SCHLUESSELWORT.has(n))
    .sort();
  assert.deepStrictEqual(fehlend, [], "aufgerufene Namen sind nirgends erklaert");
});

// ---------------------------------------------------------------------------
// Bedienung -- zwei Fallen, die im Browser haeufig auftreten
// ---------------------------------------------------------------------------

test("Klick-Behandlung fasst das Kind-Element mit: closest statt target", () => {
  // Ein Knopf mit einem Symbol darin: der Klick trifft das SVG, nicht den
  // Knopf. Wer nur e.target prueft, verliert jeden Klick auf das Symbol --
  // genau dieser Fehler ist in einer frueheren Fassung aufgetreten.
  const t = alles();
  const handler = t.match(/addEventListener\(\s*"click"[\s\S]{0,2000}/g) || [];
  assert.ok(handler.length > 0, "es gibt ueberhaupt eine Klick-Behandlung");
  const mitClosest = handler.filter((h) => h.includes("closest"));
  assert.ok(mitClosest.length > 0, "keine Klick-Behandlung benutzt closest");
});

test("jeder Datenwert, der in HTML eingesetzt wird, geht durch HD.esc", () => {
  // DIE eigentliche Sicherheitsfrage im Browser-Teil. Der Datensatz traegt
  // Dateinamen, Pfade und Dateiinhalte -- alles aus dem Dateisystem, also aus
  // einer Quelle, die niemand kontrolliert. shell.js hat sie beim ERZEUGEN
  // entschaerft; wer sie hier wieder zu HTML zusammensetzt, muss es erneut tun.
  //
  // Geprueft wird deshalb nicht, ob innerHTML benutzt wird (das tut es
  // ueberall und ist der Zweck), sondern ob eine Einsetzung in eine
  // Zeichenkette, die HTML aufbaut, ungeschuetzt bleibt.
  // GRENZE DIESER PRUEFUNG, ausdruecklich: ein regulaerer Ausdruck kann nicht
  // entscheiden, ob ein beliebiger Ausdruck escaped ist -- dafuer braeuchte es
  // eine Datenflussverfolgung. Geprueft wird deshalb genau die Klasse, die
  // wirklich gefaehrlich und zugleich sicher erkennbar ist: ein FELDZUGRIFF auf
  // ein Datenobjekt (e.name, st.wort, p.pfad), der ungeschuetzt in HTML geht --
  // direkt oder ueber genau eine Zwischenvariable. Was dieser Test NICHT sieht,
  // muss die Gegenprobe unten und das Auge finden.
  const t = ohneKommentare(alles());
  const zeilen = t.split("\n");

  // Ein Feldzugriff auf ein kurzes Datenobjekt -- nicht HD.* (der eigene
  // Bestand) und nicht document/window (der Browser).
  const FELDZUGRIFF = /^[a-z][\w$]{0,3}\.[A-Za-z_$][\w$]*$/;

  // Der Code escapt bei der ZUWEISUNG, nicht beim Einsetzen:
  //     var inhalt = HD.esc(st.wort);   ... spaeter ...   "<span>" + inhalt
  // Ein Name, der aus einem ROHEN Feldzugriff stammt, ist dagegen verdaechtig --
  // das ist genau der Fehler, den man beim Umbauen macht.
  const ausEsc = new Set();
  const ausRohemFeld = new Map();
  for (const m of t.matchAll(/(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\n]*)/g)) {
    const [, name, wert] = m;
    if (/\besc\s*\(/.test(wert)) ausEsc.add(name);
    else if (FELDZUGRIFF.test(wert.trim())) ausRohemFeld.set(name, wert.trim());
  }

  const ausgeglichen = (s) =>
    (s.match(/\(/g) || []).length === (s.match(/\)/g) || []).length &&
    (s.match(/"/g) || []).length % 2 === 0 &&
    (s.match(/'/g) || []).length % 2 === 0;

  // Steht diese Stelle INNERHALB eines esc-Aufrufs? Dann ist sie geschuetzt,
  // auch wenn das herausgeschnittene Bruchstueck fuer sich roh aussieht --
  //     HD.esc(f.was || (f.code + ": " + f.von + " → " + f.nach))
  // liefert genau einen solchen Fehlalarm.
  function inEsc(zeile, pos) {
    const davor = zeile.slice(0, pos);
    const start = davor.lastIndexOf("esc(");
    if (start < 0) return false;
    const rest = davor.slice(start + 4);
    const auf = (rest.match(/\(/g) || []).length;
    const zu = (rest.match(/\)/g) || []).length;
    return auf >= zu;
  }

  const verdacht = [];
  zeilen.forEach((z, i) => {
    // Eine Zeile, die HTML zusammensetzt: spitze Klammer in einer Zeichenkette
    // UND eine Verkettung.
    if (!/["'][^"']*<[^"']*["']\s*\+|\+\s*["'][^"']*>/.test(z)) return;

    // Vorausschau statt Verbrauch: bei  a + b + c  wuerde ein abschliessendes
    // Pluszeichen im Muster das zweite mitnehmen, und  c  bliebe ungeprueft --
    // gemessen am 23.08.2026, ein eingebautes Loch blieb dadurch unentdeckt.
    for (const m of z.matchAll(/\+\s*([^+;]+?)\s*(?=\+)/g)) {
      if (inEsc(z, m.index)) continue;
      const ausdruck = m[1].trim();
      // Ein Bruchstueck mit offener Klammer oder offenem Anfuehrungszeichen ist
      // eine mitten durchgeschnittene Bedingung, kein eigener Ausdruck.
      if (!ausdruck || !ausgeglichen(ausdruck)) continue;
      if (/\besc\s*\(/.test(ausdruck)) continue;
      // EINE sanktionierte Ausnahme, benannt und begruendet: d.html ist die
      // Ausgabe von markdownZuHtml (serve.js liefert sie zu einer .md mit).
      // Dieser Renderer escaped den GESAMTEN Quelltext, BEVOR ein Parser ihn
      // sieht -- ein <script> aus einer Datei kommt als Text an, nie als Element
      // (belegt in markdown.test.js, "ein script-Tag erscheint als Text").
      // Genau diese HTML MUSS roh in innerHTML, sonst erschienen die
      // Markdown-Tags als Text. Fruehere Fassung: HD.D.markdown[...] (durch die
      // HD.*-Ausnahme gedeckt); seit Server-zuerst kommt sie als d.html.
      if (ausdruck === "d.html" && /class="md"/.test(z)) continue;
      // Die UNSICHERE Zuweisung schlaegt die sichere. Derselbe Name kommt in
      // vier Dateien mehrfach vor, und dieses Register kennt keine
      // Gueltigkeitsbereiche: waere die sichere Zuweisung staerker, wuerde ein
      // eingebautes Loch unentdeckt bleiben, sobald der Name irgendwo anders
      // sauber belegt ist -- genau so geschehen am 23.08.2026 mit "inhalt".
      // Ein Name, der einmal roh und einmal escaped belegt wird, ist ohnehin
      // ein Grund, ihn umzubenennen.
      if (ausEsc.has(ausdruck) && !ausRohemFeld.has(ausdruck)) continue;

      if (FELDZUGRIFF.test(ausdruck)) {
        verdacht.push((i + 1) + ": " + ausdruck + "   (Feldzugriff ohne esc)   " + z.trim().slice(0, 55));
      } else if (ausRohemFeld.has(ausdruck)) {
        verdacht.push(
          (i + 1) + ": " + ausdruck + "   (kommt aus " + ausRohemFeld.get(ausdruck) + ", ungeschuetzt)   " + z.trim().slice(0, 45)
        );
      }
    }
  });

  assert.deepStrictEqual(verdacht, [], "Datenwert ohne HD.esc in einer HTML-Zeichenkette");
});

test("jeder Teil traegt einen Kopfkommentar, der seine Nummer und seine Aufgabe nennt", () => {
  // Vier Dateien, die nur zusammen laufen: wer eine davon oeffnet, muss sofort
  // sehen, wo er ist und was vorher kommt.
  TEILE.forEach((name, i) => {
    const kopf = fs.readFileSync(path.join(CLIENT, name + ".js"), "utf8").split(/\r?\n/)[0];
    assert.ok(
      kopf.includes("BROWSER-TEIL " + (i + 1)),
      "client/" + name + ".js nennt sich nicht als Teil " + (i + 1) + ": " + kopf
    );
  });
});
