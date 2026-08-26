// Tests zu dashboard/bridge.js -- node:test, Bordmittel.
//
// Die Logik ist bewusst pur (deps injizierbar bzw. Fixture-Baeume): Paket-Scan,
// Checkbox-Kippen, Rollen-Parse, Session-Slug. runSelftest laeuft EINMAL echt
// gegen den schnellsten Waechter (prompt-form, ~0,1s) -- der Endpunkt ist sonst
// nur Whitelist-Logik.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");

const bridge = require("../bridge.js");

const WURZEL = path.resolve(__dirname, "..", "..");

function baumBauen(dateien) {
  const wurzel = fs.mkdtempSync(path.join(os.tmpdir(), "harness-tmp-bridge-"));
  for (const [rel, text] of Object.entries(dateien)) {
    const ziel = path.join(wurzel, rel);
    fs.mkdirSync(path.dirname(ziel), { recursive: true });
    fs.writeFileSync(ziel, text);
  }
  return wurzel;
}
const baumWeg = (w) => fs.rmSync(w, { recursive: true, force: true });

const PAKET =
  "# Work package: demo\n\n**Problem:** kaputt\n**Intent:** darum\n**Goal:** heil\n\n" +
  "## Plan\n\n1. [x] erster Schritt\n2. [ ] zweiter Schritt\n\n## Status\n\n24.08. — laeuft\n\n" +
  "## Definition of Done\n\nGeprueft gegen: X\nOffen: zweiter Schritt\n";

test("scanPackages findet Werkbank- und Projekt-Pakete, TEMPLATE bleibt draussen", () => {
  const w = baumBauen({
    "docs/packages/TEMPLATE.md": PAKET,
    "docs/packages/eins.md": PAKET,
    "user-projects/alpha/docs/packages/zwei.md": PAKET,
    "user-projects/ohne-pakete/README.md": "nix",
  });
  try {
    const p = bridge.scanPackages(w);
    assert.strictEqual(p.length, 2, "TEMPLATE.md und paketlose Repos zaehlen nicht");
    const eins = p.find((x) => x.file === "docs/packages/eins.md");
    const zwei = p.find((x) => x.file === "user-projects/alpha/docs/packages/zwei.md");
    assert.ok(eins && zwei);
    assert.strictEqual(eins.kind, "workbench");
    assert.strictEqual(zwei.kind, "project");
    assert.strictEqual(zwei.repo, "alpha");
    assert.strictEqual(eins.title, "Work package: demo");
    assert.strictEqual(eins.goal, "heil");
    assert.strictEqual(eins.totalSteps, 2);
    assert.strictEqual(eins.doneSteps, 1);
    assert.strictEqual(eins.steps[1].text, "zweiter Schritt");
    assert.match(eins.openLine, /^Offen:/);
  } finally {
    baumWeg(w);
  }
});

test("toggleStep kippt genau die n-te Checkbox, beide Richtungen, Fehl-Index sauber", () => {
  const hin = bridge.toggleStep(PAKET, 1);
  assert.ok(hin.ok && hin.nowDone, "1 -> [x]");
  assert.match(hin.text, /2\. \[x\] zweiter Schritt/);
  const zurueck = bridge.toggleStep(hin.text, 0);
  assert.ok(zurueck.ok && !zurueck.nowDone, "0 -> [ ]");
  assert.match(zurueck.text, /1\. \[ \] erster Schritt/);
  const daneben = bridge.toggleStep(PAKET, 9);
  assert.strictEqual(daneben.ok, false);
});

test("parseRoles liest die Rollen-Tabelle, Kopf- und Trennzeilen zaehlen nicht", () => {
  const rollen = bridge.parseRoles(
    "| Session-Titel | Rolle | seit |\n|---|---|---|\n| ALPHA | Bau | 24.08. |\n| BETA | Review | 24.08. |\nkein Tabellentext\n"
  );
  assert.deepStrictEqual(rollen, { ALPHA: "Bau", BETA: "Review" });
});

test("projectForRole liest die bestehende Rollen-Konvention -- kein Rateersatz", () => {
  const w = "keel-harness-live-1";
  // Workbench-Paket: "... (Paket docs/packages/dashboard.md)"
  assert.deepStrictEqual(
    bridge.projectForRole("Dashboard-Neubau per gauntlet-loop (Paket docs/packages/dashboard.md)", "/x/" + w),
    { repo: w, file: "docs/packages/dashboard.md" }
  );
  // Benanntes Projekt: "Projekt <name> (user-projects)"
  assert.deepStrictEqual(
    bridge.projectForRole("Projekt keel-showcase (user-projects)", "/x/" + w),
    { repo: "keel-showcase", file: null }
  );
  // Paket in einem benannten Projekt-Repo
  assert.deepStrictEqual(
    bridge.projectForRole("Bau (user-projects/keel-showcase/docs/packages/foo.md)", "/x/" + w),
    { repo: "keel-showcase", file: "user-projects/keel-showcase/docs/packages/foo.md" }
  );
  // "Harness" ohne Paketpfad -> Workbench als Vorschlag
  assert.deepStrictEqual(
    bridge.projectForRole("Harness-Betrieb, Kontrolle und Bau", "/x/" + w),
    { repo: w, file: null }
  );
  // Kein Treffer -> null, KEIN Rateersatz
  assert.strictEqual(bridge.projectForRole("Irgendeine freie Notiz ohne Bezug", "/x/" + w), null);
  assert.strictEqual(bridge.projectForRole(null, "/x/" + w), null);
});

test("scanSessions traegt project, wo die Rolle es hergibt", () => {
  // Selbststaendige Fixture, NICHT die echte docs/08-sessions-rollen.md dieses
  // Workspace -- die traegt in einer frischen Bausatz-Installation einen
  // anderen Inhalt (Falle, im Gedaechtnis dieser Werkbank schon zweimal notiert).
  // Die "Projekt X (user-projects)"-Form haengt zudem an keinem Ordnernamen.
  const wurzel = fs.mkdtempSync(path.join(os.tmpdir(), "harness-tmp-root-"));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-tmp-sessions-"));
  try {
    fs.mkdirSync(path.join(wurzel, "docs"), { recursive: true });
    fs.writeFileSync(
      path.join(wurzel, "docs", "08-sessions-rollen.md"),
      "| Session-Titel | Rolle | seit |\n|---|---|---|\n"
        + "| Testsitzung | Bau (Projekt sample-project (user-projects)) | heute |\n"
    );
    fs.writeFileSync(path.join(dir, "s1.jsonl"), JSON.stringify({ type: "custom-title", customTitle: "Testsitzung" }) + "\n");
    const sitzungen = bridge.scanSessions(wurzel, { sessionsDir: dir });
    const s1 = sitzungen.find((s) => s.id === "s1");
    assert.ok(s1, "Sitzung nicht gefunden");
    assert.strictEqual(s1.role, "Bau (Projekt sample-project (user-projects))");
    assert.deepStrictEqual(s1.project, { repo: "sample-project", file: null });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(wurzel, { recursive: true, force: true });
  }
});

test("workspaceSlug traegt keine Pfadzeichen und trifft den Projekte-Ordner, wo es ihn gibt", () => {
  const slug = bridge.workspaceSlug(WURZEL);
  assert.ok(!/[:\\/]/.test(slug), "keine Pfadzeichen im Slug");
  // Existenz-Gegenprobe NUR, wenn dieser Workspace wirklich als Claude-Projekt
  // gefuehrt wird -- eine frische Test-Installation (Temp-Wurzel) hat zu Recht
  // keinen Slug-Ordner, und ein roter Test dort meldete einen Fehler, wo nur
  // eine Bedingung fehlt (Muster wennDa, siehe file-inventory.test.js).
  const dir = path.join(os.homedir(), ".claude", "projects", slug);
  if (fs.existsSync(dir)) {
    assert.ok(fs.readdirSync(dir).some((n) => n.endsWith(".jsonl")), "Slug-Ordner ohne Transcripte: " + dir);
  }
});

test("runSelftest: Whitelist haelt, und prompt-form laeuft echt gruen", () => {
  assert.strictEqual(bridge.runSelftest(WURZEL, "../../etc/passwd").ok, false, "nur Whitelist-Namen");
  assert.strictEqual(bridge.runSelftest(WURZEL, "statusline").ok, false, "statusline hat keinen Selbsttest");
  const r = bridge.runSelftest(WURZEL, "prompt-form");
  assert.strictEqual(r.ok, true, r.output);
  assert.match(r.output, /richtig\./);
});

test("writeOrder legt die Auftragsdatei an, leer und zu lang werden abgelehnt", () => {
  const w = baumBauen({ "CLAUDE.md": "x" });
  try {
    assert.strictEqual(bridge.writeOrder(w, "all", "   ").ok, false);
    assert.strictEqual(bridge.writeOrder(w, "all", "x".repeat(2001)).ok, false);
    const r = bridge.writeOrder(w, "s1", "mach X");
    assert.ok(r.ok);
    const datei = path.join(w, ".claude", "orders", r.file);
    const inhalt = JSON.parse(fs.readFileSync(datei, "utf8"));
    assert.strictEqual(inhalt.target, "s1");
    assert.strictEqual(inhalt.text, "mach X");
    assert.ok(inhalt.ts);
  } finally {
    baumWeg(w);
  }
});
