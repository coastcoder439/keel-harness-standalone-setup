#!/usr/bin/env node
// Prueft, ob die Volltext-Kopien in payload/docs/rebuild-guide.md noch mit den
// echten Dateien dieses Bausatzes uebereinstimmen.
//
// WARUM ES DAS GIBT
// Dieser Bausatz beschreibt denselben Harness ZWEIMAL: einmal als echte Dateien
// (payload/claude/, templates/), die der Installer kopiert, und einmal als
// Volltext-Zitate in der Nachbau-Anleitung. Die Kopie ist gewollt: wer von Hand
// nachbaut, hat die Dateien noch nicht -- ein blosser Verweis waere fuer ihn wertlos.
//
// Der Preis sind zwei Staende, die auseinanderlaufen. Am 21.08.2026 belegt: der
// Projekt-Kontext-Check und die Dauer-Regel working-method.md standen in der
// Anleitung, aber in keiner installierten Datei -- jede frische Installation kam
// ohne sie. Gefunden wurde das von Hand, durch einen Audit; ohne den waere es
// weiter unentdeckt geblieben.
//
// Die naheliegende Antwort waere eine Pflicht ("wer eine Datei aendert, zieht die
// Anleitung nach") oder ein Vermerk ("bei Widerspruch gewinnt die Datei"). Beides
// taugt nicht: Das eine haengt daran, dass jemand daran denkt, das andere ERLAUBT
// das Auseinanderlaufen sogar. Verlangt ist, dass beide Staende gleich sind --
// und das ist eine pruefbare Eigenschaft, keine Erinnerung.
//
// AUFRUF    node checks/anleitung-sync.mjs
// RUECKGABE 0 = deckungsgleich · 1 = Drift gefunden · 2 = Aufruffehler
//
// Herkunft: uebernommen aus dem Vorgaenger-Harness (docs/workflows/anleitung-drift.js),
// dort ueber Wochen gereift. Angepasst an die Bausatz-Struktur (Pfad-Abbildung,
// bewusste Auslassungen). Die Kommentare zu den Fallstricken sind bewusst mitgenommen:
// jeder steht fuer einen real passierten Fehlbefund.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HIER = path.dirname(fileURLToPath(import.meta.url));
const WURZEL = path.resolve(HIER, "..");
const ANLEITUNG = path.join(WURZEL, "payload", "docs", "rebuild-guide.md");

// Eine Ueberschrift oder Einleitungszeile nennt den Pfad in Backticks, kurz
// darauf oeffnet der Codeblock. Mehr Naehe als ANKER_ABSTAND Zeilen waere
// zu streng (dazwischen steht oft ein erklaerender Absatz), mehr waere Raten.
const ANKER_ABSTAND = 12;
// Der Pfad-Anker steht mal in Backticks, mal in <code>-HTML -- letzteres in
// jedem <details>/<summary>-Aufklapper. Nur Backticks zu kennen machte im
// Vorgaenger die 325-Zeilen-Kopie von danger-guard.js unsichtbar: Der Pruefer
// meldete "12 Kopien geprueft" und uebersprang die dreizehnte. Eine
// Vollstaendigkeitsaussage, die eine Kopie nicht kennt, ist keine.
const PFAD_MUSTER = /(?:`|<code>)(\.claude\/[A-Za-z0-9._/-]+)(?:`|<\/code>)/;

// Platzhalter der Bauvorlagen: <WORKSPACE_ABS>, <PLUGIN>, <INSTANZ> ...
// Grossbuchstaben und Unterstrich, damit generische Winkelklammern aus
// JavaScript oder Markdown nicht mitgezaehlt werden.
const PLATZHALTER = /<[A-Z][A-Z0-9_]{2,}>/;

// BEWUSSTE AUSLASSUNGEN -- Dateien, die die Anleitung zitiert, die dieser
// schlanke Bausatz aber absichtlich nicht ausliefert. Jede braucht hier eine
// Begruendung, sonst ist sie keine Auslassung, sondern eine vergessene Datei.
// Ohne diese Liste meldet der Pruefer am ersten Tag Fehlalarme -- und ein
// Pruefer mit Fehlalarmen wird nach dem dritten Mal ignoriert.
const AUSNAHMEN = new Map([
  [
    ".claude/hooks/pruefstand-warn.js",
    "Anleitung 6.8.11a legt selbst fest: im Nachbau weglassen -- er ruft zwei Mess-Pruefer, die dieser Bausatz nicht mitliefert.",
  ],
]);

// Wo die von der Anleitung genannten Pfade in diesem Bausatz wirklich liegen.
// Die Anleitung stammt aus einem Harness mit .claude/hooks/-Unterordner; dieser
// Bausatz legt die Waechter flach nach .claude/ und haelt settings.json als Vorlage.
function abbilden(pfad) {
  if (pfad === ".claude/settings.json") return path.join("templates", "settings.json");
  const ohneHooks = pfad.replace(/^\.claude\/hooks\//, ".claude/");
  // Das Ziel heisst payload/claude/ OHNE Punkt. Wer nur "harness" ersetzt, erhaelt
  // payload/claude/.claude/... und alle Kopien fallen in "FEHLT" -- die Meldung sagt
  // dann "Anleitung zitiert eine Datei, die der Bausatz nicht hat" statt "Abbildung kaputt".
  return path.join("payload", "claude", ohneHooks.replace(/^\.claude\//, ""));
}

function bloeckeLesen(text) {
  const zeilen = text.split("\n");
  const treffer = [];
  const ohneAnker = [];
  let letzterPfad = null;
  let letzterPfadZeile = -1;

  // Welche Zaun-Sprache zu welcher Dateiendung gehoert. Ein Block in einer
  // anderen Sprache ist ein Beispiel, keine Kopie -- und wird nicht verglichen.
  const ERLAUBT = {
    js: ["js", "javascript", "mjs", "cjs"],
    mjs: ["js", "javascript", "mjs"],
    md: ["markdown", "md"],
    json: ["json", "jsonc"],
  };
  const ERLAUBT_SPRACHEN = new Set(Object.values(ERLAUBT).flat());

  for (let i = 0; i < zeilen.length; i++) {
    const m = zeilen[i].match(PFAD_MUSTER);
    if (m) {
      letzterPfad = m[1];
      letzterPfadZeile = i;
    }

    if (!zeilen[i].startsWith("```") || zeilen[i].trim() === "```") continue;

    // Die Sprache des Zauns muss zur Dateiendung passen. Ohne das gilt jeder
    // bash-Block, der zufaellig einen .claude/-Pfad ueber sich hat, als Kopie
    // dieser Datei -- und ein Befehlsbeispiel von acht Zeilen wird als Drift
    // gegen ein Skript von 134 Zeilen gemeldet. Im Vorgaenger zweimal passiert.
    const sprache = zeilen[i].slice(3).trim().toLowerCase();
    if (letzterPfad) {
      const endung = letzterPfad.split(".").pop().toLowerCase();
      if (!(ERLAUBT[endung] || []).includes(sprache)) continue;
    }

    const zu = zeilen.findIndex((z, j) => j > i && z.trim() === "```");
    if (zu === -1) continue;

    // GROSSE, ANKERLOSE BLOECKE MELDEN statt still uebergehen. Genau hier verlor
    // der Vorgaenger eine Kopie: kein erkannter Anker -> uebersprungen -> und die
    // Schlusszeile sagte trotzdem "alle geprueft". Ein uebersehener Block sah aus
    // wie ein nicht vorhandener.
    const laenge = zu - i - 1;
    if ((!letzterPfad || i - letzterPfadZeile > ANKER_ABSTAND) && laenge >= 30 && ERLAUBT_SPRACHEN.has(sprache)) {
      ohneAnker.push({ von: i + 1, bis: zu + 1, zeilen: laenge, sprache });
    }

    if (letzterPfad && i - letzterPfadZeile <= ANKER_ABSTAND) {
      treffer.push({
        pfad: letzterPfad,
        von: i + 1,
        bis: zu + 1,
        inhalt: zeilen.slice(i + 1, zu).join("\n").trim(),
      });
    }
    i = zu;
  }
  return { treffer, ohneAnker };
}

// Der Vergleich, den Messung UND Kontrollprobe benutzen -- eine einzige Stelle,
// damit die Probe wirklich das prueft, was danach laeuft. Zeilenenden werden
// vereinheitlicht: CRLF gegen LF ist kein inhaltlicher Unterschied, und ein
// Pruefer, der jede Datei unter Windows als Drift meldet, ist wertlos.
function vergleiche(kopie, liveRoh) {
  const norm = (s) => s.split("\r\n").join("\n").trim();
  return norm(liveRoh) === norm(kopie);
}

// KONTROLLPROBE -- ZWEI Faelle, weil eine Erkennung asymmetrisch bricht.
// Der laute Bruch (nichts wird zugeordnet) ist in main() abgefangen. Der STILLE
// Bruch ist der gefaehrliche: Sagt die Pruefung aus irgendeinem Grund immer
// "gleich", meldet sie "alles deckungsgleich" -- von einem echt sauberen Bestand
// nicht zu unterscheiden.
function kontrollprobe(bloecke) {
  const kandidaten = bloecke.filter((b) => {
    if (PLATZHALTER.test(b.inhalt) || !b.inhalt) return false;
    const datei = path.join(WURZEL, abbilden(b.pfad));
    return fs.existsSync(datei) && !fs.statSync(datei).isDirectory();
  });
  if (kandidaten.length === 0) {
    return "kein einziger Block laesst sich einer vorhandenen Datei zuordnen";
  }

  // gut-Fall: MINDESTENS EIN Paar muss durch die volle Kette als deckungsgleich
  // herauskommen. Faellt Zuordnung, Pfad-Abbildung oder das Trimmen aus, gibt es
  // kein einziges -- und dann ist ein Bericht voller "DRIFT" ein Werkzeugfehler,
  // kein Befund.
  const treffer = kandidaten.find((b) =>
    vergleiche(b.inhalt, fs.readFileSync(path.join(WURZEL, abbilden(b.pfad)), "utf8"))
  );
  if (!treffer) {
    return `kein einziges Paar kam als deckungsgleich heraus (${kandidaten.length} gepruefte)`;
  }

  // schlecht-Fall: dasselbe Paar mit einer eingefuegten Zeile MUSS als abweichend
  // herauskommen -- sonst entwarnt der Abgleich blind.
  const live = fs.readFileSync(path.join(WURZEL, abbilden(treffer.pfad)), "utf8");
  if (vergleiche(treffer.inhalt, live + "\nKONTROLLZEILE")) {
    return `veraenderter Inhalt von ${treffer.pfad} galt trotzdem als deckungsgleich`;
  }
  return null;
}

// NACHZIEHEN -- die Anleitung an die echten Dateien angleichen.
//
// Bewusst in DERSELBEN Datei wie die Messung: beide brauchen die Block-Erkennung,
// und zwei Fassungen davon waeren genau der Fehler, gegen den dieses Werkzeug
// gebaut ist. Ersetzt wird nur der Inhalt ZWISCHEN den Zaeunen, von unten nach
// oben, damit die Zeilennummern der noch offenen Bloecke gueltig bleiben.
function nachziehen(rohtext, bloecke, auchVorlagen) {
  const crlf = rohtext.includes("\r\n");
  const zeilen = rohtext.split(/\r?\n/);
  const zuTun = [];

  for (const b of bloecke) {
    if (AUSNAHMEN.has(b.pfad)) continue;
    const datei = path.join(WURZEL, abbilden(b.pfad));
    if (!fs.existsSync(datei) || fs.statSync(datei).isDirectory()) continue;
    // Platzhalter-Bloecke bleiben normalerweise unangetastet: sie sind Vorlagen zum
    // Ausfuellen, kein Abbild einer Datei. In DIESEM Bausatz gibt es keine echten
    // Vorlagen mehr (alles laeuft ueber $CLAUDE_PROJECT_DIR und generische Namen) --
    // stehengebliebene Platzhalter sind hier also Altbestand. --auch-vorlagen gleicht
    // sie an; danach traegt kein Block mehr einen Platzhalter und alles wird verglichen.
    if (!auchVorlagen && PLATZHALTER.test(b.inhalt)) continue;
    const liveRoh = fs.readFileSync(datei, "utf8");
    if (vergleiche(b.inhalt, liveRoh)) continue;
    zuTun.push({ ...b, neu: liveRoh.split("\r\n").join("\n").trim().split("\n") });
  }

  for (const b of zuTun.sort((x, y) => y.von - x.von)) {
    // b.von/b.bis sind 1-basiert und zeigen auf die Zaun-Zeilen.
    zeilen.splice(b.von, b.bis - b.von - 1, ...b.neu);
    console.log(`  nachgezogen  ${b.pfad}  (Anleitung Zeile ${b.von}) -- ${b.neu.length} Zeilen aus dem Bausatz`);
  }

  if (zuTun.length) fs.writeFileSync(ANLEITUNG, zeilen.join(crlf ? "\r\n" : "\n"));
  return zuTun.length;
}

function main() {
  if (!fs.existsSync(ANLEITUNG)) {
    console.error(`FEHLER: ${ANLEITUNG} nicht gefunden.`);
    process.exit(2);
  }

  if (process.argv.includes("--nachziehen")) {
    const roh = fs.readFileSync(ANLEITUNG, "utf8");
    const { treffer } = bloeckeLesen(roh);
    const n = nachziehen(roh, treffer, process.argv.includes("--auch-vorlagen"));
    console.log(n ? `\n${n} Kopie(n) angeglichen. Zur Kontrolle den Abgleich ohne --nachziehen laufen lassen.` : "\nNichts nachzuziehen.");
    process.exit(0);
  }

  const { treffer: bloecke, ohneAnker } = bloeckeLesen(fs.readFileSync(ANLEITUNG, "utf8"));
  if (bloecke.length === 0) {
    console.error("FEHLER: kein einziger zuordenbarer Block gefunden -- das ist");
    console.error("kein 'alles sauber', sondern ein kaputter Abgleich.");
    process.exit(2);
  }

  const kaputt = kontrollprobe(bloecke);
  if (kaputt) {
    console.error(`FEHLER: Kontrollprobe fehlgeschlagen -- ${kaputt}.`);
    console.error("Der Abgleich kann nicht beweisen, dass er Abweichungen findet.");
    console.error("Ein leeres Ergebnis waere hier bedeutungslos.");
    process.exit(2);
  }

  const gleich = [];
  const kein_bezug = [];
  const drift = [];
  const fehlt = [];
  const vorlage = [];
  const ausgelassen = [];

  for (const b of bloecke) {
    const datei = path.join(WURZEL, abbilden(b.pfad));
    const kopieZeilen = b.inhalt.split("\n").length;

    if (AUSNAHMEN.has(b.pfad)) {
      ausgelassen.push(b);
      continue;
    }

    // Ein Anker kann auf ein VERZEICHNIS zeigen -- `.claude/rules/ecc/common/` in
    // einer Ueberschrift, gefolgt von einem Codeblock, der etwas anderes zeigt.
    // Frueher riss das den Abgleich mit EISDIR ab: ein Werkzeugausfall, der wie
    // ein Befund aussah.
    if (fs.existsSync(datei) && fs.statSync(datei).isDirectory()) {
      kein_bezug.push(b);
      continue;
    }

    // Manche Bloecke sind ABSICHTLICH nicht deckungsgleich: sie tragen Platzhalter
    // (<WORKSPACE_ABS>, <PLUGIN>), die beim Nachbau ersetzt werden.
    if (PLATZHALTER.test(b.inhalt)) {
      const liveZeilen = fs.existsSync(datei)
        ? fs.readFileSync(datei, "utf8").trim().split("\n").length
        : null;
      vorlage.push({ ...b, kopieZeilen, liveZeilen });
      continue;
    }

    if (!fs.existsSync(datei)) {
      fehlt.push(b);
      continue;
    }
    const liveRoh = fs.readFileSync(datei, "utf8");
    (vergleiche(b.inhalt, liveRoh) ? gleich : drift).push({
      ...b,
      liveZeilen: liveRoh.split("\r\n").join("\n").trim().split("\n").length,
      kopieZeilen,
    });
  }

  for (const b of gleich) console.log(`  gleich     ${b.pfad}  (Zeile ${b.von})`);
  for (const b of ausgelassen) {
    console.log(`  ausgelassen ${b.pfad}  (Zeile ${b.von}) -- ${AUSNAHMEN.get(b.pfad)}`);
  }
  for (const b of kein_bezug) {
    console.log(`  ohne Bezug ${b.pfad}  (Zeile ${b.von}) -- Anker ist ein Verzeichnis, kein Vergleich moeglich`);
  }
  for (const b of vorlage) {
    const groesse =
      b.liveZeilen === null
        ? "keine Datei im Bausatz"
        : `${b.kopieZeilen} Zeilen Anleitung · ${b.liveZeilen} Zeilen Bausatz`;
    console.log(`  Vorlage    ${b.pfad}  (Zeile ${b.von}) -- Platzhalter, ${groesse}`);
  }
  for (const b of fehlt) {
    console.log(`  FEHLT      ${b.pfad}  (Zeile ${b.von}) -- Anleitung zitiert eine Datei, die dieser Bausatz nicht hat`);
  }
  for (const b of ohneAnker) {
    console.log(
      `  ANKERLOS   (Zeile ${b.von}-${b.bis}: ${b.zeilen} Zeilen ${b.sprache}) -- kein .claude/-Pfad in den ` +
        `${ANKER_ABSTAND} Zeilen davor. Wird NICHT verglichen. Ist das eine Datei-Kopie, fehlt der Anker.`
    );
  }
  for (const b of drift) {
    console.log(
      `  DRIFT      ${b.pfad}  (Anleitung Zeile ${b.von}-${b.bis}: ` +
        `${b.kopieZeilen} Zeilen · Bausatz: ${b.liveZeilen} Zeilen)`
    );
  }

  console.log(
    `\n${bloecke.length} Kopien geprueft: ${gleich.length} deckungsgleich, ` +
      `${drift.length} abweichend, ${vorlage.length} Vorlage, ${fehlt.length} ohne Datei, ` +
      `${ausgelassen.length} bewusst ausgelassen.`
  );

  if (vorlage.length) {
    console.log(
      "\nHinweis zu den Vorlagen: Bei ihnen laesst sich nur die Groesse vergleichen,\n" +
        "nicht der Inhalt. Klafft sie auseinander, ist die Vorlage wahrscheinlich\n" +
        "veraltet -- das muss ein Mensch oder Agent ansehen."
    );
  }

  if (drift.length || fehlt.length) {
    console.log(
      "\nBEIDE STAENDE MUESSEN GLEICH SEIN. Welcher der richtige ist, entscheidet der\n" +
        "Fall: Ist die Datei die gewollte Neuerung, wird die Anleitung nachgezogen.\n" +
        "Nennt die Anleitung etwas, das im Bausatz fehlt, ist die Datei nachzuziehen --\n" +
        "so entstanden am 21.08.2026 die Luecken (Projekt-Kontext-Check, working-method.md).\n" +
        "Was NICHT geht: eine Seite stehen lassen und die Abweichung vermerken."
    );
    process.exit(1);
  }
  process.exit(0);
}

main();
