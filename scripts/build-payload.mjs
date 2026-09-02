#!/usr/bin/env node
// scripts/build-payload.mjs -- erzeugt die Auslieferung dieses Setup-Repos
// REPRODUZIERBAR aus einem harness-lab-Checkout. Keine Hand-Kopien: jede
// Payload-Datei kommt hash-verifiziert aus loadVerifiedArtifact() der
// Standalone-Distribution des Produkts (test-harness/standalone/).
//
// EINE-LOESUNG: hier entsteht kein zweiter Installer und keine zweite
// Payload-Wahrheit. Das Skript verifiziert die vorhandene Distribution mit
// IHRER EIGENEN Bibliothek und uebertraegt:
//   payload/**               Inhalt der verifizierten Lesung (artifact.files)
//   manifest.json            byteidentisch
//   lib/*.mjs                Installer-Bibliothek (distribution-lifecycle, generic-content)
//   install.mjs              das unveraenderte Original (ersetzt den Platzhalter)
//   DISTRIBUTION.md          technisches Original standalone/README.md
//   UPDATE.md                standalone/UPDATE.md
//   payload-provenance.json  Quell-Commit und Fingerabdruck dieses Laufs
//
// Aufruf:
//   node scripts/build-payload.mjs [--source <harness-lab-checkout>] [--build]
//                                  [--require-clean] [--dry-run]
//   --source        Standard: ../harness-lab neben diesem Repo
//   --build         fuehrt vorher `npm run standalone:build` im Checkout aus
//                   (braucht einen frischen Dashboard-Production-Build, dauert Minuten);
//                   ohne --build wird der eingecheckte Distribution-Stand verwendet.
//   --require-clean bricht ab, wenn die Quelle nicht ausliefer-rein ist: unbekannter
//                   Commit oder ungesicherte Dateien. ZUSAMMEN MIT --build heisst das:
//                   der frische Bau hat NICHTS veraendert -- der eingecheckte
//                   Standalone-Stand ist wirklich der gebaute. Genau das ist die
//                   Bedingung der Auslieferung (Provenance: freshStandaloneBuild=true,
//                   dirty files=0).
//   --dry-run       zeigt nur, was passieren wuerde, und schreibt nichts;
//                   --require-clean wird trotzdem geprueft.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import process from "node:process";
import { assertNodeVersion } from "../checks/node-version.mjs";

assertNodeVersion("scripts/build-payload.mjs");

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GENERATED = [
  "payload", "lib", "manifest.json", "install.mjs",
  "DISTRIBUTION.md", "UPDATE.md", "payload-provenance.json",
];
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function usage(message) {
  if (message) console.error("build-payload: " + message);
  console.error("Aufruf: node scripts/build-payload.mjs [--source <harness-lab-checkout>] [--build] [--require-clean] [--dry-run]");
  process.exit(2);
}

function parse(argv) {
  const options = { source: resolve(repoRoot, "..", "harness-lab"), build: false, dryRun: false, requireClean: false };
  const values = [...argv];
  while (values.length) {
    const option = values.shift();
    if (option === "--source") {
      const value = values.shift();
      if (!value || value.startsWith("--")) usage("--source braucht einen Pfad");
      options.source = resolve(value);
    } else if (option === "--build") options.build = true;
    else if (option === "--require-clean") options.requireClean = true;
    else if (option === "--dry-run") options.dryRun = true;
    else if (option === "--help" || option === "-h") usage();
    else usage("unbekannte Option " + option);
  }
  return options;
}

function git(source, args) {
  const result = spawnSync("git", ["-C", source, ...args], {
    encoding: "utf8", windowsHide: true, timeout: 60_000,
  });
  return result.status === 0 ? String(result.stdout).trim() : null;
}

const options = parse(process.argv.slice(2));
const harnessRoot = join(options.source, "test-harness");
const sourceStandalone = join(harnessRoot, "standalone");
for (const required of ["install.mjs", "manifest.json", join("lib", "distribution-lifecycle.mjs")]) {
  if (!existsSync(join(sourceStandalone, required))) {
    usage("kein Standalone-Bestand unter " + sourceStandalone + " (fehlt: " + required + ")");
  }
}

if (options.build) {
  // npm-CLI-Aufloesung: Muster aus test-harness/standalone/checks/run-all.mjs,
  // damit der Aufruf auf Windows ohne shell funktioniert.
  const npmCli = [
    process.env.npm_execpath,
    join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
  ].filter(Boolean).find((candidate) => existsSync(candidate));
  if (!npmCli) usage("npm-CLI nicht gefunden -- `npm run standalone:build` bitte selbst im Checkout ausfuehren");
  console.log("build-payload: fuehre `npm run standalone:build` aus in " + harnessRoot + " ...");
  const built = spawnSync(process.execPath, [npmCli, "run", "standalone:build"], {
    cwd: harnessRoot, stdio: "inherit", windowsHide: true, timeout: 20 * 60_000,
  });
  if (built.status !== 0) usage("standalone:build ist fehlgeschlagen (Rueckgabewert " + built.status + ")");
}

// 1. Quelle mit ihrer eigenen Bibliothek verifizieren -- Manifest gegen Payload,
//    Baum-Fingerabdruck, Identitaets-Filter. Nur Verifiziertes wird kopiert.
const sourceLifecycle = await import(pathToFileURL(join(sourceStandalone, "lib", "distribution-lifecycle.mjs")).href);
const artifact = sourceLifecycle.loadVerifiedArtifact(sourceStandalone);
const manifestRaw = readFileSync(join(sourceStandalone, "manifest.json"));
const libFiles = readdirSync(join(sourceStandalone, "lib"), { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".mjs"))
  .map((entry) => entry.name)
  .sort();

// 2. Herkunft messen (nicht erinnern): Commit und Schmutzstand des Checkouts.
const commit = git(options.source, ["rev-parse", "HEAD"]);
const porcelain = git(options.source, ["status", "--porcelain"]);
const porcelainStandalone = git(options.source, ["status", "--porcelain", "--", "test-harness/standalone"]);
const countLines = (value) => (value === null ? null : value.split("\n").filter(Boolean).length);

const summary = {
  files: artifact.files.length,
  version: artifact.manifest.product.version,
  treeSha256: artifact.manifest.payload.treeSha256,
  commit: commit || "unbekannt (Quelle ist kein Git-Checkout)",
};

// AUSLIEFER-BEDINGUNG. Bewusst NACH dem optionalen --build gemessen: erst wenn der
// frische Bau nichts veraendert hat, ist der eingecheckte Stand der gebaute. Ein
// spaeterer "das war schon sauber"-Satz waere Erinnerung, das hier ist eine Messung.
if (options.requireClean) {
  const gruende = [];
  if (!/^[0-9a-f]{40}$/u.test(String(commit ?? ""))) {
    gruende.push("die Quelle ist kein Git-Checkout mit lesbarem HEAD (" + summary.commit + ")");
  }
  const arbeitsbaum = countLines(porcelain);
  const unterbaum = countLines(porcelainStandalone);
  if (arbeitsbaum !== 0) gruende.push(arbeitsbaum + " ungesicherte Datei(en) im Arbeitsbaum " + options.source);
  if (unterbaum !== 0) gruende.push(unterbaum + " ungesicherte Datei(en) in test-harness/standalone");
  if (gruende.length) {
    console.error("build-payload: --require-clean nicht erfuellt --");
    for (const grund of gruende) console.error("  " + grund);
    console.error(options.build
      ? "  (mit --build heisst das: der frische Bau hat den eingecheckten Stand veraendert;"
      : "  (ohne --build ist der eingecheckte Stand ungeprueft;");
    console.error("   in der Quelle committen und den Lauf wiederholen.)");
    process.exit(1);
  }
  console.log("build-payload: Quelle ist ausliefer-rein (Commit " + commit + ", 0 ungesicherte Dateien)"
    + (options.build ? " -- und der frische Bau hat nichts veraendert." : "."));
}

if (options.dryRun) {
  console.log("build-payload (Trockenlauf) -- nichts wird geschrieben:");
  console.log("  wuerde ersetzen: payload/ (" + summary.files + " Dateien, treeSha256 " + summary.treeSha256.slice(0, 16) + "...)");
  console.log("  wuerde ersetzen: manifest.json (" + manifestRaw.length + " Bytes), lib/ (" + libFiles.join(", ") + ")");
  console.log("  wuerde ersetzen: install.mjs, DISTRIBUTION.md, UPDATE.md, payload-provenance.json");
  console.log("  Quelle: " + sourceStandalone + " @ " + summary.commit + (options.build ? " (frisch gebaut)" : " (eingecheckter Stand)"));
  process.exit(0);
}

// 3. Alte generierte Staende vollstaendig raeumen, dann verifiziert schreiben.
for (const target of GENERATED) rmSync(join(repoRoot, target), { recursive: true, force: true });
for (const file of artifact.files) {
  const target = join(repoRoot, "payload", ...file.target.split("/"));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, file.content);
}
writeFileSync(join(repoRoot, "manifest.json"), manifestRaw);
mkdirSync(join(repoRoot, "lib"), { recursive: true });
for (const name of libFiles) {
  writeFileSync(join(repoRoot, "lib", name), readFileSync(join(sourceStandalone, "lib", name)));
}
writeFileSync(join(repoRoot, "install.mjs"), readFileSync(join(sourceStandalone, "install.mjs")));
writeFileSync(join(repoRoot, "DISTRIBUTION.md"), readFileSync(join(sourceStandalone, "README.md")));
writeFileSync(join(repoRoot, "UPDATE.md"), readFileSync(join(sourceStandalone, "UPDATE.md")));

// 4. Gegenprobe mit der KOPIERTEN Bibliothek: das Setup-Repo muss sich selbst
//    verifizieren, ohne den Checkout zu brauchen.
const copiedLifecycle = await import(pathToFileURL(join(repoRoot, "lib", "distribution-lifecycle.mjs")).href);
const copied = copiedLifecycle.loadVerifiedArtifact(repoRoot);
if (copied.files.length !== artifact.files.length || copied.manifestDigest !== sha256(manifestRaw)) {
  console.error("build-payload: Gegenprobe fehlgeschlagen -- kopierter Bestand weicht von der Quelle ab.");
  process.exit(2);
}

// 5. Herkunft festschreiben.
const provenance = {
  schema: "keel-harness-v2-setup-provenance.v1",
  source: {
    repository: "harness-lab",
    standalonePath: "test-harness/standalone",
    commit: summary.commit,
    workingTreeDirtyFiles: countLines(porcelain),
    standaloneSubtreeDirtyFiles: countLines(porcelainStandalone),
    freshStandaloneBuild: options.build,
  },
  product: artifact.manifest.product,
  payload: { fileCount: copied.files.length, treeSha256: summary.treeSha256 },
  manifestSha256: copied.manifestDigest,
  builtAt: new Date().toISOString(),
};
writeFileSync(join(repoRoot, "payload-provenance.json"), JSON.stringify(provenance, null, 2) + "\n");

console.log("build-payload: " + copied.files.length + " Payload-Dateien, Version " + summary.version
  + ", treeSha256 " + summary.treeSha256.slice(0, 16) + "..., Quell-Commit " + summary.commit
  + (options.build ? " (frisch gebaut)" : " (eingecheckter Stand)"));
