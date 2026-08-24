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
const { renderHTML } = require("../render/shell.js");
const { UI, SEITEN, STATUS } = require("../render/labels.js");
// Die Seitenbauer und die Helfer liegen seit dem 23.08.2026 in eigenen
// Modulen. Sie werden hier mitgeladen, damit die Vollstaendigkeits-Pruefung
// sieht, dass sie geprueft sind -- und weil ein Export-Vertrag, den niemand
// anfasst, still veralten kann.
const SEITENBAUER = require("../render/views.js");
const HELFER = require("../render/helpers.js");

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
  assert.deepStrictEqual(fremd, [], "Status, den labels.js nicht kennt -- er haette kein Wort und keine Glyphe");
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

// S1 (Riegel gegen den Surrogat-Fehler): der Test prueft NUTZEN, nicht blosses
// Vorhandensein. Dreimal ist eine Fussnote als Beschreibung durchgerutscht
// (~70 Stueck), weil "hat eine Beschreibung" mit "sagt etwas" verwechselt wurde.
// Nach dem Review verschaerft: auch getarnte Meta ("**Anlass:**"), Tabellen-
// zeilen, mit einer Markdown-Marke beginnende und uebermaessig lange (Ausschnitt
// statt Auskunft) Beschreibungen gelten als FEHLEND. Faellt rot, sobald die
// Ableitung wieder eine Notiz, ein Listen-Dump oder einen Ausschnitt nimmt.
test("jede Beschreibung besteht die Nutzen-Pruefung (kein Anlass:/Stand/Zaun/Tabelle/Marke/Ausschnitt)", () => {
  const dateien = d.eintraege.filter((e) => e.seite === "dateien" && e.art !== "ordner");
  const nutzlos = (e) => {
    const t = e.beschreibung && e.beschreibung.text;
    if (!t) return null; // fehlende Beschreibung faengt der Test darueber
    const s = t.trim();
    // Fuehrende Marke + Auszeichnung abziehen, DANN auf Meta pruefen -- sonst
    // rutscht "**Anlass:**" oder "> Anlass:" durch (Review-Fund). NUR die
    // eindeutigen Meta-Praefixe Anlass/Stand, jeweils mit Trenner bzw. Datum
    // (wie der Generator). Bewusst NICHT die volle Label-Liste: "Verwandt",
    // "Siehe", "Quelle" u. a. koennen einen ECHTEN Kopfkommentar eroeffnen (z. B.
    // "VERWANDT -- die Kanten ...") -- die traefe der Test sonst falsch
    // (Nachpruefungs-Fund 4). Die uebrigen Labels deckt der Generator ohnehin ab.
    const klar = s.replace(/^[>#\s]*(?:[-*+]\s+|\d+[.)]\s+)?/, "").replace(/^[*_`]+/, "");
    if (/^Anlass\b\s*[:.–—-]/i.test(klar) || /^Stand\b\s*[:·.–—-]?\s*(?:v?\d|Phase\b)/i.test(klar)) return "Meta-/Zitatzeile";
    if (/^(```|~~~)/.test(s)) return "Code-Zaun";
    if ((s.match(/\|/g) || []).length >= 2) return "Tabellenzeile";
    if (/^[-*+>#|]/.test(s)) return "beginnt mit Markdown-Marke";
    if (s.length > 300) return "zu lang (" + s.length + " Zeichen) -- Ausschnitt statt Auskunft";
    if (!/\s/.test(s) && /[./]/.test(s)) return "blosser Pfad/Token";
    if (e.name && s === e.name) return "nur der Dateiname";
    return null;
  };
  const schlecht = dateien.filter((e) => nutzlos(e)).map((e) => e.pfad + " (" + nutzlos(e) + "): " + e.beschreibung.text.slice(0, 50));
  assert.deepStrictEqual(schlecht.slice(0, 10), [], "Beschreibung ohne Nutzen -- eine Notiz statt einer Aussage");
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

// Der fruehere Test "jeder vorgerenderte Markdown-Eintrag gehoert zu einer
// Datei" ist mit SERVER-ZUERST (D1) entfallen: es gibt kein d.markdown mehr im
// Datensatz. Markdown wird jetzt on demand von serve.js gerendert (siehe
// serve.test.js). Ein Test auf ein geloeschtes Feld waere eine leere Geste.

// ---------------------------------------------------------------------------
// Riegel gegen den Einbett-Fehler (E) -- der Grund, aus dem die Seite 6,6 MB war
// ---------------------------------------------------------------------------

test("kein Dateiinhalt steht im Datensatz -- Server-zuerst (Riegel gegen E)", () => {
  // Der Rumpf verlaesst den Datensatz (D1); serve.js liefert ihn auf Klick.
  // Faellt rot, sobald jemand wieder Inhalt einbettet.
  const mitText = d.eintraege.filter((e) => e.inhalt && e.inhalt.text != null).map((e) => e.pfad);
  assert.deepStrictEqual(mitText.slice(0, 8), [], "Eintrag mit eingebettetem inhalt.text");
  assert.strictEqual(d.markdown, undefined, "vorgerendertes Markdown ist wieder im Datensatz");

  // Der Rohtext der Messung (file-inventory.js) darf NICHT in den Datensatz sickern --
  // er ist nur ein Seitenfeld fuer Frontmatter/Beschreibung und wird am Knoten
  // fallengelassen.
  let rohtextBei = null;
  (function walk(v, pfad) {
    if (rohtextBei) return;
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, pfad + "[" + i + "]"));
    else if (v && typeof v === "object") {
      if (Object.prototype.hasOwnProperty.call(v, "rohtext")) { rohtextBei = pfad; return; }
      for (const k of Object.keys(v)) walk(v[k], pfad + "." + k);
    }
  })(d, "d");
  assert.strictEqual(rohtextBei, null, "rohtext ist in den Datensatz gesickert bei " + rohtextBei);

  // Projekt-Wurzeldokumente im roh-Zweig ohne Inhalt.
  const liste = (d.roh && d.roh.messung && d.roh.messung.projekte && d.roh.messung.projekte.liste) || [];
  const mitInhalt = [];
  for (const p of liste) for (const dok of (p.wurzelDokumente || [])) if (dok.inhalt != null) mitInhalt.push(dok.pfad);
  assert.deepStrictEqual(mitInhalt.slice(0, 5), [], "Projekt-Wurzeldokument mit Inhalt im roh-Zweig");
});

test("die gerenderte Seite bleibt klein -- keine wiedereingebetteten Ruempfe (Riegel gegen E)", () => {
  // GRENZE, ausdruecklich: eine absolute Byte-Schranke haengt an der Zahl der
  // Dateien im Workspace. Sie ist hier bewusst GROSSZUEGIG (3 MB) -- sie faengt
  // nicht die letzten Kilobytes, sondern den Rueckfall: wer die Dateiruempfe
  // wieder einbettet, springt um Megabytes (die Vorfassung lag bei 6,6 MB).
  const html = renderHTML(d);
  const mb = Buffer.byteLength(html) / (1024 * 1024);
  assert.ok(mb < 3, "die Seite ist " + mb.toFixed(2) + " MB gross -- steht wieder Dateiinhalt drin?");
});

test("die Wortliste der Seite ist die aus labels.js -- kein zweiter Bestand", () => {
  // Wenn data.js eigene Woerter mitgibt, gibt es zwei Orte fuer dieselbe
  // Beschriftung, und einer davon veraltet.
  for (const [k, v] of Object.entries(d.worte)) {
    assert.ok(k in UI, "das Wort '" + k + "' steht im Datensatz, aber nicht in labels.js");
    assert.strictEqual(v, UI[k], "das Wort '" + k + "' weicht von labels.js ab");
  }
});

test("die Seitenliste des Datensatzes deckt sich mit labels.js", () => {
  assert.deepStrictEqual(Object.keys(d.seiten).sort(), Object.keys(SEITEN).sort(), "Seiten in labels.js und im Datensatz weichen ab");
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

// ---------------------------------------------------------------------------
// Die beiden Module, die am 23.08.2026 aus data.js herausgeloest wurden
// ---------------------------------------------------------------------------

test("views.js liefert alle neun Seitenbauer als Funktion", () => {
  const erwartet = [
    "dateiEintraege", "hookEintraege", "ausInventar", "zuTunEintraege",
    "kontextEintraege", "projektEintraege", "backupEintraege", "commitEintraege",
    "werkzeugEintraege",
  ];
  assert.deepStrictEqual(Object.keys(SEITENBAUER).sort(), erwartet.slice().sort());
  for (const n of erwartet) assert.strictEqual(typeof SEITENBAUER[n], "function", n);
});

test("helpers.js liefert die fuenf gemeinsamen Helfer", () => {
  for (const n of ["feld", "felderVon", "spracheVon", "beschreibungVon", "inhaltVon"]) {
    assert.strictEqual(typeof HELFER[n], "function", n);
  }
});

test("feld() laesst eine leere Zeile weg statt einen Strich zu zeigen", () => {
  // Eine Eigenschaften-Zeile mit "-" ist keine Auskunft, sondern Fuellmaterial.
  assert.strictEqual(HELFER.feld("Label", null), null);
  assert.strictEqual(HELFER.feld("Label", undefined), null);
  assert.strictEqual(HELFER.feld("Label", ""), null);
  // Die Null ist eine Zahl, kein Nichts.
  assert.deepStrictEqual(HELFER.feld("Label", 0), { label: "Label", wert: "0" });
  assert.deepStrictEqual(HELFER.feld("L", "x", { mono: true }), { label: "L", wert: "x", mono: true });
});

test("projektEintraege liefert ohne Projekte eine leere Liste, keine Ausnahme", () => {
  assert.deepStrictEqual(SEITENBAUER.projektEintraege({}, { fuer: () => [] }), []);
  assert.deepStrictEqual(SEITENBAUER.projektEintraege({ projekte: { liste: [] } }, { fuer: () => [] }), []);
});
