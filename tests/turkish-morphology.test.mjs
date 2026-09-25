import assert from 'node:assert/strict';
import test from 'node:test';

import { analyzeTurkishText, tokenizeTurkish } from '../public/turkish-morphology.mjs';

const lexicon = {
  entries: [
    { lemma: 'sen', partOfSpeech: 'pronoun' },
    { lemma: 'iyi', partOfSpeech: 'adjective' },
    { lemma: 'ev', partOfSpeech: 'noun' },
    { lemma: 'ışık', partOfSpeech: 'noun' },
    { lemma: 'gel', partOfSpeech: 'verb' },
    { lemma: 'güzel', partOfSpeech: 'adjective' },
  ],
};

test('Turkish locale normalization distinguishes dotted and dotless I', () => {
  const result = analyzeTurkishText('İYİ IŞIK', lexicon);

  assert.deepEqual(result.sentences[0].tokens.map(({ lemma }) => lemma), ['iyi', 'ışık']);
  assert.deepEqual(result.unsupported, []);
});

test('iyisin keeps its second person predicate feature', () => {
  const result = analyzeTurkishText('Sen iyisin', lexicon);

  assert.equal(result.sentences[0].tokens[1].lemma, 'iyi');
  assert.equal(result.sentences[0].tokens[1].partOfSpeech, 'adjective');
  assert.deepEqual(result.sentences[0].tokens[1].features, { predicatePerson: '2sg' });
});

test('evim keeps first person possession', () => {
  const token = analyzeTurkishText('evim', lexicon).sentences[0].tokens[0];

  assert.equal(token.lemma, 'ev');
  assert.deepEqual(token.features, { possessivePerson: '1sg' });
});

test('evin is rejected when possessive and genitive readings remain', () => {
  const result = analyzeTurkishText('evin', lexicon);

  assert.equal(result.unsupported[0].reason, 'ambiguous_analysis');
  assert.equal(result.sentences[0].tokens[0].lemma, null);
});

test('supported negative past form keeps polarity and tense', () => {
  const token = analyzeTurkishText('gelmedi', lexicon).sentences[0].tokens[0];

  assert.equal(token.lemma, 'gel');
  assert.deepEqual(token.features, {
    polarity: 'negative',
    tense: 'past',
    predicatePerson: '3sg',
  });
});

test('supported negative progressive form remains explicit', () => {
  const token = analyzeTurkishText('gelmiyor', lexicon).sentences[0].tokens[0];

  assert.equal(token.lemma, 'gel');
  assert.deepEqual(token.features, {
    polarity: 'negative',
    tense: 'progressive',
    predicatePerson: '3sg',
  });
});

test('question clitic carries its second person feature', () => {
  const result = analyzeTurkishText('Sen iyi misin?', lexicon);
  const question = result.sentences[0].tokens[2];

  assert.equal(question.lemma, 'mi');
  assert.deepEqual(question.features, { question: true, predicatePerson: '2sg' });
  assert.deepEqual(result.unsupported, []);
});

test('known plural and dative patterns keep their grammatical features', () => {
  const plural = analyzeTurkishText('evler', lexicon).sentences[0].tokens[0];
  const dative = analyzeTurkishText('eve', lexicon).sentences[0].tokens[0];

  assert.deepEqual(plural.features, { number: 'plural' });
  assert.deepEqual(dative.features, { case: 'dative' });
});

test('tokenization preserves source offsets and sentence boundaries', () => {
  const tokens = tokenizeTurkish('Sen iyisin. Evim güzel!');

  assert.deepEqual(tokens.map(({ surface, start, end, sentenceIndex }) => ({ surface, start, end, sentenceIndex })), [
    { surface: 'Sen', start: 0, end: 3, sentenceIndex: 0 },
    { surface: 'iyisin', start: 4, end: 10, sentenceIndex: 0 },
    { surface: 'Evim', start: 12, end: 16, sentenceIndex: 1 },
    { surface: 'güzel', start: 17, end: 22, sentenceIndex: 1 },
  ]);
});

test('unknown words are unsupported rather than reduced to a guessed stem', () => {
  const result = analyzeTurkishText('bilinmeyen', lexicon);

  assert.equal(result.unsupported[0].reason, 'unknown_lexeme');
  assert.equal(result.sentences[0].tokens[0].lemma, null);
});

test('unsupported numeric tokens are preserved for explicit rejection', () => {
  const result = analyzeTurkishText('12', lexicon);

  assert.deepEqual(result.unsupported.map(({ reason }) => reason), ['unknown_lexeme']);
  assert.equal(result.sentences[0].tokens[0].surface, '12');
});

test('unsupported suffixes are not silently removed from a known stem', () => {
  const result = analyzeTurkishText('iyiydin', lexicon);

  assert.equal(result.unsupported[0].reason, 'unsupported_inflection');
  assert.equal(result.sentences[0].tokens[0].lemma, null);
});

test('known suffixes with invalid vowel harmony are not accepted', () => {
  for (const surface of ['evum', 'eva']) {
    const result = analyzeTurkishText(surface, lexicon);
    assert.deepEqual(result.unsupported.map(({ reason }) => reason), ['unsupported_inflection'], surface);
    assert.equal(result.sentences[0].tokens[0].lemma, null, surface);
  }
});
