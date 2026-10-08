#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import packageContext from "./lib/package-context.cjs";
import ownerContract from "./lib/owner-contract.cjs";
import {
  assertPackageModeBoundary,
  resolveAllPackageTargets,
  resolvePackageTarget,
  resolveRepository,
} from "./lib/packages.mjs";
import { inspectPackageBundle, publicPackageStatus, PACKAGE_SCHEMA_VERSION } from "./lib/package-schema.mjs";
import { activatePackage, closePackage, renameWithRetry, transitionFollowUpDuty } from "./lib/package-lifecycle.mjs";
import { measureRepositoryPackages } from "./lib/package-measure.mjs";
import {
  addRoadmapMilestone,
  assignRoadmapPackage,
  PROJECT_ROADMAP_PATH,
  readProjectRoadmap,
  roadmapHint,
} from "./lib/project-roadmap.mjs";

const {
  assertNoLinkedComponent,
  listPackageBundles,
  resolvePackageBundle,
  validatePackageId,
} = packageContext;
const { harnessConfig } = ownerContract;

const HELP = `usage: package-cli.mjs <command> [options]

commands:
  create --package ID [--owner-request TEXT | --owner-request-file PATH] [--owner-source TEXT]
                            create one validated solo bundle atomically in the
                            standard format (Scope, Context); writes OWNER.md
                            when the repository requires an Owner contract or a
                            request is given (without one: skeleton to fill in)
  activate --package ID --scope ID   atomically bind package runtime
  list                      list bundles in exactly one repository
  measure                   status, fields and plan steps of every bundle in
                            one process (the one package measurement)
  lint --package ID         validate bundle schema and contract mapping
  status --package ID       emit separated PackageStatus dimensions
  doctor --package ID       validate one bundle and repository boundary
  doctor --all              validate every bundle in one repository
  duty-assess --package ID --scope ID --gate LEDGER:GATE
  duty-add --package ID --scope ID --duty ID --owner TEXT --trigger TEXT --due-state open|due --gate LEDGER:GATE
  duty-resolve --package ID --scope ID --duty ID [--gate LEDGER:GATE]
  duty-waive --package ID --scope ID --duty ID (--owner-ok TEXT | --owner-ok-file FILE)
  close --package ID --scope ID
                            check every gate at HEAD in a clean copy (gate-check --at;
                            a stored result of the same code state counts) and
                            atomically close the package
  roadmap                   show the optional project roadmap docs/roadmap.json
  roadmap-add --title TEXT [--due YYYY-MM-DD] [--package ID]   add a milestone
  roadmap-assign --package ID --milestone ID|none   link a package or unlink it

targeting:
  --root DIR                exact repository root (default: nearest root from cwd)
  --package ID              package bundle id
  --scope ID                active runtime scope
  --repo-key KEY            adapter display key (default .)
  --session ID              session binding used for target selection
  --timeout S               close gate timeout in seconds
  --jobs N                  close gate concurrency
  --shell PATH              close gate shell
  --owner-ok TEXT           Owner-OK wording (duty-waive): the Owner's own words, any length, any characters
  --owner-ok-file FILE      the same wording from a file in the session temp folder or the run folder (.unlazy)
  --reuse-integration SHA   accepted for older callers, changes nothing (SHA must be HEAD)
  --all                     every bundle (doctor only)
  --json                    emit JSON only

exit codes: 0 valid/met or successful mutation; 1 valid but incomplete;
            2 usage/schema/resolver/infrastructure; 3 ownership conflict.`;

const VALUE_OPTIONS = new Set([
  "--root", "--package", "--scope", "--repo-key", "--session",
  "--timeout", "--jobs", "--shell",
  "--duty", "--owner", "--trigger", "--due-state", "--gate", "--owner-ok", "--owner-ok-file", "--reuse-integration",
  "--owner-request", "--owner-request-file", "--owner-source",
  "--title", "--due", "--milestone",
]);
const FLAG_OPTIONS = new Set(["--all", "--json", "--help", "-h"]);

function parseArgs(argv) {
  const positional = [];
  const options = Object.create(null);
  let literals = false;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--") { literals = true; continue; }
    if (!literals && FLAG_OPTIONS.has(arg)) {
      const key = arg.replace(/^-+/, "");
      if (options[key] !== undefined) throw new Error("duplicate option " + arg);
      options[key] = true;
      continue;
    }
    if (!literals && arg.startsWith("--")) {
      const equals = arg.indexOf("=");
      const name = equals === -1 ? arg : arg.slice(0, equals);
      if (!VALUE_OPTIONS.has(name)) throw new Error("unknown option " + name);
      const key = name.slice(2);
      if (options[key] !== undefined) throw new Error("duplicate option " + name);
      const value = equals === -1 ? argv[++index] : arg.slice(equals + 1);
      if (value === undefined || value === "") throw new Error(name + " needs a value");
      options[key] = value;
      continue;
    }
    if (!literals && arg.startsWith("-")) throw new Error("unknown option " + arg);
    positional.push(arg);
  }
  return { positional, options };
}

function print(value, json) {
  if (json) process.stdout.write(JSON.stringify(value, null, 2) + "\n");
  else if (typeof value === "string") console.log(value);
  else console.log(JSON.stringify(value, null, 2));
}

function fail(message, options = {}) {
  if (options.json) {
    process.stderr.write(JSON.stringify({ schemaVersion: PACKAGE_SCHEMA_VERSION, error: { message } }) + "\n");
  } else {
    console.error("package-cli: " + message);
    console.error("run package-cli.mjs --help for usage");
  }
  process.exitCode = options.exitCode || 2;
}

function targetOptions(root, options) {
  return {
    root,
    packageId: options.package,
    scope: options.scope,
    repoKey: options["repo-key"] || ".",
    sessionId: options.session,
    // main() resolved this root through Git once for this run (B15): the target lookup does not ask again.
    verifiedRoot: true,
  };
}

function defaultPackage(packageId) {
  return `# Work package: ${packageId}

**Problem:** The package outcome has not been implemented yet.
**Intent:** Keep the work bounded by a versioned package and executable gate.
**Goal:** The declared package outcome is implemented and verified.
**Scope:** Drin: the declared package outcome and its verification. Nicht drin: work that the Goal does not name.
**Context:** Created by package-cli create; replace with the measured starting point before activation.

## Plan

1. [ ] Implement and verify the package goal.

## Status

Created as a schema-valid draft bundle.

## Abnahme

- C1 -> GATES.md:G1: The package goal is implemented and verified.

## Abschluss

Coverage: 1/1 contract outcomes mapped; 0/1 met.
Fulfillment: nicht erfuellt - implementation is pending.
Geprueft gegen: pending gate execution.
Offen: Plan and gate execution.

## Anhang

Created by package-cli schema version ${PACKAGE_SCHEMA_VERSION}.
`;
}

function defaultGates(packageId) {
  return `# Gates: ${packageId}

- [ ] G1: the package goal is implemented and verified
  EVIDENCE: pending
`;
}

function localDate(now = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate());
}

// OWNER.md written by create. With an Owner request the contract is complete;
// without one it is a skeleton whose placeholder keeps lint and doctor red
// (OWNER_REQUEST) until the original request is captured, so a repository
// with ownerContractRequired=true can create bundles without inventing one.
function defaultOwner(packageId, owner) {
  // The request ends at the owner-end marker, so a heading inside the Owner's text stays part of the text (C7).
  const section = ownerContract.formatOwnerRequestSection(owner.request
    ? owner.request.replace(/^﻿/u, "")
    : "<Copy the original Owner request here verbatim before activation.>");
  return `# Owner contract: ${packageId}

Schema: 1
Source: ${owner.source || (owner.request ? "package-cli create --owner-request" : "package-cli create (Owner request not captured yet)")}
Captured: ${localDate()}

${section}
## Requirements

- R1 -> C1: The declared package outcome is implemented and verified.
`;
}

// The Owner's wording from a file (--owner-ok-file): only from the session temp folder or the run folder (.unlazy) of
// the repository and never from inside a Git working tree, so a file of the working tree is never read as an Owner
// quote. Read as it is (UTF-8, or UTF-16 with a byte order mark); exactly one final line break belongs to the editor
// and falls away.
function readOwnerWordingFile(file, root) {
  const resolved = resolve(String(file));
  let info;
  try { info = lstatSync(resolved); } catch { throw new Error("--owner-ok-file does not exist: " + resolved); }
  if (info.isSymbolicLink() || !info.isFile() || (typeof info.nlink === "number" && info.nlink !== 1)) {
    throw new Error("--owner-ok-file must be a single-link regular file: " + resolved);
  }
  const real = realpathSync.native(resolved);
  const below = (base, path) => {
    const step = relative(base, path);
    return step !== "" && !step.startsWith("..") && !isAbsolute(step);
  };
  // A folder with .git between the allowed folder and the file makes it a file of that working tree, also when the
  // working tree itself lies in the temp folder (a clean copy, a release clone).
  const workingTreeBetween = (base, path) => {
    for (let directory = dirname(path); below(base, directory); directory = dirname(directory)) {
      if (existsSync(join(directory, ".git"))) return true;
    }
    return false;
  };
  const inside = [tmpdir(), join(root, ".unlazy")].some((folder) => {
    try {
      const base = realpathSync.native(folder);
      return below(base, real) && !workingTreeBetween(base, real);
    } catch { return false; }
  });
  if (!inside) throw new Error("--owner-ok-file must lie in the session temp folder or the run folder (.unlazy), not in a Git working tree: " + resolved);
  const bytes = readFileSync(real);
  let text;
  try {
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) text = new TextDecoder("utf-16le", { fatal: true }).decode(bytes.subarray(2));
    else text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes);
  } catch { throw new Error("--owner-ok-file is not valid UTF-8 text: " + resolved); }
  const wording = text.replace(/\r?\n$/u, "");
  if (!wording.trim()) throw new Error("--owner-ok-file holds no Owner wording");
  return wording;
}

function ownerRequestOption(options) {
  if (options["owner-request"] && options["owner-request-file"]) {
    throw new Error("use either --owner-request or --owner-request-file, not both");
  }
  let request = options["owner-request"] || null;
  if (options["owner-request-file"]) request = readFileSync(options["owner-request-file"], "utf8");
  if (request !== null) {
    if (request.includes("\0")) throw new Error("Owner request must not contain NUL");
    if (!request.trim()) throw new Error("Owner request must not be empty");
  }
  if (options["owner-source"] && /[\r\n]/u.test(options["owner-source"])) throw new Error("--owner-source must be one line");
  return { request, source: options["owner-source"] || null };
}

function createBundle(root, packageId, repoKey, owner = { request: null, source: null }) {
  const invalid = validatePackageId(packageId);
  if (invalid) throw new Error(invalid);
  const config = harnessConfig(root);
  const writeOwner = config.required || Boolean(owner.request);
  const packagesDir = join(root, "docs", "packages");
  const targetDir = join(packagesDir, packageId);
  const flatLegacy = join(packagesDir, packageId + ".md");
  if (existsSync(targetDir)) throw new Error("package target already exists: " + targetDir);
  if (existsSync(flatLegacy)) throw new Error("legacy flat package collides with target: " + flatLegacy);
  assertPackageModeBoundary(root, packageId);
  mkdirSync(packagesDir, { recursive: true });
  assertNoLinkedComponent(root, packagesDir);
  const temporary = join(packagesDir, "." + packageId + ".creating-" + randomBytes(8).toString("hex"));
  try {
    mkdirSync(temporary, { recursive: false });
    mkdirSync(join(temporary, "gates"), { recursive: false });
    writeFileSync(join(temporary, "PACKAGE.md"), defaultPackage(packageId), { encoding: "utf8", flag: "wx" });
    writeFileSync(join(temporary, "GATES.md"), defaultGates(packageId), { encoding: "utf8", flag: "wx" });
    writeFileSync(join(temporary, "gates", ".gitkeep"), "", { encoding: "utf8", flag: "wx" });
    if (writeOwner) {
      writeFileSync(join(temporary, "OWNER.md"), defaultOwner(packageId, owner), { encoding: "utf8", flag: "wx" });
    }
    const temporaryTarget = {
      repoRoot: root,
      repoKey,
      packageId,
      packageDir: temporary,
      packageFile: join(temporary, "PACKAGE.md"),
      gateFiles: [join(temporary, "GATES.md")],
      scope: null,
    };
    const inspected = inspectPackageBundle(temporaryTarget);
    // The only tolerated finding is the placeholder of an OWNER.md skeleton.
    const blocking = inspected.diagnostics.filter((item) => !(writeOwner && !owner.request && item.code === "OWNER_REQUEST"));
    if (blocking.length) {
      throw new Error("generated bundle failed schema: " + blocking.map((item) => item.message).join("; "));
    }
    // A virus scanner or indexer may hold the fresh directory for a moment (Windows EPERM/EBUSY/EACCES): retry.
    renameWithRetry(temporary, targetDir);
  } catch (error) {
    try { rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 30 }); } catch { /* preserve primary error */ }
    throw error;
  }
  return resolvePackageBundle(root, packageId, { assertRoot: false });
}

function packageStatus(root, options) {
  const target = resolvePackageTarget(targetOptions(root, options));
  return inspectPackageBundle(target);
}

function packageStatuses(root, options) {
  return resolveAllPackageTargets({ root, repoKey: options["repo-key"] || ".", verifiedRoot: true })
    .map((target) => inspectPackageBundle(target));
}

function collisionDiagnostics(root, packageId) {
  const flat = join(root, "docs", "packages", packageId + ".md");
  const directory = join(root, "docs", "packages", packageId, "PACKAGE.md");
  return existsSync(flat) && existsSync(directory)
    ? [{ code: "PACKAGE_LEGACY_COLLISION", file: "docs/packages/" + packageId + ".md", message: "flat package and bundle are both discoverable" }]
    : [];
}

// Roadmap commands take only their own options; no scope, no activation.
const ROADMAP_OPTIONS = {
  "roadmap": ["root", "json"],
  "roadmap-add": ["root", "json", "title", "due", "package"],
  "roadmap-assign": ["root", "json", "package", "milestone"],
};

function assertRoadmapOptions(command, options) {
  const allowed = ROADMAP_OPTIONS[command];
  const extra = Object.keys(options).filter((key) => !allowed.includes(key));
  if (extra.length) throw new Error(command + " does not accept " + extra.map((key) => "--" + key).join(", "));
}

function roadmapLines(roadmap) {
  const lines = [];
  if (!roadmap.present) {
    lines.push("no roadmap: " + PROJECT_ROADMAP_PATH + " is absent", roadmapHint());
  } else {
    if (!roadmap.milestones.length && !roadmap.diagnostics.length) lines.push("(no milestones)");
    for (const milestone of roadmap.milestones) {
      lines.push(milestone.id + " " + milestone.title + " (" + (milestone.due ? "due " + milestone.due : "no due date") +
        "): " + (milestone.packages.length ? milestone.packages.join(", ") : "(no packages)"));
    }
  }
  for (const diagnostic of roadmap.diagnostics) lines.push("  " + diagnostic.code + ": " + diagnostic.message);
  return lines.join("\n");
}

// The offer at create only checks existence; it never reads, parses or
// writes the roadmap, so create cannot fail because of it.
function roadmapOffer(root) {
  let present = true;
  try { lstatSync(join(root, "docs", "roadmap.json")); }
  catch (error) { if (error.code === "ENOENT" || error.code === "ENOTDIR") present = false; }
  let firstBundle = false;
  try { firstBundle = listPackageBundles(root, { assertRoot: false }).length === 0; }
  catch { firstBundle = false; }
  return { present, offered: firstBundle && !present };
}

let parsed;
try { parsed = parseArgs(process.argv.slice(2)); }
catch (error) { fail(error.message, { json: process.argv.includes("--json") }); }

if (!parsed) {
  // parse failure already set the exit code
} else if (parsed.options.help || parsed.options.h) {
  process.stdout.write(HELP + "\n");
} else {
  const { positional, options } = parsed;
  const command = positional[0];
  if (!command || positional.length > 2) {
    fail("exactly one command is required", { json: options.json });
  } else {
    if (!options.package && positional[1]) options.package = positional[1];
    try {
      const root = resolveRepository(options.root ? { root: options.root } : { cwd: process.cwd() });
      const repoKey = options["repo-key"] || ".";
      if (command === "create") {
        if (!options.package) throw new Error("create requires --package ID");
        if (options.all || options.scope) throw new Error("create does not accept --all or --scope");
        const offer = roadmapOffer(root);
        createBundle(root, options.package, repoKey, ownerRequestOption(options));
        const status = packageStatus(root, options);
        const pendingOwner = status.diagnostics.some((item) => item.code === "OWNER_REQUEST");
        const hint = offer.offered ? roadmapHint() : null;
        if (options.json) {
          print({ ...publicPackageStatus(status), projectRoadmap: { present: offer.present, offered: offer.offered, hint } }, true);
        } else {
          print("created docs/packages/" + status.packageId +
            (pendingOwner ? "; OWNER.md is a skeleton: capture the original Owner request before activation" : "") +
            (hint ? "\n" + hint : ""), false);
        }
      } else if (command === "activate") {
        if (!options.package || !options.scope) throw new Error("activate requires --package ID and --scope ID");
        if (options.all || options.timeout || options.jobs || options.shell) {
          throw new Error("activate does not accept --all, --timeout, --jobs, or --shell");
        }
        const result = await activatePackage({
          root,
          packageId: options.package,
          scope: options.scope,
          sessionId: options.session,
          repoKey,
        });
        if (options.json) print(result, true);
        else console.log((result.activated ? "activated " : "already active ") +
          result.repoKey + "::" + result.packageId + " in scope " + result.scope);
      } else if (command === "list") {
        if (options.package || options.scope || options.all) throw new Error("list does not accept --package, --scope, or --all");
        const statuses = packageStatuses(root, options).map(publicPackageStatus);
        if (options.json) {
          print({ schemaVersion: PACKAGE_SCHEMA_VERSION, repoRoot: root, repoKey, packageCount: statuses.length, packages: statuses }, true);
        } else if (!statuses.length) console.log("(no package bundles)");
        else for (const status of statuses) console.log(status.repoKey + "::" + status.packageId + " " + status.status);
      } else if (command === "measure") {
        if (options.package || options.scope || options.all) throw new Error("measure does not accept --package, --scope, or --all");
        const measured = measureRepositoryPackages({ root, repoKey, verifiedRoot: true });
        const packages = measured.packages;
        if (options.json) {
          print({ ...measured, repoRoot: root }, true);
        } else if (!packages.length) console.log("(no package bundles)");
        else {
          for (const item of packages) {
            console.log(item.repoKey + "::" + item.packageId + " " + item.status + " " + item.plan.done + "/" + item.plan.total);
          }
        }
      } else if (command === "lint" || command === "status") {
        if (options.all) throw new Error(command + " does not accept --all");
        if (!options.package && !options.scope) throw new Error(command + " requires --package ID or --scope ID");
        const status = packageStatus(root, options);
        const publicStatus = publicPackageStatus(status);
        print(options.json ? publicStatus : publicStatus, options.json);
        if (status.diagnostics.length) process.exitCode = 2;
        else if (command === "status" && status.status !== "closed" && status.status !== "closable") process.exitCode = 1;
      } else if (command === "doctor") {
        if (options.all && (options.package || options.scope)) throw new Error("doctor --all cannot be combined with --package or --scope");
        if (!options.all && !options.package && !options.scope) throw new Error("doctor requires --package ID, --scope ID, or --all");
        const statuses = options.all ? packageStatuses(root, options) : [packageStatus(root, options)];
        for (const status of statuses) status.diagnostics.push(...collisionDiagnostics(root, status.packageId));
        const valid = statuses.every((status) => status.diagnostics.length === 0);
        if (options.json) {
          print({
            schemaVersion: PACKAGE_SCHEMA_VERSION,
            repoRoot: root,
            repoKey,
            packageCount: statuses.length,
            valid,
            packages: statuses.map(publicPackageStatus),
          }, true);
        } else {
          for (const status of statuses) {
            console.log((status.diagnostics.length ? "INVALID " : "OK ") + status.repoKey + "::" + status.packageId);
            for (const diagnostic of status.diagnostics) console.log("  " + diagnostic.code + ": " + diagnostic.message);
          }
          if (!statuses.length) console.log("OK " + repoKey + " (0 packages)");
        }
        if (!valid) process.exitCode = 2;
      } else if (["duty-assess", "duty-add", "duty-resolve", "duty-waive"].includes(command)) {
        if (!options.package || !options.scope) throw new Error(command + " requires --package ID and --scope ID");
        if (options.all || options.session) throw new Error(command + " does not accept --all or --session");
        if (command === "duty-waive" && !options["owner-ok"] && !options["owner-ok-file"]) {
          throw new Error("duty-waive requires --owner-ok TEXT or --owner-ok-file FILE");
        }
        if (options["owner-ok"] && options["owner-ok-file"]) throw new Error("use either --owner-ok or --owner-ok-file, not both");
        const action = command.slice("duty-".length).replace("assess", "assess").replace("add", "add")
          .replace("resolve", "resolve").replace("waive", "waive");
        const result = await transitionFollowUpDuty({
          root,
          packageId: options.package,
          scope: options.scope,
          repoKey,
          action,
          dutyId: options.duty,
          owner: options.owner,
          trigger: options.trigger,
          dueState: options["due-state"],
          gate: options.gate,
          ownerOk: options["owner-ok-file"] ? readOwnerWordingFile(options["owner-ok-file"], root) : options["owner-ok"],
        });
        print(options.json ? result : result, options.json);
      } else if (command === "close") {
        if (!options.package || !options.scope) throw new Error("close requires --package ID and --scope ID");
        if (options.all || options.session) throw new Error("close does not accept --all or --session");
        const result = await closePackage({
          root,
          packageId: options.package,
          scope: options.scope,
          repoKey,
          timeoutSeconds: options.timeout,
          jobs: options.jobs,
          shell: options.shell,
          reuseIntegration: options["reuse-integration"],
        });
        if (options.json) print(result, true);
        else {
          if (result.gateOutput) console.log(result.gateOutput);
          console.log((result.recovered ? "recovered closed " : "closed ") +
            result.repoKey + "::" + result.packageId + "; released " + result.releasedLeases + " lease(s)");
        }
      } else if (command === "roadmap") {
        assertRoadmapOptions(command, options);
        const roadmap = readProjectRoadmap(root);
        if (options.json) print(roadmap, true);
        else console.log(roadmapLines(roadmap));
        if (roadmap.diagnostics.some((item) => item.code === "ROADMAP_INVALID")) process.exitCode = 2;
      } else if (command === "roadmap-add") {
        assertRoadmapOptions(command, options);
        if (options.title === undefined) throw new Error("roadmap-add requires --title TEXT");
        const result = addRoadmapMilestone(root, {
          title: options.title,
          due: options.due === undefined ? null : options.due,
          packageId: options.package === undefined ? null : options.package,
          expectedRevision: readProjectRoadmap(root).revision,
        });
        if (options.json) print(result, true);
        else {
          const milestone = result.milestone;
          console.log("added milestone " + milestone.id + " " + milestone.title +
            (milestone.packages.length ? " with package " + milestone.packages.join(", ") : ""));
        }
      } else if (command === "roadmap-assign") {
        assertRoadmapOptions(command, options);
        if (!options.package || !options.milestone) throw new Error("roadmap-assign requires --package ID and --milestone ID|none");
        const milestoneId = options.milestone === "none" ? null : options.milestone;
        const result = assignRoadmapPackage(root, {
          packageId: options.package,
          milestoneId,
          expectedRevision: readProjectRoadmap(root).revision,
        });
        if (options.json) print(result, true);
        else console.log(milestoneId === null
          ? "unlinked " + options.package + " from the roadmap"
          : "linked " + options.package + " to milestone " + milestoneId);
      } else {
        throw new Error("unknown command " + JSON.stringify(command));
      }
    } catch (error) {
      fail(error.message, { json: options.json, exitCode: error.exitCode });
    }
  }
}
