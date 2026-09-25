import test from "node:test";
import assert from "node:assert/strict";
import {
  exportLandmarkRecords,
  normalizeLandmarkFrame,
} from "../tools/sign_pilot/capture.mjs";

const point = (x, y, z, visibility = 1) => ({ x, y, z, visibility });

function validRecord() {
  return {
    schemaVersion: "1.0",
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