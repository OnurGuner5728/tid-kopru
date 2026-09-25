import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { alignGlossEvents } from '../tools/sign_pilot/utterance-annotation.mjs';
import { createUtteranceCapture } from '../tools/sign_pilot/utterance-capture.mjs';

const manifest = {
  approved: true,
  schemaVersion: '2.0',
  signers: ['S01'],
  consentCodes: ['C01'],
  rawVideoConsentCodes: ['V01'],
  approvedGlosses: ['HELLO', 'YOU', 'BROW_RAISE'],
  landmarkIndices: { pose: [0], leftHand: [0], rightHand: [0], face: [0] },
  scopeId: 'PILOT_1',
  preprocessVersion: 'mp-v1',
  captureContractSha256: 'a'.repeat(64),
  conditions: {
    lightingCode: 'indoor',
    distanceCode: 'medium',
    backgroundCode: 'plain',
  },
};
const capturePage = await readFile(new URL('../tools/sign_pilot/utterance-capture.html', import.meta.url), 'utf8');

function makeFakeEnvironment({ playError = null, detectorError = null } = {}) {
  const tracks = [{ stopped: false, stop() { this.stopped = true; } }];
  const stream = { getTracks: () => tracks, addEventListener() {} };
  const mediaDevices = {
    calls: 0,
    async getUserMedia(constraints) {
      this.calls += 1;
      assert.deepEqual(constraints.audio, false);
      return stream;
    },
  };
  const videoElement = {
    currentTime: 0,
    readyState: 2,
    srcObject: null,
    async play() { if (playError) throw playError; },
    pause() {},
  };
  let clock = 1000;
  let landmarkerClosed = 0;
  const landmarker = {
    async detectForVideo() {
      if (detectorError) throw detectorError;
      return {
        poseLandmarks: [{ x: 0.1, y: 0.2, z: 0.3, visibility: 1 }],
        leftHandLandmarks: [],
        rightHandLandmarks: [{ x: 0.4, y: 0.5, z: 0.6, visibility: 1 }],
        faceLandmarks: [{ x: 0.7, y: 0.8, z: 0.9, visibility: 1 }],
      };
    },
    async close() { landmarkerClosed += 1; },
  };
  let nextRequest = 0;
  const callbacks = new Map();
  return {
    tracks,
    stream,
    mediaDevices,
    videoElement,
    landmarker,
    callbacks,
    get landmarkerClosed() { return landmarkerClosed; },
    now: () => clock,
    setClock(value) { clock = value; },
    requestAnimationFrame(callback) { const id = ++nextRequest; callbacks.set(id, callback); return id; },
    cancelAnimationFrame(id) { callbacks.delete(id); },
    async nextFrame(currentTime, timeMs) {
      const [id, callback] = callbacks.entries().next().value ?? [];
      assert.ok(callback, 'a video frame callback should be scheduled');
      callbacks.delete(id);
      this.videoElement.currentTime = currentTime;
      this.setClock(timeMs);
      await callback(timeMs);
    },
  };
}

function recordMetadata(overrides = {}) {
  return {
    utteranceId: 'UTT_0001',
    signerCode: 'S01',
    consentCode: 'C01',
    sampleKind: 'SIGN',
    scopeId: 'PILOT_1',
    fps: 30,
    conditions: { ...manifest.conditions },
    preprocessVersion: 'mp-v1',
    captureContractSha256: manifest.captureContractSha256,
    ...overrides,
  };
}

test('camera is untouched until start and the study notice is required', async () => {
  const fake = makeFakeEnvironment();
  const capture = createUtteranceCapture(fake.mediaDevices, {
    manifest,
    createLandmarker: async () => fake.landmarker,
    now: fake.now,
    requestAnimationFrame: fake.requestAnimationFrame.bind(fake),
    cancelAnimationFrame: fake.cancelAnimationFrame.bind(fake),
  });
  assert.equal(fake.mediaDevices.calls, 0);
  await assert.rejects(capture.start({ videoElement: fake.videoElement, recordMetadata: recordMetadata() }), /study_notice_required/u);
  assert.equal(fake.mediaDevices.calls, 0);
  await capture.dispose();
});

test('research page starts with the camera button disabled and states the MediaPipe measurement notice', () => {
  assert.match(capturePage, /id="start" disabled/u);
  assert.match(capturePage, /id="study-notice" type="checkbox"/u);
  assert.match(capturePage, /kullanım\/performance ölçümü.*Google'a gönderilebilir/isu);
  assert.match(capturePage, /Ham video kaydı varsayılan olarak kapalıdır/u);
});

test('explicit start captures increasing local landmarks and stop releases tracks', async () => {
  const fake = makeFakeEnvironment();
  const capture = createUtteranceCapture(fake.mediaDevices, {
    manifest,
    createLandmarker: async () => fake.landmarker,
    now: fake.now,
    requestAnimationFrame: fake.requestAnimationFrame.bind(fake),
    cancelAnimationFrame: fake.cancelAnimationFrame.bind(fake),
  });
  await capture.start({ studyNoticeConfirmed: true, videoElement: fake.videoElement, recordMetadata: recordMetadata() });
  assert.equal(fake.mediaDevices.calls, 1);
  assert.equal(fake.tracks[0].stopped, false);
  await fake.nextFrame(0, 1000);
  await fake.nextFrame(0.033, 1033);
  const record = await capture.stop();
  assert.deepEqual(record.frames.map((frame) => frame.timestampMs), [0, 33]);
  assert.equal(record.frames[0].pose.length, 3);
  assert.deepEqual(record.frames[0].leftHand, [0, 0, 0]);
  assert.deepEqual(record.frames[0].leftHandVisibility, [0]);
  assert.equal(fake.tracks[0].stopped, true);
  assert.equal(fake.landmarkerClosed, 1);
});

test('camera and landmarker are released when the video preview fails', async () => {
  const fake = makeFakeEnvironment({ playError: new Error('preview failed') });
  const capture = createUtteranceCapture(fake.mediaDevices, {
    manifest,
    createLandmarker: async () => fake.landmarker,
    requestAnimationFrame: fake.requestAnimationFrame.bind(fake),
    cancelAnimationFrame: fake.cancelAnimationFrame.bind(fake),
  });
  await assert.rejects(capture.start({ studyNoticeConfirmed: true, videoElement: fake.videoElement, recordMetadata: recordMetadata() }), /preview failed/u);
  assert.equal(fake.tracks[0].stopped, true);
  assert.equal(fake.landmarkerClosed, 1);
});

test('disposing while local model verification is pending closes the late landmarker without opening the camera', async () => {
  const fake = makeFakeEnvironment();
  let resolveLandmarker;
  const capture = createUtteranceCapture(fake.mediaDevices, {
    manifest,
    createLandmarker: () => new Promise((resolve) => { resolveLandmarker = resolve; }),
    requestAnimationFrame: fake.requestAnimationFrame.bind(fake),
    cancelAnimationFrame: fake.cancelAnimationFrame.bind(fake),
  });
  const starting = capture.start({ studyNoticeConfirmed: true, videoElement: fake.videoElement, recordMetadata: recordMetadata() });
  await Promise.resolve();
  const disposing = capture.dispose();
  resolveLandmarker(fake.landmarker);
  await assert.rejects(starting, /capture_cancelled/u);
  await disposing;
  assert.equal(fake.landmarkerClosed, 1);
  assert.equal(fake.mediaDevices.calls, 0);
});

test('disposing while browser camera permission is pending stops the stream when it arrives', async () => {
  const fake = makeFakeEnvironment();
  let resolveStream;
  fake.mediaDevices.getUserMedia = async () => {
    fake.mediaDevices.calls += 1;
    return new Promise((resolve) => { resolveStream = resolve; });
  };
  const capture = createUtteranceCapture(fake.mediaDevices, {
    manifest,
    createLandmarker: async () => fake.landmarker,
    requestAnimationFrame: fake.requestAnimationFrame.bind(fake),
    cancelAnimationFrame: fake.cancelAnimationFrame.bind(fake),
  });
  const starting = capture.start({ studyNoticeConfirmed: true, videoElement: fake.videoElement, recordMetadata: recordMetadata() });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(fake.mediaDevices.calls, 1);
  const disposing = capture.dispose();
  resolveStream(fake.stream);
  await assert.rejects(starting, /capture_cancelled/u);
  await disposing;
  assert.equal(fake.tracks[0].stopped, true);
});

test('landmarker failures stop every camera track and notify the caller', async () => {
  const fake = makeFakeEnvironment({ detectorError: new Error('inference failed') });
  const reported = [];
  const capture = createUtteranceCapture(fake.mediaDevices, {
    manifest,
    createLandmarker: async () => fake.landmarker,
    requestAnimationFrame: fake.requestAnimationFrame.bind(fake),
    cancelAnimationFrame: fake.cancelAnimationFrame.bind(fake),
  });
  await capture.start({ studyNoticeConfirmed: true, videoElement: fake.videoElement, recordMetadata: recordMetadata(), onError: (error) => reported.push(error.message) });
  await fake.nextFrame(0, 1000);
  assert.deepEqual(reported, ['inference failed']);
  assert.equal(fake.tracks[0].stopped, true);
  assert.equal(fake.landmarkerClosed, 1);
});

test('gloss alignment sorts bounded manual and non-manual events and requires authorized overlap', () => {
  const events = alignGlossEvents([
    { glossId: 'BROW_RAISE', startMs: 50, endMs: 600, channel: 'nonManual', dominantHand: 'none', nonManual: ['brow_raise'], parallelGroup: 'Q1' },
    { glossId: 'YOU', startMs: 100, endMs: 900, channel: 'manual', dominantHand: 'right', nonManual: [], parallelGroup: 'Q1' },
  ], 1000, manifest.approvedGlosses);
  assert.deepEqual(events.map((event) => event.glossId), ['BROW_RAISE', 'YOU']);
  assert.throws(() => alignGlossEvents([
    { glossId: 'YOU', startMs: 0, endMs: 700, channel: 'manual', dominantHand: 'right', nonManual: [] },
    { glossId: 'HELLO', startMs: 500, endMs: 900, channel: 'manual', dominantHand: 'both', nonManual: [] },
  ], 1000, manifest.approvedGlosses), /unauthorized_overlap/u);
  assert.throws(() => alignGlossEvents([
    { glossId: 'YOU', startMs: 0, endMs: 1200, channel: 'manual', dominantHand: 'right', nonManual: [] },
  ], 1000, manifest.approvedGlosses), /invalid_gloss_timing/u);
});

test('JSONL export requires consent and approved glosses and excludes raw video fields', async () => {
  const fake = makeFakeEnvironment();
  const capture = createUtteranceCapture(fake.mediaDevices, {
    manifest,
    createLandmarker: async () => fake.landmarker,
    now: fake.now,
    requestAnimationFrame: fake.requestAnimationFrame.bind(fake),
    cancelAnimationFrame: fake.cancelAnimationFrame.bind(fake),
  });
  await capture.start({ studyNoticeConfirmed: true, videoElement: fake.videoElement, recordMetadata: recordMetadata() });
  await fake.nextFrame(0, 1000);
  await fake.nextFrame(0.033, 1033);
  const record = await capture.stop();
  assert.deepEqual(record.frames.map((frame) => frame.timestampMs), [0, 33]);
  capture.setGlossEvents([{ glossId: 'HELLO', startMs: 0, endMs: 33, channel: 'manual', dominantHand: 'right', nonManual: [] }]);
  const jsonl = capture.exportJsonl();
  assert.equal(JSON.parse(jsonl).glossEvents.length, 1);
  assert.equal(/"(?:video|blob|videoPath)"/u.test(jsonl), false);
  await capture.dispose();

  const invalid = { ...record, consentCode: '', glossEvents: [{ glossId: 'NOT_APPROVED', startMs: 0, endMs: 33, channel: 'manual', dominantHand: 'right', nonManual: [] }] };
  const badCapture = createUtteranceCapture(fake.mediaDevices, { manifest });
  await assert.rejects(Promise.resolve().then(() => badCapture.exportJsonl(invalid)), /missing_consent|unknown_gloss/u);
  await badCapture.dispose();
});

test('raw video recording stays off by default and export requires separately approved consent', async () => {
  const fake = makeFakeEnvironment();
  let recorderCreates = 0;
  const capture = createUtteranceCapture(fake.mediaDevices, {
    manifest,
    createLandmarker: async () => fake.landmarker,
    mediaRecorderFactory: () => { recorderCreates += 1; return {}; },
    requestAnimationFrame: fake.requestAnimationFrame.bind(fake),
    cancelAnimationFrame: fake.cancelAnimationFrame.bind(fake),
  });
  await capture.start({ studyNoticeConfirmed: true, videoElement: fake.videoElement, recordMetadata: recordMetadata() });
  assert.equal(recorderCreates, 0);
  await assert.rejects(capture.exportPrivateResearchVideo(), /raw_video_consent_required/u);
  await capture.dispose();
});

test('separately consented raw video uses a distinct explicit export to the selected private folder', async () => {
  const fake = makeFakeEnvironment();
  const written = [];
  const privateFolder = {
    async getFileHandle(name, options) {
      assert.equal(options.create, true);
      return {
        async createWritable() {
          return {
            async write(blob) { written.push({ name, blob }); },
            async close() {},
          };
        },
      };
    },
  };
  class FakeRecorder {
    state = 'inactive';
    listeners = new Map();
    addEventListener(type, callback) {
      const listeners = this.listeners.get(type) ?? [];
      listeners.push(callback);
      this.listeners.set(type, listeners);
    }
    start() { this.state = 'recording'; }
    stop() {
      this.state = 'inactive';
      for (const callback of this.listeners.get('dataavailable') ?? []) callback({ data: new Blob(['private clip']) });
      for (const callback of this.listeners.get('stop') ?? []) callback();
    }
  }
  const capture = createUtteranceCapture(fake.mediaDevices, {
    manifest,
    createLandmarker: async () => fake.landmarker,
    mediaRecorderFactory: () => new FakeRecorder(),
    randomUUID: () => 'opaque-file-id',
    requestAnimationFrame: fake.requestAnimationFrame.bind(fake),
    cancelAnimationFrame: fake.cancelAnimationFrame.bind(fake),
  });
  await capture.start({
    studyNoticeConfirmed: true,
    videoElement: fake.videoElement,
    recordMetadata: recordMetadata(),
    rawVideoConsentVerified: true,
    rawVideoConsentCode: 'V01',
    privateStudyFolderHandle: privateFolder,
  });
  await capture.stop();
  const fileName = await capture.exportPrivateResearchVideo();
  assert.equal(fileName, 'tid-utterance-opaque-file-id.webm');
  assert.equal(written.length, 1);
  assert.equal(written[0].blob.size > 0, true);
  assert.equal(fake.tracks[0].stopped, true);
  await assert.rejects(capture.exportPrivateResearchVideo(), /raw_video_consent_required/u);
  await capture.dispose();
});

test('dispose closes active tracks and deletes buffered clip data', async () => {
  const fake = makeFakeEnvironment();
  const capture = createUtteranceCapture(fake.mediaDevices, {
    manifest,
    createLandmarker: async () => fake.landmarker,
    requestAnimationFrame: fake.requestAnimationFrame.bind(fake),
    cancelAnimationFrame: fake.cancelAnimationFrame.bind(fake),
  });
  await capture.start({ studyNoticeConfirmed: true, videoElement: fake.videoElement, recordMetadata: recordMetadata() });
  await fake.nextFrame(0, 1000);
  await capture.dispose();
  assert.equal(fake.tracks[0].stopped, true);
  assert.equal(capture.currentRecord, null);
  assert.equal(fake.landmarkerClosed, 1);
});
