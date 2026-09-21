// Empfehlungsregeln (Paket system-profile, 21.09.2026): aus dem gemessenen Systemprofil je
// Einstellung EIN Wert und EIN Begruendungssatz. Reine Funktionen ohne Seiteneffekte, damit
// die Regeln als Einheit testbar sind und Konsole (voice/system-profile.mjs), Route
// (/api/accountability/system) und Dashboard dieselben Saetze zeigen.
//
// Grundsatz: Empfehlung ist Voreinstellung, nie Zwang — Umgebungsvariablen und die Wahl des
// Nutzers im Dashboard gewinnen. Wo eine Messung vorliegt (profile.measured), steht sie im Satz.

export const CORES = { min: 2, max: 12, reserve: 2 };
export const JOB_MIB = { min: 5120, max: 16384, share: 0.4 };
export const HEARING_TURBO_MIN = { cores: 8, totalMiB: 16000 };
export const WHISPER_OFFERED = ['base', 'large-v3-turbo'];

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const gb = mib => (mib / 1024).toFixed(0);

export function physicalCores(profile) {
  const physical = Number(profile?.cpu?.physicalCores);
  if (Number.isFinite(physical) && physical > 0) return physical;
  const logical = Number(profile?.cpu?.logicalProcessors);
  return Number.isFinite(logical) && logical > 0 ? Math.max(1, Math.floor(logical / 2)) : 2;
}

export function recommendVoiceCores(profile) {
  const cores = physicalCores(profile);
  const value = clamp(cores - CORES.reserve, CORES.min, CORES.max);
  const measured = profile?.measured?.speech;
  const measuredText = measured ? ` Gemessen mit ${measured.cores ?? value} Kernen: ${(measured.durationMs / 1000).toFixed(1)} s für ${measured.audioSeconds.toFixed(1)} s Audio.` : '';
  return { value, reason: `${cores} physische Kerne erkannt (${profile?.cpu?.model || 'CPU'}); ${CORES.reserve} bleiben für Dashboard und Browser frei, ${value} rechnen die Stimme.${measuredText}` };
}

export function recommendJobMiB(profile) {
  const total = Number(profile?.memory?.totalMiB) || 8192;
  const value = clamp(Math.round(total * JOB_MIB.share / 256) * 256, JOB_MIB.min, JOB_MIB.max);
  return { value, reason: `${gb(total)} GB Arbeitsspeicher erkannt; ${Math.round(JOB_MIB.share * 100)} % (${gb(value)} GB) darf der Stimmendienst höchstens belegen, damit Ollama und Browser Platz behalten.` };
}

export function recommendHearing(profile) {
  const cores = physicalCores(profile);
  const total = Number(profile?.memory?.totalMiB) || 0;
  const turbo = cores >= HEARING_TURBO_MIN.cores && total >= HEARING_TURBO_MIN.totalMiB;
  const measured = profile?.measured?.hearing;
  const measuredText = measured ? ` Gemessen (${measured.variant}): ${measured.durationMs} ms für ${measured.audioSeconds.toFixed(1)} s Audio.` : '';
  return turbo
    ? { value: 'large-v3-turbo', reason: `${cores} Kerne und ${gb(total)} GB RAM: Whisper Turbo (fast Large-Genauigkeit, ≈1,5 GB) läuft hier flüssig — genau für Diktat und Fachwörter; Base bleibt als schnelle Stufe wählbar.${measuredText}` }
    : { value: 'base', reason: `${cores} Kerne / ${gb(total)} GB RAM: Whisper Base reagiert am schnellsten und braucht 0,3 GB; Turbo bleibt wählbar, wenn Genauigkeit wichtiger ist.${measuredText}` };
}

export function recommendSpeechModel(profile) {
  const gpu = profile?.voicebox?.gpuAvailable === true;
  return { value: 'chatterbox-tts', reason: gpu
    ? 'Chatterbox Multilingual: eigene Stimme, Cortana und Jarvis aus der Referenz, Deutsch; Voicebox nutzt die GPU.'
    : 'Chatterbox Multilingual: eigene Stimme, Cortana und Jarvis aus der Referenz, Deutsch; rechnet auf der CPU, deshalb zählt die Kernzahl.' };
}

export function recommendGpu(profile) {
  const names = (profile?.gpus || []).map(gpu => gpu.name).filter(Boolean);
  const nvidia = names.some(name => /nvidia|geforce|rtx|quadro/i.test(name));
  const running = profile?.voicebox?.running === true;
  if (profile?.voicebox?.gpuAvailable === true) return { value: 'gpu', reason: `Voicebox nutzt die GPU (${profile.voicebox.gpuType || names[0] || 'erkannt'}).` };
  if (nvidia) return { value: 'cpu', reason: `NVIDIA-Karte erkannt (${names.join(', ')}), aber Voicebox meldet ${running ? 'CPU-Betrieb — CUDA-Backend in der Voicebox-App prüfen' : 'noch keinen Stand (Dienst läuft nicht)'}.` };
  return { value: 'cpu', reason: names.length ? `Grafikkarte ${names.join(', ')}: Voicebox nutzt nur NVIDIA/CUDA — Stimme und Hören rechnen auf der CPU.` : 'Keine Grafikkarte erkannt — Stimme und Hören rechnen auf der CPU.' };
}

export function recommendSettings(profile) {
  return {
    voiceCores: recommendVoiceCores(profile),
    voiceJobMiB: recommendJobMiB(profile),
    hearing: recommendHearing(profile),
    speechModel: recommendSpeechModel(profile),
    gpu: recommendGpu(profile),
    whisperOffered: { value: WHISPER_OFFERED.join(','), reason: 'Auf der CPU haben nur Base (schnell) und Turbo (genau, fast wie Large) einen Einsatz; Small/Medium/Large werden nicht angeboten.' },
  };
}
