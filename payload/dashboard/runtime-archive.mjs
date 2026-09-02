#!/usr/bin/env node

import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync,
  renameSync, rmSync, unlinkSync, writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const MODULE_ROOT = path.dirname(fileURLToPath(import.meta.url));
const ARCHIVE_SCHEMA = "keel-dashboard-runtime.v1";
const MANIFEST_SCHEMA = "keel-dashboard-runtime-manifest.v1";
const LEASE_SCHEMA = "keel-dashboard-runtime-lease.v1";
const LEASE_FILE = "active.json";
const MAX_COMPRESSED_BYTES = 64 * 1024 * 1024;
const MAX_ARCHIVE_JSON_BYTES = 192 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 128 * 1024 * 1024;
const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MAX_ENTRIES = 5_000;
const WINDOWS_DEVICE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;
const NATIVE_EXTENSION = /\.(?:dll|dylib|exe|node|so)$/iu;

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const compare = (left, right) => left < right ? -1 : left > right ? 1 : 0;

function fail(message) {
  throw new Error(`Dashboard-Runtime-Archiv: ${message}`);
}

function inside(root, relativePath) {
  const base = path.resolve(root);
  const full = path.resolve(base, ...relativePath.split("/"));
  const local = path.relative(base, full);
  if (!local || local === ".." || local.startsWith(`..${path.sep}`) || path.isAbsolute(local)) {
    fail(`Pfad verlaesst das Runtime-Ziel: ${relativePath}`);
  }
  return full;
}

function validateRelativeFile(value) {
  if (typeof value !== "string" || !value || value.length > 512 || value.includes("\\") ||
      value.startsWith("/") || /^[A-Za-z]:/u.test(value) || value.includes("\0") ||
      /[\u0000-\u001f\u007f]/u.test(value) || value.normalize("NFC") !== value) {
    fail(`ungueltiger relativer Dateipfad: ${JSON.stringify(value)}`);
  }
  const parts = value.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || part.length > 180 ||
      /[<>:"|?*]/u.test(part) || /[. ]$/u.test(part) || WINDOWS_DEVICE.test(part))) {
    fail(`nicht plattformneutraler Dateipfad: ${JSON.stringify(value)}`);
  }
  return parts;
}

function treeDigest(entries) {
  const digest = createHash("sha256");
  for (const entry of entries) digest.update(`${entry.path}\0${entry.bytes}\0${entry.sha256}\n`);
  return digest.digest("hex");
}

function hasBase64Alphabet(value) {
  if (value.length % 4 !== 0 || value.length > Math.ceil(MAX_FILE_BYTES / 3) * 4 + 4) return false;
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  for (let index = 0; index < value.length - padding; index += 1) {
    const code = value.charCodeAt(index);
    if (!((code >= 48 && code <= 57) || (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122) || code === 43 || code === 47)) return false;
  }
  for (let index = value.length - padding; index < value.length; index += 1) {
    if (value.charCodeAt(index) !== 61) return false;
  }
  return true;
}

function parseManifest(dashboardRoot) {
  const file = path.join(dashboardRoot, "runtime-manifest.json");
  const value = JSON.parse(readFileSync(file, "utf8"));
  if (value?.schema !== MANIFEST_SCHEMA || value.archive !== "runtime.keel.gz" ||
      !Number.isSafeInteger(value.archiveBytes) || value.archiveBytes < 1 || value.archiveBytes > MAX_COMPRESSED_BYTES ||
      !/^[a-f0-9]{64}$/u.test(value.archiveSha256 || "") ||
      !Number.isSafeInteger(value.fileCount) || value.fileCount < 1 || value.fileCount > MAX_ENTRIES ||
      !Number.isSafeInteger(value.unpackedBytes) || value.unpackedBytes < 1 || value.unpackedBytes > MAX_UNPACKED_BYTES ||
      !/^[a-f0-9]{64}$/u.test(value.treeSha256 || "")) {
    fail("Runtime-Manifest ist ungueltig");
  }
  return value;
}

export function inspectDashboardRuntimeArchive(dashboardRoot = MODULE_ROOT) {
  const manifest = parseManifest(dashboardRoot);
  const archiveFile = path.join(dashboardRoot, manifest.archive);
  const archiveInfo = lstatSync(archiveFile);
  if (!archiveInfo.isFile() || archiveInfo.isSymbolicLink() || archiveInfo.nlink !== 1 || archiveInfo.size !== manifest.archiveBytes ||
      archiveInfo.size > MAX_COMPRESSED_BYTES) fail("Archivdatei ist kein erlaubtes regulaeres File");
  const compressed = readFileSync(archiveFile);
  if (sha256(compressed) !== manifest.archiveSha256) fail("komprimierter SHA-256 stimmt nicht");

  let raw;
  try { raw = gunzipSync(compressed, { maxOutputLength: MAX_ARCHIVE_JSON_BYTES }); }
  catch (error) { fail(`gzip ist ungueltig oder zu gross: ${error.message}`); }
  let archive;
  try { archive = JSON.parse(raw.toString("utf8")); }
  catch (error) { fail(`Archiv-JSON ist ungueltig: ${error.message}`); }
  if (archive?.schema !== ARCHIVE_SCHEMA || !Array.isArray(archive.entries) ||
      archive.fileCount !== archive.entries.length || archive.fileCount !== manifest.fileCount ||
      archive.unpackedBytes !== manifest.unpackedBytes || archive.treeSha256 !== manifest.treeSha256 ||
      archive.entries.length < 1 || archive.entries.length > MAX_ENTRIES) {
    fail("Archivkopf widerspricht Manifest oder Grenzen");
  }

  const entries = [];
  const fileKeys = new Set();
  const directoryKeys = new Set();
  let unpackedBytes = 0;
  for (const rawEntry of archive.entries) {
    const parts = validateRelativeFile(rawEntry?.path);
    if (rawEntry?.mode !== 0o644 || !Number.isSafeInteger(rawEntry?.bytes) || rawEntry.bytes < 0 ||
        rawEntry.bytes > MAX_FILE_BYTES || !/^[a-f0-9]{64}$/u.test(rawEntry?.sha256 || "") ||
        typeof rawEntry?.content !== "string" || !hasBase64Alphabet(rawEntry.content)) {
      fail(`ungueltiger Dateieintrag: ${JSON.stringify(rawEntry?.path)}`);
    }
    if (NATIVE_EXTENSION.test(rawEntry.path)) fail(`plattformgebundene Binaerdatei: ${rawEntry.path}`);
    const key = rawEntry.path.toLowerCase();
    if (fileKeys.has(key) || directoryKeys.has(key)) fail(`Case-/Dateikollision: ${rawEntry.path}`);
    for (let index = 1; index < parts.length; index += 1) {
      const parent = parts.slice(0, index).join("/").toLowerCase();
      if (fileKeys.has(parent)) fail(`Datei blockiert Unterpfad: ${rawEntry.path}`);
      directoryKeys.add(parent);
    }
    const content = Buffer.from(rawEntry.content, "base64");
    if (content.toString("base64") !== rawEntry.content || content.length !== rawEntry.bytes ||
        sha256(content) !== rawEntry.sha256) fail(`Dateihash stimmt nicht: ${rawEntry.path}`);
    unpackedBytes += content.length;
    if (unpackedBytes > MAX_UNPACKED_BYTES) fail("entpackte Gesamtgroesse ueberschreitet Grenze");
    fileKeys.add(key);
    entries.push({ path: rawEntry.path, mode: rawEntry.mode, bytes: rawEntry.bytes, sha256: rawEntry.sha256, content });
  }
  const ordered = [...entries].sort((left, right) => compare(left.path, right.path));
  if (ordered.some((entry, index) => entry.path !== entries[index].path)) fail("Archiveintraege sind nicht deterministisch sortiert");
  if (unpackedBytes !== archive.unpackedBytes || treeDigest(entries) !== archive.treeSha256) {
    fail("entpackte Groesse oder Tree-SHA-256 stimmt nicht");
  }
  return { manifest, entries };
}

function ensureDirectoryChain(root, relativePath) {
  let current = path.resolve(root);
  const rootInfo = lstatSync(current);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) fail(`unsichere Installationswurzel: ${current}`);
  for (const part of relativePath.split("/")) {
    current = path.join(current, part);
    if (!existsSync(current)) mkdirSync(current, { mode: 0o700 });
    const info = lstatSync(current);
    if (!info.isDirectory() || info.isSymbolicLink()) fail(`unsicheres Runtime-Verzeichnis: ${current}`);
  }
  return current;
}

function listMaterialized(root) {
  const files = [];
  const walk = (current, prefix = "") => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((left, right) => compare(left.name, right.name))) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = path.join(current, entry.name);
      const info = lstatSync(full);
      if (info.isSymbolicLink()) fail(`Symlink im Runtime-Cache: ${relative}`);
      if (entry.isDirectory()) walk(full, relative);
      else if (entry.isFile()) files.push(relative);
      else fail(`Spezialdatei im Runtime-Cache: ${relative}`);
    }
  };
  walk(root);
  return files.sort(compare);
}

function verifyMaterialized(root, entries) {
  const files = listMaterialized(root);
  if (files.length !== entries.length || files.some((file, index) => file !== entries[index].path)) {
    fail("Runtime-Cache hat nicht die exakte Dateiliste");
  }
  for (const entry of entries) {
    const file = inside(root, entry.path);
    const info = lstatSync(file);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size !== entry.bytes || sha256(readFileSync(file)) !== entry.sha256) {
      fail(`Runtime-Cache-Hash stimmt nicht: ${entry.path}`);
    }
  }
}

function removeInside(base, candidate) {
  const root = path.resolve(base);
  const full = path.resolve(candidate);
  if (full === root || !full.startsWith(root + path.sep)) fail(`Cleanup verlaesst Runtime-Basis: ${full}`);
  if (existsSync(full)) rmSync(full, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
}

function processAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error?.code === "EPERM"; }
}

function readLease(runtimeBase) {
  const file = path.join(runtimeBase, LEASE_FILE);
  if (!existsSync(file)) return null;
  const info = lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 16_384) {
    fail("Runtime-Lease ist keine sichere regulaere Datei");
  }
  let value;
  try { value = JSON.parse(readFileSync(file, "utf8")); }
  catch (error) { fail(`Runtime-Lease ist ungueltig: ${error.message}`); }
  if (value?.schema !== LEASE_SCHEMA || !/^[a-f0-9]{32}$/u.test(value.id || "") ||
      !/^[a-f0-9]{64}$/u.test(value.treeSha256 || "") ||
      !Number.isSafeInteger(value.ownerPid) || value.ownerPid < 1 ||
      !(value.childPid === null || Number.isSafeInteger(value.childPid) && value.childPid > 0) ||
      typeof value.startedAt !== "string") fail("Runtime-Lease hat ein ungueltiges Schema");
  return {
    file,
    value,
    active: processAlive(value.ownerPid) || processAlive(value.childPid),
  };
}

export function acquireDashboardRuntimeLease({ harnessRoot, runtimeRoot }) {
  const resolvedHarnessRoot = path.resolve(harnessRoot);
  const runtimeBase = ensureDirectoryChain(resolvedHarnessRoot, ".keel-harness/runtime/dashboard");
  const resolvedRuntimeRoot = path.resolve(runtimeRoot);
  const local = path.relative(runtimeBase, resolvedRuntimeRoot);
  if (!/^[a-f0-9]{64}$/u.test(local) || path.dirname(local) !== ".") {
    fail(`Lease-Runtime ist kein Digest-Cache: ${resolvedRuntimeRoot}`);
  }
  const leaseFile = path.join(runtimeBase, LEASE_FILE);
  const id = randomBytes(16).toString("hex");
  const value = {
    schema: LEASE_SCHEMA,
    id,
    treeSha256: local,
    ownerPid: process.pid,
    childPid: null,
    startedAt: new Date().toISOString(),
  };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const current = readLease(runtimeBase);
    if (current?.active) fail(`Dashboard-Runtime laeuft bereits (PID ${current.value.childPid || current.value.ownerPid})`);
    if (current) unlinkSync(current.file);
    let descriptor;
    try { descriptor = openSync(leaseFile, "wx", 0o600); }
    catch (error) {
      if (error?.code === "EEXIST" && attempt === 0) continue;
      throw error;
    }
    try { writeFileSync(descriptor, JSON.stringify(value) + "\n", "utf8"); }
    finally { closeSync(descriptor); }
    const ownsLease = () => readLease(runtimeBase)?.value.id === id;
    return {
      updateChild(childPid) {
        if (!ownsLease()) fail("Dashboard-Runtime-Lease wurde waehrend des Starts ersetzt");
        if (!Number.isSafeInteger(childPid) || childPid < 1) fail("Dashboard-Child-PID ist ungueltig");
        value.childPid = childPid;
        writeFileSync(leaseFile, JSON.stringify(value) + "\n", { encoding: "utf8", mode: 0o600 });
      },
      release() {
        if (ownsLease()) unlinkSync(leaseFile);
      },
    };
  }
  fail("Dashboard-Runtime-Lease konnte nicht exklusiv angelegt werden");
}

export function materializeDashboardRuntime(options = {}) {
  const dashboardRoot = path.resolve(options.dashboardRoot || MODULE_ROOT);
  const harnessRoot = path.resolve(options.harnessRoot || path.join(dashboardRoot, ".."));
  const { manifest, entries } = inspectDashboardRuntimeArchive(dashboardRoot);
  const runtimeBase = ensureDirectoryChain(harnessRoot, ".keel-harness/runtime/dashboard");
  const destination = path.join(runtimeBase, manifest.treeSha256);

  if (existsSync(destination)) {
    const info = lstatSync(destination);
    if (!info.isDirectory() || info.isSymbolicLink()) fail("Runtime-Cache-Ziel ist kein sicheres Verzeichnis");
    verifyMaterialized(destination, entries);
  }
  else {
    const stage = path.join(runtimeBase, `.staging-${process.pid}-${randomBytes(8).toString("hex")}`);
    mkdirSync(stage, { mode: 0o700 });
    try {
      for (const entry of entries) {
        const target = inside(stage, entry.path);
        mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
        writeFileSync(target, entry.content, { flag: "wx", mode: entry.mode });
        try { chmodSync(target, entry.mode); } catch { /* Windows uses ACLs; hashes remain authoritative. */ }
      }
      verifyMaterialized(stage, entries);
      try { renameSync(stage, destination); }
      catch (error) {
        if (!existsSync(destination)) throw error;
        verifyMaterialized(destination, entries);
        removeInside(runtimeBase, stage);
      }
    } catch (error) {
      removeInside(runtimeBase, stage);
      throw error;
    }
  }

  for (const entry of readdirSync(runtimeBase, { withFileTypes: true })) {
    if (entry.name === LEASE_FILE) {
      readLease(runtimeBase);
      continue;
    }
    if (entry.name === manifest.treeSha256) continue;
    const candidate = path.join(runtimeBase, entry.name);
    const info = lstatSync(candidate);
    if (!info.isDirectory() || info.isSymbolicLink() ||
        (!/^[a-f0-9]{64}$/u.test(entry.name) && !entry.name.startsWith(".staging-"))) {
      fail(`unerwarteter Runtime-Cache-Eintrag: ${entry.name}`);
    }
    removeInside(runtimeBase, candidate);
  }
  return destination;
}

export const dashboardRuntimeLimits = Object.freeze({
  maxCompressedBytes: MAX_COMPRESSED_BYTES,
  maxArchiveJsonBytes: MAX_ARCHIVE_JSON_BYTES,
  maxUnpackedBytes: MAX_UNPACKED_BYTES,
  maxFileBytes: MAX_FILE_BYTES,
  maxEntries: MAX_ENTRIES,
  nativeExtension: NATIVE_EXTENSION.source,
});
