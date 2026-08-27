#!/usr/bin/env node
// PreToolUse-Hook [Owner-Freigabe 27.08.2026]: erzwingt den Schritt ZUORDNEN.
//
// Der Arbeits-Kreislauf des Owners ist Erfassen (Problem/Intent/Goal) -> ZUORDNEN
// (bestehendes Arbeitspaket oder neues?) -> Ableiten -> Arbeiten -> Coverage ->
// Fulfillment -> Abschluss. Die Zuordnung existierte in keiner Regel, keinem Skill
// und keinem Waechter (Audit 27.08.2026, 180 Fundstellen) -- deshalb wurde sie
// uebersprungen, und Arbeit entstand ohne sichtbares Paket.
//
// Der Waechter blockt die ERSTE Schreibung einer Sitzung, solange kein Paket
// erklaert ist, und nennt Kandidaten. Er ist SELBSTAUFLOESEND: ein Schreibvorgang
// auf eine Paketdatei erklaert das Paket und hebt die Sperre -- der Agent loest das
// allein, ohne Rueckfrage an den Menschen.
//
// Ausgenommen: docs/packages/** (dort entsteht die Erklaerung), das Scratchpad und
// .claude/state/ (Zustand des Waechters selbst).
// Selbsttest: node paket-gate.js --selbsttest

const fs = require("fs");
const path = require("path");

const PAKET_ORDNER = "docs/packages/";
const STATE_ORDNER = ".claude/state/";
const ALTER_TAGE = 7;

function msysPfad(p) {
  if (process.platform !== "win32" || !p) return p;
  return String(p).replace(/^\/([A-Za-z])(?=\/|$)/, "$1:");
}

function normPfad(p) {
  return String(p || "").split("\\").join("/");
}

// Ausgenommen: Paketdateien selbst, Scratchpad, Waechter-Zustand.
function istAusgenommen(datei) {
  const p = normPfad(datei).toLowerCase();
  if (p.includes("/" + PAKET_ORDNER) || p.startsWith(PAKET_ORDNER)) return true;
  if (p.includes("/scratchpad/") || p.includes("appdata/local/temp/")) return true;
  if (p.includes("/.claude/state/") || p.includes(".claude/state/")) return true;
  return false;
}

// Schreibende Werkzeuge: nach Namen UND nach Kommando-String (die Werkbank faehrt
// PowerShell; ein Datei-Schreibbefehl dort traegt keinen bekannten Tool-Namen).
const SCHREIB_TOOLS = new Set(["Write", "Edit", "NotebookEdit"]);

function zielDatei(toolName, input) {
  if (!input || typeof input !== "object") return null;
  if (SCHREIB_TOOLS.has(toolName)) return input.file_path || input.notebook_path || null;
  return null;
}

// Kandidaten: Pakete, deren Name oder Problem-Zeile Woerter mit dem Anlass teilt.
function kandidaten(paketTexte, anlass) {
  const woerter = new Set(
    String(anlass || "")
      .toLowerCase()
      .split(/[^a-zäöüß0-9]+/)
      .filter((w) => w.length > 4)
  );
  const bewertet = paketTexte.map(({ name, problem }) => {
    const heu = (name + " " + problem).toLowerCase();
    let treffer = 0;
    for (const w of woerter) if (heu.includes(w)) treffer++;
    return { name, problem, treffer };
  });
  bewertet.sort((a, b) => b.treffer - a.treffer);
  return bewertet.slice(0, 5);
}

function meldung(liste) {
  const zeilen = liste.map((k) => `  · ${k.name} — ${k.problem.slice(0, 90)}`);
  return (
    "ZUORDNEN fehlt: In dieser Sitzung wurde noch kein Arbeitspaket erklaert, " +
    "und dieser Schreibvorgang liegt ausserhalb von docs/packages/. " +
    "Regel [Owner 27.08.2026]: vor der Arbeit steht die Frage, ob sie in ein " +
    "BESTEHENDES Paket gehoert oder ein NEUES braucht.\n" +
    "Kandidaten:\n" + (zeilen.join("\n") || "  (keine Pakete gefunden)") + "\n" +
    "Aufloesen ohne Rueckfrage: das passende Paket per Edit fortschreiben ODER ein " +
    "neues aus docs/packages/TEMPLATE.md anlegen. Beides erklaert das Paket und " +
    "hebt diese Sperre fuer die restliche Sitzung."
  );
}

// Zustand je Sitzung; alte Dateien raeumt der Waechter selbst weg.
function statePfad(wurzel, sessionId) {
  return path.join(wurzel, ".claude", "state", `paket-${String(sessionId).slice(0, 40)}.json`);
}

function aufraeumen(dir) {
  try {
    const grenze = Date.now() - ALTER_TAGE * 86400000;
    for (const n of fs.readdirSync(dir)) {
      const p = path.join(dir, n);
      if (fs.statSync(p).mtimeMs < grenze) fs.unlinkSync(p);
    }
  } catch {}
}

function paketeLesen(wurzel) {
  const dir = path.join(wurzel, "docs", "packages");
  const raus = [];
  try {
    for (const n of fs.readdirSync(dir)) {
      if (!n.endsWith(".md") || n === "TEMPLATE.md") continue;
      let problem = "";
      try {
        const t = fs.readFileSync(path.join(dir, n), "utf8");
        const m = t.match(/^\*\*Problem:\*\*\s*(.+)$/m);
        if (m) problem = m[1].trim();
      } catch {}
      raus.push({ name: n.slice(0, -3), problem });
    }
  } catch {}
  return raus;
}

// --- Selbsttest ---
if (process.argv.includes("--selbsttest")) {
  const pakete = [
    { name: "package-hygiene", problem: "Arbeitspakete werden redundant gebildet und verlieren offene Arbeit" },
    { name: "access-go-live", problem: "Fuenf Zugaenge stehen in der Matrix noch auf OFFEN" },
    { name: "dashboard-v3", problem: "Das Dashboard ist fuer Maschinen gebaut, nicht fuer Menschen" },
  ];
  const faelle = [
    ["Paketdatei ist ausgenommen", istAusgenommen("docs/packages/foo.md"), true],
    ["Paketdatei absolut ausgenommen", istAusgenommen("C:\\repo\\docs\\packages\\foo.md"), true],
    ["Scratchpad ausgenommen", istAusgenommen("C:/Users/x/AppData/Local/Temp/claude/y/scratchpad/z.md"), true],
    ["State ausgenommen", istAusgenommen(".claude/state/paket-abc.json"), true],
    ["normale Quelldatei NICHT ausgenommen", istAusgenommen("dashboard/render/labels.js"), false],
    ["Write liefert Zielpfad", zielDatei("Write", { file_path: "a.js" }) === "a.js", true],
    ["Bash liefert keinen Zielpfad", zielDatei("Bash", { command: "ls" }) === null, true],
    ["Kandidat trifft ueber Wortueberlappung",
      kandidaten(pakete, "die Zugaenge sind noch nicht verbunden")[0].name === "access-go-live", true],
    ["Meldung nennt Aufloesung", meldung(kandidaten(pakete, "dashboard")).includes("TEMPLATE.md"), true],
  ];
  let fehler = 0;
  for (const [name, ist, soll] of faelle) {
    const ok = ist === soll;
    if (!ok) fehler++;
    console.log(`${ok ? "ok  " : "FEHL"} ${name}`);
  }
  console.log(`${faelle.length - fehler} von ${faelle.length} Faellen richtig.`);
  process.exit(fehler ? 1 : 0);
}

let eingabe = "";
process.stdin.on("data", (c) => (eingabe += c));
process.stdin.on("end", () => {
  let daten = {};
  try {
    daten = JSON.parse(eingabe || "{}");
  } catch {}
  const wurzel = msysPfad(process.env.CLAUDE_PROJECT_DIR);
  const sessionId = daten.session_id;
  if (!wurzel || !sessionId) return process.exit(0); // fail-open wie alle Waechter

  const datei = zielDatei(daten.tool_name, daten.tool_input);
  if (!datei) return process.exit(0);

  const stateDir = path.join(wurzel, ".claude", "state");
  const sp = statePfad(wurzel, sessionId);

  // Ein Schreibvorgang auf eine Paketdatei ERKLAERT das Paket.
  if (istAusgenommen(datei)) {
    const p = normPfad(datei);
    if (p.includes(PAKET_ORDNER) && !p.endsWith("TEMPLATE.md")) {
      try {
        fs.mkdirSync(stateDir, { recursive: true });
        aufraeumen(stateDir);
        fs.writeFileSync(sp, JSON.stringify({ paket: path.basename(p, ".md") }), "utf8");
      } catch {}
    }
    return process.exit(0);
  }

  if (fs.existsSync(sp)) return process.exit(0); // Paket ist erklaert

  const anlass = String(daten.prompt || datei || "");
  process.stderr.write("paket-gate: " + meldung(kandidaten(paketeLesen(wurzel), anlass)) + "\n");
  process.exit(2);
});
