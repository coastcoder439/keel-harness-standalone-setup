#!/usr/bin/env node
// =============================================================================
// ONBOARDING — macht aus dem Paket in einem Zielordner einen laufenden Harness.
//
// WAS DIESES PROGRAMM NICHT TUT, UND WARUM:
//   Es fragt nichts ab. Jede Frage, die es stellen koennte, waere entweder
//   ueberfluessig (dann fragt es nicht) oder eine Entscheidung des Menschen
//   (dann darf es sie nicht heimlich treffen). Was entschieden werden muss,
//   steht am Ende als Liste — mit Handlung, Wirkung und Empfehlung.
//
//   Es meldet sich nicht bei GitHub an, legt kein Remote-Repo an und committet
//   nichts. Eine Anmeldung unter fremdem Konto und das Anlegen eines Repos sind
//   Handlungen des Kontoinhabers, nicht eines Installers.
//
//   Es loescht nichts. Weicht eine vorhandene Datei ab, bleibt sie stehen und
//   die neue Fassung landet als "<datei>.neu" daneben. Mit --ersetzen wird
//   ueberschrieben — aber nur, weil jemand das ausdruecklich getippt hat.
//
// WIEDERHOLBAR: Ein zweiter Lauf darf nichts kaputtmachen. Jeder Schritt meldet
// deshalb angelegt / unveraendert / abweichend / uebersprungen — und ein zweiter
// Lauf auf demselben Ziel besteht idealerweise nur aus "unveraendert".
//
// AUFRUF
//   node onboarding.mjs --ziel <ordner>              einrichten
//   node onboarding.mjs --ziel <ordner> --trocken    jeden Schritt zeigen, nichts schreiben
//   node onboarding.mjs --ziel <ordner> --ersetzen   abweichende Dateien ueberschreiben
//   node onboarding.mjs --paket <ordner>             Paketordner explizit setzen
//   node onboarding.mjs --ohne-seite                 Zustandsseite nicht erzeugen
//   node onboarding.mjs --spur                       bei unerwartetem Fehler den Stack zeigen
//
// RUECKGABE  0 = eingerichtet, nichts offen
//            1 = eingerichtet, aber etwas braucht Aufmerksamkeit (die Punkte
//                stehen am Ende der Ausgabe nochmal)
//            2 = ABBRUCH. Es ist NICHT eingerichtet.
//
// Der Unterschied zwischen 1 und 2 ist der Kern des Vertrags, und er war bis
// zum 02.08.2026 nicht eingehalten: `chmod 555` auf den Zielordner endete mit
// einem rohen EACCES-Stacktrace und Rueckgabewert 1 — demselben Wert, den ein
// GELUNGENER Lauf mit einer Warnung liefert. Wer den Rueckgabewert auswertet,
// konnte einen Totalausfall nicht von "eingerichtet, sieh mal nach" trennen.
//
// Jeder Abbruch nennt jetzt zusaetzlich, WIE WEIT der Lauf kam ("N von M
// Posten"). Das ist kein Schmuck: bricht der Lauf ab, NACHDEM schon Dateien
// geschrieben wurden, ist der Ordner halb eingerichtet — und sieht beim
// naechsten Lauf wie ein gewachsener Bestand aus. Ohne die Zahl sucht niemand
// mehr nach der Luecke.
// =============================================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

// fileURLToPath statt URL.pathname: pathname liefert auf Windows "/C:/…", und daraus
// wird "C:\C:\…" — das Paket wurde nie gefunden, --paket war dort Pflicht.
// [Gemessen 18.08.2026, Windows 11, Node 24: RC 2 "Paket nicht gefunden" ohne --paket.]
const HIER = path.dirname(fileURLToPath(import.meta.url));

// =============================================================================
// 0 — FEHLERFAELLE: ein Absturz ist kein Ergebnis
//
// Gemessen am 02.08.2026, beide Male am unveraenderten Programm:
//   chmod 555 auf den Zielordner  -> roher EACCES-Stacktrace, RC 1, 0 Dateien
//   chmod 555 nur auf .claude/    -> .gitignore geschrieben, dann Stacktrace,
//                                    RC 1, 1 von 35 Posten installiert
// Der zweite Fall ist der gefaehrlichere: ein halb eingerichteter Ordner, ohne
// dass es irgendwo steht. Beim naechsten Lauf sieht er wie ein gewachsener
// Bestand aus — dann meldet jede Datei brav "unveraendert", und die 34
// fehlenden faellt niemandem mehr auf, weil niemand sie vermisst.
// =============================================================================

// Wie weit dieser Lauf gekommen ist. Modulzustand, weil der Fehlerfang
// AUSSERHALB von main() liegt und die Zahl trotzdem nennen koennen muss.
const fortschritt = { erledigt: 0, gesamt: 0, geschrieben: 0 };

// Ein Stacktrace nennt die Zeile IM INSTALLER. Gebraucht wird der Pfad IM ZIEL
// und der Grund in Worten — danach kann jemand handeln (chmod, Platz schaffen,
// anderes --ziel), ohne diesen Quelltext zu lesen.
const FEHLERTEXTE = {
  EACCES: "keine Schreibrechte",
  EPERM: "das Betriebssystem verweigert den Zugriff",
  EROFS: "der Datentraeger ist nur lesend eingehaengt",
  ENOSPC: "kein Platz mehr auf dem Datentraeger",
  EDQUOT: "das Speicherkontingent ist erschoepft",
  ENOENT: "diesen Pfad gibt es nicht",
  ENOTDIR: "ein Teil des Pfades ist kein Ordner",
  EISDIR: "dort liegt ein Ordner, wo eine Datei hingehoert",
  ELOOP: "der Pfad zeigt im Kreis (Symlink-Schleife)",
  ENAMETOOLONG: "der Pfad ist zu lang",
  EMFILE: "zu viele offene Dateien",
  ENFILE: "das System hat keine Dateizeiger mehr frei",
  EBUSY: "die Datei ist gerade in Benutzung",
  ETXTBSY: "die Datei wird gerade ausgefuehrt",
};

function klartext(fehler) {
  const code = fehler && fehler.code;
  const wo = fehler && fehler.path ? ` — ${fehler.path}` : "";
  if (code && FEHLERTEXTE[code]) return `${FEHLERTEXTE[code]}${wo}  [${code}]`;
  if (code) return `${code}${wo}`;
  return String((fehler && fehler.message) || fehler);
}

// Derselbe Satz ohne den Pfad — fuer die Stellen, die den Pfad schon selbst
// nennen. Zweimal derselbe lange Pfad in vier Zeilen liest sich wie zwei
// verschiedene Fehler.
const klartextOhnePfad = (e) => klartext({ code: e && e.code, message: e && e.message });

let spurZeigen = false; // --spur

// EINE Ausgangstuer fuer jeden Abbruch. Sie darf nur mit Rueckgabewert 2
// verlassen werden — sonst ist der Vertrag oben wieder nur eine Behauptung.
// `unerwartet` setzt nur das letzte Netz unten. Ein Abbruch, dessen Text die
// Ursache schon benennt ("Paketdatei ist kein gueltiges JSON: vorlagen/…"),
// darf nicht mit "dieser Fehler war unerwartet" enden — das schickt den
// Empfaenger auf die Suche nach einem Fehler, der gerade erklaert wurde.
function abbruch(text, fehler, unerwartet = false) {
  process.stderr.write(`\nABBRUCH: ${text}\n`);
  if (fortschritt.gesamt) {
    process.stderr.write(
      fortschritt.geschrieben
        ? `\n  Stand: ${fortschritt.erledigt} von ${fortschritt.gesamt} Posten bearbeitet, ` +
          `${fortschritt.geschrieben} Datei(en) geschrieben.\n` +
          `  Der Zielordner ist damit HALB eingerichtet — nicht leer und nicht fertig.\n` +
          `  Erst die Ursache oben beheben, dann DENSELBEN Befehl erneut laufen lassen:\n` +
          `  er ist wiederholbar und ergaenzt nur das Fehlende.\n`
        : `\n  Stand: ${fortschritt.erledigt} von ${fortschritt.gesamt} Posten bearbeitet, ` +
          `im Zielordner wurde nichts geschrieben.\n`
    );
  }
  if (fehler && spurZeigen) process.stderr.write(`\n${fehler.stack || fehler}\n`);
  else if (unerwartet) process.stderr.write(`  (dieser Fehler war unerwartet — --spur zeigt seine Herkunft im Installer)\n`);
  process.exit(2);
}

// =============================================================================
// 1 — WAS WOHIN GEHOERT
//
// Die Liste ist der Vertrag zwischen Paket und Zielordner. Sie steht hier und
// nicht im Paket, damit ein unvollstaendiges Paket auffaellt, statt still ein
// halbes Ergebnis zu erzeugen.
// =============================================================================

// Die Waechter. Jeder ist ohne Nacharbeit portabel: die Hook-Skripte lesen
// CLAUDE_PROJECT_DIR, die uebrigen leiten ihre Wurzel aus dem eigenen Ort ab.
const WAECHTER = [
  "danger-guard.js",
  "git-guard.js",
  "commit-pathspec-guard.js",
  "repo-status.js",
  "session-roles.js",
  "onboarding-start.js", // SessionStart: startet /onboarding, solange CLAUDE.md [AUSFUELLEN] enthaelt
  "projekt-kontext.js",  // SessionStart: fragt beim Start nach Projekt/Rolle (AskUserQuestion)
  "statusline.js",
  "uncommitted-warn.js",
];

const BEFEHLE = ["repo-status.md", "save-work.md", "session-map.md", "tell-session.md", "onboarding.md"];

// Diese vier laden bei JEDEM Sitzungsstart. Sie kosten dauerhaft Kontext und
// sind genau deshalb bewusst kurz gehalten.
const REGELN = ["kein-oneshot.md", "vollstaendigkeit.md", "werkzeuge.md", "ausgabeform.md"];

const SKILLS = [
  ["domain-modeling", ["SKILL.md", "ADR-FORMAT.md", "CONTEXT-FORMAT.md"]],
  ["resolving-merge-conflicts", ["SKILL.md"]],
  // Bis 18.08.2026 fehlte dieser Eintrag: die Dauer-Regel ausgabeform.md und der
  // Start-Hook session-roles.js verwiesen auf einen Skill, den der Installer nie kopierte.
  ["i-have-adhd", ["SKILL.md"]],
];

const ZUSTAND = ["zustand.js", "messen.js", "einordnen.js", "regeln.js", "rendern.js", "README.md"];

const BEILEGER = [
  "10-nachbau-anleitung.md",
  // Zwei der vier Dauer-Regeln verweisen in ihrem Kopf auf diese Langfassungen.
  // Fehlen sie, fuehrt die Regel ins Leere und wird beim ersten Zweifel ignoriert.
  "11-vollstaendigkeitspruefung.md",
  "12-werkzeug-beschaffung.md",
  // Ablage-Vorlage fuer den Onboarding-Schritt "Werkzeug-Landschaft" (Schritt 3):
  // vier Rubriken CLI/MCP/API/Zugaenge. Wird nach docs/ kopiert, dort traegt der
  // Onboarding-Befehl die erkannten Werkzeuge ein.
  "werkzeug-landschaft.md",
];

const LIZENZEN = ["LICENSE-mattpocock-skills.txt", "LICENSE-i-have-adhd.txt"];

const GITIGNORE_MARKE_AUF = "# >>> harness-eigenbau (vom Onboarding gesetzt) >>>";

// =============================================================================
// 2 — BERICHT
//
// Jeder Schritt schreibt genau eine Zeile. Der Zustand steht vorn, damit die
// Ausgabe scanbar ist und ein "abweichend" nicht in Fliesstext untergeht.
// =============================================================================
// DER TROCKENLAUF HAT KEINE VERGANGENHEIT.
//
// Bis 02.08.2026 stand hier EIN Wort je Zustand, im Perfekt. Gemessen:
//   --trocken --ersetzen  ->  "ersetzt  .claude/danger-guard.js
//                              die vorherige Fassung ist damit weg"
//                             md5 vorher == md5 nachher, die Datei stand unangetastet da
//   --trocken (frisches Ziel) -> 35 Zeilen "angelegt", 0 Dateien geschrieben
// und 160 Zeilen weiter, in derselben Ausgabe:
//   "Trockenlauf beendet — es wurde nichts geschrieben."
//
// Zwei Saetze einer Ausgabe, die sich widersprechen, kosten das Vertrauen in
// BEIDE — und der Trockenlauf ist genau das Werkzeug, mit dem jemand VOR dem
// Schreiben nachsieht. Ein Probelauf, dem man nicht glaubt, wird uebersprungen.
//
// Deshalb traegt jeder Zustand hier zwei Woerter: eines fuer den echten Lauf
// (was geschehen IST), eines fuer den Trockenlauf (was geschehen WUERDE). Wer
// einen Zustand ergaenzt, muss beide angeben — ein fehlendes Wort faellt beim
// Tippen auf, ein vergessenes `trocken ? …` erst beim Empfaenger.
const ZUSTAENDE = {
  angelegt: ["angelegt", "wuerde anlegen"],
  ergaenzt: ["ergaenzt", "wuerde ergaenzen"],
  unveraendert: ["unveraendert", "unveraendert"], // Zustand, keine Handlung
  abweichend: ["ABWEICHEND", "ABWEICHEND"], // dito
  ersetzt: ["ersetzt", "wuerde ersetzen"],
  uebersprungen: ["uebersprungen", "uebersprungen"],
  fehlt: ["FEHLT", "FEHLT"],
  ok: ["geprueft", "geprueft"],
  achtung: ["ACHTUNG", "ACHTUNG"],
};

// Der Laufmodus als Modulzustand: melden() wird an ueber zwanzig Stellen
// gerufen. Wuerde jede ihn durchreichen, waere genau die eine vergessene
// Stelle wieder eine Falschaussage im Trockenlauf — und zwar die, die niemand
// testet. Einmal gesetzt in main(), danach nur noch gelesen.
const lauf = { trocken: false };

// Die Spalte richtet sich nach dem laengsten Wort des jeweiligen Modus:
// echt = 13 ("uebersprungen"), trocken = 16 ("wuerde ergaenzen"). GERECHNET,
// damit ein neues Wort die Ausrichtung nicht zerlegt.
const spaltenbreite = () =>
  Math.max(...Object.values(ZUSTAENDE).map((w) => w[lauf.trocken ? 1 : 0].length));

// Der Einzug der Fortsetzungszeilen eines mehrzeiligen Zusatzes. Wer einen
// solchen Zusatz baut, der AUCH im Trockenlauf erscheinen kann, muss ihn hier
// holen statt Leerzeichen zu tippen — im Trockenlauf ist die Spalte drei
// Zeichen breiter, und feste Leerzeichen stehen dann versetzt.
const fortsetzung = () => " ".repeat(2 + spaltenbreite() + 4);

// Was Aufmerksamkeit braucht, wird gesammelt und am Ende NOCHMAL genannt. In
// einer langen Ausgabe geht eine einzelne Warnung sonst zwischen sechzig Zeilen
// "unveraendert" unter — und der Rueckgabewert 1 haette keine sichtbare Ursache.
//
// MIT ZUSATZ, nicht nur mit Titel. Bis 02.08.2026 wurde hier ausschliesslich
// `text` gesichert. In der Schlussliste stand dann "· .claude/danger-guard.js" —
// eine Zeile, die den Namen einer Datei nennt und sonst nichts. Der Satz, der
// erklaert, WAS mit ihr ist ("nichts ueberschrieben, neue Fassung liegt als .neu
// daneben"), stand nur oben im Lauf und wurde nie wiederholt. Wer ans Ende
// scrollt — und das tun alle —, las einen Dateinamen ohne Befund.
const achtungen = [];

function melden(zustand, text, zusatz) {
  const paar = ZUSTAENDE[zustand];
  const wort = paar ? paar[lauf.trocken ? 1 : 0] : zustand;
  const breite = spaltenbreite();
  // 2 Einzug + Spalte + 4 = der Einzug der Fortsetzungszeilen. Im echten Lauf
  // ergibt das 19 — dieselben 19, die mehrzeilige Zusatztexte weiter unten fest
  // eingebaut haben. Die stehen alle in Proben, die im Trockenlauf gar nicht
  // laufen; deshalb faellt die breitere Trocken-Spalte dort nicht auseinander.
  const einzug = " ".repeat(2 + breite + 4);
  process.stdout.write(`  ${wort.padEnd(breite)}  ${text}${zusatz ? `\n${einzug}${zusatz}` : ""}\n`);
  if (zustand === "abweichend" || zustand === "fehlt" || zustand === "achtung") achtungen.push({ text, zusatz: zusatz || null });
}

const abschnitt = (nr, titel) => process.stdout.write(`\n[${nr}] ${titel}\n`);

// =============================================================================
// 3 — DATEI-WERKZEUGE
//
// Eine Datei wird nie stillschweigend ueberschrieben. Der Unterschied zwischen
// "unveraendert" und "abweichend" ist die ganze Sicherheit dieses Programms:
// Wer den danger-guard an seinen eigenen Aufbau angepasst hat, verliert die
// Anpassung nicht, nur weil jemand das Onboarding zweimal laufen laesst.
// =============================================================================

// JEDER Schreibvorgang dieses Programms geht durch diese eine Stelle. Sonst
// muesste jeder Aufrufer den Fehlerfall selbst behandeln — und der erste, der
// es vergisst, bringt den rohen Stacktrace zurueck, gegen den Abschnitt 0
// gebaut ist. Hier wird auch mitgezaehlt, was tatsaechlich auf der Platte
// gelandet ist; diese Zahl entscheidet, ob ein Abbruch "nichts geschrieben"
// oder "halb eingerichtet" meldet.
function schreiben(pfad, inhalt) {
  try {
    fs.mkdirSync(path.dirname(pfad), { recursive: true });
    fs.writeFileSync(pfad, inhalt, "utf8");
    fortschritt.geschrieben++;
  } catch (e) {
    abbruch(`konnte nicht schreiben: ${pfad}\n  ${klartextOhnePfad(e)}`, e);
  }
}

function dateiSetzen(zielPfad, inhalt, opt) {
  const anzeige = opt.anzeige;
  const ergebnis = dateiSetzenInner(zielPfad, inhalt, opt, anzeige);
  fortschritt.erledigt++;
  return ergebnis;
}

function dateiSetzenInner(zielPfad, inhalt, opt, anzeige) {
  if (!fs.existsSync(zielPfad)) {
    if (!opt.trocken) schreiben(zielPfad, inhalt);
    melden("angelegt", anzeige);
    return "angelegt";
  }
  const vorhanden = fs.readFileSync(zielPfad, "utf8");
  if (vorhanden === inhalt) {
    melden("unveraendert", anzeige);
    return "unveraendert";
  }
  if (opt.ersetzen) {
    if (!opt.trocken) schreiben(zielPfad, inhalt);
    melden(
      "ersetzt",
      anzeige,
      opt.trocken
        ? "die vorhandene Fassung WAERE danach weg (--ersetzen ist gesetzt) — noch ist sie da"
        : "die vorherige Fassung ist damit weg (--ersetzen war gesetzt)"
    );
    return "ersetzt";
  }
  const neben = zielPfad + ".neu";
  if (!opt.trocken) schreiben(neben, inhalt);
  melden(
    "abweichend",
    anzeige,
    opt.trocken
      ? `es wuerde nichts ueberschrieben — die neue Fassung kaeme als ${path.basename(neben)} daneben`
      : `nichts ueberschrieben — neue Fassung liegt als ${path.basename(neben)} daneben`
  );
  return "abweichend";
}

function lesenAusPaket(paket, rel) {
  const p = path.join(paket, rel);
  if (!fs.existsSync(p)) abbruch(`Paket unvollstaendig — fehlt: ${rel}\n  gesucht in: ${paket}`);
  try {
    return fs.readFileSync(p, "utf8");
  } catch (e) {
    abbruch(`Paketdatei nicht lesbar: ${rel}\n  ${klartextOhnePfad(e)}`, e);
  }
}

// JSON.parse nennt im Fehlerfall nur Zeile und Spalte, nie die Datei. Ohne
// diesen Umweg meldete ein kaputtes vorlagen/settings.json blank "Expected
// property name or '}' in JSON at position 2" — richtig, aber unbrauchbar:
// der Empfaenger weiss nicht, WELCHE Datei er ansehen soll.
function jsonAusPaket(paket, rel) {
  const roh = lesenAusPaket(paket, rel);
  try {
    return JSON.parse(roh);
  } catch (e) {
    abbruch(`Paketdatei ist kein gueltiges JSON: ${rel}\n  ${e.message}\n  gelesen aus: ${paket}`, e);
  }
}

// =============================================================================
// 3b — SCHREIBPROBE: BEVOR die erste Datei angefasst wird
//
// Der Teilfall ist der Grund fuer diesen Abschnitt. Ein Ziel, dessen Wurzel
// schreibbar ist und dessen .claude/ es nicht ist, hat am 02.08.2026 zuerst
// die .gitignore geschrieben und ist dann abgestuerzt: 1 von 35 Posten
// installiert, kein Wort darueber. Erst pruefen, dann anfangen — dann ist der
// haeufigste Fehlerfall ein sauberer Abbruch mit leerem Ziel statt eine Ruine.
//
// Geprueft wird je Zielordner, nicht je Datei: die Rechte haengen am Ordner.
// =============================================================================

// Schreibbarkeit laesst sich nur dort pruefen, wo etwas existiert — was es noch
// nicht gibt, kann nichts verweigern. Also den tiefsten vorhandenen Vorfahren
// suchen; darin muss angelegt werden koennen, sonst entsteht der Rest nie.
function tiefsterVorhandener(p) {
  let akt = path.resolve(p);
  for (;;) {
    if (fs.existsSync(akt)) return akt;
    const oben = path.dirname(akt);
    if (oben === akt) return akt; // Wurzel erreicht
    akt = oben;
  }
}

// Nicht `fs.accessSync` allein: Rechte koennen es erlauben und ein volles
// Dateisystem, ein nur lesend eingehaengter Datentraeger oder eine ACL es
// trotzdem verweigern. Nur ein echter Schreibvorgang beweist Schreibbarkeit.
// Im Trockenlauf bleibt nur die schwaechere Rechte-Pruefung — dort wird nicht
// geschrieben, auch keine Probe, und der Lauf sagt das dazu.
function ordnerSchreibbar(ordner, trocken) {
  const wo = tiefsterVorhandener(ordner);
  try {
    if (!fs.statSync(wo).isDirectory()) return { ok: false, wo, grund: "ist kein Ordner" };
  } catch (e) {
    return { ok: false, wo, grund: klartext(e) };
  }
  // Der Pfad bleibt aus dem Grund heraus und wird separat als "betroffen"
  // genannt: im Schreibfall traegt der Fehler den ZUFALLSNAMEN der Probedatei,
  // und der lenkt vom eigentlichen Ordner ab.
  if (trocken) {
    try {
      fs.accessSync(wo, fs.constants.W_OK);
      return { ok: true, wo, schwach: true };
    } catch (e) {
      return { ok: false, wo, grund: klartextOhnePfad(e) };
    }
  }
  // "wx" = anlegen, aber niemals eine vorhandene Datei ueberschreiben. Der
  // Zufallsname macht eine Kollision unwahrscheinlich, das Flag macht sie
  // ungefaehrlich: im Zweifel scheitert die Probe, statt etwas zu zerstoeren.
  const probe = path.join(wo, `.harness-schreibprobe-${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
  try {
    fs.writeFileSync(probe, "", { encoding: "utf8", flag: "wx" });
    return { ok: true, wo };
  } catch (e) {
    return { ok: false, wo, grund: klartextOhnePfad(e) };
  } finally {
    try {
      fs.unlinkSync(probe);
    } catch {
      /* nie angelegt worden — dann gibt es auch nichts aufzuraeumen */
    }
  }
}

// Jeder Ordner, in den dieser Lauf schreiben kann. Aus denselben Listen
// gebildet wie die Kopierschleifen — steht hier trotzdem als eigene Aufzaehlung,
// weil die Schleifen ihre Pfade erst zur Laufzeit bauen. Faellt einer heraus,
// ist das kein Loch: dann greift der Fehlerfang in schreiben() und der Lauf
// endet ebenfalls auf 2, nur eine Stufe spaeter.
function zielOrdner(ziel) {
  const j = (...t) => path.join(ziel, ...t);
  return [
    ziel,
    j(".claude"),
    j(".claude", "commands"),
    j(".claude", "rules", "ecc", "common"),
    ...SKILLS.map(([ordner]) => j(".claude", "skills", ordner)),
    j("lizenzen"),
    j("zustand"),
    j("oberflaeche"),
    j("oberflaeche", "dist"),
    j("docs"),
  ];
}

// Jede Datei, die dieser Lauf aus dem Paket braucht — als Pfad IM PAKET.
// Genau ein Posten im Ziel je Eintrag, deshalb ist die Laenge dieser Liste
// zugleich die Postenzahl. Eine getrennt gepflegte Zahl waere beim ersten
// neuen Waechter falsch, und dann meldete ein Abbruch "12 von 34" statt
// "12 von 35" — eine falsche Zahl ist schlimmer als keine, weil man ihr glaubt.
function paketBedarf() {
  return [
    "vorlagen/gitignore-block.txt", // -> .gitignore
    "vorlagen/settings.json", // -> .claude/settings.json
    "vorlagen/CLAUDE.md", // -> CLAUDE.md
    ...WAECHTER.map((d) => `harness/.claude/${d}`),
    ...BEFEHLE.map((d) => `harness/.claude/commands/${d}`),
    ...REGELN.map((d) => `harness/.claude/rules/ecc/common/${d}`),
    ...SKILLS.flatMap(([ordner, dateien]) => dateien.map((d) => `harness/.claude/skills/${ordner}/${d}`)),
    ...LIZENZEN.map((d) => `lizenzen/${d}`),
    ...ZUSTAND.map((d) => `zustand/${d}`),
    "oberflaeche/befuellen.mjs",
    "oberflaeche/dist/index.html",
    ...BEILEGER.map((d) => `beileger/${d}`),
  ];
}

// Gegengeprueft wird die Zahl am Ende jedes vollstaendigen Laufs (erledigt == gesamt).
const postenGesamt = () => paketBedarf().length;

// Das Paket VOR dem ersten Schreibvorgang durchzaehlen — aus demselben Grund
// wie die Schreibprobe. Gemessen (02.08.2026): ein Paket mit kaputter
// vorlagen/settings.json lief bis Abschnitt [6] durch, schrieb 22 von 35 Posten
// und brach dann ab. `lesenAusPaket` faengt das zwar, aber zu spaet — es steht
// mitten in den Kopierschleifen und kann nur noch abbrechen, nicht mehr
// verhindern. Hier kostet die Pruefung 35 existsSync und spart eine Ruine.
function paketPruefen(paket) {
  const fehlend = paketBedarf().filter((rel) => !fs.existsSync(path.join(paket, rel)));
  if (fehlend.length) {
    abbruch(
      `Paket unvollstaendig — ${fehlend.length} von ${paketBedarf().length} Dateien fehlen.\n` +
        fehlend.map((f) => `    ${f}`).join("\n") +
        `\n  gesucht in: ${paket}\n` +
        `\n  Behebung: das Paket neu bauen (paketieren.mjs) oder --paket auf den\n` +
        `  richtigen Ordner zeigen lassen. Im Ziel wurde nichts angefasst.`
    );
  }
  // Die eine Vorlage, die geparst werden MUSS: settings.json traegt die
  // Hook-Verdrahtung. Ist sie kaputt, ist das Paket unbrauchbar — und das
  // faellt sonst erst nach Abschnitt [5] auf, mit 22 geschriebenen Dateien.
  jsonAusPaket(paket, "vorlagen/settings.json");
}

// =============================================================================
// 4 — SETTINGS ZUSAMMENFUEHREN
//
// Eine vorhandene settings.json wird NICHT ueberschrieben. Sie kann die
// Freigabeliste, Umgebungsvariablen und Modelleinstellungen des Empfaengers
// tragen — beim Ueberschreiben waere das still weg. Ergaenzt werden nur die
// Hook-Eintraege, die noch fehlen; erkannt am Befehlstext, nicht an der Position.
//
// GEBRAUCHT WIRD EIN OBJEKT — nicht "irgendetwas Wahres".
// `null`, `[]`, `"text"` und `42` sind alle gueltiges JSON und alle unbrauchbar.
// Die frueheren Pruefungen (`if (vorhanden)` und `neu.hooks || {}`) haben das
// nicht getrennt, mit drei gemessenen Folgen (02.08.2026):
//   null          -> Abschnitt [6] druckte KEINE EINZIGE ZEILE, Rueckgabewert 0,
//                    Schlusszeile "Eingerichtet.", Datei danach unveraendert
//                    `null` = 0 Hooks, keine statusLine.
//   []            -> Meldung "ergaenzt … 5 Hooks + statusLine", Datei danach
//                    unveraendert `[]`: JSON.stringify wirft Eigenschaften weg,
//                    die auf einem Array gesetzt wurden.
//   {"hooks":[]}  -> dieselbe Erfolgsmeldung, in der Datei stand danach
//                    `"hooks": []` — null Hooks, nur die statusLine kam an.
// Alle drei sahen aus wie ein gelungener Lauf. Das ist die gefaehrlichste
// Fehlerart dieses Programms: ein Harness, der sich fuer bewacht haelt.
// =============================================================================

const istObjekt = (w) => w !== null && typeof w === "object" && !Array.isArray(w);

// Fuer die Meldung: WAS steht statt eines Objekts da? "unbrauchbar" allein
// zwingt den Empfaenger zum Raten, "enthaelt null" sagt ihm, wonach er sucht.
function settingsArt(wert) {
  if (wert === null) return "null";
  if (Array.isArray(wert)) return `eine Liste (${wert.length} Eintraege)`;
  const t = typeof wert;
  return { object: "ein Objekt", string: "Text", number: "eine Zahl", boolean: "einen Wahrheitswert", undefined: "nichts" }[t] || t;
}

// Leer heisst: das Ersetzen kann nichts verlieren. Das ist eine MESSUNG, keine
// Annahme — und sie ist die Grenze zwischen "darf ich reparieren" und "muss ich
// die Finger davon lassen". `[]` traegt nichts, also wird daraus gefahrlos `{}`.
// Eine gefuellte Liste dagegen traegt etwas, das dieses Programm nicht deuten
// kann; die bleibt unangetastet und der Lauf sagt es.
const istLeer = (w) =>
  w === null ||
  w === undefined ||
  (Array.isArray(w) && w.length === 0) ||
  (istObjekt(w) && Object.keys(w).length === 0);

function hookBefehle(event) {
  return (event || []).flatMap((g) => (g.hooks || []).map((h) => String(h.command || "")));
}

// Rueckgabe entweder { problem: "…" } — dann wurde NICHTS veraendert — oder
// { neu, zugefuegt, statusHinweis, korrigiert }.
function settingsZusammenfuehren(vorhanden, vorlage) {
  if (!istObjekt(vorhanden)) return { problem: `die Datei enthaelt ${settingsArt(vorhanden)}, wo ein Objekt stehen muss` };

  const neu = JSON.parse(JSON.stringify(vorhanden));
  const zugefuegt = [];
  const korrigiert = [];

  if (!istObjekt(neu.hooks)) {
    if (!istLeer(neu.hooks)) {
      return {
        problem:
          `hooks enthaelt ${settingsArt(neu.hooks)} und traegt Eintraege — dort laesst sich nichts ` +
          "einhaengen, ohne sie zu verlieren",
      };
    }
    if (neu.hooks !== undefined) korrigiert.push(`hooks war ${settingsArt(neu.hooks)} und leer`);
    neu.hooks = {};
  }

  for (const [ereignis, gruppenVorlage] of Object.entries(vorlage.hooks)) {
    if (!Array.isArray(neu.hooks[ereignis])) {
      if (!istLeer(neu.hooks[ereignis])) {
        return {
          problem:
            `hooks.${ereignis} enthaelt ${settingsArt(neu.hooks[ereignis])} statt einer Liste und ist nicht leer — ` +
            "dieses Programm ueberschreibt das nicht",
        };
      }
      if (neu.hooks[ereignis] !== undefined) korrigiert.push(`hooks.${ereignis} war ${settingsArt(neu.hooks[ereignis])} und leer`);
      neu.hooks[ereignis] = [];
    }
    const schonDa = new Set(hookBefehle(neu.hooks[ereignis]));

    for (const gruppe of gruppenVorlage) {
      const fehlende = (gruppe.hooks || []).filter((h) => !schonDa.has(String(h.command)));
      if (!fehlende.length) continue;

      // In eine bestehende Gruppe mit demselben matcher einhaengen. Eine zweite
      // Gruppe mit gleichem matcher waere nicht falsch, aber unleserlich — und
      // bei PreToolUse wuerde die Reihenfolge der Waechter unklar.
      const passend = neu.hooks[ereignis].find((g) => istObjekt(g) && (g.matcher || null) === (gruppe.matcher || null));
      if (passend) {
        if (!Array.isArray(passend.hooks)) {
          if (!istLeer(passend.hooks)) {
            return { problem: `hooks.${ereignis} enthaelt eine Gruppe, deren hooks ${settingsArt(passend.hooks)} sind — nicht ueberschrieben` };
          }
          passend.hooks = [];
        }
        passend.hooks = passend.hooks.concat(fehlende);
      } else {
        const kopie = { ...gruppe, hooks: fehlende };
        neu.hooks[ereignis].push(kopie);
      }
      for (const h of fehlende) zugefuegt.push(`${ereignis}: ${h.statusMessage || h.command}`);
    }
  }

  let statusHinweis = null;
  if (!neu.statusLine) {
    neu.statusLine = vorlage.statusLine;
    zugefuegt.push("statusLine");
  } else if (JSON.stringify(neu.statusLine) !== JSON.stringify(vorlage.statusLine)) {
    // Gegenwart, nicht Perfekt: dieselbe Zeile erscheint im Trockenlauf, und
    // dort ist noch nichts "gelassen" worden. "sie bleibt" stimmt in beiden.
    statusHinweis = "eigene statusLine vorhanden — sie bleibt unveraendert";
  }

  return { neu, zugefuegt, statusHinweis, korrigiert };
}

// =============================================================================
// 5 — KONTROLLE: sieht git die Eigenbauten?
//
// `git check-ignore -q <pfad>` ist der richtige Test: Rueckgabe 1 heisst "nicht
// ignoriert" = gut. Die Form MIT -v taugt hier NICHT — sie liefert auch dann 0,
// wenn die greifende Regel eine Negation ist, die Datei also gerade NICHT
// ignoriert wird. Und bei bereits getrackten Dateien prueft git gar nicht erst.
//
// Diese Kontrolle sagt NICHTS ueber Sicherung aus. Sichtbar ist nicht gesichert:
// aufgenommen wird eine Datei durch `git add`, gesichert erst durch Commit und
// Push. Das steht deshalb auch in der Menschen-Liste am Ende.
// =============================================================================

function sichtbarkeitPruefen(ziel, pfade) {
  const gitDa = spawnSync("git", ["--version"], { encoding: "utf8" });
  if (gitDa.error) {
    melden("uebersprungen", "Sichtbarkeitsprobe", "git ist nicht aufrufbar — ohne git gibt es hier nichts zu pruefen");
    return { gemacht: false, verdeckt: [] };
  }
  const istRepo = spawnSync("git", ["-C", ziel, "rev-parse", "--is-inside-work-tree"], { encoding: "utf8" });
  if (istRepo.status !== 0) {
    melden(
      "achtung",
      "Sichtbarkeitsprobe: der Zielordner ist kein git-Repo",
      "damit ist NICHTS gesichert — kein Commit, keine Historie, kein Backup"
    );
    return { gemacht: false, verdeckt: [] };
  }
  const verdeckt = [];
  for (const p of pfade) {
    const rel = path.relative(ziel, p).split(path.sep).join("/");
    const lauf = spawnSync("git", ["-C", ziel, "check-ignore", "-q", rel], { encoding: "utf8" });
    if (lauf.status === 0) verdeckt.push(rel); // 0 = ignoriert = schlecht
  }
  if (verdeckt.length) {
    // Jetzt — und nur jetzt — ist `-v` das richtige Werkzeug: als DIAGNOSE,
    // nachdem `-q` die Frage schon beantwortet hat. Als Ja/Nein-Test taugt es
    // nicht, weil es auch dann 0 liefert, wenn die greifende Regel eine
    // Negation ist, die Datei also gerade NICHT ignoriert wird.
    const wer = spawnSync("git", ["-C", ziel, "check-ignore", "-v", verdeckt[0]], { encoding: "utf8" });
    const regel = (wer.stdout || "").trim().split("\t")[0] || "unbekannt";
    melden(
      "achtung",
      `${verdeckt.length} Eigenbau-Datei(en) werden von git ignoriert`,
      `Es gewinnt die Regel: ${regel}\n` +
        `                   Grund: git holt eine Datei NICHT per "!" zurueck, wenn ihr VERZEICHNIS\n` +
        `                   ignoriert ist. Eine vorhandene Zeile wie ".claude/" schlaegt jede spaetere\n` +
        `                   Negation. Behebung: diese Zeile zu ".claude/*" aendern — der Harness-Block\n` +
        `                   in der .gitignore bringt die Negationen dann selbst mit.\n` +
        `                   Betroffen u. a.: ${verdeckt.slice(0, 4).join(" · ")}`
    );
  } else {
    melden("ok", `Sichtbarkeitsprobe: alle ${pfade.length} Eigenbau-Dateien sind fuer git sichtbar`);
  }
  return { gemacht: true, verdeckt };
}

// =============================================================================
// 5b — DIE GEGENPROBE ZUR VERDRAHTUNG
//
// Bis 02.08.2026 las diese Probe `Object.values(vorlage.hooks)` — also die
// PAKETVORLAGE. Sie hat damit geprueft, ob das Paket zu sich selbst passt, und
// nie, was im Zielordner steht. Ihr eigener Kommentar nannte sie "Gegenprobe zur
// Zusage: kein Waechter, der ins Leere laeuft" — genau die Zusage, die sie nicht
// pruefte. Gemessen: bei settings.json = `null` (0 Hooks verdrahtet) meldete sie
// "alle 6 verdrahteten Befehle zeigen auf vorhandene Dateien".
//
// Eine Probe, die ihre eigene Vorlage befragt, kann nur bestehen. Deshalb liest
// sie jetzt die GESCHRIEBENE Zieldatei, frisch von der Platte, nach dem
// Schreiben — und prueft drei Dinge:
//   1. zeigt jeder verdrahtete Befehl auf eine vorhandene Datei?
//   2. wieviele Hooks stehen wirklich drin?
//   3. stimmt das mit dem ueberein, was dieser Lauf gemeldet hat?
// Weicht (3) ab, ist das ein Befund — nicht eine Nachlaessigkeit im Bericht.
// =============================================================================

// Die Vorlage als flache Befehlsliste. Einmal fuer die Zusage, einmal als
// Vergleichsmass — beide muessen aus derselben Quelle kommen, sonst vergleicht
// die Probe zwei Vorstellungen statt Zusage gegen Wirklichkeit.
function vorlageBefehle(vorlage) {
  const raus = [];
  for (const [ereignis, gruppen] of Object.entries(vorlage.hooks || {})) {
    for (const g of gruppen || []) {
      for (const h of g.hooks || []) {
        raus.push({ ereignis, befehl: String(h.command), ansage: h.statusMessage || null });
      }
    }
  }
  if (vorlage.statusLine?.command) raus.push({ ereignis: "statusLine", befehl: String(vorlage.statusLine.command), ansage: "statusLine" });
  return raus;
}

// Den Dateiverweis aus einem Befehlstext holen. $CLAUDE_PROJECT_DIR wird auf den
// Zielordner aufgeloest — genau so loest Claude Code ihn zur Laufzeit auch auf.
// Ein Befehl ohne Skriptverweis (`echo …`, `pnpm lint`) liefert null und wird
// nicht als kaputt gezaehlt: er IST kein Skript, also fehlt auch keins.
function skriptAusBefehl(befehl, ziel) {
  const t = String(befehl).match(/"([^"]+\.(?:js|mjs|cjs))"|'([^']+\.(?:js|mjs|cjs))'|(\S+\.(?:js|mjs|cjs))/);
  if (!t) return null;
  const roh = (t[1] || t[2] || t[3]).replace(/\$\{CLAUDE_PROJECT_DIR\}|\$CLAUDE_PROJECT_DIR/g, ziel);
  return { roh, pfad: path.isAbsolute(roh) ? roh : path.resolve(ziel, roh) };
}

// Dieselbe Messung wie zustand/messen.js, Funktion blockwirkung(): der
// Rueckgabewert 2 ist die Blockier-Vereinbarung von Claude Code. Ein PreToolUse-
// Hook ohne exit(2) im Code kann nicht blocken, egal wie er heisst.
const BLOCK_MUSTER = /process\.exit\(\s*2\s*\)|\bexit\(\s*2\s*\)/;

function blocktLautCode(pfad) {
  try {
    return BLOCK_MUSTER.test(fs.readFileSync(pfad, "utf8"));
  } catch {
    return null; // nicht lesbar — keine Aussage, nicht "blockt nicht"
  }
}

// Alle verdrahteten Eintraege aus einer geschriebenen settings.json.
function verdrahtetLesen(daten) {
  const raus = [];
  const hooks = istObjekt(daten.hooks) ? daten.hooks : {};
  for (const [ereignis, gruppen] of Object.entries(hooks)) {
    for (const g of Array.isArray(gruppen) ? gruppen : []) {
      for (const h of istObjekt(g) && Array.isArray(g.hooks) ? g.hooks : []) {
        if (istObjekt(h)) raus.push({ ereignis, befehl: String(h.command ?? ""), ansage: h.statusMessage || null });
      }
    }
  }
  if (istObjekt(daten.statusLine) && daten.statusLine.command) {
    raus.push({ ereignis: "statusLine", befehl: String(daten.statusLine.command), ansage: "statusLine" });
  }
  return raus;
}

function hookGegenprobe(ziel, zusage, mitgeliefert) {
  const sPfad = path.join(ziel, ".claude", "settings.json");

  let daten;
  try {
    daten = JSON.parse(fs.readFileSync(sPfad, "utf8"));
  } catch (e) {
    melden("achtung", "Hook-Gegenprobe: .claude/settings.json nicht auswertbar", `${e.message}\n                   Es ist nicht feststellbar, ob ueberhaupt ein Waechter verdrahtet ist.`);
    return;
  }
  if (!istObjekt(daten)) {
    melden(
      "achtung",
      `Hook-Gegenprobe: .claude/settings.json enthaelt ${settingsArt(daten)} statt eines Objekts`,
      "0 Hooks verdrahtet, keine statusLine — es laeuft kein einziger Waechter."
    );
    return;
  }

  const verdrahtet = verdrahtetLesen(daten);
  const hookAnzahl = verdrahtet.filter((v) => v.ereignis !== "statusLine").length;

  // (1) zeigt jeder verdrahtete Befehl auf eine vorhandene Datei?
  const blind = [];
  for (const v of verdrahtet) {
    const s = skriptAusBefehl(v.befehl, ziel);
    if (s && !fs.existsSync(s.pfad)) blind.push(`${v.ereignis}: ${path.relative(ziel, s.pfad)}`);
  }
  if (blind.length) {
    melden("achtung", `${blind.length} verdrahtete(r) Hook(s) ohne Datei`, `${blind.join(" · ")}\n                   Diese Eintraege laufen ins Leere — der Aufruf scheitert bei jedem Start.`);
  }

  // (3) stimmt die Wirklichkeit mit dem ueberein, was dieser Lauf gemeldet hat?
  const istDa = new Set(verdrahtet.map((v) => v.befehl));
  const fehlend = zusage.filter((z) => !istDa.has(z.befehl));
  if (fehlend.length) {
    melden(
      "achtung",
      `Bericht und Datei stimmen nicht ueberein: ${fehlend.length} zugesagte(r) Eintrag/Eintraege fehlt in .claude/settings.json`,
      `${fehlend.map((f) => `${f.ereignis}: ${f.ansage || f.befehl}`).join(" · ")}\n` +
        `                   Gemeldet wurde die Verdrahtung, in der Datei stehen ${hookAnzahl} Hook(s).\n` +
        "                   Der Bericht dieses Laufs ist an dieser Stelle nicht belastbar."
    );
  }

  if (!blind.length && !fehlend.length) {
    melden(
      "ok",
      `Hook-Gegenprobe: ${hookAnzahl} Hook(s)${verdrahtet.length > hookAnzahl ? " + statusLine" : ""} in .claude/settings.json, alle Skripte vorhanden`,
      "gelesen aus der geschriebenen Zieldatei, nicht aus der Paketvorlage"
    );
  }

  wirkprobe(ziel, verdrahtet, mitgeliefert);
}

// =============================================================================
// 5c — WIRKPROBE: blockt der verdrahtete Waechter ueberhaupt?
//
// "Vorhanden" ist nicht "wirksam". Gemessener Fall (02.08.2026): ein Zielordner
// trug eine eigene .claude/danger-guard.js mit `process.exit(0)`. Der Installer
// erkannte die Abweichung korrekt und legte seine Fassung als .neu daneben —
// verdrahtet blieb aber die VORHANDENE, inerte Datei. `rm -rf ~` gegen die
// verdrahtete Datei: Rueckgabewert 0, durchgelassen. Gegen die .neu: 2.
// Abschnitt [10] sagte trotzdem "geprueft", und in der Schlussliste stand nur
// "· .claude/danger-guard.js".
//
// Deshalb wird die Blockwirkung jetzt GEMESSEN, mit demselben Mass wie
// zustand/messen.js:400 — und der Befund ist eng gefasst: nur wenn die
// MITGELIEFERTE Fassung blockt und die VERDRAHTETE nicht, ist etwas kaputt.
// Ein Waechter, der ab Werk nur ansagt (git-guard.js), bleibt kein Befund.
// =============================================================================

function wirkprobe(ziel, verdrahtet, mitgeliefert) {
  const tot = [];
  const blockend = [];
  const ansagend = []; // blockt ab Werk nicht — das ist kein Mangel, sondern Bauart

  for (const v of verdrahtet) {
    if (v.ereignis !== "PreToolUse") continue; // nur PreToolUse KANN blocken
    const s = skriptAusBefehl(v.befehl, ziel);
    if (!s || !fs.existsSync(s.pfad)) continue; // fehlende Datei meldet (1) schon
    const werk = mitgeliefert.get(path.resolve(s.pfad));
    if (werk === undefined) continue; // eigener Waechter — keine Vergleichsbasis
    const name = path.relative(ziel, s.pfad);
    if (!BLOCK_MUSTER.test(werk)) {
      ansagend.push(name);
      continue;
    }
    if (blocktLautCode(s.pfad) === false) tot.push(name);
    else blockend.push(name);
  }

  if (tot.length) {
    melden(
      "achtung",
      `${tot.length} verdrahtete(r) Waechter blockt nichts: ${tot.join(" · ")}`,
      "Die verdrahtete Datei enthaelt kein exit(2) — die mitgelieferte Fassung schon.\n" +
        "                   PreToolUse blockiert nur ueber Rueckgabewert 2. Dieser Waechter laeuft mit,\n" +
        "                   haelt aber nichts auf: der Harness ist an dieser Stelle unbewacht und\n" +
        "                   sieht in jeder Anzeige trotzdem bewacht aus.\n" +
        `                   Die blockende Fassung liegt als <datei>.neu daneben — vergleichen und uebernehmen.`
    );
  } else if (blockend.length || ansagend.length) {
    // Beide Zahlen nennen. "alle N blocken" stand hier zuerst und war falsch:
    // git-guard.js traegt ab Werk kein exit(2) und sagt das im eigenen Kopf auch
    // so — gemessen 0 Treffer. Eine Wirkprobe, die Ansager zu Blockern zaehlt,
    // macht denselben Fehler wie die Zusage, die sie pruefen soll.
    melden(
      "ok",
      `Wirkprobe: ${blockend.length} von ${blockend.length + ansagend.length} mitgelieferten PreToolUse-Waechtern blocken (exit(2) im Code)` +
        (ansagend.length ? `, ${ansagend.length} sagt/sagen ab Werk nur an` : ""),
      (blockend.length ? `blockend: ${blockend.join(" · ")}` : "") +
        (blockend.length && ansagend.length ? "\n                   " : "") +
        (ansagend.length ? `nur Ansage (so ausgeliefert): ${ansagend.join(" · ")}` : "")
    );
  }
}

// =============================================================================
// 6 — ZUSTANDSSEITE
//
// Zwei Laeufe, weil Messung und Anzeige getrennt sind:
//   1) zustand.js  misst und schreibt reine Daten (JSON)
//   2) befuellen.mjs spritzt die Daten in die fertig gebaute Huelle
// Der Empfaenger baut nichts — befuellen.mjs benutzt nur node:fs und node:path.
// =============================================================================

function zustandsseiteErzeugen(ziel, trocken) {
  const daten = path.join(ziel, "zustand.json");
  const seite = path.join(ziel, "zustand.html");
  const messer = path.join(ziel, "zustand", "zustand.js");
  const huelle = path.join(ziel, "oberflaeche", "dist", "index.html");
  const spritze = path.join(ziel, "oberflaeche", "befuellen.mjs");

  if (trocken) {
    melden("uebersprungen", "Zustandsseite", `wuerde erzeugen: ${path.relative(ziel, seite)} (aus ${path.relative(ziel, daten)})`);
    return { ok: null, seite };
  }

  const messen = spawnSync(process.execPath, [messer, "--wurzel", ziel, "--json", "--daten", daten], {
    cwd: ziel,
    encoding: "utf8",
    timeout: 300000,
  });
  if (messen.status !== 0) {
    melden("achtung", "Messung fehlgeschlagen", (messen.stderr || messen.error?.message || "").trim().split("\n")[0]);
    return { ok: false, seite };
  }

  const fuellen = spawnSync(process.execPath, [spritze, huelle, daten, seite], { cwd: ziel, encoding: "utf8", timeout: 60000 });
  if (fuellen.status !== 0) {
    melden("achtung", "Befuellen der Huelle fehlgeschlagen", (fuellen.stderr || fuellen.error?.message || "").trim().split("\n")[0]);
    return { ok: false, seite };
  }

  // Den Gesamtstatus aus den Daten holen — nicht aus dem Rueckgabewert.
  // zustand.js gibt ohne --exit-code immer 0 zurueck; der Status steht in den Daten.
  let status = "unbekannt";
  try {
    status = JSON.parse(fs.readFileSync(daten, "utf8")).messung?.gesamtstatus || "unbekannt";
  } catch { /* die Seite steht trotzdem — der Status ist Beiwerk */ }

  // Den Status NICHT nur als Wort ausgeben. "unlesbar" ist im Auslieferungs-
  // zustand der Normalfall und liest sich trotzdem wie ein Defekt: die
  // ECC-Bestandszaehler finden kein .ecc-src/, und ein fehlendes Messwerkzeug
  // wird bewusst als "nicht pruefbar" gemeldet statt als "alles sauber".
  // Wer das nicht erklaert, laesst den Empfaenger auf einen Fehler starren,
  // den es nicht gibt — oder schlimmer: er gewoehnt sich an rote Meldungen.
  melden("angelegt", `Zustandsseite: ${seite}`, `Gesamtstatus der Messung: ${status}${statusErklaeren(status)}`);
  return { ok: true, seite, status };
}

function statusErklaeren(status) {
  const texte = {
    unlesbar:
      "\n                   Im frischen Aufbau erwartet: einzelne Messwerkzeuge fehlen (z. B. der\n" +
      "                   ECC-Bestandszaehler, der .ecc-src/ braucht). Ein fehlendes Werkzeug wird\n" +
      "                   bewusst als „nicht pruefbar\" gemeldet und NIE zu „ok\" verkuerzt — sonst\n" +
      "                   saehe ein Werkzeugausfall aus wie ein bestandener Test. Welche es sind,\n" +
      "                   steht auf der Seite unter „Zu tun\".",
    fehlt:
      "\n                   Einzelne Bestandteile sind nicht vorhanden. Welche, steht auf der Seite\n" +
      "                   unter „Zu tun\" — im frischen Aufbau ist das normal.",
    befund:
      "\n                   Ein Pruefer hat etwas gefunden. Im frischen Aufbau meist: noch nichts\n" +
      "                   committet — also nichts gesichert. Siehe Punkt 2 der Liste unten.",
  };
  return texte[status] || "";
}

// =============================================================================
// 7 — WAS DER MENSCH ENTSCHEIDEN MUSS
//
// Diese Liste ist kein Anhang. Sie ist der Teil des Onboardings, den ein
// Programm nicht uebernehmen darf — und sie steht am Ende, weil sie sonst vor
// der Arbeit gelesen und vergessen wird.
// =============================================================================

const MENSCHEN_PUNKTE = [
  {
    titel: "Die Setup-Sitzung beenden und eine NEUE starten",
    handlung: "Claude Code neu starten, Sitzung im Zielordner oeffnen, dann /repo-status aufrufen.",
    // Gegenwart statt Perfekt: diese Liste erscheint auch im Trockenlauf, und
    // dort ist noch nichts eingerichtet worden.
    wirkung:
      "Alles, was dieses Onboarding einrichtet, laedt nur beim START einer Sitzung. Die " +
      "Sitzung, die das Onboarding ausloest, kennt keine dieser Regeln — sie arbeitet ohne " +
      "Sicherungs-Warnung und ohne die Waechter weiter.",
    empfehlung: "Zuerst machen, vor allem anderen. Ohne diesen Schritt ist nichts davon wirksam.",
  },
  {
    titel: "Git-Repo anlegen und ERSTMALS pushen",
    handlung: "git init · git commit -m \"…\" -- <pfade> · Remote-Repo unter dem eigenen Konto anlegen · push.",
    wirkung:
      "Die .gitignore macht die Eigenbauten fuer git nur SICHTBAR. Ohne Commit und Push " +
      "liegen sie ohne Historie auf einer Platte — genau der Zustand, gegen den dieser " +
      "Harness gebaut ist.",
    empfehlung:
      "Sofort. Das Anlegen eines Remote-Repos und die Anmeldung (gh auth login) sind " +
      "Handlungen des Kontoinhabers — dieses Programm fuehrt sie nicht aus.",
  },
  {
    titel: "settings.json versionieren: ja oder nein",
    handlung: "Nichts tun (= ja) oder die Zeile !.claude/settings.json aus der .gitignore streichen.",
    wirkung:
      "Vorgabe hier ist JA. Diese Vorlage traegt ausschliesslich $CLAUDE_PROJECT_DIR und " +
      "keinen Rechnerpfad — sie ist damit uebertragbar. Die rechnerlokale " +
      "settings.local.json bleibt in jedem Fall draussen.",
    empfehlung: "So lassen. Wer spaeter absolute Pfade eintraegt, muss die Zeile entfernen.",
  },
  {
    titel: "Die Befehls-Freigabeliste ist bewusst NICHT mitgeliefert",
    handlung: "Freigaben im Betrieb einzeln erteilen (sie landen in .claude/settings.local.json).",
    wirkung:
      "Eine mitgelieferte Liste haette stillschweigend Rechte erteilt, die nie jemand " +
      "gesehen hat — bis hin zu Lesefreigaben fuers ganze Heimatverzeichnis und " +
      "beliebiger Codeausfuehrung. Ohne sie fragt das Werkzeug oefter nach. Das ist der Preis.",
    empfehlung: "So lassen und nur freigeben, was tatsaechlich gebraucht wird.",
  },
  {
    titel: "Schreibziele des danger-guard pruefen",
    handlung: "In .claude/danger-guard.js die Funktion erlaubteWurzeln() lesen und ggf. erweitern.",
    wirkung:
      "Erlaubt sind ab Werk: der Zielordner selbst, /tmp, /private/tmp, /var/folders und " +
      "~/.claude. Wer regelmaessig woanders schreibt, wird sonst bei jedem Lauf geblockt — " +
      "und schaltet am dritten Tag den Waechter ab.",
    empfehlung:
      "Vor dem Erweitern die Testreihe in BEIDE Richtungen fahren: Faelle, die blockiert " +
      "werden muessen, UND Faelle, die durchgehen muessen, obwohl sie gefaehrlich klingen.",
  },
  {
    titel: "Die vier Dauer-Regeln mit EIGENER Beweislage fuellen",
    handlung: ".claude/rules/ecc/common/*.md lesen und die fremden Anlaesse durch eigene ersetzen.",
    wirkung:
      "Die Regeln zitieren die Faelle, aus denen sie entstanden sind — aus einem fremden " +
      "Vorhaben. Eine uebernommene Regel ohne eigenen Anlass wird nicht befolgt.",
    empfehlung:
      "Nicht auf einmal. Beim ersten eigenen Fall die Regel um Datum und Messwert ergaenzen; " +
      "dann traegt sie.",
  },
  {
    titel: "Sitzungs-Rollen: nur wenn mehrere Sitzungen parallel laufen",
    handlung: "docs/08-sessions-rollen.md mit einer Rollen-Tabelle anlegen — oder es lassen.",
    wirkung:
      "Fehlt die Datei, bleibt der SessionStart-Hook still. Das ist korrekt, kein Fehler. " +
      "Sobald sie existiert, laedt JEDE Tabellenzeile in JEDE Sitzung und kostet dort " +
      "dauerhaft Kontext — der Umfang waechst mit jeder Rolle.",
    empfehlung: "Erst anlegen, wenn wirklich mehrere Sitzungen nebeneinander arbeiten. Kurz halten.",
  },
  {
    titel: "ECC-Material daneben legen: ja oder nein",
    handlung:
      "Optional einen ECC-Harness nach .ecc-src/ klonen und agents/commands/skills/rules " +
      "nach .claude/ kopieren — hooks/ NICHT (nicht ordner-portabel).",
    wirkung:
      "Ohne .ecc-src/ laeuft alles hier Installierte vollstaendig. Mit .ecc-src/ kommen " +
      "Agenten, Skills und Fremdregeln dazu — und mit ihnen Kontextkosten: ab etwa 70 " +
      "Skills erscheinen weitere nur noch als nackter Name ohne Beschreibung. Mehr Skills " +
      "bedeuten dann WENIGER Faehigkeit.",
    empfehlung:
      "Erst ohne arbeiten. Wenn doch, die Skill-Liste gegen den tatsaechlichen Stack " +
      "kuratieren (skillOverrides) statt zu loeschen.",
  },
  {
    titel: "Projekte anlegen — die Reihenfolge ist nicht vertauschbar",
    handlung:
      "Ordner anlegen · git init · eigene .gitignore · commit · Remote-Repo anlegen · push " +
      "· und ERST NACH VERIFIZIERTEM PUSH die Zeile user-projects/<projekt>/ in die " +
      "Workspace-.gitignore.",
    wirkung:
      "Andersherum wird das Projekt unsichtbar und ungesichert zugleich: der Workspace " +
      "ignoriert es, und ein eigenes Backup gibt es noch nicht.",
    empfehlung: "Nie pauschal user-projects/ ignorieren, immer namentlich je Projekt.",
  },
  {
    titel: "Zugaenge: Namen ja, Werte nein",
    handlung: "Schluessel im Schluesselbund oder in Umgebungsvariablen halten, in Dateien nur den NAMEN.",
    wirkung: "Ein einmal committeter Schluessel bleibt in der Historie, auch nach dem Loeschen der Zeile.",
    empfehlung: "Vor dem ersten Commit die .gitignore-Zeilen fuer .env, *.key und *.pem pruefen.",
  },
];

// =============================================================================
// 8 — HAUPTLAUF
// =============================================================================

function argumente(argv) {
  const a = argv.slice(2);
  const o = { ziel: null, paket: null, trocken: false, ersetzen: false, ohneSeite: false, hilfe: false, spur: false };
  for (let i = 0; i < a.length; i++) {
    const wert = () => {
      if (i + 1 >= a.length) abbruch(`${a[i]} braucht einen Wert`);
      return a[++i];
    };
    switch (a[i]) {
      case "-h": case "--help": o.hilfe = true; break;
      case "--ziel": o.ziel = path.resolve(wert()); break;
      case "--paket": o.paket = path.resolve(wert()); break;
      case "--trocken": o.trocken = true; break;
      case "--ersetzen": o.ersetzen = true; break;
      case "--ohne-seite": o.ohneSeite = true; break;
      case "--spur": o.spur = true; break;
      default: abbruch(`Unbekanntes Argument: ${a[i]}`);
    }
  }
  return o;
}

function hilfe() {
  process.stdout.write(
    [
      "Onboarding — aus dem Paket wird ein laufender Harness.",
      "",
      "  --ziel <ordner>   Zielordner (Vorgabe: das aktuelle Verzeichnis)",
      "  --paket <ordner>  Paketordner (Vorgabe: der Ordner dieses Programms, sonst ../paket/)",
      "  --trocken         jeden Schritt zeigen, nichts schreiben",
      "  --ersetzen        abweichende vorhandene Dateien ueberschreiben",
      "  --ohne-seite      die Zustandsseite am Ende nicht erzeugen",
      "  --spur            bei einem unerwarteten Fehler den Stack mit ausgeben",
      "",
      "Rueckgabe: 0 eingerichtet · 1 eingerichtet, aber etwas braucht Aufmerksamkeit",
      "           2 ABBRUCH — nicht eingerichtet; die Meldung nennt, wieviele von",
      "             wievielen Posten der Lauf noch geschafft hat",
      "",
    ].join("\n")
  );
}

// Der Paketordner ist der eigene, wenn er eine PAKET.json traegt (so liegt es
// beim Empfaenger). Wird das Programm dagegen aus dem Bausatz-Repo aufgerufen,
// liegt das gebaute Paket typischerweise daneben.
function paketFinden(gesetzt) {
  if (gesetzt) return gesetzt;
  const kandidaten = [HIER, path.resolve(HIER, "..", "paket"), path.resolve(HIER, "paket")];
  const treffer = kandidaten.find((k) => fs.existsSync(path.join(k, "PAKET.json")));
  if (!treffer) {
    abbruch(
      "Paket nicht gefunden (gesucht: ein Ordner mit PAKET.json in\n" +
      kandidaten.map((k) => `    ${k}`).join("\n") +
      "\n  --paket <ordner> setzen, oder zuerst paketieren.mjs laufen lassen."
    );
  }
  return treffer;
}

function main() {
  const o = argumente(process.argv);
  if (o.hilfe) return hilfe();

  // Beides VOR der ersten Ausgabe setzen: der Laufmodus faerbt jede Meldung,
  // die Spur entscheidet ueber die Form jedes Abbruchs.
  lauf.trocken = o.trocken;
  spurZeigen = o.spur;

  const paket = paketFinden(o.paket);
  const ziel = o.ziel || process.cwd();
  const opt = { trocken: o.trocken, ersetzen: o.ersetzen };

  let manifest = {};
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(paket, "PAKET.json"), "utf8"));
  } catch (e) {
    abbruch(`PAKET.json ist nicht lesbar oder kein gueltiges JSON\n  ${e.code ? klartextOhnePfad(e) : e.message}\n  gesucht in: ${paket}`, e);
  }

  process.stdout.write(
    `Paket : ${paket}\n` +
    `        ${manifest.posten || "?"} Posten, gebaut ${manifest.gebautAm || "?"}\n` +
    `Ziel  : ${ziel}${o.trocken ? "\n\nTROCKENLAUF — es wird nichts geschrieben." : ""}\n`
  );

  let zielDa = false;
  try {
    zielDa = fs.existsSync(ziel);
    if (zielDa && !fs.statSync(ziel).isDirectory()) abbruch(`Ziel ist kein Ordner: ${ziel}`);
  } catch (e) {
    abbruch(`Zielordner nicht pruefbar: ${ziel}\n  ${klartext(e)}`, e);
  }
  if (!zielDa) {
    if (!o.trocken) {
      try {
        fs.mkdirSync(ziel, { recursive: true });
      } catch (e) {
        abbruch(`Zielordner konnte nicht angelegt werden: ${ziel}\n  ${klartext(e)}`, e);
      }
    }
    process.stdout.write(`\n  Zielordner ${o.trocken ? "wuerde angelegt" : "angelegt"}.\n`);
  }

  // Ab hier hat der Lauf eine Groesse — jeder Abbruch kann jetzt sagen, wie weit
  // er gekommen ist. Vorher waere die Zahl 0 von 0 und damit sinnlos.
  fortschritt.gesamt = postenGesamt();

  // -------------------------------------------------------------------------
  abschnitt(0, "Schreibprobe — bevor die erste Datei angefasst wird");
  const geplanteOrdner = zielOrdner(ziel);
  // Mehrere geplante Ordner koennen denselben vorhandenen Vorfahren haben (im
  // frischen Ziel sind das alle). Deshalb stehen unten BEIDE Zahlen: geprueft
  // wird an den vorhandenen Stellen, gebraucht werden die geplanten.
  const ordner = [...new Set(geplanteOrdner.map((d) => tiefsterVorhandener(d)))];
  const gesperrt = [];
  for (const d of ordner) {
    const r = ordnerSchreibbar(d, o.trocken);
    if (!r.ok) gesperrt.push(r);
  }
  if (gesperrt.length) {
    // KEIN Posten ist angefasst worden. Das ist der ganze Sinn dieses
    // Abschnitts — ein sauberer Abbruch mit unberuehrtem Ziel statt einer
    // halben Installation, die beim naechsten Lauf wie Bestand aussieht.
    // Die Behebung richtet sich nach dem, was gemessen wurde. Ein pauschales
    // "chmod u+w" ist bei "dort liegt eine Datei" schlicht der falsche Rat.
    const rat = gesperrt.some((g) => g.grund === "ist kein Ordner")
      ? "an dieser Stelle liegt eine Datei, wo ein Ordner hin muss — umbenennen oder\n  mit --ziel einen anderen Ordner waehlen."
      : "Schreibrechte setzen (chmod u+w …), Platz schaffen, oder mit --ziel einen\n  anderen Ordner waehlen.";
    abbruch(
      `das Ziel ist nicht beschreibbar — es wurde nichts angefasst.\n` +
        gesperrt.map((g) => `  ${g.grund}\n    betroffen: ${g.wo}`).join("\n") +
        `\n\n  Behebung: ${rat}`
    );
  }
  // Erst das Paket, dann das Ziel: beides muss stimmen, BEVOR die erste Datei
  // entsteht. Ein Abbruch hier hinterlaesst ein unberuehrtes Ziel.
  paketPruefen(paket);
  melden("ok", `Paketprobe: alle ${postenGesamt()} gebrauchten Paketdateien sind da, vorlagen/settings.json ist lesbares JSON`);

  melden(
    "ok",
    `Schreibprobe: ${geplanteOrdner.length} Zielordner, geprueft an ${ordner.length} schon vorhandenen Stelle(n)`,
    o.trocken
      ? "im Trockenlauf nur die RECHTE geprueft — es wird nichts geschrieben, auch keine Probedatei.\n" +
        `${fortsetzung()}Ein volles oder nur lesend eingehaengtes Dateisystem faellt damit erst im echten Lauf auf.`
      : "mit einer echten Probedatei geprueft, nicht nur ueber die Rechte-Anzeige"
  );

  // -------------------------------------------------------------------------
  abschnitt(1, ".gitignore — ZUERST, bevor irgendetwas geschrieben wird");
  // Reihenfolge ist nicht Kosmetik: ein nachgereichtes Ignorier-Muster holt eine
  // bereits getrackte Datei nicht mehr heraus. Umgekehrt gilt dasselbe — wer die
  // Negationen erst nachtraegt, hat die Eigenbauten zwischenzeitlich unsichtbar.
  const block = lesenAusPaket(paket, "vorlagen/gitignore-block.txt");
  const giPfad = path.join(ziel, ".gitignore");
  if (!fs.existsSync(giPfad)) {
    if (!o.trocken) schreiben(giPfad, block);
    melden("angelegt", ".gitignore");
  } else {
    const alt = fs.readFileSync(giPfad, "utf8");
    if (alt.includes(GITIGNORE_MARKE_AUF)) {
      melden("unveraendert", ".gitignore", "der Harness-Block steht schon drin");
    } else {
      if (!o.trocken) schreiben(giPfad, alt.replace(/\n*$/, "\n\n") + block);
      melden(
        "ergaenzt",
        ".gitignore",
        o.trocken
          ? "der Harness-Block WUERDE angehaengt, nichts Vorhandenes veraendert"
          : "der Harness-Block wurde angehaengt, nichts Vorhandenes veraendert"
      );
    }
  }
  fortschritt.erledigt++;

  // -------------------------------------------------------------------------
  abschnitt(2, "Waechter und Hook-Skripte nach .claude/");
  const eigenbauPfade = [];
  // Was das Paket AB WERK mitbringt, je Zielpfad. Die Wirkprobe in Abschnitt [10]
  // braucht diesen Vergleich: nur wenn die mitgelieferte Fassung blockt und die
  // im Ziel verdrahtete nicht, ist der Waechter kaputt statt nur anders.
  const mitgeliefert = new Map();
  for (const datei of WAECHTER) {
    const p = path.join(ziel, ".claude", datei);
    const inhalt = lesenAusPaket(paket, `harness/.claude/${datei}`);
    mitgeliefert.set(path.resolve(p), inhalt);
    dateiSetzen(p, inhalt, { ...opt, anzeige: `.claude/${datei}` });
    eigenbauPfade.push(p);
  }

  // -------------------------------------------------------------------------
  abschnitt(3, "Befehle nach .claude/commands/");
  for (const datei of BEFEHLE) {
    const p = path.join(ziel, ".claude", "commands", datei);
    dateiSetzen(p, lesenAusPaket(paket, `harness/.claude/commands/${datei}`), { ...opt, anzeige: `.claude/commands/${datei}` });
    eigenbauPfade.push(p);
  }

  // -------------------------------------------------------------------------
  abschnitt(4, "Dauer-Regeln nach .claude/rules/ecc/common/ (laden bei jedem Sitzungsstart)");
  for (const datei of REGELN) {
    const rel = `harness/.claude/rules/ecc/common/${datei}`;
    const inhalt = lesenAusPaket(paket, rel);
    // Bedingung fuer "laedt in jeder Sitzung": KEIN Frontmatter. Mit `---`-Kopf
    // wird die Datei zu einem abrufbaren Dokument — die Regel waere still
    // ausser Kraft, ohne dass irgendwo etwas fehlt.
    if (inhalt.startsWith("---")) {
      melden("achtung", `${datei} hat Frontmatter`, "sie wuerde dann NICHT dauerhaft laden — Paket pruefen");
    }
    const p = path.join(ziel, ".claude", "rules", "ecc", "common", datei);
    dateiSetzen(p, inhalt, { ...opt, anzeige: `.claude/rules/ecc/common/${datei}` });
    eigenbauPfade.push(p);
  }

  // -------------------------------------------------------------------------
  abschnitt(5, "Skills nach .claude/skills/ (uebernommen unter MIT, Lizenz liegt bei)");
  for (const [ordner, dateien] of SKILLS) {
    for (const datei of dateien) {
      const p = path.join(ziel, ".claude", "skills", ordner, datei);
      dateiSetzen(p, lesenAusPaket(paket, `harness/.claude/skills/${ordner}/${datei}`), {
        ...opt,
        anzeige: `.claude/skills/${ordner}/${datei}`,
      });
      eigenbauPfade.push(p);
    }
  }
  for (const datei of LIZENZEN) {
    dateiSetzen(path.join(ziel, "lizenzen", datei), lesenAusPaket(paket, `lizenzen/${datei}`), {
      ...opt,
      anzeige: `lizenzen/${datei}`,
    });
  }

  // -------------------------------------------------------------------------
  abschnitt(6, ".claude/settings.json — Hook-Verdrahtung");
  const vorlage = jsonAusPaket(paket, "vorlagen/settings.json");
  const sPfad = path.join(ziel, ".claude", "settings.json");

  // Die ZUSAGE dieses Abschnitts, als Liste von Befehlen — sie ist das, was die
  // Gegenprobe in Abschnitt [10] gegen die geschriebene Datei haelt. Und sie
  // wird GEMESSEN: hier stand die feste Zahl "7 Hook-Eintraege", die Vorlage
  // traegt 5 Hooks + statusLine. Eine Zusage, die schon beim Tippen falsch ist,
  // kann keine Gegenprobe bestehen.
  const zusageBefehle = vorlageBefehle(vorlage);
  let settingsZusage = []; // leer = dieser Lauf verspricht keine Verdrahtung

  if (!fs.existsSync(sPfad)) {
    if (!o.trocken) schreiben(sPfad, JSON.stringify(vorlage, null, 2) + "\n");
    settingsZusage = zusageBefehle;
    const hooks = zusageBefehle.filter((z) => z.ereignis !== "statusLine").length;
    melden("angelegt", ".claude/settings.json", `${hooks} Hook-Eintraege + statusLine, alle ueber $CLAUDE_PROJECT_DIR`);
  } else {
    let vorhanden;
    let fehlgrund = null;
    try {
      vorhanden = JSON.parse(fs.readFileSync(sPfad, "utf8"));
    } catch (e) {
      // Nicht raten: eine kaputte Datei zu ersetzen hiesse, die Einstellungen
      // des Empfaengers wegzuwerfen, ohne sie gelesen zu haben.
      fehlgrund = `kein gueltiges JSON — ${e.message}`;
    }

    const ergebnis = fehlgrund ? null : settingsZusammenfuehren(vorhanden, vorlage);
    if (ergebnis && ergebnis.problem) fehlgrund = ergebnis.problem;

    if (fehlgrund) {
      // NICHT ueberschreiben (die Datei koennte die Freigabeliste des
      // Empfaengers tragen) — aber auch NICHT schweigen. Schweigen war der
      // gemessene Fehler: bei `null` druckte dieser Abschnitt keine einzige
      // Zeile und der Lauf endete mit "Eingerichtet.". Deshalb liegt die
      // Vorlage jetzt daneben, wie bei jeder anderen abweichenden Datei auch.
      const neben = sPfad + ".neu";
      if (!o.trocken) schreiben(neben, JSON.stringify(vorlage, null, 2) + "\n");
      // Dieser Zusatz erscheint AUCH im Trockenlauf — der Einzug muss deshalb
      // gerechnet werden, nicht getippt: dort ist die Zustandsspalte breiter.
      const ein = fortsetzung();
      melden(
        "achtung",
        `.claude/settings.json ist unbrauchbar: ${fehlgrund}`,
        (o.trocken
          ? "Es WUERDE nichts verdrahtet — 0 Hooks, keine statusLine, kein Waechter.\n"
          : "Es wurde NICHTS verdrahtet — 0 Hooks, keine statusLine, kein Waechter laeuft.\n") +
          `${ein}Die vollstaendige Vorlage ${o.trocken ? "wuerde als" : "liegt jetzt als"} ${path.basename(neben)} daneben${o.trocken ? " gelegt" : ""}:\n` +
          `${ein}vorhandene Datei ansehen, Brauchbares uebernehmen, dann .neu an ihre Stelle.`
      );
    } else {
      const { neu, zugefuegt, statusHinweis, korrigiert } = ergebnis;
      settingsZusage = zusageBefehle;
      if (korrigiert.length) {
        // Sichtbar machen, dass hier eine leere Huelle ersetzt wurde. Leer heisst
        // nachweislich "ohne Inhalt" — verloren geht dabei nichts, aber der
        // Empfaenger soll wissen, dass seine Datei anders aussieht als vorher.
        melden(
          "ergaenzt",
          `.claude/settings.json: leere Huelle ${o.trocken ? "waere zu begradigen" : "begradigt"}`,
          korrigiert.join(" · ")
        );
      }
      if (!zugefuegt.length) {
        melden("unveraendert", ".claude/settings.json", "alle Hooks der Vorlage sind schon verdrahtet");
      } else {
        if (!o.trocken) schreiben(sPfad, JSON.stringify(neu, null, 2) + "\n");
        melden(
          "ergaenzt",
          ".claude/settings.json",
          `${o.trocken ? "wuerde hinzufuegen" : "hinzugefuegt"}: ${zugefuegt.join(" · ")}`
        );
      }
      if (statusHinweis) {
        melden("uebersprungen", "statusLine", statusHinweis);
        // Die eigene statusLine bleibt stehen — dann darf der Lauf sie auch
        // nicht als zugesagt fuehren, sonst meldet die Gegenprobe eine Luecke,
        // die eine bewusste Entscheidung ist.
        settingsZusage = settingsZusage.filter((z) => z.ereignis !== "statusLine");
      }
    }
  }
  eigenbauPfade.push(sPfad);
  fortschritt.erledigt++;

  // -------------------------------------------------------------------------
  abschnitt(7, "CLAUDE.md — nur wenn keine da ist");
  const cPfad = path.join(ziel, "CLAUDE.md");
  if (fs.existsSync(cPfad)) {
    melden(
      "uebersprungen",
      "CLAUDE.md",
      `vorhandene Datei ${o.trocken ? "wird nicht angefasst" : "nicht angefasst"} — sie laedt in jeder Sitzung und gehoert dem Empfaenger`
    );
    fortschritt.erledigt++; // uebersprungen ist auch bearbeitet
  } else {
    dateiSetzen(cPfad, lesenAusPaket(paket, "vorlagen/CLAUDE.md"), { ...opt, anzeige: "CLAUDE.md" });
  }

  // -------------------------------------------------------------------------
  abschnitt(8, "Zustandsseite: Messung und Huelle");
  for (const datei of ZUSTAND) {
    dateiSetzen(path.join(ziel, "zustand", datei), lesenAusPaket(paket, `zustand/${datei}`), {
      ...opt,
      anzeige: `zustand/${datei}`,
    });
  }
  dateiSetzen(path.join(ziel, "oberflaeche", "befuellen.mjs"), lesenAusPaket(paket, "oberflaeche/befuellen.mjs"), {
    ...opt,
    anzeige: "oberflaeche/befuellen.mjs",
  });
  dateiSetzen(path.join(ziel, "oberflaeche", "dist", "index.html"), lesenAusPaket(paket, "oberflaeche/dist/index.html"), {
    ...opt,
    anzeige: "oberflaeche/dist/index.html  (die gebaute Huelle — kein npm noetig)",
  });

  // -------------------------------------------------------------------------
  abschnitt(9, "Beileger nach docs/");
  for (const datei of BEILEGER) {
    dateiSetzen(path.join(ziel, "docs", datei), lesenAusPaket(paket, `beileger/${datei}`), {
      ...opt,
      anzeige: `docs/${datei}`,
    });
  }

  // -------------------------------------------------------------------------
  abschnitt(10, "Kontrolle");
  if (o.trocken) melden("uebersprungen", "Sichtbarkeitsprobe", "Trockenlauf — es liegt noch nichts zum Pruefen da");
  else sichtbarkeitPruefen(ziel, eigenbauPfade);

  // Gegenprobe zur Zusage "kein Waechter, der ins Leere laeuft" — gegen die
  // GESCHRIEBENE Zieldatei, nicht gegen die Vorlage. Und danach die Wirkprobe:
  // vorhanden ist nicht wirksam.
  if (o.trocken) melden("uebersprungen", "Hook-Gegenprobe", "Trockenlauf — es steht keine geschriebene settings.json zum Nachlesen da");
  else hookGegenprobe(ziel, settingsZusage, mitgeliefert);

  // -------------------------------------------------------------------------
  abschnitt(11, "Zustandsseite erzeugen");
  let seite = { ok: null, seite: null };
  if (o.ohneSeite) melden("uebersprungen", "Zustandsseite", "--ohne-seite war gesetzt");
  else seite = zustandsseiteErzeugen(ziel, o.trocken);

  // Gegenprobe zur eigenen Zaehlung: postenGesamt() ist gerechnet, die
  // Einzelzaehlung laeuft ueber die Abschnitte [1] bis [9]. Laufen beide
  // auseinander, ist die Zahl in JEDER Abbruchmeldung falsch — und es wuerde
  // niemandem auffallen, weil ein Abbruch selten ist und die Zahl plausibel
  // aussieht. Deshalb prueft sich der Zaehler bei jedem vollstaendigen Lauf
  // selbst; ein Abbruch faellt hier gar nicht erst an.
  if (fortschritt.erledigt !== fortschritt.gesamt) {
    melden(
      "achtung",
      `Zaehlung stimmt nicht: ${fortschritt.erledigt} Posten bearbeitet, ${fortschritt.gesamt} erwartet`,
      "Ein Fehler IM INSTALLER, nicht im Ziel: postenGesamt() und die Zaehlung in den\n" +
        `${fortsetzung()}Abschnitten sind auseinandergelaufen. Die "N von M"-Angabe eines Abbruchs\n` +
        `${fortsetzung()}waere damit falsch — und eine falsche Zahl ist schlimmer als keine.`
    );
  }

  // -------------------------------------------------------------------------
  // Auch die Ueberschrift kennt den Trockenlauf. "WAS JETZT BEIM MENSCHEN
  // LIEGT" behauptet, der Lauf sei durch — nach einem Trockenlauf liegt beim
  // Menschen noch gar nichts, weil noch nichts geschehen ist.
  process.stdout.write(
    "\n" + "=".repeat(78) + "\n" +
    (o.trocken ? "WAS NACH EINEM ECHTEN LAUF BEIM MENSCHEN LIEGEN WIRD" : "WAS JETZT BEIM MENSCHEN LIEGT") +
    "\n" + "=".repeat(78) + "\n"
  );
  MENSCHEN_PUNKTE.forEach((p, i) => {
    process.stdout.write(
      `\n${i + 1}. ${p.titel}\n` +
      `   Handlung   : ${umbruch(p.handlung)}\n` +
      `   Wirkung    : ${umbruch(p.wirkung)}\n` +
      `   Empfehlung : ${umbruch(p.empfehlung)}\n`
    );
  });

  process.stdout.write("\n" + "-".repeat(78) + "\n");
  if (seite.seite && seite.ok) {
    process.stdout.write(`Die Zustandsseite liegt hier — im Browser oeffnen:\n  ${seite.seite}\n`);
  } else if (!o.ohneSeite && !o.trocken) {
    process.stdout.write("Die Zustandsseite konnte nicht erzeugt werden — siehe Abschnitt 11.\n");
  }
  process.stdout.write(`Erneut messen (jederzeit, veraendert nichts):\n  node zustand/zustand.js --json --daten zustand.json\n  node oberflaeche/befuellen.mjs oberflaeche/dist/index.html zustand.json zustand.html\n`);

  // Die Schlusszeile steht in BEIDEN Zweigen. Bis 02.08.2026 kam sie nach dem
  // process.exit(1) — ein Trockenlauf mit einem einzigen Befund endete deshalb
  // ohne den Satz "es wurde nichts geschrieben", also genau dann, wenn er am
  // meisten gebraucht wird.
  //
  // Die Zahl "geschrieben" zaehlt, was durch schreiben() ging — also Paketinhalt.
  // Die Zustandsseite entsteht in [11] durch zwei Unterprozesse und ist da nicht
  // dabei; ohne diesen Zusatz liest sich "0 Datei(en) geschrieben" bei einem
  // zweiten Lauf wie "es ist gar nichts passiert", obwohl zustand.html neu ist.
  const seiteNeu = !o.ohneSeite && seite.ok;
  const schluss = o.trocken
    ? `\nTrockenlauf beendet — es wurde nichts geschrieben. ${fortschritt.gesamt} Posten wuerden bearbeitet.\n`
    : `\nEingerichtet: ${fortschritt.erledigt} von ${fortschritt.gesamt} Posten, ${fortschritt.geschrieben} davon neu geschrieben` +
      `${seiteNeu ? " (die Zustandsseite in [11] entsteht jedes Mal neu und ist hier nicht mitgezaehlt)" : ""}.\n`;

  if (achtungen.length) {
    // MIT dem Zusatz. Ohne ihn stand hier eine Liste von Dateinamen — "·
    // .claude/danger-guard.js" sagt nicht, ob die Datei fehlt, abweicht oder
    // wirkungslos verdrahtet ist. Die Schlussliste ist fuer viele die einzige
    // Zeile, die sie lesen; sie muss allein tragen.
    process.stdout.write(`\n${achtungen.length} Punkt(e) brauchen Aufmerksamkeit:\n`);
    for (const a of achtungen) {
      process.stdout.write(`  · ${a.text}\n`);
      if (a.zusatz) {
        for (const zeile of String(a.zusatz).split("\n")) {
          if (zeile.trim()) process.stdout.write(`      ${zeile.trim()}\n`);
        }
      }
    }
    process.stdout.write(schluss);
    process.exit(1);
  }
  process.stdout.write(schluss);
}

// Lange Saetze in der Konsole umbrechen, damit die Menschen-Liste lesbar bleibt.
function umbruch(text, breite = 74, einzug = "                ") {
  const woerter = String(text).split(/\s+/);
  const zeilen = [];
  let akt = "";
  for (const w of woerter) {
    if ((akt + " " + w).trim().length > breite) {
      zeilen.push(akt.trim());
      akt = w;
    } else {
      akt += " " + w;
    }
  }
  if (akt.trim()) zeilen.push(akt.trim());
  return zeilen.join("\n" + einzug);
}

// DAS LETZTE NETZ. Alles, was schreibt, geht durch schreiben() und faellt dort
// schon sauber um. Was hier ankommt, ist ein Fehler, den niemand vorhergesehen
// hat — und genau der darf nicht als Stacktrace mit Rueckgabewert 1 enden, weil
// 1 "eingerichtet, sieh mal nach" bedeutet. Unbekannt heisst 2, nicht 1.
try {
  main();
} catch (fehler) {
  abbruch(klartext(fehler), fehler, true);
}
