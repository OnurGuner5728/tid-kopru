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

async function readVerifiedAsset(url, expectedHash, label) {
  const response = await fetch(url, { credentials: "same-origin", cache: "no-store" });
  if (!response.ok) fail("Local " + label + " returned " + response.status + ".", "mediapipe_assets_missing");
  const bytes = await response.arrayBuffer();
  if ((await sha256Hex(bytes)).toLowerCase() !== expectedHash.toLowerCase()) {
    fail("The local " + label + " hash does not match its manifest.", "asset_hash_mismatch");
  }
  return bytes;
}

async function importVerifiedRuntime(bytes) {
  const objectUrl = URL.createObjectURL(new Blob([bytes], { type: "text/javascript" }));
  try {
    return await import(objectUrl);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function createLocalMediaPipeLandmarker({ assetManifest, importRuntime = importVerifiedRuntime } = {}) {
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
  if (!Array.isArray(assetManifest.wasmFiles) || assetManifest.wasmFiles.length < 2) {
    fail("The local manifest must pin the MediaPipe WASM loader and binary files.");
  }
  const runtimeBytes = await readVerifiedAsset(runtimeUrl, assetManifest.runtimeSha256, "runtime asset");
  const modelBytes = await readVerifiedAsset(modelUrl, assetManifest.modelSha256, "model asset");
  const { FilesetResolver, HolisticLandmarker } = await importRuntime(runtimeBytes);
  if (!FilesetResolver?.forVisionTasks || !HolisticLandmarker?.createFromOptions) {
    fail("The pinned MediaPipe bundle does not expose the expected Holistic Landmarker API.");
  }
  const fileset = await FilesetResolver.forVisionTasks(wasmRoot.href);
  const selectedPaths = [fileset.wasmLoaderPath, fileset.wasmBinaryPath];
  if (selectedPaths.some((path) => typeof path !== "string" || !path)) {
    fail("The pinned MediaPipe runtime did not resolve its WASM loader and binary.");
  }
  const objectUrls = [];
  const verifiedPaths = [];
  for (const path of selectedPaths) {
    const url = resolveLocalUrl(path, wasmRoot.href);
    if (!url.pathname.startsWith(wasmRoot.pathname)) {
      fail("Resolved WASM files must stay inside the approved local WASM folder.", "external_asset_blocked");
    }
    const entry = assetManifest.wasmFiles.find((item) => {
      if (!item || typeof item.path !== "string") return false;
      return resolveLocalUrl(item.path, wasmRoot.href).href === url.href;
    });
    if (!entry || !HASH.test(entry.sha256 ?? "")) {
      fail("The runtime selected a WASM file that is missing from the approved hash list.", "wasm_asset_unapproved");
    }
    const bytes = await readVerifiedAsset(url, entry.sha256, "WASM asset");
    const type = url.pathname.toLowerCase().endsWith(".wasm") ? "application/wasm" : "text/javascript";
    const objectUrl = URL.createObjectURL(new Blob([bytes], { type }));
    objectUrls.push(objectUrl);
    verifiedPaths.push(objectUrl);
  }
  const verifiedFileset = {
    ...fileset,
    wasmLoaderPath: verifiedPaths[0],
    wasmBinaryPath: verifiedPaths[1],
  };
  try {
    const landmarker = await HolisticLandmarker.createFromOptions(verifiedFileset, {
      baseOptions: { modelAssetBuffer: new Uint8Array(modelBytes) },
      runningMode: "VIDEO",
      minFaceDetectionConfidence: 0.5,
      minPoseDetectionConfidence: 0.5,
      minHandLandmarksConfidence: 0.5,
      outputFaceBlendshapes: false,
      outputPoseSegmentationMasks: false,
    });
    const originalClose = landmarker?.close?.bind(landmarker);
    let closed = false;
    return new Proxy(landmarker, {
      get(target, property) {
        if (property === "close") {
          return async (...args) => {
            if (closed) return;
            closed = true;
            try { await originalClose?.(...args); }
            finally { for (const url of objectUrls) URL.revokeObjectURL(url); }
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  } catch (error) {
    for (const url of objectUrls) URL.revokeObjectURL(url);
    throw error;
  }
}
