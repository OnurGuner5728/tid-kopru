import test from 'node:test';
import assert from 'node:assert/strict';
import { createTidOutputController } from '../public/tid-output-ui.mjs';

class FakeElement {
  constructor(value = '') {
    this.value = value;
    this.textContent = '';
    this.hidden = false;
    this.disabled = false;
    this.dataset = {};
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  async click() {
    await Promise.all((this.listeners.get('click') ?? []).map((listener) => listener({ target: this })));
  }

  input() {
    for (const listener of this.listeners.get('input') ?? []) listener({ target: this });
  }
}

function makeFixture({ translateText, playerOverride = {}, autoPlayOnConfirm = false }) {
  const elements = Object.fromEntries([
    'input', 'confirmButton', 'playButton', 'stopButton', 'retryButton', 'sourceText', 'status', 'gloss', 'progress',
  ].map((name) => [name, new FakeElement()]));
  const calls = { translated: [], played: [], stopped: 0 };
  const player = {
    async play(segments, callbacks) {
      calls.played.push(segments);
      callbacks.onSegmentStart(segments[0]);
      return { status: 'completed' };
    },
    async stop() { calls.stopped += 1; },
    ...playerOverride,
  };
  const controller = createTidOutputController({
    ...elements,
    player,
    autoPlayOnConfirm,
    translateText: async (text) => {
      calls.translated.push(text);
      return translateText(text);
    },
  });
  return { elements, calls, player, controller };
}

const readyResult = (sourceText) => ({
  status: 'ready', sourceText, glossText: 'IYI SEN', segments: [{ kind: 'video', assetId: 'approved-clip' }], unsupported: [],
});

test('typed Turkish reaches the transfer engine unchanged only after explicit confirmation', async () => {
  const fixture = makeFixture({ translateText: (text) => readyResult(text) });
  fixture.elements.input.value = 'Sen iyisin';
  fixture.elements.input.input();
  assert.deepEqual(fixture.calls.translated, []);
  assert.deepEqual(fixture.calls.played, []);

  await fixture.elements.confirmButton.click();
  assert.deepEqual(fixture.calls.translated, ['Sen iyisin']);
  assert.equal(fixture.elements.sourceText.textContent, 'Sen iyisin');
  assert.equal(fixture.elements.playButton.disabled, false);
  assert.equal(fixture.calls.played.length, 0);

  await fixture.elements.playButton.click();
  assert.equal(fixture.calls.played.length, 1);
  assert.match(fixture.elements.progress.textContent, /1 \/ 1/u);
});

test('interim and final microphone text remain editable and wait for the same explicit confirmation', async () => {
  const fixture = makeFixture({ translateText: (text) => readyResult(text) });
  fixture.controller.setSpeechActive(true);
  fixture.elements.input.value = 'Sen iyi';
  fixture.elements.input.input();
  fixture.elements.input.value = 'Sen iyisin';
  fixture.elements.input.input();
  assert.equal(fixture.elements.confirmButton.disabled, true);
  await fixture.elements.confirmButton.click();
  assert.deepEqual(fixture.calls.translated, []);
  fixture.controller.setSpeechActive(false);
  assert.equal(fixture.elements.confirmButton.disabled, false);
  assert.deepEqual(fixture.calls.translated, []);
  await fixture.elements.confirmButton.click();
  assert.deepEqual(fixture.calls.translated, ['Sen iyisin']);
});

test('unsupported text has no playable control and never calls the player', async () => {
  const fixture = makeFixture({ translateText: (sourceText) => ({
    status: 'unsupported', sourceText, glossText: '', segments: [], unsupported: [{ surface: 'evin', reason: 'ambiguous_analysis' }],
  }) });
  fixture.elements.input.value = 'evin';
  await fixture.elements.confirmButton.click();
  assert.equal(fixture.elements.playButton.disabled, true);
  assert.equal(fixture.elements.playButton.hidden, true);
  await fixture.elements.playButton.click();
  assert.deepEqual(fixture.calls.played, []);
  assert.equal(fixture.elements.status.dataset.state, 'unsupported');
});

test('a malformed ready result without media fails closed', async () => {
  const fixture = makeFixture({ translateText: (sourceText) => ({
    status: 'ready', sourceText, glossText: 'IYI SEN', segments: [], unsupported: [],
  }) });
  fixture.elements.input.value = 'Sen iyisin';
  await fixture.elements.confirmButton.click();
  assert.equal(fixture.elements.status.dataset.state, 'error');
  assert.equal(fixture.elements.playButton.hidden, true);
  await fixture.elements.playButton.click();
  assert.deepEqual(fixture.calls.played, []);
});

test('text-only output is labeled as written gloss and cannot be mistaken for animation', async () => {
  const fixture = makeFixture({ translateText: (sourceText) => ({
    status: 'text-only', sourceText, glossText: 'EV BENİM', segments: [], unsupported: [],
  }) });
  fixture.elements.input.value = 'evim';
  await fixture.elements.confirmButton.click();
  assert.match(fixture.elements.gloss.textContent, /yalnızca yazılı gloss/iu);
  assert.match(fixture.elements.status.textContent, /işaret hareketi yok/u);
  assert.equal(fixture.elements.playButton.hidden, true);
  assert.deepEqual(fixture.calls.played, []);
});

test('stop calls the media player and returns the view to a ready result', async () => {
  let finishPlayback;
  const fixture = makeFixture({
    translateText: (text) => readyResult(text),
    playerOverride: {
      play: async (_segments, callbacks) => {
        fixture?.calls.played.push(_segments);
        callbacks.onSegmentStart(_segments[0]);
        return new Promise((resolve) => { finishPlayback = resolve; });
      },
      stop: async () => { fixture.calls.stopped += 1; finishPlayback({ status: 'stopped' }); },
    },
  });
  fixture.elements.input.value = 'Sen iyisin';
  await fixture.elements.confirmButton.click();
  const playPending = fixture.elements.playButton.click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fixture.elements.stopButton.hidden, false);
  await fixture.elements.stopButton.click();
  await playPending;
  assert.equal(fixture.calls.stopped, 1);
  assert.equal(fixture.elements.stopButton.hidden, true);
  assert.equal(fixture.elements.playButton.disabled, false);
});

test('editing a confirmed transcript invalidates its stale playable result without disabling typed input', async () => {
  const fixture = makeFixture({ translateText: (text) => readyResult(text) });
  fixture.elements.input.value = 'Sen iyisin';
  await fixture.elements.confirmButton.click();
  fixture.elements.input.value = 'Sen iyi değil misin?';
  fixture.elements.input.input();
  assert.equal(fixture.elements.input.disabled, false);
  assert.equal(fixture.elements.playButton.disabled, true);
  assert.equal(fixture.elements.status.dataset.state, 'idle');
  await fixture.elements.playButton.click();
  assert.deepEqual(fixture.calls.played, []);
});

test('translation errors preserve the editable text and expose a retry action', async () => {
  const fixture = makeFixture({ translateText: () => { throw new Error('offline'); } });
  fixture.elements.input.value = 'Sen iyisin';
  await fixture.elements.confirmButton.click();
  assert.equal(fixture.elements.status.dataset.state, 'error');
  assert.equal(fixture.elements.input.disabled, false);
  assert.equal(fixture.elements.retryButton.hidden, false);
  assert.equal(fixture.elements.playButton.disabled, true);
});

test('failed media playback can be retried from the error state', async () => {
  let attempts = 0;
  const fixture = makeFixture({
    translateText: (text) => readyResult(text),
    playerOverride: {
      play: async (_segments, callbacks) => {
        attempts += 1;
        if (attempts === 1) throw new Error('temporary media failure');
        callbacks.onSegmentStart(_segments[0]);
        return { status: 'completed' };
      },
    },
  });
  fixture.elements.input.value = 'Sen iyisin';
  await fixture.elements.confirmButton.click();
  await fixture.elements.playButton.click();
  assert.equal(fixture.elements.status.dataset.state, 'error');
  assert.equal(fixture.elements.retryButton.hidden, false);
  await fixture.elements.retryButton.click();
  assert.equal(attempts, 2);
  assert.equal(fixture.elements.status.dataset.state, 'ready');
  assert.equal(fixture.elements.playButton.hidden, false);
});

test('microphone denial does not disable manual typing or confirmation when resources are available', async () => {
  const fixture = makeFixture({ translateText: (text) => readyResult(text) });
  fixture.controller.setSpeechActive(false);
  fixture.controller.setError('Mikrofon izni verilmedi. Metni elle yazabilirsiniz.');
  fixture.elements.input.value = 'Sen iyisin';
  fixture.elements.input.input();
  assert.equal(fixture.elements.input.disabled, false);
  assert.equal(fixture.elements.confirmButton.disabled, false);
  await fixture.elements.confirmButton.click();
  assert.deepEqual(fixture.calls.translated, ['Sen iyisin']);
});

test('typing while translation resources are loading does not enable premature confirmation', () => {
  const fixture = makeFixture({ translateText: (text) => readyResult(text) });
  fixture.controller.setLoading();
  fixture.elements.input.value = 'Sen iyisin';
  fixture.elements.input.input();
  assert.equal(fixture.elements.input.disabled, false);
  assert.equal(fixture.elements.confirmButton.disabled, true);
  assert.equal(fixture.elements.status.dataset.state, 'loading');
  assert.deepEqual(fixture.calls.translated, []);
});

test('confirmed speech starts the available visual sequence without a second tap', async () => {
  const fixture = makeFixture({ translateText: (text) => readyResult(text), autoPlayOnConfirm: true });
  fixture.elements.input.value = 'Sen iyisin';
  fixture.elements.input.input();
  await fixture.elements.confirmButton.click();
  assert.deepEqual(fixture.calls.translated, ['Sen iyisin']);
  assert.equal(fixture.calls.played.length, 1);
});

test('fallback output is labeled without claiming expert-approved TİD', async () => {
  const fixture = makeFixture({ translateText: (sourceText) => ({
    status: 'ready', sourceText, sourceClass: 'fallback-cards', glossText: 'IYI',
    segments: [{ kind: 'letter-card', label: 'X' }], unsupported: [],
  }) });
  fixture.elements.input.value = 'iyi x';
  await fixture.elements.confirmButton.click();
  assert.match(fixture.elements.gloss.textContent, /Harf kartları/u);
  assert.doesNotMatch(fixture.elements.status.textContent, /uzman onaylı doğal TİD cümlesidir/u);
  assert.equal(fixture.elements.playButton.disabled, false);
});
