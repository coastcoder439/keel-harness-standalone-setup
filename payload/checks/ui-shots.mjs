#!/usr/bin/env node

// Fixed screenshot script for UI gates (B13, concept 3.5). One script instead of a script per package:
//   * only the states a gate names are photographed (a states file, no free-form steps),
//   * one browser per run, started only when at least one state needs a new picture,
//   * every picture is bound to the code state of the interface (dashboardBuildId, a content hash of the
//     sources `next build` reads): same code state, the picture stays; changed code state, only the named
//     states are photographed again; a picture of an older code state is rejected by --verify.
// Whether a picture looks good stays the Owner's acceptance; this script proves only which code it shows.
//
//   node checks/ui-shots.mjs --states <file.json> --out <dir> --base-url http://127.0.0.1:<port> (--code-root <dir> | --harness-dashboard) [--only a,b] [--force]
//   node checks/ui-shots.mjs --states <file.json> --out <dir> (--code-root <dir> | --harness-dashboard) --verify
//
// --code-root names the folder whose sources the preview is built from (a Next app: the folder with next.config.ts); a UI that is not
// the Harness dashboard must name it. --harness-dashboard is the one default and says so. Every page must answer 2xx and must carry the
// build id of that code state in its HTML (the dashboard's build id is the content hash of its sources), otherwise the preview shows
// another build and nothing is written.
//
// States file: {"states":[{"id":"home-light","path":"/","viewport":{"width":1440,"height":1000},
//   "theme":"light","waitFor":"main","click":"summary"}]}. The preview is started by the agent with
// preview_start (or `node dashboard/serve.mjs --port <n>`); this script never starts a server.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dashboardBuildId } from "../dashboard/scripts/build-id.mjs";

export const SHOT_SCHEMA = "keel-ui-shot.v1";
const harnessRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const THEMES = new Set(["light", "dark"]);
const DEFAULT_VIEWPORT = Object.freeze({ width: 1440, height: 1000 });

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const clean = (value) => Object.freeze({ ...value });

export class ShotError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function integerIn(value, low, high) {
  return Number.isInteger(value) && value >= low && value <= high;
}

// Validates and normalizes the states a gate names. Unknown fields are refused: the script stays fixed.
export function parseStates(input) {
  const document = typeof input === "string" ? JSON.parse(input) : input;
  const list = Array.isArray(document) ? document : document && document.states;
  if (!Array.isArray(list) || list.length === 0) throw new ShotError("NO_STATES", "the states file names no state");
  const seen = new Set();
  return list.map((raw) => {
    if (!raw || typeof raw !== "object") throw new ShotError("BAD_STATE", "a state is not an object");
    for (const key of Object.keys(raw)) {
      if (!["id", "path", "viewport", "theme", "waitFor", "click"].includes(key)) {
        throw new ShotError("BAD_STATE", `state ${raw.id}: unknown field ${key} (the script takes no free-form steps)`);
      }
    }
    if (typeof raw.id !== "string" || !ID_PATTERN.test(raw.id)) throw new ShotError("BAD_STATE", `state id must match ${ID_PATTERN}: ${raw.id}`);
    if (seen.has(raw.id)) throw new ShotError("BAD_STATE", `state ${raw.id} is named twice`);
    seen.add(raw.id);
    if (typeof raw.path !== "string" || !raw.path.startsWith("/") || raw.path.startsWith("//") || /[\s\\]/u.test(raw.path)) {
      throw new ShotError("BAD_STATE", `state ${raw.id}: path must be a local path starting with a single /`);
    }
    const viewport = raw.viewport === undefined ? DEFAULT_VIEWPORT : raw.viewport;
    if (!viewport || !integerIn(viewport.width, 200, 4000) || !integerIn(viewport.height, 200, 4000)) {
      throw new ShotError("BAD_STATE", `state ${raw.id}: viewport needs integer width and height between 200 and 4000`);
    }
    if (raw.theme !== undefined && !THEMES.has(raw.theme)) throw new ShotError("BAD_STATE", `state ${raw.id}: theme is light or dark`);
    for (const key of ["waitFor", "click"]) {
      if (raw[key] !== undefined && (typeof raw[key] !== "string" || !raw[key] || raw[key].length > 200)) {
        throw new ShotError("BAD_STATE", `state ${raw.id}: ${key} is one CSS selector`);
      }
    }
    return clean({
      id: raw.id, path: raw.path, viewport: clean({ width: viewport.width, height: viewport.height }),
      theme: raw.theme ?? null, waitFor: raw.waitFor ?? null, click: raw.click ?? null,
    });
  });
}

// A hash of everything that decides what the picture shows besides the code: if a gate changes a state, the picture is stale.
export function stateHash(state) {
  return sha256(JSON.stringify([state.id, state.path, state.viewport.width, state.viewport.height, state.theme, state.waitFor, state.click]));
}

export function codeStateOf(codeRoot) {
  if (!codeRoot) throw new ShotError("USAGE", "the code root of the interface is required (--code-root <dir>, or --harness-dashboard)");
  return dashboardBuildId(codeRoot);
}

export const harnessDashboardRoot = () => join(harnessRoot, "dashboard");

const imageFile = (dir, id) => join(dir, `${id}.png`);
const recordFile = (dir, id) => join(dir, `${id}.shot.json`);

function readRecord(dir, id) {
  try { return JSON.parse(readFileSync(recordFile(dir, id), "utf8")); } catch { return null; }
}

// Why a picture is good or not, for one state. null reason means: the picture shows this code state and this state.
function judge(state, dir, codeState) {
  if (!existsSync(imageFile(dir, state.id))) return { code: "MISSING_IMAGE" };
  const record = readRecord(dir, state.id);
  if (!record || record.schema !== SHOT_SCHEMA) return { code: "MISSING_RECORD" };
  if (record.codeState !== codeState) return { code: "STALE_CODE_STATE", detail: `picture shows ${record.codeState}, code is ${codeState}` };
  if (record.stateHash !== stateHash(state)) return { code: "STATE_CHANGED" };
  if (record.sha256 !== sha256(readFileSync(imageFile(dir, state.id)))) return { code: "IMAGE_TAMPERED" };
  return null;
}

function select(states, only) {
  if (!only || only.length === 0) return states;
  const byId = new Map(states.map((state) => [state.id, state]));
  return only.map((id) => {
    if (!byId.has(id)) throw new ShotError("UNKNOWN_STATE", `state ${id} is not named in the states file (only named states are photographed)`);
    return byId.get(id);
  });
}

export function planShots({ states, only, dir, codeState, force = false }) {
  return select(states, only).map((state) => {
    const verdict = force ? { code: "FORCED" } : judge(state, dir, codeState);
    return { id: state.id, action: verdict ? "take" : "reuse", reason: verdict ? verdict.code : "SAME_CODE_STATE" };
  });
}

// The gate check: every named state has a picture of the current code state; a picture without a named state is refused too.
export function verifyShots({ states, dir, codeState }) {
  const problems = [];
  for (const state of states) {
    const verdict = judge(state, dir, codeState);
    if (verdict) problems.push({ id: state.id, ...verdict });
  }
  const named = new Set(states.map((state) => state.id));
  if (existsSync(dir)) {
    for (const name of readdirSync(dir)) {
      const match = /^(.+)\.png$/u.exec(name);
      if (match && !named.has(match[1])) problems.push({ id: match[1], code: "UNNAMED_IMAGE" });
    }
  }
  return { ok: problems.length === 0, codeState, problems };
}

export function checkBaseUrl(baseUrl) {
  let url;
  try { url = new URL(baseUrl); } catch { throw new ShotError("BAD_BASE_URL", `base url is not a URL: ${baseUrl}`); }
  if (url.protocol !== "http:" || !LOCAL_HOSTS.has(url.hostname)) {
    throw new ShotError("BAD_BASE_URL", "pictures are taken only from a local preview (http://127.0.0.1, localhost or [::1])");
  }
  return url.origin;
}

async function launchChromium() {
  const { chromium } = await import("playwright");
  return chromium.launch();
}

// One browser for all states that need a picture; none when everything can be reused.
export async function takeShots({ states, only, dir, codeState, baseUrl, force = false, launch = launchChromium }) {
  const plan = planShots({ states, only, dir, codeState, force });
  const todo = plan.filter((entry) => entry.action === "take");
  if (todo.length === 0) return { codeState, plan, taken: [] };
  const origin = checkBaseUrl(baseUrl);
  mkdirSync(dir, { recursive: true });
  const byId = new Map(states.map((state) => [state.id, state]));
  const browser = await launch();
  const taken = [];
  try {
    for (const entry of todo) {
      const state = byId.get(entry.id);
      const context = await browser.newContext({ viewport: state.viewport, colorScheme: state.theme ?? "no-preference" });
      try {
        const page = await context.newPage();
        const response = await page.goto(origin + state.path, { waitUntil: "networkidle" });
        if (!response || !response.ok()) {
          throw new ShotError("BAD_RESPONSE", `state ${state.id}: ${origin + state.path} did not answer 2xx (${response ? response.status() : "no response"}); no picture written`);
        }
        // The preview must be the build of this code state: the page carries its build id.
        const html = await page.content();
        if (!String(html).includes(codeState)) {
          throw new ShotError("STALE_SERVER", `state ${state.id}: the preview at ${origin} does not carry build ${codeState}; start it from the current code`);
        }
        if (state.waitFor) await page.waitForSelector(state.waitFor, { state: "visible" });
        if (state.click) await page.click(state.click);
        const bytes = await page.screenshot({ fullPage: true });
        writeFileSync(imageFile(dir, state.id), bytes);
        writeFileSync(recordFile(dir, state.id), JSON.stringify({
          schema: SHOT_SCHEMA, id: state.id, codeState, stateHash: stateHash(state), sha256: sha256(bytes), bytes: bytes.length,
        }, null, 2) + "\n");
        taken.push(state.id);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  return { codeState, plan, taken };
}

function parseArgs(argv) {
  const options = { only: [], force: false, verify: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--force") options.force = true;
    else if (flag === "--verify") options.verify = true;
    else if (flag === "--harness-dashboard") options.harnessDashboard = true;
    else if (["--states", "--out", "--base-url", "--only", "--code-root"].includes(flag)) {
      const value = argv[index += 1];
      if (value === undefined) throw new ShotError("USAGE", `${flag} needs a value`);
      if (flag === "--only") options.only = value.split(",").filter(Boolean);
      else options[flag.slice(2).replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase())] = value;
    } else throw new ShotError("USAGE", `unknown argument ${flag}`);
  }
  if (!options.states || !options.out) throw new ShotError("USAGE", "needs --states <file> and --out <dir>");
  if (!options.codeRoot === !options.harnessDashboard) {
    throw new ShotError("USAGE", "name the code of the interface: exactly one of --code-root <dir> or --harness-dashboard");
  }
  return options;
}

export async function main(argv = process.argv.slice(2), out = (line) => process.stdout.write(line + "\n")) {
  const options = parseArgs(argv);
  const states = parseStates(readFileSync(resolve(options.states), "utf8"));
  const dir = resolve(options.out);
  const codeState = codeStateOf(options.codeRoot ? resolve(options.codeRoot) : harnessDashboardRoot());
  if (options.verify) {
    const result = verifyShots({ states, dir, codeState });
    out(JSON.stringify(result));
    return result.ok ? 0 : 1;
  }
  if (!options.baseUrl) throw new ShotError("USAGE", "taking pictures needs --base-url");
  const result = await takeShots({ states, only: options.only, dir, codeState, baseUrl: options.baseUrl, force: options.force });
  out(JSON.stringify(result));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then((code) => { process.exitCode = code; }, (error) => {
    process.stderr.write(`ui-shots: ${error.code ? error.code + ": " : ""}${error.message}\n`);
    process.exitCode = 2;
  });
}
