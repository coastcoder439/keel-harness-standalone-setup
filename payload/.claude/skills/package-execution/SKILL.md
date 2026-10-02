---
name: package-execution
description: Fuehrt ein Unlazy-Arbeitspaket ueber exakte Leaf-Bindungen, Claude- oder Codex-Arbeitsagenten unter den Harness-Waechtern und lokale Reverify aus.
---

# Package execution

Neue Pakete entstehen über `.claude/skills/package-standard/package-standard.mjs create`, das die Planungsbindung über `package-bootstrap begin` öffnet: exakt ein Repo, Paket, Scope und Planer-Session; erlaubt sind nur `OWNER.md`, `PACKAGE.md`, `GATES.md` und unmittelbare `gates/*.md`. Nach erfolgreichem Unlazy-Doctor legt `harness-core/execution/package-bootstrap.mjs plan --harness-root <HARNESS_ROOT> --session <PLANER_SESSION> --json` das Paket als geplant ab und beendet die Bindung; das Bündel sichert `harness-core/git/git-intent.mjs checkpoint --root <REPO> --package <ID> --message "<TEXT>"`. Gestartet wird erst auf den Owner-Startsatz (Zeile `Owner-Start: YYYY-MM-DD "<Owner-Wortlaut>"` im `## Status` des Pakets oder `--run <LAUF_PAKET>`, dessen `## Status` eine `Owner-Go:`-Zeile trägt und das Paket nennt), mit `start` ohne `--bootstrap-session`.

Nutze anschließend ausschließlich `harness-core/execution/package-executor.mjs`. Jeder
Aufruf hat den gemeinsamen Präfix
`node <HARNESS_ROOT>/harness-core/execution/package-executor.mjs <COMMAND> --harness-root <HARNESS_ROOT> --root <REPO> --package <ID> --scope <SCOPE>`.

Jeder Aufruf nennt `--harness-root <HARNESS_ROOT>` und `--root <ECHTES_GIT_REPO>` getrennt. So bleibt eine Session auch bei verschachtelten Projekt-Repos eindeutig auffindbar, ohne Pakete zu erraten oder zu scannen.

- `OWNER.md` ist der unveränderliche Originalauftrag. Das davon abgeleitete Goal und der Plan dürfen ihn nicht ersetzen.
- Vor Arbeit stehen Depth Tree, disjunkte `OWNS`, Claim und Session-Bindung.
- `start --session <SESSION> --leaf <LEAF> [--provider codex|claude] [--model <ID>]
  [--effort low|medium|high] [--run <LAUF_PAKET>] --json` bindet ein Leaf; ohne
  Anbieter gelten die `MODEL`-Zeile oder die Einstellung Paket-Ausführung; `dispatch --wave <WAVE> --session <SESSION> [--session <SESSION> ...]
  --deadline-seconds <S> --json` startet die begrenzte native Welle. Der Executor
  gewinnt Run-ID und Handle ausschließlich aus dem Provider-Lauf; nie `--member`
  oder einen erfundenen Handle angeben.
- Jeder Arbeitsagent läuft unter den Wächtern der Harness-Wurzel: Claude als
  `claude -p` mit genau diesen PreToolUse-Wächtern als einziger Einstellung, Codex
  als `codex exec --dangerously-bypass-hook-trust` mit denselben Wächtern als Hooks,
  `gpt-5.6-sol` und `max`. Beide sehen ihre Paketsitzung in `KEEL_PACKAGE_SESSION`.
  `delegation.pluginCommand` nennt den exakten Aufruf, `dispatch` führt ihn aus.
  Claude- und Codex-Ausgabe bleibt Nicht-Evidence.
- Modell und Stufe je Leaf oder Paket: `MODEL: claude <modell> <stufe>` im Kopf eines
  Leaf-Ledgers vor dem ersten Gate oder in `GATES.md` (Codex nur `MODEL: codex`, sein
  fester Pin). Vorrang: Aufruf (`--provider`/`--model`/`--effort`) vor Leaf vor Paket vor
  Einstellung vor Voreinstellung. Die Stufe steht als `--effort` in
  `delegation.pluginCommand`. Dashboard-Pakete laufen nie auf Codex (`PROVIDER_LOCKED`).
- Zustand und Recovery sind explizit: `heartbeat|liveness --session <SESSION>`,
  `abort|timeout --session <SESSION> --reason "<TEXT>"`, `abandon --wave <WAVE>
  --reason "<TEXT>"`, `retry --session <SESSION>`, `reassign --session <ALT>
  --new-session <NEU> [--provider claude|codex]` und `recover --wave <ABGEBROCHEN>
  --replacement-wave <VOLLSTÄNDIG>`.
- Neue Sitzungskennung oder geänderter Leaf-Vertrag: `rebind --session <SESSION>
  --reason "<TEXT>"` erneuert eine vorbereitete Bindung nach einer Vertragsänderung;
  `rebind --session <ALT> --new-session <NEU> --reason "<TEXT>"` oder `rebind --leaf
  leaf-<ID> --new-session <NEU> --reason "<TEXT>"` überträgt sie, ohne eine Datei
  anzufassen. Eine gestartete Sitzung geht über `abort`, danach `retry` oder `reassign`.
- Verwaiste Laufzeit-Reste: `cleanup-runtime --root <DIR> [--harness-root <DIR>]
  [--unlazy-root <DIR>] [--apply] [--json]`, ohne `--package`, `--scope` und
  `--session`; ohne `--apply` nur Vorschau, mit `--apply` werden Leases frei und Scopes
  unverändert nach `.unlazy/.retired` verschoben, `docs/packages` bleibt unberührt.
- Bestehende Pakete: überholte oder doppelte Pakete prüft und löst
  `harness-core/execution/package-resolve.mjs resolve --harness-root <HARNESS_ROOT> --root <REPO>
  --package <QUELLE> [--merge-into <ZIEL> | --update <ZIEL> [--step <N> ...] | --withdraw
  --reason "<TEXT>"] [--apply --owner-ok "<WORTLAUT>"] [--unlazy-root <DIR>] [--json]`
  (zusammenführen, das bestehende aktualisieren oder mit Begründung stilllegen). Ohne
  `--apply` ist jeder Aufruf eine Vorschau, die nichts schreibt; zurück mit
  `package-resolve.mjs resolve-undo --harness-root <HARNESS_ROOT> --root <REPO> --receipt <BELEG>`.
  Kein Owner-Wortlaut geht dabei verloren. Ein aktiviertes Paket aktualisiert
  `harness-core/execution/package-amend.mjs` (`begin --harness-root <HARNESS_ROOT> --root <REPO>
  --package <ID> --scope <ID> --session <SESSION>`, danach `finish --harness-root
  <HARNESS_ROOT> --session <SESSION>`, zurück mit `undo --harness-root <HARNESS_ROOT> --root
  <REPO> --receipt <BELEG>`) für Status, Plan und Leaves; `OWNER.md` bleibt unverändert.
  Blockiert ein aktives Paket beim Start ein neues, nennt die Überschneidungsmeldung das
  blockierende Paket und je eine `NEXT`-Zeile mit der `package-resolve.mjs`-Vorschau.
- Ein Rücklauf benutzt `return --session <SESSION> --json`; `resume --session
  <SESSION> --json` liest ausschließlich den dauerhaft gebundenen Lauf.
- Provider-Ausgabe ist nie Evidence. Nur lokale Gate-Reverify darf ein Leaf zurückgeben; `integrate --approve-checks` prüft zuerst Node und Root bottom-up, leitet daraus die Planhaken ab und erzeugt danach genau einen gemeinsamen Checkpoint. Ein erneuter `integrate` führt dieselbe Reverify erneut aus und liefert denselben Checkpoint statt eines zweiten -- er ist idempotent, aber nicht billig. `close` reverifiziert erneut.
- Gates ohne CHECK hakt nur der Orchestrator ab, mit
  `review-manual --gate <LEDGER:GATE> --evidence evidence/<DATEI> --session <ORCHESTRATOR_SESSION> --json`:
  der Beleg liegt unter `evidence/` des Pakets, die EVIDENCE-Zeile traegt Datum, Sitzung,
  Belegpfad und Pruefsumme. Ein Leaf-Gate nach dem Anbieter-Ruecklauf und vor `return`,
  Knoten- und Wurzel-Gates erst, wenn jedes Leaf-Gate erfuellt ist, nichts mehr nach
  `integrate`. Leaf-Arbeiter, Leaf-Sitzungen und Gates mit CHECK weist der Befehl ab; die
  Gate-Dateien bleiben fuer eigene Schreibzugriffe jeder Sitzung gesperrt.
- Git-Mutationen laufen ausschließlich über `harness-core/git/git-intent.mjs`.
- Leaf-Agenten committen nicht mitten in einer parallelen Welle (der git-intent checkpoint verweigert WAVE_IN_PROGRESS, solange die Welle offen oder versiegelt ist). Sichere Rücknahme nutzt ausschließlich die Receipt-basierten Git-Intents.
- Follow-up-Duties sind strukturiert: erst `duty-assess --gate <LEDGER:GATE>`;
  bekannte Arbeit mit `duty-add --duty <ID> --owner "<OWNER>" --trigger
  "<TRIGGER>" --due-state open|due --gate <LEDGER:GATE>` und später
  `duty-resolve --duty <ID> [--gate <LEDGER:GATE>]`. Unbekannte oder offene Duties
  blockieren Close. Ein Waiver ist ein Schritt: der Owner sagt im Chat OK, dann
  `duty-waive --duty <ID> --owner-ok "<WORTLAUT>"`.
- Folgenreiche Transitionen belegt genau eine Zeile, ueberall gleich geformt
  (`owner-ok.mjs`): `Owner-OK: <close|publish|waive-duty:<ID>> <YYYY-MM-DD> <40-stelliger
  Commit-SHA> "<Wortlaut>"`. Der Commit muss beim Verbrauch dem aktuellen `HEAD`
  entsprechen (`OWNER_OK_STALE`), es gibt keine Ablaufzeit, keine Freigabedatei und
  keine Challenge.
- Close läuft in einem Schritt: der Owner sagt im Chat OK, dann
  `close --owner-ok "<WORTLAUT>" --message "<TEXT>" --json`. Der Schalter schreibt die
  `close`-Zeile in den Abschnitt `## Abschluss` der PACKAGE.md, wo sie mit dem
  Schluss-Commit versioniert wird; steht dort schon eine Zeile fuer diesen `HEAD`, bleibt
  sie (ein abgebrochener Abschluss wird einfach wiederholt), eine veraltete ersetzt der
  Schalter durch das neue OK; fehlt die Zeile ohne Schalter, ist es `OWNER_OK_MISSING`,
  nennt sie einen anderen Commit `OWNER_OK_STALE`, gibt es zwei `OWNER_OK_AMBIGUOUS`.
  Nur der Abschnitt `## Abschluss` zaehlt; ein Zitat der Zeile im Status ist keine
  Freigabe. Die Agentenroute akzeptiert keinen Boolean.
- Steht `HEAD` unveraendert auf dem Integrations-Checkpoint und ist der Arbeitsbaum bis
  auf die Owner-OK-Zeile unveraendert, uebernimmt `close` diese Reverify und prueft die
  Gates nur lesend (`reverified: false`, `reusedIntegration: <SHA>`; die geschlossene
  PACKAGE.md sagt das im Abschluss); sonst laeuft die volle Reverify. `--reverify`
  erzwingt sie immer. Commits nach dem Integrations-Checkpoint sperren den Abschluss nur,
  wenn sie nicht von `origin/main` erreichbar sind (`INTEGRATION_REQUIRED`); gepushte
  Commits sind erlaubt, der Abschluss prueft dann voll nach und bindet `HEAD`.
- Nach Close, ohne Bearbeitung des geschlossenen Pakets:
  `publish --closure-receipt <RECEIPT> --owner-ok "<WORTLAUT>" --json`; die Zeile lebt im
  Publish-Beleg, nicht in der PACKAGE.md.
  `recover-close --receipt <CLOSE_RECEIPT>` setzt einen unterbrochenen
  Closure-Checkpoint fort und reverifiziert davor bottom-up wie `close` selbst:
  der Lauf führt alle CHECKs des Bundles aus und schreibt dabei Evidence, ist
  also kein billiger Wiederanlauf. `--timeout S` ist bei `integrate`, `close` und
  `recover-close` das Budget je CHECK; die Wanduhr deckt alle CHECKs der adressierten
  Ledger ab. Close- und Publish-Receipts sind unveränderlich.
