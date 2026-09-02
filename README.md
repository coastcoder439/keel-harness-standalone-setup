# keel-harness-v2-setup

Dies ist der **Setup-Bausatz des neuen Keel Harness**: eine projektlokale
Ausstattung für Claude Code und Codex — Wächter-Hooks, paketgebundene Arbeitsweise
(Unlazy), endliche Git-Schnittstelle, React-Dashboard —, installiert von einem
transaktionalen Installer in die Wurzel eines Git-Repos deiner Wahl. Kein Produkt,
kein Dienst: ein Bausatz, von außen angewendet, danach entbehrlich.

## Für dich als Mensch: so geht es

1. Öffne Claude Code. In welchem Ordner, ist egal.
2. Gib dem Agenten diesen Link: `https://github.com/coastcoder439/keel-harness-v2-setup`
   und schreib dazu: **„Installiere diesen Harness."**
3. Der Agent fragt dich, wie dein Harness-Ordner heißen und wo er liegen soll. Alles
   Weitere macht er selbst und meldet sich nur, wenn etwas im Weg liegt.
4. Wenn er fertig ist, sagt er dir: Claude Code neu starten, Session im Harness-Ordner
   öffnen. Das machst du.
5. In dieser neuen Session beginnt das **Onboarding von selbst**: Der Agent füllt mit
   dir `docs/harness-instance.md` aus — Projektsprache, Owner-Rolle, Schreibwurzeln,
   Publish-Regeln — und geht die Punkte durch, die nur du entscheiden kannst
   (GitHub-Remote, erstes Push). Danach ist der Harness in Betrieb.

Du tippst selbst genau zweierlei: den Link und den Namen deines Ordners. Alles andere
wird dir als Frage gestellt.

Ohne Agenten, von Hand: `PAKET-ANLEITUNG.md`.

---

## Für den Agenten: Installation (Phase 1)

Du hast diesen Link bekommen und sollst den Harness installieren. Führe die Schritte
der Reihe nach aus. Du fragst den Menschen nur, was hier als Frage steht; alles andere
entscheidest und erledigst du selbst.

1. **Frage nach dem Harness-Ordner:** „Wie soll dein Harness-Ordner heißen, und wo
   soll er liegen?" Ein bestehendes Projekt-Repo ist genauso möglich wie ein neuer
   Ordner. Der genannte Pfad ist ab jetzt `<HARNESS>`. Existiert er nicht, legst du
   ihn an.

2. **Lade dieses Repo in einen Arbeitsordner außerhalb von `<HARNESS>`** — zum
   Beispiel ins Temp-Verzeichnis des Systems, nie in `<HARNESS>` und nie als ähnlich
   benannter Nachbarordner:
   ```
   git clone https://github.com/coastcoder439/keel-harness-v2-setup.git <ARBEIT>
   ```

3. **Prüfe still, ob etwas im Weg liegt.** Der Installer nimmt nur die **Wurzel eines
   echten Git-Repos** an (er schützt das Ziel transaktional und stellt bei Fehlern den
   Vorzustand wieder her). Ist `<HARNESS>` ein Repo mit ungesicherten Änderungen: sag
   es dem Menschen und warte, bis gesichert ist. Ist es noch kein Repo:
   ```
   git -C <HARNESS> init -b main
   ```
   Dann der Trockenlauf, ohne ihn zu zeigen:
   ```
   node <ARBEIT>/install.mjs --target <HARNESS> --dry-run
   ```
   Erwartet ist genau eine Zeile `keel harness distribution: command=install
   state=planned … dry-run=true managed=…` und Rückgabewert 0. Alles andere sagst du
   dem Menschen wörtlich und fragst, ob du fortfahren sollst.

4. **Installiere:**
   ```
   node <ARBEIT>/install.mjs --target <HARNESS>
   ```
   Erwartet: `state=installed` und Rückgabewert 0. Bei einem Fehler zeigst du die
   Meldung wörtlich und improvisierst keine Reparatur — der Installer hat den
   Vorzustand selbst wiederhergestellt; nur nach einem Absturz mitten im Lauf vollendet
   `node <ARBEIT>/install.mjs rollback --target <HARNESS>` dieselbe Wiederherstellung.
   Nur wenn der Mensch das offizielle Codex-Plugin ausdrücklich will, hängst du
   `--install-codex-plugin` an; ohne den Schalter läuft kein externes Kommando.

5. **Sichere in `<HARNESS>`:**
   ```
   git -C <HARNESS> add -A
   git -C <HARNESS> commit -m "harness: installiert"
   ```
   Die installierte `.gitignore` hält Laufzeit-Zustand heraus. Ein Remote anlegen und
   pushen ist Sache des Menschen — das kommt im Onboarding.

6. **Räume auf:** lösche `<ARBEIT>`. In `<HARNESS>` liegt nichts vom Bausatz.

7. **Sag dem Menschen wörtlich:** „Der Harness ist in `<HARNESS>` installiert. Bitte
   Claude Code neu starten und eine Session in diesem Ordner öffnen — dort beginnt
   das Onboarding von selbst." Damit ist deine Aufgabe beendet.

Grenzen: Du schreibst nur in `<HARNESS>` und `<ARBEIT>`. Du fragst keine Secrets ab.
Du änderst den Bausatz nicht.

## Für den Agenten: Onboarding (Phase 2)

Läuft von selbst. Der installierte SessionStart-Hook `.claude/onboarding-start.js`
schickt beim Start einer Session in `<HARNESS>` den Befehl `/onboarding`, solange
`docs/harness-instance.md` dort noch die Pflicht-Marke `[AUSFUELLEN]` enthält. Die
Prozedur steht in `.claude/commands/onboarding.md`; der gemeinsame Hostvertrag
(`CLAUDE.md`/`AGENTS.md`, bytegleich) bleibt unverändert — installationsspezifische
Werte besitzen genau diese eine Instanzdatei.

---

## Warnung — die Auslieferung ist generiert

`payload/`, `manifest.json`, `lib/`, `install.mjs`, `DISTRIBUTION.md` und `UPDATE.md`
entstehen reproduzierbar aus der Werkbank (`harness-lab`, dort
`test-harness/standalone/`) über `node scripts/build-payload.mjs`; Quell-Commit und
Fingerabdruck jedes Laufs stehen in `payload-provenance.json`.
**Handänderungen an diesen Teilen werden beim nächsten Lauf überschrieben.** Wer etwas
ändern will, ändert es an der Quelle in der Werkbank — nicht hier.

## Voraussetzungen

- Node ≥ 20 (LTS empfohlen) und Git — kein npm-Install, kein Bauschritt
- Claude Code nur für den Agenten-Weg; von Hand geht es ohne

## Enthalten

| Teil | Zweck |
|---|---|
| `install.mjs` | Der Installer — das unveränderte Original der Standalone-Distribution (install / uninstall / rollback / status / doctor, transaktional mit Journal und Backups) |
| `manifest.json` | Stückliste: jede Payload-Datei mit Herkunft, Größe, Prüfsumme; darunter, was bewusst fehlt und warum |
| `payload/` | Der neue Harness: `.claude`- und `.codex`-Wächter samt Befehlen und Skills, `harness-core` (Paket-Executor, Git-Intents), `vendor/unlazy`, React-Dashboard als geprüftes Archiv, installierte Checks |
| `lib/` | Transaktions-Lebenszyklus des Installers (`distribution-lifecycle.mjs`, `generic-content.mjs`) |
| `DISTRIBUTION.md`, `UPDATE.md` | Die technischen Originale der Distribution: Transaktionsmodell, Upgrade-Vertrag, Deprecations |
| `payload-provenance.json` | Quell-Commit, Schmutzstand und Fingerabdruck der letzten Payload-Erzeugung |
| `PAKET-ANLEITUNG.md` | Der Weg von Hand, Windows zuerst, mit Fehlertabelle |
| `checks/fresh-clone.mjs` | Abnahmetest des geklonten Bausatzes (`--voll`: echte Probe-Installation) |
| `scripts/build-payload.mjs` | Erzeugt die Auslieferung neu aus einem harness-lab-Checkout — keine Hand-Kopien |
| `docs/packages/` | Verweis auf das Arbeitspaket in der Werkbank |

## Installer-Befehle

```text
node install.mjs --target <repository> --dry-run
node install.mjs --target <repository>
node install.mjs status --target <repository>
node install.mjs doctor --target <repository>
node install.mjs rollback --target <repository>
node install.mjs uninstall --target <repository>
node install.mjs install --target <repository> --upgrade
```
