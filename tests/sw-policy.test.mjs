import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';

const request = (url, mode = 'cors') => ({ method: 'GET', url, mode });
const source = await readFile(new URL('../public/sw-policy.js', import.meta.url), 'utf8');
const context = { URL, Response, crypto: webcrypto };
context.globalThis = context;
vm.runInNewContext(source, context);
const { getOfflineAwareResponse, getCameraModelResponse, getReviewedMediaResponse, getAppRelativePath, shouldDeleteCache, isPrivateRequest } = context.TidKopruCachePolicy;

test('offline navigation returns the cached app shell', async () => {
  const shell = new Response('<main>TİD Köprü</main>');
  const cache = { match: async (key) => key === 'https://tid.test/index.html' ? shell : undefined,
    put: async () => {} };
  const result = await getOfflineAwareResponse({
    request: request('https://tid.test/conversation', 'navigate'), cache,
    fetcher: async () => { throw new Error('offline'); },
    origin: 'https://tid.test', shellUrl: 'https://tid.test/index.html'
  });
  assert.equal(await result.text(), '<main>TİD Köprü</main>');
});

test('successful same-origin GET responses are cached', async () => {
  let stored;
  const cache = { match: async () => undefined, put: async (_key, value) => { stored = value; } };
  const network = new Response('ok');
  const result = await getOfflineAwareResponse({
    request: request('https://tid.test/styles.css'), cache,
    fetcher: async () => network, origin: 'https://tid.test',
    shellUrl: 'https://tid.test/index.html'
  });
  assert.equal(await result.text(), 'ok');
  assert.ok(stored);
});

test('cache quota failure does not replace a successful network response', async () => {
  const cache = { match: async () => undefined, put: async () => { throw new Error('quota'); } };
  const result = await getOfflineAwareResponse({
    request: request('https://tid.test/styles.css'), cache,
    fetcher: async () => new Response('network result'), origin: 'https://tid.test',
    shellUrl: 'https://tid.test/index.html'
  });
  assert.equal(result.status, 200);
  assert.equal(await result.text(), 'network result');
});

test('non-GET requests are left to the browser', async () => {
  const result = await getOfflineAwareResponse({
    request: { method: 'POST', url: 'https://tid.test/', mode: 'cors' },
    cache: { match: async () => undefined, put: async () => {} },
    fetcher: async () => new Response('unused'), origin: 'https://tid.test',
    shellUrl: 'https://tid.test/index.html'
  });
  assert.equal(result, null);
});

test('offline asset miss returns a visible service-unavailable response', async () => {
  const result = await getOfflineAwareResponse({
    request: request('https://tid.test/assets/avatar/rain.glb'),
    cache: { match: async () => undefined, put: async () => {} },
    fetcher: async () => { throw new Error('offline'); },
    origin: 'https://tid.test', shellUrl: 'https://tid.test/index.html'
  });
  assert.equal(result.status, 503);
  assert.match(await result.text(), /Çevrimdışı/u);
});

test('only old app caches are deleted during activation', () => {
  assert.equal(shouldDeleteCache('tid-kopru-v1', 'tid-kopru-v3'), true);
  assert.equal(shouldDeleteCache('tid-kopru-v3', 'tid-kopru-v3'), false);
  assert.equal(shouldDeleteCache('unrelated-site-cache', 'tid-kopru-v2'), false);
  assert.equal(shouldDeleteCache('tid-camera-model-seq-v1', 'tid-kopru-v3'), false);
});

test('camera assets use only the installed version cache and never join the app shell cache', async () => {
  const manifest = { schemaVersion: 1, available: true, modelVersion: 'seq-v1', files: [
    { path: '/assets/tid/camera/model.onnx', sha256: 'a'.repeat(64), licenseId: 'TEST-ONLY', redistributionAllowed: true },
  ] };
  let opened;
  let fetched = 0;
  const result = await getCameraModelResponse({
    request: request('https://tid.test/assets/tid/camera/model.onnx'), origin: 'https://tid.test', manifest,
    cacheStorage: { open: async (name) => { opened = name; return { match: async () => undefined }; } },
    fetcher: async () => { fetched += 1; return new Response('model bytes'); },
  });
  assert.equal(opened, 'tid-camera-model-seq-v1');
  assert.equal(fetched, 1);
  assert.equal(await result.text(), 'model bytes');
});

test('camera files must be manifest-listed and same-origin', async () => {
  const manifest = { schemaVersion: 1, available: true, modelVersion: 'seq-v1', files: [
    { path: '/assets/tid/camera/model.onnx', sha256: 'a'.repeat(64), licenseId: 'TEST-ONLY', redistributionAllowed: true },
  ] };
  let fetched = 0;
  const cacheStorage = { open: async () => ({ match: async () => undefined }) };
  const unlisted = await getCameraModelResponse({
    request: request('https://tid.test/assets/tid/camera/participant.webm'), origin: 'https://tid.test', manifest,
    cacheStorage, fetcher: async () => { fetched += 1; return new Response('unexpected'); },
  });
  const external = await getCameraModelResponse({
    request: request('https://outside.example/assets/tid/camera/model.onnx'), origin: 'https://tid.test', manifest,
    cacheStorage, fetcher: async () => { fetched += 1; return new Response('unexpected'); },
  });
  assert.equal(unlisted.status, 404);
  assert.equal(external.status, 503);
  assert.equal(fetched, 0);
});

test('service-worker routes are scoped to the project-site directory', () => {
  assert.equal(getAppRelativePath('/tid-kopru/assets/tid/camera/model.onnx', '/tid-kopru/'), '/assets/tid/camera/model.onnx');
  assert.equal(getAppRelativePath('/assets/tid/camera/model.onnx', '/tid-kopru/'), null);
  assert.equal(getAppRelativePath('/tid-kopru-evil/assets/tid/camera/model.onnx', '/tid-kopru/'), null);
});

test('camera model manifest paths resolve inside a project-site directory', async () => {
  const baseUrl = 'https://tid.test/tid-kopru/';
  const manifest = { schemaVersion: 1, available: true, modelVersion: 'seq-v1', files: [
    { path: '/assets/tid/camera/model.onnx', sha256: 'a'.repeat(64), licenseId: 'TEST-ONLY', redistributionAllowed: true },
  ] };
  let fetched = 0;
  const response = await getCameraModelResponse({
    request: request('https://tid.test/tid-kopru/assets/tid/camera/model.onnx'),
    origin: 'https://tid.test', baseUrl, manifest,
    cacheStorage: { open: async () => ({ match: async () => undefined }) },
    fetcher: async () => { fetched += 1; return new Response('model bytes'); },
  });
  assert.equal(response.status, 200);
  assert.equal(fetched, 1);
});

test('reviewed media resolves in the project-site directory and rejects paths outside it', async () => {
  const baseUrl = 'https://tid.test/tid-kopru/';
  const bytes = new TextEncoder().encode('approved media');
  const { createHash } = await import('node:crypto');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const manifest = { schemaVersion: 1, contentVersion: 'release-9', mediaAssets: {
    clip: { path: '/assets/tid/clip.webm', licenseId: 'TEST-ONLY', redistributionAllowed: true, sha256 },
  } };
  const response = await getReviewedMediaResponse({
    request: request('https://tid.test/tid-kopru/assets/tid/clip.webm'),
    origin: 'https://tid.test', baseUrl, manifest,
    cacheStorage: { open: async () => ({ match: async () => undefined, put: async () => {} }) },
    fetcher: async () => new Response(bytes),
  });
  assert.equal(await response.text(), 'approved media');

  const outside = await getReviewedMediaResponse({
    request: request('https://tid.test/assets/tid/clip.webm'),
    origin: 'https://tid.test', baseUrl, manifest,
    cacheStorage: { open: async () => ({ match: async () => undefined }) },
    fetcher: async () => new Response('must not fetch'),
  });
  assert.equal(outside, null);
});

test('only licensed manifest-listed TID assets are cached after their bytes match the approved hash', async () => {
  const bytes = new TextEncoder().encode('approved media');
  const { createHash } = await import('node:crypto');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const manifest = {
    schemaVersion: 1,
    contentVersion: 'release-7',
    mediaAssets: {
      clip: { path: '/assets/tid/clip.webm', licenseId: 'TEST-ONLY', redistributionAllowed: true, sha256 },
      restricted: { path: '/assets/tid/restricted.webm', licenseId: 'NO-REDISTRIBUTION', redistributionAllowed: false, sha256 },
    },
  };
  let fetched = 0;
  let openedCache;
  const mediaCache = { match: async () => undefined, put: async () => {} };
  const response = await context.TidKopruCachePolicy.getReviewedMediaResponse({
    request: request('https://tid.test/assets/tid/clip.webm'), origin: 'https://tid.test', manifest,
    cacheStorage: { open: async (name) => { openedCache = name; return mediaCache; } },
    fetcher: async () => { fetched += 1; return new Response(bytes, { headers: { 'Content-Type': 'video/webm' } }); },
  });
  assert.equal(await response.text(), 'approved media');
  assert.equal(fetched, 1);
  assert.equal(openedCache, 'tid-kopru-tid-release-7');

  const denied = await context.TidKopruCachePolicy.getReviewedMediaResponse({
    request: request('https://tid.test/assets/tid/restricted.webm'), origin: 'https://tid.test', manifest,
    cacheStorage: { open: async () => mediaCache }, fetcher: async () => { throw new Error('must not fetch'); },
  });
  assert.equal(denied.status, 404);
  const rawParticipant = await context.TidKopruCachePolicy.getReviewedMediaResponse({
    request: request('https://tid.test/assets/tid/raw-camera/participant-1.webm'), origin: 'https://tid.test', manifest,
    cacheStorage: { open: async () => mediaCache }, fetcher: async () => { throw new Error('must not fetch'); },
  });
  assert.equal(rawParticipant.status, 404);
});

test('manifest-listed asset hash mismatch retries only within the configured bound and is never cached', async () => {
  const { createHash } = await import('node:crypto');
  const requestedBytes = new TextEncoder().encode('expected');
  const actualBytes = new TextEncoder().encode('tampered');
  const sha256 = createHash('sha256').update(requestedBytes).digest('hex');
  let fetched = 0;
  let cached = 0;
  const response = await context.TidKopruCachePolicy.getReviewedMediaResponse({
    request: request('https://tid.test/assets/tid/clip.mp4'), origin: 'https://tid.test',
    manifest: { schemaVersion: 1, contentVersion: 'release-8', mediaAssets: { clip: {
      path: '/assets/tid/clip.mp4', licenseId: 'TEST-ONLY', redistributionAllowed: true, sha256,
    } } },
    cacheStorage: { open: async () => ({ match: async () => undefined, put: async () => { cached += 1; } }) },
    fetcher: async () => { fetched += 1; return new Response(actualBytes); }, maxRetries: 2,
  });
  assert.equal(response.status, 502);
  assert.equal(fetched, 3);
  assert.equal(cached, 0);
});

const workerSource = await readFile(new URL('../public/service-worker.js', import.meta.url), 'utf8');

test('app shell excludes large avatar downloads and includes its runtime dependencies', () => {
  const match = workerSource.match(/const APP_SHELL_ASSETS = \[([\s\S]*?)\];/u);
  assert.ok(match, 'service worker should define APP_SHELL_ASSETS');
  const assets = [...match[1].matchAll(/'([^']+)'/gu)].map((entry) => entry[1]);

  assert.equal(assets.includes('./assets/avatar/rain.glb'), false);
  assert.equal(assets.includes('./assets/avatar/saved-poses.json'), true);
  assert.equal(assets.includes('./assets/tid/approved-media.webm'), false);
  assert.ok(assets.includes('./assets/tid/content-manifest.json'));
  assert.ok(assets.includes('./assets/tid/reviewed-content.json'));
  assert.ok(assets.includes('./assets/tid/gloss-to-turkish.json'));
  assert.ok(assets.includes('./assets/tid/sentence-model-manifest.json'));
  assert.ok(assets.includes('./assets/tid/morphology-rules.json'));
  for (const asset of [
    './', './index.html', './styles.css', './app.mjs', './avatar.mjs', './matcher.mjs',
    './tid-output-ui.mjs', './tid-display-plan.mjs', './letter-cards.mjs', './procedural-rig.mjs',
    './privacy-mode.mjs', './app-state.mjs', './landmark-runtime.mjs', './landmark-worker.js',
    './landmark-normalization.mjs', './mediapipe-fileset.mjs', './personal-sign-store.mjs', './personal-training.mjs',
    './personal-sign-recognizer.mjs', './hybrid-recognition.mjs', './cloud-session.mjs', './nvidia-candidate.mjs',
    './tid-to-turkish.mjs', './sign-recognition.mjs', './sign-recognition-worker.js', './onnx-runtime-loader.mjs',
    './sw-policy.js', './manifest.webmanifest', './icons/icon.svg', './icons/maskable.svg',
    './assets/runtime/runtime-manifest.json', './assets/avatar/saved-poses.json',
    './vendor/three/three.module.js', './vendor/three/addons/controls/OrbitControls.js'
  ]) {
    assert.ok(assets.includes(asset), `missing app-shell asset: ${asset}`);
  }
});

test('app shell contains only the current release cache prefix policy', () => {
  assert.match(workerSource, /const CACHE_NAME = 'tid-kopru-v6'/u);
  assert.match(workerSource, /shouldDeleteCache\(name, CACHE_NAME\)/u);
  assert.match(workerSource, /getReviewedMediaResponse/u);
  assert.match(workerSource, /getCameraModelResponse/u);
});

test('service worker never caches private camera, landmark, key, or provider requests', () => {
  assert.match(workerSource, /isPrivateRequest/u);
  for (const marker of ['camera-blob', 'landmarks', 'api-key', 'provider-response']) {
    assert.equal(isPrivateRequest({ method: 'GET', url: `https://tid.test/${marker}`, headers: { get: () => null } }), true);
  }
  assert.equal(isPrivateRequest({ method: 'POST', url: 'https://tid.test/api', headers: { get: () => null } }), true);
});

const appHtml = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../public/app.mjs', import.meta.url), 'utf8');

test('service-worker registration reports secure-install and offline-first-use requirements', () => {
  assert.match(appHtml, /id="pwa-status"[^>]*role="status"/u);
  assert.match(appSource, /navigator\.serviceWorker\.register\('\.\/service-worker\.js'\)\s*\.then\(/u);
  assert.match(appSource, /navigator\.serviceWorker\.register\('\.\/service-worker\.js'\)[\s\S]*?\.catch\(/u);
  assert.match(appSource, /onaylı TİD medya dosyaları varsa ilk oynatımda indirilir/u);
});

