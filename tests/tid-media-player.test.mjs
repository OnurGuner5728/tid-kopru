import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createTidMediaPlayer } from '../public/tid-media-player.mjs';

const bytes = new TextEncoder().encode('{"animations":{}}');
const sha256 = createHash('sha256').update(bytes).digest('hex');
const videoAsset = (overrides = {}) => ({
  path: '/assets/tid/clip.webm',
  licenseId: 'TEST-ONLY',
  redistributionAllowed: true,
  sha256,
  durationMs: 1200,
  mediaType: 'video/webm',
  bytes,
  ...overrides,
});

class FakeVideo {
  constructor({ autoComplete = true } = {}) {
    this.paused = true;
    this.currentTime = 0;
    this.readyState = 1;
    this.listeners = new Map();
    this.autoComplete = autoComplete;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener({ type });
  }

  async play() {
    this.paused = false;
    if (this.autoComplete) {
      setTimeout(() => {
        this.currentTime = 0.7;
        this.dispatch('timeupdate');
      }, 250);
    }
  }

  pause() {
    this.paused = true;
  }
}

const approvedVideoSegment = (assetId, overrides = {}) => ({
  kind: 'video', assetId, startMs: 100, endMs: 700,
  nonManual: [{ startMs: 180, endMs: 320, face: 'neutral', head: 'still' }],
  ...overrides,
});

async function waitUntil(predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail('timed out waiting for media playback');
}

test('plays approved video segments in order, within timing bounds, and emits non-manual timing', async () => {
  const video = new FakeVideo();
  const played = [];
  const cues = [];
  const assets = new Map([
    ['first', videoAsset({ path: '/assets/tid/first.webm' })],
    ['second', videoAsset({ path: '/assets/tid/second.webm' })],
  ]);
  const player = createTidMediaPlayer({
    videoElement: video,
    resolveAsset: async (id) => { played.push(id); return assets.get(id); },
  });

  const result = await player.play([
    approvedVideoSegment('first'), approvedVideoSegment('second', { startMs: 0, endMs: 500, nonManual: [] }),
  ], { onNonManual: (event) => cues.push(event) });

  assert.deepEqual(result, { status: 'completed' });
  assert.deepEqual(played, ['first', 'second']);
  assert.equal(video.currentTime, 0.5);
  assert.equal(video.paused, true);
  assert.ok(cues.some(({ active }) => active === true));
  assert.ok(cues.some(({ active }) => active === false));
  player.dispose();
});

test('rejects missing assets before starting playback', async () => {
  const video = new FakeVideo();
  const player = createTidMediaPlayer({ videoElement: video, resolveAsset: async () => null });
  await assert.rejects(player.play([approvedVideoSegment('missing')]), { code: 'asset_missing' });
  assert.equal(video.paused, true);
});

test('rejects a media hash mismatch before playback', async () => {
  const video = new FakeVideo();
  const player = createTidMediaPlayer({
    videoElement: video,
    resolveAsset: async () => videoAsset({ sha256: '0'.repeat(64) }),
  });
  await assert.rejects(player.play([approvedVideoSegment('tampered')]), { code: 'asset_hash_mismatch' });
  assert.equal(video.paused, true);
});

test('rejects cross-origin asset paths and invalid segment bounds', async () => {
  const video = new FakeVideo();
  const player = createTidMediaPlayer({
    videoElement: video,
    origin: 'https://tid.test',
    resolveAsset: async () => videoAsset({ path: 'https://outside.test/clip.webm' }),
  });
  await assert.rejects(player.play([approvedVideoSegment('cross-origin')]), { code: 'asset_unsafe_path' });
  const rangePlayer = createTidMediaPlayer({ videoElement: video, resolveAsset: async () => videoAsset() });
  await assert.rejects(rangePlayer.play([approvedVideoSegment('bad-range', { endMs: 1500 })]), { code: 'segment_timing_invalid' });
  assert.equal(video.paused, true);
});

test('stop pauses an active video segment and resolves playback as stopped', async () => {
  const video = new FakeVideo({ autoComplete: false });
  const cues = [];
  const player = createTidMediaPlayer({ videoElement: video, resolveAsset: async () => videoAsset() });
  const pending = player.play([approvedVideoSegment('long')], { onNonManual: (event) => cues.push(event) });
  await waitUntil(() => cues.some(({ active }) => active));
  assert.equal(video.paused, false);
  await player.stop();
  assert.deepEqual(await pending, { status: 'stopped' });
  assert.equal(video.paused, true);
  assert.ok(cues.some(({ active }) => active === false));
  assert.equal([...video.listeners.values()].reduce((count, listeners) => count + listeners.size, 0), 0);
  player.dispose();
});

test('stop cancels an active validated avatar animation', async () => {
  let resolveAnimation;
  let stopCount = 0;
  const avatar = {
    playValidatedAnimation: () => new Promise((resolve) => { resolveAnimation = resolve; }),
    stop: () => { stopCount += 1; resolveAnimation?.({ status: 'stopped' }); },
    applyIdlePose() {},
  };
  const animationBytes = new TextEncoder().encode(JSON.stringify({
    animations: { 'approved-wave': { durationMs: 900, frames: [{ atMs: 0, pose: { hand: 'open' } }, { atMs: 900, pose: { hand: 'closed' } }] } },
  }));
  const animationHash = createHash('sha256').update(animationBytes).digest('hex');
  const player = createTidMediaPlayer({
    avatar,
    resolveAsset: async () => ({
      path: '/assets/tid/approved-animations.json', licenseId: 'TEST-ONLY', redistributionAllowed: true,
      sha256: animationHash, durationMs: 900, mediaType: 'application/json', bytes: animationBytes,
    }),
  });
  const pending = player.play([{
    kind: 'avatar', assetId: 'approved-avatar', animationId: 'approved-wave', startMs: 0, endMs: 900, nonManual: [],
  }]);
  await waitUntil(() => typeof resolveAnimation === 'function');
  await player.stop();
  assert.deepEqual(await pending, { status: 'stopped' });
  assert.equal(stopCount, 1);
});

test('end of playback pauses media, restores neutral avatar pose, and dispose removes listeners', async () => {
  const video = new FakeVideo();
  let idleCount = 0;
  const avatar = { stop() {}, applyIdlePose() { idleCount += 1; } };
  const player = createTidMediaPlayer({ videoElement: video, avatar, resolveAsset: async () => videoAsset() });
  assert.deepEqual(await player.play([approvedVideoSegment('clip')]), { status: 'completed' });
  assert.equal(video.paused, true);
  assert.ok(idleCount > 0);
  player.dispose();
  assert.equal([...video.listeners.values()].reduce((count, listeners) => count + listeners.size, 0), 0);
});
