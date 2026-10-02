"use strict";

// One description of a shell command for every harness guard, whatever shell runs it
// (decisions E1-E3 in docs/guard-decisions.md).
//
// Bash commands are split by the harness' own POSIX tokenizer (moved here from
// git-intent-guard). It also decides, once for every guard, what a redirection writes
// (bashRedirections), which leading control-flow keywords a command start skips and what
// kind of segment a line of a loop is (bashSegmentKind). PowerShell commands are parsed by PowerShell itself: its language
// parser is the only complete PowerShell grammar, and a second hand-written one would be
// a second, incomplete truth (measured 01.10.2026: the POSIX quote rule let `"...\"` hide a
// redirection in PowerShell, where the backslash escapes nothing). Parsing never executes
// the command. Every failure to parse fails closed in the caller.

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const DIALECTS = Object.freeze(["bash", "powershell"]);
const MAX_POWERSHELL_COMMAND = 24_000;

// Claude reports its PowerShell tool as "PowerShell". Codex reports every shell call as
// "Bash" but runs it through PowerShell on Windows (Codex 0.153.4 shell_detect.rs); its
// hooks reach the guards through .codex/hook-runner.cjs, which sets KEEL_HOOK_TARGET.
function dialectFor(payload = {}, env = process.env, platform = process.platform) {
  if (payload && payload.tool_name === "PowerShell") return "powershell";
  if (env.KEEL_HOOK_TARGET && env.KEEL_HARNESS_ROOT && platform === "win32") return "powershell";
  return "bash";
}

// ---------------------------------------------------------------------------------------
// Bash (POSIX) -- the one quote scanner and tokenizer of the harness.

// Calls visit(char, index, quote) for every character; quote is null, "'" or "\"" while
// inside a quoted run. Quoting follows POSIX: outside quotes a backslash-escaped quote
// opens nothing; inside single quotes nothing is escaped and the next ' closes; inside
// double quotes " is escaped only after an odd number of directly preceding backslashes.
// Other escaped characters outside quotes are still visited as themselves, so a guard
// may count them as operators or separators (fail closed).
function scanQuoted(command, visit) {
  const text = String(command || "");
  let quote = null;
  let escaped = false;
  let backslashes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote === "'") {
      if (char === "'") {
        quote = null;
        if (visit(char, index, null, true) === true) return true;
        continue;
      }
      if (visit(char, index, quote, false) === true) return true;
      continue;
    }
    if (quote === "\"") {
      if (char === "\"" && backslashes % 2 === 0) {
        quote = null;
        backslashes = 0;
        if (visit(char, index, null, true) === true) return true;
        continue;
      }
      backslashes = char === "\\" ? backslashes + 1 : 0;
      if (visit(char, index, quote, false) === true) return true;
      continue;
    }
    if (!escaped && (char === "\"" || char === "'")) {
      quote = char;
      backslashes = 0;
      if (visit(char, index, null, true) === true) return true;
      continue;
    }
    escaped = !escaped && char === "\\";
    if (visit(char, index, null, false) === true) return true;
  }
  return false;
}

// Splits at newlines, ;, |, ||, && and a single background & outside quotes. A single &
// splits only after text in the segment and not as part of &&, &>, >&, <& or |&; a
// leading & stays in its segment (the shell policy refuses it as a dynamic wrapper).
function segments(command) {
  const text = String(command || "");
  const output = [];
  let current = "";
  let skip = false;
  scanQuoted(text, (char, index, quote, isQuoteMark) => {
    if (skip) { skip = false; return false; }
    if (quote || isQuoteMark) { current += char; return false; }
    if (char === "\n" || char === ";" || char === "|") {
      if (current.trim()) output.push(current.trim());
      current = "";
      if (char === "|" && text[index + 1] === "|") skip = true;
      return false;
    }
    if (char === "&" && text[index + 1] === "&") {
      if (current.trim()) output.push(current.trim());
      current = "";
      skip = true;
      return false;
    }
    if (char === "&" && current.trim() && text[index + 1] !== ">" && !["<", ">", "|"].includes(text[index - 1])) {
      output.push(current.trim());
      current = "";
      return false;
    }
    current += char;
    return false;
  });
  if (current.trim()) output.push(current.trim());
  return output;
}

function tokens(segment) {
  const result = [];
  const pattern = /"((?:\\.|[^"])*)"|'((?:\\.|[^'])*)'|([^\s]+)/gu;
  for (const match of String(segment || "").matchAll(pattern)) result.push(match[1] ?? match[2] ?? match[3]);
  return result;
}

function executableName(value) {
  return path.basename(String(value || "").replace(/^[(&]+|[)]$/gu, "")).toLowerCase();
}

// Leading control-flow words a command start skips: `do rm -rf ~` runs rm, `then git push`
// runs git. for, select, case, done, fi and } are not skipped (see bashSegmentKind).
const LEADING_KEYWORDS = new Set(["do", "then", "else", "elif", "if", "while", "until", "!", "{", "(", "&"]);

// Index of the command a segment really runs, skipping assignments, leading control-flow
// keywords and transparent launchers (env, command, exec, nohup, time, nice, sudo, xargs)
// with their options. Used to FIND commands (Git, destructive verbs); the finite shell
// policy instead refuses every such launcher as a second dispatch surface.
function commandStart(words) {
  let index = 0;
  while (index < words.length) {
    const word = words[index];
    if (/^[A-Za-z_][A-Za-z0-9_]*=/u.test(word) || LEADING_KEYWORDS.has(word)) {
      index += 1;
      continue;
    }
    const name = executableName(word);
    if (name === "env") {
      index += 1;
      while (index < words.length && (/^-\w/u.test(words[index]) || /^[A-Za-z_][A-Za-z0-9_]*=/u.test(words[index]))) {
        index += 1;
      }
      continue;
    }
    if (["command", "exec", "nohup", "time", "nice", "sudo", "xargs"].includes(name)) {
      index += 1;
      while (index < words.length && /^-/u.test(words[index])) index += 1;
      continue;
    }
    break;
  }
  return index;
}

const DISCARD_TARGETS = new Set(["/dev/null", "/dev/stdout", "/dev/stderr"]);
const TARGET_END = new Set([" ", "\t", "\r", "\n", ";", "|", "&", "<", ">", "(", ")"]);

function redirectionKind(operator, target) {
  if (operator === "<>") return "file";
  if (operator === ">&" && /^(?:\d+|-)$/u.test(target)) return "merge";
  return DISCARD_TARGETS.has(target) ? "discard" : "file";
}

// Every output redirection outside quotes, in source order, as { operator, fd, target,
// kind }. operator has no descriptor (>, >>, >|, &>, &>>, >&, <>); fd is the digits
// directly before the operator at the start of a word, or null; target is the next word
// without its quotes. kind is "merge" for >&N, N>&M and N>&-, "discard" for exactly
// /dev/null, /dev/stdout or /dev/stderr, and "file" for everything else: <>, a missing
// target, a variable or substitution, and >& with a word that is no descriptor (Bash then
// writes that file, as in `ls >&out.txt`). Input redirections and heredocs yield nothing;
// >( and <( are process substitution (hasDynamicEvaluation). In doubt: "file".
function bashRedirections(command) {
  const text = withoutHeredocs(command);
  const found = [];
  let pending = null;
  let skipUntil = 0;
  let lastFinish = 0;
  const finish = (index) => {
    found.push({ operator: pending.operator, fd: pending.fd, target: pending.target,
      kind: redirectionKind(pending.operator, pending.target) });
    pending = null;
    lastFinish = index;
  };
  const descriptorBefore = (index) => {
    let start = index;
    while (start > 0 && /\d/u.test(text[start - 1])) start -= 1;
    if (start === index || start < lastFinish) return null;
    const before = text[start - 1];
    if (before !== undefined && !/[\s;|&()]/u.test(before)) return null;
    return text.slice(start, index);
  };
  scanQuoted(text, (char, index, quote, isQuoteMark) => {
    if (index < skipUntil) return false;
    const plain = !quote && !isQuoteMark;
    if (pending) {
      if (plain && TARGET_END.has(char)) {
        if ((char === " " || char === "\t") && !pending.started) return false;
        finish(index);
      } else {
        pending.started = true;
        if (!isQuoteMark) pending.target += char;
        return false;
      }
    }
    if (!plain) return false;
    let operator = null;
    let fd = null;
    if (char === ">") {
      const next = text[index + 1];
      if (next === "(") return false;
      operator = next === ">" ? ">>" : next === "|" ? ">|" : next === "&" ? ">&" : ">";
      fd = descriptorBefore(index);
    } else if (char === "&" && text[index + 1] === ">") {
      operator = text[index + 2] === ">" ? "&>>" : "&>";
    } else if (char === "<" && text[index + 1] === ">") {
      operator = "<>";
      fd = descriptorBefore(index);
    }
    if (!operator) return false;
    skipUntil = index + operator.length;
    pending = { operator, fd, target: "", started: false };
    return false;
  });
  if (pending) finish(text.length);
  return found;
}

// True exactly when a redirection writes a file (kind "file" in bashRedirections):
// `ls 2>&1`, `cmd 2>/dev/null` and `sort < list.txt` write nothing.
function hasOutputRedirection(command) {
  return bashRedirections(command).some((redirection) => redirection.kind === "file");
}

// $( and backticks count outside single quotes over the whole text, heredoc bodies
// included (Bash runs $( in a heredoc with an unquoted delimiter). Process substitution
// >( and <( counts outside any quotes; in double quotes it is text.
function hasDynamicEvaluation(command) {
  const text = String(command || "");
  const substitution = scanQuoted(text, (char, index, quote, isQuoteMark) => {
    if (quote === "'" || isQuoteMark) return false;
    return (char === "$" && text[index + 1] === "(") || char === "`";
  });
  if (substitution) return true;
  const code = withoutHeredocs(text);
  return scanQuoted(code, (char, index, quote, isQuoteMark) =>
    !quote && !isQuoteMark && (char === "<" || char === ">") && code[index + 1] === "(");
}

// Heredoc bodies are data (for example a file written by cat <<EOF), not commands. Only
// the body lines and the delimiter line go; the rest of the operator line stays, so
// `cat <<EOF > src/a.txt` keeps its redirection. A heredoc without its delimiter line
// stays unchanged (its body is then judged as command text: fail closed).
function withoutHeredocs(command) {
  let text = String(command || "");
  let from = 0;
  for (;;) {
    const operators = [];
    let lineEnd = -1;
    scanQuoted(text, (char, index, quote, isQuoteMark) => {
      if (index < from) return false;
      if (lineEnd >= 0 && index >= lineEnd) return true;
      if (quote || isQuoteMark || char !== "<" || text[index + 1] !== "<" || text[index - 1] === "<" || text[index + 2] === "<") return false;
      const match = /^<<-?[ \t]*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/u.exec(text.slice(index));
      if (!match) return false;
      operators.push({ index, length: match[0].length, delimiter: match[2] });
      if (lineEnd < 0) {
        const newline = text.indexOf("\n", index);
        lineEnd = newline < 0 ? text.length : newline;
      }
      return false;
    });
    if (!operators.length) return text;
    let cursor = lineEnd + 1;
    let removed = 0;
    for (const operator of operators) {
      let end = -1;
      let lineStart = cursor;
      while (lineStart <= text.length) {
        const newline = text.indexOf("\n", lineStart);
        const lineStop = newline < 0 ? text.length : newline;
        if (text.slice(lineStart, lineStop).trim() === operator.delimiter) { end = lineStop; break; }
        if (newline < 0) break;
        lineStart = newline + 1;
      }
      if (end < 0) break;
      cursor = end + 1;
      removed += 1;
    }
    let line = text.slice(0, lineEnd);
    for (const operator of operators.slice(0, removed).reverse()) {
      line = line.slice(0, operator.index) + "<<HEREDOC-REMOVED" + line.slice(operator.index + operator.length);
    }
    if (!removed) {
      from = lineEnd + 1;
      if (from >= text.length) return text;
      continue;
    }
    const rest = cursor <= text.length ? text.slice(cursor) : "";
    text = rest ? line + "\n" + rest : line;
    from = line.length + 1;
    if (from >= text.length) return text;
  }
}

const LOOP_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const OUTPUT_OPERATOR_WORD = /^(\d*)(?:>>|>\||>&|>|&>>|&>)(.*)$/u;

// True when words are only redirections (operator with or without separate target) of
// the given kinds, measured by bashRedirections.
function onlyRedirections(words, kinds) {
  let index = 0;
  let count = 0;
  while (index < words.length) {
    const match = OUTPUT_OPERATOR_WORD.exec(words[index]);
    if (!match) return false;
    count += 1;
    index += match[2] === "" ? 2 : 1;
  }
  const found = bashRedirections(words.join(" "));
  return found.length === count && found.every((redirection) => kinds.includes(redirection.kind));
}

function inputRedirectionOnly(words) {
  if (words.length === 1) return /^<[^<>&|;()]+$/u.test(words[0]);
  return words.length === 2 && words[0] === "<" && /^[^<>&|;()]+$/u.test(words[1]);
}

// What one segment (its words from tokens()) is: "keyword-only" when nothing is left after
// commandStart (do, then or else alone on a line of a multi-line loop) or done, fi or }
// stand alone, optionally followed only by one input redirection (`< file`) or only by
// merge or discard redirections (`done 2>&1`); "loop-header" for `for NAME in WORDS`,
// `for ((...))` and `select NAME in WORDS`; otherwise the command words from commandStart
// on, so `while IFS= read -r line` becomes the read command. case and esac have no kind.
function bashSegmentKind(words) {
  const list = Array.from(words || [], String);
  const rest = list.slice(commandStart(list));
  if (!rest.length) return "keyword-only";
  const [head, ...tail] = rest;
  if (["done", "fi", "}"].includes(head) &&
      (!tail.length || inputRedirectionOnly(tail) || onlyRedirections(tail, ["merge", "discard"]))) {
    return "keyword-only";
  }
  if ((head === "for" || head === "select") && LOOP_NAME.test(tail[0] || "") && tail[1] === "in") return "loop-header";
  if (head === "for" && /^\(\([\s\S]*\)\)$/u.test(tail.join(" "))) return "loop-header";
  return rest;
}

// ---------------------------------------------------------------------------------------
// PowerShell -- parsed by PowerShell's own language parser.

const POWERSHELL_PARSER = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$text = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:KEEL_GUARD_PS_COMMAND))
$tokens = $null
$errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseInput($text, [ref]$tokens, [ref]$errors)
function Elem($e) {
  if ($e -is [System.Management.Automation.Language.StringConstantExpressionAst]) { return @{ k = 'const'; v = $e.Value } }
  if ($e -is [System.Management.Automation.Language.CommandParameterAst]) {
    $arg = $null
    if ($e.Argument -ne $null) { $arg = Elem $e.Argument }
    return @{ k = 'param'; v = $e.ParameterName; a = $arg }
  }
  if ($e -is [System.Management.Automation.Language.ExpandableStringExpressionAst]) {
    if ($e.NestedExpressions.Count -eq 0) { return @{ k = 'const'; v = $e.Value } }
    return @{ k = 'expr'; v = $e.Extent.Text }
  }
  if ($e -is [System.Management.Automation.Language.ConstantExpressionAst]) { return @{ k = 'const'; v = [string]$e.Value } }
  if ($e -is [System.Management.Automation.Language.VariableExpressionAst]) { return @{ k = 'var'; v = $e.Extent.Text } }
  if ($e -is [System.Management.Automation.Language.ScriptBlockExpressionAst]) { return @{ k = 'block'; v = '' } }
  return @{ k = 'expr'; v = $e.Extent.Text }
}
$commands = @()
foreach ($c in $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] }, $true)) {
  $elements = @()
  foreach ($e in $c.CommandElements) { $elements += ,(Elem $e) }
  $commands += ,@{ op = [string]$c.InvocationOperator; e = $elements; t = $c.Extent.Text }
}
$redirections = @()
foreach ($c in $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandBaseAst] }, $true)) {
  foreach ($r in $c.Redirections) {
    if ($r -is [System.Management.Automation.Language.FileRedirectionAst]) {
      $redirections += ,@{ kind = 'file'; stream = [string]$r.FromStream; append = [bool]$r.Append; target = (Elem $r.Location); t = $r.Extent.Text }
    } else {
      $redirections += ,@{ kind = 'merge'; stream = [string]$r.FromStream; t = $r.Extent.Text }
    }
  }
}
$assignments = @()
foreach ($a in $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.AssignmentStatementAst] }, $true)) {
  $left = $a.Left
  while ($left -is [System.Management.Automation.Language.ConvertExpressionAst] -or $left -is [System.Management.Automation.Language.AttributedExpressionAst]) { $left = $left.Child }
  $drive = ''
  if ($left -is [System.Management.Automation.Language.VariableExpressionAst]) { $drive = [string]$left.VariablePath.DriveName }
  $assignments += ,@{ drive = $drive; t = $a.Left.Extent.Text }
}
$members = @()
foreach ($m in $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.InvokeMemberExpressionAst] }, $true)) {
  $type = ''
  if ($m.Static -and $m.Expression -is [System.Management.Automation.Language.TypeExpressionAst]) { $type = $m.Expression.TypeName.FullName }
  $name = ''
  if ($m.Member -is [System.Management.Automation.Language.StringConstantExpressionAst]) { $name = $m.Member.Value }
  $members += ,@{ static = [bool]$m.Static; type = $type; member = $name; t = $m.Extent.Text }
}
$errorList = @()
foreach ($e in $errors) { $errorList += ,$e.Message }
[pscustomobject]@{ errors = $errorList; commands = $commands; redirections = $redirections; assignments = $assignments; members = $members } | ConvertTo-Json -Compress -Depth 8
`;

let cachedPowerShell;
function powershellExecutable(env = process.env) {
  if (cachedPowerShell !== undefined) return cachedPowerShell;
  const candidates = [];
  if (env.KEEL_GUARD_POWERSHELL) candidates.push(env.KEEL_GUARD_POWERSHELL);
  for (const directory of String(env.PATH || env.Path || "").split(path.delimiter).filter(Boolean)) {
    candidates.push(path.join(directory, process.platform === "win32" ? "pwsh.exe" : "pwsh"));
  }
  if (process.platform === "win32") {
    candidates.push(path.join(env.ProgramFiles || "C:\\Program Files", "PowerShell", "7", "pwsh.exe"));
    candidates.push(path.join(env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"));
  }
  cachedPowerShell = candidates.find((candidate) => {
    try { return fs.statSync(candidate).isFile(); } catch { return false; }
  }) || null;
  return cachedPowerShell;
}

function asList(value) {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function elementWord(element) {
  if (!element) return "";
  if (element.k === "param") return "-" + element.v;
  return String(element.v ?? "");
}

// Normalizes PowerShell AST facts into the same invocation words the Bash path produces:
// [name, ...arguments], with every parameter as "-Name" followed by an attached argument.
function normalizePowerShell(raw) {
  const invocations = [];
  for (const command of asList(raw.commands)) {
    const elements = asList(command.e);
    const head = elements[0];
    const staticName = head && head.k === "const" ? String(head.v) : null;
    const words = [];
    let staticArguments = true;
    for (const element of elements) {
      if (element.k === "param") {
        words.push("-" + element.v);
        if (element.a) {
          words.push(elementWord(element.a));
          if (element.a.k !== "const") staticArguments = false;
        }
      } else {
        words.push(elementWord(element));
        if (element.k !== "const") staticArguments = false;
      }
    }
    invocations.push({
      name: staticName ? staticName.toLowerCase() : null,
      words,
      operator: command.op === "Ampersand" ? "&" : command.op === "Dot" ? "." : null,
      dynamicName: !staticName,
      staticArguments,
      hasBlockArgument: elements.slice(1).some((element) => element.k === "block"),
      text: String(command.t || ""),
    });
  }
  const redirections = [];
  const merges = [];
  for (const redirection of asList(raw.redirections)) {
    if (redirection.kind === "file") {
      redirections.push({ stream: redirection.stream, append: Boolean(redirection.append),
        target: elementWord(redirection.target), staticTarget: redirection.target?.k === "const", text: redirection.t });
    } else {
      merges.push({ stream: redirection.stream, text: redirection.t });
    }
  }
  const envAssignments = [];
  const assignments = [];
  for (const assignment of asList(raw.assignments)) {
    if (String(assignment.drive || "").toLowerCase() === "env") envAssignments.push({ text: assignment.t });
    else assignments.push({ text: assignment.t });
  }
  const members = asList(raw.members).map((member) => ({
    static: Boolean(member.static), type: String(member.type || ""), member: String(member.member || ""), text: String(member.t || ""),
  }));
  return { invocations, redirections, merges, envAssignments, assignments, members };
}

function parsePowerShell(command, options = {}) {
  const text = String(command || "");
  if (Buffer.byteLength(text, "utf8") > MAX_POWERSHELL_COMMAND) {
    return { dialect: "powershell", ok: false, error: "PowerShell command exceeds " + MAX_POWERSHELL_COMMAND + " bytes" };
  }
  const executable = options.powershell || powershellExecutable(options.env || process.env);
  if (!executable) return { dialect: "powershell", ok: false, error: "no PowerShell is installed to parse the command" };
  const encoded = Buffer.from(POWERSHELL_PARSER, "utf16le").toString("base64");
  const result = spawnSync(executable, ["-NoProfile", "-NonInteractive", "-OutputFormat", "Text", "-EncodedCommand", encoded], {
    encoding: "utf8",
    windowsHide: true,
    timeout: options.timeoutMs || 8_000,
    maxBuffer: 8 * 1024 * 1024,
    env: { ...(options.env || process.env), KEEL_GUARD_PS_COMMAND: Buffer.from(text, "utf8").toString("base64") },
  });
  if (result.error) return { dialect: "powershell", ok: false, error: "PowerShell parser failed: " + result.error.message };
  if (result.status !== 0) {
    return { dialect: "powershell", ok: false, error: "PowerShell parser exited " + result.status + ": " + String(result.stderr || "").slice(0, 300) };
  }
  let raw;
  try {
    const line = String(result.stdout || "").split(/\r?\n/u).map((item) => item.trim()).filter((item) => item.startsWith("{")).pop();
    raw = JSON.parse(line || "");
  } catch {
    return { dialect: "powershell", ok: false, error: "PowerShell parser returned no readable result" };
  }
  const errors = asList(raw.errors).map(String).filter(Boolean);
  if (errors.length) return { dialect: "powershell", ok: false, error: "PowerShell parse error: " + errors.slice(0, 3).join("; ") };
  return { dialect: "powershell", ok: true, ...normalizePowerShell(raw) };
}

// ---------------------------------------------------------------------------------------
// Dialect-neutral helpers the guards share.

// The Bash-equivalent segment of one PowerShell file verb, so a guard's POSIX rules
// (danger-guard: recursive removal of home or root, writes outside the workspace) judge
// Remove-Item, Copy-Item, Move-Item, New-Item and the content writers the same way.
const POWERSHELL_VERBS = Object.freeze({
  "remove-item": "rm", ri: "rm", rm: "rm", del: "rm", erase: "rm", rd: "rm", rmdir: "rm",
  "copy-item": "cp", copy: "cp", cp: "cp", cpi: "cp",
  "move-item": "mv", move: "mv", mv: "mv", mi: "mv",
  "rename-item": "mv", ren: "mv", rni: "mv",
  "new-item": "mkdir", ni: "mkdir", mkdir: "mkdir", md: "mkdir",
  "set-content": "tee", sc: "tee", "add-content": "tee", ac: "tee", "out-file": "tee",
  "tee-object": "tee", tee: "tee", "clear-content": "truncate", clc: "truncate",
});

const PATH_PARAMETERS = new Set(["path", "literalpath", "filepath", "pspath", "lp"]);

// Quoted only where a word needs it, so a guard's rules see `rm -rf ~` exactly as Bash
// would write it.
function quoteForPosix(value) {
  const text = String(value);
  return /[\s"';|&<>]/u.test(text) ? "\"" + text.replaceAll("\"", "\\\"") + "\"" : text;
}

// A parameter that takes no value, read the cautious way a guard must: PowerShell accepts
// any unique prefix (-Rec, -Fo), and a POSIX habit like -rf counts as recurse plus force
// even though PowerShell itself would reject it. null means the parameter takes a value.
function switchFlags(name) {
  if (/^[rf]+$/u.test(name)) return { recurse: name.includes("r"), force: name.includes("f") };
  if ("recurse".startsWith(name)) return { recurse: true, force: false };
  if ("force".startsWith(name)) return { recurse: false, force: true };
  if (["whatif", "confirm", "append", "nonewline", "passthru", "container"].includes(name)) return { recurse: false, force: false };
  return null;
}

function posixEquivalent(invocation) {
  const verb = POWERSHELL_VERBS[String(invocation.name || "")];
  if (!verb) return null;
  const words = invocation.words.slice(1);
  const positional = [];
  const named = new Map();
  let recurse = false;
  let force = false;
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    if (/^-[A-Za-z]/u.test(word)) {
      const name = word.slice(1).replace(/:$/u, "").toLowerCase();
      const flags = switchFlags(name);
      const next = words[index + 1];
      if (flags) {
        recurse ||= flags.recurse;
        force ||= flags.force;
      } else if (next !== undefined && !/^-[A-Za-z]/u.test(next)) {
        named.set(name, next);
        index += 1;
      }
    } else {
      positional.push(word);
    }
  }
  const flags = [];
  if (verb === "rm") {
    if (recurse) flags.push("r");
    if (force) flags.push("f");
  }
  const flagWord = flags.length ? " -" + flags.join("") : "";
  const pathArguments = [...[...named].filter(([name]) => PATH_PARAMETERS.has(name)).map(([, value]) => value), ...positional];
  if (verb === "cp" || verb === "mv") {
    const destination = named.get("destination") ?? named.get("newname") ?? (positional.length > 1 ? positional.at(-1) : null);
    const sources = pathArguments.filter((value) => value !== destination);
    return [verb + flagWord, ...sources.map(quoteForPosix), destination ? quoteForPosix(destination) : ""].join(" ").trim();
  }
  if (verb === "tee" || verb === "truncate") {
    const target = pathArguments[0];
    return target ? verb + " " + quoteForPosix(target) : verb;
  }
  return [verb + flagWord, ...pathArguments.map(quoteForPosix)].join(" ").trim();
}

// Payload strings a launcher hands to a nested shell or interpreter, with the dialect the
// payload is written in: cmd /c, powershell -Command, bash -c and inline interpreters.
function wrapperPayloadsFromWords(words) {
  const start = commandStart(words);
  const name = executableName(words[start]);
  const rest = words.slice(start + 1);
  const payloads = [];
  if (["cmd", "cmd.exe"].includes(name)) {
    const marker = rest.findIndex((word) => /^\/(?:c|k)$/iu.test(word));
    if (marker >= 0 && rest[marker + 1]) payloads.push({ value: rest.slice(marker + 1).join(" "), wrapper: "cmd", dialect: "bash" });
  } else if (["powershell", "powershell.exe", "pwsh", "pwsh.exe"].includes(name)) {
    const marker = rest.findIndex((word) => /^-(?:c|command)$/iu.test(word));
    if (marker >= 0 && rest[marker + 1]) payloads.push({ value: rest.slice(marker + 1).join(" "), wrapper: "powershell", dialect: "powershell" });
  } else if (["bash", "bash.exe", "sh", "zsh", "dash", "fish"].includes(name)) {
    const marker = rest.findIndex((word) => /^-[^-]*c[^-]*$/iu.test(word));
    if (marker >= 0 && rest[marker + 1]) {
      payloads.push({ value: rest.slice(marker + 1).join(" "), wrapper: name.replace(/\.exe$/u, ""), dialect: "bash" });
    }
  } else if (["node", "node.exe", "deno", "deno.exe", "bun", "bun.exe", "python", "python.exe",
    "python3", "python3.exe", "ruby", "ruby.exe", "perl", "perl.exe"].includes(name)) {
    const marker = rest.findIndex((word) => /^(?:-[ceEp]|--eval|--print|--command)$/u.test(word));
    if (marker >= 0 && rest[marker + 1]) {
      payloads.push({ value: rest.slice(marker + 1).join(" "), wrapper: name.replace(/\.exe$/u, "") + "-inline", dialect: "code" });
    }
  }
  return payloads;
}

// One parse per command and dialect for everything a guard asks.
function parse(command, dialect, options = {}) {
  if (dialect === "powershell") return parsePowerShell(command, options);
  const text = String(command || "");
  return {
    dialect: "bash",
    ok: true,
    segments: segments(text),
    outputRedirection: hasOutputRedirection(text),
    dynamicEvaluation: hasDynamicEvaluation(text),
  };
}

module.exports = {
  DIALECTS,
  POWERSHELL_VERBS,
  bashRedirections,
  bashSegmentKind,
  commandStart,
  dialectFor,
  executableName,
  hasDynamicEvaluation,
  hasOutputRedirection,
  parse,
  parsePowerShell,
  posixEquivalent,
  powershellExecutable,
  scanQuoted,
  segments,
  tokens,
  withoutHeredocs,
  wrapperPayloadsFromWords,
};
