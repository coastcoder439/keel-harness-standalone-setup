#!/usr/bin/env node
// Package-aware Stop-hook and installer integration tests. Zero dependencies. Node 16+.

import assert from "node:assert/strict";
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { initRepository } from "./helpers/git-repo.mjs";
import { emitTestCounts } from "./helpers/test-counts.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const stopHook = join(here, "..", "scripts", "stop-hook.mjs");
const installHooks = join(here, "..", "scripts", "install-hooks.mjs");
const dispatchCheck = join(here, "..", "scripts", "dispatch-check.mjs");
const packageCli = join(here, "..", "scripts", "package-cli.mjs");
const suiteRoot = mkdtempSync(join(tmpdir(), "unlazy-package-hook-"));

function repo(name, ignored = true) {
  const root = join(suiteRoot, name);
  initRepository(root);
  writeFileSync(join(root, ".gitignore"), ignored ? ".unlazy/\n" : "# missing runtime rule\n", "utf8");
  return root;
}

function packageText(packageId, fanout = false) {
  const acceptance = fanout
    ? "- C1 -> GATES.md:G1: Stop observes this exact root gate.\n- C2 -> gates/leaf-a.md:L1: Dispatch owns the declared leaf."
    : "- C1 -> GATES.md:G1: Stop observes this exact bundle gate.";
  const attachment = fanout
    ? `### Depth Tree

- ROOT GATES.md <- none: Root Stop outcome.
- LEAF gates/leaf-a.md <- GATES.md: Dispatch leaf outcome.`
    : "Package hook fixture.";
  return `# Work package: ${packageId}

**Problem:** Stop routing must not cross package or repository boundaries.
**Intent:** Resolve the active package from runtime identity.
**Goal:** Stop and installer behavior is deterministic and fail-safe.

## Plan

1. [x] Exercise the package-aware hook.

## Status

Hook fixture is active.

## Abnahme

${acceptance}

## Abschluss

Coverage: ${fanout ? "2/2" : "1/1"} contract outcomes mapped; 0/${fanout ? "2" : "1"} met.
Fulfillment: nicht erfuellt - close has not run.
Geprueft gegen: pending hook test.
Offen: Gate and close.

## Anhang

${attachment}
`;
}

function gateText(met = false, id = "G1", owns = "") {
  return `# Gates: package hook

${owns ? `OWNS: ${owns}\n\n` : ""}- [${met ? "x" : " "}] ${id}: this package is ready to stop
  EVIDENCE: ${met ? "measured by package-hook-tests" : "pending"}
`;
}

function bundle(root, packageId, met = false, fanout = false) {
  const directory = join(root, "docs", "packages", packageId);
  mkdirSync(join(directory, "gates"), { recursive: true });
  writeFileSync(join(directory, "PACKAGE.md"), packageText(packageId, fanout), "utf8");
  writeFileSync(join(directory, "GATES.md"), gateText(met), "utf8");
  if (fanout) writeFileSync(join(directory, "gates", "leaf-a.md"), gateText(met, "L1", "src/leaf-a/**"), "utf8");
  else writeFileSync(join(directory, "gates", ".gitkeep"), "", "utf8");
}

function run(script, root, args = [], input = null) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    input: input === null ? undefined : JSON.stringify(input),
    encoding: "utf8",
    windowsHide: true,
    timeout: 60000,
    env: { ...process.env, UNLAZY_PACKAGE: "", UNLAZY_SCOPE: "" },
  });
}

function activate(root, packageId, scope, session = "") {
  const args = ["activate", "--root", root, "--package", packageId, "--scope", scope];
  if (session) args.push("--session", session);
  const result = run(packageCli, root, args);
  assert.equal(result.status, 0, result.stderr + result.stdout);
}

function hook(root, args = [], payload = {}) {
  return run(stopHook, root, args, { cwd: root, session_id: "hook-session", ...payload });
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test("pinned hook blocks only its exact bundle with package-qualified ids", () => {
  const root = repo("pinned");
  bundle(root, "alpha");
  bundle(root, "beta", true);
  activate(root, "alpha", "alpha-scope");
  activate(root, "beta", "beta-scope");

  const blocked = hook(root, ["--package", "alpha", "--scope", "alpha-scope"]);
  assert.equal(blocked.status, 0, blocked.stderr + blocked.stdout);
  assert.match(blocked.stdout, /"decision":"block"/);
  assert.match(blocked.stdout, /alpha\/docs\/packages\/alpha\/GATES\.md:G1/);
  assert.doesNotMatch(blocked.stdout, /docs\/packages\/beta/);
  assert.match(blocked.stdout, /\.::alpha, scope alpha-scope/);

  const wrongPair = hook(root, ["--package", "alpha", "--scope", "beta-scope"]);
  assert.doesNotMatch(wrongPair.stdout, /"decision":"block"/);
  assert.match(wrongPair.stdout, /not active in --scope/);
});

test("session binding resolves one package while unresolved multi-scope routing fails open", () => {
  const root = repo("session");
  bundle(root, "alpha");
  bundle(root, "beta");
  activate(root, "alpha", "alpha-scope", "session-alpha");
  activate(root, "beta", "beta-scope", "session-beta");

  const ambiguous = hook(root, [], { session_id: "unknown" });
  assert.doesNotMatch(ambiguous.stdout, /"decision":"block"/);
  assert.match(ambiguous.stdout, /multiple active scopes/);

  const selected = hook(root, [], { session_id: "session-beta" });
  assert.match(selected.stdout, /"decision":"block"/);
  assert.match(selected.stdout, /\.::beta, scope beta-scope/);
  assert.doesNotMatch(selected.stdout, /docs\/packages\/alpha/);
});

test("payload.cwd stops at the nearest child repository instead of inheriting a parent package", () => {
  const parent = repo("nested-parent");
  bundle(parent, "alpha");
  activate(parent, "alpha", "main");
  const child = join(parent, "child");
  initRepository(child);
  const result = hook(child);
  assert.doesNotMatch(result.stdout, /"decision":"block"/);
  assert.match(result.stdout, /no package target/);
});

test("invalid package.ref lets Stop proceed while doctor reports the same defect as red", () => {
  const root = repo("invalid-ref");
  bundle(root, "alpha");
  activate(root, "alpha", "broken");
  rmSync(join(root, ".unlazy", "broken", "package.ref"));

  const stopped = hook(root, ["--scope", "broken"]);
  assert.equal(stopped.status, 0, stopped.stderr + stopped.stdout);
  assert.doesNotMatch(stopped.stdout, /"decision":"block"/);
  assert.match(stopped.stdout, /missing package\.ref/);
  assert.match(stopped.stdout, /doctor/);

  const doctor = run(packageCli, root, ["doctor", "--root", root, "--scope", "broken", "--json"]);
  assert.equal(doctor.status, 2, doctor.stderr + doctor.stdout);
  assert.match(doctor.stderr, /missing package\.ref/);
});

test("dispatch participates in the semantic hook guard and stop_hook_active ends a hook cycle", () => {
  const root = repo("dispatch");
  bundle(root, "alpha", true, true);
  activate(root, "alpha", "main");
  const opened = run(dispatchCheck, root, ["open", "--root", root, "--package", "alpha",
    "--scope", "main", "--wave", "ready-1", "--leaf", "leaf-a"]);
  assert.equal(opened.status, 0, opened.stderr + opened.stdout);

  const blocked = hook(root, ["--package", "alpha", "--scope", "main"]);
  assert.match(blocked.stdout, /"decision":"block"/);
  assert.match(blocked.stdout, /dispatch:ready-1/);

  const secondCycle = hook(root, ["--package", "alpha", "--scope", "main"], { stop_hook_active: true });
  assert.equal(secondCycle.stdout.trim(), "");
});

test("clearing a met package session preserves the required scope-local hook-state baseline", () => {
  const root = repo("hook-state");
  bundle(root, "alpha");
  activate(root, "alpha", "main");
  const first = hook(root, ["--package", "alpha", "--scope", "main"]);
  assert.match(first.stdout, /"decision":"block"/);

  writeFileSync(join(root, "docs", "packages", "alpha", "GATES.md"), gateText(true), "utf8");
  const cleared = hook(root, ["--package", "alpha", "--scope", "main"]);
  assert.equal(cleared.stdout.trim(), "");
  const statePath = join(root, ".unlazy", "main", "hook-state.json");
  assert.equal(existsSync(statePath), true);
  assert.deepEqual(JSON.parse(readFileSync(statePath, "utf8")), { schema: 1, sessions: {} });
});

test("installer validates pins, is idempotent, and uninstall preserves every foreign hook field", () => {
  const root = repo("installer");
  bundle(root, "alpha");
  bundle(root, "beta");
  activate(root, "alpha", "main");
  activate(root, "beta", "other");
  const deep = join(root, "src", "deep");
  mkdirSync(deep, { recursive: true });
  const foreign = {
    type: "command",
    command: "node foreign-stop.js --message=äöü",
    timeout: 17,
    metadata: { exact: "keep-me", order: [3, 1, 2] },
  };
  const initial = {
    custom: { untouched: true },
    hooks: { Stop: [{ matcher: "", customGroupField: "foreign", hooks: [foreign] }] },
  };
  const settingsPath = join(root, ".claude", "settings.local.json");
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(initial, null, 4) + "\n", "utf8");

  const installed = run(installHooks, deep, ["--package", "alpha", "--scope", "main"]);
  assert.equal(installed.status, 0, installed.stderr + installed.stdout);
  assert.equal(existsSync(join(deep, ".claude", "settings.local.json")), false);
  let settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  const handlers = settings.hooks.Stop.flatMap((group) => group.hooks);
  assert.equal(handlers.length, 2);
  const managed = handlers.find((handler) => handler.command.includes("--unlazy-hook-v2"));
  assert(managed, JSON.stringify(settings));
  assert.match(managed.command, /--package alpha --scope main/);
  assert.equal(managed.command.includes("--legacy"), false);
  assert.deepEqual(handlers.find((handler) => handler.command.includes("foreign-stop")), foreign);
  assert.equal(existsSync(settingsPath + ".unlazy.bak"), true);

  const beforeRepeat = readFileSync(settingsPath, "utf8");
  const repeated = run(installHooks, root, ["--scope", "main"]);
  assert.equal(repeated.status, 0, repeated.stderr + repeated.stdout);
  assert.match(repeated.stdout, /Already installed/);
  assert.equal(readFileSync(settingsPath, "utf8"), beforeRepeat);

  const switched = run(installHooks, root, ["--scope", "other"]);
  assert.equal(switched.status, 0, switched.stderr + switched.stdout);
  settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  const switchedHandlers = settings.hooks.Stop.flatMap((group) => group.hooks);
  assert.equal(switchedHandlers.filter((handler) => handler.command.includes("--unlazy-hook-v2")).length, 1);
  assert.match(switchedHandlers.find((handler) => handler.command.includes("--unlazy-hook-v2")).command,
    /--package beta --scope other/);
  assert.deepEqual(switchedHandlers.find((handler) => handler.command.includes("foreign-stop")), foreign);

  const removed = run(installHooks, root, ["--uninstall"]);
  assert.equal(removed.status, 0, removed.stderr + removed.stdout);
  settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  assert.deepEqual(settings.hooks.Stop[0].hooks[0], foreign);
  assert.equal(settings.hooks.Stop[0].customGroupField, "foreign");
  assert.deepEqual(settings.custom, { untouched: true });
  assert.equal(settings.hooks.Stop.flatMap((group) => group.hooks).some((handler) =>
    String(handler.command).includes("--unlazy-hook-v2")), false);
});

test("installer refuses an inactive pin or missing runtime ignore rule before settings mutation", () => {
  const inactive = repo("installer-inactive");
  bundle(inactive, "alpha");
  const noActive = run(installHooks, inactive, ["--package", "alpha", "--scope", "main"]);
  assert.equal(noActive.status, 2, noActive.stderr + noActive.stdout);
  assert.match(noActive.stderr, /active scope/);
  assert.equal(existsSync(join(inactive, ".claude", "settings.local.json")), false);

  const notIgnored = repo("installer-ignore", false);
  bundle(notIgnored, "alpha");
  const ignored = run(installHooks, notIgnored, []);
  assert.equal(ignored.status, 2, ignored.stderr + ignored.stdout);
  assert.match(ignored.stderr, /requires an effective exact \.unlazy/);
  assert.equal(existsSync(join(notIgnored, ".claude", "settings.local.json")), false);
});

let passed = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    passed += 1;
    console.log("ok   " + name);
  } catch (error) {
    console.error("FAIL " + name);
    console.error("     " + (error.stack || error.message));
    process.exitCode = 1;
  }
}

process.on("exit", () => {
  try { rmSync(suiteRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); } catch { /* best effort */ }
});

emitTestCounts("package-hook-tests", {
  tests: tests.length, pass: passed, fail: tests.length - passed, skip: 0,
});
if (!process.exitCode) console.log(`\n${passed}/${tests.length} passed, 0 skipped`);
