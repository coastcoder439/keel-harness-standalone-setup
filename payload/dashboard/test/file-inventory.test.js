// Tests zu dashboard/file-inventory.js -- node:test, Bordmittel, keine Fremdpakete.
//
// Aufruf:  node --test dashboard/test/file-inventory.test.js   (cwd = Workspace-Wurzel)
//
// Zwei Sorten Pruefung, bewusst getrennt:
//   1. Gegen den ECHTEN Baum dieses Workspace (Ausschluesse, Dateizahl, POSIX,
//      git-Sperre, Beschreibungs-Rangfolge). Findet, was eine Attrappe nie findet.
//   2. Gegen eine kurzlebige Attrappe unter dashboard/test/ (CRLF gegen LF, Kappung,
//      Binaerdatei). Faelle, die im echten Baum nicht vorkommen und trotzdem tragen muessen.
//
// Die Dateizahl wird NICHT fest verdrahtet: parallele Sitzungen legen laufend
// Dateien unter dashboard/ an. Verglichen wird gegen eine unabhaengige Zaehlung.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");

const { inventar, ZUGANGS_MUSTER, textSichern, beschreibungFuer } = require("../file-inventory.js");

const WURZEL = path.resolve(__dirname, "..", "..");
const ROLLEN = new Set([
  "hook-skript", "skript", "settings", "launch", "wurzel-kontext", "gitignore", "command",
  "skill", "skill-datei", "dauer-regel", "doku", "dashboard-modul", "dashboard-doku", "lizenz", "sonstiges",
]);

// Ein Lauf fuer alle Tests gegen den echten Baum -- 45+ Dateien lesen dauert sonst je Test.
const echt = inventar(WURZEL);

// --- Vorbedingung -----------------------------------------------------------
// Manche Pruefungen betreffen den INHALT dieses Workspace (user-projects/, eine
// git-ignorierte Datei, die Tool-Landschaft). In einer frischen Installation
// gibt es das zu Recht nicht. Ein Test, der dort scheitert, meldet einen Fehler,
// wo nur eine Bedingung fehlt -- und rote Tests beim Empfaenger sind schlimmer
// als keine. Deshalb: uebersprungen MIT Grund, nie stillschweigend bestanden.
function wennDa(bedingung, grund, name, fn) {
  if (bedingung) return test(name, fn);
  return test(name + "  [uebersprungen: " + grund + "]", { skip: true }, fn);
}

// Unabhaengige Zaehlung: eigene Rekursion, andere Regeln-Umsetzung als im Modul,
// kein git. Entspricht `find CLAUDE.md .gitignore .claude docs dashboard licenses -type f`
// erweitert um weitere Wurzeldateien.
function zaehlen(ordner, rel) {
  let n = 0;
  for (const e of fs.readdirSync(ordner, { withFileTypes: true })) {
    const kind = rel ? rel + "/" + e.name : e.name;
    if (e.isDirectory()) {
      if (e.name === ".git" || e.name === "node_modules" || kind === "user-projects") continue;
      n += zaehlen(path.join(ordner, e.name), kind);
    } else if (e.isFile() && !(rel === "" && (e.name === "dashboard.html" || e.name === "dashboard.json"))) {
      n += 1;
    }
  }
  return n;
}

function allePfade(wurzelKnoten) {
  const raus = [];
  (function gehe(k) {
    if (!k || typeof k !== "object") return;
    if (typeof k.pfad === "string") raus.push(k.pfad);
    if (typeof k.id === "string") raus.push(k.id);
    for (const kind of k.kinder || []) gehe(kind);
  })(wurzelKnoten);
  return raus;
}

// ---------------------------------------------------------------------------
// Export-Vertrag
// ---------------------------------------------------------------------------
test("Export-Vertrag: vier Namen, ZUGANGS_MUSTER als RegExp-Liste ohne g-Flag", () => {
  assert.strictEqual(typeof inventar, "function");
  assert.strictEqual(typeof textSichern, "function");
  assert.strictEqual(typeof beschreibungFuer, "function");
  assert.ok(Array.isArray(ZUGANGS_MUSTER));
  // Eine feste Anzahl war hier die falsche Zusage: sie bricht bei jeder
  // Verbesserung des Filters, ohne etwas ueber sein Verhalten auszusagen
  // (gemessen 23.08.2026, als die Liste von 15 auf 17 wuchs). Geprueft wird
  // stattdessen, dass die Liste nicht SCHRUMPFT -- was das Netz weiter macht,
  // ist gut; was es enger macht, muss auffallen.
  assert.ok(ZUGANGS_MUSTER.length >= 15, "die Liste ist geschrumpft: " + ZUGANGS_MUSTER.length + " Muster");
  for (const m of ZUGANGS_MUSTER) {
    assert.ok(m instanceof RegExp, "jedes Muster ist eine RegExp");
    assert.ok(!m.global, "kein g-Flag: lastIndex wuerde test() abwechselnd false liefern lassen");
  }
});

test("inventar liefert Baum, flache Dateiliste, Anzahl, Wurzel-URL und Fehlerliste", () => {
  assert.strictEqual(echt.baum.typ, "ordner");
  assert.strictEqual(echt.baum.pfad, "");
  assert.strictEqual(echt.baum.name, path.basename(WURZEL));
  assert.ok(Array.isArray(echt.baum.kinder) && echt.baum.kinder.length > 0);
  assert.ok(Array.isArray(echt.dateien) && echt.dateien.length > 0);
  assert.strictEqual(echt.anzahl, echt.dateien.length);
  assert.strictEqual(echt.baum.anzahlDateien, echt.anzahl, "Baum-Summe und flache Liste muessen gleich sein");
  assert.ok(echt.wurzelUrl.startsWith("file:///"), "wurzelUrl aus url.pathToFileURL");
  assert.deepStrictEqual(echt.fehler, [], "gegen dieses Repo darf nichts fehlschlagen");
  for (const d of echt.dateien) assert.strictEqual(d.id, "datei:" + d.pfad);
});

test("inventar meldet fehlende Wurzel als Fehlercode, nicht als leeres Ergebnis", () => {
  const r = inventar(path.join(WURZEL, "gibt-es-nicht-4711"));
  assert.strictEqual(r.baum, null);
  assert.strictEqual(r.anzahl, 0);
  assert.strictEqual(r.fehler[0].code, "wurzel-fehlt");
  const leer = inventar(undefined);
  assert.strictEqual(leer.fehler[0].code, "wurzel-fehlt");
});

// ---------------------------------------------------------------------------
// Ausschluesse und Zaehlung am echten Baum
// ---------------------------------------------------------------------------
test("Ausschluesse greifen: .git, node_modules, dashboard.html, dashboard.json", () => {
  const pfade = echt.dateien.map((d) => d.pfad);
  assert.strictEqual(pfade.filter((p) => p === ".git" || p.startsWith(".git/")).length, 0);
  assert.strictEqual(pfade.filter((p) => p.split("/").includes("node_modules")).length, 0);
  assert.ok(!pfade.includes("dashboard.html"), "dashboard.html ist ein Stand, kein Quelltext");
  assert.ok(!pfade.includes("dashboard.json"));
  assert.ok(fs.existsSync(path.join(WURZEL, "dashboard.html")), "Gegenprobe: die Datei liegt wirklich da");
  assert.ok(fs.existsSync(path.join(WURZEL, ".git")), "Gegenprobe: .git liegt wirklich da");
});

test("Dateizahl stimmt mit unabhaengiger Zaehlung ueberein", () => {
  assert.strictEqual(echt.anzahl, zaehlen(WURZEL, ""));
});

test("Dateizahl stimmt mit find ueberein (wird uebersprungen, wenn keine Shell da ist)", (t) => {
  const befehl = "find CLAUDE.md .gitignore .claude docs dashboard licenses -type f | wc -l";
  const lauf = spawnSync("bash", ["-lc", befehl], { cwd: WURZEL, encoding: "utf8", timeout: 30000 });
  if (lauf.error || lauf.status !== 0) return t.skip("bash/find nicht verfuegbar: " + (lauf.error ? lauf.error.code : lauf.status));
  const ausFind = Number(String(lauf.stdout).trim());
  const weitereWurzeldateien = echt.baum.kinder.filter(
    (k) => k.typ === "datei" && k.name !== "CLAUDE.md" && k.name !== ".gitignore"
  ).length;
  assert.strictEqual(echt.anzahl - weitereWurzeldateien, ausFind, "find zaehlt dieselben Ordner");
});

test("kein Backslash in irgendeinem pfad-Feld, keine Ausnahme", () => {
  // Geprueft werden PFAD-Felder, nicht die ganze Serialisierung: eingebettete
  // Dateiinhalte tragen Backslashes voellig zu Recht (gemessen: statusline.js:59
  // und related.js:333 enthalten den regulaeren Ausdruck /^user-projects\//).
  const alle = allePfade(echt.baum).concat(
    echt.dateien.map((d) => d.pfad),
    echt.dateien.map((d) => d.id),
    echt.dateien.map((d) => (d.beschreibung && d.beschreibung.beleg) || "")
  );
  alle.push(echt.wurzel);
  for (const p of alle) assert.ok(p.indexOf("\\") < 0, "Backslash in " + JSON.stringify(p));
  assert.ok(alle.length > 100, "Gegenprobe: es wurden ueberhaupt Felder eingesammelt");
  assert.ok(echt.wurzel.includes("/"), "Gegenprobe: der Wurzelpfad hat ueberhaupt Trennzeichen");
  assert.ok(echt.pfadTrenner === "windows" || echt.pfadTrenner === "posix");
});

wennDa(fs.existsSync(path.join(WURZEL, "user-projects")), "kein user-projects/ in diesem Workspace",
  "user-projects ist ein Knoten mit Repo-Blaettern und wird nicht begangen", () => {
  const up = echt.baum.kinder.find((k) => k.pfad === "user-projects");
  assert.ok(up, "user-projects muss im Baum stehen");
  assert.strictEqual(up.typ, "ordner");
  assert.strictEqual(up.begangen, false);
  assert.strictEqual(up.anzahlDateien, 0);
  const echteRepos = fs.readdirSync(path.join(WURZEL, "user-projects"), { withFileTypes: true }).filter((e) => e.isDirectory()).length;
  assert.strictEqual(up.kinder.length, echteRepos);
  for (const r of up.kinder) {
    assert.strictEqual(r.typ, "repo");
    assert.strictEqual(r.id, "repo:" + r.name);
    assert.strictEqual(r.pfad, "user-projects/" + r.name);
  }
  assert.strictEqual(echt.dateien.filter((d) => d.pfad.startsWith("user-projects/")).length, 0);
});

test("Ordner zuerst, dann alphabetisch", () => {
  (function pruefe(k) {
    const kinder = k.kinder || [];
    const nurOrdner = kinder.filter((x) => x.typ !== "datei").map((x) => x.name);
    const nurDateien = kinder.filter((x) => x.typ === "datei").map((x) => x.name);
    // Ordner zuerst: die Datei-Namen duerfen erst am Ende auftauchen.
    const folge = kinder.map((x) => (x.typ === "datei" ? 1 : 0));
    assert.deepStrictEqual(folge, folge.slice().sort(), "Ordner nach Datei in " + JSON.stringify(k.pfad));
    // Alphabetisch je Gruppe -- gegen dieselbe Regel, die das Modul benutzt.
    assert.deepStrictEqual(nurOrdner, nurOrdner.slice().sort((a, b) => a.localeCompare(b, "en")), "Ordner-Reihenfolge in " + JSON.stringify(k.pfad));
    assert.deepStrictEqual(nurDateien, nurDateien.slice().sort((a, b) => a.localeCompare(b, "en")), "Datei-Reihenfolge in " + JSON.stringify(k.pfad));
    for (const kind of kinder) if (kind.kinder) pruefe(kind);
  })(echt.baum);
});

// ---------------------------------------------------------------------------
// Riegel 1 und 2
// ---------------------------------------------------------------------------
wennDa(echt.dateien.some((d) => d.git === "ignoriert"), "keine git-ignorierte Datei vorhanden",
  "git-ignorierte Datei traegt nur Metadaten (.claude/launch.json)", () => {
  const lj = echt.dateien.find((d) => d.pfad === ".claude/launch.json");
  assert.ok(lj, ".claude/launch.json muss als Knoten auftauchen (nur der INHALT ist gesperrt)");
  assert.strictEqual(lj.git, "ignoriert");
  assert.strictEqual(lj.inhalt.gesperrt, "ignoriert");
  assert.strictEqual(lj.inhalt.text, null, "kein Zeichen Inhalt im Datensatz");
  assert.strictEqual(lj.zeilen, null);
  assert.ok(lj.bytes > 0, "Metadaten bleiben: Groesse");
  assert.ok(lj.geaendert, "Metadaten bleiben: Aenderungszeit");
  const roh = JSON.stringify(echt);
  const inhaltProbe = fs.readFileSync(path.join(WURZEL, ".claude", "launch.json"), "utf8").split(/\r?\n/).find((z) => z.trim().length > 12);
  assert.ok(inhaltProbe, "Gegenprobe: die Datei hat ueberhaupt Inhalt");
  assert.strictEqual(roh.includes(inhaltProbe.trim()), false, "keine Zeile der gesperrten Datei im Datensatz");
});

test("textSichern maskiert eine Zugangszeile und laesst normalen Code unberuehrt", () => {
  const quelle = 'const a = 1;\ntoken = abcdefghij1234\nconst tokenZaehler = zaehle(text);\nconst b = 2;';
  const r = textSichern(quelle);
  assert.deepStrictEqual(r.ausgeblendeteZeilen, [2]);
  const zeilen = r.text.split("\n");
  assert.strictEqual(zeilen[0], "const a = 1;");
  assert.strictEqual(zeilen[1], "[ausgeblendet:zugang]");
  assert.strictEqual(zeilen[2], "const tokenZaehler = zaehle(text);", "normaler Code bleibt unberuehrt");
  assert.strictEqual(zeilen[3], "const b = 2;");
  assert.strictEqual(r.text.includes("abcdefghij1234"), false);
});

test("textSichern faengt Remote-URL mit Zugang, JWT und Schluesselkopf", () => {
  assert.deepStrictEqual(textSichern("remote https://user:TOKEN@github.com/x").ausgeblendeteZeilen, [1]);
  assert.deepStrictEqual(textSichern("h eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9").ausgeblendeteZeilen, [1]);
  assert.deepStrictEqual(textSichern("h eyJkurz.zukurz").ausgeblendeteZeilen, [], "Gegenprobe: zu kurz ist kein Treffer");
  assert.deepStrictEqual(textSichern("-----BEGIN RSA PRIVATE KEY-----").ausgeblendeteZeilen, [1]);
  assert.deepStrictEqual(textSichern("ghp_abcdefghijklmnopqrstuvwxyz").ausgeblendeteZeilen, [1]);
  assert.deepStrictEqual(textSichern("nichts davon\nauch nichts").ausgeblendeteZeilen, []);
});

test("kein Zugangsmuster ueberlebt im fertigen Datensatz", () => {
  const roh = JSON.stringify(echt);
  const treffer = ZUGANGS_MUSTER.filter((m) => m.test(roh)).length;
  assert.strictEqual(treffer, 0, "Riegel 2 laesst nichts durch");
});

// ---------------------------------------------------------------------------
// Beschreibungs-Rangfolge (7.2)
// ---------------------------------------------------------------------------
test("beschreibungFuer: fuer .claude/danger-guard.js greift der Kopfkommentar-Fallback", () => {
  // Die Rangfolge bleibt CLAUDE.md vor Kopfkommentar (was einem LESER hilft,
  // steht vorn). Seit der CLAUDE.md-Kuerzung (24.08.2026) nennt CLAUDE.md aber
  // keine Waechter mehr -- am echten Baum greift deshalb der Fallback auf den
  // Kopfkommentar. Die Stufen selbst prueft "faellt sauber durch die Stufen".
  const d = echt.dateien.find((x) => x.pfad === ".claude/danger-guard.js");
  assert.ok(d);
  assert.strictEqual(d.beschreibung.quelle, "kopfkommentar");
  assert.match(d.beschreibung.beleg || "", /^\.claude\/danger-guard\.js:\d+(-\d+)?$/, "Beleg zeigt in die Datei selbst");
  assert.ok(/blockiert/i.test(d.beschreibung.text), "der Satz sagt, was das Skript TUT: " + d.beschreibung.text);

  // Gegenprobe an der Quelle: der Beleg zeigt auf Kommentarzeilen der Datei selbst.
  const quelle = fs.readFileSync(path.join(WURZEL, ".claude", "danger-guard.js"), "utf8").split(/\r?\n/);
  const vonZeile = Number(String(d.beschreibung.beleg).split(":")[1].split("-")[0]);
  assert.match(quelle[vonZeile - 1], /^\s*\/\//, "die belegte Zeile ist ein Kommentar");

  // Direkter Aufruf liefert dieselbe Stufe.
  const text = fs.readFileSync(path.join(WURZEL, ".claude", "danger-guard.js"), "utf8");
  const direkt = beschreibungFuer(".claude/danger-guard.js", text, { rolle: "hook-skript" });
  assert.strictEqual(direkt.quelle, "kopfkommentar");
});

test("beschreibungFuer findet fuer .claude/commands/save-work.md das Frontmatter", () => {
  const d = echt.dateien.find((x) => x.pfad === ".claude/commands/save-work.md");
  assert.ok(d);
  assert.strictEqual(d.beschreibung.quelle, "frontmatter");
  assert.strictEqual(d.beschreibung.beleg, ".claude/commands/save-work.md:2");
  assert.ok(d.beschreibung.text.startsWith("Sichert die ungesicherte Arbeit"));
  assert.strictEqual(d.frontmatter.description, d.beschreibung.text);
});

test("beschreibungFuer faellt sauber durch die Stufen", () => {
  const kopf = beschreibungFuer("x/a.js", "#!/usr/bin/env node\n// Eins.\n// Zwei.\n//\n// Spaeter.\n", { rolle: "skript" });
  assert.deepStrictEqual(
    { text: kopf.text, quelle: kopf.quelle, beleg: kopf.beleg },
    { text: "Eins. Zwei.", quelle: "kopfkommentar", beleg: "x/a.js:2-3" }
  );
  const absatz = beschreibungFuer("x/b.md", "# Titel\n\nErster Absatz.\nZweite Zeile.\n\nSpaeter.\n", { rolle: "doku" });
  assert.strictEqual(absatz.quelle, "absatz");
  assert.strictEqual(absatz.text, "Erster Absatz. Zweite Zeile.");
  assert.strictEqual(absatz.beleg, "x/b.md:3-4");
  assert.strictEqual(beschreibungFuer("x/c.js", "const a = 1;\n", { rolle: "skript" }), null, "ohne Quelle: null, kein geratener Satz");
});

wennDa(echt.dateien.some((d) => d.rolle === "launch"), "keine Vorschau-Konfiguration in diesem Workspace",
  "Rollen-Beschreibung liefert einen CODE, keinen deutschen Satz", () => {
  for (const [pfad, rolle] of [
    [".claude/settings.json", "settings"],
    [".claude/launch.json", "launch"],
    [".gitignore", "gitignore"],
    ["licenses/LICENSE-i-have-adhd.txt", "lizenz"],
  ]) {
    const d = echt.dateien.find((x) => x.pfad === pfad);
    assert.ok(d, pfad + " fehlt im Baum");
    assert.strictEqual(d.beschreibung.quelle, "rolle", pfad);
    assert.strictEqual(d.beschreibung.text, null, pfad + ": der Satz gehoert nach render/data.js");
    assert.strictEqual(d.beschreibung.rolle, rolle, pfad);
  }
});

wennDa(echt.dateien.some((d) => d.rolle === "launch"), "keine Vorschau-Konfiguration in diesem Workspace",
  "jede Datei traegt eine der 15 Rollen; die zentralen Dateien die richtige", () => {
  for (const d of echt.dateien) assert.ok(ROLLEN.has(d.rolle), d.pfad + " -> " + d.rolle);
  const rolleVon = (p) => (echt.dateien.find((d) => d.pfad === p) || {}).rolle;
  assert.strictEqual(rolleVon("CLAUDE.md"), "wurzel-kontext");
  assert.strictEqual(rolleVon(".gitignore"), "gitignore");
  assert.strictEqual(rolleVon(".claude/settings.json"), "settings");
  assert.strictEqual(rolleVon(".claude/launch.json"), "launch");
  assert.strictEqual(rolleVon(".claude/danger-guard.js"), "hook-skript");
  assert.strictEqual(rolleVon(".claude/repo-status.js"), "skript", "nicht verdrahtet, von Commands aufgerufen");
  assert.strictEqual(rolleVon(".claude/statusline.js"), "skript", "statusLine ist kein Hook (Spezifikation 4.4)");
  assert.strictEqual(rolleVon(".claude/commands/save-work.md"), "command");
  assert.strictEqual(rolleVon(".claude/skills/i-have-adhd/SKILL.md"), "skill");
  // "skill-datei" (Nicht-SKILL.md in einem Skill-Ordner) hat seit dem Entfernen
  // von domain-modeling (25.08.2026) keine Instanz mehr -- die Rolle bleibt im
  // Klassifikator fuer kuenftige mehrteilige Skills, wird hier aber nicht mehr
  // gegen eine echte Datei geprueft.
  assert.strictEqual(rolleVon(".claude/rules/keel/tools.md"), "dauer-regel");
  assert.strictEqual(rolleVon("docs/tool-landscape.md"), "doku");
  assert.strictEqual(rolleVon("dashboard/measure.js"), "dashboard-modul");
  assert.strictEqual(rolleVon("dashboard/README.md"), "dashboard-doku");
  assert.strictEqual(rolleVon("licenses/LICENSE-i-have-adhd.txt"), "lizenz");
});

test("verdrahtete Skripte tragen Ereignis und settings.json-Zeile", () => {
  const dg = echt.dateien.find((d) => d.pfad === ".claude/danger-guard.js");
  assert.deepStrictEqual(dg.verdrahtung, [{ ereignis: "PreToolUse", matcher: "Bash", datei: ".claude/settings.json", zeile: 63 }]);
  const sl = echt.dateien.find((d) => d.pfad === ".claude/statusline.js");
  assert.strictEqual(sl.verdrahtung[0].ereignis, "statusLine");
  assert.strictEqual(echt.dateien.find((d) => d.pfad === ".claude/repo-status.js").verdrahtung, undefined);
});

// ---------------------------------------------------------------------------
// Attrappe: CRLF gegen LF, Kappung, Binaerdatei, Ausschluesse
// ---------------------------------------------------------------------------
const ATTRAPPE = path.join(os.tmpdir(), "harness-tmp-inventar-" + process.pid);

test("Attrappe: CRLF und LF, grosse Datei, Binaerdatei, Ausschluesse", (t) => {
  const zeilenText = ["# Titel", "", "Erste Zeile.", "Zweite Zeile."];
  fs.mkdirSync(path.join(ATTRAPPE, "node_modules"), { recursive: true });
  try {
    fs.writeFileSync(path.join(ATTRAPPE, "crlf.md"), zeilenText.join("\r\n") + "\r\n");
    fs.writeFileSync(path.join(ATTRAPPE, "lf.md"), zeilenText.join("\n") + "\n");
    fs.writeFileSync(path.join(ATTRAPPE, "dashboard.html"), "<p>Stand, kein Quelltext</p>");
    fs.writeFileSync(path.join(ATTRAPPE, "node_modules", "drin.js"), "// nicht mitzaehlen\n");
    fs.writeFileSync(path.join(ATTRAPPE, "gross.txt"), Array.from({ length: 5001 }, (unused, i) => "Zeile " + (i + 1)).join("\n") + "\n");
    fs.writeFileSync(path.join(ATTRAPPE, "binaer.bin"), Buffer.from([0x50, 0x4b, 0x00, 0x01, 0x02]));

    const r = inventar(ATTRAPPE);
    const hol = (n) => r.dateien.find((d) => d.pfad === n);

    // 1. CRLF und LF ergeben DIESELBE Zeilenzahl. Der Text selbst steht seit
    //    SERVER-ZUERST (D1) NICHT mehr im Datensatz (inhalt.text ist null); die
    //    CRLF/LF-Normalisierung beim Ausliefern prueft serve.test.js.
    assert.strictEqual(hol("crlf.md").zeilen, 4);
    assert.strictEqual(hol("lf.md").zeilen, 4);
    assert.strictEqual(hol("crlf.md").zeilen, hol("lf.md").zeilen);
    assert.strictEqual(hol("crlf.md").inhalt.text, null, "kein Rumpf im Datensatz (D1)");
    assert.strictEqual(hol("lf.md").inhalt.text, null, "kein Rumpf im Datensatz (D1)");
    assert.strictEqual(hol("crlf.md").zeilenende, "crlf");
    assert.strictEqual(hol("lf.md").zeilenende, "lf");
    assert.strictEqual(hol("crlf.md").bytes > hol("lf.md").bytes, true, "Gegenprobe: die Dateien sind wirklich verschieden gross");

    // 2. Ausschluesse auch in einem fremden Baum.
    assert.strictEqual(hol("dashboard.html"), undefined);
    assert.strictEqual(r.dateien.filter((d) => d.pfad.startsWith("node_modules/")).length, 0);
    assert.strictEqual(r.anzahl, 4, "crlf.md, lf.md, gross.txt, binaer.bin");

    // 3. Grosse Datei: die Zeilenzahl bleibt die ECHTE, es gibt keinen Rumpf im
    //    Datensatz und keine Kappung mehr (D1: serve.js liefert die ganze Datei
    //    auf Klick, gedeckelt erst von der harten Obergrenze). Also NICHT gesperrt.
    assert.strictEqual(hol("gross.txt").zeilen, 5001);
    assert.strictEqual(hol("gross.txt").inhalt.text, null);
    assert.strictEqual(hol("gross.txt").inhalt.gesperrt, null, "eine grosse (aber nicht riesige) Datei bleibt abrufbar");

    // 4. NUL-Byte in den ersten 8 KB -> binaer, kein Text.
    assert.strictEqual(hol("binaer.bin").inhalt.gesperrt, "binaer");
    assert.strictEqual(hol("binaer.bin").inhalt.text, null);
    assert.strictEqual(hol("binaer.bin").zeilen, null);
  } finally {
    fs.rmSync(ATTRAPPE, { recursive: true, force: true });
  }
  assert.strictEqual(fs.existsSync(ATTRAPPE), false, "Attrappe ist wieder weg");
});

// ---------------------------------------------------------------------------
// Hausregeln des Moduls
// ---------------------------------------------------------------------------
test("file-inventory.js bleibt unter 800 Zeilen und ohne Nicht-ASCII (A75/A79)", () => {
  const quelle = fs.readFileSync(path.join(__dirname, "..", "file-inventory.js"), "utf8");
  const zeilen = quelle.split(/\r?\n/);
  assert.ok(zeilen.length < 800, "Zeilen: " + zeilen.length);
  const schlimm = zeilen.map((z, i) => [i + 1, z]).filter((paar) => /[^\x00-\x7F]/.test(paar[1]));
  assert.deepStrictEqual(schlimm, [], "kein Umlaut, kein Gedankenstrich -- die Messung bleibt sprachneutral");
  assert.ok(os.EOL.length > 0, "Gegenprobe: os ist geladen");
});

// ---------------------------------------------------------------------------
// Frontmatter-Geheimnisse (Nachpruefung 23.08.2026)
//
// Die zeilenweisen Geheimnis-Faelle (privater Schluessel, YAML-Folgezeile ...)
// stehen in access-filter.test.js. HIER geht es um das inventar-Eigene: das
// frontmatter-FELD am Knoten. Es wird aus dem ROHTEXT geparst (damit die
// Struktur erkannt bleibt) und die WERTE werden einzeln gesichert
// (frontmatterSichern). Zwei Fallen, beide in der Nachpruefung belegt:
//   - ein Zugang im Frontmatter-Wert darf nicht im Klartext an den Knoten,
//   - ein leerer Geheimnis-Schluessel direkt vor --- darf die Struktur nicht
//     zerstoeren (sonst Fehlklassifikation dauer/abruf).
// ---------------------------------------------------------------------------

function fmWorkspace(dateien) {
  const w = fs.mkdtempSync(path.join(os.tmpdir(), "harness-fm-"));
  fs.writeFileSync(path.join(w, "CLAUDE.md"), "# T\n\nTest.\n");
  for (const [rel, txt] of Object.entries(dateien)) {
    const p = path.join(w, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, txt);
  }
  return w;
}

test("ein Zugang im Frontmatter-Wert wird maskiert, nie Klartext am Knoten", () => {
  const w = fmWorkspace({
    ".claude/rules/eigen/regel.md": "---\ndescription: Eine Regel.\ndb_password: Sommer2026!Regen\n---\n\n# Regel\n\nText.\n",
  });
  try {
    const knoten = inventar(w).dateien.find((d) => d.pfad === ".claude/rules/eigen/regel.md");
    assert.ok(knoten, "Regeldatei nicht gefunden");
    assert.strictEqual(knoten.frontmatter.db_password, "[ausgeblendet:zugang]", "der Zugang steht im Klartext im frontmatter-Feld");
    assert.strictEqual(JSON.stringify(knoten).includes("Sommer2026!Regen"), false, "der Zugang leckt irgendwo im Knoten");
    assert.strictEqual(knoten.rolle, "abruf-regel", "eine Regel MIT Frontmatter laedt auf Abruf");
  } finally {
    fs.rmSync(w, { recursive: true, force: true });
  }
});

test("leerer Geheimnis-Schluessel vor --- zerstoert die Frontmatter-Struktur nicht", () => {
  // Frueher maskierte textSichern die schliessende ---Zeile (WERT_FOLGT nach
  // leerem "secret:") -> frontmatterLesen fand das Ende nicht -> Fehlklassifikation.
  const w = fmWorkspace({
    ".claude/rules/eigen/regelE.md": "---\nname: Regel E\ndescription: Abrufbar.\nsecret:\n---\n\n# Regel E\n\nInhalt.\n",
  });
  try {
    const knoten = inventar(w).dateien.find((d) => d.pfad === ".claude/rules/eigen/regelE.md");
    assert.ok(knoten, "Regeldatei nicht gefunden");
    assert.strictEqual(knoten.rolle, "abruf-regel", "Struktur verloren -> als dauer-regel fehlklassifiziert");
    assert.strictEqual(knoten.frontmatter.description, "Abrufbar.", "Frontmatter-Feld nicht gelesen");
  } finally {
    fs.rmSync(w, { recursive: true, force: true });
  }
});

test("eine Regel OHNE Frontmatter bleibt dauer-regel (Gegenprobe)", () => {
  const w = fmWorkspace({
    ".claude/rules/eigen/dauer.md": "# Dauerregel\n\nGilt in jeder Sitzung.\n",
  });
  try {
    const knoten = inventar(w).dateien.find((d) => d.pfad === ".claude/rules/eigen/dauer.md");
    assert.ok(knoten, "Regeldatei nicht gefunden");
    assert.strictEqual(knoten.rolle, "dauer-regel");
    assert.strictEqual(knoten.frontmatter, null, "ohne Frontmatter darf kein frontmatter-Feld entstehen");
  } finally {
    fs.rmSync(w, { recursive: true, force: true });
  }
});
