const CACHE_NAME = 'tid-speech-probe-v2';
const SHELL = [
  './',
  './index.html',
  './main.mjs',
  './service-worker.js',
  './vendor/vosk.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names
        .filter((name) => name.startsWith('tid-speech-probe-v') && name !== CACHE_NAME)
        .map((name) => caches.delete(name))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(event.request);
    if (cached) return cached;

    try {
      const response = await fetch(event.request);
      if (response.ok) await cache.put(event.request, response.clone());
      return response;
    } catch {
      if (event.request.mode === 'navigate') {
        return (await cache.match('./index.html')) ?? new Response('Deneme sayfası çevrimdışı değil.', { status: 503 });
      }
      return new Response('Bu dosya çevrimdışıyken önbellekte değil.', { status: 503 });
    }
  })());
});
