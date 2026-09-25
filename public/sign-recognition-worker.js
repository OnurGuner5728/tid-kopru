let pipeline = null;
let manifest = null;
let frameQueue = Promise.resolve();

const SHA256 = /^[0-9a-f]{64}$/u;
const SAFE_PATH = /^\/(?:assets\/tid\/camera|vendor\/onnxruntime-web)\/[A-Za-z0-9._/-]+$/u;
const PUBLIC_BASE_URL = new URL('./', self.location.href);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

async function loadVerifiedAssets(value) {
  if (!Array.isArray(value.files) || value.files.length === 0) fail('invalid_asset_manifest');
  const files = new Map();
  for (const asset of value.files) {
    if (!asset || typeof asset.path !== 'string' || !SAFE_PATH.test(asset.path)
        || asset.path.split('/').some((part, index) => index > 0 && ['', '.', '..'].includes(part))
        || !SHA256.test(asset.sha256 ?? '') || typeof asset.licenseId !== 'string'
        || !asset.licenseId.trim() || asset.redistributionAllowed !== true) fail('invalid_asset_manifest');
    const url = new URL(asset.path.slice(1), PUBLIC_BASE_URL);
    if (url.origin !== self.location.origin
        || url.pathname !== `${PUBLIC_BASE_URL.pathname}${asset.path.slice(1)}`) fail('unsafe_asset_path');
    const response = await fetch(url.href, { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) fail('asset_unavailable');
    const bytes = await response.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const actual = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    if (actual !== asset.sha256) fail('hash_mismatch');
    files.set(asset.path, bytes);
  }
  return files;
}

async function initialize(value) {
  if (!value || value.available !== true || typeof value.runtimeModule !== 'string'
      || typeof value.preprocessingFingerprint !== 'string' || !value.preprocessingFingerprint.trim()) fail('model_unavailable');
  const files = await loadVerifiedAssets(value);
  if (!files.has(value.modelPath) || !files.has(value.runtimeModule)) fail('model_file_missing');
  const moduleUrl = new URL(value.runtimeModule.slice(1), PUBLIC_BASE_URL);
  const adapter = await import(moduleUrl.href);
  if (typeof adapter.createPipeline !== 'function') fail('inference_pipeline_unavailable');
  pipeline = await adapter.createPipeline({ manifest: value, verifiedFiles: files });
  if (!pipeline || typeof pipeline.processFrame !== 'function' || typeof pipeline.finish !== 'function'
      || (typeof pipeline.clearCapture !== 'function' && typeof pipeline.resetCapture !== 'function')) fail('invalid_inference_pipeline');
  manifest = value;
  self.postMessage({ type: 'READY' });
}

async function clearPipeline() {
  try { await pipeline?.dispose?.(); } catch { /* release remaining worker state */ }
  pipeline = null;
  manifest = null;
  frameQueue = Promise.resolve();
}

async function clearUtterance() {
  try {
    if (typeof pipeline?.clearCapture === 'function') await pipeline.clearCapture();
    else if (typeof pipeline?.resetCapture === 'function') await pipeline.resetCapture();
  } catch { /* drop utterance state even if the adapter cannot reset cleanly */ }
  frameQueue = Promise.resolve();
}

self.addEventListener('message', (event) => {
  const message = event.data;
  if (!message || typeof message !== 'object') return;
  if (message.type === 'INIT') {
    void initialize(message.manifest).catch((error) => {
      void clearPipeline();
      self.postMessage({ type: 'ERROR', code: error?.code || 'worker_init_failed' });
    });
    return;
  }
  if (message.type === 'FRAME') {
    if (!pipeline || !(message.imageBitmap instanceof ImageBitmap) || !Number.isFinite(message.timestampMs)) {
      message.imageBitmap?.close?.();
      return;
    }
    const bitmap = message.imageBitmap;
    frameQueue = frameQueue.then(async () => {
      try {
        await pipeline?.processFrame(bitmap, message.timestampMs);
      } finally {
        bitmap.close();
        self.postMessage({ type: 'FRAME_ACK' });
      }
    }).catch((error) => {
      void clearPipeline();
      self.postMessage({ type: 'ERROR', code: error?.code || 'frame_processing_failed' });
    });
    return;
  }
  if (message.type === 'FINISH') {
    void frameQueue.then(async () => {
      if (!pipeline || !manifest) {
        self.postMessage({ type: 'REJECTED', reason: 'model_unavailable' });
        return;
      }
      const result = await pipeline.finish();
      if (result?.status === 'candidate') {
        self.postMessage({ type: 'CANDIDATE', glossEvents: result.glossEvents, confidence: result.confidence });
      } else {
        self.postMessage({ type: 'REJECTED', reason: typeof result?.reason === 'string' ? result.reason : 'unsupported_utterance' });
      }
      await clearUtterance();
    }).catch((error) => {
      void clearPipeline();
      self.postMessage({ type: 'ERROR', code: error?.code || 'inference_failed' });
    });
    return;
  }
  if (message.type === 'ABORT') void frameQueue.then(() => clearUtterance());
  if (message.type === 'DISPOSE') void clearPipeline();
});
