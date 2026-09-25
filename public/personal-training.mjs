function codedError(code) { const error = new Error(code); error.code = code; return error; }

function qualityFor(frames) {
  const visible = frames.filter((frame) => frame?.handMask?.left || frame?.handMask?.right).length;
  if (!frames.length || visible / frames.length < 0.5) return 'low';
  return frames.length >= 3 ? 'good' : 'usable';
}

export function createPersonalTrainer({ runtime, store, minSamples = 3 } = {}) {
  if (!runtime || !store || !Number.isInteger(minSamples) || minSamples < 1) throw new TypeError('personal_trainer_dependencies_missing');

  const addSample = async (label, frames) => {
    if (typeof label !== 'string' || !label.trim() || !Array.isArray(frames) || !frames.length) throw codedError('empty_landmark_sample');
    await store.addSample(label.trim(), { frames });
    const progress = await getProgress(label.trim());
    return { ...progress, frameCount: frames.length, quality: qualityFor(frames) };
  };

  const recordSample = async (label, options = {}) => {
    if (typeof runtime.captureSample !== 'function') throw codedError('capture_runtime_unavailable');
    const frames = await runtime.captureSample(options);
    return addSample(label, frames);
  };

  async function getProgress(label) {
    const samples = await store.getSamples(label);
    return { label, sampleCount: samples.length, minSamples, ready: samples.length >= minSamples };
  }

  return {
    addSample, recordSample, getProgress,
    deleteLabel: (label) => store.deleteLabel(label),
    clear: () => store.clear(),
    listLabels: () => store.listLabels(),
  };
}
