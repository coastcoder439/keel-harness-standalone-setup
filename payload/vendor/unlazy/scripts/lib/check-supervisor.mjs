#!/usr/bin/env node
// Keep a stable process-group leader alive until CHECK stdio closes.
// Zero dependencies. Node 16+.

import { spawn } from "node:child_process";
import { basename } from "node:path";

const [shell, command] = process.argv.slice(2);
if (!shell || command === undefined) {
  console.error("unlazy-check-supervisor: expected resolved shell and CHECK command");
  process.exit(2);
}

let child;
let spawnError = null;

function splitSimple(commandLine) {
  if (/[;&|<>`\r\n]/u.test(commandLine)) return null;
  const values = [];
  const pattern = /"((?:\\.|[^"])*)"|'((?:\\.|[^'])*)'|([^\s]+)/gu;
  let consumed = "";
  for (const match of commandLine.matchAll(pattern)) {
    if (commandLine.slice(consumed.length, match.index).trim()) return null;
    values.push(match[1] ?? match[2] ?? match[3]);
    consumed = commandLine.slice(0, match.index + match[0].length);
  }
  if (commandLine.slice(consumed.length).trim() || !values.length) return null;
  const executable = basename(values[0]).toLowerCase();
  return executable === "node" || executable === "node.exe" ? values : null;
}

try {
  const direct = splitSimple(command);
  child = direct
    ? spawn(direct[0], direct.slice(1), {
      cwd: process.cwd(), shell: false, windowsHide: true, env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    })
    : spawn(command, {
      cwd: process.cwd(), shell, windowsHide: true, env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
} catch (error) {
  console.error("unlazy-check-supervisor: could not start CHECK: " + error.message);
  process.exit(127);
}

// Pipe instead of inheriting descriptors directly. Node's `close` event then
// waits for descendants that inherited the shell's stdout or stderr, keeping
// this detached supervisor alive as the original process-group identity.
child.stdout.pipe(process.stdout, { end: false });
child.stderr.pipe(process.stderr, { end: false });
child.once("error", (error) => { spawnError = error; });
process.on("message", (message) => {
  if (!message || message.type !== "terminate") return;
  try { child.kill("SIGKILL"); } catch { /* parent retains the hard-stop fallback */ }
});
child.once("close", (code, signal) => {
  if (process.connected) process.disconnect();
  if (spawnError) {
    console.error("unlazy-check-supervisor: CHECK spawn failed: " + spawnError.message);
    process.exitCode = 127;
    return;
  }
  if (Number.isInteger(code)) {
    process.exitCode = code;
    return;
  }
  console.error("unlazy-check-supervisor: CHECK ended by " + (signal || "unknown signal"));
  process.exitCode = 1;
});
