import path from 'node:path';
import { loopbackAddress, serviceAddresses } from './config.mjs';

// Ein Vertrag fuer beide Startwege (Quellbaum dashboard/serve.mjs und die
// ausgelieferte standalone/templates/dashboard-serve.mjs). Ohne Flag bleibt alles
// wie bisher: Sprache und Mikrofon aus, KI an.
export const VOICE_FLAGS = ['--voice', '--speech', '--microphone', '--no-inference'];

export function parseVoiceFlags(argv) {
  const has = name => argv.includes(name);
  return {
    speech: has('--speech') || has('--voice'),
    microphone: has('--microphone') || has('--voice'),
    inference: !has('--no-inference'),
  };
}

// Die Umgebung des Dashboard-Kindprozesses. Alles ist ableitbar aus der
// Harness-Wurzel; ausdruecklich gesetzte Variablen gewinnen.
export function voiceEnvironment({ harnessRoot, flags, env = process.env }) {
  const voiceRoot = path.resolve(env.KEEL_VOICE_ROOT || path.join(harnessRoot, 'runtime', 'voice'));
  const sidecar = path.resolve(env.KEEL_VOICE_SIDECAR_ROOT || path.join(harnessRoot, 'voice'));
  const addresses = serviceAddresses(env);
  // Gemessen 15.09.2026: lib/accountability/voicebox-client.ts faellt ohne diese
  // Variable auf 127.0.0.1:17493 zurueck (die eigenstaendige Voicebox-App), waehrend der
  // Profildienst dieses Harness auf 4299 laeuft -- /api/accountability/voice/status
  // meldete den bereiten Dienst dadurch als 'nicht erreichbar'.
  const profiles = loopbackAddress(env.ACCOUNTABILITY_VOICEBOX_URL, 'http://127.0.0.1:4299');
  return {
    voiceRoot, sidecarRoot: sidecar, addresses, profiles,
    env: {
      KEEL_PROTOTYPE_ROOT: harnessRoot,
      KEEL_VOICE_ROOT: voiceRoot,
      KEEL_VOICE_SIDECAR_ROOT: sidecar,
      KEEL_PROTOTYPE_SPEECH: flags.speech ? '1' : '0',
      KEEL_PROTOTYPE_MICROPHONE: flags.microphone ? '1' : '0',
      KEEL_PROTOTYPE_INFERENCE: flags.inference ? '1' : '0',
      ACCOUNTABILITY_VOICEBOX_URL: profiles,
      // Die Runtime laeuft mit cwd .next/standalone bzw. im materialisierten
      // Archiv; der Quell-Fallback "../roles" in specialist-roles.ts zeigt dort
      // ins Leere. Deshalb wird der gelieferte roles/-Ordner ausdruecklich gesetzt.
      KEEL_ROLE_PROFILE_ROOT: env.KEEL_ROLE_PROFILE_ROOT || path.join(harnessRoot, 'roles'),
    },
  };
}

// Stimme UND Hoeren laufen ueber Voicebox, das bei Bedarf ueber den Profildienst startet
// (Knopf „Stimmendienst starten“ bzw. POST /api/accountability/voice/service). Es gibt keinen
// Sidecar-Dienst mit Vorab-Gate mehr: die Flags schalten nur die Routen frei bzw. pausieren sie.
export function missingVoiceInstallation() {
  return [];
}

export function missingInstallationMessage(missing) {
  return ['Die lokale Sprachinstallation ist unvollständig; es wurde nichts gestartet und nichts heruntergeladen.',
    ...missing.map(item => `  fehlt: ${item.label} — setzbar über ${item.env}`),
    '  Vollständige Liste der gesuchten Pfade: node voice/check.mjs'].join('\n');
}

// Kein Dienst startet vor dem Web-Start: Voicebox wird aus dem Dashboard heraus gestartet und
// beim Stop des Dashboards ueber denselben Profildienst beendet (lib/companion/profile-service.ts).
export async function startConfiguredVoice() {
  return { children: [], addresses: null, stop: async () => {} };
}

export const voiceStatusLine = flags =>
  `Sprachausgabe ${flags.speech ? 'aktiv' : 'pausiert'}, Mikrofon ${flags.microphone ? 'aktiv' : 'pausiert'}, KI ${flags.inference ? 'aktiv' : 'pausiert'}.`;
