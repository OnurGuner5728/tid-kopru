function codedError(code) { const error = new Error(code); error.code = code; return error; }

export function createCloudSession({ pageTarget = globalThis } = {}) {
  let key = null;
  let disposed = false;
  const clearKey = () => { key = null; };
  const onPageHide = () => clearKey();
  pageTarget?.addEventListener?.('pagehide', onPageHide);

  const api = {
    setKey(value) {
      if (disposed) throw codedError('cloud_session_disposed');
      if (typeof value !== 'string' || !value.trim() || value.length > 512) throw codedError('invalid_cloud_key');
      key = value.trim();
    },
    clearKey,
    hasKey: () => Boolean(key),
    async withKey(callback) {
      if (disposed) throw codedError('cloud_session_disposed');
      if (!key) throw codedError('cloud_key_missing');
      if (typeof callback !== 'function') throw new TypeError('cloud_key_callback_required');
      return callback(key);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearKey();
      pageTarget?.removeEventListener?.('pagehide', onPageHide);
    },
  };
  return Object.freeze(api);
}
