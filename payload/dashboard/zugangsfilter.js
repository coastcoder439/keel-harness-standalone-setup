// GEHEIMNIS-FILTER -- was aus einer Datei NICHT in die Seite darf.
//
// WARUM DIESES MODUL EIGENSTAENDIG IST
// Es hat eine einzige Frage zu beantworten: sieht diese Zeile aus wie ein
// Zugang? Diese Frage hat eine eigene Fehlergeschichte, eigene Gegenproben und
// eine eigene Messlatte -- und sie wird an DREI Stellen gebraucht (inventar.js
// beim Lesen, render/data.js an der Engstelle, index.js vor dem Schreiben).
// Am 23.08.2026 stand sie noch in inventar.js und trieb die Datei auf genau
// 800 Zeilen, die Hausgrenze.
//
// DIE REGEL, an der sich hier alles messen laesst
// Ein Filter, der Richtiges unkenntlich macht, wird abgeschaltet und schuetzt
// danach gar nichts. Deshalb zaehlt jede Verschaerfung nur zusammen mit ihrer
// Gegenprobe: dashboard/test/inventar.test.js fuehrt beide Tabellen -- was
// fallen MUSS und was stehen bleiben MUSS.
//
// AUFRUF   const { textSichern, ZUGANGS_MUSTER, sperrgrund } = require("./zugangsfilter");

// Die Ausschluss-Vorschau: was NICHT als Geheimnis gilt, weil es ein Verweis
// darauf ist. Sie steht einmal hier und wird in beide Schluesselwort-Muster
// eingesetzt -- zwei Kopien waeren zwei Staende.
// Ein Geheimnis ist ein WERT, kein Ausdruck. Diese Vorschau schliesst aus, was
// erkennbar Code ist -- ein Verweis auf einen Zugang, ein Aufruf, ein Feld.
//
// Der teuerste Posten hier ist eigen: dieses Vorhaben benutzt "Token" im Sinne
// von LLM-Token, in Code UND in der Oberflaeche. Ohne die beiden Regeln
// "Feldzugriff" und "Aufruf" maskiert der Filter die eigene Kostenrechnung
// (gemessen 23.08.2026: 9 von 17 Treffern im eigenen Bestand waren genau das).
const KEIN_GEHEIMNIS =
  "(?!" +
  [
    // Verweis auf die Umgebung statt auf den Wert
    "process\\.env", "os\\.environ", "getenv", "System\\.getenv", "import\\.meta",
    "Deno\\.env", "ENV\\[",
    // Platzhalter und Einsetzungen
    "\\$", "\\{", "<", "--", "\\.\\.\\.", "xxx", "XXX", "YOUR", "DEIN", "your-", "dein-",
    // Leerwerte
    "null\\b", "undefined\\b", "true\\b", "false\\b",
    // Kennungen und Adressen sind oeffentlich, keine Geheimnisse
    "arn:", "https?:", "/", "\\.\\/",
    // CODE: ein Feldzugriff (kontext.tokenSchaetzung) oder ein Aufruf
    // (zahl(...), Math.round(...)) -- beides ist nie ein Geheimnis.
    "[A-Za-z_$][\\w$]*\\s*\\(",
    "[A-Za-z_$][\\w$]*\\.[A-Za-z_$]",
    // DIE EIGENE MASKIERUNG. Im JSON-Datensatz steht ein Zeilenumbruch als die
    // zwei Zeichen Backslash und n -- hinter "password:" sah das Muster damit
    // den Text \\n[ausgeblendet:zugang] als 22-Zeichen-Wert und schlug an. Der
    // Ausgabe-Waechter brach daraufhin einen Bau ab, dessen Geheimnis laengst
    // ersetzt war: die Maskierung loeste den Alarm aus, den sie verhindern
    // soll. Gemessen 23.08.2026 an einer Wegwerf-Werkbank mit sechs Zugaengen.
    // Ein Backslash ODER MEHRERE: bei doppelter Serialisierung (ein Datensatz,
    // der einen Datensatz enthaelt) wird aus \n erst \\n und dann \\\\n.
    "\\\\+n",
    "\\[ausgeblendet",
    // Eine Dezimalzahl ist kein Geheimnis. Der Fall, der es nachwies:
    // ZEICHEN_JE_TOKEN = 3.6 -- ein Konstantenname auf _TOKEN mit einem
    // Zahlenwert. Im gerenderten Text stand dahinter noch escaptes Markup,
    // zusammen ueber zwoelf Zeichen. Der Ausgabe-Waechter brach daran den
    // echten Bau ab (gemessen 23.08.2026). Reine Ziffernfolgen bleiben
    // verdaechtig -- ausgeschlossen ist nur die Zahl MIT Komma.
    "\\d+\\.\\d",
    // Escaptes Markup im gerenderten Text.
    "\\\\u00",
  ].join("|") +
  ")";

// Schluesselwoerter, die einen Zugang ankuendigen. Das [\w-]* dahinter, weil
// der Name selten dort aufhoert: aws_secret_access_key, DB_PASSWORD_PROD,
// api-key-v2. Ohne das endete das Muster am Schluesselwort und traf den
// Trenner nie -- gemessen 23.08.2026, aws_secret_access_key ging durch.
const SCHLUESSELWORT = "(api[_-]?key|token|secret|passw(or)?d|credential|passphrase)[\\w-]*";

const ZUGANGS_MUSTER = [
  // 1a -- Schluesselwort, Trenner, langer Wert.
  //
  // Die Wertklasse ist "alles bis zum naechsten Trennzeichen", NICHT
  // [A-Za-z0-9_+/=]. Die enge Fassung brach an jedem Satzzeichen: von
  // DB_PASSWORD=Sommer2026!Regen sah sie nur "Sommer2026" -- zehn Zeichen,
  // unter der Schwelle, also durchgelassen. Genau die Gestalt, die ein von
  // Menschen gewaehltes Passwort ueblicherweise hat (gemessen 23.08.2026:
  // sechs von sechs Proben durchgelassen).
  new RegExp(SCHLUESSELWORT + "[\"']?\\s*[:=]\\s*[\"']?" + KEIN_GEHEIMNIS + "[^\\s\"',;)]{12,}", "i"),

  // 1b -- derselbe Fall, aber kurzer Wert IN Anfuehrungszeichen.
  //
  // Wer einen Wert in Anfuehrungszeichen setzt, meint ihn woertlich. Acht
  // Zeichen genuegen dann als Verdacht -- password: "geheim12" faellt sonst
  // durch beide Netze.
  //
  // KEIN LEERZEICHEN im Wert: ein Geheimnis hat keins, eine Beschriftung
  // schon ("Token je Sitzung"). Ohne diese Schranke maskiert der Filter die
  // eigene Wortliste.
  new RegExp(SCHLUESSELWORT + "[\"']?\\s*[:=]\\s*[\"']" + KEIN_GEHEIMNIS + "[^\"'\\s]{8,}[\"']", "i"),

  // Anbieter-Formate: hier ist das Format selbst schon der Beweis.
  /ghp_[A-Za-z0-9]{20,}/,
  /github_pat_[A-Za-z0-9_]{20,}/,
  /gho_|ghu_|ghs_|ghr_/,
  /sk-[A-Za-z0-9]{20,}/,
  /sk_(live|test)_[A-Za-z0-9]{10,}/,
  /AKIA[0-9A-Z]{16}/,
  /ASIA[0-9A-Z]{16}/,
  /xox[baprs]-[A-Za-z0-9-]{10,}/,
  /AIza[0-9A-Za-z_-]{20,}/,
  /glpat-[0-9A-Za-z_-]{16,}/,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  /Bearer\s+[A-Za-z0-9._-]{10,}/,
  /npm_[A-Za-z0-9]{20,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY/,
  /https?:\/\/[^/\s:@]+:[^/\s@]+@/,
];

// Ein Schluessel steht nie in EINER Zeile. Die zeilenweise Maskierung traf die
// Kopfzeile und liess den Rumpf -- also den Schluessel selbst -- stehen
// (gefunden 23.08.2026, als kritisch bestaetigt). Deshalb: ab der Kopfzeile
// wird bis zur Schlusszeile alles maskiert.
const BLOCK_AUF = /-----BEGIN [A-Z ]*PRIVATE KEY/;
const BLOCK_ZU = /-----END [A-Z ]*PRIVATE KEY/;

// Ein Schluesselwort mit Trenner und NICHTS dahinter: der Wert steht in der
// naechsten Zeile. Kommt in YAML und in .env-Dateien mit Umbruch vor und
// entkam bisher beiden Netzen.
const WERT_FOLGT = new RegExp("^\\s*[\"']?" + SCHLUESSELWORT + "[\"']?\\s*[:=]\\s*[|>]?\\s*$", "i");

// Fallback NUR fuer den Fall, dass git fehlt -- dann greift Riegel 1 nicht, und
// ohne diese Liste laege settings.local.json im Klartext im Datensatz.
const MINI_SPERRLISTE = [
  /(^|\/)settings\.local\.json$/i,
  /(^|\/)\.env($|\.)/i,
  /\.key$/i,
  /\.pem$/i,
  /(^|\/)secrets\.json$/i,
  /(^|\/)credentials\.json$/i,
  /service-account[^/]*\.json$/i,
];

const AUSGEBLENDET = "[ausgeblendet:zugang]";


const zeilenAufteilen = (text) => String(text == null ? "" : text).split(/\r?\n/);


// ---------------------------------------------------------------------------
// RIEGEL 2 -- textSichern
// ---------------------------------------------------------------------------
// Ersetzt jede Zeile, die ein Zugangsmuster trifft, durch einen CODE und merkt
// sich die Zeilennummer. Kein Prosatext: was der Leser sieht, setzt render/data.js.
function textSichern(str) {
  if (str === null || str === undefined) return { text: "", ausgeblendeteZeilen: [] };
  const zeilen = zeilenAufteilen(typeof str === "string" ? str : String(str));
  const ausgeblendeteZeilen = [];

  // Zeilenweise reicht nicht. Zwei Gestalten entkommen einer reinen
  // Zeilenpruefung, beide am 23.08.2026 gemessen:
  //
  //   (a) Ein privater Schluessel. Die Kopfzeile trifft ein Muster, der RUMPF
  //       -- also der Schluessel selbst -- steht in den Zeilen danach und blieb
  //       im Klartext stehen. Als kritisch bestaetigt.
  //   (b) Der Wert in der naechsten Zeile (YAML, umgebrochene .env). Weder die
  //       Schluesselzeile noch die Wertzeile trifft fuer sich ein Muster.
  //
  // Deshalb traegt die Schleife zwei Zustaende mit: imBlock und wertFolgt.
  let imBlock = false;
  let wertFolgt = false;

  for (let i = 0; i < zeilen.length; i++) {
    const roh = zeilen[i];

    if (imBlock) {
      zeilen[i] = AUSGEBLENDET;
      ausgeblendeteZeilen.push(i + 1);
      if (BLOCK_ZU.test(roh)) imBlock = false;
      continue;
    }

    // Der angekuendigte Wert. Leerzeilen dazwischen werden uebersprungen, eine
    // Kommentarzeile beendet die Erwartung -- sonst maskiert eine erklaerende
    // Zeile unter "password:" faelschlich mit.
    if (wertFolgt) {
      if (!roh.trim()) continue;
      wertFolgt = false;
      // Eine bereits maskierte Zeile bleibt, wie sie ist -- sie ein zweites Mal
      // zu ersetzen zaehlt sie nur ein zweites Mal in ausgeblendeteZeilen.
      if (!/^\s*(#|\/\/)/.test(roh) && roh.trim() !== AUSGEBLENDET) {
        zeilen[i] = AUSGEBLENDET;
        ausgeblendeteZeilen.push(i + 1);
        continue;
      }
    }

    if (BLOCK_AUF.test(roh)) {
      imBlock = true;
      zeilen[i] = AUSGEBLENDET;
      ausgeblendeteZeilen.push(i + 1);
      continue;
    }

    if (ZUGANGS_MUSTER.some((m) => m.test(roh))) {
      zeilen[i] = AUSGEBLENDET;
      ausgeblendeteZeilen.push(i + 1);
      continue;
    }

    if (WERT_FOLGT.test(roh)) wertFolgt = true;
  }

  return { text: zeilen.join("\n"), ausgeblendeteZeilen };
}


// ---------------------------------------------------------------------------
// INHALT + RIEGEL 1 (7.3)
// ---------------------------------------------------------------------------
function sperrgrund(relPosix, git, gitVorhanden) {
  if (git === "ignoriert") return "ignoriert";
  // Die Sperrliste gilt IMMER, nicht nur wenn git fehlt.
  //
  // Vorher hing sie an !gitVorhanden -- in einem normalen Repo also nie. Eine
  // ungetrackte, aber nicht ignorierte .env landete damit im Klartext im
  // Datensatz, und eine .env.example, die eine .gitignore ausdruecklich wieder
  // aufnimmt (!.env.example), sogar als getrackte Datei. Beides am 23.08.2026
  // end-to-end gemessen. Der Name einer Datei sagt genug: was so heisst, wird
  // nicht eingebettet, ganz gleich was git dazu meint.
  if (MINI_SPERRLISTE.some((m) => m.test(relPosix))) return "sperrliste";
  return null;
}

module.exports = {
  ZUGANGS_MUSTER,
  BLOCK_AUF,
  BLOCK_ZU,
  WERT_FOLGT,
  AUSGEBLENDET,
  MINI_SPERRLISTE,
  textSichern,
  sperrgrund,
};
