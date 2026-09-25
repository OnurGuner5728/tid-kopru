const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const SAFE_ASSET_PATH = /^\/(?:assets\/tid\/camera|vendor\/onnxruntime-web)\/[A-Za-z0-9._/-]+$/u;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function validateAssetPath(path, origin) {
  if (typeof path !== 'string' || !SAFE_ASSET_PATH.test(path)
      || path.split('/').some((part, index) => index > 0 && ['', '.', '..'].includes(part))) {
    fail('unsafe_asset_path');
  }
  let url;
  try {
    url = new URL(path, origin);
  } catch {
    fail('unsafe_asset_path');
  }
  if (url.origin !== origin || url.pathname !== path || url.search || url.hash) fail('unsafe_asset_path');
  return url;
}

function hex(bytes) {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256(bytes, cryptoProvider) {
  if (!cryptoProvider?.subtle) fail('crypto_unavailable');
  return hex(await cryptoProvider.subtle.digest('SHA-256', bytes));
}

export async function verifySameOriginHashes(files, {
  origin = globalThis.location?.origin,
  fetcher = globalThis.fetch?.bind(globalThis),
  cryptoProvider = globalThis.crypto,
  onProgress = () => {},
} = {}) {
  if (!Array.isArray(files) || files.length === 0 || typeof fetcher !== 'function') fail('invalid_asset_manifest');
  let pageOrigin;
  try {
    pageOrigin = new URL(origin).origin;
  } catch {
    fail('unsafe_asset_path');
  }
  const seen = new Set();
  const verified = new Map();
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    if (!file || typeof file !== 'object' || Array.isArray(file) || typeof file.path !== 'string') fail('invalid_asset_manifest');
    const url = validateAssetPath(file.path, pageOrigin);
    if (!SHA256_PATTERN.test(file.sha256 ?? '') || typeof file.licenseId !== 'string'
        || !file.licenseId.trim() || file.redistributionAllowed !== true || seen.has(file.path)) fail('invalid_asset_manifest');
    seen.add(file.path);
    let response;
    try {
      response = await fetcher(url.href, { credentials: 'same-origin', cache: 'no-store' });
    } catch {
      fail('asset_unavailable');
    }
    if (!response?.ok) fail('asset_unavailable');
    let bytes;
    try {
      bytes = new Uint8Array(await response.arrayBuffer());
    } catch {
      fail('asset_unavailable');
    }
    if (await sha256(bytes, cryptoProvider) !== file.sha256) fail('hash_mismatch');
    verified.set(file.path, bytes);
    onProgress({ path: file.path, completed: index + 1, total: files.length, percent: Math.round(((index + 1) / files.length) * 100) });
  }
  return verified;
}

export async function createOnnxSession(manifest, runtime, options = {}) {
  if (!manifest || manifest.available !== true || !Array.isArray(manifest.files)) fail('model_unavailable');
  if (!runtime?.InferenceSession?.create) fail('onnx_runtime_unavailable');
  const modelPath = manifest.modelPath;
  if (!manifest.files.some((file) => file.path === modelPath)) fail('model_file_missing');
  const verified = await verifySameOriginHashes(manifest.files, options);
  const modelBytes = verified.get(modelPath);
  if (!modelBytes) fail('model_file_missing');
  return runtime.InferenceSession.create(modelBytes, { executionProviders: ['wasm'] });
}

export async function downloadCameraModel(manifest, {
  origin = globalThis.location?.origin,
  fetcher = globalThis.fetch?.bind(globalThis),
  cryptoProvider = globalThis.crypto,
  cacheStorage = globalThis.caches,
  onProgress = () => {},
} = {}) {
  if (!manifest || manifest.available !== true || !/^[A-Za-z0-9._-]{1,80}$/u.test(manifest.modelVersion ?? '')) fail('model_unavailable');
  if (!cacheStorage?.open || !cacheStorage?.keys || !cacheStorage?.delete) fail('cache_unavailable');
  const verified = await verifySameOriginHashes(manifest.files, { origin, fetcher, cryptoProvider, onProgress });
  const finalName = `tid-camera-model-${manifest.modelVersion}`;
  const stagingName = `${finalName}-staging`;
  const urls = [...verified].map(([path, bytes]) => [new URL(path, origin).href, bytes]);
  let finalExisted = false;
  try {
    const names = await cacheStorage.keys();
    finalExisted = names.includes(finalName);
    const staging = await cacheStorage.open(stagingName);
    for (const [url, bytes] of urls) {
      await staging.put(url, new Response(bytes, { headers: { 'Content-Type': 'application/octet-stream' } }));
    }
    const destination = await cacheStorage.open(finalName);
    for (const [url] of urls) {
      const response = await staging.match(url);
      if (!response) fail('cache_install_failed');
      await destination.put(url, response);
    }
    for (const name of await cacheStorage.keys()) {
      if (name.startsWith('tid-camera-model-') && name !== finalName && name !== stagingName) {
        await cacheStorage.delete(name);
      }
    }
    return { modelVersion: manifest.modelVersion, cacheName: finalName, fileCount: verified.size };
  } catch (error) {
    if (!finalExisted) {
      try { await cacheStorage.delete(finalName); } catch { /* keep the previous model version intact */ }
    }
    throw error;
  } finally {
    try { await cacheStorage.delete(stagingName); } catch { /* staging data is never treated as installed */ }
  }
}
