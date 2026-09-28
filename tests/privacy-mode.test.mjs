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

test('pagehide disposes resources while hidden visibility suspends without disabling reuse', () => {
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
  let suspensions = 0;
  const second = createPrivacyModeController({ pageTarget, documentTarget, onSuspend: () => { suspensions += 1; } });
  second.registerDisposer(() => { hiddenDisposals += 1; });
  second.setMode(TRANSLATION_MODES.HYBRID);
  second.grantCloudConsent();
  documentTarget.visibilityState = 'hidden';
  documentTarget.dispatchEvent(new Event('visibilitychange'));
  assert.equal(hiddenDisposals, 0);
  assert.equal(suspensions, 1);
  assert.equal(second.getState().cloudConsent, false);
  second.setMode(TRANSLATION_MODES.LOCAL);
  documentTarget.visibilityState = 'visible';
  documentTarget.dispatchEvent(new Event('visibilitychange'));
  assert.equal(suspensions, 1);
  second.dispose();
  assert.equal(hiddenDisposals, 1);
});

test('privacy disposal clears consent in the UI and reports the one-way shutdown', () => {
  const changes = [];
  let shutdowns = 0;
  const controller = createPrivacyModeController({
    onChange: (state) => changes.push(state),
    onDispose: () => { shutdowns += 1; },
    pageTarget: new EventTarget(),
    documentTarget: new EventTarget(),
  });
  controller.setMode(TRANSLATION_MODES.HYBRID);
  controller.grantCloudConsent();

  controller.dispose();
  controller.dispose();

  assert.deepEqual(changes.at(-1), { mode: 'hybrid', cloudConsent: false });
  assert.equal(shutdowns, 1);
});

test('invalid translation modes fail closed', () => {
  const controller = createPrivacyModeController();
  assert.throws(() => controller.setMode('always-upload'), /invalid_translation_mode/);
  assert.deepEqual(controller.getState(), { mode: 'local', cloudConsent: false });
});
