import { createLocalMediaPipeLandmarker } from './mediapipe-loader.mjs';
import { normalizeLandmarkFrame } from './capture.mjs';
import { exportPrivateResearchVideo as writePrivateResearchVideo, exportUtterance, alignGlossEvents } from './utterance-annotation.mjs';

function captureError(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function validCode(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(value);
}

export function stopEveryTrack(stream) {
  for (const track of stream?.getTracks?.() ?? []) {
    try { track.stop(); } catch {}
  }
}

function finitePoint(point) {
  if (!point || typeof point !== 'object') return null;
  const values = [point.x, point.y, point.z];
  if (!values.every((value) => typeof value === 'number' && Number.isFinite(value))) return null;
  return {
    x: values[0], y: values[1], z: values[2],
    visibility: typeof point.visibility === 'number' ? point.visibility : 1,
  };
}

function indexedLandmarks(points, indices) {
  const source = Array.isArray(points) ? points : [];
  const selected = Array.isArray(indices) ? indices : [];
  return selected.map((index) => finitePoint(source[index]));
}

export function mapUtteranceLandmarks(result, landmarkIndices, timestampMs, previousTimestampMs) {
  if (!landmarkIndices || typeof landmarkIndices !== 'object') {
    throw captureError('invalid_landmark_manifest');
  }
  return normalizeLandmarkFrame({
    timestampMs,
    pose: indexedLandmarks(result?.poseLandmarks, landmarkIndices.pose),
    leftHand: indexedLandmarks(result?.leftHandLandmarks, landmarkIndices.leftHand),
    rightHand: indexedLandmarks(result?.rightHandLandmarks, landmarkIndices.rightHand),
    face: indexedLandmarks(result?.faceLandmarks, landmarkIndices.face),
  }, { previousTimestampMs });
}

function assertApprovedCapture(manifest, recordMetadata) {
  if (!manifest || manifest.approved !== true || manifest.schemaVersion !== '2.0') {
    throw captureError('capture_requires_approved_manifest', 'An advisor-approved utterance manifest is required.');
  }
  if (!recordMetadata || typeof recordMetadata !== 'object') throw captureError('record_metadata_required');
  if (!Array.isArray(manifest.signers) || !manifest.signers.includes(recordMetadata.signerCode)) {
    throw captureError('unknown_signer');
  }
  if (!Array.isArray(manifest.consentCodes) || !manifest.consentCodes.includes(recordMetadata.consentCode)) {
    throw captureError('missing_consent');
  }
  if (recordMetadata.scopeId !== manifest.scopeId) throw captureError('invalid_scope');
  if (recordMetadata.preprocessVersion !== manifest.preprocessVersion) throw captureError('preprocess_version_mismatch');
  if (recordMetadata.captureContractSha256 !== manifest.captureContractSha256) throw captureError('invalid_capture_contract');
  const metadataFields = new Set(['utteranceId', 'signerCode', 'consentCode', 'scopeId', 'fps', 'conditions', 'preprocessVersion', 'captureContractSha256']);
  if (Object.keys(recordMetadata).some((key) => !metadataFields.has(key))) throw captureError('unknown_field');
  if (!validCode(recordMetadata.utteranceId) || !validCode(recordMetadata.signerCode)
    || !validCode(recordMetadata.consentCode) || !validCode(recordMetadata.scopeId)
    || !validCode(recordMetadata.preprocessVersion)) throw captureError('invalid_record_metadata');
  if (typeof recordMetadata.fps !== 'number' || !Number.isFinite(recordMetadata.fps) || recordMetadata.fps <= 0 || recordMetadata.fps > 120) {
    throw captureError('invalid_record_metadata');
  }
  const conditionFields = ['lightingCode', 'distanceCode', 'backgroundCode'];
  if (!recordMetadata.conditions || typeof recordMetadata.conditions !== 'object' || Array.isArray(recordMetadata.conditions)
    || Object.keys(recordMetadata.conditions).length !== conditionFields.length
    || conditionFields.some((field) => {
      const selected = recordMetadata.conditions[field];
      const allowed = manifest.conditions?.[field];
      return !validCode(selected) || !(Array.isArray(allowed) ? allowed.includes(selected) : selected === allowed);
    })) throw captureError('invalid_conditions');
  if (!Array.isArray(manifest.approvedGlosses) || !manifest.approvedGlosses.length) {
    throw captureError('approved_glosses_required');
  }
  const indices = manifest.landmarkIndices;
  if (!indices || ['pose', 'leftHand', 'rightHand', 'face'].some((group) => !Array.isArray(indices[group]) || !indices[group].length
    || indices[group].some((index) => !Number.isInteger(index) || index < 0))) {
    throw captureError('invalid_landmark_manifest');
  }
}

function createPrivateRecorder(stream, factory) {
  if (typeof factory !== 'function') throw captureError('raw_video_unavailable');
  return factory(stream);
}

function stopRecorder(recorder) {
  if (!recorder || recorder.state === 'inactive') return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    let timeoutId;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (timeoutId != null) globalThis.clearTimeout?.(timeoutId);
      resolve();
    };
    if (typeof recorder.addEventListener === 'function') recorder.addEventListener('stop', finish, { once: true });
    else recorder.onstop = finish;
    try { recorder.stop(); } catch { finish(); }
    // Some test doubles and older implementations do not dispatch a stop event.
    timeoutId = globalThis.setTimeout?.(finish, 1000);
  });
}

export async function startPrivateResearchRecorder(stream, privateStudyFolderHandle, {
  rawVideoConsentVerified = false,
  mediaRecorderFactory = (activeStream) => {
    if (typeof globalThis.MediaRecorder !== 'function') throw captureError('raw_video_unavailable');
    return new globalThis.MediaRecorder(activeStream);
  },
} = {}) {
  if (rawVideoConsentVerified !== true) throw captureError('raw_video_consent_required');
  if (!privateStudyFolderHandle || typeof privateStudyFolderHandle.getFileHandle !== 'function') {
    throw captureError('private_study_folder_required');
  }
  const recorder = createPrivateRecorder(stream, mediaRecorderFactory);
  if (!recorder || typeof recorder.start !== 'function' || typeof recorder.stop !== 'function') {
    throw captureError('raw_video_unavailable');
  }
  recorder.start();
  return recorder;
}

export async function exportPrivateResearchVideo(privateStudyFolderHandle, chunks, {
  rawVideoConsentVerified = false,
  randomUUID = () => globalThis.crypto?.randomUUID?.(),
  createBlob = (parts) => new Blob(parts, { type: 'video/webm' }),
} = {}) {
  if (rawVideoConsentVerified !== true) throw captureError('raw_video_consent_required');
  if (!privateStudyFolderHandle || typeof privateStudyFolderHandle.getFileHandle !== 'function') {
    throw captureError('private_study_folder_required');
  }
  if (!Array.isArray(chunks) || chunks.length === 0) throw captureError('raw_video_missing');
  const id = randomUUID();
  if (typeof id !== 'string' || !id) throw captureError('secure_random_unavailable');
  const fileHandle = await privateStudyFolderHandle.getFileHandle(`tid-utterance-${id}.webm`, { create: true });
  const writable = await fileHandle.createWritable();
  try {
    await writable.write(createBlob(chunks));
    await writable.close();
  } catch (error) {
    try { await writable.abort?.(); } catch {}
    throw error;
  }
  chunks.splice(0, chunks.length);
  return `tid-utterance-${id}.webm`;
}

function defaultMediaRecorderFactory(stream) {
  if (typeof globalThis.MediaRecorder !== 'function') throw captureError('raw_video_unavailable');
  return new globalThis.MediaRecorder(stream);
}

export function createUtteranceCapture(mediaDevices = globalThis.navigator?.mediaDevices, dependencies = {}) {
  const manifest = dependencies.manifest;
  const assetManifest = dependencies.assetManifest;
  const createLandmarker = dependencies.createLandmarker ?? createLocalMediaPipeLandmarker;
  const now = dependencies.now ?? (() => globalThis.performance?.now?.() ?? Date.now());
  const requestFrame = dependencies.requestAnimationFrame ?? globalThis.requestAnimationFrame?.bind(globalThis);
  const cancelFrame = dependencies.cancelAnimationFrame ?? globalThis.cancelAnimationFrame?.bind(globalThis);
  const mediaRecorderFactory = dependencies.mediaRecorderFactory ?? defaultMediaRecorderFactory;
  let session = null;
  let disposed = false;
  let currentRecord = null;
  let researchVideoChunks = [];
  let researchVideoConsent = false;
  let researchVideoFolderHandle = null;
  let pageHideHandler = null;

  function clearPreview(active) {
    const video = active?.videoElement;
    if (video && video.srcObject === active.stream) {
      try { video.pause?.(); } catch {}
      try { video.srcObject = null; } catch {}
    }
  }

  async function closeLandmarker(active) {
    if (!active?.landmarker || active.landmarkerClosed) return;
    active.landmarkerClosed = true;
    try { await active.landmarker.close?.(); } catch {}
  }

  async function disposeActive({ keepRecord = false } = {}) {
    const active = session;
    if (!active) return currentRecord;
    active.stopped = true;
    if (active.requestId != null) {
      try { cancelFrame?.(active.requestId); } catch {}
      active.requestId = null;
    }
    stopEveryTrack(active.stream);
    clearPreview(active);
    await active.processing?.catch?.(() => {});
    await stopRecorder(active.recorder);
    await closeLandmarker(active);
    active.stream = null;
    active.landmarker = null;
    if (session === active) session = null;
    if (keepRecord) {
      currentRecord = {
        ...active.recordMetadata,
        schemaVersion: 2,
        frames: active.frames,
        glossEvents: [],
      };
      return currentRecord;
    }
    active.frames.length = 0;
    researchVideoChunks.length = 0;
    researchVideoConsent = false;
    researchVideoFolderHandle = null;
    currentRecord = null;
    return null;
  }

  async function failSession(active, error) {
    if (session !== active || active.stopped) return;
    active.failure = error;
    await disposeActive({ keepRecord: false });
    try { active.onError?.(error); } catch {}
  }

  function watchStream(active) {
    const reportEnded = () => {
      if (session === active && !active.stopped) void failSession(active, captureError('camera_stream_ended'));
    };
    active.stream.addEventListener?.('inactive', reportEnded, { once: true });
    for (const track of active.stream.getTracks?.() ?? []) track.addEventListener?.('ended', reportEnded, { once: true });
  }

  async function collectLandmarkSequence(active) {
    if (typeof requestFrame !== 'function') throw captureError('animation_frame_unavailable');
      const processFrame = async () => {
      if (session !== active || active.stopped) return;
      try {
        const video = active.videoElement;
        if (video.readyState >= 2 && video.currentTime !== active.lastVideoTime) {
          active.lastVideoTime = video.currentTime;
          const clockMs = now();
          const processing = active.landmarker.detectForVideo(video, clockMs);
          active.processing = Promise.resolve(processing);
          const result = await active.processing;
          active.processing = null;
          if (session !== active || active.stopped) return;
          const relativeTime = Math.max(0, clockMs - active.startedAt);
          if (relativeTime > active.previousTimestampMs) {
            const frame = mapUtteranceLandmarks(result, manifest.landmarkIndices, relativeTime, active.previousTimestampMs);
            active.previousTimestampMs = frame.timestampMs;
            active.frames.push(frame);
            try { active.onFrame?.(frame); } catch {}
          }
        }
        if (session === active && !active.stopped) active.requestId = requestFrame(processFrame);
      } catch (error) {
        await failSession(active, error);
      }
    };
    active.requestId = requestFrame(processFrame);
  }

  async function start({
    studyNoticeConfirmed = false,
    videoElement,
    onFrame = () => {},
    onError = () => {},
    recordMetadata,
    rawVideoConsentVerified = false,
    rawVideoConsentCode,
    privateStudyFolderHandle,
  } = {}) {
    if (disposed) throw captureError('capture_disposed');
    if (session) throw captureError('capture_already_active');
    if (studyNoticeConfirmed !== true) throw captureError('study_notice_required');
    assertApprovedCapture(manifest, recordMetadata);
    if (!videoElement) throw captureError('video_element_required');
    if (!mediaDevices?.getUserMedia) throw captureError('camera_unavailable');
    if (typeof onFrame !== 'function' || typeof onError !== 'function') throw captureError('invalid_capture_callbacks');

    if (rawVideoConsentVerified === true) {
      if (!Array.isArray(manifest.rawVideoConsentCodes) || !manifest.rawVideoConsentCodes.includes(rawVideoConsentCode)) {
        throw captureError('raw_video_consent_required');
      }
      if (!privateStudyFolderHandle || typeof privateStudyFolderHandle.getFileHandle !== 'function') {
        throw captureError('private_study_folder_required');
      }
    } else if (rawVideoConsentCode != null || privateStudyFolderHandle != null) {
      throw captureError('raw_video_consent_required');
    }

    const active = {
      videoElement, onFrame, onError, recordMetadata: { ...recordMetadata },
      stream: null, landmarker: null, landmarkerClosed: false, recorder: null,
      frames: [], stopped: false, requestId: null,
      lastVideoTime: -1, startedAt: 0, previousTimestampMs: -Infinity, processing: null,
      rawVideoConsentVerified: rawVideoConsentVerified === true,
    };
    session = active;
    try {
      // Verify local model/runtime hashes before requesting camera permission.
      const landmarker = await createLandmarker({ assetManifest });
      if (session !== active || active.stopped) {
        try { await landmarker?.close?.(); } catch {}
        throw captureError('capture_cancelled');
      }
      active.landmarker = landmarker;

      active.stream = await mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      if (session !== active || active.stopped) {
        stopEveryTrack(active.stream);
        throw captureError('capture_cancelled');
      }
      if (active.stream.getAudioTracks?.().length) throw captureError('unexpected_audio_track');
      watchStream(active);
      if (active.rawVideoConsentVerified) {
        active.recorder = await startPrivateResearchRecorder(active.stream, privateStudyFolderHandle, {
          rawVideoConsentVerified: true,
          mediaRecorderFactory,
        });
        researchVideoConsent = true;
        researchVideoFolderHandle = privateStudyFolderHandle;
        active.recorder.addEventListener?.('dataavailable', (event) => {
          if (event.data?.size > 0) researchVideoChunks.push(event.data);
        });
      }
      videoElement.srcObject = active.stream;
      await videoElement.play?.();
      if (session !== active || active.stopped) throw captureError('capture_cancelled');
      active.startedAt = now();
      await collectLandmarkSequence(active);
      return { stop, dispose };
    } catch (error) {
      await disposeActive({ keepRecord: false });
      throw error;
    }
  }

  async function stop() {
    if (!session) return currentRecord;
    const active = session;
    await disposeActive({ keepRecord: true });
    return currentRecord;
  }

  function setGlossEvents(events) {
    if (!currentRecord) throw captureError('utterance_not_stopped');
    const duration = currentRecord.frames.length >= 2
      ? currentRecord.frames.at(-1).timestampMs - currentRecord.frames[0].timestampMs
      : 0;
    currentRecord.glossEvents = alignGlossEvents(events, duration, manifest.approvedGlosses);
    return currentRecord.glossEvents;
  }

  function exportJsonl(record = currentRecord) {
    if (!record) throw captureError('utterance_not_stopped');
    return exportUtterance(record, manifest);
  }

  async function exportPrivateVideo() {
    if (!researchVideoConsent) {
      throw captureError('raw_video_consent_required');
    }
    const fileName = await writePrivateResearchVideo(researchVideoFolderHandle, researchVideoChunks, {
      rawVideoConsentVerified: researchVideoConsent,
      randomUUID: dependencies.randomUUID,
      createBlob: dependencies.createBlob,
    });
    researchVideoConsent = false;
    researchVideoFolderHandle = null;
    return fileName;
  }

  async function dispose() {
    disposed = true;
    await disposeActive({ keepRecord: false });
    if (pageHideHandler && typeof globalThis.removeEventListener === 'function') {
      globalThis.removeEventListener('pagehide', pageHideHandler);
      pageHideHandler = null;
    }
  }

  if (typeof globalThis.addEventListener === 'function') {
    pageHideHandler = () => { void dispose(); };
    globalThis.addEventListener('pagehide', pageHideHandler, { once: true });
  }

  return {
    start,
    stop,
    setGlossEvents,
    exportJsonl,
    exportPrivateResearchVideo: exportPrivateVideo,
    dispose,
    get currentRecord() { return currentRecord; },
  };
}

function mountUtteranceCapturePage(documentObject = globalThis.document) {
  if (!documentObject?.getElementById?.('study-manifest')) return;
  const $ = (id) => documentObject.getElementById(id);
  const status = $('status');
  const controls = {
    notice: $('study-notice'), manifestFile: $('study-manifest'), assetsFile: $('asset-manifest'),
    signer: $('signer'), consent: $('consent'), lighting: $('lighting'), distance: $('distance'),
    background: $('background'), video: $('preview'), start: $('start'), stop: $('stop'),
    remove: $('delete'), gloss: $('gloss-events'), align: $('align'), export: $('export'),
  };
  let studyManifest = null;
  let assetManifest = null;
  let capture = null;
  let isCapturing = false;
  let hasRecord = false;

  function setStatus(message) { status.textContent = message; }
  function optionValues(value) { return Array.isArray(value) ? value : typeof value === 'string' ? [value] : []; }
  function fillSelect(select, values) {
    select.replaceChildren(new Option('Seçin', ''));
    for (const value of values) select.add(new Option(value, value));
    select.disabled = values.length === 0;
  }
  function refreshControls() {
    const prepared = studyManifest?.approved === true && assetManifest != null;
    const selections = [controls.signer, controls.consent, controls.lighting, controls.distance, controls.background]
      .every((select) => Boolean(select.value));
    controls.start.disabled = !prepared || !controls.notice.checked || !selections || isCapturing;
    controls.stop.disabled = !isCapturing;
    controls.align.disabled = !hasRecord || isCapturing;
    controls.export.disabled = !hasRecord || isCapturing;
    controls.remove.disabled = !hasRecord && !isCapturing;
  }
  function createController() {
    capture = createUtteranceCapture(globalThis.navigator?.mediaDevices, {
      manifest: studyManifest,
      assetManifest,
    });
    return capture;
  }
  async function readJsonFile(fileInput) {
    const file = fileInput.files?.[0];
    if (!file) return null;
    return JSON.parse(await file.text());
  }
  function loadSelections() {
    fillSelect(controls.signer, optionValues(studyManifest?.signers));
    fillSelect(controls.consent, optionValues(studyManifest?.consentCodes));
    fillSelect(controls.lighting, optionValues(studyManifest?.conditions?.lightingCode));
    fillSelect(controls.distance, optionValues(studyManifest?.conditions?.distanceCode));
    fillSelect(controls.background, optionValues(studyManifest?.conditions?.backgroundCode));
  }
  async function readSetup() {
    try {
      const [nextManifest, nextAssets] = await Promise.all([
        readJsonFile(controls.manifestFile), readJsonFile(controls.assetsFile),
      ]);
      if (!nextManifest || !nextAssets) {
        studyManifest = null;
        assetManifest = null;
        setStatus('Kamera kapalı. Onaylı çalışma manifestosu ve yerel model/runtime bekleniyor.');
        refreshControls();
        return;
      }
      if (nextManifest.approved !== true || nextManifest.schemaVersion !== '2.0') {
        throw captureError('capture_requires_approved_manifest', 'Bu çalışma manifestosu TİD danışmanı tarafından onaylanmış sürüm 2.0 değil.');
      }
      if (!Array.isArray(nextManifest.signers) || !Array.isArray(nextManifest.consentCodes)
        || !Array.isArray(nextManifest.approvedGlosses) || !nextManifest.scopeId) {
        throw captureError('invalid_approved_manifest', 'Çalışma manifestosunda işaretçi, onam, gloss veya kapsam listesi eksik.');
      }
      studyManifest = nextManifest;
      assetManifest = nextAssets;
      loadSelections();
      if (capture) await capture.dispose();
      capture = null;
      hasRecord = false;
      setStatus("Onaylı yapılandırma yüklendi. Hash değerleri doğrulanmadan kamera açılmaz.");
    } catch (error) {
      studyManifest = null;
      assetManifest = null;
      loadSelections();
      setStatus('Yerel kurulum reddedildi: ' + (error.code ?? error.message));
    }
    refreshControls();
  }

  controls.manifestFile.addEventListener('change', () => { void readSetup(); });
  controls.assetsFile.addEventListener('change', () => { void readSetup(); });
  controls.notice.addEventListener('change', refreshControls);
  for (const select of [controls.signer, controls.consent, controls.lighting, controls.distance, controls.background]) {
    select.addEventListener('change', refreshControls);
  }
  controls.start.addEventListener('click', async () => {
    if (controls.start.disabled) return;
    try {
      const activeCapture = capture ?? createController();
      isCapturing = true;
      refreshControls();
      setStatus('Önce aynı-kaynak MediaPipe dosyalarının hash değerleri doğrulanıyor.');
      await activeCapture.start({
        studyNoticeConfirmed: controls.notice.checked,
        videoElement: controls.video,
        onFrame: () => setStatus('Tek ifade için landmarklar bellekte işleniyor; ham video kaydı kapalı.'),
        onError: (error) => {
          isCapturing = false;
          setStatus('Kayıt durdu: ' + (error.code ?? error.message));
          refreshControls();
        },
        recordMetadata: {
          utteranceId: globalThis.crypto?.randomUUID?.().replaceAll('-', '') ?? `UTT_${Date.now()}`,
          signerCode: controls.signer.value,
          consentCode: controls.consent.value,
          scopeId: studyManifest.scopeId,
          fps: studyManifest.fps ?? 30,
          conditions: {
            lightingCode: controls.lighting.value,
            distanceCode: controls.distance.value,
            backgroundCode: controls.background.value,
          },
          preprocessVersion: studyManifest.preprocessVersion,
          captureContractSha256: studyManifest.captureContractSha256,
        },
      });
      setStatus('Kamera açık. İfadeyi bitirdiğinizde düğmeye basın.');
    } catch (error) {
      isCapturing = false;
      setStatus('Kamera açılamadı: ' + (error.code ?? error.message));
    }
    refreshControls();
  });
  controls.stop.addEventListener('click', async () => {
    try {
      await capture?.stop();
      hasRecord = Boolean(capture?.currentRecord);
      isCapturing = false;
      setStatus(hasRecord ? 'İfade landmarkları bellekte. Danışman onaylı gloss zaman çizelgesini ekleyin.' : 'Kayıt tamamlanmadı.');
    } catch (error) {
      setStatus('Kayıt durdurulamadı: ' + (error.code ?? error.message));
    }
    refreshControls();
  });
  controls.align.addEventListener('click', () => {
    try {
      const events = JSON.parse(controls.gloss.value);
      const aligned = capture.setGlossEvents(events);
      controls.gloss.value = JSON.stringify(aligned, null, 2);
      setStatus('Gloss zaman çizelgesi doğrulandı. JSONL dışa aktarmadan önce insan onayını ayrıca kontrol edin.');
    } catch (error) {
      setStatus('Glosslar doğrulanmadı: ' + (error.code ?? error.message));
    }
  });
  controls.export.addEventListener('click', () => {
    try {
      const jsonl = capture.exportJsonl();
      const url = URL.createObjectURL(new Blob([jsonl], { type: 'application/x-ndjson' }));
      const link = documentObject.createElement('a');
      link.href = url;
      link.download = `${capture.currentRecord.utteranceId}.jsonl`;
      link.click();
      globalThis.setTimeout(() => URL.revokeObjectURL(url), 0);
      setStatus('Onaylı yapılandırmaya göre doğrulanmış landmark ve gloss JSONL indirildi.');
    } catch (error) {
      setStatus('Dışa aktarma reddedildi: ' + (error.code ?? error.message));
    }
  });
  controls.remove.addEventListener('click', async () => {
    await capture?.dispose();
    capture = null;
    hasRecord = false;
    isCapturing = false;
    controls.gloss.value = '';
    controls.video.srcObject = null;
    setStatus('Oturum landmarkları ve bellekteki video verisi silindi. Kamera izleri kapatıldı.');
    refreshControls();
  });
  refreshControls();
}

if (typeof globalThis.document !== 'undefined') mountUtteranceCapturePage();
