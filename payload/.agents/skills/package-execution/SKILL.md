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
- Git-Mutationen laufen ausschließlich über `harness-core/git/git-intent.mjs`.
- Leaf-Agenten committen nicht mitten in einer parallelen Welle (der git-intent checkpoint verweigert WAVE_IN_PROGRESS, solange die Welle offen oder versiegelt ist). Sichere Rücknahme nutzt ausschließlich die Receipt-basierten Git-Intents.
- Follow-up-Duties sind strukturiert: erst `duty-assess --gate <LEDGER:GATE>`;
  bekannte Arbeit mit `duty-add --duty <ID> --owner "<OWNER>" --trigger
  "<TRIGGER>" --due-state open|due --gate <LEDGER:GATE>` und später
  `duty-resolve --duty <ID> [--gate <LEDGER:GATE>]`. Unbekannte oder offene Duties
  blockieren Close. Waiver läuft zweistufig über `plan-duty-waiver --duty <ID>` und
  `duty-waive --duty <ID> --challenge <RECEIPT> --approval-file <EXTERN>`.
- Close läuft ausschließlich `plan-close --json`, danach erstellt der Owner außerhalb
  des Repos ein kurzlebiges, challenge-gebundenes Freigabe-Artefakt, danach
  `close --challenge <RECEIPT> --approval-file <EXTERN> --message "<TEXT>" --json`.
  Die Agentenroute darf dieses Artefakt nicht erstellen und akzeptiert keinen Boolean.
  Die Schranke ist eine Prozess-Kontrolle desselben OS-Benutzers, gehaertet durch
  Datei-ACLs -- keine Kryptografie und kein Identitaetsnachweis (owner-approval.mjs).
- Nach Close: `plan-publish --closure-receipt <RECEIPT> --json`, neue separate
  Owner-Freigabe und `publish --challenge <RECEIPT> --approval-file <EXTERN> --json`.
  `recover-close --receipt <CLOSE_RECEIPT>` setzt einen unterbrochenen
  Closure-Checkpoint fort und reverifiziert davor bottom-up wie `close` selbst:
  der Lauf führt alle CHECKs des Bundles aus und schreibt dabei Evidence, ist
  also kein billiger Wiederanlauf. `--timeout S` ist bei `integrate`,
  `plan-close`, `close` und `recover-close` das Budget je CHECK; die Wanduhr
  deckt alle CHECKs der adressierten Ledger ab. Close- und Publish-Receipts sind
  unveränderlich und verbrauchen ihre Nonce genau einmal.
