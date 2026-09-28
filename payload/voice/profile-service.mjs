import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { sidecarRoot, resolveVoiceRoot, discoverVoiceInstallation, isolatedVoiceEnvironment, loopbackAddress, voiceboxBinary, voiceboxDataDir } from './config.mjs';
import { readProfile } from './system-profile.mjs';
import { recommendSettings } from './system-recommendations.mjs';

export { voiceboxDataDir, voiceboxModelsDir, voiceboxDatabase } from './config.mjs';

export async function probeProfileService(env = process.env, fetcher = fetch) {
  const base = loopbackAddress(env.ACCOUNTABILITY_VOICEBOX_URL, 'http://127.0.0.1:4299');
  try {
    const response = await fetcher(base + '/health', { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(1200) });
    if (!response.ok) return { available: false, occupied: true, base };
    const health = await response.json();
    if (health.status !== 'healthy') return { available: false, occupied: true, base };
    const profiles = await fetcher(base + '/profiles', { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(1200) });
    return { available: profiles.ok && Array.isArray(await profiles.json()), occupied: true, base };
  } catch { return { available: false, occupied: false, base }; }
}

// The bounded Windows job (voice/profile-process.py) commits at most this many MiB for
// the whole Voicebox process tree. Loading the model peaked at ~4016 MiB and failed under the
// previous 2560 MiB ceiling. Under a 5 GiB ceiling the Qwen3-TTS 0.6B load still failed on
// 20.09.2026 ("DefaultCPUAllocator: not enough memory: you tried to allocate 1244659712 bytes",
// 7 GiB free RAM at that moment), so the default is 10 GiB -- the value that carried the fdv4
// Cortana run on 12.09.2026. KEEL_VOICEBOX_JOB_MIB overrides it within a safe band: never below
// the historical 2560 MiB floor, never above a 16 GiB rail (the >=3 GiB free-RAM start check and
// two-core cap in this file / profile-process.py are unaffected). The resolved value is exported
// into the child's environment; profile-process.py reads it there to size its Job Object commit ceiling.
const VOICEBOX_JOB_MIB = { default: 10240, min: 2560, max: 16384 };
// Reihenfolge der Voreinstellung (Paket system-profile, 21.09.2026): Umgebungsvariable gewinnt,
// sonst die Empfehlung aus runtime/voice/system-profile.json, sonst der feste Standard.
function profileRecommendation(env, key) {
  const profile = readProfile(env);
  if (!profile) return undefined;
  const override = profile.overrides?.[key];
  if (Number.isFinite(Number(override)) && Number(override) > 0) return Number(override);
  return recommendSettings(profile)[key]?.value;
}
export function resolveVoiceboxJobMiB(env = process.env) {
  const parsed = Number.parseInt(env.KEEL_VOICEBOX_JOB_MIB ?? '', 10);
  const fromProfile = Number(profileRecommendation(env, 'voiceJobMiB'));
  const requested = Number.isFinite(parsed) ? parsed : Number.isFinite(fromProfile) && fromProfile > 0 ? fromProfile : VOICEBOX_JOB_MIB.default;
  return Math.min(VOICEBOX_JOB_MIB.max, Math.max(VOICEBOX_JOB_MIB.min, requested));
}
export const VOICEBOX_CPU_CORES = { default: 2, min: 1, max: 32 };
export function resolveVoiceboxCpuCores(env = process.env) {
  const parsed = Number.parseInt(env.KEEL_VOICEBOX_CPU_CORES ?? '', 10);
  const fromProfile = Number(profileRecommendation(env, 'voiceCores'));
  const requested = Number.isFinite(parsed) ? parsed : Number.isFinite(fromProfile) && fromProfile > 0 ? fromProfile : VOICEBOX_CPU_CORES.default;
  return Math.min(VOICEBOX_CPU_CORES.max, Math.max(VOICEBOX_CPU_CORES.min, requested));
}

// Umgebung des Voicebox-Kindprozesses. Seit Plan Schritt 1 (21.09.2026) gibt es keinen
// isolierten Modell-Cache und keinen Offline-Zwang mehr: der Kindprozess arbeitet auf dem
// Datenverzeichnis und dem Modell-Cache der Voicebox-App, Downloads laufen ausschliesslich
// ueber Voicebox' eigene Endpunkte (/models/download), angestossen aus dem Dashboard.
// KEEL_VOICEBOX_MODELS_DIR biegt den Cache ausdruecklich um (HF_HUB_CACHE + VOICEBOX_MODELS_DIR).
export function profileServiceEnvironment(env = process.env) {
  const voiceRoot = resolveVoiceRoot(env);
  const isolated = {
    ...isolatedVoiceEnvironment(env),
    CUDA_VISIBLE_DEVICES: '',
    NUMBA_DISABLE_JIT: '0',
    KEEL_VOICEBOX_JOB_MIB: String(resolveVoiceboxJobMiB(env)),
    KEEL_VOICEBOX_CPU_CORES: String(resolveVoiceboxCpuCores(env)),
    OMP_NUM_THREADS: String(resolveVoiceboxCpuCores(env)),
    MKL_NUM_THREADS: String(resolveVoiceboxCpuCores(env)),
    OPENBLAS_NUM_THREADS: String(resolveVoiceboxCpuCores(env)),
    KEEL_VOICEBOX_DATA_DIR: voiceboxDataDir(env),
    TEMP: path.join(voiceRoot, 'tmp'),
    TMP: path.join(voiceRoot, 'tmp'),
  };
  delete isolated.HF_HUB_OFFLINE;
  delete isolated.TRANSFORMERS_OFFLINE;
  if (env.KEEL_VOICEBOX_MODELS_DIR) {
    isolated.HF_HUB_CACHE = path.resolve(env.KEEL_VOICEBOX_MODELS_DIR);
    isolated.VOICEBOX_MODELS_DIR = isolated.HF_HUB_CACHE;
  }
  return isolated;
}

// The installed app's startup and profile routes are lazy: no TTS model loads.
// The server runs on the app's own data directory (voicebox.db), so the profiles the user
// created in the Voicebox app and the ones the dashboard creates are the same rows.
// P34 (B244, P23-N17): every message says what is wrong and what to do, and the service is the Stimmendienst -- the
// messages reach the owner through POST /api/accountability/voice/service ("Stimmendienst starten").
// P34-R2: `memory` names the threshold the start checks (at least 3 GB free, os.freemem() below), not an amount
// that is missing -- with 2.5 GB free, 0.5 GB are missing, not 3.
// harness-dashboard-repair Plan-Schritt 28 (Gate V2), gemessen 28.09.2026: gleich nach einem Stopp brauchte
// voicebox-server.exe (ein 513-MB-Einzelpaket, das sich beim Start entpackt) zweimal ueber 60 s, bevor es die erste
// Logzeile schrieb (profile-process.json: peakCommitMiB 2,2 bzw. 16,4), ein kalter Start sonst 20-21 s. Der Start bei
// Bedarf wartet deshalb bis zu 150 s statt nach 60 s abzubrechen.
export const START_DEADLINE_MS = 150000;
export const PROFILE_SERVICE_MESSAGES = {
  occupied: 'Der Port des Stimmendienstes ist von einem anderen oder hängenden Programm belegt; es wurde nichts beendet. Beende es oder starte den Rechner neu, dann starte erneut.',
  platform: 'Der Stimmendienst startet nur unter Windows. Auf diesem Rechner spricht die Cloud-Stimme.',
  memory: 'Zu wenig freier Arbeitsspeicher: Der Stimmendienst braucht zum Start mindestens 3 GB. Schließe andere Programme und starte ihn erneut.',
  notInstalled: 'Der Stimmendienst ist nicht installiert. Installiere ihn unter Einstellungen → Technik & Stimme → Sprache einrichten → „Stimmendienst installieren“.',
  python: 'Für den Start des Stimmendienstes fehlt Python. Die Schritte stehen unter Einstellungen → Technik & Stimme → Sprache einrichten → „Technische Einzelheiten“.',
  timeout: 'Der Stimmendienst wurde in 150 Sekunden nicht bereit und ist wieder beendet. Starte ihn erneut; Einzelheiten stehen in runtime/voice/profile-server.log.',
};

export async function startProfileService({ env = process.env, signal } = {}) {
  signal?.throwIfAborted();
  const existing = await probeProfileService(env);
  if (existing.available) return { base: existing.base, child: null, owned: false, stop: async () => {} };
  if (existing.occupied) throw new Error(PROFILE_SERVICE_MESSAGES.occupied);
  if (process.platform !== 'win32') throw new Error(PROFILE_SERVICE_MESSAGES.platform);
  if (os.freemem() < 3 * 1024 ** 3) throw new Error(PROFILE_SERVICE_MESSAGES.memory);
  const binary = voiceboxBinary(env);
  await fs.access(binary).catch(() => { throw new Error(PROFILE_SERVICE_MESSAGES.notInstalled); });
  const voiceRoot = resolveVoiceRoot(env);
  const dataDir = voiceboxDataDir(env);
  const python = discoverVoiceInstallation(env).voicePython;
  if (!python) throw new Error(PROFILE_SERVICE_MESSAGES.python);
  const temporary = path.join(voiceRoot, 'tmp');
  await fs.mkdir(temporary, { recursive: true });
  await fs.mkdir(dataDir, { recursive: true });
  const isolated = profileServiceEnvironment(env);
  const child = spawn(python, ['-B', '-u', path.join(sidecarRoot, 'profile-process.py'), '--binary', binary, '--port', new URL(existing.base).port, '--data-dir', dataDir, '--lifetime', '0'], { cwd: voiceRoot, env: isolated, stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true });
  let startupError;
  child.on('error', error => { startupError = error; });
  child.stdin.on('error', () => {});
  let stopping;
  const stop = () => stopping ||= (async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.stdin.end('stop\n');
    let timer;
    await Promise.race([new Promise(resolve => child.once('exit', resolve)), new Promise(resolve => { timer = setTimeout(resolve, 6000); })]);
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) child.kill();
  })();
  const abort = () => { void stop(); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const deadline = Date.now() + START_DEADLINE_MS;
    while (Date.now() < deadline && child.exitCode === null && child.signalCode === null && !startupError) {
      signal?.throwIfAborted();
      const status = await probeProfileService(env);
      if (status.available) return { base: existing.base, child, owned: true, dataDir, stop };
      await new Promise(resolve => setTimeout(resolve, 400));
    }
    throw startupError || new Error(PROFILE_SERVICE_MESSAGES.timeout);
  } catch (error) { await stop(); throw error; }
  finally { signal?.removeEventListener('abort', abort); }
}
