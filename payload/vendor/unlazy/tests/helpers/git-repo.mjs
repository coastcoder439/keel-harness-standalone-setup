import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

export function git(root, ...args) {
  const result = spawnSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 20_000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return String(result.stdout || "").trim();
}

export function initRepository(root, options = {}) {
  mkdirSync(root, { recursive: true });
  if (options.separateGitDir) {
    mkdirSync(options.separateGitDir, { recursive: true });
    const result = spawnSync("git", ["init", "--quiet", "--separate-git-dir", options.separateGitDir, root], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 20_000,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } else {
    git(root, "init", "--quiet");
  }
  git(root, "config", "user.email", "unlazy-test@example.invalid");
  git(root, "config", "user.name", "Unlazy Test");
  return root;
}
