# Kein One-Shot — jede inhaltliche Antwort wird vorher geprüft

> Anlass: wiederholte Antworten aus der Erinnerung statt aus einer Pruefung (31.07.2026).

## Die Regel

**Keine inhaltliche Aussage über dieses Vorhaben ohne vorher ausgeführte Prüfung.**
Nicht aus dem Gedächtnis. Nicht aus dem Gesprächsverlauf. Nicht „ich erinnere mich, dass".

Vor jeder Antwort, die eine Architektur-, Rollen-, Ablauf- oder Code-Aussage enthält:

1. **Zuerst prüfen, dann formulieren.** Belege sammeln, *danach* den Satz schreiben.
2. **Die richtige Schicht wählen.** Aussagen über unsere Governance gehören ins **eigene
   Plugin** (die eigenen Plugins dieses Vorhabens) und in die **Plan-Dokumente** — nicht in die
   Basis-Plattform. Umgekehrt für native Fähigkeiten. *Falsche Schicht = falsche Antwort,
   auch wenn sauber gemessen wurde.*
3. **Gegen bestehende Beschlüsse prüfen** (Gegenprobe G1), bevor eine Empfehlung ausgesprochen
   wird. Projekt-Gedächtnis und Korrektur-Logs sind Quellen, keine Nachschlagewerke für später.
4. **Mehr als eine Blickrichtung**, sobald die Frage mehr als eine Datei berührt.

## Wie geprüft wird — was hier tatsächlich läuft

| Umfang der Frage | Vorgehen |
|---|---|
| Eine Datei, eine Zeile | Direkt lesen. `grep -rn`, `sed -n`, `Read`. Kein Workflow. |
| Mehrere Dateien oder Schichten | **Workflow-Werkzeug**, parallele Prüfer je Schicht/Thema |
| Architektur-, Rollen- oder Ablauffrage | **Workflow** mit getrennten Blickrichtungen: eigenes Plugin · Plan-Dokumente · Basis-Plattform · frühere Beschlüsse — danach Zusammenführung |
| Vor einer Bau-Aussage | zusätzlich ein Vollständigkeits-Audit als Workflow (mehrere Prüfer, Matrizen, Gegenprüfung) |
| Behauptungen über fremden Code | Beleg-Nachmessung als Workflow: jede Datei:Zeile-Angabe an der Quelle nachgemessen |

**Grundsatz:** Der Aufwand richtet sich nach der Reichweite der Aussage, nicht nach der Länge
der Frage. Eine kurze Frage kann eine teure Prüfung verdienen.

## Die `multi-*`-Befehle — GESTRICHEN und entfernt [E, Auftraggeber 01.08.2026]

Am 03.08.2026 geloescht; Begruendung in
dem Arbeitsweise-Standard der Ursprungs-Werkbank. Fuer Mehr-Pruefer-Wirkung: das
Workflow-Werkzeug. **Nie so tun, als sei ein nicht vorhandenes Werkzeug gelaufen.**

## Kein Bau ohne Bestandsprüfung — und der eigene Bestand kommt zuerst

> **Anlass (03.08.2026):** An **einem Tag dreimal** neben etwas gebaut, das im eigenen Baum
> bereits lag — ein Router neben der vorhandenen Adapter-Schicht · eine Durchreichung,
> die es längst gab · ein Fähigkeiten-Regal, das unter anderem Namen existierte.

Eine Reuse-Regel, die nur nach draußen zeigt (GitHub-Suche, Library-Docs, Paketregister),
kann befolgt werden und trotzdem versagen: **keiner der drei Funde wäre durch eine
Websuche entstanden.** Der eigene Bestand kommt zuerst.

**Pflicht vor dem ersten Entwurf, in dieser Reihenfolge — erst danach nach außen:**

1. `git grep -iE "<begriff>"` im eigenen Haupt-Repo.
2. `ls` ueber die Quell-Verzeichnisse — Flächen sieht man am Verzeichnis, nicht am Suchwort.
3. Die eigene Aenderungsliste seit dem letzten Abgleich mit dem Upstream, falls es einen gibt.

**Und zwar gegen den AKTUELLEN Upstream, nicht gegen die eigene Basis.** Wer vier Wochen
hinterherhängt, durchsucht einen Bestand, den es so nicht mehr gibt — genau daran ist am
03.08. der Bauplan für den Router gescheitert.

## Warum diese Regel Prosa bleibt und kein Wächter wird [entschieden 03.08.2026]

Sie regelt **Aussagen**, nicht Handlungen — es gibt keinen Werkzeugaufruf, an dem ein
`PreToolUse`-Hook greifen könnte. Der ECC-Wächter `gateguard-fact-force.js` wurde geprüft
und abgelehnt, aus vier am Code belegten Gruenden: er markiert zuerst und blockiert danach (einmalige Bremsschwelle statt Pruefung) · in Subagenten ist er abgeschaltet · er gatet Handlungen statt Aussagen · sein Ablageort kollidiert mit dem danger-guard. Wer künftig einen
Wächter vorschlägt: diese vier zuerst entkräften.

## Sprachregeln

- **„Ich erinnere mich" ist keine Quelle.** Entweder Beleg oder die Aussage entfällt.
- **Zahlen und Widerspruchsprobe:** Sprachregel und G1 in `completeness.md` — dort das Zuhause.
- **Wenn eine Prüfung nicht möglich ist:** das sagen, statt zu schätzen.

Verwandt: [`docs/completeness-check.md`](../../../docs/completeness-check.md) *(im Paket-Rohzustand: `beileger/completeness-check.md` — das Onboarding legt sie nach `docs/`)*
· Fehlermuster F2 (gegen sich selbst geprüft, nie gegen die Quellen) und F6 (halbe Verifikation).
