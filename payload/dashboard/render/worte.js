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
    name: "Überblick",
    ort: null,
    // KEIN Text aus der CLAUDE.md des Workspace. Das Dashboard ist Teil des
    // Harness-Bausatzes und laeuft in JEDER Installation -- eine Ueberschrift,
    // die eine bestimmte Zeile in einer bestimmten CLAUDE.md sucht, ist beim
    // naechsten Empfaenger leer oder falsch (gefunden 23.08.2026).
    zweck: "Was in {workspace} installiert ist, wo es liegt und ob es trägt. Gemessen am {gemessen}.",
    icon: "layout-dashboard",
  },
  zutun: {
    name: "Zu tun",
    ort: null,
    zweck: "Was offen ist — mit Grund, Quelle und dem Befehl dazu. {n} aus der Messung, {doku} aus Dokumenten gezogen.",
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
    zweck: "Hooks sind Skripte, die Claude Code bei Ereignissen ausführt — eingetragen in .claude/settings.json. Hier {n} Einträge auf {skripte} Skripte, dazu die statusLine.",
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
    ort: ".claude/rules/keel/",
    zweck: "Rules sind Markdown-Dateien in .claude/rules/keel/ — sie laden in jeder Sitzung, ohne dass jemand sie aufruft. {n} Dateien, zusammen etwa {token} Token.",
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

// Die Seitenleiste: Gruppen in der Reihenfolge des echten Ordnerbaums.
// Die Gruppenwoerter sind KEINE Pfade in Versalien (".CLAUDE/" liest sich als
// Schrei und bricht die Mono-Regel), sondern Ueberschriften; der Pfad steht im
// title jedes Eintrags.
const NAVIGATION = [
  { gruppe: null, eintraege: ["ueberblick", "zutun", "dateien"] },
  { gruppe: "Claude Code", pfad: ".claude/", eintraege: ["hooks", "commands", "skills", "rules"] },
  { gruppe: "Workspace", pfad: null, eintraege: ["kontext", "werkzeuge", "backup", "commits"] },
  { gruppe: "Belege", pfad: null, eintraege: ["rohdaten"] },
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
};

// ---------------------------------------------------------------------------
// Wirkung eines Hooks -- was er tatsaechlich kann, am Skript belegt.
// "kann stoppen" / "meldet nur" der Vorfassung war geraten; das hier ist gemessen.
// ---------------------------------------------------------------------------

const WIRKUNG = {
  blockiert: { wort: "blockiert (exit 2)", erklaerung: "Dieser Hook kann einen Werkzeugaufruf verhindern." },
  meldet:    { wort: "meldet",             erklaerung: "Dieser Hook schreibt eine Meldung, verhindert aber nichts." },
  kontext:   { wort: "ergänzt den Sitzungskontext", erklaerung: "Dieser Hook legt der Sitzung Text vor, den sie mitliest." },
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
    text: "Ohne Dauer-Regeln in .claude/rules/keel/ ist das ein leerer Claude Code, kein Harness.",
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
  keineBeschreibung: "Keine Beschreibung hinterlegt",
  keineBeschreibungQuelle: "Eine Beschreibung stünde in: {ort}",
  dateiinhalt: "Inhalt",
  inhaltZeigen: "Inhalt · {n} Zeilen · {sprache} — anzeigen",
  inhaltGekuerzt: "Gekürzt: erste {n} von {gesamt} Zeilen",
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
  VERBOTEN, SEITEN, NAVIGATION, STATUS, ART, ART_BESCHREIBUNG,
  WIRKUNG, LADEART, KANTE, QUELLE, GIT, LEER, UI, NOTIZ, ZUTUN_ART,
  fuellen, zahl, bytes, datum,
};
