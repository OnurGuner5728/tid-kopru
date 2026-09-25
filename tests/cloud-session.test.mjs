import assert from 'node:assert/strict';
import test from 'node:test';

import { createCloudSession } from '../public/cloud-session.mjs';

test('cloud key stays closure-only and clears on page hide and disposal', async () => {
  const listeners = new Map();
  const pageTarget = {
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type) { listeners.delete(type); },
  };
  const session = createCloudSession({ pageTarget });
  session.setKey('fresh-test-key');
  assert.equal(session.hasKey(), true);
  assert.doesNotMatch(JSON.stringify(session), /fresh-test-key/u);
  assert.equal(await session.withKey((key) => key.length), 14);
  listeners.get('pagehide')();
  assert.equal(session.hasKey(), false);
  session.setKey('second-key');
  session.dispose();
  assert.equal(session.hasKey(), false);
  assert.equal(listeners.has('pagehide'), false);
});

test('session validates keys and never reveals one through properties', async () => {
  const session = createCloudSession({ pageTarget: null });
  assert.throws(() => session.setKey('  '), { code: 'invalid_cloud_key' });
  assert.deepEqual(Object.keys(session).sort(), ['clearKey', 'dispose', 'hasKey', 'setKey', 'withKey']);
  await assert.rejects(session.withKey(() => true), { code: 'cloud_key_missing' });
});
