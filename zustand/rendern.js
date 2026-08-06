#!/usr/bin/env node
// RENDERN — Schritt 3 von "messen -> Daten -> rendern -> Datei".
//
// NEUBAU 02.08.2026. Die erste Fassung war ECCs Betriebsbericht mit unseren
// Erklaertexten dazwischen: nach Systemteilen gegliedert, ein 400-KB-Scroll ohne
// Navigation, ohne Handlungsliste — und sie zaehlte den ECC-Fremd-Klon als
// "den Harness". Verworfen aus zwei Gruenden: sie hatte mit der Zieldefinition
// (Keel Light) nichts zu tun, und einen ECC-Betriebsbericht nachzubauen war nie
// der Auftrag.
//
// DIESE FASSUNG IST DIE OBERFLAECHE VON KEEL LIGHT, nicht ein ECC-Nachbau:
// sie folgt Keels eigener Logik — dem Tauchgang aus der Praesentation
// (der Keel-Praesentation aus der Ursprungs-Werkbank), aber SEITWAERTS
// gelegt: die Reiter SIND der Tiefenmesser, links Oberflaeche, nach rechts tiefer.
//
//   0 Oberflaeche   was du siehst, ohne zu tauchen
//   1 Ein Knoten    wer arbeitet woran            (Boards)
//   2 Zwei Knoten   wieviel Leine gibt man        (Planung, Budgets, Freigaben)
//   3 Drei Knoten   was sich gemerkt wird         (Knots)
//   4 Vier Knoten   woraus es gebaut ist          (Articles)
//
// SIEBEN BAUMUSTER (vom Auftraggeber benannt, 21st.dev) — als Muster uebernommen, nicht
// als Pakete: die Seite ist EINE Datei, kein React, kein framer-motion, kein
// externer Aufruf. Sie muss offline lesbar und versendbar bleiben.
//   Pipeline      -> Tiefe 2: der Weg einer Anfrage durch den Harness + Protokoll
//   Stats-Card    -> Tiefe 0: Kennzahlen mit Veraenderung zum letzten Lauf
//   Analytics     -> Tiefe 3: Kontext-Budget als Balken (Momentaufnahme, nicht live)
//   Chrono-Board  -> Tiefe 1: Zeitleiste der Commits
//   Status-List   -> Tiefe 0: die Zu-tun-Liste, gestaffelt
//   Onboard-Card  -> Tiefe 0: die drei Erststart-Schritte
//   Spiral        -> Tiefe 4: in der Tiefe wird das Punktfeld zur Spirale
//
// REINE FUNKTION: renderHTML(daten, regelDaten, vorher) -> String.
// Kein Dateizugriff, keine Messung.

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function md(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
}

const STATUS_TEXT = {
  ok: "in Ordnung",
  hinweis: "Hinweis",
  befund: "Befund",
  fehlt: "fehlt",
  unlesbar: "nicht lesbar",
  gezogen: "gezogen",
};
const RANG = { ok: 0, gezogen: 0, hinweis: 1, befund: 2, fehlt: 3, unlesbar: 4 };

const chip = (status, zusatz) =>
  `<span class="chip s-${esc(status)}"><i></i>${esc(STATUS_TEXT[status] || status)}${zusatz ? " · " + esc(zusatz) : ""}</span>`;

const quelleZeile = (q) =>
  !q ? "" : `<p class="quelle">gezogen aus <code>${esc(q.datei)}</code>${q.zeile ? " Zeile " + esc(q.zeile) : ""}</p>`;

const befehlBlock = (b) => (!b ? "" : `<pre class="befehl"><span>$</span> ${esc(b)}</pre>`);

const zahl = (n) => new Intl.NumberFormat("de-DE").format(Math.round(n || 0));
const kb = (b) => (b >= 1024 ? (b / 1024).toFixed(1) + " kB" : b + " B");

// ---------------------------------------------------------------------------
// Die fuenf Tiefen. Reihenfolge = Reiterfolge, links nach rechts.
// ---------------------------------------------------------------------------
const TIEFEN = [
  {
    id: "oberflaeche",
    knoten: 0,
    marke: "Oberfläche",
    titel: "Was du siehst, ohne zu tauchen",
    leitsatz: "Der Einstieg ist ein Blick — wie tief du gehst, entscheidest du.",
    frage: "Ist es gesund, und was ist zu tun?",
    bereiche: [],
  },
  {
    id: "boards",
    knoten: 1,
    marke: "Ein Knoten",
    titel: "Wer arbeitet woran",
    leitsatz: "Alle an Bord. Eine Crew.",
    frage: "Wer läuft gerade, was ist zuletzt passiert, und geht dabei Arbeit verloren?",
    bereiche: ["rollen", "sicherung", "verlauf"],
  },
  {
    id: "leine",
    knoten: 2,
    marke: "Zwei Knoten",
    titel: "Wieviel Leine gibt man",
    leitsatz: "Eine freie Crew. Dein Kurs.",
    frage: "Was darf allein laufen, was wird geblockt, wieviel Denkbudget bekommt es?",
    bereiche: ["waechter"],
  },
  {
    id: "knots",
    knoten: 3,
    marke: "Drei Knoten",
    titel: "Was sich gemerkt wird",
    leitsatz: "A knot only holds if someone ties it.",
    frage: "Was weiß jede Sitzung von der ersten Sekunde an — und was kostet das?",
    bereiche: ["kontext"],
  },
  {
    id: "articles",
    knoten: 4,
    marke: "Vier Knoten",
    titel: "Woraus es gebaut ist",
    leitsatz: "Every hand signs the articles.",
    frage: "Was ist Eigenbau, was kam mit, und was prüft sich selbst?",
    bereiche: ["bestand", "pruefer", "readiness"],
  },
];

const BEREICH_NAME = {
  kontext: "Kontext je Sitzung",
  bestand: "Bestand",
  waechter: "Wächter",
  sicherung: "Sicherung",
  pruefer: "Mess-Prüfer",
  rollen: "Sitzungen",
  readiness: "Betriebsbericht",
  verlauf: "Verlauf",
};
const BEREICH_TIEFE = TIEFEN.reduce((a, t) => {
  for (const b of t.bereiche) a[b] = t.id;
  return a;
}, {});

// ---------------------------------------------------------------------------
// Gemeinsame Bausteine
// ---------------------------------------------------------------------------
function abschnitt(titel, unterzeile, inhalt, status) {
  return `<section class="block">
    <div class="block-kopf"><h3>${esc(titel)}</h3>${status ? chip(status) : ""}</div>
    ${unterzeile ? `<p class="block-unter">${md(unterzeile)}</p>` : ""}
    ${inhalt}
  </section>`;
}

function tabelle(kopf, reihen, klasse) {
  if (!reihen || !reihen.length) return `<p class="leer">Keine Einträge.</p>`;
  return `<div class="tab-huelle"><table class="${klasse || ""}">
    <thead><tr>${kopf.map((k) => `<th>${md(k)}</th>`).join("")}</tr></thead>
    <tbody>${reihen.map((r) => `<tr>${r.map((z) => `<td>${md(z)}</td>`).join("")}</tr>`).join("")}</tbody>
  </table></div>`;
}

// Gezogene Zeilen kommen mal als String, mal als {text, zeile} herein. Beides
// muss hier ankommen: die erste Fassung schrieb bei Objekten "[object Object]"
// mitten in eine Regel -- der Beleg sah aus wie ein Fehler im Dokument.
const zeileText = (e) => (typeof e === "string" ? e : e?.text || e?.name || e?.titel || JSON.stringify(e));
const zeilePunkt = (e) =>
  `<li>${md(zeileText(e))}${typeof e === "object" && e?.zeile ? ` <span class="zeilennr">Z. ${esc(e.zeile)}</span>` : ""}</li>`;

function regelKarte(r) {
  if (!r) return "";
  let rumpf = "";
  if (r.art === "tabelle") rumpf = tabelle(r.kopf, r.reihen);
  else if (r.eintraege) rumpf = `<ul class="fakten">${r.eintraege.map(zeilePunkt).join("")}</ul>`;
  else if (r.saetze) rumpf = `<ul class="fakten">${r.saetze.map(zeilePunkt).join("")}</ul>`;
  else if (r.befehle) rumpf = r.befehle.map((b) => befehlBlock(typeof b === "string" ? b : b.befehl)).join("");

  const extra = [r.grundsatz, r.hinweis, r.vorgabe, r.abgrenzung, r.anker]
    .filter((x) => typeof x === "string" && x.trim())
    .map((x) => `<p class="notiz">${md(x)}</p>`)
    .join("");

  return `<article class="regel">
    <div class="regel-kopf"><span class="marke">Regel</span><h4>${esc(r.titel || r.id)}</h4>${chip(r.status || "gezogen")}</div>
    ${quelleZeile(r.quelle)}
    ${rumpf}${extra}${befehlBlock(r.befehl)}
    ${(r.uebersprungen || []).length ? `<p class="notiz">Beim Ziehen übersprungen: ${r.uebersprungen.map(esc).join(", ")}</p>` : ""}
  </article>`;
}

const regelVon = (rd, id) => (rd?.liste || []).find((r) => r.id === id);

// ===========================================================================
// TIEFE 0 — Oberflaeche
//   Muster: Stats-Card · Card-Status-List · Onboard-Card
// ===========================================================================
function tiefeOberflaeche(d, rd, vorher) {
  const b = d.bereiche;
  const k = b.kontext || {};
  const bst = b.bestand || {};
  const eig = (bst.nachHerkunft || {}).eigenbau || 0;
  const mit = (bst.nachHerkunft || {}).mitgeliefert || 0;
  const offen = d.zuTun.length;

  const urteil =
    d.gesamtstatus === "ok"
      ? "Harness vollständig — nichts offen."
      : `Harness läuft, ${offen === 1 ? "ein Punkt ist" : zahl(offen) + " Punkte sind"} offen.`;

  // --- Stats-Card: Kennzahl + Veraenderung zum letzten Lauf ---------------
  const vorherWert = (pfad) => {
    if (!vorher) return null;
    try {
      return pfad.split(".").reduce((a, s) => a?.[s], vorher);
    } catch {
      return null;
    }
  };
  const delta = (jetzt, pfad) => {
    const alt = vorherWert(pfad);
    if (alt === null || alt === undefined || alt === jetzt) return "";
    const diff = jetzt - alt;
    return `<span class="delta ${diff > 0 ? "hoch" : "runter"}">${diff > 0 ? "▲" : "▼"} ${zahl(Math.abs(diff))}</span>`;
  };

  const statKarte = (titel, wert, delta_, unter, extra) => `<div class="stat">
    <div class="stat-kopf"><span class="marke">${esc(titel)}</span>${delta_ || ""}</div>
    <div class="stat-wert">${wert}</div>
    ${unter ? `<div class="stat-unter">${md(unter)}</div>` : ""}
    ${extra || ""}
  </div>`;

  // Balken: Anteil Eigenbau am Gesamtbestand -- die eine Zahl, die die
  // erste Fassung dieser Seite verwechselt hat.
  const gesamt = eig + mit || 1;
  const anteilEigen = Math.max(1.2, (eig / gesamt) * 100);

  const kennzahlen = `<div class="stats">
    ${statKarte(
      "Eigenbau",
      zahl(eig),
      delta(eig, "bereiche.bestand.nachHerkunft.eigenbau"),
      "von uns geschrieben — trägt unsere Arbeitsweise",
      `<div class="balken" title="${esc(eig)} von ${esc(gesamt)}"><i style="--w:${anteilEigen.toFixed(2)}%"></i></div>
       <div class="stat-fuss">${anteilEigen.toFixed(1)} % des Bestands</div>`
    )}
    ${statKarte("mitgeliefert", zahl(mit), delta(mit, "bereiche.bestand.nachHerkunft.mitgeliefert"), "kam mit ECC, unverändert übernommen")}
    ${statKarte(
      "Token je Sitzung",
      "~" + zahl(k.tokenSchaetzungJeSitzung || 0),
      delta(k.tokenSchaetzungJeSitzung || 0, "bereiche.kontext.tokenSchaetzungJeSitzung"),
      "geschätzt, geladen bevor jemand etwas tippt"
    )}
    ${statKarte("offene Punkte", zahl(offen), "", offen ? "unten aufgelistet, mit Befehl" : "nichts liegt an")}
  </div>
  <p class="notiz">Die erste Fassung dieser Seite meldete hier „67 Agenten · 280 Fähigkeiten · 96 Befehle“ und
  nannte das den Harness. Das war der ECC-Fremd-Klon. Der Harness ist die linke Zahl plus das, was von der
  zweiten wirklich benutzt wird.${vorher ? "" : " <em>Erster Lauf — kein Vergleich möglich.</em>"}</p>`;

  // --- Card-Status-List: die Zu-tun-Liste, gestaffelt --------------------
  const zuTun = d.zuTun.length
    ? `<ol class="zutun">${d.zuTun
        .map(
          (z, i) => `<li style="--i:${i}">
            <div class="zutun-kopf">
              <span class="marke">${esc(BEREICH_NAME[z.bereich] || z.bereich)}</span>
              ${chip(z.status)}
              <a class="sprung" href="#${esc(BEREICH_TIEFE[z.bereich] || "articles")}" data-tiefe="${esc(BEREICH_TIEFE[z.bereich] || "articles")}">ansehen →</a>
            </div>
            <p class="zutun-text">${md(z.text)}</p>
            ${z.grund && z.grund !== z.text ? `<p class="notiz">${md(z.grund)}</p>` : ""}
            ${befehlBlock(z.befehl)}
          </li>`
        )
        .join("")}</ol>`
    : `<p class="gut">Nichts zu tun. Jeder gemessene Bereich steht auf „in Ordnung“.</p>`;

  const messfehler = d.messfehler.length
    ? `<div class="warn"><strong>Messfehler in dieser Seite selbst.</strong>
        <p>Diese Bereiche stehen nicht auf „in Ordnung“, sagen aber nicht, was zu tun ist. Ein Hinweis ohne
        Handlung ist ein Mangel der Messung — deshalb steht er hier, statt still zu bleiben.</p>
        <ul class="fakten">${d.messfehler.map((m) => `<li><code>${esc(m.bereich)}</code> — ${md(m.was)}</li>`).join("")}</ul></div>`
    : "";

  // --- Onboard-Card: die drei Erststart-Schritte -------------------------
  const schritte = [
    { name: "Paket ausgepackt", fertig: true, wie: `Harness gefunden unter <code>${esc(d.harness)}</code>` },
    {
      name: "Onboarding gelaufen",
      fertig: (k.stuecke || []).length > 0,
      wie: (k.stuecke || []).length ? `${zahl((k.stuecke || []).length)} Dateien laden dauerhaft` : "CLAUDE.md und Dauer-Regeln fehlen noch",
    },
    { name: "Zustand gemessen", fertig: true, wie: `${zahl(Object.keys(b).length)} Bereiche, ${zahl(offen)} offen` },
  ];
  const onboard = `<div class="onboard">${schritte
    .map(
      (s, i) => `<div class="ob-schritt ${s.fertig ? "fertig" : "offen"}" style="--i:${i}">
        <span class="ob-punkt"></span>
        <div><div class="ob-name">${esc(s.name)}</div><div class="ob-wie">${s.wie}</div></div>
      </div>`
    )
    .join("")}</div>`;

  // --- Ampel: Sprung in die zustaendige Tiefe ----------------------------
  const ampel = Object.entries(b)
    .map(([id, x]) => {
      const ziel = BEREICH_TIEFE[id] || "articles";
      const t = TIEFEN.find((y) => y.id === ziel) || {};
      return `<a class="ampel s-${esc(x.status)}" href="#${esc(ziel)}" data-tiefe="${esc(ziel)}">
        <span class="ampel-name">${esc(BEREICH_NAME[id] || id)}</span>${chip(x.status)}
        <span class="ampel-tiefe">${esc(t.marke || "")}</span></a>`;
    })
    .join("");

  return `
  ${messfehler}
  <div class="urteil">
    <p class="urteil-satz">${esc(urteil)}</p>
    <p class="urteil-unter">gemessen ${esc(new Date(d.gemessenAm).toLocaleString("de-DE"))} · Node ${esc(d.node)}</p>
  </div>

  ${abschnitt("Erststart", "Die drei Schritte des Bausatzes — gemessen, nicht abgehakt.", onboard)}
  ${abschnitt("Kennzahlen", "Mit Veränderung zum letzten Lauf, sofern einer vorliegt.", kennzahlen)}
  ${abschnitt("Zu tun", "Jeder Bereich, der nicht auf „in Ordnung“ steht, erzeugt hier genau eine Zeile — mit dem Befehl dazu.", zuTun)}
  ${abschnitt("Wo es klemmt", "Klick springt in die Tiefe, in der der Bereich wohnt.", `<div class="ampel-feld">${ampel}</div>`)}
  ${regelKarte(regelVon(rd, "werkzeugrang"))}
  `;
}

// ===========================================================================
// TIEFE 1 — Ein Knoten: wer arbeitet woran
//   Muster: Chrono-Board
// ===========================================================================
function tiefeBoards(d, rd) {
  const r = d.bereiche.rollen || {};
  const s = d.bereiche.sicherung || {};
  const v = d.bereiche.verlauf || {};

  const rollen = (r.rollen || []).length
    ? tabelle(
        ["Sitzung", "Ebene", "Zweck"],
        r.rollen.map((x) => [`**${x.titel || x.name || "—"}**`, x.ebene || "—", x.zweck || x.kurzzweck || "—"])
      )
    : `<p class="leer">Keine Rollen-Tabelle gefunden${r.quelle ? ` (erwartet in <code>${esc(r.quelle)}</code>)` : ""}.</p>`;

  const repos = tabelle(
    ["Repo", "Zweig & Stand", "Server", "ungesichert"],
    (s.repos || []).map((x) => [`**${x.name}**`, x.git || "—", x.sync || "—", x.ungesichert ? `**${x.ungesichert}**` : "0"]),
    "repos"
  );

  // --- Chrono-Board: Zeitleiste mit Tagestrennern ------------------------
  const eintraege = v.eintraege || [];
  let letzterTag = null;
  const zeitleiste = eintraege.length
    ? `<ol class="chrono">${eintraege
        .map((e, i) => {
          const tag = (e.datum || "").slice(0, 10);
          const neu = tag !== letzterTag;
          letzterTag = tag;
          const uhr = (e.datum || "").slice(11, 16);
          const kurzRepo = e.repo.split("/").pop();
          return `${neu ? `<li class="chrono-tag"><span>${esc(new Date(tag).toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "long" }))}</span></li>` : ""}
          <li class="chrono-e" style="--i:${i}">
            <span class="chrono-zeit">${esc(uhr)}</span>
            <span class="chrono-punkt"></span>
            <div class="chrono-karte">
              <div class="chrono-kopf"><span class="pill repo">${esc(kurzRepo)}</span><code>${esc(e.hash)}</code></div>
              <div class="chrono-text">${esc(e.betreff)}</div>
            </div>
          </li>`;
        })
        .join("")}</ol>`
    : `<p class="leer">Kein Git-Verlauf lesbar.</p>`;

  return `
  ${abschnitt(
    "Die Sitzungen",
    "Mehrere Sitzungen arbeiten im selben Ordner. Die Tabelle lädt bei jedem Sitzungsstart automatisch — deshalb weiß jede von den anderen, ohne dass jemand einen Befehl tippt.",
    rollen,
    r.status
  )}
  ${abschnitt(
    "Was zuletzt passiert ist",
    `Die letzten ${zahl(eintraege.length)} Commits über alle Repos, neueste zuerst. Ohne Wertung: die Zeitleiste zeigt, **was** passiert ist, nicht ob es gut war.`,
    zeitleiste,
    v.status
  )}
  ${abschnitt(
    "Die Repos",
    "Ein Projekt = ein Repo. Ungesicherte Änderungen sind kein Fehler, solange sie jemandem gehören — verloren sind sie trotzdem, wenn die Platte stirbt.",
    repos + (s.grund ? `<div class="warn"><strong>Warum Hinweis:</strong> ${md(s.grund)}</div>` : ""),
    s.status
  )}
  ${regelKarte(regelVon(rd, "sicherung"))}
  `;
}

// ===========================================================================
// TIEFE 2 — Zwei Knoten: wieviel Leine
//   Muster: AI-Agent-Pipeline
// ===========================================================================
function tiefeLeine(d, rd) {
  const w = d.bereiche.waechter || {};
  const eintraege = w.eintraege || [];
  const blockt = (e) => /block|verhinder|stopp|abbruch|exit 2/i.test(String(e.pruefung || "") + String(e.ansage || "") + String(e.skript || ""));
  const blockend = eintraege.filter(blockt);

  // --- Pipeline: der Weg einer Anfrage durch DIESEN Harness -------------
  // Die Stufen sind nicht erfunden, sondern die tatsaechliche Reihenfolge:
  // Sitzungsstart -> Kontext -> Anfrage -> Werkzeugaufruf -> Waechter -> Ausfuehrung.
  const stufen = [
    { name: "Sitzungsstart", zeichen: "◐", wert: `${zahl((d.bereiche.kontext?.stuecke || []).length)} Dateien`, was: "Kontext und Rollen laden" },
    { name: "Anfrage", zeichen: "◑", wert: "Modell + Denkbudget", was: "Modellwahl und Effort-Stufe nach Aufgabentyp" },
    { name: "Werkzeugaufruf", zeichen: "◒", wert: `${zahl(eintraege.length)} Wächter`, was: "jeder Aufruf läuft durch die Hooks" },
    { name: "Schranke", zeichen: "◓", wert: `${zahl(blockend.length)} blockend`, was: "blockt oder sagt nur an", schranke: true },
    { name: "Ausführung", zeichen: "●", wert: "Werkzeug läuft", was: "erst hier passiert etwas" },
  ];

  const pipeline = `<div class="pipe">
    <div class="pipe-bahn" aria-hidden="true"><span class="pipe-puls"></span></div>
    <ol class="pipe-stufen">${stufen
      .map(
        (s, i) => `<li class="pipe-stufe${s.schranke ? " ist-schranke" : ""}" style="--i:${i}">
          <span class="pipe-zeichen">${s.zeichen}</span>
          <span class="pipe-name">${esc(s.name)}</span>
          <span class="pipe-wert">${esc(s.wert)}</span>
          <span class="pipe-was">${esc(s.was)}</span>
        </li>`
      )
      .join("")}</ol>
  </div>`;

  // --- Protokoll: was die Waechter tatsaechlich tun ----------------------
  const protokoll = eintraege.length
    ? `<div class="protokoll">${eintraege
        .map(
          (e, i) => `<div class="pr-zeile${blockt(e) ? " blockt" : ""}" style="--i:${i}">
            <span class="pr-ereignis">${esc(e.ereignis || "—")}</span>
            <span class="pr-matcher"><code>${esc(e.matcher || "*")}</code></span>
            <span class="pr-skript">${e.skript ? `<code>${esc(e.skript)}</code>` : "<em>inline</em>"}</span>
            <span class="pr-wirkung">${blockt(e) ? "blockt" : "sagt an"}</span>
            <span class="pr-text">${esc(e.ansage || e.pruefung || "—")}</span>
          </div>`
        )
        .join("")}</div>`
    : `<p class="leer">Keine Wächter verdrahtet.</p>`;

  return `
  <div class="leitgedanke">
    <p><strong>Leine ist keine Metapher, sondern eine Einstellung.</strong> Drei Dinge bestimmen, wieviel
    ein Agent hier allein darf: <em>was ihn blockt</em>, <em>wieviel er denken darf</em> und <em>welches
    Modell er bekommt</em>. Alle drei stehen unten — gezogen aus den Dokumenten, nicht aus dem Gedächtnis.</p>
  </div>

  ${abschnitt(
    "Der Weg einer Anfrage",
    "Fünf Stufen, in dieser Reihenfolge. Die vierte ist die einzige, die etwas verhindern kann.",
    pipeline
  )}

  ${abschnitt(
    "Die Wächter — was blockt, was nur ansagt",
    `${zahl(eintraege.length)} verdrahtet, davon **${zahl(blockend.length)} mit Blockwirkung**. Ein Wächter, der nur warnt, ist eine Bitte; einer, der blockt, ist eine Schranke.`,
    protokoll,
    w.status
  )}

  ${regelKarte(regelVon(rd, "waechterkanon"))}
  ${regelKarte(regelVon(rd, "effort"))}
  ${regelKarte(regelVon(rd, "modellwahl"))}
  `;
}

// ===========================================================================
// TIEFE 3 — Drei Knoten: was sich gemerkt wird
//   Muster: Real-time-Analytics (ehrlich als Momentaufnahme beschriftet)
// ===========================================================================
function tiefeKnots(d, rd) {
  const k = d.bereiche.kontext || {};
  const stuecke = k.stuecke || [];
  const dauerhaft = stuecke.filter((s) => s.art !== "Hook-Skript");
  const summe = dauerhaft.reduce((a, s) => a + s.bytes, 0) || 1;
  const sortiert = dauerhaft.slice().sort((a, b) => b.bytes - a.bytes);
  const groesstes = sortiert[0];

  const balken = `<div class="analytics">
    <div class="an-kopf">
      <div><div class="an-wert">~${zahl(k.tokenSchaetzungJeSitzung || 0)}</div><div class="marke">Token je Sitzung (geschätzt)</div></div>
      <div class="an-puls" aria-hidden="true"><span></span><span></span><span></span></div>
    </div>
    <div class="an-liste">${sortiert
      .map((s, i) => {
        const p = (s.bytes / summe) * 100;
        return `<div class="an-zeile" style="--i:${i};--p:${p.toFixed(2)}%">
          <span class="an-name"><code>${esc(s.pfad)}</code></span>
          <span class="an-bar"><i></i></span>
          <span class="an-zahl">${esc(kb(s.bytes))} · ${p.toFixed(1)} %</span>
        </div>`;
      })
      .join("")}</div>
    <p class="notiz">Momentaufnahme vom ${esc(new Date(d.gemessenAm).toLocaleString("de-DE"))} — <strong>nicht live</strong>.
    Die Seite aktualisiert sich nicht selbst; sie wird erzeugt.</p>
  </div>`;

  const hooks = stuecke.filter((s) => s.art === "Hook-Skript");
  const hookTab = tabelle(
    ["Skript", "Warum", "Größe"],
    hooks.map((h) => [`\`${h.pfad}\``, h.warum, kb(h.bytes)])
  );

  return `
  <div class="leitgedanke">
    <p><strong>Ein Knoten hält nur, wenn ihn jemand knüpft.</strong> Was hier steht, weiß jede Sitzung ab
    der ersten Sekunde — ohne Suchen, ohne Nachfragen. Was hier <em>nicht</em> steht, muss jede Sitzung
    neu erarbeiten.</p>
  </div>

  ${abschnitt(
    "Was in jeder Sitzung geladen wird",
    `${zahl(dauerhaft.length)} Dateien, ${esc(kb(summe))}, geschätzt **~${zahl(k.tokenSchaetzungJeSitzung || 0)} Token** — bevor irgendjemand etwas tippt.${
      groesstes ? ` Größter Brocken: \`${groesstes.pfad}\` mit ${((groesstes.bytes / summe) * 100).toFixed(0)} %.` : ""
    }`,
    balken + `<p class="notiz">${md(k.faktorHinweis || "")}</p>`,
    k.status
  )}

  ${abschnitt(
    "Die Hook-Skripte",
    "Sie laden nicht als Text in den Kontext — sie **laufen** bei jedem Sitzungsstart, und ihre Ausgabe landet darin. Deshalb getrennt gezählt.",
    hookTab
  )}

  ${regelKarte(regelVon(rd, "dauerregeln"))}
  `;
}

// ===========================================================================
// TIEFE 4 — Vier Knoten: woraus es gebaut ist
//   Muster: Spiral (Hintergrund — in der Tiefe wird das Punktfeld zur Spirale)
// ===========================================================================
function tiefeArticles(d) {
  const b = d.bereiche.bestand || {};
  const p = d.bereiche.pruefer || {};
  const rd = d.bereiche.readiness || {};

  const gruppen = (b.gruppen || [])
    .map((g) => {
      const h = (g.einordnung || {}).nachHerkunft || {};
      const posten = (g.posten || []).slice().sort((a, x) => (a.herkunft === "eigenbau" ? -1 : x.herkunft === "eigenbau" ? 1 : 0));
      return `<details class="gruppe"${h.eigenbau ? " open" : ""}>
        <summary>
          <span class="gruppe-titel">${esc(g.titel)}</span>
          <span class="gruppe-zahl">${zahl(g.anzahl)}</span>
          ${h.eigenbau ? `<span class="pill eigen">${zahl(h.eigenbau)} Eigenbau</span>` : ""}
          ${h.mitgeliefert ? `<span class="pill mit">${zahl(h.mitgeliefert)} mitgeliefert</span>` : ""}
          ${chip(g.status)}
        </summary>
        ${g.notiz ? `<p class="notiz">${md(g.notiz)}</p>` : ""}
        ${g.grund ? `<p class="notiz warnzeile">${md(g.grund)}</p>` : ""}
        ${
          posten.length
            ? `<ul class="posten">${posten
                .map(
                  (x) =>
                    `<li${x.herkunft === "eigenbau" ? ' class="ist-eigen"' : ""}><code>${esc(x.name)}</code>${
                      x.herkunft === "eigenbau" ? '<span class="pill eigen">Eigenbau</span>' : ""
                    }${x.beschreibung ? ` <span class="posten-text">${esc(x.beschreibung)}</span>` : ""}</li>`
                )
                .join("")}</ul>`
            : `<p class="leer">Keine Einträge.</p>`
        }
      </details>`;
    })
    .join("");

  const probe = b.kontrollprobe;
  const probeBlock = probe
    ? `<div class="${probe.bestanden ? "gut" : "warn"}">
        <strong>Kontrollprobe der Herkunftsbestimmung: ${probe.bestanden ? "bestanden" : "FEHLGESCHLAGEN"}.</strong>
        <ul class="fakten">${probe.faelle
          .map((f) => `<li>${esc(f.name)} — erwartet <code>${esc(f.erwartet)}</code>, gemessen <code>${esc(f.ergebnis ?? "—")}</code>${f.hinweis ? " · " + esc(f.hinweis) : ""}</li>`)
          .join("")}</ul>
        <p class="notiz">Ohne diese Probe würde ein kaputter <code>.ecc-src/</code>-Pfad alles zu „Eigenbau“ erklären —
        ein Messfehler, der wie ein Erfolg aussieht.</p>
      </div>`
    : "";

  const laeufe = tabelle(
    ["Prüfer", "Ergebnis", "Bedeutung"],
    (p.laeufe || []).map((x) => [`\`${x.name || x.skript || "—"}\``, STATUS_TEXT[x.status] || x.status, x.grund || x.ausgabe || "—"])
  );

  const anforderungen = (rd.anforderungen || []).length
    ? tabelle(["Anforderung", "Stand"], rd.anforderungen.map((a) => [a.name || a.id || "—", STATUS_TEXT[a.status] || a.status || "—"]))
    : `<p class="leer">Der Betriebsbericht lieferte keine Anforderungsliste.</p>`;

  return `
  <canvas class="spirale" aria-hidden="true"></canvas>
  <div class="leitgedanke">
    <p><strong>Jede Hand unterschreibt die Articles.</strong> Was hier liegt, gilt für alle, die in diesem
    Ordner arbeiten — Mensch wie Agent. Deshalb steht an jedem Posten, ob wir ihn gebaut haben oder ob er mitkam.</p>
  </div>

  ${abschnitt("Bestand nach Herkunft", "Eigenbau steht oben und ist aufgeklappt. Mitgeliefertes ist eingeklappt.", probeBlock + gruppen, b.status)}
  ${abschnitt("Die Mess-Prüfer", "Skripte, die diese Seite selbst kontrollieren. Ein Prüfer, der nie fehlschlägt, prüft nichts.", laeufe, p.status)}
  ${abschnitt(
    "Betriebsbericht (ECC)",
    rd.grund || "Der mitgelieferte Betriebsbericht misst allgemeine Projekt-Reife, nicht unseren Harness — deshalb steht er hier unten und nicht oben.",
    anforderungen +
      ((rd.naechsteSchritte || []).length
        ? `<p class="block-unter">Vorgeschlagene nächste Schritte:</p><ul class="fakten">${rd.naechsteSchritte.map((x) => `<li>${md(x)}</li>`).join("")}</ul>`
        : ""),
    rd.status
  )}
  `;
}

// ===========================================================================
// Zusammenbau
// ===========================================================================
function renderHTML(daten, regelDaten, vorher) {
  const inhalte = {
    oberflaeche: tiefeOberflaeche(daten, regelDaten, vorher),
    boards: tiefeBoards(daten, regelDaten),
    leine: tiefeLeine(daten, regelDaten),
    knots: tiefeKnots(daten, regelDaten),
    articles: tiefeArticles(daten),
  };

  const tiefeStatus = (t) =>
    t.bereiche.reduce((a, b) => {
      const s = daten.bereiche[b]?.status || "ok";
      return RANG[s] > RANG[a] ? s : a;
    }, "ok");

  const reiter = TIEFEN.map(
    (t, i) => `<a class="reiter" href="#${t.id}" data-tiefe="${t.id}" role="tab" aria-controls="p-${t.id}" aria-selected="${i === 0}">
      <span class="reiter-zahl">${t.knoten}<i>${t.knoten === 0 ? "Oberfläche" : t.knoten === 1 ? "Knoten" : "Knoten"}</i></span>
      <span class="reiter-titel">${esc(t.titel)}</span>
      ${chip(t.id === "oberflaeche" ? daten.gesamtstatus : tiefeStatus(t))}
      <span class="reiter-linie" style="--i:${i}"></span>
    </a>`
  ).join("");

  const panels = TIEFEN.map(
    (t) => `<section class="panel z${t.knoten}" id="p-${t.id}" data-panel="${t.id}" role="tabpanel">
      <header class="panel-kopf">
        <p class="marke">${t.knoten === 0 ? "Oberfläche" : esc(t.marke)}</p>
        <h2>${esc(t.titel)}</h2>
        <p class="leitsatz">„${esc(t.leitsatz)}“</p>
        <p class="frage">${esc(t.frage)}</p>
      </header>
      ${inhalte[t.id]}
    </section>`
  ).join("");

  return `<!doctype html>
<html lang="de" data-tiefe="oberflaeche">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Keel — Tauchgang · Harness-Zustand</title>
<style>
:root{
  --serif:"Iowan Old Style",Palatino,"Palatino Linotype","Book Antiqua",Georgia,serif;
  --sans:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  --mono:ui-monospace,"SF Mono",SFMono-Regular,Menlo,Consolas,monospace;
  --ease:cubic-bezier(.16,1,.3,1);
}
*{box-sizing:border-box}
html,body{margin:0}
body{ font-family:var(--sans); font-size:clamp(15px,.38vw + 13.7px,16.5px); line-height:1.6;
  -webkit-font-smoothing:antialiased; color:var(--ink); background:var(--bg-b); transition:background .6s var(--ease) }

/* ===== Zonen — dieselbe Palette wie die Keel-Praesentation. Links hell, rechts tief. ===== */
.z0{ --bg-a:oklch(97.8% .007 214); --bg-b:oklch(92% .028 212) }
.z1{ --bg-a:oklch(92% .028 212);   --bg-b:oklch(85% .042 213) }
.z2{ --bg-a:oklch(85% .042 213);   --bg-b:oklch(72.5% .058 218) }
.z3{ --bg-a:oklch(70% .06 220);    --bg-b:oklch(44% .066 228) }
.z4{ --bg-a:oklch(34% .062 229);   --bg-b:oklch(17% .04 237) }
.z0,.z1,.z2{ --ink:oklch(20% .025 233); --ink-2:oklch(34% .024 230); --ink-3:oklch(46% .022 228);
  --line:oklch(28% .03 230/.28); --line-soft:oklch(28% .03 230/.13); --card:oklch(99% .004 210/.76);
  --accent:oklch(40% .07 224); --accent-soft:oklch(40% .07 224/.12) }
.z3,.z4{ --ink:oklch(94% .012 210); --ink-2:oklch(84% .018 214); --ink-3:oklch(72% .02 218);
  --line:oklch(92% .02 210/.26); --line-soft:oklch(92% .02 210/.12); --card:oklch(30% .045 233/.55);
  --accent:oklch(80% .075 205); --accent-soft:oklch(80% .075 205/.16) }

/* ===== Kopf mit dem wogenden Punktfeld ===== */
.kopf{ position:relative; overflow:hidden; background:linear-gradient(180deg,oklch(97.8% .007 214),oklch(92% .028 212)) }
canvas#surface{ position:absolute; inset:auto 0 0 0; height:62%; width:100%; pointer-events:none }
.kopf-inner{ position:relative; z-index:1; max-width:76rem; margin:0 auto;
  padding:clamp(1.3rem,3.2vw,2.4rem) clamp(1rem,3vw,2rem) clamp(2.4rem,5.5vw,3.6rem) }
.kopf .sub{ margin:0; font-family:var(--mono); font-size:.68rem; letter-spacing:.22em; text-transform:uppercase; color:oklch(46% .022 228) }
.kopf h1{ margin:.35rem 0 0; font-family:var(--serif); font-weight:600; letter-spacing:-.022em;
  font-size:clamp(2.2rem,5.6vw,3.6rem); color:oklch(19% .025 233); line-height:1 }
.kopf .pfad{ margin:.85rem 0 0; font-family:var(--mono); font-size:.74rem; color:oklch(38% .024 230); word-break:break-all }

/* ===== Tiefenmesser = die Reiter ===== */
.messer{ position:sticky; top:0; z-index:30; background:var(--bg-a); border-bottom:1px solid var(--line); backdrop-filter:blur(10px) }
.messer-inner{ max-width:76rem; margin:0 auto; display:flex; overflow-x:auto; padding:0 clamp(.3rem,1.5vw,1rem) }
.reiter{ flex:1 1 0; min-width:8.6rem; position:relative; display:flex; flex-direction:column; gap:.15rem;
  padding:.8rem .75rem 1.1rem; text-decoration:none; color:var(--ink-2); border-right:1px solid var(--line-soft);
  transition:background .3s var(--ease),color .3s var(--ease) }
.reiter:last-child{ border-right:0 }
.reiter:hover{ background:var(--accent-soft); color:var(--ink) }
.reiter-zahl{ display:flex; align-items:baseline; gap:.35rem; font-family:var(--mono); font-size:1.4rem; font-weight:600; line-height:1; color:var(--ink-3) }
.reiter-zahl i{ font-style:normal; font-size:.54rem; letter-spacing:.18em; text-transform:uppercase }
.reiter-titel{ font-family:var(--serif); font-size:.96rem; line-height:1.22; color:var(--ink) }
.reiter .chip{ margin-top:.25rem; align-self:flex-start }
.reiter-linie{ position:absolute; left:0; right:0; bottom:0; height:3px;
  background:oklch(calc(93% - var(--i)*16%) calc(.02 + var(--i)*.012) 220) }
html.js .reiter[aria-selected=true]{ background:var(--card); color:var(--ink) }
html.js .reiter[aria-selected=true] .reiter-zahl{ color:var(--accent) }
html.js .reiter[aria-selected=true] .reiter-linie{ height:5px }

/* ===== Panels ===== */
.panel{ position:relative; background:linear-gradient(180deg,var(--bg-a),var(--bg-b)); color:var(--ink);
  padding:clamp(1.6rem,4vw,2.8rem) 0 clamp(2.6rem,6vw,4.4rem) }
html.js .panel{ display:none }
html.js .panel.aktiv{ display:block; animation:tauchen .5s var(--ease) }
@keyframes tauchen{ from{ opacity:0; transform:translateY(12px) } to{ opacity:1; transform:none } }
.panel > *{ position:relative; z-index:1; max-width:76rem; margin-left:auto; margin-right:auto;
  padding-left:clamp(1rem,3vw,2rem); padding-right:clamp(1rem,3vw,2rem) }
canvas.spirale{ position:absolute; inset:0; width:100%; height:100%; z-index:0; opacity:.5; pointer-events:none; padding:0; max-width:none }
.panel-kopf{ margin-bottom:clamp(1.2rem,3vw,1.9rem) }
.panel-kopf .marke{ margin:0 }
.panel-kopf h2{ margin:.3rem 0 0; font-family:var(--serif); font-weight:600; letter-spacing:-.016em; font-size:clamp(1.7rem,3.6vw,2.5rem) }
.panel-kopf .leitsatz{ margin:.45rem 0 .2rem; font-family:var(--serif); font-style:italic; font-size:1.06rem; color:var(--ink-2) }
.panel-kopf .frage{ margin:0; font-size:.9rem; color:var(--ink-3) }

.block{ margin:0 auto clamp(1.4rem,3vw,2.1rem) }
.block-kopf{ display:flex; align-items:baseline; gap:.7rem; flex-wrap:wrap; border-bottom:1px solid var(--line); padding-bottom:.42rem; margin-bottom:.7rem }
.block-kopf h3{ margin:0; font-family:var(--serif); font-weight:600; font-size:1.18rem }
.block-unter{ margin:0 0 .8rem; font-size:.89rem; color:var(--ink-2); max-width:54rem }
.urteil{ margin:0 auto clamp(1.3rem,3vw,1.9rem) }
.urteil-satz{ margin:0; font-family:var(--serif); font-weight:600; letter-spacing:-.018em; font-size:clamp(1.55rem,3.8vw,2.4rem); line-height:1.18 }
.urteil-unter{ margin:.45rem 0 0; font-family:var(--mono); font-size:.72rem; color:var(--ink-3) }

/* ===== Stats-Card ===== */
.stats{ display:grid; grid-template-columns:repeat(auto-fit,minmax(12rem,1fr)); gap:.6rem }
.stat{ background:var(--card); border:1px solid var(--line-soft); border-radius:4px; padding:.85rem .9rem }
.stat-kopf{ display:flex; justify-content:space-between; align-items:center; gap:.5rem }
.stat-wert{ font-family:var(--serif); font-size:2.05rem; font-weight:600; line-height:1.05; margin-top:.15rem }
.stat-unter{ margin-top:.3rem; font-size:.81rem; color:var(--ink-2) }
.stat-fuss{ margin-top:.25rem; font-family:var(--mono); font-size:.66rem; color:var(--ink-3) }
.delta{ font-family:var(--mono); font-size:.66rem; padding:.12rem .35rem; border-radius:99px }
.delta.hoch{ color:oklch(50% .12 152); background:oklch(70% .12 152/.16) }
.delta.runter{ color:oklch(53% .15 30); background:oklch(70% .14 30/.16) }
.balken{ margin-top:.5rem; height:5px; border-radius:99px; background:var(--line-soft); overflow:hidden }
.balken i{ display:block; height:100%; width:0; border-radius:99px; background:var(--accent); animation:fuellen 1s var(--ease) .15s forwards }
@keyframes fuellen{ to{ width:var(--w) } }

/* ===== Onboard-Card ===== */
.onboard{ display:grid; grid-template-columns:repeat(auto-fit,minmax(13rem,1fr)); gap:.6rem }
.ob-schritt{ display:flex; gap:.6rem; align-items:flex-start; padding:.75rem .85rem; border-radius:4px;
  background:var(--card); border:1px solid var(--line-soft); opacity:0; animation:auf .5s var(--ease) forwards; animation-delay:calc(var(--i)*.14s) }
@keyframes auf{ from{ opacity:0; transform:translateY(6px) } to{ opacity:1; transform:none } }
.ob-punkt{ flex:none; width:12px; height:12px; margin-top:.3rem; border-radius:50%; border:2px solid var(--line) }
.ob-schritt.fertig .ob-punkt{ border-color:oklch(55% .13 152); background:oklch(62% .13 152);
  box-shadow:0 0 0 0 oklch(62% .13 152/.5); animation:ping 2.6s ease-out infinite; animation-delay:calc(var(--i)*.14s + .5s) }
.ob-schritt.offen .ob-punkt{ border-color:oklch(62% .13 78); border-style:dashed }
@keyframes ping{ 0%{ box-shadow:0 0 0 0 oklch(62% .13 152/.45) } 70%,100%{ box-shadow:0 0 0 9px oklch(62% .13 152/0) } }
.ob-name{ font-family:var(--serif); font-size:1rem; font-weight:600 }
.ob-wie{ font-size:.81rem; color:var(--ink-2) }

/* ===== Card-Status-List (Zu tun) ===== */
ol.zutun{ margin:0; padding:0; list-style:none; counter-reset:z }
ol.zutun li{ counter-increment:z; position:relative; padding:.75rem .9rem .75rem 2.6rem; margin-bottom:.5rem;
  background:var(--card); border:1px solid var(--line-soft); border-left:3px solid oklch(62% .13 78); border-radius:4px;
  opacity:0; animation:auf .5s var(--ease) forwards; animation-delay:calc(var(--i)*.09s) }
ol.zutun li::before{ content:counter(z); position:absolute; left:.9rem; top:.72rem; font-family:var(--mono); font-size:1rem; font-weight:600; color:var(--accent) }
.zutun-kopf{ display:flex; gap:.5rem; align-items:center; margin-bottom:.2rem; flex-wrap:wrap }
.zutun-text{ margin:.15rem 0 }
.sprung{ margin-left:auto; font-family:var(--mono); font-size:.66rem; letter-spacing:.1em; text-transform:uppercase; color:var(--accent); text-decoration:none }
.sprung:hover{ text-decoration:underline }

/* ===== Ampel ===== */
.ampel-feld{ display:grid; grid-template-columns:repeat(auto-fit,minmax(11.5rem,1fr)); gap:.5rem }
.ampel{ display:flex; flex-direction:column; gap:.28rem; padding:.65rem .8rem; text-decoration:none; color:inherit;
  background:var(--card); border:1px solid var(--line-soft); border-left:3px solid var(--line); border-radius:4px;
  transition:transform .25s var(--ease),border-left-color .25s var(--ease) }
.ampel:hover{ transform:translateX(3px); border-left-color:var(--accent) }
.ampel.s-hinweis{ border-left-color:oklch(62% .13 78) }
.ampel.s-befund,.ampel.s-fehlt,.ampel.s-unlesbar{ border-left-color:oklch(56% .17 27) }
.ampel-name{ font-family:var(--serif); font-size:1rem }
.ampel-tiefe{ font-family:var(--mono); font-size:.58rem; letter-spacing:.16em; text-transform:uppercase; color:var(--ink-3) }

/* ===== Pipeline ===== */
.pipe{ position:relative; padding:.4rem 0 .2rem }
.pipe-bahn{ position:absolute; left:1.4rem; right:1.4rem; top:2.15rem; height:2px; background:var(--line-soft); overflow:hidden; border-radius:99px }
.pipe-puls{ position:absolute; top:0; left:0; height:100%; width:16%; border-radius:99px;
  background:linear-gradient(90deg,transparent,var(--accent),transparent); animation:fliessen 3.4s linear infinite }
@keyframes fliessen{ from{ transform:translateX(-110%) } to{ transform:translateX(700%) } }
ol.pipe-stufen{ position:relative; display:grid; grid-template-columns:repeat(5,1fr); gap:.5rem; margin:0; padding:0; list-style:none }
.pipe-stufe{ display:flex; flex-direction:column; align-items:center; text-align:center; gap:.18rem; padding:.2rem .3rem;
  opacity:0; animation:auf .5s var(--ease) forwards; animation-delay:calc(var(--i)*.12s) }
.pipe-zeichen{ display:grid; place-items:center; width:2.2rem; height:2.2rem; border-radius:50%; font-size:1rem;
  background:var(--card); border:1px solid var(--line); color:var(--accent) }
.pipe-stufe.ist-schranke .pipe-zeichen{ border-color:oklch(62% .15 40); color:oklch(62% .15 40); border-width:2px }
.pipe-name{ font-family:var(--serif); font-size:.94rem; font-weight:600; margin-top:.15rem }
.pipe-wert{ font-family:var(--mono); font-size:.66rem; color:var(--accent) }
.pipe-was{ font-size:.75rem; color:var(--ink-3); line-height:1.35 }
@media(max-width:720px){ ol.pipe-stufen{ grid-template-columns:1fr } .pipe-bahn{ display:none } .pipe-stufe{ flex-direction:row; text-align:left; gap:.6rem } }

/* ===== Protokoll ===== */
.protokoll{ border:1px solid var(--line-soft); border-radius:4px; background:var(--card); overflow:hidden; font-family:var(--mono); font-size:.74rem }
.pr-zeile{ display:grid; grid-template-columns:8.5rem 8rem 11rem 4.5rem 1fr; gap:.5rem; padding:.4rem .7rem;
  border-bottom:1px solid var(--line-soft); align-items:start;
  opacity:0; animation:auf .4s var(--ease) forwards; animation-delay:calc(var(--i)*.05s) }
.pr-zeile:last-child{ border-bottom:0 }
.pr-zeile.blockt{ background:oklch(62% .15 40/.08) }
.pr-ereignis{ color:var(--ink) }
.pr-wirkung{ color:var(--ink-3) }
.pr-zeile.blockt .pr-wirkung{ color:oklch(58% .16 35); font-weight:600 }
.z3 .pr-zeile.blockt .pr-wirkung,.z4 .pr-zeile.blockt .pr-wirkung{ color:oklch(75% .15 35) }
.pr-text{ font-family:var(--sans); color:var(--ink-2) }
@media(max-width:860px){ .pr-zeile{ grid-template-columns:1fr 1fr; } .pr-text{ grid-column:1/-1 } }

/* ===== Analytics ===== */
.analytics{ background:var(--card); border:1px solid var(--line-soft); border-radius:4px; padding:.9rem 1rem }
.an-kopf{ display:flex; justify-content:space-between; align-items:center; margin-bottom:.7rem }
.an-wert{ font-family:var(--serif); font-size:2rem; font-weight:600; line-height:1 }
.an-puls{ display:flex; gap:3px; align-items:flex-end; height:1.6rem }
.an-puls span{ width:4px; border-radius:2px; background:var(--accent); animation:atmen 1.9s ease-in-out infinite }
.an-puls span:nth-child(1){ height:40%; animation-delay:0s } .an-puls span:nth-child(2){ height:75%; animation-delay:.25s } .an-puls span:nth-child(3){ height:55%; animation-delay:.5s }
@keyframes atmen{ 0%,100%{ transform:scaleY(.6); opacity:.55 } 50%{ transform:scaleY(1); opacity:1 } }
.an-zeile{ display:grid; grid-template-columns:minmax(9rem,22rem) 1fr 8.5rem; gap:.6rem; align-items:center; padding:.2rem 0 }
.an-name code{ background:none; padding:0; font-size:.76rem; color:var(--ink-2) }
.an-bar{ display:block; height:7px; border-radius:99px; background:var(--line-soft); overflow:hidden }
.an-bar i{ display:block; height:100%; width:0; border-radius:99px; background:linear-gradient(90deg,var(--accent),oklch(70% .09 200));
  animation:fuellenP .85s var(--ease) forwards; animation-delay:calc(var(--i)*.05s + .1s) }
@keyframes fuellenP{ to{ width:var(--p) } }
.an-zahl{ font-family:var(--mono); font-size:.7rem; color:var(--ink-3); text-align:right }
@media(max-width:720px){ .an-zeile{ grid-template-columns:1fr; gap:.15rem } .an-zahl{ text-align:left } }

/* ===== Chrono-Board ===== */
ol.chrono{ list-style:none; margin:0; padding:0; position:relative }
ol.chrono::before{ content:""; position:absolute; left:4.4rem; top:.3rem; bottom:.3rem; width:1px; background:var(--line-soft) }
.chrono-tag{ margin:.8rem 0 .35rem; padding-left:5.6rem; font-family:var(--mono); font-size:.64rem; letter-spacing:.16em; text-transform:uppercase; color:var(--ink-3) }
.chrono-e{ position:relative; display:grid; grid-template-columns:3.6rem 1.6rem 1fr; align-items:start; gap:.3rem; padding:.16rem 0;
  opacity:0; animation:auf .45s var(--ease) forwards; animation-delay:calc(var(--i)*.035s) }
.chrono-zeit{ font-family:var(--mono); font-size:.7rem; color:var(--ink-3); text-align:right; padding-top:.42rem }
.chrono-punkt{ justify-self:center; width:7px; height:7px; margin-top:.62rem; border-radius:50%; background:var(--accent); box-shadow:0 0 0 3px var(--bg-a) }
.chrono-karte{ background:var(--card); border:1px solid var(--line-soft); border-radius:4px; padding:.42rem .65rem;
  transition:transform .2s var(--ease) }
.chrono-karte:hover{ transform:translateX(3px) }
.chrono-kopf{ display:flex; gap:.4rem; align-items:center; margin-bottom:.1rem }
.chrono-text{ font-size:.85rem; color:var(--ink-2) }
.pill.repo{ background:var(--accent-soft); color:var(--ink-2) }
@media(max-width:640px){ ol.chrono::before{ display:none } .chrono-e{ grid-template-columns:3.4rem 1fr } .chrono-punkt{ display:none } .chrono-tag{ padding-left:0 } }

/* ===== Allgemein ===== */
.chip{ display:inline-flex; align-items:center; gap:.32rem; font-family:var(--mono); font-size:.58rem; letter-spacing:.13em;
  text-transform:uppercase; padding:.18rem .45rem; border:1px solid var(--line); border-radius:99px; white-space:nowrap; color:var(--ink-2) }
.chip i{ width:5px; height:5px; border-radius:50%; background:currentColor }
.chip.s-ok,.chip.s-gezogen{ color:oklch(46% .11 152) }
.chip.s-hinweis{ color:oklch(50% .13 74) }
.chip.s-befund,.chip.s-fehlt,.chip.s-unlesbar{ color:oklch(52% .18 27) }
.z3 .chip.s-ok,.z4 .chip.s-ok,.z3 .chip.s-gezogen,.z4 .chip.s-gezogen{ color:oklch(80% .13 152) }
.z3 .chip.s-hinweis,.z4 .chip.s-hinweis{ color:oklch(84% .13 82) }
.z3 .chip.s-befund,.z4 .chip.s-befund,.z3 .chip.s-fehlt,.z4 .chip.s-fehlt{ color:oklch(74% .15 25) }
.marke{ font-family:var(--mono); font-size:.6rem; letter-spacing:.18em; text-transform:uppercase; color:var(--ink-3) }
.notiz{ margin:.5rem 0 0; font-size:.82rem; color:var(--ink-2) }
.warnzeile{ color:oklch(52% .13 76) }
.leer{ margin:.4rem 0; font-size:.85rem; color:var(--ink-3); font-style:italic }
.gut,.warn{ padding:.7rem .9rem; border-radius:4px; margin:0 0 .85rem; font-size:.86rem }
.gut{ background:oklch(70% .12 152/.13); border:1px solid oklch(60% .12 152/.34) }
.warn{ background:oklch(70% .14 76/.14); border:1px solid oklch(60% .14 76/.4) }
.gut p,.warn p{ margin:.28rem 0 }
.leitgedanke{ margin:0 auto clamp(1.1rem,2.6vw,1.7rem) }
.leitgedanke p{ margin:0; font-family:var(--serif); font-size:1.05rem; line-height:1.6; max-width:45rem; color:var(--ink-2) }
.tab-huelle{ overflow-x:auto; border:1px solid var(--line-soft); border-radius:4px; background:var(--card) }
table{ border-collapse:collapse; width:100%; font-size:.84rem }
th,td{ text-align:left; padding:.4rem .6rem; border-bottom:1px solid var(--line-soft); vertical-align:top }
th{ font-family:var(--mono); font-size:.58rem; letter-spacing:.13em; text-transform:uppercase; color:var(--ink-3); white-space:nowrap }
tr:last-child td{ border-bottom:0 }
pre.befehl{ margin:.5rem 0 0; padding:.45rem .65rem; background:oklch(20% .03 233/.07); border-left:2px solid var(--accent);
  font-family:var(--mono); font-size:.76rem; overflow-x:auto; white-space:pre-wrap; word-break:break-word }
.z3 pre.befehl,.z4 pre.befehl{ background:oklch(95% .01 210/.09) }
pre.befehl span{ color:var(--ink-3); user-select:none }
code{ font-family:var(--mono); font-size:.88em; padding:.05em .3em; background:var(--accent-soft); border-radius:2px }
.regel{ margin:0 auto clamp(1rem,2.4vw,1.6rem); padding:.85rem 1rem; background:var(--card);
  border:1px solid var(--line-soft); border-left:3px solid var(--accent); border-radius:4px }
.regel-kopf{ display:flex; align-items:center; gap:.5rem; flex-wrap:wrap; margin-bottom:.25rem }
.regel-kopf h4{ margin:0; font-family:var(--serif); font-weight:600; font-size:1.04rem }
.quelle{ margin:0 0 .5rem; font-family:var(--mono); font-size:.66rem; color:var(--ink-3) }
ul.fakten{ margin:.35rem 0; padding-left:1.1rem }
ul.fakten li{ margin:.2rem 0; font-size:.85rem; color:var(--ink-2) }
details.gruppe{ background:var(--card); border:1px solid var(--line-soft); border-radius:4px; margin-bottom:.45rem }
details.gruppe summary{ display:flex; align-items:center; gap:.45rem; flex-wrap:wrap; padding:.55rem .8rem; cursor:pointer }
.gruppe-titel{ font-family:var(--serif); font-size:1rem; font-weight:600 }
.gruppe-zahl{ font-family:var(--mono); font-size:.88rem; color:var(--ink-3) }
.pill{ font-family:var(--mono); font-size:.56rem; letter-spacing:.1em; text-transform:uppercase; padding:.14rem .4rem; border-radius:99px }
.pill.eigen{ background:oklch(60% .14 250/.22); color:var(--ink) }
.pill.mit{ background:var(--line-soft); color:var(--ink-3) }
ul.posten{ margin:0; padding:.2rem .8rem .75rem 1.5rem; columns:2; column-gap:1.4rem }
ul.posten li{ margin:.1rem 0; font-size:.79rem; break-inside:avoid; color:var(--ink-3) }
ul.posten li.ist-eigen{ color:var(--ink); font-weight:500 }
.posten-text{ color:var(--ink-3); font-size:.94em }
@media(max-width:640px){ ul.posten{ columns:1 } }

.werft{ background:linear-gradient(180deg,oklch(17% .04 237),oklch(52% .05 222) 38%,oklch(96% .01 208));
  padding:clamp(2.6rem,6vw,4.2rem) 0 clamp(1.6rem,4vw,2.4rem); color:oklch(22% .025 233) }
.werft-inner{ max-width:76rem; margin:0 auto; padding:0 clamp(1rem,3vw,2rem) }
.werft h2{ margin:0 0 .45rem; font-family:var(--serif); font-weight:600; font-size:1.35rem }
.werft p{ margin:.4rem 0; font-size:.85rem; color:oklch(35% .024 230); max-width:47rem }
.werft code{ background:oklch(40% .07 224/.1) }

.werkzeuge{ position:fixed; right:.7rem; bottom:.7rem; z-index:40; display:flex; gap:.35rem }
.werkzeuge input,.werkzeuge button{ font-family:var(--mono); font-size:.7rem; padding:.35rem .6rem;
  border:1px solid var(--line); border-radius:99px; background:var(--card); color:var(--ink); backdrop-filter:blur(6px) }
.werkzeuge input{ width:8.5rem } .werkzeuge button{ cursor:pointer; text-transform:uppercase; letter-spacing:.1em; font-size:.6rem }
.treffer-aus{ display:none !important }

@media(prefers-reduced-motion:reduce){ *{ animation:none !important; transition:none !important }
  .balken i,.an-bar i{ width:var(--w,var(--p)) !important } .stat,.ob-schritt,ol.zutun li,.pipe-stufe,.pr-zeile,.chrono-e{ opacity:1 !important } }
@media print{ html.js .panel{ display:block !important } .messer,.werkzeuge,canvas{ display:none } }
</style>
</head>
<body class="z0">
<script>document.documentElement.className='js';</script>

<header class="kopf">
  <canvas id="surface" aria-hidden="true"></canvas>
  <div class="kopf-inner">
    <p class="sub">Keel · Standalone-Harness</p>
    <h1>Tauchgang</h1>
    <p class="pfad">${esc(daten.wurzel)} · gemessen ${esc(new Date(daten.gemessenAm).toLocaleString("de-DE"))} · Schema ${esc(daten.schema)}</p>
  </div>
</header>

<nav class="messer" role="tablist" aria-label="Tiefe"><div class="messer-inner">${reiter}</div></nav>
<main>${panels}</main>

<footer class="werft">
  <div class="werft-inner">
    <h2>Ehrlich gebaut</h2>
    <p>Diese Seite ist ein <strong>Stand</strong>, keine Steuerung: nichts darauf löst etwas aus. Was zu tun ist,
    steht als Befehl zum Kopieren da — ausgeführt wird er von einem Menschen.</p>
    <p>Jede Zahl ist beim Erzeugen gemessen worden, nicht gepflegt. Wo geschätzt wird (Token), steht der
    Umrechnungsfaktor daneben. Wo eine Quelle fehlt, steht das statt einer Zahl.</p>
    <p>Erzeugt aus <code>zustand/messen.js</code> → <code>zustand/rendern.js</code>. Die Messung kennt kein HTML,
    die Anzeige misst nichts — damit bei <strong>Keel Light</strong> eine andere Anzeige an derselben Messung
    hängen kann. Aufbau und Bildsprache folgen der Keel-Präsentation: der Tauchgang, hier seitwärts gelegt.</p>
  </div>
</footer>

<div class="werkzeuge">
  <input id="filter" type="search" placeholder="filtern…" aria-label="Seite filtern">
  <button id="alle" title="Alle Tiefen untereinander">alle</button>
</div>

<script>
(function(){
  var TIEFEN = ${JSON.stringify(TIEFEN.map((t) => t.id))};
  var reiter = [].slice.call(document.querySelectorAll('.reiter'));
  var panels = [].slice.call(document.querySelectorAll('.panel'));
  var alleAn = false;

  function zeige(id, hash){
    if(TIEFEN.indexOf(id) < 0) id = TIEFEN[0];
    alleAn = false; document.getElementById('alle').textContent = 'alle';
    panels.forEach(function(p){ p.classList.toggle('aktiv', p.dataset.panel === id); });
    reiter.forEach(function(r){
      var an = r.dataset.tiefe === id;
      r.setAttribute('aria-selected', an ? 'true' : 'false');
      r.setAttribute('tabindex', an ? '0' : '-1');
    });
    // Der Rumpf traegt die Zone der aktiven Tiefe: die ganze Seite taucht mit.
    document.body.className = 'z' + TIEFEN.indexOf(id);
    document.documentElement.dataset.tiefe = id;
    if(hash && location.hash !== '#' + id) history.replaceState(null, '', '#' + id);
  }

  document.addEventListener('click', function(e){
    var a = e.target.closest('[data-tiefe]');
    if(!a) return;
    e.preventDefault(); zeige(a.dataset.tiefe, true);
    if(!a.classList.contains('reiter')) window.scrollTo({ top:0, behavior:'smooth' });
  });

  // Pfeiltasten: der Tiefenmesser ist eine Achse -- rechts tiefer, links flacher.
  document.addEventListener('keydown', function(e){
    if(e.target.tagName === 'INPUT') return;
    var i = TIEFEN.indexOf(document.documentElement.dataset.tiefe);
    if(e.key === 'ArrowRight' && i < TIEFEN.length - 1) zeige(TIEFEN[i+1], true);
    if(e.key === 'ArrowLeft'  && i > 0)                 zeige(TIEFEN[i-1], true);
  });

  document.getElementById('alle').addEventListener('click', function(){
    alleAn = !alleAn;
    panels.forEach(function(p){ p.classList.toggle('aktiv', alleAn || p.dataset.panel === document.documentElement.dataset.tiefe); });
    this.textContent = alleAn ? 'eine' : 'alle';
  });

  // Filter greift ueber ALLE Tiefen -- sonst sucht man nur in der, in der man steht.
  document.getElementById('filter').addEventListener('input', function(){
    var q = this.value.toLowerCase().trim();
    if(q) panels.forEach(function(p){ p.classList.add('aktiv'); });
    else  zeige(document.documentElement.dataset.tiefe, false);
    [].forEach.call(document.querySelectorAll('.block, .regel, details.gruppe'), function(el){
      el.classList.toggle('treffer-aus', !!q && el.textContent.toLowerCase().indexOf(q) < 0);
    });
  });

  zeige((location.hash || '').replace('#',''), false);
  window.addEventListener('hashchange', function(){ zeige((location.hash||'').replace('#',''), false); });

  var wenigBewegung = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ===== Punktfeld der Wasseroberflaeche (aus der Keel-Praesentation) =====
  (function(){
    var c = document.getElementById('surface'); if(!c || !c.getContext) return;
    var ctx = c.getContext('2d'), laeuft = false, raf = null, t = 0;
    function groesse(){ var d = Math.min(window.devicePixelRatio||1,2);
      c.width = Math.round(c.clientWidth*d); c.height = Math.round(c.clientHeight*d); ctx.setTransform(d,0,0,d,0,0); }
    function zeichne(){
      var w = c.clientWidth, h = c.clientHeight; ctx.clearRect(0,0,w,h);
      for(var r = 0; r < 24; r++){
        var p = r/23, y0 = 6 + Math.pow(p,1.7)*(h-20), schritt = 11 + p*13, rad = .7 + p*1.8, amp = 3.5 + p*7.5;
        ctx.fillStyle = 'rgba(22, 50, 82,' + (.10 + p*.38).toFixed(3) + ')';
        for(var x = -schritt; x < w+schritt; x += schritt){
          var y = y0 + Math.sin(x*.014 + t*1.05 + r*.42)*amp*.62 + Math.sin(x*.027 - t*.75 + r*.18)*amp*.38;
          ctx.beginPath(); ctx.arc(x,y,rad,0,6.2832); ctx.fill();
        }
      }
    }
    function schleife(){ if(!laeuft) return; t += .016; zeichne(); raf = requestAnimationFrame(schleife); }
    groesse(); zeichne();
    var timer; window.addEventListener('resize', function(){ clearTimeout(timer); timer = setTimeout(function(){ groesse(); zeichne(); }, 120); });
    if(!wenigBewegung && 'IntersectionObserver' in window)
      new IntersectionObserver(function(es){ es.forEach(function(e){
        if(e.isIntersecting){ if(!laeuft){ laeuft = true; raf = requestAnimationFrame(schleife); } }
        else { laeuft = false; if(raf) cancelAnimationFrame(raf); raf = null; } }); }, {threshold:.05}).observe(c);
    else if(!wenigBewegung){ laeuft = true; raf = requestAnimationFrame(schleife); }
  })();

  // ===== In der Tiefe wird das Punktfeld zur Spirale =====
  // Fibonacci-Spirale, pulsende Punkte -- dieselbe Bildsprache, nur tiefer:
  // an der Oberflaeche liegt das Punktfeld in Reihen, unten ordnet es sich zum Wirbel.
  (function(){
    var c = document.querySelector('canvas.spirale'); if(!c || !c.getContext) return;
    var ctx = c.getContext('2d'), laeuft = false, raf = null, t = 0;
    var N = 620, PHI = Math.PI * (3 - Math.sqrt(5));   /* goldener Winkel */
    function groesse(){ var d = Math.min(window.devicePixelRatio||1,2);
      c.width = Math.round(c.clientWidth*d); c.height = Math.round(c.clientHeight*d); ctx.setTransform(d,0,0,d,0,0); }
    function zeichne(){
      var w = c.clientWidth, h = c.clientHeight; ctx.clearRect(0,0,w,h);
      var cx = w*.5, cy = h*.42, R = Math.min(w,h)*.62;
      for(var i = 0; i < N; i++){
        var f = i/N, r = Math.sqrt(f)*R, a = i*PHI + t*.08;
        var x = cx + Math.cos(a)*r, y = cy + Math.sin(a)*r*.62;
        if(x < -20 || x > w+20 || y < -20 || y > h+20) continue;
        var welle = Math.sin(f*13 - t*1.5);
        var rad = .5 + f*1.5 + welle*.5;
        var alpha = (.05 + f*.20) * (.55 + welle*.45);
        if(alpha <= 0) continue;
        ctx.fillStyle = 'rgba(168, 208, 236,' + alpha.toFixed(3) + ')';
        ctx.beginPath(); ctx.arc(x, y, Math.max(.2, rad), 0, 6.2832); ctx.fill();
      }
    }
    function schleife(){ if(!laeuft) return; t += .016; zeichne(); raf = requestAnimationFrame(schleife); }
    groesse(); zeichne();
    var timer; window.addEventListener('resize', function(){ clearTimeout(timer); timer = setTimeout(function(){ groesse(); zeichne(); }, 150); });
    // Laeuft nur, solange die Tiefe "Vier Knoten" sichtbar ist -- sonst nichts.
    setInterval(function(){
      var sichtbar = document.documentElement.dataset.tiefe === 'articles' && !wenigBewegung;
      if(sichtbar && !laeuft){ groesse(); laeuft = true; raf = requestAnimationFrame(schleife); }
      if(!sichtbar && laeuft){ laeuft = false; if(raf) cancelAnimationFrame(raf); raf = null; }
    }, 400);
  })();
})();
</script>
</body>
</html>`;
}

module.exports = { renderHTML, esc, md, TIEFEN };
