# Keel Harness

> Gemeinsamer dauerhafter Vertrag für Claude Code und Codex. AGENTS.md ist die
> einzige Quelle; CLAUDE.md enthält nur den Import `@AGENTS.md` (D3); Tests blockieren Drift.

## Zweck und Grenzen

- Dieses Harness gilt ausschließlich für das echte Git-Repository, in dessen
  Wurzel es installiert ist. Es enthält keinen fest eingebauten Projekt-,
  Workspace-, Sitzungs- oder Rollennamen.
- Lokal arbeiten Agenten frei: Dateien schreiben und löschen, committen,
  pushen, installieren und Skripte ausführen brauchen weder ein Paket noch eine
  Bindung noch eine Freigabe. Der einzige Schutz ist der GitHub-Löschschutz:
  Löschen und Überschreiben auf GitHub (zum Beispiel einen Branch oder ein
  Release löschen, ein Force-Push auf main) geschieht nur mit ausdrücklicher Erlaubnis
  des Owners im Chat; die Freigabe für den Befehl ist `KEEL_GITHUB_DELETE_OK=1`.
- Projektsprache, Owner-Rolle, zusätzliche Schreibwurzeln und Publish-Regeln
  werden je Installation in `docs/harness-instance.md` festgelegt.
- Zugangsdaten, lokale Freigaben und settings.local.json werden nie
  versioniert oder ausgeliefert.
- Installationsspezifische Owner-/Projektwerte leben ausschließlich in
  `docs/harness-instance.md`; der gemeinsame Hostvertrag wird dafür nicht kopiert.

## Arbeitsweise

Geprüft wird das Ergebnis der Arbeit (Unlazy-Gates, Fertig-Format), nicht die
einzelne Handlung. Ein Arbeitsagent eines Pakets ändert die Dateien seines
Arbeitsschritts (OWNS); der Rücklauf übernimmt nur diese Dateien. Planen, Pakete
anlegen, delegieren, prüfen, Git-Pflege, Projektwerkzeuge, MCP-Dienste und das
Installationsprofil brauchen kein eigenes Paket.

## Repo, Paket und Originalauftrag

Arbeit gehört immer dem nächsten echten Git-Root des Schreibziels. Ein
.git-Verzeichnis und eine reguläre .git-Datei sind Repository-Grenzen;
verschachtelte Repos, Worktrees, Windows-Case-Folding und gleichnamige Pakete
bleiben getrennt. Kein Eltern-Repo besitzt Arbeit eines Kind-Repos.

Die einzige versionierte Paketwahrheit liegt im besitzenden Repo:
Der primäre Paketdatensatz ist `docs/packages/<packageId>/PACKAGE.md`; seine
Owner- und Gate-Sidecars liegen ausschließlich im selben Bundle:

    docs/packages/<packageId>/
      OWNER.md
      PACKAGE.md
      GATES.md
      gates/
        leaf-<id>.md
        node-<id>.md
      design/                 optional, keine Statuswahrheit

OWNER.md hält den unveränderlichen Originalauftrag und ordnet jede
Owner-Anforderung R<n> genau einem Paketvertrag C<n> zu. Problem, Intent,
Goal, Plan, Depth Tree und Leaf-Verträge werden daraus abgeleitet; sie dürfen
den Auftrag nicht ersetzen oder verkleinern. .unlazy/ enthält nur ignorierten
Runtimezustand und Receipts, nie fachliche Wahrheit.

## Vollständige Unlazy-Arbeitsweise

Vor Fan-out müssen Depth Tree, Leaf-/Node-Verträge, disjunkte OWNS
(repo-relative), Gate-Zuordnung und ausführbare oder manuelle Abnahmebedingungen
vollständig sein. Activation bindet Repo, Paket, Scope und Owner-Vertrag.
Concurrent Leaves werden claimed und leased. Die gebundene Orchestrierung öffnet
eine Dispatch-Welle, startet alle Mitglieder, registriert ihre nativen Handles
und versiegelt die Welle vor dem ersten Wait.

Provider-Rücklauf ist keine Evidence, der eigene Prüflauf des Agenten auch nicht.
Der Parent prüft jedes Leaf an einem Commit-Objekt aus HEAD plus genau den
OWNS-Änderungen des Schritts in einer sauberen Kopie (gate-check --at); ein
gespeichertes Ergebnis desselben Code-Stands gilt dort und später weiter.
Nach allen Returns baut integrate mit expliziter Check-Ausführungsfreigabe den
Integrations-Commit, ohne den Branch zu bewegen, prüft daran Leaf-, Node- und
Root-Gates bottom-up, leitet erst aus grüner Evidence die Planhaken ab und zieht
den Branch nur bei Grün auf genau einen Integrations-Checkpoint vor; ein
erneuter Aufruf auf demselben Stand startet keinen Prüfbefehl und liefert
denselben Checkpoint statt eines zweiten. close läuft in einem Schritt: der Owner sagt im
Chat OK (du liest es aus dem Gespräch und legst seine Nachricht als wörtliches Zitat ab,
ohne Längengrenze; nie wird eine Satzform erfragt), `close --owner-ok "<Wortlaut>"` (oder
`--owner-ok-file <Datei>` für Mehrzeiliges) schreibt den Owner-OK-Eintrag in den
Abschnitt Abschluss der PACKAGE.md, prüft die Gates an HEAD in einer sauberen
Kopie (gespeicherte Ergebnisse desselben Code-Stands gelten; fremde ungesicherte
Dateien spielen keine Rolle; manuelle Gates nur, solange ihr Code-Stand gleich
ist) und schreibt den Closure-Commit. recover-close prüft vor seinem
Closure-Checkpoint HEAD ebenso; ist dieser Commit bereits geschrieben,
kehrt der Aufruf unverändert und ohne erneute Prüfung zurück. Bleibt die
Prüfung der Recovery rot, entsteht kein Closure-Commit; der Ausweg ist ein
erneutes close mit dem neuen OK des Owners. --timeout wird angenommen und
ändert nichts; Hänger erkennt der Stille-Wächter.
Geschlossen wird nur bei vollständiger Coverage und Fulfillment.

## Sieben Schritte, je eine verantwortliche Schnittstelle

1. **Erfassen** — OWNER.md plus daraus abgeleitetes PIG; Package-Schema.
2. **Zuordnen** — realer Git-Root, Paket und Scope; Resolver + Activation.
3. **DoD/Contract** — Depth Tree, R→C→Gate, OWNS; Package-Schema.
4. **Arbeiten** — Claims, Bindings, Dispatch und Returns; Package-Executor.
5. **Coverage** — vollständige Owner-/Contract-/Gate-Zuordnung; Statusprüfung.
6. **Fulfillment** — lokale Leaf→Node→Root-Evidence; integrate.
7. **Abschluss** — Owner-OK-Zeile, Prüfung an HEAD in sauberer Kopie, Close-Receipt; close.

Prompt-Erinnerungen und Schlussformulierungen sind Kommunikation, kein
deterministischer Ersatz für diese Übergänge.

## Claude, Codex und der GitHub-Löschschutz

Der Package-Executor startet Claude-Arbeitsagenten mit der Claude CLI und
Codex-Leaves mit codex exec, beide ohne Wächter-Hooks; delegierte Codex-Arbeit
nutzt gpt-5.6-sol mit max. Beide sehen ihre Paketsitzung in
KEEL_PACKAGE_SESSION. .claude/settings.json aktiviert weiter das offizielle
projektbezogene codex@openai-codex-Plugin; seine Befehle laufen über ein
Node-Skript außerhalb der Installation. Codex- oder Claude-Erfolg ersetzt nie
lokale Evidence.

Der GitHub-Löschschutz gilt für jeden Agenten gleich: die eigene Claude-Sitzung,
Arbeitsagenten der Claude CLI und Codex, für Bash wie PowerShell. Er sperrt
Löschen und Überschreiben auf GitHub, bis der Owner es im Chat ausdrücklich
erlaubt hat; die Freigabe für den Befehl ist KEEL_GITHUB_DELETE_OK=1. Sonst
sperrt er nichts. Eine eigene Codex-Sitzung bekommt ihn über .codex/hooks.json,
sobald der Owner ihn dort einmal mit /hooks freigibt. Sagt der Owner einem
Agenten, etwas auf GitHub zu löschen, ist das die Erlaubnis; der Agent setzt die
Freigabe für genau diesen Befehl.

Aktiv verdrahtet sind:

- SessionStart: installationsdefinierte Rollen, Onboarding (schlägt
  `/onboarding` vor, solange das Installationsprofil `[AUSFUELLEN]` trägt; ohne
  Paket), Projektkontext und Scope-Verschmutzung; das Produkt liefert keine
  vorgegebenen Sessions aus.
  Läuft das Dashboard nicht, startet dashboard-ensure es (nur in Installationen
  mit Runtime-Archiv; KEEL_DASHBOARD_AUTOSTART=0 schaltet das ab).
- UserPromptSubmit: knappe Antwortform und bereits gebundene Paketidentität.
- PreToolUse: der GitHub-Löschschutz (github-delete-guard, für Bash und
  PowerShell), sonst nichts.
- Stop: dod-guard sperrt nur beim Fertig-Anspruch (Meldung ohne `Geprueft gegen:`
  und `Offen:`); den vollständigen Unlazy-Gate-/Dispatch-Schutz bekommt ein
  Arbeitsagent, sonst nur die Sitzung, die ihr Paket orchestriert, und nur bei
  Fertig-Anspruch mit offenen Gates; dazu lokaler Backup-Hinweis.
- Statusline: tatsächliches Repo, Branch und Sicherungszustand.

## Dashboard, Nachweis und Lieferung

Das Dashboard aggregiert repoKey::packageId über reale Repos und zeigt
Originalauftrag, abgeleitetes Goal, Tree, Sessions, Claims, Dispatch, Gates,
Evidence, Blocker und Git-Stand. Paket-, Plan-, Gate- und Evidence-Zustand ist
dort read-only.

Zahlen werden gemessen. Eine Arbeitsmeldung endet mit Geprueft gegen: und
Offen:; das ist nur Berichtsformat. Fertig bedeutet: Gesamtlauf ohne Hänger,
Upstream-Unlazy-Regressionsschutz, Unit/Integration/E2E, Windows/Multi-Repo/
Worktree/Crash/Timeout/Stale-State, Dashboard, Standalone-Frischinstallation
und unabhängiger Abgleich jeder Owner-Anforderung sind grün. Erst danach darf
ein ausdrücklich freigegebener Publish erfolgen.

## Bedienung

- Git: normales git ist frei. harness-core/git/git-intent.mjs (inspect, checkpoint, unstage,
  discard-working, revert-checkpoint u. a.) bleibt als Werkzeug, ist aber kein Pflichtweg.
- Paketstatus: node harness-core/execution/package-executor.mjs status ...
- Nächstes Leaf/Fan-out: next|start, dann dispatch (mit `--step-copy` arbeitet jeder Schritt in einer
  eigenen Arbeitskopie; der Rücklauf übernimmt nur die Dateien seines OWNS)
- Rücklauf: return; Integration: integrate --approve-checks
- Gates ohne CHECK: review-manual --gate LEDGER:GATE --evidence evidence/<datei>
  --session <id> (nur Orchestrator; Beleg im Paket, Datum und Sitzung in EVIDENCE)
- Abschluss: close
- Dashboard-Betrieb: npm run dashboard (Mensch) oder node dashboard/serve.mjs [--port <n>]
  (Agent) — beide starten denselben einzigen
  Startweg; dashboard/serve.mjs
  startet die gebaute Runtime als einen Prozess lokal auf 127.0.0.1; Pruefung:
  npm run test:dashboard:runtime
- Sprachlaufzeit: node dashboard/serve.mjs --voice (oder --speech / --microphone)
  gibt die Sprach-Routen frei; Stimme, Hoeren (Whisper) und Profile laufen ueber die
  installierte Voicebox (einzige Sprach-Laufzeit, Datenverzeichnis der App), gestartet
  aus dem Dashboard; --no-inference pausiert die KI (ohne Flag ist sie an).
  Installationsstand und Systemprofil: node voice/check.mjs (--require-ready liefert
  Exitcode 1, wenn Voicebox nicht laeuft); Regeln und Umgebungsschluessel in voice/README.md
- Dashboard-Entwicklung (nur Quellbaum): npm run dashboard:dev — setzt
  KEEL_ACCOUNTABILITY_NEXT_DIST_DIR=.next-dev nur fuer seinen Kindprozess und
  bindet 127.0.0.1; ohne die Variable baut next dev in .next und zerstoert den
  standalone-Build; Regeln in dashboard/README.md des Quellbaums
- Harness prüfen: node checks/run-all.mjs
- Release (nur Produkt-Quellbaum): node scripts/release-standalone.mjs --version
  X.Y.Z --summary TEXT --owner-ok TEXT|--owner-ok-file DATEI --clone DIR
  [--setup DIR] [--dry-run]; eine Setup-Version entsteht nur mit Nachweis für
  den Commit (grüner Gesamtlauf-Bericht dieses Stands, sonst führt das Release
  selbst checks/test-matrix.mjs --at <main> aus: gespeicherte grüne Phasen gelten,
  nur geänderte laufen) und dem Zitat des Owners (nicht leer, ohne Satzform);
  --dry-run zeigt je Phase reuse/run; nur mit --dry-run ist das Zitat optional.
