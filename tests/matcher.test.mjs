import test from 'node:test';
import assert from 'node:assert/strict';
import { createDictionaryIndex, matchText, normalizeWord, tokenize } from '../public/matcher.mjs';

test('Türkçe harfleri sözlük biçimine dönüştürür', () => {
  assert.equal(normalizeWord('  görüşürüz! '), 'GORUSURUZ');
  assert.equal(normalizeWord('İşaret'), 'ISARET');
});

test('noktalama işaretlerini atarak sözcük sırasını korur', () => {
  assert.deepEqual(tokenize('Anne, baba!').map(({ normalized }) => normalized), ['ANNE', 'BABA']);
});

test('yalnızca birebir eşleşen kayıtları bulur', () => {
  const dictionary = { ANNE: {}, BABA: {}, ARKADAS: {} };
  const result = matchText('Anne arkadaş geliyor', dictionary);

  assert.deepEqual(result.matched.map(({ dictionaryKey }) => dictionaryKey), ['ANNE', 'ARKADAS']);
  assert.deepEqual(result.missing.map(({ source }) => source), ['geliyor']);
});

test('sözlükteki Türkçe ve ASCII anahtarları aynı biçimde indeksler', () => {
  const index = createDictionaryIndex({ 'ABİ': {}, AGUSTOS: {} });
  assert.equal(index.get('ABI'), 'ABİ');
  assert.equal(index.get('AGUSTOS'), 'AGUSTOS');
});

test('boş metin için boş sonuç döndürür', () => {
  assert.deepEqual(matchText('   ', { ANNE: {} }), { matched: [], missing: [], tokens: [] });
});
