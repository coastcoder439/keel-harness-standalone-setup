// Eine Orchestrator-Sitzung wird nie als Leaf gebunden. Bauarbeit eines Pakets geht
// an Unteragenten oder an eigene Leaf-Sitzungen; dieses Modul erkennt die
// orchestrierende Sitzung und weist ihre Bindung als Leaf mit dem Weg ueber dispatch ab
// (Owner 01.10.2026: „Du musst für alles einen Plan schreiben und danach für alles ein
// Subagenten starten.“).
//
// Erkannt wird in fester Reihenfolge:
//   (a) die aufrufende Sitzung selbst (CLAUDE_CODE_SESSION_ID ohne KEEL_PACKAGE_SESSION),
//   (b) die Sitzung, die das Paket geplant hat (bootstrapSession oder ein
//       Planungsdatensatz aus package-bootstrap.cjs),
//   (c) eine im Index verzeichnete Orchestrator-Sitzung.
// Es gibt keine Ausnahme fuer das Selbstbinden und keinen Schalter, der die Pruefung
// umgeht. Das Modul ruft niemand auf, bis der Ausfuehrer es verdrahtet.

import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { replaceFileSync } from "./atomic-file.mjs";

const require = createRequire(import.meta.url);
const bootstrap = require("../binding/package-bootstrap.cjs");

const realpath = fs.realpathSync.native || fs.realpathSync;
const VIA = /^[a-z][a-z0-9-]{0,31}$/u;

function roleError(code, message, exitCode) {
  const error = new Error(message);
  error.code = code;
  error.exitCode = exitCode;
  return error;
}

// Dieselbe Pruefung wie validSession in package-bootstrap.cjs: getrimmt, 1 bis 256
// Zeichen, kein NUL, CR oder LF.
function validSession(value) {
  const text = String(value ?? "").trim();
  if (!text || text.length > 256 || /[\0\r\n]/u.test(text)) {
    throw roleError("ORCHESTRATOR_SESSION_INVALID", "sessionId is invalid", 2);
  }
  return text;
}

function optionalSession(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text && text.length <= 256 && !/[\0\r\n]/u.test(text) ? text : null;
}

// Claude Code gibt CLAUDE_CODE_SESSION_ID an jeden Shell-Kindprozess weiter (gemessen
// mit 2.1.183 und 2.1.284); ein vom Harness gestarteter Arbeitsagent traegt zusaetzlich
// KEEL_PACKAGE_SESSION und ist damit nicht der Aufrufer im Sinne von (a).
// Fuer Codex ist kein Gegenstueck zu CLAUDE_CODE_SESSION_ID gemessen (ungemessen);
// dort greifen nur (b) und (c).
export function callerSession(env = process.env) {
  const packageSession = String(env?.KEEL_PACKAGE_SESSION ?? "").trim();
  if (packageSession) return null;
  return optionalSession(env?.CLAUDE_CODE_SESSION_ID);
}

// Je Sitzung eine Datei unter .unlazy/.orchestrators. Der Punkt am Anfang ist Absicht:
// findSessionBinding (package-binding.cjs) und suspendDormantOverlaps
// (package-executor.mjs) ueberspringen Punkt-Verzeichnisse unter .unlazy.
export function orchestratorRecordPath(harnessRoot, sessionId) {
  const root = realpath(path.resolve(String(harnessRoot || "")));
  const key = crypto.createHash("sha256").update(validSession(sessionId)).digest("hex") + ".json";
  return path.join(root, ".unlazy", ".orchestrators", key);
}

function harnessControlRoot(value) {
  const root = realpath(path.resolve(String(value || "")));
  const config = path.join(root, ".keel-harness.json");
  if (!fs.existsSync(config) || !fs.lstatSync(config).isFile() || fs.lstatSync(config).isSymbolicLink()) {
    throw roleError("ORCHESTRATOR_HARNESS_ROOT", "Harness root must contain a regular .keel-harness.json", 2);
  }
  return root;
}

// Fehlt die Datei, ist die Sitzung nicht verzeichnet. Eine vorhandene, aber kaputte
// Datei wird nie still durchgelassen.
function readRecord(file, sessionId) {
  if (!fs.existsSync(file)) return null;
  const invalid = (reason) => roleError("ORCHESTRATOR_INDEX_INVALID",
    "orchestrator index " + path.basename(file) + " " + reason, 2);
  const info = fs.lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink() || (typeof info.nlink === "number" && info.nlink !== 1)) {
    throw invalid("must be a single-link regular file");
  }
  let value;
  try { value = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { throw invalid("is not valid JSON"); }
  if (!value || typeof value !== "object" || value.schemaVersion !== 1) throw invalid("has no schemaVersion 1");
  if (value.sessionId !== sessionId) throw invalid("belongs to another session");
  if (!Array.isArray(value.via)) throw invalid("has no via list");
  return value;
}

function plannedBy(harnessRoot, sessionId, bootstrapSession) {
  if (optionalSession(bootstrapSession) === sessionId) return true;
  try {
    bootstrap.find({ harnessRoot, sessionId });
    return true;
  } catch {
    // Jeder Fehler von find heisst: kein Planungsdatensatz dieser Sitzung.
    return false;
  }
}

export function orchestratorReason({ harnessRoot, sessionId, env = process.env, bootstrapSession = null }) {
  const session = validSession(sessionId);
  if (callerSession(env) === session) return "calling session";
  if (plannedBy(harnessRoot, session, bootstrapSession)) return "package planning session";
  if (readRecord(orchestratorRecordPath(harnessRoot, session), session)) return "recorded orchestrator";
  return null;
}

// The packages a session orchestrates (P4 D1): the session that planned or runs a package writes the evidence
// and design notes of exactly that package directly (paket-gate, package-bootstrap.cjs
// authorizeOrchestratorWrite reads this list). Bounded; the oldest entries leave first.
const MAX_PACKAGES = 64;

function packageEntry(packageRef) {
  if (!packageRef) return null;
  const repoRoot = String(packageRef.repoRoot ?? "");
  const packageId = String(packageRef.packageId ?? "");
  if (!repoRoot || !path.isAbsolute(repoRoot) || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(packageId)) return null;
  const scope = String(packageRef.scope ?? "");
  return { repoRoot, packageId, ...(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(scope) ? { scope } : {}) };
}

function samePackageRef(left, right) {
  const key = (item) => (process.platform === "win32" ? (item.repoRoot + "\n" + item.packageId).toLowerCase() : item.repoRoot + "\n" + item.packageId);
  return key(left) === key(right);
}

function mergePackages(existing, entry) {
  const list = Array.isArray(existing) ? existing.map(packageEntry).filter(Boolean) : [];
  if (!entry) return list;
  return [...list.filter((item) => !samePackageRef(item, entry)), entry].slice(-MAX_PACKAGES);
}

export function recordOrchestrator({ harnessRoot, sessionId, via, packageRef = null, now = new Date() }) {
  const root = harnessControlRoot(harnessRoot);
  const session = validSession(sessionId);
  const route = String(via ?? "");
  if (!VIA.test(route)) throw roleError("ORCHESTRATOR_VIA_INVALID", "via must match " + VIA, 2);
  const at = now.toISOString();
  const file = orchestratorRecordPath(root, session);
  const existing = readRecord(file, session);
  const packages = mergePackages(existing?.packages, packageEntry(packageRef));
  const value = existing
    ? { schemaVersion: 1, sessionId: session, via: existing.via.includes(route) ? [...existing.via] : [...existing.via, route],
      firstAt: existing.firstAt, lastAt: at, ...(packages.length ? { packages } : {}) }
    : { schemaVersion: 1, sessionId: session, via: [route], firstAt: at, lastAt: at, ...(packages.length ? { packages } : {}) };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = file + "." + process.pid + "." + crypto.randomBytes(8).toString("hex") + ".tmp";
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
  try { replaceFileSync(temporary, file); }
  finally { try { fs.unlinkSync(temporary); } catch { /* renamed or absent */ } }
  return { ...value, record: file };
}

export function assertNotOrchestrator({ harnessRoot, sessionId, env = process.env, bootstrapSession = null }) {
  const reason = orchestratorReason({ harnessRoot, sessionId, env, bootstrapSession });
  if (reason === null) return null;
  throw roleError("ORCHESTRATOR_AS_LEAF",
    "session " + validSession(sessionId) + " is the orchestrating session (" + reason + "); an orchestrator is never " +
    "bound as a leaf. Hand the build work to a worker: start --session <new leaf session> --leaf <leaf>, then " +
    "dispatch --wave <wave> --session <new leaf session>; or bind a separate leaf session the Owner opened, by its " +
    "own session id.", 1);
}
