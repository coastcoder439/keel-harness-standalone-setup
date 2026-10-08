// Der einzige Freigabebeleg des Harness: ein Eintrag, ueberall gleich geformt.
//
//   Owner-OK: <action> <YYYY-MM-DD> <commit-sha> "<Wortlaut>"        (kurzer Wortlaut, eine Zeile)
//
//   Owner-OK: <action> <YYYY-MM-DD> <commit-sha>                      (jeder andere Wortlaut)
//       > <Zeile 1 des Wortlauts>
//       > <Zeile 2 des Wortlauts>
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
//
// Der Wortlaut ist das wortgetreue Zitat der Owner-Nachricht (D13, D16): keine Laengengrenze,
// Zeilenumbrueche und Anfuehrungszeichen sind erlaubt, nur leer (oder nur Leerraum) und das
// NUL-Zeichen sind es nicht. Er wird unveraendert abgelegt (Zeilenenden werden als LF
// gelesen). Passt er in die Kurzform, steht er wie bisher in einer Zeile; sonst steht er als
// eingerueckter Zitatblock unter dem Kopf. Jede Zitatzeile beginnt mit vier Leerzeichen und
// `>`; so kann ein Zitat weder eine Ueberschrift (`## ...`) noch einen Haken (`- [x]`) noch
// eine falsche Freigabezeile (`Owner-OK: ...`) in die PACKAGE.md einschleusen. Eine Satzform
// wird nie verlangt: der Agent liest die Zustimmung aus dem Gespraech und legt das Zitat ab.

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ACTIONS = new Set(["close", "publish", "waive-duty", "resolve"]);
const TARGET_ACTIONS = ["waive-duty", "resolve"];
const DUTY_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;
const COMMIT = /^[0-9a-f]{40}$/u;

// Die Kurzform der Zeile. Bewusst exportiert, damit Pruefer und Tests dieselbe
// Regex benutzen wie der Bau und nicht eine eigene, abweichende Kopie.
export const OWNER_OK_LINE =
  /^Owner-OK:\s+(close|publish|(?:waive-duty|resolve):[A-Za-z0-9][A-Za-z0-9._-]{0,63})\s+(\d{4}-\d{2}-\d{2})\s+([0-9a-f]{40})\s+"([^"\r\n]{1,500})"\s*$/mu;

// Der Kopf der Blockform: dieselbe Zeile ohne Wortlaut; das Zitat folgt als Block.
export const OWNER_OK_HEAD =
  /^Owner-OK:\s+(close|publish|(?:waive-duty|resolve):[A-Za-z0-9][A-Za-z0-9._-]{0,63})\s+(\d{4}-\d{2}-\d{2})\s+([0-9a-f]{40})\s*$/u;

// Eine Zeile des Zitatblocks: vier Leerzeichen, `>`, dann (nach genau einem Leerzeichen) der Text.
export const OWNER_QUOTE_LINE = /^ {4}>(?: ([^\r\n]*))?$/u;
const SHORT_WORDING = /^[^"\r\n]{1,500}$/u;

function ownerOkError(code, message, exitCode = 2) {
  const error = new Error(message);
  error.code = code;
  error.exitCode = exitCode;
  return error;
}

function sha256(value) {
  return "sha256:" + crypto.createHash("sha256").update(value).digest("hex");
}

// Der Wortlaut mit LF als einzigem Zeilenende; sonst unveraendert.
export function normalizeWording(value) {
  return String(value ?? "").replace(/\r\n?/gu, "\n");
}

// Warum ein Wortlaut nicht abgelegt werden kann, sonst null. Verlangt wird nur ein
// nicht leeres Zitat; Laenge, Zeilenumbrueche und Anfuehrungszeichen sind frei.
export function wordingProblem(value) {
  if (typeof value !== "string") return "the Owner wording must be text";
  if (!value.trim()) return "the Owner wording must not be empty";
  if (value.includes("\0")) return "the Owner wording must not contain a NUL character";
  if (typeof value.isWellFormed === "function" && !value.isWellFormed()) {
    return "the Owner wording must be valid Unicode text";
  }
  return null;
}

export function assertWording(value, label = "Owner-OK wording") {
  const problem = wordingProblem(value);
  if (problem) throw ownerOkError("OWNER_OK_INVALID", label + ": " + problem);
  return value;
}

// Die Zeilen des Zitatblocks fuer einen Wortlaut, jede einzeln eingerueckt.
export function quoteBlockLines(wording) {
  return normalizeWording(wording).split("\n").map((item) => (item === "" ? "    >" : "    > " + item));
}

// Liest ab Zeile `from` die zusammenhaengenden Zitatzeilen. Ohne Zitatzeile ist das Ergebnis null.
export function readQuoteBlock(lines, from) {
  const collected = [];
  let index = from;
  while (index < lines.length) {
    const match = OWNER_QUOTE_LINE.exec(lines[index]);
    if (!match) break;
    collected.push(match[1] ?? "");
    index += 1;
  }
  return collected.length ? { wording: collected.join("\n"), next: index } : null;
}

// Passt der Wortlaut in die Kurzform (eine Zeile, 1..500 Zeichen, ohne Anfuehrungszeichen)?
export function fitsShortForm(wording) {
  return SHORT_WORDING.test(String(wording)) && !wordingProblem(String(wording));
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

// Alle Freigaben eines Textes, Kurz- wie Blockform. `line` ist der ganze Eintrag (bei der
// Blockform Kopf und Zitatzeilen, mit LF verbunden), `lineDigest` sein Digest; `lines` sind
// seine einzelnen Zeilen, damit ein Eintrag an derselben Stelle ersetzt werden kann.
export function parseOwnerOkLines(text) {
  const records = [];
  const source = String(text || "").split(/\r?\n/u);
  for (let index = 0; index < source.length; index += 1) {
    const raw = source[index];
    const short = OWNER_OK_LINE.exec(raw);
    if (short) {
      const { action, target } = splitAction(short[1]);
      records.push({ action, target, date: short[2], commit: short[3], wording: short[4],
        line: raw, lines: [raw], lineDigest: sha256(raw) });
      continue;
    }
    const head = OWNER_OK_HEAD.exec(raw);
    if (!head) continue;
    const quote = readQuoteBlock(source, index + 1);
    const end = quote ? quote.next : index + 1;
    const lines = source.slice(index, end);
    const block = lines.join("\n");
    const { action, target } = splitAction(head[1]);
    records.push({ action, target, date: head[2], commit: head[3], wording: quote ? quote.wording : "",
      line: block, lines, lineDigest: sha256(block) });
    index = end - 1;
  }
  return records;
}

// Gehoert die Zeile zu einem Freigabeeintrag (Kurzform, Kopf oder Zitatzeile)? Die Pruefung
// "nur Freigabezeilen wurden hinzugefuegt" benutzt sie.
export function isOwnerOkRecordLine(line) {
  const text = String(line);
  return OWNER_OK_LINE.test(text) || OWNER_OK_HEAD.test(text) || OWNER_QUOTE_LINE.test(text);
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
// Abschnitte (etwa ein einzelner Beleg-Eintrag) wird als Ganzes gelesen, damit die
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

// Bildet den Eintrag: die Kurzform, wenn der Wortlaut hineinpasst, sonst Kopf und Zitatblock
// (mit LF verbunden). Der Wortlaut wird nie veraendert, nur geprueft.
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
  const wording = normalizeWording(options?.wording);
  assertWording(wording);
  const head = "Owner-OK: " + joinAction(action, target) + " " + date + " " + commit;
  if (fitsShortForm(wording)) return head + ' "' + wording + '"';
  return [head, ...quoteBlockLines(wording)].join("\n");
}

// Der Eintrag gehoert ans Ende des Abschnitts `## Abschluss`, vor die naechste `## `-Ueberschrift.
// Der Zeilenende-Stil der Datei bleibt, wie er ist: eine CRLF-PACKAGE.md bekommt CRLF-Zeilen.
// `line` darf mehrzeilig sein (Blockform, LF-verbunden).
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
  const next = [...lines.slice(0, insertAt), ...String(line).split("\n"), ...lines.slice(insertAt)];
  return next.join(eol);
}

// Ersetzt einen gelesenen Eintrag (`record.lines`) durch einen neuen, an derselben Stelle, und
// behaelt den Zeilenende-Stil. Findet sich der Eintrag nicht, ist das ein Fehler: es wird nie geraten.
export function replaceOwnerOkRecord(packageText, record, newLine) {
  const text = String(packageText);
  const eol = /\r\n/u.test(text) ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/u);
  const old = Array.isArray(record?.lines) ? record.lines : String(record?.line ?? "").split("\n");
  let at = -1;
  for (let index = 0; index + old.length <= lines.length && at === -1; index += 1) {
    if (old.every((item, offset) => lines[index + offset] === item)) at = index;
  }
  if (at === -1) throw ownerOkError("OWNER_OK_INVALID", "the Owner-OK entry to replace is not in PACKAGE.md");
  return [...lines.slice(0, at), ...String(newLine).split("\n"), ...lines.slice(at + old.length)].join(eol);
}

export function validateOwnerOk(record, options) {
  const action = String(options?.action || "");
  const target = options?.target === null || options?.target === undefined ? null : String(options.target);
  if (!record) {
    throw ownerOkError("OWNER_OK_MISSING",
      "no Owner-OK record for " + joinAction(action, target) + "; read the Owner's approval from the conversation " +
      "and record the Owner's own words (--owner-ok TEXT or --owner-ok-file FILE); never ask for a sentence form", 1);
  }
  if (record.action !== action || record.target !== target) {
    throw ownerOkError("OWNER_OK_INVALID", "Owner-OK line authorizes " + joinAction(record.action, record.target) +
      ", not " + joinAction(action, target));
  }
  if (!validCalendarDate(record.date)) throw ownerOkError("OWNER_OK_INVALID", "Owner-OK date is not a real day");
  const today = String(options?.today || todayLocal());
  if (!validCalendarDate(today)) throw ownerOkError("OWNER_OK_INVALID", "the comparison date is not a real day");
  if (record.date > today) throw ownerOkError("OWNER_OK_INVALID", "Owner-OK date " + record.date + " is in the future");
  assertWording(String(record.wording ?? ""));
  if (!COMMIT.test(String(record.commit || ""))) {
    throw ownerOkError("OWNER_OK_INVALID", "Owner-OK commit must be a full 40 hex Git SHA");
  }
  const head = String(options?.head || "");
  if (record.commit !== head) {
    throw ownerOkError("OWNER_OK_STALE", "Owner-OK line binds commit " + record.commit +
      ", but HEAD is " + head + "; record the Owner's approval again against the current state: judge from the " +
      "conversation whether it still covers what changed, and pass the Owner's words again (no new sentence is asked for)", 1);
  }
  return record;
}

// --- Das Zitat aus einer Datei (--owner-ok-file) ---------------------------------------------

function insideFolder(folder, file) {
  const relative = path.relative(folder, file);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

// Liegt zwischen dem erlaubten Ordner und der Datei ein Git-Arbeitsbaum (ein Ordner mit `.git`, Verzeichnis oder
// Datei)? Dann ist die Datei eine Datei dieses Arbeitsbaums, auch wenn der Arbeitsbaum selbst im Temp-Ordner liegt
// (eine saubere Kopie unter %TEMP%\keel-proof, ein Release-Klon). Der erlaubte Ordner selbst zählt nicht mit; ein
// `.unlazy` darunter hat kein `.git`, eine Arbeitskopie je Schritt darin schon.
function workingTreeBetween(folder, file) {
  for (let directory = path.dirname(file); insideFolder(folder, directory); directory = path.dirname(directory)) {
    if (fs.existsSync(path.join(directory, ".git"))) return true;
  }
  return false;
}

// Die Ordner, aus denen eine Zitat-Datei kommen darf: der Temp-Ordner der Sitzung und der
// Laufzeitordner `.unlazy` des Repos bzw. der Harness-Wurzel. Eine Datei aus dem Arbeitsbaum
// (etwa eine PACKAGE.md) ist nie die Quelle eines Owner-Zitats.
export function ownerWordingFolders(...roots) {
  const folders = [os.tmpdir()];
  for (const root of roots) if (root) folders.push(path.join(String(root), ".unlazy"));
  return folders;
}

function decodeText(bytes) {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le", { fatal: true }).decode(bytes.subarray(2));
  const body = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes;
  return new TextDecoder("utf-8", { fatal: true }).decode(body);
}

// Liest einen Text unveraendert aus einer Datei in einem der erlaubten Ordner. Genau ein abschliessendes
// Zeilenende gehoert dem Editor, nicht dem Text und faellt weg; alles andere bleibt. Ungueltiges UTF-8 wird
// abgelehnt statt stillschweigend ersetzt. Die Pruefung auf "nicht leer" ist Sache des Aufrufers.
export function readTextFromFolders(file, folders, label = "file") {
  const resolved = path.resolve(String(file ?? ""));
  let info;
  try { info = fs.lstatSync(resolved); }
  catch { throw ownerOkError("OWNER_OK_FILE", label + " does not exist: " + resolved, 1); }
  if (info.isSymbolicLink() || !info.isFile() || (typeof info.nlink === "number" && info.nlink !== 1)) {
    throw ownerOkError("OWNER_OK_FILE", label + " must be a single-link regular file: " + resolved, 1);
  }
  const real = fs.realpathSync.native(resolved);
  const inside = folders.some((folder) => {
    try {
      const base = fs.realpathSync.native(folder);
      return insideFolder(base, real) && !workingTreeBetween(base, real);
    } catch { return false; }
  });
  if (!inside) {
    throw ownerOkError("OWNER_OK_FILE_LOCATION", label + " must lie in the session temp folder or the run folder (.unlazy), not in a Git working tree: " +
      folders.join(", "), 1);
  }
  let text;
  try { text = decodeText(fs.readFileSync(real)); }
  catch { throw ownerOkError("OWNER_OK_FILE", label + " is not valid UTF-8 (or UTF-16 with a byte order mark) text: " + resolved, 2); }
  return text.replace(/\r?\n$/u, "");
}

// Das Zitat des Owners aus der Datei (--owner-ok-file). Eine leere Datei ist kein Zitat.
export function readOwnerWordingFile(file, folders = ownerWordingFolders()) {
  const wording = readTextFromFolders(file, folders, "--owner-ok-file");
  assertWording(wording, "--owner-ok-file");
  return wording;
}
