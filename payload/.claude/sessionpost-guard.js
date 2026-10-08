#!/usr/bin/env node
// PreToolUse-Hook: Nachrichten ZWISCHEN Sitzungen sind abgestellt (Owner-Entscheid 27.08.2026).
//
// WARUM ES DAS GIBT
// Gemessen an einer Sitzung: 63 Nachrichten an andere Sitzungen, rund 22.000 Token in FREMDE
// Kontextfenster. Die Form-Regeln allein aenderten nichts -- Regeln sind KONTEXT, keine
// Durchsetzung (offizielle Doku: "To block an action regardless of what Claude decides, use a
// PreToolUse hook instead"). Senden ist ein echter Werkzeugaufruf und deshalb erzwingbar.
//
// WAS GEPRUEFT WIRD
// Genau eine Sache: mcp__ccd_session_mgmt__send_message wird gesperrt, mit dem Weg ueber
// docs/session-notes und /tell-session. Alles andere, auch list_sessions, geht durch (Exit 0).
// Die frueheren Laengen-/Struktur-Pruefungen und der Hinweis bei list_sessions
// sind entfernt: die Pruefung lief seit dem Entscheid nie mehr, der Hinweis war veraltet.
//
// Der Waechter bleibt aktiv und sperrt weiter send_message: das ist eine lebende Owner-Entscheidung
// (27.08.2026) und wird nicht zurueckgezogen. Weggefallen ist nur der Teil zu list_sessions.
// Durchlass bis zum Zurueckziehen durch P5: der Matcher (send_message|list_sessions) bleibt in
// .claude/settings.json und .codex/hooks.json eingetragen, weil das Update heute keine Hooks
// entfernt; nur fuer list_sessions ist der Waechter ein reiner Durchlass (Exit 0). P5 darf nur den
// list_sessions-Teil des Matchers zurueckziehen (Matcher dann: send_message), nicht die Sende-Sperre.
//
// AUFRUF    PreToolUse, matcher: mcp__ccd_session_mgmt__(send_message|list_sessions)
// RUECKGABE 0 = durch · 2 = blockiert (mit Begruendung auf stderr)

const fs = require("node:fs");

const GUARD_TARGET = ".claude/sessionpost-guard.js";

// Inline deny transport (identical in every PreToolUse guard; guard-parity E5): a missing
// sibling module must never turn a denial into an allow. Under the Codex hook runner a
// JSON deny with exit 0 survives Windows PowerShell, which maps a native exit 2 to 1.
// Every other error of the hook process denies the same way (guard-parity A9, fail closed): the
// two handlers are armed here, before any helper module loads, so a failure while loading, a throw
// inside the decision and an unhandled rejection all end in block(). Only the hook main program is
// armed; a library require and --self-test are not. KEEL_GUARD_TEST_THROW forces an error for the
// tests: "1" throws at load, "reject" leaves an unhandled rejection, "late" throws after the input ended.
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
if (require.main === module && !process.argv.some((arg) => arg === "--self-test" || arg === "--selbsttest")) {
  const failClosed = (error) => {
    try {
      block(GUARD_TARGET.replace(/^.*\//u, "").replace(/\.c?js$/u, "") + ": internal error; tool blocked: " +
        ((error && error.message) || error));
    } catch { process.exit(2); }
  };
  process.on("uncaughtException", failClosed);
  process.on("unhandledRejection", failClosed);
  const forced = process.env.KEEL_GUARD_TEST_THROW;
  if (forced === "reject") Promise.reject(new Error("forced test error"));
  if (forced === "late") process.stdin.once("end", () => { throw new Error("forced test error"); });
  if (forced === "1") throw new Error("forced test error");
}
// End inline deny transport

let ownerHandoff;
let guardRoutes;
try {
  ownerHandoff = require("../harness-core/guards/owner-handoff.cjs");
  guardRoutes = require("../harness-core/guards/guard-routes.cjs");
} catch (error) {
  if (require.main === module) block("sessionpost-guard: dependency load failed; tool blocked: " + error.message);
  throw error;
}

function main(roh) {
  let d;
  try { d = JSON.parse(roh || "{}"); } catch { return block("sessionpost-guard: invalid hook input; tool blocked"); }
  const denial = hookDecision(d);
  return denial === null ? process.exit(0) : block(denial);
}

// The decision of one hook call (package P5, A1): null lets the tool pass, a string is the denial text. The hook main
// program and the one guard process (.claude/pretool-guards.js) both use it.
function hookDecision(d) {
  const werkzeug = String(d?.tool_name || "");
  if (!/send_message/.test(werkzeug)) return null;

  // [Owner-Entscheid 27.08.2026, Paket session-messages] Senden ist ABGESTELLT --
  // nicht wegen der Laenge, sondern wegen der Unterbrechung: die Nachricht erscheint
  // beim Owner im Vordergrund und loest beim Empfaenger sofort Arbeit aus. Belegter
  // Fall 26.08.2026 (Meldung zu pollution-warn.js riss eine laufende Owner-Aufgabe
  // auseinander). Ersatz ohne Verlust: Datei-Ablage + Anzeige beim Sitzungsstart
  // (session-roles.js, Funktion notizen()).
  // The denial itself must not depend on the Owner template (guard-parity A9).
  let vorlage;
  try {
    vorlage = ownerHandoff.handoffText({ what: "Nachricht an eine andere Sitzung",
      route: "Notiz per /tell-session",
      ownerAction: "Senden zwischen Sitzungen hat der Owner am 27.08.2026 abgestellt; braucht die andere Sitzung " +
        "den Befund sofort, tippt der Owner ihn dort selbst ein." });
  } catch (error) {
    vorlage = "(Owner-Vorlage nicht erzeugbar: " + error.message + ")";
  }
  return (
    "sessionpost-guard: Nachrichten ZWISCHEN Sitzungen sind abgestellt " +
    "[Owner-Entscheid 27.08.2026].\n" +
    "Lege den Befund stattdessen ab -- die Zielsitzung sieht ihn bei ihrem naechsten Start:\n" +
    "  docs/session-notes/<ziel-rolle>.md, Eintrag im Format\n" +
    "      ## <JJJJ-MM-TT> — von <deine Rolle>\n" +
    "      <Fakt> — <was sich fuer DICH aendert>.\n" +
    "      Beleg: <datei:zeile | commit | befehl>\n" +
    "      Zu tun: <eine Sache>\n" +
    "Ablauf steht in .claude/commands/tell-session.md.\n" +
    guardRoutes.referenceLine("sessionpost-guard", "Senden abgestellt") + "\n" +
    // Senden ist eine Owner-Entscheidung, keine Luecke: kein Befehl, sondern der Weg, den der
    // Owner selbst hat (guard-parity E9).
    vorlage
  );
}

function selfTest() {
  const spawn = (tool) => require("node:child_process").spawnSync(process.execPath, [__filename], {
    input: JSON.stringify({ tool_name: tool, tool_input: { message: "x" } }), encoding: "utf8",
    env: { ...process.env, KEEL_HARNESS_ROOT: "", KEEL_HOOK_TARGET: "", KEEL_GUARD_TEST_THROW: "" },
  }).status;
  const cases = [
    ["sending between sessions blocks", "mcp__ccd_session_mgmt__send_message", 2],
    ["listing sessions passes", "mcp__ccd_session_mgmt__list_sessions", 0],
    ["another tool passes", "mcp__ccd_session_mgmt__get_session", 0],
  ];
  let failed = 0;
  for (const [name, tool, status] of cases) {
    const ok = spawn(tool) === status;
    if (!ok) failed += 1;
    process.stdout.write((ok ? "ok  " : "FAIL") + " " + name + "\n");
  }
  process.stdout.write(String(cases.length - failed) + "/" + String(cases.length) + " passed\n");
  return failed;
}

if (require.main === module && (process.argv.includes("--self-test") || process.argv.includes("--selbsttest"))) {
  process.exit(selfTest() ? 1 : 0);
}

if (require.main === module) {
  if (process.stdin.isTTY) main("");
  else { let e = ""; process.stdin.on("data", (c) => (e += c)); process.stdin.on("end", () => main(e)); }
}

module.exports = { hookDecision, selfTest };
