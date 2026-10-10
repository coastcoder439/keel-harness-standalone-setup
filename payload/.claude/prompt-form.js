#!/usr/bin/env node
// UserPromptSubmit: keep response discipline and the already-declared package
// identity at the point of use. This hook never scans for or selects packages.

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const packageBindings = require("../harness-core/binding/package-binding.cjs");
const sessionRecords = require("../harness-core/binding/session-records.cjs");
const hookActivity = require("../harness-core/binding/hook-activity.cjs");

const ORDER_ALL_MINUTES = 10;

// A16: the binding search costs 1-4 Git calls. A session without a leaf binding record cannot pass it, so
// that question is answered from the file system first; only a bound session pays for Git. A test that
// injects its own search keeps it (deps.findSessionBinding).
function currentPackageBinding(projectRoot, sessionId, deps = {}) {
  const find = deps.findSessionBinding || packageBindings.findSessionBinding;
  if (!deps.findSessionBinding && !sessionRecords.hasLeafRecord(projectRoot, sessionId, projectRoot)) return null;
  try {
    const value = find(projectRoot, sessionId);
    const displayRoot = fs.existsSync(projectRoot) ? (fs.realpathSync.native || fs.realpathSync)(projectRoot) : path.resolve(projectRoot);
    const relativeRepo = path.relative(displayRoot, value.repoRoot).replaceAll("\\", "/");
    return {
      repoRoot: value.repoRoot,
      repoKey: !relativeRepo ? "." : relativeRepo.startsWith("../") ? value.repoRoot : relativeRepo,
      packageId: value.packageId,
      packageFile: value.packagePath + "/PACKAGE.md",
      scope: value.scope,
      leaf: value.leaf,
    };
  } catch { return null; }
}

// A prompt is a sign of life of the planning session (D15). A resumed conversation arrives with a new session
// id and no record: its transcript names the old session, and the planning binding moves over before the first
// tool call. Nothing here can fail the hook, and the package module loads only when there is something to adopt.
function resumeAndNoteActivity(projectRoot, sessionId, transcriptPath) {
  try {
    hookActivity.noteHookActivity(projectRoot, sessionId);
    if (!transcriptPath || sessionRecords.sessionRecords(projectRoot, sessionId, projectRoot).any) return null;
    if (!fs.existsSync(path.join(projectRoot, ".unlazy", ".bootstrap"))) return null;
    return require("../harness-core/binding/package-bootstrap.cjs").adoptByTranscript({ harnessRoot: projectRoot, sessionId,
      transcriptPath: String(transcriptPath) });
  } catch { return null; }
}

function shortForm(binding) {
  const packageRule = binding
    ? "Paketkontext: " + binding.repoKey + "::" + binding.packageId + " in " + binding.packageFile +
      "; Scope " + binding.scope + ", Leaf " + binding.leaf +
      ". Reihenfolge: OWNER.md und PackageStatus lesen, dann ausschliesslich den naechsten Package-Executor-Uebergang ausfuehren; Planhaken werden aus Evidence abgeleitet. "
    : "Paketkontext: noch ungebunden. ";
  return "Antwortform (jede Antwort): Antwort zuerst, dann Antwortart (Entscheidung/Bericht/Analyse). " +
    packageRule +
    "Der naechste Git-Root des Schreibziels besitzt das Bundle; es gibt keine zentrale Werkbank-Paketsuche. " +
    "<repo>/.unlazy/<scope>/ ist ignorierter, loeschbarer Runtimezustand und nie fachliche Wahrheit. " +
    "Behauptet eine Meldung Fertigsein, endet sie mit `Geprueft gegen:` und `Offen:`; dieses Format ist kein Package-Close-Receipt. " +
    "Nichttriviale Arbeit braucht vor dem Bau Owner-Vertrag, PIG, Depth Tree und Gates. Recherche braucht zwei unabhaengige Quellen. " +
    "Listen haben hoechstens fuenf Punkte und stehen ab zwei Punkten untereinander. Nenne das Ergebnis, nicht die Arbeitschronik. " +
    "Jede Antwort nennt den naechsten Arbeitsauftrag samt Besitzer; entschiedene eigene Arbeit wird ausgefuehrt. " +
    "Ist die Nachricht eine Frage, beantworte sie; ändere dabei keine Dateien, außer der Owner verlangt es ausdrücklich. " +
    "Abruf-Werkzeuge: completeness = Abschlussaudit; save-work = kontextbezogen sichern; repo-status = Repo-Abgleich; " +
    "session-map/tell-session = Sitzungskoordination; gauntlet-loop = Qualitaetsschleife; onboarding = Frischinstallation.";
}

function ordersFor(deps, sessionId) {
  const entries = [];
  let files = [];
  try { files = deps.listdir(deps.ordersDir).filter((name) => name.endsWith(".json")); }
  catch { return entries; }
  for (const name of files) {
    let order;
    try { order = JSON.parse(deps.read(deps.ordersDir + "/" + name)); }
    catch { continue; }
    const ageMinutes = (deps.now() - Date.parse(order.ts || 0)) / 60000;
    if (order.target === "all") {
      if (ageMinutes > ORDER_ALL_MINUTES) deps.deliver(name);
      else entries.push(order.text);
    } else if (order.target === sessionId) {
      entries.push(order.text);
      deps.deliver(name);
    }
  }
  return entries;
}

function output(orders, binding) {
  let text = shortForm(binding);
  if (orders && orders.length) text += " || AUFTRAG von der Kommandobruecke [Owner]: " + orders.join(" | ");
  return JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: text } });
}

function selfTest() {
  const delivered = [];
  const now = Date.now();
  const deps = {
    ordersDir: "orders",
    listdir: () => ["a.json", "b.json", "c.json", "broken.json"],
    read: (file) => ({
      "orders/a.json": JSON.stringify({ target: "s1", text: "mach X", ts: new Date(now).toISOString() }),
      "orders/b.json": JSON.stringify({ target: "all", text: "an alle", ts: new Date(now).toISOString() }),
      "orders/c.json": JSON.stringify({ target: "s2", text: "nicht fuer uns", ts: new Date(now).toISOString() }),
      "orders/broken.json": "{{",
    })[file],
    deliver: (name) => delivered.push(name),
    now: () => now,
  };
  const binding = {
    repoRoot: "C:/work/child",
    repoKey: "user-projects/child",
    packageId: "release",
    packageFile: "docs/packages/release/PACKAGE.md",
    scope: "release",
    leaf: "leaf-code",
  };
  const orders = ordersFor(deps, "s1");
  const bound = JSON.parse(output(orders, binding)).hookSpecificOutput.additionalContext;
  const unbound = JSON.parse(output([], null)).hookSpecificOutput.additionalContext;
  const cases = [
    ["hook JSON remains valid", JSON.parse(output([], binding)).hookSpecificOutput.hookEventName === "UserPromptSubmit"],
    ["qualified package identity is injected", bound.includes("user-projects/child::release")],
    ["exact bundle path is injected", bound.includes("docs/packages/release/PACKAGE.md")],
    ["scope and leaf come from the canonical binding", bound.includes("Scope release, Leaf leaf-code")],
    ["work order is Owner truth then status then executor", /OWNER\.md.*PackageStatus.*Package-Executor/.test(bound)],
    ["runtime is explicitly non-authoritative", bound.includes(".unlazy/<scope>") && bound.includes("nie fachliche Wahrheit")],
    ["unbound context does not scan candidates", unbound.includes("noch ungebunden") && !unbound.includes("Kandidaten")],
    ["own and all orders are delivered", orders.length === 2 && orders.includes("mach X") && orders.includes("an alle")],
    ["only targeted order is moved", delivered.length === 1 && delivered[0] === "a.json"],
    ["orders appear in injected context", bound.includes("AUFTRAG von der Kommandobruecke")],
  ];
  let failures = 0;
  for (const [name, ok] of cases) {
    if (!ok) failures += 1;
    console.log((ok ? "ok  " : "FEHL") + " " + name);
  }
  console.log((cases.length - failures) + " von " + cases.length + " Faellen richtig.");
  return failures;
}

if (require.main === module) {
  if (process.argv.includes("--selbsttest")) process.exit(selfTest() ? 1 : 0);
  let inputText = "";
  process.stdin.on("data", (chunk) => { inputText += chunk; });
  process.stdin.on("end", () => {
    let payload = {};
    try { payload = JSON.parse(inputText || "{}"); } catch { /* base context still emitted */ }
    const projectRoot = process.env.CLAUDE_PROJECT_DIR;
    const sessionId = payload.session_id;
    if (projectRoot && sessionId) resumeAndNoteActivity(projectRoot, sessionId, payload.transcript_path);
    const binding = projectRoot && sessionId ? currentPackageBinding(projectRoot, sessionId) : null;
    let orders = [];
    try {
      if (projectRoot && sessionId) {
        const ordersDir = path.join(projectRoot, ".claude", "orders");
        const deliveredDir = path.join(ordersDir, "delivered");
        orders = ordersFor({
          ordersDir,
          listdir: (directory) => fs.readdirSync(directory),
          read: (file) => fs.readFileSync(file.split("/").join(path.sep), "utf8"),
          deliver: (name) => {
            fs.mkdirSync(deliveredDir, { recursive: true });
            fs.renameSync(path.join(ordersDir, name), path.join(deliveredDir, name));
          },
          now: () => Date.now(),
        }, sessionId);
      }
    } catch { /* orders are optional */ }
    process.stdout.write(output(orders, binding));
    process.exit(0);
  });
}

module.exports = { currentPackageBinding, ordersFor, output, resumeAndNoteActivity, shortForm };
