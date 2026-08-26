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
.widget-link{font-size:var(--text-micro);font-weight:500;color:var(--primary);
  background:none;border:0;padding:2px 0;text-decoration:underline;text-underline-offset:2px}
.widget-link:hover{color:var(--foreground)}
.check-reihe{display:flex;gap:10px;align-items:center;width:100%;text-align:left;
  padding:8px 0;font-size:var(--text-sm);font-weight:500;
  border-radius:var(--radius-md);transition:background var(--dauer)}
.check-reihe + .check-reihe{border-top:1px solid var(--border)}
/* Klickbar sieht anders aus als still -- vorher waren beide identisch und der
   Nutzer musste raten, welche Zeile reagiert [Befund 26.08.2026]. */
.check-reihe:hover{background:color-mix(in srgb,var(--accent) 45%,transparent)}
.check-reihe-still:hover{background:transparent}
.check-reihe-still .zeilen-pfeil{display:none}
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
   das sah aus wie eine Checkbox und navigierte weg [Befund 26.08.2026]. */
.achtung-widget .widget-rumpf{border-color:color-mix(in srgb,var(--status-hinweis) 45%,var(--border));
  border-left:3px solid var(--status-hinweis);
  background:color-mix(in srgb,var(--status-hinweis) 8%,var(--card))}
.drei-zeile{display:flex;gap:11px;align-items:center;width:100%;text-align:left;
  padding:8px 0;font-size:var(--text-sm);font-weight:500;
  border-radius:var(--radius-md);transition:background var(--dauer)}
.drei-zeile + .drei-zeile{border-top:1px solid var(--border)}
.drei-zeile:hover{background:color-mix(in srgb,var(--accent) 45%,transparent)}
.drei-glyphe{flex:0 0 16px;width:16px;height:16px;display:grid;place-items:center}
.drei-text{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* Sitzung: "arbeitet gerade" ist ein Laufzustand, kein Pruefergebnis --
   deshalb eigenes Wort statt des Status-Chips [Befund 26.08.2026]. */
.sitzung-laeuft{flex:0 0 auto;font-size:var(--text-xs);color:var(--status-ok);font-weight:500}`;

module.exports = { BOARD_UND_PALETTE, SCHMAL, CONTROL_CENTER };
