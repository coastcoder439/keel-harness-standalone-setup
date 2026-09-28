import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { dispatchStatus } from "./dispatch.mjs";
import { gateState, globsOverlap, parseGates } from "./gates.mjs";

const require = createRequire(import.meta.url);
const ownerContract = require("./owner-contract.cjs");
const packageContext = require("./package-context.cjs");
const { inspectOwnerContract } = ownerContract;

export const PACKAGE_SCHEMA_VERSION = 1;
export const PACKAGE_STATUSES = Object.freeze([
  "draft",
  "active",
  "blocked",
  "handoff",
  "closable",
  "closed",
  "invalid",
]);
export const LIFECYCLE_GOVERNANCE_SCHEMA_VERSION = 1;
export const LIFECYCLE_GOVERNANCE_BOUNDARIES = Object.freeze([
  "activate",
  "dispatch",
  "return",
  "integration",
  "close",
]);

const REQUIRED_SECTIONS = ["Plan", "Status", "Abnahme", "Abschluss", "Anhang"];
const PLAN_RE = /^(\d+)\. \[([ xX])\] (\S.*)$/;
const CHECKBOX_RE = /^\s*(?:[-*]|\d+\.)\s+\[[ xX]\]/;
const CONTRACT_RE = /^- (C\d+) -> (GATES\.md|gates\/[A-Za-z0-9][A-Za-z0-9._-]*\.md):([A-Za-z0-9][A-Za-z0-9._-]{0,63}): (\S.*)$/;
const FORBIDDEN_GATE_RE = /^\s*(CHECK|EXPECT|EVIDENCE|CWD|OWNS|ABANDON):/;
const DEPTH_TREE_RE = /^- (ROOT|LEAF|NODE) (GATES\.md|gates\/[A-Za-z0-9][A-Za-z0-9._-]*\.md) <- (none|(?:GATES\.md|gates\/[A-Za-z0-9][A-Za-z0-9._-]*\.md)(?:, (?:GATES\.md|gates\/[A-Za-z0-9][A-Za-z0-9._-]*\.md))*): (\S.*)$/;

const digest = (value) => "sha256:" + createHash("sha256").update(value).digest("hex");
const slash = (value) => value.replaceAll("\\", "/");

function addDiagnostic(diagnostics, code, message, file = "PACKAGE.md") {
  diagnostics.push({ code, file, message });
}

function splitSections(text, diagnostics) {
  const matches = [...text.matchAll(/^## (.+)$/gm)];
  const names = matches.map((match) => match[1].trim());
  if (names.length !== REQUIRED_SECTIONS.length || names.some((name, index) => name !== REQUIRED_SECTIONS[index])) {
    addDiagnostic(
      diagnostics,
      "PACKAGE_SECTION_ORDER",
      "level-two sections must be exactly: " + REQUIRED_SECTIONS.join(" -> ") + "; got: " + (names.join(" -> ") || "none"),
    );
  }
  const sections = Object.create(null);
  for (let index = 0; index < matches.length; index++) {
    const name = matches[index][1].trim();
    const start = matches[index].index + matches[index][0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index : text.length;
    if (sections[name] === undefined) sections[name] = text.slice(start, end).replace(/^\r?\n/, "");
  }
  const preambleEnd = matches.length ? matches[0].index : text.length;
  return { preamble: text.slice(0, preambleEnd), sections };
}

function parsePreamble(preamble, packageId, diagnostics, options = {}) {
  const titles = [...preamble.matchAll(/^# Work package: (\S.*)$/gm)];
  if (titles.length !== 1) addDiagnostic(diagnostics, "PACKAGE_TITLE", "exactly one '# Work package: <packageId>' title is required");
  else if (titles[0][1].trim() !== packageId) {
    addDiagnostic(diagnostics, "PACKAGE_TITLE_ID", "title packageId does not match bundle directory " + packageId);
  }

  const fields = Object.create(null);
  const positions = [];
  for (const name of ["Problem", "Intent", "Goal"]) {
    const matches = [...preamble.matchAll(new RegExp("^\\*\\*" + name + ":\\*\\*\\s*(.*)$", "gm"))];
    if (matches.length !== 1 || !matches[0][1].trim()) {
      addDiagnostic(diagnostics, "PACKAGE_PIG_" + name.toUpperCase(), "exactly one non-empty " + name + " field is required");
    } else {
      fields[name.toLowerCase()] = matches[0][1].trim();
      positions.push(matches[0].index);
    }
  }
  if (positions.length === 3 && !(positions[0] < positions[1] && positions[1] < positions[2])) {
    addDiagnostic(diagnostics, "PACKAGE_PIG_ORDER", "Problem, Intent, and Goal must appear in that order");
  }
  parseStandardFields(preamble, fields, positions, Boolean(options.standardFormat), diagnostics);
  return fields;
}

// Keel package standard (Scope, Context, planned dates). The fields are always
// read so every consumer sees one parse; Scope and Context are required only
// when the repository opts in through .keel-harness.json. Planned dates are
// optional everywhere but validated wherever they appear.
const STANDARD_FIELDS = [
  { label: "Scope", key: "scope", code: "SCOPE" },
  { label: "Context", key: "context", code: "CONTEXT" },
  { label: "Planned start", key: "plannedStart", code: "PLANNED_START" },
  { label: "Planned end", key: "plannedEnd", code: "PLANNED_END" },
];
const SCOPE_FORM_RE = /^Drin:\s*(\S.*?)\s+Nicht drin:\s*(\S.*)$/u;
const PLANNED_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/u;

function validCalendarDate(value) {
  const match = value.match(PLANNED_DATE_RE);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() === Number(match[2]) - 1 &&
    date.getUTCDate() === Number(match[3]);
}

function parseStandardFields(preamble, fields, pigPositions, required, diagnostics) {
  const found = Object.create(null);
  for (const field of STANDARD_FIELDS) {
    const matches = [...preamble.matchAll(new RegExp("^\\*\\*" + field.label + ":\\*\\*[ \\t]*(.*)$", "gm"))];
    const value = matches.length === 1 ? matches[0][1].trim() : "";
    const mandatory = required && (field.key === "scope" || field.key === "context");
    if (matches.length > 1) {
      addDiagnostic(diagnostics, "PACKAGE_" + field.code, "at most one " + field.label + " field is allowed");
      continue;
    }
    if (!value) {
      if (mandatory || matches.length === 1) {
        addDiagnostic(diagnostics, "PACKAGE_" + field.code, "exactly one non-empty " + field.label + " field is required" +
          (mandatory ? " by the package standard" : " when the field is present"));
      }
      continue;
    }
    fields[field.key] = value;
    found[field.key] = matches[0].index;
  }
  if (fields.scope && required && !SCOPE_FORM_RE.test(fields.scope)) {
    addDiagnostic(diagnostics, "PACKAGE_SCOPE_FORM", "Scope must read 'Drin: <what belongs> Nicht drin: <what is excluded>' with both parts filled");
  }
  for (const key of ["plannedStart", "plannedEnd"]) {
    if (fields[key] && !validCalendarDate(fields[key])) {
      addDiagnostic(diagnostics, key === "plannedStart" ? "PACKAGE_PLANNED_START" : "PACKAGE_PLANNED_END",
        (key === "plannedStart" ? "Planned start" : "Planned end") + " must be a real calendar date YYYY-MM-DD");
    }
  }
  if (fields.plannedStart && fields.plannedEnd && validCalendarDate(fields.plannedStart) &&
      validCalendarDate(fields.plannedEnd) && fields.plannedStart > fields.plannedEnd) {
    addDiagnostic(diagnostics, "PACKAGE_PLANNED_RANGE", "Planned start must not be after Planned end");
  }
  if (required) {
    // One line per field: every reader takes the field from its own line, so a
    // wrapped continuation line would silently drop out of Goal or Scope.
    const lines = preamble.split(/\r?\n/u);
    for (let index = 1; index < lines.length; index += 1) {
      const line = lines[index];
      if (/^\*\*[^*]+:\*\*/u.test(lines[index - 1]) && line.trim() && !/^\*\*[^*]+:\*\*/u.test(line) &&
          !/^[#>]/u.test(line)) {
        addDiagnostic(diagnostics, "PACKAGE_FIELD_CONTINUATION",
          "each package field must stay on one line; join the continuation line: " + line.trim().slice(0, 80));
      }
    }
    const sequence = [...pigPositions];
    if (pigPositions.length === 3) {
      for (const key of ["scope", "context", "plannedStart", "plannedEnd"]) {
        if (found[key] !== undefined) sequence.push(found[key]);
      }
      if (sequence.some((position, index) => index > 0 && position <= sequence[index - 1])) {
        addDiagnostic(diagnostics, "PACKAGE_FIELD_ORDER",
          "package fields must appear in the order Problem, Intent, Goal, Scope, Context, Planned start, Planned end");
      }
    }
  }
}

function parsePlan(section = "", diagnostics) {
  const steps = [];
  for (const [offset, line] of section.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    const match = line.match(PLAN_RE);
    if (!match) {
      addDiagnostic(diagnostics, "PACKAGE_PLAN_LINE", "Plan line " + (offset + 1) + " must be a numbered checkbox: " + line);
      continue;
    }
    const number = Number(match[1]);
    const expected = steps.length + 1;
    if (number !== expected) {
      addDiagnostic(diagnostics, "PACKAGE_PLAN_NUMBER", "Plan step " + number + " must be numbered " + expected);
    }
    steps.push({ number, done: match[2].toLowerCase() === "x", text: match[3] });
  }
  if (!steps.length) addDiagnostic(diagnostics, "PACKAGE_PLAN_EMPTY", "Plan must contain at least one numbered step");
  return steps;
}

function parseContract(section = "", diagnostics) {
  const mappings = [];
  const nonBlank = section.split(/\r?\n/).map((line) => line.trimEnd()).filter((line) => line.trim());
  for (const line of nonBlank) {
    const match = line.match(CONTRACT_RE);
    if (!match) {
      addDiagnostic(
        diagnostics,
        "PACKAGE_CONTRACT_LINE",
        "Abnahme lines must match '- C<n> -> <ledger.md>:<gateId>: <criterion>': " + line,
      );
      continue;
    }
    mappings.push({ contractId: match[1], ledger: match[2], gateId: match[3], criterion: match[4] });
  }
  if (!nonBlank.length) addDiagnostic(diagnostics, "PACKAGE_CONTRACT_EMPTY", "Abnahme must contain at least one contract mapping");
  const ids = new Set();
  const gateKeys = new Set();
  for (let index = 0; index < mappings.length; index++) {
    const mapping = mappings[index];
    const expected = "C" + (index + 1);
    if (mapping.contractId !== expected) {
      addDiagnostic(diagnostics, "PACKAGE_CONTRACT_NUMBER", mapping.contractId + " must be numbered " + expected);
    }
    if (ids.has(mapping.contractId)) addDiagnostic(diagnostics, "PACKAGE_CONTRACT_DUPLICATE", "duplicate contract id " + mapping.contractId);
    ids.add(mapping.contractId);
    const key = mapping.ledger + ":" + mapping.gateId;
    if (gateKeys.has(key)) addDiagnostic(diagnostics, "PACKAGE_CONTRACT_OVERLAP", "gate mapped more than once: " + key);
    gateKeys.add(key);
  }
  return { mappings, required: nonBlank.length };
}

function parseConclusion(section = "", diagnostics) {
  const result = Object.create(null);
  for (const name of ["Coverage", "Fulfillment", "Geprueft gegen", "Offen"]) {
    const matches = [...section.matchAll(new RegExp("^" + name.replace(" ", "\\s+") + ":\\s*(.*)$", "gmi"))];
    if (matches.length !== 1 || !matches[0][1].trim()) {
      addDiagnostic(diagnostics, "PACKAGE_CONCLUSION_" + name.toUpperCase().replaceAll(" ", "_"), "exactly one non-empty " + name + " field is required");
    } else result[name.toLowerCase().replaceAll(" ", "_")] = matches[0][1].trim();
  }
  return result;
}

function inspectBundleLayout(target, diagnostics) {
  const rootLedger = join(target.packageDir, "GATES.md");
  if (!existsSync(rootLedger)) addDiagnostic(diagnostics, "PACKAGE_GATES_ROOT", "bundle requires GATES.md", "GATES.md");
  else {
    const info = lstatSync(rootLedger);
    if (info.isSymbolicLink() || !info.isFile()) addDiagnostic(diagnostics, "PACKAGE_GATES_ROOT_TYPE", "GATES.md must be a regular file", "GATES.md");
  }
  const gatesDir = join(target.packageDir, "gates");
  if (!existsSync(gatesDir)) {
    addDiagnostic(diagnostics, "PACKAGE_GATES_DIRECTORY", "bundle requires gates/", "gates/");
    return;
  }
  const dirInfo = lstatSync(gatesDir);
  if (dirInfo.isSymbolicLink() || !dirInfo.isDirectory()) {
    addDiagnostic(diagnostics, "PACKAGE_GATES_DIRECTORY_TYPE", "gates/ must be a real directory", "gates/");
    return;
  }
  const entries = readdirSync(gatesDir, { withFileTypes: true });
  const markdown = entries.filter((entry) => entry.name.endsWith(".md"));
  for (const entry of entries) {
    if (entry.name === ".gitkeep") continue;
    if (!entry.name.endsWith(".md") || !entry.isFile() || entry.isSymbolicLink()) {
      addDiagnostic(diagnostics, "PACKAGE_GATES_SIDECAR", "gates/ may contain only immediate regular .md sidecars", "gates/" + entry.name);
    }
  }
  const hasGitkeep = entries.some((entry) => entry.name === ".gitkeep");
  if (!markdown.length && !hasGitkeep) addDiagnostic(diagnostics, "PACKAGE_GATES_GITKEEP", "solo bundle requires gates/.gitkeep", "gates/.gitkeep");
  if (markdown.length && hasGitkeep) addDiagnostic(diagnostics, "PACKAGE_GATES_REDUNDANT_GITKEEP", "remove gates/.gitkeep when sidecars exist", "gates/.gitkeep");
}

function inspectGateLedgers(target, diagnostics) {
  const gates = [];
  const ownership = [];
  for (const file of target.gateFiles) {
    const ledger = slash(relative(target.packageDir, file));
    let doc;
    try { doc = parseGates(readFileSync(file, "utf8")); }
    catch (error) {
      addDiagnostic(diagnostics, "PACKAGE_GATE_READ", error.message, ledger);
      continue;
    }
    for (const error of doc.errors) addDiagnostic(diagnostics, "PACKAGE_GATE_PARSE", error, ledger);
    for (const glob of doc.owns) ownership.push({ ledger, glob });
    for (const gate of doc.gates) {
      gates.push({
        ledger,
        gateId: gate.id,
        key: ledger + ":" + gate.id,
        state: gateState(gate, doc.abandoned),
        runnable: Boolean(gate.check && gate.expect),
        check: gate.check,
        expect: gate.expect,
        evidence: gate.evidence,
      });
    }
  }
  for (let left = 0; left < ownership.length; left++) {
    for (let right = left + 1; right < ownership.length; right++) {
      const a = ownership[left];
      const b = ownership[right];
      if (globsOverlap(a.glob, b.glob)) {
        addDiagnostic(
          diagnostics,
          "PACKAGE_OWNERSHIP_OVERLAP",
          "overlapping OWNS declarations: " + a.ledger + "=" + a.glob + " and " + b.ledger + "=" + b.glob,
          a.ledger,
        );
      }
    }
  }
  return { gates, ownership };
}

function inspectDepthTree(parsed, target, diagnostics) {
  const ledgers = target.gateFiles.map((file) => slash(relative(target.packageDir, file)));
  const fanout = ledgers.length > 1;
  const attachment = parsed.sections.Anhang || "";
  const headings = [...attachment.matchAll(/^### Depth Tree\s*$/gm)];
  if (!fanout && headings.length === 0) return { defined: false, ledgers: ledgers.length, entries: [] };
  if (headings.length !== 1) {
    addDiagnostic(
      diagnostics,
      "PACKAGE_DEPTH_TREE_COUNT",
      fanout
        ? "fan-out requires exactly one '### Depth Tree' contract in PACKAGE.md before dispatch"
        : "PACKAGE.md may contain at most one '### Depth Tree' contract",
    );
    return { defined: false, ledgers: ledgers.length, entries: [] };
  }

  const start = headings[0].index + headings[0][0].length;
  const rest = attachment.slice(start).replace(/^\r?\n/, "");
  const nextHeading = rest.search(/^### /m);
  const block = (nextHeading === -1 ? rest : rest.slice(0, nextHeading)).trim();
  const lines = block.split(/\r?\n/).filter((line) => line.trim());
  const entries = [];
  for (const line of lines) {
    const match = line.match(DEPTH_TREE_RE);
    if (!match) {
      addDiagnostic(
        diagnostics,
        "PACKAGE_DEPTH_TREE_LINE",
        "Depth Tree lines must match '- <ROOT|LEAF|NODE> <ledger> <- <dependencies|none>: <outcome>': " + line,
      );
      continue;
    }
    entries.push({
      role: match[1],
      ledger: match[2],
      needs: match[3] === "none" ? [] : match[3].split(", "),
      outcome: match[4],
    });
  }

  const known = new Set(ledgers);
  const byLedger = new Map();
  for (const entry of entries) {
    if (byLedger.has(entry.ledger)) {
      addDiagnostic(diagnostics, "PACKAGE_DEPTH_TREE_DUPLICATE", "Depth Tree declares ledger more than once: " + entry.ledger);
    } else byLedger.set(entry.ledger, entry);
    if (!known.has(entry.ledger)) {
      addDiagnostic(diagnostics, "PACKAGE_DEPTH_TREE_UNKNOWN_LEDGER", "Depth Tree declares unknown ledger " + entry.ledger);
    }
    const expectedRole = entry.ledger === "GATES.md"
      ? "ROOT"
      : entry.ledger.startsWith("gates/leaf-") ? "LEAF"
        : entry.ledger.startsWith("gates/node-") ? "NODE" : null;
    if (!expectedRole) {
      addDiagnostic(diagnostics, "PACKAGE_DEPTH_TREE_LEDGER_NAME", "fan-out sidecar must be named gates/leaf-*.md or gates/node-*.md: " + entry.ledger);
    } else if (entry.role !== expectedRole) {
      addDiagnostic(diagnostics, "PACKAGE_DEPTH_TREE_ROLE", entry.ledger + " must have role " + expectedRole + ", not " + entry.role);
    }
    if (entry.ledger === "GATES.md" && entry.needs.length) {
      addDiagnostic(diagnostics, "PACKAGE_DEPTH_TREE_ROOT_NEEDS", "GATES.md is the root and must declare '<- none'");
    }
    if (entry.ledger !== "GATES.md" && entry.needs.length === 0) {
      addDiagnostic(diagnostics, "PACKAGE_DEPTH_TREE_ORPHAN", entry.ledger + " must depend on a prior root, leaf, or node ledger");
    }
    for (const dependency of entry.needs) {
      if (!known.has(dependency)) {
        addDiagnostic(diagnostics, "PACKAGE_DEPTH_TREE_UNKNOWN_DEPENDENCY", entry.ledger + " depends on unknown ledger " + dependency);
      }
      if (dependency === entry.ledger) {
        addDiagnostic(diagnostics, "PACKAGE_DEPTH_TREE_SELF_DEPENDENCY", entry.ledger + " depends on itself");
      }
    }
  }
  for (const ledger of ledgers) {
    if (!byLedger.has(ledger)) {
      addDiagnostic(diagnostics, "PACKAGE_DEPTH_TREE_UNMAPPED_LEDGER", "Depth Tree does not declare ledger " + ledger);
    }
  }

  const visitState = new Map();
  let cycleReported = false;
  const visit = (ledger) => {
    if (visitState.get(ledger) === "done") return;
    if (visitState.get(ledger) === "visiting") {
      if (!cycleReported) addDiagnostic(diagnostics, "PACKAGE_DEPTH_TREE_CYCLE", "Depth Tree dependencies must be acyclic");
      cycleReported = true;
      return;
    }
    visitState.set(ledger, "visiting");
    for (const dependency of byLedger.get(ledger)?.needs || []) if (known.has(dependency)) visit(dependency);
    visitState.set(ledger, "done");
  };
  for (const ledger of ledgers) visit(ledger);

  const reachesRoot = (ledger, visiting = new Set()) => {
    if (ledger === "GATES.md") return true;
    if (visiting.has(ledger)) return false;
    const entry = byLedger.get(ledger);
    if (!entry || !entry.needs.length) return false;
    const next = new Set(visiting);
    next.add(ledger);
    return entry.needs.some((dependency) => reachesRoot(dependency, next));
  };
  for (const ledger of ledgers.filter((item) => item !== "GATES.md")) {
    if (!reachesRoot(ledger)) {
      addDiagnostic(diagnostics, "PACKAGE_DEPTH_TREE_DISCONNECTED", ledger + " is cyclic or disconnected from GATES.md");
    }
  }
  return { defined: true, ledgers: ledgers.length, entries };
}

function contractCoverage(contract, gates, diagnostics) {
  const known = new Set(gates.map((gate) => gate.key));
  const mapped = new Set();
  let covered = 0;
  for (const mapping of contract.mappings) {
    const key = mapping.ledger + ":" + mapping.gateId;
    if (!known.has(key)) {
      addDiagnostic(diagnostics, "PACKAGE_CONTRACT_UNKNOWN_GATE", mapping.contractId + " maps unknown gate " + key, "PACKAGE.md");
    } else if (!mapped.has(key)) {
      covered += 1;
      mapped.add(key);
    }
  }
  for (const key of known) {
    if (!mapped.has(key)) addDiagnostic(diagnostics, "PACKAGE_CONTRACT_UNMAPPED_GATE", "gate has no contract mapping: " + key, "PACKAGE.md");
  }
  return { covered, required: contract.required };
}

function dispatchDimension(target) {
  if (!target.scope) return { state: "idle", unfinished: 0, diagnostics: [] };
  const status = dispatchStatus(target.repoRoot, target.scope, target.packageId);
  const unfinished = status.blocking.length + status.abandoned.length;
  const state = status.errors.length ? "invalid" : status.abandoned.length ? "handoff" : status.blocking.length ? "active" : "idle";
  return { state, unfinished, diagnostics: status.errors, blocking: status.blocking, abandoned: status.abandoned };
}

function governanceDiagnostic(code, message, file = "PACKAGE.md") {
  return { code, file, message };
}

function regularFileRecord(repoRoot, file, label) {
  const info = lstatSync(file);
  if (info.isSymbolicLink() || !info.isFile() || (typeof info.nlink === "number" && info.nlink !== 1)) {
    throw new Error(label + " must be a single-link regular file: " + file);
  }
  const bytes = readFileSync(file);
  return {
    path: slash(relative(repoRoot, file)),
    bytes: bytes.length,
    digest: digest(bytes),
  };
}

function fingerprintRecords(records) {
  return digest(records.map((entry) => entry.path + "\0" + entry.digest + "\n").join(""));
}

function recursiveFiles(directory, predicate = () => true) {
  if (!existsSync(directory)) return [];
  const files = [];
  const walk = (current) => {
    const entries = readdirSync(current, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && predicate(full, entry.name)) files.push(full);
    }
  };
  walk(directory);
  return files;
}

export function lifecycleRuleSnapshot(repoRoot) {
  const root = packageContext.assertRepositoryRoot(repoRoot);
  const diagnostics = [];
  const exact = [
    "AGENTS.md",
    "CLAUDE.md",
    ".claude/settings.json",
    ".codex/hooks.json",
    ".codex/config.toml",
  ];
  const files = [];
  for (const relativeFile of exact) {
    const file = join(root, ...relativeFile.split("/"));
    if (!existsSync(file)) {
      diagnostics.push(governanceDiagnostic(
        "LIFECYCLE_RULE_SOURCE_MISSING",
        "active rule source is missing: " + relativeFile,
        relativeFile,
      ));
    } else files.push(file);
  }
  files.push(...recursiveFiles(join(root, ".claude", "rules"), (file) => file.endsWith(".md")));
  const unique = [...new Set(files.map((file) => resolve(file)))].sort((left, right) => left.localeCompare(right, "en"));
  const records = [];
  for (const file of unique) {
    try { records.push(regularFileRecord(root, file, "active rule source")); }
    catch (error) {
      diagnostics.push(governanceDiagnostic(
        "LIFECYCLE_RULE_SOURCE_TYPE",
        error.message,
        slash(relative(root, file)),
      ));
    }
  }
  const agents = records.find((entry) => entry.path === "AGENTS.md");
  const claude = records.find((entry) => entry.path === "CLAUDE.md");
  if (agents && claude && agents.digest !== claude.digest) {
    diagnostics.push(governanceDiagnostic(
      "LIFECYCLE_RULE_HOST_DRIFT",
      "AGENTS.md and CLAUDE.md must remain byte-identical",
      "AGENTS.md",
    ));
  }
  if (!records.length) {
    diagnostics.push(governanceDiagnostic("LIFECYCLE_RULES_EMPTY", "no active rule sources were measured"));
  }
  return {
    schemaVersion: LIFECYCLE_GOVERNANCE_SCHEMA_VERSION,
    files: records,
    count: records.length,
    fingerprint: fingerprintRecords(records),
    diagnostics,
  };
}

export function lifecycleBundleSnapshot(target) {
  const files = [target.packageFile, ...target.gateFiles];
  const ownerFile = join(target.packageDir, "OWNER.md");
  if (existsSync(ownerFile)) files.push(ownerFile);
  const records = [...new Set(files.map((file) => resolve(file)))]
    .map((file) => regularFileRecord(target.repoRoot, file, "lifecycle contract source"))
    .sort((left, right) => left.path.localeCompare(right.path, "en"));
  return {
    schemaVersion: LIFECYCLE_GOVERNANCE_SCHEMA_VERSION,
    files: records,
    count: records.length,
    fingerprint: fingerprintRecords(records),
  };
}

function placementDiagnostics(target) {
  const diagnostics = [];
  let repoRoot;
  try { repoRoot = packageContext.assertRepositoryRoot(target.repoRoot); }
  catch (error) {
    return [governanceDiagnostic("LIFECYCLE_PLACEMENT_REPOSITORY", error.message)];
  }
  const invalidId = packageContext.validatePackageId(target.packageId);
  if (invalidId) diagnostics.push(governanceDiagnostic("LIFECYCLE_PLACEMENT_PACKAGE_ID", invalidId));
  const expectedDir = join(repoRoot, "docs", "packages", target.packageId);
  const expectedFile = join(expectedDir, "PACKAGE.md");
  if (!packageContext.samePath(target.packageDir, expectedDir)) {
    diagnostics.push(governanceDiagnostic(
      "LIFECYCLE_PLACEMENT_DIRECTORY",
      "package directory is not the owning repository path docs/packages/" + target.packageId,
    ));
  }
  if (!packageContext.samePath(target.packageFile, expectedFile)) {
    diagnostics.push(governanceDiagnostic(
      "LIFECYCLE_PLACEMENT_FILE",
      "PACKAGE.md is not the canonical file in the owning repository",
    ));
  }
  try {
    const actualRoot = packageContext.resolveRepositoryRoot(target.packageFile);
    if (!packageContext.samePath(actualRoot, repoRoot)) {
      diagnostics.push(governanceDiagnostic(
        "LIFECYCLE_PLACEMENT_FOREIGN_REPOSITORY",
        "package file belongs to another Git repository",
      ));
    }
  } catch (error) {
    diagnostics.push(governanceDiagnostic("LIFECYCLE_PLACEMENT_DISCOVERY", error.message));
  }
  for (const file of target.gateFiles) {
    const local = slash(relative(expectedDir, file));
    if (local !== "GATES.md" && !/^gates\/[^/]+\.md$/u.test(local)) {
      diagnostics.push(governanceDiagnostic(
        "LIFECYCLE_PLACEMENT_GATE",
        "gate ledger is outside the canonical immediate bundle layout: " + local,
        local,
      ));
    }
  }
  return diagnostics;
}

function secondTruthPaths(target) {
  const root = target.repoRoot;
  const candidates = [
    join(root, "GATES.md"),
    join(root, "gates"),
    join(root, "BAU-STAND.md"),
    join(root, "FULL-HARNESS-COVERAGE.md"),
    join(root, "docs", "harness-issues.md"),
    join(root, "docs", "packages", target.packageId + ".md"),
  ];
  for (const file of recursiveFiles(join(root, "docs", "plans"), (_file, name) => name.toLowerCase() === "00-status.md")) {
    candidates.push(file);
  }
  for (const file of recursiveFiles(target.packageDir, (_file, name) =>
    ["00-status.md", "plan.md", "status.md"].includes(name.toLowerCase()))) {
    candidates.push(file);
  }
  if (target.scope) {
    for (const name of ["GATES.md", "gates", "PLAN.md"]) {
      candidates.push(join(root, ".unlazy", target.scope, name));
    }
  }
  return [...new Set(candidates.filter((file) => existsSync(file)).map((file) => slash(relative(root, file))))]
    .sort((left, right) => left.localeCompare(right, "en"));
}

function validateFollowUps(value, boundary) {
  const diagnostics = [];
  if (!Array.isArray(value)) {
    return [governanceDiagnostic(
      "LIFECYCLE_FOLLOWUPS_MISSING",
      boundary + " requires an explicit followUps array; use [] only when no duty exists",
    )];
  }
  const seen = new Set();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      diagnostics.push(governanceDiagnostic("LIFECYCLE_FOLLOWUP_SHAPE", "follow-up entries must be objects"));
      continue;
    }
    if (typeof item.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(item.id)) {
      diagnostics.push(governanceDiagnostic("LIFECYCLE_FOLLOWUP_ID", "follow-up requires a stable id"));
    } else if (seen.has(item.id)) {
      diagnostics.push(governanceDiagnostic("LIFECYCLE_FOLLOWUP_DUPLICATE", "duplicate follow-up " + item.id));
    } else seen.add(item.id);
    for (const field of ["owner", "trigger", "action"]) {
      if (typeof item[field] !== "string" || !item[field].trim()) {
        diagnostics.push(governanceDiagnostic(
          "LIFECYCLE_FOLLOWUP_" + field.toUpperCase(),
          "follow-up " + (item.id || "<unknown>") + " requires non-empty " + field,
        ));
      }
    }
    if (!['open', 'resolved'].includes(item.state)) {
      diagnostics.push(governanceDiagnostic(
        "LIFECYCLE_FOLLOWUP_STATE",
        "follow-up " + (item.id || "<unknown>") + " state must be open or resolved",
      ));
    } else if (boundary === "close" && item.state !== "resolved") {
      diagnostics.push(governanceDiagnostic(
        "LIFECYCLE_FOLLOWUP_OPEN",
        "close refuses unresolved follow-up " + item.id,
      ));
    }
  }
  return diagnostics;
}

function gateEvidenceDiagnostics(status, boundary, ledger) {
  if (!["return", "integration", "close"].includes(boundary)) return [];
  const diagnostics = [];
  let gates = status._internal.gateEntries;
  if (boundary === "return") {
    if (typeof ledger !== "string" || !ledger) {
      return [governanceDiagnostic("LIFECYCLE_RETURN_LEDGER", "return requires the exact leaf ledger")];
    }
    gates = gates.filter((gate) => gate.ledger === ledger);
    if (!gates.length) {
      return [governanceDiagnostic("LIFECYCLE_RETURN_LEDGER_UNKNOWN", "return ledger is not part of the package: " + ledger, ledger)];
    }
  }
  for (const gate of gates) {
    if (gate.state !== "met") {
      diagnostics.push(governanceDiagnostic(
        "LIFECYCLE_EVIDENCE_UNMET",
        boundary + " requires current Evidence for " + gate.key,
        gate.ledger,
      ));
      continue;
    }
    if (gate.runnable && (!/^schema=2;/u.test(gate.evidence || "") ||
        !/oracleDigest=sha256:[a-f0-9]{64}/u.test(gate.evidence || "") ||
        !/output-sha256=[a-f0-9]{64}/u.test(gate.evidence || ""))) {
      diagnostics.push(governanceDiagnostic(
        "LIFECYCLE_EVIDENCE_UNSTRUCTURED",
        "runnable gate lacks schema-2 oracle/output Evidence: " + gate.key,
        gate.ledger,
      ));
    }
  }
  return diagnostics;
}

export function createLifecycleEvidenceSnapshot(target, options = {}) {
  const boundary = options.boundary;
  if (!LIFECYCLE_GOVERNANCE_BOUNDARIES.includes(boundary)) {
    throw new Error("unknown lifecycle governance boundary " + JSON.stringify(boundary));
  }
  const status = inspectPackageBundle(target);
  const rules = lifecycleRuleSnapshot(target.repoRoot);
  const bundle = lifecycleBundleSnapshot(target);
  return {
    schemaVersion: LIFECYCLE_GOVERNANCE_SCHEMA_VERSION,
    boundary,
    repoRoot: target.repoRoot,
    packageId: target.packageId,
    packageDigest: status.digest,
    bundleFingerprint: bundle.fingerprint,
    rulesFingerprint: rules.fingerprint,
    ownerBinding: ownerContract.createOwnerBinding(status._internal.owner, { packageId: target.packageId }),
    ledger: options.ledger || null,
    passed: options.passed === true,
    verifier: String(options.verifier || "").trim(),
    command: String(options.command || "").trim(),
    verifiedAt: options.verifiedAt || new Date().toISOString(),
  };
}

export function validateLifecycleBoundary(target, options = {}) {
  const boundary = options.boundary;
  const diagnostics = [];
  if (!LIFECYCLE_GOVERNANCE_BOUNDARIES.includes(boundary)) {
    diagnostics.push(governanceDiagnostic(
      "LIFECYCLE_BOUNDARY_UNKNOWN",
      "boundary must be one of " + LIFECYCLE_GOVERNANCE_BOUNDARIES.join(", "),
    ));
    return { schemaVersion: LIFECYCLE_GOVERNANCE_SCHEMA_VERSION, boundary, ok: false, diagnostics };
  }

  const status = inspectPackageBundle(target);
  diagnostics.push(...placementDiagnostics(target));
  diagnostics.push(...status.diagnostics);
  const rules = lifecycleRuleSnapshot(target.repoRoot);
  diagnostics.push(...rules.diagnostics);
  const bundle = lifecycleBundleSnapshot(target);

  const baseline = typeof options.rulesBaseline === "string"
    ? options.rulesBaseline
    : options.rulesBaseline && options.rulesBaseline.fingerprint;
  if (boundary !== "activate" && !baseline) {
    diagnostics.push(governanceDiagnostic(
      "LIFECYCLE_RULE_BASELINE_MISSING",
      boundary + " requires the rules fingerprint captured at activation",
    ));
  } else if (baseline && baseline !== rules.fingerprint) {
    diagnostics.push(governanceDiagnostic(
      "LIFECYCLE_RULES_CHANGED",
      boundary + " rejected active-rule drift since activation",
    ));
  }

  let currentOwnerBinding = null;
  if (!options.ownerBinding) {
    diagnostics.push(governanceDiagnostic(
      "LIFECYCLE_OWNER_BINDING_MISSING",
      boundary + " requires the immutable Owner binding",
      "OWNER.md",
    ));
  } else {
    try {
      currentOwnerBinding = ownerContract.assertOwnerBinding(
        status._internal.owner,
        options.ownerBinding,
        boundary,
        { packageId: target.packageId },
      );
    } catch (error) {
      diagnostics.push(governanceDiagnostic(error.code || "LIFECYCLE_OWNER_BINDING", error.message, "OWNER.md"));
    }
  }

  for (const path of secondTruthPaths(target)) {
    diagnostics.push(governanceDiagnostic(
      "LIFECYCLE_REDUNDANT_TRUTH",
      "second lifecycle truth is not allowed: " + path,
      path,
    ));
  }
  diagnostics.push(...validateFollowUps(options.followUps, boundary));
  diagnostics.push(...gateEvidenceDiagnostics(status, boundary, options.ledger));

  if (["return", "integration", "close"].includes(boundary)) {
    const evidence = options.evidenceSnapshot;
    if (!evidence || evidence.schemaVersion !== LIFECYCLE_GOVERNANCE_SCHEMA_VERSION) {
      diagnostics.push(governanceDiagnostic(
        "LIFECYCLE_EVIDENCE_SNAPSHOT_MISSING",
        boundary + " requires a current lifecycle Evidence snapshot",
      ));
    } else {
      if (evidence.boundary !== boundary || evidence.packageId !== target.packageId ||
          !packageContext.samePath(evidence.repoRoot, target.repoRoot)) {
        diagnostics.push(governanceDiagnostic(
          "LIFECYCLE_EVIDENCE_IDENTITY",
          "Evidence snapshot belongs to another boundary, package, or repository",
        ));
      }
      if (evidence.packageDigest !== status.digest || evidence.bundleFingerprint !== bundle.fingerprint ||
          evidence.rulesFingerprint !== rules.fingerprint) {
        diagnostics.push(governanceDiagnostic(
          "LIFECYCLE_EVIDENCE_STALE",
          "package, gate, Owner, or active-rule source changed after verification",
        ));
      }
      if (boundary === "return" && evidence.ledger !== options.ledger) {
        diagnostics.push(governanceDiagnostic(
          "LIFECYCLE_EVIDENCE_LEDGER",
          "return Evidence snapshot belongs to another ledger",
        ));
      }
      if (evidence.passed !== true || !evidence.verifier || !evidence.command) {
        diagnostics.push(governanceDiagnostic(
          "LIFECYCLE_EVIDENCE_RESULT",
          "Evidence snapshot must name a verifier and acceptance command with passed=true",
        ));
      }
      const verifiedAt = Date.parse(evidence.verifiedAt);
      const now = options.now === undefined ? Date.now() : Number(options.now);
      if (!Number.isFinite(verifiedAt) || verifiedAt > now + 1000) {
        diagnostics.push(governanceDiagnostic("LIFECYCLE_EVIDENCE_TIME", "Evidence timestamp is invalid or in the future"));
      } else if (Number.isFinite(options.maxEvidenceAgeMs) && now - verifiedAt > options.maxEvidenceAgeMs) {
        diagnostics.push(governanceDiagnostic("LIFECYCLE_EVIDENCE_EXPIRED", "Evidence exceeds the configured maximum age"));
      }
      try {
        ownerContract.assertOwnerBinding(
          status._internal.owner,
          evidence.ownerBinding,
          boundary,
          { packageId: target.packageId },
        );
      } catch (error) {
        diagnostics.push(governanceDiagnostic(error.code || "LIFECYCLE_EVIDENCE_OWNER", error.message, "OWNER.md"));
      }
    }
  }

  if (boundary === "close" && !["closable", "closed"].includes(status.status)) {
    diagnostics.push(governanceDiagnostic(
      "LIFECYCLE_CLOSE_STATE",
      "close requires a closable or already closed package; current status is " + status.status,
    ));
  }

  return {
    schemaVersion: LIFECYCLE_GOVERNANCE_SCHEMA_VERSION,
    boundary,
    ok: diagnostics.length === 0,
    diagnostics,
    rulesBaseline: rules.fingerprint,
    ownerBinding: currentOwnerBinding,
    snapshots: {
      rules: { count: rules.count, fingerprint: rules.fingerprint },
      bundle: { count: bundle.count, fingerprint: bundle.fingerprint },
    },
  };
}

export function parsePackageDocument(text, options = {}) {
  const source = String(text);
  const diagnostics = [];
  if (source.startsWith("\uFEFF")) addDiagnostic(diagnostics, "PACKAGE_BOM", "PACKAGE.md must not start with a BOM");
  if (!source.endsWith("\n")) addDiagnostic(diagnostics, "PACKAGE_FINAL_NEWLINE", "PACKAGE.md must end with a newline");
  const { preamble, sections } = splitSections(source, diagnostics);
  const pig = parsePreamble(preamble, options.packageId || "", diagnostics, options);
  const plan = parsePlan(sections.Plan, diagnostics);
  const contract = parseContract(sections.Abnahme, diagnostics);
  const conclusion = parseConclusion(sections.Abschluss, diagnostics);
  if (!(sections.Status || "").trim()) addDiagnostic(diagnostics, "PACKAGE_STATUS_EMPTY", "Status section must not be empty");

  let currentSection = "preamble";
  for (const line of source.split(/\r?\n/)) {
    const heading = line.match(/^## (.+)$/);
    if (heading) currentSection = heading[1];
    if (CHECKBOX_RE.test(line) && currentSection !== "Plan") {
      addDiagnostic(diagnostics, "PACKAGE_CHECKBOX_OUTSIDE_PLAN", "checkbox outside ## Plan: " + line);
    }
    const forbidden = line.match(FORBIDDEN_GATE_RE);
    if (forbidden) addDiagnostic(diagnostics, "PACKAGE_GATE_DEFINITION", forbidden[1] + " belongs in a gate ledger, not PACKAGE.md");
  }

  return {
    text: source,
    digest: digest(source),
    diagnostics,
    pig,
    plan,
    statusText: sections.Status || "",
    contract,
    conclusion,
    sections,
  };
}

export function inspectPackageBundle(target) {
  const text = readFileSync(target.packageFile, "utf8");
  const parsed = parsePackageDocument(text, {
    packageId: target.packageId,
    standardFormat: ownerContract.harnessConfig(target.repoRoot).standardFormat === true,
  });
  const diagnostics = [...parsed.diagnostics];
  const owner = inspectOwnerContract(
    target.repoRoot,
    target.packageDir,
    target.packageId,
    parsed.contract.mappings.map((mapping) => mapping.contractId),
  );
  diagnostics.push(...owner.diagnostics);
  inspectBundleLayout(target, diagnostics);
  const ledgerInspection = inspectGateLedgers(target, diagnostics);
  const gateEntries = ledgerInspection.gates;
  const depthTree = inspectDepthTree(parsed, target, diagnostics);
  const contract = contractCoverage(parsed.contract, gateEntries, diagnostics);
  const planDone = parsed.plan.filter((step) => step.done).length;
  const gateMet = gateEntries.filter((gate) => gate.state === "met").length;
  const gateHandoff = gateEntries.filter((gate) => gate.state === "abandoned").length;
  const gates = {
    total: gateEntries.length,
    met: gateMet,
    unmet: gateEntries.length - gateMet - gateHandoff,
    handoff: gateHandoff,
  };
  const dispatch = dispatchDimension(target);
  for (const message of dispatch.diagnostics) addDiagnostic(diagnostics, "PACKAGE_DISPATCH", message, ".unlazy");
  const planComplete = parsed.plan.length > 0 && planDone === parsed.plan.length;
  const gatesComplete = gates.total > 0 && gates.met === gates.total;
  const contractComplete = contract.required > 0 && contract.covered === contract.required;
  const openDecisions = /\b(?:ABANDON|DEFER|OWNER_DECISION)\b/i.test(text);
  const fulfillmentClaim = /^(?:erfuellt|fulfilled)\b/i.test(parsed.conclusion.fulfillment || "");
  const nothingOpen = /^(?:nichts|nothing|none)$/i.test(parsed.conclusion.offen || "");
  const closeClaim = fulfillmentClaim && nothingOpen;
  const coreClosable = owner.complete && planComplete && gatesComplete && contractComplete &&
    dispatch.unfinished === 0 && !openDecisions;
  if (fulfillmentClaim !== nothingOpen) {
    addDiagnostic(diagnostics, "PACKAGE_INCONSISTENT_CONCLUSION",
      "Fulfillment and Offen must either both claim closure or both remain open");
  }
  if (closeClaim && (!coreClosable || diagnostics.length)) {
    addDiagnostic(diagnostics, "PACKAGE_CONTRADICTORY_CLOSE", "Abschluss claims closure while plan, gates, dispatch, contract, or schema is incomplete");
  }
  const closable = coreClosable && diagnostics.length === 0 && !closeClaim;
  let status;
  if (diagnostics.length) status = "invalid";
  else if (gates.handoff > 0 || dispatch.state === "handoff") status = "handoff";
  else if (closeClaim && coreClosable) status = "closed";
  else if (closable) status = "closable";
  else if (/\bBLOCKED\b/i.test(parsed.statusText) || openDecisions || dispatch.unfinished > 0) status = "blocked";
  else if (target.scope) status = "active";
  else status = "draft";

  return {
    schemaVersion: PACKAGE_SCHEMA_VERSION,
    repoRoot: target.repoRoot,
    repoKey: target.repoKey || ".",
    packageId: target.packageId,
    packageFile: slash(relative(target.repoRoot, target.packageFile)),
    scope: target.scope || null,
    lifecycle: status === "closed" ? "closed" : target.scope ? "active" : "inactive",
    status,
    plan: {
      total: parsed.plan.length,
      done: planDone,
      nextStep: parsed.plan.find((step) => !step.done)?.number || null,
    },
    gates,
    dispatch: { state: dispatch.state, unfinished: dispatch.unfinished },
    depthTree: { defined: depthTree.defined, ledgers: depthTree.ledgers },
    owner: {
      required: owner.required,
      present: owner.present,
      complete: owner.complete,
      requirements: owner.requirements.length,
      digest: owner.digest,
      requestDigest: owner.requestDigest,
    },
    contract,
    closable,
    diagnostics,
    digest: parsed.digest,
    _internal: { parsed, gateEntries, ownership: ledgerInspection.ownership, depthTree, closeClaim, openDecisions, owner },
  };
}

export function publicPackageStatus(status) {
  const { _internal, ...publicValue } = status;
  return publicValue;
}
