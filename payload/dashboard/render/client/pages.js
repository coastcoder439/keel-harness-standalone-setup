// BROWSER-TEIL 2 von 4: die Seiten.
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
  return '<span class="status-chip ' + klasse + '">'
    + '<span class="status-glyphe">' + HD.icon(s.glyphe) + "</span>"
    + "<span>" + HD.esc(s.wort) + "</span></span>";
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

  var kachel = e.artWort
    ? '<span class="eintrag-kachel">' + HD.icon(HD.symbolFuer(e)) + "</span>" : "";

  var metaHTML = meta.length
    ? '<span class="eintrag-meta">' + meta.map(function (s) {
        var inhalt = HD.esc(s.wert);
        if (s.chip) inhalt = '<span class="eigenschaft-pille">' + inhalt + "</span>";
        return '<span' + (s.mono ? ' class="mono"' : "") + ' title="' + HD.esc(s.label + ": " + s.wert) + '">' + inhalt + "</span>";
      }).join("") + "</span>"
    : "";

  return '<button class="eintrag-zeile" data-id="' + HD.esc(e.id) + '"'
    + (HD.S.auswahl === e.id ? ' aria-selected="true"' : "") + ">"
    + kachel
    + '<span class="eintrag-haupt">'
    + '<span class="eintrag-titel">' + HD.markiere(titelSpalte.wert || e.name, HD.S.suche) + "</span>"
    + (unterSpalte.wert ? '<span class="eintrag-unter">' + HD.markiere(unterSpalte.wert, HD.S.suche) + "</span>" : "")
    + "</span>"
    + metaHTML
    + '<span class="eintrag-schluss">' + HD.statusChip(e.status) + "</span>"
    + "</button>";
};

// --- Gruppenkopf ---------------------------------------------------------
HD.gruppeHTML = function (titel, anzahl, offen) {
  return '<button class="gruppen-kopf" data-gruppe="' + HD.esc(titel) + '" aria-expanded="' + (offen ? "true" : "false") + '">'
    + '<span class="gruppen-caret">' + HD.icon("chevron-down") + "</span>"
    + '<span class="gruppen-titel">' + HD.esc(titel) + "</span>"
    + '<span class="gruppen-zahl">' + anzahl + "</span></button>";
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
    + '<input class="suchfeld" id="suche" type="text" value="' + HD.esc(HD.S.suche) + '" autocomplete="off" spellcheck="false"'
    + ' placeholder="' + HD.esc(HD.W.suchenIn.replace("{seite}", HD.D.seiten[seite].name)) + '"'
    + ' aria-label="' + HD.esc(HD.W.suchen) + '">'
    + (HD.S.suche ? '<button class="filter-chip" data-handlung="suche:leeren">' + HD.esc(HD.W.sucheLeeren) + "</button>" : "")
    + ansicht + chips + zuruecksetzen
    + "</div>";
};

// --- Listenseite ---------------------------------------------------------
HD.listenSeite = function (seite) {
  var s = HD.D.seiten[seite];
  var liste = HD.gefiltert(seite);
  var kopf = '<p class="erklaersatz">' + HD.esc(s.zweck)
    + (s.ort ? ' <span class="pfad">' + HD.esc(s.ort) + "</span>" : "") + "</p>";
  var werkzeug = HD.werkzeugHTML(seite);

  if (!liste.length) {
    var art = HD.S.suche ? "treffer" : (HD.S.filter.length ? "filter" : (HD.D.leer[seite] ? seite : "allgemein"));
    return kopf + werkzeug + HD.leerHTML(art);
  }

  if (seite === "zutun" && HD.S.ansicht === "board") return kopf + werkzeug + HD.boardHTML(liste);

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
      return "<section>" + HD.gruppeHTML(g, nach[g].length, offen)
        + (offen ? '<div class="eintrag-liste">' + nach[g].map(HD.zeileHTML).join("") + "</div>" : "")
        + "</section>";
    }).join("");
  } else {
    koerper = '<div class="eintrag-liste">' + liste.map(HD.zeileHTML).join("") + "</div>";
  }
  return kopf + werkzeug + koerper;
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

// --- Ueberblick ----------------------------------------------------------
HD.ueberblickSeite = function () {
  var z = HD.D.zahlen;
  var s = HD.D.seiten.ueberblick;
  var st = HD.D.status[HD.D.gesamtstatus];
  var kacheln = [
    { wert: st ? st.wort : "—", label: HD.W.status, notiz: null, ziel: "zutun", symbol: st ? st.glyphe : "circle" },
    { wert: z.zutun + z.zutunDoku, label: HD.D.seiten.zutun.name,
      notiz: z.zutun + " gemessen, " + z.zutunDoku + " aus Dokumenten", ziel: "zutun", symbol: "list-checks" },
    { wert: z.hooks, label: HD.D.seiten.hooks.name, notiz: "auf " + z.hookSkripte + " Skripte", ziel: "hooks", symbol: "terminal" },
    { wert: z.dateien, label: HD.D.seiten.dateien.name, notiz: null, ziel: "dateien", symbol: "folder" },
    { wert: z.commands, label: HD.D.seiten.commands.name, notiz: null, ziel: "commands", symbol: "slash" },
    { wert: z.skills, label: HD.D.seiten.skills.name, notiz: null, ziel: "skills", symbol: "sparkles" },
    { wert: z.rules, label: HD.D.seiten.rules.name,
      notiz: HD.W.tokenSchaetzung.replace("{n}", HD.zahl(z.rulesToken)), ziel: "rules", symbol: "book-open" },
    { wert: z.repos, label: HD.D.seiten.backup.name,
      notiz: z.reposOffen === 0 ? "alle gesichert" : z.reposOffen + " mit Lücke", ziel: "backup", symbol: "hard-drive" },
  ];

  var kachelHTML = '<div class="kennzahl-reihe">' + kacheln.map(function (k) {
    return '<button class="kennzahl" data-klickbar="ja" data-ziel="' + HD.esc(k.ziel) + '">'
      + '<span class="kennzahl-kopf"><span class="kennzahl-label">' + HD.esc(k.label) + "</span>"
      + HD.icon(k.symbol) + "</span>"
      + '<span class="kennzahl-wert">' + HD.esc(k.wert) + "</span>"
      + (k.notiz ? '<span class="kennzahl-notiz">' + HD.esc(k.notiz) + "</span>" : "")
      + "</button>";
  }).join("") + "</div>";

  var offene = HD.seitenEintraege("zutun").filter(function (e) { return e.status && e.status !== "ok"; }).slice(0, 5);
  var aufmerksam = "<section>" + HD.gruppeHTML(HD.W.brauchtAufmerksamkeit, offene.length, true)
    + (offene.length
      ? '<div class="eintrag-liste">' + offene.map(HD.zeileHTML).join("") + "</div>"
      : HD.leerHTML("zutun")) + "</section>";

  var letzte = HD.seitenEintraege("commits").slice(0, 5);
  var verlauf = "<section>" + HD.gruppeHTML(HD.W.zuletztGeaendert, letzte.length, true)
    + '<div class="eintrag-liste">' + letzte.map(HD.zeileHTML).join("") + "</div></section>";

  return '<p class="erklaersatz">' + HD.esc(s.zweck) + "</p>"
    + kachelHTML + HD.ablaufHTML() + aufmerksam + verlauf + HD.fehltHTML();
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
  return "<section>" + HD.gruppeHTML(HD.W.soLaeuftEineSitzung, stationen.length, true)
    + '<div class="ablauf">' + stationen.map(function (st, i) {
        return (i ? '<span class="ablauf-pfeil">' + HD.icon("chevron-right") + "</span>" : "")
          + '<button class="ablauf-station" data-ziel="' + HD.esc(st.ziel) + '">'
          + '<span class="ablauf-titel">' + HD.esc(st.wort) + "</span>"
          + '<span class="ablauf-text">' + HD.esc(st.unter) + "</span></button>";
      }).join("") + "</div></section>";
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
  var s = HD.D.seiten.rohdaten;
  var kopf = '<p class="erklaersatz">' + HD.esc(s.zweck) + "</p>";
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
HD.seiteZeichnen = function () {
  var ziel = document.getElementById("hauptflaeche");
  var html;
  if (HD.S.seite === "ueberblick") html = HD.ueberblickSeite();
  else if (HD.S.seite === "dateien") html = HD.dateienSeite();
  else if (HD.S.seite === "rohdaten") html = HD.rohdatenSeite();
  else html = HD.listenSeite(HD.S.seite);
  ziel.innerHTML = html;
};
`;

module.exports = { quelltext };
