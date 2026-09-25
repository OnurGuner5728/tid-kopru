import assert from 'node:assert/strict';
import test from 'node:test';

import { createPersonalSignStore } from '../public/personal-sign-store.mjs';

const sample = { frames: [{ timestampMs: 1, handMask: { left: true, right: false }, hands: { left: [0, 1, 2], right: null }, pose: null, face: null }] };

test('personal samples persist across store instances and support label deletion', async () => {
  const first = createPersonalSignStore({ indexedDB: null, dbName: 'store-persistence-test' });
  await first.addSample('MERHABA', sample);
  const second = createPersonalSignStore({ indexedDB: null, dbName: 'store-persistence-test' });
  assert.equal((await second.getSamples('MERHABA')).length, 1);
  assert.deepEqual(await second.listLabels(), ['MERHABA']);
  await second.deleteLabel('MERHABA');
  assert.deepEqual(await first.getSamples('MERHABA'), []);
});

test('store falls back to memory when IndexedDB open throws and can clear all data', async () => {
  const store = createPersonalSignStore({ indexedDB: { open() { throw new Error('denied'); } }, dbName: 'store-fallback-test' });
  await store.addSample('IYI', sample);
  assert.equal((await store.getSamples('IYI')).length, 1);
  await store.clear();
  assert.deepEqual(await store.listLabels(), []);
});

test('store rejects raw or empty camera payloads', async () => {
  const store = createPersonalSignStore({ indexedDB: null, dbName: 'store-validation-test' });
  await assert.rejects(store.addSample('IYI', { frames: [] }), { code: 'invalid_personal_sample' });
  await assert.rejects(store.addSample('IYI', { frames: [{ imageBitmap: {} }] }), { code: 'invalid_personal_sample' });
});
