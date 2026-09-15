#!/usr/bin/env node
// checks/anleitung-sync.mjs -- bindet jede harte Aussage der Menschen-Anleitung
// an eine gemessene Quelle.
//
// WARUM ES DAS GIBT
// PAKET-ANLEITUNG.md und README.md nennen Zahlen (169 Posten, Version 1.1.0,
// managed=173), Ausgabezeilen (`state=installed`, `KEEL_HARNESS_OK`), Dateipfade
// und eine Ausschluss-Liste. Jede dieser Angaben ist eine Zusage an einen
// Menschen, der nichts nachschlagen kann. Beim naechsten Payload-Bau aendern sie
// sich -- und eine Anleitung, die daneben liegt, ist schlimmer als gar keine:
// sie sieht aus, als waere sie geprueft.
//
// Das Vorbild (keel-harness-standalone-setup/checks/anleitung-sync.mjs) vergleicht
// Volltext-Kopien von Dateien. Dieser Bausatz zitiert keine Dateien im Volltext --
// er zitiert MESSWERTE. Uebernommen ist deshalb nicht der Vergleich, sondern das
// Prinzip: beide Staende muessen gleich sein, es gibt genau eine Quelle je
// Aussage, und der Pruefer beweist bei jedem Lauf, dass er Abweichungen
// ueberhaupt finden KANN (Kontrollprobe).
//
// Drei Bloecke der Anleitung sind ERZEUGT (Was installiert wird, Was bewusst
// fehlt, Stand dieser Auslieferung). Sie kommen aus manifest.json und
// payload-provenance.json und werden nicht von Hand geschrieben.
//
// AUFRUF    node checks/anleitung-sync.mjs [--nachziehen]
//           --nachziehen  schreibt die erzeugten Bloecke neu und gleicht die
//                         gebundenen Zahlen an; danach ohne Schalter gegenpruefen.
// RUECKGABE 0 = deckungsgleich · 1 = Abweichung · 2 = nicht pruefbar

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { assertNodeVersion, requiredNode } from "./node-version.mjs";

assertNodeVersion("checks/anleitung-sync.mjs");

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const nachziehen = process.argv.includes("--nachziehen");

for (const pflicht of ["manifest.json", "payload-provenance.json", "payload", "install.mjs"]) {
  if (!existsSync(join(repoRoot, pflicht))) {
    process.stderr.write("anleitung-sync: " + pflicht + " fehlt -- zuerst `node scripts/build-payload.mjs` ausfuehren.\n");
    process.exit(2);
  }
}

const manifest = JSON.parse(readFileSync(join(repoRoot, "manifest.json"), "utf8"));
const provenance = JSON.parse(readFileSync(join(repoRoot, "payload-provenance.json"), "utf8"));
const engines = requiredNode();
if (engines.error) {
  process.stderr.write("anleitung-sync: " + engines.error + "\n");
  process.exit(2);
}

// Alle Quelltexte des Installers als EIN Text: welche der beiden Dateien eine
// Ausgabemarke traegt, ist fuer die Bindung gleichgueltig -- dass sie irgendwo
// im ausgelieferten Installer steht, ist der Punkt.
const installerQuelltext = ["install.mjs", ...readdirSync(join(repoRoot, "lib"))
  .filter((name) => name.endsWith(".mjs")).map((name) => "lib/" + name)]
  .map((rel) => readFileSync(join(repoRoot, rel), "utf8")).join("\n");

const zielPfade = new Set(manifest.files.map((eintrag) => eintrag.target));
const zielPraefixe = new Set();
for (const ziel of zielPfade) {
  const teile = ziel.split("/");
  for (let i = 1; i < teile.length; i += 1) zielPraefixe.add(teile.slice(0, i).join("/") + "/");
}

// ---------------------------------------------------------------------------
// Erzeugte Bloecke
// ---------------------------------------------------------------------------

// Was jede Payload-Gruppe IST. Der Text ist die einzige Handarbeit an dieser
// Tabelle; Zahlen und Zusammensetzung kommen aus manifest.json. Taucht eine
// Gruppe auf, die hier kein Label hat, ist das ein Fehler und keine Luecke:
// die Anleitung wuerde sonst einen Teil der Auslieferung verschweigen.
const GRUPPEN_LABEL = new Map([
  [".claude/", "Claude-Code-Ausstattung: Wächter-Hooks, Dauer-Regeln, Befehle, Skills"],
  [".agents/", "Providerneutrale Regeln und Skills — dieselben Inhalte für Claude und Codex"],
  [".codex/", "Codex-Route: Hooks, Guards, `config.toml`"],
  ["harness-core/", "Paket-Executor, Owner- und Paket-Bindungen, endliche Git-Schnittstelle"],
  ["vendor/", "Eingebettete Unlazy-Fassung: Paket-Bundles, Skripte, Tests"],
  ["dashboard/", "React-Dashboard: Starter, geprüftes Laufzeit-Archiv, Runtime-Check"],
  ["checks/", "Installierte Prüfungen der Auslieferung (`checks/run-all.mjs` und Einzelprüfer)"],
  ["docs/", "Doku, Instanzdatei mit `[AUSFUELLEN]`-Marke, Paketvorlage"],
  ["templates/", "Vorlagen für Paket-Bundles (OWNER, GATES)"],
  ["roles/", "Fachrollen-Profile des Assistenten (Accountability, Coaching, Ernährung, Training, Wohlbefinden, Business, Projekt)"],
  ["voice/", "Sprachlaufzeit als Sidecar: Piper (Sprachausgabe), Whisper (Mikrofon), Voicebox-Profildienst, Prüfskript `voice/check.mjs`; Starter `dashboard/serve.mjs --voice`"],
  ["licenses/", "Lizenztexte übernommener Fremdteile"],
]);
const WURZEL_LABEL = "Wurzeldateien: ";

function rendereGruppen() {
  const zaehler = new Map();
  const wurzeldateien = [];
  for (const eintrag of manifest.files) {
    const gruppe = eintrag.target.includes("/") ? eintrag.target.split("/")[0] + "/" : "(Wurzel)";
    zaehler.set(gruppe, (zaehler.get(gruppe) || 0) + 1);
    if (gruppe === "(Wurzel)") wurzeldateien.push(eintrag.target);
  }
  const unbekannt = [...zaehler.keys()].filter((gruppe) => gruppe !== "(Wurzel)" && !GRUPPEN_LABEL.has(gruppe));
  if (unbekannt.length) {
    return { fehler: "manifest.json liefert Gruppe(n) ohne Label in checks/anleitung-sync.mjs: " + unbekannt.join(", ") };
  }
  const zeilen = ["| Teil | Was es ist | Dateien |", "|---|---|---|"];
  for (const [gruppe, label] of GRUPPEN_LABEL) {
    if (!zaehler.has(gruppe)) continue;
    zeilen.push("| `" + gruppe + "` | " + label + " | " + zaehler.get(gruppe) + " |");
  }
  if (zaehler.has("(Wurzel)")) {
    const namen = wurzeldateien.sort().map((name) => "`" + name + "`").join(", ");
    zeilen.push("| (Wurzel) | " + WURZEL_LABEL + namen + " | " + zaehler.get("(Wurzel)") + " |");
  }
  zeilen.push("| **Summe** | | **" + manifest.fileCount + "** |");
  return { text: zeilen.join("\n") };
}

function rendereAusschluesse() {
  const eintraege = Array.isArray(manifest.excluded) ? manifest.excluded : [];
  if (!eintraege.length) return { fehler: "manifest.json hat keine excluded-Liste" };
  const zeilen = ["| Nicht mitgeliefert | Grund (Originalwortlaut aus `manifest.json`) |", "|---|---|"];
  for (const eintrag of eintraege) {
    if (!eintrag?.source || !eintrag?.reason) return { fehler: "ein excluded-Eintrag hat kein source/reason" };
    zeilen.push("| `" + eintrag.source + "` | " + eintrag.reason + " |");
  }
  zeilen.push("");
  zeilen.push("Insgesamt **" + eintraege.length + "** bewusste Auslassungen. Sie sind kein Versehen und");
  zeilen.push("brauchen kein Nachtragen.");
  return { text: zeilen.join("\n") };
}

function rendereHerkunft() {
  const quelle = provenance.source || {};
  const zeilen = [
    "| Feld | Wert |",
    "|---|---|",
    "| Produkt und Version | `" + manifest.product.id + "` " + manifest.product.version + " |",
    "| Payload-Posten | " + manifest.fileCount + " |",
    "| Baum-Fingerabdruck | `" + String(manifest.payload.treeSha256).slice(0, 16) + "...` |",
    "| Quelle | `" + quelle.repository + "`, Unterbaum `" + quelle.standalonePath + "` |",
    "| Quell-Commit | `" + quelle.commit + "` |",
    "| Standalone frisch gebaut | " + (quelle.freshStandaloneBuild === true ? "ja" : "nein") + " |",
    "| Ungesicherte Dateien der Quelle beim Bau | Arbeitsbaum " + quelle.workingTreeDirtyFiles +
      ", `" + quelle.standalonePath + "` " + quelle.standaloneSubtreeDirtyFiles + " |",
    "| Erzeugt am | " + provenance.builtAt + " |",
  ];
  return { text: zeilen.join("\n") };
}

const BLOECKE = new Map([
  ["was-installiert-wird", rendereGruppen],
  ["was-bewusst-fehlt", rendereAusschluesse],
  ["stand-der-auslieferung", rendereHerkunft],
]);

// ---------------------------------------------------------------------------
// Gebundene Zahlen
// ---------------------------------------------------------------------------

// Jede Bindung ist ein Muster mit GENAU EINER Fanggruppe und dem Sollwert aus
// einer gemessenen Quelle. Kein Sollwert steht zweimal in diesem Repo.
const ZAHLEN = [
  {
    name: "produkt-version",
    // Die Grenzen sind ABSICHTLICH keine \b: mit \b frisst das Muster die ersten
    // drei Gruppen einer IP (127.0.0.1 -> 127.0.0) und schreibt beim Nachziehen
    // Unsinn in die Anleitung. Am 02.09.2026 genau einmal passiert.
    muster: /(?<![\d.])(\d+\.\d+\.\d+)(?![\d.])/gu,
    soll: () => String(manifest.product.version),
    quelle: "manifest.json -> product.version",
  },
  {
    name: "payload-posten",
    muster: /payload=(\d+)/gu,
    soll: () => String(manifest.fileCount),
    quelle: "manifest.json -> fileCount",
  },
  {
    name: "node-untergrenze",
    muster: /Node[^0-9\n]{0,12}?(?:>=|≥)\s*(\d+)/gu,
    soll: () => String(engines.major),
    quelle: "package.json -> engines.node",
  },
];

// ---------------------------------------------------------------------------
// Ausgabemarken: was die Anleitung als Ausgabe zitiert, muss im Quelltext stehen
// ---------------------------------------------------------------------------

const AUSGABE = [
  { marke: "keel harness distribution:", im: "installer", teile: ["keel harness distribution: "] },
  { marke: "state=planned", im: "installer", teile: ["state=", '"planned"'] },
  { marke: "state=installed", im: "installer", teile: ["state=", '"installed"'] },
  { marke: "command=install", im: "installer", teile: ["command=", '"install"'] },
  { marke: "command=status", im: "installer", teile: ["command=", '"status"'] },
  { marke: "dry-run=true", im: "installer", teile: ["dry-run=true"] },
  { marke: "no-op=true", im: "installer", teile: ["no-op=true"] },
  { marke: "promotions=", im: "installer", teile: ["promotions="] },
  { marke: "managed=", im: "installer", teile: ["managed="] },
  { marke: "rollback=available", im: "installer", teile: ["rollback=", '"available"'] },
  { marke: "target has no .git directory or .git file marker", im: "installer" },
  { marke: "payload integrity mismatch", im: "installer" },
  { marke: "--install-codex-plugin", im: "installer", pflicht: true },
  { marke: "SETUP_REPO_OK", datei: "checks/fresh-clone.mjs" },
  { marke: "SETUP_REPO_SUITE_OK", datei: "checks/run-all.mjs", pflicht: true },
  { marke: "PAYLOAD_PROVENANCE_OK", datei: "checks/payload-provenance.mjs" },
  { marke: "NODE_TOO_OLD", datei: "checks/node-version.mjs", pflicht: true },
  { marke: "KEEL_HARNESS_OK", datei: "payload/checks/run-all.mjs", pflicht: true },
  { marke: "[AUSFUELLEN]", datei: "payload/docs/harness-instance.md", pflicht: true },
];

// Pflicht-Woerter: Aussagen, die nicht still verschwinden duerfen. Jede steht
// fuer einen Auditbefund vom 02.09.2026 (M13: Codex-Route unsichtbar; Punkt 5:
// kein Selbstpruef-Schritt am Ende).
const PFLICHT_WORTE = [
  { wort: "AGENTS.md", grund: "M13 -- die Codex-Route gehoert zum Produkt und muss in der Anleitung stehen" },
  { wort: ".codex/", grund: "M13 -- die installierten Codex-Hooks muessen benannt sein" },
  { wort: "bytegleich", grund: "M13 -- CLAUDE.md und AGENTS.md sind bytegleich; die Zusage wird unten gemessen" },
  { wort: "subst", grund: "L3 -- der MAX_PATH-Ausweg unter Windows muss dastehen" },
  { wort: "PowerShell", grund: "L3 -- die Windows-Form der Befehle muss dastehen" },
  { wort: "nicht verifiziert", grund: "L2 -- der macOS-Weg darf nicht als geprueft erscheinen" },
];

// Pfade, die in der Anleitung stehen duerfen, ohne im Repo oder in der Payload
// zu liegen. Jeder braucht eine Begruendung -- sonst ist er ein Tippfehler.
const PFAD_AUSNAHMEN = new Map([
  // Die Ausschluss-Liste des Manifests benennt QUELLpfade der Werkbank -- genau
  // die Dateien, die dort liegen und hier bewusst nicht ankommen. Dass sie in
  // diesem Repo fehlen, ist die Aussage und kein Fehler.
  ["test-harness/", "Quellpfad in der Werkbank (harness-lab); benannt, weil er hier bewusst fehlt"],
  ["harness-lab/test-harness/standalone/", "Quelle in der Werkbank, nicht Teil dieses Bausatzes"],
  ["docs/packages/", "im Ziel erst nach der Installation vorhanden (Onboarding legt das Bundle an)"],
  [".keel-harness/runtime/dashboard/", "Laufzeit-Ordner, entsteht erst beim ersten Dashboard-Start"],
  [".unlazy/", "Laufzeit-Zustand im Ziel, absichtlich nicht ausgeliefert (siehe Was bewusst fehlt)"],
  ["github.com/coastcoder439/keel-harness-standalone-setup", "Fernkopie dieses Repos"],
]);

// ---------------------------------------------------------------------------
// Messung
// ---------------------------------------------------------------------------

// Der Inhalt zwischen den Marken darf LEER sein (frisch angelegter Block); ein
// Muster mit \n(...)\n faende ihn nicht und meldete "Block fehlt" -- also eine
// Fehldiagnose statt "muss noch erzeugt werden".
function bloeckeFinden(text) {
  const muster = /(<!-- ERZEUGT:([a-z-]+)[^\n]*-->\r?\n)([\s\S]*?)(<!-- \/ERZEUGT:\2 -->)/gu;
  const gefunden = [];
  let treffer;
  while ((treffer = muster.exec(text)) !== null) {
    gefunden.push({
      id: treffer[2], inhalt: treffer[3], kopf: treffer[1], fuss: treffer[4],
      von: treffer.index, bis: muster.lastIndex,
    });
  }
  return gefunden;
}

function pfadKandidaten(text) {
  const kandidaten = new Set();
  // 1. Alles, was hinter <PAKET> steht, ist ein Pfad DIESES Repos.
  for (const treffer of text.matchAll(/<PAKET>[\\/]([A-Za-z0-9_.\\/-]+)/gu)) {
    kandidaten.add("PAKET:" + treffer[1].split("\\").join("/"));
  }
  // 2. Alles in Backticks, das wie ein Pfad DIESES Bestands aussieht, muss
  //    existieren. Ausgesiebt wird, was nur wie ein Pfad aussieht: Slash-Befehle
  //    (`/onboarding`), Heimatpfade und Shell-Zuweisungen der macOS-Variante,
  //    zitierte Beispiele, absolute Beispielpfade mit Laufwerksbuchstaben.
  for (const treffer of text.matchAll(/`([^`\n]+)`/gu)) {
    const wert = treffer[1].trim();
    if (!wert.includes("/") || wert.includes("<") || wert.includes(">") || wert.includes("*")) continue;
    if (wert.startsWith("http") || wert.includes(" ") || wert.includes("=")) continue;
    if (wert.startsWith("/") || wert.startsWith("~") || wert.startsWith("$")) continue;
    if (/^["']/u.test(wert) || /^[A-Za-z]:/u.test(wert)) continue;
    kandidaten.add("FREI:" + wert.split("\\").join("/"));
  }
  return [...kandidaten];
}

function pfadAufloesen(roh) {
  const [art, wert] = [roh.slice(0, roh.indexOf(":")), roh.slice(roh.indexOf(":") + 1)];
  const imRepo = existsSync(join(repoRoot, ...wert.split("/")));
  if (art === "PAKET") {
    return imRepo ? null : "steht als `<PAKET>/" + wert + "`, liegt aber nicht in diesem Repo";
  }
  if (imRepo) return null;
  if (zielPfade.has(wert) || zielPraefixe.has(wert) || zielPraefixe.has(wert + "/")) return null;
  for (const [praefix, grund] of PFAD_AUSNAHMEN) {
    if (wert === praefix || wert.startsWith(praefix)) return { ausnahme: grund };
  }
  return "weder Datei dieses Repos noch Ziel der Payload -- und keine begruendete Ausnahme";
}

/**
 * Wertet ein Dokument aus. Reine Funktion ueber den TEXT, damit die
 * Kontrollprobe denselben Weg mit verfaelschtem Text gehen kann.
 */
function messen(name, text, mitBloecken) {
  const fehler = [];
  const notizen = [];

  if (mitBloecken) {
    const vorhanden = new Map(bloeckeFinden(text).map((block) => [block.id, block]));
    for (const [id, renderer] of BLOECKE) {
      const block = vorhanden.get(id);
      if (!block) {
        fehler.push(name + ": erzeugter Block `" + id + "` fehlt (Marken <!-- ERZEUGT:" + id + " ... --> / <!-- /ERZEUGT:" + id + " -->)");
        continue;
      }
      const gerendert = renderer();
      if (gerendert.fehler) {
        fehler.push(name + ": Block `" + id + "` laesst sich nicht erzeugen -- " + gerendert.fehler);
        continue;
      }
      const ist = block.inhalt.split("\r\n").join("\n").trim();
      const soll = gerendert.text.trim();
      if (ist !== soll) {
        fehler.push(name + ": Block `" + id + "` weicht ab (" + ist.split("\n").length + " Zeilen im Dokument, " +
          soll.split("\n").length + " Zeilen erzeugt) -- angleichen mit `node checks/anleitung-sync.mjs --nachziehen`");
      } else notizen.push("Block `" + id + "` deckungsgleich");
    }
    for (const block of vorhanden.keys()) {
      if (!BLOECKE.has(block)) fehler.push(name + ": erzeugter Block `" + block + "` hat keinen Erzeuger in checks/anleitung-sync.mjs");
    }
  }

  for (const bindung of ZAHLEN) {
    const treffer = [...text.matchAll(bindung.muster)];
    if (!treffer.length) continue;
    const soll = bindung.soll();
    const falsch = treffer.filter((eintrag) => eintrag[1] !== soll);
    if (falsch.length) {
      fehler.push(name + ": " + bindung.name + " -- " + falsch.length + " von " + treffer.length +
        " Stelle(n) nennen " + [...new Set(falsch.map((eintrag) => eintrag[1]))].join("/") +
        ", gemessen ist " + soll + " (" + bindung.quelle + ")");
    } else notizen.push(bindung.name + ": " + treffer.length + "x " + soll + " (" + bindung.quelle + ")");
  }

  // managed= wird NICHT hier gebunden: die Zahl entsteht erst beim Trockenlauf
  // des Installers. checks/fresh-clone.mjs misst sie und vergleicht sie mit
  // dieser Anleitung. Hier wird nur verlangt, dass alle Stellen dieselbe Zahl
  // nennen -- zwei verschiedene waeren schon ohne Messung falsch.
  const managed = [...new Set([...text.matchAll(/managed=(\d+)/gu)].map((treffer) => treffer[1]))];
  if (managed.length > 1) {
    fehler.push(name + ": managed= steht mit verschiedenen Werten im Dokument (" + managed.join(", ") + ")");
  } else if (managed.length === 1) {
    notizen.push("managed=" + managed[0] + " (einheitlich; Sollwert misst checks/fresh-clone.mjs)");
  }

  for (const eintrag of AUSGABE) {
    const imText = text.includes(eintrag.marke);
    if (eintrag.pflicht && mitBloecken && !imText) {
      fehler.push(name + ": die Marke `" + eintrag.marke + "` fehlt -- sie ist Pflicht in der Menschen-Anleitung");
      continue;
    }
    if (!imText) continue;
    const quelltext = eintrag.im === "installer"
      ? installerQuelltext
      : (existsSync(join(repoRoot, ...eintrag.datei.split("/")))
        ? readFileSync(join(repoRoot, ...eintrag.datei.split("/")), "utf8")
        : null);
    if (quelltext === null) {
      fehler.push(name + ": `" + eintrag.marke + "` verweist auf " + eintrag.datei + " -- die Datei fehlt");
      continue;
    }
    const teile = eintrag.teile || [eintrag.marke];
    const fehlend = teile.filter((teil) => !quelltext.includes(teil));
    if (fehlend.length) {
      fehler.push(name + ": `" + eintrag.marke + "` steht im Dokument, aber " + fehlend.map((teil) => "`" + teil + "`").join(" und ") +
        " nicht in " + (eintrag.im === "installer" ? "install.mjs/lib/*.mjs" : eintrag.datei));
    } else notizen.push("Ausgabemarke `" + eintrag.marke + "` gebunden");
  }

  if (mitBloecken) {
    for (const eintrag of PFLICHT_WORTE) {
      if (!text.includes(eintrag.wort)) {
        fehler.push(name + ": das Wort `" + eintrag.wort + "` fehlt -- " + eintrag.grund);
      }
    }
    const ueberschriften = [...text.matchAll(/^## (\d+)\. /gmu)].map((treffer) => Number(treffer[1]));
    const erwartet = ueberschriften.map((_, index) => index + 1);
    if (ueberschriften.join(",") !== erwartet.join(",")) {
      fehler.push(name + ": die Schrittzahlen sind nicht 1..n durchgezaehlt (gefunden: " + ueberschriften.join(", ") + ")");
    } else notizen.push(ueberschriften.length + " Schritte, durchgezaehlt 1.." + ueberschriften.length);
    for (const treffer of text.matchAll(/Schritt (\d+)/gu)) {
      if (Number(treffer[1]) > ueberschriften.length) {
        fehler.push(name + ": verweist auf Schritt " + treffer[1] + ", es gibt nur " + ueberschriften.length);
      }
    }
  }

  for (const kandidat of pfadKandidaten(text)) {
    const ergebnis = pfadAufloesen(kandidat);
    if (ergebnis === null) continue;
    if (typeof ergebnis === "object") {
      notizen.push("Pfad-Ausnahme " + kandidat.slice(kandidat.indexOf(":") + 1) + " -- " + ergebnis.ausnahme);
      continue;
    }
    fehler.push(name + ": Pfad `" + kandidat.slice(kandidat.indexOf(":") + 1) + "` " + ergebnis);
  }

  return { fehler, notizen };
}

// Zusage der Anleitung, die nur am Bestand messbar ist (M13).
function claudeGleichAgents() {
  const claude = join(repoRoot, "payload", "CLAUDE.md");
  const agents = join(repoRoot, "payload", "AGENTS.md");
  if (!existsSync(claude) || !existsSync(agents)) return "payload/CLAUDE.md oder payload/AGENTS.md fehlt";
  const a = readFileSync(claude);
  const b = readFileSync(agents);
  return a.equals(b) ? null : "payload/CLAUDE.md (" + a.length + " Bytes) und payload/AGENTS.md (" + b.length +
    " Bytes) sind NICHT bytegleich -- die Anleitung sagt das Gegenteil";
}

// ---------------------------------------------------------------------------
// Nachziehen
// ---------------------------------------------------------------------------

function textNachziehen(text) {
  let neu = text;
  let geaendert = 0;
  for (const block of bloeckeFinden(neu).reverse()) {
    const renderer = BLOECKE.get(block.id);
    if (!renderer) continue;
    const gerendert = renderer();
    if (gerendert.fehler) continue;
    if (block.inhalt.split("\r\n").join("\n").trim() === gerendert.text.trim()) continue;
    neu = neu.slice(0, block.von) + block.kopf + gerendert.text + "\n" + block.fuss + neu.slice(block.bis);
    geaendert += 1;
    process.stdout.write("  nachgezogen  Block `" + block.id + "`\n");
  }
  for (const bindung of ZAHLEN) {
    const soll = bindung.soll();
    neu = neu.replace(bindung.muster, (ganz, wert) => {
      if (wert === soll) return ganz;
      geaendert += 1;
      process.stdout.write("  nachgezogen  " + bindung.name + ": " + wert + " -> " + soll + "\n");
      return ganz.slice(0, ganz.lastIndexOf(wert)) + soll;
    });
  }
  return { text: neu, geaendert };
}

// ---------------------------------------------------------------------------
// Lauf
// ---------------------------------------------------------------------------

const DOKUMENTE = [
  { datei: "PAKET-ANLEITUNG.md", bloecke: true },
  { datei: "README.md", bloecke: false },
];

for (const dokument of DOKUMENTE) {
  if (!existsSync(join(repoRoot, dokument.datei))) {
    process.stderr.write("anleitung-sync: " + dokument.datei + " fehlt.\n");
    process.exit(2);
  }
}

if (nachziehen) {
  let summe = 0;
  for (const dokument of DOKUMENTE) {
    const pfad = join(repoRoot, dokument.datei);
    const roh = readFileSync(pfad, "utf8");
    const { text, geaendert } = textNachziehen(roh);
    if (geaendert) {
      writeFileSync(pfad, text);
      summe += geaendert;
    }
  }
  process.stdout.write(summe
    ? "\n" + summe + " Stelle(n) angeglichen. Zur Kontrolle ohne --nachziehen erneut laufen lassen.\n"
    : "\nNichts nachzuziehen.\n");
  process.exit(0);
}

const alleFehler = [];
let alleNotizen = 0;
const texte = new Map();

for (const dokument of DOKUMENTE) {
  const text = readFileSync(join(repoRoot, dokument.datei), "utf8");
  texte.set(dokument.datei, text);
  const { fehler, notizen } = messen(dokument.datei, text, dokument.bloecke);
  alleFehler.push(...fehler);
  alleNotizen += notizen.length;
  process.stdout.write(dokument.datei + ": " + notizen.length + " Bindung(en) geprueft, " + fehler.length + " Abweichung(en)\n");
}

const identitaet = claudeGleichAgents();
if (identitaet) alleFehler.push("Bestand: " + identitaet);
else alleNotizen += 1;

// KONTROLLPROBE -- der stille Bruch ist der gefaehrliche: Wenn die Messung aus
// irgendeinem Grund immer "gleich" sagt, ist ein leerer Fehlerbericht von einem
// echt sauberen Stand nicht zu unterscheiden. Deshalb wird derselbe Weg einmal
// mit absichtlich verfaelschtem Text gegangen; er MUSS mehr Fehler finden.
const probeText = texte.get("PAKET-ANLEITUNG.md");
if (!/payload=\d+/u.test(probeText)) {
  process.stderr.write("FEHLER: Kontrollprobe nicht moeglich -- die Anleitung nennt kein `payload=<n>`.\n");
  process.exit(2);
}
const vorher = messen("probe", probeText, true).fehler.length;
const nachher = messen("probe", probeText.replace(/payload=\d+/u, "payload=987654"), true).fehler.length;
if (nachher <= vorher) {
  process.stderr.write("FEHLER: Kontrollprobe fehlgeschlagen -- verfaelschter Text ergab " + nachher +
    " statt mehr als " + vorher + " Abweichungen.\n");
  process.stderr.write("Der Abgleich kann nicht beweisen, dass er Abweichungen findet; ein leeres Ergebnis waere bedeutungslos.\n");
  process.exit(2);
}

if (alleFehler.length) {
  process.stdout.write("\n");
  for (const fehler of alleFehler) process.stdout.write("  ABWEICHUNG  " + fehler + "\n");
  process.stdout.write(
    "\nBEIDE STAENDE MUESSEN GLEICH SEIN. Erzeugte Bloecke und gebundene Zahlen gleicht\n" +
    "`node checks/anleitung-sync.mjs --nachziehen` an. Alles andere entscheidet der Fall:\n" +
    "Nennt die Anleitung etwas, das es nicht gibt, ist die Anleitung falsch; fehlt eine\n" +
    "zugesagte Datei, ist der Bestand falsch. Was NICHT geht: die Abweichung vermerken\n" +
    "und beide Staende stehen lassen.\n"
  );
  process.exit(1);
}

process.stdout.write("ANLEITUNG_SYNC_OK dokumente=" + DOKUMENTE.length + " bindungen=" + alleNotizen + "\n");
process.exit(0);
