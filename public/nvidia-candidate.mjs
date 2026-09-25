const DEFAULT_ENDPOINT = 'https://integrate.api.nvidia.com/v1/chat/completions';
const DEFAULT_MODEL = 'google/gemma-4-31b-it';
const MAX_VIDEO_BYTES = 15 * 1024 * 1024;
const CLOUD_CONFIDENCE = 0.55;

function codedError(code, cause) { const error = new Error(code, cause ? { cause } : undefined); error.code = code; return error; }

function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function validateEndpoint(value, allowRelative = false) {
  if (allowRelative && typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')) return value;
  let url;
  try { url = new URL(value); } catch { throw codedError('cloud_endpoint_invalid'); }
  if (url.protocol !== 'https:') throw codedError('cloud_endpoint_invalid');
  return url.href;
}

function parseCandidate(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw codedError('cloud_response_invalid');
  let parsed;
  try { parsed = JSON.parse(content.trim()); } catch { throw codedError('cloud_response_invalid'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
      || typeof parsed.candidateText !== 'string' || !parsed.candidateText.trim()
      || parsed.candidateText.length > 800
      || !Array.isArray(parsed.glosses) || parsed.glosses.length > 50
      || parsed.glosses.some((value) => typeof value !== 'string' || !value.trim() || value.length > 80)
      || !Array.isArray(parsed.warnings) || parsed.warnings.length > 20
      || parsed.warnings.some((value) => typeof value !== 'string' || value.length > 240)) throw codedError('cloud_response_invalid');
  return {
    text: parsed.candidateText.trim(),
    glosses: parsed.glosses.map((value) => value.trim()),
    confidence: CLOUD_CONFIDENCE,
    source: 'cloud-candidate',
    warnings: [...parsed.warnings.map((value) => value.trim()), 'Genel amaçlı NVIDIA modeli TİD için doğrulanmamıştır.'],
    needsConfirmation: true,
  };
}

export function createNvidiaCandidateProvider({
  fetcher = globalThis.fetch?.bind(globalThis),
  endpoint = DEFAULT_ENDPOINT,
  model = DEFAULT_MODEL,
  proxyUrl = null,
  timeoutMs = 20_000,
} = {}) {
  if (typeof fetcher !== 'function') throw codedError('cloud_fetch_unavailable');
  const requestUrl = proxyUrl ? validateEndpoint(proxyUrl, true) : validateEndpoint(endpoint);
  if (typeof model !== 'string' || !model.trim()) throw codedError('cloud_model_invalid');

  return {
    async recognizeVideo({ blob, apiKey, signal } = {}) {
      if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      if (!(blob instanceof Blob) || !['video/webm', 'video/mp4'].includes(blob.type) || blob.size === 0 || blob.size > MAX_VIDEO_BYTES) {
        throw codedError('cloud_video_invalid');
      }
      if (!proxyUrl && (typeof apiKey !== 'string' || !apiKey.trim())) throw codedError('cloud_key_missing');
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const dataUrl = `data:${blob.type};base64,${bytesToBase64(bytes)}`;
      const controller = new AbortController();
      let timedOut = false;
      const onAbort = () => controller.abort(signal?.reason);
      signal?.addEventListener?.('abort', onAbort, { once: true });
      const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, Math.max(1, timeoutMs));
      const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
      if (!proxyUrl) headers.Authorization = `Bearer ${apiKey.trim()}`;
      const body = {
        model,
        messages: [{ role: 'user', content: [
          { type: 'text', text: 'Analyze this short clip as an unverified Turkish Sign Language candidate. Return only JSON with candidateText (Turkish string), glosses (string array), and warnings (string array). If uncertain, leave candidateText empty.' },
          { type: 'video_url', video_url: { url: dataUrl } },
        ] }],
        temperature: 0,
        max_tokens: 300,
      };
      try {
        const response = await fetcher(requestUrl, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
        if (response?.status === 401 || response?.status === 403) throw codedError('cloud_auth_failed');
        if (response?.status === 429) throw codedError('cloud_rate_limited');
        if (!response?.ok) throw codedError('cloud_request_failed');
        let payload;
        try { payload = await response.json(); } catch (error) { throw codedError('cloud_response_invalid', error); }
        return parseCandidate(payload);
      } catch (error) {
        if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
        if (timedOut) throw codedError('cloud_timeout', error);
        if (error?.code) throw error;
        throw codedError('cloud_network_failed', error);
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener?.('abort', onAbort);
      }
    },
  };
}
