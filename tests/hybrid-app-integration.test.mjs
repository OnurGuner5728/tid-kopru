import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createAppStateMachine } from '../public/app-state.mjs';

test('camera flow exposes only the approved application states', () => {
  const seen = [];
  const machine = createAppStateMachine({ onChange: (state) => seen.push(state) });
  for (const state of ['requesting-permission', 'capturing', 'processing', 'candidate', 'playing', 'idle']) machine.transition(state);
  assert.deepEqual(seen, ['idle', 'requesting-permission', 'capturing', 'processing', 'candidate', 'playing', 'idle']);
  assert.throws(() => machine.transition('secret-upload'), { code: 'invalid_app_state' });
});

test('public app composes local landmarks, personal recognition, display fallback, and consented cloud', async () => {
  const source = await readFile(new URL('../public/app.mjs', import.meta.url), 'utf8');
  for (const dependency of [
    'createLandmarkRuntime', 'createPersonalSignStore', 'createPersonalTrainer',
    'createPersonalRecognitionBackend', 'createHybridRecognizer', 'createNvidiaCandidateProvider',
    'createTidDisplayPlan', 'renderLetterCards', 'createAppStateMachine',
  ]) assert.match(source, new RegExp(dependency, 'u'));
  assert.match(source, /privacyController\.getState\(\)/u);
  assert.match(source, /navigator\.mediaDevices\.getUserMedia/u);
  assert.match(source, /cloudSession\.withKey/u);
});

test('UI exposes candidate source, cancellation, replay controls, and personal-data deletion', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  for (const id of ['camera-stop', 'camera-candidate-source', 'playback-speed', 'repeat-tid', 'step-tid', 'teaching-clear']) {
    assert.match(html, new RegExp(`id="${id}"`, 'u'));
  }
  assert.match(html, /kişisel işaret/iu);
  assert.match(html, /uzman onaylı doğal TİD değildir/u);
});
