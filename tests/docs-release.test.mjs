import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const readme = await read('../README.md');
const checklist = await read('../docs/manual-android-checklist.md');
const authoringGuide = await read('../tools/tid_translation/README.md');
const tidEvaluation = await read('../docs/tid-text-to-sign-evaluation.md');
const cameraEvaluation = await read('../docs/tid-camera-to-text-evaluation.md');
const fieldResults = await read('../docs/tid-two-way-field-results.md');
const assetNotices = `${await read('../ASSET-NOTICE.txt')}\n${await read('../public/ASSET-NOTICE.txt')}`;

test('readme describes the current usable hybrid release and its counts', () => {
  assert.match(readme, /123\s+(sözlük )?poz/iu);
  assert.match(readme, /0\s+(uzman onaylı )?(doğal )?TİD cümle/iu);
  assert.match(readme, /MediaPipe[^\n]*1\.0\.1/iu);
  assert.match(readme, /ONNX Runtime Web[^\n]*1\.30\.0/iu);
  assert.match(readme, /python tools\/serve\.py/u);
  assert.match(readme, /http:\/\/localhost:8000/u);
  assert.match(readme, /HTTPS/u);
});

test('readme explains all privacy modes and personal training lifecycle', () => {
  assert.match(readme, /Yalnızca cihazda/iu);
  assert.match(readme, /Akıllı hibrit/iu);
  assert.match(readme, /Bulut destekli/iu);
  assert.match(readme, /en az üç[^\n]*(örnek|kez)/iu);
  assert.match(readme, /ham (kamera )?görüntüsü[^\n]*(saklanmaz|kaydedilmez)/iu);
  assert.match(readme, /Tüm kişisel veriyi sil/iu);
  assert.match(readme, /API anahtar[^\n]*oturum[^\n]*(yazılmaz|temizlenir|tutulur)|oturum[^\n]*(API )?anahtar[^\n]*(saklanmaz|temizlenir|tutulur)/iu);
});

test('documentation distinguishes useful fallbacks from reviewed natural TID', () => {
  assert.match(readme, /sözlük poz/iu);
  assert.match(readme, /harf kart/iu);
  assert.match(readme, /doğal TİD[^\n]*(değildir|sayılmaz)/iu);
  assert.match(readme, /her (konuşmayı|cümleyi)[^\n]*(çevirmez|doğal TİD'e çeviremez)/iu);
  assert.doesNotMatch(readme, /tüm konuşmaları doğal TİD'e çevirir|eksiksiz TİD çevirisi|her cümleyi doğal TİD'e çevirir/iu);
});

test('NVIDIA candidate limits and browser speech caveat are explicit', () => {
  assert.match(readme, /NVIDIA[^\n]*(genel amaçlı|doğrulanmamış)/iu);
  assert.match(readme, /kısa klip[^\n]*(açık|ayrı)[^\n]*izin|(?:açık|ayrı)[^\n]*izin[^\n]*kısa klip/iu);
  assert.match(readme, /düzenlenebilir[^\n]*aday/iu);
  assert.match(readme, /kullanıcı[^\n]*onay/iu);
  assert.match(readme, /konuşma tanıma[^\n]*(internet|uzak hizmet)|tarayıcı[^\n]*konuşma[^\n]*(internet|uzak hizmet)/iu);
});

test('runtime and source asset licenses are recorded without the character model', () => {
  assert.match(assetNotices, /MediaPipe[^\n]*Apache-2\.0/iu);
  assert.match(assetNotices, /ONNX Runtime Web[^\n]*MIT/iu);
  assert.match(assetNotices, /Three\.js[^\n]*MIT/iu);
  assert.match(assetNotices, /saved-poses\.json[^\n]*MIT/iu);
  assert.match(assetNotices, /rain\.glb[\s\S]*?site paketinden çıkarılmış/iu);
});

test('evaluation reports keep the exact natural TID evidence gates open', () => {
  const reports = `${tidEvaluation}\n${cameraEvaluation}\n${fieldResults}`;
  assert.match(reports, /300[^\n]*(cümle|klip)/iu);
  assert.match(reports, /20[^\n]*(kişi|işaretleyici|imzalayan)/iu);
  assert.match(reports, /iki bağımsız[^\n]*TİD/iu);
  assert.match(reports, /%90/iu);
  assert.match(reports, /%5/iu);
  assert.match(reports, /30[^\n]*yüz yüze/iu);
  assert.match(reports, /Android[^\n]*(ölçülmedi|yapılmadı|bekliyor)/iu);
  assert.match(reports, /0\s*\/\s*300|300[^\n]*\|\s*0/iu);
  assert.match(reports, /123\s+(sözlük )?poz/iu);
  assert.match(reports, /0\s+(uzman onaylı )?(doğal )?TİD cümle|(uzman onaylı )?(doğal )?TİD cümle[^\n]*\|\s*0/iu);
});

test('Android checklist covers current camera, privacy, persistence, offline and deletion flows', () => {
  for (const phrase of [
    'Kamerayı aç', 'Durdur', 'Dinlemeyi başlat', 'Sen iyisin', 'harf kart',
    'en az üç', 'Tüm kişisel veriyi sil', 'çevrimdışı', 'Bulut destekli',
    'NVIDIA', 'TalkBack', 'Android Chrome',
  ]) assert.ok(checklist.toLocaleLowerCase('tr-TR').includes(phrase.toLocaleLowerCase('tr-TR')), `missing Android check: ${phrase}`);
  assert.match(checklist, /fiziksel Android[^\n]*(yapılmadı|bekliyor|doğrulanmadı)/iu);
  assert.match(checklist, /kamera izni[^\n]*düğme|düğme[^\n]*kamera izni/iu);
  assert.match(checklist, /kişisel[^\n]*(yeniden aç|kalıcı|saklan)/iu);
});

test('release inventory includes local runtime, personal recognition and cloud modules', () => {
  for (const asset of [
    'public/app.mjs', 'public/avatar.mjs', 'public/procedural-rig.mjs',
    'public/letter-cards.mjs', 'public/tid-display-plan.mjs',
    'public/assets/avatar/saved-poses.json', 'public/assets/runtime/runtime-manifest.json',
    'public/landmark-runtime.mjs', 'public/landmark-worker.js', 'public/landmark-normalization.mjs', 'public/mediapipe-fileset.mjs',
    'public/personal-sign-store.mjs', 'public/personal-training.mjs', 'public/personal-sign-recognizer.mjs',
    'public/hybrid-recognition.mjs', 'public/privacy-mode.mjs', 'public/cloud-session.mjs',
    'public/nvidia-candidate.mjs', 'public/service-worker.js', 'public/manifest.webmanifest',
    'public/vendor/mediapipe/LICENSE.txt', 'public/vendor/onnxruntime/LICENSE.txt',
    'public/vendor/three/LICENSE.txt',
  ]) assert.ok(checklist.includes(asset), `missing release inventory entry: ${asset}`);
});

test('authoring guide still requires independent review and keeps raw data private', () => {
  assert.match(authoringGuide, /two TİD reviewers|two separate.*TİD review/isu);
  assert.match(authoringGuide, /never approves candidates or creates playable entries/iu);
  assert.match(authoringGuide, /ham kamera.*Git|Git.*raw camera|raw camera.*Git/isu);
});
