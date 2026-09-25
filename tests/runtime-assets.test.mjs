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
