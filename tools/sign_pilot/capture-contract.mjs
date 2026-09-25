export const CAPTURE_SCHEMA_VERSION = "1.1";

const SHA256 = /^[a-f0-9]{64}$/i;
const GROUPS = ["pose", "leftHand", "rightHand", "face"];

function normalizedWasmFiles(wasmFiles) {
  if (!Array.isArray(wasmFiles) || wasmFiles.length < 2) {
    throw new TypeError("Verified WASM loader and binary hashes are required.");
  }
  const paths = new Set();
  const normalized = wasmFiles.map((file) => {
    if (!file || typeof file !== "object" || Array.isArray(file)
      || typeof file.path !== "string" || !file.path.trim()
      || !/^[A-Za-z0-9._/-]+$/u.test(file.path)
      || file.path.startsWith("/") || /^[a-z][a-z0-9+.-]*:/iu.test(file.path)
      || file.path.split("/").some((part) => part === ".." || part === "." || !part)) {
      throw new TypeError("WASM asset paths must be safe paths relative to the local WASM folder.");
    }
    if (!SHA256.test(file.sha256 ?? "")) {
      throw new TypeError("Every WASM asset must have a SHA-256 value.");
    }
    if (paths.has(file.path)) throw new TypeError("WASM asset paths must be unique.");
    paths.add(file.path);
    return { path: file.path, sha256: file.sha256.toLowerCase() };
  });
  return normalized.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
}

export function captureContractPayload({
  preprocessVersion,
  landmarkIndices,
  modelVersion,
  runtimeVersion,
  runtimeSha256,
  modelSha256,
  wasmFiles,
} = {}) {
  if (typeof preprocessVersion !== "string" || !preprocessVersion.trim()) {
    throw new TypeError("A pinned preprocessing version is required.");
  }
  if (!landmarkIndices || typeof landmarkIndices !== "object"
    || GROUPS.some((group) => !Array.isArray(landmarkIndices[group])
      || landmarkIndices[group].some((index) => !Number.isInteger(index) || index < 0))) {
    throw new TypeError("An ordered landmark layout is required.");
  }
  if (typeof modelVersion !== "string" || !modelVersion.trim()) {
    throw new TypeError("A pinned MediaPipe model version is required.");
  }
  if (typeof runtimeVersion !== "string" || !runtimeVersion.trim()) {
    throw new TypeError("A pinned MediaPipe runtime version is required.");
  }
  if (!SHA256.test(runtimeSha256 ?? "") || !SHA256.test(modelSha256 ?? "")) {
    throw new TypeError("Verified MediaPipe runtime and model SHA-256 values are required.");
  }
  return {
    schemaVersion: CAPTURE_SCHEMA_VERSION,
    preprocessVersion,
    landmarkIndices: {
      pose: [...landmarkIndices.pose],
      leftHand: [...landmarkIndices.leftHand],
      rightHand: [...landmarkIndices.rightHand],
      face: [...landmarkIndices.face],
    },
    modelVersion,
    runtimeVersion,
    runtimeSha256: runtimeSha256.toLowerCase(),
    modelSha256: modelSha256.toLowerCase(),
    wasmFiles: normalizedWasmFiles(wasmFiles),
  };
}

export async function captureContractSha256(values) {
  if (!globalThis.crypto?.subtle) throw new Error("SHA-256 support is required to identify the capture contract.");
  const canonicalJson = JSON.stringify(captureContractPayload(values));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export function createCaptureId(cryptoApi = globalThis.crypto) {
  if (typeof cryptoApi?.randomUUID === "function") {
    return cryptoApi.randomUUID().replaceAll("-", "").toLowerCase();
  }
  if (typeof cryptoApi?.getRandomValues !== "function") {
    throw new Error("This browser cannot create a local capture identity.");
  }
  return [...cryptoApi.getRandomValues(new Uint8Array(16))]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}
