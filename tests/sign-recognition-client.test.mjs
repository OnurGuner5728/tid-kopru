import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

import { createOnnxSession, downloadCameraModel, verifySameOriginHashes } from '../public/onnx-runtime-loader.mjs';
import { SignRecognitionClient } from '../public/sign-recognition.mjs';

const bytes = new TextEncoder().encode('local fake model');
const sha256 = createHash('sha256').update(bytes).digest('hex');
const glossEvents = [{ glossId: 'HELLO', startFrame: 0, endFrame: 2, confidence: 0.9 }];

function manifest(overrides = {}) {
  return {
    schemaVersion: 1,
    available: true,
    modelVersion: 'fixture-seq-v1',
    contentVersion: 'fixture-content-v1',
    modelPath: '/assets/tid/camera/model.onnx',
    runtimeModule: '/assets/tid/camera/pipeline.mjs',
    files: [
      { path: '/assets/tid/camera/model.onnx', sha256, licenseId: 'TEST-ONLY', redistributionAllowed: true },
      { path: '/assets/tid/camera/pipeline.mjs', sha256, licenseId: 'TEST-ONLY', redistributionAllowed: true },
    ],
    vocabulary: ['HELLO'],
    blankId: 0,
    confidenceThreshold: 0.5,
    preprocessingFingerprint: 'fixture-preprocessing-v1',
    ...overrides,
  };
}

function makeResponse(value = bytes) {
  return { ok: true, arrayBuffer: async () => value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) };
}

function fakeCaches(names = []) {
  const stores = new Map(names.map((name) => [name, new Map()]));
  return {
    stores,
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        async match(key) { return store.get(typeof key === 'string' ? key : key.url)?.clone(); },
        async put(key, value) { store.set(typeof key === 'string' ? key : key.url, value.clone()); },
      };
    },
  };
}

class FakeWorker {
  listeners = new Map();
  messages = [];
  terminated = false;
  nextResponse = { type: 'CANDIDATE', glossEvents, confidence: 0.9 };

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  postMessage(message, transfer = []) {
    this.messages.push({ message, transfer });
    if (message.type === 'INIT') queueMicrotask(() => this.emit('message', { data: { type: 'READY' } }));
    if (message.type === 'FINISH') queueMicrotask(() => this.emit('message', { data: this.nextResponse }));
  }

  emit(type, event) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  terminate() {
    this.terminated = true;
  }
}

function fakeEnvironment(overrides = {}) {
  const tracks = [{ stopped: false, stop() { this.stopped = true; } }];
  const stream = { getTracks: () => tracks };
  const video = {
    readyState: 0,
    currentTime: 0,
    srcObject: null,
    play: async () => {},
    pause: () => {},
  };
  let cameraCalls = 0;
  const worker = new FakeWorker();
  const rafCallbacks = [];
  const bitmaps = [];
  const environment = {
    origin: 'https://tid.test',
    fetcher: async () => makeResponse(),
    workerFactory: () => worker,
    mediaDevices: { getUserMedia: async () => { cameraCalls += 1; return stream; } },
    videoElement: video,
    createImageBitmap: async () => {
      const bitmap = { closed: false, close() { this.closed = true; } };
      bitmaps.push(bitmap);
      return bitmap;
    },
    requestAnimationFrame: (callback) => { rafCallbacks.push(callback); return rafCallbacks.length; },
    cancelAnimationFrame: () => {},
    pageTarget: new EventTarget(),
  };
  Object.assign(environment, overrides);
  return {
    environment,
    worker,
    tracks,
    stream,
    video,
    rafCallbacks,
    bitmaps,
    get cameraCalls() { return cameraCalls; },
  };
}

test('model-not-installed and hash mismatch fail before a worker or camera is started', async () => {
  const fake = fakeEnvironment();
  const client = new SignRecognitionClient(fake.environment);
  await assert.rejects(client.load({ manifest: manifest({ available: false }) }), /model_unavailable/u);
  assert.equal(fake.cameraCalls, 0);

  const badClient = new SignRecognitionClient(fake.environment);
  const badFiles = manifest().files.map((file, index) => ({ ...file, sha256: index === 0 ? '0'.repeat(64) : file.sha256 }));
  await assert.rejects(
    badClient.load({ manifest: manifest({ files: badFiles }) }),
    /hash_mismatch/u,
  );
  assert.equal(fake.cameraCalls, 0);
  await client.dispose();
  await badClient.dispose();
});

test('asset verification rejects external origins before fetching', async () => {
  let fetched = 0;
  await assert.rejects(
    verifySameOriginHashes([{ path: 'https://outside.example/model.onnx', sha256, licenseId: 'TEST-ONLY', redistributionAllowed: true }], {
      origin: 'https://tid.test',
      fetcher: async () => { fetched += 1; return makeResponse(); },
    }),
    /unsafe_asset_path/u,
  );
  assert.equal(fetched, 0);
});

test('camera model files resolve under the project-site base path', async () => {
  const baseUrl = 'https://tid.test/tid-kopru/';
  const requested = [];
  await verifySameOriginHashes(manifest().files, {
    origin: 'https://tid.test',
    baseUrl,
    fetcher: async (url) => {
      requested.push(url);
      return makeResponse();
    },
  });

  assert.deepEqual(requested.map((url) => new URL(url).pathname), [
    '/tid-kopru/assets/tid/camera/model.onnx',
    '/tid-kopru/assets/tid/camera/pipeline.mjs',
  ]);
});

test('ONNX session creation uses the hash-verified model bytes', async () => {
  let received;
  const runtime = { InferenceSession: { create: async (modelBytes, options) => {
    received = { modelBytes, options };
    return { ready: true };
  } } };
  const session = await createOnnxSession(manifest(), runtime, {
    origin: 'https://tid.test',
    fetcher: async () => makeResponse(),
  });
  assert.equal(session.ready, true);
  assert.deepEqual([...received.modelBytes], [...bytes]);
  assert.deepEqual(received.options.executionProviders, ['wasm']);
});

test('user-started model install verifies every hash before replacing an older version cache', async () => {
  const caches = fakeCaches(['tid-camera-model-old-v1', 'another-app-cache']);
  const installed = await downloadCameraModel(manifest(), {
    origin: 'https://tid.test',
    fetcher: async () => makeResponse(),
    cacheStorage: caches,
  });
  assert.equal(installed.cacheName, 'tid-camera-model-fixture-seq-v1');
  assert.equal(caches.stores.has('tid-camera-model-old-v1'), false);
  assert.equal(caches.stores.has('another-app-cache'), true);
  assert.equal(caches.stores.has('tid-camera-model-fixture-seq-v1-staging'), false);
  assert.equal(caches.stores.get('tid-camera-model-fixture-seq-v1').size, 2);
});

test('downloaded camera files are cached at their project-site URLs', async () => {
  const baseUrl = 'https://tid.test/tid-kopru/';
  const caches = fakeCaches();
  await downloadCameraModel(manifest(), {
    origin: 'https://tid.test',
    baseUrl,
    fetcher: async () => makeResponse(),
    cacheStorage: caches,
  });

  const installedUrls = [...caches.stores.get('tid-camera-model-fixture-seq-v1').keys()];
  assert.deepEqual(installedUrls.map((url) => new URL(url).pathname), [
    '/tid-kopru/assets/tid/camera/model.onnx',
    '/tid-kopru/assets/tid/camera/pipeline.mjs',
  ]);
});

test('camera worker downloads manifest assets under its project-site directory', async () => {
  const workerSource = await readFile(new URL('../public/sign-recognition-worker.js', import.meta.url), 'utf8');
  const fetched = [];
  const listeners = new Map();
  let complete;
  const finished = new Promise((resolve) => { complete = resolve; });
  const self = {
    location: { href: 'https://tid.test/tid-kopru/sign-recognition-worker.js', origin: 'https://tid.test' },
    addEventListener(type, listener) { listeners.set(type, listener); },
    postMessage(message) { if (message.type === 'ERROR' || message.type === 'READY') complete(message); },
  };
  const workerBytes = new TextEncoder().encode('verified worker fixture');
  const workerHash = createHash('sha256').update(workerBytes).digest('hex');
  vm.runInNewContext(workerSource, {
    URL,
    crypto: webcrypto,
    self,
    fetch: async (url) => {
      fetched.push(url);
      return { ok: true, arrayBuffer: async () => workerBytes.buffer.slice(workerBytes.byteOffset, workerBytes.byteOffset + workerBytes.byteLength) };
    },
  });
  listeners.get('message')({ data: {
    type: 'INIT',
    manifest: {
      available: true,
      modelPath: '/assets/tid/camera/model.onnx',
      runtimeModule: '/assets/tid/camera/pipeline.mjs',
      preprocessingFingerprint: 'fixture-v1',
      files: [
        { path: '/assets/tid/camera/model.onnx', sha256: workerHash, licenseId: 'TEST-ONLY', redistributionAllowed: true },
        { path: '/assets/tid/camera/pipeline.mjs', sha256: workerHash, licenseId: 'TEST-ONLY', redistributionAllowed: true },
      ],
    },
  } });
  await finished;

  assert.deepEqual(fetched.map((url) => new URL(url).pathname), [
    '/tid-kopru/assets/tid/camera/model.onnx',
    '/tid-kopru/assets/tid/camera/pipeline.mjs',
  ]);
});

test('a failed model hash preserves the previously installed model cache', async () => {
  const caches = fakeCaches(['tid-camera-model-old-v1']);
  await assert.rejects(downloadCameraModel(manifest(), {
    origin: 'https://tid.test',
    fetcher: async () => makeResponse(new TextEncoder().encode('tampered bytes')),
    cacheStorage: caches,
  }), /hash_mismatch/u);
  assert.deepEqual(await caches.keys(), ['tid-camera-model-old-v1']);
});

test('camera starts only from explicit action and a finished utterance creates a review candidate only', async () => {
  const fake = fakeEnvironment();
  fake.video.readyState = 2;
  const client = new SignRecognitionClient(fake.environment);
  await client.load({ manifest: manifest() });
  assert.equal(fake.cameraCalls, 0);

  const candidates = [];
  await assert.rejects(client.startUtterance({ onCandidate: (candidate) => candidates.push(candidate) }), /user_action_required/u);
  assert.equal(fake.cameraCalls, 0);
  await client.startUtterance({ userInitiated: true, onCandidate: (candidate) => candidates.push(candidate) });
  assert.equal(fake.cameraCalls, 1);
  assert.equal(fake.video.srcObject, fake.stream);

  fake.rafCallbacks[0](1000);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await client.stopCapture();

  assert.equal(candidates.length, 1);
  assert.deepEqual(candidates[0].glossEvents, glossEvents);
  assert.equal(candidates[0].modelVersion, 'fixture-seq-v1');
  assert.equal(candidates[0].source, 'verified-onnx');
  assert.equal(candidates[0].needsConfirmation, true);
  assert.equal(fake.tracks.every((track) => track.stopped), true);
  assert.equal(fake.video.srcObject, null);
  assert.ok(fake.worker.messages.some(({ message, transfer }) => message.type === 'FRAME' && transfer.length === 1));
  assert.equal(fake.bitmaps.every((bitmap) => bitmap.closed), true);
  await client.dispose();
});

test('recognizer can use the already-approved shared camera stream without owning or stopping it', async () => {
  const fake = fakeEnvironment();
  const client = new SignRecognitionClient(fake.environment);
  await client.load({ manifest: manifest() });

  await client.startUtterance({ userInitiated: true, stream: fake.stream });
  assert.equal(fake.cameraCalls, 0);
  assert.equal(fake.video.srcObject, fake.stream);
  await client.stopCapture();

  assert.equal(fake.tracks.every((track) => track.stopped), false);
  assert.equal(fake.video.srcObject, fake.stream);
  await client.dispose();
  assert.equal(fake.tracks.every((track) => track.stopped), false);
  assert.equal(fake.video.srcObject, fake.stream);
});

test('stopping while camera permission is pending releases the late stream', async () => {
  const fake = fakeEnvironment();
  let resolvePermission;
  fake.environment.mediaDevices.getUserMedia = () => new Promise((resolve) => { resolvePermission = resolve; });
  const client = new SignRecognitionClient(fake.environment);
  await client.load({ manifest: manifest() });
  const starting = client.startUtterance({ userInitiated: true });
  await Promise.resolve();

  await client.abortCapture('user_cancelled');
  resolvePermission(fake.stream);

  await assert.rejects(starting, { code: 'capture_cancelled' });
  assert.equal(fake.tracks.every((track) => track.stopped), true);
  assert.equal(fake.video.srcObject, null);
  await client.dispose();
});

test('stopping while the shared camera preview is starting does not revive its capture loop', async () => {
  const fake = fakeEnvironment();
  let resolvePlay;
  fake.video.play = () => new Promise((resolve) => { resolvePlay = resolve; });
  const client = new SignRecognitionClient(fake.environment);
  await client.load({ manifest: manifest() });
  const starting = client.startUtterance({ userInitiated: true, stream: fake.stream });
  await Promise.resolve();

  await client.abortCapture('user_cancelled');
  resolvePlay();

  await assert.rejects(starting, { code: 'capture_cancelled' });
  assert.equal(fake.tracks.every((track) => track.stopped), false);
  assert.equal(fake.video.srcObject, fake.stream);
  assert.equal(fake.rafCallbacks.length, 0);
  await client.dispose();
});

test('camera frame transfer applies backpressure instead of buffering an unbounded utterance', async () => {
  const fake = fakeEnvironment();
  fake.video.readyState = 2;
  const client = new SignRecognitionClient(fake.environment);
  await client.load({ manifest: manifest() });
  await client.startUtterance({ userInitiated: true });
  for (let index = 0; index < 6; index += 1) {
    const callback = fake.rafCallbacks.at(-1);
    callback(1000 + index * 100);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.equal(fake.worker.messages.filter(({ message }) => message.type === 'FRAME').length, 2);
  assert.equal(fake.bitmaps.length, 2);
  await client.abortCapture();
  await client.dispose();
});

test('NaN confidence and unknown gloss IDs are rejected instead of becoming candidates', async () => {
  for (const response of [
    { type: 'CANDIDATE', glossEvents: [{ ...glossEvents[0], confidence: Number.NaN }], confidence: Number.NaN },
    { type: 'CANDIDATE', glossEvents: [{ ...glossEvents[0], glossId: 'UNKNOWN' }], confidence: 0.99 },
  ]) {
    const fake = fakeEnvironment();
    const client = new SignRecognitionClient(fake.environment);
    fake.worker.nextResponse = response;
    await client.load({ manifest: manifest() });
    const rejected = [];
    await client.startUtterance({ userInitiated: true, onRejected: (result) => rejected.push(result) });
    await client.stopCapture();
    assert.equal(rejected.length, 1);
    assert.equal(fake.tracks.every((track) => track.stopped), true);
    await client.dispose();
  }
});

test('worker crash, page hide, and dispose release tracks and terminate the worker', async () => {
  const fake = fakeEnvironment();
  const client = new SignRecognitionClient(fake.environment);
  await client.load({ manifest: manifest() });
  const errors = [];
  await client.startUtterance({ userInitiated: true, onError: (error) => errors.push(error) });
  fake.worker.emit('error', { message: 'worker_failed' });
  assert.equal(fake.tracks.every((track) => track.stopped), true);
  assert.equal(errors.length, 1);

  const afterCrash = fakeEnvironment();
  const pageClient = new SignRecognitionClient(afterCrash.environment);
  await pageClient.load({ manifest: manifest() });
  await pageClient.startUtterance({ userInitiated: true });
  afterCrash.environment.pageTarget.dispatchEvent(new Event('pagehide'));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(afterCrash.tracks.every((track) => track.stopped), true);
  assert.equal(afterCrash.worker.terminated, true);
  await pageClient.dispose();
  assert.equal(afterCrash.worker.terminated, true);
});

test('the shipped app keeps optional model download disabled while personal camera runtime can initialize', async () => {
  const { readFile } = await import('node:fs/promises');
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const packagedManifest = await readFile(new URL('../public/assets/tid/sentence-model-manifest.json', import.meta.url), 'utf8');
  const value = JSON.parse(packagedManifest);
  assert.equal(value.available, false);
  assert.match(html, /id="camera-start"[^>]*disabled/u);
  assert.match(html, /id="camera-model-download"[^>]*disabled/u);
  assert.match(html, /yalnızca sayısal hareket noktaları saklanır/iu);
  const appSource = await readFile(new URL('../public/app.mjs', import.meta.url), 'utf8');
  assert.match(appSource, /cameraConfirm\.addEventListener\('click',[\s\S]*?replyText\.value = text/u);
  assert.match(appSource, /createLandmarkRuntime/u);
});
