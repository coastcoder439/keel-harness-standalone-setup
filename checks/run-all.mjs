#!/usr/bin/env node
// checks/run-all.mjs -- ein Einstieg fuer alle Pruefer dieses Setup-Repos.
//
// WARUM ES DAS GIBT
// Vier Pruefer, die einzeln aufgerufen werden muessen, sind vier Pruefer, von
// denen regelmaessig drei vergessen werden. Dieser Einstieg fuehrt sie in fester
// Reihenfolge aus (billig vor teuer, damit ein banaler Fehler nicht erst nach
// Minuten auffaellt) und bricht beim ersten roten ab.
//
// AUFRUF
//   node checks/run-all.mjs                     Alltagslauf (Trockenlauf des Installers)
//   node checks/run-all.mjs --voll              zusaetzlich echte Probe-Installation
//   node checks/run-all.mjs --release --installed-checks
//                                               Ausliefer-Lauf: Herkunft muss ausliefer-rein
//                                               sein, und die INSTALLIERTE Auslieferung muss
//                                               im Wegwerf-Ziel KEEL_HARNESS_OK melden
//   --target <dir>  Wegwerf-Ziel selbst bestimmen (impliziert --voll, bleibt stehen)
//   --keep          Wegwerf-Ziel nach dem Lauf nicht loeschen
//
// RUECKGABE 0 = alles gruen · sonst der Rueckgabewert des ersten roten Pruefers

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { assertNodeVersion } from "./node-version.mjs";

const gemessen = assertNodeVersion("checks/run-all.mjs");
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const argv = process.argv.slice(2);
const hat = (name) => argv.includes(name);
const wert = (name) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : null;
};
const ziel = wert("--target");
const installiertePruefungen = hat("--installed-checks");
const voll = hat("--voll") || installiertePruefungen || Boolean(ziel);

const freshCloneArgs = [];
if (voll) freshCloneArgs.push("--voll");
if (installiertePruefungen) freshCloneArgs.push("--installed-checks");
if (hat("--keep")) freshCloneArgs.push("--keep");
if (ziel) freshCloneArgs.push("--target", ziel);

const phasen = [
  { name: "Node-Untergrenze", datei: "checks/node-version.mjs", args: [], timeoutMs: 60_000 },
  { name: "Herkunft der Payload", datei: "checks/payload-provenance.mjs",
    args: hat("--release") ? ["--release"] : [], timeoutMs: 5 * 60_000 },
  { name: "Anleitung gegen Bestand", datei: "checks/anleitung-sync.mjs", args: [], timeoutMs: 5 * 60_000 },
  { name: "Frisch geklonter Bausatz", datei: "checks/fresh-clone.mjs", args: freshCloneArgs,
    // Die installierten Pruefungen enthalten die volle Unlazy-Suite; 15 Minuten
    // sind dort der Regelfall, nicht die Ausnahme.
    timeoutMs: installiertePruefungen ? 45 * 60_000 : 15 * 60_000 },
];

process.stdout.write("Setup-Repo-Pruefer -- Node " + gemessen.running + ", " + phasen.length + " Phasen\n\n");

for (const [index, phase] of phasen.entries()) {
  process.stdout.write("[" + (index + 1) + "/" + phasen.length + "] " + phase.name +
    " (" + phase.datei + (phase.args.length ? " " + phase.args.join(" ") : "") + ")\n");
  const lauf = spawnSync(process.execPath, [join(repoRoot, ...phase.datei.split("/")), ...phase.args], {
    cwd: repoRoot, stdio: "inherit", windowsHide: true, timeout: phase.timeoutMs,
  });
  if (lauf.error && lauf.error.code === "ETIMEDOUT") {
    process.stderr.write("\nSETUP_REPO_SUITE_FAILED " + phase.datei + " -- Zeitgrenze " +
      Math.round(phase.timeoutMs / 60_000) + " min ueberschritten\n");
    process.exit(1);
  }
  if (lauf.status !== 0) {
    process.stderr.write("\nSETUP_REPO_SUITE_FAILED " + phase.datei + " exit=" + lauf.status + "\n");
    process.exit(lauf.status === null ? 1 : lauf.status);
  }
  process.stdout.write("\n");
}

const manifest = JSON.parse(readFileSync(join(repoRoot, "manifest.json"), "utf8"));
process.stdout.write("SETUP_REPO_SUITE_OK payload=" + manifest.fileCount +
  " version=" + manifest.product.version + "\n");
