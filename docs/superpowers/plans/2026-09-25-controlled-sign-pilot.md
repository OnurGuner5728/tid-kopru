# TİD Köprü Controlled Camera Pilot Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a consent-based, on-device, 20-sign TİD camera pilot whose outputs can be rejected or manually confirmed before use.

**Architecture:** Keep collection and training tools outside the deployed PWA. Collect landmark sequences locally under a TİD advisor-approved protocol; split train/validation/test by signer; train a compact temporal landmark classifier with an unknown/reject path; export a versioned ONNX model and MediaPipe runtime assets; run inference in a Web Worker. The PWA asks the user to explicitly capture one sign and shows a candidate for confirmation.

**Tech Stack:** MediaPipe Holistic landmark extraction, Python 3 data/model tools, PyTorch temporal 1D CNN, ONNX export, ONNX Runtime Web and Web Workers for static PWA inference, Node.js/Python built-in tests.

**Spec:** `docs/superpowers/specs/2026-09-25-tid-kopru-design.md` (sections C, D, E, F, Verification, Scope)

## Global Constraints

- Pilot vocabulary contains exactly 20 TİD-approved signs for its first evaluation.
- Each sign has at least 10 repetitions from each of at least 20 different signers, with lighting, camera distance, and background variation.
- A signer never appears in both model training and final test data.
- Do not train on AUTSL, BosphorusSign22k, TurkSign446, or downloaded government dictionary videos without separate confirmed rights.
- Collect only after TİD advisor approval and documented informed consent; raw video is off by default.
- Inference runs on-device. Camera frames and landmarks are not sent to a server or stored by the released app.
- Candidate text must be reviewed by the user before speech; low confidence, blank, partial, out-of-frame, and unknown input must be rejected.
- Medical and emergency use remains out of scope.

## Review Focus

- Signer overlap between splits can inflate final scores and must fail a dataset validation test.
- Missing hands, out-of-frame hands, blank clips, partial clips, and unknown signs must yield rejection rather than a plausible word.
- Landmark extraction/preprocessing version mismatch must prevent the model from loading.
- Camera denial, no camera, lost stream, and page close must stop camera tracks and leave text tools usable.
- A high-confidence wrong candidate must still require the user's confirmation before it enters the reply or speech field.

## External Gate Before Participant Data

The following items are prerequisites, not tasks to simulate with invented data: a TİD-speaking Deaf advisor must validate the 20-sign glossary and capture conditions; participants must give documented permission for the named data use; a real Android phone must be available for latency and battery measurements. Until these exist, implement and test tooling with schema-only fixtures, and do not train or claim a product model.

---

### Task 1: Define and validate the local landmark-data format

**Files:**
- Create: `tools/sign_pilot/schema.json`
- Create: `tools/sign_pilot/validate_dataset.py`
- Create: `tests/test_sign_pilot_dataset.py`
- Create: `tools/sign_pilot/README.md`

**Interfaces:**
- Produces: `validate_dataset(records, signers, allowed_signs)` in `tools.sign_pilot.validate_dataset` returns a list of stable error codes; valid records contain `schemaVersion`, `signerCode`, `consentCode`, `signId`, `repetition`, `conditions`, `fps`, `frames`, and `preprocessVersion`.
- A frame is a JSON object with numeric arrays for pose, left/right hand, face subset, and corresponding visibility masks. The manifest contains no name, contact information, or raw video path.

- [x] **Step 1: Write failing schema-validation tests**

Create tests for: valid one-frame record; missing `consentCode`; unknown `signId`; negative repetition; non-finite landmark coordinate; and a record with a personal-name field. Expected error codes are respectively none, `missing_consent`, `unknown_sign`, `invalid_repetition`, `invalid_coordinate`, and `personal_data_field`.

- [x] **Step 2: Run the Python tests and verify the validator import fails**

Run: `python -m unittest discover -s tests -p "test_sign_pilot_dataset.py" -v`  
Expected: FAIL because `tools.sign_pilot.validate_dataset` is not implemented.

- [x] **Step 3: Implement schema and stable validation errors**

Implement validation in `validate_dataset.py`; use only Python's standard library. Reject records with extra keys containing names, email addresses, phone numbers, or video paths. Do not treat missing consent metadata as a warning.

- [x] **Step 4: Run dataset schema tests**

Run: `python -m unittest discover -s tests -p "test_sign_pilot_dataset.py" -v`.  
Expected: PASS, all six cases.

- [x] **Step 5: Document collection and deletion rules**

In `README.md`, state that raw video is not captured by default; exported landmark data is sensitive; consent scope and retention time must be approved before collection; a participant's consent withdrawal must map to `signerCode` and permit deleting all of that signer's records.

- [x] **Step 6: Commit the data contract**

```powershell
git add tools/sign_pilot/schema.json tools/sign_pilot/validate_dataset.py tools/sign_pilot/README.md tests/test_sign_pilot_dataset.py
git commit -m "test: define consented sign-pilot data contract"
```

### Task 2: Build the localhost-only landmark capture utility

**Files:**
- Create: `tools/sign_pilot/capture.html`
- Create: `tools/sign_pilot/capture.mjs`
- Create: `tools/sign_pilot/mediapipe-loader.mjs`
- Modify: `tools/sign_pilot/README.md`
- Create: `tests/sign-pilot-preprocess.test.mjs`

**Interfaces:**
- Produces: `startCapture({ videoElement, onFrame, onError })`, `stopCapture()`, and `exportLandmarkRecords(records)` in `tools/sign_pilot/capture.mjs`; each saved record validates against Task 1 before it can be exported.

- [x] **Step 1: Write tests for frame normalization and export gating**

Test that coordinates are finite, timestamps increase, missing joints receive a zero coordinate plus a false visibility mask, exports contain no `video` or `blob` field, and records without consent or a known label are not exportable.

- [x] **Step 2: Run focused tests and verify they fail before implementation**

Run: `node --test tests/sign-pilot-preprocess.test.mjs`.  
Expected: FAIL because the capture/preprocess module is not present.

- [x] **Step 3: Implement explicit one-sign recording controls**

The page has “Kamerayı aç”, “Bir işareti kaydet”, “Kaydı bitir”, “Dışa aktar”, and “Bu oturumun verisini sil” controls. The signer starts/stops each clip manually; no always-on recognition or raw video recording is added. Label and condition choices come only from the advisor-approved pilot manifest.

- [x] **Step 4: Implement local landmark extraction and export**

Load pinned MediaPipe runtime/model assets from local files, process frames in the browser, append landmark arrays to an in-memory record, validate before export, and release camera tracks when stopping or leaving the page. Download one JSONL file only after explicit export action.

- [ ] **Step 5: Run unit tests and manual localhost camera checks**

Run: `node --test tests/sign-pilot-preprocess.test.mjs`.  
Serve the tool from `http://localhost` and verify camera permission, start/stop, export validation, delete-session, page-close track stop, and no video request to an external origin. Record no participant data in the manual test.

- [x] **Step 6: Commit the collection tool**

```powershell
git add tools/sign_pilot tests/sign-pilot-preprocess.test.mjs
git commit -m "feat: add local landmark capture for approved pilot data"
```

### Task 3: Train, split, reject, and export the 20-sign model

**Files:**
- Create: `tools/sign_model/requirements.txt`
- Create: `tools/sign_model/split_by_signer.py`
- Create: `tools/sign_model/preprocess.py`
- Create: `tools/sign_model/train.py`
- Create: `tools/sign_model/evaluate.py`
- Create: `tools/sign_model/export_onnx.py`
- Create: `tests/test_sign_model_pipeline.py`
- Create: `models/sign-pilot/model-manifest.json` only after a consented model passes every gate.

**Interfaces:**
- Input tensor: fixed `float32[1, 32, N]`, where `N` equals the manifest's ordered feature-name count; 32 frames are uniformly sampled from a manually captured sign clip, landmark position is normalized around shoulder center and shoulder width, and absent joints use a zero vector plus visibility mask.
- Model output: `{ signId, confidence, accepted, reason }`; `accepted` is false for unknown class or below-threshold confidence.
- Model manifest contains `modelVersion`, SHA-256, MediaPipe model/runtime version, preprocessing version, ordered landmark names, allowed sign IDs, and confidence threshold.

- [x] **Step 1: Write tests for signer-disjoint splits and preprocessing identity**

Use a tiny fixture with signer codes `S01` through `S06`. Assert that train/validation/test signer sets are pairwise disjoint, every approved sign is represented in each split where possible, missing joints preserve their mask, resampling always emits 32 frames, and the preprocessing manifest hash is stable for identical settings.

- [x] **Step 2: Run model-pipeline tests and verify they fail before implementation**

Run: `python -m unittest discover -s tests -p "test_sign_model_pipeline.py" -v`.  
Expected: FAIL because split/preprocessing functions are not implemented.

- [x] **Step 3: Implement grouped splitting and landmark preprocessing**

Split by signer, never by clip. Use a fixed random seed stored in the run manifest. Normalize only using training-derived statistics and apply the same transformation to validation/test. Refuse to train if any split contains a signer from another split or a record fails Task 1 validation.

- [x] **Step 4: Implement a compact temporal 1D CNN and unknown rejection**

Train only on approved signs plus the explicitly labeled blank/partial/unknown samples. Calibrate the confidence threshold on validation signers. Do not tune against the final test split. Save confusion matrix and per-class precision/recall with the trained checkpoint.

- [ ] **Step 5: Evaluate against the spec's pilot gates**

On the held-out signer set compute macro-F1, false acceptance on blank/unknown input, false words per minute during idle capture, low-confidence rejection rate, and p95 model latency on the target Android phone. Require macro-F1 ≥ 0.80, false acceptance ≤ 5%, ≤ 1 false word/minute in idle, low-confidence rejection ≥ 90%, and p95 ≤ 1.5 seconds. If a threshold fails, do not lower it; inspect data/labels/preprocessing and run a new versioned experiment.

- [ ] **Step 6: Export ONNX and verify byte-for-byte preprocessing metadata**

Export the selected checkpoint to `models/sign-pilot/` only after all participant-consent and rights checks pass. Write the SHA-256 and preprocessing/runtime identity into the manifest. The app loader must reject a missing or mismatched manifest.

- [ ] **Step 7: Run the Python pipeline tests and record the actual pilot report**

Run: `python -m unittest discover -s tests -p "test_sign_model_pipeline.py" -v`.  
Expected: PASS. Store only aggregate metrics and the non-identifying run manifest in `docs/sign-pilot-results.md`; keep raw participant data in the consented local dataset location outside Git.

- [ ] **Step 8: Commit model code and report, not private training data**

```powershell
git add tools/sign_model tests/test_sign_model_pipeline.py docs/sign-pilot-results.md models/sign-pilot/model-manifest.json
git commit -m "feat: train and evaluate controlled sign pilot model"
```

### Task 4: Add the on-device candidate review flow to the PWA

**Files:**
- Create: `public/sign-recognition.mjs`
- Create: `public/sign-recognition-worker.js`
- Modify: `public/index.html`
- Modify: `public/app.mjs`
- Modify: `public/styles.css`
- Modify: `public/service-worker.js`
- Create: `tests/sign-recognition-client.test.mjs`

**Interfaces:**
- `SignRecognitionClient.load({ onProgress })`, `.startCapture({ onCandidate, onRejected, onError })`, `.stopCapture()`, `.dispose()`.
- Candidate event: `{ signId, displayText, confidence, accepted, reason, modelVersion }`; an unaccepted candidate never populates the reply text field.

- [ ] **Step 1: Test the worker protocol with a fake worker and fake camera stream**

Assert that model-manifest mismatch prevents load, accepted candidates appear only as an explicit review card, rejected candidates never populate text, `stopCapture()` stops every media track, and `dispose()` terminates the worker.

- [ ] **Step 2: Run focused tests and verify the client module is missing**

Run: `node --test tests/sign-recognition-client.test.mjs`.  
Expected: FAIL because `SignRecognitionClient` is not implemented.

- [ ] **Step 3: Implement model loading and capture worker**

Load the MediaPipe runtime and ONNX file from same-origin static assets only. Check SHA-256 and preprocessing identity before inference. Keep camera frames and landmarks in worker memory, resample each manually bounded clip to 32 frames, and send only the candidate event back to the page.

- [ ] **Step 4: Implement camera status, candidate confirmation, and rejection**

Add an explicit “Kamera ile işaret öner” start/stop control and a review card with “Metin olarak kullan”, “Tekrar dene”, and “Anlaşılamadı” states. Do not autoplay voice. Ask for permission only after the user starts camera mode; stop and release tracks on stop, navigation, or error.

- [ ] **Step 5: Add all required model/runtime files to the versioned offline cache**

Keep model files outside initial core-shell download; offer a separate user-started model download with progress and storage error. After download, cache the model and MediaPipe assets under the model version. On model-version change, delete only old `tid-kopru-model-*` caches.

- [ ] **Step 6: Run unit checks and compare web/Android output on 100 held-out clips**

Run: `node --test tests/sign-recognition-client.test.mjs`, `npm test`, and `npm run check`. Then use the same 100 consented, held-out clips in offline Web and Android PWA modes; require identical accepted/rejected status and identical top sign ID. Record device, model hash, and mismatches in the aggregate report.

- [ ] **Step 7: Commit the camera integration after the data/model gate passes**

```powershell
git add public/sign-recognition.mjs public/sign-recognition-worker.js public/index.html public/app.mjs public/styles.css public/service-worker.js tests/sign-recognition-client.test.mjs docs/sign-pilot-results.md
git commit -m "feat: add on-device reviewed sign suggestions"
```

### Task 5: Run Deaf-user sessions and issue a controlled-pilot release

**Files:**
- Create: `docs/sign-pilot-field-results.md`
- Modify: `README.md`, `docs/manual-android-checklist.md`, `ASSET-NOTICE.txt` as measured/verified.

- [ ] **Step 1: Conduct at least 30 separate face-to-face sessions**

With consent and TİD advisor support, measure correction time, wrong and rejected suggestions, avatar clarity, camera permissions, and ease of stopping/deleting data. Exclude medical/emergency scenarios.

- [ ] **Step 2: Review results with the TİD advisor**

The advisor reviews gloss meaning, variant coverage, false acceptance examples, rejection copy, and whether the pilot label is accurate. Any high-confidence wrong suggestion that bypasses confirmation is a release-blocking bug.

- [ ] **Step 3: Re-run every failed metric and device check**

Do not publish until all numeric pilot gates, offline parity, consent, and asset-rights checks pass. If external data or advisor approval is unavailable, keep the PWA's camera entry point disabled and ship no camera-recognition claim.

- [ ] **Step 4: Commit aggregate field results and release copy**

```powershell
git add docs/sign-pilot-field-results.md README.md docs/manual-android-checklist.md ASSET-NOTICE.txt
git commit -m "docs: record controlled sign pilot validation"
```
