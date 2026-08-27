// BROWSER-TEIL 3 von 6: die Projekt-Flaechen zeichnen die Karten, das Gitter
// mit seinen Filtern und die Projektseite in der Hauptflaeche.
//
// Ausgelagert aus pages.js am 27.08.2026, als die 800-Zeilen-Klinke fiel. Hier
// lebt alles, was ein PROJEKT zeigt: die Karte im Gitter, das Gitter samt
// Filtern und die Projektseite in der Hauptflaeche.
//
// Massstab ist der genehmigte Entwurf docs/plans/dashboard-v3/mockups/
// d-projekte.html und 01-product.md ("Projektliste als Karten (offene Pakete,
// Sicherungsstand). Klick -> PROJEKT-DETAILSEITE mit Reitern Arbeitspakete,
// Sicherung, Commits").
//
// Die Klassennamen stammen aus render/styles-extra.js und sind nicht verhandelbar.

const quelltext = `
// --- Ein Projekt in der Hauptflaeche [Owner-Wunsch W7, gebaut 27.08.2026] --
// "Klick auf Projekt -> Arbeitspakete als Kanban, Reiter Sicherung und Verlauf
// je Projekt": ein Projekt ist ein ORT, keine Eigenschaftsliste im Panel. Die
// Seite traegt deshalb den vollen Platz -- Kopf, Arbeitspakete als Kanban,
// die Sitzungen, die hier arbeiten, und die Dokumente des Projekts.
// Eine Projekt-Karte: Name · Satz auf zwei Zeilen · Sitzungs-Chips · Standzeile
// mit Sicherungspunkt, Paketstand und Balken [Entwurf d-projekte.html].
// Jede Angabe ist gemessen: Pakete aus bridge.scanPackages, Sitzungen aus
// bridge.scanSessions (Rolle -> Projekt), Sicherung aus der Backup-Messung.
HD.projektKarteHTML = function (e) {
  var pakete = HD.projektPakete ? HD.projektPakete(e.name) : null;
  var fertig = 0;
  if (pakete) {
    fertig = pakete.filter(function (p) {
      return p.totalSteps > 0 && p.doneSteps === p.totalSteps;
    }).length;
  }
  var anteil = pakete && pakete.length ? Math.round((fertig / pakete.length) * 100) : 0;
  var standSatz = !pakete
    ? HD.W.laedtNoch
    : (pakete.length
        ? HD.fuellen(HD.W.projektKartePakete, { done: fertig, total: pakete.length })
        : HD.W.projektKarteOhnePakete);

  // Sicherung: der gemessene Eintrag desselben Repos auf der Sicherungs-Seite.
  var sicherung = HD.eintragMit("repo:" + e.name);
  var luecke = !!(sicherung && sicherung.status && sicherung.status !== "ok");
  var sicherWort = luecke ? HD.W.projektKarteLuecke : HD.W.projektKarteSicher;

  var sitzungen = HD.projektSitzungen ? (HD.projektSitzungen(e.name) || []) : [];
  var laufend = sitzungen.filter(function (s) { return s.active; });
  var schips = laufend.map(function (s) {
    var name = s.title || HD.W.sitzungOhneTitel;
    return '<span class="projekt-schip" title="' + HD.esc(name) + '">' + HD.esc(name) + "</span>";
  }).join("");

  var satz = (e.beschreibung && e.beschreibung.text) || e.unter || "";
  return '<button class="projekt-karte" data-id="' + HD.esc(e.id) + '"'
    + (HD.S.auswahl === e.id ? ' aria-selected="true"' : "") + ">"
    + '<span class="projekt-name">' + HD.markiere(HD.klartext(e.name), HD.S.suche) + "</span>"
    + '<span class="projekt-satz">' + HD.markiere(HD.klartext(satz), HD.S.suche) + "</span>"
    + '<span class="projekt-sitzungen">' + schips + "</span>"
    + '<span class="projekt-stand">'
    + '<span class="projekt-punkt" data-luecke="' + (luecke ? "ja" : "nein") + '" title="'
    + HD.esc(sicherWort) + '"></span>'
    + "<span>" + HD.esc(standSatz) + "</span>"
    // Ein Balken ohne Pakete waere eine leere Spur, die Fortschritt behauptet.
    + (pakete && pakete.length
        ? '<span class="projekt-balken" role="img" aria-label="' + HD.esc(standSatz) + '">'
          + '<i style="width:' + anteil + '%"></i></span>'
        : "")
    + "</span>"
    + "</button>";
};

// Die drei Filter des Entwurfs. Sie stehen nur da, wenn sie etwas ausrichten:
// ein Filter, der alle 22 Karten zeigt, ist ein Knopf ohne Wirkung.
HD.PROJEKT_FILTER = [
  { code: "sitzung", wort: "projektFilterAktive",
    passt: function (e) { return (HD.projektSitzungen(e.name) || []).some(function (s) { return s.active; }); } },
  { code: "pakete", wort: "projektFilterPakete",
    passt: function (e) {
      var p = HD.projektPakete(e.name) || [];
      return p.some(function (x) { return !(x.totalSteps > 0 && x.doneSteps === x.totalSteps); });
    } },
  { code: "luecke", wort: "projektFilterLuecke",
    passt: function (e) {
      var s = HD.eintragMit("repo:" + e.name);
      return !!(s && s.status && s.status !== "ok");
    } },
];

HD.projektNetzHTML = function (liste) {
  var aktiv = HD.S.projektFilter || null;
  var pillen = "";
  if (HD.bridgeData && !HD.bridgeData.error) {
    pillen = HD.PROJEKT_FILTER.map(function (f) {
      var n = liste.filter(f.passt).length;
      if (!n || n === liste.length) return "";
      var an = aktiv === f.code;
      return '<button class="filter-chip" data-projektfilter="' + f.code + '" aria-pressed="' + (an ? "true" : "false") + '">'
        + HD.esc(HD.W[f.wort]) + " " + n + "</button>";
    }).join("");
  }
  var gezeigt = liste;
  if (aktiv) {
    var f = HD.PROJEKT_FILTER.filter(function (x) { return x.code === aktiv; })[0];
    if (f) gezeigt = liste.filter(f.passt);
  }
  var netz = gezeigt.length
    ? '<div class="projekt-netz">' + gezeigt.map(HD.projektKarteHTML).join("") + "</div>"
    : HD.leerHTML("filter");
  return (pillen ? '<div class="werkzeugleiste">' + pillen + "</div>" : "") + netz;
};

// Die drei Reiter einer Projektseite [01-product.md: "PROJEKT-DETAILSEITE mit
// Reitern Arbeitspakete, Sicherung, Commits"]. Owner-Befund 26.08.: "ich kann
// mir unter Sicherung und Verlauf nichts vorstellen" -- deshalb zeigt jeder
// Reiter den ECHTEN Inhalt fuer DIESES Projekt, nicht eine leere Huelse.
HD.PROJEKT_REITER = [
  { code: "pakete", wort: "projektReiterPakete" },
  { code: "sicherung", wort: "projektReiterSicherung" },
  { code: "verlauf", wort: "projektReiterVerlauf" },
];

HD.projektReiterHTML = function () {
  var jetzt = HD.S.projektReiter || "pakete";
  return '<div class="tab-leiste" role="tablist">' + HD.PROJEKT_REITER.map(function (r) {
    var an = jetzt === r.code;
    return '<button class="tab" role="tab" aria-selected="' + (an ? "true" : "false") + '"'
      + ' data-projektreiter="' + HD.esc(r.code) + '">' + HD.esc(HD.W[r.wort]) + "</button>";
  }).join("") + "</div>";
};

// Sicherung dieses Projekts: derselbe gemessene Eintrag wie auf der
// Sicherungs-Seite, nur hier bei seinem Projekt.
HD.projektSicherungHTML = function (e) {
  var s = HD.eintragMit("repo:" + e.name);
  if (!s) return HD.leerHTML("allgemein");
  // Ein Feld, dessen Label sein eigener Wert ist, ist ein Satz ohne Zeile --
  // es steht als Erklaersatz unter den Daten, nicht als Label-Wert-Paar.
  var saetze = (s.felder || []).filter(function (f) { return f.label === f.wert; });
  var zeilen = (s.felder || []).filter(function (f) { return f.label !== f.wert; })
    .map(function (f) { return HD.eigenschaftZeile(f.label, f.wert, f.mono, f); }).join("");
  var fuss = saetze.map(function (f) {
    return '<p class="erklaersatz">' + HD.esc(f.wert) + "</p>";
  }).join("");
  var kopf = s.status ? '<p class="erklaersatz">' + HD.statusChip(s.status) + "</p>" : "";
  return "<section>" + kopf + '<div class="eigenschaft-block">' + zeilen + "</div>" + fuss + "</section>";
};

// Verlauf dieses Projekts: die gemessenen Commits, nach Tag gruppiert -- also
// dieselbe Ordnung wie auf der Verlaufs-Seite, gefiltert auf dieses Repo.
HD.projektVerlaufHTML = function (e) {
  var alle = HD.seitenEintraege("commits").filter(function (c) {
    var repo = (c.roh || {}).repo || "";
    return repo === e.name || repo.split("/").pop() === e.name;
  });
  if (!alle.length) {
    return '<p class="leer-kompakt">' + HD.esc(HD.W.projektKeinVerlauf) + "</p>";
  }
  var nach = {};
  var ordnung = [];
  alle.forEach(function (c) {
    var tag = c.gruppe || "";
    if (!nach[tag]) { nach[tag] = []; ordnung.push(tag); }
    nach[tag].push(c);
  });
  return ordnung.map(function (tag) {
    var offen = HD.S.abschnitt["gruppe:" + tag] !== false;
    return "<section>" + HD.gruppeHTML(tag, nach[tag].length, offen)
      + (offen ? '<div class="eintrag-liste">' + nach[tag].map(HD.zeileHTML).join("") + "</div>" : "")
      + "</section>";
  }).join("");
};

HD.projektSeite = function (e) {
  var kopf = '<header class="seiten-kopf">'
    + '<button class="filter-chip" data-pfadziel="projekte">' + HD.icon("chevron-left")
    + "<span>" + HD.esc(HD.W.zurueck) + "</span></button>"
    + '<h1 class="seiten-titel">' + HD.esc(e.name) + "</h1>"
    + (e.pfad ? '<p class="seiten-unter"><span class="pfad">' + HD.esc(e.pfad) + "</span></p>" : "")
    + "</header>";
  var beschreibung = e.beschreibung && e.beschreibung.text
    ? '<p class="erklaersatz">' + HD.esc(e.beschreibung.text) + "</p>" : "";
  // Die Sitzungen stehen UEBER den Reitern: wer hier arbeitet, gilt fuer alle
  // drei Ansichten und ist keine Unterabteilung von "Arbeitspakete".
  var sitzungen = HD.projektSitzungenSektion ? HD.projektSitzungenSektion(e.name) : "";
  var reiter = HD.projektReiterHTML();
  var jetzt = HD.S.projektReiter || "pakete";
  var rumpf;
  if (jetzt === "sicherung") rumpf = HD.projektSicherungHTML(e);
  else if (jetzt === "verlauf") rumpf = HD.projektVerlaufHTML(e);
  else {
    rumpf = (HD.paketKanban ? HD.paketKanban(e.name) : "")
      + (HD.projektDokumenteHTML ? HD.projektDokumenteHTML(e) : "");
  }
  return kopf + beschreibung + sitzungen + reiter + rumpf;
};

`;

module.exports = { quelltext };
