const SOURCES = new Set(['personal', 'verified-onnx', 'cloud-candidate', 'reviewed-mapping']);

function rejected() {
  return {
    text: undefined, glosses: [], confidence: 0, source: 'none',
    warnings: ['Güvenilir bir aday bulunamadı.'], needsConfirmation: true, reason: 'anlaşılamadı',
  };
}

function validCandidate(value) {
  return value && typeof value === 'object' && SOURCES.has(value.source)
    && Array.isArray(value.glosses) && value.glosses.every((gloss) => typeof gloss === 'string' && gloss.trim())
    && typeof value.confidence === 'number' && Number.isFinite(value.confidence) && value.confidence >= 0 && value.confidence <= 1
    && Array.isArray(value.warnings) && value.warnings.every((warning) => typeof warning === 'string')
    && value.needsConfirmation === true
    && (value.text === undefined || typeof value.text === 'string');
}

function reviewedEvents(candidate) {
  return candidate.glosses.map((glossId, index) => ({
    glossId, startFrame: index, endFrame: index + 1, confidence: candidate.confidence,
  }));
}

export function createHybridRecognizer({ personalBackend, onnxBackend, cloudBackend, translateGlosses } = {}) {
  return {
    async recognize(utterance, { mode = 'local', cloudConsent = false, signal } = {}) {
      if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      const backends = [];
      if (personalBackend?.recognize) backends.push(personalBackend);
      if (['hybrid', 'cloud-assisted'].includes(mode) && onnxBackend?.recognize) backends.push(onnxBackend);
      if (mode === 'cloud-assisted' && cloudConsent === true && cloudBackend?.recognize) backends.push(cloudBackend);
      const settled = await Promise.allSettled(backends.map((backend) => backend.recognize(utterance, { signal })));
      const candidates = settled.filter(({ status }) => status === 'fulfilled').map(({ value }) => value).filter(validCandidate);
      if (!candidates.length) return rejected();
      const best = candidates.sort((left, right) => right.confidence - left.confidence)[0];
      const result = { ...best, glosses: [...best.glosses], warnings: [...best.warnings], needsConfirmation: true };
      if (!result.text && result.glosses.length && typeof translateGlosses === 'function') {
        const translated = translateGlosses(reviewedEvents(result));
        if (translated?.status === 'ready' && typeof translated.text === 'string' && translated.text.trim()) {
          result.text = translated.text.trim();
          result.warnings.push('Türkçe metin uzman onaylı gloss eşlemesinden üretildi.');
        }
      }
      if (!result.text && result.glosses.length) {
        result.text = result.glosses.join(' ');
        result.warnings.push('Türkçe cümle üretilemedi; düzenlenebilir işaret etiketleri gösteriliyor.');
      }
      return result;
    },
  };
}
