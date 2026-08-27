# Arbeitsweise — Zieldefinition, zwei Abschluss-Messungen

Vor der Arbeit die Zieldefinition in drei Saetzen: **Problem** (was ist konkret kaputt) ·
**Intent** (warum es getan wird) · **Goal** (der pruefbare Zielzustand). Dann die
**Zuordnung**: gehoert diese Arbeit in ein BESTEHENDES Paket oder braucht sie ein neues?
[Owner 27.08.2026] — der `paket-gate` blockt die erste Schreibung, solange die Frage
offen ist, und nennt Kandidaten. Schleife je
Arbeitspaket: Zieldefinition → Plan → Bau → Verify → Ship; sichern per Push ist immer erlaubt.
**Verify bei UI-Code heisst: echter Screenshot im Browser gegen `docs/ui-standard.md`
geprueft** [Owner, 25.08.2026: "du hast anscheinend keine optische Abnahme gemacht"] —
DOM-Text lesen ersetzt das Hinsehen nicht; ein fehlgeschlagener Screenshot ist ein
Blocker, kein uebersprungener Schritt.

**Jedes Arbeitspaket lebt als sichtbares Artefakt IM REPO SEINES PROJEKTS** [Owner,
24.08.2026]: `<projekt-repo>/docs/packages/<paket>.md` — Projekt-Arbeit unter
`user-projects/<name>/docs/packages/` (landet mit dem Projekt auf GitHub), Werkbank-Arbeit
in der Werkbank `docs/packages/`. Format: Vorlage `docs/packages/TEMPLATE.md` (PIG · Plan ·
Status · Abnahme · Abschluss); angelegt beim Planen, nachgefuehrt bei jedem
Paket-Abschluss. **Ein Paket wird nur geloescht, wenn `Offen:` leer ist UND alle
Plan-Haken gesetzt sind** [Owner 27.08.2026: Commit cea6dbd loeschte acht Pakete als
„fertig", sechs davon trugen offene Owner-Handlungen, die danach nur noch in git lebten]. Ein Plan,
den der Owner nicht sehen kann, existiert nicht — und die Kommandobruecke liest alle
Pakete ueber genau diese eine Struktur. **Fertig-Massstab des Harness** [Owner]:
`docs/harness-issues.md` ist leer — offene ARBEIT lebt in Paket-Artefakten, nicht in Issue-Prosa.

Am Ende ZWEI getrennte Messungen: **Coverage** (alles adressiert? — bei bau-bereit-Aussagen
und Uebergaben als Vollstaendigkeits-Audit ueber den Skill `completeness`) und
**Fulfillment** (ist das ZIEL erfuellt, nicht nur Arbeit geleistet?). Coverage findet
Luecken, Fulfillment findet Frame-Fehler — keins ersetzt das andere.

Jede Abschluss-Meldung endet im Format: „Geprueft gegen: ⟨Quellen⟩ · Offen: ⟨Liste
oder nichts⟩" — „fertig" existiert nur innerhalb dieses Formats. Zahlen beim Schreiben
messen, nicht erinnern, und den Befehl danebenschreiben, der die Zahl erzeugt hat.
Jeder Fix landet SYNCHRON in Werkbank, Bausatz und Doku — nie nur in einem.
