#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { acquireDashboardRuntimeLease, materializeDashboardRuntime } from "./runtime-archive.mjs";

const dashboardRoot = path.dirname(fileURLToPath(import.meta.url));
const harnessRoot = path.resolve(dashboardRoot, "..");
const runtimeRoot = materializeDashboardRuntime({ dashboardRoot, harnessRoot });
const serverFile = path.join(runtimeRoot, "server.js");
const lease = acquireDashboardRuntimeLease({ harnessRoot, runtimeRoot });

function parsePort(argv) {
  const index = argv.indexOf("--port");
  const value = index >= 0 ? argv[index + 1] : process.env.PORT || "4190";
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Ungueltiger Dashboard-Port: ${JSON.stringify(value)}`);
  }
  return port;
}

const port = parsePort(process.argv.slice(2));
let child;
try {
  child = spawn(process.execPath, [serverFile], {
    cwd: runtimeRoot,
    env: {
      ...process.env,
      HOSTNAME: "127.0.0.1",
      PORT: String(port),
      NODE_ENV: "production",
      KEEL_HARNESS_ROOT: harnessRoot,
      KEEL_HARNESS_REPOSITORY_ROOT: harnessRoot,
    },
    stdio: "inherit",
    windowsHide: true,
  });
  lease.updateChild(child.pid);
} catch (error) {
  lease.release();
  throw error;
}

let stopping = false;
function stop(signal) {
  if (stopping || child.exitCode !== null) return;
  stopping = true;
  child.kill(signal);
}
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => stop(signal));
}
child.once("error", (error) => {
  lease.release();
  console.error(`Dashboard-Runtime konnte nicht gestartet werden: ${error.message}`);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  lease.release();
  if (signal && !stopping) console.error(`Dashboard-Runtime endete durch ${signal}`);
  process.exitCode = Number.isInteger(code) ? code : signal && stopping ? 0 : 1;
});
