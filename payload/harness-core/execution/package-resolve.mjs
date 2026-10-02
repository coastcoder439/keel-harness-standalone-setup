// Resolve an abandoned or overtaken package: check it against every other bundle of the same
// repository first, then merge it into another package, update another package with its open
// steps, or withdraw it -- only with the Owner's wording (Owner 01.10.2026: "das bedeutet nicht
// dann einfach stilllegen, sondern gucken, ob man die Pakete zusammenführt oder aktualisiert.").
//
//   resolve      --harness-root H --root REPO --package SRC [--step N ...]
//                [--merge-into T | --update T | --withdraw --reason TEXT]
//                [--apply --owner-ok "<Wortlaut>"] [--unlazy-root DIR] [--json]
//   resolve-undo --harness-root H --root REPO --receipt FILE [--json]
//
// Without --apply every call is a preview and writes nothing, not even a receipt. With --apply
// the Owner-OK line for action resolve:<SRC> is bound to HEAD, a receipt under
// .unlazy/.resolve/ keeps every byte before the first write, a new doctor diagnostic rolls the
// whole change back, and resolve-undo restores the receipt. No bundle and no file is deleted,
// no plan step or gate is checked, the OWNER.md of SRC is never changed and a closed package is
// never resolved, because closed bundles stay project history.
//
// The file is also a module: the executor imports setAsideScope from here, so importing it has
// no side effect and loads no Unlazy module; those are imported per call from the located tree.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { replaceFileSync } from "./atomic-file.mjs";
import { formatOwnerOkLine, packageSection, parseOwnerOkLines, todayLocal, validateOwnerOk } from "./owner-ok.mjs";

const require = createRequire(import.meta.url);
const repository = require("../binding/repository.cjs");
const ownership = require("../binding/package-ownership.cjs");
const runtimeScopes = require("../binding/runtime-scopes.cjs");
const { locateUnlazy } = require("../binding/unlazy-runtime.cjs");

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const SENTENCE_MIN_LENGTH = 30;
const GOAL_JACCARD_MIN = 0.3;
const CANDIDATE_LIMIT = 10;
const PATH_TOKEN = /[\w.-]+(?:\/[\w.-]+)+\.\w+/gu;
const MODES = ["merge-into", "update", "withdraw"];

function fail(code, message, exitCode = 1) {
  const error = new Error(message);
  error.code = code;
  error.exitCode = exitCode;
  throw error;
}

function usage(message) {
  fail("USAGE", message, 2);
}

function sha256(buffer) {
  return "sha256:" + crypto.createHash("sha256").update(buffer).digest("hex");
}

function slash(value) {
  return String(value).split(path.sep).join("/");
}

function stamp(now) {
  return new Date(now).toISOString().replace(/[:.]/gu, "-");
}

// ---------------------------------------------------------------------------------------------
// Dormant runtime set-aside. Same behaviour as the executor's suspendDormantOverlaps: a scope
// whose runtime has not changed for DORMANT_DAYS and has no wave deadline ahead is moved
// unchanged to .unlazy/.suspended/; its package bundle stays untouched.

export const DORMANT_DAYS = 7;
export const DORMANT_MS = DORMANT_DAYS * 24 * 60 * 60 * 1000;

export function newestRuntimeChange(directory) {
  let newest = fs.lstatSync(directory).mtimeMs;
  const pending = [directory];
  let visited = 0;
  while (pending.length) {
    if (++visited > 10_000) return Date.now();
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      const info = fs.lstatSync(full);
      // A link inside runtime state is unusual; treat the scope as live instead of following it.
      if (info.isSymbolicLink()) return Date.now();
      newest = Math.max(newest, info.mtimeMs);
      if (info.isDirectory()) pending.push(full);
    }
  }
  return newest;
}

export function waveDeadlineAhead(directory, now) {
  let dispatchState;
  try { dispatchState = JSON.parse(fs.readFileSync(path.join(directory, "dispatch.json"), "utf8")); }
  catch { return false; }
  const deadlines = [];
  const collect = (value) => {
    if (!value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
      if (/deadline/iu.test(key) && typeof item === "string") deadlines.push(Date.parse(item));
      else if (item && typeof item === "object") collect(item);
    }
  };
  collect(dispatchState.waves);
  return deadlines.some((deadline) => Number.isFinite(deadline) && deadline > now);
}

export function moveScopeAside(repoRoot, scope, now, rootName = ".suspended") {
  const directory = path.join(repoRoot, ".unlazy", scope);
  const root = path.join(repoRoot, ".unlazy", rootName);
  fs.mkdirSync(root, { recursive: true });
  const destination = path.join(root, scope + "-" + stamp(now));
  fs.renameSync(directory, destination);
  return { scope, movedTo: slash(path.relative(repoRoot, destination)) };
}

export function setAsideScope(repoRoot, scope, now = Date.now()) {
  if (scope.startsWith(".")) return null;
  const directory = path.join(repoRoot, ".unlazy", scope);
  let info;
  try { info = fs.lstatSync(directory); } catch { return null; }
  if (info.isSymbolicLink() || !info.isDirectory()) return null;
  const lastChange = newestRuntimeChange(directory);
  if (now - lastChange < DORMANT_MS || waveDeadlineAhead(directory, now)) return null;
  const moved = moveScopeAside(repoRoot, scope, now);
  return { scope, lastChange: new Date(lastChange).toISOString(), movedTo: moved.movedTo };
}

// ---------------------------------------------------------------------------------------------
// Arguments and context.

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (command !== "resolve" && command !== "resolve-undo") usage("expected command resolve or resolve-undo");
  const options = { command, steps: [], modes: [] };
  for (let index = 0; index < rest.length; index += 1) {
    const key = rest[index];
    const take = () => {
      const value = rest[index + 1];
      if (value === undefined || (value.startsWith("--") && value.length > 2)) usage(key + " needs a value");
      index += 1;
      return value;
    };
    if (key === "--harness-root") options.harnessRoot = take();
    else if (key === "--root") options.root = take();
    else if (key === "--unlazy-root") options.unlazyRoot = take();
    else if (key === "--json") options.json = true;
    else if (command === "resolve-undo" && key === "--receipt") options.receipt = take();
    else if (command === "resolve" && key === "--package") options.packageId = take();
    else if (command === "resolve" && key === "--step") options.steps.push(take());
    else if (command === "resolve" && key === "--merge-into") options.modes.push({ mode: "merge-into", target: take() });
    else if (command === "resolve" && key === "--update") options.modes.push({ mode: "update", target: take() });
    else if (command === "resolve" && key === "--withdraw") options.modes.push({ mode: "withdraw", target: null });
    else if (command === "resolve" && key === "--reason") options.reason = take();
    else if (command === "resolve" && key === "--apply") options.apply = true;
    else if (command === "resolve" && key === "--owner-ok") options.ownerOk = take();
    else usage("unknown option for " + command + ": " + key);
  }
  if (command === "resolve-undo") {
    if (!options.receipt) usage("resolve-undo requires --receipt FILE");
    return options;
  }
  if (!IDENTIFIER.test(String(options.packageId || ""))) usage("--package must match " + IDENTIFIER);
  if (options.modes.length > 1) usage("use at most one of --merge-into, --update and --withdraw");
  const chosen = options.modes[0] || null;
  options.mode = chosen ? chosen.mode : null;
  options.target = chosen ? chosen.target : null;
  if (options.target !== null && !IDENTIFIER.test(String(options.target))) usage("--" + options.mode + " target must match " + IDENTIFIER);
  if (options.mode === "withdraw") {
    const reason = options.reason;
    if (typeof reason !== "string" || reason.length < 1 || reason.length > 500 || /[\r\n]/u.test(reason)) {
      usage("--withdraw requires --reason with 1..500 characters on one line");
    }
  } else if (options.reason !== undefined) usage("--reason belongs to --withdraw");
  if (options.steps.length && options.mode !== "update") usage("--step applies only with --update");
  options.steps = options.steps.map((value) => {
    if (!/^[1-9]\d{0,3}$/u.test(value)) usage("--step must name a plan step number: " + value);
    return Number(value);
  });
  if (new Set(options.steps).size !== options.steps.length) usage("--step names a step twice");
  if (options.ownerOk !== undefined) {
    const wording = options.ownerOk;
    if (wording.length < 1 || wording.length > 500 || /["\r\n]/u.test(wording)) {
      usage("--owner-ok must be 1..500 characters on one line without ASCII quotes");
    }
  }
  if (options.apply) {
    if (!options.mode) usage("--apply needs exactly one of --merge-into, --update and --withdraw");
    if (options.ownerOk === undefined) usage("--apply needs --owner-ok with the Owner's wording");
  }
  return options;
}

function contextFor(options) {
  const snapshot = repository.repositorySnapshot(options.root || process.cwd());
  const harnessRoot = path.resolve(options.harnessRoot || snapshot.repoRoot);
  const unlazyRoot = locateUnlazy(snapshot.repoRoot, options.unlazyRoot);
  return { repoRoot: snapshot.repoRoot, harnessRoot, snapshot, unlazyRoot };
}

async function unlazyModule(context, ...relative) {
  return import(pathToFileURL(path.join(context.unlazyRoot, "scripts", ...relative)).href);
}

// ---------------------------------------------------------------------------------------------
// Inventory: the one package measurement plus OWNER.md and OWNS of every bundle.

function readOwner(repoRoot, packageId) {
  const ownerContract = require("../binding/owner-contract.cjs");
  const packageDir = path.join(repoRoot, "docs", "packages", packageId);
  const file = path.join(packageDir, "OWNER.md");
  let present = false;
  try { present = fs.lstatSync(file).isFile(); } catch { present = false; }
  if (!present) return { present: false, readable: false, originalRequest: "", requirements: [], source: "", captured: "" };
  const inspected = ownerContract.inspectOwnerContract(repoRoot, packageDir, packageId);
  if (!inspected.present) return { present: true, readable: false, originalRequest: "", requirements: [], source: "", captured: "" };
  const parsed = ownerContract.parseOwnerContract(inspected.text, { packageId });
  return { present: true, readable: Boolean(parsed.originalRequest) && parsed.requirements.length > 0,
    originalRequest: parsed.originalRequest, requirements: parsed.requirements, source: parsed.source, captured: parsed.captured };
}

async function inventory(context) {
  let measured;
  try {
    const measure = await unlazyModule(context, "lib", "package-measure.mjs");
    measured = measure.measureRepositoryPackages({ root: context.repoRoot, verifiedRoot: true });
  } catch (error) {
    fail("RESOLVE_INVENTORY", "package measurement failed: " + error.message);
  }
  return measured.packages.map((record) => {
    let owner;
    try { owner = readOwner(context.repoRoot, record.packageId); }
    catch (error) { owner = { present: true, readable: false, originalRequest: "", requirements: [], source: "", captured: "", error: error.message }; }
    return {
      packageId: record.packageId,
      status: record.status,
      lifecycle: record.lifecycle,
      active: record.lifecycle === "active",
      closed: record.lifecycle === "closed" || record.status === "closed",
      scope: record.scope || null,
      fields: record.fields,
      steps: record.steps,
      owner,
      owns: ownership.packageOwnership(context.repoRoot, record.packageId).claims,
    };
  });
}

function sentences(text) {
  return String(text).split(/[.!?]+|[„“”]/u).map((raw) => ({ raw: raw.trim(), normalized: normalizeSentence(raw) }))
    .filter((item) => item.normalized.length >= SENTENCE_MIN_LENGTH);
}

function normalizeSentence(text) {
  return String(text).toLowerCase().replace(/[\p{P}]/gu, "").replace(/\s+/gu, " ").trim();
}

function goalWords(fields) {
  const text = [fields.problem, fields.intent, fields.goal].join(" ").toLowerCase()
    .replace(/ä/gu, "ae").replace(/ö/gu, "oe").replace(/ü/gu, "ue").replace(/ß/gu, "ss");
  return new Set((text.match(/\p{L}+/gu) || []).filter((word) => word.length >= 5));
}

function pathTokens(fields) {
  return new Set([fields.scope, fields.context].join("\n").match(PATH_TOKEN) || []);
}

function candidateOptions(source, candidate) {
  if (candidate.closed) return [];
  const options = ["update"];
  if (!candidate.active && source.owner.readable && candidate.owner.readable) options.push("merge-into");
  options.push("withdraw");
  return options;
}

function measureCandidates(source, packages) {
  const sourceSentences = source.owner.readable || source.owner.originalRequest ? sentences(source.owner.originalRequest) : [];
  const sourceWords = goalWords(source.fields);
  const sourcePaths = pathTokens(source.fields);
  const candidates = [];
  for (const candidate of packages) {
    if (candidate.packageId === source.packageId) continue;
    const signals = [];
    if (sourceSentences.length && candidate.owner.originalRequest) {
      const haystack = " " + normalizeSentence(candidate.owner.originalRequest) + " ";
      const shared = sourceSentences.filter((item) => haystack.includes(" " + item.normalized + " ")).map((item) => item.raw);
      if (shared.length) signals.push({ kind: "owner-sentence", sentences: [...new Set(shared)] });
    }
    const owns = [];
    for (const mine of source.owns) {
      for (const theirs of candidate.owns) {
        if (ownership.globsOverlap(mine.pattern, theirs.pattern)) {
          owns.push({ leaf: mine.leaf, pattern: mine.pattern, otherLeaf: theirs.leaf, otherPattern: theirs.pattern });
        }
      }
    }
    const theirPaths = pathTokens(candidate.fields);
    const paths = [...sourcePaths].filter((item) => theirPaths.has(item)).sort();
    if (owns.length || paths.length) signals.push({ kind: "files", owns, paths });
    const words = goalWords(candidate.fields);
    const common = [...sourceWords].filter((word) => words.has(word)).sort();
    const union = new Set([...sourceWords, ...words]).size;
    const jaccard = union ? common.length / union : 0;
    if (jaccard >= GOAL_JACCARD_MIN) signals.push({ kind: "goal", jaccard: Math.round(jaccard * 1000) / 1000, words: common });
    if (!signals.length) continue;
    candidates.push({ packageId: candidate.packageId, status: candidate.status, active: candidate.active,
      signals, options: candidateOptions(source, candidate), jaccard });
  }
  candidates.sort((left, right) => right.signals.length - left.signals.length || right.jaccard - left.jaccard ||
    (left.packageId < right.packageId ? -1 : left.packageId > right.packageId ? 1 : 0));
  return candidates.slice(0, CANDIDATE_LIMIT).map(({ jaccard, ...rest }) => rest);
}

function chooseTarget(options, source, packages) {
  if (!options.target) return null;
  const target = packages.find((item) => item.packageId === options.target);
  if (!target) fail("RESOLVE_TARGET_REFUSED", "target package does not exist: " + options.target);
  if (target.packageId === source.packageId) fail("RESOLVE_TARGET_REFUSED", "a package cannot be resolved into itself");
  if (target.closed) fail("RESOLVE_TARGET_REFUSED", "target package " + target.packageId + " is closed and stays project history");
  if (options.mode === "merge-into") {
    if (target.active) fail("RESOLVE_TARGET_REFUSED", "merge-into needs an inactive target; " + target.packageId + " is active, use --update");
    if (!target.owner.readable) fail("RESOLVE_TARGET_REFUSED", "merge-into needs a readable OWNER.md with Original request and Requirements in " + target.packageId);
    if (!source.owner.readable) fail("RESOLVE_TARGET_REFUSED", "merge-into needs a readable OWNER.md with Original request and Requirements in " + source.packageId);
  }
  return target;
}

// ---------------------------------------------------------------------------------------------
// Text edits. Every edit keeps the file's line ending; a missing section is RESOLVE_SHAPE.

function headingPattern(heading) {
  return new RegExp("^##\\s+" + String(heading).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&") + "\\s*$", "u");
}

function splitText(text) {
  return { eol: /\r\n/u.test(text) ? "\r\n" : "\n", lines: String(text).split(/\r?\n/u) };
}

function sectionBounds(lines, heading, file) {
  const pattern = headingPattern(heading);
  const start = lines.findIndex((line) => pattern.test(line));
  if (start === -1) fail("RESOLVE_SHAPE", file + " has no '## " + heading + "' section");
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s/u.test(lines[index])) { end = index; break; }
  }
  return { start, end };
}

// Append lines after the last non-blank line of a section.
function appendToSection(text, heading, added, file, blankBefore = false) {
  const { eol, lines } = splitText(text);
  const { start, end } = sectionBounds(lines, heading, file);
  let at = end;
  while (at > start + 1 && lines[at - 1].trim() === "") at -= 1;
  const insert = [...(blankBefore && at > start + 1 ? [""] : []), ...added];
  const after = lines.slice(at);
  if (after.length && after[0].trim() !== "" ) insert.push("");
  else if (at === end && end < lines.length) insert.push("");
  return [...lines.slice(0, at), ...insert, ...after].join(eol);
}

// The newest status entry stands directly under '## Status', one blank line before and after.
function prependStatus(text, entry, file) {
  const { eol, lines } = splitText(text);
  const { start, end } = sectionBounds(lines, "Status", file);
  let rest = start + 1;
  while (rest < end && lines[rest].trim() === "") rest += 1;
  return [...lines.slice(0, start + 1), "", entry, "", ...lines.slice(rest)].join(eol);
}

function appendToFile(text, added) {
  const { eol, lines } = splitText(text);
  let at = lines.length;
  while (at > 0 && lines[at - 1].trim() === "") at -= 1;
  return [...lines.slice(0, at), ...(at ? [""] : []), ...added, ""].join(eol);
}

function maxNumber(text, pattern) {
  let max = 0;
  for (const match of String(text).matchAll(pattern)) max = Math.max(max, Number(match[1]));
  return max;
}

function stepList(numbers) {
  return numbers.length ? numbers.join(", ") : "keine";
}

// ---------------------------------------------------------------------------------------------
// Planning: every new file content is computed before anything is written.

function readText(repoRoot, relative) {
  const file = path.join(repoRoot, ...relative.split("/"));
  let buffer;
  try { buffer = fs.readFileSync(file); } catch { fail("RESOLVE_SHAPE", relative + " is missing"); }
  return { relative, file, buffer, text: buffer.toString("utf8") };
}

function bundlePath(packageId, name) {
  return "docs/packages/" + packageId + "/" + name;
}

function openSteps(source, wanted) {
  const open = source.steps.filter((step) => !step.done);
  if (!wanted.length) return open;
  return wanted.map((number) => {
    const step = source.steps.find((item) => item.number === number);
    if (!step) usage("--step " + number + " is not a plan step of " + source.packageId);
    if (step.done) usage("--step " + number + " of " + source.packageId + " is already done");
    return step;
  });
}

function planSteps(sourceId, steps, target) {
  const existing = new Set(target.steps.map((step) => step.text.trim()));
  let next = target.steps.length + 1;
  const lines = [];
  for (const step of steps) {
    const suffixed = step.text.trim() + " (aus " + sourceId + " Schritt " + step.number + ")";
    if (existing.has(step.text.trim()) || existing.has(suffixed)) continue;
    lines.push(next + ". [ ] " + suffixed);
    next += 1;
  }
  return lines;
}

function buildPlan(context, options, source, target, wording, now) {
  const date = todayLocal(new Date(now));
  const quote = "Owner: „" + wording + "“";
  const receiptRelative = ".unlazy/.resolve/" + source.packageId + "-" + stamp(now) + ".json";
  const undo = "Rückgängig: package-resolve.mjs resolve-undo --receipt " + receiptRelative;
  const edits = new Map();
  const edit = (relative, change) => {
    const current = edits.get(relative) || { ...readText(context.repoRoot, relative), inserted: [] };
    const result = change(current.text);
    current.text = result.text;
    current.inserted.push(...result.inserted);
    edits.set(relative, current);
  };
  const sourcePackage = bundlePath(source.packageId, "PACKAGE.md");
  let resolvesWhole = true;
  let blockedLabel = null;
  let steps = [];

  if (options.mode === "withdraw") {
    blockedLabel = "BLOCKED: stillgelegt, Grund: " + options.reason;
  } else if (options.mode === "update") {
    steps = openSteps(source, options.steps);
    resolvesWhole = options.steps.length === 0;
    const added = planSteps(source.packageId, steps, target);
    const targetPackage = bundlePath(target.packageId, "PACKAGE.md");
    if (added.length) edit(targetPackage, (text) => ({ text: appendToSection(text, "Plan", added, targetPackage), inserted: added }));
    const ownerNote = source.owner.present ? "Owner-Wortlaut unverändert in " + bundlePath(source.packageId, "OWNER.md") : "SRC ohne OWNER.md";
    const status = date + " - Aktualisiert aus " + source.packageId + " (Schritte " + stepList(steps.map((step) => step.number)) + "); " +
      ownerNote + "; " + quote;
    edit(targetPackage, (text) => ({ text: prependStatus(text, status, targetPackage), inserted: [status] }));
    if (resolvesWhole) blockedLabel = "BLOCKED: in " + target.packageId + " aufgegangen";
    else {
      const numbers = steps.map((step) => step.number);
      const label = (numbers.length === 1 ? "Schritt " : "Schritte ") + numbers.join(", ");
      const entry = date + " - " + label + " aufgegangen in " + target.packageId + " (" + quote + ")";
      edit(sourcePackage, (text) => ({ text: prependStatus(text, entry, sourcePackage), inserted: [entry] }));
    }
  } else if (options.mode === "merge-into") {
    steps = openSteps(source, []);
    const targetOwner = bundlePath(target.packageId, "OWNER.md");
    const targetPackage = bundlePath(target.packageId, "PACKAGE.md");
    const targetGates = bundlePath(target.packageId, "GATES.md");
    const sourcePackageText = readText(context.repoRoot, sourcePackage).text;
    const sourceAbnahme = packageSection(sourcePackageText, "Abnahme");
    const sourceMapping = new Map();
    for (const match of sourceAbnahme.matchAll(/^- (C\d+) -> (\S+?\.md):([A-Za-z0-9][A-Za-z0-9._-]{0,63}): /gmu)) {
      sourceMapping.set(match[1], match[2] + ":" + match[3]);
    }
    const n = target.owner.requirements.length;
    const targetPackageText = readText(context.repoRoot, targetPackage).text;
    const m = maxNumber(packageSection(targetPackageText, "Abnahme"), /^- C(\d+) -> /gmu);
    const g = maxNumber(readText(context.repoRoot, targetGates).text, /^- \[[ xX]\] M(\d+):/gmu);
    const header = "Übernommen aus " + source.packageId + " am " + date + " (Source: " + source.owner.source +
      ", Captured: " + source.owner.captured + "), wörtlich:";
    const request = ["", header, "", ...source.owner.originalRequest.split(/\r?\n/u)];
    const requirements = [];
    const contracts = [];
    const gates = [];
    source.owner.requirements.forEach((item, index) => {
      const k = index + 1;
      requirements.push("- R" + (n + k) + " -> C" + (m + k) + ": " + item.text);
      contracts.push("- C" + (m + k) + " -> GATES.md:M" + (g + k) + ": " + item.text);
      if (gates.length) gates.push("");
      gates.push("- [ ] M" + (g + k) + ": " + item.text,
        "  Manuell: übernommen aus " + source.packageId + " " + (sourceMapping.get(item.contractId) || "ohne Gate"),
        "  EVIDENCE: pending");
    });
    edit(targetOwner, (text) => ({ text: appendToSection(text, "Original request", request, targetOwner), inserted: request }));
    edit(targetOwner, (text) => ({ text: appendToSection(text, "Requirements", requirements, targetOwner), inserted: requirements }));
    edit(targetPackage, (text) => ({ text: appendToSection(text, "Abnahme", contracts, targetPackage), inserted: contracts }));
    edit(targetGates, (text) => ({ text: appendToFile(text, gates), inserted: gates }));
    const added = planSteps(source.packageId, steps, target);
    if (added.length) edit(targetPackage, (text) => ({ text: appendToSection(text, "Plan", added, targetPackage), inserted: added }));
    const status = date + " - Zusammengeführt aus " + source.packageId + ": Owner-Wortlaut wörtlich in OWNER.md, Anforderungen R" +
      (n + 1) + " bis R" + (n + requirements.length) + ", Schritte " + stepList(steps.map((step) => step.number)) + "; " + quote;
    edit(targetPackage, (text) => ({ text: prependStatus(text, status, targetPackage), inserted: [status] }));
    blockedLabel = "BLOCKED: zusammengeführt in " + target.packageId;
  }
  if (blockedLabel) {
    const entry = date + " - " + blockedLabel + "; " + quote + "; " + undo;
    edit(sourcePackage, (text) => ({ text: prependStatus(text, entry, sourcePackage), inserted: [entry] }));
  }
  const runtime = resolvesWhole && source.active && source.scope
    ? { scope: source.scope, movedTo: ".unlazy/.suspended/" + source.scope + "-" + stamp(now) } : null;
  return { mode: options.mode, source: source.packageId, target: target ? target.packageId : null,
    steps: steps.map((step) => step.number), reason: options.reason ?? null, receiptRelative,
    files: [...edits.values()], runtime };
}

// ---------------------------------------------------------------------------------------------
// doctor, receipt, apply, rollback and undo.

function doctor(context, packageId) {
  const result = spawnSync(process.execPath, [path.join(context.unlazyRoot, "scripts", "package-cli.mjs"), "doctor",
    "--root", context.repoRoot, "--package", packageId, "--json"],
  { cwd: context.repoRoot, encoding: "utf8", windowsHide: true, timeout: 120_000 });
  let parsed = null;
  try { parsed = JSON.parse(result.stdout); } catch { /* reported below */ }
  const diagnostics = parsed?.packages?.[0]?.diagnostics ??
    [{ code: "DOCTOR_OUTPUT", message: String(result.stderr || result.stdout || result.error?.message || "").trim() }];
  return { ok: result.status === 0 && diagnostics.length === 0, diagnostics };
}

function diagnosticCounts(diagnostics) {
  const counts = new Map();
  for (const item of diagnostics) counts.set(item.code, (counts.get(item.code) || 0) + 1);
  return counts;
}

function newDiagnostics(before, after) {
  const counts = diagnosticCounts(before.diagnostics);
  const seen = new Map();
  const added = [];
  for (const item of after.diagnostics) {
    seen.set(item.code, (seen.get(item.code) || 0) + 1);
    if (seen.get(item.code) > (counts.get(item.code) || 0)) added.push(item);
  }
  return added;
}

function writeAtomic(file, buffer) {
  const temp = file + ".resolve-" + process.pid + "-" + crypto.randomBytes(4).toString("hex") + ".tmp";
  fs.writeFileSync(temp, buffer);
  try { replaceFileSync(temp, file); }
  catch (error) { try { fs.unlinkSync(temp); } catch { /* the temp file is gone already */ } throw error; }
}

function writeJson(file, value) {
  writeAtomic(file, Buffer.from(JSON.stringify(value, null, 2) + "\n", "utf8"));
}

function restoreFromReceipt(repoRoot, receipt) {
  for (const entry of receipt.files) {
    writeAtomic(path.join(repoRoot, ...entry.path.split("/")), Buffer.from(entry.before, "base64"));
  }
  if (receipt.runtime && receipt.runtime.moved) {
    const back = path.join(repoRoot, ".unlazy", receipt.runtime.scope);
    fs.renameSync(path.join(repoRoot, ...receipt.runtime.movedTo.split("/")), back);
  }
}

function renameReceipt(file, suffix) {
  const destination = file.replace(/\.json$/u, suffix);
  fs.renameSync(file, destination);
  return destination;
}

async function applyPlan(context, plan, source, target, wording, now) {
  const head = context.snapshot.headOid;
  if (!head) fail("RESOLVE_NO_HEAD", "the repository has no HEAD commit to bind the Owner-OK line to");
  const line = formatOwnerOkLine({ action: "resolve", target: source.packageId, date: todayLocal(new Date(now)), commit: head, wording });
  validateOwnerOk(parseOwnerOkLines(line)[0], { action: "resolve", target: source.packageId, head });
  try {
    const lifecycle = await unlazyModule(context, "lib", "package-lifecycle.mjs");
    lifecycle.assertRuntimeIgnored(context.repoRoot);
  } catch (error) {
    fail("RESOLVE_RUNTIME_NOT_IGNORED", error.message);
  }
  for (const record of [plan.runtime ? source : null, plan.mode === "update" && target.active ? target : null]) {
    if (!record || !record.scope) continue;
    const reason = runtimeScopes.busyReason(context.repoRoot, record.scope);
    if (reason) fail("RESOLVE_BUSY", reason);
    if (waveDeadlineAhead(path.join(context.repoRoot, ".unlazy", record.scope), now)) {
      fail("RESOLVE_BUSY", "scope " + record.scope + " is busy: a dispatch wave deadline lies ahead");
    }
  }
  const checked = [source.packageId, ...(target ? [target.packageId] : [])];
  const baseline = new Map(checked.map((id) => [id, doctor(context, id)]));

  const receiptFile = path.join(context.repoRoot, ...plan.receiptRelative.split("/"));
  const receipt = {
    schemaVersion: 1,
    command: "resolve",
    mode: plan.mode,
    source: plan.source,
    target: plan.target,
    steps: plan.steps,
    reason: plan.reason,
    ownerOk: { line, sha256: sha256(Buffer.from(line, "utf8")) },
    head,
    createdAt: new Date(now).toISOString(),
    files: plan.files.map((entry) => ({ path: entry.relative, before: entry.buffer.toString("base64"),
      beforeSha256: sha256(entry.buffer), afterSha256: null })),
    runtime: plan.runtime ? { ...plan.runtime, moved: false } : null,
  };
  fs.mkdirSync(path.dirname(receiptFile), { recursive: true });
  if (fs.existsSync(receiptFile)) fail("RESOLVE_RECEIPT_EXISTS", "receipt already exists: " + plan.receiptRelative);
  writeJson(receiptFile, receipt);

  try {
    for (const [index, entry] of plan.files.entries()) {
      const after = Buffer.from(entry.text, "utf8");
      writeAtomic(entry.file, after);
      receipt.files[index].afterSha256 = sha256(after);
    }
    if (plan.runtime) {
      const moved = moveScopeAside(context.repoRoot, plan.runtime.scope, now);
      receipt.runtime = { ...moved, moved: true };
    }
    writeJson(receiptFile, receipt);
  } catch (error) {
    restoreFromReceipt(context.repoRoot, receipt);
    renameReceipt(receiptFile, ".rolledback.json");
    throw error;
  }

  const added = [];
  for (const id of checked) {
    for (const item of newDiagnostics(baseline.get(id), doctor(context, id))) added.push({ packageId: id, ...item });
  }
  if (added.length) {
    restoreFromReceipt(context.repoRoot, receipt);
    const rolledBack = renameReceipt(receiptFile, ".rolledback.json");
    const error = new Error("the change added doctor diagnostics and was rolled back (" +
      slash(path.relative(context.repoRoot, rolledBack)) + "): " +
      added.map((item) => item.packageId + " " + item.code + ": " + item.message).join("; "));
    error.code = "RESOLVE_DOCTOR";
    error.exitCode = 2;
    error.diagnostics = added;
    throw error;
  }
  return { receipt: plan.receiptRelative, ownerOk: line, files: receipt.files.map((entry) => entry.path), runtime: receipt.runtime };
}

async function resolve(options) {
  const context = contextFor(options);
  const packages = await inventory(context);
  const source = packages.find((item) => item.packageId === options.packageId);
  if (!source) fail("RESOLVE_SOURCE_REFUSED", "package does not exist in this repository: " + options.packageId);
  if (source.closed) fail("RESOLVE_SOURCE_REFUSED", "package " + source.packageId + " is closed and stays project history");
  const candidates = measureCandidates(source, packages);
  const target = chooseTarget(options, source, packages);
  const report = {
    command: "resolve",
    applied: false,
    repoRoot: context.repoRoot,
    source: { packageId: source.packageId, status: source.status, active: source.active, scope: source.scope,
      owner: source.owner.present },
    candidates,
  };
  if (!options.mode) return report;
  const now = Date.now();
  const wording = options.ownerOk ?? "<Owner-Wortlaut>";
  const plan = buildPlan(context, options, source, target, wording, now);
  report.mode = plan.mode;
  report.target = plan.target;
  report.steps = plan.steps;
  if (!options.apply) {
    report.preview = { files: plan.files.map((entry) => ({ path: entry.relative, insert: entry.inserted })), runtime: plan.runtime };
    return report;
  }
  const result = await applyPlan(context, plan, source, target, options.ownerOk, now);
  return { ...report, applied: true, ...result };
}

function undoReceiptFile(context, value) {
  const base = path.join(context.repoRoot, ".unlazy", ".resolve");
  const file = path.resolve(context.repoRoot, String(value));
  const relative = path.relative(base, file);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || relative.includes(path.sep)) {
    usage("--receipt must name a file directly under .unlazy/.resolve/");
  }
  if (!/\.json$/u.test(file) || /\.(?:undone|rolledback)\.json$/u.test(file)) usage("--receipt must be an open resolve receipt (.json)");
  let info;
  try { info = fs.lstatSync(file); } catch { usage("--receipt does not exist: " + slash(path.relative(context.repoRoot, file))); }
  if (info.isSymbolicLink() || !info.isFile()) usage("--receipt must be a regular file");
  return file;
}

async function resolveUndo(options) {
  const snapshot = repository.repositorySnapshot(options.root || process.cwd());
  const context = { repoRoot: snapshot.repoRoot };
  const file = undoReceiptFile(context, options.receipt);
  let receipt;
  try { receipt = JSON.parse(fs.readFileSync(file, "utf8")); } catch { usage("--receipt is not valid JSON"); }
  if (!receipt || receipt.command !== "resolve" || !Array.isArray(receipt.files)) usage("--receipt is not a resolve receipt");
  const changed = [];
  for (const entry of receipt.files) {
    if (typeof entry.path !== "string" || entry.path.split("/").includes("..")) usage("--receipt names an invalid path");
    let current = null;
    try { current = sha256(fs.readFileSync(path.join(context.repoRoot, ...entry.path.split("/")))); } catch { current = null; }
    if (!entry.afterSha256 || current !== entry.afterSha256) changed.push(entry.path);
  }
  if (receipt.runtime && receipt.runtime.moved) {
    if (fs.existsSync(path.join(context.repoRoot, ".unlazy", receipt.runtime.scope))) changed.push(".unlazy/" + receipt.runtime.scope);
    if (!fs.existsSync(path.join(context.repoRoot, ...receipt.runtime.movedTo.split("/")))) changed.push(receipt.runtime.movedTo);
  }
  if (changed.length) fail("RESOLVE_UNDO_CHANGED", "changed since the resolve, nothing was undone: " + changed.join(", "));
  restoreFromReceipt(context.repoRoot, receipt);
  const undone = renameReceipt(file, ".undone.json");
  return { command: "resolve-undo", repoRoot: context.repoRoot, restored: receipt.files.map((entry) => entry.path),
    runtime: receipt.runtime && receipt.runtime.moved ? { scope: receipt.runtime.scope, restoredFrom: receipt.runtime.movedTo } : null,
    receipt: slash(path.relative(context.repoRoot, undone)) };
}

function printHuman(result) {
  if (result.command === "resolve-undo") {
    console.log("resolve-undo: restored " + result.restored.join(", ") + (result.runtime ? "; runtime .unlazy/" + result.runtime.scope : ""));
    console.log("receipt: " + result.receipt);
    return;
  }
  console.log("package " + result.source.packageId + " (" + result.source.status + (result.source.active ? ", active" : "") + ")");
  if (!result.candidates.length) console.log("no other package shares an Owner sentence, files or goal");
  for (const candidate of result.candidates) {
    console.log("- " + candidate.packageId + " (" + candidate.status + (candidate.active ? ", active" : "") + "): " +
      candidate.signals.map((signal) => signal.kind === "owner-sentence" ? "owner sentence " + JSON.stringify(signal.sentences)
        : signal.kind === "files" ? "files " + JSON.stringify({ owns: signal.owns, paths: signal.paths })
          : "goal jaccard " + signal.jaccard + " " + JSON.stringify(signal.words)).join("; ") +
      "; options: " + (candidate.options.length ? candidate.options.join(", ") : "none"));
  }
  if (result.preview) {
    for (const entry of result.preview.files) {
      console.log("would insert into " + entry.path + ":");
      for (const line of entry.insert) console.log("  + " + line);
    }
    if (result.preview.runtime) console.log("would move .unlazy/" + result.preview.runtime.scope + " to " + result.preview.runtime.movedTo);
  }
  if (result.applied) {
    console.log("applied " + result.mode + "; changed " + result.files.join(", "));
    console.log("receipt: " + result.receipt);
  }
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const result = options.command === "resolve" ? await resolve(options) : await resolveUndo(options);
  if (options.json) console.log(JSON.stringify(result, null, 2));
  else printHuman(result);
  return result;
}

export { MODES, CANDIDATE_LIMIT, GOAL_JACCARD_MIN, SENTENCE_MIN_LENGTH };

function isProcessEntry() {
  const entry = process.argv[1];
  if (!entry) return false;
  try { return pathToFileURL(fs.realpathSync(entry)).href === pathToFileURL(fs.realpathSync(fileURLToPath(import.meta.url))).href; }
  catch { return false; }
}

if (isProcessEntry()) {
  main().catch((error) => {
    const code = error.code || "PACKAGE_RESOLVE";
    console.error("package-resolve: " + code + ": " + error.message);
    if (process.argv.includes("--json")) {
      process.stderr.write(JSON.stringify({ error: { code, message: error.message,
        ...(error.diagnostics ? { diagnostics: error.diagnostics } : {}) } }) + "\n");
    }
    process.exitCode = error.exitCode || 2;
  });
}
