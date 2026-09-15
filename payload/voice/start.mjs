import path from 'node:path';
import os from 'node:os';
import { mkdir } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { discoverVoiceInstallation, sidecarRoot, resolveVoiceRoot, serviceAddresses, isolatedVoiceEnvironment } from './config.mjs';

export function stopOwnedChild(child) {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    const result = spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    if (result.status !== 0) child.kill();
  }
  else child.kill('SIGTERM');
}

export async function startVoiceServices({ speech = true, microphone = true, env = process.env } = {}) {
  const installed = discoverVoiceInstallation(env);
  const addresses = serviceAddresses(env);
  const voiceRoot = resolveVoiceRoot(env);
  if (os.freemem() < 3 * 1024 ** 3) throw new Error('Weniger als 3 GiB freier RAM. Die kleinen Sprachdienste wurden nicht gestartet.');
  if (speech && !installed.piper.installed || microphone && !installed.transcription.installed) throw new Error('Eine lokale Sprachinstallation fehlt. node voice/check.mjs zeigt den genauen Rest. Es wurde nichts heruntergeladen.');
  await mkdir(voiceRoot, { recursive: true });
  const children = [];
  const owned = [];
  const stop = async () => {
    await Promise.all(owned.map(async service => {
      try { await fetch(service.url + '/shutdown', { method: 'POST', headers: { 'x-keel-service-token': service.token }, signal: AbortSignal.timeout(2500) }); } catch { /* Only this invocation's owned process is a fallback target. */ }
      await new Promise(resolve => setTimeout(resolve, 150));
      if (service.child.exitCode === null) stopOwnedChild(service.child);
    }));
  };
  const services = [
    ...(speech ? [{ url: addresses.speech, service: 'keel-v4-piper', command: process.execPath, args: [path.join(sidecarRoot, 'piper-server.mjs')] }] : []),
    ...(microphone ? [{ url: addresses.transcription, service: 'keel-v4-stt', command: installed.transcription.python, args: ['-u', path.join(sidecarRoot, 'stt-server.py')] }] : []),
  ];
  try {
    for (const service of services) {
      let existing;
      try { existing = await fetch(service.url + '/status', { signal: AbortSignal.timeout(1000) }).then(r => r.json()); } catch { /* A free address can be started. A conflicting listener makes the child fail without replacing it. */ }
      if (existing) {
        if (existing.service !== service.service) throw new Error(`${service.url} wird von einem anderen Dienst belegt. Kein vorhandener Server wurde beendet.`);
        continue;
      }
      const token = randomBytes(24).toString('hex');
      const childEnv = { ...isolatedVoiceEnvironment(env), KEEL_VOICE_SERVICE_TOKEN: token, KEEL_PROTOTYPE_PIPER_URL: addresses.speech, KEEL_PROTOTYPE_STT_URL: addresses.transcription, KEEL_STT_PORT: new URL(addresses.transcription).port, KEEL_VOICE_STT_MODEL: installed.transcription.model || '' };
      const child = spawn(service.command, service.args, { cwd: voiceRoot, env: childEnv, windowsHide: true, stdio: 'inherit' });
      children.push(child);
      owned.push({ ...service, child, token });
      child.on('error', error => console.error(`${service.service}: ${error.message}`));
      const deadline = Date.now() + 30000;
      let ready = false;
      while (Date.now() < deadline && child.exitCode === null) {
        await new Promise(resolve => setTimeout(resolve, 250));
        try { const status = await fetch(service.url + '/status', { signal: AbortSignal.timeout(800) }).then(r => r.json()); ready = status.service === service.service && Boolean(status.ready || status.available); } catch { /* bounded warmup */ }
        if (ready) break;
      }
      if (!ready) throw new Error(`${service.service} wurde innerhalb von 30 Sekunden nicht bereit. Prüfe node voice/check.mjs.`);
    }
    return { children, addresses, stop };
  } catch (error) { await stop(); throw error; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const services = await startVoiceServices({ speech: !process.argv.includes('--stt-only'), microphone: !process.argv.includes('--speech-only') });
  console.log(JSON.stringify({ ready: true, services: services.addresses, note: 'Nur Piper und Whisper sind gestartet. Kein Mikrofon und kein Sprachmodell für Agentenantworten wurde geöffnet.' }));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void services.stop(); process.exitCode = 0; });
}
