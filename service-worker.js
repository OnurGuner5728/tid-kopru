importScripts('./sw-policy.js');

const CACHE_NAME = 'tid-kopru-v3';
const APP_SHELL_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.mjs',
  './avatar.mjs',
  './matcher.mjs',
  './tid-media-player.mjs',
  './tid-output-ui.mjs',
  './tid-transfer.mjs',
  './turkish-morphology.mjs',
  './sw-policy.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/maskable.svg',
  './assets/tid/content-manifest.json',
  './assets/tid/reviewed-content.json',
  './assets/tid/morphology-rules.json',
  './vendor/three/three.module.js',
  './vendor/three/addons/loaders/GLTFLoader.js',
  './vendor/three/addons/utils/BufferGeometryUtils.js',
  './vendor/three/addons/controls/OrbitControls.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names
          .filter((name) => self.TidKopruCachePolicy.shouldDeleteCache(name, CACHE_NAME))
          .map((name) => caches.delete(name))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;

  if (requestUrl.pathname.startsWith('/assets/tid/')
    && !['/assets/tid/content-manifest.json', '/assets/tid/reviewed-content.json', '/assets/tid/morphology-rules.json'].includes(requestUrl.pathname)) {
    event.respondWith((async () => {
      const shellCache = await caches.open(CACHE_NAME);
      const manifestUrl = new URL('./assets/tid/content-manifest.json', self.location.href).href;
      let manifestResponse = await shellCache.match(manifestUrl);
      if (!manifestResponse) {
        try {
          manifestResponse = await fetch(manifestUrl);
          if (manifestResponse.ok) await shellCache.put(manifestUrl, manifestResponse.clone());
        } catch {
          return new Response('Çevrimdışı. TİD içerik listesi henüz indirilmedi.', { status: 503 });
        }
      }
      let manifest;
      try {
        manifest = await manifestResponse.json();
      } catch {
        return new Response('TİD içerik listesi okunamadı.', { status: 503 });
      }
      return self.TidKopruCachePolicy.getReviewedMediaResponse({
        request: event.request,
        origin: self.location.origin,
        manifest,
        cacheStorage: caches,
        fetcher: fetch,
      });
    })());
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then((cache) => self.TidKopruCachePolicy.getOfflineAwareResponse({
      request: event.request,
      cache,
      fetcher: fetch,
      origin: self.location.origin,
      shellUrl: new URL('./index.html', self.location.href).href
    }))
  );
});
