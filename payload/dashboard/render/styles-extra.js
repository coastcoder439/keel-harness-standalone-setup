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
}
@media (min-width:768px) and (max-width:1023px){
  .detail{width:var(--detail-breite);max-width:var(--detail-breite)}
}
`;


module.exports = { BOARD_UND_PALETTE, SCHMAL };
