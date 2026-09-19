import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveVoiceRoot, serviceAddresses } from './config.mjs';

// Messprotokoll der Sprachlatenz (Paket focus-dashboard-v4, N8.3). Node-Skript ohne
// Browser: es schickt n Runden an die BEREITS LAUFENDEN lokalen Dienste, startet selbst
// nichts und laedt nichts herunter. Start der Dienste: node dashboard/serve.mjs --voice.
//
// Die Grenzwerte sind dieselben wie in dashboard/lib/companion/latency-limits.ts; die
// Doppelung ist gewollt, weil dieses Skript kein TypeScript laedt. Der Test
// voice/latency-run.test.mjs vergleicht beide Dateien Zahl fuer Zahl.
export const LATENCY_LIMITS = {
  audible: { key: 'audible', label: 'bis hörbare Stimme', targetMs: 1000, warnMs: 1500, limitMs: 3000 },
  answer: { key: 'answer', label: 'bis vollständige Antwort', targetMs: 6000, warnMs: 6000, limitMs: 10000 },
};

export const SAMPLE_SENTENCE = 'Heute prüfen wir, wie schnell die Stimme im Gespräch einsetzt.';
// Es liegt KEINE WAV-Datei im Bestand (gemessen: find . -name "*.wav" ohne node_modules,
// runtime und .next liefert nichts). Die Whisper-Runde nutzt deshalb das in derselben
// Runde erzeugte Piper-Audio als Eingabe, wenn --with-stt gesetzt ist.

export function median(values) {
  const sorted = values.filter(value => Number.isFinite(value)).slice().sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

export function rate(budget, milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return null;
  if (milliseconds >= budget.limitMs) return 'over';
  if (milliseconds >= budget.warnMs) return 'slow';
  return 'target';
}

const RATING_LABELS = { target: 'im Ziel', slow: 'langsam', over: 'zu langsam' };

function evaluate(budget, values) {
  const usable = values.filter(value => Number.isFinite(value));
  if (!usable.length) return { budget: budget.key, label: budget.label, count: 0, medianMs: null, maxMs: null, rating: null, ratingLabel: 'nicht gemessen', overLimit: 0, withinLimit: null, limits: budget };
  const medianMs = median(usable);
  const maxMs = Math.max(...usable);
  const overLimit = usable.filter(value => value >= budget.limitMs).length;
  const rating = rate(budget, medianMs);
  return {
    budget: budget.key, label: budget.label, count: usable.length, medianMs, maxMs,
    rating, ratingLabel: RATING_LABELS[rating], maxRating: rate(budget, maxMs),
    overLimit, withinLimit: overLimit === 0, limits: budget,
  };
}

// Auswertung der Messreihe. Jede Runde liefert audibleMs (Start bis erste hoerbare Bytes)
// und answerMs (Start bis fertige Antwort). Eine Runde ohne Wert wird nicht geschaetzt.
export function summariseLatencyRuns(rounds, limits = LATENCY_LIMITS) {
  const list = Array.isArray(rounds) ? rounds : [];
  const failures = list.filter(round => round && round.error).length;
  const audible = evaluate(limits.audible, list.map(round => round?.audibleMs));
  const answer = evaluate(limits.answer, list.map(round => round?.answerMs));
  const passed = failures === 0 && audible.withinLimit === true && (answer.count === 0 || answer.withinLimit === true);
  return {
    rounds: list.length, measured: audible.count, failures,
    audible, answer, passed,
    message: failures
      ? `${failures} von ${list.length} Runden sind fehlgeschlagen.`
      : passed
        ? `Median ${audible.medianMs} ms bis zur Stimme (${audible.ratingLabel}); keine Runde überschreitet ${limits.audible.limitMs} ms.`
        : `Grenze überschritten: ${audible.overLimit} Runde(n) über ${limits.audible.limitMs} ms bis zur Stimme, ${answer.overLimit} Runde(n) über ${limits.answer.limitMs} ms bis zur vollständigen Antwort.`,
  };
}

// --- Messung gegen die laufenden Dienste ------------------------------------------------

async function readWithFirstByte(response, started) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Der Dienst hat keinen lesbaren Antwortkörper geliefert.');
  const chunks = [];
  let firstByteMs = null;
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (firstByteMs === null && value.byteLength) firstByteMs = Math.round(performance.now() - started);
    bytes += value.byteLength;
    chunks.push(value);
  }
  return { firstByteMs, bytes, buffer: Buffer.concat(chunks.map(chunk => Buffer.from(chunk))) };
}

async function speechRound(address, text, language, signal) {
  const started = performance.now();
  const response = await fetch(address + '/speak', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, language }), signal,
  });
  if (!response.ok) throw new Error(`Piper antwortet mit HTTP ${response.status}.`);
  const { firstByteMs, bytes, buffer } = await readWithFirstByte(response, started);
  const completeMs = Math.round(performance.now() - started);
  if (buffer.toString('ascii', 0, 4) !== 'RIFF') throw new Error('Die Antwort ist keine WAV-Datei.');
  return { firstByteMs, completeMs, bytes, synthesisMs: Number(response.headers.get('x-synthesis-ms')) || null, audio: buffer };
}

async function transcriptionRound(address, audio, language, signal) {
  const form = new FormData();
  form.set('file', new Blob([audio], { type: 'audio/wav' }), 'utterance.wav');
  form.set('language', language);
  const started = performance.now();
  const response = await fetch(address + '/transcribe', { method: 'POST', body: form, signal });
  const value = await response.json();
  if (!response.ok) throw new Error(`Whisper antwortet mit HTTP ${response.status}.`);
  return { sttMs: Math.round(performance.now() - started), decoderMs: value.elapsedMs ?? null, text: typeof value.text === 'string' ? value.text : '' };
}

async function modelRound(base, model, prompt, signal) {
  const started = performance.now();
  const response = await fetch(base + '/api/generate', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, prompt, stream: true }), signal,
  });
  if (!response.ok) throw new Error(`Ollama antwortet mit HTTP ${response.status}.`);
  const { firstByteMs, bytes } = await readWithFirstByte(response, started);
  return { firstTokenMs: firstByteMs, completeMs: Math.round(performance.now() - started), bytes };
}

async function ollamaReachable(base, signal) {
  try { return (await fetch(base + '/api/tags', { signal })).ok; } catch { return false; }
}

export function parseLatencyArguments(argv, env = process.env) {
  const value = name => { const index = argv.indexOf(name); return index >= 0 ? argv[index + 1] : undefined; };
  const rounds = Number.parseInt(value('--rounds') ?? '5', 10);
  return {
    rounds: Number.isInteger(rounds) && rounds > 0 && rounds <= 50 ? rounds : 5,
    out: value('--out') || path.join(resolveVoiceRoot(env), 'verification', 'latency-run.json'),
    language: value('--language') === 'en' ? 'en' : 'de',
    withStt: argv.includes('--with-stt'),
    withModel: argv.includes('--with-model'),
  };
}

export async function runLatencyProtocol(options, env = process.env) {
  const addresses = serviceAddresses(env);
  const ollamaBase = (env.ACCOUNTABILITY_OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/+$/, '');
  const ollamaModel = (env.ACCOUNTABILITY_OLLAMA_MODEL || 'gemma4:latest').trim();
  const signal = AbortSignal.timeout(60_000);
  const modelEnabled = options.withModel && await ollamaReachable(ollamaBase, signal);
  const rounds = [];
  for (let index = 0; index < options.rounds; index += 1) {
    const round = { round: index + 1, language: options.language };
    try {
      const speech = await speechRound(addresses.speech, SAMPLE_SENTENCE, options.language, signal);
      round.speech = { firstByteMs: speech.firstByteMs, completeMs: speech.completeMs, bytes: speech.bytes, synthesisMs: speech.synthesisMs };
      if (options.withStt) round.transcription = await transcriptionRound(addresses.transcription, speech.audio, options.language, signal);
      if (modelEnabled) round.model = await modelRound(ollamaBase, ollamaModel, SAMPLE_SENTENCE, signal);
      // "Bis hoerbare Bytes" ist die Zeit bis zum ersten Byte der Sprachantwort; Piper
      // antwortet nicht stueckweise, deshalb liegt sie nah an completeMs. Ein Modellschritt
      // laeuft im Gespraech VOR der Synthese und wird dazugerechnet, wenn er gemessen wurde.
      round.audibleMs = (round.model?.completeMs || 0) + speech.firstByteMs;
      round.answerMs = (round.model?.completeMs || 0) + speech.completeMs + (round.transcription?.sttMs || 0);
    } catch (error) {
      round.error = error instanceof Error ? error.message : 'Unbekannter Fehler in dieser Runde.';
    }
    rounds.push(round);
  }
  return {
    schemaVersion: 1, measuredAt: new Date().toISOString(),
    sentence: SAMPLE_SENTENCE, language: options.language,
    services: { speech: addresses.speech, transcription: options.withStt ? addresses.transcription : null, model: modelEnabled ? `${ollamaBase} · ${ollamaModel}` : null },
    includes: { transcription: options.withStt, model: modelEnabled, playbackEnd: false },
    note: 'Gemessen wird der Dienstweg, nicht die Wiedergabe im Browser. Das Ende der gesprochenen Ausgabe wird nicht gemessen.',
    rounds, summary: summariseLatencyRuns(rounds),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const options = parseLatencyArguments(process.argv.slice(2));
  const report = await runLatencyProtocol(options);
  await fs.mkdir(path.dirname(options.out), { recursive: true });
  await fs.writeFile(options.out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`Messprotokoll: ${options.out}`);
  console.log(report.summary.message);
  for (const round of report.rounds) {
    console.log(round.error
      ? `  Runde ${round.round}: fehlgeschlagen — ${round.error}`
      : `  Runde ${round.round}: ${round.audibleMs} ms bis Stimme, ${round.answerMs} ms bis vollständige Antwort`);
  }
  if (!report.summary.passed) process.exitCode = 1;
}
