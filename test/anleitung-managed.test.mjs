// test/anleitung-managed.test.mjs -- anleitung-sync bindet managed= an den Trockenlauf.
//
// WARUM ES DAS GIBT
// checks/fresh-clone.mjs vergleicht die Zahl `managed=` der Anleitung mit dem
// echten Installer-Trockenlauf. anleitung-sync zog sie bisher nicht nach: bei 1.3.16
// und bei 1.3.18 scheiterte die Repo-Suite daran, und die Zahl wurde von Hand
// korrigiert. Jetzt misst anleitung-sync sie selbst; dieser Test belegt beide
// Richtungen -- nachziehen schreibt die gemessene Zahl, ohne Schalter ist eine
// falsche Zahl Rueckgabewert 1. Gearbeitet wird auf einer Kopie in os.tmpdir();
// die echte Anleitung bleibt unberuehrt.
//
// AUFRUF    node --test test/anleitung-managed.test.mjs
// RUECKGABE 0 = beide Zusagen belegt

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sync = join(repoRoot, "checks", "anleitung-sync.mjs");
const FALSCH = "1";

function laufen(kommando, args, cwd) {
  return spawnSync(kommando, args, {
    cwd, encoding: "utf8", windowsHide: true, timeout: 5 * 60_000, killSignal: "SIGKILL",
  });
}

// Unabhaengige Messung wie in checks/fresh-clone.mjs: Trockenlauf gegen ein frisches Git-Ziel.
function gemesseneZahl() {
  const ziel = mkdtempSync(join(tmpdir(), "keel-managed-messung-"));
  try {
    const init = laufen("git", ["init", "--quiet", ziel], repoRoot);
    assert.equal(init.status, 0, "git init im Messziel schlug fehl: " + (init.stderr || init.stdout));
    const dry = laufen(process.execPath, [join(repoRoot, "install.mjs"), "--target", ziel, "--dry-run"], ziel);
    assert.equal(dry.status, 0, "Trockenlauf endete nicht mit 0: " + (dry.stderr || dry.stdout));
    const zahl = /managed=(\d+)/u.exec(String(dry.stdout))?.[1];
    assert.ok(zahl, "Trockenlauf meldet kein managed=<n>: " + dry.stdout);
    return zahl;
  } finally {
    rmSync(ziel, { recursive: true, force: true });
  }
}

function managedZahlen(text) {
  return [...new Set([...text.matchAll(/managed=(\d+)/gu)].map((treffer) => treffer[1]))];
}

test("anleitung-sync: --nachziehen schreibt die gemessene managed=-Zahl, ohne Schalter ist eine falsche Zahl Rueckgabewert 1", () => {
  const gemessen = gemesseneZahl();
  assert.notEqual(gemessen, FALSCH, "die Fehlzahl darf nicht zufaellig die gemessene sein");

  const echt = join(repoRoot, "PAKET-ANLEITUNG.md");
  const echtVorher = readFileSync(echt);
  const arbeit = mkdtempSync(join(tmpdir(), "keel-anleitung-kopie-"));
  try {
    const kopie = join(arbeit, "PAKET-ANLEITUNG.md");
    copyFileSync(echt, kopie);

    // Kopie mit falscher Zahl herstellen -- jede Stelle, nicht nur die erste.
    const original = readFileSync(kopie, "utf8");
    assert.ok(managedZahlen(original).length > 0, "die Anleitung nennt kein managed=<n>");
    const verfaelscht = original.replace(/managed=\d+/gu, "managed=" + FALSCH);
    assert.deepEqual(managedZahlen(verfaelscht), [FALSCH]);
    writeFileSync(kopie, verfaelscht);

    // 1. Ohne Schalter: Abweichung, Rueckgabewert 1, beide Zahlen genannt.
    const ohne = laufen(process.execPath, [sync, "--anleitung", kopie], repoRoot);
    assert.equal(ohne.status, 1, "falsche managed=-Zahl muss Rueckgabewert 1 liefern: " + ohne.stdout + ohne.stderr);
    const ausgabe = String(ohne.stdout);
    // Der Rueckgabewert 1 kann auch andere Gruende haben; belegt ist erst die managed-Zeile.
    assert.match(ausgabe, new RegExp("managed -- .*nennen " + FALSCH + ", gemessen ist " + gemessen + " "),
      "die managed-Meldung muss beide Zahlen nennen (" + FALSCH + " und " + gemessen + "): " + ausgabe);
    assert.deepEqual(managedZahlen(readFileSync(kopie, "utf8")), [FALSCH], "ohne Schalter darf nichts geschrieben werden");

    // 2. Mit --nachziehen: jede Stelle nennt danach die gemessene Zahl.
    const mit = laufen(process.execPath, [sync, "--nachziehen", "--anleitung", kopie], repoRoot);
    assert.equal(mit.status, 0, "--nachziehen endete nicht mit 0: " + mit.stdout + mit.stderr);
    assert.deepEqual(managedZahlen(readFileSync(kopie, "utf8")), [gemessen],
      "nach --nachziehen muss die Kopie managed=" + gemessen + " nennen");
  } finally {
    rmSync(arbeit, { recursive: true, force: true });
  }
  assert.ok(readFileSync(echt).equals(echtVorher), "die echte PAKET-ANLEITUNG.md darf der Test nicht veraendern");
});
