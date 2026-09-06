---
name: completeness
description: Vollstaendigkeits-Audit vor bau-bereit-Aussagen, nach groesseren Ergaenzungen und vor Uebergaben — acht Fragen, vier Gegenproben, Quellen-Rangfolge. Auf Abruf laden, nicht Dauer-Kontext.
---

# Vollstaendigkeit — wann etwas wirklich fertig ist

> On-demand-Fassung 24.08.2026 (vorher Dauer-Regel `.claude/rules/keel/completeness.md`;
> Langfassung mit Beweislage: `docs/completeness-check.md`). Anlass der Regel: mehrfach
> „fertig" gemeldet, waehrend hunderte Luecken offen waren.

## Die acht Fragen (Definition von bau-fertig)

Solange EINE offen ist, ist es nicht fertig:

1. **Akteure** — jede Menschen-Rolle und Agenten-Art auf jeder Flaeche, inklusive „darf nicht".
2. **Lebenszyklus** — entstehen · einrichten · benutzen · aendern · scheitern · **uebergeben ·
   beenden · abbauen** (die letzten drei sind der haeufigste blinde Fleck).
3. **Governance je Faehigkeit** — wer darf · wer sieht · Einstellungs-Ort · was wird
   protokolliert · wer nimmt ab.
4. **Versprechen** — jeder Anspruch zugeordnet, terminiert ODER begruendet verworfen.
   Halb zugeordnet rutscht am leichtesten durch; ungemessene absolute Woerter
   (*einzige, jede, immer, vollstaendig*) brauchen ein Abnahmekriterium oder muessen weg.
5. **Belege** — jede Aussage ueber fremden Code am Code belegt, mit Gegenprobe.
6. **Fehlerfall** — Abbruch, Ausfall, Zeitueberschreitung, verschwundener Akteur.
7. **Folgepflichten** — erzeugt die Entscheidung eine Pflicht (aufraeumen, migrieren,
   ueberwachen)? Ist die Pflicht SELBST geplant? Sonst ist es verschoben, nicht entschieden.
8. **Widerspruchsfreiheit** — kein Dokument gegen ein anderes, kein Fliesstext gegen
   seinen Warnkasten. Ein Warnkasten ersetzt keine Korrektur.

## Die vier Gegenproben — vor jeder Entscheidung

- **G1 Widerspruchsprobe** — widerspricht das einem Versprechen oder frueheren Beschluss?
  Nachsehen, nicht erinnern.
- **G2 Achsenprobe** — presse ich zwei unabhaengige Fragen in eine Antwort? Gibt es einen
  realen Fall, in dem das eine gilt und das andere nicht → zwei Entscheidungen.
- **G3 Folgepflichtprobe** — was muss danach DAUERHAFT getan werden, wer tut es, ist das
  geplant — oder erzeuge ich eine Waise?
- **G4 Messbarkeitsprobe** — verlasse ich mich auf eine Beurteilung, wo eine Eigenschaft
  pruefbar waere? Der Beurteilende irrt — bleibt eine Schranke? Wenn nein: strukturell machen.

## Quellen-Rangfolge

Eine Vollstaendigkeits-Aussage ist nur so viel wert wie die OBERSTE Ebene, gegen die
geprueft wurde: **Auftrag** (Vision) → **Produktbild** → **Umsetzung** (Plaene) →
**Wahrheit** (Quellcode) → **Nachbarn** (Parallel-Sitzungen) → **Historie** (Gedaechtnis,
Korrektur-Logs) → **Zustaendigkeit** (Rollen). Wer nur „Umsetzung gegen Code" prueft,
findet nie ein vergessenes Versprechen.

## Durchfuehrung

Bei mehr als einer Datei Blickrichtung: als Workflow mit parallelen Pruefern je Matrix,
danach adversarische Gegenpruefung; bestaetigte Funde sequenziell einarbeiten, am Ende
eine Nachlese. **Eine leere Matrix-Zelle ist ein Verdacht** — das findet, was niemand
vermisst hat. Berichtigungen vor dem Beheben selbst an der Quelle pruefen.
