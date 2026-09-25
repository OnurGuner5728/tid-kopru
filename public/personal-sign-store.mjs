const memoryDatabases = new Map();

function codedError(code) { const error = new Error(code); error.code = code; return error; }
function clone(value) { return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value)); }

function validFrame(frame) {
  return frame && typeof frame === 'object' && Number.isFinite(frame.timestampMs)
    && frame.handMask && frame.hands && !('imageBitmap' in frame) && !('pixels' in frame) && !('video' in frame);
}

function validSample(sample) {
  return sample && Array.isArray(sample.frames) && sample.frames.length > 0 && sample.frames.every(validFrame);
}

function openDatabase(indexedDB, dbName) {
  if (!indexedDB?.open) return Promise.resolve(null);
  return new Promise((resolve) => {
    let request;
    try { request = indexedDB.open(dbName, 1); } catch { resolve(null); return; }
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore('samples', { keyPath: 'id', autoIncrement: true });
      store.createIndex('label', 'label', { unique: false });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

export function createPersonalSignStore({ indexedDB = globalThis.indexedDB, dbName = 'tid-kopru-personal-v1' } = {}) {
  if (!memoryDatabases.has(dbName)) memoryDatabases.set(dbName, new Map());
  const memory = memoryDatabases.get(dbName);
  const dbPromise = openDatabase(indexedDB, dbName);

  const withStore = async (mode, operation) => {
    const db = await dbPromise;
    if (!db) return null;
    return new Promise((resolve, reject) => {
      try {
        const transaction = db.transaction('samples', mode);
        const store = transaction.objectStore('samples');
        const request = operation(store);
        if (request) {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        } else {
          transaction.oncomplete = () => resolve(true);
          transaction.onerror = () => reject(transaction.error);
        }
      } catch (error) { reject(error); }
    }).catch(() => null);
  };

  const addSample = async (label, sample) => {
    if (typeof label !== 'string' || !label.trim() || !validSample(sample)) throw codedError('invalid_personal_sample');
    const record = { label: label.trim(), createdAt: Date.now(), frames: clone(sample.frames) };
    const existing = memory.get(record.label) ?? [];
    existing.push(record);
    memory.set(record.label, existing);
    await withStore('readwrite', (store) => store.add(record));
    return clone(record);
  };

  const getSamples = async (label) => {
    const dbResult = await withStore('readonly', (store) => store.index('label').getAll(label));
    return clone(Array.isArray(dbResult) && dbResult.length ? dbResult : memory.get(label) ?? []);
  };

  const listLabels = async () => {
    const dbResult = await withStore('readonly', (store) => store.getAll());
    const labels = Array.isArray(dbResult) && dbResult.length ? dbResult.map((row) => row.label) : [...memory.keys()];
    return [...new Set(labels)].sort((a, b) => a.localeCompare(b, 'tr'));
  };

  const deleteLabel = async (label) => {
    memory.delete(label);
    const db = await dbPromise;
    if (!db) return;
    const rows = await withStore('readonly', (store) => store.index('label').getAllKeys(label));
    if (Array.isArray(rows)) await withStore('readwrite', (store) => { for (const key of rows) store.delete(key); });
  };

  const clear = async () => { memory.clear(); await withStore('readwrite', (store) => store.clear()); };
  return { addSample, getSamples, listLabels, deleteLabel, clear };
}
