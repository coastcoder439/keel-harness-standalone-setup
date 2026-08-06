---
description: Overview of all sessions in this workspace -- who is running, which role, last activity, plus repo status
---

Verschaffe einen Ueberblick ueber alle Sessions dieses Workspace und melde ihn kurz.

1. `mcp__ccd_session_mgmt__list_sessions` aufrufen.
2. Rollen aus `docs/08-sessions-rollen.md` (Rollen-Tabelle) zuordnen.
3. Je Session eine Zeile: `Titel | Rolle laut docs/08 | laeuft ja/nein | letzte Aktivitaet`.
4. Sessions, die in `list_sessions` auftauchen, aber NICHT in `docs/08` stehen,
   ausdruecklich als **"Rolle nicht definiert"** markieren -- das ist der haeufigste
   Koordinationsfehler in diesem Workspace.
5. Danach `node .claude/repo-status.js` und in zwei Zeilen sagen, ob irgendwo
   etwas ungesichert oder ungepusht ist.

Regeln:
- Fremde Transkripte NICHT ungefragt auslesen. Ist der Stand einer Session unklar,
  das sagen statt zu raten (`list_events` nur auf Ansage).
- Keine Vermutungen ueber Inhalte anderer Sessions -- nur Titel, Rolle, Zeit, Status.
