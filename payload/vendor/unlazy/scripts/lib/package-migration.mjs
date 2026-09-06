import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import packageContext from "./package-context.cjs";
import { assertRuntimeIgnored } from "./package-lifecycle.mjs";
import { inspectPackageBundle, parsePackageDocument } from "./package-schema.mjs";
import { writeAtomic } from "./gates.mjs";
import { resolveRepository } from "./packages.mjs";

const {
  assertNoLinkedComponent,
  assertRegularFile,
  listBundleGateFiles,
  validatePackageId,
} = packageContext;

export const MIGRATION_SCHEMA_VERSION = 1;
const CORE_SECTIONS = new Set(["Plan", "Status", "Abnahme", "Abschluss", "Anhang"]);
const CONCLUSION_FIELDS = ["Coverage", "Fulfillment", "Geprueft gegen", "Offen"];

const slash = (value) => String(value).replaceAll("\\", "/");
const digest = (value) => "sha256:" + createHash("sha256").update(value).digest("hex");
const oneLine = (value) => String(value || "").replace(/\s+/g, " ").trim();

function migrationError(message, exitCode = 2, code = "UNLAZY_PACKAGE_MIGRATION") {
  const error = new Error(message);
  error.exitCode = exitCode;
  error.code = code;
  return error;
}

function conflict(message) {
  throw migrationError(message, 3, "UNLAZY_PACKAGE_MIGRATION_CONFLICT");
}

export class SimulatedMigrationCrash extends Error {
  constructor(point) {
    super("simulated migration crash at " + point);
    this.code = "UNLAZY_SIMULATED_MIGRATION_CRASH";
    this.exitCode = 2;
    this.point = point;
  }
}

function reach(options, point) {
  if (typeof options.failpoint === "function") options.failpoint(point);
  if (options.killpoint === point) throw new SimulatedMigrationCrash(point);
}

function splitSections(text) {
  const source = String(text).replace(/\r\n/g, "\n");
  const matches = [...source.matchAll(/^## (.+)$/gm)];
  const sections = [];
  for (let index = 0; index < matches.length; index++) {
    const start = matches[index].index + matches[index][0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index : source.length;
    sections.push({
      name: matches[index][1].trim(),
      body: source.slice(start, end).replace(/^\n/, "").replace(/\n+$/, ""),
    });
  }
  return {
    source,
    preamble: source.slice(0, matches.length ? matches[0].index : source.length),
    sections,
  };
}

function exactlyOneSection(parsed, name, blockers) {
  const matches = parsed.sections.filter((section) => section.name === name);
  if (matches.length !== 1) {
    blockers.push({
      code: matches.length ? "DUPLICATE_SECTION" : "MISSING_SECTION",
      section: name,
      message: "legacy package requires exactly one ## " + name + " section",
    });
    return "";
  }
  return matches[0].body;
}

function parsePreamble(preamble, blockers) {
  const lines = preamble.replace(/\n+$/, "").split("\n");
  const title = lines.find((line) => /^# Work package: /.test(line));
  if (!title) blockers.push({ code: "MISSING_TITLE", message: "legacy package has no '# Work package:' title" });
  const fields = Object.create(null);
  for (const name of ["Problem", "Intent", "Goal"]) {
    const index = lines.findIndex((line) => line.startsWith("**" + name + ":**"));
    if (index === -1) {
      blockers.push({ code: "MISSING_PIG", field: name, message: "legacy package has no " + name + " field" });
      fields[name.toLowerCase()] = "";
      continue;
    }
    const parts = [lines[index].slice(("**" + name + ":**").length).trim()];
    for (let cursor = index + 1; cursor < lines.length; cursor++) {
      const line = lines[cursor];
      if (/^\*\*(?:Problem|Intent|Goal):\*\*/.test(line)) break;
      if (/^#/.test(line)) break;
      if (!line.trim() && parts.some(Boolean)) break;
      if (line.trim()) parts.push(line.trim());
    }
    fields[name.toLowerCase()] = oneLine(parts.join(" "));
    if (!fields[name.toLowerCase()]) {
      blockers.push({ code: "EMPTY_PIG", field: name, message: name + " is empty" });
    }
  }
  return {
    title: title ? title.replace(/^# Work package:\s*/, "").trim() : "",
    ...fields,
  };
}

function parsePlan(section, blockers) {
  const steps = [];
  let current = null;
  const flush = () => {
    if (!current) return;
    current.text = oneLine(current.parts.join(" "));
    delete current.parts;
    steps.push(current);
    current = null;
  };
  for (const line of String(section).split("\n")) {
    const match = line.match(/^(\d+)\. \[([ xX~])\] (.*)$/);
    if (match) {
      flush();
      current = { number: Number(match[1]), marker: match[2].toLowerCase(), parts: [match[3]] };
      continue;
    }
    if (!line.trim()) continue;
    if (!current) {
      blockers.push({ code: "PLAN_UNOWNED_TEXT", message: "text before first numbered plan step: " + oneLine(line) });
      continue;
    }
    current.parts.push(line.trim());
  }
  flush();
  if (!steps.length) blockers.push({ code: "EMPTY_PLAN", message: "legacy Plan has no numbered checkbox steps" });
  for (let index = 0; index < steps.length; index++) {
    if (steps[index].number !== index + 1) {
      blockers.push({ code: "PLAN_NUMBER", step: steps[index].number, message: "plan numbering is not consecutive" });
    }
    if (!steps[index].text) blockers.push({ code: "EMPTY_PLAN_STEP", step: steps[index].number, message: "plan step is empty" });
    if (steps[index].marker === "~") {
      blockers.push({
        code: "PARTIAL_PLAN_STATE",
        step: steps[index].number,
        message: "[~] is intentionally not guessed as open or done; resolve it in the legacy source first",
      });
    }
  }
  return steps;
}

function parseCriteria(section, blockers) {
  const criteria = [];
  let current = null;
  const flush = () => {
    if (!current) return;
    current.text = oneLine(current.parts.join(" "));
    delete current.parts;
    criteria.push(current);
    current = null;
  };
  for (const line of String(section).split("\n")) {
    const match = line.match(/^- (?:\[([ xX~])\]\s+)?(.*)$/);
    if (match) {
      flush();
      current = { legacyMarker: match[1] ? match[1].toLowerCase() : null, parts: [match[2]] };
      continue;
    }
    if (!line.trim()) continue;
    if (!current) {
      blockers.push({ code: "CONTRACT_UNOWNED_TEXT", message: "Abnahme text is not an explicit bullet: " + oneLine(line) });
      continue;
    }
    current.parts.push(line.trim());
  }
  flush();
  if (!criteria.length) {
    blockers.push({
      code: "UNCLEAR_GATE_MAPPING",
      message: "Abnahme has no explicit criteria; the migrator will not invent a gate assignment",
    });
  }
  for (const [index, criterion] of criteria.entries()) {
    if (!criterion.text) blockers.push({ code: "EMPTY_CRITERION", contractId: "C" + (index + 1), message: "acceptance criterion is empty" });
  }
  return criteria;
}

function parseConclusion(section, blockers) {
  const values = Object.create(null);
  let current = null;
  for (const line of String(section).split("\n")) {
    const match = line.match(/^(Coverage|Fulfillment|Geprueft gegen|Offen):\s*(.*)$/i);
    if (match) {
      const canonical = CONCLUSION_FIELDS.find((name) => name.toLowerCase() === match[1].toLowerCase());
      current = canonical;
      if (values[canonical] !== undefined) {
        blockers.push({ code: "DUPLICATE_CONCLUSION", field: canonical, message: "duplicate conclusion field " + canonical });
      } else values[canonical] = match[2].trim();
      continue;
    }
    if (line.trim() && current) values[current] += " " + line.trim();
    else if (line.trim()) blockers.push({ code: "CONCLUSION_UNOWNED_TEXT", message: "unowned Abschluss text: " + oneLine(line) });
  }
  for (const name of CONCLUSION_FIELDS) {
    values[name] = oneLine(values[name]);
    if (!values[name]) blockers.push({ code: "MISSING_CONCLUSION", field: name, message: "Abschluss field is missing or empty: " + name });
  }
  return values;
}

function demoteHeadings(text) {
  return String(text || "").replace(/^## /gm, "### ").replace(/^# /gm, "### ").trim();
}

function renderBundle(packageId, sourceDigest, parsed, pig, steps, status, criteria, conclusion, extras) {
  const plan = steps.map((step, index) => {
    const marker = step.marker === "x" ? "x" : " ";
    return (index + 1) + ". [" + marker + "] " + step.text;
  }).join("\n");
  const contract = criteria.map((criterion, index) =>
    "- C" + (index + 1) + " -> GATES.md:G" + (index + 1) + ": " + criterion.text
  ).join("\n");
  const gates = criteria.map((criterion, index) =>
    "- [ ] G" + (index + 1) + ": " + criterion.text + "\n  EVIDENCE: pending"
  ).join("\n\n");
  const extraText = extras.length
    ? "\n\n### Preserved legacy sections\n\n" + extras.map((entry) =>
      "#### " + entry.name + "\n\n" + demoteHeadings(entry.body)
    ).join("\n\n")
    : "";
  const partial = steps.filter((step) => step.marker === "~").map((step) => step.number);
  const markerText = partial.length
    ? "\n\nMigration blockers preserved: legacy [~] step(s) " + partial.join(", ") + "."
    : "";
  const packageText = `# Work package: ${packageId}

**Problem:** ${pig.problem}
**Intent:** ${pig.intent}
**Goal:** ${pig.goal}

## Plan

${plan}

## Status

${status || "Migrated from the legacy flat package; no status text was supplied."}

## Abnahme

${contract}

## Abschluss

Coverage: ${conclusion.Coverage}
Fulfillment: ${conclusion.Fulfillment}
Geprueft gegen: ${conclusion["Geprueft gegen"]}
Offen: ${conclusion.Offen}

## Anhang

Migration source: disabled flat package docs/packages/${packageId}.md, ${sourceDigest}.
Original title: ${pig.title || packageId}.${markerText}${extraText}
`;
  const gatesText = `# Gates: ${packageId}

${gates}
`;
  return { packageText, gatesText };
}

export function prepareLegacyMigration(packageId, text) {
  const invalid = validatePackageId(packageId);
  if (invalid) throw migrationError(invalid);
  const sourceText = String(text).replace(/\r\n/g, "\n");
  const sourceDigest = digest(sourceText);
  const blockers = [];
  const warnings = [];
  const parsed = splitSections(sourceText);
  const pig = parsePreamble(parsed.preamble, blockers);
  const planSection = exactlyOneSection(parsed, "Plan", blockers);
  const status = exactlyOneSection(parsed, "Status", blockers).trim();
  const acceptance = exactlyOneSection(parsed, "Abnahme", blockers);
  const close = exactlyOneSection(parsed, "Abschluss", blockers);
  const appendixMatches = parsed.sections.filter((section) => section.name === "Anhang");
  if (appendixMatches.length > 1) blockers.push({ code: "DUPLICATE_SECTION", section: "Anhang", message: "legacy package has multiple ## Anhang sections" });
  const extras = parsed.sections.filter((section) => !CORE_SECTIONS.has(section.name));
  if (extras.length) {
    blockers.push({
      code: "UNKNOWN_SECTIONS",
      sections: extras.map((entry) => entry.name),
      message: "unknown sections are preserved in Anhang but require an explicit source cleanup before apply",
    });
  }
  if (!status) blockers.push({ code: "EMPTY_STATUS", message: "legacy Status is empty" });
  const steps = parsePlan(planSection, blockers);
  const criteria = parseCriteria(acceptance, blockers);
  const conclusion = parseConclusion(close, blockers);
  if (criteria.some((criterion) => criterion.legacyMarker)) {
    warnings.push({ code: "LEGACY_ACCEPTANCE_CHECKBOX", message: "acceptance checkboxes become pending gates; historical marks are not Evidence" });
  }
  const appendix = appendixMatches[0]?.body || "";
  const preserved = [...extras];
  if (appendix.trim()) preserved.push({ name: "Legacy Anhang", body: appendix });
  const rendered = renderBundle(packageId, sourceDigest, parsed, pig, steps, status, criteria, conclusion, preserved);
  const targetParsed = parsePackageDocument(rendered.packageText, { packageId });
  for (const diagnostic of targetParsed.diagnostics) {
    blockers.push({ code: "GENERATED_" + diagnostic.code, message: diagnostic.message });
  }
  const semantic = {
    identity: { sourceFile: "docs/packages/" + packageId + ".md", targetDirectory: "docs/packages/" + packageId },
    pig: { problem: pig.problem, intent: pig.intent, goal: pig.goal },
    plan: steps.map((step, index) => ({ sourceNumber: step.number, targetNumber: index + 1, marker: step.marker, text: step.text })),
    statusDigest: digest(status),
    contract: criteria.map((criterion, index) => ({
      contractId: "C" + (index + 1),
      ledger: "GATES.md",
      gateId: "G" + (index + 1),
      criterion: criterion.text,
      legacyMarker: criterion.legacyMarker,
    })),
    conclusion,
    preservedSections: preserved.map((entry) => entry.name),
  };
  return {
    schemaVersion: MIGRATION_SCHEMA_VERSION,
    packageId,
    sourceDigest,
    generated: { packageDigest: digest(rendered.packageText), gatesDigest: digest(rendered.gatesText) },
    semantic,
    blockers,
    warnings,
    migrationBlocked: blockers.length > 0,
    equal: blockers.length === 0,
    packageText: rendered.packageText,
    gatesText: rendered.gatesText,
  };
}

function gitDirectory(repoRoot) {
  const marker = join(repoRoot, ".git");
  const info = lstatSync(marker);
  if (info.isDirectory()) return realpathSync(marker);
  if (!info.isFile() || info.isSymbolicLink()) throw migrationError(".git marker must be a real directory or regular file");
  const match = readFileSync(marker, "utf8").trim().match(/^gitdir:\s*(.+)$/i);
  if (!match) throw migrationError(".git file must contain exactly one gitdir reference");
  const candidate = isAbsolute(match[1]) ? match[1] : resolve(dirname(marker), match[1]);
  if (!existsSync(candidate) || !lstatSync(candidate).isDirectory()) throw migrationError(".git file points to no directory");
  return realpathSync(candidate);
}

export function gitIndexFingerprint(repoRoot) {
  const index = join(gitDirectory(repoRoot), "index");
  if (!existsSync(index)) return "sha256:missing";
  const info = lstatSync(index);
  if (!info.isFile() || info.isSymbolicLink()) throw migrationError("git index must be a regular file");
  return digest(readFileSync(index));
}

function pathsFor(root, packageId) {
  const packagesDir = join(root, "docs", "packages");
  return {
    packagesDir,
    source: join(packagesDir, packageId + ".md"),
    target: join(packagesDir, packageId),
    locks: join(root, ".unlazy", "locks"),
    lock: join(root, ".unlazy", "locks", "package-migration.lock"),
    journals: join(root, ".unlazy", "migrations"),
    journal: join(root, ".unlazy", "migrations", packageId + ".json"),
  };
}

function readJournal(file) {
  if (!existsSync(file)) throw migrationError("no migration journal: " + file);
  let value;
  try { value = JSON.parse(readFileSync(file, "utf8")); }
  catch (error) { throw migrationError("invalid migration journal: " + error.message); }
  if (!value || value.schemaVersion !== MIGRATION_SCHEMA_VERSION || !value.token || !value.packageId) {
    throw migrationError("unsupported migration journal");
  }
  return value;
}

function writeJournal(file, journal) {
  writeAtomic(file, JSON.stringify(journal, null, 2) + "\n");
}

function acquireLock(paths, packageId, recoveryToken = null) {
  mkdirSync(paths.locks, { recursive: true });
  assertNoLinkedComponent(dirname(paths.locks), paths.locks);
  if (existsSync(paths.lock)) {
    let existing = null;
    try { existing = JSON.parse(readFileSync(paths.lock, "utf8")); } catch { /* conflict below */ }
    if (!recoveryToken || existing?.token !== recoveryToken || existing?.packageId !== packageId) {
      conflict("another package migration owns " + paths.lock);
    }
    unlinkSync(paths.lock);
  }
  const token = recoveryToken || randomBytes(16).toString("hex");
  let fd;
  try {
    fd = openSync(paths.lock, "wx");
    writeFileSync(fd, JSON.stringify({ schemaVersion: MIGRATION_SCHEMA_VERSION, token, packageId, pid: process.pid }) + "\n", "utf8");
  } catch (error) {
    if (error.code === "EEXIST") conflict("another package migration owns " + paths.lock);
    throw error;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  return token;
}

function releaseLock(paths, token) {
  if (!existsSync(paths.lock)) return;
  let current;
  try { current = JSON.parse(readFileSync(paths.lock, "utf8")); }
  catch { conflict("migration lock changed and cannot be released safely"); }
  if (current.token !== token) conflict("migration lock ownership changed");
  unlinkSync(paths.lock);
}

function verifyPrepared(root, packageId, directory, report) {
  const packageFile = join(directory, "PACKAGE.md");
  const target = {
    repoRoot: root,
    repoKey: ".",
    packageId,
    packageDir: directory,
    packageFile,
    gateFiles: listBundleGateFiles(root, directory),
    scope: null,
  };
  const status = inspectPackageBundle(target);
  if (status.diagnostics.length) {
    throw migrationError("prepared bundle failed validation: " + status.diagnostics.map((item) => item.code + " " + item.message).join("; "));
  }
  if (digest(readFileSync(packageFile, "utf8")) !== report.generated.packageDigest) {
    conflict("prepared PACKAGE.md digest changed");
  }
  if (digest(readFileSync(join(directory, "GATES.md"), "utf8")) !== report.generated.gatesDigest) {
    conflict("prepared GATES.md digest changed");
  }
  return status;
}

function finish(paths, journal) {
  if (existsSync(paths.journal)) unlinkSync(paths.journal);
  releaseLock(paths, journal.token);
  return {
    schemaVersion: MIGRATION_SCHEMA_VERSION,
    packageId: journal.packageId,
    state: "bundle-only",
    source: slash(relative(journal.repoRoot, paths.source)),
    target: slash(relative(journal.repoRoot, paths.target)),
    sourceDigest: journal.sourceDigest,
    packageDigest: journal.report.generated.packageDigest,
    approvalInvalidated: true,
    runtimeImported: false,
    semantic: journal.report.semantic,
  };
}

function assertInitialState(root, packageId, paths) {
  assertRuntimeIgnored(root);
  if (!existsSync(paths.source)) throw migrationError("legacy flat package does not exist: " + paths.source);
  assertRegularFile(root, paths.source, "legacy package");
  if (existsSync(paths.target)) {
    throw migrationError("legacy flat package and bundle target collide: " + paths.source + " + " + paths.target);
  }
  for (const legacy of [join(root, "GATES.md"), join(root, "gates")]) {
    if (existsSync(legacy)) {
      throw migrationError("unclear gate source " + legacy + "; isolate it or provide a separately reviewed mapping before migration");
    }
  }
}

export function dryRunLegacyMigration(options) {
  const root = resolveRepository(options.root ? { root: options.root } : { cwd: options.cwd || process.cwd() });
  const packageId = String(options.packageId || "");
  const invalid = validatePackageId(packageId);
  if (invalid) throw migrationError(invalid);
  const paths = pathsFor(root, packageId);
  assertInitialState(root, packageId, paths);
  const sourceText = readFileSync(paths.source, "utf8");
  const report = prepareLegacyMigration(packageId, sourceText);
  return {
    schemaVersion: MIGRATION_SCHEMA_VERSION,
    mode: "dry-run",
    repoRoot: root,
    packageId,
    source: slash(relative(root, paths.source)),
    target: slash(relative(root, paths.target)),
    indexFingerprint: gitIndexFingerprint(root),
    ...report,
    packageText: undefined,
    gatesText: undefined,
  };
}

export function applyLegacyMigration(options) {
  const root = resolveRepository(options.root ? { root: options.root } : { cwd: options.cwd || process.cwd() });
  const packageId = String(options.packageId || "");
  const paths = pathsFor(root, packageId);
  assertInitialState(root, packageId, paths);
  const sourceText = readFileSync(paths.source, "utf8").replace(/\r\n/g, "\n");
  const report = prepareLegacyMigration(packageId, sourceText);
  if (report.migrationBlocked) {
    throw migrationError("migration blocked: " + report.blockers.map((item) => item.code).join(", "), 1, "UNLAZY_PACKAGE_MIGRATION_BLOCKED");
  }
  const token = acquireLock(paths, packageId);
  const indexFingerprint = gitIndexFingerprint(root);
  const temporary = join(paths.packagesDir, "." + packageId + ".migrating-" + token.slice(0, 12));
  const journal = {
    schemaVersion: MIGRATION_SCHEMA_VERSION,
    token,
    repoRoot: root,
    packageId,
    sourceDigest: report.sourceDigest,
    sourceText,
    indexFingerprint,
    temporary,
    stage: "locked",
    report: { ...report, packageText: undefined, gatesText: undefined },
  };
  mkdirSync(paths.journals, { recursive: true });
  writeJournal(paths.journal, journal);
  try {
    reach(options, "after-lock");
    if (digest(readFileSync(paths.source, "utf8").replace(/\r\n/g, "\n")) !== report.sourceDigest) {
      conflict("legacy source changed after migration lock acquisition");
    }
    mkdirSync(temporary, { recursive: false });
    mkdirSync(join(temporary, "gates"), { recursive: false });
    writeFileSync(join(temporary, "PACKAGE.md"), report.packageText, { encoding: "utf8", flag: "wx" });
    writeFileSync(join(temporary, "GATES.md"), report.gatesText, { encoding: "utf8", flag: "wx" });
    writeFileSync(join(temporary, "gates", ".gitkeep"), "", { encoding: "utf8", flag: "wx" });
    verifyPrepared(root, packageId, temporary, report);
    journal.stage = "prepared";
    writeJournal(paths.journal, journal);
    reach(options, "after-prepare");
    if (gitIndexFingerprint(root) !== indexFingerprint) conflict("git index changed before cutover");
    if (existsSync(paths.target)) conflict("bundle target appeared before cutover");
    if (digest(readFileSync(paths.source, "utf8").replace(/\r\n/g, "\n")) !== report.sourceDigest) {
      conflict("legacy source changed before cutover");
    }
    journal.stage = "cutover";
    writeJournal(paths.journal, journal);
    renameSync(temporary, paths.target);
    journal.stage = "target-visible";
    writeJournal(paths.journal, journal);
    reach(options, "after-target");
    verifyPrepared(root, packageId, paths.target, report);
    rmSync(paths.source);
    journal.stage = "source-removed";
    writeJournal(paths.journal, journal);
    reach(options, "after-source-remove");
    verifyPrepared(root, packageId, paths.target, report);
    return finish(paths, journal);
  } catch (error) {
    if (error instanceof SimulatedMigrationCrash) throw error;
    if (!existsSync(paths.target)) {
      try { rmSync(temporary, { recursive: true, force: true }); } catch { /* retain primary error */ }
      try { if (existsSync(paths.journal)) unlinkSync(paths.journal); } catch { /* retain primary error */ }
      try { releaseLock(paths, token); } catch { /* retain primary error */ }
    }
    throw error;
  }
}

export function resumeLegacyMigration(options) {
  const root = resolveRepository(options.root ? { root: options.root } : { cwd: options.cwd || process.cwd() });
  const packageId = String(options.packageId || "");
  const paths = pathsFor(root, packageId);
  const journal = readJournal(paths.journal);
  if (journal.packageId !== packageId || realpathSync(journal.repoRoot) !== realpathSync(root)) {
    conflict("migration journal belongs to another repository or package");
  }
  acquireLock(paths, packageId, journal.token);
  try {
    const sourceExists = existsSync(paths.source);
    const targetExists = existsSync(paths.target);
    const temporaryExists = existsSync(journal.temporary);
    if (sourceExists && digest(readFileSync(paths.source, "utf8").replace(/\r\n/g, "\n")) !== journal.sourceDigest) {
      conflict("legacy source changed; resume is unsafe");
    }
    if (targetExists) {
      verifyPrepared(root, packageId, paths.target, journal.report);
      if (sourceExists) rmSync(paths.source);
      journal.stage = "source-removed";
      writeJournal(paths.journal, journal);
      return finish(paths, journal);
    }
    if (!sourceExists || !temporaryExists) conflict("resume cannot find a coherent legacy source and prepared bundle");
    if (gitIndexFingerprint(root) !== journal.indexFingerprint) conflict("git index changed; resume requires rollback or index restoration");
    verifyPrepared(root, packageId, journal.temporary, journal.report);
    renameSync(journal.temporary, paths.target);
    journal.stage = "target-visible";
    writeJournal(paths.journal, journal);
    rmSync(paths.source);
    journal.stage = "source-removed";
    writeJournal(paths.journal, journal);
    return finish(paths, journal);
  } catch (error) {
    if (existsSync(paths.lock)) {
      try { releaseLock(paths, journal.token); } catch { /* retain primary error */ }
    }
    throw error;
  }
}

export function rollbackLegacyMigration(options) {
  const root = resolveRepository(options.root ? { root: options.root } : { cwd: options.cwd || process.cwd() });
  const packageId = String(options.packageId || "");
  const paths = pathsFor(root, packageId);
  const journal = readJournal(paths.journal);
  if (journal.packageId !== packageId || realpathSync(journal.repoRoot) !== realpathSync(root)) {
    conflict("migration journal belongs to another repository or package");
  }
  acquireLock(paths, packageId, journal.token);
  try {
    if (existsSync(paths.target)) {
      verifyPrepared(root, packageId, paths.target, journal.report);
      if (!existsSync(paths.source)) writeAtomic(paths.source, journal.sourceText);
      rmSync(paths.target, { recursive: true, force: false });
    }
    if (existsSync(journal.temporary)) rmSync(journal.temporary, { recursive: true, force: false });
    if (!existsSync(paths.source)) writeAtomic(paths.source, journal.sourceText);
    if (digest(readFileSync(paths.source, "utf8").replace(/\r\n/g, "\n")) !== journal.sourceDigest) {
      conflict("rollback did not restore the exact legacy source");
    }
    unlinkSync(paths.journal);
    releaseLock(paths, journal.token);
    return {
      schemaVersion: MIGRATION_SCHEMA_VERSION,
      packageId,
      state: "legacy-only",
      restoredDigest: journal.sourceDigest,
    };
  } catch (error) {
    if (existsSync(paths.lock)) {
      try { releaseLock(paths, journal.token); } catch { /* retain primary error */ }
    }
    throw error;
  }
}
