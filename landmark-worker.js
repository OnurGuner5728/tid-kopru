import { normalizeLandmarkFrame } from './landmark-normalization.mjs';
import { createIsolatedWasmFileset } from './mediapipe-fileset.mjs';

let handLandmarker;
let poseLandmarker;
let faceLandmarker;
let initializationStage = 'idle';

function postError(error, requestId) {
  self.postMessage({
    type: 'error',
    code: error?.message || 'landmark_worker_failed',
    detail: { stage: initializationStage, stack: error?.stack ?? null },
    requestId,
  });
}

async function initialize(urls) {
  initializationStage = 'import-runtime-bundle';
  const visionModule = await import(urls['vendor/mediapipe/vision_bundle.mjs']);
  initializationStage = 'load-wasm-fileset';
  const wasmRoot = new URL('./wasm/', urls['vendor/mediapipe/vision_bundle.mjs']).href;
  const baseOptions = (modelAssetPath) => ({ modelAssetPath, delegate: 'CPU' });
  initializationStage = 'create-hand-landmarker';
  handLandmarker = await visionModule.HandLandmarker.createFromOptions(
    await createIsolatedWasmFileset(visionModule.FilesetResolver, wasmRoot, 'hand'), {
    baseOptions: baseOptions(urls['assets/runtime/models/hand_landmarker.task']), runningMode: 'VIDEO', numHands: 2,
    },
  );
  initializationStage = 'create-pose-landmarker';
  poseLandmarker = await visionModule.PoseLandmarker.createFromOptions(
    await createIsolatedWasmFileset(visionModule.FilesetResolver, wasmRoot, 'pose'), {
    baseOptions: baseOptions(urls['assets/runtime/models/pose_landmarker_lite.task']), runningMode: 'VIDEO', numPoses: 1,
    },
  );
  initializationStage = 'create-face-landmarker';
  faceLandmarker = await visionModule.FaceLandmarker.createFromOptions(
    await createIsolatedWasmFileset(visionModule.FilesetResolver, wasmRoot, 'face'), {
    baseOptions: baseOptions(urls['assets/runtime/models/face_landmarker.task']), runningMode: 'VIDEO', numFaces: 1,
    },
  );
  initializationStage = 'ready';
}

self.addEventListener('message', async ({ data }) => {
  try {
    if (data?.type === 'initialize') {
      await initialize(data.urls);
      self.postMessage({ type: 'ready' });
      return;
    }
    if (data?.type === 'process-frame') {
      if (!handLandmarker || !poseLandmarker || !faceLandmarker) throw new Error('runtime_not_initialized');
      const hands = handLandmarker.detectForVideo(data.image, data.timestampMs);
      const pose = poseLandmarker.detectForVideo(data.image, data.timestampMs);
      const face = faceLandmarker.detectForVideo(data.image, data.timestampMs);
      data.image?.close?.();
      const frame = normalizeLandmarkFrame({
        timestampMs: data.timestampMs,
        handLandmarks: hands.landmarks ?? [], handednesses: hands.handednesses ?? [],
        poseLandmarks: pose.landmarks ?? [], faceLandmarks: face.faceLandmarks ?? [],
      });
      self.postMessage({ type: 'frame', requestId: data.requestId, frame });
      return;
    }
    if (data?.type === 'dispose') {
      handLandmarker?.close?.(); poseLandmarker?.close?.(); faceLandmarker?.close?.();
      handLandmarker = null; poseLandmarker = null; faceLandmarker = null;
      self.close();
    }
  } catch (error) {
    data?.image?.close?.();
    postError(error, data?.requestId);
  }
});
