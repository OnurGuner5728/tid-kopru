# TİD Köprü Offline Turkish Speech Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional Turkish speech-to-text mode that runs locally in the installed PWA after the user downloads its model, with honest quality and privacy status.

**Architecture:** First prove the browser worker/WASM path with Vosk's 35 MB Turkish model. If the worker can run in Android Chrome, vendor a pinned runtime and the model as explicit optional assets; the main page sends audio frames to a worker and receives partial/final text. Keep manual entry and browser-native recognition as separate fallbacks. Do not add a speech server.

**Tech Stack:** Static browser ES modules, Web Workers/WebAssembly, Cache API, Vosk `vosk-model-small-tr-0.3`, Node.js built-in `node:test`, Python standard-library archive tooling.

**Spec:** `docs/superpowers/specs/2026-09-25-tid-kopru-design.md` (sections B, Verification, Scope)

## Global Constraints

- No paid API, account, speech server, or audio upload.
- User speech audio is processed locally and not persisted.
- The existing browser-native speech recognizer remains clearly identified as potentially network-backed.
- Model download is explicit, optional, progress-reporting, retryable, and excluded from the initial PWA app-shell cache.
- Keep final text editable; never treat recognition as confirmed communication without the user's review.
- Do not commit the downloaded model, audio recordings, or participant transcripts.

## Review Focus

- The first model download must show progress, survive interruption, and allow retry without disabling manual input.
- After download, airplane-mode recognition must make no network request.
- Unsupported browsers, denied microphone permission, missing model, and worker crash must produce a usable manual fallback.
- The audio worker must stop tracks and release model memory when stopped or the page closes.
- Recognition results must not silently overwrite user-edited text or append a duplicate final transcript.

---

### Task 1: Build a reproducible local model package and browser probe

**Files:**
- Create: `tools/offline_speech/__init__.py`
- Create: `tools/offline_speech/prepare_model.py`
- Create: `tools/offline_speech/probe/index.html`
- Create: `tools/offline_speech/probe/main.mjs`
- Create: `tools/offline_speech/README.md`
- Create: `.gitignore` entries for downloaded model packages and local recordings.

**Interfaces:**
- Produces: `python -m tools.offline_speech.prepare_model INPUT_ZIP OUTPUT_TAR_GZ` validates archive paths, extracts the Vosk model into the archive's expected top-level directory, writes a USTAR/GZIP archive accepted by the selected browser wrapper, and prints file count and output bytes. Model binaries stay outside Git.
- Probe candidate: [`vosk-browser@0.0.5`](https://github.com/ccoreilly/vosk-browser), an Apache-2.0 browser WebAssembly wrapper; it is a compatibility candidate, not an official guarantee of Android PWA support. The Turkish model size/license/quality metadata comes from the [Vosk model catalog](https://alphacephei.com/vosk/models), which lists the Turkish model at 35 MB and does not publish a WER for it.

- [ ] **Step 1: Write archive validation tests**

Create `tests/test_offline_speech_package.py` with standard-library `unittest`. Use a temporary zip containing `model/conf/model.conf`, assert the output archive has a single `model/` root and contains the expected relative file, and assert an input member `../../outside.txt` is rejected without writing outside the temporary directory.

- [ ] **Step 2: Run the focused tests and verify the missing package function fails**

Run: `python -m unittest discover -s tests -p "test_offline_speech_package.py" -v`.  
Expected: FAIL because `tools.offline_speech.prepare_model` does not yet exist.

- [ ] **Step 3: Implement safe archive conversion**

Implement `build_model_archive(source_zip: Path, output_tar_gz: Path) -> tuple[int, int]`. Resolve every output member under the intended model root before extraction; reject absolute paths and any `..` component; write the output tar with `tarfile.USTAR_FORMAT`; return `(member_count, output_size_bytes)`.

- [ ] **Step 4: Run the archive and traversal tests**

Run: `python -m unittest discover -s tests -p "test_offline_speech_package.py" -v`.  
Expected: PASS; the unsafe archive creates no file outside the temporary directory.

- [ ] **Step 5: Create the probe with locally served runtime/model paths**

The probe has only `Load model`, `Start`, and `Stop` controls, model-load progress, partial/final transcript output, and a visible offline/local processing indicator. It serves all runtime files from its own origin and captures no audio to disk. Add an attribution file with the exact pinned wrapper version and its license.

- [ ] **Step 6: Record probe results on desktop Chrome and Android Chrome**

Test load, microphone start/stop, Turkish partial/final text, page close, airplane-mode reuse, and memory recovery after stop. Record device/browser and whether the model loaded, without retaining audio. If the first wrapper cannot run on Android Chrome, evaluate one other free on-device WebAssembly recognizer using the same model and prompts. If neither runs locally, stop this plan and report the blocker rather than selecting a cloud service.

- [ ] **Step 7: Commit the probe and packaging utility**

```powershell
git add .gitignore tools/offline_speech tests/test_offline_speech_package.py
git commit -m "spike: verify offline Turkish speech in browser"
```

### Task 2: Add a repeatable transcript-quality evaluator

**Files:**
- Create: `tools/offline_speech/evaluate.mjs`
- Create: `tests/offline-speech-evaluate.test.mjs`
- Create: `tools/offline_speech/phrases.tsv` with 100 short, consent-free, non-sensitive Turkish prompts.
- Create: `docs/offline-speech-results.json` only after an actual measurement.

**Interfaces:**
- Produces: `wordErrorRate(reference, hypothesis)` returns a number; Turkish text uses `tokenize` from `public/matcher.mjs`. `evaluateResults(rows)` accepts an array of `{ reference, hypothesis }` strings and returns `{ utterances, wordErrors, referenceWords, wer }`.

- [ ] **Step 1: Write evaluator tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { wordErrorRate } from '../tools/offline_speech/evaluate.mjs';

test('identical Turkish text has zero word error rate', () => {
  assert.equal(wordErrorRate('İyi günler', 'iyi günler'), 0);
});

test('one substitution in four words has 25 percent WER', () => {
  assert.equal(wordErrorRate('bugün hava çok güzel', 'bugün hava çok iyi'), 0.25);
});

test('empty reference with non-empty hypothesis reports full error', () => {
  assert.equal(wordErrorRate('', 'merhaba'), 1);
});

test('two empty texts have zero error rate', () => {
  assert.equal(wordErrorRate('', ''), 0);
});
```

- [ ] **Step 2: Run the focused test and verify the evaluator import fails**

Run: `node --test tests/offline-speech-evaluate.test.mjs`  
Expected: FAIL because `evaluate.mjs` is not present.

- [ ] **Step 3: Implement word-level Levenshtein WER**

Implement a two-row dynamic-programming word edit-distance function in `evaluate.mjs`; reuse `tokenize` from `public/matcher.mjs` and compare each token's `normalized` field. Return `errors / referenceWords`, `0` for two empty inputs, and `1` for empty reference/non-empty hypothesis.

- [ ] **Step 4: Run evaluator tests**

Run: `node --test tests/offline-speech-evaluate.test.mjs`.  
Expected: PASS, 4 tests.

- [ ] **Step 5: Measure 100 utterances without storing audio**

For each prompt, a consenting tester speaks once in a normal conversational voice; save only reference text, recognized text, device/browser, and timing. Compute WER and p50/p95 processing time. Do not keep raw microphone audio. Compare with browser-native recognition on the same prompts when it is available.

- [ ] **Step 6: Apply the release decision**

Expose the offline mode as an experimental option only when it works after model download in airplane mode, makes no audio network request, and completes processing faster than real time on the target Android phone. If WER exceeds 25% on the 100-prompt sample or is more than 5 percentage points worse than the browser-native baseline, test one other free on-device WebAssembly recognizer on the same prompts. If neither option meets the gate, keep offline recognition out of the released app and document the blocker.

- [ ] **Step 7: Commit evaluator and anonymized aggregate results**

```powershell
git add tools/offline_speech/evaluate.mjs tools/offline_speech/phrases.tsv tests/offline-speech-evaluate.test.mjs docs/offline-speech-results.json
git commit -m "test: measure local Turkish speech quality"
```

### Task 3: Integrate the optional local recognizer into the PWA

**Files:**
- Create: `public/offline-speech.mjs`
- Create: `public/offline-speech-worker.js`
- Create: `public/audio-capture-worklet.js`
- Create: `public/vendor/vosk-browser/` pinned runtime files and license notice.
- Modify: `public/index.html`
- Modify: `public/app.mjs`
- Modify: `public/styles.css`
- Modify: `public/service-worker.js`
- Create: `tests/offline-speech-client.test.mjs`

**Interfaces:**
- Produces: `OfflineSpeechClient.load({ onProgress })`, `.start({ onPartial, onFinal, onError })`, `.stop()`, and `.dispose()`.
- Worker messages are exactly `{ type: 'load', modelUrl }`, `{ type: 'start' }`, `{ type: 'audio', samples }`, `{ type: 'stop' }`; responses are `{ type: 'progress', loaded, total }`, `{ type: 'ready' }`, `{ type: 'partial', text }`, `{ type: 'final', text }`, and `{ type: 'error', code }`.

- [ ] **Step 1: Test the main-thread client against a fake worker**

Test that `load` resolves only after `ready`, progress is forwarded, partial/final messages reach the correct callback, `stop` posts one stop message, and worker errors reject or reach `onError` without clearing editable text.

- [ ] **Step 2: Run the focused test and verify it fails before implementation**

Run: `node --test tests/offline-speech-client.test.mjs`.  
Expected: FAIL because `OfflineSpeechClient` is not defined.

- [ ] **Step 3: Implement the client and worker protocol**

Implement `OfflineSpeechClient` with an injectable `workerFactory` for tests. The main thread obtains the microphone, `audio-capture-worklet.js` converts input to transferable mono `Float32Array` blocks, and the speech worker resamples to 16 kHz before inference. The worker loads the pinned local WASM runtime and model, sends partial/final results, and releases model memory on stop/dispose. Main-thread stop/dispose stops every media track and closes the `AudioContext`. Reject messages outside the protocol above.

- [ ] **Step 4: Add the explicit download and speech-mode controls**

Add an optional “Çevrimdışı konuşma modelini indir” button and a mode choice for “Tarayıcı konuşma tanıma” and “Cihazda çevrimdışı tanıma”. The download is user initiated and reports progress, success, retry, and available storage failure. Manual text is always available. Keep the app-shell cache small; cache the model only after the user explicitly downloads it.

- [ ] **Step 5: Integrate transcript replacement without clobbering user edits**

In `public/app.mjs`, track whether the text field changed after recognition started. Append partial/final results only to the current recognition segment; stopping the recognizer finalizes once. If the user edits during recognition, pause result insertion and show “Metin elle düzenlendi”; do not overwrite the field.

- [ ] **Step 6: Run all local tests and the source checks**

Run: `npm test` and `npm run check`.  
Expected: PASS, including matcher, service-worker, evaluator, and speech-client tests.

- [ ] **Step 7: Verify airplane-mode and memory release on Android Chrome**

Download the model once, enable airplane mode, restart the PWA, transcribe prompts, stop recognition, and confirm the microphone indicator turns off. Inspect the browser network panel during recognition; there must be no request. Record device/browser and memory results in `docs/offline-speech-results.json`.

- [ ] **Step 8: Commit the optional recognizer integration**

```powershell
git add public/offline-speech.mjs public/offline-speech-worker.js public/audio-capture-worklet.js public/vendor/vosk-browser public/index.html public/app.mjs public/styles.css public/service-worker.js tests/offline-speech-client.test.mjs docs/offline-speech-results.json
git commit -m "feat: add optional offline Turkish speech mode"
```
