import { createLocalMediaPipeLandmarker } from "./mediapipe-loader.mjs";

export const SCHEMA_VERSION = "1.0";
const RECORD_FIELDS = new Set(["schemaVersion", "signerCode", "consentCode", "signId", "repetition", "conditions", "fps", "frames", "preprocessVersion"]);
const CONDITION_FIELDS = new Set(["lightingCode", "distanceCode", "backgroundCode"]);
const GROUPS = [["pose", "poseVisibility"], ["leftHand", "leftHandVisibility"], ["rightHand", "rightHandVisibility"], ["face", "faceVisibility"]];
const FRAME_FIELDS = new Set(["timestampMs", ...GROUPS.flatMap(([coordinates, visibility]) => [coordinates, visibility])]);
const CODE = /^[A-Za-z0-9_-]{1,32}$/;
const PERSONAL_KEY_TERMS = ["name", "email", "phone", "telephone", "mobile", "contact", "address", "video", "recording", "filepath", "rawvideo", "blob"];
let activeCapture = null;

function captureError(code, message, codes = [code]) {
  const error = new Error(message);
  error.code = code;
  error.codes = codes;
  return error;
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeGroup(points, coordinateField, visibilityField) {
  if (points == null) points = [];
  if (!Array.isArray(points)) throw captureError("invalid_coordinate", coordinateField + " landmarks must be an array.");
  const coordinates = [];
  const visibility = [];
  for (const point of points) {
    if (point == null) {
      coordinates.push(0, 0, 0);
      visibility.push(0);
      continue;
    }
    if (![point.x, point.y, point.z].every(finiteNumber)) {
      throw captureError("invalid_coordinate", coordinateField + " contains a non-finite coordinate.");
    }
    const score = point.visibility ?? point.presence ?? 1;
    if (!finiteNumber(score) || score < 0 || score > 1) {
      throw captureError("invalid_visibility", visibilityField + " must be between zero and one.");
    }
    coordinates.push(point.x, point.y, point.z);
    visibility.push(score >= 0.5 ? 1 : 0);
  }
  return [coordinates, visibility];
}

export function normalizeLandmarkFrame(landmarks = {}, { previousTimestampMs = -Infinity } = {}) {
  const timestampMs = landmarks.timestampMs;
  if (!finiteNumber(timestampMs) || timestampMs < 0 || timestampMs <= previousTimestampMs) {
    throw captureError("invalid_timestamp", "Frame timestamps must be finite and strictly increasing.");
  }
  const frame = { timestampMs };
  for (const [coordinatesField, visibilityField] of GROUPS) {
    const result = normalizeGroup(landmarks[coordinatesField], coordinatesField, visibilityField);
    frame[coordinatesField] = result[0];
    frame[visibilityField] = result[1];
  }
  return frame;
}

function hasPersonalDataKey(value) {
  if (Array.isArray(value)) return value.some(hasPersonalDataKey);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, nested]) => {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    return PERSONAL_KEY_TERMS.some((term) => normalized.includes(term)) || hasPersonalDataKey(nested);
  });
}

function addError(errors, code) {
  if (!errors.includes(code)) errors.push(code);
}

function validateFrame(frame, errors, previousTimestamp) {
  if (!frame || typeof frame !== "object" || Array.isArray(frame)) {
    addError(errors, "invalid_frame");
    return previousTimestamp;
  }
  if (hasPersonalDataKey(frame)) addError(errors, "personal_data_field");
  if (Object.keys(frame).some((key) => !FRAME_FIELDS.has(key))) addError(errors, "unknown_field");
  if ([...FRAME_FIELDS].some((key) => !Object.hasOwn(frame, key))) addError(errors, "invalid_frame");
  if (!finiteNumber(frame.timestampMs) || frame.timestampMs < 0 || frame.timestampMs <= previousTimestamp) {
    addError(errors, "invalid_timestamp");
  } else {
    previousTimestamp = frame.timestampMs;
  }
  for (const [coordinatesField, visibilityField] of GROUPS) {
    const coordinates = frame[coordinatesField];
    const visibility = frame[visibilityField];
    const validCoordinates = Array.isArray(coordinates) && coordinates.length % 3 === 0 && coordinates.every(finiteNumber);
    if (!validCoordinates) {
      addError(errors, "invalid_coordinate");
      continue;
    }
    if (!Array.isArray(visibility) || visibility.length !== coordinates.length / 3
      || !visibility.every((value) => finiteNumber(value) && (value === 0 || value === 1))) {
      addError(errors, "invalid_visibility");
    }
  }
  return previousTimestamp;
}

export function validateLandmarkRecords(records, manifest = {}) {
  if (!Array.isArray(records)) return ["invalid_records"];
  const signers = new Set(Array.isArray(manifest.signers) ? manifest.signers : []);
  const allowedSigns = new Set(Array.isArray(manifest.allowedSigns) ? manifest.allowedSigns : []);
  const errors = [];
  for (const record of records) {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      addError(errors, "invalid_record");
      continue;
    }
    if (hasPersonalDataKey(record)) addError(errors, "personal_data_field");
    if (Object.keys(record).some((key) => !RECORD_FIELDS.has(key))) addError(errors, "unknown_field");
    for (const field of RECORD_FIELDS) {
      if (!Object.hasOwn(record, field)) addError(errors, field === "consentCode" ? "missing_consent" : "missing_required_field");
    }
    if (Object.hasOwn(record, "schemaVersion") && record.schemaVersion !== SCHEMA_VERSION) addError(errors, "unsupported_schema");
    if (typeof record.signerCode !== "string" || !CODE.test(record.signerCode)) addError(errors, "invalid_signer_code");
    else if (!signers.has(record.signerCode)) addError(errors, "unknown_signer");
    if (typeof record.consentCode !== "string" || !CODE.test(record.consentCode)) addError(errors, "missing_consent");
    if (typeof record.signId !== "string" || !CODE.test(record.signId) || !allowedSigns.has(record.signId)) addError(errors, "unknown_sign");
    if (!Number.isInteger(record.repetition) || record.repetition < 1) addError(errors, "invalid_repetition");
    if (typeof record.preprocessVersion !== "string" || !CODE.test(record.preprocessVersion)) addError(errors, "invalid_preprocess_version");
    if (!finiteNumber(record.fps) || record.fps <= 0 || record.fps > 120) addError(errors, "invalid_fps");
    const conditions = record.conditions;
    const conditionLists = manifest.conditions;
    const conditionNames = { lightingCode: "lighting", distanceCode: "distance", backgroundCode: "background" };
    if (!conditions || typeof conditions !== "object" || Array.isArray(conditions)
      || Object.keys(conditions).length !== CONDITION_FIELDS.size
      || Object.keys(conditions).some((key) => !CONDITION_FIELDS.has(key))
      || [...CONDITION_FIELDS].some((key) => typeof conditions[key] !== "string" || !CODE.test(conditions[key]))) {
      addError(errors, "invalid_conditions");
    } else if (conditionLists && Object.entries(conditionNames).some(([field, name]) =>
      !Array.isArray(conditionLists[name]) || !conditionLists[name].includes(conditions[field]))) {
      addError(errors, "invalid_conditions");
    }
    if (!Array.isArray(record.frames) || record.frames.length === 0) {
      addError(errors, "invalid_frames");
    } else {
      let previousTimestamp = -Infinity;
      for (const frame of record.frames) previousTimestamp = validateFrame(frame, errors, previousTimestamp);
    }
  }
  return errors;
}

function assertApprovedManifest(manifest, consentCode, metricsDisclosureAccepted) {
  if (!manifest || manifest.approved !== true || manifest.schemaVersion !== SCHEMA_VERSION) {
    throw captureError("capture_requires_approved_manifest", "Capture requires an advisor-approved pilot manifest.");
  }
  const codeLists = [manifest.signers, manifest.allowedSigns, manifest.consentCodes];
  if (codeLists.some((values) => !Array.isArray(values) || values.length === 0
    || new Set(values).size !== values.length || values.some((value) => typeof value !== "string" || !CODE.test(value)))) {
    throw captureError("invalid_pilot_manifest", "The approved manifest must list signer, sign, and consent codes.");
  }
  const approvedConditions = manifest.conditions;
  if (!approvedConditions || typeof approvedConditions !== "object"
    || ["lighting", "distance", "background"].some((field) => !Array.isArray(approvedConditions[field]) || approvedConditions[field].length === 0
      || new Set(approvedConditions[field]).size !== approvedConditions[field].length
      || approvedConditions[field].some((value) => typeof value !== "string" || !CODE.test(value)))) {
    throw captureError("invalid_pilot_manifest", "The approved manifest must list all three allowed capture-condition codes.");
  }
  if (typeof manifest.preprocessVersion !== "string" || !CODE.test(manifest.preprocessVersion)) {
    throw captureError("invalid_pilot_manifest", "The approved manifest must pin a preprocessing version.");
  }
  if (typeof consentCode !== "string" || !manifest.consentCodes.includes(consentCode)) {
    throw captureError("missing_consent", "Choose a consent code from the approved manifest before capture.");
  }
  if (typeof manifest.metricsDisclosureNoticeId !== "string" || !CODE.test(manifest.metricsDisclosureNoticeId)) {
    throw captureError("invalid_pilot_manifest", "The manifest must identify the MediaPipe metrics notice covered by participant consent.");
  }
  if (metricsDisclosureAccepted !== true) {
    throw captureError("missing_media_pipe_metrics_consent", "MediaPipe metrics disclosure must be accepted before its runtime is loaded.");
  }
  const indices = manifest.landmarkIndices;
  if (!indices || !["pose", "leftHand", "rightHand", "face"].every((field) => Array.isArray(indices[field]))) {
    throw captureError("invalid_pilot_manifest", "The approved manifest must specify its minimized landmark layout.");
  }
  for (const field of ["pose", "leftHand", "rightHand", "face"]) {
    const maximumIndex = field === "pose" ? 32 : field === "face" ? 477 : 20;
    if ((field !== "face" && indices[field].length === 0)
      || new Set(indices[field]).size !== indices[field].length
      || indices[field].some((index) => !Number.isInteger(index) || index < 0 || index > maximumIndex)) {
      throw captureError("invalid_pilot_manifest", "The " + field + " landmark layout is invalid.");
    }
  }
  if (indices.face.length > 32) {
    throw captureError("invalid_pilot_manifest", "Face landmarks must be limited to the approved subset (maximum 32).");
  }
}

function pickLandmarks(source, indices = []) {
  return indices.map((index) => Array.isArray(source) ? (source[index] ?? null) : null);
}

function mapHolisticResult(result, indices, timestampMs) {
  return normalizeLandmarkFrame({
    timestampMs,
    pose: pickLandmarks(result.poseLandmarks?.[0], indices.pose),
    leftHand: pickLandmarks(result.leftHandLandmarks?.[0], indices.leftHand),
    rightHand: pickLandmarks(result.rightHandLandmarks?.[0], indices.rightHand),
    face: pickLandmarks(result.faceLandmarks?.[0], indices.face),
  });
}

export async function startCapture({
  videoElement,
  onFrame = () => {},
  onError = () => {},
  shouldProcessFrame = () => false,
  manifest,
  consentCode,
  metricsDisclosureAccepted = false,
  assetManifest,
  mediaDevices = globalThis.navigator?.mediaDevices,
  createLandmarker = createLocalMediaPipeLandmarker,
} = {}) {
  if (activeCapture) throw captureError("capture_already_active", "Camera capture is already active.");
  assertApprovedManifest(manifest, consentCode, metricsDisclosureAccepted);
  if (!videoElement) throw captureError("video_element_required", "A preview element is required.");
  if (typeof shouldProcessFrame !== "function") throw captureError("invalid_capture_option", "shouldProcessFrame must be a function.");
  if (!mediaDevices?.getUserMedia) throw captureError("camera_unavailable", "This browser does not provide a camera.");
  let landmarker;
  let stream;
  try {
    landmarker = await createLandmarker({ assetManifest });
    stream = await mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
    const session = { stream, videoElement, landmarker, requestId: null, previousTimestampMs: -Infinity, lastVideoTime: -1, stopped: false };
    activeCapture = session;
    videoElement.srcObject = stream;
    await videoElement.play();
    const processFrame = async () => {
      if (session.stopped || activeCapture !== session) return;
      try {
        if (shouldProcessFrame() && videoElement.readyState >= 2 && videoElement.currentTime !== session.lastVideoTime) {
          const timestampMs = globalThis.performance.now();
          const result = await landmarker.detectForVideo(videoElement, timestampMs);
          const frame = mapHolisticResult(result, manifest.landmarkIndices, timestampMs);
          if (frame.timestampMs > session.previousTimestampMs) {
            session.previousTimestampMs = frame.timestampMs;
            session.lastVideoTime = videoElement.currentTime;
            onFrame(frame);
          }
        }
        if (!session.stopped) session.requestId = globalThis.requestAnimationFrame(processFrame);
      } catch (error) {
        try { onError(error); } finally { await stopCapture(); }
      }
    };
    session.requestId = globalThis.requestAnimationFrame(processFrame);
    return { stop: stopCapture };
  } catch (error) {
    if (activeCapture?.stream === stream) {
      activeCapture.stopped = true;
      if (activeCapture.requestId != null) globalThis.cancelAnimationFrame?.(activeCapture.requestId);
      activeCapture = null;
    }
    if (stream) {
      try { for (const track of stream.getTracks?.() ?? []) track.stop(); } catch {}
    }
    if (videoElement) {
      try { videoElement.pause?.(); } catch {}
      try { videoElement.srcObject = null; } catch {}
    }
    try { await landmarker?.close?.(); } catch {}
    try { onError(error); } catch {}
    throw error;
  }
}

export async function stopCapture() {
  const session = activeCapture;
  if (!session) return;
  activeCapture = null;
  session.stopped = true;
  if (session.requestId != null) globalThis.cancelAnimationFrame(session.requestId);
  try {
    for (const track of session.stream.getTracks()) {
      try { track.stop(); } catch {}
    }
  } finally {
    try { session.videoElement.pause?.(); } catch {}
    try { session.videoElement.srcObject = null; } catch {}
    try { await session.landmarker.close?.(); } catch {}
  }
}

export function exportLandmarkRecords(records, manifest) {
  const errors = validateLandmarkRecords(records, manifest);
  if (errors.length) throw captureError("dataset_validation_failed", "Records cannot be exported: " + errors.join(", "), errors);
  return records.map((record) => JSON.stringify(record)).join("\n") + "\n";
}

if (typeof globalThis.addEventListener === "function") {
  globalThis.addEventListener("pagehide", () => { void stopCapture(); });
}