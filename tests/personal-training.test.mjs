import assert from 'node:assert/strict';
import test from 'node:test';

import { createPersonalSignStore } from '../public/personal-sign-store.mjs';
import { createPersonalTrainer } from '../public/personal-training.mjs';

const frame = (timestampMs) => ({ timestampMs, handMask: { left: true, right: false }, hands: { left: [0, 0, 0], right: null }, pose: null, face: null });

test('trainer requires three non-empty samples before a label is ready', async () => {
  const store = createPersonalSignStore({ indexedDB: null, dbName: 'trainer-minimum-test' });
  const trainer = createPersonalTrainer({ runtime: {}, store, minSamples: 3 });
  await trainer.addSample('MERHABA', [frame(1), frame(2)]);
  await trainer.addSample('MERHABA', [frame(3)]);
  assert.deepEqual(await trainer.getProgress('MERHABA'), { label: 'MERHABA', sampleCount: 2, minSamples: 3, ready: false });
  await trainer.addSample('MERHABA', [frame(4)]);
  assert.equal((await trainer.getProgress('MERHABA')).ready, true);
});

test('trainer captures normalized frames and exposes quality without retaining raw video', async () => {
  const store = createPersonalSignStore({ indexedDB: null, dbName: 'trainer-capture-test' });
  const runtime = { async captureSample() { return [frame(1), frame(2), frame(3)]; } };
  const trainer = createPersonalTrainer({ runtime, store, minSamples: 3 });
  const result = await trainer.recordSample('IYI', { durationMs: 100 });
  assert.equal(result.quality, 'good');
  assert.equal(result.frameCount, 3);
  assert.equal((await store.getSamples('IYI'))[0].frames[0].imageBitmap, undefined);
  await trainer.deleteLabel('IYI');
  assert.equal((await trainer.getProgress('IYI')).sampleCount, 0);
});

test('trainer rejects a mostly empty hand sample before it counts toward readiness', async () => {
  const store = createPersonalSignStore({ indexedDB: null, dbName: 'trainer-quality-test' });
  const trainer = createPersonalTrainer({ runtime: {}, store, minSamples: 3 });
  const emptyFrame = (timestampMs) => ({
    timestampMs, handMask: { left: false, right: false },
    hands: { left: null, right: null }, pose: null, face: null,
  });

  await assert.rejects(trainer.addSample('MERHABA', [emptyFrame(1), emptyFrame(2), emptyFrame(3)]), (error) => error.code === 'personal_sample_quality_low');

  assert.deepEqual(await trainer.getProgress('MERHABA'), { label: 'MERHABA', sampleCount: 0, minSamples: 3, ready: false });
});
