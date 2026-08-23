# Das Dashboard

Ein Aufruf, eine Datei:

```bash
node dashboard/index.js --html dashboard.html
```

Die erzeugte Seite ist **ein Stand, kein Quelltext** — sie steht in der
`.gitignore` und entsteht bei jedem Aufruf neu. Wer sie weitergibt, gibt eine
Momentaufnahme weiter; wer den Harness weitergibt, gibt den Erzeuger weiter.

## Die vier Stufen

```
  messen                 →  Daten (JSON)  →  anzeigen        →  Datei
  measure.js                                 render/data.js     dashboard.html
  + inventar.js                              render/shell.js
  + hooks-detail.js                          render/client/*
  + zutun-docs.js
  + verwandt.js
  rules.js
```

**Messung und Anzeige bleiben getrennt.** `measure.js` und die vier Mess-Module
enthalten kein einziges Wort Oberflächen-Text — wo eine Formulierung nötig wäre,
steht ein sprachneutraler Code (`rolle`, `quelle`, `gesperrt`, `fehler.code`).
Den Satz dazu setzt `render/worte.js`. Wer das aufhebt, muss jede Beschriftung
an zwei Orten pflegen, und einer davon veraltet.

Umgekehrt liest kein Modul unter `render/` eine Datei oder startet einen
Prozess. Deshalb lässt sich die Anzeige austauschen, ohne die Messung
anzufassen.

## Die Dateien

| Datei | Aufgabe | was dort NICHT hingehört |
|---|---|---|
| `index.js` | verdrahtet die Stufen, schreibt die Datei, führt den Ausgabe-Wächter | selbst messen oder darstellen |
| `measure.js` | misst Kontext, Bestand, Sicherung, Verlauf | HTML, Formulierungen |
| `inventar.js` | der Dateibaum: Rolle, Beschreibung, Inhalt, Git-Stand | Anzeige-Logik |
| `zugangsfilter.js` | was aus einer Datei **nicht** in die Seite darf | alles andere |
| `hooks-detail.js` | Hooks aus `settings.json`, mit Zeilenbelegen | Bewertung |
| `zutun-docs.js` | offene Punkte, aus Dokumenten gezogen | eigene Meinung dazu |
| `verwandt.js` | Verknüpfungen zwischen Einträgen, jede mit Beleg | Kanten ohne Fundort |
| `rules.js` | zieht Regeln aus ihren Quelldateien | Regeln abtippen |
| `classify.js`, `inventory.js` | Altbestand aus der Vorfassung | — |
| `render/worte.js` | **der einzige Ort deutscher Beschriftungen** | Logik |
| `render/data.js` | baut den einen Eintrags-Index; letzter Riegel gegen Zugänge | Dateizugriff |
| `render/styles.js` | das Stylesheet — und der Klassenvertrag | — |
| `render/icons.js` | die Symbole | — |
| `render/markdown.js` | Markdown → HTML, ohne Bibliothek | — |
| `render/shell.js` | das HTML-Gerüst, Escaping, Daten-Einbettung | — |
| `render/client/*.js` | vier Teile, die im **Browser** laufen | `require`, `module`, Backticks |

## Drei Riegel gegen Zugänge

Die Seite bettet Dateiinhalte ein. Die Quelle ist das Dateisystem — also etwas,
das niemand kontrolliert.

1. **Sperre** — git-ignorierte Dateien und alles, was nach Zugang *heißt*
   (`.env*`, `*.key`, `*.pem`, `settings.local.json`, …) wird nie eingebettet,
   nur Metadaten.
2. **Zeilenfilter** — `textSichern()` läuft über jeden Text, der in den
   Datensatz geht, und ersetzt verdächtige Zeilen. Ein privater Schlüssel fällt
   als ganzer Block, ein angekündigter Wert in der Folgezeile fällt mit.
3. **Ausgabe-Wächter** — `index.js` prüft die **fertige** Seite, bevor sie
   geschrieben wird. Bei Verdacht wird **keine Datei** geschrieben: eine halbe
   Warnung neben einer geschriebenen Datei mit einem Zugang darin hilft niemandem.

Alle drei benutzen dieselbe Liste aus `zugangsfilter.js` — eine Kopie wäre ein
zweiter Stand.

**Die Messlatte dabei:** ein Filter, der Richtiges unkenntlich macht, wird
abgeschaltet und schützt danach gar nichts. Deshalb führt
`test/zugangsfilter.test.js` zwei Tabellen — was fallen **muss** und was stehen
bleiben **muss**. Eine Verschärfung ohne ihre Gegenprobe zählt nicht.

## Prüfen

```bash
node --test dashboard/test/
```

Jedes Modul hat einen Test; `test/vollstaendigkeit.test.js` prüft genau das —
und dass keins über 800 Zeilen wächst oder etwas lädt, das es nicht gibt.
Ausnahmen stehen dort mit Grund im Klartext.

## Was wo festgelegt ist

| Frage | Ort |
|---|---|
| Wie es aussehen und was es können soll | [`docs/dashboard-spec.md`](../docs/dashboard-spec.md) — 87 Akzeptanzkriterien |
| Welche Wörter die Oberfläche benutzt | `render/worte.js` — und die verbotenen dazu |
| Welche Punkte der Auftraggeber entschieden hat | [`docs/dashboard-entscheidungen.md`](../docs/dashboard-entscheidungen.md) |
| Was noch offen ist | [`docs/regelverstoesse-plan.md`](../docs/regelverstoesse-plan.md) |

## Aufrufe

```bash
node dashboard/index.js                      # nach ./dashboard.html
node dashboard/index.js --html <datei>       # woandershin
node dashboard/index.js --json               # nur die Daten, nach stdout
node dashboard/index.js --daten <datei>      # die Daten in eine Datei
node dashboard/index.js --wurzel <pfad>      # eine andere Werkbank messen
node dashboard/index.js --exit-code          # 0 ok · 1 Befund · 2 nicht prüfbar
```

Ohne `--exit-code` ist die Rückgabe immer 0 (die Seite ist erzeugt). Mit
`--exit-code` bekommt „nicht prüfbar" den **höheren** Wert als „Befund": ein
Werkzeugausfall darf nie milder aussehen als ein Fund.
