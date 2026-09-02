---
description: Integriert alle lokal verifizierten Leaves genau einmal und prueft Gates bottom-up.
---

1. Pruefe mit `package-executor status`, dass alle vorbereiteten Waves versiegelt, alle
   Handles registriert und alle Leaves lokal erfolgreich re-verifiziert sind.
2. Fuehre exakt
   `node harness-core/execution/package-executor.mjs integrate --harness-root <HARNESS_ROOT> --root <REPO> --package <ID> --scope <ID> --message "<TEXT>" --approve-checks --json`
   aus. `--approve-checks` ist die ausdrueckliche Erlaubnis, nur die im Ledger sichtbaren
   pending CHECK-Orakel jetzt auszufuehren; manuelle Gates bleiben Owner-Gates.
3. Der Executor erstellt hoechstens einen gemeinsamen Integrations-Checkpoint, prueft
   Leaf -> Branch -> Root bottom-up und leitet Plan-Haken ausschliesslich aus Evidence ab.
4. Scheitert ein Gate, bleibt das Paket offen. Probiere keinen anderen Git-Befehl und
   hake nichts im Chat ab.
