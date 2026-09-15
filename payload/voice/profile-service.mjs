import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { sidecarRoot, resolveVoiceRoot, discoverVoiceInstallation, isolatedVoiceEnvironment, loopbackAddress } from './config.mjs';

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
// previous 2560 MiB ceiling (own-voice-model.ts observedFailedPeakMiB 4015.5), so the default is
// 5 GiB. KEEL_VOICEBOX_JOB_MIB overrides it within a safe band: never below the historical
// 2560 MiB floor, never above a 16 GiB rail (the >=3 GiB free-RAM start check and two-core cap in
// this file / profile-process.py are unaffected). The resolved value is exported into the child's
// isolated environment; profile-process.py reads it there to size its Job Object commit ceiling.
const VOICEBOX_JOB_MIB = { default: 5120, min: 2560, max: 16384 };
export function resolveVoiceboxJobMiB(env = process.env) {
  const parsed = Number.parseInt(env.KEEL_VOICEBOX_JOB_MIB ?? '', 10);
  const requested = Number.isFinite(parsed) ? parsed : VOICEBOX_JOB_MIB.default;
  return Math.min(VOICEBOX_JOB_MIB.max, Math.max(VOICEBOX_JOB_MIB.min, requested));
}

export function profileServiceEnvironment(env = process.env) {
  const voiceRoot = resolveVoiceRoot(env);
  const isolated = {
    ...isolatedVoiceEnvironment(env),
    HF_HUB_CACHE: path.join(voiceRoot, 'cache', 'hub'),
    VOICEBOX_MODELS_DIR: path.join(voiceRoot, 'cache', 'hub'),
    HF_HUB_OFFLINE: '1',
    TRANSFORMERS_OFFLINE: '1',
    CUDA_VISIBLE_DEVICES: '',
    NUMBA_DISABLE_JIT: '0',
    KEEL_VOICEBOX_JOB_MIB: String(resolveVoiceboxJobMiB(env)),
    TEMP: path.join(voiceRoot, 'tmp'),
    TMP: path.join(voiceRoot, 'tmp'),
  };
  return isolated;
}

// The installed app's startup and profile routes are lazy: no TTS model loads.
// Reuse its isolated database, including the user's existing profiles and samples.
export async function startProfileService({ env = process.env, signal } = {}) {
  signal?.throwIfAborted();
  const existing = await probeProfileService(env);
  if (existing.available) return { base: existing.base, child: null, owned: false, stop: async () => {} };
  if (existing.occupied) throw new Error('Der lokale Voicebox-Port ist durch einen anderen oder fehlerhaften Dienst belegt. Es wurde kein bestehender Prozess beendet.');
  if (process.platform !== 'win32') throw new Error('Der installierte Profilservice benötigt den begrenzten Windows-Start.');
  if (os.freemem() < 3 * 1024 ** 3) throw new Error('Für den begrenzten Stimmendienst werden mindestens 3 GiB freier Arbeitsspeicher benötigt.');
  const binary = env.KEEL_VOICEBOX_BINARY || path.join(env.LOCALAPPDATA || '', 'Voicebox', 'voicebox-server.exe');
  await fs.access(binary).catch(() => { throw new Error('Die vorhandene Voicebox-Installation wurde nicht gefunden. Es wurde nichts installiert.'); });
  const voiceRoot = resolveVoiceRoot(env);
  const python = discoverVoiceInstallation(env).piper.python;
  if (!python) throw new Error('Der vorhandene lokale Python-Interpreter für den begrenzten Dienststart fehlt.');
  const temporary = path.join(voiceRoot, 'tmp');
  await fs.mkdir(temporary, { recursive: true });
  const isolated = profileServiceEnvironment(env);
  const child = spawn(python, ['-B', '-u', path.join(sidecarRoot, 'profile-process.py'), '--binary', binary, '--port', new URL(existing.base).port, '--lifetime', '0'], { cwd: voiceRoot, env: isolated, stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true });
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
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline && child.exitCode === null && child.signalCode === null && !startupError) {
      signal?.throwIfAborted();
      const status = await probeProfileService(env);
      if (status.available) return { base: existing.base, child, owned: true, stop };
      await new Promise(resolve => setTimeout(resolve, 400));
    }
    throw startupError || new Error('Voicebox wurde innerhalb von 60 Sekunden nicht bereit. Details: runtime/voice/profile-server.log. Ein gestarteter eigener Prozess wurde beendet.');
  } catch (error) { await stop(); throw error; }
  finally { signal?.removeEventListener('abort', abort); }
}
