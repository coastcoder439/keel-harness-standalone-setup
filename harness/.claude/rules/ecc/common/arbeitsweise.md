# Arbeitsweise — Zieldefinition, zwei Abschluss-Messungen, kein „fertig"

> Dauer-Regel, laedt in jeder Sitzung (der Ordner wird flach ausgelesen, kein Frontmatter).
> Anlass: eine lueckenlose Bewertung gegen die falsche Messlatte ist lueckenlos falsch —
> Coverage allein findet den Frame-Fehler nicht.

## Vor der Arbeit — die Zieldefinition

**Zieldefinition: Problem · Intent · Goal** — drei Saetze, bevor gebaut wird. Ohne sie gibt
es am Ende nichts, wogegen man das Ergebnis halten kann.

- **Problem** — was ist konkret kaputt oder offen (ein Satz).
- **Intent** — warum es getan wird, welcher Zweck dahintersteht.
- **Goal** — der pruefbare Zielzustand, an dem sich „erfuellt" messen laesst.

Schleife je Arbeitspaket: **Zieldefinition → Plan → Bau → Verify → Ship.** Verify ist kein
Kür-Schritt — keine „bau-bereit"-Aussage, kein Merge, keine Uebergabe ohne ihn. (Sichern per
Push ist ausgenommen — sichern darf man immer.)

## Am Ende — ZWEI getrennte Messungen, nie nur eine

**Abschluss-Messung 1: Coverage** — ist alles adressiert, nichts vergessen? Akteure ·
Lebenszyklus (inkl. uebergeben/beenden/abbauen) · Governance · Versprechen · Belege ·
Fehlerfall · Folgepflichten · Widerspruchsfreiheit. Die acht Fragen im Detail und die drei
Gegenproben stehen in [`vollstaendigkeit.md`](vollstaendigkeit.md).

**Abschluss-Messung 2: Fulfillment** — ist das *Ziel* erfuellt, nicht nur Arbeit geleistet?
Ausdruecklich als eigener Schritt: das Ergebnis gegen die Zieldefinition (Problem · Intent ·
Goal) halten. Wurde das Problem geloest — oder nur etwas daneben gebaut, das zufaellig fertig
aussieht? Wurde der Intent getroffen?

**Coverage findet Luecken, Fulfillment findet Frame-Fehler. Keins ersetzt das andere:** eine
lueckenlose Bewertung gegen die falsche Messlatte ist lueckenlos falsch. Beide laufen, immer,
getrennt — Coverage nie als Ersatz fuer Fulfillment ausgeben.

## Sprachregel

- **„fertig" ist als Selbstauskunft verboten.** Erlaubt: *„Geprueft gegen ⟨Quellen⟩ — offen
  ist ⟨Liste⟩."* Ist die Liste leer, nenne die geprueften Fragen, nicht das Wort.
- **Zahlen beim Schreiben messen, nicht erinnern** — und den Befehl, der die Zahl erzeugt
  hat, danebenschreiben.

Verwandt: [`vollstaendigkeit.md`](vollstaendigkeit.md) (Coverage-Detail, Gegenproben) ·
[`kein-oneshot.md`](kein-oneshot.md) (erst pruefen, dann formulieren).
