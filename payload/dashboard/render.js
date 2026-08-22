// Die Dashboard als Bedienpult -- im Aussehen von Keel Light.
//
// WAS DIESE DATEI IST
// Sie bekommt die Messdaten und macht daraus EINE statische HTML-Datei: eigenes CSS,
// eingebettete Daten, schlichtes JavaScript. Kein Bauschritt, keine Bibliothek, kein
// Netz. Doppelklick genuegt.
//
// WARUM SIE SO AUSSIEHT
// Die Masse stammen aus der echten Oberflaeche (keel-showcase), nicht aus dem Gefuehl:
// Seitenleiste 240px mit DEMSELBEN Hintergrund wie die Hauptflaeche, getrennt allein
// durch einen Haarstrich; Navigationspille 6/8px Innenabstand bei 8px Radius; die
// Symbol-Achse bei 28px; Kopfzeilen 48px ohne Trennlinie; Gruppen-Ueberschriften in
// Maschinenschrift, Versalien, 0.1em gesperrt. Die Palette ist woertlich aus
// keel-theme.css uebernommen (oklch, Blauton 205-238), hell und dunkel.
//
// WAS SIE LEISTEN MUSS -- und woran die Vorfassung scheiterte
// Sie war ein Lesedokument: keine Tiefe, keine Ansichten, keine Bedienung. Diese
// Fassung traegt EINEN flachen Posten-Index; alle Ansichten, die Suche, die Filter,
// die Sortierung und die Einzelansicht arbeiten auf derselben Liste. Das ist der
// Grund, warum es echte Blickwinkel auf dieselben Daten gibt statt sieben Seiten.
//
// EINE EHRLICHKEITS-REGEL, die das Aussehen bestimmt: Posten OHNE gemessenen Zustand
// bekommen keinen abgeleiteten. Sie stehen im Brett in einer eigenen Spalte
// "ohne gemessenen Zustand". Ein erfundener Zustand, der aussieht wie ein gemessener,
// waere schlimmer als eine Luecke -- man glaubt ihm.
//
// AUFRUF ueber index.js; nach aussen gibt es nur renderHTML(messung, regelDaten).

const esc = (s) =>
  String(s == null ? "" : s)
    .split("&").join("&amp;")
    .split("<").join("&lt;")
    .split(">").join("&gt;")
    .split('"').join("&quot;");

// ---------------------------------------------------------------------------
// Der flache Posten-Index -- die eine Liste, auf der alles arbeitet.
// ---------------------------------------------------------------------------

// Die Namen sind die des Harness selbst -- Hooks, Skills, Commands, Rules. Eine
// eingedeutschte Erfindung ("Waechter", "Faehigkeiten") liest sich zwar wie Deutsch,
// aber niemand erkennt daran, welcher Ordner gemeint ist.
const BEREICHE = {
  zutun: "Zu tun",
  kontext: "Session-Kontext",
  werkzeuge: "Tool-Landschaft",
  faehigkeiten: "Skills",
  befehle: "Commands",
  agenten: "Agents",
  mcp: "MCP-Server",
  hooks: "Hook-Dateien (ECC-Format)",
  waechter: "Hooks",
  regeln: "Rules",
  sicherung: "Backup",
  pruefer: "Checks",
  verlauf: "Commits",
};

function postenIndex(m, regeln) {
  const raus = [];
  let lfd = 0;
  const nimm = (o) => raus.push({ id: "p" + ++lfd, ...o });

  for (const t of m.zuTun || []) {
    nimm({
      bereich: "zutun", titel: t.text, unter: t.grund || "", zustand: t.status,
      quelle: null, befehl: t.befehl || null, roh: t,
    });
  }

  for (const s of m.bereiche.kontext?.stuecke || []) {
    nimm({
      bereich: "kontext", titel: s.pfad, unter: s.art, zustand: null,
      quelle: s.pfad, bytes: s.bytes, aufwand: s.tokenSchaetzung,
      warum: s.warum, roh: s,
    });
  }

  for (const g of m.bereiche.bestand?.gruppen || []) {
    for (const p of g.posten || []) {
      nimm({
        bereich: g.id, titel: String(p.name).split(" · ")[0], unter: p.beschreibung || "",
        zustand: null, quelle: p.quelle || null, bytes: p.bytes, geaendert: p.geaendert,
        herkunft: p.herkunft, ladeart: p.ladeart,
        herkunftBeleg: p.herkunftBeleg, ladeartBeleg: p.ladeartBeleg,
        rubrik: String(p.name).split(" · ")[1] || null, roh: p,
      });
    }
  }

  for (const w of m.bereiche.waechter?.eintraege || []) {
    nimm({
      bereich: "waechter", titel: w.skript || w.art,
      unter: w.ansage || "", zustand: w.vorhanden === false ? "fehlt" : "ok",
      quelle: w.skript ? ".claude/" + w.skript : null,
      marke: w.blockt ? "kann stoppen" : "meldet nur",
      warum: w.blockBeleg, ereignis: w.ereignis, roh: w,
    });
  }

  for (const r of regeln.liste || []) {
    nimm({
      bereich: "regeln", titel: r.titel, unter: (r.quelle && r.quelle.datei) || "",
      zustand: r.status === "gezogen" ? "ok" : "unlesbar",
      quelle: (r.quelle && r.quelle.datei) || null, befehl: r.befehl || null,
      warum: r.grund || r.abgrenzung || null, roh: r,
    });
  }

  for (const r of m.bereiche.sicherung?.repos || []) {
    nimm({
      bereich: "sicherung", titel: r.name,
      unter: r.sync || "", zustand: r.status, quelle: null,
      marke: r.lage, warum: r.github ? "auf GitHub: " + r.github : "kein Fernziel eingerichtet",
      roh: r,
    });
  }

  for (const p of m.bereiche.pruefer?.laeufe || []) {
    nimm({
      bereich: "pruefer", titel: p.id, unter: p.zweck || "",
      zustand: p.status, quelle: p.quelle || null, befehl: p.befehl || null,
      warum: p.grund || p.notiz || null, roh: p,
    });
  }

  for (const e of m.bereiche.verlauf?.eintraege || []) {
    nimm({
      bereich: "verlauf", titel: e.betreff, unter: e.repo,
      zustand: null, quelle: null, datum: e.datum, kennung: e.hash,
      warum: "von " + (e.autor || "unbekannt"), roh: e,
    });
  }

  return raus;
}

// ---------------------------------------------------------------------------
// Symbole -- 16x16, Strichstaerke 1.5, wie im Vorbild.
// ---------------------------------------------------------------------------

const SVG = (d) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

const SYMBOL = {
  ueberblick: SVG('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'),
  zutun: SVG('<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>'),
  werkzeuge: SVG('<path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/>'),
  faehigkeiten: SVG('<path d="M12 3l1.9 5.8H20l-4.9 3.6 1.9 5.8L12 14.6 7 18.2l1.9-5.8L4 8.8h6.1z"/>'),
  befehle: SVG('<path d="M4 17l6-6-6-6"/><path d="M12 19h8"/>'),
  waechter: SVG('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>'),
  regeln: SVG('<path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/>'),
  sicherung: SVG('<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>'),
  kontext: SVG('<circle cx="12" cy="12" r="9"/><path d="M12 8v4l3 2"/>'),
  verlauf: SVG('<path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 106 5.3L3 8"/><path d="M12 7v5l4 2"/>'),
  rohdaten: SVG('<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>'),
};

// ---------------------------------------------------------------------------
// Die Seite
// ---------------------------------------------------------------------------

function renderHTML(m, regelDaten) {
  const regeln = regelDaten || { liste: [] };
  const posten = postenIndex(m, regeln);
  const b = m.bereiche;
  const offen = (m.zuTun || []).length;
  const gemessen = new Date(m.gemessenAm).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });
  const ordner = String(m.wurzel).split(/[/\\]/).filter(Boolean).pop();

  const zaehle = (id) => posten.filter((p) => p.bereich === id).length;

  // Erste Gruppe ohne Beschriftung -- so macht es das Vorbild.
  // Gruppiert nach dem ECHTEN Ordnerbaum des Harness. Wer die Leiste liest, weiss
  // sofort, welches Verzeichnis gemeint ist -- das ist der Zweck der Gruppen.
  const NAV = [
    { gruppe: null, punkte: [
      { id: "ueberblick", titel: "Überblick", symbol: "ueberblick" },
      { id: "zutun", titel: "Zu tun", symbol: "zutun", abzeichen: offen || null, ton: offen ? "warn" : null },
    ]},
    { gruppe: ".claude/", punkte: [
      { id: "waechter", titel: "Hooks", symbol: "waechter", abzeichen: zaehle("waechter") || null },
      { id: "befehle", titel: "Commands", symbol: "befehle", abzeichen: zaehle("befehle") || null },
      { id: "faehigkeiten", titel: "Skills", symbol: "faehigkeiten", abzeichen: zaehle("faehigkeiten") || null },
      { id: "regeln", titel: "Rules", symbol: "regeln", abzeichen: zaehle("regeln") || null },
    ]},
    { gruppe: "Workspace", punkte: [
      { id: "werkzeuge", titel: "Tool-Landschaft", symbol: "werkzeuge", abzeichen: zaehle("werkzeuge") || null },
      { id: "kontext", titel: "Session-Kontext", symbol: "kontext", abzeichen: zaehle("kontext") || null },
      { id: "sicherung", titel: "Backup", symbol: "sicherung", abzeichen: zaehle("sicherung") || null },
      { id: "verlauf", titel: "Commits", symbol: "verlauf", abzeichen: zaehle("verlauf") || null },
    ]},
    { gruppe: "Belege", punkte: [
      { id: "rohdaten", titel: "Rohdaten", symbol: "rohdaten" },
    ]},
  ];

  const UNTER = {
    ueberblick: "Was ist der Fall, braucht es mich, was tue ich dagegen.",
    zutun: "Was offen ist — mit Grund und passendem Befehl.",
    waechter: "Laufen bei jedem Werkzeugaufruf automatisch mit · verdrahtet in .claude/settings.json",
    befehle: "Mit Schrägstrich aufrufbar · .claude/commands/",
    faehigkeiten: "Laden auf Abruf, nicht dauerhaft · .claude/skills/",
    regeln: "Laden in JEDER Session, ohne dass jemand sie aufruft · .claude/rules/keel/",
    werkzeuge: "CLIs, MCP-Server, APIs und Zugänge dieses Arbeitsplatzes · docs/tool-landscape.md",
    kontext: "Was jede Session mitliest und was es kostet · CLAUDE.md, Rules, Hook-Skripte",
    sicherung: "Liegt die Arbeit auch außerhalb dieses Rechners? · git je Repo unter user-projects/",
    verlauf: "Die letzten Commits über alle Repos hinweg · git log",
    rohdaten: "Der gemessene Datensatz selbst — damit jede Zahl nachschlagbar ist.",
  };

  const daten = {
    posten,
    bereiche: BEREICHE,
    unter: UNTER,
    lage: {
      gesamt: m.gesamtstatus,
      zaehlung: m.zaehlung || {},
      offen,
      waechterGesamt: b.waechter?.zaehlung?.gesamt || 0,
      waechterBlockend: b.waechter?.zaehlung?.blockend || 0,
      regelnGelesen: (regeln.liste || []).filter((r) => r.status === "gezogen").length,
      regelnGesamt: (regeln.liste || []).length,
      repos: (b.sicherung?.repos || []).length,
      reposOffen: (b.sicherung?.repos || []).filter((r) => r.status !== "ok").length,
      aufwand: b.kontext?.tokenSchaetzungJeSitzung || 0,
      aufwandHinweis: b.kontext?.faktorHinweis || null,
      gemessen,
    },
    roh: { messung: m, regeln },
  };

  const navHTML = NAV.map((g) => `
      ${g.gruppe ? `<div class="nav-gruppe">${esc(g.gruppe)}</div>` : ""}
      ${g.punkte.map((p) => `<button class="navpunkt" data-ziel="${p.id}"${p.id === "ueberblick" ? ' aria-current="page"' : ""}>
        <span class="nav-symbol">${SYMBOL[p.symbol] || ""}</span>
        <span class="nav-text">${esc(p.titel)}</span>
        ${p.abzeichen ? `<span class="nav-zahl${p.ton ? " " + p.ton : ""}">${p.abzeichen}</span>` : ""}
      </button>`).join("")}`).join("");

  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Harness-Dashboard — ${esc(ordner)}</title>
<style>
/* Palette woertlich aus keel-theme.css (oklch, Blauton 205-238). */
:root{
  --grund:oklch(0.978 0.007 214); --schrift:oklch(0.22 0.025 233);
  --flaeche:oklch(0.99 0.004 210); --gedaempft:oklch(0.935 0.018 205);
  --gedaempft-schrift:oklch(0.47 0.022 228); --akzent:oklch(0.4 0.07 224);
  --akzent-schrift:oklch(0.985 0.004 210); --rahmen:oklch(0.28 0.03 230 / 0.22);
  --leiste-aktiv:oklch(0.92 0.028 212);
  /* Zustandsfarben: je Ton eigens gesetzt, nicht aus einer Formel -- Gelb und Grau
     brauchen einen dunkleren Textanteil als Rot, sonst faellt der Kontrast unter 3:1. */
  --st-ok:oklch(0.52 0.10 165); --st-hinweis:oklch(0.52 0.12 72);
  --st-fehlt:oklch(0.50 0.13 45); --st-unlesbar:oklch(0.52 0.18 25);
  --st-ohne:oklch(0.52 0.02 230);
  --radius:8px; --radius-lg:10px; --radius-xl:12px;
  --schrift-familie:"InterVariable","Inter",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
  --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;
  --kopf:48px;
}
:root[data-thema="dunkel"], html:not([data-thema="hell"]) body.system-dunkel{}
@media (prefers-color-scheme: dark){ :root:not([data-thema="hell"]){
  --grund:oklch(0.16 0.038 238); --schrift:oklch(0.94 0.012 210);
  --flaeche:oklch(0.26 0.045 233); --gedaempft:oklch(0.275 0.058 232);
  --gedaempft-schrift:oklch(0.7 0.02 218); --akzent:oklch(0.78 0.075 205);
  --akzent-schrift:oklch(0.16 0.038 238); --rahmen:oklch(0.92 0.02 210 / 0.18);
  --leiste-aktiv:oklch(0.275 0.058 232);
  --st-ok:oklch(0.78 0.11 165); --st-hinweis:oklch(0.82 0.13 78);
  --st-fehlt:oklch(0.76 0.13 45); --st-unlesbar:oklch(0.72 0.16 25);
  --st-ohne:oklch(0.68 0.02 220);
}}
:root[data-thema="dunkel"]{
  --grund:oklch(0.16 0.038 238); --schrift:oklch(0.94 0.012 210);
  --flaeche:oklch(0.26 0.045 233); --gedaempft:oklch(0.275 0.058 232);
  --gedaempft-schrift:oklch(0.7 0.02 218); --akzent:oklch(0.78 0.075 205);
  --akzent-schrift:oklch(0.16 0.038 238); --rahmen:oklch(0.92 0.02 210 / 0.18);
  --leiste-aktiv:oklch(0.275 0.058 232);
  --st-ok:oklch(0.78 0.11 165); --st-hinweis:oklch(0.82 0.13 78);
  --st-fehlt:oklch(0.76 0.13 45); --st-unlesbar:oklch(0.72 0.16 25);
  --st-ohne:oklch(0.68 0.02 220);
}
*{box-sizing:border-box}
body{margin:0;background:var(--grund);color:var(--schrift);font-family:var(--schrift-familie);
  font-size:14px;line-height:1.5;-webkit-font-smoothing:antialiased;
  display:grid;grid-template-columns:240px 1fr;height:100vh;overflow:hidden}

/* --- Seitenleiste: gleicher Grundton wie die Hauptflaeche, nur ein Haarstrich --- */
aside{border-right:1px solid var(--rahmen);display:flex;flex-direction:column;min-height:0}
.leiste-kopf{height:var(--kopf);display:flex;align-items:center;gap:8px;padding:0 12px;flex:0 0 auto}
.marke{width:20px;height:20px;border-radius:6.4px;background:var(--akzent);color:var(--akzent-schrift);
  display:grid;place-items:center;font-weight:700;font-size:11px;flex:0 0 20px}
.marke-text{font-size:14px;font-weight:700;letter-spacing:-.01em;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kopf-knopf{width:28px;height:28px;border:0;background:none;color:var(--gedaempft-schrift);border-radius:6px;
  display:grid;place-items:center;cursor:pointer}
.kopf-knopf:hover{background:var(--leiste-aktiv);color:var(--schrift)}
.kopf-knopf svg{width:15px;height:15px}
nav{padding:12px;overflow-y:auto;flex:1;min-height:0}
.nav-gruppe{font-family:var(--mono);font-size:10px;text-transform:uppercase;letter-spacing:.1em;
  color:var(--gedaempft-schrift);opacity:.75;padding-left:16px;margin:16px 0 6px}
.nav-gruppe:first-child{margin-top:0}
.navpunkt{display:flex;align-items:center;gap:10px;width:calc(100% - 16px);margin:0 8px;padding:6px 8px;
  border:0;background:none;color:var(--schrift);font:inherit;font-size:14px;font-weight:500;
  border-radius:var(--radius);cursor:pointer;text-align:left}
.navpunkt+.navpunkt{margin-top:2px}
.navpunkt:hover{background:var(--leiste-aktiv)}
.navpunkt[aria-current="page"]{background:var(--leiste-aktiv);font-weight:600}
.nav-symbol{width:16px;height:16px;flex:0 0 16px;color:var(--gedaempft-schrift);display:block}
.navpunkt[aria-current="page"] .nav-symbol{color:var(--schrift)}
.nav-symbol svg{width:16px;height:16px;display:block}
.nav-text{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nav-zahl{font-size:11px;font-weight:600;color:var(--gedaempft-schrift);font-variant-numeric:tabular-nums}
.nav-zahl.warn{background:var(--st-hinweis);color:var(--flaeche);min-width:18px;height:18px;
  border-radius:9px;display:grid;place-items:center;padding:0 5px}
.leiste-fuss{border-top:1px solid var(--rahmen);padding:10px 12px;font-size:11px;
  color:var(--gedaempft-schrift);line-height:1.5;flex:0 0 auto}
.leiste-fuss code{font-family:var(--mono);font-size:10.5px}

/* --- Hauptflaeche --- */
main{display:flex;flex-direction:column;min-width:0;min-height:0}
.kopfzeile{height:var(--kopf);flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:0 20px;
  border-bottom:1px solid var(--rahmen);font-size:13px}
.krume{color:var(--gedaempft-schrift)}
.krume b{color:var(--schrift);font-weight:600}
.krume-pfeil{opacity:.5;margin:0 2px}
.kopf-rechts{margin-left:auto;display:flex;align-items:center;gap:10px;color:var(--gedaempft-schrift);font-size:12px}

.buehne{flex:1;min-height:0;padding:16px 20px 20px;overflow:hidden;position:relative}
.tafel{background:var(--grund);height:100%;display:flex;flex-direction:column;min-height:0;position:relative}

.seitenkopf{flex:0 0 auto;padding:6px 2px 18px}
.seitenkopf h1{font-size:19px;font-weight:650;letter-spacing:-.01em;margin:0 0 3px}
.seitenkopf p{margin:0;font-size:13px;color:var(--gedaempft-schrift)}

.werkzeugleiste{flex:0 0 auto;display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding-bottom:14px}
.sicht{display:flex;gap:2px;background:var(--gedaempft);padding:2px;border-radius:var(--radius)}
.sicht button{border:0;background:none;color:var(--gedaempft-schrift);font:inherit;font-size:12.5px;
  padding:4px 11px;border-radius:6px;cursor:pointer}
.sicht button[aria-pressed="true"]{background:var(--flaeche);color:var(--schrift);font-weight:650}
.suche{margin-left:auto;display:flex;align-items:center;gap:6px;background:var(--flaeche);
  border:1px solid var(--rahmen);border-radius:var(--radius);padding:0 10px;height:30px;min-width:220px}
.suche svg{width:14px;height:14px;color:var(--gedaempft-schrift);flex:0 0 14px}
.suche input{border:0;background:none;outline:none;font:inherit;font-size:13px;color:var(--schrift);width:100%}
.filterzeile{flex:0 0 auto;display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding-bottom:12px}
.pille{border:1px dashed var(--rahmen);background:none;color:var(--gedaempft-schrift);font:inherit;
  font-size:12px;padding:3px 11px;border-radius:99px;cursor:pointer;display:inline-flex;align-items:center;gap:6px}
.pille[aria-pressed="true"]{border-style:solid;border-color:var(--sc,var(--akzent));
  background:color-mix(in oklab,var(--sc,var(--akzent)) 12%,transparent);color:var(--sc,var(--akzent));font-weight:600}
.pille .zahl{font-size:10px;font-weight:700;line-height:14px;opacity:.75;font-variant-numeric:tabular-nums}
.waehler{border:1px solid var(--rahmen);background:var(--flaeche);color:var(--schrift);font:inherit;
  font-size:12.5px;padding:4px 8px;border-radius:var(--radius);cursor:pointer}
.textknopf{border:0;background:none;color:var(--akzent);font:inherit;font-size:12px;
  text-decoration:underline;cursor:pointer;padding:0}

.leib{flex:1;min-height:0;overflow:auto;padding-right:2px}

/* --- Karten: aussen Seitenton, innen heller. Das ist die Schichtung des Vorbilds. --- */
.karte{background:var(--flaeche);border:1px solid var(--rahmen);border-radius:var(--radius-xl);
  overflow:hidden;margin-bottom:12px}
.karte-kopf{padding:12px 16px;font-size:13.5px;font-weight:650;border-bottom:1px solid var(--rahmen);
  display:flex;align-items:center;gap:9px}
.karte-kopf .zahl{margin-left:auto;font-size:11.5px;font-weight:600;color:var(--gedaempft-schrift);
  font-variant-numeric:tabular-nums}
.karte-notiz{padding:10px 16px;font-size:12.5px;color:var(--gedaempft-schrift);border-bottom:1px solid var(--rahmen)}

.zeile{display:flex;align-items:flex-start;gap:10px;padding:10px 16px;cursor:pointer;
  border-bottom:1px solid var(--rahmen)}
.zeile:last-child{border-bottom:0}
.zeile:hover{background:color-mix(in oklab,var(--gedaempft) 45%,transparent)}
.zeile[aria-selected="true"]{background:color-mix(in oklab,var(--akzent) 10%,transparent);
  box-shadow:inset 2px 0 0 var(--akzent)}
.punkt{width:9px;height:9px;border-radius:50%;flex:0 0 9px;margin-top:5px;background:var(--st-ohne)}
.z-mitte{flex:1;min-width:0}
.z-titel{font-size:13.5px;font-weight:550;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.z-unter{font-size:11.5px;color:var(--gedaempft-schrift);margin-top:2px;overflow:hidden;
  text-overflow:ellipsis;white-space:nowrap}
.z-pfad{font-family:var(--mono);font-size:11px;color:var(--gedaempft-schrift);margin-top:2px}
.z-rechts{display:flex;align-items:center;gap:8px;flex:0 0 auto}
.marke-zustand{padding:1px 8px;font-size:10.5px;font-weight:600;line-height:16px;border:0;border-radius:6px;
  background:color-mix(in oklab,var(--sc) 18%,transparent);color:var(--sc);white-space:nowrap}
.aufklapp{padding:0 16px 12px 35px;font-size:12.5px;color:var(--gedaempft-schrift);
  border-bottom:1px solid var(--rahmen);background:color-mix(in oklab,var(--gedaempft) 30%,transparent)}
.aufklapp dl{display:grid;grid-template-columns:auto 1fr;gap:3px 12px;margin:10px 0 0}
.aufklapp dt{color:var(--gedaempft-schrift)} .aufklapp dd{margin:0;word-break:break-word}

.gruppenkopf{font-size:10px;font-weight:650;letter-spacing:.05em;text-transform:uppercase;
  color:var(--gedaempft-schrift);padding:14px 2px 6px;display:flex;align-items:center;gap:8px}
.gruppenkopf .zahl{font-variant-numeric:tabular-nums;opacity:.7}

/* --- Kennzahlen --- */
.kennzahlen{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:16px}
.kachel{background:var(--flaeche);border:1px solid var(--rahmen);border-radius:var(--radius-xl);padding:14px}
.kachel .k-titel{font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--gedaempft-schrift);font-weight:600}
.kachel .k-wert{font-size:22px;font-weight:700;letter-spacing:-.02em;margin:6px 0 3px;font-variant-numeric:tabular-nums}
.kachel .k-quelle{font-size:10.5px;color:var(--gedaempft-schrift);line-height:1.4}

/* --- Brett: die Spaltenflaeche traegt die Zustandsfarbe --- */
.brett{display:flex;gap:14px;overflow-x:auto;height:100%;padding-bottom:6px}
.spalte{flex:0 0 262px;display:flex;flex-direction:column;min-height:0}
.spalte-kopf{display:flex;align-items:center;gap:8px;padding:0 4px 8px;font-size:12.5px;font-weight:650}
.spalte-kopf .zahl{margin-left:auto;font-size:11px;color:var(--gedaempft-schrift);font-variant-numeric:tabular-nums}
.spalte-leib{flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:4px;
  background:color-mix(in oklab,var(--sc) 8%,var(--grund));
  box-shadow:inset 0 0 0 1px color-mix(in oklab,var(--sc) 15%,transparent);
  border-radius:var(--radius-lg);padding:8px}
.bkarte{background:var(--flaeche);border:1px solid var(--rahmen);border-radius:var(--radius);
  padding:10px 12px;cursor:pointer}
.bkarte:hover{border-color:color-mix(in oklab,var(--schrift) 20%,transparent)}
.bk-titel{font-size:12.5px;font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bk-unter{font-size:11px;color:var(--gedaempft-schrift);margin-top:3px;overflow:hidden;
  text-overflow:ellipsis;white-space:nowrap}
.bk-fuss{display:flex;gap:8px;margin-top:6px;font-size:10.5px;color:var(--gedaempft-schrift)}
.spalte-leer{font-size:11.5px;color:var(--gedaempft-schrift);padding:10px 4px;line-height:1.45}

/* --- Tabelle --- */
table{width:100%;border-collapse:collapse;font-size:12.5px;background:var(--flaeche);
  border:1px solid var(--rahmen);border-radius:var(--radius-xl);overflow:hidden}
th{text-align:left;font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--gedaempft-schrift);
  font-weight:600;padding:10px 12px;border-bottom:1px solid var(--rahmen);cursor:pointer;white-space:nowrap}
th:hover{color:var(--schrift)}
td{padding:9px 12px;border-bottom:1px solid var(--rahmen)}
tr:last-child td{border-bottom:0}
tbody tr{cursor:pointer}
tbody tr:hover{background:color-mix(in oklab,var(--gedaempft) 45%,transparent)}
.num{text-align:right;font-variant-numeric:tabular-nums}
.mono{font-family:var(--mono);font-size:11.5px}
.balken{display:block;height:4px;border-radius:2px;background:var(--akzent);opacity:.5;margin-top:3px}

/* --- Einzelansicht: schwebt INNERHALB der Tafel --- */
.einzel{position:absolute;top:14px;right:14px;bottom:14px;width:min(340px,88%);
  background:var(--flaeche);border:1px solid var(--rahmen);border-radius:14px;
  box-shadow:0 8px 28px oklch(0.2 0.03 235 / .18);z-index:25;display:flex;flex-direction:column;overflow:hidden}
.einzel-kopf{display:flex;align-items:center;gap:8px;padding:13px 16px;border-bottom:1px solid var(--rahmen)}
.einzel-kopf h2{font-size:14px;font-weight:650;margin:0;flex:1;overflow:hidden;text-overflow:ellipsis}
.einzel-leib{flex:1;overflow-y:auto;padding:14px 16px;font-size:12.5px}
.einzel-leib dl{display:grid;grid-template-columns:auto 1fr;gap:5px 12px;margin:0 0 14px}
.einzel-leib dt{color:var(--gedaempft-schrift)} .einzel-leib dd{margin:0;word-break:break-word}
.einzel-leib h3{font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--gedaempft-schrift);
  margin:16px 0 6px;font-weight:600}

.kopierbar{cursor:copy;border:0;background:none;font:inherit;color:inherit;padding:0;text-align:left}
.kopierbar:hover{color:var(--akzent)}
.kopiert{font-size:10.5px;color:var(--st-ok);margin-left:6px}
pre.befehl{background:var(--gedaempft);border-radius:6px;padding:8px 10px;overflow-x:auto;margin:6px 0 0;
  font-family:var(--mono);font-size:11.5px;white-space:pre-wrap;word-break:break-all}
.leer-text{color:var(--gedaempft-schrift);font-size:13px;padding:24px 2px;line-height:1.6}
details.roh{background:var(--flaeche);border:1px solid var(--rahmen);border-radius:var(--radius);margin-bottom:6px}
details.roh summary{padding:9px 13px;cursor:pointer;font-size:12.5px;font-weight:600;list-style:none}
details.roh summary::-webkit-details-marker{display:none}
details.roh pre{margin:0;padding:0 13px 12px;font-family:var(--mono);font-size:11px;overflow-x:auto;
  color:var(--gedaempft-schrift);white-space:pre-wrap;word-break:break-word}

@media (max-width:900px){
  body{grid-template-columns:1fr;grid-template-rows:auto 1fr}
  aside{border-right:0;border-bottom:1px solid var(--rahmen);max-height:44vh}
  .einzel{width:auto;left:14px}
}
</style>
</head>
<body>
<aside>
  <div class="leiste-kopf">
    <span class="marke">H</span>
    <span class="marke-text">Harness-Dashboard</span>
    <button class="kopf-knopf" id="thema" title="Hell oder dunkel">
      ${SVG('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M5 5l1.5 1.5M17.5 17.5L19 19M2 12h2M20 12h2M5 19l1.5-1.5M17.5 6.5L19 5"/>')}
    </button>
  </div>
  <nav>${navHTML}</nav>
  <div class="leiste-fuss">
    Gemessen ${esc(gemessen)}<br>
    <button class="kopierbar" data-kopie="node dashboard/index.js --html dashboard.html"><code>node dashboard/index.js --html dashboard.html</code></button>
  </div>
</aside>

<main>
  <div class="kopfzeile">
    <span class="krume"><b>${esc(ordner)}</b><span class="krume-pfeil">›</span><span id="krume-flaeche">Überblick</span><span id="krume-rest"></span></span>
    <span class="kopf-rechts"><span id="zaehler"></span></span>
  </div>
  <div class="buehne">
    <section class="tafel">
      <div class="seitenkopf">
        <h1 id="titel">Überblick</h1>
        <p id="untertitel"></p>
      </div>
      <div class="werkzeugleiste" id="werkzeugleiste"></div>
      <div class="filterzeile" id="filterzeile"></div>
      <div class="leib" id="leib"></div>
    </section>
  </div>
</main>

<script id="daten" type="application/json">${JSON.stringify(daten).split("<").join("\\u003c")}</script>
<script>
(function () {
  "use strict";
  var D = JSON.parse(document.getElementById("daten").textContent);
  var POSTEN = D.posten;

  var ZUSTAND = {
    unlesbar: { wort: "Nicht messbar", farbe: "var(--st-unlesbar)", rang: 4 },
    befund:   { wort: "Befund",         farbe: "var(--st-unlesbar)", rang: 4 },
    fehlt:    { wort: "Nicht vorhanden",farbe: "var(--st-fehlt)",    rang: 3 },
    hinweis:  { wort: "Hinweis",        farbe: "var(--st-hinweis)",  rang: 2 },
    ok:       { wort: "In Ordnung",     farbe: "var(--st-ok)",       rang: 1 },
    ohne:     { wort: "Ohne gemessenen Zustand", farbe: "var(--st-ohne)", rang: 0 }
  };
  function zst(p) { return p.zustand || "ohne"; }
  function zInfo(k) { return ZUSTAND[k] || ZUSTAND.ohne; }

  var S = {
    flaeche: "ueberblick", sicht: "liste", suche: "",
    filter: [], sortier: "dringlichkeit", richtung: "ab", gruppe: "bereich",
    offen: {}, einzel: null, auswahl: -1
  };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function zahl(n) { return typeof n === "number" ? n.toLocaleString("de-DE") : "—"; }
  function groesse(n) {
    if (typeof n !== "number") return "—";
    return n < 1024 ? n + " B" : (n / 1024).toFixed(1).replace(".", ",") + " KB";
  }
  function datum(s) { return s ? String(s).slice(0, 10) : "—"; }

  // --- Auswahl: Seitenleiste IST der Bereichsfilter --------------------------
  function basis() {
    if (S.flaeche === "ueberblick" || S.flaeche === "rohdaten") return POSTEN;
    if (S.flaeche === "zutun") return POSTEN.filter(function (p) { return p.bereich === "zutun"; });
    return POSTEN.filter(function (p) { return p.bereich === S.flaeche; });
  }
  function sichtbar() {
    var q = S.suche.trim().toLowerCase();
    return basis().filter(function (p) {
      if (S.filter.length && S.filter.indexOf(zst(p)) === -1) return false;
      if (!q) return true;
      return [p.titel, p.unter, p.quelle, p.warum, p.befehl, D.bereiche[p.bereich], p.herkunft, p.ladeart]
        .filter(Boolean).join(" ").toLowerCase().indexOf(q) !== -1;
    });
  }
  function sortiere(liste) {
    var r = S.richtung === "ab" ? -1 : 1;
    var f = {
      dringlichkeit: function (a, b) { return (zInfo(zst(a)).rang - zInfo(zst(b)).rang) * r; },
      titel: function (a, b) { return String(a.titel).localeCompare(String(b.titel)) * -r; },
      quelle: function (a, b) { return String(a.quelle || "").localeCompare(String(b.quelle || "")) * -r; },
      groesse: function (a, b) { return ((a.bytes || 0) - (b.bytes || 0)) * r; },
      datum: function (a, b) { return String(a.geaendert || a.datum || "").localeCompare(String(b.geaendert || b.datum || "")) * r; }
    }[S.sortier];
    return liste.slice().sort(f);
  }

  // --- Bausteine -------------------------------------------------------------
  function punkt(p) { return '<span class="punkt" style="background:' + zInfo(zst(p)).farbe + '"></span>'; }
  function marke(p) {
    if (!p.zustand) return "";
    var i = zInfo(zst(p));
    return '<span class="marke-zustand" style="--sc:' + i.farbe + '">' + esc(i.wort) + "</span>";
  }
  function kopierbar(text, anzeige, klasse) {
    return '<button class="kopierbar ' + (klasse || "") + '" data-kopie="' + esc(text) + '">' + (anzeige || esc(text)) + "</button>";
  }

  function zeile(p, i) {
    var auf = S.offen[p.id];
    var h = '<div class="zeile" data-id="' + p.id + '" data-i="' + i + '"' + (S.auswahl === i ? ' aria-selected="true"' : "") + ">";
    h += punkt(p);
    h += '<span class="z-mitte">';
    h += '<span class="z-titel">' + esc(p.titel) + "</span>";
    if (p.unter) h += '<span class="z-unter">' + esc(p.unter) + "</span>";
    if (p.quelle) h += '<div class="z-pfad">' + esc(p.quelle) + "</div>";
    h += "</span>";
    h += '<span class="z-rechts">' + marke(p) + "</span></div>";
    if (auf) {
      h += '<div class="aufklapp"><dl>';
      if (p.quelle) h += "<dt>Quelle</dt><dd>" + kopierbar(p.quelle, '<span class="mono">' + esc(p.quelle) + "</span>") + "</dd>";
      if (typeof p.bytes === "number") h += "<dt>Größe</dt><dd>" + groesse(p.bytes) + "</dd>";
      if (p.geaendert) h += "<dt>Geändert</dt><dd>" + datum(p.geaendert) + "</dd>";
      if (p.herkunft) h += "<dt>Herkunft</dt><dd>" + esc(p.herkunft) + (p.herkunftBeleg ? " — " + esc(p.herkunftBeleg) : "") + "</dd>";
      if (p.ladeart) h += "<dt>Lädt</dt><dd>" + esc(p.ladeart) + (p.ladeartBeleg ? " — " + esc(p.ladeartBeleg) : "") + "</dd>";
      if (p.ereignis) h += "<dt>Läuft bei</dt><dd>" + esc(p.ereignis) + "</dd>";
      if (p.warum) h += "<dt>Warum</dt><dd>" + esc(p.warum) + "</dd>";
      h += "</dl>";
      if (p.befehl) h += kopierbar(p.befehl, '<pre class="befehl">' + esc(p.befehl) + "</pre>");
      h += "</div>";
    }
    return h;
  }

  // --- Ansichten -------------------------------------------------------------
  function sichtListe(liste) {
    if (!liste.length) return leerText();
    var gruppen = {};
    liste.forEach(function (p) {
      var k = S.gruppe === "zustand" ? zInfo(zst(p)).wort
            : S.gruppe === "herkunft" ? (p.herkunft || "nicht bestimmbar")
            : S.gruppe === "ladeart" ? (p.ladeart || "ohne Angabe")
            : D.bereiche[p.bereich] || p.bereich;
      (gruppen[k] = gruppen[k] || []).push(p);
    });
    var i = -1;
    return Object.keys(gruppen).map(function (k) {
      var h = '<div class="gruppenkopf">' + esc(k) + '<span class="zahl">' + gruppen[k].length + "</span></div>";
      h += '<div class="karte">' + gruppen[k].map(function (p) { i++; return zeile(p, i); }).join("") + "</div>";
      return h;
    }).join("");
  }

  function sichtBrett(liste) {
    var reihen = ["unlesbar", "fehlt", "hinweis", "ok", "ohne"];
    return '<div class="brett">' + reihen.map(function (k) {
      var i = zInfo(k);
      var karten = liste.filter(function (p) { return zst(p) === k || (k === "unlesbar" && zst(p) === "befund"); });
      var h = '<div class="spalte"><div class="spalte-kopf"><span class="punkt" style="background:' + i.farbe + '"></span>'
        + esc(i.wort) + '<span class="zahl">' + karten.length + "</span></div>";
      h += '<div class="spalte-leib" style="--sc:' + i.farbe + '">';
      h += karten.length ? karten.map(function (p) {
        return '<div class="bkarte" data-id="' + p.id + '"><div class="bk-titel">' + esc(p.titel) + "</div>"
          + (p.unter ? '<div class="bk-unter">' + esc(p.unter) + "</div>" : "")
          + '<div class="bk-fuss"><span>' + esc(D.bereiche[p.bereich] || p.bereich) + "</span>"
          + (p.quelle ? '<span class="mono" style="margin-left:auto">' + esc(String(p.quelle).split(/[/\\\\]/).pop()) + "</span>" : "")
          + "</div></div>";
      }).join("")
        : '<div class="spalte-leer">' + (k === "ohne"
            ? "Alles hier Gezeigte hat einen gemessenen Zustand."
            : "Kein Posten in diesem Zustand.") + "</div>";
      return h + "</div></div>";
    }).join("") + "</div>";
  }

  function sichtTabelle(liste) {
    if (!liste.length) return leerText();
    var max = liste.reduce(function (a, p) { return Math.max(a, p.bytes || 0); }, 0) || 1;
    var kopf = [["titel", "Posten"], ["quelle", "Quelldatei"], ["bereich", "Bereich"],
                ["herkunft", "Herkunft"], ["ladeart", "Lädt"], ["groesse", "Größe"], ["datum", "Geändert"]];
    var h = "<table><thead><tr>" + kopf.map(function (k) {
      return '<th data-sort="' + k[0] + '">' + esc(k[1]) + (S.sortier === k[0] ? (S.richtung === "ab" ? " ↓" : " ↑") : "") + "</th>";
    }).join("") + "<th>Zustand</th></tr></thead><tbody>";
    h += liste.map(function (p) {
      return '<tr data-id="' + p.id + '"><td>' + esc(p.titel) + "</td>"
        + '<td class="mono">' + esc(p.quelle || "—") + "</td>"
        + "<td>" + esc(D.bereiche[p.bereich] || p.bereich) + "</td>"
        + "<td>" + esc(p.herkunft || "—") + "</td>"
        + "<td>" + esc(p.ladeart || "—") + "</td>"
        + '<td class="num">' + groesse(p.bytes)
        + (typeof p.bytes === "number" ? '<span class="balken" style="width:' + Math.max(2, Math.round((p.bytes / max) * 100)) + '%"></span>' : "")
        + "</td>"
        + '<td class="mono">' + datum(p.geaendert || p.datum) + "</td>"
        + "<td>" + (marke(p) || "—") + "</td></tr>";
    }).join("");
    return h + "</tbody></table>";
  }

  function sichtZeit(liste) {
    var mit = liste.filter(function (p) { return p.datum || p.geaendert; });
    if (!mit.length) return '<p class="leer-text">Keiner dieser Posten trägt ein Datum.</p>';
    var tage = {};
    mit.forEach(function (p) { var t = datum(p.datum || p.geaendert); (tage[t] = tage[t] || []).push(p); });
    return Object.keys(tage).sort().reverse().map(function (t, i) {
      return '<details class="roh"' + (i === 0 ? " open" : "") + '><summary><span class="mono">' + esc(t)
        + '</span> <span style="color:var(--gedaempft-schrift);font-weight:400">' + tage[t].length + " Einträge</span></summary>"
        + '<div class="karte" style="margin:0 13px 12px">' + tage[t].map(function (p, j) { return zeile(p, j); }).join("") + "</div></details>";
    }).join("");
  }

  function sichtRoh() {
    function baum(o, tiefe) {
      if (o === null || typeof o !== "object") return '<span class="mono">' + esc(JSON.stringify(o)) + "</span>";
      if (tiefe > 2) return '<span class="mono">' + esc(JSON.stringify(o).slice(0, 120)) + "…</span>";
      return Object.keys(o).map(function (k) {
        var v = o[k];
        var einfach = v === null || typeof v !== "object";
        return '<details class="roh"><summary>' + esc(k) + (Array.isArray(v) ? " [" + v.length + "]" : "")
          + "</summary><pre>" + (einfach ? esc(JSON.stringify(v)) : esc(JSON.stringify(v, null, 1).slice(0, 4000))) + "</pre></details>";
      }).join("");
    }
    return '<div class="karte-notiz" style="border:1px solid var(--rahmen);border-radius:12px;margin-bottom:12px">'
      + "Der gemessene Datensatz, unverändert. Jede Zahl auf den anderen Flächen lässt sich hier nachschlagen."
      + "</div>" + baum(D.roh.messung, 0);
  }

  function leerText() {
    if (S.suche) return '<p class="leer-text">Kein Posten enthält „' + esc(S.suche)
      + '". <button class="textknopf" id="suche-leeren">Suche leeren</button></p>';
    if (S.filter.length) return '<p class="leer-text">Kein Posten in diesem Zustand. <button class="textknopf" id="filter-leeren">Filter zurücksetzen</button></p>';
    return '<p class="leer-text">Hier wurde noch nichts gemessen.</p>';
  }

  function ueberblick() {
    var L = D.lage;
    var k = [
      ["Offene Punkte", L.offen, L.offen ? "stehen in der Liste Zu tun" : "nichts offen", L.offen ? "var(--st-hinweis)" : null],
      ["Wächter aktiv", L.waechterGesamt, L.waechterBlockend + " können einen Befehl stoppen", null],
      ["Dauer-Regeln", L.regelnGelesen + " von " + L.regelnGesamt, "in jeder Sitzung geladen", null],
      ["Verzeichnisse", (L.repos - L.reposOffen) + " von " + L.repos, L.reposOffen ? "eines braucht Aufmerksamkeit" : "alle gesichert", L.reposOffen ? "var(--st-hinweis)" : null],
      ["Aufwand je Sitzung", zahl(L.aufwand), L.aufwandHinweis ? "Schätzung — " + L.aufwandHinweis.slice(0, 60) : "geschätzte Wortbausteine", null],
      ["Posten gesamt", POSTEN.length, "gemessen " + L.gemessen, null]
    ];
    var h = '<div class="kennzahlen">' + k.map(function (x) {
      return '<div class="kachel"><div class="k-titel">' + esc(x[0]) + "</div>"
        + '<div class="k-wert"' + (x[3] ? ' style="color:' + x[3] + '"' : "") + ">" + esc(x[1]) + "</div>"
        + '<div class="k-quelle">' + esc(x[2]) + "</div></div>";
    }).join("") + "</div>";
    var offene = POSTEN.filter(function (p) { return p.zustand && p.zustand !== "ok"; });
    h += '<div class="karte"><div class="karte-kopf">Braucht Aufmerksamkeit<span class="zahl">' + offene.length + "</span></div>";
    h += offene.length ? offene.map(function (p, i) { return zeile(p, i); }).join("")
      : '<div class="karte-notiz" style="border:0">Nichts. Alle Bereiche mit gemessenem Zustand sind in Ordnung.</div>';
    return h + "</div>";
  }

  // --- Einzelansicht ---------------------------------------------------------
  function einzelHTML(p) {
    var h = '<aside class="einzel"><div class="einzel-kopf"><h2>' + esc(p.titel) + "</h2>"
      + marke(p) + '<button class="kopf-knopf" id="einzel-zu" title="Schließen">✕</button></div><div class="einzel-leib">';
    h += "<dl>";
    h += "<dt>Bereich</dt><dd>" + esc(D.bereiche[p.bereich] || p.bereich) + "</dd>";
    if (p.quelle) h += "<dt>Quelle</dt><dd>" + kopierbar(p.quelle, '<span class="mono">' + esc(p.quelle) + "</span>") + "</dd>";
    if (typeof p.bytes === "number") h += "<dt>Größe</dt><dd>" + groesse(p.bytes) + "</dd>";
    if (p.geaendert) h += "<dt>Geändert</dt><dd>" + datum(p.geaendert) + "</dd>";
    if (p.herkunft) h += "<dt>Herkunft</dt><dd>" + esc(p.herkunft) + "</dd>";
    if (p.herkunftBeleg) h += "<dt>Beleg</dt><dd>" + esc(p.herkunftBeleg) + "</dd>";
    if (p.ladeart) h += "<dt>Lädt</dt><dd>" + esc(p.ladeart) + "</dd>";
    if (p.ladeartBeleg) h += "<dt>Beleg</dt><dd>" + esc(p.ladeartBeleg) + "</dd>";
    if (p.ereignis) h += "<dt>Läuft bei</dt><dd>" + esc(p.ereignis) + "</dd>";
    if (p.marke) h += "<dt>Art</dt><dd>" + esc(p.marke) + "</dd>";
    if (p.kennung) h += "<dt>Kennung</dt><dd>" + kopierbar(p.kennung, '<span class="mono">' + esc(p.kennung) + "</span>") + "</dd>";
    h += "</dl>";
    if (p.warum) h += "<h3>Warum</h3><p style=\\"margin:0\\">" + esc(p.warum) + "</p>";
    if (p.befehl) h += "<h3>Befehl</h3>" + kopierbar(p.befehl, '<pre class="befehl">' + esc(p.befehl) + "</pre>");
    h += "<h3>Rohobjekt</h3><details class=\\"roh\\"><summary>anzeigen</summary><pre>"
      + esc(JSON.stringify(p.roh, null, 1)) + "</pre></details>";
    return h + "</div></aside>";
  }

  // --- Zeichnen --------------------------------------------------------------
  function werkzeugleiste() {
    if (S.flaeche === "ueberblick" || S.flaeche === "rohdaten") return "";
    var sichten = [["liste", "Liste"], ["brett", "Brett"], ["tabelle", "Tabelle"], ["zeit", "Zeitleiste"]];
    var h = '<div class="sicht">' + sichten.map(function (s) {
      return '<button data-sicht="' + s[0] + '" aria-pressed="' + (S.sicht === s[0]) + '">' + s[1] + "</button>";
    }).join("") + "</div>";
    h += '<select class="waehler" id="sortier">' + [["dringlichkeit", "Dringlichkeit"], ["titel", "Name"],
      ["quelle", "Quelldatei"], ["groesse", "Größe"], ["datum", "Datum"]].map(function (o) {
      return '<option value="' + o[0] + '"' + (S.sortier === o[0] ? " selected" : "") + ">Sortieren: " + o[1] + "</option>";
    }).join("") + "</select>";
    if (S.sicht === "liste") {
      h += '<select class="waehler" id="gruppe">' + [["bereich", "Bereich"], ["zustand", "Zustand"],
        ["herkunft", "Herkunft"], ["ladeart", "Ladeart"]].map(function (o) {
        return '<option value="' + o[0] + '"' + (S.gruppe === o[0] ? " selected" : "") + ">Gruppieren: " + o[1] + "</option>";
      }).join("") + "</select>";
    }
    h += '<span class="suche">' + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">'
      + '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>'
      + '<input id="suche" placeholder="Suchen …" value="' + esc(S.suche) + '"></span>';
    return h;
  }

  function filterzeile() {
    if (S.flaeche === "ueberblick" || S.flaeche === "rohdaten") return "";
    var b = basis();
    var h = ["unlesbar", "fehlt", "hinweis", "ok", "ohne"].map(function (k) {
      var n = b.filter(function (p) { return zst(p) === k || (k === "unlesbar" && zst(p) === "befund"); }).length;
      if (!n) return "";
      var i = zInfo(k);
      return '<button class="pille" data-filter="' + k + '" aria-pressed="' + (S.filter.indexOf(k) !== -1)
        + '" style="--sc:' + i.farbe + '">' + esc(i.wort) + '<span class="zahl">' + n + "</span></button>";
    }).join("");
    if (S.filter.length) h += '<button class="textknopf" id="filter-leeren">alle zurücksetzen</button>';
    return h;
  }

  function zeichne() {
    document.querySelectorAll(".navpunkt").forEach(function (b) {
      if (b.dataset.ziel === S.flaeche) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    });
    var name = S.flaeche === "ueberblick" ? "Überblick"
      : S.flaeche === "rohdaten" ? "Rohdaten" : (D.bereiche[S.flaeche] || S.flaeche);
    document.getElementById("titel").textContent = name;
    document.getElementById("untertitel").textContent = D.unter[S.flaeche] || "";
    document.getElementById("krume-flaeche").textContent = name;
    document.getElementById("werkzeugleiste").innerHTML = werkzeugleiste();
    document.getElementById("filterzeile").innerHTML = filterzeile();

    var liste = sortiere(sichtbar());
    document.getElementById("zaehler").textContent =
      S.flaeche === "ueberblick" || S.flaeche === "rohdaten" ? POSTEN.length + " Posten gesamt"
      : liste.length + " von " + basis().length + " sichtbar";

    var leib = document.getElementById("leib");
    leib.innerHTML = S.flaeche === "ueberblick" ? ueberblick()
      : S.flaeche === "rohdaten" ? sichtRoh()
      : S.sicht === "brett" ? sichtBrett(liste)
      : S.sicht === "tabelle" ? sichtTabelle(liste)
      : S.sicht === "zeit" ? sichtZeit(liste)
      : sichtListe(liste);

    var alt = document.querySelector(".einzel");
    if (alt) alt.remove();
    var krumeRest = document.getElementById("krume-rest");
    if (S.einzel) {
      var p = POSTEN.filter(function (x) { return x.id === S.einzel; })[0];
      if (p) {
        document.querySelector(".tafel").insertAdjacentHTML("beforeend", einzelHTML(p));
        krumeRest.innerHTML = '<span class="krume-pfeil">›</span>' + esc(p.titel);
      }
    } else krumeRest.textContent = "";
    anker();
  }

  function anker() {
    var t = [S.flaeche, S.sicht, S.gruppe, S.sortier];
    if (S.suche) t.push("q=" + encodeURIComponent(S.suche));
    if (S.filter.length) t.push("f=" + S.filter.join("+"));
    if (S.einzel) t.push("p=" + S.einzel);
    history.replaceState(null, "", "#" + t.join("/"));
  }
  function ausAnker() {
    var t = decodeURIComponent(location.hash.slice(1)).split("/");
    if (!t[0]) return;
    S.flaeche = t[0]; if (t[1]) S.sicht = t[1]; if (t[2]) S.gruppe = t[2]; if (t[3]) S.sortier = t[3];
    t.slice(4).forEach(function (x) {
      if (x.indexOf("q=") === 0) S.suche = decodeURIComponent(x.slice(2));
      if (x.indexOf("f=") === 0) S.filter = x.slice(2).split("+");
      if (x.indexOf("p=") === 0) S.einzel = x.slice(2);
    });
  }

  // --- Bedienung -------------------------------------------------------------
  document.addEventListener("click", function (e) {
    var t = e.target;
    var nav = t.closest ? t.closest(".navpunkt") : null;
    if (nav) { S.flaeche = nav.dataset.ziel; S.einzel = null; S.auswahl = -1; S.filter = []; return zeichne(); }

    var kop = t.closest ? t.closest(".kopierbar") : null;
    if (kop) {
      var txt = kop.dataset.kopie;
      var fertig = function () {
        var s = document.createElement("span");
        s.className = "kopiert"; s.textContent = "kopiert";
        kop.parentNode.insertBefore(s, kop.nextSibling);
        setTimeout(function () { s.remove(); }, 1500);
      };
      if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(txt).then(fertig, ersatz);
      else ersatz();
      function ersatz() {
        var ta = document.createElement("textarea");
        ta.value = txt; ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta); ta.select();
        try { document.execCommand("copy"); fertig(); } catch (x) { alert("Kopieren nicht möglich:\\n" + txt); }
        ta.remove();
      }
      e.stopPropagation(); return;
    }

    if (t.id === "thema") {
      var jetzt = document.documentElement.getAttribute("data-thema");
      var neu = jetzt === "dunkel" ? "hell" : jetzt === "hell" ? "" : "dunkel";
      if (neu) document.documentElement.setAttribute("data-thema", neu);
      else document.documentElement.removeAttribute("data-thema");
      try { localStorage.setItem("harness-thema", neu); } catch (x) {}
      return;
    }
    if (t.id === "einzel-zu") { S.einzel = null; return zeichne(); }
    if (t.id === "suche-leeren") { S.suche = ""; return zeichne(); }
    if (t.id === "filter-leeren") { S.filter = []; return zeichne(); }

    var si = t.closest ? t.closest("[data-sicht]") : null;
    if (si) { S.sicht = si.dataset.sicht; return zeichne(); }

    var fi = t.closest ? t.closest("[data-filter]") : null;
    if (fi) {
      var k = fi.dataset.filter, i = S.filter.indexOf(k);
      if (i === -1) S.filter.push(k); else S.filter.splice(i, 1);
      return zeichne();
    }

    var th = t.closest ? t.closest("th[data-sort]") : null;
    if (th) {
      if (S.sortier === th.dataset.sort) S.richtung = S.richtung === "ab" ? "auf" : "ab";
      else { S.sortier = th.dataset.sort; S.richtung = "ab"; }
      return zeichne();
    }

    var bk = t.closest ? t.closest(".bkarte, tbody tr") : null;
    if (bk && bk.dataset.id) { S.einzel = bk.dataset.id; return zeichne(); }

    var z = t.closest ? t.closest(".zeile") : null;
    if (z) {
      var id = z.dataset.id;
      S.offen[id] = !S.offen[id];
      S.auswahl = parseInt(z.dataset.i, 10);
      return zeichne();
    }
  });

  document.addEventListener("input", function (e) {
    if (e.target.id === "suche") { S.suche = e.target.value; var s = e.target.selectionStart; zeichne();
      var n = document.getElementById("suche"); if (n) { n.focus(); n.setSelectionRange(s, s); } }
  });
  document.addEventListener("change", function (e) {
    if (e.target.id === "sortier") { S.sortier = e.target.value; zeichne(); }
    if (e.target.id === "gruppe") { S.gruppe = e.target.value; zeichne(); }
  });

  document.addEventListener("keydown", function (e) {
    if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") {
      if (e.key === "Escape") { e.target.blur(); }
      return;
    }
    var zeilen = Array.prototype.slice.call(document.querySelectorAll(".zeile"));
    if (e.key === "/") { e.preventDefault(); var s = document.getElementById("suche"); if (s) s.focus(); return; }
    if (e.key === "Escape") { if (S.einzel) { S.einzel = null; zeichne(); } return; }
    if (e.key === "j" || e.key === "ArrowDown") { e.preventDefault(); S.auswahl = Math.min(zeilen.length - 1, S.auswahl + 1); zeichne(); scrollHin(); return; }
    if (e.key === "k" || e.key === "ArrowUp") { e.preventDefault(); S.auswahl = Math.max(0, S.auswahl - 1); zeichne(); scrollHin(); return; }
    if (e.key === "Enter" && zeilen[S.auswahl]) { S.einzel = zeilen[S.auswahl].dataset.id; zeichne(); return; }
    if ((e.key === "ArrowRight" || e.key === "ArrowLeft") && zeilen[S.auswahl]) {
      e.preventDefault();
      S.offen[zeilen[S.auswahl].dataset.id] = e.key === "ArrowRight";
      zeichne();
    }
  });
  function scrollHin() {
    var n = document.querySelector('.zeile[aria-selected="true"]');
    if (n && n.scrollIntoView) n.scrollIntoView({ block: "nearest" });
  }

  try {
    var gespeichert = localStorage.getItem("harness-thema");
    if (gespeichert) document.documentElement.setAttribute("data-thema", gespeichert);
  } catch (x) {}
  ausAnker();
  zeichne();
})();
</script>
</body>
</html>`;
}

module.exports = { renderHTML };
