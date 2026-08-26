// Vollstaendigkeits-Test des Dashboards -- Bordmittel, node:test.
//
// WARUM ES DIESE DATEI GIBT
// Am 23.08.2026 wurde das Dashboard neu gebaut -- neun Module, und die Tests
// entstanden NACH dem Code. Genau die Reihenfolge, die die Testregel verbietet
// (erst der rote Test, dann die Umsetzung). Was dabei durchrutscht, faellt
// niemandem auf: ein Modul ohne Test sieht aus wie jedes andere.
//
// Diese Datei faengt das nachtraeglich ab. Sie prueft nicht Verhalten, sondern
// EIGENSCHAFTEN des Bestandes: hat jedes Modul einen Test, ist keins zu gross,
// erklaert sich jedes selbst, und liegt jede Datei, die ausgeliefert werden
// muss, auch in der Liste des Installateurs.
//
// Sie ist bewusst streng: eine Ausnahme braucht einen Namen und einen Grund im
// Klartext. Eine Ausnahmeliste ohne Begruendung veraltet und wird zur Ausrede.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const WURZEL = path.resolve(__dirname, "..", "..");
const DASH = path.join(WURZEL, "dashboard");

// Die Obergrenze aus der Hausregel (Dateien fokussiert, 800 Zeilen hoechstens).
const MAX_ZEILEN = 800;

// Module ohne eigenen Test -- jede Zeile mit Grund. Wer hier etwas eintraegt,
// muss den Grund verteidigen koennen; wer einen Test nachreicht, streicht die
// Zeile. Ein leerer Eintrag ist keine Ausnahme, sondern eine Luecke.
const OHNE_TEST = {
  "index.js": "Einstieg: verdrahtet nur messen -> daten -> rendern und schreibt die Datei. Sein Verhalten wird von der Abnahme (checks/frisch-geklont.mjs) als Ganzes geprueft, nicht in Teilen.",
  "classify.js": "Altbestand aus der Vorfassung, vor dem Neubau vom 23.08.2026 entstanden und unveraendert uebernommen. Kein Test -- offen, festgehalten in docs/regelverstoesse-plan.md.",
  "inventory.js": "Altbestand aus der Vorfassung, wie classify.js. Kein Test -- offen, festgehalten in docs/regelverstoesse-plan.md.",
};

// Abnahme-WERKZEUGE sind keine Dashboard-Module: sie laufen von Hand gegen
// die fertige Seite, werden nie ausgeliefert und duerfen deshalb ein
// Entwicklungs-Paket laden (playwright) und Ergebnisse ausgeben. Die Liste ist
// klein und benannt -- wer hier etwas eintraegt, muss den Grund verteidigen.
const WERKZEUGE = {
  "klickpfad.js": "Abnahme-Werkzeug: klickt jede Zusage der Oberflaeche gegen den laufenden Server. Laeuft von Hand, wird nicht ausgeliefert, braucht playwright und gibt sein Ergebnis aus.",
};

function moduleFinden() {
  const raus = [];
  (function lauf(ordner) {
    for (const e of fs.readdirSync(ordner, { withFileTypes: true })) {
      const p = path.join(ordner, e.name);
      if (e.isDirectory()) {
        if (e.name !== "test") lauf(p);
      } else if (e.name.endsWith(".js")) {
        const rel = path.relative(DASH, p).split(path.sep).join("/");
        if (!WERKZEUGE[rel]) raus.push(rel);
      }
    }
  })(DASH);
  return raus.sort();
}

test("jedes Abnahme-Werkzeug traegt einen Grund und liegt wirklich dort", () => {
  for (const [datei, grund] of Object.entries(WERKZEUGE)) {
    assert.ok(fs.existsSync(path.join(DASH, datei)), "Werkzeug fehlt: " + datei);
    assert.ok(grund.length > 40, datei + ": Grund zu duenn");
  }
});

function testdateien() {
  return fs.readdirSync(path.join(DASH, "test")).filter((f) => f.endsWith(".test.js")).sort();
}

// Prueft, ob der Kopf einer Datei ein ECHTER erklaerender Satz ist -- nicht an
// der Buchstabenzahl (die besteht auch ein Buchstabensalat), sondern an der
// Eigenschaft: es gibt einen //-Kommentarblock, er hat mehrere Woerter, und er
// ist nicht bloss der Dateiname. GRENZE, ausdruecklich: ob der Satz WIRKLICH
// erklaert, kann ein statischer Test nicht entscheiden -- er faengt das Fehlen
// und die offensichtliche Attrappe, den Rest muss das Auge finden. Gibt null
// zurueck, wenn der Kopf in Ordnung ist, sonst den Grund.
function kopfMangel(dateiInhalt, basisname) {
  const zeilen = dateiInhalt.split(/\r?\n/);
  let i = zeilen[0] && zeilen[0].startsWith("#!") ? 1 : 0;
  if (!/^\s*\/\//.test(zeilen[i] || "")) return "kein Kopfkommentar";
  const stuecke = [];
  for (; i < zeilen.length && /^\s*\/\//.test(zeilen[i]); i++) {
    const kern = zeilen[i].replace(/^\s*\/\/+\s?/, "").trim();
    if (!kern) break;
    stuecke.push(kern);
  }
  const satz = stuecke.join(" ");
  const woerter = satz.split(/\s+/).filter(Boolean);
  if (woerter.length < 4) return "Kopf zu duenn (" + woerter.length + " Woerter)";
  const nurBuchstaben = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const basis = nurBuchstaben(String(basisname).replace(/\.[^.]+$/, ""));
  if (nurBuchstaben(satz) === basis) return "Kopf ist nur der Dateiname";
  return null;
}

// Welche Module laedt ueberhaupt ein Test? Der Dateiname allein sagt das nicht:
// client.test.js prueft vier Module auf einmal, data.test.js laedt measure.js
// und rules.js mit. Deshalb wird das ECHTE Laden ausgewertet.
function geladeneModule() {
  const geladen = new Set();
  for (const f of testdateien()) {
    const t = fs.readFileSync(path.join(DASH, "test", f), "utf8");
    for (const m of t.matchAll(/require\(\s*["']\.\.\/([^"']+)["']\s*\)/g)) {
      geladen.add(m[1].replace(/^\.\//, ""));
    }
    // client.test.js laedt die Browser-Teile ueber einen zusammengesetzten Pfad.
    if (/require\(path\.join\(CLIENT/.test(t)) {
      for (const n of ["core", "pages", "detail", "bridge", "start"]) geladen.add("render/client/" + n + ".js");
    }
  }
  return geladen;
}

// ---------------------------------------------------------------------------
// Jedes Modul wird von einem Test geladen
// ---------------------------------------------------------------------------

test("jedes Modul wird von mindestens einem Test geladen -- oder steht mit Grund in der Ausnahmeliste", () => {
  const geladen = geladeneModule();
  const ohne = moduleFinden().filter((m) => !geladen.has(m) && !(m in OHNE_TEST));
  assert.deepStrictEqual(
    ohne,
    [],
    "Modul ohne Test. Entweder einen Test schreiben oder mit GRUND in OHNE_TEST eintragen"
  );
});

test("jede Ausnahme traegt einen Grund und betrifft ein Modul, das es gibt", () => {
  const vorhanden = new Set(moduleFinden());
  const fehler = [];
  for (const [modul, grund] of Object.entries(OHNE_TEST)) {
    if (!vorhanden.has(modul)) fehler.push(modul + ": Ausnahme fuer ein Modul, das es nicht mehr gibt");
    if (!grund || grund.length < 40) fehler.push(modul + ": Grund fehlt oder ist zu knapp, um ihn zu pruefen");
  }
  assert.deepStrictEqual(fehler, [], "die Ausnahmeliste ist veraltet oder unbegruendet");
});

test("kein Modul steht in der Ausnahmeliste, obwohl es einen Test hat", () => {
  // Gegenprobe: eine Ausnahme, die nicht mehr noetig ist, verdeckt spaeter eine
  // echte Luecke, weil niemand die Liste noch liest.
  const geladen = geladeneModule();
  const ueberfluessig = Object.keys(OHNE_TEST).filter((m) => geladen.has(m));
  assert.deepStrictEqual(ueberfluessig, [], "Ausnahme fuer ein Modul, das laengst geprueft wird -- Zeile streichen");
});

// ---------------------------------------------------------------------------
// Groesse und Selbsterklaerung
// ---------------------------------------------------------------------------

// Altbestand ueber der Grenze. KEIN Freibrief: der Stand wird festgehalten, und
// die Datei darf nicht mehr wachsen. So wird die Ausnahme mit jeder Aenderung
// kleiner statt bequemer -- und wer wirklich aufteilt, streicht die Zeile.
const GROESSE_ALTBESTAND = {
  // Gemessen 23.08.2026. Die Spezifikation legt fest: neue Logik kommt in
  // eigene Module (inventar, hooks-detail, zutun-docs, verwandt), nicht hier
  // hinein. Aufteilen steht als offener Punkt in docs/regelverstoesse-plan.md.
  // 23.08.2026 von 1152 auf 1126 verkleinert: verlaufMessen ist nach
  // dashboard/history.js gewandert, als das Einhaengen der Projekt-Messung
  // die Klinke ueberschritten haette. Die Grenze wandert mit -- sonst
  // entstuende wieder Luft, in die die Datei zurueckwachsen kann.
  "measure.js": 1045,
};

test("kein Modul ueberschreitet 800 Zeilen", () => {
  const zuGross = moduleFinden()
    .map((m) => ({ m, n: fs.readFileSync(path.join(DASH, m), "utf8").split(/\r?\n/).length }))
    .filter((x) => x.n > MAX_ZEILEN && !(x.m in GROESSE_ALTBESTAND))
    .map((x) => x.m + " (" + x.n + " Zeilen)");
  assert.deepStrictEqual(zuGross, [], "Modul ueber der Grenze -- aufteilen");
});

test("der Altbestand ueber der Grenze waechst nicht weiter", () => {
  const gewachsen = [];
  for (const [m, grenze] of Object.entries(GROESSE_ALTBESTAND)) {
    const p = path.join(DASH, m);
    if (!fs.existsSync(p)) {
      gewachsen.push(m + ": steht in der Liste, gibt es aber nicht mehr -- Zeile streichen");
      continue;
    }
    const n = fs.readFileSync(p, "utf8").split(/\r?\n/).length;
    if (n > grenze) gewachsen.push(m + ": " + n + " Zeilen, erlaubt waren " + grenze);
    // Wer die Datei verkleinert hat, soll die Grenze nachziehen -- sonst
    // entsteht wieder Luft, in die sie zurueckwachsen kann.
    if (n < grenze - 40) gewachsen.push(m + ": nur noch " + n + " Zeilen -- Grenze in GROESSE_ALTBESTAND nachziehen");
    if (n <= MAX_ZEILEN) gewachsen.push(m + ": unter " + MAX_ZEILEN + " Zeilen -- Ausnahme streichen");
  }
  assert.deepStrictEqual(gewachsen, [], "die Sperrklinke haelt nicht mehr");
});

test("jedes Modul erklaert sich im Kopf mit einem echten Satz", () => {
  // S6 (Riegel gegen den Surrogat-Fehler): frueher an der BUCHSTABENZAHL
  // gemessen (>=25 Zeichen) -- das besteht auch ein Buchstabensalat. Jetzt an
  // der Eigenschaft (siehe kopfMangel): ein //-Block, mehrere Woerter, nicht
  // bloss der Dateiname.
  const ohne = [];
  for (const m of moduleFinden()) {
    const grund = kopfMangel(fs.readFileSync(path.join(DASH, m), "utf8"), m.split("/").pop());
    if (grund) ohne.push(m + ": " + grund);
  }
  assert.deepStrictEqual(ohne, [], "Modul ohne erklaerenden Kopf");
});

test("jede Testdatei nennt im Kopf, wozu sie gehoert", () => {
  const ohne = testdateien()
    .map((f) => ({ f, grund: kopfMangel(fs.readFileSync(path.join(DASH, "test", f), "utf8"), f) }))
    .filter((x) => x.grund)
    .map((x) => x.f + ": " + x.grund);
  assert.deepStrictEqual(ohne, [], "Testdatei ohne erklaerenden Kopf");
});

// ---------------------------------------------------------------------------
// Die Falle, die am 23.08.2026 fast eine kaputte Auslieferung erzeugt haette
// ---------------------------------------------------------------------------

test("kein Modul verlangt eine Datei, die es nicht gibt", () => {
  // Genau das waere passiert, waere die Dateiliste des Installateurs nicht
  // nachgezogen worden: ein index.js, das vier nicht vorhandene Module laedt.
  // Hier wird jeder eigene require aufgeloest -- fremde Pakete (node:*) bleiben
  // aussen vor, weil es hier bewusst keine Abhaengigkeiten gibt.
  const fehlend = [];
  for (const m of moduleFinden()) {
    const voll = path.join(DASH, m);
    const text = fs.readFileSync(voll, "utf8");
    for (const treffer of text.matchAll(/require\(\s*["'](\.[^"']+)["']\s*\)/g)) {
      const ziel = path.resolve(path.dirname(voll), treffer[1]);
      const da = fs.existsSync(ziel) || fs.existsSync(ziel + ".js");
      if (!da) fehlend.push(m + " verlangt " + treffer[1]);
    }
  }
  assert.deepStrictEqual(fehlend, [], "ein Modul laedt etwas, das nicht existiert");
});

test("kein Modul laedt ein fremdes Paket", () => {
  // Der Rahmen ist "Bordmittel, keine Bibliothek". Ein eingeschlichener
  // Fremd-Aufruf faellt erst beim Empfaenger auf, wo kein node_modules liegt.
  const ERLAUBT = /^(node:)?(fs|path|os|url|util|child_process|crypto|vm|assert|events|readline|zlib|stream|buffer|http|https|net)$/;
  const fremd = [];
  for (const m of moduleFinden()) {
    const text = fs.readFileSync(path.join(DASH, m), "utf8");
    for (const treffer of text.matchAll(/require\(\s*["']([^."'][^"']*)["']\s*\)/g)) {
      if (!ERLAUBT.test(treffer[1])) fremd.push(m + " laedt " + treffer[1]);
    }
  }
  assert.deepStrictEqual(fremd, [], "fremdes Paket -- der Bausatz liefert keins mit");
});

test("kein liegengebliebener Debug-Ausdruck in einem Modul", () => {
  // index.js schreibt bewusst nach stdout (das ist sein Bericht), die
  // Browser-Teile duerfen nichts ausgeben.
  const AUSNAHME = new Set(["index.js"]);
  const treffer = [];
  for (const m of moduleFinden()) {
    if (AUSNAHME.has(m)) continue;
    const zeilen = fs.readFileSync(path.join(DASH, m), "utf8").split(/\r?\n/);
    zeilen.forEach((z, i) => {
      if (/^\s*console\.(log|debug|dir)\s*\(/.test(z)) treffer.push(m + ":" + (i + 1));
    });
  }
  assert.deepStrictEqual(treffer, [], "Debug-Ausdruck im Bestand");
});

// ---------------------------------------------------------------------------
// Die Tests selbst -- eine Sammlung, die nur gruen ist, weil sie nichts prueft,
// waere schlimmer als keine.
// ---------------------------------------------------------------------------

test("jede Testdatei enthaelt echte Behauptungen", () => {
  // S7 (Riegel gegen den Surrogat-Fehler): frueher NUR an der Anzahl gemessen
  // (assert. >= test()). Das besteht auch eine Sammlung aus assert.ok(true) --
  // gruen, aber prueft nichts. Nach dem Review verschaerft: eine Behauptung ist
  // nur ECHT, wenn ihre Argumente einen BERECHNETEN Wert enthalten (einen
  // Bezeichner oder Aufruf), nicht nur Literale. So fallen assert.ok(true),
  // assert.strictEqual(2, 2), assert.ok('x'), assert.ok(1 + 1) durch -- egal in
  // welcher Schreibweise. GRENZE, ausdruecklich: ob eine Behauptung das RICHTIGE
  // prueft, sieht kein statischer Test -- er faengt die leere Geste, nicht den
  // Denkfehler.
  const istKommentar = (z) => /^\s*(\/\/|\*|\/\*)/.test(z);
  // Bleibt nach dem Abziehen aller Literale (Strings, Zahlen, true/false/null)
  // noch ein Bezeichner in den Argumenten, prueft die Behauptung einen echten
  // Wert. Sonst ist sie tautologisch/leer.
  const istEcht = (zeile) => {
    const m = zeile.match(/assert[.\w]*\((.*)\)/);
    if (!m) return true; // keine klar erkennbaren Argumente -> nicht als leer werten
    const args = m[1]
      .replace(/(['"`])(?:\\.|(?!\1).)*\1/g, "")
      .replace(/\b\d+(?:\.\d+)?\b/g, "")
      .replace(/\b(?:true|false|null|undefined|NaN)\b/g, "");
    return /[A-Za-z_$]/.test(args);
  };
  const schwach = [];
  for (const f of testdateien()) {
    const t = fs.readFileSync(path.join(DASH, "test", f), "utf8");
    const tests = (t.match(/^\s*(test|wennDa)\(/gm) || []).length;
    const behauptungsZeilen = t.split(/\r?\n/).filter((z) => /assert[.(]/.test(z) && !istKommentar(z));
    const echte = behauptungsZeilen.filter(istEcht);
    const leere = behauptungsZeilen.filter((z) => !istEcht(z));
    if (tests === 0) schwach.push(f + ": keine Pruefung");
    else if (echte.length < tests) schwach.push(f + ": " + tests + " Pruefungen, aber nur " + echte.length + " echte Behauptungen");
    else if (leere.length) schwach.push(f + ": " + leere.length + " leere/tautologische Behauptung(en), z. B. " + leere[0].trim().slice(0, 40));
  }
  assert.deepStrictEqual(schwach, [], "Testdatei ohne Substanz");
});

test("kein uebersprungener Test ohne Grund im Namen", () => {
  // Uebersprungen ist in Ordnung -- still uebersprungen nicht. Wer die Ausgabe
  // liest, muss sehen, was nicht geprueft wurde und warum.
  const ohneGrund = [];
  for (const f of testdateien()) {
    const t = fs.readFileSync(path.join(DASH, "test", f), "utf8");
    for (const m of t.matchAll(/\{\s*skip:\s*true\s*\}/g)) {
      const davor = t.slice(Math.max(0, m.index - 400), m.index);
      if (!/uebersprungen/.test(davor)) ohneGrund.push(f);
    }
  }
  assert.deepStrictEqual([...new Set(ohneGrund)], [], "uebersprungener Test ohne Grund im Namen");
});
