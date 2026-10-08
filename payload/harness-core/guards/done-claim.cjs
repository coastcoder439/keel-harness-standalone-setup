"use strict";

// Does the last answer of an agent claim that its own work is finished? (Karte Arbeitsweise, 07.10.2026)
//
// Both Stop hooks block only at this moment and nowhere else: dod-guard asks the answer for its two report lines
// ("Geprueft gegen:" and "Offen:"), unlazy-stop asks the orchestrating session of a package whether the claim is true
// while gates or a dispatch wave are open. A claim is a statement about the agent's own work, so the detector reads
// sentences, not words: "Fertig." and "Das Paket ist abgeschlossen." are claims; "noch nicht fertig", "fast fertig",
// "Wenn du fertig bist", "Ist das erledigt?", a quoted word, a code span and a status label in code are not.
//
// The detector is a heuristic over German and English prose and says so: it never reads intent. A miss lets one turn end
// without the reminder; a false hit costs one reminder, because both hooks block once and not again in the same cycle.

const DONE_WORD = "(?:fertig(?:gestellt)?|erledigt|abgeschlossen|behoben|gefixt|gel(?:ö|oe)st|umgesetzt|implementiert|geschafft|" +
  "committet|gebaut|angepasst|gr(?:ü|ue)n|done|completed|finished|resolved)";
// A hyphen binds: "Fertig-Anspruch" and "done-claim.cjs" speak about a claim or a file, they claim nothing.
const LETTER = "[\\p{L}\\p{N}_-]";
const DONE = new RegExp("(?<!" + LETTER + ")" + DONE_WORD + "(?!" + LETTER + ")", "giu");
// English "fixed" is also an adjective ("a fixed list"): it counts only after an auxiliary, a subject or "all/now".
const FIXED = /(?<![\p{L}\p{N}_])(?:(?:is|are|was|were|been|be|it's|that's|now|all|got|i|we)\s+(?:have\s+|'ve\s+)?fixed|fixed\s+(?:it|this|that|the\s+(?:bug|issue|error)))(?![\p{L}\p{N}_])/iu;

// Words in front of the done word, inside the same clause, that make the sentence no statement of finished work:
// negation, "almost", future and condition ("wenn", "sobald", "bis", "once", "until"), and the aim of a clause.
// "noch" is none of them on its own ("Ich habe noch X angepasst" is a claim); in "noch nicht", "noch nichts" the second word
// negates. "damit" and "als" have their own, narrower rules below.
const QUALIFIERS = new Set([
  "nicht", "kein", "keine", "keinen", "keiner", "kaum", "nie", "niemals", "nichts", "nirgends", "weder",
  "fast", "beinahe", "bald", "gleich", "demnaechst", "demnächst", "sofort",
  "wenn", "falls", "sobald", "sowie", "solange", "bis", "ob", "um", "sollte", "soll", "sollen", "muss", "muessen", "müssen",
  "wird", "werde", "werden", "wuerde", "würde", "waere", "wäre",
  "not", "never", "no", "isn't", "aren't", "wasn't", "weren't", "hasn't", "haven't", "hadn't", "won't", "cannot", "can't", "yet",
  "almost", "nearly", "soon", "when", "once", "until", "till", "if", "unless", "whether", "before", "after", "will", "would", "should",
  "must", "need", "needs", "to",
]);
// "als erledigt markieren", "mark as done": "als"/"as" qualifies only right in front of the done word, so "Das Paket ist als
// Ganzes umgesetzt" stays a claim.
const LABEL_BEFORE = new Set(["als", "as"]);
// "damit" is the aim of a clause only with the verb at its end ("Damit das Paket abgeschlossen wird", "... werden kann");
// "Damit ist das Paket abgeschlossen" (verb in second place) is a claim.
const AIM_VERB_AFTER = new Set(["wird", "werden", "kann", "koennen", "können", "ist", "sind", "sei", "wurde", "wuerde", "würde",
  "werde", "muss", "soll", "darf"]);
// "als erledigt markieren", "mark as done": an instruction about a label, not a statement about the work.
const LABEL_AFTER = /^\s*(?:markier|setz|betracht|werten|ansehen|anseh|behandel|mark|flag|treat|consider|label|set)/iu;
// A statement about somebody else, with the addressee as the subject: "du bist fertig", "du hast es erledigt", "you are done".
// An object ("für dich", "dir", "for you") is no subject: "Ich habe es für dich erledigt" is a claim.
const ADDRESSEE_BEFORE = /(?<![\p{L}\p{N}_])(?<!(?:f(?:ü|ue)r|an|mit|bei|von|zu|for|to|with|from)\s+)(?:du|ihr|you|they)(?![\p{L}\p{N}_])/iu;

function stripQuoted(text) {
  return String(text)
    .replace(/```[\s\S]*?```/gu, " ")
    .replace(/~~~[\s\S]*?~~~/gu, " ")
    .replace(/`[^`\n]*`/gu, " ")
    .replace(/^[ \t]*>.*$/gmu, " ")
    .replace(/„[^“”"\n]{0,200}[“”"]/gu, " ")
    .replace(/"[^"\n]{0,200}"/gu, " ")
    .replace(/«[^»\n]{0,200}»/gu, " ")
    .replace(/\*\*([^*\n]*)\*\*/gu, "$1");
}

function tokensBefore(clause, index) {
  return clause.slice(0, index).toLowerCase().split(/[^\p{L}\p{N}_'’-]+/u).filter(Boolean).slice(-5);
}

// "Fertig ist es nicht", "Erledigt ist noch nichts": the negation may follow the done word.
const NEGATORS_AFTER = new Set(["nicht", "nichts", "kein", "keine", "keinen", "not", "never", "nothing"]);
function tokensAfter(clause, index) {
  return clause.slice(index).toLowerCase().split(/[^\p{L}\p{N}_'’-]+/u).filter(Boolean).slice(0, 3);
}

function clauseClaims(clause) {
  if (FIXED.test(clause)) {
    const words = tokensBefore(clause, clause.search(FIXED));
    if (!words.some((word) => QUALIFIERS.has(word) && word !== "to")) return true;
  }
  DONE.lastIndex = 0;
  for (let match = DONE.exec(clause); match; match = DONE.exec(clause)) {
    const before = tokensBefore(clause, match.index);
    if (before.some((word) => QUALIFIERS.has(word))) continue;
    if (LABEL_BEFORE.has(before.at(-1))) continue;
    const after = tokensAfter(clause, match.index + match[0].length);
    if (after.some((word) => NEGATORS_AFTER.has(word))) continue;
    if (before.includes("damit") && after.some((word) => AIM_VERB_AFTER.has(word))) continue;
    if (ADDRESSEE_BEFORE.test(clause.slice(0, match.index))) continue;
    if (LABEL_AFTER.test(clause.slice(match.index + match[0].length, match.index + match[0].length + 24))) continue;
    return true;
  }
  return false;
}

// The first sentence of the text that claims finished work, shortened for a message, or null.
function doneClaim(text, maxLength = 160) {
  if (typeof text !== "string" || !text.trim()) return null;
  const sentences = stripQuoted(text).match(/[^.!?\n]+[.!?…]*/gu) || [];
  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed || /\?\s*$/u.test(trimmed)) continue;
    // A report line ("Geprueft gegen: ...", "Offen: ...") is the answer to a claim, never the claim itself.
    if (/^(?:gepr(?:ue|ü)ft gegen|offen)\s*:/iu.test(trimmed)) continue;
    for (const clause of trimmed.split(/[,;:–—(]|\s-\s/u)) {
      if (clause.trim() && clauseClaims(clause)) return trimmed.length > maxLength ? trimmed.slice(0, maxLength - 3) + "..." : trimmed;
    }
  }
  return null;
}

function claimsDone(text) {
  return doneClaim(text) !== null;
}

module.exports = { claimsDone, doneClaim };
