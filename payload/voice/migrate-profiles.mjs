import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loopbackAddress, repositoryRoot } from './config.mjs';

// Einmalige Uebernahme der Charakter-Profile (Cortana, Jarvis) in die Voicebox-Datenbank der
// App (Plan Schritt 1/2, 21.09.2026). Quelle: die geprueften Referenzen aus
// focus-dashboard-v4/runtime/voice/references (manifest.json traegt den wortgetreuen
// Referenztext). Ziel: der LAUFENDE Voicebox-Server auf ACCOUNTABILITY_VOICEBOX_URL, der auf
// %APPDATA%\sh.voicebox.app arbeitet. Idempotent: ein Profil gleichen Namens wird nicht doppelt
// angelegt, ein vorhandenes Sample nicht erneut hochgeladen; nur default_engine wird angeglichen.
//
// Engine je Profil: Cortana/Jarvis auf Qwen3-TTS 0.6B — korrekt vor schnell. LuxTTS war die
// Plan-Empfehlung (150x Echtzeit), kuerzt aber Saetze: gemessen 21.09.2026 direkt gegen Voicebox
// 0.5.0 /generate (Cortana, luxtts, 11 Woerter) → 1,25 s Audio, Rueckhoeren ueber /transcribe
// liefert "Your local voice service is under review today." — "Working on it." fehlt; auch ein
// einzelner Satz verliert sein erstes Wort. Eigene Stimmen entstehen im Dashboard ebenfalls mit Qwen.

export const CHARACTER_ENGINE = 'chatterbox'; // Owner 21.09.2026: Klonstimmen ueber Chatterbox Multilingual (Deutsch)

const json = async (base, pathname, init = {}) => {
  const response = await fetch(base + pathname, { ...init, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(init.timeoutMs || 15000) });
  const text = await response.text();
  let value = null;
  try { value = text ? JSON.parse(text) : null; } catch { /* Fehlertext bleibt unten sichtbar. */ }
  if (!response.ok) throw new Error(`${init.method || 'GET'} ${pathname} → HTTP ${response.status}: ${typeof value?.detail === 'string' ? value.detail : text.slice(0, 300)}`);
  return value;
};

export function characterName(reference) {
  // "cortana" → "Cortana"; das Label „Cortana · Halo“ ist nur Anzeige.
  return reference.id.charAt(0).toUpperCase() + reference.id.slice(1);
}

export async function migrateCharacterProfiles({ base, referencesDir, engine = CHARACTER_ENGINE, log = () => {} }) {
  const manifest = JSON.parse(await fs.readFile(path.join(referencesDir, 'manifest.json'), 'utf8'));
  const results = [];
  for (const reference of manifest.references) {
    if (!reference.referenceVerified) { log(`${reference.id}: Referenz nicht verifiziert, übersprungen.`); continue; }
    const name = characterName(reference);
    const existing = (await json(base, '/profiles')).find(profile => profile.name.trim().toLowerCase() === name.toLowerCase());
    let profile = existing;
    let created = false;
    if (!profile) {
      profile = await json(base, '/profiles', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, description: `${reference.label} – Referenz aus manifest.json (${reference.sourceIdentity})`, language: reference.language, voice_type: 'cloned', default_engine: engine }) });
      created = true;
      log(`${name}: Profil angelegt (${profile.id}).`);
    } else log(`${name}: Profil vorhanden (${profile.id}, ${profile.sample_count || 0} Sample).`);
    let sampleAdded = false;
    if (!(profile.sample_count > 0)) {
      const file = path.join(referencesDir, reference.file);
      const bytes = await fs.readFile(file);
      const form = new FormData();
      form.set('file', new File([bytes], reference.file, { type: 'audio/wav' }), reference.file);
      form.set('reference_text', reference.referenceText);
      await json(base, `/profiles/${profile.id}/samples`, { method: 'POST', body: form, timeoutMs: 120000 });
      sampleAdded = true;
      log(`${name}: Referenz ${reference.file} als Sample hinterlegt.`);
    }
    let engineSet = false;
    if ((profile.default_engine || '') !== engine) {
      await json(base, `/profiles/${profile.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: profile.name, description: profile.description, language: profile.language, voice_type: profile.voice_type || 'cloned', default_engine: engine, personality: profile.personality ?? null }) });
      engineSet = true;
      log(`${name}: default_engine ${profile.default_engine || '(leer)'} → ${engine}.`);
    }
    results.push({ id: profile.id, name, created, sampleAdded, engineSet, engine });
  }
  return results;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const argument = name => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
  const base = loopbackAddress(argument('--base') || process.env.ACCOUNTABILITY_VOICEBOX_URL, 'http://127.0.0.1:4299');
  const referencesDir = path.resolve(argument('--references') || path.join(repositoryRoot(process.env), 'focus-dashboard-v4', 'runtime', 'voice', 'references'));
  const results = await migrateCharacterProfiles({ base, referencesDir, engine: argument('--engine') || CHARACTER_ENGINE, log: line => console.error(line) });
  const profiles = await json(base, '/profiles');
  console.log(JSON.stringify({ base, referencesDir, results, profiles: profiles.map(profile => ({ id: profile.id, name: profile.name, language: profile.language, sample_count: profile.sample_count, default_engine: profile.default_engine })) }, null, 2));
}
