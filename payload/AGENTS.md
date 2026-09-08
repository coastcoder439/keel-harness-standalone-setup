# Keel Harness

> Gemeinsamer dauerhafter Vertrag für Claude Code und Codex. AGENTS.md und
> CLAUDE.md sind absichtlich bytegleich; Tests blockieren Drift.

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

Provider-Rücklauf ist keine Evidence. Der Parent reverifiziert jedes Leaf lokal.
Nach allen Returns führt integrate mit expliziter Check-Ausführungsfreigabe
Node- und Root-Gates bottom-up aus, leitet erst aus grüner Evidence die
Planhaken ab und erzeugt danach genau einen Integrations-Checkpoint; ein
erneuter Aufruf führt dieselbe Reverify erneut aus und liefert denselben
Checkpoint statt eines zweiten. close läuft in einem Schritt: der Owner sagt im
Chat OK, `close --owner-ok "<Wortlaut>"` schreibt die Owner-OK-Zeile in den
Abschnitt Abschluss der PACKAGE.md, prüft die Gates (oder übernimmt die
Integrations-Reverify, wenn HEAD der Integrations-Checkpoint ist und der
Arbeitsbaum bis auf diese Zeile unverändert blieb; --reverify erzwingt den
vollen Lauf) und schreibt den Closure-Commit. recover-close reverifiziert vor
seinem Closure-Checkpoint bottom-up; ist dieser Commit bereits geschrieben,
kehrt der Aufruf unverändert und ohne erneute Reverify zurück. Bleibt die
Reverify der Recovery rot, entsteht kein Closure-Commit; der Ausweg ist ein
erneutes close mit dem neuen OK des Owners. --timeout ist dabei das Budget je
CHECK, nicht für den ganzen Lauf.
Geschlossen wird nur bei vollständiger Coverage und Fulfillment.

## Sieben Schritte, je eine verantwortliche Schnittstelle

1. **Erfassen** — OWNER.md plus daraus abgeleitetes PIG; Package-Schema.
2. **Zuordnen** — realer Git-Root, Paket und Scope; Resolver + Activation.
3. **DoD/Contract** — Depth Tree, R→C→Gate, OWNS; Package-Schema.
4. **Arbeiten** — Claims, Bindings, Dispatch und Returns; Package-Executor.
5. **Coverage** — vollständige Owner-/Contract-/Gate-Zuordnung; Statusprüfung.
6. **Fulfillment** — lokale Leaf→Node→Root-Evidence; integrate.
7. **Abschluss** — Owner-OK-Zeile, Reverify oder übernommene Integrations-Reverify, Close-Receipt; close.

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

Breite Historienumschreibungen und nicht recoverable Löschungen bleiben
Owner-Entscheidungen. Leaf-Agenten committen nicht mitten in einer parallelen
Welle; der Parent integriert alle verifizierten disjunkten Pfade einmal — der
git-intent checkpoint erzwingt das aus dem Dispatch-Zustand (WAVE_IN_PROGRESS).

## Claude, Codex und aktive Schutzschichten

.claude/settings.json aktiviert das offizielle projektbezogene
codex@openai-codex-Plugin. Delegierte Codex-Arbeit nutzt standardmäßig
gpt-5.6-sol mit max; der Package-Executor erzeugt den exakten
/codex:rescue-Aufruf. Codex- oder Claude-Erfolg ersetzt nie lokale Evidence.

Aktiv verdrahtet sind:

- SessionStart: installationsdefinierte Rollen, Onboarding, Projektkontext und
  Scope-Verschmutzung; das Produkt liefert keine vorgegebenen Sessions aus.
- UserPromptSubmit: knappe Antwortform und bereits gebundene Paketidentität.
- PreToolUse: git-intent-guard, endliche shell-mutation-guard-Schnittstelle,
  nicht-Git-danger-guard, write-guard, exakte Leaf-paket-gate-Bindung,
  Sessionpost-Regel und MCP-Schreibgrenze (mcp-write-guard; Owner-Erweiterungen
  und MCP-Allowlist in .claude/mutation-policy.json).
- Stop: vollständiger Unlazy-Gate-/Dispatch-Schutz, Berichtsformat durch
  dod-guard und lokaler Backup-Hinweis.
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
Offen:; das ist nur Berichtsformat. Fertig bedeutet: bounded Gesamtlauf,
Upstream-Unlazy-Regressionsschutz, Unit/Integration/E2E, Windows/Multi-Repo/
Worktree/Crash/Timeout/Stale-State, Dashboard, Standalone-Frischinstallation
und unabhängiger Abgleich jeder Owner-Anforderung sind grün. Erst danach darf
ein ausdrücklich freigegebener Publish erfolgen.

## Bedienung

- Paketstatus: node harness-core/execution/package-executor.mjs status ...
- Nächstes Leaf/Fan-out: next|start, dann dispatch
- Rücklauf: return; Integration: integrate --approve-checks
- Abschluss: close
- Dashboard-Betrieb: npm run dashboard (Mensch) oder node dashboard/serve.mjs [--port <n>]
  (Agent; npm-Skripte sind fuer Agenten gesperrt) — beide starten denselben einzigen
  Startweg; dashboard/serve.mjs
  startet die gebaute Runtime als einen Prozess lokal auf 127.0.0.1; Pruefung:
  npm run test:dashboard:runtime
- Dashboard-Entwicklung (nur Quellbaum): npm run dashboard:dev — setzt
  KEEL_ACCOUNTABILITY_NEXT_DIST_DIR=.next-dev nur fuer seinen Kindprozess und
  bindet 127.0.0.1; ohne die Variable baut next dev in .next und zerstoert den
  standalone-Build; Regeln in dashboard/README.md des Quellbaums
- Harness prüfen: node checks/run-all.mjs
