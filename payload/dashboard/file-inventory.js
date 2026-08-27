#!/usr/bin/env node
// INVENTAR -- der Dateibaum des Harness, mit Rolle und Beschreibung (Metadaten).
// Spezifikation v2, Abschnitte 7.1 (Baum + Schema), 7.2 (Beschreibungs-Rangfolge),
// 7.3 (Geheimnis-Schutz).
//
// SERVER-ZUERST (D1): der Dateiinhalt wird NICHT mehr eingebettet -- inhalt.text
// ist immer null, serve.js liefert den Rumpf auf Klick. Dieses Modul misst nur
// noch Auskuenfte ueber die Datei (Zeilenzahl, Sprache, ausgeblendete Zeilen).
//
// Dieses Modul erzeugt AUSSCHLIESSLICH Daten. Es kennt kein HTML, keine Farbe und
// keinen deutschen Satz fuer die Oberflaeche. Wo eine Formulierung noetig waere,
// steht hier ein sprachneutraler CODE (rolle, quelle, gesperrt, fehler.code);
// den Satz dazu setzt render/data.js. Wer hier einen Satz einbaut, hebt die
// Trennung auf, an der die Anzeige spaeter haengt.
//
// DREI RIEGEL GEGEN ZUGAENGE (7.3):
//   1. Inhalt verlaesst den Datensatz (D1)  => kein Dateikoerper wird eingebettet;
//      git-ignorierte Dateien werden gar nicht erst gelesen (gesperrt:"ignoriert").
//   2. textSichern()  => laeuft ueber JEDEN String, der in den Datensatz geht
//      (auch Beschreibung und Frontmatter, aus dem GESICHERTEN Text gezogen).
//   3. Ausgabe-Waechter in index.js  => prueft die fertige HTML gegen ZUGANGS_MUSTER.
//      Riegel 3 liegt bewusst NICHT hier; dafuer wird ZUGANGS_MUSTER exportiert,
//      damit index.js dieselbe Liste benutzt und keine Kopie pflegt.
//
// WINDOWS: alle Pfade im Datensatz sind POSIX (Vorwaertsschraegstriche); Vergleiche
// gegen git-Ausgaben laufen case-insensitiv; Zeilen werden einmal auf \n normalisiert
// (gemessen 23.08.2026: 27 von 45 Dateien liegen als CRLF auf der Platte).
//
// AUFRUF   const { inventar } = require("./file-inventory"); inventar(wurzel)

const fs = require("fs");
const path = require("path");
const url = require("url");
const { spawnSync } = require("child_process");

// Der Geheimnis-Filter liegt seit dem 23.08.2026 in einem eigenen Modul:
// eigene Aufgabe, eigene Gegenproben, drei Aufrufer.
const {
  ZUGANGS_MUSTER,
  AUSGEBLENDET,
  MINI_SPERRLISTE,
  textSichern,
  sperrgrund,
} = require("./access-filter.js");

// ---------------------------------------------------------------------------
// KONSTANTEN
// ---------------------------------------------------------------------------

// Riegel 2. Reihenfolge und Wortlaut wie Spezifikation 7.3. Kein g-Flag: eine
// RegExp mit g merkt sich lastIndex und liefert bei wiederholtem test() abwechselnd
// false -- genau die Art stiller Luecke, die ein Geheimnis durchlaesst.
// Muster 1 traegt i, weil API_KEY/Api-Key genauso vorkommen wie api_key.
//
// WARUM MUSTER 1 EINE AUSSCHLUSSLISTE HAT
// Die erste Fassung war /...\s*[:=]\s*\S{8,}/i und traf am eigenen Bestand 13 Zeilen,
// davon 8 harmlos -- darunter ausgerechnet `const apiKey = process.env.OPENAI_API_KEY`
// (die vorbildliche Zeile aus der Sicherheitsregel) und die Farbtabelle
// `token: "--status-ok"`. Ein Filter, der Richtiges unkenntlich macht, wird
// abgeschaltet und schuetzt danach gar nichts. Deshalb: ein Zugang wird nur
// erkannt, wenn der WERT wie ein Geheimnis aussieht -- nicht, wenn er ein
// Verweis darauf ist (Umgebungsvariable, Platzhalter, CSS-Eigenschaft).

// SERVER-ZUERST (D1): der Rumpf wird nicht mehr eingebettet, also gibt es auch
// keine Einbettungs-Kappung (frueher GRENZE_BYTES/GRENZE_ZEILEN/KAPPUNG_ZEILEN)
// mehr -- serve.js liefert die ganze Datei auf Klick, gedeckelt nur von der
// harten Obergrenze. Eine Kappung im Datensatz waere jetzt eine falsche Auskunft
// (die Datei kaeme trotzdem ganz), und ein gekapptes Bearbeiten hiesse
// Datenverlust beim Speichern.
const BINAER_FENSTER = 8192; // NUL-Byte-Suche in den ersten 8 KB
const HART_MAX_BYTES = 8 * 1024 * 1024; // darueber wird gar nicht erst gelesen
const MAX_TIEFE = 12; // Schutz gegen Verweis-Schleifen

const ORDNER_AUSSCHLUSS = new Set([".git", "node_modules"]);
const WURZEL_DATEI_AUSSCHLUSS = new Set(["dashboard.html", "dashboard.json"]);
const PROJEKT_ORDNER = "user-projects";

const SPRACHE = { js: "js", mjs: "js", cjs: "js", json: "json", md: "md", html: "html", css: "css" };

// ---------------------------------------------------------------------------
// KLEINE HELFER
// ---------------------------------------------------------------------------

const posix = (p) => String(p).split("\\").join("/").split(path.sep).join("/");

const zeilenAufteilen = (text) => String(text == null ? "" : text).split(/\r?\n/);

// Zeilen OHNE leere Schlusszeile. CRLF und LF muessen dieselbe Zahl ergeben --
// das ist der Grund, warum hier nicht auf "\n" allein getrennt wird.
function zeilenZaehlen(text) {
  const teile = zeilenAufteilen(text);
  if (teile.length && teile[teile.length - 1] === "") teile.pop();
  return teile.length;
}

function zeilenendeArt(text) {
  const alle = (text.match(/\n/g) || []).length;
  if (!alle) return null;
  const crlf = (text.match(/\r\n/g) || []).length;
  if (crlf === 0) return "lf";
  return crlf === alle ? "crlf" : "gemischt";
}

// ".gitignore" hat keine Endung im ueblichen Sinn, ist aber auch nicht endungslos.
function extVon(name) {
  const punkt = name.lastIndexOf(".");
  if (punkt <= 0) return name.startsWith(".") ? name.slice(1).toLowerCase() : "";
  return name.slice(punkt + 1).toLowerCase();
}

const spracheVon = (ext) => SPRACHE[ext] || "text";

const dateiname = (relPosix) => relPosix.slice(relPosix.lastIndexOf("/") + 1);

const zeileFinden = (zeilen, nadel) => {
  const i = zeilen.findIndex((z) => z.includes(nadel));
  return i < 0 ? null : i + 1;
};

const beleg = (datei, von, bis) => (bis && bis !== von ? `${datei}:${von}-${bis}` : `${datei}:${von}`);

// ---------------------------------------------------------------------------
// GIT-STATUS -- genau zwei Laeufe, wie in 7.1 festgelegt
// ---------------------------------------------------------------------------
function gitLauf(wurzel, argumente) {
  const lauf = spawnSync("git", ["--no-optional-locks", "-C", wurzel, ...argumente], {
    encoding: "utf8",
    timeout: 20000,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (lauf.error) {
    const code = lauf.error.code === "ENOENT" ? "git-fehlt" : "git-fehler";
    return { ok: false, code, grund: lauf.error.message };
  }
  if (lauf.status !== 0) {
    return { ok: false, code: "git-fehler", grund: `exit ${lauf.status}: ${String(lauf.stderr || "").trim().slice(0, 300)}` };
  }
  return { ok: true, eintraege: String(lauf.stdout || "").split("\0").filter(Boolean) };
}

// Faellt git aus, bekommt JEDE Datei "unbekannt" -- nie stillschweigend "getrackt".
// Ein Werkzeugausfall darf nicht aussehen wie ein bestandener Test.
function gitStatusLesen(wurzel) {
  const stand = { vorhanden: false, getrackt: new Set(), ignoriert: new Set(), ignoriertOrdner: [], fehler: [] };
  const spur = gitLauf(wurzel, ["ls-files", "-z"]);
  if (!spur.ok) {
    stand.fehler.push({ code: spur.code, grund: spur.grund, befehl: "git ls-files" });
    return stand;
  }
  const aus = gitLauf(wurzel, ["ls-files", "--others", "--ignored", "--exclude-standard", "-z"]);
  if (!aus.ok) {
    stand.fehler.push({ code: aus.code, grund: aus.grund, befehl: "git ls-files --others --ignored --exclude-standard" });
    return stand;
  }
  stand.vorhanden = true;
  for (const e of spur.eintraege) stand.getrackt.add(e.toLowerCase());
  // git listet einen komplett ignorierten Ordner als "pfad/" und steigt nicht hinein.
  for (const e of aus.eintraege) {
    if (e.endsWith("/")) stand.ignoriertOrdner.push(e.slice(0, -1).toLowerCase());
    else stand.ignoriert.add(e.toLowerCase());
  }
  return stand;
}

// Windows-Dateisystem: Vergleich case-insensitiv, sonst gilt .Claude/X als ungetrackt.
function gitFuer(relPosix, stand) {
  if (!stand.vorhanden) return "unbekannt";
  const k = relPosix.toLowerCase();
  if (stand.getrackt.has(k)) return "getrackt";
  if (stand.ignoriert.has(k)) return "ignoriert";
  if (stand.ignoriertOrdner.some((d) => k === d || k.startsWith(d + "/"))) return "ignoriert";
  return "ungetrackt";
}

// ---------------------------------------------------------------------------
// VERDRAHTUNG -- welches Skript haengt an welchem Ereignis (fuer rolle + Beschreibung)
// ---------------------------------------------------------------------------
function settingsLesen(wurzel) {
  const stand = { hooks: new Map(), ansagen: new Map(), fehler: [] };
  for (const name of ["settings.json", "settings.local.json"]) {
    const abs = path.join(wurzel, ".claude", name);
    if (!fs.existsSync(abs)) continue;
    const datei = ".claude/" + name;
    let roh;
    try {
      roh = fs.readFileSync(abs, "utf8");
    } catch (e) {
      stand.fehler.push({ code: "settings-unlesbar", pfad: datei, grund: e.message });
      continue;
    }
    let daten;
    try {
      daten = JSON.parse(roh);
    } catch (e) {
      stand.fehler.push({ code: "settings-unlesbar", pfad: datei, grund: e.message });
      continue;
    }
    settingsEintragen(stand, daten, zeilenAufteilen(roh), datei);
  }
  return stand;
}

function settingsEintragen(stand, daten, zeilen, datei) {
  if (!daten || typeof daten !== "object" || Array.isArray(daten)) return;
  for (const [ereignis, gruppen] of Object.entries(daten.hooks || {})) {
    for (const g of gruppen || []) {
      for (const h of (g && g.hooks) || []) skriptMerken(stand, h, ereignis, (g && g.matcher) || null, zeilen, datei);
    }
  }
  // statusLine ist KEIN Hook (Spezifikation 4.4) -- aber dasselbe Skript-Verhaeltnis.
  if (daten.statusLine) skriptMerken(stand, daten.statusLine, "statusLine", null, zeilen, datei);
}

function skriptMerken(stand, eintrag, ereignis, matcher, zeilen, datei) {
  const befehl = String((eintrag && eintrag.command) || "");
  const skript = (befehl.match(/([\w.-]+\.(?:js|mjs|cjs))/) || [])[1];
  if (!skript) return;
  const liste = stand.hooks.get(skript) || [];
  liste.push({ ereignis, matcher, datei, zeile: zeileFinden(zeilen, skript) });
  stand.hooks.set(skript, liste);
  const ansage = eintrag && typeof eintrag.statusMessage === "string" ? eintrag.statusMessage : null;
  if (!ansage || stand.ansagen.has(skript)) return;
  stand.ansagen.set(skript, { text: textSichern(ansage).text, datei, zeile: zeileFinden(zeilen, ansage) });
}

function claudeMdLesen(wurzel) {
  const abs = path.join(wurzel, "CLAUDE.md");
  if (!fs.existsSync(abs)) return { zeilen: [], fehler: [{ code: "claudemd-fehlt", pfad: "CLAUDE.md" }] };
  try {
    return { zeilen: zeilenAufteilen(fs.readFileSync(abs, "utf8")), fehler: [] };
  } catch (e) {
    return { zeilen: [], fehler: [{ code: "claudemd-unlesbar", pfad: "CLAUDE.md", grund: e.message }] };
  }
}

// Die Waechter-Tabelle in CLAUDE.md 3 nennt je Skript eine Zeile: | `x.js` | wann | was |.
function claudeMdZeile(zeilen, name) {
  for (let i = 0; i < zeilen.length; i++) {
    const z = zeilen[i].trim();
    if (!z.startsWith("|") || !z.includes("`" + name + "`")) continue;
    const zellen = z.split("|").slice(1, -1).map((s) => s.trim());
    const text = zellen.slice(1).filter(Boolean).join(" - ");
    if (!text) continue;
    return { text, zeile: i + 1 };
  }
  return null;
}

// ---------------------------------------------------------------------------
// ROLLE -- die 15 Codes aus 7.1 (das UI-Wort dazu setzt render/data.js, 5.3)
// ---------------------------------------------------------------------------
function rolleFuer(relPosix, verdrahtung, hatFrontmatter) {
  const name = dateiname(relPosix);
  if (relPosix === "CLAUDE.md") return "wurzel-kontext";
  if (relPosix === ".gitignore") return "gitignore";
  if (relPosix === ".claude/settings.json" || relPosix === ".claude/settings.local.json") return "settings";
  if (relPosix === ".claude/launch.json") return "launch";
  if (relPosix.startsWith(".claude/commands/")) return "command";
  if (relPosix.startsWith(".claude/skills/")) return name === "SKILL.md" ? "skill" : "skill-datei";
  // Eine Regel MIT Frontmatter (---) laedt auf Abruf, eine OHNE laedt in jeder
  // Sitzung (Dauer-Kontext). Das ist die echte Eigenschaft -- nicht der Ordner
  // (keel/ vs common/ vs ecc/). Ein Sprachpaket unter .claude/rules/ecc/ traegt
  // Frontmatter und darf NICHT als Dauer-Regel gezaehlt werden (sonst zaehlt die
  // Kontext-Kostenrechnung abrufbare Pakete als immer geladen mit).
  if (relPosix.startsWith(".claude/rules/")) return hatFrontmatter ? "abruf-regel" : "dauer-regel";
  if (relPosix.startsWith(".claude/") && /\.(js|mjs|cjs)$/.test(name)) return rolleSkript(name, verdrahtung);
  if (relPosix.startsWith("dashboard/")) return /\.md$/i.test(name) ? "dashboard-doku" : "dashboard-modul";
  if (relPosix.startsWith("docs/")) return "doku";
  if (relPosix.startsWith("licenses/")) return "lizenz";
  return "sonstiges";
}

// statusline.js ist verdrahtet, aber KEIN Hook (Spezifikation 4.4: eigener
// Abschnitt, kein Hook). Es bekommt daher rolle "skript"; die Verdrahtung selbst
// steht am Knoten im Feld `verdrahtung` und geht dadurch nicht verloren.
function rolleSkript(name, verdrahtung) {
  const eintraege = (verdrahtung && verdrahtung.get(name)) || [];
  return eintraege.some((e) => e.ereignis !== "statusLine") ? "hook-skript" : "skript";
}

// ---------------------------------------------------------------------------
// QUELLEN FUER DIE BESCHREIBUNG
// ---------------------------------------------------------------------------
function entwerten(s) {
  const t = s.trim();
  if (t.length < 2) return t;
  const auf = t[0];
  if ((auf === '"' || auf === "'") && t.endsWith(auf)) {
    const kern = t.slice(1, -1);
    return auf === "'" ? kern.split("''").join("'") : kern;
  }
  return t;
}

function frontmatterLesen(text) {
  const zeilen = zeilenAufteilen(text);
  if (!zeilen.length || zeilen[0].trim() !== "---") return null;
  const felder = {};
  const zeilenNr = {};
  for (let i = 1; i < zeilen.length; i++) {
    if (zeilen[i].trim() === "---") return { felder, zeilenNr, ende: i + 1 };
    const m = zeilen[i].match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!m) continue;
    const schluessel = m[1].toLowerCase();
    felder[schluessel] = entwerten(m[2]);
    zeilenNr[schluessel] = i + 1;
  }
  return null; // ohne schliessendes --- ist es kein Frontmatter, sondern Fliesstext
}

// Frontmatter-WERTE sichern, ohne die STRUKTUR anzutasten. Zwei Gruende, beide
// aus der Nachpruefung (23.08.2026):
//   - textSichern auf den ganzen Rohtext konnte die schliessende ---Zeile
//     maskieren (WERT_FOLGT nach einem leeren Geheimnis-Schluessel) -- dann fand
//     frontmatterLesen das Ende nicht mehr und die Regel wurde fehlklassifiziert.
//   - Ein blosser WERT ohne Schluessel trifft ZUGANGS_MUSTER nie; die Engstelle
//     in data.js koennte ihn also nicht fangen.
// Deshalb: Struktur aus dem ROHTEXT lesen (frontmatterLesen), und je Feld die
// Zeile "schluessel: wert" pruefen -- schlaegt der Filter an, kommt der Wert
// maskiert in den Datensatz.
function frontmatterSichern(felder) {
  const raus = {};
  for (const [k, v] of Object.entries(felder)) {
    const zeile = k + ": " + (v == null ? "" : String(v));
    raus[k] = textSichern(zeile).ausgeblendeteZeilen.length ? AUSGEBLENDET : v;
  }
  return raus;
}

// Erster Kommentarblock: //-Zeilen ab Zeile 2, Shebang uebersprungen, bis zur
// ersten leeren //-Zeile. Genau der Block, den 7.1 als Beleg ".../x.js:2-3" zeigt.
function kopfkommentar(text) {
  const zeilen = zeilenAufteilen(text);
  let i = zeilen[0] && zeilen[0].startsWith("#!") ? 1 : 0;
  while (i < zeilen.length && zeilen[i].trim() === "") i++;
  if (i >= zeilen.length || !/^\s*\/\//.test(zeilen[i])) return null;
  const von = i + 1;
  const stuecke = [];
  while (i < zeilen.length && /^\s*\/\//.test(zeilen[i])) {
    const kern = zeilen[i].replace(/^\s*\/\/\s?/, "").trim();
    if (!kern) break;
    stuecke.push(kern);
    i++;
  }
  return stuecke.length ? { text: stuecke.join(" "), von, bis: i } : null;
}

// Erster ECHTER Beschreibungs-Absatz einer .md. Der erste Absatz einer Datei ist
// oft KEINE Beschreibung, sondern eine Notiz -- darum wird absatzweise geprueft
// und uebersprungen, was keine Beschreibung ist (belegt an mehreren Dateien,
// 23.08.2026, verschaerft nach dem Review):
//   - Ueberschrift, Trennlinie, Leerzeile, Code-Zaun samt Inhalt (S3)
//   - Meta-/Anreisser-Absatz "Anlass:", "Stand 23.08.", "Quelle:" (S2) -- auch
//     wenn er als "**Anlass:**" oder "> Anlass:" getarnt ist (Review-Fund)
//   - eine Tabellenzeile "| ... | ... |" (Review-Fund)
//   - ein blosser Pfad oder Dateiname
// Eine Blockquote wird NICHT mehr pauschal verworfen: ihre Marke wird entfernt
// und der Inhalt auf Meta geprueft -- so faellt "> Anlass:" weg, aber ein echter
// Einleitungssatz im Zitat (z. B. in CLAUDE.md) bleibt erhalten.
// Der genommene Text wird als KLARTEXT geliefert (Marken und **/*/`-Auszeichnung
// entfernt) und in beschreibungFuer auf MAX_BESCHREIBUNG_ZEICHEN gekappt.
// Trenner-Klasse ueber Unicode-ESCAPES, damit die Quelle ASCII bleibt (Test A79):
// en-dash 2013, em-dash 2014, Mittelpunkt 00b7, Umlaut-a 00e4.
const META_ANFANG = /^(Anlass|Quelle|Datum|Autor|Status|Siehe|Verwandt|Update)\b\s*[:\u2013\u2014-]/i;
const STAND_ANFANG = /^Stand\b\s*[:\u00b7\u2013\u2014-]?\s*(?:v?\d|Phase\b|[A-Z][a-z\u00e4]+\s+\d)/i;
const MAX_BESCHREIBUNG_ZEICHEN = 240;

// Fuehrende Zitat-/Ueberschrift-/Listenmarke einer Zeile weg (fuer die erste
// Zeile eines Absatzes bzw. jede Zeile eines Blockquotes).
function markenWeg(zeile, auchListe) {
  let s = zeile.replace(/^\s*>+\s?/, "").replace(/^\s*#+\s+/, "");
  if (auchListe) s = s.replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/, "");
  return s;
}

// Markdown-Auszeichnung entfernen -- die Beschreibung wird als Klartext gezeigt,
// **fett**, *kursiv* und `code` erschienen sonst als blosse Zeichen.
function auszeichnungWeg(s) {
  return s
    .replace(/`+([^`]*)`+/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/(^|[\s(])_([^_]+)_(?=[\s).,;:!?]|$)/g, "$1$2");
}

// Ein Absatz -> sauberer Klartext: Marken der ersten Zeile und Zitatmarken aller
// Zeilen weg, verbinden, Auszeichnung weg, Leerraum normalisieren.
function absatzText(stuecke) {
  const zeilen = stuecke.map((z, i) => markenWeg(z, i === 0));
  return auszeichnungWeg(zeilen.join(" ")).replace(/\s+/g, " ").trim();
}

// Eine Beschreibung ist eine Zeile Auskunft, kein Ausschnitt. Ueberlaeuft sie
// MAX_BESCHREIBUNG_ZEICHEN, wird an einer Wortgrenze gekappt (Review-Fund: sonst
// standen 2455-Zeichen-Bloecke mehrfach im Datensatz).
function kappen(text) {
  if (!text || text.length <= MAX_BESCHREIBUNG_ZEICHEN) return text;
  let kurz = text.slice(0, MAX_BESCHREIBUNG_ZEICHEN);
  const luecke = kurz.lastIndexOf(" ");
  if (luecke > MAX_BESCHREIBUNG_ZEICHEN * 0.6) kurz = kurz.slice(0, luecke);
  return kurz.replace(/[\s.,;:\u2013\u2014-]+$/, "") + " \u2026";
}

function nurPfad(text) {
  const s = text.trim();
  return !/\s/.test(s) && /[./]/.test(s) && !/[.!?]$/.test(s);
}

function istBeschreibungsAbsatz(stuecke) {
  if (!stuecke.length) return false;
  // Tabellenzeile ist keine Beschreibung.
  if ((stuecke[0].match(/\|/g) || []).length >= 2) return false;
  // Marken + Auszeichnung der ersten Zeile weg, DANN auf Meta pruefen -- sonst
  // rutscht "**Anlass:**" oder "> Anlass:" am Filter vorbei.
  const erste = auszeichnungWeg(markenWeg(stuecke[0], true)).trim();
  if (!erste) return false;
  if (META_ANFANG.test(erste) || STAND_ANFANG.test(erste)) return false;
  if (nurPfad(absatzText(stuecke))) return false;
  return true;
}

function ersterAbsatz(text, abZeile) {
  const zeilen = zeilenAufteilen(text);
  const trenner = (z) => !z || /^#{1,6}\s/.test(z) || /^(-{3,}|={3,}|\*{3,})$/.test(z) || /^(```|~~~)/.test(z);
  let i = abZeile || 0;
  let imZaun = false;
  while (i < zeilen.length) {
    const z = zeilen[i].trim();
    if (/^(```|~~~)/.test(z)) { imZaun = !imZaun; i++; continue; }
    if (imZaun) { i++; continue; }
    if (trenner(z)) { i++; continue; }
    // Ein Absatz beginnt. Ganz einsammeln (bis Trenner/Zaun).
    const von = i + 1;
    const stuecke = [];
    while (i < zeilen.length && !trenner(zeilen[i].trim())) {
      stuecke.push(zeilen[i].trim());
      i++;
    }
    if (istBeschreibungsAbsatz(stuecke)) {
      return { text: absatzText(stuecke), von, bis: von + stuecke.length - 1 };
    }
    // sonst: naechsten Absatz versuchen
  }
  return null;
}

// ---------------------------------------------------------------------------
// BESCHREIBUNGS-RANGFOLGE (7.2)
// ---------------------------------------------------------------------------
// Reihenfolge nach LESER-NUTZEN, nicht nach dem Beispielschema der Spezifikation
// (7.2 nannte Frontmatter -> statusMessage -> CLAUDE.md -> Kopfkommentar). Der
// TATSAECHLICHE Rang, den dieses Array setzt:
//
//   Frontmatter -> CLAUDE.md-Zeile -> Kopf-/#-Kommentar -> statusMessage
//   -> erster Absatz -> Rolle/Typ
//
// Zwei bewusste Abweichungen, beide am Code belegt (23.08.2026):
//   A) Ein echter SATZ schlaegt ein Statusleisten-ETIKETT. Die acht
//      statusMessage-Werte in settings.json sind Fortschrittsetiketten (10-52
//      Zeichen, kein Satz, z. B. "danger-guard (zerstoerende Befehle)"). Darum
//      steht stufeAnsage HINTER stufeKopfkommentar/stufeRaute -- ein echter
//      Kopfkommentar gewinnt gegen das Etikett (A1).
//   B) Die CLAUDE.md-Zeile steht VOR dem Kopfkommentar: fuer danger-guard.js
//      trug CLAUDE.md den besseren Satz ("blockiert zerstoerende Befehle
//      ausserhalb der erlaubten Schreibziele"), der Kopfkommentar nur
//      "PreToolUse-Hook fuer Bash. Schwester von git-guard.js -- aber dieser
//      hier BLOCKIERT".
//
// Verloren geht nichts: jede weitere Fundstelle bleibt in `weitereQuellen`.
const STUFEN = [stufeFrontmatter, stufeClaudeMd, stufeKopfkommentar, stufeRaute, stufeHtml, stufeAnsage, stufeAbsatz, stufeRolle];

function stufeFrontmatter(lage) {
  if (lage.ext !== "md" || !lage.text) return null;
  const fm = frontmatterLesen(lage.text);
  const wert = fm && fm.felder.description;
  if (!wert) return null;
  return { text: textSichern(wert).text, quelle: "frontmatter", beleg: beleg(lage.pfad, fm.zeilenNr.description) };
}

function stufeKopfkommentar(lage) {
  if (!/^(js|mjs|cjs)$/.test(lage.ext) || !lage.text) return null;
  const k = kopfkommentar(lage.text);
  if (!k) return null;
  return { text: textSichern(k.text).text, quelle: "kopfkommentar", beleg: beleg(lage.pfad, k.von, k.bis) };
}

// Erster #-Kommentarblock einer Skript-/Konfigurationsdatei (Shebang wird
// uebersprungen). In .md ist "#" eine Ueberschrift und in JS ist "//" der
// Kommentar -- deshalb greift diese Stufe nur, wo "#" wirklich Kommentar heisst.
// Damit bekommt z. B. ein Python-Skript mit "# Baut ..." eine echte Beschreibung
// statt nur "Python-Skript" aus dem Typ-Fallback.
const RAUTE_TYPEN = /^(py|sh|bash|zsh|rb|toml|ya?ml|ini|cfg|conf|ps1|pl|r)$/;
function rauteKommentar(text) {
  const zeilen = zeilenAufteilen(text);
  let i = zeilen[0] && zeilen[0].startsWith("#!") ? 1 : 0;
  while (i < zeilen.length && zeilen[i].trim() === "") i++;
  if (i >= zeilen.length || !/^\s*#/.test(zeilen[i]) || /^\s*#!/.test(zeilen[i])) return null;
  const von = i + 1;
  const stuecke = [];
  while (i < zeilen.length && /^\s*#/.test(zeilen[i])) {
    const kern = zeilen[i].replace(/^\s*#+\s?/, "").trim();
    if (!kern) break;
    stuecke.push(kern);
    i++;
  }
  return stuecke.length ? { text: stuecke.join(" "), von, bis: i } : null;
}

// Ein HTML-Dokument traegt seinen Satz im ersten <!-- ... -->. Ohne diese Stufe
// faellt es auf seinen Dateityp zurueck ("HTML-Dokument.") [27.08.2026].
function stufeHtml(lage) {
  if (!/^html?$/.test(lage.ext) || !lage.text) return null;
  const m = String(lage.text).match(/^\s*<!--([\s\S]*?)-->/);
  if (!m) return null;
  const text = m[1].replace(/\s+/g, " ").trim();
  if (!text) return null;
  const bis = zeilenAufteilen(String(lage.text).slice(0, m.index + m[0].length)).length;
  return { text: textSichern(text).text, quelle: "kopfkommentar", beleg: beleg(lage.pfad, 1, bis) };
}

function stufeRaute(lage) {
  if (!RAUTE_TYPEN.test(lage.ext) || !lage.text) return null;
  const k = rauteKommentar(lage.text);
  if (!k) return null;
  return { text: textSichern(k.text).text, quelle: "kopfkommentar", beleg: beleg(lage.pfad, k.von, k.bis) };
}

function stufeAnsage(lage) {
  const a = lage.ansagen && lage.ansagen.get(lage.name);
  if (!a || !a.text) return null;
  return { text: a.text, quelle: "statusmessage", beleg: a.zeile ? beleg(a.datei, a.zeile) : a.datei };
}

function stufeClaudeMd(lage) {
  const t = claudeMdZeile(lage.claudeMd || [], lage.name);
  if (!t) return null;
  return { text: textSichern(t.text).text, quelle: "claude-md", beleg: beleg("CLAUDE.md", t.zeile) };
}

function stufeAbsatz(lage) {
  if (lage.ext !== "md" || !lage.text) return null;
  const fm = frontmatterLesen(lage.text);
  const a = ersterAbsatz(lage.text, fm ? fm.ende : 0);
  if (!a) return null;
  return { text: textSichern(a.text).text, quelle: "absatz", beleg: beleg(lage.pfad, a.von, a.bis) };
}

// Rollen-Beschreibung (7.2, v2): der SATZ steht in render/data.js, hier nur der Code.
// Sie greift fuer alles, was keine .md/.js ist -- also settings.json, launch.json,
// .gitignore, licenses/*.txt. Fuer .md/.js ohne Quelle bleibt es bei null, damit
// dort der Fallback der Anzeige greift (A6).
function stufeRolle(lage) {
  if (/^(md|js|mjs|cjs)$/.test(lage.ext)) return null;
  return { text: null, quelle: "rolle", rolle: lage.rolle, beleg: null };
}

function beschreibungFuer(pfad, inhalt, kontext) {
  const k = kontext || {};
  const relPosix = posix(pfad);
  const lage = {
    pfad: relPosix,
    name: dateiname(relPosix),
    ext: k.ext || extVon(dateiname(relPosix)),
    rolle: k.rolle || "sonstiges",
    text: typeof inhalt === "string" ? inhalt : null,
    ansagen: k.ansagen || null,
    claudeMd: k.claudeMd || null,
  };
  let treffer = null;
  const weitereQuellen = [];
  for (const stufe of STUFEN) {
    const fund = stufe(lage);
    if (!fund) continue;
    if (!treffer) treffer = fund;
    else if (fund.quelle !== "rolle") weitereQuellen.push({ quelle: fund.quelle, beleg: fund.beleg });
  }
  if (!treffer) return null;
  // Klartext + Kappung fuer JEDE Quelle an EINER Stelle: eine claude-md-Tabellen-
  // zelle kann **fett** tragen, ein Absatz kann lang sein. So ist die angezeigte
  // Beschreibung ueberall Klartext und hoechstens MAX_BESCHREIBUNG_ZEICHEN lang.
  if (typeof treffer.text === "string") {
    treffer = { ...treffer, text: kappen(auszeichnungWeg(treffer.text).replace(/\s+/g, " ").trim()) };
  }
  return { ...treffer, weitereQuellen };
}

function dateiInhalt(abs, relPosix, ext, git, gitVorhanden, bytes) {
  const leer = { text: null, sprache: spracheVon(ext), gesperrt: null, ausgeblendeteZeilen: [] };
  const gesperrt = sperrgrund(relPosix, git, gitVorhanden) || (bytes > HART_MAX_BYTES ? "zu-gross" : null);
  if (gesperrt) return { inhalt: { ...leer, gesperrt }, zeilen: null, zeilenende: null };
  let roh;
  try {
    roh = fs.readFileSync(abs);
  } catch (e) {
    return {
      inhalt: { ...leer, gesperrt: "unlesbar" },
      zeilen: null,
      zeilenende: null,
      fehler: { code: "datei-unlesbar", pfad: relPosix, grund: e.message },
    };
  }
  if (roh.subarray(0, BINAER_FENSTER).includes(0)) return { inhalt: { ...leer, gesperrt: "binaer" }, zeilen: null, zeilenende: null };
  const text = roh.toString("utf8");
  const zeilen = zeilenZaehlen(text);
  // SERVER-ZUERST (Entscheidung D1, 23.08.2026): der TEXT verlaesst den
  // Datensatz. Gemessen wird er trotzdem -- Zeilenzahl, Zeilenende und die
  // ausgeblendeten Zugangszeilen sind Auskuenfte ueber die Datei -- aber der
  // Inhalt kommt auf Klick von serve.js (GET /datei), nicht aus der Seite.
  // Das spart ~1,1 MB und ist der Grund, aus dem es serve.js gibt. Der
  // Zeilenfilter laeuft hier nur noch, um die AUSGEBLENDETEN Zeilen zu zaehlen;
  // serve.js filtert beim Ausliefern erneut.
  //
  // rohtext wird als SEITENFELD zurueckgegeben (nicht in inhalt), damit die
  // Messung Frontmatter und Beschreibung daraus ziehen kann. Der dateiKnoten
  // nimmt es NICHT in den Knoten auf -- es verlaesst die Messung nicht.
  const gesichert = textSichern(text);
  return {
    inhalt: { ...leer, text: null, ausgeblendeteZeilen: gesichert.ausgeblendeteZeilen },
    zeilen,
    zeilenende: zeilenendeArt(text),
    rohtext: text,
  };
}

// ---------------------------------------------------------------------------
// KNOTEN
// ---------------------------------------------------------------------------
function dateiKnoten(abs, relPosix, umgebung) {
  const name = dateiname(relPosix);
  const ext = extVon(name);
  let daten;
  try {
    daten = fs.statSync(abs);
  } catch (e) {
    umgebung.fehler.push({ code: "datei-unlesbar", pfad: relPosix, grund: e.message });
    daten = null;
  }
  const git = gitFuer(relPosix, umgebung.git);
  const bytes = daten ? daten.size : null;
  const g = daten
    ? dateiInhalt(abs, relPosix, ext, git, umgebung.git.vorhanden, bytes)
    : { inhalt: { text: null, sprache: spracheVon(ext), gesperrt: "unlesbar", ausgeblendeteZeilen: [] }, zeilen: null, zeilenende: null, rohtext: null };
  if (g.fehler) umgebung.fehler.push(g.fehler);
  // SICHERHEIT (Sicherheits-Review + Nachpruefung, 23.08.2026): die STRUKTUR des
  // Frontmatters kommt aus dem ROHTEXT (frontmatterLesen findet so das
  // schliessende ---, auch wenn eine Wertzeile ein Zugang waere), die WERTE
  // werden einzeln gesichert (frontmatterSichern). So leckt kein Zugang ueber das
  // frontmatter-Feld, und die Regel wird korrekt als Dauer/Abruf klassifiziert.
  // Die Beschreibung laeuft ueber g.rohtext: jede Stufe sichert ihren eigenen
  // Ausgabetext (textSichern), und data.js sichert den Datensatz als Ganzes.
  // (inhalt.text ist seit D1 null; g.rohtext verlaesst die Messung nicht.)
  const fm = ext === "md" && g.rohtext ? frontmatterLesen(g.rohtext) : null;
  // Die rolle wird NACH dem Frontmatter bestimmt: eine Regel mit Frontmatter
  // laedt auf Abruf, ohne laedt dauerhaft (siehe rolleFuer). Darum erst hier.
  const rolle = rolleFuer(relPosix, umgebung.verdrahtung.hooks, !!fm);
  const knoten = {
    id: "datei:" + relPosix,
    pfad: relPosix,
    name,
    typ: "datei",
    ext,
    bytes,
    zeilen: g.zeilen,
    zeilenende: g.zeilenende,
    geaendert: daten ? daten.mtime.toISOString() : null,
    git,
    rolle,
    beschreibung: beschreibungFuer(relPosix, g.rohtext, {
      rolle,
      ext,
      ansagen: umgebung.verdrahtung.ansagen,
      claudeMd: umgebung.claudeMd,
    }),
    inhalt: g.inhalt,
    frontmatter: fm ? frontmatterSichern(fm.felder) : null,
  };
  const v = umgebung.verdrahtung.hooks.get(name);
  if (v && relPosix.startsWith(".claude/")) knoten.verdrahtung = v;
  return knoten;
}

// Ordner zuerst, dann alphabetisch (Spezifikation 4.3).
function kinderSortierung(a, b) {
  const dateiA = a.typ === "datei" ? 1 : 0;
  const dateiB = b.typ === "datei" ? 1 : 0;
  if (dateiA !== dateiB) return dateiA - dateiB;
  return a.name.localeCompare(b.name, "en");
}

function ordnerUeberspringen(name, relPosix, umgebung) {
  if (ORDNER_AUSSCHLUSS.has(name)) return true;
  const k = relPosix.toLowerCase();
  return umgebung.git.ignoriertOrdner.some((d) => k === d || k.startsWith(d + "/"));
}

// user-projects wird NICHT begangen (7.1): der Ordner erscheint als Knoten, seine
// Kinder sind die Repos als Blaetter. Ohne diese Grenze zieht der Baum ganze
// fremde Projektbaeume in den Datensatz.
function projektKnoten(wurzel, umgebung) {
  const knoten = { id: "ordner:" + PROJEKT_ORDNER, pfad: PROJEKT_ORDNER, name: PROJEKT_ORDNER, typ: "ordner", begangen: false, kinder: [], anzahlDateien: 0 };
  let eintraege;
  try {
    eintraege = fs.readdirSync(path.join(wurzel, PROJEKT_ORDNER), { withFileTypes: true });
  } catch (e) {
    umgebung.fehler.push({ code: "ordner-unlesbar", pfad: PROJEKT_ORDNER, grund: e.message });
    return knoten;
  }
  for (const e of eintraege) {
    if (!e.isDirectory()) continue;
    const rel = PROJEKT_ORDNER + "/" + e.name;
    knoten.kinder.push({ id: "repo:" + e.name, pfad: rel, name: e.name, typ: "repo", git: gitFuer(rel, umgebung.git) });
  }
  knoten.kinder.sort(kinderSortierung);
  return knoten;
}

function begehen(wurzel, relPosix, umgebung, tiefe) {
  const abs = relPosix ? path.join(wurzel, relPosix) : wurzel;
  const knoten = {
    id: "ordner:" + relPosix,
    pfad: relPosix,
    name: relPosix ? dateiname(relPosix) : path.basename(wurzel),
    typ: "ordner",
    kinder: [],
    anzahlDateien: 0,
  };
  let eintraege;
  try {
    eintraege = fs.readdirSync(abs, { withFileTypes: true });
  } catch (e) {
    umgebung.fehler.push({ code: "ordner-unlesbar", pfad: relPosix || ".", grund: e.message });
    return knoten;
  }
  for (const e of eintraege) {
    const kindRel = relPosix ? relPosix + "/" + e.name : e.name;
    if (e.isDirectory()) kindOrdner(wurzel, knoten, e.name, kindRel, umgebung, tiefe);
    else if (e.isFile() && !(relPosix === "" && WURZEL_DATEI_AUSSCHLUSS.has(e.name))) {
      const datei = dateiKnoten(path.join(abs, e.name), kindRel, umgebung);
      umgebung.dateien.push(datei);
      knoten.kinder.push(datei);
      knoten.anzahlDateien += 1;
    }
  }
  knoten.kinder.sort(kinderSortierung);
  return knoten;
}

function kindOrdner(wurzel, knoten, name, kindRel, umgebung, tiefe) {
  if (kindRel === PROJEKT_ORDNER) {
    knoten.kinder.push(projektKnoten(wurzel, umgebung));
    return;
  }
  if (ordnerUeberspringen(name, kindRel, umgebung)) return;
  if (tiefe >= MAX_TIEFE) {
    umgebung.fehler.push({ code: "tiefe-erreicht", pfad: kindRel, grund: `mehr als ${MAX_TIEFE} Ebenen` });
    return;
  }
  const kind = begehen(wurzel, kindRel, umgebung, tiefe + 1);
  knoten.kinder.push(kind);
  knoten.anzahlDateien += kind.anzahlDateien;
}

// ---------------------------------------------------------------------------
// EINSTIEG
// ---------------------------------------------------------------------------
// `wurzel` steht POSIX im Datensatz, nicht nativ: A76 verlangt, dass in --json
// KEIN Backslash-Pfad vorkommt, und ein einziges natives Feld haette die Regel
// gebrochen. Den nativen Pfad (fuer "Pfad kopieren", I18) baut render/data.js aus
// `wurzel` + `pfadTrenner` -- so bleibt der Datensatz frei von Backslashes.
function inventar(wurzel) {
  const trenner = path.sep === "\\" ? "windows" : "posix";
  if (!wurzel || typeof wurzel !== "string") {
    return { baum: null, dateien: [], anzahl: 0, wurzel: null, wurzelUrl: null, pfadTrenner: trenner, fehler: [{ code: "wurzel-fehlt", grund: String(wurzel) }] };
  }
  const wurzelAbs = path.resolve(wurzel);
  if (!fs.existsSync(wurzelAbs)) {
    return { baum: null, dateien: [], anzahl: 0, wurzel: posix(wurzelAbs), wurzelUrl: null, pfadTrenner: trenner, fehler: [{ code: "wurzel-fehlt", grund: posix(wurzelAbs) }] };
  }
  const gitStand = gitStatusLesen(wurzelAbs);
  const verdrahtung = settingsLesen(wurzelAbs);
  const claudeMd = claudeMdLesen(wurzelAbs);
  const fehler = [...gitStand.fehler, ...verdrahtung.fehler, ...claudeMd.fehler];
  const umgebung = { git: gitStand, verdrahtung, claudeMd: claudeMd.zeilen, dateien: [], fehler };
  const baum = begehen(wurzelAbs, "", umgebung, 0);
  umgebung.dateien.sort((a, b) => a.pfad.localeCompare(b.pfad, "en"));
  return {
    baum,
    dateien: umgebung.dateien,
    anzahl: umgebung.dateien.length,
    wurzel: posix(wurzelAbs),
    wurzelUrl: url.pathToFileURL(wurzelAbs).href,
    pfadTrenner: trenner,
    fehler,
  };
}

module.exports = { inventar, ZUGANGS_MUSTER, textSichern, beschreibungFuer, HART_MAX_BYTES };
