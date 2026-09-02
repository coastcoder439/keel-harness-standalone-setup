---
name: source-command-tell-session
description: Legt einen knappen Befund fuer eine andere Session im exakt gebundenen Paket-Leaf ab.
---

# Tell session

Direktes Session-Senden bleibt gesperrt. Schreibe eine Notiz nur, wenn das aktuelle Leaf
die konkrete Datei `docs/session-notes/<ziel-rolle>.md` in `OWNS` besitzt. Ohne Bindung
wird keine Datei angelegt.

1. Zielrolle aus der versionierten Rollenliste bestimmen; nie raten.
2. Fakt, Auswirkung, Evidence und hoechstens eine Handlung knapp notieren.
3. An die gebundene Datei anhaengen und die normalen Leaf-Gates lokal ausfuehren.
4. Der Parent nimmt das Leaf ueber `package-executor return` an und integriert es mit
   dem Paket. Dieses Skill commitet oder pusht nie selbst.
5. Berichte Zielrolle, Datei, Evidence und kanonischen Paketstatus.
