// Kostenschätzung der ersten Understand-Anything-Analyse eines Projekts, ohne Modellaufruf
// (Paket new-harness-architecture-maps, Plan-Schritt 4, Gate J4).
//
// Die Schätzung läuft VOR dem Herunterladen von Understand-Anything, damit der Owner die Kosten vor dem
// Einschalten eines Projekts sieht. Deshalb nutzt sie nicht den Code von Understand-Anything, sondern spiegelt
// nur die Dateiauswahl, die dessen Scan trifft:
//   1. Dateiliste wie `skills/understand/scan-project.mjs:471-493` (Tag v2.9.0):
//      `git ls-files -z -co --exclude-standard`, ohne git ein rekursives Durchlaufen.
//   2. Ignore-Regeln wie `packages/core/src/ignore-filter.ts:9-111` (Tag v2.9.0): feste Standardliste, dann
//      `<datenordner>/.understandignore`, dann `.understandignore` in der Projektwurzel; gitignore-Semantik.
//   3. Den Datenordner selbst (`.ua/` bzw. `.understand-anything/`) zählt die Schätzung nie mit, weil der Job
//      ihn beim Einschalten in `.git/info/exclude` einträgt (design/decisions.md F3).
// Nach dem freigegebenen Bezug (Plan-Schritt 6) prüft ein Test, dass die Standardliste unten mit
// `ignore-filter.ts` der festgehaltenen Version übereinstimmt.
//
// Diese Datei nennt bewusst kein Modell: Welches Modell der Job nutzt und was es kostet, kommt aus den
// Einstellungen je Prozess (new-harness-process-model-settings) und wird hier als `pricing` übergeben.

import gitBinary from "../git/git-binary.cjs";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildUnderstandIgnore } from "./ignore-proposal.mjs";

export const UNDERSTAND_ANYTHING_SOURCE = Object.freeze({
  repository: "https://github.com/Egonex-AI/Understand-Anything",
  tag: "v2.9.0",
  commit: "f08763d11d0202a8a8f52b5dedda6d1b2e2ebac8",
  ignoreFilter: "understand-anything-plugin/packages/core/src/ignore-filter.ts",
});

// Wörtlich aus ignore-filter.ts:9-72 (Tag v2.9.0), Reihenfolge beibehalten.
export const DEFAULT_IGNORE_PATTERNS = Object.freeze([
  "node_modules/", ".git/", "vendor/", "venv/", ".venv/", "__pycache__/",
  "dist/", "build/", "out/", "coverage/", ".next/", ".cache/", ".turbo/", "target/", "obj/",
  "*.lock", "package-lock.json", "yarn.lock", "pnpm-lock.yaml",
  "*.png", "*.jpg", "*.jpeg", "*.gif", "*.svg", "*.ico", "*.woff", "*.woff2", "*.ttf", "*.eot",
  "*.mp3", "*.mp4", "*.pdf", "*.zip", "*.tar", "*.gz",
  "*.min.js", "*.min.css", "*.map", "*.generated.*",
  ".idea/", ".vscode/",
  "LICENSE", ".gitignore", ".editorconfig", ".prettierrc", ".eslintrc*", "*.log",
]);

// Annahmen der Schätzung. Jede Zahl mit Herkunft; die mit „Annahme“ markierten werden im ersten echten Lauf
// (Plan-Schritt 11, Gate D5) gegen die gemessenen Tokens geprüft und bei mehr als 50 Prozent Abweichung berichtigt.
export const ESTIMATE_ASSUMPTIONS = Object.freeze({
  // Übliche Faustregel für Quelltext; Annahme.
  bytesPerToken: 4,
  // Rest-Batches zu 25 Dateien (`compute-batches.mjs:296` MAX_MERGE_TARGET), Gruppen bis 35 (:414).
  filesPerBatch: 25,
  // Auftrag an jeden file-analyzer: `agents/file-analyzer.md` 33901 Bytes / 4.
  promptTokensPerBatch: Math.ceil(33901 / 4),
  // Grundlast einer Unteragenten-Sitzung (Systemauftrag, Werkzeugbeschreibungen); Annahme.
  sessionTokensPerBatch: 15000,
  // Der Quelltext liegt über mehrere Züge eines file-analyzers im Kontext; Annahme.
  sourceRereadFactor: 2,
  // Scan-Phase laut Skill „~157k tokens“ (`skills/understand/SKILL.md:771-772`).
  scanPhaseTokens: 157000,
  // Feste Aufträge: SKILL.md 45581 + project-scanner 17248 + assemble-reviewer 5033
  // + architecture-analyzer 22601 + tour-builder 21336 Bytes, je / 4.
  fixedPromptTokens: Math.ceil((45581 + 17248 + 5033 + 22601 + 21336) / 4),
  // Ausgabe je Datei (Zusammenfassung, Knoten für Funktionen/Klassen, Kanten); Annahme.
  outputTokensPerFile: 350,
  // Ausgabe der Architektur-, Tour- und Prüfphasen; Annahme.
  fixedOutputTokens: 20000,
});

function toPosix(value) {
  return value.split(path.sep).join("/").replace(/\\/g, "/");
}

function escapeRegex(value) {
  return value.replace(/[.+^${}()|[\]\\]/g, "\\$&");
}

function globToRegexSource(glob) {
  let out = "";
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i];
    if (char === "*") {
      if (glob[i + 1] === "*") {
        const before = i === 0 || glob[i - 1] === "/";
        const after = glob[i + 2] === "/" || i + 2 === glob.length;
        if (before && glob[i + 2] === "/") { out += "(?:.*/)?"; i += 2; continue; }
        if (before && after) { out += ".*"; i += 1; continue; }
        out += "[^/]*"; i += 1; continue;
      }
      out += "[^/]*";
    } else if (char === "?") {
      out += "[^/]";
    } else {
      out += escapeRegex(char);
    }
  }
  return out;
}

function compileRule(raw) {
  let line = raw.replace(/\r$/, "");
  if (!line.trim() || line.startsWith("#")) return null;
  line = line.replace(/(?<!\\)\s+$/, "");
  let negate = false;
  if (line.startsWith("!")) { negate = true; line = line.slice(1); }
  else if (line.startsWith("\\!") || line.startsWith("\\#")) line = line.slice(1);
  let dirOnly = false;
  if (line.endsWith("/")) { dirOnly = true; line = line.replace(/\/+$/, ""); }
  if (!line) return null;
  const anchored = line.includes("/");
  if (line.startsWith("/")) line = line.slice(1);
  const body = globToRegexSource(line);
  const regex = new RegExp(`^${anchored ? "" : "(?:.*/)?"}${body}$`);
  return { negate, dirOnly, regex, source: raw };
}

/** gitignore-artige Prüfung: später passende Regeln gewinnen; ein ausgeschlossener Ordner schließt alles darin aus. */
export function createIgnoreMatcher(patterns) {
  const rules = [];
  for (const pattern of patterns) {
    for (const line of String(pattern).split("\n")) {
      const rule = compileRule(line);
      if (rule) rules.push(rule);
    }
  }
  const decide = (candidate, isDir) => {
    let ignored = false;
    for (const rule of rules) {
      if (rule.dirOnly && !isDir) continue;
      if (rule.regex.test(candidate)) ignored = !rule.negate;
    }
    return ignored;
  };
  return {
    isIgnored(relativePath) {
      const parts = toPosix(relativePath).replace(/^\.\//, "").split("/").filter(Boolean);
      for (let depth = 1; depth < parts.length; depth += 1) {
        if (decide(parts.slice(0, depth).join("/"), true)) return true;
      }
      return decide(parts.join("/"), false);
    },
  };
}

/** Datenordner wie `resolveUaDir`: der Altordner `.understand-anything/` gewinnt, wenn er existiert. */
export function resolveDataDirectoryName(projectRoot) {
  return existsSync(path.join(projectRoot, ".understand-anything")) ? ".understand-anything" : ".ua";
}

export function projectIgnorePatterns(projectRoot) {
  const patterns = [...DEFAULT_IGNORE_PATTERNS];
  for (const file of [
    path.join(projectRoot, resolveDataDirectoryName(projectRoot), ".understandignore"),
    path.join(projectRoot, ".understandignore"),
  ]) {
    if (existsSync(file)) patterns.push(readFileSync(file, "utf8"));
  }
  return patterns;
}

function listViaGit(projectRoot) {
  const result = gitBinary.gitSync(["ls-files", "-z", "-co", "--exclude-standard"], {
    cwd: projectRoot, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, windowsHide: true,
  });
  if (result.status !== 0 || typeof result.stdout !== "string" || !result.stdout) return null;
  return result.stdout.split("\0").filter(Boolean).map(toPosix);
}

function listViaWalk(projectRoot) {
  const out = [];
  const walk = (relative) => {
    let entries;
    try { entries = readdirSync(path.join(projectRoot, relative), { withFileTypes: true }); }
    catch { return; }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, "en"))) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const child = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile()) out.push(child);
    }
  };
  walk("");
  return out;
}

/** Die Dateien, die die erste Analyse lesen würde, mit Größe in Bytes und Zeilen. */
export function scanProject(projectRoot, options = {}) {
  const root = path.resolve(projectRoot);
  if (!existsSync(root) || !lstatSync(root).isDirectory()) {
    throw new Error(`Projektordner nicht gefunden: ${root}`);
  }
  const listed = listViaGit(root);
  const candidates = listed ?? listViaWalk(root);
  const dataDirectory = resolveDataDirectoryName(root);
  // `approvedIgnore`: derselbe Umfang, den der Job als .ua/.understandignore schreibt (ignore-proposal.mjs,
  // Gate A3) -- so misst die Schätzung lesend, ohne im Projekt eine Datei anzulegen.
  const approved = options.approvedIgnore ? [buildUnderstandIgnore(root, { dataDirectoryName: dataDirectory })] : [];
  const matcher = createIgnoreMatcher([...projectIgnorePatterns(root), ...approved, ...(options.extraIgnore ?? [])]);
  const files = [];
  let ignored = 0;
  for (const relative of candidates) {
    if (relative === dataDirectory || relative.startsWith(`${dataDirectory}/`) || matcher.isIgnored(relative)) {
      ignored += 1;
      continue;
    }
    let buffer;
    try {
      const info = lstatSync(path.join(root, relative));
      if (!info.isFile()) continue;
      buffer = readFileSync(path.join(root, relative));
    } catch {
      continue;
    }
    let lines = 0;
    for (const byte of buffer) if (byte === 0x0a) lines += 1;
    files.push({ path: relative, bytes: buffer.length, lines });
  }
  files.sort((a, b) => a.path.localeCompare(b.path, "en"));
  return {
    root,
    enumeration: listed ? "git" : "walk",
    candidates: candidates.length,
    ignored,
    files,
    totalFiles: files.length,
    totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
    totalLines: files.reduce((sum, file) => sum + file.lines, 0),
  };
}

function validPricing(pricing) {
  if (!pricing || typeof pricing !== "object") return false;
  if (pricing.kind === "local" || pricing.kind === "subscription") return true;
  return pricing.kind === "api"
    && Number.isFinite(pricing.inputPerMillionTokens) && pricing.inputPerMillionTokens >= 0
    && Number.isFinite(pricing.outputPerMillionTokens) && pricing.outputPerMillionTokens >= 0
    && typeof pricing.currency === "string" && pricing.currency.length > 0;
}

/**
 * Tokens und Kosten der ersten Analyse aus einem Scan.
 * pricing: { kind: "local" } | { kind: "subscription" } |
 *          { kind: "api", inputPerMillionTokens, outputPerMillionTokens, currency }
 */
export function estimateFirstAnalysis(scan, pricing, assumptions = ESTIMATE_ASSUMPTIONS) {
  if (!validPricing(pricing)) {
    throw new Error("Preisangabe fehlt oder ist ungültig (local, subscription oder api mit Preisen je Million Tokens).");
  }
  const a = assumptions;
  const sourceTokens = Math.ceil(scan.totalBytes / a.bytesPerToken);
  const batches = scan.totalFiles === 0 ? 0 : Math.ceil(scan.totalFiles / a.filesPerBatch);
  const inputTokens = scan.totalFiles === 0 ? 0
    : a.scanPhaseTokens + a.fixedPromptTokens
      + batches * (a.promptTokensPerBatch + a.sessionTokensPerBatch)
      + sourceTokens * a.sourceRereadFactor;
  const outputTokens = scan.totalFiles === 0 ? 0 : scan.totalFiles * a.outputTokensPerFile + a.fixedOutputTokens;
  let cost;
  if (pricing.kind === "local") {
    cost = { kind: "local", amount: 0, currency: null, note: "Lokales Modell: keine Kosten pro Token." };
  } else if (pricing.kind === "subscription") {
    cost = { kind: "subscription", amount: 0, currency: null, note: "Im Abo enthalten; die Tokens zählen gegen das Nutzungskontingent." };
  } else {
    const amount = (inputTokens / 1e6) * pricing.inputPerMillionTokens + (outputTokens / 1e6) * pricing.outputPerMillionTokens;
    cost = { kind: "api", amount: Math.round(amount * 100) / 100, currency: pricing.currency, note: null };
  }
  return {
    files: scan.totalFiles,
    bytes: scan.totalBytes,
    lines: scan.totalLines,
    sourceTokens,
    batches,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    cost,
    assumptions: a,
    modelCalls: 0,
  };
}

export function estimateProjectCost(projectRoot, pricing, options = {}) {
  const scan = scanProject(projectRoot, options);
  return { scan: { ...scan, files: undefined }, estimate: estimateFirstAnalysis(scan, pricing, options.assumptions) };
}

function parseArguments(argv) {
  const args = { root: null, pricing: { kind: "subscription" }, extraIgnore: [], top: 0, approvedIgnore: false };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === "--pricing") args.pricing = JSON.parse(argv[++i]);
    else if (value === "--ignore-file") args.extraIgnore.push(readFileSync(argv[++i], "utf8"));
    else if (value === "--top") args.top = Number(argv[++i]);
    else if (value === "--approved-ignore") args.approvedIgnore = true;
    else if (!args.root) args.root = value;
    else throw new Error(`Unbekanntes Argument: ${value}`);
  }
  if (!args.root) throw new Error("Aufruf: node cost-estimate.mjs <projektordner> [--pricing <json>] [--ignore-file <datei>] [--approved-ignore] [--top <n>]");
  return args;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const args = parseArguments(process.argv.slice(2));
    const scan = scanProject(args.root, { extraIgnore: args.extraIgnore, approvedIgnore: args.approvedIgnore });
    const estimate = estimateFirstAnalysis(scan, args.pricing);
    const byFolder = {};
    for (const file of scan.files) {
      const key = file.path.split("/").slice(0, 2).join("/");
      byFolder[key] ??= { files: 0, bytes: 0 };
      byFolder[key].files += 1;
      byFolder[key].bytes += file.bytes;
    }
    const topFolders = Object.entries(byFolder).sort((l, r) => r[1].bytes - l[1].bytes)
      .slice(0, args.top || 10).map(([folder, value]) => ({ folder, ...value }));
    process.stdout.write(`${JSON.stringify({ scan: { ...scan, files: undefined }, topFolders, estimate }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
