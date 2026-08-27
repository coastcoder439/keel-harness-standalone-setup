---
description: Befund oder Uebergabe fuer eine andere Session ablegen (sie liest ihn bei ihrem naechsten Start)
---

Lege einer anderen Rolle dieses Workspace einen Befund ab. Argument (optional):
Ziel-Rolle und/oder Inhalt; fehlt beides, aus dem Verlauf ableiten.

**Senden ist abgestellt** [Owner-Entscheid 27.08.2026, Paket `docs/packages/session-messages.md`]:
Eine gesendete Nachricht erscheint beim Owner im Vordergrund und unterbricht beim
Empfaenger die laufende Arbeit. Der `sessionpost-guard` blockt
`mcp__ccd_session_mgmt__send_message`.

1. Ziel-Rolle in `docs/08-sessions-rollen.md` bestimmen. Passt keine eindeutig:
   Kandidaten zeigen und fragen, nie raten.
2. Notiz formulieren — **drei Zeilen, mehr nicht** (die Gegenseite ist eine Maschine mit
   eigenem Kontextfenster und denselben Dateien; Verweis statt Inhalt):

       ## <JJJJ-MM-TT> — von <deine Rolle>
       <Fakt> — <was sich fuer DICH aendert>.
       Beleg: <datei:zeile | commit | befehl>
       Zu tun: <eine Sache>            (weglassen, wenn nichts zu tun ist)

   **Pruefsatz: Weiss die andere Rolle nach der ERSTEN Zeile, was sich fuer SIE aendert?**
3. Eintrag ans ENDE von `docs/session-notes/<ziel-rolle>.md` haengen (Datei anlegen,
   wenn sie fehlt) und committen:
   `git commit -m "notiz(<ziel>): <kern>" -- docs/session-notes/<ziel-rolle>.md`
4. Bestaetigen: welche Rolle, welcher Kern, welche Datei.

Wann: ein Fakt aendert sich, den eine andere Rolle als Grundlage nutzt, oder eine Aufgabe
gehoert erkennbar einer anderen Rolle. Die Zielsitzung sieht beim naechsten Start, dass
ihre Datei Eintraege hat (`.claude/session-roles.js`, Funktion `notizen()`); gelesen und
erledigt heisst: Eintrag streichen, die Historie steht in git.
