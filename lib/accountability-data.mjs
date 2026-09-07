// Accountability data of one installation lives OUTSIDE the repository: on Windows under
// %LOCALAPPDATA%\KeelHarness\accountability\<instance>, elsewhere under
// $XDG_DATA_HOME/keel-harness/accountability/<instance>. Uninstall restores the repository
// tree only, so the Google OAuth token (google-token.json) and the OAuth client file
// (google-client-secrets.json) would stay behind unnoticed (completeness audit 06.09.2026, H1).
// This module mirrors the derivation in dashboard/lib/accountability/harness.ts byte for byte
// (instance key = sha256 of the resolved harness root, first 16 hex characters; the same
// environment overrides) and is measured against it by
// dashboard/test/google-credential-paths.test.ts. It only reports by default; a purge is an
// explicit Owner choice (`node install.mjs uninstall --purge-accountability-data`) that first
// revokes the stored Google token best effort and then removes the whole instance directory.
//
// The Dashboard derives its root from the working directory it was started in. On Windows that
// string may be the 8.3 short form or the long form of the same directory, and the two hash to
// different instance keys; the installer therefore checks the canonical (real) path AND the
// resolved path of the target and reports every instance directory that exists.
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const ACCOUNTABILITY_CREDENTIAL_FILES = Object.freeze(["google-token.json", "google-client-secrets.json"]);
export const LEGACY_GAM_CREDENTIAL_FILES = Object.freeze(["keel-accountability-token.json", "client_secrets.json"]);
export const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";

export function accountabilityInstanceKey(harnessRoot) {
  return createHash("sha256").update(path.resolve(harnessRoot)).digest("hex").slice(0, 16);
}

export function accountabilityDataDirectoryForHarnessRoot(harnessRoot, options = {}) {
  const env = options.env || process.env;
  const platform = options.platform || process.platform;
  const home = options.homedir || os.homedir();
  const configuredBase = options.baseDirectory
    ?? (env.KEEL_ACCOUNTABILITY_DATA_DIR ? path.resolve(env.KEEL_ACCOUNTABILITY_DATA_DIR) : undefined);
  const base = configuredBase
    ?? (platform === "win32"
      ? path.join(env.LOCALAPPDATA || path.join(home, "AppData", "Local"), "KeelHarness")
      : path.join(env.XDG_DATA_HOME || path.join(home, ".local", "share"), "keel-harness"));
  return path.join(base, "accountability", accountabilityInstanceKey(harnessRoot));
}

// The Dashboard resolves ACCOUNTABILITY_DATA_DIR first (harness.ts, accountabilityDataDirectory).
export function resolveAccountabilityDataDirectory(harnessRoot, options = {}) {
  const env = options.env || process.env;
  const direct = String(env.ACCOUNTABILITY_DATA_DIR || "").trim();
  return direct ? path.resolve(direct) : accountabilityDataDirectoryForHarnessRoot(harnessRoot, options);
}

// The installed Dashboard takes the first ancestor with the Harness markers as its root; in a
// recipient repository that is the installation target itself. KEEL_HARNESS_ROOT overrides it
// for the Dashboard runtime and therefore here as well. Without the override both the canonical
// and the resolved spelling of the target are candidates (see the header comment).
export function harnessRootCandidates(target, env = process.env) {
  const configured = String(env.KEEL_HARNESS_ROOT || "").trim();
  if (configured) return [path.resolve(configured)];
  const resolved = path.resolve(target);
  let canonical = resolved;
  try {
    canonical = realpathSync.native(resolved);
  } catch {
    // A target that does not exist keeps its resolved spelling.
  }
  return [...new Set([canonical, resolved])];
}

export function harnessRootForTarget(target, env = process.env) {
  return harnessRootCandidates(target, env)[0];
}

function listFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(directory, entry.name);
    files.push({
      directory,
      name: entry.name,
      bytes: statSync(file).size,
      credential: ACCOUNTABILITY_CREDENTIAL_FILES.includes(entry.name),
    });
  }
  return files.sort((left, right) => left.name.localeCompare(right.name, "en"));
}

export function inspectAccountabilityData(target, options = {}) {
  const env = options.env || process.env;
  const candidates = [...new Set(harnessRootCandidates(target, env)
    .map((root) => resolveAccountabilityDataDirectory(root, options)))];
  const directories = candidates.filter((directory) => existsSync(directory) && statSync(directory).isDirectory());
  const files = directories.flatMap((directory) => listFiles(directory));
  const result = {
    directory: directories[0] || candidates[0],
    candidates,
    directories,
    exists: directories.length > 0,
    files,
    credentialFiles: [...new Set(files.filter((file) => file.credential).map((file) => file.name))].sort(),
    legacyGamFiles: [],
  };
  // GAM-imported credentials are read by the Dashboard as a fallback; they belong to GAM and are
  // only named here, never removed.
  const home = options.homedir || os.homedir();
  for (const name of LEGACY_GAM_CREDENTIAL_FILES) {
    const legacy = path.join(home, ".gam", name);
    if (existsSync(legacy)) result.legacyGamFiles.push(legacy);
  }
  return result;
}

function storedGoogleToken(file) {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    if (!parsed || typeof parsed !== "object") return null;
    const pick = (...keys) => keys.map((key) => parsed[key]).find((value) => typeof value === "string" && value.trim());
    return pick("refreshToken", "refresh_token") || pick("accessToken", "access_token") || null;
  } catch {
    return null;
  }
}

// Revocation is best effort, exactly like the Dashboard's own disconnect: a failed call must not
// keep the credential file on disk. The outcome is reported, never hidden.
export async function revokeGoogleToken(file, options = {}) {
  const token = storedGoogleToken(file);
  if (!token) return "no-token";
  const fetchImpl = options.fetch || globalThis.fetch;
  if (typeof fetchImpl !== "function") return "unavailable";
  const env = options.env || process.env;
  const url = options.revokeUrl || env.KEEL_GOOGLE_REVOKE_URL || GOOGLE_REVOKE_URL;
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }).toString(),
      signal: AbortSignal.timeout(options.timeoutMs || 10_000),
    });
    return response.ok ? "revoked" : "rejected:" + response.status;
  } catch (error) {
    return "failed:" + (error && error.name === "TimeoutError" ? "timeout" : (error && error.code) || "network");
  }
}

export async function purgeAccountabilityData(target, options = {}) {
  const inspection = inspectAccountabilityData(target, options);
  const outcomes = [];
  for (const directory of inspection.directories) {
    const token = path.join(directory, "google-token.json");
    if (existsSync(token) && !lstatSync(token).isSymbolicLink()) outcomes.push(await revokeGoogleToken(token, options));
    rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
  return {
    ...inspection,
    purged: inspection.directories.length > 0,
    revoke: outcomes.length ? outcomes.join(",") : "no-token",
    removedDirectories: inspection.directories,
    removedFiles: inspection.files.map((file) => file.name),
    directories: [],
    exists: false,
  };
}
