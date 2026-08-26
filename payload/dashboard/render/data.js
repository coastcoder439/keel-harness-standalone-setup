// EINTRAGS-INDEX -- aus der Messung wird EINE flache Liste.
//
// WARUM FLACH
// Die Vorfassung hatte je Ansicht eigene Datenwege; Suche, Filter und Sortierung
// funktionierten deshalb an jeder Stelle ein bisschen anders. Hier arbeitet alles
// auf derselben Liste: eine Suche, ein Filter, eine Sortierung, ein Detail.
//
// WAS HIER PASSIERT UND WAS NICHT
// Hier entstehen die deutschen Saetze -- aus Codes der Messung und den Woertern
// aus labels.js. Die Messung bleibt sprachneutral. Umgekehrt wird hier NICHTS
// gemessen: keine Datei gelesen, kein Befehl ausgefuehrt. Kommt eine Zahl nicht
// aus der Messung, steht hier ein ehrliches Zeichen und keine Schaetzung.

const W = require("./labels.js");
const { icon, NAMEN, ZWEITNAMEN } = require("./icons.js");
// markdownZuHtml wird hier nicht mehr gebraucht -- Markdown rendert serve.js
// auf Abruf (Server-zuerst, D1), nicht der Bau.
// Die Helfer und die neun Seitenbauer liegen seit dem 23.08.2026 in eigenen
// Modulen -- data.js hatte mit der Projekt-Seite die Hausgrenze erreicht.
const { feld, felderVon, spracheVon, beschreibungVon, inhaltVon } = require("./helpers.js");
const S = require("./views.js");
const { ZUGANGS_MUSTER } = require("../file-inventory.js");

const { UI, STATUS, ART, ART_BESCHREIBUNG, WIRKUNG, LADEART, KANTE, QUELLE, GIT,
        NOTIZ, ZUTUN_ART, SEITEN, fuellen, zahl, bytes, datum } = W;

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
// file-inventory.js, "Hooks" die statusMessage aus settings.json, "Session-Kontext"
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
    nachPfad.set(d.pfad, beschreibungVon(d.beschreibung, d.rolle, d.ext));
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
// Der Zusammenbau
// ---------------------------------------------------------------------------

function daten(m, regelDaten) {
  const kanten = kantenIndex(m.verwandt);
  // EIN Ort fuer die Beschreibung. Jede Seite, deren Eintrag einen Pfad hat,
  // schlaegt hier nach -- keine leitet mehr ihre eigene ab.
  const beschreibungen = beschreibungsIndex(m);
  // Ein Repo unter user-projects/ ist dasselbe Ding wie das Projekt auf der
  // Projekte-Seite. Es traegt deshalb dieselbe Beschreibung -- nicht seinen
  // Sicherungsstand, der eine andere Frage beantwortet.
  const projektNachName = new Map();
  for (const p of ((m.projekte && m.projekte.liste) || [])) {
    if (p.beschreibung) {
      projektNachName.set(p.name, {
        text: p.beschreibung.text,
        quelle: QUELLE.absatz,
        beleg: p.beschreibung.beleg,
      });
    }
  }
  const projektBeschreibung = (r) =>
    projektNachName.get(r.kurzname || String(r.name).split("/").filter(Boolean).pop()) || null;
  const eintraege = [].concat(
    S.zuTunEintraege(m),
    S.dateiEintraege(m, kanten),
    S.hookEintraege(m, kanten, beschreibungen),
    S.ausInventar(m, kanten, ["command"], "commands"),
    S.ausInventar(m, kanten, ["skill", "skill-datei"], "skills"),
    S.ausInventar(m, kanten, ["dauer-regel", "abruf-regel"], "rules"),
    S.kontextEintraege(m, beschreibungen),
    S.werkzeugEintraege(m),
    S.projektEintraege(m, kanten),
    S.backupEintraege(m, projektBeschreibung),
    S.commitEintraege(m)
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
    rules: (inv.dateien || []).filter((d) => d.rolle === "dauer-regel" || d.rolle === "abruf-regel").length,
    kontext: (kontext.stuecke || []).length,
    token: kontext.tokenSchaetzungJeSitzung || 0,
    repos: ((m.bereiche && m.bereiche.sicherung && m.bereiche.sicherung.repos) || []).length,
    commits: jeSeite.commits || 0,
    projekte: ((m.projekte && m.projekte.liste) || []).length,
  };
  zahlen.reposOffen = S.backupEintraege(m, null).filter((r) => r.status !== "ok").length;
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
    if (id === "projekte") {
      // Eigene Zahlen. "doku" heisst auf der Zu-tun-Seite etwas anderes
      // (Offenpunkte aus Dokumenten) und stand hier zuerst mit DEREN Wert.
      // Ein Platzhalter, der eine fremde Zahl bekommt, ist schlimmer als
      // einer, der leer bleibt -- er sieht gemessen aus.
      const p = m.projekte || { liste: [] };
      eigen.doku = zahl((p.liste || []).reduce((s, x) => s + (x.anzahlDokumente || 0), 0));
      eigen.ohne = zahl(p.ohneDokumente || 0);
    }
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

  // KEIN vorgerendertes Markdown mehr (Server-zuerst, D1). Frueher lag hier je
  // .md eine HTML-Fassung im Datensatz -- ~580 KB. Jetzt liefert serve.js den
  // Rohtext auf Klick und rendert .md dabei; der Browser holt beides auf Abruf.
  return sicherung({
    schema: m.schema,
    gemessenAm: m.gemessenAm,
    gemessenText: datum(m.gemessenAm),
    wurzel: m.wurzel,
    wurzelUrl: inv.wurzelUrl || null,
    workspace: werte.workspace,
    icons,
    fehlt: fehltListe(m),
    seiten,
    navigation: W.NAVIGATION,
    tabgruppen: W.TABGRUPPEN,
    // Was ein Ereignisname bedeutet -- die Anzeige setzt ihn unter den
    // Gruppenkopf, damit ueber einer Gruppe nicht nur ein Fachwort steht.
    ereignisErklaerung: W.EREIGNIS_ERKLAERUNG,
    status: STATUS,
    gesamtstatus: m.gesamtstatus,
    zahlen,
    eintraege,
    worte: UI,
    leer: W.LEER,
    notiz: NOTIZ,
    messfehler: m.messfehler || [],
    kantenFehler: (m.verwandt && m.verwandt.fehler) || [],
    // Die Rohmessung -- OHNE die Projektdokumente. Sie stehen bereits an den
    // Projekt-Eintraegen; ein zweites Mal hier waeren 370 KB doppelt, ohne dass
    // die Rohdaten-Seite dadurch eine Frage mehr beantwortet.
    roh: {
      messung: Object.assign({}, m, {
        projekte: m.projekte
          ? Object.assign({}, m.projekte, {
              liste: (m.projekte.liste || []).map((p) =>
                Object.assign({}, p, {
                  wurzelDokumente: (p.wurzelDokumente || []).map((d) =>
                    Object.assign({}, d, { inhalt: null })
                  ),
                })
              ),
            })
          : null,
      }),
      regeln: regelDaten || null,
    },
  }, false);
}

// ---------------------------------------------------------------------------
// DIE ENGSTELLE -- der letzte Riegel vor der Seite
//
// file-inventory.js sichert DATEIINHALTE zeilenweise. Aber nicht jeder Text im
// Datensatz kommt von dort: rules.js zieht Kernzeilen aus Regeldateien,
// hooks-detail.js Kopfkommentare, todo-docs.js ganze Fundzeilen, related.js
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
      // Seit SERVER-ZUERST (D1) traegt inhalt.text keinen Rumpf mehr (null);
      // der Zweig bleibt stehen, weil inhalt weiter Auskuenfte enthaelt
      // (Sprache, ausgeblendete Zeilen). roh traegt die Messung aus file-inventory.js.
      raus[k] = sicherung(wert[k], imInhalt || k === "inhalt");
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
  // Nur was einem NUTZER etwas sagt. Bausatz- und Ursprungs-Werkbank-Interna
  // (checks/, .ecc-src/) gehoeren nicht hierher -- fuer den Leser des Dashboards
  // sind sie kein fehlendes Stueck, sondern ein Wort, das er nicht kennt.
  const kandidaten = [
    { was: ".claude/agents/", grund: "keine eigenen Agenten-Beschreibungen in diesem Workspace", da: [...pfade].some((p) => p.startsWith(".claude/agents/")) },
    { was: ".mcp.json", grund: "keine projekteigenen MCP-Server eingetragen", da: pfade.has(".mcp.json") },
  ];
  return kandidaten.filter((k) => !k.da).map((k) => ({ was: k.was, grund: k.grund }));
}

function zahlFuerSeite(id, z) {
  const k = { zutun: z.zutun, dateien: z.dateien, hooks: z.hooks, commands: z.commands,
              skills: z.skills, rules: z.rules, kontext: z.kontext, backup: z.repos,
              commits: z.commits, projekte: z.projekte };
  return k[id] != null ? zahl(k[id]) : null;
}


module.exports = { daten, kantenIndex, beschreibungVon, inhaltVon, spracheVon };
