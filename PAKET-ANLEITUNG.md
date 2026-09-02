# Harness einrichten — von Hand, Schritt für Schritt

Du hast diesen Bausatz bekommen. Danach hast du einen laufenden Keel Harness
(Version 2) in einem Git-Repo deiner Wahl: Wächter, paketgebundene Arbeitsweise,
React-Dashboard, selbststartendes Onboarding.

**Gebraucht wird:** Node (≥ 20, LTS empfohlen) und Git. Sonst nichts — kein npm-Install,
keine Toolchain, kein Bauschritt. **Windows zuerst:** diese Anleitung ist auf Windows
verifiziert; macOS steht unten.

## Bevor du anfängst: zwei Pfade

Alle Befehle nennen zwei Pfade ausdrücklich. Setz sie einmal fest, dann ist es egal,
in welchem Verzeichnis du gerade stehst.

| Platzhalter | Bedeutung | Windows (Beispiel) | macOS / Linux (Beispiel) |
|---|---|---|---|
| `<PAKET>` | dieser Bausatz, wie geklont oder entpackt | `C:\Users\du\Downloads\keel-harness-v2-setup` | `~/Downloads/keel-harness-v2-setup` |
| `<HARNESS>` | dein Ziel — neu oder ein bestehendes Projekt-Repo | `C:\Users\du\WORKSPACES\mein-harness` | `~/workspaces/mein-harness` |

Regel: **`<PAKET>` liegt nicht in `<HARNESS>`, und `<HARNESS>` nicht in `<PAKET>`.**
Der Bausatz ist ein Werkzeug. Er wird von außen angewendet und ist danach entbehrlich.

## 1. Nachsehen, was drin ist

```
node -e "const m=require('<PAKET>/manifest.json');console.log(m.fileCount+' Posten, Version '+m.product.version)"
```

Ausgabe bei diesem Stand: `169 Posten, Version 1.1.0`. `manifest.json` ist die
Stückliste — jede Datei mit Herkunft, Größe und Prüfsumme; unter `excluded` steht,
was **absichtlich** fehlt und warum. `payload-provenance.json` nennt den Quell-Commit
der Payload-Erzeugung.

Der Bausatz prüft sich auch selbst:

```
node <PAKET>/checks/fresh-clone.mjs
```

endet bei gesundem Klon mit Rückgabewert 0 und der Zeile
`SETUP_REPO_OK payload=169 version=1.1.0 dry-run=ok`.

## 2. Das Ziel muss ein Git-Repo sein

Der Installer nimmt nur die **Wurzel eines echten Git-Repos** an — er schützt das
Ziel transaktional (Journal, Backups) und stellt bei Fehlern den Vorzustand wieder
her. Neuer Ordner:

```
git init -b main C:\Users\du\WORKSPACES\mein-harness
```

Bestehendes Projekt: erst ungesicherte Änderungen committen, dann weiter.

## 3. Trocken laufen lassen

```
node <PAKET>\install.mjs --target <HARNESS> --dry-run
```

Windows, ausgeschrieben:

```
node C:\Users\du\Downloads\keel-harness-v2-setup\install.mjs --target C:\Users\du\WORKSPACES\mein-harness --dry-run
```

Gemessene Ausgabe an einem frischen Ziel (Rückgabewert 0, geschrieben wird nichts):

```
keel harness distribution: command=install state=planned version=1.1.0 dry-run=true managed=173
```

`managed` ist die Zahl der Dateien, die der Installer im Ziel verwalten würde —
die Payload-Posten plus die Onboarding-Paketdateien, die er selbst anlegt.

## 4. Einrichten

```
node <PAKET>\install.mjs --target <HARNESS>
```

Gemessener Erfolg:

```
keel harness distribution: command=install state=installed version=1.1.0 promotions=173 managed=173 rollback=available
```

Der Lauf ist transaktional und wiederholbar — ein zweiter Aufruf schreibt nichts
doppelt, sondern meldet `no-op=true`. Scheitert etwas, stellt der Installer den
Vorzustand selbst wieder her und sagt den Grund; nur nach einem Absturz mitten im
Lauf vollendet

```
node <PAKET>\install.mjs rollback --target <HARNESS>
```

dieselbe Wiederherstellung aus dem Journal.

Optional, nur wenn du das offizielle Codex-Plugin (projektbezogen) willst:
`--install-codex-plugin` anhängen. Ohne den Schalter führt der Installer kein
externes Kommando aus.

## 5. Prüfen

```
node <PAKET>\install.mjs status --target <HARNESS>
```

Gemessen: `keel harness distribution: command=status state=installed managed=173`.
`doctor` statt `status` prüft zusätzlich die Integrität der verwalteten Dateien.

Der installierte Harness bringt eigene Prüfungen mit — im `<HARNESS>`-Ordner:

```
node checks/run-all.mjs
```

(installierter Vertrag, Dashboard-Runtime, volle Unlazy-Suite — dauert mehrere
Minuten). Das Dashboard startet mit `npm run dashboard` lokal auf `127.0.0.1`;
die Adresse steht in der Ausgabe.

## 6. Sichern — sichtbar ist nicht gesichert

```
git -C <HARNESS> add -A
git -C <HARNESS> commit -m "harness: installiert"
```

Die installierte `.gitignore` hält Laufzeit-Zustand (`.unlazy/`, lokale Settings)
heraus. Remote-Repo unter deinem Konto anlegen und pushen — das machst du selbst.
Bis dahin liegt alles nur auf einer Platte; genau dagegen ist dieser Harness gebaut.

## 7. Neu starten — sonst ist nichts davon wirksam

Alles Eingerichtete — Wächter, Regeln, Statusleiste — lädt nur beim **Start** einer
Session im Harness-Ordner.

1. Claude Code neu starten.
2. Session mit `<HARNESS>` als Arbeitsverzeichnis öffnen.
3. Dort beginnt das **Onboarding von selbst**: der Hook `.claude/onboarding-start.js`
   setzt `/onboarding` ab, solange `docs/harness-instance.md` noch die Pflicht-Marke
   `[AUSFUELLEN]` trägt. Der Agent füllt die Instanzdatei mit dir aus — Projektsprache,
   Owner-Rolle, Schreibwurzeln, GitHub-Remote. Du wirst gefragt, du tippst nichts von
   dir aus.

`<PAKET>` wird ab jetzt nicht mehr gebraucht. Behalten oder löschen — beides ist in
Ordnung; in `<HARNESS>` liegt nichts vom Bausatz.

---

## macOS — folgt

Windows ist die Prämisse dieser Auslieferung und der einzige verifizierte Weg.
Installer und Payload sind pfad-neutral geschrieben, aber auf macOS **nicht
verifiziert**. Die plattformneutrale Härtung samt Mac-Abnahme läuft als eigenes
Arbeitspaket in der Werkbank: `harness-lab`, Paket `new-harness-portability`.
Sobald es geschlossen ist, bekommt dieser Abschnitt die Mac-Schritte.

## Wenn etwas nicht stimmt

| Meldung / Lage | Bedeutung |
|---|---|
| `target has no .git directory or .git file marker` | Schritt 2 fehlt — das Ziel ist kein Git-Repo. `git init`, dann denselben Befehl erneut. |
| Rückgabewert ≠ 0 bei `install` | **Nicht eingerichtet.** Die Meldung nennt den Grund; der Installer hat den Vorzustand selbst wiederhergestellt. Ursache beheben, denselben Befehl erneut. |
| Absturz mitten im Lauf (Stromausfall, Abbruch) | Journal und Quarantäne liegen noch da. `rollback --target <HARNESS>` vollendet die Wiederherstellung. |
| `payload integrity mismatch: …` | Der Bausatz-Klon ist verändert (häufigste Ursache: Zeilenenden-Konvertierung oder Handänderung in `payload/`). Frisch klonen, `node <PAKET>/checks/fresh-clone.mjs` muss 0 liefern. |
| `install`/`uninstall` verweigert wegen laufender Dashboard-Lease | Im Ziel läuft das Dashboard. Prozess beenden, dann erneut. |
| `doctor` meldet Drift | Verwaltete Dateien wurden nachträglich geändert. Erst lesen, was abweicht; `--force` bei `uninstall` ist der ausdrückliche Weg, Backups über spätere Änderungen zu stellen — keine Standardoption. |
| Zweiter `install`-Lauf | Kein Fehler: `no-op=true`, es wird nichts doppelt geschrieben. |
