import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { resolveVoiceRoot, voiceDiscoveryPlan } from './config.mjs';

// Einrichtungshilfe: prueft den Installationsstand OHNE Dienststart und ohne Netz. Je
// fehlendem Stueck nennt der Bericht Namen, Umgebungsvariable, die durchsuchten Pfade und
// den naechsten Schritt in einem Satz. `voice/check.mjs` (CLI) und die Dashboard-Route
// /api/accountability/voice/setup laden genau diese Funktion, damit Konsole und
// Oberflaeche nie verschiedene Saetze zeigen.

const found = entry => entry.candidates.find(value => value && existsSync(value)) || null;
const whisperReady = value => Boolean(value && existsSync(path.join(value, 'model.bin')) && existsSync(path.join(value, 'config.json')));
const sizeOf = file => { try { const stat = statSync(file); return stat.isFile() ? stat.size : null; } catch { return null; } };

// Das Stimmenmodell fuer eigene Stimmen sowie die Presets Cortana/Jarvis liegt im
// isolierten Cache unter KEEL_VOICE_ROOT. Revision, Repository und Dateisatz sind
// identisch mit dashboard/lib/companion/own-voice-model.ts (ALLOWED_FILES) und
// server-runtime.ts (readOwnVoiceSynthesisStatus) -- hier nur lesend gespiegelt.
export const VOICE_MODEL = {
  id: 'qwen-tts-0.6B',
  displayName: 'Qwen3-TTS 0.6B',
  repository: 'Qwen/Qwen3-TTS-12Hz-0.6B-Base',
  revision: '5d83992436eae1d760afd27aff78a71d676296fc',
  downloadSize: 'ca. 2,52 GB',
  files: [
    '.gitattributes', 'README.md', 'config.json', 'generation_config.json', 'merges.txt',
    'model.safetensors', 'preprocessor_config.json', 'tokenizer_config.json', 'vocab.json',
    'speech_tokenizer/config.json', 'speech_tokenizer/configuration.json',
    'speech_tokenizer/model.safetensors', 'speech_tokenizer/preprocessor_config.json',
  ],
};

export const voiceModelCacheRoot = (env = process.env) =>
  path.join(resolveVoiceRoot(env), 'cache', 'hub', `models--${VOICE_MODEL.repository.replace('/', '--')}`);
export const voiceModelSnapshotDirectory = (env = process.env) =>
  path.join(voiceModelCacheRoot(env), 'snapshots', VOICE_MODEL.revision);

// Modellstand allein aus dem Dateisatz. Vorhandene Dateien belegen weder eine geladene
// Modellinstanz noch einen geprueften Klang -- genau wie in own-voice-model.ts.
export function voiceModelReport(env = process.env) {
  const directory = voiceModelSnapshotDirectory(env);
  const files = VOICE_MODEL.files.map(name => {
    const file = path.join(directory, ...name.split('/'));
    const bytes = sizeOf(file);
    return { name, file, present: Boolean(bytes), bytes };
  });
  const absent = files.filter(file => !file.present);
  return {
    id: VOICE_MODEL.id, displayName: VOICE_MODEL.displayName, repository: VOICE_MODEL.repository,
    revision: VOICE_MODEL.revision, downloadSize: VOICE_MODEL.downloadSize,
    directory, installed: absent.length === 0, expectedFiles: VOICE_MODEL.files,
    files, missingFiles: absent.map(file => file.name),
    step: absent.length === 0
      ? 'Der Dateisatz ist vollständig. Geladen oder klanglich geprüft ist das Modell damit noch nicht.'
      : `Lege die ${VOICE_MODEL.files.length} Dateien der gepinnten Revision ${VOICE_MODEL.revision} nach ${directory} (Unterordner speech_tokenizer bleibt erhalten) oder starte den Download in den Einstellungen unter „Modell für eigene Stimmen“; KEEL_VOICE_ROOT verschiebt die ganze Schreibwurzel.`,
    message: absent.length === 0
      ? `Alle ${VOICE_MODEL.files.length} Dateien der gepinnten Revision liegen in ${directory}.`
      : `${absent.length} von ${VOICE_MODEL.files.length} Dateien fehlen in ${directory}.`,
  };
}

export function installationReport(env = process.env) {
  const plan = voiceDiscoveryPlan(env);
  const parts = {
    piperPython: found(plan.piperPython), sttPython: found(plan.sttPython),
    piperDe: found(plan.piperDe), piperEn: found(plan.piperEn), sttModel: found(plan.sttModel),
  };
  const steps = {
    KEEL_VOICE_PIPER_PYTHON: `Lege eine Python-Umgebung mit installiertem piper-tts unter ${path.join(plan.voiceRoot, 'piper-env')} ab (Windows: Scripts\\python.exe, sonst bin/python) oder setze KEEL_VOICE_PIPER_PYTHON auf einen Interpreter, in dem piper-tts installiert ist.`,
    KEEL_VOICE_PIPER_DE: `Lege de_DE-thorsten-high.onnx samt der gleichnamigen .onnx.json nach ${path.join(plan.voiceRoot, 'models')} oder setze KEEL_VOICE_PIPER_DE auf die .onnx-Datei.`,
    KEEL_VOICE_PIPER_EN: `Lege en_US-lessac-medium.onnx samt der gleichnamigen .onnx.json nach ${path.join(plan.voiceRoot, 'models')} oder setze KEEL_VOICE_PIPER_EN auf die .onnx-Datei.`,
    KEEL_VOICE_STT_PYTHON: `Lege eine Python-Umgebung mit installiertem faster-whisper unter ${path.join(plan.voiceRoot, 'stt-env')} ab (Windows: Scripts\\python.exe, sonst bin/python) oder setze KEEL_VOICE_STT_PYTHON auf einen Interpreter, in dem faster-whisper installiert ist.`,
    KEEL_VOICE_STT_MODEL: `Lege den faster-whisper-Ordner „base“ mit model.bin und config.json nach ${path.join(plan.voiceRoot, 'models', 'whisper-base')} oder setze KEEL_VOICE_STT_MODEL auf diesen Ordner.`,
  };
  const missing = entry => ({ label: entry.label, env: entry.key, searched: entry.candidates.filter(Boolean), step: steps[entry.key] });
  const speechMissing = [];
  if (!parts.piperPython) speechMissing.push(missing(plan.piperPython));
  if (!parts.piperDe && !parts.piperEn) speechMissing.push(missing(plan.piperDe), missing(plan.piperEn));
  const microphoneMissing = [];
  if (!parts.sttPython) microphoneMissing.push(missing(plan.sttPython));
  if (!whisperReady(parts.sttModel)) microphoneMissing.push({ ...missing(plan.sttModel), note: 'Der Ordner braucht model.bin und config.json.' });
  // Eine Piper-Stimme ist erst mit ihrer .onnx.json benutzbar (config.mjs prueft dasselbe
  // fuer `available`). Der Starter bricht deswegen nicht ab; die Warnung nennt den Fall,
  // ohne den bestehenden `installed`-Vertrag von speech zu veraendern.
  const voices = [['de', plan.piperDe, parts.piperDe], ['en', plan.piperEn, parts.piperEn]].map(([language, entry, model]) => ({
    language, label: entry.label, env: entry.key, model,
    configFile: model ? `${model}.json` : null,
    configPresent: Boolean(model && existsSync(`${model}.json`)),
  }));
  const warnings = voices.filter(voice => voice.model && !voice.configPresent).map(voice => ({
    label: voice.label, env: voice.env,
    message: `${voice.label}: ${voice.model} liegt vor, die zugehörige ${voice.configFile} fehlt. Ohne diese Datei bleibt die Stimme unbenutzbar.`,
    step: steps[voice.env],
  }));
  return {
    voiceRoot: plan.voiceRoot, repositoryRoot: plan.repositoryRoot,
    speech: { installed: speechMissing.length === 0, python: parts.piperPython, de: parts.piperDe, en: parts.piperEn, voices, warnings, missing: speechMissing },
    microphone: { installed: microphoneMissing.length === 0, python: parts.sttPython, model: parts.sttModel, missing: microphoneMissing },
    voiceModel: voiceModelReport(env),
  };
}
