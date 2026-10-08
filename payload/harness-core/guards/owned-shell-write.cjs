"use strict";

// Deleting, moving, renaming and creating directories on literal paths inside the bound
// leaf OWNS (package guard-scope, plan step 3).
//
// Why: guard-scope R9 -- work an agent is meant to do (saving, tidying up, retiring,
// closing) never lands as a command with the Owner; outside the Owner actions the Harness
// gives the agent an allowed way. The same rules hold for Bash and PowerShell.
//
// No parser of its own (guard-parity E1): command-model.cjs is the only parser. The caller
// hands over the invocation words it already has; this module only reads them.
//
// Caller contract: cwd must be the directory this invocation really runs in. When an earlier
// segment or invocation of the same command changes the directory (cd, chdir, Set-Location,
// sl, Push-Location, Pop-Location), the caller must not grant OWNED_SHELL_WRITE; otherwise
// "cd docs; rm src/a.txt" is checked as src/a.txt while the shell deletes docs/src/a.txt.
//
// danger-guard.js stays an independent second check; an allow here does not bypass it.
//
// Second allowed target (package shell-grants, A5): the temp folder of the calling session,
// <os.tmpdir()>/claude/<any one folder name>/<session id>/ and everything below it. Writes,
// copies into it, deletes and moves inside it need no package binding and no OWNS: the folder
// is the session's own scratch space, which the Write tool may use as well. The path is
// compared in its resolved form (8.3 short names, junctions and symbolic links followed from
// the longest existing part), so a link or a short name cannot lead out. Without a session id
// there is no such folder. Running a program or script from it stays outside this module.
//
// Result: null when the command is not covered (the caller keeps DIRECT_SHELL_WRITE),
// { allowed: true, code: "OWNED_SHELL_WRITE", paths } or
// { allowed: false, code: "DIRECT_SHELL_WRITE", detail }. Never throws.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const packageBinding = require("../binding/package-binding.cjs");
const repository = require("../binding/repository.cjs");
const { msysPath } = require("./hook-context.cjs");
const sessionScope = require("./session-scope.cjs");

const MAX_TREE_ENTRIES = 10000;

const BASH_COMMANDS = {
  rm: { kind: "delete", options: ["-f", "-r", "-R", "-rf", "-fr"] },
  rmdir: { kind: "delete", options: ["-f", "-r", "-R", "-rf", "-fr"] },
  mv: { kind: "move", options: ["-f", "-n"] },
  mkdir: { kind: "create", options: ["-p"] },
};

// Commands that write only into the session temp folder (never into the OWNS): copying into it
// and the content writers. options: single-letter switches in one cluster (-rf) or long names.
const BASH_TEMP_COMMANDS = {
  cp: { kind: "copy", letters: "rRfnpv", longs: ["recursive", "force", "no-clobber", "verbose"] },
  tee: { kind: "write", letters: "a", longs: ["append"] },
};

const POWERSHELL_TEMP_COMMANDS = {
  copy: { names: ["cp", "copy-item", "cpi", "copy"], values: ["path", "literalpath", "destination"],
    switches: ["recurse", "force"] },
  content: { names: ["set-content", "sc", "add-content", "ac"], values: ["path", "literalpath", "value", "encoding"],
    switches: ["nonewline", "force"] },
  file: { names: ["out-file"], values: ["filepath", "path", "literalpath", "encoding", "width"],
    switches: ["append", "force", "noclobber", "nonewline"] },
  item: { names: ["new-item", "ni"], values: ["path", "itemtype", "name", "value"], switches: ["force"] },
};

const POWERSHELL_COMMANDS = {
  delete: { names: ["rm", "remove-item", "ri", "del", "erase", "rd", "rmdir"],
    values: ["path", "literalpath"], switches: ["recurse", "force"] },
  move: { names: ["mv", "move-item", "mi", "move"],
    values: ["path", "literalpath", "destination"], switches: ["force"] },
  rename: { names: ["rename-item", "ren", "rni"],
    values: ["path", "literalpath", "newname"], switches: ["force"] },
  create: { names: ["mkdir", "md", "new-item"],
    values: ["path", "itemtype"], switches: ["force"] },
};

const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

// The resolved form of a path: the longest existing part is resolved by the file system (8.3
// short names, junctions, symbolic links), parts that do not exist yet are joined back unchanged.
function resolvedPath(value) {
  const full = path.resolve(msysPath(String(value)));
  const rest = [];
  let current = full;
  for (;;) {
    try {
      return path.join(fs.realpathSync.native(current), ...rest.reverse());
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return full;
      rest.push(path.basename(current));
      current = parent;
    }
  }
}

function sameName(left, right) {
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}

// True when absolute lies in <tmpdir>/claude/<one folder>/<sessionId>/ or is that folder itself.
function insideSessionTemp(absolute, sessionId, tmpdir = os.tmpdir()) {
  const id = String(sessionId || "");
  if (!SESSION_ID.test(id) || id.includes("..")) return false;
  const relative = path.relative(resolvedPath(path.join(tmpdir, "claude")), resolvedPath(absolute));
  if (!relative || path.isAbsolute(relative)) return false;
  const parts = relative.split(path.sep);
  if (parts.length < 2 || parts.some((part) => part === ".." || part === "")) return false;
  return sameName(parts[1], id);
}

// A write must not go through a link or into a file with other names (hard link): both lead out
// of the folder although the path looks inside.
function assertPlainWriteTarget(absolute) {
  const stat = fs.lstatSync(absolute, { throwIfNoEntry: false });
  if (!stat) return;
  if (stat.isSymbolicLink()) refuse("path " + JSON.stringify(absolute) + " is a symbolic link or junction");
  if (stat.isFile() && typeof stat.nlink === "number" && stat.nlink > 1) {
    refuse("path " + JSON.stringify(absolute) + " is a file with more than one name");
  }
}

class Refusal extends Error {}

function refuse(message) {
  throw new Refusal(message);
}

function powerShellKind(name) {
  for (const [kind, spec] of Object.entries(POWERSHELL_COMMANDS)) {
    if (spec.names.includes(name)) return kind;
  }
  return null;
}

// Bash: options before or between operands, everything after -- is an operand.
function bashOperands(spec, args) {
  const operands = [];
  let afterDashDash = false;
  for (const arg of args) {
    if (!afterDashDash && arg === "--") afterDashDash = true;
    else if (!afterDashDash && arg.startsWith("-")) {
      if (!spec.options.includes(arg)) refuse("option " + JSON.stringify(arg) + " is not covered for owned shell writes");
    } else operands.push(arg);
  }
  return operands;
}

// PowerShell: full-length parameter names, case-insensitive; values follow their parameter.
// Returns the values in command order as { parameter, value }, parameter null when positional.
function powerShellArguments(spec, args) {
  const items = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("-")) {
      items.push({ parameter: null, value: arg });
      continue;
    }
    const parameter = arg.slice(1).toLowerCase();
    if (spec.switches.includes(parameter)) continue;
    if (!spec.values.includes(parameter)) refuse("parameter " + JSON.stringify(arg) + " is not covered for owned shell writes");
    if (index + 1 >= args.length) refuse("parameter " + JSON.stringify(arg) + " has no value");
    items.push({ parameter, value: args[index + 1] });
    index += 1;
  }
  return items;
}

function literalPath(arg, dialect) {
  const shown = JSON.stringify(arg);
  if (!arg) refuse("empty path operand");
  // A tilde expands only at the start of a word; inside a name it is literal (8.3 short names
  // such as LONSIN~1 carry one).
  if (/[*?[\]$`%\u0000-\u001f\u007f]/u.test(arg) || arg.startsWith("~")) refuse("path " + shown + " is not literal (wildcard, variable or control character)");
  if (arg.startsWith("-")) refuse("path " + shown + " starts with a dash");
  if (dialect !== "powershell" && /[\\{}"']/u.test(arg)) refuse("path " + shown + " carries a Bash escape, brace or quote");
  if (arg.split(/[\\/]/u).includes("..")) refuse("path " + shown + " contains a .. segment");
  const rest = /^[A-Za-z]:[\\/]/u.test(arg) ? arg.slice(2) : arg;
  if (rest.includes(":")) refuse("path " + shown + " contains a colon outside a leading drive letter");
  if (dialect === "powershell" && msysPath(arg) !== arg) refuse("path " + shown + " is a Git Bash drive path, ambiguous in PowerShell");
  return arg;
}

// Every existing link from the target up to the repository root must be a plain entry.
function assertNoLinkUpward(target, repoRoot) {
  let current = target;
  for (;;) {
    const stat = fs.lstatSync(current, { throwIfNoEntry: false });
    if (stat && stat.isSymbolicLink()) refuse("path " + JSON.stringify(current) + " is a symbolic link or junction");
    if (repository.samePath(current, repoRoot)) return;
    const parent = path.dirname(current);
    if (parent === current) refuse("path " + JSON.stringify(target) + " does not reach the bound repository root");
    current = parent;
  }
}

// A directory delete may follow junctions in Windows PowerShell 5.1; refuse any link inside.
function assertPlainTree(directory) {
  const pending = [directory];
  let entries = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    for (const name of fs.readdirSync(current)) {
      entries += 1;
      if (entries > MAX_TREE_ENTRIES) refuse("directory " + JSON.stringify(directory) + " holds more than " + MAX_TREE_ENTRIES + " entries");
      const entry = path.join(current, name);
      const stat = fs.lstatSync(entry);
      if (stat.isSymbolicLink()) refuse("directory " + JSON.stringify(directory) + " contains the link or junction " + JSON.stringify(entry));
      if (stat.isDirectory()) pending.push(entry);
    }
  }
}

function sessionBinding(cwd, projectRoot, sessionId) {
  if (!sessionId) refuse("no package session; owned shell writes need a bound leaf");
  let lastError = null;
  for (const start of [cwd, projectRoot].filter(Boolean)) {
    try {
      return packageBinding.findSessionBinding(start, String(sessionId), { controlRoot: projectRoot });
    } catch (error) {
      lastError = error;
    }
  }
  refuse("session has no Harness binding: " + (lastError ? lastError.message : "no start directory"));
}

function authorize(binding, cwd, arg) {
  const absolute = path.resolve(cwd, msysPath(arg));
  const decision = packageBinding.authorizeWrite(binding, absolute);
  if (!decision.allowed) {
    refuse("path " + JSON.stringify(arg) + " is refused by the bound leaf OWNS (" + decision.code + ")");
  }
  // authorizeWrite names an existing directory with a trailing slash ("src/"), which src/**
  // matches; the directory entry itself must be owned, so its name passes the same rule.
  const entry = decision.relative.replace(/\/+$/u, "");
  if (entry !== decision.relative && !binding.owns.some((pattern) => packageBinding.globRegex(pattern).test(entry))) {
    refuse("path " + JSON.stringify(arg) + " is refused by the bound leaf OWNS (OUTSIDE_LEAF_OWNS, the directory itself is not owned)");
  }
  assertNoLinkUpward(absolute, binding.repoRoot);
  return { absolute, relative: decision.relative };
}

function orchestratorAuthorize(projectRoot, sessionId, target, unbound) {
  const fix = sessionScope.orchestratorFix({ harnessRoot: projectRoot, sessionId, target });
  if (!fix) throw unbound;
  if (!fix.allowed) refuse("LEAF_RUNNING: path " + JSON.stringify(target) + " lies in the OWNS of a leaf a worker works on: " + fix.running);
  assertNoLinkUpward(target, fix.repoRoot);
  return { absolute: target, relative: fix.relative };
}

// Operands in command order, sources before the target: { kind, sources, target, newName }.
function bashPlan(name, args) {
  const spec = BASH_COMMANDS[name];
  if (!spec) return null;
  const operands = bashOperands(spec, args);
  if (operands.length === 0) refuse(name + " without a path operand");
  if (spec.kind === "move") {
    if (operands.length < 2) refuse("mv needs at least one source and a target");
    return { kind: "move", sources: operands.slice(0, -1), target: operands[operands.length - 1] };
  }
  return { kind: spec.kind, sources: operands, target: null };
}

function powerShellPlan(name, args) {
  const kind = powerShellKind(name);
  if (!kind) return null;
  if (name === "new-item") {
    const type = args.findIndex((arg) => arg.toLowerCase() === "-itemtype");
    if (type < 0 || String(args[type + 1] || "").toLowerCase() !== "directory") return null;
  }
  const items = powerShellArguments(POWERSHELL_COMMANDS[kind], args);
  const pathItems = items.filter((item) => item.parameter === "path" || item.parameter === "literalpath");
  if (name !== "new-item" && items.some((item) => item.parameter === "itemtype")) {
    refuse("parameter -ItemType is only covered for New-Item");
  }
  if (kind === "delete" || kind === "create") {
    const sources = items.filter((item) => item.parameter !== "itemtype").map((item) => item.value);
    if (sources.length === 0) refuse(name + " without a path operand");
    return { kind, sources, target: null };
  }
  // The first positional binds the source unless -Path or -LiteralPath named it; the next one
  // binds the destination or the new name.
  const positional = items.filter((item) => item.parameter === null).map((item) => item.value);
  const source = pathItems.map((item) => item.value);
  if (source.length === 0 && positional.length > 0) source.push(positional.shift());
  const targets = items.filter((item) => item.parameter === "destination" || item.parameter === "newname")
    .map((item) => item.value).concat(positional);
  if (source.length === 0) refuse(name + " without a path operand");
  if (source.length !== 1 || targets.length !== 1) {
    refuse(name + " needs exactly one source and one " + (kind === "move" ? "destination" : "new name"));
  }
  if (kind === "move") return { kind, sources: source, target: targets[0] };
  const newName = targets[0];
  if (/[\\/:]/u.test(newName)) refuse("new name " + JSON.stringify(newName) + " must not contain a slash, backslash or colon");
  literalPath(newName, "powershell");
  return { kind, sources: source, target: path.join(path.dirname(source[0]), newName) };
}

// cp and tee: a plan that is only ever allowed below the session temp folder.
// { kind, sources, target, writes }: writes are the operands the command writes.
function bashTempPlan(name, args) {
  const spec = BASH_TEMP_COMMANDS[name];
  if (!spec) return null;
  const operands = [];
  let afterDashDash = false;
  for (const arg of args) {
    if (!afterDashDash && arg === "--") afterDashDash = true;
    else if (!afterDashDash && arg.startsWith("--")) {
      if (!spec.longs.includes(arg.slice(2))) refuse("option " + JSON.stringify(arg) + " is not covered for session temp writes");
    } else if (!afterDashDash && /^-[^-]/u.test(arg)) {
      if (![...arg.slice(1)].every((letter) => spec.letters.includes(letter))) {
        refuse("option " + JSON.stringify(arg) + " is not covered for session temp writes");
      }
    } else operands.push(arg);
  }
  if (operands.length === 0) refuse(name + " without a path operand");
  if (spec.kind === "copy") {
    if (operands.length < 2) refuse("cp needs at least one source and a target");
    return { kind: "copy", sources: operands.slice(0, -1), target: operands[operands.length - 1], writes: [operands[operands.length - 1]] };
  }
  return { kind: "write", sources: [], target: null, writes: operands };
}

// Copy-Item, Set-Content, Add-Content, Out-File and New-Item for files: PowerShell parameters
// by full name; the plan names the operands the command writes.
function powerShellTempPlan(name, args) {
  const entry = Object.entries(POWERSHELL_TEMP_COMMANDS).find(([, spec]) => spec.names.includes(name));
  if (!entry) return null;
  const [kind, spec] = entry;
  const items = powerShellArguments(spec, args);
  const named = (...parameters) => items.filter((item) => parameters.includes(item.parameter)).map((item) => item.value);
  const positional = items.filter((item) => item.parameter === null).map((item) => item.value);
  const pathNames = kind === "file" ? ["filepath", "path", "literalpath"] : ["path", "literalpath"];
  const paths = named(...pathNames);
  if (paths.length === 0 && positional.length > 0) paths.push(positional.shift());
  if (paths.length !== 1) refuse(name + " needs exactly one path");
  if (kind === "copy") {
    const destinations = named("destination").concat(positional);
    if (destinations.length !== 1) refuse(name + " needs exactly one source and one destination");
    return { kind: "copy", sources: paths, target: destinations[0], writes: [destinations[0]] };
  }
  if (kind === "content" || kind === "file") {
    if (positional.length > 1) refuse(name + " takes at most one value after the path");
    return { kind: "write", sources: [], target: null, writes: paths };
  }
  // New-Item: a file or a directory; links and junctions (-ItemType SymbolicLink, Junction,
  // HardLink) are not covered.
  const types = named("itemtype");
  if (types.length > 1 || (types.length === 1 && !["file", "directory"].includes(String(types[0]).toLowerCase()))) {
    refuse(name + " covers only -ItemType File or Directory");
  }
  if (positional.length > 0) refuse(name + " takes the path as -Path or first argument only");
  const names = named("name");
  if (names.length > 1) refuse(name + " takes at most one -Name");
  if (names.length === 1) {
    if (/[\\/:]/u.test(names[0])) refuse("name " + JSON.stringify(names[0]) + " must not contain a slash, backslash or colon");
    literalPath(names[0], "powershell");
    return { kind: "write", sources: [], target: null, writes: [path.join(paths[0], names[0])] };
  }
  return { kind: "write", sources: [], target: null, writes: paths };
}

// A decision for a plan that writes only below the session temp folder: null when any written
// place lies elsewhere (the caller keeps DIRECT_SHELL_WRITE), a refusal for a link or a file
// with several names, { allowed: true, code: "SESSION_TEMP_WRITE", paths } otherwise.
function decideTempPlan(plan, { dialect, staticArguments, cwd, sessionId, command }) {
  if (dialect === "powershell" && staticArguments === false) refuse(command + " has arguments that are not static");
  for (const operand of [...plan.sources, ...(plan.target ? [plan.target] : []), ...plan.writes]) literalPath(operand, dialect);
  if (!sessionId) return null;
  const absolute = (operand) => path.resolve(cwd, msysPath(operand));
  let written = plan.writes.map(absolute);
  if (plan.kind === "copy") {
    const stat = fs.lstatSync(written[0], { throwIfNoEntry: false });
    // A copy into an existing directory lands below it, under the name of each source.
    if (stat && stat.isDirectory()) written = plan.sources.map((source) => path.join(written[0], path.basename(absolute(source))));
  }
  if (!written.every((place) => insideSessionTemp(place, sessionId))) return null;
  for (const place of written) assertPlainWriteTarget(place);
  return { allowed: true, code: "SESSION_TEMP_WRITE", paths: written };
}

function decide({ name, words, staticArguments, dialect, cwd, projectRoot, sessionId }) {
  const command = String(name || "").toLowerCase();
  const args = Array.from(words || [], String).slice(1);
  const powerShell = dialect === "powershell";
  const plan = powerShell ? powerShellPlan(command, args) : bashPlan(command, args);
  if (!plan) {
    const tempPlan = powerShell ? powerShellTempPlan(command, args) : bashTempPlan(command, args);
    return tempPlan ? decideTempPlan(tempPlan, { dialect, staticArguments, cwd, sessionId, command }) : null;
  }
  if (powerShell && staticArguments === false) refuse(command + " has arguments that are not static");
  const operands = [...plan.sources, ...(plan.target ? [plan.target] : [])];
  for (const operand of operands) literalPath(operand, dialect);

  const absolute = (operand) => path.resolve(cwd, msysPath(operand));
  const inTemp = (operand) => Boolean(sessionId) && insideSessionTemp(absolute(operand), sessionId);
  // Every operand in the session's own temp folder: no binding and no OWNS needed.
  if (operands.every(inTemp)) {
    for (const operand of plan.kind === "delete" ? plan.sources : []) {
      const stat = fs.lstatSync(absolute(operand), { throwIfNoEntry: false });
      if (stat && stat.isDirectory()) assertPlainTree(absolute(operand));
    }
    if (plan.target) assertPlainWriteTarget(absolute(plan.target));
    return { allowed: true, code: "SESSION_TEMP_WRITE", paths: operands.map(absolute) };
  }

  // Without a leaf binding the session that orchestrates a package may change files in the OWNS of a leaf of it
  // at rest (Fix zwischendurch, the same rule as paket-gate); every other session keeps the binding refusal.
  let binding = null;
  let unbound = null;
  try { binding = sessionBinding(cwd, projectRoot, sessionId); }
  catch (error) { if (!(error instanceof Refusal)) throw error; unbound = error; }
  const own = (operand) => (inTemp(operand) ? { absolute: absolute(operand), relative: null }
    : binding ? authorize(binding, cwd, operand) : orchestratorAuthorize(projectRoot, sessionId, absolute(operand), unbound));
  const paths = [];
  const sources = plan.sources.map(own);
  paths.push(...sources.map((item) => item.relative).filter(Boolean));
  if (plan.target) {
    const target = own(plan.target);
    if (target.relative) paths.push(target.relative);
    // A move into an existing directory lands below it; that place must be owned as well.
    const stat = fs.lstatSync(target.absolute, { throwIfNoEntry: false });
    if (plan.kind === "move" && stat && stat.isDirectory()) {
      for (const source of sources) own(path.join(target.absolute, path.basename(source.absolute)));
    }
  }
  if (plan.kind === "delete") {
    for (const source of sources) {
      const stat = fs.lstatSync(source.absolute, { throwIfNoEntry: false });
      if (stat && stat.isDirectory()) assertPlainTree(source.absolute);
    }
  }
  return { allowed: true, code: "OWNED_SHELL_WRITE", paths };
}

// One output target (a redirection, a reporter destination) below the session temp folder:
// { allowed: true, absolute } or { allowed: false, detail }. A relative target needs the
// directory the command really starts in, so changesDirectory refuses it.
function decideSessionTempTarget({ target, dialect, cwd, sessionId, changesDirectory } = {}) {
  try {
    if (!sessionId) refuse("no session id; the session temp folder is unknown");
    literalPath(String(target ?? ""), dialect === "powershell" ? "powershell" : "bash");
    const text = msysPath(String(target));
    if (changesDirectory && !path.isAbsolute(text)) refuse("the command changes directory; a relative target is checked against the starting directory only");
    const absolute = path.resolve(cwd || process.cwd(), text);
    if (!insideSessionTemp(absolute, sessionId)) refuse("path " + JSON.stringify(String(target)) + " is outside the temp folder of this session");
    assertPlainWriteTarget(absolute);
    return { allowed: true, absolute };
  } catch (error) {
    return { allowed: false, detail: error instanceof Refusal ? error.message : "session temp check failed: " + String(error && error.message || error) };
  }
}

function decideOwnedWrite(input = {}) {
  try {
    return decide(input || {});
  } catch (error) {
    const message = error instanceof Refusal ? error.message : "owned shell write check failed: " + String(error && error.message || error);
    return { allowed: false, code: "DIRECT_SHELL_WRITE", detail: message };
  }
}

module.exports = { decideOwnedWrite, decideSessionTempTarget, insideSessionTemp };
