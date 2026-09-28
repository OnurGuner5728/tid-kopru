import assert from 'node:assert/strict';
import test from 'node:test';
import { requestCameraWithTimeout, cameraStartMessage } from '../public/camera-permission.mjs';

test('camera permission timeout releases a late stream', async () => {
  let resolveRequest;
  let stops = 0;
  const mediaDevices = { getUserMedia: () => new Promise((resolve) => { resolveRequest = resolve; }) };
  await assert.rejects(requestCameraWithTimeout(mediaDevices, { video: true }, 5), { name: 'TimeoutError' });
  resolveRequest({ getTracks: () => [{ stop: () => { stops += 1; } }] });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(stops, 1);
});

test('camera errors explain the failing action', () => {
  assert.match(cameraStartMessage('getUserMedia', { name: 'NotAllowedError' }), /izni verilmedi/u);
  assert.match(cameraStartMessage('getUserMedia', { name: 'NotFoundError' }), /bulunamadı/u);
  assert.match(cameraStartMessage('getUserMedia', { name: 'TimeoutError' }), /yanıt vermedi/u);
  assert.match(cameraStartMessage('landmarks', { name: 'Error' }), /hareket noktaları/u);
});
