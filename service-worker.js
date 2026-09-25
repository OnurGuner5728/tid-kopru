const CACHE_NAME = 'tid-kopru-v1';
const APP_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.mjs',
  './avatar.mjs',
  './matcher.mjs',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/maskable.svg',
  './assets/avatar/rain.glb',
  './assets/avatar/saved-poses.json',
  './vendor/three/three.module.js',
  './vendor/three/addons/loaders/GLTFLoader.js',
  './vendor/three/addons/controls/OrbitControls.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
      if (response.ok && new URL(event.request.url).origin === self.location.origin) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
      }
      return response;
    }))
  );
});
