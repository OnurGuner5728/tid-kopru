import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const request = (url, mode = 'cors') => ({ method: 'GET', url, mode });
const source = await readFile(new URL('../public/sw-policy.js', import.meta.url), 'utf8');
const context = { URL, Response };
context.globalThis = context;
vm.runInNewContext(source, context);
const { getOfflineAwareResponse, shouldDeleteCache } = context.TidKopruCachePolicy;

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
  assert.equal(shouldDeleteCache('tid-kopru-v1', 'tid-kopru-v2'), true);
  assert.equal(shouldDeleteCache('tid-kopru-v2', 'tid-kopru-v2'), false);
  assert.equal(shouldDeleteCache('unrelated-site-cache', 'tid-kopru-v2'), false);
});

const workerSource = await readFile(new URL('../public/service-worker.js', import.meta.url), 'utf8');

test('app shell excludes large avatar downloads and includes its runtime dependencies', () => {
  const match = workerSource.match(/const APP_SHELL_ASSETS = \[([\s\S]*?)\];/u);
  assert.ok(match, 'service worker should define APP_SHELL_ASSETS');
  const assets = [...match[1].matchAll(/'([^']+)'/gu)].map((entry) => entry[1]);

  assert.equal(assets.includes('./assets/avatar/rain.glb'), false);
  assert.equal(assets.includes('./assets/avatar/saved-poses.json'), false);
  for (const asset of [
    './', './index.html', './styles.css', './app.mjs', './avatar.mjs', './matcher.mjs',
    './sw-policy.js', './manifest.webmanifest', './icons/icon.svg', './icons/maskable.svg',
    './vendor/three/three.module.js', './vendor/three/addons/loaders/GLTFLoader.js',
    './vendor/three/addons/controls/OrbitControls.js'
  ]) {
    assert.ok(assets.includes(asset), `missing app-shell asset: ${asset}`);
  }
});

test('app shell contains only the current release cache prefix policy', () => {
  assert.match(workerSource, /const CACHE_NAME = 'tid-kopru-v2'/u);
  assert.match(workerSource, /shouldDeleteCache\(name, CACHE_NAME\)/u);
});

const appHtml = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../public/app.mjs', import.meta.url), 'utf8');

test('service-worker registration reports secure-install and offline-first-use requirements', () => {
  assert.match(appHtml, /id="pwa-status"[^>]*role="status"/u);
  assert.match(appSource, /navigator\.serviceWorker\.register\('\.\/service-worker\.js'\)\s*\.then\(/u);
  assert.match(appSource, /navigator\.serviceWorker\.register\('\.\/service-worker\.js'\)[\s\S]*?\.catch\(/u);
  assert.match(appSource, /ilk çevrimdışı kullanım için avatarı bir kez/u);
});

