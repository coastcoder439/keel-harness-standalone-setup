#!/usr/bin/env node
// SessionStart-Hook: gibt jeder neuen Sitzung die Rollen-Tabelle aus
// docs/08-sessions-rollen.md mit -- damit Sitzungen voneinander wissen,
// ohne dass jemand einen Befehl tippt. Plus die Melde-Regel.
//
// Bewusst kurz gehalten: laeuft in JEDER Sitzung, kostet also dauerhaft Kontext.
// Nur Titel + Ebene + Kurzzweck, kein Fliesstext.

const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const WURZEL = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..");
const QUELLE = path.join(WURZEL, "docs", "08-sessions-rollen.md");
const MAX_ZWECK = 110; // Zeichen je Zweck-Spalte

// SessionStart feuert bei VIER Anlaessen: startup · resume · clear · compact.
// Bis zum 03.08.2026 las dieses Skript die Hook-Eingabe gar nicht und schickte
// darum bei JEDEM davon "/i-have-adhd" erneut in den Gespraechsverlauf -- also
// auch mitten in der Arbeit bei jedem Auto-Compact, ohne dass ein Mensch etwas
// getippt hatte. Bei zwei Anlaessen kurz hintereinander doppelt.
// [Anlass: der Befehl feuerte doppelt hintereinander, ohne Nutzereingabe.]
//
// Die Rollen-Tabelle bleibt bei ALLEN vier richtig -- nach einem Compact ist sie
// aus dem Fenster und wird gebraucht. Nur der Slash-Befehl darf sich nicht
// wiederholen: er ist eine Nutzer-Anweisung, und die gilt fuer die ganze Sitzung.
function eingabe() {
  try {
    const roh = fs.readFileSync(0, "utf8");
    const wert = JSON.parse(roh);
    return wert && typeof wert === "object" ? wert : {};
  } catch {
    return {}; // keine Eingabe lesbar -> unten als "nicht startup" behandelt
  }
}

function anlass(daten = eingabe()) {
  return typeof daten.source === "string" ? daten.source : "";
}

// Der Befehlsindex (Paket P6, D17): wo alles liegt, was erlaubt ist, wie der Weg heisst. Er wird bei JEDEM Anlass
// geladen (nach einem Compact ist er aus dem Fenster und wird gebraucht) und aus den Regeln der Waechter erzeugt
// (harness-core/guards/command-index.mjs), nie von Hand gepflegt. Gelingt das nicht, wird es gemeldet wie eine
// unlesbare Rollen-Datei, nicht still uebergangen: eine Sitzung ohne Index laeuft sonst blind in Sperren.
async function ladeBefehlsindex(sitzungsId) {
  try {
    const modul = await import(pathToFileURL(path.join(__dirname, "..", "harness-core", "guards", "command-index.mjs")).href);
    return { text: modul.renderCompact(modul.buildIndex({ root: WURZEL, sessionId: sitzungsId })) };
  } catch (fehler) {
    return { warnung: "Befehlsindex nicht erzeugbar (harness-core/guards/command-index.mjs): " + ((fehler && fehler.message) || fehler) };
  }
}

// Baut einen sprechenden Fehler fuer ein vorhandenes, aber nicht lesbares
// Rollen-/Notiz-Artefakt. [Fund 419, 09.09.2026]
function unlesbar(pfad, art, fehler) {
  let rel;
  try { rel = path.relative(WURZEL, pfad) || pfad; } catch { rel = pfad; }
  const meldung = new Error(
    `${art} ${rel} existiert, ist aber nicht lesbar (${fehler.code || fehler.message})`);
  meldung.code = "SESSION_ROLES_UNLESBAR";
  return meldung;
}

function zeilen() {
  let text;
  try {
    text = fs.readFileSync(QUELLE, "utf8");
  } catch (fehler) {
    // [Fund 419] Eine FEHLENDE Datei (frischer Nachbau) bleibt still; eine
    // EXISTIERENDE, aber unlesbare/korrupte Datei wird laut gemeldet statt
    // still verschluckt -- sonst startet die Sitzung ohne Rollen, ohne dass es
    // jemand bemerkt. ENOENT = fehlt (still), jeder andere Lesefehler = melden.
    if (fehler.code === "ENOENT") return null;
    throw unlesbar(QUELLE, "Rollen-Datei", fehler);
  }
  const treffer = [];
  for (const z of text.split("\n")) {
    // Nur Datenzeilen der Rollen-Tabelle: | **Titel** | Ebene | Zweck | ... |
    if (!z.startsWith("|") || z.includes("---")) continue;
    const sp = z.split("|").map((s) => s.trim()).filter(Boolean);
    if (sp.length < 3) continue;
    const titel = sp[0].replace(/\*\*/g, "").replace(/\s*\(diese[^)]*\)/, "").trim();
    const ebene = sp[1].replace(/\*\*/g, "").trim();
    // Beide historisch belegten Kopfvarianten sind Metadaten, keine Session:
    // `Session-Titel` ist die aktuell ausgelieferte Form, `Session (Titel)`
    // kam in älteren Installationen vor. Die zweite Spalte bestätigt den Kopf,
    // damit eine echte Session mit ähnlich klingendem Namen nicht verschwindet.
    const kopfTitel = titel.toLocaleLowerCase("de-DE").replace(/[()\s_-]+/gu, "");
    const kopfRolle = ebene.toLocaleLowerCase("de-DE").replace(/[()\s_-]+/gu, "");
    if (kopfTitel === "sessiontitel" && /^(rolle|ebene|zweck)$/u.test(kopfRolle)) continue;
    let zweck = sp[2].replace(/\*\*/g, "").replace(/`/g, "").trim();
    if (zweck.length > MAX_ZWECK) zweck = zweck.slice(0, MAX_ZWECK).replace(/\s\S*$/, "") + " …";
    if (titel && ebene) treffer.push(`- ${titel} [${ebene}]: ${zweck}`);
  }
  return treffer.length ? treffer : null;
}

// [Bug-Fix 21.08.2026, Baustelle 2a] Rollen-Load und Antwortform-Skill-Load ENTKOPPELT.
// Vorher stand hier `if (!rollen) process.exit(0)` -- im Solo-Betrieb (keine
// docs/08-sessions-rollen.md) stieg der Hook damit aus, BEVOR der /i-have-adhd-Aufruf
// kam; frische Sessions bekamen den Antwortform-Skill NIE. Jetzt: Rollen-Tabelle nur,
// wenn vorhanden -- aber der Skill-Aufruf laeuft bei jedem "startup" unabhaengig davon.
// Offene Sitzungs-Notizen sichtbar machen [Paket session-messages, Owner-Entscheid
// 27.08.2026: Senden abstellen]. Ohne diesen Block waere "abstellen" ein Verlust --
// Befunde laegen in Dateien, die niemand oeffnet. Gemeldet wird nur Datei, Anzahl und
// juengster Kopf, nie der Inhalt: der Sitzungsstart bleibt billig, gelesen wird auf Zuruf.
function notizen() {
  const dir = path.join(WURZEL, "docs", "session-notes");
  let dateien;
  try {
    dateien = fs.readdirSync(dir).filter((n) => n.endsWith(".md") && n !== "README.md");
  } catch (fehler) {
    // Fehlender Ordner (frischer Nachbau) bleibt still; ein vorhandener, aber
    // unlesbarer Ordner wird gemeldet (Fund 419).
    if (fehler.code === "ENOENT") return null;
    throw unlesbar(dir, "Notiz-Ordner", fehler);
  }
  const raus = [];
  for (const name of dateien.sort()) {
    let text;
    try {
      text = fs.readFileSync(path.join(dir, name), "utf8");
    } catch (fehler) {
      // Zwischen readdir und read verschwunden: ueberspringen. Vorhanden, aber
      // unlesbar: melden statt still ueberspringen (Fund 419).
      if (fehler.code === "ENOENT") continue;
      throw unlesbar(path.join(dir, name), "Notiz-Datei", fehler);
    }
    const koepfe = text.split(/\r?\n/).filter((z) => z.startsWith("## "));
    if (!koepfe.length) continue;
    const letzter = koepfe[koepfe.length - 1].replace(/^##\s*/, "").trim();
    raus.push(`- docs/session-notes/${name}: ${koepfe.length} Notiz(en), zuletzt ${letzter}`);
  }
  return raus.length
    ? ["", "OFFENE SITZUNGS-NOTIZEN (lies die Datei, wenn deine Rolle betroffen ist):", ...raus]
    : null;
}

// Baut die SessionStart-Ausgabe. Trennt drei Zustaende der Rollen-/Notiz-Dateien:
// vorhanden (Inhalt), fehlend (still), unlesbar (gemeldet -> `warnungen`).
function baueAusgabe(quelle, befehlsindex = {}, claudeFassung = null) {
  const ausgabe = { hookEventName: "SessionStart" };
  const warnungen = [];

  let rollen = null;
  try {
    rollen = zeilen();
  } catch (fehler) {
    warnungen.push(fehler.message);
  }

  let rollenText = null;
  if (rollen) {
    let notiz = [];
    try {
      notiz = notizen() || [];
    } catch (fehler) {
      warnungen.push(fehler.message);
    }
    rollenText = [
      "Sitzungs-Rollen dieses Workspace (aus docs/08-sessions-rollen.md, automatisch geladen).",
      "Es arbeiten mehrere Sitzungen parallel im selben Ordner:",
      ...rollen,
      "",
      "MELDE-REGEL [Owner 27.08.2026 -- Nachrichten ZWISCHEN Sitzungen sind abgestellt]:",
      "Aenderst oder findest du einen Fakt, auf dem eine ANDERE Rolle aufbaut (Pfad,",
      "Repo-/Branch-Name, Datenbank, ein Beschluss), dann LEGE IHN AB per /tell-session --",
      "der Befehl schreibt docs/session-notes/<rolle>.md. Kein Senden: die andere Sitzung",
      "liest die Notiz beim naechsten Start. Gehoert eine Aufgabe erkennbar einer anderen",
      "Rolle: dorthin uebergeben, nicht selbst machen. Ueberblick: /session-map",
      ...notiz,
    ].join("\n");
  }

  // initialUserMessage wird wie eine ECHTE Nutzer-Nachricht verarbeitet, Slash-Befehle
  // eingeschlossen (offizielle Doku, Beispiel dort: "/read CLAUDE.md"). Damit laedt der
  // Antwortform-Skill beim Sitzungsstart von selbst.
  //
  // NUR BEI "startup" -- und der Grund ist ein Schaden, kein Schoenheitsfehler
  // [Auftraggeber, 03.08.2026, mit Bildbeleg]: Bis heute las dieses Skript die Hook-Eingabe nicht
  // und feuerte bei ALLEN VIER Anlaessen. Bei "resume" und "compact" faellt der Slash-Befehl
  // damit MITTEN IN EIN LAUFENDES GESPRAECH. Die Sitzung verarbeitet ihn als aktuelle
  // Nutzer-Nachricht -- und beantwortet daraufhin die echte Frage des Menschen nicht mehr.
  // Gemessen im Protokoll dieser Sitzung: sechs Einschuebe, zweimal unmittelbar
  // hintereinander ohne jede Nutzer-Eingabe dazwischen (Positionen 1652/1653 und 1771/1772).
  //
  // Die Rollen-Tabelle bleibt bei allen vier Anlaessen richtig: nach einem Compact ist sie
  // aus dem Fenster und wird gebraucht. Nur der Slash-Befehl darf sich nicht wiederholen --
  // eine Nutzer-Anweisung gilt fuer die ganze Sitzung, nicht pro Ereignis.
  //
  // WARUM NICHT DEN SKILL-TEXT EINBLENDEN: der Aufruf kostet 14 Zeichen, der Volltext
  // 6.848 -- und nur der Aufruf hat das Gewicht einer Nutzer-Anweisung.
  // Feld-Reihenfolge bewusst: der kurze Skill-Aufruf VOR der (wachsenden)
  // Rollen-Tabelle, damit er im gekappten stdoutKopf der Dashboard-Probe sichtbar
  // bleibt -- der Beweis, dass source=startup ankam. Fuers Parsen ist sie egal.
  if (quelle === "startup") ausgabe.initialUserMessage = "/i-have-adhd";

  const kontext = [];
  // P5: eine Claude-Code-Fassung, die das Hook-Feld args nicht kennt, startet die Waechter ohne Programm und laesst jeden
  // Werkzeugaufruf durch. Das steht als ERSTES im Kontext und auf stderr, laut, nicht als Fussnote.
  if (claudeFassung && claudeFassung.state === "old") {
    kontext.push("ACHTUNG WAECHTER AUS -- " + claudeFassung.message + " Bis dahin keine Werkzeugaufrufe, die etwas veraendern; " +
      "dem Owner sofort melden.");
  }
  if (befehlsindex.warnung) {
    warnungen.push(befehlsindex.warnung);
    kontext.push("BEFEHLSINDEX FEHLT -- " + befehlsindex.warnung + ". Ohne ihn findest du den erlaubten Weg erst ueber die Sperre.");
  }
  // Der Index steht vorn: der Host kappt zu langen Hook-Kontext am Ende, und die Rollen-Tabelle ist die wachsende Seite.
  if (befehlsindex.text) kontext.push(befehlsindex.text.trimEnd());
  if (warnungen.length && !(warnungen.length === 1 && befehlsindex.warnung)) {
    // [Fund 419] Ein unlesbares Artefakt wird SICHTBAR gemacht (Kontext + stderr +
    // Exit-Code), nicht wie eine schlicht fehlende Datei still verschluckt.
    kontext.push(
      "SITZUNGS-ROLLEN/HANDOFF UNVOLLSTAENDIG -- eine erwartete Datei existiert, ist",
      "aber nicht lesbar (eine FEHLENDE Datei bliebe still, diese wird gemeldet):",
      ...warnungen.filter((w) => w !== befehlsindex.warnung).map((w) => "- " + w));
  }
  if (rollenText) kontext.push(rollenText);
  if (kontext.length) ausgabe.additionalContext = kontext.join("\n");
  if (claudeFassung && claudeFassung.state === "old") warnungen.unshift(claudeFassung.message);

  return { ausgabe, warnungen };
}

// P5: die Fassung des laufenden Claude Code. Nur in einer Claude-Sitzung (Codex startet denselben Hook ueber seinen Runner):
// AI_AGENT nennt sie (claude-code_2-1-288_agent), sonst einmal claude --version. Ein Fehler beim Lesen entscheidet nichts.
function pruefeClaudeFassung(env = process.env, lesen) {
  try {
    if (env.CLAUDECODE !== "1" && !/^claude-code[_/]/u.test(String(env.AI_AGENT || ""))) return null;
    const regel = require(path.join(__dirname, "..", "harness-core", "system", "claude-version.cjs"));
    const ausUmgebung = regel.runningVersionFromEnv(env);
    if (ausUmgebung && regel.parseClaudeVersion(ausUmgebung)) return regel.judgeClaudeVersion(ausUmgebung);
    const gelesen = (lesen || regel.readClaudeVersion)({ env });
    return gelesen.missing ? null : regel.judgeClaudeVersion(gelesen.text);
  } catch {
    return null;
  }
}

async function main() {
  const daten = eingabe();
  const sitzung = typeof daten.session_id === "string" ? daten.session_id : "";
  const { ausgabe, warnungen } = baueAusgabe(anlass(daten), await ladeBefehlsindex(sitzung), pruefeClaudeFassung());
  const hatInhalt = Boolean(ausgabe.additionalContext) || Boolean(ausgabe.initialUserMessage);

  // Weder Rollen/Warnung noch startup (z.B. resume/compact ohne docs/08) -> still bleiben.
  if (hatInhalt) {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: ausgabe }));
  }

  // "melden": das unlesbare Artefakt steht im additionalContext (dort liest es das Modell) UND auf stderr. Der Exit-Code
  // bleibt 0 [P21, Fund der Pruefrunde P6]: Claude Code wertet das JSON auf stdout nur bei Rueckgabe 0 aus; bei 1 gingen
  // die Zeile "BEFEHLSINDEX FEHLT", die Rollen-Tabelle und /i-have-adhd verloren, also genau das, was gemeldet werden soll.
  for (const warnung of warnungen) process.stderr.write("session-roles: " + warnung + "\n");
  if (!warnungen.length && !hatInhalt) process.exit(0);
}

// Als Hook ausgefuehrt -> laufen; als Modul geladen (Test) -> nur Funktionen bereitstellen.
if (require.main === module) {
  main().catch((fehler) => {
    process.stderr.write("session-roles: " + ((fehler && fehler.message) || fehler) + "\n");
    process.exitCode = 1;
  });
}

module.exports = { zeilen, notizen, baueAusgabe, anlass, ladeBefehlsindex, pruefeClaudeFassung };
