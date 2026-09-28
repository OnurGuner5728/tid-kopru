import assert from 'node:assert/strict';
import test from 'node:test';

import { createHybridRecognizer } from '../public/hybrid-recognition.mjs';

const candidate = (source, confidence, gloss = 'IYI') => ({ text: undefined, glosses: [gloss], confidence, source, warnings: [], needsConfirmation: true });

test('local-only mode never calls cloud', async () => {
  let cloudCalls = 0;
  const recognizer = createHybridRecognizer({
    personalBackend: { recognize: async () => candidate('personal', 0.7) },
    cloudBackend: { recognize: async () => { cloudCalls += 1; return candidate('cloud-candidate', 0.9); } },
  });
  const result = await recognizer.recognize({}, { mode: 'local', cloudConsent: true });
  assert.equal(result.source, 'personal');
  assert.equal(cloudCalls, 0);
});

test('verified ONNX candidate beats a weaker personal candidate', async () => {
  const recognizer = createHybridRecognizer({
    personalBackend: { recognize: async () => candidate('personal', 0.65) },
    onnxBackend: { recognize: async () => candidate('verified-onnx', 0.83, 'MERHABA') },
  });
  const result = await recognizer.recognize({}, { mode: 'hybrid', cloudConsent: false });
  assert.equal(result.source, 'verified-onnx');
  assert.deepEqual(result.glosses, ['MERHABA']);
  assert.equal(result.needsConfirmation, true);
});

test('cloud is called only in cloud-assisted mode with explicit consent', async () => {
  let calls = 0;
  const recognizer = createHybridRecognizer({ cloudBackend: { recognize: async () => { calls += 1; return candidate('cloud-candidate', 0.79); } } });
  await recognizer.recognize({}, { mode: 'cloud-assisted', cloudConsent: false });
  assert.equal(calls, 0);
  const result = await recognizer.recognize({}, { mode: 'cloud-assisted', cloudConsent: true });
  assert.equal(calls, 1);
  assert.equal(result.source, 'cloud-candidate');
});

test('cloud escalation skips upload when local confidence is already strong', async () => {
  let calls = 0;
  const recognizer = createHybridRecognizer({
    personalBackend: { recognize: async () => candidate('personal', 0.84) },
    cloudBackend: { recognize: async () => { calls += 1; return candidate('cloud-candidate', 0.58); } },
  });

  const result = await recognizer.recognize({}, { mode: 'cloud-assisted', cloudConsent: true });

  assert.equal(result.source, 'personal');
  assert.equal(calls, 0);
});

test('cloud escalation is attempted after a weak local result with consent', async () => {
  let calls = 0;
  const recognizer = createHybridRecognizer({
    personalBackend: { recognize: async () => candidate('personal', 0.4) },
    cloudBackend: { recognize: async () => { calls += 1; return candidate('cloud-candidate', 0.58); } },
  });

  const result = await recognizer.recognize({}, { mode: 'cloud-assisted', cloudConsent: true });

  assert.equal(calls, 1);
  assert.equal(result.source, 'cloud-candidate');
});

test('malformed backend outputs are ignored and empty arbitration says anlaşılmadı', async () => {
  const recognizer = createHybridRecognizer({
    personalBackend: { recognize: async () => ({ confidence: 4, source: 'personal' }) },
    onnxBackend: { recognize: async () => ({ text: 'uydurma', confidence: 0.9, source: 'bad', needsConfirmation: false }) },
  });
  const result = await recognizer.recognize({}, { mode: 'hybrid' });
  assert.equal(result.reason, 'anlaşılamadı');
  assert.equal(result.text, undefined);
  assert.equal(result.needsConfirmation, true);
});

test('reviewed gloss mapping may supply Turkish while every candidate still needs confirmation', async () => {
  const recognizer = createHybridRecognizer({
    personalBackend: { recognize: async () => candidate('personal', 0.9) },
    translateGlosses: () => ({ status: 'ready', text: 'İyiyim.' }),
  });
  const result = await recognizer.recognize({}, { mode: 'local' });
  assert.equal(result.text, 'İyiyim.');
  assert.equal(result.needsConfirmation, true);
  assert.ok(result.warnings.includes('Türkçe metin uzman onaylı gloss eşlemesinden üretildi.'));
});
