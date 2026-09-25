const REQUIRED_PATHS = [
  'vendor/mediapipe/vision_bundle.mjs',
  'assets/runtime/models/hand_landmarker.task',
  'assets/runtime/models/pose_landmarker_lite.task',
  'assets/runtime/models/face_landmarker.task',
];
const MIN_FRAME_INTERVAL_MS = 1000 / 15;

function codedError(code) { const error = new Error(code); error.code = code; return error; }

function resolveVerifiedPaths(manifest, baseUrl) {
  if (manifest?.schemaVersion !== 1 || !Array.isArray(manifest.files)) throw codedError('invalid_runtime_manifest');
  const verified = new Set(manifest.files.map((file) => file?.path));
  if (!REQUIRED_PATHS.every((path) => verified.has(path))) throw codedError('runtime_assets_missing');
  const base = new URL(baseUrl);
  return Object.fromEntries(REQUIRED_PATHS.map((path) => {
    const url = new URL(path, base);
    if (url.origin !== base.origin) throw codedError('unsafe_runtime_path');
    return [path, url.href];
  }));
}

export function createLandmarkRuntime({
  manifest,
  baseUrl = globalThis.location?.href,
  workerFactory = (url) => new Worker(url, { type: 'module' }),
  requestAnimationFrame = globalThis.requestAnimationFrame,
  cancelAnimationFrame = globalThis.cancelAnimationFrame,
  createImageBitmap = globalThis.createImageBitmap,
} = {}) {
  let worker = null;
  let initialized = false;
  let disposed = false;
  let requestId = 0;
  let lastTimestamp = -Infinity;
  let frameHandle = null;
  let activeCapture = false;
  const pending = new Map();

  const onMessage = ({ data } = {}) => {
    if (data?.type === 'ready') pending.get('initialize')?.resolve(true);
    if (data?.type === 'error') {
      const target = data.requestId ? pending.get(data.requestId) : pending.get('initialize');
      target?.reject(codedError(data.code ?? 'landmark_worker_failed'));
    }
    if (data?.type === 'frame') pending.get(data.requestId)?.resolve(data.frame);
    if (data?.requestId) pending.delete(data.requestId);
    if (data?.type === 'ready') pending.delete('initialize');
  };

  const initialize = async () => {
    if (disposed) throw codedError('runtime_disposed');
    if (initialized) return true;
    const urls = resolveVerifiedPaths(manifest, baseUrl);
    worker = workerFactory(new URL('./landmark-worker.js', import.meta.url));
    worker.addEventListener?.('message', onMessage);
    if (!worker.addEventListener) worker.onmessage = onMessage;
    const ready = new Promise((resolve, reject) => pending.set('initialize', { resolve, reject }));
    worker.postMessage({ type: 'initialize', urls });
    await ready;
    initialized = true;
    return true;
  };

  const processFrame = async (image, timestampMs) => {
    if (!initialized || disposed) throw codedError(disposed ? 'runtime_disposed' : 'runtime_not_initialized');
    if (!Number.isFinite(timestampMs) || timestampMs <= lastTimestamp) throw codedError('timestamp_not_increasing');
    if (timestampMs - lastTimestamp < MIN_FRAME_INTERVAL_MS) return null;
    lastTimestamp = timestampMs;
    const id = ++requestId;
    const result = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    const message = { type: 'process-frame', requestId: id, image, timestampMs };
    try { worker.postMessage(message, image ? [image] : []); } catch { worker.postMessage(message); }
    return result;
  };

  const startCapture = async (video, onFrame = () => {}) => {
    await initialize();
    if (activeCapture) throw codedError('capture_already_active');
    activeCapture = true;
    lastTimestamp = -Infinity;
    const tick = async (timestampMs) => {
      if (!activeCapture || disposed) return;
      try {
        if (video?.readyState >= 2) {
          const bitmap = await createImageBitmap(video);
          const frame = await processFrame(bitmap, timestampMs);
          if (frame) onFrame(frame);
        }
      } catch (error) { onFrame(null, error); }
      if (activeCapture) frameHandle = requestAnimationFrame(tick);
    };
    frameHandle = requestAnimationFrame(tick);
  };

  const stopCapture = () => {
    activeCapture = false;
    if (frameHandle !== null) cancelAnimationFrame?.(frameHandle);
    frameHandle = null;
  };

  const captureSample = async ({ video, durationMs = 1800 } = {}) => {
    const frames = [];
    await startCapture(video, (frame) => { if (frame) frames.push(frame); });
    await new Promise((resolve) => setTimeout(resolve, Math.max(250, durationMs)));
    stopCapture();
    if (!frames.length) throw codedError('empty_landmark_sample');
    return frames;
  };

  const dispose = async () => {
    if (disposed) return;
    stopCapture();
    disposed = true;
    for (const waiter of pending.values()) waiter.reject?.(codedError('runtime_disposed'));
    pending.clear();
    if (worker) {
      try { worker.postMessage({ type: 'dispose' }); } catch { /* worker already closed */ }
      worker.removeEventListener?.('message', onMessage);
      worker.terminate?.();
    }
    worker = null;
    initialized = false;
  };

  return { initialize, processFrame, startCapture, stopCapture, captureSample, dispose };
}
