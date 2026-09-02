#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { materializeDashboardRuntime } from "./runtime-archive.mjs";

const dashboardRoot = path.dirname(fileURLToPath(import.meta.url));
const harnessRoot = path.resolve(dashboardRoot, "..");
const runtimeRoot = materializeDashboardRuntime({ dashboardRoot, harnessRoot });
const serverFile = path.join(runtimeRoot, "server.js");

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object", "free-port probe returned no TCP address");
  const port = address.port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function readyResponse(url, child, diagnostics) {
  const deadline = Date.now() + 30_000;
  let lastError = null;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Dashboard-Runtime endete vor dem Healthcheck mit ${child.exitCode}: ${diagnostics()}`);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return response;
      lastError = new Error(`${url} antwortete mit HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await wait(100);
  }
  throw new Error(`Dashboard-Runtime wurde nicht bereit: ${lastError?.message || "Zeitlimit"}; ${diagnostics()}`);
}

async function assertStaticAssets(origin, html, diagnostics) {
  const references = [...new Set(
    [...html.matchAll(/(?:src|href)=["']([^"']+)["']/gu)]
      .map((match) => match[1])
      .filter((reference) => reference.startsWith("/_next/static/") && /\.(?:css|js)$/iu.test(reference)),
  )];
  assert.ok(references.some((reference) => reference.endsWith(".css")), "Dashboard HTML references no CSS asset");
  assert.ok(references.some((reference) => reference.endsWith(".js")), "Dashboard HTML references no JavaScript asset");
  for (const reference of references) {
    const response = await fetch(`${origin}${reference}`, { signal: AbortSignal.timeout(2_000) });
    assert.equal(response.status, 200, `Dashboard asset ${reference} returned HTTP ${response.status}: ${diagnostics()}`);
  }
  return references.length;
}

async function stop(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    wait(5_000),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
  if (child.exitCode === null) {
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      wait(5_000),
    ]);
  }
}

assert.ok(existsSync(serverFile), `kompilierte Dashboard-Runtime fehlt: ${serverFile}`);
assert.ok(runtimeRoot.startsWith(path.join(harnessRoot, ".keel-harness", "runtime", "dashboard") + path.sep),
  `Dashboard-Runtime liegt ausserhalb des Harness-Caches: ${runtimeRoot}`);
const port = await freePort();
let output = "";
const child = spawn(process.execPath, [serverFile], {
  cwd: runtimeRoot,
  env: {
    ...process.env,
    HOSTNAME: "127.0.0.1",
    PORT: String(port),
    NODE_ENV: "production",
    KEEL_HARNESS_ROOT: harnessRoot,
    KEEL_HARNESS_REPOSITORY_ROOT: harnessRoot,
  },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});
for (const stream of [child.stdout, child.stderr]) {
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => { output = (output + chunk).slice(-16_000); });
}

try {
  const origin = `http://127.0.0.1:${port}`;
  const home = await readyResponse(`${origin}/`, child, () => output.trim());
  assert.match(home.headers.get("content-type") || "", /text\/html/iu);
  const html = await home.text();
  assert.match(html, /<!DOCTYPE html>/iu, "Dashboard root is not the React HTML document");
  const rootAssetCount = await assertStaticAssets(origin, html, () => output.trim());
  const accountability = await readyResponse(`${origin}/accountability`, child, () => output.trim());
  const accountabilityHtml = await accountability.text();
  assert.match(accountabilityHtml, /<!DOCTYPE html>/iu, "Accountability route is not the React HTML document");
  const accountabilityAssetCount = await assertStaticAssets(origin, accountabilityHtml, () => output.trim());

  const stateResponse = await readyResponse(`${origin}/api/state`, child, () => output.trim());
  assert.match(stateResponse.headers.get("content-type") || "", /application\/json/iu);
  const state = await stateResponse.json();
  assert.equal(typeof state?.workspace, "string", "live Harness state has no repository identity");
  assert.ok(state?.seiten && typeof state.seiten === "object", "live Harness state has no Dashboard sections");
  assert.ok(Array.isArray(state?.bridge?.packages), "live Harness state has no package bridge");
  process.stdout.write(`DASHBOARD_RUNTIME_OK sections=${Object.keys(state.seiten).length} packages=${state.bridge.packages.length} rootAssets=${rootAssetCount} accountabilityAssets=${accountabilityAssetCount}\n`);
} finally {
  await stop(child);
}
