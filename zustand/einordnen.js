#!/usr/bin/env node
// EINORDNEN — die zwei Achsen, an denen die erste Fassung der Zustandsseite scheiterte.
//
// Sie zaehlte "67 Agenten, 280 Faehigkeiten, 96 Befehle" und nannte das den Harness.
// Das war der ECC-Fremdklon. Unser Eigenbau sind 16 Dateien. Und sie unterschied
// nicht, was in JEDER Sitzung Kontext kostet und was nur beim Aufruf.
//
// ACHSE 1 — HERKUNFT     eigenbau | mitgeliefert
// ACHSE 2 — LADEART      dauerhaft | abruf | schlafend
//
// Beide werden GEMESSEN, nicht gepflegt: Herkunft an .ecc-src/, Ladeart am Ort
// plus an der Hook-Verdrahtung in settings*.json. Eine gepflegte Liste waere nach
// dem ersten ECC-Update falsch, ohne dass es jemand merkt.
//
// Die Herkunfts-Regel ist NICHT neu erfunden: sie ist dieselbe wie in
// docs/workflows/eigenbau-ungesichert.js (dort geprueft und mit Kontrollprobe).
// Weicht eine der beiden ab, ist eine von beiden falsch — deshalb steht die
// Kontrollprobe hier ebenfalls drin und laeuft bei jedem Messlauf mit.

const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// ACHSE 1 — HERKUNFT
//
// .claude/<x>            ->  .ecc-src/<x>
// .claude/rules/ecc/<x>  ->  .ecc-src/rules/<x>      (ein Segment faellt weg)
//
// Existiert die Entsprechung in .ecc-src/ => mitgeliefert. Sonst Eigenbau.
// ---------------------------------------------------------------------------
function quellPfad(relZumHarness) {
  const teile = relZumHarness.split(path.sep);
  if (teile[0] === "rules" && teile[1] === "ecc") return path.join("rules", ...teile.slice(2));
  return path.join(...teile);
}

function herkunftBestimmen(wurzel, absPfad) {
  const harness = path.join(wurzel, ".claude");
  const quelle = path.join(wurzel, ".ecc-src");

  if (absPfad.startsWith(quelle + path.sep) || absPfad === quelle)
    return { herkunft: "mitgeliefert", beleg: "liegt in .ecc-src/ (Fremd-Klon)" };

  if (!absPfad.startsWith(harness + path.sep))
    return { herkunft: "eigenbau", beleg: "liegt ausserhalb von .claude/ — keine ECC-Entsprechung moeglich" };

  if (!fs.existsSync(quelle))
    return { herkunft: "unbekannt", beleg: ".ecc-src/ fehlt — ohne die Quelle ist Eigenbau nicht bestimmbar" };

  const rel = path.relative(harness, absPfad);
  const kandidat = path.join(quelle, quellPfad(rel));
  return fs.existsSync(kandidat)
    ? { herkunft: "mitgeliefert", beleg: `Entsprechung vorhanden: ${path.relative(wurzel, kandidat)}` }
    : { herkunft: "eigenbau", beleg: `keine Entsprechung in .ecc-src/ (gesucht: ${path.relative(wurzel, kandidat)})` };
}

// ---------------------------------------------------------------------------
// BELEGE, DIE BEIM EMPFAENGER NACHSCHLAGBAR SIND
//
// Hier stand fest verdrahtet: `Dauer-Regel -- CLAUDE.md §5: "common immer"`.
// Das ist die Abschnittsnummer der URSPRUNGS-Werkbank. Der Installer
// ueberschreibt eine vorhandene CLAUDE.md bewusst nicht -- beim Bestandsprojekt
// zeigte der Beleg damit auf einen Abschnitt, den es dort nicht gibt.
// Gemessen an einem frisch eingerichteten Ziel mit eigener CLAUDE.md ohne §5:
// 4x in zustand.json, ebenso oft in der HTML-Seite.
//
// Ein Beleg, der sich nicht nachschlagen laesst, ist schlimmer als keiner: er
// taeuscht Pruefbarkeit vor. Deshalb wird er GEMESSEN statt behauptet --
// steht die Zusage in der CLAUDE.md dieses Workspace, wird sie mit ihrer
// eigenen Ueberschrift zitiert; sonst folgt die Zuordnung aus dem ORT der
// Datei plus einer Eigenschaft der Datei selbst. Beides ist ohne fremdes
// Dokument nachpruefbar.
// ---------------------------------------------------------------------------

// Einmal je Lauf lesen, nicht je Posten (ladeartBestimmen laeuft mehrere
// hundert Mal). Schluessel ist der absolute Pfad, damit mehrere Wurzeln in
// einem Prozess sich nicht ins Gehege kommen.
const claudeMdSpeicher = new Map();

function claudeMdZeilen(wurzel) {
  const p = path.join(wurzel, "CLAUDE.md");
  if (!claudeMdSpeicher.has(p)) {
    let zeilen = null;
    try {
      zeilen = fs.readFileSync(p, "utf8").split("\n");
    } catch {
      zeilen = null; // fehlt oder unlesbar -- beides heisst: nicht zitierbar
    }
    claudeMdSpeicher.set(p, zeilen);
  }
  return claudeMdSpeicher.get(p);
}

// Anker statt Zeilennummer: eine Nummer altert beim ersten Edit, eine
// Ueberschrift laesst sich suchen. Der Wortlaut kommt mit, damit der Leser
// nicht erst die Datei oeffnen muss, um zu wissen, was dort zugesagt ist.
//
// Die Muster werden der Reihe nach probiert, GENAUESTES ZUERST. Beim ersten
// Versuch stand hier ein einziges Oder-Muster -- es fand in der eigenen
// Werkbank die richtige Ueberschrift, zitierte aber den falschen Satz daraus
// (irgendeine Zeile mit „rules/ecc/common“ statt der Zusage „common immer“).
// Ein Zitat, das die Behauptung nicht traegt, ist derselbe Fehler eine Stufe
// kleiner.
function claudeMdFundstelle(wurzel, muster) {
  const zeilen = claudeMdZeilen(wurzel);
  if (!zeilen) return null;
  const kette = Array.isArray(muster) ? muster : [muster];
  let i = -1;
  for (const m of kette) {
    i = zeilen.findIndex((z) => m.test(z));
    if (i >= 0) break;
  }
  if (i < 0) return null;
  let ueberschrift = null;
  for (let j = i; j >= 0; j--) {
    const m = zeilen[j].match(/^#{1,6}\s+(.*\S)\s*$/);
    if (m) {
      ueberschrift = m[1];
      break;
    }
  }
  const roh = zeilen[i].replace(/^[\s>*+-]+/, "").replace(/[*`]/g, "").trim();
  return { ueberschrift, wortlaut: roh.length > 90 ? roh.slice(0, 89) + "…" : roh, zeile: i + 1 };
}

const zitat = (f) =>
  f.ueberschrift
    ? `CLAUDE.md, Abschnitt „${f.ueberschrift}“: „${f.wortlaut}“`
    : `CLAUDE.md, Zeile ${f.zeile}: „${f.wortlaut}“`;

// Die Zusage, die rules/ecc/common/ zum Dauer-Kontext erklaert -- genauestes
// Muster zuerst. Zwei Formulierungen kennt dieser Bausatz: die der
// Ursprungs-Werkbank („common immer“) und die des erzeugten
// CLAUDE.md-Geruests („Automatisch geladene Regeln“). Findet keine davon
// etwas, bleibt der Orts-Beleg — falsch wird nichts, nur unschaerfer.
const ZUSAGE_DAUER = [
  /\bcommon\b[^\n]{0,40}\bimmer\b/i,
  /Automatisch geladene Regeln/i,
  /rules\/ecc\/common/i,
];
const ZUSAGE_SPRACHPAKET = [/Sprachpaket[^\n]{0,40}Dateityp/i, /Sprachpaket/i, /pro Dateityp/i];

// Der zweite, vom fremden Dokument unabhaengige Beleg: eine Regeldatei mit
// `---`-Kopf ist ein abrufbares Dokument, kein Dauer-Kontext. Dieselbe Zusage
// prueft der Paketbau (paketieren.mjs, Bauplan-Selbstpruefung b) -- hier wird
// sie gemessen, statt sie ein zweites Mal zu behaupten.
function hatFrontmatter(absPfad) {
  try {
    return fs.readFileSync(absPfad, "utf8").startsWith("---");
  } catch {
    return null; // nicht lesbar -> nichts behaupten
  }
}

function dauerRegelBeleg(wurzel, absPfad) {
  const ort =
    hatFrontmatter(absPfad) === false
      ? "Dauer-Regel — liegt in .claude/rules/ecc/common/ und hat kein Frontmatter (Dauer-Kontext statt Abruf)"
      : "Dauer-Regel — liegt in .claude/rules/ecc/common/";
  const f = claudeMdFundstelle(wurzel, ZUSAGE_DAUER);
  return f ? `${ort} · belegt in ${zitat(f)}` : `${ort} · keine Zusage dazu in der CLAUDE.md dieses Workspace`;
}

function sprachpaketBeleg(wurzel) {
  const grund = "Sprachpaket unter .claude/rules/, ausserhalb des Dauer-Regelsatzes common/ — laedt je nach bearbeitetem Dateityp";
  const f = claudeMdFundstelle(wurzel, ZUSAGE_SPRACHPAKET);
  return f ? `${grund} · belegt in ${zitat(f)}` : `${grund}, nicht dauerhaft`;
}

// ---------------------------------------------------------------------------
// ACHSE 2 — LADEART
//
// dauerhaft  laedt bei JEDEM Sitzungsstart          -> kostet immer
// abruf      Name+Zeile im Index, Rumpf beim Aufruf -> kostet wenig, dann viel
// schlafend  liegt da, wird in diesem Workspace nie geladen -> kostet nichts
//
// "dauerhaft" wird nicht geraten: entweder der Ort sagt es (CLAUDE.md, die
// Dauer-Regeln unter rules/ecc/common/) oder die Datei haengt in einem Hook.
// ---------------------------------------------------------------------------
function hookSkripte(wurzel) {
  const treffer = new Map();
  for (const name of ["settings.json", "settings.local.json"]) {
    const p = path.join(wurzel, ".claude", name);
    if (!fs.existsSync(p)) continue;
    let roh;
    try {
      roh = fs.readFileSync(p, "utf8");
    } catch {
      continue;
    }
    // Absichtlich am Rohtext: die Hook-Kommandozeilen sind Shell-Strings, in denen
    // der Skriptpfad steckt. Ein JSON-Durchlauf muesste jede Verschachtelung kennen;
    // der Dateiname genuegt und bleibt bei Formatwechseln stabil.
    for (const m of roh.matchAll(/([A-Za-z0-9_.-]+\.(?:js|mjs|cjs|sh|py))/g)) {
      if (!treffer.has(m[1])) treffer.set(m[1], name);
    }
  }
  return treffer;
}

// `grund` ist eine FUNKTION, keine Zeichenkette: der Beleg haengt an dem, was
// in diesem Workspace tatsaechlich steht, nicht an dem, was in der
// Ursprungs-Werkbank stand. `gegenprobe` darf die Einstufung zurueckziehen --
// eine Regeldatei mit Frontmatter liegt zwar am richtigen Ort, laedt aber nicht
// dauerhaft. Ohne sie stuende hier „dauerhaft“ neben einem Beleg, der das
// Gegenteil sagt.
const DAUERHAFT_ORTE = [
  {
    test: (r) => r === "CLAUDE.md",
    grund: () => "Wurzel-Kontext — laedt in jeder Sitzung (Claude Code liest CLAUDE.md beim Start)",
  },
  {
    test: (r) => r.startsWith(path.join(".claude", "rules", "ecc", "common") + path.sep) && r.endsWith(".md"),
    grund: dauerRegelBeleg,
    gegenprobe: (absPfad) =>
      hatFrontmatter(absPfad) === true
        ? "Regeldatei mit Frontmatter — der `---`-Kopf macht sie zum abrufbaren Dokument, sie laedt NICHT dauerhaft"
        : null,
  },
];

function ladeartBestimmen(wurzel, absPfad, hooks) {
  const rel = path.relative(wurzel, absPfad);
  const basis = path.basename(absPfad);

  if (rel.startsWith(".ecc-src" + path.sep))
    return { ladeart: "schlafend", beleg: ".ecc-src/ ist Update-Quelle, nicht Ladepfad" };

  for (const o of DAUERHAFT_ORTE) {
    if (!o.test(rel)) continue;
    const abweichung = o.gegenprobe ? o.gegenprobe(absPfad) : null;
    if (abweichung) return { ladeart: "abruf", beleg: abweichung };
    return { ladeart: "dauerhaft", beleg: o.grund(wurzel, absPfad) };
  }

  const inHook = hooks.get(basis);
  if (inHook) return { ladeart: "dauerhaft", beleg: `haengt in einem Hook (${inHook})` };

  if (rel.startsWith(path.join(".claude", "skills") + path.sep))
    return { ladeart: "abruf", beleg: "Skill — Beschreibung im Index, Rumpf erst beim Aufruf" };
  if (rel.startsWith(path.join(".claude", "agents") + path.sep))
    return { ladeart: "abruf", beleg: "Agent — Beschreibung im Index, Rumpf erst beim Start" };
  if (rel.startsWith(path.join(".claude", "commands") + path.sep))
    return { ladeart: "abruf", beleg: "Slash-Befehl — laedt beim Aufruf" };
  if (rel.startsWith(path.join(".claude", "rules") + path.sep))
    return { ladeart: "abruf", beleg: sprachpaketBeleg(wurzel) };

  return { ladeart: "abruf", beleg: "kein dauerhafter Ladepfad erkannt" };
}

// ---------------------------------------------------------------------------
// KONTROLLPROBE — zwei Faelle mit bekannter Antwort, bei jedem Lauf.
//
// Ohne sie wuerde ein kaputter .ecc-src/-Pfad ALLES zu "eigenbau" erklaeren und
// die Seite meldete stolz 400 Eigenbauten. Ein Messfehler, der wie ein Erfolg
// aussieht — dieselbe Falle wie in eigenbau-ungesichert.js.
// ---------------------------------------------------------------------------
function kontrollprobe(wurzel) {
  const faelle = [
    {
      name: "eigene Dauer-Regel gilt als Eigenbau",
      pfad: path.join(wurzel, ".claude", "rules", "ecc", "common", "vollstaendigkeit.md"),
      erwartet: "eigenbau",
    },
    {
      name: "fremde Sprachregel gilt als mitgeliefert",
      pfad: path.join(wurzel, ".claude", "rules", "ecc", "python", "testing.md"),
      erwartet: "mitgeliefert",
    },
  ];

  const ergebnisse = faelle.map((f) => {
    if (!fs.existsSync(f.pfad)) return { ...f, ergebnis: null, bestanden: null, hinweis: "Probedatei fehlt" };
    const { herkunft } = herkunftBestimmen(wurzel, f.pfad);
    return { ...f, ergebnis: herkunft, bestanden: herkunft === f.erwartet, hinweis: null };
  });

  const pruefbar = ergebnisse.filter((e) => e.bestanden !== null);
  return {
    bestanden: pruefbar.length > 0 && pruefbar.every((e) => e.bestanden),
    pruefbar: pruefbar.length,
    faelle: ergebnisse.map(({ name, erwartet, ergebnis, bestanden, hinweis }) => ({
      name,
      erwartet,
      ergebnis,
      bestanden,
      hinweis,
    })),
  };
}

// ---------------------------------------------------------------------------
// Sammelauswertung: eine Gruppe von Posten einordnen und zaehlen.
// ---------------------------------------------------------------------------
function gruppeEinordnen(wurzel, ordner, dateien, hooks) {
  const eingeordnet = dateien.map((d) => {
    const abs = path.isAbsolute(d) ? d : path.join(ordner, d);
    const h = herkunftBestimmen(wurzel, abs);
    const l = ladeartBestimmen(wurzel, abs, hooks);
    return { pfad: path.relative(wurzel, abs), herkunft: h.herkunft, herkunftBeleg: h.beleg, ladeart: l.ladeart, ladeartBeleg: l.beleg };
  });

  const zaehle = (feld) =>
    eingeordnet.reduce((a, e) => ({ ...a, [e[feld]]: (a[e[feld]] || 0) + 1 }), {});

  return { eintraege: eingeordnet, nachHerkunft: zaehle("herkunft"), nachLadeart: zaehle("ladeart") };
}

module.exports = {
  herkunftBestimmen,
  ladeartBestimmen,
  hookSkripte,
  kontrollprobe,
  gruppeEinordnen,
  quellPfad,
  // messen.js beschriftet dieselben Dateien im Kontext-Bereich und muss
  // denselben Beleg benutzen -- zwei Formulierungen fuer dieselbe Zuordnung
  // waeren ein Widerspruch auf einer Seite.
  dauerRegelBeleg,
  claudeMdFundstelle,
};
