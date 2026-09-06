#!/usr/bin/env node
// checks/node-version.mjs -- erzwingt die Node-Untergrenze dieses Bausatzes.
//
// WARUM ES DAS GIBT
// "Node >= 20" stand bis 02.09.2026 nur als Prosa in README und Anleitung. Prosa
// haelt niemanden auf: Wer den Bausatz unter Node 18 auspackt, bekommt keinen
// klaren Satz, sondern einen Syntaxfehler aus einer beliebigen Tiefe der
// Auslieferung -- und sucht dann am falschen Ort.
//
// Die Untergrenze hat GENAU EINEN Ort: package.json -> engines.node. Dieses
// Modul liest sie von dort und vergleicht sie mit der laufenden Fassung; jede
// andere Datei, die eine Zahl nennt, wird von checks/anleitung-sync.mjs an
// denselben Ort gebunden. Zwei Zahlen an zwei Orten waeren wieder Prosa.
//
// install.mjs bekommt KEINE Pruefung: die Datei ist erzeugt (siehe
// scripts/build-payload.mjs) und wuerde beim naechsten Lauf ueberschrieben.
// Die Grenze sitzt deshalb in den Pruefern und Skripten dieses Repos, die den
// Installer aufrufen -- checks/run-all.mjs, checks/fresh-clone.mjs,
// scripts/build-payload.mjs.
//
// AUFRUF    node checks/node-version.mjs
// RUECKGABE 0 = Node ist neu genug · 2 = zu alt oder engines.node fehlt

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Liest die Untergrenze aus package.json -> engines.node (Form ">=<major>"). */
export function requiredNode() {
  const packageFile = join(repoRoot, "package.json");
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(packageFile, "utf8"));
  } catch (error) {
    return { error: "package.json ist nicht lesbar (" + error.message + ")" };
  }
  const range = manifest?.engines?.node;
  const match = /^>=\s*(\d+)/u.exec(String(range ?? ""));
  if (!match) {
    return { error: 'package.json: engines.node fehlt oder hat nicht die Form ">=<major>" (gelesen: ' + String(range) + ")" };
  }
  return { range: String(range), major: Number(match[1]) };
}

/**
 * Bricht mit Rueckgabewert 2 und einer Meldung ab, wenn die laufende
 * Node-Fassung unter der Untergrenze liegt. Sonst gibt sie die Messwerte
 * zurueck. `context` benennt das aufrufende Skript in der Meldung.
 */
export function assertNodeVersion(context = "dieser Bausatz") {
  const required = requiredNode();
  if (required.error) {
    process.stderr.write("NODE_ENGINES_UNKLAR " + required.error + "\n");
    process.exit(2);
  }
  const running = Number(process.versions.node.split(".")[0]);
  if (running >= required.major) return { ...required, running: process.version, ok: true };

  const hilfe = process.platform === "win32"
    ? "Windows: `winget install OpenJS.NodeJS.LTS` oder das LTS-Installationsprogramm von nodejs.org."
    : "macOS/Linux: `nvm install --lts` oder das LTS-Paket von nodejs.org.";
  process.stderr.write(
    "NODE_TOO_OLD running=" + process.version + " required=" + required.range + "\n" +
    context + " verlangt Node " + required.range + "; hier laeuft " + process.version + ".\n" +
    "Es wurde NICHTS geschrieben. " + hilfe + "\n" +
    "Danach denselben Befehl erneut ausfuehren.\n"
  );
  process.exit(2);
}

const direkt = process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);
if (direkt) {
  const gemessen = assertNodeVersion("checks/node-version.mjs");
  process.stdout.write("NODE_OK running=" + gemessen.running + " required=" + gemessen.range + "\n");
}
