// Test zu dashboard/zutun-docs.js -- Bordmittel, node:test.
//
// Geprueft wird gegen ZWEI Lagen:
//   echt      der Baum dieses Workspace (die Zahlen, die spaeter im Dashboard stehen)
//   Vorlage   ein eigens gebauter Mini-Baum mit CRLF und fehlenden Quellen, weil
//             sich Fehlerfaelle am echten Baum nicht erzwingen lassen, ohne ihn
//             kaputtzumachen.
// Der Vorlagen-Baum liegt unter dashboard/test/ und wird am Ende wieder entfernt.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");


const { zuTunDoku } = require("../zutun-docs.js");

const WURZEL = path.resolve(__dirname, "..", "..");

// --- Vorbedingung -----------------------------------------------------------
// Manche Pruefungen betreffen den INHALT eines gewachsenen Workspace (eine
// git-ignorierte Datei, die Werkstatt-Dokumente, Projekt-Repos). In einer
// frischen Installation gibt es das zu Recht nicht. Ein Test, der dort
// scheitert, meldet einen Fehler, wo nur eine Bedingung fehlt -- und rote Tests
// beim Empfaenger sind schlimmer als keine. Deshalb: uebersprungen MIT Grund,
// nie stillschweigend bestanden.
function wennDa(bedingung, grund, name, fn) {
  if (bedingung) return test(name, fn);
  return test(name + "  [uebersprungen: " + grund + "]", { skip: true }, fn);
}
const ART_CODES = ["checkbox", "offen-ueberschrift", "offen-inline", "platzhalter", "leere-vorlage"];

// ---------------------------------------------------------------------------
// Vorlagen-Baum
// ---------------------------------------------------------------------------
function baumBauen(dateien) {
  const wurzel = fs.mkdtempSync(path.join(os.tmpdir(), "harness-tmp-zutun-"));
  for (const [rel, text] of Object.entries(dateien)) {
    const ziel = path.join(wurzel, rel);
    fs.mkdirSync(path.dirname(ziel), { recursive: true });
    fs.writeFileSync(ziel, text);
  }
  return wurzel;
}

const baumWeg = (wurzel) => fs.rmSync(wurzel, { recursive: true, force: true });

// ---------------------------------------------------------------------------
// Echter Baum
// ---------------------------------------------------------------------------
wennDa(fs.existsSync(WURZEL + "/docs/tool-landscape.md"), "docs/tool-landscape.md nicht vorhanden",
  "findet die leere Vorlage in docs/tool-landscape.md", () => {
  const { eintraege, fehler } = zuTunDoku(WURZEL);
  // Eine fehlende Quelle ist KEIN Fehler des Moduls: die Werkstatt-Dokumente
  // (harness-issues.md, kit-backport.md) entstehen erst im Betrieb und fehlen in
  // einer frischen Installation zu Recht. Was NICHT sein darf, ist eine Quelle,
  // die da ist und nicht gelesen werden kann -- das waere ein echter Ausfall.
  const unlesbar = fehler.filter((f) => f.code !== "quelle-fehlt");
  assert.deepStrictEqual(unlesbar, [], "eine vorhandene Quelle muss lesbar sein");
  const vorlagen = eintraege.filter((e) => e.artCode === "leere-vorlage");
  assert.strictEqual(vorlagen.length, 1);
  assert.strictEqual(vorlagen[0].datei, "docs/tool-landscape.md");

  // Gegenprobe an der Quelle: die Zeile, auf die der Eintrag zeigt, traegt
  // wirklich den Vorlagen-Vermerk -- und die Datei traegt sonst keine Daten.
  const zeilen = fs.readFileSync(path.join(WURZEL, "docs/tool-landscape.md"), "utf8").split(/\r?\n/);
  assert.match(zeilen[vorlagen[0].zeile - 1], /noch nichts erhoben/);
  const daten = zeilen.filter((z) => /^\s*\|/.test(z) && !/^\s*\|[\s:|-]+\|\s*$/.test(z));
  assert.ok(daten.length > 0, "die Datei hat Tabellen");
  assert.ok(
    daten.every((z) => /noch nichts erhoben/.test(z) || /^\s*\|\s*(Programm|Dienst)/.test(z)),
    "ausser Kopfzeilen traegt keine Tabellenzeile Inhalt"
  );
});

wennDa(fs.existsSync(WURZEL + "/docs/harness-issues.md"), "Werkstatt-Dokumente nicht vorhanden (frische Installation)",
  "Checkbox: Treffer im Lesefenster -- oder ehrliche Null mit Gegenprobe", () => {
  const { eintraege } = zuTunDoku(WURZEL);
  const gefunden = eintraege.filter((e) => e.artCode === "checkbox");

  // Was die Muster im Lesefenster ueberhaupt finden KOENNEN: rebuild-guide.md wird
  // nur bis Zeile 60 gelesen (Spezifikation 7.5), die uebrigen Quellen ganz.
  const fenster = [
    ["docs/harness-issues.md", 0],
    ["docs/kit-backport.md", 0],
    ["docs/rebuild-guide.md", 60],
    [".claude/rules/keel/output-shape.md", 0],
    ["CLAUDE.md", 0],
  ];
  let erwartet = 0;
  for (const [rel, grenze] of fenster) {
    const zeilen = fs.readFileSync(path.join(WURZEL, rel), "utf8").split(/\r?\n/);
    const bis = grenze > 0 ? Math.min(grenze, zeilen.length) : zeilen.length;
    for (let i = 0; i < bis; i++) if (/^\s*[-*]\s*\[ \]/.test(zeilen[i])) erwartet += 1;
  }
  assert.strictEqual(gefunden.length, erwartet, "Modul und Nachmessung muessen dieselbe Zahl liefern");

  if (erwartet === 0) {
    // Die Null ist kein leerer Baum, sondern eine Grenze: rebuild-guide.md traegt
    // Kaestchen, aber alle liegen hinter Zeile 60.
    const zeilen = fs.readFileSync(path.join(WURZEL, "docs/rebuild-guide.md"), "utf8").split(/\r?\n/);
    const alle = zeilen.map((z, i) => (/^\s*[-*]\s*\[ \]/.test(z) ? i + 1 : 0)).filter(Boolean);
    assert.ok(alle.length > 0, "Beleg: die Datei traegt ueberhaupt Kaestchen");
    assert.ok(Math.min(...alle) > 60, "Beleg: das erste Kaestchen steht hinter dem Lesefenster");
  }
});

test("kein Wagenruecklauf und kein Backslash im ganzen Datensatz", () => {
  const { eintraege, fehler } = zuTunDoku(WURZEL);
  assert.ok(eintraege.length > 0);
  for (const e of eintraege) {
    assert.ok(!e.text.includes("\r"), "text ohne Wagenruecklauf: " + e.id);
    assert.ok(!e.text.includes("\n"), "text ist genau eine Zeile: " + e.id);
    assert.ok(!e.datei.includes("\\"), "datei POSIX: " + e.datei);
    assert.ok(!e.datei.includes("\r"));
  }
  assert.ok(JSON.stringify(fehler).indexOf("\\r") === -1);
});

test("Form des Datensatzes: IDs eindeutig, artCode aus dem festen Satz, Zeile plausibel", () => {
  const { eintraege } = zuTunDoku(WURZEL);
  const ids = new Set();
  eintraege.forEach((e, i) => {
    assert.strictEqual(e.id, "zutundoku:" + (i + 1));
    assert.ok(!ids.has(e.id));
    ids.add(e.id);
    assert.ok(ART_CODES.includes(e.artCode), "artCode ist ein Code, kein Satz: " + e.artCode);
    assert.ok(Number.isInteger(e.zeile) && e.zeile > 0);
    // Die Messung liefert keine deutschen Saetze: die Felder sind Code + Fundort,
    // text ist der Wortlaut der Quelle.
    const zeilen = fs.readFileSync(path.join(WURZEL, e.datei), "utf8").split(/\r?\n/);
    assert.strictEqual(zeilen[e.zeile - 1].trim(), e.text, "text ist der Wortlaut von datei:zeile");
  });
});

// ---------------------------------------------------------------------------
// Vorlagen-Baum: CRLF und Fehlerfaelle
// ---------------------------------------------------------------------------
test("CRLF-Quellen liefern dieselben Zeilennummern und keinen Wagenruecklauf", () => {
  const wurzel = baumBauen({
    "docs/harness-issues.md": "# Kopf\r\n\r\n- [ ] erstes Kaestchen\r\n\r\n## Offene Punkte\r\n",
    "docs/kit-backport.md": "Zeile eins\r\nDas ist noch offen und bleibt es\r\n",
    "docs/rebuild-guide.md": "x\r\n".repeat(59) + "- [ ] genau auf Zeile 60\r\n",
    ".claude/rules/keel/output-shape.md": "Offen: ein Name fehlt\r\n",
    "CLAUDE.md": "# Kopf\r\n## 5. `[?]` Deine eigenen Regeln\r\n",
    "docs/tool-landscape.md": "| A | B |\r\n|---|---|\r\n| _(noch nichts erhoben)_ | |\r\n",
  });
  try {
    const { eintraege, fehler } = zuTunDoku(wurzel);
    assert.deepStrictEqual(fehler, []);
    const karte = eintraege.map((e) => [e.datei, e.zeile, e.artCode]);
    assert.deepStrictEqual(karte, [
      ["docs/harness-issues.md", 3, "checkbox"],
      ["docs/harness-issues.md", 5, "offen-ueberschrift"],
      ["docs/kit-backport.md", 2, "offen-inline"],
      ["docs/rebuild-guide.md", 60, "checkbox"], // Zeile 60 gehoert noch zum Lesefenster
      // output-shape.md wird jetzt zur Laufzeit unter .claude/rules/ gefunden
      // (ordner-agnostisch) und der festen Liste ANGEHAENGT -- daher nach
      // CLAUDE.md statt davor. Reihenfolge der Eintraege ist nicht bedeutsam.
      ["CLAUDE.md", 2, "platzhalter"],
      [".claude/rules/keel/output-shape.md", 1, "offen-inline"],
      ["docs/tool-landscape.md", 3, "leere-vorlage"],
    ]);
    for (const e of eintraege) assert.ok(!e.text.includes("\r"), "kein \\r trotz CRLF: " + e.id);
    assert.strictEqual(eintraege[0].text, "- [ ] erstes Kaestchen");
  } finally {
    baumWeg(wurzel);
  }
});

test("Kaestchen hinter Zeile 60 in rebuild-guide.md werden nicht gelesen", () => {
  const wurzel = baumBauen({
    "docs/rebuild-guide.md": "x\n".repeat(60) + "- [ ] zu spaet\n",
  });
  try {
    const { eintraege } = zuTunDoku(wurzel);
    assert.strictEqual(eintraege.filter((e) => e.artCode === "checkbox").length, 0);
  } finally {
    baumWeg(wurzel);
  }
});

test("fehlende Quelle wird gemeldet, nicht verschluckt", () => {
  const wurzel = baumBauen({ "CLAUDE.md": "## 1. Kopf\n" });
  try {
    const { eintraege, fehler } = zuTunDoku(wurzel);
    assert.strictEqual(eintraege.length, 0);
    // vier Dokumente plus die Vorlagen-Quelle fehlen -- jedes einzeln gemeldet
    // output-shape.md ist NICHT mehr fest verlangt (dynamisch unter .claude/rules/
    // gesucht; fehlt es, kein Fehler) -- daher 4 statt 5.
    assert.strictEqual(fehler.length, 4);
    for (const f of fehler) {
      assert.strictEqual(f.code, "quelle-fehlt");
      assert.ok(typeof f.datei === "string" && f.datei.length > 0);
    }
    assert.ok(fehler.some((f) => f.datei === "docs/tool-landscape.md"));
  } finally {
    baumWeg(wurzel);
  }
});

test("gefuellte Tool-Landschaft ist keine leere Vorlage", () => {
  const wurzel = baumBauen({
    "docs/tool-landscape.md": "| Programm | CLI |\n|---|---|\n| git | git |\n",
  });
  try {
    const { eintraege } = zuTunDoku(wurzel);
    assert.strictEqual(eintraege.filter((e) => e.artCode === "leere-vorlage").length, 0);
  } finally {
    baumWeg(wurzel);
  }
});

test("keine eigenen Vorlagen-Reste im Bauordner", () => {
  // Geprueft wird nur das eigene Praefix: node --test faehrt die Testdateien in
  // getrennten Prozessen PARALLEL -- ein Blick auf alle tmp-Ordner wuerde die
  // Vorlagen der Nachbardatei sehen und hinge am Zufall der Laufzeit.
  const reste = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith("harness-tmp-zutun-"));
  assert.deepStrictEqual(reste, [], "kein Vorlagen-Rest: " + reste.join(", "));
});
