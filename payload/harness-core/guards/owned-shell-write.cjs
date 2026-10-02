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
// Result: null when the command is not covered (the caller keeps DIRECT_SHELL_WRITE),
// { allowed: true, code: "OWNED_SHELL_WRITE", paths } or
// { allowed: false, code: "DIRECT_SHELL_WRITE", detail }. Never throws.

const fs = require("node:fs");
const path = require("node:path");
const packageBinding = require("../binding/package-binding.cjs");
const repository = require("../binding/repository.cjs");
const { msysPath } = require("./hook-context.cjs");

const MAX_TREE_ENTRIES = 10000;

const BASH_COMMANDS = {
  rm: { kind: "delete", options: ["-f", "-r", "-R", "-rf", "-fr"] },
  rmdir: { kind: "delete", options: ["-f", "-r", "-R", "-rf", "-fr"] },
  mv: { kind: "move", options: ["-f", "-n"] },
  mkdir: { kind: "create", options: ["-p"] },
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
  if (/[*?[\]$`~%\u0000-\u001f\u007f]/u.test(arg)) refuse("path " + shown + " is not literal (wildcard, variable or control character)");
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

function decide({ name, words, staticArguments, dialect, cwd, projectRoot, sessionId }) {
  const command = String(name || "").toLowerCase();
  const args = Array.from(words || [], String).slice(1);
  const powerShell = dialect === "powershell";
  const plan = powerShell ? powerShellPlan(command, args) : bashPlan(command, args);
  if (!plan) return null;
  if (powerShell && staticArguments === false) refuse(command + " has arguments that are not static");
  for (const operand of [...plan.sources, ...(plan.target ? [plan.target] : [])]) literalPath(operand, dialect);

  const binding = sessionBinding(cwd, projectRoot, sessionId);
  const paths = [];
  const sources = plan.sources.map((operand) => authorize(binding, cwd, operand));
  paths.push(...sources.map((item) => item.relative));
  if (plan.target) {
    const target = authorize(binding, cwd, plan.target);
    paths.push(target.relative);
    // A move into an existing directory lands below it; that place must be owned as well.
    const stat = fs.lstatSync(target.absolute, { throwIfNoEntry: false });
    if (plan.kind === "move" && stat && stat.isDirectory()) {
      for (const source of sources) authorize(binding, cwd, path.join(target.absolute, path.basename(source.absolute)));
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

function decideOwnedWrite(input = {}) {
  try {
    return decide(input || {});
  } catch (error) {
    const message = error instanceof Refusal ? error.message : "owned shell write check failed: " + String(error && error.message || error);
    return { allowed: false, code: "DIRECT_SHELL_WRITE", detail: message };
  }
}

module.exports = { decideOwnedWrite };
