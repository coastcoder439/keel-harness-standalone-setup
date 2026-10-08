import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolvePackageTarget } from "../scripts/lib/packages.mjs";
import { inspectPackageBundle, parsePackageDocument } from "../scripts/lib/package-schema.mjs";
import { initRepository } from "./helpers/git-repo.mjs";
import { emitTestCounts } from "./helpers/test-counts.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, "..", "scripts", "package-cli.mjs");
const suiteRoot = mkdtempSync(join(tmpdir(), "unlazy-package-schema-"));

function repo(name) {
  const root = join(suiteRoot, name);
  initRepository(root);
  return root;
}

function packageText(packageId, options = {}) {
  const plan = options.plan || "1. [ ] Implement the observable outcome.";
  const status = options.status || "Draft package; work has not started.";
  const acceptance = options.acceptance || "- C1 -> GATES.md:G1: The observable outcome is verified.";
  const fulfillment = options.fulfillment || "nicht erfuellt - work remains.";
  const open = options.open || "Implementation and verification.";
  const sections = options.sections || ["Plan", "Status", "Abnahme", "Abschluss", "Anhang"];
  const bodies = {
    Plan: plan,
    Status: status,
    Abnahme: acceptance,
    Abschluss: `Coverage: contract mapping recorded.\nFulfillment: ${fulfillment}\nGeprueft gegen: bundle gates.\nOffen: ${open}`,
    Anhang: options.attachment || "No additional material.",
  };
  return `# Work package: ${packageId}

**Problem:** A concrete outcome is missing.
**Intent:** Build it under an executable acceptance contract.
**Goal:** The observable outcome is present and verified.

${sections.map((section) => `## ${section}\n\n${bodies[section]}`).join("\n\n")}
`;
}

function gateText(gates) {
  return `# Gates: fixture\n\n${gates.map((gate) => {
    const checked = gate.met ? "x" : " ";
    const evidence = gate.met ? "manual: fixture observed" : "pending";
    return `- [${checked}] ${gate.id}: ${gate.title || "observable fixture outcome"}\n  EVIDENCE: ${evidence}`;
  }).join("\n\n")}\n`;
}

function writeBundle(root, packageId, options = {}) {
  const directory = join(root, "docs", "packages", packageId);
  mkdirSync(join(directory, "gates"), { recursive: true });
  writeFileSync(join(directory, "PACKAGE.md"), options.package || packageText(packageId), "utf8");
  if (options.rootGates !== false) {
    writeFileSync(join(directory, "GATES.md"), options.rootGates || gateText([{ id: "G1", met: false }]), "utf8");
  }
  const sidecars = options.sidecars || {};
  for (const [name, value] of Object.entries(sidecars)) writeFileSync(join(directory, "gates", name), value, "utf8");
  if (options.gitkeep !== false && Object.keys(sidecars).length === 0) writeFileSync(join(directory, "gates", ".gitkeep"), "", "utf8");
  if (options.gitkeep === true && Object.keys(sidecars).length > 0) writeFileSync(join(directory, "gates", ".gitkeep"), "", "utf8");
  return resolvePackageTarget({ root, packageId, env: {} });
}

function inspect(root, packageId) {
  return inspectPackageBundle(resolvePackageTarget({ root, packageId, env: {} }));
}

function run(root, ...args) {
  return spawnSync(process.execPath, [cli, ...args, "--root", root], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, UNLAZY_PACKAGE: "", UNLAZY_SCOPE: "" },
  });
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
    console.error("     " + error.message);
    process.exitCode = 1;
  }
};

test("valid solo bundle keeps plan, gate, dispatch, and contract dimensions separate", () => {
  const root = repo("solo");
  writeBundle(root, "solo");
  const status = inspect(root, "solo");
  assert.equal(status.diagnostics.length, 0);
  assert.equal(status.status, "draft");
  assert.deepEqual(status.plan, { total: 1, done: 0, nextStep: 1 });
  assert.deepEqual(status.gates, { total: 1, met: 0, unmet: 1, handoff: 0 });
  assert.deepEqual(status.dispatch, { state: "idle", unfinished: 0 });
  assert.deepEqual(status.contract, { covered: 1, required: 1 });
  assert.equal(status.closable, false);
});

test("valid fan-out bundle accepts sorted root, leaf, and node ledgers", () => {
  const root = repo("fanout");
  const pkg = packageText("fanout", {
    plan: "1. [x] Implement the root outcome.\n2. [x] Integrate the fan-out leaves.",
    acceptance: [
      "- C1 -> GATES.md:R1: Root integration is verified.",
      "- C2 -> gates/leaf-1.md:L1: Leaf output is verified.",
      "- C3 -> gates/node-1.md:N1: Node integration is verified.",
    ].join("\n"),
    attachment: `### Depth Tree

- ROOT GATES.md <- none: Root contract and integration outcome.
- LEAF gates/leaf-1.md <- GATES.md: Independent leaf outcome.
- NODE gates/node-1.md <- gates/leaf-1.md: Bottom-up integration outcome.`,
  });
  writeBundle(root, "fanout", {
    package: pkg,
    rootGates: gateText([{ id: "R1", met: true }]),
    sidecars: {
      "node-1.md": gateText([{ id: "N1", met: true }]),
      "leaf-1.md": gateText([{ id: "L1", met: true }]),
    },
    gitkeep: false,
  });
  const status = inspect(root, "fanout");
  assert.equal(status.diagnostics.length, 0);
  assert.equal(status.status, "closable");
  assert.equal(status.closable, true);
  assert.deepEqual(status.contract, { covered: 3, required: 3 });
  assert.deepEqual(status.gates, { total: 3, met: 3, unmet: 0, handoff: 0 });
  assert.deepEqual(status.depthTree, { defined: true, ledgers: 3 });
});

test("fan-out requires a complete acyclic Depth Tree before it can be valid", () => {
  const missingRoot = repo("depth-missing");
  writeBundle(missingRoot, "depth-missing", {
    package: packageText("depth-missing", {
      acceptance: "- C1 -> GATES.md:G1: Root gate.\n- C2 -> gates/leaf-one.md:L1: Leaf gate.",
    }),
    sidecars: { "leaf-one.md": gateText([{ id: "L1", met: false }]) },
    gitkeep: false,
  });
  assert.ok(inspect(missingRoot, "depth-missing").diagnostics.some((item) => item.code === "PACKAGE_DEPTH_TREE_COUNT"));

  const cyclicRoot = repo("depth-cyclic");
  writeBundle(cyclicRoot, "depth-cyclic", {
    package: packageText("depth-cyclic", {
      acceptance: "- C1 -> GATES.md:G1: Root gate.\n- C2 -> gates/leaf-one.md:L1: Leaf gate.",
      attachment: `### Depth Tree

- ROOT GATES.md <- none: Root contract.
- LEAF gates/leaf-one.md <- gates/leaf-one.md: Invalid self-cycle.`,
    }),
    sidecars: { "leaf-one.md": gateText([{ id: "L1", met: false }]) },
    gitkeep: false,
  });
  const diagnostics = inspect(cyclicRoot, "depth-cyclic").diagnostics;
  assert.ok(diagnostics.some((item) => item.code === "PACKAGE_DEPTH_TREE_SELF_DEPENDENCY"));
  assert.ok(diagnostics.some((item) => item.code === "PACKAGE_DEPTH_TREE_DISCONNECTED"));

  const hiddenCycleRoot = repo("depth-hidden-cycle");
  writeBundle(hiddenCycleRoot, "depth-hidden-cycle", {
    package: packageText("depth-hidden-cycle", {
      acceptance: [
        "- C1 -> GATES.md:G1: Root gate.",
        "- C2 -> gates/node-one.md:N1: First node.",
        "- C3 -> gates/node-two.md:N2: Second node.",
      ].join("\n"),
      attachment: `### Depth Tree

- ROOT GATES.md <- none: Root contract.
- NODE gates/node-one.md <- gates/node-two.md, GATES.md: Cycle with an alternate root path.
- NODE gates/node-two.md <- gates/node-one.md: Cycle back to the first node.`,
    }),
    sidecars: {
      "node-one.md": gateText([{ id: "N1", met: false }]),
      "node-two.md": gateText([{ id: "N2", met: false }]),
    },
    gitkeep: false,
  });
  assert.ok(inspect(hiddenCycleRoot, "depth-hidden-cycle").diagnostics
    .some((item) => item.code === "PACKAGE_DEPTH_TREE_CYCLE"));
});

test("overlapping OWNS declarations are schema-invalid before claim or close", () => {
  const root = repo("ownership-overlap");
  const withOwns = (id, owns) => `# Gates\n\nOWNS: ${owns}\n\n- [ ] ${id}: owned outcome\n  EVIDENCE: pending\n`;
  writeBundle(root, "ownership-overlap", {
    package: packageText("ownership-overlap", {
      acceptance: [
        "- C1 -> GATES.md:G1: Root gate.",
        "- C2 -> gates/leaf-one.md:L1: First leaf.",
        "- C3 -> gates/leaf-two.md:L2: Second leaf.",
      ].join("\n"),
      attachment: `### Depth Tree

- ROOT GATES.md <- none: Root contract.
- LEAF gates/leaf-one.md <- GATES.md: First leaf.
- LEAF gates/leaf-two.md <- GATES.md: Second leaf.`,
    }),
    sidecars: {
      "leaf-one.md": withOwns("L1", "src/shared/**"),
      "leaf-two.md": withOwns("L2", "src/shared/file.js"),
    },
    gitkeep: false,
  });
  assert.ok(inspect(root, "ownership-overlap").diagnostics.some((item) => item.code === "PACKAGE_OWNERSHIP_OVERLAP"));
});

test("missing or reordered sections are rejected", () => {
  const parsed = parsePackageDocument(packageText("order", {
    sections: ["Plan", "Abnahme", "Status", "Abschluss", "Anhang"],
  }), { packageId: "order" });
  assert.ok(parsed.diagnostics.some((item) => item.code === "PACKAGE_SECTION_ORDER"));
});

test("gate definitions inside PACKAGE.md are rejected", () => {
  const root = repo("gate-in-package");
  writeBundle(root, "gate-in-package", {
    package: packageText("gate-in-package", { status: "CHECK: node forbidden.mjs" }),
  });
  assert.ok(inspect(root, "gate-in-package").diagnostics.some((item) => item.code === "PACKAGE_GATE_DEFINITION"));
});

test("checkboxes outside the numbered Plan cannot falsify progress", () => {
  const root = repo("checkbox-outside");
  writeBundle(root, "checkbox-outside", {
    package: packageText("checkbox-outside", {
      acceptance: "- [x] C1 -> GATES.md:G1: This must not count as plan progress.",
    }),
  });
  const status = inspect(root, "checkbox-outside");
  assert.equal(status.plan.done, 0);
  assert.ok(status.diagnostics.some((item) => item.code === "PACKAGE_CHECKBOX_OUTSIDE_PLAN"));
});

test("a contradictory Abschluss is invalid even when prose says fulfilled", () => {
  const root = repo("contradictory");
  writeBundle(root, "contradictory", {
    package: packageText("contradictory", { fulfillment: "erfuellt - claimed complete.", open: "nichts" }),
  });
  const status = inspect(root, "contradictory");
  assert.equal(status.status, "invalid");
  assert.ok(status.diagnostics.some((item) => item.code === "PACKAGE_CONTRADICTORY_CLOSE"));
});

test("incomplete and overlapping contract mappings are rejected", () => {
  const missingRoot = repo("unmapped");
  writeBundle(missingRoot, "unmapped", {
    rootGates: gateText([{ id: "G1", met: false }, { id: "G2", met: false }]),
  });
  assert.ok(inspect(missingRoot, "unmapped").diagnostics.some((item) => item.code === "PACKAGE_CONTRACT_UNMAPPED_GATE"));

  const duplicateRoot = repo("overlap");
  writeBundle(duplicateRoot, "overlap", {
    package: packageText("overlap", {
      acceptance: "- C1 -> GATES.md:G1: First mapping.\n- C2 -> GATES.md:G1: Duplicate mapping.",
    }),
  });
  assert.ok(inspect(duplicateRoot, "overlap").diagnostics.some((item) => item.code === "PACKAGE_CONTRACT_OVERLAP"));
});

test("closed requires complete plan, current evidence, full contract, and consistent Abschluss", () => {
  const root = repo("closed");
  writeBundle(root, "closed", {
    package: packageText("closed", {
      plan: "1. [x] Implement the observable outcome.",
      fulfillment: "erfuellt - the goal holds.",
      open: "nichts",
    }),
    rootGates: gateText([{ id: "G1", met: true }]),
  });
  const status = inspect(root, "closed");
  assert.equal(status.diagnostics.length, 0);
  assert.equal(status.status, "closed");
  assert.equal(status.lifecycle, "closed");
  assert.equal(status.closable, false);
});

test("EVIDENCE lines with and without the retired oracleDigest field are equally valid (A17)", () => {
  const lines = {
    old: "schema=2; exit=0; shellId=win32:cmd.exe; cwd=.; oracleDigest=sha256:" + "a".repeat(64) +
      "; EXPECT=matched; output-sha256=" + "b".repeat(64) + "; output-bytes=24",
    current: "schema=2; exit=0; shellId=win32:cmd.exe; cwd=.; EXPECT=matched; output-sha256=" + "b".repeat(64) +
      "; output-bytes=24",
    malformedDigest: "schema=2; exit=0; shellId=win32:cmd.exe; cwd=.; oracleDigest=sha256:0; EXPECT=matched; output-sha256=0",
  };
  const snapshots = [];
  for (const [name, evidence] of Object.entries(lines)) {
    const root = repo("evidence-" + name);
    writeBundle(root, "evidence-" + name, {
      package: packageText("evidence-" + name, {
        plan: "1. [x] Implement the observable outcome.",
        fulfillment: "erfuellt - the goal holds.",
        open: "nichts",
      }),
      rootGates: "# Gates: fixture\n\n- [x] G1: observable fixture outcome\n  CHECK: node -e \"console.log('OK')\"\n  EXPECT: OK\n  EVIDENCE: " +
        evidence + "\n",
    });
    const status = inspect(root, "evidence-" + name);
    assert.deepEqual(status.diagnostics, [], name);
    assert.equal(status.status, "closed", name);
    snapshots.push([name, status.gates]);
  }
  for (const [name, gates] of snapshots) assert.deepEqual(gates, snapshots[0][1], name + ": the field changes nothing");
});

test("solo and fan-out sidecar layout rejects missing or redundant .gitkeep", () => {
  const soloRoot = repo("missing-gitkeep");
  writeBundle(soloRoot, "missing-gitkeep", { gitkeep: false });
  assert.ok(inspect(soloRoot, "missing-gitkeep").diagnostics.some((item) => item.code === "PACKAGE_GATES_GITKEEP"));

  const fanRoot = repo("redundant-gitkeep");
  const pkg = packageText("redundant-gitkeep", {
    acceptance: "- C1 -> GATES.md:G1: Root gate.\n- C2 -> gates/leaf.md:L1: Leaf gate.",
  });
  writeBundle(fanRoot, "redundant-gitkeep", {
    package: pkg,
    sidecars: { "leaf.md": gateText([{ id: "L1", met: false }]) },
    gitkeep: true,
  });
  assert.ok(inspect(fanRoot, "redundant-gitkeep").diagnostics.some((item) => item.code === "PACKAGE_GATES_REDUNDANT_GITKEEP"));
});

test("CLI create, list, lint, status, and doctor share the schema core", () => {
  const root = repo("cli");
  const created = run(root, "create", "--package", "created", "--json");
  assert.equal(created.status, 0, created.stderr);
  const createdJson = JSON.parse(created.stdout);
  assert.equal(createdJson.packageId, "created");
  assert.equal(createdJson.status, "draft");

  const listed = run(root, "list", "--json");
  assert.equal(listed.status, 0, listed.stderr);
  assert.equal(JSON.parse(listed.stdout).packageCount, 1);

  const linted = run(root, "lint", "--package", "created", "--json");
  assert.equal(linted.status, 0, linted.stderr);
  assert.equal(JSON.parse(linted.stdout).diagnostics.length, 0);

  const status = run(root, "status", "--package", "created", "--json");
  assert.equal(status.status, 1, status.stderr);
  assert.equal(JSON.parse(status.stdout).plan.nextStep, 1);

  const doctor = run(root, "doctor", "--package", "created", "--json");
  assert.equal(doctor.status, 0, doctor.stderr);
  assert.equal(JSON.parse(doctor.stdout).valid, true);
});

test("CLI create refuses a legacy collision without publishing a bundle", () => {
  const root = repo("create-collision");
  mkdirSync(join(root, "docs", "packages"), { recursive: true });
  writeFileSync(join(root, "docs", "packages", "legacy.md"), "# legacy\n", "utf8");
  const result = run(root, "create", "--package", "legacy", "--json");
  assert.equal(result.status, 2);
  assert.match(result.stderr, /legacy flat package collides/);
});

process.on("exit", () => {
  try { rmSync(suiteRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 }); } catch { /* best effort */ }
});

emitTestCounts("package-schema-tests", {
  tests: total, pass: passed, fail: total - passed, skip: 0,
});
if (!process.exitCode) console.log(`\n${passed}/${total} passed, 0 skipped`);
