import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyPersonalSign, dynamicTimeWarpDistance, personalPhraseLabel, personalPhraseText } from '../public/personal-sign-recognizer.mjs';

const frame = (x) => ({ timestampMs: x, handMask: { left: true, right: false }, hands: { left: [x, 0, 0], right: null }, pose: null, face: null });
const sequence = (...values) => values.map(frame);

test('DTW accepts identical and time-warped sequences', () => {
  assert.equal(dynamicTimeWarpDistance(sequence(0, 1, 2), sequence(0, 1, 2)), 0);
  assert.ok(dynamicTimeWarpDistance(sequence(0, 1, 1, 2), sequence(0, 1, 2)) < 0.08);
});

test('personal classifier selects the nearest signer-specific sample', () => {
  const result = classifyPersonalSign({
    frames: sequence(0, 0.5, 1),
    samples: [
      { label: 'MERHABA', frames: sequence(0, 0.5, 1) },
      { label: 'IYI', frames: sequence(3, 4, 5) },
      { label: 'MERHABA', frames: sequence(0, 0.45, 1) },
      { label: 'MERHABA', frames: sequence(0, 0.48, 1) },
    ],
  });
  assert.deepEqual(result.glosses, ['MERHABA']);
  assert.equal(result.source, 'personal');
  assert.equal(result.needsConfirmation, true);
});

test('distant, blank, and partial utterances are rejected as anlaşılmadı', () => {
  const samples = [{ label: 'IYI', frames: sequence(0, 0.1, 0.2) }];
  for (const frames of [[], sequence(8), sequence(8, 9, 10)]) {
    const result = classifyPersonalSign({ frames, samples, rejectThreshold: 0.08 });
    assert.equal(result.text, undefined);
    assert.deepEqual(result.glosses, []);
    assert.equal(result.reason, 'anlaşılamadı');
  }
});

test('adaptive threshold is based on pairwise training distance and clamped', () => {
  const result = classifyPersonalSign({
    frames: sequence(0, 0.11, 0.2),
    samples: [
      { label: 'IYI', frames: sequence(0, 0.1, 0.2) },
      { label: 'IYI', frames: sequence(0, 0.12, 0.2) },
      { label: 'IYI', frames: sequence(0, 0.11, 0.2) },
    ],
  });
  assert.ok(result.rejectThreshold >= 0.08 && result.rejectThreshold <= 0.45);
});

test('a personal label is not recognized before three teaching examples', () => {
  const result = classifyPersonalSign({ frames: sequence(0, 0.5, 1), samples: [
    { label: 'MERHABA', frames: sequence(0, 0.5, 1) },
    { label: 'MERHABA', frames: sequence(0, 0.5, 1) },
  ] });
  assert.equal(result.reason, 'anlaşılamadı');
});

test('a taught sentence becomes Turkish text without an internal label prefix', () => {
  const label = personalPhraseLabel('  Bir   dakika lütfen.  ');
  assert.equal(personalPhraseText(label), 'Bir dakika lütfen.');
  const result = classifyPersonalSign({ frames: sequence(0, 0.5, 1), samples: [
    { label, frames: sequence(0, 0.5, 1) },
    { label, frames: sequence(0, 0.48, 1) },
    { label, frames: sequence(0, 0.52, 1) },
  ] });
  assert.equal(result.text, 'Bir dakika lütfen.');
  assert.deepEqual(result.glosses, []);
});
