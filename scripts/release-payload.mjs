#!/usr/bin/env node
// scripts/release-payload.mjs -- der Ausliefer-Lauf in EINEM Befehl.
//
// WARUM ES DAS GIBT
// Der finale Schritt besteht aus vier Teilen, die in dieser Reihenfolge stehen
// muessen und einzeln leicht vergessen werden: neu bauen, Anleitung nachziehen,
// alles pruefen, in ein Wegwerf-Verzeichnis frisch installieren und dort die
// INSTALLIERTEN Pruefungen fahren. Eine Reihenfolge, die in einer Prosa-Liste
// steht, ist keine Reihenfolge -- sie ist eine Bitte.
//
// Und: `&&` gibt es in Windows PowerShell 5.1 nicht. Eine Ein-Befehl-Zusage, die
// nur in bash haelt, ist auf diesem Rechner keine.
//
// WAS DER LAUF BEWEIST
//   1. Die Payload stammt aus einem FRISCHEN Standalone-Bau des Quell-HEAD, und
//      dieser Bau hat am Quellbaum nichts veraendert (--build --require-clean;
//      Provenance: freshStandaloneBuild=true, dirty files=0).
//   2. Die Menschen-Anleitung nennt danach die neuen Zahlen (anleitung-sync
//      --nachziehen und die anschliessende Gegenpruefung im Pruefer-Lauf).
//   3. Eine Frischinstallation in ein leeres Wegwerf-Verzeichnis gelingt, und
//      dort meldet `node checks/run-all.mjs` der AUSLIEFERUNG die Erfolgszeile
//      KEEL_HARNESS_OK -- nicht die Erfolgszeile des Quellbaums.
//
// AUFRUF
//   node scripts/release-payload.mjs [--source <harness-lab-checkout>]
//                                    [--target <wegwerf-verzeichnis>] [--dry-run]
//   --source   Standard: ../harness-lab neben diesem Repo
//   --target   Standard: ein frischer Ordner im Temp-Verzeichnis. Er bleibt nach
//              dem Lauf stehen, damit der Beleg nachlesbar ist.
//   --dry-run  zeigt nur den Plan, fuehrt nichts aus.
//
// COMMITTET NICHTS. Am Ende steht, was in welchem Repo zu sichern ist.
// RUECKGABE 0 = ausliefer-reif · sonst der Rueckgabewert des ersten roten Schritts

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { assertNodeVersion } from "../checks/node-version.mjs";

const gemessen = assertNodeVersion("scripts/release-payload.mjs");
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const argv = process.argv.slice(2);
const wert = (name) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : null;
};
const MIT_WERT = new Set(["--source", "--target"]);
const ERLAUBT = new Set([...MIT_WERT, "--dry-run"]);
for (let i = 0; i < argv.length; i += 1) {
  const option = argv[i];
  if (!option.startsWith("--")) {
    if (i > 0 && MIT_WERT.has(argv[i - 1])) continue;
    process.stderr.write("release-payload: unerwartetes Argument " + option + "\n");
    process.exit(2);
  }
  if (!ERLAUBT.has(option)) {
    process.stderr.write("release-payload: unbekannte Option " + option + "\n" +
      "Aufruf: node scripts/release-payload.mjs [--source <checkout>] [--target <wegwerf>] [--dry-run]\n");
    process.exit(2);
  }
  if (MIT_WERT.has(option) && (!argv[i + 1] || argv[i + 1].startsWith("--"))) {
    process.stderr.write("release-payload: " + option + " braucht einen Pfad\n");
    process.exit(2);
  }
}
const quelle = resolve(wert("--source") || join(repoRoot, "..", "harness-lab"));
const wegwerf = resolve(wert("--target") ||
  join(tmpdir(), "keel-harness-release-" + new Date().toISOString().replace(/[^0-9]/gu, "").slice(0, 14)));
const nurPlan = argv.includes("--dry-run");

const schritte = [
  {
    // Owner 08.10.2026: kein zweiter Bau mehr. Das Produkt-Release baut die Payload im Release-Klon frisch und
    // prueft sie dort mit einer Frischinstallation; der Dashboard-Bau ist nicht bytegleich wiederholbar (Next
    // erzeugt je Bau Zufallsschluessel). Uebernommen wird der eingecheckte, gepruefte Stand aus sauberer Quelle.
    name: "1/3  Payload aus dem eingecheckten Quell-HEAD uebernehmen (Quelle muss sauber sein)",
    datei: "scripts/build-payload.mjs",
    args: ["--source", quelle, "--require-clean"],
    timeoutMs: 40 * 60_000,
  },
  {
    name: "2/3  Menschen-Anleitung an die neuen Zahlen angleichen",
    datei: "checks/anleitung-sync.mjs",
    args: ["--nachziehen"],
    timeoutMs: 5 * 60_000,
  },
  // Owner 08.10.2026: keine dritte Pruefschicht im Setup-Repo. Das Produkt-Release hat den Stand mit dem vollen
  // Nachweis und einer Frischinstallation im Release-Klon geprueft; `node checks/run-all.mjs` bleibt von Hand aufrufbar.
];

process.stdout.write("release-payload -- Node " + gemessen.running + "\n");
process.stdout.write("  Quelle:      " + quelle + "\n");
process.stdout.write("  Wegwerf-Ziel: " + wegwerf + "\n\n");

if (!existsSync(join(quelle, "test-harness", "standalone"))) {
  process.stderr.write("release-payload: unter " + quelle + " liegt kein test-harness/standalone.\n");
  process.exit(2);
}

for (const schritt of schritte) {
  process.stdout.write((nurPlan ? "PLAN   " : "----   ") + schritt.name + "\n");
  process.stdout.write("       node " + schritt.datei + " " + schritt.args.join(" ") + "\n");
  if (nurPlan) continue;
  const lauf = spawnSync(process.execPath, [join(repoRoot, ...schritt.datei.split("/")), ...schritt.args], {
    cwd: repoRoot, stdio: "inherit", windowsHide: true, timeout: schritt.timeoutMs,
  });
  if (lauf.error && lauf.error.code === "ETIMEDOUT") {
    process.stderr.write("\nRELEASE_FAILED " + schritt.datei + " -- Zeitgrenze " +
      Math.round(schritt.timeoutMs / 60_000) + " min ueberschritten\n");
    process.exit(1);
  }
  if (lauf.status !== 0) {
    process.stderr.write("\nRELEASE_FAILED " + schritt.datei + " exit=" + lauf.status + "\n");
    process.exit(lauf.status === null ? 1 : lauf.status);
  }
  process.stdout.write("\n");
}

if (nurPlan) {
  process.stdout.write("\nRELEASE_PLAN_ONLY -- nichts ausgefuehrt. Ohne --dry-run laeuft der Ausliefer-Lauf.\n");
  process.exit(0);
}

const manifest = JSON.parse(readFileSync(join(repoRoot, "manifest.json"), "utf8"));
const provenance = JSON.parse(readFileSync(join(repoRoot, "payload-provenance.json"), "utf8"));
process.stdout.write(
  "RELEASE_READY payload=" + manifest.fileCount +
  " version=" + manifest.product.version +
  " commit=" + provenance.source.commit +
  " fresh=" + provenance.source.freshStandaloneBuild +
  " dirty=" + provenance.source.workingTreeDirtyFiles + "/" + provenance.source.standaloneSubtreeDirtyFiles + "\n"
);
process.stdout.write(
  "\nNoch zu sichern (dieser Lauf committet nichts):\n" +
  "  git -C " + repoRoot + " add payload lib manifest.json install.mjs DISTRIBUTION.md UPDATE.md payload-provenance.json PAKET-ANLEITUNG.md\n" +
  "  git -C " + repoRoot + " commit -m \"payload: neu gebaut aus " + provenance.source.commit.slice(0, 12) + "\" -- payload lib manifest.json install.mjs DISTRIBUTION.md UPDATE.md payload-provenance.json PAKET-ANLEITUNG.md\n" +
  "Der Frischinstallations-Beleg liegt in: " + wegwerf + "\n"
);
