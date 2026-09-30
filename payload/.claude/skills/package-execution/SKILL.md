---
name: package-execution
description: Fuehrt ein Unlazy-Arbeitspaket ueber exakte Leaf-Bindungen, Claude oder das offizielle Codex-Plugin und lokale Reverify aus.
---

# Package execution

Neue Pakete beginnen mit `harness-core/execution/package-bootstrap.mjs begin`: exakt ein Repo, Paket, Scope und Planer-Session; erlaubt sind nur `OWNER.md`, `PACKAGE.md`, `GATES.md` und unmittelbare `gates/*.md`. Nach erfolgreichem Unlazy-Doctor beendet der erste `package-executor start --bootstrap-session <PLANER_SESSION>` diese enge Planungsbindung.

Nutze anschließend ausschließlich `harness-core/execution/package-executor.mjs`. Jeder
Aufruf hat den gemeinsamen Präfix
`node <HARNESS_ROOT>/harness-core/execution/package-executor.mjs <COMMAND> --harness-root <HARNESS_ROOT> --root <REPO> --package <ID> --scope <SCOPE>`.

Jeder Aufruf nennt `--harness-root <HARNESS_ROOT>` und `--root <ECHTES_GIT_REPO>` getrennt. So bleibt eine Session auch bei verschachtelten Projekt-Repos eindeutig auffindbar, ohne Pakete zu erraten oder zu scannen.

- `OWNER.md` ist der unveränderliche Originalauftrag. Das davon abgeleitete Goal und der Plan dürfen ihn nicht ersetzen.
- Vor Arbeit stehen Depth Tree, disjunkte `OWNS`, Claim und Session-Bindung.
- `start --session <SESSION> --leaf <LEAF> --provider claude|codex --json` bindet
  ein Leaf; `dispatch --wave <WAVE> --session <SESSION> [--session <SESSION> ...]
  --deadline-seconds <S> --json` startet die begrenzte native Welle. Der Executor
  gewinnt Run-ID und Handle ausschließlich aus dem Provider-Lauf; nie `--member`
  oder einen erfundenen Handle angeben.
- Codex läuft ausschließlich Claude -> offizielles Projekt-Plugin
  `codex@openai-codex` -> `/codex:rescue --wait --fresh --model gpt-5.6-sol
  --effort max`. Claude- und Codex-Ausgabe bleibt Nicht-Evidence.
- Zustand und Recovery sind explizit: `heartbeat|liveness --session <SESSION>`,
  `abort|timeout --session <SESSION> --reason "<TEXT>"`, `abandon --wave <WAVE>
  --reason "<TEXT>"`, `retry --session <SESSION>`, `reassign --session <ALT>
  --new-session <NEU> [--provider claude|codex]` und `recover --wave <ABGEBROCHEN>
  --replacement-wave <VOLLSTÄNDIG>`.
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
