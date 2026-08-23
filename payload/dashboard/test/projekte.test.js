// Test zu dashboard/projekte.js und dashboard/verlauf.js -- Bordmittel, node:test.
//
// WORUM ES GEHT
// user-projects/ war im Dashboard ein geschlossener Knoten mit einer Zahl. Man
// sah, DASS es Projekte gibt, und sonst nichts -- die Pläne lagen da und waren
// nicht zu öffnen. Dieses Modul öffnet sie, ohne die Seite zu sprengen: die
// wenigen Wurzel-Dokumente mit Inhalt, die docs/-Bäume nur als Liste.
//
// Die zwei Zahlen, an denen sich das messen lässt (23.08.2026, 19 Projekte):
//   Wurzel-Dokumente   27 Dateien,  257 KB  -> in die Seite
//   docs/-Bäume       572 Dateien, 7,1 MB  -> nur gelistet
// Alles einzubetten hätte die Seite von 5,9 auf 14 MB getrieben.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");

const { spawnSync } = require("child_process");
const { projekte, ersterAbsatz, WURZEL_DOKUMENT } = require("../projekte.js");
const { verlaufMessen } = require("../verlauf.js");

// Ein Git-ORDNER allein genuegt nicht: eine frische Installation macht `git init`
// OHNE Commit (belegt in checks/frisch-geklont.mjs). verlaufMessen liefert dann
// zu Recht status "fehlt" -- der Verlaufs-Test ist dort also nicht anwendbar und
// wird mit Grund uebersprungen, statt hart rot zu werden. [Abnahme-Fund]
function hatCommits(wurzel) {
  try {
    return spawnSync("git", ["-C", wurzel, "rev-parse", "--verify", "HEAD"], { encoding: "utf8" }).status === 0;
  } catch {
    return false;
  }
}

const WURZEL = path.resolve(__dirname, "..", "..");
const N = String.fromCharCode(10);

// --- Vorbedingung -----------------------------------------------------------
// Eine frische Installation hat keine Projekte. Das ist der Normalfall und
// keine Störung -- ein Test, der dort scheitert, meldet einen Fehler, wo nur
// eine Bedingung fehlt.
function wennDa(bedingung, grund, name, fn) {
  if (bedingung) return test(name, fn);
  return test(name + "  [uebersprungen: " + grund + "]", { skip: true }, fn);
}

const hatProjekte = fs.existsSync(path.join(WURZEL, "user-projects"));
const echt = hatProjekte ? projekte(WURZEL) : null;

// ---------------------------------------------------------------------------
// Fehlender Ordner ist kein Fehler
// ---------------------------------------------------------------------------

test("ohne user-projects/ ein leeres Ergebnis -- keine Ausnahme, kein Fehlercode", () => {
  const leer = fs.mkdtempSync(path.join(os.tmpdir(), "ohne-projekte-"));
  try {
    const r = projekte(leer);
    assert.strictEqual(r.anzahl, 0);
    assert.deepStrictEqual(r.liste, []);
    assert.strictEqual(r.vorhanden, false);
    assert.deepStrictEqual(r.fehler, [], "ein leerer Bestand ist hier der Normalfall");
  } finally {
    fs.rmSync(leer, { recursive: true, force: true });
  }
  const ohneWurzel = projekte(undefined);
  assert.strictEqual(ohneWurzel.anzahl, 0);
  assert.strictEqual(ohneWurzel.vorhanden, false);
});

// ---------------------------------------------------------------------------
// Der erste Absatz -- die Stelle, an der eine Vorfassung Müll lieferte
// ---------------------------------------------------------------------------

test("ersterAbsatz überspringt Banner, Abzeichen, Überschriften und Zitatblöcke", () => {
  // Gemessen an keel-light: die Vorfassung lieferte
  // "<p align=center> <img src=doc/assets/banner.jpg alt=..." als Beschreibung.
  const readme =
    "# Projektname" + N + N +
    '<p align="center">' + N +
    '  <img src="doc/assets/banner.jpg" alt="Banner">' + N +
    "</p>" + N + N +
    "[![Build](https://img.shields.io/badge/build-ok-green)](https://example.org)" + N + N +
    "> Ein Zitatblock, der nicht die Beschreibung ist." + N + N +
    "Ein Werkzeug, das Dinge tut." + N;
  assert.strictEqual(ersterAbsatz(readme), "Ein Werkzeug, das Dinge tut.");
});

test("ersterAbsatz räumt Auszeichnung ab -- die Zeile ist Text, kein gerendertes Markdown", () => {
  assert.strictEqual(ersterAbsatz("**Fett** und *kursiv* und `Code`."), "Fett und kursiv und Code.");
  assert.strictEqual(ersterAbsatz("Siehe [die Anleitung](https://example.org/x)."), "Siehe die Anleitung.");
  assert.strictEqual(ersterAbsatz("Ein <b>HTML</b>-Rest."), "Ein HTML-Rest.");
});

test("ersterAbsatz liefert null statt eines erfundenen Satzes", () => {
  assert.strictEqual(ersterAbsatz(""), null);
  assert.strictEqual(ersterAbsatz(null), null);
  assert.strictEqual(ersterAbsatz("# Nur eine Überschrift"), null);
  assert.strictEqual(ersterAbsatz("```" + N + "nur Code" + N + "```"), null);
  assert.strictEqual(ersterAbsatz("| Tabelle | Zeile |"), null);
});

test("ersterAbsatz kürzt lange Absätze und zeigt das an", () => {
  const lang = "Wort ".repeat(120);
  const r = ersterAbsatz(lang);
  assert.ok(r.length <= 300, "Länge: " + r.length);
  assert.ok(r.endsWith("…"), "die Kürzung ist nicht erkennbar");
});

// ---------------------------------------------------------------------------
// Gegen einen gebauten Baum -- die Fälle, die im echten Bestand nicht vorkommen
// ---------------------------------------------------------------------------

function baumBauen(dateien) {
  const w = fs.mkdtempSync(path.join(os.tmpdir(), "projekte-test-"));
  for (const [rel, inhalt] of Object.entries(dateien)) {
    const p = path.join(w, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, inhalt);
  }
  return w;
}

test("Wurzel-Dokumente kommen OHNE Inhalt (D1), docs/ nur als Liste", () => {
  // SERVER-ZUERST (D1): KEIN Dokument-Rumpf steht mehr im Datensatz -- weder bei
  // den Wurzel-Dokumenten noch bei docs/. serve.js liefert ihn auf Klick. Was
  // vom README/ZIEL in die Seite gelangt, ist nur die BESCHREIBUNG des Projekts.
  const w = baumBauen({
    "user-projects/alpha/README.md": "# Alpha" + N + N + "Ein Werkzeug." + N,
    "user-projects/alpha/ZIEL.md": "# Ziel" + N + N + "Etwas erreichen." + N,
    "user-projects/alpha/docs/plan.md": "# Plan" + N + N + "Sehr langer Text." + N,
    "user-projects/alpha/docs/tief/mehr.md": "# Mehr" + N,
    // Weder Wurzel-Dokument noch docs/: bleibt draussen.
    "user-projects/alpha/src/index.js": "console.log(1);" + N,
    "user-projects/alpha/NOTIZEN.txt": "kein Markdown" + N,
  });
  try {
    const r = projekte(w);
    assert.strictEqual(r.anzahl, 1);
    const p = r.liste[0];
    assert.strictEqual(p.name, "alpha");

    const wurzelNamen = p.wurzelDokumente.map((d) => d.name).sort();
    assert.deepStrictEqual(wurzelNamen, ["README.md", "ZIEL.md"]);
    for (const d of p.wurzelDokumente) {
      assert.strictEqual(d.inhalt, null, d.name + ": Rumpf im Datensatz, obwohl auf Abruf gedacht");
      assert.strictEqual(d.aufAbruf, true, d.name + ": nicht als abrufbar markiert");
      assert.ok(d.bytes > 0 && d.geaendert, d.name + ": ohne Metadaten ist die Zeile wertlos");
    }
    // Die Beschreibung des Projekts stammt aus dem README (Rang vor ZIEL).
    assert.strictEqual(p.beschreibung.text, "Ein Werkzeug.");
    assert.strictEqual(p.beschreibung.beleg, "user-projects/alpha/README.md:1");

    const dokuPfade = p.dokuDateien.map((d) => d.pfad).sort();
    assert.deepStrictEqual(dokuPfade, [
      "user-projects/alpha/docs/plan.md",
      "user-projects/alpha/docs/tief/mehr.md",
    ]);
    for (const d of p.dokuDateien) {
      assert.strictEqual(d.inhalt, null, d.pfad + ": Inhalt eingebettet, obwohl nur gelistet");
      assert.ok(d.bytes > 0 && d.geaendert, d.pfad + ": ohne Metadaten ist die Zeile wertlos");
    }

    // Der Quellbaum bleibt draussen -- sonst waere es kein Wegweiser, sondern
    // ein zweites Dateisystem.
    const alle = [...wurzelNamen, ...dokuPfade].join(" ");
    assert.ok(!alle.includes("index.js") && !alle.includes("NOTIZEN"), "Fremdes aufgenommen");
  } finally {
    fs.rmSync(w, { recursive: true, force: true });
  }
});

test("ein Projekt ohne jeden Wegweiser wird gezählt, nicht verschwiegen", () => {
  const w = baumBauen({ "user-projects/leer/src/index.js": "1;" + N });
  try {
    const r = projekte(w);
    assert.strictEqual(r.anzahl, 1);
    assert.strictEqual(r.liste[0].anzahlDokumente, 0);
    assert.strictEqual(r.liste[0].beschreibung, null, "eine erfundene Beschreibung waere schlimmer als keine");
    assert.strictEqual(r.ohneDokumente, 1);
  } finally {
    fs.rmSync(w, { recursive: true, force: true });
  }
});

test("ein Zugang in einem Projekt-Dokument leckt nicht in die Beschreibung", () => {
  // Ein Projekt-Dokument ist genauso wenig kontrolliert wie eine Datei des
  // Harness. Seit SERVER-ZUERST (D1) steht der Rumpf NICHT mehr im Datensatz
  // (serve.js liefert ihn gefiltert auf Klick -- siehe serve.test.js). Was vom
  // Dokument in die Seite gelangt, ist die BESCHREIBUNG. Steht ein Zugang im
  // ersten Absatz, muss er auch dort maskiert sein -- sonst waere
  // user-projects/ ein Weg an den Riegeln vorbei.
  const w = baumBauen({
    "user-projects/geheim/README.md":
      "# Geheim" + N + N + 'DB_PASSWORD=Qx7!Zephir-Nordlicht' + N,
  });
  try {
    const p = projekte(w).liste[0];
    // Der Rumpf steht gar nicht erst im Datensatz.
    assert.strictEqual(p.wurzelDokumente[0].inhalt, null, "der Dokument-Rumpf steht im Datensatz");
    assert.strictEqual(p.wurzelDokumente[0].aufAbruf, true);
    // Und die Beschreibung ist gefiltert -- der Klartext taucht nirgends auf.
    assert.ok(!p.beschreibung.text.includes("Qx7!Zephir-Nordlicht"), "der Zugang steht im Klartext in der Beschreibung");
    assert.ok(p.beschreibung.text.includes("[ausgeblendet:zugang]"), "die Maskierung fehlt in der Beschreibung");
  } finally {
    fs.rmSync(w, { recursive: true, force: true });
  }
});

test("der Stack wird erkannt, wo einer erkennbar ist -- sonst null", () => {
  const w = baumBauen({
    "user-projects/js/package.json": "{}",
    "user-projects/py/requirements.txt": "",
    "user-projects/nichts/README.md": "# X" + N,
  });
  try {
    const nach = {};
    for (const p of projekte(w).liste) nach[p.name] = p.stack;
    assert.strictEqual(nach.js, "node");
    assert.strictEqual(nach.py, "python");
    assert.strictEqual(nach.nichts, null, "geraten statt gemessen");
  } finally {
    fs.rmSync(w, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Gegen den echten Bestand
// ---------------------------------------------------------------------------

wennDa(hatProjekte, "kein user-projects/ in diesem Workspace",
  "jeder Pfad ist POSIX und liegt unter user-projects/", () => {
  for (const p of echt.liste) {
    assert.ok(!p.pfad.includes("\\"), "Backslash: " + p.pfad);
    assert.ok(p.pfad.startsWith("user-projects/"), "ausserhalb: " + p.pfad);
    for (const d of [...p.wurzelDokumente, ...p.dokuDateien]) {
      assert.ok(!d.pfad.includes("\\"), "Backslash: " + d.pfad);
      assert.ok(d.pfad.startsWith(p.pfad + "/"), "Dokument ausserhalb seines Projekts: " + d.pfad);
    }
  }
});

wennDa(hatProjekte, "kein user-projects/ in diesem Workspace",
  "die Kennungen sind eindeutig", () => {
  const ids = echt.liste.map((p) => p.id);
  assert.strictEqual(new Set(ids).size, ids.length, "doppelte Projekt-Kennung");
});

wennDa(hatProjekte, "kein user-projects/ in diesem Workspace",
  "die Messung bleibt schnell genug, um bei jedem Bau mitzulaufen", () => {
  const t0 = Date.now();
  projekte(WURZEL);
  const ms = Date.now() - t0;
  assert.ok(ms < 5000, "dauert " + ms + " ms -- zu lang fuer jeden Lauf");
});

// ---------------------------------------------------------------------------
// verlauf.js -- beim Herausloesen aus measure.js nicht kaputtgegangen
// ---------------------------------------------------------------------------

test("verlaufMessen ohne Repos: ein ehrliches Ergebnis, keine Ausnahme", () => {
  const r = verlaufMessen(WURZEL, []);
  assert.strictEqual(r.status, "fehlt");
  assert.ok(r.grund, "ohne Eintraege muss ein Grund dastehen");
  assert.deepStrictEqual(r.eintraege, []);
});

wennDa(hatCommits(WURZEL), "kein Git-Repo mit Commits",
  "verlaufMessen liest den echten Verlauf, neueste zuerst", () => {
  const r = verlaufMessen(WURZEL, [{ name: path.basename(WURZEL) }]);
  assert.strictEqual(r.status, "ok");
  assert.ok(r.eintraege.length > 0);
  for (const e of r.eintraege) {
    assert.match(e.hash, /^[0-9a-f]{7}$/, "Kurzform des Commits: " + e.hash);
    assert.ok(!Number.isNaN(Date.parse(e.datum)), "unlesbares Datum: " + e.datum);
    assert.ok(e.betreff, "Commit ohne Betreff");
  }
  const daten = r.eintraege.map((e) => e.datum);
  const sortiert = daten.slice().sort().reverse();
  assert.deepStrictEqual(daten, sortiert, "nicht neueste zuerst");
});
