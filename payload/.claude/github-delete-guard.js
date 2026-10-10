#!/usr/bin/env node
// PreToolUse (Bash|PowerShell): the one protection of this Harness. Everything local is free (write, delete, commit,
// push, npm, node, python); GitHub is the backup, and on GitHub nothing is deleted unless the Owner has said so in
// the chat. Blocked, and nothing else:
//   git push --delete / -d, git push <remote> :<ref>
//   git push --force / -f / --force-with-lease / +<ref> on a shared branch (main, master, harness-rebuild;
//     pkg/*, wip/* and every other branch stay free)
//   gh repo delete, gh release delete, gh api -X DELETE
// The Owner's permission is the variable KEEL_GITHUB_DELETE_OK=1, in the environment or as a prefix of the command
// (KEEL_GITHUB_DELETE_OK=1 git push origin --delete x; PowerShell: $env:KEEL_GITHUB_DELETE_OK = "1"). The agent sets
// it only after the Owner allowed that deletion in the chat. Any error of this hook lets the command pass.
// Grenze: Der Hook sieht nur Shell-Befehle. Löschen über ein GitHub-MCP, curl- oder API-Skripte oder verpackte
// Skripte fängt er nicht ab.

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const MESSAGE = "Löschen auf GitHub nur mit ausdrücklicher Erlaubnis des Owners im Chat.";
const SHARED_BRANCHES = new Set(["main", "master", "harness-rebuild"]);
const PERMISSION = /KEEL_GITHUB_DELETE_OK\s*=\s*["']?1["']?(?![0-9A-Za-z])/u;
const SHELLS = new Set(["bash", "sh", "zsh", "dash", "pwsh", "powershell", "cmd"]);
const VALUE_FLAGS = new Set(["-o", "--push-option", "--repo", "--receive-pack", "--exec"]);
const PREFIXES = new Set(["&", "env", "command", "exec", "nohup", "time", "sudo", "call", "start"]);

// Splits a command line at ; & | and line breaks outside quotes, and each part into words (quotes removed).
function segments(text) {
  const parts = [];
  let words = [];
  let word = null;
  let quote = null;
  const endWord = () => { if (word !== null) { words.push(word); word = null; } };
  const endPart = () => { endWord(); if (words.length) parts.push(words); words = []; };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === quote) quote = null; else word += char;
    } else if (char === "'" || char === "\"") {
      quote = char;
      if (word === null) word = "";
    } else if (char === ";" || char === "&" || char === "|" || char === "\n" || char === "\r") {
      // "&" alone in front of a program is PowerShell's call operator and stays a word of the part.
      if (char === "&" && text[index + 1] !== "&" && text[index - 1] !== "&" && word === null && !words.length) words.push("&");
      else endPart();
    } else if (/\s/u.test(char)) endWord();
    else word = (word ?? "") + char;
  }
  endPart();
  return parts;
}

function programName(word) {
  return String(word || "").replaceAll("\\", "/").split("/").pop().replace(/\.(?:exe|cmd|bat)$/iu, "").toLowerCase();
}

// Drops call operators, env assignments and wrappers in front of the program.
function core(words) {
  let index = 0;
  while (index < words.length && (PREFIXES.has(programName(words[index])) || /^[A-Za-z_][A-Za-z0-9_]*=/u.test(words[index]))) index += 1;
  return words.slice(index);
}

function currentBranch(cwd) {
  try {
    let directory = path.resolve(cwd || process.cwd());
    for (;;) {
      const marker = path.join(directory, ".git");
      if (fs.existsSync(marker)) {
        let gitDir = marker;
        if (fs.statSync(marker).isFile()) {
          const target = fs.readFileSync(marker, "utf8").match(/^gitdir:\s*(.+)$/mu)?.[1]?.trim();
          if (!target) return null;
          gitDir = path.resolve(directory, target);
        }
        const head = fs.readFileSync(path.join(gitDir, "HEAD"), "utf8").trim();
        const match = head.match(/^ref:\s*refs\/heads\/(.+)$/u);
        return match ? match[1] : null;
      }
      const parent = path.dirname(directory);
      if (parent === directory) return null;
      directory = parent;
    }
  } catch { return null; }
}

// git [-C dir] [-c k=v] ... push ARGS  ->  ARGS, or null when this is no push.
function pushArguments(words) {
  let index = 1;
  while (index < words.length) {
    const word = words[index];
    if (word === "-C" || word === "-c" || word === "--git-dir" || word === "--work-tree" || word === "--namespace") index += 2;
    else if (word.startsWith("-")) index += 1;
    else break;
  }
  return words[index] === "push" ? words.slice(index + 1) : null;
}

function branchOf(reference) {
  return String(reference).replace(/^refs\/heads\//u, "");
}

// The reason one git command is blocked, or null.
function gitPushProblem(words, context) {
  const args = pushArguments(words);
  if (args === null) return null;
  const flags = [];
  const positional = [];
  let afterOptions = false;
  for (let index = 0; index < args.length; index += 1) {
    const word = args[index];
    if (!afterOptions && word === "--") afterOptions = true;
    else if (!afterOptions && word.startsWith("-")) {
      flags.push(word);
      // These options take their value as the next word.
      if (VALUE_FLAGS.has(word)) index += 1;
    } else positional.push(word);
  }
  const has = (...names) => flags.some((flag) => names.includes(flag.split("=")[0]));
  const shortGroup = (letter) => flags.some((flag) => /^-[A-Za-z]+$/u.test(flag) && flag.includes(letter));
  if (has("--delete") || shortGroup("d")) return "delete";
  const refspecs = positional.slice(1);
  if (refspecs.some((spec) => spec.startsWith(":") || spec.startsWith("+:"))) return "delete";
  const forceFlag = has("--force", "--force-with-lease", "--force-if-includes") || shortGroup("f");
  const forced = refspecs.filter((spec) => spec.startsWith("+")).map((spec) => spec.slice(1));
  if (!forceFlag && !forced.length) return null;
  const onShared = (spec) => {
    let target = spec.includes(":") ? spec.split(":").pop() : spec;
    if (target === "HEAD" || target === "") target = context.currentBranch();
    return target === null || SHARED_BRANCHES.has(branchOf(target));
  };
  if (forced.length && forced.some(onShared)) return "force";
  if (!forceFlag) return null;
  if (has("--all", "--mirror")) return "force";
  if (!refspecs.length) {
    const branch = context.currentBranch();
    return branch === null || SHARED_BRANCHES.has(branch) ? "force" : null;
  }
  return refspecs.some(onShared) ? "force" : null;
}

function ghProblem(words) {
  const rest = words.slice(1);
  const verbs = rest.filter((word) => !word.startsWith("-"));
  if (verbs[0] === "repo" && verbs[1] === "delete") return "delete";
  if (verbs[0] === "release" && verbs[1] === "delete") return "delete";
  if (verbs[0] === "api") {
    for (let index = 0; index < rest.length; index += 1) {
      const word = rest[index];
      const value = word === "-X" || word === "--method" ? rest[index + 1] : /^-X./u.test(word) ? word.slice(2) : /^--method=/u.test(word) ? word.slice(9) : null;
      if (value !== null && String(value).toUpperCase() === "DELETE") return "delete";
    }
  }
  return null;
}

function commandProblem(text, context, depth = 0) {
  for (const raw of segments(String(text))) {
    const words = core(raw);
    if (!words.length) continue;
    const program = programName(words[0]);
    if (program === "git") { const problem = gitPushProblem(words, context); if (problem) return problem; }
    else if (program === "gh") { const problem = ghProblem(words); if (problem) return problem; }
    else if (SHELLS.has(program) && depth < 3) {
      const index = words.findIndex((word, position) => position > 0 && /^(?:-c|-command|-lc|\/c)$/iu.test(word));
      if (index > 0 && words[index + 1] !== undefined) {
        const problem = commandProblem(words.slice(index + 1).join(" "), context, depth + 1);
        if (problem) return problem;
      }
    }
  }
  return null;
}

// null lets the command pass; a string is the denial text.
function hookDecision(payload, deps = {}) {
  try {
    const text = payload?.tool_input?.command;
    if (typeof text !== "string" || !text) return null;
    const env = deps.env || process.env;
    if (env.KEEL_GITHUB_DELETE_OK === "1" || PERMISSION.test(text)) return null;
    const context = { currentBranch: deps.currentBranch || (() => currentBranch(payload.cwd)) };
    return commandProblem(text, context) ? MESSAGE : null;
  } catch { return null; }
}

if (require.main === module) {
  if (process.argv.includes("--selbsttest")) {
    const cases = [
      ["git push origin --delete x", true], ["git push origin feature", false], ["git push -f origin pkg/P1", false],
      ["gh repo delete a/b --yes", true], ["gh api -X DELETE repos/a/b", true], ["KEEL_GITHUB_DELETE_OK=1 git push origin :x", false],
    ];
    let wrong = 0;
    for (const [command, blocked] of cases) {
      const answer = hookDecision({ tool_input: { command }, cwd: process.cwd() }, { env: {}, currentBranch: () => "pkg/P1" }) !== null;
      if (answer !== blocked) wrong += 1;
      console.log((answer === blocked ? "ok  " : "FEHL") + " " + command);
    }
    console.log((cases.length - wrong) + " von " + cases.length + " Faellen richtig.");
    process.exit(wrong ? 1 : 0);
  }
  let input = "";
  process.stdin.on("data", (chunk) => { input += chunk; });
  process.stdin.on("end", () => {
    let payload = {};
    try { payload = JSON.parse(input || "{}"); } catch { process.exit(0); }
    const denial = hookDecision(payload);
    if (denial === null) process.exit(0);
    fs.writeSync(2, denial + "\n");
    process.exit(2);
  });
}

module.exports = { MESSAGE, SHARED_BRANCHES, commandProblem, currentBranch, hookDecision, segments };
