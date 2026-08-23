#!/usr/bin/env node
// DER VORSCHAU-SERVER -- macht aus dem Dashboard ein Werkzeug zum Ändern.
//
// WARUM ES IHN GIBT
// Die erzeugte Seite ist eine einzelne HTML-Datei. Sie kann lesen, aber nichts
// zurückschreiben -- und genau das fehlte: wer im Dashboard eine schlechte
// Beschreibung sieht, musste die Datei woanders suchen und dort ändern. Jetzt
// öffnet ein Klick die Datei im Dashboard selbst.
//
// ZWEI BETRIEBSARTEN, bewusst getrennt:
//   Doppelklick auf dashboard.html  ->  nur lesen. Keine Änderung möglich.
//   node dashboard/serve.js         ->  lesen UND ändern.
// Die Seite erkennt das selbst am Protokoll (file: gegen http:). Wer die Seite
// weitergibt, gibt keinen Schreibzugang mit.
//
// WAS DIESER SERVER NICHT IST
// Kein Webserver für andere. Er hört ausschließlich auf 127.0.0.1, hat keine
// Anmeldung und ist nicht dafür gebaut, nach außen zu zeigen. Der Grund für
// die Bindung steht unten in KEIN NETZ NACH AUSSEN.
//
// AUFRUF
//   node dashboard/serve.js                 Port 8765, Wurzel automatisch
//   node dashboard/serve.js --port 9000
//   node dashboard/serve.js --wurzel <pfad>
//   node dashboard/serve.js --nur-lesen     Schreiben abgeschaltet

const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const { spawnSync } = require("child_process");

const { MINI_SPERRLISTE, ZUGANGS_MUSTER } = require("./zugangsfilter.js");

// ---------------------------------------------------------------------------
// KONSTANTEN
// ---------------------------------------------------------------------------

const PORT_VORGABE = 8765;
const MAX_SCHREIB_BYTES = 2 * 1024 * 1024;

// Nur was ein Mensch sinnvoll im Browser bearbeitet. Eine Binärdatei oder ein
// erzeugter Stand gehört nicht dazu.
const SCHREIBBAR = /\.(md|txt|json|js|mjs|cjs|css|html|yml|yaml)$|(^|\/)\.gitignore$/i;

// Diese entstehen bei jedem Lauf neu -- sie zu bearbeiten wäre folgenlos und
// verwirrend.
const ERZEUGT = new Set(["dashboard.html", "dashboard.json"]);

const TYP = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

// ---------------------------------------------------------------------------
// ARGUMENTE
// ---------------------------------------------------------------------------

function argumenteLesen(argv) {
  const a = argv.slice(2);
  const o = { port: PORT_VORGABE, wurzel: null, nurLesen: false, hilfe: false };
  for (let i = 0; i < a.length; i++) {
    switch (a[i]) {
      case "--help":
      case "-h":
        o.hilfe = true;
        break;
      case "--port":
        o.port = Number(a[++i]);
        if (!Number.isInteger(o.port) || o.port < 1 || o.port > 65535) {
          throw new Error("--port braucht eine Zahl zwischen 1 und 65535");
        }
        break;
      case "--wurzel":
        o.wurzel = path.resolve(a[++i] || "");
        break;
      case "--nur-lesen":
        o.nurLesen = true;
        break;
      default:
        throw new Error("Unbekanntes Argument: " + a[i]);
    }
  }
  return o;
}

// Aufwärts suchen, bis ein Ordner wie ein Workspace aussieht.
//
// ZWEI SCHRANKEN, beide notwendig:
//   1. `.claude/` ALLEIN genügt nicht. Im Benutzerordner liegt die globale
//      Claude-Konfiguration unter ~/.claude -- wer den Server irgendwo darunter
//      startet, bekäme sonst sein ganzes Heimatverzeichnis als Workspace, und
//      der Editor dürfte darin schreiben. Gemessen am 23.08.2026, als ein Test
//      in einem Temp-Ordner unter dem Benutzerordner genau das auslöste.
//   2. Der Benutzerordner selbst ist nie ein Workspace, auch wenn beides dort
//      liegt. Der Aufstieg endet davor.
function istWorkspace(d) {
  if (!fs.existsSync(path.join(d, ".claude"))) return false;
  return fs.existsSync(path.join(d, "CLAUDE.md")) || fs.existsSync(path.join(d, ".claude", "settings.json"));
}

// Windows kennt zwei Namen für denselben Ordner: C:\Users\Lonsinator und die
// 8.3-Kurzform C:\Users\LONSIN~1. Als Zeichenketten sind sie ungleich, als
// Ordner derselbe -- ein Vergleich über path.resolve allein lässt die Schranke
// unten ins Leere laufen (gemessen 23.08.2026: der Aufstieg endete trotzdem im
// Benutzerordner). Deshalb über den echten Pfad vergleichen.
function echterPfad(p) {
  try {
    return fs.realpathSync.native(p);
  } catch (e) {
    return path.resolve(p);
  }
}

function wurzelFinden(start) {
  const heim = echterPfad(os.homedir());
  let d = path.resolve(start);
  for (let i = 0; i < 12; i++) {
    if (echterPfad(d) === heim) break;
    if (istWorkspace(d)) return d;
    const oben = path.dirname(d);
    if (oben === d) break;
    d = oben;
  }
  return start;
}

// ---------------------------------------------------------------------------
// PFAD-PRÜFUNG -- die einzige Stelle, die entscheidet, ob etwas angefasst wird
//
// Sie ist bewusst eine Funktion und nicht über den Code verteilt: ein zweiter
// Prüfort wäre ein zweiter Stand, und einer davon veraltet.
// ---------------------------------------------------------------------------

function pfadPruefen(wurzel, roh, zweck) {
  if (!roh) return { fehler: "kein Pfad angegeben" };

  // Ein Null-Byte wird ABGELEHNT, nicht entfernt. Wer es entfernt, schreibt am
  // Ende auf einen anderen Pfad als den angefragten -- und genau darauf zielt
  // der Trick (gemessen 23.08.2026: "docs/x\0.md" wurde zu "docs/x.md" und
  // kam durch).
  const text = String(roh);
  if (text.includes("\0")) return { fehler: "Pfad enthält ein Null-Byte" };

  // Backslashes und Laufwerksbuchstaben: Wege, die auf Windows aus dem Ordner
  // herausführen. Erst vereinheitlichen, dann prüfen.
  const rel = text.split("\\").join("/");
  if (rel.includes("..")) return { fehler: "Pfad enthält .." };
  if (/^[A-Za-z]:/.test(rel) || rel.startsWith("/")) return { fehler: "absoluter Pfad" };

  const abs = path.resolve(wurzel, rel);
  // Der entscheidende Vergleich: liegt das Ziel WIRKLICH unter der Wurzel?
  // path.resolve allein genügt nicht -- erst der Vergleich mit dem Trennzeichen
  // am Ende schließt "wurzel-anders" aus.
  const wurzelMitTrenner = path.resolve(wurzel) + path.sep;
  if (!abs.startsWith(wurzelMitTrenner)) return { fehler: "außerhalb des Workspace" };

  if (zweck === "schreiben") {
    if (ERZEUGT.has(rel)) return { fehler: "wird bei jedem Lauf neu erzeugt" };
    if (!SCHREIBBAR.test(rel)) return { fehler: "keine Textdatei, die hier bearbeitet wird" };
    if (MINI_SPERRLISTE.some((m) => m.test(rel))) return { fehler: "Zugangsdatei -- wird nie angefasst" };
    if (rel.startsWith(".git/")) return { fehler: "Git-Innenleben" };
  }

  return { abs, rel };
}

// ---------------------------------------------------------------------------
// ANTWORTEN
// ---------------------------------------------------------------------------

const jsonAntwort = (res, code, obj) => {
  const leib = JSON.stringify(obj);
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(leib),
    "cache-control": "no-store",
  });
  res.end(leib);
};

// ---------------------------------------------------------------------------
// DIE SEITE NEU BAUEN
// ---------------------------------------------------------------------------

function seiteBauen(wurzel) {
  const lauf = spawnSync(
    process.execPath,
    [path.join(__dirname, "index.js"), "--wurzel", wurzel, "--html", path.join(wurzel, "dashboard.html")],
    { cwd: wurzel, encoding: "utf8", timeout: 180000 }
  );
  return {
    ok: lauf.status === 0,
    ausgabe: ((lauf.stdout || "") + (lauf.stderr || "")).split("\n").filter(Boolean).slice(-4).join(" | "),
  };
}

// ---------------------------------------------------------------------------
// DER SERVER
// ---------------------------------------------------------------------------

function starten(o) {
  const wurzel = o.wurzel || wurzelFinden(process.cwd());
  if (!fs.existsSync(path.join(wurzel, ".claude"))) {
    process.stderr.write("FEHLER: unter " + wurzel + " liegt kein .claude/ -- ist das ein Harness-Workspace?\n");
    process.exit(2);
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const weg = decodeURIComponent(url.pathname);

    // --- Datei schreiben ---------------------------------------------------
    if (req.method === "PUT" && weg === "/datei") {
      if (o.nurLesen) return jsonAntwort(res, 403, { fehler: "Der Server läuft mit --nur-lesen." });

      const geprueft = pfadPruefen(wurzel, url.searchParams.get("pfad"), "schreiben");
      if (geprueft.fehler) return jsonAntwort(res, 400, { fehler: geprueft.fehler });

      let leib = "";
      let zuGross = false;
      req.setEncoding("utf8");
      req.on("data", (stueck) => {
        if (zuGross) return;
        leib += stueck;
        if (Buffer.byteLength(leib) > MAX_SCHREIB_BYTES) {
          zuGross = true;
          jsonAntwort(res, 413, { fehler: "größer als 2 MB" });
          req.destroy();
        }
      });
      req.on("end", () => {
        if (zuGross) return;
        try {
          // Zeilenenden erhalten: lag die Datei als CRLF auf der Platte, bleibt
          // sie CRLF. Sonst zeigt git die ganze Datei als geändert an.
          const vorher = fs.existsSync(geprueft.abs) ? fs.readFileSync(geprueft.abs, "utf8") : "";
          const warCrlf = /\r\n/.test(vorher);
          const neu = warCrlf ? leib.split("\r\n").join("\n").split("\n").join("\r\n") : leib.split("\r\n").join("\n");
          fs.writeFileSync(geprueft.abs, neu, "utf8");
          process.stdout.write("geschrieben: " + geprueft.rel + " (" + Buffer.byteLength(neu) + " B)\n");
          jsonAntwort(res, 200, { ok: true, pfad: geprueft.rel, bytes: Buffer.byteLength(neu) });
        } catch (e) {
          jsonAntwort(res, 500, { fehler: "konnte nicht schreiben: " + e.message });
        }
      });
      return;
    }

    // --- Neu messen --------------------------------------------------------
    if (req.method === "POST" && weg === "/neu-messen") {
      const r = seiteBauen(wurzel);
      return jsonAntwort(res, r.ok ? 200 : 500, r.ok ? { ok: true } : { fehler: r.ausgabe });
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      return jsonAntwort(res, 405, { fehler: "Methode nicht vorgesehen" });
    }

    // --- Rohtext einer Datei ----------------------------------------------
    if (weg === "/datei") {
      const geprueft = pfadPruefen(wurzel, url.searchParams.get("pfad"), "lesen");
      if (geprueft.fehler) return jsonAntwort(res, 400, { fehler: geprueft.fehler });
      try {
        const text = fs.readFileSync(geprueft.abs, "utf8");
        // Auch beim LESEN durch den Filter: der Server soll keinen Weg
        // eröffnen, der an den drei Riegeln der Seite vorbeiführt.
        const zeilen = text.split(/\r?\n/);
        const verdaechtig = zeilen.some((z) => ZUGANGS_MUSTER.some((mm) => mm.test(z)));
        if (verdaechtig) return jsonAntwort(res, 403, { fehler: "Die Datei enthält etwas, das wie ein Zugang aussieht." });
        return jsonAntwort(res, 200, { pfad: geprueft.rel, text, bytes: Buffer.byteLength(text) });
      } catch (e) {
        return jsonAntwort(res, 404, { fehler: "nicht lesbar: " + e.message });
      }
    }

    // --- Die Seite und alles daneben --------------------------------------
    const ziel = weg === "/" ? "dashboard.html" : weg.replace(/^\//, "");
    const geprueft = pfadPruefen(wurzel, ziel, "lesen");
    if (geprueft.fehler) {
      res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
      return res.end(geprueft.fehler);
    }
    fs.readFile(geprueft.abs, (fehler, inhalt) => {
      if (fehler) {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        return res.end(
          geprueft.rel === "dashboard.html"
            ? "dashboard.html gibt es noch nicht.\nErzeugen mit:  node dashboard/index.js --html dashboard.html"
            : "nicht gefunden: " + geprueft.rel
        );
      }
      res.writeHead(200, {
        "content-type": TYP[path.extname(geprueft.abs).toLowerCase()] || "application/octet-stream",
        "cache-control": "no-store",
        // Die Seite bindet nichts von außen ein. Der Riegel hier stellt sicher,
        // dass das so bleibt, auch wenn jemand später etwas hinzufügt.
        "content-security-policy": "default-src 'self'; script-src 'unsafe-inline' 'self'; style-src 'unsafe-inline' 'self'; img-src 'self' data:; connect-src 'self'",
        "x-content-type-options": "nosniff",
      });
      res.end(req.method === "HEAD" ? undefined : inhalt);
    });
  });

  server.on("error", (e) => {
    if (e.code === "EADDRINUSE") {
      process.stderr.write("FEHLER: Port " + o.port + " ist belegt. Anderer Port: --port <zahl>\n");
      process.exit(2);
    }
    process.stderr.write("FEHLER: " + e.message + "\n");
    process.exit(2);
  });

  // KEIN NETZ NACH AUSSEN. 127.0.0.1 ist kein Beiwerk: dieser Server schreibt
  // Dateien und hat keine Anmeldung. Auf 0.0.0.0 gebunden wäre er ein
  // Schreibzugang für jeden im selben Netz.
  server.listen(o.port, "127.0.0.1", () => {
    process.stdout.write(
      "Dashboard auf http://127.0.0.1:" + o.port + "/\n" +
        "  Workspace   : " + wurzel + "\n" +
        "  Bearbeiten  : " + (o.nurLesen ? "aus (--nur-lesen)" : "an -- Dateien lassen sich in der Seite ändern") + "\n" +
        "  Beenden     : Strg+C\n"
    );
    if (!fs.existsSync(path.join(wurzel, "dashboard.html"))) {
      process.stdout.write("  Hinweis     : dashboard.html fehlt noch -- die Seite baut sie beim ersten Neu-Messen.\n");
    }
  });

  return server;
}

function hilfe() {
  process.stdout.write(
    [
      "Vorschau-Server des Dashboards -- lesen und ändern im Browser",
      "",
      "  --port <zahl>     Port (Vorgabe: " + PORT_VORGABE + ")",
      "  --wurzel <pfad>   Workspace-Wurzel (Vorgabe: aufwärts gesucht, Ordner mit .claude/)",
      "  --nur-lesen       Schreiben abschalten",
      "",
      "Ohne diesen Server ist die Seite nur lesbar -- ein Doppelklick auf",
      "dashboard.html genügt dafür.",
      "",
    ].join("\n")
  );
}

if (require.main === module) {
  let o;
  try {
    o = argumenteLesen(process.argv);
  } catch (e) {
    process.stderr.write("FEHLER: " + e.message + "\n\n");
    hilfe();
    process.exit(2);
  }
  if (o.hilfe) hilfe();
  else starten(o);
}

module.exports = { argumenteLesen, pfadPruefen, wurzelFinden, starten };
