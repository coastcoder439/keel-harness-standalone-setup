#!/usr/bin/env node
// MESSEN — Schritt 1 von "messen -> Daten -> rendern -> Datei" (README des Bausatzes).
//
// Dieses Modul erzeugt AUSSCHLIESSLICH Daten. Es kennt kein HTML, keine Farbe,
// keinen Satz Fliesstext fuer Menschen. Wer hier eine Formulierung einbaut, hat
// die Trennung aufgehoben, an der Keel Light spaeter haengt.
//
// GEBAUT WIRD AUF DEM, WAS DA IST — nicht daneben:
//   .ecc-src/scripts/dashboard-web.js              loadAgents/loadSkills/loadCommands/
//                                                  loadRules/loadMcps/loadHooks (Wurzel-Argument)
//   .ecc-src/scripts/operator-readiness-dashboard  buildReport() + parseArgs()
//   .claude/repo-status.js                         Sicherungsstand aller Repos
//   docs/workflows/anleitung-drift.js              Kopien-Drift  (Exit 1 = Befund)
//   docs/workflows/eigenbau-ungesichert.js         ungesicherte Eigenbauten (Exit 1 = Befund)
//   .claude/session-roles.js                       Rollen der parallelen Sitzungen
//
// STATUS-MODELL (die wichtigste Zeile dieser Datei):
//   ok · hinweis · befund · fehlt · unlesbar
// "unlesbar" wird NIE zu "ok" verkuerzt. Ein Werkzeugausfall sieht sonst aus wie
// ein bestandener Test — dieselbe Falle, gegen die eigenbau-ungesichert.js und
// anleitung-drift.js ihre Kontrollproben haben.
//
// AUFRUF   const { messen } = require('./messen'); messen({ wurzel })

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { hookSkripte, kontrollprobe, gruppeEinordnen, dauerRegelBeleg } = require("./classify");
const bordmittel = require("./inventory");

const SCHEMA = "harness.zustand.v1";
const MAX_BESCHREIBUNG = 200; // Zeichen je Posten -- die Seite zeigt Bestand, nicht Handbuecher

// ---------------------------------------------------------------------------
// Wurzel finden: der erste Ordner aufwaerts, der ein .claude/ hat.
// ---------------------------------------------------------------------------
function wurzelSuchen(start) {
  let d = path.resolve(start);
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(d, ".claude"))) return d;
    const oben = path.dirname(d);
    if (oben === d) break;
    d = oben;
  }
  return null;
}

const rel = (wurzel, p) => path.relative(wurzel, p) || ".";

// ---------------------------------------------------------------------------
// ECC-Loader holen. Sein Modulrumpf liest process.argv[2] als Port -- wuerde also
// unsere CLI-Flags als kaputte Portnummer anmeckern. Deshalb argv kurz wegnehmen.
// ---------------------------------------------------------------------------
function eccLaden(wurzel, unterpfad) {
  const kandidaten = [
    path.join(wurzel, ".ecc-src", "scripts", unterpfad),
    path.join(wurzel, ".claude", "scripts", unterpfad),
    path.join(wurzel, "scripts", unterpfad),
  ];
  const treffer = kandidaten.find((p) => fs.existsSync(p));
  if (!treffer) {
    return { modul: null, grund: `${unterpfad} nicht gefunden (gesucht in .ecc-src/scripts, .claude/scripts, scripts)` };
  }
  const argvAlt = process.argv;
  process.argv = [argvAlt[0], treffer];
  try {
    return { modul: require(treffer), pfad: treffer };
  } catch (e) {
    return { modul: null, grund: `${unterpfad} liess sich nicht laden: ${e.message}` };
  } finally {
    process.argv = argvAlt;
  }
}

// ---------------------------------------------------------------------------
// BEREICH 1 — Bestand (ECC-Loader)
// ---------------------------------------------------------------------------
function plattenZaehlung(ordner, art) {
  try {
    const e = fs.readdirSync(ordner, { withFileTypes: true });
    if (art === "md") return e.filter((x) => x.isFile() && x.name.endsWith(".md")).length;
    if (art === "dir") return e.filter((x) => x.isDirectory()).length;
    return null;
  } catch {
    return null;
  }
}

// Gemessen 02.08.2026: die Handlungsempfehlungen des ECC-Berichts kamen als
// OBJEKTE herein und wurden von String() zu "[object Object]" — ausgerechnet die
// Daten, die sagen, was zu tun ist, waren die einzigen zerstoerten. Ein stiller
// Verlust: die Seite sah vollstaendig aus und war es an der wichtigsten Stelle nicht.
const kurz = (s) => {
  let roh = s;
  if (roh && typeof roh === "object") {
    const felder = ["text", "title", "titel", "action", "name", "label", "description", "summary", "message"];
    const treffer = felder.find((f) => typeof roh[f] === "string" && roh[f].trim());
    roh = treffer
      ? roh[treffer]
      : Object.entries(roh)
          .filter(([, v]) => typeof v === "string" || typeof v === "number")
          .map(([k, v]) => `${k}: ${v}`)
          .join(" · ") || JSON.stringify(roh);
  }
  const t = String(roh ?? "").replace(/\s+/g, " ").trim();
  return t.length > MAX_BESCHREIBUNG ? t.slice(0, MAX_BESCHREIBUNG - 1) + "…" : t;
};

// KONTROLLPROBE je Gruppe: der Loader wird gegen eine unabhaengige Zaehlung auf
// der Platte gehalten. Liefert er 0, obwohl dort etwas liegt, ist das kein
// leerer Bestand, sondern ein kaputter Loader -- und wird als solcher gemeldet.
// Die Dateien einer Gruppe -- Grundlage fuer Herkunft und Ladeart. Bei art:"dir"
// ist der Ordner selbst der Posten (ein Skill IST ein Ordner), bei art:"md" die Datei.
function dateienListe(ordner, art) {
  try {
    return fs
      .readdirSync(ordner, { withFileTypes: true })
      .filter((x) => (art === "dir" ? x.isDirectory() : x.isFile() && x.name.endsWith(".md")))
      .map((x) => path.join(ordner, x.name));
  } catch {
    return [];
  }
}

function gruppe({ id, titel, ordner, art, laden, notiz, wurzel, hooks }) {
  const vorhanden = fs.existsSync(ordner);
  let posten = [];
  let fehler = null;
  if (vorhanden) {
    try {
      posten = laden() || [];
    } catch (e) {
      fehler = e.message;
    }
  }
  const platte = vorhanden ? plattenZaehlung(ordner, art) : 0;

  let status = "ok";
  let grund = null;
  if (!vorhanden) {
    status = "fehlt";
    grund = "Ordner existiert nicht";
  } else if (fehler) {
    status = "unlesbar";
    grund = fehler;
  } else if (platte !== null && platte > 0 && posten.length === 0) {
    status = "unlesbar";
    grund = `Loader lieferte 0, auf der Platte liegen ${platte} Eintraege — Kontrollprobe fehlgeschlagen`;
  }

  // Herkunft (eigenbau/mitgeliefert) und Ladeart (dauerhaft/abruf/schlafend) je Posten.
  // Ohne das zaehlt die Seite den ECC-Fremdklon und nennt ihn "den Harness" —
  // genau der Fehler der ersten Fassung.
  const einordnung =
    vorhanden && wurzel ? gruppeEinordnen(wurzel, ordner, dateienListe(ordner, art), hooks || new Map()) : null;

  // Namen -> Einordnung, damit die Anzeige je Posten zeigen kann, woher er kommt.
  const nachName = new Map((einordnung?.eintraege || []).map((e) => [path.basename(e.pfad).replace(/\.md$/, ""), e]));
  const postenPlus = posten.map((p) => {
    // Befehle liefert der Lader mit fuehrendem Schraegstrich ("/onboarding"), die
    // Einordnung schluesselt aber nach Dateiname ohne Endung ("onboarding"). Ohne
    // diese Angleichung bekommt KEIN Befehl Herkunft und Ladeart -- still, weil die
    // Gruppensumme trotzdem stimmt.
    let schluessel = String(p.name || "").split(" · ")[0];
    if (schluessel.startsWith("/")) schluessel = schluessel.slice(1);
    const e = nachName.get(schluessel);
    if (!e) return p;
    // Die Belege rechnet classify.js ohnehin aus -- frueher landeten sie im Muell.
    // Ohne sie kann eine Einzelansicht nur behaupten statt zu belegen, woher ein
    // Posten kommt und wann er laedt. Groesse und Aenderungszeit kommen dazu: ohne
    // sie gibt es weder "was ist gross" noch "was ist neu".
    let bytes = null;
    let geaendert = null;
    try {
      const abs = path.join(wurzel, e.pfad);
      const s = fs.statSync(abs);
      geaendert = s.mtime.toISOString();
      // Ein Skill IST ein Ordner. statSync liefert dafuer 0 Byte -- eine Zahl, die
      // aussieht wie "leer" und keine ist. Deshalb den Inhalt summieren.
      bytes = s.isDirectory()
        ? fs.readdirSync(abs).reduce((a, f) => {
            try { const t = fs.statSync(path.join(abs, f)); return a + (t.isFile() ? t.size : 0); } catch { return a; }
          }, 0)
        : s.size;
    } catch { /* nicht lesbar -> null, nicht eine erfundene Zahl */ }
    return {
      ...p,
      herkunft: e.herkunft,
      ladeart: e.ladeart,
      quelle: e.pfad,
      herkunftBeleg: e.herkunftBeleg || e.beleg || null,
      ladeartBeleg: e.ladeartBeleg || null,
      bytes,
      geaendert,
    };
  });

  return {
    id,
    titel,
    ordner,
    anzahl: posten.length,
    plattenzaehlung: platte,
    status,
    grund,
    notiz: notiz || null,
    einordnung: einordnung ? { nachHerkunft: einordnung.nachHerkunft, nachLadeart: einordnung.nachLadeart } : null,
    posten: postenPlus,
  };
}

// ECC erwartet <wurzel>/rules/<paket>/*.md. Die Werkbank schiebt eine Ebene ein:
// .claude/rules/ecc/<paket>/*.md. Erst laeuft der ECC-Loader; NUR wenn der nichts
// findet, obwohl Pakete daliegen, wird eine Ebene tiefer gesehen.
function regelsaetze(modul, harness) {
  const roh = modul.loadRules(harness) || [];
  const leer = roh.length === 0 || roh.every((r) => (r.f || []).length === 0);
  if (!leer) return { ebene: "flach", saetze: roh.map((r) => ({ paket: r.l, dateien: r.f })) };

  const dir = path.join(harness, "rules");
  if (!fs.existsSync(dir)) return { ebene: "flach", saetze: [] };
  const saetze = [];
  for (const zwischen of roh.map((r) => r.l)) {
    const unter = path.join(dir, zwischen);
    let eintraege;
    try {
      eintraege = fs.readdirSync(unter, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of eintraege.filter((x) => x.isDirectory())) {
      const dateien = fs
        .readdirSync(path.join(unter, e.name))
        .filter((f) => f.endsWith(".md"))
        .sort()
        .map((f) => f.replace(/\.md$/, ""));
      saetze.push({ paket: `${zwischen}/${e.name}`, dateien });
    }
  }
  return { ebene: saetze.length ? "verschachtelt" : "flach", saetze };
}

// ---------------------------------------------------------------------------
// VERLAUF — die letzten Commits je Repo, als Zeitleiste.
//
// Beantwortet "was hat sich veraendert" mit Daten statt mit Gefuehl. Bewusst
// ohne Wertung: die Seite zeigt, WAS passiert ist, nicht ob es gut war.
// ---------------------------------------------------------------------------
function verlaufMessen(wurzel, repos, jeRepo = 4) {
  const eintraege = [];
  for (const r of repos) {
    const ordner = r.name === path.basename(wurzel) ? wurzel : path.join(wurzel, r.name);
    if (!fs.existsSync(path.join(ordner, ".git"))) continue;
    const p = spawnSync("git", ["-C", ordner, "log", `-${jeRepo}`, "--date=iso-strict", "--format=%H%x1f%ad%x1f%s%x1f%an"], {
      encoding: "utf8",
      timeout: 10000,
    });
    if (p.status !== 0 || !p.stdout) continue;
    for (const zeile of p.stdout.trim().split("\n")) {
      const [hash, datum, betreff, autor] = zeile.split("");
      if (!hash) continue;
      eintraege.push({ repo: r.name, hash: hash.slice(0, 7), datum, betreff, autor });
    }
  }
  eintraege.sort((a, b) => (a.datum < b.datum ? 1 : -1));
  return {
    status: eintraege.length ? "ok" : "fehlt",
    grund: eintraege.length ? null : "Kein Git-Verlauf lesbar",
    massnahme: eintraege.length ? null : { text: "Ohne Git gibt es keine Historie — ein Repo anlegen.", befehl: "git init" },
    quelle: "git log je Repo",
    eintraege: eintraege.slice(0, 40),
  };
}

// ---------------------------------------------------------------------------
// KONTEXT — was in JEDER Sitzung geladen wird, bevor jemand etwas tippt.
//
// Das ist die teuerste Gruppe und die einzige, die man nicht umgehen kann. Die
// erste Fassung mass sie gar nicht: sie zaehlte 280 Skills (die nur mit einer
// Zeile im Index liegen) und uebersah die Handvoll Dateien, die jedes Mal
// vollstaendig geladen werden.
//
// Token werden NICHT gemessen, sondern aus Bytes geschaetzt. Der Faktor steht
// im Datensatz, damit niemand die Zahl fuer eine Messung haelt.
// ---------------------------------------------------------------------------
const ZEICHEN_JE_TOKEN = 3.6; // deutscher Fliesstext, grober Erfahrungswert -- als Schaetzung ausgewiesen

function kontextMessen(wurzel, harness) {
  const stuecke = [];
  const nimm = (absPfad, art, warum) => {
    if (!fs.existsSync(absPfad)) return;
    let bytes = 0;
    try {
      bytes = fs.statSync(absPfad).size;
    } catch {
      return;
    }
    stuecke.push({ pfad: rel(wurzel, absPfad), art, warum, bytes, tokenSchaetzung: Math.round(bytes / ZEICHEN_JE_TOKEN) });
  };

  nimm(path.join(wurzel, "CLAUDE.md"), "Wurzel-Kontext", "Claude Code liest CLAUDE.md bei jedem Sitzungsstart");

  // Derselbe gemessene Beleg wie in der Einordnung -- nicht eine zweite,
  // fest verdrahtete Formulierung. Hier stand „CLAUDE.md §5: common immer“ und
  // damit eine Abschnittsnummer, die es nur in der Ursprungs-Werkbank gibt.
  const common = path.join(harness, "rules", "ecc", "common");
  for (const f of dateienListe(common, "md")) nimm(f, "Dauer-Regel", dauerRegelBeleg(wurzel, f));

  // Hook-Skripte: was bei SessionStart laeuft, wirkt auf jede Sitzung -- seine
  // AUSGABE landet im Kontext, nicht seine Quelle. Deshalb getrennt ausgewiesen.
  const hooks = hookSkripte(wurzel);
  for (const [datei, quelle] of hooks) {
    const kandidat = path.join(harness, datei);
    if (fs.existsSync(kandidat)) nimm(kandidat, "Hook-Skript", `verdrahtet in ${quelle} — die Ausgabe landet im Kontext, nicht die Datei`);
  }

  const bytes = stuecke.filter((s) => s.art !== "Hook-Skript").reduce((a, s) => a + s.bytes, 0);
  return {
    status: stuecke.length ? "ok" : "fehlt",
    grund: stuecke.length ? null : "Keine dauerhaft geladenen Dateien gefunden — CLAUDE.md und rules/ecc/common/ fehlen",
    massnahme: stuecke.length
      ? null
      : { text: "Ohne CLAUDE.md und die Dauer-Regeln ist es ein leerer Claude Code, kein Harness.", befehl: "ls CLAUDE.md .claude/rules/ecc/common/" },
    faktor: ZEICHEN_JE_TOKEN,
    faktorHinweis: `Schätzung: Bytes ÷ ${ZEICHEN_JE_TOKEN}. Keine Messung — der echte Wert hängt am Tokenisierer.`,
    bytesJeSitzung: bytes,
    tokenSchaetzungJeSitzung: Math.round(bytes / ZEICHEN_JE_TOKEN),
    stuecke,
  };
}

// Die Werkzeug-Landschaft (CLIs, MCPs, APIs, Zugaenge) aus docs/tool-landscape.md.
// Erhoben wird sie vom Onboarding-Schritt 3; hier wird nur gezeigt, was drinsteht.
// Absicht: die Uebersicht "womit arbeite ich hier eigentlich" gehoert auf dieselbe
// Seite wie Skills, Befehle und Waechter -- sonst muss man sie sich zusammensuchen.
function werkzeugGruppe(wurzel) {
  const rel = "docs/tool-landscape.md";
  const datei = path.join(wurzel, rel);
  const leer = {
    id: "werkzeuge", titel: "Werkzeug-Landschaft",
    ordner: datei, anzahl: 0, plattenzaehlung: null, einordnung: null, posten: [],
  };
  if (!fs.existsSync(datei)) {
    return { ...leer, status: "fehlt", grund: `${rel} fehlt -- die Vorlage kommt mit dem Bausatz.`,
      notiz: "Erhoben wird sie im Onboarding-Schritt 3 (Womit arbeitest du?)." };
  }
  const zeilen = fs.readFileSync(datei, "utf8").split(String.fromCharCode(13, 10)).join(String.fromCharCode(10)).split(String.fromCharCode(10));
  const posten = [];
  let rubrik = null;
  for (const z of zeilen) {
    const u = z.match(/^##\s+(.+?)\s*$/);
    if (u) { rubrik = u[1]; continue; }
    if (!rubrik || !z.trim().startsWith("|")) continue;
    const spalten = z.split("|").map((s) => s.trim());
    const erste = spalten[1] || "";
    if (!erste || /^-+$/.test(erste) || /noch nichts erhoben/i.test(erste)) continue;
    if (/^(Programm|Dienst|Werkzeug)/i.test(erste)) continue; // Kopfzeile
    posten.push({ name: erste + " · " + rubrik, beschreibung: spalten.slice(2).filter(Boolean).join(" — ") });
  }
  return {
    ...leer,
    anzahl: posten.length,
    posten,
    status: "ok",
    grund: null,
    notiz: posten.length
      ? `Erhoben im Onboarding-Schritt 3. Zugaenge stehen hier nur als NAME, nie als Wert.`
      : `Noch nichts erhoben -- ${rel} traegt nur die leere Vorlage. Nachholen: /onboarding Schritt 3 (Womit arbeitest du?).`,
  };
}

function bestandMessen(wurzel, harness) {
  // dashboard-web.js gehoert zur Ursprungs-Werkbank und liegt einem Standalone-
  // Harness nicht bei. Frueher stieg der ganze Bereich dann mit "unlesbar" aus und
  // meldete einen Defekt, wo nur eine fremde Abhaengigkeit fehlte -- genau die
  // Uebersicht, wofuer die Seite da ist, blieb leer. Jetzt wird mit Bordmitteln
  // aufgezaehlt (dashboard/inventory.js), und die Quelle sagt, welcher Weg lief.
  const ecc = eccLaden(wurzel, "dashboard-web.js");
  const modul = ecc.modul || bordmittel;
  const pfad = ecc.pfad || "dashboard/inventory.js";

  const hooks = hookSkripte(wurzel);

  const gruppen = [
    werkzeugGruppe(wurzel),
    gruppe({
      wurzel,
      hooks,
      id: "agenten",
      titel: "Agenten",
      ordner: path.join(harness, "agents"),
      art: "md",
      laden: () => modul.loadAgents(harness).map((a) => ({ name: a.n, beschreibung: kurz(a.d), modell: a.m })),
    }),
    gruppe({
      wurzel,
      hooks,
      id: "faehigkeiten",
      titel: "Fähigkeiten",
      ordner: path.join(harness, "skills"),
      art: "dir",
      laden: () => modul.loadSkills(harness).map((s) => ({ name: s.n, beschreibung: kurz(s.d) })),
    }),
    gruppe({
      wurzel,
      hooks,
      id: "befehle",
      titel: "Befehle",
      ordner: path.join(harness, "commands"),
      art: "md",
      laden: () => modul.loadCommands(harness).map((c) => ({ name: c.n, beschreibung: kurz(c.d), gruppe: c.c })),
    }),
    gruppe({
      wurzel,
      hooks,
      id: "mcp",
      titel: "MCP-Server (Programme, die dem Agenten Werkzeuge bereitstellen)",
      ordner: path.join(harness, "mcp-configs"),
      art: "dir",
      laden: () =>
        modul.loadMcps(harness).flatMap((m) => (m.s || []).map((s) => ({ name: s.n, beschreibung: kurz(s.cmd), gruppe: m.f }))),
      notiz: "Ein leerer Bestand ist hier das Ziel, nicht ein Mangel — siehe Regel „CLI vor MCP vor Browser“.",
    }),
    gruppe({
      wurzel,
      hooks,
      id: "hooks",
      titel: "Hooks als Ordner (Format der Ursprungs-Werkbank)",
      ordner: path.join(harness, "hooks"),
      art: "md",
      laden: () => modul.loadHooks(harness).map((h) => ({ name: `${h.ev} · ${h.m}`, beschreibung: kurz(h.d) })),
      // Hier stand „…sondern in settings.local.json“ — die Gewohnheit der
      // Ursprungs-Werkbank. Der Installer schreibt nach settings.json; die
      // Notiz behauptete dem Empfaenger also eine Datei, die er nicht hat.
      // Welche es tatsaechlich ist, steht gemessen im Bereich „Wächter“.
      notiz: "Die Wächter hängen NICHT hier, sondern in .claude/settings.json bzw. settings.local.json — der Bereich „Wächter“ nennt je Eintrag die Datei, aus der er stammt.",
    }),
  ];

  const r = regelsaetze(modul, harness);

  // Summe ueber alle Gruppen: DAS ist die Antwort auf "was habe ich da eigentlich".
  const summe = (feld) =>
    gruppen.reduce((a, g) => {
      for (const [k, v] of Object.entries(g.einordnung?.[feld] || {})) a[k] = (a[k] || 0) + v;
      return a;
    }, {});

  const probe = kontrollprobe(wurzel);
  const fremdklon = fs.existsSync(path.join(wurzel, ".ecc-src"));

  return {
    // Faellt die Kontrollprobe, ist die Einordnung wertlos — dann NICHT "ok" melden.
    // Die Herkunftsbestimmung (Eigenbau vs. mitgeliefert) vergleicht gegen den
    // Fremd-Klon .ecc-src/. Den gibt es in einem Standalone-Harness nicht -- dann ist
    // die Frage nicht offen, sondern gegenstandslos. Sie als fehlgeschlagene Probe zu
    // melden erzeugte einen Dauer-Hinweis, den niemand abstellen kann.
    status: gruppen.some((g) => g.status === "unlesbar") ? "unlesbar" : probe.bestanden || !fremdklon ? "ok" : "hinweis",
    grund: probe.bestanden || !fremdklon ? null : "Kontrollprobe der Herkunftsbestimmung fehlgeschlagen — Eigenbau/Mitgeliefert ist nicht belastbar",
    notiz: fremdklon ? null : "Herkunft (Eigenbau vs. mitgeliefert) wird gegen den Fremd-Klon .ecc-src/ bestimmt. Der gehoert nicht zu diesem Harness -- die Spalte bleibt daher leer.",
    massnahme: probe.bestanden || !fremdklon
      ? null
      : { text: "Prüfen, ob .ecc-src/ vollständig ausgecheckt ist — ohne die Quelle gilt alles als Eigenbau.", befehl: "ls .ecc-src/rules" },
    quelle: rel(wurzel, pfad),
    gruppen,
    nachHerkunft: summe("nachHerkunft"),
    nachLadeart: summe("nachLadeart"),
    kontrollprobe: probe,
    regelsaetze: r.saetze,
    regelEbene: r.ebene,
  };
}

// ---------------------------------------------------------------------------
// BEREICH 2 — Wächter, wie sie tatsächlich verdrahtet sind (settings.local.json)
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// BLOCKT ER ODER SAGT ER NUR AN? — gemessen, nicht am Wortlaut geraten.
//
// Die erste Fassung liess die ANZEIGE das entscheiden, mit einer Wortsuche über
// Ansage und Skriptnamen (/block|verhinder|stopp/). Ergebnis auf dieser Werkbank:
// „0 von 7 blockend" — falsch, und zwar in der gefährlichen Richtung: die Seite
// behauptete auf der Leine-Tiefe, dieser Harness habe keine einzige Schranke,
// während danger-guard jeden Schreibzugriff außerhalb des Arbeitsbereichs stoppt.
//
// Zwei Bedingungen, beide prüfbar:
//   1. Nur PreToolUse KANN blocken. Ein Stop- oder SessionStart-Hook läuft, wenn
//      der Werkzeugaufruf längst durch ist — sein Rückgabewert verhindert nichts.
//   2. Der Rückgabewert 2 ist die Blockier-Vereinbarung von Claude Code. Ein Hook
//      ohne exit(2) im Code kann nicht blocken, egal wie er heißt.
//
// Gegenprobe am Bestand: danger-guard.js -> blockt (exit 2), git-guard.js -> nur
// Ansage (kein exit 2, sagt das im eigenen Kopf auch so).
// ---------------------------------------------------------------------------
function blockwirkung(ereignis, dateiPfad, vorhanden) {
  if (ereignis !== "PreToolUse")
    return { blockt: false, beleg: `${ereignis} läuft nach dem Aufruf — kann nichts verhindern` };
  if (!dateiPfad) return { blockt: false, beleg: "kein Skript, nur ein Inline-Befehl" };
  if (!vorhanden) return { blockt: false, beleg: "Skript fehlt auf der Platte" };
  try {
    const q = fs.readFileSync(dateiPfad, "utf8");
    return /process\.exit\(\s*2\s*\)|\bexit\(\s*2\s*\)/.test(q)
      ? { blockt: true, beleg: `exit(2) im Skript — PreToolUse mit Rückgabewert 2 bricht den Aufruf ab` }
      : { blockt: false, beleg: "kein exit(2) im Skript — sagt an, verhindert nicht" };
  } catch (e) {
    return { blockt: false, beleg: `Skript nicht lesbar: ${e.message}` };
  }
}

function waechterMessen(wurzel, harness) {
  // BEIDE Einstellungsdateien lesen, nicht nur eine.
  //
  // Bis 02.08.2026 stand hier ausschliesslich settings.local.json -- die
  // Konvention DIESER Werkbank. Claude Code liest aber beide, und der Installer
  // des Bausatzes schreibt nach settings.json. Folge: JEDER frisch aufgesetzte
  // Harness meldete "Wächter: fehlt", obwohl alle Hooks verdrahtet waren.
  // Die Seite berichtete damit ueber die Gewohnheit ihres Erbauers statt ueber
  // den Rechner, auf dem sie laeuft. Gefunden von der adversarischen Gegenprobe
  // der Installer-Abnahme; die Abnahme selbst hatte den Befund als normal gelesen.
  const quellen = [
    { name: "settings.json", pfad: path.join(harness, "settings.json") },
    { name: "settings.local.json", pfad: path.join(harness, "settings.local.json") },
  ];

  const gelesen = [];
  const unlesbar = [];
  for (const q of quellen) {
    if (!fs.existsSync(q.pfad)) continue;
    try {
      gelesen.push({ ...q, inhalt: JSON.parse(fs.readFileSync(q.pfad, "utf8")) });
    } catch (e) {
      unlesbar.push({ ...q, grund: e.message });
    }
  }

  if (!gelesen.length) {
    const beide = quellen.map((q) => q.name).join(" und ");
    return {
      status: unlesbar.length ? "unlesbar" : "fehlt",
      grund: unlesbar.length
        ? `${unlesbar.map((u) => `${u.name}: ${u.grund}`).join(" · ")}`
        : `Weder ${beide} vorhanden — es ist kein einziger Wächter verdrahtet`,
      massnahme: {
        text: "Ohne Wächter blockt nichts. Die Hook-Verdrahtung gehört nach .claude/settings.json.",
        befehl: "cat .claude/settings.json",
      },
      quelle: quellen.map((q) => rel(wurzel, q.pfad)).join(" + "),
      eintraege: [],
      zaehlung: { gesamt: 0, blockend: 0, ansagend: 0 },
    };
  }

  const datei = gelesen[0].pfad;
  const eintraege = [];
  for (const { name: herkunft, inhalt } of gelesen) {
  // Ein Objekt ist Pflicht: settings.json mit dem Inhalt `null` oder `[]` ist
  // gueltiges JSON, traegt aber keine Hooks -- und darf nicht als "gelesen" gelten.
  if (!inhalt || typeof inhalt !== "object" || Array.isArray(inhalt)) continue;
  for (const [ereignis, gruppen] of Object.entries(inhalt.hooks || {})) {
    for (const g of gruppen || []) {
      for (const h of g.hooks || []) {
        const befehl = String(h.command || "");
        // Ein Wächter ist ein Skript, kein echo. Beides wird gezeigt, aber getrennt.
        const skript = (befehl.match(/([\w.-]+\.js)/) || [])[1] || null;
        const dateiPfad = skript ? path.join(harness, skript) : null;
        const vorhanden = dateiPfad ? fs.existsSync(dateiPfad) : null;
        const b = blockwirkung(ereignis, dateiPfad, vorhanden);
        eintraege.push({
          ereignis,
          matcher: g.matcher || "*",
          art: skript ? "skript" : "inline",
          skript,
          vorhanden,
          ansage: h.statusMessage || null,
          asynchron: h.async === true,
          blockt: b.blockt,
          blockBeleg: b.beleg,
          herkunft,
        });
      }
    }
  }
  }
  const kaputt = eintraege.filter((e) => e.vorhanden === false);
  const blockend = eintraege.filter((e) => e.blockt);

  // Kontrollprobe der Blockwirkung: zwei Fälle mit bekannter Antwort. Ohne sie
  // wäre „0 blockend" von „alles nur Ansagen" nicht zu unterscheiden — und genau
  // dieser Fehler stand schon einmal auf der Seite.
  const probe = [
    { name: "danger-guard blockt", skript: "danger-guard.js", erwartet: true },
    { name: "git-guard sagt nur an", skript: "git-guard.js", erwartet: false },
  ].map((f) => {
    const e = eintraege.find((x) => x.skript === f.skript);
    return { ...f, gemessen: e ? e.blockt : null, bestanden: e ? e.blockt === f.erwartet : null };
  });
  const pruefbar = probe.filter((p) => p.bestanden !== null);
  const probeOk = pruefbar.length > 0 && pruefbar.every((p) => p.bestanden);

  // ZÄHLEN REICHT NICHT, ES MUSS AUCH GEURTEILT WERDEN.
  //
  // Gefunden in der Schlussabnahme des Installers (02.08.2026): Wurden ALLE
  // PreToolUse-Wächter aus der Verdrahtung entfernt, meldete dieser Bereich
  // `blockend: 0` — und blieb trotzdem auf „ok", ohne Grund und ohne Maßnahme.
  // Ein Ordner ganz ohne Blockierschutz stand damit auf Grün. Das ist die
  // zweite Hälfte derselben Blindheit, deren erste Hälfte (die Wortsuche nach
  // „block") am selben Tag behoben wurde: erst wurde falsch gezählt, dann
  // wurde richtig gezählt und nicht bewertet.
  //
  // Warum Hinweis und nicht Befund: es ist denkbar, dass jemand bewusst ohne
  // Schranke arbeitet. Denkbar ist nicht dasselbe wie unauffällig — deshalb
  // steht der Satz da, mit dem Befehl zum Nachsehen.
  const ohneSchranke = eintraege.length > 0 && blockend.length === 0;

  return {
    status: kaputt.length
      ? "befund"
      : (!probeOk && pruefbar.length) || ohneSchranke
        ? "hinweis"
        : eintraege.length
          ? "ok"
          : "hinweis",
    grund: kaputt.length
      ? `${kaputt.length} verdrahtete(s) Skript(e) fehlt auf der Platte`
      : !probeOk && pruefbar.length
        ? "Kontrollprobe der Blockwirkung fehlgeschlagen — „blockt/sagt an“ ist nicht belastbar"
        : ohneSchranke
          ? `${eintraege.length} Wächter verdrahtet, aber keiner davon blockt — es sagt nur an, verhindert wird nichts`
          : null,
    massnahme:
      kaputt.length
        ? { text: `Fehlende Wächter-Skripte anlegen oder aus der Verdrahtung austragen: ${kaputt.map((e) => e.skript).join(", ")}`, befehl: "ls .claude/*.js" }
        : !probeOk && pruefbar.length
          ? { text: "Die Blockwirkung wird an exit(2) gemessen — prüfen, ob die Wächter noch der Vereinbarung folgen.", befehl: "grep -c 'exit(2)' .claude/*.js" }
          : ohneSchranke
            ? {
                text: "Kein Wächter kann einen Werkzeugaufruf abbrechen. Wer eine Schranke will, verdrahtet einen PreToolUse-Hook, der mit exit(2) endet.",
                befehl: "grep -l 'exit(2)' .claude/*.js",
              }
            : null,
    quelle: rel(wurzel, datei),
    zaehlung: { gesamt: eintraege.length, blockend: blockend.length, ansagend: eintraege.length - blockend.length },
    kontrollprobe: { bestanden: probeOk, faelle: probe },
    eintraege,
  };
}

// ---------------------------------------------------------------------------
// BEREICH 3 — Sicherung (repo-status.js, ausgeführt und geparst)
// ---------------------------------------------------------------------------
// repo-status.js beschriftet die Werkbank mit ihrem ORDNERNAMEN, die Projekte
// mit ihrem Pfad relativ zur Werkbank. Ein Befehl darf nicht den einen fuer den
// anderen halten: `git -C "<Werkbank-Ordner>" push` laeuft ins Leere, wenn man in der
// Werkbank steht -- den Ordner gibt es dort nicht.
const repoPfad = (wurzel, name) => (name === path.basename(wurzel) ? "." : name);

function repoStatusMessen(wurzel) {
  const skript = path.join(wurzel, ".claude", "repo-status.js");
  if (!fs.existsSync(skript)) {
    return { status: "fehlt", grund: "repo-status.js nicht vorhanden", quelle: null, repos: [] };
  }
  const lauf = spawnSync(process.execPath, [skript], { cwd: wurzel, encoding: "utf8", timeout: 120000 });
  if (lauf.error || lauf.status !== 0) {
    return {
      status: "unlesbar",
      grund: `repo-status.js endete mit ${lauf.status} ${lauf.error ? "(" + lauf.error.message + ")" : ""}`,
      quelle: ".claude/repo-status.js",
      repos: [],
    };
  }

  const repos = [];
  let aktuell = null;
  for (const zeile of (lauf.stdout || "").split("\n")) {
    const feld = zeile.match(/^ {6}([^:]+?)\s*:\s*(.*)$/);
    if (feld && aktuell) {
      aktuell.felder[feld[1].trim()] = feld[2].trim();
      continue;
    }
    const kopf = zeile.match(/^ {2}(\S.*)$/);
    if (kopf && !kopf[1].startsWith("(")) {
      aktuell = { name: kopf[1].split("  <-")[0].trim(), felder: {} };
      repos.push(aktuell);
    }
  }

  // KONTROLLPROBE: die Werkbank selbst MUSS in der Liste stehen. Steht sie nicht
  // drin, hat der Parser danebengegriffen -- und "0 Repos" waere dann keine
  // Entwarnung, sondern ein blinder Lauf.
  const eigen = path.basename(wurzel);
  if (!repos.some((r) => r.name.startsWith(eigen))) {
    return {
      status: "unlesbar",
      grund: `Kontrollprobe fehlgeschlagen: "${eigen}" kam in der Ausgabe von repo-status.js nicht vor (${repos.length} Blöcke erkannt)`,
      quelle: ".claude/repo-status.js",
      repos: [],
    };
  }

  // Worktrees sind KEINE eigenstaendigen Repos und duerfen nicht als ungesichert
  // gelten. Sie tauchen erst auf, seit repo-status.js (02.08.2026) auch unterhalb
  // gefundener Repos sucht; ihr Block hat andere Felder ("WORKTREE", "Erreichbar")
  // statt "Lokales Git". Ohne diese Trennung wurde jeder Worktree zum Befund --
  // ein Fehlalarm, den ich mir mit dem repo-status-Fix selbst eingebaut hatte.
  const worktrees = repos
    .filter((r) => r.felder["WORKTREE"])
    .map((r) => ({
      name: r.name,
      mutter: r.felder["WORKTREE"],
      zweig: r.felder["Zweig"] || "?",
      erreichbar: r.felder["Erreichbar"] || "",
      // Nur DAS ist beim Worktree ein Befund: ein Commit, den kein Zweig haelt.
      status: /NIRGENDS ERREICHBAR/.test(r.felder["Erreichbar"] || "")
        ? "befund"
        : /NUR LOKAL/.test(r.felder["Erreichbar"] || "")
          ? "hinweis"
          : "ok",
    }));

  const aufbereitet = repos
    .filter((r) => !r.felder["WORKTREE"])
    .map((r) => {
    const git = r.felder["Lokales Git"] || "";
    const sync = r.felder["Sync"] || "";
    const unges = parseInt((r.felder["Ungesichert"] || "").replace(/\D.*$/, ""), 10);
    const ungesichert = Number.isNaN(unges) ? null : unges;
    const gesichert = /synchron -- alles gepusht/.test(sync);
    return {
      name: r.name,
      git,
      github: r.felder["GitHub-Repo"] || null,
      sync,
      ungesichert,
      // DREI Lagen, nicht zwei. Bis 02.08.2026 fielen "gar kein Git" und
      // "Commits nicht gepusht" in denselben Topf -- und die abgeleitete
      // Handlung lautete beide Male `git push`. In einem frisch eingerichteten
      // Ordner gibt es aber gar kein Repo; der Befehl scheitert dort, und zwar
      // beim ERSTEN Blick jedes Erstinstallierers auf diese Seite. Ein
      // Handlungsvorschlag, der nicht laufen kann, ist schlimmer als keiner.
      lage: !git.startsWith("JA") ? "kein_repo" : !r.felder["GitHub-Repo"] || r.felder["GitHub-Repo"] === "(keins)" ? "kein_remote" : !gesichert ? "nicht_gepusht" : ungesichert ? "ungesichert" : "ok",
      status: !git.startsWith("JA") ? "befund" : !gesichert ? "befund" : ungesichert ? "hinweis" : "ok",
    };
  });

  // Der Grund darf NICHT null bleiben, wenn der Status es nicht ist: die erste
  // Fassung meldete "hinweis" ohne Grund, und die Seite stand auf Gelb, ohne zu
  // sagen warum. Der Grund liegt je Repo vor -- er muss nur hochgereicht werden.
  const ungesichert = aufbereitet.filter((r) => r.ungesichert);
  // Nach LAGE trennen, nicht nach Status -- sonst bekommen drei verschiedene
  // Probleme dieselbe Handlung (siehe Kommentar bei `lage` oben).
  const ohneRepo = aufbereitet.filter((r) => r.lage === "kein_repo");
  const ohneRemote = aufbereitet.filter((r) => r.lage === "kein_remote");
  const nichtGepusht = aufbereitet.filter((r) => r.lage === "nicht_gepusht");
  const wtBefund = worktrees.filter((w) => w.status === "befund");
  const ungesichertLage = ohneRepo.length || ohneRemote.length || nichtGepusht.length;
  const status = ungesichertLage || wtBefund.length ? "befund" : ungesichert.length || worktrees.some((w) => w.status === "hinweis") ? "hinweis" : "ok";

  const nenn = (liste) => liste.map((r) => `${r.name} (${r.ungesichert ?? "?"})`).join(", ");
  const gruende = [];
  if (wtBefund.length) gruende.push(`Worktree-Commit haengt in KEINEM Zweig: ${wtBefund.map((w) => w.name).join(", ")}`);
  if (ohneRepo.length) gruende.push(`Kein Git-Repo: ${ohneRepo.map((r) => r.name).join(", ")}`);
  if (ohneRemote.length) gruende.push(`Kein Fernziel: ${ohneRemote.map((r) => r.name).join(", ")}`);
  if (nichtGepusht.length) gruende.push(`Nicht gepusht: ${nichtGepusht.map((r) => r.name).join(", ")}`);
  if (ungesichert.length) gruende.push(`Ungesicherte Änderungen in ${ungesichert.length} von ${aufbereitet.length} Repos: ${nenn(ungesichert)}`);
  const grund = gruende.length ? gruende.join(" · ") : null;

  // Reihenfolge = Dringlichkeit: ein Commit ohne Zweig kann der naechste
  // Aufraeumlauf endgueltig loeschen, ein ungepushter Commit nicht.
  const massnahme = wtBefund.length
    ? { text: `Worktree-Commit an einen Zweig haengen, bevor ihn die Speicherbereinigung holt (${wtBefund[0].name}).`, befehl: `git -C "${wtBefund[0].mutter}" branch rettung-${new Date().toISOString().slice(0, 10)} ${wtBefund[0].zweig}` }
    : ohneRepo.length
      ? {
          text: `Noch kein Git in ${ohneRepo.map((r) => r.name).join(", ")} — ohne Repo gibt es keine Historie und kein Backup. Erst anlegen, dann committen, dann ein Fernziel setzen.`,
          befehl: `git -C "${repoPfad(wurzel, ohneRepo[0].name)}" init`,
        }
      : ohneRemote.length
        ? {
            text: `Kein Fernziel in ${ohneRemote.map((r) => r.name).join(", ")} — die Historie liegt nur auf dieser Platte. Ein Repo anlegen und den ersten Push mit -u fahren.`,
            befehl: `gh repo create --private --source "${repoPfad(wurzel, ohneRemote[0].name)}" --push`,
          }
        : nichtGepusht.length
      ? { text: `Lokale Commits auf den Server bringen (${nichtGepusht.map((r) => r.name).join(", ")}).`, befehl: `git -C "${repoPfad(wurzel, nichtGepusht[0].name)}" push` }
      : ungesichert.length
        ? { text: `Änderungen sichern — pfadweise committen, nie den geteilten Index (${ungesichert.map((r) => r.name).join(", ")}).`, befehl: `git -C "${repoPfad(wurzel, ungesichert[0].name)}" status --short` }
        : null;

  return {
    status,
    grund,
    massnahme,
    quelle: ".claude/repo-status.js",
    repos: aufbereitet,
    worktrees,
  };
}

// ---------------------------------------------------------------------------
// BEREICH 4 — Mess-Prüfer (Exit-Code ist das Signal, die Zahlen sind Beiwerk)
// ---------------------------------------------------------------------------
const PRUEFER = [
  {
    id: "anleitung-sync",
    pfad: "checks/anleitung-sync.mjs",
    zweck: "Volltext-Kopien der Nachbau-Anleitung gegen die echten Dateien",
    kennzahlen: {
      muster: /(\d+) Kopien geprueft: (\d+) deckungsgleich, (\d+) abweichend/,
      namen: ["geprüft", "deckungsgleich", "abweichend"],
    },
  },
  {
    id: "paket-manifest",
    pfad: "checks/paket-manifest.mjs",
    zweck: "manifest.json gegen den tatsaechlichen Paketinhalt",
    kennzahlen: {
      muster: /(\d+) Dateien im Paket · (\d+) Abweichung/,
      namen: ["Dateien im Paket", "Abweichungen"],
    },
  },
];

function prueferMessen(wurzel) {
  return PRUEFER.map((p) => {
    const skript = path.join(wurzel, p.pfad);
    const grundlage = { id: p.id, quelle: p.pfad, zweck: p.zweck, befehl: `node ${p.pfad}` };
    // Fehlt das Skript, darf hier KEIN Befehl stehen. Die Zusammenfuehrung baute
    // daraus sonst die Handlung „Prüfer von Hand laufen lassen: node
    // docs/workflows/anleitung-drift.js“ — gemessen an einem frisch
    // eingerichteten Ziel: ein Aufruf ins Leere, den das Paket bewusst nicht
    // mitliefert. Ein Beleg, der nicht nachschlagbar ist, taeuscht Pruefbarkeit
    // vor; ein Befehl, der nicht ausfuehrbar ist, tut dasselbe und kostet
    // ausserdem den Versuch.
    if (!fs.existsSync(skript)) {
      return {
        ...grundlage,
        befehl: null,
        // Diese Pruefer liegen im Bausatz-Repo, nicht in einer fertigen Installation.
        // Ihr Fehlen ist der Normalfall eines installierten Harness und kein Defekt.
        status: "ok",
        grund: null,
        notiz: `Nicht in dieser Installation: ${p.pfad} liegt im Bausatz-Repo. Ungemessen bleibt damit: ${p.zweck}.`,
        massnahme: {
          text: `Der Prüfer „${p.id}“ gehört nicht zum Grundbestand dieses Harness. Ungemessen bleibt damit: ${p.zweck}. Entweder anlegen oder die Lücke bewusst hinnehmen.`,
          befehl: null,
        },
        kennzahlen: [],
        meldungen: [],
      };
    }
    const lauf = spawnSync(process.execPath, [skript], { cwd: wurzel, encoding: "utf8", timeout: 120000 });
    if (lauf.error) {
      return { ...grundlage, status: "unlesbar", grund: lauf.error.message, kennzahlen: [], meldungen: [] };
    }
    const aus = (lauf.stdout || "") + (lauf.stderr || "");
    // Exit 0 = sauber · 1 = Befund · 2 = nicht prüfbar. Alles andere ebenfalls nicht prüfbar.
    const status = lauf.status === 0 ? "ok" : lauf.status === 1 ? "befund" : "unlesbar";

    const m = aus.match(p.kennzahlen.muster);
    const kennzahlen = m ? p.kennzahlen.namen.map((n, i) => ({ name: n, wert: Number(m[i + 1]) })) : [];

    // Die auffälligen Zeilen -- GROSSGESCHRIEBENE Marker sind in beiden Prüfern die Befunde.
    const meldungen = aus
      .split("\n")
      .filter((z) => /^\s{2}(UNGESICHERT|DRIFT|FEHLT|gewollt draussen|NICHT GEPRUEFT)/.test(z) || /^FEHLER:/.test(z))
      .map((z) => z.trim())
      .slice(0, 40);

    return {
      ...grundlage,
      status,
      grund: status === "unlesbar" ? `Rückgabewert ${lauf.status} — nicht prüfbar, das ist kein „alles sauber“` : null,
      exitCode: lauf.status,
      kennzahlen,
      kennzahlenGelesen: Boolean(m),
      meldungen,
    };
  });
}

// ---------------------------------------------------------------------------
// BEREICH 5 — Sitzungs-Rollen (session-roles.js gibt selbst JSON aus)
// ---------------------------------------------------------------------------
function rollenMessen(wurzel) {
  const skript = path.join(wurzel, ".claude", "session-roles.js");
  // Die Herkunft ist der Pfad, den session-roles.js liest -- aber ob dort etwas
  // liegt, wird GEMESSEN. Fest verdrahtet nannte dieses Feld eine Datei, die das
  // Paket bewusst nicht mitliefert (manifest.json, „bewusstNichtEnthalten“): der
  // Empfaenger las eine Quellenangabe fuer Daten, die es bei ihm nicht gibt.
  const tabelle = path.join(wurzel, "docs", "08-sessions-rollen.md");
  const grundlage = {
    quelle: ".claude/session-roles.js",
    herkunft: fs.existsSync(tabelle)
      ? "docs/08-sessions-rollen.md"
      : "docs/08-sessions-rollen.md — in diesem Workspace nicht vorhanden; der Hook liest sie, wenn sie angelegt wird, und bleibt sonst still",
  };
  if (!fs.existsSync(skript)) return { ...grundlage, status: "fehlt", grund: "Hook nicht vorhanden", rollen: [] };

  const lauf = spawnSync(process.execPath, [skript], {
    cwd: wurzel,
    encoding: "utf8",
    timeout: 30000,
    env: { ...process.env, CLAUDE_PROJECT_DIR: wurzel },
  });
  if (lauf.error) return { ...grundlage, status: "unlesbar", grund: lauf.error.message, rollen: [] };
  if (!lauf.stdout || !lauf.stdout.trim()) {
    return { ...grundlage, status: "hinweis", grund: "Hook blieb still — Rollen-Tabelle fehlt (frischer Nachbau)", rollen: [] };
  }
  let text;
  try {
    text = JSON.parse(lauf.stdout).hookSpecificOutput.additionalContext;
  } catch (e) {
    return { ...grundlage, status: "unlesbar", grund: `Ausgabe war kein verwertbares JSON: ${e.message}`, rollen: [] };
  }
  const rollen = text
    .split("\n")
    .filter((z) => z.startsWith("- "))
    .map((z) => {
      const m = z.match(/^- (.+?) \[(.+?)\]: (.*)$/);
      return m ? { titel: m[1], ebene: m[2], zweck: m[3] } : { titel: z.slice(2), ebene: "?", zweck: "" };
    });
  return { ...grundlage, status: rollen.length ? "ok" : "hinweis", grund: null, rollen };
}

// ---------------------------------------------------------------------------
// BEREICH 6 — Betriebsbereitschaft (operator-readiness-dashboard, buildReport)
// ---------------------------------------------------------------------------
function readinessMessen(wurzel, mitGithub) {
  const { modul, pfad, grund } = eccLaden(wurzel, "operator-readiness-dashboard.js");
  if (!modul)
    // Der Betriebsbericht ist ein Werkzeug der Ursprungs-Werkbank und gehoert nicht
    // zum Standalone-Harness. Ihn als "fehlt" zu melden macht aus einer bewussten
    // Auslassung einen Defekt -- und eine Seite, die Nicht-Defekte rot faerbt, wird
    // nicht mehr gelesen. Gemeldet wird, dass hier nichts zu messen ist.
    return {
      status: "ok",
      grund: null,
      quelle: null,
      notiz: "Nicht Teil dieses Harness: der ECC-Betriebsbericht (operator-readiness-dashboard.js) gehoert zur Ursprungs-Werkbank. Hier gibt es dazu nichts zu messen.",
    };
  try {
    const argv = ["node", pfad, "--json", "--root", wurzel];
    if (!mitGithub) argv.push("--skip-github");
    const bericht = modul.buildReport(modul.parseArgs(argv));
    const zaehlung = {};
    for (const a of bericht.requirements || []) zaehlung[a.status] = (zaehlung[a.status] || 0) + 1;
    return {
      status: bericht.ready ? "ok" : "hinweis",
      grund: bericht.ready ? null : "Der ECC-Betriebsbericht meldet offene Punkte",
      quelle: rel(wurzel, pfad),
      befehl: `node ${rel(wurzel, pfad)} --json --write bericht.json${mitGithub ? "" : " --skip-github"}`,
      githubUebersprungen: !mitGithub,
      bereit: bericht.ready === true,
      branch: (bericht.platform || {}).branch || null,
      ungesichert: (bericht.platform || {}).blockingDirtyCount,
      zaehlung,
      anforderungen: (bericht.requirements || []).map((a) => ({
        id: a.id,
        anforderung: a.requirement,
        status: a.status,
        beleg: kurz(a.evidence),
        luecke: kurz(a.gap),
      })),
      naechsteSchritte: (bericht.top_actions || []).slice(0, 6).map(kurz).filter(Boolean),
      massnahme: bericht.ready
        ? null
        : {
            text:
              (bericht.top_actions || []).length
                ? `Offene Punkte des Betriebsberichts abarbeiten: ${kurz(bericht.top_actions[0])}`
                : "Betriebsbericht meldet offene Anforderungen — im Reiter „Vier Knoten“ steht, welche.",
            // Der GEMESSENE Fundort, nicht der der Ursprungs-Werkbank:
            // eccLaden() sucht in drei Ordnern, hier stand fest .ecc-src/.
            befehl: `node ${rel(wurzel, pfad)}`,
          },
    };
  } catch (e) {
    return { status: "unlesbar", grund: e.message, quelle: rel(wurzel, pfad) };
  }
}

// ---------------------------------------------------------------------------
// Zusammenführung
// ---------------------------------------------------------------------------
const RANG = { unlesbar: 4, befund: 3, fehlt: 2, hinweis: 1, ok: 0 };

function messen(optionen = {}) {
  const wurzel = path.resolve(optionen.wurzel || wurzelSuchen(__dirname) || process.cwd());
  const harness = path.join(wurzel, ".claude");
  if (!fs.existsSync(harness)) {
    throw new Error(`Keine Werkbank gefunden: ${harness} existiert nicht. Wurzel per --wurzel <pfad> angeben.`);
  }

  const daten = {
    schema: SCHEMA,
    gemessenAm: new Date().toISOString(),
    wurzel,
    harness: rel(wurzel, harness),
    node: process.version,
    bereiche: {
      kontext: kontextMessen(wurzel, harness),
      bestand: bestandMessen(wurzel, harness),
      waechter: waechterMessen(wurzel, harness),
      sicherung: repoStatusMessen(wurzel),
      pruefer: { status: "ok", laeufe: prueferMessen(wurzel) },
      rollen: rollenMessen(wurzel),
      readiness: readinessMessen(wurzel, optionen.mitGithub === true),
    },
  };

  daten.bereiche.verlauf = verlaufMessen(wurzel, daten.bereiche.sicherung.repos || []);

  // Der Bereich erbt den schlechtesten Lauf -- UND dessen Begruendung.
  // Ohne die zweite Haelfte stand hier "befund" ohne ein Wort dazu; die
  // Selbstkontrolle (daten.messfehler) hat genau das aufgedeckt. Ein Bereich,
  // der nicht sagen kann, was ihm fehlt, ist kein Bericht, sondern eine Ampel.
  const pr = daten.bereiche.pruefer;
  pr.status = pr.laeufe.reduce((a, p) => (RANG[p.status] > RANG[a] ? p.status : a), "ok");
  if (pr.status !== "ok") {
    const schlecht = pr.laeufe.filter((p) => p.status === pr.status);
    pr.grund =
      `${schlecht.length} Prüfer melden „${pr.status}“: ` +
      schlecht.map((p) => `${p.id}${p.meldungen?.length ? ` (${p.meldungen.length} Meldungen)` : ""}`).join(", ");
    // Bringt der Prüfer seine eigene Maßnahme mit (der Fall „nicht
    // installiert“), gilt sie. Sonst wird sie hier gebaut -- aber nur mit einem
    // Befehl, den es gibt.
    pr.massnahme = schlecht[0].massnahme || {
      text: schlecht[0].meldungen?.length
        ? `Befunde des Prüfers „${schlecht[0].id}“ abarbeiten — erste Meldung: ${schlecht[0].meldungen[0]}`
        : `Prüfer „${schlecht[0].id}“ von Hand laufen lassen und die Ausgabe lesen.`,
      befehl: schlecht[0].befehl || null,
    };
  }

  const alle = Object.values(daten.bereiche).map((b) => b.status);
  daten.gesamtstatus = alle.reduce((a, s) => (RANG[s] > RANG[a] ? s : a), "ok");
  daten.zaehlung = alle.reduce((a, s) => ({ ...a, [s]: (a[s] || 0) + 1 }), {});

  // ------------------------------------------------------------------------
  // ZU TUN — die Liste, die in der ersten Fassung fehlte.
  //
  // Regel aus dem Plan (§5, Reiter Lage): JEDER Bereich, der nicht "ok" ist, MUSS
  // hier eine Zeile erzeugen. Ein Hinweis ohne Handlung ist ein Messfehler und
  // wird als solcher ausgewiesen — nicht stillschweigend als Hinweis stehengelassen.
  // Sonst steht die Seite auf Gelb und niemand weiss, warum.
  // ------------------------------------------------------------------------
  daten.zuTun = [];
  daten.messfehler = [];
  for (const [id, b] of Object.entries(daten.bereiche)) {
    if (b.status === "ok") continue;
    const m = b.massnahme || null;
    if (m && m.text) {
      daten.zuTun.push({ bereich: id, status: b.status, grund: b.grund || null, text: m.text, befehl: m.befehl || null });
    } else if (b.grund) {
      daten.zuTun.push({ bereich: id, status: b.status, grund: b.grund, text: b.grund, befehl: null });
    } else {
      daten.messfehler.push({
        bereich: id,
        status: b.status,
        was: "Bereich nicht auf ok, aber ohne Grund und ohne Maßnahme — die Messung sagt nicht, was zu tun ist.",
      });
    }
  }

  daten.kontrolle = {
    herkunft: daten.bereiche.bestand?.kontrollprobe || null,
    zuTunVollstaendig: daten.messfehler.length === 0,
  };
  return daten;
}

module.exports = { messen, wurzelSuchen, SCHEMA, RANG };
