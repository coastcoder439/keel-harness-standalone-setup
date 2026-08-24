#!/usr/bin/env node
// HOOKS-DETAIL -- alles ueber die Hooks aus .claude/settings.json, an der Quelle belegt.
// Spezifikation v2, Abschnitt 7.4. Teil der Kette "messen -> Daten -> rendern -> Datei".
//
// DIESES MODUL LIEFERT DATEN, KEINE SAETZE. Jede Zeichenkette, die hier entsteht, ist
// entweder ein sprachneutraler Code (wirkung: "blockiert"/"meldet"/"kontext"), ein
// gemessener Wert (Zeilennummer, Pfad, Exit-Code) oder woertlich aus einer Datei
// gelesener Text. Die deutschen Labels entstehen spaeter in render/data.js.
//
// WAS HIER BELEGT WIRD, WIRD AM CODE BELEGT -- nicht am Namen und nicht am Kommentar:
//   wirkung "blockiert"  <- process.exit(2) steht im Skript  (danger-guard.js:476)
//   wirkung "meldet"     <- stderr / systemMessage / additionalContext ausserhalb SessionStart
//   wirkung "kontext"    <- additionalContext / initialUserMessage / stdout bei SessionStart
// Die alte Fassung in measure.js:480-508 hat denselben Fehler schon einmal gemacht
// (Wortsuche ueber Skriptnamen -> "0 von 7 blockend", falsch in der gefaehrlichen
// Richtung). Deshalb traegt JEDE Wirkung eine Datei:Zeile-Angabe mit sich.
//
// KOMMENTAR ODER CODE: Ein Treffer in einer Kommentarzeile ist ein schwaecherer Beleg
// als derselbe Treffer im Code. zeileMit() bevorzugt darum die Code-Zeile und faellt
// erst dann auf die Kommentarzeile zurueck. Gemessener Anlass: uncommitted-warn.js
// nennt "systemMessage" in Zeile 2 (Kopfkommentar), tut es aber in Zeile 109.
//
// PROBE-LAEUFE nur mit opts.proben === true. Ohne das Flag startet dieses Modul
// KEINEN Kindprozess. Zwei Skripte werden auch dann nie gestartet, weil sie schreiben:
//   uncommitted-warn.js  -> fs.writeFileSync (Drossel-Stempel), uncommitted-warn.js:93
//   git-guard.js         -> fs.unlinkSync (verwaiste index.lock), git-guard.js:98
// Die Sperre steht als Tabelle (PROBE_SPERRE) VOR jeder anderen Entscheidung, damit
// sie auch dann greift, wenn eines der beiden Skripte spaeter an einem anderen
// Ereignis verdrahtet wird.
//
// AUFRUF   const { hooksDetail } = require("./hooks-detail");
//          hooksDetail(wurzel, { proben: false })

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const SETTINGS_REL = ".claude/settings.json";
const CLAUDE_MD_REL = "CLAUDE.md";
const CLAUDE_ORDNER = ".claude";
const PROBE_TIMEOUT_MS = 10000;
const PROBE_KOPF_BYTES = 512;
const SESSIONSTART_EINGABE = JSON.stringify({ hook_event_name: "SessionStart", source: "startup" });
const AUSLOESER_WORTE = ["startup", "resume", "clear", "compact"];

// Skripte, die bei einer Probe SCHREIBEN wuerden -- Wert = Grundcode fuer die Anzeige.
const PROBE_SPERRE = new Map([
  ["uncommitted-warn.js", "schreibt-drossel-stempel"],
  ["git-guard.js", "loescht-index-lock"],
]);

// Zugangsmuster aus Spezifikation 7.3. file-inventory.js fuehrt die kanonische Liste; bis
// sie sie exportiert, haelt dieses Modul eine eigene Fassung und nimmt ueber
// opts.textSichern jederzeit die fremde entgegen (dann gilt nur noch die fremde).
const ZUGANGS_MUSTER = [
  /(api[_-]?key|token|secret|passw(or)?d)\s*[:=]\s*\S{8,}/i,
  /ghp_[A-Za-z0-9]{20,}/,
  /github_pat_[A-Za-z0-9_]{20,}/,
  /gho_|ghu_|ghs_|ghr_/,
  /sk-[A-Za-z0-9]{20,}/,
  /sk_(live|test)_[A-Za-z0-9]{10,}/,
  /AKIA[0-9A-Z]{16}/,
  /xox[baprs]-[A-Za-z0-9-]{10,}/,
  /AIza[0-9A-Za-z_-]{20,}/,
  /glpat-[0-9A-Za-z_-]{16,}/,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  /Bearer\s+[A-Za-z0-9._-]{10,}/,
  /npm_[A-Za-z0-9]{20,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY/,
  /https?:\/\/[^/\s:@]+:[^/\s@]+@/,
];

// ---------------------------------------------------------------------------
// Kleinwerkzeug
// ---------------------------------------------------------------------------
const posix = (p) => String(p == null ? "" : p).split(path.sep).join("/").replace(/\\/g, "/");
const istKommentar = (z) => /^\s*(\/\/|\*|\/\*)/.test(z);

function eigenesSichern(text) {
  if (typeof text !== "string" || text === "") return text;
  return text
    .split(/\r?\n/)
    .map((z) => (ZUGANGS_MUSTER.some((m) => m.test(z)) ? "[ausgeblendet:zugang]" : z))
    .join("\n");
}

// Zeilen IMMER hier normalisieren: die Mehrzahl der Dateien liegt als CRLF auf der Platte.
function textLesen(absPfad) {
  try {
    const text = fs.readFileSync(absPfad, "utf8");
    return { text, zeilen: text.split(/\r?\n/) };
  } catch (e) {
    return { fehler: e.message };
  }
}

// Erste Zeile mit Treffer, nach Belegkraft gestaffelt:
//   1. Treffer im Code  ->  2. Treffer im Zeilenkommentar hinter Code  ->  3. Treffer in
// einer reinen Kommentarzeile. Zwei gemessene Anlaesse: uncommitted-warn.js nennt
// "systemMessage" in Zeile 2 (Kopfkommentar), TUT es aber in Zeile 109; session-roles.js
// erwaehnt "startup" im Zeilenkommentar von 31, SCHALTET aber in Zeile 96 danach.
function zeileMit(zeilen, muster) {
  let hinterCode = null;
  let ausKommentarzeile = null;
  for (let i = 0; i < zeilen.length; i++) {
    const treffer = zeilen[i].match(muster);
    if (!treffer) continue;
    if (istKommentar(zeilen[i])) {
      if (ausKommentarzeile === null) ausKommentarzeile = i + 1;
      continue;
    }
    const kommentarAb = zeilen[i].indexOf("//");
    if (kommentarAb === -1 || treffer.index < kommentarAb) return i + 1;
    if (hinterCode === null) hinterCode = i + 1;
  }
  return hinterCode || ausKommentarzeile;
}

// Der Nachbar file-inventory.js liefert aus textSichern ein Objekt {text, ausgeblendeteZeilen}
// (file-inventory.js:131-141, nachgesehen 23.08.2026), die eigene Fassung hier eine
// Zeichenkette. Beide Formen werden angenommen. Ohne diese Weiche stuende bei einer
// Verdrahtung ueber opts.textSichern "[object Object]" im Datensatz -- stumm und
// erst im Browser sichtbar. Eine dritte Form bekommt eine sichtbare Marke, keinen
// stillen Leerstring: eine verschwundene Ausgabe sieht sonst aus wie keine Ausgabe.
function alsText(wert) {
  if (typeof wert === "string") return wert;
  if (wert && typeof wert === "object" && typeof wert.text === "string") return wert.text;
  return "[sicherung:unbekannte-form]";
}

// Auf ganze Bytes kuerzen, ohne ein Mehrbyte-Zeichen zu zerschneiden.
function kopfBytes(text, max) {
  const b = Buffer.from(text, "utf8");
  if (b.length <= max) return text;
  let ende = max;
  while (ende > 0 && (b[ende] & 0xc0) === 0x80) ende--;
  return b.slice(0, ende).toString("utf8");
}

// ---------------------------------------------------------------------------
// settings.json: Struktur aus dem JSON, Zeilennummern aus derselben Datei
// ---------------------------------------------------------------------------
// node "$CLAUDE_PROJECT_DIR/.claude/danger-guard.js"  ->  .claude/danger-guard.js
function befehlZerlegen(befehl, wurzel) {
  const roh = String(befehl == null ? "" : befehl);
  const treffer = roh.match(/"([^"]+\.js)"|'([^']+\.js)'|(\S+\.js)/);
  if (!treffer) return { skript: null, pfad: null };
  let p = posix(treffer[1] || treffer[2] || treffer[3]);
  p = p.replace(/^\$\{?CLAUDE_PROJECT_DIR\}?\//, "").replace(/^\.\//, "");
  if (path.isAbsolute(p)) {
    const r = posix(path.relative(wurzel, p));
    if (r && !r.startsWith("..")) p = r;
  }
  return { skript: p.split("/").pop(), pfad: p };
}

// Die JSON-Struktur kennt keine Zeilen. Also mit einem Lesezeiger durch die Datei
// laufen: der n-te command-Eintrag im Objekt ist der n-te command-Treffer im Text.
// Zusaetzlich muss der Skriptname in der Zeile stehen -- sonst wird nichts gemeldet
// statt auf die naechstbeste Zeile zu zeigen.
function settingsZeileFinden(zeilen, skript, abIndex) {
  const nadel = skript ? skript.toLowerCase() : null;
  for (let i = abIndex; i < zeilen.length; i++) {
    const z = zeilen[i];
    if (!z.includes('"command"')) continue;
    if (nadel && !z.toLowerCase().includes(nadel)) continue;
    return i + 1;
  }
  return null;
}

// Kopfkommentar = der zusammenhaengende //-Block direkt nach der Shebang-Zeile.
function kopfkommentarLesen(zeilen) {
  let i = zeilen.length && /^#!/.test(zeilen[0]) ? 1 : 0;
  const von = i + 1;
  const teile = [];
  while (i < zeilen.length && /^\s*\/\//.test(zeilen[i])) {
    teile.push(zeilen[i].replace(/^\s*\/\/ ?/, ""));
    i++;
  }
  if (!teile.length) return null;
  return { text: teile.join("\n").trim(), von, bis: i };
}

// CLAUDE.md Abschnitt 3 fuehrt die Werkzeuge als Tabelle (heute Zeile 39-47).
// Kein Treffer -> null; daraus entsteht spaeter der Drift-Eintrag (Spezifikation 4.4).
function claudeMdZeileFinden(zeilen, skript) {
  if (!skript) return null;
  const nadel = skript.toLowerCase();
  for (let i = 0; i < zeilen.length; i++) {
    if (!/^\s*\|/.test(zeilen[i])) continue;
    if (zeilen[i].toLowerCase().includes(nadel)) return { text: zeilen[i].trim(), zeile: i + 1 };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Belege aus dem Skript selbst
// ---------------------------------------------------------------------------
function wirkungBestimmen(zeilen, ereignis, pfad) {
  const blockiert = zeileMit(zeilen, /process\.exit\(\s*2\s*\)|(?<![.\w])exit\(\s*2\s*\)/);
  if (blockiert) return { wirkung: "blockiert", wirkungBeleg: `${pfad}:${blockiert}` };
  if (ereignis === "SessionStart") {
    const kontext =
      zeileMit(zeilen, /additionalContext|initialUserMessage/) ||
      zeileMit(zeilen, /process\.stdout\.write|console\.log/);
    if (kontext) return { wirkung: "kontext", wirkungBeleg: `${pfad}:${kontext}` };
  }
  const meldet =
    zeileMit(zeilen, /process\.stderr\.write|console\.error|systemMessage/) ||
    zeileMit(zeilen, /additionalContext|process\.stdout\.write|console\.log/);
  if (meldet) return { wirkung: "meldet", wirkungBeleg: `${pfad}:${meldet}` };
  return { wirkung: null, wirkungBeleg: null };
}

// Das Feld heisst bei Claude Code "source" und gibt es NUR bei SessionStart. Andere
// Ereignisse liefern darum eine leere Liste -- sonst zaehlte danger-guard.js:342
// ("git stash drop/clear") als Ausloeser "clear", was schlicht falsch waere.
function ausloeserFinden(zeilen, ereignis) {
  if (ereignis !== "SessionStart") return [];
  const treffer = [];
  for (const wort of AUSLOESER_WORTE) {
    const zeile = zeileMit(zeilen, new RegExp(`\\b${wort}\\b`));
    if (zeile) treffer.push({ wort, zeile });
  }
  return treffer;
}

// ---------------------------------------------------------------------------
// Probe-Laeufe (nur mit opts.proben === true)
// ---------------------------------------------------------------------------
function probeLeer(code, wurzel) {
  return {
    befehl: null,
    exit: null,
    dauerMs: null,
    stdoutBytes: null,
    stderrBytes: null,
    stdoutKopf: null,
    timeout: false,
    umgebung: { CLAUDE_PROJECT_DIR: posix(wurzel) },
    fehlerCode: null,
    uebersprungen: code,
  };
}

function probeStarten(wurzel, pfad, args, eingabe, sichern) {
  const start = Date.now();
  const lauf = spawnSync(process.execPath, [path.join(wurzel, pfad), ...args], {
    cwd: wurzel,
    env: { ...process.env, CLAUDE_PROJECT_DIR: wurzel },
    input: eingabe,
    timeout: PROBE_TIMEOUT_MS,
    stdio: "pipe",
    encoding: "utf8",
    windowsHide: true,
  });
  const aus = lauf.stdout == null ? "" : String(lauf.stdout);
  const err = lauf.stderr == null ? "" : String(lauf.stderr);
  const abgelaufen = Boolean(lauf.error && lauf.error.code === "ETIMEDOUT");
  return {
    befehl: ["node", pfad, ...args].join(" "),
    exit: typeof lauf.status === "number" ? lauf.status : null,
    dauerMs: Date.now() - start,
    stdoutBytes: Buffer.byteLength(aus, "utf8"),
    stderrBytes: Buffer.byteLength(err, "utf8"),
    stdoutKopf: alsText(sichern(kopfBytes(aus, PROBE_KOPF_BYTES))),
    timeout: abgelaufen,
    umgebung: { CLAUDE_PROJECT_DIR: posix(wurzel) },
    fehlerCode: lauf.error && !abgelaufen ? String(lauf.error.code || "spawn-fehler") : null,
    uebersprungen: null,
  };
}

// Was mit welcher Eingabe gestartet werden darf. Die Sperrtabelle steht zuerst.
function probePlan(skript, ereignis, vorhanden, wurzel) {
  if (!skript) return { uebersprungen: "kein-skript" };
  if (PROBE_SPERRE.has(skript)) return { uebersprungen: PROBE_SPERRE.get(skript) };
  if (!vorhanden) return { uebersprungen: "skript-fehlt" };
  if (skript === "danger-guard.js") return { args: ["--selbsttest"], eingabe: "" };
  if (ereignis === "SessionStart") return { args: [], eingabe: SESSIONSTART_EINGABE };
  if (ereignis === "statusLine") {
    // cwd NATIV, nicht POSIX: statusline.js:53 vergleicht den gefundenen Repo-Ordner
    // mit === gegen path.resolve(). Mit Vorwaertsschraegstrichen schlaegt der Vergleich
    // unter Windows fehl, und die Probe misst eine leere Repo-Beschriftung, die es in
    // Wirklichkeit nicht gibt. Der Datensatz bleibt trotzdem POSIX -- die native Form
    // geht nur in den Kindprozess, nicht in die Ausgabe.
    return { args: [], eingabe: JSON.stringify({ session_id: "probe", cwd: wurzel }) };
  }
  return { uebersprungen: "braucht-werkzeug-eingabe" };
}

function probeAusfuehren(wurzel, eintrag, sichern, fehler) {
  const ereignis = eintrag.ereignis || eintrag.typ || null;
  const plan = probePlan(eintrag.skript, ereignis, eintrag.vorhanden, wurzel);
  if (plan.uebersprungen) return probeLeer(plan.uebersprungen, wurzel);
  const ergebnis = probeStarten(wurzel, eintrag.pfad, plan.args, plan.eingabe, sichern);
  if (ergebnis.fehlerCode) {
    fehler.push({ code: "probe-fehlgeschlagen", pfad: eintrag.pfad, grund: ergebnis.fehlerCode });
  }
  return ergebnis;
}

// ---------------------------------------------------------------------------
// Eintraege bauen
// ---------------------------------------------------------------------------
function belegeSammeln(ctx, pfad, ereignis) {
  const zeilen = ctx.skriptLaden(pfad);
  if (!zeilen) return { kopfkommentar: null, ausloeser: [], wirkung: null, wirkungBeleg: null };
  const w = wirkungBestimmen(zeilen, ereignis, pfad);
  return {
    kopfkommentar: kopfkommentarLesen(zeilen),
    ausloeser: ausloeserFinden(zeilen, ereignis),
    wirkung: w.wirkung,
    wirkungBeleg: w.wirkungBeleg,
  };
}

// reihenfolge = Platz in der eigenen Matcher-Gruppe (das ist die Reihenfolge, in der
// Claude Code sie bei einem Treffer abarbeitet). laufnummer = Platz im Ereignis ueber
// alle Gruppen hinweg -- daraus wird die stabile ID.
function eintragBauen(ctx, ereignis, gruppe, hook, reihenfolge, laufnummer) {
  const h = hook && typeof hook === "object" ? hook : {};
  const { skript, pfad } = befehlZerlegen(h.command, ctx.wurzel);
  const settingsZeile = ctx.zeileZuBefehl(skript);
  const vorhanden = Boolean(pfad) && fs.existsSync(path.join(ctx.wurzel, pfad));
  const belege = belegeSammeln(ctx, pfad, ereignis);
  return {
    id: `hook:${ereignis}/${laufnummer}`,
    ereignis,
    matcher: gruppe && typeof gruppe.matcher === "string" ? gruppe.matcher : null,
    bedingung: typeof h.if === "string" ? h.if : null,
    skript,
    pfad,
    reihenfolge,
    timeout: typeof h.timeout === "number" ? h.timeout : null,
    asynchron: h.async === true,
    ansage: typeof h.statusMessage === "string" ? h.statusMessage : null,
    settingsZeile,
    kopfkommentar: belege.kopfkommentar,
    claudeMdZeile: claudeMdZeileFinden(ctx.claudeMd, skript),
    ausloeser: belege.ausloeser,
    wirkung: belege.wirkung,
    wirkungBeleg: belege.wirkungBeleg,
    vorhanden,
    probe: null,
  };
}

function eintraegeSammeln(ctx, hooks) {
  const eintraege = [];
  for (const [ereignis, gruppen] of Object.entries(hooks)) {
    let laufnummer = 0;
    for (const gruppe of Array.isArray(gruppen) ? gruppen : []) {
      const liste = gruppe && Array.isArray(gruppe.hooks) ? gruppe.hooks : [];
      liste.forEach((hook, i) => {
        laufnummer += 1;
        eintraege.push(eintragBauen(ctx, ereignis, gruppe, hook, i + 1, laufnummer));
      });
    }
  }
  return eintraege;
}

// statusLine ist KEIN Hook: kein Ereignis, kein Matcher, keine Blockwirkung.
// Eigener Rueckgabewert, damit die Anzeige sie nicht in die Hook-Zaehlung nimmt.
function statusLineBauen(ctx, roh) {
  if (!roh || typeof roh !== "object") return null;
  const { skript, pfad } = befehlZerlegen(roh.command, ctx.wurzel);
  const belege = belegeSammeln(ctx, pfad, "statusLine");
  return {
    id: "statusline",
    typ: "statusLine",
    befehlsart: typeof roh.type === "string" ? roh.type : null,
    skript,
    pfad,
    settingsZeile: ctx.zeileZuBefehl(skript),
    kopfkommentar: belege.kopfkommentar,
    claudeMdZeile: claudeMdZeileFinden(ctx.claudeMd, skript),
    wirkung: belege.wirkung,
    wirkungBeleg: belege.wirkungBeleg,
    vorhanden: Boolean(pfad) && fs.existsSync(path.join(ctx.wurzel, pfad)),
    probe: null,
  };
}

// js-Dateien in .claude/, die weder in einem Hook noch in der statusLine stehen.
function weitereSkripteSammeln(ctx, benutzt) {
  const ordner = path.join(ctx.wurzel, CLAUDE_ORDNER);
  let namen = [];
  try {
    namen = fs
      .readdirSync(ordner, { withFileTypes: true })
      .filter((d) => d.isFile() && /\.js$/i.test(d.name))
      .map((d) => d.name);
  } catch (e) {
    ctx.fehler.push({ code: "claude-ordner-unlesbar", pfad: CLAUDE_ORDNER, grund: e.message });
    return [];
  }
  return namen
    .filter((n) => !benutzt.has(n.toLowerCase()))
    .sort()
    .map((name) => {
      const pfad = `${CLAUDE_ORDNER}/${name}`;
      const zeilen = ctx.skriptLaden(pfad);
      return {
        id: `datei:${pfad}`,
        skript: name,
        pfad,
        kopfkommentar: zeilen ? kopfkommentarLesen(zeilen) : null,
        claudeMdZeile: claudeMdZeileFinden(ctx.claudeMd, name),
        vorhanden: true,
      };
    });
}

// ---------------------------------------------------------------------------
// Einstieg
// ---------------------------------------------------------------------------
function kontextBauen(wurzel, settingsZeilen, claudeMd, fehler) {
  const zwischenspeicher = new Map();
  let lesezeiger = 0;
  return {
    wurzel,
    claudeMd,
    fehler,
    skriptLaden(pfad) {
      if (!pfad) return null;
      if (zwischenspeicher.has(pfad)) return zwischenspeicher.get(pfad);
      const abs = path.join(wurzel, pfad);
      let wert = null;
      if (fs.existsSync(abs)) {
        const gelesen = textLesen(abs);
        if (gelesen.fehler) fehler.push({ code: "skript-unlesbar", pfad, grund: gelesen.fehler });
        else wert = gelesen.zeilen;
      }
      zwischenspeicher.set(pfad, wert);
      return wert;
    },
    zeileZuBefehl(skript) {
      const zeile = settingsZeileFinden(settingsZeilen, skript, lesezeiger);
      if (zeile) lesezeiger = zeile;
      else fehler.push({ code: "settings-zeile-nicht-gefunden", pfad: SETTINGS_REL, grund: skript || "no-script" });
      return zeile;
    },
  };
}

function hooksDetail(wurzel, opts) {
  const o = opts && typeof opts === "object" ? opts : {};
  const sichern = typeof o.textSichern === "function" ? o.textSichern : eigenesSichern;
  const fehler = [];
  const leer = { eintraege: [], statusLine: null, weitereSkripte: [], fehler };
  if (!wurzel || typeof wurzel !== "string") {
    fehler.push({ code: "wurzel-fehlt", pfad: null, grund: "no root path given" });
    return leer;
  }
  const settingsAbs = path.join(wurzel, CLAUDE_ORDNER, "settings.json");
  const settings = textLesen(settingsAbs);
  if (settings.fehler) {
    const code = fs.existsSync(settingsAbs) ? "settings-unlesbar" : "settings-fehlt";
    fehler.push({ code, pfad: SETTINGS_REL, grund: settings.fehler });
    return leer;
  }
  let daten = null;
  try {
    daten = JSON.parse(settings.text);
  } catch (e) {
    fehler.push({ code: "settings-json-kaputt", pfad: SETTINGS_REL, grund: e.message });
    return leer;
  }
  const claudeMdGelesen = textLesen(path.join(wurzel, CLAUDE_MD_REL));
  if (claudeMdGelesen.fehler) {
    fehler.push({ code: "claude-md-unlesbar", pfad: CLAUDE_MD_REL, grund: claudeMdGelesen.fehler });
  }
  const ctx = kontextBauen(wurzel, settings.zeilen, claudeMdGelesen.zeilen || [], fehler);
  const objekt = daten && typeof daten === "object" && !Array.isArray(daten) ? daten : {};
  const hooks = objekt.hooks && typeof objekt.hooks === "object" ? objekt.hooks : null;
  if (!hooks) fehler.push({ code: "hooks-leer", pfad: SETTINGS_REL, grund: "no hooks object" });

  const eintraege = hooks ? eintraegeSammeln(ctx, hooks) : [];
  const statusLine = statusLineBauen(ctx, objekt.statusLine);
  const benutzt = new Set(eintraege.filter((e) => e.skript).map((e) => e.skript.toLowerCase()));
  if (statusLine && statusLine.skript) benutzt.add(statusLine.skript.toLowerCase());
  const weitereSkripte = weitereSkripteSammeln(ctx, benutzt);

  if (o.proben === true) {
    for (const e of eintraege) e.probe = probeAusfuehren(wurzel, e, sichern, fehler);
    if (statusLine) statusLine.probe = probeAusfuehren(wurzel, statusLine, sichern, fehler);
  }
  return { eintraege, statusLine, weitereSkripte, fehler };
}

module.exports = { hooksDetail };
