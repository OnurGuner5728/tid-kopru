import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
const checklist = await readFile(new URL('../docs/manual-android-checklist.md', import.meta.url), 'utf8');

test('setup guide states local command, remote HTTPS, first download, and speech caveat', () => {
  assert.match(readme, /python tools\/serve\.py/u);
  assert.match(readme, /http:\/\/localhost:8000/u);
  assert.match(readme, /HTTPS/u);
  assert.match(readme, /8,1 MB/u);
  assert.match(readme, /tarayıcı.*konuşma tanıma.*internet|konuşma tanıma.*uzak.*hizmet/isu);
});

test('setup guide explains scope and product limits honestly', () => {
  assert.match(readme, /doğal TİD cümle çevirisi değildir/u);
  assert.match(readme, /acil durum aracı değildir/u);
  assert.match(readme, /Android Chrome.*henüz.*doğrulanmadı/isu);
  assert.doesNotMatch(readme, /tam TİD çevirisi sağlar|çevrimdışı konuşma tanıma hazır/u);
});

test('release checklist inventories every public asset and blocks unresolved model rights', () => {
  for (const asset of [
    'public/app.mjs', 'public/avatar.mjs', 'public/assets/avatar/rain.glb',
    'public/assets/avatar/saved-poses.json', 'public/icons/icon.svg', 'public/icons/maskable.svg',
    'public/index.html', 'public/manifest.webmanifest', 'public/matcher.mjs',
    'public/service-worker.js', 'public/styles.css', 'public/sw-policy.js',
    'public/vendor/three/three.module.js', 'public/vendor/three/addons/loaders/GLTFLoader.js',
    'public/vendor/three/addons/controls/OrbitControls.js',
    'public/vendor/three/addons/utils/BufferGeometryUtils.js'
  ]) assert.ok(checklist.includes(asset), `missing release inventory entry: ${asset}`);
  assert.match(checklist, /rain\.glb.*hak|hak.*rain\.glb/isu);
  assert.match(checklist, /yayın.*engellen|yayına.*çıkarılmamal/isu);
  assert.match(checklist, /Three\.js.*MIT/isu);
  assert.match(checklist, /manifest.*ikon/isu);
  assert.match(checklist, /service worker|service-worker/isu);
  assert.match(checklist, /gizlilik/u);
  assert.match(checklist, /25 Eylül 2026, Windows'ta localhost/u);
  assert.match(checklist, /Bu sonuç Android kurulumu.*doğrulaması değildir/u);
});
