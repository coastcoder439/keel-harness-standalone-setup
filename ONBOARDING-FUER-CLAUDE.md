<!-- Von Hand angelegt 2026-08-18 auf Basis von Werkbank e165ec6. Ersetzt die Paket-CLAUDE.md. In die Werkbank zurueckfuehren, sonst ueberschreibt der Generator sie. -->

# Onboarding-Anweisung für eine Claude-Code-Session

Diese Datei ist **keine `CLAUDE.md`** und lädt sich nicht selbst. Ein Mensch legt sie
dir vor, etwa so:

> Lies `<PAKET>/ONBOARDING-FUER-CLAUDE.md` und richte den Harness in `<HARNESS>` ein.

Sie gilt für genau diese Sitzung — **egal, in welchem Ordner die Sitzung läuft.**

## Deine Aufgabe

Den Harness aus dem Paket `<PAKET>` in den Harness-Ordner `<HARNESS>` installieren,
gemeinsam mit dem Menschen. Du baust nichts anderes, du änderst das Paket nicht.

Zwei Pfade, die du vor dem ersten Befehl kennen musst:

| | Woher | Regel |
|---|---|---|
| `<PAKET>` | der Ordner, in dem diese Datei liegt | wird nur gelesen |
| `<HARNESS>` | nennt dir der Mensch | der einzige Ort, an dem du schreibst |

## Das Onboarding-Gespräch

Der Reihe nach. Kein Schritt wird übersprungen, keiner vorweggenommen. Jeder Befehl
nennt beide Pfade ausdrücklich — nichts hängt vom aktuellen Verzeichnis ab.

1. **Harness-Ordner bestätigen.** Frage, ob `<HARNESS>` ein bestehendes Projekt oder ein
   neuer Workspace ist, und lass dir den Pfad bestätigen. Prüfe dann selbst:
   - `<PAKET>` liegt **nicht** innerhalb von `<HARNESS>` und `<HARNESS>` nicht innerhalb
     von `<PAKET>`. Ist das doch so: **Stopp**, dem Menschen sagen, keinen Ausweg
     improvisieren. (Ein Paket im Harness-Ordner hinterlässt Installer, Vorlagen und
     Stückliste dauerhaft im Workspace und verhindert, dass die echte `CLAUDE.md`
     angelegt wird.)
   - Liegt in `<HARNESS>` schon eine `CLAUDE.md`? Dann sag es jetzt: das Onboarding wird
     sie **nicht** anfassen (Schritt [7] „nur wenn keine da ist"), und Schritt 5 unten
     entfällt oder wird zur Handarbeit.

2. **Git-Stand von `<HARNESS>`.** Ist es ein Repo, zeig `git -C <HARNESS> status`. Ist der
   Stand nicht gesichert, lass zuerst sichern (committen oder stashen) — nicht selbst
   entscheiden, was verworfen wird. Ist es kein Repo, sag das; `git init` kommt in
   Schritt 6.

3. **Trockenlauf:**
   ```
   node <PAKET>/onboarding.mjs --paket <PAKET> --ziel <HARNESS> --trocken
   ```
   Zeig dem Menschen die Ausgabe. Weise ausdrücklich auf Schritt **[7] CLAUDE.md** hin
   (`wuerde anlegen` oder `uebersprungen`). Warte auf ein Go, bevor du weitermachst.

4. **Echtlauf:**
   ```
   node <PAKET>/onboarding.mjs --paket <PAKET> --ziel <HARNESS>
   ```
   Rückgabewert `0`: weiter. `1`: eingerichtet, die offenen Punkte am Ende der Ausgabe
   dem Menschen zeigen, dann weiter. `2`: **Abbruch** — die Meldung wörtlich zeigen,
   samt „N von M Posten", nicht improvisieren, keinen eigenen Reparaturversuch starten.

5. **`[?]`-Platzhalter ausfüllen.** In `<HARNESS>/CLAUDE.md` stehen `[?]`-Platzhalter
   (Zweck, Beteiligte, Repo-Namen, offene Punkte). Fülle sie **gemeinsam** mit dem
   Menschen aus — frag nach, rate nicht. Was der Mensch nicht beantworten will, bleibt
   als `[?]` stehen; das ist besser als eine geratene Angabe.

6. **Sichern — in `<HARNESS>`, per `git -C`:**
   ```
   git -C <HARNESS> init            # nur, falls noch kein Repo
   git -C <HARNESS> add .claude .gitignore CLAUDE.md zustand oberflaeche docs lizenzen
   git -C <HARNESS> commit -m "harness: eingerichtet"
   ```
   Ein Remote anlegen und pushen ist Sache des Menschen, nicht deine. Sag ihm, dass bis
   dahin alles nur auf einer Platte liegt.

7. **Abschluss ansagen.** Alles Installierte lädt erst beim **Start** einer Sitzung in
   `<HARNESS>`. Deshalb:
   - Claude Code neu starten,
   - eine Sitzung mit `<HARNESS>` als Arbeitsverzeichnis öffnen (läuft diese Sitzung
     schon dort: einfach dieselbe neu öffnen),
   - dort `/repo-status` ausführen — das ist der eingerichtete Harness.

   `<PAKET>` wird ab jetzt nicht mehr gebraucht; behalten oder löschen ist dem
   Menschen überlassen. Im Harness liegt nichts davon.

## Grenzen

- Lesen nur in `<PAKET>` und `<HARNESS>`, schreiben nur in `<HARNESS>`. Nichts
  außerhalb, auch nicht „nur kurz".
- Keine Secrets abfragen, keine Zugänge in Dateien.
- Bricht `onboarding.mjs` ab: Fehlermeldung wörtlich zeigen, nicht improvisieren, keinen
  eigenen Reparaturversuch.
- Das Paket bleibt, wie es ist. Fällt dir ein Fehler im Paket auf, sag es dem Menschen —
  Änderungen gehören in die Werkbank, nicht in `<PAKET>` und nicht in `<HARNESS>`.

## Windows-Hinweis (Paketstand 2026-08-06)

`onboarding.mjs` findet auf Windows seinen eigenen Ordner nicht (Zeile 53,
`URL.pathname` statt `fileURLToPath`). Die Befehle oben geben deshalb `--paket <PAKET>`
immer mit an. Nach der Korrektur in der Werkbank wird der Schalter optional; die
Anweisung behält ihn, weil zwei ausgeschriebene Pfade auf jedem System gleich lesen.
