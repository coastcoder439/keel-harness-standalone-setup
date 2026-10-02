#!/usr/bin/env node
// Skill package-standard: the one package tool. It creates complete work
// packages in the Keel package standard (Owner contract, requirements ->
// contract -> gate, fields, plan, depth tree, leaves with OWNS) inside the
// planning binding, converts flat packages in place, imports existing projects
// (flat package file, Fachboards P file, TODO list) with preview, apply and undo,
// and prepares a repository for packages (.unlazy/ ignored by Git). Zero
// dependencies; builds on `package-cli create`, the Unlazy migration library and
// the Harness planning bootstrap, and validates every result with `package-cli doctor`.

import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HELP = `usage: package-standard.mjs <command> --root REPO [options]

commands:
  create --package ID --session ID --problem T --intent T --goal T --scope-in T
         --scope-out T --context T --step T [--step T ...]
         --requirement T --requirement T [--requirement T ...]
         [--leaf leaf-<id>=<glob>[,<glob>] ...] [--planned-start D --planned-end D]
         [--owner-request-file FILE | --owner-request T] [--owner-source T]
         [--harness-root DIR] [--takeover]
      complete bundle in the standard format inside the planning binding of
      --session: OWNER.md (R<k> -> C<k>), PACKAGE.md (fields, plan, Abnahme,
      depth tree), GATES.md (root gate for the last requirement) and one ledger
      per --leaf (default leaf-work=docs/packages/<ID>/evidence/**); every leaf
      needs one requirement and the root one more. An untouched planning
      scaffold is taken over; an OWNER.md already written into it is kept and
      replaces the request switches. The binding stays open (file it later with
      package-bootstrap.mjs plan). Then doctor.
  import --source FILE [--source FILE ...] --kind flat|pfile|todo
         (--package ID | --into ID) [--preview | --apply]
         [field options as for create] [--owner-request-file FILE | --owner-request T]
         [--owner-source T]
         [--done P13,P14]   P files checked against commits as done (pfile only)
      --preview (default) prints the mapping as JSON and writes nothing;
      --apply writes a new bundle (--package) or appends the sources as plan
      steps to an existing bundle (--into) and keeps an undo journal.
      A single --source docs/packages/<id>.md of REPO (with --package <id> or
      without --package) is converted in place into docs/packages/<id>/; the
      old file is archived as design/imported-<id>.md. In a repository with
      .keel-harness.json the Owner request is required for this conversion.
  prepare [--apply]
      makes Git ignore .unlazy/ in REPO's .gitignore (creates it, rewrites a
      UTF-16 file as UTF-8, keeps line endings); without --apply a preview
  undo (--package ID | --prepare)
      reverts the last apply for this package (new bundle, --into, in-place
      conversion) or the last prepare if nothing changed since

options:
  --unlazy DIR        vendored Unlazy root (default: found above this skill or in REPO)
  --harness-root DIR  Harness root with .keel-harness.json (default: the installation
                      root of this tool)
  --json              print JSON only

exit codes: 0 ok; 1 preview/apply found missing fields, blockers or doctor diagnostics;
            2 usage or safety refusal.`;

const VALUE = new Set([
  "--root", "--package", "--into", "--source", "--kind", "--problem", "--intent", "--goal",
  "--scope-in", "--scope-out", "--context", "--step", "--planned-start", "--planned-end",
  "--owner-request-file", "--owner-request", "--owner-source", "--unlazy", "--done",
  "--harness-root", "--session", "--requirement", "--leaf",
]);
const REPEATABLE = new Set(["--source", "--step", "--requirement", "--leaf"]);
const FLAGS = new Set(["--preview", "--apply", "--json", "--help", "-h", "--takeover", "--prepare"]);
const PACKAGE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const LEAF_ID_RE = /^leaf-[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const JOURNAL_DIR = [".unlazy", "package-standard", "undo"];
const PREPARE_JOURNAL = ".prepare";
const TOOL_DIR = dirname(fileURLToPath(import.meta.url));

class UsageError extends Error {}

function parseArgs(argv) {
  const positional = [];
  const options = { source: [], step: [], requirement: [], leaf: [] };
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

// --- create: one complete bundle inside the planning binding --------------------

// The Harness planning bootstrap, if this installation ships it. Loaded only
// through createRequire, so the tool still runs (without a binding) in a plain
// Unlazy repository.
function bootstrapModule() {
  const file = join(TOOL_DIR, "..", "..", "..", "harness-core", "binding", "package-bootstrap.cjs");
  if (!existsSync(file)) return null;
  return createRequire(import.meta.url)("../../../harness-core/binding/package-bootstrap.cjs");
}

function harnessRootOf(options) {
  const candidate = options["harness-root"] ? resolve(options["harness-root"]) : resolve(TOOL_DIR, "..", "..", "..");
  if (!existsSync(join(candidate, ".keel-harness.json"))) {
    throw new UsageError("no .keel-harness.json in " + (options["harness-root"] ? "--harness-root" : "the installation root of this tool") +
      "; pass --harness-root DIR");
  }
  return candidate;
}

function oneLineValue(value, label) {
  if (/[\r\n]/u.test(value)) throw new UsageError(label + " must be one line");
  return oneLine(value);
}

function leavesFrom(options, packageId) {
  const values = options.leaf.length ? options.leaf : ["leaf-work=docs/packages/" + packageId + "/evidence/**"];
  const leaves = [];
  for (const value of values) {
    const at = value.indexOf("=");
    const id = at === -1 ? "" : value.slice(0, at).trim();
    if (!LEAF_ID_RE.test(id)) throw new UsageError("--leaf needs leaf-<id>=<glob>[,<glob>] with <id> of letters, digits, '.', '_' or '-': " + value);
    if (leaves.some((leaf) => leaf.id.toLowerCase() === id.toLowerCase())) throw new UsageError("duplicate --leaf " + id);
    const owns = value.slice(at + 1).split(",").map((item) => item.trim()).filter(Boolean);
    if (!owns.length || /[\r\n]/u.test(value)) throw new UsageError("--leaf " + id + " needs at least one glob");
    leaves.push({ id, owns });
  }
  return leaves;
}

// C1..C(n-1) in contiguous blocks over the leaves in --leaf order, the front
// leaves one more on a remainder; C<n> belongs to the root gate GATES.md:G1.
function distribute(requirements, leaves) {
  const share = requirements.length - 1;
  const base = Math.floor(share / leaves.length);
  const rest = share % leaves.length;
  let next = 0;
  return leaves.map((leaf, index) => {
    const count = base + (index < rest ? 1 : 0);
    const items = [];
    for (let offset = 0; offset < count; offset += 1) {
      next += 1;
      items.push({ k: next, text: requirements[next - 1] });
    }
    return { ...leaf, items };
  });
}

function ownerContract(packageId, source, request, requirementLines) {
  return "# Owner contract: " + packageId + "\n\nSchema: 1\nSource: " + source + "\nCaptured: " + today() +
    "\n\n## Original request\n\n" + request + (request.endsWith("\n") ? "" : "\n") +
    "\n## Requirements\n\n" + requirementLines.join("\n") + "\n";
}

function ownerRequest(options) {
  if (options["owner-request-file"]) return readFileSync(resolve(options["owner-request-file"]), "utf8");
  if (options["owner-request"] !== undefined) return options["owner-request"];
  return null;
}

function bundleTexts(packageId, options, fields, steps, requirements, leaves) {
  const n = requirements.length;
  const assigned = distribute(requirements, leaves);
  const owner = ownerContract(packageId, options["owner-source"] ? oneLine(options["owner-source"]) : "package-standard.mjs create",
    ownerRequest(options) ?? "", requirements.map((text, index) => "- R" + (index + 1) + " -> C" + (index + 1) + ": " + text));
  const abnahme = [
    ...assigned.flatMap((leaf) => leaf.items.map((item) => "- C" + item.k + " -> gates/" + leaf.id + ".md:L" + item.k + ": " + item.text)),
    "- C" + n + " -> GATES.md:G1: " + requirements[n - 1],
  ];
  const tree = [
    "- ROOT GATES.md <- none: " + fields.goal,
    ...assigned.map((leaf) => "- LEAF gates/" + leaf.id + ".md <- GATES.md: " + leaf.items[0].text),
  ];
  const packageText = "# Work package: " + packageId + "\n\n" + fieldBlock(fields) + "\n\n" +
    "## Plan\n\n" + planBlock(steps) + "\n\n" +
    "## Status\n\n" + today() + " - Angelegt mit package-standard.mjs create; nicht gestartet.\n\n" +
    "## Abnahme\n\n" + abnahme.join("\n") + "\n\n" +
    "## Abschluss\n\n" +
    "Coverage: " + n + "/" + n + " Owner-Anforderungen gemappt; 0/" + n + " erfüllt.\n" +
    "Fulfillment: nicht erfuellt - Paket angelegt, nicht gestartet.\n" +
    "Geprueft gegen: package-cli doctor.\n" +
    "Offen: Plan-Schritte 1 bis " + steps.length + ".\n\n" +
    "## Anhang\n\n### Depth Tree\n\n" + tree.join("\n") + "\n";
  const gatesText = "# Gates: " + packageId + "\n\n- [ ] G1: " + requirements[n - 1] + "\n  EVIDENCE: pending\n";
  const ledgers = {};
  for (const leaf of assigned) {
    ledgers[leaf.id] = "# Leaf: " + leaf.id + "\n\nOWNS: " + leaf.owns.join(", ") + "\n\nScope: " +
      leaf.items.map((item) => item.text).join(" ") + "\n\n" +
      leaf.items.map((item) => "- [ ] L" + item.k + ": " + item.text + "\n  Manuell: " + item.text +
        "; Beleg evidence/" + leaf.id + ".md\n  EVIDENCE: pending").join("\n\n") + "\n";
  }
  return { owner, packageText, gatesText, ledgers };
}

// Writes the complete bundle through package-cli create (atomic directory and
// schema check), then replaces its draft files with the generated ones.
function writeCompleteBundle(unlazy, root, packageId, options, texts, keptOwner) {
  const directory = join(root, "docs", "packages", packageId);
  if (existsSync(directory)) throw new UsageError("package already exists: docs/packages/" + packageId);
  const args = ["create", "--package", packageId, "--json"];
  if (options["owner-request-file"]) args.push("--owner-request-file", resolve(options["owner-request-file"]));
  else if (options["owner-request"] !== undefined) args.push("--owner-request", options["owner-request"]);
  if (options["owner-source"]) args.push("--owner-source", oneLine(options["owner-source"]));
  const created = packageCli(unlazy, root, args);
  let parsed = null;
  try { parsed = JSON.parse(created.stdout); } catch { /* reported below */ }
  if (created.status !== 0 || !parsed || typeof parsed !== "object") {
    rmSync(directory, { recursive: true, force: true });
    throw new UsageError("package-cli create failed: " + (created.stderr || created.stdout).trim());
  }
  try {
    writeFileSync(join(directory, "OWNER.md"), keptOwner ?? texts.owner, "utf8");
    writeFileSync(join(directory, "PACKAGE.md"), texts.packageText, "utf8");
    writeFileSync(join(directory, "GATES.md"), texts.gatesText, "utf8");
    mkdirSync(join(directory, "gates"), { recursive: true });
    for (const [leaf, text] of Object.entries(texts.ledgers)) {
      writeFileSync(join(directory, "gates", leaf + ".md"), text, { encoding: "utf8", flag: "wx" });
    }
    rmSync(join(directory, "gates", ".gitkeep"), { force: true });
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
  return directory;
}

function commandCreate(options) {
  const root = repositoryRoot(options);
  const packageId = assertPackageId(options.package, "--package");
  if (options["owner-request-file"] && options["owner-request"] !== undefined) {
    throw new UsageError("use either --owner-request-file or --owner-request, not both");
  }
  const requirements = options.requirement.map((value) => oneLineValue(value, "--requirement"));
  if (requirements.some((value) => !value)) throw new UsageError("--requirement must not be empty");
  const leaves = leavesFrom(options, packageId);
  const bootstrap = bootstrapModule();
  const harnessRoot = bootstrap ? harnessRootOf(options) : null;
  const unlazy = findUnlazy(options, root);
  const directory = join(root, "docs", "packages", packageId);
  const scaffold = bootstrap ? bootstrap.scaffoldStatus(directory, packageId) : { scaffold: false, ownerEdited: false };
  const keptOwnerScaffold = scaffold.scaffold && scaffold.ownerEdited;
  const { fields, missing } = fieldsFrom(options);
  if (!options.step.length) missing.push("Plan (--step)");
  if (ownerRequest(options) === null && !keptOwnerScaffold) missing.push("Originalauftrag (--owner-request-file oder --owner-request)");
  if (bootstrap && !String(options.session || "").trim()) missing.push("Sitzung (--session)");
  if (requirements.length < leaves.length + 1) {
    missing.push("Anforderungen: mindestens " + (leaves.length + 1) + " (je Leaf eine, dazu die Wurzel)");
  }
  if (missing.length) {
    print({ ok: false, packageId, missing }, true);
    return 1;
  }
  const steps = options.step.map((text) => ({ text, done: false }));
  const texts = bundleTexts(packageId, options, fields, steps, requirements, leaves);
  let binding = null;
  let overlaps = [];
  if (!bootstrap) {
    writeCompleteBundle(unlazy, root, packageId, options, texts, null);
  } else {
    let begun;
    try {
      begun = bootstrap.begin({
        harnessRoot, root, packageId, scope: packageId, sessionId: options.session,
        owns: leaves.flatMap((leaf) => leaf.owns), takeover: Boolean(options.takeover),
        unlazyRoot: options.unlazy ? resolve(options.unlazy) : undefined,
      });
    } catch (error) {
      throw new UsageError(error.message);
    }
    binding = { sessionId: begun.sessionId, scope: begun.scope };
    overlaps = begun.overlaps || [];
    const now = bootstrap.scaffoldStatus(directory, packageId);
    if (!now.scaffold) throw new UsageError("package already exists: docs/packages/" + packageId);
    const keptOwner = now.ownerEdited ? readFileSync(join(directory, "OWNER.md")) : null;
    const parked = join(root, "docs", "packages", "." + packageId + ".scaffold-" + randomBytes(8).toString("hex"));
    renameSync(directory, parked);
    try {
      writeCompleteBundle(unlazy, root, packageId, options, texts, keptOwner);
    } catch (error) {
      rmSync(directory, { recursive: true, force: true });
      renameSync(parked, directory);
      throw error;
    }
    rmSync(parked, { recursive: true, force: true });
  }
  const result = doctor(unlazy, root, packageId);
  print({ ok: result.ok, packageId, bundle: "docs/packages/" + packageId, diagnostics: result.diagnostics, binding, overlaps }, options.json);
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

// --- import --kind flat in place: docs/packages/<id>.md -> docs/packages/<id>/ ----

function samePath(left, right) {
  if (process.platform === "win32") return resolve(left).toLowerCase() === resolve(right).toLowerCase();
  return resolve(left) === resolve(right);
}

// The package id of an in-place conversion, or null for every other import.
function inPlaceId(options, root) {
  if (options.kind !== "flat" || options.into || options.source.length !== 1) return null;
  const source = resolve(options.source[0]);
  if (!source.toLowerCase().endsWith(".md")) return null;
  const id = basename(source).slice(0, -3);
  if (!PACKAGE_ID_RE.test(id) || !samePath(source, join(root, "docs", "packages", id + ".md"))) return null;
  if (options.package !== undefined && options.package !== id) return null;
  return id;
}

async function migrationLibrary(unlazy) {
  return import(pathToFileURL(join(unlazy, "scripts", "lib", "package-migration.mjs")).href);
}

function migrationOwnerText(packageId, options, request, contract) {
  return ownerContract(packageId, options["owner-source"] ? oneLine(options["owner-source"]) : "package-standard.mjs import",
    request, contract.map((item, index) => "- R" + (index + 1) + " -> " + item.contractId + ": " + item.criterion));
}

async function commandMigrate(options, root, packageId) {
  if (options["owner-request-file"] && options["owner-request"] !== undefined) {
    throw new UsageError("use either --owner-request-file or --owner-request, not both");
  }
  const unlazy = findUnlazy(options, root);
  const library = await migrationLibrary(unlazy);
  const request = ownerRequest(options);
  let report;
  try { report = library.dryRunLegacyMigration({ root, packageId }); }
  catch (error) {
    if (error.exitCode === 1) { print({ ok: false, applied: false, error: error.message }, true); return 1; }
    throw new UsageError(error.message);
  }
  const missing = existsSync(join(root, ".keel-harness.json")) && request === null ? ["Originalauftrag (OWNER.md)"] : [];
  const preview = {
    mode: "migrate", source: report.source, target: report.target, plan: report.semantic.plan,
    contract: report.semantic.contract, blockers: report.blockers, warnings: report.warnings, missing,
  };
  const blocked = report.blockers.length > 0 || missing.length > 0;
  if (!options.apply || blocked) {
    print({ ok: !blocked, applied: false, preview }, true);
    return blocked ? 1 : 0;
  }
  assertRuntimeIgnored(root);
  const journalFile = journalPath(root, packageId);
  if (existsSync(journalFile)) throw new UsageError("an undo journal for " + packageId + " exists; run undo or remove it first");
  const sourceFile = join(root, "docs", "packages", packageId + ".md");
  const bytes = readFileSync(sourceFile);
  const journal = {
    schema: 1, mode: "migrate", packageId, appliedAt: new Date().toISOString(),
    source: "docs/packages/" + packageId + ".md", sourceBase64: bytes.toString("base64"), sourceSha256: sha256(bytes),
  };
  writeJournal(root, packageId, journal);
  const directory = join(root, "docs", "packages", packageId);
  try {
    library.applyLegacyMigration({ root, packageId,
      ...(request === null ? {} : { ownerText: migrationOwnerText(packageId, options, request, report.semantic.contract) }) });
  } catch (error) {
    if (!existsSync(directory)) rmSync(journalFile, { force: true });
    if (error.exitCode === 1) { print({ ok: false, applied: false, preview, error: error.message }, true); return 1; }
    throw new UsageError(error.message);
  }
  mkdirSync(join(directory, "design"), { recursive: true });
  writeFileSync(join(directory, "design", "imported-" + packageId + ".md"), bytes, { flag: "wx" });
  journal.files = bundleFiles(directory).map((file) => ({ path: relative(root, file).split("\\").join("/"), sha256: sha256(readFileSync(file)) }));
  writeJournal(root, packageId, journal);
  const result = doctor(unlazy, root, packageId);
  print({ ok: result.ok, applied: true, preview, diagnostics: result.diagnostics,
    undo: "package-standard.mjs undo --root <REPO> --package " + packageId }, true);
  return result.ok ? 0 : 1;
}

async function commandImport(options) {
  if (options.kind === "flat") {
    const root = repositoryRoot(options);
    const id = inPlaceId(options, root);
    if (id) return commandMigrate(options, root, id);
  }
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

// --- prepare: .unlazy/ ignored by Git ----------------------------------------------

const UNLAZY_LINE_RE = /^\/?\.unlazy\/$/u;

function gitIgnoresRuntime(root) {
  return spawnSync("git", ["-C", root, "check-ignore", "-q", ".unlazy/probe"], { windowsHide: true }).status === 0;
}

function decodeIgnoreFile(bytes) {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return { encoding: "utf-16le", text: bytes.subarray(2).toString("utf16le") };
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    const swapped = Buffer.from(bytes.subarray(2));
    swapped.swap16();
    return { encoding: "utf-16be", text: swapped.toString("utf16le") };
  }
  return { encoding: "utf-8", text: bytes.toString("utf8") };
}

function measureIgnore(root) {
  const file = join(root, ".gitignore");
  if (!existsSync(file)) return { file, before: null, state: { gitignore: "missing", encoding: null, eol: null, line: false, ignored: gitIgnoresRuntime(root) } };
  const before = readFileSync(file);
  const { encoding, text } = decodeIgnoreFile(before);
  const line = text.replace(/^\uFEFF/u, "").split(/\r?\n/u).some((item) => UNLAZY_LINE_RE.test(item.trim()));
  return { file, before, text, state: { gitignore: "present", encoding, eol: text.includes("\r\n") ? "CRLF" : "LF", line, ignored: gitIgnoresRuntime(root) } };
}

function commandPrepare(options) {
  const root = repositoryRoot(options);
  const measured = measureIgnore(root);
  const { state } = measured;
  const actions = [];
  let after = null;
  if (state.gitignore === "missing") {
    actions.push("create .gitignore with .unlazy/");
    after = ".unlazy/\n";
  } else {
    let text = measured.text;
    if (state.encoding !== "utf-8") actions.push("rewrite .gitignore from " + state.encoding.toUpperCase() + " as UTF-8 without BOM");
    if (!state.line) {
      const eol = state.eol === "CRLF" ? "\r\n" : "\n";
      if (text.length && !text.endsWith("\n")) text += eol;
      text += ".unlazy/" + eol;
      actions.push("append .unlazy/ to .gitignore");
    }
    if (actions.length) after = text;
  }
  if (!options.apply) {
    const ok = actions.length > 0 || state.ignored;
    print({ ok, applied: false, state, actions }, true);
    return ok ? 0 : 1;
  }
  if (!actions.length) {
    print({ ok: state.ignored, applied: false, state, actions }, true);
    return state.ignored ? 0 : 1;
  }
  const journalFile = journalPath(root, PREPARE_JOURNAL);
  if (existsSync(journalFile)) throw new UsageError("a prepare undo journal exists; run undo --prepare or remove it first");
  writeFileSync(measured.file, after, "utf8");
  const ignored = gitIgnoresRuntime(root);
  if (!ignored) {
    if (measured.before === null) rmSync(measured.file, { force: true });
    else writeFileSync(measured.file, measured.before);
    print({ ok: false, applied: false, state, actions, error: "git check-ignore still does not ignore .unlazy/; .gitignore restored" }, true);
    return 1;
  }
  writeJournal(root, PREPARE_JOURNAL, {
    schema: 1, mode: "prepare", appliedAt: new Date().toISOString(), file: ".gitignore",
    before: measured.before === null ? "absent" : measured.before.toString("base64"),
    afterSha256: sha256(readFileSync(measured.file)),
  });
  print({ ok: true, applied: true, state: { ...state, ignored }, actions,
    undo: "package-standard.mjs undo --root <REPO> --prepare" }, true);
  return 0;
}

function currentFiles(root, directory) {
  return existsSync(directory)
    ? bundleFiles(directory).map((entry) => ({ path: relative(root, entry).split("\\").join("/"), sha256: sha256(readFileSync(entry)) }))
    : [];
}

function commandUndo(options) {
  const root = repositoryRoot(options);
  if (Boolean(options.package) === Boolean(options.prepare)) throw new UsageError("undo needs exactly one of --package ID or --prepare");
  const packageId = options.prepare ? PREPARE_JOURNAL : assertPackageId(options.package, "--package");
  const file = journalPath(root, packageId);
  if (!existsSync(file)) throw new UsageError(options.prepare ? "no prepare undo journal" : "no undo journal for " + packageId);
  const journal = JSON.parse(readFileSync(file, "utf8"));
  if (Boolean(options.prepare) !== (journal.mode === "prepare")) throw new UsageError("undo journal mode does not match the request");
  if (journal.mode === "new" || journal.mode === "migrate") {
    const directory = join(root, "docs", "packages", packageId);
    if (JSON.stringify(currentFiles(root, directory)) !== JSON.stringify(journal.files)) {
      throw new UsageError("docs/packages/" + packageId + " changed after the import; undo refuses to remove edited work");
    }
    if (lstatSync(directory).isSymbolicLink()) throw new UsageError("bundle directory is a link");
    let restored = null;
    if (journal.mode === "migrate") {
      if (existsSync(join(root, ...journal.source.split("/")))) {
        throw new UsageError(journal.source + " exists again; undo refuses to overwrite it");
      }
      restored = Buffer.from(journal.sourceBase64, "base64");
      if (sha256(restored) !== journal.sourceSha256) throw new UsageError("undo journal source bytes do not match their sha256");
    }
    rmSync(directory, { recursive: true, force: true });
    if (restored) writeFileSync(join(root, ...journal.source.split("/")), restored, { flag: "wx" });
  } else if (journal.mode === "prepare") {
    const target = join(root, ".gitignore");
    if (!existsSync(target) || sha256(readFileSync(target)) !== journal.afterSha256) {
      throw new UsageError(".gitignore changed after prepare; undo refuses to overwrite edited work");
    }
    if (journal.before === "absent") rmSync(target, { force: true });
    else writeFileSync(target, Buffer.from(journal.before, "base64"));
  } else if (journal.mode === "into") {
    const target = join(root, ...journal.file.split("/"));
    if (sha256(readFileSync(target)) !== journal.afterSha256) {
      throw new UsageError(journal.file + " changed after the import; undo refuses to overwrite edited work");
    }
    writeFileSync(target, journal.before, "utf8");
  } else throw new UsageError("unknown undo journal mode");
  rmSync(file, { force: true });
  print({ ok: true, undone: journal.mode, ...(journal.mode === "prepare" ? {} : { packageId }) }, options.json);
  return 0;
}

async function main() {
  let parsed;
  try { parsed = parseArgs(process.argv.slice(2)); }
  catch (error) { process.stderr.write("package-standard: " + error.message + "\n"); return 2; }
  const { command, extra, options } = parsed;
  if (options.help || options.h || !command) { process.stdout.write(HELP + "\n"); return command ? 0 : 2; }
  if (extra.length) { process.stderr.write("package-standard: unexpected argument " + extra[0] + "\n"); return 2; }
  try {
    if (command === "create") return commandCreate(options);
    if (command === "import") return await commandImport(options);
    if (command === "prepare") return commandPrepare(options);
    if (command === "undo") return commandUndo(options);
    throw new UsageError("unknown command " + command);
  } catch (error) {
    process.stderr.write("package-standard: " + error.message + "\n");
    return 2;
  }
}

process.exitCode = await main();
