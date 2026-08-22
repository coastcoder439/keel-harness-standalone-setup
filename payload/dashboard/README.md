# Dashboard

Erzeugt eine HTML-Datei: was installiert ist, ob es gesund ist, **welche Regel
wofür gilt** — und mit welchem Befehl man sie ändert.

    messen  →  strukturierte Daten (JSON)  →  rendern  →  Datei
    messen.js                                 rendern.js   zustand.js
    regeln.js

Die Trennung ist Pflicht, nicht Geschmack: Bei **Keel Light** hängt an derselben
Messung eine andere Anzeige. Getauscht wird dann `rendern.js` — an `messen.js`
ändert sich nichts. Deshalb enthält `rendern.js` keinen Dateizugriff und
`messen.js` kein einziges Wort Anzeige-Text.

## Aufruf

```bash
node dashboard/index.js                     # HTML nach ./dashboard.html
node dashboard/index.js --html <datei>      # HTML woandershin
node dashboard/index.js --json              # nur die Daten, nach stdout
node dashboard/index.js --daten <datei>     # die Daten in eine Datei
node dashboard/index.js --wurzel <pfad>     # eine andere Werkbank messen
node dashboard/index.js --mit-github        # GitHub-Abfragen zulassen (braucht Netz)
node dashboard/index.js --exit-code         # 0 = ok · 1 = Befund · 2 = nicht prüfbar
```

Ohne `--wurzel` wird aufwärts der erste Ordner mit `.claude/` gesucht. Der
Bausatz kann die Seite damit aus jedem Unterordner erzeugen.

## Die Dateien

| Datei | Rolle | Darf nicht |
|---|---|---|
| `messen.js` | misst, gibt **nur** Daten zurück | HTML, Formulierungen, Anzeige-Logik |
| `regeln.js` | zieht Regeln aus ihren **Quelldateien** | Regeln abtippen oder ergänzen |
| `rendern.js` | reines `renderHTML(daten, regeln)` | Dateien lesen, Prozesse starten |
| `zustand.js` | verdrahtet die vier Stufen | selbst messen oder darstellen |

## Gebaut wird auf dem, was da ist

Nichts davon ist neu geschrieben:

- `.ecc-src/scripts/dashboard-web.js` — `loadAgents/loadSkills/loadCommands/loadRules/loadMcps/loadHooks`, alle mit Wurzel-Argument
- `.ecc-src/scripts/operator-readiness-dashboard.js` — `buildReport()` + `parseArgs()`, direkt im Prozess
- `.claude/repo-status.js` — Sicherungsstand aller Repos, rekursiv
- `docs/workflows/anleitung-drift.js` · `eigenbau-ungesichert.js` — Exit 1 = Befund
- `.claude/session-roles.js` — gibt selbst JSON aus

## Die Regel je Bereich wird GEZOGEN, nicht abgetippt

Eine Dashboard, die Regeln nacherzählt, ist die zweite Kopie, vor der das
README des Bausatzes warnt. Deshalb kommt jede Regel mit **Datei + Zeile** aus
ihrer Quelle:

| Bereich | Regel | Quelle |
|---|---|---|
| Bestand | Werkzeug-Rangfolge · die Dauer-Regeln | `.claude/rules/keel/*.md` |
| Wächter | Werkzeugkanon | `docs/13-arbeitsweise-standard.md` §3 |
| Sicherung / Prüfer | pathspec-Pflicht + Prüfkommando | `CLAUDE.md` §5 |
| Betriebsbereitschaft | Effort-Stufen · Modellwahl je Aufgabentyp | `docs/13` §2a · `routing-policy.json` |

Welche Dauer-Regeln „unsere" sind, wird nicht behauptet, sondern bestimmt: was
in `.ecc-src/rules/common` fehlt, ist Eigenbau — dieselbe Unterscheidung, die
`eigenbau-ungesichert.js` benutzt.

**Lässt sich eine Regel nicht ziehen, steht das auf der Seite** — mit Grund, und
ohne Ersatztext. Eine erfundene Regel ist schlimmer als eine fehlende, weil sie
mit dem Anschein der Messung kommt.

## Status-Modell

`ok` · `hinweis` · `befund` · `fehlt` · `unlesbar`

**„unlesbar" wird nie zu „ok" verkürzt.** Ein Werkzeugausfall sieht sonst aus
wie ein bestandener Test — dieselbe Falle, gegen die `anleitung-drift.js` und
`eigenbau-ungesichert.js` ihre Kontrollproben haben. `--exit-code` gibt
„nicht prüfbar" (2) deshalb den **höheren** Wert als „Befund" (1).

## Kontrollproben (beide nachgestellt, beide schlagen an)

1. **Bestand** — jede Gruppe wird gegen eine unabhängige Zählung auf der Platte
   gehalten. Mit einem Loader, der 0 meldet, während 3 Dateien daliegen:
   `unlesbar · „Loader lieferte 0, auf der Platte liegen 3 Eintraege"`.
2. **Sicherung** — die Werkbank selbst muss in der Ausgabe von `repo-status.js`
   vorkommen. Mit einer Ausgabe, die sie nicht nennt (Exit 0!):
   `unlesbar · „Kontrollprobe fehlgeschlagen"` — statt eines falschen
   „0 Repos, alles gesichert".
