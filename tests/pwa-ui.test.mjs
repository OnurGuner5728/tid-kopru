import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const app = await readFile(new URL('../public/app.mjs', import.meta.url), 'utf8');
const avatar = await readFile(new URL('../public/avatar.mjs', import.meta.url), 'utf8');
const tidOutput = await readFile(new URL('../public/tid-output-ui.mjs', import.meta.url), 'utf8');
const styles = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');

test('avatar retry is an accessible control beside the loading surface', () => {
  assert.match(html, /id="avatar-retry"[^>]*type="button"[^>]*aria-label="[^"]+"/u);
  assert.match(html, /id="pwa-status"[^>]*role="status"[^>]*aria-live="polite"/u);
});

test('public app uses the procedural avatar without requesting the unlicensed character model', () => {
  assert.doesNotMatch(app, /rain\.glb|AVATAR_MODEL_REDISTRIBUTION_APPROVED/u);
  assert.match(avatar, /createProceduralRig/u);
  assert.doesNotMatch(avatar, /GLTFLoader|rain\.glb/u);
});

test('avatar retry reuses one scene while Turkish translation requires explicit confirmation', () => {
  assert.match(app, /async function loadAvatar\(\)/u);
  assert.match(app, /elements\.avatarLoader\.hidden = false/u);
  assert.match(app, /elements\.avatarRetry\.disabled = true/u);
  assert.match(app, /elements\.avatarRetry\.hidden = false/u);
  assert.match(app, /elements\.avatarRetry\.addEventListener\('click', loadAvatar\)/u);
  assert.match(html, /id="confirm-turkish"[^>]*disabled/u);
  assert.match(html, /id="play-tid"[^>]*disabled[^>]*hidden/u);
  assert.match(app, /createTidOutputController/u);
  assert.match(app, /createTidDisplayPlan\(text, translationResources\)/u);
  assert.doesNotMatch(app, /matchText\(/u);
  assert.match(avatar, /if \(!this\.renderer\) this\.setupScene\(\)/u);
  assert.doesNotMatch(app, /elements\.(?:heardText|replyText)\.disabled\s*=\s*true/u);
});

test('translation and playback output announce status and progress accessibly', () => {
  assert.match(html, /id="tid-status"[^>]*role="status"[^>]*aria-live="polite"/u);
  assert.match(html, /id="tid-progress"[^>]*aria-live="polite"/u);
  assert.match(html, /id="stop-tid"[^>]*type="button"/u);
  assert.match(tidOutput, /onSegmentStart: \(segment\)/u);
});

test('speech failures explain microphone and network recovery paths', () => {
  for (const errorCode of ['not-allowed', 'service-not-allowed', 'no-speech', 'network']) {
    assert.ok(app.includes(`'${errorCode}':`) || app.includes(`${errorCode}:`), `missing speech error: ${errorCode}`);
  }
  assert.match(app, /SpeechRecognition|webkitSpeechRecognition/u);
  assert.match(app, /konuşma tanımayı desteklemiyor\. Metni elle yazabilirsiniz\./u);
  assert.match(app, /tidOutput\?\.setSpeechActive\(active\)/u);
  assert.doesNotMatch(app, /elements\.heardText\.disabled\s*=\s*true/u);
});

test('offline status explains which downloaded features remain available', () => {
  assert.match(app, /Çevrimdışı kullanımda daha önce indirilmiş onaylı TİD içeriği kullanılabilir/u);
  assert.match(app, /function renderPwaStatus\(\)/u);
  assert.match(app, /let pwaStatusMessage = '';/u);
});

test('keyboard focus, retry touch size, and reduced-motion handling remain visible', () => {
  assert.match(styles, /button:focus-visible[^\n]*a:focus-visible/u);
  assert.match(styles, /\.button, \.icon-button \{ min-height: 48px;/u);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/u);
  assert.match(styles, /\.avatar-retry\[hidden\] \{ display: none; \}/u);
});

test('speech permission failures remain visible after recognition ends', () => {
  assert.match(app, /let speechErrorMessage = '';/u);
  assert.match(app, /recognition\.addEventListener\('end', \(\) => setListeningState\(false, speechErrorMessage \|\| 'Hazır'\)\)/u);
  assert.match(app, /speechErrorMessage = messages\[event\.error\] \?\? 'Konuşma tanınamadı\.'/u);
});

test('first avatar fetch waits for service-worker control so its download can be cached', () => {
  assert.match(app, /function waitForServiceWorkerControl\(/u);
  assert.match(app, /navigator\.serviceWorker\.register\('\.\/service-worker\.js'\)[\s\S]*?finally\(loadAvatar\)/u);
  assert.doesNotMatch(app, /initializeTextToSpeech\(\);\s*loadAvatar\(\);/u);
});

test('privacy panel separates local hybrid cloud camera and microphone choices', () => {
  assert.match(html, /name="translation-mode"[^>]*value="local"[^>]*checked/u);
  assert.match(html, /name="translation-mode"[^>]*value="hybrid"/u);
  assert.match(html, /name="translation-mode"[^>]*value="cloud-assisted"/u);
  assert.match(html, /id="camera-disclosure"/u);
  assert.match(html, /id="microphone-disclosure"/u);
  assert.match(html, /id="cloud-disclosure"/u);
  assert.match(html, /id="cloud-consent"[^>]*type="checkbox"/u);
  assert.match(app, /createPrivacyModeController/u);
  assert.match(app, /initializePrivacyModes/u);
});

test('camera is available for personal on-device teaching without claiming universal translation', () => {
  assert.match(html, /id="teaching-panel"/u);
  assert.match(html, /id="camera-start"[^>]*>Kamerayı aç/u);
  assert.doesNotMatch(html, /<strong>Kamera kapalı\.<\/strong>/u);
  assert.match(html, /Kişisel işaret tanıma/u);
  assert.match(app, /createPersonalTrainer/u);
});
