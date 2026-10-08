import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { basename, join, relative } from "node:path";
import { dispatchStatus } from "./dispatch.mjs";
import { gateState, globsOverlap, parseGates } from "./gates.mjs";

const require = createRequire(import.meta.url);
const ownerContract = require("./owner-contract.cjs");
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

const REQUIRED_SECTIONS = ["Plan", "Status", "Abnahme", "Abschluss", "Anhang"];
const PLAN_RE = /^(\d+)\. \[([ xX])\] (\S.*)$/;
const CHECKBOX_RE = /^\s*(?:[-*]|\d+\.)\s+\[[ xX]\]/;
const CONTRACT_RE = /^- (C\d+) -> (GATES\.md|gates\/[A-Za-z0-9][A-Za-z0-9._-]*\.md):([A-Za-z0-9][A-Za-z0-9._-]{0,63}): (\S.*)$/;
const FORBIDDEN_GATE_RE = /^\s*(CHECK|EXPECT|EVIDENCE|CWD|CACHE|OWNS|ABANDON):/;
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
