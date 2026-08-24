// BROWSER-TEIL 4 von 5: die Kommandobruecke -- sehen UND bedienen.
//
// Einzige Seite, die LIVE beim Server nachfragt statt aus dem eingebetteten
// Datensatz zu lesen: Pakete, Sitzungen und Guards aendern sich waehrend die
// Seite offen ist, ein eingebetteter Stand waere beim ersten Klick veraltet.
// Im file:-Betrieb zeigt sie deshalb nur den Weg zum Server -- dasselbe
// Muster wie der Editor in detail.js (Protokoll entscheidet, kein Schalter).
//
// VOKABULAR-PFLICHT (docs/ui-standard.md, Punkt 2 und 4): Haupt-Inhalt lebt
// in .eintrag-* (Zeile: Kachel, Titel, Untertitel, Meta, Status), benannte
// Bloecke sind ein bloszes <section> + HD.gruppeHTML(...) -- wie
// HD.fehltHTML/HD.ablaufHTML es fuer die Ueberblick-Seite vormachen. NIE
// .eigenschaft-* (die schmale Detail-Spalte, text-xs, Label-Spalte fest) fuer
// Haupt-Inhalt -- genau der Fehler der ersten Fassung (25.08.2026, Owner-
// Befund: "sieht nach Maschine aus"): ganze Saetze in einem <summary>, das
// text-transform:uppercase traegt.
//
// Die Klassennamen stammen aus render/styles.js und sind nicht verhandelbar.

const quelltext = `
// --- Kommandobruecke ------------------------------------------------------
HD.bridgeData = null;

HD.bridgePage = function () {
  var s = HD.D.seiten.bridge || { zweck: "" };
  var top = '<p class="erklaersatz">' + HD.esc(s.zweck) + "</p>";
  if (!HD.serverModus()) {
    return top + '<div class="leerzustand">'
      + '<span class="leer-symbol">' + HD.icon("terminal") + "</span>"
      + '<span class="leer-titel">Nur im Server-Betrieb</span>'
      + '<span class="leer-text">Die Br\\u00fccke liest und schreibt live. Starte: node dashboard/serve.js \\u2014 dann http://127.0.0.1:8765</span>'
      + "</div>";
  }
  if (!HD.bridgeData) {
    HD.bridgeLoad();
    return top + '<div id="bridge-content"><p class="erklaersatz">L\\u00e4dt \\u2026</p></div>';
  }
  return top + '<div id="bridge-content">' + HD.bridgeRender() + "</div>";
};

// Neu laden loest IMMER einen vollen Zeichenlauf aus (HD.zeichnen) -- so
// wechselt die Seite sauber von "Laedt" zu Inhalt. Danach aendert ein
// einzelner Haken NICHT die ganzen Daten neu vom Server: er passt HD.bridgeData
// lokal an und zeichnet nur #bridge-content neu (HD.bridgeRenderInto) -- ohne
// Netzlauf, ohne Aufflackern der ganzen Seite.
HD.bridgeLoad = function () {
  fetch("/bridge/data").then(function (r) { return r.json(); }).then(function (d) {
    HD.bridgeData = d;
    HD.zeichnen();
  }).catch(function (e) {
    HD.bridgeData = { error: String(e) };
    HD.zeichnen();
  });
};

HD.bridgeRenderInto = function () {
  var ziel = document.getElementById("bridge-content");
  if (ziel) ziel.innerHTML = HD.bridgeRender();
};

HD.bridgeRender = function () {
  var d = HD.bridgeData;
  if (!d) return "";
  if (d.error) return '<p class="erklaersatz">Br\\u00fccke nicht erreichbar: ' + HD.esc(d.error) + "</p>";
  return HD.bridgePaketeHTML(d) + HD.bridgeSitzungenHTML(d) + HD.bridgeGuardsHTML(d) + HD.bridgeAuftragHTML(d);
};

// --- Arbeitspakete: Repo als HD.gruppeHTML-Block, Paket als Eintragszeile,
// Schritte als eingerueckte Eintragszeilen mit Status-Chip statt Haekchen.
HD.bridgePaketeHTML = function (d) {
  var repos = {};
  (d.packages || []).forEach(function (p) { (repos[p.repo] = repos[p.repo] || []).push(p); });
  var namen = Object.keys(repos);
  if (!namen.length) return "<section>" + HD.leerHTML("bridge-pakete") + "</section>";

  var bloecke = namen.map(function (repo) {
    var liste = repos[repo];
    var offenAnzahl = liste.filter(function (p) { return !(p.totalSteps > 0 && p.doneSteps === p.totalSteps); }).length;
    var offen = HD.S.abschnitt["gruppe:" + repo] !== false;
    var zeilen = liste.map(function (p) { return HD.bridgePaketZeile(p); }).join("");
    return "<section>" + HD.gruppeHTML(repo, offenAnzahl, offen)
      + (offen ? '<div class="eintrag-liste">' + zeilen + "</div>" : "") + "</section>";
  }).join("");
  return bloecke;
};

HD.bridgePaketZeile = function (p) {
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
    + '<span class="eintrag-meta"><span>' + HD.esc(p.doneSteps + " von " + p.totalSteps + " Schritten") + "</span></span>"
    + '<span class="eintrag-schluss">' + HD.statusChip(status) + "</span>"
    + "</button>";
  if (!istOffen) return hauptzeile;

  // Eingerueckt (32 px Kachel + 12 px Abstand = 44 px), damit die Schritte
  // erkennbar zum Paket gehoeren, ohne eine neue Klasse zu erfinden.
  var schritte = (p.steps || []).map(function (st, i) {
    return '<button class="eintrag-zeile" data-bridge-toggle="' + HD.esc(p.file) + '" data-bridge-index="' + i + '">'
      + '<span class="eintrag-haupt"><span class="eintrag-titel">' + HD.esc(st.text) + "</span></span>"
      + '<span class="eintrag-schluss">' + HD.statusChip(st.done ? "ok" : "fehlt") + "</span>"
      + "</button>";
  }).join("");
  var offenSatz = p.openLine ? '<p class="erklaersatz" style="margin:8px 12px 4px">Offen: ' + HD.esc(p.openLine) + "</p>" : "";
  return hauptzeile + '<div class="eintrag-liste" style="margin:4px 0 8px 44px">' + schritte + "</div>" + offenSatz;
};

// --- Sitzungen: aktive als Eintragszeilen, fruehere gekappt ("n weitere
// anzeigen" -- Kappungswort aus dem Glossar, kein neuer Ausdruck).
HD.bridgeSitzungenHTML = function (d) {
  var alle = d.sessions || [];
  var aktiv = alle.filter(function (s) { return s.active; });
  var inaktiv = alle.filter(function (s) { return !s.active; });
  var alleZeigen = !!HD.S.brueckeAlleSitzungen;
  var gezeigt = alleZeigen ? inaktiv : inaktiv.slice(0, 5);

  function zeile(s) {
    var rollePille = s.role ? '<span class="eintrag-meta"><span><span class="eigenschaft-pille">' + HD.esc(s.role) + "</span></span></span>" : "";
    return '<div class="eintrag-zeile"><span class="eintrag-haupt"><span class="eintrag-titel">' + HD.esc(s.title) + "</span></span>"
      + rollePille + '<span class="eintrag-schluss">' + HD.statusChip(s.active ? "ok" : "fehlt") + "</span></div>";
  }

  var zeilen = aktiv.map(zeile).join("") + gezeigt.map(zeile).join("");
  var koerper = zeilen
    ? '<div class="eintrag-liste">' + zeilen + "</div>"
    : HD.leerHTML("bridge-sitzungen");
  var mehr = (!alleZeigen && inaktiv.length > 5)
    ? '<p style="margin-top:8px"><button class="filter-chip" data-bridge-more="1">'
      + HD.esc(String(inaktiv.length - 5)) + " weitere anzeigen</button></p>"
    : "";
  return "<section>" + HD.gruppeHTML("Sitzungen", aktiv.length, true) + koerper + mehr + "</section>";
};

// --- Guard-Selbsttests: Werkzeugleiste aus Filter-Chips, Ergebnis als Satz.
HD.bridgeGuardsHTML = function (d) {
  var chips = (d.guards || []).map(function (g) {
    return '<button class="filter-chip" data-bridge-selftest="' + HD.esc(g) + '">' + HD.esc(g) + "</button>";
  }).join("");
  return "<section>" + HD.gruppeHTML("Guard-Selbsttests", (d.guards || []).length, true)
    + '<div class="werkzeugleiste">' + chips + "</div>"
    + '<p id="bridge-selftest-out" class="erklaersatz"></p>'
    + "</section>";
};

// --- Auftrag: ein Satz statt Ueberschrift, dann Formular.
HD.bridgeAuftragHTML = function (d) {
  var kopf = '<p class="erklaersatz">Auftrag an eine Sitzung \\u2014 wird bei ihrer n\\u00e4chsten Nachricht zugestellt.</p>';
  if (d.readOnly === true) {
    return "<section>" + kopf + '<p class="erklaersatz">Nur-Lese-Betrieb \\u2014 Auftr\\u00e4ge abgeschaltet.</p></section>';
  }
  var optionen = '<option value="all">alle Sitzungen \\u2014 10 Minuten</option>'
    + (d.sessions || []).filter(function (s) { return s.active; }).map(function (s) {
      return '<option value="' + HD.esc(s.id) + '">' + HD.esc(s.title) + "</option>";
    }).join("");
  return "<section>" + kopf
    + '<div class="werkzeugleiste"><select id="bridge-target">' + optionen + "</select></div>"
    + '<textarea id="bridge-text" rows="3" placeholder="Auftrag \\u2026 h\\u00f6chstens 2000 Zeichen"></textarea>'
    + '<p style="margin-top:8px"><button class="knopf-haupt" data-bridge-order="1">Auftrag senden</button></p>'
    + '<p id="bridge-order-out" class="erklaersatz"></p>'
    + "</section>";
};

// Ein delegierter Listener fuer alle Brueckenknoepfe -- einmal registriert.
HD.bridgeClick = function (ev) {
  var t = ev.target.closest
    ? ev.target.closest("[data-bridge-toggle],[data-bridge-selftest],[data-bridge-order],[data-bridge-pkg],[data-bridge-more]")
    : null;
  if (!t) return false;

  if (t.dataset.bridgePkg) {
    HD.S.brueckeOffenePakete = HD.S.brueckeOffenePakete || {};
    var datei = t.dataset.bridgePkg;
    HD.S.brueckeOffenePakete[datei] = !HD.S.brueckeOffenePakete[datei];
    HD.bridgeRenderInto();
    return true;
  }
  if (t.dataset.bridgeMore) {
    HD.S.brueckeAlleSitzungen = true;
    HD.bridgeRenderInto();
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
      if (!a.ok) { HD.melden(a.fehler || "Haken konnte nicht gesetzt werden"); return; }
      var pkg = (HD.bridgeData.packages || []).find(function (p) { return p.file === datei2; });
      if (pkg && pkg.steps && pkg.steps[index]) {
        pkg.steps[index].done = a.nowDone;
        pkg.doneSteps = pkg.steps.filter(function (s) { return s.done; }).length;
      }
      HD.bridgeRenderInto();
    });
  } else if (t.dataset.bridgeSelftest) {
    send("/bridge/selftest?guard=" + encodeURIComponent(t.dataset.bridgeSelftest), function (a) {
      var aus = document.getElementById("bridge-selftest-out");
      if (aus) aus.textContent = (a.ok ? "In Ordnung \\u2014 " : "Fehler \\u2014 ") + (a.output || a.fehler || a.error || "");
    });
  } else if (t.dataset.bridgeOrder) {
    var text = (document.getElementById("bridge-text") || {}).value || "";
    var ziel = (document.getElementById("bridge-target") || {}).value || "all";
    fetch("/bridge/order", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ target: ziel, text: text }) })
      .then(function (r) { return r.json(); }).then(function (a) {
        var aus = document.getElementById("bridge-order-out");
        if (aus) aus.textContent = a.ok ? "Zugestellt beim n\\u00e4chsten Prompt: " + (a.file || "") : "Fehler: " + (a.fehler || a.error || "");
        if (a.ok) { var f = document.getElementById("bridge-text"); if (f) f.value = ""; }
      }).catch(function (e) {
        var aus = document.getElementById("bridge-order-out");
        if (aus) aus.textContent = "Fehler: " + String(e);
      });
  }
  return true;
};
`;

module.exports = { quelltext };
