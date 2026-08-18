# Harness einrichten — fünf Schritte

Du hast einen Ordner bekommen. Danach hast du einen laufenden Harness und eine
Zustandsseite, die dir zeigt, was installiert ist und ob es gesund ist.

**Gebraucht wird:** Node (18 oder neuer) und Git. Sonst nichts — kein npm, keine
Toolchain, kein Bauschritt.

## Bevor du anfängst: zwei Pfade

Alle Befehle unten nennen zwei Pfade ausdrücklich. Setz sie einmal fest, dann ist es
egal, in welchem Verzeichnis du gerade stehst.

| Platzhalter | Bedeutung | Windows (Beispiel) | macOS / Linux (Beispiel) |
|---|---|---|---|
| `<PAKET>` | dieser Bausatz, so wie du ihn geklont oder entpackt hast | `C:\Users\du\Downloads\keel-harness-standalone` | `~/Downloads/keel-harness-standalone` |
| `<HARNESS>` | dein Workspace — neu und leer oder ein bestehendes Projekt | `C:\Users\du\WORKSPACES\mein-workspace` | `~/workspaces/mein-workspace` |

Regel: **`<PAKET>` liegt nicht in `<HARNESS>`, und `<HARNESS>` nicht in `<PAKET>`.**
Der Bausatz ist ein Werkzeug. Er wird von außen auf den Harness-Ordner angewendet
und ist danach entbehrlich.

Die Befehle unten geben **immer beide Pfade** an — auch `--paket <PAKET>`, obwohl der
Installer seinen Ordner selbst finden könnte. Zwei ausgeschriebene Pfade lesen auf
jedem System gleich und lassen keinen Spielraum, wo etwas landet.

> **Windows-Hinweis (Paketstand 2026-08-06):** Dort ist `--paket` derzeit nicht nur
> Konvention, sondern Pflicht — `onboarding.mjs` findet auf Windows seinen eigenen Ordner
> nicht (Zeile 53, `URL.pathname` statt `fileURLToPath`). Ohne den Schalter bricht der
> Aufruf mit Rückgabewert 2 ab: `ABBRUCH: Paket nicht gefunden (gesucht: … /C:/Users/…)`.
> Dieser Absatz entfällt nach der Korrektur in der Werkbank; die Befehle bleiben, wie sie sind.

---

## 1. Nachsehen, was drin ist

```
node -e "const p=require('<PAKET>/PAKET.json');console.log(p.posten+' Posten, gebaut '+p.gebautAm)"
```

`PAKET.json` ist die Stückliste: jede Datei mit Herkunft, Größe und Prüfsumme.
Darunter steht unter `bewusstNichtEnthalten`, **was absichtlich fehlt und warum** —
das ist kein Versehen und braucht kein Nachtragen.

## 2. Trocken laufen lassen

```
node <PAKET>/onboarding.mjs --paket <PAKET> --ziel <HARNESS> --trocken
```

Windows, ausgeschrieben:

```
node C:\Users\du\Downloads\keel-harness-standalone\onboarding.mjs --paket C:\Users\du\Downloads\keel-harness-standalone --ziel C:\Users\du\WORKSPACES\mein-workspace --trocken
```

Zeigt jeden Schritt und schreibt **nichts**. Lies die Ausgabe einmal durch. Sie
sagt dir vorab, was angelegt wird und was unangetastet bleibt.

Jede Zeile steht dabei in der Möglichkeitsform — `wuerde anlegen`, `wuerde
ersetzen`, `wuerde ergaenzen`. Der Trockenlauf meldet nie einen Vollzug: was er
zeigt, ist noch nicht passiert, und keine Zeile behauptet etwas anderes.

Achte auf Schritt **[7] CLAUDE.md**: In einem frischen `<HARNESS>` muss dort
`wuerde anlegen` stehen. Steht dort `uebersprungen`, liegt schon eine `CLAUDE.md`
im Ziel — bei einem bestehenden Projekt ist das richtig so (deine Datei bleibt),
bei einem neuen Ordner ist etwas falsch gelaufen.

## 3. Einrichten

```
node <PAKET>/onboarding.mjs --paket <PAKET> --ziel <HARNESS>
```

Der Lauf ist wiederholbar. Eine Datei, die schon da ist und abweicht, wird
**nicht** überschrieben — die neue Fassung landet als `<datei>.neu` daneben, und
der Lauf sagt es. Wer wirklich überschreiben will, hängt `--ersetzen` an.

Am Ende steht eine Liste **„Was jetzt beim Menschen liegt"**. Die ist kein
Anhang, sondern der Teil, den ein Programm nicht übernehmen darf: GitHub-Konto,
erstes Push, Schreibziele der Wächter, eigene Regeln.

Danach: `<HARNESS>/CLAUDE.md` öffnen und die **`[?]`-Platzhalter** ausfüllen —
Zweck, Beteiligte, Repo-Namen. Lieber eine offene Markierung stehen lassen als
raten; die Datei lädt in jeder Sitzung und wird als Wahrheit gelesen.

## 4. Sichern — sichtbar ist nicht gesichert

Das Onboarding setzt die `.gitignore` so, dass Git die Eigenbauten **sehen**
darf. Aufgenommen werden sie durch `git add`, gesichert erst durch Commit und
Push. Alle Befehle mit `-C <HARNESS>`, damit sie unabhängig vom aktuellen
Verzeichnis im richtigen Repo landen:

```
git -C <HARNESS> init
git -C <HARNESS> add .claude .gitignore CLAUDE.md zustand oberflaeche docs lizenzen
git -C <HARNESS> commit -m "harness: eingerichtet"
```

(`git init` nur, falls `<HARNESS>` noch kein Repo ist.) Remote-Repo unter deinem
Konto anlegen und pushen — das machst du selbst.

Bis hierhin liegt alles nur auf einer Platte. Genau dagegen ist dieser Harness
gebaut.

## 5. Neu starten — sonst ist nichts davon wirksam

**Der wichtigste Schritt, und der am leichtesten übersehene.** Alles, was hier
eingerichtet wurde — Wächter, Regeln, Statusleiste —, lädt nur beim **Start**
einer Sitzung im Harness-Ordner. Eine Sitzung, die schon lief, kennt keine
dieser Regeln.

1. Claude Code neu starten.
2. Eine Sitzung mit `<HARNESS>` als Arbeitsverzeichnis öffnen.
3. `/repo-status` aufrufen. Meldet er alle Repos als synchron, greift die
   Verdrahtung.

`<PAKET>` wird ab jetzt nicht mehr gebraucht. Behalten oder löschen — beides ist
in Ordnung; im Harness liegt nichts davon.

---

## Die Zustandsseite

Sie wird am Ende des Onboardings erzeugt und liegt als `zustand.html` in
`<HARNESS>`. Öffnen im Browser — eine einzelne Datei, keine Netzabfrage, per Mail
versendbar.

Jederzeit neu messen:

```
node <HARNESS>/zustand/zustand.js --json --daten <HARNESS>/zustand.json
node <HARNESS>/oberflaeche/befuellen.mjs <HARNESS>/oberflaeche/dist/index.html <HARNESS>/zustand.json <HARNESS>/zustand.html
```

Zwei Läufe, weil **Messung und Anzeige getrennt sind**: `zustand.js` misst und
erzeugt reine Daten, `befuellen.mjs` spritzt sie in die fertig gebaute Hülle.
Deshalb brauchst du kein npm — und deshalb lässt sich die Anzeige später
austauschen, ohne die Messung anzufassen.

## Was installiert wird

| Teil | Was es tut |
|---|---|
| **7 Wächter** | blocken zerstörende Befehle · sagen das Ziel-Repo an · erzwingen die Commit-Form · warnen vor ungesicherter Arbeit · Statusleiste |
| **4 Befehle** | `/repo-status` `/save-work` `/session-map` `/tell-session` |
| **4 Dauer-Regeln** | laden bei jedem Sitzungsstart: erst prüfen dann antworten · Vollständigkeit · Werkzeugwahl · Antwortform |
| **Skills** | Domänenmodell, Merge-Konflikte — übernommen unter MIT, Lizenzen liegen bei. *(Offen in der Werkbank: der Skill `i-have-adhd` liegt im Paket und wird von Regel und Start-Hook vorausgesetzt, aber vom Installer nicht kopiert — siehe `00-MODELL-UND-AENDERUNGEN.md`.)* |
| **`CLAUDE.md`** | die Vorlage mit `[?]`-Platzhaltern — nur, wenn im Ziel noch keine liegt |
| **Zustandsseite** | misst Bestand, Sicherung, Prüfer, Rollen — und zeigt sie |
| **Beileger** | die Nachbau-Anleitung und die zwei Langfassungen, auf die die Regeln verweisen |

**Was bewusst fehlt:** die Befehls-Freigabeliste (sie erteilte sonst
stillschweigend Rechte, die nie jemand gesehen hat), der Skill-Index eines
fremden Bestands, und ein Stop-Wächter, der ohne fremdes Material bei jedem Lauf
Alarm schlagen würde. Ein Wächter, der immer schreit, ist nach zwei Tagen
abgeschaltet — das ist schlechter als gar keiner.

## Wenn etwas nicht stimmt

| Meldung | Bedeutung |
|---|---|
| `[7] … uebersprungen` in einem **neuen** Ordner | Im Ziel lag schon eine `CLAUDE.md`. Häufigste Ursache: das Paket wurde in den Harness-Ordner kopiert. `<PAKET>` und `<HARNESS>` trennen, Ziel leeren, neu einrichten. |
| `ABWEICHEND` | Deine Fassung bleibt stehen, die neue liegt als `.neu` daneben. Vergleichen, dann entscheiden. |
| `ACHTUNG … kein git-Repo` | Nichts ist gesichert. Schritt 4 nachholen. |
| `ACHTUNG … werden von git ignoriert` | Die `.gitignore` verdeckt Eigenbauten. Der Harness-Block muss **nach** einer breiteren Regel stehen. |
| `ABBRUCH: Paket nicht gefunden` mit Suchpfad `/C:/…` (Windows) | `--paket <PAKET>` fehlt — siehe Windows-Hinweis oben. |
| Rückgabewert `1` | Eingerichtet, aber etwas braucht Aufmerksamkeit — die Punkte stehen am Ende der Ausgabe. |
| Rückgabewert `2` | **Abbruch — es ist nicht eingerichtet.** Die Meldung nennt den Grund in einer Zeile Klartext (Schreibrechte, kein Platz, Ziel unbrauchbar) und dahinter den Stand: `N von M Posten`. |
| `2` mit `N > 0` | Der Ordner ist **halb** eingerichtet. Ursache beheben, dann **denselben** Befehl erneut — er ergänzt nur das Fehlende. Nicht ignorieren: beim nächsten Lauf sieht ein halbes Ziel wie ein gewachsener Bestand aus. |

Vor dem ersten Schreibvorgang prüft das Onboarding, ob alle Zielordner
beschreibbar sind. Der häufigste Fehlerfall endet deshalb mit einem sauberen
Abbruch bei **unberührtem Ziel**, nicht mit einer Ruine. Bei einem unerwarteten
Fehler zeigt `--spur` zusätzlich, wo im Installer er entstanden ist.
