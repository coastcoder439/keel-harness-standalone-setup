import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverVoiceInstallation, serviceAddresses } from './config.mjs';
import { installationReport } from './install-report.mjs';

// Installationspruefung: startet nichts und laedt nichts herunter. Je Dienst wird
// genau benannt, welches Stueck fehlt und welche Umgebungsvariable es setzt. Die
// Pruefung selbst liegt in install-report.mjs, damit diese Konsole und die
// Dashboard-Route /api/accountability/voice/setup dieselben Saetze zeigen.
export { installationReport, voiceModelReport, voiceModelSnapshotDirectory, VOICE_MODEL } from './install-report.mjs';

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
    if (section.installed) { console.error(`${kind}: installiert.`); }
    else {
      console.error(`${kind}: nicht vollständig installiert.`);
      for (const item of section.missing) {
        console.error(`  fehlt: ${item.label} — setzbar über ${item.env}${item.note ? ` (${item.note})` : ''}; gesucht in: ${item.searched.join(' | ')}`);
        if (item.step) console.error(`    nächster Schritt: ${item.step}`);
      }
    }
    for (const warning of section.warnings || []) console.error(`  Hinweis: ${warning.message}\n    nächster Schritt: ${warning.step}`);
  }
  const model = report.voiceModel;
  console.error(`Stimmenmodell (${model.displayName}, eigene Stimme sowie Cortana/Jarvis): ${model.installed ? 'vollständig' : 'nicht vollständig'} — ${model.message}`);
  if (!model.installed) console.error(`    nächster Schritt: ${model.step}`);
  if (process.argv.includes('--require-ready') && (!speech.ready || !transcription.available)) {
    console.error('--require-ready: Piper und Whisper laufen nicht beide. Start über node dashboard/serve.mjs --voice.');
    process.exitCode = 1;
  }
}
