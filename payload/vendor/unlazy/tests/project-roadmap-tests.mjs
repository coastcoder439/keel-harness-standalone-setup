// Project roadmap: docs/roadmap.json read, add, move and remove through the
// module and package-cli, revision checks, invalid files never overwritten,
// vanished package links kept and removable, the roadmap offer at the first
// bundle of a repository, and a scale fixture with 2,000 linked packages.

import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  addRoadmapMilestone,
  assignRoadmapPackage,
  PROJECT_ROADMAP_PATH,
  PROJECT_ROADMAP_SCHEMA_VERSION,
  readProjectRoadmap,
  roadmapHint,
} from "../scripts/lib/project-roadmap.mjs";
import { initRepository } from "./helpers/git-repo.mjs";
import { emitTestCounts } from "./helpers/test-counts.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, "..", "scripts", "package-cli.mjs");
const suiteRoot = mkdtempSync(join(tmpdir(), "unlazy-project-roadmap-"));

const HINT = "optional: this project has no roadmap yet; plan milestones with package-cli roadmap-add " +
  "--title TEXT [--due YYYY-MM-DD] and link packages with package-cli roadmap-assign --package ID --milestone ID";

function repo(name) {
  const root = join(suiteRoot, name);
  initRepository(root);
  return root;
}

function bundle(root, packageId) {
  const directory = join(root, "docs", "packages", packageId);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "PACKAGE.md"), "# Work package: " + packageId + "\n", "utf8");
}

function roadmapFile(root) {
  return join(root, "docs", "roadmap.json");
}

function roadmapBytes(root) {
  return readFileSync(roadmapFile(root));
}

function writeRoadmapText(root, text) {
  mkdirSync(join(root, "docs"), { recursive: true });
  writeFileSync(roadmapFile(root), text, "utf8");
}

function run(root, ...args) {
  return spawnSync(process.execPath, [cli, ...args, "--root", root], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, UNLAZY_PACKAGE: "", UNLAZY_SCOPE: "" },
  });
}

function json(result) {
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function rejects(fn, code) {
  assert.throws(fn, (error) => {
    assert.equal(error.code, code, error.message);
    assert.equal(error.exitCode, 2);
    assert.ok(error.message.startsWith(code), error.message);
    return true;
  });
}

function packagesOf(roadmap) {
  return Object.fromEntries(roadmap.milestones.map((milestone) => [milestone.id, milestone.packages]));
}

let passed = 0;
let total = 0;
const test = (name, fn) => {
  total += 1;
  try {
    fn();
    passed += 1;
    console.log("ok   " + name);
  } catch (error) {
    console.error("FAIL " + name);
    console.error("     " + (error.stack || error.message));
    process.exitCode = 1;
  }
};

test("module constants and hint are the published API", () => {
  assert.equal(PROJECT_ROADMAP_SCHEMA_VERSION, 1);
  assert.equal(PROJECT_ROADMAP_PATH, "docs/roadmap.json");
  assert.equal(roadmapHint(), HINT);
});

test("(a) a missing roadmap reads as absent", () => {
  const root = repo("absent");
  assert.deepEqual(readProjectRoadmap(root), {
    schemaVersion: 1,
    path: "docs/roadmap.json",
    present: false,
    revision: "absent",
    milestones: [],
    diagnostics: [],
  });
  const text = run(root, "roadmap");
  assert.equal(text.status, 0, text.stderr);
  assert.equal(text.stdout, "no roadmap: docs/roadmap.json is absent\n" + HINT + "\n");
  assert.equal(existsSync(roadmapFile(root)), false);
});

test("(b) roadmap-add creates the file in the exact form, changes the revision and numbers m2", () => {
  const root = repo("add");
  bundle(root, "alpha");
  const first = json(run(root, "roadmap-add", "--title", "  Foundation  ", "--due", "2026-11-01", "--json"));
  assert.deepEqual(first.milestone, { id: "m1", title: "Foundation", due: "2026-11-01", packages: [] });
  const expectedFirst = JSON.stringify({
    schemaVersion: 1,
    milestones: [{ id: "m1", title: "Foundation", due: "2026-11-01", packages: [] }],
  }, null, 2) + "\n";
  assert.equal(roadmapBytes(root).toString("utf8"), expectedFirst);
  assert.ok(!roadmapBytes(root).includes("\r"), "roadmap must use LF");
  assert.match(first.roadmap.revision, /^[0-9a-f]{64}$/u);
  const second = json(run(root, "roadmap-add", "--title", "Release", "--package", "alpha", "--json"));
  assert.equal(second.milestone.id, "m2");
  assert.deepEqual(second.milestone, { id: "m2", title: "Release", due: null, packages: ["alpha"] });
  assert.notEqual(second.roadmap.revision, first.roadmap.revision);
  assert.equal(roadmapBytes(root).toString("utf8"), JSON.stringify({
    schemaVersion: 1,
    milestones: [
      { id: "m1", title: "Foundation", due: "2026-11-01", packages: [] },
      { id: "m2", title: "Release", due: null, packages: ["alpha"] },
    ],
  }, null, 2) + "\n");
  assert.deepEqual(readdirSync(join(root, "docs")).filter((name) => name.endsWith(".tmp")), []);
  const text = run(root, "roadmap");
  assert.equal(text.status, 0, text.stderr);
  assert.equal(text.stdout, "m1 Foundation (due 2026-11-01): (no packages)\nm2 Release (no due date): alpha\n");
});

test("(c) roadmap-assign moves a package from m1 to the end of m2", () => {
  const root = repo("move");
  for (const id of ["alpha", "beta", "gamma"]) bundle(root, id);
  json(run(root, "roadmap-add", "--title", "One", "--package", "alpha", "--json"));
  json(run(root, "roadmap-add", "--title", "Two", "--package", "beta", "--json"));
  json(run(root, "roadmap-assign", "--package", "gamma", "--milestone", "m1", "--json"));
  const moved = json(run(root, "roadmap-assign", "--package", "alpha", "--milestone", "m2", "--json"));
  assert.deepEqual(packagesOf(moved.roadmap), { m1: ["gamma"], m2: ["beta", "alpha"] });
  assert.deepEqual(packagesOf(readProjectRoadmap(root)), { m1: ["gamma"], m2: ["beta", "alpha"] });
  const before = roadmapBytes(root);
  const unchanged = assignRoadmapPackage(root, {
    packageId: "alpha", milestoneId: "m2", expectedRevision: readProjectRoadmap(root).revision,
  });
  assert.deepEqual(roadmapBytes(root), before);
  assert.deepEqual(packagesOf(unchanged.roadmap), { m1: ["gamma"], m2: ["beta", "alpha"] });
});

test("(d) --milestone none and milestoneId null unlink a package", () => {
  const root = repo("unlink");
  for (const id of ["alpha", "beta"]) bundle(root, id);
  json(run(root, "roadmap-add", "--title", "One", "--package", "alpha", "--json"));
  json(run(root, "roadmap-assign", "--package", "beta", "--milestone", "m1", "--json"));
  const viaCli = json(run(root, "roadmap-assign", "--package", "alpha", "--milestone", "none", "--json"));
  assert.deepEqual(packagesOf(viaCli.roadmap), { m1: ["beta"] });
  const viaApi = assignRoadmapPackage(root, {
    packageId: "beta", milestoneId: null, expectedRevision: readProjectRoadmap(root).revision,
  });
  assert.deepEqual(packagesOf(viaApi.roadmap), { m1: [] });
  const before = roadmapBytes(root);
  assignRoadmapPackage(root, { packageId: "beta", milestoneId: null, expectedRevision: viaApi.roadmap.revision });
  assert.deepEqual(roadmapBytes(root), before, "an unchanged unlink must not write");
});

test("(e) unknown packages and milestones are rejected with exit 2 and an unchanged file", () => {
  const root = repo("unknown");
  bundle(root, "alpha");
  json(run(root, "roadmap-add", "--title", "One", "--json"));
  const before = roadmapBytes(root);
  for (const packageId of ["missing", "../x"]) {
    const result = run(root, "roadmap-assign", "--package", packageId, "--milestone", "m1");
    assert.equal(result.status, 2, result.stdout);
    assert.match(result.stderr, /ROADMAP_PACKAGE_UNKNOWN/u);
    assert.deepEqual(roadmapBytes(root), before);
  }
  const added = run(root, "roadmap-add", "--title", "Two", "--package", "missing");
  assert.equal(added.status, 2);
  assert.match(added.stderr, /ROADMAP_PACKAGE_UNKNOWN/u);
  const milestone = run(root, "roadmap-assign", "--package", "alpha", "--milestone", "m9");
  assert.equal(milestone.status, 2);
  assert.match(milestone.stderr, /ROADMAP_MILESTONE_UNKNOWN/u);
  assert.deepEqual(roadmapBytes(root), before);
  const revision = readProjectRoadmap(root).revision;
  rejects(() => assignRoadmapPackage(root, { packageId: "../x", milestoneId: null, expectedRevision: revision }), "ROADMAP_PACKAGE_UNKNOWN");
  rejects(() => assignRoadmapPackage(root, { packageId: "alpha", milestoneId: "m9", expectedRevision: revision }), "ROADMAP_MILESTONE_UNKNOWN");
  assert.deepEqual(roadmapBytes(root), before);
});

test("(f) invalid titles and due dates are rejected", () => {
  const root = repo("inputs");
  const revision = readProjectRoadmap(root).revision;
  for (const title of ["   ", "x".repeat(121), "first\nsecond"]) {
    rejects(() => addRoadmapMilestone(root, { title, expectedRevision: revision }), "ROADMAP_TITLE");
  }
  assert.equal(addRoadmapMilestone(root, { title: "y".repeat(120), expectedRevision: revision }).milestone.title.length, 120);
  const current = readProjectRoadmap(root).revision;
  for (const due of ["2026-02-30", "1.10.2026"]) {
    rejects(() => addRoadmapMilestone(root, { title: "Dated", due, expectedRevision: current }), "ROADMAP_DUE");
    const result = run(root, "roadmap-add", "--title", "Dated", "--due", due);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /ROADMAP_DUE/u);
  }
  const blank = run(root, "roadmap-add", "--title", "   ");
  assert.equal(blank.status, 2);
  assert.match(blank.stderr, /ROADMAP_TITLE/u);
  assert.equal(readProjectRoadmap(root).milestones.length, 1);
  assert.throws(() => addRoadmapMilestone(root, { title: "No revision" }), TypeError);
});

test("(g) a stale revision is rejected with ROADMAP_CHANGED and nothing is written", () => {
  const root = repo("stale");
  bundle(root, "alpha");
  const stale = readProjectRoadmap(root).revision;
  addRoadmapMilestone(root, { title: "One", expectedRevision: stale });
  const before = roadmapBytes(root);
  rejects(() => addRoadmapMilestone(root, { title: "Two", expectedRevision: stale }), "ROADMAP_CHANGED");
  rejects(() => assignRoadmapPackage(root, { packageId: "alpha", milestoneId: "m1", expectedRevision: stale }), "ROADMAP_CHANGED");
  assert.deepEqual(roadmapBytes(root), before);
});

test("(h) an invalid roadmap is reported and never overwritten", () => {
  const cases = {
    "invalid-json": "{ not json\n",
    "invalid-schema": JSON.stringify({ schemaVersion: 1, milestones: [{ id: "m1", title: "One", due: null, packages: [], extra: 1 }] }, null, 2) + "\n",
  };
  for (const [name, text] of Object.entries(cases)) {
    const root = repo(name);
    bundle(root, "alpha");
    writeRoadmapText(root, text);
    const before = roadmapBytes(root);
    const roadmap = readProjectRoadmap(root);
    assert.equal(roadmap.present, true);
    assert.match(roadmap.revision, /^[0-9a-f]{64}$/u);
    assert.deepEqual(roadmap.milestones, []);
    assert.equal(roadmap.diagnostics.length, 1);
    assert.equal(roadmap.diagnostics[0].code, "ROADMAP_INVALID");
    assert.equal(roadmap.diagnostics[0].file, "docs/roadmap.json");
    rejects(() => addRoadmapMilestone(root, { title: "Two", expectedRevision: roadmap.revision }), "ROADMAP_INVALID");
    rejects(() => assignRoadmapPackage(root, { packageId: "alpha", milestoneId: null, expectedRevision: roadmap.revision }), "ROADMAP_INVALID");
    for (const args of [["roadmap-add", "--title", "Two"], ["roadmap-assign", "--package", "alpha", "--milestone", "none"]]) {
      const result = run(root, ...args);
      assert.equal(result.status, 2);
      assert.match(result.stderr, /ROADMAP_INVALID/u);
    }
    assert.deepEqual(roadmapBytes(root), before);
    const shown = run(root, "roadmap");
    assert.equal(shown.status, 2);
    assert.match(shown.stdout, /ROADMAP_INVALID/u);
    const shownJson = run(root, "roadmap", "--json");
    assert.equal(shownJson.status, 2);
    assert.equal(JSON.parse(shownJson.stdout).diagnostics[0].code, "ROADMAP_INVALID");
  }
  const schemaRules = [
    { schemaVersion: 2, milestones: [] },
    { schemaVersion: 1, milestones: {} },
    { schemaVersion: 1, milestones: [], extra: true },
    { schemaVersion: 1, milestones: [{ id: "m0", title: "One", due: null, packages: [] }] },
    { schemaVersion: 1, milestones: [{ id: "m1", title: "One", due: null, packages: [] }, { id: "m1", title: "Two", due: null, packages: [] }] },
    { schemaVersion: 1, milestones: [{ id: "m1", title: " One", due: null, packages: [] }] },
    { schemaVersion: 1, milestones: [{ id: "m1", title: "One", due: "2026-02-30", packages: [] }] },
    { schemaVersion: 1, milestones: [{ id: "m1", title: "One", due: null, packages: ["../x"] }] },
    { schemaVersion: 1, milestones: [{ id: "m1", title: "One", due: null, packages: ["a"] }, { id: "m2", title: "Two", due: null, packages: ["a"] }] },
  ];
  const root = repo("schema-rules");
  for (const document of schemaRules) {
    writeRoadmapText(root, JSON.stringify(document, null, 2) + "\n");
    const roadmap = readProjectRoadmap(root);
    assert.deepEqual(roadmap.diagnostics.map((item) => item.code), ["ROADMAP_INVALID"], JSON.stringify(document));
  }
});

test("(i) a vanished package stays linked with ROADMAP_PACKAGE_MISSING and can be unlinked", () => {
  const root = repo("vanished");
  bundle(root, "alpha");
  bundle(root, "beta");
  json(run(root, "roadmap-add", "--title", "One", "--package", "alpha", "--json"));
  json(run(root, "roadmap-assign", "--package", "beta", "--milestone", "m1", "--json"));
  rmSync(join(root, "docs", "packages", "alpha"), { recursive: true, force: true });
  const roadmap = readProjectRoadmap(root);
  assert.deepEqual(packagesOf(roadmap), { m1: ["alpha", "beta"] });
  assert.deepEqual(roadmap.diagnostics.map((item) => item.code), ["ROADMAP_PACKAGE_MISSING"]);
  assert.match(roadmap.diagnostics[0].message, /alpha/u);
  assert.match(roadmap.diagnostics[0].message, /m1/u);
  const shown = run(root, "roadmap");
  assert.equal(shown.status, 0, "a missing package alone keeps exit 0");
  assert.match(shown.stdout, /^ {2}ROADMAP_PACKAGE_MISSING: /mu);
  const relink = run(root, "roadmap-assign", "--package", "alpha", "--milestone", "m1");
  assert.equal(relink.status, 2);
  assert.match(relink.stderr, /ROADMAP_PACKAGE_UNKNOWN/u);
  const removed = json(run(root, "roadmap-assign", "--package", "alpha", "--milestone", "none", "--json"));
  assert.deepEqual(packagesOf(removed.roadmap), { m1: ["beta"] });
  assert.deepEqual(removed.roadmap.diagnostics, []);
});

test("(j) create offers a roadmap at the first bundle without writing one", () => {
  const root = repo("offer-text");
  const text = run(root, "create", "--package", "first");
  assert.equal(text.status, 0, text.stderr);
  assert.equal(text.stdout, "created docs/packages/first\n" + HINT + "\n");
  assert.equal(existsSync(roadmapFile(root)), false);
  const jsonRoot = repo("offer-json");
  const created = json(run(jsonRoot, "create", "--package", "first", "--json"));
  assert.equal(created.packageId, "first");
  assert.deepEqual(created.projectRoadmap, { present: false, offered: true, hint: HINT });
  assert.equal(existsSync(roadmapFile(jsonRoot)), false);
});

test("(k) no offer at the second bundle or when a roadmap exists", () => {
  const root = repo("no-offer");
  json(run(root, "create", "--package", "first", "--json"));
  const second = json(run(root, "create", "--package", "second", "--json"));
  assert.deepEqual(second.projectRoadmap, { present: false, offered: false, hint: null });
  const third = run(root, "create", "--package", "third");
  assert.equal(third.status, 0, third.stderr);
  assert.equal(third.stdout, "created docs/packages/third\n");
  const planned = repo("planned");
  writeRoadmapText(planned, "not even json\n");
  const withRoadmap = json(run(planned, "create", "--package", "first", "--json"));
  assert.deepEqual(withRoadmap.projectRoadmap, { present: true, offered: false, hint: null });
  const textual = run(planned, "create", "--package", "second");
  assert.equal(textual.stdout, "created docs/packages/second\n");
  assert.equal(readFileSync(roadmapFile(planned), "utf8"), "not even json\n");
});

test("(l) doctor --all is valid without a roadmap", () => {
  const root = repo("doctor");
  json(run(root, "create", "--package", "first", "--json"));
  const result = run(root, "doctor", "--all", "--json");
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(JSON.parse(result.stdout).valid, true);
  assert.equal(existsSync(roadmapFile(root)), false);
});

test("(m) a flat package file can be linked", () => {
  const root = repo("flat");
  mkdirSync(join(root, "docs", "packages"), { recursive: true });
  writeFileSync(join(root, "docs", "packages", "legacy.md"), "# Work package: legacy\n", "utf8");
  json(run(root, "roadmap-add", "--title", "One", "--json"));
  const linked = json(run(root, "roadmap-assign", "--package", "legacy", "--milestone", "m1", "--json"));
  assert.deepEqual(packagesOf(linked.roadmap), { m1: ["legacy"] });
  assert.deepEqual(linked.roadmap.diagnostics, []);
});

test("(n) roadmap --json prints the stored roadmap", () => {
  const root = repo("show-json");
  bundle(root, "alpha");
  const added = json(run(root, "roadmap-add", "--title", "One", "--due", "2026-12-31", "--package", "alpha", "--json"));
  const shown = json(run(root, "roadmap", "--json"));
  assert.deepEqual(shown, {
    schemaVersion: 1,
    path: "docs/roadmap.json",
    present: true,
    revision: added.roadmap.revision,
    milestones: [{ id: "m1", title: "One", due: "2026-12-31", packages: ["alpha"] }],
    diagnostics: [],
  });
});

test("roadmap commands reject options that are not theirs", () => {
  const root = repo("options");
  for (const args of [
    ["roadmap", "--scope", "s1"],
    ["roadmap", "--all"],
    ["roadmap-add", "--title", "One", "--session", "x"],
    ["roadmap-assign", "--package", "a", "--milestone", "m1", "--scope", "s1"],
  ]) {
    const result = run(root, ...args);
    assert.equal(result.status, 2, args.join(" "));
    assert.match(result.stderr, /does not accept/u);
  }
  assert.equal(existsSync(roadmapFile(root)), false);
});

test("(o) 50 milestones with 2,000 linked bundles round-trip in under 2 seconds", () => {
  const root = repo("scale");
  const ids = [];
  for (let index = 0; index < 2000; index++) {
    const id = "pkg-" + String(index).padStart(4, "0");
    ids.push(id);
    bundle(root, id);
  }
  const milestones = [];
  for (let index = 0; index < 50; index++) {
    milestones.push({ id: "m" + (index + 1), title: "Milestone " + (index + 1), due: null, packages: ids.slice(index * 40, index * 40 + 40) });
  }
  writeRoadmapText(root, JSON.stringify({ schemaVersion: 1, milestones }, null, 2) + "\n");
  const moved = ids[5];
  const started = process.hrtime.bigint();
  const before = readProjectRoadmap(root);
  assignRoadmapPackage(root, { packageId: moved, milestoneId: "m50", expectedRevision: before.revision });
  const after = readProjectRoadmap(root);
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  assert.ok(elapsedMs < 2000, "round trip took " + elapsedMs.toFixed(0) + " ms");
  assert.deepEqual(before.diagnostics, []);
  assert.deepEqual(after.diagnostics, []);
  const stored = JSON.parse(roadmapBytes(root).toString("utf8"));
  const all = stored.milestones.flatMap((milestone) => milestone.packages);
  assert.equal(all.length, 2000);
  assert.equal(new Set(all).size, 2000);
  assert.deepEqual(stored.milestones[49].packages, [...ids.slice(1960, 2000), moved]);
  assert.deepEqual(all.filter((id) => id !== moved), ids.filter((id) => id !== moved));
  console.log("     scale round trip " + elapsedMs.toFixed(0) + " ms");
});

rmSync(suiteRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
emitTestCounts("project-roadmap-tests", { tests: total, pass: passed, fail: total - passed, skip: 0 });
console.log(`project-roadmap-tests: ${passed}/${total} passed, 0 skipped`);
if (passed !== total) process.exitCode = 1;
