// EINTRAGS-INDEX -- aus der Messung wird EINE flache Liste.
//
// WARUM FLACH
// Die Vorfassung hatte je Ansicht eigene Datenwege; Suche, Filter und Sortierung
// funktionierten deshalb an jeder Stelle ein bisschen anders. Hier arbeitet alles
// auf derselben Liste: eine Suche, ein Filter, eine Sortierung, ein Detail.
//
// WAS HIER PASSIERT UND WAS NICHT
// Hier entstehen die deutschen Saetze -- aus Codes der Messung und den Woertern
// aus worte.js. Die Messung bleibt sprachneutral. Umgekehrt wird hier NICHTS
// gemessen: keine Datei gelesen, kein Befehl ausgefuehrt. Kommt eine Zahl nicht
// aus der Messung, steht hier ein ehrliches Zeichen und keine Schaetzung.

const W = require("./worte.js");
const { icon, NAMEN, ZWEITNAMEN } = require("./icons.js");
const { markdownZuHtml } = require("./markdown.js");
const { ZUGANGS_MUSTER } = require("../inventar.js");

const { UI, STATUS, ART, ART_BESCHREIBUNG, WIRKUNG, LADEART, KANTE, QUELLE, GIT,
        NOTIZ, ZUTUN_ART, SEITEN, fuellen, zahl, bytes, datum } = W;

// ---------------------------------------------------------------------------
// Kleine Helfer
// ---------------------------------------------------------------------------

// Ein Feld fuer die Eigenschaften-Tabelle. wert===null wird NICHT gezeigt --
// eine leere Zeile mit einem Strich ist keine Auskunft, sondern Fuellmaterial.
function feld(label, wert, extra) {
  if (wert === null || wert === undefined || wert === "") return null;
  return Object.assign({ label, wert: String(wert) }, extra || {});
}

const felderVon = (...liste) => liste.flat().filter(Boolean);

// Sprache eines Dateiinhalts fuer die Code-Ansicht.
function spracheVon(ext) {
  const k = { js: "JavaScript", json: "JSON", md: "Markdown", txt: "Text",
              html: "HTML", css: "CSS", sh: "Shell", yml: "YAML", yaml: "YAML" };
  return k[String(ext || "").toLowerCase()] || (ext ? String(ext).toUpperCase() : "Text");
}

// Beschreibung in einen anzeigbaren Block. Fuer Dateien ohne eigene Quelle
// greift der Rollensatz -- sonst stuende bei settings.json, der zentralsten
// Datei des Harness, "keine Beschreibung".
function beschreibungVon(b, rolle) {
  if (!b) {
    const ausRolle = ART_BESCHREIBUNG[rolle];
    if (ausRolle) return { text: ausRolle, quelle: QUELLE.rolle, beleg: null };
    return { text: null, quelle: null, beleg: null };
  }
  if (b.text) {
    return { text: b.text, quelle: QUELLE[b.quelle] || b.quelle || null, beleg: b.beleg || null };
  }
  const ausRolle = ART_BESCHREIBUNG[b.rolle || rolle];
  if (ausRolle) return { text: ausRolle, quelle: QUELLE.rolle, beleg: null };
  return { text: null, quelle: null, beleg: null };
}

// Inhalt einer Datei fuer die Anzeige -- mit ehrlichem Grund, wenn er fehlt.
function inhaltVon(d) {
  const i = d.inhalt;
  if (!i) return null;
  if (i.gesperrt) {
    const grund = i.gesperrt === "ignoriert" ? UI.inhaltGesperrtIgnoriert
                : i.gesperrt === "binaer" ? UI.inhaltGesperrtBinaer
                : i.gesperrt;
    return { gesperrt: true, grund, text: null, zeilen: d.zeilen || null, sprache: spracheVon(d.ext) };
  }
  return {
    gesperrt: false,
    text: i.text || "",
    sprache: spracheVon(i.sprache || d.ext),
    ext: d.ext || null,
    zeilen: d.zeilen || null,
    gekuerzt: i.gekuerzt === true,
    gekuerztText: i.gekuerzt ? fuellen(UI.inhaltGekuerzt, { n: 400, gesamt: zahl(d.zeilen) }) : null,
    ausgeblendeteZeilen: i.ausgeblendeteZeilen || [],
  };
}

// ---------------------------------------------------------------------------
// Kanten: aus Mess-Codes werden Saetze, und externe Ziele werden als solche
// gekennzeichnet -- ein Sprung, der nirgends ankommt, ist schlimmer als keiner.
// ---------------------------------------------------------------------------

function kantenIndex(verwandtDaten) {
  const nachVon = new Map();
  const nachZiel = new Map();
  for (const k of (verwandtDaten && verwandtDaten.kanten) || []) {
    const eintrag = {
      von: k.von, nach: k.nach, art: KANTE[k.art] || k.art,
      beleg: k.beleg || null, extern: k.extern === true, name: k.name || null,
    };
    if (!nachVon.has(k.von)) nachVon.set(k.von, []);
    nachVon.get(k.von).push(eintrag);
    if (!k.extern) {
      if (!nachZiel.has(k.nach)) nachZiel.set(k.nach, []);
      // Gegenrichtung: "wird aufgerufen von" statt "ruft auf". Ohne sie sieht
      // man an einer Datei nur, wohin sie zeigt -- nie, wer auf sie zeigt.
      nachZiel.get(k.nach).push(Object.assign({}, eintrag, { rueckwaerts: true }));
    }
  }
  return {
    // Mehrere Kennungen je Eintrag sind der Normalfall, nicht die Ausnahme:
    // ein Hook heisst "hook:SessionStart/1", seine Kanten haengen aber an der
    // Datei ".claude/session-roles.js". Wer nur die eigene Kennung nachschlaegt,
    // findet nichts -- gemessen am 23.08.2026: kein einziger Hook hatte eine
    // springbare Verknuepfung, obwohl neun Kanten auf seine Datei zeigen.
    fuer(...ids) {
      const raus = [];
      const gesehen = new Set();
      for (const id of ids) {
        if (!id) continue;
        for (const k of [].concat(nachVon.get(id) || [], nachZiel.get(id) || [])) {
          const schluessel = k.von + "|" + k.nach + "|" + k.art + "|" + k.beleg;
          if (gesehen.has(schluessel)) continue;
          gesehen.add(schluessel);
          raus.push(k);
        }
      }
      return raus;
    },
  };
}

// ---------------------------------------------------------------------------
// EINE DATEI, EINE BESCHREIBUNG
//
// Vorher leitete jede Seite ihre eigene ab: "Dateien" die gerankte aus
// inventar.js, "Hooks" die statusMessage aus settings.json, "Session-Kontext"
// einen Satz ueber die Ladeart. Wer danger-guard.js auf drei Seiten sah, las
// dreimal etwas anderes und musste raten, welche Fassung stimmt -- gemessen am
// 23.08.2026: 15 von 25 mehrfach gezeigten Dateien wichen ab.
//
// Jetzt gibt es EINEN Ort. Wer einen Pfad hat, schlaegt hier nach. Was eine
// Seite sonst noch weiss, ist eine ANDERE Frage und bekommt ein eigenes Feld
// mit eigenem Label -- "Ansage in der Statusleiste" ist keine Beschreibung des
// Skripts, sondern eine Eigenschaft seiner Verdrahtung.
function beschreibungsIndex(m) {
  const nachPfad = new Map();
  for (const d of ((m.inventar && m.inventar.dateien) || [])) {
    nachPfad.set(d.pfad, beschreibungVon(d.beschreibung, d.rolle));
  }
  return {
    // Ohne Pfad oder ohne Datei im Baum: null. KEIN Ersatz aus der aufrufenden
    // Seite -- sonst entstuende genau die Abweichung wieder, die dieser Index
    // beseitigt.
    fuer(pfad) {
      if (!pfad) return null;
      return nachPfad.get(pfad) || null;
    },
  };
}

// ---------------------------------------------------------------------------
// Die Seiten. Jede Funktion nimmt die Messung und gibt Eintraege zurueck.
// ---------------------------------------------------------------------------

function dateiEintraege(m, kanten) {
  const inv = m.inventar || { dateien: [] };
  return (inv.dateien || []).map((d) => {
    const b = beschreibungVon(d.beschreibung, d.rolle);
    return {
      id: d.id,
      seite: "dateien",
      name: d.name,
      pfad: d.pfad,
      unter: b.text || null,
      art: d.rolle,
      artWort: ART[d.rolle] || ART.sonstiges,
      status: null,
      beschreibung: b,
      inhalt: inhaltVon(d),
      felder: felderVon(
        feld(UI.pfad, d.pfad, { mono: true }),
        feld(UI.art, ART[d.rolle] || ART.sonstiges),
        feld(UI.groesse, bytes(d.bytes), { mono: true }),
        feld(UI.zeilen, d.zeilen != null ? zahl(d.zeilen) : null, { mono: true }),
        feld(UI.geaendert, datum(d.geaendert), { mono: true }),
        feld(UI.git, GIT[d.git] || d.git),
        feld(UI.quelle, b.quelle, { klein: true, beleg: b.beleg })
      ),
      verwandt: kanten.fuer(d.id),
      roh: d,
    };
  });
}

function hookEintraege(m, kanten, beschreibungen) {
  const h = m.hooks || { eintraege: [] };
  const raus = (h.eintraege || []).map((e) => {
    const wirkung = WIRKUNG[e.wirkung] || { wort: e.wirkung, erklaerung: null };
    // Die Beschreibung kommt von der DATEI, nicht aus settings.json. Die
    // statusMessage ist eine Fortschrittsanzeige ("danger-guard (zerstoerende
    // Befehle)"), kein Satz darueber, was das Skript tut.
    const ausDatei = beschreibungen.fuer(e.pfad);
    const beschr = (ausDatei && ausDatei.text) || (e.kopfkommentar && e.kopfkommentar.text) || null;
    return {
      id: e.id,
      seite: "hooks",
      name: e.skript || e.ereignis,
      pfad: e.pfad || (e.skript ? ".claude/" + e.skript : null),
      unter: beschr,
      art: "hook-skript",
      artWort: ART["hook-skript"] + " · " + e.ereignis,
      gruppe: e.ereignis,
      // Eine Probe, die NICHT GELAUFEN ist, ist kein Fehler.
      //
      // Vier Hooks werden bewusst nicht ausgefuehrt (uncommitted-warn.js
      // schreibt einen Drossel-Stempel, die drei Waechter brauchen eine echte
      // Eingabe). Sie bekommen ein Proben-Objekt mit exit: null. Der alte
      // Ausdruck fragte nur exit !== 0 -- und null ist ungleich 0, also
      // standen genau diese vier auf "Fehler", sobald man die Proben
      // einschaltet. Ein Werkzeug, das nicht gelaufen ist, darf nicht
      // aussehen wie ein durchgefallenes (gemessen 23.08.2026).
      status:
        e.vorhanden === false
          ? "fehlt"
          : e.probe && typeof e.probe.exit === "number" && e.probe.exit !== 0
            ? "befund"
            : "ok",
      // Die Beschreibung kommt von der DATEI, ueber den Index -- nicht aus
      // settings.json. Die statusMessage dort ist eine Fortschrittsanzeige
      // ("danger-guard (zerstoerende Befehle)"), kein Satz darueber, was das
      // Skript tut. Sie steht jetzt als eigene Eigenschaft in der Liste.
      beschreibung: ausDatei || {
        text: beschr,
        quelle: e.kopfkommentar ? QUELLE.kopfkommentar : null,
        beleg: e.kopfkommentar ? e.pfad + ":" + e.kopfkommentar.von + "-" + e.kopfkommentar.bis : null,
      },
      // Die Liste zeigt fuenf Spalten; alles Weitere steht im Detail. Neun
      // Spalten auf schmaler Flaeche sind keine Uebersicht, sondern eine Wand.
      liste: [
        { label: UI.name, wert: e.skript, stark: true },
        { label: UI.ereignis, wert: e.ereignis, mono: true },
        { label: UI.wirkung, wert: wirkung.wort, chip: e.wirkung },
        { label: UI.beschreibung, wert: beschr, weich: true },
      ],
      felder: felderVon(
        feld(UI.pfad, e.pfad, { mono: true }),
        feld(UI.art, ART["hook-skript"]),
        feld(UI.ereignis, e.ereignis, { mono: true }),
        feld(UI.matcher, e.matcher, { mono: true }),
        feld(UI.bedingung, e.bedingung, { mono: true }),
        feld(UI.reihenfolge, e.reihenfolge != null ? String(e.reihenfolge) : null),
        feld(UI.timeout, e.timeout != null ? e.timeout + " s" : null, { mono: true }),
        feld(UI.asynchron, e.asynchron === true ? "ja" : null),
        feld(UI.wirkung, wirkung.wort, { beleg: e.wirkungBeleg, hinweis: wirkung.erklaerung }),
        // Eigene Zeile mit eigenem Label. Die statusMessage aus settings.json
        // ist eine Fortschrittsanzeige ("danger-guard (zerstoerende Befehle)"),
        // keine Beschreibung des Skripts -- sie stand bis zum 23.08.2026 im
        // Beschreibungs-Feld und wich dadurch von der Dateiseite ab.
        feld(UI.ansageStatusleiste, e.ansage, {
          beleg: e.settingsZeile ? ".claude/settings.json:" + e.settingsZeile : null,
        }),
        feld(UI.ausloeser, (e.ausloeser || []).map((a) => a.wort).join(" · ") || null, { mono: true }),
        feld(UI.settingsZeile, e.settingsZeile ? ".claude/settings.json:" + e.settingsZeile : null,
             { mono: true, sprung: "datei:.claude/settings.json" }),
        feld(UI.claudeMdZeile, e.claudeMdZeile ? "CLAUDE.md:" + e.claudeMdZeile.zeile : UI.claudeMdFehlt,
             { mono: !!e.claudeMdZeile, sprung: e.claudeMdZeile ? "datei:CLAUDE.md" : null }),
        feld(UI.selbsttest, probeText(e.probe))
      ),
      // Beide Kennungen: die des Hooks und die seiner Datei.
      verwandt: kanten.fuer(e.id, e.pfad ? "datei:" + e.pfad : null),
      roh: e,
    };
  });

  // Die statusLine ist kein Hook -- sie steht in derselben Datei und laeuft
  // dauerhaft, aber sie haengt an keinem Ereignis. Als Hook gezaehlt waere sie
  // eine falsche Zahl; weggelassen waere sie eine Luecke.
  if (h.statusLine) {
    // settings.json gibt der statusLine keine statusMessage mit -- sie ist ja
    // kein Hook. Ohne Ersatz stuende hier die einzige Zeile ohne Beschreibung.
    // Also aus dem Dateibaum holen: das Skript hat einen Kopfkommentar.
    const sPfad = h.statusLine.pfad || ".claude/statusline.js";
    const sDatei = ((m.inventar && m.inventar.dateien) || []).find((d) => d.pfad === sPfad);
    const sBeschr = beschreibungVon(sDatei && sDatei.beschreibung, "skript");
    const sText = h.statusLine.ansage || sBeschr.text
      || "Zeigt Repo, Branch und Sicherungsstand dauerhaft in der Statusleiste von Claude Code.";
    raus.push({
      id: "hook:statusLine",
      seite: "hooks",
      name: h.statusLine.skript || "statusline.js",
      pfad: sPfad,
      unter: sText,
      art: "skript",
      artWort: "statusLine",
      gruppe: "statusLine",
      status: h.statusLine.vorhanden === false ? "fehlt" : "ok",
      beschreibung: {
        text: sText,
        quelle: h.statusLine.ansage ? QUELLE.statusmessage : (sBeschr.quelle || QUELLE.rolle),
        beleg: h.statusLine.ansage ? null : sBeschr.beleg,
      },
      liste: [
        { label: UI.name, wert: h.statusLine.skript || "statusline.js", stark: true },
        { label: UI.ereignis, wert: "statusLine", mono: true },
        { label: UI.beschreibung, wert: sText, weich: true },
      ],
      felder: felderVon(
        feld(UI.pfad, h.statusLine.pfad, { mono: true }),
        feld(UI.art, "statusLine (kein Hook)"),
        feld(UI.settingsZeile, h.statusLine.settingsZeile ? ".claude/settings.json:" + h.statusLine.settingsZeile : null, { mono: true })
      ),
      verwandt: kanten.fuer("hook:statusLine", "datei:" + sPfad),
      roh: h.statusLine,
    });
  }
  return raus;
}

function probeText(p) {
  if (!p) return null;
  if (p.timeout) return fuellen(UI.probeNichtGelaufen, { grund: "Zeitüberschreitung" });
  return fuellen(UI.probeErgebnis, { exit: p.exit, ms: zahl(p.dauerMs), bytes: zahl(p.stdoutBytes) });
}

// Commands, Skills, Rules kommen aus dem Dateibaum -- nicht aus einer zweiten
// Messung. Zwei Quellen fuer dieselbe Sache driften auseinander.
function ausInventar(m, kanten, rollen, seite) {
  const inv = m.inventar || { dateien: [] };
  return (inv.dateien || [])
    .filter((d) => rollen.includes(d.rolle))
    .map((d) => {
      const e = dateiEintraege({ inventar: { dateien: [d] } }, kanten)[0];
      // EIGENE Kennung je Seite. Mit der Dateikennung stuende dieselbe Datei
      // zweimal im Index -- einmal unter "Dateien", einmal unter "Commands" --
      // und ein Klick auf der Commands-Seite oeffnete den Dateien-Eintrag,
      // dessen Seite eine andere ist. Ergebnis: das Detail blieb zu.
      return Object.assign({}, e, { id: seite + ":" + d.pfad, dateiId: e.id, seite, liste: [
        { label: UI.name, wert: seite === "commands" ? "/" + d.name.replace(/\.md$/, "") : d.name, stark: true, mono: seite === "commands" },
        { label: UI.beschreibung, wert: e.beschreibung.text, weich: true },
        { label: UI.groesse, wert: bytes(d.bytes), mono: true },
        { label: UI.geaendert, wert: datum(d.geaendert), mono: true },
      ] });
    });
}

function zuTunEintraege(m) {
  const raus = [];
  let n = 0;
  for (const t of m.zuTun || []) {
    n++;
    raus.push({
      id: "zutun:" + n,
      seite: "zutun",
      name: t.text,
      unter: t.grund && t.grund !== t.text ? t.grund : null,
      art: "sonstiges",
      artWort: SEITEN[t.bereich] ? SEITEN[t.bereich].name : t.bereich,
      status: t.status,
      gruppe: "gemessen",
      beschreibung: { text: t.grund || null, quelle: null, beleg: null },
      befehl: t.befehl || null,
      felder: felderVon(
        feld(UI.status, (STATUS[t.status] || {}).wort),
        feld(UI.quelle, SEITEN[t.bereich] ? SEITEN[t.bereich].name : t.bereich),
        feld(UI.befehlKopieren, t.befehl, { mono: true, kopieren: true })
      ),
      verwandt: [],
      roh: t,
    });
  }
  for (const d of (m.zuTunDoku && m.zuTunDoku.eintraege) || []) {
    raus.push({
      id: d.id,
      seite: "zutun",
      // Roher Markdown-Text ist kein Aufgabentitel. Eine Tabellenzeile
      // "| `x.md`-Vorlage | neuer Schritt 3 |" liest sich wie ein Auszug aus
      // einer Datei, nicht wie etwas, das man tun kann.
      name: aufgabentitel(d.text),
      unter: d.datei + ":" + d.zeile,
      art: "doku",
      artWort: ZUTUN_ART[d.artCode] || d.artCode,
      status: null,
      gruppe: "Aus Dokumenten gezogen",
      beschreibung: { text: d.text, quelle: QUELLE.absatz, beleg: d.datei + ":" + d.zeile },
      felder: felderVon(
        feld(UI.art, ZUTUN_ART[d.artCode] || d.artCode),
        feld(UI.quelle, d.datei + ":" + d.zeile, { mono: true, sprung: "datei:" + d.datei })
      ),
      verwandt: [],
      roh: d,
    });
  }
  return raus;
}

// Aus einer Markdown-Zeile einen lesbaren Aufgabentitel machen. Kein Parser --
// nur die Zeichen abziehen, die Markdown-Syntax sind und in einer Aufgabenliste
// nichts verloren haben.
function aufgabentitel(roh) {
  let t = String(roh || "").trim();
  t = t.replace(/^[>\s]*/, "");          // Zitatzeichen
  t = t.replace(/^#{1,6}\s*/, "");       // Ueberschrift
  t = t.replace(/^[-*]\s*\[[ xX]\]\s*/, ""); // Aufgabenkaestchen
  t = t.replace(/^[-*]\s+/, "");         // Aufzaehlung
  if (t.startsWith("|")) {
    // Tabellenzeile: die Zellen mit Gedankenstrich verbinden statt der Striche.
    const zellen = t.split("|").map((z) => z.trim()).filter(Boolean);
    t = zellen.join(" — ");
  }
  t = t.replace(/`/g, "").replace(/\*\*/g, "").replace(/_\(([^)]*)\)_/g, "$1");
  t = t.replace(/\s+/g, " ").trim();
  return t || String(roh || "").trim();
}

function kontextEintraege(m, beschreibungen) {
  const k = (m.bereiche && m.bereiche.kontext) || {};
  return (k.stuecke || []).map((s, i) => {
    // "warum" beantwortet eine ANDERE Frage als die Beschreibung: nicht "was
    // ist das", sondern "warum liegt es im Kontext". Beides in ein Feld zu
    // pressen war der Fehler -- jetzt steht die Beschreibung der Datei hier
    // und der Grund eine Zeile darunter.
    const ausDatei = beschreibungen.fuer(s.pfad);
    return {
    id: "kontext:" + i,
    seite: "kontext",
    name: s.pfad,
    pfad: s.pfad,
    unter: (ausDatei && ausDatei.text) || s.warum || null,
    art: "doku",
    artWort: s.art || null,
    status: null,
    gruppe: s.art || null,
    beschreibung: ausDatei || { text: null, quelle: null, beleg: null },
    liste: [
      { label: UI.pfad, wert: s.pfad, stark: true, mono: true },
      { label: UI.groesse, wert: bytes(s.bytes), mono: true },
      { label: "Token", wert: zahl(s.tokenSchaetzung), mono: true, balken: s.bytes },
      { label: UI.laedt, wert: LADEART[s.ladeart] || s.art || null },
    ],
    felder: felderVon(
      feld(UI.pfad, s.pfad, { mono: true, sprung: "datei:" + s.pfad }),
      feld(UI.groesse, bytes(s.bytes), { mono: true }),
      feld("Token", zahl(s.tokenSchaetzung), { mono: true }),
      feld(UI.laedt, LADEART[s.ladeart] || null),
      // Eigene Zeile mit eigenem Label: das ist NICHT die Beschreibung der
      // Datei, sondern der Grund, warum sie im Kontext liegt. Beides in ein
      // Feld zu pressen war der Fehler.
      feld(UI.warumImKontext, s.warum),
      feld(UI.quelle, (ausDatei && ausDatei.quelle) || null, {
        klein: true,
        beleg: (ausDatei && ausDatei.beleg) || null,
      })
    ),
    verwandt: [],
    roh: s,
    };
  });
}

function backupEintraege(m) {
  const s = (m.bereiche && m.bereiche.sicherung) || {};
  // measure.js liefert hier bereits ausgewertete Felder (git, github, sync,
  // ungesichert, lage, status) -- NICHT die rohe felder-Tabelle. Wer die liest,
  // bekommt lauter leere Zellen; gemessen am 23.08.2026: 20 von 20 Repo-Zeilen
  // standen ohne Beschreibung da.
  const LAGE = {
    kein_repo: "Kein Git-Repository — diese Arbeit ist nirgends versioniert.",
    kein_remote: "Kein Fernziel eingerichtet. Die Arbeit liegt nur auf dieser Platte.",
    nicht_gepusht: "Lokale Commits sind noch nicht auf dem Server.",
    ungesichert: "Uncommittete Änderungen im Arbeitsbaum.",
    ok: "Gesichert.",
  };
  // Die Kennung steht in der Adresse -- zwei Eintraege mit derselben Kennung
  // zeigen auf denselben. Das letzte Pfadsegment allein reicht dafuer nicht:
  // zwei Projekte duerfen gleich heissen, wenn sie in verschiedenen Ordnern
  // liegen. Bei einer Kollision wird deshalb ein Segment mehr genommen.
  const gesehen = new Map();
  return (s.repos || []).map((r) => {
    const roh = r.kurzname || String(r.name).split("/").filter(Boolean).pop();
    const voll = String(r.pfad || r.name || roh).split("\\").join("/");
    let kurz = roh;
    if (gesehen.has(roh) && gesehen.get(roh) !== voll) {
      kurz = voll.split("/").filter(Boolean).slice(-2).join("/");
    }
    gesehen.set(roh, voll);
    const branch = String(r.git || "").replace(/^JA \(Branch /, "").replace(/,.*$/, "") || null;
    return {
      id: "repo:" + kurz,
      seite: "backup",
      name: kurz,
      pfad: r.name,
      unter: LAGE[r.lage] || r.sync || null,
      art: "repo",
      artWort: ART.repo,
      status: r.status || null,
      gruppe: r.status === "ok" ? "Gesichert" : "Braucht Aufmerksamkeit",
      beschreibung: {
        text: (LAGE[r.lage] || "") + (r.sync ? " " + r.sync : ""),
        quelle: QUELLE.rolle,
        beleg: ".claude/repo-status.js",
      },
      liste: [
        { label: UI.repo, wert: kurz, stark: true },
        { label: UI.sync, wert: LAGE[r.lage] || r.sync, weich: true },
        { label: UI.branch, wert: branch, mono: true },
        { label: UI.ungesichert, wert: r.ungesichert ? r.ungesichert + " Dateien" : null, mono: true },
      ],
      felder: felderVon(
        feld(UI.pfad, r.name, { mono: true }),
        feld(UI.branch, branch, { mono: true }),
        feld("GitHub", r.github, { mono: true }),
        feld(UI.sync, r.sync),
        feld(UI.ungesichert, r.ungesichert != null ? zahl(r.ungesichert) : null, { mono: true }),
        // Ob der Fernstand ueberhaupt abgefragt wurde, ist eine eigene Auskunft.
        // Ohne sie liest sich "synchron" als geprueft, obwohl niemand nachgesehen hat.
        feld(UI.remoteLokal, r.fernAbgefragt === false ? UI.remoteLokal : null),
        feld(UI.status, (STATUS[r.status] || {}).wort)
      ),
      verwandt: [],
      roh: r,
    };
  });
}

function commitEintraege(m) {
  const v = (m.bereiche && m.bereiche.verlauf) || {};
  return (v.eintraege || []).map((e) => ({
    id: "commit:" + e.hash,
    seite: "commits",
    name: e.betreff,
    unter: e.repo,
    art: "sonstiges",
    artWort: UI.commit,
    status: null,
    gruppe: String(e.datum || "").slice(0, 10),
    datum: e.datum,
    beschreibung: { text: null, quelle: null, beleg: null },
    liste: [
      { label: UI.commit, wert: String(e.hash || "").slice(0, 7), mono: true },
      { label: UI.betreff, wert: e.betreff, stark: true },
      { label: UI.repo, wert: e.repo, weich: true },
      { label: UI.autor, wert: e.autor, weich: true },
    ],
    felder: felderVon(
      feld(UI.commit, e.hash, { mono: true, kopieren: true }),
      feld(UI.repo, e.repo),
      feld(UI.autor, e.autor),
      feld(UI.geaendert, datum(e.datum), { mono: true })
    ),
    verwandt: [],
    roh: e,
  }));
}

function werkzeugEintraege(m) {
  const g = ((m.bereiche && m.bereiche.bestand && m.bereiche.bestand.gruppen) || [])
    .find((x) => x.id === "werkzeuge");
  if (!g) return [];
  return (g.posten || []).map((p, i) => {
    const teile = String(p.name).split(" · ");
    return {
      id: "werkzeug:" + i,
      seite: "werkzeuge",
      name: teile[0],
      unter: p.beschreibung || null,
      art: "sonstiges",
      artWort: teile[1] || null,
      gruppe: teile[1] || null,
      status: null,
      beschreibung: { text: p.beschreibung || null, quelle: null, beleg: g.ordner },
      liste: [
        { label: UI.name, wert: teile[0], stark: true },
        { label: UI.typ, wert: teile[1], mono: true },
        { label: UI.beschreibung, wert: p.beschreibung, weich: true },
      ],
      felder: felderVon(feld(UI.quelle, g.ordner, { mono: true, sprung: "datei:" + g.ordner })),
      verwandt: [],
      roh: p,
    };
  });
}

// ---------------------------------------------------------------------------
// Der Zusammenbau
// ---------------------------------------------------------------------------

function daten(m, regelDaten) {
  const kanten = kantenIndex(m.verwandt);
  // EIN Ort fuer die Beschreibung. Jede Seite, deren Eintrag einen Pfad hat,
  // schlaegt hier nach -- keine leitet mehr ihre eigene ab.
  const beschreibungen = beschreibungsIndex(m);
  const eintraege = [].concat(
    zuTunEintraege(m),
    dateiEintraege(m, kanten),
    hookEintraege(m, kanten, beschreibungen),
    ausInventar(m, kanten, ["command"], "commands"),
    ausInventar(m, kanten, ["skill", "skill-datei"], "skills"),
    ausInventar(m, kanten, ["dauer-regel"], "rules"),
    kontextEintraege(m, beschreibungen),
    werkzeugEintraege(m),
    backupEintraege(m),
    commitEintraege(m)
  );

  const jeSeite = {};
  for (const e of eintraege) jeSeite[e.seite] = (jeSeite[e.seite] || 0) + 1;

  const inv = m.inventar || {};
  const kontext = (m.bereiche && m.bereiche.kontext) || {};
  const zahlen = {
    zutun: (m.zuTun || []).length,
    zutunDoku: ((m.zuTunDoku && m.zuTunDoku.eintraege) || []).length,
    dateien: (inv.dateien || []).length,
    hooks: ((m.hooks && m.hooks.eintraege) || []).length,
    hookSkripte: new Set(((m.hooks && m.hooks.eintraege) || []).map((h) => h.skript)).size,
    commands: jeSeite.commands || 0,
    skills: (inv.dateien || []).filter((d) => d.rolle === "skill").length,
    skillDateien: jeSeite.skills || 0,
    rules: (inv.dateien || []).filter((d) => d.rolle === "dauer-regel").length,
    kontext: (kontext.stuecke || []).length,
    token: kontext.tokenSchaetzungJeSitzung || 0,
    repos: ((m.bereiche && m.bereiche.sicherung && m.bereiche.sicherung.repos) || []).length,
    commits: jeSeite.commits || 0,
  };
  zahlen.reposOffen = backupEintraege(m).filter((r) => r.status !== "ok").length;
  zahlen.rulesToken = Math.round(
    (inv.dateien || []).filter((d) => d.rolle === "dauer-regel")
      .reduce((a, d) => a + (d.bytes || 0), 0) / 3.6);

  // Die Zweck-Saetze der Seiten mit den gemessenen Zahlen fuellen. Ein
  // Erklaersatz ohne Zahl ist Dekoration; eine Zahl ohne Satz ist ein Raetsel.
  const werte = {
    workspace: String(m.wurzel || "").split(/[\\/]/).filter(Boolean).pop(),
    // Kein Text aus der CLAUDE.md des Workspace. Das Dashboard gehoert zum
    // Harness-Bausatz und laeuft in JEDER Installation -- eine Ueberschrift,
    // die eine bestimmte Zeile in einer bestimmten CLAUDE.md sucht, ist beim
    // naechsten Empfaenger leer oder falsch.
    zweck: "",
    gemessen: datum(m.gemessenAm),
    n: null, doku: zahlen.zutunDoku, skripte: zahlen.hookSkripte,
    dateien: zahlen.skillDateien, token: zahl(zahlen.token), offen: zahlen.reposOffen,
  };
  const seiten = {};
  for (const [id, s] of Object.entries(SEITEN)) {
    const eigen = Object.assign({}, werte, { n: zahlFuerSeite(id, zahlen) });
    if (id === "rules") eigen.token = zahl(zahlen.rulesToken);
    seiten[id] = {
      name: s.name, ort: s.ort, icon: s.icon,
      zweck: fuellen(s.zweck, eigen),
      anzahl: jeSeite[id] || 0,
    };
  }

  // Symbole und gerendertes Markdown werden HIER erzeugt, nicht im Browser.
  // Der Browser bekaeme sonst einen Markdown-Uebersetzer mitgeliefert, den er
  // nur fuer acht Dateien braucht -- und die Seite muesste bei jedem Klick neu
  // uebersetzen, statt einmal beim Messen.
  // Zwei Schluessel je Symbol: der kanonische Lucide-Name ("FileText") und die
  // vereinfachte Form ("filetext"). Der Browser fragt mit Bindestrich
  // ("file-text") und normalisiert genauso -- sonst kamen 35 leere Kaesten
  // im Dateibaum heraus, gemessen am 23.08.2026.
  const symbolSchluessel = (n) => String(n).toLowerCase().replace(/[^a-z0-9]/g, "");
  const icons = {};
  for (const n of NAMEN) {
    const svg = icon(n);
    icons[n] = svg;
    icons[symbolSchluessel(n)] = svg;
  }
  // Auch die Zweitnamen ablegen: "file-code" meint FileCode2, und die
  // blosse Vereinfachung ("filecode") trifft "filecode2" nicht. Ohne diese
  // Zeilen zeigten alle .js-Dateien im Baum den Ersatzkreis.
  for (const [zweit, kanonisch] of Object.entries(ZWEITNAMEN || {})) {
    if (icons[kanonisch]) icons[zweit] = icons[kanonisch];
  }

  const pfade = new Set((inv.dateien || []).map((d) => d.pfad));
  const markdown = {};
  for (const d of inv.dateien || []) {
    if (!/\.md$/i.test(d.pfad)) continue;
    const text = d.inhalt && d.inhalt.text;
    if (!text) continue;
    markdown[d.pfad] = markdownZuHtml(text, {
      basisPfad: d.pfad,
      dateiExistiert: (p) => pfade.has(p),
    });
  }

  return sicherung({
    schema: m.schema,
    gemessenAm: m.gemessenAm,
    gemessenText: datum(m.gemessenAm),
    wurzel: m.wurzel,
    wurzelUrl: inv.wurzelUrl || null,
    workspace: werte.workspace,
    icons,
    markdown,
    fehlt: fehltListe(m),
    seiten,
    navigation: W.NAVIGATION,
    status: STATUS,
    gesamtstatus: m.gesamtstatus,
    zahlen,
    eintraege,
    worte: UI,
    leer: W.LEER,
    notiz: NOTIZ,
    messfehler: m.messfehler || [],
    kantenFehler: (m.verwandt && m.verwandt.fehler) || [],
    roh: { messung: m, regeln: regelDaten || null },
  }, false);
}

// ---------------------------------------------------------------------------
// DIE ENGSTELLE -- der letzte Riegel vor der Seite
//
// inventar.js sichert DATEIINHALTE zeilenweise. Aber nicht jeder Text im
// Datensatz kommt von dort: rules.js zieht Kernzeilen aus Regeldateien,
// hooks-detail.js Kopfkommentare, zutun-docs.js ganze Fundzeilen, verwandt.js
// Belegzeilen. Keines dieser Module ruft textSichern -- und jedes neue Modul
// wuerde die Pflicht erneut vergessen. Am 23.08.2026 gemessen: ein Zugang in
// einer Regeldatei erreichte die Seite und wurde erst vom Ausgabe-Waechter in
// index.js gestoppt, also vom LETZTEN Riegel.
//
// Deshalb wird hier gesichert, wo alles zusammenlaeuft. Der Ausgabe-Waechter
// bleibt trotzdem -- er prueft, was WIRKLICH auf die Platte geht, und faengt
// den Fall, dass jemand diese Stelle umgeht.
//
// AUSNAHME mit Grund: die bereits zeilenweise gesicherten Dateiinhalte. Sie
// hier noch einmal als GANZES zu maskieren wuerde eine ganze Datei
// unlesbar machen, sobald sie eine einzige verdaechtige Zeile traegt -- und
// die Zeile ist dort laengst ersetzt.
function sicherung(wert, imInhalt) {
  if (typeof wert === "string") {
    if (imInhalt) return wert;
    return ZUGANGS_MUSTER.some((m) => m.test(wert)) ? "[ausgeblendet:zugang]" : wert;
  }
  if (Array.isArray(wert)) return wert.map((v) => sicherung(v, imInhalt));
  if (wert && typeof wert === "object") {
    const raus = {};
    for (const k of Object.keys(wert)) {
      // inhalt.text ist zeilenweise gesichert; roh traegt die Messung, die
      // ihrerseits aus inventar.js kommt.
      raus[k] = sicherung(wert[k], imInhalt || k === "inhalt" || k === "markdown");
    }
    return raus;
  }
  return wert;
}

// Was dieser Harness NICHT hat -- gemessen, nicht behauptet. Ohne diesen
// Abschnitt sucht ein Fremder nach Agents und MCP-Servern und haelt ihr Fehlen
// fuer einen Defekt des Dashboards statt fuer eine Eigenschaft des Ordners.
function fehltListe(m) {
  const pfade = new Set(((m.inventar && m.inventar.dateien) || []).map((d) => d.pfad));
  const kandidaten = [
    { was: ".claude/agents/", grund: "keine eigenen Agenten-Beschreibungen in diesem Workspace", da: [...pfade].some((p) => p.startsWith(".claude/agents/")) },
    { was: ".mcp.json", grund: "keine projekteigenen MCP-Server eingetragen", da: pfade.has(".mcp.json") },
    { was: "checks/", grund: "die Prüfungen des Bausatzes liegen im Bausatz-Repo, nicht hier", da: [...pfade].some((p) => p.startsWith("checks/")) },
    { was: ".ecc-src/", grund: "kein Fremd-Klon als Vergleichsstand — deshalb bleibt die Herkunft mancher Datei unbestimmt", da: [...pfade].some((p) => p.startsWith(".ecc-src/")) },
  ];
  return kandidaten.filter((k) => !k.da).map((k) => ({ was: k.was, grund: k.grund }));
}

function zahlFuerSeite(id, z) {
  const k = { zutun: z.zutun, dateien: z.dateien, hooks: z.hooks, commands: z.commands,
              skills: z.skills, rules: z.rules, kontext: z.kontext, backup: z.repos,
              commits: z.commits };
  return k[id] != null ? zahl(k[id]) : null;
}


module.exports = { daten, kantenIndex, beschreibungVon, inhaltVon, spracheVon };
