#!/usr/bin/env node
// PreToolUse-Hook [Beschluss D9, Auftraggeber 01.08.2026]: erzwingt im WERKBANK-Repo die
// Commit-Form  git commit -m "..." -- <pfad>  (CLAUDE.md, Sichern; Commit a160ac9).
//
// Grund: Fuenf parallele Sitzungen teilen denselben Index. "git commit" committet
// DEN INDEX, nicht die eigene Auswahl (belegt 01.08.2026: e37b798 nahm 2 fremde
// Dateien mit, 0120208 vier, obwohl genau eine gestaged war).
// BLOCKIEREND (exit 2) wie danger-guard.js — eine Ansage hilft nicht, wenn der
// Schaden im selben Befehl passiert.
//
// Wie danger-guard prueft dieser Waechter SEGMENTE mit git-KOPF, nie den Rohtext:
// "git commit" in Anfuehrungszeichen, Heredocs oder Testdaten ist DATEN, kein
// Befehl (erster Live-Fehlalarm genau daran: eine Testreihe, die Commit-Beispiele
// als printf-Nutzlast trug, wurde geblockt).
//
// Ausnahmen, bewusst: --amend / --fixup / --squash / --reuse-message / commit -C
// (Commit-Objekt-Wiederverwendung) und laufende Merges (.git/MERGE_HEAD) — dort
// ist das Committen des ganzen Index der Zweck. Restrisiko: auch --amend nimmt
// fremd Gestagedes mit; dokumentiert, nicht verschwiegen.
// NEBENWIRKUNG der erzwungenen Form: "git commit -- <pfad>" committet die
// ARBEITSBAUM-Fassung und uebergeht eine abweichend gestagede (git add -p).
// Pruefkommando ist deshalb "git diff HEAD -- <pfad>".
// ⚠ BERICHTIGT 03.08.2026: Hier stand "git diff <pfad>". Das ist FALSCH — dieses
// Kommando vergleicht den Arbeitsbaum gegen den INDEX, also gegen genau den
// Zustand, vor dem diese Regel warnt. Nachgestellt im Wegwerf-Repo: Datei O
// committet, Fassung A gestaged, Fassung B geschrieben -> "git diff f.txt" zeigt
// nur +B, "git diff HEAD -- f.txt" zeigt +A+B, und committet wird A+B. Nur das
// zweite Kommando zeigt, was wirklich in den Commit geht. CLAUDE.md:104 hatte es
// von Anfang an richtig; falsch war ausgerechnet die Blockade-Meldung, die der
// Mensch in dem Moment liest, in dem er das Kommando braucht.
// Nur das Werkbank-Repo: in verschachtelten Repos (git -C / cd) arbeitet je eine
// Sitzung allein — dort waere ein Block reine Reibung.
// Zweite Grenze: $-Variablen in -C/cd-Pfaden bleiben unexpandiert — ein per Variable
// adressiertes Ziel ist nicht aufloesbar. Der Waechter blockt dann NICHT (sonst traefe
// er legitime Commits in verschachtelte Repos), aber er warnt hoerbar, wenn zugleich
// die pathspec fehlt — still durchfallen war die Luecke (Brain-Befund 01.08.2026).

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

function sh(cmd, cwd) {
  try {
    return execSync(cmd, { cwd, encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

/** Heredoc-Rumpf ist Daten, nicht Befehl (gleiche Vorstufe wie danger-guard). */
function ohneHeredocs(befehl) {
  return befehl.replace(/<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1[\s\S]*?^\s*\2\s*$/gm, "<<HEREDOC-ENTFERNT");
}

/** Zerlegt in Befehls-Segmente. Trenner: ; && || | Zeilenumbruch — aber NUR
 *  ausserhalb von Anfuehrungszeichen (gleiche Vorstufe wie danger-guard; ein ;
 *  im Nachrichtentext darf ein Segment nicht koepfen). */
function segmente(befehl) {
  const teile = [];
  let akt = "";
  let q = null;
  for (let i = 0; i < befehl.length; i++) {
    const c = befehl[i];
    if (q) {
      akt += c;
      if (c === q && befehl[i - 1] !== "\\") q = null;
      continue;
    }
    if (c === '"' || c === "'") {
      q = c;
      akt += c;
      continue;
    }
    if (c === "\n" || c === ";" || c === "|") {
      teile.push(akt);
      akt = "";
      if (c === "|" && befehl[i + 1] === "|") i++;
      continue;
    }
    if (c === "&" && befehl[i + 1] === "&") {
      teile.push(akt);
      akt = "";
      i++;
      continue;
    }
    akt += c;
  }
  teile.push(akt);
  return teile.map((s) => s.trim()).filter(Boolean);
}

/** Der Befehlsname eines Segments — Zuweisungen und Vorspann uebersprungen. */
function kopf(segment) {
  for (const w of segment.split(/\s+/)) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) continue;
    if (/^(sudo|command|nohup|time|env|xargs|nice|exec)$/.test(w)) continue;
    return path.basename(w.replace(/^["']|["']$/g, ""));
  }
  return "";
}

/** Der git-Unterbefehl eines Segments (`git -C <pfad> commit` -> "commit"). */
function gitUnterbefehl(segment) {
  const m = segment.match(
    /\bgit\b((?:\s+(?:-C\s+(?:"[^"]*"|'[^']*'|\S+)|-c\s+\S+|--no-optional-locks|--no-pager))*)\s+([a-z][a-z-]*)/
  );
  return m ? m[2] : null;
}

let eingabe = "";
process.stdin.on("data", (c) => (eingabe += c));
process.stdin.on("end", () => {
  let daten = {};
  try {
    daten = JSON.parse(eingabe || "{}");
  } catch {}
  const roh = daten?.tool_input?.command || "";
  if (!/\bgit\b/.test(roh) || !/\bcommit\b/.test(roh)) return process.exit(0);

  const werkbank = process.env.CLAUDE_PROJECT_DIR
    ? sh("git rev-parse --show-toplevel", process.env.CLAUDE_PROJECT_DIR)
    : null;
  if (!werkbank) return process.exit(0);

  // cd VOR einem Segment wirkt fuer die spaeteren Segmente — PreToolUse laeuft vor
  // der Ausfuehrung, cwd allein kennt ein cd im selben Befehl noch nicht.
  let basis = process.cwd();
  let basisUnpruefbar = false; // true, sobald ein cd-Pfad eine Shell-Variable traegt
  const warnungen = [];

  for (const seg of segmente(ohneHeredocs(roh))) {
    const cdM = seg.match(/^cd\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/);
    if (cdM) {
      const cdRoh = cdM[1] || cdM[2] || cdM[3];
      if (cdRoh.includes("$")) basisUnpruefbar = true;
      else if (path.isAbsolute(cdRoh)) basisUnpruefbar = false;
      // relativer Pfad ohne Variable: Flag bleibt (relativ zu Unpruefbarem ist unpruefbar)
      basis = path.resolve(basis, cdRoh);
      continue;
    }
    if (kopf(seg) !== "git" || gitUnterbefehl(seg) !== "commit") continue;

    // Ziel-Repo dieses Segments: -C gewinnt (relativ zur cd-Basis), sonst Basis.
    const mC = seg.match(/git\s+-C\s+(?:"([^"]+)"|'([^']+)'|(\S+))/);
    const zielRoh = mC ? mC[1] || mC[2] || mC[3] : null;
    const ziel = mC ? path.resolve(basis, zielRoh) : basis;
    const zielUnpruefbar = zielRoh
      ? zielRoh.includes("$") || (!path.isAbsolute(zielRoh) && basisUnpruefbar)
      : basisUnpruefbar;
    const top = sh("git rev-parse --show-toplevel", ziel);
    if (!top || top !== werkbank) {
      // Unaufloesbares Variablen-Ziel OHNE pathspec: nicht blocken, aber hoerbar machen —
      // WENN das die Werkbank ist, verletzt der Commit die Index-Konvention.
      if (!top && zielUnpruefbar) {
        const entquotetWarn = seg.replace(/"[^"]*"/g, '""').replace(/'[^']*'/g, "''");
        if (!/\s--(\s|$)/.test(entquotetWarn) && !/--amend\b|--fixup[=\s]|--squash[=\s]|--reuse-message[=\s]/.test(seg)) {
          warnungen.push(
            `Ziel mit Shell-Variable nicht pruefbar UND keine pathspec: WENN das das Werkbank-Repo ist, verletzt dieser Commit die Index-Konvention (CLAUDE.md, Sichern). Pfad ausschreiben oder mit -- <pfad> committen. -> ${seg.slice(0, 120)}`
          );
        }
      }
      continue;
    }

    // Ausnahmen: Commit-Objekt-Wiederverwendung und laufender Merge.
    if (/--amend\b|--fixup[=\s]|--squash[=\s]|--reuse-message[=\s]/.test(seg)) continue;
    if (/\s-C\s/.test(seg.slice(seg.indexOf("commit")))) continue; // git commit -C <commit>
    if (fs.existsSync(path.join(top, ".git", "MERGE_HEAD"))) continue;

    // pathspec: " -- " ausserhalb von Anfuehrungszeichen, im SEGMENT.
    const entquotet = seg.replace(/"[^"]*"/g, '""').replace(/'[^']*'/g, "''");
    if (/\s--(\s|$)/.test(entquotet)) continue;

    process.stderr.write(
      "commit-pathspec-guard: Im Werkbank-Repo NUR mit pathspec committen:\n" +
        '  git commit -m "..." -- <pfad> [<pfad> ...]\n' +
        "Grund: Der Index ist zwischen den Sitzungen GETEILT — ein Commit ohne pathspec\n" +
        "nimmt mit, was andere Sitzungen gestaged haben (CLAUDE.md, Sichern; belegt\n" +
        "e37b798/0120208). Vorher pruefen mit: git diff HEAD -- <pfad>\n" +
        "(NICHT --cached und NICHT ohne HEAD — beides zeigt den Index, nicht den Commit).\n" +
        "Neue Dateien: git add <pfad> und im SELBEN Befehl mit pathspec committen.\n" +
        `-> ${seg.slice(0, 160)}\n`
    );
    process.exit(2);
  }
  if (warnungen.length) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          additionalContext: "commit-pathspec-guard: " + warnungen.join(" | "),
        },
      })
    );
  }
  process.exit(0);
});
