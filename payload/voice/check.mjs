import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverVoiceInstallation, serviceAddresses, voiceDiscoveryPlan } from './config.mjs';

// Installationspruefung: startet nichts und laedt nichts herunter. Je Dienst wird
// genau benannt, welches Stueck fehlt und welche Umgebungsvariable es setzt.
const found = entry => entry.candidates.find(value => value && existsSync(value)) || null;
const whisperReady = value => Boolean(value && existsSync(path.join(value, 'model.bin')) && existsSync(path.join(value, 'config.json')));

export function installationReport(env = process.env) {
  const plan = voiceDiscoveryPlan(env);
  const parts = {
    piperPython: found(plan.piperPython), sttPython: found(plan.sttPython),
    piperDe: found(plan.piperDe), piperEn: found(plan.piperEn), sttModel: found(plan.sttModel),
  };
  const missing = entry => ({ label: entry.label, env: entry.key, searched: entry.candidates.filter(Boolean) });
  const speechMissing = [];
  if (!parts.piperPython) speechMissing.push(missing(plan.piperPython));
  if (!parts.piperDe && !parts.piperEn) speechMissing.push(missing(plan.piperDe), missing(plan.piperEn));
  const microphoneMissing = [];
  if (!parts.sttPython) microphoneMissing.push(missing(plan.sttPython));
  if (!whisperReady(parts.sttModel)) microphoneMissing.push({ ...missing(plan.sttModel), note: 'Der Ordner braucht model.bin und config.json.' });
  return {
    voiceRoot: plan.voiceRoot, repositoryRoot: plan.repositoryRoot,
    speech: { installed: speechMissing.length === 0, python: parts.piperPython, de: parts.piperDe, en: parts.piperEn, missing: speechMissing },
    microphone: { installed: microphoneMissing.length === 0, python: parts.sttPython, model: parts.sttModel, missing: microphoneMissing },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const installed = discoverVoiceInstallation();
  const addresses = serviceAddresses();
  const report = installationReport();
  const probe = async url => {
    try { const response = await fetch(url + '/status', { signal: AbortSignal.timeout(1500) }); return { status: response.status, ...(await response.json()) }; }
    catch { return { available: false, ready: false, message: 'Dienst ist nicht gestartet. Die Installationsprüfung startet keine Modelle.' }; }
  };
  const [speech, transcription] = await Promise.all([probe(addresses.speech), probe(addresses.transcription)]);
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), installation: report, installed, addresses, services: { speech, transcription } }, null, 2));
  for (const [kind, section] of [['Sprachausgabe (Piper)', report.speech], ['Mikrofon (Whisper)', report.microphone]]) {
    if (section.installed) { console.error(`${kind}: installiert.`); continue; }
    console.error(`${kind}: nicht vollständig installiert.`);
    for (const item of section.missing) console.error(`  fehlt: ${item.label} — setzbar über ${item.env}${item.note ? ` (${item.note})` : ''}; gesucht in: ${item.searched.join(' | ')}`);
  }
  if (process.argv.includes('--require-ready') && (!speech.ready || !transcription.available)) {
    console.error('--require-ready: Piper und Whisper laufen nicht beide. Start über node dashboard/serve.mjs --voice.');
    process.exitCode = 1;
  }
}
