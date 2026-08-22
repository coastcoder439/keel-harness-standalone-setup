// Zustandsseite im Keel-Design: Seitenleiste, klare Bereiche, Details auf Klick.
//
// WARUM ES DIESE ZWEITE ANZEIGE GIBT
// Die erste Fassung (rendern.js) legte alles untereinander auf eine lange Seite.
// Der Auftraggeber dazu (22.08.2026): unuebersichtlich, Abkuerzungen, Info-Flut.
// Gewuenscht: das Aussehen von Keel (Seitenleiste, ruhige Flaechen), klare
// Strukturen, und Tiefe erst auf Klick statt alles sofort.
//
// Die Messung wird dafuer NICHT angefasst -- sie kennt keine Darstellung. Diese
// Datei bekommt dieselben Daten wie rendern.js und macht etwas anderes daraus.
// Genau dafuer war der Schnitt "messen -> Daten -> rendern" gedacht.
//
// Palette: uebernommen aus user-projects/keel-light/ui/src/keel-light/keel-theme.css
// (oklch, Blauton 205-238, hell und dunkel). Umgeschaltet ueber prefers-color-scheme.
//
// AUFRUF ueber zustand.js; nach aussen gibt es nur renderHTML(messung, regelDaten).

// --- kleine Helfer ---------------------------------------------------------

const esc = (s) =>
  String(s == null ? "" : s)
    .split("&").join("&amp;")
    .split("<").join("&lt;")
    .split(">").join("&gt;")
    .split('"').join("&quot;");

// Markdown-Krumen, die in den Messtexten vorkommen: Code in Rueckticks und **fett**.
function md(s) {
  let t = esc(s);
  t = t.replace(/`([^`]+)`/g, "<code>$1</code>");
  t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  return t;
}

const zahl = (n) => (typeof n === "number" ? n.toLocaleString("de-DE") : String(n == null ? "—" : n));

// Statuswoerter ausgeschrieben -- keine Abkuerzungen, keine Fachbegriffe.
const STATUS = {
  ok: { wort: "In Ordnung", klasse: "gut" },
  hinweis: { wort: "Hinweis", klasse: "warn" },
  fehlt: { wort: "Nicht vorhanden", klasse: "warn" },
  befund: { wort: "Befund", klasse: "schlecht" },
  unlesbar: { wort: "Nicht messbar", klasse: "schlecht" },
  gezogen: { wort: "Gelesen", klasse: "gut" },
};
const st = (s) => STATUS[s] || { wort: s || "unbekannt", klasse: "neutral" };

const punkt = (s) => `<span class="punkt ${st(s).klasse}" title="${esc(st(s).wort)}"></span>`;
const marke = (s) => `<span class="marke ${st(s).klasse}">${esc(st(s).wort)}</span>`;

function kennzahl({ titel, wert, unter, status }) {
  return `<div class="kennzahl">
    <div class="kennzahl-kopf">${esc(titel)}${status ? punkt(status) : ""}</div>
    <div class="kennzahl-wert">${esc(wert)}</div>
    ${unter ? `<div class="kennzahl-unter">${md(unter)}</div>` : ""}
  </div>`;
}

function aufklapp(titel, rechts, inhalt, offen) {
  return `<details class="klapp"${offen ? " open" : ""}>
    <summary><span class="klapp-titel">${esc(titel)}</span>${rechts || ""}<span class="klapp-pfeil"></span></summary>
    <div class="klapp-inhalt">${inhalt}</div>
  </details>`;
}

const leer = (text) => `<p class="leer">${md(text)}</p>`;

const BEREICHS_NAMEN = {
  kontext: { titel: "Was jede Sitzung mitliest", gut: "Der Grundstock wird geladen." },
  bestand: { titel: "Fähigkeiten und Befehle", gut: "Alles aufgezählt." },
  waechter: { titel: "Wächter", gut: "Alle verdrahtet und gemessen." },
  sicherung: { titel: "Sicherung", gut: "Alle Verzeichnisse gesichert." },
  pruefer: { titel: "Prüfer", gut: "Nichts zu beanstanden." },
  rollen: { titel: "Sitzungs-Rollen", gut: "Rollen geladen." },
  readiness: { titel: "Betriebsbericht", gut: "Nichts zu messen." },
  verlauf: { titel: "Letzte Änderungen", gut: "Verlauf gelesen." },
};

const UNTERTITEL = {
  ueberblick: "Wie es um diesen Harness steht — alles Wichtige auf einer Fläche.",
  zutun: "Was offen ist. Jede Karte nennt den Grund und den passenden Befehl.",
  werkzeuge: "Womit hier gearbeitet wird: Kommandozeilen-Programme, MCP-Server, Schnittstellen und Zugänge.",
  bestand: "Was der Harness kann und was auf Zuruf bereitliegt.",
  waechter: "Prüfungen, die bei jedem Befehl von selbst mitlaufen.",
  regeln: "Regeln, die in jeder Sitzung geladen werden — ohne dass jemand sie aufruft.",
  sicherung: "Wo Arbeit liegt und ob sie auch außerhalb dieses Rechners existiert.",
  rollen: "Wer arbeitet woran, wenn mehrere Sitzungen gleichzeitig laufen.",
  verlauf: "Die letzten Änderungen über alle Verzeichnisse hinweg.",
};

// --- die einzelnen Flaechen ------------------------------------------------

function ueberblick(m, regeln) {
  const b = m.bereiche;
  const offen = (m.zuTun || []).length;
  const w = b.waechter || {};
  const gelesen = (regeln.liste || []).filter((r) => r.status === "gezogen").length;
  const repos = b.sicherung?.repos || [];
  const unsicher = repos.filter((r) => r.status !== "ok").length;
  const gruppen = b.bestand?.gruppen || [];
  const anzahlVon = (id) => gruppen.find((g) => g.id === id)?.anzahl || 0;

  const lage = st(m.gesamtstatus);
  return `
  <div class="lage ${lage.klasse}">
    <div class="lage-wort">${esc(lage.wort)}</div>
    <div class="lage-text">${
      offen === 0
        ? "Alle Bereiche sind gemessen, nichts ist offen."
        : `${offen === 1 ? "Ein Punkt ist offen" : offen + " Punkte sind offen"} — sie stehen unter „Zu tun&#8220;.`
    }</div>
  </div>

  <div class="kennzahlen">
    ${kennzahl({
      titel: "Wächter aktiv",
      wert: zahl(w.zaehlung?.gesamt || 0),
      unter: `davon **${zahl(w.zaehlung?.blockend || 0)}** können einen Befehl stoppen`,
      status: w.status,
    })}
    ${kennzahl({ titel: "Fähigkeiten", wert: zahl(anzahlVon("faehigkeiten")), unter: "stehen zum Abruf bereit" })}
    ${kennzahl({ titel: "Befehle", wert: zahl(anzahlVon("befehle")), unter: "mit Schrägstrich aufrufbar" })}
    ${kennzahl({ titel: "Dauer-Regeln", wert: zahl(gelesen), unter: "werden in jeder Sitzung geladen" })}
    ${kennzahl({
      titel: "Verzeichnisse gesichert",
      wert: `${zahl(repos.length - unsicher)} von ${zahl(repos.length)}`,
      unter: unsicher ? "eines hat ungesicherte Arbeit" : "alles gesichert",
      status: b.sicherung?.status,
    })}
    ${kennzahl({
      titel: "Aufwand je Sitzung",
      wert: zahl(b.kontext?.tokenSchaetzungJeSitzung || 0),
      unter: "geschätzte Wortbausteine, die jede Sitzung mitliest",
      status: b.kontext?.status,
    })}
  </div>

  <h3 class="unter-titel">Die Bereiche auf einen Blick</h3>
  <div class="bereichs-gitter">
    ${Object.entries(b)
      .map(([id, v]) => {
        const n = BEREICHS_NAMEN[id] || { titel: id, gut: "gemessen" };
        return `<div class="bereichs-kachel">
          <div class="bk-kopf">${punkt(v.status)}<span>${esc(n.titel)}</span></div>
          <div class="bk-text">${md(v.grund || v.notiz || n.gut)}</div>
        </div>`;
      })
      .join("")}
  </div>`;
}

function zuTunFlaeche(m) {
  const liste = m.zuTun || [];
  if (!liste.length) return leer("Nichts offen. Alle Bereiche sind gemessen und in Ordnung.");
  return `<div class="tun-spalten">${liste
    .map(
      (t) => `<article class="tun-karte ${st(t.status).klasse}">
      <header>${marke(t.status)}<span class="tun-bereich">${esc(BEREICHS_NAMEN[t.bereich]?.titel || t.bereich)}</span></header>
      <p class="tun-text">${md(t.text)}</p>
      ${t.grund ? `<p class="tun-grund">${md(t.grund)}</p>` : ""}
      ${t.befehl ? `<pre class="befehl"><code>${esc(t.befehl)}</code></pre>` : ""}
    </article>`
    )
    .join("")}</div>`;
}

function werkzeugFlaeche(m) {
  const g = (m.bereiche.bestand?.gruppen || []).find((x) => x.id === "werkzeuge");
  if (!g) return leer("Die Werkzeug-Landschaft wird von dieser Fassung noch nicht gemessen.");
  if (!g.posten.length) {
    return `${leer(g.notiz || "Noch nichts erhoben.")}
      <div class="hinweis-box">
        <strong>So wird sie gefüllt:</strong> Das Onboarding fragt in Schritt 3 „Womit arbeitest du?&#8220; nach den
        Programmen und Diensten, mit denen du arbeitest, prüft selbst nach, was davon vorhanden ist,
        und trägt das Ergebnis ein. Zugänge stehen dort nur mit Namen, nie mit Wert.
        <pre class="befehl"><code>/onboarding</code></pre>
      </div>`;
  }
  const rubriken = {};
  for (const p of g.posten) {
    const teile = String(p.name).split(" · ");
    const rubrik = teile[1] || "Sonstige";
    (rubriken[rubrik] = rubriken[rubrik] || []).push({ name: teile[0], beschreibung: p.beschreibung });
  }
  return `<div class="rubrik-gitter">${Object.entries(rubriken)
    .map(
      ([r, eintraege]) => `<section class="rubrik">
      <h3>${esc(r)}<span class="rubrik-zahl">${zahl(eintraege.length)}</span></h3>
      <ul class="liste">${eintraege
        .map(
          (e) =>
            `<li><span class="li-name">${esc(e.name)}</span>${e.beschreibung ? `<span class="li-text">${md(e.beschreibung)}</span>` : ""}</li>`
        )
        .join("")}</ul>
    </section>`
    )
    .join("")}</div>`;
}

function bestandFlaeche(m) {
  const gruppen = (m.bereiche.bestand?.gruppen || []).filter((g) => g.id !== "werkzeuge");
  const gefuellt = gruppen.filter((g) => g.anzahl > 0);
  const leere = gruppen.filter((g) => g.anzahl === 0);
  const eintrag = (p) =>
    `<li><span class="li-name">${esc(p.name)}</span>${p.beschreibung ? `<span class="li-text">${md(p.beschreibung)}</span>` : ""}</li>`;

  return `
    ${gefuellt
      .map((g) =>
        aufklapp(
          g.titel,
          `<span class="klapp-zahl">${zahl(g.anzahl)}</span>`,
          `${g.notiz ? `<p class="notiz">${md(g.notiz)}</p>` : ""}
           <ul class="liste">${g.posten.map(eintrag).join("")}</ul>`,
          g.id === "faehigkeiten"
        )
      )
      .join("")}
    ${
      leere.length
        ? aufklapp(
            "In diesem Harness nicht belegt",
            `<span class="klapp-zahl">${zahl(leere.length)}</span>`,
            `<p class="notiz">Diese Bereiche sind leer. Bei einem schlanken Harness ist das der Normalfall und kein Mangel —
             bei den MCP-Servern ist es sogar das Ziel: erst Kommandozeile, dann MCP, dann Browser.</p>
             <ul class="liste">${leere
               .map(
                 (g) =>
                   `<li><span class="li-name">${esc(g.titel)}</span><span class="li-text">${md(g.notiz || g.grund || "keine Einträge")}</span></li>`
               )
               .join("")}</ul>`
          )
        : ""
    }`;
}

function waechterFlaeche(m) {
  const e = m.bereiche.waechter?.eintraege || [];
  if (!e.length) return leer("Keine Wächter verdrahtet.");
  const zeile = (x) => `<li>
      <span class="li-name">${esc(x.skript || x.art)}</span>
      <span class="li-text">${esc(x.ansage || "")}</span>
      <span class="li-tag">läuft bei: ${esc(x.ereignis)}</span>
    </li>`;
  const blockend = e.filter((x) => x.blockt);
  const ansagend = e.filter((x) => !x.blockt);
  return `
    <p class="notiz">Wächter laufen von selbst — niemand ruft sie auf. Manche <strong>stoppen</strong> einen Befehl,
    bevor er ausgeführt wird; die übrigen <strong>melden</strong> nur und halten nichts auf.</p>
    <div class="rubrik-gitter">
      <section class="rubrik">
        <h3>Können einen Befehl stoppen<span class="rubrik-zahl">${zahl(blockend.length)}</span></h3>
        <ul class="liste">${blockend.map(zeile).join("") || "<li><span class='li-text'>—</span></li>"}</ul>
      </section>
      <section class="rubrik">
        <h3>Melden nur<span class="rubrik-zahl">${zahl(ansagend.length)}</span></h3>
        <ul class="liste">${ansagend.map(zeile).join("") || "<li><span class='li-text'>—</span></li>"}</ul>
      </section>
    </div>`;
}

function regelFlaeche(regeln) {
  const liste = regeln.liste || [];
  const da = liste.filter((r) => r.status === "gezogen");
  const nicht = liste.filter((r) => r.status !== "gezogen");

  const inhalt = (r) => {
    if (r.eintraege) {
      return `<ul class="liste">${r.eintraege
        .map(
          (e) =>
            `<li><span class="li-name">${esc(e.titel || e.datei)}</span><span class="li-text">${esc((e.kern || []).join(" · "))}</span></li>`
        )
        .join("")}</ul>${r.abgrenzung ? `<p class="notiz">${md(r.abgrenzung)}</p>` : ""}`;
    }
    if (r.befehle) {
      return `<ul class="liste">${r.befehle
        .map((b) => `<li><span class="li-name">${esc(b.zweck)}</span><pre class="befehl"><code>${esc(b.code)}</code></pre></li>`)
        .join("")}</ul>`;
    }
    if (r.saetze) {
      return `<ul class="liste">${r.saetze
        .map((s) => `<li><span class="li-text">${md(typeof s === "string" ? s : JSON.stringify(s))}</span></li>`)
        .join("")}</ul>`;
    }
    if (r.reihen) {
      return `<ul class="liste">${r.reihen
        .map((z) => `<li><span class="li-text">${esc(Array.isArray(z) ? z.join(" · ") : String(z))}</span></li>`)
        .join("")}</ul>`;
    }
    return `<p class="notiz">${md(r.abgrenzung || r.grundsatz?.text || "—")}</p>`;
  };

  return `
    ${da.map((r) => aufklapp(r.titel, `<span class="klapp-quelle">${esc(r.quelle?.datei || "")}</span>`, inhalt(r))).join("")}
    ${
      nicht.length
        ? aufklapp(
            "Gehört nicht zu diesem Harness",
            `<span class="klapp-zahl">${zahl(nicht.length)}</span>`,
            `<p class="notiz">Diese Regeln stammen aus der Ursprungs-Werkbank und werden hier nicht mitgeliefert.
             Das ist so gewollt — kein Fehler.</p>
             <ul class="liste">${nicht
               .map((r) => `<li><span class="li-name">${esc(r.titel)}</span><span class="li-text">${md(r.grund || "")}</span></li>`)
               .join("")}</ul>`
          )
        : ""
    }`;
}

function sicherungFlaeche(m) {
  const repos = m.bereiche.sicherung?.repos || [];
  if (!repos.length) return leer("Keine Verzeichnisse gefunden.");
  const karte = (r) => `<article class="repo-karte">
      <header>${punkt(r.status)}<span class="repo-name">${esc(r.name)}</span></header>
      <dl>
        <dt>Stand</dt><dd>${esc(r.sync || "—")}</dd>
        <dt>Auf GitHub</dt><dd>${esc(r.github || "kein Fernziel eingerichtet")}</dd>
        ${r.ungesichert ? `<dt>Ungesichert</dt><dd>${zahl(r.ungesichert)} Datei(en)</dd>` : ""}
      </dl>
    </article>`;
  const offen = repos.filter((r) => r.status !== "ok");
  const gut = repos.filter((r) => r.status === "ok");
  return `
    ${
      offen.length
        ? `<h3 class="unter-titel">Braucht Aufmerksamkeit</h3><div class="repo-gitter">${offen.map(karte).join("")}</div>`
        : leer("Alle Verzeichnisse sind gesichert und mit GitHub synchron.")
    }
    ${
      gut.length
        ? aufklapp("Gesichert und synchron", `<span class="klapp-zahl">${zahl(gut.length)}</span>`, `<div class="repo-gitter">${gut.map(karte).join("")}</div>`)
        : ""
    }`;
}

function rollenFlaeche(m) {
  const r = m.bereiche.rollen || {};
  if (!(r.rollen || []).length) {
    return `${leer(r.grund || "Keine Rollen-Tabelle vorhanden.")}
      <div class="hinweis-box">
        <strong>Wofür das gut ist:</strong> Laufen mehrere Sitzungen gleichzeitig in diesem Ordner, hält eine
        Tabelle fest, wer woran arbeitet — jede Sitzung liest sie beim Start und weiß dadurch von den anderen.
        Im Alleinbetrieb wird sie nicht gebraucht; jede Zeile darin kostet in jeder Sitzung Platz.
        <pre class="befehl"><code>docs/08-sessions-rollen.md</code></pre>
      </div>`;
  }
  return `<ul class="liste">${r.rollen
    .map((x) => `<li><span class="li-name">${esc(x.titel || x.name)}</span><span class="li-text">${esc(x.zweck || "")}</span></li>`)
    .join("")}</ul>`;
}

function verlaufFlaeche(m) {
  const e = m.bereiche.verlauf?.eintraege || [];
  if (!e.length) return leer("Keine Einträge gefunden.");
  return `<ul class="verlauf">${e
    .slice(0, 25)
    .map(
      (x) => `<li>
      <span class="v-datum">${esc(String(x.datum || "").slice(0, 10))}</span>
      <span class="v-betreff">${esc(x.betreff)}</span>
      <span class="v-repo">${esc(x.repo)}</span>
    </li>`
    )
    .join("")}</ul>`;
}

// --- die Seite --------------------------------------------------------------

function renderHTML(m, regelDaten) {
  const regeln = regelDaten || { liste: [] };
  const b = m.bereiche;
  const offen = (m.zuTun || []).length;

  const flaechen = [
    { id: "ueberblick", titel: "Überblick", status: m.gesamtstatus, html: ueberblick(m, regeln) },
    { id: "zutun", titel: "Zu tun", status: offen ? "hinweis" : "ok", anzahl: offen, html: zuTunFlaeche(m) },
    { id: "werkzeuge", titel: "Werkzeug-Landschaft", status: "ok", html: werkzeugFlaeche(m) },
    { id: "bestand", titel: "Fähigkeiten und Befehle", status: b.bestand?.status, html: bestandFlaeche(m) },
    { id: "waechter", titel: "Wächter", status: b.waechter?.status, html: waechterFlaeche(m) },
    { id: "regeln", titel: "Dauer-Regeln", status: regeln.unlesbar ? "hinweis" : "ok", html: regelFlaeche(regeln) },
    { id: "sicherung", titel: "Sicherung", status: b.sicherung?.status, html: sicherungFlaeche(m) },
    { id: "rollen", titel: "Sitzungs-Rollen", status: b.rollen?.status, html: rollenFlaeche(m) },
    { id: "verlauf", titel: "Letzte Änderungen", status: b.verlauf?.status, html: verlaufFlaeche(m) },
  ];

  const gemessen = new Date(m.gemessenAm).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });
  const ordner = String(m.wurzel).split(/[/\\]/).filter(Boolean).pop();

  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Harness-Zustand — ${esc(ordner)}</title>
<style>
:root{
  --grund: oklch(0.978 0.007 214); --schrift: oklch(0.22 0.025 233);
  --flaeche: oklch(0.99 0.004 210); --gedaempft: oklch(0.935 0.018 205);
  --gedaempft-schrift: oklch(0.47 0.022 228); --akzent: oklch(0.4 0.07 224);
  --akzent-schrift: oklch(0.985 0.004 210); --rand: oklch(0.28 0.03 230 / 0.22);
  --leiste: oklch(0.976 0.007 210); --leiste-schwebe: oklch(0.92 0.028 212);
  --gut: oklch(0.58 0.09 165); --warn: oklch(0.65 0.13 70); --schlecht: oklch(0.55 0.17 25);
  --radius: 0.5rem;
  --schriftart: "InterVariable","Inter",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
  --mono: ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;
}
@media (prefers-color-scheme: dark){:root{
  --grund: oklch(0.16 0.038 238); --schrift: oklch(0.94 0.012 210);
  --flaeche: oklch(0.26 0.045 233); --gedaempft: oklch(0.275 0.058 232);
  --gedaempft-schrift: oklch(0.7 0.02 218); --akzent: oklch(0.78 0.075 205);
  --akzent-schrift: oklch(0.16 0.038 238); --rand: oklch(0.92 0.02 210 / 0.18);
  --leiste: oklch(0.19 0.04 236); --leiste-schwebe: oklch(0.275 0.058 232);
  --gut: oklch(0.75 0.1 165); --warn: oklch(0.8 0.12 80); --schlecht: oklch(0.7 0.15 25);
}}
*{box-sizing:border-box}
body{margin:0;background:var(--grund);color:var(--schrift);font-family:var(--schriftart);
  font-size:15px;line-height:1.55;-webkit-font-smoothing:antialiased}
.rahmen{display:flex;min-height:100vh}

/* Seitenleiste */
.leiste{width:252px;flex:0 0 252px;background:var(--leiste);border-right:1px solid var(--rand);
  padding:22px 14px;position:sticky;top:0;height:100vh;overflow-y:auto}
.marke-kopf{padding:0 10px 18px;border-bottom:1px solid var(--rand);margin-bottom:14px}
.marke-kopf h1{font-size:15px;margin:0 0 3px;letter-spacing:-0.01em}
.marke-kopf p{margin:0;font-size:12px;color:var(--gedaempft-schrift);font-family:var(--mono);
  overflow:hidden;text-overflow:ellipsis}
.nav{display:flex;flex-direction:column;gap:2px}
.nav button{display:flex;align-items:center;gap:9px;width:100%;text-align:left;border:0;
  background:transparent;color:var(--schrift);font:inherit;font-size:14px;padding:9px 10px;
  border-radius:var(--radius);cursor:pointer;transition:background .12s}
.nav button:hover{background:var(--leiste-schwebe)}
.nav button[aria-selected="true"]{background:var(--akzent);color:var(--akzent-schrift);font-weight:550}
.nav-zahl{margin-left:auto;background:var(--schlecht);color:#fff;font-size:11px;font-weight:600;
  min-width:19px;height:19px;border-radius:10px;display:grid;place-items:center;padding:0 5px}
.leiste-fuss{margin-top:18px;padding:12px 10px 0;border-top:1px solid var(--rand);
  font-size:11.5px;color:var(--gedaempft-schrift);line-height:1.55}

/* Hauptflaeche */
.haupt{flex:1;padding:30px 38px 60px;max-width:1100px}
.flaeche{display:none}
.flaeche.aktiv{display:block;animation:auf .16s ease}
@keyframes auf{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}
.flaeche > h2{font-size:24px;margin:0 0 4px;letter-spacing:-0.02em}
.flaeche > .unter{margin:0 0 24px;color:var(--gedaempft-schrift);font-size:14px}

/* Bausteine */
.punkt{width:8px;height:8px;border-radius:50%;flex:0 0 8px;display:inline-block;
  background:var(--gedaempft-schrift)}
.punkt.gut{background:var(--gut)} .punkt.warn{background:var(--warn)} .punkt.schlecht{background:var(--schlecht)}
.marke{display:inline-block;font-size:11.5px;font-weight:600;padding:2px 8px;border-radius:99px;
  background:var(--gedaempft);color:var(--gedaempft-schrift)}
.marke.gut{background:color-mix(in oklab,var(--gut) 18%,transparent);color:var(--gut)}
.marke.warn{background:color-mix(in oklab,var(--warn) 20%,transparent);color:var(--warn)}
.marke.schlecht{background:color-mix(in oklab,var(--schlecht) 18%,transparent);color:var(--schlecht)}

.lage{border:1px solid var(--rand);border-left:4px solid var(--gedaempft-schrift);
  background:var(--flaeche);border-radius:var(--radius);padding:18px 20px;margin-bottom:22px}
.lage.gut{border-left-color:var(--gut)} .lage.warn{border-left-color:var(--warn)}
.lage.schlecht{border-left-color:var(--schlecht)}
.lage-wort{font-size:19px;font-weight:600;letter-spacing:-0.01em}
.lage-text{color:var(--gedaempft-schrift);font-size:14px;margin-top:2px}

.kennzahlen{display:grid;grid-template-columns:repeat(auto-fill,minmax(212px,1fr));gap:12px;margin-bottom:8px}
.kennzahl{background:var(--flaeche);border:1px solid var(--rand);border-radius:var(--radius);padding:14px 16px}
.kennzahl-kopf{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--gedaempft-schrift);
  text-transform:uppercase;letter-spacing:.04em;font-weight:600}
.kennzahl-wert{font-size:27px;font-weight:600;letter-spacing:-0.02em;margin:5px 0 2px}
.kennzahl-unter{font-size:12.5px;color:var(--gedaempft-schrift)}

.unter-titel{font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:var(--gedaempft-schrift);
  margin:26px 0 12px;font-weight:600}
.bereichs-gitter{display:grid;grid-template-columns:repeat(auto-fill,minmax(262px,1fr));gap:10px}
.bereichs-kachel{background:var(--flaeche);border:1px solid var(--rand);border-radius:var(--radius);padding:13px 15px}
.bk-kopf{display:flex;align-items:center;gap:8px;font-weight:600;font-size:14px;margin-bottom:3px}
.bk-text{font-size:13px;color:var(--gedaempft-schrift)}

.tun-spalten{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:12px}
.tun-karte{background:var(--flaeche);border:1px solid var(--rand);border-top:3px solid var(--warn);
  border-radius:var(--radius);padding:15px 17px}
.tun-karte.schlecht{border-top-color:var(--schlecht)} .tun-karte.gut{border-top-color:var(--gut)}
.tun-karte header{display:flex;align-items:center;gap:9px;margin-bottom:9px}
.tun-bereich{font-size:12.5px;color:var(--gedaempft-schrift);font-weight:600}
.tun-text{margin:0 0 6px;font-weight:500}
.tun-grund{margin:0 0 4px;font-size:13px;color:var(--gedaempft-schrift)}

.klapp{background:var(--flaeche);border:1px solid var(--rand);border-radius:var(--radius);margin-bottom:9px}
.klapp summary{display:flex;align-items:center;gap:11px;padding:13px 16px;cursor:pointer;
  list-style:none;font-weight:550}
.klapp summary::-webkit-details-marker{display:none}
.klapp summary:hover{background:var(--gedaempft);border-radius:var(--radius)}
.klapp-titel{flex:1}
.klapp-zahl{background:var(--gedaempft);color:var(--gedaempft-schrift);font-size:12px;font-weight:600;
  padding:1px 9px;border-radius:99px}
.klapp-quelle{font-family:var(--mono);font-size:11.5px;color:var(--gedaempft-schrift)}
.klapp-pfeil{width:7px;height:7px;border-right:2px solid var(--gedaempft-schrift);
  border-bottom:2px solid var(--gedaempft-schrift);transform:rotate(45deg);transition:transform .15s;
  margin-left:4px;flex:0 0 7px}
.klapp[open] .klapp-pfeil{transform:rotate(225deg)}
.klapp-inhalt{padding:13px 16px 15px;border-top:1px solid var(--rand)}

.liste{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.liste li{display:flex;flex-direction:column;gap:2px;padding:9px 11px;background:var(--grund);
  border:1px solid var(--rand);border-radius:calc(var(--radius) * 0.7)}
.li-name{font-weight:600;font-size:13.5px}
.li-text{font-size:12.5px;color:var(--gedaempft-schrift)}
.li-tag{font-size:11px;color:var(--gedaempft-schrift);font-family:var(--mono);margin-top:2px}

.rubrik-gitter{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px}
.rubrik{background:var(--flaeche);border:1px solid var(--rand);border-radius:var(--radius);padding:15px 17px}
.rubrik h3{display:flex;align-items:center;gap:9px;margin:0 0 11px;font-size:14px}
.rubrik-zahl{background:var(--gedaempft);color:var(--gedaempft-schrift);font-size:11.5px;
  font-weight:600;padding:1px 8px;border-radius:99px}

.repo-gitter{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:11px}
.repo-karte{background:var(--flaeche);border:1px solid var(--rand);border-radius:var(--radius);padding:13px 15px}
.repo-karte header{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.repo-name{font-weight:600;font-size:14px;word-break:break-all}
.repo-karte dl{display:grid;grid-template-columns:auto 1fr;gap:3px 11px;margin:0;font-size:12.5px}
.repo-karte dt{color:var(--gedaempft-schrift)} .repo-karte dd{margin:0}

.verlauf{list-style:none;margin:0;padding:0}
.verlauf li{display:grid;grid-template-columns:96px 1fr auto;gap:14px;align-items:baseline;
  padding:9px 2px;border-bottom:1px solid var(--rand)}
.v-datum{font-family:var(--mono);font-size:12px;color:var(--gedaempft-schrift)}
.v-betreff{font-size:13.5px}
.v-repo{font-size:11.5px;color:var(--gedaempft-schrift);font-family:var(--mono)}

.befehl{background:var(--gedaempft);border-radius:calc(var(--radius) * 0.7);padding:9px 12px;
  overflow-x:auto;margin:8px 0 0}
.befehl code{font-family:var(--mono);font-size:12.5px;background:none;padding:0}
code{font-family:var(--mono);font-size:.92em;background:var(--gedaempft);padding:1px 5px;border-radius:4px}
.notiz{font-size:13px;color:var(--gedaempft-schrift);margin:0 0 11px}
.leer{color:var(--gedaempft-schrift);font-size:14px;padding:10px 0 16px;margin:0}
.hinweis-box{background:var(--flaeche);border:1px solid var(--rand);border-left:3px solid var(--akzent);
  border-radius:var(--radius);padding:14px 17px;font-size:13.5px}

@media (max-width:880px){
  .rahmen{flex-direction:column}
  .leiste{width:100%;flex:none;height:auto;position:static;padding:16px}
  .nav{flex-direction:row;flex-wrap:wrap}
  .nav button{width:auto}
  .haupt{padding:22px 18px 50px}
  .verlauf li{grid-template-columns:1fr;gap:2px}
}
</style>
</head>
<body>
<div class="rahmen">
  <aside class="leiste">
    <div class="marke-kopf">
      <h1>Harness-Zustand</h1>
      <p>${esc(ordner)}</p>
    </div>
    <nav class="nav" role="tablist">
      ${flaechen
        .map(
          (f, i) =>
            `<button role="tab" aria-selected="${i === 0 ? "true" : "false"}" data-ziel="${f.id}">
              ${punkt(f.status)}<span>${esc(f.titel)}</span>
              ${f.anzahl ? `<span class="nav-zahl">${zahl(f.anzahl)}</span>` : ""}
            </button>`
        )
        .join("")}
    </nav>
    <div class="leiste-fuss">
      Gemessen am ${esc(gemessen)}.<br><br>
      Diese Seite ist eine Momentaufnahme, kein Live-Blick. Neu erzeugen mit:
      <code>node zustand/zustand.js</code>
    </div>
  </aside>
  <main class="haupt">
    ${flaechen
      .map(
        (f, i) => `<section class="flaeche${i === 0 ? " aktiv" : ""}" id="f-${f.id}">
        <h2>${esc(f.titel)}</h2>
        <p class="unter">${esc(UNTERTITEL[f.id] || "")}</p>
        ${f.html}
      </section>`
      )
      .join("")}
  </main>
</div>
<script>
document.querySelectorAll(".nav button").forEach(function (b) {
  b.addEventListener("click", function () {
    document.querySelectorAll(".nav button").forEach(function (x) { x.setAttribute("aria-selected", "false"); });
    b.setAttribute("aria-selected", "true");
    document.querySelectorAll(".flaeche").forEach(function (s) { s.classList.remove("aktiv"); });
    var ziel = document.getElementById("f-" + b.dataset.ziel);
    if (ziel) ziel.classList.add("aktiv");
    window.scrollTo(0, 0);
  });
});
</script>
</body>
</html>`;
}

module.exports = { renderHTML };
