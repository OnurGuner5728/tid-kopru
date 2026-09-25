import unittest
import json
import tempfile
from pathlib import Path

import numpy as np

from tools.sign_model.sequence_data import (
    build_sequence_splits,
    collate_sequences,
    decode_gloss_ctc,
    preprocess_utterance,
    sequence_preprocess_fingerprint,
)
from tools.sign_model.sequence_model import (
    NormalizedSequenceModel,
    TemporalCtcModel,
    apply_sequence_scaler,
    fit_sequence_scaler,
)
from tools.sign_model.evaluate_sequence import (
    bind_evaluation_evidence,
    calibrate_confidence_threshold,
    phrase_confidence,
    sequence_edit_distance,
    sequence_metrics,
)
from tools.sign_model.export_sequence_onnx import _assert_approvals, verify_sequence_export_gate
from tools.sign_model.train_sequence import _assert_reject_class_coverage, _assert_training_prerequisites


FEATURES = ["pose.0.x", "pose.0.visible", "time.relative"]
VOCABULARY = {1: "G01", 2: "G02", 3: "G03", 4: "G04"}


def make_frame(timestamp, value, visible=1):
    return {
        "timestampMs": timestamp,
        "pose": [value, 0.0, 0.0],
        "poseVisibility": [visible],
        "leftHand": [0.0, 0.0, 0.0],
        "leftHandVisibility": [0],
        "rightHand": [0.0, 0.0, 0.0],
        "rightHandVisibility": [0],
        "face": [0.0, 0.0, 0.0],
        "faceVisibility": [0],
    }


def make_valid_utterance(utterance_id, signer, gloss):
    def frame(timestamp):
        return {
            "timestampMs": timestamp,
            "pose": [0.0, 0.1, 0.2],
            "poseVisibility": [1],
            "leftHand": [0.0, 0.0, 0.0],
            "leftHandVisibility": [0],
            "rightHand": [0.1, 0.2, 0.3],
            "rightHandVisibility": [1],
            "face": [0.0, 0.0, 0.0],
            "faceVisibility": [1],
        }
    return {
        "schemaVersion": 2,
        "utteranceId": utterance_id,
        "signerCode": signer,
        "consentCode": f"C_{signer}",
        "scopeId": "PILOT_1",
        "fps": 30,
        "frames": [frame(0), frame(100)],
        "glossEvents": [{
            "glossId": gloss,
            "startMs": 0,
            "endMs": 100,
            "dominantHand": "right",
            "nonManual": [],
            "channel": "manual",
        }],
        "sampleKind": "SIGN",
        "conditions": {"lightingCode": "indoor", "distanceCode": "medium", "backgroundCode": "plain"},
        "preprocessVersion": "mp-v1",
        "captureContractSha256": "a" * 64,
    }


def records_for_six_signers():
    rows = []
    for signer_index in range(6):
        for clip_index in range(3):
            value = float(signer_index * 10 + clip_index)
            rows.append({
                "schemaVersion": 2,
                "utteranceId": f"U{signer_index}{clip_index}",
                "signerCode": f"S{signer_index:02}",
                "consentCode": f"C{signer_index:02}",
                "sampleKind": "SIGN",
                "captureContractSha256": "a" * 64,
                "preprocessVersion": "mp-v1",
                "frames": [make_frame(0, value), make_frame(100, value + 1)],
                "glossEvents": [{
                    "glossId": f"G{(clip_index % 4) + 1:02}",
                    "startMs": 0,
                    "endMs": 100,
                    "dominantHand": "right",
                    "nonManual": [],
                    "channel": "manual",
                }],
                "featureNames": FEATURES,
            })
    return rows


class SequencePipelineTests(unittest.TestCase):
    def test_signer_splits_are_disjoint_and_stable_for_a_seed(self):
        records = records_for_six_signers()
        first = build_sequence_splits(records, seed=17)
        second = build_sequence_splits(records, seed=17)
        self.assertEqual(first["manifest"], second["manifest"])
        signer_sets = {name: {row["signerCode"] for row in first[name]} for name in ("train", "validation", "test")}
        self.assertFalse(signer_sets["train"] & signer_sets["validation"])
        self.assertFalse(signer_sets["train"] & signer_sets["test"])
        self.assertFalse(signer_sets["validation"] & signer_sets["test"])
        self.assertEqual(set(signer_sets), {"train", "validation", "test"})
        self.assertIn("phraseOverlap", first)

    def test_sequence_preprocess_fingerprint_binds_feature_order_and_window_size(self):
        baseline = sequence_preprocess_fingerprint("mp-v1", FEATURES, 32)
        self.assertEqual(len(baseline), 64)
        self.assertNotEqual(baseline, sequence_preprocess_fingerprint("mp-v1", list(reversed(FEATURES)), 32))
        self.assertNotEqual(baseline, sequence_preprocess_fingerprint("mp-v1", FEATURES, 256))
        splits = build_sequence_splits(records_for_six_signers(), seed=17, feature_names=FEATURES, target_frames=32)
        self.assertEqual(splits["manifest"]["preprocessHash"], baseline)

    def test_duplicate_utterance_ids_and_duplicate_clip_content_are_rejected(self):
        records = records_for_six_signers()
        records[1]["utteranceId"] = records[0]["utteranceId"]
        with self.assertRaisesRegex(ValueError, "duplicate_utterance"):
            build_sequence_splits(records, seed=17)

        records = records_for_six_signers()
        records[1]["frames"] = records[0]["frames"]
        with self.assertRaisesRegex(ValueError, "duplicate_clip_content"):
            build_sequence_splits(records, seed=17)

    def test_preprocess_resamples_to_32_or_256_frames_and_preserves_masks_and_time(self):
        record = {
            "frames": [make_frame(0, 2.0, 1), make_frame(100, 0.0, 0)],
        }
        result = preprocess_utterance(record, target_frames=3, feature_names=FEATURES)
        self.assertEqual(result.shape, (3, 3))
        self.assertEqual(result.dtype, np.float32)
        np.testing.assert_allclose(result[:, 0], [2.0, 2.0, 0.0])
        np.testing.assert_array_equal(result[:, 1], [1.0, 1.0, 0.0])
        np.testing.assert_allclose(result[:, 2], [0.0, 0.5, 1.0])

        long_result = preprocess_utterance(records_for_six_signers()[0], target_frames=256, feature_names=FEATURES)
        self.assertEqual(long_result.shape, (256, len(FEATURES)))

    def test_collate_sequences_builds_ctc_tensors(self):
        batch = collate_sequences(records_for_six_signers()[:2], vocabulary={
            "G01": 1, "G02": 2, "G03": 3, "G04": 4,
        }, feature_names=FEATURES, target_frames=32)
        self.assertEqual(batch["features"].shape, (2, 32, 3))
        self.assertEqual(batch["features"].dtype, np.float32)
        np.testing.assert_array_equal(batch["targetIds"], [1, 2])
        np.testing.assert_array_equal(batch["inputLengths"], [32, 32])
        np.testing.assert_array_equal(batch["targetLengths"], [1, 1])

    def test_ctc_decoder_collapses_blank_and_repeated_tokens_with_frame_alignment(self):
        logits = np.full((7, 5), -4.0, dtype=np.float32)
        logits[:, 0] = 4.0
        logits[2:5, 1] = 8.0
        events = decode_gloss_ctc(logits, blank_id=0, vocabulary=VOCABULARY)
        self.assertEqual(
            [(event["glossId"], event["startFrame"], event["endFrame"]) for event in events],
            [("G01", 2, 5)],
        )
        self.assertGreater(events[0]["confidence"], 0.9)

    def test_ctc_decoder_keeps_repeated_glosses_separated_by_blank(self):
        logits = np.full((5, 5), -3.0, dtype=np.float32)
        logits[:, 0] = 3.0
        logits[0, 1] = 7.0
        logits[2, 1] = 7.0
        events = decode_gloss_ctc(logits, blank_id=0, vocabulary=VOCABULARY)
        self.assertEqual([(event["startFrame"], event["endFrame"]) for event in events], [(0, 1), (2, 3)])

    def test_decoder_rejects_unmapped_class_and_nonfinite_logits(self):
        logits = np.zeros((2, 3), dtype=np.float32)
        logits[:, 2] = 5
        with self.assertRaisesRegex(ValueError, "invalid_class"):
            decode_gloss_ctc(logits, blank_id=0, vocabulary={1: "G01"})
        logits[0, 0] = np.nan
        with self.assertRaisesRegex(ValueError, "invalid_logits"):
            decode_gloss_ctc(logits, blank_id=0, vocabulary=VOCABULARY)

    def test_temporal_ctc_model_uses_time_batch_vocabulary_layout(self):
        import torch

        model = TemporalCtcModel(input_features=3, vocabulary_size=5, hidden_channels=8)
        output = model(torch.zeros((2, 32, 3), dtype=torch.float32))
        self.assertEqual(tuple(output.shape), (32, 2, 5))
        self.assertEqual(output.dtype, torch.float32)

    def test_sequence_edit_distance(self):
        self.assertEqual(sequence_edit_distance(["G01", "G02"], ["G01", "G02"]), 0)
        self.assertEqual(sequence_edit_distance(["G01", "G02"], ["G01", "G03"]), 1)

    def test_sequence_metrics_report_each_reject_class_false_acceptance(self):
        metrics = sequence_metrics(
            [["G01"], [], [], []],
            [["G01"], [], ["G01"], []],
            ["SIGN", "BLANK", "UNKNOWN", "PARTIAL"],
        )
        self.assertEqual(metrics["sentenceGlossExactMatch"], 0.75)
        self.assertEqual(metrics["falseAcceptance"]["BLANK"]["rate"], 0.0)
        self.assertEqual(metrics["falseAcceptance"]["UNKNOWN"]["rate"], 1.0)
        self.assertEqual(metrics["falseAcceptance"]["PARTIAL"]["denominator"], 1)

    def test_sequence_metrics_reject_malformed_sample_kind(self):
        with self.assertRaisesRegex(ValueError, "invalid_sample_kind"):
            sequence_metrics([[]], [[]], [["UNKNOWN"]])

    def test_sequence_metrics_reject_sign_and_reject_target_mismatch(self):
        with self.assertRaisesRegex(ValueError, "sample_kind_target_mismatch"):
            sequence_metrics([[]], [[]], ["SIGN"])
        with self.assertRaisesRegex(ValueError, "sample_kind_target_mismatch"):
            sequence_metrics([["G01"]], [["G01"]], ["UNKNOWN"])

    def test_sequence_metrics_require_each_reject_class_in_held_out_data(self):
        with self.assertRaisesRegex(ValueError, "missing_reject_class:PARTIAL"):
            sequence_metrics([["G01"], [], [], []], [["G01"], [], [], []], ["SIGN", "BLANK", "UNKNOWN", "UNKNOWN"])

    def test_validation_selects_a_confidence_threshold_that_rejects_unsupported_events(self):
        result = calibrate_confidence_threshold(
            [["G01"], [], [], []],
            [
                [{"glossId": "G01", "confidence": 0.90}],
                [],
                [{"glossId": "G01", "confidence": 0.40}],
                [],
            ],
            ["SIGN", "BLANK", "UNKNOWN", "PARTIAL"],
            [0.0, 0.5, 0.95],
        )
        self.assertEqual(result["threshold"], 0.5)
        self.assertEqual(result["metrics"]["sentenceGlossExactMatch"], 1.0)

    def test_phrase_confidence_uses_weakest_event_and_rejects_empty_sequences(self):
        self.assertEqual(
            phrase_confidence([{"confidence": 0.91}, {"confidence": 0.77}]),
            0.77,
        )
        with self.assertRaisesRegex(ValueError, "empty_gloss_sequence"):
            phrase_confidence([])

    def test_feature_scaler_uses_visible_train_landmarks_and_preserves_masks(self):
        values = np.asarray([
            [[2.0, 1.0, 0.0], [0.0, 0.0, 0.5]],
            [[4.0, 1.0, 0.0], [0.0, 0.0, 0.7]],
        ], dtype=np.float32)
        scaler = fit_sequence_scaler(values, FEATURES)
        scaled = apply_sequence_scaler(values, scaler)
        np.testing.assert_allclose(scaled[:, :, 0], [[-1.0, 0.0], [1.0, 0.0]])
        np.testing.assert_array_equal(scaled[:, :, 1], values[:, :, 1])
        np.testing.assert_array_equal(scaled[:, :, 2], values[:, :, 2])

    def test_export_inference_wrapper_applies_the_training_scaler(self):
        import torch

        training = np.asarray([[[2.0, 1.0, 0.0], [0.0, 0.0, 1.0]], [[4.0, 1.0, 0.0], [0.0, 0.0, 1.0]]], dtype=np.float32)
        scaler = fit_sequence_scaler(training, FEATURES)
        model = TemporalCtcModel(input_features=3, vocabulary_size=5, hidden_channels=8).eval()
        wrapper = NormalizedSequenceModel(model, scaler).eval()
        features = np.asarray([[[3.0, 1.0, 0.25], [0.0, 0.0, 0.75]]], dtype=np.float32)
        expected = model(torch.from_numpy(apply_sequence_scaler(features, scaler)))
        actual = wrapper(torch.from_numpy(features))
        torch.testing.assert_close(actual, expected)

    def test_training_prerequisites_accept_sentence_vocabulary_and_three_signers(self):
        manifest = {
            "advisorApproved": True,
            "participantConsentVerified": True,
            "dataRightsVerified": True,
            "mediaPipeMetricsConsentVerified": True,
            "mediaPipeAssetsRightsVerified": True,
            "androidDeviceVerified": True,
            "approvedGlosses": ["G01", "G02"],
            "signers": ["S01", "S02", "S03"],
            "featureNames": FEATURES,
            "preprocessVersion": "mp-v1",
            "captureContractSha256": "a" * 64,
        }
        records = [make_valid_utterance(f"U{index}", f"S0{index}", "G01") for index in (1, 2, 3)]
        glosses, vocabulary, feature_names = _assert_training_prerequisites(manifest, records)
        self.assertEqual(glosses, ["G01", "G02"])
        self.assertEqual(vocabulary, {"G01": 1, "G02": 2})
        self.assertEqual(feature_names, FEATURES)

    def test_training_prerequisites_reject_unhashable_gloss_values_cleanly(self):
        manifest = {
            "advisorApproved": True,
            "participantConsentVerified": True,
            "dataRightsVerified": True,
            "mediaPipeMetricsConsentVerified": True,
            "mediaPipeAssetsRightsVerified": True,
            "androidDeviceVerified": True,
            "approvedGlosses": ["G01", []],
            "signers": ["S01", "S02", "S03"],
            "featureNames": FEATURES,
            "captureContractSha256": "a" * 64,
        }
        with self.assertRaisesRegex(ValueError, "approved_gloss_manifest_required"):
            _assert_training_prerequisites(manifest, [])

    def test_training_requires_every_reject_kind_in_each_split(self):
        valid_rows = [{"sampleKind": kind} for kind in ("SIGN", "BLANK", "UNKNOWN", "PARTIAL")]
        splits = {name: list(valid_rows) for name in ("train", "validation", "test")}
        _assert_reject_class_coverage(splits)
        splits["validation"] = [row for row in valid_rows if row["sampleKind"] != "PARTIAL"]
        with self.assertRaisesRegex(ValueError, "missing_reject_samples:validation:PARTIAL"):
            _assert_reject_class_coverage(splits)

    def test_onnx_export_gate_refuses_synthetic_or_missing_real_evidence(self):
        with self.assertRaisesRegex(ValueError, "real_evaluation_required"):
            verify_sequence_export_gate({"synthetic": True, "passed": True})
        with self.assertRaisesRegex(ValueError, "android_measurement_required"):
            verify_sequence_export_gate({"synthetic": False, "passed": True, "androidMeasurementSha256": ""})

    def test_onnx_export_gate_requires_twenty_unseen_held_out_signers(self):
        report = {
            "synthetic": False,
            "passed": True,
            "androidMeasurementSha256": "a" * 64,
            "androidDevice": {"platform": "Android", "model": "test-device"},
            "heldOutUtterances": 300,
            "heldOutSigners": 19,
            "semanticAcceptanceAfterAdjudication": 0.90,
            "decoderConfidenceThreshold": 0.5,
            "supportOutsideFalseAcceptance": 0.05,
            "falseAcceptance": {
                "BLANK": {"numerator": 1, "denominator": 100, "rate": 0.01},
                "UNKNOWN": {"numerator": 0, "denominator": 100, "rate": 0.0},
                "PARTIAL": {"numerator": 3, "denominator": 100, "rate": 0.03},
            },
            "humanReview": {"twoIndependentReviewers": True, "adjudicationComplete": True},
            "datasetSha256": "b" * 64,
            "splitManifestSha256": "c" * 64,
            "checkpointSha256": "d" * 64,
            "captureContractSha256": "e" * 64,
            "preprocessHash": "f" * 64,
            "runtimeFingerprint": "1" * 64,
        }
        with self.assertRaisesRegex(ValueError, "held_out_signer_gate_failed"):
            verify_sequence_export_gate(report)
        report["heldOutSigners"] = 20
        verify_sequence_export_gate(report)
        report["falseAcceptance"].pop("PARTIAL")
        with self.assertRaisesRegex(ValueError, "reject_class_evidence_required"):
            verify_sequence_export_gate(report)
        report["falseAcceptance"]["PARTIAL"] = {"numerator": 3, "denominator": 100, "rate": 0.03}
        report.pop("decoderConfidenceThreshold")
        with self.assertRaisesRegex(ValueError, "validation_threshold_required"):
            verify_sequence_export_gate(report)
        report["decoderConfidenceThreshold"] = 0.5
        report["falseAcceptance"]["BLANK"]["numerator"] = 6
        with self.assertRaisesRegex(ValueError, "false_acceptance_evidence_mismatch"):
            verify_sequence_export_gate(report)

    def test_export_approval_binds_features_and_sequence_preprocessing_hash(self):
        approvals = {
            "advisorApproved": True,
            "participantConsentVerified": True,
            "dataRightsVerified": True,
            "mediaPipeMetricsConsentVerified": True,
            "mediaPipeAssetsRightsVerified": True,
            "androidDeviceVerified": True,
            "captureContractSha256": "a" * 64,
            "preprocessVersion": "mp-v1",
            "featureNames": FEATURES,
        }
        report = {
            "captureContractSha256": "a" * 64,
            "preprocessVersion": "mp-v1",
            "preprocessHash": sequence_preprocess_fingerprint("mp-v1", FEATURES, 32),
        }
        _assert_approvals(approvals, report, feature_names=FEATURES, target_frames=32)
        bad_report = dict(report, preprocessHash="b" * 64)
        with self.assertRaisesRegex(ValueError, "preprocess_fingerprint_mismatch"):
            _assert_approvals(approvals, bad_report, feature_names=FEATURES, target_frames=32)
        with self.assertRaisesRegex(ValueError, "feature_manifest_mismatch"):
            _assert_approvals(approvals, report, feature_names=list(reversed(FEATURES)), target_frames=32)

    def test_evaluation_evidence_binds_held_out_signers_and_measurement_hashes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            dataset = root / "dataset.jsonl"
            checkpoint = root / "checkpoint.pt"
            android = root / "android.json"
            dataset.write_text('{"synthetic": true}\n', encoding="utf-8")
            checkpoint.write_bytes(b"test checkpoint")
            android.write_text(json.dumps({"androidDevice": {"platform": "Android", "model": "test-device"}}), encoding="utf-8")
            split = {
                "signers": {"train": ["S01"], "validation": ["S02"], "test": [f"S{i:02}" for i in range(3, 23)]},
                "captureContractSha256": "a" * 64,
                "preprocessVersion": "mp-v1",
                "preprocessHash": "b" * 64,
                "runtimeFingerprint": "a" * 64,
            }
            report = bind_evaluation_evidence(
                {"utteranceCount": 300}, dataset, split, checkpoint, android, synthetic=True,
            )
            self.assertEqual(report["heldOutUtterances"], 300)
            self.assertEqual(report["heldOutSigners"], 20)
            self.assertEqual(report["preprocessHash"], "b" * 64)
            split["signers"]["test"].append("S01")
            with self.assertRaisesRegex(ValueError, "signer_split_overlap"):
                bind_evaluation_evidence({"utteranceCount": 300}, dataset, split, checkpoint, android, synthetic=True)


if __name__ == "__main__":
    unittest.main()
