import { stopMediaStream } from './privacy-mode.mjs';

export function createMediaCaptureRegistry() {
  const leases = new Map();
  let disposed = false;

  const entryFor = (name) => {
    if (typeof name !== 'string' || !name.trim()) throw new TypeError('capture_name_required');
    if (!leases.has(name)) leases.set(name, { generation: 0, stream: null });
    return leases.get(name);
  };

  const begin = (name) => {
    if (disposed) throw Object.assign(new Error('capture_registry_disposed'), { code: 'capture_registry_disposed' });
    const entry = entryFor(name);
    entry.generation += 1;
    stopMediaStream(entry.stream);
    entry.stream = null;
    return entry.generation;
  };

  const isCurrent = (name, token) => !disposed && entryFor(name).generation === token;

  const accept = (name, token, stream) => {
    const entry = entryFor(name);
    if (disposed || entry.generation !== token || !stream) {
      stopMediaStream(stream);
      return false;
    }
    stopMediaStream(entry.stream);
    entry.stream = stream;
    return true;
  };

  const cancel = (name) => {
    const entry = entryFor(name);
    entry.generation += 1;
    stopMediaStream(entry.stream);
    entry.stream = null;
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const entry of leases.values()) {
      entry.generation += 1;
      stopMediaStream(entry.stream);
      entry.stream = null;
    }
  };

  return { begin, accept, isCurrent, cancel, dispose };
}
