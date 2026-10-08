# Keel Harness

> Gemeinsamer dauerhafter Vertrag für Claude Code und Codex. AGENTS.md ist die
> einzige Quelle; CLAUDE.md enthält nur den Import `@AGENTS.md` (D3); Tests blockieren Drift.

## Zweck und Grenzen

- Dieses Harness gilt ausschließlich für das echte Git-Repository, in dessen
  Wurzel es installiert ist. Es enthält keinen fest eingebauten Projekt-,
  Workspace-, Sitzungs- oder Rollennamen.
- Ohne den dafür vorgesehenen, paketgebundenen Git-Intent und die erforderliche
  Owner-Freigabe erfolgt kein Commit oder Push.
- Projektsprache, Owner-Rolle, zusätzliche Schreibwurzeln und Publish-Regeln
  werden je Installation in `docs/harness-instance.md` festgelegt.
- Zugangsdaten, lokale Freigaben und settings.local.json werden nie
  versioniert oder ausgeliefert.
- Installationsspezifische Owner-/Projektwerte leben ausschließlich in
  `docs/harness-instance.md`; der gemeinsame Hostvertrag wird dafür nicht kopiert.

## Arbeitsweise

Produktdateien ändert nur, wer an einen Arbeitsschritt eines Pakets gebunden ist
(Arbeitsagent oder der Orchestrator in seinem eigenen Paket, solange dort kein
Agent läuft). Planen, Pakete anlegen, delegieren, prüfen, Git-Pflege,
Projektwerkzeuge, MCP-Dienste und das Installationsprofil brauchen kein eigenes
Paket.

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

## Endliche Git-Schnittstelle

Rohe mutierende Git-Befehle sind gesperrt. Für jede erlaubte Absicht existiert
genau ein Aufruf über harness-core/git/git-intent.mjs:

- inspect, checkpoint, unstage
- discard-working mit Recovery-Receipt und recover-discard
- revert-checkpoint nur für den letzten exakten eigenen Checkpoint
- integration-checkpoint einmal nach verifizierten parallelen Leaves
- publish nur über den Package-Executor mit dem Owner-OK-Wortlaut
  (`publish --closure-receipt <RECEIPT> --owner-ok "<Wortlaut>"`); Git bindet
  dabei den Publish-Plan an den unveränderten HEAD und schreibt den Wortlaut in
  den Publish-Beleg
- publish für ein Projekt-Repo, das der Owner in `publishProjects` von
  `.claude/mutation-policy.json` eingetragen hat (sein allgemeines OK je Projekt, die
  Datei ändert nur er): `plan-publish --root <REPO>`, dann `publish --root <REPO>
  --receipt <PLAN>` ohne Paketabschluss und ohne Owner-Satz. Gepusht wird immer nur der
  aktuelle Branch nach origin, nur als Fast-Forward, nie mit Überschreiben; ein
  Push, der kein Fast-Forward wäre, endet mit PUBLISH_NOT_FAST_FORWARD (erst holen
  und zusammenführen). Für jedes andere Repo gilt der Weg über den Paketabschluss
- release-stale-lock --root <REPO> entfernt eine verwaiste index.lock des eigenen
  Repos, nur wenn sie 0 Byte groß und älter als 5 Minuten ist; die Sperrmeldung und
  ein an index.lock gescheiterter Aufruf nennen diesen Weg
- proof-note-write und proof-notes-sync schreiben und gleichen die Prüfnotizen
  (Ref keel-proof) ab; sie ruft der Harness selbst auf (ehrliche Grenze: unter
  demselben Windows-Konto kann ein Agent Prüfcode schreiben, der sie ebenfalls
  aufruft, siehe docs/guard-scope.md)

Breite Historienumschreibungen und nicht recoverable Löschungen bleiben
Owner-Entscheidungen. Leaf-Agenten committen nicht mitten in einer parallelen
Welle; der Parent integriert alle verifizierten disjunkten Pfade einmal — der
git-intent checkpoint erzwingt das aus dem Dispatch-Zustand (WAVE_IN_PROGRESS).
Einzige Ausnahme ist das Release des Produkts selbst: im Produkt-Quellbaum
führt scripts/release-standalone.mjs alle Git-Schritte des Releases aus, nur
als Fast-Forward, nur aus sauberen Bäumen und mit dem Owner-OK-Wortlaut in
beiden Release-Commits.

## Claude, Codex und aktive Schutzschichten

Dieselben Wächter gelten für jeden Agenten des Harness und für Bash wie
PowerShell: die eigene Claude-Sitzung, Arbeitsagenten der Claude CLI und Codex.
Der Package-Executor startet Claude-Arbeitsagenten mit den PreToolUse-Wächtern
der Harness-Wurzel als einziger Einstellung (--setting-sources "" --settings)
und Codex-Leaves mit codex exec, denselben Wächtern als Hooks und
--dangerously-bypass-hook-trust; delegierte Codex-Arbeit nutzt gpt-5.6-sol mit
max. Beide sehen ihre Paketsitzung in KEEL_PACKAGE_SESSION. .claude/settings.json
aktiviert weiter das offizielle projektbezogene codex@openai-codex-Plugin; seine
Befehle laufen über ein Node-Skript außerhalb der Installation und sind in
bewachten Sitzungen gesperrt. Eine eigene Codex-Sitzung bekommt die Wächter über
.codex/hooks.json, sobald der Owner sie dort einmal mit /hooks freigibt. Codex-
oder Claude-Erfolg ersetzt nie lokale Evidence.

Einen Befehl an den Owner gibt es nur für die Handlungen, die allein der Owner
darf; die Liste steht in docs/guard-scope.md. Sperrt ein Wächter eine solche
Handlung, die für das Ziel des Owners nötig ist, legt der Agent sie dem Owner
vor: ein Satz, was passiert und warum, „Achtung, du musst diesen Befehl ausführen:“
und genau der Befehl, den die Sperrmeldung selbst mitliefert, als einzeiliger
bash-Block, den die App mit dem Ausführen-Knopf zeigt und in PowerShell
ausführt. Arbeit, die ein Agent erledigen soll (Sichern, Aufräumen, Stilllegen,
Abschließen), landet nie als Befehl beim Owner; die Sperrmeldung nennt dafür den
erlaubten Agentenweg, etwa Sichern über harness-core/git/git-intent.mjs
checkpoint (mit --session für ein gebundenes Leaf, mit --root und --package für
ein geschriebenes, noch nicht gestartetes Paket) und Stilllegen oder
Zusammenführen über harness-core/execution/package-resolve.mjs resolve. Gibt es
keinen erlaubten Weg, meldet der Agent die Sperre unter Offen:. Vom Installer
verwaltete Harness-Dateien (.keel-harness/state.json) ändert keine Sitzung
direkt (write-guard W5); der Weg ist Release plus Harness-Update, das der Agent
nach dem OK des Owners auslöst.

Aktiv verdrahtet sind:

- SessionStart: der Befehlsindex (wo liegt was, was ist erlaubt, wie heißt der Weg;
  aus den Regeln der Wächter erzeugt, unter 6.000 Zeichen), installationsdefinierte
  Rollen, Onboarding (schlägt `/onboarding` vor, solange das Installationsprofil
  `[AUSFUELLEN]` trägt; ohne Paket), Projektkontext und Scope-Verschmutzung; das Produkt liefert
  keine vorgegebenen Sessions aus.
  Läuft das Dashboard nicht, startet dashboard-ensure es (nur in Installationen
  mit Runtime-Archiv; KEEL_DASHBOARD_AUTOSTART=0 schaltet das ab).
- UserPromptSubmit: knappe Antwortform und bereits gebundene Paketidentität.
- PreToolUse: git-intent-guard, endliche shell-mutation-guard-Schnittstelle und
  nicht-Git-danger-guard (diese drei für Bash und PowerShell), write-guard,
  exakte Leaf-paket-gate-Bindung, Sessionpost-Regel und MCP-Schreibgrenze
  (mcp-write-guard; Owner-Erweiterungen, Produkt-Wurzeln und MCP-Allowlist in
  .claude/mutation-policy.json); Zuschnitt: docs/guard-scope.md. Alle Wächter
  eines Werkzeugaufrufs laufen in einem Prozess (.claude/pretool-guards.js, ohne
  Shell gestartet); Codex lädt sie im Hook-Runner.
- Stop: dod-guard sperrt nur beim Fertig-Anspruch (Meldung ohne `Geprueft gegen:`
  und `Offen:`); den vollständigen Unlazy-Gate-/Dispatch-Schutz bekommt ein
  Arbeitsagent, sonst nur die Sitzung, die ihr Paket orchestriert, und nur bei
  Fertig-Anspruch mit offenen Gates; dazu lokaler Backup-Hinweis.
- Statusline: tatsächliches Repo, Branch und Sicherungszustand.

git-guard und commit-pathspec-guard sind keine zweite aktive oder dormante
Route. Der vollständige Ein-/Ausschlussnachweis steht in
docs/active-harness-inventory.md.

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

- Befehlsindex: steht beim Sitzungsstart im Kontext jeder Sitzung (Claude und Codex) und fest im
  Auftrag jedes Arbeitsagenten; ausführlich `node harness-core/guards/command-index.mjs --full`,
  ein Abschnitt mit `--section "<Abschnitt>"`, maschinenlesbar mit `--json`. Jede Sperrmeldung
  nennt den passenden Eintrag („Weg: siehe Befehlsindex, Abschnitt Git -> checkpoint“).
- Paketstatus: node harness-core/execution/package-executor.mjs status ...
- Nächstes Leaf/Fan-out: next|start, dann dispatch (mit `--step-copy` arbeitet jeder Schritt in einer
  eigenen Arbeitskopie; der Rücklauf übernimmt nur die Dateien seines OWNS)
- Rücklauf: return; Integration: integrate --approve-checks
- Gates ohne CHECK: review-manual --gate LEDGER:GATE --evidence evidence/<datei>
  --session <id> (nur Orchestrator; Beleg im Paket, Datum und Sitzung in EVIDENCE)
- Abschluss: close
- Dashboard-Betrieb: npm run dashboard (Mensch) oder node dashboard/serve.mjs [--port <n>]
  (Agent; npm-Skripte nur ohne Bindung an einen Arbeitsschritt) — beide starten denselben einzigen
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
