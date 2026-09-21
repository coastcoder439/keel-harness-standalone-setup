import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveVoiceRoot, voiceboxBinary, voiceboxModelsDir, serviceAddresses } from './config.mjs';
import { recommendSettings } from './system-recommendations.mjs';

// Systemprofil (Paket system-profile, 21.09.2026): der Harness misst den Rechner, auf dem er
// laeuft — CPU (Modell, physische Kerne, Threads), Arbeitsspeicher, Grafikkarten, freier
// Plattenplatz, und ob die laufende Voicebox eine GPU nutzt — und schreibt das Ergebnis als
// runtime/system-profile.json. Aus dem Profil leitet system-recommendations.mjs je Einstellung
// eine Empfehlung mit Grund ab; Starter, Hoeren und Modell-Liste lesen diese Datei als
// Voreinstellung (Umgebungsvariablen gewinnen weiterhin). Gemessene Werte (Sprech-/Hoer-Latenz)
// werden spaeter vom Dashboard in dieselbe Datei geschrieben.
//
// Windows ist die erste Zielplattform: physische Kerne und Grafikkarten kommen von
// PowerShell (Win32_Processor / Win32_VideoController); andere Plattformen bekommen die
// Node-Sicht (logische Prozessoren) und physische Kerne = null.

export const PROFILE_VERSION = 1;
export const profileFile = (env = process.env) => path.join(resolveVoiceRoot(env), 'system-profile.json');

function runPowerShell(script, run = spawnSync) {
  const result = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout: 20000 });
  if (result.error || result.status !== 0 || !result.stdout) return null;
  try { return JSON.parse(result.stdout); } catch { return null; }
}

function windowsHardware(run) {
  const payload = runPowerShell('$c = Get-CimInstance Win32_Processor | Select-Object Name, NumberOfCores, NumberOfLogicalProcessors; $g = Get-CimInstance Win32_VideoController | Select-Object Name, AdapterRAM, DriverVersion; @{ cpu = @($c); gpu = @($g) } | ConvertTo-Json -Depth 3 -Compress', run);
  if (!payload) return null;
  const cpus = Array.isArray(payload.cpu) ? payload.cpu : payload.cpu ? [payload.cpu] : [];
  const gpus = Array.isArray(payload.gpu) ? payload.gpu : payload.gpu ? [payload.gpu] : [];
  const physicalCores = cpus.reduce((sum, cpu) => sum + (Number(cpu.NumberOfCores) || 0), 0) || null;
  const logicalProcessors = cpus.reduce((sum, cpu) => sum + (Number(cpu.NumberOfLogicalProcessors) || 0), 0) || null;
  return {
    cpu: { model: String(cpus[0]?.Name || '').trim() || null, physicalCores, logicalProcessors },
    gpus: gpus.filter(gpu => gpu && gpu.Name).map(gpu => ({ name: String(gpu.Name).trim(), vramMiB: Number(gpu.AdapterRAM) > 0 ? Math.round(Number(gpu.AdapterRAM) / 1048576) : null, driver: gpu.DriverVersion ? String(gpu.DriverVersion) : null })),
  };
}

function diskFreeMiB(directory) {
  try {
    let probe = directory;
    while (!fs.existsSync(probe)) { const parent = path.dirname(probe); if (parent === probe) break; probe = parent; }
    const stat = fs.statfsSync(probe);
    return Math.round((Number(stat.bavail) * Number(stat.bsize)) / 1048576);
  } catch { return null; }
}

// Nur lesen: laeuft Voicebox, sagt /health, ob sie eine GPU nutzt (backend cpu|cuda). Kein Start.
async function voiceboxBackend(env, fetcher = fetch) {
  const base = serviceAddresses(env).voicebox;
  try {
    const health = await fetcher(base + '/health', { signal: AbortSignal.timeout(1500) }).then(r => r.json());
    return { running: true, gpuAvailable: health.gpu_available === true, gpuType: health.gpu_type || null, backend: health.backend_variant || health.backend_type || null };
  } catch { return { running: false, gpuAvailable: null, gpuType: null, backend: null }; }
}

export async function measureSystem({ env = process.env, platform = process.platform, run = spawnSync, fetcher = fetch, now = () => new Date() } = {}) {
  const cpus = os.cpus();
  const hardware = platform === 'win32' ? windowsHardware(run) : null;
  const cpu = hardware?.cpu?.model ? hardware.cpu : { model: cpus[0]?.model?.trim() || null, physicalCores: null, logicalProcessors: cpus.length || null };
  if (!cpu.logicalProcessors) cpu.logicalProcessors = cpus.length || null;
  const voiceRoot = resolveVoiceRoot(env);
  return {
    version: PROFILE_VERSION,
    measuredAt: now().toISOString(),
    platform,
    hostname: os.hostname(),
    cpu,
    memory: { totalMiB: Math.round(os.totalmem() / 1048576), freeMiB: Math.round(os.freemem() / 1048576) },
    gpus: hardware?.gpus || [],
    disk: { modelsDir: voiceboxModelsDir(env), freeMiB: diskFreeMiB(voiceboxModelsDir(env)) },
    voicebox: { binary: voiceboxBinary(env), binaryPresent: fs.existsSync(voiceboxBinary(env)), ...(await voiceboxBackend(env, fetcher)) },
    voiceRoot,
    measured: null,
  };
}

export function readProfile(env = process.env) {
  try {
    const parsed = JSON.parse(fs.readFileSync(profileFile(env), 'utf8'));
    return parsed && parsed.version === PROFILE_VERSION ? parsed : null;
  } catch { return null; }
}

// Die Datei traegt die Empfehlungen mit (aus denselben Regeln), damit TypeScript-Leser im
// Dashboard (voicebox-hearing.ts) die Werte lesen koennen, ohne die Regeln zu duplizieren.
export function writeProfile(profile, env = process.env) {
  const file = profileFile(env);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const stored = { ...profile, recommendations: recommendSettings(profile) };
  fs.writeFileSync(file, `${JSON.stringify(stored, null, 2)}\n`, 'utf8');
  return file;
}

// Gemessene Werte (Latenz) ergaenzen, ohne die Hardware-Messung zu verlieren.
// Manuelle Kontrolle (Owner 21.09.): der Nutzer darf Kerne und Speichergrenze im Dashboard setzen; die
// Wahl liegt als `overrides` im Profil, Umgebungsvariablen gewinnen weiterhin, null loescht die Wahl.
export const OVERRIDE_LIMITS = { voiceCores: { min: 1, max: 32 }, voiceJobMiB: { min: 2560, max: 16384 } };
export function mergeOverrides(profile, overrides) {
  const next = { ...(profile.overrides || {}) };
  for (const [key, limit] of Object.entries(OVERRIDE_LIMITS)) {
    if (!(key in overrides)) continue;
    const value = overrides[key];
    if (value === null || value === undefined || value === '') { delete next[key]; continue; }
    const number = Number(value);
    if (!Number.isInteger(number) || number < limit.min || number > limit.max) throw new Error(`${key} muss eine ganze Zahl zwischen ${limit.min} und ${limit.max} sein.`);
    next[key] = number;
  }
  return { ...profile, overrides: next };
}

export function mergeMeasured(profile, measured) {
  return { ...profile, measured: { ...(profile.measured || {}), ...measured, at: new Date().toISOString() } };
}

export async function refreshProfile(options = {}) {
  const env = options.env || process.env;
  const previous = readProfile(env);
  const profile = await measureSystem(options);
  if (previous?.measured) profile.measured = previous.measured;
  if (previous?.overrides) profile.overrides = previous.overrides;
  const file = writeProfile(profile, env);
  return { profile, recommendations: recommendSettings(profile), file };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const { profile, recommendations, file } = await refreshProfile();
  console.log(JSON.stringify({ file, profile, recommendations }, null, 2));
  console.error(`Systemprofil geschrieben: ${file}`);
  console.error(`CPU ${profile.cpu.model || '?'} (${profile.cpu.physicalCores ?? '?'} Kerne / ${profile.cpu.logicalProcessors ?? '?'} Threads), RAM ${Math.round(profile.memory.totalMiB / 1024)} GB, GPU ${profile.gpus.map(g => g.name).join(', ') || 'keine erkannt'}`);
  for (const [key, item] of Object.entries(recommendations)) console.error(`  ${key}: ${item.value} — ${item.reason}`);
}
