#!/usr/bin/env node
// PreToolUse-Hook fuer Bash. Schwester von git-guard.js -- aber dieser hier
// BLOCKIERT (exit 2), waehrend git-guard nur ansagt.
//
// Er macht Regeln strukturell, die vorher nur Prosa waren:
//   1) Nie ausserhalb des Arbeitsbereichs schreiben (Werkbank, /tmp, ~/.claude, ~/.codex).
//      Anlass: 31.07.2026 wurden 5,7 MB inkl. der Befehls-Freigabeliste ungefragt
//      auf ~/Desktop kopiert. Die Regel stand im Gedaechtnis -- niemand hat sie gelesen.
//   2) Nie mit Wucht loeschen (rm -rf auf Heimat, Wurzel, Werkbank-Wurzel, Systempfade).
//   3) Kein `git clean -fdx` -- .claude/ ist gitignored, der Befehl loescht den
//      kompletten Harness. Verlust waere nicht ueber git wiederherstellbar.
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

const HOME = os.homedir();

/** Verzeichnisse, in die geschrieben werden darf. Alles andere unter $HOME ist tabu. */
function erlaubteWurzeln() {
  // ~/.codex ist seit 03.08.2026 der ZWEITE Harness-Ort, gleichwertig zu ~/.claude:
  // Codex liest von dort seine Skills, Prompts und Agenten, so wie Claude Code aus
  // ~/.claude. Belegt: Codex nimmt unsere AGENTS.md per Tree-Walk auf (Testlauf gab
  // "Keel — Shipwright" zurueck, steht nirgends sonst). Wer den einen Ort erlaubt und
  // den anderen sperrt, sperrt die Haelfte des eigenen Harness aus.
  const wurzeln = ["/tmp", "/private/tmp", "/var/folders", path.join(HOME, ".claude"), path.join(HOME, ".codex")];
  if (process.env.CLAUDE_PROJECT_DIR) wurzeln.push(path.resolve(process.env.CLAUDE_PROJECT_DIR));
  return wurzeln;
}

/** Heredoc-Rumpf ist Daten, nicht Befehl (Commit-Nachrichten, geschriebene Dateien). */
function ohneHeredocs(befehl) {
  return befehl.replace(
    /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1[\s\S]*?^\s*\2\s*$/gm,
    "<<HEREDOC-ENTFERNT"
  );
}

/** Zerlegt in Befehls-Segmente. Trenner: ; && || | Zeilenumbruch — aber NUR
 *  ausserhalb von Anfuehrungszeichen. Der blinde Split koepfte Nutzlasten
 *  (python3 -c "a; b" verlor das b samt rmtree) und haette umgekehrt Prosa
 *  wie -m "x; git push --force" zum Befehl erklaert. */
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

/** Der git-Unterbefehl eines Segments (`git -C <pfad> clean` -> "clean"). */
function gitUnterbefehl(segment) {
  const m = segment.match(
    /\bgit\b((?:\s+(?:-C\s+(?:"[^"]*"|'[^']*'|\S+)|-c\s+\S+|--no-optional-locks|--no-pager))*)\s+([a-z][a-z-]*)/
  );
  return m ? m[2] : null;
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
  const re = /"((?:~|\/)[^"]*)"|'((?:~|\/)[^']*)'|(?<![\w"'=])((?:~|\/)[^\s;|&><)"']+)/g;
  let m;
  while ((m = re.exec(segment))) {
    const roh = m[1] || m[2] || m[3];
    treffer.push(roh.replace(/^~(?=\/|$)/, HOME));
  }
  return treffer;
}

function fremdePfade(segment) {
  const wurzeln = erlaubteWurzeln();
  const treffer = [];
  const re = /"((?:~|\/)[^"]*)"|'((?:~|\/)[^']*)'|(?<![\w"'=])((?:~|\/)[^\s;|&><)"']+)/g;
  let m;
  while ((m = re.exec(segment))) {
    const abFundstelle = segment.slice(m.index).replace(/^["']/, "");
    const voll = abFundstelle.startsWith("~") ? HOME + abFundstelle.slice(1) : abFundstelle;
    if (wurzeln.some((w) => voll === w || voll.startsWith(w + path.sep))) continue;
    const roh = m[1] || m[2] || m[3];
    treffer.push(roh.replace(/^~(?=\/|$)/, HOME));
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
// Eine Commit-Nachricht ist PROSA, kein Pfad.
//
// Belegt am 02.08.2026, und zwar am eigenen Leib: Dieser Waechter blockierte den
// Commit, der SEINE EIGENE Selbstpruefung eingefuehrt hat -- weil in der Nachricht
// die Zeichenfolge "> ~/Desktop/f" vorkam, als Zitat des Fehlers, den sie beschreibt.
// Genau davor warnt der Kopf dieser Datei: "ein Waechter, der TEXT ueber gefaehrliche
// Befehle mit den Befehlen selbst verwechselt, blockiert jede Commit-Nachricht -- und
// wird dann abgeschaltet."
//
// ENG gefasst, damit nichts aufweicht: NUR das zitierte Argument von git -m/--message
// wird ersetzt. Eine Umleitung HINTER der Nachricht bleibt sichtbar und wird weiter
// geblockt (Selbsttest prueft genau das).
function ohneNachrichtentext(segment) {
  if (kopf(segment) !== "git") return segment;
  return segment.replace(
    /(^|\s)(-m|--message)(\s+|=)("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g,
    (_, vor, flag, trenn) => `${vor}${flag}${trenn}"NACHRICHT"`
  );
}

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
      const unterHeimat = (p) => p.startsWith(HOME + path.sep) || p === HOME;
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
        const m = s.match(/(?:"((?:~|\/)[^"]*)"|'((?:~|\/)[^']*)'|((?:~|\/)[^\s;|&><)"']+))\s*$/);
        if (!m) return false;
        const ziel = (m[1] || m[2] || m[3]).replace(/^~(?=\/|$)/, HOME);
        const erlaubt = erlaubteWurzeln().some((w) => ziel === w || ziel.startsWith(w + path.sep));
        return !erlaubt && unterHeimat(ziel);
      }
      // Uebrige Schreib-Verben (rm, touch, mkdir, tee, chmod …): jedes Argument zaehlt.
      if (SCHREIB_VERB.test(k)) return fremdePfade(s).some(unterHeimat);
      const ziel = umleitungsZiel(s);
      if (!ziel || !ziel.startsWith("/")) return false;
      return unterHeimat(ziel) && !erlaubteWurzeln().some((w) => ziel === w || ziel.startsWith(w + path.sep));
    },
    rat: `Geschrieben wird nur in Werkbank, user-projects, /tmp, ~/.claude und ~/.codex -- nicht sonstwo unter ${HOME}.`,
  },
  {
    name: "rm -r auf einen Systempfad",
    gilt: (k) => k === "rm",
    treffer: (s) => REKURSIV.test(s) && fremdePfade(s).some((p) => !p.startsWith(HOME)),
    rat: "Rekursives Loeschen ausserhalb von Arbeitsbereich und /tmp laeuft nicht ueber den Agenten.",
  },
  {
    name: "git clean -fdx loescht den ungetrackten Harness",
    // Trockenlauf (-n / --dry-run) durchlassen: so sieht ein Mensch nach, bevor er handelt.
    gilt: (k, s) => k === "git" && gitUnterbefehl(s) === "clean",
    treffer: (s) => /\s-[a-zA-Z]*x/.test(s) && !/(--dry-run|\s-[a-zA-Z]*n)\b/.test(s),
    rat: ".claude/ ist gitignored -- -x loescht den ganzen Harness, und git kann ihn nicht zurueckholen. Ohne -x arbeiten oder einzelne Pfade nennen.",
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
  // --- Nachruestung 01.08.2026 [Beschluss D5, Auftraggeber]: destruktive git-Verben blocken.
  // Prinzip aus "destructive command guard" (dcg) -- dessen Code ist per Lizenz-Rider
  // fuer uns unbenutzbar, die Luecken-Liste stammt aus der Bestands-Eruierung:
  // diese Verben waren bisher NUR Prosa-Regel, git-guard sagt nur an, blockt nicht.
  {
    name: "git push --force ueberschreibt veroeffentlichte Historie",
    gilt: (k, s) => k === "git" && gitUnterbefehl(s) === "push",
    treffer: (s) => /\s(--force\b|-f\b)/.test(s) && !/--force-with-lease/.test(s),
    rat: "Veroeffentlichte Historie wird nie umgeschrieben (CLAUDE.md, Branches). Wenn wirklich noetig: --force-with-lease, von Hand.",
  },
  {
    name: "git reset --hard verwirft Arbeitsstand",
    gilt: (k, s) => k === "git" && gitUnterbefehl(s) === "reset",
    treffer: (s) => /--hard\b/.test(s),
    rat: "Verwirft uncommittete Arbeit unwiederbringlich -- Loeschung braucht ein Go. Gezielt entstagen (git restore --staged) oder von Hand.",
  },
  {
    name: "git branch -D loescht ungemergte Zweige",
    gilt: (k, s) => k === "git" && gitUnterbefehl(s) === "branch",
    treffer: (s) => /\s-D\b/.test(s),
    rat: "Grosses -D erzwingt. Kleines -d weigert sich bei Ungemergtem -- der sichere Weg; sonst von Hand.",
  },
  {
    name: "Arbeitsbaum verwerfen (checkout -- / restore)",
    gilt: (k, s) => k === "git" && ["checkout", "restore"].includes(gitUnterbefehl(s)),
    treffer: (s) => {
      if (gitUnterbefehl(s) === "restore")
        return !(/--staged\b/.test(s) && !/--worktree\b/.test(s)); // nur reines Entstagen ist harmlos
      return /\bcheckout\s+(?:-\S+\s+)*--\s+\S/.test(s);
    },
    rat: "Verwirft lokale Aenderungen der genannten Pfade (Loeschung braucht Go). Erlaubt bleibt git restore --staged (entstaged nur).",
  },
  {
    name: "git stash drop/clear loescht Zwischenstaende",
    gilt: (k, s) => k === "git" && gitUnterbefehl(s) === "stash",
    treffer: (s) => /\bstash\s+(drop|clear)\b/.test(s),
    rat: "Stash-Inhalte sind ungesicherte Arbeit. Erst ansehen (git stash show -p), Loeschen von Hand.",
  },
  {
    name: "git clean -f loescht Ungetracktes",
    gilt: (k, s) => k === "git" && gitUnterbefehl(s) === "clean",
    treffer: (s) => /\s-[a-zA-Z]*f/.test(s) && !/(--dry-run|\s-[a-zA-Z]*n)\b/.test(s),
    rat: "Loescht ungetrackte Dateien unwiederbringlich. Erst -n (Trockenlauf); das Loeschen selbst von Hand.",
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
  { blockt: true, befehl: "git clean -fdx", warum: ".claude/ ist gitignored -- nicht wiederherstellbar" },
  { blockt: true, befehl: "ls | tee ~/Downloads/liste.txt", warum: "Umleitung im zweiten Segment" },
  // --- muss durchgehen ---
  { blockt: false, befehl: "git status --short", warum: "harmlos" },
  { blockt: false, befehl: "echo hallo > /tmp/f.txt", warum: "/tmp ist erlaubt" },
  { blockt: false, befehl: "rm -rf node_modules", warum: "relativer Pfad im Arbeitsbereich" },
  { blockt: false, befehl: 'git commit -m "entfernt rm -rf aus der Doku" -- docs/x.md', warum: "TEXT ueber einen Befehl, kein Befehl" },
  { blockt: false, befehl: "git clean -n", warum: "Trockenlauf loescht nichts" },
  // Der Fall, an dem sich der Waechter am 02.08.2026 selbst blockiert hat:
  { blockt: false, befehl: `git commit -m "behebt: echo x > ~/Desktop/f wurde geblockt" -- a.js`, warum: "Nachricht ist Prosa, kein Pfad" },
  { blockt: false, befehl: `git commit -m 'nie wieder cp -R . ~/Desktop' -- a.js`, warum: "auch mit einfachen Anfuehrungszeichen" },
  // ... und die Gegenprobe dazu: eine ECHTE Umleitung hinter der Nachricht bleibt geblockt.
  { blockt: true, befehl: `git commit -m "harmlos" > ~/Desktop/log.txt`, warum: "Umleitung HINTER der Nachricht ist echt" },
];

function pruefeBefehl(roh) {
  const verletzt = [];
  for (const seg of segmente(ohneHeredocs(roh)).map(ohneNachrichtentext)) {
    const k = kopf(seg);
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
  for (const f of SELBSTTEST) {
    const treffer = pruefeBefehl(f.befehl);
    const ok = f.blockt ? treffer.length > 0 : treffer.length === 0;
    if (!ok) schlecht++;
    console.log(
      `${ok ? "  ok  " : "  FEHL"} ${f.blockt ? "blockt " : "laesst "} ${f.befehl.padEnd(52)} ${
        ok ? f.warum : `ERWARTET ${f.blockt ? "blockiert" : "durchgelassen"}, BEKAM ${treffer.join(",") || "nichts"}`
      }`
    );
  }
  console.log(`\n${SELBSTTEST.length - schlecht} von ${SELBSTTEST.length} Faellen richtig.`);
  process.exit(schlecht ? 1 : 0);
}

let eingabe = "";
process.stdin.on("data", (c) => (eingabe += c));
process.stdin.on("end", () => {
  let daten = {};
  try {
    daten = JSON.parse(eingabe || "{}");
  } catch {}
  const roh = daten?.tool_input?.command || "";
  if (!roh) return process.exit(0);

  const verletzt = new Map();
  for (const seg of segmente(ohneHeredocs(roh)).map(ohneNachrichtentext)) {
    const k = kopf(seg);
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

  process.stderr.write(
    "danger-guard hat den Befehl NICHT ausgefuehrt.\n\n" +
      [...verletzt.values()].map(({ r, seg }) => `  - ${r.name}\n    ${r.rat}\n    -> ${seg.slice(0, 160)}`).join("\n") +
      "\n\n  Der Waechter ist deterministisch und nicht ueberredbar. Wenn das wirklich gewollt\n" +
      "  ist, fuehrt der Mensch den Befehl selbst im Terminal aus.\n"
  );
  process.exit(2); // 2 = blockieren, stderr geht ans Modell zurueck
});
