// Prueft die Wortliste selbst -- das ist der Punkt, an dem die Beanstandung
// "die Beschriftung ist furchtbar" strukturell aufhoert:
// nicht "wir haben aufgepasst", sondern ein Test, der jedes Wort durchgeht.

const { test } = require("node:test");
const assert = require("node:assert");
const W = require("../render/labels.js");

// Alle Zeichenketten aus der Wortliste einsammeln, mit ihrem Ort -- damit ein
// Fehlschlag sagt, WO das Wort steht, nicht nur DASS es da ist.
function alleTexte() {
  const raus = [];
  function gehe(wert, ort) {
    if (typeof wert === "string") { raus.push({ ort, text: wert }); return; }
    if (Array.isArray(wert)) { wert.forEach((w, i) => gehe(w, ort + "[" + i + "]")); return; }
    if (wert && typeof wert === "object") {
      for (const k of Object.keys(wert)) gehe(wert[k], ort ? ort + "." + k : k);
    }
  }
  for (const name of ["SEITEN", "NAVIGATION", "STATUS", "ART", "ART_BESCHREIBUNG",
                      "WIRKUNG", "LADEART", "KANTE", "QUELLE", "GIT", "LEER", "UI",
                      "NOTIZ", "ZUTUN_ART"]) {
    gehe(W[name], name);
  }
  return raus;
}

test("kein verbotenes Wort in der Oberflaeche", () => {
  const texte = alleTexte();
  const treffer = [];
  for (const { ort, text } of texte) {
    for (const wort of W.VERBOTEN) {
      // Wortgrenze, damit "Befehle" nicht in "Befehlspalette" anschlaegt und
      // "Z." nicht in "z. B." -- geprueft wird das Wort, nicht die Buchstabenfolge.
      const muster = new RegExp("(^|[\\s„\"'(\\/])" + wort.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "($|[\\s.,;:!?)\"'\\/])");
      if (muster.test(text)) treffer.push(ort + ": \"" + text + "\" enthaelt \"" + wort + "\"");
    }
  }
  assert.deepStrictEqual(treffer, [], "verbotene Woerter gefunden:\n" + treffer.join("\n"));
});

test("Harness-Begriffe bleiben englisch und unuebersetzt", () => {
  // Diese Woerter MUESSEN vorkommen -- sie sind die Namen auf der Platte.
  const pflicht = ["Hooks", "Commands", "Skills", "Rules", "settings.json", "CLAUDE.md"];
  const alles = alleTexte().map((t) => t.text).join(" ");
  for (const p of pflicht) {
    assert.ok(alles.includes(p), "Harness-Begriff fehlt in der Wortliste: " + p);
  }
});

test("jede Seite hat Name, Zweck-Satz und Symbol", () => {
  for (const [id, s] of Object.entries(W.SEITEN)) {
    assert.ok(s.name && s.name.length > 2, id + ": kein Name");
    assert.ok(s.zweck && s.zweck.length > 20, id + ": kein oder zu kurzer Zweck-Satz");
    assert.ok(s.icon, id + ": kein Symbol");
  }
});

test("jeder Navigationseintrag zeigt auf eine echte Seite", () => {
  const bekannt = new Set(Object.keys(W.SEITEN));
  for (const gruppe of W.NAVIGATION) {
    for (const e of gruppe.eintraege) {
      assert.ok(bekannt.has(e), "Navigationseintrag ohne Seite: " + e);
    }
  }
  // Und umgekehrt: keine Seite ohne Weg dorthin.
  const verlinkt = new Set(W.NAVIGATION.flatMap((g) => g.eintraege));
  for (const id of bekannt) {
    assert.ok(verlinkt.has(id), "Seite ohne Navigationseintrag (nicht erreichbar): " + id);
  }
});

test("jeder Status hat Wort, eigene Glyphe und Farbtoken", () => {
  const glyphen = new Set();
  for (const [code, s] of Object.entries(W.STATUS)) {
    assert.ok(s.wort, code + ": kein Wort");
    assert.ok(s.glyphe, code + ": keine Glyphe");
    assert.ok(s.token && s.token.startsWith("--status-"), code + ": kein Status-Token");
    assert.ok(!glyphen.has(s.glyphe), code + ": Glyphe " + s.glyphe + " doppelt -- Farbe allein darf nicht unterscheiden");
    glyphen.add(s.glyphe);
  }
});

test("jede Art aus der Messung hat genau ein Wort", () => {
  // Die Rollen-Codes aus file-inventory.js (Spezifikation 7.1).
  const rollen = ["hook-skript", "skript", "settings", "launch", "wurzel-kontext",
                  "gitignore", "command", "skill", "skill-datei", "dauer-regel",
                  "doku", "dashboard-modul", "dashboard-doku", "lizenz", "sonstiges"];
  for (const r of rollen) {
    assert.ok(W.ART[r], "Rolle ohne Wort auf der Oberflaeche: " + r);
  }
});

test("jeder Leerzustand hat Text, keiner ist eine Sackgasse ohne Erklaerung", () => {
  for (const [id, l] of Object.entries(W.LEER)) {
    assert.ok(l.text && l.text.length > 15, id + ": Leerzustand ohne brauchbare Erklaerung");
    if (l.handlung) {
      assert.ok(l.handlung.wort && l.handlung.ziel, id + ": Handlung ohne Wort oder Ziel");
    }
  }
});

test("fuellen laesst einen fehlenden Platzhalter sichtbar stehen", () => {
  assert.strictEqual(W.fuellen("es sind {n} Stueck", { n: 8 }), "es sind 8 Stueck");
  // Der wichtige Fall: nichts uebergeben. Ein "undefined" in der Oberflaeche
  // waere ein stiller Fehler; der sichtbare Platzhalter faellt sofort auf.
  assert.strictEqual(W.fuellen("es sind {n} Stueck", {}), "es sind {n} Stueck");
  assert.strictEqual(W.fuellen("es sind {n} Stueck", null), "es sind {n} Stueck");
});

test("Zahlen, Bytes und Datum werden deutsch und ohne Erfindung formatiert", () => {
  assert.strictEqual(W.zahl(5368), "5.368");
  assert.strictEqual(W.zahl(undefined), "—");
  assert.strictEqual(W.bytes(512), "512 B");
  assert.strictEqual(W.bytes(23151), "22,6 KB");
  assert.strictEqual(W.bytes(null), "—");
  assert.strictEqual(W.datum(null), "—");
  assert.strictEqual(W.datum("kein datum"), "—");
  assert.ok(/^\d{2}\.\d{2}\.\d{4}/.test(W.datum("2026-08-22T16:18:00Z")));
});

test("keine Abkuerzung in einer Beschriftung", () => {
  // Eine Liste echter Abkuerzungen statt einer Heuristik: "ist." am Satzende ist
  // keine Abkuerzung, "Z." mitten im Satz schon. Ein Muster, das beides gleich
  // behandelt, meldet Fehlalarme -- und ein Test mit Fehlalarmen wird abgeschaltet.
  const ABKUERZUNGEN = [
    "Z.", "Zl.", "Anz.", "Nr.", "Std.", "Min.", "Sek.", "Verz.", "Dat.",
    "geänd.", "geaend.", "erst.", "bzw.", "ggf.", "evtl.", "inkl.", "exkl.",
    "u. a.", "u.a.", "z. B.", "z.B.", "d. h.", "d.h.", "usw.", "etc.",
    "Bsp.", "Abb.", "Tab.", "Kap.", "Abs.", "Vgl.", "vgl.", "s. o.", "s. u.",
  ];
  const treffer = [];
  for (const { ort, text } of alleTexte()) {
    for (const a of ABKUERZUNGEN) {
      const muster = new RegExp("(^|[\\s(\\/„\"'])" + a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      if (muster.test(text)) treffer.push(ort + ": \"" + text + "\" -> \"" + a + "\"");
    }
  }
  assert.deepStrictEqual(treffer, [], "Abkuerzungen gefunden:\n" + treffer.join("\n"));
});

test("kein Satz endet ohne Punkt und keiner beginnt klein", () => {
  // Erklaertexte sind Saetze. Ein fehlender Punkt oder ein kleiner Anfang liest
  // sich als abgeschnitten -- genau der Eindruck "unfertiges Showcase".
  const treffer = [];
  const pruefen = [["SEITEN", W.SEITEN, "zweck"], ["LEER", W.LEER, "text"]];
  for (const [gruppe, quelle, feld] of pruefen) {
    for (const [id, eintrag] of Object.entries(quelle)) {
      const t = eintrag[feld];
      if (!t) continue;
      if (!/[.!?]$/.test(t.trim())) treffer.push(gruppe + "." + id + "." + feld + ": endet ohne Punkt");
      // Ein Satz darf mit einem Pfad oder Dateinamen beginnen ("docs/tool-landscape.md traegt ...")
      // -- kleingeschrieben ist dort richtig, nicht nachlaessig.
      const beginntMitPfad = /^[a-z0-9_.~-]+[/.][a-z0-9_./-]+/i.test(t.trim());
      if (/^[a-zäöüß]/.test(t.trim()) && !beginntMitPfad) treffer.push(gruppe + "." + id + "." + feld + ": beginnt klein");
    }
  }
  assert.deepStrictEqual(treffer, [], treffer.join("\n"));
});
