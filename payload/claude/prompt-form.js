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
// Kosten: ~330 Zeichen je Turn. Langfassung bleibt der Skill i-have-adhd.

const KURZFORM =
  "Antwortform (gilt fuer JEDE Antwort, Kurzform des Skills i-have-adhd): " +
  "Antwort zuerst, dann die Antwortart benennen (Entscheidung / Bericht / Analyse). " +
  "Die Basis steht komplett in der Nachricht — Dinge benennen, keine Register-Kuerzel. " +
  "Arbeitspakete oeffnen mit Problem–Intent–Goal und leben als SICHTBARES Artefakt im " +
  "Repo IHRES Projekts (<repo>/docs/pakete/<paket>.md; beim Planen anlegen, bei jedem " +
  "Paket-Abschluss nachfuehren). Listen hoechstens fuenf " +
  "Punkte. Wurde in diesem Turn geschrieben oder committet, endet die Meldung mit den zwei " +
  "Zeilen 'Geprueft gegen: ...' und 'Offen: ...' — \"fertig\" existiert nur darin.";

// --- Selbsttest: Ausgabeform ist gueltiges Hook-JSON mit der Kurzform ---
if (process.argv.includes("--selbsttest")) {
  const aus = JSON.parse(ausgabe());
  const ok =
    aus.hookSpecificOutput.hookEventName === "UserPromptSubmit" &&
    aus.hookSpecificOutput.additionalContext.includes("Antwort zuerst") &&
    aus.hookSpecificOutput.additionalContext.includes("Geprueft gegen");
  console.log(ok ? "ok   Kurzform-JSON gueltig und vollstaendig" : "FEHL Ausgabe unvollstaendig");
  console.log(`${ok ? 1 : 0} von 1 Faellen richtig.`);
  process.exit(ok ? 0 : 1);
}

function ausgabe() {
  return JSON.stringify({
    hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: KURZFORM },
  });
}

// Eingabe (die Nutzer-Nachricht) wird gelesen, aber nicht ausgewertet — die
// Kurzform gilt bedingungslos; jede Sonderlogik waere eine neue Fehlerquelle.
let eingabe = "";
process.stdin.on("data", (c) => (eingabe += c));
process.stdin.on("end", () => {
  process.stdout.write(ausgabe());
  process.exit(0);
});
