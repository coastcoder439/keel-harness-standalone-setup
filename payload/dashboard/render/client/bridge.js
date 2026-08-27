// BROWSER-TEIL 5 von 6: die Live-Sektionen -- sehen UND bedienen.
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
// LIVE-DATEN HABEN EIN ALTER [Kritik-Runde 2, Problem 6]. Vorher lud diese
// Funktion GENAU EINMAL und merkte sich das Ergebnis unbegrenzt -- im
// Fehlerfall sogar das {error}-Objekt, das jeden weiteren Versuch fuer immer
// verhinderte. Nach einer Stunde offener Seite standen beendete Sitzungen
// weiter als "arbeitet gerade", ein Auftrag ging an eine Sitzung, die es nicht
// mehr gab, und der einzige Ausweg (F5) wurde nirgends genannt.
//
// erzwingen=true holt neu, auch wenn schon etwas da ist (Aktualisieren-Knopf,
// Rueckkehr ins Fenster).
HD.bridgeLade = function (erzwingen) {
  if (!HD.serverModus()) return;
  if (HD._bridgeLaedt) return;
  if (HD.bridgeData && !erzwingen) return;
  if (["ueberblick", "zutun", "hooks", "automatik", "projekte"].indexOf(HD.S.seite) < 0) return;
  HD._bridgeLaedt = true;
  fetch("/bridge/data").then(function (r) { return r.json(); }).then(function (d) {
    HD.bridgeData = d;
    HD.bridgeStand = new Date();
    HD._bridgeLaedt = false;
    HD.zeichnen();
  }).catch(function (e) {
    HD.bridgeData = { error: String(e) };
    HD.bridgeStand = new Date();
    HD._bridgeLaedt = false;
    HD.zeichnen();
  });
};

// Beim Zurueckkehren ins Fenster ist der Stand fast immer veraltet -- dort war
// der Nutzer gerade in einer Sitzung, ueber die diese Seite berichtet.
HD.bridgeFrischHalten = function () {
  window.addEventListener("focus", function () { HD.bridgeLade(true); });
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) HD.bridgeLade(true);
  });
};

// "Stand: 20:43" an jeder Live-Sektion plus ein Knopf, der neu holt. Eine Zahl
// ohne Zeitpunkt ist eine Behauptung; mit Zeitpunkt ist sie eine Messung.
HD.bridgeStandHTML = function () {
  if (!HD.serverModus()) return "";
  var wann = HD.bridgeStand
    ? HD.fuellen(HD.W.standUm, { zeit: HD.uhrzeit(HD.bridgeStand) })
    : HD.W.standUnbekannt;
  return '<span class="live-stand">' + HD.esc(wann)
    + '<button class="ikon-knopf" data-bridge-frisch="1" aria-label="' + HD.esc(HD.W.liveAktualisieren)
    + '" title="' + HD.esc(HD.W.liveAktualisieren) + '">' + HD.icon("refresh") + "</button></span>";
};

HD.uhrzeit = function (d) {
  var z = function (n) { return (n < 10 ? "0" : "") + n; };
  return z(d.getHours()) + ":" + z(d.getMinutes());
};

// Gemeinsame Huelle: Server fehlt -> ein Satz mit dem Startbefehl; Stand
// laedt noch -> ein Satz; Fehler -> ein Satz. Sonst der Inhalt.
HD.liveSektion = function (titel, anzahl, inhaltFn) {
  // Lokale Erklaerung statt direktem Parameter-Aufruf: der Namens-Test in
  // client.test.js sammelt nur function/var-Erklaerungen ein.
  var inhaltVon = inhaltFn;
  // Der Klappzustand kommt aus HD.S.abschnitt -- demselben Ort, den der
  // globale [data-gruppe]-Handler (start.js) kippt. Vorher stand hier das
  // Literal true: der Caret trug aria-expanded="true" und tat bei jedem Klick
  // nichts, waehrend identisch aussehende Koepfe auf Listenseiten sehr wohl
  // klappten [Befund 26.08.2026: Zusagebruch].
  var offen = HD.S.abschnitt["gruppe:" + titel] !== false;
  var rumpf;
  if (!HD.serverModus()) {
    rumpf = '<p class="leer-kompakt">' + HD.esc(HD.W.nurServerText) + "</p>";
  } else if (HD.bridgeData && HD.bridgeData.error) {
    // Fehlertext MIT Handlung: der rohe JS-Fehler allein sagt dem Nutzer
    // nicht, was er tun soll (Regel "Error messages include fix/next step").
    // Der Knopf ist der eigentliche Ausweg -- ohne ihn blieb der Fehlerzustand
    // fuer immer stehen, weil ein einmal gemerktes {error} nie neu lud.
    rumpf = '<p class="leer-kompakt">' + HD.esc(HD.fuellen(HD.W.nichtErreichbar, { grund: HD.bridgeData.error }))
      + " " + HD.esc(HD.W.nichtErreichbarHilfe) + "</p>"
      + '<p class="leer-handlung"><button class="knopf-haupt" data-bridge-frisch="1">'
      + HD.esc(HD.W.nochmalVersuchen) + "</button></p>";
  } else if (!HD.bridgeData) {
    rumpf = '<p class="leer-kompakt">' + HD.esc(HD.W.laedtNoch) + "</p>";
  } else {
    rumpf = inhaltVon(HD.bridgeData);
  }
  return "<section>" + HD.gruppeHTML(titel, anzahl, offen, false, HD.bridgeStandHTML())
    + (offen ? rumpf : "") + "</section>";
};

// --- Sitzungen (Ueberblick, oben -- die Karten des Vorbilds) --------------
HD.sitzungenSektion = function () {
  // Zahl NUR wenn gemessen: solange HD.bridgeData null ist, stuende sonst
  // "Sitzungen 0" ueber "Laedt ..." -- eine Aussage, die es noch nicht gibt,
  // und im Fehlerfall bliebe die 0 dauerhaft stehen [Befund 26.08.2026].
  var aktiv = HD.bridgeData && !HD.bridgeData.error
    ? (HD.bridgeData.sessions || []).filter(function (s) { return s.active; }).length
    : null;
  return HD.liveSektion(HD.W.sitzungen, aktiv, function (d) {
    var alle = d.sessions || [];
    var laufend = alle.filter(function (s) { return s.active; });
    var fruehere = alle.filter(function (s) { return !s.active; });
    if (!laufend.length && !fruehere.length) return HD.leerHTML("bridge-sitzungen");

    // "laeuft gerade" ist KEIN Pruefergebnis -- HD.statusChip("ok") sagt
    // "In Ordnung" und meint damit etwas anderes. Eine haengende Sitzung
    // truege dasselbe gruene Wort. Also eigenes, ehrliches Wort + Zeitangabe.
    // Ohne Titel: ein lesbarer Ersatzsatz statt der rohen Kennung.
    var name = function (s) { return s.title || HD.W.sitzungOhneTitel; };
    var karten = laufend.map(function (s) {
      return '<div class="sitzung-karte">'
        + '<span class="sitzung-punkt" aria-hidden="true"></span>'
        + '<span class="sitzung-haupt">'
        + '<span class="sitzung-titel" title="' + HD.esc(name(s)) + '">' + HD.esc(name(s)) + "</span>"
        + (s.role ? '<span class="sitzung-rolle" title="' + HD.esc(s.role) + '">' + HD.esc(s.role) + "</span>" : "")
        + "</span>"
        // WORAN die Sitzung arbeitet, nicht nur DASS sie arbeitet [Entwurf
        // d-cc.html]. Das Projekt steht in ihrer Rolle und ist bereits geparst.
        + (s.project && s.project.repo
            ? '<span class="sitzung-projekt" title="' + HD.esc(s.project.file || s.project.repo) + '">'
              + HD.esc(s.project.repo) + "</span>"
            : '<span class="sitzung-laeuft">' + HD.esc(HD.W.sitzungLaeuft) + "</span>")
        + "</div>";
    }).join("");
    // HD.leerHTML statt handgeschriebenem Text [Kritik-Runde 3, Rueckfall 6]:
    // hier stand der Leertext von Hand -- ZWEI Zeilen unter einem korrekten
    // HD.leerHTML-Aufruf -- und schluckte damit ausgerechnet im haeufigsten
    // Leerfall den einzigen sinnvollen Knopf ("Jetzt neu abfragen").
    var kartenHTML = laufend.length
      ? '<div class="sitzung-reihe">' + karten + "</div>"
      : HD.leerHTML("bridge-sitzungen");

    // Fruehere Sitzungen nur als EINE Zeile mit Zahl -- 75 Titel flach
    // auszukippen war Beanstandung B10.
    // Jede fruehere Sitzung mit ihrer letzten Aktivitaet -- "frueher" allein
    // kann fuenf Minuten oder drei Wochen heissen [Befund 26.08.2026].
    var alteZeigen = !!HD.S.brueckeAlleSitzungen;
    var alteListe = alteZeigen
      ? '<div class="eintrag-liste">' + fruehere.map(function (s) {
          return '<div class="eintrag-zeile"><span class="eintrag-haupt"><span class="eintrag-titel">'
            + HD.esc(name(s)) + "</span></span>"
            + (s.role ? '<span class="eintrag-meta"><span>' + HD.esc(s.role) + "</span></span>" : "")
            + '<span class="eintrag-schluss mono">' + HD.esc(HD.zeitpunkt(s.lastActivity)) + "</span>"
            + "</div>";
        }).join("") + "</div>"
      : "";
    // Der Weg zurueck fehlte: wer einmal auf 111 fruehere Sitzungen klickte,
    // hatte den Rest des Control Centers dauerhaft begraben [Befund].
    var mehr = "";
    if (fruehere.length) {
      mehr = '<p class="sektion-fuss"><button class="filter-chip" data-bridge-more="'
        + (alteZeigen ? "zu" : "auf") + '" aria-expanded="' + (alteZeigen ? "true" : "false") + '">'
        + HD.esc(alteZeigen ? HD.W.fruehereVerbergen : HD.fuellen(HD.W.fruehereAnzeigen, { n: fruehere.length }))
        + "</button></p>";
    }
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
    // DAS FOLGENREICHSTE IST NICHT DIE VORGABE [Kritik-Runde 2, Problem 4]:
    // vorher stand hier "alle Sitzungen", und ein einziger Klick feuerte einen
    // Auftrag in JEDE laufende Sitzung -- ohne Rueckfrage. Genau das ist am
    // 26.08.2026 passiert, als ein Test einen echten Auftrag in die Sitzung des
    // Owners zustellte. Die Vorgabe ist jetzt die schmalste sinnvolle Wahl:
    // die einzige laufende Sitzung, sonst keine.
    var ziel = HD.S.auftragZiel;
    if (ziel && ziel !== "all" && !sitzungen.some(function (s) { return s.id === ziel; })) ziel = null;
    if (!ziel) ziel = sitzungen.length === 1 ? sitzungen[0].id : "all";
    HD.S.auftragZiel = ziel;
    var optionen = '<option value="all"' + (ziel === "all" ? " selected" : "") + ">" + HD.esc(HD.W.auftragAlle) + "</option>"
      + sitzungen.map(function (s) {
        return '<option value="' + HD.esc(s.id) + '"' + (s.id === ziel ? " selected" : "") + ">"
          + HD.esc(s.title || HD.W.sitzungOhneTitel) + "</option>";
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

    // EIN Auftrag hat EIN Paket -- also ein Auswahlfeld, keine Knopf-Wand
    // [Owner-Befund 26.08.: "alle Arbeitspakete zum Auswaehlen angeheftet"].
    // Nur OFFENE Pakete: einer abgeschlossenen Sache einen Auftrag anzuhaengen
    // ergibt keinen Sinn; die Zahl steht im Label, damit die Kappung sichtbar
    // ist statt stumm.
    var offenePakete = (d.packages || []).filter(function (p) {
      return p.repo === HD.S.auftragProjekt && !p.error
        && !(p.totalSteps > 0 && p.doneSteps === p.totalSteps);
    });
    var anhang = HD.S.auftragPaket;
    var paketHTML;
    if (!offenePakete.length) {
      paketHTML = '<p class="leer-kompakt">' + HD.esc(HD.W.auftragKeinePakete) + "</p>";
    } else {
      var paketTitel = function (p) {
        return String(p.title || p.file).replace(/^(Work package|Paket):\\s*/i, "");
      };
      paketHTML = '<label class="auftrag-feld"><span class="auftrag-feld-label">'
        + HD.esc(HD.fuellen(HD.W.auftragPaketWaehlen, { n: offenePakete.length })) + "</span>"
        + '<select id="bridge-paket" name="paket" autocomplete="off">'
        + '<option value="">' + HD.esc(HD.W.auftragKeinPaket) + "</option>"
        + offenePakete.map(function (p) {
            var an = anhang && anhang.file === p.file;
            return '<option value="' + HD.esc(p.file) + '"' + (an ? " selected" : "") + ">"
              + HD.esc(paketTitel(p)) + "</option>";
          }).join("")
        + "</select></label>";
    }

    var vorschlagHTML = "";
    var gewaehlteSitzung = sitzungen.find(function (s) { return s.id === HD.S.auftragZiel; });
    if (gewaehlteSitzung && gewaehlteSitzung.project && gewaehlteSitzung.project.repo !== HD.S.auftragProjekt) {
      vorschlagHTML = '<button class="filter-chip" data-bridge-projekt-vorschlag="' + HD.esc(gewaehlteSitzung.project.repo) + '">'
        + HD.esc(HD.fuellen(HD.W.auftragProjektVorschlag, { repo: gewaehlteSitzung.project.repo })) + "</button>";
    }

    // Sichtbare Labels statt nur aria-label (Regel "Form controls need
    // <label>"): das Formular sagt selbst, was jedes Feld bedeutet.
    return '<p class="erklaersatz">' + HD.esc(HD.W.auftragKopf) + "</p>"
      + '<div class="auftrag-zeile">'
      + '<label class="auftrag-feld"><span class="auftrag-feld-label">' + HD.esc(HD.W.auftragAn) + "</span>"
      + '<select id="bridge-target" name="ziel" autocomplete="off">' + optionen + "</select></label>"
      + '<label class="auftrag-feld"><span class="auftrag-feld-label">' + HD.esc(HD.W.auftragProjekt) + "</span>"
      + '<select id="bridge-projekt" name="projekt" autocomplete="off">' + projektOptionen + "</select></label>"
      + paketHTML
      + vorschlagHTML
      + "</div>"
      // Der Text lebt in HD.S.auftragText, nicht nur im DOM: sonst loescht
      // JEDES Neuzeichnen (Projektwechsel, Sitzungswechsel, Vorschlag,
      // Fruehere-anzeigen) den bereits getippten Auftrag [Befund 26.08.2026].
      // Waehrend des Sendens ist der Knopf gesperrt und sagt das auch.
      + '<div class="auftrag-zeile">'
      + '<label class="auftrag-feld auftrag-feld-breit"><span class="auftrag-feld-label">' + HD.esc(HD.W.auftragText) + "</span>"
      + '<textarea id="bridge-text" rows="3" name="auftrag" autocomplete="off" placeholder="'
      + HD.esc(HD.W.auftragFeld) + '">' + HD.esc(HD.S.auftragText || "") + "</textarea></label>"
      + "</div>"
      // Der Knopf steht UNTER der Textflaeche auf ihrer Kante, nicht daneben
      // [Kritik-Runde 2, Problem 15]: schwebend neben dem Formular gehoerte er
      // optisch zu nichts und riss eine dritte rechte Kante auf.
      + '<div class="auftrag-fuss">'
      + '<button class="knopf-haupt" data-bridge-order="1"' + (HD.S.auftragLaeuft ? " disabled" : "") + ">"
      + HD.esc(HD.S.auftragLaeuft ? HD.W.auftragLaeuft : HD.W.auftragSenden) + "</button>"
      + "</div>"
      + HD.auftragVerlaufHTML();
  });
};

// Was gesendet wurde, bleibt nachlesbar [Kritik-Runde 2, Problem 4].
HD.auftragVerlaufHTML = function () {
  var v = HD.S.auftragVerlauf || [];
  if (!v.length) return "";
  return '<div class="auftrag-verlauf"><p class="auftrag-verlauf-kopf">' + HD.esc(HD.W.auftragVerlauf) + "</p>"
    + v.map(function (a) {
        return '<p class="auftrag-verlauf-zeile"><time>' + HD.esc(a.um) + "</time> "
          + HD.esc(HD.aufEineZeile(a.text, 96)) + "</p>";
      }).join("")
    + "</div>";
};

// --- Ein Projekt und was an ihm haengt [Owner 27.08.2026] ------------------
// Die Projektliste zeigte rechts Dokumentzahlen -- eine Zahl, die keine Frage
// beantwortet, die ein Mensch stellt. Gefragt wird zweierlei: welche
// Arbeitspakete liegen hier in welchem Stand, und arbeitet gerade jemand
// daran. Beides ist bereits gemessen (bridge.js scanPackages liefert repo,
// scanSessions liefert project) -- es stand nur nicht in der Anzeige.

// Alle Pakete eines Repos. Der Repo-Name der Bruecke ist der Ordnername --
// derselbe, den die Projektliste als Namen fuehrt.
HD.projektPakete = function (repo) {
  var d = HD.bridgeData;
  if (!d || d.error) return null;
  return (d.packages || []).filter(function (p) { return p.repo === repo; });
};

// Der Stand in EINEM Satz. Ein Paket gilt als abgeschlossen, wenn es Schritte
// hat und alle gesetzt sind -- dieselbe Regel wie im Kanban, nicht eine zweite.
HD.projektPaketSatz = function (repo) {
  var pakete = HD.projektPakete(repo);
  if (!pakete) return null;
  if (!pakete.length) return HD.W.projektKeinePakete;
  var fertig = pakete.filter(function (p) {
    return p.totalSteps > 0 && p.doneSteps === p.totalSteps;
  }).length;
  var offen = pakete.length - fertig;
  if (pakete.length === 1) {
    return HD.fuellen(HD.W.projektPaketeEins, {
      stand: offen ? HD.W.kanbanOffen.toLowerCase() : HD.W.kanbanFertig.toLowerCase(),
    });
  }
  if (!offen) return HD.fuellen(HD.W.projektPaketeAlleFertig, { gesamt: pakete.length });
  return HD.fuellen(HD.W.projektPaketeOffen, { offen: offen, gesamt: pakete.length });
};

// Sitzungen, deren Rolle auf dieses Repo zeigt. projectForRole hat das bereits
// server-seitig aus docs/08-sessions-rollen.md gelesen -- hier wird nur
// gefiltert, nichts geraten.
HD.projektSitzungen = function (repo) {
  var d = HD.bridgeData;
  if (!d || d.error) return null;
  return (d.sessions || []).filter(function (s) {
    return s.project && s.project.repo === repo;
  });
};

HD.projektSitzungSatz = function (repo) {
  var sitzungen = HD.projektSitzungen(repo);
  if (!sitzungen) return null;
  var laufend = sitzungen.filter(function (s) { return s.active; });
  if (!laufend.length) return HD.W.projektKeineSitzung;
  if (laufend.length === 1) return HD.W.projektSitzungEine;
  return HD.fuellen(HD.W.projektSitzungen, { n: laufend.length });
};

// Die Sitzungen eines Projekts als eigene Sektion im Projekt-Detail. Dieselben
// Karten wie im Control Center -- ein Ding, eine Form.
HD.projektSitzungenSektion = function (repo) {
  return HD.liveSektion(HD.W.projektSitzungenTitel, null, function (d) {
    var eigene = (d.sessions || []).filter(function (s) {
      return s.project && s.project.repo === repo;
    });
    if (!eigene.length) return HD.leerHTML("projekt-sitzungen");
    var name = function (s) { return s.title || HD.W.sitzungOhneTitel; };
    var laufend = eigene.filter(function (s) { return s.active; });
    var ruhend = eigene.filter(function (s) { return !s.active; });
    var karten = laufend.map(function (s) {
      return '<div class="sitzung-karte">'
        + '<span class="sitzung-punkt" aria-hidden="true"></span>'
        + '<span class="sitzung-haupt">'
        + '<span class="sitzung-titel" title="' + HD.esc(name(s)) + '">' + HD.esc(name(s)) + "</span>"
        + (s.role ? '<span class="sitzung-rolle" title="' + HD.esc(s.role) + '">' + HD.esc(s.role) + "</span>" : "")
        + "</span>"
        + '<span class="sitzung-laeuft">' + HD.esc(HD.W.sitzungLaeuft) + "</span>"
        + "</div>";
    }).join("");
    // Die Frage lautet "wer arbeitet HIER GERADE". Die 130 beendeten Sitzungen
    // desselben Projekts als Liste auszukippen schiebt alles andere aus dem
    // Bild [gemessen 27.08.2026: 20 gleichnamige Zeilen ueber den Reitern].
    var ruhendHTML = ruhend.length
      ? '<p class="sektion-fuss">' + HD.esc(HD.fuellen(HD.W.fruehereAnzeigen, { n: ruhend.length })) + "</p>"
      : "";
    return (karten ? '<div class="sitzung-reihe">' + karten + "</div>" : "") + ruhendHTML;
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

// --- Arbeitspakete eines Projekts als KANBAN [Owner-Wunsch W7] -------------
// "Ich will eine vernuenftige Kanban-Uebersicht": Pakete nach ZUSTAND, nicht
// als flache Liste. Der Zustand kommt aus den Schritten des Artefakts --
// nichts geraten: keine Schritte erledigt = offen, alle = abgeschlossen,
// dazwischen = in Arbeit. Jede Karte nennt den naechsten Schritt und oeffnet
// auf Klick das volle Dokument.
HD.paketKanban = function (repo) {
  return HD.liveSektion(HD.W.arbeitspakete, null, function (d) {
    var pakete = (d.packages || []).filter(function (p) { return p.repo === repo && !p.error; });
    if (!pakete.length) return HD.leerHTML("bridge-pakete");

    var spalten = [
      { schluessel: "offen", titel: HD.W.kanbanOffen, pakete: [] },
      { schluessel: "arbeit", titel: HD.W.kanbanArbeit, pakete: [] },
      { schluessel: "fertig", titel: HD.W.kanbanFertig, pakete: [] },
    ];
    pakete.forEach(function (p) {
      var ziel;
      if (p.totalSteps > 0 && p.doneSteps === p.totalSteps) ziel = spalten[2];
      else if (p.doneSteps > 0) ziel = spalten[1];
      else ziel = spalten[0];
      ziel.pakete.push(p);
    });

    var titelKurz = function (p) {
      // Erst das Praefix weg, dann Auszeichnung raus und auf eine Zeile kappen
      // [Kritik-Runde 2, Problem 8]. Vorher stand der Markdown-Rohtext auf der
      // Karte, samt Sternchen und mitten im Wort abgeschnitten.
      return HD.aufEineZeile(String(p.title || p.file).replace(/^(Work package|Paket):\\s*/i, ""), 64);
    };
    var naechsterSchritt = function (p) {
      var offen = (p.steps || []).filter(function (s) { return !s.done; })[0];
      // 56 statt 80: auf einer Kanban-Karte in einer Drittelspalte sind 80
      // Zeichen zwei volle Zeilen, die das CSS dann noch einmal kappt -- also
      // ein zweimal abgeschnittener Satz [Abnahme 26.08.2026].
      return offen ? HD.aufEineZeile(offen.text, 56) : null;
    };

    return '<div class="kanban">' + spalten.map(function (s) {
      var karten = s.pakete.length
        ? s.pakete.map(function (p) {
            var naechst = naechsterSchritt(p);
            var anteil = p.totalSteps ? Math.round((p.doneSteps / p.totalSteps) * 100) : 0;
            // EINE ANATOMIE FUER ALLE DREI SPALTEN [Kritik-Runde 2, Problem 10]:
            // vorher hatte "Offen" gar keinen Balken, "In Arbeit" einen
            // teilgefuellten gruenen und "Abgeschlossen" einen vollen gruenen --
            // GLEICHER Gruenton fuer "laeuft" und "fertig", damit trug die Farbe
            // keine Information mehr. Jetzt zeigt jede Karte ihre Spur, auch bei
            // 0 von 5; Gruen bleibt dem aktiven Fortschritt vorbehalten, fertig
            // ist ruhiges Grau.
            return '<button class="kanban-karte" data-bridge-doc="' + HD.esc(p.file) + '">'
              + '<span class="kanban-titel">' + HD.esc(titelKurz(p)) + "</span>"
              + '<span class="kanban-balken" data-zustand="' + HD.esc(s.schluessel) + '" role="img" aria-label="'
              + HD.esc(HD.fuellen(HD.W.schrittVon, { done: p.doneSteps, total: p.totalSteps })) + '">'
              + '<span class="kanban-balken-fuell" style="width:' + anteil + '%"></span></span>'
              + '<span class="kanban-fuss">'
              + HD.esc(HD.fuellen(HD.W.schrittVon, { done: p.doneSteps, total: p.totalSteps }))
              + (naechst ? " · " + HD.esc(HD.W.kanbanNaechster) + ": " + HD.esc(naechst) : "")
              + "</span></button>";
          }).join("")
        : '<p class="leer-kompakt">' + HD.esc(HD.W.kanbanLeer) + "</p>";
      return '<div class="kanban-spalte"><h3 class="kanban-kopf">' + HD.esc(s.titel)
        + '<span class="gruppen-zahl">' + s.pakete.length + "</span></h3>" + karten + "</div>";
    }).join("") + "</div>";
  });
};

// --- Automatik (Harness-Reiter) -------------------------------------------
// [Owner 25.08.2026: "was automatisch durchlaeuft, zu welcher Uhrzeit"]. Zeigt
// GEMESSENE Laeufe. Findet sich nichts, sagt die Seite das ehrlich -- mit dem
// Weg, wie man es einrichtet (ein Leerzustand ohne Handlung ist eine
// Sackgasse, ui-standard Punkt 4).
HD.automatikSektion = function () {
  return HD.liveSektion(HD.W.automatikLaeufe, null, function (d) {
    var a = d.automatik || {};
    var laeufe = a.laeufe || [];
    if (laeufe.length) {
      return '<div class="eintrag-liste">' + laeufe.map(function (l) {
        return '<div class="eintrag-zeile"><span class="eintrag-haupt">'
          + '<span class="eintrag-titel">' + HD.esc(l.name) + "</span>"
          + '<span class="eintrag-unter">' + HD.esc(HD.W.automatikArt) + "</span></span>"
          + '<span class="eintrag-meta"><span>' + HD.esc(l.status || "") + "</span></span>"
          + '<span class="eintrag-schluss mono">' + HD.esc(l.naechster || "—") + "</span></div>";
      }).join("") + "</div>";
    }
    // Leer -- und das ist die Wahrheit. Der Satz nennt, was fehlt UND was hilft.
    var hilfe = (a.skripte || []).length
      ? '<p class="leer-kompakt">' + HD.esc(HD.W.automatikEinrichten) + " <code>"
        + HD.esc(a.skripte[0]) + "</code></p>"
      : "";
    var grund = a.aufgabenGelesen === false
      ? '<p class="leer-kompakt">' + HD.esc(HD.W.automatikNichtLesbar) + "</p>" : "";
    return HD.leerHTML("automatik") + hilfe + grund;
  });
};

// --- Guard-Selbsttests (Hooks) --------------------------------------------
HD.guardSektion = function () {
  if (!HD.serverModus()) return "";
  var anzahl = ((HD.bridgeData || {}).guards || []).length;
  return HD.liveSektion(HD.W.guardTests, anzahl, function (d) {
    var laeuft = HD.S.selbsttestLaeuft;
    // NUR DER LAUFENDE KNOPF IST GESPERRT [Kritik-Runde 2, Problem 2]: vorher
    // sperrte ein einziger Selbsttest ALLE Guard-Knoepfe -- und weil es weder
    // Zeitgrenze noch Abbruch gab, blieb die ganze Leiste bei einem haengenden
    // Server dauerhaft tot, ohne ein Wort der Erklaerung.
    var chips = (d.guards || []).map(function (g) {
      var an = laeuft === g;
      return '<button class="filter-chip" data-bridge-selftest="' + HD.esc(g) + '"' + (an ? " disabled" : "") + ">"
        + HD.esc(g) + (an ? " " + HD.esc(HD.W.selbsttestLaeuft) : "") + "</button>";
    }).join("");
    var e = HD.S.selbsttest;
    // DAS URTEIL ZUERST [Kritik-Runde 2, Problem 2]: wer einen Selbsttest
    // startet, will wissen, ob der Waechter greift -- nicht, wie viele
    // Millisekunden er brauchte. Die Rohausgabe steht darunter in einem
    // Block, den man lesen kann, wenn man will.
    var ergebnis;
    if (e) {
      ergebnis = '<p class="erklaersatz" aria-live="polite">' + HD.statusChip(e.ok ? "ok" : "befund")
        + " <strong>" + HD.esc(e.ok ? HD.W.probeBestanden : HD.W.probeDurchgefallen) + "</strong> — "
        + HD.esc(e.guard) + "</p>"
        + (e.text ? '<pre class="probe-ausgabe">' + HD.esc(e.text) + "</pre>" : "");
    } else {
      ergebnis = '<p class="erklaersatz" aria-live="polite">' + HD.esc(HD.W.selbsttestHinweis) + "</p>";
    }
    return '<div class="werkzeugleiste">' + chips + "</div>" + ergebnis;
  });
};

// Ein delegierter Listener fuer alle Live-Knoepfe -- einmal registriert.
HD.bridgeClick = function (ev) {
  var t = ev.target.closest
    ? ev.target.closest("[data-bridge-toggle],[data-bridge-selftest],[data-bridge-order],[data-bridge-pkg],[data-bridge-more],[data-bridge-doc],[data-bridge-projekt-vorschlag],[data-bridge-frisch]")
    : null;
  if (!t) return false;

  // Live-Daten neu holen -- der Ausweg aus einem gemerkten Fehlerzustand und
  // der Weg zu einem frischen Stand, ohne die ganze Seite neu zu laden
  // (was Klappzustaende, Baum und Scrollposition wegwerfen wuerde).
  if (t.dataset.bridgeFrisch) {
    HD.bridgeData = null;
    HD.bridgeLade(true);
    HD.zeichnen();
    return true;
  }
  if (t.dataset.bridgeProjektVorschlag) {
    HD.S.auftragProjekt = t.dataset.bridgeProjektVorschlag;
    HD.S.auftragPaket = null;
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
    HD.S.brueckeAlleSitzungen = t.dataset.bridgeMore === "auf";
    HD.zeichnen();
    return true;
  }
  // Kanban-Karte -> das volle Dokument des Arbeitspakets, in derselben
  // Dokumentansicht wie jede andere Datei [Owner-Wunsch W8].
  if (t.dataset.bridgeDoc) {
    HD.dokumentOeffnen(t.dataset.bridgeDoc);
    return true;
  }

  // toggle und selftest tragen ihre Angaben als Frage-Parameter, nur der
  // Auftrag hat einen JSON-Leib -- so erwartet es serve.js.
  // KEINE ANFRAGE OHNE ZEITGRENZE [Kritik-Runde 2, Problem 2]. Antwortet der
  // Server nie, blieb die Oberflaeche vorher fuer immer im Laufzustand stehen --
  // gesperrte Knoepfe, kein Wort, kein Ausweg ausser F5. Nach 30 Sekunden gilt
  // die Anfrage als gescheitert und sagt das.
  var send = function (weg, fertig) {
    var fertigGemeldet = false;
    var einmal = function (a) { if (fertigGemeldet) return; fertigGemeldet = true; fertig(a); };
    var uhr = setTimeout(function () { einmal({ fehler: HD.W.zeitUeberschritten }); }, 30000);
    fetch(weg, { method: "POST" }).then(function (r) { return r.json(); })
      .then(function (a) { clearTimeout(uhr); einmal(a); })
      .catch(function (e) { clearTimeout(uhr); einmal({ fehler: String(e) }); });
  };
  if (t.dataset.bridgeToggle) {
    var datei2 = t.dataset.bridgeToggle;
    var index = Number(t.dataset.bridgeIndex);
    // EIN KLICK, DER AUF DIE PLATTE SCHREIBT, BRAUCHT EINEN ZWISCHENZUSTAND
    // [Kritik-Runde 2, Problem 4]: vorher gab es keinen. Bei langsamer Antwort
    // klickte der Nutzer nach, zwei Umschaltungen hoben sich auf, der Haken
    // landete im Ausgangszustand -- und er hielt die Oberflaeche fuer kaputt.
    // Die Zeile ist waehrend der Anfrage gesperrt.
    HD.S.hakenLaeuft = HD.S.hakenLaeuft || {};
    var hakenSchluessel = datei2 + "#" + index;
    if (HD.S.hakenLaeuft[hakenSchluessel]) return true;
    HD.S.hakenLaeuft[hakenSchluessel] = true;
    t.disabled = true;
    send("/bridge/toggle?pfad=" + encodeURIComponent(datei2) + "&index=" + encodeURIComponent(index), function (a) {
      HD.S.hakenLaeuft[hakenSchluessel] = false;
      if (!a.ok) { HD.meldenFehler(a.fehler || HD.W.hakenFehler); HD.zeichnen(); return; }
      var pkg = (HD.bridgeData.packages || []).find(function (p) { return p.file === datei2; });
      if (pkg && pkg.steps && pkg.steps[index]) {
        pkg.steps[index].done = a.nowDone;
        pkg.doneSteps = pkg.steps.filter(function (s) { return s.done; }).length;
      }
      // Ein Schritt in einer Datei laesst sich nicht "rueckgaengig machen" wie
      // eine Textaenderung -- aber derselbe Klick noch einmal stellt den alten
      // Zustand her. Die Meldung sagt das, statt den Nutzer raten zu lassen.
      HD.melden(a.nowDone ? HD.W.hakenGesetzt : HD.W.hakenEntfernt);
      HD.zeichnen();
    });
  } else if (t.dataset.bridgeSelftest) {
    // Ergebnis in HD.S, Anzeige beim Zeichnen -- ein Ergebnis, das nur im DOM
    // haengt, verschwindet beim naechsten Zeichenlauf [Befund 26.08.2026].
    var wachname = t.dataset.bridgeSelftest;
    HD.S.selbsttestLaeuft = wachname;
    HD.zeichnen();
    send("/bridge/selftest?guard=" + encodeURIComponent(wachname), function (a) {
      HD.S.selbsttestLaeuft = null;
      HD.S.selbsttest = {
        guard: wachname,
        ok: !!a.ok,
        text: (a.output || a.fehler || a.error || ""),
      };
      HD.zeichnen();
    });
  } else if (t.dataset.bridgeOrder) {
    var feld = document.getElementById("bridge-text");
    var text = feld ? feld.value : (HD.S.auftragText || "");
    var ziel = (document.getElementById("bridge-target") || {}).value || "all";
    // Pflichtfeld: ein leerer Auftrag ging bisher wortlos raus (nur die
    // Paket-Klammer). Fehler AM Feld, mit Fokus [Regel "focus first error"].
    if (!text.trim()) {
      HD.melden(HD.W.auftragLeer);
      if (feld) feld.focus();
      return true;
    }
    if (HD.S.auftragLaeuft) return true;
    // VOR DEM UNUMKEHRBAREN WIRD GEFRAGT [Kritik-Runde 2, Problem 4]. Ein
    // Auftrag an "alle" erreicht mehrere fremde Sitzungen gleichzeitig und laesst
    // sich nicht zurueckholen -- also nennt die Rueckfrage die Empfaenger beim
    // Namen, statt nur "alle" zu sagen. Bei genau einer Sitzung ist das kein
    // Massenversand: dort fragt nichts, das waere nur Reibung.
    if (ziel === "all") {
      var empfaenger = ((HD.bridgeData && HD.bridgeData.sessions) || [])
        .filter(function (s) { return s.active; })
        .map(function (s) { return s.title || HD.W.sitzungOhneTitel; });
      if (empfaenger.length > 1) {
        var frage = HD.fuellen(HD.W.auftragAlleFrage, { n: empfaenger.length })
          + "\\n\\n" + empfaenger.join("\\n");
        if (!confirm(frage)) return true;
      }
    }
    HD.S.auftragLaeuft = true;
    HD.S.auftragText = text;
    // Das angeheftete Paket geht als Referenzzeile mit -- /bridge/order kennt
    // nur {target, text}, kein eigenes Schema-Feld (Auftraege werden von
    // prompt-form.js woertlich als Text zugestellt, siehe .claude/prompt-form.js).
    var anhang = HD.S.auftragPaket;
    var voll = anhang ? "[Paket: " + anhang.file + "] " + text : text;
    // Rueckmeldung ueber HD.melden -- der Toast lebt in der SCHALE und
    // ueberlebt HD.zeichnen(). Vorher stand sie in #bridge-order-out INNERHALB
    // der Hauptflaeche und wurde vom Neuzeichnen im selben Tick geloescht:
    // der Nutzer bekam null Rueckmeldung [Befund 26.08.2026].
    HD.zeichnen();
    fetch("/bridge/order", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ target: ziel, text: voll }) })
      .then(function (r) { return r.json(); }).then(function (a) {
        HD.S.auftragLaeuft = false;
        if (a.ok) {
          // WAS ICH GESENDET HABE, KANN ICH NACHLESEN [Kritik-Runde 2,
          // Problem 4]: der gesendete Text stand 1,5 Sekunden im Toast und war
          // danach unwiederbringlich weg -- der Nutzer konnte nicht einmal
          // pruefen, WAS er losgeschickt hatte. Das Feld wird erst nach
          // bestaetigtem Erfolg geleert, der Text wandert in den Verlauf.
          HD.S.auftragVerlauf = (HD.S.auftragVerlauf || []);
          HD.S.auftragVerlauf.unshift({ text: voll, ziel: ziel, um: HD.uhrzeit(new Date()) });
          if (HD.S.auftragVerlauf.length > 5) HD.S.auftragVerlauf.length = 5;
          HD.S.auftragText = "";
          HD.S.auftragPaket = null;
          HD.melden(HD.fuellen(HD.W.auftragZugestellt, { datei: a.file || "" }));
        } else {
          // Der Text bleibt im Feld stehen -- ein gescheiterter Auftrag darf
          // nicht auch noch die Formulierung kosten.
          HD.meldenFehler(HD.fuellen(HD.W.nichtErreichbar, { grund: a.fehler || a.error || "" }),
            null, HD.W.auftragStehtNoch);
        }
        HD.zeichnen();
      }).catch(function (e) {
        HD.S.auftragLaeuft = false;
        HD.meldenFehler(HD.fuellen(HD.W.nichtErreichbar, { grund: String(e) }),
          null, HD.W.auftragStehtNoch);
        HD.zeichnen();
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
  if (ev.target && ev.target.id === "bridge-paket") {
    HD.S.auftragPaket = ev.target.value ? { repo: HD.S.auftragProjekt, file: ev.target.value } : null;
    return true;
  }
  return false;
};

// Jeder Tastendruck im Auftragsfeld landet im Zustand -- ohne das ueberlebt
// der Text kein Neuzeichnen (start.js ruft das im input-Listener auf).
HD.bridgeEingabe = function (ev) {
  if (ev.target && ev.target.id === "bridge-text") {
    HD.S.auftragText = ev.target.value;
    return true;
  }
  return false;
};
`;

module.exports = { quelltext };
