# Arbeitsweise — Zieldefinition, zwei Abschluss-Messungen

Vor der Arbeit die Zieldefinition in drei Saetzen: **Problem** (was ist konkret kaputt) ·
**Intent** (warum es getan wird) · **Goal** (der pruefbare Zielzustand). Schleife je
Arbeitspaket: Zieldefinition → Plan → Bau → Verify → Ship; sichern per Push ist immer erlaubt.

**Jedes Arbeitspaket lebt als sichtbares Artefakt** [Owner, 24.08.2026]: Plan, Stand und
DoD stehen in einem fuer den Menschen offenen Dokument (Werkbank-Arbeit: das
Architektur-Artefakt), angelegt beim Planen und nachgefuehrt bei jedem Paket-Abschluss —
nicht erst auf Nachfrage. Ein Plan, den der Owner nicht sehen kann, existiert nicht.
Diese Artefakte sind zugleich die Aufgaben-Sicht der Kommandobruecke.

Am Ende ZWEI getrennte Messungen: **Coverage** (alles adressiert? — bei bau-bereit-Aussagen
und Uebergaben als Vollstaendigkeits-Audit ueber den Skill `completeness`) und
**Fulfillment** (ist das ZIEL erfuellt, nicht nur Arbeit geleistet?). Coverage findet
Luecken, Fulfillment findet Frame-Fehler — keins ersetzt das andere.

Jede Abschluss-Meldung endet im Format: „Geprueft gegen: ⟨Quellen⟩ · Offen: ⟨Liste
oder nichts⟩" — „fertig" existiert nur innerhalb dieses Formats. Zahlen beim Schreiben
messen, nicht erinnern, und den Befehl danebenschreiben, der die Zahl erzeugt hat.
Jeder Fix landet SYNCHRON in Werkbank, Bausatz und Doku — nie nur in einem.
