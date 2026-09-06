---
name: source-command-onboarding
description: Fuehrt das einmalige Onboarding innerhalb des vorinstallierten Onboarding-Pakets aus.
---

# Onboarding

Der Installer legt vor der ersten Sitzung das echte Repo-Paket
`docs/packages/harness-onboarding/` samt `OWNER.md`, Depth Tree, Gates und Leaf-Bindung
an. Fehlt es, wird nicht geschrieben.

1. Starte oder setze das Onboarding-Leaf mit dem Package Executor fort.
2. Frage jede offene `[AUSFUELLEN]`-Angabe in `docs/harness-instance.md` einzeln ab und trage nur
   bestaetigte Antworten ein. Raten ist verboten.
3. Ergaenze `docs/tool-landscape.md` nur um bestaetigte Werkzeuge und gemessene
   Verbindungen. Zugangs-Werte kommen nie in Dateien.
4. Remote, Schreibziele, versionierte Einstellungen und Sitzungsrollen bleiben
   manuelle Owner-Gates.
5. Biete das Google-Onboarding als OPTIONALEN Schritt an: das Dashboard laeuft ohne ihn,
   nur seine Google-Faehigkeiten (Kalender, Aufgaben, Gmail) brauchen ihn. Stimmt der
   Mensch zu, fuehre ihn Schritt fuer Schritt durch `docs/google-onboarding.md` (eigenes
   Google-Cloud-Projekt, OAuth-Client "Desktop app", client_secrets ablegen, im Dashboard
   verbinden). Lehnt er ab oder vertagt, blockiert das den Rest des Onboardings NICHT.
   Ein `harness-onboarding`-Paket existiert erst nach der Installation; verweise dann von
   dort ebenfalls auf `docs/google-onboarding.md`.
6. Verifiziere das Leaf lokal, nimm es mit `package-executor return` an und integriere
   genau einmal mit `package-executor integrate`. Kein rohes Git und kein Auto-Push.
7. Berichte offene Platzhalter, Gate-Evidence und den naechsten Paket-Schritt. Publish
   bleibt ein separat freizugebender Save-work-Schritt.
