---
description: Send a finding or handoff to another session in this workspace (it arrives there as a labelled message)
---

Schicke einer anderen Session dieses Workspace eine Nachricht. Argument (optional):
Zielsession und/oder Inhalt; fehlt beides, aus dem Verlauf ableiten.

1. `mcp__ccd_session_mgmt__list_sessions` — Zielsession am Titel finden. Passt keiner
   eindeutig: Kandidaten zeigen und fragen, nie raten.
2. Nachricht formulieren — **drei Zeilen, mehr nicht** (der Empfaenger ist eine Maschine
   mit eigenem Kontextfenster; Verweis statt Inhalt, sie hat dieselben Dateien):

       <Fakt> — <was sich fuer DICH aendert>.
       Beleg: <datei:zeile | commit | befehl>
       Zu tun: <eine Sache>            (weglassen, wenn nichts zu tun ist)

   **Pruefsatz: Weiss die andere Session nach der ERSTEN Zeile, was sich fuer SIE
   aendert?** Der `sessionpost-guard` erzwingt die Knappheit.
3. Sind Ziel UND Anlass eindeutig: direkt senden, nicht rueckfragen — die Melderegel in
   `docs/08-sessions-rollen.md` ist die stehende Freigabe [Auftraggeber 31.07.2026].
   Nur bei erratenem Ziel/Inhalt vorher zeigen und bestaetigen lassen.
4. `mcp__ccd_session_mgmt__send_message`, danach bestaetigen: welche Session, welcher Kern.

Wann: ein Fakt aendert sich, den eine andere Session als Grundlage nutzt, oder eine
Aufgabe gehoert erkennbar einer anderen Rolle. Nicht zum Fernsteuern; in
unbeaufsichtigten Laeufen ist Senden gesperrt — Befund stattdessen in eine Datei im Repo.
