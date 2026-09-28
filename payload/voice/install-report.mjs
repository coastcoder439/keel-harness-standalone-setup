import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { voiceDiscoveryPlan, voiceboxModelsDir } from './config.mjs';

// Einrichtungshilfe: prueft den Installationsstand OHNE Dienststart und ohne Netz. Je
// fehlendem Stueck nennt der Bericht Namen, Umgebungsvariable, die durchsuchten Pfade und
// den naechsten Schritt (`step`), dazu einen Befehl zum Abtippen als eigenes Feld (`command`)
// und den anderen Weg (`note`). `voice/check.mjs` (CLI) und die Dashboard-Route
// /api/accountability/voice/setup laden genau diese Funktion, damit Konsole und
// Oberflaeche nie verschiedene Saetze zeigen.
//
// Seit der Voicebox-Integration (21.09.2026) gibt es genau einen Sprachdienst: Voicebox.
// Geprueft werden das Binary, das Datenverzeichnis der App (voicebox.db) und der gemeinsame
// Modell-Cache; welche Modelle Voicebox darin als heruntergeladen fuehrt, sagt der LAUFENDE
// Dienst ueber /models/status (Dashboard-Route /api/accountability/voice/models).

const found = entry => entry.candidates.find(value => value && existsSync(value)) || null;
const sizeOf = file => { try { const stat = statSync(file); return stat.isFile() ? stat.size : null; } catch { return null; } };

// Das Standard-Stimmenmodell fuer Klonstimmen (eigene Stimme, Cortana, Jarvis): Chatterbox
// Multilingual (Owner 21.09.2026 — mehrsprachig inkl. Deutsch, Referenzklon, Emotion). Dateisatz
// und Revision gemessen im Voicebox-Cache am 21.09.2026 (~/.cache/huggingface/hub); ob eine andere
// Revision im Cache liegt, entscheidet nicht der Harness, sondern Voicebox.
export const VOICE_MODEL = {
  id: 'chatterbox-tts',
  displayName: 'Chatterbox Multilingual',
  repository: 'ResembleAI/chatterbox',
  revision: '5bb1f6ee58e50c3b8d408bc82a6d3740c2db6e18',
  downloadSize: 'ca. 3,0 GB',
  files: [
    'Cangjie5_TC.json', 'conds.pt', 'grapheme_mtl_merged_expanded_v1.json',
    's3gen.pt', 't3_mtl23ls_v2.safetensors', 've.pt',
  ],
};

// Die Whisper-Eintraege von Voicebox (Hoeren), gespiegelt in
// dashboard/lib/companion/voicebox-hearing.ts (HEARING_STAGES). Zwei Stufen Schnell/Genau (Paket system-profile).
export const HEARING_MODELS = [
  { variant: 'base', model_name: 'whisper-base', repository: 'openai/whisper-base', stage: 'Schnell' },
  { variant: 'large-v3-turbo', model_name: 'whisper-turbo', repository: 'openai/whisper-large-v3-turbo', stage: 'Genau' },
];

export const voiceModelCacheRoot = (env = process.env, repository = VOICE_MODEL.repository) =>
  path.join(voiceboxModelsDir(env), `models--${repository.replace('/', '--')}`);
export const voiceModelSnapshotDirectory = (env = process.env) =>
  path.join(voiceModelCacheRoot(env), 'snapshots', VOICE_MODEL.revision);

// Alle Snapshot-Ordner eines gecachten HF-Repos (huggingface_hub-Layout models--org--name/snapshots/<rev>).
function snapshotDirectories(cacheRoot) {
  try {
    const snapshots = path.join(cacheRoot, 'snapshots');
    return readdirSync(snapshots, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => path.join(snapshots, entry.name));
  } catch { return []; }
}

// Modellstand allein aus dem Dateisatz im gemeinsamen Cache. Vorhandene Dateien belegen weder
// eine geladene Modellinstanz noch einen geprueften Klang. Jede Revision mit vollem Dateisatz
// zaehlt, weil Voicebox selbst die Revision waehlt.
export function voiceModelReport(env = process.env) {
  const pinned = voiceModelSnapshotDirectory(env);
  const candidates = [pinned, ...snapshotDirectories(voiceModelCacheRoot(env)).filter(directory => directory !== pinned)];
  let best = null;
  for (const directory of candidates) {
    const files = VOICE_MODEL.files.map(name => {
      const file = path.join(directory, ...name.split('/'));
      const bytes = sizeOf(file);
      return { name, file, present: Boolean(bytes), bytes };
    });
    const absent = files.filter(file => !file.present);
    if (!best || absent.length < best.absent.length) best = { directory, files, absent };
    if (absent.length === 0) break;
  }
  const { directory, files, absent } = best;
  return {
    id: VOICE_MODEL.id, displayName: VOICE_MODEL.displayName, repository: VOICE_MODEL.repository,
    revision: VOICE_MODEL.revision, downloadSize: VOICE_MODEL.downloadSize,
    directory, installed: absent.length === 0, expectedFiles: VOICE_MODEL.files,
    files, missingFiles: absent.map(file => file.name),
    step: absent.length === 0
      ? 'Der Dateisatz ist vollständig. Geladen oder klanglich geprüft ist das Modell damit noch nicht.'
      // P34 (B244, P23-N18): the place that exists -- the card "Stimmen-Modelle" in the group "Technik & Stimme".
      : `Lade „${VOICE_MODEL.displayName}“ unter Einstellungen → Technik & Stimme → Stimmen-Modelle herunter (Ziel: ${voiceboxModelsDir(env)}); KEEL_VOICEBOX_MODELS_DIR verschiebt den gemeinsamen Modell-Cache.`,
    message: absent.length === 0
      ? `Alle ${VOICE_MODEL.files.length} Dateien liegen in ${directory}.`
      : `${absent.length} von ${VOICE_MODEL.files.length} Dateien fehlen in ${directory}.`,
  };
}

// Hoeren: liegt das gewaehlte Whisper-Repo im gemeinsamen Cache? Nur Dateien, kein Dienst.
export function hearingModelReport(env = process.env, variant = 'base') {
  const model = HEARING_MODELS.find(item => item.variant === variant) || HEARING_MODELS[0];
  const cacheRoot = voiceModelCacheRoot(env, model.repository);
  const snapshots = snapshotDirectories(cacheRoot);
  const installed = snapshots.some(directory => existsSync(path.join(directory, 'config.json')));
  return {
    variant: model.variant, model_name: model.model_name, repository: model.repository, stage: model.stage,
    directory: cacheRoot, installed,
    message: installed ? `Whisper „${model.stage}“ (${model.model_name}) liegt in ${cacheRoot}.` : `Whisper „${model.stage}“ (${model.model_name}) fehlt in ${cacheRoot}; herunterladen unter Einstellungen → Technik & Stimme → Sprache → „Alle Whisper-Modelle“.`,
  };
}

// P34 (B244, P23-A1): the Python step is a guide a person can follow -- which Python, where from, the one command
// that creates the environment the start looks for first (voice/config.mjs: <voiceRoot>/voicebox-env), and how the
// Einstellungen notice it. voice/profile-process.py needs only the standard library, so any Python 3.11 or newer works.
// P34-R1 (E30): a gap carries the text a person reads (`step`), the command a person types as a field of its own
// (`command`: shown as <code> on a line of its own by VoiceModelSetup.tsx, printed alone on a line by voice/check.mjs --
// never inside a sentence, so no full stop is copied with it) and the other way (`note`). The environment variable is
// not repeated in the sentences: it is the gap's `env`, shown once, as a literal, beside them.
export const PYTHON_VERSION = '3.11';
export function pythonSetupGuide(plan, platform = process.platform) {
  const venv = path.join(plan.voiceRoot, 'voicebox-env');
  const windows = platform === 'win32';
  return {
    step: windows
      ? `Installiere Python ${PYTHON_VERSION} von python.org und kreuze dabei „Add python.exe to PATH“ an. Führe danach in PowerShell den Befehl darunter aus und wähle dann in den Einstellungen „Stimmstatus erneut prüfen“.`
      : `Installiere Python ${PYTHON_VERSION} oder neuer. Führe danach im Terminal den Befehl darunter aus und wähle dann in den Einstellungen „Stimmstatus erneut prüfen“.`,
    command: windows ? `py -${PYTHON_VERSION} -m venv "${venv}"` : `python3 -m venv "${venv}"`,
    note: `Hast du schon Python ${PYTHON_VERSION} oder neuer, setze stattdessen die Umgebungsvariable auf dessen Programmdatei.`,
  };
}

export function installationReport(env = process.env) {
  const plan = voiceDiscoveryPlan(env);
  const binary = found(plan.voicebox);
  const dataDir = plan.voiceboxData.candidates[0];
  const modelsDir = plan.voiceboxModels.candidates[0];
  const database = path.join(dataDir, 'voicebox.db');
  const python = found(plan.voicePython);
  const missing = [];
  // P34 (B244, P23-N18): the places that exist -- Einstellungen → Technik & Stimme → Sprache einrichten.
  if (!binary) missing.push({ label: plan.voicebox.label, env: plan.voicebox.key, searched: plan.voicebox.candidates.filter(Boolean), step: 'Installiere den Stimmendienst unter Einstellungen → Technik & Stimme → Sprache einrichten → „Stimmendienst installieren“.', note: 'Liegt er schon auf dem Rechner, setze stattdessen die Umgebungsvariable auf seine Programmdatei.' });
  if (!python) missing.push({ label: plan.voicePython.label, env: plan.voicePython.key, searched: plan.voicePython.candidates.filter(Boolean), ...pythonSetupGuide(plan) });
  const voicebox = {
    installed: missing.length === 0,
    binary, python, dataDir, database, databasePresent: existsSync(database), modelsDir, modelsDirPresent: existsSync(modelsDir),
    missing,
    message: missing.length === 0
      ? `Stimmendienst ${binary}; Datenverzeichnis ${dataDir}${existsSync(database) ? ' (voicebox.db vorhanden)' : ' (voicebox.db wird beim ersten Start angelegt)'}; Modell-Cache ${modelsDir}.`
      : `${missing.length === 1 ? 'Es fehlt' : `Es fehlen ${missing.length} Stücke`}: ${missing.map(item => item.label).join(', ')}.`,
  };
  // Vertragsfeld `microphone` bleibt fuer die Oberflaeche erhalten: das Hoeren ist Voicebox-Whisper,
  // installiert heisst hier: Voicebox selbst ist installiert UND das Whisper-Repo liegt im Cache.
  const hearing = hearingModelReport(env, 'base');
  return {
    voiceRoot: plan.voiceRoot, repositoryRoot: plan.repositoryRoot,
    voicebox,
    microphone: { installed: voicebox.installed && hearing.installed, python: null, model: hearing.installed ? hearing.model_name : null, missing: voicebox.installed ? [] : missing, hearing },
    voiceModel: voiceModelReport(env),
  };
}
