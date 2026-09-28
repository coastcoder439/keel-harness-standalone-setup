// Suche nach fest verdrahteten Modellen (Plan-Schritt 8, Gates M6 und M7).
//
// Ein kleiner Zerleger trennt Code, Kommentare, Zeichenketten und reguläre Ausdrücke. Treffer
// sind (a) Modellnamen in Zeichenketten und (b) gelesene Modell-Umgebungsvariablen
// (process.env.*_MODEL, *_PROVIDER). Kommentare und reguläre Ausdrücke zählen nicht: sie rufen
// kein Modell auf. Beide Tests (Dashboard und harness-core) benutzen diese eine Suche.

import fs from "node:fs";
import path from "node:path";

export const MODEL_NAME_PATTERN = /\b(?:gemma\d|qwen\d|llama\d|deepseek|mistral|phi\d|gemini-\d|grok-\d|gpt-\d|gpt-4o|o\d-(?:mini|pro)|claude-(?:opus|sonnet|haiku|fable)|(?:opus|sonnet|haiku)-\d|whisper-(?:\d|base|turbo|tiny|small|medium|large)|gpt-transcribe|tts-1)/iu;
export const MODEL_ENV_PATTERN = /process\.env(?:\.([A-Za-z0-9_]+)|\[\s*["'`]([A-Za-z0-9_]+)["'`]\s*\])/gu;
export const MODEL_ENV_NAME = /(?:_MODEL|_PROVIDER)$/u;

const REGEX_PREFIX = new Set([..."(,=:[!&|?{};+-*%<>~^"]);
const REGEX_KEYWORDS = new Set(["return", "typeof", "case", "do", "else", "in", "of", "new", "delete", "void", "throw", "yield", "await"]);

/** Zerlegt Quelltext; liefert Zeichenketten mit Zeile und den Code ohne Kommentare und Zeichenketteninhalt. */
export function tokenizeSource(source) {
  const text = source.replace(/\r\n/gu, "\n");
  const strings = [];
  let code = "";
  let line = 1;
  let i = 0;
  let lastSignificant = "";
  let lastWord = "";
  const templateDepth = [];
  const push = (value, startLine) => strings.push({ value, line: startLine });
  const readString = (quote) => {
    const startLine = line;
    let value = "";
    i += 1;
    while (i < text.length) {
      const ch = text[i];
      if (ch === "\\") { value += text.slice(i, i + 2); if (text[i + 1] === "\n") line += 1; i += 2; continue; }
      if (ch === "\n") { line += 1; break; } // unterminiert (z. B. Apostroph in JSX-Text)
      if (ch === quote) { i += 1; break; }
      value += ch; i += 1;
    }
    push(value, startLine);
    // Bezeichner-artige Inhalte bleiben im Code sichtbar, damit process.env["NAME"] erkannt wird.
    code += quote + (/^[A-Za-z0-9_]+$/u.test(value) ? value : "") + quote;
    lastSignificant = quote;
  };
  const readTemplate = () => {
    // Liest bis zum Ende oder bis ${; bei ${ wird die Verschachtelung gemerkt.
    const startLine = line;
    let value = "";
    while (i < text.length) {
      const ch = text[i];
      if (ch === "\\") { value += text.slice(i, i + 2); i += 2; continue; }
      if (ch === "\n") line += 1;
      if (ch === "`") { i += 1; push(value, startLine); code += "``"; lastSignificant = "`"; return; }
      if (ch === "$" && text[i + 1] === "{") { i += 2; push(value, startLine); code += "`${"; templateDepth.push(0); lastSignificant = "{"; return; }
      value += ch; i += 1;
    }
    push(value, startLine);
  };
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === "\n") { line += 1; code += ch; i += 1; continue; }
    if (ch === "/" && next === "/") { while (i < text.length && text[i] !== "\n") i += 1; continue; }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) { if (text[i] === "\n") { line += 1; code += "\n"; } i += 1; }
      i += 2; continue;
    }
    if (ch === "\"" || ch === "'") { readString(ch); lastWord = ""; continue; }
    if (ch === "`") { i += 1; readTemplate(); lastWord = ""; continue; }
    if (templateDepth.length && ch === "{") { templateDepth[templateDepth.length - 1] += 1; code += ch; i += 1; lastSignificant = ch; continue; }
    if (templateDepth.length && ch === "}") {
      if (templateDepth[templateDepth.length - 1] === 0) { templateDepth.pop(); i += 1; code += "}"; readTemplate(); continue; }
      templateDepth[templateDepth.length - 1] -= 1;
    }
    if (ch === "/" && lastSignificant !== "<" && (lastSignificant === "" || REGEX_PREFIX.has(lastSignificant) || REGEX_KEYWORDS.has(lastWord))) {
      // regulärer Ausdruck: überspringen, zählt nicht als Modellname
      i += 1;
      let inClass = false;
      while (i < text.length && text[i] !== "\n") {
        const c = text[i];
        if (c === "\\") { i += 2; continue; }
        if (c === "[") inClass = true;
        else if (c === "]") inClass = false;
        else if (c === "/" && !inClass) { i += 1; break; }
        i += 1;
      }
      while (i < text.length && /[a-z]/iu.test(text[i])) i += 1;
      code += "/r/"; lastSignificant = "/"; lastWord = ""; continue;
    }
    code += ch;
    if (!/\s/u.test(ch)) {
      lastSignificant = ch;
      if (/[A-Za-z0-9_$]/u.test(ch)) lastWord = (/[A-Za-z0-9_$]/u.test(text[i - 1] || "") ? lastWord : "") + ch;
      else lastWord = "";
    }
    i += 1;
  }
  return { strings, code };
}

/** Treffer einer Datei: Modellnamen in Zeichenketten und gelesene Modell-Umgebungsvariablen. */
export function scanSource(source) {
  const { strings, code } = tokenizeSource(source);
  const hits = [];
  for (const item of strings) {
    const match = item.value.match(MODEL_NAME_PATTERN);
    if (match) hits.push({ line: item.line, kind: "model-name", value: match[0] });
  }
  const lines = code.split("\n");
  lines.forEach((text, index) => {
    for (const match of text.matchAll(MODEL_ENV_PATTERN)) {
      const name = match[1] || match[2];
      if (name && MODEL_ENV_NAME.test(name)) hits.push({ line: index + 1, kind: "model-env", value: name });
    }
  });
  return hits;
}

const SOURCE_EXTENSIONS = /\.(?:[cm]?[jt]sx?)$/u;
const SKIP_DIRECTORIES = new Set(["node_modules", ".next", ".next-dev", ".test-build", "test", ".git"]);

/** Sammelt Quelldateien unter den Wurzeln (Tests, Build-Ordner und node_modules ausgenommen). */
export function listSourceFiles(root, entries) {
  const files = [];
  const walk = (absolute) => {
    const stat = fs.statSync(absolute, { throwIfNoEntry: false });
    if (!stat) return;
    if (stat.isDirectory()) {
      if (SKIP_DIRECTORIES.has(path.basename(absolute))) return;
      for (const name of fs.readdirSync(absolute).sort()) walk(path.join(absolute, name));
      return;
    }
    if (SOURCE_EXTENSIONS.test(absolute) && !/\.test\.[cm]?[jt]sx?$/u.test(absolute) && !absolute.endsWith(".d.ts")) files.push(absolute);
  };
  for (const entry of entries) walk(path.join(root, entry));
  return files;
}

/**
 * Durchsucht die Dateien; `allowed(relative)` nimmt die Prozessmodell-Module aus. Ergebnis:
 * [{ file (relativ, mit /), line, kind, value }].
 */
export function scanForHardwiredModels(root, entries, { allowed = () => false } = {}) {
  const hits = [];
  for (const file of listSourceFiles(root, entries)) {
    const relative = path.relative(root, file).replaceAll("\\", "/");
    if (allowed(relative)) continue;
    for (const hit of scanSource(fs.readFileSync(file, "utf8"))) hits.push({ file: relative, ...hit });
  }
  return hits;
}
