---
description: Fuehrt das einmalige Onboarding innerhalb des vorinstallierten Onboarding-Pakets aus.
---

Dieser Befehl laeuft nur, solange `docs/harness-instance.md` noch `[AUSFUELLEN]` enthaelt. Der Installer
hat dafuer bereits das echte Repo-Paket `docs/packages/harness-onboarding/`, seinen
unveraenderlichen `OWNER.md`, den Depth Tree und ein Leaf mit den exakten Schreibrechten
angelegt. Fehlt dieses Paket oder die Leaf-Bindung, wird nicht geschrieben; repariere
zuerst die Installation.

1. Starte bzw. setze das Onboarding-Leaf mit dem Package Executor fort. Lies
   `OWNER.md`, `PACKAGE.md`, den Leaf-Vertrag und seine `OWNS`-Pfade.
2. Frage jede noch offene `[AUSFUELLEN]`-Angabe in `docs/harness-instance.md` einzeln ab und schreibe nur die vom
   Menschen bestaetigten Antworten. Raten und stilles Entfernen von Platzhaltern sind
   verboten.
3. Ergaenze `docs/tool-landscape.md` nur um bestaetigte Werkzeuge. Zugangs-WERTE kommen
   nie in Dateien; nur Namen und gemessener Verbindungsstatus sind zulaessig.
4. Owner-Entscheidungen zu Remote, erlaubten Schreibzielen, versionierten Einstellungen
   und Sitzungsrollen bleiben manuelle Gates im Paket.
5. Verifiziere das Leaf lokal, nimm den Ruecklauf ueber `package-executor return` an und
   integriere das Paket genau einmal ueber `package-executor integrate`. Kein roher
   Git-Befehl und kein Auto-Push.
6. Berichte offene Platzhalter, Werkzeugstatus, Gate-Evidence und den naechsten exakten
   Paket-Schritt. Publish bleibt ein eigener, vom Owner freizugebender `/save-work`-Schritt.

Bricht der Mensch ab, bleibt der Paket- und Platzhalterzustand offen und wird in der
naechsten Sitzung aus derselben kanonischen Runtime fortgesetzt.
