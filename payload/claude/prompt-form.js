#!/usr/bin/env node
// UserPromptSubmit-Hook: injiziert die Antwortform-Kurzform bei JEDER Nachricht.
//
// Warum [Owner-Freigabe 24.08.2026 spaetabends]: Die Antwortform war nur am
// Session-START verankert (Skill via session-roles.js). In langen Sessions
// verliert die Start-Instruktion gegen den juengeren Kontext — belegt an den
// eigenen Form-Ausfaellen dieser Session und deckungsgleich mit der Evidenz
// (arXiv 2605.10039: Compliance sinkt mit Session-Fortschritt; Anthropic:
// spaete Position im Kontext verbessert Befolgung). Dieser Hook setzt die
// Kurzform an den WIRKZEITPUNKT: direkt vor die Antwort, jede Runde.
// Kosten: ~1,7 KB je Turn (gemessen 26.08.2026, inkl. Abruf-Werkzeug-Index).
// Langfassung bleibt der Skill i-have-adhd; Volltexte der Werkzeuge laden auf Abruf.
// Budget-Massstab [Owner 26.08.2026]: Umfang darf wachsen (Dauer-Kontext bis ~5 %
// des Fensters ok) — Massstab ist nicht die Byte-Zahl, sondern dass JEDER Satz eine
// ERLEBTE Fehlerklasse abstellt; Zeile raus, wenn ihre Klasse nicht mehr auftritt.
// Grenze bleibt die Schaerfe: waechst die Injektion zum Katalog, ueberliest das
// Modell den Einzelsatz wieder (Beleg docs/packages/skill-invocation-diagnose.md).

const KURZFORM =
  "Antwortform (gilt fuer JEDE Antwort, Kurzform des Skills i-have-adhd): " +
  "Antwort zuerst, dann die Antwortart benennen (Entscheidung / Bericht / Analyse). " +
  "Die Basis steht komplett in der Nachricht — Dinge benennen, keine Register-Kuerzel. " +
  "Arbeitspakete oeffnen mit Problem–Intent–Goal und leben als SICHTBARES Artefakt im " +
  "Repo IHRES Projekts (<repo>/docs/packages/<paket>.md; beim Planen anlegen, bei jedem " +
  "Paket-Abschluss nachfuehren). Listen hoechstens fuenf " +
  "Punkte. Wurde in diesem Turn geschrieben oder committet, endet die Meldung mit den zwei " +
  "Zeilen 'Geprueft gegen: ...' und 'Offen: ...' — \"fertig\" existiert nur darin. " +
  "Arbeitsregeln [Owner 25.08.2026]: Kein One-Shot — erst Bestand und Belege pruefen, dann " +
  "formulieren. Eine Recherche zaehlt erst mit zwei unabhaengigen Quellen; das erste " +
  "Suchergebnis ist ein Kandidat, keine Wahrheit. Nicht-triviale Arbeit bekommt VOR dem Bau " +
  "einen Plan im Paket; breite Recherche/Pruefung laeuft als parallele Agenten oder Workflow, " +
  "nicht als Einzelgriff. Jede Antwort endet mit dem naechsten Arbeitsauftrag samt Besitzer " +
  "(ich/du) und Empfehlung — und was bei MIR liegt und entschieden ist, fuehre ich AUS, " +
  "statt es zurueckzugeben. " +
  // Wiederhergestellt 27.08.2026 [Owner]: stand bis zur Kuerzung 9f0967f im Skill
  // ("Measured: the single largest source of length") und fehlte danach -- die
  // Textwand kam zurueck. Beleg: docs/packages/injektion-wirkt-nicht.md
  "Vor dem Absenden streichen: die HERLEITUNG (wie ein Befund zustande kam, wie oft etwas lief, was du unterwegs geprueft hast) — sie gehoert in die Commit-Nachricht, nicht in die Antwort; genannt wird das ERGEBNIS. Mehrschritt-Arbeit ist eine NUMMERIERTE Liste, nie Fliesstext. Pruefung: Weiss der Leser nach ERSTER und LETZTER Zeile, was zu tun ist und was passiert ist? Sonst umschreiben. " +
  // Ein-Satz-Index der Abruf-Werkzeuge [Owner 26.08.2026]: Injektion ist der einzige
  // deterministische Ausloeser — der Skill-Katalog ist nur ein Relevanz-Wettbewerb
  // (Beleg docs/packages/skill-invocation-diagnose.md). Volltexte laden per Skill-Aufruf.
  "Abruf-Werkzeuge (Volltext laedt der jeweilige Skill-Aufruf): completeness = Audit vor " +
  "jeder Fertig-/bau-bereit-Aussage und Uebergabe · save-work = ungesicherte Arbeit dieses " +
  "Kontexts committen+pushen · repo-status = Git-Stand Harness+Projekte vs GitHub · " +
  "session-map = alle Sessions, Rollen, Repo-Stand · tell-session = Befund/Uebergabe an " +
  "eine andere Session · gauntlet-loop = Qualitaetsschleife Bau/Design gegen messbare " +
  "Latte · onboarding = einmalig nach frischer Installation.";

// --- Auftraege der Kommandobruecke zustellen (Wirkzeitpunkt-Zustellung) -----
// bridge.html schreibt .claude/orders/<ts>.json {target, text}; dieser Hook
// haengt passende Auftraege an den Kontext der Ziel-Session. target ist eine
// session_id oder "all". Gezielte Auftraege wandern nach Zustellung in
// orders/delivered/; "all"-Auftraege bleiben 10 Minuten sichtbar (jede Session
// soll sie sehen) und werden danach von der naechsten Zustellung wegsortiert.
const ORDER_ALL_MINUTES = 10;

function ordersHolen(deps, sessionId) {
  const eintraege = [];
  let dateien = [];
  try {
    dateien = deps.listdir(deps.ordersDir).filter((n) => n.endsWith(".json"));
  } catch {
    return eintraege;
  }
  for (const name of dateien) {
    let order;
    try {
      order = JSON.parse(deps.read(deps.ordersDir + "/" + name));
    } catch {
      continue;
    }
    const alterMin = (deps.now() - Date.parse(order.ts || 0)) / 60000;
    if (order.target === "all") {
      if (alterMin > ORDER_ALL_MINUTES) deps.deliver(name);
      else eintraege.push(order.text);
    } else if (order.target === sessionId) {
      eintraege.push(order.text);
      deps.deliver(name);
    }
  }
  return eintraege;
}

function ausgabe(orders) {
  let text = KURZFORM;
  if (orders && orders.length) {
    text += " || AUFTRAG von der Kommandobruecke [Owner]: " + orders.join(" | ");
  }
  return JSON.stringify({
    hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: text },
  });
}

// --- Selbsttest: Kurzform-JSON + Order-Zustellung (deps gefaked) ---
if (process.argv.includes("--selbsttest")) {
  const aus = JSON.parse(ausgabe());
  const f1 =
    aus.hookSpecificOutput.hookEventName === "UserPromptSubmit" &&
    aus.hookSpecificOutput.additionalContext.includes("Antwort zuerst") &&
    aus.hookSpecificOutput.additionalContext.includes("Geprueft gegen") &&
    aus.hookSpecificOutput.additionalContext.includes("Abruf-Werkzeuge");
  const zugestellt = [];
  const deps = {
    ordersDir: "orders",
    listdir: () => ["a.json", "b.json", "c.json", "kaputt.json"],
    read: (p) =>
      ({
        "orders/a.json": JSON.stringify({ target: "s1", text: "mach X", ts: new Date().toISOString() }),
        "orders/b.json": JSON.stringify({ target: "all", text: "an alle", ts: new Date().toISOString() }),
        "orders/c.json": JSON.stringify({ target: "s2", text: "nicht fuer uns", ts: new Date().toISOString() }),
        "orders/kaputt.json": "{{{",
      })[p],
    deliver: (n) => zugestellt.push(n),
    now: () => Date.now(),
  };
  const orders = ordersHolen(deps, "s1");
  const f2 = orders.length === 2 && orders.includes("mach X") && orders.includes("an alle");
  const f3 = zugestellt.length === 1 && zugestellt[0] === "a.json"; // gezielt weg, all bleibt, fremd bleibt
  const f4 = ausgabe(orders).includes("AUFTRAG von der Kommandobruecke");
  const faelle = [["Kurzform-JSON", f1], ["Order-Filter (eigene + all)", f2], ["Zustell-Buchung nur gezielt", f3], ["Auftrag im Kontext", f4]];
  let fehler = 0;
  for (const [name, ok] of faelle) {
    if (!ok) fehler++;
    console.log(`${ok ? "ok  " : "FEHL"} ${name}`);
  }
  console.log(`${faelle.length - fehler} von ${faelle.length} Faellen richtig.`);
  process.exit(fehler ? 1 : 0);
}

// Eingabe: session_id fuer die Order-Zustellung; die Kurzform gilt bedingungslos.
const fs = require("fs");
const path = require("path");
let eingabe = "";
process.stdin.on("data", (c) => (eingabe += c));
process.stdin.on("end", () => {
  let orders = [];
  try {
    const daten = JSON.parse(eingabe || "{}");
    const wurzel = process.env.CLAUDE_PROJECT_DIR;
    if (wurzel && daten.session_id) {
      const ordersDir = path.join(wurzel, ".claude", "orders");
      const deliveredDir = path.join(ordersDir, "delivered");
      orders = ordersHolen(
        {
          ordersDir,
          listdir: (d) => fs.readdirSync(d),
          read: (p) => fs.readFileSync(p.split("/").join(path.sep), "utf8"),
          deliver: (name) => {
            fs.mkdirSync(deliveredDir, { recursive: true });
            fs.renameSync(path.join(ordersDir, name), path.join(deliveredDir, name));
          },
          now: () => Date.now(),
        },
        daten.session_id
      );
    }
  } catch {} // fail-open: die Kurzform kommt immer, Orders sind Zugabe
  process.stdout.write(ausgabe(orders));
  process.exit(0);
});
