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

function moduleFinden() {
  const raus = [];
  (function lauf(ordner) {
    for (const e of fs.readdirSync(ordner, { withFileTypes: true })) {
      const p = path.join(ordner, e.name);
      if (e.isDirectory()) {
        if (e.name !== "test") lauf(p);
      } else if (e.name.endsWith(".js")) {
        raus.push(path.relative(DASH, p).split(path.sep).join("/"));
      }
    }
  })(DASH);
  return raus.sort();
}

function testdateien() {
  return fs.readdirSync(path.join(DASH, "test")).filter((f) => f.endsWith(".test.js")).sort();
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
      for (const n of ["core", "pages", "detail", "start"]) geladen.add("render/client/" + n + ".js");
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
  "measure.js": 1152,
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

test("jedes Modul erklaert im Kopf, was es ist", () => {
  // Wer eine dieser Dateien zum ersten Mal oeffnet, muss in der ersten Zeile
  // wissen, wo er ist. Bei zwanzig Dateien ist das kein Luxus.
  const ohne = [];
  for (const m of moduleFinden()) {
    const zeilen = fs.readFileSync(path.join(DASH, m), "utf8").split(/\r?\n/);
    const kopf = zeilen.slice(0, 3).join(" ");
    if (!/^\s*(#!|\/\/)/.test(zeilen[0]) || kopf.replace(/[^A-Za-zÄÖÜäöüß]/g, "").length < 25) {
      ohne.push(m);
    }
  }
  assert.deepStrictEqual(ohne, [], "Modul ohne Kopfkommentar");
});

test("jede Testdatei nennt im Kopf, wozu sie gehoert", () => {
  const ohne = testdateien().filter((f) => {
    const kopf = fs.readFileSync(path.join(DASH, "test", f), "utf8").split(/\r?\n/).slice(0, 3).join(" ");
    return !/\/\//.test(kopf) || kopf.replace(/[^A-Za-zÄÖÜäöüß]/g, "").length < 25;
  });
  assert.deepStrictEqual(ohne, [], "Testdatei ohne Kopfkommentar");
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
  const schwach = [];
  for (const f of testdateien()) {
    const t = fs.readFileSync(path.join(DASH, "test", f), "utf8");
    const tests = (t.match(/^\s*(test|wennDa)\(/gm) || []).length;
    const behauptungen = (t.match(/assert\./g) || []).length;
    if (tests === 0) schwach.push(f + ": keine Pruefung");
    else if (behauptungen < tests) schwach.push(f + ": " + tests + " Pruefungen, aber nur " + behauptungen + " Behauptungen");
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
