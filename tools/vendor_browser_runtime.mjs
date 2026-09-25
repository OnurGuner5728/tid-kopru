import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_ROOT = path.join(ROOT, 'public');
const SOURCES_PATH = path.join(ROOT, 'tools', 'runtime-sources.json');
const MANIFEST_PATH = path.join(PUBLIC_ROOT, 'assets', 'runtime', 'runtime-manifest.json');

const PACKAGE_FILES = [
  ['node_modules/@mediapipe/tasks-vision/vision_bundle.mjs', 'vendor/mediapipe/vision_bundle.mjs', 'Apache-2.0'],
  ['node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.js', 'vendor/mediapipe/wasm/vision_wasm_internal.js', 'Apache-2.0'],
  ['node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.wasm', 'vendor/mediapipe/wasm/vision_wasm_internal.wasm', 'Apache-2.0'],
  ['node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_module_internal.js', 'vendor/mediapipe/wasm/vision_wasm_module_internal.js', 'Apache-2.0'],
  ['node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_module_internal.wasm', 'vendor/mediapipe/wasm/vision_wasm_module_internal.wasm', 'Apache-2.0'],
  ['node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_nosimd_internal.js', 'vendor/mediapipe/wasm/vision_wasm_nosimd_internal.js', 'Apache-2.0'],
  ['node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_nosimd_internal.wasm', 'vendor/mediapipe/wasm/vision_wasm_nosimd_internal.wasm', 'Apache-2.0'],
  ['node_modules/onnxruntime-web/dist/ort.wasm.min.mjs', 'vendor/onnxruntime/ort.wasm.min.mjs', 'MIT'],
  ['node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs', 'vendor/onnxruntime/ort-wasm-simd-threaded.mjs', 'MIT'],
  ['node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm', 'vendor/onnxruntime/ort-wasm-simd-threaded.wasm', 'MIT'],
];

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function listFiles(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await listFiles(path.join(directory, entry.name), relative));
    else if (entry.isFile()) files.push(relative.replaceAll('\\', '/'));
  }
  return files.sort();
}

export async function verifyPublishedDirectory(directory, allowedRelativePaths) {
  const files = await listFiles(directory);
  for (const file of files) {
    if (!allowedRelativePaths.has(file)) throw new Error(`unlisted runtime output: ${file}`);
  }
  for (const file of allowedRelativePaths) {
    if (!files.includes(file)) throw new Error(`missing runtime output: ${file}`);
  }
  return files;
}

async function fetchBytes(url) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`runtime download failed (${response.status}): ${url}`);
  return new Uint8Array(await response.arrayBuffer());
}

async function writeTarget(relativePath, bytes) {
  const target = path.join(PUBLIC_ROOT, ...relativePath.split('/'));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes);
}

async function describeTarget(relativePath, license) {
  const target = path.join(PUBLIC_ROOT, ...relativePath.split('/'));
  const bytes = await readFile(target);
  const metadata = await stat(target);
  return { path: relativePath, sha256: sha256(bytes), license, bytes: metadata.size };
}

async function loadSources() {
  const sources = JSON.parse(await readFile(SOURCES_PATH, 'utf8'));
  if (sources.schemaVersion !== 1 || sources.packages?.mediapipe !== '1.0.1'
      || sources.packages?.onnxruntime !== '1.30.0' || !Array.isArray(sources.downloads)) {
    throw new Error('invalid runtime sources');
  }
  return sources;
}

async function generate() {
  const sources = await loadSources();
  await Promise.all([
    rm(path.join(PUBLIC_ROOT, 'vendor', 'mediapipe'), { recursive: true, force: true }),
    rm(path.join(PUBLIC_ROOT, 'vendor', 'onnxruntime'), { recursive: true, force: true }),
    rm(path.join(PUBLIC_ROOT, 'assets', 'runtime'), { recursive: true, force: true }),
  ]);

  for (const [source, target] of PACKAGE_FILES) {
    const destination = path.join(PUBLIC_ROOT, ...target.split('/'));
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(path.join(ROOT, ...source.split('/')), destination);
  }
  for (const source of sources.downloads) await writeTarget(source.target, await fetchBytes(source.url));

  const licensedTargets = [
    ...PACKAGE_FILES.map(([, target, license]) => ({ target, license })),
    ...sources.downloads.map(({ target, license }) => ({ target, license })),
  ];
  const files = [];
  for (const { target, license } of licensedTargets) files.push(await describeTarget(target, license));
  files.sort((left, right) => left.path.localeCompare(right.path));
  const manifest = {
    schemaVersion: 1,
    mediapipeVersion: sources.packages.mediapipe,
    onnxRuntimeVersion: sources.packages.onnxruntime,
    generatedFrom: 'tools/runtime-sources.json',
    files,
  };
  await mkdir(path.dirname(MANIFEST_PATH), { recursive: true });
  await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  await verifyManifest(manifest);
}

async function verifyManifest(manifest) {
  const currentManifest = manifest ?? JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
  const allowedByRoot = new Map([
    ['vendor/mediapipe', new Set()],
    ['vendor/onnxruntime', new Set()],
    ['assets/runtime/models', new Set()],
  ]);
  for (const asset of currentManifest.files) {
    const bytes = await readFile(path.join(PUBLIC_ROOT, ...asset.path.split('/')));
    if (bytes.byteLength !== asset.bytes || sha256(bytes) !== asset.sha256) {
      throw new Error(`runtime hash mismatch: ${asset.path}`);
    }
    for (const [root, allowed] of allowedByRoot) {
      if (asset.path.startsWith(`${root}/`)) allowed.add(asset.path.slice(root.length + 1));
    }
  }
  for (const [root, allowed] of allowedByRoot) {
    await verifyPublishedDirectory(path.join(PUBLIC_ROOT, ...root.split('/')), allowed);
  }
}

async function main() {
  if (process.argv.includes('--verify-only')) await verifyManifest();
  else await generate();
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
