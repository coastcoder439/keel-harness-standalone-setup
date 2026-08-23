// Test zu dashboard/serve.js -- Bordmittel, node:test.
//
// WAS HIER AUF DEM SPIEL STEHT
// Dieser Server SCHREIBT Dateien. Er hat keine Anmeldung, und alles, was ihn
// erreicht, kommt aus einem Browser. Die Pfad-Pruefung ist deshalb keine
// Formsache, sondern die einzige Schranke zwischen einer Adresszeile und dem
// Dateisystem -- und sie muss in BEIDE Richtungen stimmen: nichts durchlassen,
// was hinausfuehrt, und nichts blockieren, was gebraucht wird.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");

const { argumenteLesen, pfadPruefen, wurzelFinden, starten } = require("../serve.js");

const WURZEL = path.resolve(__dirname, "..", "..");

// ---------------------------------------------------------------------------
// Argumente
// ---------------------------------------------------------------------------

test("Argumente: Vorgaben, Port, Wurzel, nur-lesen", () => {
  const leer = argumenteLesen(["node", "serve.js"]);
  assert.strictEqual(leer.port, 8765);
  assert.strictEqual(leer.wurzel, null);
  assert.strictEqual(leer.nurLesen, false);

  const voll = argumenteLesen(["node", "serve.js", "--port", "9000", "--nur-lesen", "--wurzel", WURZEL]);
  assert.strictEqual(voll.port, 9000);
  assert.strictEqual(voll.nurLesen, true);
  assert.strictEqual(voll.wurzel, path.resolve(WURZEL));
});

test("Argumente: ein unsinniger Port wird abgelehnt, nicht stillschweigend ersetzt", () => {
  // Ein Port 0 oder 99999 waere ein Tippfehler. Ihn durch die Vorgabe zu
  // ersetzen hiesse, auf einem anderen Port zu horchen als angesagt.
  for (const schlecht of ["0", "70000", "-1", "acht", ""]) {
    assert.throws(() => argumenteLesen(["node", "serve.js", "--port", schlecht]), /port/i, "Port " + JSON.stringify(schlecht));
  }
  assert.throws(() => argumenteLesen(["node", "serve.js", "--unbekannt"]), /Unbekanntes Argument/);
});

// ---------------------------------------------------------------------------
// Die Pfad-Pruefung -- beide Richtungen
// ---------------------------------------------------------------------------

test("kein Weg fuehrt aus dem Workspace hinaus", () => {
  const draussen = [
    "../../../Windows/System32/drivers/etc/hosts",
    "..\\..\\geheim.txt",
    "docs/../../oben.md",
    "C:/Windows/win.ini",
    "/etc/passwd",
    "\\\\server\\freigabe\\datei.md",
  ];
  for (const p of draussen) {
    const r = pfadPruefen(WURZEL, p, "schreiben");
    assert.ok(r.fehler, "durchgelassen: " + JSON.stringify(p));
  }
});

test("ein Null-Byte wird abgelehnt, nicht entfernt", () => {
  // Wer es entfernt, schreibt am Ende auf einen ANDEREN Pfad als den
  // angefragten -- genau darauf zielt der Trick. Gemessen 23.08.2026:
  // "docs/x\0.md" wurde zu "docs/x.md" und kam durch.
  const r = pfadPruefen(WURZEL, "docs/x" + String.fromCharCode(0) + ".md", "schreiben");
  assert.ok(r.fehler, "durchgelassen");
  assert.match(r.fehler, /Null-Byte/);
});

test("Zugangsdateien werden nie geschrieben, auch nicht mit gueltigem Pfad", () => {
  const gesperrt = [".claude/settings.local.json", ".env", ".env.local", "privat.key", "server.pem"];
  for (const p of gesperrt) {
    const r = pfadPruefen(WURZEL, p, "schreiben");
    assert.ok(r.fehler, "durchgelassen: " + p);
  }
});

test("erzeugte Staende und Git-Innenleben sind nicht bearbeitbar", () => {
  for (const p of ["dashboard.html", "dashboard.json", ".git/config", ".git/HEAD"]) {
    assert.ok(pfadPruefen(WURZEL, p, "schreiben").fehler, "durchgelassen: " + p);
  }
});

test("nur Textdateien, die ein Mensch sinnvoll bearbeitet", () => {
  for (const p of ["bild.png", "archiv.zip", "programm.exe", "schrift.woff2"]) {
    assert.ok(pfadPruefen(WURZEL, p, "schreiben").fehler, "durchgelassen: " + p);
  }
});

test("die Gegenrichtung: was gebraucht wird, kommt durch", () => {
  // Ohne diese Haelfte waere eine Pruefung, die ALLES blockiert, fehlerfrei --
  // und der Editor nutzlos.
  const erlaubt = [
    "CLAUDE.md",
    "docs/dashboard-spec.md",
    ".claude/rules/keel/tools.md",
    ".claude/commands/save-work.md",
    ".claude/settings.json",
    ".gitignore",
    "dashboard/render/worte.js",
  ];
  for (const p of erlaubt) {
    const r = pfadPruefen(WURZEL, p, "schreiben");
    assert.ok(!r.fehler, "blockiert: " + p + " (" + r.fehler + ")");
    assert.strictEqual(r.rel, p);
    assert.ok(path.isAbsolute(r.abs));
  }
});

test("Lesen ist weiter gefasst als Schreiben -- aber nicht ueber die Wurzel hinaus", () => {
  // Ein Bild darf angezeigt, aber nicht bearbeitet werden.
  assert.ok(!pfadPruefen(WURZEL, "bild.png", "lesen").fehler, "Lesen eines Bildes blockiert");
  assert.ok(pfadPruefen(WURZEL, "../oben.png", "lesen").fehler, "Lesen ausserhalb erlaubt");
});

test("ein leerer oder fehlender Pfad ist ein Fehler, kein Standardwert", () => {
  for (const p of [undefined, null, ""]) {
    const r = pfadPruefen(WURZEL, p, "lesen");
    assert.ok(r.fehler, "durchgelassen: " + JSON.stringify(p));
  }
});

// ---------------------------------------------------------------------------
// Wurzelsuche
// ---------------------------------------------------------------------------

test("wurzelFinden steigt bis zum Ordner mit .claude auf", () => {
  const tief = path.join(WURZEL, "dashboard", "render", "client");
  assert.strictEqual(path.resolve(wurzelFinden(tief)), path.resolve(WURZEL));
});

test("wurzelFinden gibt den Startpunkt zurueck, wenn es kein .claude gibt", () => {
  // Kein Absturz, keine Endlosschleife, kein stiller Griff nach C:\ --
  // die Wurzelsuche muss auch ausserhalb eines Harness enden.
  const leer = fs.mkdtempSync(path.join(os.tmpdir(), "ohne-claude-"));
  try {
    assert.strictEqual(path.resolve(wurzelFinden(leer)), path.resolve(leer));
  } finally {
    fs.rmSync(leer, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Der laufende Server -- gegen einen Wegwerf-Workspace
// ---------------------------------------------------------------------------

function mitServer(fn, opt) {
  const wb = fs.mkdtempSync(path.join(os.tmpdir(), "serve-test-"));
  fs.mkdirSync(path.join(wb, ".claude"), { recursive: true });
  fs.mkdirSync(path.join(wb, "docs"), { recursive: true });
  fs.writeFileSync(path.join(wb, "CLAUDE.md"), "# Probe\n");
  fs.writeFileSync(path.join(wb, "docs", "notiz.md"), "# Notiz\n\nErste Fassung.\n");
  fs.writeFileSync(path.join(wb, "dashboard.html"), "<!doctype html><title>x</title>");

  // Port 0: das Betriebssystem sucht einen freien -- sonst scheitert der Test,
  // sobald jemand parallel den Vorschau-Server laufen hat.
  const server = starten(Object.assign({ port: 0, wurzel: wb, nurLesen: false }, opt || {}));
  return new Promise((fertig, schief) => {
    server.on("listening", () => {
      const port = server.address().port;
      Promise.resolve(fn({ wb, port, url: (w) => "http://127.0.0.1:" + port + w }))
        .then((r) => { server.close(() => { fs.rmSync(wb, { recursive: true, force: true }); fertig(r); }); })
        .catch((e) => { server.close(() => { fs.rmSync(wb, { recursive: true, force: true }); schief(e); }); });
    });
  });
}

test("der Server schreibt eine Datei und erhaelt dabei die Zeilenenden", async () => {
  await mitServer(async ({ wb, url }) => {
    const crlf = path.join(wb, "docs", "crlf.md");
    fs.writeFileSync(crlf, "# Kopf\r\n\r\nZeile.\r\n");

    const a = await fetch(url("/datei?pfad=docs%2Fcrlf.md"), {
      method: "PUT",
      body: "# Kopf\n\nGeaendert.\n",
    });
    assert.strictEqual(a.status, 200);
    const roh = fs.readFileSync(crlf, "utf8");
    assert.ok(roh.includes("Geaendert."), "der neue Text steht nicht in der Datei");
    assert.ok(/\r\n/.test(roh), "CRLF verloren -- git zeigt sonst die ganze Datei als geaendert");
    assert.ok(!/[^\r]\n/.test(roh), "gemischte Zeilenenden");
  });
});

test("der Server lehnt einen Ausbruchsversuch ab und schreibt nichts", async () => {
  await mitServer(async ({ wb, url }) => {
    const a = await fetch(url("/datei?pfad=" + encodeURIComponent("../ausbruch.md")), {
      method: "PUT",
      body: "sollte nie ankommen",
    });
    assert.strictEqual(a.status, 400);
    assert.ok(!fs.existsSync(path.join(path.dirname(wb), "ausbruch.md")), "Datei wurde ausserhalb angelegt");
  });
});

test("mit --nur-lesen wird nichts geschrieben", async () => {
  await mitServer(async ({ wb, url }) => {
    const vorher = fs.readFileSync(path.join(wb, "docs", "notiz.md"), "utf8");
    const a = await fetch(url("/datei?pfad=docs%2Fnotiz.md"), { method: "PUT", body: "veraendert" });
    assert.strictEqual(a.status, 403);
    assert.strictEqual(fs.readFileSync(path.join(wb, "docs", "notiz.md"), "utf8"), vorher);
  }, { nurLesen: true });
});

test("der Server liefert die Seite und setzt Kopfzeilen gegen Fremdinhalte", async () => {
  await mitServer(async ({ url }) => {
    const a = await fetch(url("/"));
    assert.strictEqual(a.status, 200);
    assert.match(a.headers.get("content-type") || "", /text\/html/);
    assert.match(a.headers.get("content-security-policy") || "", /default-src 'self'/);
    assert.strictEqual(a.headers.get("x-content-type-options"), "nosniff");
  });
});

test("eine Datei mit etwas, das wie ein Zugang aussieht, wird nicht ausgeliefert", async () => {
  await mitServer(async ({ wb, url }) => {
    fs.writeFileSync(path.join(wb, "docs", "zugang.md"), '# Zugang\n\npassword: "Qx7Zephir-Nordlicht"\n');
    const a = await fetch(url("/datei?pfad=docs%2Fzugang.md"));
    assert.strictEqual(a.status, 403, "der Rohtext wurde ausgeliefert");
    const j = await a.json();
    assert.match(j.fehler, /Zugang/);
  });
});
