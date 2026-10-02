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

const fs = require("node:fs");

const GUARD_TARGET = ".claude/sessionpost-guard.js";

// Inline deny transport (identical in every PreToolUse guard; guard-parity E5): a missing
// sibling module must never turn a denial into an allow. Under the Codex hook runner a
// JSON deny with exit 0 survives Windows PowerShell, which maps a native exit 2 to 1.
function block(message) {
  const reason = String(message).trim() || GUARD_TARGET + ": tool denied";
  if (process.env.KEEL_HARNESS_ROOT && process.env.KEEL_HOOK_TARGET === GUARD_TARGET) {
    fs.writeSync(1, JSON.stringify({ hookSpecificOutput: {
      hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason,
    } }) + "\n");
    process.exit(0);
  }
  fs.writeSync(2, reason + "\n");
  process.exit(2);
}

let ownerHandoff;
try {
  ownerHandoff = require("../harness-core/guards/owner-handoff.cjs");
} catch (error) {
  if (require.main === module) block("sessionpost-guard: dependency load failed; tool blocked: " + error.message);
  throw error;
}

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
  try { d = JSON.parse(roh || "{}"); } catch { return block("sessionpost-guard: invalid hook input; tool blocked"); }
  const werkzeug = String(d.tool_name || "");
  if (/list_sessions/.test(werkzeug)) vorwarnen();
  if (!/send_message/.test(werkzeug)) process.exit(0);

  const text = String(d.tool_input?.message || "");

  // [Owner-Entscheid 27.08.2026, Paket session-messages] Senden ist ABGESTELLT --
  // nicht wegen der Laenge, sondern wegen der Unterbrechung: die Nachricht erscheint
  // beim Owner im Vordergrund und loest beim Empfaenger sofort Arbeit aus. Belegter
  // Fall 26.08.2026 (Meldung zu pollution-warn.js riss eine laufende Owner-Aufgabe
  // auseinander). Ersatz ohne Verlust: Datei-Ablage + Anzeige beim Sitzungsstart
  // (session-roles.js, Funktion notizen()).
  block(
    "sessionpost-guard: Nachrichten ZWISCHEN Sitzungen sind abgestellt " +
    "[Owner-Entscheid 27.08.2026].\n" +
    "Lege den Befund stattdessen ab -- die Zielsitzung sieht ihn bei ihrem naechsten Start:\n" +
    "  docs/session-notes/<ziel-rolle>.md, Eintrag im Format\n" +
    "      ## <JJJJ-MM-TT> — von <deine Rolle>\n" +
    "      <Fakt> — <was sich fuer DICH aendert>.\n" +
    "      Beleg: <datei:zeile | commit | befehl>\n" +
    "      Zu tun: <eine Sache>\n" +
    "Ablauf steht in .claude/commands/tell-session.md.\n" +
    // Senden ist eine Owner-Entscheidung, keine Luecke: kein Befehl, sondern der Weg, den der
    // Owner selbst hat (guard-parity E9).
    ownerHandoff.handoffText({ what: "Nachricht an eine andere Sitzung",
      route: "Notiz per /tell-session",
      ownerAction: "Senden zwischen Sitzungen hat der Owner am 27.08.2026 abgestellt; braucht die andere Sitzung " +
        "den Befund sofort, tippt der Owner ihn dort selbst ein." })
  );
}

// Ab hier: die alte Laengen-/Struktur-Pruefung. Sie bleibt als Mass fuer die
// Notiz-Form erhalten (tell-session prueft seinen Text dagegen), wird aber nicht
// mehr am Sende-Werkzeug ausgeloest.
function altePruefung(text) {
  const befunde = pruefe(text);
  const zuLang = text.length > HART;
  const grenzwertig = text.length > WEICH && befunde.length > 0;
  if (!zuLang && !grenzwertig) return null;

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
  return "zu lang";
}

if (process.stdin.isTTY) main("");
else { let e = ""; process.stdin.on("data", (c) => (e += c)); process.stdin.on("end", () => main(e)); }
