# Sitzungs-Notizen — Befunde zwischen den Rollen

Nachrichten ZWISCHEN Sitzungen sind abgestellt: Sie können beim Owner im
Vordergrund erscheinen und beim Empfänger die gebundene Leaf-Arbeit
unterbrechen. Diese Datei beschreibt den aktiven Ersatz; ein altes Paket ist
keine zweite Begründungs- oder Statuswahrheit.

Ersatz ohne Verlust: Eine Datei je Ziel-Rolle, benannt nach der Rolle
(`harness-control.md`, `dashboard.md`, `karriereplanung.md`). Neue Eintraege kommen
ANS ENDE, Format:

    ## 2026-08-27 — von Harness Control
    <Fakt> — <was sich fuer DICH aendert>.
    Beleg: <datei:zeile | commit | befehl>
    Zu tun: <eine Sache>            (weglassen, wenn nichts zu tun ist)

Der Sitzungsstart meldet jeder Sitzung, welche Notiz-Dateien Eintraege haben
(`.claude/session-roles.js`, Funktion `notizen()`) — der Inhalt bleibt ungelesen,
bis jemand die Datei oeffnet. Gelesen und erledigt: Eintrag streichen, die Historie
steht in git.

Geschrieben wird ueber `/tell-session`; der `sessionpost-guard` blockt das Senden.
