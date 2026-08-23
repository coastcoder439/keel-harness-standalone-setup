// Test zu render/icons.js -- node --test dashboard/test/icons.test.js
//
// Geprueft wird die Zusage aus Abschnitt 8: 24er Kasten, stroke-width 1.75,
// currentColor, 16 px, aria-hidden -- und die Ehrlichkeits-Regel: ein unbekannter
// Name liefert ein neutrales Symbol UND wird vermerkt, statt still zu verschwinden.

const test = require("node:test");
const assert = require("node:assert");

const { icon, NAMEN, unbekannteAufrufe } = require("../render/icons.js");

// Der Satz aus Abschnitt 8 der Spezifikation, woertlich.
const SATZ_ABSCHNITT_8 = [
  "PanelLeftClose", "PanelLeftOpen", "Search", "Command", "Sun", "Moon", "Monitor",
  "Folder", "FolderOpen", "FileText", "FileCode2", "File", "GitBranch",
  "ChevronRight", "ChevronDown", "Copy", "Check", "X", "Maximize2", "Minimize2",
  "ExternalLink", "Eye", "Code", "List", "SquareKanban", "CircleCheck", "CircleDot",
  "CircleX", "CircleDashed", "CircleMinus", "Ban", "Terminal", "Slash", "Sparkles",
  "BookOpen", "Layers", "Wrench", "HardDrive", "GitCommit", "ListChecks",
  "LayoutDashboard", "Braces", "Link",
];

test("jeder Name aus NAMEN liefert ein svg mit viewBox und stroke-width 1.75", () => {
  assert.ok(NAMEN.length >= SATZ_ABSCHNITT_8.length, "NAMEN ist kleiner als der Satz aus Abschnitt 8");
  for (const name of NAMEN) {
    const html = icon(name);
    assert.match(html, /^<svg /, name + ": kein svg");
    assert.match(html, /viewBox="0 0 24 24"/, name + ": kein 24er viewBox");
    assert.match(html, /stroke-width="1\.75"/, name + ": falsche Strichstaerke");
    assert.match(html, /stroke="currentColor"/, name + ": nicht currentColor");
    assert.match(html, /aria-hidden="true"/, name + ": kein aria-hidden");
    assert.match(html, /width="16" height="16"/, name + ": nicht 16 px");
    assert.ok(html.endsWith("</svg>"), name + ": svg nicht geschlossen");
    // Kein leeres Symbol: zwischen Huelle und Ende steht mindestens eine Form.
    const innen = html.slice(html.indexOf(">") + 1, html.length - "</svg>".length);
    assert.ok(/<(path|circle|rect)\b/.test(innen), name + ": leeres Symbol");
    assert.ok(innen.length > 20, name + ": Form verdaechtig kurz");
  }
});

test("der Satz aus Abschnitt 8 ist vollstaendig vorhanden", () => {
  const fehlen = SATZ_ABSCHNITT_8.filter((n) => NAMEN.indexOf(n) === -1);
  assert.deepStrictEqual(fehlen, [], "fehlende Namen: " + fehlen.join(", "));
});

test("ein unbekannter Name liefert ein Fallback und wird vermerkt", () => {
  const vorher = unbekannteAufrufe.length;
  const html = icon("GibtEsNichtXY");
  assert.match(html, /^<svg /);
  assert.match(html, /viewBox="0 0 24 24"/);
  assert.match(html, /stroke-width="1\.75"/);
  assert.match(html, /class="ic ic-unbekannt"/, "Fallback traegt keine eigene Klasse");
  assert.match(html, /<circle cx="12" cy="12" r="10"\/>/, "Fallback ist kein Kreis");
  assert.ok(unbekannteAufrufe.includes("GibtEsNichtXY"), "Name nicht vermerkt");
  assert.strictEqual(unbekannteAufrufe.length, vorher + 1);
  // zweiter Aufruf desselben Namens vermerkt nicht doppelt
  icon("GibtEsNichtXY");
  assert.strictEqual(unbekannteAufrufe.length, vorher + 1);
});

test("bekannte Namen erzeugen keinen Eintrag in unbekannteAufrufe", () => {
  const vorher = unbekannteAufrufe.length;
  for (const name of NAMEN) icon(name);
  assert.strictEqual(unbekannteAufrufe.length, vorher);
});

test("Schreibweise egal: PascalCase, kebab-case, klein", () => {
  const a = icon("CircleCheck");
  assert.strictEqual(icon("circle-check"), a);
  assert.strictEqual(icon("circlecheck"), a);
  assert.match(a, /class="ic ic-circle-check"/);
});

test("Groesse: Standard 16, Uebergabe wirkt, Unfug faellt auf 16 zurueck", () => {
  assert.match(icon("Folder"), /width="16" height="16"/);
  assert.match(icon("Folder", 40), /width="40" height="40"/);
  assert.match(icon("Folder", 12), /width="12" height="12"/);
  for (const unfug of ['24" onload="x', -5, 0, 1e9, NaN, null, undefined, {}]) {
    assert.match(icon("Folder", unfug), /width="16" height="16"/, "Groesse " + String(unfug));
  }
});

test("ein Fremdname landet nie in einem Attribut", () => {
  const html = icon('<img src=x onerror="alert(1)">');
  assert.ok(!html.includes("<img"), "Fremdtext im Ergebnis");
  assert.ok(!html.includes("onerror"), "Fremdtext im Ergebnis");
  assert.match(html, /class="ic ic-unbekannt"/);
  assert.ok(unbekannteAufrufe.includes('<img src=x onerror="alert(1)">'), "Name nicht vermerkt");
});

// Die Zusage "nie ein leeres oder falsches Symbol" laesst sich nicht ansehen,
// aber nachrechnen: jeden Pfad abfahren (absolute UND relative Befehle) und den
// umschriebenen Kasten pruefen. Bogen werden ueber ihre Endpunkte genaehert --
// die Schranke ist deshalb bewusst grob (> 4 Einheiten), sie faengt das
// Verrutschte und das Leere, nicht die Schoenheit.
const ARG_ZAHL = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

function pfadAbfahren(d, merken) {
  const teile = d.match(/[A-Za-z]|-?\d*\.?\d+/g) || [];
  let x = 0;
  let y = 0;
  let befehl = "M";
  let i = 0;
  while (i < teile.length) {
    if (/[A-Za-z]/.test(teile[i])) befehl = teile[i++];
    const gross = befehl.toUpperCase();
    const rel = befehl !== gross;
    const n = ARG_ZAHL[gross];
    assert.ok(n != null, "unbekannter Pfadbefehl: " + befehl);
    if (n === 0) continue;
    const a = teile.slice(i, i + n).map(Number);
    if (a.length < n) break;
    i += n;
    if (gross === "H") x = rel ? x + a[0] : a[0];
    else if (gross === "V") y = rel ? y + a[0] : a[0];
    else if (gross === "A") {
      x = rel ? x + a[5] : a[5];
      y = rel ? y + a[6] : a[6];
    } else {
      for (let p = 0; p + 1 < n; p += 2) merken(rel ? x + a[p] : a[p], rel ? y + a[p + 1] : a[p + 1]);
      x = rel ? x + a[n - 2] : a[n - 2];
      y = rel ? y + a[n - 1] : a[n - 1];
    }
    merken(x, y);
    if (gross === "M") befehl = rel ? "l" : "L";
  }
}

function kasten(svg) {
  const w = { minX: 1e9, minY: 1e9, maxX: -1e9, maxY: -1e9 };
  const merken = (px, py) => {
    w.minX = Math.min(w.minX, px);
    w.maxX = Math.max(w.maxX, px);
    w.minY = Math.min(w.minY, py);
    w.maxY = Math.max(w.maxY, py);
  };
  for (const m of svg.matchAll(/ d="([^"]+)"/g)) pfadAbfahren(m[1], merken);
  for (const m of svg.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"/g)) {
    merken(+m[1] - +m[3], +m[2] - +m[3]);
    merken(+m[1] + +m[3], +m[2] + +m[3]);
  }
  for (const m of svg.matchAll(/<rect width="([\d.]+)" height="([\d.]+)" x="([\d.]+)" y="([\d.]+)"/g)) {
    merken(+m[3], +m[4]);
    merken(+m[3] + +m[1], +m[4] + +m[2]);
  }
  return w;
}

test("jedes Symbol liegt im 24er Kasten und ist nicht entartet", () => {
  for (const name of NAMEN) {
    const w = kasten(icon(name));
    assert.ok(w.minX >= -0.5 && w.minY >= -0.5, name + ": ragt oben/links aus dem Kasten");
    assert.ok(w.maxX <= 24.5 && w.maxY <= 24.5, name + ": ragt unten/rechts aus dem Kasten");
    assert.ok(w.maxX - w.minX > 4, name + ": zu schmal (" + (w.maxX - w.minX).toFixed(1) + ")");
    assert.ok(w.maxY - w.minY > 4, name + ": zu flach (" + (w.maxY - w.minY).toFixed(1) + ")");
  }
});

test("NAMEN ist doppelfrei und die Klassen sind es auch", () => {
  assert.strictEqual(new Set(NAMEN).size, NAMEN.length, "doppelter Name");
  const klassen = NAMEN.map((n) => /class="ic (ic-[a-z0-9-]+)"/.exec(icon(n))[1]);
  assert.strictEqual(new Set(klassen).size, klassen.length, "doppelte Klasse");
});
