---
name: "source-command-repo-status"
description: "Repo-Status -- lokales Git vs GitHub vs Sync fuer Harness + work/-Projekte + Fork"
---

# source-command-repo-status

Use this skill when the user asks to run the migrated source command `repo-status`.

## Command Template

Fuehre `node .claude/repo-status.js` im Workspace-Root aus und gib die KOMPLETTE Ausgabe wieder.
Erklaere kurz: Lokales Git = .git auf der Platte; GitHub-Repo = wohin gepusht wird; Sync = ob lokal == GitHub.
Hebe hervor: "NICHT synchron", "KEIN GitHub-Remote", viele Ungesicherte -- das sind die Backup-Luecken.
