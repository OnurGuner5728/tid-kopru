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
    return /^tid-kopru-v\d+$/.test(name) && name !== currentName;
  }

  scope.TidKopruCachePolicy = { getOfflineAwareResponse, shouldDeleteCache };
})(globalThis);
