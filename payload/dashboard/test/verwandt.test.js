// Test zu dashboard/verwandt.js -- Bordmittel, node:test.
//
// Die scharfe Frage dieses Moduls ist nicht "findet es Kanten", sondern
// "traegt jede Kante einen Beleg, und zeigt keine ins Leere". Beides wird hier
// gegen den echten Baum geprueft und zusaetzlich an einem Vorlagen-Baum, in dem
// ein toter Verweis absichtlich eingebaut ist.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");

const { verwandt } = require("../verwandt.js");

const WURZEL = path.resolve(__dirname, "..", "..");

// --- Vorbedingung -----------------------------------------------------------
// Manche Pruefungen betreffen den INHALT eines gewachsenen Workspace (eine
// git-ignorierte Datei, die Werkstatt-Dokumente, Projekt-Repos). In einer
// frischen Installation gibt es das zu Recht nicht. Ein Test, der dort
// scheitert, meldet einen Fehler, wo nur eine Bedingung fehlt -- und rote Tests
// beim Empfaenger sind schlimmer als keine. Deshalb: uebersprungen MIT Grund,
// nie stillschweigend bestanden.
function wennDa(bedingung, grund, name, fn) {
  if (bedingung) return test(name, fn);
  return test(name + "  [uebersprungen: " + grund + "]", { skip: true }, fn);
}
const ARTEN = [
  "eingetragen-in",
  "beschrieben-in",
  "ruft-auf",
  "lizenz",
  "verweist-auf",
  "geaendert-in",
  "ignoriert-in",
];

// ---------------------------------------------------------------------------
// Bestand des echten Baums -- so, wie measure.js ihn spaeter liefert:
// Datei-IDs aus dem Walk, Repo-IDs aus user-projects/.
// ---------------------------------------------------------------------------
const AUSGESCHLOSSEN = new Set([".git", "node_modules", "user-projects"]);
const ERZEUGT = new Set(["dashboard.html", "dashboard.json"]);

function dateiIdsSammeln(wurzel) {
  const ids = new Set();
  (function lauf(ordner) {
    for (const e of fs.readdirSync(ordner, { withFileTypes: true })) {
      if (AUSGESCHLOSSEN.has(e.name)) continue;
      const voll = path.join(ordner, e.name);
      const rel = path.relative(wurzel, voll).split(path.sep).join("/");
      if (e.isDirectory()) lauf(voll);
      else if (!ERZEUGT.has(rel)) ids.add("datei:" + rel);
    }
  })(wurzel);
  return ids;
}

function bestandEcht() {
  // user-projects/ gibt es nur in einem gewachsenen Workspace. In einer frischen
  // Installation fehlt der Ordner zu Recht -- und readdirSync warf dort ENOENT
  // und riss sieben Pruefungen mit, die mit Projekt-Repos gar nichts zu tun
  // haben. Gemessen am 23.08.2026 in einer Testinstallation.
  let repos = [];
  try {
    repos = fs
      .readdirSync(path.join(WURZEL, "user-projects"), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => "repo:" + e.name);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  return { dateiIds: dateiIdsSammeln(WURZEL), hookIds: [], repoIds: repos, commitIds: [] };
}

function baumBauen(dateien) {
  const wurzel = fs.mkdtempSync(path.join(os.tmpdir(), "harness-tmp-verwandt-"));
  for (const [rel, text] of Object.entries(dateien)) {
    const ziel = path.join(wurzel, rel);
    fs.mkdirSync(path.dirname(ziel), { recursive: true });
    fs.writeFileSync(ziel, text);
  }
  return wurzel;
}

const baumWeg = (wurzel) => fs.rmSync(wurzel, { recursive: true, force: true });
const zerlegen = (b) => ({ datei: b.slice(0, b.lastIndexOf(":")), zeile: Number(b.slice(b.lastIndexOf(":") + 1)) });

// ---------------------------------------------------------------------------
// Echter Baum
// ---------------------------------------------------------------------------
test("settings.json -> danger-guard.js: Kante da, Beleg auf der richtigen Zeile", () => {
  const { kanten } = verwandt(WURZEL, bestandEcht());
  const treffer = kanten.filter(
    (k) => k.von === "datei:.claude/settings.json" && k.nach === "datei:.claude/danger-guard.js"
  );
  assert.strictEqual(treffer.length, 1, "genau eine Kante, keine Dubletten");
  assert.strictEqual(treffer[0].art, "eingetragen-in");

  // Gegenprobe an der Quelle: welche Zeile nennt danger-guard.js wirklich?
  const zeilen = fs.readFileSync(path.join(WURZEL, ".claude/settings.json"), "utf8").split(/\r?\n/);
  const echte = zeilen.findIndex((z) => /"command"\s*:/.test(z) && z.includes("danger-guard.js")) + 1;
  assert.ok(echte > 0, "settings.json traegt den Eintrag ueberhaupt");
  assert.strictEqual(treffer[0].beleg, ".claude/settings.json:" + echte);
});

test("keine tote Kante: jede nach-ID steht im Bestand", () => {
  const bestand = bestandEcht();
  const { kanten } = verwandt(WURZEL, bestand);
  const bekannt = new Set([...bestand.dateiIds, ...bestand.repoIds].map((s) => s.toLowerCase()));
  assert.ok(kanten.length > 0);
  for (const k of kanten) {
    // Externe Ziele (heute: MCP-Werkzeuge) liegen nicht auf der Platte -- es gibt
    // kein Verzeichnis, gegen das man sie pruefen koennte. Sie MUESSEN dafuer als
    // extern gekennzeichnet sein, damit die Oberflaeche keinen Sprung anbietet.
    if (k.extern) {
      assert.ok(!bekannt.has(k.nach.toLowerCase()), "externe Kante zeigt nicht auf einen lokalen Eintrag: " + k.nach);
      assert.ok(/^[a-z]+:/.test(k.nach), "externe Kante traegt ein Praefix: " + k.nach);
    } else {
      assert.ok(bekannt.has(k.nach.toLowerCase()), "nach existiert: " + k.nach + " (" + k.beleg + ")");
    }
    assert.ok(bekannt.has(k.von.toLowerCase()), "von existiert: " + k.von);
    assert.ok(ARTEN.includes(k.art), "art ist ein Code aus dem festen Satz: " + k.art);
  }
});

test("jeder Beleg zeigt auf eine reale Zeile, die den Namen wirklich nennt", () => {
  const { kanten } = verwandt(WURZEL, bestandEcht());
  for (const k of kanten) {
    const { datei, zeile } = zerlegen(k.beleg);
    assert.ok(!k.beleg.includes("\\"), "Beleg POSIX: " + k.beleg);
    const zeilen = fs.readFileSync(path.join(WURZEL, datei), "utf8").split(/\r?\n/);
    assert.ok(zeile >= 1 && zeile <= zeilen.length, "Zeile im Bereich: " + k.beleg);
    // Die Lizenz-Kante ist die einzige, deren Ziel aus einem FELD abgeleitet wird
    // ("license: MIT") statt wortwoertlich in der Zeile zu stehen.
    if (k.art === "lizenz") continue;
    const name = k.nach.slice(k.nach.indexOf(":") + 1).split("/").pop();
    assert.ok(zeilen[zeile - 1].includes(name), "Zeile nennt " + name + ": " + k.beleg);
  }
});

test("Rule-Verweis auf docs/: erst Existenz, dann Kante oder Befund", () => {
  const bestand = bestandEcht();
  const { kanten, fehler } = verwandt(WURZEL, bestand);
  const quelle = ".claude/rules/keel/tools.md";
  const ziel = "docs/tool-sourcing.md";

  // Was steht wirklich in der Regel, und in welcher Zeile?
  const zeilen = fs.readFileSync(path.join(WURZEL, quelle), "utf8").split(/\r?\n/);
  const zeile = zeilen.findIndex((z) => z.includes(ziel)) + 1;
  assert.ok(zeile > 0, "tools.md verweist ueberhaupt auf " + ziel);

  const kante = kanten.find((k) => k.von === "datei:" + quelle && k.nach === "datei:" + ziel);
  const befund = fehler.find((f) => f.von === "datei:" + quelle && f.name === ziel);
  if (fs.existsSync(path.join(WURZEL, ziel))) {
    assert.ok(kante, "Ziel existiert -> Kante");
    assert.strictEqual(kante.art, "verweist-auf");
    assert.strictEqual(kante.beleg, quelle + ":" + zeile);
    assert.strictEqual(befund, undefined);
  } else {
    assert.strictEqual(kante, undefined, "Ziel fehlt -> keine Kante");
    assert.ok(befund, "Ziel fehlt -> Befund");
  }
});

test("umbrochener Verwandt-Block wird ganz gelesen", () => {
  const { kanten } = verwandt(WURZEL, bestandEcht());
  const aus = kanten.filter((k) => k.von === "datei:.claude/rules/keel/working-method.md");
  const ziele = aus.map((k) => k.nach).sort();
  assert.deepStrictEqual(ziele, [
    "datei:.claude/rules/keel/completeness.md",
    "datei:.claude/rules/keel/no-oneshot.md",
  ]);
});

test("erfundene nach-ID landet in fehler, nicht in kanten", () => {
  const bestand = bestandEcht();
  // Der Bestand kennt danger-guard.js nicht mehr -- der Eintrag in settings.json
  // bleibt aber stehen. Genau so sieht ein geloeschtes Skript aus.
  bestand.dateiIds.delete("datei:.claude/danger-guard.js");
  const { kanten, fehler } = verwandt(WURZEL, bestand);
  assert.ok(
    !kanten.some((k) => k.nach === "datei:.claude/danger-guard.js"),
    "keine Kante auf ein Ziel ausserhalb des Bestands"
  );
  const befunde = fehler.filter((f) => f.name === ".claude/danger-guard.js");
  assert.ok(befunde.length >= 1, "der Wegfall wird gemeldet");
  for (const f of befunde) {
    assert.ok(["nach-fehlt", "ziel-unbekannt"].includes(f.code), "Code statt Prosa: " + f.code);
    assert.ok(f.beleg && f.beleg.includes(":"), "auch der Befund traegt seinen Fundort");
  }
});

wennDa(fs.existsSync(WURZEL + "/.gitignore") && fs.readFileSync(WURZEL + "/.gitignore", "utf8").includes("user-projects/"),
  "keine Projektzeilen in der .gitignore",
  "Messwerte des echten Baums je art", () => {
  const { kanten, fehler } = verwandt(WURZEL, bestandEcht());
  const jeArt = {};
  for (const k of kanten) jeArt[k.art] = (jeArt[k.art] || 0) + 1;
  // Nachgemessen am Baum am 23.08.2026. Aendert sich der Baum, aendert sich die
  // Zahl -- der Test haelt fest, WORAUS sie kommt, nicht dass sie ewig gilt.
  // Statt einer festen Gesamtzahl, die mit jeder neuen Datei altert: die Zahlen
  // werden gegen die QUELLE geprueft, aus der sie stammen. So faellt der Test,
  // wenn die Messung falsch liest -- und nicht, wenn jemand eine Datei anlegt.
  const fs = require("fs");
  const settings = fs.readFileSync(WURZEL + "/.claude/settings.json", "utf8");
  const commandZeilen = (settings.match(/"command"\s*:/g) || []).length;
  assert.strictEqual(jeArt["eingetragen-in"], commandZeilen,
    "je command-Eintrag in settings.json eine Kante (" + commandZeilen + " gezaehlt)");

  const ignoriert = fs.readFileSync(WURZEL + "/.gitignore", "utf8")
    .split(/\r?\n/).filter((z) => /^user-projects\/\S/.test(z)).length;
  assert.strictEqual(jeArt["ignoriert-in"], ignoriert,
    "je Projektzeile in .gitignore eine Kante (" + ignoriert + " gezaehlt)");

  assert.ok(jeArt["lizenz"] >= 2, "mindestens die beiden mattpocock-Herkuenfte");
  assert.strictEqual(kanten.length, Object.values(jeArt).reduce((a, b) => a + b, 0),
    "die Summe je Art ergibt die Gesamtzahl");

  // MCP-Aufrufe: ohne mcpIds im Bestand gibt es kein lokales Verzeichnis zum
  // Vergleichen. Sie gelten trotzdem -- aber als extern gekennzeichnet, damit
  // die Oberflaeche sie nicht als Sprung anbietet.
  const externe = kanten.filter((k) => k.extern);
  assert.ok(externe.length > 0, "die MCP-Aufrufe der Commands sind als Kanten da");
  assert.ok(externe.every((k) => k.nach.startsWith("mcp:")), "extern ist heute nur MCP");
  assert.strictEqual(fehler.length, 0, "keine verworfene Kante mehr: " + JSON.stringify(fehler.slice(0, 2)));
});

wennDa(fs.existsSync(WURZEL + "/.claude/commands/session-map.md"), "Command session-map.md nicht vorhanden",
  "mit mcpIds im Bestand werden die MCP-Aufrufe zu Kanten", () => {
  const bestand = bestandEcht();
  bestand.mcpIds = ["mcp:mcp__ccd_session_mgmt__list_sessions", "mcp:mcp__ccd_session_mgmt__send_message"];
  const { kanten, fehler } = verwandt(WURZEL, bestand);
  // Geprueft wird die MCP-Aufloesung, nicht der Zustand des ganzen Baums:
  // ein anderer Verweis, der in dieser Installation ins Leere zeigt, gehoert
  // in seinen eigenen Test und darf diesen hier nicht mitreissen.
  assert.deepStrictEqual(
    fehler.filter((f) => String(f.nach || "").startsWith("mcp:")),
    [],
    "mit bekannten mcpIds bleibt kein MCP-Ziel offen"
  );
  const mcpKanten = kanten.filter((k) => k.nach.startsWith("mcp:"));
  assert.ok(mcpKanten.length > 0, "die Commands rufen ueberhaupt MCP-Werkzeuge auf");
  // Jede MCP-Kante traegt einen Beleg und ist als extern gekennzeichnet.
  for (const k of mcpKanten) {
    assert.ok(k.beleg && k.beleg.includes(":"), "MCP-Kante mit Fundort: " + k.nach);
  }
});

// ---------------------------------------------------------------------------
// Vorlagen-Baum: CRLF und ein absichtlich toter Verweis
// ---------------------------------------------------------------------------
test("CRLF-Quellen: richtige Zeilennummern, kein Wagenruecklauf, POSIX-Pfade", () => {
  const wurzel = baumBauen({
    ".claude/settings.json":
      '{\r\n  "hooks": {\r\n    "Stop": [\r\n      {\r\n        "hooks": [\r\n' +
      '          { "type": "command", "command": "node \\"$CLAUDE_PROJECT_DIR/.claude/mini-guard.js\\"" }\r\n' +
      "        ]\r\n      }\r\n    ]\r\n  }\r\n}\r\n",
    ".claude/mini-guard.js": "// nichts\r\n",
    "CLAUDE.md": "# Kopf\r\n\r\n## 3. Was installiert ist\r\n\r\n| `mini-guard.js` | immer |\r\n\r\n## 4. Ende\r\n",
    ".claude/commands/lauf.md": "Rumpf\r\nFuehre `node .claude/mini-guard.js` aus.\r\n",
    ".claude/rules/keel/regel.md": "# Regel\r\n\r\nQuelle: `docs/gibt-es-nicht.md` im Werkbank-Repo.\r\n",
    ".gitignore": "node_modules/\r\nuser-projects/beispiel/\r\n",
  });
  try {
    const bestand = {
      dateiIds: dateiIdsSammeln(wurzel),
      hookIds: [],
      repoIds: ["repo:beispiel"],
      commitIds: [],
    };
    const { kanten, fehler } = verwandt(wurzel, bestand);
    const knapp = kanten.map((k) => [k.art, k.nach, k.beleg]).sort();
    assert.deepStrictEqual(knapp, [
      ["beschrieben-in", "datei:.claude/mini-guard.js", "CLAUDE.md:5"],
      ["eingetragen-in", "datei:.claude/mini-guard.js", ".claude/settings.json:6"],
      ["ignoriert-in", "repo:beispiel", ".gitignore:2"],
      ["ruft-auf", "datei:.claude/mini-guard.js", ".claude/commands/lauf.md:2"],
    ]);
    for (const k of kanten) {
      assert.ok(!JSON.stringify(k).includes("\\r"), "keine Kante traegt einen Wagenruecklauf");
      assert.ok(!k.von.includes("\\") && !k.nach.includes("\\") && !k.beleg.includes("\\"));
    }
    // Der tote Verweis: er wird gefunden, geprueft und als Befund gemeldet.
    const tot = fehler.filter((f) => f.code === "ziel-unbekannt");
    assert.strictEqual(tot.length, 1);
    assert.strictEqual(tot[0].name, "docs/gibt-es-nicht.md");
    assert.strictEqual(tot[0].beleg, ".claude/rules/keel/regel.md:3");
    // Der zweite Befund ist der fehlende Skills-Ordner dieser Vorlage -- auch eine
    // fehlende Quelle wird gemeldet und nicht als "nichts gefunden" ausgegeben.
    const fehlend = fehler.filter((f) => f.code === "quelle-fehlt").map((f) => f.datei);
    assert.deepStrictEqual(fehlend, [".claude/skills"]);
    assert.strictEqual(fehler.length, 2);
  } finally {
    baumWeg(wurzel);
  }
});

test("fehlende Quellen werden gemeldet, nicht verschluckt", () => {
  const wurzel = baumBauen({ "leer.txt": "x\n" });
  try {
    const { kanten, fehler } = verwandt(wurzel, { dateiIds: new Set(), hookIds: [], repoIds: [], commitIds: [] });
    assert.deepStrictEqual(kanten, []);
    const dateien = fehler.map((f) => f.datei).sort();
    assert.deepStrictEqual(dateien, [
      ".claude/commands",
      ".claude/rules/keel",
      ".claude/settings.json",
      ".claude/skills",
      ".gitignore",
      "CLAUDE.md",
    ]);
    assert.ok(fehler.every((f) => f.code === "quelle-fehlt"));
  } finally {
    baumWeg(wurzel);
  }
});

test("keine eigenen Vorlagen-Reste im Bauordner", () => {
  // Nur das eigene Praefix: node --test faehrt die Testdateien parallel in
  // getrennten Prozessen -- ein Blick auf alle tmp-Ordner haenge am Zufall.
  const reste = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith("harness-tmp-verwandt-"));
  assert.deepStrictEqual(reste, [], "kein Rest: " + reste.join(", "));
});
