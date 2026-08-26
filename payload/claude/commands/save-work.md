---
description: Sichert die ungesicherte Arbeit DIESES Kontexts -- commit + push ins richtige Repo, mit Ansage
---
1. Ziel-Repo ermitteln (aus dem Gespraech; wenn unklar: `node .claude/repo-status.js` zeigen + fragen. NIE raten).
   Moegliche Ziele: die **Werkbank** selbst (cwd) -- oder ein **Projekt-Repo unter
   `user-projects/`**. Die liegen auch ZWEI Ebenen tief (`user-projects/<projekt>/<feature>`),
   (ein Produkt-Fork oder ein Feature-Repo ist typischerweise eines davon).
   `repo-status.js` sucht rekursiv und listet sie alle -- die Liste von dort nehmen,
   keine Pfade aus dem Kopf.
2. `git -C "<repo>" status --porcelain` -- ungesicherte Aenderungen? Wenn nein: fertig.
3. Halbfertig-Check: wenn der Stand kaputt/mittendrin ist, hinweisen und fragen statt blind committen.
4. Committen + pushen NUR im Ziel-Repo via `git -C "<repo>"`, mit aussagekraeftiger
   Message. **Form je Ziel** [Fix 27.08.2026: hier stand `add -A`, was der
   `commit-pathspec-guard` im Werkbank-Repo mit exit 2 blockt -- der Befehl fuehrte in
   die eigene Blockade]: Werkbank = `git commit -m "…" -- <pfad>` (neue Datei vorher
   gezielt `git add <datei>`); verschachteltes Projekt-Repo = `add -A` erlaubt, dort
   arbeitet je eine Sitzung allein.
   NIEMALS ins falsche Repo committen (Plugin-Arbeit darf nicht im Harness-Repo landen und umgekehrt).
5. Ansage (VERBINDLICH) vor dem Push: "-> committe + push nach <account>/<repo>".
6. Danach bestaetigen: Repo, Anzahl Dateien, gepusht ja/nein -- und die zwei
   Abschlusszeilen anhaengen, sonst blockt `dod-guard` den Turn, den dieser Befehl erzeugt.
