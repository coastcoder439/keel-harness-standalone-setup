// The fixed sections of the brief a work agent gets (package P6: A18, D6, D8, C3, C8, C9, D17).
//
// A work agent runs with `--setting-sources ""` (provider-runtime.mjs): it sees neither the instructions nor
// the rules of the Harness, only its brief. Whatever it has to know before it acts therefore stands in the
// brief, in a fixed order, and no section is cut to a length: the command index, the Owner's grants, the check
// of Owner statements, the reason of a restart, the way to publish and the execution rules. Every list that
// reaches the brief is read from the same source the guards read (command-index.mjs, the policy file), at the
// moment the brief is written; a retry writes the brief again and so renders the then current state.

import path from "node:path";
import { buildIndex, renderCompact, renderGrants } from "../guards/command-index.mjs";

const GIT_INTENT = "harness-core/git/git-intent.mjs";

// The brief text of a restart or reopen (C3): the orchestrator's reason, and what follows from it. Empty
// for a first start. `restart` is the record the executor keeps on the session entry ({ kind, from, reason }),
// so every later write of the brief (retry, rebind) renders it again.
export function restartSection(restart) {
  if (!restart || !restart.reason) return [];
  const reopened = restart.kind === "reopen";
  return [
    "## Why this brief exists: " + (reopened ? "reopen" : "restart"),
    "",
    "This brief replaces the one of session " + restart.from + ". The orchestrator ended that session with `" +
      (reopened ? "reopen" : "restart") + "` and gave this reason:",
    "",
    "> " + String(restart.reason).replace(/\s+/gu, " ").trim(),
    "",
    reopened
      ? "- The earlier result was accepted and is reopened for rework. The reason above says what is to change; the gates of the leaf contract decide what is still open."
      : "- The earlier session ended without a result the orchestrator accepted. The reason above says why; it is the first thing to put right.",
    "- Files inside OWNS may already hold the earlier session's work. Look at what is there before you write (read-only Git: status, diff, log), continue from it, and do not redo what is already correct.",
    "- The leaf contract below is the current one. Do not carry out an earlier plan from memory: it is not part of this brief.",
    "",
  ];
}

function publishLines(grants) {
  const projects = grants.error ? [] : grants.publishProjects.map((project) => path.join(grants.rootAbsolute, ...project.split("/")));
  const lines = [
    "- You do not publish. A leaf ends with its local gates; the orchestrator integrates the verified work and publishes it. Raw `git push` is blocked.",
  ];
  if (grants.error) {
    lines.push("- The Owner's list publishProjects is not readable (" + grants.file + " is invalid), so no project counts as released for publishing.");
  } else if (projects.length) {
    lines.push("- Projects the Owner released for publishing (publishProjects): " + projects.join(", ") + ". Only if your leaf contract orders publishing one of them, the way is " +
      "`node " + GIT_INTENT + " plan-publish --root <project>`, then `node " + GIT_INTENT + " publish --root <project> --receipt <plan receipt>`: " +
      "the current branch only, fast-forward only, never forced, no Owner sentence needed. A push that is not a fast-forward ends with PUBLISH_NOT_FAST_FORWARD: report it, do not work around it.");
  } else {
    lines.push("- The Owner has released no project for publishing (publishProjects is empty): nothing is published from here.");
  }
  lines.push("- Any other repository is published only after the package is closed and the Owner has said OK in the chat " +
    "(`package-executor.mjs publish --closure-receipt <receipt> --owner-ok \"<wording>\"`); that is the orchestrator's step. " +
    "If your work needs it, say \"awaits publication\" under Open: in your return.");
  return lines;
}

// Command index, Owner grants, check of Owner statements and the way to publish, as the brief's middle sections.
export function guidanceSections({ harnessRoot, sessionId }) {
  const index = buildIndex({ root: harnessRoot, sessionId });
  const grants = { ...index.grants, rootAbsolute: index.root };
  return [
    "## Command index (generated from the rules of the guards)",
    "",
    "You run without the instructions and rules of the Harness, so this index is what tells you the allowed way before a guard stops you. " +
      "Look here first; a denial points at the entry of this index again. Paths are relative to the Harness root named in the index; " +
      "your working directory may be another repository, so run the Harness tools by their absolute path under that root.",
    "",
    // Its own titles are one level below the brief's sections.
    renderCompact(index, { headings: "###", unbounded: true }).trimEnd(),
    "",
    "## Owner grants that apply to you",
    "",
    "Read from `" + grants.file + "` of the Harness root when this brief was written; the guards read the same file at every call. " +
      "What the Owner has not listed here is not granted.",
    "",
    renderGrants(grants),
    "",
    "## Check Owner statements before you carry them out (D8)",
    "",
    "Owner rule of the workbench: „Keine Owner-Aussage blind übernehmen“. Every instruction and wish of the Owner quoted above is checked with your own logic before you implement it: " +
      "does it solve the actual problem, what side effect does it have, is there a simpler way?",
    "",
    "- If it holds, say so in one sentence and implement it.",
    "- If it does not hold, name agreement, objection and alternative separately, each with its reason, before you implement. The Owner decides, and the decision is then carried out. " +
      "You cannot ask the Owner; put the three parts at the start of your return. If the objection concerns the whole leaf, return without implementing it (that is a result, not a failure); " +
      "if it concerns one part, implement the rest and name the part you left.",
    "- Never attribute a statement to the Owner that does not stand literally in the request above.",
    "",
    "## Publishing",
    "",
    ...publishLines(grants),
    "",
  ];
}

// The execution rules after the two existing ones about the write tool and the guard denial (kept word for word
// in package-executor.mjs): tests in the foreground (C9), build and test apart, no commit of your own,
// a return without a change is no success (C4), the same block three times is a halt (P12).
export function executionRules() {
  return [
    "- Run long tests in the foreground and wait for them in the same call. Never send a test to the background and end your turn with \"I am waiting\": nobody resumes you, and the return then reports a promise instead of a result.",
    "- Build and test are two calls: build, read its result, then test. Never chain them into one long call.",
    "- Never commit or push yourself (no checkpoint, no publish): the parent integrates the verified work of all leaves once, after its own local re-verification.",
    "- A return without a change in your OWNS is no success (RETURNED_UNCHANGED). If the work is already done or cannot be done, say exactly that and why; do not return a plan or a promise.",
    "- If a guard stops the same call with the same input three times in a row, stop: name the command and the code and return (repeated-block). Do not try the same input a fourth time.",
  ];
}
