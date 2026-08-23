#!/usr/bin/env node
// Test zu dashboard/hooks-detail.js -- gemessen gegen den ECHTEN Harness in diesem
// Workspace, nicht gegen eine Attrappe. Jede Zeilenangabe, die das Modul liefert,
// wird hier an der Quelldatei nachgeschlagen: ein Beleg, der auf die falsche Zeile
// zeigt, ist schlimmer als kein Beleg.
//
// WICHTIG -- die Reihenfolge der ersten drei Zeilen ist Teil des Tests:
// child_process wird VOR dem require von hooks-detail ausgetauscht. hooks-detail
// zieht spawnSync beim Laden aus dem Modul heraus, also greift der Zaehler nur so.
// Damit ist "ohne opts.proben laeuft kein Kindprozess" strukturell geprueft und
// nicht bloss am Rueckgabewert abgelesen.

const kindprozess = require("node:child_process");
const echtesSpawnSync = kindprozess.spawnSync;
let spawnZaehler = 0;
kindprozess.spawnSync = function (...args) {
  spawnZaehler += 1;
  return echtesSpawnSync.apply(kindprozess, args);
};

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const { hooksDetail } = require("../hooks-detail.js");

const WURZEL = path.resolve(__dirname, "..", "..");
const zeilenVon = (relPfad) => fs.readFileSync(path.join(WURZEL, relPfad), "utf8").split(/\r?\n/);

// Einmal messen, ohne Proben -- alle Struktur-Tests laufen auf diesem Ergebnis.
const ergebnis = hooksDetail(WURZEL, {});
const spawnsNachStrukturmessung = spawnZaehler;

const ERWARTETE_REIHENFOLGE = [
  "session-roles.js",
  "onboarding-start.js",
  "project-context.js",
  "uncommitted-warn.js",
  "danger-guard.js",
  "git-guard.js",
  "commit-pathspec-guard.js",
  "sessionpost-guard.js",
];

// Marker je Wirkungs-Code: die Beleg-Zeile MUSS einen davon enthalten.
const WIRKUNG_MARKER = {
  blockiert: [/exit\(\s*2\s*\)/],
  meldet: [/stderr/, /console\.error/, /systemMessage/, /additionalContext/, /stdout\.write/, /console\.log/],
  kontext: [/additionalContext/, /initialUserMessage/, /stdout\.write/, /console\.log/],
};

// ---------------------------------------------------------------------------
// Bestand und Reihenfolge
// ---------------------------------------------------------------------------
test("acht Eintraege, in der Reihenfolge von settings.json", () => {
  assert.deepStrictEqual(ergebnis.fehler, [], "kein Messfehler erwartet");
  assert.strictEqual(ergebnis.eintraege.length, 8);
  assert.deepStrictEqual(ergebnis.eintraege.map((e) => e.skript), ERWARTETE_REIHENFOLGE);
  const zeilen = ergebnis.eintraege.map((e) => e.settingsZeile);
  const sortiert = [...zeilen].sort((a, b) => a - b);
  assert.deepStrictEqual(zeilen, sortiert, "settingsZeile muss monoton steigen");
});

test("Ereignisse: SessionStart 3, Stop 1, PreToolUse 4", () => {
  const nach = (ev) => ergebnis.eintraege.filter((e) => e.ereignis === ev).length;
  assert.strictEqual(nach("SessionStart"), 3);
  assert.strictEqual(nach("Stop"), 1);
  assert.strictEqual(nach("PreToolUse"), 4);
  assert.strictEqual(nach("SessionStart") + nach("Stop") + nach("PreToolUse"), ergebnis.eintraege.length);
});

test("IDs sind eindeutig und tragen Ereignis plus Laufnummer", () => {
  const ids = ergebnis.eintraege.map((e) => e.id);
  assert.strictEqual(new Set(ids).size, ids.length);
  assert.ok(ids.includes("hook:PreToolUse/1"));
  assert.ok(ids.includes("hook:Stop/1"));
  for (const e of ergebnis.eintraege) assert.match(e.id, /^hook:[A-Za-z]+\/[1-9][0-9]*$/);
});

// ---------------------------------------------------------------------------
// Felder aus settings.json
// ---------------------------------------------------------------------------
test("bedingung traegt das git-Muster genau bei git-guard und commit-pathspec-guard", () => {
  const mitBedingung = ergebnis.eintraege.filter((e) => e.bedingung !== null);
  assert.deepStrictEqual(mitBedingung.map((e) => e.skript), ["git-guard.js", "commit-pathspec-guard.js"]);
  for (const e of mitBedingung) assert.match(e.bedingung, /git/);
});

test("matcher: Bash bei den drei Bash-Hooks, MCP-Muster bei sessionpost-guard, sonst null", () => {
  const nach = (name) => ergebnis.eintraege.find((e) => e.skript === name);
  assert.strictEqual(nach("danger-guard.js").matcher, "Bash");
  assert.strictEqual(nach("git-guard.js").matcher, "Bash");
  assert.strictEqual(nach("commit-pathspec-guard.js").matcher, "Bash");
  assert.match(nach("sessionpost-guard.js").matcher, /^mcp__/);
  assert.strictEqual(nach("session-roles.js").matcher, null);
  assert.strictEqual(nach("uncommitted-warn.js").matcher, null);
});

test("timeout ist 10 wo gesetzt und null wo nicht gesetzt", () => {
  for (const e of ergebnis.eintraege) {
    if (e.skript === "uncommitted-warn.js") assert.strictEqual(e.timeout, null);
    else assert.strictEqual(e.timeout, 10, `timeout bei ${e.skript}`);
  }
});

test("asynchron ist nur bei uncommitted-warn wahr", () => {
  const asynchron = ergebnis.eintraege.filter((e) => e.asynchron);
  assert.deepStrictEqual(asynchron.map((e) => e.skript), ["uncommitted-warn.js"]);
});

test("reihenfolge zaehlt innerhalb der Matcher-Gruppe ab 1", () => {
  const nach = (name) => ergebnis.eintraege.find((e) => e.skript === name).reihenfolge;
  assert.strictEqual(nach("danger-guard.js"), 1);
  assert.strictEqual(nach("git-guard.js"), 2);
  assert.strictEqual(nach("commit-pathspec-guard.js"), 3);
  assert.strictEqual(nach("sessionpost-guard.js"), 1, "eigene Matcher-Gruppe, also wieder 1");
  assert.strictEqual(nach("uncommitted-warn.js"), 1);
});

test("ansage kommt woertlich aus statusMessage", () => {
  const dg = ergebnis.eintraege.find((e) => e.skript === "danger-guard.js");
  assert.strictEqual(dg.ansage, "danger-guard (zerstoerende Befehle)");
  for (const e of ergebnis.eintraege) assert.strictEqual(typeof e.ansage, "string");
});

// ---------------------------------------------------------------------------
// Belege gegen die echten Dateien
// ---------------------------------------------------------------------------
test("settingsZeile zeigt auf eine Zeile mit command UND dem Skriptnamen", () => {
  const zeilen = zeilenVon(".claude/settings.json");
  for (const e of ergebnis.eintraege) {
    assert.ok(Number.isInteger(e.settingsZeile), `settingsZeile fehlt bei ${e.skript}`);
    const zeile = zeilen[e.settingsZeile - 1];
    assert.ok(zeile !== undefined, `Zeile ${e.settingsZeile} gibt es nicht`);
    assert.ok(zeile.includes('"command"'), `Zeile ${e.settingsZeile} ohne command: ${zeile}`);
    assert.ok(zeile.includes(e.skript), `Zeile ${e.settingsZeile} ohne ${e.skript}: ${zeile}`);
  }
});

test("danger-guard blockiert, und der Beleg zeigt wirklich auf exit(2)", () => {
  const dg = ergebnis.eintraege.find((e) => e.skript === "danger-guard.js");
  assert.strictEqual(dg.wirkung, "blockiert");
  assert.strictEqual(dg.wirkungBeleg, ".claude/danger-guard.js:476");
  const zeilen = zeilenVon(dg.pfad);
  assert.match(zeilen[476 - 1], /process\.exit\(\s*2\s*\)/);
});

test("jede Wirkung ist ein Code aus der Menge und jeder Beleg haelt an der Quelle", () => {
  const erlaubt = ["blockiert", "meldet", "kontext"];
  for (const e of [...ergebnis.eintraege, ergebnis.statusLine]) {
    assert.ok(erlaubt.includes(e.wirkung), `unbekannte Wirkung ${e.wirkung} bei ${e.skript}`);
    const teile = e.wirkungBeleg.split(":");
    const nummer = Number(teile.pop());
    assert.strictEqual(teile.join(":"), e.pfad, "Beleg nennt eine andere Datei als pfad");
    const zeile = zeilenVon(e.pfad)[nummer - 1];
    assert.ok(zeile !== undefined, `Belegzeile ${nummer} gibt es in ${e.pfad} nicht`);
    const marker = WIRKUNG_MARKER[e.wirkung];
    assert.ok(marker.some((m) => m.test(zeile)), `${e.wirkungBeleg} passt nicht zu ${e.wirkung}: ${zeile}`);
  }
});

test("Wirkung je Skript: drei blockieren, git-guard meldet nur", () => {
  const nach = (name) => ergebnis.eintraege.find((e) => e.skript === name).wirkung;
  assert.strictEqual(nach("danger-guard.js"), "blockiert");
  assert.strictEqual(nach("commit-pathspec-guard.js"), "blockiert");
  assert.strictEqual(nach("sessionpost-guard.js"), "blockiert");
  assert.strictEqual(nach("git-guard.js"), "meldet");
  assert.strictEqual(nach("uncommitted-warn.js"), "meldet");
  for (const name of ["session-roles.js", "onboarding-start.js", "project-context.js"]) {
    assert.strictEqual(nach(name), "kontext");
  }
});

test("kopfkommentar beginnt hinter der Shebang-Zeile und deckt echte Kommentarzeilen", () => {
  for (const e of ergebnis.eintraege) {
    const k = e.kopfkommentar;
    assert.ok(k && k.text.length > 0, `kein Kopfkommentar bei ${e.skript}`);
    assert.strictEqual(k.von, 2, `Kopfkommentar startet nicht in Zeile 2 bei ${e.skript}`);
    assert.ok(k.bis >= k.von);
    const zeilen = zeilenVon(e.pfad);
    assert.match(zeilen[0], /^#!/);
    assert.match(zeilen[k.von - 1], /^\s*\/\//);
    assert.match(zeilen[k.bis - 1], /^\s*\/\//);
    assert.ok(!/^\s*\/\//.test(zeilen[k.bis] || ""), "hinter bis darf kein // mehr stehen");
  }
});

// ---------------------------------------------------------------------------
// CLAUDE.md-Abgleich (daraus entsteht spaeter der Drift-Eintrag)
// ---------------------------------------------------------------------------
test("claudeMdZeile trifft die Tabellenzeile -- ausser bei sessionpost-guard", () => {
  const zeilen = zeilenVon("CLAUDE.md");
  for (const e of ergebnis.eintraege) {
    if (e.skript === "sessionpost-guard.js") {
      assert.strictEqual(e.claudeMdZeile, null, "sessionpost-guard fehlt in CLAUDE.md -> Drift");
      continue;
    }
    assert.ok(e.claudeMdZeile, `keine CLAUDE.md-Zeile fuer ${e.skript}`);
    const zeile = zeilen[e.claudeMdZeile.zeile - 1];
    assert.ok(zeile.includes(e.skript), `CLAUDE.md:${e.claudeMdZeile.zeile} nennt ${e.skript} nicht`);
    assert.match(zeile, /^\s*\|/, "nur Tabellenzeilen zaehlen");
    assert.strictEqual(e.claudeMdZeile.text, zeile.trim());
  }
});

// ---------------------------------------------------------------------------
// Ausloeser (source) -- nur bei SessionStart
// ---------------------------------------------------------------------------
test("ausloeser gibt es nur bei SessionStart, und jede Zeile enthaelt das Wort", () => {
  for (const e of ergebnis.eintraege) {
    if (e.ereignis !== "SessionStart") {
      assert.deepStrictEqual(e.ausloeser, [], `${e.skript} darf keine Ausloeser tragen`);
      continue;
    }
    assert.ok(e.ausloeser.length > 0, `${e.skript} ohne Ausloeser`);
    const zeilen = zeilenVon(e.pfad);
    for (const a of e.ausloeser) {
      assert.ok(["startup", "resume", "clear", "compact"].includes(a.wort));
      assert.ok(zeilen[a.zeile - 1].includes(a.wort), `${e.pfad}:${a.zeile} ohne ${a.wort}`);
    }
  }
});

test("der Beleg fuer startup zeigt auf die Schaltstelle, nicht auf einen Kommentar", () => {
  const nach = (name) => {
    const e = ergebnis.eintraege.find((x) => x.skript === name);
    return e.ausloeser.find((a) => a.wort === "startup").zeile;
  };
  assert.strictEqual(nach("session-roles.js"), 96);
  assert.strictEqual(nach("onboarding-start.js"), 47);
  assert.strictEqual(nach("project-context.js"), 33);
  for (const [name, zeile] of [["session-roles.js", 96], ["onboarding-start.js", 47], ["project-context.js", 33]]) {
    const quelle = zeilenVon(`.claude/${name}`)[zeile - 1];
    assert.ok(!/^\s*\/\//.test(quelle), `${name}:${zeile} ist eine Kommentarzeile: ${quelle}`);
  }
});

// ---------------------------------------------------------------------------
// statusLine und weitere Skripte
// ---------------------------------------------------------------------------
test("statusLine steht getrennt und nicht unter den Hooks", () => {
  const s = ergebnis.statusLine;
  assert.ok(s, "statusLine fehlt");
  assert.strictEqual(s.typ, "statusLine");
  assert.strictEqual(s.skript, "statusline.js");
  assert.strictEqual(s.pfad, ".claude/statusline.js");
  assert.strictEqual(s.befehlsart, "command");
  assert.strictEqual(s.vorhanden, true);
  assert.strictEqual(s.ereignis, undefined, "statusLine hat kein Ereignis");
  assert.ok(!ergebnis.eintraege.some((e) => e.skript === "statusline.js"));
  const zeilen = zeilenVon(".claude/settings.json");
  assert.ok(zeilen[s.settingsZeile - 1].includes("statusline.js"));
});

test("weitereSkripte enthaelt genau repo-status.js", () => {
  assert.deepStrictEqual(ergebnis.weitereSkripte.map((s) => s.skript), ["repo-status.js"]);
  const rs = ergebnis.weitereSkripte[0];
  assert.strictEqual(rs.id, "datei:.claude/repo-status.js");
  assert.strictEqual(rs.pfad, ".claude/repo-status.js");
  assert.strictEqual(rs.vorhanden, true);
  assert.ok(rs.kopfkommentar.text.length > 0);
  assert.ok(rs.claudeMdZeile && rs.claudeMdZeile.text.includes("repo-status.js"));
});

test("kein Skript steht zugleich in weitereSkripte und in einem Hook", () => {
  const verdrahtet = new Set(ergebnis.eintraege.map((e) => e.skript));
  verdrahtet.add(ergebnis.statusLine.skript);
  const alle = fs
    .readdirSync(path.join(WURZEL, ".claude"), { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith(".js")).length;
  assert.strictEqual(verdrahtet.size + ergebnis.weitereSkripte.length, alle);
  for (const s of ergebnis.weitereSkripte) assert.ok(!verdrahtet.has(s.skript));
});

// ---------------------------------------------------------------------------
// Windows und Datenform
// ---------------------------------------------------------------------------
test("alle Pfade sind POSIX, kein einziger Backslash im Datensatz", () => {
  const rueckwaerts = String.fromCharCode(92);
  const funde = [];
  const lauf = (wert, ort) => {
    if (typeof wert === "string") {
      if (wert.includes(rueckwaerts)) funde.push(`${ort} = ${wert.slice(0, 60)}`);
      return;
    }
    if (wert && typeof wert === "object") for (const k of Object.keys(wert)) lauf(wert[k], `${ort}.${k}`);
  };
  lauf(ergebnis, "ergebnis");
  assert.deepStrictEqual(funde, []);
  for (const e of ergebnis.eintraege) assert.match(e.pfad, /^\.claude\/[a-z-]+\.js$/);
});

test("jeder Eintrag traegt den vollen Feldsatz des Vertrags", () => {
  const felder = [
    "id", "ereignis", "matcher", "bedingung", "skript", "pfad", "reihenfolge", "timeout",
    "asynchron", "ansage", "settingsZeile", "kopfkommentar", "claudeMdZeile", "ausloeser",
    "wirkung", "wirkungBeleg", "vorhanden", "probe",
  ];
  for (const e of ergebnis.eintraege) {
    assert.deepStrictEqual(Object.keys(e).sort(), [...felder].sort(), `Feldsatz bei ${e.skript}`);
    assert.strictEqual(e.vorhanden, true);
    assert.ok(Array.isArray(e.ausloeser));
  }
});

// ---------------------------------------------------------------------------
// Fehlerfaelle -- nie raten, nie stumm schlucken
// ---------------------------------------------------------------------------
test("ohne Wurzel: Fehlercode statt Absturz", () => {
  const r = hooksDetail(null, {});
  assert.deepStrictEqual(r.eintraege, []);
  assert.strictEqual(r.statusLine, null);
  assert.strictEqual(r.fehler[0].code, "wurzel-fehlt");
});

test("Ordner ohne .claude/settings.json: Fehlercode settings-fehlt", () => {
  const r = hooksDetail(os.tmpdir(), {});
  assert.deepStrictEqual(r.eintraege, []);
  assert.deepStrictEqual(r.weitereSkripte, []);
  assert.strictEqual(r.statusLine, null);
  assert.strictEqual(r.fehler.length, 1);
  assert.strictEqual(r.fehler[0].code, "settings-fehlt");
  assert.strictEqual(r.fehler[0].pfad, ".claude/settings.json");
  assert.ok(r.fehler[0].grund.length > 0, "Grund darf nicht leer sein");
});

// ---------------------------------------------------------------------------
// Probe-Laeufe -- der teuerste Teil, deshalb zuletzt
// ---------------------------------------------------------------------------
test("ohne opts.proben startet KEIN Kindprozess", () => {
  assert.strictEqual(spawnsNachStrukturmessung, 0, "hooks-detail hat ohne Flag gespawnt");
  for (const e of ergebnis.eintraege) assert.strictEqual(e.probe, null, `probe bei ${e.skript}`);
  assert.strictEqual(ergebnis.statusLine.probe, null);
  const vorher = spawnZaehler;
  hooksDetail(WURZEL, { proben: false });
  assert.strictEqual(spawnZaehler, vorher, "proben:false hat gespawnt");
});

test("mit opts.proben: gestartet wird nur, was gestartet werden darf", () => {
  const vorher = spawnZaehler;
  const r = hooksDetail(WURZEL, { proben: true });
  const alle = [...r.eintraege, r.statusLine];
  const gelaufen = alle.filter((e) => e.probe.befehl !== null);
  assert.strictEqual(spawnZaehler - vorher, gelaufen.length, "es wurde mehr gespawnt als berichtet");
  assert.deepStrictEqual(gelaufen.map((e) => e.skript).sort(), [
    "danger-guard.js", "onboarding-start.js", "project-context.js", "session-roles.js", "statusline.js",
  ]);
  const dg = r.eintraege.find((e) => e.skript === "danger-guard.js");
  assert.strictEqual(dg.probe.befehl, "node .claude/danger-guard.js --selbsttest");
  assert.strictEqual(dg.probe.exit, 0);
  assert.strictEqual(dg.probe.timeout, false);
  assert.ok(dg.probe.stdoutBytes > 0 && dg.probe.stdoutKopf.length > 0);
  assert.strictEqual(dg.probe.umgebung.CLAUDE_PROJECT_DIR, WURZEL.split(path.sep).join("/"));
});

// Gegenprobe zur Dummy-Eingabe: mit POSIX-cwd faellt statusline.js:53 auf den
// leeren Zweig und die Probe misst eine Beschriftung, die es real nicht gibt.
test("die statusLine-Probe bekommt einen cwd, den statusline.js wiedererkennt", () => {
  const r = hooksDetail(WURZEL, { proben: true });
  const p = r.statusLine.probe;
  assert.strictEqual(p.exit, 0);
  assert.ok(p.stdoutKopf.includes(path.basename(WURZEL)), `ohne Repo-Namen: ${JSON.stringify(p.stdoutKopf)}`);
  assert.strictEqual(p.befehl, "node .claude/statusline.js");
});

test("uncommitted-warn und git-guard werden nie gestartet, mit Grundcode", () => {
  const r = hooksDetail(WURZEL, { proben: true });
  const uw = r.eintraege.find((e) => e.skript === "uncommitted-warn.js");
  const gg = r.eintraege.find((e) => e.skript === "git-guard.js");
  assert.strictEqual(uw.probe.befehl, null);
  assert.strictEqual(uw.probe.uebersprungen, "schreibt-drossel-stempel");
  assert.strictEqual(gg.probe.befehl, null);
  assert.strictEqual(gg.probe.uebersprungen, "loescht-index-lock");
  for (const name of ["commit-pathspec-guard.js", "sessionpost-guard.js"]) {
    const e = r.eintraege.find((x) => x.skript === name);
    assert.strictEqual(e.probe.uebersprungen, "braucht-werkzeug-eingabe");
  }
});

test("SessionStart-Probe bekommt startup auf stdin und CLAUDE_PROJECT_DIR im env", () => {
  const r = hooksDetail(WURZEL, { proben: true });
  const sr = r.eintraege.find((e) => e.skript === "session-roles.js");
  assert.strictEqual(sr.probe.exit, 0);
  // Der Beweis, dass die stdin-Zeile ankam: /i-have-adhd schickt session-roles.js
  // NUR bei source=startup (session-roles.js:96).
  assert.match(sr.probe.stdoutKopf, /i-have-adhd/);
  assert.strictEqual(sr.probe.stdoutBytes > 0, true);
  for (const e of r.eintraege) {
    assert.strictEqual(e.probe.umgebung.CLAUDE_PROJECT_DIR, WURZEL.split(path.sep).join("/"));
    assert.strictEqual(e.probe.timeout, false);
    assert.strictEqual(e.probe.fehlerCode, null);
  }
});

test("stdoutKopf laeuft durch textSichern -- eigene Fassung ersetzbar", () => {
  let aufrufe = 0;
  const r = hooksDetail(WURZEL, {
    proben: true,
    textSichern: () => {
      aufrufe += 1;
      return "[geprueft]";
    },
  });
  const gelaufen = [...r.eintraege, r.statusLine].filter((e) => e.probe.befehl !== null);
  assert.strictEqual(aufrufe, gelaufen.length);
  for (const e of gelaufen) assert.strictEqual(e.probe.stdoutKopf, "[geprueft]");
});

// inventar.js gibt aus textSichern ein Objekt zurueck, nicht eine Zeichenkette
// (inventar.js:131-141). Ohne diesen Test faellt die Verdrahtung erst im Browser auf.
test("textSichern darf auch die Objekt-Form von inventar.js liefern", () => {
  const r = hooksDetail(WURZEL, {
    proben: true,
    textSichern: (s) => ({ text: `${s.slice(0, 4)}<gesichert>`, ausgeblendeteZeilen: [] }),
  });
  const dg = r.eintraege.find((e) => e.skript === "danger-guard.js");
  assert.match(dg.probe.stdoutKopf, /<gesichert>$/);
  assert.ok(!dg.probe.stdoutKopf.includes("object Object"));
});

test("eine unbekannte Rueckgabeform wird sichtbar markiert, nicht verschluckt", () => {
  const r = hooksDetail(WURZEL, { proben: true, textSichern: () => 42 });
  const dg = r.eintraege.find((e) => e.skript === "danger-guard.js");
  assert.strictEqual(dg.probe.stdoutKopf, "[sicherung:unbekannte-form]");
  assert.ok(dg.probe.stdoutBytes > 0, "die Groesse bleibt gemessen, auch wenn der Kopf fehlt");
});
