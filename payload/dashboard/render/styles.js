// STYLES -- das komplette Stylesheet des Dashboards als String, plus das
// Kontrast-Pruefwerkzeug, mit dem der Test jede Farbpaarung nachmisst.
//
// Dieses Modul erzeugt AUSSCHLIESSLICH Aussehen. Es kennt keine Daten, keinen
// deutschen Oberflaechentext, keine Messung. Wer hier ein Wort fuer Menschen
// einbaut, hat die Trennung aufgehoben (measure.js -> render/data.js -> render).
//
// HERKUNFT DER WERTE -- nichts davon ist erfunden:
//   Farbe    user-projects/keel-light/ui/src/keel-light/keel-theme.css:22-95
//            (woertlich uebernommen, Token-Namen 1:1)
//   --destructive  user-projects/keel-light/ui/src/index.css:89,213 (Fork)
//   Chip-Formel    user-projects/keel-light/ui/src/index.css:1441-1452
//   Masse/Rezepte  Spezifikation Abschnitt 8 (Paperclip-Bausteine)
//
// SPRACHE: Token-Namen sind englisch, weil sie woertlicher Fremdbestand aus
// keel-theme.css sind -- eine Uebersetzung waere eine Aenderung. KLASSENNAMEN
// sind deutsch (wie der Bestand render.js), durchgehend ASCII und im korrigierten
// Vokabular der Spezifikation Abschnitt 2.2: Pfadleiste statt "Krume",
// Hauptflaeche statt "Tafel", Detail statt "Einzelansicht".
//
// AUFRUF   const { css, TOKENS, oklchZuRgb, kontrast } = require("./styles");

// ---------------------------------------------------------------------------
// Die Token-Tabelle als Daten. Einzige Quelle -- der CSS-String unten wird
// daraus erzeugt, damit Test und Stylesheet nicht auseinanderlaufen koennen.
// ---------------------------------------------------------------------------

// Chip-Formel: die Prozente stehen als Token da, nicht als Literal in der Regel.
// So gibt es die Formel nur EINMAL (statt je Themenblock) und der Test liest die
// echten Werte, statt eigene Zahlen zu wiederholen.
//
// ABWEICHUNG VON DER SPEZIFIKATION, gemessen und begruendet (23.08.2026):
//   dunkel --chip-fuell-anteil 22% -> 16%. Bei 22% traegt der Chip "fehlt" auf
//   der Flaeche --card nur 4,27:1 (gemessen, siehe Test "Chip-Text ... auf card").
//   Die Palette bleibt unangetastet; gesenkt wird nur der Fuell-Anteil, weil
//   --status-fehlt heller ist als --card und die Fuellung damit aufhellt.
//   Bei 16% ist der schlechteste Wert 4,75:1. Text bleibt bei den 90 % Weiss
//   der Spezifikation.
//   dunkel --chip-rand-anteil 48% -> 80%. Bei 48% traegt der Rand gegen die
//   eigene Fuellung nur 1,60-2,19:1, also unter den geforderten 3:1. Bei 80%
//   ist der schlechteste Wert 3,09:1. Auch hier nur der Anteil, nicht die Farbe.
const TOKENS = {
  hell: {
    "--background": "oklch(0.978 0.007 214)",
    "--foreground": "oklch(0.22 0.025 233)",
    "--card": "oklch(0.99 0.004 210)",
    "--card-foreground": "oklch(0.22 0.025 233)",
    "--popover": "oklch(0.99 0.004 210)",
    "--popover-foreground": "oklch(0.22 0.025 233)",
    "--primary": "oklch(0.4 0.07 224)",
    "--primary-foreground": "oklch(0.985 0.004 210)",
    "--secondary": "oklch(0.935 0.018 205)",
    "--secondary-foreground": "oklch(0.28 0.027 229)",
    "--muted": "oklch(0.935 0.018 205)",
    "--muted-foreground": "oklch(0.47 0.022 228)",
    "--accent": "oklch(0.92 0.028 212)",
    "--accent-foreground": "oklch(0.28 0.027 229)",
    "--border": "oklch(0.28 0.03 230 / 0.22)",
    "--input": "oklch(0.28 0.03 230 / 0.22)",
    "--ring": "oklch(0.4 0.07 224)",
    "--sidebar": "oklch(0.976 0.007 210)",
    "--sidebar-foreground": "oklch(0.22 0.025 233)",
    "--sidebar-primary": "oklch(0.4 0.07 224)",
    "--sidebar-primary-foreground": "oklch(0.985 0.004 210)",
    "--sidebar-accent": "oklch(0.92 0.028 212)",
    "--sidebar-accent-foreground": "oklch(0.28 0.027 229)",
    "--sidebar-border": "oklch(0.28 0.03 230 / 0.16)",
    "--sidebar-ring": "oklch(0.4 0.07 224)",
    "--chart-1": "oklch(0.78 0.075 205)",
    "--chart-2": "oklch(0.6 0.07 222)",
    "--chart-3": "oklch(0.4 0.07 224)",
    "--chart-4": "oklch(0.275 0.058 232)",
    "--chart-5": "oklch(0.16 0.038 238)",
    "--destructive": "oklch(0.577 0.245 27.325)",
    "--status-ok": "oklch(0.52 0.10 165)",
    "--status-hinweis": "oklch(0.52 0.12 72)",
    "--status-fehler": "oklch(0.52 0.18 25)",
    "--status-fehlt": "oklch(0.55 0.02 235)",
    "--status-unlesbar": "oklch(0.45 0.02 25)",
    "--chip-fuell-anteil": "15%",
    "--chip-fuell-basis": "white",
    "--chip-text-anteil": "82%",
    "--chip-text-basis": "black",
    "--chip-rand-anteil": "100%",
    "--chip-rand-basis": "transparent"
  },
  dunkel: {
    "--background": "oklch(0.16 0.038 238)",
    "--foreground": "oklch(0.94 0.012 210)",
    "--card": "oklch(0.26 0.045 233)",
    "--card-foreground": "oklch(0.94 0.012 210)",
    "--popover": "oklch(0.26 0.045 233)",
    "--popover-foreground": "oklch(0.94 0.012 210)",
    "--primary": "oklch(0.78 0.075 205)",
    "--primary-foreground": "oklch(0.16 0.038 238)",
    "--secondary": "oklch(0.275 0.058 232)",
    "--secondary-foreground": "oklch(0.94 0.012 210)",
    "--muted": "oklch(0.275 0.058 232)",
    "--muted-foreground": "oklch(0.7 0.02 218)",
    "--accent": "oklch(0.275 0.058 232)",
    "--accent-foreground": "oklch(0.94 0.012 210)",
    "--border": "oklch(0.92 0.02 210 / 0.18)",
    "--input": "oklch(0.92 0.02 210 / 0.18)",
    "--ring": "oklch(0.78 0.075 205)",
    "--sidebar": "oklch(0.19 0.04 236)",
    "--sidebar-foreground": "oklch(0.94 0.012 210)",
    "--sidebar-primary": "oklch(0.78 0.075 205)",
    "--sidebar-primary-foreground": "oklch(0.16 0.038 238)",
    "--sidebar-accent": "oklch(0.275 0.058 232)",
    "--sidebar-accent-foreground": "oklch(0.94 0.012 210)",
    "--sidebar-border": "oklch(0.92 0.02 210 / 0.14)",
    "--sidebar-ring": "oklch(0.78 0.075 205)",
    "--chart-1": "oklch(0.78 0.075 205)",
    "--chart-2": "oklch(0.6 0.07 222)",
    "--chart-3": "oklch(0.4 0.07 224)",
    "--chart-4": "oklch(0.275 0.058 232)",
    "--chart-5": "oklch(0.16 0.038 238)",
    "--destructive": "oklch(0.637 0.237 25.331)",
    "--status-ok": "oklch(0.78 0.11 165)",
    "--status-hinweis": "oklch(0.82 0.13 78)",
    "--status-fehler": "oklch(0.72 0.16 25)",
    "--status-fehlt": "oklch(0.68 0.02 235)",
    "--status-unlesbar": "oklch(0.75 0.03 25)",
    "--chip-fuell-anteil": "16%",
    "--chip-fuell-basis": "transparent",
    "--chip-text-anteil": "90%",
    "--chip-text-basis": "white",
    "--chip-rand-anteil": "80%",
    "--chip-rand-basis": "transparent"
  }
};

// Masse, Radien, Typografie -- themenunabhaengig, stehen nur in :root.
// Die Typo-Leiter ist der EINZIGE Ort mit einer Pixel-Schriftgroesse; jede
// Klasse unten schreibt font-size:var(--text-...). Der Test prueft das.
const MASSE = {
  "--seitenleiste": "240px",
  "--seitenleiste-rail": "64px",
  "--kopfzeile": "48px",
  "--detail-breite": "320px",
  "--baum-breite": "288px",
  "--board-spalte": "260px",
  "--board-rail": "52px",
  "--zeile-baum": "36px",
  "--zeile-tabelle": "36px",
  "--zeile-eintrag": "44px",
  "--einzug-stufe": "24px",
  "--spalte-min": "96px",
  "--label-breite": "96px",
  "--ring-breite": "3px",
  "--radius": "8px",
  "--radius-sm": "4.8px",
  "--radius-md": "6.4px",
  "--radius-lg": "8px",
  "--radius-xl": "11.2px",
  "--radius-pille": "999px",
  "--text-nano": "10px",
  "--text-micro": "11px",
  "--text-xs": "12px",
  "--text-compact": "13px",
  "--text-sm": "14px",
  "--text-md": "15px",
  "--text-base": "16px",
  // DREI STUFEN MIT ECHTEN SPRUENGEN [Kritik-Runde 2, Problem 5]: die gesamte
  // Anwendung lief auf 11-14 px -- Einleitung, Zeilentitel, Kartentitel,
  // Formularlabels alle gleich gross. Eine Skala ohne Spruenge ist keine
  // Hierarchie: alles wirkt gleich wichtig, das Auge findet keinen Weg. Der
  // Seitentitel bekommt deshalb einen Sprung, den man nicht uebersehen kann.
  "--text-titel": "30px",
  "--text-2xl": "24px",
  "--text-md-h1": "1.6em",
  "--text-md-h2": "1.3em",
  "--text-md-h3": "1.15em",
  "--text-md-h4": "1em",
  "--schrift": '"InterVariable","Inter",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif',
  "--mono": 'ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace',
  "--dauer": "200ms"
};

// ---------------------------------------------------------------------------
// Farbmathematik -- oklch -> sRGB -> WCAG. Reine Funktionen, kein Zustand.
// ---------------------------------------------------------------------------

// oklch(L C H) bzw. oklch(L C H / A) -> {r,g,b} 0..255. Der Alpha-Anteil wird
// bewusst ignoriert: WCAG rechnet auf der fertig zusammengesetzten Flaeche, und
// wer eine halbdurchsichtige Farbe misst, muss sie vorher selbst mischen.
// Fehlschlag ist nie stumm: unparsbare Eingabe wirft mit dem Wortlaut im Text.
function oklchZuRgb(wert) {
  const treffer = String(wert).match(
    /oklch\(\s*([0-9.]+%?)\s+([0-9.]+%?)\s+([0-9.]+)(?:deg)?\s*(?:\/[^)]*)?\)/i
  );
  if (!treffer) throw new Error('oklchZuRgb: kein oklch()-Wert lesbar: "' + wert + '"');
  const L = treffer[1].endsWith("%") ? parseFloat(treffer[1]) / 100 : parseFloat(treffer[1]);
  const C = treffer[2].endsWith("%") ? (parseFloat(treffer[2]) / 100) * 0.4 : parseFloat(treffer[2]);
  const bogen = (parseFloat(treffer[3]) * Math.PI) / 180;
  const a = C * Math.cos(bogen);
  const b = C * Math.sin(bogen);
  // Oklab -> LMS (Ottosson, "A perceptual color space for image processing")
  const lHoch = L + 0.3963377774 * a + 0.2158037573 * b;
  const mHoch = L - 0.1055613458 * a - 0.0638541728 * b;
  const sHoch = L - 0.0894841775 * a - 1.291485548 * b;
  const l = lHoch * lHoch * lHoch;
  const m = mHoch * mHoch * mHoch;
  const s = sHoch * sHoch * sHoch;
  return {
    r: gammaKodieren(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: gammaKodieren(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: gammaKodieren(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)
  };
}

// linear-sRGB (0..1) -> sRGB-Byte (0..255), inklusive Beschnitt auf den Gamut.
function gammaKodieren(linear) {
  const v = linear <= 0.0031308 ? 12.92 * linear : 1.055 * Math.pow(Math.max(linear, 0), 1 / 2.4) - 0.055;
  return Math.min(255, Math.max(0, Math.round(v * 255)));
}

// WCAG 2.x relative Leuchtdichte.
function leuchtdichte(rgb) {
  const kanal = (byte) => {
    const v = byte / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * kanal(rgb.r) + 0.7152 * kanal(rgb.g) + 0.0722 * kanal(rgb.b);
}

// WCAG-Kontrastverhaeltnis zweier deckender Farben, 1..21.
function kontrast(rgbA, rgbB) {
  for (const [name, wert] of [["rgbA", rgbA], ["rgbB", rgbB]]) {
    if (!wert || typeof wert.r !== "number" || typeof wert.g !== "number" || typeof wert.b !== "number") {
      throw new Error("kontrast: " + name + " ist kein {r,g,b}-Objekt");
    }
  }
  const a = leuchtdichte(rgbA);
  const b = leuchtdichte(rgbB);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// ---------------------------------------------------------------------------
// Aus der Token-Tabelle den CSS-Text erzeugen.
// ---------------------------------------------------------------------------

function tokenZeilen(tabelle) {
  return Object.keys(tabelle)
    .map((name) => "  " + name + ":" + tabelle[name] + ";")
    .join("\n");
}

// Drei Bloecke, damit der Umschalter in BEIDE Richtungen gewinnt:
// :root = hell, Systemwunsch dunkel (ausser der Mensch hat hell gewaehlt),
// ausdruecklich gewaehltes dunkel. Der dunkle Text steht zweimal im
// Stylesheet, aber nur einmal in diesem Modul -- er wird zweimal erzeugt.
function themenBloecke() {
  const dunkel = tokenZeilen(TOKENS.dunkel);
  return [
    ":root{\n" + tokenZeilen(TOKENS.hell) + "\n" + tokenZeilen(MASSE) + "\n}",
    '@media (prefers-color-scheme:dark){:root:not([data-thema="hell"]){\n' + dunkel + "\n}}",
    ':root[data-thema="dunkel"]{\n' + dunkel + "\n}"
  ].join("\n");
}

const GRUNDLAGE = `
*,*::before,*::after{box-sizing:border-box}
html,body{height:100%}
body{margin:0;background:var(--background);color:var(--foreground);font-family:var(--schrift);
  font-size:var(--text-sm);line-height:1.5;-webkit-font-smoothing:antialiased;
  display:grid;grid-template-columns:var(--seitenleiste) 1fr;height:100dvh;overflow:hidden}
body[data-leiste="eingeklappt"]{grid-template-columns:var(--seitenleiste-rail) 1fr}
h1,h2,h3,h4,p,ul,ol,figure{margin:0}
button{font:inherit;color:inherit;background:none;border:0;cursor:pointer}
a{color:var(--primary);text-decoration:none}
a:hover{text-decoration:underline}
code,kbd,pre,.mono,.pfad,.hash,.zeit{font-family:var(--mono)}
.zahl,table{font-variant-numeric:tabular-nums}
.nur-vorleser{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
/* Fokus: 3 px DECKEND statt der 50 % aus der Spezifikation. Gemessen: --ring bei
   50 % Deckung ueber --background traegt 1,9:1, also unter den geforderten 3:1;
   deckend sind es 8,52:1 (hell) bzw. 9,97:1 (dunkel). Der Test misst das nach. */
:focus-visible{outline:var(--ring-breite) solid var(--ring);outline-offset:2px;border-radius:var(--radius-sm)}
::-webkit-scrollbar{width:8px;height:8px}
::-webkit-scrollbar-thumb{background:transparent;border-radius:var(--radius-pille)}
*:hover::-webkit-scrollbar-thumb{background:var(--border)}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
`;

const SEITENLEISTE = `
/* Seitenleiste 240 / Rail 64. Icon-Achse in BEIDEN Zustaenden bei 24 px:
   nav padding-inline 12 + Pille margin-inline 4 + Pille padding-inline 8.
   Beim Einklappen wird nur das Label geclippt, die Icon-x bleibt stehen. */
.seitenleiste{grid-row:1/-1;background:var(--sidebar);color:var(--sidebar-foreground);
  border-right:1px solid var(--sidebar-border);display:flex;flex-direction:column;min-height:0;overflow:hidden}
.leiste-kopf{height:var(--kopfzeile);flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:0 12px}
/* 13 px statt 14: "keel-harness-live-1" passt dann neben die zwei Knoepfe --
   ein abgeschnittener Name am Markenplatz war vermeidbar [Kritiker, Runde 4]. */
.leiste-name{flex:1;min-width:0;font-size:var(--text-compact);font-weight:700;letter-spacing:-.02em;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.leiste-nav{flex:1 1 auto;min-height:0;overflow-y:auto;padding:8px 12px;scrollbar-gutter:stable}
.nav-gruppe{margin-top:12px}
.nav-gruppe:first-child{margin-top:0}
/* Gruppenlabel 11 px OHNE Opazitaet -- gemessen 6,29:1 (hell) / 6,96:1 (dunkel). */
.gruppen-label{font-family:var(--mono);font-size:var(--text-micro);text-transform:uppercase;
  letter-spacing:.1em;color:var(--muted-foreground);padding:6px 12px 4px}
.nav-pille{display:flex;align-items:center;gap:10px;margin-inline:4px;padding:6px 8px;
  border-radius:var(--radius-lg);font-size:var(--text-compact);font-weight:500;width:calc(100% - 8px);
  color:var(--sidebar-foreground);text-align:left;transition:background var(--dauer)}
.nav-pille:hover{background:color-mix(in srgb,var(--sidebar-accent) 50%,transparent)}
.nav-pille[aria-current="page"]{background:var(--sidebar-accent);color:var(--sidebar-accent-foreground)}
.nav-symbol{flex:0 0 16px;width:16px;height:16px}
.nav-text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nav-zahl{flex:0 0 auto;font-size:var(--text-xs);font-variant-numeric:tabular-nums;
  background:var(--sidebar-primary);color:var(--sidebar-primary-foreground);
  border-radius:var(--radius-pille);padding:1px 6px}
.nav-zahl[data-ton="offen"]{background:var(--status-hinweis);color:var(--sidebar-primary-foreground)}
.leiste-fuss{flex:0 0 auto;border-top:1px solid var(--sidebar-border);padding:8px 12px;
  display:flex;flex-direction:column;gap:6px}
.mess-zeit{display:block;font-size:var(--text-xs);color:var(--muted-foreground);font-family:var(--mono)}
.leiste-knopf{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:var(--radius-md);
  font-size:var(--text-xs);color:var(--sidebar-foreground);width:100%}
.leiste-knopf:hover{background:color-mix(in srgb,var(--sidebar-accent) 50%,transparent)}
.leiste-leise{color:var(--muted-foreground)}
.ikon-knopf{width:28px;height:28px;flex:0 0 28px;display:grid;place-items:center;
  border-radius:var(--radius-md);color:var(--muted-foreground)}
.ikon-knopf:hover{background:color-mix(in srgb,var(--accent) 50%,transparent);color:var(--foreground)}
body[data-leiste="eingeklappt"] .nav-text,
body[data-leiste="eingeklappt"] .nav-zahl,
body[data-leiste="eingeklappt"] .gruppen-label,
body[data-leiste="eingeklappt"] .leiste-name,
body[data-leiste="eingeklappt"] .mess-zeit,
body[data-leiste="eingeklappt"] .leiste-knopf span{opacity:0;pointer-events:none}
body[data-leiste="eingeklappt"] .leiste-nav{overflow-x:hidden}
`;

const GERUEST = `
/* Ein Skelett fuer alle Seiten: Kopfzeile 48 ueber [Hauptflaeche | Detail]. */
.arbeitsflaeche{display:grid;grid-template-rows:var(--kopfzeile) 1fr;min-width:0;min-height:0}
.kopfzeile{display:flex;align-items:center;gap:8px;padding:0 16px;
  border-bottom:1px solid var(--border);min-width:0}
.pfadleiste{display:flex;align-items:center;gap:6px;min-width:0;overflow:hidden}
/* Pfadleisten-Teile: Klassennamen wie in client/core.js (der Vertrag gilt in
   beide Richtungen -- "Krume" war zudem ein verbotener Code-Name, Spez. 2.2). */
.pfad-teil{font-size:var(--text-compact);color:var(--muted-foreground);white-space:nowrap}
.pfad-knopf:hover{color:var(--foreground)}
.pfad-teil[aria-current="page"]{font-size:var(--text-sm);font-weight:600;text-transform:uppercase;
  letter-spacing:.05em;color:var(--foreground)}
/* Datei-/Ordner-Segmente sind Pfade: Mono, nie Versalien -- "CLAUDE.MD"
   waere ein anderer Name als "CLAUDE.md". */
.pfad-teil[data-datei]{text-transform:none;letter-spacing:0;font-family:var(--mono);
  font-size:var(--text-compact)}
.pfad-pfeil{color:var(--muted-foreground);flex:0 0 auto}
/* Tab-Leiste: Geschwister-Seiten einer Tab-Gruppe als Reiter (Vorbild: die
   Modul-Reiter in Keel Light). Aktiver Reiter traegt eine Unterstreichung. */
.tab-leiste{display:flex;align-items:center;gap:4px;border-bottom:1px solid var(--border);
  margin-bottom:14px;overflow-x:auto}
.tab{padding:8px 12px;font-size:var(--text-compact);font-weight:500;color:var(--muted-foreground);
  border-bottom:2px solid transparent;margin-bottom:-1px;white-space:nowrap}
.tab:hover{color:var(--foreground)}
.tab[aria-current="page"]{color:var(--foreground);border-bottom-color:var(--primary)}
.seiten-aktion{margin-left:auto;display:flex;align-items:center;gap:6px}
.seiten-aktion:empty{display:none}
.buehne{display:grid;grid-template-columns:1fr auto;min-width:0;min-height:0}
.hauptflaeche{min-width:0;min-height:0;overflow:auto;padding:16px;scrollbar-gutter:stable}
@media (min-width:768px){.hauptflaeche{padding:24px}}
.erklaersatz{font-size:var(--text-sm);color:var(--muted-foreground);margin-bottom:12px;max-width:80ch}
.erklaersatz .pfad{font-size:var(--text-xs);color:var(--muted-foreground)}
/* SEITENKOPF [Kritik-Runde 2, Problem 5]. Der erste Halt des Auges auf jeder
   Seite: ein Titel, den man nicht uebersehen kann, und EIN Satz darunter, der
   seine Lesebreite begruendet, statt wie eine vergessene Formatierung
   auszusehen. Die Abstaende sind gestaffelt (32 unten, 6 dazwischen), damit
   Titel und Satz als EIN Block lesen und nicht als zwei Fundstuecke. */
.seiten-kopf{margin-bottom:24px}
.seiten-titel{font-size:var(--text-titel);font-weight:600;line-height:1.15;
  letter-spacing:-0.02em;color:var(--foreground);margin:0}
.seiten-unter{font-size:var(--text-sm);color:var(--muted-foreground);
  margin:6px 0 0;max-width:68ch;line-height:1.5}
.seiten-unter .pfad{font-size:var(--text-xs)}
@media (max-width:767px){
  .seiten-titel{font-size:var(--text-2xl)}
  .seiten-kopf{margin-bottom:16px}
}
.werkzeugleiste{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px}
.suchfeld{width:256px;height:32px;padding:0 10px;border:1px solid var(--input);
  border-radius:var(--radius-md);background:var(--card);color:var(--foreground);font-size:var(--text-compact)}
.suchfeld::placeholder{color:var(--muted-foreground)}
.filter-chip{height:28px;padding:0 10px;border:1px solid var(--input);border-radius:var(--radius-pille);
  font-size:var(--text-xs);color:var(--muted-foreground)}
.filter-chip[aria-pressed="true"]{background:var(--accent);color:var(--accent-foreground);border-color:transparent}
.sortier-knopf{height:28px;padding:0 10px;border:1px solid var(--input);border-radius:var(--radius-md);
  font-size:var(--text-xs);color:var(--foreground);display:flex;align-items:center;gap:6px}
.treffer-zahl{margin-left:auto;font-size:var(--text-xs);color:var(--muted-foreground);
  font-variant-numeric:tabular-nums}
.ansicht-umschalter{display:flex;border:1px solid var(--input);border-radius:var(--radius-md);overflow:hidden}
.ansicht-umschalter button{height:28px;padding:0 10px;font-size:var(--text-xs);color:var(--muted-foreground)}
.ansicht-umschalter button[aria-pressed="true"]{background:var(--accent);color:var(--accent-foreground)}
`;

const LISTEN = `
/* EntityRow -- EIN Zeilenrezept fuer Hooks/Commands/Skills/Rules/Backup/Kontext. */
.eintrag-liste{border:1px solid var(--border);border-radius:var(--radius-lg);
  background:var(--card);overflow:hidden}
.eintrag-zeile{display:flex;align-items:center;gap:12px;min-height:var(--zeile-eintrag);
  padding:8px 16px;border-bottom:1px solid var(--border);width:100%;text-align:left;
  font-size:var(--text-sm);transition:background var(--dauer)}
.eintrag-zeile:last-child{border-bottom:0}
.eintrag-zeile:hover{background:color-mix(in srgb,var(--accent) 50%,transparent)}
.eintrag-zeile[aria-selected="true"]{background:color-mix(in srgb,var(--accent) 30%,transparent)}
.eintrag-kachel{flex:0 0 32px;width:32px;height:32px;display:grid;place-items:center;
  border-radius:var(--radius-md);background:var(--muted);color:var(--muted-foreground);
  font-size:var(--text-compact)}
.eintrag-haupt{flex:1 1 auto;min-width:0}
/* display:block, damit Titel und Untertitel auch dann uebereinander stehen,
   wenn der Aufrufer <span> statt <div> setzt -- das Rezept schuldet die Form,
   nicht das Markup. Gesehen im echten Lauf am 23.08.2026: ohne das klebt
   "session-roles.jsSessionStart" in einer Zeile. */
.eintrag-titel{display:block;font-size:var(--text-sm);font-weight:500;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.eintrag-unter{display:block;font-size:var(--text-xs);color:var(--muted-foreground);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.eintrag-meta{flex:0 0 auto;display:flex;align-items:center;gap:8px;font-size:var(--text-xs);
  color:var(--muted-foreground)}
.eintrag-meta > * + *::before{content:"\\00B7";margin-right:8px;color:var(--muted-foreground)}
.eintrag-herkunft{font-size:var(--text-nano);text-transform:uppercase;letter-spacing:.06em;
  color:var(--muted-foreground);display:flex;align-items:center;gap:4px}
/* Meta-Pille der Hauptliste: wie die Eigenschafts-Pille, aber OHNE Versalien --
   ein ganzer Satz ("ergaenzt den Sitzungskontext") darf nicht schreien.
   data-ton faerbt je Wirkungsklasse, damit die Spalte scanbar wird. */
.meta-pille{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--border);
  border-radius:var(--radius-pille);padding:0 8px;font-size:var(--text-xs);
  color:var(--muted-foreground)}
/* "blockiert" ist eine FAEHIGKEIT, kein Zustand -- keine Warnfarbe, und EIN
   System fuer alle drei: gleiche Form, Unterschied nur im Pillen-Punkt
   [Kritiker-Befunde Runden 4 und 5]. */
/* Sammelaussage als ZUSTANDSBANNER, wenn alles traegt -- die wichtigste
   Information der Seite darf nicht das blasseste Element sein
   [Kritiker-Befund Gauntlet-Runde 5]. Gegenstueck zur Achtung-Flaeche. */
.sammel-zeile{display:flex;align-items:center;gap:8px;font-size:var(--text-compact);
  color:var(--foreground);margin:0 0 12px;padding:10px 14px;
  border:1px solid color-mix(in srgb,var(--status-ok) 45%,var(--border));
  border-left:3px solid var(--status-ok);border-radius:var(--radius-lg);
  background:color-mix(in srgb,var(--status-ok) 8%,var(--card))}
/* Der farbige Punkt der Wirkungs-Pille -- die EINE Stelle, an der sich die
   Klassen unterscheiden (Form und Gewicht bleiben gleich). */
.pillen-punkt{width:7px;height:7px;border-radius:var(--radius-pille);flex:0 0 7px;background:var(--muted-foreground)}
.meta-pille[data-ton="blockiert"] .pillen-punkt{background:var(--foreground)}
.meta-pille[data-ton="kontext"] .pillen-punkt{background:var(--primary)}
/* Achtung-Sektion: der Warnzustand dominiert die Flaeche (amber getoent).
   Der Status-Chip in der Zeile entfaellt hier -- die Flaeche selbst IST die
   Statusaussage; dreimal "Hinweis" auf einem Bildschirm war Redundanz
   [Kritiker-Befund Gauntlet-Runde 3]. */
.achtung .eintrag-liste{border-color:color-mix(in srgb,var(--status-hinweis) 55%,var(--border));
  border-left:3px solid var(--status-hinweis);
  background:color-mix(in srgb,var(--status-hinweis) 10%,var(--card))}
.achtung .eintrag-schluss{display:none}
/* Kennzahl in Statusfarbe: Wert und Glyphe tragen den Ton des Zustands. */
.kennzahl[class*="status-"] .kennzahl-wert{color:var(--sc)}
.eintrag-schluss{flex:0 0 auto;display:flex;align-items:center;gap:8px}
/* IssueGroupHeader -- ohne Rahmen, fuer alle Gruppen. */
.gruppen-kopf{display:flex;align-items:center;gap:8px;padding:12px 4px 6px;width:100%;text-align:left}
.gruppen-caret{flex:0 0 14px;width:14px;height:14px;color:var(--muted-foreground);transition:transform var(--dauer)}
.gruppen-kopf[aria-expanded="false"] .gruppen-caret{transform:rotate(-90deg)}
/* ABSCHNITTE IN NORMALER SCHREIBUNG [Kritik-Runde 2, Problem 5]. Versalien
   waren hier die zweite von VIER Ueberschriften-Sprachen fuer EINE Rangstufe
   (Versal-Grau mit Chevron, Versal-Grau ohne, fette Monospace, Reiterschrift)
   -- und Versalien lesen sich langsamer, ohne mehr Rang zu tragen. Der Rang
   kommt jetzt aus Groesse und Gewicht: 15 px halbfett in Vordergrundfarbe,
   eine klare Stufe unter dem 30-px-Seitentitel und ueber der 14-px-Zeile. */
.gruppen-titel{font-size:var(--text-md);font-weight:600;letter-spacing:-0.01em;
  color:var(--foreground)}
/* Gruppenkopf mit Zusatz rechts: "Stand 20:43" plus Aktualisieren-Knopf an
   Live-Sektionen [Kritik-Runde 2, Problem 6]. Der Kopf behaelt seine Breite,
   der Zusatz sitzt am rechten Rand auf derselben Grundlinie. */
.gruppen-zeile{display:flex;align-items:center;gap:8px}
.gruppen-zeile > .gruppen-kopf{flex:1 1 auto;width:auto}
.live-stand{flex:0 0 auto;display:inline-flex;align-items:center;gap:4px;
  padding-top:6px;font-size:var(--text-xs);color:var(--muted-foreground)}
.live-stand .ikon-knopf{width:22px;height:22px}
.live-stand .ikon-knopf svg{width:13px;height:13px}
.leer-handlung{margin-top:8px}
/* Kanban der Arbeitspakete je Projekt [Owner-Wunsch W7]. Drei Spalten nach
   ZUSTAND; auf schmalen Flaechen untereinander. */
.kanban{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;align-items:start}
.kanban-spalte{min-width:0;display:flex;flex-direction:column;gap:8px}
/* Der Spaltenkopf ist eine Stufe UNTER dem Abschnittstitel, nicht eine eigene
   Sprache [Kritik-Runde 2, Problem 5]: 14 px halbfett in normaler Schreibung.
   Versalien waren hier die vierte Ueberschriften-Sprache auf derselben Seite. */
.kanban-kopf{margin:0 0 6px;font-size:var(--text-sm);font-weight:600;
  letter-spacing:-0.01em;color:var(--foreground);display:flex;align-items:center;gap:6px}
.kanban-karte{display:flex;flex-direction:column;gap:6px;width:100%;text-align:left;
  background:var(--card);border:1px solid var(--border);border-radius:var(--radius-lg);
  padding:10px 12px;transition:border-color var(--dauer),background var(--dauer)}
.kanban-karte:hover{border-color:var(--primary);background:color-mix(in srgb,var(--accent) 35%,var(--card))}
.kanban-titel{font-size:var(--text-compact);font-weight:600;overflow-wrap:anywhere}
.kanban-balken{display:block;height:4px;border-radius:var(--radius-pille);
  background:var(--muted);overflow:hidden}
.kanban-balken-fuell{display:block;height:100%;background:var(--status-ok)}
.kanban-fuss{font-size:var(--text-micro);color:var(--muted-foreground);
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
/* GRUEN NUR FUER AKTIVEN FORTSCHRITT [Kritik-Runde 2, Problem 10]. Trug beides
   -- laufend UND fertig -- denselben Ton, sagte die Farbe nichts mehr. Fertig
   ist jetzt ruhiges Grau (die Arbeit ist vorbei, sie braucht keine Farbe),
   offen eine leere Spur (sichtbar, dass noch nichts geschah). */
.kanban-balken[data-zustand="fertig"] .kanban-balken-fuell{background:var(--muted-foreground);opacity:.55}
.kanban-balken[data-zustand="offen"] .kanban-balken-fuell{background:var(--border)}
@media (max-width:900px){.kanban{grid-template-columns:1fr}}
/* Erklaersatz unter einem technischen Gruppennamen [Owner-Wunsch W14]. */
.gruppen-erklaersatz{font-size:var(--text-xs);color:var(--muted-foreground);
  margin:0 0 8px;max-width:80ch}
/* Technische Namen (SessionStart, PreToolUse) in ihrer echten Schreibweise. */
.gruppen-titel[data-code]{text-transform:none;letter-spacing:0;font-family:var(--mono)}
.zeilen-pfeil{flex:0 0 16px;width:16px;height:16px;color:var(--muted-foreground);opacity:.75}
.eintrag-zeile:hover .zeilen-pfeil{opacity:1;color:var(--foreground)}
/* Als kleines Badge DIREKT neben dem Titel -- nicht meterweit entfernt am
   rechten Seitenrand [Kritiker-Befund Gauntlet-Runde 2]. */
.gruppen-zahl{margin-left:4px;font-size:var(--text-xs);color:var(--muted-foreground);
  font-variant-numeric:tabular-nums;background:var(--muted);
  border-radius:var(--radius-pille);padding:0 8px;line-height:18px}
/* Grid-Tabellen mit role-Semantik; jede Spalte mindestens 96 px. */
.tabelle{display:grid;border:1px solid var(--border);border-radius:var(--radius-lg);
  background:var(--card);overflow:hidden}
.tabelle-kopf{font-size:var(--text-xs);font-weight:500;text-transform:uppercase;letter-spacing:.05em;
  color:var(--muted-foreground);padding:8px 12px;border-bottom:1px solid var(--border);min-width:var(--spalte-min)}
.tabelle-zelle{display:flex;align-items:center;min-height:var(--zeile-tabelle);padding:6px 12px;
  border-bottom:1px solid var(--border);min-width:var(--spalte-min);font-size:var(--text-compact);
  overflow:hidden;text-overflow:ellipsis}
`;

const STATUS = `
/* Status-Familie. Je Status EINE Form (Glyphe) plus das Wort -- nie Farbe allein.
   Die Formel steht genau einmal; hell/dunkel unterscheiden sich nur in den
   Anteil-Tokens oben. --sc ist der lokale Grundton des jeweiligen Status. */
.status-ok{--sc:var(--status-ok)}
.status-hinweis{--sc:var(--status-hinweis)}
.status-fehler{--sc:var(--status-fehler)}
.status-fehlt{--sc:var(--status-fehlt)}
.status-unlesbar{--sc:var(--status-unlesbar)}
.status-chip{display:inline-flex;align-items:center;gap:6px;height:22px;padding:0 8px;
  border:1px solid;border-radius:var(--radius-pille);font-size:var(--text-xs);white-space:nowrap;
  background:color-mix(in srgb,var(--sc) var(--chip-fuell-anteil),var(--chip-fuell-basis));
  color:color-mix(in srgb,var(--sc) var(--chip-text-anteil),var(--chip-text-basis));
  border-color:color-mix(in srgb,var(--sc) var(--chip-rand-anteil),var(--chip-rand-basis))}
.status-chip .status-glyphe{color:currentColor}
/* Stiller Normalzustand: Glyphe behaelt ihren Ton, das Wort wird leise, die
   Pille verschwindet -- Farbe bleibt den Abweichungen vorbehalten. */
.status-chip.status-still{background:transparent;border-color:transparent;color:var(--muted-foreground)}
.status-chip.status-still .status-glyphe{color:var(--sc)}
/* Freistehende Glyphe (Baum, Karten): der Grundton direkt auf der Flaeche.
   Gemessen mindestens 4,52:1 (hell) / 5,43:1 (dunkel) auf --card. */
.status-glyphe{flex:0 0 16px;width:16px;height:16px;color:var(--sc)}
.status-punkt{width:8px;height:8px;border-radius:var(--radius-pille);background:var(--sc);flex:0 0 8px}
/* Fehlerkasten: --destructive traegt als TEXT auf --background nur 4,49:1, also
   knapp unter 4,5. Deshalb faerbt es hier Rand und Fuellung, der Text bleibt
   --foreground. Gemessen als Rand gegen --background: 4,49:1 (ueber 3:1). */
.fehlerkasten{border:1px solid var(--destructive);border-radius:var(--radius-md);
  background:color-mix(in srgb,var(--destructive) 8%,var(--card));
  color:var(--foreground);padding:10px 12px;font-size:var(--text-compact)}
`;

const BAUM = `
/* Baum: flache Liste sichtbarer Knoten, Zeile 36, Einrueckung 16+24*Tiefe-8.
   Caret 36x36 als eigener Knopf, damit Aufklappen und Auswaehlen getrennt sind. */
.baum{width:var(--baum-breite);flex:0 0 auto;overflow:auto;border-right:1px solid var(--border);
  padding:8px 0;scrollbar-gutter:stable}
.baum-zeile{display:flex;align-items:center;gap:6px;height:var(--zeile-baum);width:100%;
  text-align:left;font-size:var(--text-compact);
  padding-left:calc(16px + var(--einzug-stufe) * var(--tiefe,0) - 8px);padding-right:8px}
.baum-zeile:hover{background:color-mix(in srgb,var(--accent) 30%,transparent)}
.baum-zeile[aria-selected="true"]{background:color-mix(in srgb,var(--accent) 20%,transparent);font-weight:500}
.baum-caret{flex:0 0 var(--zeile-baum);width:var(--zeile-baum);height:var(--zeile-baum);
  display:grid;place-items:center;color:var(--muted-foreground)}
.baum-caret[data-blatt="ja"]{visibility:hidden}
.baum-symbol{flex:0 0 16px;width:16px;height:16px;color:var(--muted-foreground)}
.baum-name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.baum-zahl{flex:0 0 auto;font-size:var(--text-xs);color:var(--muted-foreground);
  font-variant-numeric:tabular-nums}
.baum-marke{flex:0 0 auto;font-size:var(--text-nano);text-transform:uppercase;letter-spacing:.06em;
  color:var(--muted-foreground);border:1px solid var(--border);border-radius:var(--radius-sm);padding:0 4px}
.baum-flaeche{display:flex;min-height:0;height:100%}
`;

const BAUSTEINE = `
/* MetricCard: Wert 24 tabular, Label 12 muted, kein Rahmen. */
/* auto-fit statt fester Spaltenzahl: fuenf Karten fuellen die Reihe, keine
   verwaiste Karte in Zeile zwei [Kritiker-Befund Gauntlet-Runde 1]. */
.kennzahl-reihe{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px;margin-bottom:20px}
.kennzahl{display:flex;flex-direction:column;gap:2px;padding:12px 14px;border-radius:var(--radius-lg);
  background:var(--card);text-align:left;width:100%;transition:background var(--dauer)}
.kennzahl[data-klickbar="ja"]:hover{background:color-mix(in srgb,var(--accent) 50%,transparent)}
.kennzahl-kopf{display:flex;align-items:center;gap:6px;color:var(--muted-foreground)}
.kennzahl-wert{display:block;font-size:var(--text-2xl);font-weight:600;font-variant-numeric:tabular-nums;line-height:1.15}
.kennzahl-label{display:block;font-size:var(--text-xs);color:var(--muted-foreground)}
/* Genau EINE Meta-Zeile je Karte -- gleiche Anatomie, gleiche Hoehe
   [Kritiker-Befund Gauntlet-Runde 2]. Der volle Text steht im title. */
.kennzahl-notiz{display:block;font-size:var(--text-micro);color:var(--muted-foreground);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.kennzahl{min-height:86px}
/* EmptyState: Icon 40 in muted-Kasten, Titel 16/600, Text 14 muted, Handlung. */
.leerzustand{display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center;
  padding:40px 16px;border:1px dashed var(--border);border-radius:var(--radius-lg)}
.leer-symbol{width:40px;height:40px;display:grid;place-items:center;border-radius:var(--radius-lg);
  background:color-mix(in srgb,var(--muted) 50%,transparent);color:var(--muted-foreground)}
.leer-titel{display:block;font-size:var(--text-base);font-weight:600}
.leer-text{display:block;font-size:var(--text-sm);color:var(--muted-foreground);max-width:28rem}
.leer-kompakt{font-size:var(--text-xs);color:var(--muted-foreground);padding:8px 0}
/* FoldCurtain: gekappte Hoehe + Verlauf + Knopf. Nie stumm abschneiden. */
.vorhang{position:relative;max-height:420px;overflow:hidden}
.vorhang[data-offen="ja"]{max-height:none}
.vorhang[data-kurz="ja"]{max-height:320px}
.vorhang:not([data-offen="ja"])::after{content:"";position:absolute;left:0;right:0;bottom:0;height:64px;
  background:linear-gradient(to bottom,transparent,var(--card));pointer-events:none}
.vorhang-knopf{font-size:var(--text-xs);color:var(--primary);padding:6px 0}
/* CopyText: Rueckmeldung 1,5 s, vom Skript ueber data-kopiert gesetzt. */
/* Der Editor. Er ersetzt den Inhalt vollstaendig -- nebeneinander waere in
   einer 320-px-Spalte unlesbar, und der Vergleich ist nicht der Zweck. */
.editor{display:flex;flex-direction:column;gap:8px}
.editor textarea{width:100%;min-height:min(60vh,520px);resize:vertical;
  padding:12px 14px;border:1px solid var(--border);border-radius:var(--radius-md);
  background:var(--muted);color:var(--foreground);
  font-family:var(--mono);font-size:var(--text-xs);line-height:1.6;
  tab-size:2}
.editor textarea:focus{outline:none;border-color:var(--ring);
  box-shadow:0 0 0 3px color-mix(in srgb,var(--ring) 30%,transparent)}
.editor textarea:disabled{opacity:.6}
.editor-leiste{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.editor-leiste button{padding:6px 12px;border:1px solid var(--border);
  border-radius:var(--radius-md);background:var(--card);color:var(--foreground);
  font:inherit;font-size:var(--text-xs);cursor:pointer}
.editor-leiste button:hover{background:var(--accent)}
.editor-leiste .knopf-haupt{background:var(--primary);color:var(--primary-foreground);
  border-color:var(--primary);font-weight:500}
.editor-leiste .knopf-haupt:hover{opacity:.9;background:var(--primary)}
.editor-pfad{margin-left:auto;color:var(--muted-foreground);font-size:var(--text-xs)}

/* Die Einblendung nach dem Kopieren. Sie trug bis zum 23.08.2026 die
   KNOPF-Klasse .kopieren und eine Klasse .sichtbar, die es im Stylesheet
   ueberhaupt nicht gab: die Bestaetigung erschien als leerer Rahmen am
   Seitenende und blieb, einmal gefuellt, dauerhaft stehen. */
.meldung{position:fixed;left:50%;bottom:24px;transform:translate(-50%,8px);
  z-index:60;padding:8px 14px;border-radius:999px;border:1px solid var(--border);
  background:var(--card);color:var(--foreground);font-size:var(--text-xs);
  box-shadow:0 4px 16px rgb(0 0 0 / 0.18);
  opacity:0;visibility:hidden;pointer-events:none;
  transition:opacity 160ms ease,transform 160ms ease,visibility 0s linear 160ms}
.meldung.sichtbar{opacity:1;visibility:visible;transform:translate(-50%,0);
  transition:opacity 160ms ease,transform 160ms ease,visibility 0s}
@media (prefers-reduced-motion: reduce){
  .meldung{transition:none}
  .meldung.sichtbar{transition:none}
}
/* FEHLER SIND EIN ZUSTAND, KEIN AUFBLITZEN [Kritik-Runde 2, Problem 2].
   Ein Fehler bleibt stehen, bis man ihn wegklickt -- also braucht er Platz fuer
   einen ganzen Satz (keine Pille mehr), eine Farbkante, die ihn vom Erfolg
   unterscheidet, und Zeigerereignisse, damit sein Schliessen-Knopf klickbar ist. */
.meldung.meldung-fehler{display:flex;align-items:flex-start;gap:10px;
  max-width:min(560px,calc(100vw - 32px));text-align:left;
  border-radius:var(--radius);padding:12px 12px 12px 14px;
  border-color:var(--status-warn);border-left:3px solid var(--status-warn);
  font-size:var(--text-sm);line-height:1.45;pointer-events:auto}
.meldung-text{flex:1 1 auto}
.meldung-zu{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;
  width:24px;height:24px;margin:-2px -2px 0 0;border-radius:var(--radius-sm);
  color:var(--muted-foreground);background:none;border:0;cursor:pointer;
  -webkit-tap-highlight-color:transparent}
.meldung-zu:hover{color:var(--foreground);background:var(--accent)}
.meldung-zu svg{width:14px;height:14px}
.kopieren{display:inline-flex;align-items:center;gap:5px;font-size:var(--text-xs);
  color:var(--muted-foreground);border:1px solid var(--border);border-radius:var(--radius-sm);padding:2px 6px}
.kopieren:hover{color:var(--foreground);background:color-mix(in srgb,var(--accent) 50%,transparent)}
.kopieren[data-kopiert="ja"]{color:var(--status-ok);border-color:var(--status-ok)}
/* Balken (Bytes je Kontext-Datei): --primary ist in beiden Themen das Ende der
   chart-Leiter (hell chart-3, dunkel chart-1) und traegt 8,84 / 7,99 auf --card. */
.balken{height:6px;border-radius:var(--radius-pille);background:var(--muted);overflow:hidden;min-width:64px}
.balken > span{display:block;height:100%;background:var(--primary)}
/* Haupt-Knopf: die EINE ausgezeichnete Handlung einer Flaeche (Vorbild: der
   dunkle Aktionsknopf "Pruefung jetzt ausfuehren" in Keel Light). */
.knopf-haupt{background:var(--primary);color:var(--primary-foreground);border:1px solid var(--primary);
  border-radius:var(--radius-md);padding:6px 14px;font-size:var(--text-compact);font-weight:500;
  -webkit-tap-highlight-color:transparent}
.knopf-haupt:hover{opacity:.9}
/* FARBE MUSS MAN SICH VERDIENEN [Kritik-Runde 2, Problem 4]. "Neu messen" war
   das dunkelste und groesste Element JEDER Seite -- also lag das lauteste
   Gewicht auf einer Wartungsaktion, die man fast nie braucht, waehrend die
   unumkehrbaren Handlungen still danebenstanden. Der Knopf bleibt vollwertig
   erreichbar, tritt aber als Umriss auf und ueberlaesst die Fuellung dem,
   was der Nutzer wirklich tun will. */
#neu-messen{background:transparent;color:var(--muted-foreground);border-color:var(--border);
  font-weight:400}
#neu-messen:hover{background:var(--accent);color:var(--foreground);opacity:1}
/* Sitzungs-Karten (Ueberblick, oben): laufende Sitzungen wie die
   Agenten-Karten des Vorbilds -- Karte, Puls-Punkt, Titel, Rolle, Status. */
.sitzung-reihe{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:8px;margin-bottom:8px}
.sitzung-karte{display:flex;align-items:center;gap:10px;padding:12px 14px;
  border:1px solid color-mix(in srgb,var(--primary) 35%,var(--border));border-radius:var(--radius-lg);
  background:color-mix(in srgb,var(--primary) 6%,var(--card))}
.sitzung-punkt{flex:0 0 8px;width:8px;height:8px;border-radius:var(--radius-pille);background:var(--status-ok)}
.sitzung-haupt{flex:1 1 auto;min-width:0}
.sitzung-titel{display:block;font-size:var(--text-sm);font-weight:500;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sitzung-rolle{display:block;font-size:var(--text-xs);color:var(--muted-foreground);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sektion-fuss{padding:8px 0}
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
/* color-scheme gehoert an die WURZEL und muss dem Themenschalter folgen, nicht
   der Systemeinstellung -- sonst klappt im dunklen Dashboard ein weisses
   Auswahlmenue auf, wenn Windows hell laeuft [Befund 26.08.2026]. */
:root{color-scheme:light}
@media (prefers-color-scheme:dark){:root:not([data-thema="hell"]){color-scheme:dark}}
:root[data-thema="dunkel"]{color-scheme:dark}
.auftrag-zeile select{background:var(--card);color:var(--foreground)}
/* Paket-Schritte: eingerueckt unter ihrem Paket. */
.paket-schritte{margin:4px 0 8px 44px}
.paket-offen{margin:4px 12px 8px 44px}
.paket-repo{margin-bottom:4px}
/* Beschreibung im Detail: ein Absatz, kein Aufklapper. */
.detail-beschreibung{padding:8px 0;font-size:var(--text-compact);max-width:78ch}
/* Ablaufstreifen "So laeuft eine Sitzung". */
.ablauf{display:flex;align-items:stretch;gap:8px;flex-wrap:wrap;margin:20px 0}
.ablauf-station{flex:1 1 160px;min-width:160px;text-align:left;padding:10px 12px;background:var(--card);
  border-radius:var(--radius-lg);border:1px solid var(--border)}
.ablauf-station:hover{background:color-mix(in srgb,var(--accent) 50%,transparent)}
.ablauf-titel{display:block;font-size:var(--text-compact);font-weight:600}
.ablauf-text{display:block;font-size:var(--text-xs);color:var(--muted-foreground)}
.ablauf-pfeil{align-self:center;color:var(--muted-foreground);flex:0 0 auto}
`;

const { BOARD_UND_PALETTE, SCHMAL, CONTROL_CENTER, DATEIANSICHT, DETAIL } = require("./styles-extra.js");

const css = [
  themenBloecke(),
  GRUNDLAGE,
  SEITENLEISTE,
  GERUEST,
  LISTEN,
  STATUS,
  BAUM,
  DATEIANSICHT,
  DETAIL,
  BAUSTEINE,
  CONTROL_CENTER,
  BOARD_UND_PALETTE,
  SCHMAL
].join("\n");

module.exports = { css, TOKENS, oklchZuRgb, kontrast };
