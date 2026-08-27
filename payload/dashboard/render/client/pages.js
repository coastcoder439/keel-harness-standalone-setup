// BROWSER-TEIL 2 von 6: die Seiten.
//
// Drei Formen, mehr braucht es nicht: Ueberblick (Kennzahlen und Abschnitte),
// Listenseite (EIN Zeilenrezept fuer alles) und Dateien (Baum plus Ansicht).
// Die Vorfassung hatte vier Ansichten je Seite, von denen drei fuer ein
// Inventar sinnlos waren -- ein Board mit leeren Spalten zeigt nichts.
//
// Die Klassennamen stammen aus render/styles.js und sind nicht verhandelbar.

const quelltext = `
// --- Leerzustand ---------------------------------------------------------
HD.leerHTML = function (art) {
  var l = HD.D.leer[art] || HD.D.leer.allgemein;
  return '<div class="leerzustand">'
    + '<span class="leer-symbol">' + HD.icon("inbox") + "</span>"
    + (l.titel ? '<span class="leer-titel">' + HD.esc(l.titel) + "</span>" : "")
    + '<span class="leer-text">' + HD.esc(l.text) + "</span>"
    + (l.handlung ? '<button class="filter-chip" data-handlung="' + HD.esc(l.handlung.ziel) + '">'
        + HD.esc(l.handlung.wort) + "</button>" : "")
    + "</div>";
};

// --- Status --------------------------------------------------------------
HD.statusChip = function (code) {
  if (!code) return "";
  var s = HD.D.status[code];
  if (!s) return "";
  var klasse = s.token.replace("--status-", "status-");
  // Der Normalzustand ist STILL: elfmal ein gruenes "In Ordnung" ist Rauschen,
  // erst die Abweichung verdient Farbe [Kritiker-Befund Gauntlet-Runde 1].
  // Glyphe + Wort bleiben (nie Farbe allein) -- nur die Pille verschwindet.
  if (code === "ok") klasse += " status-still";
  return '<span class="status-chip ' + klasse + '">'
    + '<span class="status-glyphe">' + HD.icon(s.glyphe) + "</span>"
    + "<span>" + HD.esc(s.wort) + "</span></span>";
};

// Nur die Glyphe eines Status, im Status-Ton -- fuer Stellen, an denen das
// Wort daneben im Satz steht (Gesundheits-Zeilen). Kein Unicode-Ersatz:
// dieselbe Lucide-Glyphe wie im Chip, damit die Oberflaeche EINE Sprache
// spricht [ui-standard Punkt 3 und 5].
HD.statusGlyphe = function (code) {
  var s = HD.D.status[code];
  if (!s) return HD.icon("circle-dashed");
  return '<span class="status-glyphe ' + s.token.replace("--status-", "status-") + '">'
    + HD.icon(s.glyphe) + "</span>";
};

// Dauer in Worten: Minuten, Stunden, Tage -- "4317 min" rechnet niemand um.
// Ausgeschrieben, weil Abkuerzungen verboten sind (labels.js Regel 4).
// Einzahl ist kein Sonderfall [Kritik-Runde 2, Problem 14]: "vor 1 Minuten"
// stand in der obersten Zeile der Startseite.
HD.dauer = function (minuten) {
  if (typeof minuten !== "number" || !isFinite(minuten)) return null;
  if (minuten < 1) return HD.W.dauerGerade;
  if (minuten < 60) {
    return minuten === 1 ? HD.W.dauerMinuteEins : HD.fuellen(HD.W.dauerMinuten, { n: minuten });
  }
  var stunden = Math.round(minuten / 60);
  if (stunden < 24) {
    return stunden === 1 ? HD.W.dauerStundeEins : HD.fuellen(HD.W.dauerStunden, { n: stunden });
  }
  var tage = Math.round(stunden / 24);
  return tage === 1 ? HD.W.dauerTagEins : HD.fuellen(HD.W.dauerTage, { n: tage });
};

// --- Zeile: EIN Rezept fuer alle Listenseiten ----------------------------
// Titel und Untertitel uebereinander, Messwerte rechts, Status ganz rechts.
// Nicht sieben Spalten nebeneinander: auf der schmalen Hauptflaeche wird das
// zur Wand, und genau das war die Beanstandung "Info-Flut".
HD.zeileHTML = function (e) {
  var spalten = e.liste || [];
  var titelSpalte = spalten.find(function (s) { return s.stark; }) || { wert: e.name };
  var unterSpalte = spalten.find(function (s) { return s.weich; }) || { wert: e.unter };
  var meta = spalten.filter(function (s) { return !s.stark && !s.weich && s.wert; });

  // KEINE Icon-Kachel: elfmal dasselbe Symbol je Seite traegt null
  // Information und frisst die wichtigste Spalte [Kritiker-Befund Runde 3] --
  // das Vorbild (Keel-Light-Fundliste) kommt ohne Zeilen-Icons aus.
  var kachel = "";

  var metaHTML = meta.length
    ? '<span class="eintrag-meta">' + meta.map(function (s) {
        var inhalt = HD.esc(s.wert);
        // .meta-pille, NICHT .eigenschaft-pille: die Eigenschafts-Pille traegt
        // Versalien fuer die schmale Detail-Spalte -- in der Hauptliste wird
        // daraus eine Versalienwand (Beanstandung A3, ui-standard Punkt 2).
        // EIN Pillen-System: gleiche Form fuer alle, die Klasse traegt nur
        // der farbige Punkt -- gefuellt neben umrandet las sich als
        // Logik-Bruch [Kritiker-Befund Gauntlet-Runde 5].
        if (s.chip) inhalt = '<span class="meta-pille" data-ton="' + HD.esc(s.chip) + '">'
          + '<span class="pillen-punkt" aria-hidden="true"></span>' + inhalt + "</span>";
        return '<span' + (s.mono ? ' class="mono"' : "") + ' title="' + HD.esc(s.label + ": " + s.wert) + '">' + inhalt + "</span>";
      }).join("") + "</span>"
    : "";

  // Der Normalzustand schweigt in der Zeile: elfmal "In Ordnung" traegt null
  // Information [Kritiker-Befund Gauntlet-Runde 2]. Die Sammelaussage steht
  // oben auf der Seite (HD.sammelZeile); die Zeile zeigt nur Abweichungen.
  var schluss = e.status && e.status !== "ok"
    ? '<span class="eintrag-schluss">' + HD.statusChip(e.status) + "</span>" : "";
  // Klick-Affordanz: die Zeile OEFFNET etwas -- ohne Zeichen sah die Liste
  // aus wie ein Ausdruck [Kritiker-Befund Gauntlet-Runde 3].
  var pfeil = '<span class="zeilen-pfeil" aria-hidden="true">' + HD.icon("chevron-right") + "</span>";
  return '<button class="eintrag-zeile" data-id="' + HD.esc(e.id) + '"'
    + (HD.S.auswahl === e.id ? ' aria-selected="true"' : "") + ">"
    + kachel
    + '<span class="eintrag-haupt">'
    + '<span class="eintrag-titel">' + HD.markiere(HD.klartext(titelSpalte.wert || e.name), HD.S.suche) + "</span>"
    + (unterSpalte.wert ? '<span class="eintrag-unter">' + HD.markiere(HD.klartext(unterSpalte.wert), HD.S.suche) + "</span>" : "")
    + "</span>"
    + metaHTML
    + schluss
    + pfeil
    + "</button>";
};

// Die EINE Sammelaussage, wenn alles traegt -- statt derselben gruenen
// Wiederholung an jeder Zeile.
HD.sammelZeile = function (seite) {
  var mitStatus = HD.seitenEintraege(seite).filter(function (e) { return e.status; });
  if (!mitStatus.length) return "";
  if (!mitStatus.every(function (e) { return e.status === "ok"; })) return "";
  return '<p class="sammel-zeile"><span class="status-glyphe status-ok">' + HD.icon("circle-check") + "</span>"
    + HD.esc(HD.fuellen(HD.W.alleInOrdnung, { n: mitStatus.length })) + "</p>";
};

// --- Gruppenkopf ---------------------------------------------------------
// zusatz: HTML, das NEBEN dem Kopf steht (z. B. "Stand: 20:43" mit
// Aktualisieren-Knopf). Bewusst neben und nicht im Knopf -- ein <button> im
// <button> ist ungueltiges HTML, und der innere waere nicht klickbar.
HD.gruppeHTML = function (titel, anzahl, offen, istCode, zusatz) {
  // Ohne Zahl keine Zahl: ein Block wie "Auftrag senden" traegt keinen
  // Zaehler -- "null" hinzuschreiben waere ein Maschinenwert im UI.
  var zahl = (anzahl === null || anzahl === undefined) ? "" : '<span class="gruppen-zahl">' + anzahl + "</span>";
  // Technische Namen (SessionStart, Stop, statusLine) behalten ihre
  // Schreibweise -- die Versalien-Transformation machte "SESSIONSTART"
  // daraus, einen Namen, den es nirgends gibt [Kritiker-Befund Runde 3].
  // istCode kommt vom Aufrufer (Daten wissen es); camelCase faengt den Rest.
  var code = (istCode || /[a-z][A-Z]/.test(titel)) ? ' data-code="ja"' : "";
  var kopf = '<button class="gruppen-kopf" data-gruppe="' + HD.esc(titel) + '" aria-expanded="' + (offen ? "true" : "false") + '">'
    + '<span class="gruppen-caret">' + HD.icon("chevron-down") + "</span>"
    + '<span class="gruppen-titel"' + code + ">" + HD.esc(titel) + "</span>"
    + zahl + "</button>";
  if (!zusatz) return kopf;
  return '<div class="gruppen-zeile">' + kopf + zusatz + "</div>";
};

// --- Werkzeugleiste ------------------------------------------------------
HD.werkzeugHTML = function (seite) {
  var alle = HD.seitenEintraege(seite);
  // Filter-Chips nur, wenn es ueberhaupt etwas zu unterscheiden gibt. Ein
  // einzelner Chip, der alles zeigt, ist ein Knopf ohne Wirkung.
  var stati = {};
  alle.forEach(function (e) { if (e.status) stati[e.status] = (stati[e.status] || 0) + 1; });
  var codes = Object.keys(stati);
  var chips = codes.length >= 2 ? codes.map(function (c) {
    var s = HD.D.status[c];
    var an = HD.S.filter.indexOf(c) >= 0;
    return '<button class="filter-chip" data-filter="' + HD.esc(c) + '" aria-pressed="' + (an ? "true" : "false") + '">'
      + HD.esc(s.wort) + " " + stati[c] + "</button>";
  }).join("") : "";

  var zuruecksetzen = HD.S.filter.length
    ? '<button class="filter-chip" data-handlung="filter:leeren">' + HD.esc(HD.W.filterZuruecksetzen) + "</button>" : "";

  var ansicht = seite === "zutun"
    ? '<span class="ansicht-umschalter" role="group" aria-label="' + HD.esc(HD.W.ansicht) + '">'
      + '<button data-ansicht="liste" aria-pressed="' + (HD.S.ansicht === "liste") + '">' + HD.esc(HD.W.ansichtListe) + "</button>"
      + '<button data-ansicht="board" aria-pressed="' + (HD.S.ansicht === "board") + '">' + HD.esc(HD.W.ansichtBoard) + "</button>"
      + "</span>" : "";

  return '<div class="werkzeugleiste">'
    + '<span class="suchfeld-huelle">' + HD.icon("search")
    + '<input class="suchfeld" id="suche" type="text" value="' + HD.esc(HD.S.suche) + '" autocomplete="off" spellcheck="false"'
    + ' placeholder="' + HD.esc(HD.W.suchenIn.replace("{seite}", HD.D.seiten[seite].name)) + '"'
    + ' aria-label="' + HD.esc(HD.W.suchen) + '"></span>'
    + (HD.S.suche ? '<button class="filter-chip" data-handlung="suche:leeren">' + HD.esc(HD.W.sucheLeeren) + "</button>" : "")
    + ansicht + chips + zuruecksetzen
    + "</div>";
};

// --- Tab-Leiste ----------------------------------------------------------
// Gehoert eine Seite zu einer Tab-Gruppe (labels.js TABGRUPPEN), stehen ihre
// Geschwister als Reiter ueber dem Inhalt -- die Seitenleiste zeigt nur den
// einen Gruppen-Eintrag. Reiter-Wort = Seitenname, keine zweite Beschriftung.
HD.tabGruppeFuer = function (seite) {
  var g = HD.D.tabgruppen || {};
  for (var id in g) {
    if (g[id].seiten && g[id].seiten.indexOf(seite) >= 0) return g[id];
  }
  return null;
};

HD.tabLeisteHTML = function (seite) {
  var g = HD.tabGruppeFuer(seite);
  if (!g) return "";
  return '<nav class="tab-leiste" aria-label="' + HD.esc(g.name) + '">'
    + g.seiten.map(function (id) {
        var s = HD.D.seiten[id];
        if (!s) return "";
        return '<button class="tab" data-ziel="' + HD.esc(id) + '"'
          + (id === seite ? ' aria-current="page"' : "") + ">"
          + HD.esc(s.name) + "</button>";
      }).join("")
    + "</nav>";
};

// --- Listenseite ---------------------------------------------------------
// JEDE SEITE HAT EINEN KOPF [Kritik-Runde 2, Problem 5]. Vorher war das oberste
// Textelement jeder Seite eine 12-px-Krume, danach sofort ein grauer Absatz --
// es gab in der GANZEN Anwendung keine einzige <h1>. Das Auge landete zuerst
// auf dem dunklen Knopf "Neu messen" oben rechts, also auf einer Wartungs-
// aktion, und musste dann zurueck nach links oben wandern, um zu erfahren, wo
// es ueberhaupt ist. Man wurde nicht empfangen, man wurde abgeladen.
//
// Der Name kommt aus HD.D.seiten -- derselbe, den Navigation und Reiter tragen
// [Problem 7: ein Ding, ein Name]. Der Zweck-Satz wird zum Untertitel und
// begruendet damit seine Lesebreite, statt wie ein vergessener Absatz zu wirken.
HD.seitenKopfHTML = function (seite) {
  var s = HD.D.seiten[seite];
  if (!s) return "";
  return '<header class="seiten-kopf">'
    + '<h1 class="seiten-titel">' + HD.esc(s.name) + "</h1>"
    // Die Herkunft steht als EIGENE Zeile, nicht als Bruchstueck hinter dem Satz
    // [Audit-Befund B10]: "... 7 ohne Wegweiser. user-projects/" las sich wie ein
    // abgerissener Halbsatz.
    + (s.zweck ? '<p class="seiten-unter">' + HD.esc(s.zweck) + "</p>" : "")
    + (s.ort ? '<p class="seiten-ort"><span class="pfad">' + HD.esc(s.ort) + "</span></p>" : "")
    + "</header>";
};

HD.listenSeite = function (seite) {
  var s = HD.D.seiten[seite];
  var liste = HD.gefiltert(seite);
  // Ein gewaehltes Projekt ersetzt die Liste -- die Hauptflaeche zeigt EIN
  // Ding, nicht Liste und Detail nebeneinander.
  if (seite === "projekte" && HD.S.auswahl) {
    var gewaehlt = HD.eintragMit(HD.S.auswahl);
    if (gewaehlt && gewaehlt.seite === "projekte") return HD.projektSeite(gewaehlt);
  }
  // Statusaussage VOR der Erklaer-Prosa: die wichtigste Information der
  // Seite darf nicht die dritte Zeile sein [Kritiker-Befund Runde 4].
  var kopf = HD.seitenKopfHTML(seite)
    + HD.tabLeisteHTML(seite)
    + HD.sammelZeile(seite);
  var werkzeug = HD.werkzeugHTML(seite);
  // Live-Anbauten je Seite: "Zu tun" traegt die Arbeitspakete, "Hooks" die
  // Guard-Selbsttests -- beides liest der Server, beides gehoert zum Thema
  // der Seite (nicht auf eine eigene Bruecken-Seite ausgelagert).
  var anbau = "";
  // Arbeitspakete als KANBAN nach Zustand [Owner-Wunsch W7] -- ersetzt die
  // flache Repo-Liste. Umschaltbar auf Liste ueber die Werkzeugleiste.
  // Die Arbeitspakete stehen hier als LISTE. Ihr Kanban lebt seit Slice 3 im
  // Projekt-Detail (eine Sache, ein Ort) -- als Anbau unter einem Umschalter,
  // der "Liste" anzeigt, sah er aus wie ein Schalter ohne Wirkung.
  if (seite === "zutun") anbau = HD.paketeSektion();
  if (seite === "hooks") anbau = HD.guardSektion();
  // Automatik ist eine reine LIVE-Ansicht ohne Mess-Eintraege: Suchfeld und
  // Listen-Leerzustand haetten nichts zu tun und der Leerzustand stuende
  // doppelt [Abnahme 26.08.2026]. Frueh zurueck, mit Erklaersatz und Reitern.
  if (seite === "automatik") {
    return kopf + HD.automatikSektion();
  }

  // Zustand OBEN in Kacheln, dann die Liste -- das Muster der Vorbild-
  // Pruefseite [Gauntlet]. Auf Hooks: was der Bestand insgesamt KANN. Die
  // Woerter kommen aus den Zeilen-Daten (views.js liefert das Wirkung-Wort),
  // kein deutsches Literal im Browser-Teil.
  var kacheln = "";
  if (seite === "hooks") {
    var alle = HD.seitenEintraege("hooks");
    var jeWirkung = {};
    var reihenfolge = [];
    alle.forEach(function (e) {
      var code = e.roh && e.roh.wirkung;
      if (!code) return;
      var spalte = (e.liste || []).filter(function (sp) { return sp.label === HD.W.wirkung; })[0];
      if (!jeWirkung[code]) { jeWirkung[code] = { wort: spalte ? spalte.wert : code, anzahl: 0 }; reihenfolge.push(code); }
      jeWirkung[code].anzahl += 1;
    });
    // Keine Summen-Kachel: der Erklaersatz zaehlt bereits ("11 Eintraege auf
    // 11 Skripte") -- eine Kachel mit abweichender Zaehlung (plus statusLine)
    // waere der naechste Zahlen-Widerspruch.
    var symbole = { blockiert: "ban", meldet: "circle-dot", kontext: "layers" };
    kacheln = '<div class="kennzahl-reihe">'
      + reihenfolge.map(function (code) {
          return '<span class="kennzahl"><span class="kennzahl-kopf"><span class="kennzahl-label">'
            + HD.esc(jeWirkung[code].wort) + "</span>" + HD.icon(symbole[code] || "circle") + "</span>"
            + '<span class="kennzahl-wert">' + jeWirkung[code].anzahl + "</span></span>";
        }).join("") + "</div>";
  }

  if (!liste.length) {
    var art = HD.S.suche ? "treffer" : (HD.S.filter.length ? "filter" : (HD.D.leer[seite] ? seite : "allgemein"));
    return kopf + kacheln + werkzeug + HD.leerHTML(art) + anbau;
  }

  if (seite === "zutun" && HD.S.ansicht === "board") return kopf + kacheln + werkzeug + HD.boardHTML(liste) + anbau;

  // PROJEKTE ALS KARTENGITTER [Entwurf mockups/d-projekte.html, 01-product.md:
  // "Projektliste als Karten (offene Pakete, Sicherungsstand)"]. Eine Liste mit
  // Texten und Zahlen beantwortet die Frage "welches Projekt braucht mich"
  // nicht -- die Karte zeigt Name, Satz, wer dort arbeitet und den Stand.
  if (seite === "projekte" && liste.length) {
    return kopf + werkzeug + HD.projektNetzHTML(liste);
  }

  // PROJEKTLISTE: der Live-Stand statt der Dokumentzahl [Owner 27.08.2026].
  // Die Messung liefert je Projekt eine Dokumentzahl -- gefragt ist, welche
  // Arbeitspakete hier in welchem Stand liegen und ob jemand daran arbeitet.
  // Solange die Bruecke nicht geantwortet hat, bleibt die Zeile wie gemessen;
  // eine Null waere eine Behauptung ueber ungelesene Daten.
  if (seite === "projekte") {
    liste = liste.map(function (e) {
      var paketSatz = HD.projektPaketSatz ? HD.projektPaketSatz(e.name) : null;
      var sitzungSatz = HD.projektSitzungSatz ? HD.projektSitzungSatz(e.name) : null;
      if (!paketSatz && !sitzungSatz) return e;
      var spalten = (e.liste || []).filter(function (sp) {
        return sp.label !== HD.W.dokumente;
      });
      // Der Normalzustand schweigt: 18 von 21 Repos haben kein Arbeitspaket --
      // achtzehnmal "Kein Arbeitspaket" untereinander ist Rauschen, keine
      // Information [ui-standard, stiller Normalzustand].
      if (paketSatz && paketSatz !== HD.W.projektKeinePakete) spalten.push({ label: HD.W.arbeitspakete, wert: paketSatz });
      if (sitzungSatz && sitzungSatz !== HD.W.projektKeineSitzung) {
        spalten.push({ label: HD.W.sitzungen, wert: sitzungSatz });
      }
      var kopie = {};
      for (var k in e) if (Object.prototype.hasOwnProperty.call(e, k)) kopie[k] = e[k];
      kopie.liste = spalten;
      return kopie;
    });
  }

  var mitGruppe = liste.filter(function (e) { return e.gruppe; }).length;
  var koerper;
  if (mitGruppe === liste.length) {
    var ordnung = [];
    var nach = {};
    liste.forEach(function (e) {
      if (!nach[e.gruppe]) { nach[e.gruppe] = []; ordnung.push(e.gruppe); }
      nach[e.gruppe].push(e);
    });
    koerper = ordnung.map(function (g) {
      var offen = HD.S.abschnitt["gruppe:" + g] !== false;
      var istCode = nach[g][0] && nach[g][0].gruppeCode === true;
      // Ein technischer Gruppenname bekommt seinen Erklaersatz mit -- sonst
      // steht dort nur ein Fachwort [Owner-Wunsch W14].
      var erklaerung = (HD.D.ereignisErklaerung || {})[g];
      return "<section>" + HD.gruppeHTML(g, nach[g].length, offen, istCode)
        + (offen && erklaerung ? '<p class="gruppen-erklaersatz">' + HD.esc(erklaerung) + "</p>" : "")
        + (offen ? '<div class="eintrag-liste">' + nach[g].map(HD.zeileHTML).join("") + "</div>" : "")
        + "</section>";
    }).join("");
  } else {
    koerper = '<div class="eintrag-liste">' + liste.map(HD.zeileHTML).join("") + "</div>";
  }
  return kopf + kacheln + werkzeug + koerper + anbau;
};

// --- Board (nur "Zu tun") ------------------------------------------------
HD.boardHTML = function (liste) {
  var reihen = ["unlesbar", "befund", "fehlt", "hinweis", "ok"];
  var nach = {};
  liste.forEach(function (e) {
    var k = e.status || "ohne";
    if (!nach[k]) nach[k] = [];
    nach[k].push(e);
  });
  var spalten = reihen.map(function (r) {
    var eintraege = nach[r] || [];
    var s = HD.D.status[r];
    if (!s) return "";
    var klasse = s.token.replace("--status-", "status-");
    // Leere Spalte als schmale Leiste statt weggelassen: das Vokabular bleibt
    // sichtbar ("Fehler 0"), ohne den Platz einer ganzen Spalte zu kosten.
    return '<div class="board-spalte ' + klasse + '"' + (eintraege.length ? "" : ' data-leer="ja"') + ">"
      + '<div class="board-kopf"><span class="status-glyphe">' + HD.icon(s.glyphe) + "</span>"
      + "<span>" + HD.esc(s.wort) + '</span><span class="board-zahl">' + eintraege.length + "</span></div>"
      + eintraege.map(function (e) {
          return '<button class="board-karte" data-id="' + HD.esc(e.id) + '">'
            + '<span class="board-bereich">' + HD.esc(e.artWort || "") + "</span>"
            + '<span class="board-was">' + HD.markiere(e.name, HD.S.suche) + "</span></button>";
        }).join("") + "</div>";
  }).join("");
  var ohne = (nach.ohne || []).length
    ? '<p class="board-hinweis">' + (nach.ohne.length) + " ohne gemessenen Status</p>" : "";
  return '<div class="board">' + spalten + "</div>" + ohne;
};

// --- Control Center -------------------------------------------------------
// Der Weg aus einem Widget in seine tiefe Ansicht [01-product.md: "Jedes Widget
// ist die Klein-Fassung einer tiefen Ansicht und verlinkt dorthin"]. Mit Pfeil,
// damit man sieht, dass es weitergeht.
HD.widgetWeg = function (ziel, wort) {
  // Nur das Wort: der Kopf traegt links bereits einen Aufklapp-Winkel, ein
  // zweiter Winkel rechts sind zwei Zeichen fuer zwei verschiedene Dinge
  // dicht nebeneinander.
  return '<button class="widget-link" data-ziel="' + HD.esc(ziel) + '">' + HD.esc(wort) + "</button>";
};

// [Owner 25.08.2026 abends] Widgets verdichten nach oben, die Reiter
// verbreitern nach unten: Gesundheit (Haekchenliste), Deine drei (die
// wichtigsten offenen Punkte), Logbuch heute (was lief wann), Sitzungen,
// Auftrag. Kennung bleibt "ueberblick".

// Gesundheit: vier Pruefungen aus ECHTEN Quellen. DREI Zustaende, nicht zwei
// [Befund 26.08.2026]: "nichts gemessen" darf nie aussehen wie "alles gut" --
// eine beruhigende Falschaussage ist schlimmer als eine Warnung. Die Glyphe
// kommt aus HD.statusChip (Baustein), nicht aus Unicode-Zeichen.
HD.wGesundheit = function () {
  var z = HD.D.zahlen;
  // EINE ZAEHLREGEL FUER BEIDE FLAECHEN [Kritik-Runde 3, Befund 4]: hier stand
  // die Zahl ALLER Eintraege der Hooks-Seite (13) unter dem Wort "Hooks",
  // waehrend die Seite selbst 12 nennt -- der 13. Eintrag ist die statusLine,
  // und die ist kein Hook. Ein Dashboard verkauft genau eine Ware: Vertrauen in
  // seine Zahlen. Zwei Klicks auseinander 13 gegen 12 kostet genau die.
  var alleEintraege = HD.seitenEintraege("hooks");
  var hooks = alleEintraege.filter(function (e) { return e.art === "hook-skript"; });
  var hooksAbweichung = alleEintraege.filter(function (e) { return e.status && e.status !== "ok"; }).length;
  var alterMin = Math.max(0, Math.round((Date.now() - Date.parse(HD.D.gemessenAm)) / 60000));
  var alterLesbar = HD.dauer(alterMin);
  var zeilen = [
    // Wort und Zahl beschreiben DASSELBE: die Zeile heisst jetzt, was sie misst.
    { status: !hooks.length ? null : (hooksAbweichung === 0 ? "ok" : "hinweis"),
      text: hooks.length ? HD.fuellen(HD.W.ccHooksOhneBefund, { n: hooks.length }) : HD.W.ccHooksKeine,
      // Der Wert rechts ist der BELEG zur Aussage links [Entwurf d-cc.html:
      // "Hooks geladen 11/11"] -- er zeigt, woran die Zeile gemessen wurde.
      wert: hooks.length ? hooks.length + "/" + alleEintraege.length : "", ziel: "hooks" },
    { status: alterLesbar === null ? null : (alterMin <= 60 ? "ok" : "hinweis"),
      text: alterLesbar === null ? HD.W.ccMessungUnbekannt : HD.fuellen(HD.W.ccMessungFrisch, { dauer: alterLesbar }),
      wert: HD.zeitpunkt(HD.D.gemessenAm), ziel: null },
    { status: HD.serverModus() ? "ok" : "hinweis",
      text: HD.serverModus() ? HD.W.ccServerJa : HD.W.ccServerNein,
      wert: HD.serverModus() ? location.host : "", ziel: null },
    { status: !z.repos ? null : (z.reposOffen === 0 ? "ok" : "hinweis"),
      text: !z.repos ? HD.W.ccSicherungUnbekannt
        : (z.reposOffen === 0 ? HD.fuellen(HD.W.ccSicherungOk, { n: z.repos })
          : (z.reposOffen === 1 ? HD.W.ccSicherungLueckeEins : HD.fuellen(HD.W.ccSicherungLuecke, { n: z.reposOffen }))),
      // Rechts steht, WORAUF sich der Satz bezieht: die Zahl der geprueften
      // Repos, nicht noch einmal die Zahl der Luecken.
      wert: z.repos ? z.repos + " Repos" : "", ziel: "backup" },
  ];
  var offenAn = HD.S.abschnitt["gruppe:" + HD.W.ccGesundheit] !== false;
  var rumpf = zeilen.map(function (r) {
    // Das Zeichen traegt sein WORT als Namen [ui-standard Punkt 3: nie Farbe
    // allein]. Im Satz daneben steht die Aussage, hier der Zustand -- so liest
    // eine Vorlesesoftware "Hinweis" statt eines namenlosen Bildes.
    var wort = r.status && HD.D.status[r.status] ? HD.D.status[r.status].wort : "";
    var kern = '<span class="check-glyphe" role="img" aria-label="' + HD.esc(wort) + '" title="' + HD.esc(wort) + '">'
      + (r.status ? HD.statusGlyphe(r.status) : HD.icon("circle-dashed")) + "</span>"
      + '<span class="check-text">' + HD.esc(r.text) + "</span>"
      + '<span class="check-wert mono">' + HD.esc(r.wert) + "</span>";
    // EINE WARNUNG BEKOMMT GEWICHT, NICHT NUR EINE ANDERE FARBE [Kritik-Runde 2,
    // Problem 11]: das Bernstein-Zeichen war in Groesse und Position identisch
    // zum gruenen Haken und verschwand deshalb beim Ueberfliegen -- genau dann,
    // wenn man es braucht. Die Zeile mit Handlungsbedarf traegt jetzt zusaetzlich
    // eine linke Farbkante und einen Ton, den man auch aus dem Augenwinkel sieht.
    var achtung = r.status === "hinweis" ? " check-reihe-achtung" : "";
    return r.ziel
      ? '<button class="check-reihe' + achtung + '" data-ziel="' + HD.esc(r.ziel) + '">' + kern
        + '<span class="zeilen-pfeil" aria-hidden="true">' + HD.icon("chevron-right") + "</span></button>"
      : '<div class="check-reihe check-reihe-still' + achtung + '">' + kern + "</div>";
  }).join("");
  // Jedes Widget traegt seinen Weg in die Tiefe [01-product.md: "nichts
  // existiert nur oben"].
  var weg = HD.widgetWeg("hooks", HD.W.ccZuHarness);
  return "<section>" + HD.gruppeHTML(HD.W.ccGesundheit, null, offenAn, false, weg)
    + (offenAn ? '<div class="widget-rumpf">' + rumpf + "</div>" : "") + "</section>";
};

// Logbuch: was lief, wann. Der Titel behauptet nicht mehr "heute" -- gezeigt
// wird die letzte Messung, und die kann aelter sein [Befund 26.08.2026].
// Der Leerzustand traegt eine HANDLUNG, keine blosse Feststellung.
// AUTOMATIK HEUTE als ZEITLEISTE [01-product.md W3: "Laeufe mit Uhrzeit,
// letzter/naechster Lauf"; Entwurf mockups/d-cc.html]. Vorher stand hier eine
// einzelne Zeile "Messung gelaufen" ohne Uhrzeit und ohne den Blick nach vorn --
// die Frage "wann laeuft das naechste Mal etwas" blieb unbeantwortet.
HD.wLogbuch = function () {
  var offenAn = HD.S.abschnitt["gruppe:" + HD.W.ccLogbuch] !== false;
  var halt = function (zeit, was, geplant) {
    return '<div class="logbuch-halt"' + (geplant ? ' data-geplant="ja"' : "") + ">"
      + '<time class="mono">' + HD.esc(zeit) + "</time>"
      + (geplant ? "<span>" + HD.esc(was) + "</span>" : "<b>" + HD.esc(was) + "</b>")
      + "</div>";
  };
  // Der letzte Lauf ist gemessen: die Messzeit selbst. Ein zweiter Halt kommt
  // aus der Automatik-Messung, sobald dort etwas eingerichtet ist.
  var halte = halt(HD.uhrzeitVon(HD.D.gemessenAm), HD.W.ccMessungGelaufen, false);
  var laeufe = ((HD.bridgeData || {}).automatik || {}).laeufe || [];
  var naechster = laeufe.filter(function (l) { return l.naechster; })[0];
  // Ohne geplanten Lauf bleibt die Zeitspalte LEER: "als Naechstes" an der
  // Stelle einer Uhrzeit sieht aus wie eine Zeitangabe und ist keine
  // [Audit-Befund B18].
  halte += naechster
    ? halt(HD.uhrzeitVon(naechster.naechster), naechster.name, true)
    : halt("", HD.W.ccKeinNaechster, true);
  var weg = HD.widgetWeg("automatik", HD.W.ccZuAutomatik);
  return "<section>" + HD.gruppeHTML(HD.W.ccLogbuch, null, offenAn, false, weg)
    + (offenAn ? '<div class="widget-rumpf"><div class="logbuch">' + halte + "</div></div>" : "") + "</section>";
};

// Uhrzeit eines Zeitpunkts -- die Zeitleiste zeigt IMMER eine Uhrzeit, auch
// wenn der Halt nicht von heute ist [Audit-Befund B18].
HD.uhrzeitVon = function (iso) {
  if (!iso) return "—";
  var d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  var heute = new Date();
  var gleich = d.toDateString() === heute.toDateString();
  var z = function (n) { return (n < 10 ? "0" : "") + n; };
  var uhr = z(d.getHours()) + ":" + z(d.getMinutes());
  return gleich ? uhr : HD.zeitpunkt(iso) + " " + uhr;
};

// Deine drei: die drei wichtigsten OFFENEN Punkte. Erledigtes wird
// ausgeschlossen, nicht nur nach hinten sortiert [Befund 26.08.2026: das
// Widget fuellte mit Erledigtem auf]. Rang kommt aus HD.D.status (Baustein),
// nicht aus einer dritten eigenen Ordnung.
HD.wDrei = function () {
  var offene = HD.seitenEintraege("zutun").filter(function (e) {
    return e.status && e.status !== "ok" && e.status !== "entfaellt";
  });
  offene = offene.slice().sort(function (a, b) {
    var ra = (HD.D.status[a.status] || {}).rang;
    var rb = (HD.D.status[b.status] || {}).rang;
    return (rb == null ? -1 : rb) - (ra == null ? -1 : ra);
  });
  // QUELLENUEBERGREIFEND [01-product.md W2: "die drei wichtigsten, abhakbar,
  // quellenuebergreifend priorisiert"]: Messbefunde UND offene Schritte aus den
  // Arbeitspaketen stehen nebeneinander. Ein Messbefund ist nicht abhakbar --
  // er verschwindet, wenn die Ursache weg ist; ein Paket-Schritt schon, und der
  // bekommt sein Kaestchen (dieselbe Schreibung wie auf der Paket-Karte).
  var schritte = [];
  ((HD.bridgeData || {}).packages || []).forEach(function (pk) {
    if (pk.error) return;
    (pk.steps || []).forEach(function (st, i) {
      if (st.done) return;
      schritte.push({
        id: "schritt:" + pk.file + ":" + i,
        name: st.text,
        datei: pk.file,
        index: i,
        // Der Paket-NAME reicht als Kontext -- ein ganzer Titel wird in der
        // schmalen Spalte ohnehin gekuerzt und sagt dann weniger als der Name.
        kontext: String(pk.file).split("/").pop().replace(/[.]md$/, ""),
        abhakbar: true,
      });
    });
  });
  // Erst die Messbefunde nach Rang, dann die Paket-Schritte -- ein roter Befund
  // wiegt schwerer als ein offener Haken.
  var gezeigt = offene.slice(0, 3).concat(schritte).slice(0, 3);
  var offenAn = HD.S.abschnitt["gruppe:" + HD.W.ccDrei] !== false;
  var rumpf = gezeigt.length
    ? gezeigt.map(function (e) {
        // Abhakbar: ein Kaestchen, das wirklich in die Datei schreibt.
        if (e.abhakbar) {
          return '<div class="drei-zeile">'
            + '<input type="checkbox" data-bridge-toggle="' + HD.esc(e.datei) + '"'
            + ' data-bridge-index="' + e.index + '" aria-label="' + HD.esc(e.name) + '">'
            + '<span class="drei-text" title="' + HD.esc(e.name) + '">' + HD.esc(HD.aufEineZeile(e.name, 64)) + "</span>"
            + '<span class="drei-kontext" title="' + HD.esc(e.kontext) + '">' + HD.esc(HD.aufEineZeile(e.kontext, 22)) + "</span>"
            + "</div>";
        }
        return '<button class="drei-zeile" data-id="' + HD.esc(e.id) + '">'
          + '<span class="drei-glyphe">' + HD.statusGlyphe(e.status) + "</span>"
          + '<span class="drei-text" title="' + HD.esc(e.name) + '">' + HD.esc(HD.aufEineZeile(e.name, 64)) + "</span>"
          + '<span class="zeilen-pfeil" aria-hidden="true">' + HD.icon("chevron-right") + "</span>"
          + "</button>";
      }).join("")
    : HD.leerHTML("zutun");
  // EINE SACHE, EINE STUFE -- UEBER ALLE ANSICHTEN [Kritik-Runde 3, Befund 3].
  // Diese Flaeche trug ihren Warnton FEST verdrahtet: derselbe Eintrag, der auf
  // "Zu tun" ein rotes "Fehler" bekam, erschien hier bernsteinfarben. Wenn
  // dieselbe Meldung je nach Reiter die Farbe wechselt, ist Farbe keine
  // Information mehr, sondern Dekoration je Seite -- der Nutzer lernt nichts,
  // was er auf der naechsten Seite wiederverwenden koennte.
  //
  // Die Flaeche traegt jetzt die HOECHSTE Stufe dessen, was in ihr steht. Die
  // Ansicht darf die Dichte aendern (Karte statt Zeile), nie die Farbe.
  var hoechste = null;
  var hoechsterRang = -1;
  gezeigt.forEach(function (e) {
    var r = (HD.D.status[e.status] || {}).rang;
    if (r != null && r > hoechsterRang) { hoechsterRang = r; hoechste = e.status; }
  });
  var stufe = hoechste ? ' data-stufe="' + HD.esc(hoechste) + '"' : "";
  return '<section class="achtung-widget"' + stufe + ">" + HD.gruppeHTML(HD.W.ccDrei, offene.length || null, offenAn)
    + (offenAn ? '<div class="widget-rumpf">' + rumpf
        + '<p class="sektion-fuss"><button class="widget-link" data-ziel="zutun">'
        + HD.esc(HD.W.ccAllesOffene) + "</button></p></div>" : "")
    + "</section>";
};

HD.ueberblickSeite = function () {
  return HD.seitenKopfHTML("ueberblick")
    + '<div class="cc-raster">'
    + '<div class="cc-spalte">' + HD.wGesundheit() + HD.wLogbuch() + "</div>"
    + '<div class="cc-spalte">' + HD.wDrei() + HD.sitzungenSektion() + "</div>"
    + '<div class="cc-voll">' + HD.auftragSektion() + "</div>"
    + "</div>";
};

// Die alte Ueberblick-Zusammensetzung -- bleibt als Baustein-Fundus fuer die
// naechsten Slices (Kennzahlen je Reiter-Seite, Ablaufstreifen im Harness).
HD.altUeberblickSeite = function () {
  var z = HD.D.zahlen;
  var s = HD.D.seiten.ueberblick;
  var st = HD.D.status[HD.D.gesamtstatus];
  // Wenige Karten, keine Zweitbeschreibung: das Wort auf der Karte ist der
  // Seitenname, die Notiz eine ZAHL-Aussage -- die Erklaerung steht auf der
  // Zielseite selbst (eine Sache, eine Beschreibung).
  var kacheln = [
    // Der Gesamtstatus traegt seine Statusfarbe (Glyphe im Status-Ton) --
    // der wichtigste Wert der Seite darf nicht die schwaechste Gestaltung
    // haben [Kritiker-Befund Gauntlet-Runde 1].
    { wert: st ? st.wort : "—", label: HD.W.status, notiz: null, ziel: "zutun",
      symbol: st ? st.glyphe : "circle", ton: HD.D.gesamtstatus },
    { wert: z.zutun + z.zutunDoku, label: HD.D.seiten.zutun.name,
      notiz: z.zutun + " gemessen, " + z.zutunDoku + " aus Dokumenten", ziel: "zutun", symbol: "list-checks" },
    { wert: z.dateien, label: HD.D.seiten.dateien.name, notiz: null, ziel: "dateien", symbol: "folder" },
    // Notiz ohne Zahlenreihe: vier Zahlen passten nie in eine Kachelzeile
    // ("2 Skills · 3 R...") -- die Zahlen stehen auf der Seite selbst
    // [Kritiker-Befund Gauntlet-Runde 3].
    { wert: z.hooks + z.commands + z.skills + z.rules,
      label: (HD.D.tabgruppen && HD.D.tabgruppen.harness ? HD.D.tabgruppen.harness.name : "Harness"),
      notiz: "Hooks · Commands · Skills · Rules",
      ziel: "hooks", symbol: "terminal" },
    { wert: z.projekte, label: (HD.D.tabgruppen && HD.D.tabgruppen.repos ? HD.D.tabgruppen.repos.name : "Projekte"),
      notiz: z.reposOffen === 0 ? "alle gesichert" : z.reposOffen + " mit Lücke", ziel: "projekte", symbol: "folder-open" },
  ];

  var kachelHTML = '<div class="kennzahl-reihe">' + kacheln.map(function (k) {
    var tonKlasse = k.ton && HD.D.status[k.ton]
      ? " " + HD.D.status[k.ton].token.replace("--status-", "status-") : "";
    return '<button class="kennzahl' + tonKlasse + '" data-klickbar="ja" data-ziel="' + HD.esc(k.ziel) + '">'
      + '<span class="kennzahl-kopf"><span class="kennzahl-label">' + HD.esc(k.label) + "</span>"
      + (k.ton ? '<span class="status-glyphe">' + HD.icon(k.symbol) + "</span>" : HD.icon(k.symbol)) + "</span>"
      + '<span class="kennzahl-wert">' + HD.esc(k.wert) + "</span>"
      + (k.notiz ? '<span class="kennzahl-notiz" title="' + HD.esc(k.notiz) + '">' + HD.esc(k.notiz) + "</span>" : "")
      + "</button>";
  }).join("") + "</div>";

  // Der Warnzustand DOMINIERT: amber getoente Flaeche, direkt unter den
  // Sitzungen -- das Wichtigste der Seite darf nicht so laut sein wie die
  // Doku-Sektion [Kritiker-Befund Gauntlet-Runde 2].
  var offene = HD.seitenEintraege("zutun").filter(function (e) { return e.status && e.status !== "ok"; }).slice(0, 5);
  var aufmerksam = '<section class="achtung">' + HD.gruppeHTML(HD.W.brauchtAufmerksamkeit, offene.length, true)
    + (offene.length
      ? '<div class="eintrag-liste">' + offene.map(HD.zeileHTML).join("") + "</div>"
      : HD.leerHTML("zutun")) + "</section>";

  // Ohne Zaehler-Badge: "5 Commits" ist keine Handlungszahl, und "5 Stationen"
  // erst recht nicht [Kritiker-Befund Gauntlet-Runde 3].
  var letzte = HD.seitenEintraege("commits").slice(0, 5);
  var verlauf = "<section>" + HD.gruppeHTML(HD.W.zuletztGeaendert, null, true)
    + '<div class="eintrag-liste">' + letzte.map(HD.zeileHTML).join("") + "</div></section>";

  // Reihenfolge: erst Zustand (Sitzungen, Warnflaeche, Kennzahlen, Verlauf),
  // dann Handlung (Auftrag), dann Erklaerung (Ablauf, Was fehlt) -- das
  // Formular mitten im Lesefluss unterbrach ihn [Kritiker-Befund Runde 3].
  // Das Wichtigste zuerst: die Warnflaeche VOR den Sitzungen [Kritiker-
  // Befund Runde 4: die Dringlichkeits-Hierarchie muss auch raeumlich gelten].
  return HD.seitenKopfHTML("ueberblick")
    + aufmerksam
    + HD.sitzungenSektion()
    + kachelHTML + verlauf + HD.auftragSektion() + HD.ablaufHTML() + HD.fehltHTML();
};

HD.zahl = function (n) { return typeof n === "number" ? n.toLocaleString("de-DE") : String(n); };

// Der Ablaufstreifen -- die Antwort auf "was passiert hier eigentlich".
// Jede Station springt an die Stelle, die sie beschreibt.
HD.ablaufHTML = function () {
  var hooks = HD.seitenEintraege("hooks");
  function zaehle(ereignis) {
    return hooks.filter(function (h) { return h.gruppe === ereignis; }).length;
  }
  var stationen = [
    { wort: HD.W.ablaufStart, unter: zaehle("SessionStart") + " Hooks", ziel: "hooks" },
    { wort: HD.W.ablaufKontext, unter: HD.D.zahlen.kontext + " Stücke", ziel: "kontext" },
    { wort: HD.W.ablaufWerkzeug, unter: zaehle("PreToolUse") + " Hooks", ziel: "hooks" },
    { wort: HD.W.ablaufEnde, unter: zaehle("Stop") + " Hooks", ziel: "hooks" },
    { wort: HD.W.ablaufStatusleiste, unter: "statusLine", ziel: "hooks" },
  ];
  // Standardmaessig ZU: der Streifen ist Erklaer-Material und aendert sich
  // nie -- er darf keine Premium-Flaeche belegen [Kritiker-Befund Runde 2].
  var offen = HD.S.abschnitt["gruppe:" + HD.W.soLaeuftEineSitzung] === true;
  return "<section>" + HD.gruppeHTML(HD.W.soLaeuftEineSitzung, null, offen)
    + (offen ? '<div class="ablauf">' + stationen.map(function (st, i) {
        return (i ? '<span class="ablauf-pfeil">' + HD.icon("chevron-right") + "</span>" : "")
          + '<button class="ablauf-station" data-ziel="' + HD.esc(st.ziel) + '">'
          + '<span class="ablauf-titel">' + HD.esc(st.wort) + "</span>"
          + '<span class="ablauf-text">' + HD.esc(st.unter) + "</span></button>";
      }).join("") + "</div>" : "") + "</section>";
};

// Was es hier NICHT gibt. Ohne diesen Abschnitt sucht ein Fremder nach Agents
// und MCP-Servern und haelt ihr Fehlen fuer einen Defekt des Dashboards.
HD.fehltHTML = function () {
  var fehlend = HD.D.fehlt || [];
  if (!fehlend.length) return "";
  return "<section>" + HD.gruppeHTML(HD.W.wasFehlt, fehlend.length, true)
    + '<div class="eintrag-liste">' + fehlend.map(function (f) {
        return '<div class="eintrag-zeile"><span class="eintrag-haupt">'
          + '<span class="eintrag-titel mono">' + HD.esc(f.was) + "</span>"
          + '<span class="eintrag-unter">' + HD.esc(f.grund) + "</span></span></div>";
      }).join("") + "</div></section>";
};

// --- Rohdaten ------------------------------------------------------------
HD.rohdatenSeite = function () {
  var kopf = HD.seitenKopfHTML("rohdaten");
  var meta = '<div class="eintrag-liste"><div class="eintrag-zeile"><span class="eintrag-haupt">'
    + HD.eigenschaftZeile(HD.W.schema, HD.D.schema, true)
    + HD.eigenschaftZeile(HD.W.gemessenAm, HD.D.gemessenText, true)
    + HD.eigenschaftZeile(HD.W.pfad, HD.D.wurzel, true)
    + "</span></div></div>";

  var belege = "";
  var alleFehler = (HD.D.messfehler || []).concat(HD.D.kantenFehler || []);
  if (alleFehler.length) {
    belege = "<section>" + HD.gruppeHTML(HD.W.belege, alleFehler.length, true)
      + '<div class="eintrag-liste">' + alleFehler.map(function (f) {
          return '<div class="eintrag-zeile"><span class="eintrag-haupt"><span class="eintrag-titel">'
            + HD.esc(f.was || (f.code + ": " + f.von + " → " + f.nach)) + "</span></span></div>";
        }).join("") + "</div></section>";
  }

  var baum = "<section>" + HD.gruppeHTML("JSON", 1, true)
    + '<button class="filter-chip" data-handlung="json:kopieren">' + HD.esc(HD.W.jsonKopieren) + "</button>"
    + HD.jsonBaum(HD.D.roh.messung, "messung", 0) + "</section>";
  return kopf + meta + belege + baum;
};

HD.jsonBaum = function (wert, name, tiefe) {
  if (tiefe > 6) return '<div class="eigenschaft-zeile"><span class="eigenschaft-label">' + HD.esc(name) + "</span></div>";
  if (wert === null || typeof wert !== "object") {
    var t = String(wert);
    var lang = t.length > 300;
    return '<div class="eigenschaft-zeile"><span class="eigenschaft-label">' + HD.esc(name) + "</span>"
      + '<span class="eigenschaft-wert' + (lang ? " vorhang" : "") + '">' + HD.esc(t) + "</span></div>";
  }
  var kinder = Array.isArray(wert)
    ? wert.map(function (v, i) { return HD.jsonBaum(v, String(i), tiefe + 1); })
    : Object.keys(wert).map(function (k) { return HD.jsonBaum(wert[k], k, tiefe + 1); });
  var anzahl = Array.isArray(wert) ? wert.length : Object.keys(wert).length;
  return '<details class="eigenschaft-abschnitt"' + (tiefe < 1 ? " open" : "") + "><summary>"
    + HD.esc(name) + " (" + anzahl + ")</summary>" + kinder.join("") + "</details>";
};

// --- Weiche ---------------------------------------------------------------
// DIE SEITE SPRINGT NICHT MEHR NACH OBEN [Kritik-Runde 3, Befund 4]. Jedes
// Neuzeichnen ersetzt den kompletten Inhalt der Hauptflaeche, und ein Browser
// setzt scrollTop dabei auf 0. Fuer den Nutzer hiess das: ein Klick auf eine
// Zeile weit unten in einer langen Liste, und die Liste sprang an den Anfang --
// der Alltagsschmerz mit der hoechsten Frequenz, weil er JEDEN Mausklick traf.
// Der Tastaturweg kompensierte es per scrollIntoView, der Mausweg nicht.
//
// Ein bewusster Seitenwechsel setzt die Position weiterhin auf 0; dafuer
// meldet HD.zurSeite() sich mit HD.scrollZuruecksetzen() an.
HD.seiteZeichnen = function () {
  var ziel = document.getElementById("hauptflaeche");
  var stand = HD._scrollNeu ? 0 : (ziel ? ziel.scrollTop : 0);
  HD._scrollNeu = false;
  var html;
  if (HD.S.seite === "ueberblick") html = HD.ueberblickSeite();
  else if (HD.S.seite === "dateien") html = HD.dateienSeite();
  else if (HD.S.seite === "rohdaten") html = HD.rohdatenSeite();
  else html = HD.listenSeite(HD.S.seite);
  ziel.innerHTML = html;
  if (stand) ziel.scrollTop = stand;
  // Live-Sektionen (Sitzungen, Pakete, Guard-Tests) brauchen den Server-Stand
  // -- einmal holen, dann zeichnet der Rueckruf die Seite erneut.
  if (HD.bridgeLade) HD.bridgeLade();
};

HD.scrollZuruecksetzen = function () { HD._scrollNeu = true; };
`;

module.exports = { quelltext };
