# keel-harness-standalone

Dies ist der **Standalone-Keel-Harness**: eine Claude-Code-Ausstattung — Wächter-Hooks,
Dauer-Regeln, Befehle, Skills —, die eine Claude-Code-Session diszipliniert arbeiten lässt.
Kein Produkt, kein Framework. Ein Bausatz, der in einen Harness-Ordner installiert wird.

## Für dich als Mensch: so geht es

1. Öffne Claude Code. In welchem Ordner, ist egal.
2. Gib dem Agenten diesen Link: `https://github.com/coastcoder439/keel-harness-standalone`
   und schreib dazu: **„Installiere diesen Harness."**
3. Der Agent fragt dich, wie dein Harness-Ordner heißen und wo er liegen soll. Alles
   Weitere macht er selbst und meldet sich nur, wenn etwas im Weg liegt.
4. Wenn er fertig ist, sagt er dir: Claude Code neu starten, Session im Harness-Ordner
   öffnen. Das machst du.
5. In dieser neuen Session beginnt das **Onboarding von selbst**: Der Agent fragt dich
   nacheinander, wozu der Workspace dient, wer daran arbeitet, welche Repos dazugehören,
   und geht mit dir die Punkte durch, die nur du entscheiden kannst (GitHub-Remote,
   Schreibziele des Wächters). Danach ist der Harness in Betrieb; `/repo-status` zeigt
   dir jederzeit den Stand.

Du tippst selbst genau zweierlei: den Link und den Namen deines Ordners. Alles andere
wird dir als Frage gestellt.

Ohne Agenten, von Hand: `PAKET-ANLEITUNG.md`.

---

## Für den Agenten: Installation (Phase 1)

Du hast diesen Link bekommen und sollst den Harness installieren. Führe die Schritte der
Reihe nach aus. Du fragst den Menschen nur, was hier als Frage steht; alles andere
entscheidest und erledigst du selbst.

1. **Frage nach dem Harness-Ordner:** „Wie soll dein Harness-Ordner heißen, und wo soll
   er liegen?" Ein bestehender Projektordner ist genauso möglich wie ein neuer. Der
   genannte Pfad ist ab jetzt `<HARNESS>`. Existiert er nicht, legst du ihn an.

2. **Lade dieses Repo in einen Arbeitsordner außerhalb von `<HARNESS>`** — zum Beispiel
   in das Temp-Verzeichnis des Systems, nie in `<HARNESS>` und nie in dessen Elternordner
   als Unterordner mit ähnlichem Namen:
   ```
   git clone https://github.com/coastcoder439/keel-harness-standalone.git <ARBEIT>
   ```

3. **Prüfe still, ob etwas im Weg liegt.** Ist `<HARNESS>` ein Git-Repo mit ungesicherten
   Änderungen: sag es dem Menschen und warte, bis gesichert ist. Führe dann den Trockenlauf
   aus, ohne ihn zu zeigen:
   ```
   node <ARBEIT>/install.mjs --paket <ARBEIT> --ziel <HARNESS> --trocken
   ```
   Nur wenn dort etwas Ungewöhnliches steht — eine vorhandene `CLAUDE.md` in `<HARNESS>`,
   `ABWEICHEND`, `ACHTUNG`, ein Rückgabewert 2 — sagst du es dem Menschen wörtlich und
   fragst, ob du fortfahren sollst. Sonst fährst du ohne Rückfrage fort.

4. **Installiere:**
   ```
   node <ARBEIT>/install.mjs --paket <ARBEIT> --ziel <HARNESS>
   ```
   Rückgabewert 2 = Abbruch: die Meldung wörtlich zeigen, samt „N von M Posten", nicht
   improvisieren, keinen eigenen Reparaturversuch.

5. **Sichere in `<HARNESS>`:**
   ```
   git -C <HARNESS> init -b main          # nur, falls noch kein Repo
   git -C <HARNESS> add .claude .gitignore CLAUDE.md dashboard docs licenses
   git -C <HARNESS> commit -m "harness: installiert"
   ```
   Ein Remote anlegen und pushen ist Sache des Menschen — das kommt im Onboarding.

6. **Räume auf:** lösche `<ARBEIT>`. In `<HARNESS>` liegt nichts vom Bausatz.

7. **Sag dem Menschen wörtlich:** „Der Harness ist in `<HARNESS>` installiert. Bitte
   Claude Code neu starten und eine Session in diesem Ordner öffnen — dort beginnt das
   Onboarding von selbst." Damit ist deine Aufgabe beendet.

Grenzen: Du schreibst nur in `<HARNESS>` und `<ARBEIT>`. Du fragst keine Secrets ab. Du
änderst den Bausatz nicht.

## Für den Agenten: Onboarding (Phase 2)

Läuft von selbst. Der installierte SessionStart-Hook `.claude/onboarding-start.js` schickt
beim Start einer Session in `<HARNESS>` den Befehl `/onboarding`, solange die `CLAUDE.md`
dort noch `[?]` enthält. Die Prozedur steht in `.claude/commands/onboarding.md`; die
`CLAUDE.md` selbst bleibt reine Beschreibung des Workspace.

---

## Warnung — dieses Repo ist generiert

Der Inhalt hier entsteht automatisch aus der Werkbank (Quell-Commit: `e165ec6`).
**Handänderungen an diesem Repo werden beim nächsten Generator-Lauf überschrieben.**
Wer etwas ändern will, ändert es an der Quelle in der Werkbank — nicht hier.

> **Ausnahme, 2026-08-18:** README, PAKET-ANLEITUNG, `templates/` und der Installer wurden
> von Hand auf den Zwei-Phasen-Ablauf umgestellt (neu: `/onboarding` + `onboarding-start.js`);
> die Paket-`CLAUDE.md` ist entfallen. Begründung und Änderungsliste für die Werkbank:
> `AENDERUNGEN-ANLEITUNG-2026-08-18.md`. Bis die Werkbank nachgezogen ist, überschreibt
> der Generator diese Änderungen.

## Voraussetzungen

- Claude Code (für den Weg von Hand nicht nötig)
- Node ≥ 18
- Git

## Enthalten

| Teil | Zweck |
|---|---|
| `payload/` | Die Nutzlast: `.claude` mit Wächter-Hooks, Dauer-Regeln, Befehlen (`/repo-status`, `/save-work`, `/session-map`, `/tell-session`, `/onboarding`), Skills |
| `templates/` | `CLAUDE.md`, `settings.json` und der `.gitignore`-Block, die ins Ziel geschrieben werden |
| `payload/dashboard/` | Dashboard: misst und zeigt an, ein Aufruf |
| `payload/docs/`, `licenses/` | Langfassungen, auf die die Regeln verweisen; Lizenzen der übernommenen Skills |
| `install.mjs` | Installiert die Nutzlast nach `<HARNESS>` (fragt selbst nichts ab, löscht nichts) |
| `PAKET-ANLEITUNG.md` | Der Weg von Hand, mit Fehlertabelle |
| `checks/frisch-geklont.mjs` | Abnahmetest des Pakets |
| `manifest.json` | Stückliste: jede Datei mit Herkunft, Größe, Prüfsumme; darunter, was bewusst fehlt |
