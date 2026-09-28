import path from 'node:path';
import os from 'node:os';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Der Sidecar liegt als <harness>/voice neben dashboard/ und roles/. Er ist kein
// Teil des Next-Builds: das Dashboard laedt ihn erst zur Laufzeit ueber
// KEEL_VOICE_SIDECAR_ROOT (Default <KEEL_HARNESS_ROOT>/voice).
//
// Seit der Voicebox-Integration (Plan docs/packages/focus-dashboard-v4/design/
// voicebox-integration-2026-09-21.md) traegt der Sidecar nur noch den begrenzten START der
// installierten Voicebox (profile-service.mjs + profile-process.py). Stimme UND Hoeren laufen
// ueber Voicebox' eigene HTTP-API; der fruehere eigene Whisper-Dienst (stt-server.py, Port 4298)
// und der eigene Modelldownload (own-voice-model.ts) sind entfernt.
export const sidecarRoot = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(sidecarRoot, '..');
// Legacy-Fallback-Basis: das Repository, in dem die Harness-Installation liegt.
export const repositoryRoot = env => path.resolve(env?.KEEL_HARNESS_REPOSITORY_ROOT || path.dirname(root));
export const resolveVoiceRoot = (env = process.env) => path.resolve(env.KEEL_VOICE_ROOT || path.join(root, 'runtime', 'voice'));
export const voiceRoot = resolveVoiceRoot();
const executable = process.platform === 'win32' ? ['Scripts', 'python.exe'] : ['bin', 'python'];
const firstExisting = values => values.find(value => value && existsSync(value)) || null;

// Voicebox-Identitaet der Desktop-App (Tauri): ihr Datenverzeichnis traegt voicebox.db,
// profiles/ und generations/. Der Harness startet voicebox-server.exe auf GENAU diesem
// Verzeichnis, damit App und Dashboard dieselben Profile sehen (Plan Schritt 1).
// Gemessen 21.09.2026 (Win32): die App startet ihren Server mit
// --data-dir %APPDATA%\sh.voicebox.app. macOS/Linux folgen der Tauri-Konvention und sind
// hier ungemessen.
export const VOICEBOX_APP_IDENTIFIER = 'sh.voicebox.app';
export function voiceboxDataDir(env = process.env) {
  if (env.KEEL_VOICEBOX_DATA_DIR) return path.resolve(env.KEEL_VOICEBOX_DATA_DIR);
  if (process.platform === 'win32') return path.join(env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), VOICEBOX_APP_IDENTIFIER);
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', VOICEBOX_APP_IDENTIFIER);
  return path.join(env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), VOICEBOX_APP_IDENTIFIER);
}
export const voiceboxDatabase = (env = process.env) => path.join(voiceboxDataDir(env), 'voicebox.db');

// Modell-Cache: die App haelt ihre Modelle im Standard-Cache von huggingface_hub
// (gemessen 21.09.2026 ueber GET /models/cache-dir der App: %USERPROFILE%\.cache\huggingface\hub).
// Der Harness setzt deshalb KEINE eigene Cache-Wurzel mehr; KEEL_VOICEBOX_MODELS_DIR
// ueberschreibt sie ausdruecklich (wird als HF_HUB_CACHE an den Kindprozess gereicht).
export function voiceboxModelsDir(env = process.env) {
  if (env.KEEL_VOICEBOX_MODELS_DIR) return path.resolve(env.KEEL_VOICEBOX_MODELS_DIR);
  if (env.HF_HUB_CACHE) return path.resolve(env.HF_HUB_CACHE);
  if (env.HF_HOME) return path.join(path.resolve(env.HF_HOME), 'hub');
  if (env.XDG_CACHE_HOME) return path.join(path.resolve(env.XDG_CACHE_HOME), 'huggingface', 'hub');
  return path.join(os.homedir(), '.cache', 'huggingface', 'hub');
}

export function voiceboxBinary(env = process.env) {
  if (env.KEEL_VOICEBOX_BINARY) return path.resolve(env.KEEL_VOICEBOX_BINARY);
  if (process.platform === 'win32') return path.join(env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Voicebox', 'voicebox-server.exe');
  return path.join(os.homedir(), '.local', 'share', 'Voicebox', 'voicebox-server');
}

// Reihenfolge je Fundstelle: (1) ausdrueckliche Umgebungsvariable, (2) die eigene
// Sprachruntime dieser Installation, (3) ein ausdruecklich benannter Legacy-Pfad
// unter dem Repository-Root. Stufe 3 existiert nur, damit eine Werkbank mit den
// frueher eingerichteten Prototyp-Runtimes ohne Neuinstallation weiterlaeuft.
export function voiceDiscoveryPlan(env = process.env) {
  const voice = resolveVoiceRoot(env);
  const repository = repositoryRoot(env);
  return {
    voiceRoot: voice,
    repositoryRoot: repository,
    // Python fuer den begrenzten Voicebox-Start (profile-process.py steuert voicebox-server.exe; nur Standardbibliothek).
    // harness-dashboard-repair Plan-Schritt 28 (Gate V2, Inventar ET-57): fest an genau zwei Orten -- KEEL_VOICE_PYTHON
    // oder die eigene Umgebung <voiceRoot>/voicebox-env. Die frueheren Fallbacks (piper-env, stt-env und die Prototyp-
    // Runtimes unter focus-orb-prototype/ und focus-dashboard-v3/, unversionierte Altordner) sind entfernt: der Start
    // hing sonst still an einem Ordner, den kein Repository kennt. Anlegen: python -m venv <voiceRoot>/voicebox-env.
    voicePython: { key: 'KEEL_VOICE_PYTHON', label: 'Python für den Voicebox-Start', candidates: [env.KEEL_VOICE_PYTHON, path.join(voice, 'voicebox-env', ...executable)] },
    voicebox: { key: 'KEEL_VOICEBOX_BINARY', label: 'Voicebox-Server (voicebox-server.exe)', candidates: [voiceboxBinary(env)] },
    voiceboxData: { key: 'KEEL_VOICEBOX_DATA_DIR', label: 'Voicebox-Datenverzeichnis (voicebox.db der App)', candidates: [voiceboxDataDir(env)] },
    voiceboxModels: { key: 'KEEL_VOICEBOX_MODELS_DIR', label: 'Modell-Cache von Voicebox (huggingface hub)', candidates: [voiceboxModelsDir(env)] },
  };
}

export function discoverVoiceInstallation(env = process.env) {
  const plan = voiceDiscoveryPlan(env);
  const voicePython = firstExisting(plan.voicePython.candidates);
  const binary = firstExisting(plan.voicebox.candidates);
  const dataDir = plan.voiceboxData.candidates[0];
  const modelsDir = plan.voiceboxModels.candidates[0];
  return {
    version: 5, root, sidecarRoot, outputRoot: plan.voiceRoot, repositoryRoot: plan.repositoryRoot, freeMiB: Math.round(os.freemem() / 1048576),
    voicePython,
    voicebox: { binary, dataDir, database: path.join(dataDir, 'voicebox.db'), databasePresent: existsSync(path.join(dataDir, 'voicebox.db')), modelsDir, modelsDirPresent: existsSync(modelsDir) },
  };
}

export function loopbackAddress(raw, fallback) {
  const url = new URL(raw || fallback);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Sprachdienste benötigen eine reine lokale HTTP-Adresse.');
  return url.origin;
}

// Voicebox ist der einzige Sprachdienst: Stimme (/generate) und Hoeren (/transcribe).
export function serviceAddresses(env = process.env) {
  return {
    voicebox: loopbackAddress(env.ACCOUNTABILITY_VOICEBOX_URL, 'http://127.0.0.1:4299'),
  };
}

export function isolatedVoiceEnvironment(env = process.env) {
  const voice = resolveVoiceRoot(env);
  // KEEL_VOICE_ROOT wandert ausdruecklich mit: profile-process.py leitet daraus sein Log- und
  // Temporaerverzeichnis ab. Der Modell-Cache wird NICHT umgebogen (HF_HOME/XDG_CACHE_HOME
  // bleiben unangetastet), damit der Kindprozess denselben huggingface-Cache sieht wie die App.
  return { ...env, KEEL_VOICE_ROOT: voice, PYTHONDONTWRITEBYTECODE: '1', PYTHONUTF8: '1', OMP_NUM_THREADS: '2', MKL_NUM_THREADS: '2', OPENBLAS_NUM_THREADS: '2', HF_HUB_DISABLE_TELEMETRY: '1', NUMBA_CACHE_DIR: path.join(voice, 'cache', 'numba'), TORCH_HOME: path.join(voice, 'cache', 'torch') };
}
