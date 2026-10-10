---
name: source-command-tell-session
description: Legt einen knappen Befund fuer eine andere Session als Notiz in docs/session-notes ab.
---

# Tell session

Nachrichten direkt an eine andere Session werden nicht gesendet. Schreibe stattdessen eine
Notiz in `docs/session-notes/<ziel-rolle>.md`; arbeitet die Session in einem Leaf, steht
diese Datei in dessen `OWNS`.

1. Zielrolle aus der versionierten Rollenliste bestimmen; nie raten.
2. Fakt, Auswirkung, Evidence und hoechstens eine Handlung knapp notieren.
3. An die Datei anhaengen; in einem Leaf die normalen Leaf-Gates lokal ausfuehren.
4. Der Parent nimmt das Leaf ueber `package-executor return` an und integriert es mit
   dem Paket. Dieses Skill commitet oder pusht nie selbst.
5. Berichte Zielrolle, Datei, Evidence und kanonischen Paketstatus.
