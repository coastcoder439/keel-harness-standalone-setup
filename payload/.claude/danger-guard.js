#!/usr/bin/env node
// PreToolUse-Hook fuer nicht-Git-Bash. Git gehoert exklusiv dem davor laufenden
// git-intent-guard; dieser Guard blockiert nur sonstige Zerstoerung und falsche
// Schreibziele.
//
// Er macht Regeln strukturell, die vorher nur Prosa waren:
//   1) Nie ausserhalb des Arbeitsbereichs schreiben (Werkbank, /tmp, ~/.claude, ~/.codex).
//      Anlass: 31.07.2026 wurden 5,7 MB inkl. der Befehls-Freigabeliste ungefragt
//      auf ~/Desktop kopiert. Die Regel stand im Gedaechtnis -- niemand hat sie gelesen.
//   2) Nie mit Wucht loeschen (rm -rf auf Heimat, Wurzel, Werkbank-Wurzel, Systempfade).
//   3) Keine destruktiven Interpreter-Umwege oder Geraete-/Rechte-Eskalation.
//
// Warum ein Hook und keine Anweisung: deterministischer Code kostet null Tokens und
// laeuft unabhaengig davon, was das Modell gerade fuer eine gute Idee haelt.
// Wer den Befehl wirklich braucht, fuehrt ihn von Hand aus -- das ist der Punkt.
//
// WICHTIG (real passiert, direkt beim ersten Einsatz): ein Waechter, der TEXT ueber
// gefaehrliche Befehle mit den Befehlen selbst verwechselt, blockiert jede Commit-
// Nachricht und jede Doku, die sie erwaehnt -- und wird dann abgeschaltet. Deshalb
// zwei Vorstufen vor der Pruefung: Heredoc-Inhalte werden entfernt, und jede Regel
// gilt nur fuer das Befehls-Segment, dessen KOPF sie betrifft.
//
// BEWUSST IN KAUF GENOMMENE AUSNAHME (01.08.2026): Im Rumpf eines Interpreter-Flags
// (-c/-e) wird NICHT zwischen Code und Zeichenkette unterschieden -- `python3 -c
// 'print("rm -rf")'` wird geblockt, obwohl es nur ausgibt. Grund: Die Unterscheidung
// waere ein halber Parser je Sprache, und die Umgehung ist trivial ("r"+"m -rf").
// Der Rumpf eines -c/-e-Flags IST Code; wer darueber schreiben will, nimmt eine Datei
// oder ein Heredoc (beides wird nicht geprueft). Diese Grenze ist gemessen, nicht geraten.

const path = require("path");
const os = require("os");
const fs = require("node:fs");

// A self-contained transport avoids a shared dependency becoming a fail-open
// startup error. The existing Codex runner identifies its target in the env.
function block(message) {
  const reason = String(message).trim() || "danger-guard: tool denied";
  if (process.env.KEEL_HARNESS_ROOT && process.env.KEEL_HOOK_TARGET === ".claude/danger-guard.js") {
    fs.writeSync(1, JSON.stringify({ hookSpecificOutput: {
      hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason,
    } }) + "\n");
    process.exit(0); // PowerShell otherwise changes a native exit 2 to exit 1.
  }
  fs.writeSync(2, reason + "\n");
  process.exit(2);
}

const HOME = os.homedir();
const IST_WIN = process.platform === "win32";

// [Mac->Win-Fix 21.08.2026] Pfad-Vergleiche separatorneutral (\ und /) und unter
// Windows case-insensitiv -- sonst scheitern sie an ~-expandierten Pfaden
// (C:\Users\x/Desktop, gemischt) und an Gross/Kleinschreibung. Belegt: der
// Schreibschutz war unter Windows fail-open (Selbsttest 10/14).
function normPfad(p) {
  if (!p) return p;
  let n = String(p);
  if (IST_WIN) {
    n = n.split("\\").join("/").toLowerCase();
    // MSYS/Git-Bash schreibt Laufwerke als /c/... Ohne diese Umschrift zaehlt
    // "/c/Users/..." nicht als derselbe Ort wie "C:/Users/..." -- und die
    // Heim-Schranke greift nicht. Belegt 22.08.2026: eine Umleitung nach
    // /c/Users/<du>/Desktop/ lief durch, dieselbe als C:/... und ~/... wurde blockiert.
    n = n.replace(/^\/([a-z])(?=\/|$)/, "$1:");
  }
  return n;
}
/** Liegt p unter der Wurzel w, oder IST es w? Separatorneutral. */
function unter(p, w) {
  const np = normPfad(p);
  const nw = normPfad(w);
  return np === nw || np.startsWith(nw.endsWith("/") ? nw : nw + "/");
}

/** Verzeichnisse, in die geschrieben werden darf. Alles andere unter $HOME ist tabu. */
function erlaubteWurzeln() {
  // ~/.codex ist seit 03.08.2026 der ZWEITE Harness-Ort, gleichwertig zu ~/.claude:
  // Codex liest von dort seine Skills, Prompts und Agenten, so wie Claude Code aus
  // ~/.claude. Belegt: Codex nimmt unsere AGENTS.md per Tree-Walk auf (Testlauf gab
  // "Keel — Shipwright" zurueck, steht nirgends sonst). Wer den einen Ort erlaubt und
  // den anderen sperrt, sperrt die Haelfte des eigenen Harness aus.
  // [Mac->Win-Fix 21.08.2026, U1] os.tmpdir() ist der echte Temp (Windows:
  // C:\Users\...\AppData\Local\Temp); /private/tmp und /var/folders sind rein macOS.
  const wurzeln = [os.tmpdir(), "/tmp", path.join(HOME, ".claude"), path.join(HOME, ".codex")];
  if (process.platform === "darwin") wurzeln.push("/private/tmp", "/var/folders");
  if (process.env.CLAUDE_PROJECT_DIR) wurzeln.push(path.resolve(process.env.CLAUDE_PROJECT_DIR));
  return wurzeln;
}

/** Heredoc-Rumpf ist Daten, nicht Befehl (zum Beispiel geschriebene Dateien). */
function ohneHeredocs(befehl) {
  return befehl.replace(
    /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1[\s\S]*?^\s*\2\s*$/gm,
    "<<HEREDOC-ENTFERNT"
  );
}

/** Zerlegt in Befehls-Segmente. Trenner: ; && || | Zeilenumbruch — aber NUR
 *  ausserhalb von Anfuehrungszeichen. Der blinde Split koepfte Nutzlasten
 *  (python3 -c "a; b" verlor das b samt rmtree) und haette umgekehrt Prosa
 *  wie ein zitierter Beispielbefehl zum ausgefuehrten Befehl erklaert. */
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

/** Der Befehlsname eines Segments -- Umgebungszuweisungen und Vorspann uebersprungen. */
function kopf(segment) {
  const worte = segment.split(/\s+/);
  for (const w of worte) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) continue;
    if (/^(sudo|command|nohup|time|env|xargs|nice|exec)$/.test(w)) continue;
    return path.basename(w.replace(/^["']|["']$/g, ""));
  }
  return "";
}

/**
 * Absolute Pfade im Segment, die NICHT im Arbeitsbereich liegen.
 *
 * Fallstrick, der erst der Test zeigte: Werkbank-Pfade enthalten oft Leerzeichen
 * (ein Ordnername darf welche haben, und der dieses Bau-Rechners hat sie). Ein
 * Token-Muster schneidet sie nach dem ersten Wort ab, der
 * Rest sieht dann aus wie ein fremder Pfad -- und der Waechter blockiert das
 * eigene Arbeitsverzeichnis. Deshalb wird zusaetzlich am ungeschnittenen Text
 * geprueft, ob an der Fundstelle ein erlaubtes Wurzelverzeichnis beginnt.
 */
/**
 * ALLE absoluten Pfade eines Segments in Reihenfolge -- auch die erlaubten.
 * Noetig fuer Kopier-Verben: dort zaehlt die POSITION (letztes Argument = Ziel),
 * und `fremdePfade` filtert die erlaubten heraus, wodurch die Position verlorengeht.
 * (Genau daran ist die erste Fassung des Kopier-Fix gescheitert, 02.08.2026.)
 */
function allePfade(segment) {
  const treffer = [];
  const re = /"((?:~|\/|[A-Za-z]:[\\/])[^"]*)"|'((?:~|\/|[A-Za-z]:[\\/])[^']*)'|(?<![\w"'=])((?:~|\/|[A-Za-z]:[\\/])[^\s;|&><)"']+)/g;
  let m;
  while ((m = re.exec(segment))) {
    const roh = m[1] || m[2] || m[3];
    treffer.push(roh.replace(/^~(?=[\\/]|$)/, HOME));
  }
  return treffer;
}

function fremdePfade(segment) {
  const wurzeln = erlaubteWurzeln();
  const treffer = [];
  const re = /"((?:~|\/|[A-Za-z]:[\\/])[^"]*)"|'((?:~|\/|[A-Za-z]:[\\/])[^']*)'|(?<![\w"'=])((?:~|\/|[A-Za-z]:[\\/])[^\s;|&><)"']+)/g;
  let m;
  while ((m = re.exec(segment))) {
    const abFundstelle = segment.slice(m.index).replace(/^["']/, "");
    const voll = abFundstelle.replace(/^~(?=[\\/]|$)/, HOME);
    if (wurzeln.some((w) => unter(voll, w))) continue;
    const roh = m[1] || m[2] || m[3];
    treffer.push(roh.replace(/^~(?=[\\/]|$)/, HOME));
  }
  return treffer;
}

const SCHREIB_VERB = /^(rm|cp|mv|rsync|touch|mkdir|tee|install|ditto|unzip|tar|chmod|chown|truncate|dd)$/;
const UMLEITUNG = /(?<![0-9<>])>{1,2}(?!&)/;
const REKURSIV = /\s-[a-zA-Z]*[rR]/;

/**
 * Das Ziel einer Ausgabe-Umleitung -- und nur das.
 *
 * Zweiter Fehlalarm aus dem Gebrauch: `ls ~/Library/… >/dev/null` wurde blockiert,
 * weil eine Umleitung im Segment jeden Heimatpfad darin zum Schreibziel erklaerte.
 * Geschrieben wird aber genau nach rechts vom Pfeil; alles davor ist gelesen.
 */
function umleitungsZiel(segment) {
  const m = segment.match(/(?<![0-9<>])>{1,2}(?!&)\s*(?:"([^"]*)"|'([^']*)'|([^\s;|&]+))/);
  if (!m) return null;
  const roh = m[1] || m[2] || m[3] || "";
  return roh.replace(/^~(?=\/|$)/, HOME);
}

// Jede Regel sagt selbst, fuer welche Segmente sie ueberhaupt gilt (`gilt`).
// Ohne das feuert sie auf Prosa, die den Befehl nur erwaehnt.
const REGELN = [
  {
    name: "rm mit Wucht auf Heimat oder Wurzel",
    gilt: (k) => k === "rm",
    treffer: (s) =>
      /\s-[a-zA-Z]*[rRf]/.test(s) &&
      /(\s|=)(\/|~\/?\s*$|~\/\*|\$HOME\/?\s*$|\$HOME\/\*|\/Users\/[^/\s]+\/?\s*$)(\s|$|\*)/.test(s),
    rat: "Ziel ist die Heimat oder das Wurzelverzeichnis. Loesche einzelne, benannte Pfade.",
  },
  {
    name: "rm -rf auf die Werkbank-Wurzel",
    // Direkt am Segmenttext pruefen statt ueber Token -- der Werkbank-Pfad
    // enthaelt evtl. ein Leerzeichen und ueberlebt keine Token-Zerlegung.
    gilt: (k) => k === "rm",
    treffer: (s) => {
      if (!REKURSIV.test(s)) return false;
      const wb = process.env.CLAUDE_PROJECT_DIR && path.resolve(process.env.CLAUDE_PROJECT_DIR);
      if (!wb) return false;
      const esc = wb.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`(^|[\\s"'])${esc}/?(["']|\\s|$)`).test(s);
    },
    rat: "Das ist die Werkbank selbst. Loesche darin, nicht sie.",
  },
  {
    name: "Schreiben oder Loeschen ausserhalb des Arbeitsbereichs",
    gilt: (k, s) => SCHREIB_VERB.test(k) || UMLEITUNG.test(s),
    treffer: (s, k) => {
      const unterHeimat = (p) => unter(p, HOME);
      // KOPIER-VERBEN: Nur das LETZTE Argument ist das Schreibziel -- `cp <fremd> <erlaubt>`
      // LIEST von fremd und SCHREIBT in den Arbeitsbereich, das ist harmlos. Der umgekehrte
      // Fall (`cp <erlaubt> ~/Desktop`) bleibt geblockt, denn dort ist das Ziel fremd.
      // Anlass: 02.08.2026 blockte der Waechter das Hereinkopieren einer uebergebenen
      // Quelldatei aus ~/Downloads ins Repo-Archiv -- ein Fehlalarm, der die Regel selbst
      // entwertet haette ("wer Text ueber Gefahr mit Gefahr verwechselt, wird abgeschaltet").
      if (/^(cp|mv|rsync|install|ditto)$/.test(k)) {
        // Das Ziel steht am ENDE des Segments. Endet es NICHT mit einem absoluten
        // oder ~-Pfad, ist das Ziel relativ -- also im Arbeitsbereich, also erlaubt.
        // (Die erste Fassung zaehlte absolute Pfade und liess dadurch
        //  `cp .claude/settings.local.json ~/Desktop/` durch -- genau den Vorfall,
        //  wegen dem diese Regel existiert. Beim Test aufgefallen, nicht im Betrieb.)
        const m = s.match(/(?:"((?:~|\/|[A-Za-z]:[\\/])[^"]*)"|'((?:~|\/|[A-Za-z]:[\\/])[^']*)'|((?:~|\/|[A-Za-z]:[\\/])[^\s;|&><)"']+))\s*$/);
        if (!m) return false;
        const ziel = (m[1] || m[2] || m[3]).replace(/^~(?=[\\/]|$)/, HOME);
        const erlaubt = erlaubteWurzeln().some((w) => unter(ziel, w));
        return !erlaubt && unterHeimat(ziel);
      }
      // Uebrige Schreib-Verben (rm, touch, mkdir, tee, chmod …): jedes Argument zaehlt.
      if (SCHREIB_VERB.test(k)) return fremdePfade(s).some(unterHeimat);
      const ziel = umleitungsZiel(s);
      if (!ziel || !path.isAbsolute(ziel)) return false;
      return unterHeimat(ziel) && !erlaubteWurzeln().some((w) => unter(ziel, w));
    },
    rat: `Geschrieben wird nur in die Projektwurzel, /tmp, ~/.claude und ~/.codex -- nicht sonstwo unter ${HOME}.`,
  },
  {
    name: "rm -r auf einen Systempfad",
    gilt: (k) => k === "rm",
    treffer: (s) => REKURSIV.test(s) && fremdePfade(s).some((p) => !p.startsWith(HOME)),
    rat: "Rekursives Loeschen ausserhalb von Arbeitsbereich und /tmp laeuft nicht ueber den Agenten.",
  },
  {
    name: "Geraete-Schreibzugriff / Dateisystem formatieren",
    gilt: (k, s) => k === "dd" || /^mkfs/.test(k) || UMLEITUNG.test(s),
    treffer: (s) => /\bof=\/dev\//.test(s) || /^mkfs/.test(kopf(s)) || />\s*\/dev\/(disk|sd|nvme)/.test(s),
    rat: "Schreibt an Geraeten vorbei am Dateisystem. Von Hand ausfuehren, wenn wirklich gewollt.",
  },
  {
    name: "Rechte flaechendeckend aufreissen",
    gilt: (k) => k === "chmod",
    treffer: (s) => /-[a-zA-Z]*R/.test(s) && /\s777\b/.test(s),
    rat: "chmod -R 777 macht alles fuer jeden schreibbar. Gezielte Rechte setzen.",
  },
  {
    name: "Loeschen mit Systemrechten",
    gilt: (k, s) => k === "rm" && /(^|\s)sudo\s/.test(s),
    treffer: () => true,
    rat: "Loeschen mit Systemrechten laeuft nie ueber den Agenten.",
  },
  {
    name: "Destruktives im Interpreter-Umweg (-c/-e)",
    // dcg-Fund: der Waechter prueft nur den Befehls-KOPF -- python3 -c "shutil.rmtree(...)"
    // lief bisher an allen rm-Regeln vorbei.
    // Nachgeschaerft 01.08.2026 (Nachpruefung): die erste Fassung war eine zu enge
    // Musterliste. Sechs Umgehungen wurden nachgestellt und gingen mit Exit 0 durch --
    // require("fs").rmSync (kein woertliches "fs."), os.remove, subprocess.run(["rm","-rf"]),
    // perl unlink, FileUtils.rm_rf, Path(...).unlink. Jetzt nach Loesch-VERB statt nach
    // Modulnamen; Fehlalarm-Grenze bleibt eng, weil die Regel nur fuer Segmente mit
    // Interpreter-Kopf UND -c/-e-Flag gilt.
    gilt: (k) => /^(python3?|node|perl|ruby|bash|sh|zsh|deno|bun)$/.test(k),
    treffer: (s) => {
      if (!/\s-[ce]\s/.test(s)) return false;
      // Escapes entfernen: im Rumpf stehen Anfuehrungszeichen oft als \" -- ohne diese
      // Normalisierung gingen subprocess.run([\"rm\",\"-rf\"]) und perl unlink \"...\"
      // durch (beide nachgestellt, beide Exit 0).
      const n = s.replace(/\\/g, "");
      return (
        /\brm\s+-[a-zA-Z]*[rf]/.test(n) || // rm als Shell-Aufruf im Rumpf
        /["'`]rm["'`]\s*,\s*["'`]-[a-zA-Z]*[rf]/.test(n) || // rm als Argumentliste (subprocess/execFile)
        /shutil\.rmtree|\bos\.(remove|unlink|rmdir|removedirs)\s*\(|\.unlink\s*\(/.test(n) || // Python
        /\.(rmSync|rmdirSync|unlinkSync|rm)\s*\(|\brimraf\b/.test(n) || // Node, auch require("fs").rmSync
        /FileUtils\.rm_(rf|r)\b|File\.(delete|unlink)\b/.test(n) || // Ruby
        /\bunlink\s+["'$@]|\brmtree\b/.test(n) || // Perl
        /\bshred\b/.test(n)
      );
    },
    rat: "Loesch-Code im Interpreter-Flag umgeht die rm-Regeln. Direkt als Befehl schreiben (dann greifen die Regeln) oder von Hand ausfuehren.",
  },
];

// ---------------------------------------------------------------------------
// SELBSTPRUEFUNG  ->  node .claude/hooks/danger-guard.js --selbsttest
//
// Anlass (02.08.2026, Abnahmelauf der Nachbau-Anleitung): Die Anleitung liess den
// Menschen zum Pruefen Zeilen wie   pruefe 'echo "x" > ~/Desktop/f'   tippen.
// Der Waechter blockte sie -- korrekt: er kann nicht wissen, ob eine zitierte
// Zeichenkette spaeter ausgewertet wird, und Konservativsein ist hier die richtige
// Antwort. Falsch war die Anleitung, nicht der Waechter.
//
// Deshalb prueft er sich ab jetzt SELBST, im Prozess, ohne dass irgendjemand einen
// gefaehrlich aussehenden Befehl in eine Shell tippt. Die Faelle stehen in beiden
// Richtungen da: was blockiert werden MUSS und was durchgehen muss. Ein Waechter
// mit nur positiven Faellen laesst sich zu Tode verschaerfen, ohne dass es auffaellt.
const SELBSTTEST = [
  // --- muss blockieren ---
  { blockt: true, befehl: "cp -R . ~/Desktop/backup", warum: "Schreiben ausserhalb des Arbeitsbereichs" },
  { blockt: true, befehl: 'echo "x" > ~/Documents/f.txt', warum: "Umleitung nach ~/Documents" },
  { blockt: true, befehl: "rm -rf ~", warum: "Loeschen der Heimat" },
  { blockt: true, befehl: "rm -rf /", warum: "Loeschen der Wurzel" },
  { blockt: true, befehl: "ls | tee ~/Downloads/liste.txt", warum: "Umleitung im zweiten Segment" },
  // --- muss durchgehen ---
  { blockt: false, befehl: "echo hallo > /tmp/f.txt", warum: "/tmp ist erlaubt" },
  { blockt: false, befehl: "rm -rf node_modules", warum: "relativer Pfad im Arbeitsbereich" },
];

function pruefeBefehl(roh) {
  const verletzt = [];
  for (const seg of segmente(ohneHeredocs(roh))) {
    const k = kopf(seg);
    if (k === "git") continue; // exclusively owned by git-intent-guard
    for (const r of REGELN) {
      if (verletzt.includes(r.name)) continue;
      try {
        if (r.gilt(k, seg) && r.treffer(seg, k)) verletzt.push(r.name);
      } catch {}
    }
  }
  return verletzt;
}

if (process.argv.includes("--selbsttest")) {
  let schlecht = 0;
  let geprueft = 0;
  for (const f of SELBSTTEST) {
    const teile = segmente(ohneHeredocs(f.befehl));
    geprueft++;
    const treffer = pruefeBefehl(f.befehl);
    const ok = f.blockt ? treffer.length > 0 : treffer.length === 0;
    if (!ok) schlecht++;
    console.log(
      `${ok ? "  ok  " : "  FEHL"} ${f.blockt ? "blockt " : "laesst "} ${f.befehl.padEnd(52)} ${
        ok ? f.warum : `ERWARTET ${f.blockt ? "blockiert" : "durchgelassen"}, BEKAM ${treffer.join(",") || "nichts"}`
      }`
    );
  }
  console.log(`\n${geprueft - schlecht} von ${geprueft} nicht-Git-Faellen richtig; Git exklusiv delegiert.`);
  process.exit(schlecht ? 1 : 0);
}

let eingabe = "";
process.stdin.on("data", (c) => (eingabe += c));
process.stdin.on("end", () => {
  let daten = {};
  try {
    daten = JSON.parse(eingabe || "{}");
  } catch {
    return block("danger-guard: invalid hook input; command blocked");
  }
  const roh = daten?.tool_input?.command || "";
  if (!roh) return process.exit(0);

  const verletzt = new Map();
  for (const seg of segmente(ohneHeredocs(roh))) {
    const k = kopf(seg);
    if (k === "git") continue; // avoid competing Git block messages
    for (const r of REGELN) {
      if (verletzt.has(r.name)) continue;
      try {
        if (r.gilt(k, seg) && r.treffer(seg, k)) verletzt.set(r.name, { r, seg });
      } catch {
        /* eine kaputte Regel darf nie den ganzen Waechter kippen */
      }
    }
  }
  if (!verletzt.size) return process.exit(0);

  block(
    "danger-guard hat den Befehl NICHT ausgefuehrt.\n\n" +
      [...verletzt.values()].map(({ r, seg }) => `  - ${r.name}\n    ${r.rat}\n    -> ${seg.slice(0, 160)}`).join("\n") +
      "\n\n  Der Waechter ist deterministisch und nicht ueberredbar. Wenn das wirklich gewollt\n" +
      "  ist, fuehrt der Mensch den Befehl selbst im Terminal aus.\n"
  );
});
