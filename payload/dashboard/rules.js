#!/usr/bin/env node
// REGELN ZIEHEN — der Teil, der die Seite von einer Liste unterscheidet.
//
// Zu jedem Bereich gehoert nicht nur WAS da ist, sondern die REGEL, die dafuer
// gilt. Die Regel wird NICHT hier abgetippt, sondern aus ihrer Quelldatei
// GEZOGEN — sonst entstuende genau der Zustand, den das README des Bausatzes
// verbietet: zwei Kopien, die auseinanderlaufen, und ein Pruefer, der nur eine
// davon bewacht.
//
// Jede Regel traegt drei Dinge:
//   quelle  — Datei + Zeile, an der sie steht (Anker, kein Nacherzaehlen)
//   inhalt  — der gezogene Wortlaut, unveraendert
//   befehl  — wie man sie aendert
//
// FINDET DER ZUG NICHTS, ist das Ergebnis "unlesbar" mit Grund — nie eine leere
// Regel und nie eine aus dem Gedaechtnis ergaenzte. Eine erfundene Regel auf
// einer Zustandsseite ist schaedlicher als eine fehlende, weil sie mit dem
// Anschein der Messung kommt.

const fs = require("fs");
const path = require("path");
// Dauer-Regeln werden ueber das FRONTMATTER erkannt (ohne = Dauer, mit = Abruf),
// ordner-agnostisch und rekursiv -- dieselbe Quelle der Wahrheit wie measure.js
// und file-inventory.js. Nicht mehr fest .claude/rules/keel bzw. eine [keel, common]-
// Kandidatenliste (die uebersah Regeln in eigenen Ordnern und zaehlte
// Frontmatter-Sprachpakete faelschlich als Dauer-Regel mit). [Review-Fund W]
const { dauerRegelDateien } = require("./classify");

const posix = (p) => String(p).split("\\").join("/").split(path.sep).join("/");

// Eine benannte Regeldatei irgendwo unter .claude/rules/ finden (rekursiv,
// ordner-agnostisch) -- nicht fest in keel/ oder common/. Gibt den rel. POSIX-
// Pfad zurueck oder null.
function regelDateiFinden(wurzel, name) {
  const start = path.join(wurzel, ".claude", "rules");
  let treffer = null;
  (function lauf(dir) {
    if (treffer) return;
    let eintraege;
    try {
      eintraege = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of eintraege.sort((a, b) => a.name.localeCompare(b.name))) {
      if (treffer) return;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) lauf(p);
      else if (e.name === name) treffer = p;
    }
  })(start);
  return treffer ? posix(path.relative(wurzel, treffer)) : null;
}

// ---------------------------------------------------------------------------
// Werkzeuge zum Ziehen
// ---------------------------------------------------------------------------
function lesen(wurzel, relPfad) {
  const p = path.join(wurzel, relPfad);
  if (!fs.existsSync(p)) return null;
  try {
    return fs.readFileSync(p, "utf8").split("\n");
  } catch {
    return null;
  }
}

// Zwei verschiedene Dinge, die frueher denselben Zustand trugen:
// - fehlt()    = sollte da sein, ist es nicht. Das ist ein Befund.
// - entfaellt()= gehoert gar nicht zu diesem Harness (Dokument der Ursprungs-Werkbank).
//   Das ist KEIN Befund. Beides "unlesbar" zu nennen hiess: die Uebersicht listete drei
//   bewusste Auslassungen unter "Braucht Aufmerksamkeit" -- und wer dreimal umsonst
//   hinsieht, sieht beim vierten Mal nicht mehr hin.
const entfaellt = (id, titel, quelle, grund) => ({
  id,
  titel,
  status: "entfaellt",
  grund,
  quelle: { datei: quelle, zeile: null },
  befehl: null,
});

const fehlt = (id, titel, quelle, grund, befehl) => ({
  id,
  titel,
  status: "unlesbar",
  grund,
  quelle: { datei: quelle, zeile: null },
  befehl: befehl || null,
});

// Eine Markdown-Tabelle ab der Kopfzeile, die alle genannten Spalten enthaelt.
//
// Der Trenner ist "|", ABER ein maskiertes \| gehoert zum Zellinhalt. In §2a
// steht genau so ein Fall: `low\|medium\|high\|xhigh`. Ein naiver split("|")
// zerlegt die max-Zeile in zu viele Zellen, die Zeile faellt aus der
// Spaltenpruefung -- und die Tabelle auf der Seite hat lautlos eine Stufe
// weniger, ohne dass irgendwo ein Fehler steht. Gemessen: 4 statt 5 Reihen.
function tabelleZiehen(zeilen, spalten) {
  const kopfIndex = zeilen.findIndex(
    (z) => z.startsWith("|") && spalten.every((s) => z.includes(s))
  );
  if (kopfIndex === -1) return null;
  const zellen = (z) =>
    z
      .split(/(?<!\\)\|/)
      .slice(1, -1)
      .map((c) => c.trim().replace(/\\\|/g, "|"));
  const kopf = zellen(zeilen[kopfIndex]);
  const reihen = [];
  const uebersprungen = [];
  for (let i = kopfIndex + 2; i < zeilen.length; i++) {
    if (!zeilen[i].startsWith("|")) break;
    const r = zellen(zeilen[i]);
    // Eine Zeile mit abweichender Zellenzahl wird NICHT stillschweigend
    // weggelassen -- sie wird mitgezaehlt und auf der Seite ausgewiesen.
    // Sonst verschwindet eine Regelzeile spurlos, so wie es die maskierten
    // Pipes einmal getan haben.
    if (r.length !== kopf.length) {
      uebersprungen.push({ zeile: i + 1, zellen: r.length, erwartet: kopf.length });
      continue;
    }
    reihen.push(r);
  }
  return reihen.length ? { zeile: kopfIndex + 1, kopf, reihen, uebersprungen } : null;
}

// Erste Zeile, die ein Muster trifft — samt Zeilennummer.
function zeileZiehen(zeilen, muster) {
  const i = zeilen.findIndex((z) => muster.test(z));
  return i === -1 ? null : { zeile: i + 1, text: zeilen[i].trim() };
}

// REGEL 1–3 (Denkbudget/Effort, Wächterkanon, Modellwahl) ENTFERNT am
// 25.08.2026 [Owner: "tief entkernen"]. Sie zogen aus Dateien der
// Ursprungs-Werkbank (docs/13-arbeitsweise-standard.md, konfig/routing-policy.json),
// die es in diesem Harness nicht gibt -- gemeldet wurden sie nur, um sie als
// "Nicht Teil dieses Harness" durchzustreichen. Die hier geltende Arbeitsweise
// steht in den Dauer-Regeln (REGEL 4).

// ---------------------------------------------------------------------------
// REGEL 4 — die Dauer-Regeln: was in JEDER Sitzung geladen wird
// ---------------------------------------------------------------------------
function dauerRegeln(wurzel) {
  const rulesDir = path.join(wurzel, ".claude", "rules");
  // Alle Regel-.md OHNE Frontmatter, in JEDEM Unterordner (keel, common, eigen).
  const dateien = dauerRegelDateien(rulesDir);
  if (!dateien.length) {
    return fehlt("dauerregeln", "Dauer-Regeln (jede Sitzung)", ".claude/rules/", "keine Dauer-Regel (Markdown ohne Frontmatter) unter .claude/rules/ gefunden", "$EDITOR .claude/rules/");
  }

  const eintraege = [];
  for (const abs of dateien) {
    const name = path.basename(abs);
    const rel = posix(path.relative(wurzel, abs));
    const zeilen = fs.readFileSync(abs, "utf8").split("\n");
    const titel = (zeilen.find((z) => z.startsWith("# ")) || `# ${name}`).slice(2).trim();
    // Der Kern: der erste Absatz nach der ersten ##-Überschrift, sonst die
    // ersten Aufzählungspunkte. Beides gezogen, nichts formuliert.
    const abIndex = zeilen.findIndex((z) => z.startsWith("## "));
    const rest = abIndex === -1 ? zeilen : zeilen.slice(abIndex + 1);
    const kern = rest
      .filter((z) => /^(- |\d+\. |\*\*)/.test(z.trim()) && z.trim().length > 12)
      .slice(0, 3)
      .map((z) => z.trim());
    eintraege.push({
      datei: rel,
      titel,
      zeilen: zeilen.length,
      abschnitt: abIndex === -1 ? null : zeilen[abIndex].replace(/^#+\s*/, ""),
      kern,
      befehl: `$EDITOR ${rel}`,
    });
  }

  if (!eintraege.length) {
    return fehlt("dauerregeln", "Dauer-Regeln (jede Sitzung)", ".claude/rules/", "keine lesbare Dauer-Regel gefunden", "$EDITOR .claude/rules/");
  }

  return {
    id: "dauerregeln",
    titel: "Dauer-Regeln — in jeder Sitzung geladen",
    status: "gezogen",
    quelle: { datei: ".claude/rules/", zeile: null },
    befehl: "$EDITOR .claude/rules/<datei>.md",
    art: "regelliste",
    eintraege,
    abgrenzung: `Alle ${eintraege.length} Dauer-Regeln (Markdown ohne Frontmatter) unter .claude/rules/.`,
  };
}

// ---------------------------------------------------------------------------
// REGEL 5 — Werkzeug-Rangfolge (CLI vor MCP vor Browser)
// ---------------------------------------------------------------------------
function werkzeugrang(wurzel) {
  const relPfad = regelDateiFinden(wurzel, "tools.md");
  const befehl = `$EDITOR ${relPfad || ".claude/rules/…/tools.md"}`;
  if (!relPfad) return fehlt("werkzeugrang", "Werkzeug-Beschaffung", ".claude/rules/", "tools.md unter .claude/rules/ nicht gefunden", befehl);

  const zeilen = lesen(wurzel, relPfad);
  // Wortlaut der aktuellen tools.md: "**CLI vor MCP vor Browser**". Der frueher
  // gesuchte "CLI → 2. MCP → 3."-Anker stammte aus einer alten Fassung und traf
  // nach der Neuschrift nichts mehr -- die Regel stand da, das Dashboard meldete
  // sie trotzdem als "Nicht lesbar" (25.08.2026 behoben).
  const rang = zeileZiehen(zeilen, /CLI vor MCP vor Browser/);
  const bestand = zeileZiehen(zeilen, /Fehlt ein Werkzeug/);
  if (!rang) return fehlt("werkzeugrang", "Werkzeug-Beschaffung", relPfad, "Rangfolge-Zeile nicht gefunden", befehl);

  return {
    id: "werkzeugrang",
    titel: "Werkzeug-Beschaffung — CLI vor MCP vor Browser",
    status: "gezogen",
    quelle: { datei: relPfad, zeile: rang.zeile },
    befehl,
    art: "saetze",
    saetze: [rang, bestand].filter(Boolean).map((s) => ({ text: s.text, zeile: s.zeile })),
  };
}

// ---------------------------------------------------------------------------
// REGEL 6 — Sicherung: pathspec-Pflicht + das passende Prüfkommando
// ---------------------------------------------------------------------------
function sicherungsregel(wurzel) {
  const DATEI = "CLAUDE.md";
  // Kein fester Abschnitts-Verweis (den gibt es nur in DIESER CLAUDE.md) -- die
  // Regel wird ohnehin inhaltsbasiert gezogen, nicht ueber eine Abschnittsnummer.
  const befehl = `$EDITOR ${DATEI}   # Konventionen zum Sichern`;
  const zeilen = lesen(wurzel, DATEI);
  if (!zeilen) return fehlt("sicherung", "Sichern im geteilten Arbeitsbaum", DATEI, "CLAUDE.md nicht gefunden", befehl);

  // Wortlaut der aktuellen CLAUDE.md §3: "nur `git commit … -- <pfad>` (nie
  // `add`+`commit`, nie `-a`)". Der alte Anker "NIE `git add` + `git commit`"
  // traf das nach der Kurzfassung 24.08. nicht mehr -- die Regel stand da, das
  // Dashboard meldete "unvollstaendig gezogen" (25.08.2026 behoben).
  const anker = zeileZiehen(zeilen, /nie `add`\+`commit`/);
  // Ohne Zeilenanfangs-Anker: in der CLAUDE.md stehen die Befehle im Fliesstext
  // ("sondern `git commit ...`"), nicht als eigene Zeile. Mit dem alten Anker meldete
  // die Regel "unvollstaendig gezogen", obwohl beide Befehle dastanden.
  const committen = zeileZiehen(zeilen, /git commit -m .*--\s*<pfad>/);
  const pruefen = zeileZiehen(zeilen, /git diff HEAD\s+--\s*<pfad>/);
  if (!anker || !committen || !pruefen) {
    return fehlt(
      "sicherung",
      "Sichern im geteilten Arbeitsbaum",
      DATEI,
      `unvollständig gezogen (Anker ${anker ? "ja" : "nein"} · commit ${committen ? "ja" : "nein"} · prüfen ${pruefen ? "ja" : "nein"})`,
      befehl
    );
  }

  return {
    id: "sicherung",
    titel: "Sichern im geteilten Arbeitsbaum",
    status: "gezogen",
    quelle: { datei: DATEI, zeile: anker.zeile },
    befehl,
    art: "befehle",
    anker: anker.text,
    befehle: [
      { zweck: "committen", zeile: committen.zeile, code: committen.text },
      { zweck: "vorher prüfen — NICHT git diff --cached", zeile: pruefen.zeile, code: pruefen.text },
    ],
  };
}

// ---------------------------------------------------------------------------
// Zusammenführung: Bereich → Regel
// ---------------------------------------------------------------------------
const ZUORDNUNG = {
  bestand: ["werkzeugrang", "dauerregeln"],
  sicherung: ["sicherung"],
  pruefer: ["sicherung"],
  rollen: [],
};

function regeln(wurzel) {
  const alle = [
    dauerRegeln(wurzel),
    werkzeugrang(wurzel),
    sicherungsregel(wurzel),
  ];
  return {
    gezogenAm: new Date().toISOString(),
    liste: alle,
    zuordnung: ZUORDNUNG,
    unlesbar: alle.filter((r) => r.status === "unlesbar").length,
    entfaellt: alle.filter((r) => r.status === "entfaellt").length,
  };
}

module.exports = { regeln, tabelleZiehen, zeileZiehen };
