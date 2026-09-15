import http from 'node:http';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { discoverVoiceInstallation, sidecarRoot, voiceRoot, serviceAddresses, isolatedVoiceEnvironment } from './config.mjs';

const installed = discoverVoiceInstallation();
if (!installed.piper.installed) throw new Error('Piper fehlt. node scripts/voice/check.mjs zeigt die benötigten Pfade.');
const output = path.join(voiceRoot, 'audio');
await fs.mkdir(output, { recursive: true });
const address = new URL(serviceAddresses().speech);
const jobs = new Map();
let state = { service: 'keel-v4-piper', ready: false, message: 'Die lokale Stimme lädt.', variants: [], loadMs: null };
let worker;
const json = (response, status, body) => { if (!response.destroyed) { response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); response.end(JSON.stringify(body)); } };
function unavailable(message) { state = { ...state, ready: false, message }; for (const job of jobs.values()) job.reject(new Error(message)); jobs.clear(); }
const server = http.createServer(async (request, response) => {
  if (request.method === 'POST' && request.url === '/shutdown') {
    if (!process.env.KEEL_VOICE_SERVICE_TOKEN || request.headers['x-keel-service-token'] !== process.env.KEEL_VOICE_SERVICE_TOKEN) { json(response, 403, { error: { message: 'Nur der eigene Starter darf diesen Dienst beenden.' } }); return; }
    json(response, 202, { stopping: true });
    server.close();
    server.closeIdleConnections();
    worker?.stdin.end();
    return;
  }
  if (request.method === 'GET' && request.url === '/status') { json(response, state.ready ? 200 : 503, { ...state, local: true, activeJobs: jobs.size, processId: process.pid, workerId: worker?.pid, rssMiB: Math.round(process.memoryUsage().rss / 1048576), presets: [{ id: 'piper', label: 'Neutral · Thorsten / Lessac', available: state.ready, variants: state.variants }] }); return; }
  if (request.method !== 'POST' || request.url !== '/speak') { json(response, 404, { error: { code: 'not_found', message: 'Dieser Sprachweg existiert nicht.' } }); return; }
  let identifier;
  try {
    if (!state.ready) throw Object.assign(new Error(state.message), { status: 503 });
    if (jobs.size >= 2) throw Object.assign(new Error('Die Stimme verarbeitet noch eine Ausgabe. Bitte kurz erneut versuchen.'), { status: 429 });
    let bytes = 0;
    const parts = [];
    for await (const part of request) { bytes += part.length; if (bytes > 8192) throw Object.assign(new Error('Die Sprachanfrage ist zu groß.'), { status: 413 }); parts.push(part); }
    let body;
    try { body = JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { throw Object.assign(new Error('Die Sprachanfrage ist kein gültiges JSON.'), { status: 400 }); }
    const { text, preset = 'piper', language = 'de' } = body;
    if (preset !== 'piper') throw Object.assign(new Error('Dieser Endpunkt verwendet ausschließlich die offen benannte neutrale Piper-Stimme.'), { status: 422 });
    if (!['de', 'en'].includes(language) || !state.variants.some(v => v.language === language && v.available)) throw Object.assign(new Error('Das neutrale Modell dieser Sprache fehlt.'), { status: 422 });
    if (typeof text !== 'string' || !text.trim() || text.length > 1200) throw Object.assign(new Error('Bitte einen Text zwischen 1 und 1200 Zeichen senden.'), { status: 400 });
    identifier = 'piper-' + randomUUID();
    let timer;
    const result = await new Promise((resolve, reject) => {
      timer = setTimeout(() => { jobs.delete(identifier); reject(Object.assign(new Error('Die Stimme hat nach 15 Sekunden nicht geantwortet.'), { status: 504 })); }, 15000);
      jobs.set(identifier, { resolve, reject });
      response.once('close', () => { if (jobs.delete(identifier)) reject(new DOMException('Sprachausgabe abgebrochen.', 'AbortError')); });
      worker.stdin.write(JSON.stringify({ id: identifier, voice: 'piper-' + language, text: text.trim() }) + '\n');
    }).finally(() => clearTimeout(timer));
    const audio = await fs.readFile(path.join(output, identifier + '.wav'));
    if (!response.destroyed) { response.writeHead(200, { 'content-type': 'audio/wav', 'content-length': audio.length, 'cache-control': 'no-store', 'x-synthesis-ms': String(result.elapsedMs), 'x-voice-preset': 'piper', 'x-voice-language': language }); response.end(audio); }
  } catch (error) { json(response, error.status || 503, { error: { code: error.name === 'AbortError' ? 'aborted' : 'piper_failed', message: error.message } }); }
  finally { if (identifier) await fs.unlink(path.join(output, identifier + '.wav')).catch(() => undefined); }
});
server.requestTimeout = 20000;
server.listen(Number(address.port), address.hostname, () => {
  worker = spawn(installed.piper.python, ['-u', path.join(sidecarRoot, 'piper-worker.py'), JSON.stringify(installed.piper.models), output], { cwd: voiceRoot, env: isolatedVoiceEnvironment(), windowsHide: true, stdio: ['pipe', 'pipe', 'inherit'] });
  worker.on('error', error => unavailable(error.message));
  worker.on('exit', () => unavailable('Der lokale Piper-Prozess ist beendet. Starte den V4-Sprachdienst erneut.'));
  worker.stdin.on('error', () => undefined);
  createInterface({ input: worker.stdout }).on('line', line => {
    let value; try { value = JSON.parse(line); } catch { return; }
    if ('ready' in value) { state = { ...state, ...value, message: value.ready ? 'Neutrale lokale Stimme bereit.' : 'Kein Piper-Modell konnte geladen werden.' }; console.log(JSON.stringify(state)); return; }
    const job = jobs.get(value.id);
    jobs.delete(value.id);
    if (!job) { if (/^piper-[a-f0-9-]+$/.test(value.id || '')) void fs.unlink(path.join(output, value.id + '.wav')).catch(() => undefined); return; }
    value.error ? job.reject(new Error(value.error)) : job.resolve(value);
  });
});
server.on('error', error => { console.error(error.message); worker?.kill(); process.exitCode = 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { unavailable('Sprachdienst beendet.'); server.close(); worker?.kill(); });
