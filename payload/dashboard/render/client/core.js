// BROWSER-TEIL 1 von 4: Zustand, Adresse, Ereignisse, Werkzeuge.
//
// Der Inhalt dieser Datei laeuft NICHT in Node -- er wird als Zeichenkette in
// die erzeugte Seite geschrieben. Deshalb: kein require, kein module, keine
// Backticks (die wuerden die Zusammensetzung in shell.js zerlegen), und alles
// haengt an einem einzigen globalen Objekt HD, damit die vier Teile sich
// gegenseitig finden, ohne dass ein Bauwerkzeug noetig waere.

const quelltext = `
"use strict";
var HD = window.HD = {};

// --- Daten ---------------------------------------------------------------
HD.D = JSON.parse(document.getElementById("daten").textContent);
HD.W = HD.D.worte;

// --- Zustand -------------------------------------------------------------
// EIN Objekt. Jede Ansicht liest daraus, keine haelt einen eigenen Stand --
// sonst zeigt die Suche etwas anderes als die Liste.
HD.S = {
  seite: "ueberblick",
  auswahl: null,      // Kennung des offenen Eintrags
  suche: "",
  filter: [],         // Status-Codes
  gruppiert: true,
  ansicht: "liste",   // nur auf "zu tun" auch "board"
  baumOffen: {},      // Pfad -> true
  baumDatei: null,
  abschnitt: {},      // Detail-Abschnitt -> offen?
  vollbild: false,
  quelltext: {},      // Dateipfad -> true (Quelltext statt gerendert)
  breite: 320,
  palette: false,
};

// --- Speicher (mit Praefix, siehe shell.js) ------------------------------
HD.merken = function (schluessel, wert) {
  try { localStorage.setItem((window.__hdPraefix || "hd:") + schluessel, String(wert)); } catch (e) {}
};
HD.geholt = function (schluessel, ersatz) {
  try {
    var v = localStorage.getItem((window.__hdPraefix || "hd:") + schluessel);
    return v === null ? ersatz : v;
  } catch (e) { return ersatz; }
};

// --- Werkzeuge -----------------------------------------------------------
HD.esc = function (s) {
  return String(s == null ? "" : s)
    .split("&").join("&amp;").split("<").join("&lt;")
    .split(">").join("&gt;").split('"').join("&quot;");
};

HD.el = function (html) {
  var t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
};

// Text einer Suche hervorheben -- escaped, dann markiert. Andersherum waere es
// eine Luecke: wer nach "<script" sucht, bekaeme sonst genau das.
HD.markiere = function (text, suche) {
  var roh = HD.esc(text);
  if (!suche) return roh;
  var i = String(text).toLowerCase().indexOf(suche.toLowerCase());
  if (i < 0) return roh;
  var a = HD.esc(String(text).slice(0, i));
  var b = HD.esc(String(text).slice(i, i + suche.length));
  var c = HD.esc(String(text).slice(i + suche.length));
  return a + "<mark>" + b + "</mark>" + c;
};

// statusChip steht in pages.js, bei den uebrigen Zeichenfunktionen.

// Symbole liegen als fertige SVG in den Daten -- der Browser baut keine.
// Der Name wird auf dieselbe Weise vereinfacht wie beim Ablegen, damit
// "file-text", "FileText" und "filetext" dasselbe Symbol treffen. Ohne das
// blieben 35 Kaesten im Dateibaum leer, und ein leerer Kasten sieht aus wie
// ein Fehler, nicht wie eine Datei.
HD.icon = function (name) {
  if (!name || !HD.D.icons) return "";
  var k = String(name).toLowerCase().replace(/[^a-z0-9]/g, "");
  return HD.D.icons[name] || HD.D.icons[k] || HD.D.icons.circle || "";
};

HD.melden = function (text) {
  var m = document.getElementById("meldung");
  m.textContent = text;
  m.classList.add("sichtbar");
  clearTimeout(HD._meldeUhr);
  HD._meldeUhr = setTimeout(function () {
    m.classList.remove("sichtbar");
    // Auch den Text raeumen: die Klasse allein blendet nur aus, der Inhalt
    // blieb im Vorleser-Bereich stehen und wurde beim naechsten Mal doppelt
    // angesagt.
    m.textContent = "";
  }, 1500);
};

HD.kopieren = function (text) {
  function fertig(ok) { HD.melden(ok ? HD.W.kopiert : HD.W.kopierenFehlgeschlagen); }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(function () { fertig(true); }, function () { HD.kopierenAlt(text, fertig); });
  } else {
    HD.kopierenAlt(text, fertig);
  }
};
// Unter file:// ist die Zwischenablage haeufig gesperrt. Ohne diesen Weg
// meldet der Knopf "kopiert" und nichts liegt in der Ablage.
HD.kopierenAlt = function (text, fertig) {
  try {
    var f = document.createElement("textarea");
    f.value = text;
    f.style.position = "fixed";
    f.style.opacity = "0";
    document.body.appendChild(f);
    f.select();
    var ok = document.execCommand("copy");
    document.body.removeChild(f);
    fertig(ok);
  } catch (e) { fertig(false); }
};

// --- Eintraege -----------------------------------------------------------
HD.eintragMit = function (id) {
  for (var i = 0; i < HD.D.eintraege.length; i++) {
    if (HD.D.eintraege[i].id === id) return HD.D.eintraege[i];
  }
  return null;
};

HD.seitenEintraege = function (seite) {
  return HD.D.eintraege.filter(function (e) { return e.seite === seite; });
};

// Suche ueber Name, Pfad, Beschreibung und die Listenfelder -- nicht nur ueber
// den Namen. Wer "exit 2" sucht, meint die Wirkung, nicht den Dateinamen.
HD.passt = function (e, suche) {
  if (!suche) return true;
  var q = suche.toLowerCase();
  var teile = [e.name, e.pfad, e.unter, e.artWort];
  if (e.beschreibung && e.beschreibung.text) teile.push(e.beschreibung.text);
  for (var i = 0; i < (e.liste || []).length; i++) teile.push(e.liste[i].wert);
  for (var j = 0; j < (e.felder || []).length; j++) teile.push(e.felder[j].wert);
  for (var k = 0; k < teile.length; k++) {
    if (teile[k] && String(teile[k]).toLowerCase().indexOf(q) >= 0) return true;
  }
  return false;
};

HD.gefiltert = function (seite) {
  var liste = HD.seitenEintraege(seite).filter(function (e) { return HD.passt(e, HD.S.suche); });
  if (HD.S.filter.length) {
    liste = liste.filter(function (e) { return HD.S.filter.indexOf(e.status) >= 0; });
  }
  return liste;
};

// --- Adresse -------------------------------------------------------------
// Der Zustand steht in der Adresse, damit ein Neuladen nichts verliert und ein
// Link jemand anderem dasselbe zeigt.
HD.adresseSchreiben = function (ersetzen) {
  var t = [HD.S.seite];
  if (HD.S.seite === "dateien" && HD.S.baumDatei) t.push(HD.S.baumDatei);
  else if (HD.S.auswahl) t.push(HD.S.auswahl);
  var frage = [];
  if (HD.S.suche) frage.push("q=" + encodeURIComponent(HD.S.suche));
  if (HD.S.filter.length) frage.push("f=" + encodeURIComponent(HD.S.filter.join(",")));
  if (HD.S.ansicht !== "liste") frage.push("v=" + HD.S.ansicht);
  var neu = "#" + t.map(encodeURIComponent).join("/") + (frage.length ? "?" + frage.join("&") : "");
  if (location.hash === neu) return;
  if (ersetzen) history.replaceState(null, "", neu);
  else history.pushState(null, "", neu);
};

HD.adresseLesen = function () {
  var roh = location.hash.replace(/^#/, "");
  if (!roh) return false;
  var teile = roh.split("?");
  var weg = teile[0].split("/").map(decodeURIComponent);
  var frage = new URLSearchParams(teile[1] || "");
  if (weg[0] && HD.D.seiten[weg[0]]) HD.S.seite = weg[0];
  HD.S.suche = frage.get("q") || "";
  HD.S.filter = frage.get("f") ? frage.get("f").split(",") : [];
  HD.S.ansicht = frage.get("v") || "liste";
  var rest = weg.slice(1).join("/");
  if (HD.S.seite === "dateien") {
    HD.S.baumDatei = rest || null;
    HD.S.auswahl = rest ? "datei:" + rest : null;
    if (rest) HD.ahnenOeffnen(rest);
  } else {
    HD.S.auswahl = rest || null;
  }
  return true;
};

// Beim Sprung auf eine tiefe Datei muessen ihre Ordner offen sein -- sonst
// zeigt der Baum die Auswahl nicht, und der Link wirkt kaputt.
HD.ahnenOeffnen = function (pfad) {
  var teile = String(pfad).split("/");
  var weg = "";
  for (var i = 0; i < teile.length - 1; i++) {
    weg = weg ? weg + "/" + teile[i] : teile[i];
    HD.S.baumOffen[weg] = true;
  }
};

// --- Zeichnen ------------------------------------------------------------
HD.zeichnen = function () {
  HD.pfadleisteZeichnen();
  HD.navZeichnen();
  HD.seiteZeichnen();
  HD.detailZeichnen();
  HD.zaehlerZeichnen();
};

HD.navZeichnen = function () {
  var knoepfe = document.querySelectorAll(".navpunkt");
  for (var i = 0; i < knoepfe.length; i++) {
    var aktiv = knoepfe[i].dataset.ziel === HD.S.seite;
    if (aktiv) knoepfe[i].setAttribute("aria-current", "page");
    else knoepfe[i].removeAttribute("aria-current");
    knoepfe[i].setAttribute("aria-selected", aktiv ? "true" : "false");
  }
};

HD.pfadleiste = [];
HD.pfadleisteZeichnen = function () {
  var s = HD.D.seiten[HD.S.seite];
  var stuecke = [
    { wort: HD.D.workspace, ziel: "ueberblick", titel: HD.D.wurzel },
    { wort: s ? s.name : HD.S.seite, ziel: HD.S.seite },
  ];
  if (HD.S.seite === "dateien" && HD.S.baumDatei) {
    var teile = HD.S.baumDatei.split("/");
    var weg = "";
    for (var i = 0; i < teile.length; i++) {
      weg = weg ? weg + "/" + teile[i] : teile[i];
      stuecke.push({ wort: teile[i], ziel: "dateien", pfad: weg, letztes: i === teile.length - 1 });
    }
  } else if (HD.S.auswahl) {
    var e = HD.eintragMit(HD.S.auswahl);
    if (e) stuecke.push({ wort: e.name, letztes: true });
  }
  document.getElementById("pfadleiste").innerHTML = stuecke.map(function (st, i) {
    var inhalt = HD.esc(st.wort);
    var titel = st.titel ? ' title="' + HD.esc(st.titel) + '"' : "";
    var teil = st.letztes
      ? '<span class="pfad-teil" aria-current="page"' + titel + '>' + inhalt + "</span>"
      : '<button class="pfad-teil pfad-knopf" data-pfadziel="' + HD.esc(st.ziel || "") + '"'
        + (st.pfad ? ' data-pfadpfad="' + HD.esc(st.pfad) + '"' : "") + titel + ">" + inhalt + "</button>";
    return (i ? '<span class="pfad-pfeil" aria-hidden="true">/</span>' : "") + teil;
  }).join("");
};

HD.zaehlerZeichnen = function () {
  var z = document.getElementById("zaehler");
  if (HD.S.seite === "dateien" || HD.S.seite === "ueberblick" || HD.S.seite === "rohdaten") { z.textContent = ""; return; }
  var alle = HD.seitenEintraege(HD.S.seite).length;
  var jetzt = HD.gefiltert(HD.S.seite).length;
  z.textContent = jetzt === alle ? "" : HD.W.vonSichtbar.replace("{x}", jetzt).replace("{y}", alle);
};

// --- Umschalten ----------------------------------------------------------
HD.zurSeite = function (id) {
  if (!HD.D.seiten[id]) return;
  HD.S.seite = id;
  HD.S.auswahl = null;
  HD.S.suche = "";
  HD.S.filter = [];
  HD.S.ansicht = "liste";
  HD.S.vollbild = false;
  HD.adresseSchreiben(false);
  HD.zeichnen();
  document.getElementById("hauptflaeche").scrollTop = 0;
};

HD.oeffnen = function (id) {
  var e = HD.eintragMit(id);
  if (!e) return;
  if (e.seite !== HD.S.seite) {
    HD.S.seite = e.seite;
    HD.S.suche = "";
    HD.S.filter = [];
  }
  if (e.seite === "dateien") HD.dateiWaehlen(e.pfad);
  else { HD.S.auswahl = id; HD.adresseSchreiben(false); HD.zeichnen(); }
};

HD.dateiWaehlen = function (pfad) {
  HD.S.seite = "dateien";
  HD.S.baumDatei = pfad;
  HD.S.auswahl = pfad ? "datei:" + pfad : null;
  if (pfad) HD.ahnenOeffnen(pfad);
  HD.adresseSchreiben(false);
  HD.zeichnen();
};

HD.schliessen = function () {
  if (HD.S.vollbild) { HD.S.vollbild = false; HD.zeichnen(); return true; }
  if (HD.S.auswahl) {
    HD.S.auswahl = null;
    if (HD.S.seite === "dateien") HD.S.baumDatei = null;
    HD.adresseSchreiben(false);
    HD.zeichnen();
    return true;
  }
  if (HD.S.suche) { HD.S.suche = ""; HD.adresseSchreiben(true); HD.zeichnen(); return true; }
  return false;
};
`;

module.exports = { quelltext };
