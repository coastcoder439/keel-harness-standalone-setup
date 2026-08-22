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

// ---------------------------------------------------------------------------
// REGEL 1 — Denkbudget: die Effort-Stufen aus docs/13 §2a
// ---------------------------------------------------------------------------
const DOC13 = "docs/13-arbeitsweise-standard.md";

function effortStufen(wurzel) {
  const befehl = `$EDITOR ${DOC13}   # Abschnitt „2a · Modell- und Effort-Wahl“`;
  const zeilen = lesen(wurzel, DOC13);
  if (!zeilen) return entfaellt("effort", "Denkbudget je Aufgabenform", DOC13, "Gehoert zur Ursprungs-Werkbank: docs/13-arbeitsweise-standard.md wird von diesem Harness nicht mitgeliefert. Die hier geltende Arbeitsweise steht in .claude/rules/keel/working-method.md.", befehl);

  const t = tabelleZiehen(zeilen, ["Stufe", "Überspringen, wenn", "Aufsteigen, wenn"]);
  if (!t) {
    return fehlt("effort", "Denkbudget je Aufgabenform", DOC13, "Effort-Tabelle (Spalten Stufe/Überspringen/Aufsteigen) nicht gefunden", befehl);
  }
  const grundsatz = zeileZiehen(zeilen, /Aufsteigen nur auf Beleg/);

  return {
    id: "effort",
    titel: "Denkbudget je Aufgabenform",
    status: "gezogen",
    quelle: { datei: DOC13, zeile: t.zeile },
    befehl,
    art: "tabelle",
    kopf: t.kopf,
    reihen: t.reihen,
    uebersprungen: t.uebersprungen,
    grundsatz: grundsatz ? { text: grundsatz.text, zeile: grundsatz.zeile } : null,
  };
}

// ---------------------------------------------------------------------------
// REGEL 2 — Wächterkanon aus docs/13 §3
// ---------------------------------------------------------------------------
function waechterkanon(wurzel) {
  const befehl = `$EDITOR .claude/settings.local.json   # hooks.PreToolUse / hooks.Stop / hooks.SessionStart`;
  const zeilen = lesen(wurzel, DOC13);
  if (!zeilen) return entfaellt("waechterkanon", "Was ein Wächter tun darf", DOC13, "Gehoert zur Ursprungs-Werkbank: docs/13-arbeitsweise-standard.md wird von diesem Harness nicht mitgeliefert. Was hier verdrahtet ist, misst der Bereich „Wächter“.", befehl);

  const t = tabelleZiehen(zeilen, ["Werkzeug", "Zweck", "Ort / Schalter"]);
  if (!t) return fehlt("waechterkanon", "Was ein Wächter tun darf", DOC13, "Werkzeugkanon-Tabelle nicht gefunden", befehl);

  return {
    id: "waechterkanon",
    titel: "Werkzeugkanon — was live verdrahtet ist",
    status: "gezogen",
    quelle: { datei: DOC13, zeile: t.zeile },
    befehl,
    art: "tabelle",
    kopf: t.kopf,
    reihen: t.reihen,
    uebersprungen: t.uebersprungen,
  };
}

// ---------------------------------------------------------------------------
// REGEL 3 — Modellwahl je Aufgabentyp (routing-policy.json)
// ---------------------------------------------------------------------------
const POLICY = "konfig/routing-policy.json";

function modellwahl(wurzel) {
  const befehl = `$EDITOR ${POLICY}`;
  const p = path.join(wurzel, POLICY);
  if (!fs.existsSync(p)) return entfaellt("modellwahl", "Modellwahl je Aufgabentyp", POLICY, "Gehoert zur Ursprungs-Werkbank: konfig/routing-policy.json wird von diesem Harness nicht mitgeliefert.", befehl);
  let policy;
  try {
    policy = JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    return fehlt("modellwahl", "Modellwahl je Aufgabentyp", POLICY, `Policy ist kein gültiges JSON: ${e.message}`, befehl);
  }
  const typen = Object.entries(policy.aufgabentypen || {});
  if (!typen.length) return fehlt("modellwahl", "Modellwahl je Aufgabentyp", POLICY, "keine Aufgabentypen in der Policy", befehl);

  return {
    id: "modellwahl",
    titel: "Modellwahl je Aufgabentyp",
    status: "gezogen",
    quelle: { datei: POLICY, zeile: null },
    befehl,
    art: "tabelle",
    kopf: ["Aufgabentyp", "wofür", "Mensch — erste Wahl", "Agent — erste Wahl"],
    reihen: typen.map(([name, t]) => [
      name,
      t.beschreibung || "",
      (t.mensch || [])[0] || "—",
      (t.agent || [])[0] || "—",
    ]),
    hinweis: String(policy._kommentar || "").split(".")[0] + ".",
    vorgabe: `${policy.default_aufgabentyp} / ${policy.default_aufrufer}`,
  };
}

// ---------------------------------------------------------------------------
// REGEL 4 — die Dauer-Regeln: was in JEDER Sitzung geladen wird
//
// Welche das sind, wird nicht behauptet, sondern bestimmt: Was es in .ecc-src/
// gibt, ist Fremd-Klon. Was es dort NICHT gibt, ist Eigenbau — dieselbe
// Unterscheidung wie in eigenbau-ungesichert.js, und aus demselben Grund.
// ---------------------------------------------------------------------------
function dauerRegeln(wurzel) {
  const kandidaten = [
    { ordner: path.join(wurzel, ".claude", "rules", "keel"), quelle: path.join(wurzel, ".ecc-src", "rules", "common"), rel: ".claude/rules/keel" },
    { ordner: path.join(wurzel, ".claude", "rules", "common"), quelle: path.join(wurzel, ".ecc-src", "rules", "common"), rel: ".claude/rules/common" },
  ];
  const ort = kandidaten.find((k) => fs.existsSync(k.ordner));
  if (!ort) {
    return fehlt("dauerregeln", "Dauer-Regeln (jede Sitzung)", ".claude/rules/…/common", "kein common-Regelordner gefunden", "$EDITOR .claude/rules/keel/");
  }
  // Frueher stieg die Regel hier aus, wenn der Fremd-Klon .ecc-src/ fehlte. In einem
  // Standalone-Harness gibt es den nie -- die Folge war ein Dauer-Befund "unlesbar"
  // fuer Regeln, die vollstaendig vorliegen und in jeder Sitzung laden. Unbestimmbar
  // ist ohne die Quelle nur die HERKUNFT (Eigenbau vs. mitgeliefert), nicht der Bestand.
  const herkunftBestimmbar = fs.existsSync(ort.quelle);

  const eintraege = [];
  for (const name of fs.readdirSync(ort.ordner).filter((f) => f.endsWith(".md")).sort()) {
    if (fs.existsSync(path.join(ort.quelle, name))) continue; // Fremd-Klon
    const zeilen = fs.readFileSync(path.join(ort.ordner, name), "utf8").split("\n");
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
      datei: name,
      titel,
      zeilen: zeilen.length,
      abschnitt: abIndex === -1 ? null : zeilen[abIndex].replace(/^#+\s*/, ""),
      kern,
      befehl: `$EDITOR ${ort.rel}/${name}`,
    });
  }

  if (!eintraege.length) {
    return fehlt("dauerregeln", "Dauer-Regeln (jede Sitzung)", ort.rel, "kein einziger Eigenbau im common-Ordner — bei einem gepflegten Harness ist das ein Verdacht, keine Entwarnung", `$EDITOR ${ort.rel}/`);
  }

  return {
    id: "dauerregeln",
    titel: "Dauer-Regeln — in jeder Sitzung geladen",
    status: "gezogen",
    quelle: { datei: ort.rel, zeile: null },
    befehl: `$EDITOR ${ort.rel}/<datei>.md`,
    art: "regelliste",
    eintraege,
    abgrenzung: herkunftBestimmbar
      ? `Eigenbau = liegt in ${ort.rel}, aber nicht in .ecc-src/rules/common (Fremd-Klon).`
      : `Alle ${eintraege.length} Regeln aus ${ort.rel}. Herkunft (Eigenbau vs. mitgeliefert) ist hier nicht bestimmbar — dafuer braeuchte es den Fremd-Klon .ecc-src/, der nicht zu diesem Harness gehoert.`,
  };
}

// ---------------------------------------------------------------------------
// REGEL 5 — Werkzeug-Rangfolge (CLI vor MCP vor Browser)
// ---------------------------------------------------------------------------
function werkzeugrang(wurzel) {
  const kandidaten = [".claude/rules/keel/tools.md", ".claude/rules/common/tools.md"];
  const relPfad = kandidaten.find((k) => fs.existsSync(path.join(wurzel, k)));
  const befehl = `$EDITOR ${relPfad || kandidaten[0]}`;
  if (!relPfad) return fehlt("werkzeugrang", "Werkzeug-Beschaffung", kandidaten[0], "tools.md nicht gefunden", befehl);

  const zeilen = lesen(wurzel, relPfad);
  const rang = zeileZiehen(zeilen, /CLI\s*→\s*2\.\s*MCP\s*→\s*3\./);
  const bestand = zeileZiehen(zeilen, /Kein MCP, f(ü|ue)r den eine CLI existiert/);
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
  const befehl = `$EDITOR ${DATEI}   # Abschnitt 5 · Konventionen`;
  const zeilen = lesen(wurzel, DATEI);
  if (!zeilen) return fehlt("sicherung", "Sichern im geteilten Arbeitsbaum", DATEI, "CLAUDE.md nicht gefunden", befehl);

  const anker = zeileZiehen(zeilen, /NIE `git add` \+ `git commit`/);
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
  waechter: ["waechterkanon"],
  sicherung: ["sicherung"],
  pruefer: ["sicherung"],
  rollen: [],
  readiness: ["effort", "modellwahl"],
};

function regeln(wurzel) {
  const alle = [
    effortStufen(wurzel),
    modellwahl(wurzel),
    dauerRegeln(wurzel),
    werkzeugrang(wurzel),
    waechterkanon(wurzel),
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
