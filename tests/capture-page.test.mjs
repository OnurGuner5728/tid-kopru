import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { captureContractSha256 } from "../tools/sign_pilot/capture-contract.mjs";

const html = await readFile(new URL("../tools/sign_pilot/capture.html", import.meta.url), "utf8");
const inlineModule = html.match(/<script type="module">([\s\S]*?)<\/script>/u)?.[1];
assert.ok(inlineModule, "capture page must have its startup module");

const pilotManifest = {
  approved: true,
  schemaVersion: "1.0",
  signers: ["S01"],
  allowedSigns: ["SIGN_A"],
  consentCodes: ["C01"],
  conditions: { lighting: ["L1"], distance: ["D1"], background: ["B1"] },
  metricsDisclosureNoticeId: "MP-NOTICE-1",
  preprocessVersion: "v1",
  landmarkIndices: { pose: [11], leftHand: [0], rightHand: [0], face: [] },
};
const assetManifest = {
  modelVersion: "holistic-v1",
  runtimeVersion: "1.0.0",
  runtimeUrl: "./assets/runtime.mjs",
  runtimeSha256: "a".repeat(64),
  wasmRoot: "./assets/wasm/",
  wasmFiles: [
    { path: "vision_wasm_internal.js", sha256: "c".repeat(64) },
    { path: "vision_wasm_internal.wasm", sha256: "d".repeat(64) },
    { path: "vision_wasm_nosimd_internal.js", sha256: "e".repeat(64) },
    { path: "vision_wasm_nosimd_internal.wasm", sha256: "f".repeat(64) },
  ],
  modelUrl: "./assets/holistic.task",
  modelSha256: "b".repeat(64),
};
const approvedCaptureContract = await captureContractSha256({
  preprocessVersion: "v1",
  landmarkIndices: { pose: [11], leftHand: [0], rightHand: [0], face: [] },
  modelVersion: assetManifest.modelVersion,
  runtimeVersion: assetManifest.runtimeVersion,
  runtimeSha256: assetManifest.runtimeSha256,
  modelSha256: assetManifest.modelSha256,
  wasmFiles: assetManifest.wasmFiles,
});
pilotManifest.captureContractSha256 = approvedCaptureContract;

async function startPage({ manifestsInstalled, captureModuleUrl }) {
  const ids = [
    "status", "preview", "metrics-consent", "signer", "consent", "sign", "lighting", "distance",
    "background", "open-camera", "close-camera", "start-record", "stop-record", "export",
    "delete-session", "record-count",
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, {
    id,
    disabled: true,
    checked: false,
    value: "",
    textContent: "",
    listeners: {},
    options: [],
    addEventListener(type, handler) { this.listeners[type] = handler; },
    replaceChildren(...options) { this.options = [...options]; },
    add(option) { this.options.push(option); },
  }]));
  const globals = {
    document: { getElementById: (id) => elements[id] },
    location: { hostname: "localhost", href: "http://localhost:8120/capture.html" },
    isSecureContext: true,
    Option: class Option { constructor(text, value) { this.text = text; this.value = value; } },
    addEventListener() {},
    fetch: async (path) => {
      if (!manifestsInstalled) return { ok: false };
      return {
        ok: true,
        json: async () => path.includes("pilot-manifest") ? pilotManifest : assetManifest,
      };
    },
  };
  const previous = new Map();
  for (const [name, value] of Object.entries(globals)) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }

  try {
    const resolvedCaptureModuleUrl = captureModuleUrl ?? new URL("../tools/sign_pilot/capture.mjs", import.meta.url).href;
    const contractModuleUrl = new URL("../tools/sign_pilot/capture-contract.mjs", import.meta.url).href;
    const captureImport = inlineModule.replace(
      /import \{ exportLandmarkRecords, SCHEMA_VERSION, startCapture, stopCapture, validateLandmarkRecords \} from "\.\/capture\.mjs";/u,
      "import { exportLandmarkRecords, SCHEMA_VERSION, startCapture, stopCapture, validateLandmarkRecords } from "
        + JSON.stringify(resolvedCaptureModuleUrl) + ";",
    );
    const source = captureImport.replace(
      /import \{ captureContractSha256, createCaptureId \} from "\.\/capture-contract\.mjs";/u,
      "import { captureContractSha256, createCaptureId } from " + JSON.stringify(contractModuleUrl) + ";",
    );
    assert.notEqual(captureImport, inlineModule, "capture module import must resolve for the test");
    assert.notEqual(source, captureImport, "capture-contract module import must resolve for the test");
    const encoded = Buffer.from(source).toString("base64");
    await import("data:text/javascript;base64," + encoded + "#" + manifestsInstalled);
    return elements;
  } finally {
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
}

test("capture page installs disabled controls both before and after local manifests are approved", async () => {
  const blockedPage = await startPage({ manifestsInstalled: false });
  assert.match(blockedPage.status.textContent, /henüz kurulmamış/u);
  assert.equal(blockedPage["open-camera"].disabled, true);
  assert.equal(typeof blockedPage["open-camera"].listeners.click, "function");

  const readyPage = await startPage({ manifestsInstalled: true });
  assert.match(readyPage.status.textContent, /Yerel kurulum yüklendi/u);
  assert.equal(readyPage.signer.disabled, false);
  assert.equal(readyPage["metrics-consent"].disabled, false);
  assert.equal(readyPage["open-camera"].disabled, true);
  assert.equal(typeof readyPage["open-camera"].listeners.click, "function");
});

test("camera controls expose cancellation while MediaPipe or permission startup is pending", async () => {
  const stub = [
    'export const SCHEMA_VERSION = "1.1";',
    "export const exportLandmarkRecords = () => '';",
    "export const validateLandmarkRecords = () => [];",
    "export const startCapture = (...args) => globalThis.__startCapture(...args);",
    "export const stopCapture = (...args) => globalThis.__stopCapture(...args);",
  ].join("\n");
  const captureModuleUrl = "data:text/javascript;base64," + Buffer.from(stub).toString("base64");
  let rejectStart;
  globalThis.__startCapture = () => new Promise((_, reject) => { rejectStart = reject; });
  globalThis.__stopCapture = async () => {
    rejectStart(Object.assign(new Error("cancelled"), { code: "capture_cancelled" }));
  };
  try {
    const page = await startPage({ manifestsInstalled: true, captureModuleUrl });
    page["metrics-consent"].checked = true;
    page.consent.value = "C01";
    page["metrics-consent"].listeners.change();
    page.consent.listeners.change();
    const opening = page["open-camera"].listeners.click();
    assert.equal(page["open-camera"].disabled, true);
    assert.equal(page["close-camera"].disabled, false);
    await page["close-camera"].listeners.click();
    await opening;
    assert.match(page.status.textContent, /açılışı durduruldu/u);
    assert.equal(page["close-camera"].disabled, true);
    assert.equal(page["open-camera"].disabled, false);
  } finally {
    delete globalThis.__startCapture;
    delete globalThis.__stopCapture;
  }
});
