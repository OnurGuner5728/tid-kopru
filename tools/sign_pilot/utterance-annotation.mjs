const CODE = /^[A-Za-z0-9_-]{1,32}$/;
const SHA256 = /^[a-f0-9]{64}$/i;
const RECORD_FIELDS = new Set([
  'schemaVersion', 'utteranceId', 'signerCode', 'consentCode', 'scopeId', 'fps', 'frames',
  'glossEvents', 'conditions', 'preprocessVersion', 'captureContractSha256',
]);
const FRAME_FIELDS = new Set([
  'timestampMs', 'pose', 'poseVisibility', 'leftHand', 'leftHandVisibility',
  'rightHand', 'rightHandVisibility', 'face', 'faceVisibility',
]);
const EVENT_FIELDS = new Set([
  'glossId', 'startMs', 'endMs', 'dominantHand', 'nonManual', 'channel',
  'parallelGroup', 'spatialReference',
]);
const EVENT_REQUIRED = ['glossId', 'startMs', 'endMs', 'dominantHand', 'nonManual', 'channel'];
const CONDITION_FIELDS = ['lightingCode', 'distanceCode', 'backgroundCode'];
const LANDMARK_GROUPS = [
  ['pose', 'poseVisibility'],
  ['leftHand', 'leftHandVisibility'],
  ['rightHand', 'rightHandVisibility'],
  ['face', 'faceVisibility'],
];
const PERSONAL_KEY_TERMS = ['name', 'email', 'phone', 'telephone', 'mobile', 'contact', 'address', 'video', 'recording', 'filepath', 'rawvideo', 'blob', 'identifier'];

function fail(code, detail = code) {
  const error = new Error(detail);
  error.code = code;
  throw error;
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function add(errors, code) {
  if (!errors.includes(code)) errors.push(code);
}

function hasPersonalKey(value) {
  if (Array.isArray(value)) return value.some(hasPersonalKey);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, nested]) => {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    return PERSONAL_KEY_TERMS.some((term) => normalized.includes(term)) || hasPersonalKey(nested);
  });
}

function checkExact(value, allowed, required, errors) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    add(errors, 'invalid_record');
    return false;
  }
  if (Object.keys(value).some((key) => !allowed.has(key))) add(errors, 'unknown_field');
  if (required.some((key) => !Object.hasOwn(value, key))) add(errors, 'missing_required_field');
  return true;
}

function overlapAllowed(first, second) {
  const group = first.parallelGroup;
  return typeof group === 'string'
    && CODE.test(group)
    && second.parallelGroup === group
    && first.channel !== second.channel
    && ['manual', 'nonManual'].includes(first.channel)
    && ['manual', 'nonManual'].includes(second.channel);
}

export function alignGlossEvents(events, durationMs, approvedGlosses = null) {
  if (!Array.isArray(events)) fail('invalid_gloss_events');
  if (!finite(durationMs) || durationMs <= 0) fail('invalid_gloss_timing');
  if (approvedGlosses != null && (!Array.isArray(approvedGlosses) || !approvedGlosses.every((gloss) => typeof gloss === 'string' && CODE.test(gloss)))) {
    fail('invalid_approved_glosses');
  }
  const approved = approvedGlosses == null ? null : new Set(approvedGlosses);
  const errors = [];
  const aligned = events.map((event) => {
    if (!checkExact(event, EVENT_FIELDS, EVENT_REQUIRED, errors)) return event;
    if (!CODE.test(event.glossId ?? '') || (approved && !approved.has(event.glossId))) add(errors, 'unknown_gloss');
    if (!finite(event.startMs) || !finite(event.endMs) || event.startMs < 0 || event.endMs <= event.startMs || event.endMs > durationMs) {
      add(errors, 'invalid_gloss_timing');
    }
    if (!['left', 'right', 'both', 'none'].includes(event.dominantHand)
      || !['manual', 'nonManual'].includes(event.channel)
      || !Array.isArray(event.nonManual)
      || event.nonManual.some((code) => typeof code !== 'string' || !CODE.test(code))) {
      add(errors, 'invalid_gloss_event');
    } else if ((event.channel === 'manual' && event.dominantHand === 'none')
      || (event.channel === 'nonManual' && (event.dominantHand !== 'none' || event.nonManual.length === 0))) {
      add(errors, 'invalid_gloss_event');
    }
    for (const field of ['parallelGroup', 'spatialReference']) {
      if (Object.hasOwn(event, field) && (typeof event[field] !== 'string' || !CODE.test(event[field]))) {
        add(errors, 'invalid_gloss_event');
      }
    }
    return { ...event };
  }).sort((left, right) => {
    if (!finite(left?.startMs) || !finite(right?.startMs)) return 0;
    return left.startMs - right.startMs || left.endMs - right.endMs;
  });
  for (let index = 0; index < aligned.length; index += 1) {
    const first = aligned[index];
    if (!finite(first?.startMs) || !finite(first?.endMs)) continue;
    for (const second of aligned.slice(index + 1)) {
      if (!finite(second?.startMs) || !finite(second?.endMs)) continue;
      if (Math.max(first.startMs, second.startMs) >= Math.min(first.endMs, second.endMs)) continue;
      if (!overlapAllowed(first, second)) add(errors, 'unauthorized_overlap');
    }
  }
  if (errors.length) fail(errors[0], errors.join(', '));
  return aligned;
}

export function validateUtteranceRecord(record, manifest) {
  const errors = [];
  if (hasPersonalKey(record)) add(errors, 'personal_data_field');
  if (!checkExact(record, RECORD_FIELDS, [...RECORD_FIELDS], errors)) return errors;
  if (record.schemaVersion !== 2) add(errors, 'unsupported_schema');
  for (const field of ['utteranceId', 'signerCode', 'consentCode', 'scopeId', 'preprocessVersion']) {
    if (typeof record[field] !== 'string' || !CODE.test(record[field])) {
      add(errors, field === 'consentCode' ? 'missing_consent' : `invalid_${field[0].toLowerCase()}${field.slice(1)}`);
    }
  }
  if (!manifest || manifest.approved !== true || manifest.schemaVersion !== '2.0') add(errors, 'capture_requires_approved_manifest');
  if (!Array.isArray(manifest?.approvedGlosses) || manifest.approvedGlosses.length === 0
    || !manifest.approvedGlosses.every((gloss) => typeof gloss === 'string' && CODE.test(gloss))) add(errors, 'invalid_approved_glosses');
  if (manifest && (!Array.isArray(manifest.signers) || !manifest.signers.includes(record.signerCode))) add(errors, 'unknown_signer');
  if (manifest && (!Array.isArray(manifest.consentCodes) || !manifest.consentCodes.includes(record.consentCode))) add(errors, 'missing_consent');
  if (manifest && record.scopeId !== manifest.scopeId) add(errors, 'invalid_scope');
  if (!finite(record.fps) || record.fps <= 0 || record.fps > 120) add(errors, 'invalid_fps');
  if (!SHA256.test(record.captureContractSha256 ?? '')
    || record.captureContractSha256 !== manifest?.captureContractSha256) add(errors, 'invalid_capture_contract');
  if (record.preprocessVersion !== manifest?.preprocessVersion) add(errors, 'preprocess_version_mismatch');

  if (!record.conditions || typeof record.conditions !== 'object' || Array.isArray(record.conditions)
    || Object.keys(record.conditions).length !== CONDITION_FIELDS.length
    || Object.keys(record.conditions).some((field) => !CONDITION_FIELDS.includes(field))
    || CONDITION_FIELDS.some((field) => {
      const selected = record.conditions[field];
      const allowed = manifest?.conditions?.[field];
      return typeof selected !== 'string' || !allowed
        || (Array.isArray(allowed) ? !allowed.includes(selected) : selected !== allowed);
    })) add(errors, 'invalid_conditions');

  if (!Array.isArray(record.frames) || record.frames.length < 2) {
    add(errors, 'invalid_frames');
  } else {
    let previous = -Infinity;
    for (const frame of record.frames) {
      if (!checkExact(frame, FRAME_FIELDS, [...FRAME_FIELDS], errors)) continue;
      if (!finite(frame.timestampMs) || frame.timestampMs < 0 || frame.timestampMs <= previous) add(errors, 'invalid_timestamp');
      else previous = frame.timestampMs;
      for (const [coordinatesKey, visibilityKey] of LANDMARK_GROUPS) {
        const coordinates = frame[coordinatesKey];
        const visibility = frame[visibilityKey];
        if (!Array.isArray(coordinates) || coordinates.length < 3 || coordinates.length % 3 !== 0 || !coordinates.every(finite)) {
          add(errors, 'invalid_coordinate');
          continue;
        }
        if (!Array.isArray(visibility) || visibility.length !== coordinates.length / 3
          || !visibility.every((value) => finite(value) && [0, 1].includes(value))) add(errors, 'invalid_visibility');
      }
    }
  }

  const approvedGlosses = manifest?.approvedGlosses;
  if (!Array.isArray(record.glossEvents) || !record.glossEvents.length) {
    add(errors, 'invalid_gloss_events');
  } else if (Array.isArray(record.frames) && record.frames.length >= 2 && record.frames.every((frame) => finite(frame?.timestampMs))) {
    const duration = record.frames.at(-1).timestampMs - record.frames[0].timestampMs;
    let previousStart = -Infinity;
    for (const event of record.glossEvents) {
      if (finite(event?.startMs)) {
        if (event.startMs < previousStart) add(errors, 'invalid_event_order');
        previousStart = event.startMs;
      }
    }
    try {
      alignGlossEvents(record.glossEvents, duration, approvedGlosses);
    } catch (error) {
      for (const code of String(error.message).split(', ')) add(errors, code);
    }
  }
  return errors;
}

export function exportUtterance(record, manifest) {
  const errors = validateUtteranceRecord(record, manifest);
  if (errors.length) fail('dataset_validation_failed', errors.join(', '));
  return JSON.stringify(record) + '\n';
}

export async function exportPrivateResearchVideo(privateStudyFolderHandle, chunks, {
  rawVideoConsentVerified = false,
  randomUUID = () => globalThis.crypto?.randomUUID?.(),
  createBlob = (parts) => new Blob(parts, { type: 'video/webm' }),
} = {}) {
  if (rawVideoConsentVerified !== true) fail('raw_video_consent_required');
  if (!privateStudyFolderHandle || typeof privateStudyFolderHandle.getFileHandle !== 'function') {
    fail('private_study_folder_required');
  }
  if (!Array.isArray(chunks) || chunks.length === 0) fail('raw_video_missing');
  const id = randomUUID();
  if (typeof id !== 'string' || !id) fail('secure_random_unavailable');
  const fileName = `tid-utterance-${id}.webm`;
  const fileHandle = await privateStudyFolderHandle.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  try {
    await writable.write(createBlob(chunks));
    await writable.close();
  } catch (error) {
    try { await writable.abort?.(); } catch {}
    throw error;
  }
  chunks.splice(0, chunks.length);
  return fileName;
}
