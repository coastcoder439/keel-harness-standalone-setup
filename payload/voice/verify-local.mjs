import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { startVoiceServices } from './start.mjs';
import { voiceRoot } from './config.mjs';

const output = path.join(voiceRoot, 'verification');
await fs.mkdir(output, { recursive: true });
const report = { checkedAt: new Date().toISOString(), microphoneOpened: false, input: 'Newly synthesized test sentences, not live microphone speech.', freeMiBBefore: Math.round(os.freemem() / 1048576), tests: [] };
const started = performance.now();
const runtime = await startVoiceServices();
report.startupMs = Math.round(performance.now() - started);
const memory = async () => {
  const [piper, stt] = await Promise.all([fetch(runtime.addresses.speech + '/status').then(r => r.json()), fetch(runtime.addresses.transcription + '/status').then(r => r.json())]);
  if (process.platform !== 'win32') return null;
  const ids = [piper.processId, piper.workerId, piper.workerProcessId, stt.processId].filter(Number.isInteger);
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', `$values = Get-Process -Id ${ids.join(',')}; [math]::Round(($values | Measure-Object -Property WorkingSet64 -Sum).Sum / 1MB)`], { windowsHide: true, encoding: 'utf8' });
  return Number(result.stdout.trim()) || null;
};
try {
  for (const [index, test] of [
    { language: 'de', text: 'Heute prüfen wir den Sprachweg. Die Aufgabe bleibt im gemeinsamen Plan.', contains: ['sprach', 'aufgabe', 'plan'] },
    { language: 'de', text: 'Ich höre zu und fasse den nächsten Schritt zusammen.', contains: ['höre', 'schritt'] },
    { language: 'en', text: 'The calendar and the project share the same conversation.', contains: ['calendar', 'project', 'conversation'] },
  ].entries()) {
    const start = performance.now();
    const tts = await fetch(runtime.addresses.speech + '/speak', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: test.text, language: test.language }), signal: AbortSignal.timeout(20000) });
    assert.equal(tts.status, 200, await tts.clone().text().then(value => value.slice(0, 150)));
    const bytes = Buffer.from(await tts.arrayBuffer());
    const ttsMs = Math.round(performance.now() - start);
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
    assert.ok(bytes.length > 1000);
    await fs.writeFile(path.join(output, `neutral-${test.language}-${index + 1}.wav`), bytes);
    const form = new FormData(); form.set('file', new Blob([bytes], { type: 'audio/wav' }), 'utterance.wav'); form.set('language', test.language);
    const sttStart = performance.now();
    const response = await fetch(runtime.addresses.transcription + '/transcribe', { method: 'POST', body: form, signal: AbortSignal.timeout(20000) });
    const transcription = await response.json();
    const sttMs = Math.round(performance.now() - sttStart);
    assert.equal(response.status, 200, JSON.stringify(transcription));
    const normalized = transcription.text.toLocaleLowerCase('de-DE');
    assert.ok(test.contains.every(word => normalized.includes(word)), transcription.text);
    const rssMiB = await memory();
    report.tests.push({ language: test.language, inputText: test.text, transcript: transcription.text, ttsMs, synthesisMs: Number(tts.headers.get('x-synthesis-ms')), sttMs, decoderMs: transcription.elapsedMs, audioBytes: bytes.length, servicesRssMiB: rssMiB });
    if (rssMiB > 1100) throw new Error(`Small voice runtime exceeded its 1100 MiB test ceiling: ${rssMiB} MiB`);
  }
  const rejected = await fetch(runtime.addresses.speech + '/speak', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'A new test sentence.', preset: 'en_US-cortana-medium', language: 'en' }) });
  assert.equal(rejected.status, 422);
  report.rejectedLegacyPreset = rejected.status;
  const controller = new AbortController();
  const canceled = fetch(runtime.addresses.speech + '/speak', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'This is a longer sentence used only to exercise cancellation while synthesis is running.', language: 'en' }), signal: controller.signal }).catch(error => error.name);
  setTimeout(() => controller.abort(), 20);
  report.cancellation = await canceled;
  assert.equal(report.cancellation, 'AbortError');
  report.passed = true;
} catch (error) { report.passed = false; report.error = error.message; process.exitCode = 1; }
finally {
  await runtime.stop();
  report.freeMiBAfter = Math.round(os.freemem() / 1048576);
  await fs.writeFile(path.join(output, 'local-verification.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
