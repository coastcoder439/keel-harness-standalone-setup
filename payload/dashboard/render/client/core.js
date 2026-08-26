// BROWSER-TEIL 1 von 5: Zustand, Adresse, Ereignisse, Werkzeuge.
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
  // Der Editor: welcher Pfad gerade bearbeitet wird, der Entwurf und der
  // Stand beim Oeffnen (fuer die Rueckfrage beim Abbrechen).
  bearbeitet: null,
  entwurf: null,
  entwurfStart: null,
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

// Platzhalter in einem Wort ersetzen. Dieselbe Regel wie in labels.js: ein
// Platzhalter, der nicht gefuellt wird, bleibt SICHTBAR stehen -- er verraet
// dem Leser, dass hier etwas fehlt, statt es zu verschweigen.
HD.fuellen = function (vorlage, werte) {
  return String(vorlage == null ? "" : vorlage).replace(/{([a-zA-Z]+)}/g, function (ganz, name) {
    return Object.prototype.hasOwnProperty.call(werte || {}, name) ? String(werte[name]) : ganz;
  });
};

// KEIN ROHER WERKZEUG-AUSDRUCK IM INTERFACE [Kritik-Runde 2, Problem 8].
// Arbeitspaket-Titel kommen aus Markdown-Dateien und standen woertlich auf den
// Karten: sichtbare Sternchen, offene Anfuehrungszeichen, "·"-Ketten, Fussnoten
// in eckigen Klammern. Das las sich nicht als Interface, sondern als Datei-Dump
// mit einem Rahmen darum -- der staerkste einzelne Grund, warum die Flaeche wie
// Werkzeug-Ausgabe wirkte und nicht wie ein Produkt.
//
// Diese Funktion nimmt die Auszeichnung heraus, statt sie zu rendern: auf einer
// einzeiligen Karte hilft Fettdruck nicht, er stoert nur.
HD.klartext = function (text) {
  var s = String(text == null ? "" : text);
  // Code-Zeichen. Der Backtick steht als Zeichenklasse [\\x60] da, nicht als
  // Zeichen: dieser Modultext lebt selbst in einem Template-Literal, und die
  // Klasse haelt ausserdem den Namens-Test davon ab, "x60(" fuer einen
  // Funktionsaufruf zu halten.
  s = s.replace(/[\\x60]([^\\x60]+)[\\x60]/g, "$1");
  s = s.replace(/\\*\\*([^*]+)\\*\\*/g, "$1");      // fett
  s = s.replace(/(^|\\s)\\*([^*]+)\\*/g, "$1$2");  // kursiv (nicht mitten im Wort)
  s = s.replace(/\\[([^\\]]+)\\]\\([^)]*\\)/g, "$1"); // Verweise -> nur der Text
  s = s.replace(/^#+\\s*/, "");                   // Ueberschriftszeichen
  s = s.replace(/^[-*+]\\s+/, "");                // Listenzeichen
  // BELEGKLAMMERN GEHOEREN INS DOKUMENT, NICHT AUF DIE KARTE. Arbeitspakete
  // tragen ihre Quelle woertlich im Titel ("[Owner, woertlich: ...]") -- auf
  // einer Karte ist das ein Zitat ohne Zusammenhang, das den eigentlichen Satz
  // aus dem sichtbaren Bereich schiebt und mitten im Wort abbricht.
  s = s.replace(/\\s*\\[[^\\]]*$/, "");             // angefangene Klammer am Ende
  s = s.replace(/\\s*\\[(Owner|Kritiker|Befund|Quelle)[^\\]]*\\]/gi, "");
  return s.replace(/\\s+/g, " ").trim();
};

// EINE ZEILE HEISST EINE ZEILE [Kritik-Runde 2, Problem 8]. Vorher brachen
// Kartentitel mitten im Wort ab ('[Owner, woertlich: "userfreundlich,') --
// weil niemand entschied, wie lang ein Titel sein darf. Gekappt wird am
// Wortende, mit echtem Auslassungszeichen; der volle Text steht im Dokument,
// das die Karte oeffnet.
HD.aufEineZeile = function (text, hoechstens) {
  var s = HD.klartext(text);
  var max = hoechstens || 72;
  if (s.length <= max) return s;
  var kurz = s.slice(0, max).replace(/[\\s.,;:·\\-–—]+\\S*$/, "");
  return (kurz || s.slice(0, max)) + " …";
};

// Zeitpunkt fuer die Anzeige: Uhrzeit wenn heute, sonst Datum -- ueber Intl,
// nicht ueber String-Zerlegung eines fertigen Datumstextes (die bricht, sobald
// die Laufzeit das Trennzeichen aendert). Ohne lesbaren Wert: ehrlicher Strich.
HD.zeitpunkt = function (iso) {
  if (!iso) return "—";
  var d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  var heute = new Date();
  var gleicherTag = d.getFullYear() === heute.getFullYear()
    && d.getMonth() === heute.getMonth() && d.getDate() === heute.getDate();
  try {
    return gleicherTag
      ? new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" }).format(d)
      : new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit" }).format(d);
  } catch (e) {
    return "—";
  }
};

// Kommt die Seite von einem Server oder liegt sie als Datei vor? Davon haengt
// ab, ob ueberhaupt etwas geaendert werden kann: als Datei geoeffnet gibt es
// niemanden, der zurueckschreiben koennte -- ein Bearbeiten-Knopf waere dann
// eine Luege. Wer die Seite weitergibt, gibt keinen Schreibzugang mit.
HD.serverModus = function () {
  return location.protocol === "http:" || location.protocol === "https:";
};

// Welche Dateien lassen sich hier bearbeiten. Dieselbe Liste wie im Server --
// der prueft noch einmal; hier geht es nur darum, keinen Knopf anzubieten, der
// danach abgelehnt wird.
HD.bearbeitbar = function (pfad) {
  if (!pfad) return false;
  if (pfad === "dashboard.html" || pfad === "dashboard.json") return false;
  // ACHTUNG, Backslash: dieser Text steht in einem Template-Literal und wird
  // beim Auslesen einmal aufgeloest -- ein einfaches \\. kommt im Browser als
  // blosser Punkt an, und aus /(^|\\/)/ wird /(^|/)/ mit unbalancierter
  // Klammer. Deshalb hier ueberall DOPPELT. Der Syntaxtest in
  // test/client.test.js faengt es, wenn es vergessen wird.
  if (/(^|\\/)settings\\.local\\.json$|(^|\\/)\\.env($|\\.)|\\.key$|\\.pem$/i.test(pfad)) return false;
  return /\\.(md|txt|json|js|mjs|cjs|css|html|yml|yaml)$|(^|\\/)\\.gitignore$/i.test(pfad);
};

// Speichern gegen den Vorschau-Server. Danach wird neu gemessen, sonst zeigt
// die Seite den alten Stand und behauptet, er sei aktuell.
HD.speichern = function (pfad, text) {
  var feld = document.getElementById("editor-feld");
  if (feld) feld.disabled = true;
  // Das Neu-Messen dauert je nach Groesse des Workspace mehrere Sekunden. Ohne
  // Ansage sieht ein totes Textfeld aus wie ein Absturz.
  HD.melden(HD.W.wirdGespeichert, true);
  fetch("/datei?pfad=" + encodeURIComponent(pfad), {
    method: "PUT",
    headers: { "content-type": "text/plain; charset=utf-8" },
    body: text,
  })
    .then(function (a) { return a.json().then(function (j) { return { ok: a.ok, j: j }; }); })
    .then(function (r) {
      if (!r.ok) throw new Error((r.j && r.j.fehler) || "unbekannt");
      HD.melden(HD.W.wirdGemessen, true);
      HD.S.bearbeitet = null;
      HD.S.entwurf = null;
      return fetch("/neu-messen", { method: "POST" });
    })
    .then(function (a) {
      if (a && a.ok) location.reload();
    })
    .catch(function (e) {
      if (feld) feld.disabled = false;
      // Die einzige Frage, die der Nutzer jetzt hat, ist NICHT der Fehlercode --
      // es ist "ist mein Text weg?". Der Entwurf steht noch im Feld, und genau
      // das sagt die Meldung [Kritik-Runde 2, Problem 2].
      HD.meldenFehler(
        HD.fuellen(HD.W.speichernFehlgeschlagen, { grund: e.message }),
        null,
        HD.W.entwurfStehtNoch
      );
    });
};

// EIN ERFOLG DARF VERGEHEN, EIN FEHLER NICHT [Kritik-Runde 2, Problem 2]:
// vorher lief BEIDES durch dieselbe 1,5-Sekunden-Blende. Wer in dem Moment
// wegsah, erfuhr nie, dass sein Speichern oder sein Auftrag fehlgeschlagen war
// -- und die Oberflaeche sah danach exakt aus wie im Erfolgsfall.
//
//   HD.melden(text)             Erfolg/Hinweis, blendet nach 1,5 s aus
//   HD.melden(text, "bleiben")  laufender Vorgang, bleibt bis zur naechsten
//   HD.melden(text, "fehler")   FEHLER: bleibt stehen, bis er weggeklickt wird
//
// Der alte zweite Parameter war ein boolean; true bedeutete "bleiben". Beides
// wird weiter verstanden, damit kein Aufrufer stillschweigend die Bedeutung
// wechselt.
HD.melden = function (text, art) {
  var m = document.getElementById("meldung");
  var istFehler = art === "fehler";
  var bleibt = istFehler || art === "bleiben" || art === true;
  clearTimeout(HD._meldeUhr);

  m.classList.toggle("meldung-fehler", istFehler);
  // Ein Fehler wird ANGESAGT, nicht beilaeufig gemeldet: assertive unterbricht
  // den Vorleser, polite wartet -- und ein verlorener Text wartet nicht.
  m.setAttribute("aria-live", istFehler ? "assertive" : "polite");
  m.setAttribute("role", istFehler ? "alert" : "status");

  if (istFehler) {
    // Ein Fehler ohne Ausweg ist eine Sackgasse: er bekommt einen Knopf, der
    // ihn schliesst -- sonst muesste man die Seite neu laden, um ihn loszuwerden.
    m.innerHTML = '<span class="meldung-text"></span>'
      + '<button class="meldung-zu" type="button" aria-label="' + HD.esc(HD.W.schliessen)
      + '" title="' + HD.esc(HD.W.schliessen) + '">' + HD.icon("schliessen") + "</button>";
    m.querySelector(".meldung-text").textContent = text;
  } else {
    m.textContent = text;
  }
  m.classList.add("sichtbar");

  if (bleibt) return;
  HD._meldeUhr = setTimeout(function () {
    m.classList.remove("sichtbar");
    // Auch den Text raeumen: die Klasse allein blendet nur aus, der Inhalt
    // blieb im Vorleser-Bereich stehen und wurde beim naechsten Mal doppelt
    // angesagt.
    m.textContent = "";
  }, 1500);
};

// Eine Fehlermeldung beantwortet DREI Fragen [Kritik-Runde 2]: was ist schief
// gegangen, was ist mit meinen Daten, was tue ich jetzt. Ein blosses
// "Nicht gespeichert: EACCES" beantwortet keine davon.
HD.meldenFehler = function (was, grund, datenZustand) {
  var teile = [was];
  if (grund) teile.push(String(grund));
  if (datenZustand) teile.push(datenZustand);
  HD.melden(teile.join(" · "), "fehler");
};

HD.meldungSchliessen = function () {
  var m = document.getElementById("meldung");
  if (!m) return;
  clearTimeout(HD._meldeUhr);
  m.classList.remove("sichtbar", "meldung-fehler");
  m.textContent = "";
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
  // Dateirumpf steht nicht mehr im Datensatz -- die eben gezeichneten
  // Platzhalter holen ihn jetzt beim Server nach. Ohne Server bleibt der
  // Platzhalter mit seinem Hinweis stehen.
  if (HD.inhaltLaden) HD.inhaltLaden();
};

HD.navZeichnen = function () {
  var knoepfe = document.querySelectorAll(".nav-pille");
  for (var i = 0; i < knoepfe.length; i++) {
    // Ein Tab-Gruppen-Knopf (data-seiten) ist aktiv, sobald IRGENDEINE seiner
    // Seiten offen ist -- der Nutzer sieht dann am Menue, wo er sich befindet,
    // auch wenn er innerhalb der Reiter wechselt.
    var seiten = (knoepfe[i].dataset.seiten || knoepfe[i].dataset.ziel || "").split(" ");
    var aktiv = seiten.indexOf(HD.S.seite) >= 0;
    if (aktiv) knoepfe[i].setAttribute("aria-current", "page");
    else knoepfe[i].removeAttribute("aria-current");
  }
};

HD.pfadleiste = [];
// EIN DING, EIN NAME [Kritik-Runde 2, Problem 7]. Vorher hiess dieselbe Stelle
// gleichzeitig "Projekte" (Navigation), "Zu tun" (Krume), "Zu tun" (Reiter) und
// "ARBEITSPAKETE" (Abschnitt) -- drei Navigationsebenen in aehnlichem Grau, die
// sich widersprachen. Der Nutzer konnte seinen eigenen Standort nicht bestimmen.
//
// Seit die Seite eine <h1> traegt, sagt die Krume auf einer Listenseite nichts,
// was der Titel nicht schon sagt. Sie erscheint deshalb nur noch, wenn sie mehr
// weiss: ein Dateipfad oder ein ausgewaehlter Eintrag. Dann ist sie ein Weg,
// vorher war sie eine dritte Meinung.
HD.pfadleisteZeichnen = function () {
  var s = HD.D.seiten[HD.S.seite];
  var tiefer = (HD.S.seite === "dateien" && HD.S.baumDatei) || HD.S.auswahl;
  if (!tiefer) { document.getElementById("pfadleiste").innerHTML = ""; return; }
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
    // Datei- und Ordnernamen sind PFADE: nie versalisiert (aus "CLAUDE.md"
    // wuerde "CLAUDE.MD" -- ein anderer Name). Nur der Seitenname traegt die
    // Versalien-Auszeichnung der letzten Krume.
    var datei = (st.pfad || st.dateiname) ? ' data-datei="ja"' : "";
    var teil = st.letztes
      ? '<span class="pfad-teil" aria-current="page"' + datei + titel + '>' + inhalt + "</span>"
      : '<button class="pfad-teil pfad-knopf" data-pfadziel="' + HD.esc(st.ziel || "") + '"'
        + (st.pfad ? ' data-pfadpfad="' + HD.esc(st.pfad) + '"' : "") + datei + titel + ">" + inhalt + "</button>";
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
// EIN OFFENER ENTWURF WIRD NICHT LAUTLOS UEBERFAHREN [Kritik-Runde 2, Problem 1].
// Jeder Weg, der den Editor verlaesst, fragt zuerst -- vorher tat das allein der
// Abbrechen-Knopf, waehrend Navigation, Dateiwechsel und Zurueck-Taste den
// getippten Text kommentarlos verwarfen. Rueckgabe true heisst "weiter".
HD.entwurfFreigeben = function () {
  if (HD.S.bearbeitet == null) return true;
  var feld = document.getElementById("editor-feld");
  var jetzt = feld ? feld.value : HD.S.entwurf;
  var geaendert = HD.S.entwurfStart != null && jetzt != null && jetzt !== HD.S.entwurfStart;
  if (!geaendert) return true;
  if (!confirm(HD.W.ungespeichert)) return false;
  HD.S.bearbeitet = null;
  HD.S.entwurf = null;
  HD.S.entwurfStart = null;
  return true;
};

HD.zurSeite = function (id) {
  if (!HD.D.seiten[id]) return;
  if (!HD.entwurfFreigeben()) return;
  // SUCHE UND FILTER GEHOEREN ZUR SEITE, NICHT ZUM KLICK [Kritik-Runde 2,
  // Problem 1]: vorher loeschte JEDER Navigationsklick beides -- auch der
  // Wechsel zwischen zwei Reitern DERSELBEN Gruppe und der Weg zurueck. Wer
  // auf "Hooks" gesucht, kurz nach "Regeln" geschaut und zurueckgeklickt hat,
  // fing von vorne an. Jetzt merkt sich jede Seite ihren eigenen Stand.
  HD.S.seitenStand = HD.S.seitenStand || {};
  if (HD.S.seite && HD.S.seite !== id) {
    HD.S.seitenStand[HD.S.seite] = { suche: HD.S.suche, filter: HD.S.filter, ansicht: HD.S.ansicht };
  }
  var alt = HD.S.seitenStand[id] || {};
  HD.S.seite = id;
  HD.S.auswahl = null;
  HD.S.suche = alt.suche || "";
  HD.S.filter = alt.filter || [];
  HD.S.ansicht = alt.ansicht || "liste";
  HD.S.vollbild = false;
  HD.adresseSchreiben(false);
  HD.zeichnen();
  document.getElementById("hauptflaeche").scrollTop = 0;
};

HD.oeffnen = function (id) {
  var e = HD.eintragMit(id);
  if (!e) return;
  if (!HD.entwurfFreigeben()) return;
  if (e.seite !== HD.S.seite) {
    // Denselben Seitenstand merken wie HD.zurSeite -- sonst waere der Sprung
    // aus der Befehlspalette das eine Schlupfloch, das die Suche doch loescht.
    HD.S.seitenStand = HD.S.seitenStand || {};
    if (HD.S.seite) {
      HD.S.seitenStand[HD.S.seite] = { suche: HD.S.suche, filter: HD.S.filter, ansicht: HD.S.ansicht };
    }
    var vor = HD.S.seitenStand[e.seite] || {};
    HD.S.seite = e.seite;
    HD.S.suche = vor.suche || "";
    HD.S.filter = vor.filter || [];
  }
  if (e.seite === "dateien") HD.dateiWaehlen(e.pfad);
  else { HD.S.auswahl = id; HD.adresseSchreiben(false); HD.zeichnen(); }
};

HD.dateiWaehlen = function (pfad) {
  if (!HD.entwurfFreigeben()) return;
  HD.S.seite = "dateien";
  HD.S.baumDatei = pfad;
  HD.S.auswahl = pfad ? "datei:" + pfad : null;
  if (pfad) HD.ahnenOeffnen(pfad);
  HD.adresseSchreiben(false);
  HD.zeichnen();
};

HD.schliessen = function () {
  if (HD.S.vollbild) { HD.S.vollbild = false; HD.zeichnen(); return true; }
  // Escape mit offenem Editor: erst fragen. Sonst raeumt die Taste, die man
  // druecken WILL, um ein Panel loszuwerden, den getippten Text mit weg.
  if (HD.S.bearbeitet != null && !HD.entwurfFreigeben()) return true;
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
