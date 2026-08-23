#!/usr/bin/env node
// Abnahmetest des Harness-Bausatzes.
//
// Dieses Skript liegt im Bausatz-Repo unter checks/ und beweist:
// Der Bausatz, in dem es liegt, installiert einen funktionierenden
// Claude-Code-Harness in einen frischen, leeren Zielordner.
//
// Ablauf: Vorbedingung -> Temp-Ordner + git init -> Trockenlauf -> Echtlauf
//         -> Bestands-Messungen -> optionaler Tiefen-Test -> Aufraeumen.
//
// Exitcode-Disziplin: Der Exitcode wird an GENAU EINER Stelle vergeben
// (ganz unten, process.exitCode = rot > 0 ? 1 : 0). Kein Pruefzweig ruft
// process.exit() auf. Frueh abgebrochene Laeufe setzen process.exitCode = 1
// und returnen.
//
// Node >= 18, nur Bordmittel.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HIER = path.dirname(fileURLToPath(import.meta.url));
const BAUSATZ = path.resolve(HIER, "..");

// --- Ergebnis-Buchhaltung ---------------------------------------------------

let gruen = 0;
let rot = 0;

/** Eine bestandene Pruefung protokollieren. */
function ok(name) {
  gruen += 1;
  console.log(`GRUEN ${name}`);
}

/** Eine gescheiterte Pruefung protokollieren. */
function fehler(name, grund) {
  rot += 1;
  console.log(`ROT   ${name}: ${grund}`);
}

/** Eine bewusst ausgelassene Pruefung protokollieren (zaehlt weder gruen noch rot). */
function uebersprungen(name, grund) {
  console.log(`--    ${name}: ${grund}`);
}

/**
 * Eine Pruefung ausfuehren: die Funktion gibt null/undefined bei Erfolg
 * zurueck oder einen Grund-String bei Misserfolg. Wirft sie, gilt der
 * Wurf als Misserfolg — so kann keine Pruefung den Lauf abbrechen.
 */
function pruefe(name, fn) {
  let grund;
  try {
    grund = fn();
  } catch (e) {
    grund = `Ausnahme: ${e && e.message ? e.message : String(e)}`;
  }
  if (grund) fehler(name, grund);
  else ok(name);
  return !grund;
}

// --- Hilfen -----------------------------------------------------------------

const istDatei = (p) => fs.existsSync(p) && fs.statSync(p).isFile();
const istOrdner = (p) => fs.existsSync(p) && fs.statSync(p).isDirectory();

// --- Hauptlauf --------------------------------------------------------------

const mitClaude = process.argv.includes("--mit-claude");
let ziel = null;

try {
  // 1. Vorbedingung: der Bausatz muss vollstaendig genug sein, um zu starten.
  const onboarding = path.join(BAUSATZ, "install.mjs");
  const paket = path.join(BAUSATZ, "manifest.json");
  const fehlend = [];
  if (!istDatei(onboarding)) fehlend.push(onboarding);
  if (!istDatei(paket)) fehlend.push(paket);

  if (fehlend.length > 0) {
    fehler(
      "vorbedingung-bausatz",
      `Bausatz unvollstaendig — es fehlt: ${fehlend.join(", ")}. ` +
        `Dieses Skript muss in <bausatz>/checks/ liegen (gemessener Bausatz: ${BAUSATZ}).`,
    );
    console.log("");
    console.log(`ERGEBNIS: ${gruen} gruen, ${rot} rot`);
    // Kein process.exitCode hier — die Vergabe passiert am Dateiende (rot > 0).
  } else {
    ok("vorbedingung-bausatz");

    // 1b. Anleitung und echte Dateien muessen denselben Stand haben.
    //
    // Dieser Bausatz beschreibt denselben Harness zweimal -- als echte Dateien und
    // als Volltext-Zitate in der Nachbau-Anleitung. Laufen die auseinander, ist die
    // Anleitung eine Falle: Am 21.08.2026 nannte sie den Projekt-Kontext-Check und
    // die Dauer-Regel working-method.md, waehrend keine installierte Datei sie hatte.
    // Deshalb laeuft der Abgleich HIER mit und nicht auf Zuruf -- eine gemerkte
    // Pflicht haette genau das schon einmal nicht verhindert.
    pruefe("anleitung-sync", () => {
      const lauf = spawnSync("node", [path.join(BAUSATZ, "checks", "anleitung-sync.mjs")], {
        cwd: BAUSATZ,
        encoding: "utf8",
      });
      if (lauf.status === 0) return null;
      const letzte = (lauf.stdout || "")
        .split("\n")
        .filter((z) => /DRIFT|FEHLT|ANKERLOS|FEHLER/.test(z))
        .slice(0, 4)
        .join(" | ");
      return `Anleitung und echte Dateien weichen ab (Exitcode ${lauf.status}). ${letzte} ` +
        `-- angleichen mit: node checks/anleitung-sync.mjs --nachziehen`;
    });

    // 1c. manifest.json muss den tatsaechlichen Paketinhalt abbilden.
    //
    // Das Manifest sagt, was der Bausatz ausliefert. Sein urspruenglicher Generator lag
    // AUSSERHALB dieses Bausatzes -- deshalb log es still mit, sobald hier eine Datei
    // dazukam: Stand 22.08.2026 waren 38 Posten gelistet, 50 vorhanden. Ein Verzeichnis,
    // das den Bestand falsch angibt, sieht aus wie eine Zusage und ist keine.
    pruefe("paket-manifest", () => {
      const lauf = spawnSync("node", [path.join(BAUSATZ, "checks", "paket-manifest.mjs")], {
        cwd: BAUSATZ,
        encoding: "utf8",
      });
      if (lauf.status === 0) return null;
      const letzte = (lauf.stdout || "")
        .split(String.fromCharCode(10))
        .filter((z) => /NICHT GELISTET|NICHT MEHR DA|GEAENDERT|POSTEN|FEHLER/.test(z))
        .slice(0, 4)
        .join(" | ");
      return `manifest.json und Paketinhalt weichen ab (Exitcode ${lauf.status}). ${letzte} ` +
        `-- angleichen mit: node checks/paket-manifest.mjs --nachziehen`;
    });

    // 1d. Die Dateiliste des Installateurs muss den Dashboard-Inhalt abbilden.
    //
    // paket-manifest.mjs faengt das NICHT ab: eine Datei kann im Paket liegen,
    // im Manifest stehen -- und trotzdem nie installiert werden, weil die Liste
    // DASHBOARD in install.mjs sie nicht nennt. Genau so geschehen am
    // 23.08.2026, zweimal am selben Tag.
    pruefe("dashboard-liste", () => {
      const lauf = spawnSync("node", [path.join(BAUSATZ, "checks", "dashboard-liste.mjs")], {
        cwd: BAUSATZ,
        encoding: "utf8",
      });
      if (lauf.status === 0) return null;
      const letzte = (lauf.stdout || "")
        .split(String.fromCharCode(10))
        .filter((z) => /NICHT INSTALLIERT|FEHLT IM PAKET|DOPPELT/.test(z))
        .slice(0, 4)
        .join(" | ");
      return `Dateiliste und Paketinhalt weichen ab (Exitcode ${lauf.status}). ${letzte} ` +
        `-- nachtragen in install.mjs, Liste DASHBOARD`;
    });

    // 2. Frischer Zielordner + git init.
    ziel = fs.mkdtempSync(path.join(os.tmpdir(), "harness-abnahme-"));
    const gitInit = spawnSync("git", ["init"], { cwd: ziel, encoding: "utf8" });
    pruefe("git-init", () =>
      gitInit.status === 0
        ? null
        : `git init Exitcode ${gitInit.status}: ${(gitInit.stderr || "").trim()}`,
    );

    /** install.mjs im Zielordner ausfuehren. */
    const laufe = (extra) =>
      spawnSync("node", [onboarding, "--ziel", ziel, ...extra], {
        cwd: BAUSATZ,
        encoding: "utf8",
      });

    // 3. Trockenlauf — darf nichts kaputtmachen und muss 0 liefern.
    const trocken = laufe(["--trocken"]);
    pruefe("onboarding-trockenlauf", () => {
      if (trocken.status === 0) return null;
      return (
        `Exitcode ${trocken.status}\n--- stdout ---\n${trocken.stdout || ""}` +
        `\n--- stderr ---\n${trocken.stderr || ""}`
      );
    });

    // 4. Echtlauf — installiert tatsaechlich.
    const echt = laufe([]);
    pruefe("onboarding-echtlauf", () => {
      if (echt.status === 0) return null;
      return (
        `Exitcode ${echt.status}\n--- stdout ---\n${echt.stdout || ""}` +
        `\n--- stderr ---\n${echt.stderr || ""}`
      );
    });

    // 5. Bestands-Messungen im Zielordner.
    const settingsPfad = path.join(ziel, ".claude", "settings.json");
    let settingsRoh = null;

    // 5a. settings.json vorhanden, gueltiges JSON, mit "hooks"-Schluessel.
    pruefe("settings-json", () => {
      if (!istDatei(settingsPfad)) return `${settingsPfad} fehlt`;
      settingsRoh = fs.readFileSync(settingsPfad, "utf8");
      let daten;
      try {
        daten = JSON.parse(settingsRoh);
      } catch (e) {
        settingsRoh = null;
        return `kein gueltiges JSON: ${e.message}`;
      }
      if (!daten || typeof daten !== "object" || !("hooks" in daten)) {
        return 'Schluessel "hooks" fehlt';
      }
      return null;
    });

    // 5b. Jeder in settings.json referenzierte Hook-Pfad zeigt auf eine echte Datei.
    pruefe("hook-pfade", () => {
      if (settingsRoh === null) return "settings.json nicht lesbar (siehe oben)";
      const treffer = settingsRoh.match(/\.claude\/[A-Za-z0-9._/-]+\.js/g) || [];
      const einmalig = [...new Set(treffer)];
      if (einmalig.length === 0) return "keine Hook-Pfade in settings.json gefunden";
      const kaputt = einmalig.filter((rel) => !istDatei(path.join(ziel, rel)));
      return kaputt.length === 0
        ? null
        : `${kaputt.length} von ${einmalig.length} Pfaden zeigen ins Leere: ${kaputt.join(", ")}`;
    });

    // 5c. Dauer-Regeln: mindestens 4 .md-Dateien, keine mit Frontmatter.
    pruefe("dauer-regeln", () => {
      const regelOrdner = path.join(ziel, ".claude", "rules", "keel");
      if (!istOrdner(regelOrdner)) return `${regelOrdner} fehlt`;
      const mds = fs.readdirSync(regelOrdner).filter((n) => n.endsWith(".md"));
      if (mds.length < 4) return `nur ${mds.length} .md-Dateien, mindestens 4 erwartet`;
      const mitFrontmatter = mds.filter((n) =>
        fs.readFileSync(path.join(regelOrdner, n), "utf8").startsWith("---"),
      );
      return mitFrontmatter.length === 0
        ? null
        : `Frontmatter in Dauer-Regeln: ${mitFrontmatter.join(", ")}`;
    });

    // 5d. Die beiden Pflicht-Befehle.
    pruefe("befehle", () => {
      const cmdOrdner = path.join(ziel, ".claude", "commands");
      if (!istOrdner(cmdOrdner)) return `${cmdOrdner} fehlt`;
      const fehlt = ["repo-status.md", "save-work.md"].filter(
        (n) => !istDatei(path.join(cmdOrdner, n)),
      );
      return fehlt.length === 0 ? null : `fehlt: ${fehlt.join(", ")}`;
    });

    // 5e. Projekt-Anweisungsdatei.
    pruefe("claude-md", () =>
      istDatei(path.join(ziel, "CLAUDE.md")) ? null : "CLAUDE.md fehlt im Zielordner",
    );

    // 5f. Das Dashboard muss in der frischen Installation LAUFEN, nicht nur
    // dort liegen.
    //
    // Bis 23.08.2026 hat die Abnahme das Dashboard nie angefasst. Sie war gruen,
    // waehrend die Dateiliste des Installateurs bei sieben Eintraegen stand und
    // das Dashboard zwanzig Module hatte -- eine frische Installation haette ein
    // index.js bekommen, das vier nicht vorhandene Module laedt. Gefunden wurde
    // das von Hand. Deshalb wird hier wirklich gebaut.
    pruefe("dashboard-baut", () => {
      const lauf = spawnSync("node", ["dashboard/index.js", "--html", "dashboard.html"], {
        cwd: ziel,
        encoding: "utf8",
        timeout: 180000,
      });
      if (lauf.status !== 0) {
        const grund = ((lauf.stderr || "") + (lauf.stdout || ""))
          .split(String.fromCharCode(10))
          .filter(Boolean)
          .slice(-3)
          .join(" | ");
        return `das Dashboard laesst sich in der frischen Installation nicht bauen (Exitcode ${lauf.status}). ${grund}`;
      }
      const seite = path.join(ziel, "dashboard.html");
      if (!istDatei(seite)) return "der Bau meldet Erfolg, aber dashboard.html fehlt";
      const groesse = fs.statSync(seite).size;
      if (groesse < 50000) return `dashboard.html ist mit ${groesse} Bytes zu klein -- vermutlich leer geblieben`;
      return null;
    });

    // 5g. Die mitgelieferte Selbstpruefung muss beim Empfaenger gruen sein.
    //
    // Rote Tests beim Empfaenger sind schlimmer als keine: sie sagen "kaputt",
    // wo nur eine Bedingung fehlt. Am 23.08.2026 waren 14 von 140 rot, weil sie
    // Inhalte eines gewachsenen Workspace voraussetzten. Uebersprungene Tests
    // sind in Ordnung -- sie tragen ihren Grund im Namen und werden hier
    // ausdruecklich mitgezaehlt, damit niemand sie fuer bestanden haelt.
    pruefe("dashboard-tests", () => {
      // Die Dateien werden ausgeschrieben, nicht als Ordner uebergeben: unter
      // Windows liest Node "dashboard/test/" als Modulpfad und meldet "Cannot
      // find module" statt zu pruefen (gemessen 23.08.2026, Node 24). Eine
      // Glob-Form scheidet aus, weil hier keine Shell laeuft.
      const testOrdner = path.join(ziel, "dashboard", "test");
      if (!istOrdner(testOrdner)) return "dashboard/test/ fehlt in der Installation";
      const dateien = fs
        .readdirSync(testOrdner)
        .filter((f) => f.endsWith(".test.js"))
        .map((f) => path.join("dashboard", "test", f));
      if (dateien.length === 0) return "keine Testdatei in dashboard/test/ angekommen";
      const lauf = spawnSync("node", ["--test", ...dateien], {
        cwd: ziel,
        encoding: "utf8",
        timeout: 300000,
      });
      const aus = (lauf.stdout || "") + (lauf.stderr || "");
      const zahl = (name) => {
        const t = aus.match(new RegExp("^[^A-Za-z0-9]*" + name + "\\s+(\\d+)", "m"));
        return t ? Number(t[1]) : null;
      };
      const gesamt = zahl("tests");
      const rot = zahl("fail");
      const durch = zahl("pass");
      if (gesamt === null) return `die Testausgabe war nicht lesbar (Exitcode ${lauf.status})`;
      if (gesamt < 50)
        return `nur ${gesamt} Pruefungen aus ${dateien.length} Testdateien gelaufen -- die Installation ist unvollstaendig`;
      if (rot) {
        const welche = aus
          .split(String.fromCharCode(10))
          .filter((z) => z.includes("✖"))
          .slice(0, 3)
          .join(" | ");
        return `${rot} von ${gesamt} Pruefungen rot in der frischen Installation. ${welche}`;
      }
      return durch > 0 ? null : "keine Pruefung ist durchgelaufen";
    });

    // 6. Optionaler Tiefen-Test: laedt Claude die Dauer-Regeln wirklich?
    const claudeDa =
      spawnSync("command", ["-v", "claude"], { shell: true, encoding: "utf8" }).status === 0;
    if (!mitClaude) {
      uebersprungen("claude-kontext", "uebersprungen (--mit-claude nicht gesetzt)");
    } else if (!claudeDa) {
      uebersprungen("claude-kontext", 'uebersprungen (Befehl "claude" nicht im PATH)');
    } else {
      const frage =
        'Antworte NUR aus deinem Kontext, keine Tools: Ist eine Projektregel "Kein One-Shot" ' +
        "in deinem Kontext? Format: ja/nein";
      const lauf = spawnSync(
        "claude",
        ["-p", frage, "--model", "claude-haiku-4-5-20251001", "--max-turns", "1"],
        { cwd: ziel, encoding: "utf8", timeout: 180000 },
      );
      pruefe("claude-kontext", () => {
        if (lauf.error) return `Aufruf gescheitert: ${lauf.error.message}`;
        const aus = (lauf.stdout || "").toLowerCase();
        return aus.includes("ja")
          ? null
          : `Antwort enthaelt kein "ja" (Exitcode ${lauf.status}): ${(lauf.stdout || "").trim()}`;
      });
    }

    console.log("");
    console.log(`ERGEBNIS: ${gruen} gruen, ${rot} rot`);
  }
} finally {
  // 7. Aufraeumen — auch wenn oben etwas geworfen hat.
  if (ziel) {
    try {
      fs.rmSync(ziel, { recursive: true, force: true });
    } catch {
      /* Temp-Ordner bleibt liegen; kein Grund, den Abnahmetest zu faerben. */
    }
  }
}

// EINZIGE Stelle der Exitcode-Vergabe. Ueber ALLE Pfade erreichbar — auch der
// fruehe Abbruch bei verletzter Vorbedingung laeuft hier durch, weil er die
// Vorbedingung als rote Pruefung zaehlt (rot > 0 => 1).
process.exitCode = rot > 0 ? 1 : 0;
