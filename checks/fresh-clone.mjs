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
// RUECKGABE 0 = gruen · 1 = ein Pruefpunkt ist rot · 2 = Vorbedingung fehlt

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import process from "node:process";
import { assertNodeVersion } from "./node-version.mjs";

// EIGENE FEHLERBEHANDLUNG -- WARUM SIE HIER STEHT
// Bis 15.09.2026 hatte dieser Pruefer keine: jede fehlgeschlagene Assertion
// fiel als UNBEHANDELTE Ausnahme aus dem Modulrumpf, und Node beendete den
// Prozess ueber seinen Fatal-Pfad. Genau dieser Pfad blockiert hier (Windows 11,
// Node v24.16.0) nach einem fehlgeschlagenen `assert.deepStrictEqual`: das
// `exit`-Ereignis feuert noch mit Code 1, danach stirbt der Prozess nicht mehr.
// Gemessen am 15.09.2026 im hier reproduzierten Fall (falsche `managed=`-Zahl):
// 0 aktive Handles, 0 aktive Requests, 0 % CPU ueber 5 s, alle 9 Threads im
// Wartezustand, `process.reallyExit` wird nie erreicht -- ein Deadlock im
// nativen Teardown, nicht in den Betriebsmitteln dieses Pruefers (auch das
// Loeschen des Wegwerf-Ziels und das Schliessen von Kindprozessen war da
// laengst erledigt). Nur `assert.deepStrictEqual` loeste ihn aus; `assert.ok`,
// `assert.equal`, ein einfacher `throw` und eine 20-kB-Fehlermeldung beendeten
// sich alle in ~1,3 s. Ohne diesen Block wartete `checks/run-all.mjs` deshalb
// die volle 45-Minuten-Grenze auf einen Pruefer, der laengst rot war.
//
// Die Behebung an der Ursache: dieser Pruefer beendet sich SELBST. Der Fehler
// wird hier gefangen und gemeldet, das Aufraeumen laeuft vorher im `finally`,
// und der Ausstieg geht ueber `process.exit(1)` -- der Weg, der im selben Fall
// 3/3 nach ~1,3 s terminierte. Node kommt nie in seinen Fatal-Pfad.
function abbrechen(fehler) {
  const text = fehler instanceof Error ? (fehler.stack || fehler.message) : String(fehler);
  process.stderr.write("fresh-clone: Pruefung fehlgeschlagen\n" + text + "\n");
  process.exitCode = 1;
  process.exit(1);
  // Sicherheitsnetz: Sollte `process.exit` wider Erwarten zurueckkehren oder
  // im Teardown haengen bleiben, beendet der harte Weg den Prozess. Er steht
  // NACH der Fehlerausgabe, damit nie ein stummer Abbruch entsteht.
  process.kill(process.pid, "SIGKILL");
}
process.on("uncaughtException", abbrechen);
process.on("unhandledRejection", abbrechen);

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

/**
 * Test-Einspeisung fuer test/fresh-clone-failure.test.mjs: faelscht GENAU EINEN
 * gemessenen Wert, damit der Fehlschlag-Pfad ohne Handaenderung an Payload oder
 * Anleitung ausloest. Wie die Einspeisung der Lifecycle-Bibliothek
 * (KEEL_HARNESS_TEST_FAILURE) verlangt sie zusaetzlich KEEL_HARNESS_TESTING=1 --
 * ohne beide Umgebungsvariablen ist sie wirkungslos.
 */
function testEinspeisung(stelle, wert) {
  if (process.env.KEEL_HARNESS_TESTING !== "1") return wert;
  return process.env.KEEL_SETUP_TEST_FAILURE === stelle ? "999999" : wert;
}

async function main() {
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
    cwd: fixture, encoding: "utf8", windowsHide: true, timeout: 5 * 60_000, killSignal: "SIGKILL",
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
    const gemessenManaged = testEinspeisung("managed-binding", /managed=(\d+)/u.exec(String(dry.stdout))?.[1]);
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
        cwd: fixture, encoding: "utf8", windowsHide: true, timeout: 40 * 60_000, killSignal: "SIGKILL",
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
}

try {
  await main();
} catch (fehler) {
  abbrechen(fehler);
}
