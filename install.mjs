#!/usr/bin/env node
// install.mjs -- Platzhalter des duennen Einstiegs.
//
// EINE-LOESUNG: dieses Setup-Repo VERPACKT die bestehende Standalone-Distribution
// des neuen Keel Harness (harness-lab: test-harness/standalone/), es erfindet
// keinen zweiten Installer. `node scripts/build-payload.mjs` ersetzt genau diese
// Datei durch das UNVERAENDERTE Original test-harness/standalone/install.mjs
// (duenner CLI-Einstieg, importiert ./lib/distribution-lifecycle.mjs) und legt
// payload/, manifest.json und lib/ daneben.
//
// Solange das noch nicht geschehen ist, sagt dieser Platzhalter nur, was fehlt.

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const root = dirname(fileURLToPath(import.meta.url));
const missing = ["lib/distribution-lifecycle.mjs", "manifest.json", "payload"]
  .filter((entry) => !existsSync(join(root, ...entry.split("/"))));

if (missing.length) {
  console.error("keel-harness-v2-setup: Payload noch nicht erzeugt -- es fehlt: " + missing.join(", "));
} else {
  console.error("keel-harness-v2-setup: Payload vorhanden, aber install.mjs ist noch der Platzhalter.");
}
console.error("Erzeugen bzw. erneuern: node scripts/build-payload.mjs [--source <harness-lab-checkout>]");
console.error("Danach ist install.mjs der unveraenderte Standalone-Installer:");
console.error("  node install.mjs --target <repository> [--dry-run] | status | doctor | rollback | uninstall");
process.exit(2);
