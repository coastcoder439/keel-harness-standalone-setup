// BROWSER-TEIL 4 von 6: Ordnerbaum, Dateiansicht, Eigenschaften.
//
// Hier liegt die Antwort auf die drei haertesten Beanstandungen der Vorfassung:
//   "keine ordnerstruktur auslesbar"    -> ein begehbarer Baum ueber den echten Ordner
//   "dateien nicht direktauslesbar"     -> jeder Inhalt steht in der Seite, mit
//                                          Zeilennummern bzw. gerendert
//   "aufklappmenues klappen nichts auf" -> die Abschnitte sind echte <details>.
//                                          Native Elemente klappen auch dann auf,
//                                          wenn das Skript einen Fehler hat.
//
// Klassennamen: Vertrag mit render/styles.js.

const quelltext = `
// --- Ordnerbaum ----------------------------------------------------------
HD.dateienSeite = function () {
  var s = HD.D.seiten.dateien;
  var kopf = HD.seitenKopfHTML("dateien");
  var suchfeld = '<input class="suchfeld" id="suche" type="search" name="suche" value="' + HD.esc(HD.S.suche) + '"'
    + ' autocomplete="off" spellcheck="false" enterkeyhint="search"'
    + ' placeholder="' + HD.esc(HD.W.suchenIn.replace("{seite}", s.name)) + '"'
    + ' aria-label="' + HD.esc(HD.W.suchen) + '">';

  var baum = HD.D.roh.messung.inventar && HD.D.roh.messung.inventar.baum;
  var zeilen = baum ? HD.baumZeilen(baum, 0) : [];
  var baumHTML = zeilen.length
    ? '<div class="baum" role="tree" aria-label="' + HD.esc(s.name) + '">' + zeilen.join("") + "</div>"
    : HD.leerHTML("treffer");

  return kopf + '<div class="werkzeugleiste">' + suchfeld
    + (HD.S.suche ? '<button class="filter-chip" data-handlung="suche:leeren">' + HD.esc(HD.W.sucheLeeren) + "</button>" : "")
    + "</div>"
    + '<div class="baum-flaeche">'
    + '<div class="baum">' + baumHTML + "</div>"
    + '<div class="dateiansicht">' + HD.dateiAnsichtHTML() + "</div>"
    + "</div>";
};

// Bei aktiver Suche werden nur Treffer und ihre Ahnen gezeigt -- sonst muesste
// man den Baum von Hand aufklappen, um zu sehen, was die Suche gefunden hat.
HD.trefferPfade = function () {
  if (!HD.S.suche) return null;
  var q = HD.S.suche.toLowerCase();
  var treffer = {};
  var dateien = (HD.D.roh.messung.inventar && HD.D.roh.messung.inventar.dateien) || [];
  dateien.forEach(function (d) {
    if (String(d.pfad).toLowerCase().indexOf(q) < 0) return;
    treffer[d.pfad] = true;
    var teile = d.pfad.split("/");
    var weg = "";
    for (var i = 0; i < teile.length - 1; i++) {
      weg = weg ? weg + "/" + teile[i] : teile[i];
      treffer[weg] = "ahn";
    }
  });
  return treffer;
};

HD.baumZeilen = function (knoten, tiefe) {
  var raus = [];
  var treffer = HD.trefferPfade();
  var kinder = (knoten.kinder || []).slice();

  // Dateien zuerst, dann Ordner: so steht CLAUDE.md oben und nicht unter
  // sechs Verzeichnissen. Innerhalb der Gruppen alphabetisch.
  kinder.sort(function (a, b) {
    var aOrd = (a.typ === "ordner" || a.typ === "repo") ? 1 : 0;
    var bOrd = (b.typ === "ordner" || b.typ === "repo") ? 1 : 0;
    if (aOrd !== bOrd) return aOrd - bOrd;
    return String(a.name).localeCompare(String(b.name), "de");
  });

  kinder.forEach(function (k) {
    if (treffer && !treffer[k.pfad]) return;
    var istOrdner = k.typ === "ordner";
    var offen = HD.S.baumOffen[k.pfad] === true || (treffer && treffer[k.pfad] === "ahn");
    var gewaehlt = HD.S.baumDatei === k.pfad;
    var einzug = 8 + tiefe * 18;
    var symbol = istOrdner ? (offen ? "folder-open" : "folder")
               : k.typ === "repo" ? "git-branch"
               : HD.dateiSymbol(k.name);

    var marke = "";
    if (k.typ === "repo") marke = '<span class="baum-marke">Repo</span>';
    else if (k.git === "ignoriert") marke = '<span class="baum-marke">ignoriert</span>';
    else if (k.git === "ungetrackt") marke = '<span class="baum-marke">neu</span>';

    raus.push('<button class="baum-zeile" role="treeitem"'
      + ' aria-level="' + (tiefe + 1) + '"'
      + (istOrdner ? ' aria-expanded="' + (offen ? "true" : "false") + '"' : "")
      + (gewaehlt ? ' aria-selected="true"' : "")
      + ' data-baumpfad="' + HD.esc(k.pfad) + '" data-baumtyp="' + HD.esc(k.typ) + '"'
      + ' style="padding-left:' + einzug + 'px" title="' + HD.esc(k.pfad) + '">'
      + '<span class="baum-caret"' + (istOrdner ? "" : ' data-blatt="ja"') + '>'
      + HD.icon(offen ? "chevron-down" : "chevron-right") + "</span>"
      + '<span class="baum-symbol">' + HD.icon(symbol) + "</span>"
      + '<span class="baum-name">' + HD.markiere(k.name, HD.S.suche) + "</span>"
      + marke
      + (istOrdner && k.anzahlDateien ? '<span class="baum-zahl">' + HD.esc(k.anzahlDateien) + "</span>" : "")
      + "</button>");

    if (istOrdner && offen) raus = raus.concat(HD.baumZeilen(k, tiefe + 1));
  });
  return raus;
};

HD.dateiSymbol = function (name) {
  if (/\\.md$/.test(name)) return "file-text";
  if (/\\.(js|json|mjs|cjs)$/.test(name)) return "file-code";
  return "file";
};

// --- Dateiansicht (rechts neben dem Baum) --------------------------------
HD.dateiAnsichtHTML = function () {
  if (!HD.S.baumDatei) {
    return '<div class="leerzustand">'
      + '<span class="leer-symbol">' + HD.icon("file-text") + "</span>"
      + '<span class="leer-titel">' + HD.esc(HD.W.dateiWaehlen) + "</span>"
      + '<span class="leer-text">' + HD.esc(HD.W.dateiWaehlenText) + "</span></div>";
  }
  var e = HD.eintragMit("datei:" + HD.S.baumDatei);
  if (!e) return HD.ordnerAnsichtHTML(HD.S.baumDatei);
  return HD.detailKoerper(e, true);
};

// Ein gewaehlter Ordner zeigt seine Kinder -- nicht nichts.
HD.ordnerAnsichtHTML = function (pfad) {
  var dateien = ((HD.D.roh.messung.inventar || {}).dateien || []).filter(function (d) {
    return d.pfad.indexOf(pfad + "/") === 0;
  });
  var kopf = '<div class="datei-kopf">' + HD.icon("folder-open")
    + '<span><span class="datei-name">' + HD.esc(pfad.split("/").pop()) + "</span>"
    + '<span class="datei-pfad">' + HD.esc(pfad) + "</span></span></div>";
  if (!dateien.length) return kopf + HD.leerHTML("allgemein");
  return kopf + '<div class="eintrag-liste">' + dateien.map(function (d) {
    var e = HD.eintragMit(d.id);
    return '<button class="eintrag-zeile" data-id="' + HD.esc(d.id) + '">'
      + '<span class="eintrag-kachel">' + HD.icon(HD.dateiSymbol(d.name)) + "</span>"
      + '<span class="eintrag-haupt"><span class="eintrag-titel">' + HD.esc(d.name) + "</span>"
      + '<span class="eintrag-unter">' + HD.esc((e && e.beschreibung && e.beschreibung.text) || "") + "</span></span>"
      + '<span class="eintrag-meta"><span class="mono">' + HD.esc(HD.groesse(d.bytes)) + "</span></span></button>";
  }).join("") + "</div>";
};

HD.groesse = function (n) {
  if (typeof n !== "number") return "—";
  if (n < 1024) return n + " B";
  if (n < 1048576) return (n / 1024).toFixed(1).replace(".", ",") + " KB";
  return (n / 1048576).toFixed(1).replace(".", ",") + " MB";
};

// --- Eigenschaften -------------------------------------------------------
HD.eigenschaftZeile = function (label, wert, mono, extra) {
  extra = extra || {};
  var w = HD.esc(wert);
  if (extra.sprung) w = '<button class="verknuepft-pille" data-id="' + HD.esc(extra.sprung) + '">' + w + "</button>";
  if (extra.kopieren) w = w + ' <button class="ikon-knopf" data-kopie="' + HD.esc(wert) + '" aria-label="'
    + HD.esc(HD.W.kopieren) + '">' + HD.icon("copy") + "</button>";
  return '<div class="eigenschaft-zeile"><span class="eigenschaft-label">' + HD.esc(label) + "</span>"
    + '<span class="eigenschaft-wert' + (mono ? " pfad" : "") + '">' + w
    + (extra.beleg ? ' <span class="pfad">' + HD.esc(extra.beleg) + "</span>" : "")
    + "</span></div>";
};

// --- Abschnitt: echtes <details> -----------------------------------------
// Native Elemente klappen ohne Skript. Die Vorfassung baute Pfeile aus Knoepfen
// nach, und wenn der Zeichenlauf danebenlief, blieb ein Pfeil ohne Wirkung
// stehen -- genau die Beanstandung.
HD.abschnitt = function (schluessel, titel, rumpf, offenVorgabe, kopfZusatz) {
  if (!rumpf) return "";
  var offen = HD.S.abschnitt[schluessel];
  if (offen === undefined) offen = offenVorgabe !== false;
  return '<details class="eigenschaft-abschnitt" data-abschnitt="' + HD.esc(schluessel) + '"' + (offen ? " open" : "") + ">"
    + "<summary>" + HD.esc(titel) + (kopfZusatz || "") + "</summary>"
    + rumpf + "</details>";
};

// --- Detail-Koerper (Panel rechts UND Dateiansicht) ----------------------
HD.detailKoerper = function (e, inline) {
  var pfad = e.pfad || null;
  var wurzelPosix = String(HD.D.wurzel || "").split("\\\\").join("/");
  var aktionen = '<span class="' + (inline ? "datei-aktionen" : "detail-aktionen") + '">'
    + (pfad ? '<button class="ikon-knopf" data-kopie="' + HD.esc(pfad) + '" aria-label="' + HD.esc(HD.W.pfadKopieren)
       + '" title="' + HD.esc(HD.W.pfadKopieren) + '">' + HD.icon("copy") + "</button>" : "")
    + (pfad && HD.serverModus() && e.inhalt && !e.inhalt.gesperrt ? '<button class="ikon-knopf" data-kopieinhalt="' + HD.esc(pfad)
       + '" aria-label="' + HD.esc(HD.W.inhaltKopieren) + '" title="' + HD.esc(HD.W.inhaltKopieren) + '">' + HD.icon("clipboard") + "</button>" : "")
    + (pfad && HD.D.wurzelUrl ? '<a class="ikon-knopf" href="' + HD.esc(HD.D.wurzelUrl + "/" + pfad)
       + '" target="_blank" rel="noopener" aria-label="' + HD.esc(HD.W.imBrowserOeffnen)
       + '" title="' + HD.esc(HD.W.imBrowserOeffnen) + '">' + HD.icon("external-link") + "</a>" : "")
    + (pfad ? '<a class="ikon-knopf" href="vscode://file/' + HD.esc(wurzelPosix + "/" + pfad)
       + '" aria-label="' + HD.esc(HD.W.inVsCodeOeffnen) + '" title="' + HD.esc(HD.W.inVsCodeOeffnen) + '">' + HD.icon("code") + "</a>" : "")
    // GANZ OEFFNEN [Owner, 25.08.2026: "vollkommen lesen und bearbeiten"]. Im
    // schmalen Panel bleibt ein langer Rumpf zugeklappt -- eine 400-Zeilen-Wand
    // in 320 px ist keine Information. Damit "zugeklappt" keine Sackgasse ist,
    // fuehrt dieser Knopf dieselbe Datei in die volle Dateiansicht hinueber
    // (HD.dateiWaehlen, derselbe Weg wie der Dateibaum -- kein zweiter
    // Mechanismus). Nur im Panel und nur bei einer lesbaren Datei.
    + (!inline && pfad && e.inhalt && !e.inhalt.gesperrt
       ? '<button class="ikon-knopf" data-pfadziel="dateien" data-pfadpfad="' + HD.esc(pfad)
         + '" aria-label="' + HD.esc(HD.W.ganzOeffnen) + '" title="' + HD.esc(HD.W.ganzOeffnen) + '">'
         + HD.icon("maximize") + "</button>"
       : "")
    + (inline ? "" : '<button class="ikon-knopf" id="detail-zu" aria-label="' + HD.esc(HD.W.schliessen)
       + '" title="' + HD.esc(HD.W.schliessen) + '">' + HD.icon("x") + "</button>")
    + "</span>";

  var kopf = '<div class="' + (inline ? "datei-kopf" : "detail-kopf") + '">'
    + HD.icon(HD.symbolFuer(e))
    + "<span><span class=\\"" + (inline ? "datei-name" : "detail-name") + "\\">" + HD.esc(e.name) + "</span>"
    + (pfad ? "<span class=\\"" + (inline ? "datei-pfad" : "detail-pfad") + "\\" title=\\"" + HD.esc(pfad) + "\\">" + HD.esc(pfad) + "</span>" : "")
    + "</span>" + aktionen + "</div>";

  // Metazeile knapp: Art und Aenderungsdatum. Groesse/Zeilen/Git-Zustand
  // interessieren beim Lesen nicht [Owner, 25.08.2026] -- wer sie braucht,
  // findet sie unter Rohdaten.
  var meta = [];
  if (e.artWort) meta.push(HD.esc(e.artWort));
  (e.felder || []).forEach(function (f) {
    if (f.label === HD.W.geaendert) meta.push(HD.esc(f.wert));
  });
  var metaHTML = '<div class="datei-meta">' + meta.map(function (m) { return "<span>" + m + "</span>"; }).join("")
    + (e.status ? HD.statusChip(e.status) : "") + "</div>";

  // Beschreibung als schlichter Absatz -- kein Aufklapper. Ein Satz mit
  // Quellenangabe ist Information; ein <details> darum herum ist Geruest.
  // AUSNAHME: stammt die Beschreibung aus dem ERSTEN ABSATZ der Datei und der
  // Inhalt steht direkt darunter offen, stuende derselbe Satz zweimal
  // untereinander (Beanstandung A7) -- dann traegt ihn nur der Inhalt.
  var inhaltOffen = inline && e.inhalt && !e.inhalt.gesperrt;
  var ausInhalt = e.beschreibung
    && (e.beschreibung.quelle === HD.W.quelleAbsatz || e.beschreibung.quelle === HD.W.quelleEinleitung);
  var beschreibung = "";
  if (e.beschreibung && e.beschreibung.text && !(inhaltOffen && ausInhalt)) {
    beschreibung = '<div class="detail-beschreibung"><p>' + HD.esc(e.beschreibung.text) + "</p>"
      + (e.beschreibung.quelle
        ? '<p class="beschreibung-quelle">' + HD.esc(HD.W.quelle) + ": " + HD.esc(e.beschreibung.quelle)
          + (e.beschreibung.beleg ? ' <span class="pfad">' + HD.esc(e.beschreibung.beleg) + "</span>" : "") + "</p>"
        : "") + "</div>";
  }

  // WENIGER IST MEHR [Owner, 25.08.2026]: eine DATEI zeigt Kopf, eine
  // Metazeile, den Beschreibungssatz und ihren Inhalt mit Bearbeiten-Knopf --
  // kein Eigenschaften-/Rohobjekt-/Verknuepft-Geruest. Die Feldtabelle bleibt
  // nur fuer Eintraege OHNE Dateirumpf (Hooks, Repos, Kontext-Stuecke), wo die
  // Verdrahtung selbst die Information ist.
  var istDatei = !!e.inhalt;
  var felder = istDatei ? "" : (e.felder || []).map(function (f) {
    return HD.eigenschaftZeile(f.label, f.wert, f.mono, f);
  }).join("");
  var eigenschaften = felder ? HD.abschnitt("felder", HD.W.eigenschaften, felder, true) : "";

  var inhalt = HD.inhaltHTML(e, inline);
  // Bei einem Projekt: die Dokumente je Projekt (S5). Fuer alles andere leer.
  var dokumente = HD.projektDokumenteHTML(e);
  // PROJEKT-DETAIL: Arbeitspakete als Kanban und die Sitzungen, die hier
  // arbeiten [Owner-Wunsch W7, korrigiert 27.08.2026]. Bis dahin stand hier
  // NICHTS, mit der Begruendung, alle Pakete lebten ohnehin im Workspace --
  // das war eine Messung, aus der ich meinen eigenen Weg ableitete statt des
  // gewuenschten. Ein Projekt ohne Pakete zeigt jetzt den Leerzustand mit
  // seinem naechsten Schritt, statt die Frage gar nicht zu stellen.
  // Der Kanban steht nicht im schmalen Panel, sondern auf der Projektseite in
  // der Hauptflaeche (HD.projektSeite): drei Spalten in 320 Bildpunkten waeren
  // drei Streifen. Regel T7 -- Tabellen und Boards gehoeren in die groesste
  // verfuegbare Breite, nie in die Detailspalte.
  var kanban = "";

  return kopf + metaHTML + beschreibung + kanban + eigenschaften + inhalt + dokumente;
};

HD.symbolFuer = function (e) {
  // Hooks: EIN Symbol fuer alle -- die Wirkung kodiert die getoente Pille in
  // der Zeile; wechselnde Icons je Wirkung lasen sich als System-Bruch
  // [Kritiker-Befund Gauntlet-Runde 2, revidiert Runde 1].
  if (e.art === "hook-skript" || e.art === "skript") return "terminal";
  if (e.art === "command") return "slash";
  if (e.art === "skill" || e.art === "skill-datei") return "sparkles";
  if (e.art === "dauer-regel") return "book-open";
  if (e.art === "repo") return "git-branch";
  if (e.art === "ordner") return "folder";
  if (e.pfad) return HD.dateiSymbol(e.pfad);
  return "file";
};

// --- Dateiinhalt ---------------------------------------------------------
// SERVER-ZUERST (Entscheidung D1): der Rumpf steht NICHT mehr im Datensatz.
// Diese Funktion zeichnet nur die Huelle -- Ueberschrift, Umschalter und einen
// leeren Kasten mit data-inhalt. HD.inhaltLaden() (unten) fuellt ihn nach dem
// Zeichnen aus serve.js. Ohne Server bleibt ein ehrlicher Hinweis stehen.
HD.inhaltHTML = function (e, inline) {
  // Nur ECHTE Datei-Eintraege tragen ein inhalt-Objekt. Projekte (ein
  // Verzeichnis) und abgeleitete Eintraege haben keins -- fuer sie gibt es hier
  // nichts, sonst wuerde ein Kasten den Ordnerpfad wie eine Datei abrufen.
  var i = e.inhalt;
  if (!i) return "";
  var pfad = e.pfad || "";
  if (!pfad) return "";
  if (i.gesperrt) {
    return HD.abschnitt("inhalt", HD.W.dateiinhalt,
      '<p class="leer-kompakt">' + HD.esc(i.grund) + "</p>", true);
  }
  var istMd = /\\.md$/.test(pfad);
  var quelltextAn = HD.S.quelltext[pfad] === true;
  var umschalter = istMd
    ? ' <span class="ansicht-umschalter">'
      + '<button data-quelltext="0" aria-pressed="' + (!quelltextAn) + '">' + HD.esc(HD.W.gerendert) + "</button>"
      + '<button data-quelltext="1" aria-pressed="' + quelltextAn + '">' + HD.esc(HD.W.quelltext) + "</button>"
      + "</span>"
    : "";

  // Der Bearbeiten-Knopf erscheint NUR, wenn die Seite von einem Server kommt.
  // Als Datei geoeffnet (file:) kann nichts zurueckgeschrieben werden -- ein
  // Knopf, der dann nichts tut, waere eine Luege. Wer die Seite weitergibt,
  // gibt keinen Schreibzugang mit.
  if (HD.serverModus() && HD.bearbeitbar(pfad)) {
    // Bearbeiten ist DIE Handlung dieser Ansicht [Owner: Datei-Klick =
    // Editier-Fenster] -- ein Haupt-Knopf, kein grauer Umschalter-Rest.
    umschalter += ' <button class="knopf-haupt" data-bearbeiten="' + HD.esc(pfad) + '">'
      + HD.esc(HD.W.bearbeiten) + "</button>";
  }

  // Bearbeiten-Modus: das Textfeld zeigt den frisch geholten Rohtext. Er steht
  // in HD.S.entwurf -- start.js fuellt ihn VOR dem Oeffnen (per serve.js) und
  // oeffnet gar nicht erst, wenn die Datei maskierte Zugangszeilen enthaelt.
  if (HD.S.bearbeitet === pfad) {
    return HD.abschnitt(
      "inhalt",
      HD.W.dateiinhalt + " · " + HD.esc(pfad),
      '<div class="editor">'
        + '<textarea id="editor-feld" spellcheck="false" aria-label="' + HD.esc(pfad) + '">'
        + HD.esc(HD.S.entwurf != null ? HD.S.entwurf : "")
        + "</textarea>"
        + '<div class="editor-leiste">'
        + '<button class="knopf-haupt" data-speichern="' + HD.esc(pfad) + '">' + HD.esc(HD.W.speichern) + "</button>"
        + '<button data-bearbeiten-aus="1">' + HD.esc(HD.W.abbrechen) + "</button>"
        + '<span class="editor-pfad mono">' + HD.esc(pfad) + "</span>"
        + "</div></div>",
      true
    );
  }

  var koerper;
  if (!HD.serverModus()) {
    // Als Datei geoeffnet gibt es niemanden, der den Rumpf liefern koennte.
    koerper = '<p class="leer-kompakt">' + HD.esc(HD.W.inhaltNurServer) + "</p>";
  } else {
    // Leerer Kasten -- HD.inhaltLaden() traegt den Rumpf nach dem Zeichnen ein.
    koerper = '<div class="datei-inhalt" data-inhalt="' + HD.esc(pfad) + '"'
      + ' data-md="' + (istMd && !quelltextAn ? "1" : "0") + '">'
      + '<p class="leer-kompakt">' + HD.esc(HD.W.laedtInhalt) + "</p></div>";
  }
  // Im schmalen Panel bleibt der Inhalt zu, in der Dateiansicht offen. Ein
  // 400-Zeilen-Block in einer 320-px-Spalte ist keine Information, sondern
  // eine Wand -- aber wer auf "Dateien" geht, will genau ihn sehen.
  var vorgabe = inline || (i && i.zeilen != null && i.zeilen <= 80);
  var titel = HD.W.dateiinhalt
    + (i && i.zeilen != null ? " · " + i.zeilen + " Zeilen" : "")
    + (i && i.sprache ? " · " + i.sprache : "");
  return HD.abschnitt("inhalt", titel, koerper, vorgabe, umschalter);
};

// Rumpf auf Abruf holen -- EINE Stelle fuer Anzeige, Editor und Kopieren. Die
// Antwort von serve.js traegt {text, html?, ausgeblendeteZeilen, bytes}; text
// ist bereits zeilenweise gefiltert. Ergebnisse werden gemerkt, damit ein
// Umschalten (gerendert/Quelltext) nicht erneut ueber das Netz geht.
HD._inhaltCache = {};
// frisch=true umgeht den Cache und ueberschreibt ihn mit dem frischen Stand. Der
// Editor MUSS das tun: der Cache wird sonst nie ungueltig, und mehrere Sitzungen
// teilen sich hier einen Arbeitsbaum (CLAUDE.md). Ein veralteter Cache-Eintrag
// mit ausgeblendeteZeilen:[] wuerde sonst die Geheimnis-Sperre beim Oeffnen
// umgehen -- und ein Speichern schriebe den alten Stand ueber ein inzwischen
// hinzugekommenes Geheimnis. (Fund aus dem Sicherheits-Review, 23.08.2026.)
HD.dateiHolen = function (pfad, fertig, frisch) {
  if (!frisch && HD._inhaltCache[pfad]) { fertig(null, HD._inhaltCache[pfad]); return; }
  fetch("datei?pfad=" + encodeURIComponent(pfad))
    .then(function (a) { return a.json().then(function (j) { return { ok: a.ok, j: j }; }); })
    .then(function (r) {
      if (!r.ok) throw new Error((r.j && r.j.fehler) || "unbekannt");
      HD._inhaltCache[pfad] = r.j;
      fertig(null, r.j);
    })
    .catch(function (e) { fertig(e.message || "unbekannt", null); });
};

// Nach jedem Zeichnen aufgerufen (core.js): jeden leeren Kasten fuellen.
// Idempotent -- ein bereits gefuellter Kasten (data-geladen) wird uebersprungen.
HD.inhaltLaden = function () {
  if (!HD.serverModus()) return;
  var kaesten = document.querySelectorAll(".datei-inhalt[data-inhalt]");
  for (var k = 0; k < kaesten.length; k++) {
    (function (kasten) {
      if (kasten.getAttribute("data-geladen")) return;
      // Lazy: ein Kasten in einem ZUGEKLAPPTEN Abschnitt wird noch nicht geholt.
      // Beim Aufklappen zeichnet die Seite neu (start.js) -- dann greift es. So
      // laedt ein Projekt mit vielen docs/ nicht auf einen Schlag alle Ruempfe.
      // (Vorfahren-Durchlauf statt "details:not([open])" -- der CSS-Selektor
      // saehe im Quelltext aus wie ein Funktionsaufruf "not(".)
      var vorfahr = kasten.parentElement;
      while (vorfahr) {
        if (vorfahr.tagName === "DETAILS" && !vorfahr.open) return;
        vorfahr = vorfahr.parentElement;
      }
      var pfad = kasten.getAttribute("data-inhalt");
      var md = kasten.getAttribute("data-md") === "1";
      kasten.setAttribute("data-geladen", "laeuft");
      HD.dateiHolen(pfad, function (fehler, d) {
        // Zwischenzeitlich neu gezeichnet? Dann haengt dieser Kasten nicht mehr
        // im Dokument und darf nichts mehr schreiben.
        if (!kasten.isConnected) return;
        if (fehler) {
          kasten.innerHTML = '<p class="leer-kompakt">'
            + HD.esc(HD.fuellen(HD.W.inhaltFehler, { grund: fehler })) + "</p>";
          kasten.setAttribute("data-geladen", "ja");
          return;
        }
        if (md && d.html != null) kasten.innerHTML = '<div class="md">' + d.html + "</div>";
        else kasten.innerHTML = HD.codeHTML(d.text, d.ausgeblendeteZeilen);
        kasten.setAttribute("data-geladen", "ja");
      });
    })(kaesten[k]);
  }
};

// --- Dokumente je Projekt (S5) -------------------------------------------
// Die Projektansicht zeigte bisher nur die ZAHL der Dokumente. Hier werden sie
// wirklich angebaut: Wurzel-Dokumente (README/ZIEL) aufgeklappt und lesbar,
// der docs/-Baum als zugeklappte Liste. Der Inhalt kommt in beiden Faellen auf
// Klick von serve.js (D1) -- user-projects/ steht nicht im Dateibaum, also ist
// das hier der einzige Ort, an dem man diese Dateien ueberhaupt liest.
HD.projektDokBlock = function (dok, offen) {
  var istMd = /\\.md$/.test(dok.pfad || "");
  var meta = ' <span class="abschnitt-meta mono">' + HD.esc(HD.groesse(dok.bytes)) + "</span>";
  var kasten = HD.serverModus()
    ? '<div class="datei-inhalt" data-inhalt="' + HD.esc(dok.pfad) + '" data-md="' + (istMd ? "1" : "0") + '">'
      + '<p class="leer-kompakt">' + HD.esc(HD.W.laedtInhalt) + "</p></div>"
    : '<p class="leer-kompakt">' + HD.esc(HD.W.inhaltNurServer) + "</p>";
  // Eigener Zustandsschluessel je Datei, sonst teilen sich alle Bloecke einen.
  return HD.abschnitt("projektdok:" + dok.pfad, dok.name, kasten, offen, meta);
};

HD.projektDokumenteHTML = function (e) {
  var d = e.dokumente;
  if (!d) return "";
  if (d.leer) {
    return HD.abschnitt("dokumente", HD.W.dokumente,
      '<p class="leer-kompakt">' + HD.esc(d.leerText || "") + "</p>"
      + (d.leerHinweis ? '<p class="leer-kompakt">' + HD.esc(d.leerHinweis) + "</p>" : ""), true);
  }
  var teile = "";
  // Wurzel-Dokumente zuerst und offen -- das ist die Frage, mit der man ein
  // Projekt aufschlaegt.
  (d.wurzel || []).forEach(function (dok) { teile += HD.projektDokBlock(dok, true); });
  // docs/ als zugeklappte Liste -- Inhalt laedt erst beim Aufklappen (lazy).
  (d.doku || []).forEach(function (dok) { teile += HD.projektDokBlock(dok, false); });
  if (d.gekappt && d.gekapptText) teile += '<p class="leer-kompakt">' + HD.esc(d.gekapptText) + "</p>";
  return HD.abschnitt("dokumente", HD.W.dokumente, teile, true);
};

HD.codeHTML = function (text, ausgeblendet) {
  var zeilen = String(text == null ? "" : text).split("\\n");
  if (zeilen.length && zeilen[zeilen.length - 1] === "") zeilen.pop();
  var aus = {};
  (ausgeblendet || []).forEach(function (n) { aus[n] = true; });
  var nummern = zeilen.map(function (z, i) { return i + 1; }).join("\\n");
  var rumpf = zeilen.map(function (z, i) {
    return '<span class="code-zeile"' + (aus[i + 1] ? ' data-treffer="ja"' : "") + ">" + HD.esc(z) + "</span>";
  }).join("\\n");
  return '<div class="code-flaeche"><pre class="code-rinne">' + nummern + "</pre>"
    + '<pre class="code-text">' + rumpf + "</pre></div>";
};

// --- Das Panel rechts ----------------------------------------------------
HD.detailZeichnen = function () {
  var panel = document.getElementById("detail");
  var koerper = document.getElementById("detail-koerper");
  // Auf "Projekte" traegt die HAUPTFLAECHE das Projekt (HD.projektSeite) --
  // dasselbe Ding zweimal nebeneinander waere zwei Wahrheiten auf einem Schirm.
  // Ein offenes Dokument gewinnt: es ist das, was der Nutzer zuletzt angeklickt
  // hat, und es gilt auf JEDER Seite [W8].
  if (HD.S.dokument) {
    panel.hidden = false;
    panel.style.setProperty("--detail-breite", HD.S.breite + "px");
    if (HD.S.vollbild) panel.setAttribute("data-vollbild", "ja");
    else panel.removeAttribute("data-vollbild");
    koerper.innerHTML = HD.detailKoerper(HD.dokumentEintrag(HD.S.dokument), false);
    return;
  }
  var zeigen = HD.S.auswahl && HD.S.seite !== "dateien" && HD.S.seite !== "projekte";
  if (!zeigen) { panel.hidden = true; return; }
  var e = HD.eintragMit(HD.S.auswahl);
  if (!e) { panel.hidden = true; return; }
  panel.hidden = false;
  panel.style.setProperty("--detail-breite", HD.S.breite + "px");
  if (HD.S.vollbild) panel.setAttribute("data-vollbild", "ja");
  else panel.removeAttribute("data-vollbild");
  koerper.innerHTML = HD.detailKoerper(e, false);
};
`;

module.exports = { quelltext };
