---
description: Legt einen knappen Befund fuer eine andere Session als Notiz in docs/session-notes ab.
---

Nachrichten direkt an eine andere Session werden nicht gesendet. Ein Befund ist eine Notiz in
`docs/session-notes/<ziel-rolle>.md`; arbeitet die Session in einem Leaf, steht diese Datei in
dessen `OWNS`.

1. Ziel-Rolle aus der versionierten Rollenliste bestimmen; nie raten.
2. Genau einen knappen Eintrag formulieren: Fakt, Auswirkung fuer die Zielrolle, Evidence
   und hoechstens eine naechste Handlung.
3. An die Notizdatei anhaengen; in einem Leaf die normalen Leaf-Gates lokal ausfuehren.
4. Der Parent nimmt das Leaf ueber `package-executor return` an und integriert es mit dem
   restlichen Paket. Dieser Command commitet oder pusht nie selbst.
5. Bestaetige Zielrolle, Datei, Evidence und den kanonischen Paketstatus.
