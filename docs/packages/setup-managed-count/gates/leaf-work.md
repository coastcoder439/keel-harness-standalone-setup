# Leaf: leaf-work

OWNS: checks/anleitung-sync.mjs, PAKET-ANLEITUNG.md, test/anleitung-managed.test.mjs, .gitignore

Scope: anleitung-sync schreibt managed= aus dem gemessenen Installer-Trockenlauf in PAKET-ANLEITUNG.md fort, belegt durch einen Test. Arbeitsauftrag im Paket setup-managed-count, Claude Sonnet 5.5 auf high. Arbeitsverzeichnis ist die Wurzel von keel-harness-standalone-setup. Gemessen 05.10.2026: `scripts/release-payload.mjs --source <Klon 1.3.18>` scheiterte mit SETUP_REPO_SUITE_FAILED test/fresh-clone-failure.test.mjs; checks/fresh-clone.mjs Z. 154–162 vergleicht die Zahl managed= in PAKET-ANLEITUNG.md (Z. 109 und Z. 126, beide managed=613) mit dem echten Trockenlauf des Installers, der bei 610 Payload-Posten managed=614 meldet. `anleitung-sync.mjs --nachziehen` gleicht Version und Payload-Zahl an, managed= nicht; derselbe Fehler trat bei 1.3.16 auf und wurde damals von Hand korrigiert.

Entscheidungen, die du umsetzt:
1. `anleitung-sync.mjs --nachziehen` ermittelt managed= genau wie checks/fresh-clone.mjs: Trockenlauf des Installers dieses Repos gegen ein frisches temporäres Ziel in os.tmpdir() (`node install.mjs install --target <tmp> --dry-run` bzw. der Aufruf, den fresh-clone.mjs verwendet), liest `managed=(\d+)` aus der Ausgabe und ersetzt jede `managed=<n>`-Angabe in PAKET-ANLEITUNG.md; das temporäre Ziel wird danach entfernt.
2. Ohne `--nachziehen` meldet anleitung-sync eine Abweichung von managed= mit Rückgabewert 1 und nennt beide Zahlen.
3. PAKET-ANLEITUNG.md wird mit `node checks/anleitung-sync.mjs --nachziehen` auf den aktuellen Stand gebracht (erwartet managed=614), nicht von Hand.
4. test/anleitung-managed.test.mjs (Node-Bordmittel, node:test) prüft: nach --nachziehen nennt eine Kopie der Anleitung mit falscher Zahl die gemessene Zahl; ohne Schalter liefert eine falsche Zahl Rückgabewert 1. Der Test arbeitet auf einer Kopie in os.tmpdir() und verändert die echte Anleitung nicht.

Nachbesserung 05.10.2026: Der erste Lauf (Sitzung b234b79f) hat anleitung-sync.mjs und test/anleitung-managed.test.mjs geschrieben, konnte aber keinen Node-Aufruf ausführen (Wächter 1.3.17: UNDECLARED_NODE_SCRIPT, UNDECLARED_TEST). L1 führt deshalb `--nachziehen` selbst als ersten Schritt aus; die lokale Reverify des Orchestrators über gate-check läuft ohne diese Sperre. Du prüfst nur noch den vorhandenen Code durch Lesen auf Fehler, korrigierst sie innerhalb der OWNS und meldest zurück; Node-Aufrufe brauchst du nicht zu versuchen.

Harte Regeln: Nur in deinen OWNS schreiben. Git nur lesend. Kein Release, kein Push, kein Update der Werkbank, kein Befehl an den Owner. Danach L1 aus seinem CWD ausführen und die Ausgabe melden.

- [x] L1: anleitung-sync schreibt managed= aus dem gemessenen Installer-Trockenlauf in PAKET-ANLEITUNG.md fort, belegt durch einen Test
  CHECK: node checks/anleitung-sync.mjs --nachziehen && node --test test/anleitung-managed.test.mjs test/fresh-clone-failure.test.mjs && node checks/anleitung-sync.mjs
  EXPECT: fail 0
  EVIDENCE: schema=2; exit=0; shellId=win32:cmd.exe; cwd=.; oracleDigest=sha256:2cd9b485e2412264f6e763467b053ca0af62251a81d03d09e0f04ec2baa474dc; EXPECT=matched; output-sha256=ed0e37fec70f9c2679dfdd8424b19514c93946f41feff6515d7843b4c0d3f50c; output-bytes=624
