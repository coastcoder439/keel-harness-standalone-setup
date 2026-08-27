// WORTE -- der EINZIGE Ort, an dem deutsche Beschriftungen stehen. Eine Liste,
// die ein Test durchgehen kann und ein Mensch in fuenf Minuten liest.
//
// REGEL FUER DIESE DATEI
// 1. Kein deutsches Label ausserhalb dieser Datei -- weder in styles.js noch in
//    shell.js noch im Browser-Skript. Wer eins braucht, holt es hier.
// 2. Die MESSUNG liefert Codes, keine Saetze. Aus "notizCode: leere-vorlage" wird
//    hier ein deutscher Satz -- nicht in measure.js.
// 3. Harness-Begriffe bleiben englisch: Hooks, Skills, Commands, Rules, Agents, MCP,
//    settings.json, CLAUDE.md, SessionStart, PreToolUse, Stop, matcher. Das sind die
//    Namen der Ordner und Schluessel auf der Platte; eine Eindeutschung liest sich
//    deutsch, aber niemand erkennt daran noch das Verzeichnis.
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

// Seiten -- Name, Zweck-Satz, Ordner dahinter. Der Zweck-Satz steht als erste
// Zeile der Hauptflaeche; {n}-Platzhalter fuellt fuellen() mit gemessenen Zahlen.

const SEITEN = {
  ueberblick: {
    // Owner 25.08.2026 abends: der Ueberblick IST das Control Center --
    // Widgets verdichten nach oben (Gesundheit, die drei wichtigsten
    // Aufgaben, Logbuch/Automatik, Sitzungen, Auftrag), die Reiter darunter
    // verbreitern. Kennung bleibt "ueberblick" (Adressen, Eintraege).
    name: "Control Center",
    ort: null,
    // Ein echter Satz, keine Aneinanderreihung von Widget-Namen [Befund
    // 26.08.2026: der erste Text der Seite erklaerte nichts].
    zweck: "Hier siehst du auf einen Blick, ob dein Harness trägt, was deine Aufmerksamkeit braucht und wer gerade woran arbeitet. Die Einzelheiten stehen in den Reitern links.",
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
    zweck: "Hooks sind Skripte, die Claude Code bei Ereignissen ausführt. Hier {n} Hook-Einträge auf {skripte} Skripte, und als letzte Zeile die statusLine.",
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
  // [Owner 25.08.2026: "was automatisch durchlaeuft, zu welcher Uhrzeit ...
  // Conjobs, Loops ... fehlt komplett im Harness als Rubrik"] -- gehoert zum
  // Harness, weil es dort laeuft, plus Widget im Control Center.
  automatik: {
    name: "Automatik",
    ort: null,
    zweck: "Was ohne dein Zutun läuft — geplante Aufgaben, Cron-Jobs, Loops. Je Lauf: wann zuletzt, wann wieder.",
    icon: "refresh",
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
    zweck: "Die Werkbank und was unter user-projects/ liegt — {n} Repos, {doku} Dokumente. {ohne} ohne Wegweiser.",
    icon: "folder-open",
  },
  backup: {
    name: "Sicherung",
    ort: "git je Repo",
    zweck: "Liegt die Arbeit auch außerhalb dieses Rechners? {n} Repos geprüft, {offen} mit Lücke.",
    icon: "hard-drive",
  },
  commits: {
    name: "Verlauf",
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
// Reiter [Owner 25.08.2026: das Side-Menue darf keine Mess-Taxonomie sein].
const TABGRUPPEN = {
  harness: {
    name: "Harness",
    icon: "terminal",
    ort: ".claude/",
    seiten: ["hooks", "commands", "skills", "rules", "kontext", "werkzeuge", "automatik"],
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

// Letzter Ausweg: eine Datei ohne Beschreibung und ohne bekannte Rolle bekommt
// wenigstens eine Aussage ueber ihre ART -- ehrlicher als eine leere Zeile.
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

// In der LISTE steht nur das Wort: kurzes, festes Vokabular gleicher Laenge.
// Der volle Satz und "(exit 2)" stehen im Detail, nicht in einem Chip.
// Was ein Ereignis BEDEUTET -- ohne diese Saetze steht ueber einer Gruppe nur
// ein technischer Name, den niemand kennt [Owner 26.08.2026: "Keine
// Erklaerung, was eine SessionStart, was eine PreToolUse"].
const EREIGNIS_ERKLAERUNG = {
  SessionStart: "Läuft einmal, wenn eine neue Sitzung beginnt — hier wird ihr mitgegeben, was sie wissen muss.",
  UserPromptSubmit: "Läuft bei jeder Nachricht, die du schickst, bevor die Sitzung sie sieht.",
  PreToolUse: "Läuft vor jedem Werkzeugaufruf — nur hier kann etwas verhindert werden, bevor es passiert.",
  PostToolUse: "Läuft nach einem Werkzeugaufruf, wenn die Wirkung schon eingetreten ist.",
  Stop: "Läuft, wenn die Sitzung ihre Antwort abschließt.",
  statusLine: "Kein Ereignis: dieses Skript zeichnet dauerhaft die Statusleiste.",
};

const WIRKUNG = {
  blockiert: { wort: "blockiert", erklaerung: "Dieser Hook kann einen Werkzeugaufruf verhindern (exit 2)." },
  meldet:    { wort: "meldet",    erklaerung: "Dieser Hook schreibt eine Meldung, verhindert aber nichts." },
  kontext:   { wort: "ergänzt Kontext", erklaerung: "Dieser Hook legt der Sitzung Text vor, den sie mitliest (ergänzt den Sitzungskontext)." },
};

// Wann etwas geladen wird -- ueberall gleich formuliert.
// Was eine Sorte Kontext IST und wann sie laedt [Owner-Wunsch W14: "Keine
// Erklaerung, was eine SessionStart, was eine PreToolUse"]. Ueber einer Gruppe
// stand bis hierher nur ihr Name.
const KONTEXTART_ERKLAERUNG = {
  "Wurzel-Kontext": "Die CLAUDE.md an der Wurzel — sie liegt in jeder Sitzung von der ersten Nachricht an im Kontext und kostet ihre Token bei jeder einzelnen Anfrage.",
  "Dauer-Regel": "Regeln unter .claude/rules/ — sie laden mit jeder Sitzung mit und gelten ohne Aufruf; was hier steht, kostet dauerhaft Platz im Kontextfenster.",
  "Hook-Skript": "Skripte, die bei einem Ereignis laufen und Text in die Sitzung legen. Nicht das Skript kostet Kontext, sondern was es ausgibt.",
};

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

// Git-Zustand je Datei. "gesichert" ist dem GEPUSHTEN Zustand vorbehalten:
// eine Datei kann committet und trotzdem nirgends gepusht sein, und ein Wort,
// das Sicherheit verspricht, wo keine ist, ist schlimmer als gar kein Wort.
const GIT = {
  getrackt:   "von Git verfolgt",
  ungetrackt: "nicht in Git",
  ignoriert:  "von Git ausgeschlossen",
  unbekannt:  "Git nicht verfügbar",
};

// Leerzustaende: Titel, Erklaerung, Handlung. Einer ohne Handlung ist eine Sackgasse.

const LEER = {
  zutun: {
    titel: "Nichts offen",
    text: "Alle geprüften Bereiche melden In Ordnung.",
    handlung: { wort: "Projekte ansehen", ziel: "seite:projekte" },
  },
  hooks: {
    titel: "Keine Hooks eingetragen",
    text: "Hooks stehen in .claude/settings.json unter hooks → Ereignis → command. Ohne sie läuft bei Werkzeugaufrufen nichts automatisch mit.",
    handlung: { wort: "settings.json öffnen", ziel: "datei:.claude/settings.json" },
  },
  commands: {
    titel: "Keine Commands",
    text: "Commands sind Markdown-Dateien in .claude/commands/ mit einer description im Frontmatter. Leg dort eine an, dann erscheint sie hier.",
    handlung: { wort: "Ordner im Dateibaum ansehen", ziel: "ordner:.claude/commands" },
  },
  skills: {
    titel: "Keine Skills",
    text: "Skills liegen als .claude/skills/<name>/SKILL.md und laden erst auf Abruf — deshalb kosten sie nichts, solange niemand sie ruft.",
    handlung: { wort: "Ordner im Dateibaum ansehen", ziel: "ordner:.claude/skills" },
  },
  rules: {
    // Kein Vorwurf ohne Ausweg [Kritik-Runde 2, Problem 9]: hier stand
    // "ist das ein leerer Claude Code, kein Harness" -- ein Urteil ueber den
    // Nutzer, ohne ihm zu sagen, was er tun kann.
    titel: "Keine Dauer-Regeln",
    text: "Dauer-Regeln stehen als Markdown in .claude/rules/ und werden in jede Sitzung geladen. Sie sind der Unterschied zwischen einem leeren Claude Code und einem Harness.",
    handlung: { wort: "Ordner im Dateibaum ansehen", ziel: "ordner:.claude/rules" },
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
    handlung: { wort: "Vorlage ansehen", ziel: "datei:docs/packages/TEMPLATE.md" },
  },
  automatik: {
    titel: "Es läuft nichts automatisch",
    text: "Weder geplante Aufgaben noch Cron-Jobs oder Loops sind für diesen Workspace eingerichtet. Sobald etwas läuft, steht es hier mit seinen Zeiten.",
    handlung: { wort: "Start-Skript ansehen", ziel: "datei:dashboard/start-server.cmd" },
  },
  "projekt-sitzungen": {
    titel: "Keine Sitzung an diesem Projekt",
    text: "Eine Sitzung gehört zu einem Projekt, sobald ihre Rolle in docs/08-sessions-rollen.md das Projekt oder ein Arbeitspaket daraus nennt.",
    handlung: { wort: "Rollen ansehen", ziel: "datei:docs/08-sessions-rollen.md" },
  },
  "bridge-sitzungen": {
    titel: "Keine Sitzung sichtbar",
    text: "Sitzungen erscheinen hier, sobald sie Nachrichten mit diesem Workspace-Pfad geschrieben haben.",
    handlung: { wort: "Jetzt neu abfragen", ziel: "live:frisch" },
  },
  verknuepft: {
    titel: null,
    text: "Keine Verknüpfung gefunden — geprüft: settings.json, CLAUDE.md, Commands, Rules-Verweise, Commits.",
    handlung: null,
  },
  allgemein: {
    titel: "Nichts vorhanden",
    text: "Für diesen Bereich hat die letzte Messung nichts gefunden. Wenn du gerade etwas angelegt hast, miss neu.",
    handlung: { wort: "Neu messen", ziel: "mess:neu" },
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
  // Sagt, WAS passiert (Wechsel in die Dateiansicht), nicht wie der Knopf
  // aussieht -- "Maximieren" waere eine Formbeschreibung, kein Versprechen.
  ganzOeffnen: "In voller Breite öffnen",
  // Beantwortet die einzige Frage nach einem gescheiterten Speichern: ist mein
  // Text weg? [Kritik-Runde 2, Problem 2]
  entwurfStehtNoch: "Dein Text steht noch im Feld — nichts ist verloren.",

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
  // ERGEBNIS ZUERST, MESSWERTE DANACH [Kritik-Runde 2, Problem 2]. Vorher:
  // "Beendet mit {exit} nach {ms} ms, {bytes} Bytes Ausgabe" -- drei Messwerte
  // und kein Urteil, für jemanden, der gerade klickte, WEIL er das Urteil nicht
  // kennt. Ein Exit-Code ist die Antwort der Maschine, nicht die des Nutzers.
  probeErgebnis: "Beendet mit {exit} nach {ms} ms, {bytes} Bytes Ausgabe",
  probeBestanden: "Bestanden",
  probeDurchgefallen: "Durchgefallen",
  probeMesswerte: "({ms} ms, Rückgabewert {exit})",

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
  auftragAn: "An",
  auftragProjekt: "Projekt",
  auftragText: "Auftrag",
  auftragProjektVorschlag: "passend zur Sitzung: {repo}",
  // Zahl im Label: die Auswahl zeigt nur OFFENE Pakete -- die Kappung wird
  // benannt statt stumm zu geschehen.
  auftragPaketWaehlen: "Arbeitspaket ({n} offen)",
  auftragKeinPaket: "— keins —",
  auftragKeinePakete: "Dieses Projekt hat kein offenes Arbeitspaket.",
  auftragLaeuft: "Wird gesendet …",
  auftragLeer: "Schreib zuerst, was die Sitzung tun soll.",
  sitzungLaeuft: "arbeitet gerade",
  sitzungOhneTitel: "Sitzung ohne Namen",
  fruehereVerbergen: "Frühere Sitzungen verbergen",
  nichtErreichbarHilfe: "Läuft der Server? Starten mit: node dashboard/serve.js",
  selbsttestLaeuft: "läuft …",
  selbsttestHinweis: "Wähle einen Guard, um seinen Selbsttest zu starten.",
  // Projekt-Uebersicht [Owner 27.08.2026]: Paketstand und Sitzung statt Dokumentzahl.
  projektPaketeOffen: "{offen} von {gesamt} Arbeitspaketen offen",
  projektPaketeAlleFertig: "{gesamt} Arbeitspakete, alle abgeschlossen",
  projektPaketeEins: "1 Arbeitspaket, {stand}",
  projektKeinePakete: "Kein Arbeitspaket",
  projektKarteSicher: "gesichert",
  projektKarteLuecke: "Sicherungslücke",
  projektKartePakete: "{done} von {total} Paketen abgeschlossen",
  projektKarteOhnePakete: "Kein Arbeitspaket",
  projektFilterAktive: "Mit Sitzung",
  projektFilterPakete: "Mit offenen Paketen",
  projektFilterLuecke: "Mit Sicherungslücke",
  werkbankUnter: "Die Werkbank selbst — hier liegen die Arbeitspakete dieses Workspace.",
  projektSitzungen: "{n} Sitzungen arbeiten hier",
  projektSitzungEine: "1 Sitzung arbeitet hier",
  projektKeineSitzung: "Keine Sitzung zugeordnet",
  projektSitzungenTitel: "Sitzungen an diesem Projekt",
  // Die drei Reiter der Projektseite [01-product.md].
  projektReiterPakete: "Arbeitspakete",
  projektReiterSicherung: "Sicherung",
  projektReiterVerlauf: "Verlauf",
  projektKeinVerlauf: "Für dieses Projekt liegt kein Commit in der Messung.",
  projektKeineSicherung: "Dieses Verzeichnis ist kein Git-Repository — die Arbeit ist nirgends versioniert.",
  projektDokumenteZahl: "{n} Dokumente",
  kanbanOffen: "Offen",
  kanbanArbeit: "In Arbeit",
  kanbanFertig: "Abgeschlossen",
  kanbanNaechster: "Nächster Schritt",
  kanbanLeer: "Nichts in dieser Spalte.",
  automatikLaeufe: "Geplante Läufe",
  automatikArt: "Geplante Aufgabe des Betriebssystems",
  automatikEinrichten: "Der Dashboard-Server kann bei jeder Anmeldung starten. Dafür liegt bereit:",
  automatikNichtLesbar: "Die Aufgabenplanung dieses Systems konnte nicht gelesen werden — es kann trotzdem etwas laufen.",
  nurLeseBetrieb: "Nur-Lese-Betrieb — Aufträge abgeschaltet.",
  nurServerTitel: "Nur im Server-Betrieb",
  nurServerText: "Diese Ansicht liest und schreibt live. Starte: node dashboard/serve.js — dann http://127.0.0.1:8765",
  schrittVon: "{done} von {total} Schritten",
  offenPunkt: "Offen",
  // Nennt den Grund UND den naechsten Schritt -- "Haken konnte nicht gesetzt
  // werden" allein liess offen, ob der Schritt jetzt gilt [Kritik-Runde 2].
  hakenFehler: "Der Haken wurde nicht gespeichert — der Schritt steht unverändert.",
  laedtNoch: "Lädt …",
  nichtErreichbar: "Der Dashboard-Server antwortet nicht: {grund}",

  // Live-Stand [Kritik-Runde 2, Problem 6]: eine Zahl ohne Zeitpunkt ist eine
  // Behauptung. Jede Live-Sektion sagt, wann sie zuletzt gemessen hat.
  standUm: "Live abgefragt {zeit} Uhr",
  standUnbekannt: "Stand unbekannt",
  liveAktualisieren: "Jetzt neu abfragen",
  nochmalVersuchen: "Nochmal versuchen",

  // Schutz vor dem Unumkehrbaren [Kritik-Runde 2, Problem 4]: die Rueckfrage
  // nennt die Empfaenger, statt nur "alle" zu sagen.
  auftragAlleFrage: "Diesen Auftrag an alle {n} laufenden Sitzungen senden? Er lässt sich nicht zurückholen. Empfänger:",
  auftragStehtNoch: "Dein Auftrag steht noch im Feld.",
  auftragVerlauf: "Zuletzt gesendet",

  // Gruppen auf "Zu tun". Beide in derselben Form -- vorher stand "gemessen"
  // klein neben "Aus Dokumenten gezogen" gross, zwei Sprachen fuer dieselbe
  // Rangstufe [Kritik-Runde 2, Problem 7]. Und beide waren deutsche Literale
  // mitten im Code, statt hier zu stehen (labels.js Regel 1).
  gruppeGemessen: "Aus der Messung",
  gruppeDokumente: "Aus Dokumenten",

  // Tastaturwege, mit „?" abrufbar [Kritik-Runde 2, Problem 12]. Ein Satz,
  // weil er in der Meldungsleiste steht — kein eigenes Fenster für sechs Zeilen.
  tastenUebersicht: "Strg+K Suche über alles · / ins Suchfeld · J und K blättern · ← → klappen im Dateibaum · Strg+B Seitenleiste · Strg+Enter sendet den Auftrag · Esc schließt",
  tastenTitel: "Tastaturwege anzeigen (Taste ?)",
  // Sagt, was passiert ist UND wie man es zurücknimmt — ein Schritt in einer
  // Datei kennt kein Rückgängig, aber derselbe Klick stellt ihn wieder her.
  hakenGesetzt: "Schritt als erledigt eingetragen — derselbe Klick nimmt es zurück.",
  hakenEntfernt: "Haken entfernt — derselbe Klick setzt ihn wieder.",
  // Eine Anfrage ohne Zeitgrenze hinterlässt eine tote Oberfläche ohne Erklärung.
  zeitUeberschritten: "Der Server hat 30 Sekunden lang nicht geantwortet. Läuft er noch?",
  // Schreiben und Neumessen sind zwei Vorgänge. Scheitert der zweite, ist die
  // Arbeit trotzdem sicher — und genau das muss dastehen [Kritik-Runde 3].
  gespeichertMessungFehlt: "Gespeichert. Die Neumessung ist fehlgeschlagen.",
  gespeichertMessungFehler: "Gespeichert. Die Neumessung ist fehlgeschlagen: {grund}",
  anzeigeVeraltet: "Deine Änderung ist auf der Platte — nur die angezeigten Zahlen sind jetzt veraltet. Der Knopf „Neu messen“ holt sie nach.",
  grundUnbekannt: "Grund unbekannt",

  // Control Center (Widgets verdichten nach oben [Owner 25.08.2026])
  // Titel, die sagen was drinsteht -- keine Kunstworte, die man erklaeren
  // muesste (labels.js Regel 5) [Befund 26.08.2026].
  ccGesundheit: "Trägt der Harness?",
  ccLogbuch: "Automatik heute",
  ccDrei: "Braucht deine Aufmerksamkeit",
  // Wort und Zahl beschreiben dasselbe: die Zeile nennt, was gemessen wurde.
  ccHooksOhneBefund: "{n} Hooks eingetragen, keiner mit Befund",
  ccHooksKeine: "Keine Hooks gemessen",
  ccMessungFrisch: "Zuletzt gemessen vor {dauer}",
  ccMessungUnbekannt: "Messzeit unbekannt",
  ccServerJa: "Server erreichbar",
  ccServerNein: "Kein Server — Seite nur lesbar",
  ccSicherungOk: "Alle {n} Repos gesichert",
  ccSicherungLuecke: "{n} Repos mit Sicherungslücke",
  ccSicherungLueckeEins: "Ein Repo mit Sicherungslücke",
  ccSicherungUnbekannt: "Sicherung nicht gemessen",
  ccMessungGelaufen: "Messung gelaufen",
  ccKeinLauf: "Es läuft nichts automatisch.",
  ccAutomatikZeigen: "Automatik ansehen",
  ccAllesOffene: "Alles Offene ansehen",
  // Der Weg in die Tiefe im Kopf jedes Widgets [01-product.md: "nichts
  // existiert nur oben"].
  ccZuHarness: "Harness",
  ccZuAutomatik: "Automatik",
  ccZuProjekte: "Projekte",
  ccZuZutun: "Alles Offene",
  ccLaufZuletzt: "zuletzt",
  ccLaufNaechster: "als Nächstes",
  ccKeinNaechster: "Kein Lauf geplant — nichts startet von selbst.",
  ccAufgabeErledigt: "Erledigt: {was}",
  // EINZAHL IST KEIN SONDERFALL: "vor 1 Minuten" braucht eine eigene Fassung.
  dauerGerade: "einem Augenblick",
  dauerMinuteEins: "einer Minute",
  dauerMinuten: "{n} Minuten",
  dauerStundeEins: "einer Stunde",
  dauerStunden: "{n} Stunden",
  dauerTagEins: "einem Tag",
  dauerTage: "{n} Tagen",
  schrittVonEins: "1 von {total} Schritten",
  schrittEinerVonEinem: "der eine Schritt ist erledigt",

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
  EREIGNIS_ERKLAERUNG, KONTEXTART_ERKLAERUNG,
  DATEITYP, DATEITYP_ALLGEMEIN,
  WIRKUNG, LADEART, KANTE, QUELLE, GIT, LEER, UI, NOTIZ, ZUTUN_ART,
  fuellen, zahl, bytes, datum,
};
