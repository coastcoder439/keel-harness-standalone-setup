# Vollständigkeit — wann etwas wirklich fertig ist

> Quelle und Begründung (mit Beweislage): `docs/11-vollstaendigkeitspruefung.md` im
> Werkbank-Repo. Diese Datei ist die operative Kurzfassung, die in jeder Session geladen wird.
> Anlass: mehrfach „fertig" gemeldet, während hunderte Lücken offen waren.

## Sprachregel (gilt sofort, in jeder Antwort)

- **„Fertig" ist als Selbstauskunft verboten.** Erlaubt: *„Geprüft gegen ⟨Quellen⟩ — offen ist ⟨Liste⟩."*
  Ist die Liste leer, nenne die geprüften Fragen, nicht das Wort.
- **Zahlen beim Schreiben messen, nicht erinnern.** Wo eine Zahl altert, den Befehl danebenschreiben —
  und zwar **den, der die Zahl erzeugt hat**. Gefiltert gemessen und ungefiltert zitiert heißt: wer
  nachtippt, bekommt etwas anderes, und der Beleg wirkt falsch, obwohl er trägt. Passen beide nicht
  zusammen, **beide Zahlen nennen** („acht Treffer, davon null Schema-Objekte") statt filtern.
- **Behauptung ohne Gegenprobe ist eine halbe Prüfung.** „X ist so" braucht „und das wäre anders, wenn Y".
- **Ein Warnkasten ersetzt keine Korrektur.** Wer „überholt" markiert, aber den Fließtext stehen lässt,
  hat nur den Ort markiert.
- **Eine Berichtigung wird selbst belegt.** Einen *gemeldeten* Fehler vor dem Beheben **selbst an der
  Quelle prüfen** — eine falsche Berichtigung ist schädlicher als der Fehler, den sie behebt, weil sie
  mit dem Anschein der Prüfung kommt.

## Die acht Fragen (Definition von bau-fertig)

Solange **eine** offen ist, ist es nicht fertig:

1. **Akteure** — jede Menschen-Rolle *und* jede Agenten-Art auf jeder Fläche, **inklusive „darf nicht"**.
2. **Lebenszyklus** — entstehen · einrichten · benutzen · ändern · scheitern · **übergeben · beenden · abbauen**.
   *(Die letzten drei sind der häufigste blinde Fleck.)*
3. **Governance je Fähigkeit** — wer darf · wer sieht · wo ist der Einstellungs-Ort · **was wird protokolliert** · wer nimmt ab.
4. **Versprechen** — jeder Anspruch aus Auftrag/Vision ist zugeordnet, terminiert **oder** begründet verworfen.
   „Wird erwähnt" ist keins von dreien. **Halb zugeordnet rutscht am leichtesten durch**, weil die Zeile
   schon ein Paket nennt: Maschinerie gebaut, Inhalt fehlt → beide Zustände in **dieselbe** Zeile. Ort
   zugeordnet, aber ein absolutes Wort darin (*einzige, jede, immer, ohne, vollständig*) ungemessen →
   das braucht ein **Abnahmekriterium**, sonst muss das Wort weg. Eine dritte Möglichkeit gibt es nicht.
5. **Belege** — jede Aussage über fremden Code am Code belegt, mit Gegenprobe.
6. **Fehlerfall** — Abbruch, Ausfall, Zeitüberschreitung, verschwundener Akteur.
7. **Folgepflichten** — erzeugt die Entscheidung eine Pflicht (aufräumen, migrieren, überwachen)?
   Ist **die Pflicht selbst geplant**? Sonst ist es verschoben, nicht entschieden.
8. **Widerspruchsfreiheit** — kein Dokument gegen ein anderes, kein Fließtext gegen seinen Warnkasten.

## Die drei Gegenproben — vor **jeder** Entscheidung

- **G1 Widerspruchsprobe** — widerspricht das einem Versprechen oder einer früheren Entscheidung?
  *Nachsehen, nicht erinnern.*
- **G2 Achsenprobe** — presse ich zwei unabhängige Fragen in eine Antwort? *Test: gibt es einen realen Fall,
  in dem das eine gilt und das andere nicht? Dann sind es zwei Entscheidungen.*
- **G3 Folgepflichtprobe** — was muss **danach dauerhaft** getan werden, damit das trägt? Wer tut es?
  Ist das geplant, oder habe ich gerade eine Waise erzeugt?
- **G4 Messbarkeitsprobe** — verlasse ich mich auf eine **Beurteilung**, wo eine **Eigenschaft**
  prüfbar wäre? *Test: der Beurteilende irrt oder ist unterwandert — bleibt eine Schranke?*
  Wenn nein, muss die Zusage strukturell werden. Gilt besonders für alles, was **ohne Menschen** wirkt.

## Quellen-Rangfolge (gegen den häufigsten Prüffehler)

Eine Vollständigkeits-Aussage ist nur so viel wert wie die **oberste** Ebene, gegen die geprüft wurde.
Wer nur „Umsetzung gegen Code" prüft, findet nie ein vergessenes Versprechen.

**Auftrag** (Vision, Marke) → **Produktbild** (Zielbild) → **Umsetzung** (Pläne) → **Wahrheit** (Quellcode)
→ **Nachbarn** (Parallel-Sitzungen) → **Historie** (Gedächtnis, Korrektur-Logs) → **Zuständigkeit** (Rollen).

## Werkzeuge

| Zweck | Aufruf |
|---|---|
| Holistische Prüfung (Inventur → sechs Matrizen → adversarische Gegenprüfung) | als Workflow bauen: parallele Prüfer je Matrix, danach Gegenprüfung |
| Bestätigte Funde einarbeiten (sequenziell nach Themen + Nachlese) | als Workflow bauen: je Thema ein Einarbeiter, am Ende eine Nachlese |

**Wann geprüft wird:** vor jeder „bau-bereit"-Aussage · nach jeder größeren Ergänzung ·
vor jeder Übergabe an eine andere Sitzung. Danach erneut, bis die Matrizen leer bleiben.

**Warum matrixbasiert:** Dokumente lesen und hoffen, dass etwas auffällt, hat hier dreimal versagt.
Eine **leere Matrix-Zelle ist ein Verdacht** — das findet, was niemand vermisst hat.
