#!/usr/bin/env node
// Bounded, observable child-process runner. Node 18+, zero dependencies.

import { existsSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const printable = (value) => String(value).replace(/[\x00-\x1f\x7f]/gu,
  (character) => `\\x${character.charCodeAt(0).toString(16).padStart(2, "0")}`);
const quote = (value) => /[\s"]/u.test(printable(value))
  ? '"' + printable(value).replaceAll('"', '\\"') + '"'
  : printable(value);

const childExited = (child) => child.exitCode !== null && child.exitCode !== undefined ||
  child.signalCode !== null && child.signalCode !== undefined;

function syncFailure(result) {
  if (!result) return "taskkill returned no result";
  if (result.error) return result.error.code || result.error.message || "taskkill spawn error";
  if (result.signal) return "taskkill signal " + result.signal;
  if (result.status !== 0) {
    const detail = (String(result.stdout || "") + " " + String(result.stderr || ""))
      .replace(/[\r\n\t]+/gu, " ").replace(/\s+/gu, " ").trim().slice(0, 300);
    return `taskkill exit ${String(result.status)}${detail ? `: ${detail}` : ""}`;
  }
  return null;
}

export function terminateTree(child, options = {}) {
  const platform = options.platform || process.platform;
  const spawnSyncImpl = options.spawnSyncImpl || spawnSync;
  const existsSyncImpl = options.existsSyncImpl || existsSync;
  if (!Number.isInteger(child?.pid) || child.pid <= 0) {
    return { ok: false, fallback: false, diagnostic: "child PID is unavailable" };
  }
  if (childExited(child)) return { ok: true, fallback: false, diagnostic: "child already exited" };

  if (platform !== "win32") {
    try {
      const requested = child.kill("SIGKILL");
      return requested === false
        ? { ok: false, fallback: false, diagnostic: "child kill returned false" }
        : { ok: true, fallback: false, diagnostic: null };
    } catch (error) {
      return { ok: false, fallback: false, diagnostic: "child kill failed: " + (error.code || error.message) };
    }
  }

  const systemRoot = options.env?.SystemRoot || options.env?.WINDIR ||
    process.env.SystemRoot || process.env.WINDIR || "C:\\Windows";
  const taskkill = options.taskkillPath || join(systemRoot, "System32", "taskkill.exe");
  let failure = null;
  if (!existsSyncImpl(taskkill)) failure = "trusted taskkill executable is unavailable";
  else {
    try {
      failure = syncFailure(spawnSyncImpl(taskkill, ["/PID", String(child.pid), "/T", "/F"], {
        encoding: "utf8",
        windowsHide: true,
        timeout: 10_000,
      }));
    } catch (error) {
      failure = error.code || error.message || "taskkill threw";
    }
  }
  if (!failure) return { ok: true, fallback: false, diagnostic: null, command: taskkill };
  if (childExited(child)) {
    return { ok: true, fallback: true, diagnostic: `${failure}; child already exited`, command: taskkill };
  }
  try {
    const requested = child.kill("SIGKILL");
    if (requested === false) {
      return { ok: false, fallback: true, diagnostic: `${failure}; child fallback returned false`, command: taskkill };
    }
    return { ok: true, fallback: true, diagnostic: `${failure}; child fallback requested`, command: taskkill };
  } catch (error) {
    return {
      ok: false,
      fallback: true,
      diagnostic: `${failure}; child fallback failed: ${error.code || error.message}`,
      command: taskkill,
    };
  }
}

export function runBounded(spec, dependencies = {}) {
  const timeoutMs = Number(spec.timeoutMs || 180_000);
  const heartbeatMs = Number(spec.heartbeatMs || 10_000);
  const drainMs = Number(spec.drainMs || 2_000);
  if (!spec.command || !Array.isArray(spec.args)) throw new Error("runBounded requires command and args");
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1_000) throw new Error("timeoutMs must be at least 1000");
  if (!Number.isFinite(heartbeatMs) || heartbeatMs < 1_000) throw new Error("heartbeatMs must be at least 1000");

  const startedAt = Date.now();
  const rendered = [spec.command, ...spec.args].map(quote).join(" ");
  process.stdout.write(`[START] ${spec.name || rendered}\n  cwd: ${spec.cwd || process.cwd()}\n  cmd: ${rendered}\n`);

  return new Promise((resolveResult) => {
    let child;
    try {
      child = spawn(spec.command, spec.args, {
        cwd: spec.cwd || process.cwd(),
        env: spec.env || process.env,
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      const stderr = error.stack || error.message;
      process.stderr.write(`[SPAWN-ERROR] ${error.message}\n`);
      resolveResult({
        name: spec.name || rendered, command: rendered, cwd: spec.cwd || process.cwd(),
        exitCode: 125, childExitCode: null, signal: null,
        durationMs: Date.now() - startedAt, timedOut: false, drainTimedOut: false,
        cleanupAttempted: false, cleanupFailed: false, cleanupFallback: false, cleanupDiagnostic: null,
        stdout: "", stderr,
      });
      return;
    }
    let stdout = "";
    let stderr = "";
    let exitCode = null;
    let exitSignal = null;
    let exitAt = null;
    let timedOut = false;
    let drainTimedOut = false;
    let cleanupAttempted = false;
    let cleanupFailed = false;
    let cleanupFallback = false;
    let cleanupDiagnostic = null;
    let settled = false;

    const append = (kind, chunk) => {
      const value = String(chunk);
      if (kind === "stdout") {
        stdout += value;
        process.stdout.write(value);
      } else {
        stderr += value;
        process.stderr.write(value);
      }
    };
    child.stdout.on("data", (chunk) => append("stdout", chunk));
    child.stderr.on("data", (chunk) => append("stderr", chunk));

    const finish = () => {
      if (settled) return;
      settled = true;
      clearInterval(heartbeat);
      clearTimeout(deadline);
      clearTimeout(drainDeadline);
      const durationMs = Date.now() - startedAt;
      const status = cleanupFailed ? 126 : timedOut ? 124 : Number.isInteger(exitCode) ? exitCode : 125;
      process.stdout.write(
        `[END] ${spec.name || rendered} exit=${status} durationMs=${durationMs}` +
        `${timedOut ? " timeout=true" : ""}${drainTimedOut ? " drainTimeout=true" : ""}` +
        `${cleanupFailed ? " cleanupFailed=true" : ""}\n`,
      );
      resolveResult({
        name: spec.name || rendered,
        command: rendered,
        cwd: spec.cwd || process.cwd(),
        exitCode: status,
        childExitCode: exitCode,
        signal: exitSignal,
        durationMs,
        timedOut,
        drainTimedOut,
        cleanupAttempted,
        cleanupFailed,
        cleanupFallback,
        cleanupDiagnostic,
        stdout,
        stderr,
      });
    };

    const heartbeat = setInterval(() => {
      const elapsed = Math.round((Date.now() - startedAt) / 1000);
      const state = exitAt === null ? "running" : "child-exited; draining inherited pipes";
      process.stdout.write(`[HEARTBEAT] ${spec.name || rendered} elapsed=${elapsed}s state=${state}\n`);
    }, heartbeatMs);
    heartbeat.unref();

    const deadline = setTimeout(() => {
      timedOut = true;
      process.stderr.write(`[TIMEOUT] ${spec.name || rendered} exceeded ${timeoutMs}ms; terminating child tree\n`);
      cleanupAttempted = true;
      let cleanup;
      try { cleanup = (dependencies.terminateTree || terminateTree)(child); }
      catch (error) {
        cleanup = { ok: false, fallback: false, diagnostic: error.code || error.message || "tree cleanup threw" };
      }
      cleanupFailed = cleanup?.ok !== true;
      cleanupFallback = cleanup?.fallback === true;
      cleanupDiagnostic = cleanup?.diagnostic || null;
      if (cleanupFailed) {
        const message = `[TREE-CLEANUP-FAILED] ${cleanupDiagnostic || "tree termination was not confirmed"}\n`;
        stderr += message;
        process.stderr.write(message);
      } else if (cleanupFallback) {
        process.stderr.write(`[TREE-CLEANUP-FALLBACK] ${cleanupDiagnostic || "direct child fallback requested"}\n`);
      }
      child.stdout.destroy();
      child.stderr.destroy();
      child.unref();
      // Deliberately referenced: child.unref() plus the unref'd deadline and
      // heartbeat leave this timer as the only live handle. Unref'd, Node exited
      // with code 0 before finish() ran: no [END] line, no failing exit code,
      // and a timed-out matrix phase silently ended the whole run (measured 10.09.2026).
      setTimeout(finish, 100);
    }, timeoutMs);
    deadline.unref();

    let drainDeadline = null;
    child.once("error", (error) => {
      stderr += error.stack || error.message;
      process.stderr.write(`[SPAWN-ERROR] ${error.message}\n`);
      finish();
    });
    child.once("exit", (code, signal) => {
      exitCode = code;
      exitSignal = signal;
      exitAt = Date.now();
      drainDeadline = setTimeout(() => {
        drainTimedOut = true;
        process.stderr.write(`[DRAIN-TIMEOUT] child exited but inherited output pipes stayed open; closing pipes\n`);
        child.stdout.destroy();
        child.stderr.destroy();
        finish();
      }, drainMs);
      drainDeadline.unref();
    });
    child.once("close", finish);
  });
}

async function main() {
  const argv = process.argv.slice(2);
  let timeoutMs = 180_000;
  let heartbeatMs = 10_000;
  while (argv.length && argv[0] !== "--") {
    const option = argv.shift();
    if (option === "--timeout-ms") timeoutMs = Number(argv.shift());
    else if (option === "--heartbeat-ms") heartbeatMs = Number(argv.shift());
    else throw new Error("unknown option " + option);
  }
  if (argv.shift() !== "--" || !argv.length) {
    throw new Error("usage: bounded-runner.mjs [--timeout-ms N] [--heartbeat-ms N] -- COMMAND [ARG ...]");
  }
  const command = argv.shift();
  const result = await runBounded({ command, args: argv, timeoutMs, heartbeatMs });
  process.exitCode = result.exitCode;
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error("bounded-runner: " + error.message);
    process.exitCode = 125;
  });
}
