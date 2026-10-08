// Abgleich je Datei beim Start und beim Rücklauf (P13, C4 und C11).
//
// Beim Start eines Arbeitsschritts legt der Executor einen Stand des Arbeitsbaums ab, beim Rücklauf erfasst er
// ihn erneut. Aus dem Unterschied folgt zweierlei:
//   C4   Hat der Schritt keine Datei in seinem OWNS geändert, ist der Rücklauf kein Erfolg (returned-unchanged).
//   C11  Eine Änderung außerhalb der OWNS aller Schritte, die im Fenster aktiv waren, wird gemeldet und sperrt den
//        Rücklauf. Es wird NIE zurückgedreht und nie ein `git diff` im gemeinsamen Ordner gemacht (Konzept 3.2.1).
//
// Billig, weil nie das ganze Repository gehasht wird (Gefahr 5): `git status` nennt, was vom letzten Commit abweicht
// (geänderte, gelöschte und ungetrackte, nicht ignorierte Dateien); nur diese Dateien werden gehasht. Der Stand eines
// Schritts ist also die Liste der Abweichungen mit ihrem Inhalt-Hash plus der HEAD. Eine Datei, die beim Start sauber
// war, fällt beim Rücklauf durch ihr Auftauchen in der Liste auf; ändert sich HEAD zwischen beiden Ständen
// (jemand committete), kommen die Dateien des Commit-Unterschieds hinzu.
// `--no-optional-locks` hält `git status` von der Index-Sperre fern, die parallele Agenten brauchen.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const SNAPSHOT_SCHEMA = 1;
// Dateien über dieser Größe werden nicht gelesen; ihr Stand ist Größe und Änderungszeit (im Zweifel „geändert“).
const HASH_LIMIT_BYTES = 4 * 1024 * 1024;
const DELETED = "deleted";

function slash(value) {
  return String(value).replaceAll("\\", "/");
}

function listZero(text) {
  return String(text || "").split("\0").filter(Boolean);
}

export function tokenOf(repoRoot, relative) {
  const absolute = path.join(repoRoot, ...relative.split("/"));
  let info;
  try { info = fs.lstatSync(absolute); } catch { return DELETED; }
  if (info.isSymbolicLink()) {
    try { return "l:" + crypto.createHash("sha1").update(fs.readlinkSync(absolute)).digest("hex"); } catch { return "l:?"; }
  }
  if (!info.isFile()) return "d:" + info.mtimeMs;
  if (info.size > HASH_LIMIT_BYTES) return "s:" + info.size + ":" + Math.round(info.mtimeMs);
  try { return "h:" + crypto.createHash("sha1").update(fs.readFileSync(absolute)).digest("hex"); }
  catch { return "s:" + info.size + ":" + Math.round(info.mtimeMs); }
}

/** Pfade, die nie zum Abgleich zählen: Laufzeit des Harness und Git selbst. */
export function isRuntimePath(relative) {
  const value = slash(relative);
  return value === ".unlazy" || value.startsWith(".unlazy/") || value === ".git" || value.startsWith(".git/");
}

/**
 * Der Stand des Arbeitsbaums. `git(args)` liefert { status, stdout } (async). Wirft nie: ein Git, das nicht läuft,
 * ergibt null, und der Aufrufer entscheidet ohne Stand nichts.
 */
export async function takeSnapshot({ repoRoot, git, now = new Date() }) {
  try {
    const status = await git(["--no-optional-locks", "status", "--porcelain=v1", "-z", "--untracked-files=all",
      "--no-renames", "--ignore-submodules=all"]);
    if (status.status !== 0) return null;
    const dirty = {};
    for (const entry of listZero(status.stdout)) {
      const relative = slash(entry.slice(3));
      if (!relative || isRuntimePath(relative)) continue;
      dirty[relative] = tokenOf(repoRoot, relative);
    }
    const head = await git(["rev-parse", "--verify", "--quiet", "HEAD"]);
    return { schema: SNAPSHOT_SCHEMA, takenAt: now.toISOString(), head: head.status === 0 ? String(head.stdout).trim() : null, dirty };
  } catch { return null; }
}

/**
 * Welche Pfade sich zwischen zwei Ständen geändert haben (sortiert). Zwischen den Ständen committete Dateien
 * kommen über `git diff --name-only <alter HEAD> <neuer HEAD>` hinzu.
 */
export async function changedBetween({ repoRoot, git, before, after }) {
  const changed = new Set();
  for (const [relative, token] of Object.entries(after.dirty)) {
    if (before.dirty[relative] !== token) changed.add(relative);
  }
  for (const [relative, token] of Object.entries(before.dirty)) {
    if (relative in after.dirty) continue;
    // Beim Start abweichend, jetzt sauber: zurückgesetzt oder committet. Gleicher Inhalt wie beim Start heißt
    // nicht geändert (eine fremde Sitzung committete nur, was schon da war).
    if (tokenOf(repoRoot, relative) !== token) changed.add(relative);
  }
  if (before.head !== after.head && before.head && after.head) {
    const diff = await git(["diff", "--name-only", "-z", "--no-renames", before.head, after.head]);
    if (diff.status === 0) for (const relative of listZero(diff.stdout)) if (!isRuntimePath(slash(relative))) changed.add(slash(relative));
  }
  return [...changed].sort((left, right) => left.localeCompare(right, "en"));
}

export function writeSnapshot(file, snapshot) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = file + "." + process.pid + "." + crypto.randomBytes(6).toString("hex") + ".tmp";
  fs.writeFileSync(temporary, JSON.stringify(snapshot) + "\n", { encoding: "utf8", flag: "wx" });
  try { fs.renameSync(temporary, file); }
  catch (error) { try { fs.unlinkSync(temporary); } catch { /* weg */ } throw error; }
}

export function readSnapshot(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    return value && value.schema === SNAPSHOT_SCHEMA && value.dirty && typeof value.dirty === "object" ? value : null;
  } catch { return null; }
}

// --- Das Paket-Bündel (P13, Nachbesserung) -------------------------------------------------------------------------
// Im Bündel docs/packages/<id>/ schreiben der Executor und die Gates selbst: Haken, Status, Abschluss und EVIDENCE-Werte
// in PACKAGE.md, GATES.md und gates/*.md. Nur diese Änderungen sind vom Abgleich ausgenommen; ob eine Änderung nur
// daraus besteht, entscheidet die normalisierte Fassung (normalizePackageContractContent aus vendor/unlazy/scripts/lib/ledger-normalize.cjs, über git-intent geladen):
// ist sie vorher und nachher gleich, ist die Änderung erlaubt. OWNER.md und alles andere im Bündel wird abgeglichen.

const fold = (value) => (process.platform === "win32" ? String(value).toLowerCase() : String(value));

/** Ob `relative` eine Paketvertragsdatei des Bündels von `packageId` ist (PACKAGE.md, GATES.md, gates/*.md). */
export function bundleContractPath(relative, packageId) {
  const prefix = fold("docs/packages/" + packageId + "/");
  const value = slash(relative);
  if (!fold(value).startsWith(prefix)) return false;
  const pattern = process.platform === "win32" ? /^(?:PACKAGE\.md|GATES\.md|gates\/[^/]+\.md)$/iu :
    /^(?:PACKAGE\.md|GATES\.md|gates\/[^/]+\.md)$/u;
  return pattern.test(value.slice(prefix.length));
}

/** Der Hash der normalisierten Fassung einer Paketvertragsdatei, "absent" ohne Datei. */
export function contractDigest(repoRoot, relative, normalize) {
  let content;
  try { content = fs.readFileSync(path.join(repoRoot, ...slash(relative).split("/"))); } catch { return "absent"; }
  return crypto.createHash("sha256").update(normalize(slash(relative), content)).digest("hex");
}

/** Die normalisierten Hashes aller Paketvertragsdateien des Bündels, Schlüssel in der Schreibweise des Repos. */
export function contractDigests(repoRoot, packageId, normalize) {
  const bundle = "docs/packages/" + packageId;
  const files = ["PACKAGE.md", "GATES.md"].map((name) => bundle + "/" + name);
  try {
    for (const name of fs.readdirSync(path.join(repoRoot, "docs", "packages", packageId, "gates"))) {
      if (name.endsWith(".md")) files.push(bundle + "/gates/" + name);
    }
  } catch { /* kein gates-Ordner */ }
  const digests = {};
  for (const relative of files) digests[fold(relative)] = contractDigest(repoRoot, relative, normalize);
  return digests;
}

/** Ob die Änderung an `relative` nur aus Haken, Status, Abschluss und EVIDENCE besteht. */
export function contractChangeOnlyRuntime({ repoRoot, packageId, relative, before, normalize }) {
  if (!before || typeof before !== "object" || !bundleContractPath(relative, packageId)) return false;
  const was = Object.prototype.hasOwnProperty.call(before, fold(relative)) ? before[fold(relative)] : "absent";
  return was === contractDigest(repoRoot, relative, normalize);
}

