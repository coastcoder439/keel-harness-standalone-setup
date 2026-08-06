# Harness einrichten — fünf Schritte

Du hast einen Ordner bekommen. Danach hast du einen laufenden Harness und eine
Zustandsseite, die dir zeigt, was installiert ist und ob es gesund ist.

**Gebraucht wird:** Node (18 oder neuer) und Git. Sonst nichts — kein npm, keine
Toolchain, kein Bauschritt.

---

## 1. Nachsehen, was drin ist

```bash
cd <paket-ordner>
node -e "const p=require('./PAKET.json');console.log(p.posten+' Posten, gebaut '+p.gebautAm)"
```

`PAKET.json` ist die Stückliste: jede Datei mit Herkunft, Größe und Prüfsumme.
Darunter steht unter `bewusstNichtEnthalten`, **was absichtlich fehlt und warum** —
das ist kein Versehen und braucht kein Nachtragen.

## 2. Trocken laufen lassen

```bash
node onboarding.mjs --ziel /pfad/zu/deinem/workspace --trocken
```

Zeigt jeden Schritt und schreibt **nichts**. Lies die Ausgabe einmal durch. Sie
sagt dir vorab, was angelegt wird und was unangetastet bleibt.

Jede Zeile steht dabei in der Möglichkeitsform — `wuerde anlegen`, `wuerde
ersetzen`, `wuerde ergaenzen`. Der Trockenlauf meldet nie einen Vollzug: was er
zeigt, ist noch nicht passiert, und keine Zeile behauptet etwas anderes.

## 3. Einrichten

```bash
node onboarding.mjs --ziel /pfad/zu/deinem/workspace
```

Der Lauf ist wiederholbar. Eine Datei, die schon da ist und abweicht, wird
**nicht** überschrieben — die neue Fassung landet als `<datei>.neu` daneben, und
der Lauf sagt es. Wer wirklich überschreiben will, hängt `--ersetzen` an.

Am Ende steht eine Liste **„Was jetzt beim Menschen liegt"**. Die ist kein
Anhang, sondern der Teil, den ein Programm nicht übernehmen darf: GitHub-Konto,
erstes Push, Schreibziele der Wächter, eigene Regeln.

## 4. Sichern — sichtbar ist nicht gesichert

Das Onboarding setzt die `.gitignore` so, dass Git die Eigenbauten **sehen**
darf. Aufgenommen werden sie durch `git add`, gesichert erst durch Commit und
Push:

```bash
cd /pfad/zu/deinem/workspace
git init                       # falls noch kein Repo
git add .claude .gitignore CLAUDE.md zustand oberflaeche docs
git commit -m "harness: eingerichtet"
# Remote-Repo unter deinem Konto anlegen und pushen — das machst du selbst
```

Bis hierhin liegt alles nur auf einer Platte. Genau dagegen ist dieser Harness
gebaut.

## 5. Neu starten — sonst ist nichts davon wirksam

**Der wichtigste Schritt, und der am leichtesten übersehene.** Alles, was hier
eingerichtet wurde — Wächter, Regeln, Statusleiste —, lädt nur beim **Start**
einer Sitzung. Die Sitzung, in der du das Onboarding ausgeführt hast, kennt
keine dieser Regeln.

1. Claude Code neu starten.
2. Eine Sitzung mit deinem Workspace als Arbeitsverzeichnis öffnen.
3. `/repo-status` aufrufen. Meldet er alle Repos als synchron, greift die
   Verdrahtung.

---

## Die Zustandsseite

Sie wird am Ende des Onboardings erzeugt und liegt als `zustand.html` in deinem
Workspace. Öffnen im Browser — eine einzelne Datei, keine Netzabfrage, per Mail
versendbar.

Jederzeit neu messen:

```bash
node zustand/zustand.js --json --daten zustand.json
node oberflaeche/befuellen.mjs oberflaeche/dist/index.html zustand.json zustand.html
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
| **3 Skills** | Domänenmodell, Merge-Konflikte, Antwortform (`i-have-adhd`) — übernommen unter MIT, Lizenzen liegen im Paket |
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
| `ABWEICHEND` | Deine Fassung bleibt stehen, die neue liegt als `.neu` daneben. Vergleichen, dann entscheiden. |
| `ACHTUNG … kein git-Repo` | Nichts ist gesichert. Schritt 4 nachholen. |
| `ACHTUNG … werden von git ignoriert` | Die `.gitignore` verdeckt Eigenbauten. Der Harness-Block muss **nach** einer breiteren Regel stehen. |
| Rückgabewert `1` | Eingerichtet, aber etwas braucht Aufmerksamkeit — die Punkte stehen am Ende der Ausgabe. |
| Rückgabewert `2` | **Abbruch — es ist nicht eingerichtet.** Die Meldung nennt den Grund in einer Zeile Klartext (Schreibrechte, kein Platz, Ziel unbrauchbar) und dahinter den Stand: `N von M Posten`. |
| `2` mit `N > 0` | Der Ordner ist **halb** eingerichtet. Ursache beheben, dann **denselben** Befehl erneut — er ergänzt nur das Fehlende. Nicht ignorieren: beim nächsten Lauf sieht ein halbes Ziel wie ein gewachsener Bestand aus. |

Vor dem ersten Schreibvorgang prüft das Onboarding, ob alle Zielordner
beschreibbar sind. Der häufigste Fehlerfall endet deshalb mit einem sauberen
Abbruch bei **unberührtem Ziel**, nicht mit einer Ruine. Bei einem unerwarteten
Fehler zeigt `--spur` zusätzlich, wo im Installer er entstanden ist.
