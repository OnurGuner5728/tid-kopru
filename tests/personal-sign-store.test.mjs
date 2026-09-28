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
  assert.equal(await store.getStorageMode(), 'session-only');
  await store.clear();
  assert.deepEqual(await store.listLabels(), []);
});

test('store reports device persistence when IndexedDB is available', async () => {
  const indexedDB = { open() {
    const request = {};
    queueMicrotask(() => { request.result = {}; request.onsuccess(); });
    return request;
  } };
  const store = createPersonalSignStore({ indexedDB, dbName: 'store-storage-mode-test' });

  assert.equal(await store.getStorageMode(), 'device');
});

test('store switches its report to session-only when an IndexedDB transaction fails', async () => {
  const indexedDB = { open() {
    const request = {};
    queueMicrotask(() => { request.result = { transaction() { throw new Error('quota denied'); } }; request.onsuccess(); });
    return request;
  } };
  const store = createPersonalSignStore({ indexedDB, dbName: 'store-transaction-fallback-test' });

  await store.addSample('IYI', sample);

  assert.equal(await store.getStorageMode(), 'session-only');
  assert.equal((await store.getSamples('IYI')).length, 1);
});

test('store rejects raw or empty camera payloads', async () => {
  const store = createPersonalSignStore({ indexedDB: null, dbName: 'store-validation-test' });
  await assert.rejects(store.addSample('IYI', { frames: [] }), { code: 'invalid_personal_sample' });
  await assert.rejects(store.addSample('IYI', { frames: [{ imageBitmap: {} }] }), { code: 'invalid_personal_sample' });
});

test('adding a teaching example waits until device storage commits it', async () => {
  let finishTransaction;
  const indexedDB = { open() {
    const openRequest = {};
    queueMicrotask(() => {
      openRequest.result = { transaction() {
        const transaction = { objectStore() { return { add() {
          const request = {};
          queueMicrotask(() => { request.result = 1; request.onsuccess(); });
          return request;
        } }; } };
        finishTransaction = () => transaction.oncomplete();
        return transaction;
      } };
      openRequest.onsuccess();
    });
    return openRequest;
  } };
  const store = createPersonalSignStore({ indexedDB, dbName: 'store-commit-test' });
  let settled = false;
  const saving = store.addSample('MERHABA', sample).then(() => { settled = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  finishTransaction();
  await saving;
  assert.equal(settled, true);
});
