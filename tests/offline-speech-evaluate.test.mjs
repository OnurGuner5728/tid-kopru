import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { evaluateResults, wordErrorRate } from '../tools/offline_speech/evaluate.mjs';

test('identical Turkish text has zero word error rate', () => {
  assert.equal(wordErrorRate('İyi günler', 'iyi günler'), 0);
});

test('one substitution in four words has 25 percent WER', () => {
  assert.equal(wordErrorRate('bugün hava çok güzel', 'bugün hava çok iyi'), 0.25);
});

test('empty reference with non-empty hypothesis reports full error', () => {
  assert.equal(wordErrorRate('', 'merhaba'), 1);
});

test('two empty texts have zero error rate', () => {
  assert.equal(wordErrorRate('', ''), 0);
});

test('insertions and deletions count as word errors', () => {
  assert.equal(wordErrorRate('bir iki', 'bir yeni iki'), 0.5);
  assert.equal(wordErrorRate('bir iki', 'iki'), 0.5);
});

test('result aggregation returns word errors and reference word count', () => {
  assert.deepEqual(evaluateResults([
    { reference: 'iyi hava', hypothesis: 'iyi güzel hava' },
    { reference: 'her şey yolunda', hypothesis: 'her şey bitti' }
  ]), {
    utterances: 2,
    wordErrors: 2,
    referenceWords: 5,
    wer: 0.4
  });
});

test('the prompt list contains 100 distinct non-empty Turkish utterances', async () => {
  const source = await readFile(new URL('../tools/offline_speech/phrases.tsv', import.meta.url), 'utf8');
  const rows = source.trim().split(/\r?\n/u).slice(1).map((line) => line.split('\t'));
  assert.equal(rows.length, 100);
  assert.equal(new Set(rows.map(([id]) => id)).size, 100);
  assert.ok(rows.every(([id, phrase]) => /^\d{3}$/u.test(id) && phrase.trim().length > 0));
  assert.ok(rows.every((row) => row.length === 2));
});
