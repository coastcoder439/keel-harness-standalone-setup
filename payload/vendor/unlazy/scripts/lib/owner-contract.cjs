"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const CONFIG_FILE = ".keel-harness.json";
const OWNER_FILE = "OWNER.md";
const REQUIREMENT_RE = /^- (R\d+) -> (C\d+): (\S.*)$/u;
const OWNER_BOUNDARIES = Object.freeze(["activate", "dispatch", "return", "integration", "close"]);

// The Original request ends at this marker line, never at a heading inside the Owner's text (C7). A file without the
// marker (the older format) is still read: its request ends at the next "## " heading, as before, so the request
// digest of a package that is already bound does not change.
const OWNER_END_MARKER = "<!-- owner-end -->";
const MARKER_LINE = /^<!-- owner-end -->[ \t]*$/u;
const REQUEST_HEADING = /^## Original request\s*$/u;
const REQUIREMENTS_HEADING = /^## Requirements\s*$/u;

function digest(value) {
  return "sha256:" + crypto.createHash("sha256").update(value).digest("hex");
}

function requirementsDigest(requirements = []) {
  const canonical = requirements.map((item) => ({
    requirementId: item.requirementId,
    contractId: item.contractId,
    text: item.text,
  }));
  return digest(JSON.stringify(canonical));
}

function ownerBindingError(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function diagnostic(code, message, file = OWNER_FILE) {
  return { code, file, message };
}

function readRegular(file, label) {
  if (!fs.existsSync(file)) return null;
  const info = fs.lstatSync(file);
  if (info.isSymbolicLink() || !info.isFile() || (typeof info.nlink === "number" && info.nlink !== 1)) {
    const error = new Error(label + " must be a single-link regular file");
    error.code = "OWNER_CONTRACT_FILE";
    throw error;
  }
  return fs.readFileSync(file, "utf8");
}

function harnessConfig(repoRoot) {
  const file = path.join(repoRoot, CONFIG_FILE);
  const text = readRegular(file, CONFIG_FILE);
  if (text === null) return { required: false, standardFormat: false, diagnostics: [] };
  let value;
  try { value = JSON.parse(text); }
  catch { return { required: true, standardFormat: false, diagnostics: [diagnostic("HARNESS_CONFIG_JSON", CONFIG_FILE + " is invalid JSON", CONFIG_FILE)] }; }
  if (!value || value.schemaVersion !== 1 || value.packageContract?.ownerContractRequired !== true) {
    return { required: true, standardFormat: false, diagnostics: [diagnostic(
      "HARNESS_CONFIG_SCHEMA",
      CONFIG_FILE + " must use schemaVersion 1 and packageContract.ownerContractRequired=true",
      CONFIG_FILE,
    )] };
  }
  // Keel package standard: Scope and Context become required PACKAGE.md fields
  // when the repository opts in. Absent means off, so upstream-shaped
  // repositories keep their contract unchanged.
  const standard = value.packageContract.standardFormatRequired;
  if (standard !== undefined && typeof standard !== "boolean") {
    return { required: true, standardFormat: false, diagnostics: [diagnostic(
      "HARNESS_CONFIG_SCHEMA",
      CONFIG_FILE + " packageContract.standardFormatRequired must be true or false",
      CONFIG_FILE,
    )] };
  }
  return { required: true, standardFormat: standard === true, diagnostics: [] };
}

function section(text, name) {
  const pattern = new RegExp("^## " + name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&") + "\\s*$", "mu");
  const match = pattern.exec(text);
  if (!match) return null;
  const rest = text.slice(match.index + match[0].length).replace(/^\r?\n/u, "");
  const next = rest.search(/^## /mu);
  return (next === -1 ? rest : rest.slice(0, next)).trim();
}

function lastIndexWhere(lines, test) {
  for (let index = lines.length - 1; index >= 0; index -= 1) if (test(lines[index])) return index;
  return -1;
}

// Splits an OWNER.md at its Original request. With an end marker (the current format) the request is every line
// between the heading and the LAST marker line, whatever the text holds (headings, "Schema:" lines, a quoted
// marker); the header fields are read only above the heading and the requirements only below the marker. Without
// a marker (older files) the parts are the old ones: the whole text, and the request up to the next "## " heading.
// requestText is always the complete text between the heading and "## Requirements", for the order given to an agent.
function splitOwnerContract(source) {
  const lines = String(source).split(/\r?\n/u);
  const heading = lines.findIndex((line) => REQUEST_HEADING.test(line));
  const marker = lastIndexWhere(lines, (line) => MARKER_LINE.test(line));
  if (heading !== -1 && marker > heading) {
    const request = lines.slice(heading + 1, marker).join("\n").replace(/^(?:[ \t]*\n)+/u, "").replace(/\s+$/u, "");
    return { marked: true, header: lines.slice(0, heading).join("\n"), tail: lines.slice(marker + 1).join("\n"),
      request, requestText: request };
  }
  let requestText = "";
  if (heading !== -1) {
    const after = lines.slice(heading + 1);
    const stop = after.findIndex((line) => REQUIREMENTS_HEADING.test(line));
    requestText = (stop === -1 ? after : after.slice(0, stop)).join("\n").trim();
  }
  return { marked: false, header: String(source), tail: String(source), request: null, requestText };
}

// The Original request section for a new OWNER.md: the Owner's text as it is (line breaks as LF), then the marker.
function formatOwnerRequestSection(request) {
  const text = String(request ?? "").replace(/\r\n?/gu, "\n").replace(/^(?:[ \t]*\n)+/u, "").replace(/\s+$/u, "");
  return "## Original request\n\n" + text + "\n" + OWNER_END_MARKER + "\n";
}

// The known template texts that stand in for an Owner request not captured yet: the skeleton of package-cli create, the
// request line of templates/OWNER.md and an open "[AUSFUELLEN]".
const PLACEHOLDER_LINES = Object.freeze([
  "<Copy the original Owner request here verbatim before activation.>",
  "<Copy the Owner request here without replacing it with the implementation plan.>",
  "[AUSFUELLEN]",
]);

// A request is a placeholder only when, blank lines aside, every line is one of the known template texts. Angle
// brackets are ordinary text of an order ("<Button>", "Map<string, number>"), never a placeholder of their own.
function isPlaceholderRequest(text) {
  const lines = String(text || "").split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  return lines.length > 0 && lines.every((line) => PLACEHOLDER_LINES.includes(line));
}

function parseOwnerContract(text, options = {}) {
  const source = String(text || "");
  const diagnostics = [];
  const parts = splitOwnerContract(source);
  if (!source.endsWith("\n")) diagnostics.push(diagnostic("OWNER_FINAL_NEWLINE", OWNER_FILE + " must end with a newline"));
  const head = parts.marked ? parts.header : source;
  const titles = [...head.matchAll(/^# Owner contract: (\S.*)$/gmu)];
  if (titles.length !== 1) diagnostics.push(diagnostic("OWNER_TITLE", "exactly one '# Owner contract: <packageId>' title is required"));
  else if (options.packageId && titles[0][1].trim() !== options.packageId) {
    diagnostics.push(diagnostic("OWNER_TITLE_ID", "Owner contract packageId does not match " + options.packageId));
  }
  const schema = [...head.matchAll(/^Schema:\s*(\S.*)$/gmu)];
  if (schema.length !== 1 || schema[0][1].trim() !== "1") diagnostics.push(diagnostic("OWNER_SCHEMA", "Schema must be exactly 1"));
  const origin = [...head.matchAll(/^Source:\s*(\S.*)$/gmu)];
  if (origin.length !== 1 || !origin[0][1].trim()) diagnostics.push(diagnostic("OWNER_SOURCE", "exactly one non-empty Source is required"));
  const captured = [...head.matchAll(/^Captured:\s*(\S.*)$/gmu)];
  if (captured.length !== 1 || !/^\d{4}-\d{2}-\d{2}$/u.test(captured[0][1].trim())) {
    diagnostics.push(diagnostic("OWNER_CAPTURED", "Captured must be one YYYY-MM-DD value"));
  }

  // No minimum length (D2): a five-character order is an order. Empty and placeholder stay refused.
  const originalRequest = parts.marked ? parts.request : section(source, "Original request");
  if (!originalRequest || isPlaceholderRequest(originalRequest)) {
    diagnostics.push(diagnostic("OWNER_REQUEST", "Original request must contain the non-placeholder Owner request"));
  }
  const requirementsBlock = section(parts.marked ? parts.tail : source, "Requirements");
  const requirements = [];
  for (const line of String(requirementsBlock || "").split(/\r?\n/u).filter((item) => item.trim())) {
    const match = line.match(REQUIREMENT_RE);
    if (!match) {
      diagnostics.push(diagnostic("OWNER_REQUIREMENT_LINE", "requirement lines must match '- R<n> -> C<n>: <requirement>': " + line));
      continue;
    }
    requirements.push({ requirementId: match[1], contractId: match[2], text: match[3] });
  }
  if (!requirements.length) diagnostics.push(diagnostic("OWNER_REQUIREMENTS_EMPTY", "at least one Owner requirement is required"));
  const knownContracts = new Set(options.contractIds || []);
  const seen = new Set();
  for (let index = 0; index < requirements.length; index += 1) {
    const item = requirements[index];
    const expected = "R" + (index + 1);
    if (item.requirementId !== expected) diagnostics.push(diagnostic("OWNER_REQUIREMENT_NUMBER", item.requirementId + " must be numbered " + expected));
    if (seen.has(item.requirementId)) diagnostics.push(diagnostic("OWNER_REQUIREMENT_DUPLICATE", "duplicate " + item.requirementId));
    seen.add(item.requirementId);
    if (knownContracts.size && !knownContracts.has(item.contractId)) {
      diagnostics.push(diagnostic("OWNER_REQUIREMENT_UNKNOWN_CONTRACT", item.requirementId + " maps unknown " + item.contractId));
    }
  }
  return {
    text: source,
    packageId: titles.length === 1 ? titles[0][1].trim() : options.packageId || "",
    digest: digest(source),
    requestDigest: digest(originalRequest || ""),
    requirementsDigest: requirementsDigest(requirements),
    diagnostics,
    originalRequest: originalRequest || "",
    requestText: parts.marked ? parts.request : (parts.requestText || originalRequest || ""),
    endMarker: parts.marked,
    source: origin.length === 1 ? origin[0][1].trim() : "",
    captured: captured.length === 1 ? captured[0][1].trim() : "",
    requirements,
  };
}

function inspectOwnerContract(repoRoot, packageDir, packageId, contractIds = []) {
  const config = harnessConfig(repoRoot);
  const file = path.join(packageDir, OWNER_FILE);
  const diagnostics = [...config.diagnostics];
  let text = null;
  try { text = readRegular(file, OWNER_FILE); }
  catch (error) { diagnostics.push(diagnostic("OWNER_FILE_TYPE", error.message)); }
  if (text === null) {
    if (config.required) diagnostics.push(diagnostic("OWNER_MISSING", "bundle requires OWNER.md with the original Owner request"));
    return { required: config.required, present: false, complete: !config.required && diagnostics.length === 0,
      file, packageId, digest: null, requestDigest: null, requirementsDigest: requirementsDigest([]),
      originalRequest: "", requestText: "", endMarker: false, requirements: [], diagnostics };
  }
  const parsed = parseOwnerContract(text, { packageId, contractIds });
  diagnostics.push(...parsed.diagnostics);
  return { required: config.required, present: true, complete: diagnostics.length === 0, file, ...parsed, diagnostics };
}

function createOwnerBinding(owner, options = {}) {
  if (!owner || owner.complete !== true) {
    ownerBindingError("OWNER_BINDING_INCOMPLETE", "cannot bind an incomplete Owner contract");
  }
  const packageId = String(options.packageId || owner.packageId || "").trim();
  if (!packageId) ownerBindingError("OWNER_BINDING_PACKAGE", "Owner binding requires packageId");
  const requirements = Array.isArray(owner.requirements) ? owner.requirements : [];
  return Object.freeze({
    schemaVersion: 1,
    packageId,
    required: owner.required === true,
    present: owner.present === true,
    ownerDigest: owner.digest ?? null,
    requestDigest: owner.requestDigest ?? null,
    requirementsDigest: owner.requirementsDigest || requirementsDigest(requirements),
    requirementCount: requirements.length,
  });
}

function assertOwnerBinding(owner, binding, boundary, options = {}) {
  if (!OWNER_BOUNDARIES.includes(boundary)) {
    ownerBindingError("OWNER_BINDING_BOUNDARY", "unknown Owner lifecycle boundary " + JSON.stringify(boundary));
  }
  if (!binding || binding.schemaVersion !== 1) {
    ownerBindingError("OWNER_BINDING_SCHEMA", boundary + " requires Owner binding schemaVersion 1");
  }
  const current = createOwnerBinding(owner, { packageId: options.packageId || binding.packageId });
  for (const field of [
    "packageId", "required", "present", "ownerDigest", "requestDigest", "requirementsDigest", "requirementCount",
  ]) {
    if (binding[field] !== current[field]) {
      ownerBindingError(
        "OWNER_BINDING_CHANGED",
        boundary + " rejected changed immutable Owner field " + field,
      );
    }
  }
  return current;
}

module.exports = {
  CONFIG_FILE,
  OWNER_BOUNDARIES,
  OWNER_END_MARKER,
  OWNER_FILE,
  assertOwnerBinding,
  createOwnerBinding,
  formatOwnerRequestSection,
  harnessConfig,
  inspectOwnerContract,
  PLACEHOLDER_LINES,
  isPlaceholderRequest,
  parseOwnerContract,
  requirementsDigest,
  splitOwnerContract,
};
