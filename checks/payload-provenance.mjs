#!/usr/bin/env node
// checks/payload-provenance.mjs -- haelt payload-provenance.json, manifest.json
// und den tatsaechlichen Payload-Bestand auf EINEM Stand.
//
// WARUM ES DAS GIBT
// payload/, lib/, install.mjs, manifest.json, DISTRIBUTION.md und UPDATE.md sind
// ERZEUGT (scripts/build-payload.mjs). payload-provenance.json ist die einzige
// Aussage darueber, WORAUS sie entstanden sind: Quell-Commit, Schmutzstand des
// Quell-Checkouts, ob die Standalone-Auslieferung fuer diesen Lauf frisch gebaut
// wurde. Eine Herkunftsangabe, die nicht mehr zum Bestand passt, ist schlechter
// als keine -- sie sieht aus wie eine Zusage.
//
// Das Vorbild (keel-harness-standalone-setup/checks/paket-manifest.mjs) leitet
// das Manifest aus dem Paket ab, weil es dort keinen Generator gibt. Hier gibt es
// einen; das Manifest kommt byteidentisch aus der Quelle. Geprueft wird deshalb
// die Stelle, die dort keine Entsprechung hat: passt die Herkunftsangabe noch zu
// dem, was wirklich im Repo liegt -- und ist der Stand ausliefer-reif?
//
// AUFRUF    node checks/payload-provenance.mjs [--release]
//           --release  macht die Ausliefer-Bedingungen (frisch gebaut, Quelle
//                      sauber, Commit bekannt) zu harten Fehlern statt Warnungen.
// RUECKGABE 0 = stimmig · 1 = Abweichung · 2 = nicht pruefbar

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import process from "node:process";
import { assertNodeVersion } from "./node-version.mjs";
import { spawnSync } from "node:child_process";

assertNodeVersion("checks/payload-provenance.mjs");

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const release = process.argv.includes("--release");

// Genau die Liste, die scripts/build-payload.mjs erzeugt. Steht sie hier anders,
// prueft dieser Pruefer einen anderen Bestand als der Generator schreibt.
const ERZEUGT = [
  "payload", "lib", "manifest.json", "install.mjs",
  "DISTRIBUTION.md", "UPDATE.md", "payload-provenance.json",
];

let gruen = 0;
const rot = [];
const warnungen = [];

function pruefe(name, bedingung, grund) {
  if (bedingung) {
    gruen += 1;
    process.stdout.write("GRUEN   " + name + "\n");
    return true;
  }
  rot.push(name + ": " + grund);
  process.stdout.write("ROT     " + name + ": " + grund + "\n");
  return false;
}

// Ausliefer-Bedingung: ohne --release eine Warnung, mit --release ein Fehler.
// So bleibt dieser Pruefer waehrend der Arbeit am Bausatz benutzbar und wird
// erst im Ausliefer-Lauf streng.
function ausliefern(name, bedingung, grund) {
  if (bedingung) {
    gruen += 1;
    process.stdout.write("GRUEN   " + name + "\n");
    return true;
  }
  if (release) {
    rot.push(name + ": " + grund);
    process.stdout.write("ROT     " + name + ": " + grund + "\n");
  } else {
    warnungen.push(name + ": " + grund);
    process.stdout.write("WARNUNG " + name + ": " + grund + " (mit --release ist das ein Fehler)\n");
  }
  return false;
}

for (const eintrag of ERZEUGT) {
  if (!existsSync(join(repoRoot, eintrag))) {
    process.stderr.write("payload-provenance: " + eintrag + " fehlt -- zuerst `node scripts/build-payload.mjs` ausfuehren.\n");
    process.exit(2);
  }
}

const manifestBytes = readFileSync(join(repoRoot, "manifest.json"));
const manifest = JSON.parse(manifestBytes.toString("utf8"));
const provenance = JSON.parse(readFileSync(join(repoRoot, "payload-provenance.json"), "utf8"));

// Versions-Schranke (Audit B9): eine geaenderte Auslieferung ohne Versionssprung ist kein
// Release (UPDATE.md verspricht monotonic-semver). Vergleich gegen den zuletzt versionierten
// Stand dieses Repos (HEAD:payload-provenance.json); ohne Historie entfaellt die Pruefung.
let vorherigeHerkunft = null;
try {
  const gezeigt = spawnSync("git", ["-C", repoRoot, "show", "HEAD:payload-provenance.json"], { encoding: "utf8", windowsHide: true });
  if (gezeigt.status === 0 && String(gezeigt.stdout).trim()) vorherigeHerkunft = JSON.parse(gezeigt.stdout);
} catch { vorherigeHerkunft = null; }
if (vorherigeHerkunft && vorherigeHerkunft.payload && vorherigeHerkunft.product) {
  const baumGeaendert = vorherigeHerkunft.payload.treeSha256 !== provenance.payload.treeSha256;
  const versionGleich = vorherigeHerkunft.product.version === provenance.product.version;
  ausliefern("versions-sprung", !(baumGeaendert && versionGleich),
    "Payload-Baum geaendert (" + String(vorherigeHerkunft.payload.treeSha256).slice(0, 12) + " -> " +
    String(provenance.payload.treeSha256).slice(0, 12) + "), Version " + provenance.product.version +
    " aber unveraendert -- PRODUCT.version im Quell-Generator anheben");
}
const manifestSha256 = createHash("sha256").update(manifestBytes).digest("hex");

// Der Payload-Bestand wird mit der MITGELIEFERTEN Bibliothek gelesen, nicht mit
// einem zweiten Leser: Hashes, Baum-Fingerabdruck und Identitaets-Filter sind
// derselbe Code, den der Installer beim Empfaenger ausfuehrt.
const { loadVerifiedArtifact } = await import(pathToFileURL(join(repoRoot, "lib", "distribution-lifecycle.mjs")).href);
let artifact;
try {
  artifact = loadVerifiedArtifact(repoRoot);
} catch (error) {
  process.stderr.write("payload-provenance: Payload laesst sich nicht verifizieren -- " + error.message + "\n");
  process.exit(1);
}

function dateienZaehlen(ordner) {
  let summe = 0;
  for (const eintrag of readdirSync(ordner, { withFileTypes: true })) {
    const voll = join(ordner, eintrag.name);
    if (eintrag.isDirectory()) summe += dateienZaehlen(voll);
    else if (statSync(voll).isFile()) summe += 1;
  }
  return summe;
}
const aufPlatte = dateienZaehlen(join(repoRoot, "payload"));

pruefe("schema", provenance.schema === "keel-harness-setup-provenance.v1",
  "unerwartetes Schema " + provenance.schema);
pruefe("produkt-identisch",
  JSON.stringify(provenance.product) === JSON.stringify(manifest.product),
  "payload-provenance.json nennt " + JSON.stringify(provenance.product) + ", manifest.json " + JSON.stringify(manifest.product));
pruefe("manifest-fingerabdruck", provenance.manifestSha256 === manifestSha256,
  "payload-provenance.json nennt " + provenance.manifestSha256 + ", gemessen " + manifestSha256);
pruefe("manifest-fingerabdruck-bibliothek", artifact.manifestDigest === manifestSha256,
  "loadVerifiedArtifact misst " + artifact.manifestDigest + ", dieser Pruefer " + manifestSha256);
pruefe("baum-fingerabdruck", provenance.payload?.treeSha256 === manifest.payload?.treeSha256,
  "payload-provenance.json nennt " + provenance.payload?.treeSha256 + ", manifest.json " + manifest.payload?.treeSha256);
pruefe("posten-manifest", manifest.fileCount === manifest.files?.length,
  "manifest.fileCount=" + manifest.fileCount + ", aber " + manifest.files?.length + " Eintraege in files");
pruefe("posten-herkunft", provenance.payload?.fileCount === manifest.fileCount,
  "payload-provenance.json nennt " + provenance.payload?.fileCount + ", manifest.json " + manifest.fileCount);
pruefe("posten-verifiziert", artifact.files.length === manifest.fileCount,
  "verifizierte Lesung liefert " + artifact.files.length + ", manifest.json nennt " + manifest.fileCount);
pruefe("posten-auf-platte", aufPlatte === manifest.fileCount,
  "unter payload/ liegen " + aufPlatte + " Dateien, manifest.json nennt " + manifest.fileCount);
pruefe("gebaut-am", Number.isFinite(Date.parse(provenance.builtAt || "")),
  "builtAt ist kein Zeitstempel: " + provenance.builtAt);

// Die Ausschluss-Liste traegt die Anleitung (Abschnitt "Was bewusst fehlt").
// Ohne sauberen Aufbau kann checks/anleitung-sync.mjs sie nicht erzeugen.
const excluded = Array.isArray(manifest.excluded) ? manifest.excluded : [];
pruefe("ausschluss-liste", excluded.length > 0 && excluded.every((e) => e?.source && e?.reason),
  "manifest.excluded ist leer oder ein Eintrag hat kein source/reason");

const commit = String(provenance.source?.commit ?? "");
ausliefern("quell-commit", /^[0-9a-f]{40}$/u.test(commit),
  "Quell-Commit ist kein voller Git-Hash: " + commit);
ausliefern("frisch-gebaut", provenance.source?.freshStandaloneBuild === true,
  "freshStandaloneBuild=" + provenance.source?.freshStandaloneBuild + " -- die Payload stammt aus dem eingecheckten Stand, nicht aus einem frischen Bau (`--build`)");
ausliefern("quelle-sauber-standalone", provenance.source?.standaloneSubtreeDirtyFiles === 0,
  "test-harness/standalone hatte beim Bau " + provenance.source?.standaloneSubtreeDirtyFiles + " ungesicherte Datei(en)");
ausliefern("quelle-sauber-arbeitsbaum", provenance.source?.workingTreeDirtyFiles === 0,
  "der Quell-Arbeitsbaum hatte beim Bau " + provenance.source?.workingTreeDirtyFiles + " ungesicherte Datei(en)");

process.stdout.write(
  "\n" + gruen + " gruen, " + rot.length + " rot, " + warnungen.length + " Warnung(en).\n"
);
if (rot.length) {
  process.stdout.write(
    "\nHerkunftsangabe und Bestand muessen EIN Stand sein. Angleichen mit:\n" +
    "  node scripts/build-payload.mjs [--source <harness-lab-checkout>] [--build]\n"
  );
  process.exit(1);
}
process.stdout.write(
  "PAYLOAD_PROVENANCE_OK payload=" + manifest.fileCount +
  " version=" + manifest.product.version +
  " fresh=" + (provenance.source?.freshStandaloneBuild === true ? "ja" : "nein") +
  " dirty=" + provenance.source?.workingTreeDirtyFiles + "/" + provenance.source?.standaloneSubtreeDirtyFiles + "\n"
);
process.exit(0);
