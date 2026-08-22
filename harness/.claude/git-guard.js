#!/usr/bin/env node
// PreToolUse-Hook fuer Bash-Befehle, die mit git beginnen.
// Loest zwei reale Probleme dieses Workspace:
//   1) Commit landet im falschen Repo (7 verschachtelte Repos, Regel war nur Prosa)
//   2) verwaiste .git/index.lock blockieren jeden Commit (an einem Tag 3x passiert)
// Blockiert nichts, sondern raeumt und meldet -- Sichtbarkeit statt Bevormundung.

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const LOCK_MIN_ALTER_MIN = 5; // juenger = laeuft evtl. wirklich
// MSYS/Git-Bash schreibt Windows-Laufwerke als /c/... -- path.resolve() macht daraus
// C:\c\... , einen Pfad den es nicht gibt. Der Waechter meldete dann "liegt in keinem
// Git-Repo", obwohl das Repo da war (belegt 22.08.2026, mehrfach in einer Sitzung).
// Ein Waechter, der bei einem gaengigen Pfadformat Fehlalarme gibt, wird ignoriert.
function msysPfad(p) {
  if (process.platform !== "win32" || !p) return p;
  return String(p).replace(/^\/([A-Za-z])(?=\/|$)/, "$1:");
}


function sh(cmd, cwd) {
  try {
    return execSync(cmd, { cwd, encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

function laeuftGit() {
  // [Mac->Win-Fix 21.08.2026, U2] Prozessliste plattformabhaengig. 'ps -Ao' existiert
  // unter Windows nicht (weder cmd.exe noch das MSYS-ps der Git-Bash kennen -A/-o) ->
  // sh() gab null -> laeuftGit() lieferte IMMER false -> die 0-Byte-index.lock wurde
  // auch geloescht, waehrend eine Parallel-Sitzung real ein git hielt (Index-Beschaedigung).
  const roh =
    process.platform === "win32"
      ? sh('tasklist /FI "IMAGENAME eq git.exe" /NH')
      : sh("ps -Ao command=");
  // Fail-SAFE statt fail-open: laesst sich die Prozessliste nicht ermitteln (null),
  // konservativ annehmen, dass git laeuft -> die Lock NICHT entfernen. Ein stehender
  // Hinweis ist harmlos, eine zerschossene Index-Datei nicht.
  if (roh == null) return true;
  if (process.platform === "win32") return /(^|\s)git\.exe\b/i.test(roh);
  return roh.split("\n").some((z) => /(^|\/)git(\s|$)/.test(z.trim()));
}

let eingabe = "";
process.stdin.on("data", (c) => (eingabe += c));
process.stdin.on("end", () => {
  let daten = {};
  try {
    daten = JSON.parse(eingabe || "{}");
  } catch {}
  const befehl = daten?.tool_input?.command || "";
  if (!/\bgit\b/.test(befehl)) return process.exit(0);

  const meldungen = [];

  // --- Ziel-Repo bestimmen: -C <pfad> gewinnt, sonst cd im selben Befehl, sonst cwd ---
  // PreToolUse laeuft VOR der Ausfuehrung: bei "cd X && git ..." hat das cd zur
  // Hook-Zeit noch nicht stattgefunden -- nur cwd zu lesen meldet dann das falsche
  // Ziel-Repo, ohne Warnung. Deshalb zaehlt das letzte cd VOR dem git-Wort mit;
  // ein relatives -C loest sich gegen dieses cd auf.
  // Bekannte Grenzen: Text in Anfuehrungszeichen (echo/printf/-m) wird mitgelesen;
  // Shell-Variablen in Pfaden bleiben unexpandiert und werden als "nicht pruefbar"
  // gemeldet statt als Fehlwarnung.
  const gitPos = befehl.search(/\bgit\b/);
  const cdRe = /(?:^|&&|;|\|\|)\s*cd\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/g;
  let cdPfad = null;
  let basis = process.cwd();
  let basisUnpruefbar = false;
  let cdTreffer;
  // KETTE statt nur letztes cd (angeglichen an commit-pathspec-guard, 01.08.2026):
  // "cd /tmp && … && cd unterordner && git …" landet sonst in <cwd>/unterordner statt
  // /tmp/unterordner -- und der Waechter meldet ein Ziel-Repo, das es nicht gibt.
  // Shell-Variablen im cd-Pfad machen die Basis unaufloesbar (der Hook sieht den Befehl
  // VOR der Expansion) -- dann wird "nicht pruefbar" gemeldet statt einer Fehlwarnung.
  // Beides live an sich selbst gefunden, 01.08.2026.
  while ((cdTreffer = cdRe.exec(befehl)) && cdTreffer.index < gitPos) {
    cdPfad = cdTreffer[1] || cdTreffer[2] || cdTreffer[3];
    if (cdPfad.includes("$")) basisUnpruefbar = true;
    else if (path.isAbsolute(msysPfad(cdPfad))) basisUnpruefbar = false;
    basis = path.resolve(basis, msysPfad(cdPfad));
  }
  const mC = befehl.match(/git\s+-C\s+(?:"([^"]+)"|'([^']+)'|(\S+))/);
  const zielRoh = mC ? mC[1] || mC[2] || mC[3] : cdPfad;
  const ziel = mC ? path.resolve(basis, msysPfad(zielRoh)) : basis;
  const top = sh("git rev-parse --show-toplevel", ziel);

  // --- 1) Verwaiste Locks raeumen (im Ziel-Repo) ---
  if (top) {
    const lock = path.join(top, ".git", "index.lock");
    try {
      const st = fs.statSync(lock);
      const alterMin = (Date.now() - st.mtimeMs) / 60000;
      if (st.size === 0 && alterMin > LOCK_MIN_ALTER_MIN && !laeuftGit()) {
        fs.unlinkSync(lock);
        meldungen.push(
          `Verwaiste .git/index.lock entfernt (0 Byte, ${Math.round(alterMin)} min alt, kein git-Prozess) in ${path.basename(top)}`
        );
      } else if (st.size === 0 && alterMin > LOCK_MIN_ALTER_MIN) {
        meldungen.push(`ACHTUNG: index.lock in ${path.basename(top)} ist ${Math.round(alterMin)} min alt, aber ein git-Prozess laeuft -- nicht entfernt.`);
      }
    } catch {}
  }

  // --- 2) Bei schreibenden Befehlen: Ziel-Repo ansagen ---
  // Achtung: -C-Pfade enthalten oft Leerzeichen (ein Ordnername darf welche
  // haben, und der dieses Bau-Rechners hat sie) -- deshalb NICHT ueber \S+
  // mitmatchen, sondern das Verb unabhaengig suchen.
  if (/\b(commit|push|merge|rebase|reset|checkout|switch)\b/.test(befehl) || /\bgit\s+(-C\s+.+\s+)?add\b/.test(befehl)) {
    if (!top) {
      // Shell-Variablen ($L, $WB) erreichen den Hook UNexpandiert -- PreToolUse sieht
      // den Roh-Befehl. "liegt in keinem Repo" waere dann ein Fehlalarm; ehrlich ist
      // nur "nicht pruefbar".
      if ((zielRoh && zielRoh.includes("$")) || basisUnpruefbar) {
        const was = zielRoh && zielRoh.includes("$") ? `Ziel "${zielRoh}"` : `ein cd-Pfad im Befehl`;
        meldungen.push(`${was} enthaelt eine Shell-Variable -- fuer den Waechter nicht pruefbar (er sieht den Befehl vor der Expansion).`);
      } else {
        meldungen.push(`WARNUNG: "${ziel}" liegt in keinem Git-Repo -- der Befehl greift ins Leere.`);
      }
    } else {
      const branch = sh("git rev-parse --abbrev-ref HEAD", top) || "?";
      const remote = (sh("git remote get-url origin", top) || "(kein Remote)")
        .replace(/.*github\.com[:/]/, "")
        .replace(/\.git$/, "");
      // Werkbank = das Wurzel-Repo dieses Workspace. NICHT den Namen fest
      // verdrahten -- sonst meldet der Waechter in jedem nachgebauten Harness
      // Unsinn. CLAUDE_PROJECT_DIR setzt Claude Code selbst.
      const werkbank = process.env.CLAUDE_PROJECT_DIR
        ? sh("git rev-parse --show-toplevel", process.env.CLAUDE_PROJECT_DIR)
        : null;
      const istWerkbank = werkbank ? top === werkbank : false;
      const hinweis =
        !mC && werkbank && !istWerkbank
          ? cdPfad
            ? `  <- cd im Befehl erkannt; Konvention bleibt git -C (CLAUDE.md, Sichern).`
            : `  <- OHNE -C: landet in ${path.basename(top)}, nicht in ${path.basename(werkbank)} -- cwd aus frueherem cd ist unsichtbarer Zustand. Absicht?`
          : "";
      meldungen.push(`Ziel-Repo: ${path.basename(top)} [${branch}] -> ${remote}${hinweis}`);
    }
  }

  if (meldungen.length) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          additionalContext: "git-guard: " + meldungen.join(" | "),
        },
      })
    );
  }
  process.exit(0);
});
