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
//
// Aufruf: node checks/fresh-clone.mjs [--voll]

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import process from "node:process";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const voll = process.argv.includes("--voll");

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
const fixture = join(tmpdir(), "keel-v2-setup-check-" + process.pid);
rmSync(fixture, { recursive: true, force: true });
mkdirSync(fixture, { recursive: true });
const init = spawnSync("git", ["init", "--quiet", fixture], { encoding: "utf8", windowsHide: true, timeout: 60_000 });
assert.equal(init.status, 0, "git init im Wegwerf-Ziel schlug fehl: " + (init.stderr || init.stdout));

const installer = join(repoRoot, "install.mjs");
const run = (...args) => spawnSync(process.execPath, [installer, ...args], {
  cwd: fixture, encoding: "utf8", windowsHide: true, timeout: 5 * 60_000,
});

try {
  const dry = run("--target", fixture, "--dry-run");
  assert.equal(dry.status, 0, "Trockenlauf endete nicht mit 0: " + (dry.stderr || dry.stdout));
  assert.ok(String(dry.stdout).includes("dry-run=true"), "Trockenlauf meldet kein dry-run=true: " + dry.stdout);
  const leftovers = readdirSync(fixture).filter((entry) => entry !== ".git");
  assert.deepEqual(leftovers, [], "Trockenlauf hat ins Ziel geschrieben: " + leftovers.join(", "));

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
} finally {
  rmSync(fixture, { recursive: true, force: true });
}

console.log("SETUP_REPO_OK payload=" + artifact.files.length
  + " version=" + artifact.manifest.product.version
  + " dry-run=ok" + (voll ? " install=ok status=ok" : ""));
