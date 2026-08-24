// BROWSER-TEIL 4 von 5: die Kommandobruecke -- sehen UND bedienen.
//
// Einzige Seite, die LIVE beim Server nachfragt statt aus dem eingebetteten
// Datensatz zu lesen: Pakete, Sitzungen und Waechter aendern sich waehrend die
// Seite offen ist, ein eingebetteter Stand waere beim ersten Klick veraltet.
// Im file:-Betrieb zeigt sie deshalb nur den Weg zum Server -- dasselbe
// Muster wie der Editor in detail.js (Protokoll entscheidet, kein Schalter).
//
// Die Klassennamen stammen aus render/styles.js und sind nicht verhandelbar.

const quelltext = `
// --- Kommandobruecke ------------------------------------------------------
HD.bridgeData = null;

HD.bridgePage = function () {
  var s = HD.D.seiten.bridge || { name: "Kommandobr\\u00fccke", zweck: "" };
  var head = '<header class="seiten-kopf"><div><h1>' + HD.esc(s.name) + "</h1>"
    + '<p class="seiten-zweck">' + HD.esc(s.zweck) + "</p></div></header>";
  if (!HD.serverModus()) {
    return head + '<div class="leerzustand">'
      + '<span class="leer-symbol">' + HD.icon("terminal") + "</span>"
      + '<span class="leer-titel">Nur im Server-Betrieb</span>'
      + '<span class="leer-text">Die Br\\u00fccke liest und schreibt live. Starte: node dashboard/serve.js \\u2014 dann http://127.0.0.1:8765</span>'
      + "</div>";
  }
  HD.bridgeLoad();
  return head + '<div id="bridge-content"><div class="leerzustand"><span class="leer-text">L\\u00e4dt \\u2026</span></div></div>';
};

HD.bridgeLoad = function () {
  fetch("/bridge/data").then(function (r) { return r.json(); }).then(function (d) {
    HD.bridgeData = d;
    HD.bridgeDraw();
  }).catch(function (e) {
    var ziel = document.getElementById("bridge-content");
    if (ziel) ziel.innerHTML = '<div class="leerzustand"><span class="leer-text">Br\\u00fccke nicht erreichbar: ' + HD.esc(String(e)) + "</span></div>";
  });
};

HD.bridgeDraw = function () {
  var ziel = document.getElementById("bridge-content");
  var d = HD.bridgeData;
  if (!ziel || !d) return;

  // Pakete, nach Repo gruppiert. Jeder Schritt ist ein klickbarer Haken.
  var groups = {};
  (d.packages || []).forEach(function (p) {
    (groups[p.repo] = groups[p.repo] || []).push(p);
  });
  var packagesHTML = Object.keys(groups).map(function (repo) {
    var cards = groups[repo].map(function (p) {
      if (p.error) return '<div class="eintrag-zeile"><span class="eintrag-titel">' + HD.esc(p.file) + '</span> ' + HD.statusChip("befund") + "</div>";
      var readOnly = !!d.readOnly;
      var steps = p.steps.map(function (st, i) {
        var mark = st.done ? "\\u2611" : "\\u2610";
        var box = readOnly
          ? '<span class="eigenschaft-pille">' + HD.esc(mark) + "</span>"
          : '<button class="filter-chip" data-bridge-toggle="' + HD.esc(p.file) + '" data-bridge-index="' + HD.esc(String(i)) + '">' + HD.esc(mark) + "</button>";
        return '<div class="eigenschaft-zeile">' + box + '<span class="eigenschaft-wert">' + HD.esc(st.text) + "</span></div>";
      }).join("");
      var allDone = p.totalSteps > 0 && p.doneSteps === p.totalSteps;
      return '<details class="eigenschaft-abschnitt"' + (allDone ? "" : " open") + "><summary>"
        + HD.esc(p.title || p.file) + " \\u00b7 " + p.doneSteps + "/" + p.totalSteps
        + (p.status ? " \\u00b7 " + HD.esc(p.status.slice(0, 80)) : "") + "</summary>"
        + (p.goal ? '<p class="seiten-zweck">' + HD.esc(p.goal) + "</p>" : "")
        + steps
        + (p.openLine ? '<p class="seiten-zweck">Offen: ' + HD.esc(p.openLine) + "</p>" : "")
        + "</details>";
    }).join("");
    return '<section class="abschnitt"><h2>' + HD.esc(repo) + "</h2>" + cards + "</section>";
  }).join("") || '<div class="leerzustand"><span class="leer-text">Keine Paket-Artefakte gefunden.</span></div>';

  // Sitzungen mit Rolle und Aktiv-Punkt. Nur die aktiven offen -- die
  // Historie waere eine Wand aus Dutzenden alten Eintraegen (Info-Flut).
  var sessionRow = function (s) {
    return '<div class="eigenschaft-zeile">'
      + HD.statusChip(s.active ? "ok" : "fehlt")
      + '<span class="eigenschaft-wert">' + HD.esc(s.title)
      + (s.role ? ' <span class="eigenschaft-pille">' + HD.esc(s.role) + "</span>" : "")
      + "</span></div>";
  };
  var activeOnes = (d.sessions || []).filter(function (s) { return s.active; });
  var pastOnes = (d.sessions || []).filter(function (s) { return !s.active; });
  var sessionsHTML = (activeOnes.map(sessionRow).join("")
      || '<div class="leerzustand"><span class="leer-text">Keine aktive Sitzung.</span></div>')
    + (pastOnes.length
      ? '<details class="eigenschaft-abschnitt"><summary>Fr\\u00fchere Sitzungen \\u00b7 ' + HD.esc(String(pastOnes.length)) + "</summary>"
        + pastOnes.map(sessionRow).join("") + "</details>"
      : "");

  // Waechter-Selbsttests.
  var guardsHTML = (d.guards || []).map(function (g) {
    return '<button class="filter-chip" data-bridge-selftest="' + HD.esc(g) + '">' + HD.esc(g) + " testen</button>";
  }).join(" ");

  // Auftrag an eine Sitzung.
  var targetOptions = '<option value="all">alle Sitzungen \\u2014 10 Minuten</option>'
    + (d.sessions || []).filter(function (s) { return s.active; }).map(function (s) {
      return '<option value="' + HD.esc(s.id) + '">' + HD.esc(s.title) + "</option>";
    }).join("");
  var orderHTML = (d.readOnly === true)
    ? '<p class="seiten-zweck">Nur-Lese-Betrieb \\u2014 Auftr\\u00e4ge abgeschaltet.</p>'
    : '<select id="bridge-target">' + targetOptions + "</select>"
      + '<textarea id="bridge-text" rows="3" placeholder="Auftrag \\u2026 h\\u00f6chstens 2000 Zeichen"></textarea>'
      + '<button class="knopf-haupt" data-bridge-order="1">Auftrag senden</button>';

  ziel.innerHTML = '<section class="abschnitt"><h2>Arbeitspakete</h2>' + packagesHTML + "</section>"
    + '<section class="abschnitt"><h2>Sitzungen</h2>' + sessionsHTML + "</section>"
    + '<section class="abschnitt"><h2>Guard-Selbsttests</h2><div>' + guardsHTML + '</div><pre id="bridge-selftest-out" class="quelltext-block"></pre></section>'
    + '<section class="abschnitt"><h2>Auftrag</h2>' + orderHTML + '<p id="bridge-order-out" class="seiten-zweck"></p></section>';
};

// Ein delegierter Listener fuer alle Brueckenkoepfe -- einmal registriert.
HD.bridgeClick = function (ev) {
  var t = ev.target.closest ? ev.target.closest("[data-bridge-toggle],[data-bridge-selftest],[data-bridge-order]") : null;
  if (!t) return false;
  // toggle und selftest tragen ihre Angaben als Query-Parameter, nur der
  // Auftrag hat einen JSON-Leib -- so erwartet es serve.js.
  var send = function (weg, daten, fertig) {
    fetch(weg, { method: "POST", headers: { "Content-Type": "application/json" }, body: daten ? JSON.stringify(daten) : "" })
      .then(function (r) { return r.json(); }).then(fertig)
      .catch(function (e) { fertig({ fehler: String(e) }); });
  };
  if (t.dataset.bridgeToggle) {
    send("/bridge/toggle?pfad=" + encodeURIComponent(t.dataset.bridgeToggle) + "&index=" + encodeURIComponent(t.dataset.bridgeIndex), null, function () { HD.bridgeLoad(); });
  } else if (t.dataset.bridgeSelftest) {
    send("/bridge/selftest?guard=" + encodeURIComponent(t.dataset.bridgeSelftest), null, function (a) {
      var aus = document.getElementById("bridge-selftest-out");
      if (aus) aus.textContent = (a.ok ? "OK \\u2014 " : "FEHLER \\u2014 ") + (a.output || a.fehler || a.error || "");
    });
  } else if (t.dataset.bridgeOrder) {
    var text = (document.getElementById("bridge-text") || {}).value || "";
    var targetChoice = (document.getElementById("bridge-target") || {}).value || "all";
    send("/bridge/order", { target: targetChoice, text: text }, function (a) {
      var aus = document.getElementById("bridge-order-out");
      if (aus) aus.textContent = a.ok ? "Zugestellt beim n\\u00e4chsten Prompt: " + (a.file || "") : "Fehler: " + (a.fehler || a.error || "");
      if (a.ok) { var f = document.getElementById("bridge-text"); if (f) f.value = ""; }
    });
  }
  return true;
};
`;

module.exports = { quelltext };
