const HASH = /^[a-f0-9]{64}$/i;

function fail(message, code = "invalid_media_pipe_assets") {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function resolveLocalUrl(path, pageUrl) {
  if (typeof path !== "string" || !path.trim()) fail("A local MediaPipe asset path is required.");
  const url = new URL(path, pageUrl);
  if (!["https:", "http:"].includes(url.protocol) || url.origin !== new URL(pageUrl).origin) {
    fail("MediaPipe runtime, WASM, and model assets must be served from this same origin.", "external_asset_blocked");
  }
  return url;
}

async function sha256Hex(bytes) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export async function createLocalMediaPipeLandmarker({ assetManifest } = {}) {
  if (!assetManifest || typeof assetManifest !== "object") fail("MediaPipe local assets are not installed.", "mediapipe_assets_missing");
  if (typeof assetManifest.runtimeVersion !== "string" || !assetManifest.runtimeVersion.trim()) {
    fail("The MediaPipe runtime version must be pinned in its local manifest.");
  }
  if (!HASH.test(assetManifest.runtimeSha256 ?? "") || !HASH.test(assetManifest.modelSha256 ?? "")) {
    fail("The runtime and model must have recorded SHA-256 values.");
  }
  if (!globalThis.location?.href || !globalThis.fetch || !globalThis.crypto?.subtle) {
    fail("This browser does not support local asset verification.", "asset_verification_unavailable");
  }

  const runtimeUrl = resolveLocalUrl(assetManifest.runtimeUrl, location.href);
  const wasmRoot = resolveLocalUrl(assetManifest.wasmRoot, location.href);
  const modelUrl = resolveLocalUrl(assetManifest.modelUrl, location.href);
  const runtimeResponse = await fetch(runtimeUrl, { credentials: "same-origin", cache: "no-store" });
  if (!runtimeResponse.ok) fail("Local runtime asset returned " + runtimeResponse.status + ".", "mediapipe_assets_missing");
  const runtimeBytes = await runtimeResponse.arrayBuffer();
  if ((await sha256Hex(runtimeBytes)).toLowerCase() !== assetManifest.runtimeSha256.toLowerCase()) {
    fail("The local MediaPipe runtime hash does not match its manifest.", "asset_hash_mismatch");
  }

  const modelResponse = await fetch(modelUrl, { credentials: "same-origin", cache: "no-store" });
  if (!modelResponse.ok) fail("Local model asset returned " + modelResponse.status + ".", "mediapipe_assets_missing");
  const modelBytes = await modelResponse.arrayBuffer();
  if ((await sha256Hex(modelBytes)).toLowerCase() !== assetManifest.modelSha256.toLowerCase()) {
    fail("The local MediaPipe model hash does not match its manifest.", "asset_hash_mismatch");
  }

  const { FilesetResolver, HolisticLandmarker } = await import(runtimeUrl.href);
  if (!FilesetResolver?.forVisionTasks || !HolisticLandmarker?.createFromModelBuffer) {
    fail("The pinned MediaPipe bundle does not expose the expected Holistic Landmarker API.");
  }
  const fileset = await FilesetResolver.forVisionTasks(wasmRoot.href);
  return HolisticLandmarker.createFromModelBuffer(fileset, new Uint8Array(modelBytes), {
    runningMode: "VIDEO",
    minFaceDetectionConfidence: 0.5,
    minPoseDetectionConfidence: 0.5,
    minHandLandmarksConfidence: 0.5,
    outputFaceBlendshapes: false,
    outputPoseSegmentationMasks: false,
  });
}