import path from 'node:path';
import os from 'node:os';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Der Sidecar liegt als <harness>/voice neben dashboard/ und roles/. Er ist kein
// Teil des Next-Builds: das Dashboard laedt ihn erst zur Laufzeit ueber
// KEEL_VOICE_SIDECAR_ROOT (Default <KEEL_HARNESS_ROOT>/voice).
export const sidecarRoot = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(sidecarRoot, '..');
// Legacy-Fallback-Basis: das Repository, in dem die Harness-Installation liegt.
export const repositoryRoot = env => path.resolve(env?.KEEL_HARNESS_REPOSITORY_ROOT || path.dirname(root));
export const resolveVoiceRoot = (env = process.env) => path.resolve(env.KEEL_VOICE_ROOT || path.join(root, 'runtime', 'voice'));
export const voiceRoot = resolveVoiceRoot();
const executable = process.platform === 'win32' ? ['Scripts', 'python.exe'] : ['bin', 'python'];
const firstExisting = values => values.find(value => value && existsSync(value)) || null;

// Reihenfolge je Fundstelle: (1) ausdrueckliche Umgebungsvariable, (2) die eigene
// Sprachruntime dieser Installation, (3) ein ausdruecklich benannter Legacy-Pfad
// unter dem Repository-Root. Stufe 3 existiert nur, damit eine Werkbank mit den
// frueher eingerichteten Prototyp-Runtimes ohne Neuinstallation weiterlaeuft.
export function voiceDiscoveryPlan(env = process.env) {
  const voice = resolveVoiceRoot(env);
  const repository = repositoryRoot(env);
  const orb = path.join(repository, 'focus-orb-prototype', 'runtime');
  const previous = path.join(repository, 'focus-dashboard-v3', 'runtime');
  return {
    voiceRoot: voice,
    repositoryRoot: repository,
    piperPython: { key: 'KEEL_VOICE_PIPER_PYTHON', label: 'Piper-Python', candidates: [env.KEEL_VOICE_PIPER_PYTHON, path.join(voice, 'piper-env', ...executable), path.join(orb, 'piper-env', ...executable)] },
    sttPython: { key: 'KEEL_VOICE_STT_PYTHON', label: 'Whisper-Python', candidates: [env.KEEL_VOICE_STT_PYTHON, path.join(voice, 'stt-env', ...executable), path.join(previous, 'stt-env', ...executable)] },
    piperDe: { key: 'KEEL_VOICE_PIPER_DE', label: 'Piper-Stimme Deutsch (Thorsten)', candidates: [env.KEEL_VOICE_PIPER_DE, path.join(voice, 'models', 'de_DE-thorsten-high.onnx'), path.join(orb, 'piper-models', 'de_DE-thorsten-high.onnx')] },
    piperEn: { key: 'KEEL_VOICE_PIPER_EN', label: 'Piper-Stimme Englisch (Lessac)', candidates: [env.KEEL_VOICE_PIPER_EN, path.join(voice, 'models', 'en_US-lessac-medium.onnx'), path.join(previous, 'piper-models', 'en_US-lessac-medium.onnx')] },
    sttModel: { key: 'KEEL_VOICE_STT_MODEL', label: 'Whisper-Modell (faster-whisper base)', candidates: [env.KEEL_VOICE_STT_MODEL, path.join(voice, 'models', 'whisper-base'), path.join(previous, 'stt-models', 'base')] },
  };
}

export function discoverVoiceInstallation(env = process.env) {
  const plan = voiceDiscoveryPlan(env);
  const piperPython = firstExisting(plan.piperPython.candidates);
  const sttPython = firstExisting(plan.sttPython.candidates);
  const de = firstExisting(plan.piperDe.candidates);
  const en = firstExisting(plan.piperEn.candidates);
  const sttModel = firstExisting(plan.sttModel.candidates);
  const sttModelReady = Boolean(sttModel && existsSync(path.join(sttModel, 'model.bin')) && existsSync(path.join(sttModel, 'config.json')));
  return {
    version: 4, root, sidecarRoot, outputRoot: plan.voiceRoot, repositoryRoot: plan.repositoryRoot, freeMiB: Math.round(os.freemem() / 1048576),
    piper: { installed: Boolean(piperPython && (de || en)), python: piperPython, models: [{ id: 'piper-de', label: 'Piper · Thorsten', language: 'de', model: de }, { id: 'piper-en', label: 'Piper · Lessac', language: 'en', model: en }].map(voice => ({ ...voice, available: Boolean(voice.model && existsSync(voice.model + '.json')) })) },
    transcription: { installed: Boolean(sttPython && sttModelReady), python: sttPython, model: sttModel, modelReady: sttModelReady, modelName: 'faster-whisper base', device: 'cpu', computeType: 'int8', threads: 2 },
  };
}

export function loopbackAddress(raw, fallback) {
  const url = new URL(raw || fallback);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Sprachdienste benötigen eine reine lokale HTTP-Adresse.');
  return url.origin;
}

export function serviceAddresses(env = process.env) {
  return {
    speech: loopbackAddress(env.KEEL_PROTOTYPE_PIPER_URL, 'http://127.0.0.1:4297'),
    transcription: loopbackAddress(env.KEEL_PROTOTYPE_STT_URL, 'http://127.0.0.1:4298'),
  };
}

export function isolatedVoiceEnvironment(env = process.env) {
  const voice = resolveVoiceRoot(env);
  // KEEL_VOICE_ROOT wandert ausdruecklich mit: profile-process.py leitet daraus
  // sein Log-, Profil- und Temporaerverzeichnis ab.
  return { ...env, KEEL_VOICE_ROOT: voice, PYTHONDONTWRITEBYTECODE: '1', PYTHONUTF8: '1', OMP_NUM_THREADS: '2', MKL_NUM_THREADS: '2', OPENBLAS_NUM_THREADS: '2', HF_HUB_OFFLINE: '1', HF_HUB_DISABLE_TELEMETRY: '1', HF_HOME: path.join(voice, 'cache', 'huggingface'), XDG_CACHE_HOME: path.join(voice, 'cache'), NUMBA_CACHE_DIR: path.join(voice, 'cache', 'numba'), TORCH_HOME: path.join(voice, 'cache', 'torch') };
}
