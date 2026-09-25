import assert from 'node:assert/strict';
import test from 'node:test';

import {
  TRANSLATION_MODES,
  createPrivacyModeController,
  stopMediaStream,
} from '../public/privacy-mode.mjs';

test('privacy mode defaults to local and never grants cloud consent implicitly', () => {
  const changes = [];
  const controller = createPrivacyModeController({ onChange: (state) => changes.push(state) });

  assert.deepEqual(controller.getState(), { mode: 'local', cloudConsent: false });
  controller.setMode(TRANSLATION_MODES.HYBRID);
  assert.deepEqual(controller.getState(), { mode: 'hybrid', cloudConsent: false });
  controller.grantCloudConsent();
  assert.equal(controller.getState().cloudConsent, true);
  controller.setMode(TRANSLATION_MODES.LOCAL);
  assert.deepEqual(controller.getState(), { mode: 'local', cloudConsent: false });
  controller.revokeCloudConsent();
  assert.equal(changes.at(-1).cloudConsent, false);
});

test('stopMediaStream stops every track once across repeated cleanup', () => {
  const calls = [0, 0, 0];
  const tracks = calls.map((_, index) => ({ stop: () => { calls[index] += 1; } }));
  const stream = { getTracks: () => tracks };

  stopMediaStream(stream);
  stopMediaStream(stream);

  assert.deepEqual(calls, [1, 1, 1]);
});

test('pagehide and hidden visibility dispose registered resources', () => {
  const pageTarget = new EventTarget();
  const documentTarget = new EventTarget();
  Object.defineProperty(documentTarget, 'visibilityState', { value: 'visible', writable: true });
  let pageHideDisposals = 0;
  const first = createPrivacyModeController({ pageTarget, documentTarget });
  first.registerDisposer(() => { pageHideDisposals += 1; });
  pageTarget.dispatchEvent(new Event('pagehide'));
  pageTarget.dispatchEvent(new Event('pagehide'));
  assert.equal(pageHideDisposals, 1);

  let hiddenDisposals = 0;
  const second = createPrivacyModeController({ pageTarget, documentTarget });
  second.registerDisposer(() => { hiddenDisposals += 1; });
  documentTarget.visibilityState = 'hidden';
  documentTarget.dispatchEvent(new Event('visibilitychange'));
  assert.equal(hiddenDisposals, 1);
});

test('invalid translation modes fail closed', () => {
  const controller = createPrivacyModeController();
  assert.throws(() => controller.setMode('always-upload'), /invalid_translation_mode/);
  assert.deepEqual(controller.getState(), { mode: 'local', cloudConsent: false });
});
