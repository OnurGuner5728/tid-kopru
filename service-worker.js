importScripts('./sw-policy.js');

const CACHE_NAME = 'tid-kopru-v2';
const APP_SHELL_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.mjs',
  './avatar.mjs',
  './matcher.mjs',
  './sw-policy.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/maskable.svg',
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
