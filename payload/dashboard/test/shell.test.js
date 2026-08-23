// Test zu dashboard/render/shell.js -- Bordmittel, node:test.
//
// Diese Datei ist die Sicherheitsgrenze des Dashboards. Alles, was in die
// erzeugte Seite geht, geht durch shell.js -- und der Inhalt stammt aus dem
// Dateisystem, also aus einer Quelle, die niemand kontrolliert. Ein Dateiname
// mit einer HTML-Marke darin, ein Dokument, das zufaellig "</script>" enthaelt:
// beides muss folgenlos bleiben.
//
// Geprueft wird deshalb nicht "sieht das HTML gut aus", sondern: kommt etwas
// durch, das nicht durchkommen darf.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const { renderHTML, esc, datenBlock } = require("../render/shell.js");

const WURZEL = path.resolve(__dirname, "..", "..");
const U2028 = String.fromCharCode(0x2028);
const U2029 = String.fromCharCode(0x2029);

// Ein Datensatz in der Form, die daten() liefert -- klein, aber vollstaendig
// genug, dass renderHTML durchlaeuft. Wird je Test frisch gebaut, damit ein
// Test den naechsten nicht beeinflusst.
function datensatz(zusatz) {
  return Object.assign(
    {
      schema: "harness.zustand.v2",
      gemessenAm: "2026-08-23T00:00:00.000Z",
      gemessenText: "23.08.2026, 00:00",
      wurzel: "C:/test/workspace",
      wurzelUrl: "file:///C:/test/workspace",
      workspace: "workspace",
      icons: { ordner: "<svg></svg>", datei: "<svg></svg>" },
      markdown: {},
      fehlt: [],
      seiten: {
        ueberblick: { name: "Überblick", zweck: "Zweck.", symbol: "ordner", spalten: [] },
      },
      navigation: [{ gruppe: null, eintraege: ["ueberblick"] }],
      status: {},
      gesamtstatus: "ok",
      zahlen: {},
      eintraege: [],
      worte: { zumInhalt: "Zum Inhalt", eigenschaften: "Eigenschaften" },
      leer: {},
      notiz: {},
      messfehler: [],
      kantenFehler: [],
      roh: {},
    },
    zusatz || {}
  );
}

// ---------------------------------------------------------------------------
// esc -- die Grundlage. Ein Fehler hier vergiftet jede Einsetzstelle.
// ---------------------------------------------------------------------------

test("esc entschaerft die fuenf Zeichen, die im HTML Bedeutung tragen", () => {
  assert.strictEqual(esc("&"), "&amp;");
  assert.strictEqual(esc("<"), "&lt;");
  assert.strictEqual(esc(">"), "&gt;");
  assert.strictEqual(esc('"'), "&quot;");
  // Reihenfolge: & zuerst, sonst wird aus < erst &lt; und daraus &amp;lt;
  assert.strictEqual(esc("<&>"), "&lt;&amp;&gt;");
  assert.strictEqual(esc("&amp;"), "&amp;amp;");
});

test("esc macht aus null und undefined eine leere Zeichenkette, nicht das Wort", () => {
  assert.strictEqual(esc(null), "");
  assert.strictEqual(esc(undefined), "");
  // Die Null ist eine Zahl, kein Nichts -- sie muss stehen bleiben.
  assert.strictEqual(esc(0), "0");
  assert.strictEqual(esc(false), "false");
});

test("esc laesst das einfache Anfuehrungszeichen stehen -- und darf das nur, weil kein Attribut damit begrenzt wird", () => {
  // Das ist bewusst so und deshalb hier festgehalten: esc schuetzt Attribute
  // mit DOPPELTEN Anfuehrungszeichen. Wer ein Attribut mit einfachen begrenzt,
  // reisst ein Loch auf, das esc nicht schliesst.
  assert.strictEqual(esc("'"), "'");

  // Gegenprobe an der Quelle: gibt es irgendwo ein Attribut mit einfachem
  // Anfuehrungszeichen um einen eingesetzten Wert? Dann ist die Annahme oben
  // verletzt und esc muss erweitert werden.
  const dateien = ["render/shell.js", "render/client/core.js", "render/client/pages.js",
                   "render/client/detail.js", "render/client/start.js"];
  const treffer = [];
  for (const rel of dateien) {
    const text = fs.readFileSync(path.join(WURZEL, "dashboard", rel), "utf8");
    text.split(/\r?\n/).forEach((zeile, i) => {
      // ein = gefolgt von einfachem Anfuehrungszeichen und einer Einsetzung
      if (/=\s*'[^']*(\$\{|"\s*\+)/.test(zeile)) treffer.push(rel + ":" + (i + 1));
    });
  }
  assert.deepStrictEqual(treffer, [], "Attribut mit einfachem Anfuehrungszeichen um einen eingesetzten Wert");
});

// ---------------------------------------------------------------------------
// datenBlock -- der Datensatz liegt als JSON IN der Seite. Der klassische
// Ausbruch ist "</script>" in einem Dateiinhalt.
// ---------------------------------------------------------------------------

test("datenBlock schliesst den Skript-Ausbruch", () => {
  const r = datenBlock({ x: "</script><img src=x onerror=alert(1)>" });
  assert.ok(!r.includes("</script"), "roher Skript-Schluss im JSON");
  assert.ok(!r.includes("<img"), "rohe HTML-Marke im JSON");
  assert.ok(r.includes("\\u003c"), "das kleiner-als ist als Fluchtfolge eingesetzt");
  // Und der Inhalt kommt heil wieder heraus -- Sicherheit, die Daten zerstoert,
  // ist keine.
  assert.strictEqual(JSON.parse(r).x, "</script><img src=x onerror=alert(1)>");
});

test("datenBlock entschaerft die beiden unsichtbaren Trenner, die JavaScript zerlegen", () => {
  // U+2028/U+2029 gelten in aelteren JavaScript-Fassungen als Zeilenende und
  // brechen ein Skript mitten im String auf.
  const r = datenBlock({ a: U2028, b: U2029 });
  assert.ok(!r.includes(U2028) && !r.includes(U2029), "roher Trenner im JSON");
  assert.strictEqual(JSON.parse(r).a, U2028);
  assert.strictEqual(JSON.parse(r).b, U2029);
});

test("datenBlock laesst gewoehnlichen Text unangetastet", () => {
  // Gegenprobe zur vorigen Pruefung: die Fluchtfolgen duerfen nicht zu breit
  // greifen. Ein Leerzeichen bleibt ein Leerzeichen.
  const r = datenBlock({ s: "ein Satz mit Leerzeichen, Umlauten äöü und Zahlen 42" });
  assert.ok(r.includes("ein Satz mit Leerzeichen"), "Leerzeichen wurden ersetzt");
  assert.strictEqual(JSON.parse(r).s, "ein Satz mit Leerzeichen, Umlauten äöü und Zahlen 42");
});

test("datenBlock bleibt gueltiges JSON, auch bei Zeilenumbruch und Backslash", () => {
  const roh = { pfad: "C:\\Users\\x", text: "Zeile 1\nZeile 2\tTab", zeichen: '"' };
  const r = datenBlock(roh);
  assert.deepStrictEqual(JSON.parse(r), roh);
});

// ---------------------------------------------------------------------------
// renderHTML -- die ganze Seite. Hier zaehlt, dass die Einsetzstellen den
// Schutz auch WIRKLICH benutzen.
// ---------------------------------------------------------------------------

test("ein praeparierter Workspace-Name landet nicht als Marke in der Seite", () => {
  const seite = renderHTML(datensatz({ workspace: '<script>alert(1)</script>' }));
  assert.ok(!seite.includes("<script>alert(1)</script>"), "roher Skript-Block aus dem Namen");
  assert.ok(seite.includes("&lt;script&gt;alert(1)&lt;/script&gt;"), "der Name steht escaped da");
});

test("ein praeparierter Pfad bricht nicht aus dem title-Attribut aus", () => {
  const seite = renderHTML(datensatz({ wurzel: 'C:/x" onmouseover="alert(1)' }));
  assert.ok(!seite.includes('onmouseover="alert(1)"'), "Ausbruch aus dem Attribut");
  assert.ok(seite.includes("&quot;"), "das Anfuehrungszeichen ist entschaerft");
});

test("ein Dateiinhalt mit Skript-Schluss zerlegt die Seite nicht", () => {
  const seite = renderHTML(datensatz({
    eintraege: [{ id: "datei:x", seite: "ueberblick", name: "x.md", inhalt: "</script><h1>uebernommen</h1>" }],
  }));
  // Genau ein Datenblock, und er endet dort, wo er soll.
  const bloecke = seite.split('<script id="daten"').length - 1;
  assert.strictEqual(bloecke, 1, "genau ein Datenblock");
  assert.ok(!seite.includes("<h1>uebernommen</h1>"), "Inhalt wurde als HTML ausgeliefert");
});

test("der Datenblock der erzeugten Seite ist auslesbares JSON", () => {
  const d = datensatz({ eintraege: [{ id: "a", seite: "ueberblick", name: "A" }] });
  const seite = renderHTML(d);
  const m = seite.match(/<script id="daten" type="application\/json">([\s\S]*?)<\/script>/);
  assert.ok(m, "der Datenblock ist auffindbar");
  const gelesen = JSON.parse(m[1].split("\\u003c").join("<").split("\\u003e").join(">"));
  assert.strictEqual(gelesen.eintraege.length, 1);
  assert.strictEqual(gelesen.eintraege[0].name, "A");
});

test("die vier Browser-Teile stehen vollstaendig und in der festgelegten Reihenfolge in der Seite", () => {
  // Die Reihenfolge ist keine Geschmacksfrage: die Teile setzen aufeinander auf,
  // und ein spaeterer Teil ruft, was ein frueherer definiert hat. Geprueft wird
  // gegen den ECHTEN Quelltext der Module, nicht gegen eine Marke im Dateikopf --
  // die Kopfkommentare stehen ausserhalb der ausgelieferten Zeichenkette und
  // wuerden eine Pruefung vortaeuschen, die nichts beweist.
  const seite = renderHTML(datensatz());
  const teile = ["core", "pages", "detail", "start"];
  let vorher = -1;
  for (const name of teile) {
    const { quelltext } = require("../render/client/" + name + ".js");
    const i = seite.indexOf(quelltext);
    assert.ok(i > -1, "Teil " + name + " fehlt in der Seite oder wurde veraendert eingesetzt");
    assert.ok(i > vorher, "Teil " + name + " steht an der falschen Stelle");
    vorher = i;
  }
});

test("die Browser-Teile liegen in genau einem Skript-Element, ohne fremden Rahmen dazwischen", () => {
  const seite = renderHTML(datensatz());
  const core = require("../render/client/core.js").quelltext;
  const start = require("../render/client/start.js").quelltext;
  const von = seite.indexOf(core);
  const bis = seite.indexOf(start) + start.length;
  const dazwischen = seite.slice(von, bis);
  assert.ok(!dazwischen.includes("</script"), "ein Skript-Element endet mitten in den Teilen");
});

test("die Seite ist ein vollstaendiges HTML-Dokument mit Sprache und Zeichensatz", () => {
  const seite = renderHTML(datensatz());
  assert.ok(seite.startsWith("<!doctype html>"), "Dokumenttyp fehlt");
  assert.ok(/<html lang="de"/.test(seite), "Sprachangabe fehlt");
  assert.ok(/<meta charset="utf-8"/.test(seite), "Zeichensatz fehlt");
  assert.ok(seite.trimEnd().endsWith("</html>"), "Dokument endet nicht sauber");
});

test("kein Verweis nach draussen: die Seite laedt nichts aus dem Netz", () => {
  // Der Rahmen des Dashboards ist "kein Netz". Eine Schriftart oder ein Skript
  // von aussen wuerde die Seite bei fehlender Verbindung halb zerlegen -- und
  // waere ein stiller Rueckkanal.
  const seite = renderHTML(datensatz());
  const treffer = seite.match(/(src|href)\s*=\s*"(https?:)?\/\//gi) || [];
  assert.deepStrictEqual(treffer, [], "die Seite verweist nach draussen");
});

test("die Kennung im localStorage-Praefix traegt keinen Rechnerpfad", () => {
  // Der Praefix haengt an der Wurzel, damit zwei Workspaces sich nicht ins
  // Gehege kommen. Er darf den Pfad aber nicht ausplaudern -- die Seite kann
  // weitergegeben werden.
  const seite = renderHTML(datensatz({ wurzel: "C:/Users/GeheimerName/projekt" }));
  const zeile = seite.split(/\r?\n/).find((z) => z.includes('"hd:"'));
  assert.ok(zeile, "der Praefix ist auffindbar");
  assert.ok(!zeile.includes("GeheimerName"), "der Benutzername steht im Praefix");
  assert.ok(!zeile.includes("/"), "der Praefix traegt Pfadtrenner");
});
