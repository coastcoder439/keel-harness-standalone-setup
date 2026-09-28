// Freigegebener Umfang der Analyse (Paket harness-dashboard-repair, Plan-Schritt 20, Gate A3).
//
// Der Owner hat am 26.09.2026 den ersten Lauf „mit Ignore-Vorschlag“ freigegeben (Vorlage
// docs/packages/new-harness-architecture-maps/evidence/download-approval.md, Abschnitt 4 und Punkt 4 in
// Abschnitt 5; Owner-Zwischennachricht „KLAR DOWNLOAD OK …“). Die Muster unten stehen dort wörtlich.
// Zusätzlich bleiben unversionierte Ordner und Dateien draußen: Understand-Anything liest
// `git ls-files -co --exclude-standard` (scan-project.mjs), also auch alles, was nie committet wurde —
// im Hauptbaum des Quell-Repos die Altordner focus-dashboard-v2/, focus-dashboard-v3/,
// focus-orb-prototype/ und unversionierte Teile von focus-dashboard-v4/ (gemessen 28.09.2026 mit
// `git status --porcelain --untracked-files=normal`).
//
// Eine Quelle für drei Aufrufer: der Job schreibt daraus `.ua/.understandignore`, die Kostenschätzung und
// das Dashboard rechnen mit genau diesem Text, damit Schätzung und Lauf denselben Umfang haben.

import { spawnSync } from "node:child_process";

/** Wörtlich aus download-approval.md Abschnitt 4 („Ignore-Vorschlag“), vom Owner am 26.09.2026 freigegeben. */
export const APPROVED_IGNORE_PATTERNS = Object.freeze([
  "docs/",
  "**/evidence/",
  "eruierung-*/",
  "model-tests/",
  "quellen/",
  "*.jsonl",
]);

export const IGNORE_FILE_NAME = ".understandignore";

/**
 * Unversionierte, nicht ignorierte Pfade relativ zur Projektwurzel, Ordner zusammengefasst
 * (`--untracked-files=normal`), mit `/` am Ende für Ordner. Kein git oder kein Repository: leere Liste.
 */
export function untrackedPaths(projectRoot, { dataDirectoryName = ".ua" } = {}) {
  const result = spawnSync("git", ["status", "--porcelain=v1", "-z", "--untracked-files=normal"], {
    cwd: projectRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, windowsHide: true,
  });
  if (result.status !== 0 || typeof result.stdout !== "string") return [];
  return result.stdout.split("\0")
    .filter((entry) => entry.startsWith("?? "))
    .map((entry) => entry.slice(3).replace(/\\/g, "/"))
    .filter((entry) => entry && entry !== `${dataDirectoryName}/` && !entry.startsWith(`${dataDirectoryName}/`))
    .sort((left, right) => left.localeCompare(right, "en"));
}

function anchored(relativePath) {
  // Führender Schrägstrich verankert das Muster an der Wurzel (gitignore-Semantik), damit
  // „focus-dashboard-v2/“ nicht auch einen gleichnamigen Ordner tiefer im Baum trifft.
  return `/${relativePath.replace(/^\/+/u, "")}`;
}

/**
 * Inhalt der Ignore-Datei, die der Job als `<datenordner>/.understandignore` schreibt.
 * `untracked` ist injizierbar (Tests); ohne Angabe wird git im Projekt gefragt.
 */
export function buildUnderstandIgnore(projectRoot, { untracked, dataDirectoryName = ".ua" } = {}) {
  const extra = (untracked ?? untrackedPaths(projectRoot, { dataDirectoryName })).map(anchored);
  const lines = [
    "# Angelegt vom Architekturbild-Job (harness-core/architecture-maps/ignore-proposal.mjs).",
    "# Freigegebener Ignore-Vorschlag (Owner 26.09.2026, download-approval.md Abschnitt 4):",
    ...APPROVED_IGNORE_PATTERNS,
    "# Unversionierte Ordner und Dateien (nie committet, nicht Teil des Projekts):",
    ...extra,
  ];
  return `${lines.join("\n")}\n`;
}
