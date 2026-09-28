importScripts('./sw-policy.js');

const CACHE_NAME = 'tid-kopru-v6';
const APP_BASE_URL = new URL('./', self.location.href);
const APP_SHELL_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.mjs',
  './avatar.mjs',
  './procedural-rig.mjs',
  './letter-cards.mjs',
  './tid-display-plan.mjs',
  './privacy-mode.mjs',
  './app-state.mjs',
  './landmark-runtime.mjs',
  './landmark-worker.js',
  './landmark-normalization.mjs',
  './mediapipe-fileset.mjs',
  './personal-sign-store.mjs',
  './personal-training.mjs',
  './personal-sign-recognizer.mjs',
  './hybrid-recognition.mjs',
  './cloud-session.mjs',
  './nvidia-candidate.mjs',
  './matcher.mjs',
  './tid-media-player.mjs',
  './tid-output-ui.mjs',
  './tid-transfer.mjs',
  './tid-to-turkish.mjs',
  './sign-recognition.mjs',
  './sign-recognition-worker.js',
  './onnx-runtime-loader.mjs',
  './turkish-morphology.mjs',
  './sw-policy.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/maskable.svg',
  './assets/tid/content-manifest.json',
  './assets/tid/reviewed-content.json',
  './assets/tid/gloss-to-turkish.json',
  './assets/tid/sentence-model-manifest.json',
  './assets/tid/morphology-rules.json',
  './assets/runtime/runtime-manifest.json',
  './assets/avatar/saved-poses.json',
  './vendor/three/three.module.js',
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
  if (self.TidKopruCachePolicy.isPrivateRequest(event.request)) return;
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;
  const appRelativePath = self.TidKopruCachePolicy.getAppRelativePath(requestUrl.pathname, APP_BASE_URL.pathname);
  if (!appRelativePath) return;

  if (appRelativePath.startsWith('/vendor/onnxruntime-web/') || appRelativePath.startsWith('/assets/tid/camera/')) {
    event.respondWith((async () => {
      const shellCache = await caches.open(CACHE_NAME);
      const manifestUrl = new URL('./assets/tid/sentence-model-manifest.json', self.location.href).href;
      let response = await shellCache.match(manifestUrl);
      if (!response) response = await fetch(manifestUrl);
      let manifest;
      try { manifest = await response.json(); } catch { return new Response('Model listesi okunamadı.', { status: 503 }); }
      return self.TidKopruCachePolicy.getCameraModelResponse({
        request: event.request,
        origin: self.location.origin,
        baseUrl: APP_BASE_URL.href,
        manifest,
        cacheStorage: caches,
        fetcher: fetch,
      });
    })());
    return;
  }

  if (appRelativePath.startsWith('/assets/tid/')
    && !['/assets/tid/content-manifest.json', '/assets/tid/reviewed-content.json', '/assets/tid/gloss-to-turkish.json', '/assets/tid/sentence-model-manifest.json', '/assets/tid/morphology-rules.json'].includes(appRelativePath)) {
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
        baseUrl: APP_BASE_URL.href,
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
