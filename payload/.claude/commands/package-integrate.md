---
description: Integriert alle lokal verifizierten Leaves genau einmal und prueft Gates bottom-up.
---

1. Pruefe mit `package-executor status`, dass alle vorbereiteten Waves versiegelt, alle
   Handles registriert und alle Leaves lokal erfolgreich re-verifiziert sind.
2. Fuehre exakt
   `node harness-core/execution/package-executor.mjs integrate --harness-root <HARNESS_ROOT> --root <REPO> --package <ID> --scope <ID> --message "<TEXT>" --approve-checks --json`
   aus. `--approve-checks` ist die ausdrueckliche Erlaubnis, nur die im Ledger sichtbaren
   pending CHECK-Orakel jetzt auszufuehren; manuelle Gates bleiben Owner-Gates.
3. Der Executor baut den Integrations-Commit, ohne den Branch zu bewegen, prueft daran
   Leaf -> Branch -> Root in einer sauberen Kopie (`gate-check --at`), leitet Plan-Haken
   ausschliesslich aus Evidence ab und zieht den Branch nur bei Gruen vor (hoechstens ein
   gemeinsamer Integrations-Checkpoint). Rot laesst Branch, Index und Arbeitskopie
   unveraendert. Ein zweiter Aufruf auf demselben Stand liefert denselben Checkpoint und
   startet keinen Pruefbefehl (gespeicherte Ergebnisse, `checksRun: 0`). `--timeout S` wird angenommen und
   ignoriert (gate-check kennt keine Zeit je CHECK mehr); der Executor setzt keine Wanduhr, ein Kindprozess endet nur bei einem Hänger
   (CHILD_HUNG).
4. Scheitert ein Gate, bleibt das Paket offen. Probiere keinen anderen Git-Befehl und
   hake nichts im Chat ab.
