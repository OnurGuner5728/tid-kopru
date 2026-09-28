const MIN_CONFIDENCE = 0;
const WORKER_READY_TIMEOUT_MS = 15000;
const UTTERANCE_TIMEOUT_MS = 20000;
const MAX_PENDING_FRAMES = 2;

function codedError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function validGlossEvents(events, vocabulary) {
  if (!Array.isArray(events) || events.length === 0) return false;
  const known = new Set(vocabulary);
  let previousStart = -Infinity;
  let clock = null;
  return events.every((event) => {
    if (!event || typeof event !== 'object' || Array.isArray(event)
        || typeof event.glossId !== 'string' || !known.has(event.glossId)
        || typeof event.confidence !== 'number' || !Number.isFinite(event.confidence)
        || event.confidence < MIN_CONFIDENCE || event.confidence > 1) return false;
    const frameClock = Number.isFinite(event.startFrame) && Number.isFinite(event.endFrame)
      && event.startFrame >= 0 && event.endFrame >= 0;
    const msClock = Number.isFinite(event.startMs) && Number.isFinite(event.endMs)
      && event.startMs >= 0 && event.endMs >= 0;
    if (frameClock === msClock) return false;
    const currentClock = frameClock ? 'frame' : 'ms';
    const start = frameClock ? event.startFrame : event.startMs;
    const end = frameClock ? event.endFrame : event.endMs;
    if (end <= start || start < previousStart || (clock && clock !== currentClock)) return false;
    previousStart = start;
    clock = currentClock;
    return true;
  });
}

export class SignRecognitionClient {
  constructor(environment = {}) {
    this.environment = environment;
    this.workerFactory = environment.workerFactory ?? ((url) => new Worker(url, { type: 'module' }));
    this.worker = null;
    this.manifest = null;
    this.loaded = false;
    this.disposed = false;
    this.stream = null;
    this.ownsStream = false;
    this.captureGeneration = 0;
    this.animationFrame = null;
    this.lastFrameAt = -Infinity;
    this.framesInFlight = 0;
    this.callbacks = null;
    this.pendingResult = null;
    this.finishing = false;
    this._onMessage = (event) => this.handleWorkerMessage(event?.data);
    this._onError = () => this.handleWorkerError(codedError('worker_failed'));
    this._onPageHide = () => { void this.dispose(); };
    this.pageTarget = environment.pageTarget ?? globalThis;
    this.pageTarget.addEventListener?.('pagehide', this._onPageHide);
  }

  async load({ manifest, onProgress = () => {} } = {}) {
    if (this.disposed) throw codedError('client_disposed');
    if (!manifest || manifest.available !== true) throw codedError('model_unavailable');
    if (!Array.isArray(manifest.vocabulary) || manifest.vocabulary.length === 0
        || new Set(manifest.vocabulary).size !== manifest.vocabulary.length
        || typeof manifest.modelVersion !== 'string' || typeof manifest.contentVersion !== 'string'
        || typeof manifest.preprocessingFingerprint !== 'string' || !manifest.preprocessingFingerprint.trim()
        || typeof manifest.modelPath !== 'string' || typeof manifest.runtimeModule !== 'string'
        || !Number.isInteger(manifest.blankId) || manifest.blankId < 0
        || typeof manifest.confidenceThreshold !== 'number'
        || !Number.isFinite(manifest.confidenceThreshold) || manifest.confidenceThreshold < 0 || manifest.confidenceThreshold > 1
        || !Array.isArray(manifest.files)
        || !manifest.files.some((file) => file?.path === manifest.modelPath)
        || !manifest.files.some((file) => file?.path === manifest.runtimeModule)) {
      throw codedError('invalid_model_manifest');
    }
    const verify = this.environment.verifyAssets;
    if (typeof verify === 'function') await verify(manifest.files, { onProgress });
    else {
      const { verifySameOriginHashes } = await import('./onnx-runtime-loader.mjs');
      await verifySameOriginHashes(manifest.files, {
        origin: this.environment.origin ?? globalThis.location?.origin,
        fetcher: this.environment.fetcher,
        cryptoProvider: this.environment.cryptoProvider,
        onProgress,
      });
    }
    if (!this.worker) {
      const workerUrl = new URL('./sign-recognition-worker.js', import.meta.url);
      this.worker = this.workerFactory(workerUrl);
      this.worker.addEventListener?.('message', this._onMessage);
      this.worker.addEventListener?.('error', this._onError);
      if (!this.worker.addEventListener) {
        this.worker.onmessage = this._onMessage;
        this.worker.onerror = this._onError;
      }
    }
    this.manifest = manifest;
    await new Promise((resolve, reject) => {
      const timer = (this.environment.setTimeout ?? setTimeout)(() => {
        cleanup();
        reject(codedError('worker_init_timeout'));
      }, WORKER_READY_TIMEOUT_MS);
      const onReady = (event) => {
        if (event?.data?.type === 'READY') {
          cleanup();
          resolve();
        } else if (event?.data?.type === 'ERROR') {
          cleanup();
          reject(codedError(event.data.code || 'worker_init_failed'));
        }
      };
      const cleanup = () => {
        (this.environment.clearTimeout ?? clearTimeout)(timer);
        this.worker.removeEventListener?.('message', onReady);
      };
      this.worker.addEventListener?.('message', onReady);
      this.worker.postMessage({ type: 'INIT', manifest });
      if (!this.worker.addEventListener) {
        const previous = this.worker.onmessage;
        this.worker.onmessage = (event) => { previous?.(event); onReady(event); };
      }
    });
    this.loaded = true;
    return { modelVersion: manifest.modelVersion, contentVersion: manifest.contentVersion };
  }

  async startUtterance({ userInitiated = false, stream: sharedStream = null, onCandidate = () => {}, onRejected = () => {}, onError = () => {} } = {}) {
    if (!this.loaded || this.disposed) throw codedError(this.disposed ? 'client_disposed' : 'model_not_loaded');
    if (!userInitiated) throw codedError('user_action_required');
    if (this.stream) throw codedError('capture_already_active');
    const mediaDevices = this.environment.mediaDevices ?? globalThis.navigator?.mediaDevices;
    const video = this.environment.videoElement;
    if (!mediaDevices?.getUserMedia || !video) throw codedError('camera_unavailable');
    const generation = ++this.captureGeneration;
    this.callbacks = { onCandidate, onRejected, onError };
    try {
      const stream = sharedStream ?? await mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user' } });
      if (this.disposed || generation !== this.captureGeneration) {
        if (!sharedStream) for (const track of stream?.getTracks?.() ?? []) { try { track.stop(); } catch { /* release every track */ } }
        throw codedError(this.disposed ? 'client_disposed' : 'capture_cancelled');
      }
      this.stream = stream;
      this.ownsStream = !sharedStream;
      video.srcObject = this.stream;
      video.playsInline = true;
      await video.play();
      if (this.disposed || generation !== this.captureGeneration) throw codedError(this.disposed ? 'client_disposed' : 'capture_cancelled');
      this.finishing = false;
      this.lastFrameAt = -Infinity;
      this.framesInFlight = 0;
      this.captureNextFrame();
      return true;
    } catch (error) {
      await this.releaseCapture({ abort: true });
      throw error?.code ? error : codedError('camera_permission_or_start_failed');
    }
  }

  captureNextFrame() {
    if (!this.stream || this.finishing || this.disposed) return;
    const requestFrame = this.environment.requestAnimationFrame ?? globalThis.requestAnimationFrame;
    if (typeof requestFrame !== 'function') return this.handleWorkerError(codedError('camera_frame_api_unavailable'));
    this.animationFrame = requestFrame(async (timestampMs) => {
      this.animationFrame = null;
      if (!this.stream || this.finishing || this.disposed) return;
      const video = this.environment.videoElement;
      if (video?.readyState >= 2 && this.framesInFlight < MAX_PENDING_FRAMES && timestampMs - this.lastFrameAt >= 100) {
        this.lastFrameAt = timestampMs;
        let bitmap;
        try {
          const createBitmap = this.environment.createImageBitmap ?? globalThis.createImageBitmap;
          if (typeof createBitmap !== 'function') throw codedError('image_bitmap_unavailable');
          bitmap = await createBitmap(video);
          if (!this.stream || this.finishing || this.disposed) {
            bitmap.close?.();
            return;
          }
          this.worker.postMessage({ type: 'FRAME', imageBitmap: bitmap, timestampMs }, [bitmap]);
          this.framesInFlight += 1;
          try { bitmap.close?.(); } catch { /* ownership transferred to the worker */ }
        } catch (error) {
          try { bitmap?.close?.(); } catch { /* already closed or transferred */ }
          this.handleWorkerError(error?.code ? error : codedError('frame_transfer_failed'));
          return;
        }
      }
      this.captureNextFrame();
    });
  }

  async stopCapture() {
    if (!this.stream) return null;
    this.finishing = true;
    this.cancelFrameLoop();
    const resultPromise = new Promise((resolve) => {
      this.pendingResult = resolve;
      const timer = (this.environment.setTimeout ?? setTimeout)(() => {
        if (this.pendingResult !== resolve) return;
        this.pendingResult = null;
        this.worker?.postMessage({ type: 'ABORT', reason: 'recognition_timeout' });
        this.callbacks?.onRejected?.({ reason: 'recognition_timeout', modelVersion: this.manifest.modelVersion });
        resolve(null);
      }, UTTERANCE_TIMEOUT_MS);
      this.clearPendingTimer = () => (this.environment.clearTimeout ?? clearTimeout)(timer);
    });
    this.worker.postMessage({ type: 'FINISH' });
    const result = await resultPromise;
    await this.releaseCapture({ abort: false });
    return result;
  }

  async abortCapture(reason = 'capture_stopped') {
    this.captureGeneration += 1;
    if (!this.stream) return;
    this.finishing = true;
    this.worker?.postMessage({ type: 'ABORT', reason });
    await this.releaseCapture({ abort: false });
    this.resolvePending(null);
  }

  handleWorkerMessage(message) {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'FRAME_ACK') {
      this.framesInFlight = Math.max(0, this.framesInFlight - 1);
      return;
    }
    if (message.type === 'ERROR') {
      this.handleWorkerError(codedError(message.code || 'worker_failed'));
      return;
    }
    if (!this.stream || !this.finishing) return;
    if (message.type === 'REJECTED') {
      const result = { reason: typeof message.reason === 'string' ? message.reason : 'recognition_rejected', modelVersion: this.manifest.modelVersion };
      this.callbacks?.onRejected?.(result);
      this.resolvePending(result);
      return;
    }
    if (message.type !== 'CANDIDATE') return;
    const validConfidence = typeof message.confidence === 'number'
      && Number.isFinite(message.confidence)
      && message.confidence >= this.manifest.confidenceThreshold
      && message.confidence <= 1;
    const validEvents = validGlossEvents(message.glossEvents, this.manifest.vocabulary);
    const eventConfidenceValid = validEvents && message.glossEvents.every((event) => event.confidence >= this.manifest.confidenceThreshold);
    if (!validConfidence || !validEvents || !eventConfidenceValid) {
      const rejected = { reason: 'invalid_or_low_confidence_output', modelVersion: this.manifest.modelVersion };
      this.callbacks?.onRejected?.(rejected);
      this.resolvePending(rejected);
      return;
    }
    const candidate = {
      glossEvents: message.glossEvents.map((event) => ({ ...event })),
      text: undefined,
      glosses: message.glossEvents.map((event) => event.glossId),
      confidence: message.confidence,
      source: 'verified-onnx',
      warnings: [],
      needsConfirmation: true,
      modelVersion: this.manifest.modelVersion,
      contentVersion: this.manifest.contentVersion,
    };
    this.callbacks?.onCandidate?.(candidate);
    this.resolvePending(candidate);
  }

  resolvePending(value) {
    this.clearPendingTimer?.();
    this.clearPendingTimer = null;
    const resolve = this.pendingResult;
    this.pendingResult = null;
    resolve?.(value);
  }

  handleWorkerError(error) {
    if (!this.stream) return;
    this.callbacks?.onError?.(error);
    void this.releaseCapture({ abort: true });
    this.resolvePending(null);
  }

  cancelFrameLoop() {
    if (this.animationFrame === null) return;
    (this.environment.cancelAnimationFrame ?? globalThis.cancelAnimationFrame)?.(this.animationFrame);
    this.animationFrame = null;
  }

  async releaseCapture({ abort }) {
    this.cancelFrameLoop();
    const stream = this.stream;
    const ownsStream = this.ownsStream;
    this.stream = null;
    this.ownsStream = false;
    this.framesInFlight = 0;
    if (abort && this.worker) this.worker.postMessage({ type: 'ABORT' });
    if (ownsStream) for (const track of stream?.getTracks?.() ?? []) {
      try { track.stop(); } catch { /* stop all remaining tracks */ }
    }
    const video = this.environment.videoElement;
    if (video && ownsStream) {
      try { video.pause?.(); } catch { /* clearing srcObject is the privacy boundary */ }
      video.srcObject = null;
    }
    this.callbacks = null;
    this.finishing = false;
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    await this.abortCapture('client_disposed');
    this.pageTarget.removeEventListener?.('pagehide', this._onPageHide);
    if (this.worker) {
      this.worker.removeEventListener?.('message', this._onMessage);
      this.worker.removeEventListener?.('error', this._onError);
      this.worker.terminate?.();
      this.worker = null;
    }
    this.loaded = false;
    this.manifest = null;
  }
}
