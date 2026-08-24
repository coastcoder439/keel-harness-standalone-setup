# Arbeitsweise — Zieldefinition, zwei Abschluss-Messungen

Vor der Arbeit die Zieldefinition in drei Saetzen: **Problem** (was ist konkret kaputt) ·
**Intent** (warum es getan wird) · **Goal** (der pruefbare Zielzustand). Schleife je
Arbeitspaket: Zieldefinition → Plan → Bau → Verify → Ship; sichern per Push ist immer erlaubt.

Am Ende ZWEI getrennte Messungen: **Coverage** (alles adressiert? — bei bau-bereit-Aussagen
und Uebergaben als Vollstaendigkeits-Audit ueber den Skill `completeness`) und
**Fulfillment** (ist das ZIEL erfuellt, nicht nur Arbeit geleistet?). Coverage findet
Luecken, Fulfillment findet Frame-Fehler — keins ersetzt das andere.

Jede Abschluss-Meldung endet im Format: „Geprueft gegen: ⟨Quellen⟩ · Offen: ⟨Liste
oder nichts⟩" — „fertig" existiert nur innerhalb dieses Formats. Zahlen beim Schreiben
messen, nicht erinnern, und den Befehl danebenschreiben, der die Zahl erzeugt hat.
Jeder Fix landet SYNCHRON in Werkbank, Bausatz und Doku — nie nur in einem.
