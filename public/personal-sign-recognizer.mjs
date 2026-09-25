function frameVector(frame) {
  if (!frame || typeof frame !== 'object') return null;
  const values = [frame.handMask?.left ? 1 : 0, frame.handMask?.right ? 1 : 0];
  for (const part of [frame.hands?.left, frame.hands?.right, frame.pose, frame.face]) {
    if (Array.isArray(part)) values.push(...part.map((value) => Number.isFinite(value) ? value : 0));
  }
  return values;
}

function pointDistance(left, right) {
  const size = Math.max(left.length, right.length);
  if (!size) return 0;
  let sum = 0;
  for (let index = 0; index < size; index += 1) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0);
    sum += delta * delta;
  }
  return Math.sqrt(sum / size);
}

export function dynamicTimeWarpDistance(a, b) {
  const left = Array.isArray(a) ? a.map(frameVector).filter(Boolean) : [];
  const right = Array.isArray(b) ? b.map(frameVector).filter(Boolean) : [];
  if (!left.length || !right.length) return Infinity;
  const width = Math.max(Math.abs(left.length - right.length), Math.ceil(Math.max(left.length, right.length) * 0.1));
  const rows = Array.from({ length: left.length + 1 }, () => new Float64Array(right.length + 1).fill(Infinity));
  rows[0][0] = 0;
  for (let i = 1; i <= left.length; i += 1) {
    const start = Math.max(1, i - width);
    const end = Math.min(right.length, i + width);
    for (let j = start; j <= end; j += 1) {
      rows[i][j] = pointDistance(left[i - 1], right[j - 1]) + Math.min(rows[i - 1][j], rows[i][j - 1], rows[i - 1][j - 1]);
    }
  }
  return rows[left.length][right.length] / Math.max(left.length, right.length);
}

function rejected() {
  return {
    text: undefined, glosses: [], confidence: 0, source: 'personal',
    warnings: ['Kişisel örneklerle güvenilir eşleşme bulunamadı.'], needsConfirmation: true, reason: 'anlaşılamadı',
  };
}

function thresholdFor(samples) {
  if (samples.length < 2) return 0.2;
  let largest = 0;
  for (let left = 0; left < samples.length; left += 1) {
    for (let right = left + 1; right < samples.length; right += 1) {
      largest = Math.max(largest, dynamicTimeWarpDistance(samples[left].frames, samples[right].frames));
    }
  }
  return Math.max(0.08, Math.min(0.45, largest * 1.25));
}

export function classifyPersonalSign({ frames, samples, rejectThreshold } = {}) {
  if (!Array.isArray(frames) || frames.length < 2 || !Array.isArray(samples) || !samples.length) return rejected();
  const byLabel = new Map();
  for (const sample of samples) {
    if (typeof sample?.label !== 'string' || !sample.label.trim() || !Array.isArray(sample.frames) || sample.frames.length < 2) continue;
    const group = byLabel.get(sample.label) ?? [];
    group.push(sample);
    byLabel.set(sample.label, group);
  }
  let best = null;
  for (const [label, labelSamples] of byLabel) {
    const threshold = Number.isFinite(rejectThreshold)
      ? Math.max(0.08, Math.min(0.45, rejectThreshold))
      : thresholdFor(labelSamples);
    const distance = Math.min(...labelSamples.map((sample) => dynamicTimeWarpDistance(frames, sample.frames)));
    if (!best || distance < best.distance) best = { label, distance, threshold };
  }
  if (!best || !Number.isFinite(best.distance) || best.distance > best.threshold) return rejected();
  return {
    text: undefined,
    glosses: [best.label],
    confidence: Math.max(0, Math.min(1, 1 - best.distance / Math.max(best.threshold, Number.EPSILON))),
    source: 'personal',
    warnings: ['Bu sonuç yalnızca bu cihazda öğretilen kişisel örneklere dayanır.'],
    needsConfirmation: true,
    distance: best.distance,
    rejectThreshold: best.threshold,
  };
}

export function createPersonalRecognitionBackend({ store } = {}) {
  if (!store) throw new TypeError('personal_store_required');
  return {
    async recognize({ frames } = {}) {
      const samples = [];
      for (const label of await store.listLabels()) {
        for (const sample of await store.getSamples(label)) samples.push({ label, frames: sample.frames });
      }
      return classifyPersonalSign({ frames, samples });
    },
  };
}
