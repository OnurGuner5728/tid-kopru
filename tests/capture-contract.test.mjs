import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateLandmarkRecords } from "../tools/sign_pilot/capture.mjs";
import { captureContractSha256, createCaptureId } from "../tools/sign_pilot/capture-contract.mjs";

const contract = {
  preprocessVersion: "v1",
  landmarkIndices: { pose: [11, 12], leftHand: [0], rightHand: [0], face: [] },
  modelVersion: "holistic-v1",
  runtimeVersion: "1.2.3",
  runtimeSha256: "a".repeat(64),
  modelSha256: "b".repeat(64),
  wasmFiles: [
    { path: "vision_wasm_internal.js", sha256: "c".repeat(64) },
    { path: "vision_wasm_internal.wasm", sha256: "d".repeat(64) },
    { path: "vision_wasm_nosimd_internal.js", sha256: "e".repeat(64) },
    { path: "vision_wasm_nosimd_internal.wasm", sha256: "f".repeat(64) },
  ],
};

test("capture contract uses the cross-language versioned fingerprint", async () => {
  assert.equal(
    await captureContractSha256(contract),
    "0f2ab397d2368a192308d81ae871c8355e9bfd5d933f64e5943137918dab0b6f",
  );
  assert.notEqual(
    await captureContractSha256({ ...contract, landmarkIndices: { ...contract.landmarkIndices, pose: [12, 11] } }),
    await captureContractSha256(contract),
  );
  assert.notEqual(
    await captureContractSha256({ ...contract, runtimeSha256: "c".repeat(64) }),
    await captureContractSha256(contract),
  );
  assert.equal(
    await captureContractSha256({ ...contract, wasmFiles: [...contract.wasmFiles].reverse() }),
    await captureContractSha256(contract),
  );
  assert.notEqual(
    await captureContractSha256({ ...contract, wasmFiles: contract.wasmFiles.map((item, index) => index === 0 ? { ...item, sha256: "f".repeat(64) } : item) }),
    await captureContractSha256(contract),
  );
});

test("capture IDs are anonymous, compact, and unique", () => {
  const first = createCaptureId();
  const second = createCaptureId();
  assert.match(first, /^[a-f0-9]{32}$/u);
  assert.notEqual(first, second);
});

test("browser validator agrees with the shared Python dataset fixtures", async () => {
  const fixtures = JSON.parse(await readFile(new URL("./sign-pilot-validation-fixtures.json", import.meta.url), "utf8"));
  assert.deepEqual(validateLandmarkRecords([fixtures.validRecord], fixtures.manifest), []);
  for (const item of fixtures.rejectedRecords) {
    assert.ok(validateLandmarkRecords([item.record], fixtures.manifest).includes(item.error));
  }
});

test("browser duplicate checks ignore hex case, key order, FPS, and absolute timestamps", async () => {
  const fixtures = JSON.parse(await readFile(new URL("./sign-pilot-validation-fixtures.json", import.meta.url), "utf8"));
  const original = fixtures.validRecord;
  const upperId = { ...original, captureId: original.captureId.toUpperCase(), repetition: 2 };
  assert.ok(validateLandmarkRecords([original, upperId], fixtures.manifest).includes("duplicate_capture_id"));

  const reorderedFrame = Object.fromEntries(Object.entries(original.frames[0]).reverse());
  reorderedFrame.timestampMs += 1000;
  const replay = {
    ...original,
    captureId: "2".repeat(32),
    repetition: 2,
    fps: original.fps * 2,
    frames: [reorderedFrame],
  };
  assert.ok(validateLandmarkRecords([original, replay], fixtures.manifest).includes("duplicate_capture_content"));
});
