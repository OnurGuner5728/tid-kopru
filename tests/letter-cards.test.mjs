import assert from 'node:assert/strict';
import test from 'node:test';

import { createLetterCardSegments, renderLetterCards, splitTurkishGraphemes } from '../public/letter-cards.mjs';

test('Turkish graphemes preserve alphabet letters and apostrophized names', () => {
  assert.deepEqual(splitTurkishGraphemes('ÇĞIİÖŞÜ'), ['Ç', 'Ğ', 'I', 'İ', 'Ö', 'Ş', 'Ü']);
  assert.deepEqual(splitTurkishGraphemes("Onur'un"), ['O', 'n', 'u', 'r', "'", 'u', 'n']);
});

test('control characters are removed from letter cards', () => {
  assert.deepEqual(splitTurkishGraphemes('A\u0000B\u200BC'), ['A', 'B', 'C']);
  assert.deepEqual(createLetterCardSegments('A\u0000B').map(({ label }) => label), ['A', 'B']);
});

test('emoji becomes one visible unsupported card', () => {
  const segments = createLetterCardSegments('👍🏽');
  assert.equal(segments.length, 1);
  assert.deepEqual(segments[0], {
    kind: 'unsupported',
    label: 'Desteklenmeyen simge: 👍🏽',
    source: 'fallback',
  });
});

test('letter-card renderer replaces stale cards with accessible labels', () => {
  const children = [];
  const document = { createElement: () => ({ className: '', textContent: '', dataset: {} }) };
  const container = {
    ownerDocument: document,
    replaceChildren: (...nodes) => { children.splice(0, children.length, ...nodes); },
  };
  renderLetterCards(container, createLetterCardSegments('İyi'));
  assert.deepEqual(children.map(({ textContent }) => textContent), ['İ', 'Y', 'İ']);
  assert.ok(children.every(({ className }) => className === 'letter-card'));
});
