---
name: package-execution
description: Fuehrt ein Unlazy-Arbeitspaket ueber exakte Leaf-Bindungen, Claude- oder Codex-Arbeitsagenten unter den Harness-Waechtern und lokale Reverify aus.
---

# Package execution

Neue Pakete entstehen über `.claude/skills/package-standard/package-standard.mjs create`, das die Planungsbindung über `package-bootstrap begin` öffnet: exakt ein Repo, Paket, Scope und Planer-Session; erlaubt sind nur `OWNER.md`, `PACKAGE.md`, `GATES.md` und unmittelbare `gates/*.md`. Nach erfolgreichem Unlazy-Doctor und, sobald die Startnachricht des Owners vorliegt, nach der Zeile `Owner-Start:` im `## Status` der PACKAGE.md (nach `plan` ist sie nicht mehr beschreibbar, `next` endete sonst in `OWNER_START_MISSING`) legt `harness-core/execution/package-bootstrap.mjs plan --harness-root <HARNESS_ROOT> --session <PLANER_SESSION> --json` das Paket als geplant ab und beendet die Bindung; das Bündel sichert `harness-core/git/git-intent.mjs checkpoint --root <REPO> --package <ID> --message "<TEXT>"`. Gestartet wird erst auf den Startwunsch des Owners, den du aus dem Gespräch liest und als wörtliches Zitat ablegst, nie als erfragte Satzform (Zeile `Owner-Start: YYYY-MM-DD "<Owner-Wortlaut>"` im `## Status` des Pakets oder `--run <LAUF_PAKET>`, dessen `## Status` eine `Owner-Go:`-Zeile trägt und das Paket nennt; ein langes, mehrzeiliges oder Anführungszeichen enthaltendes Zitat steht als Block: die Zeile ohne Wortlaut, darunter jede Zitatzeile mit vier Leerzeichen und `>` davor), mit `start` ohne `--bootstrap-session`.

Zuschnitt: Arbeitsschritte (Leaves) werden nach zusammenhängenden Dateien geschnitten, nicht nach Bereichen: ein Leaf sind die Dateien, die zusammen geändert und geprüft werden (eine Komponente samt Test), nie „Frontend“ oder „Backend“. Vier Agenten je Bereich kosteten 11 Wellen, eine fehlende Kennung (`data-testid`) allein vier. Eine Kleinständerung (eine Kennung, ein Text) ist ein Schritt oder geht den leichten Weg: der Orchestrator schreibt `evidence/` und `design/` seines Pakets selbst, Prüfungen und Vertrag bleiben gesperrt. Ein Schritt mit einer Anforderung ist ein vollständiges Paket; der Titel (Paketname) kommt aus Wörtern des Owner-Auftrags oder ist ein vom Owner genannter Name, sonst warnt `package-standard.mjs create`.

Nutze anschließend ausschließlich `harness-core/execution/package-executor.mjs`. Jeder
Aufruf hat den gemeinsamen Präfix
`node <HARNESS_ROOT>/harness-core/execution/package-executor.mjs <COMMAND> --harness-root <HARNESS_ROOT> --root <REPO> --package <ID> --scope <SCOPE>`.

Jeder Aufruf nennt `--harness-root <HARNESS_ROOT>` und `--root <ECHTES_GIT_REPO>` getrennt. So bleibt eine Session auch bei verschachtelten Projekt-Repos eindeutig auffindbar, ohne Pakete zu erraten oder zu scannen.

- `OWNER.md` ist der unveränderliche Originalauftrag. Das davon abgeleitete Goal und der Plan dürfen ihn nicht ersetzen.
- Vor Arbeit stehen Depth Tree, disjunkte `OWNS`, Claim und Session-Bindung.
- `start --session <SESSION> --leaf <LEAF> [--provider codex|claude] [--model <ID>]
  [--effort low|medium|high] [--run <LAUF_PAKET>] --json` bindet ein Leaf; ohne
  Anbieter gelten die `MODEL`-Zeile oder die Einstellung Paket-Ausführung; `dispatch --wave <WAVE> --session <SESSION> [--session <SESSION> ...]
  [--cost-budget-usd <N>] [--token-budget <N>] --json` startet die native Welle. Der
  Executor gewinnt Run-ID und Handle ausschließlich aus dem Provider-Lauf; nie `--member`
  oder einen erfundenen Handle angeben.
- Ein Arbeitsagent hat keine Schrittgrenze, keine Zeitgrenze und keine Startzeit;
  `--max-turns <N>` und `--deadline-seconds <S>` gelten nur, wenn der Aufruf sie nennt.
  Angehalten wird ein Lauf in drei Fällen: `hung` (kein Werkzeug läuft und
  `KEEL_SILENCE_MS` lang kein Ereignis, Vorgabe 30 min), `budget-reached` (Kostenrahmen
  aufgebraucht: Claude `--max-budget-usd`, Vorgabe 20 USD, `--cost-budget-usd`; Codex
  Token aus der Rollout-Datei unter `~/.codex/sessions`, die während des Laufs mitgelesen wird,
  und aus `turn.completed`, Vorgabe 2.000.000, `--token-budget`; endet der Prozess nach
  `turn.completed` von selbst mit 0, ist er `provider-returned` mit Hinweis in `hints`, nie
  `budget-reached`) und `repeated-block` (ein PreToolUse-Hook sperrte dieselbe Eingabe
  dreimal hintereinander; nur die echte Hook-Antwort zählt, kein roter Test mit Wächtertext; bei Codex steht die Sperre nur in der Rollout-Datei, nicht in `codex exec --json`, und wird von dort mitgelesen). Lease und Bindung bleiben, der Orchestrator
  entscheidet: `resume --session <SESSION> [--cost-budget-usd <N>] [--message "<TEXT>"]`
  setzt die native Sitzung fort (`claude --resume`, `codex exec resume`), statt neu zu
  starten; `retry`, `reassign`, `restart` und `abort` führen wie bei `provider-failed`
  heraus. Ein Agentenlog über 32 MiB wird mit einer `keel_log_truncated`-Zeile abgeschnitten,
  `logTruncated` steht in `status` und `liveness`.
- Jeder Arbeitsagent läuft unter den Wächtern der Harness-Wurzel: Claude als
  `claude -p` mit genau diesen PreToolUse-Wächtern als einziger Einstellung, Codex
  als `codex exec --dangerously-bypass-hook-trust` mit denselben Wächtern als Hooks,
  `gpt-5.6-sol` und `max`. Beide sehen ihre Paketsitzung in `KEEL_PACKAGE_SESSION`.
  `delegation.pluginCommand` nennt den exakten Aufruf, `dispatch` führt ihn aus.
  Claude- und Codex-Ausgabe bleibt Nicht-Evidence.
- Der Auftrag jedes Arbeitsagenten hat feste Abschnitte, weil er weder Anleitung noch Regeln liest
  (`--setting-sources ""`): den Befehlsindex (erlaubter Weg je Absicht und je Sperrcode, aus den Regeln
  der Wächter erzeugt, `node harness-core/guards/command-index.mjs [--section "<Abschnitt>"|--full|--json]`),
  die Freigaben des Owners aus `.claude/mutation-policy.json` (`mcpWriteTools.allow`, `productRoots`,
  `publishProjects`, nie mehr und nie weniger als in der Datei), die Prüfung von Owner-Aussagen (D8:
  Zustimmung, Widerspruch, Alternative), den Veröffentlichungsweg, die Ausführungsregeln (lange Tests im
  Vordergrund, Build und Test getrennt, nie selbst committen, ein Rücklauf ohne Änderung ist kein Erfolg,
  dieselbe Sperre dreimal heißt Halt) und bei `restart` und `reopen` die Begründung (`--reason`) in einem
  eigenen Abschnitt vor dem Originalauftrag. Jeder neue Auftrag (`retry`, `rebind`) rendert den dann
  gültigen Stand neu; die Begründung bleibt dabei erhalten.
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
  <SESSION> --json` gleicht den dauerhaft gebundenen Lauf ab und setzt nur eine angehaltene
  Sitzung (`hung`, `budget-reached`, `repeated-block`, `returned-unchanged`) fort.
- `dispatch ... --step-copy` gibt jedem Schritt eine eigene Arbeitskopie (`git worktree`, unter
  `.unlazy/<Scope>/executor/step-copies/`, mit den ungesicherten Dateien des gemeinsamen Ordners und
  `node_modules` als Junction). Der Agent schreibt nur dort; der Rücklauf vergleicht exakt (alles, was in der
  Kopie anders ist, schrieb dieser Schritt), übernimmt die Dateien seines OWNS in den gemeinsamen Ordner und
  entfernt die Kopie. Eine Datei außerhalb des OWNS sperrt den Rücklauf (`OUTSIDE_OWNS_CHANGED`, nichts wird
  übernommen); hat der gemeinsame Ordner eine Datei des OWNS inzwischen geändert, meldet er
  `STEP_COPY_CONFLICT` und übernimmt nichts, zurückgedreht wird nie. Ein Prüfbefehl wird für so einen Schritt
  mit `gate-check --approve --root <Kopie>` freigegeben (die Datei liegt erst dort).
- Eine Welle hat beliebig viele Arbeitsschritte. `dispatch` startet sie der Reihe nach, solange
  nach einem weiteren Agenten (pauschal 1 GB) die Untergrenze für freien Arbeitsspeicher bleibt
  (`overrides.freeRamFloorGb` in `runtime/voice/system-profile.json`, 2 bis 4 GB, ohne Wert 4;
  dieselbe Grenze gilt für Stimme und Architekturbilder). Die übrigen stehen als `queued` in der
  Welle und starten bei jedem `return` und jedem `status`, sobald ein Agent endet. Ist gar kein
  Platz und läuft kein Agent der Welle, startet trotzdem einer (`forcedStart`). Die Unlazy-Welle
  wird vor dem Eintrag im Zustand und vor jedem Agentenstart geöffnet; lehnt Unlazy ab, bleibt
  nichts zurück. Scheitert der Start aller Agenten, entfernt der Executor die Unlazy-Welle mit
  `dispatch-check.mjs discard --wave <WELLE> --reason "<TEXT>"` (nur möglich, solange in ihr nie ein
  Schritt gestartet wurde; der Grund steht im Status-Log, es bleibt kein Handoff), die Welle wandert
  mit Grund in die Historie und ihre Schritte sind sofort wieder `prepared`; `dispatch` mit
  derselben Wellenkennung geht sofort wieder. Eine Welle mit gestartetem Schritt lehnt `discard`
  ab: sie wird mit `abandon` aufgegeben und mit `recover` beendet. Sind einige gestartet, stehen
  die anderen als `start-failed` da, `retry` reiht sie wieder ein. Bricht der Dispatch nach dem Öffnen ab, werden `queued`- und
  `start-failed`-Schritte ebenso wieder `prepared`. `abandon` und `abort` schließen eine Welle,
  die Unlazy nicht kennt (unterbrochener Dispatch), nur im Executor-Zustand ab.
- `return` vergleicht den Arbeitsbaum mit dem beim Start abgelegten Stand (nichts wird je
  zurückgedreht). Ein Schritt mit `OWNS`, der keine Datei seines `OWNS` änderte, endet als
  `returned-unchanged` (`RETURNED_UNCHANGED`, kein Erfolg; `restart` mit Begründung, `resume`
  oder `retry` entscheiden); ein reiner Prüfschritt trägt `READ-ONLY: yes` im Kopf seines
  Leaf-Ledgers. Aktiv ist ein Schritt nur, wenn sein Agent im Fenster lief (`starting`,
  `running`, `provider-returned` oder ein Lauf, der das Fenster überschneidet), nicht `prepared`,
  `queued` oder `start-failed`. Im Paket-Bündel ausgenommen sind nur Haken, Status, Abschluss und
  EVIDENCE-Werte in `PACKAGE.md`, `GATES.md` und `gates/*.md`; `OWNER.md` und jede andere Datei
  des Bündels werden abgeglichen. Eine Änderung außerhalb des `OWNS` aller aktiven Schritte sperrt
  den Rücklauf (`OUTSIDE_OWNS_CHANGED` mit Dateiliste); kam sie aus einer anderen Sitzung,
  bestätigt `return --session <SESSION> --accept-outside "<Begründung>"` das, die Begründung
  steht im Zustand. Ein ersetzter Schritt (`reassign`, `restart`, `reopen`) wandert in die
  Historie und zählt nicht mehr als offen.
- Verwaist ist eine Sperre, ein Teil-Integrationsordner, ein Architekturbild- oder Build-Lauf nur,
  wenn ihr Halterprozess (Prozessnummer und Startzeit) tot ist, nie nach einer festen Zeit; eine
  Sperre ohne Prozessnummer (altes Format) gilt nach der bisherigen Zeit als verwaist. Ein Paket
  mit lebendem Halterprozess wird nicht stillgelegt.
- Provider-Ausgabe ist nie Evidence, und der eigene Prüflauf des Agenten auch nicht. Geprüft wird immer an einem
  Commit in einer sauberen Kopie (`gate-check --at`), nie in der Arbeitskopie; ein gespeichertes Ergebnis desselben
  Code-Stands gilt (`PROOF_REUSED`). `return` prüft die Gates des Schritts an einem Commit-Objekt aus `HEAD` plus
  genau den Änderungen in seinem `OWNS` (kein Branch, kein gemeinsamer Index, keine Datei der Arbeitskopie).
  `integrate --approve-checks` baut den Integrations-Commit, ohne den Branch zu bewegen, prüft Leaf, Node und Root
  daran und zieht den Branch nur bei Grün vor; Rot lässt Branch, Index und Arbeitskopie unverändert. Ergebnisse eines
  Rücklaufs gelten weiter, wenn sich am Code-Stand nichts geändert hat (ein einzelner Schritt). Ein erneuter
  `integrate` auf demselben Stand liefert denselben Checkpoint und startet keinen Prüfbefehl (`checksRun: 0`,
  ausser bei Gates, die nicht gespeichert werden: `CACHE: no`, Modell, Netz). `close` prüft `HEAD` ebenso.
- Gates ohne CHECK hakt nur der Orchestrator ab, mit
  `review-manual --gate <LEDGER:GATE> --evidence evidence/<DATEI> --session <ORCHESTRATOR_SESSION> --json`:
  der Beleg liegt unter `evidence/` des Pakets, die EVIDENCE-Zeile traegt Datum, Sitzung,
  Code-Stand (`code=<Stand>@<Commit>`), Belegpfad und Pruefsumme. Der Code-Stand umfasst bei
  einem Leaf-Gate das `OWNS` des Leafs, bei Knoten- und Wurzel-Gates das `OWNS` aller Leaves,
  nie das Bündel selbst; ungesicherte Dateien zählen wie im Integrations-Commit nur, wenn ein
  `OWNS`-Glob sie trifft. `integrate` und `close` lassen die Bestätigung nur gelten, solange
  dieser Stand gleich ist; sonst `MANUAL_GATE_STALE` mit den geänderten Dateien, und
  `review-manual` erneuert sie (auch nach `integrate`). Eine ältere Bestätigung ohne
  Code-Stand gilt, bis sich ihr Bereich nach dem ersten `integrate` ändert. Ein Leaf-Gate nach
  dem Anbieter-Ruecklauf und vor `return`, Knoten- und Wurzel-Gates erst, wenn jedes
  Leaf-Gate erfuellt ist, sonst nichts mehr nach `integrate`. Leaf-Arbeiter, Leaf-Sitzungen und Gates mit CHECK weist der Befehl ab; die
  Gate-Dateien bleiben fuer eigene Schreibzugriffe jeder Sitzung gesperrt.
- Git-Mutationen laufen ausschließlich über `harness-core/git/git-intent.mjs`.
- Leaf-Agenten committen nicht mitten in einer parallelen Welle (der git-intent checkpoint verweigert WAVE_IN_PROGRESS, solange die Welle offen oder versiegelt ist). Sichere Rücknahme nutzt ausschließlich die Receipt-basierten Git-Intents.
- Follow-up-Duties sind strukturiert: erst `duty-assess --gate <LEDGER:GATE>`;
  bekannte Arbeit mit `duty-add --duty <ID> --owner "<OWNER>" --trigger
  "<TRIGGER>" --due-state open|due --gate <LEDGER:GATE>` und später
  `duty-resolve --duty <ID> [--gate <LEDGER:GATE>]`. Unbekannte oder offene Duties
  blockieren Close. Ein Waiver ist ein Schritt: der Owner sagt im Chat OK (du liest es aus dem
  Gespräch), dann `duty-waive --duty <ID> --owner-ok "<WORTLAUT>"`.
- Folgenreiche Transitionen belegt genau ein Eintrag, ueberall gleich geformt
  (`owner-ok.mjs`): `Owner-OK: <close|publish|waive-duty:<ID>> <YYYY-MM-DD> <40-stelliger
  Commit-SHA> "<Wortlaut>"`; passt der Wortlaut nicht in eine Zeile (lang, mehrzeilig,
  Anführungszeichen), steht derselbe Kopf ohne Wortlaut und darunter das Zitat, jede Zeile mit
  vier Leerzeichen und `>` davor. Der Wortlaut ist das wörtliche Zitat der Owner-Nachricht, die du
  aus dem Gespräch als Zustimmung liest: keine Längengrenze, Zeilenumbrüche und Anführungszeichen
  erlaubt, nur nicht leer; nie wird eine Satzform (Paketname, Version, Formel) verlangt oder
  erfragt. Für langen oder mehrzeiligen Text gibt `--owner-ok-file <DATEI>` das Zitat aus einer
  UTF-8-Datei im Temp-Ordner der Sitzung oder im Laufzeitordner `.unlazy`, nie aus einem Git-Arbeitsbaum
  (auch nicht aus einem im Temp-Ordner). Der Commit muss beim
  Verbrauch dem aktuellen `HEAD` entsprechen (`OWNER_OK_STALE`: das Zitat erneut gegen den aktuellen
  Stand ablegen), es gibt keine Ablaufzeit, keine Freigabedatei und keine Challenge.
- Close läuft in einem Schritt: der Owner sagt im Chat OK, dann
  `close --owner-ok "<WORTLAUT>" --message "<TEXT>" --json` (`--message` ohne Längengrenze,
  mehrzeilig erlaubt). Der Schalter schreibt den
  `close`-Eintrag in den Abschnitt `## Abschluss` der PACKAGE.md, wo sie mit dem
  Schluss-Commit versioniert wird; steht dort schon eine Zeile fuer diesen `HEAD`, bleibt
  sie (ein abgebrochener Abschluss wird einfach wiederholt), eine veraltete ersetzt der
  Schalter durch das neue OK; fehlt die Zeile ohne Schalter, ist es `OWNER_OK_MISSING`,
  nennt sie einen anderen Commit `OWNER_OK_STALE`, gibt es zwei `OWNER_OK_AMBIGUOUS`.
  Nur der Abschnitt `## Abschluss` zaehlt; ein Zitat der Zeile im Status ist keine
  Freigabe. Die Agentenroute akzeptiert keinen Boolean.
- `close` prüft das Ergebnis, nicht den Weg: Hat nie ein Arbeitsagent für das Paket gelaufen (die Sitzung baute selbst, die Leaf-Sitzungen stehen auf `prepared`), braucht es keine Integration; `close` beweist die Gates an `HEAD`, leitet daraus die Plan-Haken ab und schließt mit dem Owner-OK-Zitat. Ungesicherter Code zählt nicht, ein unbewiesenes Gate sperrt, eine laufende Ausführung sperrt weiter (`OPEN_EXECUTION`).
- `close` prüft jedes Gate an `HEAD` in einer sauberen Kopie (`checkedAt: <SHA>`); die
  Ergebnisse der Integration gelten für denselben Code-Stand, sonst läuft das Gate dort neu.
  Fremde ungesicherte Dateien anderer Sitzungen spielen keine Rolle, ein sauberes Repo ist
  nicht nötig. `--reverify` wird angenommen und ändert nichts. Commits nach dem Integrations-Checkpoint sperren den Abschluss nur,
  wenn sie nicht von `origin/main` erreichbar sind (`INTEGRATION_REQUIRED`); gepushte
  Commits sind erlaubt, der Abschluss prueft dann voll nach und bindet `HEAD`.
- Nach Close, ohne Bearbeitung des geschlossenen Pakets:
  `publish --closure-receipt <RECEIPT> --owner-ok "<WORTLAUT>" --json`; der Eintrag lebt im
  Publish-Beleg, nicht in der PACKAGE.md.
  `recover-close --receipt <CLOSE_RECEIPT>` setzt einen unterbrochenen
  Closure-Checkpoint fort und prüft davor `HEAD` wie `close` selbst (gespeicherte
  Ergebnisse desselben Code-Stands gelten). `--timeout S` wird bei `integrate`, `close` und
  `recover-close` angenommen und ignoriert (gate-check kennt keine Zeit je CHECK mehr); der Executor selbst setzt keine Wanduhr: ein
  Kindprozess endet nur bei einem Hänger (`KEEL_SILENCE_MS` lang keine Ausgabe und ein
  ruhender Prozessbaum, `CHILD_HUNG`). Close- und Publish-Receipts sind unveränderlich.
