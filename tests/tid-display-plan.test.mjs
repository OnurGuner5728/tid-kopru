import assert from 'node:assert/strict';
import test from 'node:test';

import { createTidDisplayPlan } from '../public/tid-display-plan.mjs';

const poseNames = [
  'ANNE', 'BEN', 'CEP TELEFONU', 'IYI', 'KAHVE', 'OKUL', 'SEN', 'YARIN',
];

const lexicon = {
  entries: [
    { lemma: 'anne', partOfSpeech: 'noun' },
    { lemma: 'ben', partOfSpeech: 'pronoun' },
    { lemma: 'değil', partOfSpeech: 'adjective' },
    { lemma: 'git', partOfSpeech: 'verb' },
    { lemma: 'iyi', partOfSpeech: 'adjective' },
    { lemma: 'kahve', partOfSpeech: 'noun' },
    { lemma: 'okul', partOfSpeech: 'noun' },
    { lemma: 'sen', partOfSpeech: 'pronoun' },
    { lemma: 'telefon', partOfSpeech: 'noun' },
    { lemma: 'yarın', partOfSpeech: 'adverb' },
  ],
};

const resources = { lexicon, poseNames, entries: [], templates: [], mediaManifest: {} };

test('an exact reviewed translation wins over dictionary and letter fallbacks', () => {
  const reviewed = {
    status: 'ready', sourceText: 'Sen iyisin', glossText: 'IYI SEN',
    segments: [{ kind: 'video', assetId: 'approved', startMs: 0, endMs: 1000 }],
  };
  const plan = createTidDisplayPlan('Sen iyisin', resources, { translateReviewed: () => reviewed });

  assert.equal(plan.sourceClass, 'reviewed-tid');
  assert.equal(plan.segments[0].kind, 'reviewed-media');
  assert.equal(plan.segments[0].mediaSegment.kind, 'video');
});

test('predicate person survives while known stems become dictionary poses', () => {
  const plan = createTidDisplayPlan('Sen iyisin', resources);

  assert.deepEqual(plan.segments.filter((segment) => segment.kind === 'dictionary-pose').map((segment) => segment.label), ['SEN', 'IYI']);
  assert.equal(plan.featureSummary.predicatePerson, '2sg');
  assert.equal(plan.sourceClass, 'dictionary-sequence');
});

test('ordinary sentence punctuation does not turn known poses into card fallback', () => {
  const plan = createTidDisplayPlan('Sen iyisin.', resources);
  assert.equal(plan.sourceClass, 'dictionary-sequence');
  assert.deepEqual(plan.segments.map((segment) => segment.label), ['SEN', 'IYI']);
});

test('negative predicates keep polarity and person', () => {
  const plan = createTidDisplayPlan('Ben iyi değilim', resources);

  assert.equal(plan.featureSummary.polarity, 'negative');
  assert.equal(plan.featureSummary.predicatePerson, '1sg');
  assert.ok(plan.segments.some((segment) => segment.kind === 'letter-card' && segment.token === 'değilim'));
});

test('stacked possession and genitive features are preserved', () => {
  const plan = createTidDisplayPlan('Annemin telefonu', resources);

  assert.equal(plan.featureSummary.possessivePerson, '1sg');
  assert.equal(plan.featureSummary.case, 'genitive');
  assert.ok(plan.segments.some((segment) => segment.kind === 'dictionary-pose' && segment.label === 'ANNE'));
  assert.ok(plan.segments.some((segment) => segment.kind === 'dictionary-pose' && segment.label === 'CEP TELEFONU'));
});

test('future and question features survive Turkish surface forms', () => {
  const plan = createTidDisplayPlan('Yarın okula gidecek misin?', resources);

  assert.equal(plan.featureSummary.tense, 'future');
  assert.equal(plan.featureSummary.question, true);
  assert.equal(plan.featureSummary.predicatePerson, '2sg');
});

test('apostrophes, unknown words and every remaining visible letter become cards', () => {
  const plan = createTidDisplayPlan("Onur'un kahvesi bilinmeyen", resources);
  const cardText = plan.segments.filter((segment) => segment.kind === 'letter-card').map((segment) => segment.label).join('');

  assert.match(cardText, /ONUR'UN/u);
  assert.match(cardText, /BİLİNMEYEN/u);
  assert.ok(plan.segments.some((segment) => segment.kind === 'dictionary-pose' && segment.label === 'KAHVE'));
  assert.equal(plan.sourceClass, 'fallback-cards');
});

test('punctuation-only and emoji input stay explicit and never claim reviewed TİD', () => {
  for (const text of ['?!', '🙂']) {
    const plan = createTidDisplayPlan(text, resources);
    assert.equal(plan.sourceClass, 'fallback-cards');
    assert.ok(plan.segments.every((segment) => segment.kind === 'unsupported'));
    assert.equal(plan.playable, true);
  }
});
