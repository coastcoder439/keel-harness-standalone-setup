# Harness einrichten — von Hand, Schritt für Schritt

Du hast diesen Bausatz bekommen. Danach hast du einen laufenden Keel Harness
(Version 2) in einem Git-Repo deiner Wahl: Wächter, paketgebundene Arbeitsweise,
React-Dashboard, selbststartendes Onboarding — für Claude Code **und** für Codex.

**Gebraucht wird:** Node ≥ 20 (LTS empfohlen) und Git. Sonst nichts — kein npm-Install,
keine Toolchain, kein Bauschritt. Ist Node zu alt, brechen alle Prüfer und Skripte
dieses Bausatzes sofort mit `NODE_TOO_OLD` ab und schreiben nichts.

**Windows zuerst:** diese Anleitung ist auf Windows verifiziert. macOS steht am Ende
als ausdrücklich **nicht verifizierte** Variante.

## Bevor du anfängst: zwei Pfade

Alle Befehle nennen zwei Pfade ausdrücklich. Setz sie einmal fest, dann ist es egal,
in welchem Verzeichnis du gerade stehst.

| Platzhalter | Bedeutung | Windows (Beispiel) |
|---|---|---|
| `<PAKET>` | dieser Bausatz, wie geklont oder entpackt | `C:\w\keel-harness-standalone-setup` |
| `<HARNESS>` | dein Ziel — neu oder ein bestehendes Projekt-Repo | `C:\w\mein-harness` |

Regel: **`<PAKET>` liegt nicht in `<HARNESS>`, und `<HARNESS>` nicht in `<PAKET>`.**
Der Bausatz ist ein Werkzeug. Er wird von außen angewendet und ist danach entbehrlich.

### Windows und PowerShell

Die Befehle unten stehen in der neutralen Form `node <PAKET>\install.mjs …`. In
PowerShell setzt du die zwei Pfade am bequemsten als Variablen — dann sind alle
weiteren Befehle wörtlich übertragbar:

```powershell
$PAKET   = "C:\w\keel-harness-standalone-setup"
$HARNESS = "C:\w\mein-harness"
node $PAKET\install.mjs --target $HARNESS --dry-run
```

Vier Windows-Eigenheiten, die sonst Zeit kosten:

- **`&&` gibt es in Windows PowerShell 5.1 nicht.** Befehle einzeln ausführen oder mit
  `;` trennen und mit `if ($?) { … }` verketten. In der Eingabeaufforderung (`cmd.exe`)
  und in PowerShell 7 funktioniert `&&`.
- **Kurze Zielpfade wählen.** Die Auslieferung bringt tief geschachtelte Dateien mit
  (`vendor/`), und das Dashboard entpackt sein Laufzeit-Archiv nach
  `.keel-harness/runtime/dashboard/`. Liegt `<HARNESS>` schon tief im Dateibaum, reißt
  die alte 260-Zeichen-Grenze (MAX_PATH) mitten im Schreiben — sichtbar als `ENOENT`
  oder `ENAMETOOLONG` an einer Datei, die es offensichtlich gibt.
- **Ausweg, wenn der Pfad nicht kürzer werden kann:** ein Laufwerksbuchstabe auf den
  langen Pfad, dann von dort arbeiten — `subst B: C:\ein\sehr\langer\pfad`, danach
  `B:\mein-harness` als `<HARNESS>`. (Alternativ Win32-Langpfade in Windows aktivieren.)
- **In `node -e "…"`-Einzeilern Schrägstriche benutzen.** In einer JavaScript-Zeichenkette
  ist der Rückstrich ein Escape-Zeichen: `'C:\Users\du'` verliert stillschweigend Teile
  des Pfades. `'C:/Users/du'` funktioniert unter Windows genauso.

## 1. Nachsehen, was drin ist — und ob der Bausatz heil ist

```
node <PAKET>\checks\run-all.mjs
```

Der Lauf prüft die Node-Untergrenze, die Herkunft der Auslieferung, diese Anleitung
gegen den tatsächlichen Bestand und macht einen Trockenlauf des Installers gegen ein
Wegwerf-Repo. Gemessener Erfolg (Rückgabewert 0), letzte Zeile:

```
SETUP_REPO_SUITE_OK payload=592 version=1.3.8
```

Wer nur den Installer-Teil will: `node <PAKET>\checks\fresh-clone.mjs` endet bei
gesundem Klon mit `SETUP_REPO_OK payload=592 version=1.3.8 dry-run=ok`.

`manifest.json` ist die Stückliste — jede Datei mit Herkunft, Größe und Prüfsumme;
unter `excluded` steht, was **absichtlich** fehlt (unten als Tabelle).
`payload-provenance.json` nennt den Quell-Commit der Payload-Erzeugung.

## 2. Das Ziel muss ein Git-Repo sein

Der Installer nimmt nur die **Wurzel eines echten Git-Repos** an — er schützt das
Ziel transaktional (Journal, Backups) und stellt bei Fehlern den Vorzustand wieder
her. Neuer Ordner:

```
git init -b main C:\w\mein-harness
```

Bestehendes Projekt: erst ungesicherte Änderungen committen, dann weiter.

> **Windows-Pfadlaenge:** Waehle eine KURZE Installationswurzel (z. B. `C:\harness`).
> Ab etwa 158 Zeichen Wurzelpfad reisst der Start der Dashboard-Runtime an der
> Windows-MAX_PATH-Grenze mit einem irrefuehrenden ENOENT auf node.exe ab
> (gemessen: Wurzel mit 146 Zeichen laeuft, mit 161 Zeichen scheitert sie).

## 3. Trocken laufen lassen

```
node <PAKET>\install.mjs --target <HARNESS> --dry-run
```

Windows, ausgeschrieben:

```
node C:\w\keel-harness-standalone-setup\install.mjs --target C:\w\mein-harness --dry-run
```

Gemessene Ausgabe an einem frischen Ziel (Rückgabewert 0, geschrieben wird nichts):

```
keel harness distribution: command=install state=planned version=1.3.8 dry-run=true managed=596
```

`managed=` ist die Zahl der Dateien, die der Installer im Ziel verwalten würde —
die Payload-Posten plus die Onboarding-Paketdateien, die er selbst anlegt. Die Zahl
in dieser Anleitung wird bei jedem Prüflauf gegen den echten Trockenlauf gehalten
(`checks/fresh-clone.mjs`).

## 4. Einrichten

```
node <PAKET>\install.mjs --target <HARNESS>
```

Gemessener Erfolg:

```
keel harness distribution: command=install state=installed version=1.3.8 promotions=595 managed=596 rollback=available
```

Der Lauf ist transaktional und wiederholbar — ein zweiter Aufruf schreibt nichts
doppelt, sondern meldet `no-op=true`. Scheitert etwas, stellt der Installer den
Vorzustand selbst wieder her und sagt den Grund; nur nach einem Absturz mitten im
Lauf vollendet

```
node <PAKET>\install.mjs rollback --target <HARNESS>
```

dieselbe Wiederherstellung aus dem Journal.

## 5. Die Codex-Route — was ohne dein Zutun schon dabei ist

Der Harness ist **nicht** Claude-Code-only. Installiert werden immer beide Wege:

- `CLAUDE.md` und `AGENTS.md` im Ziel sind **bytegleich**. Es gibt genau einen
  Hostvertrag; Claude Code liest ihn als `CLAUDE.md`, Codex als `AGENTS.md`. Kein
  zweiter Stand, der auseinanderlaufen könnte — ein Prüfer misst die Gleichheit.
- `.codex/` bringt die Codex-Seite der Wächter mit: `.codex/hooks.json` verdrahtet sie,
  `.codex/config.toml` trägt die Projekteinstellung, die Guards liegen als `.cjs` daneben.
  `.codex/hooks.json` wird beim Installieren **gemischt**, nicht überschrieben — eine
  vorhandene Codex-Konfiguration im Ziel bleibt erhalten.
- `.agents/` hält die providerneutralen Regeln und Skills, die beide Seiten lesen.

Nichts davon ruft ein fremdes Kommando auf. **Optional** und nur auf ausdrücklichen
Wunsch installiert der Installer zusätzlich das offizielle Codex-Plugin für Claude
Code, ausschließlich projektbezogen:

```
node <PAKET>\install.mjs --target <HARNESS> --install-codex-plugin
```

Ohne diesen Schalter wird das Plugin nur **deklariert** — es läuft kein externes
Kommando, es wird nichts an deiner Benutzer- oder globalen Konfiguration geändert.
Mit dem Schalter installiert der Installer ausschließlich projektbezogen; scheitert
er dabei, macht er den Plugin-Teil mit den umgekehrten projektbezogenen Kommandos
rückgängig, bevor er die verwalteten Dateien wiederherstellt.

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

1. Claude Code neu starten (für die Codex-Route: eine neue Codex-Sitzung).
2. Session mit `<HARNESS>` als Arbeitsverzeichnis öffnen.
3. Dort beginnt das **Onboarding von selbst**: der Hook `.claude/onboarding-start.js`
   setzt `/onboarding` ab, solange `docs/harness-instance.md` noch die Pflicht-Marke
   `[AUSFUELLEN]` trägt. Der Agent füllt die Instanzdatei mit dir aus — Projektsprache,
   Owner-Rolle, Schreibwurzeln, GitHub-Remote. Du wirst gefragt, du tippst nichts von
   dir aus.

## 8. Abnahme — der Beweis, dass die Installation steht

**Schnell (Sekunden), sagt: die verwalteten Dateien sind vollzählig und unverändert.**

```
node <PAKET>\install.mjs doctor --target <HARNESS>
```

Erwartet: Rückgabewert 0 und eine Zeile `keel harness distribution: command=doctor …`.
`status` statt `doctor` zählt nur; `doctor` prüft zusätzlich die Integrität.

**Vollständig (mehrere Minuten), sagt: der installierte Harness läuft wirklich.**
Im Ordner `<HARNESS>`, nicht im Bausatz:

```
node checks/run-all.mjs
```

Das sind die Prüfungen der **Auslieferung** — installierter Vertrag, Dashboard-Runtime,
volle Unlazy-Suite. Der Beweis ist die letzte Zeile und der Rückgabewert 0:

```
KEEL_HARNESS_OK
```

Kommt stattdessen `KEEL_HARNESS_FAILED <phase> exit=<n>`, steht in der Zeile davor,
welche Phase gescheitert ist. Das Dashboard startest du mit `npm run dashboard`
(lokal auf `127.0.0.1`; die Adresse steht in der Ausgabe).

Damit ist die Einrichtung abgeschlossen. `<PAKET>` wird ab jetzt nicht mehr gebraucht.
Behalten oder löschen — beides ist in Ordnung; in `<HARNESS>` liegt nichts vom Bausatz.

## 9. Optional — Google verbinden

Dieser Schritt ist **ausdrücklich optional**. Das Dashboard läuft ohne ihn vollständig;
nur seine Google-Fähigkeiten (Kalender, Aufgaben, Gmail) bleiben inaktiv, bis der Zugang
steht. Meldet das Dashboard „Google OAuth ist nicht konfiguriert", ist genau dieser
Schritt der Weg.

Es wird **keine fremde Google-Identität mitgeliefert oder vorausgesetzt** — jede
Installation bringt ihr eigenes Google-Cloud-Projekt und ihren eigenen OAuth-Client mit.
Die vollständige Klick-Anleitung liegt nach der Installation im Harness selbst:

```
<HARNESS>\docs\google-onboarding.md
```

Kurzfassung: eigenes Google-Cloud-Projekt anlegen, die drei benötigten APIs (Gmail,
Calendar, Tasks) aktivieren, OAuth-Consent-Screen auf **External** stellen und sich selbst
als Testnutzer eintragen, einen OAuth-Client vom Typ **Desktop app** erstellen und die
`client_secrets`-JSON herunterladen. Diese über `GOOGLE_CLIENT_SECRETS` oder am
dokumentierten Ablagepfad hinterlegen und im Dashboard **„Google verbinden"** klicken.
Beim ersten Onboarding bietet der Agent diesen Schritt von selbst an und führt durch die
Anleitung. Hinweis: Im Testing-Status läuft der Google-Token nach 7 Tagen ab und wird per
„Google neu verbinden" erneuert; Details stehen in der Anleitung.

---

## Was installiert wird

Die Tabelle ist aus `manifest.json` erzeugt; die Zahlen sind gezählt, nicht geschätzt.

<!-- ERZEUGT:was-installiert-wird (node checks/anleitung-sync.mjs --nachziehen; nicht von Hand ändern) -->
| Teil | Was es ist | Dateien |
|---|---|---|
| `.claude/` | Claude-Code-Ausstattung: Wächter-Hooks, Dauer-Regeln, Befehle, Skills | 53 |
| `.agents/` | Providerneutrale Regeln und Skills — dieselben Inhalte für Claude und Codex | 13 |
| `.codex/` | Codex-Route: Hooks, Guards, `config.toml` | 5 |
| `harness-core/` | Paket-Executor, Owner- und Paket-Bindungen, endliche Git-Schnittstelle | 28 |
| `vendor/` | Eingebettete Unlazy-Fassung: Paket-Bundles, Skripte, Tests | 436 |
| `dashboard/` | React-Dashboard: Starter, geprüftes Laufzeit-Archiv, Runtime-Check | 5 |
| `checks/` | Installierte Prüfungen der Auslieferung (`checks/run-all.mjs` und Einzelprüfer) | 6 |
| `docs/` | Doku, Instanzdatei mit `[AUSFUELLEN]`-Marke, Paketvorlage | 11 |
| `templates/` | Vorlagen für Paket-Bundles (OWNER, GATES) | 3 |
| `roles/` | Fachrollen-Profile des Assistenten (Accountability, Coaching, Ernährung, Training, Wohlbefinden, Business, Projekt) | 8 |
| `voice/` | Sprachlaufzeit als Sidecar: Piper (Sprachausgabe), Whisper (Mikrofon), Voicebox-Profildienst, Prüfskript `voice/check.mjs`; Starter `dashboard/serve.mjs --voice` | 13 |
| `licenses/` | Lizenztexte übernommener Fremdteile | 6 |
| (Wurzel) | Wurzeldateien: `.gitignore`, `.keel-harness.json`, `AGENTS.md`, `CLAUDE.md`, `package.json` | 5 |
| **Summe** | | **592** |
<!-- /ERZEUGT:was-installiert-wird -->

## Was bewusst fehlt

Was der Bausatz **nicht** mitliefert, steht im Manifest unter `excluded` — mit Grund.
Die Tabelle ist von dort erzeugt.

<!-- ERZEUGT:was-bewusst-fehlt (node checks/anleitung-sync.mjs --nachziehen; nicht von Hand ändern) -->
| Nicht mitgeliefert | Grund (Originalwortlaut aus `manifest.json`) |
|---|---|
| `test-harness/voice/*.test.mjs` | the voice sidecar tests transpile the dashboard source tree, which is not delivered; the installed route is node voice/check.mjs |
| `test-harness/.claude/settings.local.json` | machine-local permissions and plugin choices are not delivery truth |
| `test-harness/.unlazy/**` | disposable runtime and evidence state must never be delivered |
| `test-harness/dashboard/** except the compiled runtime archive` | recipient installs one verified production React runtime through dashboard/serve.mjs, never a second source or legacy renderer tree |
| `test-harness/dashboard/.next/standalone/node_modules/{@img,sharp}/**` | optional image optimization is disabled; platform-specific Sharp binaries cannot enter the platform-neutral runtime archive |
| `test-harness/docs/packages/<lab-package>/**` | Lab work packages are not recipient project content; the installer creates a fresh bundle |
| `test-harness/docs/harness-instance.md` | the Lab instance profile is replaced by the fresh-install onboarding template |
| `test-harness/docs/rebuild-guide.md and source-only Lab docs` | reference-build guidance is not recipient-project runtime or package truth |
| `test-harness/checks/<source-reference-gates>.mjs` | source, distribution, native-runtime, Lab-package, and external-repository gates bind the distributor's build package and are not recipient-project runtime |
| `test-harness/checks/governance-hardening.mjs and source active-harness-inventory.md` | the source governance gate imports distributor-only modules; recipients receive an installed-specific inventory whose commands are validated by checks/installed-harness.mjs |
| `test-harness/vendor/understand-anything-plugin/**/{node_modules,dist}/**` | build outputs of the vendored architecture plugin are not part of its approved, checksum-bound source; the recipient's Dashboard runs the lock file's prebuild once when an architecture picture is enabled |
| `**/.git/** and source node_modules/**` | repository internals and source dependencies are excluded; only traced pure-JavaScript runtime dependencies inside dashboard/runtime.keel.gz are delivered |

Insgesamt **12** bewusste Auslassungen. Sie sind kein Versehen und
brauchen kein Nachtragen.
<!-- /ERZEUGT:was-bewusst-fehlt -->

## Stand dieser Auslieferung

Aus `manifest.json` und `payload-provenance.json` erzeugt — so steht in der Anleitung,
woraus die Payload in deinen Händen entstanden ist.

<!-- ERZEUGT:stand-der-auslieferung (node checks/anleitung-sync.mjs --nachziehen; nicht von Hand ändern) -->
| Feld | Wert |
|---|---|
| Produkt und Version | `keel-harness` 1.3.8 |
| Payload-Posten | 592 |
| Baum-Fingerabdruck | `7894f5f2d775e5f3...` |
| Quelle | `harness-lab`, Unterbaum `test-harness/standalone` |
| Quell-Commit | `f64ce53701be843b1b06d2017193638d18f11cef` |
| Standalone frisch gebaut | ja |
| Ungesicherte Dateien der Quelle beim Bau | Arbeitsbaum 0, `test-harness/standalone` 0 |
| Erzeugt am | 2026-09-29T08:37:55.252Z |
<!-- /ERZEUGT:stand-der-auslieferung -->

---

## macOS — nicht verifiziert

Windows ist die Prämisse dieser Auslieferung und der einzige verifizierte Weg.
Installer und Payload sind pfad-neutral geschrieben, aber auf macOS **nicht
verifiziert** — was hier steht, ist die erwartete Übertragung, kein Messwert.

| Platzhalter | macOS / Linux (Beispiel, unverifiziert) |
|---|---|
| `<PAKET>` | `~/Downloads/keel-harness-standalone-setup` |
| `<HARNESS>` | `~/workspaces/mein-harness` |

Die Befehle sind dieselben, nur mit `/` statt `\`; in der Shell bewährt sich
`PAKET=~/Downloads/keel-harness-standalone-setup` und dann `node "$PAKET/install.mjs" …`.
MAX_PATH gibt es dort nicht.

Die plattformneutrale Härtung samt Mac-Abnahme läuft als eigenes Arbeitspaket in der
Werkbank: `harness-lab`, Paket `new-harness-portability`. Sobald es geschlossen ist,
wird dieser Abschnitt zu einem gemessenen Weg.

## Wenn etwas nicht stimmt

| Meldung / Lage | Bedeutung |
|---|---|
| `NODE_TOO_OLD running=… required=…` | Node ist älter als die Untergrenze. Es wurde nichts geschrieben. Node LTS installieren (Windows: `winget install OpenJS.NodeJS.LTS`), denselben Befehl erneut. |
| `target has no .git directory or .git file marker` | Schritt 2 fehlt — das Ziel ist kein Git-Repo. `git init`, dann denselben Befehl erneut. |
| Rückgabewert ≠ 0 bei `install` | **Nicht eingerichtet.** Die Meldung nennt den Grund; der Installer hat den Vorzustand selbst wiederhergestellt. Ursache beheben, denselben Befehl erneut. |
| Absturz mitten im Lauf (Stromausfall, Abbruch) | Journal und Quarantäne liegen noch da. `rollback --target <HARNESS>` vollendet die Wiederherstellung. |
| `payload integrity mismatch: …` | Der Bausatz-Klon ist verändert (häufigste Ursache: Zeilenenden-Konvertierung oder Handänderung in `payload/`). Frisch klonen, `node <PAKET>\checks\fresh-clone.mjs` muss 0 liefern. |
| `ENOENT` / `ENAMETOOLONG` beim Schreiben tiefer Dateien (Windows) | MAX_PATH. Kürzeres `<HARNESS>` wählen oder `subst` benutzen — siehe „Windows und PowerShell". |
| `install`/`uninstall` verweigert wegen laufender Dashboard-Lease | Im Ziel läuft das Dashboard. Prozess beenden, dann erneut. |
| `doctor` meldet Drift | Verwaltete Dateien wurden nachträglich geändert. Erst lesen, was abweicht; `--force` bei `uninstall` ist der ausdrückliche Weg, Backups über spätere Änderungen zu stellen — keine Standardoption. |
| Zweiter `install`-Lauf | Kein Fehler: `no-op=true`, es wird nichts doppelt geschrieben. |
| `KEEL_HARNESS_FAILED <phase> exit=<n>` in Schritt 8 | Die installierte Prüfung dieser Phase ist rot. Die Phase einzeln nachfahren; der Installer selbst ist davon unberührt. |
