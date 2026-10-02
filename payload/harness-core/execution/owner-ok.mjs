// Der einzige Freigabebeleg des Harness: eine Zeile, ueberall gleich geformt.
//
//   Owner-OK: <action> <YYYY-MM-DD> <commit-sha> "<Wortlaut>"
//
// Sie ersetzt das frueher eigengebaute Freigabe-Artefakt samt Challenge, Nonce,
// Ablaufzeit und eigentuemer-privatem Ordner (Owner-Entscheidung 08.09.2026,
// docs/packages/keel-harness-reference-completeness-repair/evidence/owner-ok-rollback-2026-09-08.md).
// Ihre Bindung ist der Commit: beim Verbrauch muss er dem aktuellen HEAD entsprechen,
// sonst ist die Zeile veraltet. Fuer `close` lebt sie im Abschnitt `## Abschluss` der
// PACKAGE.md und wird mit dem Schluss-Commit versioniert; fuer `publish`,
// `waive-duty:<id>` und `resolve:<id>` wird dieselbe Form gebildet und im Beleg
// gespeichert. Bei `resolve:<id>` ist <id> das Paket, das zusammengefuehrt,
// aktualisiert oder stillgelegt wird.

import crypto from "node:crypto";

const ACTIONS = new Set(["close", "publish", "waive-duty", "resolve"]);
const TARGET_ACTIONS = ["waive-duty", "resolve"];
const DUTY_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;
const COMMIT = /^[0-9a-f]{40}$/u;

// Die eine Form der Zeile. Bewusst exportiert, damit Pruefer und Tests dieselbe
// Regex benutzen wie der Bau und nicht eine eigene, abweichende Kopie.
export const OWNER_OK_LINE =
  /^Owner-OK:\s+(close|publish|(?:waive-duty|resolve):[A-Za-z0-9][A-Za-z0-9._-]{0,63})\s+(\d{4}-\d{2}-\d{2})\s+([0-9a-f]{40})\s+"([^"\r\n]{1,500})"\s*$/mu;

function ownerOkError(code, message, exitCode = 2) {
  const error = new Error(message);
  error.code = code;
  error.exitCode = exitCode;
  return error;
}

function sha256(value) {
  return "sha256:" + crypto.createHash("sha256").update(value).digest("hex");
}

function splitAction(value) {
  const text = String(value);
  for (const action of TARGET_ACTIONS) {
    if (text.startsWith(action + ":")) return { action, target: text.slice(action.length + 1) };
  }
  return { action: text, target: null };
}

function joinAction(action, target) {
  return TARGET_ACTIONS.includes(action) ? action + ":" + target : action;
}

// Ein echtes Kalenderdatum, nicht nur vier-zwei-zwei Ziffern: 2026-02-31 ist eine
// Zahlenfolge, kein Tag, und Date.parse wuerde sie stillschweigend verschieben.
export function validCalendarDate(value) {
  const match = CALENDAR_DATE.exec(String(value));
  if (!match) return false;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return date.getUTCFullYear() === Number(year) && date.getUTCMonth() === Number(month) - 1 &&
    date.getUTCDate() === Number(day);
}

export function todayLocal(now = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate());
}

export function parseOwnerOkLines(text) {
  const records = [];
  for (const raw of String(text || "").split(/\r?\n/u)) {
    const match = OWNER_OK_LINE.exec(raw);
    if (!match) continue;
    const { action, target } = splitAction(match[1]);
    records.push({ action, target, date: match[2], commit: match[3], wording: match[4],
      line: raw, lineDigest: sha256(raw) });
  }
  return records;
}

// Der Inhalt eines `## <heading>`-Abschnitts bis zur naechsten `## `-Ueberschrift,
// CRLF und LF gleich, mit LF verbunden; fehlt der Abschnitt, ist das Ergebnis leer.
// Die eine Abschnittssuche fuer `## Abschluss` (hier) und `## Status` (owner-start.mjs).
export function packageSection(packageText, heading) {
  const escaped = String(heading).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const pattern = new RegExp("^##\\s+" + escaped + "\\s*$", "u");
  const lines = String(packageText || "").split(/\r?\n/u);
  const start = lines.findIndex((item) => pattern.test(item));
  if (start === -1) return "";
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s/u.test(lines[index])) { end = index; break; }
  }
  return lines.slice(start + 1, end).join("\n");
}

// Nur der Abschnitt `## Abschluss` traegt Freigaben. Ein Zitat der Zeile im Status,
// in einem Codeblock der Doku oder in einem alten Eintrag ist keine Freigabe und
// darf den Abschluss weder ausloesen noch blockieren. Fehlt der Abschnitt, gibt es
// keine Freigabe.
export function abschlussSection(packageText) {
  return packageSection(packageText, "Abschluss");
}

// Sucht eine Freigabe in PACKAGE.md: nur im Abschnitt `## Abschluss`. Ein Text ohne
// Abschnitte (etwa eine einzelne Beleg-Zeile) wird als Ganzes gelesen, damit die
// Belege von publish und waive-duty dieselbe Funktion benutzen koennen.
export function findOwnerOk(text, action, target = null) {
  const wanted = String(action);
  const wantedTarget = target === null || target === undefined ? null : String(target);
  const source = /^##\s/mu.test(String(text || "")) ? abschlussSection(text) : String(text || "");
  const found = parseOwnerOkLines(source)
    .filter((record) => record.action === wanted && record.target === wantedTarget);
  if (found.length > 1) {
    throw ownerOkError("OWNER_OK_AMBIGUOUS",
      "PACKAGE.md carries " + found.length + " Owner-OK lines for " + joinAction(wanted, wantedTarget) +
      "; exactly one is allowed", 1);
  }
  return found[0] || null;
}

export function formatOwnerOkLine(options) {
  const action = String(options?.action || "");
  const target = options?.target === null || options?.target === undefined ? null : String(options.target);
  if (!ACTIONS.has(action)) throw ownerOkError("OWNER_OK_INVALID", "unsupported Owner-OK action " + action);
  if (action === "waive-duty") {
    if (!target || !DUTY_ID.test(target)) throw ownerOkError("OWNER_OK_INVALID", "waive-duty requires a duty identifier");
  } else if (action === "resolve") {
    if (!target || !DUTY_ID.test(target)) throw ownerOkError("OWNER_OK_INVALID", "resolve requires a package identifier");
  } else if (target !== null) {
    throw ownerOkError("OWNER_OK_INVALID", action + " takes no Owner-OK target");
  }
  const date = String(options?.date || "");
  if (!validCalendarDate(date)) throw ownerOkError("OWNER_OK_INVALID", "Owner-OK date must be a real YYYY-MM-DD day");
  const commit = String(options?.commit || "");
  if (!COMMIT.test(commit)) throw ownerOkError("OWNER_OK_INVALID", "Owner-OK commit must be a full 40 hex Git SHA");
  const wording = String(options?.wording ?? "");
  if (wording.length < 1 || wording.length > 500 || /["\r\n]/u.test(wording)) {
    throw ownerOkError("OWNER_OK_INVALID", "Owner-OK wording must be 1..500 characters on one line without quotes");
  }
  return "Owner-OK: " + joinAction(action, target) + " " + date + " " + commit + ' "' + wording + '"';
}

// Die Zeile gehoert als letzte nicht-leere Zeile in den Abschnitt `## Abschluss`,
// vor die naechste `## `-Ueberschrift. Der Zeilenende-Stil der Datei bleibt, wie er ist:
// eine CRLF-PACKAGE.md bekommt eine CRLF-Zeile.
export function insertOwnerOkLine(packageText, line) {
  const text = String(packageText);
  const eol = /\r\n/u.test(text) ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/u);
  const start = lines.findIndex((item) => /^##\s+Abschluss\s*$/u.test(item));
  if (start === -1) throw ownerOkError("OWNER_OK_INVALID", "PACKAGE.md has no '## Abschluss' section");
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s/u.test(lines[index])) { end = index; break; }
  }
  let insertAt = end;
  while (insertAt > start + 1 && lines[insertAt - 1].trim() === "") insertAt -= 1;
  const next = [...lines.slice(0, insertAt), String(line), ...lines.slice(insertAt)];
  return next.join(eol);
}

export function validateOwnerOk(record, options) {
  const action = String(options?.action || "");
  const target = options?.target === null || options?.target === undefined ? null : String(options.target);
  if (!record) {
    throw ownerOkError("OWNER_OK_MISSING",
      "no Owner-OK line for " + joinAction(action, target) + "; the Owner has to say OK first", 1);
  }
  if (record.action !== action || record.target !== target) {
    throw ownerOkError("OWNER_OK_INVALID", "Owner-OK line authorizes " + joinAction(record.action, record.target) +
      ", not " + joinAction(action, target));
  }
  if (!validCalendarDate(record.date)) throw ownerOkError("OWNER_OK_INVALID", "Owner-OK date is not a real day");
  const today = String(options?.today || todayLocal());
  if (!validCalendarDate(today)) throw ownerOkError("OWNER_OK_INVALID", "the comparison date is not a real day");
  if (record.date > today) throw ownerOkError("OWNER_OK_INVALID", "Owner-OK date " + record.date + " is in the future");
  const wording = String(record.wording ?? "");
  if (wording.length < 1 || wording.length > 500 || /["\r\n]/u.test(wording)) {
    throw ownerOkError("OWNER_OK_INVALID", "Owner-OK wording must be 1..500 characters on one line without quotes");
  }
  if (!COMMIT.test(String(record.commit || ""))) {
    throw ownerOkError("OWNER_OK_INVALID", "Owner-OK commit must be a full 40 hex Git SHA");
  }
  const head = String(options?.head || "");
  if (record.commit !== head) {
    throw ownerOkError("OWNER_OK_STALE", "Owner-OK line binds commit " + record.commit +
      ", but HEAD is " + head + "; ask the Owner again for the current state", 1);
  }
  return record;
}
