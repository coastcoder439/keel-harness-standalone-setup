#!/usr/bin/env node
// The command index (package P6, D17): where everything lies, what is allowed and what the way is called,
// for every session. It is built from the rules themselves and written by nobody:
//   - the Git intents and their syntax: CANONICAL_INTENTS of harness-core/git/git-intent.mjs
//   - the free Git reads: READ_ONLY of git-intent-guard
//   - the read, verifier, test, service and tool lists of the shell guard (VERIFIER_PATHS,
//     READ_ONLY_COMMANDS, CANONICAL_MUTATION_PATHS, READ_ONLY_TOOL_COMMANDS, SERVICE_PATHS, the node --test
//     switches and the test file rule), and the Owner additions of .claude/mutation-policy.json
//   - the commands of the package executor: harness-core/execution/executor-commands.mjs
//   - the measuring tool: MEASURE_USAGE of harness-core/tools/measure.mjs
//   - the way of every block code of every guard: harness-core/guards/guard-routes.cjs, the table the guards
//     themselves use for the line "Weg: siehe Befehlsindex ..." of their denials
// A change of one of these rules changes the index with no hand work; test/command-index.test.js runs the
// commands the index shows (the probes) through the real guards and reads every block code out of the guard
// sources, so an index that names a way the guards block, or lacks a code, fails there.
//
//   node harness-core/guards/command-index.mjs [--root <dir>] [--session <id>] [--compact | --full | --json | --section <Abschnitt>]
//
// The compact form is what every session gets at its start (under 6000 characters); --full and --section
// carry what does not fit. Every text of the index itself is ASCII: Codex runs hooks through Windows PowerShell, which
// re-encodes anything else (only a path or a name taken from the installation can carry other characters, and it is
// printed as it is, never altered). Nothing is written; the tool reads the rules and the policy file.

import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CANONICAL_INTENTS } from "../git/git-intent.mjs";
import { EXECUTOR_COMMANDS, EXECUTOR_USAGE_HEAD, requiredUsage } from "../execution/executor-commands.mjs";
import { MEASURE_USAGE } from "../tools/measure.mjs";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const CODE_ROOT = path.resolve(here, "..", "..");

export const INDEX_SCHEMA = "keel-command-index.v1";
export const COMPACT_LIMIT = 6000;
// How many names of one Owner list the session start prints before it says "+n more".
const LIST_CAP = 4;
// Longest name of an Owner list the session start prints whole.
const NAME_CAP = 48;
const LOOKUP = "node harness-core/guards/command-index.mjs";

export const SECTION_ORDER = Object.freeze(["Lesen", "Schreiben", "Testen", "Git", "Paket und Executor",
  "Veroeffentlichen", "Messen", "Temp-Ordner", "Owner"]);

// What a Git intent is for. Everything else about an intent (name, syntax) comes from CANONICAL_INTENTS; an
// intent that is missing here is listed as "undescribed" and the test fails.
const INTENT_PURPOSE = Object.freeze({
  inspect: "Git-Stand lesen (erhoehter Lesebefehl)",
  checkpoint: "sichern (add und commit)",
  unstage: "Index zuruecknehmen",
  "recover-index": "kaputten Index eines Pakets heilen",
  "discard-working": "eigene Aenderung verwerfen",
  "recover-discard": "Verworfenes zurueckholen",
  "revert-checkpoint": "letzten eigenen Checkpoint zuruecknehmen",
  "integration-checkpoint": "parallele Leaves einmal sichern",
  "plan-close": "Paketabschluss planen",
  "closure-checkpoint": "Paketabschluss sichern",
  "plan-publish": "Veroeffentlichen planen (push)",
  publish: "geplanten Stand nach origin schieben",
  "release-stale-lock": "verwaiste index.lock entfernen",
  "proof-note-write": "Pruefnotiz schreiben",
  "proof-notes-sync": "Pruefnotizen abgleichen",
  explain: "erklaeren, warum etwas kein Agentenweg ist",
});

// What the Owner alone does (docs/guard-scope.md, "Handlungen, die allein der Owner darf").
const OWNER_ACTIONS = Object.freeze([
  ["O1", "Zerstoerung und Schreiben ausserhalb des Arbeitsbereichs", "Zerstoerung ausserhalb"],
  ["O2", "Historienumschreibung, nicht rueckholbares Loeschen", "Historie umschreiben"],
  ["O3", "mutation-policy.json: MCP-Freigaben, productRoots, publishProjects", "Politikdatei"],
  ["O4", "Zugangsdaten anlegen oder aendern", "Zugangsdaten"],
  ["O5", "OK-Satz fuer close und publish (im Chat)", "OK-Satz close/publish"],
  ["O6", "OK fuer Harness-Dateien und Harness-Update", "Harness-Update"],
]);

// What the compact form shows in full; the other intents and executor commands only by name.
const COMPACT_INTENTS = Object.freeze(["checkpoint", "unstage", "discard-working", "integration-checkpoint", "plan-publish", "publish"]);
const COMPACT_EXECUTOR = Object.freeze(["next/start", "dispatch", "return", "integrate", "status", "close"]);

// Common read commands, shown first; each is printed only while the shell guard's read list still has it.
const READ_SHORTLIST = Object.freeze(["cat", "head", "tail", "ls", "rg", "grep", "wc", "sort", "diff", "jq", "stat", "tree", "du"]);
// Reads the shell guard judges by their own classifiers, not by its list.
const CLASSIFIED_READS = "find, sed -n '1,5p' <Datei>, awk (nur lesend), gh api (nur GET)";

function loadGuards(codeRoot) {
  const shell = require(path.join(codeRoot, ".claude", "shell-mutation-guard.js"));
  const git = require(path.join(codeRoot, ".claude", "git-intent-guard.js"));
  const routes = require(path.join(codeRoot, "harness-core", "guards", "guard-routes.cjs"));
  const mcp = require(path.join(codeRoot, ".claude", "mcp-write-guard.js"));
  return { shell, git, routes, mcp };
}

// "checkpoint (--session <id> --path <p> | --root <r> --package <id>) --message <m> [--x]" without the optional parts.
function withoutOptional(syntax) {
  return syntax.replace(/\s*\[[^\]]*\]/gu, "").replace(/\s+/gu, " ").trim();
}

// "checks/{a,b}.mjs vendor/{c}.mjs x/tool.js"; where that is longer than maxChars, the directories with their counts.
// Only .mjs files are merged into one group: a verifier the Owner declared with another extension (.js, .cjs) keeps its
// full name, because the guard accepts exactly the declared file and an agent that calls "tool.mjs" instead is blocked
// (P21, follow-up of P6: UNDECLARED_NODE_SCRIPT).
function groupPaths(paths, maxChars = Infinity) {
  const byDirectory = new Map();
  const others = [];
  for (const item of [...paths].sort()) {
    if (!item.endsWith(".mjs")) { others.push(item); continue; }
    const slash = item.lastIndexOf("/");
    const directory = slash < 0 ? "" : item.slice(0, slash + 1);
    const file = slash < 0 ? item : item.slice(slash + 1);
    if (!byDirectory.has(directory)) byDirectory.set(directory, []);
    byDirectory.get(directory).push(file.replace(/\.mjs$/u, ""));
  }
  const names = [...[...byDirectory].map(([directory, files]) => directory + "{" + files.join(",") + "}.mjs"), ...others].join(" ");
  if (names.length <= maxChars) return names;
  return [...[...byDirectory].map(([directory, files]) => directory + "*.mjs (" + files.length + ")"), ...others].join(" ") +
    " (Namen: --section Testen)";
}

// Only the number of the files and of their folders: the last step before the session start gives up names, so the
// text no longer depends on how many verifiers an Owner list holds.
function countPaths(paths) {
  const list = [...paths];
  const directories = new Set(list.map((item) => (item.lastIndexOf("/") < 0 ? "" : item.slice(0, item.lastIndexOf("/")))));
  return list.length + " Pruefer in " + directories.size + " Ordnern (Namen: --section Testen)";
}

function capped(list, cap) {
  const names = [...list].map((name) => name.length > NAME_CAP ? name.slice(0, NAME_CAP - 3) + "..." : name);
  return names.length > cap ? names.slice(0, cap).join(", ") + " (+" + (names.length - cap) + ")" : names.join(", ");
}

function policyGrants(shell, mcp, root) {
  const policy = shell.loadMutationPolicy(root);
  const relative = (absolute) => path.relative(root, absolute).split(path.sep).join("/");
  return {
    file: ".claude/mutation-policy.json",
    present: policy.present,
    error: policy.error,
    productRoots: policy.productRoots.map(relative).sort(),
    publishProjects: policy.publishProjects.map(relative).sort(),
    mcpWriteTools: [...policy.mcpAllow].sort(),
    verifierPaths: [...policy.verifier].sort(),
    testPaths: [...policy.test].sort(),
    servicePaths: [...policy.service].sort(),
    mutationPaths: [...policy.mutation].sort(),
    // What no list of the Owner is needed for (mcp-write-guard.js): the app's own tools and the read verbs.
    appTools: [...mcp.APP_TOOLS.exact, ...mcp.APP_TOOLS.prefixes.map((prefix) => prefix + "*")].sort(),
    mcpReadVerbs: ((/\(\?:([^)]*)\)/u.exec(mcp.READ_ONLY_VERBS.source) || [])[1] || "").split("|").filter(Boolean),
  };
}

// A concrete folder of the session below the temp folder (the one the shell guard frees for it), for the probes.
function sessionTempFolder(sessionId) {
  return path.join(os.tmpdir(), "claude", "index-probe", String(sessionId)).split(path.sep).join("/");
}

function sessionTempPattern(sessionId) {
  const base = path.join(os.tmpdir(), "claude").split(path.sep).join("/");
  return base + "/<Ordner>/" + (sessionId ? String(sessionId) : "<session_id>") + "/";
}

function section(name, entries) {
  return { name, entries };
}

// One row of the index. `command` and `place` are the full text; `short` and `shortPlace` replace them in
// the compact form; `inCompact: false` leaves the row to the compact form's "weitere" line.
function entry(id, intent, command, place, extra = {}) {
  return { id, intent, command, place, ...extra };
}

export function buildIndex({ root = CODE_ROOT, sessionId = "", codeRoot = CODE_ROOT } = {}) {
  const { shell, git, routes, mcp } = loadGuards(codeRoot);
  const dataRoot = path.resolve(root);
  const grants = policyGrants(shell, mcp, dataRoot);
  const readNames = [...shell.READ_ONLY_COMMANDS].sort();
  const readShort = READ_SHORTLIST.filter((name) => shell.READ_ONLY_COMMANDS.has(name));
  const gitReads = [...git.READ_ONLY];
  const verifiers = [...new Set([...shell.VERIFIER_PATHS, ...grants.verifierPaths])].sort();
  const testSwitches = [...shell.NODE_TEST_SWITCHES].sort();
  const testValues = [...shell.NODE_TEST_VALUES].sort();
  const reporters = [...shell.NODE_TEST_REPORTERS].sort();
  const switchText = (short) => [...testValues.map((name) => name === "--test-reporter" ? name + "=<" + reporters.join("|") + ">"
    : short ? name : name === "--test-reporter-destination" ? name + "=<stdout|stderr|Temp-Ordner>" : name + "=<wert>"),
  ...testSwitches].join(" ");
  const testName = ".test." + (/\(\?:([^)]*)\)/u.exec(shell.TEST_FILE_NAME.source) || [])[1];
  const selfTests = [...shell.GUARD_SELF_TESTS].sort();
  const selfTestNames = selfTests.map((name) => name.replace(/^\.claude\//u, "").replace(/\.js$/u, ""));
  const readTools = [...shell.READ_ONLY_TOOL_COMMANDS].flatMap(([tool, commands]) => [...commands].sort().map((name) => ({ tool, name })));
  const readToolText = [...shell.READ_ONLY_TOOL_COMMANDS].map(([tool, commands]) => "node " + tool + " " + [...commands].sort().join("|")).join("; ");
  const mutationTools = [...new Set([...shell.CANONICAL_MUTATION_PATHS, ...grants.mutationPaths])].sort();
  const services = [...new Set([...shell.SERVICE_PATHS, ...grants.servicePaths])].sort();
  const voice = [...shell.SERVICE_VOICE_FLAGS].sort();
  const packageTool = shell.PACKAGE_TOOL_PATHS[0];
  const packageToolCommands = [...shell.PACKAGE_TOOL_COMMANDS].sort();
  const intents = CANONICAL_INTENTS.map((intent) => ({
    name: intent.name,
    mutates: intent.mutates,
    syntax: intent.syntax,
    purpose: INTENT_PURPOSE[intent.name] || null,
  }));
  const intentCommand = "node harness-core/git/git-intent.mjs ";
  const executorTool = "harness-core/execution/package-executor.mjs";
  const projects = grants.publishProjects;
  const executorLines = EXECUTOR_COMMANDS.map((command) => ({ name: command.name, required: requiredUsage(command),
    full: (command.name + " " + command.usage.replace(/\s+/gu, " ")).trim() }));
  const coreExecutor = executorLines.filter((line) => COMPACT_EXECUTOR.includes(line.name));
  const otherExecutor = [...new Set(executorLines.filter((line) => !COMPACT_EXECUTOR.includes(line.name)).map((line) => line.name))];
  const gitCore = intents.filter((intent) => COMPACT_INTENTS.includes(intent.name));
  const gitOther = intents.filter((intent) => !COMPACT_INTENTS.includes(intent.name)).map((intent) => intent.name);

  const sections = [
    section("Lesen", [
      entry("Dateien und Text", "Dateien lesen, suchen",
        readNames.join(" ") + "; " + CLASSIFIED_READS, "ueberall, nur lesend",
        { short: readShort.join(" ") + "; " + CLASSIFIED_READS,
          probes: ["cat README.md", "rg muster", "find . -name x", "sed -n '1,5p' README.md", "awk '{print $1}' README.md"] }),
      entry("Git lesen", "Git-Stand lesen",
        "git " + gitReads.join("|") + "; tag -l; remote -v; notes --ref keel-proof show", "jedes Repo, auch ohne Paket",
        { short: "git " + gitReads.join(" ") + "; tag -l; remote -v", shortPlace: "jedes Repo",
          probes: [...gitReads.map((name) => "git " + name), "git tag -l", "git remote -v", "git notes --ref keel-proof list"] }),
      entry("Lesebefehle ohne Schalter", "Lesebefehl, der schreibt oder Code startet",
        "denselben Befehl ohne -o, -f, -i, system(), > und ohne gh api POST", "Lesen", { inCompact: false }),
      entry("Befehlsform", "Befehl ausfuehren",
        "ausgeschrieben und direkt: kein bash -c, cmd /c, env, xargs, keine Variable davor, kein berechneter Name; 2>&1 ist frei",
        "Bash- und PowerShell-Werkzeug",
        { short: "ausgeschrieben, direkt: kein bash -c, env, xargs, keine Variable davor, kein $(...) als Name", shortPlace: "Bash, PowerShell",
          probes: ["echo ok 2>&1"] }),
    ]),
    section("Schreiben", [
      entry("Write/Edit", "Datei schreiben",
        "Write/Edit (Codex: apply_patch) auf einen Pfad; rm, mkdir, mv auf woertliche Pfade im OWNS",
        "OWNS des Leaf (ohne Paket: im Repo); nie > >> tee Set-Content Out-File",
        { short: "Write/Edit (Codex: apply_patch); rm, mkdir, mv auf woertliche Pfade im OWNS", shortPlace: "OWNS; nie > >> tee Set-Content" }),
      entry("Buendel und Belege", "Paket anlegen, Belege",
        "node " + packageTool + " " + packageToolCommands.join("|") + " --session <id> --root <repo> --package <id>",
        "docs/packages/<id>/ (PACKAGE.md OWNER.md GATES.md gates/); Belege in evidence/ und design/",
        { short: "node " + packageTool + " " + packageToolCommands.join("|") + " --session <id> ...", shortPlace: "docs/packages/<id>/",
          probes: ["node " + packageTool + " --help"] }),
      entry("Sitzungsnotiz", "Fakt an andere Sitzung",
        "/tell-session schreibt die Notiz; kein Senden an Sitzungen", "docs/session-notes/<rolle>.md", { inCompact: false }),
      entry("Abschlussmeldung", "Arbeitsmeldung beenden",
        "mit den Zeilen \"Geprueft gegen:\" und \"Offen:\"", "Ende der Antwort", { inCompact: false }),
    ]),
    section("Testen", [
      entry("node --test", "Tests",
        "node --test test/<datei>.test.js [weitere Dateien]; Schalter: " + switchText(false),
        "nur Dateien direkt in test/ der Installation oder einer Produkt-Wurzel, Namen " + testName + "; lange Laeufe im Vordergrund",
        { short: "node --test test/<datei>.test.js [mehr]; Schalter: " + switchText(true), shortPlace: "test/, " + testName + "; lange Laeufe im Vordergrund",
          probes: ["node --test test/x.test.js", "node --test --test-concurrency=1 test/x.test.js"] }),
      entry("Pruefer und Werkzeuge", "pruefen, Gates, Index",
        "node <Pfad> mit " + verifiers.join(" "), "relativ zur Wurzel",
        { short: "node <Pfad> mit " + groupPaths(verifiers, 760), shortPlace: "relativ zur Wurzel",
          shorter: "node <Pfad> mit " + groupPaths(verifiers, 0),
          shortest: "node <Pfad> mit " + countPaths(verifiers),
          // The brief of a work agent shows every name, whatever the length (no step of the session start's shrinking).
          unbounded: "node <Pfad> mit " + groupPaths(verifiers),
          probes: verifiers.map((item) => "node " + item) }),
      entry("Selbsttest", "Waechter pruefen",
        "node .claude/<waechter>.js --self-test (" + selfTestNames.join(" ") + "); node --check <Datei>", ".claude/",
        { short: "node .claude/<waechter>.js --self-test; node --check <Datei>",
          probes: selfTests.map((item) => "node " + item + " --self-test").concat(["node --check README.md"]) }),
      // Karte Arbeitsweise 07.10.2026: installing, building and testing with the project's own tools.
      entry("Projektwerkzeuge", "installieren, bauen, testen, Typen pruefen",
        "npm|pnpm|yarn install, npm ci mit --ignore-scripts (ohne Paketnamen, nie -g), npm|pnpm|yarn run <Skript aus package.json>, npm test, " +
        "npx|npm exec|pnpm exec <Programm aus node_modules/.bin>; nie --write, -w, --fix, format, lint:fix, codemod",
        "Sitzung ohne Bindung an einen Arbeitsschritt, im Ordner des Projekts; gebunden: die deklarierten Pruefer",
        { short: "npm ci|install --ignore-scripts, npm run <Skript>, npm test, npx <node_modules/.bin>; nie -g, --write, --fix", shortPlace: "ungebundene Sitzung, Projektordner" }),
      entry("Dashboard-Dienst", "Dashboard starten",
        "node " + services.join(" ") + " [--port <n>] [" + voice.join("|") + "]", "lokal auf 127.0.0.1", { inCompact: false,
          probes: services.map((item) => "node " + item + " --port 4190") }),
    ]),
    section("Git", [
      ...intents.map((intent) => entry(intent.name, intent.purpose || "(ohne Beschreibung)",
        intentCommand + intent.syntax,
        intent.mutates ? "schreibt Git; --session <id> eines gebundenen Leaf oder --root <repo> --package <id>" : "liest nur",
        { short: intentCommand + withoutOptional(intent.syntax), shortPlace: "", undescribed: !intent.purpose,
          inCompact: COMPACT_INTENTS.includes(intent.name), probes: [intentCommand + intent.name] })),
      // Karte Arbeitsweise 07.10.2026: Git maintenance changes no product file; raw Git, but only these forms.
      entry("Git-Pflege", "holen, Branch wechseln, zwischenlagern",
        "git fetch | git pull --ff-only | git switch <branch> | git switch -c <neu> | git checkout <branch> | git checkout -b <neu> | " +
        "git stash [push|list|show|apply|pop]; direkt, git -C <repo> statt cd",
        "Sitzung ohne Bindung an einen Arbeitsschritt; pull, switch, checkout und stash push/apply/pop nicht bei offener Dispatch-Welle",
        { short: "git fetch | pull --ff-only | switch [-c] | checkout [-b] <branch> | stash push/list/show/apply/pop",
          shortPlace: "ungebundene Sitzung, nicht bei offener Welle", probes: ["git fetch", "git stash list"] }),
    ]),
    section("Paket und Executor", [
      entry("Executor", "Paket ausfuehren",
        "node " + executorTool + " <Befehl> --root DIR --harness-root DIR --package ID --scope ID; Befehle: " +
        executorLines.map((line) => line.full).join("; "),
        ".unlazy/<scope>/ (nur der Executor schreibt dort); Auftraege in .unlazy/<scope>/executor/briefs/",
        { short: "node " + executorTool + " <Befehl> --root DIR --harness-root DIR --package ID --scope ID; " +
          [...new Set(coreExecutor.map((line) => line.required))].join("; ") + "; weitere: " + otherExecutor.join(" "),
        shortPlace: ".unlazy/<scope>/ (nur der Executor schreibt dort)", probes: ["node " + executorTool + " --help"] }),
      entry("Bindung", "Leaf oder Sitzung binden",
        "node " + executorTool + " next|start --session <id>, dann dispatch --wave <id>", "gebundene Sitzungen: .unlazy/<scope>/",
        { inCompact: false }),
      entry("Paket-Werkzeuge", "Paket aendern, zusammenfuehren, stilllegen",
        "node " + mutationTools.join(" | node ") + " (Aufruf mit --help)", "Lesen immer, Schreiben nur im gebundenen Buendel",
        { short: "node harness-core/execution/package-{amend,bootstrap,resolve}.mjs --help", shortPlace: "Schreiben nur im gebundenen Buendel",
          probes: mutationTools.map((item) => "node " + item + " --help") }),
      entry("package-cli lesen", "Paketstand lesen", readToolText, "vendor/unlazy/scripts/",
        { inCompact: false, probes: readTools.map((item) => "node " + item.tool + " " + item.name) }),
      entry("Installer", "Installation pruefen",
        "node <Setup-Repo>/install.mjs install|status|doctor --target <Wurzel>", "Setup-Repo", { inCompact: false }),
    ]),
    section("Veroeffentlichen", [
      entry("Projekt aus publishProjects", "Projekt-Repo veroeffentlichen",
        intentCommand + "plan-publish --root <Repo>, dann " + intentCommand + "publish --root <Repo> --receipt <Plan-Beleg>",
        projects.length ? "Projekte des Owners: " + capped(projects, LIST_CAP) + "; nur aktueller Branch, nur Fast-Forward"
          : "kein Projekt eingetragen (nur der Owner traegt eins in publishProjects ein); nur aktueller Branch, nur Fast-Forward",
        { short: intentCommand + "plan-publish --root <Repo>; dann publish --root <Repo> --receipt <Plan-Beleg>",
          shortPlace: projects.length ? "Projekte: " + capped(projects, LIST_CAP) + "; Fast-Forward" : "kein Projekt in publishProjects" }),
      entry("Anderes Repo", "anderes Repo veroeffentlichen",
        "Paket abschliessen, Owner sagt im Chat OK, dann node " + executorTool + " publish --closure-receipt <Beleg> --owner-ok \"<Wortlaut>\"",
        "nur nach Paketabschluss",
        { short: "nach Paketabschluss und Owner-OK im Chat: node " + executorTool + " publish --closure-receipt <Beleg> --owner-ok \"<Wortlaut>\"",
          shortPlace: "" }),
    ]),
    section("Messen", [
      entry("Arbeitsspeicher und Prozesse", "Speicher, Prozesse messen",
        "node harness-core/tools/measure.mjs " + MEASURE_USAGE, "ein JSON-Objekt auf stdout, schreibt nichts",
        { shortPlace: "JSON auf stdout",
          probes: ["node harness-core/tools/measure.mjs ram", "node harness-core/tools/measure.mjs procs --name node",
            "node harness-core/tools/measure.mjs watch --seconds 10 --every 5"] }),
      entry("Prozess beenden", "eigenen Prozess beenden",
        "Stop-Process -Id <pid> oder taskkill /PID <pid>", "nur Prozesse, die Dateien dieser Installation oder ihrer Produkt-Wurzeln ausfuehren",
        { inCompact: false }),
    ]),
    section("Temp-Ordner", [
      entry("Schreiben im Temp-Ordner", "Hilfsdatei, Messreihe schreiben",
        "Umleitung >, New-Item, Set-Content, Out-File, tee, Remove-Item, rm, mkdir, cp, mv mit woertlichem Ziel",
        sessionTempPattern(sessionId) + "; Programme daraus auszufuehren bleibt gesperrt",
        { short: "> , tee, Set-Content, Out-File, New-Item, rm, mkdir, cp, mv mit woertlichem Ziel", shortPlace: sessionTempPattern(sessionId),
          // Only a known session has a folder to try: the shell guard frees exactly <tmp>/claude/<folder>/<session>/.
          probes: sessionId ? ["echo ok > " + sessionTempFolder(sessionId) + "/probe.txt", "rm " + sessionTempFolder(sessionId) + "/probe.txt"] : [] }),
    ]),
    section("Owner", [
      ...OWNER_ACTIONS.map(([id, text]) => entry(id, text, "nur der Owner; der Agent legt ihm einen Satz und die Zeile der Sperrmeldung vor",
        "Owner", { inCompact: false })),
      entry("Offen melden", "was kein Agentenweg ist",
        "die Sperre im Bericht unter Offen: nennen, nie als Befehl an den Owner", "Bericht", { inCompact: false }),
    ]),
  ];

  const places = [
    { place: "docs/packages/<id>/", holds: "Paket: PACKAGE.md, OWNER.md, GATES.md, gates/leaf-*.md, evidence/, design/", short: "Pakete" },
    { place: ".unlazy/<scope>/", holds: "Laufzeit, Claims, Executor-Zustand, Auftraege; schreiben nur die Werkzeuge", short: "Laufzeit (nur Werkzeuge schreiben)" },
    { place: sessionTempPattern(sessionId), holds: "Temp-Ordner der Sitzung: hier darf die Shell schreiben" },
    { place: grants.file, holds: "Owner-Politik, nur der Owner aendert sie", short: "Owner-Politik" },
    { place: "docs/guard-scope.md", holds: "was jeder Waechter sperrt, mit Grund und Weg", short: "Sperrregeln" },
  ];

  const blocks = Object.entries(routes.ROUTES).flatMap(([guard, table]) => Object.entries(table)
    .map(([code, [sectionName, entryId, way]]) => ({ guard, code, section: sectionName, entry: entryId, way })));
  const known = new Map(sections.map((item) => [item.name, new Set(item.entries.map((one) => one.id))]));
  for (const block of blocks) {
    if (!known.has(block.section) || !known.get(block.section).has(block.entry)) {
      throw new Error("guard-routes.cjs: " + block.guard + " " + block.code + " points at the entry \"" + block.section +
        " -> " + block.entry + "\", which the command index does not have");
    }
  }

  return {
    schema: INDEX_SCHEMA,
    root: dataRoot,
    session: sessionId || null,
    executorUsage: EXECUTOR_USAGE_HEAD,
    sections,
    places,
    blocks,
    grants,
    intents,
    compactOther: { git: gitOther, executor: otherExecutor, gitCore: gitCore.map((intent) => intent.name) },
  };
}

// --- text ------------------------------------------------------------------------------------------

const cell = (value) => String(value).replace(/\s*\|\s*/gu, " / ").replace(/\s+/gu, " ").trim();

// The text of a row. Not compact: the full command. Compact: the form of the shrink step, each falling back to the next
// longer one ("shortest" counts, "shorter" names the folders, the default is "short", "unbounded" is the brief's full form).
const COMPACT_FORMS = Object.freeze({
  short: ["short"],
  shorter: ["shorter", "short"],
  shortest: ["shortest", "shorter", "short"],
  unbounded: ["unbounded", "short"],
});

function rows(entries, { compact, form = "short" }) {
  const pick = (item) => {
    if (!compact) return item.command;
    for (const key of COMPACT_FORMS[form]) if (item[key] !== undefined) return item[key];
    return item.command;
  };
  return entries.filter((item) => !compact || item.inCompact !== false).map((item) =>
    "| " + cell(item.intent) + " | " + cell(pick(item)) + " | " +
    cell(compact && item.shortPlace !== undefined ? item.shortPlace : item.place) + " |");
}

const TABLE_HEAD = ["| Absicht | Erlaubter Befehl | Ort |", "|---|---|---|"];

// The Owner lists, as a few lines. The session start caps every list; the brief of a work agent does not.
export function renderGrants(grants, { cap = Infinity } = {}) {
  const lines = [];
  if (grants.error) {
    lines.push("ACHTUNG: " + grants.file + " ist ungueltig (" + grants.error + "): jede ausfuehrbare Klassifikation ist gesperrt, " +
      "bis der Owner sie repariert; keine Freigabe gilt.");
    return lines.join("\n");
  }
  const list = (name, items, note) => lines.push("- " + name + ": " + (items.length ? (cap === Infinity ? items.join(", ") : capped(items, cap)) : "keine") +
    (note ? " (" + note + ")" : ""));
  list("mcpWriteTools.allow", grants.mcpWriteTools, "schreibende MCP-Werkzeuge, die bei aktivem Paket laufen duerfen; lesende sind frei");
  list("productRoots", grants.productRoots, "Produkt-Quellbaeume: ihre Pruefer, Tests und Werkzeuge laufen ohne Rueckfrage");
  list("publishProjects", grants.publishProjects, "Projekte, die der Agent mit plan-publish und publish veroeffentlicht");
  for (const [name, items] of [["verifierPaths", grants.verifierPaths], ["testPaths", grants.testPaths],
    ["servicePaths", grants.servicePaths], ["mutationPaths", grants.mutationPaths]]) {
    if (items.length) list(name, items, "zusaetzlich deklariert");
  }
  lines.push("- ohne Eintrag frei: lesende MCP-Werkzeuge (Name beginnt mit " + grants.mcpReadVerbs.join(", ") +
    " und enthaelt kein Schreibwort) und die App-Werkzeuge " + grants.appTools.join(", ") +
    "; jedes andere MCP-Werkzeug ist bei aktivem Paket gesperrt");
  return lines.join("\n");
}

function grantsOneLine(grants, { counts = false } = {}) {
  if (grants.error) return renderGrants(grants);
  const part = (name, items) => name + ": " + (!items.length ? "keine" : counts ? items.length : capped(items, LIST_CAP));
  return "Freigaben des Owners (" + grants.file + "): " + [part("MCP-Schreibwerkzeuge", grants.mcpWriteTools),
    part("productRoots", grants.productRoots), part("publishProjects", grants.publishProjects)].join("; ") + ".";
}

function blockLines(index) {
  return index.blocks.map((block) => "- " + block.guard + " " + block.code + " -> " + block.section + " -> " + block.entry + ": " + block.way);
}

// The form every session gets at its start. It stays under COMPACT_LIMIT whatever the Owner lists hold: when the
// text is too long, the Owner lists shrink to counts (level 1), the verifier names to folders and counts (level 2), the
// verifiers to one count (level 3), and as the last step to a pointer at the full index (level 4, a real upper bound).
// `headings` is the Markdown prefix of the section titles ("##" at the session start, "###" inside a brief that has
// "##" sections of its own). `unbounded: true` is the form of a brief (P21, follow-up of P6, A18): no step of that
// shrinking, so no section of what the agent must know is cut by a length rule; the session start has the limit, the
// brief of an agent that works for hours does not.
export function renderCompact(index, { headings = "##", unbounded = false } = {}) {
  if (unbounded) return renderCompactLevel(index, 0, headings, "unbounded");
  let text = "";
  for (const level of [0, 1, 2, 3]) {
    text = renderCompactLevel(index, level, headings, level >= 3 ? "shortest" : level >= 2 ? "shorter" : "short");
    if (text.length < COMPACT_LIMIT) return text;
  }
  return renderMinimal(index, headings);
}

// The last step: what is needed to ask for the rest. Fixed in size apart from the root path.
function renderMinimal(index, headings) {
  return [
    "BEFEHLSINDEX (aus den Regeln der Waechter erzeugt): hier zu lang fuer den Sitzungsstart. Vor jedem Befehl nachsehen: " +
      LOOKUP + " --section \"<Abschnitt>\" | --full | --json",
    "Wurzel " + index.root + ", Pfade relativ dazu. Gesperrt sind rohes Git ausser Git-Pflege, Schreiben ueber die Shell, node -e, npm im gebundenen Schritt und >.",
    "",
    headings + " Abschnitte",
    index.sections.filter((item) => item.name !== "Owner").map((item) => item.name).join(", ") + ".",
    "Nur der Owner: " + OWNER_ACTIONS.map(([id, , label]) => id + " " + label).join("; ") + ". Der Agent meldet solche Sperren unter Offen:.",
    grantsOneLine(index.grants, { counts: true }),
  ].join("\n").trimEnd() + "\n";
}

function renderCompactLevel(index, level, headings, form = "short") {
  const lines = [
    "BEFEHLSINDEX (aus den Regeln der Waechter erzeugt): vor jedem Befehl nachsehen. Gesperrt sind rohes Git ausser Git-Pflege, Schreiben ueber die Shell, node -e, npm im gebundenen Schritt und >.",
    "Wurzel " + index.root + ", Pfade relativ dazu. Mehr, auch jeder Sperrcode: " + LOOKUP + " --section \"<Abschnitt>\" | --full | --json",
  ];
  let first = true;
  for (const item of index.sections) {
    if (item.name === "Owner") continue;
    lines.push("", headings + " " + item.name);
    if (first) { lines.push(...TABLE_HEAD); first = false; }
    const shown = rows(item.entries, { compact: true, form });
    lines.push(...shown);
    if (item.name === "Git" && index.compactOther.git.length) lines.push("weitere Absichten: " + index.compactOther.git.join(" ") + " (Syntax: --section Git)");
  }
  lines.push("", headings + " Owner und Orte",
    "Nur der Owner: " + OWNER_ACTIONS.map(([id, , label]) => id + " " + label).join("; ") + ". Der Agent meldet solche Sperren unter Offen:.",
    ...(level >= 1 ? [] : ["Orte: " + index.places.filter((place) => place.short).map((place) => place.place + " " + place.short).join("; ") + "."]),
    grantsOneLine(index.grants, { counts: level >= 1 }));
  return lines.join("\n").trimEnd() + "\n";
}

export function renderFull(index) {
  const lines = ["BEFEHLSINDEX, ausfuehrlich (aus den Regeln der Waechter erzeugt)", "Wurzel " + index.root + ", Pfade relativ dazu"];
  for (const item of index.sections) lines.push("", "## " + item.name, ...TABLE_HEAD, ...rows(item.entries, { compact: false }));
  lines.push("", "## Orte", ...index.places.map((item) => "- " + item.place + ": " + item.holds));
  lines.push("", "## Sperren (Waechter Code -> Abschnitt -> Eintrag: Weg)", ...blockLines(index));
  lines.push("", "## Freigaben des Owners dieser Installation", renderGrants(index.grants));
  return lines.join("\n").trimEnd() + "\n";
}

export function renderSection(index, name) {
  const wanted = String(name || "").trim().toLowerCase();
  const found = index.sections.find((item) => item.name.toLowerCase() === wanted);
  if (!found) throw new Error("unknown section \"" + name + "\"; sections: " + index.sections.map((item) => item.name).join(", "));
  const lines = ["## " + found.name, ...TABLE_HEAD, ...rows(found.entries, { compact: false })];
  const blocks = index.blocks.filter((block) => block.section === found.name);
  if (blocks.length) {
    lines.push("", "Sperren, die hierher fuehren (Waechter Code -> Eintrag: Weg):",
      ...blocks.map((block) => "- " + block.guard + " " + block.code + " -> " + block.entry + ": " + block.way));
  }
  return lines.join("\n").trimEnd() + "\n";
}

// --- command line ----------------------------------------------------------------------------------

function parseArguments(argv) {
  const options = { root: CODE_ROOT, session: "", mode: "compact", section: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = () => {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith("--")) throw new Error(arg + " needs a value");
      index += 1;
      return next;
    };
    if (arg === "--root") options.root = path.resolve(value());
    else if (arg === "--session") options.session = value();
    else if (arg === "--section") { options.mode = "section"; options.section = value(); }
    else if (["--compact", "--full", "--json"].includes(arg)) options.mode = arg.slice(2);
    else throw new Error("use: command-index.mjs [--root <dir>] [--session <id>] [--compact | --full | --json | --section <Abschnitt>]");
  }
  return options;
}

export function main(argv = process.argv.slice(2)) {
  let options;
  try { options = parseArguments(argv); }
  catch (error) { process.stderr.write("command-index: " + error.message + "\n"); return 2; }
  try {
    const index = buildIndex({ root: options.root, sessionId: options.session });
    const text = options.mode === "json" ? JSON.stringify(index, null, 2) + "\n"
      : options.mode === "full" ? renderFull(index)
        : options.mode === "section" ? renderSection(index, options.section) : renderCompact(index);
    process.stdout.write(text);
    return 0;
  } catch (error) {
    process.stderr.write("command-index: " + error.message + "\n");
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main();
