const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const SAFE_PATH_PATTERN = /^\/assets\/tid\/[A-Za-z0-9._/-]+$/u;
const MAX_SEGMENT_MS = 60_000;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isSafeAssetPath(path, origin) {
  if (typeof path !== 'string' || !SAFE_PATH_PATTERN.test(path)) return false;
  if (path.split('/').some((part, index) => index > 0 && ['', '.', '..'].includes(part))) return false;
  try {
    return new URL(path, origin).origin === origin;
  } catch {
    return false;
  }
}

function toBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return null;
}

async function sha256(bytes) {
  if (!globalThis.crypto?.subtle) fail('crypto_unavailable');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function validateSegmentShape(segment) {
  if (!isRecord(segment) || !['video', 'avatar'].includes(segment.kind) || typeof segment.assetId !== 'string' || !segment.assetId.trim()) {
    fail('segment_invalid');
  }
  if (!Number.isInteger(segment.startMs) || !Number.isInteger(segment.endMs)
    || segment.startMs < 0 || segment.endMs <= segment.startMs
    || segment.endMs - segment.startMs > MAX_SEGMENT_MS) fail('segment_timing_invalid');
  if (segment.kind === 'avatar' && (typeof segment.animationId !== 'string' || !/^[A-Za-z0-9._-]+$/u.test(segment.animationId))) {
    fail('animation_id_invalid');
  }
  if (!Array.isArray(segment.nonManual) || !segment.nonManual.every((interval) => (
    isRecord(interval)
    && Number.isInteger(interval.startMs)
    && Number.isInteger(interval.endMs)
    && interval.startMs >= segment.startMs
    && interval.endMs <= segment.endMs
    && interval.endMs > interval.startMs
    && typeof interval.face === 'string'
    && interval.face.trim()
    && typeof interval.head === 'string'
    && interval.head.trim()
  ))) fail('non_manual_timeline_invalid');
}

async function validateAsset(asset, segment, origin) {
  if (!isRecord(asset)) fail('asset_missing');
  if (!isSafeAssetPath(asset.path, origin)) fail('asset_unsafe_path');
  if (typeof asset.licenseId !== 'string' || !asset.licenseId.trim() || asset.redistributionAllowed !== true) fail('asset_unlicensed');
  if (typeof asset.sha256 !== 'string' || !SHA256_PATTERN.test(asset.sha256)) fail('asset_hash_invalid');
  if (!Number.isInteger(asset.durationMs) || asset.durationMs <= 0 || segment.endMs > asset.durationMs) fail('segment_timing_invalid');
  const bytes = toBytes(asset.bytes);
  if (!bytes) fail('asset_bytes_missing');
  if (await sha256(bytes) !== asset.sha256) fail('asset_hash_mismatch');

  let parsed = null;
  if (segment.kind === 'video') {
    if (typeof asset.mediaType !== 'string' || !asset.mediaType.toLowerCase().startsWith('video/')) fail('asset_kind_mismatch');
  } else {
    if (asset.mediaType !== 'application/json') fail('asset_kind_mismatch');
    try {
      parsed = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      fail('asset_animation_invalid');
    }
    if (!isRecord(parsed?.animations)) fail('asset_animation_invalid');
    const animation = parsed.animations[segment.animationId];
    if (!isRecord(animation) || !Number.isInteger(animation.durationMs) || animation.durationMs < segment.endMs
      || !Array.isArray(animation.frames) || animation.frames.length < 2
      || !animation.frames.every((frame, index, frames) => (
        isRecord(frame)
        && Number.isInteger(frame.atMs)
        && frame.atMs >= 0
        && frame.atMs <= animation.durationMs
        && (index === 0 || frame.atMs > frames[index - 1].atMs)
        && isRecord(frame.pose)
      ))) fail('asset_animation_invalid');
  }
  return { ...asset, bytes, parsed };
}

export function createTidMediaPlayer({
  avatar = null,
  videoElement = null,
  resolveAsset,
  origin = globalThis.location?.origin ?? 'http://localhost',
} = {}) {
  if (typeof resolveAsset !== 'function') fail('asset_resolver_required');
  let stopped = false;
  let disposed = false;
  let activeCleanup = null;
  let activePromise = null;
  const objectUrls = new Set();

  function emitNonManual(segment, interval, active, callbacks) {
    callbacks.onNonManual?.({ assetId: segment.assetId, interval: { ...interval }, active });
  }

  function scheduleNonManual(segment, callbacks) {
    const timers = new Set();
    const active = new Set();
    let cancelled = false;
    const start = segment.startMs;
    for (const interval of segment.nonManual) {
      const startTimer = setTimeout(() => {
        timers.delete(startTimer);
        if (cancelled) return;
        active.add(interval);
        emitNonManual(segment, interval, true, callbacks);
      }, interval.startMs - start);
      timers.add(startTimer);
      const endTimer = setTimeout(() => {
        timers.delete(endTimer);
        active.delete(interval);
        emitNonManual(segment, interval, false, callbacks);
      }, interval.endMs - start);
      timers.add(endTimer);
    }
    return () => {
      cancelled = true;
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      for (const interval of active) emitNonManual(segment, interval, false, callbacks);
      active.clear();
    };
  }

  function playVideoSegment(asset, segment, callbacks) {
    if (!videoElement) fail('video_player_unavailable');
    const blobUrl = URL.createObjectURL(new Blob([asset.bytes], { type: asset.mediaType }));
    objectUrls.add(blobUrl);
    videoElement.src = blobUrl;

    return new Promise((resolve, reject) => {
      let settled = false;
      let playbackStarted = false;
      let timeoutId;
      let cancelCues = () => {};
      const clean = () => {
        clearTimeout(timeoutId);
        cancelCues();
        videoElement.removeEventListener('loadedmetadata', onLoadedMetadata);
        videoElement.removeEventListener('timeupdate', onTimeUpdate);
        videoElement.removeEventListener('ended', onEnded);
        videoElement.removeEventListener('error', onError);
        videoElement.pause();
        activeCleanup = null;
      };
      const finish = (status) => {
        if (settled) return;
        settled = true;
        if (status === 'completed') videoElement.currentTime = segment.endMs / 1000;
        clean();
        URL.revokeObjectURL(blobUrl);
        objectUrls.delete(blobUrl);
        resolve({ status });
      };
      const onTimeUpdate = () => {
        if (videoElement.currentTime >= segment.endMs / 1000) finish('completed');
      };
      const onEnded = () => {
        if (videoElement.currentTime + 0.02 < segment.endMs / 1000) onError();
        else finish('completed');
      };
      const onError = () => {
        if (settled) return;
        settled = true;
        clean();
        URL.revokeObjectURL(blobUrl);
        objectUrls.delete(blobUrl);
        reject(Object.assign(new Error('media_playback_failed'), { code: 'media_playback_failed' }));
      };
      const onLoadedMetadata = () => {
        if (settled || playbackStarted) return;
        playbackStarted = true;
        try {
          videoElement.currentTime = segment.startMs / 1000;
          cancelCues = scheduleNonManual(segment, callbacks);
          Promise.resolve(videoElement.play()).catch(onError);
        } catch {
          onError();
        }
      };
      videoElement.addEventListener('loadedmetadata', onLoadedMetadata);
      videoElement.addEventListener('timeupdate', onTimeUpdate);
      videoElement.addEventListener('ended', onEnded);
      videoElement.addEventListener('error', onError);
      activeCleanup = () => finish('stopped');
      timeoutId = setTimeout(onError, segment.endMs - segment.startMs + 30_000);
      if (videoElement.readyState >= 1 || Number.isFinite(videoElement.duration)) onLoadedMetadata();
      else videoElement.load?.();
    });
  }

  async function playAvatarSegment(asset, segment, callbacks) {
    if (!avatar || typeof avatar.playValidatedAnimation !== 'function') fail('avatar_player_unavailable');
    const animation = asset.parsed.animations[segment.animationId];
    const cancelCues = scheduleNonManual(segment, callbacks);
    activeCleanup = () => {
      cancelCues();
      avatar.stop?.();
    };
    const result = await avatar.playValidatedAnimation(segment.animationId, animation, {
      startMs: segment.startMs,
      endMs: segment.endMs,
      onFrame: callbacks.onAvatarFrame,
    });
    cancelCues();
    activeCleanup = null;
    return result?.status === 'stopped' || result === false ? { status: 'stopped' } : { status: 'completed' };
  }

  async function playValidatedSegment(asset, segment, callbacks = {}) {
    validateSegmentShape(segment);
    const verified = await validateAsset(asset, segment, origin);
    if (stopped || disposed) return { status: 'stopped' };
    callbacks.onSegmentStart?.(segment);
    const result = segment.kind === 'video'
      ? await playVideoSegment(verified, segment, callbacks)
      : await playAvatarSegment(verified, segment, callbacks);
    callbacks.onSegmentEnd?.(segment, result);
    return result;
  }

  async function play(segments, callbacks = {}) {
    if (disposed) fail('player_disposed');
    if (activePromise) fail('player_busy');
    if (!Array.isArray(segments) || segments.length === 0) fail('segments_invalid');
    stopped = false;
    const promise = (async () => {
      const prepared = [];
      for (const segment of segments) {
        validateSegmentShape(segment);
        let asset;
        try {
          asset = await resolveAsset(segment.assetId);
        } catch {
          fail('asset_missing');
        }
        prepared.push({ segment, asset: await validateAsset(asset, segment, origin) });
      }
      for (const { segment, asset } of prepared) {
        if (stopped || disposed) break;
        const result = await playValidatedSegment(asset, segment, callbacks);
        if (result.status === 'stopped') break;
      }
      return { status: stopped || disposed ? 'stopped' : 'completed' };
    })();
    activePromise = promise;
    try {
      return await promise;
    } finally {
      await stopAndRestoreNeutralPose();
      activePromise = null;
      stopped = false;
    }
  }

  async function stopAndRestoreNeutralPose() {
    stopped = true;
    activeCleanup?.();
    activeCleanup = null;
    videoElement?.pause?.();
    avatar?.applyIdlePose?.();
    for (const url of objectUrls) URL.revokeObjectURL(url);
    objectUrls.clear();
  }

  function stop() {
    return stopAndRestoreNeutralPose();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    void stopAndRestoreNeutralPose();
  }

  return { play, playValidatedSegment, stop, dispose, stopAndRestoreNeutralPose };
}
