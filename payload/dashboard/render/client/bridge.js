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

// --- Auftrag (Ueberblick) --------------------------------------------------
// Ausgebaut [Owner 25.08.2026 abends: "Projekt direkt waehlen, auch von der
// Sitzung, dann werden die Arbeitspakete angezeigt, alles sortiert"]. Die
// Sitzung->Projekt-Vorbelegung liest die BESTEHENDE Rollen-Konvention
// (bridge.js projectForRole, server-seitig geparst) -- kein Rateersatz, und
// als VORSCHLAG markiert, nie als Fakt (der Owner kann das Projekt jederzeit
// selbst wechseln).
HD.auftragSektion = function () {
  if (!HD.serverModus()) return "";
  return HD.liveSektion(HD.W.auftragSenden, null, function (d) {
    if (d.readOnly === true) {
      return '<p class="leer-kompakt">' + HD.esc(HD.W.nurLeseBetrieb) + "</p>";
    }
    var sitzungen = (d.sessions || []).filter(function (s) { return s.active; });
    var ziel = HD.S.auftragZiel || "all";
    // Ziel-Sitzung nicht mehr aktiv (z.B. seit dem letzten Neumessen beendet)?
    // Dann zurueck auf "alle" -- sonst zeigt das Feld eine Auswahl, die es
    // nicht mehr gibt.
    if (ziel !== "all" && !sitzungen.some(function (s) { return s.id === ziel; })) ziel = "all";
    HD.S.auftragZiel = ziel;
    var optionen = '<option value="all"' + (ziel === "all" ? " selected" : "") + ">" + HD.esc(HD.W.auftragAlle) + "</option>"
      + sitzungen.map(function (s) {
        return '<option value="' + HD.esc(s.id) + '"' + (s.id === ziel ? " selected" : "") + ">" + HD.esc(s.title) + "</option>";
      }).join("");

    var repos = [];
    (d.packages || []).forEach(function (p) { if (repos.indexOf(p.repo) < 0) repos.push(p.repo); });
    repos.sort(function (a, b) {
      if (a === HD.D.workspace) return -1;
      if (b === HD.D.workspace) return 1;
      return a.localeCompare(b, "de");
    });
    if (!HD.S.auftragProjekt && repos.length) HD.S.auftragProjekt = repos[0];
    var projektOptionen = repos.map(function (r) {
      return '<option value="' + HD.esc(r) + '"' + (r === HD.S.auftragProjekt ? " selected" : "") + ">" + HD.esc(r) + "</option>";
    }).join("");

    var pakete = (d.packages || []).filter(function (p) { return p.repo === HD.S.auftragProjekt && !p.error; })
      .sort(function (a, b) {
        var offenA = a.totalSteps > 0 && a.doneSteps === a.totalSteps ? 1 : 0;
        var offenB = b.totalSteps > 0 && b.doneSteps === b.totalSteps ? 1 : 0;
        return offenA - offenB;
      });
    var anhang = HD.S.auftragPaket;
    var paketHTML = pakete.length
      ? pakete.map(function (p) {
          var an = anhang && anhang.file === p.file;
          return '<button class="paket-chip' + (an ? " paket-chip-an" : "") + '" data-bridge-anhang="' + HD.esc(p.file) + '"'
            + ' data-bridge-anhang-titel="' + HD.esc(p.title || p.file) + '" aria-pressed="' + (an ? "true" : "false") + '">'
            + HD.esc(p.title || p.file) + (an ? " · " + HD.esc(HD.W.auftragPaketAngeheftet) : "") + "</button>";
        }).join("")
      : '<p class="leer-kompakt">' + HD.esc(HD.W.auftragKeinePakete) + "</p>";

    var vorschlagHTML = "";
    var gewaehlteSitzung = sitzungen.find(function (s) { return s.id === HD.S.auftragZiel; });
    if (gewaehlteSitzung && gewaehlteSitzung.project && gewaehlteSitzung.project.repo !== HD.S.auftragProjekt) {
      vorschlagHTML = '<button class="filter-chip" data-bridge-projekt-vorschlag="' + HD.esc(gewaehlteSitzung.project.repo) + '">'
        + HD.esc(HD.fuellen(HD.W.auftragProjektVorschlag, { repo: gewaehlteSitzung.project.repo })) + "</button>";
    }

    return '<p class="erklaersatz">' + HD.esc(HD.W.auftragKopf) + "</p>"
      + '<div class="auftrag-zeile">'
      + '<select id="bridge-target" aria-label="' + HD.esc(HD.W.sitzungen) + '">' + optionen + "</select>"
      + '<select id="bridge-projekt" aria-label="' + HD.esc(HD.W.auftragProjekt) + '">' + projektOptionen + "</select>"
      + vorschlagHTML
      + "</div>"
      + '<p class="auftrag-pakete-label">' + HD.esc(HD.W.auftragPaketWaehlen) + "</p>"
      + '<div class="auftrag-pakete">' + paketHTML + "</div>"
      + '<div class="auftrag-zeile">'
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
    ? ev.target.closest("[data-bridge-toggle],[data-bridge-selftest],[data-bridge-order],[data-bridge-pkg],[data-bridge-more],[data-bridge-anhang],[data-bridge-projekt-vorschlag]")
    : null;
  if (!t) return false;

  if (t.dataset.bridgeProjektVorschlag) {
    HD.S.auftragProjekt = t.dataset.bridgeProjektVorschlag;
    HD.S.auftragPaket = null;
    HD.zeichnen();
    return true;
  }
  if (t.dataset.bridgeAnhang) {
    var schonAn = HD.S.auftragPaket && HD.S.auftragPaket.file === t.dataset.bridgeAnhang;
    HD.S.auftragPaket = schonAn ? null : { repo: HD.S.auftragProjekt, file: t.dataset.bridgeAnhang, titel: t.dataset.bridgeAnhangTitel };
    HD.zeichnen();
    return true;
  }
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
    // Das angeheftete Paket geht als Referenzzeile mit -- /bridge/order kennt
    // nur {target, text}, kein eigenes Schema-Feld (Auftraege werden von
    // prompt-form.js woertlich als Text zugestellt, siehe .claude/prompt-form.js).
    var anhang = HD.S.auftragPaket;
    var voll = anhang ? "[Paket: " + anhang.file + "] " + text : text;
    fetch("/bridge/order", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ target: ziel, text: voll }) })
      .then(function (r) { return r.json(); }).then(function (a) {
        var aus = document.getElementById("bridge-order-out");
        if (aus) aus.textContent = a.ok
          ? HD.fuellen(HD.W.auftragZugestellt, { datei: a.file || "" })
          : HD.fuellen(HD.W.nichtErreichbar, { grund: a.fehler || a.error || "" });
        if (a.ok) {
          var f = document.getElementById("bridge-text"); if (f) f.value = "";
          HD.S.auftragPaket = null;
          HD.zeichnen();
        }
      }).catch(function (e) {
        var aus = document.getElementById("bridge-order-out");
        if (aus) aus.textContent = HD.fuellen(HD.W.nichtErreichbar, { grund: String(e) });
      });
  }
  return true;
};

// Aenderung an einem der zwei Auswahlfelder: Projekt-Wechsel loescht den
// Anhang (er gehoert zum alten Projekt), Sitzungs-Wechsel zeichnet nur neu,
// damit ein passender Vorschlag erscheinen kann (Klick uebernimmt ihn).
HD.bridgeChange = function (ev) {
  if (ev.target && ev.target.id === "bridge-projekt") {
    HD.S.auftragProjekt = ev.target.value;
    HD.S.auftragPaket = null;
    HD.zeichnen();
    return true;
  }
  if (ev.target && ev.target.id === "bridge-target") {
    HD.S.auftragZiel = ev.target.value;
    HD.zeichnen();
    return true;
  }
  return false;
};
`;

module.exports = { quelltext };
