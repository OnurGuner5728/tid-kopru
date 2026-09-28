import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '..');
const MANIFEST_PATH = path.join(ROOT, 'public', 'assets', 'runtime', 'runtime-manifest.json');
const SHA256 = /^[a-f0-9]{64}$/;

test('runtime manifest pins licensed files and hashes', async () => {
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));

  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.mediapipeVersion, '1.0.1');
  assert.equal(manifest.onnxRuntimeVersion, '1.30.0');
  assert.ok(Array.isArray(manifest.files));
  assert.ok(manifest.files.length >= 8);

  for (const asset of manifest.files) {
    assert.match(asset.sha256, SHA256);
    assert.ok(Number.isSafeInteger(asset.bytes) && asset.bytes > 0);
    assert.ok(!asset.path.startsWith('/') && !asset.path.includes('..'));
    assert.ok(!/^https?:/i.test(asset.path));
    assert.ok(['Apache-2.0', 'MIT'].includes(asset.license));
    if (asset.path.includes('mediapipe') || asset.path.includes('landmarker')) {
      assert.equal(asset.license, 'Apache-2.0');
    }
    if (asset.path.includes('onnxruntime')) assert.equal(asset.license, 'MIT');
  }
});

test('vendor script rejects an unlisted output', async () => {
  const { verifyPublishedDirectory } = await import('../tools/vendor_browser_runtime.mjs');
  const directory = await mkdtemp(path.join(tmpdir(), 'tid-runtime-'));
  try {
    await writeFile(path.join(directory, 'allowed.wasm'), 'allowed');
    await writeFile(path.join(directory, 'stray.js'), 'stray');
    await assert.rejects(
      verifyPublishedDirectory(directory, new Set(['allowed.wasm'])),
      /unlisted runtime output: stray\.js/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('each MediaPipe task gets an isolated module loader instance', async () => {
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
  const workerSource = await readFile(path.join(ROOT, 'public', 'landmark-worker.js'), 'utf8');
  const paths = new Set(manifest.files.map((asset) => asset.path));
  const { createIsolatedWasmFileset } = await import('../public/mediapipe-fileset.mjs');

  assert.ok(paths.has('vendor/mediapipe/wasm/vision_wasm_module_internal.js'));
  assert.ok(paths.has('vendor/mediapipe/wasm/vision_wasm_module_internal.wasm'));
  assert.match(workerSource, /createIsolatedWasmFileset\(visionModule\.FilesetResolver,/u);
  const resolverCalls = [];
  const resolver = { forVisionTasks: async (...args) => {
    resolverCalls.push(args);
    return { wasmLoaderPath: 'https://example.test/wasm/vision_wasm_module_internal.js', wasmBinaryPath: 'https://example.test/wasm/vision_wasm_module_internal.wasm' };
  } };
  const hand = await createIsolatedWasmFileset(resolver, 'https://example.test/wasm/', 'hand');
  const pose = await createIsolatedWasmFileset(resolver, 'https://example.test/wasm/', 'pose');

  assert.equal(resolverCalls.length, 2);
  assert.equal(resolverCalls[0][1], true);
  assert.notEqual(hand.wasmLoaderPath, pose.wasmLoaderPath);
  assert.equal(new URL(hand.wasmLoaderPath).searchParams.get('task'), 'hand');
  assert.equal(new URL(pose.wasmLoaderPath).searchParams.get('task'), 'pose');
  assert.equal(hand.wasmBinaryPath, pose.wasmBinaryPath);
});
