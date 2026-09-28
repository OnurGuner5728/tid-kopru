import assert from 'node:assert/strict';
import test from 'node:test';

import { createMediaCaptureRegistry } from '../public/media-capture-registry.mjs';

function streamWithTrack() {
  let stopCount = 0;
  const track = { stop() { stopCount += 1; } };
  return { stream: { getTracks: () => [track] }, get stopCount() { return stopCount; } };
}

test('permission response arriving after cancel is rejected and its tracks are stopped', () => {
  const registry = createMediaCaptureRegistry();
  const request = registry.begin('camera');
  registry.cancel('camera');
  const late = streamWithTrack();

  assert.equal(registry.accept('camera', request, late.stream), false);
  assert.equal(late.stopCount, 1);
});

test('active capture lease owns its stream and cancellation stops it', () => {
  const registry = createMediaCaptureRegistry();
  const request = registry.begin('teaching');
  const active = streamWithTrack();

  assert.equal(registry.accept('teaching', request, active.stream), true);
  assert.equal(registry.isCurrent('teaching', request), true);
  registry.cancel('teaching');
  assert.equal(registry.isCurrent('teaching', request), false);
  assert.equal(active.stopCount, 1);
});

test('dispose releases active streams and rejects later permission responses', () => {
  const registry = createMediaCaptureRegistry();
  const cameraRequest = registry.begin('camera');
  const camera = streamWithTrack();
  registry.accept('camera', cameraRequest, camera.stream);
  const teachingRequest = registry.begin('teaching');
  const lateTeaching = streamWithTrack();

  registry.dispose();

  assert.equal(camera.stopCount, 1);
  assert.equal(registry.accept('teaching', teachingRequest, lateTeaching.stream), false);
  assert.equal(lateTeaching.stopCount, 1);
});
