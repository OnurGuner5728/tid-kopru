((scope) => {
  async function getOfflineAwareResponse({ request, cache, fetcher, origin, shellUrl }) {
    if (request.method !== 'GET') return null;

    const cached = await cache.match(request.url);
    if (cached) return cached;

    let response;
    try {
      response = await fetcher(request);
    } catch {
      if (request.mode === 'navigate') {
        const shell = await cache.match(shellUrl);
        if (shell) return shell;
      }
      return new Response('Çevrimdışı. Bu içerik henüz indirilmedi.', { status: 503 });
    }

    if (response.ok && new URL(request.url).origin === origin) {
      try {
        await cache.put(request.url, response.clone());
      } catch {
        // Keep the successful network response available when storage is full.
      }
    }

    return response;
  }

  function shouldDeleteCache(name, currentName) {
    return (/^tid-kopru-v\d+$/.test(name) || /^tid-kopru-v\d+-tid-[A-Za-z0-9._-]+$/.test(name))
      && !name.startsWith(currentName);
  }

  async function digestHex(bytes) {
    if (!globalThis.crypto?.subtle) return null;
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  function isSafeManifestAsset(asset, origin) {
    if (!asset || typeof asset !== 'object' || Array.isArray(asset)) return false;
    if (typeof asset.path !== 'string' || !/^\/assets\/tid\/[A-Za-z0-9._/-]+$/.test(asset.path)) return false;
    if (asset.path.split('/').some((part, index) => index > 0 && ['', '.', '..'].includes(part))) return false;
    try {
      if (new URL(asset.path, origin).origin !== origin) return false;
    } catch {
      return false;
    }
    return typeof asset.licenseId === 'string' && asset.licenseId.trim().length > 0
      && asset.redistributionAllowed === true
      && typeof asset.sha256 === 'string' && /^[0-9a-f]{64}$/.test(asset.sha256);
  }

  async function getReviewedMediaResponse({ request, origin, manifest, cacheStorage, fetcher, maxRetries = 2 }) {
    if (request.method !== 'GET') return null;
    const requestUrl = new URL(request.url);
    if (requestUrl.origin !== origin || !requestUrl.pathname.startsWith('/assets/tid/')) return null;
    const assets = manifest?.mediaAssets;
    if (!manifest || manifest.schemaVersion !== 1 || typeof manifest.contentVersion !== 'string'
      || !/^[A-Za-z0-9._-]+$/.test(manifest.contentVersion)
      || !assets || typeof assets !== 'object' || Array.isArray(assets)) {
      return new Response('TİD içerik listesi geçersiz.', { status: 503 });
    }
    const asset = Object.values(assets).find((candidate) => candidate?.path === requestUrl.pathname);
    if (!isSafeManifestAsset(asset, origin)) return new Response('Onaylı içerik listesinde bulunamadı.', { status: 404 });

    const cache = await cacheStorage.open(`tid-kopru-tid-${manifest.contentVersion}`);
    const cached = await cache.match(request.url);
    if (cached) return cached;
    const retries = Number.isInteger(maxRetries) ? Math.max(0, Math.min(3, maxRetries)) : 2;
    let lastFailure = 'fetch';
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      let response;
      try {
        response = await fetcher(request);
      } catch {
        lastFailure = 'fetch';
        continue;
      }
      if (!response?.ok) {
        lastFailure = 'fetch';
        continue;
      }
      let bytes;
      try {
        bytes = await response.arrayBuffer();
      } catch {
        lastFailure = 'fetch';
        continue;
      }
      if (await digestHex(bytes) !== asset.sha256) {
        lastFailure = 'hash';
        continue;
      }
      const verified = new Response(bytes, { status: response.status, statusText: response.statusText, headers: response.headers });
      try {
        await cache.put(request.url, verified.clone());
      } catch (error) {
        verified.headers.set('X-TID-Cache-Error', error?.name === 'QuotaExceededError' ? 'quota' : 'storage');
      }
      return verified;
    }
    return new Response(lastFailure === 'hash' ? 'TİD medya dosyası doğrulanamadı.' : 'TİD medya dosyası indirilemedi.', {
      status: lastFailure === 'hash' ? 502 : 503,
    });
  }

  scope.TidKopruCachePolicy = { getOfflineAwareResponse, getReviewedMediaResponse, shouldDeleteCache };
})(globalThis);
