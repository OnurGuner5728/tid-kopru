export const TRANSLATION_MODES = Object.freeze({
  LOCAL: 'local',
  HYBRID: 'hybrid',
  CLOUD_ASSISTED: 'cloud-assisted',
});

const VALID_MODES = new Set(Object.values(TRANSLATION_MODES));
const stoppedTracks = new WeakSet();

export function stopMediaStream(stream) {
  const tracks = typeof stream?.getTracks === 'function' ? stream.getTracks() : [];
  for (const track of tracks) {
    if (!track || stoppedTracks.has(track)) continue;
    stoppedTracks.add(track);
    try { track.stop(); } catch { /* a failing track must not block the rest */ }
  }
}

export function createPrivacyModeController({
  initialMode = TRANSLATION_MODES.LOCAL,
  onChange = () => {},
  onDispose = () => {},
  pageTarget = globalThis.window,
  documentTarget = globalThis.document,
} = {}) {
  if (!VALID_MODES.has(initialMode)) throw new Error('invalid_translation_mode');
  let mode = initialMode;
  let cloudConsent = false;
  let disposed = false;
  const disposers = new Set();

  const getState = () => Object.freeze({ mode, cloudConsent });
  const emit = () => onChange(getState());

  const setMode = (nextMode) => {
    if (!VALID_MODES.has(nextMode)) throw new Error('invalid_translation_mode');
    mode = nextMode;
    if (mode === TRANSLATION_MODES.LOCAL) cloudConsent = false;
    emit();
  };

  const grantCloudConsent = () => {
    if (mode === TRANSLATION_MODES.LOCAL) throw new Error('cloud_consent_requires_hybrid_mode');
    cloudConsent = true;
    emit();
  };

  const revokeCloudConsent = () => {
    cloudConsent = false;
    emit();
  };

  const registerDisposer = (disposer) => {
    if (typeof disposer !== 'function') throw new TypeError('disposer_must_be_function');
    if (disposed) {
      disposer();
      return () => {};
    }
    disposers.add(disposer);
    return () => disposers.delete(disposer);
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    cloudConsent = false;
    pageTarget?.removeEventListener?.('pagehide', onPageHide);
    documentTarget?.removeEventListener?.('visibilitychange', onVisibilityChange);
    for (const disposer of disposers) {
      try { disposer(); } catch { /* continue closing remaining resources */ }
    }
    disposers.clear();
    emit();
    try { onDispose(); } catch { /* disposal must still complete */ }
  };

  const onPageHide = () => dispose();
  const onVisibilityChange = () => {
    if (documentTarget?.visibilityState === 'hidden') dispose();
  };
  pageTarget?.addEventListener?.('pagehide', onPageHide);
  documentTarget?.addEventListener?.('visibilitychange', onVisibilityChange);

  return {
    getState,
    setMode,
    grantCloudConsent,
    revokeCloudConsent,
    registerDisposer,
    dispose,
  };
}
