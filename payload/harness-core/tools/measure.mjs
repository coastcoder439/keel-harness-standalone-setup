#!/usr/bin/env node
// Messwerkzeug fuer Agenten (Paket shell-grants, A5): freier Arbeitsspeicher, Prozesse nach Namen
// und eine kurze Messreihe -- zum Beispiel, um vor einem Serverstart zu messen, ob der Speicher
// reicht. Es ist ein Werkzeug fuer Agenten, kein Dienst und keine Anzeige fuer den Owner: es misst
// einmal, schreibt genau ein JSON-Objekt auf stdout und endet. Es schreibt keine Datei, laeuft nicht
// im Hintergrund und braucht nur Bordmittel (Node und das Betriebssystem).
//
//   node harness-core/tools/measure.mjs ram
//       { "freeGb": 12.34, "totalGb": 31.9 }
//   node harness-core/tools/measure.mjs procs [--name <teil>]
//       { "filter": null, "processes": [{ "name", "count", "memoryMb" }], "totalCount", "totalMemoryMb" }
//   node harness-core/tools/measure.mjs watch --seconds <n> [--every <s>]
//       { "seconds", "every", "samples": [{ "t", "freeGb", "procs" }], "min": {...}, "max": {...} }
//
// Ein Fehler (falsche Argumente, Betriebssystem liefert nichts) ist ebenfalls genau ein JSON-Objekt
// { "error": "..." } auf stdout, mit Exitcode 2 (Aufruf) oder 1 (Messung).

import os from "node:os";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const GIB = 1024 ** 3;
const MIB = 1024 ** 2;
const DEFAULT_EVERY_SECONDS = 5;
const MAX_WATCH_SECONDS = 3600;
const MIN_EVERY_SECONDS = 0.2;
const MAX_SAMPLES = 2000;
const COMMAND_TIMEOUT_MS = 60_000;

// The subcommands, as the usage error names them; the command index (package P6) prints exactly this.
export const MEASURE_USAGE = "ram | procs [--name <part>] | watch --seconds <n> [--every <s>]";

class UsageError extends Error {}

const round = (value, digits) => Number(value.toFixed(digits));

// { freeGb, totalGb } with two decimals.
export function ram() {
  return { freeGb: round(os.freemem() / GIB, 2), totalGb: round(os.totalmem() / GIB, 2) };
}

function run(file, args) {
  return execFileSync(file, args, {
    encoding: "utf8", windowsHide: true, timeout: COMMAND_TIMEOUT_MS, maxBuffer: 128 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

// [{ name, bytes }] for every process of the machine. Windows asks Win32_Process once, other
// systems read `ps -A -o comm=,rss=` (rss in KiB).
export function listProcesses(platform = process.platform) {
  if (platform === "win32") {
    const script = "Get-CimInstance Win32_Process | Select-Object Name,WorkingSetSize | ConvertTo-Json -Compress";
    const text = run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]).trim();
    if (!text) return [];
    const parsed = JSON.parse(text);
    return (Array.isArray(parsed) ? parsed : [parsed])
      .filter((entry) => entry && typeof entry.Name === "string")
      .map((entry) => ({ name: entry.Name, bytes: Number(entry.WorkingSetSize) || 0 }));
  }
  const processes = [];
  for (const line of run("ps", ["-A", "-o", "comm=,rss="]).split(/\r?\n/u)) {
    const match = /^\s*(.+?)\s+([0-9]+)\s*$/u.exec(line);
    if (match) processes.push({ name: match[1], bytes: Number(match[2]) * 1024 });
  }
  return processes;
}

// The number of processes, cheap enough to ask every few seconds (the watch series).
export function countProcesses(platform = process.platform) {
  if (platform === "win32") {
    return run("tasklist.exe", ["/NH", "/FO", "CSV"]).split(/\r?\n/u).filter((line) => line.trim()).length;
  }
  return run("ps", ["-A", "-o", "pid="]).split(/\r?\n/u).filter((line) => line.trim()).length;
}

// Processes grouped by name, largest memory first. filter: a part of the name, any case.
export function groupProcesses(processes, filter = null, platform = process.platform) {
  const part = filter === null ? null : String(filter).toLowerCase();
  const groups = new Map();
  for (const entry of processes) {
    if (part !== null && !entry.name.toLowerCase().includes(part)) continue;
    const key = platform === "win32" ? entry.name.toLowerCase() : entry.name;
    const group = groups.get(key) || { name: entry.name, count: 0, bytes: 0 };
    group.count += 1;
    group.bytes += entry.bytes;
    groups.set(key, group);
  }
  const list = [...groups.values()].sort((left, right) => right.bytes - left.bytes || left.name.localeCompare(right.name, "en"))
    .map((group) => ({ name: group.name, count: group.count, memoryMb: round(group.bytes / MIB, 1) }));
  return {
    filter: part === null ? null : String(filter),
    processes: list,
    totalCount: list.reduce((sum, group) => sum + group.count, 0),
    totalMemoryMb: round(list.reduce((sum, group) => sum + group.memoryMb, 0), 1),
  };
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

// Measures ram and the process count every `every` seconds over `seconds` seconds.
export async function watch({ seconds, every = DEFAULT_EVERY_SECONDS, sample = () => ({ freeGb: ram().freeGb, procs: countProcesses() }) }) {
  const started = Date.now();
  const samples = [];
  for (let index = 0; ; index += 1) {
    const elapsed = (Date.now() - started) / 1000;
    samples.push({ t: round(elapsed, 1), ...sample() });
    const next = (index + 1) * every;
    if (next > seconds + 1e-9) break;
    const wait = started + next * 1000 - Date.now();
    if (wait > 0) await sleep(wait);
  }
  const pick = (choose, key) => choose(...samples.map((entry) => entry[key]));
  return {
    seconds, every, samples,
    min: { freeGb: pick(Math.min, "freeGb"), procs: pick(Math.min, "procs") },
    max: { freeGb: pick(Math.max, "freeGb"), procs: pick(Math.max, "procs") },
  };
}

// Reads `--name value` pairs; every other word is a usage error.
function readOptions(args, allowed) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!allowed.includes(arg)) throw new UsageError("unknown argument " + JSON.stringify(arg));
    if (arg in options) throw new UsageError(arg + " given twice");
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) throw new UsageError(arg + " needs a value");
    options[arg] = value;
    index += 1;
  }
  return options;
}

function positiveNumber(text, option, { integer, min, max }) {
  const value = Number(text);
  if (!/^[0-9]+(?:\.[0-9]+)?$/u.test(String(text)) || !Number.isFinite(value) || (integer && !Number.isInteger(value))) {
    throw new UsageError(option + " takes " + (integer ? "a whole number" : "a number") + ", not " + JSON.stringify(text));
  }
  if (value < min || value > max) throw new UsageError(option + " must lie between " + min + " and " + max);
  return value;
}

export async function main(argv) {
  const [command, ...rest] = argv;
  if (command === "ram") {
    if (rest.length) throw new UsageError("ram takes no arguments");
    return ram();
  }
  if (command === "procs") {
    const options = readOptions(rest, ["--name"]);
    if ("--name" in options && options["--name"] === "") throw new UsageError("--name needs a value");
    return groupProcesses(listProcesses(), "--name" in options ? options["--name"] : null);
  }
  if (command === "watch") {
    const options = readOptions(rest, ["--seconds", "--every"]);
    if (!("--seconds" in options)) throw new UsageError("watch needs --seconds <n>");
    const seconds = positiveNumber(options["--seconds"], "--seconds", { integer: true, min: 1, max: MAX_WATCH_SECONDS });
    const every = "--every" in options
      ? positiveNumber(options["--every"], "--every", { integer: false, min: MIN_EVERY_SECONDS, max: seconds })
      : Math.min(DEFAULT_EVERY_SECONDS, seconds);
    if (Math.floor(seconds / every) + 1 > MAX_SAMPLES) throw new UsageError("more than " + MAX_SAMPLES + " samples; raise --every");
    return watch({ seconds, every });
  }
  throw new UsageError("use: " + MEASURE_USAGE);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(JSON.stringify(await main(process.argv.slice(2))) + "\n");
  } catch (error) {
    process.stdout.write(JSON.stringify({ error: String(error && error.message || error) }) + "\n");
    process.exitCode = error instanceof UsageError ? 2 : 1;
  }
}
