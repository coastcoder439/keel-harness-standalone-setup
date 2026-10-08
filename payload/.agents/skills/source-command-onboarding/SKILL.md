---
name: source-command-onboarding
description: Fuehrt das einmalige Onboarding aus: die Sitzung fragt den Menschen und schreibt das Installationsprofil selbst.
---

# Onboarding

Dieser Ablauf laeuft nur, solange `docs/harness-instance.md` noch `[AUSFUELLEN]` enthaelt. Er braucht kein Paket und
keinen Arbeitsagenten: die Sitzung fragt den Menschen und schreibt nur das Profil `docs/harness-instance.md`. Der
Installer legt kein Onboarding-Paket an; ein `harness-onboarding`-Paket einer aelteren Installation ist stillgelegt
und wird nicht fortgesetzt.

1. Lies `docs/harness-instance.md`. Jede Zeile mit `[AUSFUELLEN]` ist eine offene Angabe.
2. Frage jede offene Angabe einzeln ab und trage nur bestaetigte Antworten ein. Raten, Standardwerte und stilles
   Entfernen von Platzhaltern sind verboten.
3. Schreibe jede bestaetigte Antwort sofort in ihre Zeile; alle anderen Zeilen bleiben unveraendert, damit eine
   Antwort auch bei einem Abbruch erhalten bleibt.
4. Remote, erlaubte Schreibziele, Publish-Regel und Sitzungsrichtlinie entscheidet der Mensch: frage sie
   ausdruecklich ab. Andere Dateien schreibst du hier nicht (auch nicht `docs/tool-landscape.md`); Werkzeuge und
   Zugaenge nennst du am Ende als Vorschlag fuer spaetere Arbeit, nur Namen, nie Zugangswerte.
5. Biete das Google-Onboarding als OPTIONALEN Schritt an: das Dashboard laeuft ohne ihn,
   nur seine Google-Faehigkeiten (Kalender, Aufgaben, Gmail) brauchen ihn. Stimmt der
   Mensch zu, fuehre ihn Schritt fuer Schritt durch `docs/google-onboarding.md` (eigenes
   Google-Cloud-Projekt, OAuth-Client "Desktop app", client_secrets ablegen, im Dashboard
   verbinden). Lehnt er ab oder vertagt, blockiert das den Rest des Onboardings NICHT.
6. Pruefe mit `node checks/onboarding-ready.mjs --root . --mode profile`; erwartet ist `PROFILE READY`.
7. Berichte gesetzte Werte und Offenes. Publish bleibt ein separat freizugebender Save-work-Schritt.

Bricht der Mensch ab, bleiben die offenen Marken stehen; der naechste Sitzungsstart schlaegt das Onboarding wieder
vor, bis keine Marke mehr da ist, und erzwingt es nie.
