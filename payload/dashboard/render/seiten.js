// DIE SEITEN -- aus der Messung werden Eintraege.
//
// Neun Funktionen nach demselben Muster: nimm die Messung, gib eine Liste von
// Eintraegen zurueck. Jeder Eintrag traegt Kennung, Seite, Name, Pfad,
// Beschreibung, eine Listenzeile, Eigenschaften und Verknuepfungen.
//
// WARUM EIGENSTAENDIG
// data.js ist der Zusammenbau -- Helfer, Indizes, Zahlen, Rueckgabe. Die
// Seitenbauer sind neun voneinander unabhaengige Stuecke, die davon nur die
// Helfer brauchen. Getrennt am 23.08.2026, als data.js mit der Projekt-Seite
// die Hausgrenze von 800 Zeilen erreichte.
//
// DIE REGEL, die hier ueberall gilt: die Beschreibung eines Dings kommt aus
// EINEM Ort (beschreibungsIndex in data.js). Was eine Seite sonst noch weiss,
// ist eine andere Frage und bekommt ein eigenes Feld mit eigenem Label. Wer
// das aufweicht, erzeugt wieder den Zustand vom 23.08.2026: dieselbe Datei mit
// drei verschiedenen Beschreibungen, je nachdem wo man hinsieht.

const W = require("./worte.js");
const { icon } = require("./icons.js");
const { feld, felderVon, beschreibungVon, inhaltVon } = require("./helfer.js");

const { UI, STATUS, ART, ART_BESCHREIBUNG, WIRKUNG, LADEART, KANTE, QUELLE, GIT,
        NOTIZ, ZUTUN_ART, SEITEN, fuellen, zahl, bytes, datum } = W;

// ---------------------------------------------------------------------------
// Die Seiten. Jede Funktion nimmt die Messung und gibt Eintraege zurueck.
// ---------------------------------------------------------------------------

function dateiEintraege(m, kanten) {
  const inv = m.inventar || { dateien: [] };
  return (inv.dateien || []).map((d) => {
    const b = beschreibungVon(d.beschreibung, d.rolle, d.ext);
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

// PROJEKTE -- was unter user-projects/ liegt und was es vorhat.
//
// Bis zum 23.08.2026 war der Ordner ein geschlossener Knoten mit einer Zahl:
// man sah, DASS es Projekte gibt, und sonst nichts. Die Plaene lagen da und
// waren nicht zu oeffnen.
//
// Zwei Klassen, getrennt gezeigt, weil sie sich in der GROESSE unterscheiden
// und nicht im Rang: die wenigen Wurzel-Dokumente tragen ihren Inhalt mit, die
// docs/-Baeume werden gelistet und bei Bedarf nachgeladen. 572 Dateien mit
// 7,1 MB in der Seite waeren die Seite selbst gewesen.
function projektEintraege(m, kanten) {
  const p = m.projekte || { liste: [] };
  return (p.liste || []).map((x) => {
    const wurzel = x.wurzelDokumente || [];
    const doku = x.dokuDateien || [];

    return {
      id: x.id,
      seite: "projekte",
      name: x.name,
      pfad: x.pfad,
      // Ohne Beschreibung steht hier NICHTS und kein erfundener Satz. Die
      // Oberflaeche sagt an anderer Stelle, dass Wegweiser fehlen.
      unter: (x.beschreibung && x.beschreibung.text) || null,
      art: "repo",
      artWort: ART.repo || "Projekt",
      status: null,
      gruppe: null,
      beschreibung: x.beschreibung
        ? { text: x.beschreibung.text, quelle: QUELLE.absatz, beleg: x.beschreibung.beleg }
        : { text: null, quelle: null, beleg: null },
      liste: [
        { label: UI.name, wert: x.name, stark: true },
        { label: UI.beschreibung, wert: (x.beschreibung && x.beschreibung.text) || UI.keineWegweiser, weich: true },
        { label: UI.stack, wert: x.stack || null },
        { label: UI.dokumente, wert: x.anzahlDokumente ? zahl(x.anzahlDokumente) : null, mono: true },
      ],
      felder: felderVon(
        feld(UI.pfad, x.pfad, { mono: true }),
        feld(UI.stack, x.stack),
        feld(UI.dokumente, x.anzahlDokumente ? zahl(x.anzahlDokumente) : null, { mono: true }),
        feld(UI.quelle, x.beschreibung ? QUELLE.absatz : null, {
          klein: true,
          beleg: x.beschreibung ? x.beschreibung.beleg : null,
        })
      ),
      // Die Dokumente als eigene Bloecke -- Plaene zuerst, weil das die Frage
      // ist, mit der man ein Projekt aufschlaegt.
      dokumente: {
        wurzel: wurzel.map((d) => ({
          name: d.name,
          pfad: d.pfad,
          bytes: d.bytes,
          geaendert: d.geaendert,
          // KEIN Inhalt im Datensatz -- serve.js liefert ihn auf Klick, genau
          // wie bei doku. Der Rumpf verlaesst die Seite (D1).
          inhalt: null,
          aufAbruf: true,
        })),
        doku: doku.map((d) => ({
          name: d.name,
          pfad: d.pfad,
          bytes: d.bytes,
          geaendert: d.geaendert,
          // KEIN Inhalt: er kommt beim Oeffnen vom Server. Eine Kuerzung hier
          // saehe aus wie der ganze Text.
          inhalt: null,
          aufAbruf: true,
        })),
        gekappt: x.dokuGekappt === true,
        gekapptText: x.dokuGekappt ? fuellen(UI.dokuGekappt, { n: zahl(x.dokuGrenze) }) : null,
        leer: x.anzahlDokumente === 0,
        leerText: UI.keineWegweiser,
        leerHinweis: UI.keineWegweiserHinweis,
      },
      verwandt: kanten.fuer("repo:" + x.name, x.id),
      // OHNE die Dokumentinhalte. Sie stehen schon in "dokumente" -- ein
      // zweites Mal hier und ein drittes Mal in der Rohmessung haetten die
      // Seite um 1,3 MB wachsen lassen, wo 0,36 MB gemessen waren.
      roh: {
        id: x.id, name: x.name, pfad: x.pfad, stack: x.stack,
        anzahlDokumente: x.anzahlDokumente,
        wurzelDokumente: (x.wurzelDokumente || []).map((d) => ({
          name: d.name, pfad: d.pfad, bytes: d.bytes, geaendert: d.geaendert,
        })),
        dokuDateien: (x.dokuDateien || []).length,
        dokuGekappt: x.dokuGekappt === true,
      },
    };
  });
}

// Der Sicherungsstand eines Repos ist NICHT seine Beschreibung.
//
// "Gesichert. synchron zum zuletzt geholten Stand" beantwortet "liegt die
// Arbeit auch woanders" -- nicht "was ist das". Bis zum 23.08.2026 stand
// dieser Satz im Beschreibungs-Feld, und dieselbe Datei trug unter "Projekte"
// den einen und unter "Backup" den anderen Text. Derselbe Fehler wie bei den
// Hooks und beim Kontext, nur an der dritten Stelle.
function backupEintraege(m, projektBeschreibung) {
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
      unter: ((projektBeschreibung && projektBeschreibung(r)) || {}).text || null,
      art: "repo",
      artWort: ART.repo,
      status: r.status || null,
      gruppe: r.status === "ok" ? "Gesichert" : "Braucht Aufmerksamkeit",
      // Die Beschreibung kommt vom PROJEKT, nicht vom Sicherungsstand. Hat das
      // Repo keine (kein README, keine ZIEL.md), steht hier nichts -- und der
      // Sync-Satz steht weiter unten in seiner eigenen Zeile, wo er hingehoert.
      beschreibung: (projektBeschreibung && projektBeschreibung(r)) || {
        text: null,
        quelle: null,
        beleg: null,
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

module.exports = { dateiEintraege, hookEintraege, ausInventar, zuTunEintraege, kontextEintraege, projektEintraege, backupEintraege, commitEintraege, werkzeugEintraege };
