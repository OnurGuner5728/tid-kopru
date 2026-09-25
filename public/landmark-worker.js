import { normalizeLandmarkFrame } from './landmark-normalization.mjs';

let handLandmarker;
let poseLandmarker;
let faceLandmarker;

function postError(code, requestId) { self.postMessage({ type: 'error', code, requestId }); }

async function initialize(urls) {
  const visionModule = await import(urls['vendor/mediapipe/vision_bundle.mjs']);
  const vision = await visionModule.FilesetResolver.forVisionTasks(new URL('./wasm/', urls['vendor/mediapipe/vision_bundle.mjs']).href);
  const baseOptions = (modelAssetPath) => ({ modelAssetPath, delegate: 'CPU' });
  handLandmarker = await visionModule.HandLandmarker.createFromOptions(vision, {
    baseOptions: baseOptions(urls['assets/runtime/models/hand_landmarker.task']), runningMode: 'VIDEO', numHands: 2,
  });
  poseLandmarker = await visionModule.PoseLandmarker.createFromOptions(vision, {
    baseOptions: baseOptions(urls['assets/runtime/models/pose_landmarker_lite.task']), runningMode: 'VIDEO', numPoses: 1,
  });
  faceLandmarker = await visionModule.FaceLandmarker.createFromOptions(vision, {
    baseOptions: baseOptions(urls['assets/runtime/models/face_landmarker.task']), runningMode: 'VIDEO', numFaces: 1,
  });
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
    postError(error?.message || 'landmark_worker_failed', data?.requestId);
  }
});
