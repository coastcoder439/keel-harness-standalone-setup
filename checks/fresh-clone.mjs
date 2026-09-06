#!/usr/bin/env node
// checks/fresh-clone.mjs -- Abnahmetest des frisch geklonten Setup-Repos.
// Selbsttragend: braucht NUR dieses Repo, Node und Git -- keinen harness-lab-Checkout.
//
// Prueft:
//   1. Artefakt-Integritaet: loadVerifiedArtifact() der mitgelieferten Bibliothek
//      verifiziert manifest.json gegen payload/ (Hashes, Baum-Fingerabdruck,
//      Identitaets-Filter der Distribution).
//   2. Onboarding-Verdrahtung: die Dateien, die das selbststartende Onboarding
//      tragen, sind in der Payload und zeigen aufeinander.
//   3. Trockenlauf: `node install.mjs --target <frisches Git-Repo> --dry-run`
//      endet mit Rueckgabewert 0 und schreibt nichts ins Ziel.
//   4. Nur mit --voll: echte Installation in ein Wegwerf-Git-Repo plus
//      `status`-Abfrage (Windows-Frischinstallations-Beleg, Paket-Planpunkt 3).
//   5. Nur mit --installed-checks: im frisch installierten Ziel die INSTALLIERTEN
//      Pruefungen der Auslieferung (`node checks/run-all.mjs`, Erfolgszeile
//      `KEEL_HARNESS_OK`). Das ist der Ausliefer-Beweis, nicht der Alltagslauf --
//      die volle Unlazy-Suite darin dauert Minuten.
//   6. Die Zahl `managed=` der Menschen-Anleitung wird an den gemessenen
//      Trockenlauf gebunden: eine Zahl in der Anleitung, die niemand misst,
//      ist eine Behauptung.
//
// Aufruf: node checks/fresh-clone.mjs [--voll] [--installed-checks]
//                                     [--target <wegwerf-verzeichnis>] [--keep]

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import process from "node:process";
import { assertNodeVersion } from "./node-version.mjs";

assertNodeVersion("checks/fresh-clone.mjs");

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const hatSchalter = (name) => argv.includes(name);
const schalterWert = (name) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : null;
};
const installiertePruefungen = hatSchalter("--installed-checks");
const zielOption = schalterWert("--target");
// --installed-checks und --target brauchen eine echte Installation; ohne sie
// waere der Schalter eine stille Falschzusage.
const voll = hatSchalter("--voll") || installiertePruefungen || Boolean(zielOption);
const behalten = hatSchalter("--keep") || Boolean(zielOption);

if (!existsSync(join(repoRoot, "lib", "distribution-lifecycle.mjs")) ||
    !existsSync(join(repoRoot, "manifest.json")) || !existsSync(join(repoRoot, "payload"))) {
  console.error("fresh-clone: Payload fehlt -- zuerst `node scripts/build-payload.mjs` ausfuehren.");
  process.exit(2);
}

// 1. Artefakt-Integritaet ueber die mitgelieferte Original-Bibliothek.
const { loadVerifiedArtifact } = await import(pathToFileURL(join(repoRoot, "lib", "distribution-lifecycle.mjs")).href);
const artifact = loadVerifiedArtifact(repoRoot);
const byTarget = new Map(artifact.files.map((file) => [file.target, file]));

// 2. Onboarding-Verdrahtung -- der Kern des Bedienmusters "Link + ein Satz,
//    danach startet das Onboarding von selbst".
for (const required of [
  ".claude/onboarding-start.js", ".claude/commands/onboarding.md", ".claude/settings.json",
  "checks/onboarding-ready.mjs", "docs/harness-instance.md",
  "CLAUDE.md", "AGENTS.md", "dashboard/serve.mjs", "dashboard/runtime.keel.gz",
]) assert.ok(byTarget.has(required), "Pflichtdatei fehlt in der Payload: " + required);

const instance = byTarget.get("docs/harness-instance.md").content.toString("utf8");
assert.ok(instance.includes("[AUSFUELLEN]"), "docs/harness-instance.md traegt keine [AUSFUELLEN]-Marke -- Onboarding wuerde nie starten");
const starter = byTarget.get(".claude/onboarding-start.js").content.toString("utf8");
assert.ok(starter.includes("harness-instance.md") && starter.includes("/onboarding"),
  ".claude/onboarding-start.js liest nicht die [AUSFUELLEN]-Marke bzw. setzt /onboarding nicht ab");
const settings = byTarget.get(".claude/settings.json").content.toString("utf8");
assert.ok(settings.includes("onboarding-start.js"), ".claude/settings.json verdrahtet onboarding-start.js nicht als Hook");

// 3./4. Installer gegen ein Wegwerf-Git-Repo.
const fixture = zielOption ? resolve(zielOption) : join(tmpdir(), "keel-v2-setup-check-" + process.pid);
if (zielOption) {
  // Ein selbst benanntes Ziel wird NICHT geleert: Wer versehentlich einen echten
  // Ordner nennt, soll eine Meldung bekommen und keinen geloeschten Bestand.
  const vorhanden = existsSync(fixture) ? readdirSync(fixture).filter((entry) => entry !== ".git") : [];
  assert.deepEqual(vorhanden, [],
    "--target " + fixture + " ist nicht leer (" + vorhanden.join(", ") + ") -- die Frischinstallation braucht ein Wegwerf-Verzeichnis");
} else {
  rmSync(fixture, { recursive: true, force: true });
}
mkdirSync(fixture, { recursive: true });
const init = spawnSync("git", ["init", "--quiet", fixture], { encoding: "utf8", windowsHide: true, timeout: 60_000 });
assert.equal(init.status, 0, "git init im Wegwerf-Ziel schlug fehl: " + (init.stderr || init.stdout));

const installer = join(repoRoot, "install.mjs");
const run = (...args) => spawnSync(process.execPath, [installer, ...args], {
  cwd: fixture, encoding: "utf8", windowsHide: true, timeout: 5 * 60_000,
});

let installedChecks = null;

try {
  const dry = run("--target", fixture, "--dry-run");
  assert.equal(dry.status, 0, "Trockenlauf endete nicht mit 0: " + (dry.stderr || dry.stdout));
  assert.ok(String(dry.stdout).includes("dry-run=true"), "Trockenlauf meldet kein dry-run=true: " + dry.stdout);
  const leftovers = readdirSync(fixture).filter((entry) => entry !== ".git");
  assert.deepEqual(leftovers, [], "Trockenlauf hat ins Ziel geschrieben: " + leftovers.join(", "));

  // Die Anleitung nennt `managed=<n>`. Diese Zahl entsteht erst hier, im
  // Trockenlauf -- checks/anleitung-sync.mjs kann sie nicht aus einer Datei
  // ableiten. Also wird sie an dieser Stelle gebunden, wo sie gemessen wird.
  const gemessenManaged = /managed=(\d+)/u.exec(String(dry.stdout))?.[1];
  assert.ok(gemessenManaged, "Trockenlauf meldet kein managed=<n>: " + dry.stdout);
  const anleitung = readFileSync(join(repoRoot, "PAKET-ANLEITUNG.md"), "utf8");
  const genannt = [...new Set([...anleitung.matchAll(/managed=(\d+)/gu)].map((treffer) => treffer[1]))];
  assert.deepEqual(genannt, [gemessenManaged],
    "PAKET-ANLEITUNG.md nennt managed=" + genannt.join("/") + ", gemessen wurde managed=" + gemessenManaged);

  if (voll) {
    const installed = run("--target", fixture);
    assert.equal(installed.status, 0, "Installation endete nicht mit 0: " + (installed.stderr || installed.stdout));
    assert.ok(String(installed.stdout).includes("state=installed"), "Installation meldet kein state=installed: " + installed.stdout);
    for (const expected of [
      join(fixture, ".claude", "onboarding-start.js"),
      join(fixture, "docs", "harness-instance.md"),
      join(fixture, "dashboard", "serve.mjs"),
    ]) assert.ok(existsSync(expected), "installierte Datei fehlt: " + expected);
    assert.ok(readFileSync(join(fixture, "docs", "harness-instance.md"), "utf8").includes("[AUSFUELLEN]"),
      "installierte harness-instance.md traegt keine [AUSFUELLEN]-Marke");
    const status = run("status", "--target", fixture);
    assert.equal(status.status, 0, "status endete nicht mit 0: " + (status.stderr || status.stdout));
  }

  if (installiertePruefungen) {
    // Der Ausliefer-Beweis: nicht die Pruefer DIESES Repos, sondern die
    // Pruefungen, die beim Empfaenger liegen. Ihre Erfolgszeile ist
    // KEEL_HARNESS_OK (siehe payload/checks/run-all.mjs) -- nicht die
    // Erfolgszeile des Quellbaums.
    console.log("fresh-clone: installierte Pruefungen laufen (volle Unlazy-Suite, mehrere Minuten) ...");
    const lauf = spawnSync(process.execPath, [join(fixture, "checks", "run-all.mjs")], {
      cwd: fixture, encoding: "utf8", windowsHide: true, timeout: 40 * 60_000,
    });
    const ausgabe = String(lauf.stdout || "") + String(lauf.stderr || "");
    process.stdout.write(ausgabe.split("\n").slice(-40).join("\n") + "\n");
    assert.equal(lauf.status, 0, "installierte Pruefungen endeten nicht mit 0 (exit " + lauf.status + ")");
    assert.ok(ausgabe.includes("KEEL_HARNESS_OK"),
      "installierte Pruefungen melden kein KEEL_HARNESS_OK");
    installedChecks = "ok";
  }
} finally {
  if (!behalten) rmSync(fixture, { recursive: true, force: true });
  else console.log("fresh-clone: Wegwerf-Ziel bleibt stehen: " + fixture);
}

console.log("SETUP_REPO_OK payload=" + artifact.files.length
  + " version=" + artifact.manifest.product.version
  + " dry-run=ok" + (voll ? " install=ok status=ok" : "")
  + (installedChecks ? " installed-checks=ok" : ""));
