// Incremental reuse from a base commit (test-matrix.mjs --reuse-base <commit>): which phases a set of changed
// files can affect. Pure functions over (changed paths, checkout directory); no Git, no phase is run here.
//
// A green stored result of the base commit holds for a phase when no file changed since the base can affect it:
//   test:<file>                    the test file and everything it loads, transitively, by statically resolvable
//                                  relative paths (require / import) is unchanged; in the test file itself also the
//                                  files it names with path.join|resolve(<known root>, "a", "b")
//   unlazy:*                       nothing changed under vendor/unlazy
//   dashboard:*, build:*           nothing changed under test-harness/dashboard
//   standalone:*, check:*          nothing changed under test-harness/ except test-harness/docs/
//                                  (check:package-gate-lint also reads vendor/unlazy)
// A change to test-harness/package.json or package-lock.json affects every phase of the product. A phase with any
// other prefix is never taken over. Limit (stated, not hidden): a dependency built at run time (a computed path, a
// spawned script named by a variable) is not seen; the Owner decided that a hotfix may rely on this rule.

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const posix = (value) => String(value).replace(/\\/gu, "/");
const CODE_FILE = /\.(?:[cm]?js|ts|tsx|jsx)$/u;
const EXTENSIONS = ["", ".js", ".cjs", ".mjs", ".json", "/index.js", "/index.cjs", "/index.mjs"];
const SPECIFIER = [
  /\brequire\(\s*["'`](\.{1,2}\/[^"'`]*)["'`]\s*\)/gu,
  /\bfrom\s+["'](\.{1,2}\/[^"']*)["']/gu,
  /\bimport\(\s*["'](\.{1,2}\/[^"']*)["']\s*\)/gu,
  /\bimport\s+["'](\.{1,2}\/[^"']*)["']/gu,
];
const PATH_CALL = /\b(?:join|resolve)\(\s*([A-Za-z_$][\w$]*)\s*((?:,\s*(?:"[^"\n]*"|'[^'\n]*')\s*)+)\)/gu;

function isFile(path) { try { return statSync(path).isFile(); } catch { return false; } }
function isDirectory(path) { try { return statSync(path).isDirectory(); } catch { return false; } }

// Product areas, repository-relative with a trailing slash, from the position of the product inside the repository.
export function areas(prefix = "") {
  const at = (value) => (prefix ? prefix + "/" : "") + value;
  return {
    product: at("test-harness/"), docs: at("test-harness/docs/"), dashboard: at("test-harness/dashboard/"),
    unlazy: at("vendor/unlazy/"),
    manifests: [at("test-harness/package.json"), at("test-harness/package-lock.json")],
  };
}

// The dependencies of one file as { files: Set, dirs: Set }, all relative to `top` (the checkout), POSIX.
export function staticDependencies(top, startRelative, prefix = "") {
  const zone = areas(prefix);
  const files = new Set();
  const dirs = new Set();
  const queue = [startRelative];
  const seen = new Set();
  const productDir = zone.product.slice(0, -1);
  const repoDir = prefix;
  const rootsFor = (name, fileDir) => {
    if (name === "__dirname" || name === "here") return [fileDir];
    if (["harnessRoot", "productRoot", "HARNESS_ROOT"].includes(name)) return [productDir];
    if (["labRoot", "repoRoot", "REPO_ROOT"].includes(name)) return [repoDir];
    if (name === "unlazyRoot") return [zone.unlazy.slice(0, -1)];
    if (name === "root" || name === "ROOT") return [productDir, repoDir];
    return [];
  };
  const add = (relativePath) => {
    const clean = posix(join(relativePath)).replace(/^\.\//u, "");
    if (!clean || clean.startsWith("..")) return null;
    // A bare root is no dependency (it would make everything one).
    if (clean === productDir || clean === repoDir || clean === "." || clean === "") return null;
    const absolute = join(top, ...clean.split("/"));
    if (isDirectory(absolute)) { dirs.add(clean); return null; }
    files.add(clean);
    return isFile(absolute) ? clean : null;
  };
  const resolveSpecifier = (fileDir, specifier) => {
    for (const extension of EXTENSIONS) {
      const candidate = posix(join(fileDir, specifier + extension));
      if (isFile(join(top, ...candidate.split("/")))) return candidate;
    }
    return posix(join(fileDir, specifier));
  };
  while (queue.length) {
    const current = queue.shift();
    if (seen.has(current)) continue;
    seen.add(current);
    files.add(current);
    if (!CODE_FILE.test(current)) continue;
    const absolute = join(top, ...current.split("/"));
    if (!isFile(absolute)) continue;
    const text = readFileSync(absolute, "utf8");
    const fileDir = posix(dirname(current));
    const found = [];
    for (const pattern of SPECIFIER) {
      for (const match of text.matchAll(pattern)) found.push(resolveSpecifier(fileDir, match[1]));
    }
    // Path expressions are read in the test file itself only: a shared library names many files it need not read in a given test.
    for (const match of current === startRelative ? text.matchAll(PATH_CALL) : []) {
      const roots = rootsFor(match[1], fileDir);
      if (!roots.length) continue;
      const parts = [...match[2].matchAll(/"([^"\n]*)"|'([^'\n]*)'/gu)].map((item) => item[1] ?? item[2]);
      for (const base of roots) {
        const target = posix(join(base || ".", ...parts));
        if (existsSync(join(top, ...target.split("/")))) found.push(target);
      }
    }
    for (const target of found) {
      const accepted = add(target);
      if (accepted && !seen.has(accepted)) queue.push(accepted);
    }
  }
  return { files, dirs };
}

const underAny = (changed, directory) => changed.find((item) => item.startsWith(directory));

// Decides one phase. Returns { affected: boolean, reason: string }; affected means the phase must run.
// `changed`: repository-relative POSIX paths changed since the base. `top`: checkout of the checked commit.
export function phaseAffected(phaseId, changed, { top, prefix = "" } = {}) {
  const zone = areas(prefix);
  const manifest = changed.find((item) => zone.manifests.includes(item));
  if (manifest) return { affected: true, reason: "package manifest changed: " + manifest };
  const kind = phaseId.slice(0, phaseId.indexOf(":") + 1);
  if (kind === "test:") {
    const local = phaseId.slice(kind.length);
    const start = zone.product + local;
    const { files, dirs } = staticDependencies(top, start, prefix);
    const hitFile = changed.find((item) => files.has(item));
    if (hitFile) return { affected: true, reason: hitFile === start ? "test file changed" : "dependency changed: " + hitFile };
    for (const directory of dirs) {
      const hit = underAny(changed, directory + "/");
      if (hit) return { affected: true, reason: "dependency directory changed: " + hit };
    }
    return { affected: false, reason: "test file and its " + (files.size - 1) + " statically loaded file(s) unchanged since the base" };
  }
  if (kind === "unlazy:") {
    const hit = underAny(changed, zone.unlazy);
    return hit ? { affected: true, reason: "changed under vendor/unlazy: " + hit } : { affected: false, reason: "vendor/unlazy unchanged since the base" };
  }
  if (kind === "dashboard:" || kind === "build:") {
    const hit = underAny(changed, zone.dashboard);
    return hit ? { affected: true, reason: "changed under test-harness/dashboard: " + hit }
      : { affected: false, reason: "test-harness/dashboard unchanged since the base" };
  }
  if (kind === "standalone:" || kind === "check:") {
    const hit = changed.find((item) => item.startsWith(zone.product) && !item.startsWith(zone.docs));
    if (hit) return { affected: true, reason: "changed under test-harness/: " + hit };
    if (phaseId === "check:package-gate-lint") {
      const vendor = underAny(changed, zone.unlazy);
      if (vendor) return { affected: true, reason: "changed under vendor/unlazy: " + vendor };
    }
    return { affected: false, reason: "test-harness/ unchanged since the base (docs excluded)" };
  }
  return { affected: true, reason: "no reuse rule for this phase" };
}
