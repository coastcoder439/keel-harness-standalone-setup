#!/usr/bin/env node
// gate-lint.mjs : audit whether a ledger is worth passing.
// Zero dependencies. Node 16+.
//
// The checker and the Stop hook decide whether gates were met. Neither asks
// whether the gates were worth meeting. A gate reading "the entire feature
// works perfectly" with `CHECK: echo ok` and `EXPECT: ok` passes the checker,
// the parent re-verification and the hook, because the oracle is real, runs,
// and returns what it promised. Authoring is the one step in the enforcement
// hierarchy that is still pure prose discipline, and this lints it.
//
// This never executes a CHECK. It reads the ledger and judges its oracles.
//
//   node gate-lint.mjs [options] <ledger.md ...>
//     --strict   treat warnings as failures
//     --json     machine-readable findings
//
// exit codes: 0 no strict failures, 1 strict findings, 2 usage or parse error.
//
// Usable as a gate, so a ledger can require its own quality:
//   CHECK: node scripts/gate-lint.mjs GATES.md
//   EXPECT: LINT OK

import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { parseGates } from "./lib/gates.mjs";
import { resolvePackageTarget } from "./lib/packages.mjs";

const HELP = `usage: gate-lint.mjs [--strict] [--json] [--package ID | <ledger.md ...>]

Audit gate quality, not gate completion. Report lexical signs of fixed-output
oracles, weak expectations, manual measurements, and titles that name an
activity instead of an outcome. Never executes a CHECK.

exit codes: 0 no strict failures, 1 strict findings, 2 usage or parse error.`;

const FLAG_OPTIONS = new Set(["--strict", "--json", "--help", "-h"]);
const VALUE_OPTIONS = new Set(["--package", "--scope", "--root", "--repo-key"]);

const args = process.argv.slice(2);
if (!args.length) {
  console.error(HELP);
  process.exit(2);
}
// `--` makes every following token a filename, including literal files named
// `--help` and `-h`. Only scan the option prefix for the help flags.
const positionalIndex = args.indexOf("--");
const optionPrefix = positionalIndex === -1 ? args : args.slice(0, positionalIndex);
if (optionPrefix.includes("--help") || optionPrefix.includes("-h")) {
  console.log(HELP);
  process.exit(0);
}
let strict = false;
let asJson = false;
let positional = false;
const files = [];
const options = Object.create(null);
for (let index = 0; index < args.length; index++) {
  const arg = args[index];
  if (!positional && arg === "--") { positional = true; continue; }
  if (!positional && FLAG_OPTIONS.has(arg)) {
    if (arg === "--strict") strict = true;
    else if (arg === "--json") asJson = true;
    continue;
  }
  if (!positional && arg.startsWith("--")) {
    const equals = arg.indexOf("=");
    const name = equals === -1 ? arg : arg.slice(0, equals);
    if (!VALUE_OPTIONS.has(name)) {
      console.error("gate-lint: unknown option " + name);
      console.error("run gate-lint.mjs --help for usage");
      process.exit(2);
    }
    const key = name.slice(2);
    if (options[key] !== undefined) {
      console.error("gate-lint: duplicate option " + name);
      process.exit(2);
    }
    const value = equals === -1 ? args[++index] : arg.slice(equals + 1);
    if (value === undefined || value === "") {
      console.error("gate-lint: " + name + " needs a value");
      process.exit(2);
    }
    options[key] = value;
    continue;
  }
  if (!positional && arg.startsWith("-")) {
    console.error("gate-lint: unknown option " + arg);
    console.error("run gate-lint.mjs --help for usage");
    process.exit(2);
  }
  files.push(arg);
}
if (files.length && (options.package || options.scope)) {
  console.error("gate-lint: explicit files cannot be combined with --package or --scope");
  process.exit(2);
}
let packageTarget = null;
if (!files.length && (options.package || options.scope || process.env.UNLAZY_PACKAGE)) {
  try {
    packageTarget = resolvePackageTarget({
      ...(options.root ? { root: options.root } : { cwd: process.cwd() }),
      packageId: options.package,
      scope: options.scope,
      repoKey: options["repo-key"] || ".",
    });
    files.push(...packageTarget.gateFiles);
  } catch (error) {
    console.error("gate-lint: " + error.message);
    process.exit(2);
  }
}
if (!files.length) {
  console.error("gate-lint: name at least one ledger file or pass --package ID");
  process.exit(2);
}

const fileLabel = (file) => packageTarget
  ? packageTarget.packageId + "/" + relative(packageTarget.repoRoot, file).replaceAll("\\", "/")
  : file;

// This is deliberately advisory and whole-command only. Shell text beginning
// with `echo` can still chain a real verifier, and argv containing EXPECT says
// nothing about what the called program prints or whether it exits zero.
const FIXED_OUTPUT_COMMAND = /^\s*(?:(?:echo|printf)(?:\s+[^&|;]*)?|true|:|exit\s+0)\s*$/i;
// Tokens that appear in failure output as readily as in success output.
const WEAK_EXPECT = new Set([
  "ok", "okay", "done", "pass", "passed", "success", "successful", "succeeded",
  "complete", "completed", "finished", "yes", "true", "0", "good", "fine", "working",
]);
// Openings that name an activity rather than an outcome a stranger could judge.
const ACTIVITY_START = /^(work(ing)? on|improve|enhance|handle|support|ensure|make sure|try|attempt|look (at|into)|investigate|consider|review|refactor|clean ?up|polish|update|tidy|address|deal with|add support)\b/i;
const findings = [];
const add = (file, level, gate, rule, message) =>
  findings.push({ file, level, gate: gate || null, rule, message });

let parseFailed = false;

for (const file of files) {
  const label = fileLabel(file);
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    console.error("gate-lint: cannot read " + file + ": " + error.message);
    process.exit(2);
  }

  const doc = parseGates(text);
  if (doc.errors.length) {
    // A ledger the shared parser rejects cannot be judged on quality.
    parseFailed = true;
    for (const error of doc.errors) add(label, "error", null, "parse", error);
    continue;
  }

  const live = doc.gates.filter((gate) => !doc.abandoned.has(gate.id));
  const runnable = live.filter((gate) => gate.check);

  for (const gate of live) {
    const { id, title, check, expect } = gate;

    if (check && FIXED_OUTPUT_COMMAND.test(check)) {
      add(label, "warn", id, "tautological-check",
        'CHECK looks like a fixed-output command: "' + check + '"; use an oracle that observes the named outcome');
    }

    if (expect && WEAK_EXPECT.has(expect.trim().toLowerCase())) {
      add(label, "warn", id, "weak-expect",
        'EXPECT "' + expect + '" also appears in failure output; match a line only success can print');
    }

    if (gate.expectation && gate.expectation.kind === "regex" && gate.expectation.pathLike) {
      add(label, "warn", id, "path-read-as-regex",
        'EXPECT "' + expect + '" looks like a literal path but is read as a regular expression, so its dots are wildcards');
    }

    if (!check) {
      add(label, "warn", id, "manual-gate",
        "no CHECK, so this outcome is judged by hand and its evidence is only as good as the reader");
      if (/\d/.test(title)) {
        add(label, "warn", id, "unmeasured-number",
          'title states a number that nothing measures: "' + title + '"');
      }
    }

    if (ACTIVITY_START.test(title)) {
      add(label, "warn", id, "activity-not-outcome",
        'names an activity, not an outcome a stranger could judge: "' + title + '"');
    }
  }

  if (live.length && runnable.length / live.length < 0.5) {
    add(label, "warn", null, "mostly-manual",
      runnable.length + "/" + live.length + " gates are runnable; a mostly manual ledger is prose with checkboxes");
  }
}

const errors = findings.filter((f) => f.level === "error");
const warnings = findings.filter((f) => f.level === "warn");
const failed = errors.length > 0 || (strict && warnings.length > 0);

if (asJson) {
  console.log(JSON.stringify({
    ok: !failed,
    errors: errors.length,
    warnings: warnings.length,
    files: files.map(fileLabel),
    findings,
  }, null, 2));
} else {
  let lastFile = null;
  for (const finding of findings) {
    if (finding.file !== lastFile) {
      console.log(finding.file);
      lastFile = finding.file;
    }
    const label = finding.level === "error" ? "ERROR" : "WARN ";
    const who = finding.gate ? finding.gate + ": " : "";
    console.log("  " + label + " " + who + finding.message + "  [" + finding.rule + "]");
  }
  if (!failed) {
    console.log(warnings.length ? "LINT OK (" + warnings.length + " warning(s))" : "LINT OK");
  } else {
    console.log("LINT FINDINGS: " + errors.length + " error(s), " + warnings.length + " warning(s)");
  }
}

process.exit(parseFailed ? 2 : failed ? 1 : 0);
