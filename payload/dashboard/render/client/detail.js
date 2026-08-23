// BROWSER-TEIL 3 von 4: Ordnerbaum, Dateiansicht, Eigenschaften.
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
  var kopf = '<p class="erklaersatz">' + HD.esc(s.zweck) + "</p>";
  var suchfeld = '<input class="suchfeld" id="suche" type="text" value="' + HD.esc(HD.S.suche) + '"'
    + ' autocomplete="off" spellcheck="false" placeholder="' + HD.esc(HD.W.suchenIn.replace("{seite}", s.name)) + '"'
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
    + (e.inhalt && e.inhalt.text ? '<button class="ikon-knopf" data-kopieinhalt="' + HD.esc(e.id)
       + '" aria-label="' + HD.esc(HD.W.inhaltKopieren) + '" title="' + HD.esc(HD.W.inhaltKopieren) + '">' + HD.icon("clipboard") + "</button>" : "")
    + (pfad && HD.D.wurzelUrl ? '<a class="ikon-knopf" href="' + HD.esc(HD.D.wurzelUrl + "/" + pfad)
       + '" target="_blank" rel="noopener" aria-label="' + HD.esc(HD.W.imBrowserOeffnen)
       + '" title="' + HD.esc(HD.W.imBrowserOeffnen) + '">' + HD.icon("external-link") + "</a>" : "")
    + (pfad ? '<a class="ikon-knopf" href="vscode://file/' + HD.esc(wurzelPosix + "/" + pfad)
       + '" aria-label="' + HD.esc(HD.W.inVsCodeOeffnen) + '" title="' + HD.esc(HD.W.inVsCodeOeffnen) + '">' + HD.icon("code") + "</a>" : "")
    + (inline ? "" : '<button class="ikon-knopf" id="detail-zu" aria-label="' + HD.esc(HD.W.schliessen)
       + '" title="' + HD.esc(HD.W.schliessen) + '">' + HD.icon("x") + "</button>")
    + "</span>";

  var kopf = '<div class="' + (inline ? "datei-kopf" : "detail-kopf") + '">'
    + HD.icon(HD.symbolFuer(e))
    + "<span><span class=\\"" + (inline ? "datei-name" : "detail-name") + "\\">" + HD.esc(e.name) + "</span>"
    + (pfad ? "<span class=\\"" + (inline ? "datei-pfad" : "detail-pfad") + "\\" title=\\"" + HD.esc(pfad) + "\\">" + HD.esc(pfad) + "</span>" : "")
    + "</span>" + aktionen + "</div>";

  var meta = [];
  if (e.artWort) meta.push(HD.esc(e.artWort));
  (e.felder || []).forEach(function (f) {
    if (f.label === HD.W.groesse || f.label === HD.W.zeilen || f.label === HD.W.geaendert || f.label === HD.W.git) {
      meta.push(HD.esc(f.wert));
    }
  });
  var metaHTML = '<div class="datei-meta">' + meta.map(function (m) { return "<span>" + m + "</span>"; }).join("")
    + (e.status ? HD.statusChip(e.status) : "") + "</div>";

  var beschreibung = "";
  if (e.beschreibung && e.beschreibung.text) {
    beschreibung = HD.abschnitt("beschreibung", HD.W.beschreibung,
      "<p>" + HD.esc(e.beschreibung.text) + "</p>"
      + (e.beschreibung.quelle
        ? '<p class="beschreibung-quelle">' + HD.esc(HD.W.quelle) + ": " + HD.esc(e.beschreibung.quelle)
          + (e.beschreibung.beleg ? ' <span class="pfad">' + HD.esc(e.beschreibung.beleg) + "</span>" : "") + "</p>"
        : ""), true);
  }

  var felder = (e.felder || []).map(function (f) {
    return HD.eigenschaftZeile(f.label, f.wert, f.mono, f);
  }).join("");
  var eigenschaften = felder ? HD.abschnitt("felder", HD.W.eigenschaften, felder, true) : "";

  var inhalt = HD.inhaltHTML(e, inline);

  var kanten = (e.verwandt || []).length
    ? e.verwandt.map(function (k) {
        var zielId = k.rueckwaerts ? k.von : k.nach;
        var text = k.name || zielId.replace(/^datei:/, "").replace(/^hook:/, "");
        var innen = '<span class="verknuepft-art">' + HD.esc((k.rueckwaerts ? "← " : "") + k.art) + "</span>"
          + '<span class="verknuepft-pille">' + HD.esc(text) + "</span>"
          + (k.beleg ? '<span class="verknuepft-titel">' + HD.esc(k.beleg) + "</span>" : "");
        return k.extern
          ? '<div class="verknuepft-zeile">' + innen + "</div>"
          : '<button class="verknuepft-zeile" data-id="' + HD.esc(zielId) + '">' + innen + "</button>";
      }).join("")
    : '<p class="leer-kompakt">' + HD.esc(HD.D.leer.verknuepft.text) + "</p>";
  var verknuepft = HD.abschnitt("verwandt", HD.W.verknuepftMit, kanten, true);

  var roh = HD.abschnitt("roh", HD.W.rohobjekt,
    '<div class="code-flaeche"><div class="code-text">' + HD.esc(JSON.stringify(e.roh, null, 1)) + "</div></div>", false);

  return kopf + metaHTML + beschreibung + eigenschaften + inhalt + verknuepft + roh;
};

HD.symbolFuer = function (e) {
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
HD.inhaltHTML = function (e, inline) {
  var i = e.inhalt;
  if (!i) return "";
  if (i.gesperrt) {
    return HD.abschnitt("inhalt", HD.W.dateiinhalt,
      '<p class="leer-kompakt">' + HD.esc(i.grund) + "</p>", true);
  }
  var istMd = /\\.md$/.test(e.pfad || "");
  var quelltextAn = HD.S.quelltext[e.pfad] === true;
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
  if (HD.serverModus() && HD.bearbeitbar(e.pfad)) {
    umschalter += ' <span class="ansicht-umschalter">'
      + '<button data-bearbeiten="' + HD.esc(e.pfad) + '">' + HD.esc(HD.W.bearbeiten) + "</button>"
      + "</span>";
  }

  // Im Bearbeiten-Modus ersetzt das Textfeld den Inhalt vollstaendig.
  if (HD.S.bearbeitet === e.pfad) {
    return HD.abschnitt(
      "inhalt",
      HD.W.dateiinhalt + " · " + HD.esc(e.pfad),
      '<div class="editor">'
        + '<textarea id="editor-feld" spellcheck="false" aria-label="' + HD.esc(e.pfad) + '">'
        + HD.esc(HD.S.entwurf != null ? HD.S.entwurf : i.text)
        + "</textarea>"
        + '<div class="editor-leiste">'
        + '<button class="knopf-haupt" data-speichern="' + HD.esc(e.pfad) + '">' + HD.esc(HD.W.speichern) + "</button>"
        + '<button data-bearbeiten-aus="1">' + HD.esc(HD.W.abbrechen) + "</button>"
        + '<span class="editor-pfad mono">' + HD.esc(e.pfad) + "</span>"
        + "</div></div>",
      true
    );
  }

  var koerper;
  if (istMd && !quelltextAn) {
    koerper = '<div class="md">' + (HD.D.markdown[e.pfad] || HD.esc(i.text)) + "</div>";
  } else {
    koerper = HD.codeHTML(i.text, i.ausgeblendeteZeilen);
  }
  if (i.gekuerzt) koerper = '<p class="leer-kompakt">' + HD.esc(i.gekuerztText) + "</p>" + koerper;

  // Im schmalen Panel bleibt der Inhalt zu, in der Dateiansicht offen. Ein
  // 400-Zeilen-Block in einer 320-px-Spalte ist keine Information, sondern
  // eine Wand -- aber wer auf "Dateien" geht, will genau ihn sehen.
  var vorgabe = inline || (i.zeilen != null && i.zeilen <= 80);
  var titel = HD.W.dateiinhalt + (i.zeilen != null ? " · " + i.zeilen + " Zeilen" : "") + " · " + i.sprache;
  return HD.abschnitt("inhalt", titel, koerper, vorgabe, umschalter);
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
  var zeigen = HD.S.auswahl && HD.S.seite !== "dateien";
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
