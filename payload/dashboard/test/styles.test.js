// TEST zu render/styles.js -- misst nach, statt zu glauben.
//
// Der Test wiederholt KEINE Zahl aus dem Stylesheet. Die Chip-Prozente kommen
// aus TOKENS, die Farben kommen aus TOKENS, die Regeln kommen aus css. Wer im
// Modul einen Anteil aendert, aendert damit auch das, wogegen geprueft wird --
// und faellt durch, sobald der Kontrast nicht mehr traegt.

const test = require("node:test");
const assert = require("node:assert");
const { css, TOKENS, oklchZuRgb, kontrast } = require("../render/styles.js");
// Ausgelagerte Flaechen-Bloecke (25.08.2026: 800-Zeilen-Grenze) -- direkt
// geladen, damit die Vollstaendigkeits-Pruefung das Modul als getestet sieht,
// und unten per Gegenprobe im zusammengesetzten css verankert.
const STYLES_EXTRA = require("../render/styles-extra.js");

const TEXT_MINDEST = 4.5; // WCAG AA, Fliesstext

test("die ausgelagerten Flaechen-Bloecke stehen im zusammengesetzten Stylesheet", () => {
  for (const [name, block] of Object.entries(STYLES_EXTRA)) {
    assert.ok(typeof block === "string" && block.length > 200, name + " ist kein CSS-Block");
    assert.ok(css.includes(block), name + " fehlt im zusammengesetzten css");
  }
});
const MARKE_MINDEST = 3.0; // WCAG 1.4.11, Glyphen und bedeutungstragende Raender

// --- Hilfen: color-mix(in srgb, ...) nachrechnen -------------------------------
// CSS mischt "in srgb" auf den gamma-kodierten Werten; "transparent" heisst
// premultipliziert: die Farbe bleibt, der Alphawert wird zum Anteil.
const WEISS = { r: 255, g: 255, b: 255 };
const SCHWARZ = { r: 0, g: 0, b: 0 };

function mischen(a, b, anteil) {
  return {
    r: Math.round(anteil * a.r + (1 - anteil) * b.r),
    g: Math.round(anteil * a.g + (1 - anteil) * b.g),
    b: Math.round(anteil * a.b + (1 - anteil) * b.b)
  };
}

// Ein color-mix mit Basis-Schluesselwort, aufgeloest ueber der echten Flaeche.
function mixMitBasis(farbe, basis, anteil, flaeche) {
  if (basis === "white") return mischen(farbe, WEISS, anteil);
  if (basis === "black") return mischen(farbe, SCHWARZ, anteil);
  if (basis === "transparent") return mischen(farbe, flaeche, anteil);
  throw new Error("mixMitBasis: unbekannte Basis " + basis);
}

// Halbdurchsichtige Token (--border, --input) ueber einer Flaeche zusammensetzen.
function ueberFlaeche(wert, flaeche) {
  const alpha = String(wert).match(/\/\s*([0-9.]+)\s*\)/);
  const farbe = oklchZuRgb(wert);
  return alpha ? mischen(farbe, flaeche, parseFloat(alpha[1])) : farbe;
}

function anteilVon(thema, name) {
  const roh = TOKENS[thema][name];
  assert.ok(/^[0-9.]+%$/.test(roh), name + " in " + thema + " ist kein Prozentwert: " + roh);
  return parseFloat(roh) / 100;
}

// Die drei Chip-Flaechen eines Status auf einer bestimmten Untergrundflaeche.
function chipFarben(thema, status, flaeche) {
  const t = TOKENS[thema];
  const sc = oklchZuRgb(t["--status-" + status]);
  return {
    fuellung: mixMitBasis(sc, t["--chip-fuell-basis"], anteilVon(thema, "--chip-fuell-anteil"), flaeche),
    text: mixMitBasis(sc, t["--chip-text-basis"], anteilVon(thema, "--chip-text-anteil"), flaeche),
    rand: mixMitBasis(sc, t["--chip-rand-basis"], anteilVon(thema, "--chip-rand-anteil"), flaeche)
  };
}

const THEMEN = ["hell", "dunkel"];
const STATUS = ["ok", "hinweis", "fehler", "fehlt", "unlesbar"];
// Chips und Glyphen sitzen auf genau diesen beiden Flaechen: der Seite und der
// Karte/Detail-Spalte. Beide werden geprueft, die schlechtere entscheidet.
const FLAECHEN = ["--background", "--card"];

function tokenRgb(thema, name) {
  return oklchZuRgb(TOKENS[thema][name]);
}

function pruefe(ist, mindest, was) {
  assert.ok(
    ist >= mindest,
    was + ": " + ist.toFixed(2) + ":1 -- gefordert sind " + mindest + ":1"
  );
}

// --- 1. Die Farbmathematik selbst ---------------------------------------------

test("oklchZuRgb trifft bekannte Werte", () => {
  assert.deepStrictEqual(oklchZuRgb("oklch(1 0 0)"), { r: 255, g: 255, b: 255 }, "Weiss");
  assert.deepStrictEqual(oklchZuRgb("oklch(0 0 0)"), { r: 0, g: 0, b: 0 }, "Schwarz");
  assert.deepStrictEqual(oklchZuRgb("oklch(0.62796 0.25768 29.234)"), { r: 255, g: 0, b: 0 }, "sRGB-Rot");
  assert.deepStrictEqual(oklchZuRgb("oklch(0.86644 0.29483 142.4953)"), { r: 0, g: 255, b: 0 }, "sRGB-Gruen");
  assert.deepStrictEqual(oklchZuRgb("oklch(0.45201 0.31321 264.052)"), { r: 0, g: 0, b: 255 }, "sRGB-Blau");
});

test("oklchZuRgb liest Prozent-Helligkeit und ignoriert den Alphaanteil", () => {
  assert.deepStrictEqual(oklchZuRgb("oklch(100% 0 0)"), { r: 255, g: 255, b: 255 });
  assert.deepStrictEqual(
    oklchZuRgb("oklch(0.28 0.03 230 / 0.22)"),
    oklchZuRgb("oklch(0.28 0.03 230)"),
    "Alpha gehoert in die Zusammensetzung, nicht in die Umrechnung"
  );
});

test("oklchZuRgb schluckt einen Fehlschlag nicht", () => {
  assert.throws(() => oklchZuRgb("rgb(1,2,3)"), /kein oklch/);
  assert.throws(() => oklchZuRgb(""), /kein oklch/);
});

test("kontrast rechnet nach WCAG", () => {
  assert.strictEqual(kontrast({ r: 255, g: 255, b: 255 }, { r: 0, g: 0, b: 0 }), 21);
  assert.strictEqual(kontrast({ r: 17, g: 17, b: 17 }, { r: 17, g: 17, b: 17 }), 1);
  assert.strictEqual(
    kontrast({ r: 255, g: 255, b: 255 }, { r: 0, g: 0, b: 0 }),
    kontrast({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }),
    "Reihenfolge darf nichts aendern"
  );
  assert.throws(() => kontrast({ r: 0, g: 0 }, WEISS), /kein \{r,g,b\}/);
});

// --- 2. Die Token-Tabelle ------------------------------------------------------

test("beide Themen tragen denselben Tokensatz, inklusive der geforderten Namen", () => {
  assert.deepStrictEqual(
    Object.keys(TOKENS.hell).sort(),
    Object.keys(TOKENS.dunkel).sort(),
    "ein Token nur in einem Thema ist ein Loch im Umschalter"
  );
  const pflicht = [
    "--background", "--foreground", "--card", "--card-foreground", "--popover",
    "--popover-foreground", "--primary", "--primary-foreground", "--secondary",
    "--secondary-foreground", "--muted", "--muted-foreground", "--accent",
    "--accent-foreground", "--border", "--input", "--ring", "--sidebar",
    "--sidebar-foreground", "--sidebar-primary", "--sidebar-primary-foreground",
    "--sidebar-accent", "--sidebar-accent-foreground", "--sidebar-border",
    "--sidebar-ring", "--chart-1", "--chart-2", "--chart-3", "--chart-4",
    "--chart-5", "--destructive", "--status-ok", "--status-hinweis",
    "--status-fehler", "--status-fehlt", "--status-unlesbar"
  ];
  for (const name of pflicht) {
    for (const thema of THEMEN) {
      assert.ok(TOKENS[thema][name], name + " fehlt in " + thema);
    }
  }
});

test("jeder Farbtoken ist ein lesbarer oklch-Wert", () => {
  for (const thema of THEMEN) {
    for (const [name, wert] of Object.entries(TOKENS[thema])) {
      if (name.startsWith("--chip-")) continue; // Anteile und Basis-Woerter
      assert.doesNotThrow(() => oklchZuRgb(wert), name + " in " + thema + ": " + wert);
    }
  }
});

// --- 3. Kontrast: Text auf Grund, beide Themen ---------------------------------

const TEXTPAARE = [
  ["--foreground", "--background"], ["--foreground", "--card"],
  ["--foreground", "--muted"], ["--foreground", "--popover"],
  ["--card-foreground", "--card"], ["--popover-foreground", "--popover"],
  ["--muted-foreground", "--background"], ["--muted-foreground", "--card"],
  ["--muted-foreground", "--muted"], ["--muted-foreground", "--secondary"],
  ["--muted-foreground", "--popover"], ["--muted-foreground", "--sidebar"],
  ["--primary-foreground", "--primary"], ["--secondary-foreground", "--secondary"],
  ["--accent-foreground", "--accent"], ["--sidebar-foreground", "--sidebar"],
  ["--sidebar-primary-foreground", "--sidebar-primary"],
  ["--sidebar-accent-foreground", "--sidebar-accent"]
];

for (const thema of THEMEN) {
  test("Kontrast " + thema + ": jeder Text auf seinem Grund mindestens 4,5:1", () => {
    for (const [text, grund] of TEXTPAARE) {
      pruefe(kontrast(tokenRgb(thema, text), tokenRgb(thema, grund)), TEXT_MINDEST,
        thema + " " + text + " auf " + grund);
    }
  });

  test("Kontrast " + thema + ": jeder Status-Chip-Text auf seinem Chip-Grund mindestens 4,5:1", () => {
    for (const status of STATUS) {
      for (const flaeche of FLAECHEN) {
        const c = chipFarben(thema, status, tokenRgb(thema, flaeche));
        pruefe(kontrast(c.text, c.fuellung), TEXT_MINDEST,
          thema + " Chip-Text " + status + " auf Chip ueber " + flaeche);
      }
    }
  });

  test("Kontrast " + thema + ": Glyphen und bedeutungstragende Raender mindestens 3:1", () => {
    for (const flaeche of FLAECHEN) {
      const grund = tokenRgb(thema, flaeche);
      // Freistehende Status-Glyphe (Baum, Karte) direkt auf der Flaeche.
      for (const status of STATUS) {
        pruefe(kontrast(tokenRgb(thema, "--status-" + status), grund), MARKE_MINDEST,
          thema + " Glyphe --status-" + status + " auf " + flaeche);
        // Chip-Rand gegen die eigene Fuellung -- die Kante des Chips.
        const c = chipFarben(thema, status, grund);
        pruefe(kontrast(c.rand, c.fuellung), MARKE_MINDEST,
          thema + " Chip-Rand " + status + " ueber " + flaeche);
      }
      // Fokusring (deckend, 3 px), Zahl-Badge und Balken nutzen --ring/--primary.
      pruefe(kontrast(tokenRgb(thema, "--ring"), grund), MARKE_MINDEST, thema + " --ring auf " + flaeche);
      pruefe(kontrast(tokenRgb(thema, "--primary"), grund), MARKE_MINDEST, thema + " --primary auf " + flaeche);
      // --destructive faerbt nur Rand und Fuellung des Fehlerkastens, nie Text.
      pruefe(kontrast(tokenRgb(thema, "--destructive"), grund), MARKE_MINDEST,
        thema + " --destructive als Kastenrand auf " + flaeche);
    }
    pruefe(kontrast(tokenRgb(thema, "--sidebar-ring"), tokenRgb(thema, "--sidebar")), MARKE_MINDEST,
      thema + " --sidebar-ring auf --sidebar");
  });
}

test("die dekorativen Haarstriche sind als solche belegt, nicht uebersehen", () => {
  // --border/--input/--sidebar-border tragen bewusst weniger als 3:1 (Paperclip
  // woertlich). Das ist zulaessig, weil keine Bedienung allein an ihnen haengt:
  // Fokus laeuft ueber den deckenden --ring, der Status ueber Chip und Glyphe.
  // Der Test haelt die gemessene Spanne fest, damit eine Palettenaenderung diese
  // Entscheidung erzwingt statt sie stillschweigend zu verschieben.
  for (const thema of THEMEN) {
    for (const [strich, flaeche] of [["--border", "--background"], ["--border", "--card"],
      ["--input", "--card"], ["--sidebar-border", "--sidebar"]]) {
      const wert = kontrast(ueberFlaeche(TOKENS[thema][strich], tokenRgb(thema, flaeche)),
        tokenRgb(thema, flaeche));
      assert.ok(wert > 1.15 && wert < 2.2,
        thema + " " + strich + " auf " + flaeche + " liegt bei " + wert.toFixed(2)
        + ":1 und damit ausserhalb der belegten Spanne 1,15-2,2 fuer dekorative Striche");
    }
  }
});

// --- 4. Das Stylesheet selbst --------------------------------------------------

test("css ist ein nicht leerer String", () => {
  assert.strictEqual(typeof css, "string");
  assert.ok(css.length > 8000, "Laenge " + css.length);
});

test("keine rohe Schriftgroesse -- jede font-size zeigt auf ein Typo-Token", () => {
  const treffer = css.match(/font-size\s*:\s*[^;}]+/g) || [];
  assert.ok(treffer.length > 30, "zu wenige font-size-Deklarationen gefunden: " + treffer.length);
  for (const zeile of treffer) {
    const wert = zeile.split(":").slice(1).join(":").trim();
    assert.match(wert, /^var\(--text-[a-z0-9-]+\)$/,
      "rohe Schriftgroesse: " + zeile.trim());
  }
  // Die Leiter selbst darf und muss Pixel tragen -- sonst zeigen alle var() ins Leere.
  for (const name of ["--text-nano", "--text-micro", "--text-xs", "--text-compact",
    "--text-sm", "--text-md", "--text-base", "--text-2xl"]) {
    assert.match(css, new RegExp(name + ":\\d+px;"), name + " ist nicht als Pixelwert definiert");
  }
  // Die font-Kurzform koennte eine Groesse an den Token vorbeischmuggeln. Erlaubt
  // ist genau "font:inherit" -- das setzt keine eigene Groesse, sondern uebernimmt
  // die des Elternteils, und die kam aus einem Token. Jede andere Kurzform faellt.
  const kurzform = css.match(/(?:^|[;{\s])font\s*:\s*[^;}]+/g) || [];
  for (const zeile of kurzform) {
    const wert = zeile.split(":").slice(1).join(":").trim();
    assert.strictEqual(wert, "inherit", "font-Kurzform umgeht die Typo-Token: " + zeile.trim());
  }
});

test("keine Hex-Farbe im Stylesheet", () => {
  const hex = css.match(/#[0-9a-fA-F]{3,8}\b/g);
  assert.strictEqual(hex, null, "Hex gefunden: " + JSON.stringify(hex));
});

test("alle drei Themenbloecke sind da, damit der Umschalter beidseitig gewinnt", () => {
  assert.match(css, /:root\{/, "heller Grundblock");
  assert.match(css, /@media \(prefers-color-scheme:dark\)\{:root:not\(\[data-thema="hell"\]\)\{/,
    "Systemwunsch dunkel, ausser der Mensch hat hell gewaehlt");
  assert.match(css, /:root\[data-thema="dunkel"\]\{/, "ausdruecklich gewaehltes dunkel");
  for (const name of Object.keys(TOKENS.hell)) {
    const hell = new RegExp("\\" + name + ":" + escape_(TOKENS.hell[name]) + ";");
    const dunkel = new RegExp("\\" + name + ":" + escape_(TOKENS.dunkel[name]) + ";");
    assert.match(css, hell, name + " (hell) steht nicht im Stylesheet");
    assert.match(css, dunkel, name + " (dunkel) steht nicht im Stylesheet");
  }
  const dunkelBloecke = css.split(TOKENS.dunkel["--background"] + ";").length - 1;
  assert.ok(dunkelBloecke >= 2, "der dunkle Tokensatz muss in BEIDEN dunklen Bloecken stehen");
});

function escape_(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("die Chip-Formel steht genau einmal und liest die Anteil-Tokens", () => {
  const regeln = css.match(/\.status-chip\{[^}]*\}/g) || [];
  assert.strictEqual(regeln.length, 1, "die Formel darf sich nicht je Thema wiederholen");
  for (const teil of ["--chip-fuell-anteil", "--chip-fuell-basis", "--chip-text-anteil",
    "--chip-text-basis", "--chip-rand-anteil", "--chip-rand-basis"]) {
    assert.ok(regeln[0].includes(teil), "Chip-Formel nutzt " + teil + " nicht");
  }
  for (const status of STATUS) {
    assert.match(css, new RegExp("\\.status-" + status + "\\{--sc:var\\(--status-" + status + "\\)\\}"));
  }
});

test("die Paperclip-Rezepte haben je eine Klasse", () => {
  const rezepte = {
    EntityRow: ".eintrag-zeile{", PropertySection: ".eigenschaft-abschnitt{",
    PropertyRow: ".eigenschaft-zeile{", IssueGroupHeader: ".gruppen-kopf{",
    ResizableHandle: ".griff{", EmptyState: ".leerzustand{", MetricCard: ".kennzahl{",
    RelatedWork: ".verknuepft-zeile{", CopyText: ".kopieren{", FoldCurtain: ".vorhang{"
  };
  for (const [name, klasse] of Object.entries(rezepte)) {
    assert.ok(css.includes(klasse), name + " fehlt (" + klasse + ")");
  }
});

test("die Masse der Spezifikation stehen als Token im Stylesheet", () => {
  const masse = {
    "--seitenleiste": "240px", "--seitenleiste-rail": "64px", "--kopfzeile": "48px",
    "--detail-breite": "320px", "--baum-breite": "288px", "--board-spalte": "260px",
    "--board-rail": "52px", "--zeile-baum": "36px", "--zeile-eintrag": "44px",
    "--einzug-stufe": "24px", "--spalte-min": "96px", "--label-breite": "96px",
    "--ring-breite": "3px", "--radius": "8px", "--radius-md": "6.4px"
  };
  for (const [name, wert] of Object.entries(masse)) {
    assert.ok(css.includes(name + ":" + wert + ";"), name + " ist nicht " + wert);
  }
  assert.match(css, /padding-left:calc\(16px \+ var\(--einzug-stufe\) \* var\(--tiefe,0\) - 8px\)/,
    "Baum-Einrueckung 16+24*Tiefe-8 fehlt");
  assert.match(css, /\.leiste-nav\{[^}]*padding:8px 12px/, "Icon-Achse: nav padding-inline 12");
  assert.match(css, /\.nav-pille\{[^}]*margin-inline:4px;padding:6px 8px/, "Icon-Achse: 12+4+8 = 24");
});

test("die schmale Flaeche und der Rail sind geregelt", () => {
  assert.match(css, /@media \(max-width:767px\)/, "Sheet-Bruch unter 768 fehlt");
  assert.match(css, /height:85dvh/, "Bottom-Sheet 85dvh fehlt");
  assert.match(css, /body\[data-leiste="eingeklappt"\]\{grid-template-columns:var\(--seitenleiste-rail\)/,
    "Rail-Zustand fehlt");
  assert.match(css, /\.palette\{/, "Palette-Overlay fehlt");
  assert.match(css, /\.board-spalte\[data-leer="ja"\]\{/, "kollabierende Board-Spalte fehlt");
  assert.match(css, /\.code-rinne\{/, "Zeilennummern-Rinne fehlt");
});
