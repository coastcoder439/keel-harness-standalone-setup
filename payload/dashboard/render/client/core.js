// BROWSER-TEIL 1 von 6: Zustand, Adresse, Ereignisse, Werkzeuge.
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
  // Das Dokument im rechten Panel [Owner-Wunsch W8, Slice 4]. Unabhaengig von
  // der Seite und von HD.S.auswahl: alles Datei-artige -- Arbeitspaket, Hook,
  // Regel, Befehl, Datei -- oeffnet DIESELBE volle Ansicht, ohne dass der
  // Klick den Nutzer aus seinem Zusammenhang wirft.
  dokument: null,
  // Ein Filter der Projekt-Karten (Sitzung / offene Pakete / Sicherungsluecke).
  projektFilter: null,
  // Welcher Reiter der Projektseite offen ist.
  projektReiter: "pakete",
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

// ZUSTAND UEBER EIN NEULADEN RETTEN [Kritik-Runde 2, Problem 1]. Nach dem
// Speichern muss die Seite neu laden -- sie traegt ihren Datensatz eingebettet,
// und der ist nach dem Neumessen veraltet. Was der NUTZER aufgebaut hat, ist
// davon aber unberuehrt: welche Bloecke offen sind, welcher Ordner aufgeklappt
// ist, wonach er sucht, wo er stand. sessionStorage, nicht localStorage: das
// gilt fuer diesen einen Neuladevorgang, nicht fuer alle Zeit.
HD.zustandRetten = function () {
  try {
    sessionStorage.setItem((window.__hdPraefix || "hd:") + "rettung", JSON.stringify({
      seite: HD.S.seite,
      auswahl: HD.S.auswahl,
      suche: HD.S.suche,
      filter: HD.S.filter,
      ansicht: HD.S.ansicht,
      abschnitt: HD.S.abschnitt,
      baumOffen: HD.S.baumOffen,
      baumDatei: HD.S.baumDatei,
      seitenStand: HD.S.seitenStand,
      auftragText: HD.S.auftragText,
      auftragVerlauf: HD.S.auftragVerlauf,
      scroll: (document.getElementById("hauptflaeche") || {}).scrollTop || 0,
    }));
  } catch (e) { /* Speicher gesperrt -- dann eben ohne Rettung */ }
};

HD.zustandZurueck = function () {
  var roh;
  try {
    var schluessel = (window.__hdPraefix || "hd:") + "rettung";
    roh = sessionStorage.getItem(schluessel);
    sessionStorage.removeItem(schluessel);   // gilt genau einmal
  } catch (e) { return false; }
  if (!roh) return false;
  var z;
  try { z = JSON.parse(roh); } catch (e) { return false; }
  if (!z || !z.seite || !HD.D.seiten[z.seite]) return false;
  HD.S.seite = z.seite;
  HD.S.auswahl = z.auswahl || null;
  HD.S.suche = z.suche || "";
  HD.S.filter = z.filter || [];
  HD.S.ansicht = z.ansicht || "liste";
  HD.S.abschnitt = z.abschnitt || {};
  HD.S.baumOffen = z.baumOffen || {};
  HD.S.baumDatei = z.baumDatei || null;
  HD.S.seitenStand = z.seitenStand || {};
  HD.S.auftragText = z.auftragText || "";
  HD.S.auftragVerlauf = z.auftragVerlauf || [];
  HD._rettungScroll = z.scroll || 0;
  return true;
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
    // ZWEI PHASEN, ZWEI WAHRHEITEN [Kritik-Runde 3, Befund 5]. Vorher hingen
    // Schreiben und Neumessen in EINER Kette, und ein gemeinsames catch meldete
    // fuer beide "Speichern fehlgeschlagen -- dein Text steht noch im Feld".
    // Scheiterte aber erst das Neumessen, war der Text laengst geschrieben und
    // HD.S.entwurf bereits null: die Meldung antwortete FALSCH auf die einzige
    // Frage, die zaehlt ("ist mein Text weg?"). Eine falsche Antwort darauf ist
    // schlimmer als gar keine.
    .then(function (a) { return a.json().then(function (j) { return { ok: a.ok, j: j }; }); })
    .then(function (r) {
      if (!r.ok) throw new Error((r.j && r.j.fehler) || HD.W.grundUnbekannt);
      // AB HIER IST DER TEXT AUF DER PLATTE. Alles Weitere kann schiefgehen,
      // ohne dass die Arbeit verloren ist -- und genau das sagen die Meldungen
      // unten, statt Verlust zu behaupten.
      HD.S.bearbeitet = null;
      HD.S.entwurf = null;
      HD.S.entwurfStart = null;
      HD.melden(HD.W.wirdGemessen, "bleiben");
      return fetch("/neu-messen", { method: "POST" })
        .then(function (a2) {
          if (!a2 || !a2.ok) {
            // Gespeichert ist gespeichert -- nur die Anzeige ist jetzt veraltet.
            // Vorher passierte hier GAR NICHTS: "wird gemessen" stand fuer immer
            // und das Textfeld blieb gesperrt.
            if (feld) feld.disabled = false;
            HD.meldenFehler(HD.W.gespeichertMessungFehlt, null, HD.W.anzeigeVeraltet);
            HD.zeichnen();
            return;
          }
          // Das Neuladen ist technisch noetig -- die Seite traegt ihren Datensatz
          // als eingebetteten Block, und nach dem Neumessen ist der veraltet.
          // Der NUTZER darf es nicht bezahlen: der Zustand reist mit.
          HD.zustandRetten();
          location.reload();
        })
        .catch(function (e2) {
          if (feld) feld.disabled = false;
          HD.meldenFehler(HD.fuellen(HD.W.gespeichertMessungFehler, { grund: e2.message }),
            null, HD.W.anzeigeVeraltet);
          HD.zeichnen();
        });
    })
    .catch(function (e) {
      // Nur noch der ECHTE Speicherfehler landet hier: der Text ist nicht
      // geschrieben, und er steht unveraendert im Feld.
      if (feld) feld.disabled = false;
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
  // Ohne diese Klasse waere der Schliessen-Knopf einer bleibenden Meldung nicht
  // anklickbar: .meldung traegt pointer-events:none, damit sie im Weg nichts
  // abfaengt -- und nur die Fehler-Klasse hob das bisher auf.
  m.classList.toggle("meldung-bleibt", bleibt);
  // Ein Fehler wird ANGESAGT, nicht beilaeufig gemeldet: assertive unterbricht
  // den Vorleser, polite wartet -- und ein verlorener Text wartet nicht.
  m.setAttribute("aria-live", istFehler ? "assertive" : "polite");
  m.setAttribute("role", istFehler ? "alert" : "status");

  // JEDE bleibende Meldung bekommt den Ausgang, nicht nur die Fehler
  // [Kritik-Runde 3, Rueckfall 3]: der Knopf haing an "istFehler", waehrend
  // "bleibt" beide Arten umfasst. Die Tastenhilfe (Art "bleiben") klebte
  // deshalb dauerhaft fest -- der Fix "jede Sackgasse bekommt einen Ausgang"
  // hatte seine eigene Sackgasse gebaut.
  if (bleibt) {
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
  function fertig(ok) { if (ok) HD.melden(HD.W.kopiert); else HD.meldenFehler(HD.W.kopierenFehlgeschlagen); }
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
// DAS TIPPEN UEBERLEBT JEDES NEUZEICHNEN -- ALS REGEL, NICHT ALS EINZELFALL
// [Kritik-Runde 3, Rueckfall 4]. Fuer das Suchfeld war das repariert, fuer das
// EDITOR-Textfeld nicht: dort baute jeder eintreffende Live-Abruf, jeder
// Fensterfokus, jeder fremde Klick das Feld neu -- Cursor ans Textende, Scroll
// an den Anfang, Fokus weg, mitten im Satz. Der Entwurf ueberlebte, das
// Schreiben nicht.
//
// Deshalb steht das jetzt im zentralen Zeichenlauf und gilt fuer JEDES
// Text-Eingabefeld, auch fuer kuenftige -- statt an jeder Stelle einzeln
// nachgeruestet zu werden (genau das Muster, das die Nachpruefung geruegt hat).
HD.feldZustand = function () {
  var a = document.activeElement;
  if (!a || !a.id) return null;
  if (!/^(INPUT|TEXTAREA)$/.test(a.tagName)) return null;
  try {
    return { id: a.id, start: a.selectionStart, ende: a.selectionEnd, scroll: a.scrollTop };
  } catch (e) { return { id: a.id, start: null, ende: null, scroll: a.scrollTop }; }
};

HD.feldZustandZurueck = function (z) {
  if (!z) return;
  var f = document.getElementById(z.id);
  if (!f) return;
  f.focus();
  if (z.start != null) {
    try { f.setSelectionRange(z.start, z.ende); } catch (e) { /* type=search o. ae. */ }
  }
  if (z.scroll) f.scrollTop = z.scroll;
};

HD.zeichnen = function () {
  var feld = HD.feldZustand();
  HD.pfadleisteZeichnen();
  HD.navZeichnen();
  HD.seiteZeichnen();
  HD.detailZeichnen();
  HD.zaehlerZeichnen();
  HD.feldZustandZurueck(feld);
  // Dateirumpf steht nicht mehr im Datensatz -- die eben gezeichneten
  // Platzhalter holen ihn jetzt beim Server nach. Ohne Server bleibt der
  // Platzhalter mit seinem Hinweis stehen.
  if (HD.inhaltLaden) HD.inhaltLaden();
};

HD.navZeichnen = function () {
  // Auch die Knoepfe im Fuss der Seitenleiste (Rohdaten) zeigen, wo man ist --
  // vorher markierte die Navigation nur die vier Haupt-Eintraege, und wer auf
  // Rohdaten stand, fand seinen Ort nirgends markiert [Audit-Befund B23].
  var knoepfe = document.querySelectorAll(".nav-pille, .leiste-fuss [data-ziel]");
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

// SUCHE UND FILTER GEHOEREN ZUR SEITE, NICHT ZUM KLICK [Kritik-Runde 2,
// Problem 1]: vorher loeschte JEDER Navigationsklick beides -- auch der Wechsel
// zwischen zwei Reitern DERSELBEN Gruppe und der Weg zurueck.
//
// Als eigene Funktion, weil es DREI Eingaenge in einen Seitenwechsel gibt:
// HD.zurSeite (Navigation), HD.oeffnen (Palette, Sprungmarken) und den
// Ordner-Weg in start.js. Der Fix stand vorher nur an einem davon -- genau das
// Muster, das die Nachpruefung geruegt hat [Kritik-Runde 3, Rueckfall 5].
HD.seitenStandWechseln = function (nachId) {
  HD.S.seitenStand = HD.S.seitenStand || {};
  if (HD.S.seite && HD.S.seite !== nachId) {
    HD.S.seitenStand[HD.S.seite] = { suche: HD.S.suche, filter: HD.S.filter, ansicht: HD.S.ansicht };
  }
  var alt = HD.S.seitenStand[nachId] || {};
  HD.S.seite = nachId;
  HD.S.suche = alt.suche || "";
  HD.S.filter = alt.filter || [];
  HD.S.ansicht = alt.ansicht || "liste";
};

HD.zurSeite = function (id) {
  if (!HD.D.seiten[id]) return;
  if (!HD.entwurfFreigeben()) return;
  HD.seitenStandWechseln(id);
  HD.S.auswahl = null;
  HD.S.vollbild = false;
  HD.adresseSchreiben(false);
  // Ein bewusster Seitenwechsel beginnt oben -- im Unterschied zu jedem anderen
  // Neuzeichnen, das die Position behaelt [Kritik-Runde 3, Befund 4].
  //
  // ZWEIMAL, und das mit Absicht: das Flag verhindert, dass seiteZeichnen den
  // ALTEN Stand wiederherstellt, und die Zuweisung danach faengt ab, was
  // WAEHREND des Zeichnens scrollt -- ein focus() auf ein wiederhergestelltes
  // Feld zieht seinen Container in den Sichtbereich (gemessen: 151 px statt 0).
  HD.scrollZuruecksetzen();
  HD.zeichnen();
  var flaeche = document.getElementById("hauptflaeche");
  if (flaeche) flaeche.scrollTop = 0;
};

HD.oeffnen = function (id) {
  var e = HD.eintragMit(id);
  if (!e) return;
  if (!HD.entwurfFreigeben()) return;
  if (e.seite !== HD.S.seite) HD.seitenStandWechseln(e.seite);
  if (e.seite === "dateien") HD.dateiWaehlen(e.pfad);
  else { HD.S.auswahl = id; HD.adresseSchreiben(false); HD.zeichnen(); }
};

// EIN Dokument rechts oeffnen, ohne die Seite zu verlassen [W8]. Der Weg zur
// vollen Dateiansicht bleibt: der Vergroessern-Knopf im Panel fuehrt hinueber.
HD.dokumentOeffnen = function (pfad) {
  if (!pfad) return;
  if (!HD.entwurfFreigeben()) return;
  HD.S.dokument = pfad;
  HD.S.vollbild = false;
  HD.zeichnen();
};

HD.dokumentSchliessen = function () {
  HD.S.dokument = null;
  HD.S.bearbeitet = null;
  HD.zeichnen();
};

// Der synthetische Eintrag fuer ein beliebiges Dokument: dieselbe Form, die
// detailKoerper von jedem Datei-Eintrag erwartet. Kennt der Datensatz die
// Datei bereits (Dateien-Seite), gewinnt der gemessene Eintrag -- er traegt
// Beschreibung, Art und Belege.
HD.dokumentEintrag = function (pfad) {
  var vorhanden = HD.eintragMit("datei:" + pfad);
  if (vorhanden) return vorhanden;
  var name = String(pfad).split("/").pop();
  return {
    id: "datei:" + pfad,
    seite: "dateien",
    name: name,
    pfad: pfad,
    art: "datei",
    artWort: null,
    status: null,
    liste: [],
    felder: [],
    beschreibung: { text: null, quelle: null, beleg: null },
    inhalt: { aufAbruf: true },
  };
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
  if (HD.S.dokument) {
    if (HD.S.bearbeitet != null && !HD.entwurfFreigeben()) return true;
    HD.dokumentSchliessen();
    return true;
  }
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
