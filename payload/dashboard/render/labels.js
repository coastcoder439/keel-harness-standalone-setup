// WORTE -- der EINZIGE Ort, an dem deutsche Beschriftungen stehen.
//
// WARUM DAS EINE DATEI IST
// Die Vorfassung hatte ihre Woerter ueber 950 Zeilen verstreut: "Brett", "Posten",
// "Marke", "nicht messbar", "Dringlichkeit". Niemand konnte sie pruefen, weil niemand
// sie alle sah. Hier stehen sie in einer Liste, die ein Test durchgehen kann -- und
// die ein Mensch in fuenf Minuten liest, statt sie in der erzeugten Seite zu suchen.
//
// REGEL FUER DIESE DATEI
// 1. Kein deutsches Label ausserhalb dieser Datei. Weder in styles.js noch in shell.js
//    noch im Browser-Skript. Wer eins braucht, holt es hier.
// 2. Die MESSUNG liefert Codes, keine Saetze. Aus "notizCode: leere-vorlage" wird hier
//    ein deutscher Satz -- nicht in measure.js.
// 3. Harness-Begriffe bleiben englisch: Hooks, Skills, Commands, Rules, Agents, MCP,
//    settings.json, CLAUDE.md, SessionStart, PreToolUse, Stop, matcher, statusMessage.
//    Grund: das sind die Namen der Ordner und Schluessel auf der Platte. Eine
//    Eindeutschung ("Waechter", "Faehigkeiten") liest sich deutsch, aber niemand
//    erkennt daran noch, welches Verzeichnis gemeint ist.
// 4. Keine Abkuerzungen. "Zeile 2-7", nicht "Z. 2-7". Einheiten (B, KB, MB, s) erlaubt.
// 5. Kein Kunstwort. Wenn ein Wort erklaert werden muss, ist es das falsche Wort.

// ---------------------------------------------------------------------------
// Verbotene Woerter -- die Messlatte, gegen die der Test laeuft.
// Jedes davon stand in der Vorfassung und wurde beanstandet.
// ---------------------------------------------------------------------------

const VERBOTEN = [
  "Brett", "Posten", "Rubrik", "Marke", "Dringlichkeit", "Kennung",
  "nicht messbar", "Nicht messbar", "Ohne gemessenen Zustand", "ohne gemessenen Zustand",
  "Waechter", "Wächter", "Faehigkeiten", "Fähigkeiten", "Befehle", "Agenten",
  "Laeuft bei", "Läuft bei", "Verzeichnisse", "Teil-Anlass", "Verwandtes",
  "verdrahtet in", "schreibt Kontext", "Hier wurde noch nichts gemessen",
  "Krume", "Tafel", "Einzelansicht",
  // Abkuerzungen
  "Z.", "Anz.", "geaend.", "geänd.", "Std.", "Verz.",
];

// ---------------------------------------------------------------------------
// Seiten -- Name, Zweck-Satz, Ordner dahinter.
// Der Zweck-Satz steht als erste Zeile der Hauptflaeche; {n}-Platzhalter werden
// mit gemessenen Zahlen gefuellt (fuellen() unten). Kein Satz ohne Zahl, wo eine
// Zahl existiert -- sonst ist es Dekoration.
// ---------------------------------------------------------------------------

const SEITEN = {
  ueberblick: {
    // Owner 25.08.2026 abends: der Ueberblick IST das Control Center --
    // Widgets verdichten nach oben (Gesundheit, die drei wichtigsten
    // Aufgaben, Logbuch/Automatik, Sitzungen, Auftrag), die Reiter darunter
    // verbreitern. Kennung bleibt "ueberblick" (Adressen, Eintraege).
    name: "Control Center",
    ort: null,
    zweck: "Trägt alles, was braucht dich, wer arbeitet woran — verdichtet; die Breite liegt in den Reitern.",
    icon: "layout-dashboard",
  },
  zutun: {
    name: "Zu tun",
    ort: null,
    zweck: "Was offen ist — mit Grund, Quelle und dem Befehl dazu. {n} aus der Messung, {doku} aus Dokumenten, dazu die Arbeitspakete aller Repos.",
    icon: "list-checks",
  },
  dateien: {
    name: "Dateien",
    ort: null,
    zweck: "Der Harness-Ordner, wie er auf der Platte liegt — {n} Dateien, jede lesbar, mit Art und Beschreibung.",
    icon: "folder",
  },
  hooks: {
    name: "Hooks",
    ort: ".claude/settings.json",
    // Der Eintragsort steht als Pfad-Chip hinter dem Satz (SEITEN.ort) --
    // ihn auch im Satz zu nennen hiesse zweimal dasselbe (Beanstandung A7).
    zweck: "Hooks sind Skripte, die Claude Code bei Ereignissen ausführt. Hier {n} Einträge auf {skripte} Skripte, dazu die statusLine.",
    icon: "terminal",
  },
  commands: {
    name: "Commands",
    ort: ".claude/commands/",
    zweck: "Commands sind Markdown-Dateien in .claude/commands/ — mit Schrägstrich aufrufbar. {n} Dateien.",
    icon: "slash",
  },
  skills: {
    name: "Skills",
    ort: ".claude/skills/",
    zweck: "Skills sind SKILL.md-Dateien in .claude/skills/ — sie laden auf Abruf; einer bei Sitzungsstart. {n} Skills, {dateien} Dateien.",
    icon: "sparkles",
  },
  rules: {
    name: "Rules",
    ort: ".claude/rules/",
    zweck: "Rules sind Markdown-Dateien in .claude/rules/ — ohne Frontmatter laden sie in jeder Sitzung (Dauer-Kontext), mit Frontmatter nur auf Abruf. {n} Dateien, die dauerhaft geladenen zusammen etwa {token} Token.",
    icon: "book-open",
  },
  kontext: {
    name: "Session-Kontext",
    ort: "CLAUDE.md · .claude/rules/",
    zweck: "Was jede Sitzung automatisch mitliest — und was es kostet. {n} Stücke, zusammen etwa {token} Token je Sitzung.",
    icon: "layers",
  },
  werkzeuge: {
    name: "Tool-Landschaft",
    ort: "docs/tool-landscape.md",
    zweck: "CLIs, MCP-Server, APIs und Zugänge dieses Arbeitsplatzes — erhoben vom Onboarding. Zugänge nur als Namen, nie als Werte.",
    icon: "wrench",
  },
  projekte: {
    name: "Projekte",
    ort: "user-projects/",
    zweck: "Was unter user-projects/ liegt und was es vorhat — {n} Projekte, {doku} Dokumente. {ohne} ohne Wegweiser.",
    icon: "folder-open",
  },
  backup: {
    name: "Backup",
    ort: "git je Repo",
    zweck: "Liegt die Arbeit auch außerhalb dieses Rechners? {n} Repos geprüft, {offen} mit Lücke.",
    icon: "hard-drive",
  },
  commits: {
    name: "Commits",
    ort: "git log",
    zweck: "Die letzten Commits über alle Repos hinweg — {n} Einträge, nach Tag gruppiert.",
    icon: "git-commit",
  },
  rohdaten: {
    name: "Rohdaten",
    ort: "dashboard.json",
    zweck: "Der gemessene Datensatz selbst — damit jede Zahl nachschlagbar ist.",
    icon: "braces",
  },
};

// Tab-Gruppen: EIN Eintrag in der Seitenleiste buendelt mehrere Seiten als
// Reiter -- die Seiten selbst (Kennungen, Adressen, Eintraege) bleiben, nur die
// Navigation zeigt sie nicht mehr einzeln. Grund [Owner, 25.08.2026]: das
// Side-Menue darf keine interne Mess-Taxonomie sein; 14 Eintraege waren eine
// Messkategorien-Liste, kein Nutzer-Menue.
const TABGRUPPEN = {
  harness: {
    name: "Harness",
    icon: "terminal",
    ort: ".claude/",
    seiten: ["hooks", "commands", "skills", "rules", "kontext", "werkzeuge"],
  },
  repos: {
    // "Zu tun" lebt hier als Reiter [Owner 25.08.2026 abends: der Vollbestand
    // des Offenen wandert zu den Projekten; oben verdichtet ihn das
    // Control-Center-Widget "Deine drei"].
    name: "Projekte",
    icon: "folder-open",
    ort: "user-projects/",
    seiten: ["projekte", "zutun", "backup", "commits"],
  },
};

// Die Seitenleiste: VIER Nutzer-Eintraege [Owner 25.08.2026 abends].
// "tab:<id>" verweist auf eine Tab-Gruppe. "Rohdaten" steht bewusst NICHT hier
// -- die Seite bleibt ueber die Befehlspalette und den Fusszeilen-Verweis
// erreichbar; sie ist Beleg, nicht Alltag.
const NAVIGATION = [
  { gruppe: null, eintraege: ["ueberblick", "tab:repos", "tab:harness", "dateien"] },
];

// ---------------------------------------------------------------------------
// Status -- sechs Woerter, je eine Form. Nie Farbe allein: wer Rot nicht von
// Gruen unterscheidet, liest die Glyphe.
// ---------------------------------------------------------------------------

const STATUS = {
  ok:        { wort: "In Ordnung",              glyphe: "circle-check",  token: "--status-ok",       rang: 0 },
  hinweis:   { wort: "Hinweis",                 glyphe: "circle-dot",    token: "--status-hinweis",  rang: 1 },
  fehlt:     { wort: "Fehlt",                   glyphe: "circle-dashed", token: "--status-fehlt",    rang: 2 },
  befund:    { wort: "Fehler",                  glyphe: "circle-x",      token: "--status-fehler",   rang: 3 },
  unlesbar:  { wort: "Nicht lesbar",            glyphe: "circle-minus",  token: "--status-unlesbar", rang: 4 },
  entfaellt: { wort: "Nicht Teil dieses Harness", glyphe: "ban",         token: "--status-fehlt",    rang: 0 },
};

// ---------------------------------------------------------------------------
// Art -- EIN Feld statt der beiden Woerter "Art" und "Rolle".
// Links der Code aus der Messung, rechts das Wort auf der Oberflaeche.
// ---------------------------------------------------------------------------

const ART = {
  "hook-skript":     "Hook-Skript",
  "skript":          "Skript",
  "settings":        "Einstellung (settings.json)",
  "launch":          "Vorschau-Konfiguration",
  "wurzel-kontext":  "CLAUDE.md (Workspace-Kontext)",
  "gitignore":       "Git-Ausschlussliste",
  "command":         "Command",
  "skill":           "Skill",
  "skill-datei":     "Skill-Datei",
  "dauer-regel":     "Rule (Dauer-Regel)",
  "abruf-regel":     "Rule (auf Abruf)",
  "doku":            "Dokumentation",
  "dashboard-modul": "Dashboard-Modul",
  "dashboard-doku":  "Dashboard-Anleitung",
  "lizenz":          "Lizenz",
  "sonstiges":       "Datei",
  "ordner":          "Ordner",
  "repo":            "Eigenes Repo",
};

// Beschreibung fuer Dateien, die keine eigene Quelle haben (Stufe "Rolle").
// Ohne diese Saetze stuende bei settings.json, launch.json und .gitignore
// "Keine Beschreibung hinterlegt" -- ausgerechnet bei den zentralen Dateien.
const ART_BESCHREIBUNG = {
  "settings":       "Zentrale Claude-Code-Einstellungen dieses Workspace; hier sind die Hooks und die statusLine eingetragen.",
  "launch":         "Startkonfiguration des Vorschau-Servers, mit dem das Dashboard im Browser geprüft wird.",
  "gitignore":      "Was Git in diesem Workspace nicht sichert — unter anderem user-projects/ und die erzeugten Dashboard-Dateien.",
  "lizenz":         "Lizenztext zu einer aus einem fremden Projekt kopierten Datei.",
  "dashboard-modul":"Baustein des Dashboards selbst — Messung oder Anzeige.",
  "repo":           "Ein eigenes Projekt-Repository. Es wird hier nicht begangen; sein Sicherungsstand steht unter Backup.",
  "dauer-regel":    "Regel, die in jeder Sitzung geladen wird (Dauer-Kontext) — sie trägt kein Frontmatter.",
  "abruf-regel":    "Regel, die nur auf Abruf geladen wird — ihr Frontmatter kennzeichnet sie als abrufbar, nicht als Dauer-Kontext.",
};

// Letzter Ausweg (A6): eine Datei ohne eigene Beschreibung und ohne bekannte
// Rolle bekommt wenigstens eine Aussage ueber ihre ART. Das ist der ehrliche
// Boden -- besser als eine leere Zeile und besser als der blosse Dateiname,
// den die Nutzen-Pruefung ohnehin verwirft. Greift z. B. fuer .yaml-/.json-
// Datendateien, die weder Frontmatter noch Kopfkommentar tragen.
const DATEITYP = {
  yaml: "YAML-Datei — strukturierte Konfiguration oder Daten.",
  yml:  "YAML-Datei — strukturierte Konfiguration oder Daten.",
  json: "JSON-Datei — strukturierte Daten.",
  toml: "TOML-Datei — strukturierte Konfiguration.",
  ini:  "INI-Datei — Konfiguration in Abschnitten.",
  cfg:  "Konfigurationsdatei.",
  conf: "Konfigurationsdatei.",
  txt:  "Textdatei ohne festes Format.",
  csv:  "CSV-Tabelle — Werte, durch Komma getrennt.",
  py:   "Python-Skript.",
  sh:   "Shell-Skript.",
  css:  "Stylesheet.",
  html: "HTML-Dokument.",
  svg:  "SVG-Grafik.",
};
// Fuer alles Uebrige: die Endung selbst nennen, statt zu schweigen.
const DATEITYP_ALLGEMEIN = "Datei vom Typ .{ext}.";

// ---------------------------------------------------------------------------
// Wirkung eines Hooks -- was er tatsaechlich kann, am Skript belegt.
// "kann stoppen" / "meldet nur" der Vorfassung war geraten; das hier ist gemessen.
// ---------------------------------------------------------------------------

// In der LISTE steht nur das Wort -- "(exit 2)" ist Implementierungsdetail
// und gehoert ins Detail (Beleg-Zeile), nicht in einen Chip [Kritiker-Befund
// Gauntlet-Runde 1, 25.08.2026].
// Kurzes, festes Vokabular gleicher Laenge -- ein Satzfragment neben
// Ein-Wort-Verben war Badge-Chaos [Kritiker-Befund Gauntlet-Runde 3]. Der
// volle Satz steht in der erklaerung (Detail).
const WIRKUNG = {
  blockiert: { wort: "blockiert", erklaerung: "Dieser Hook kann einen Werkzeugaufruf verhindern (exit 2)." },
  meldet:    { wort: "meldet",    erklaerung: "Dieser Hook schreibt eine Meldung, verhindert aber nichts." },
  kontext:   { wort: "ergänzt Kontext", erklaerung: "Dieser Hook legt der Sitzung Text vor, den sie mitliest (ergänzt den Sitzungskontext)." },
};

// Wann etwas geladen wird -- ueberall gleich formuliert.
const LADEART = {
  dauerhaft: "in jeder Sitzung",
  start:     "bei Sitzungsstart",
  abruf:     "auf Abruf",
  schlafend: "nicht geladen",
};

// Kanten zwischen Eintraegen.
const KANTE = {
  "eingetragen-in": "eingetragen in",
  "beschrieben-in": "beschrieben in",
  "ruft-auf":       "ruft auf",
  "lizenz":         "Lizenz",
  "verweist-auf":   "verweist auf",
  "geaendert-in":   "geändert in",
  "ignoriert-in":   "ignoriert in",
};

// Woher eine Beschreibung stammt -- steht klein unter dem Text, damit man
// nachschlagen kann, statt glauben zu muessen.
const QUELLE = {
  frontmatter:   "Frontmatter description",
  statusmessage: "settings.json statusMessage",
  claudemd:      "CLAUDE.md",
  kopfkommentar: "Kopfkommentar",
  absatz:        "erster Absatz",
  blockquote:    "Einleitungssatz",
  rolle:         "Art der Datei",
  typ:           "Dateityp",
};

// Git-Zustand je Datei.
const GIT = {
  getrackt:   "gesichert",
  ungetrackt: "nicht in Git",
  ignoriert:  "von Git ausgeschlossen",
  unbekannt:  "Git nicht verfügbar",
};

// ---------------------------------------------------------------------------
// Leerzustaende -- drei Sorten, nie nur ein Strich.
// Jeder hat Titel, Erklaerung und eine Handlung. Ein Leerzustand ohne Handlung
// ist eine Sackgasse.
// ---------------------------------------------------------------------------

const LEER = {
  zutun: {
    titel: "Nichts offen",
    text: "Alle geprüften Bereiche melden In Ordnung.",
    handlung: null,
  },
  hooks: {
    titel: "Keine Hooks eingetragen",
    text: "Hooks stehen in .claude/settings.json unter hooks → Ereignis → command. Ohne sie läuft bei Werkzeugaufrufen nichts automatisch mit.",
    handlung: { wort: "settings.json öffnen", ziel: "datei:.claude/settings.json" },
  },
  commands: {
    titel: "Keine Commands",
    text: "Commands sind Markdown-Dateien in .claude/commands/ mit einer description im Frontmatter.",
    handlung: null,
  },
  skills: {
    titel: "Keine Skills",
    text: "Skills liegen als .claude/skills/<name>/SKILL.md und laden auf Abruf.",
    handlung: null,
  },
  rules: {
    titel: "Keine Rules",
    text: "Ohne Dauer-Regeln in .claude/rules/ ist das ein leerer Claude Code, kein Harness.",
    handlung: null,
  },
  werkzeuge: {
    titel: "Noch nichts erhoben",
    text: "docs/tool-landscape.md trägt nur die leere Vorlage. Das Onboarding füllt sie in Schritt 3.",
    handlung: { wort: "Datei öffnen", ziel: "datei:docs/tool-landscape.md" },
  },
  treffer: {
    titel: "Kein Treffer",
    text: "Kein Eintrag passt zu dieser Suche.",
    handlung: { wort: "Suche leeren", ziel: "suche:leeren" },
  },
  filter: {
    titel: "Kein Treffer",
    text: "Kein Eintrag passt zu den gesetzten Filtern.",
    handlung: { wort: "Filter zurücksetzen", ziel: "filter:leeren" },
  },
  "bridge-pakete": {
    titel: "Keine Arbeitspakete gefunden",
    text: "Arbeitspakete stehen als docs/packages/*.md je Repo — angelegt beim Planen, nachgeführt bei jedem Abschluss.",
    handlung: null,
  },
  "bridge-sitzungen": {
    titel: "Keine Sitzung sichtbar",
    text: "Sitzungen erscheinen hier, sobald sie Nachrichten mit diesem Workspace-Pfad geschrieben haben.",
    handlung: null,
  },
  verknuepft: {
    titel: null,
    text: "Keine Verknüpfung gefunden — geprüft: settings.json, CLAUDE.md, Commands, Rules-Verweise, Commits.",
    handlung: null,
  },
  allgemein: {
    titel: "Nichts vorhanden",
    text: "Für diesen Bereich wurde nichts gefunden.",
    handlung: null,
  },
};

// ---------------------------------------------------------------------------
// Alle uebrigen Beschriftungen. Alphabetisch, damit man ein Wort findet.
// ---------------------------------------------------------------------------

const UI = {
  // Kopf und Navigation
  zumInhalt: "Zum Inhalt",
  seitenleisteEin: "Seitenleiste einklappen",
  seitenleisteAus: "Seitenleiste ausklappen",
  suchen: "Suchen",
  suchenIn: "Suchen in {seite} …",
  sucheLeeren: "Suche leeren",
  befehlspalette: "Befehlspalette",
  gemessenAm: "Gemessen am",
  neuMessen: "Neu messen",
  thema: "Thema",
  themaHell: "Hell",
  themaDunkel: "Dunkel",
  themaSystem: "System",

  // Listen und Werkzeugleiste
  ansicht: "Ansicht",
  ansichtListe: "Liste",
  ansichtBoard: "Board",
  sortieren: "Sortieren",
  gruppieren: "Gruppieren",
  filter: "Filter",
  filterZuruecksetzen: "Filter zurücksetzen",
  vonSichtbar: "{x} von {y}",
  weitereAnzeigen: "{n} weitere anzeigen",

  // Detail
  eigenschaften: "Eigenschaften",
  beschreibung: "Beschreibung",
  ansageStatusleiste: "Ansage in der Statusleiste",
  warumImKontext: "Warum im Kontext",
  stack: "Technik",
  dokumente: "Dokumente",
  plaene: "Pläne und Beschreibungen",
  weitereDokumente: "Weitere Dokumente",
  keineWegweiser: "Keine Beschreibung und keine Pläne gefunden.",
  keineWegweiserHinweis: "Eine README.md oder ZIEL.md an der Wurzel des Projekts würde hier stehen.",
  inhaltAufAbruf: "Inhalt wird beim Öffnen geladen (nur mit laufendem Server).",
  dokuGekappt: "Nur die ersten {n} Dokumente gelistet — das Projekt hat mehr.",
  keineBeschreibung: "Keine Beschreibung hinterlegt",
  keineBeschreibungQuelle: "Eine Beschreibung stünde in: {ort}",
  dateiinhalt: "Inhalt",
  inhaltZeigen: "Inhalt · {n} Zeilen · {sprache} — anzeigen",
  inhaltGesperrt: "Inhalt nicht eingebettet: {grund}",
  inhaltGesperrtIgnoriert: "Diese Datei ist von Git ausgeschlossen. Ihr Inhalt wird nicht in das Dashboard eingebettet — sie könnte Zugangsdaten tragen.",
  inhaltGesperrtBinaer: "Keine Textdatei.",
  zeileAusgeblendet: "Zeile ausgeblendet — sieht aus wie ein Zugang",
  verknuepftMit: "Verknüpft mit",
  rohobjekt: "Rohobjekt",
  gerendert: "Gerendert",
  bearbeiten: "Bearbeiten",
  speichern: "Speichern",
  abbrechen: "Abbrechen",
  gespeichert: "Gespeichert.",
  wirdGespeichert: "Wird gespeichert …",
  wirdGemessen: "Gespeichert. Wird neu gemessen …",
  speichernFehlgeschlagen: "Nicht gespeichert: {grund}",
  nurLesen: "Nur lesen — zum Ändern: node dashboard/serve.js",
  ungespeichert: "Ungespeicherte Änderungen. Wirklich verwerfen?",
  neuGemessen: "Neu gemessen.",
  quelltext: "Quelltext",
  vollbild: "Vollbild",
  verkleinern: "Verkleinern",
  schliessen: "Schließen",
  zurueck: "Zurück",

  // Kopieren und Oeffnen
  kopieren: "Kopieren",
  kopiert: "Kopiert",
  kopierenFehlgeschlagen: "Kopieren fehlgeschlagen",
  pfadKopieren: "Pfad kopieren",
  inhaltKopieren: "Inhalt kopieren",
  befehlKopieren: "Befehl kopieren",
  jsonKopieren: "JSON kopieren",
  imBrowserOeffnen: "Datei im Browser öffnen",
  inVsCodeOeffnen: "In VS Code öffnen",

  // Baum
  aufklappen: "Aufklappen",
  einklappen: "Einklappen",
  ordnerInhalt: "{n} Dateien",
  dateiWaehlen: "Datei wählen",
  dateiWaehlenText: "Links im Baum eine Datei anklicken — ihr Inhalt erscheint hier.",

  // Quellen-Woerter, die der Browser-Teil vergleichen muss (detail.js:
  // Beschreibung nicht doppeln, wenn sie der erste Absatz des Inhalts ist).
  quelleAbsatz: QUELLE.absatz,
  quelleEinleitung: QUELLE.blockquote,

  // Felder
  pfad: "Pfad",
  art: "Art",
  groesse: "Größe",
  zeilen: "Zeilen",
  geaendert: "Geändert",
  git: "Git",
  herkunft: "Herkunft",
  herkunftUnbestimmt: "Nicht bestimmt — kein Vergleichsstand vorhanden",
  laedt: "Lädt",
  laedtInhalt: "Inhalt wird geladen …",
  inhaltNurServer: "Inhalt nur mit laufendem Server — starten: node dashboard/serve.js",
  inhaltFehler: "Inhalt konnte nicht geladen werden: {grund}",
  bearbeitenGesperrt: "Diese Datei enthält etwas wie einen Zugang und lässt sich hier nicht gefahrlos bearbeiten — sonst würde er beim Speichern überschrieben.",
  beleg: "Beleg",
  quelle: "Quelle",
  status: "Status",
  name: "Name",
  typ: "Typ",

  // Hooks
  ereignis: "Ereignis",
  matcher: "Matcher",
  bedingung: "Bedingung",
  reihenfolge: "Reihenfolge",
  timeout: "Timeout",
  asynchron: "asynchron",
  wirkung: "Wirkung",
  ausloeser: "Auslöser (source)",
  settingsZeile: "Eingetragen in settings.json",
  claudeMdZeile: "In CLAUDE.md beschrieben",
  claudeMdFehlt: "in CLAUDE.md nicht aufgeführt",
  selbsttest: "Probe-Lauf",
  probeNichtGelaufen: "Probe nicht gelaufen: {grund}",
  probeErgebnis: "Beendet mit {exit} nach {ms} ms, {bytes} Bytes Ausgabe",

  // Commands, Skills, Rules
  ruftAuf: "Ruft auf",
  dateienImOrdner: "Dateien",
  lizenzDatei: "Lizenz",
  titelZeile: "Titel",
  anlass: "Anlass",
  tokenJeSitzung: "Token je Sitzung",
  verweise: "Verweise",
  verweisFehlt: "Ziel fehlt",

  // Backup und Commits
  repo: "Repo",
  branch: "Branch",
  sync: "Sync",
  ungesichert: "Ungesichert",
  letzterCommit: "Letzter Commit",
  massnahme: "Maßnahme",
  commit: "Commit",
  betreff: "Betreff",
  autor: "Autor",
  dateienImCommit: "Dateien",
  nurHarness: "Nur Harness",
  remoteLokal: "Remote-Stand nicht abgefragt (lokal gemessen)",
  remoteLive: "Remote-Stand live abgefragt",

  // Session-Kontext
  summe: "Summe",
  tokenSchaetzung: "≈ {n} Token (geschätzt: Bytes ÷ 3,6)",
  ausserhalbWorkspace: "Außerhalb dieses Workspace",
  ausserhalbNichtGemessen: "~/.claude/ wird ebenfalls in jede Sitzung geladen, ist hier aber nicht gemessen — die Summe gilt nur für diesen Workspace.",
  ausgabeZaehlt: "Bei diesen Hooks zählt die Ausgabe, nicht die Datei.",

  // Neu messen (Kopfzeilen-Knopf -- misst wirklich, kopiert nicht)
  neuMessenLaeuft: "Wird neu gemessen — die Seite lädt danach neu.",
  neuMessenFehler: "Neu messen fehlgeschlagen: {grund}",
  // Bewusst OHNE Zahl: der Erklaersatz der Seite zaehlt bereits ("{n}
  // Eintraege auf {skripte} Skripte") -- eine zweite, abweichend gezaehlte
  // Zahl direkt darunter zwingt den Leser zum Rechnen [Kritiker, Runde 3].
  alleInOrdnung: "Alle Einträge in Ordnung.",
  fruehereAnzeigen: "Frühere Sitzungen anzeigen ({n})",

  // Ueberblick / Bruecke (Sitzungen, Auftraege, Arbeitspakete)
  sitzungen: "Sitzungen",
  arbeitspakete: "Arbeitspakete",
  guardTests: "Guard-Selbsttests",
  auftragKopf: "Auftrag an eine Sitzung — wird bei ihrer nächsten Nachricht zugestellt.",
  auftragSenden: "Auftrag senden",
  auftragZugestellt: "Zugestellt beim nächsten Prompt: {datei}",
  auftragAlle: "alle Sitzungen",
  auftragFeld: "Was soll die Sitzung tun?",
  auftragProjekt: "Projekt",
  auftragProjektVorschlag: "passend zur Sitzung: {repo}",
  auftragPaketWaehlen: "Arbeitspaket anheften (optional)",
  auftragPaketAngeheftet: "angeheftet",
  auftragPaketLos: "lösen",
  auftragKeinePakete: "Dieses Projekt hat keine Arbeitspakete.",
  nurLeseBetrieb: "Nur-Lese-Betrieb — Aufträge abgeschaltet.",
  nurServerTitel: "Nur im Server-Betrieb",
  nurServerText: "Diese Ansicht liest und schreibt live. Starte: node dashboard/serve.js — dann http://127.0.0.1:8765",
  schrittVon: "{done} von {total} Schritten",
  offenPunkt: "Offen",
  hakenFehler: "Haken konnte nicht gesetzt werden",
  laedtNoch: "Lädt …",
  nichtErreichbar: "Nicht erreichbar: {grund}",

  // Control Center (Widgets verdichten nach oben [Owner 25.08.2026])
  ccGesundheit: "Trägt alles?",
  ccLogbuch: "Logbuch heute",
  ccDrei: "Deine drei",
  ccHooksGeladen: "Hooks geladen",
  ccMessungFrisch: "Messung vor {n} min",
  ccServerJa: "Server erreichbar",
  ccServerNein: "Kein Server — Seite nur lesbar",
  ccSicherungOk: "Sicherung ohne Lücke",
  ccSicherungLuecke: "Sicherung: {n} mit Lücke",
  ccMessungGelaufen: "Messung gelaufen",
  ccKeinLauf: "Kein automatischer Lauf eingerichtet.",
  ccAllesOffene: "alles Offene",

  // Ueberblick
  brauchtAufmerksamkeit: "Braucht Aufmerksamkeit",
  zuletztGeaendert: "Zuletzt geändert im Harness",
  wasIstDas: "Was ist dieser Harness",
  wasFehlt: "Was dieser Harness nicht hat",
  soLaeuftEineSitzung: "So läuft eine Sitzung",
  ablaufStart: "Sitzungsstart",
  ablaufKontext: "Dauerhaft im Kontext",
  ablaufWerkzeug: "Vor jedem Werkzeugaufruf",
  ablaufEnde: "Sitzungsende",
  ablaufStatusleiste: "Dauerhaft in der Statusleiste",

  // Rohdaten
  schema: "Schema",
  belege: "Belege",
  kontrollprobe: "Kontrollprobe",
  messfehler: "Messfehler",
  anzeigen: "anzeigen",
  zeichenLang: "{n} Zeichen",
};

// ---------------------------------------------------------------------------
// Saetze aus Mess-Codes. Die Messung sagt "leere-vorlage", hier steht der Satz.
// ---------------------------------------------------------------------------

const NOTIZ = {
  "leere-vorlage":       "Noch nichts erhoben — die Datei trägt nur die leere Vorlage.",
  "keine-datei":         "Die Datei existiert nicht.",
  "nicht-lesbar":        "Die Datei konnte nicht gelesen werden: {grund}",
  "kein-git":            "Git ist nicht verfügbar — der Sicherungsstand konnte nicht gemessen werden.",
  "kein-remote":         "Kein Fernziel eingerichtet. Die Arbeit liegt nur auf dieser Platte.",
  "nicht-abgefragt":     "Nicht abgefragt (lokal gemessen).",
  "abweichung-claudemd": "Steht in settings.json, ist aber in CLAUDE.md nicht aufgeführt.",
};

const ZUTUN_ART = {
  "checkbox":            "offener Punkt",
  "offen-ueberschrift":  "offener Abschnitt",
  "offen-inline":        "als offen markiert",
  "platzhalter":         "Platzhalter",
  "leere-vorlage":       "leere Vorlage",
  "drift":               "Abweichung",
};

// ---------------------------------------------------------------------------
// fuellen("… {n} …", {n: 8}) -> "… 8 …"
// Ein fehlender Platzhalter wird NICHT stillschweigend zu "undefined", sondern
// bleibt sichtbar stehen -- damit ein Test ihn findet statt der Nutzer.
// ---------------------------------------------------------------------------

function fuellen(vorlage, werte) {
  if (typeof vorlage !== "string") return "";
  return vorlage.replace(/\{(\w+)\}/g, function (ganz, schluessel) {
    const wert = werte && werte[schluessel];
    if (wert === undefined || wert === null) return ganz;
    return String(wert);
  });
}

// Zahl mit deutschem Tausenderpunkt.
function zahl(n) {
  if (typeof n !== "number" || !isFinite(n)) return "—";
  return n.toLocaleString("de-DE");
}

// Bytes lesbar. Einheiten sind erlaubte Abkuerzungen.
function bytes(n) {
  if (typeof n !== "number" || !isFinite(n)) return "—";
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1).replace(".", ",") + " KB";
  return (n / (1024 * 1024)).toFixed(1).replace(".", ",") + " MB";
}

// Datum: "22.08.2026, 23:14". Kein "vor 3 Std." -- eine feste Zeit altert ehrlich,
// eine relative Zeit wird in einer statischen Datei mit jedem Tag falscher.
function datum(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

module.exports = {
  VERBOTEN, SEITEN, NAVIGATION, TABGRUPPEN, STATUS, ART, ART_BESCHREIBUNG,
  DATEITYP, DATEITYP_ALLGEMEIN,
  WIRKUNG, LADEART, KANTE, QUELLE, GIT, LEER, UI, NOTIZ, ZUTUN_ART,
  fuellen, zahl, bytes, datum,
};
