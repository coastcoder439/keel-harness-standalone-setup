// BROWSER-TEIL 4 von 5: die Live-Sektionen -- sehen UND bedienen.
//
// Seit dem Neubau 25.08.2026 gibt es KEINE eigene Bruecken-Seite mehr [Owner:
// eine Sache, ein Ort]: die Sitzungen und der Auftrag stehen auf dem
// Ueberblick, die Arbeitspakete auf "Zu tun", die Guard-Selbsttests auf
// "Hooks". Dieser Teil liefert die Sektionen und laedt ihren Stand LIVE beim
// Server -- ein eingebetteter Stand waere beim ersten Klick veraltet. Im
// file:-Betrieb zeigen die Sektionen den Weg zum Server (Protokoll
// entscheidet, kein Schalter) -- dasselbe Muster wie der Editor in detail.js.
//
// VOKABULAR-PFLICHT (docs/ui-standard.md, Punkt 2 und 4): Haupt-Inhalt lebt
// in .eintrag-* / .sitzung-karte, benannte Bloecke sind ein bloszes <section>
// + HD.gruppeHTML(...). NIE .eigenschaft-* fuer Haupt-Inhalt. Woerter kommen
// aus HD.W (labels.js), nicht aus Literalen.
//
// Die Klassennamen stammen aus render/styles.js und sind nicht verhandelbar.

const quelltext = `
// --- Live-Stand vom Server ------------------------------------------------
HD.bridgeData = null;
HD._bridgeLaedt = false;

// Idempotent: laedt genau einmal je Seitenaufruf. Der Rueckruf zeichnet die
// Seite neu -- die Sektionen wechseln dann von "Laedt" zu Inhalt.
HD.bridgeLade = function () {
  if (!HD.serverModus()) return;
  if (HD.bridgeData || HD._bridgeLaedt) return;
  if (["ueberblick", "zutun", "hooks"].indexOf(HD.S.seite) < 0) return;
  HD._bridgeLaedt = true;
  fetch("/bridge/data").then(function (r) { return r.json(); }).then(function (d) {
    HD.bridgeData = d;
    HD._bridgeLaedt = false;
    HD.zeichnen();
  }).catch(function (e) {
    HD.bridgeData = { error: String(e) };
    HD._bridgeLaedt = false;
    HD.zeichnen();
  });
};

// Gemeinsame Huelle: Server fehlt -> ein Satz mit dem Startbefehl; Stand
// laedt noch -> ein Satz; Fehler -> ein Satz. Sonst der Inhalt.
HD.liveSektion = function (titel, anzahl, inhaltFn) {
  // Lokale Erklaerung statt direktem Parameter-Aufruf: der Namens-Test in
  // client.test.js sammelt nur function/var-Erklaerungen ein.
  var inhaltVon = inhaltFn;
  var rumpf;
  if (!HD.serverModus()) {
    rumpf = '<p class="leer-kompakt">' + HD.esc(HD.W.nurServerText) + "</p>";
  } else if (HD.bridgeData && HD.bridgeData.error) {
    rumpf = '<p class="leer-kompakt">' + HD.esc(HD.fuellen(HD.W.nichtErreichbar, { grund: HD.bridgeData.error })) + "</p>";
  } else if (!HD.bridgeData) {
    rumpf = '<p class="leer-kompakt">' + HD.esc(HD.W.laedtNoch) + "</p>";
  } else {
    rumpf = inhaltVon(HD.bridgeData);
  }
  return "<section>" + HD.gruppeHTML(titel, anzahl, true) + rumpf + "</section>";
};

// --- Sitzungen (Ueberblick, oben -- die Karten des Vorbilds) --------------
HD.sitzungenSektion = function () {
  var aktiv = ((HD.bridgeData || {}).sessions || []).filter(function (s) { return s.active; });
  return HD.liveSektion(HD.W.sitzungen, aktiv.length, function (d) {
    var alle = d.sessions || [];
    var laufend = alle.filter(function (s) { return s.active; });
    var fruehere = alle.filter(function (s) { return !s.active; });
    if (!laufend.length && !fruehere.length) return HD.leerHTML("bridge-sitzungen");

    var karten = laufend.map(function (s) {
      return '<div class="sitzung-karte">'
        + '<span class="sitzung-punkt" aria-hidden="true"></span>'
        + '<span class="sitzung-haupt">'
        + '<span class="sitzung-titel">' + HD.esc(s.title) + "</span>"
        + (s.role ? '<span class="sitzung-rolle">' + HD.esc(s.role) + "</span>" : "")
        + "</span>"
        + '<span class="eintrag-schluss">' + HD.statusChip("ok") + "</span>"
        + "</div>";
    }).join("");
    var kartenHTML = laufend.length
      ? '<div class="sitzung-reihe">' + karten + "</div>"
      : '<p class="leer-kompakt">' + HD.esc(HD.D.leer["bridge-sitzungen"].text) + "</p>";

    // Fruehere Sitzungen nur als EINE Zeile mit Zahl -- 75 Titel flach
    // auszukippen war Beanstandung B10.
    var alteZeigen = !!HD.S.brueckeAlleSitzungen;
    var alteListe = alteZeigen
      ? '<div class="eintrag-liste">' + fruehere.map(function (s) {
          return '<div class="eintrag-zeile"><span class="eintrag-haupt"><span class="eintrag-titel">'
            + HD.esc(s.title) + "</span></span>"
            + (s.role ? '<span class="eintrag-meta"><span>' + HD.esc(s.role) + "</span></span>" : "")
            + "</div>";
        }).join("") + "</div>"
      : "";
    var mehr = fruehere.length && !alteZeigen
      ? '<p class="sektion-fuss"><button class="filter-chip" data-bridge-more="1">'
        + HD.esc(HD.fuellen(HD.W.fruehereAnzeigen, { n: fruehere.length })) + "</button></p>"
      : "";
    return kartenHTML + alteListe + mehr;
  });
};

// --- Auftrag (Ueberblick) -------------------------------------------------
HD.auftragSektion = function () {
  if (!HD.serverModus()) return "";
  return HD.liveSektion(HD.W.auftragSenden, null, function (d) {
    if (d.readOnly === true) {
      return '<p class="leer-kompakt">' + HD.esc(HD.W.nurLeseBetrieb) + "</p>";
    }
    var optionen = '<option value="all">' + HD.esc(HD.W.auftragAlle) + "</option>"
      + (d.sessions || []).filter(function (s) { return s.active; }).map(function (s) {
        return '<option value="' + HD.esc(s.id) + '">' + HD.esc(s.title) + "</option>";
      }).join("");
    return '<p class="erklaersatz">' + HD.esc(HD.W.auftragKopf) + "</p>"
      + '<div class="auftrag-zeile">'
      + '<select id="bridge-target" aria-label="' + HD.esc(HD.W.sitzungen) + '">' + optionen + "</select>"
      + '<textarea id="bridge-text" rows="2" placeholder="' + HD.esc(HD.W.auftragFeld) + '"></textarea>'
      + '<button class="knopf-haupt" data-bridge-order="1">' + HD.esc(HD.W.auftragSenden) + "</button>"
      + "</div>"
      + '<p id="bridge-order-out" class="erklaersatz" aria-live="polite"></p>';
  });
};

// --- Arbeitspakete (Zu tun) -----------------------------------------------
HD.paketeSektion = function () {
  var anzahl = ((HD.bridgeData || {}).packages || []).length;
  return HD.liveSektion(HD.W.arbeitspakete, anzahl, function (d) {
    var repos = {};
    (d.packages || []).forEach(function (p) { (repos[p.repo] = repos[p.repo] || []).push(p); });
    var namen = Object.keys(repos);
    if (!namen.length) return HD.leerHTML("bridge-pakete");
    return namen.map(function (repo) {
      var liste = repos[repo];
      var offen = HD.S.abschnitt["gruppe:" + repo] !== false;
      var zeilen = liste.map(function (p) { return HD.paketZeile(p); }).join("");
      var offenAnzahl = liste.filter(function (p) { return !(p.totalSteps > 0 && p.doneSteps === p.totalSteps); }).length;
      return '<div class="paket-repo">' + HD.gruppeHTML(repo, offenAnzahl, offen)
        + (offen ? '<div class="eintrag-liste">' + zeilen + "</div>" : "") + "</div>";
    }).join("");
  });
};

HD.paketZeile = function (p) {
  if (p.error) {
    return '<div class="eintrag-zeile"><span class="eintrag-haupt"><span class="eintrag-titel">'
      + HD.esc(p.file) + "</span></span><span class=\\"eintrag-schluss\\">" + HD.statusChip("befund") + "</span></div>";
  }
  var offenSchritte = p.totalSteps - p.doneSteps;
  var status = offenSchritte === 0 ? "ok" : "hinweis";
  var istOffen = !!(HD.S.brueckeOffenePakete && HD.S.brueckeOffenePakete[p.file]);
  var hauptzeile = '<button class="eintrag-zeile" data-bridge-pkg="' + HD.esc(p.file) + '" aria-expanded="' + (istOffen ? "true" : "false") + '">'
    + '<span class="eintrag-kachel">' + HD.icon("list-checks") + "</span>"
    + '<span class="eintrag-haupt">'
    + '<span class="eintrag-titel">' + HD.esc(p.title || p.file) + "</span>"
    + (p.goal ? '<span class="eintrag-unter">' + HD.esc(p.goal) + "</span>" : "")
    + "</span>"
    + '<span class="eintrag-meta"><span>'
    + HD.esc(HD.fuellen(HD.W.schrittVon, { done: p.doneSteps, total: p.totalSteps })) + "</span></span>"
    + '<span class="eintrag-schluss">' + HD.statusChip(status) + "</span>"
    + "</button>";
  if (!istOffen) return hauptzeile;

  var schritte = (p.steps || []).map(function (st, i) {
    return '<button class="eintrag-zeile" data-bridge-toggle="' + HD.esc(p.file) + '" data-bridge-index="' + i + '">'
      + '<span class="eintrag-haupt"><span class="eintrag-titel">' + HD.esc(st.text) + "</span></span>"
      + '<span class="eintrag-schluss">' + HD.statusChip(st.done ? "ok" : "fehlt") + "</span>"
      + "</button>";
  }).join("");
  var offenSatz = p.openLine
    ? '<p class="erklaersatz paket-offen">' + HD.esc(HD.W.offenPunkt) + ": " + HD.esc(p.openLine) + "</p>" : "";
  return hauptzeile + '<div class="eintrag-liste paket-schritte">' + schritte + "</div>" + offenSatz;
};

// --- Guard-Selbsttests (Hooks) --------------------------------------------
HD.guardSektion = function () {
  if (!HD.serverModus()) return "";
  var anzahl = ((HD.bridgeData || {}).guards || []).length;
  return HD.liveSektion(HD.W.guardTests, anzahl, function (d) {
    var chips = (d.guards || []).map(function (g) {
      return '<button class="filter-chip" data-bridge-selftest="' + HD.esc(g) + '">' + HD.esc(g) + "</button>";
    }).join("");
    return '<div class="werkzeugleiste">' + chips + "</div>"
      + '<p id="bridge-selftest-out" class="erklaersatz" aria-live="polite"></p>';
  });
};

// Ein delegierter Listener fuer alle Live-Knoepfe -- einmal registriert.
HD.bridgeClick = function (ev) {
  var t = ev.target.closest
    ? ev.target.closest("[data-bridge-toggle],[data-bridge-selftest],[data-bridge-order],[data-bridge-pkg],[data-bridge-more]")
    : null;
  if (!t) return false;

  if (t.dataset.bridgePkg) {
    HD.S.brueckeOffenePakete = HD.S.brueckeOffenePakete || {};
    var datei = t.dataset.bridgePkg;
    HD.S.brueckeOffenePakete[datei] = !HD.S.brueckeOffenePakete[datei];
    HD.zeichnen();
    return true;
  }
  if (t.dataset.bridgeMore) {
    HD.S.brueckeAlleSitzungen = true;
    HD.zeichnen();
    return true;
  }

  // toggle und selftest tragen ihre Angaben als Frage-Parameter, nur der
  // Auftrag hat einen JSON-Leib -- so erwartet es serve.js.
  var send = function (weg, fertig) {
    fetch(weg, { method: "POST" }).then(function (r) { return r.json(); }).then(fertig)
      .catch(function (e) { fertig({ fehler: String(e) }); });
  };
  if (t.dataset.bridgeToggle) {
    var datei2 = t.dataset.bridgeToggle;
    var index = Number(t.dataset.bridgeIndex);
    send("/bridge/toggle?pfad=" + encodeURIComponent(datei2) + "&index=" + encodeURIComponent(index), function (a) {
      if (!a.ok) { HD.melden(a.fehler || HD.W.hakenFehler); return; }
      var pkg = (HD.bridgeData.packages || []).find(function (p) { return p.file === datei2; });
      if (pkg && pkg.steps && pkg.steps[index]) {
        pkg.steps[index].done = a.nowDone;
        pkg.doneSteps = pkg.steps.filter(function (s) { return s.done; }).length;
      }
      HD.zeichnen();
    });
  } else if (t.dataset.bridgeSelftest) {
    send("/bridge/selftest?guard=" + encodeURIComponent(t.dataset.bridgeSelftest), function (a) {
      var aus = document.getElementById("bridge-selftest-out");
      if (aus) aus.textContent = (a.ok ? HD.D.status.ok.wort + " \\u2014 " : HD.D.status.befund.wort + " \\u2014 ")
        + (a.output || a.fehler || a.error || "");
    });
  } else if (t.dataset.bridgeOrder) {
    var text = (document.getElementById("bridge-text") || {}).value || "";
    var ziel = (document.getElementById("bridge-target") || {}).value || "all";
    fetch("/bridge/order", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ target: ziel, text: text }) })
      .then(function (r) { return r.json(); }).then(function (a) {
        var aus = document.getElementById("bridge-order-out");
        if (aus) aus.textContent = a.ok
          ? HD.fuellen(HD.W.auftragZugestellt, { datei: a.file || "" })
          : HD.fuellen(HD.W.nichtErreichbar, { grund: a.fehler || a.error || "" });
        if (a.ok) { var f = document.getElementById("bridge-text"); if (f) f.value = ""; }
      }).catch(function (e) {
        var aus = document.getElementById("bridge-order-out");
        if (aus) aus.textContent = HD.fuellen(HD.W.nichtErreichbar, { grund: String(e) });
      });
  }
  return true;
};
`;

module.exports = { quelltext };
