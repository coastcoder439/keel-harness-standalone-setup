# Work package: setup-managed-count

**Problem:** Der Setup-Schritt von Release 1.3.18 scheiterte an checks/fresh-clone.mjs, weil PAKET-ANLEITUNG.md managed=613 nennt, der Trockenlauf aber managed=614 misst; checks/anleitung-sync.mjs schreibt Version und Payload-Zahl fort, managed= nicht (gleicher Fehler wie bei 1.3.16).
**Intent:** Das Setup-Release läuft ohne Handkorrektur der Anleitung durch, damit der Owner 1.3.18 über den Update-Knopf einspielen kann.
**Goal:** anleitung-sync schreibt managed= aus dem gemessenen Installer-Trockenlauf fort, ein Test belegt das, und release-payload für 1.3.18 meldet RELEASE_READY.
**Scope:** Drin: checks/anleitung-sync.mjs, PAKET-ANLEITUNG.md, ein Test unter test/ Nicht drin: Produkt-Repo harness-lab (Lücken-Paket dort), Commit und Push des Setups (release-standalone --resume-setup durch den Orchestrator)
**Context:** Gemessen 05.10.2026: release-payload.mjs exit 1 SETUP_REPO_SUITE_FAILED test/fresh-clone-failure.test.mjs; Payload 609 auf 610 Dateien; PAKET-ANLEITUNG.md Z. 109 und 126 nennen managed=613.
**Planned start:** 2026-10-05
**Planned end:** 2026-10-05

## Plan

1. [ ] anleitung-sync schreibt managed= fort, mit Test
2. [ ] Setup-Release 1.3.18 nachholen

## Status

Owner-Start: 2026-10-05 "„OK, Release 1.3.18 veröffentlichen und pushen.“"
2026-10-05 - Angelegt mit package-standard.mjs create; nicht gestartet.

## Abnahme

- C1 -> gates/leaf-work.md:L1: anleitung-sync schreibt managed= aus dem gemessenen Installer-Trockenlauf in PAKET-ANLEITUNG.md fort, belegt durch einen Test
- C2 -> GATES.md:G1: Das Setup-Release 1.3.18 ist veröffentlicht

## Abschluss

Coverage: 2/2 Owner-Anforderungen gemappt; 0/2 erfüllt.
Fulfillment: nicht erfuellt - Paket angelegt, nicht gestartet.
Geprueft gegen: package-cli doctor.
Offen: Plan-Schritte 1 bis 2.

## Anhang

### Depth Tree

- ROOT GATES.md <- none: anleitung-sync schreibt managed= aus dem gemessenen Installer-Trockenlauf fort, ein Test belegt das, und release-payload für 1.3.18 meldet RELEASE_READY.
- LEAF gates/leaf-work.md <- GATES.md: anleitung-sync schreibt managed= aus dem gemessenen Installer-Trockenlauf in PAKET-ANLEITUNG.md fort, belegt durch einen Test
