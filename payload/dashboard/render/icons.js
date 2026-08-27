// ICONS -- Schritt 3 von "messen -> Daten -> rendern -> Datei".
//
// WAS DIESE DATEI IST
// Ein fester Satz Inline-SVG in Lucide-Form: 24er Kasten, runde Enden, gezeichnet
// mit currentColor und stroke-width 1.75, ausgegeben mit 16 px Kantenlaenge. Die
// Namen und die Masse stammen aus Abschnitt 8 der Spezifikation.
//
// WARUM KEIN FREMDPAKET
// Die erzeugte HTML muss per Doppelklick laufen: offline, ohne Bauschritt, ohne
// Netz. Ein Icon-Paket waere entweder ein Netzabruf oder ein Bundle -- beides ist
// hier ausgeschlossen. Deshalb stehen die Formen als Pfaddaten in dieser Datei.
//
// EHRLICHKEITS-REGEL
// icon() mit unbekanntem Namen erfindet nichts und zeigt nichts Falsches. Es gibt
// ein neutrales Kreis-Symbol zurueck und legt den Namen in unbekannteAufrufe ab.
// Nichts geht auf die Konsole -- die Ausgabe dieses Bausatzes ist die HTML-Datei,
// eine Warnzeile darin waere Muell. Der Test liest stattdessen die Liste.
//
// HERKUNFT DER FORMEN
// Die meisten Pfade sind die bekannten Lucide-Formen. Wo die genaue Pfaddatei
// nicht sicher bekannt war, steht bewusst eine eigene, schlichte, klar erkennbare
// Zeichnung statt eines geratenen Pfades -- betroffen und unten je markiert:
// Sparkles, Layers, CircleDashed, ListChecks, Eye, BookOpen, FileCode2.
//
// AUFRUF   const { icon, NAMEN, unbekannteAufrufe } = require("./icons");
//          icon("CircleCheck")        -> fertiger svg-String, 16 px
//          icon("Folder", 40)         -> derselbe Satz, 40 px (EmptyState)

const KASTEN = 24; // viewBox-Kantenlaenge aller Formen (Lucide-Raster)
const STRICHSTAERKE = "1.75";
const GROESSE_STANDARD = 16;
const GROESSE_MIN = 8;
const GROESSE_MAX = 96;
const MERKGRENZE = 200; // unbekannteAufrufe waechst nicht unbegrenzt

// ---------------------------------------------------------------------------
// Die Formen. Schluessel = kanonischer Lucide-Name (so wie in Abschnitt 8
// geschrieben), Wert = die Kindelemente des svg, ohne Huelle.
// ---------------------------------------------------------------------------
const FORMEN = {
  // -- Seitenleiste, Kopfzeile, Thema ---------------------------------------
  PanelLeftClose:
    '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="m16 15-3-3 3-3"/>',
  PanelLeftOpen:
    '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="m14 9 3 3-3 3"/>',
  Search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  CircleHelp:
    '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  Command:
    '<path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3"/>',
  Sun:
    '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  Moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  Monitor:
    '<rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/>',

  // -- Dateibaum -------------------------------------------------------------
  Folder:
    '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  FolderOpen:
    '<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/>',
  FileText:
    '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  // FileCode2: eigene, schlichte Zeichnung (Blatt + Winkelklammern)
  FileCode2:
    '<path d="M15 2H6a2 2 0 0 0-2 2v4"/><path d="M20 8v12a2 2 0 0 1-2 2H6"/><path d="M15 2l5 6h-5V2Z"/><path d="m6 12-3 3 3 3"/><path d="m10 18 3-3-3-3"/>',
  File:
    '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
  GitBranch:
    '<path d="M6 3v12"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
  GitCommit:
    '<circle cx="12" cy="12" r="3"/><path d="M3 12h6"/><path d="M15 12h6"/>',

  // -- Auf- und Zuklappen, Navigation ---------------------------------------
  ChevronRight: '<path d="m9 18 6-6-6-6"/>',
  ChevronDown: '<path d="m6 9 6 6 6-6"/>',
  ChevronLeft: '<path d="m15 18-6-6 6-6"/>',
  ArrowRight: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',

  // -- Aktionen --------------------------------------------------------------
  Copy:
    '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  Check: '<path d="M20 6 9 17l-5-5"/>',
  X: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  Maximize2:
    '<path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/>',
  Minimize2:
    '<path d="M4 14h6v6"/><path d="M20 10h-6V4"/><path d="M14 10l7-7"/><path d="M3 21l7-7"/>',
  ExternalLink:
    '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  // Eye: aeltere, einfache Lucide-Form (Mandel + Pupille)
  Eye:
    '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  Code: '<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>',
  Play: '<path d="M6 3v18l14-9Z"/>',
  Settings:
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/>',

  // -- Ansichten -------------------------------------------------------------
  List:
    '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>',
  SquareKanban:
    '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M8 7v7"/><path d="M12 7v4"/><path d="M16 7v9"/>',
  // ListChecks: eigene, schlichte Zeichnung (zwei Haken + drei Zeilen)
  ListChecks:
    '<path d="M11 6h10"/><path d="M11 12h10"/><path d="M11 18h10"/><path d="m3 6 2 2 4-4"/><path d="m3 16 2 2 4-4"/>',
  LayoutDashboard:
    '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',

  // -- Status (je Status eine eigene Form, nie Farbe allein) -----------------
  CircleCheck: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  CircleDot: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="1.5"/>',
  CircleX:
    '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
  // CircleDashed: eigene Zeichnung ueber stroke-dasharray statt acht Einzelboegen
  CircleDashed: '<circle cx="12" cy="12" r="10" stroke-dasharray="3.6 3.2"/>',
  CircleMinus: '<circle cx="12" cy="12" r="10"/><path d="M8 12h8"/>',
  Ban: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
  Circle: '<circle cx="12" cy="12" r="10"/>',
  AlertTriangle:
    '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',

  // -- Bereiche der Seitenleiste --------------------------------------------
  Terminal: '<path d="m4 17 6-6-6-6"/><path d="M12 19h8"/>',
  Slash: '<path d="M22 2 2 22"/>',
  // Sparkles: eigene Zeichnung (Vierzack + zwei Funken)
  Sparkles:
    '<path d="M11 3.5 12.8 8.7 18 10.5l-5.2 1.8L11 17.5l-1.8-5.2L4 10.5l5.2-1.8Z"/><path d="M19 3v4"/><path d="M21 5h-4"/><path d="M18.5 16.5v3"/><path d="M20 18h-3"/>',
  // BookOpen: aeltere, einfache Lucide-Form (zwei Buchhaelften)
  BookOpen:
    '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2Z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7Z"/>',
  // Layers: eigene Zeichnung (drei gestapelte Rauten)
  Layers:
    '<path d="m12 2 10 5-10 5L2 7Z"/><path d="m2 12 10 5 10-5"/><path d="m2 17 10 5 10-5"/>',
  Wrench:
    '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76Z"/>',
  HardDrive:
    '<path d="M22 12H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z"/><path d="M6 16h.01"/><path d="M10 16h.01"/>',
  Braces:
    '<path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1"/><path d="M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1"/>',
  Link:
    '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
};

// Nachtrag 23.08.2026 -- beim Bau der Oberflaeche gebraucht und hier nicht da.
// Gemessen: sechs Aufrufe liefen ins Ersatzsymbol, darunter der Knopf
// "Neu messen" und der Leerzustand. Ein Kreis, wo ein Papierkorb sein sollte,
// sieht nicht nach Absicht aus.
Object.assign(FORMEN, {
  // RefreshCw -- zwei Bogen mit Pfeilspitzen (Neu messen)
  RefreshCw:
    '<path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/>' +
    '<path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/>',
  // Clipboard -- Inhalt kopieren, absichtlich anders als Copy (Pfad kopieren).
  // Als Pfad gezeichnet, nicht als <rect>: der Selbsttest misst die Ausdehnung
  // aus den Pfaddaten und haelt ein reines Rechteck fuer entartet.
  Clipboard:
    '<path d="M9 2h6a1 1 0 0 1 1 1v3H8V3a1 1 0 0 1 1-1z"/>' +
    '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
  // Inbox -- Leerzustand
  Inbox:
    '<path d="M22 12h-6l-2 3h-4l-2-3H2"/>' +
    '<path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.7 4H7.3a2 2 0 0 0-1.8 1.1z"/>',
  // Shield -- die Station "Vor jedem Werkzeugaufruf"
  Shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  // Square -- die Station "Sitzungsende"
  Square: '<path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/>',
  // Lock -- gesperrter Dateiinhalt
  Lock:
    '<path d="M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z"/>' +
    '<path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  // Maximize2 -- dieselbe Datei in voller Breite oeffnen (Panel -> Dateiansicht)
  Maximize2:
    '<path d="M15 3h6v6"/><path d="M9 21H3v-6"/>' +
    '<path d="M21 3l-7 7"/><path d="M3 21l7-7"/>',
});

const NAMEN = Object.keys(FORMEN);

// Zweitnamen. Wer "file-code" schreibt, meint FileCode2 -- das soll nicht am
// Anhaengsel scheitern. Die Aufloesung laeuft ueber dieselbe Vereinfachung wie
// die kanonischen Namen (klein, nur Buchstaben und Ziffern).
const ZWEITNAMEN = {
  filecode: "FileCode2",
  refresh: "RefreshCw",
  "circle-help": "CircleHelp",
  panelleft: "PanelLeftClose",
  kopieren: "Copy",
  schliessen: "X",
  ordner: "Folder",
  datei: "File",
  maximize: "Maximize2",
};

// Aufrufe mit unbekanntem Namen. Bewusst eine Liste am Modul (keine Ausgabe):
// der Test liest sie, die HTML bleibt sauber.
const unbekannteAufrufe = [];

// ---------------------------------------------------------------------------
// Namensaufloesung: PascalCase, kebab-case und Kleinschreibung fuehren auf
// denselben Eintrag. Der Klassenname wird EINMAL hier gebildet -- nie aus dem
// Aufrufparameter, damit kein fremder Text in ein Attribut geraten kann.
// ---------------------------------------------------------------------------
function schluessel(name) {
  return String(name == null ? "" : name)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function klassenname(name) {
  const teile = String(name).replace(/([a-z0-9])([A-Z])/g, "$1-$2");
  return "ic-" + teile.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

const INDEX = new Map();
const KLASSEN = new Map();
for (const name of NAMEN) {
  INDEX.set(schluessel(name), name);
  KLASSEN.set(name, klassenname(name));
}

// Groesse: nur ganze Zahlen im erlaubten Fenster. Alles andere faellt auf 16 --
// so kann auch ein durchgereichter Fremdwert kein Attribut aufbrechen.
function groesseSichern(wert) {
  const n = Math.round(Number(wert));
  if (!Number.isFinite(n) || n < GROESSE_MIN || n > GROESSE_MAX) return GROESSE_STANDARD;
  return n;
}

function svgHuelle(klasse, groesse, formen) {
  const g = groesseSichern(groesse);
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" class="ic ' +
    klasse +
    '" width="' +
    g +
    '" height="' +
    g +
    '" viewBox="0 0 ' +
    KASTEN +
    " " +
    KASTEN +
    '" fill="none" stroke="currentColor" stroke-width="' +
    STRICHSTAERKE +
    '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
    formen +
    "</svg>"
  );
}

function vermerken(name) {
  const wert = String(name == null ? "" : name);
  if (unbekannteAufrufe.length >= MERKGRENZE) return;
  if (unbekannteAufrufe.indexOf(wert) === -1) unbekannteAufrufe.push(wert);
}

// icon(name[, groesse]) -> fertiger svg-String.
// Unbekannter Name: neutraler Kreis, Klasse ic-unbekannt, Name vermerkt.
function icon(name, groesse) {
  const kanonisch = INDEX.get(schluessel(name)) || ZWEITNAMEN[schluessel(name)];
  if (!kanonisch) {
    vermerken(name);
    return svgHuelle("ic-unbekannt", groesse, FORMEN.Circle);
  }
  return svgHuelle(KLASSEN.get(kanonisch), groesse, FORMEN[kanonisch]);
}

const AUSSEN = { icon, NAMEN, unbekannteAufrufe, ZWEITNAMEN };

if (typeof module !== "undefined" && module.exports) module.exports = AUSSEN;
if (typeof window !== "undefined") {
  window.HD = window.HD || {};
  window.HD.icons = AUSSEN;
}
