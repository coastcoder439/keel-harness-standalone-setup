// STYLES-EXTRA -- die grossen Flaechen-Bloecke des Stylesheets, ausgelagert
// am 25.08.2026 abends: styles.js hatte die 800-Zeilen-Hausgrenze gerissen
// (Control-Center-Widgets). Hier liegt NUR CSS-Text; Tokens, Farbmathe und
// der Zusammenbau bleiben in styles.js -- ein Vertrag, zwei Dateien.

const BOARD_UND_PALETTE = `
/* Board (nur "Zu tun"): Spalte 260; leere Spalten fallen auf 52-px-Rails
   zusammen -- das Vokabular bleibt sichtbar ("Fehler 0"). */
.board{display:flex;gap:12px;align-items:flex-start;overflow-x:auto;padding-bottom:8px}
.board-spalte{flex:0 0 var(--board-spalte);width:var(--board-spalte);background:var(--card);
  border:1px solid var(--border);border-radius:var(--radius-lg);padding:8px;
  border-top:2px solid var(--sc,var(--border))}
.board-spalte[data-leer="ja"]{flex:0 0 var(--board-rail);width:var(--board-rail);
  display:flex;flex-direction:column;align-items:center;gap:8px;padding:8px 4px}
.board-spalte[data-leer="ja"] .board-kopf{writing-mode:vertical-rl;transform:rotate(180deg);
  white-space:nowrap;justify-content:flex-start}
.board-kopf{display:flex;align-items:center;gap:6px;font-size:var(--text-xs);font-weight:600;
  text-transform:uppercase;letter-spacing:.05em;padding:4px 4px 8px}
.board-zahl{margin-left:auto;color:var(--muted-foreground);font-variant-numeric:tabular-nums}
.board-karte{display:block;width:100%;text-align:left;background:var(--background);
  border:1px solid var(--border);border-radius:var(--radius-md);padding:8px 10px;margin-bottom:8px}
.board-karte:hover{background:color-mix(in srgb,var(--accent) 50%,transparent)}
.board-bereich{font-family:var(--mono);font-size:var(--text-xs);color:var(--muted-foreground)}
.board-was{font-size:var(--text-compact);display:-webkit-box;-webkit-line-clamp:2;
  -webkit-box-orient:vertical;overflow:hidden}
.board-hinweis{font-size:var(--text-xs);color:var(--muted-foreground);padding:8px 4px}
/* Befehlspalette (Strg+K): Overlay ueber allem, gruppiert, ohne Praefixmodi. */
.palette-schleier{position:fixed;inset:0;background:color-mix(in srgb,var(--foreground) 30%,transparent);
  display:grid;place-items:start center;padding-top:12vh;z-index:50}
.palette-schleier[hidden]{display:none}
.palette{width:min(640px,92vw);max-height:70vh;display:flex;flex-direction:column;
  background:var(--popover);color:var(--popover-foreground);border:1px solid var(--border);
  border-radius:var(--radius-xl);overflow:hidden;box-shadow:0 16px 48px color-mix(in srgb,var(--foreground) 22%,transparent)}
.palette-eingabe{height:44px;padding:0 14px;border:0;border-bottom:1px solid var(--border);
  background:transparent;color:inherit;font-size:var(--text-sm);width:100%}
.palette-liste{overflow-y:auto;padding:6px}
.palette-gruppe{font-size:var(--text-micro);text-transform:uppercase;letter-spacing:.1em;
  color:var(--muted-foreground);padding:8px 10px 4px;font-family:var(--mono)}
.palette-treffer{display:flex;align-items:center;gap:10px;width:100%;text-align:left;padding:7px 10px;
  border-radius:var(--radius-md);font-size:var(--text-compact)}
.palette-treffer[aria-selected="true"],.palette-treffer:hover{background:var(--accent);color:var(--accent-foreground)}
.palette-pfad{margin-left:auto;font-family:var(--mono);font-size:var(--text-xs);color:var(--muted-foreground)}
`;

const SCHMAL = `
/* Unter 768: Seitenleiste als Schublade, Detail als Bottom-Sheet 85dvh. */
@media (max-width:767px){
  body{grid-template-columns:1fr}
  .seitenleiste{position:fixed;inset:0 auto 0 0;width:var(--seitenleiste);z-index:40;
    transform:translateX(-100%);transition:transform var(--dauer)}
  body[data-schublade="offen"] .seitenleiste{transform:none}
  body[data-schublade="offen"]::after{content:"";position:fixed;inset:0;z-index:30;
    background:color-mix(in srgb,var(--foreground) 30%,transparent)}
  .buehne{grid-template-columns:1fr}
  .detail{position:fixed;inset:auto 0 0 0;width:100%;max-width:none;height:85dvh;z-index:45;
    border-left:0;border-top:1px solid var(--border);
    border-radius:var(--radius-xl) var(--radius-xl) 0 0}
  .detail .griff{display:none}
  .baum-flaeche{flex-direction:column}
  .baum{width:100%;max-height:40dvh;border-right:0;border-bottom:1px solid var(--border)}
  .suchfeld{width:100%}
  .kennzahl-reihe{grid-template-columns:repeat(2,minmax(0,1fr))}
  /* Control Center einspaltig: bei 375 px waeren die zwei Spalten rund 150
     und 210 px breit -- die Widgets wuerden unlesbar gequetscht oder schoeben
     die Seite waagerecht auf [Befund 26.08.2026]. */
  .cc-raster{grid-template-columns:1fr}
  .auftrag-feld select{max-width:none;width:100%}
  .auftrag-zeile{flex-direction:column;align-items:stretch}
  .auftrag-zeile .knopf-haupt{width:100%}
}
@media (min-width:768px) and (max-width:1023px){
  .detail{width:var(--detail-breite);max-width:var(--detail-breite)}
}
`;


const CONTROL_CENTER = `
/* Control Center: Widgets verdichten nach oben [Owner 25.08.2026]. */
.cc-raster{display:grid;grid-template-columns:5fr 7fr;gap:14px;align-items:start}
.cc-spalte{display:grid;gap:14px;min-width:0}
/* Jede Stufe der Raster-Kette braucht min-width:0 -- sonst zwingt eine
   nowrap-Zeile das Widget auf Maximalbreite (gemessen 26.08.: 3382 px). */
.cc-spalte > *{min-width:0}
.cc-voll{grid-column:1/-1;min-width:0}
/* Widget-Rumpf: der Kopf ist HD.gruppeHTML (Baustein), der Rumpf die Karte.
   Die Trennlinie kommt ueber :not(:first-child) -- :first-of-type traf je
   Elementtyp und liess die Linie wandern, sobald eine Zeile klickbar wurde
   [Befund 26.08.2026]. */
.widget-rumpf{background:var(--card);border:1px solid var(--border);
  border-radius:var(--radius-xl);padding:6px 16px;touch-action:manipulation}
.widget-link{display:inline-flex;align-items:center;margin-right:8px;
  font-size:var(--text-micro);font-weight:500;color:var(--primary);
  background:none;border:0;padding:2px 0;text-decoration:underline;text-underline-offset:2px}
.widget-link:hover{color:var(--foreground)}
.widget-link > svg{width:13px;height:13px}
.check-reihe{display:flex;gap:10px;align-items:center;width:100%;text-align:left;
  padding:8px 0;font-size:var(--text-sm);font-weight:500;
  border-radius:var(--radius-md);transition:background var(--dauer)}
.check-reihe + .check-reihe{border-top:1px solid var(--border)}
/* Klickbar sieht anders aus als still -- vorher waren beide identisch und der
   Nutzer musste raten, welche Zeile reagiert [Befund 26.08.2026]. */
.check-reihe:hover{background:color-mix(in srgb,var(--accent) 45%,transparent)}
.check-reihe-still:hover{background:transparent}
.check-reihe-still .zeilen-pfeil{display:none}
/* Handlungsbedarf traegt GEWICHT, nicht nur eine andere Ikonfarbe
   [Kritik-Runde 2, Problem 11]. Linke Farbkante plus getoenter Grund: das
   sieht man aus dem Augenwinkel, ein 16-px-Zeichen nicht. */
.check-reihe-achtung{padding-left:10px;border-left:3px solid var(--status-hinweis);
  background:color-mix(in srgb,var(--status-hinweis) 7%,transparent)}
.check-reihe-achtung .check-text{font-weight:600}
.check-reihe-achtung:hover{background:color-mix(in srgb,var(--status-hinweis) 13%,transparent)}
.check-glyphe{flex:0 0 16px;width:16px;height:16px;display:grid;place-items:center}
.check-text{flex:1 1 auto;min-width:0}
.check-wert{flex:0 0 auto;font-size:var(--text-micro);color:var(--muted-foreground);
  font-weight:400;font-variant-numeric:tabular-nums}
.logbuch{position:relative;margin-left:5px;padding-left:20px}
.logbuch::before{content:"";position:absolute;left:4px;top:8px;bottom:8px;width:2px;background:var(--border)}
.logbuch-halt{position:relative;padding:6px 0}
.logbuch-halt::before{content:"";position:absolute;left:-20px;top:12px;width:10px;height:10px;
  border-radius:var(--radius-pille);background:var(--primary);
  border:2px solid var(--card);box-shadow:0 0 0 1px var(--primary)}
.logbuch-halt.logbuch-leer::before{background:var(--card);box-shadow:0 0 0 1px var(--muted-foreground)}
.logbuch-halt time{display:block;font-size:var(--text-micro);color:var(--muted-foreground)}
.logbuch-halt.logbuch-leer span{color:var(--muted-foreground)}
/* Die Aufmerksamkeits-Flaeche traegt den Warnton -- aber KEIN Kaestchen mehr:
   das sah aus wie eine Checkbox und navigierte weg [Befund 26.08.2026].

   EINE SACHE, EINE STUFE [Kritik-Runde 3, Befund 3]: der Ton war hier fest auf
   --status-hinweis verdrahtet, waehrend derselbe Eintrag auf "Zu tun" als roter
   "Fehler" erschien. Jetzt bestimmt data-stufe die Farbe -- gesetzt aus dem
   hoechsten Rang der Eintraege, die wirklich in der Flaeche stehen. Der
   Vorgabe-Ton bleibt Bernstein fuer den Fall, dass keine Stufe gemessen ist. */
.achtung-widget{--warnton:var(--status-hinweis)}
.achtung-widget[data-stufe="befund"]{--warnton:var(--status-fehler)}
.achtung-widget[data-stufe="unlesbar"]{--warnton:var(--status-unlesbar)}
.achtung-widget[data-stufe="fehlt"]{--warnton:var(--status-fehlt)}
.achtung-widget[data-stufe="hinweis"]{--warnton:var(--status-hinweis)}
.achtung-widget .widget-rumpf{border-color:color-mix(in srgb,var(--warnton) 45%,var(--border));
  border-left:3px solid var(--warnton);
  background:color-mix(in srgb,var(--warnton) 8%,var(--card))}
.drei-zeile{display:flex;gap:11px;align-items:center;width:100%;text-align:left;
  padding:8px 0;font-size:var(--text-sm);font-weight:500;
  border-radius:var(--radius-md);transition:background var(--dauer)}
.drei-zeile + .drei-zeile{border-top:1px solid var(--border)}
.drei-zeile:hover{background:color-mix(in srgb,var(--accent) 45%,transparent)}
.drei-glyphe{flex:0 0 16px;width:16px;height:16px;display:grid;place-items:center}
.drei-text{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* Sitzung: "arbeitet gerade" ist ein Laufzustand, kein Pruefergebnis --
   deshalb eigenes Wort statt des Status-Chips [Befund 26.08.2026]. */
.sitzung-laeuft{flex:0 0 auto;font-size:var(--text-xs);color:var(--status-laeuft);font-weight:500}`;

// ANSEHEN -- Code-Ansicht, gerendertes Markdown und das Detail-Panel.
// Ausgelagert am 26.08.2026: styles.js riss erneut die 800-Zeilen-Hausgrenze
// (Seitenkopf, Fehlerzustand, Live-Stand aus Kritik-Runde 2). Die drei
// Bloecke gehoeren zusammen -- sie beschreiben alle dasselbe: wie man EIN
// Ding ansieht, ob als Quelltext, als Dokument oder im Panel rechts.

const DATEIANSICHT = `
.dateiansicht{flex:1 1 auto;min-width:0;overflow:auto;padding:16px;scrollbar-gutter:stable}
.datei-kopf{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:start;gap:10px;
  padding-bottom:10px;border-bottom:1px solid var(--border)}
.datei-name{display:block;font-size:var(--text-sm);font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.datei-pfad{display:block;font-family:var(--mono);font-size:var(--text-xs);color:var(--muted-foreground);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.datei-meta{display:flex;flex-wrap:wrap;gap:8px;font-size:var(--text-xs);
  color:var(--muted-foreground);padding:8px 0}
.datei-meta > * + *::before{content:"\\00B7";margin-right:8px}
.datei-aktionen{display:flex;align-items:center;gap:4px}
/* Code-Ansicht: Rinne fuer Zeilennummern, Text scrollt waagerecht fuer sich. */
.code-flaeche{display:grid;grid-template-columns:auto minmax(0,1fr);border:1px solid var(--border);
  border-radius:var(--radius-lg);background:var(--muted);overflow:hidden;font-family:var(--mono);
  font-size:var(--text-xs);line-height:20px}
.code-rinne{padding:12px 8px;text-align:right;color:var(--muted-foreground);
  border-right:1px solid var(--border);user-select:none;font-variant-numeric:tabular-nums;white-space:pre}
.code-text{padding:12px;overflow-x:auto;white-space:pre;color:var(--foreground)}
.code-zeile[data-treffer="ja"]{background:color-mix(in srgb,var(--primary) 18%,transparent)}
/* Gerendertes Markdown: 15/1.6, Ueberschriften als em-Leiter relativ dazu. */
.md{font-size:var(--text-md);line-height:1.6;max-width:78ch}
.md h1{font-size:var(--text-md-h1);font-weight:600;margin:1.2em 0 .5em;line-height:1.25}
.md h2{font-size:var(--text-md-h2);font-weight:600;margin:1.2em 0 .4em;line-height:1.3}
.md h3{font-size:var(--text-md-h3);font-weight:600;margin:1em 0 .3em}
.md h4{font-size:var(--text-md-h4);font-weight:600;margin:1em 0 .3em}
.md p,.md ul,.md ol,.md blockquote,.md pre,.md table{margin:.7em 0}
.md ul,.md ol{padding-left:1.4em}
.md code{font-size:var(--text-xs);background:var(--muted);border-radius:var(--radius-sm);padding:1px 4px}
.md pre{background:var(--muted);border-radius:var(--radius-md);padding:12px;overflow-x:auto}
.md pre code{background:none;padding:0}
.md blockquote{border-left:2px solid var(--border);padding-left:12px;color:var(--muted-foreground)}
.md table{border-collapse:collapse;font-size:var(--text-compact);display:block;overflow-x:auto}
.md th,.md td{border:1px solid var(--border);padding:6px 10px;text-align:left}
.md th{background:var(--muted)}
.md a{text-decoration:underline}
`;

const DETAIL = `
/* Detail = Spalte UNTER der Kopfzeile (kein Overlay), 320 px, bis 60 % breit. */
.detail{width:var(--detail-breite);min-width:320px;max-width:60%;flex:0 0 auto;
  background:var(--card);border-left:1px solid var(--border);
  display:flex;flex-direction:column;min-height:0;overflow:hidden;position:relative}
.detail[hidden]{display:none}
.detail[data-vollbild="ja"]{width:100%;max-width:none;border-left:0}
.detail[data-vollbild="ja"] .detail-koerper{max-width:1280px;margin:0 auto;width:100%}
/* Zwei Zeilen statt drei Spalten: sechs Icon-Knoepfe neben dem Namen liessen
   im 320-px-Panel rund vier Zeichen uebrig ("acc..."), und ein Dateiname, der
   nach vier Zeichen endet, benennt nichts mehr. Jetzt traegt Zeile 1 Symbol und
   Namen ueber die volle Breite, Zeile 2 die Handlungen rechts. */
.detail-kopf{flex:0 0 auto;display:grid;grid-template-columns:auto minmax(0,1fr);
  align-items:start;gap:6px 10px;padding:12px 16px;border-bottom:1px solid var(--border)}
.detail-name{display:block;font-size:var(--text-sm);font-weight:500;
  overflow-wrap:anywhere;white-space:normal}
.detail-pfad{display:block;font-family:var(--mono);font-size:var(--text-xs);color:var(--muted-foreground);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.detail-titel{font-size:var(--text-2xl);font-weight:600;line-height:1.2;margin-bottom:8px}
.detail-aktionen{grid-column:1/-1;display:flex;align-items:center;justify-content:flex-end;gap:2px}
.detail-koerper{flex:1 1 auto;min-height:0;overflow:auto;padding:12px 16px;scrollbar-gutter:stable}
/* ZEITLEISTE statt Einzelzeile [Entwurf mockups/d-cc.html]: das Widget
   beantwortet "was lief, wann wieder" -- dafuer braucht es zwei Halte und eine
   Spur dazwischen, nicht eine Zeile. Der geplante Halt ist hohl gezeichnet:
   er ist noch nicht passiert. */
.logbuch{position:relative;padding-left:22px}
.logbuch::before{content:"";position:absolute;left:5px;top:6px;bottom:6px;width:1px;background:var(--border)}
.logbuch-halt{position:relative;padding:6px 0}
.logbuch-halt::before{content:"";position:absolute;left:-22px;top:9px;width:11px;height:11px;
  border-radius:99px;background:var(--primary);border:2px solid var(--card);
  box-shadow:0 0 0 1px var(--primary)}
.logbuch-halt[data-geplant="ja"]::before{background:var(--card);box-shadow:0 0 0 1px var(--muted-foreground)}
.logbuch-halt time{display:block;font-family:var(--mono);font-size:var(--text-nano);color:var(--muted-foreground)}
.logbuch-halt b{font-weight:600;font-size:var(--text-sm)}
.logbuch-halt span{color:var(--muted-foreground);font-size:var(--text-sm)}

/* Deine drei: abhakbar [01-product.md "die drei wichtigsten, abhakbar"] */
.drei-zeile input[type="checkbox"]{flex:0 0 auto;width:17px;height:17px;accent-color:var(--primary);margin:0}
.drei-kontext{margin-left:auto;font-family:var(--mono);font-size:var(--text-nano);
  color:var(--muted-foreground);white-space:nowrap}

/* Sitzung -> Projekt: der Chip sagt, WORAN die Sitzung arbeitet */
.sitzung-projekt{margin-left:auto;flex:0 0 auto;font-size:var(--text-nano);color:var(--foreground);
  background:var(--accent);border-radius:var(--radius-pille);padding:2px 9px;
  max-width:40%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* PROJEKTE ALS KARTEN [Entwurf mockups/d-projekte.html, Owner-Freigabe]:
   eine Liste mit Texten und Zahlen beantwortet die Frage "welches Projekt
   braucht mich" nicht. Die Karte zeigt Name, einen Satz, wer dort arbeitet und
   den Stand in einer Zeile. Feste Satzhoehe, damit die Karten buendig stehen --
   Owner-Grundregel 27.08.: nichts liegt schief oder ragt heraus. */
/* stretch (Vorgabe) statt start: alle Karten einer Reihe sind gleich hoch --
   sonst steht die Standzeile jeder Karte auf einer anderen Linie. */
.projekt-netz{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px}
.projekt-karte{display:flex;flex-direction:column;gap:8px;width:100%;text-align:left;
  background:var(--card);border:1px solid var(--border);border-radius:var(--radius);
  padding:14px 16px;transition:border-color var(--dauer)}
.projekt-karte:hover{border-color:var(--ring)}
.projekt-karte[aria-selected="true"]{border-color:var(--ring)}
.projekt-name{font-size:var(--text-sm);font-weight:600;overflow-wrap:anywhere}
/* Genau zwei Zeilen -- laenger wird geklemmt, kuerzer haelt die Hoehe. */
.projekt-satz{font-size:var(--text-xs);color:var(--muted-foreground);
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;
  min-height:2.8em;line-height:1.4}
.projekt-sitzungen{display:flex;gap:6px;flex-wrap:wrap;min-height:22px}
.projekt-schip{display:inline-flex;align-items:center;gap:6px;font-size:var(--text-nano);
  color:var(--foreground);background:var(--accent);border-radius:var(--radius-pille);
  padding:2px 9px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.projekt-schip::before{content:"";flex:0 0 auto;width:6px;height:6px;border-radius:99px;
  background:var(--status-ok)}
.projekt-stand{margin-top:auto;display:flex;align-items:center;gap:8px;font-size:var(--text-nano);
  color:var(--muted-foreground);font-family:var(--mono)}
.projekt-punkt{flex:0 0 auto;width:8px;height:8px;border-radius:99px;background:var(--status-ok)}
.projekt-punkt[data-luecke="ja"]{background:var(--status-hinweis)}
.projekt-balken{flex:1 1 auto;min-width:40px;height:5px;border-radius:99px;
  background:var(--accent);overflow:hidden}
.projekt-balken > i{display:block;height:100%;background:var(--status-ok)}

/* PropertySection + PropertyRow: Label 96 px muted links, Wert rechts. */
.eigenschaft-abschnitt{border-top:1px solid var(--border);padding:10px 0}
.eigenschaft-abschnitt:first-child{border-top:0}
/* Kein Unicode-Dreieck als Aufklapp-Zeichen [ui-standard Punkt 5]: der native
   Marker der Browser ist ein gefuelltes Schriftzeichen, waehrend die ganze
   Oberflaeche Lucide-SVGs fuehrt. Statt dessen ein eigenes Winkel-Zeichen aus
   zwei Strichen, das der Aufklappzustand dreht. */
.eigenschaft-abschnitt > summary{font-size:var(--text-xs);font-weight:600;text-transform:uppercase;
  letter-spacing:.05em;color:var(--muted-foreground);cursor:pointer;padding:2px 0;
  list-style:none;display:flex;align-items:center;gap:6px}
.eigenschaft-abschnitt > summary::-webkit-details-marker{display:none}
.eigenschaft-abschnitt > summary::before{content:"";flex:0 0 auto;width:6px;height:6px;
  border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;
  transform:rotate(-45deg);transition:transform .12s ease}
.eigenschaft-abschnitt[open] > summary::before{transform:rotate(45deg)}
.eigenschaft-zeile{display:flex;gap:12px;padding:4px 0;font-size:var(--text-xs)}
.eigenschaft-label{flex:0 1 auto;min-width:var(--label-breite);max-width:60%;
  color:var(--muted-foreground);overflow-wrap:anywhere}
.eigenschaft-wert{flex:1 1 auto;min-width:0;overflow-wrap:anywhere}
.eigenschaft-wert .pfad,.eigenschaft-wert .zahl,.eigenschaft-wert .zeit{font-family:var(--mono)}
.eigenschaft-pille{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--border);
  border-radius:var(--radius-pille);padding:0 8px;font-size:var(--text-nano);
  text-transform:uppercase;letter-spacing:.06em;color:var(--muted-foreground)}
.beschreibung-quelle{font-size:var(--text-nano);color:var(--muted-foreground);margin-top:4px}
/* IssueRelatedWorkPanel: Referenz-Pille + Art-Badge + Titel. */
.verknuepft-zeile{display:flex;align-items:center;gap:8px;padding:5px 0;font-size:var(--text-xs)}
.verknuepft-pille{font-family:var(--mono);border:1px solid var(--border);border-radius:var(--radius-sm);
  padding:0 5px;color:var(--foreground);flex:0 0 auto}
.verknuepft-art{border:1px solid var(--border);border-radius:var(--radius-sm);padding:0 5px;
  background:color-mix(in srgb,var(--muted) 40%,transparent);color:var(--muted-foreground);flex:0 0 auto}
.verknuepft-titel{color:var(--muted-foreground);min-width:0;overflow:hidden;
  text-overflow:ellipsis;white-space:nowrap}
/* ResizableHandle: 8 px Trefferflaeche, 1 px Linie, Ring beim Zeigen. */
.griff{position:absolute;top:0;left:-4px;width:8px;height:100%;cursor:col-resize;z-index:2;
  display:grid;place-items:center;touch-action:none}
.griff::before{content:"";width:1px;height:100%;background:var(--border)}
.griff:hover::before,.griff:focus-visible::before,.griff[data-zieht="ja"]::before{background:var(--ring);width:2px}
.baum-flaeche .griff{position:relative;left:0;height:auto}
`;

// AUFTRAG -- der Komposer im Control Center (Ziel, Projekt, Paket, Text,
// Senden, Verlauf). Ausgelagert am 26.08.2026: styles.js riss zum dritten
// Mal die 800-Zeilen-Hausgrenze. Der Block ist in sich geschlossen -- er
// beschreibt EIN Formular und beruehrt sonst nichts.

const AUFTRAG = `
/* Auftrag: Ziel, Text und Senden in EINER Zeile -- ein Formular, kein Block. */
.auftrag-zeile{display:flex;align-items:flex-start;gap:8px;flex-wrap:wrap}
.auftrag-zeile select{height:32px;padding:0 8px;border:1px solid var(--input);border-radius:var(--radius-md);
  background:var(--card);color:var(--foreground);font:inherit;font-size:var(--text-compact)}
/* Feste Hoehe statt flex-Streckung: das Feld wuchs sonst auf die ganze
   Restseite, weil .auftrag-zeile es dehnte [Abnahme 26.08.2026]. */
.auftrag-zeile textarea{flex:1 1 260px;height:64px;min-height:44px;max-height:200px;
  padding:8px 10px;border:1px solid var(--input);
  border-radius:var(--radius-md);background:var(--card);color:var(--foreground);
  font:inherit;font-size:var(--text-compact);resize:vertical}
.auftrag-feld-breit{flex:1 1 260px}
/* Der Senden-Knopf steht UNTER der Textflaeche, an ihrer rechten Kante
   [Kritik-Runde 2, Problem 15] -- neben dem Formular schwebend gehoerte er
   optisch zu nichts und riss eine dritte rechte Kante auf. Der Verlauf darunter
   macht nachlesbar, was rausging [Problem 4]. */
.auftrag-fuss{display:flex;justify-content:flex-end;margin-top:8px}
.auftrag-verlauf{margin-top:14px;padding-top:10px;border-top:1px solid var(--border)}
.auftrag-verlauf-kopf{font-size:var(--text-micro);font-weight:600;
  color:var(--muted-foreground);margin:0 0 4px}
.auftrag-verlauf-zeile{font-size:var(--text-xs);color:var(--muted-foreground);
  margin:0;padding:3px 0;display:flex;gap:8px}
.auftrag-verlauf-zeile time{flex:0 0 auto;font-variant-numeric:tabular-nums}
/* Rohausgabe eines Selbsttests: lesbar, aber untergeordnet -- das Urteil steht
   darueber [Kritik-Runde 2, Problem 2]. Eigener Scrollbereich, damit eine lange
   Ausgabe die Seite nicht waagerecht aufschiebt. */
.probe-ausgabe{max-height:180px;overflow:auto;margin:0 0 12px;padding:10px 12px;
  background:var(--muted);border:1px solid var(--border);border-radius:var(--radius-md);
  font-family:var(--mono);font-size:var(--text-xs);line-height:1.5;white-space:pre-wrap;
  color:var(--muted-foreground)}
/* Komposer-Felder: jedes Auswahlfeld traegt ein SICHTBARES Label ueber sich
   (Regel "Form controls need <label>"), nicht nur ein aria-label. */
.auftrag-feld{display:flex;flex-direction:column;gap:3px;min-width:0}
/* Das Textfeld darf NICHT von der Flex-Spalte gestreckt werden -- sonst
   waechst es bis zur max-height statt auf seiner Hoehe zu bleiben (gemessen
   26.08.2026: 200 px statt 64) [Abnahme-Befund]. */
.auftrag-feld > textarea{flex:0 0 auto}
.auftrag-feld-breit{flex:1 1 260px}
.auftrag-feld-label{font-size:var(--text-micro);color:var(--muted-foreground)}
.auftrag-feld select{max-width:22rem}
`;

module.exports = { BOARD_UND_PALETTE, SCHMAL, CONTROL_CENTER, DATEIANSICHT, DETAIL, AUFTRAG };
