#!/usr/bin/env node
// PreToolUse-Hook: blockiert zu lange Nachrichten ZWISCHEN Sitzungen.
//
// WARUM ES DAS GIBT
// Gemessen an einer Sitzung: 63 Nachrichten an andere Sitzungen, Median 1.378
// Zeichen, zusammen 89.905 -- rund 22.000 Token in FREMDE Kontextfenster.
// Leon dazu: "sie reden wie Menschen miteinander, das braucht eine KI nicht."
//
// WARUM ALS HOOK UND NICHT ALS REGEL
// Die Form stand seit dem 03.08. in output-shape.md (Zusatz B) und in
// commands/tell-session.md -- und aenderte nichts. Regeln sind KONTEXT, keine
// Durchsetzung; die offizielle Doku sagt es woertlich: "To block an action
// regardless of what Claude decides, use a PreToolUse hook instead."
// Anders als no-oneshot.md (die regelt AUSSAGEN und hat keinen Werkzeugaufruf,
// an dem ein Hook greifen koennte) ist das Senden einer Nachricht ein echter
// Werkzeugaufruf -- also erzwingbar.
//
// WAS GEPRUEFT WIRD
// Nicht nur die Laenge. Eine Zeichenzahl allein waere das falsche Mass (400
// Zeichen koennen Fuellstoff sein, 800 knapp). Geprueft werden die STRUKTUREN,
// die eine Nachricht zur Menschen-Prosa machen: Zwischenueberschriften, Tabellen,
// Code-Bloecke, Dank- und Lobfloskeln. Die Laengenschranke faengt nur den Rest.
//
// AUFRUF    PreToolUse, matcher: mcp__ccd_session_mgmt__send_message
// RUECKGABE 0 = durch · 2 = blockiert (mit Begruendung auf stderr)

const HART = 900;   // darueber wird immer geblockt
const WEICH = 600;  // darueber nur mit Strukturbefund

const FLOSKELN = [
  [/\b(danke|dank(e|schoen)?)\b/i, "Dank"],
  [/\b(gut(e|er) (fund|arbeit|punkt)|stark|sauber gemacht|gute meldung)\b/i, "Lob"],
  [/\b(sorry|entschuldig|mein fehler|ich hatte unrecht|asche auf)\b/i, "Entschuldigung"],
  [/\b(wie ihr richtig|ihr habt recht|euer befund war)\b/i, "Bestaetigung der Gegenseite"],
];

function pruefe(text) {
  const m = [];
  const zeilen = text.split("\n");

  const ueber = zeilen.filter((z) => /^#{1,6}\s/.test(z.trim())).length;
  if (ueber) m.push(`${ueber} Zwischenueberschrift(en) — eine Nachricht hat drei Zeilen, keine Gliederung`);

  const tab = zeilen.filter((z) => /^\s*\|.*\|/.test(z)).length;
  if (tab >= 2) m.push(`Tabelle (${tab} Zeilen) — Tabellen sind fuer Menschen, nicht fuer Kontextfenster`);

  const zaun = (text.match(/```/g) || []).length;
  if (zaun >= 2) m.push(`${zaun / 2} Code-Block/Bloecke — die Gegenseite kann Befehle selbst ausfuehren, nenne den Ort`);

  for (const [re, was] of FLOSKELN) if (re.test(text)) m.push(`${was} — gehoert nicht in eine Maschinennachricht`);

  return m;
}

// Die Form ANSAGEN, bevor geschrieben wird -- nicht erst blocken, wenn die 3.000
// Zeichen schon dastehen. list_sessions kommt immer VOR send_message (man muss die
// Ziel-ID nachschlagen), also ist das der letzte Moment, in dem eine Erinnerung noch
// Schreibarbeit spart statt sie zu verwerfen. [Leons Einwand, 03.08.2026:
// "es spart ja keine Schreibtokens. Wieso wird denn ueberhaupt so eine lange
// Nachricht erst geschrieben?"]
function vorwarnen() {
  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      additionalContext:
        "FORM DER NAECHSTEN SITZUNGS-NACHRICHT (wird beim Senden erzwungen):\n" +
        "      <Fakt> — <was sich fuer DICH aendert>.\n" +
        "      Beleg: <datei:zeile | commit | befehl>\n" +
        "      Zu tun: <eine Sache>            (weglassen, wenn nichts zu tun ist)\n" +
        "Keine Ueberschriften, Tabellen, Code-Bloecke, kein Dank/Lob/Entschuldigung.\n" +
        "Verweis statt Inhalt — die Gegenseite kann lesen. Ziel ~300 Zeichen, Blockade ab 900.",
    },
  }));
  process.exit(0);
}

function main(roh) {
  let d;
  try { d = JSON.parse(roh || "{}"); } catch { process.exit(0); }
  const werkzeug = String(d.tool_name || "");
  if (/list_sessions/.test(werkzeug)) vorwarnen();
  if (!/send_message/.test(werkzeug)) process.exit(0);

  const text = String(d.tool_input?.message || "");
  if (!text) process.exit(0);

  const befunde = pruefe(text);
  const zuLang = text.length > HART;
  const grenzwertig = text.length > WEICH && befunde.length > 0;
  if (!zuLang && !grenzwertig) process.exit(0);

  console.error(
    `sessionpost-guard: Nachricht an eine andere Sitzung ist ${text.length} Zeichen ` +
    `(Schwelle ${zuLang ? HART : WEICH}).\n` +
    (befunde.length ? "  " + befunde.join("\n  ") + "\n" : "") +
    "\nDie Form steht in commands/tell-session.md:\n" +
    "      <Fakt> — <was sich fuer DICH aendert>.\n" +
    "      Beleg: <datei:zeile | commit | befehl>\n" +
    "      Zu tun: <eine Sache>\n" +
    "\nVerweis statt Inhalt: die Gegenseite kann lesen, hat dieselben Dateien.\n" +
    "Gemessen 03.08.2026: 63 Nachrichten, Median 1.378 Zeichen, 89.905 gesamt.\n" +
    "Ziel sind ~300."
  );
  process.exit(2);
}

if (process.stdin.isTTY) main("");
else { let e = ""; process.stdin.on("data", (c) => (e += c)); process.stdin.on("end", () => main(e)); }
