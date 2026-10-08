// Ein Paket startet erst mit einem Owner-Startsatz. Fuer einen Lauf ueber mehrere
// Pakete genuegt der Go-Satz im Lauf-Paket, sofern es das Paket nennt. Gueltig sind
// die Zeilen nur im Abschnitt `## Status` der PACKAGE.md:
//
//   Owner-Start: <YYYY-MM-DD> "<Wortlaut>"     im Paket selbst
//   Owner-Go: <YYYY-MM-DD> "<Wortlaut>"        im Lauf-Paket
//
// Der Wortlaut ist das wortgetreue Zitat der Owner-Nachricht (D16): keine Laengengrenze, Zeilenumbrueche und
// Anfuehrungszeichen sind erlaubt, nur ein leerer Wortlaut nicht. Passt er nicht in die Kurzform (eine Zeile,
// 1..500 Zeichen, ohne Anfuehrungszeichen), steht er als Zitatblock unter dem Kopf `Owner-Start: <YYYY-MM-DD>`,
// jede Zeile mit vier Leerzeichen und ">" davor (dieselbe Form wie bei Owner-OK in owner-ok.mjs). Eine Satzform
// wird nie verlangt: der Agent liest den Startwunsch aus dem Gespraech und legt die Nachricht als Zitat ab.
//
// Das Modul prueft nur und schreibt nie eine Zeile. Es gibt keine Commit-Bindung, weil
// HEAD in jeder Welle weiterlaeuft. Eingeschaltet wird die Pruefung je Installation
// ueber packageContract.ownerStartRequired in .keel-harness.json.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { packageSection, readQuoteBlock, todayLocal, validCalendarDate, wordingProblem } from "./owner-ok.mjs";

export const OWNER_START_LINE = /^Owner-Start:\s+(\d{4}-\d{2}-\d{2})\s+"([^"\r\n]{1,500})"\s*$/u;
export const OWNER_GO_LINE = /^Owner-Go:\s+(\d{4}-\d{2}-\d{2})\s+"([^"\r\n]{1,500})"\s*$/u;
// Die Blockform: der Kopf ohne Wortlaut, das Zitat folgt als Zitatblock.
export const OWNER_START_HEAD = /^Owner-Start:\s+(\d{4}-\d{2}-\d{2})\s*$/u;
export const OWNER_GO_HEAD = /^Owner-Go:\s+(\d{4}-\d{2}-\d{2})\s*$/u;

const PACKAGE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const INSTALLER_SOURCE = /^Source:\s*Keel Harness installer\s*$/mu;
const ONBOARDING = "harness-onboarding";

function startError(code, message, exitCode) {
  const error = new Error(message);
  error.code = code;
  error.exitCode = exitCode;
  return error;
}

function sha256(value) {
  return "sha256:" + crypto.createHash("sha256").update(value).digest("hex");
}

function readText(file) {
  if (!fs.existsSync(file) || !fs.lstatSync(file).isFile()) return null;
  return fs.readFileSync(file, "utf8");
}

// So wie standardFormatRequired in owner-contract.cjs: fehlt Datei oder Schluessel, ist
// die Pruefung aus; ein vorhandener Wert, der kein Boolean ist, ist ein Fehler.
export function ownerStartRequired(harnessRoot) {
  const text = readText(path.join(String(harnessRoot || ""), ".keel-harness.json"));
  if (text === null) return false;
  let value;
  try { value = JSON.parse(text); }
  catch { throw startError("OWNER_START_CONFIG", ".keel-harness.json is not valid JSON", 2); }
  const flag = value && typeof value === "object" ? value.packageContract?.ownerStartRequired : undefined;
  if (flag === undefined) return false;
  if (typeof flag !== "boolean") {
    throw startError("OWNER_START_CONFIG", ".keel-harness.json packageContract.ownerStartRequired must be true or false", 2);
  }
  return flag;
}

// Jede Status-Zeile mit dem Praefix ist eine Kandidatin. Keine ergibt null; mehrere
// sind mehrdeutig; genau eine muss die Kurz- oder die Blockform und einen echten, nicht
// kuenftigen Kalendertag tragen und ein nicht leeres Zitat. Die Zitatzeilen der Blockform
// beginnen mit vier Leerzeichen und ">", sind also nie selbst eine Kandidatin.
function statusLine(packageText, prefix, shortPattern, headPattern, today) {
  const lines = packageSection(packageText, "Status").split("\n");
  const candidates = [];
  lines.forEach((line, index) => { if (line.trimStart().startsWith(prefix)) candidates.push(index); });
  if (candidates.length === 0) return null;
  if (candidates.length > 1) {
    throw startError("OWNER_START_AMBIGUOUS",
      "## Status carries " + candidates.length + " '" + prefix + "' lines; exactly one is allowed", 1);
  }
  const raw = lines[candidates[0]];
  const short = shortPattern.exec(raw);
  const head = short ? null : headPattern.exec(raw);
  if (!short && !head) {
    throw startError("OWNER_START_INVALID",
      "'" + prefix + "' line must read `" + prefix + " YYYY-MM-DD \"<Owner wording>\"` or `" + prefix +
      " YYYY-MM-DD` followed by the Owner's words as lines that start with four spaces and '>'", 2);
  }
  const quote = head ? readQuoteBlock(lines, candidates[0] + 1) : null;
  const date = (short || head)[1];
  const wording = short ? short[2] : (quote ? quote.wording : "");
  const block = short ? raw : [raw, ...lines.slice(candidates[0] + 1, quote ? quote.next : candidates[0] + 1)].join("\n");
  if (!validCalendarDate(date)) throw startError("OWNER_START_INVALID", "'" + prefix + "' date is not a real day", 2);
  if (date > today) throw startError("OWNER_START_INVALID", "'" + prefix + "' date " + date + " is in the future", 2);
  const problem = wordingProblem(wording);
  if (problem) throw startError("OWNER_START_INVALID", "'" + prefix + "' line: " + problem, 2);
  return { date, wording, lineDigest: sha256(block) };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

// Ganzes Wort: davor kein Zeichen aus [A-Za-z0-9._-], danach weder [A-Za-z0-9_-] noch
// ein Punkt mit folgendem Buchstaben oder Ziffer. So nennt „release-2“ nicht „release“,
// waehrend „release.“ am Satzende das Paket nennt.
function namesPackage(text, packageId) {
  return new RegExp("(?<![A-Za-z0-9._-])" + escapeRegExp(packageId) + "(?![A-Za-z0-9_-])(?!\\.[A-Za-z0-9])", "u")
    .test(String(text));
}

function installerOnboarding(repoRoot, packageId) {
  if (packageId !== ONBOARDING) return false;
  const owner = readText(path.join(String(repoRoot), "docs", "packages", ONBOARDING, "OWNER.md"));
  return owner !== null && INSTALLER_SOURCE.test(owner);
}

export function verifyOwnerStart({ harnessRoot, repoRoot, packageId, runPackageId = null, today = todayLocal() }) {
  if (!ownerStartRequired(harnessRoot)) return null;
  const id = String(packageId ?? "");
  if (!PACKAGE_ID.test(id)) throw startError("OWNER_START_INVALID", "packageId must match " + PACKAGE_ID, 2);
  const run = runPackageId === null || runPackageId === undefined ? null : String(runPackageId);
  if (run !== null && !PACKAGE_ID.test(run)) throw startError("OWNER_START_INVALID", "run package must match " + PACKAGE_ID, 2);
  const day = String(today ?? "");
  if (!validCalendarDate(day)) throw startError("OWNER_START_INVALID", "the comparison date is not a real day", 2);

  // Genau das Onboarding-Paket, das der Installer selbst anlegt, startet ohne Satz.
  if (installerOnboarding(repoRoot, id)) {
    return { kind: "exempt-onboarding", date: null, wording: null, runPackageId: null, lineDigest: null };
  }

  if (run !== null) {
    const relative = "docs/packages/" + run + "/PACKAGE.md";
    const text = readText(path.join(String(repoRoot), "docs", "packages", run, "PACKAGE.md"));
    const go = text === null ? null : statusLine(text, "Owner-Go:", OWNER_GO_LINE, OWNER_GO_HEAD, day);
    if (!go) {
      throw startError("OWNER_GO_MISSING",
        "run " + run + " has no Owner go quote: record the Owner's message from the chat in ## Status of " + relative +
        " as `Owner-Go: YYYY-MM-DD \"<Owner wording>\"` (his own words; no sentence form is asked for)", 1);
    }
    if (!namesPackage(text, id)) {
      throw startError("OWNER_GO_NOT_MEMBER", "run " + run + " does not name package " + id + " in " + relative, 1);
    }
    return { kind: "owner-go", date: go.date, wording: go.wording, runPackageId: run, lineDigest: go.lineDigest };
  }

  const text = readText(path.join(String(repoRoot), "docs", "packages", id, "PACKAGE.md"));
  const start = text === null ? null : statusLine(text, "Owner-Start:", OWNER_START_LINE, OWNER_START_HEAD, day);
  if (!start) {
    throw startError("OWNER_START_MISSING",
      "package " + id + " has no Owner start quote: record the Owner's message from the chat as `Owner-Start: YYYY-MM-DD \"<Owner wording>\"` in ## Status of " +
      "docs/packages/" + id + "/PACKAGE.md, or start it under a run with --run <run package> whose ## Status carries " +
      "`Owner-Go: ...` and names " + id + ".", 1);
  }
  return { kind: "owner-start", date: start.date, wording: start.wording, runPackageId: null, lineDigest: start.lineDigest };
}
