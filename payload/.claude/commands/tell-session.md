---
description: Legt einen knappen Befund fuer eine andere Session im exakt gebundenen Paket-Leaf ab.
---

Direktes Session-Senden bleibt gesperrt. Ein Befund ist normale Paketarbeit und darf nur
geschrieben werden, wenn das aktuelle Leaf die konkrete Datei
`docs/session-notes/<ziel-rolle>.md` in `OWNS` besitzt. Ohne diese Bindung wird keine Datei
angelegt; der Befund muss zuerst dem richtigen Repo-Paket und Leaf zugeordnet werden.

1. Ziel-Rolle aus der versionierten Rollenliste bestimmen; nie raten.
2. Genau einen knappen Eintrag formulieren: Fakt, Auswirkung fuer die Zielrolle, Evidence
   und hoechstens eine naechste Handlung.
3. An die gebundene Notizdatei anhaengen und die normalen Leaf-Gates lokal ausfuehren.
4. Der Parent nimmt das Leaf ueber `package-executor return` an und integriert es mit dem
   restlichen Paket. Dieser Command commitet oder pusht nie selbst.
5. Bestaetige Zielrolle, Datei, Evidence und den kanonischen Paketstatus.
