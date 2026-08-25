// DIE SCHALE -- das HTML-Geruest, in das der Browser-Teil hineinzeichnet.
//
// Die Klassennamen sind KEINE freie Wahl: sie sind der Vertrag mit
// render/styles.js. Dort steht das kontrastgepruefte Aussehen, hier nur die
// Struktur. Wer hier einen Namen erfindet, bekommt eine Seite ohne Gestalt --
// gemessen am 23.08.2026: die Seitenleiste war 1040 px breit statt 240, weil
// die Schale "leiste" hiess und das CSS "seitenleiste" erwartete.
//
// Aufbau (nach dem Vorbild Paperclip-Fork / Keel Light):
//   body = Raster [Seitenleiste | Arbeitsflaeche]
//     .seitenleiste  -- grid-row 1/-1, also ueber die volle Hoehe
//     .arbeitsflaeche -- Raster [Kopfzeile | Buehne]
//       .kopfzeile   -- 48 px, Pfadleiste links
//       .buehne      -- Raster [Hauptflaeche | Detail]
// Ein einziges Skelett fuer alle Seiten.

const { css } = require("./styles.js");
const { icon } = require("./icons.js");
const W = require("./labels.js");

const esc = (s) =>
  String(s == null ? "" : s)
    .split("&").join("&amp;")
    .split("<").join("&lt;")
    .split(">").join("&gt;")
    .split('"').join("&quot;");

// Daten sicher in die Seite legen. Das </script im JSON ist der klassische
// Ausbruch: ein Dateiinhalt, der zufaellig diese Zeichenfolge traegt, wuerde
// das Skript-Element schliessen und den Rest als HTML ausliefern.
function datenBlock(daten) {
  return JSON.stringify(daten)
    .split("<").join("\\u003c")
    .split(">").join("\\u003e")
    .split(" ").join("\\u2028")
    .split(" ").join("\\u2029");
}

function navHTML(d) {
  return (d.navigation || []).map((gruppe) => {
    const kopf = gruppe.gruppe
      ? `<div class="gruppen-label">${esc(gruppe.gruppe)}</div>`
      : "";
    const punkte = (gruppe.eintraege || []).map((id) => {
      // "tab:<gruppe>" -- ein Eintrag fuer mehrere Seiten. Der Knopf springt
      // auf die erste Seite der Gruppe; welche gerade offen ist, markiert der
      // Browser-Teil (HD.navZeichnen) ueber data-seiten.
      if (id.indexOf("tab:") === 0) {
        const g = (d.tabgruppen || {})[id.slice(4)];
        if (!g) return "";
        const titel = g.ort ? `${g.name} — ${g.ort}` : g.name;
        return `<button class="nav-pille" data-ziel="${esc(g.seiten[0])}" data-seiten="${esc(g.seiten.join(" "))}" title="${esc(titel)}">
        <span class="nav-symbol">${icon(g.icon)}</span>
        <span class="nav-text">${esc(g.name)}</span>
      </button>`;
      }
      const s = d.seiten[id];
      if (!s) return "";
      const titel = s.ort ? `${s.name} — ${s.ort}` : s.name;
      // Nur "Zu tun" traegt eine Zahl: sie ist eine Handlungsaufforderung.
      // Bestandszahlen (94 Dateien) sind keine -- sie stehen auf der Seite.
      const zahl = id === "zutun" && s.anzahl > 0 ? `<span class="nav-zahl">${s.anzahl}</span>` : "";
      return `<button class="nav-pille" data-ziel="${esc(id)}" title="${esc(titel)}">
        <span class="nav-symbol">${icon(s.icon)}</span>
        <span class="nav-text">${esc(s.name)}</span>${zahl}
      </button>`;
    }).join("");
    return `<div class="nav-gruppe">${kopf}${punkte}</div>`;
  }).join("");
}

function renderHTML(daten) {
  const d = daten;
  const U = W.UI;

  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(d.workspace)} — Harness</title>
<style>${css}</style>
<script>
// Thema VOR dem ersten Zeichnen setzen, sonst blitzt Hell auf, bevor Dunkel
// greift. Der Schluessel traegt einen Praefix aus der Wurzel: unter file://
// teilen sich alle lokalen Seiten einen Ursprung, und ohne Praefix wuerde das
// Dashboard eines anderen Ordners dieselben Einstellungen ueberschreiben.
(function () {
  try {
    var p = "hd:" + ${JSON.stringify(String(d.wurzel || "").replace(/[^a-zA-Z0-9]/g, "").slice(-16))} + ":";
    window.__hdPraefix = p;
    var t = localStorage.getItem(p + "thema");
    if (t === "hell" || t === "dunkel") document.documentElement.setAttribute("data-thema", t);
    if (localStorage.getItem(p + "leiste") === "schmal") document.documentElement.setAttribute("data-leiste-start", "eingeklappt");
  } catch (e) { /* localStorage gesperrt -- dann eben Systemthema */ }
})();
</script>
</head>
<body>
<a class="nur-vorleser" href="#hauptflaeche">${esc(U.zumInhalt)}</a>

<aside class="seitenleiste" aria-label="${esc(U.eigenschaften)}">
  <div class="leiste-kopf">
    <span class="eintrag-kachel" aria-hidden="true">${esc(String(d.workspace || "?").charAt(0).toUpperCase())}</span>
    <span class="leiste-name" title="${esc(d.wurzel)}">${esc(d.workspace)}</span>
    <button class="ikon-knopf" id="palette-auf" aria-label="${esc(U.befehlspalette)}" title="${esc(U.befehlspalette)} (Strg+K)">${icon("search")}</button>
    <button class="ikon-knopf" id="leiste-klapp" aria-label="${esc(U.seitenleisteEin)}" title="${esc(U.seitenleisteEin)} (Strg+B)">${icon("panel-left-close")}</button>
  </div>
  <nav class="leiste-nav">${navHTML(d)}</nav>
  <div class="leiste-fuss">
    <button class="leiste-knopf" id="thema" aria-label="${esc(U.thema)}">
      <span id="thema-symbol">${icon("monitor")}</span><span id="thema-wort">${esc(U.themaSystem)}</span>
    </button>
    <button class="leiste-knopf leiste-leise" data-ziel="rohdaten" title="${esc(d.seiten.rohdaten ? d.seiten.rohdaten.name + " — " + (d.seiten.rohdaten.ort || "") : "")}">
      ${icon("braces")}<span>${esc(d.seiten.rohdaten ? d.seiten.rohdaten.name : "")}</span>
    </button>
  </div>
</aside>

<div class="arbeitsflaeche">
  <header class="kopfzeile">
    <nav class="pfadleiste" id="pfadleiste" aria-label="${esc(U.pfad)}"></nav>
    <div class="seiten-aktion"><span class="treffer-zahl" id="zaehler" aria-live="polite"></span>
      <span class="mess-zeit"><span>${esc(U.gemessenAm)}</span> <span class="mono">${esc(d.gemessenText)}</span></span>
      <button class="knopf-haupt" id="neu-messen" title="${esc(U.neuMessen)}">${icon("refresh")}<span>${esc(U.neuMessen)}</span></button>
    </div>
  </header>

  <div class="buehne">
    <main class="hauptflaeche" id="hauptflaeche" tabindex="-1"></main>
    <aside class="detail" id="detail" aria-label="${esc(U.eigenschaften)}" hidden>
      <div class="griff" id="griff" role="separator" aria-orientation="vertical"
           aria-label="${esc(U.eigenschaften)}" tabindex="0"></div>
      <div class="detail-koerper" id="detail-koerper"></div>
    </aside>
  </div>
</div>

<div class="palette-schleier" id="palette" hidden>
  <div class="palette" role="dialog" aria-modal="true" aria-label="${esc(U.befehlspalette)}">
    <div class="palette-eingabe">
      ${icon("search")}
      <input id="palette-feld" type="text" autocomplete="off" spellcheck="false"
             placeholder="${esc(U.suchen)} …" aria-label="${esc(U.suchen)}">
      <kbd>Esc</kbd>
    </div>
    <div class="palette-liste" id="palette-liste" role="listbox"></div>
  </div>
</div>

<div class="meldung" id="meldung" role="status" aria-live="polite"></div>

<script id="daten" type="application/json">${datenBlock(d)}</script>
<script>
${require("./client/core.js").quelltext}
${require("./client/pages.js").quelltext}
${require("./client/detail.js").quelltext}
${require("./client/bridge.js").quelltext}
${require("./client/start.js").quelltext}
</script>
</body>
</html>`;
}

module.exports = { renderHTML, esc, datenBlock };
