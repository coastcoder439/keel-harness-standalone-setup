#!/usr/bin/env node
// Skill package-standard: creates work packages in the Keel package standard and
// imports existing projects (flat package file, Fachboards P file, TODO list)
// with preview, apply and undo. Zero dependencies; builds on
// `package-cli create` (Owner contract skeleton, schema check) and validates
// every result with `package-cli doctor`.

import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HELP = `usage: package-standard.mjs <command> --root REPO [options]

commands:
  create --package ID --problem T --intent T --goal T --scope-in T --scope-out T
         --context T --step T [--step T ...] [--planned-start D --planned-end D]
         [--owner-request-file FILE | --owner-request T] [--owner-source T]
      new bundle in the standard format (via package-cli create), then doctor
  import --source FILE [--source FILE ...] --kind flat|pfile|todo
         (--package ID | --into ID) [--preview | --apply]
         [field options as for create] [--owner-request-file FILE]
         [--done P13,P14]   P files checked against commits as done (pfile only)
      --preview (default) prints the mapping as JSON and writes nothing;
      --apply writes a new bundle (--package) or appends the sources as plan
      steps to an existing bundle (--into) and keeps an undo journal
  undo --package ID
      reverts the last apply for this package if nothing changed since

options:
  --unlazy DIR   vendored Unlazy root (default: found above this skill or in REPO)
  --json         print JSON only

exit codes: 0 ok; 1 preview/apply found missing fields or doctor diagnostics;
            2 usage or safety refusal.`;

const VALUE = new Set([
  "--root", "--package", "--into", "--source", "--kind", "--problem", "--intent", "--goal",
  "--scope-in", "--scope-out", "--context", "--step", "--planned-start", "--planned-end",
  "--owner-request-file", "--owner-request", "--owner-source", "--unlazy", "--done",
]);
const REPEATABLE = new Set(["--source", "--step"]);
const FLAGS = new Set(["--preview", "--apply", "--json", "--help", "-h"]);
const PACKAGE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const JOURNAL_DIR = [".unlazy", "package-standard", "undo"];

class UsageError extends Error {}

function parseArgs(argv) {
  const positional = [];
  const options = { source: [], step: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (FLAGS.has(arg)) { options[arg.replace(/^-+/u, "")] = true; continue; }
    if (VALUE.has(arg)) {
      const value = argv[index + 1];
      if (value === undefined || (value.startsWith("--") && VALUE.has(value))) throw new UsageError(arg + " needs a value");
      index += 1;
      const key = arg.slice(2);
      if (REPEATABLE.has(arg)) options[key].push(value);
      else if (options[key] !== undefined) throw new UsageError("duplicate " + arg);
      else options[key] = value;
      continue;
    }
    if (arg.startsWith("-")) throw new UsageError("unknown option " + arg);
    positional.push(arg);
  }
  return { command: positional[0] || "", extra: positional.slice(1), options };
}

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const oneLine = (value) => String(value || "").replace(/\s+/gu, " ").trim();
const today = () => {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate());
};

function findUnlazy(options, root) {
  const candidates = [];
  if (options.unlazy) candidates.push(resolve(options.unlazy));
  let current = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    candidates.push(join(current, "vendor", "unlazy"));
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  candidates.push(join(root, "vendor", "unlazy"));
  const found = candidates.find((candidate) => existsSync(join(candidate, "scripts", "package-cli.mjs")));
  if (!found) throw new UsageError("vendored Unlazy (vendor/unlazy/scripts/package-cli.mjs) not found; pass --unlazy DIR");
  return found;
}

function packageCli(unlazy, root, args) {
  const result = spawnSync(process.execPath, [join(unlazy, "scripts", "package-cli.mjs"), ...args, "--root", root], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    timeout: 60_000,
    env: { ...process.env, UNLAZY_PACKAGE: "", UNLAZY_SCOPE: "" },
  });
  return { status: result.status ?? 2, stdout: result.stdout || "", stderr: result.stderr || String(result.error?.message || "") };
}

// --- Reading sources ----------------------------------------------------------

const PLAN_HEADING_RE = /^(?:plan|arbeitsplan|bauplan|schritte|steps|todo|todos|aufgaben)\b/iu;
const FIELD_NAMES = {
  problem: ["problem", "problemstellung"],
  intent: ["intent", "absicht"],
  goal: ["goal", "ziel"],
  scope: ["scope", "umfang"],
  context: ["context", "kontext"],
  plannedStart: ["planned start", "geplanter beginn"],
  plannedEnd: ["planned end", "geplantes ende"],
};

function boldFields(text) {
  const fields = {};
  const pattern = /\*\*([^*:]+):\*\*\s*([\s\S]*?)(?=\s\*\*[^*:]+:\*\*|\n\s*\n|\n#|$)/gu;
  for (const match of text.matchAll(pattern)) {
    const name = match[1].trim().toLowerCase();
    const key = Object.keys(FIELD_NAMES).find((candidate) => FIELD_NAMES[candidate].includes(name));
    if (key && fields[key] === undefined) fields[key] = oneLine(match[2]);
  }
  return fields;
}

// Level-two-to-six sections with the absolute line number of every line, so a
// preview can name the exact source line of each step.
function sections(text) {
  const result = [];
  let current = { heading: "", lines: [] };
  for (const [index, raw] of text.split(/\r?\n/u).entries()) {
    const heading = raw.match(/^#{2,6}\s+(.+?)\s*$/u);
    if (heading) {
      result.push(current);
      current = { heading: heading[1].trim(), lines: [] };
    } else current.lines.push({ number: index + 1, raw });
  }
  result.push(current);
  return result;
}

function stepsFrom(lines, sourceLabel) {
  const steps = [];
  for (const { number, raw } of lines) {
    const checkbox = raw.match(/^\s*(?:[-*+]|\d+[.)])\s+\[([ xX])\]\s+(.+?)\s*$/u);
    const numbered = checkbox ? null : raw.match(/^\s*\d+[.)]\s+(.+?)\s*$/u);
    if (checkbox || numbered) {
      steps.push({
        text: oneLine((checkbox ? checkbox[2] : numbered[1]).replace(/\*\*/gu, "")),
        done: checkbox ? checkbox[1].toLowerCase() === "x" : false,
        source: sourceLabel + ":" + number,
      });
      continue;
    }
    // A continuation line joins its step: the standard allows one line per step.
    if (steps.length && /^\s{2,}\S/u.test(raw) && !/^\s*[-*+]\s/u.test(raw)) {
      steps[steps.length - 1].text = oneLine(steps[steps.length - 1].text + " " + raw);
    }
  }
  return steps;
}

function sectionText(section) {
  return oneLine((section?.lines || []).map((line) => line.raw).join(" "));
}

function readFlat(file, label) {
  const text = readFileSync(file, "utf8").replace(/^\uFEFF/u, "");
  const title = text.match(/^#\s+(?:Work package|Arbeitspaket)?:?\s*(.+?)\s*$/mu)?.[1] || basename(file, ".md");
  const fields = boldFields(text.split(/^##\s/mu)[0]);
  const all = sections(text);
  const steps = all.filter((section) => PLAN_HEADING_RE.test(section.heading)).flatMap((section) => stepsFrom(section.lines, label));
  const status = sectionText(all.find((section) => /^status$/iu.test(section.heading)));
  return { kind: "flat", file, label, title, fields, steps, status };
}

function readPFile(file, label, doneCodes = new Set()) {
  const text = readFileSync(file, "utf8").replace(/^\uFEFF/u, "");
  const heading = text.match(/^#\s+(.+?)\s*$/mu)?.[1] || basename(file, ".md");
  const code = heading.match(/^(P\d+)\b/u)?.[1] || basename(file).match(/^(P\d+)/u)?.[1] || basename(file, ".md");
  const fields = boldFields(text);
  const statusSection = sections(text).find((section) => /^status$/iu.test(section.heading));
  const statusLine = oneLine((statusSection?.lines || []).find((line) => line.raw.trim())?.raw || "").replace(/^[-*]\s*/u, "");
  // P files carry free status prose; whether one is done is decided against
  // commits and code by whoever imports (--done P13,P14), never guessed here.
  const done = doneCodes.has(code.toUpperCase());
  const planSection = sections(text).find((section) => PLAN_HEADING_RE.test(section.heading));
  const steps = planSection ? stepsFrom(planSection.lines, label) : [];
  return {
    kind: "pfile",
    file,
    label,
    code,
    title: heading,
    fields,
    steps,
    status: statusLine,
    // As one plan step of an existing bundle (decision E-F6): one line that names
    // the P file; its own steps stay in the file as the build order.
    asStep: { text: oneLine(heading) + " (" + label + ")", done, source: label + ":1", status: statusLine || "ohne Status" },
  };
}

function readTodo(file, label) {
  const text = readFileSync(file, "utf8").replace(/^\uFEFF/u, "");
  const title = text.match(/^#\s+(.+?)\s*$/mu)?.[1] || basename(file, ".md");
  const steps = [];
  for (const [offset, raw] of text.split(/\r?\n/u).entries()) {
    const checkbox = raw.match(/^\s*(?:[-*+]|\d+[.)])\s+\[([ xX])\]\s+(.+?)\s*$/u);
    const todo = checkbox ? null : raw.match(/^\s*(?:[-*+]\s+)?(?:TODO|FIXME):?\s+(.+?)\s*$/u);
    if (checkbox) steps.push({ text: oneLine(checkbox[2]), done: checkbox[1].toLowerCase() === "x", source: label + ":" + (offset + 1) });
    else if (todo) steps.push({ text: oneLine(todo[1]), done: false, source: label + ":" + (offset + 1) });
  }
  return { kind: "todo", file, label, title, fields: {}, steps, status: "" };
}

function expandSources(values, kind) {
  const files = [];
  for (const value of values) {
    const full = resolve(value);
    if (!existsSync(full)) throw new UsageError("source not found: " + value);
    if (statSync(full).isDirectory()) {
      const names = readdirSync(full).filter((name) => name.endsWith(".md") && (kind !== "pfile" || /^P\d+/u.test(name)));
      names.sort((left, right) => {
        const a = Number(left.match(/^P(\d+)/u)?.[1] ?? Number.NaN);
        const b = Number(right.match(/^P(\d+)/u)?.[1] ?? Number.NaN);
        return Number.isNaN(a) || Number.isNaN(b) ? left.localeCompare(right, "en") : a - b;
      });
      files.push(...names.map((name) => join(full, name)));
    } else files.push(full);
  }
  if (!files.length) throw new UsageError("import needs at least one --source");
  return files;
}

// --- Building the standard package --------------------------------------------

function fieldsFrom(options, sourceFields = {}) {
  const scopeText = sourceFields.scope || "";
  const scopeMatch = scopeText.match(/^Drin:\s*(.+?)\s+Nicht drin:\s*(.+)$/u);
  const fields = {
    problem: oneLine(options.problem || sourceFields.problem),
    intent: oneLine(options.intent || sourceFields.intent),
    goal: oneLine(options.goal || sourceFields.goal),
    scopeIn: oneLine(options["scope-in"] || scopeMatch?.[1]),
    scopeOut: oneLine(options["scope-out"] || scopeMatch?.[2]),
    context: oneLine(options.context || sourceFields.context),
    plannedStart: oneLine(options["planned-start"] || sourceFields.plannedStart) || null,
    plannedEnd: oneLine(options["planned-end"] || sourceFields.plannedEnd) || null,
  };
  const missing = [];
  for (const [key, label] of [["problem", "Problem"], ["intent", "Intent"], ["goal", "Goal"],
    ["scopeIn", "Scope Drin"], ["scopeOut", "Scope Nicht drin"], ["context", "Context"]]) {
    if (!fields[key]) missing.push(label);
  }
  return { fields, missing };
}

function fieldBlock(fields) {
  const lines = [
    "**Problem:** " + fields.problem,
    "**Intent:** " + fields.intent,
    "**Goal:** " + fields.goal,
    "**Scope:** Drin: " + fields.scopeIn + " Nicht drin: " + fields.scopeOut,
    "**Context:** " + fields.context,
  ];
  if (fields.plannedStart) lines.push("**Planned start:** " + fields.plannedStart);
  if (fields.plannedEnd) lines.push("**Planned end:** " + fields.plannedEnd);
  return lines.join("\n");
}

function planBlock(steps) {
  return steps.map((step, index) => (index + 1) + ". [" + (step.done ? "x" : " ") + "] " + oneLine(step.text)).join("\n");
}

function replaceBetween(text, startPattern, endPattern, replacement) {
  const start = text.search(startPattern);
  if (start === -1) throw new Error("package layout not found: " + startPattern);
  const rest = text.slice(start);
  const endOffset = rest.search(endPattern);
  if (endOffset === -1) throw new Error("package layout not found: " + endPattern);
  return text.slice(0, start) + replacement + rest.slice(endOffset);
}

function rewriteCreated(packageFile, fields, steps, statusLine) {
  let text = readFileSync(packageFile, "utf8");
  text = replaceBetween(text, /^\*\*Problem:\*\*/mu, /^\n## Plan$/mu, fieldBlock(fields) + "\n");
  text = replaceBetween(text, /^## Plan$/mu, /^## Status$/mu, "## Plan\n\n" + planBlock(steps) + "\n\n");
  text = replaceBetween(text, /^## Status$/mu, /^## Abnahme$/mu, "## Status\n\n" + statusLine + "\n\n");
  writeFileSync(packageFile, text, "utf8");
}

function repositoryRoot(options) {
  if (!options.root) throw new UsageError("--root REPO is required");
  const root = resolve(options.root);
  if (!existsSync(join(root, ".git"))) throw new UsageError("--root must be the root of a Git repository: " + root);
  return root;
}

function assertPackageId(value, label) {
  if (!value || !PACKAGE_ID_RE.test(value)) throw new UsageError(label + " must match " + PACKAGE_ID_RE);
  return value;
}

function bundleFiles(directory) {
  const files = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.push(full);
    }
  };
  walk(directory);
  return files;
}

function journalPath(root, packageId) {
  return join(root, ...JOURNAL_DIR, packageId + ".json");
}

function writeJournal(root, packageId, value) {
  const file = journalPath(root, packageId);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2) + "\n", "utf8");
  return file;
}

function assertRuntimeIgnored(root) {
  const check = spawnSync("git", ["-C", root, "check-ignore", "-q", ".unlazy/package-standard/undo/x.json"], { windowsHide: true });
  if (check.status !== 0) throw new UsageError(".unlazy/ must be ignored by Git before apply keeps its undo journal there");
}

function doctor(unlazy, root, packageId) {
  const result = packageCli(unlazy, root, ["doctor", "--package", packageId, "--json"]);
  let parsed = null;
  try { parsed = JSON.parse(result.stdout); } catch { /* reported below */ }
  const diagnostics = parsed?.packages?.[0]?.diagnostics ?? [{ code: "DOCTOR_OUTPUT", message: (result.stderr || result.stdout).trim() }];
  return { ok: result.status === 0 && diagnostics.length === 0, diagnostics };
}

function createBundle(unlazy, root, packageId, options, fields, steps, statusLine, extraFiles = {}) {
  const directory = join(root, "docs", "packages", packageId);
  if (existsSync(directory)) throw new UsageError("package already exists: docs/packages/" + packageId);
  const args = ["create", "--package", packageId];
  if (options["owner-request-file"]) args.push("--owner-request-file", resolve(options["owner-request-file"]));
  else if (options["owner-request"]) args.push("--owner-request", options["owner-request"]);
  if (options["owner-source"]) args.push("--owner-source", options["owner-source"]);
  const created = packageCli(unlazy, root, args);
  if (created.status !== 0) throw new UsageError("package-cli create failed: " + (created.stderr || created.stdout).trim());
  try {
    rewriteCreated(join(directory, "PACKAGE.md"), fields, steps, statusLine);
    for (const [relativePath, content] of Object.entries(extraFiles)) {
      mkdirSync(dirname(join(directory, relativePath)), { recursive: true });
      writeFileSync(join(directory, relativePath), content, { encoding: "utf8", flag: "wx" });
    }
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
  return directory;
}

function print(value, json) {
  if (json || typeof value !== "string") process.stdout.write(JSON.stringify(value, null, 2) + "\n");
  else process.stdout.write(value + "\n");
}

// --- Commands -------------------------------------------------------------------

function commandCreate(options) {
  const root = repositoryRoot(options);
  const packageId = assertPackageId(options.package, "--package");
  const unlazy = findUnlazy(options, root);
  const { fields, missing } = fieldsFrom(options);
  if (!options.step.length) missing.push("Plan (--step)");
  if (missing.length) {
    print({ ok: false, packageId, missing }, true);
    return 1;
  }
  const steps = options.step.map((text) => ({ text, done: false }));
  createBundle(unlazy, root, packageId, options, fields, steps,
    today() + " - Angelegt mit dem Skill package-standard (Standardformat).");
  const result = doctor(unlazy, root, packageId);
  print({ ok: result.ok, packageId, bundle: "docs/packages/" + packageId, diagnostics: result.diagnostics }, options.json);
  return result.ok ? 0 : 1;
}

function readSources(options) {
  const kind = options.kind;
  if (!["flat", "pfile", "todo"].includes(kind)) throw new UsageError("--kind must be flat, pfile or todo");
  const root = repositoryRoot(options);
  const doneCodes = new Set(String(options.done || "").split(",").map((item) => item.trim().toUpperCase()).filter(Boolean));
  return expandSources(options.source, kind).map((file) => {
    const label = relative(root, file).split("\\").join("/").startsWith("..") ? basename(file) : relative(root, file).split("\\").join("/");
    return kind === "flat" ? readFlat(file, label) : kind === "pfile" ? readPFile(file, label, doneCodes) : readTodo(file, label);
  });
}

function importPlan(options) {
  const root = repositoryRoot(options);
  if (Boolean(options.package) === Boolean(options.into)) throw new UsageError("import needs exactly one of --package ID (new bundle) or --into ID (existing bundle)");
  const sources = readSources(options);
  if (options.into) {
    const packageId = assertPackageId(options.into, "--into");
    const packageFile = join(root, "docs", "packages", packageId, "PACKAGE.md");
    if (!existsSync(packageFile)) throw new UsageError("--into names no bundle: docs/packages/" + packageId);
    const steps = sources.flatMap((source) => source.kind === "pfile" ? [source.asStep] : source.steps);
    return { mode: "into", root, packageId, packageFile, sources, steps, missing: steps.length ? [] : ["Plan-Schritte"] };
  }
  const packageId = assertPackageId(options.package, "--package");
  const primary = sources[0];
  const { fields, missing } = fieldsFrom(options, primary.fields);
  const steps = sources.flatMap((source) => source.steps);
  if (!steps.length) missing.push("Plan-Schritte");
  return { mode: "new", root, packageId, sources, fields, steps, missing };
}

function previewOf(plan) {
  return {
    mode: plan.mode,
    target: "docs/packages/" + plan.packageId,
    fields: plan.fields ? {
      problem: plan.fields.problem, intent: plan.fields.intent, goal: plan.fields.goal,
      scope: plan.fields.scopeIn && plan.fields.scopeOut ? "Drin: " + plan.fields.scopeIn + " Nicht drin: " + plan.fields.scopeOut : "",
      context: plan.fields.context, plannedStart: plan.fields.plannedStart, plannedEnd: plan.fields.plannedEnd,
    } : undefined,
    steps: plan.steps.map((step) => ({ text: step.text, done: step.done, source: step.source, ...(step.status ? { status: step.status } : {}) })),
    sources: plan.sources.map((source) => ({ kind: source.kind, file: source.label, title: source.title, steps: source.steps.length })),
    missing: plan.missing,
  };
}

function commandImport(options) {
  const plan = importPlan(options);
  const preview = previewOf(plan);
  if (!options.apply) {
    print({ ok: plan.missing.length === 0, applied: false, preview }, true);
    return plan.missing.length ? 1 : 0;
  }
  if (plan.missing.length) {
    print({ ok: false, applied: false, preview }, true);
    return 1;
  }
  const unlazy = findUnlazy(options, plan.root);
  assertRuntimeIgnored(plan.root);
  const journalFile = journalPath(plan.root, plan.packageId);
  if (existsSync(journalFile)) throw new UsageError("an undo journal for " + plan.packageId + " exists; run undo or remove it first");
  const statusLine = today() + " - Importiert mit dem Skill package-standard aus " +
    plan.sources.map((source) => "`" + source.label + "`").join(", ") + " (Art " + options.kind + ").";
  let journal;
  if (plan.mode === "new") {
    const extra = {};
    for (const source of plan.sources) {
      extra["design/imported-" + basename(source.file)] = readFileSync(source.file, "utf8");
    }
    const directory = createBundle(unlazy, plan.root, plan.packageId, options, plan.fields, plan.steps, statusLine, extra);
    journal = {
      schema: 1, mode: "new", packageId: plan.packageId, appliedAt: new Date().toISOString(),
      files: bundleFiles(directory).map((file) => ({ path: relative(plan.root, file).split("\\").join("/"), sha256: sha256(readFileSync(file)) })),
    };
  } else {
    const before = readFileSync(plan.packageFile, "utf8");
    const eol = before.includes("\r\n") ? "\r\n" : "\n";
    const text = before.replace(/\r\n/gu, "\n");
    const planMatch = text.match(/^## Plan\n\n([\s\S]*?)\n\n## Status\n\n([\s\S]*?)\n\n## Abnahme$/mu);
    if (!planMatch) throw new UsageError("target bundle has no standard Plan/Status layout");
    const existing = planMatch[1].split("\n").filter((line) => line.trim());
    const known = new Set(existing.map((line) => line.replace(/^\d+\. \[[ xX]\] /u, "")));
    const added = plan.steps.filter((step) => !known.has(oneLine(step.text)));
    const lines = [...existing, ...added.map((step, index) => (existing.length + index + 1) + ". [" + (step.done ? "x" : " ") + "] " + oneLine(step.text))];
    const after = text.replace(planMatch[0], "## Plan\n\n" + lines.join("\n") + "\n\n## Status\n\n" + planMatch[2] + "\n" +
      statusLine + " " + added.length + " Schritte übernommen, " + (plan.steps.length - added.length) + " schon vorhanden.\n\n## Abnahme");
    writeFileSync(plan.packageFile, eol === "\r\n" ? after.replace(/\n/gu, "\r\n") : after, "utf8");
    journal = {
      schema: 1, mode: "into", packageId: plan.packageId, appliedAt: new Date().toISOString(),
      file: relative(plan.root, plan.packageFile).split("\\").join("/"),
      before, beforeSha256: sha256(before), afterSha256: sha256(readFileSync(plan.packageFile)), added: added.length,
    };
  }
  writeJournal(plan.root, plan.packageId, journal);
  const result = doctor(unlazy, plan.root, plan.packageId);
  print({ ok: result.ok, applied: true, preview, diagnostics: result.diagnostics, undo: "package-standard.mjs undo --root <REPO> --package " + plan.packageId }, true);
  return result.ok ? 0 : 1;
}

function commandUndo(options) {
  const root = repositoryRoot(options);
  const packageId = assertPackageId(options.package, "--package");
  const file = journalPath(root, packageId);
  if (!existsSync(file)) throw new UsageError("no undo journal for " + packageId);
  const journal = JSON.parse(readFileSync(file, "utf8"));
  if (journal.mode === "new") {
    const directory = join(root, "docs", "packages", packageId);
    const current = existsSync(directory)
      ? bundleFiles(directory).map((entry) => ({ path: relative(root, entry).split("\\").join("/"), sha256: sha256(readFileSync(entry)) }))
      : [];
    if (JSON.stringify(current) !== JSON.stringify(journal.files)) {
      throw new UsageError("docs/packages/" + packageId + " changed after the import; undo refuses to remove edited work");
    }
    if (lstatSync(directory).isSymbolicLink()) throw new UsageError("bundle directory is a link");
    rmSync(directory, { recursive: true, force: true });
  } else if (journal.mode === "into") {
    const target = join(root, ...journal.file.split("/"));
    if (sha256(readFileSync(target)) !== journal.afterSha256) {
      throw new UsageError(journal.file + " changed after the import; undo refuses to overwrite edited work");
    }
    writeFileSync(target, journal.before, "utf8");
  } else throw new UsageError("unknown undo journal mode");
  rmSync(file, { force: true });
  print({ ok: true, undone: journal.mode, packageId }, options.json);
  return 0;
}

function main() {
  let parsed;
  try { parsed = parseArgs(process.argv.slice(2)); }
  catch (error) { process.stderr.write("package-standard: " + error.message + "\n"); return 2; }
  const { command, extra, options } = parsed;
  if (options.help || options.h || !command) { process.stdout.write(HELP + "\n"); return command ? 0 : 2; }
  if (extra.length) { process.stderr.write("package-standard: unexpected argument " + extra[0] + "\n"); return 2; }
  try {
    if (command === "create") return commandCreate(options);
    if (command === "import") return commandImport(options);
    if (command === "undo") return commandUndo(options);
    throw new UsageError("unknown command " + command);
  } catch (error) {
    process.stderr.write("package-standard: " + error.message + "\n");
    return 2;
  }
}

process.exitCode = main();
