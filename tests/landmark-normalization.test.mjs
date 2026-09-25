import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, webcrypto } from 'node:crypto';

import { normalizeLandmarkFrame } from '../public/landmark-normalization.mjs';
import { createLandmarkRuntime, verifyRuntimeManifestFiles } from '../public/landmark-runtime.mjs';

const hand = (offsetX = 0, scale = 1) => Array.from({ length: 21 }, (_, index) => ({
  x: offsetX + scale * (index % 5), y: 10 + scale * Math.floor(index / 5), z: scale * index / 20,
}));

test('hand normalization is translation and scale invariant with stable handedness', () => {
  const first = normalizeLandmarkFrame({
    timestampMs: 10,
    handLandmarks: [hand(0, 1), hand(100, 2)],
    handednesses: [[{ categoryName: 'Right' }], [{ categoryName: 'Left' }]],
  });
  const second = normalizeLandmarkFrame({
    timestampMs: 20,
    handLandmarks: [hand(50, 3), hand(200, 6)],
    handednesses: [[{ categoryName: 'Right' }], [{ categoryName: 'Left' }]],
  });

  assert.deepEqual(first.handMask, { left: true, right: true });
  assert.deepEqual(first.hands, second.hands);
  assert.equal(first.hands.left.length, 63);
});

test('missing hands are masked while face and pose stay optional', () => {
  const frame = normalizeLandmarkFrame({ timestampMs: 12, handLandmarks: [], handednesses: [] });
  assert.deepEqual(frame.handMask, { left: false, right: false });
  assert.equal(frame.hands.left, null);
  assert.equal(frame.pose, null);
  assert.equal(frame.face, null);
  assert.throws(() => normalizeLandmarkFrame({ timestampMs: 1 }), { code: 'empty_landmark_frame' });
});

test('runtime throttles frames to 15 fps, keeps timestamps increasing, and disposes its worker', async () => {
  const messages = [];
  const listeners = new Map();
  const worker = {
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener() {},
    postMessage(message) {
      messages.push(message);
      if (message.type === 'initialize') queueMicrotask(() => listeners.get('message')?.({ data: { type: 'ready' } }));
      if (message.type === 'process-frame') queueMicrotask(() => listeners.get('message')?.({ data: { type: 'frame', requestId: message.requestId, frame: { timestampMs: message.timestampMs } } }));
    },
    terminate() { this.terminated = true; },
  };
  const runtime = createLandmarkRuntime({
    manifest: { schemaVersion: 1, files: [
      { path: 'vendor/mediapipe/vision_bundle.mjs' },
      { path: 'assets/runtime/models/hand_landmarker.task' },
      { path: 'assets/runtime/models/pose_landmarker_lite.task' },
      { path: 'assets/runtime/models/face_landmarker.task' },
    ] },
    baseUrl: 'https://example.test/app/',
    workerFactory: () => worker,
  });
  await runtime.initialize();
  assert.equal((await runtime.processFrame({}, 100)).timestampMs, 100);
  assert.equal(await runtime.processFrame({}, 120), null);
  assert.equal((await runtime.processFrame({}, 170)).timestampMs, 170);
  assert.deepEqual(messages.filter(({ type }) => type === 'process-frame').map(({ timestampMs }) => timestampMs), [100, 170]);
  await runtime.dispose();
  assert.equal(worker.terminated, true);
  assert.equal(messages.at(-1).type, 'dispose');
});

test('runtime verification rejects corrupted same-origin assets before camera startup', async () => {
  const bytes = new TextEncoder().encode('verified runtime');
  const file = {
    path: 'assets/runtime/models/hand_landmarker.task',
    sha256: createHash('sha256').update(bytes).digest('hex'),
    license: 'Apache-2.0', bytes: bytes.byteLength,
  };
  const options = {
    baseUrl: 'https://example.test/app/', cryptoProvider: webcrypto,
    fetcher: async () => new Response(bytes),
  };
  assert.equal(await verifyRuntimeManifestFiles({ schemaVersion: 1, files: [file] }, options), true);
  await assert.rejects(verifyRuntimeManifestFiles({ schemaVersion: 1, files: [{ ...file, sha256: '0'.repeat(64) }] }, options), { code: 'runtime_hash_mismatch' });
});
