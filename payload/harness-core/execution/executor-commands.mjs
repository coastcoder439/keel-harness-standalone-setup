// The command list of the package executor, in one place (package P6, D17). The executor builds its --help
// from it, so the help can never name a command the executor does not have or leave one out.
// Importing this module starts nothing: it holds data only.

export const EXECUTOR_USAGE_HEAD = "usage: package-executor.mjs <command> --root DIR --harness-root DIR --package ID --scope ID [options]";

// One entry per command line of the help. `usage` is exactly the text after the command name, a
// continuation line included, so the help stays byte for byte what it was.
export const EXECUTOR_COMMANDS = Object.freeze([
  { name: "next/start", usage: "--session ID [--leaf leaf-ID] [--provider codex|claude] [--model ID]\n" +
    "             [--effort low|medium|high] [--run RUN-PACKAGE] [--bootstrap-session ID]" },
  { name: "dispatch", usage: "--wave ID [--session ID ...] [--cost-budget-usd N] [--token-budget N] [--deadline-seconds S] [--max-turns N]" },
  { name: "heartbeat|liveness", usage: "--session ID" },
  { name: "abort|timeout", usage: "--session ID --reason TEXT" },
  { name: "abandon", usage: "--wave ID --reason TEXT" },
  { name: "retry", usage: "--session ID" },
  { name: "reassign", usage: "--session OLD --new-session NEW [--provider codex|claude]" },
  { name: "rebind", usage: "--session ID --reason TEXT" },
  { name: "rebind", usage: "--session OLD --new-session NEW --reason TEXT" },
  { name: "rebind", usage: "--leaf leaf-ID --new-session NEW --reason TEXT" },
  { name: "recover", usage: "--wave ABANDONED --replacement-wave COMPLETE" },
  { name: "recover", usage: "--wave ABANDONED" },
  { name: "restart", usage: "--session OLD --new-session NEW --reason TEXT [--provider codex|claude] [--model ID]" },
  { name: "reopen", usage: "--session OLD --new-session NEW --reason TEXT [--provider codex|claude] [--model ID]" },
  { name: "return", usage: "--session ID [--result-file PATH] [--accept-outside TEXT] [--timeout S]" },
  { name: "verify", usage: "--session ID [--timeout S]" },
  { name: "resume", usage: "--session ID | --leaf leaf-ID [--cost-budget-usd N] [--token-budget N] [--message TEXT]" },
  { name: "integrate", usage: "[--message TEXT] [--approve-checks] [--timeout S] [--ready-only]" },
  { name: "status", usage: "" },
  { name: "duty-assess", usage: "--gate LEDGER:GATE" },
  { name: "duty-add", usage: "--duty ID --owner TEXT --trigger TEXT --due-state open|due --gate LEDGER:GATE" },
  { name: "duty-resolve", usage: "--duty ID [--gate LEDGER:GATE]" },
  { name: "duty-waive", usage: "--duty ID (--owner-ok TEXT | --owner-ok-file FILE)" },
  { name: "orchestrator-takeover", usage: "--reason TEXT [--session ID]" },
  { name: "review-manual", usage: "--gate LEDGER:GATE (--evidence evidence/FILE | --evidence-file ABSOLUTE_PATH) --session ID" },
  { name: "close", usage: "[--owner-ok TEXT | --owner-ok-file FILE] [--message TEXT] [--timeout S] [--reverify]" },
  { name: "recover-close", usage: "--receipt CLOSE_RECEIPT [--message TEXT] [--timeout S]" },
  { name: "publish", usage: "--closure-receipt PATH (--owner-ok TEXT | --owner-ok-file FILE)" },
  { name: "cleanup-runtime", usage: "--root DIR [--harness-root DIR] [--unlazy-root DIR] [--apply] [--json]" },
]);

// The "commands:" block of the help.
export function executorCommandHelp() {
  return EXECUTOR_COMMANDS.map((command) => ("  " + command.name + " " + command.usage).trimEnd()).join("\n");
}

// A command line without its optional parts: what a call has to carry at least.
export function requiredUsage(command) {
  const required = command.usage.replace(/\s+/gu, " ").replace(/\[[^\]]*\]/gu, "").replace(/\s+/gu, " ").trim();
  return (command.name + " " + required).trim();
}
