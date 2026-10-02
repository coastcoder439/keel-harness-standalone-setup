"use strict";

// The Owner template a guard denial carries (package guard-parity, decision E9; package
// guard-scope, steps 6 and R8/R9). A command for the Owner exists only for the actions that
// the Owner alone may take; the list is the table "Handlungen, die allein der Owner darf" in
// docs/guard-scope.md, and the guard passes ownerOnly: true for exactly those. Owner
// 01.10.2026: "Warum gibst du mir denn solche Befehle aus? Das, das musst du doch machen."
// Every other denial is agent work: it carries the agent's allowed route and no command,
// no warning line and no code block (AGENT_ROUTE, the one source of that text).
// For an Owner action the agent writes the sentence and the guard supplies the exact command.
// The app gives a run button only to a single-line bash block, and that block runs in the
// Owner's terminal, which is PowerShell on Windows (measured 30.09.2026: a template with a
// placeholder failed there with "Der Operator "<" ist für zukünftige Versionen reserviert").
// So the block is always fenced as bash, and on Windows its one line is complete PowerShell
// without a placeholder, starting in the agent's working directory:
//   - a PowerShell command runs as written; one with line breaks runs as Invoke-Expression of
//     its text, so it stays one line;
//   - a Bash command runs through Git Bash from a temporary script file, because Windows
//     PowerShell 5.1 passes an argument with inner double quotes to a native program
//     without escaping them, and PowerShell 7.3 escapes them -- a script file reaches bash
//     unchanged under both;
//   - a file write or edit the guard stopped becomes the same write or edit in PowerShell,
//     its text spelled out readably, line breaks exact.
// An Owner action without a command names what the Owner does instead (ownerAction), each
// for a stated reason: a credential never enters a command in the chat, an MCP action has no
// shell form, and session messages are switched off by the Owner.

const fs = require("node:fs");
const path = require("node:path");

// Longest command a template carries; a longer write is described, not spelled out.
const MAX_COMMAND = 30_000;

function powershellQuote(value) {
  return "'" + String(value).replaceAll("'", "''") + "'";
}

function posixQuote(value) {
  return "'" + String(value).replaceAll("'", "'\\''") + "'";
}

// Any text as one PowerShell expression on one line: single-quoted parts joined by the exact
// line breaks, so the Run field cannot change them.
function powershellText(value) {
  const parts = String(value).split(/(\r\n|\n|\r)/u);
  if (parts.length === 1) return powershellQuote(parts[0]);
  const breaks = { "\r\n": "\"`r`n\"", "\n": "\"`n\"", "\r": "\"`r\"" };
  return "(" + parts.map((part, index) => index % 2 ? breaks[part] : powershellQuote(part)).join(" + ") + ")";
}

function gitBashPath(env = process.env) {
  const candidates = [];
  if (env.CLAUDE_CODE_GIT_BASH_PATH) candidates.push(env.CLAUDE_CODE_GIT_BASH_PATH);
  for (const base of [env.ProgramFiles, env["ProgramFiles(x86)"], "C:\\Program Files"].filter(Boolean)) {
    candidates.push(path.join(base, "Git", "bin", "bash.exe"));
  }
  for (const directory of String(env.PATH || env.Path || "").split(path.delimiter).filter(Boolean)) {
    if (/[\\/]git[\\/]cmd$/iu.test(directory)) candidates.push(path.join(directory, "..", "bin", "bash.exe"));
  }
  return candidates.map((candidate) => path.resolve(candidate)).find((candidate) => {
    try { return fs.statSync(candidate).isFile(); } catch { return false; }
  }) || null;
}

function location(cwd, platform) {
  if (!cwd) return "";
  return platform === "win32" ? "Set-Location -LiteralPath " + powershellQuote(cwd) + "; " : "cd " + posixQuote(cwd) + " && ";
}

// The exact shell command the Owner runs, or null when it cannot be built without a placeholder.
function ownerCommand({ command, dialect = "bash", cwd = "", env = process.env, platform = process.platform }) {
  const text = String(command || "").trim();
  if (!text) return null;
  if (platform !== "win32") return { language: "bash", command: location(cwd, platform) + text };
  if (dialect === "powershell") {
    // One line for the run button: a command with line breaks runs as the expression of its text.
    const line = /[\r\n]/u.test(text) ? "Invoke-Expression " + powershellText(text) : text;
    return { language: "powershell", command: location(cwd, platform) + line };
  }
  const bash = gitBashPath(env);
  if (!bash) return null;
  return { language: "powershell", command: location(cwd, platform) +
    "$keelScript = [IO.Path]::GetTempFileName(); " +
    "[IO.File]::WriteAllText($keelScript, " + powershellText(text) + "); " +
    "& " + powershellQuote(bash) + " $keelScript; Remove-Item -LiteralPath $keelScript" };
}

const UTF8 = "(New-Object Text.UTF8Encoding $false)";

// The file operation of a Claude Write or Edit call on its resolved target; a notebook cell
// has no exact file form.
function toolFileOperation(toolName, input = {}, file = "") {
  if (!file) return null;
  if (toolName === "Write") return { kind: "write", file, content: String(input.content ?? "") };
  if (toolName === "Edit") {
    return { kind: "edit", file, oldText: String(input.old_string ?? ""), newText: String(input.new_string ?? ""),
      replaceAll: input.replace_all === true };
  }
  return null;
}

// The file operation a Write, Edit or patch stopped, as one PowerShell command. Edit keeps the
// tool's rule: the old text occurs exactly once unless every occurrence is replaced.
function fileCommand(operation, platform = process.platform) {
  if (platform !== "win32" || !operation || !operation.file) return null;
  const file = "$keelFile = " + powershellQuote(operation.file) + "; ";
  if (operation.kind === "write") {
    return file + "New-Item -ItemType Directory -Force -Path (Split-Path -Parent $keelFile) | Out-Null; " +
      "[IO.File]::WriteAllText($keelFile, " + powershellText(operation.content ?? "") + ", " + UTF8 + ")";
  }
  if (operation.kind === "edit") {
    const read = "$keelText = [IO.File]::ReadAllText($keelFile); $keelOld = " + powershellText(operation.oldText) +
      "; $keelNew = " + powershellText(operation.newText) + "; ";
    if (operation.replaceAll) {
      return file + read + "if (-not $keelText.Contains($keelOld)) { throw 'Stelle nicht gefunden' }; " +
        "[IO.File]::WriteAllText($keelFile, $keelText.Replace($keelOld, $keelNew), " + UTF8 + ")";
    }
    return file + read + "$keelAt = $keelText.IndexOf($keelOld, [StringComparison]::Ordinal); " +
      "if ($keelAt -lt 0 -or $keelText.IndexOf($keelOld, $keelAt + 1, [StringComparison]::Ordinal) -ge 0) " +
      "{ throw 'Stelle nicht genau einmal gefunden' }; " +
      "[IO.File]::WriteAllText($keelFile, $keelText.Substring(0, $keelAt) + $keelNew + " +
      "$keelText.Substring($keelAt + $keelOld.Length), " + UTF8 + ")";
  }
  if (operation.kind === "delete") return file + "Remove-Item -LiteralPath $keelFile";
  return null;
}

// The agent's route of a denial that is not an Owner action; the one source of this text.
const AGENT_ROUTE = "AGENTENWEG - kein Befehl an den Owner: diese Arbeit erledigt der Agent selbst (erlaubter Weg: ";
const AGENT_ROUTE_END = "). Gibt es keinen erlaubten Weg, meldet der Agent die Sperre im Bericht unter Offen:, nie als Befehl an den Owner.";

// The text appended to a denial. `what` names in plain words what the guard stopped; `route`
// is the allowed way. ownerOnly is true only for the Owner actions of docs/guard-scope.md; left
// out, it counts as an Owner action only next to ownerAction, otherwise as agent work. An
// Owner action carries exactly one of `command` (a shell command), `files` (file operations) or
// `ownerAction` (no command, with reason). Agent work carries only the route; given explicitly
// ownerOnly: false with ownerAction, it adds that line without a command.
function handoffText({ what, route = "", command = "", dialect = "bash", cwd = "", files = null, ownerAction = "",
  warning = "", ownerOnly, env = process.env, platform = process.platform }) {
  if (ownerOnly !== true && !(ownerOnly === undefined && ownerAction)) {
    const lines = ["", AGENT_ROUTE + (route || "siehe NEXT dieser Sperrmeldung") + AGENT_ROUTE_END];
    if (ownerOnly === false && ownerAction) lines.push("2. Kein Befehl: " + ownerAction);
    return lines.join("\n");
  }
  const lines = [
    "",
    "VORLAGE FUER DEN OWNER - nur verwenden, wenn dieser Schritt fuer seinen Auftrag wirklich noetig ist und kein erlaubter Weg existiert" +
      (route ? " (erlaubter Weg: " + route + ")" : "") + ":",
    "1. Ein Satz an den Owner: was gerade gemacht wird und warum (" + what + ")." + (warning ? " " + warning : ""),
  ];
  if (ownerAction) {
    lines.push("2. Kein Befehl: " + ownerAction);
    return lines.join("\n");
  }
  let built = null;
  if (files) {
    const commands = files.map((operation) => fileCommand(operation, platform));
    if (commands.length && commands.every(Boolean)) built = { language: "powershell", command: commands.join("; ") };
  } else built = ownerCommand({ command, dialect, cwd, env, platform });
  if (built && built.command.length <= MAX_COMMAND) {
    // Always a bash fence: only that block gets the app's run button; on Windows it runs in PowerShell.
    lines.push("2. Die Zeile: Achtung, du musst diesen Befehl ausführen:",
      "3. Genau dieser Block, unverändert:", "```bash", built.command, "```");
  } else if (built) {
    lines.push("2. Kein Befehl: er waere laenger als " + MAX_COMMAND + " Zeichen; der Owner nimmt die Aenderung selbst vor.");
  } else if (files) {
    lines.push("2. Kein Befehl: diese Dateiaenderung hat keine eindeutige PowerShell-Form; der Owner nimmt sie selbst vor.");
  } else {
    lines.push("2. Kein Befehl: Git Bash wurde nicht gefunden; der Owner fuehrt diesen Bash-Befehl in Git Bash aus: " +
      String(command || "").trim());
  }
  return lines.join("\n");
}

module.exports = { AGENT_ROUTE, MAX_COMMAND, fileCommand, gitBashPath, handoffText, ownerCommand, posixQuote, powershellQuote, powershellText,
  toolFileOperation };
