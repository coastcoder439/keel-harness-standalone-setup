// Test zur Ladeart von Rules -- Dauer-Regel vs. Abruf-Regel, Bordmittel node:test.
//
// WORUM ES GEHT (W1-W3 des Sanierungsplans)
// Das Dashboard gehoert zum Harness-Bausatz und laeuft in JEDER Installation.
// Frueher war "Dauer-Regel" fest an den Ordner .claude/rules/keel/ gebunden:
// die Kontext-Kosten wurden nur dort gesucht, alles unter .claude/rules/ galt
// als dauerhaft geladen, und die Ueberschrift nannte den Ordner beim Namen.
// In einem fremden Workspace mit Regeln unter rules/common/ oder mit abrufbaren
// Sprachpaketen war das falsch. Die ECHTE Eigenschaft ist das FRONTMATTER:
//   - ohne "---"  -> laedt in jeder Sitzung  -> rolle "dauer-regel", kostet Token
//   - mit  "---"  -> laedt auf Abruf         -> rolle "abruf-regel", kostet nicht
// Dieser Test haelt genau das fest, ordner-agnostisch.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { inventar } = require("../file-inventory.js");
const { messen } = require("../measure.js");
const { daten } = require("../render/data.js");

function baumBauen(dateien) {
  const w = fs.mkdtempSync(path.join(os.tmpdir(), "regeln-test-"));
  for (const [rel, inhalt] of Object.entries(dateien)) {
    const p = path.join(w, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, inhalt);
  }
  return w;
}

const DAUER = "# Dauerregel" + "\n\n" + "Gilt in jeder Sitzung, ohne Aufruf." + "\n";
const ABRUF = "---\ndescription: Ein Sprachpaket, das nur bei Bedarf laedt.\n---\n\n# Abrufregel\n\nNur bei Bedarf.\n";

test("Frontmatter entscheidet die rolle -- nicht der Ordnername (W3)", () => {
  const w = baumBauen({
    "CLAUDE.md": "# Test\n\nEin Testworkspace.\n",
    ".claude/rules/keel/dauer.md": DAUER,
    ".claude/rules/common/abruf.md": ABRUF,
    // Eine Dauer-Regel AUSSERHALB von keel/ -- muss trotzdem als Dauer gelten.
    ".claude/rules/eigen/immer.md": "# Immer\n\nGilt auch hier dauerhaft.\n",
  });
  try {
    const inv = inventar(w);
    const rolleVon = (p) => (inv.dateien.find((d) => d.pfad === p) || {}).rolle;
    assert.strictEqual(rolleVon(".claude/rules/keel/dauer.md"), "dauer-regel");
    assert.strictEqual(rolleVon(".claude/rules/common/abruf.md"), "abruf-regel");
    assert.strictEqual(rolleVon(".claude/rules/eigen/immer.md"), "dauer-regel", "eine no-Frontmatter-Regel ausserhalb keel/ ist trotzdem Dauer");
  } finally {
    fs.rmSync(w, { recursive: true, force: true });
  }
});

test("nur Dauer-Regeln zaehlen zum Sitzungskontext -- ordner-agnostisch (W1)", () => {
  const w = baumBauen({
    "CLAUDE.md": "# Test\n\nEin Testworkspace.\n",
    ".claude/rules/keel/dauer.md": DAUER,
    ".claude/rules/common/abruf.md": ABRUF,
    ".claude/rules/eigen/immer.md": "# Immer\n\nGilt auch hier dauerhaft.\n",
  });
  try {
    const m = messen({ wurzel: w });
    const pfade = (m.bereiche.kontext.stuecke || []).map((s) => s.pfad);
    assert.ok(pfade.includes(".claude/rules/keel/dauer.md"), "Dauer-Regel in keel/ fehlt im Kontext");
    assert.ok(pfade.includes(".claude/rules/eigen/immer.md"), "Dauer-Regel ausserhalb keel/ fehlt im Kontext");
    assert.ok(!pfade.includes(".claude/rules/common/abruf.md"), "Abruf-Regel darf NICHT im Dauer-Kontext stehen");
  } finally {
    fs.rmSync(w, { recursive: true, force: true });
  }
});

test("die Rules-Seite zeigt Dauer- UND Abruf-Regeln; Token zaehlen nur Dauer", () => {
  const w = baumBauen({
    "CLAUDE.md": "# Test\n\nEin Testworkspace.\n",
    ".claude/rules/keel/dauer.md": DAUER,
    ".claude/rules/common/abruf.md": ABRUF,
  });
  try {
    const d = daten(messen({ wurzel: w }));
    const rulesSeite = d.eintraege.filter((e) => e.seite === "rules").map((e) => e.pfad);
    assert.ok(rulesSeite.includes(".claude/rules/keel/dauer.md"), "Dauer-Regel fehlt auf der Rules-Seite");
    assert.ok(rulesSeite.includes(".claude/rules/common/abruf.md"), "Abruf-Regel fehlt auf der Rules-Seite");
    assert.strictEqual(d.zahlen.rules, 2, "beide Regeln muessen gezaehlt werden");
    assert.ok(d.zahlen.rulesToken > 0, "die Dauer-Regel muss Token beitragen");
    // Gegenprobe: die Abruf-Regel darf die Token-Zahl nicht aufblaehen -- sie
    // zaehlt nur die Dauer-Regel. Ein sehr grosser Abruf-Wert wuerde das zeigen.
    const nurDauerBytes = fs.statSync(path.join(w, ".claude/rules/keel/dauer.md")).size;
    assert.ok(d.zahlen.rulesToken <= Math.ceil(nurDauerBytes / 3.6) + 1, "rulesToken zaehlt mehr als die Dauer-Regel");
  } finally {
    fs.rmSync(w, { recursive: true, force: true });
  }
});
