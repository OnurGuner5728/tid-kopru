import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isValidGlossTimeline,
  translateTidGlossToTurkish,
} from '../public/tid-to-turkish.mjs';
import { translateTidGlossToTurkish as translateFromCombinedTransfer } from '../public/tid-transfer.mjs';

const reviewers = ['fixture-reviewer-a', 'fixture-reviewer-b'];
const vocabulary = ['NERE', 'SEN', 'GIT', 'BEN', 'GEL', 'NEG', 'IYI'];

function approval(status = 'approved') {
  return {
    status,
    reviewerCodes: status === 'approved' ? [...reviewers] : [],
    approvals: status === 'approved'
      ? reviewers.map((reviewerCode) => ({ reviewerCode, decision: 'approve', independent: true }))
      : [],
    disagreement: false,
    adjudication: null,
  };
}

function phrase(id, glosses, turkishText, options = {}) {
  return {
    id,
    glosses,
    turkishText,
    requiredNonManual: options.requiredNonManual ?? [],
    confidence: options.confidence ?? 0.98,
    review: options.review ?? approval(),
  };
}

function resources(phrases = []) {
  return { contentVersion: 'fixture-content-v1', vocabulary, phrases };
}

function event(glossId, startFrame, endFrame, options = {}) {
  return {
    glossId,
    startFrame,
    endFrame,
    confidence: options.confidence ?? 0.94,
    channel: options.channel ?? 'manual',
    nonManual: options.nonManual ?? [],
    ...(options.parallelGroup ? { parallelGroup: options.parallelGroup } : {}),
  };
}

test('an exact reviewed gloss sequence returns its Turkish sentence and confidence', () => {
  const row = phrase('q-where-go', ['NERE', 'SEN', 'GIT'], 'Nereye gidiyorsun?', {
    requiredNonManual: ['brow_raise'],
    confidence: 0.97,
  });
  const result = translateTidGlossToTurkish([
    event('NERE', 0, 3, { confidence: 0.99 }),
    event('SEN', 4, 7),
    event('GIT', 8, 12, { nonManual: ['brow_raise'] }),
  ], resources([row]));

  assert.equal(result.status, 'ready');
  assert.equal(result.text, 'Nereye gidiyorsun?');
  assert.equal(result.confidence, 0.94);
  assert.deepEqual(result.unsupportedGlosses, []);
  assert.equal(result.contentVersion, 'fixture-content-v1');
});

test('the combined transfer module exposes the reverse direction for face-to-face integration', () => {
  assert.equal(translateFromCombinedTransfer, translateTidGlossToTurkish);
});

test('reviewed negation and person reference come only from the exact approved phrase', () => {
  const row = phrase('first-person-negative', ['BEN', 'GEL', 'NEG'], 'Ben gelmiyorum.');
  const result = translateTidGlossToTurkish([
    event('BEN', 0, 2),
    event('GEL', 3, 7),
    event('NEG', 8, 10),
  ], resources([row]));

  assert.equal(result.status, 'ready');
  assert.equal(result.text, 'Ben gelmiyorum.');
});

test('exact duplicate CTC events collapse while separate repeated signs remain ordered', () => {
  const row = phrase('good-you', ['IYI', 'SEN'], 'Sen iyisin.');
  const duplicate = event('IYI', 0, 4);
  const collapsed = translateTidGlossToTurkish([
    duplicate,
    { ...duplicate },
    event('SEN', 5, 8),
  ], resources([row]));
  assert.equal(collapsed.status, 'ready');
  assert.equal(collapsed.text, 'Sen iyisin.');

  const repeated = translateTidGlossToTurkish([
    event('IYI', 0, 2),
    event('IYI', 4, 6),
    event('SEN', 7, 9),
  ], resources([row]));
  assert.equal(repeated.status, 'unsupported');
  assert.equal(repeated.text, undefined);
});

test('unknown glosses are rejected and named without producing Turkish text', () => {
  const result = translateTidGlossToTurkish([event('NOT_IN_VOCAB', 0, 1)], resources([]));
  assert.equal(result.status, 'unsupported');
  assert.equal(result.text, undefined);
  assert.deepEqual(result.unsupportedGlosses, ['NOT_IN_VOCAB']);
});

test('known glosses in unreviewed word order do not get reordered into Turkish', () => {
  const row = phrase('q-where-go', ['NERE', 'SEN', 'GIT'], 'Nereye gidiyorsun?', {
    requiredNonManual: ['brow_raise'],
  });
  const result = translateTidGlossToTurkish([
    event('GIT', 0, 2),
    event('SEN', 3, 5),
    event('NERE', 6, 9, { nonManual: ['brow_raise'] }),
  ], resources([row]));
  assert.equal(result.status, 'unsupported');
  assert.equal(result.text, undefined);
});

test('a phrase without two independent reviewer approvals remains unsupported', () => {
  const row = phrase('unreviewed', ['SEN', 'IYI'], 'Sen iyisin.', { review: approval('candidate') });
  const result = translateTidGlossToTurkish([
    event('SEN', 0, 2),
    event('IYI', 3, 6),
  ], resources([row]));
  assert.equal(result.status, 'unsupported');
  assert.equal(result.text, undefined);
});

test('multiple reviewed Turkish renderings for one gloss sequence are rejected as ambiguous', () => {
  const rows = [
    phrase('reading-a', ['SEN', 'IYI'], 'Sen iyisin.'),
    phrase('reading-b', ['SEN', 'IYI'], 'İyi misin?'),
  ];
  const result = translateTidGlossToTurkish([
    event('SEN', 0, 2),
    event('IYI', 3, 6),
  ], resources(rows));
  assert.equal(result.status, 'ambiguous');
  assert.equal(result.text, undefined);
});

test('gloss timelines must use known IDs and increasing, finite intervals', () => {
  assert.equal(isValidGlossTimeline([event('SEN', 0, 2), event('IYI', 3, 6)], vocabulary), true);
  assert.equal(isValidGlossTimeline([event('SEN', 4, 6), event('IYI', 1, 3)], vocabulary), false);
  assert.equal(isValidGlossTimeline([event('SEN', 0, Number.NaN)], vocabulary), false);
  const unscored = event('SEN', 0, 2);
  delete unscored.confidence;
  assert.equal(isValidGlossTimeline([unscored], vocabulary), false);
  assert.equal(isValidGlossTimeline([event('SEN', 0, 4), event('IYI', 3, 6)], vocabulary), false);
  assert.equal(isValidGlossTimeline([
    event('SEN', 0, 4, { channel: 'manual', parallelGroup: 'p1' }),
    event('IYI', 0, 4, { channel: 'nonManual', parallelGroup: 'p1' }),
  ], vocabulary), true);
  const implicitChannel = event('IYI', 0, 4, { parallelGroup: 'p1' });
  delete implicitChannel.channel;
  assert.equal(isValidGlossTimeline([
    event('SEN', 0, 4, { channel: 'manual', parallelGroup: 'p1' }),
    implicitChannel,
  ], vocabulary), false);
});
