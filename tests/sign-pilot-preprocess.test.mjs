import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  exportLandmarkRecords,
  normalizeLandmarkFrame,
} from "../tools/sign_pilot/capture.mjs";

const point = (x, y, z, visibility = 1) => ({ x, y, z, visibility });

function validRecord() {
  return {
    schemaVersion: "1.1",
    captureId: "1".repeat(32),
    captureContractSha256: "a".repeat(64),
    signerCode: "S01",
    consentCode: "C01",
    signId: "SIGN_A",
    repetition: 1,
    conditions: {
      lightingCode: "L1",
      distanceCode: "D1",
      backgroundCode: "B1",
    },
    fps: 30,
    frames: [
      {
        timestampMs: 0,
        pose: [0.1, 0.2, 0.3],
        poseVisibility: [1],
        leftHand: [0, 0, 0],
        leftHandVisibility: [0],
        rightHand: [0.4, 0.5, 0.6],
        rightHandVisibility: [1],
        face: [],
        faceVisibility: [],
      },
    ],
    preprocessVersion: "v1",
  };
}

const manifest = { signers: ["S01"], allowedSigns: ["SIGN_A"], conditions: { lighting: ["L1"], distance: ["D1"], background: ["B1"] } };

test("normalizes finite landmarks and fills missing points with zeros and a false mask", () => {
  const frame = normalizeLandmarkFrame({
    timestampMs: 25,
    pose: [point(0.1, 0.2, 0.3), null],
    leftHand: [],
    rightHand: [point(0.4, 0.5, 0.6, 0)],
    face: [],
  });

  assert.deepEqual(frame.pose, [0.1, 0.2, 0.3, 0, 0, 0]);
  assert.deepEqual(frame.poseVisibility, [1, 0]);
  assert.deepEqual(frame.rightHandVisibility, [0]);
  assert.equal(frame.timestampMs, 25);
});

test("requires strictly increasing finite timestamps", () => {
  assert.throws(
    () => normalizeLandmarkFrame({ timestampMs: 10 }, { previousTimestampMs: 10 }),
    (error) => error.code === "invalid_timestamp",
  );
  assert.throws(
    () => normalizeLandmarkFrame({ timestampMs: Number.NaN }),
    (error) => error.code === "invalid_timestamp",
  );
});

test("rejects non-finite landmark coordinates instead of exporting them", () => {
  assert.throws(
    () => normalizeLandmarkFrame({ timestampMs: 1, pose: [point(Infinity, 0, 0)] }),
    (error) => error.code === "invalid_coordinate",
  );
});

test("refuses records without consent and records with unapproved signs", () => {
  const withoutConsent = validRecord();
  delete withoutConsent.consentCode;
  assert.throws(
    () => exportLandmarkRecords([withoutConsent], manifest),
    (error) => error.codes.includes("missing_consent"),
  );

  const unknownSign = { ...validRecord(), signId: "SIGN_NOT_APPROVED" };
  assert.throws(
    () => exportLandmarkRecords([unknownSign], manifest),
    (error) => error.codes.includes("unknown_sign"),
  );
});

test("exports newline-delimited records only after validation and never accepts raw media fields", () => {
  const jsonl = exportLandmarkRecords([validRecord()], manifest);
  assert.deepEqual(JSON.parse(jsonl.trim()), validRecord());

  for (const field of ["video", "blob", "videoPath"]) {
    const unsafeRecord = { ...validRecord(), [field]: "sensitive payload" };
    assert.throws(
      () => exportLandmarkRecords([unsafeRecord], manifest),
      (error) => error.codes.includes("personal_data_field"),
    );
  }
});
test("does not request a camera before the approved MediaPipe metrics notice is accepted", async () => {
  let cameraRequests = 0;
  let modelLoads = 0;
  const approvedManifest = {
    schemaVersion: "1.0",
    approved: true,
    signers: ["S01"],
    allowedSigns: ["SIGN_A"],
    consentCodes: ["C01"],
    conditions: { lighting: ["L1"], distance: ["D1"], background: ["B1"] },
    preprocessVersion: "v1",
    metricsDisclosureNoticeId: "MP-METRICS-2026-04",
    captureContractSha256: "a".repeat(64),
    landmarkIndices: { pose: [11], leftHand: [0], rightHand: [0], face: [] },
  };
  await assert.rejects(
    () => import("../tools/sign_pilot/capture.mjs").then(({ startCapture }) => startCapture({
      videoElement: {},
      manifest: approvedManifest,
      consentCode: "C01",
      metricsDisclosureAccepted: false,
      createLandmarker: async () => { modelLoads += 1; return {}; },
      mediaDevices: { getUserMedia: async () => { cameraRequests += 1; return {}; } },
    })),
    (error) => error.code === "missing_media_pipe_metrics_consent",
  );
  assert.equal(modelLoads, 0);
  assert.equal(cameraRequests, 0);
});

test("stopCapture releases every fake camera track and closes its landmarker", async () => {
  const tracks = [
    { stopped: false, stop() { this.stopped = true; } },
    { stopped: false, stop() { this.stopped = true; } },
  ];
  let landmarkerClosed = false;
  const priorRequestAnimationFrame = globalThis.requestAnimationFrame;
  const priorCancelAnimationFrame = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = () => 77;
  globalThis.cancelAnimationFrame = () => {};
  const videoElement = {
    readyState: 0,
    currentTime: 0,
    srcObject: null,
    play: async () => {},
    pause() {},
  };
  try {
    const { startCapture, stopCapture } = await import("../tools/sign_pilot/capture.mjs");
    await startCapture({
      videoElement,
      manifest: {
        schemaVersion: "1.0",
        approved: true,
        signers: ["S01"],
        allowedSigns: ["SIGN_A"],
        consentCodes: ["C01"],
        conditions: { lighting: ["L1"], distance: ["D1"], background: ["B1"] },
        preprocessVersion: "v1",
        metricsDisclosureNoticeId: "MP-METRICS-2026-04",
        captureContractSha256: "a".repeat(64),
        landmarkIndices: { pose: [11], leftHand: [0], rightHand: [0], face: [] },
      },
      consentCode: "C01",
      metricsDisclosureAccepted: true,
      createLandmarker: async () => ({ detectForVideo() {}, close() { landmarkerClosed = true; } }),
      mediaDevices: {
        getUserMedia: async (constraints) => {
          assert.equal(constraints.audio, false);
          return { getTracks: () => tracks };
        },
      },
    });
    await stopCapture();
  } finally {
    if (priorRequestAnimationFrame === undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame = priorRequestAnimationFrame;
    if (priorCancelAnimationFrame === undefined) delete globalThis.cancelAnimationFrame;
    else globalThis.cancelAnimationFrame = priorCancelAnimationFrame;
  }
  assert.deepEqual(tracks.map((track) => track.stopped), [true, true]);
  assert.equal(landmarkerClosed, true);
  assert.equal(videoElement.srcObject, null);
});

test("stopCapture cancels a pending camera prompt and releases a stream granted afterward", async () => {
  const { startCapture, stopCapture } = await import("../tools/sign_pilot/capture.mjs");
  const manifest = {
    schemaVersion: "1.0", approved: true, signers: ["S01"], allowedSigns: ["SIGN_A"], consentCodes: ["C01"],
    conditions: { lighting: ["L1"], distance: ["D1"], background: ["B1"] }, preprocessVersion: "v1",
    metricsDisclosureNoticeId: "MP-METRICS-2026-04",
    captureContractSha256: "a".repeat(64),
    landmarkIndices: { pose: [11], leftHand: [0], rightHand: [0], face: [] },
  };
  let resolvePermission;
  let permissionRequested;
  const permissionStarted = new Promise((resolve) => { permissionRequested = resolve; });
  const permissionResult = new Promise((resolve) => { resolvePermission = resolve; });
  let trackStopped = false;
  let landmarkerClosed = false;
  let rafCallback;
  const videoElement = {
    readyState: 0, currentTime: 0, srcObject: null,
    play: async () => {}, pause() {},
  };
  const priorRequestAnimationFrame = globalThis.requestAnimationFrame;
  const priorCancelAnimationFrame = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = (callback) => { rafCallback = callback; return 91; };
  globalThis.cancelAnimationFrame = () => {};
  const pendingStart = startCapture({
    videoElement,
    manifest,
    consentCode: "C01",
    metricsDisclosureAccepted: true,
    createLandmarker: async () => ({ detectForVideo() {}, close() { landmarkerClosed = true; } }),
    mediaDevices: {
      getUserMedia: () => {
        permissionRequested();
        return permissionResult;
      },
    },
  }).then(() => null, (error) => error);

  try {
    await permissionStarted;
    const concurrentStartError = await startCapture({
      videoElement,
      manifest,
      consentCode: "C01",
      metricsDisclosureAccepted: true,
      createLandmarker: async () => ({ close() {} }),
      mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) },
    }).then(() => null, (error) => error);
    assert.equal(concurrentStartError?.code, "capture_already_active");

    await stopCapture();
    resolvePermission({ getTracks: () => [{ stop() { trackStopped = true; } }] });
    const startError = await pendingStart;
    assert.equal(startError?.code, "capture_cancelled");
    assert.equal(trackStopped, true);
    assert.equal(landmarkerClosed, true);
    assert.equal(videoElement.srcObject, null);
    assert.equal(typeof rafCallback, "undefined");
  } finally {
    resolvePermission({ getTracks: () => [{ stop() { trackStopped = true; } }] });
    await pendingStart;
    await stopCapture();
    if (priorRequestAnimationFrame === undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame = priorRequestAnimationFrame;
    if (priorCancelAnimationFrame === undefined) delete globalThis.cancelAnimationFrame;
    else globalThis.cancelAnimationFrame = priorCancelAnimationFrame;
  }
});

test("an unexpectedly ended camera stream is cleaned up and reported", async () => {
  const { startCapture, stopCapture } = await import("../tools/sign_pilot/capture.mjs");
  const manifest = {
    schemaVersion: "1.0", approved: true, signers: ["S01"], allowedSigns: ["SIGN_A"], consentCodes: ["C01"],
    conditions: { lighting: ["L1"], distance: ["D1"], background: ["B1"] }, preprocessVersion: "v1",
    metricsDisclosureNoticeId: "MP-METRICS-2026-04",
    captureContractSha256: "a".repeat(64),
    landmarkIndices: { pose: [11], leftHand: [0], rightHand: [0], face: [] },
  };
  let endedHandler;
  let trackStopped = false;
  let landmarkerClosed = false;
  let reportError;
  const errorReported = new Promise((resolve) => { reportError = resolve; });
  const videoElement = { readyState: 0, currentTime: 0, srcObject: null, play: async () => {}, pause() {} };
  const priorRequestAnimationFrame = globalThis.requestAnimationFrame;
  const priorCancelAnimationFrame = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = () => 92;
  globalThis.cancelAnimationFrame = () => {};
  try {
    await startCapture({
      videoElement,
      manifest,
      consentCode: "C01",
      metricsDisclosureAccepted: true,
      onError: reportError,
      createLandmarker: async () => ({ close() { landmarkerClosed = true; } }),
      mediaDevices: {
        getUserMedia: async () => ({
          addEventListener() {},
          getTracks: () => [{
            addEventListener(type, callback) { if (type === "ended") endedHandler = callback; },
            stop() { trackStopped = true; },
          }],
        }),
      },
    });
    assert.equal(typeof endedHandler, "function");
    endedHandler();
    const error = await errorReported;
    assert.equal(error.code, "camera_stream_ended");
    assert.equal(trackStopped, true);
    assert.equal(landmarkerClosed, true);
    assert.equal(videoElement.srcObject, null);

    await startCapture({
      videoElement,
      manifest,
      consentCode: "C01",
      metricsDisclosureAccepted: true,
      createLandmarker: async () => ({ close() {} }),
      mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) },
    });
    await stopCapture();
  } finally {
    await stopCapture();
    if (priorRequestAnimationFrame === undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame = priorRequestAnimationFrame;
    if (priorCancelAnimationFrame === undefined) delete globalThis.cancelAnimationFrame;
    else globalThis.cancelAnimationFrame = priorCancelAnimationFrame;
  }
});

test("refuses condition codes that are not in the approved manifest", () => {
  const record = validRecord();
  record.conditions.lightingCode = "LIGHTING_NOT_APPROVED";
  assert.throws(
    () => exportLandmarkRecords([record], {
      ...manifest,
      conditions: { lighting: ["L1"], distance: ["D1"], background: ["B1"] },
    }),
    (error) => error.codes.includes("invalid_conditions"),
  );
});
test("does not run landmark inference while the signer has not started a clip", async () => {
  let callback;
  let inferenceCalls = 0;
  const priorRequestAnimationFrame = globalThis.requestAnimationFrame;
  const priorCancelAnimationFrame = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = (next) => { callback = next; return 12; };
  globalThis.cancelAnimationFrame = () => {};
  const videoElement = { readyState: 2, currentTime: 1, srcObject: null, play: async () => {}, pause() {} };
  try {
    const { startCapture, stopCapture } = await import("../tools/sign_pilot/capture.mjs");
    const manifest = {
      schemaVersion: "1.0", approved: true, signers: ["S01"], allowedSigns: ["SIGN_A"], consentCodes: ["C01"],
      conditions: { lighting: ["L1"], distance: ["D1"], background: ["B1"] }, preprocessVersion: "v1",
      metricsDisclosureNoticeId: "MP-METRICS-2026-04",
      captureContractSha256: "a".repeat(64),
      landmarkIndices: { pose: [11], leftHand: [0], rightHand: [0], face: [] },
    };
    await startCapture({
      videoElement, manifest, consentCode: "C01", metricsDisclosureAccepted: true,
      createLandmarker: async () => ({ detectForVideo() { inferenceCalls += 1; return {}; }, close() {} }),
      mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) },
    });
    await callback();
    await stopCapture();
  } finally {
    if (priorRequestAnimationFrame === undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame = priorRequestAnimationFrame;
    if (priorCancelAnimationFrame === undefined) delete globalThis.cancelAnimationFrame;
    else globalThis.cancelAnimationFrame = priorCancelAnimationFrame;
  }
  assert.equal(inferenceCalls, 0);
});

test("blocks runtime paths that point to another origin before fetching assets", async () => {
  const { createLocalMediaPipeLandmarker } = await import("../tools/sign_pilot/mediapipe-loader.mjs");
  const previousLocation = globalThis.location;
  const previousFetch = globalThis.fetch;
  let fetchCalls = 0;
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: { href: "https://localhost/tools/sign_pilot/capture.html" },
  });
  globalThis.fetch = async () => { fetchCalls += 1; throw new Error("fetch must not run"); };
  try {
    await assert.rejects(
      () => createLocalMediaPipeLandmarker({
        assetManifest: {
          runtimeVersion: "1.0.1",
          runtimeUrl: "https://cdn.example/vision_bundle.mjs",
          runtimeSha256: "0".repeat(64),
          wasmRoot: "./assets/wasm/",
          modelUrl: "./assets/holistic.task",
          modelSha256: "0".repeat(64),
        },
      }),
      (error) => error.code === "external_asset_blocked",
    );
  } finally {
    if (previousLocation === undefined) delete globalThis.location;
    else Object.defineProperty(globalThis, "location", { configurable: true, value: previousLocation });
    globalThis.fetch = previousFetch;
  }
  assert.equal(fetchCalls, 0);
});

test("creates the local holistic landmarker in video mode with the hash-verified model buffer", async () => {
  const { createLocalMediaPipeLandmarker } = await import("../tools/sign_pilot/mediapipe-loader.mjs");
  const previousLocation = Object.getOwnPropertyDescriptor(globalThis, "location");
  const previousFetch = globalThis.fetch;
  const bytesByPath = new Map([
    ["http://localhost/tools/sign_pilot/assets/runtime.mjs", new Uint8Array([1, 2, 3])],
    ["http://localhost/tools/sign_pilot/assets/holistic.task", new Uint8Array([4, 5, 6])],
    ["http://localhost/tools/sign_pilot/assets/wasm/vision_wasm_internal.js", new Uint8Array([7, 8])],
    ["http://localhost/tools/sign_pilot/assets/wasm/vision_wasm_internal.wasm", new Uint8Array([9, 10])],
  ]);
  const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
  const calls = [];
  let closeCalls = 0;
  const expectedInstance = { detectForVideo() {}, close() { closeCalls += 1; } };
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: { href: "http://localhost/tools/sign_pilot/capture.html" },
  });
  globalThis.fetch = async (url) => ({
    ok: true,
    arrayBuffer: async () => bytesByPath.get(String(url)).buffer,
  });
  try {
    const instance = await createLocalMediaPipeLandmarker({
      assetManifest: {
        runtimeVersion: "1.0.0",
        runtimeUrl: "./assets/runtime.mjs",
        runtimeSha256: hash(bytesByPath.get("http://localhost/tools/sign_pilot/assets/runtime.mjs")),
        wasmRoot: "./assets/wasm/",
        wasmFiles: [
          { path: "vision_wasm_internal.js", sha256: hash(bytesByPath.get("http://localhost/tools/sign_pilot/assets/wasm/vision_wasm_internal.js")) },
          { path: "vision_wasm_internal.wasm", sha256: hash(bytesByPath.get("http://localhost/tools/sign_pilot/assets/wasm/vision_wasm_internal.wasm")) },
        ],
        modelUrl: "./assets/holistic.task",
        modelSha256: hash(bytesByPath.get("http://localhost/tools/sign_pilot/assets/holistic.task")),
      },
      importRuntime: async (bytes) => {
        assert.deepEqual(new Uint8Array(bytes), bytesByPath.get("http://localhost/tools/sign_pilot/assets/runtime.mjs"));
        return {
        FilesetResolver: { forVisionTasks: async (root) => ({
          root,
          wasmLoaderPath: new URL("vision_wasm_internal.js", root).href,
          wasmBinaryPath: new URL("vision_wasm_internal.wasm", root).href,
        }) },
        HolisticLandmarker: {
          createFromOptions: async (...args) => {
            calls.push(["createFromOptions", ...args]);
            return expectedInstance;
          },
          createFromModelBuffer: async (...args) => {
            calls.push(["createFromModelBuffer", ...args]);
            return expectedInstance;
          },
        },
      };
      },
    });
    assert.equal(typeof instance.detectForVideo, "function");
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], "createFromOptions");
    assert.equal(calls[0][1].root, "http://localhost/tools/sign_pilot/assets/wasm/");
    assert.match(calls[0][1].wasmLoaderPath, /^blob:/u);
    assert.match(calls[0][1].wasmBinaryPath, /^blob:/u);
    assert.deepEqual(calls[0][2].baseOptions.modelAssetBuffer, bytesByPath.get("http://localhost/tools/sign_pilot/assets/holistic.task"));
    assert.equal(calls[0][2].runningMode, "VIDEO");
    assert.equal(calls[0][2].outputFaceBlendshapes, false);
    assert.equal(calls[0][2].outputPoseSegmentationMasks, false);
    await instance.close();
    await instance.close();
    assert.equal(closeCalls, 1);
  } finally {
    if (previousLocation) Object.defineProperty(globalThis, "location", previousLocation);
    else delete globalThis.location;
    globalThis.fetch = previousFetch;
  }
});

test("blocks MediaPipe initialization when the resolved WASM binary hash is wrong", async () => {
  const { createLocalMediaPipeLandmarker } = await import("../tools/sign_pilot/mediapipe-loader.mjs");
  const previousLocation = Object.getOwnPropertyDescriptor(globalThis, "location");
  const previousFetch = globalThis.fetch;
  const wasmBytes = new Uint8Array([9, 10]);
  const bytesByPath = new Map([
    ["http://localhost/tools/sign_pilot/runtime.mjs", new Uint8Array([1])],
    ["http://localhost/tools/sign_pilot/holistic.task", new Uint8Array([2])],
    ["http://localhost/tools/sign_pilot/wasm/vision_wasm_internal.js", new Uint8Array([3])],
    ["http://localhost/tools/sign_pilot/wasm/vision_wasm_internal.wasm", wasmBytes],
  ]);
  const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
  let initialized = false;
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: { href: "http://localhost/tools/sign_pilot/capture.html" },
  });
  globalThis.fetch = async (url) => ({
    ok: true,
    arrayBuffer: async () => bytesByPath.get(String(url)).buffer,
  });
  try {
    await assert.rejects(
      () => createLocalMediaPipeLandmarker({
        assetManifest: {
          runtimeVersion: "1.0.0",
          runtimeUrl: "./runtime.mjs",
          runtimeSha256: hash(bytesByPath.get("http://localhost/tools/sign_pilot/runtime.mjs")),
          wasmRoot: "./wasm/",
          wasmFiles: [
            { path: "vision_wasm_internal.js", sha256: hash(bytesByPath.get("http://localhost/tools/sign_pilot/wasm/vision_wasm_internal.js")) },
            { path: "vision_wasm_internal.wasm", sha256: "0".repeat(64) },
          ],
          modelUrl: "./holistic.task",
          modelSha256: hash(bytesByPath.get("http://localhost/tools/sign_pilot/holistic.task")),
        },
        importRuntime: async () => ({
          FilesetResolver: { forVisionTasks: async (root) => ({
            wasmLoaderPath: new URL("vision_wasm_internal.js", root).href,
            wasmBinaryPath: new URL("vision_wasm_internal.wasm", root).href,
          }) },
          HolisticLandmarker: { createFromOptions: async () => { initialized = true; return {}; } },
        }),
      }),
      (error) => error.code === "asset_hash_mismatch",
    );
    assert.equal(initialized, false);
  } finally {
    if (previousLocation) Object.defineProperty(globalThis, "location", previousLocation);
    else delete globalThis.location;
    globalThis.fetch = previousFetch;
  }
});
