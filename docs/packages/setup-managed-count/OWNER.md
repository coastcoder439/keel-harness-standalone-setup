# Owner contract: setup-managed-count

Schema: 1
Source: package-standard.mjs create
Captured: 2026-10-05

## Original request

„OK, Release 1.3.18 veröffentlichen und pushen.“

dann dashborad link ausgeben damit ich harness updaten kann

und danach die zwei offenen fehler beheben:

1. Inventur sichern geht nur mit Owner-Befehl. Nach jeder Code-Änderung muss die Inventur gesichert werden, und dafür gibt es keinen Agentenweg. Deshalb musstest du heute Nacht wieder klicken. Ja, das ist ein Harness-Fehler.
2. Fan-out-Test wackelt unter Last. Im ersten Gesamtlauf war er rot, einzeln und im zweiten Lauf grün.

## Requirements

- R1 -> C1: anleitung-sync schreibt managed= aus dem gemessenen Installer-Trockenlauf in PAKET-ANLEITUNG.md fort, belegt durch einen Test
- R2 -> C2: Das Setup-Release 1.3.18 ist veröffentlicht
