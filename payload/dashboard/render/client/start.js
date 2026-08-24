// BROWSER-TEIL 5 von 5: Ereignisse und Start.
//
// EIN Klick-Zuhoerer fuer die ganze Seite statt Zuhoerer je Element. Grund: die
// Seite wird bei jeder Aenderung neu gezeichnet -- einzeln angeheftete Zuhoerer
// waeren danach weg, und genau daher kam der Eindruck, dass Knoepfe nichts tun.
// closest() faengt auch Klicks auf das Symbol IM Knopf; ohne das ist ein Knopf
// tot, sobald man sein Icon trifft.

const quelltext = `
// --- Klick ---------------------------------------------------------------
document.addEventListener("click", function (ev) {
  var z = ev.target;
  function nah(wahl) { return z.closest ? z.closest(wahl) : null; }

  var nav = nah("[data-ziel]");
  if (nav) { HD.zurSeite(nav.dataset.ziel); return; }

  if (HD.bridgeClick && HD.bridgeClick(ev)) return;

  var pfad = nah("[data-pfadziel]");
  if (pfad) {
    if (pfad.dataset.pfadpfad) HD.dateiWaehlen(pfad.dataset.pfadpfad);
    else HD.zurSeite(pfad.dataset.pfadziel);
    return;
  }

  var kopie = nah("[data-kopie]");
  if (kopie) { HD.kopieren(kopie.dataset.kopie); return; }

  var kopieInhalt = nah("[data-kopieinhalt]");
  if (kopieInhalt) {
    // Inhalt steht nicht mehr im Datensatz -- erst holen, dann kopieren.
    var pfadK = kopieInhalt.dataset.kopieinhalt;
    HD.dateiHolen(pfadK, function (fehler, d) {
      if (fehler) { HD.melden(HD.fuellen(HD.W.inhaltFehler, { grund: fehler })); return; }
      HD.kopieren(d.text);
    });
    return;
  }

  var handlung = nah("[data-handlung]");
  if (handlung) {
    var h = handlung.dataset.handlung;
    if (h === "suche:leeren") { HD.S.suche = ""; HD.adresseSchreiben(true); HD.zeichnen(); }
    else if (h === "filter:leeren") { HD.S.filter = []; HD.adresseSchreiben(true); HD.zeichnen(); }
    else if (h === "json:kopieren") HD.kopieren(JSON.stringify(HD.D.roh.messung, null, 1));
    else if (h.indexOf("datei:") === 0) HD.oeffnen(h);
    return;
  }

  var baumZeile = nah("[data-baumpfad]");
  if (baumZeile) {
    var p = baumZeile.dataset.baumpfad;
    if (baumZeile.dataset.baumtyp === "ordner") {
      HD.S.baumOffen[p] = !HD.S.baumOffen[p];
      HD.S.baumDatei = p;
      HD.S.auswahl = null;
      HD.adresseSchreiben(true);
      HD.zeichnen();
    } else if (baumZeile.dataset.baumtyp === "repo") {
      HD.zurSeite("backup");
    } else {
      HD.dateiWaehlen(p);
    }
    return;
  }

  var gruppe = nah("[data-gruppe]");
  if (gruppe) {
    var s = "gruppe:" + gruppe.dataset.gruppe;
    HD.S.abschnitt[s] = HD.S.abschnitt[s] === false ? true : false;
    HD.zeichnen();
    return;
  }

  // Die Abschnitte sind echte <details>. Der Browser klappt sie selbst auf --
  // hier wird NUR gemerkt, wie sie stehen, damit der naechste Zeichenlauf sie
  // nicht wieder zuklappt. Kein preventDefault: sonst waere das native
  // Verhalten kaputt, und der Pfeil taete wieder nichts.
  // Der Umschalter Gerendert/Quelltext steht INNERHALB des <summary> des
  // Abschnitts "Dateiinhalt". Deshalb muss er VOR der summary-Weiche gefragt
  // werden: die hat ein bedingungsloses return und verschluckte den Klick
  // (gemessen 23.08.2026 -- die Quelltext-Ansicht war ueberhaupt nicht
  // erreichbar, waehrend aria-pressed einen Schalter vortaeuschte).
  var bearb = nah("[data-bearbeiten]");
  if (bearb) {
    ev.preventDefault();
    var pfadB = bearb.dataset.bearbeiten;
    // Rohtext FRISCH holen (frisch=true, Cache umgehen) -- der Datensatz traegt
    // ihn nicht mehr, und ein veralteter Cache-Eintrag koennte ein inzwischen
    // hinzugekommenes Geheimnis uebersehen. Erst wenn er da ist, den Editor
    // oeffnen. Enthaelt die Datei maskierte Zugangszeilen, NICHT oeffnen: ein
    // Speichern schriebe sonst eine Fassung ohne das echte Geheimnis zurueck.
    HD.dateiHolen(pfadB, function (fehler, d) {
      if (fehler) { HD.melden(HD.fuellen(HD.W.inhaltFehler, { grund: fehler })); return; }
      if (d.ausgeblendeteZeilen && d.ausgeblendeteZeilen.length) {
        HD.melden(HD.W.bearbeitenGesperrt);
        return;
      }
      HD.S.bearbeitet = pfadB;
      HD.S.entwurf = d.text;
      HD.S.entwurfStart = d.text;
      HD.zeichnen();
      var neuesFeld = document.getElementById("editor-feld");
      if (neuesFeld) neuesFeld.focus();
    }, true);
    return;
  }

  if (nah("[data-bearbeiten-aus]")) {
    var laufend = document.getElementById("editor-feld");
    if (laufend && HD.S.entwurfStart != null && laufend.value !== HD.S.entwurfStart) {
      if (!confirm(HD.W.ungespeichert)) { ev.preventDefault(); return; }
    }
    HD.S.bearbeitet = null;
    HD.S.entwurf = null;
    HD.S.entwurfStart = null;
    HD.zeichnen();
    ev.preventDefault();
    return;
  }

  var sp = nah("[data-speichern]");
  if (sp) {
    var feldJetzt = document.getElementById("editor-feld");
    if (feldJetzt) HD.speichern(sp.dataset.speichern, feldJetzt.value);
    ev.preventDefault();
    return;
  }

  var qtFrueh = nah("[data-quelltext]");
  if (qtFrueh) {
    var eqf = HD.eintragMit(HD.S.auswahl) || (HD.S.baumDatei ? HD.eintragMit("datei:" + HD.S.baumDatei) : null);
    if (eqf && eqf.pfad) {
      HD.S.quelltext[eqf.pfad] = qtFrueh.dataset.quelltext === "1";
      HD.zeichnen();
    }
    // Das native Aufklappen des <details> wuerde sonst zusaetzlich ausloesen.
    ev.preventDefault();
    return;
  }

  var summary = nah("summary");
  if (summary) {
    var block = summary.closest(".eigenschaft-abschnitt");
    if (block && block.dataset.abschnitt) {
      var warOffen = block.hasAttribute("open");
      HD.S.abschnitt[block.dataset.abschnitt] = !warOffen;
    }
    return;
  }

  var qt = nah("[data-quelltext]");
  if (qt) {
    var eq = HD.eintragMit(HD.S.auswahl) || (HD.S.baumDatei ? HD.eintragMit("datei:" + HD.S.baumDatei) : null);
    if (eq && eq.pfad) { HD.S.quelltext[eq.pfad] = qt.dataset.quelltext === "1"; HD.zeichnen(); }
    return;
  }

  var filter = nah("[data-filter]");
  if (filter) {
    var c = filter.dataset.filter;
    var i = HD.S.filter.indexOf(c);
    if (i >= 0) HD.S.filter.splice(i, 1); else HD.S.filter.push(c);
    HD.adresseSchreiben(true);
    HD.zeichnen();
    return;
  }

  var ansicht = nah("[data-ansicht]");
  if (ansicht) { HD.S.ansicht = ansicht.dataset.ansicht; HD.adresseSchreiben(true); HD.zeichnen(); return; }

  if (nah("#detail-zu")) { HD.schliessen(); return; }
  if (nah("#leiste-klapp")) { HD.leisteKlappen(); return; }
  if (nah("#thema")) { HD.themaWechseln(); return; }
  if (nah("#palette-auf")) { HD.paletteAuf(); return; }
  if (nah("#neu-messen")) { HD.kopieren("node dashboard/index.js --html dashboard.html"); return; }

  var idZeile = nah("[data-id]");
  if (idZeile) { HD.oeffnen(idZeile.dataset.id); return; }

  if (z.closest && z.closest("#palette") === null && HD.S.palette) HD.paletteZu();
});

// --- Eingabe -------------------------------------------------------------
document.addEventListener("input", function (ev) {
  if (ev.target.id === "suche") {
    HD.S.suche = ev.target.value;
    HD._suchFokus = true;
    HD.adresseSchreiben(true);
    HD.zeichnen();
    HD._suchFokus = false;
    var f = document.getElementById("suche");
    if (f) { f.focus(); f.setSelectionRange(f.value.length, f.value.length); }
    return;
  }
  if (ev.target.id === "palette-feld") HD.paletteZeichnen(ev.target.value);
});

// Ein Abschnitt (details) klappt NATIV auf, ohne Neuzeichnen -- deshalb muss der
// Inhalt auf Abruf hier ausgeloest werden. "toggle" bubbelt nicht, darum capture.
// So laedt ein Dokumentblock erst dann, wenn man ihn wirklich aufklappt (lazy).
document.addEventListener("toggle", function () { if (HD.inhaltLaden) HD.inhaltLaden(); }, true);

// --- Tastatur ------------------------------------------------------------
document.addEventListener("keydown", function (ev) {
  var inFeld = /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName) || ev.target.isContentEditable;

  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "k") {
    ev.preventDefault();
    HD.S.palette ? HD.paletteZu() : HD.paletteAuf();
    return;
  }
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "b") { ev.preventDefault(); HD.leisteKlappen(); return; }

  if (ev.key === "Escape") {
    if (HD.S.palette) { HD.paletteZu(); return; }
    if (inFeld) { ev.target.blur(); return; }
    HD.schliessen();
    return;
  }
  if (inFeld) return;

  if (ev.key === "/") {
    ev.preventDefault();
    var f = document.getElementById("suche");
    if (f) f.focus(); else HD.paletteAuf();
    return;
  }

  if (ev.key === "ArrowDown" || ev.key === "ArrowUp" || ev.key === "j" || ev.key === "k") {
    var richtung = (ev.key === "ArrowDown" || ev.key === "j") ? 1 : -1;
    HD.nachbarWaehlen(richtung);
    ev.preventDefault();
    return;
  }
  if (ev.key === "ArrowRight" || ev.key === "ArrowLeft") {
    if (HD.S.seite === "dateien" && HD.S.baumDatei) {
      HD.S.baumOffen[HD.S.baumDatei] = ev.key === "ArrowRight";
      HD.zeichnen();
      ev.preventDefault();
    }
    return;
  }
});

// Eine Auswahl je Seite, nicht eine je Gruppe -- sonst springt die Markierung
// beim Blaettern zwischen den Gruppen hin und her.
HD.nachbarWaehlen = function (richtung) {
  var wahl = HD.S.seite === "dateien" ? ".baum-zeile" : ".eintrag-zeile[data-id], .board-karte";
  var zeilen = Array.prototype.slice.call(document.querySelectorAll(wahl));
  if (!zeilen.length) return;
  var jetzt = -1;
  for (var i = 0; i < zeilen.length; i++) {
    var id = zeilen[i].dataset.id || (zeilen[i].dataset.baumpfad ? "datei:" + zeilen[i].dataset.baumpfad : null);
    if (id && (id === HD.S.auswahl || zeilen[i].dataset.baumpfad === HD.S.baumDatei)) { jetzt = i; break; }
  }
  var neu = Math.max(0, Math.min(zeilen.length - 1, jetzt + richtung));
  var ziel = zeilen[neu];
  if (ziel.dataset.baumpfad) {
    if (ziel.dataset.baumtyp === "ordner") { HD.S.baumDatei = ziel.dataset.baumpfad; HD.zeichnen(); }
    else HD.dateiWaehlen(ziel.dataset.baumpfad);
  } else if (ziel.dataset.id) {
    HD.oeffnen(ziel.dataset.id);
  }
  var n = document.querySelector('[aria-selected="true"]');
  if (n && n.scrollIntoView) n.scrollIntoView({ block: "nearest" });
};

// --- Seitenleiste, Thema -------------------------------------------------
HD.leisteKlappen = function () {
  var an = document.body.getAttribute("data-leiste") !== "eingeklappt";
  if (an) document.body.setAttribute("data-leiste", "eingeklappt");
  else document.body.removeAttribute("data-leiste");
  HD.merken("leiste", an ? "schmal" : "breit");
  var k = document.getElementById("leiste-klapp");
  k.setAttribute("aria-label", an ? HD.W.seitenleisteAus : HD.W.seitenleisteEin);
  k.innerHTML = HD.icon(an ? "panel-left-open" : "panel-left-close");
};

HD.themaWechseln = function () {
  var jetzt = document.documentElement.getAttribute("data-thema") || "system";
  var naechst = jetzt === "system" ? "hell" : (jetzt === "hell" ? "dunkel" : "system");
  if (naechst === "system") document.documentElement.removeAttribute("data-thema");
  else document.documentElement.setAttribute("data-thema", naechst);
  HD.merken("thema", naechst);
  HD.themaZeigen(naechst);
};

HD.themaZeigen = function (art) {
  var symbol = art === "hell" ? "sun" : (art === "dunkel" ? "moon" : "monitor");
  var wort = art === "hell" ? HD.W.themaHell : (art === "dunkel" ? HD.W.themaDunkel : HD.W.themaSystem);
  document.getElementById("thema-symbol").innerHTML = HD.icon(symbol);
  document.getElementById("thema-wort").textContent = wort;
  document.getElementById("thema").setAttribute("title", HD.W.thema + ": " + wort);
};

// --- Befehlspalette ------------------------------------------------------
HD.paletteAuf = function () {
  HD.S.palette = true;
  var g = document.getElementById("palette");
  g.hidden = false;
  var f = document.getElementById("palette-feld");
  f.value = "";
  HD.paletteZeichnen("");
  f.focus();
};

HD.paletteZu = function () {
  HD.S.palette = false;
  document.getElementById("palette").hidden = true;
};

HD.paletteZeichnen = function (q) {
  var liste = document.getElementById("palette-liste");
  var gruppen = [];
  if (!q) {
    gruppen.push({ titel: "Seiten", treffer: Object.keys(HD.D.seiten).map(function (id) {
      return { id: "seite:" + id, name: HD.D.seiten[id].name, unter: HD.D.seiten[id].ort || "", symbol: HD.D.seiten[id].icon };
    }) });
  } else {
    var seiten = Object.keys(HD.D.seiten).filter(function (id) {
      return HD.D.seiten[id].name.toLowerCase().indexOf(q.toLowerCase()) >= 0;
    }).map(function (id) {
      return { id: "seite:" + id, name: HD.D.seiten[id].name, unter: HD.D.seiten[id].ort || "", symbol: HD.D.seiten[id].icon };
    });
    if (seiten.length) gruppen.push({ titel: "Seiten", treffer: seiten });

    var nachSeite = {};
    HD.D.eintraege.forEach(function (e) {
      if (!HD.passt(e, q)) return;
      if (!nachSeite[e.seite]) nachSeite[e.seite] = [];
      if (nachSeite[e.seite].length < 6) nachSeite[e.seite].push(e);
    });
    Object.keys(nachSeite).forEach(function (s) {
      gruppen.push({ titel: HD.D.seiten[s] ? HD.D.seiten[s].name : s, treffer: nachSeite[s].map(function (e) {
        return { id: e.id, name: e.name, unter: e.pfad || e.artWort || "", symbol: HD.symbolFuer(e) };
      }) });
    });
  }
  liste.innerHTML = gruppen.length
    ? gruppen.map(function (g) {
        return '<div class="palette-gruppe">' + HD.esc(g.titel) + "</div>"
          + g.treffer.map(function (t) {
              return '<button class="palette-treffer" data-palette="' + HD.esc(t.id) + '" role="option">'
                + '<span class="baum-symbol">' + HD.icon(t.symbol) + "</span>"
                + '<span class="baum-name">' + HD.markiere(t.name, q) + "</span>"
                + '<span class="palette-pfad">' + HD.esc(t.unter) + "</span></button>";
            }).join("");
      }).join("")
    : '<div class="leer-kompakt">' + HD.esc(HD.D.leer.treffer.text) + "</div>";
};

document.addEventListener("click", function (ev) {
  var p = ev.target.closest ? ev.target.closest("[data-palette]") : null;
  if (!p) return;
  var id = p.dataset.palette;
  HD.paletteZu();
  if (id.indexOf("seite:") === 0) HD.zurSeite(id.slice(6));
  else HD.oeffnen(id);
});

// --- Griff (Panelbreite) -------------------------------------------------
(function () {
  var griff = document.getElementById("griff");
  var zieht = false;
  griff.addEventListener("mousedown", function () { zieht = true; griff.setAttribute("data-zieht", "ja"); });
  document.addEventListener("mousemove", function (ev) {
    if (!zieht) return;
    var max = Math.round(window.innerWidth * 0.6);
    HD.S.breite = Math.max(320, Math.min(max, window.innerWidth - ev.clientX));
    document.getElementById("detail").style.setProperty("--detail-breite", HD.S.breite + "px");
  });
  document.addEventListener("mouseup", function () {
    if (!zieht) return;
    zieht = false;
    griff.removeAttribute("data-zieht");
    HD.merken("breite", HD.S.breite);
  });
  griff.addEventListener("keydown", function (ev) {
    var max = Math.round(window.innerWidth * 0.6);
    if (ev.key === "ArrowLeft") HD.S.breite = Math.min(max, HD.S.breite + 16);
    else if (ev.key === "ArrowRight") HD.S.breite = Math.max(320, HD.S.breite - 16);
    else return;
    ev.preventDefault();
    document.getElementById("detail").style.setProperty("--detail-breite", HD.S.breite + "px");
    griff.setAttribute("aria-valuenow", String(HD.S.breite));
    HD.merken("breite", HD.S.breite);
  });
})();

// --- Start ---------------------------------------------------------------
window.addEventListener("popstate", function () { HD.adresseLesen(); HD.zeichnen(); });

(function start() {
  if (HD.geholt("leiste", "breit") === "schmal") HD.leisteKlappen();
  HD.S.breite = parseInt(HD.geholt("breite", "320"), 10) || 320;
  HD.themaZeigen(HD.geholt("thema", "system"));
  if (!HD.adresseLesen()) HD.adresseSchreiben(true);
  HD.zeichnen();
})();
`;

module.exports = { quelltext };
