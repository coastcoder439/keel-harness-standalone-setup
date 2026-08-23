// Test zu dashboard/render/data.js -- Bordmittel, node:test.
//
// data.js ist das Scharnier: es nimmt, was die Messung liefert, und macht
// daraus den EINEN flachen Eintrags-Index, auf dem alle Seiten, die Suche, die
// Filter und die Einzelansicht arbeiten. Ein Fehler hier zeigt sich nicht als
// Absturz, sondern als eine Zeile, die auf nichts zeigt, oder als ein Feld, das
// still verschwindet -- deshalb wird hier gegen den ECHTEN Datensatz geprueft
// und nicht gegen eine Vorlage.

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");

const { messen } = require("../measure.js");
const { regeln } = require("../rules.js");
const { daten } = require("../render/data.js");
const { UI, SEITEN, STATUS } = require("../render/worte.js");

const WURZEL = path.resolve(__dirname, "..", "..");

// Einmal messen, alle Tests lesen daraus. Die Messung ist teuer (Dateibaum,
// git), und sie ist lesend -- ein gemeinsamer Stand ist hier richtig.
const messung = messen({ wurzel: WURZEL });
const regelDaten = regeln(WURZEL);
const d = daten(messung, regelDaten);

// ---------------------------------------------------------------------------
// Der Datensatz als Ganzes
// ---------------------------------------------------------------------------

test("der Datensatz traegt Schema, Messzeit und Wurzel", () => {
  assert.match(d.schema, /^harness\./, "Schemaname fehlt oder ist unbenannt");
  assert.ok(!Number.isNaN(Date.parse(d.gemessenAm)), "gemessenAm ist kein lesbarer Zeitpunkt");
  assert.ok(d.gemessenText && d.gemessenText.length > 4, "gemessenText fehlt");
  assert.ok(d.wurzel, "wurzel fehlt");
  assert.ok(d.workspace, "workspace fehlt");
});

test("kein Windows-Trennzeichen in irgendeinem Pfad des Datensatzes", () => {
  // Der Grund ist nicht Schoenheit: eine Datei hiess im Baum anders als im
  // Bestand, und deshalb fanden 19 Verknuepfungen ihr Ziel nicht (gemessen
  // 23.08.2026). Ein einziger Backslash reicht dafuer.
  const treffer = [];
  const sehen = (wert, ort) => {
    if (typeof wert === "string") {
      if (/^[A-Za-z]:\\|\\\\|(?:^|\/)[\w.-]+\\[\w.-]/.test(wert)) treffer.push(ort + " = " + wert.slice(0, 70));
      return;
    }
    if (Array.isArray(wert)) return wert.forEach((v, i) => sehen(v, ort + "[" + i + "]"));
    if (wert && typeof wert === "object") {
      for (const k of Object.keys(wert)) {
        // roh ist die unveraenderte Messung; sie darf Rechnerpfade tragen.
        if (k === "roh" || k === "inhalt") continue;
        sehen(wert[k], ort + "." + k);
      }
    }
  };
  for (const e of d.eintraege) sehen({ id: e.id, pfad: e.pfad, verwandt: e.verwandt }, e.id);
  assert.deepStrictEqual(treffer.slice(0, 10), [], "Windows-Trennzeichen in einem Pfadfeld");
});

// ---------------------------------------------------------------------------
// Die Eintraege -- die eine Liste, auf der alles arbeitet
// ---------------------------------------------------------------------------

test("jede Eintrags-Kennung ist eindeutig", () => {
  const gesehen = new Map();
  const doppelt = [];
  for (const e of d.eintraege) {
    if (gesehen.has(e.id)) doppelt.push(e.id + " (" + gesehen.get(e.id) + " und " + e.seite + ")");
    gesehen.set(e.id, e.seite);
  }
  assert.deepStrictEqual(doppelt, [], "doppelte Kennung -- die Adresse zeigt dann auf zwei Dinge");
});

test("jede Kennung ist in einer Adresse verwendbar", () => {
  // Die Kennung landet im Adress-Anhang (#seite/kennung). Zeichen, die dort
  // Bedeutung tragen, wuerden den Zustand beim Neuladen zerlegen.
  const schlecht = d.eintraege
    .filter((e) => e.id !== encodeURIComponent(e.id).replace(/%2F/g, "/").replace(/%3A/g, ":"))
    .map((e) => e.id);
  assert.deepStrictEqual(schlecht.slice(0, 8), [], "Kennung mit Zeichen, die in einer Adresse Bedeutung tragen");
});

test("jeder Eintrag gehoert zu einer Seite, die es gibt", () => {
  const seiten = new Set(Object.keys(d.seiten));
  const verwaist = [...new Set(d.eintraege.filter((e) => !seiten.has(e.seite)).map((e) => e.seite))];
  assert.deepStrictEqual(verwaist, [], "Eintrag auf einer Seite, die nicht im Datensatz steht");
});

test("jeder Eintrag traegt einen Namen -- keine leere Zeile", () => {
  const ohne = d.eintraege.filter((e) => !e.name || !String(e.name).trim()).map((e) => e.id);
  assert.deepStrictEqual(ohne.slice(0, 8), [], "Eintrag ohne Namen waere eine leere Zeile in der Liste");
});

test("jeder Status stammt aus dem festen Satz -- kein erfundener Zustand", () => {
  const erlaubt = new Set(Object.keys(STATUS));
  const fremd = [...new Set(d.eintraege.map((e) => e.status).filter((s) => s && !erlaubt.has(s)))];
  assert.deepStrictEqual(fremd, [], "Status, den worte.js nicht kennt -- er haette kein Wort und keine Glyphe");
});

test("ein Eintrag ohne gemessenen Zustand bekommt keinen erfundenen", () => {
  // Ehrlichkeitsregel: ein abgeleiteter Zustand, der aussieht wie ein
  // gemessener, ist schlimmer als eine Luecke -- man glaubt ihm.
  for (const e of d.eintraege) {
    if (e.status === undefined || e.status === null) continue;
    assert.ok(typeof e.status === "string" && e.status.length > 0, e.id + " traegt einen leeren Status");
  }
});

// ---------------------------------------------------------------------------
// Beschreibungen -- die Luecke, an der die Vorfassung gescheitert ist
// ---------------------------------------------------------------------------

test("jede Datei traegt eine Beschreibung mit genannter Quelle", () => {
  const dateien = d.eintraege.filter((e) => e.seite === "dateien" && e.art !== "ordner");
  assert.ok(dateien.length > 10, "es gibt ueberhaupt Dateien im Index");
  const ohne = dateien.filter((e) => !e.beschreibung || !e.beschreibung.text).map((e) => e.pfad);
  assert.deepStrictEqual(ohne.slice(0, 8), [], "Datei ohne Beschreibung");

  // Eine Beschreibung ohne Herkunft ist eine Behauptung. Jede muss sagen,
  // woher sie stammt -- Frontmatter, Kopfkommentar, settings.json, oder der
  // benannte Ersatz.
  const ohneQuelle = dateien.filter((e) => e.beschreibung && !e.beschreibung.quelle).map((e) => e.pfad);
  assert.deepStrictEqual(ohneQuelle.slice(0, 8), [], "Beschreibung ohne genannte Quelle");
});

// ---------------------------------------------------------------------------
// Verknuepfungen -- eine Kante, die ins Leere zeigt, ist eine kaputte Tuer
// ---------------------------------------------------------------------------

test("jede Verknuepfung zeigt auf einen Eintrag, den es gibt -- oder ist als extern gekennzeichnet", () => {
  const bekannt = new Set(d.eintraege.map((e) => e.id));
  const tot = [];
  for (const e of d.eintraege) {
    for (const v of e.verwandt || []) {
      if (v.extern) continue;
      if (!bekannt.has(v.nach)) tot.push(e.id + " -> " + v.nach + " (" + v.beleg + ")");
    }
  }
  assert.deepStrictEqual(tot.slice(0, 8), [], "Verknuepfung ins Leere");
});

test("jede Verknuepfung traegt einen Beleg mit Datei und Zeile", () => {
  const ohne = [];
  for (const e of d.eintraege) {
    for (const v of e.verwandt || []) {
      if (!v.beleg || !/:\d+$/.test(v.beleg)) ohne.push(e.id + " -> " + v.nach + " (Beleg: " + v.beleg + ")");
    }
  }
  assert.deepStrictEqual(ohne.slice(0, 8), [], "Verknuepfung ohne Fundort");
});

// ---------------------------------------------------------------------------
// Seiten und Navigation
// ---------------------------------------------------------------------------

test("jede Seite hat Namen, Zweck-Satz und Symbol", () => {
  for (const [id, s] of Object.entries(d.seiten)) {
    assert.ok(s.name, id + ": kein Name");
    assert.ok(s.zweck && s.zweck.length > 15, id + ": kein Zweck-Satz");
    assert.ok(s.icon, id + ": kein Symbol");
  }
});

test("kein Zweck-Satz traegt einen ungefuellten Platzhalter", () => {
  // Die Zweck-Saetze tragen gemessene Zahlen. Ein "{anzahl}", das stehen
  // bleibt, verraet dem Leser, dass hier nichts gemessen wurde.
  const offen = Object.entries(d.seiten)
    .filter(([, s]) => /\{[a-zA-Z]+\}/.test(s.zweck))
    .map(([id, s]) => id + ": " + s.zweck.slice(0, 60));
  assert.deepStrictEqual(offen, [], "ungefuellter Platzhalter in einem Zweck-Satz");
});

test("jeder Navigationseintrag zeigt auf eine Seite im Datensatz", () => {
  const seiten = new Set(Object.keys(d.seiten));
  const tot = [];
  for (const g of d.navigation) {
    for (const id of g.eintraege) if (!seiten.has(id)) tot.push((g.gruppe || "(ohne Gruppe)") + " -> " + id);
  }
  assert.deepStrictEqual(tot, [], "Navigationseintrag ohne Seite");
});

test("jede Seite ist von der Navigation aus erreichbar", () => {
  // Gegenprobe zur vorigen Pruefung: eine Seite, die im Datensatz steht, aber
  // in keiner Gruppe auftaucht, ist unerreichbar -- gebaut und unsichtbar.
  const inNav = new Set(d.navigation.flatMap((g) => g.eintraege));
  const unerreichbar = Object.keys(d.seiten).filter((id) => !inNav.has(id));
  assert.deepStrictEqual(unerreichbar, [], "Seite ohne Weg dorthin");
});

// ---------------------------------------------------------------------------
// Symbole und vorgerendertes Markdown
// ---------------------------------------------------------------------------

test("jedes benutzte Symbol liegt im Datensatz -- nachgeschlagen wie zur Laufzeit", () => {
  // Der Browser normalisiert den Namen, bevor er nachschlaegt
  // (core.js: toLowerCase, alles ausser a-z0-9 entfernt). Ein Test, der
  // stattdessen den rohen Namen vergleicht, meldet fuenf Fehlalarme --
  // "layout-dashboard" liegt als "layoutdashboard" in der Seite.
  const vorhanden = new Set(Object.keys(d.icons));
  const findet = (name) =>
    vorhanden.has(name) || vorhanden.has(String(name).toLowerCase().replace(/[^a-z0-9]/g, ""));

  const fehlend = new Set();
  for (const s of Object.values(d.seiten)) if (s.icon && !findet(s.icon)) fehlend.add(s.icon);
  for (const c of Object.values(STATUS)) if (c.glyphe && !findet(c.glyphe)) fehlend.add(c.glyphe);
  assert.deepStrictEqual([...fehlend], [], "Symbol wird benutzt, liegt aber nicht in der Seite");

  // Gegenprobe: der Nachschlag darf nicht alles finden. Ein erfundener Name
  // muss durchfallen, sonst prueft die Zeile darueber nichts.
  assert.ok(!findet("gibt-es-nicht-xyz"), "der Symbol-Nachschlag findet auch Erfundenes");
});

test("jeder vorgerenderte Markdown-Eintrag gehoert zu einer Datei im Index", () => {
  const pfade = new Set(d.eintraege.filter((e) => e.pfad).map((e) => e.pfad));
  const verwaist = Object.keys(d.markdown).filter((p) => !pfade.has(p));
  assert.deepStrictEqual(verwaist.slice(0, 5), [], "gerendertes Markdown ohne zugehoerige Datei");
});

test("die Wortliste der Seite ist die aus worte.js -- kein zweiter Bestand", () => {
  // Wenn data.js eigene Woerter mitgibt, gibt es zwei Orte fuer dieselbe
  // Beschriftung, und einer davon veraltet.
  for (const [k, v] of Object.entries(d.worte)) {
    assert.ok(k in UI, "das Wort '" + k + "' steht im Datensatz, aber nicht in worte.js");
    assert.strictEqual(v, UI[k], "das Wort '" + k + "' weicht von worte.js ab");
  }
});

test("die Seitenliste des Datensatzes deckt sich mit worte.js", () => {
  assert.deepStrictEqual(Object.keys(d.seiten).sort(), Object.keys(SEITEN).sort(), "Seiten in worte.js und im Datensatz weichen ab");
});

// ---------------------------------------------------------------------------
// Zwei Funde der Gegenpruefung vom 23.08.2026 -- beide waren LATENT: sie
// zeigten sich im Normalbetrieb nicht und haetten beim ersten Umschalten
// zugeschlagen. Genau deshalb stehen sie hier.
// ---------------------------------------------------------------------------

test("eine nicht gelaufene Hook-Probe gilt nicht als Fehler", () => {
  // Vier Hooks werden bewusst nicht ausgefuehrt (uncommitted-warn.js schreibt
  // einen Drossel-Stempel, die drei Waechter brauchen eine echte Eingabe). Sie
  // bekommen ein Proben-Objekt mit exit: null. Der alte Ausdruck fragte nur
  // exit !== 0 -- und null ist ungleich 0, also standen genau diese vier auf
  // "Fehler", sobald jemand die Proben einschaltet.
  const { hooksDetail } = require("../hooks-detail.js");
  const mitProben = hooksDetail(WURZEL, { proben: true });
  const uebersprungen = (mitProben.eintraege || []).filter(
    (e) => e.probe && typeof e.probe.exit !== "number"
  );
  assert.ok(uebersprungen.length > 0, "es gibt ueberhaupt uebersprungene Proben -- sonst prueft dieser Test nichts");

  const mitLauf = { ...messung, hooks: mitProben };
  const d2 = daten(mitLauf, regelDaten);
  const namen = new Set(uebersprungen.map((e) => e.skript || e.ereignis));
  const falsch = d2.eintraege
    .filter((e) => e.seite === "hooks" && namen.has(e.name) && e.status === "befund")
    .map((e) => e.name);
  assert.deepStrictEqual(falsch, [], "uebersprungene Probe als Fehler gewertet");

  // Gegenprobe: eine Probe, die WIRKLICH mit einem Fehler endete, muss weiterhin
  // als Fehler durchschlagen.
  const erfunden = {
    ...mitProben,
    eintraege: (mitProben.eintraege || []).map((e, i) =>
      i === 0 ? { ...e, probe: { ...(e.probe || {}), exit: 2 } } : e
    ),
  };
  const d3 = daten({ ...messung, hooks: erfunden }, regelDaten);
  const ersterName = (mitProben.eintraege || [])[0];
  const treffer = d3.eintraege.find(
    (e) => e.seite === "hooks" && e.name === (ersterName.skript || ersterName.ereignis)
  );
  assert.strictEqual(treffer.status, "befund", "ein echter Fehlschlag wird nicht mehr gemeldet");
});

test("gleich benannte Repos bekommen verschiedene Kennungen", () => {
  // Die Kennung steht in der Adresse. Zwei Eintraege mit derselben Kennung
  // zeigen auf denselben -- ein Klick auf das eine Repo oeffnet das andere.
  const zwei = {
    ...messung,
    bereiche: {
      ...messung.bereiche,
      sicherung: {
        ...(messung.bereiche.sicherung || {}),
        repos: [
          { name: "a/werkzeug", pfad: "user-projects/a/werkzeug", status: "ok", git: "JA (Branch main)" },
          { name: "b/werkzeug", pfad: "user-projects/b/werkzeug", status: "ok", git: "JA (Branch main)" },
        ],
      },
    },
  };
  const d2 = daten(zwei, regelDaten);
  const ids = d2.eintraege.filter((e) => e.seite === "backup").map((e) => e.id);
  assert.strictEqual(ids.length, 2, "beide Repos stehen im Index");
  assert.strictEqual(new Set(ids).size, 2, "beide tragen dieselbe Kennung: " + ids.join(" · "));
});

// ---------------------------------------------------------------------------
// EINE DATEI, EINE BESCHREIBUNG
//
// Der Fund, der diese Prüfung erzwungen hat: dieselbe Datei trug je nach Seite
// einen anderen Text. "Dateien" zeigte die gerankte Beschreibung, "Hooks" die
// statusMessage aus settings.json, "Session-Kontext" einen Satz über die
// Ladeart. 15 von 25 mehrfach gezeigten Dateien wichen ab -- wer
// danger-guard.js auf drei Seiten sah, las dreimal etwas anderes und musste
// raten, welche Fassung stimmt.
// ---------------------------------------------------------------------------

test("dieselbe Datei traegt auf jeder Seite dieselbe Beschreibung", () => {
  const nachPfad = new Map();
  for (const e of d.eintraege) {
    if (!e.pfad) continue;
    if (!nachPfad.has(e.pfad)) nachPfad.set(e.pfad, []);
    nachPfad.get(e.pfad).push(e);
  }

  const mehrfach = [...nachPfad.entries()].filter(([, l]) => l.length > 1);
  assert.ok(mehrfach.length > 5, "es gibt ueberhaupt Dateien auf mehreren Seiten -- sonst prueft das nichts");

  const abweichend = [];
  for (const [pfad, liste] of mehrfach) {
    const texte = new Set(liste.map((e) => String((e.beschreibung && e.beschreibung.text) || "").trim()));
    if (texte.size > 1) {
      abweichend.push(
        pfad + ": " + liste.map((e) => e.seite + '="' + String((e.beschreibung && e.beschreibung.text) || "").slice(0, 30) + '"').join(" | ")
      );
    }
  }
  assert.deepStrictEqual(abweichend.slice(0, 5), [], "dieselbe Datei, verschiedene Beschreibungen");
});

test("die Beschreibung stammt ueberall aus derselben Quelle", () => {
  // Nicht nur der Text muss gleich sein, auch die Herkunft: sonst behauptet
  // eine Seite "aus CLAUDE.md" und eine andere "aus dem Kopfkommentar",
  // waehrend beide denselben Satz zeigen -- und der Beleg fuehrt in die Irre.
  const nachPfad = new Map();
  for (const e of d.eintraege) {
    if (!e.pfad || !e.beschreibung || !e.beschreibung.text) continue;
    if (!nachPfad.has(e.pfad)) nachPfad.set(e.pfad, []);
    nachPfad.get(e.pfad).push(e);
  }
  const abweichend = [];
  for (const [pfad, liste] of nachPfad) {
    if (liste.length < 2) continue;
    const quellen = new Set(liste.map((e) => String(e.beschreibung.quelle || "")));
    const belege = new Set(liste.map((e) => String(e.beschreibung.beleg || "")));
    if (quellen.size > 1 || belege.size > 1) {
      abweichend.push(pfad + ": " + [...quellen].join(" / ") + "  " + [...belege].join(" / "));
    }
  }
  assert.deepStrictEqual(abweichend.slice(0, 5), [], "dieselbe Datei, verschiedene Herkunft");
});

test("was eine andere Frage beantwortet, steht in einem eigenen Feld", () => {
  // Die Gegenprobe zur Vereinheitlichung: der Text darf nicht einfach
  // VERSCHWUNDEN sein. Was vorher faelschlich im Beschreibungs-Feld stand, muss
  // jetzt als eigene Eigenschaft mit eigenem Label auftauchen.
  const hooks = d.eintraege.filter((e) => e.seite === "hooks" && e.roh && e.roh.ansage);
  assert.ok(hooks.length > 3, "es gibt Hooks mit einer statusMessage");
  for (const e of hooks) {
    const zeile = (e.felder || []).find((f) => f.label === UI.ansageStatusleiste);
    assert.ok(zeile, e.name + ": die statusMessage ist ersatzlos verschwunden");
    assert.strictEqual(zeile.wert, e.roh.ansage, e.name + ": die Zeile zeigt etwas anderes als settings.json");
  }

  const kontext = d.eintraege.filter((e) => e.seite === "kontext" && e.roh && e.roh.warum);
  assert.ok(kontext.length > 3, "es gibt Kontext-Stuecke mit einem Grund");
  for (const e of kontext) {
    const zeile = (e.felder || []).find((f) => f.label === UI.warumImKontext);
    assert.ok(zeile, e.name + ": der Grund ist ersatzlos verschwunden");
  }
});
