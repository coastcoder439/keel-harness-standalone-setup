// test/fresh-clone-failure.test.mjs -- der Pruefer muss sich selbst beenden.
//
// WARUM ES DAS GIBT
// Am 14./15.09.2026 beendete sich checks/fresh-clone.mjs nach einer
// fehlgeschlagenen Assertion NICHT mehr: die Fehlermeldung stand auf stderr,
// das `exit`-Ereignis feuerte mit Code 1, aber der Prozess blieb liegen (0 %
// CPU, keine offenen Handles -- ein Deadlock im nativen Teardown des
// Node-Fatal-Pfades unter Windows). checks/run-all.mjs wartete darauf die volle
// 45-Minuten-Grenze ab; ein roter Pruefer kostete damit einen ganzen
// Release-Lauf. Ein roter Pruefer, der nicht zurueckkommt, ist schlimmer als
// gar kein Pruefer -- diese Zusage steht ab jetzt als Test.
//
// AUFRUF    node --test test/fresh-clone-failure.test.mjs
// RUECKGABE 0 = der Fehlschlag terminiert rechtzeitig und rot

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// 10 s ist die Zusage aus dem Paket; der gesunde Fehlschlag braucht ~1,5 s.
const GRENZE_MS = 10_000;

test("fehlgeschlagene Assertion beendet checks/fresh-clone.mjs binnen 10 s mit Rueckgabewert != 0", () => {
  const ziel = mkdtempSync(join(tmpdir(), "keel-setup-abbruch-"));
  try {
    const start = Date.now();
    const lauf = spawnSync(process.execPath, [join(repoRoot, "checks", "fresh-clone.mjs"), "--target", ziel], {
      cwd: repoRoot, encoding: "utf8", windowsHide: true,
      timeout: GRENZE_MS, killSignal: "SIGKILL",
      // Die Einspeisung faelscht GENAU die gemessene `managed=`-Zahl. Damit
      // schlaegt dieselbe deepStrictEqual-Bindung fehl, die den Haenger am
      // 15.09.2026 ausloeste -- ohne Handaenderung an Payload oder Anleitung.
      env: { ...process.env, KEEL_HARNESS_TESTING: "1", KEEL_SETUP_TEST_FAILURE: "managed-binding" },
    });
    const dauer = Date.now() - start;

    assert.equal(lauf.error?.code, undefined,
      "fresh-clone.mjs kam nicht von selbst zurueck (" + lauf.error?.code + ") -- der Haenger vom 15.09.2026 ist zurueck");
    assert.notEqual(lauf.status, 0,
      "fresh-clone.mjs meldete trotz gefaelschter managed=-Zahl Rueckgabewert 0");
    assert.ok(dauer < GRENZE_MS,
      "fresh-clone.mjs brauchte " + dauer + " ms bis zum Abbruch (Grenze " + GRENZE_MS + " ms)");
    const ausgabe = String(lauf.stdout || "") + String(lauf.stderr || "");
    assert.ok(ausgabe.includes("managed="),
      "der Abbruch nennt den fehlgeschlagenen Pruefpunkt nicht: " + ausgabe.slice(-500));
    assert.ok(!ausgabe.includes("SETUP_REPO_OK"),
      "der rote Lauf meldete trotzdem SETUP_REPO_OK");
  } finally {
    rmSync(ziel, { recursive: true, force: true });
  }
});

// Gegenprobe zur Einspeisung: ohne den Testschalter darf sie nichts faelschen,
// sonst haette der Pruefer eine Hintertuer statt eines Testseils. Bewusst OHNE
// --target: das ist der billige Trockenlauf, die echte Installation misst
// Phase 4 von checks/run-all.mjs.
test("ohne KEEL_HARNESS_TESTING=1 ist die Test-Einspeisung wirkungslos", () => {
  const lauf = spawnSync(process.execPath, [join(repoRoot, "checks", "fresh-clone.mjs")], {
    cwd: repoRoot, encoding: "utf8", windowsHide: true,
    timeout: 5 * 60_000, killSignal: "SIGKILL",
    env: { ...process.env, KEEL_HARNESS_TESTING: "", KEEL_SETUP_TEST_FAILURE: "managed-binding" },
  });
  assert.equal(lauf.status, 0, "der gesunde Lauf wurde rot: " + (lauf.stderr || lauf.stdout));
  assert.ok(String(lauf.stdout).includes("SETUP_REPO_OK"),
    "der gesunde Lauf meldet kein SETUP_REPO_OK: " + lauf.stdout);
});
