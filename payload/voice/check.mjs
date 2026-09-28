import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverVoiceInstallation, serviceAddresses } from './config.mjs';
import { installationReport } from './install-report.mjs';
import { refreshProfile } from './system-profile.mjs';

// Installationspruefung: startet nichts und laedt nichts herunter. Je Stueck wird genau
// benannt, was fehlt und welche Umgebungsvariable es setzt. Die Pruefung selbst liegt in
// install-report.mjs, damit diese Konsole und die Dashboard-Route
// /api/accountability/voice/setup dieselben Saetze zeigen.
export { installationReport, voiceModelReport, hearingModelReport, voiceModelSnapshotDirectory, VOICE_MODEL, HEARING_MODELS } from './install-report.mjs';

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const installed = discoverVoiceInstallation();
  const addresses = serviceAddresses();
  const report = installationReport();
  // Systemprofil (Paket system-profile): misst CPU/RAM/GPU/Platte, schreibt runtime/voice/system-profile.json
  // und leitet die Voreinstellungen ab — bei der Installation und bei jedem check-Lauf.
  const system = await refreshProfile();
  // Laeuft Voicebox bereits? Nur lesen (/health, /models/status); es wird kein Modell geladen.
  const probe = async base => {
    try {
      const health = await fetch(base + '/health', { signal: AbortSignal.timeout(1500) }).then(r => r.json());
      const models = await fetch(base + '/models/status', { signal: AbortSignal.timeout(1500) }).then(r => r.json());
      const downloaded = (models.models || []).filter(model => model.downloaded).map(model => model.model_name);
      return { available: health.status === 'healthy', ready: health.status === 'healthy', downloaded, message: `Voicebox läuft auf ${base}; heruntergeladen: ${downloaded.join(', ') || 'nichts'}.` };
    } catch { return { available: false, ready: false, downloaded: [], message: 'Voicebox läuft nicht. Start über den Knopf „Stimmendienst starten“ oder POST /api/accountability/voice/service.' }; }
  };
  const voicebox = await probe(addresses.voicebox);
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), installation: report, installed, addresses, services: { voicebox }, system: { file: system.file, profile: system.profile, recommendations: system.recommendations } }, null, 2));
  const cpu = system.profile.cpu;
  console.error(`System: ${cpu.model || 'CPU'} (${cpu.physicalCores ?? '?'} Kerne / ${cpu.logicalProcessors ?? '?'} Threads), ${Math.round(system.profile.memory.totalMiB / 1024)} GB RAM, GPU ${system.profile.gpus.map(g => g.name).join(', ') || 'keine erkannt'} — Profil: ${system.file}`);
  for (const [key, item] of Object.entries(system.recommendations)) console.error(`  empfohlen ${key}: ${item.value} — ${item.reason}`);
  const section = report.voicebox;
  console.error(`Voicebox: ${section.installed ? 'installiert' : 'nicht vollständig installiert'} — ${section.message}`);
  for (const item of section.missing) {
    console.error(`  fehlt: ${item.label} — setzbar über ${item.env}; gesucht in: ${item.searched.join(' | ')}`);
    if (item.step) console.error(`    nächster Schritt: ${item.step}`);
    // P34-R1: the command stands alone on its line (copy the whole line), the other way after it.
    if (item.command) console.error(`      ${item.command}`);
    if (item.note) console.error(`    ${item.note}`);
  }
  const model = report.voiceModel;
  console.error(`Stimmenmodell (${model.displayName}, eigene Stimme): ${model.installed ? 'vollständig' : 'nicht vollständig'} — ${model.message}`);
  if (!model.installed) console.error(`    nächster Schritt: ${model.step}`);
  console.error(`Hören (Voicebox-Whisper): ${report.microphone.hearing.message}`);
  console.error(`Dienst: ${voicebox.message}`);
  if (process.argv.includes('--require-ready') && !voicebox.available) {
    console.error('--require-ready: Voicebox läuft nicht.');
    process.exitCode = 1;
  }
}
