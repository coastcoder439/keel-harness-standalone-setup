# Completeness contract

„Fertig“ bedeutet im Keel Harness nicht, dass ein Plan vollständig
abgehakt ist. Fertig ist ein Paket erst, wenn sein unveränderlicher
Originalauftrag gegen aktuelle, lokal erzeugte Evidence erfüllt ist.

## Acht unabhängige Fragen

1. **Akteure:** Hat jeder Mensch, Driver, Leaf-Agent und Prüfer einen erlaubten
   Weg und einen definierten Blockierfall?
2. **Lebenszyklus:** Sind Erfassen, Zuordnen, Vertrag, Arbeit, Coverage,
   Fulfillment und Abschluss jeweils genau einem Mechanismus zugeordnet?
3. **Governance:** Ist für jede aktive Fähigkeit geklärt, wer sie auslöst, wo
   ihr Zustand lebt, was sie blockiert und welcher Test sie belegt?
4. **Originalauftrag:** Ist jede Owner-Anforderung einem Contract und genau
   einem Gate zugeordnet, ohne dass PIG oder Plan das Endziel verkleinern?
5. **Belege:** Beruht jede positive Aussage auf einem aktuellen lokalen Check,
   nicht auf Provider-Text, Sternen, Erinnerung oder früheren Testergebnissen?
6. **Fehlerfälle:** Sind falsches Repo, falsches Leaf, Ownership-Überlappung,
   stale Evidence, Timeout, Crash, Abbruch, Legacy-Zweitwahrheit und
   Installationskonflikt als erwartete Blocks geprüft?
7. **Folgepflichten:** Sind Migration, Rücknahme, Integration, Publish-Freigabe,
   Recovery und spätere Aktualisierung dort verankert, wo sie entstehen?
8. **Widerspruchsfreiheit:** Besitzen Paket, Status, Regeln, Dashboard und
   Auslieferung dieselbe kanonische Wahrheit ohne redundante Anweisung?

## Ausführbare Gegenprobe

Der unabhängige Abgleich läuft in drei Ebenen:

- `checks/requirements-audit.mjs` prüft jede Anforderung aus `OWNER.md` gegen
  Contract, Implementierung und Test-Evidence.
- `checks/integration-contract.mjs` prüft Contract-Abdeckung, Depth Tree,
  disjunkte `OWNS` und zweite Statuswahrheiten.
- `checks/test-matrix.mjs` führt Windows-, Multi-Repo-, Worktree-, Parallel-,
  Crash-, Timeout-, Stale-State-, Dashboard-, Unlazy-, Standalone- und echte
  Codex-Gegenproben begrenzt aus.

`checks/run-all.mjs` ist der einzige Gesamtbefehl. Er gibt
`HARNESS_REFERENCE_OK` nur aus, wenn alle drei Ebenen und die isolierte
Repo-Grenze grün sind. Ein einzelnes grünes Gate beweist ausschließlich das,
was sein `CHECK` tatsächlich misst.
