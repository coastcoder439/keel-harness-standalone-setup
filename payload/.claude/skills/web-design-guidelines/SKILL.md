---
name: web-design-guidelines
description: Review UI code for Web Interface Guidelines compliance (accessibility, focus, forms, animation, layout — ~120 rules). Use when asked to "review my UI", "check accessibility", "audit design", "review UX", or as the audit pass in a UI work package.
metadata:
  author: vercel
  version: "1.0.0-keel"
  argument-hint: <file-or-pattern>
---

# Web Interface Guidelines

Review files for compliance with Web Interface Guidelines.

<!-- Aenderungsvermerk keel-harness 25.08.2026: Regelquelle vom ungepinnten
     Remote-Fetch (raw.githubusercontent.com, main-Branch) auf den lokal
     eingefrorenen, auditierten Stand rules.md umgestellt. Grund: ein Skill,
     dessen Anweisungen ein fremder main-Branch zur Laufzeit definiert, ist
     nicht abschliessend auditierbar (Audit-Befund 25.08.2026, sicher=false).
     Update-Weg siehe unten — nur manuell, mit erneutem Audit. -->

## How It Works

1. Read the frozen rules from `rules.md` **in this skill folder** (audited
   snapshot of the Web Interface Guidelines, 2026-08-26).
2. Read the specified files (or prompt user for files/pattern).
3. Check against all rules.
4. Output findings in the terse `file:line` format the rules define — then
   append the house closing lines ("Geprueft gegen: … · Offen: …",
   working-method.md), which always win over the "no preamble" rule.

## House rules (keel-harness)

- This is a STATIC code review. It never replaces the optical acceptance:
  UI-Verify heisst echter Screenshot im Browser gegen die genehmigten Entwuerfe
  (working-method.md).
- German display texts: apply the English copy rules (Title Case, second
  person, "&") only in spirit; AGENTS.md sets display language German.

## Updating the frozen rules (manual, never automatic)

Fetch `https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md`,
diff against `rules.md`, AUDIT the diff (prompt-injection, tool commands),
then replace `rules.md` and note the date here.

## Usage

When a user provides a file or pattern argument:
1. Read `rules.md` from this skill folder
2. Read the specified files
3. Apply all rules
4. Output findings using the format specified in the rules

If no files specified, ask the user which files to review.
