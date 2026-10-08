"use strict";
// The normalization of package contract files (ticks, Status, Abschluss, EVIDENCE are runtime
// state, not code) and the schema names of stored check results. Zero dependencies, CommonJS,
// so that every Node the Harness supports can load it synchronously: the proof store
// (proof-store.mjs) imports it, test-harness/checks/audit-lib.mjs re-exports it from there, and
// the Harness's git-intent loads it with createRequire. This is the one source.

// The old note form (one JSON document), still read; written is only the line form.
const PROOF_SCHEMA = "keel-proof.v1";
const PROOF_ENTRY_SCHEMA = "keel-proof.v2-entry";

function packageContractPath(local) {
  return /^docs\/packages\/[^/]+\/(?:OWNER\.md|PACKAGE\.md|GATES\.md|gates\/[^/]+\.md)$/u.test(local);
}

function replaceMarkdownSectionBody(text, heading, replacement) {
  const marker = `## ${heading}\n`;
  const start = text.indexOf(marker);
  if (start < 0) return text;
  const bodyStart = start + marker.length;
  const next = /^## /mu.exec(text.slice(bodyStart));
  const bodyEnd = next ? bodyStart + next.index : text.length;
  return text.slice(0, bodyStart) + replacement + "\n\n" + text.slice(bodyEnd);
}

// The runtime state of a gate ledger (GATES.md, gates/<leaf>.md): gate checkboxes and EVIDENCE
// values. Every pattern is strictly line-local ([ \t], [^\S\n] and [^\n] never span a newline): a
// pattern that could span one lets an empty EVIDENCE line swallow the following line, which
// would mask a changed contract line. This is the one ledger normalization; the Harness's
// git-intent (normalizedLedger) uses this very function.
function normalizeLedgerText(value) {
  return String(value)
    .replace(/\r\n?/gu, "\n")
    .replace(/^([ \t]*-[ \t]+)\[[ xX]\]([ \t]+[^\n]+)$/gmu, "$1[ ]$2")
    .replace(/^([^\S\n]*EVIDENCE:)[^\n]*$/gmu, "$1 <runtime-evidence>");
}

function normalizePackageContractContent(local, value) {
  let text = Buffer.isBuffer(value) ? value.toString("utf8") : String(value);
  text = text.replace(/\r\n?/gu, "\n");
  if (/\/PACKAGE\.md$/u.test(local)) {
    text = text.replace(/^(\d+\.[ \t]+)\[[ xX]\]/gmu, "$1[ ]");
    text = replaceMarkdownSectionBody(text, "Status", "<runtime-status>");
    text = replaceMarkdownSectionBody(text, "Abschluss", "<runtime-abschluss>");
  } else if (/\/(?:GATES\.md|gates\/[^/]+\.md)$/u.test(local)) {
    text = normalizeLedgerText(text);
  }
  return Buffer.from(text, "utf8");
}

module.exports = {
  PROOF_SCHEMA, PROOF_ENTRY_SCHEMA,
  packageContractPath, replaceMarkdownSectionBody, normalizeLedgerText, normalizePackageContractContent,
};
