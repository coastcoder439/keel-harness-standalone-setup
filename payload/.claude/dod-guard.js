#!/usr/bin/env node
// Stop-Hook: ausschliesslich Definition-of-Done-Antwortformat.
//
// Seit 07.10.2026 (Karte Arbeitsweise statt Paketpflicht) sperrt der Hook einer Hauptsitzung NUR noch beim
// Fertig-Anspruch: behauptet die letzte Antwort, die eigene Arbeit sei fertig (fertig, erledigt, abgeschlossen,
// behoben, gefixt, done, completed ...), muss sie das Abschluss-Format tragen:
//   "Geprueft gegen: ..." UND "Offen: ..."
// Fehlt eine der beiden Zeilen, wird das Turn-Ende einmal geblockt (exit 2) -- mit dem Weg: Zeilen ergaenzen oder
// den Anspruch zurueknehmen. Schreibversuche und "git ... commit" im Text loesen nichts mehr aus: eine Sitzung,
// die arbeitet und nichts als fertig meldet, wird nie gestoert.
//
// Arbeitsagenten (vom Package-Executor gestartet, KEEL_PACKAGE_SESSION in der Umgebung) behalten die alte Regel:
// Hat der Turn ARBEIT geleistet (Write/Edit/NotebookEdit oder ein git commit), muss die Schluss-Nachricht das
// Format tragen. Die Rolle bestimmt der Host (isWorkerSession), nicht der Agent.
//
// Dieser Waechter parst kein PACKAGE.md, fuehrt keine Gates aus und erzeugt keinen
// Lifecycle-Zustand. Nur `package-cli close` darf ein Paket schliessen.
//
// Warum FORMAT-Check statt Wortmuster-Raten [Owner, 24.08.2026]: ein Verbot
// ("sag nie fertig") ist Prosa und wurde am selben Tag live verfehlt; ein
// Format ist eine messbare Struktur. Der Ausloeser ist seit 07.10.2026 der Fertig-Anspruch selbst
// (harness-core/guards/done-claim.cjs): dort, wo die Antwort etwas behauptet, muss sie auch belegen.
// Evidenz-Hintergrund: Compliance sinkt mit dem SESSION-FORTSCHRITT
// (arXiv 2605.10039: -5,6% Odds je generierter Funktion) -- genau dafuer
// braucht es eine Schranke, die am ENDE des Turns greift, nicht am Anfang.
// Selbsttest: node dod-guard.js --selbsttest

const fs = require("fs");
// MSYS/Git-Bash schreibt Laufwerke als /c/...; die eine Umschrift aller Waechter.
const { isWorkerSession, msysPath: msysPfad } = require("../harness-core/guards/hook-context.cjs");
// Der Fertig-Anspruch: eine Aussage der Antwort ueber die eigene, abgeschlossene Arbeit (eine Stelle fuer beide Stop-Hooks).
const { doneClaim } = require("../harness-core/guards/done-claim.cjs");

const ARBEITS_TOOLS = new Set(["Write", "Edit", "NotebookEdit"]);
// Commit-Erkennung SHELL-UNABHAENGIG [Fix 27.08.2026, Audit-Befund]: die alte Fassung
// prueste nur `b.name === "Bash"`. Diese Werkbank faehrt PowerShell als Primaer-Shell --
// jeder Commit darueber entkam dem Waechter vollstaendig. Jetzt zaehlt der Kommando-
// STRING in irgendeinem Feld des Tool-Inputs, gleich welches Werkzeug ihn ausfuehrt.
const COMMIT_MUSTER = /\bgit\b[^\n]{0,400}\bcommit\b/;
function istCommit(input) {
  if (!input || typeof input !== "object") return false;
  for (const wert of Object.values(input)) {
    if (typeof wert === "string" && COMMIT_MUSTER.test(wert)) return true;
  }
  return false;
}
const DOD_GEPRUEFT = /gepr(ue|ü)ft gegen\s*:/i;
const DOD_OFFEN = /\boffen\s*:/i;

// Echte User-Nachricht = string-Content oder Liste mit text-Block und OHNE
// tool_result (Werkzeug-Rueckgaben laufen als type:user mit tool_result-Bloecken).
function istEchteUserNachricht(e) {
  if (e.type !== "user") return false;
  const c = e.message && e.message.content;
  if (typeof c === "string") return true;
  if (!Array.isArray(c)) return false;
  if (c.some((b) => b && b.type === "tool_result")) return false;
  return c.some((b) => b && b.type === "text");
}

// Letzte Schluss-Nachricht des Turns: der letzte nicht leere Text-Block nach der letzten echten User-Nachricht.
function schlussTextUndArbeit(eintraege) {
  let letzterUser = -1;
  for (let i = eintraege.length - 1; i >= 0; i--) {
    if (istEchteUserNachricht(eintraege[i])) { letzterUser = i; break; }
  }
  let arbeit = false;
  let schlussText = "";
  for (let i = letzterUser + 1; i < eintraege.length; i++) {
    const e = eintraege[i];
    if (e.type !== "assistant") continue;
    const c = e.message && e.message.content;
    if (!Array.isArray(c)) continue;
    for (const b of c) {
      if (!b) continue;
      if (b.type === "tool_use") {
        if (ARBEITS_TOOLS.has(b.name)) arbeit = true;
        else if (istCommit(b.input)) arbeit = true;
      } else if (b.type === "text" && b.text && b.text.trim()) {
        schlussText = b.text;
      }
    }
  }
  return { schlussText, arbeit };
}

function hatAbschlussZeilen(text) {
  return DOD_GEPRUEFT.test(text) && DOD_OFFEN.test(text);
}

// Analyse pur, testbar: bekommt die geparsten Transcript-Eintraege. Rueckgabe null = frei, sonst der Hinweis.
//   Hauptsitzung (Voreinstellung): nur der Fertig-Anspruch der letzten Antwort ohne beide Zeilen sperrt.
//   optionen.arbeitsagent: die alte Regel -- Arbeit im Turn (Write/Edit/Commit) braucht das Format, auch ohne Anspruch.
function pruefen(eintraege, optionen = {}) {
  const { schlussText, arbeit } = schlussTextUndArbeit(eintraege);
  if (optionen.arbeitsagent === true) {
    if (!arbeit) return null;
    // Ohne Schlusstext darf ein Arbeits-Turn nicht frei durchgehen [Fix 27.08.2026].
    if (!schlussText) return HINWEIS_ARBEIT;
    return hatAbschlussZeilen(schlussText) ? null : HINWEIS_ARBEIT;
  }
  if (!schlussText) return null;
  const anspruch = doneClaim(schlussText);
  if (!anspruch) return null;
  return hatAbschlussZeilen(schlussText) ? null : hinweisFertig(anspruch);
}

function stopCycleIsActive(payload) {
  return Boolean(payload && payload.stop_hook_active);
}

const KEIN_CLOSE = "Das ist nur Berichtsformat: selbst `Offen: nichts` ersetzt weder Gate-Reverify noch das Close-Receipt von `package-cli close`. (working-method.md.)";

// Der Weg steht in der Meldung: Zeilen ergaenzen oder den Anspruch zurueknehmen. Gesperrt wird einmal je Zyklus.
function hinweisFertig(anspruch) {
  return "Die letzte Antwort meldet Fertigsein (\"" + anspruch + "\"), traegt aber kein Definition-of-Done-Format. " +
    "Weg: ergaenze am Ende zwei Zeilen: \"Geprueft gegen: <Quellen/Tests/Kommandos>\" und \"Offen: <Liste oder nichts>\"; " +
    "oder nimm den Anspruch zurueck und sag, was noch fehlt. " + KEIN_CLOSE;
}

const HINWEIS_ARBEIT =
  "Dieser Turn hat Dateien geschrieben oder committet, aber die Schluss-Nachricht " +
  "traegt kein Definition-of-Done-Format. Ergaenze am Ende der Meldung zwei Zeilen: " +
  '"Geprueft gegen: <Quellen/Tests/Kommandos>" und "Offen: <Liste oder nichts>". ' +
  KEIN_CLOSE;

// --- Lesen des Gespraechsendes (A15) ---
// Nicht die ganze Transkriptdatei, nur das Ende: die letzten LESE_BLOCK Bytes, ausgewertet ab dem ersten
// vollstaendigen Zeilenanfang. Reicht der Block nicht bis zur letzten echten User-Nachricht (pruefen()
// braucht sie samt allem danach), wird rueckwaerts in weiteren Bloecken nachgelesen, bis sie gefunden ist
// oder der Dateianfang erreicht wird. Ergebnis und Logik sind die der ganzen Datei.
const LESE_BLOCK = 512 * 1024;

function parseZeilen(buffer) {
  const eintraege = [];
  for (const zeile of buffer.toString("utf8").split("\n")) {
    if (!zeile.trim()) continue;
    try { eintraege.push(JSON.parse(zeile)); } catch { /* beschaedigte Zeile */ }
  }
  return eintraege;
}

// Gibt { eintraege, gelesen } zurueck: die Eintraege ab (mindestens) der letzten echten User-Nachricht und die
// Zahl der gelesenen Bytes. Wirft bei einem Lesefehler (der Aufrufer ist dann fail-open wie alle Waechter).
function leseEintraegeAbLetztemUser(pfad, blockBytes = LESE_BLOCK) {
  const fd = fs.openSync(pfad, "r");
  try {
    const groesse = fs.fstatSync(fd).size;
    let ende = groesse;
    let rest = Buffer.alloc(0); // Anfang der ersten (noch unvollstaendigen) Zeile des bisher Gelesenen
    let eintraege = [];
    let gelesen = 0;
    while (ende > 0) {
      const start = Math.max(0, ende - blockBytes);
      const block = Buffer.alloc(ende - start);
      let gefuellt = 0;
      while (gefuellt < block.length) {
        const n = fs.readSync(fd, block, gefuellt, block.length - gefuellt, start + gefuellt);
        if (n === 0) break;
        gefuellt += n;
      }
      gelesen += gefuellt;
      const daten = Buffer.concat([block.subarray(0, gefuellt), rest]);
      ende = start;
      let vollstaendig = daten;
      if (start > 0) {
        const umbruch = daten.indexOf(0x0a);
        if (umbruch < 0) { rest = daten; continue; } // eine Zeile groesser als der Block: weiterlesen
        rest = daten.subarray(0, umbruch);
        vollstaendig = daten.subarray(umbruch + 1);
      } else {
        rest = Buffer.alloc(0);
      }
      eintraege = parseZeilen(vollstaendig).concat(eintraege);
      if (eintraege.some(istEchteUserNachricht)) break;
    }
    return { eintraege, gelesen };
  } finally {
    fs.closeSync(fd);
  }
}

// --- Selbsttest: Fixtures in-memory ---
if (require.main === module && process.argv.includes("--selbsttest")) {
  const user = (t) => ({ type: "user", message: { content: t } });
  const toolResult = () => ({ type: "user", message: { content: [{ type: "tool_result", content: "ok" }] } });
  const edit = () => ({ type: "assistant", message: { content: [{ type: "tool_use", name: "Edit", input: {} }] } });
  const bash = (cmd) => ({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: { command: cmd } }] } });
  const ps = (cmd) => ({ type: "assistant", message: { content: [{ type: "tool_use", name: "PowerShell", input: { command: cmd, description: "x" } }] } });
  const text = (t) => ({ type: "assistant", message: { content: [{ type: "text", text: t }] } });
  const DOD = "Alles gebaut.\nGeprueft gegen: Tests 5/5\nOffen: nichts";
  // [Name, Eintraege, sollBlock, Rolle]: Hauptsitzung (Voreinstellung) oder "arbeitsagent" (alte Regel).
  const faelle = [
    ["Fertig-Anspruch + DoD -> frei", [user("bau"), edit(), toolResult(), text(DOD)], false],
    ["Fertig-Anspruch ohne DoD -> BLOCK", [user("bau"), edit(), toolResult(), text("Fertig, alles erledigt!")], true],
    ["nur Geprueft gegen, kein Offen -> BLOCK", [user("bau"), text("Fertig.\nGeprueft gegen: Tests")], true],
    ["nur Offen, kein Geprueft gegen -> BLOCK", [user("bau"), text("Fertig.\nOffen: nichts")], true],
    ["Schreibversuch ohne Anspruch -> frei", [user("bau"), edit(), toolResult(), text("Ich habe die Datei geaendert.")], false],
    ["Schreibversuch ohne Schlusstext -> frei", [user("bau"), edit(), toolResult()], false],
    ["Commit im Befehl, kein Anspruch -> frei", [user("sichern"), bash('git commit -m "x" -- a.md'), toolResult(), text("Commit liegt vor.")], false],
    ["PowerShell-Commit, Anspruch ohne DoD -> BLOCK", [user("sichern"), ps('git commit -m "x" -- a.md; git push'), toolResult(), text("Gesichert und erledigt.")], true],
    ["PowerShell-Commit mit DoD -> frei", [user("sichern"), ps('git commit -m "x" -- a.md'), toolResult(), text(DOD)], false],
    ["Frage beantwortet -> frei", [user("was ist X?"), text("X ist Y.")], false],
    ["Umlaut-Form -> frei", [user("bau"), edit(), toolResult(), text("Done.\nGeprüft gegen: Lauf\nOffen: A")], false],
    ["Anspruch verneint -> frei", [user("bau"), edit(), toolResult(), text("Das ist noch nicht fertig.")], false],
    ["Anspruch als Frage -> frei", [user("bau"), text("Bist du damit fertig?")], false],
    ["Arbeitsagent: Schreibversuch ohne DoD -> BLOCK", [user("bau"), edit(), toolResult(), text("Angepasst.")], true, "arbeitsagent"],
    ["Arbeitsagent: ohne Schlusstext -> BLOCK", [user("bau"), edit(), toolResult()], true, "arbeitsagent"],
    ["Arbeitsagent: Commit ohne DoD -> BLOCK", [user("sichern"), bash('git commit -m "x"'), toolResult(), text("Committet.")], true, "arbeitsagent"],
    ["Arbeitsagent: Arbeit mit DoD -> frei", [user("bau"), edit(), toolResult(), text(DOD)], false, "arbeitsagent"],
    ["Arbeitsagent: git status ist keine Arbeit -> frei", [user("status?"), bash("git status"), toolResult(), text("Sauber.")], false, "arbeitsagent"],
  ];
  let fehler = 0;
  for (const [name, eintraege, sollBlock, rolle] of faelle) {
    const ist = pruefen(eintraege, { arbeitsagent: rolle === "arbeitsagent" }) !== null;
    const ok = ist === sollBlock;
    if (!ok) fehler++;
    console.log(`${ok ? "ok  " : "FEHL"} ${sollBlock ? "BLOCK" : "frei "} ${name}`);
  }
  const coexistence = stopCycleIsActive({ stop_hook_active: true }) &&
    hinweisFertig("Fertig.").includes("package-cli close") && hinweisFertig("Fertig.").includes("Offen: nichts") &&
    hinweisFertig("Fertig.").includes("nimm den Anspruch zurueck");
  if (!coexistence) fehler++;
  console.log(`${coexistence ? "ok  " : "FEHL"} frei  Stop-Zyklus bleibt einmalig, der Hinweis nennt den Weg und DoD ist kein Close`);
  console.log(`${faelle.length + 1 - fehler} von ${faelle.length + 1} Faellen richtig.`);
  process.exit(fehler ? 1 : 0);
}

if (require.main === module) {
  let eingabe = "";
  process.stdin.on("data", (c) => (eingabe += c));
  process.stdin.on("end", () => {
    let daten = {};
    try {
      daten = JSON.parse(eingabe || "{}");
    } catch {}
    // Einmal blocken genuegt: im Block-Zyklus (stop_hook_active) nicht erneut.
    if (stopCycleIsActive(daten)) return process.exit(0);
    // Die Rolle setzt der Host beim Start (KEEL_PACKAGE_SESSION), kein Werkzeugaufruf aendert sie.
    const optionen = { arbeitsagent: isWorkerSession(process.env) };
    const pfad = msysPfad(daten.transcript_path);
    let grund = null;
    if (pfad) {
      let eintraege = [];
      try {
        eintraege = leseEintraegeAbLetztemUser(pfad).eintraege;
      } catch {
        return process.exit(0); // fail-open wie alle Waechter
      }
      grund = pruefen(eintraege, optionen);
    } else if (!optionen.arbeitsagent && typeof daten.last_assistant_message === "string") {
      // Ohne Transkript (Host-Feld last_assistant_message): derselbe Fertig-Anspruch, dieselbe Pruefung.
      grund = pruefen([{ type: "assistant", message: { content: [{ type: "text", text: daten.last_assistant_message }] } }], optionen);
    }
    if (grund) {
      process.stderr.write("dod-guard: " + grund + "\n");
      process.exit(2);
    }
    process.exit(0);
  });
}

module.exports = { LESE_BLOCK, hinweisFertig, istEchteUserNachricht, leseEintraegeAbLetztemUser, pruefen, schlussTextUndArbeit };
