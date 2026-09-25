import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
const checklist = await readFile(new URL('../docs/manual-android-checklist.md', import.meta.url), 'utf8');
const authoringGuide = await readFile(new URL('../tools/tid_translation/README.md', import.meta.url), 'utf8');
const tidEvaluation = await readFile(new URL('../docs/tid-text-to-sign-evaluation.md', import.meta.url), 'utf8').catch(() => '');
const cameraEvaluation = await readFile(new URL('../docs/tid-camera-to-text-evaluation.md', import.meta.url), 'utf8').catch(() => '');
const fieldResults = await readFile(new URL('../docs/tid-two-way-field-results.md', import.meta.url), 'utf8').catch(() => '');
const publicAssetNotice = await readFile(new URL('../public/ASSET-NOTICE.txt', import.meta.url), 'utf8');
const publicSignbridgeLicense = await readFile(new URL('../public/SIGNBRIDGE-LICENSE.txt', import.meta.url), 'utf8');
const publicThreeLicense = await readFile(new URL('../public/vendor/three/LICENSE.txt', import.meta.url), 'utf8');

test('setup guide states local command, remote HTTPS, unavailable avatar, and speech caveat', () => {
  assert.match(readme, /python tools\/serve\.py/u);
  assert.match(readme, /http:\/\/localhost:8000/u);
  assert.match(readme, /HTTPS/u);
  assert.match(readme, /rain\.glb[\s\S]*?kamuya açık kaynak ve site paketinden çıkarılmış/u);
  assert.match(readme, /tarayıcı.*konuşma tanıma.*internet|konuşma tanıma.*uzak.*hizmet/isu);
});

test('setup guide explains scope and product limits honestly', () => {
  assert.match(readme, /desteklenen TİD cümle alanı[^\n]*0 cümle/iu);
  assert.match(readme, /uzman onaylı içerik[^\n]*(bulunmuyor|yok)|TİD uzmanlarınca onaylanmış[^\n]*yok/iu);
  assert.match(readme, /desteklenmeyen[^\n]*oynatılmaz/iu);
  assert.match(readme, /son metni[^\n]*onayla/iu);
  assert.match(readme, /elle yaz/u);
  assert.match(readme, /konuşma tanıma[^\n]*(uzak|internet)|konuşma tanıma[\s\S]*uzak hizmet/iu);
  assert.match(readme, /TİD→Türkçe[^\n]*(düğmeleri kapalı|kapalı)/iu);
  assert.match(readme, /kamera izni istenmez/u);
  assert.match(readme, /acil durum aracı değildir/u);
  assert.match(readme, /Android Chrome.*henüz.*(doğrulanmadı|yapılmamıştır)/isu);
  assert.doesNotMatch(readme, /genel.*TİD çevirisi sağlar|her cümleyi.*çevirir|çevrimdışı konuşma tanıma hazır/iu);
});

test('public files include required MIT notices and omit the unverified character model', () => {
  assert.match(publicAssetNotice, /rain\.glb[\s\S]*?kamuya açık kaynak ve site paketinden çıkarılmış/u);
  assert.match(publicSignbridgeLicense, /MIT License/u);
  assert.match(publicThreeLicense, /The MIT License/u);
  assert.match(readme, /AVATAR_MODEL_REDISTRIBUTION_APPROVED = false|yeniden dağıtım hakkı doğrulanmadı/u);
});

test('camera and two-way evaluation reports distinguish code tests from missing field evidence', () => {
  assert.match(cameraEvaluation, /YAYIN ENGELLİ.*KAMERA KAPALI/isu);
  assert.match(cameraEvaluation, /300[\s\S]*\| 0 \| Açık/u);
  assert.match(cameraEvaluation, /ölçülmedi/iu);
  assert.match(cameraEvaluation, /available: false/u);
  assert.match(cameraEvaluation, /MediaPipe[\s\S]*Google/u);
  assert.match(fieldResults, /yüz yüze TİD kullanıcı oturumu[\s\S]*0/u);
  assert.match(fieldResults, /Türkçe aday üretilemez/u);
  assert.match(fieldResults, /iki yönlü TİD çevirisi olarak tanıtılmamalıdır/u);
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
    'public/app.mjs', 'public/avatar.mjs',
    'public/assets/avatar/saved-poses.json', 'public/icons/icon.svg', 'public/icons/maskable.svg',
    'public/index.html', 'public/manifest.webmanifest', 'public/matcher.mjs',
    'public/service-worker.js', 'public/styles.css', 'public/sw-policy.js',
    'public/tid-media-player.mjs', 'public/tid-output-ui.mjs', 'public/tid-transfer.mjs',
    'public/turkish-morphology.mjs', 'public/assets/tid/content-manifest.json',
    'public/assets/tid/reviewed-content.json', 'public/assets/tid/morphology-rules.json',
    'public/assets/tid/gloss-to-turkish.json', 'public/assets/tid/sentence-model-manifest.json',
    'public/sign-recognition.mjs', 'public/sign-recognition-worker.js', 'public/onnx-runtime-loader.mjs',
    'public/tid-to-turkish.mjs',
    'public/vendor/three/three.module.js', 'public/vendor/three/addons/loaders/GLTFLoader.js',
    'public/vendor/three/addons/controls/OrbitControls.js',
    'public/vendor/three/addons/utils/BufferGeometryUtils.js'
  ]) assert.ok(checklist.includes(asset), `missing release inventory entry: ${asset}`);
  assert.match(checklist, /rain\.glb[\s\S]*?kamuya açık kaynak ve site paketine dahil değildir/u);
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
  assert.match(checklist, /public\/SIGNBRIDGE-LICENSE\.txt/u);
  assert.match(checklist, /public\/vendor\/three\/LICENSE\.txt/u);
});
