#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const args = process.argv.slice(2);
const value = (name, fallback) => {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith("--")) throw new Error(name + " requires a value");
  return args[index + 1];
};
const root = path.resolve(value("--root", process.cwd()));
const mode = value("--mode", "all");
if (!new Set(["profile", "all"]).has(mode)) throw new Error("--mode must be profile or all");

const files = [path.join(root, "docs", "harness-instance.md")];
if (mode === "all") files.push(path.join(root, "docs", "tool-landscape.md"));
const secretPatterns = [
  /gh[posur]_[A-Za-z0-9]{36}/u,
  /github_pat_[A-Za-z0-9_]{22,}/u,
  /sk-ant-[A-Za-z0-9-]{20,}/u,
  /sk-[A-Za-z0-9]{32,}/u,
  /AKIA[0-9A-Z]{16}/u,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
];
for (const file of files) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error("missing onboarding file: " + file);
  const text = fs.readFileSync(file, "utf8");
  if (text.includes("[AUSFUELLEN]")) throw new Error("onboarding marker remains in " + file);
  if (secretPatterns.some((pattern) => pattern.test(text))) throw new Error("credential-shaped value in " + file);
}
process.stdout.write(mode === "profile" ? "PROFILE READY\n" : "ONBOARDING READY\n");
