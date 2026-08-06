---
description: Send a finding or handoff to another session in this workspace (it arrives there as a labelled message)
---

Schicke einer anderen Session dieses Workspace eine Nachricht. Argument (optional):
Zielsession und/oder Inhalt. Ist nichts angegeben, aus dem Gespraechsverlauf ableiten
und vor dem Senden bestaetigen lassen.

Ablauf:
1. `mcp__ccd_session_mgmt__list_sessions` -- Zielsession anhand des Titels finden.
   Passt keiner eindeutig, die Kandidaten zeigen und fragen. NIE raten.
2. Nachricht formulieren. **DREI ZEILEN, mehr nicht** -- der Empfaenger ist eine
   Maschine mit eigenem Kontextfenster, kein Mensch:

       <Fakt> — <was sich fuer DICH aendert>.
       Beleg: <datei:zeile | commit | befehl>
       Zu tun: <eine Sache>            (weglassen, wenn nichts zu tun ist)

   NICHT hinein: Dank · Lob · Entschuldigung · Wiederholung dessen, was die
   Gegenseite gerade gemeldet hat · Herleitung, wie du darauf kamst ·
   Rueckblick auf deinen eigenen Irrtum · Code-Bloecke, die sie selbst
   ausfuehren kann · Tabellen · Zwischenueberschriften.

   **Verweis statt Inhalt.** Dem Menschen gegenueber gilt das Umgekehrte (er soll
   nicht wuehlen); eine Session kann lesen, hat dieselben Dateien, und eine Kopie
   fuellt ihr Fenster und driftet, sobald die Quelle sich aendert.

   Gut: "Der Branch heisst jetzt wp3-anbindung, nicht mehr feature/anbindung.
   Der alte ist geloescht. Betrifft deinen Install-Schritt 3."
   Schlecht: "Wir haben eben besprochen, dass sich was geaendert hat."

   Schlecht (real, 03.08.2026, 2.932 Zeichen an HARNESS CONTROL): eine Nachricht mit
   drei Zwischenueberschriften, einem Code-Block, zwei Absaetzen Herleitung und dem
   Satz "Danke fuers Nachmessen statt Glauben". Der Kern waren zwei Saetze.

   **Pruefsatz vor dem Senden: Weiss die andere Session nach der ERSTEN ZEILE, was
   sich fuer SIE aendert?** Wenn nein, ist die erste Zeile falsch.
   Gemessen 03.08.2026: 63 Sitzungs-Nachrichten, Median 1.378 Zeichen, zusammen
   89.905 -- in fremde Kontextfenster geschrieben. Ziel sind ~300.
3. Sind Ziel UND Anlass eindeutig, direkt senden -- NICHT nachfragen. Die Melderegel
   in `docs/08-sessions-rollen.md` ist die stehende Freigabe (Auftraggeber, 31.07.2026:
   "wieso fragst du zu senden? sowas muss doch von alleine gehen"). Eine Rueckfrage
   macht aus einer gesetzten Regel eine Einzelfallentscheidung.
   Nur wenn Ziel oder Inhalt erst aus dem Verlauf ERRATEN werden muessen (der Fall
   aus dem Kopf dieser Datei): vorher Ziel und Text zeigen und bestaetigen lassen.
4. `mcp__ccd_session_mgmt__send_message` mit `session_id` und `message`.
5. Bestaetigen: an welche Session, welcher Kern.

Wann das benutzt wird (Regel des Workspace):
- Ein Fakt aendert sich, den eine andere Session als Grundlage benutzt
  (Pfad, Repo-Name, DB, Branch, ein Beschluss).
- Eine Aufgabe gehoert erkennbar einer anderen Rolle (`docs/08-sessions-rollen.md`)
  -- dann dorthin uebergeben statt selbst zu machen.
- NICHT zum Fernsteuern anderer Sessions und nicht fuer Hintergrundarbeit.

Grenze: In unbeaufsichtigten Sessions (geplante Laeufe) ist das Senden gesperrt --
dort stattdessen den Befund in eine Datei im Repo schreiben.
