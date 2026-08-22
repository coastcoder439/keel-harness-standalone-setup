# 10 — Nachbau-Anleitung: AIOS-Workspace mit Projekt-Repos

> ### 🔧 Ist-Abgleich dieser Werkbank (Stand 31.07.2026)
>
> Die Spezifikation steht in [`10-nachbau-anleitung.html`](10-nachbau-anleitung.html) und beschreibt **Anforderungen**, keinen Bestand. Was *diese* Werkbank davon erfüllt, steht hier — und nur hier.
>
> - **Erfüllt:** Werkbank/Produkt getrennt · eine Wurzel mit vererbter Konfiguration · Ordner==Repo · Status- und Sicherungsbefehl · Warnung am Sitzungsende · Wächter (zerstörende Befehle, Ziel-Repo-Ansage) · Statusleiste · Rollen-Hook + Melderegel · Zuschnitt des Fähigkeiten-Bestands (Katalog + Suchleiter) · Vollständigkeits-Workflow.
> - **Offen:** automatische Sicherung wird nicht erzeugt · keine Wächter-Protokolldatei und keine Auslöse-Prüfung · Verbrauchsmessung fehlt (nur Auswertung vorhanden) · Sitzungsverlauf wird von Hand abgelegt · versionierte Liste des aktiven Zuschnitts + Gegenmessung fehlen · Subagenten-Trennung greift in verschachtelten Repos nicht · Lebenszyklus-Spätphasen (übergeben/beenden/abbauen) und Sitzungs-Übergabe unbeschrieben · Betriebsart „zusammen machen" nicht gebaut · Nachbau von außen ungeprüft.
> - **Regel:** Dieser Absatz ist der einzige Ort für Zustand. Kommt eine Anforderung in Betrieb, wandert sie hier von *offen* nach *erfüllt* — die HTML-Spezifikation ändert sich dadurch **nicht**.

> **Was das hier ist:** Die **generische** Bau- und Betriebsanleitung, um dieses System auf einem anderen Rechner / für einen anderen Nutzer **von null** nachzubauen — mit Platzhaltern statt echter Namen, damit sie für jede Instanz taugt. Enthält alle Config-Dateien im Volltext, die Werkzeuge, Konventionen und bekannten Fallen.
>
> **Abgrenzung zu den Nachbardokumenten:** Diese Anleitung beschreibt den Nachbau *von null*. Für **diese** Werkbank gelten die konkreten Fassungen: `03-ordnerstruktur.md` (die real gültige Struktur) und `09-werkbank-verteilung.md` (Verteilung einer *bestehenden* Werkbank an einen zweiten Ort, inkl. der ausformulierten Branch-Regeln in §8 dort). Bei Widersprüchen gewinnen 03/09 für diese Instanz — diese Datei bleibt bewusst allgemein.
>
> **Herkunft:** lag bis 29.07.2026 unversioniert außerhalb der Werkbank; seitdem hier versioniert. Branch-Modell am 29.07.2026 ergänzt (§8a).
>
> **📐 Spezifikation zum Mitschicken:** [`10-nachbau-anleitung.html`](10-nachbau-anleitung.html) — eine Seite als Typenschild und Betriebsanleitung: sechs Betriebsgrundsätze, fünf Baugruppen mit dreizehn Positionen (je eine Liste von Anforderungen) und die Ausschlussliste dessen, was geprüft und verworfen ist. **Wer die Anleitung bekommt, sollte zuerst diese Seite öffnen** — sie beantwortet „was muss die Maschine können", bevor es hier an die Befehle geht. Im Browser öffnen; keine Abhängigkeiten, funktioniert offline.

Komplette Bau- und Betriebsanleitung, um dieses System auf einem **anderen Rechner / für einen anderen Nutzer** exakt nachzubauen. Enthält alle Config-Dateien im Volltext, die Werkzeuge, Konventionen und bekannten Fallen.

> **Platzhalter** (überall ersetzen):
> - `<WORKSPACE>` = Name des Harness-Ordners (Beispiel: `Mein-Agentic-OS`)
> - `<WORKSPACE_ABS>` = absoluter Pfad dazu (Beispiel: `~/workspaces/mein-agentic-os`)
> - `<ACCOUNT>` = GitHub-Account (Beispiel: `mein-github-konto`)
> - `<PLUGIN>` = das Harness/AIOS-Plugin (Beispiel: `ecc@ecc`)
> - `<projekt>` = ein Projektname (kleingeschrieben, Bindestriche)

---

## 0. Wie diese Anleitung benutzt wird (Onboarding)

Diese Datei ist nicht zum Selberlesen gedacht, sondern **als Auftrag an eine Sitzung**. Der Ablauf:

1. **Neue Sitzung öffnen**, Arbeitsverzeichnis = der (noch leere) künftige Workspace-Ordner. Diese Datei hineingeben mit dem Auftrag: *„Baue nach dieser Anleitung. Onboarde mich dabei — frag ab, was du brauchst, und rate nichts."*
2. **Die Sitzung führt das Onboarding**, statt still zu bauen. Sie muss mindestens erfragen:
   - GitHub-Konto (`<ACCOUNT>`) und ob `gh auth login` schon gelaufen ist
   - Name des Workspace-Ordners (`<WORKSPACE>`) — Ordnername == Repo-Name
   - welches Harness-/AIOS-Plugin geladen wird (`<PLUGIN>`) und ob es lokal vorliegt
   - welche Projekte es zu Beginn gibt (je Projekt: Ordner + eigenes privates Repo)
   - ob es bereits Inhalte gibt, die migriert werden (dann §9 „gitignore-Backup-Falle" beachten)
   - welche Zugänge/Secrets gebraucht werden — **Namen ja, Werte nein** (Schlüsselbund/Registry)
3. **Bauen** nach §5, Configs aus §6, dann die Kontrolle aus §12.

> ### ⚠ Die Setup-Sitzung muss danach weg — und der Nutzer neu starten
>
> Alles, was diese Anleitung einrichtet, wird **nur beim Start einer Sitzung geladen**: die Hooks aus `.claude/settings.json`, die `CLAUDE.md`, die Plugin-Aktivierung, die Slash-Befehle. Die Sitzung, die das Setup *durchführt*, hat davon **nichts** — sie lief ja schon, bevor es existierte.
>
> **Deshalb ist der letzte Schritt jedes Nachbaus:**
> 1. Die Setup-Sitzung sauber abschließen: alles committet und gepusht (`/repo-status` bzw. `node .claude/repo-status.js`), offene Punkte in eine Datei im Repo schreiben — **nicht** im Sitzungsverlauf lassen, der geht verloren.
> 2. **Setup-Sitzung beenden/verwerfen.** Sie ist ein Bau-Gerüst, kein Arbeitsplatz — und sie kennt die Regeln nicht, die sie gerade aufgestellt hat.
> 3. **Neue Sitzung starten** mit cwd = `<WORKSPACE>`. Erst diese hat Hooks, `CLAUDE.md` und Plugin.
> 4. In der neuen Sitzung als Erstes prüfen: greift der SessionStart-Hook? Zeigt `/repo-status` alle Repos als „synchron"? Erst dann ist der Nachbau fertig.
>
> Wer das überspringt, arbeitet mit einer Sitzung weiter, die weder die Sicherungs-Warnung noch die Architektur-Regeln kennt — und merkt es erst, wenn etwas ungesichert verlorengeht.

---

## 1. Was das System ist (in drei Sätzen)

Ein **Workspace-Ordner** (`<WORKSPACE>`) trägt den Harness/das AIOS-Plugin (agents, skills, commands, hooks, rules) und ist selbst **ein eigenes Git- + GitHub-Repo**. Darunter liegt `user-projects/`, worin **jedes Projekt ein eigener Ordner mit eigenem Git- + GitHub-Repo** ist (Ordnername == Repo-Name, Branch `main`). Alle Claude-Sessions laufen mit dem Workspace als Arbeitsverzeichnis (cwd), damit das Plugin greift; die **Projekte** werden über eigene Repos (Raum) getrennt, **nicht** über Branches. Branches haben eine andere Aufgabe: Sie trennen **innerhalb** eines Repos die Arbeitspakete (§8a).

---

## 2. Voraussetzungen (verifizierte Versionen)

| Tool | Version (getestet) | Wofür | Pflicht? |
|---|---|---|---|
| **Node.js** | v24.16.0 | Betreibt die Helper-Scripts (`repo-status.js`, `uncommitted-warn.js`) | ja |
| **Git** | 2.54.0 (windows) | Versionierung; `core.longpaths=true` nötig (Windows) | ja |
| **GitHub CLI (`gh`)** | 2.96.0 | Legt die privaten GitHub-Repos an; **muss `gh auth login` gelaufen sein** | ja |
| **rclone** | 1.74.3 | Backup von Dateien > 100 MB in Cloud-Storage (Google Drive) | optional |
| **GitHub-Account** | — | Ziel aller Repos (`<ACCOUNT>`) | ja |
| **Harness-Quelle** | Commit `81af4076` (29.06.2026) | Liefert agents/commands/skills/rules — der Harness selbst (`<HARNESS_SRC>`) | ja |
| **Claude Code CLI** | 2.1.206 | Führt den Nachbau aus (§0). Die `claude plugin …`-Unterbefehle braucht nur Weg B (§2.1) | ja |

**Windows-Sonderfall:** `gh` liegt oft unter `C:/Program Files/GitHub CLI` und ist nicht automatisch im Git-Bash-PATH. In Scripts/Sessions vorher:
```bash
export PATH="$PATH:/c/Program Files/GitHub CLI"
```
Und einmalig pro Repo (gegen „Filename too long"):
```bash
git config core.longpaths true
```
Diese zweite Zeile setzt ein **bestehendes** Repo voraus und läuft deshalb **nicht schon hier**: in einem Ordner ohne `.git` bricht sie mit `fatal: not in a git directory` (Exit 128) ab — in beide Richtungen gemessen, mit Repo Exit 0. Ihr Platz ist §5.1 Schritt 1, direkt hinter `git init`; hier steht sie als Voraussetzungs-Hinweis.

---

### 2.1 Woher der Harness kommt und wohin er gehört

> ⚠ **Berichtigt 02.08.2026.** In der Tabelle stand hier „**Das Harness-Plugin** … (`<PLUGIN>`)" als Pflicht-Voraussetzung — ohne Bezugsquelle, ohne Zielort, ohne Nachweis. Damit war ausgerechnet die einzige Voraussetzung, die die Anleitung nicht beschaffen konnte, zugleich die einzige, die es in dieser Form gar nicht gibt. Gemessen in dieser Werkbank: `claude plugin list` (Claude Code 2.1.206) meldet **genau ein** installiertes Plugin, `impeccable@impeccable`, Scope `user`; ein Plugin namens `ecc` ist **nicht installiert**. Der Harness liegt als **manuelle, ordner-lokale Kopie** in `.claude/`, gespeist aus einem Git-Klon in `.ecc-src/`. Die Begründung dieser Wahl steht in [`02-ecc-harness.md`](02-ecc-harness.md); hier stehen die Handgriffe.

**Dieser Abschnitt beschafft nur — er sichert nichts.** Das ist keine Auslassung, sondern die Reihenfolge: An dieser Stelle des Nachbaus ist `<WORKSPACE>` nach §0 Punkt 1 ein **gewöhnlicher Ordner ohne Git-Repo**; `git init` läuft erst in §5.1. Jedes `git status`, `git add`, `git check-ignore` oder `git ls-files` **auf den Workspace** bricht hier mit `fatal: not a git repository` ab — und das ist die gefährliche Variante, nicht die harmlose: Die Meldung geht nach stderr, eine Prüfung der Form „die Liste muss leer sein" bekommt eine leere Eingabe und meldet **Erfolg**. Nachgestellt in einem leeren Ordner ohne `git init`: `git status --short -uall | grep …` → keine Ausgabe, Exit 1, ununterscheidbar von „alles sauber".

**Deshalb kommt in diesem Abschnitt kein einziges Git-Kommando vor, das den Workspace als Repo behandelt.** Die drei `git`-Aufrufe unten richten sich alle mit `-C` auf `.ecc-src` — den frisch geklonten Fremd-Klon, der sein **eigenes** Repo mitbringt und deshalb schon existiert. Alle übrigen Proben sind dateibasiert.

Was daraus folgt, und was leicht übersehen wird: **Zwischen diesem Abschnitt und §5.1 liegt das Material ungesichert auf der Platte.** Das ist beabsichtigt. §5.1 legt das Repo an und schreibt die `.gitignore`, **bevor** zum ersten Mal etwas gestaged wird — der Fremd-Klon und die fremden Kopien unter `.claude/` gehören nie ins Repo, und ein nachgereichtes Ignore-Muster holt eine schon getrackte Datei nicht mehr heraus. Wer hier eigenmächtig `git init && git add -A` einschiebt, erzeugt genau den Schaden, gegen den §5.1 geschrieben ist. Nichts an dieser Stelle committen.

Es gibt zwei Wege. **Weg A ist der Weg dieser Werkbank** und die Voreinstellung dieser Anleitung. Weg B ist beschrieben, weil das Quell-Repo ein Plugin-Manifest mitbringt und die Frage sonst bei jedem Nachbau neu aufkommt — und weil der Platzhalter `<PLUGIN>` an anderer Stelle dieser Anleitung noch gebraucht wird.

Platzhalter dieses Abschnitts: `<HARNESS_SRC>` = das Quell-Repo des Harness. In dieser Werkbank ist das `https://github.com/affaan-m/ECC.git` — gemessen mit `git -C .ecc-src remote get-url origin`. Wer einen anderen Harness nachbaut, ersetzt die URL und behält die Schritte.

**Alle Zahlen unten sind quellbezogen gemessen, nicht abgeschrieben.** Ein frischer Nachbau hat noch keine Eigenbauten; die absoluten Zahlen dieser Werkbank (67 Agenten, 280 Skills, 96 Befehle) wären dort ein Fehlalarm. Deshalb vergleichen die Proben **Ziel gegen die eigene Quelle**, nie gegen eine fremde Zahl.

#### Weg A — ordner-lokale Kopie (Voreinstellung)

**Schritt 1: Quelle klonen, aber nicht dorthin, wo gelesen wird.**

```bash
git clone <HARNESS_SRC> "<WORKSPACE_ABS>/.ecc-src"
```

Claude Code liest **projektlokal** ausschliesslich aus einem Ordner, der exakt `.claude` heisst — dort ist der Name fest. (Nur die *nutzerweite* Ebene lässt sich verlegen, per `CLAUDE_CONFIG_DIR`; für den Projektordner gibt es kein Gegenstück, und darauf kommt es hier an.) Ein Fremd-Klon direkt in `.claude/` brächte eine zweite `.git`-Historie mitten in den Workspace. Getrennt gehalten lässt sich der Quellstand später gezielt nachziehen (`git -C .ecc-src pull`, dann bewusst kopieren), statt dass ein fremdes Update ungefragt in die laufende Konfiguration rutscht.

**Geklappt, wenn:** beide Kommandos etwas ausgeben — die Quell-URL und ein Commit. Beide fragen `.ecc-src`, nicht den Workspace; der Klon ist ab jetzt das einzige Repo weit und breit:
```bash
git -C "<WORKSPACE_ABS>/.ecc-src" remote get-url origin
git -C "<WORKSPACE_ABS>/.ecc-src" log -1 --format='%h %ad' --date=short
```
und der Klon die vier gebrauchten Ordner enthält:
```bash
ls "<WORKSPACE_ABS>/.ecc-src" | grep -cEx 'agents|commands|skills|rules'   # → 4
```

**Schritt 2: Die Kontext-Ebene nach `.claude/` kopieren — und nur die.**

```bash
cd "<WORKSPACE_ABS>"
mkdir -p .claude/rules/ecc
cp -R .ecc-src/agents    .claude/agents
cp -R .ecc-src/commands  .claude/commands
cp -R .ecc-src/skills    .claude/skills
cp -R .ecc-src/rules/*   .claude/rules/ecc/
```

Kopiert werden Agents, Commands, Skills, Rules — die Ebene, die projektlokal sauber lädt. `hooks/` bleibt bewusst liegen: die Hooks des Quell-Repos lösen ihre Skripte über `CLAUDE_PLUGIN_ROOT` nach `~/.claude/plugins/…` auf und schauen nicht in ein projektlokales `.claude/` (gemessen: 28 Vorkommen in `.ecc-src/hooks/hooks.json`). Sie sind damit nicht ordner-portabel; die eigenen Hooks entstehen stattdessen in §6.1 und §6.8. Alles Weitere aus dem Klon (`mcp-configs/`, `contexts/`, `schemas/` …) ist Vorlagenmaterial und wird nicht kopiert — Bewertung je Bestandteil in [`02-ecc-harness.md`](02-ecc-harness.md).

**Geklappt, wenn:** jede Zeile für Quelle und Ziel dieselbe Zahl nennt — und keine Zeile eine `0` enthält:
```bash
cd "<WORKSPACE_ABS>"
for d in agents commands skills; do
  printf '%-9s Quelle %3s | Ziel %3s\n' "$d" \
    "$(ls .ecc-src/$d | wc -l | tr -d ' ')" "$(ls .claude/$d | wc -l | tr -d ' ')"
done
printf '%-9s Quelle %3s | Ziel %3s\n' rules \
  "$(ls -d .ecc-src/rules/*/ | wc -l | tr -d ' ')" "$(ls -d .claude/rules/ecc/*/ | wc -l | tr -d ' ')"
```
Später, wenn eigene Skills und Befehle dazugekommen sind, darf das Ziel **grösser** sein als die Quelle — nie kleiner. Was im Ziel steht und nicht aus der Quelle stammt, sagt der Diff Ordner für Ordner; `>`-Zeilen sind Eigenbauten:
```bash
for d in agents commands skills; do
  echo "--- $d ---"; diff <(ls .ecc-src/$d) <(ls .claude/$d) | grep '^>' || echo "(nichts Eigenes)"
done
```

> **Wenn Schritt 2 ein zweites Mal läuft:** `cp -R .ecc-src/agents .claude/agents` überschreibt bei **bereits vorhandenem** Ziel nicht, sondern legt `.claude/agents/agents/` an — verschachtelt und still. Nachgestellt, alle vier Zeilen wiederholt: `agents/agents`, `commands/commands` und `skills/skills` entstehen; `rules` bleibt sauber, weil dort `.ecc-src/rules/*` in einen bestehenden Ordner **hineingemischt** wird (Quelle 3 | Ziel 3, unverändert).
>
> **Ob die Zählprobe oben das auffängt, hängt vom Zeitpunkt ab — und darauf ist kein Verlass.** Direkt nach Schritt 2 fällt es auf: gemessen `agents Quelle 3 | Ziel 4`, `skills Quelle 2 | Ziel 3`, und der Diff nennt den Ordner beim Namen (`> skills`). Sobald aber der erste Eigenbau existiert, ist `Ziel > Quelle` der **Normalfall** und trägt die Aussage nicht mehr: mit zwei eigenen Befehlen und einem eigenen Skill gemessen, vorher `commands 4 | 6`, nach dem Wiederholungslauf `4 | 7` — dieselbe Richtung, andere Ursache. Der Diff zeigt dann beides untereinander (`> eigen` und `> skills`) und verlangt, dass jemand die Namen liest.
>
> **Eindeutig in jedem Zustand ist nur der direkte Test.** Er nennt keine Zahl, die man interpretieren muss:
> ```bash
> ls -d .claude/agents/agents .claude/commands/commands .claude/skills/skills 2>/dev/null | wc -l   # → 0
> ```
> Alles über `0` ist ein Wiederholungslauf. Vor jedem Wiederholungslauf das Zielverzeichnis löschen — und **vorher** mit der Diff-Schleife oben nachsehen, ob dort schon Eigenes liegt, das dabei mit verschwinden würde. (Nicht `git ls-files` dafür benutzen: an dieser Stelle gibt es noch kein Workspace-Repo, das Kommando bricht ab, und sein Schweigen sieht wie „da liegt nichts Eigenes" aus.)

**Schritt 3: Nachweis, dass der Harness tatsächlich greift.**

Befehle, Skills und Regeln werden **sofort** gelesen — dafür braucht es keine neue Sitzung (gemessen 01.08.2026, §6.8.8: neu angelegte Skill- und Befehls-Dateien wurden in der **laufenden** Sitzung angekündigt). Sitzungsgebunden sind nur `CLAUDE.md`, die Statusleiste und die Hooks aus der Einstellungsdatei; die kommen in §5.4/§6.1 und werden am Ende des Nachbaus in einer frischen Sitzung geprüft (§0, §12).

**Geklappt, wenn:** ein Befehl, den es nur im Quell-Harness gibt, in der Slash-Liste steht — `/ecc-guide` ist dafür der eindeutigste. Der dateiseitige Teil ist prüfbar, in beide Richtungen gemessen (vorhanden → Exit 0, gelöscht → Exit 1 mit `No such file or directory`):
```bash
ls "<WORKSPACE_ABS>/.claude/commands/ecc-guide.md"
```
Der sitzungsseitige Teil ist es nicht per Shell: ob der Befehl in der Liste erscheint, sieht nur die Sitzung selbst. Steht die Datei da und der Befehl trotzdem nicht in der Liste, läuft die Sitzung nicht mit cwd = `<WORKSPACE>` — das ist der einzige verbleibende Grund.

**Damit endet die Beschaffung.** Der nächste Schritt am Material ist §5.1: Repo anlegen, `.gitignore` zuerst, dann der erste Commit. Der dortige Block hält `.ecc-src/` und die fremden Kopien unter `.claude/` draussen — nachgemessen im Zustand nach Schritt 2: `git check-ignore -v` nennt für `.ecc-src` die Zeile `.ecc-src/` und für `.claude/agents`, `.claude/skills`, `.claude/rules` sowie `.claude/settings.local.json` je die Zeile `.claude/*`; der Trockenlauf `git add -A -n` listet danach genau eine Datei, die `.gitignore` selbst. **Der eine Ordner, den weder §2.1 noch §5.1 anfasst, ist der Klon:** `.ecc-src/` ist ein Fremd-Repo von hier gemessen 227 MB (`du -sh .ecc-src`) — es wird nie committet, sondern per `git -C .ecc-src pull` nachgezogen.

#### Weg B — als Plugin (hier bewusst nicht gewählt)

Das Quell-Repo bringt ein Marktplatz-Manifest mit (`.ecc-src/.claude-plugin/marketplace.json`, Marktplatz `ecc`, Plugin `ecc` — also die Kennung `ecc@ecc`, der Wert für `<PLUGIN>`). Der Weg ist damit gangbar:

```bash
claude plugin marketplace add <HARNESS_SRC> --scope project
claude plugin install ecc@ecc --scope project
```

Beide Aufrufe brauchen kein Git-Repo im Workspace — sie schreiben in Konfigurationsdateien, nicht in eine Historie. Wer Weg B geht, überspringt Schritt 1 und 2 oben; es wird nichts nach `.claude/` kopiert, und die Zählproben von Schritt 2 entfallen ersatzlos.

**Geklappt, wenn:** die Bestandsliste den Eintrag mit dem erwarteten Scope und `enabled: true` führt — nicht der Erfolgsmeldung von `install` glauben, sondern nachsehen:
```bash
claude plugin list --json | python3 -c "import json,sys; print([p for p in json.load(sys.stdin) if p['id'].startswith('ecc@')])"
```
Erwartet wird ein Eintrag mit `"id": "ecc@ecc"`, `"scope": "project"`, `"enabled": true`. Kommt eine leere Liste, ist nichts installiert; steht `"enabled": false`, hat eine Einstellungsdatei das Plugin wieder abgeschaltet.

**Warum diese Werkbank Weg A geht:** Der Vorgabewert von `claude plugin install` ist `--scope user` — die Installation fasst also `~/.claude` an und wirkt in **allen** Projekten dieses Rechners, solange man den Scope nicht ausdrücklich setzt. Weg A fasst `~/.claude` mit keinem Byte an und ist wirklich ordner-portabel. Wie sich beide Ebenen ins Gehege kommen, lässt sich hier direkt ablesen: `~/.claude/settings.json` führt `enabledPlugins: {"impeccable@impeccable": true}`, während `<WORKSPACE>/.claude/settings.local.json` `{"impeccable@impeccable": false}` führt — die Workspace-Datei **schaltet ein global aktives Plugin für diesen Ordner ab**; sie aktiviert nichts. Genau diese Richtung ist der Grund, warum §4 Punkt 1 die Plugin-Bindung als Argument für die Ordnerstruktur benutzt — und zugleich der Beleg, dass die dortige Klammer „`~/.claude/settings.json` hat `enabledPlugins: {}`" nicht stimmt.

**Was die Wahl für §6.1 bedeutet:** Der `enabledPlugins`-Eintrag im Volltext von §6.1 gehört zu **Weg B**. Wer Weg A geht, hat kein Plugin zu aktivieren und lässt den Eintrag leer (`{}`); die zwei Hooks im selben Block bleiben davon unberührt und sind der eigentliche Zweck der Datei. Dasselbe gilt für den Satz „aktiviert das Plugin für diesen Ordner", mit dem §5.1 auf §6.1 verweist — unter Weg A aktiviert die Datei die Hooks, nicht ein Plugin.

> **Nicht ausgeführt, sondern abgelesen:** Die drei `claude plugin …`-Kommandos oben stammen aus der Hilfe der hier installierten Version 2.1.206. Gemessen mit `claude plugin marketplace add --help`, `claude plugin install --help`, `claude plugin list --help`: `marketplace add` kennt `--scope` mit `user (Vorgabe), project, local`; `install` kennt `-s, --scope` mit `user, project, local` (Vorgabe `user`); `list` kennt **kein** `--scope`, nur `--json` und `--available`. Ausgeführt wurden in dieser Werkbank nur die **lesenden** Aufrufe (`list`, `list --json`, `marketplace list`, `--help`) — `install` hätte die Konfiguration verändert, die dieser Abschnitt beschreibt. Wer Weg B geht, prüft deshalb mit dem `--json`-Aufruf nach, statt sich auf diese Anleitung zu verlassen.

---

## 3. Ordnerstruktur

```
<WORKSPACE>/                          ← Harness. EIGENES Git- + GitHub-Repo (<ACCOUNT>/<workspace>)
├── agents/ skills/ commands/         ← das AIOS-Plugin-Material
│   hooks/ rules/ mcp-configs/
├── CLAUDE.md                         ← Architektur-Regeln (wird jede Session geladen)
├── .gitignore                        ← schließt jeden Projektordner NAMENTLICH aus
├── .claude/
│   ├── settings.json                 ← aktiviert Plugin NUR hier + Hooks (SessionStart, Stop)
│   ├── repo-status.js                ← Helper für /repo-status
│   ├── uncommitted-warn.js           ← Helper für den Stop-Hook (Backup-Warnung)
│   ├── danger-guard.js               ← blockiert zerstörende Bash-Befehle (§6.8.9)
│   ├── commands/repo-status.md       ← Slash-Command /repo-status
│   ├── commands/save-work.md           ← Slash-Command /save-work
│   └── plan/                          ← temporäre Plan-Dateien (NICHT der dauerhafte Ort!)
└── user-projects/                    ← Behälter, hat KEIN eigenes .git
    ├── <projekt-a>/                  ← eigener Ordner + EIGENES Git- + GitHub-Repo
    ├── <projekt-b>/
    └── …
```

---

## 4. Warum diese Struktur zwingend ist (nicht optional)

1. **Plugin-Bindung (der Kern):** Das Plugin ist **nur im Workspace aktiviert** (`enabledPlugins` in `<WORKSPACE>/.claude/settings.json`), **NICHT global** (`~/.claude/settings.json` hat `enabledPlugins: {}`). → Eine Session bekommt das Plugin nur, wenn ihr **cwd = `<WORKSPACE>`** ist. Deshalb **müssen** die Projekte Unterordner bleiben. Zieht man sie raus und öffnet eine Session mit cwd = Projektordner, ist das Plugin weg.
2. **Kein Branch pro Projekt:** Alle Sessions teilen denselben Arbeitsordner (cwd). Ein `git checkout <projekt-branch>` würde den Inhalt für **alle** Sessions gleichzeitig austauschen — parallele Sessions wären unmöglich. Trennung erfolgt über **eigene Repos (Raum)**, nicht Branches (Zeit). Zudem gehört ein Branch in Git immer genau EINEM Repo; „eigenes Repo je Branch" existiert nicht.
   → Das verbietet **nicht** Branches an sich. Es verbietet nur, *Projekte* über Branches zu trennen. Innerhalb eines Repos sind Arbeitspaket-Branches vorgesehen — und die geteilte Arbeitsbaum-Eigenschaft aus diesem Absatz ist genau der Grund, warum dort **nur ein Branch gleichzeitig** gehen kann (§8a).

---

## 5. Setup Schritt für Schritt

### 5.1 Workspace anlegen

Die Reihenfolge in diesem Abschnitt ist nicht kosmetisch. Ein Workspace-Ordner enthält beim Nachbau bereits Material, das **nie** ins Repo gehört: den Fremd-Klon des Harness (Update-Quelle, nicht unsere Arbeit) und die rechnerabhängige `settings.local.json` mit der Befehls-Freigabeliste. Wer `git add -A` vor der `.gitignore` ausführt, nimmt beides mit — und ein später nachgereichtes Muster holt es nicht zurück: git wendet Ignore-Regeln auf bereits getrackte Dateien nicht mehr an. Nachgestellt: Datei committet, danach `.env` ins `.gitignore` eingetragen → `git ls-files` führt sie weiterhin, `git check-ignore -q .env` liefert **Exit 1** („nicht ignoriert"), erst `--no-index` liefert 0. Deshalb wird hier zuerst ignoriert, dann kontrolliert, dann committet — und am Ende **nachgesichert** (Schritt 6), denn eine `.gitignore` entscheidet nur, ob git eine Datei sehen *darf*; gesichert ist sie erst durch Commit und Push.

Größenordnung aus dieser Werkbank, gemessen am 02.08.2026: `find .ecc-src -type f | wc -l` → **10 651 Dateien**, `du -sh .ecc-src` → **227 MB** Fremd-Klon; `find .claude -type f | wc -l` → **753 Dateien**, davon absichtlich getrackt `git ls-files .claude | wc -l` → **22**. Die 22 sind der ausgebaute Endstand dieser Werkbank (sie enthält zusätzlich eigene Regeln, Skills und Pläne, die dieses Dokument nicht anlegen lässt). Der Nachbau landet nach Schritt 6 bei **15** Eigenbau-Dateien unter `.claude/` — aufgezählt statt gegriffen, weil kein Suchmuster hier eine verlässliche Zahl liefert:

| Was | Wieviel | Wo im Dokument |
|---|---|---|
| Wächter- und Helfer-Skripte | 7 | §6.3 · §6.4 · §6.8.3 · §6.8.4 · §6.8.5 · §6.8.9 · §6.8.10 |
| eigene Slash-Befehle | 4 | §6.5 · §6.6 · §6.8.6 |
| eigene Dauer-Regeln | 4 | §6.8.12 |

Der achte Wächter-Volltext, `pruefstand-warn.js` (§6.8.11), zählt **nicht** mit: §6.8.11a legt für jeden Nachbau Weg A fest — *„gar nicht erst anlegen"*, weil seine zwei Prüfer diese Werkbank messen und nicht den Nachbau.

> **Warum keine Zählung per `grep`:** Ein Muster, das nur Pfade in Backticks zählt, übersieht die fuenf Dauer-Regeln (ihr Abschnitt schreibt die Pfade bewusst ohne Backticks) und meldet **12** — die Zahl bliebe grün, während der Satz falsch wird. Ein Muster ohne Backticks zählt **23** und nimmt Beispiele wie `settings.js` mit. Beide Zahlen sind gemessen; keine trägt. Wo ein Suchmuster keine Wahrheit liefert, gehört die Liste hin.

Jede weitere kommt einzeln per `!`-Zeile dazu. Das ist der Unterschied zwischen einem sauberen ersten Commit und einem, der nicht mehr zu reparieren ist, ohne die Historie neu zu schreiben.

**Schritt 1 — Repo anlegen, noch nichts stagen.**

```bash
export PATH="$PATH:/c/Program Files/GitHub CLI"   # nur Windows/Git-Bash, sonst weglassen
cd <WORKSPACE_ABS>                                # Ordner mit Harness-Material
git init && git config core.longpaths true
```

Geklappt, wenn: `git rev-parse --is-inside-work-tree` `true` ausgibt und `git config core.longpaths` `true`.

**Schritt 2 — `.gitignore` schreiben, bevor irgendetwas gestaged wird.**

Liegt im Ordner schon eine `.gitignore` (möglich, wenn das Harness-Material eine mitbringt), erst sichern — der folgende Block **überschreibt**:

```bash
if [ -f .gitignore ]; then cp .gitignore .gitignore.vorher; echo "gesichert"; else echo "keine vorhanden"; fi
```

Der Block deckt genau die Klassen ab, die den ersten Commit verderben, und lässt umgekehrt **alle** Eigenbauten dieser Anleitung durch. §6.2 **ergänzt** ihn später um Build-Müll, Projekt-Repos und Laufzeit-Artefakte — der dortige Block ist ein Nachtrag, kein Ersatz.

```bash
cat > .gitignore <<'EOF'
# --- .claude: Fremd-Klon bleibt draussen, Eigenbau kommt rein ---
# git holt eine Datei NICHT per "!" zurueck, wenn ihr VERZEICHNIS ignoriert ist.
# Darum je Ebene dieselbe Form: Ordner oeffnen, Inhalt schliessen, Datei negieren.
# Neuer Eigenbau => hier eine "!"-Zeile, sonst ist er ungesichert (Schritt 6).
.claude/*
!.claude/*.js
!.claude/commands/
.claude/commands/*
!.claude/commands/repo-status.md
!.claude/commands/save-work.md
!.claude/commands/session-map.md
!.claude/commands/tell-session.md
.ecc-src/

# --- Secrets: nie committen (Zugaenge nur ueber die Connector-Registry) ---
.env
.env.*
!.env.example
*.key
*.pem
secrets.json
credentials.json

# --- Betriebssystem / Editor / Logs ---
.DS_Store
*.log
node_modules/
EOF
```

Drei Dinge bleiben hier bewusst draußen und haben **keine** `!`-Zeile: der Fremd-Klon `.ecc-src/`, die rechnerabhängige `.claude/settings.local.json` und `.claude/plan/` (temporärer Ablageort, §11 nennt ihn ausdrücklich ungesichert). `.claude/settings.json` fehlt ebenfalls — dazu Schritt 5.

Geklappt, wenn: `git check-ignore -q .claude/settings.local.json && echo draussen` das Wort `draussen` druckt.

**Schritt 3 — Kontrolle vor dem ersten Commit.**

Vier Blicke, keiner davon verändert etwas:

```bash
# a) Was WUERDE in den Commit gehen? Trockenlauf, aendert den Index nicht.
git add -A -n
git add -A -n | wc -l

# b) Bleibt draussen, was draussen bleiben soll? Exit 0 = die Regel greift.
for p in .claude/settings.local.json .ecc-src/ .env; do
  git check-ignore -q "$p" && echo "draussen: $p" || echo "DRIN (pruefen!): $p"
done

# b2) Herkunftsprobe: kommt die Regel aus UNSERER .gitignore?
git check-ignore -v .claude/settings.local.json .ecc-src/

# c) Groesste Kandidaten in KB -- GitHub lehnt > 100 MB hart ab (§10).
git ls-files --others --exclude-standard -z | xargs -0 du -k | sort -rn | head -5

# d) Sicherungsprobe: faellt eine Eigenbau-Datei der Anleitung durchs Raster?
ANLEITUNG=docs/rebuild-guide.md          # Pfad zu DIESEM Dokument
for f in $(grep -ohE '`\.claude/[A-Za-z0-9_./-]+\.(js|md)`' "$ANLEITUNG" | tr -d '`' | sort -u); do
  if   [ ! -e "$f" ];                                     then echo "kommt spaeter: $f"
  elif git ls-files --error-unmatch "$f" >/dev/null 2>&1;  then echo "gesichert:     $f"
  elif git check-ignore -q "$f";                           then echo "UNGESICHERT:   $f"
  else                                                          echo "offen:         $f"; fi
done
```

> **Falle bei (b): `-v` taugt nicht als Ja/Nein-Test.** `git check-ignore -v <pfad>` liefert **auch dann Exit 0**, wenn die passende Regel eine **Negation** (`!…`) ist — die Datei also gerade *nicht* ignoriert wird. Nachgestellt im Zustand vor dem ersten Commit: `git check-ignore -v .claude/repo-status.js` druckt `.gitignore:2:!.claude/*.js` und `exit=0`, dieselbe Datei mit `-q` liefert korrekt `exit=1`. Also: `-q` für die Entscheidung, `-v` nur, um zu sehen, welche Zeile greift.
>
> **Merkhilfe für alle `-q`-Prüfungen: `0` = ignoriert (bleibt draußen), `1` = nicht ignoriert (käme in den Commit).** Das gilt für **noch nicht getrackte** Dateien — und genau deshalb steht diese Kontrolle vor Schritt 4. Bei einer bereits getrackten Datei prüft git gar nicht erst und antwortet immer `1` (oben im Einleitungsabsatz gemessen).
>
> **Wozu (b2):** `git check-ignore -v` stellt die Datei voran, aus der die Regel stammt. Steht dort `.gitignore:…`, greift unsere eigene Zeile. Steht dort ein Pfad außerhalb des Repos (typisch `~/.config/git/ignore`), greift eine **globale** Ausschlussdatei des Rechners — dann ist (b) grün, ohne dass der Block aus Schritt 2 irgendetwas leistet, und auf dem nächsten Rechner ist alles offen. Nachgemessen auf dem Rechner, auf dem dieser Abschnitt entstand: `~/.config/git/ignore` enthält `**/.claude/settings.local.json` und macht (b) auch in einem Repo **ohne** eigene `.gitignore` grün. Diese Datei wirkt übrigens auch ohne Config-Eintrag — `GIT_CONFIG_GLOBAL=/dev/null` schaltet sie **nicht** ab, nur `-c core.excludesFile=/dev/null` tut das.

Geklappt, wenn: (a) nur Dateien listet, die man benennen kann — kein `.ecc-src/…`, kein `settings.local.json`, keine `.env`; (b) für alle drei Pfade `draussen:` meldet; (b2) für beide Zeilen `.gitignore:` als Herkunft nennt; (c) keinen Eintrag über 100 000 KB zeigt — läuft (c) ohne Kandidaten, bleibt sie stumm und endet mit Exit 0; (d) **keine** Zeile mit `UNGESICHERT:` ausgibt.

**Schlägt eine der vier fehl, ist noch nichts passiert:** (a) ist ein Trockenlauf, (b)–(d) lesen nur. Die `.gitignore` korrigieren und Schritt 3 wiederholen — beliebig oft, kostenlos. Erst Schritt 4 macht die Entscheidung dauerhaft.

**Schritt 4 — erster Commit und Remote.**

Ab hier braucht es `gh`, installiert **und** angemeldet, sowie ein Konto, das private Repos anlegen darf. Vorab prüfen: `gh auth status` nennt Konto und Speicherort und endet mit Exit 0 (nicht angemeldet: Exit 1 und der Hinweis `gh auth login`). Fehlt die Anmeldung, bricht `gh repo create` ab, während der lokale Commit schon steht — dann nachträglich anmelden und nur die letzten beiden Zeilen wiederholen.

```bash
git add -A && git commit -m "chore: initial harness"
gh repo create <ACCOUNT>/<workspace> --private --source=. --remote=origin
git branch -M main && git push -u origin main
```

Geklappt, wenn: `git show --stat --oneline HEAD | head -20` dieselbe Dateiliste zeigt wie der Trockenlauf aus Schritt 3a, und die Gegenprobe

```bash
git ls-files | grep -E '^(\.env$|\.ecc-src/|\.claude/settings\.local\.json$)'
```

**nichts** ausgibt (Exit 1). Danach: `git ls-remote origin refs/heads/main` liefert denselben Hash wie `git rev-parse HEAD`.

**Gibt die Gegenprobe doch etwas aus**, ist das der letzte günstige Moment: der Commit existiert, der Push noch nicht. Dann räumt dieselbe Bedingung den Index wieder ab:

```bash
git ls-files -z | grep -zE '^(\.env$|\.ecc-src/|\.claude/settings\.local\.json$)' \
  | xargs -0r git rm -q --cached --
git commit --amend --no-edit
```

und die Gegenprobe wiederholen, **bevor** `git push` läuft. Danach ist dieselbe Korrektur ein Umschreiben der Historie. Der Arbeitsbaum bleibt bei `--cached` unangetastet — die Dateien verschwinden aus dem Index, nicht von der Platte; die Zahl der Commits bleibt bei 1. *Nicht* `git rm -r --cached .env .ecc-src .claude/settings.local.json` von Hand tippen: das Kommando ist atomar und bricht mit `fatal: pathspec … did not match any files` komplett ab, sobald einer der Pfade nicht getrackt ist — und `.env` existiert beim Nachbau meist gar nicht. Die Pipeline oben nimmt nur, was `git ls-files` wirklich führt, und ist im Leerfall ein wirkungsloser Durchlauf.

**Schritt 5 — Plugin aktivieren.**

`<WORKSPACE>/.claude/settings.json` anlegen (Volltext in §6.1) → aktiviert das Plugin für diesen Ordner.

Geklappt, wenn: `git check-ignore -q .claude/settings.json; echo $?` eine **`0`** ausgibt — die Datei wird von `.claude/*` erfasst, keine `!`-Zeile holt sie zurück, sie bleibt also rechnerlokal und taucht in keinem `git status` mehr auf. Das ist hier eine **Entscheidung**, keine Schutzregel: `settings.json` enthält den Stop-Hook mit dem **absoluten** Pfad `<WORKSPACE_ABS>` (§6.1) und ist damit pro Rechner verschieden — anders als bei `settings.local.json` steckt aber kein Geheimnis darin. Wer sie versionieren will, macht zuerst die Hook-Pfade portabel (§6.4-Hinweis: `path.resolve(__dirname, '..')`), hängt dann `!.claude/settings.json` an die `.gitignore` und wiederholt Schritt 3 — dasselbe Kommando liefert danach `1`. Nachgestellt, beide Richtungen: ohne Negation `0`, mit Negation `1`.

Der Preis der Entscheidung: `settings.json` existiert nur als Kopie in §6.1 dieses Dokuments, und eine Kopie im Dokument ist kein Backup — sie muss von Hand nachgezogen werden und driftet. Genau dafür läuft ab §6.8.11 der Prüfstand-Hook.

**Schritt 6 — nachsichern, sobald §5.4 und §6.8 gelaufen sind.**

Schritt 4 kann nur sichern, was zu diesem Zeitpunkt existiert. Die Wächter, Helfer und Befehle entstehen erst in §5.4 und §6.8 — sie sind danach **unversioniert**, bis sie einmal committet werden. Deshalb ganz am Ende des Aufbaus:

```bash
# Sicherungsprobe aus Schritt 3d erneut laufen lassen, dann:
git add .claude
git diff HEAD --stat -- .claude          # zeigt, was WIRKLICH in den Commit geht
git commit -m "chore: Werkbank-Eigenbauten sichern" -- .claude
git push
```

Geklappt, wenn: die Sicherungsprobe aus Schritt 3d danach **zwölfmal `gesichert:`** meldet und keine Zeile `UNGESICHERT:` oder `offen:` — nachgestellt in einem frischen Repo, in dem die zwölf Dateien erst nach dem ersten Commit entstanden: vorher zwölfmal `offen:`, nachher zwölfmal `gesichert:`, `git ls-files .claude | wc -l` → 12, `.claude/settings.json` weiterhin ignoriert.

Dass diese Prüfung ab jetzt bei **jeder** Änderung an einem Eigenbau fällig ist, bleibt keine gemerkte Pflicht: der Stop-Hook aus §6.8.11 übernimmt sie und meldet nur bei Befund.

> **Warum §6.2 den Block aus Schritt 2 ergänzt und nicht ersetzt:** Wird §6.2 an seiner Stelle *statt* dessen geschrieben, tauchen `.claude/settings.local.json` und der Fremd-Klon sofort wieder als unversioniert auf (nachgestellt: `git status --short -- .claude` listet danach `settings.local.json` und `skills/`) und wären beim nächsten `git add -A` dabei. Die schon getrackten Eigenbauten merken davon nichts — Schritt 3d bleibt grün, **Schritt 3b** schlägt an. Deshalb sind es zwei Prüfungen und nicht eine.

> **Warum die Kontrolle in Schritt 3 nicht wegfällt, sobald man die Regeln kennt:** Sie ist der einzige Punkt im ganzen Nachbau, an dem ein Fehler noch kostenlos ist. Nach dem Commit kostet dieselbe Korrektur ein Umschreiben der Historie — und die ist zu diesem Zeitpunkt oft schon gepusht.

### 5.2 user-projects/ anlegen
```bash
mkdir -p <WORKSPACE_ABS>/user-projects
```

### 5.3 Pro Projekt (die Kern-Schleife)
```bash
cd <WORKSPACE_ABS>/user-projects/<projekt>     # Ordner: kleingeschrieben, Bindestriche
git init && git config core.longpaths true
# .gitignore im Projekt (node_modules, dist, .next, .env* …) anlegen
git add -A && git commit -m "chore: initial commit -- <projekt>"
gh repo create <ACCOUNT>/<projekt> --private --source=. --remote=origin
git branch -M main && git push -u origin main
```
**Erst NACH erfolgtem Push** im Workspace-`.gitignore` die Zeile `user-projects/<projekt>/` ergänzen (siehe §6.2). Reihenfolge ist Pflicht — sonst Backup-Falle (§9).

### 5.4 Helper-Scripts + Commands + Hooks
Die Dateien aus §6.3–§6.6 in `<WORKSPACE>/.claude/` anlegen. `settings.json`-Hooks (§6.1) referenzieren `uncommitted-warn.js` per **absolutem Pfad** — den auf `<WORKSPACE_ABS>` anpassen (oder Script portabel machen, §6.4-Hinweis).

---

## 6. Alle Config-Dateien im Volltext

### 6.1 `.claude/settings.json`
Verdrahtet alle Wächter: drei bei Sitzungsstart (Rollen · Onboarding-Frage · Projekt-Kontext-Frage),
einen am Sitzungsende (Backup-Warnung) und vier vor Werkzeugaufrufen (drei an Bash, einer an die
Sitzungs-Nachrichten) plus die Statusleiste. **Nichts von Hand anzupassen** — alle Pfade laufen über
`$CLAUDE_PROJECT_DIR`, den Claude Code selbst setzt; absolute Rechnerpfade und ein
`enabledPlugins`-Eintrag stehen bewusst nicht darin (Weg A, siehe §4).

> Dieser Block ist eine **Volltext-Kopie** von `templates/settings.json`. Er wird von
> `checks/anleitung-sync.mjs` gegen die echte Datei geprüft — läuft er auseinander, meldet der
> Abgleich Drift und `--nachziehen` gleicht ihn an. Von Hand ändern gehört in die echte Datei,
> nicht hierher.
```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"$CLAUDE_PROJECT_DIR/.claude/session-roles.js\"",
            "timeout": 10,
            "statusMessage": "Sitzungs-Rollen laden"
          },
          {
            "type": "command",
            "command": "node \"$CLAUDE_PROJECT_DIR/.claude/onboarding-start.js\"",
            "timeout": 10,
            "statusMessage": "Onboarding offen? (CLAUDE.md [AUSFUELLEN])"
          },
          {
            "type": "command",
            "command": "node \"$CLAUDE_PROJECT_DIR/.claude/project-context.js\"",
            "timeout": 10,
            "statusMessage": "Projekt-Kontext-Check"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"$CLAUDE_PROJECT_DIR/.claude/uncommitted-warn.js\"",
            "async": true,
            "statusMessage": "Backup-Check (ungesicherte Arbeit)"
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "node \"$CLAUDE_PROJECT_DIR/.claude/danger-guard.js\"",
            "timeout": 10,
            "statusMessage": "danger-guard (zerstoerende Befehle)"
          },
          {
            "type": "command",
            "if": "Bash(git *)",
            "command": "node \"$CLAUDE_PROJECT_DIR/.claude/git-guard.js\"",
            "timeout": 10,
            "statusMessage": "git-guard (Ziel-Repo + Lock)"
          },
          {
            "type": "command",
            "if": "Bash(git *)",
            "command": "node \"$CLAUDE_PROJECT_DIR/.claude/commit-pathspec-guard.js\"",
            "timeout": 10,
            "statusMessage": "commit-pathspec-guard (geteilter Index)"
          }
        ]
      },
      {
        "matcher": "mcp__ccd_session_mgmt__(send_message|list_sessions)",
        "hooks": [
          {
            "type": "command",
            "command": "node \"$CLAUDE_PROJECT_DIR/.claude/sessionpost-guard.js\"",
            "timeout": 10,
            "statusMessage": "sessionpost-guard (knappe Inter-Session-Nachrichten)"
          }
        ]
      }
    ]
  },
  "statusLine": {
    "type": "command",
    "command": "node \"$CLAUDE_PROJECT_DIR/.claude/statusline.js\""
  }
}
```

### 6.2 `.gitignore` (Workspace) — die entscheidenden Muster
```gitignore
# Build-Muell in Projekten (regenerierbar, teils > GitHub-100MB-Limit)
user-projects/**/node_modules/
user-projects/**/*.glb            # Beispiel: grosse Binaries projektuebergreifend
# (weitere grosse generierte Dateien nach Bedarf)

# Nested Git-Repos: JEDER Projektordner EINZELN + NAMENTLICH.
# Ordnername == GitHub-Repo-Name. NIEMALS pauschal "user-projects/" ignorieren.
user-projects/<projekt-a>/
user-projects/<projekt-b>/
# … eine Zeile pro Projekt, ERST nachdem dessen eigenes Repo gepusht ist

# Laufzeit-Artefakte
.playwright-mcp/
```
**Kritische Regel:** Nie `user-projects/` pauschal ignorieren — nur einzelne, verifiziert gepushte Ordner (§9).

### 6.2a `.claude/` — was versioniert wird, wie es hineinkommt, und warum die Muster so umstaendlich aussehen

`.claude/` ist **nicht pauschal draussen**. Der Ordner enthaelt dreierlei, und die `.gitignore`
trennt es:

| Inhalt | Beispiel | Git |
|---|---|---|
| **Fremd-Klon** (ECC-Installation) | `.claude/skills/`, `.claude/agents/` (gemessen 02.08.2026: `ls .claude/skills \| wc -l` → 280, `ls .claude/agents \| wc -l` → 67) | **draussen** — Fremdmaterial, aus der Update-Quelle nachziehbar |
| **Rechner-Zustand** | `.claude/settings.local.json` (Befehls-Freigabeliste) | **draussen** — pro Rechner verschieden |
| **Eigenbauten** | die acht Skripte direkt unter `.claude/` (`git-guard.js`, `danger-guard.js`, `commit-pathspec-guard.js`, `statusline.js`, `session-roles.js`, `repo-status.js`, `uncommitted-warn.js`, `pruefstand-warn.js`), die vier `commands/*.md`, die vier eigenen Regeln unter `rules/keel/`, `plan/`, die drei eigenen Skills | **drin** — sonst existieren sie nur auf einer Platte |

**Warum die Eigenbauten hinein muessen** (Anlass, belegt am 01.08.2026): Sie lagen ohne Sicherung
und ohne Historie nur lokal. Der `git-guard`-Fix vom selben Tag existierte nur auf der Platte,
waehrend die Volltext-Kopie in diesem Dokument 21 Zeilen aelter war. **Eine Kopie im Dokument ist
kein Backup** — sie muss von Hand nachgezogen werden und driftet nachweislich auseinander. §6.8.3 ff.
zeigen den Volltext zum Nachbau von Null; die *gesicherte* Fassung ist das Repo.

#### Warum die Muster so umstaendlich sind

Git kann eine Datei **nicht** per `!` zurueckholen, wenn ihr **Verzeichnis** ignoriert ist — es
steigt in ausgeschlossene Verzeichnisse gar nicht erst ab. Deshalb ueberall `<ordner>/*` statt
`<ordner>/`, und je Zwischenebene dieselbe **Drei-Zeilen-Form**: Ordner oeffnen · Inhalt schliessen ·
Ausnahme negieren.

Im Wegwerf-Repo nachgestellt (beide Varianten, gleiche Dateien, frisches `git init`, nichts getrackt):

```bash
T=$(mktemp -d); cd "$T"; git init -q .
mkdir -p .claude/commands
echo x > .claude/commands/repo-status.md
echo y > .claude/settings.local.json

# Variante A — Verzeichnis ignoriert, Datei negiert
printf '.claude/\n!.claude/commands/repo-status.md\n' > .gitignore
git status --short -uall
git check-ignore -v .claude/commands/repo-status.md
git check-ignore -q .claude/commands/repo-status.md; echo "A ignoriert? exit=$?"

# Variante B — Sternform mit Zwischenstufen
printf '.claude/*\n!.claude/commands/\n.claude/commands/*\n!.claude/commands/repo-status.md\n' > .gitignore
git status --short -uall
git check-ignore -v .claude/commands/repo-status.md
git check-ignore -q .claude/commands/repo-status.md; echo "B ignoriert? exit=$?"
```

**Geklappt, wenn:** In **A** zeigt `git status --short -uall` nur `?? .gitignore` — die Datei fehlt;
`check-ignore -v` nennt `.gitignore:1:.claude/`; `check-ignore -q` liefert **exit=0** (= ignoriert).
In **B** erscheint `?? .claude/commands/repo-status.md`; `check-ignore -v` nennt
`.gitignore:4:!.claude/commands/repo-status.md`; `check-ignore -q` liefert **exit=1** (= nicht
ignoriert). Genau umgekehrt — das ist der ganze Unterschied.

> **Falle beim Pruefen: `-v` und `-q` haben verschiedene Exit-Codes.** `git check-ignore -v` gibt
> **0** zurueck, sobald ueberhaupt **irgendein** Muster greift — auch eine `!`-Zeile, also auch bei
> einer nachweislich **nicht** ignorierten Datei. Gemessen (git 2.50.1), dieselbe Datei in Variante B:
> `-v` → exit 0 plus Trefferzeile, ohne `-v` → exit 1. **Als Ja/Nein-Kriterium taugt deshalb nur die
> Form ohne `-v`** (am besten `-q`); `-v` ist das Werkzeug zum *Nachsehen, welche Zeile entschieden
> hat*, nicht zum Entscheiden.

#### Der Block fuer die Werkbank-`.gitignore`

Wortgleich aus der laufenden Werkbank (`.gitignore`, Zeilen 9–50; per `diff` gegen die echte Datei
geprueft, keine Abweichung). Er gehoert **vor** die Muster aus §6.2; die Projekt- und Build-Muster
bleiben unveraendert daneben stehen:

```gitignore
# --- ECC-Harness: userbedingt (pro User) bzw. Update-Quelle -> nicht ins Repo ---
# AUSNAHME seit 01.08.2026: unsere EIGENBAUTEN werden getrackt.
# Anlass: Sie lagen ohne Sicherung und ohne Historie nur auf der Platte. Belegt,
# nicht vermutet -- der git-guard-Fix vom 01.08. existierte nur lokal, waehrend
# die Volltext-Kopie in docs/10 21 Zeilen alt war. Eine Kopie im Dokument ist
# kein Backup: sie muss von Hand nachgezogen werden und driftet nachweislich.
# Die Spezifikation verlangt in Baugruppe B, "dass Arbeit nicht verloren geht" --
# ausgerechnet die Werkzeuge der Werkbank waren davon ausgenommen.
#
# WAS DRAUSSEN BLEIBT: der ECC-Fremd-Klon (278 Skills, 67 Agenten, Fremdregeln)
# und settings.local.json -- letzteres enthaelt die Befehls-Freigabeliste und ist
# pro Rechner verschieden. Beides ist bewusst NICHT negiert.
#
# WARUM SO UMSTAENDLICH: git kann eine Datei nicht per "!" zurueckholen, wenn ihr
# VERZEICHNIS ignoriert ist. Darum ".claude/*" statt ".claude/" und je Unterordner
# dieselbe Zwei-Zeilen-Form (Ordner oeffnen, Inhalt schliessen, Datei negieren).
# Neuer Eigenbau => hier eintragen, sonst ist er wieder ungesichert.
.claude/*
!.claude/*.js
!.claude/commands/
.claude/commands/*
!.claude/commands/repo-status.md
!.claude/commands/save-work.md
!.claude/commands/session-map.md
!.claude/commands/tell-session.md
!.claude/skills/
.claude/skills/*
!.claude/skills/skill-library/
!.claude/skills/domain-modeling/
!.claude/skills/resolving-merge-conflicts/
!.claude/plan/
!.claude/rules/
.claude/rules/*
!.claude/rules/ecc/
.claude/rules/ecc/*
!.claude/rules/keel/
.claude/rules/keel/*
!.claude/rules/keel/no-oneshot.md
!.claude/rules/keel/completeness.md
!.claude/rules/keel/tools.md
!.claude/rules/keel/output-shape.md
.ecc-src/
```

Vier Lesehilfen — **drei davon beim Uebernehmen gleich mitkorrigieren**, der Kommentarkopf ist
selbst nicht fehlerfrei:

1. **Der Kopf sagt „Zwei-Zeilen-Form" und zaehlt drei Schritte auf.** Richtig ist die
   **Drei-Zeilen-Form** (Ordner oeffnen · Inhalt schliessen · Datei negieren) — siehe
   `!.claude/commands/` · `.claude/commands/*` · `!.claude/commands/repo-status.md`. Beim
   Uebernehmen im eigenen Aufbau berichtigen.
2. **Die Stueckzahlen im Kopf altern.** „278 Skills, 67 Agenten" war der Stand vom 01.08.2026;
   am 02.08.2026 gemessen (`ls .claude/skills | wc -l`) sind es **280**. Die Zahl ist Schmuck, kein
   Muster — im Nachbau streichen oder selbst messen.
3. **Die Zeile „Die Spezifikation verlangt in Baugruppe B …" ist werkbank-intern.** Im fremden
   Nachbau ersatzlos streichen.
4. **`!.claude/*.js` ohne Gegenstueck** holt alle Eigenbau-Skripte direkt unter `.claude/` zurueck —
   eine Zeile fuer acht Dateien (`ls .claude/*.js | wc -l` → 8). Neue Skripte auf dieser Ebene sind
   automatisch dabei; alles Tiefere braucht seine eigene Drei-Zeilen-Form. **`!.claude/plan/` und die
   drei `!.claude/skills/<name>/` ohne folgendes `/*`** holen den kompletten Unterbaum zurueck: dort
   liegt ausschliesslich Eigenes (geprueft: keiner der drei Skill-Ordner existiert in `.ecc-src/`).
   In einem frischen Aufbau gibt es diese Pfade nicht — die vier Negationen laufen dann folgenlos ins
   Leere; wer sie weglaesst, aendert nichts.

#### Un-ignorieren ist nicht sichern

Die `.gitignore` entscheidet **nur, ob git die Dateien sehen darf**. Aufgenommen werden sie durch
`git add`, gesichert erst durch Commit und Push. Ohne diesen Schritt ist nichts passiert: im
Wegwerf-Repo gemessen, unmittelbar nach dem reinen `.gitignore`-Edit, meldet
`git ls-files .claude | wc -l` weiterhin **0**.

```bash
git add .claude .gitignore                 # beide sind neu -> add ist Pflicht
git commit -m "chore(harness): Eigenbauten unter .claude versionieren" -- .claude .gitignore
git push
```

Zwei Anmerkungen zur Form, beide gemessen:

- **`.gitignore` gehoert in denselben Commit.** Sie ist im frischen Repo selbst untracked. Laesst man
  sie im `commit`-Pathspec weg, fehlt dem Klon die Regel; nennt man sie ohne vorheriges `git add`,
  bricht der ganze Commit ab: `error: pathspec '.gitignore' did not match any file(s) known to git`
  — und es wird **gar nichts** committet.
- **Die Pathspec-Form `-- <pfad>` ist hier Pflicht** (CLAUDE.md, Sichern): mehrere Sitzungen teilen
  einen Index. Gegenprobe vor dem Commit ist `git diff HEAD -- .claude`, **nicht** `git diff --cached`
  — letzteres zeigt den Index, committet wird der Arbeitsbaum.

**Geklappt, wenn:** `git ls-files .claude | wc -l` eine Zahl **groesser 0** liefert, die den
aufgenommenen Dateien entspricht, **und** `git status --short .claude` danach **leere Ausgabe**
liefert. Im Wegwerf-Repo mit sieben angelegten Dateien gemessen: vorher `0`, nachher `5` (die zwei
Fremd-Dateien blieben korrekt draussen), `git status --short .claude` leer.

**Ohne Remote endet das hier.** `git push` bricht im frischen Repo mit
`fatal: No configured push destination.` ab — der Rechner- und Personenwechsel, den dieser Abschnitt
verspricht, ist erst nach `gh repo create … --source=. --remote=origin` und
`git push -u origin main` (§5.1) erreicht.

#### Nach dem Eintragen pruefen — die Probe, die in jedem Zustand gilt

`git check-ignore` liest den Index und **schweigt zu Pfaden, die bereits aufgenommen sind**. Ein
Kriterium, das auf der *Ausgabe* aufbaut, misst deshalb je nach Zeitpunkt etwas anderes. Der
**Exit-Code ohne `-v`** tut das nicht: „nicht ignoriert" (exit 1) gilt sowohl fuer die noch nicht
aufgenommene, negierte Datei als auch fuer die bereits getrackte.

```bash
for f in .claude/hooks/git-guard.js \
         .claude/commands/repo-status.md \
         .claude/rules/keel/tools.md \
         .claude/settings.local.json \
         .claude/rules/ecc/web/testing.md; do
  if git check-ignore -q "$f"; then echo "IGNORIERT   $f"; else echo "sichtbar    $f"; fi
done
```

**Geklappt, wenn:** die ersten drei `sichtbar` melden und die letzten beiden `IGNORIERT` — **vor**
und **nach** dem `git add` identisch. Zweimal gemessen: im Wegwerf-Repo direkt nach dem
`.gitignore`-Edit (nichts getrackt) und nach `add` + Commit — beide Male dieselben fuenf Zeilen; in
dieser Werkbank (alles laengst getrackt) ebenfalls dieselben fuenf Zeilen.

Wer wissen will, **welche Zeile** entschieden hat, haengt `git check-ignore -v "$f"` daneben — diese
Ausgabe ist zustandsabhaengig und taugt zum Nachsehen, nicht als Kriterium:

- **vor** dem `git add` nennen die drei Eigenbauten ihre Negationszeile (im Wegwerf-Repo gemessen:
  `!.claude/*.js`, `!.claude/commands/repo-status.md`,
  `!.claude/rules/keel/tools.md`) — das ist der **korrekte** Zwischenzustand, kein Fehler;
- **nach** `add` + Commit schweigt `-v` zu ihnen, weil sie im Index liegen;
- die beiden Fremd-Dateien nennen in **beiden** Faellen ihre `.gitignore`-Zeile (in dieser Werkbank:
  `.gitignore:26:.claude/*` fuer `settings.local.json`, `.gitignore:43:.claude/rules/ecc/*` fuer
  `rules/ecc/web/testing.md` — die Zeilennummern verschieben sich mit jedem Muster davor, der
  **Mustertext** ist das Aussagekraeftige).

**Bestandskontrolle nach jedem neuen Eigenbau:**

```bash
git ls-files .claude | wc -l
git ls-files .claude
```

**Geklappt, wenn:** die Zahl um genau die Zahl der neuen Dateien gestiegen ist und der neue Pfad in
der Liste steht. Stand dieser Werkbank am 02.08.2026: **22** Dateien. Steht der Pfad nicht drin,
fehlt entweder die `!`-Zeile (dann meldet die Probe oben `IGNORIERT`) oder das `git add` — die Probe
oben unterscheidet beides.

**Nicht gedeckt, bewusst:** `.claude/settings.json`. Sie faellt unter `.claude/*` und ist nirgends
negiert; ihr Volltext steht nur in §6.1. In dieser Werkbank existiert die Datei gar nicht (`ls
.claude/settings.json` → `No such file or directory`) — verdrahtet wird ueber `settings.local.json`
(§6.8.7). Wer sie in seinem Nachbau anlegt und versionieren will, braucht eine eigene `!`-Zeile.

**Folgepflicht, die dieser Abschnitt erzeugt:** Wer einen Eigenbau aendert, zieht **die Volltext-Kopie
in §6.8.3 ff. im selben Commit nach**. Repo und Dokument sind zwei Kopien derselben Datei; genau ihr
Auseinanderdriften war der Anlass fuer diesen Abschnitt (21 Zeilen Unterschied am 01.08.2026).

---

### 6.3 `.claude/repo-status.js` (Helper für `/repo-status`)
> **Die Suche muss rekursiv sein — und sie darf bei einem gefundenen Repo nicht aufhören.**
> Projekt-Repos liegen auch zwei Ebenen tief (`user-projects/<projekt>/<feature>`). Eine
> flache Suche über `user-projects/` übersieht sie und meldet „alles gesichert", während
> dort ungepushte Arbeit liegt. Am 01.08.2026 gemessen: **flach 5 Repos, rekursiv 7** — die
> zwei Übersehenen waren ausgerechnet die beiden Plugin-Repos.
>
> ⚠ **Berichtigt 02.08.2026.** Hier stand: *„Ein gefundenes Repo wird nicht weiter
> durchsucht; was darin liegt, gehört ihm."* Das klang vernünftig und war der zweite
> blinde Fleck derselben Sorte: ein Repo **im** Repo wurde nie gefunden. Im Wegwerf-Ordner
> nachgestellt — `user-projects/projekt-a` (Repo) mit `feature-b` (eigenes Repo) darin →
> `feature-b` tauchte in **keiner** Zeile auf. Genau davor warnt die `.gitignore` dieser
> Werkbank („sonst werden ungesicherte Projekte unsichtbar + ungeschützt zugleich"): der
> Prüfer, der das aufdecken soll, hatte die Lücke selbst. Jetzt wird **in beiden Fällen**
> weitergesucht, bis Tiefe 4.
>
> **Zwei Folgen, die man wissen muss:**
> 1. **Ein ungetrackter Ordner zählte als eine Datei.** `git status --porcelain` meldet
>    `?? projekt-a/` unabhängig davon, ob drei oder dreitausend Dateien darin liegen — ein
>    komplett ungesichertes Projekt blieb damit unter jeder Warnschwelle. Ordner werden
>    jetzt aufgelöst; enthält der Ordner ein eigenes `.git`, bekommt er eine eigene Zeile.
> 2. **Worktrees tauchen jetzt auf.** Sie als gleichrangiges Projekt zu melden wäre falsch
>    (kein eigenes Remote). Sie werden als Arbeitskopie ihres Mutter-Repos ausgewiesen —
>    und ihre Erreichbarkeit wird **gemessen**, nicht beruhigt: ein abgetrennter Commit,
>    den kein Zweig hält, ist die gefährlichste Stelle im Baum, weil die Arbeit vorhanden
>    aussieht und an nichts hängt.
>
> **Portabel:** `path.resolve(__dirname, '..')` statt eines fest verdrahteten Pfades —
> das Skript liegt in `<WERKBANK>/.claude/` und findet seine Wurzel damit selbst.

Volltext von `.claude/repo-status.js`:

```js
#!/usr/bin/env node
// Repo-Status der Werkbank: das Werkbank-Repo selbst + jedes Projekt-Repo
// darunter. Zeigt getrennt: lokales Git / GitHub-Remote / Sync / ungesicherte
// Dateien. Rein lesend, veraendert nichts.
//
// Die Suche ist REKURSIV, und das ist kein Luxus: Projekt-Repos liegen auch
// zwei Ebenen tief (user-projects/<projekt>/<feature>). Eine flache Suche
// uebersieht sie und meldet "alles gesichert", waehrend dort ungepushte
// Arbeit liegt -- gemessen am 01.08.2026: flach 5 Repos, rekursiv 7.
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const WORKSPACE = path.resolve(__dirname, '..');            // = Wurzel der Werkbank

function sh(cmd, cwd) {
  try { return execSync(cmd, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim(); }
  catch (e) { return null; }
}

function isRepo(dir) {
  // .git kann Verzeichnis (normales Repo) ODER Datei (Worktree) sein
  return fs.existsSync(path.join(dir, '.git'));
}

// Worktree oder eigenstaendiges Repo? Seit die Suche auch UNTERHALB gefundener
// Repos weitergeht (02.08.2026), tauchen Worktrees auf. Sie als gleichrangiges
// Projekt zu melden waere falsch: ein Worktree hat kein eigenes Remote und
// keine eigene Sicherungspflicht -- er haengt am Mutter-Repo.
function worktreeVon(dir) {
  const g = path.join(dir, '.git');
  try {
    if (fs.statSync(g).isDirectory()) return null;
    const m = fs.readFileSync(g, 'utf8').match(/gitdir:\s*(.+)/);
    if (!m) return null;
    // .../<mutter>/.git/worktrees/<name>  ->  <mutter>
    const treffer = m[1].trim().match(/^(.*)\/\.git\/worktrees\//);
    return treffer ? treffer[1] : null;
  } catch (e) {
    return null;
  }
}

function repoInfo(dir, label) {
  if (!isRepo(dir))
    return `  ${label}\n      Lokales Git   : NEIN (kein .git -- nicht versioniert!)`;
  const mutter = worktreeVon(dir);
  if (mutter) {
    const zweig = sh('git rev-parse --abbrev-ref HEAD', dir) || '?';
    const kopf = sh('git rev-parse HEAD', dir) || '';
    const u = ungesichertZaehlen(dir);

    // NICHT behaupten, ein Worktree brauche keine Sicherung -- das MESSEN.
    // Ein Worktree mit abgetrenntem HEAD, dessen Commit in keinem Zweig auf dem
    // Server steckt, ist die gefaehrlichste Stelle im ganzen Baum: die Arbeit
    // sieht vorhanden aus und haengt an nichts. Genau deshalb steht hier eine
    // Messung und kein beruhigender Satz.
    const inFern = (sh(`git branch -r --contains ${kopf}`, mutter) || '')
      .split('\n').map((s) => s.trim()).filter(Boolean);
    const inNah = (sh(`git branch --contains ${kopf}`, mutter) || '')
      .split('\n').map((s) => s.replace(/^\*\s*/, '').trim()).filter(Boolean);

    let lage;
    if (inFern.length) lage = `gesichert -- Commit steckt in ${inFern.join(', ')}`;
    else if (inNah.length) lage = `NUR LOKAL -- Commit steckt in ${inNah.join(', ')}, aber in KEINEM Server-Zweig`;
    else lage = 'NIRGENDS ERREICHBAR -- Commit haengt in keinem Zweig, weder lokal noch auf dem Server!';

    return [
      `  ${label}`,
      `      WORKTREE      : Arbeitskopie von ${path.relative(WORKSPACE, mutter) || mutter}`,
      `      Zweig         : ${zweig} @ ${kopf.slice(0, 7)}`,
      `      Erreichbar    : ${lage}`,
      `      Ungesichert   : ${u.dateien} Datei(en) im Arbeitsbaum`,
    ].join('\n');
  }
  const branch = sh('git rev-parse --abbrev-ref HEAD', dir) || '?';
  const commits = sh('git rev-list --count HEAD', dir) || '0';
  const remoteUrl = sh('git remote get-url origin', dir);
  const ghRepo = remoteUrl
    ? remoteUrl.replace(/.*github\.com[:/]/, '').replace(/\.git$/, '')
    : null;
  let sync;
  if (!remoteUrl) sync = 'KEIN GitHub-Remote -- nur lokal, NICHT gesichert!';
  else {
    const localHash = sh('git rev-parse HEAD', dir);
    const ls = sh(`git ls-remote origin refs/heads/${branch}`, dir);
    const remoteHash = ls ? ls.split(/\s/)[0] : '';
    if (!remoteHash) sync = `Branch "${branch}" NICHT auf GitHub (noch nie gepusht)`;
    else if (remoteHash === localHash) sync = 'synchron -- alles gepusht';
    else sync = 'NICHT synchron -- lokale Commits noch nicht gepusht';
  }
  const u = ungesichertZaehlen(dir);
  const zeilen = [
    `  ${label}`,
    `      Lokales Git   : JA (Branch ${branch}, ${commits} Commits)`,
    `      GitHub-Repo   : ${ghRepo || '(keins)'}`,
    `      Sync          : ${sync}`,
    `      Ungesichert   : ${u.dateien} Datei(en) uncommitted` +
      (u.ordner.length ? `  (in ${u.zeilen} Eintraegen, davon ${u.ordner.length} ungetrackte Ordner)` : ''),
  ];
  // Ein ungetrackter Ordner MIT eigenem .git ist der schlimmste Fall: ein ganzes
  // Projekt, das weder hier noch dort gesichert ist. Er bekommt eine eigene Zeile.
  for (const o of u.ordner) {
    const marke = o.istRepo ? '!! EIGENES REPO' : o.repostDrin ? '!! ENTHAELT REPOS' : '   Ordner       ';
    const nachsatz = o.istRepo
      ? ' -- eigenes .git, hier NICHT mitgesichert'
      : o.repostDrin
        ? ` -- ${o.repostDrin} eigene Repo(s) darin, hier NICHT mitgesichert`
        : '';
    zeilen.push(`      ${marke} : ${o.pfad} (${o.anzahl} Datei(en))${nachsatz}`);
  }
  return zeilen.join('\n');
}

// Projekt-Repos finden (max. 4 Ebenen tief).
//
// BERICHTIGT 02.08.2026: Hier stand "Ein gefundenes Repo wird NICHT weiter
// durchsucht -- was darin liegt, gehoert ihm, nicht der Werkbank." Das klang
// vernuenftig und war der Fehler: ein Repo IM Repo wurde nie gefunden.
// Gemessen im Wegwerf-Ordner: user-projects/projekt-a (Repo) mit feature-b
// (eigenes Repo) darin -> feature-b tauchte in KEINER Zeile auf.
// Genau davor warnt die .gitignore dieser Werkbank ("sonst werden ungesicherte
// Projekte unsichtbar + ungeschuetzt zugleich") -- der Pruefer, der das
// aufdecken soll, hatte die Luecke selbst.
const UEBERSPRINGEN = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'vendor', '.venv', 'venv', 'target']);

function findNestedRepos(root, depth = 0, acc = []) {
  if (depth > 4 || !fs.existsSync(root)) return acc;
  let namen; try { namen = fs.readdirSync(root); } catch (e) { return acc; }
  for (const name of namen) {
    if (UEBERSPRINGEN.has(name)) continue;
    const d = path.join(root, name);
    let st; try { st = fs.statSync(d); } catch (e) { continue; }
    if (!st.isDirectory()) continue;
    if (isRepo(d)) acc.push(d);
    // In BEIDEN Faellen weitersuchen -- auch unterhalb eines gefundenen Repos.
    findNestedRepos(d, depth + 1, acc);
  }
  return acc;
}

// Was "git status --porcelain" verschweigt.
//
// Ein ungetrackter ORDNER erscheint als EINE Zeile ("?? projekt-a/"), egal ob
// drei oder dreitausend Dateien darin liegen. Ein komplett ungesichertes Projekt
// zaehlte damit als "1 Datei" -- und blieb unter jeder Warnschwelle.
// Deshalb wird jede Ordner-Zeile aufgeloest und ein darin liegendes .git
// ausdruecklich benannt: DAS ist der gefaehrliche Fall.
function ordnerAufloesen(dir, eintrag) {
  const abs = path.join(dir, eintrag);
  let anzahl = 0, istRepo = false, repostDrin = 0;
  const gehen = (p, tiefe) => {
    if (tiefe > 6 || anzahl > 5000) return;
    let e; try { e = fs.readdirSync(p, { withFileTypes: true }); } catch (x) { return; }
    for (const x of e) {
      // Ein .git GANZ OBEN heisst: der ungetrackte Ordner IST ein Repo.
      // Ein .git weiter unten heisst nur: er ENTHAELT Repos. Zwei verschiedene
      // Aussagen -- die erste Fassung machte daraus eine und log damit ueber
      // user-projects/, das selbst nie ein Repo war.
      if (x.name === '.git') { if (tiefe === 0) istRepo = true; else repostDrin++; continue; }
      if (UEBERSPRINGEN.has(x.name)) continue;
      if (x.isDirectory()) gehen(path.join(p, x.name), tiefe + 1);
      else anzahl++;
    }
  };
  gehen(abs, 0);
  return { anzahl, istRepo, repostDrin };
}

function ungesichertZaehlen(dir) {
  const roh = sh('git status --porcelain', dir);
  const zeilen = roh ? roh.split('\n').filter(Boolean) : [];
  let dateien = 0;
  const ordner = [];
  for (const z of zeilen) {
    const pfad = z.slice(3).replace(/^"|"$/g, '');
    if (pfad.endsWith('/')) {
      const auf = ordnerAufloesen(dir, pfad);
      dateien += auf.anzahl;
      ordner.push({ pfad, ...auf });
    } else dateien++;
  }
  return { dateien, ordner, zeilen: zeilen.length };
}

console.log('\n############  REPO-STATUS  ############\n');

console.log('=== WERKBANK / HARNESS ===');
console.log(repoInfo(WORKSPACE, path.basename(WORKSPACE) + '  <- das zeigt die Statusleiste (Repo-Name)'));

console.log('\n=== PROJEKT-REPOS in user-projects/ (je eigenes GitHub-Repo) ===');
const nested = findNestedRepos(path.join(WORKSPACE, 'user-projects'));
if (!nested.length) console.log('  (keine)');
for (const d of nested.sort()) console.log(repoInfo(d, path.relative(WORKSPACE, d)));

console.log('\n######################################\n');
```

### 6.4 `.claude/hooks/uncommitted-warn.js` (Backup-Warnung, vom Stop-Hook)
Warnt (per `systemMessage`), **committet nichts**. Throttle gegen Spam. Deckt die Werkbank **und alle verschachtelten Projekt-Repos** (rekursiv bis Tiefe 3, `node_modules` ausgenommen) ab und meldet drei Lücken-Arten: kein GitHub-Remote · ungepushte Commits · viel/altes Ungesichertes (Schwellen: 8 Dateien bzw. 120 min seit letztem Commit).
```js
#!/usr/bin/env node
// Stop-Hook: warnt (systemMessage), wenn irgendein Repo eine BACKUP-LUECKE hat
// -- kein GitHub-Remote, ungepushte Commits, oder viel/altes Ungesichertes.
// Committet/pusht NICHTS. Throttle gegen Spam. Deckt Harness + work/-Repos + Fork.
//
// Drossel-Stempel PRO SITZUNG [Beschluss D8, Auftraggeber 01.08.2026]: Der alte globale
// Stempel liess bei 9 parallelen Sitzungen jede Sitzung das 15-Minuten-Fenster
// ALLER anderen zuruecksetzen -- Warnungen verschwanden zufaellig. session_id
// liefert der Stop-Hook via stdin-JSON; ohne stdin (Handaufruf) gilt "global".
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const WORKSPACE = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, '..');
const WORKSPACES_ROOT = path.resolve(WORKSPACE, '..');
const THROTTLE_MIN = 15, FILE_THRESHOLD = 8, AGE_THRESHOLD_MIN = 120;

function sh(c, cwd) {
  try { return execSync(c, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim(); }
  catch (e) { return null; }
}
function isRepo(d) { return fs.existsSync(path.join(d, '.git')); }

function findNestedRepos(root, depth = 0, acc = []) {
  if (depth > 3 || !fs.existsSync(root)) return acc;
  for (const name of fs.readdirSync(root)) {
    if (name === 'node_modules' || name === '.git') continue;
    const d = path.join(root, name);
    let st; try { st = fs.statSync(d); } catch (e) { continue; }
    if (!st.isDirectory()) continue;
    if (isRepo(d)) acc.push(d); else findNestedRepos(d, depth + 1, acc);
  }
  return acc;
}

function main(rohEingabe) {
  let sid = 'global';
  try {
    const d = JSON.parse(rohEingabe || '{}');
    if (d.session_id) sid = String(d.session_id).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'global';
  } catch (e) {}
  const stamp = path.join(os.tmpdir(), `harness-uncommitted-warn-${sid}.stamp`);

  try {
    const last = parseInt(fs.readFileSync(stamp, 'utf8'), 10);
    if (Number.isFinite(last) && Date.now() - last < THROTTLE_MIN * 60000) return;
  } catch (e) {}

  const repos = [
    WORKSPACE,
    ...findNestedRepos(path.join(WORKSPACE, 'user-projects')),
  ];

  // Zwei GETRENNTE Zustaende, nicht ein Topf [Fork-Befund via HARNESS CONTROL, 01.08.2026]:
  //   offen   = Dateien im Arbeitsbaum, nicht committet -> ein Absturz kostet ARBEIT
  //   ungepusht = committet, nicht auf GitHub          -> Verlust nur der HISTORIE/Redundanz
  // Vorher standen beide gleichrangig in einer Zeile unter einer Push-lastigen Ueberschrift;
  // wer den Anfang las, sortierte den dringenderen Fall als Push-Sache ein.
  const offen = [];
  const ungepusht = [];
  for (const d of repos) {
    if (!isRepo(d)) continue;
    const label = d === WORKSPACE ? path.basename(d) : path.relative(WORKSPACES_ROOT, d);
    const reasons = [];

    const branch = sh('git rev-parse --abbrev-ref HEAD', d) || '?';
    const remoteUrl = sh('git remote get-url origin', d);
    if (!remoteUrl) {
      reasons.push('KEIN GitHub-Remote (nur lokal)');
    } else {
      const localHash = sh('git rev-parse HEAD', d);
      const ls = sh(`git ls-remote origin refs/heads/${branch}`, d);
      const remoteHash = ls ? ls.split(/\s/)[0] : '';
      if (!remoteHash) reasons.push(`Branch "${branch}" nie gepusht`);
      else if (remoteHash !== localHash) reasons.push('ungepushte Commits');
    }

    if (reasons.length) ungepusht.push(`${label}: ${reasons.join(' · ')}`);

    const dirty = sh('git status --porcelain', d);
    const count = dirty ? dirty.split('\n').filter(Boolean).length : 0;
    if (count) {
      const ep = parseInt(sh('git log -1 --format=%ct', d) || '0', 10);
      const ageMin = ep ? Math.floor((Date.now() / 1000 - ep) / 60) : 99999;
      if (count > FILE_THRESHOLD || ageMin > AGE_THRESHOLD_MIN) {
        const a = ageMin >= 60 ? `${Math.floor(ageMin / 60)}h${ageMin % 60}m` : `${ageMin}m`;
        offen.push(`${label}: ${count} Datei(en) NICHT COMMITTET (letzter Commit vor ${a})`);
      }
    }
  }

  try { fs.writeFileSync(stamp, String(Date.now())); } catch (e) {}

  if (offen.length || ungepusht.length) {
    const teile = [];
    if (offen.length) {
      teile.push(
        '⚠️  NICHT COMMITTET (ein Absturz kostet diese Arbeit):\n  - ' + offen.join('\n  - ') +
        '\n  -> Zuerst committen: git commit -m "…" -- <pfad> (im Werkbank-Repo Pflicht), dann pushen.'
      );
    }
    if (ungepusht.length) {
      teile.push(
        'ℹ️  COMMITTET, ABER NICHT AUF GITHUB (Historie ohne Zweitkopie):\n  - ' + ungepusht.join('\n  - ') +
        '\n  -> Pushen genuegt; die Arbeit selbst ist bereits gesichert.'
      );
    }
    console.log(JSON.stringify({ systemMessage: teile.join('\n\n') }));
  }
}

if (process.stdin.isTTY) {
  main('');
} else {
  let eingabe = '';
  process.stdin.on('data', (c) => (eingabe += c));
  process.stdin.on('end', () => main(eingabe));
}
```

### 6.5 `.claude/commands/repo-status.md`
```markdown
---
description: Repo-Status -- lokales Git vs GitHub vs Sync fuer Harness + work/-Projekte + Fork
---
Fuehre `node .claude/repo-status.js` im Workspace-Root aus und gib die KOMPLETTE Ausgabe wieder.
Erklaere kurz: Lokales Git = .git auf der Platte; GitHub-Repo = wohin gepusht wird; Sync = ob lokal == GitHub.
Hebe hervor: "NICHT synchron", "KEIN GitHub-Remote", viele Ungesicherte -- das sind die Backup-Luecken.
```

### 6.6 `.claude/commands/save-work.md`
```markdown
---
description: Sichert die ungesicherte Arbeit DIESES Kontexts -- commit + push ins richtige Repo, mit Ansage
---
1. Ziel-Repo ermitteln (aus dem Gespraech; wenn unklar: `node .claude/repo-status.js` zeigen + fragen. NIE raten).
   Moegliche Ziele: die **Werkbank** selbst (cwd) -- oder ein **Projekt-Repo unter
   `user-projects/`**. Die liegen auch ZWEI Ebenen tief (`user-projects/<projekt>/<feature>`),
   (ein Produkt-Fork oder ein Feature-Repo ist typischerweise eines davon).
   `repo-status.js` sucht rekursiv und listet sie alle -- die Liste von dort nehmen,
   keine Pfade aus dem Kopf.
2. `git -C "<repo>" status --porcelain` -- ungesicherte Aenderungen? Wenn nein: fertig.
3. Halbfertig-Check: wenn der Stand kaputt/mittendrin ist, hinweisen und fragen statt blind committen.
4. Committen + pushen NUR im Ziel-Repo via `git -C "<repo>"` (add -A + aussagekraeftige Message + push).
   NIEMALS ins falsche Repo committen (Plugin-Arbeit darf nicht im Harness-Repo landen und umgekehrt).
5. Ansage (VERBINDLICH) vor dem Push: "-> committe + push nach <account>/<repo>".
6. Danach bestaetigen: Repo, Anzahl Dateien, gepusht ja/nein.
```

### 6.7 `CLAUDE.md` — der Architektur-Abschnitt (Auszug, gehört committet)
> Vollständig in der `CLAUDE.md` des Workspace. Kernpunkte:
- Workspace = Harness (eigenes Repo); `user-projects/` = Projekte, jedes eigenes Repo, Ordnername==Repo-Name, Branch `main`.
- Alle Projektordner namentlich in `.gitignore`; **kein Branch pro Projekt**.
- Vor Commit/gitignore-Änderung an `user-projects/<projekt>`: verifizieren, dass es ein eigenes Remote hat und gepusht ist.
- Neuer Ordner → nach Repo fragen; **nie pauschal gitignoren**; Dateien > 100 MB → Cloud; **nie ohne Bestätigung löschen**.
- Session-Start: Projekt-Kontext klären (Hook). Statusleiste zeigt immer den Workspace → bei Projekt-Commits Ziel-Repo ansagen; UI-„PR erstellen" betrifft nur den Workspace.
- Proaktiv committen (nicht auf „commit" warten); `/repo-status` als Kontrolle; `/save-work` zum manuellen Sichern.

---

## 6.8 Werkbank-Waechter, Statusleiste und Sitzungs-Koordination

> **Ergaenzt 31.07.2026.** Diese sechs Bausteine loesen Probleme, die im echten Betrieb
> aufgetreten sind — nicht theoretische. Sie sind **unabhaengig vom Produkt**: Sie brauchen
> nur Git, Node und mehrere verschachtelte Repos. Jeder Standalone-Harness kann sie uebernehmen.
>
> **Warum im Volltext hier:** Diese Dateien **sind** versioniert (§6.2a) — die `.gitignore` holt die
> Eigenbauten unter `.claude/` gezielt zurueck, waehrend der ECC-Fremd-Klon und `settings.local.json`
> draussen bleiben. Der Volltext steht trotzdem hier, weil er den **Nachbau von Null** auf einem
> Rechner ohne dieses Repo traegt und die Begruendung mitliefert; die **gesicherte** Fassung ist das
> Repo, nicht dieses Dokument. Wer einen Eigenbau aendert, zieht die Kopie unten **im selben Commit**
> nach — sonst entsteht wieder die Drift vom 01.08.2026 (§6.2a).
>
> *(Berichtigt 02.08.2026: Hier stand „`.claude/` ist bewusst nicht versioniert (§4). Diese Anleitung
> ist damit der einzige Ort, an dem diese Dateien einen Rechner- oder Personenwechsel ueberleben."
> Beide Haelften waren falsch. §4 sagt zu `.claude/` nichts — er behandelt Plugin-Bindung und
> Branch-Modell. Und seit 01.08.2026 trackt die Werkbank 22 Dateien unter `.claude/`, gemessen mit
> `git ls-files .claude | wc -l`. Genau die Annahme „ist ja im Dokument" hatte die Drift erzeugt, die
> den Beschluss ausgeloest hat.)*

---

### 6.8.1 Regel-Trigger pruefen (der teuerste Fehler, kostet nichts ihn zu finden)

Sprachregeln (`rules/ecc/<sprache>/*.md`) tragen im Frontmatter ein `paths:`-Feld und sollen
**nur bei passendem Dateityp** laden. Drei ECC-Pakete sind ab Werk zu breit verdrahtet und
laden in **jedem TypeScript-Projekt** mit:

| Paket | liefert `paths:` | richtig waere |
|---|---|---|
| `arkts` (HarmonyOS) | `**/*.ts` | `**/*.ets` — so heissen ArkTS-Dateien |
| `react-native` | `**/*.ts`, `**/*.tsx` | `**/metro.config.js`, `**/app.json`, `**/*.native.ts(x)` |
| `vue` | `**/*.ts`, `**/*.tsx`, `**/*.vue` | nur `**/*.vue` |

In dieser Werkbank kostete das **~9.000 Token in jeder Sitzung** — HarmonyOS-Vorschriften
fuer Handy-Apps in einem reinen TypeScript-Projekt. Pruefbefehl nach jedem Regel-Update:

```bash
python3 - <<'EOF'
import glob, re, collections
C = ".claude/rules/ecc"
pat = collections.defaultdict(set)
for p in sorted(glob.glob(f"{C}/*/*.md")):
    pack = p.split("/")[-2]
    t = open(p, encoding="utf-8", errors="ignore").read()
    m = re.match(r"^---\n(.*?)\n---", t, re.S)
    if not m: continue
    for g in re.findall(r'^\s*-\s*"?([^"\n]+)"?\s*$', m.group(1), re.M):
        pat[pack].add(g.strip())
ts = {"**/*.ts", "**/*.tsx"}
for k, v in sorted(pat.items()):
    if ts & v: print(f"{k}: {sorted(ts & v)}")
EOF
```
Erwartet werden **nur** `typescript` und `react`. Alles andere ist ein zu breiter Trigger.

### 6.8.2 Skill-Liste kuratieren, ohne etwas zu loeschen

Claude Code reserviert fuer die Skill-Liste rund **1 % des Kontextfensters**
(`skillListingBudgetFraction`). Bei einer Vollinstallation (277 Skills, ~55.000 Zeichen
Beschreibungen) reicht das nicht: Ab etwa dem 70. Eintrag erscheinen Skills als **nackter
Name ohne Beschreibung** — das Modell kann nicht mehr erkennen, was sie tun, und waehlt
schlechter aus. Mehr Skills bedeuten also **weniger** Faehigkeit, nicht mehr.

Gegenmittel ist nativ und **loescht nichts**: `skillOverrides` in `settings.local.json`.

```jsonc
{
  "skillOverrides": {
    "django-patterns": "user-invocable-only",   // aus dem Modell-Listing raus,
    "flutter-reviewer": "user-invocable-only"   // per /name weiter aufrufbar
  }
}
```

Werte: `on` (Standard) · `name-only` (ohne Beschreibung) · `user-invocable-only`
(nicht im Modell-Listing, aber per `/name` nutzbar) · `off` (ganz aus).

**Vorgehen:** Skills gegen den echten Stack klassifizieren (ECC bringt dafuer `agent-sort`
mit — belegt mit Repo-Funden statt Bauchgefuehl), das Ergebnis messen (`context-budget`),
den Rest auf `user-invocable-only` setzen. Aendert sich der Auftrag, wird ein Eintrag
entfernt und der Skill steht sofort wieder im Listing. **Ein Index-Skill** (unten) haelt
die ausgelagerten auffindbar.

> **Nicht loeschen.** Wer Auftragsarbeit macht, weiss heute nicht, welcher Stack morgen
> kommt. `skillOverrides` ist reversibel, ein `rm -rf` nicht.

### 6.8.3 `.claude/hooks/git-guard.js` — Ziel-Repo ansagen, tote Sperren raeumen

Loest zwei reale Fehlerquellen bei mehreren verschachtelten Repos: Commits landen im
falschen Repo, und verwaiste `.git/index.lock`-Dateien blockieren jeden Commit
(hier an einem Tag dreimal). Blockiert nichts — sagt an und raeumt auf.

```js
#!/usr/bin/env node
// PreToolUse-Hook fuer Bash-Befehle, die mit git beginnen.
// Loest zwei reale Probleme dieses Workspace:
//   1) Commit landet im falschen Repo (7 verschachtelte Repos, Regel war nur Prosa)
//   2) verwaiste .git/index.lock blockieren jeden Commit (an einem Tag 3x passiert)
// Blockiert nichts, sondern raeumt und meldet -- Sichtbarkeit statt Bevormundung.

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const LOCK_MIN_ALTER_MIN = 5; // juenger = laeuft evtl. wirklich
// MSYS/Git-Bash schreibt Windows-Laufwerke als /c/... -- path.resolve() macht daraus
// C:\c\... , einen Pfad den es nicht gibt. Der Waechter meldete dann "liegt in keinem
// Git-Repo", obwohl das Repo da war (belegt 22.08.2026, mehrfach in einer Sitzung).
// Ein Waechter, der bei einem gaengigen Pfadformat Fehlalarme gibt, wird ignoriert.
function msysPfad(p) {
  if (process.platform !== "win32" || !p) return p;
  return String(p).replace(/^\/([A-Za-z])(?=\/|$)/, "$1:");
}


function sh(cmd, cwd) {
  try {
    return execSync(cmd, { cwd, encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

function laeuftGit() {
  // [Mac->Win-Fix 21.08.2026, U2] Prozessliste plattformabhaengig. 'ps -Ao' existiert
  // unter Windows nicht (weder cmd.exe noch das MSYS-ps der Git-Bash kennen -A/-o) ->
  // sh() gab null -> laeuftGit() lieferte IMMER false -> die 0-Byte-index.lock wurde
  // auch geloescht, waehrend eine Parallel-Sitzung real ein git hielt (Index-Beschaedigung).
  const roh =
    process.platform === "win32"
      ? sh('tasklist /FI "IMAGENAME eq git.exe" /NH')
      : sh("ps -Ao command=");
  // Fail-SAFE statt fail-open: laesst sich die Prozessliste nicht ermitteln (null),
  // konservativ annehmen, dass git laeuft -> die Lock NICHT entfernen. Ein stehender
  // Hinweis ist harmlos, eine zerschossene Index-Datei nicht.
  if (roh == null) return true;
  if (process.platform === "win32") return /(^|\s)git\.exe\b/i.test(roh);
  return roh.split("\n").some((z) => /(^|\/)git(\s|$)/.test(z.trim()));
}

let eingabe = "";
process.stdin.on("data", (c) => (eingabe += c));
process.stdin.on("end", () => {
  let daten = {};
  try {
    daten = JSON.parse(eingabe || "{}");
  } catch {}
  const befehl = daten?.tool_input?.command || "";
  if (!/\bgit\b/.test(befehl)) return process.exit(0);

  const meldungen = [];

  // --- Ziel-Repo bestimmen: -C <pfad> gewinnt, sonst cd im selben Befehl, sonst cwd ---
  // PreToolUse laeuft VOR der Ausfuehrung: bei "cd X && git ..." hat das cd zur
  // Hook-Zeit noch nicht stattgefunden -- nur cwd zu lesen meldet dann das falsche
  // Ziel-Repo, ohne Warnung. Deshalb zaehlt das letzte cd VOR dem git-Wort mit;
  // ein relatives -C loest sich gegen dieses cd auf.
  // Bekannte Grenzen: Text in Anfuehrungszeichen (echo/printf/-m) wird mitgelesen;
  // Shell-Variablen in Pfaden bleiben unexpandiert und werden als "nicht pruefbar"
  // gemeldet statt als Fehlwarnung.
  const gitPos = befehl.search(/\bgit\b/);
  const cdRe = /(?:^|&&|;|\|\|)\s*cd\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/g;
  let cdPfad = null;
  let basis = process.cwd();
  let basisUnpruefbar = false;
  let cdTreffer;
  // KETTE statt nur letztes cd (angeglichen an commit-pathspec-guard, 01.08.2026):
  // "cd /tmp && … && cd unterordner && git …" landet sonst in <cwd>/unterordner statt
  // /tmp/unterordner -- und der Waechter meldet ein Ziel-Repo, das es nicht gibt.
  // Shell-Variablen im cd-Pfad machen die Basis unaufloesbar (der Hook sieht den Befehl
  // VOR der Expansion) -- dann wird "nicht pruefbar" gemeldet statt einer Fehlwarnung.
  // Beides live an sich selbst gefunden, 01.08.2026.
  while ((cdTreffer = cdRe.exec(befehl)) && cdTreffer.index < gitPos) {
    cdPfad = cdTreffer[1] || cdTreffer[2] || cdTreffer[3];
    if (cdPfad.includes("$")) basisUnpruefbar = true;
    else if (path.isAbsolute(msysPfad(cdPfad))) basisUnpruefbar = false;
    basis = path.resolve(basis, msysPfad(cdPfad));
  }
  const mC = befehl.match(/git\s+-C\s+(?:"([^"]+)"|'([^']+)'|(\S+))/);
  const zielRoh = mC ? mC[1] || mC[2] || mC[3] : cdPfad;
  const ziel = mC ? path.resolve(basis, msysPfad(zielRoh)) : basis;
  const top = sh("git rev-parse --show-toplevel", ziel);

  // --- 1) Verwaiste Locks raeumen (im Ziel-Repo) ---
  if (top) {
    const lock = path.join(top, ".git", "index.lock");
    try {
      const st = fs.statSync(lock);
      const alterMin = (Date.now() - st.mtimeMs) / 60000;
      if (st.size === 0 && alterMin > LOCK_MIN_ALTER_MIN && !laeuftGit()) {
        fs.unlinkSync(lock);
        meldungen.push(
          `Verwaiste .git/index.lock entfernt (0 Byte, ${Math.round(alterMin)} min alt, kein git-Prozess) in ${path.basename(top)}`
        );
      } else if (st.size === 0 && alterMin > LOCK_MIN_ALTER_MIN) {
        meldungen.push(`ACHTUNG: index.lock in ${path.basename(top)} ist ${Math.round(alterMin)} min alt, aber ein git-Prozess laeuft -- nicht entfernt.`);
      }
    } catch {}
  }

  // --- 2) Bei schreibenden Befehlen: Ziel-Repo ansagen ---
  // Achtung: -C-Pfade enthalten oft Leerzeichen (ein Ordnername darf welche
  // haben, und der dieses Bau-Rechners hat sie) -- deshalb NICHT ueber \S+
  // mitmatchen, sondern das Verb unabhaengig suchen.
  if (/\b(commit|push|merge|rebase|reset|checkout|switch)\b/.test(befehl) || /\bgit\s+(-C\s+.+\s+)?add\b/.test(befehl)) {
    if (!top) {
      // Shell-Variablen ($L, $WB) erreichen den Hook UNexpandiert -- PreToolUse sieht
      // den Roh-Befehl. "liegt in keinem Repo" waere dann ein Fehlalarm; ehrlich ist
      // nur "nicht pruefbar".
      if ((zielRoh && zielRoh.includes("$")) || basisUnpruefbar) {
        const was = zielRoh && zielRoh.includes("$") ? `Ziel "${zielRoh}"` : `ein cd-Pfad im Befehl`;
        meldungen.push(`${was} enthaelt eine Shell-Variable -- fuer den Waechter nicht pruefbar (er sieht den Befehl vor der Expansion).`);
      } else {
        meldungen.push(`WARNUNG: "${ziel}" liegt in keinem Git-Repo -- der Befehl greift ins Leere.`);
      }
    } else {
      const branch = sh("git rev-parse --abbrev-ref HEAD", top) || "?";
      const remote = (sh("git remote get-url origin", top) || "(kein Remote)")
        .replace(/.*github\.com[:/]/, "")
        .replace(/\.git$/, "");
      // Werkbank = das Wurzel-Repo dieses Workspace. NICHT den Namen fest
      // verdrahten -- sonst meldet der Waechter in jedem nachgebauten Harness
      // Unsinn. CLAUDE_PROJECT_DIR setzt Claude Code selbst.
      const werkbank = process.env.CLAUDE_PROJECT_DIR
        ? sh("git rev-parse --show-toplevel", process.env.CLAUDE_PROJECT_DIR)
        : null;
      const istWerkbank = werkbank ? top === werkbank : false;
      const hinweis =
        !mC && werkbank && !istWerkbank
          ? cdPfad
            ? `  <- cd im Befehl erkannt; Konvention bleibt git -C (CLAUDE.md, Sichern).`
            : `  <- OHNE -C: landet in ${path.basename(top)}, nicht in ${path.basename(werkbank)} -- cwd aus frueherem cd ist unsichtbarer Zustand. Absicht?`
          : "";
      meldungen.push(`Ziel-Repo: ${path.basename(top)} [${branch}] -> ${remote}${hinweis}`);
    }
  }

  if (meldungen.length) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          additionalContext: "git-guard: " + meldungen.join(" | "),
        },
      })
    );
  }
  process.exit(0);
});
```

### 6.8.4 `.claude/statusline.js` — zeigen, wo man wirklich ist

Die Standard-Statusleiste zeigt immer nur den Workspace-Namen. Bei sieben verschachtelten
Repos ist das irrefuehrend. Diese zeigt **Repo · Branch · Sicherungsstand**
(`✓` sauber / `↑N` ungepusht / `✗N` ungesichert). Ohne Netzwerkaufrufe, mit
`--no-optional-locks` (kann also keine Sperren ausloesen) und 800-ms-Zeitlimit.

```js
#!/usr/bin/env node
// Statusline fuer den Workspace: zeigt NICHT den Workspace-Namen,
// sondern das Repo, dessen .git fuer den aktuellen cwd tatsaechlich zustaendig
// ist (Werkbank ODER eines der verschachtelten Projekt-Repos unter
// user-projects/), plus Branch und Sicherungsstatus (ungepushte Commits +
// ungesicherte Dateien). Bekommt das Session-JSON von Claude Code auf stdin.
//
// Rein lokal, keine Netzwerkaufrufe / kein `git fetch`: der ahead-Zaehler
// basiert auf dem zuletzt bekannten Remote-Tracking-Stand -- genau wie bei
// jedem normalen Shell-Prompt (starship, oh-my-zsh & Co). Jeder Git-Aufruf
// ist per Timeout gedeckelt und nutzt --no-optional-locks, damit weder ein
// haengender Prozess noch ein Index-Lock-Konflikt die Statusleiste blockiert.
//
// Vorlage/Referenz: .claude/repo-status.js (dort: voller Report statt Einzeiler).

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const WORKSPACE = path.resolve(__dirname, '..'); // = die Workspace-Wurzel
const GIT_TIMEOUT_MS = 800;

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); }
  catch (e) { return ''; }
}

function sh(cmd, cwd) {
  try {
    return execSync(cmd, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: GIT_TIMEOUT_MS }).trim();
  } catch (e) {
    return null;
  }
}

// Naechstes .git ab startDir nach oben suchen -- das ist "das zustaendige Repo".
// .git kann Verzeichnis (normales Repo) ODER Datei (Worktree) sein.
function findRepoRoot(startDir) {
  let dir = startDir;
  while (dir) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null; // Dateisystem-Wurzel erreicht
    dir = parent;
  }
  return null;
}

// Kompaktes Label: Werkbank -> Ordnername; verschachteltes Projekt-Repo ->
// Pfad relativ zur Werkbank, ohne das immer gleiche "user-projects/"-Praefix
// (z.B. "projekt/feature" statt "user-projects/projekt/feature").
function repoLabel(repoRoot) {
  if (repoRoot === WORKSPACE) return path.basename(WORKSPACE);
  const rel = path.relative(WORKSPACE, repoRoot).split(path.sep).join('/');
  // Liegt das Repo NICHT unterhalb der Werkbank (fremder Ordner, anderer
  // Nachbau), waere der relative Pfad eine "../../.."-Kette. Dann nur der
  // Ordnername -- sonst ist die Leiste in jedem fremden Repo unlesbar.
  if (rel.startsWith('..')) return path.basename(repoRoot);
  return rel.replace(/^user-projects\//, '');
}

// -- ANSI-Farben -- die Statusleiste wird sonst gedimmt dargestellt, eigene
// Codes bleiben aber sichtbar (nicht entfernen).
const c = {
  reset: '\x1b[0m', dim: '\x1b[2m',
  cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m',
};
const paint = (color, text) => `${color}${text}${c.reset}`;
const SEP = paint(c.dim, ' · ');

let input = {};
try { input = JSON.parse(readStdin() || '{}'); } catch (e) { input = {}; }

const cwd = (input.workspace && input.workspace.current_dir) || input.cwd || process.cwd();
const repoRoot = findRepoRoot(cwd); // findRepoRoot ist bereits fs.existsSync-sicher

if (!repoRoot) {
  console.log(paint(c.dim, `${path.basename(cwd)} (kein Git-Repo)`));
  process.exit(0);
}

const branch = sh('git --no-optional-locks rev-parse --abbrev-ref HEAD', repoRoot) || '?';

// -- Push-Status: rein lokal --------------------------------------------------
const remoteUrl = sh('git --no-optional-locks remote get-url origin', repoRoot);
const upstream = sh('git --no-optional-locks rev-parse --abbrev-ref --symbolic-full-name @{u}', repoRoot);

let syncLabel = null; // nur im Ausnahmefall gesetzt (kein Remote / nie gepusht)
let ahead = 0;
if (!remoteUrl) {
  syncLabel = paint(c.red, 'kein Remote');
} else if (!upstream) {
  syncLabel = paint(c.red, 'nie gepusht');
} else {
  const aheadStr = sh(`git --no-optional-locks rev-list --count ${upstream}..HEAD`, repoRoot);
  ahead = aheadStr ? parseInt(aheadStr, 10) || 0 : 0;
}

// -- ungesicherte Dateien -------------------------------------------------
const statusOut = sh('git --no-optional-locks status --porcelain', repoRoot);
const dirty = statusOut ? statusOut.split('\n').filter(Boolean).length : 0;

// -- Zusammenbauen ----------------------------------------------------------
const statusBits = [];
if (syncLabel) statusBits.push(syncLabel);
else if (ahead > 0) statusBits.push(paint(c.yellow, `↑${ahead}`));
if (dirty > 0) statusBits.push(paint(c.red, `✗${dirty}`));

const statusSegment = statusBits.length ? statusBits.join(' ') : paint(c.green, '✓');

console.log([paint(c.cyan, repoLabel(repoRoot)), paint(c.dim, branch), statusSegment].join(SEP));
```

### 6.8.5 `.claude/hooks/session-roles.js` — Sitzungen wissen voneinander

Mehrere Sitzungen arbeiten parallel im selben Ordner. Ohne Hilfe kennt keine die anderen —
mit der Folge, dass eine Sitzung tagelang auf einem ueberholten Fakt weiterbaut. Dieser
SessionStart-Hook liest die Rollen-Tabelle aus `docs/08-sessions-rollen.md` und gibt sie
**jeder** Sitzung mit. Fehlt die Datei, bleibt er still.

```js
#!/usr/bin/env node
// SessionStart-Hook: gibt jeder neuen Sitzung die Rollen-Tabelle aus
// docs/08-sessions-rollen.md mit -- damit Sitzungen voneinander wissen,
// ohne dass jemand einen Befehl tippt. Plus die Melde-Regel.
//
// Bewusst kurz gehalten: laeuft in JEDER Sitzung, kostet also dauerhaft Kontext.
// Nur Titel + Ebene + Kurzzweck, kein Fliesstext.

const fs = require("fs");
const path = require("path");

const WURZEL = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..");
const QUELLE = path.join(WURZEL, "docs", "08-sessions-rollen.md");
const MAX_ZWECK = 110; // Zeichen je Zweck-Spalte

// SessionStart feuert bei VIER Anlaessen: startup · resume · clear · compact.
// Bis zum 03.08.2026 las dieses Skript die Hook-Eingabe gar nicht und schickte
// darum bei JEDEM davon "/i-have-adhd" erneut in den Gespraechsverlauf -- also
// auch mitten in der Arbeit bei jedem Auto-Compact, ohne dass ein Mensch etwas
// getippt hatte. Bei zwei Anlaessen kurz hintereinander doppelt.
// [Anlass: der Befehl feuerte doppelt hintereinander, ohne Nutzereingabe.]
//
// Die Rollen-Tabelle bleibt bei ALLEN vier richtig -- nach einem Compact ist sie
// aus dem Fenster und wird gebraucht. Nur der Slash-Befehl darf sich nicht
// wiederholen: er ist eine Nutzer-Anweisung, und die gilt fuer die ganze Sitzung.
function anlass() {
  try {
    const roh = fs.readFileSync(0, "utf8");
    return JSON.parse(roh).source || "";
  } catch {
    return ""; // keine Eingabe lesbar -> unten als "nicht startup" behandelt
  }
}

function zeilen() {
  let text;
  try {
    text = fs.readFileSync(QUELLE, "utf8");
  } catch {
    return null; // Datei fehlt (z.B. frischer Nachbau) -> Hook bleibt still
  }
  const treffer = [];
  for (const z of text.split("\n")) {
    // Nur Datenzeilen der Rollen-Tabelle: | **Titel** | Ebene | Zweck | ... |
    if (!z.startsWith("|") || z.includes("---") || z.includes("Session (Titel)")) continue;
    const sp = z.split("|").map((s) => s.trim()).filter(Boolean);
    if (sp.length < 3) continue;
    const titel = sp[0].replace(/\*\*/g, "").replace(/\s*\(diese[^)]*\)/, "").trim();
    const ebene = sp[1].replace(/\*\*/g, "").trim();
    let zweck = sp[2].replace(/\*\*/g, "").replace(/`/g, "").trim();
    if (zweck.length > MAX_ZWECK) zweck = zweck.slice(0, MAX_ZWECK).replace(/\s\S*$/, "") + " …";
    if (titel && ebene) treffer.push(`- ${titel} [${ebene}]: ${zweck}`);
  }
  return treffer.length ? treffer : null;
}

// [Bug-Fix 21.08.2026, Baustelle 2a] Rollen-Load und Antwortform-Skill-Load ENTKOPPELT.
// Vorher stand hier `if (!rollen) process.exit(0)` -- im Solo-Betrieb (keine
// docs/08-sessions-rollen.md) stieg der Hook damit aus, BEVOR der /i-have-adhd-Aufruf
// kam; frische Sessions bekamen den Antwortform-Skill NIE. Jetzt: Rollen-Tabelle nur,
// wenn vorhanden -- aber der Skill-Aufruf laeuft bei jedem "startup" unabhaengig davon.
const rollen = zeilen();
const rollenText = rollen
  ? [
      "Sitzungs-Rollen dieses Workspace (aus docs/08-sessions-rollen.md, automatisch geladen).",
      "Es arbeiten mehrere Sitzungen parallel im selben Ordner:",
      ...rollen,
      "",
      "MELDE-REGEL: Aenderst oder findest du einen Fakt, auf dem eine ANDERE Rolle aufbaut",
      "(Pfad, Repo-/Branch-Name, Datenbank, ein Beschluss), dann schick ihn ihr per /tell-session,",
      "statt ihn nur zu notieren. Gehoert eine Aufgabe erkennbar einer anderen Rolle: dorthin",
      "uebergeben, nicht selbst machen. Ueberblick: /session-map",
    ].join("\n")
  : null;

// initialUserMessage wird wie eine ECHTE Nutzer-Nachricht verarbeitet, Slash-Befehle
// eingeschlossen (offizielle Doku, Beispiel dort: "/read CLAUDE.md"). Damit laedt der
// Antwortform-Skill beim Sitzungsstart von selbst.
//
// NUR BEI "startup" -- und der Grund ist ein Schaden, kein Schoenheitsfehler
// [Auftraggeber, 03.08.2026, mit Bildbeleg]: Bis heute las dieses Skript die Hook-Eingabe nicht
// und feuerte bei ALLEN VIER Anlaessen. Bei "resume" und "compact" faellt der Slash-Befehl
// damit MITTEN IN EIN LAUFENDES GESPRAECH. Die Sitzung verarbeitet ihn als aktuelle
// Nutzer-Nachricht -- und beantwortet daraufhin die echte Frage des Menschen nicht mehr.
// Gemessen im Protokoll dieser Sitzung: sechs Einschuebe, zweimal unmittelbar
// hintereinander ohne jede Nutzer-Eingabe dazwischen (Positionen 1652/1653 und 1771/1772).
//
// Die Rollen-Tabelle bleibt bei allen vier Anlaessen richtig: nach einem Compact ist sie
// aus dem Fenster und wird gebraucht. Nur der Slash-Befehl darf sich nicht wiederholen --
// eine Nutzer-Anweisung gilt fuer die ganze Sitzung, nicht pro Ereignis.
//
// WARUM NICHT DEN SKILL-TEXT EINBLENDEN: der Aufruf kostet 14 Zeichen, der Volltext
// 6.848 -- und nur der Aufruf hat das Gewicht einer Nutzer-Anweisung.
const ausgabe = { hookEventName: "SessionStart" };
if (rollenText) ausgabe.additionalContext = rollenText;
if (anlass() === "startup") ausgabe.initialUserMessage = "/i-have-adhd";

// Weder Rollen noch startup (z.B. resume/compact ohne docs/08) -> still bleiben.
if (!ausgabe.additionalContext && !ausgabe.initialUserMessage) process.exit(0);

process.stdout.write(JSON.stringify({ hookSpecificOutput: ausgabe }));
```

Der Umfang **waechst mit jeder Rolle** -- deshalb keine feste Zahl in den Text, sondern
der Befehl, der sie erzeugt. Diese Werkbank am 01.08.2026, zwoelf Rollen: **2.696 Bytes**,
grob **700 Token**. Die erste Schaetzung stand bei ~240 und ist stillschweigend mitgewachsen.

```bash
node .claude/hooks/session-roles.js | jq -r .hookSpecificOutput.additionalContext | wc -c
```

> **Fallstrick:** Der Hook liest **jede** Tabellenzeile der Quelldatei, die mit `|` beginnt --
> auch eine Uebersichtstabelle ganz oben. Was in einer Zelle steht, landet in **jeder** Sitzung.
> Erklaerungen gehoeren in den Fliesstext, nicht in eine Zelle.

### 6.8.6 Die zwei Sitzungs-Befehle

`.claude/commands/session-map.md`:

```markdown
---
description: Overview of all sessions in this workspace -- who is running, which role, last activity, plus repo status
---

Verschaffe einen Ueberblick ueber alle Sessions dieses Workspace und melde ihn kurz.

1. `mcp__ccd_session_mgmt__list_sessions` aufrufen.
2. Rollen aus `docs/08-sessions-rollen.md` (Rollen-Tabelle) zuordnen.
3. Je Session eine Zeile: `Titel | Rolle laut docs/08 | laeuft ja/nein | letzte Aktivitaet`.
4. Sessions, die in `list_sessions` auftauchen, aber NICHT in `docs/08` stehen,
   ausdruecklich als **"Rolle nicht definiert"** markieren -- das ist der haeufigste
   Koordinationsfehler in diesem Workspace.
5. Danach `node .claude/repo-status.js` und in zwei Zeilen sagen, ob irgendwo
   etwas ungesichert oder ungepusht ist.

Regeln:
- Fremde Transkripte NICHT ungefragt auslesen. Ist der Stand einer Session unklar,
  das sagen statt zu raten (`list_events` nur auf Ansage).
- Keine Vermutungen ueber Inhalte anderer Sessions -- nur Titel, Rolle, Zeit, Status.
```

`.claude/commands/tell-session.md`:

```markdown
---
description: Send a finding or handoff to another session in this workspace (it arrives there as a labelled message)
---

Schicke einer anderen Session dieses Workspace eine Nachricht. Argument (optional):
Zielsession und/oder Inhalt. Ist nichts angegeben, aus dem Gespraechsverlauf ableiten
und vor dem Senden bestaetigen lassen.

Ablauf:
1. `mcp__ccd_session_mgmt__list_sessions` -- Zielsession anhand des Titels finden.
   Passt keiner eindeutig, die Kandidaten zeigen und fragen. NIE raten.
2. Nachricht formulieren. **DREI ZEILEN, mehr nicht** -- der Empfaenger ist eine
   Maschine mit eigenem Kontextfenster, kein Mensch:

       <Fakt> — <was sich fuer DICH aendert>.
       Beleg: <datei:zeile | commit | befehl>
       Zu tun: <eine Sache>            (weglassen, wenn nichts zu tun ist)

   NICHT hinein: Dank · Lob · Entschuldigung · Wiederholung dessen, was die
   Gegenseite gerade gemeldet hat · Herleitung, wie du darauf kamst ·
   Rueckblick auf deinen eigenen Irrtum · Code-Bloecke, die sie selbst
   ausfuehren kann · Tabellen · Zwischenueberschriften.

   **Verweis statt Inhalt.** Dem Menschen gegenueber gilt das Umgekehrte (er soll
   nicht wuehlen); eine Session kann lesen, hat dieselben Dateien, und eine Kopie
   fuellt ihr Fenster und driftet, sobald die Quelle sich aendert.

   Gut: "Der Branch heisst jetzt wp3-anbindung, nicht mehr feature/anbindung.
   Der alte ist geloescht. Betrifft deinen Install-Schritt 3."
   Schlecht: "Wir haben eben besprochen, dass sich was geaendert hat."

   Schlecht (real, 03.08.2026, 2.932 Zeichen an HARNESS CONTROL): eine Nachricht mit
   drei Zwischenueberschriften, einem Code-Block, zwei Absaetzen Herleitung und dem
   Satz "Danke fuers Nachmessen statt Glauben". Der Kern waren zwei Saetze.

   **Pruefsatz vor dem Senden: Weiss die andere Session nach der ERSTEN ZEILE, was
   sich fuer SIE aendert?** Wenn nein, ist die erste Zeile falsch.
   Gemessen 03.08.2026: 63 Sitzungs-Nachrichten, Median 1.378 Zeichen, zusammen
   89.905 -- in fremde Kontextfenster geschrieben. Ziel sind ~300.
3. Sind Ziel UND Anlass eindeutig, direkt senden -- NICHT nachfragen. Die Melderegel
   in `docs/08-sessions-rollen.md` ist die stehende Freigabe (Auftraggeber, 31.07.2026:
   "wieso fragst du zu senden? sowas muss doch von alleine gehen"). Eine Rueckfrage
   macht aus einer gesetzten Regel eine Einzelfallentscheidung.
   Nur wenn Ziel oder Inhalt erst aus dem Verlauf ERRATEN werden muessen (der Fall
   aus dem Kopf dieser Datei): vorher Ziel und Text zeigen und bestaetigen lassen.
4. `mcp__ccd_session_mgmt__send_message` mit `session_id` und `message`.
5. Bestaetigen: an welche Session, welcher Kern.

Wann das benutzt wird (Regel des Workspace):
- Ein Fakt aendert sich, den eine andere Session als Grundlage benutzt
  (Pfad, Repo-Name, DB, Branch, ein Beschluss).
- Eine Aufgabe gehoert erkennbar einer anderen Rolle (`docs/08-sessions-rollen.md`)
  -- dann dorthin uebergeben statt selbst zu machen.
- NICHT zum Fernsteuern anderer Sessions und nicht fuer Hintergrundarbeit.

Grenze: In unbeaufsichtigten Sessions (geplante Laeufe) ist das Senden gesperrt --
dort stattdessen den Befund in eine Datei im Repo schreiben.
```
   <Fakt> — <was sich fuer DICH aendert>.
   Beleg: <datei:zeile | commit | befehl>
   Zu tun: <eine Sache>            (weglassen, wenn nichts zu tun ist)
   ```

   NICHT hinein: Dank · Lob · Entschuldigung · Wiederholung dessen, was die
   Gegenseite gerade gemeldet hat · Herleitung, wie du darauf kamst ·
   Rueckblick auf deinen eigenen Irrtum · Code-Bloecke, die sie selbst
   ausfuehren kann · Tabellen · Zwischenueberschriften.

   **Verweis statt Inhalt.** Dem Menschen gegenueber gilt das Umgekehrte (er soll
   nicht wuehlen); eine Session kann lesen, hat dieselben Dateien, und eine Kopie
   fuellt ihr Fenster und driftet, sobald die Quelle sich aendert.

   Gut: "Die Live-DB heisst jetzt <board> (ref <db-ref>...). <alt-board> ist
   nur noch Backup -- keine Writes. Betrifft deinen Install-Schritt 3."
   Schlecht: "Wir haben eben besprochen, dass sich was geaendert hat."

   Schlecht (real, 03.08.2026, 2.932 Zeichen an HARNESS CONTROL): eine Nachricht mit
   drei Zwischenueberschriften, einem Code-Block, zwei Absaetzen Herleitung und dem
   Satz "Danke fuers Nachmessen statt Glauben". Der Kern waren zwei Saetze.

   **Pruefsatz vor dem Senden: Weiss die andere Session nach der ERSTEN ZEILE, was
   sich fuer SIE aendert?** Wenn nein, ist die erste Zeile falsch.
   Gemessen 03.08.2026: 63 Sitzungs-Nachrichten, Median 1.378 Zeichen, zusammen
   89.905 -- in fremde Kontextfenster geschrieben. Ziel sind ~300.
3. Sind Ziel UND Anlass eindeutig, direkt senden -- NICHT nachfragen. Die Melderegel
   in `docs/08-sessions-rollen.md` ist die stehende Freigabe (Auftraggeber, 31.07.2026:
   "wieso fragst du zu senden? sowas muss doch von alleine gehen"). Eine Rueckfrage
   macht aus einer gesetzten Regel eine Einzelfallentscheidung.
   Nur wenn Ziel oder Inhalt erst aus dem Verlauf ERRATEN werden muessen (der Fall
   aus dem Kopf dieser Datei): vorher Ziel und Text zeigen und bestaetigen lassen.
4. `mcp__ccd_session_mgmt__send_message` mit `session_id` und `message`.
5. Bestaetigen: an welche Session, welcher Kern.

Wann das benutzt wird (Regel des Workspace):
- Ein Fakt aendert sich, den eine andere Session als Grundlage benutzt
  (Pfad, Repo-Name, DB, Branch, ein Beschluss).
- Eine Aufgabe gehoert erkennbar einer anderen Rolle (`docs/08-sessions-rollen.md`)
  -- dann dorthin uebergeben statt selbst zu machen.
- NICHT zum Fernsteuern anderer Sessions und nicht fuer Hintergrundarbeit.

Grenze: In unbeaufsichtigten Sessions (geplante Laeufe) ist das Senden gesperrt --
dort stattdessen den Befund in eine Datei im Repo schreiben.
```

`$CLAUDE_PROJECT_DIR` statt eines absoluten Pfades — sonst bricht jeder Rechnerwechsel.

Der zweite Stop-Eintrag (`pruefstand-warn.js`) gilt **nur für diese Werkbank**: er ruft `docs/workflows/anleitung-drift.js` und `docs/workflows/eigenbau-ungesichert.js`, die kein Nachbau hat. Wer nachbaut, lässt ihn weg — §6.8.11a.

**Pruefen (Pflicht, sonst faellt ein Tippfehler erst Wochen spaeter auf):**
```bash
jq -e '.hooks.PreToolUse[] | select(.matcher=="Bash") | .hooks[].command' .claude/settings.local.json
jq -e '(.permissions.allow|length), (.hooks|keys), .statusLine.type' .claude/settings.local.json
```

### 6.8.8 Was sofort wirkt und was einen Neustart braucht

**„Neustart" heißt hier: die App neu starten und die Session FORTSETZEN.** Nie eine neue
Session anlegen, um eine Harness-Änderung zu übernehmen — eine Session trägt Rolle, Verlauf
und Arbeitsstand; das ist genau der Kontext, den man nicht opfert. Beim Fortsetzen liest der
Client alle Einstellungen frisch, der Gesprächskontext bleibt.

| Baustein | Laufende Sitzungen | Grund |
|---|---|---|
| Regel-Trigger (6.8.1) | **sofort** | Regeln laden pro Datei-Zugriff |
| `git-guard` (6.8.3) | **sofort** | Hooks werden live nachgeladen |
| `danger-guard` (6.8.9) | **sofort** | dito — Hooks werden live nachgeladen |
| Slash-Befehle (6.8.6) | **sofort** | werden beim Aufruf gelesen |
| **Neuer** Skill oder Befehl (Ordner/Datei angelegt oder geändert) | **sofort** | **gemessen 01.08.2026**: Wegwerf-Ordner `.claude/skills/_probe-live-tmp/` angelegt → in der laufenden Sitzung sofort im Listing angekündigt, ohne Neustart. Dreimal am selben Tag unabhängig beobachtet (`tell-session.md` und `save-work.md` nach dem Bearbeiten, zwei neue Skill-Ordner einer Nachbar-Sitzung) |
| Skill-**Kuratierung** (6.8.2, `skillOverrides`) | **sofort** | **gemessen 01.08.2026.** Die Frage war lange nicht zu beantworten, weil sie auf ein **Verschwinden** zielt — und ein Eintrag, der aus dem Listing fällt, ist in der laufenden Sitzung unsichtbar. Gelöst durch Umdrehen in ein **positives** Signal: erst einen Override für einen Namen eintragen, den es noch nicht gibt, **danach** den Skill-Ordner anlegen. Bleibt die Ankündigung aus, hat der Override live gegriffen. Ergebnis: **keine Ankündigung** über zwei Werkzeug-Fenster — gegen die Kontrolle, dass ein Ordner **ohne** Override sofort angekündigt wird (Zeile darüber). Beide Ausgänge liefern ein sichtbares Ergebnis, keiner Schweigen |
| Statusleiste (6.8.4) | **App-Neustart + Fortsetzen** | Einstellung wird beim Start des Session-Prozesses gelesen |
| Sitzungs-Rollen (6.8.5) | **sofort ab nächstem Kontext-Beginn** | Hook ohne Matcher feuert bei jedem SessionStart-Ereignis (frisch, fortgesetzt, geleert, verdichtet) — eine Ereignis-Aufzählung ist die Falle (§6.8.7) |

### 6.8.9 `.claude/hooks/danger-guard.js` — Regeln, die nicht gelesen werden müssen

`git-guard` (§6.8.3) **sagt an**. Dieser hier **blockiert** (`exit 2`). Der Unterschied ist der
Zweck: Ansagen helfen beim Nachdenken, Blockieren hilft, wenn nicht nachgedacht wurde.

**Warum das ein Hook ist und keine Regel im Text:** eine Prosa-Regel wirkt nur, wenn sie gelesen
*und* befolgt wird. Genau das ist hier real ausgefallen — die Regel „nie außerhalb des
Arbeitsbereichs schreiben" stand im Gedächtnis, und trotzdem landeten 5,7 MB samt der Datei mit
allen ohne Nachfrage erlaubten Shell-Befehlen auf dem Schreibtisch. Deterministischer Code
kostet null Tokens, läuft vor jedem Bash-Aufruf und ist nicht überredbar.
*(Das ist die Messbarkeitsprobe G4 aus [11](completeness-check.md): eine Zusage, die
nur von einer Beurteilung abhängt, wird strukturell gemacht.)*

Fünfzehn Regeln — acht ursprüngliche, sieben am 01.08.2026 nachgerüstet (Beschluss **D5**;
Prinzip aus „destructive command guard", dessen Lizenz-Rider die Übernahme des Codes verbietet,
als Eigenbau) — jede aus einem realen Vorfall, einer Eigenschaft dieses Aufbaus oder einer
gemessenen Lücke:

| Regel | Warum sie existiert |
|---|---|
| Schreiben/Löschen unter `$HOME` außerhalb des Arbeitsbereichs | der Schreibtisch-Vorfall; erlaubt bleiben Werkbank, `/tmp`, `~/.claude` |
| `rm -rf` auf Heimat, Wurzel oder `~/*` | der Klassiker, gegen den es keine Reue gibt |
| `rm -rf` auf die Werkbank-Wurzel selbst | löscht alle Projekt-Repos in einem Zug |
| `rm -r` auf einen Systempfad | `/usr`, `/etc`, `/Applications` |
| **`git clean -fdx`** | `.claude/` ist **gitignored** — `-x` löscht den kompletten Harness, und git kann ihn *nicht* zurückholen. Trockenlauf (`-n`) bleibt erlaubt |
| `dd of=/dev/…`, `mkfs` | schreibt am Dateisystem vorbei |
| `chmod -R 777`, `sudo rm` | Rechte aufreißen bzw. löschen mit Systemrechten |
| `git push --force`/`-f` (ohne `--force-with-lease`) | veröffentlichte Historie wird nie umgeschrieben (CLAUDE.md, Branches) |
| `git reset --hard` · `checkout -- <pfad>` · `restore` (Arbeitsbaum) · `stash drop/clear` | verwerfen uncommittete Arbeit — Löschung braucht ein Go; reines `restore --staged` bleibt erlaubt |
| `git branch -D` | kleines `-d` weigert sich bei Ungemergtem — der sichere Weg bleibt frei |
| `git clean -f` (ohne Trockenlauf `-n`) | löscht Ungetracktes unwiederbringlich; `-n` bleibt erlaubt |
| Destruktives im Interpreter-Flag (`python3 -c "…rmtree…"`, `bash -c "rm -rf …"`) | lief bisher an allen rm-Regeln vorbei — der Wächter prüfte nur den Befehls-Kopf |

#### Zwei Fallen, die beide erst im Einsatz auftraten

**1 — Pfade mit Leerzeichen.** Trifft jeden Nachbau, dessen Pfad eines enthält (`Meine Projekte`,
`My Documents`, …): ein Token-Muster schneidet solche Pfade nach dem ersten Wort ab. Der Rest
sieht aus wie ein fremder Pfad, und der Wächter blockiert das **eigene** Arbeitsverzeichnis.
Deshalb prüft `fremdePfade()` zusätzlich am *ungeschnittenen* Text, ob dort ein erlaubtes
Wurzelverzeichnis beginnt. Ohne diesen Zusatz scheiterten 3 von 38 Fällen — darunter jedes `cp`
in die eigene Werkbank.

**2 — Text über einen Befehl ist nicht der Befehl.** Der erste Entwurf blockierte den *Commit*,
mit dem er selbst gesichert werden sollte: die Commit-Nachricht beschrieb `rm -rf` und
`git clean -fdx`, und der Wächter las das als Befehl. Damit wäre jede Commit-Nachricht, jede
Doku-Zeile und jedes `grep 'rm -rf'` blockiert — und ein Wächter mit dieser Trefferquote wird
binnen eines Tages abgeschaltet. Zwei Vorstufen beheben es:

| Vorstufe | Wirkung |
|---|---|
| `ohneHeredocs()` | Heredoc-Rümpfe sind **Daten** (Commit-Nachrichten, geschriebene Dateien) und werden vor der Prüfung entfernt |
| `segmente()` + `kopf()` + `gilt` | Der Befehl wird an `;`, `&&`, `\|\|`, `\|` und Zeilenumbrüchen zerlegt; jede Regel sagt selbst, für welchen **Befehlskopf** sie gilt. Die `rm`-Regeln feuern nur in Segmenten, deren Befehl wirklich `rm` ist — nicht in `git commit -m "… rm -rf …"` |

**3 — Bei einer Umleitung ist nur das Ziel ein Schreibziel.** Derselbe Fehler eine Stufe tiefer,
und er fiel erst im Gebrauch auf: `ls ~/Library/…/yt-dlp >/dev/null` wurde blockiert, weil das
Vorhandensein eines `>` jeden Heimatpfad im Segment zum Schreibziel erklärte. Geschrieben wird
aber genau nach rechts vom Pfeil — alles davor ist gelesen. `umleitungsZiel()` prüft deshalb
**nur** das Ziel, sobald der Befehlskopf selbst kein Schreib-Verb ist.

Die Prüfliste enthält deshalb ausdrücklich Fälle, die **durchgehen müssen, obwohl sie gefährlich
klingen**. Wer nur die Blockier-Richtung prüft, merkt den Fehlalarm erst, wenn der Alltag steht —
und dann wird der Wächter abgeschaltet statt repariert.

**Vor dem Verdrahten testen.** Ein Wächter mit Fehlalarmen wird abgeschaltet, und dann schützt er
nichts mehr. Die Prüfliste braucht beide Richtungen — was blockiert werden **muss** und was
durchgehen **muss**:

```bash
# Ein Fall: erwartetes Ergebnis gegen tatsaechliches pruefen
pruefe() {  # $1 = BLOCK|PASS, $2 = Befehl
  printf '{"tool_input":{"command":%s}}' "$(node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$2")" \
    | node "$CLAUDE_PROJECT_DIR/.claude/hooks/danger-guard.js" >/dev/null 2>&1
  [ $? -eq 2 ] && got=BLOCK || got=PASS
  [ "$got" = "$1" ] && echo "  ok   $got  $2" || echo "  FAIL erw=$1 got=$got  $2"
}
# muss blockieren
pruefe BLOCK 'cp -r .claude ~/Desktop/backup'
pruefe BLOCK 'rm -rf ~'
pruefe BLOCK 'git clean -fdx'
pruefe BLOCK 'echo ok && cp -r . ~/Documents/kopie'          # auch verkettet
# muss durchgehen -- klingt gefaehrlich, ist es aber nicht
pruefe PASS  'rm -rf node_modules'
pruefe PASS  "cp a.html \"$CLAUDE_PROJECT_DIR/docs/b.html\""  # Pfad mit Leerzeichen!
pruefe PASS  'git clean -fdxn'
pruefe PASS  'grep -rn "rm -rf" docs/'                        # Text ueber den Befehl
pruefe PASS  'git commit -m "fix: git clean -fdx blockiert"'  # Commit-Nachricht
pruefe PASS  'ls ~/Library/Python/3.9/bin/x >/dev/null'       # Umleitung: Ziel ist /dev/null
pruefe BLOCK 'echo "x" > ~/Desktop/notiz.txt'                 # Umleitung: Ziel ist der Schreibtisch
```

**Live-Probe nach dem Verdrahten** (harmlos, weil Trockenlauf — muss trotzdem greifen, wenn man
das `n` weglässt):

```bash
git clean -fdx
```

Erwartete Antwort: `danger-guard hat den Befehl NICHT ausgefuehrt.`

<details>
<summary><code>.claude/hooks/danger-guard.js</code> — Volltext</summary>

```js
#!/usr/bin/env node
// PreToolUse-Hook fuer Bash. Schwester von git-guard.js -- aber dieser hier
// BLOCKIERT (exit 2), waehrend git-guard nur ansagt.
//
// Er macht Regeln strukturell, die vorher nur Prosa waren:
//   1) Nie ausserhalb des Arbeitsbereichs schreiben (Werkbank, /tmp, ~/.claude, ~/.codex).
//      Anlass: 31.07.2026 wurden 5,7 MB inkl. der Befehls-Freigabeliste ungefragt
//      auf ~/Desktop kopiert. Die Regel stand im Gedaechtnis -- niemand hat sie gelesen.
//   2) Nie mit Wucht loeschen (rm -rf auf Heimat, Wurzel, Werkbank-Wurzel, Systempfade).
//   3) Kein `git clean -fdx` -- .claude/ ist gitignored, der Befehl loescht den
//      kompletten Harness. Verlust waere nicht ueber git wiederherstellbar.
//
// Warum ein Hook und keine Anweisung: deterministischer Code kostet null Tokens und
// laeuft unabhaengig davon, was das Modell gerade fuer eine gute Idee haelt.
// Wer den Befehl wirklich braucht, fuehrt ihn von Hand aus -- das ist der Punkt.
//
// WICHTIG (real passiert, direkt beim ersten Einsatz): ein Waechter, der TEXT ueber
// gefaehrliche Befehle mit den Befehlen selbst verwechselt, blockiert jede Commit-
// Nachricht und jede Doku, die sie erwaehnt -- und wird dann abgeschaltet. Deshalb
// zwei Vorstufen vor der Pruefung: Heredoc-Inhalte werden entfernt, und jede Regel
// gilt nur fuer das Befehls-Segment, dessen KOPF sie betrifft.
//
// BEWUSST IN KAUF GENOMMENE AUSNAHME (01.08.2026): Im Rumpf eines Interpreter-Flags
// (-c/-e) wird NICHT zwischen Code und Zeichenkette unterschieden -- `python3 -c
// 'print("rm -rf")'` wird geblockt, obwohl es nur ausgibt. Grund: Die Unterscheidung
// waere ein halber Parser je Sprache, und die Umgehung ist trivial ("r"+"m -rf").
// Der Rumpf eines -c/-e-Flags IST Code; wer darueber schreiben will, nimmt eine Datei
// oder ein Heredoc (beides wird nicht geprueft). Diese Grenze ist gemessen, nicht geraten.

const path = require("path");
const os = require("os");

const HOME = os.homedir();
const IST_WIN = process.platform === "win32";

// [Mac->Win-Fix 21.08.2026] Pfad-Vergleiche separatorneutral (\ und /) und unter
// Windows case-insensitiv -- sonst scheitern sie an ~-expandierten Pfaden
// (C:\Users\x/Desktop, gemischt) und an Gross/Kleinschreibung. Belegt: der
// Schreibschutz war unter Windows fail-open (Selbsttest 10/14).
function normPfad(p) {
  if (!p) return p;
  let n = String(p);
  if (IST_WIN) {
    n = n.split("\\").join("/").toLowerCase();
    // MSYS/Git-Bash schreibt Laufwerke als /c/... Ohne diese Umschrift zaehlt
    // "/c/Users/..." nicht als derselbe Ort wie "C:/Users/..." -- und die
    // Heim-Schranke greift nicht. Belegt 22.08.2026: eine Umleitung nach
    // /c/Users/<du>/Desktop/ lief durch, dieselbe als C:/... und ~/... wurde blockiert.
    n = n.replace(/^\/([a-z])(?=\/|$)/, "$1:");
  }
  return n;
}
/** Liegt p unter der Wurzel w, oder IST es w? Separatorneutral. */
function unter(p, w) {
  const np = normPfad(p);
  const nw = normPfad(w);
  return np === nw || np.startsWith(nw.endsWith("/") ? nw : nw + "/");
}

/** Verzeichnisse, in die geschrieben werden darf. Alles andere unter $HOME ist tabu. */
function erlaubteWurzeln() {
  // ~/.codex ist seit 03.08.2026 der ZWEITE Harness-Ort, gleichwertig zu ~/.claude:
  // Codex liest von dort seine Skills, Prompts und Agenten, so wie Claude Code aus
  // ~/.claude. Belegt: Codex nimmt unsere AGENTS.md per Tree-Walk auf (Testlauf gab
  // "Keel — Shipwright" zurueck, steht nirgends sonst). Wer den einen Ort erlaubt und
  // den anderen sperrt, sperrt die Haelfte des eigenen Harness aus.
  // [Mac->Win-Fix 21.08.2026, U1] os.tmpdir() ist der echte Temp (Windows:
  // C:\Users\...\AppData\Local\Temp); /private/tmp und /var/folders sind rein macOS.
  const wurzeln = [os.tmpdir(), "/tmp", path.join(HOME, ".claude"), path.join(HOME, ".codex")];
  if (process.platform === "darwin") wurzeln.push("/private/tmp", "/var/folders");
  if (process.env.CLAUDE_PROJECT_DIR) wurzeln.push(path.resolve(process.env.CLAUDE_PROJECT_DIR));
  return wurzeln;
}

/** Heredoc-Rumpf ist Daten, nicht Befehl (Commit-Nachrichten, geschriebene Dateien). */
function ohneHeredocs(befehl) {
  return befehl.replace(
    /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1[\s\S]*?^\s*\2\s*$/gm,
    "<<HEREDOC-ENTFERNT"
  );
}

/** Zerlegt in Befehls-Segmente. Trenner: ; && || | Zeilenumbruch — aber NUR
 *  ausserhalb von Anfuehrungszeichen. Der blinde Split koepfte Nutzlasten
 *  (python3 -c "a; b" verlor das b samt rmtree) und haette umgekehrt Prosa
 *  wie -m "x; git push --force" zum Befehl erklaert. */
function segmente(befehl) {
  const teile = [];
  let akt = "";
  let q = null;
  for (let i = 0; i < befehl.length; i++) {
    const c = befehl[i];
    if (q) {
      akt += c;
      if (c === q && befehl[i - 1] !== "\\") q = null;
      continue;
    }
    if (c === '"' || c === "'") {
      q = c;
      akt += c;
      continue;
    }
    if (c === "\n" || c === ";" || c === "|") {
      teile.push(akt);
      akt = "";
      if (c === "|" && befehl[i + 1] === "|") i++;
      continue;
    }
    if (c === "&" && befehl[i + 1] === "&") {
      teile.push(akt);
      akt = "";
      i++;
      continue;
    }
    akt += c;
  }
  teile.push(akt);
  return teile.map((s) => s.trim()).filter(Boolean);
}

/** Der Befehlsname eines Segments -- Umgebungszuweisungen und Vorspann uebersprungen. */
function kopf(segment) {
  const worte = segment.split(/\s+/);
  for (const w of worte) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) continue;
    if (/^(sudo|command|nohup|time|env|xargs|nice|exec)$/.test(w)) continue;
    return path.basename(w.replace(/^["']|["']$/g, ""));
  }
  return "";
}

/** Der git-Unterbefehl eines Segments (`git -C <pfad> clean` -> "clean"). */
function gitUnterbefehl(segment) {
  const m = segment.match(
    /\bgit\b((?:\s+(?:-C\s+(?:"[^"]*"|'[^']*'|\S+)|-c\s+\S+|--no-optional-locks|--no-pager))*)\s+([a-z][a-z-]*)/
  );
  return m ? m[2] : null;
}

/**
 * Absolute Pfade im Segment, die NICHT im Arbeitsbereich liegen.
 *
 * Fallstrick, der erst der Test zeigte: Werkbank-Pfade enthalten oft Leerzeichen
 * (ein Ordnername darf welche haben, und der dieses Bau-Rechners hat sie). Ein
 * Token-Muster schneidet sie nach dem ersten Wort ab, der
 * Rest sieht dann aus wie ein fremder Pfad -- und der Waechter blockiert das
 * eigene Arbeitsverzeichnis. Deshalb wird zusaetzlich am ungeschnittenen Text
 * geprueft, ob an der Fundstelle ein erlaubtes Wurzelverzeichnis beginnt.
 */
/**
 * ALLE absoluten Pfade eines Segments in Reihenfolge -- auch die erlaubten.
 * Noetig fuer Kopier-Verben: dort zaehlt die POSITION (letztes Argument = Ziel),
 * und `fremdePfade` filtert die erlaubten heraus, wodurch die Position verlorengeht.
 * (Genau daran ist die erste Fassung des Kopier-Fix gescheitert, 02.08.2026.)
 */
function allePfade(segment) {
  const treffer = [];
  const re = /"((?:~|\/|[A-Za-z]:[\\/])[^"]*)"|'((?:~|\/|[A-Za-z]:[\\/])[^']*)'|(?<![\w"'=])((?:~|\/|[A-Za-z]:[\\/])[^\s;|&><)"']+)/g;
  let m;
  while ((m = re.exec(segment))) {
    const roh = m[1] || m[2] || m[3];
    treffer.push(roh.replace(/^~(?=[\\/]|$)/, HOME));
  }
  return treffer;
}

function fremdePfade(segment) {
  const wurzeln = erlaubteWurzeln();
  const treffer = [];
  const re = /"((?:~|\/|[A-Za-z]:[\\/])[^"]*)"|'((?:~|\/|[A-Za-z]:[\\/])[^']*)'|(?<![\w"'=])((?:~|\/|[A-Za-z]:[\\/])[^\s;|&><)"']+)/g;
  let m;
  while ((m = re.exec(segment))) {
    const abFundstelle = segment.slice(m.index).replace(/^["']/, "");
    const voll = abFundstelle.replace(/^~(?=[\\/]|$)/, HOME);
    if (wurzeln.some((w) => unter(voll, w))) continue;
    const roh = m[1] || m[2] || m[3];
    treffer.push(roh.replace(/^~(?=[\\/]|$)/, HOME));
  }
  return treffer;
}

const SCHREIB_VERB = /^(rm|cp|mv|rsync|touch|mkdir|tee|install|ditto|unzip|tar|chmod|chown|truncate|dd)$/;
const UMLEITUNG = /(?<![0-9<>])>{1,2}(?!&)/;
const REKURSIV = /\s-[a-zA-Z]*[rR]/;

/**
 * Das Ziel einer Ausgabe-Umleitung -- und nur das.
 *
 * Zweiter Fehlalarm aus dem Gebrauch: `ls ~/Library/… >/dev/null` wurde blockiert,
 * weil eine Umleitung im Segment jeden Heimatpfad darin zum Schreibziel erklaerte.
 * Geschrieben wird aber genau nach rechts vom Pfeil; alles davor ist gelesen.
 */
// Eine Commit-Nachricht ist PROSA, kein Pfad.
//
// Belegt am 02.08.2026, und zwar am eigenen Leib: Dieser Waechter blockierte den
// Commit, der SEINE EIGENE Selbstpruefung eingefuehrt hat -- weil in der Nachricht
// die Zeichenfolge "> ~/Desktop/f" vorkam, als Zitat des Fehlers, den sie beschreibt.
// Genau davor warnt der Kopf dieser Datei: "ein Waechter, der TEXT ueber gefaehrliche
// Befehle mit den Befehlen selbst verwechselt, blockiert jede Commit-Nachricht -- und
// wird dann abgeschaltet."
//
// ENG gefasst, damit nichts aufweicht: NUR das zitierte Argument von git -m/--message
// wird ersetzt. Eine Umleitung HINTER der Nachricht bleibt sichtbar und wird weiter
// geblockt (Selbsttest prueft genau das).
function ohneNachrichtentext(segment) {
  if (kopf(segment) !== "git") return segment;
  return segment.replace(
    /(^|\s)(-m|--message)(\s+|=)("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g,
    (_, vor, flag, trenn) => `${vor}${flag}${trenn}"NACHRICHT"`
  );
}

function umleitungsZiel(segment) {
  const m = segment.match(/(?<![0-9<>])>{1,2}(?!&)\s*(?:"([^"]*)"|'([^']*)'|([^\s;|&]+))/);
  if (!m) return null;
  const roh = m[1] || m[2] || m[3] || "";
  return roh.replace(/^~(?=\/|$)/, HOME);
}

// Jede Regel sagt selbst, fuer welche Segmente sie ueberhaupt gilt (`gilt`).
// Ohne das feuert sie auf Prosa, die den Befehl nur erwaehnt.
const REGELN = [
  {
    name: "rm mit Wucht auf Heimat oder Wurzel",
    gilt: (k) => k === "rm",
    treffer: (s) =>
      /\s-[a-zA-Z]*[rRf]/.test(s) &&
      /(\s|=)(\/|~\/?\s*$|~\/\*|\$HOME\/?\s*$|\$HOME\/\*|\/Users\/[^/\s]+\/?\s*$)(\s|$|\*)/.test(s),
    rat: "Ziel ist die Heimat oder das Wurzelverzeichnis. Loesche einzelne, benannte Pfade.",
  },
  {
    name: "rm -rf auf die Werkbank-Wurzel",
    // Direkt am Segmenttext pruefen statt ueber Token -- der Werkbank-Pfad
    // enthaelt evtl. ein Leerzeichen und ueberlebt keine Token-Zerlegung.
    gilt: (k) => k === "rm",
    treffer: (s) => {
      if (!REKURSIV.test(s)) return false;
      const wb = process.env.CLAUDE_PROJECT_DIR && path.resolve(process.env.CLAUDE_PROJECT_DIR);
      if (!wb) return false;
      const esc = wb.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`(^|[\\s"'])${esc}/?(["']|\\s|$)`).test(s);
    },
    rat: "Das ist die Werkbank selbst. Loesche darin, nicht sie.",
  },
  {
    name: "Schreiben oder Loeschen ausserhalb des Arbeitsbereichs",
    gilt: (k, s) => SCHREIB_VERB.test(k) || UMLEITUNG.test(s),
    treffer: (s, k) => {
      const unterHeimat = (p) => unter(p, HOME);
      // KOPIER-VERBEN: Nur das LETZTE Argument ist das Schreibziel -- `cp <fremd> <erlaubt>`
      // LIEST von fremd und SCHREIBT in den Arbeitsbereich, das ist harmlos. Der umgekehrte
      // Fall (`cp <erlaubt> ~/Desktop`) bleibt geblockt, denn dort ist das Ziel fremd.
      // Anlass: 02.08.2026 blockte der Waechter das Hereinkopieren einer uebergebenen
      // Quelldatei aus ~/Downloads ins Repo-Archiv -- ein Fehlalarm, der die Regel selbst
      // entwertet haette ("wer Text ueber Gefahr mit Gefahr verwechselt, wird abgeschaltet").
      if (/^(cp|mv|rsync|install|ditto)$/.test(k)) {
        // Das Ziel steht am ENDE des Segments. Endet es NICHT mit einem absoluten
        // oder ~-Pfad, ist das Ziel relativ -- also im Arbeitsbereich, also erlaubt.
        // (Die erste Fassung zaehlte absolute Pfade und liess dadurch
        //  `cp .claude/settings.local.json ~/Desktop/` durch -- genau den Vorfall,
        //  wegen dem diese Regel existiert. Beim Test aufgefallen, nicht im Betrieb.)
        const m = s.match(/(?:"((?:~|\/|[A-Za-z]:[\\/])[^"]*)"|'((?:~|\/|[A-Za-z]:[\\/])[^']*)'|((?:~|\/|[A-Za-z]:[\\/])[^\s;|&><)"']+))\s*$/);
        if (!m) return false;
        const ziel = (m[1] || m[2] || m[3]).replace(/^~(?=[\\/]|$)/, HOME);
        const erlaubt = erlaubteWurzeln().some((w) => unter(ziel, w));
        return !erlaubt && unterHeimat(ziel);
      }
      // Uebrige Schreib-Verben (rm, touch, mkdir, tee, chmod …): jedes Argument zaehlt.
      if (SCHREIB_VERB.test(k)) return fremdePfade(s).some(unterHeimat);
      const ziel = umleitungsZiel(s);
      if (!ziel || !path.isAbsolute(ziel)) return false;
      return unterHeimat(ziel) && !erlaubteWurzeln().some((w) => unter(ziel, w));
    },
    rat: `Geschrieben wird nur in Werkbank, user-projects, /tmp, ~/.claude und ~/.codex -- nicht sonstwo unter ${HOME}.`,
  },
  {
    name: "rm -r auf einen Systempfad",
    gilt: (k) => k === "rm",
    treffer: (s) => REKURSIV.test(s) && fremdePfade(s).some((p) => !p.startsWith(HOME)),
    rat: "Rekursives Loeschen ausserhalb von Arbeitsbereich und /tmp laeuft nicht ueber den Agenten.",
  },
  {
    name: "git clean -fdx loescht den ungetrackten Harness",
    // Trockenlauf (-n / --dry-run) durchlassen: so sieht ein Mensch nach, bevor er handelt.
    gilt: (k, s) => k === "git" && gitUnterbefehl(s) === "clean",
    treffer: (s) => /\s-[a-zA-Z]*x/.test(s) && !/(--dry-run|\s-[a-zA-Z]*n)\b/.test(s),
    rat: ".claude/ ist gitignored -- -x loescht den ganzen Harness, und git kann ihn nicht zurueckholen. Ohne -x arbeiten oder einzelne Pfade nennen.",
  },
  {
    name: "Geraete-Schreibzugriff / Dateisystem formatieren",
    gilt: (k, s) => k === "dd" || /^mkfs/.test(k) || UMLEITUNG.test(s),
    treffer: (s) => /\bof=\/dev\//.test(s) || /^mkfs/.test(kopf(s)) || />\s*\/dev\/(disk|sd|nvme)/.test(s),
    rat: "Schreibt an Geraeten vorbei am Dateisystem. Von Hand ausfuehren, wenn wirklich gewollt.",
  },
  {
    name: "Rechte flaechendeckend aufreissen",
    gilt: (k) => k === "chmod",
    treffer: (s) => /-[a-zA-Z]*R/.test(s) && /\s777\b/.test(s),
    rat: "chmod -R 777 macht alles fuer jeden schreibbar. Gezielte Rechte setzen.",
  },
  {
    name: "Loeschen mit Systemrechten",
    gilt: (k, s) => k === "rm" && /(^|\s)sudo\s/.test(s),
    treffer: () => true,
    rat: "Loeschen mit Systemrechten laeuft nie ueber den Agenten.",
  },
  // --- Nachruestung 01.08.2026 [Beschluss D5, Auftraggeber]: destruktive git-Verben blocken.
  // Prinzip aus "destructive command guard" (dcg) -- dessen Code ist per Lizenz-Rider
  // fuer uns unbenutzbar, die Luecken-Liste stammt aus der Bestands-Eruierung:
  // diese Verben waren bisher NUR Prosa-Regel, git-guard sagt nur an, blockt nicht.
  {
    name: "git push --force ueberschreibt veroeffentlichte Historie",
    gilt: (k, s) => k === "git" && gitUnterbefehl(s) === "push",
    treffer: (s) => /\s(--force\b|-f\b)/.test(s) && !/--force-with-lease/.test(s),
    rat: "Veroeffentlichte Historie wird nie umgeschrieben (CLAUDE.md, Branches). Wenn wirklich noetig: --force-with-lease, von Hand.",
  },
  {
    name: "git reset --hard verwirft Arbeitsstand",
    gilt: (k, s) => k === "git" && gitUnterbefehl(s) === "reset",
    treffer: (s) => /--hard\b/.test(s),
    rat: "Verwirft uncommittete Arbeit unwiederbringlich -- Loeschung braucht ein Go. Gezielt entstagen (git restore --staged) oder von Hand.",
  },
  {
    name: "git branch -D loescht ungemergte Zweige",
    gilt: (k, s) => k === "git" && gitUnterbefehl(s) === "branch",
    treffer: (s) => /\s-D\b/.test(s),
    rat: "Grosses -D erzwingt. Kleines -d weigert sich bei Ungemergtem -- der sichere Weg; sonst von Hand.",
  },
  {
    name: "Arbeitsbaum verwerfen (checkout -- / restore)",
    gilt: (k, s) => k === "git" && ["checkout", "restore"].includes(gitUnterbefehl(s)),
    treffer: (s) => {
      if (gitUnterbefehl(s) === "restore")
        return !(/--staged\b/.test(s) && !/--worktree\b/.test(s)); // nur reines Entstagen ist harmlos
      return /\bcheckout\s+(?:-\S+\s+)*--\s+\S/.test(s);
    },
    rat: "Verwirft lokale Aenderungen der genannten Pfade (Loeschung braucht Go). Erlaubt bleibt git restore --staged (entstaged nur).",
  },
  {
    name: "git stash drop/clear loescht Zwischenstaende",
    gilt: (k, s) => k === "git" && gitUnterbefehl(s) === "stash",
    treffer: (s) => /\bstash\s+(drop|clear)\b/.test(s),
    rat: "Stash-Inhalte sind ungesicherte Arbeit. Erst ansehen (git stash show -p), Loeschen von Hand.",
  },
  {
    name: "git clean -f loescht Ungetracktes",
    gilt: (k, s) => k === "git" && gitUnterbefehl(s) === "clean",
    treffer: (s) => /\s-[a-zA-Z]*f/.test(s) && !/(--dry-run|\s-[a-zA-Z]*n)\b/.test(s),
    rat: "Loescht ungetrackte Dateien unwiederbringlich. Erst -n (Trockenlauf); das Loeschen selbst von Hand.",
  },
  {
    name: "Destruktives im Interpreter-Umweg (-c/-e)",
    // dcg-Fund: der Waechter prueft nur den Befehls-KOPF -- python3 -c "shutil.rmtree(...)"
    // lief bisher an allen rm-Regeln vorbei.
    // Nachgeschaerft 01.08.2026 (Nachpruefung): die erste Fassung war eine zu enge
    // Musterliste. Sechs Umgehungen wurden nachgestellt und gingen mit Exit 0 durch --
    // require("fs").rmSync (kein woertliches "fs."), os.remove, subprocess.run(["rm","-rf"]),
    // perl unlink, FileUtils.rm_rf, Path(...).unlink. Jetzt nach Loesch-VERB statt nach
    // Modulnamen; Fehlalarm-Grenze bleibt eng, weil die Regel nur fuer Segmente mit
    // Interpreter-Kopf UND -c/-e-Flag gilt.
    gilt: (k) => /^(python3?|node|perl|ruby|bash|sh|zsh|deno|bun)$/.test(k),
    treffer: (s) => {
      if (!/\s-[ce]\s/.test(s)) return false;
      // Escapes entfernen: im Rumpf stehen Anfuehrungszeichen oft als \" -- ohne diese
      // Normalisierung gingen subprocess.run([\"rm\",\"-rf\"]) und perl unlink \"...\"
      // durch (beide nachgestellt, beide Exit 0).
      const n = s.replace(/\\/g, "");
      return (
        /\brm\s+-[a-zA-Z]*[rf]/.test(n) || // rm als Shell-Aufruf im Rumpf
        /["'`]rm["'`]\s*,\s*["'`]-[a-zA-Z]*[rf]/.test(n) || // rm als Argumentliste (subprocess/execFile)
        /shutil\.rmtree|\bos\.(remove|unlink|rmdir|removedirs)\s*\(|\.unlink\s*\(/.test(n) || // Python
        /\.(rmSync|rmdirSync|unlinkSync|rm)\s*\(|\brimraf\b/.test(n) || // Node, auch require("fs").rmSync
        /FileUtils\.rm_(rf|r)\b|File\.(delete|unlink)\b/.test(n) || // Ruby
        /\bunlink\s+["'$@]|\brmtree\b/.test(n) || // Perl
        /\bshred\b/.test(n)
      );
    },
    rat: "Loesch-Code im Interpreter-Flag umgeht die rm-Regeln. Direkt als Befehl schreiben (dann greifen die Regeln) oder von Hand ausfuehren.",
  },
];

// ---------------------------------------------------------------------------
// SELBSTPRUEFUNG  ->  node .claude/hooks/danger-guard.js --selbsttest
//
// Anlass (02.08.2026, Abnahmelauf der Nachbau-Anleitung): Die Anleitung liess den
// Menschen zum Pruefen Zeilen wie   pruefe 'echo "x" > ~/Desktop/f'   tippen.
// Der Waechter blockte sie -- korrekt: er kann nicht wissen, ob eine zitierte
// Zeichenkette spaeter ausgewertet wird, und Konservativsein ist hier die richtige
// Antwort. Falsch war die Anleitung, nicht der Waechter.
//
// Deshalb prueft er sich ab jetzt SELBST, im Prozess, ohne dass irgendjemand einen
// gefaehrlich aussehenden Befehl in eine Shell tippt. Die Faelle stehen in beiden
// Richtungen da: was blockiert werden MUSS und was durchgehen muss. Ein Waechter
// mit nur positiven Faellen laesst sich zu Tode verschaerfen, ohne dass es auffaellt.
const SELBSTTEST = [
  // --- muss blockieren ---
  { blockt: true, befehl: "cp -R . ~/Desktop/backup", warum: "Schreiben ausserhalb des Arbeitsbereichs" },
  { blockt: true, befehl: 'echo "x" > ~/Documents/f.txt', warum: "Umleitung nach ~/Documents" },
  { blockt: true, befehl: "rm -rf ~", warum: "Loeschen der Heimat" },
  { blockt: true, befehl: "rm -rf /", warum: "Loeschen der Wurzel" },
  { blockt: true, befehl: "git clean -fdx", warum: ".claude/ ist gitignored -- nicht wiederherstellbar" },
  { blockt: true, befehl: "ls | tee ~/Downloads/liste.txt", warum: "Umleitung im zweiten Segment" },
  // --- muss durchgehen ---
  { blockt: false, befehl: "git status --short", warum: "harmlos" },
  { blockt: false, befehl: "echo hallo > /tmp/f.txt", warum: "/tmp ist erlaubt" },
  { blockt: false, befehl: "rm -rf node_modules", warum: "relativer Pfad im Arbeitsbereich" },
  { blockt: false, befehl: 'git commit -m "entfernt rm -rf aus der Doku" -- docs/x.md', warum: "TEXT ueber einen Befehl, kein Befehl" },
  { blockt: false, befehl: "git clean -n", warum: "Trockenlauf loescht nichts" },
  // Der Fall, an dem sich der Waechter am 02.08.2026 selbst blockiert hat:
  { blockt: false, befehl: `git commit -m "behebt: echo x > ~/Desktop/f wurde geblockt" -- a.js`, warum: "Nachricht ist Prosa, kein Pfad" },
  { blockt: false, befehl: `git commit -m 'nie wieder cp -R . ~/Desktop' -- a.js`, warum: "auch mit einfachen Anfuehrungszeichen" },
  // ... und die Gegenprobe dazu: eine ECHTE Umleitung hinter der Nachricht bleibt geblockt.
  { blockt: true, befehl: `git commit -m "harmlos" > ~/Desktop/log.txt`, warum: "Umleitung HINTER der Nachricht ist echt" },
];

function pruefeBefehl(roh) {
  const verletzt = [];
  for (const seg of segmente(ohneHeredocs(roh)).map(ohneNachrichtentext)) {
    const k = kopf(seg);
    for (const r of REGELN) {
      if (verletzt.includes(r.name)) continue;
      try {
        if (r.gilt(k, seg) && r.treffer(seg, k)) verletzt.push(r.name);
      } catch {}
    }
  }
  return verletzt;
}

if (process.argv.includes("--selbsttest")) {
  let schlecht = 0;
  for (const f of SELBSTTEST) {
    const treffer = pruefeBefehl(f.befehl);
    const ok = f.blockt ? treffer.length > 0 : treffer.length === 0;
    if (!ok) schlecht++;
    console.log(
      `${ok ? "  ok  " : "  FEHL"} ${f.blockt ? "blockt " : "laesst "} ${f.befehl.padEnd(52)} ${
        ok ? f.warum : `ERWARTET ${f.blockt ? "blockiert" : "durchgelassen"}, BEKAM ${treffer.join(",") || "nichts"}`
      }`
    );
  }
  console.log(`\n${SELBSTTEST.length - schlecht} von ${SELBSTTEST.length} Faellen richtig.`);
  process.exit(schlecht ? 1 : 0);
}

let eingabe = "";
process.stdin.on("data", (c) => (eingabe += c));
process.stdin.on("end", () => {
  let daten = {};
  try {
    daten = JSON.parse(eingabe || "{}");
  } catch {}
  const roh = daten?.tool_input?.command || "";
  if (!roh) return process.exit(0);

  const verletzt = new Map();
  for (const seg of segmente(ohneHeredocs(roh)).map(ohneNachrichtentext)) {
    const k = kopf(seg);
    for (const r of REGELN) {
      if (verletzt.has(r.name)) continue;
      try {
        if (r.gilt(k, seg) && r.treffer(seg, k)) verletzt.set(r.name, { r, seg });
      } catch {
        /* eine kaputte Regel darf nie den ganzen Waechter kippen */
      }
    }
  }
  if (!verletzt.size) return process.exit(0);

  process.stderr.write(
    "danger-guard hat den Befehl NICHT ausgefuehrt.\n\n" +
      [...verletzt.values()].map(({ r, seg }) => `  - ${r.name}\n    ${r.rat}\n    -> ${seg.slice(0, 160)}`).join("\n") +
      "\n\n  Der Waechter ist deterministisch und nicht ueberredbar. Wenn das wirklich gewollt\n" +
      "  ist, fuehrt der Mensch den Befehl selbst im Terminal aus.\n"
  );
  process.exit(2); // 2 = blockieren, stderr geht ans Modell zurueck
});
```

</details>

**Anpassen beim Nachbau:** `erlaubteWurzeln()` ist die einzige Stelle, die vom Aufbau abhängt.
Wer außerhalb der Werkbank noch ein legitimes Schreibziel hat, trägt es dort ein — nicht als
Ausnahme in einer einzelnen Regel.

---

### 6.8.10 `.claude/hooks/commit-pathspec-guard.js` — pathspec-Pflicht im geteilten Werkbank-Repo

Dritter Wächter (01.08.2026, Beschluss **D9**), blockierend wie `danger-guard`. Grund: Mehrere
Sitzungen teilen im Werkbank-Repo **einen Index** — `git commit` ohne pathspec committet fremd
Gestagedes mit (belegt: `e37b798`, `0120208`; Konvention: CLAUDE.md „Sichern", Commit `a160ac9`).
Ausnahmen: `--amend`/`--fixup`/`--squash`/`--reuse-message`/`commit -C` und laufende Merges
(`.git/MERGE_HEAD`). Nebenwirkung der erzwungenen Form: committet die **Arbeitsbaum**-Fassung
(prüfen mit `git diff HEAD -- <pfad>` — **nicht** `--cached` und **nicht** ohne `HEAD`, beides zeigt den Index statt des Commits). Er prüft **Segmente mit git-Kopf** nach
quote-bewusstem Split — „git commit" in Nutzdaten, Nachrichten oder Heredocs ist Daten, kein
Befehl (erster Live-Fehlalarm war genau eine Testreihe mit Commit-Beispielen als printf-Nutzlast).
Wiederholbare Testreihe (16 Fälle, Wegwerf-Repo): `user-projects/harness-lab/hooks/test-commit-pathspec-guard.sh`.

```js
#!/usr/bin/env node
// PreToolUse-Hook [Beschluss D9, Auftraggeber 01.08.2026]: erzwingt im WERKBANK-Repo die
// Commit-Form  git commit -m "..." -- <pfad>  (CLAUDE.md, Sichern; Commit a160ac9).
//
// Grund: Fuenf parallele Sitzungen teilen denselben Index. "git commit" committet
// DEN INDEX, nicht die eigene Auswahl (belegt 01.08.2026: e37b798 nahm 2 fremde
// Dateien mit, 0120208 vier, obwohl genau eine gestaged war).
// BLOCKIEREND (exit 2) wie danger-guard.js — eine Ansage hilft nicht, wenn der
// Schaden im selben Befehl passiert.
//
// Wie danger-guard prueft dieser Waechter SEGMENTE mit git-KOPF, nie den Rohtext:
// "git commit" in Anfuehrungszeichen, Heredocs oder Testdaten ist DATEN, kein
// Befehl (erster Live-Fehlalarm genau daran: eine Testreihe, die Commit-Beispiele
// als printf-Nutzlast trug, wurde geblockt).
//
// Ausnahmen, bewusst: --amend / --fixup / --squash / --reuse-message / commit -C
// (Commit-Objekt-Wiederverwendung) und laufende Merges (.git/MERGE_HEAD) — dort
// ist das Committen des ganzen Index der Zweck. Restrisiko: auch --amend nimmt
// fremd Gestagedes mit; dokumentiert, nicht verschwiegen.
// NEBENWIRKUNG der erzwungenen Form: "git commit -- <pfad>" committet die
// ARBEITSBAUM-Fassung und uebergeht eine abweichend gestagede (git add -p).
// Pruefkommando ist deshalb "git diff HEAD -- <pfad>".
// ⚠ BERICHTIGT 03.08.2026: Hier stand "git diff <pfad>". Das ist FALSCH — dieses
// Kommando vergleicht den Arbeitsbaum gegen den INDEX, also gegen genau den
// Zustand, vor dem diese Regel warnt. Nachgestellt im Wegwerf-Repo: Datei O
// committet, Fassung A gestaged, Fassung B geschrieben -> "git diff f.txt" zeigt
// nur +B, "git diff HEAD -- f.txt" zeigt +A+B, und committet wird A+B. Nur das
// zweite Kommando zeigt, was wirklich in den Commit geht. CLAUDE.md:104 hatte es
// von Anfang an richtig; falsch war ausgerechnet die Blockade-Meldung, die der
// Mensch in dem Moment liest, in dem er das Kommando braucht.
// Nur das Werkbank-Repo: in verschachtelten Repos (git -C / cd) arbeitet je eine
// Sitzung allein — dort waere ein Block reine Reibung.
// Zweite Grenze: $-Variablen in -C/cd-Pfaden bleiben unexpandiert — ein per Variable
// adressiertes Ziel ist nicht aufloesbar. Der Waechter blockt dann NICHT (sonst traefe
// er legitime Commits in verschachtelte Repos), aber er warnt hoerbar, wenn zugleich
// die pathspec fehlt — still durchfallen war die Luecke (Brain-Befund 01.08.2026).

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
// MSYS/Git-Bash schreibt Windows-Laufwerke als /c/... -- path.resolve() macht daraus
// C:\c\... , einen Pfad den es nicht gibt. Der Waechter meldete dann "liegt in keinem
// Git-Repo", obwohl das Repo da war (belegt 22.08.2026, mehrfach in einer Sitzung).
// Ein Waechter, der bei einem gaengigen Pfadformat Fehlalarme gibt, wird ignoriert.
function msysPfad(p) {
  if (process.platform !== "win32" || !p) return p;
  return String(p).replace(/^\/([A-Za-z])(?=\/|$)/, "$1:");
}


function sh(cmd, cwd) {
  try {
    return execSync(cmd, { cwd, encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

/** Heredoc-Rumpf ist Daten, nicht Befehl (gleiche Vorstufe wie danger-guard). */
function ohneHeredocs(befehl) {
  return befehl.replace(/<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1[\s\S]*?^\s*\2\s*$/gm, "<<HEREDOC-ENTFERNT");
}

/** Zerlegt in Befehls-Segmente. Trenner: ; && || | Zeilenumbruch — aber NUR
 *  ausserhalb von Anfuehrungszeichen (gleiche Vorstufe wie danger-guard; ein ;
 *  im Nachrichtentext darf ein Segment nicht koepfen). */
function segmente(befehl) {
  const teile = [];
  let akt = "";
  let q = null;
  for (let i = 0; i < befehl.length; i++) {
    const c = befehl[i];
    if (q) {
      akt += c;
      if (c === q && befehl[i - 1] !== "\\") q = null;
      continue;
    }
    if (c === '"' || c === "'") {
      q = c;
      akt += c;
      continue;
    }
    if (c === "\n" || c === ";" || c === "|") {
      teile.push(akt);
      akt = "";
      if (c === "|" && befehl[i + 1] === "|") i++;
      continue;
    }
    if (c === "&" && befehl[i + 1] === "&") {
      teile.push(akt);
      akt = "";
      i++;
      continue;
    }
    akt += c;
  }
  teile.push(akt);
  return teile.map((s) => s.trim()).filter(Boolean);
}

/** Der Befehlsname eines Segments — Zuweisungen und Vorspann uebersprungen. */
function kopf(segment) {
  for (const w of segment.split(/\s+/)) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) continue;
    if (/^(sudo|command|nohup|time|env|xargs|nice|exec)$/.test(w)) continue;
    return path.basename(w.replace(/^["']|["']$/g, ""));
  }
  return "";
}

/** Der git-Unterbefehl eines Segments (`git -C <pfad> commit` -> "commit"). */
function gitUnterbefehl(segment) {
  const m = segment.match(
    /\bgit\b((?:\s+(?:-C\s+(?:"[^"]*"|'[^']*'|\S+)|-c\s+\S+|--no-optional-locks|--no-pager))*)\s+([a-z][a-z-]*)/
  );
  return m ? m[2] : null;
}

let eingabe = "";
process.stdin.on("data", (c) => (eingabe += c));
process.stdin.on("end", () => {
  let daten = {};
  try {
    daten = JSON.parse(eingabe || "{}");
  } catch {}
  const roh = daten?.tool_input?.command || "";
  if (!/\bgit\b/.test(roh) || !/\bcommit\b/.test(roh)) return process.exit(0);

  const werkbank = process.env.CLAUDE_PROJECT_DIR
    ? sh("git rev-parse --show-toplevel", process.env.CLAUDE_PROJECT_DIR)
    : null;
  if (!werkbank) return process.exit(0);

  // cd VOR einem Segment wirkt fuer die spaeteren Segmente — PreToolUse laeuft vor
  // der Ausfuehrung, cwd allein kennt ein cd im selben Befehl noch nicht.
  let basis = process.cwd();
  let basisUnpruefbar = false; // true, sobald ein cd-Pfad eine Shell-Variable traegt
  const warnungen = [];

  for (const seg of segmente(ohneHeredocs(roh))) {
    const cdM = seg.match(/^cd\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/);
    if (cdM) {
      const cdRoh = cdM[1] || cdM[2] || cdM[3];
      if (cdRoh.includes("$")) basisUnpruefbar = true;
      else if (path.isAbsolute(msysPfad(cdRoh))) basisUnpruefbar = false;
      // relativer Pfad ohne Variable: Flag bleibt (relativ zu Unpruefbarem ist unpruefbar)
      basis = path.resolve(basis, msysPfad(cdRoh));
      continue;
    }
    if (kopf(seg) !== "git" || gitUnterbefehl(seg) !== "commit") continue;

    // Ziel-Repo dieses Segments: -C gewinnt (relativ zur cd-Basis), sonst Basis.
    const mC = seg.match(/git\s+-C\s+(?:"([^"]+)"|'([^']+)'|(\S+))/);
    const zielRoh = mC ? mC[1] || mC[2] || mC[3] : null;
    const ziel = mC ? path.resolve(basis, msysPfad(zielRoh)) : basis;
    const zielUnpruefbar = zielRoh
      ? zielRoh.includes("$") || (!path.isAbsolute(zielRoh) && basisUnpruefbar)
      : basisUnpruefbar;
    const top = sh("git rev-parse --show-toplevel", ziel);
    if (!top || top !== werkbank) {
      // Unaufloesbares Variablen-Ziel OHNE pathspec: nicht blocken, aber hoerbar machen —
      // WENN das die Werkbank ist, verletzt der Commit die Index-Konvention.
      if (!top && zielUnpruefbar) {
        const entquotetWarn = seg.replace(/"[^"]*"/g, '""').replace(/'[^']*'/g, "''");
        if (!/\s--(\s|$)/.test(entquotetWarn) && !/--amend\b|--fixup[=\s]|--squash[=\s]|--reuse-message[=\s]/.test(seg)) {
          warnungen.push(
            `Ziel mit Shell-Variable nicht pruefbar UND keine pathspec: WENN das das Werkbank-Repo ist, verletzt dieser Commit die Index-Konvention (CLAUDE.md, Sichern). Pfad ausschreiben oder mit -- <pfad> committen. -> ${seg.slice(0, 120)}`
          );
        }
      }
      continue;
    }

    // Ausnahmen: Commit-Objekt-Wiederverwendung und laufender Merge.
    if (/--amend\b|--fixup[=\s]|--squash[=\s]|--reuse-message[=\s]/.test(seg)) continue;
    if (/\s-C\s/.test(seg.slice(seg.indexOf("commit")))) continue; // git commit -C <commit>
    if (fs.existsSync(path.join(top, ".git", "MERGE_HEAD"))) continue;

    // pathspec: " -- " ausserhalb von Anfuehrungszeichen, im SEGMENT.
    const entquotet = seg.replace(/"[^"]*"/g, '""').replace(/'[^']*'/g, "''");
    if (/\s--(\s|$)/.test(entquotet)) continue;

    process.stderr.write(
      "commit-pathspec-guard: Im Werkbank-Repo NUR mit pathspec committen:\n" +
        '  git commit -m "..." -- <pfad> [<pfad> ...]\n' +
        "Grund: Der Index ist zwischen den Sitzungen GETEILT — ein Commit ohne pathspec\n" +
        "nimmt mit, was andere Sitzungen gestaged haben (CLAUDE.md, Sichern; belegt\n" +
        "e37b798/0120208). Vorher pruefen mit: git diff HEAD -- <pfad>\n" +
        "(NICHT --cached und NICHT ohne HEAD — beides zeigt den Index, nicht den Commit).\n" +
        "Neue Dateien: git add <pfad> und im SELBEN Befehl mit pathspec committen.\n" +
        `-> ${seg.slice(0, 160)}\n`
    );
    process.exit(2);
  }
  if (warnungen.length) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          additionalContext: "commit-pathspec-guard: " + warnungen.join(" | "),
        },
      })
    );
  }
  process.exit(0);
});
```

### 6.8.11 `.claude/hooks/pruefstand-warn.js` — die zwei Mess-Prüfer als Stop-Netz

Vierter Wächter (01.08.2026, aus dem Arbeitsweise-Standard docs/13 §1): lässt beim Stop die
Mess-Prüfer laufen (`anleitung-drift.js`, `eigenbau-ungesichert.js`, seit 03.08. auch
`upstream-abstand.js`) plus den Skill-Index-Abgleich und meldet **nur bei
Befund** (per Sitzung gedrosselt, 15 min). Macht die DoD-Zusätze („Kopie im selben Zug",
„!-Zeile im selben Zug") strukturell statt gemerkt — gemerkte Pflichten sind am 01.08. dreimal
gerissen. Schichtung: `.js`-Eigenbauten fängt schon das `!.claude/*.js`-Muster (dann sind sie
git-sichtbar und Sache der Backup-Warnung); dieser Prüfer fängt, was ignoriert bliebe.

```js
#!/usr/bin/env node
// Stop-Hook: laesst die zwei Mess-Pruefer der Werkbank laufen und meldet NUR bei Befund.
//   1) docs/workflows/anleitung-drift.js      — Kopien in docs/10 vs. Platte (Exit 1 = Drift)
//   2) docs/workflows/eigenbau-ungesichert.js — Eigenbauten ohne git-Sicherung (Exit 1 = Fund)
//   3) docs/workflows/upstream-abstand.js     — Abstand des Forks zum Upstream UND
//      Patches, deren Grund upstream entfallen sein koennte (Exit 1 = Befund).
//      Anlass 03.08.2026: vier Wochen kein Rebase, 256 Commits, 1619 Dateien --
//      gemerkt hat es niemand, weil der einzige von AUSSEN alternde Bestand der
//      einzige ohne Waechter war.
// Macht die DoD-Zusaetze aus docs/13 §1 strukturell (G4): vorher war "nach jeder
// Eigenbau-Aenderung beide Pruefer laufen lassen" eine gemerkte Pflicht — und gemerkte
// Pflichten sind heute dreimal gerissen (tell-session-Kopie, git-guard-Kopie, sechs
// ungesicherte Skripte).
// Drossel pro Sitzung wie uncommitted-warn (15 min), damit der Stop nicht bei jedem
// Zug zwei Node-Laeufe kostet. Meldet still nichts, wenn alles gruen ist.
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const WORKSPACE = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, '..', '..');
const THROTTLE_MIN = 15;

function lauf(skript) {
  try {
    execSync(`node "${path.join(WORKSPACE, skript)}"`, {
      cwd: WORKSPACE, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 30000,
    });
    return null; // Exit 0 = kein Befund
  } catch (e) {
    const out = ((e.stdout || '') + (e.stderr || '')).trim();
    return kuerzen(out) || `${skript}: Exit ungleich 0`;
  }
}

/**
 * Lange Pruefer-Ausgabe kuerzen, OHNE den Befund wegzuschneiden.
 *
 * ⚠ BERICHTIGT 03.08.2026. Hier stand `out.split('\n').slice(0, 6)` — die ersten
 * sechs Zeilen. Das ist genau die falsche Haelfte: Pruefer listen erst das
 * Unauffaellige und stellen den Befund ans Ende, direkt vor die Zusammenfassung.
 * Gemessen an diesem Tag meldete der Stop-Hook sechsmal "gleich" und verschwieg
 * ZWEI DRIFT-Zeilen samt der Bilanz "10 deckungsgleich, 2 abweichend". Der
 * Waechter meldete Ruhe, waehrend der Pruefer unter ihm rot war — dieselbe Falle
 * wie ein Werkzeugausfall, der als bestandener Test durchgeht
 * (Pruefwerkzeug-Anforderung 18, docs/13).
 *
 * Die Loesung ist bewusst GENERISCH und nicht auf Marker wie "DRIFT" gebaut: ein
 * kuenftiger Pruefer mit anderem Vokabular fiele sonst in dieselbe Grube. Kopf
 * und Fuss bleiben stehen, die Mitte faellt weg — und dass gekuerzt wurde, steht
 * mit Zeilenzahl da, statt still zu passieren.
 */
function kuerzen(text, kopf = 3, fuss = 14) {
  const zeilen = text.split('\n');
  if (zeilen.length <= kopf + fuss + 1) return text;
  const weg = zeilen.length - kopf - fuss;
  return [
    ...zeilen.slice(0, kopf),
    `  … ${weg} Zeilen ausgelassen (vollstaendig: node <skript>) …`,
    ...zeilen.slice(-fuss),
  ].join('\n');
}

/**
 * Wer einen Skill per skillOverrides ausblendet, ohne ihn in den Bibliotheks-Index
 * einzutragen, macht ihn UNAUFFINDBAR: weder im Listing noch ueber den Index.
 * Umgekehrt ist ein Index-Eintrag ohne Override eine Karteileiche.
 * Gefunden 01.08.2026 (Nachpruefung): "taste" war genau so verschwunden.
 * Strukturell statt als Merksatz — G4.
 */
function skillIndexAbgleich() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(WORKSPACE, '.claude/settings.local.json'), 'utf8'));
    const overrides = new Set(Object.keys(cfg.skillOverrides || {}));
    if (!overrides.size) return null;
    const idxDatei = path.join(WORKSPACE, '.claude/skills/skill-library/SKILL.md');
    const idx = new Set(
      (fs.readFileSync(idxDatei, 'utf8').match(/^- \*\*`([^`]+)`\*\*/gm) || [])
        .map((z) => z.replace(/^- \*\*`/, '').replace(/`\*\*$/, ''))
    );
    const fehlt = [...overrides].filter((n) => !idx.has(n)).sort();
    const leiche = [...idx].filter((n) => !overrides.has(n)).sort();
    if (!fehlt.length && !leiche.length) return null;
    const teile = [];
    if (fehlt.length) teile.push(`ausgeblendet, aber NICHT im Index (unauffindbar): ${fehlt.join(', ')}`);
    if (leiche.length) teile.push(`im Index, aber nicht ausgeblendet (Karteileiche): ${leiche.join(', ')}`);
    return teile.join('\n') + `\n(Overrides: ${overrides.size} · Index: ${idx.size})`;
  } catch (e) {
    return null; // fehlende Datei ist kein Befund
  }
}

function main(rohEingabe) {
  let sid = 'global';
  try {
    const d = JSON.parse(rohEingabe || '{}');
    if (d.session_id) sid = String(d.session_id).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'global';
  } catch (e) {}
  const stamp = path.join(os.tmpdir(), `<workspace>-pruefstand-warn-${sid}.stamp`);
  try {
    const last = parseInt(fs.readFileSync(stamp, 'utf8'), 10);
    if (Number.isFinite(last) && Date.now() - last < THROTTLE_MIN * 60000) return;
  } catch (e) {}

  const befunde = [];
  const drift = lauf('docs/workflows/anleitung-drift.js');
  if (drift) befunde.push('KOPIEN-DRIFT (docs/10 vs. Platte):\n' + drift);
  const eigenbau = lauf('docs/workflows/eigenbau-ungesichert.js');
  if (eigenbau) befunde.push('EIGENBAU OHNE SICHERUNG:\n' + eigenbau);
  const upstream = lauf('docs/workflows/upstream-abstand.js');
  if (upstream) befunde.push('UPSTREAM-ABSTAND (Fork vs. Paperclip):\n' + upstream);
  const skills = skillIndexAbgleich();
  if (skills) befunde.push('SKILL-BIBLIOTHEK UNVOLLSTAENDIG:\n' + skills);

  try { fs.writeFileSync(stamp, String(Date.now())); } catch (e) {}

  if (befunde.length) {
    console.log(JSON.stringify({
      systemMessage:
        '⚠️  PRUEFSTAND MELDET (docs/13 §1, DoD-Zusaetze):\n' + befunde.join('\n---\n') +
        '\n-> Verursachende Sitzung: Kopie/gitignore im selben Zug nachziehen, dann Pruefer erneut.',
    }));
  }
}

if (process.stdin.isTTY) {
  main('');
} else {
  let eingabe = '';
  process.stdin.on('data', (c) => (eingabe += c));
  process.stdin.on('end', () => main(eingabe));
}
```

### 6.8.11a Der vierte Wächter ist **bedingt** — seine zwei Prüfer gehören nicht zum Nachbau

Der Stop-Eintrag oben (§6.1, Zeile im `settings.json`-Block; §6.8.7 im `settings.local.json`-Block)
ruft `pruefstand-warn.js`. Das Skript ruft seinerseits `docs/workflows/anleitung-drift.js` und
`docs/workflows/eigenbau-ungesichert.js`. Diese beiden stehen in dieser Anleitung **nicht im
Volltext** — und das bleibt absichtlich so. Drei gemessene Gründe:

1. **Volltext würde den Fehlalarm nicht beheben.** Beide Prüfer haben Voraussetzungen, die ein
   frischer Nachbau nicht hat: `anleitung-drift.js` liest fest `docs/rebuild-guide.md`,
   `eigenbau-ungesichert.js` braucht den Fremd-Klon `.ecc-src/` — der in dieser Anleitung
   nirgends vorkommt (`grep -c 'ecc-src' docs/rebuild-guide.md` → `0`). Im Wegwerf-Ordner
   nachgestellt: beide brechen mit Rückgabe **2** ab („nicht prüfbar"), der Hook meldet weiter.
   Ein Volltext hier verschöbe den Dauer-Fehlalarm also nur von „Cannot find module" auf
   „FEHLER: .ecc-src/ fehlt".
2. **Die Kopie wäre selbst ungeprüft.** `anleitung-drift.js` ordnet Codeblöcke nur Pfaden unter
   `.claude/…` zu (Konstante `PFAD_MUSTER`). Gemessen: 12 geprüfte Blöcke, alle unter `.claude/`.
   Ein `docs/workflows/`-Block würde stillschweigend nie verglichen — genau die zweite Wahrheit,
   gegen die §6.8.11 gebaut wurde.
3. **Die zwei Prüfer messen die Werkbank, nicht das nachgebaute System** — ihre eigene Anleitung
   und ihren eigenen ECC-Klon. Für einen Nachbau sind sie kein Bestandteil, sondern eine Zutat.

**Vorgabe ist deshalb Weg A.** Weg B nur, wenn der Nachbau beide Voraussetzungen erfüllt.

#### Weg A — den zweiten Stop-Eintrag weglassen (Vorgabe für jeden Nachbau)

1. In `.claude/settings.json` (§6.1) und in `settings.local.json` (§6.8.7) den **zweiten**
   Stop-Eintrag (`pruefstand-warn.js`) nicht übernehmen. `uncommitted-warn.js` bleibt.
   **Geklappt, wenn:** dieser Befehl `0` ausgibt —
   ```bash
   jq -r '[.hooks.Stop[].hooks[].command] | map(select(test("pruefstand-warn"))) | length' \
     .claude/settings.json
   ```
   In beide Richtungen gemessen: mit dem Eintrag `1`, ohne ihn `0`. Für `settings.local.json`
   denselben Befehl mit dem anderen Dateinamen.
2. `.claude/hooks/pruefstand-warn.js` gar nicht erst anlegen.
   **Geklappt, wenn:** `test -e .claude/hooks/pruefstand-warn.js; echo $?` → `1`.
3. Kontrolle im Betrieb: einen Zug arbeiten und den Stop beobachten.
   **Geklappt, wenn:** keine Meldung „PRUEFSTAND MELDET" erscheint.
   Gegenprobe, damit dieses Schweigen etwas bedeutet: mit verdrahtetem Hook **ohne** die zwei
   Skripte erscheint sie bei **jedem** Stop — im Wegwerf-Ordner gemessen, Wortlaut
   `Error: Cannot find module …/docs/workflows/anleitung-drift.js`, Hook-Rückgabe 0. Ein
   Wächter, der immer meldet, wird nach dem dritten Mal ignoriert; das ist der Schaden.

#### Weg B — nachrüsten (nur wenn BEIDE Voraussetzungen erfüllt sind)

| Voraussetzung | Prüfbefehl | fehlt sie, dann |
|---|---|---|
| eigene `docs/10-…`-Anleitung mit Volltext-Kopien unter `.claude/…` | `test -f docs/rebuild-guide.md && echo ja` | Weg A |
| Fremd-Klon `.ecc-src/` neben `.claude/` | `test -d .ecc-src && echo ja` | Weg A |

1. Die zwei Prüfer aus dem Werkbank-Repo holen. Es ist privat, deshalb über `gh` und nicht über
   `curl` auf `raw.githubusercontent.com`; `gh auth login` steht ohnehin in der Checkliste §12.
   ```bash
   mkdir -p docs/workflows
   for f in anleitung-drift eigenbau-ungesichert; do
     gh api -H "Accept: application/vnd.github.raw" \
       "repos/<ACCOUNT>/<workspace>/contents/docs/workflows/$f.js" \
       > "docs/workflows/$f.js"
   done
   ```
   **Geklappt, wenn:** `shasum -a 256 docs/workflows/*.js` genau diese zwei Zeilen zeigt
   (Stand 02.08.2026, Skript-Stand Commit `64f79dc`):
   ```text
   ff7ebdc4ebdcfb26b71d877a4cbfe38bea14bab51b34b99222abf583c876c072  docs/workflows/anleitung-drift.js
   2207a6f00b383d1b87e6c28d86a241ed5470663a1e8241e16d95d9f17f5107bc  docs/workflows/eigenbau-ungesichert.js
   ```
   Weicht eine Summe ab, ist das kein Fehler, sondern eine neuere Fassung — dann `node --check`
   je Datei (muss stumm bleiben) und weiter mit Schritt 2. Der Hash-Vergleich ist hier die
   Ersatz-Prüfung dafür, dass diese Anleitung die Dateien nicht selbst zitiert.
2. Beide **von Hand** laufen lassen, bevor der Hook sie ruft. Ein Prüfer, der schon einzeln rot
   ist, wird im Hook nur lauter.
   ```bash
   node docs/workflows/anleitung-drift.js;      echo "drift exit=$?"
   node docs/workflows/eigenbau-ungesichert.js; echo "eigenbau exit=$?"
   ```
   **Geklappt, wenn:** beide `exit=0` melden. `exit=2` heißt „nicht prüfbar" (eine Voraussetzung
   fehlt) und ist ausdrücklich **kein** „alles sauber" — dann zurück zu Weg A. `exit=1` ist ein
   echter Befund: erst beheben, dann verdrahten.
3. Erst danach `.claude/hooks/pruefstand-warn.js` (§6.8.11) anlegen und den zweiten Stop-Eintrag setzen.
   **Geklappt, wenn:** dieser Aufruf **nichts** ausgibt und mit 0 endet —
   ```bash
   echo '{"session_id":"probe-nachbau"}' | node .claude/hooks/pruefstand-warn.js; echo "exit=$?"
   ```
   In dieser Werkbank am 02.08.2026 genau so gemessen: leere Ausgabe, `exit=0`. Erscheint JSON mit
   „PRUEFSTAND MELDET", liegt entweder ein echter Befund vor oder Schritt 2 wurde übersprungen.
   Achtung bei Wiederholungen: das Skript drosselt **je `session_id` 15 Minuten** über eine
   Stempeldatei `$TMPDIR/<workspace>-pruefstand-warn-<id>.stamp`; für einen zweiten Versuch eine
   andere Kennung einsetzen, sonst ist das Schweigen nur die Drossel.

### 6.8.12 Die fuenf Dauer-Regeln (Ordner .claude/rules/keel/) — was in **jeder** Sitzung mitlädt

Eine Regeldatei lädt **unbedingt**, wenn sie **kein** `paths:`-Frontmatter trägt. Das ist die
ganze Bedingung, und sie hängt an der **Datei**, nicht am Ordner. Der Ordner common/ ist der Ort,
an dem das systematisch so ist — keine seiner 14 Dateien hat eins, alle liegen in jeder Sitzung
im Fenster, bevor die erste Frage gestellt ist. Er ist aber **nicht der einzige**: In dieser
Werkbank trägt auch das komplette Paket ecc/web/ keins und lädt deshalb ebenfalls immer mit.
Das ist kein Nebensatz — es sind sieben Dateien, die niemand bestellt hat, und der Befund gehört
in denselben Blick wie die Kostenrechnung in tools.md und wie die zu breiten Trigger aus
§6.8.1. Nachmessen:

```bash
grep -L '^---' .claude/rules/keel/*.md | wc -l        # 14 — keine Datei in common hat Frontmatter
grep -l '^---' .claude/rules/ecc/*/*.md      | wc -l        # 104 tragen eins ...
ls           .claude/rules/ecc/*/*.md | grep -cv /common/   # ... von 111 Sprachdateien
grep -L '^---' .claude/rules/ecc/*/*.md | grep -v /common/  # die 7 Ausreisser: alle in ecc/web/
```

Von den 14 Dateien in common/ stammen **10 aus ECC** (agents, code-review, coding-style,
development-workflow, git-workflow, hooks, patterns, performance, security, testing) und **4 aus
dieser Werkbank**. Die vier eigenen sind die einzigen, die das *Arbeitsverhalten* festlegen statt
Code-Stil; sie existieren, weil im echten Betrieb etwas schiefging, und tragen ihren Anlass
jeweils im Kopf der Datei. Gegenprobe, dass sie wirklich Eigenbau sind und nicht aus dem Bundle
kommen — `<ECC_QUELLE>` ist der Quell-/Update-Klon des Harness-Bundles (in dieser Werkbank der
nicht versionierte Ordner .ecc-src/; wer keinen hat, überspringt die Probe):

```bash
find "<ECC_QUELLE>" \( -name no-oneshot.md -o -name completeness.md \
                    -o -name tools.md   -o -name output-shape.md \)   # erwartet: keine Ausgabe
ls "<ECC_QUELLE>"/rules/common/ | wc -l                                  # erwartet: 10
```

#### Was die vier tun und warum es sie gibt

**no-oneshot.md (77 Zeilen, angelegt 31.07.2026).**
Verbietet jede inhaltliche Aussage über das Vorhaben, die nicht vorher geprüft wurde — nicht aus
dem Gedächtnis, nicht aus dem Gesprächsverlauf. Vier Auflagen: erst prüfen, dann formulieren ·
die richtige Schicht wählen (eigene Plugins und Plan-Dokumente vs. Basis-Plattform; falsche
Schicht = falsche Antwort, auch bei sauberer Messung) · gegen bestehende Beschlüsse gegenprüfen ·
mehr als eine Blickrichtung, sobald mehr als eine Datei betroffen ist. Dazu eine Staffel, die den
Prüfaufwand an die **Reichweite der Aussage** bindet statt an die Länge der Frage: eine Zeile →
direkt lesen; mehrere Schichten → Workflow mit parallelen Prüfern je Blickrichtung.
*Anlass:* am 31.07.2026 drei belegte Fehler in einer einzigen Sitzung — eine Empfehlung gegen
einen bestehenden Beschluss, Governance in der falschen Schicht gemessen, Lauforte aus der
Erinnerung wiedergegeben. Die Datei hält außerdem fest, welche Mehr-Modell-Befehle gestrichen
sind und warum — damit niemand ein Werkzeug plant, dessen Anmeldung nicht herstellbar ist.

**completeness.md (73 Zeilen, angelegt 31.07.2026).**
Legt fest, wann etwas fertig ist — und verbietet das Wort als Selbstauskunft: erlaubt ist
„geprüft gegen ⟨Quellen⟩ — offen ist ⟨Liste⟩". Kern sind acht Fragen (Akteure · Lebenszyklus ·
Governance je Fähigkeit · Versprechen · Belege · Fehlerfall · Folgepflichten ·
Widerspruchsfreiheit), die Gegenproben G1–G4 (Widerspruch · Achse · Folgepflicht · Messbarkeit)
und eine Quellen-Rangfolge, die den häufigsten Prüffehler adressiert: Wer nur Umsetzung gegen
Code prüft, findet nie ein vergessenes Versprechen. Dazu zwei Sprachregeln, die hier oft greifen:
Zahlen beim Schreiben messen und den erzeugenden Befehl danebenschreiben, und ein Warnkasten
ersetzt keine Korrektur.
*Anlass:* mehrfach „fertig" gemeldet, während hunderte Lücken offen waren. Langfassung mit
Beweislage: [completeness-check.md](completeness-check.md).

**tools.md (40 Zeilen, angelegt 31.07.2026).**
Setzt die Rangfolge **CLI → MCP → Browsersteuerung** und begründet sie über die Kosten statt über
Geschmack: Eine CLI kostet nichts, bis sie aufgerufen wird, und ihre Ausgabe lässt sich vor dem
Modell filtern. Ein MCP-Server kostet **dauerhaft** — seine Werkzeug-Schemata liegen in *jeder*
Sitzung im Fenster, auch in denen, die den Dienst nie anfassen. Browsersteuerung kostet **pro
Blick**, weil jeder Screenshot ein voller Anhang ist; sie ist für Oberflächen da, nie für Daten.
Dazu der Beschaffungsweg (erst nachsehen, ob das Werkzeug schon da ist, dann suchen, dann ohne
Systemrechte installieren) und die Regel, bei einer streikenden CLI erst Version, Argumente und
Umgehungsschalter zu prüfen, statt eine Stufe abzusteigen.
*Anlass:* Browsersteuerung für Daten benutzt, für die eine CLI existierte. Langfassung mit
Messwerten: [tool-sourcing.md](tool-sourcing.md).

**output-shape.md (59 Zeilen, angelegt 01.08.2026).**
Regelt die **Form** der Antwort an den Menschen — die einzige der vier, die nichts über Prüfung
sagt: erste Zeile = Ergebnis oder nächste Handlung, kein Vorlauf; Mehrschrittiges nummeriert;
fester Abschlussblock „Zu tun · Auswirkung · Empfehlung"; Listen höchstens fünf Punkte. Liegt eine
**Entscheidung** beim Menschen, trägt jeder Punkt zusätzlich das Antwortformat, die Wirkung bei Ja
*und* bei Nein, die belegte Zuständigkeit (warum diese Person und nicht eine andere Rolle) und die
vollständige Entscheidungsgrundlage **in der Nachricht selbst** — ein Verweis auf Dokumente
ersetzt sie nicht. Liegt beim Menschen nichts an, fordert der Block auch keine Freigabe an. Dazu
die Lagerregel, die verhindert, dass Kürze zu Verlust wird: Substanz wandert in committete
Dateien, die Antwort verweist darauf.
*Anlass:* „Antworten zu lang, am Ende fehlt der handlungsklare Abschluss" (01.08.2026), gefolgt
von zwei weiteren Ermahnungen am selben Tag, deren Wortlaut in der Datei steht. *Herkunft:* das
Prinzip stammt aus dem MIT-lizenzierten Skill „i-have-adhd" (ayghri), eingedeutscht und
angepasst; das Referenz-Original samt Lizenztext liegt im Labor-Repo unter
`user-projects/harness-lab/vendor/i-have-adhd/`.

> **Warum diese vier zusammen und warum genau hier:** Drei regeln, *wie* geprüft wird und wann
> etwas fertig ist; die vierte regelt die Form — eine unabhängige Achse, die sonst mit der
> Beleg-Disziplin verrechnet wird („kurz" gegen „belegt"). Sie liegen im unbedingt ladenden
> Ordner, weil sie **vor dem ersten Werkzeugaufruf** gelten müssen: Eine Sitzung, die nur eine
> Frage beantwortet und keine Quelldatei öffnet, würde von einer Sprachregel nie erreicht.

#### Einbau

**Schritt 1 — Ordner anlegen und die vier Dateien hineinlegen.** `<REFERENZ>` ist der Pfad zu
einer bereits laufenden Werkbank; existiert keine, werden die Dateien aus den Beschreibungen
oben neu geschrieben (siehe Kasten am Ende dieses Abschnitts).

```bash
mkdir -p .claude/rules/keel
cp "<REFERENZ>"/.claude/rules/keel/{no-oneshot,completeness,tools,output-shape,working-method}.md \
   .claude/rules/keel/
```

**Geklappt, wenn:** vier Mal „ok" erscheint und kein „FEHLT ODER LEER" —

```bash
for f in no-oneshot completeness tools output-shape working-method; do
  test -s .claude/rules/keel/$f.md && echo "$f ok" || echo "$f FEHLT ODER LEER"
done
```

**Schritt 2 — prüfen, dass sie unbedingt laden.** Eine Regel mit Frontmatter wird zur
Sprachregel und verschwindet aus Sitzungen ohne passenden Dateityp — das ist der Fehler, der
still passiert.

```bash
grep -L '^---' .claude/rules/keel/{no-oneshot,completeness,tools,output-shape,working-method}.md
```

**Geklappt, wenn:** alle vier Pfade in der Ausgabe stehen (`grep -L` listet Dateien **ohne**
Treffer; die Reihenfolge ist beliebig). Erscheint eine nicht, hat sie ein Frontmatter und muss es
verlieren. **Gegenprobe, dass der Befehl überhaupt etwas aussortiert:** eine Wegwerf-Datei mit
Frontmatter danebenlegen und mitprüfen — sie darf nicht in der Liste auftauchen.

```bash
printf -- '---\npaths:\n  - "**/*.ts"\n---\ntext\n' > .claude/rules/keel/zz-probe.md
grep -L '^---' .claude/rules/keel/{no-oneshot,completeness,tools,output-shape,working-method,zz-probe}.md
rm .claude/rules/keel/zz-probe.md
```

**Schritt 3 — aufnehmen und sichern, sonst überlebt keine davon einen Rechnerwechsel.**

Die `.gitignore` ist an dieser Stelle **schon fertig**. Der Harness-Block aus §6.2a führt für
genau diese vier Dateien je eine `!`-Zeile; sie lief bisher ins Leere, weil die Dateien noch nicht
existierten. Jetzt existieren sie — an der `.gitignore` ist **nichts** zu ändern.

**Deshalb steht hier kein zweiter Abdruck des Blocks.** Ein Ausschnitt an dieser Stelle wäre eine
zweite, kürzere Wahrheit: Wer ihn abschreibt, verliert alles, was der Ausschnitt nicht enthält —
und merkt es nicht, weil die Proben dieses Schritts trotzdem grün wären. Fehlt eine Zeile, wird
sie in §6.2a geholt und nicht hier erfunden.

Erst prüfen, ob die vier Zeilen wirklich stehen — je Datei, nicht als Summe:

```bash
for f in no-oneshot completeness tools output-shape working-method; do
  grep -qxF "!.claude/rules/keel/$f.md" .gitignore \
    && echo "negiert          $f" || echo "FEHLT IM BLOCK:  $f"
done
```

**Geklappt, wenn:** viermal `negiert`. Bei `FEHLT IM BLOCK` weiterzumachen bringt nichts: `git add`
bricht auf einer ignorierten Datei mit `The following paths are ignored by one of your .gitignore
files` und **Exit 1** ab und nimmt nichts auf (nachgestellt — Index blieb bei 0).

Dann aufnehmen. Neue Dateien brauchen `git add`; committet wird mit Pathspec und vorher mit `git
diff HEAD` geprüft — Begründung für beides in §6.2a und in CLAUDE.md (Sichern):

```bash
git add .claude/rules/keel/{no-oneshot,completeness,tools,output-shape,working-method}.md
git diff HEAD --stat -- .claude/rules/keel
git commit -m "chore: die fuenf Dauer-Regeln versionieren" \
  -- .claude/rules/keel/{no-oneshot,completeness,tools,output-shape,working-method}.md
git push
```

Namentlich, nicht per `*.md`-Glob. Der Glob trifft alle 14 Dateien des Ordners; die zehn
ECC-Regeln sind ignoriert, und `git add` quittiert das mit **Exit 1** und dreizehn Zeilen Meldung —
die vier landen zwar im Index, aber jede `&&`-Kette dahinter bricht ab, und man sucht den Fehler
an der falschen Stelle (beides nachgestellt).

**Kein `git rm --cached` an dieser Stelle**, so naheliegend es aussieht. §5.1 schreibt die
`.gitignore` **vor** dem ersten Commit; der Fremd-Klon war nie im Index, es ist nichts
aufzuräumen. Wer hier trotzdem `git rm -r --cached .claude` einschiebt, nimmt statt des
Fremd-Klons die zwölf bereits gesicherten Wächter und Befehle heraus: nachgestellt führte HEAD
danach vier Dateien statt sechzehn, zwölf Eigenbauten waren aus dem Repo verschwunden — und ein
Erfolgskriterium aus der **Gesamtzahl** hätte das als Erfolg gemeldet.

**Geklappt, wenn:** jede der vier Dateien im Index **und** auf dem Remote steht — und eine
ECC-Regel weiterhin ignoriert ist:

```bash
for f in no-oneshot completeness tools output-shape working-method; do
  p=".claude/rules/keel/$f.md"
  git ls-files --error-unmatch "$p" >/dev/null 2>&1 && i="Index ja  " || i="Index NEIN"
  git ls-tree -r --name-only '@{u}' -- "$p" | grep -qxF "$p" && r="Remote ja  " || r="Remote NEIN"
  echo "$i $r $f"
done
git check-ignore -q .claude/rules/keel/testing.md; echo "ECC-Regel ignoriert? Exit $?"
```

Viermal `Index ja Remote ja`, und die letzte Zeile **Exit 0**. Die Gegenrichtung ist kein Zierrat:
Ein Block, der zu weit negiert, besteht die vier Zeilen darüber genauso — er zöge nur die zehn
ECC-Dateien mit hinein, die aus der Fremdquelle kommen und bei jedem Update Scheinänderungen
erzeugen. Warum `-q` und nicht `-v`: §5.1 Schritt 3b und §6.2a haben nachgestellt, dass `-v` auch
auf eine `!`-Zeile Exit 0 liefert und als Ja/Nein-Test unbrauchbar ist.

**Warum je Datei und nicht als Zahl:** Wie viele Dateien unter .claude insgesamt getrackt sind,
hängt davon ab, wie weit der Aufbau ist — §5.1 Schritt 6 sichert die zwölf Wächter und Befehle
irgendwann nach diesem Abschnitt, §6.2a kann weitere Zweige zurückholen. Dieselbe, korrekt
eingerichtete Anlage ergab in der Nachstellung **4** oder **16**, je nach Reihenfolge. Eine Summe
wäre also mal wahr und mal falsch, ohne dass sich an diesen vier Dateien irgendetwas geändert hat;
die Probe oben ist in jedem Zustand dieselbe.

**Schritt 4 — die Langfassungen mitliefern.** Zwei der Regeln verweisen im Kopf auf ein
ausführliches Dokument; fehlt es, führt die Regel ins Leere und wird beim ersten Zweifel
ignoriert.

```bash
ls docs/completeness-check.md docs/tool-sourcing.md
```

**Geklappt, wenn:** beide Pfade ausgegeben werden und der Befehl mit Exit 0 endet. Fehlt eines,
nennt `ls` es namentlich mit „No such file" und liefert Exit 1. (Der Arbeitsweise-Standard
docs/13 ist die dritte Langfassung; er ist Kür, die vier Regeln stehen ohne ihn.)

**Schritt 5 — Wirkungsprobe in einer *neuen* Sitzung.** Regeln werden beim Kontextbeginn geladen;
die Sitzung, die sie anlegt, hat sie nicht (§0). Also App neu starten bzw. neue Sitzung öffnen und
eine Frage stellen, die eine Zahl über das Projekt verlangt („wie viele Regeldateien liegen in
common?").

**Geklappt, wenn:** die Antwort einen ausgeführten Zählbefehl nennt statt einer erinnerten Zahl
**und** mit dem Block „Zu tun · Auswirkung · Empfehlung" endet. Das ist das schwächste Signal
dieses Abschnitts — es beobachtet Verhalten, statt eine Eigenschaft zu messen. Ein harter Beweis,
dass eine Regeldatei im Kontext liegt, ist von außen nicht verfügbar; Schritt 2 prüft die
Bedingung, unter der sie lädt, nicht das Laden selbst. Das gehört gesagt statt geschätzt.

**Fällt die Probe aus**, ist das **kein** Beweis, dass die Dateien fehlen — prüfbar ist nur die
Bedingung, nicht das Laden. Dann der Reihe nach: Schritt 2 wiederholen (Frontmatter), Dateigröße
prüfen (eine leere Datei lädt lautlos nichts, deshalb `test -s` in Schritt 1), und erst danach am
Verhalten zweifeln.

> **Warum hier kein Volltext steht** — anders als bei den Eigenbauten in Kapitel 6.8: Der Grund
> ist **nicht**, dass die vier versioniert wären und die Skripte nicht. Beide sind es; die
> Skripte hängen an der `!`-Zeile für JS-Dateien im selben Block (§6.2a) und stehen sämtlich in
> `git ls-files`. Der Grund ist die **Art des Inhalts**: Ein Skript lässt sich aus einer
> Beschreibung nicht rekonstruieren, eine Regel schon. Ein zweiter Abdruck wäre hier eine zweite
> Wahrheit mit Nachzieh-Pflicht — genau das Problem, gegen das der Anleitungs-Abgleich unter
> docs/workflows/anleitung-drift.js gebaut wurde und dessen Preis dieselbe Anleitung am
> 01.08.2026 zweimal bezahlt hat. Wer ohne Referenz-Werkbank anfängt, schreibt die vier aus den
> Beschreibungen oben neu: Es ist Prosa, kein Code, und sie lebt ohnehin von der **eigenen**
> Beweislage. Eine übernommene Regel ohne eigenen Anlass wird nicht befolgt — die Anlass-Zeile im
> Kopf jeder Datei ist kein Schmuck, sie ist der Grund, warum die Regel überlebt.

## 7. Die Werkzeuge & wie sie funktionieren

| Werkzeug | Typ | Wirkung |
|---|---|---|
| **SessionStart-Hook** | `settings.json`, zwei Gruppen | Kontext-Klärungs-Dialog nur bei frischem Kontext (`startup\|clear`); Rollen-Hook ohne Matcher = bei jedem Kontext-Beginn, auch fortgesetzt/verdichtet. §6.8.7 |
| **Stop-Hook** | `settings.json`, `async` | Ruft nach jedem Turn `uncommitted-warn.js` (warnt bei fehlendem Remote, ungepushten Commits, > 8 ungesicherten Dateien ODER letztem Commit > 120 min; Throttle 15 min **je Sitzung**) und — **nur in dieser Werkbank, im Nachbau wegzulassen (§6.8.11a)** — `pruefstand-warn.js` (Kopien-Drift + ungesicherte Eigenbauten, meldet nur bei Befund, §6.8.11). **Committet nichts.** |
| **`/repo-status`** | Command + `repo-status.js` | Zeigt getrennt lokales Git-Repo / GitHub-Repo / Sync / ungesicherte Dateien pro Ordner. Der Kontroll-Knopf. |
| **`/save-work`** | Command | Committet + pusht die Arbeit des aktuellen Projekts ins richtige Repo, mit Ansage. |
| **`git-guard`** | PreToolUse-Hook | Sagt vor jedem schreibenden git-Befehl an, in welches Repo er geht (Branch + Remote); raeumt verwaiste `index.lock`. §6.8.3 |
| **`danger-guard`** | PreToolUse-Hook, **blockiert** | Verweigert zerstoerende Befehle: Schreiben ausserhalb des Arbeitsbereichs, `rm -rf` auf Heimat/Wurzel/Werkbank, `git clean -fdx` (loescht den gitignorierten Harness), `dd of=/dev/`, `chmod -R 777`, `sudo rm`. §6.8.9 |
| **Statusleiste** | `statusLine` | Repo · Branch · Sicherungsstand statt nur Workspace-Name. §6.8.4 |
| **Sitzungs-Rollen** | SessionStart-Hook | Gibt jeder neuen Sitzung die Rollen-Tabelle mit. §6.8.5 |
| **`/session-map`** | Command | Wer laeuft, welche Rolle, wer hat keine. §6.8.6 |
| **`/tell-session`** | Command | Befund an eine andere Sitzung schicken. §6.8.6 |
| **`skillOverrides`** | Einstellung | Skill-Liste kuratieren ohne zu loeschen. §6.8.2 |

---

## 8. Verbindliche Konventionen (Verhaltensregeln)

1. **Ordnername == GitHub-Repo-Name**, kleingeschrieben, Bindestriche. **Hauptzweig** immer `main` — die Arbeit an einem Paket läuft auf einem Branch davon und wird nach Abnahme zurückgeführt (§8a).
2. **Commit ins Projekt nur via `git -C <projektordner>`** — nie im Workspace-cwd (landet sonst im Harness-Repo).
3. **Bei jedem Projekt-Commit das Ziel-Repo ansagen** („→ <ACCOUNT>/<projekt>"). Nie stillschweigend.
4. **Proaktiv sichern:** nach jedem kohärenten Block commit + push, ohne auf „commit" zu warten.
5. **Nie pauschal `user-projects/` gitignoren** — nur einzelne, verifiziert gepushte Ordner namentlich.
6. **Nie ohne explizite Bestätigung löschen** (bei Sortier-/Aufräum-Aufträgen): verschieben/archivieren statt löschen.
7. **Dateien > 100 MB nicht zu GitHub** → Cloud-Backup + `GROSSDATEIEN.md`-Referenz im Projekt (§10).
8. **Wichtige Pläne/Konzepte ins Projekt** (`<projekt>/Information/` o.ä.) — nicht im temporären `.claude/plan/` liegen lassen (das ist ungesichert).

---

## 8a. Branch-Modell (ergänzt 29.07.2026)

**Zwei Grenzen, zwei Werkzeuge — kein Widerspruch:**

| Grenze | Werkzeug | Warum |
|---|---|---|
| Zwischen **Projekten** | eigenes **Repo** | Plugin-Bindung + Ordner-Regel (§4). Ein Branch kann kein zweites Repo umspannen. |
| Zwischen **Arbeitspaketen** | **Branch** *innerhalb* eines Repos | Halbfertige Arbeit darf den lauffähigen Hauptzweig nicht anfassen. |

Weil jedes Projekt ein eigenes Repo ist, kann ein Branch technisch gar keine fremden Projektdateien enthalten — die Vermischung, die man bei einem gemeinsamen Repo fürchten müsste, ist ausgeschlossen.

**Wo Branches Pflicht sind:**
- **Repos mit Upstream-Rebase** (z. B. ein Soft-Fork): dort ist halbfertige Arbeit auf dem Hauptzweig ein Rebase-Risiko.
- **Repos, aus denen ein Dienst läuft:** der lauffähige Stand darf nie halbfertig sein.
- **Plugins/Bibliotheken:** je Arbeitspaket, weil sich ein Paket über mehrere Sitzungen zieht.
- **Der Workspace/Harness selbst:** bleibt auf `main`. Dort liegt die fortlaufende Doku, die alle Sitzungen lesen — ein Branch würde sie aus dem Arbeitsbaum nehmen.

**Benennung:** `wp<n>-<thema>`, `fix/<kurz>`, `pre-rebase/*`, `pin/*`, `spike/*`.
**Ablauf:** Branch → bauen → Abnahme durch den Inhaber → `merge --no-ff` (die Blase zeigt das Paket als Einheit) → Branch bleibt als Beleg stehen.

**Die harte Grenze — ein Arbeitsbaum je Repo (folgt direkt aus §4.2):**
1. **Pro Repo nur ein Branch gleichzeitig.** Alle Sitzungen teilen den Arbeitsbaum; ein `checkout` tauscht ihn für alle. Branches trennen Pakete **nacheinander**, nicht nebeneinander.
2. **Läuft ein Dienst aus dem Repo** (Board/Server): Der laufende Prozess arbeitet aus dem gebauten Stand und stoppt bei einem Checkout nicht — aber **jeder Neubau/Neustart zieht den ausgecheckten Branch**. Vor `build`/Neustart prüfen, welcher Branch aktiv ist.
3. **Echte Parallelarbeit** an zwei Paketen desselben Repos nur über `git worktree` (zweiter Ordner). Notausgang, kein Normalweg: bricht „Ordnername == Repo-Name", fehlt im Ignorier-Verzeichnis, verwaist leicht.

**Pakete über zwei Repos** (z. B. Plugin-Teil + Fork-Patch): Ein Branch kann kein zweites Repo umspannen → **gleicher Branch-Name in beiden Repos**, zusammen abnehmen, zusammen mergen. Einzige echte Reibung des Modells; sie kommt aus der Repo-Trennung, nicht aus den Branches.

**Herkunfts-/Quarantäne-Branches:** Arbeit, die außerhalb der begleiteten Sitzungen entstand und noch nicht geprüft ist, wird als eigener Branch veröffentlicht, während `main` nur bis zum letzten geprüften Commit gepusht wird (`git push origin <commit>:main`). Der Arbeitsbaum bleibt dabei auf dem neueren Stand, damit laufende Sitzungen weiterarbeiten können.

**Grenze:** Was bereits auf `main` veröffentlicht ist, lässt sich **nicht** nachträglich in einen Branch heben — das wäre Umschreiben veröffentlichter Historie. Nachträgliche Markierung nur per **Tag**. Deshalb: Branch **vor** der Arbeit anlegen.

---

## 8b. Arbeitsweise: Zieldefinition, Verify-Pflicht, Denkbudget, Negativ-Register

§5–§8a bauen die Maschine und regeln, wohin committet wird. Sie sagen nichts darüber, **wie** in der Maschine gearbeitet wird — und genau daran ist diese Werkbank mehrfach gescheitert: „fertig" gemeldet, während hunderte Lücken offen waren; eine lückenlose Bewertung gegen die falsche Messlatte; gemerkte Pflichten, die an einem einzigen Tag dreimal rissen. Ein Nachbau, der nur §5–§8a ausführt, bekommt die Mechanik ohne die Disziplin, für die sie gebaut wurde.

Die Volltext-Fassung dieser Instanz steht in [`13-arbeitsweise-standard.md`](13-arbeitsweise-standard.md) (abgenommen 01.08.2026, mit Belegen und Instanz-Details). Hier steht der **übertragbare Kern** — sechs Schritte, jeder mit einem Signal, das sich ausführen lässt. Alle Signale unten sind im Zustand des Nachbauers gemessen: frisches Repo, Datei noch nicht getrackt. Das ist kein Zierrat — zwei Erfolgssignale dieses Abschnitts sind vorher daran gescheitert, dass sie im fertigen Bestand geprüft wurden, wo sie ohnehin grün sind.

### Schritt 1 — Die Arbeitsweise dorthin schreiben, wo jede Sitzung sie liest

Eine Arbeitsweise in einer `docs/`-Datei ist eine Empfehlung; eine in den Regeldateien, die beim Sitzungsstart laden, ist der Kontext, in dem gedacht wird. Der Unterschied ist nicht Stil, sondern Wirkung: gemerkte Pflichten reißen, geladene nicht.

Mindestinhalt der Datei — drei Dinge, die zusammengehören:

1. **Zieldefinition vor der Arbeit:** drei Sätze — *Problem · Intent · Goal*. Ohne sie gibt es später nichts, wogegen man das Ergebnis halten kann.
2. **Zwei getrennte Abschluss-Messungen**, nie eine:
   - **Coverage** — ist alles adressiert, nichts vergessen? (Akteure, Lebenszyklus inkl. übergeben/beenden/abbauen, Governance, Versprechen, Belege, Fehlerfall, Folgepflichten, Widerspruchsfreiheit)
   - **Fulfillment** — ist das *Ziel* erfüllt, nicht nur Arbeit geleistet? (Abgleich gegen die Zieldefinition, ausdrücklich als eigener Schritt)

   Coverage findet Lücken, Fulfillment findet Frame-Fehler. Keins ersetzt das andere: eine lückenlose Bewertung gegen die falsche Messlatte ist lückenlos falsch.
3. **Sprachregel:** „fertig" ist als Selbstauskunft verboten. Erlaubt ist *„Geprüft gegen ⟨Quellen⟩ — offen ist ⟨Liste⟩."* Zahlen werden beim Schreiben gemessen, nicht erinnert, und der Befehl, der die Zahl erzeugt hat, steht daneben.

Ort im Nachbau: neben den übrigen Regeldateien des Harness (in dieser Werkbank `.claude/rules/keel/`), nicht in `docs/`.

```bash
mkdir -p .claude/rules/keel
# Datei .claude/rules/keel/working-method.md anlegen. Sie MUSS diese drei
# Zeilen woertlich enthalten, sonst greift die Pruefung unten ins Leere:
#   Zieldefinition: Problem · Intent · Goal
#   Abschluss-Messung 1: Coverage
#   Abschluss-Messung 2: Fulfillment
/usr/bin/grep -l "Problem · Intent · Goal" .claude/rules/keel/working-method.md

# SICHERN -- ohne diese drei Zeilen liegt die Regel nur auf der Platte:
printf '!.claude/rules/keel/working-method.md\n' >> .gitignore
git add .claude/rules/keel/working-method.md
git commit -m "arbeitsweise-regel" -- .gitignore .claude/rules/keel/working-method.md
git push
```

**Der Sicherungs-Block ist kein Anhängsel.** Das `.gitignore`-Muster aus §5/§6 sperrt `.claude/rules/keel/*` und holt einzelne Dateien mit `!`-Zeilen zurück — eine neue Datei ist von keiner Ausnahme erfasst. Im frischen Nachbau gemessen: nach dem Anlegen zeigt `git status --short` **nichts**, `git check-ignore -q` gibt **0** (ignoriert), und `git add` antwortet „The following paths are ignored by one of your .gitignore files". Die Regeldatei ist da, wirkt, und ist beim nächsten Rechnerwechsel weg. Die `!`-Zeile allein behebt das nicht: sie entscheidet nur, ob git die Datei **sehen darf**. Gesichert ist sie erst durch Commit und Push.

**Geklappt, wenn** drei Dinge zutreffen:

```bash
/usr/bin/grep -l "Problem · Intent · Goal" .claude/rules/keel/working-method.md   # gibt den Dateinamen aus
git ls-files --others --ignored --exclude-standard -- .claude/ | /usr/bin/grep arbeitsweise   # gibt NICHTS aus
git log --oneline -- .claude/rules/keel/working-method.md | wc -l                  # >= 1
```

…**und** eine frisch gestartete Sitzung beantwortet „welche zwei Messungen schließen eine Aufgabe ab?" mit *Coverage* und *Fulfillment*, ohne die Datei vorher zu öffnen. Erst dann liegt sie im Startkontext und nicht nur auf der Platte.

**Wenn die frische Sitzung es nicht weiß:** Der Harness liest diesen Ordner **flach aus** — kein Manifest, kein Frontmatter, kein Eintrag in einer Einstellungsdatei nötig. Gemessen in dieser Werkbank: 14 Dateien in `.claude/rules/keel/`, alle 14 im Startkontext, **0** davon mit Frontmatter (`/usr/bin/grep -l '^---' .claude/rules/keel/*.md | wc -l`), und `.claude/rules/` enthält außer `ecc/` keinen Eintrag. Die zwei Fehler, die dann in Frage kommen: der **Ablageort** — eine Ebene zu hoch in `.claude/rules/`, oder in einem der 22 Sprach-Unterordner, die nur bei passendem Dateityp laden (§6.8.1; in dieser Sitzung selbst beobachtet: die `typescript/`-Regeln erschienen erst, nachdem eine `.js`-Datei gelesen wurde) — und ein **nicht neu gestarteter Client** (§6.8.8). Die Datei nachträglich in `CLAUDE.md` zu verlinken behebt es **nicht**: ein Link ist eine Empfehlung, kein Startkontext. Genau darum geht es in diesem Schritt.

### Schritt 2 — Verify ist ein Pflicht-Schritt, und er beginnt mit einer Frage

Die Schleife je Arbeitspaket lautet **Zieldefinition → Plan → Bau → Verify → Ship**. Verify ist keine Kür: kein Merge, keine Übergabe, keine „bau-bereit"-Aussage ohne Prüferlauf plus beide Messungen aus Schritt 1. (Push als Sicherung ist davon nicht betroffen — sichern darf man immer.)

Jedes Verify beginnt mit der billigsten Frage überhaupt: **hat die Arbeit überhaupt stattgefunden?**

```bash
git diff HEAD -- <pfad> [<pfad> …]     # zeigt, was wirklich in den Commit ginge
git status --short
```

Ein leerer Diff ist ein **eigenes Ergebnis** („nicht gebaut") und kein Anlass, inhaltlich weiterzuprüfen. Real passiert (02.08.2026): ein Bau-Agent starb an einem API-Fehler, zwei Prüfer bewerteten daraufhin einen unveränderten Arbeitsbaum — einer meldete „nicht behoben" (er sah den Diff), der andere „alles behoben" (er sah den alten, bereits committeten Stand). Beide Berichte waren wahr und ergaben zusammen ein falsches Gesamtbild.

Dasselbe gilt für die Aussage „der Patch ist drin". Ein genannter Commit ist kein eingeflossener Commit — `git merge-base --is-ancestor` beantwortet das, und zwar nur, wenn man ihn an dem Fall erprobt, für den er da ist. `--is-ancestor HEAD main` auf `main` ist trivial wahr und beweist nichts:

```bash
git switch -c probe-ancestor && git commit --allow-empty -m probe
P=$(git rev-parse HEAD)
git switch main
git merge-base --is-ancestor $P main; echo $?      # erwartet: 1 -- existiert, aber nicht drin
git merge --no-ff -m "probe merge" probe-ancestor
git merge-base --is-ancestor $P main; echo $?      # erwartet: 0 -- im Hauptzweig
```

Der Probe-Branch bleibt stehen — das ist §8a („Branch bleibt als Beleg"), kein Versäumnis. **`git branch -D` gehört ausdrücklich nicht in diese Probe**: der danger-guard aus §6.8.9 blockiert den Befehl, im Nachbau nachgestellt und bestätigt. In dieser Werkbank trug ein Sicherheits-Patch vier Wochen lang eine falsche „die Sperre gilt"-Aussage, weil sein Merge-Stand in keinem Dokument stand.

Zwei Plan- und Bau-Regeln gehören in dieselbe Schleife, auch wenn sie kein Skript prüft: **Ein-Frage-Gate** — bei folgenreichen oder mehrdeutigen Entscheidungen eine Frage mit Empfehlung und Bestätigung, niemals eine Frageschleife als Normalzustand. Und **Wegwerf- und Probedateien entstehen im Scratchpad oder in einem Laborordner, nie in `docs/`** oder einem anderen Wahrheits-Ordner (Anlass: zwei ungetrackte Schriftproben lagen einen Tag in `docs/` und beschäftigten drei Sitzungen).

```bash
git status --short docs/ | /usr/bin/grep '^??'     # soll nichts ausgeben
```

Dieses Gate gilt **Wegwerf- und Probedateien**. Ein neues Wahrheits-Dokument (etwa das Negativ-Register aus Schritt 6) ist bis zu seinem Commit ebenfalls `??` — es wird committet, nicht verschoben. Das Gate deshalb **nach** dem Commit prüfen, nicht zwischen Anlegen und Sichern. Und es sieht weniger, als man denkt: liegt ein ganzer Ordner neu da, meldet `git status --short` nur `?? docs/unterordner/`, nicht die einzelnen Dateien darin (gemessen).

**Geklappt, wenn:** die Ancestor-Probe oben **1 vor** und **0 nach** dem Merge ausgibt (nur ein einziges `0` heißt: HEAD gleich HEAD, der Befehl ist nicht erprobt), beide `git diff HEAD`/`git status`-Zeilen in der eigenen Prüf-Vorlage stehen und die `??`-Zeile auf `docs/` nach dem Commit leer ist.

### Schritt 3 — Die zwei Pflichten, die erfahrungsgemäß reißen, strukturell verankern

Zwei Folgepflichten sind in dieser Werkbank an einem Tag dreimal gerissen, obwohl sie allen bekannt waren:

- **Neuer Eigenbau ⇒ im selben Zug sichtbar machen UND sichern** (`!`-Zeile in `.gitignore`, dann committen, dann pushen).
- **Skript-Änderung ⇒ die Kopie in dieser Anleitung im selben Zug** (sonst beschreibt §6 einen Stand, den es nicht mehr gibt — und der Nachbau baut das Falsche).

Gemerkte Pflichten sind tot; strukturelle halten. Das hat zwei Hälften, die nicht dasselbe sind: die **Kette von Hand** (gilt sofort, braucht nichts) und der **Wächter** (nimmt sie einem ab, braucht drei Dateien in der richtigen Reihenfolge).

**Die Kette von Hand.** Drei Fragen, drei Befehle, nacheinander — jede Stufe kann grün sein, während die nächste rot ist:

```bash
# 1) liegt in .claude/, aber git DARF sie nicht sehen (ignoriert):
git ls-files --others --ignored --exclude-standard -- .claude/
# 2) git darf sie sehen, aber sie wurde nie committet:
git ls-files --others --exclude-standard -- .claude/
# 3) committet, aber nicht gepusht:
git rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1 \
  && git log --oneline '@{u}'..HEAD \
  || echo "KEIN UPSTREAM -- nichts ist gepusht, die Frage ist unbeantwortbar"
```

**Warum alle drei Stufen:** Im Nachbau nachgestellt — Regeldatei angelegt, nur die `!`-Zeile in `.gitignore` ergänzt, **nicht** committet. Danach meldet der automatische Prüfer „Kein ungesicherter Eigenbau" und gibt **0** zurück, während `git log --oneline -- <datei> | wc -l` bei **0** steht: keine Historie, kein Backup. Der Prüfer misst die Sichtbarkeit, nicht die Sicherung — er kann nicht mehr, und die Kette oben ist der Grund, warum das nicht reicht. Der dritte Befehl ist aus demselben Grund umständlich: `git log '@{u}'..HEAD | wc -l` gibt ohne konfigurierten Upstream still **0** aus, was wie „alles gepusht" aussieht (gemessen).

**Der Wächter.** Er hängt am Stop-Hook und braucht **drei** Dateien, nicht eine:

| Datei | Rolle | Volltext in |
|---|---|---|
| `.claude/hooks/pruefstand-warn.js` | Stop-Hook-Hülle: ruft die Prüfer, drosselt (15 min je Sitzung), meldet nur bei Befund | §6.8.11 |
| `docs/workflows/anleitung-drift.js` | vergleicht die Volltext-Kopien dieser Anleitung mit den Dateien auf der Platte (Exit 1 = Drift) | **kein Volltext — §6.8.11a** |
| `docs/workflows/eigenbau-ungesichert.js` | findet Eigenbauten, die im ignorierten Bereich liegen (Exit 1 = Fund, Exit 2 = nicht prüfbar) | **kein Volltext — §6.8.11a** |

> ⚠ **Diese beiden Prüfer gehören NICHT zum Nachbau.** Sie messen die Volltext-Kopien *dieser* Werkbank-Anleitung gegen *diese* Werkbank und brauchen dafür den Fremd-Klon `.ecc-src/` und eine eigene `docs/10` mit Volltexten — beides bringt ein frischer Nachbau nicht mit. **§6.8.11a** begründet das und sagt, was stattdessen zu tun ist: den zweiten Stop-Eintrag weglassen. Der Wächter läuft dann mit einer Datei statt dreien.

**Reihenfolge zwingend: erst die beiden Prüfer anlegen, dann verdrahten.** Wird der Stop-Hook vor den Prüfern eingetragen, findet Node die Skripte nicht; `lauf()` behandelt jeden Exit ungleich 0 als Befund, und der Wächter meldet bei **jedem** Stop zwei Falschbefunde. Im Nachbau nachgestellt: die Meldung enthält wörtlich „KOPIEN-DRIFT" und „EIGENBAU OHNE SICHERUNG", darunter zweimal `Error: Cannot find module …`. Ein Wächter, der immer schreit, ist nach zwei Tagen abgeschaltet — das ist schlechter als gar keiner.

`eigenbau-ungesichert.js` hat außerdem zwei Voraussetzungen, die im Nachbau leicht fehlen und **Exit 2** erzwingen (nicht prüfbar, nicht „sauber"): der Ordner `.ecc-src/` muss existieren — daran unterscheidet er Eigenbau von Fremd-Klon — und seine zwei Kontrolldateien (`.claude/hooks/git-guard.js` aus §6.8.3, eine Fremd-Regeldatei) müssen da sein. Wer den Wächter vor §6.8.3 verdrahtet, misst nichts.

Die Hülle führt eine **dritte** Prüfung aus (Skill-Index gegen `skillOverrides`, §6.8.11). Sie ist ohne Zutun still: gemessen im leeren Nachbau — ohne `settings.local.json` still, mit `settings.local.json` ohne `skillOverrides` still, mit `skillOverrides` aber ohne Index-Datei still. Sie meldet erst, wenn beide Seiten existieren und auseinanderlaufen. Nichts wegzulassen und nichts zu ignorieren; nur zu wissen, dass §6.8.11 „zwei Mess-Prüfer" heißt und drei Prüfungen fährt.

```bash
node docs/workflows/anleitung-drift.js;      echo "drift=$?"
node docs/workflows/eigenbau-ungesichert.js; echo "eigenbau=$?"
for s in .claude/settings.local.json .claude/settings.json; do
  [ -f "$s" ] || continue
  jq -r --arg s "$s" '.hooks.Stop[]?.hooks[]?.command | "\($s): \(.)"' "$s"
done
# ohne jq:
/usr/bin/grep -l pruefstand-warn .claude/settings*.json
```

Die Schleife fragt **beide** Einstellungsdateien ab und überspringt die fehlende: je nach gewähltem Weg (§6.8.7 gegen §5) steht der Hook in der einen oder der anderen; in dieser Werkbank existiert nur `settings.local.json`, und ein `jq` über eine nicht vorhandene Datei endet mit Exit 2, obwohl es die gefundenen Zeilen ausgibt (gemessen).

**Geklappt, wenn:** die Kette von Hand in allen drei Stufen leer bzw. beantwortet ist, **und** — sobald der Wächter gebaut wird — beide Prüfer `0` ausgeben und die Hook-Abfrage eine Zeile mit `pruefstand-warn.js` liefert. **Nachweis der Gegenrichtung:** eine Volltext-Kopie in §6 um ein Zeichen verfälschen, `anleitung-drift.js` erneut laufen lassen, `DRIFT` und Exit `1` sehen, zurücknehmen. Bleibt es bei `0`, prüft der Prüfer nicht, was er zu prüfen vorgibt. **Wenn ein Prüfer `1` liefert und der Befund stimmt nicht:** nicht den Hook entschärfen, sondern den Prüfer — ein toleranter Wächter ist ein abgeschalteter Wächter mit besserem Gewissen.

### Schritt 4 — Denkbudget: Modell zuerst, Stufe zweitens, je Bahn gesetzt

Die Denkzeit eines Modells („Effort", „Reasoning", je nach Anbieter anders benannt) ist ein Budget, kein Qualitätsregler: gleiches Modell, gleiches Wissen auf jeder Stufe — mehr Stufe heißt mehr Denk-Tokens und mehr Wartezeit, nicht ein klügeres Modell. Anthropics eigene Doku warnt bei der Höchststufe wörtlich vor „overthinking".

Drei Regeln, in dieser Reihenfolge:

1. **Modell zuerst.** Das billigste Modell, das die Aufgabe zuverlässig zu Ende bringt; Arbeitspferde für Ausführung, Spitzenmodelle für Urteil. Die Stufe ist die zweite Entscheidung, nie die erste.
2. **Einstiegsstufe nach Aufgabenform, Aufstieg nur auf Beleg.** Umformatieren/Extrahieren/einen fertigen Plan ausführen → niedrig. Alltags-Coding, Zusammenfassungen mit Urteil → Mitte. Entwurf, Abwägung, Abschluss-Verifikation → hoch. Aufgestiegen wird, wenn die Ausgabe nachweislich Schritte auslässt oder sich selbst widerspricht — nicht nach Gefühl. Die **Stufennamen niemals aus einer Anleitung übernehmen**: sie unterscheiden sich je Anbieter und wandern zwischen Generationen; am eigenen Werkzeug ablesen.
3. **Die teuerste Falle: Vererbung.** Subagenten starten auf der Stufe der Elternsitzung, wenn eine Bahn keine eigene setzt. Bei Workflows mit acht bis elf Bahnen wird daraus eine ganze Flotte auf der teuersten Stufe, ohne dass jemand das entschieden hat. **Regel: jede Bahn setzt ihre Stufe selbst** — lesende und messende Bahnen niedrig, Richter- und Verify-Bahnen hoch. Ein Workflow ohne gesetzte Stufen gilt als unfertig.

Daraus folgt **„Prüfer vor Stufe"**: mehr Gründlichkeit wird zuerst über *mehr Bahnen* gekauft, dann erst über eine höhere Stufe. Grund ist nicht der Preis, sondern die Prüfbarkeit — Bahnen sind sichtbar und gegenprüfbar, eine höhere Stufe ist unsichtbar und liefert dasselbe eine Ergebnis, nur teurer.

Gegenprobe über alle eigenen Workflow-Dateien:

```bash
find docs/workflows -name '*.js' -print0 2>/dev/null | while IFS= read -r -d '' f; do
  a=$(/usr/bin/grep -c 'agent(' "$f"); e=$(/usr/bin/grep -c effort "$f")
  [ "$a" -gt 0 ] && [ "$a" -ne "$e" ] && echo "LUECKE  $f  agent=$a effort=$e"
done
echo "geprueft: $(find docs/workflows -name '*.js' 2>/dev/null | wc -l) Datei(en)"
```

**Kein `for f in docs/workflows/*.js`.** Fehlt der Ordner, tut dieselbe Schleife je nach Shell zwei verschiedene falsche Dinge (beides nachgestellt): zsh bricht mit „no matches found" ab, bash läuft **einmal** mit dem unaufgelösten Muster als Dateinamen durch und erzeugt eine Zeile `docs/workflows/*.js agent= effort=` — eine erfundene Datei, die wie ein bestandener Fall aussieht. Die `find`-Fassung gibt in beiden Shells nichts aus und nennt die geprüfte Anzahl dazu.

**Geklappt, wenn:** keine `LUECKE`-Zeile erscheint **und** die genannte Anzahl größer 0 ist. Steht dort `geprueft: 0`, ist das **kein** Bestehen, sondern „noch nicht anwendbar" — der Schritt wird fällig, sobald der erste Workflow mit mehr als einer Bahn entsteht. (Gemessen in dieser Werkbank am 02.08.2026: 10 Dateien, davon 8 mit `agent()`-Aufrufen; in allen acht stimmen `agent` und `effort` überein, die zwei reinen Mess-Prüfer stehen bei 0/0.) Ungeschützt bleibt, was ad hoc im Chat entworfen wird — dort gibt es keinen Wächter; das ist bewusst benannt, nicht gelöst.

### Schritt 5 — Drei Beleg-Regeln, die die Prüfung selbst tragen

Ein Prüfwerkzeug, das man nicht selbst geprüft hat, ist gefährlicher als keins — es kommt mit dem Anschein der Messung. Drei Regeln haben sich als unverzichtbar erwiesen:

1. **„Existiert nirgends" braucht das rohe `grep`.** In dieser Umgebung ist `grep` eine Shell-Funktion, die in Wahrheit `ugrep` mit `--ignore-files --hidden -I --exclude-dir=.git` aufruft: sie befolgt `.gitignore` und übersieht damit genau die Ordner, in denen der Harness liegt. Jede Null-Aussage wird gegengeprüft:

   ```bash
   type grep                                              # Funktion oder /usr/bin/grep?
   grep                   -rl statusline . | wc -l
   grep --no-ignore-files -rl statusline . | wc -l
   /usr/bin/grep -rl --exclude-dir=.git statusline . | wc -l
   /usr/bin/grep -rl statusline . | wc -l
   ```

   Gemessen am 02.08.2026 in dieser Werkbank, Suchwort `statusline`: **3 · 36 · 39 · 41**. Der Sprung von 3 auf 36 ist der ignorierte Bereich — das ist die Aussage dieses Punkts. Die restlichen zwei Differenzen sind erklärt und harmlos: die 3 zwischen 36 und 39 sind Binärdateien (`-I` der Funktion, per `diff` der Trefferlisten nachgesehen: drei `claude`-Binaries in `node_modules`), die 2 zwischen 39 und 41 liegen in `.git/`. Die Größenordnung hängt am Suchwort, die Richtung nie.
2. **Belege tragen Abschnitts-Anker, keine Zeilennummern.** `§6.8.3`, ein Symbolname oder eine Überschrift altern nicht; eine Zeilennummer ist beim Nachlesen falsch, obwohl die Aussage stimmt — allein diese Anleitung wurde an einem Tag siebenmal geändert.
3. **Ein Workflow-Ergebnis wird erst gelesen, nachdem die Fehlerzahl geprüft ist.** Der Status „completed" heißt nur, dass der Lauf endete. Gestorbene Bahnen stehen im Fehler-Block, nicht im Ergebnis; wer nur das Ergebnis liest, hält eine Teilmenge für das Ganze.

Dazu zwei Merksätze aus derselben Erfahrung: *Ein Abgleich zeigt Ungleichheit, nicht Richtung* — welche Seite stimmt, entscheidet die Sache, nicht das Werkzeug. Und *wer misst, was er selbst gerade verändert, misst zweimal.*

**Geklappt, wenn:** `type grep` ausgeführt ist und die vier Trefferzahlen für ein sicher vorhandenes Wort nebeneinander stehen. Weichen sie ab, gilt ab sofort `/usr/bin/grep` (oder `grep --no-ignore-files`) für jede Aussage der Form „gibt es nicht".

### Schritt 6 — Negativ-Register anlegen (das billigste Dokument im Haus)

Jedes geprüfte und **verworfene** Werkzeug bekommt eine Zeile mit Grund. Jedes „später vielleicht" kommt auf ein Später-Regal — **mit benanntem Wiedervorlage-Anlass**, denn „später" ohne Anlass ist kein Beschluss, sondern eine Waise. Ohne dieses Register wird dieselbe Bibliothek dreimal evaluiert und dreimal verworfen, jedes Mal von vorn.

Dazu gehört ein **Legitimitäts-Gate vor jeder Installation**: Name (Tippfehler-Squatting), Herkunft, Alter, Lizenz — und bei übernommenen fremden Fähigkeiten die Quelle archivieren, nicht nur verlinken. Auch dieses Gate braucht ein Signal, sonst ist es der Merksatz, den Schritt 3 für tot erklärt: es bekommt eine **eigene Spalte** und dieselbe Probe.

```bash
[ -f docs/negativ-register.md ] || printf '# Negativ-Register\n\n| Verworfen | Grund | Herkunft/geprüft am |\n|---|---|---|\n' > docs/negativ-register.md
awk -F'|' 'NF>3 && ($3 ~ /^[[:space:]]*$/ || $4 ~ /^[[:space:]]*$/) {print NR": Grund oder Herkunft fehlt"}' docs/negativ-register.md
```

Das `[ -f … ] ||` davor ist kein Zierrat: das nackte `>` überschreibt ein vorhandenes Register wortlos.

**Geklappt, wenn:** die Datei existiert, der `awk`-Lauf **keine** Zeile ausgibt — und der Nachbauer ihn einmal in die Gegenrichtung gesehen hat. Beides nachgestellt: frisch angelegt und mit einer vollständigen Zeile schweigt er (Kopf- und Trennzeile lösen ihn nicht aus), mit einer Zeile ohne Grund und einer ohne Herkunft meldet er genau diese zwei Zeilennummern. Committet wird das Register wie jedes andere Wahrheits-Dokument — das `??`-Gate aus Schritt 2 gilt erst danach.

### Was hier bewusst nicht steht

Die instanzabhängigen Teile des Standards — konkreter Werkzeugkanon, Modell-Router, Plugin-Entscheidungen, die Frage, was davon ein angebundenes Produkt erreicht — gehören in die eigene Fassung des Nachbaus, nicht in eine generische Anleitung. Übertragbar ist das Verfahren: **Zieldefinition, zwei getrennte Messungen, Verify vor Ship, Denkbudget je Bahn, Belege statt Erinnerung, verworfen mit Grund.** Alles andere ist Ausstattung.

---

---

## 9. Bekannte Fallen (in dieser Session real passiert)

- **Statusleiste täuscht:** zeigt immer `<WORKSPACE> · main` (das cwd), NICHT wohin committet wird. Die „+X -Y"-Zahl daneben sind **Zeilen im Arbeitsverzeichnis**, keine „ungepushten Commits". Kontrolle immer über `/repo-status`.
- **UI-Button „PR erstellen"** bezieht sich IMMER auf den Workspace-Repo, nie auf ein Projekt. Für Projekt-PRs explizit im Projektordner arbeiten.
- **gitignore-Backup-Falle:** Ein Projekt erst gitignoren, NACHDEM sein eigenes Repo verifiziert gepusht ist. Pauschales `user-projects/` macht ungesicherte Projekte unsichtbar UND ungeschützt.
- **Große-Datei-Falle:** Wird eine Datei per gitignore vom Push ausgeschlossen UND danach die Quelle gelöscht, existiert sie nirgends mehr. Erst Cloud-Backup, dann (nach Bestätigung) evtl. löschen.
- **Windows Case-Rename:** `Foo` → `foo` ignoriert Windows still. Zweistufig über Zwischennamen (`Foo` → `foo-tmp` → `foo`).
- **Windows lange Pfade:** `git config core.longpaths true`, sonst „Filename too long" bei `git add`.
- **`gh` nicht im PATH:** `export PATH="$PATH:/c/Program Files/GitHub CLI"`.
- **Sync-Check ohne fetch:** `git ls-remote origin refs/heads/<branch>` liefert den Remote-Hash schnell; mit lokalem `git rev-parse HEAD` vergleichen (kein voller `fetch` nötig).
- **Plugin nicht global:** Prüfen mit `~/.claude/settings.json` → `enabledPlugins` muss NICHT nötig leer sein; das Plugin ist bewusst nur im Workspace aktiv. Projekte nie rausziehen.

---

## 10. Große Dateien (> 100 MB) → Cloud

GitHub lehnt Dateien > 100 MB hart ab (Push scheitert). Vorgehen:
1. Datei **bleibt** im Projektordner (App/Claude greifen normal zu).
2. In `.gitignore` des Projekts ausschließen.
3. Per rclone in Cloud-Storage hochladen (rclone-Remote muss eingerichtet sein: `rclone config`, OAuth-Login durch den Nutzer). Upload läuft lokal, nicht über eine Tool-Schnittstelle:
   ```bash
   rclone copy "<datei>" "<remote>:<zielpfad>/" --drive-root-folder-id <ID>
   ```
   Konto der rclone-Verbindung prüfen (der Name täuscht evtl.): Drive-API `about?fields=user(emailAddress)`.
4. Im Projekt eine `GROSSDATEIEN.md` anlegen: welche Datei, Größe, Ort im Projekt, Cloud-Ort (+Ordner-ID), warum nicht auf GitHub, wie zurückholen.

---

## 11. Betrieb / täglicher Workflow

- **Neue Session:** cwd immer = `<WORKSPACE>` (damit Plugin greift). Der SessionStart-Hook fragt nach dem Projekt-Kontext.
- **Arbeiten:** an einem Projekt in `user-projects/<projekt>/`. Commits via `git -C <projekt>` mit Ziel-Ansage.
- **Sichern:** proaktiv nach jedem Block; manuell per `/save-work`; Kontrolle per `/repo-status` (Ziel: überall „Ungesichert: 0", „synchron").
- **Parallele Sessions:** möglich, weil jede in ihrem Projektordner committet — nie im Workspace-cwd.

---

## 12. Nachbau-Checkliste (Kurzform)

- [ ] Node, Git (`core.longpaths`), `gh` (`gh auth login`), optional rclone installiert
- [ ] `<WORKSPACE>` mit Harness-Material → git init → GitHub-Repo → push
- [ ] `.claude/settings.json` (Plugin aktivieren + 2 Hooks; `<WORKSPACE_ABS>` im Stop-Command anpassen)
- [ ] `.claude/repo-status.js`, `uncommitted-warn.js`, `commands/repo-status.md`, `commands/save-work.md` anlegen
- [ ] `CLAUDE.md`-Architektur-Abschnitt schreiben
- [ ] `.gitignore`-Muster (node_modules, große Dateien, `.playwright-mcp/`)
- [ ] `user-projects/` anlegen
- [ ] pro Projekt: Ordner → git init → GitHub-Repo (gleicher Name) → push → danach namentlich in `.gitignore`
- [ ] Test: `node .claude/repo-status.js` zeigt alle Repos, alle „synchron"
- [ ] **Offene Punkte in eine Datei im Repo schreiben** (nicht im Sitzungsverlauf lassen)
- [ ] **Setup-Sitzung beenden/verwerfen** — sie hat weder Hooks noch `CLAUDE.md` (§0)
- [ ] Regel-Trigger geprueft: nur `typescript`/`react` triggern auf TS-Dateien (§6.8.1)
- [ ] Skill-Liste kuratiert, falls > ~70 Skills installiert sind (§6.8.2)
- [ ] `git-guard.js`, `statusline.js`, `session-roles.js` angelegt + in `settings.local.json` verdrahtet (§6.8.3–6.8.7)
- [ ] `danger-guard.js` angelegt, **beide Richtungen getestet** (blockiert / lässt durch) und verdrahtet (§6.8.9)
- [ ] `commands/session-map.md` + `commands/tell-session.md` angelegt (§6.8.6)
- [ ] `jq`-Pruefung der `settings.local.json` bestanden (§6.8.7)
- [ ] **Neue Sitzung mit cwd = `<WORKSPACE>` starten** und dort prüfen: SessionStart-Hook greift, `/repo-status` sauber → erst dann ist der Nachbau fertig
```
