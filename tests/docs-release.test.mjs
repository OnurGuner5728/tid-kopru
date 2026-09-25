import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
const checklist = await readFile(new URL('../docs/manual-android-checklist.md', import.meta.url), 'utf8');
const authoringGuide = await readFile(new URL('../tools/tid_translation/README.md', import.meta.url), 'utf8');
const tidEvaluation = await readFile(new URL('../docs/tid-text-to-sign-evaluation.md', import.meta.url), 'utf8').catch(() => '');

test('setup guide states local command, remote HTTPS, first download, and speech caveat', () => {
  assert.match(readme, /python tools\/serve\.py/u);
  assert.match(readme, /http:\/\/localhost:8000/u);
  assert.match(readme, /HTTPS/u);
  assert.match(readme, /8,1 MB/u);
  assert.match(readme, /tarayıcı.*konuşma tanıma.*internet|konuşma tanıma.*uzak.*hizmet/isu);
});

test('setup guide explains scope and product limits honestly', () => {
  assert.match(readme, /desteklenen TİD cümle alanı[^\n]*0 cümle/iu);
  assert.match(readme, /uzman onaylı içerik[^\n]*(bulunmuyor|yok)|TİD uzmanlarınca onaylanmış[^\n]*yok/iu);
  assert.match(readme, /desteklenmeyen[^\n]*oynatılmaz/iu);
  assert.match(readme, /son metni[^\n]*onayla/iu);
  assert.match(readme, /elle yaz/u);
  assert.match(readme, /konuşma tanıma[^\n]*(uzak|internet)|konuşma tanıma[\s\S]*uzak hizmet/iu);
  assert.match(readme, /kameradan[^\n]*TİD.*Türkçe[^\n]*yok/iu);
  assert.match(readme, /acil durum aracı değildir/u);
  assert.match(readme, /Android Chrome.*henüz.*(doğrulanmadı|yapılmamıştır)/isu);
  assert.doesNotMatch(readme, /genel.*TİD çevirisi sağlar|her cümleyi.*çevirir|çevrimdışı konuşma tanıma hazır/iu);
});

test('evaluation report records the real release gate without inventing human results', () => {
  assert.match(tidEvaluation, /YAYIN ENGELLİ|BLOCKED/iu);
  assert.match(tidEvaluation, /0\s*\/\s*300|300[\s\S]*0 cümle/iu);
  assert.match(tidEvaluation, /iki bağımsız.*TİD.*değerlendirici/isu);
  assert.match(tidEvaluation, /henüz.*değerlendirme yapılmadı/isu);
  assert.match(tidEvaluation, /%90/iu);
  assert.match(tidEvaluation, /300.*cümle|cümle.*300/isu);
  assert.match(tidEvaluation, /license|lisans/iu);
});

test('authoring guide keeps production review and camera data outside the public bundle', () => {
  assert.match(authoringGuide, /two TİD reviewers|two separate.*TİD review/isu);
  assert.match(authoringGuide, /never approves candidates or creates playable entries/iu);
  assert.match(authoringGuide, /ham kamera.*Git|Git.*raw camera|raw camera.*Git/isu);
  assert.match(authoringGuide, /hosted AI|bulut.*AI|yapay zekâ/u);
});

test('release checklist inventories every public asset and blocks unresolved model rights', () => {
  for (const asset of [
    'public/app.mjs', 'public/avatar.mjs', 'public/assets/avatar/rain.glb',
    'public/assets/avatar/saved-poses.json', 'public/icons/icon.svg', 'public/icons/maskable.svg',
    'public/index.html', 'public/manifest.webmanifest', 'public/matcher.mjs',
    'public/service-worker.js', 'public/styles.css', 'public/sw-policy.js',
    'public/tid-media-player.mjs', 'public/tid-output-ui.mjs', 'public/tid-transfer.mjs',
    'public/turkish-morphology.mjs', 'public/assets/tid/content-manifest.json',
    'public/assets/tid/reviewed-content.json', 'public/assets/tid/morphology-rules.json',
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
  assert.match(checklist, /content-manifest\.json/u);
  assert.match(checklist, /media.*SHA|SHA.*media/isu);
  assert.match(checklist, /TİD.*300.*cümle|300.*cümle.*TİD/isu);
  assert.match(checklist, /25 Eylül 2026, Windows'ta localhost/u);
  assert.match(checklist, /Bu sonuç Android kurulumu.*doğrulaması değildir/u);
});
