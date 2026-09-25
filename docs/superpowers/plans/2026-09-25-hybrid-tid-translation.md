# Hybrid TİD Translation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship one installable TİD Köprü PWA that combines local privacy-first camera capture, personal on-device sign learning, downloadable ONNX support, optional NVIDIA video candidates, Turkish morphology, dictionary pose playback, and explicit fallbacks for unsupported language.

**Architecture:** Keep GitHub Pages as the application host and move each responsibility into a focused browser module. Local mode extracts landmarks and stores personal examples only in IndexedDB; hybrid mode combines personal, verified ONNX, and explicitly consented cloud candidates through one result contract. Turkish output uses reviewed content first, SignBridge dictionary poses second, and visibly labeled letter cards last.

**Tech Stack:** Vanilla JavaScript ES modules, Web APIs, IndexedDB, MediaStream/MediaRecorder, MediaPipe Tasks Vision 1.0.1, ONNX Runtime Web 1.30.0, Three.js, Node test runner, Python unittest, GitHub Pages

**Spec:** `docs/superpowers/specs/2026-09-25-hybrid-tid-translation-design.md`

## Global Constraints

- Default mode is `local`; camera frames, audio, landmarks, text, and personal examples leave the device only after separate cloud consent.
- Camera and microphone access starts only from a user gesture and every stream track must stop on stop, page hide, or disposal.
- Never place an API key in source, Git history, service-worker caches, IndexedDB, localStorage, or sessionStorage.
- The previously shared NVIDIA key is not used; cloud mode accepts a fresh session-only key or a configured secure proxy.
- Keep `rain.glb` out of the public bundle and preserve the SignBridge and Three.js license notices.
- Label reviewed TİD, dictionary/letter-card display, personal-model output, ONNX output, and cloud output as distinct source classes.
- Generic VLM output always has `needsConfirmation: true` and is never labeled as verified TİD.
- Hash and license metadata are mandatory for downloadable runtime, model, and reviewed media assets.
- The public site must work under the `/tid-kopru/` GitHub Pages base path and retain an offline shell.
- Do not claim unrestricted natural TİD translation until all product gates in section 7.2 of the spec pass.

## Review Focus

- Permission denial: camera or microphone denial leaves text input, speech output, and local dictionary display usable.
- Partial landmarks: missing one hand, face, or pose data produces guidance or a rejected sample without crashing the capture loop.
- Storage failure: private/incognito IndexedDB failure keeps one-session recognition usable and explains that training will not persist.
- Cloud failure: timeout, CORS, malformed JSON, invalid key, or offline state preserves the local candidate and never retries media automatically.
- Turkish unknowns: punctuation, Turkish dotted/dotless I, apostrophized names, emoji, and unsupported suffixes produce deterministic letter cards or a visible unsupported segment.

---

### Task 1: Vendor and Verify Browser Runtimes

**Files:**
- Modify: `package.json`
- Create: `tools/vendor_browser_runtime.mjs`
- Create: `tools/runtime-sources.json`
- Create: `public/assets/runtime/runtime-manifest.json`
- Create: `public/vendor/mediapipe/LICENSE.txt`
- Create: `public/vendor/onnxruntime/LICENSE.txt`
- Modify: `.gitignore`
- Create: `tests/runtime-assets.test.mjs`

**Interfaces:**
- Consumes: npm packages `@mediapipe/tasks-vision@1.0.1` and `onnxruntime-web@1.30.0`.
- Produces: `npm run vendor:runtime`; `runtime-manifest.json` entries shaped as `{ path, sha256, license, bytes }` for every published runtime and landmark model file.

- [ ] **Step 1: Write the failing runtime asset test**

Add tests named `runtime manifest pins licensed files and hashes` and `vendor script rejects an unlisted output`. Assert Apache-2.0 for MediaPipe, MIT for ONNX Runtime, lowercase 64-character SHA-256 values, same-origin relative paths, and positive byte counts.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `node --test tests/runtime-assets.test.mjs`

Expected: FAIL because the manifest and vendor script do not exist.

- [ ] **Step 3: Add pinned dependencies and the vendor script**

Add exact dependency versions and implement `tools/vendor_browser_runtime.mjs` to copy only the browser ESM/WASM files required by the app. Add the official MediaPipe Hand Landmarker, Pose Landmarker Lite, and Face Landmarker task URLs to `runtime-sources.json`; the vendor script downloads those Apache-2.0 model assets, calculates SHA-256, copies upstream notices, and writes a canonical manifest. Do not download or publish a TİD sentence model in this task.

- [ ] **Step 4: Generate assets and run the focused test**

Run: `npm install --package-lock-only && npm install && npm run vendor:runtime && node --test tests/runtime-assets.test.mjs`

Expected: PASS and every manifest hash matches the generated file.

- [ ] **Step 5: Commit the verified runtime bundle**

Run: `git add package.json package-lock.json .gitignore tools/vendor_browser_runtime.mjs tools/runtime-sources.json public/assets/runtime public/vendor/mediapipe public/vendor/onnxruntime tests/runtime-assets.test.mjs && git commit -m "build: vendor verified browser inference runtimes"`

### Task 2: Add Privacy Modes and Permission Lifecycle

**Files:**
- Create: `public/privacy-mode.mjs`
- Modify: `public/index.html`
- Modify: `public/styles.css`
- Modify: `public/app.mjs`
- Create: `tests/privacy-mode.test.mjs`
- Modify: `tests/pwa-ui.test.mjs`

**Interfaces:**
- Consumes: browser `MediaStream`, `document.visibilityState`, and in-memory application state.
- Produces: `TRANSLATION_MODES`, `createPrivacyModeController({ initialMode, onChange })`, `stopMediaStream(stream)`, and controller methods `setMode(mode)`, `grantCloudConsent()`, `revokeCloudConsent()`, `dispose()`.

- [ ] **Step 1: Write failing mode and stream lifecycle tests**

Test that the default is `local`, cloud consent starts false, changing mode does not itself grant consent, revocation clears consent, every track is stopped once, and `pagehide`/hidden visibility calls disposal. Extend the UI test to require the local, hybrid, and cloud-assisted choices plus separate camera, microphone, and cloud disclosures.

- [ ] **Step 2: Run the focused tests and verify failure**

Run: `node --test tests/privacy-mode.test.mjs tests/pwa-ui.test.mjs`

Expected: FAIL because the controller and new controls are absent.

- [ ] **Step 3: Implement the controller and UI**

Use exact mode values `local`, `hybrid`, and `cloud-assisted`. Keep consent and keys in closure state only. Add a compact privacy panel showing what stays on device and what can be sent in the selected mode. Wire existing camera and microphone shutdown into one disposal path.

- [ ] **Step 4: Run focused tests**

Run: `node --test tests/privacy-mode.test.mjs tests/pwa-ui.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit the privacy controls**

Run: `git add public/privacy-mode.mjs public/index.html public/styles.css public/app.mjs tests/privacy-mode.test.mjs tests/pwa-ui.test.mjs && git commit -m "feat: add explicit local and hybrid privacy modes"`

### Task 3: Replace the Unlicensed Character With a Procedural Rig

**Files:**
- Create: `public/procedural-rig.mjs`
- Modify: `public/avatar.mjs`
- Create: `public/letter-cards.mjs`
- Modify: `public/index.html`
- Modify: `public/styles.css`
- Create: `tests/procedural-rig.test.mjs`
- Create: `tests/letter-cards.test.mjs`

**Interfaces:**
- Consumes: Three.js and `public/assets/avatar/saved-poses.json` bone rotations.
- Produces: `createProceduralRig(THREE) -> { root, bones, baseRotations }`; `splitTurkishGraphemes(text) -> string[]`; `createLetterCardSegments(token) -> DisplaySegment[]` where a segment is `{ kind: 'letter-card', label, source: 'fallback' }`.

- [ ] **Step 1: Write failing rig and Turkish grapheme tests**

Assert the rig exposes every bone name used by all 123 pose records, has no GLTF dependency, and can reset to base rotations. Assert grapheme output preserves `Ç Ğ I İ Ö Ş Ü`, removes control characters, retains apostrophized names, and converts emoji to one visible unsupported card rather than throwing.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `node --test tests/procedural-rig.test.mjs tests/letter-cards.test.mjs`

Expected: FAIL because both modules are missing.

- [ ] **Step 3: Build the procedural rig and letter cards**

Build a neutral head, torso, upper/lower arms, hands, and articulated fingers from Three.js primitives. Keep `SignAvatar` as the public class, but have `initialize()` load poses and attach the procedural rig without requesting `rain.glb`. Add a DOM letter-card renderer for tokens with no dictionary pose.

- [ ] **Step 4: Run focused and existing avatar-adjacent tests**

Run: `node --test tests/procedural-rig.test.mjs tests/letter-cards.test.mjs tests/tid-media-player.test.mjs tests/tid-output-ui.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit the public display fallback**

Run: `git add public/procedural-rig.mjs public/avatar.mjs public/letter-cards.mjs public/index.html public/styles.css tests/procedural-rig.test.mjs tests/letter-cards.test.mjs && git commit -m "feat: render dictionary poses without licensed character asset"`

### Task 4: Produce a Total Turkish Display Plan

**Files:**
- Create: `public/tid-display-plan.mjs`
- Modify: `public/turkish-morphology.mjs`
- Modify: `public/tid-transfer.mjs`
- Modify: `public/tid-output-ui.mjs`
- Modify: `public/tid-media-player.mjs`
- Create: `tests/tid-display-plan.test.mjs`
- Modify: `tests/turkish-morphology.test.mjs`
- Modify: `tests/tid-transfer.test.mjs`
- Modify: `tests/tid-output-ui.test.mjs`

**Interfaces:**
- Consumes: `analyzeTurkishText(text, lexicon)`, reviewed entries, the 123 pose names, and `createLetterCardSegments(token)`.
- Produces: `createTidDisplayPlan(text, resources) -> { sourceText, sourceClass, featureSummary, segments, warnings, playable }`; segment kinds `reviewed-media`, `dictionary-pose`, `letter-card`, and `unsupported`.

- [ ] **Step 1: Write failing end-to-end planning tests**

Cover `Sen iyisin`, `Ben iyi değilim`, `Annemin telefonu`, `Yarın okula gidecek misin?`, `Onur'un kahvesi`, punctuation-only input, emoji, and an unknown word. Assert reviewed media wins, known stems become dictionary poses, person/possessive/negation/question/tense remain in `featureSummary`, and all remaining visible letters become cards.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `node --test tests/tid-display-plan.test.mjs tests/turkish-morphology.test.mjs tests/tid-transfer.test.mjs tests/tid-output-ui.test.mjs`

Expected: FAIL because total display planning and fallback segment kinds are absent.

- [ ] **Step 3: Implement deterministic planning and source labels**

Keep `translateTurkishToTid()` strict for reviewed TİD. Add `createTidDisplayPlan()` as the broader communication-support path. The UI must say `Onaylı TİD`, `Sözlük dizimi`, or `Harf kartları / yapay zekâ adayı` according to `sourceClass`; it must not turn fallback output into reviewed TİD.

- [ ] **Step 4: Run focused tests**

Run: `node --test tests/tid-display-plan.test.mjs tests/turkish-morphology.test.mjs tests/tid-transfer.test.mjs tests/tid-output-ui.test.mjs tests/tid-media-player.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit the total display plan**

Run: `git add public/tid-display-plan.mjs public/turkish-morphology.mjs public/tid-transfer.mjs public/tid-output-ui.mjs public/tid-media-player.mjs tests/tid-display-plan.test.mjs tests/turkish-morphology.test.mjs tests/tid-transfer.test.mjs tests/tid-output-ui.test.mjs && git commit -m "feat: add labeled fallback for every Turkish input"`

### Task 5: Capture Landmarks and Store Personal Examples Locally

**Files:**
- Create: `public/landmark-runtime.mjs`
- Create: `public/landmark-worker.js`
- Create: `public/landmark-normalization.mjs`
- Create: `public/personal-sign-store.mjs`
- Create: `public/personal-training.mjs`
- Modify: `public/index.html`
- Modify: `public/styles.css`
- Create: `tests/landmark-normalization.test.mjs`
- Create: `tests/personal-sign-store.test.mjs`
- Create: `tests/personal-training.test.mjs`

**Interfaces:**
- Consumes: verified MediaPipe runtime assets, camera video frames, IndexedDB, and vocabulary labels.
- Produces: `createLandmarkRuntime({ manifest, baseUrl, workerFactory })`; worker messages `initialize`, `process-frame`, and `dispose`; `normalizeLandmarkFrame(result) -> NormalizedFrame`; `createPersonalSignStore({ indexedDB, dbName: 'tid-kopru-personal-v1' })`; `createPersonalTrainer({ runtime, store, minSamples: 3 })`.

- [ ] **Step 1: Write failing normalization, storage, and training tests**

Test handedness-stable normalization, translation/scale invariance, missing-hand masks, face/pose optionality, rejection of empty frames, strictly increasing worker timestamps, worker disposal, three-sample minimum, persistence across store instances, deletion, and in-memory fallback when IndexedDB throws.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `node --test tests/landmark-normalization.test.mjs tests/personal-sign-store.test.mjs tests/personal-training.test.mjs`

Expected: FAIL because the modules are missing.

- [ ] **Step 3: Implement local capture, normalization, and training UI**

Load runtime and landmark model assets only from the verified manifest. Run MediaPipe in `landmark-worker.js`, capture at a maximum of 15 frames per second, retain normalized frames only, and release each raw frame immediately. Add a teaching panel where a user selects one of the 123 labels, records at least three samples, sees sample quality, and can delete one label or all personal data.

- [ ] **Step 4: Run focused tests**

Run: `node --test tests/landmark-normalization.test.mjs tests/personal-sign-store.test.mjs tests/personal-training.test.mjs tests/privacy-mode.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit local personal training**

Run: `git add public/landmark-runtime.mjs public/landmark-worker.js public/landmark-normalization.mjs public/personal-sign-store.mjs public/personal-training.mjs public/index.html public/styles.css tests/landmark-normalization.test.mjs tests/personal-sign-store.test.mjs tests/personal-training.test.mjs && git commit -m "feat: teach personal signs entirely on device"`

### Task 6: Add Personal Recognition and Hybrid Candidate Arbitration

**Files:**
- Create: `public/personal-sign-recognizer.mjs`
- Create: `public/hybrid-recognition.mjs`
- Modify: `public/sign-recognition.mjs`
- Modify: `public/sign-recognition-worker.js`
- Modify: `public/tid-to-turkish.mjs`
- Create: `tests/personal-sign-recognizer.test.mjs`
- Create: `tests/hybrid-recognition.test.mjs`
- Modify: `tests/sign-recognition-client.test.mjs`
- Modify: `tests/tid-to-turkish.test.mjs`

**Interfaces:**
- Consumes: normalized utterance frames, personal samples, optional verified ONNX candidate, optional cloud candidate, and reviewed gloss-to-Turkish content.
- Produces: `dynamicTimeWarpDistance(a, b)`, `classifyPersonalSign({ frames, samples, rejectThreshold })`, and `createHybridRecognizer({ personalBackend, onnxBackend, cloudBackend })` with `recognize(utterance, { mode, cloudConsent, signal }) -> CandidateResult`.
- `CandidateResult`: `{ text, glosses, confidence, source, warnings, needsConfirmation }`.

- [ ] **Step 1: Write failing recognizer and arbitration tests**

Test identical/warped sequences, signer-specific nearest sample, rejection beyond threshold, blank/partial utterances, local-only mode never calling cloud, verified ONNX beating a weaker personal candidate, cloud being called only after consent, malformed backend results being ignored, and every non-reviewed result requiring confirmation.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `node --test tests/personal-sign-recognizer.test.mjs tests/hybrid-recognition.test.mjs tests/sign-recognition-client.test.mjs tests/tid-to-turkish.test.mjs`

Expected: FAIL because personal and arbitration modules are absent.

- [ ] **Step 3: Implement DTW classification and candidate arbitration**

Use a Sakoe-Chiba band equal to 10% of the longer sequence. For each personal label, calculate the largest pairwise training distance multiplied by 1.25 and clamp the reject threshold to `[0.08, 0.45]`. Keep the existing ONNX worker contract. Return `anlaşılamadı` with no text when every candidate is below its own threshold. Translate glosses to Turkish only through reviewed mappings; otherwise expose editable gloss labels rather than inventing a sentence.

- [ ] **Step 4: Run focused tests**

Run: `node --test tests/personal-sign-recognizer.test.mjs tests/hybrid-recognition.test.mjs tests/sign-recognition-client.test.mjs tests/tid-to-turkish.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit hybrid local recognition**

Run: `git add public/personal-sign-recognizer.mjs public/hybrid-recognition.mjs public/sign-recognition.mjs public/sign-recognition-worker.js public/tid-to-turkish.mjs tests/personal-sign-recognizer.test.mjs tests/hybrid-recognition.test.mjs tests/sign-recognition-client.test.mjs tests/tid-to-turkish.test.mjs && git commit -m "feat: recognize taught signs with guarded hybrid arbitration"`

### Task 7: Add an Optional NVIDIA Video Candidate

**Files:**
- Create: `public/cloud-session.mjs`
- Create: `public/nvidia-candidate.mjs`
- Modify: `public/index.html`
- Modify: `public/styles.css`
- Modify: `public/app.mjs`
- Create: `tests/cloud-session.test.mjs`
- Create: `tests/nvidia-candidate.test.mjs`
- Modify: `tests/hybrid-recognition.test.mjs`

**Interfaces:**
- Consumes: a fresh session API key or configured proxy URL, a short `video/webm`/`video/mp4` blob, `AbortSignal`, and the provider endpoint.
- Produces: `createCloudSession() -> { setKey, clearKey, hasKey, withKey }`; `createNvidiaCandidateProvider({ fetcher, endpoint, model, proxyUrl })`; provider method `recognizeVideo({ blob, apiKey, signal }) -> CandidateResult`.

- [ ] **Step 1: Write failing secret and provider tests**

Assert keys remain closure-only, are absent from JSON/stringification, clear on disposal/page hide, and never reach logs. Mock 200, 401, 429, CORS/network failure, timeout, malformed JSON, prose instead of JSON, and abort. Assert the provider caps generic VLM confidence below the verified threshold and always sets `source: 'cloud-candidate'` plus `needsConfirmation: true`.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `node --test tests/cloud-session.test.mjs tests/nvidia-candidate.test.mjs tests/hybrid-recognition.test.mjs`

Expected: FAIL because the session and provider modules are absent.

- [ ] **Step 3: Implement consented session-only cloud use**

Encode only the user-confirmed short clip. Use an OpenAI-compatible multimodal request and require a JSON object containing `candidateText`, `glosses`, and `warnings`; treat all fields as untrusted input. Add an advanced panel for a fresh key or proxy URL, never prefill the prior key, and show provider terms plus the fact that NVIDIA is not a validated TİD translator.

- [ ] **Step 4: Run focused tests and scan for secret persistence**

Run: `node --test tests/cloud-session.test.mjs tests/nvidia-candidate.test.mjs tests/hybrid-recognition.test.mjs && rg -n "nvapi-|localStorage|sessionStorage" public tests`

Expected: tests PASS; no API key literal; cloud modules contain no persistent key storage.

- [ ] **Step 5: Commit optional cloud candidates**

Run: `git add public/cloud-session.mjs public/nvidia-candidate.mjs public/index.html public/styles.css public/app.mjs tests/cloud-session.test.mjs tests/nvidia-candidate.test.mjs tests/hybrid-recognition.test.mjs && git commit -m "feat: add consented session-only NVIDIA candidates"`

### Task 8: Integrate the Complete PWA Flow and Offline Policy

**Files:**
- Modify: `public/app.mjs`
- Modify: `public/index.html`
- Modify: `public/styles.css`
- Modify: `public/service-worker.js`
- Modify: `public/sw-policy.js`
- Modify: `public/manifest.webmanifest`
- Modify: `tests/pwa-ui.test.mjs`
- Modify: `tests/sw-policy.test.mjs`
- Create: `tests/hybrid-app-integration.test.mjs`

**Interfaces:**
- Consumes: all controllers and result contracts from Tasks 2–7.
- Produces: one application state machine with states `idle`, `requesting-permission`, `capturing`, `processing`, `candidate`, `playing`, and `error`; a cache policy that handles the shell and verified runtime/model assets without caching private inputs.

- [ ] **Step 1: Write failing integration and offline tests**

Test local first-run, trained local recognition, missing model fallback, hybrid with no cloud consent, cloud abort, camera stop, page hide, offline reload, corrupted runtime hash, unknown Turkish input, and replay/slow/step controls. Assert all candidate sources and limitations are visible to screen readers.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `node --test tests/hybrid-app-integration.test.mjs tests/pwa-ui.test.mjs tests/sw-policy.test.mjs`

Expected: FAIL because the complete state machine and cache rules are not wired.

- [ ] **Step 3: Wire the application and update offline caching**

Keep `app.mjs` as composition only; move state transitions to small controllers when a block exceeds one responsibility. Cache public runtime/model assets only after manifest hash verification. Never cache camera blobs, landmarks, personal examples, API keys, or provider responses. Add visible progress, cancellation, retry, speed, repeat, step, and data deletion controls.

- [ ] **Step 4: Run the JavaScript suite and syntax checks**

Run: `npm test && npm run check`

Expected: all tests PASS and every public script parses.

- [ ] **Step 5: Commit the integrated PWA**

Run: `git add public tests package.json && git commit -m "feat: integrate private hybrid TID communication flow"`

### Task 9: Document, Verify, and Publish the Release

**Files:**
- Modify: `README.md`
- Modify: `docs/manual-android-checklist.md`
- Modify: `docs/tid-text-to-sign-evaluation.md`
- Modify: `docs/tid-camera-to-text-evaluation.md`
- Modify: `docs/tid-two-way-field-results.md`
- Modify: `public/ASSET-NOTICE.txt`
- Modify: `ASSET-NOTICE.txt`
- Modify: `tests/docs-release.test.mjs`

**Interfaces:**
- Consumes: the finished application and all verification commands.
- Produces: accurate release documentation, a clean commit history based on sanitized `origin/main`, and a live GitHub Pages release.

- [ ] **Step 1: Write failing release documentation checks**

Require current capability counts, local/hybrid/cloud privacy wording, personal training deletion instructions, runtime/model licenses, generic VLM limitations, Android checks, and the exact natural-TİD publication gates. Reject any claim that every conversation is naturally translated.

- [ ] **Step 2: Run release documentation tests and verify failure**

Run: `node --test tests/docs-release.test.mjs`

Expected: FAIL because the documents still describe the camera and avatar as unavailable.

- [ ] **Step 3: Update documentation and notices**

Document which functions are live, which outputs are dictionary/letter cards, how to teach signs, how to use or avoid cloud mode, how to delete data, and why generic NVIDIA output remains an editable candidate. Record exact dependency versions and licenses.

- [ ] **Step 4: Run full automated verification**

Run: `npm test && npm run check && python -m unittest discover -s tests -v && git diff --check && rg -n "nvapi-|rain\.glb" public README.md docs`

Expected: all JavaScript and Python tests PASS; syntax checks PASS; no whitespace errors; no API key; `rain.glb` appears only in explanatory notices and never as a fetched asset.

- [ ] **Step 5: Run local and live browser checks**

Serve with `python tools/serve.py`, open the app in a real browser, and verify camera permission, stop behavior, microphone permission, `Sen iyisin`, unknown-word letter cards, procedural pose playback, personal teaching persistence/deletion, offline reload, and cloud-disabled behavior. On a supported Android browser, repeat camera framing, rotation, backgrounding, installation, and data deletion checks.

- [ ] **Step 6: Commit the release evidence**

Run: `git add README.md docs public/ASSET-NOTICE.txt ASSET-NOTICE.txt tests/docs-release.test.mjs; git commit -m "docs: record hybrid TID release capabilities and limits"`

- [ ] **Step 7: Review, publish, and verify GitHub Pages**

Review the complete branch against the spec, push the sanitized branch to `main`, publish the exact tested tree to `gh-pages` through the repository's established deployment path, wait for the Pages build, then verify the live root and every referenced asset return HTTP 200. Confirm the live site requests camera/microphone only after user action and contains no API key.
