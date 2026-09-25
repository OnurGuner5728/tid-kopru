import unittest

import torch

from tools.sign_model.evaluate import evaluate_pilot_metrics
from tools.sign_model.train import TemporalSignCNN, TrainingGateError, predict_with_rejection, validate_training_gate
from tools.sign_model.preprocess import (
    build_feature_names,
    preprocess_record,
    preprocessing_hash,
    preprocessing_manifest,
)
from tools.sign_model.split_by_signer import split_by_signer


LANDMARK_INDICES = {
    "pose": [11, 12],
    "leftHand": [0],
    "rightHand": [0],
    "face": [],
}


def record(signer, sign):
    return {
        "schemaVersion": "1.0",
        "signerCode": signer,
        "consentCode": "C01",
        "signId": sign,
        "repetition": 1,
        "conditions": {"lightingCode": "L1", "distanceCode": "D1", "backgroundCode": "B1"},
        "fps": 30,
        "preprocessVersion": "v1",
        "frames": [
            {
                "timestampMs": 0,
                "pose": [1, 1, 0, 3, 1, 0],
                "poseVisibility": [1, 1],
                "leftHand": [0, 0, 0],
                "leftHandVisibility": [0],
                "rightHand": [3, 2, 0],
                "rightHandVisibility": [1],
                "face": [],
                "faceVisibility": [],
            },
            {
                "timestampMs": 33,
                "pose": [1, 1, 0, 3, 1, 0],
                "poseVisibility": [1, 1],
                "leftHand": [2, 2, 0],
                "leftHandVisibility": [1],
                "rightHand": [3, 2, 0],
                "rightHandVisibility": [1],
                "face": [],
                "faceVisibility": [],
            },
        ],
    }


def make_test_onnx(manifest, overrides=None):
    import json
    import onnx
    from onnx import TensorProto, helper

    feature_count = len(manifest["landmarkNames"])
    class_ids = manifest["classIds"]
    model_input = helper.make_tensor_value_info("landmark_sequence", TensorProto.FLOAT, [1, 32, feature_count])
    model_output = helper.make_tensor_value_info("logits", TensorProto.FLOAT, [1, len(class_ids)])
    logits = helper.make_tensor("test_logits", TensorProto.FLOAT, [1, len(class_ids)], [0.0] * len(class_ids))
    node = helper.make_node("Constant", [], ["logits"], value=logits)
    graph = helper.make_graph([node], "test", [model_input], [model_output])
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 17)])
    metadata = {
        "tidkopru.modelVersion": manifest["modelVersion"],
        "tidkopru.mediaPipeModelVersion": manifest["mediaPipeModelVersion"],
        "tidkopru.mediaPipeRuntimeVersion": manifest["mediaPipeRuntimeVersion"],
        "tidkopru.onnxRuntimeVersion": manifest["onnxRuntimeVersion"],
        "tidkopru.preprocessVersion": manifest["preprocessVersion"],
        "tidkopru.preprocessingHash": manifest["preprocessingHash"],
        "tidkopru.preprocessingManifest": json.dumps(manifest["preprocessingManifest"], ensure_ascii=False, sort_keys=True, separators=(",", ":")),
        "tidkopru.featureScalerSha256": manifest["featureScalerSha256"],
        "tidkopru.landmarkNames": json.dumps(manifest["landmarkNames"], ensure_ascii=False, separators=(",", ":")),
        "tidkopru.allowedSignIds": json.dumps(manifest["allowedSignIds"], ensure_ascii=False, separators=(",", ":")),
        "tidkopru.classIds": json.dumps(class_ids, ensure_ascii=False, separators=(",", ":")),
        "tidkopru.confidenceThreshold": json.dumps(manifest["confidenceThreshold"]),
    }
    metadata.update(overrides or {})
    for key, value in metadata.items():
        entry = model.metadata_props.add()
        entry.key, entry.value = key, value
    return model.SerializeToString()

class SignModelPipelineTests(unittest.TestCase):
    def setUp(self):
        self.records = [record("S%02d" % signer, sign) for signer in range(1, 7) for sign in ("SIGN_A", "SIGN_B")]

    def test_split_is_deterministic_and_signer_disjoint(self):
        first = split_by_signer(self.records, seed=41)
        second = split_by_signer(self.records, seed=41)
        self.assertEqual({name: first[name]["signerCodes"] for name in ("train", "validation", "test")}, {name: second[name]["signerCodes"] for name in ("train", "validation", "test")})
        sets = [set(first[name]["signerCodes"]) for name in ("train", "validation", "test")]
        self.assertTrue(sets[0].isdisjoint(sets[1]))
        self.assertTrue(sets[0].isdisjoint(sets[2]))
        self.assertTrue(sets[1].isdisjoint(sets[2]))
        self.assertEqual(first["seed"], 41)

    def test_each_sign_is_present_in_each_split_when_signers_allow_it(self):
        splits = split_by_signer(self.records, seed=9)
        for name in ("train", "validation", "test"):
            self.assertEqual({item["signId"] for item in splits[name]["records"]}, {"SIGN_A", "SIGN_B"})

    def test_preprocessing_emits_float32_32_frame_tensor_and_preserves_missing_mask(self):
        item = record("S01", "SIGN_A")
        features = build_feature_names(LANDMARK_INDICES)
        tensor = preprocess_record(item, LANDMARK_INDICES)
        self.assertEqual(tensor.shape, (1, 32, len(features)))
        self.assertEqual(str(tensor.dtype), "float32")
        self.assertEqual(tensor[0, 0, features.index("leftHand.0.visible")], 0)
        for axis in ("x", "y", "z"):
            self.assertEqual(tensor[0, 0, features.index("leftHand.0." + axis)], 0)
        self.assertAlmostEqual(tensor[0, 0, features.index("rightHand.0.x")], 0.5)

    def test_preprocessing_manifest_hash_is_stable_for_identical_settings(self):
        first = preprocessing_manifest(LANDMARK_INDICES, target_frames=32)
        second = preprocessing_manifest(LANDMARK_INDICES, target_frames=32)
        changed = preprocessing_manifest(LANDMARK_INDICES, target_frames=31)
        self.assertEqual(preprocessing_hash(first), preprocessing_hash(second))
        self.assertNotEqual(preprocessing_hash(first), preprocessing_hash(changed))



    def test_temporal_cnn_accepts_the_manifest_tensor_shape(self):
        model = TemporalSignCNN(input_features=17, class_count=4)
        logits = model(torch.zeros((2, 32, 17), dtype=torch.float32))
        self.assertEqual(tuple(logits.shape), (2, 4))

    def test_rejection_policy_never_accepts_reserved_or_low_confidence_outputs(self):
        accepted = predict_with_rejection([8.0, 1.0, 0.0], ["SIGN_A", "UNKNOWN", "BLANK"], 0.7)
        unknown = predict_with_rejection([0.0, 9.0, 1.0], ["SIGN_A", "UNKNOWN", "BLANK"], 0.7)
        low_confidence = predict_with_rejection([1.1, 1.0, 0.9], ["SIGN_A", "UNKNOWN", "BLANK"], 0.7)
        self.assertTrue(accepted["accepted"])
        self.assertFalse(unknown["accepted"])
        self.assertEqual(unknown["reason"], "unknown_class")
        self.assertFalse(low_confidence["accepted"])
        self.assertEqual(low_confidence["reason"], "low_confidence")

    def test_training_gate_refuses_schema_fixtures_without_external_approvals(self):
        with self.assertRaises(TrainingGateError):
            validate_training_gate({"allowedSigns": ["SIGN_A", "SIGN_B"]}, self.records)

    def test_metric_report_arithmetic_exposes_each_release_gate(self):
        report = evaluate_pilot_metrics(
            true_labels=["SIGN_A", "SIGN_A", "UNKNOWN", "BLANK"],
            predictions=[
                {"signId": "SIGN_A", "confidence": 0.9, "accepted": True, "reason": ""},
                {"signId": "SIGN_A", "confidence": 0.4, "accepted": False, "reason": "low_confidence"},
                {"signId": "SIGN_A", "confidence": 0.8, "accepted": True, "reason": ""},
                {"signId": "BLANK", "confidence": 0.7, "accepted": False, "reason": "unknown_class"},
            ],
            idle_predictions=[{"signId": "SIGN_A", "accepted": True}],
            idle_minutes=2,
            latency_ms=[100, 120, 2000, 200],
            allowed_signs=["SIGN_A"],
            confidence_threshold=0.7,
        )
        self.assertEqual(report["falseAcceptanceRate"], 0.5)
        self.assertEqual(report["confusionMatrix"]["BLANK"]["BLANK"], 1)
        self.assertEqual(report["lowConfidenceRejectionRate"], 1.0)
        self.assertEqual(report["falseWordsPerMinute"], 0.5)
        self.assertEqual(report["p95ModelLatencyMs"], 2000)
        self.assertFalse(report["passesPilotGates"])

    def test_export_refuses_missing_approvals_before_creating_output(self):
        from tempfile import TemporaryDirectory
        from pathlib import Path
        from tools.sign_model.export_onnx import ExportGateError, export_onnx

        with TemporaryDirectory() as directory:
            output = Path(directory) / "model-output"
            with self.assertRaises(ExportGateError):
                export_onnx(
                    Path(directory) / "missing-checkpoint.pt",
                    output,
                    approval_manifest={},
                    evaluation_report={},
                    runtime_metadata={},
                )
            self.assertFalse(output.exists())

    def test_model_manifest_verification_rejects_missing_or_mismatched_identity(self):
        from tools.sign_model.export_onnx import ModelManifestError, verify_model_manifest

        expected_preprocessing = {"preprocessVersion": "v1", "featureNames": ["pose.11.x"]}
        manifest = {
            "modelVersion": "pilot-v1",
            "sha256": "0" * 64,
            "preprocessingHash": preprocessing_hash(expected_preprocessing),
            "preprocessingManifest": expected_preprocessing,
        }
        with self.assertRaises(ModelManifestError):
            verify_model_manifest(None, b"model bytes", expected_preprocessing)
        with self.assertRaises(ModelManifestError):
            verify_model_manifest(manifest, b"different bytes", expected_preprocessing)
        mismatch = dict(manifest)
        mismatch["preprocessingManifest"] = {"preprocessVersion": "v2", "featureNames": ["pose.11.x"]}
        with self.assertRaises(ModelManifestError):
            verify_model_manifest(mismatch, b"model bytes", expected_preprocessing)

    def test_resampling_keeps_invisible_joint_coordinates_zero(self):
        features = build_feature_names(LANDMARK_INDICES)
        tensor = preprocess_record(record("S01", "SIGN_A"), LANDMARK_INDICES)
        self.assertEqual(tensor[0, 1, features.index("leftHand.0.visible")], 0)
        self.assertEqual(tensor[0, 1, features.index("leftHand.0.y")], 0)

    def test_feature_scaler_is_train_only_and_preserves_missing_zero_values(self):
        from tools.sign_model.preprocess import PreprocessError, apply_feature_scaler, fit_feature_scaler

        features = build_feature_names(LANDMARK_INDICES)
        raw = preprocess_record(record("S01", "SIGN_A"), LANDMARK_INDICES)
        with self.assertRaises(PreprocessError):
            fit_feature_scaler([raw], features, source_split="validation")
        scaler = fit_feature_scaler([raw], features, source_split="train")
        transformed = apply_feature_scaler(raw, scaler, features)
        self.assertEqual(transformed[0, 0, features.index("leftHand.0.visible")], 0)
        self.assertEqual(transformed[0, 0, features.index("leftHand.0.x")], 0)
        self.assertEqual(transformed[0, 0, features.index("leftHand.0.y")], 0)

    def test_training_gate_reports_missing_landmark_layout(self):
        from tools.sign_model.train import training_gate_errors

        errors = training_gate_errors({"allowedSigns": ["SIGN_A"]}, self.records)
        self.assertIn("landmark_layout_missing_or_invalid", errors)

    def test_model_manifest_verification_accepts_exact_artifact_and_preprocessing(self):
        import hashlib
        from tools.sign_model.export_onnx import verify_model_manifest

        expected_preprocessing = {"preprocessVersion": "v1", "featureNames": ["pose.11.x"]}
        scaler = {"version": "train-visible-zscore-v1", "featureNames": ["pose.11.x"], "mean": [0.0], "scale": [1.0]}
        allowed_signs = ["SIGN_%02d" % value for value in range(20)]
        manifest = {
            "modelVersion": "pilot-v1", "modelFile": "sign-pilot.onnx",
            "mediaPipeModelVersion": "model-v1", "mediaPipeRuntimeVersion": "runtime-v1",
            "onnxRuntimeVersion": "1.22.0", "preprocessVersion": "v1",
            "preprocessingHash": preprocessing_hash(expected_preprocessing),
            "preprocessingManifest": expected_preprocessing, "landmarkNames": ["pose.11.x"],
            "featureScalerSha256": preprocessing_hash(scaler), "allowedSignIds": allowed_signs,
            "classIds": allowed_signs + ["UNKNOWN", "BLANK", "PARTIAL"], "confidenceThreshold": 0.7,
            "inferenceLocation": "on-device",
            "androidDevice": {"platform": "Android", "model": "Test Device"},
            "pilotMetrics": {"macroF1": 0.9, "falseAcceptanceRate": 0.02, "falseWordsPerMinute": 0.5, "lowConfidenceRejectionRate": 0.95, "p95ModelLatencyMs": 900},
        }
        model_bytes = make_test_onnx(manifest)
        manifest["sha256"] = hashlib.sha256(model_bytes).hexdigest()
        self.assertEqual(verify_model_manifest(manifest, model_bytes, expected_preprocessing, scaler), manifest)
    def test_evaluation_export_gate_checks_values_not_only_pass_flag(self):
        from tools.sign_model.export_onnx import evaluation_gate_errors

        report = {
            "passesPilotGates": True,
            "macroF1": 0.95,
            "falseAcceptanceRate": 0.10,
            "falseWordsPerMinute": 0.1,
            "lowConfidenceRejectionRate": 0.95,
            "p95ModelLatencyMs": 500,
            "gates": {
                "macroF1": True,
                "falseAcceptanceRate": True,
                "falseWordsPerMinute": True,
                "lowConfidenceRejectionRate": True,
                "p95ModelLatencyMs": True,
            },
        }
        self.assertIn("false_acceptance_gate_failed", evaluation_gate_errors(report))

    def test_dataset_fingerprint_is_deterministic_and_tracks_content(self):
        from hashlib import sha256
        from tempfile import TemporaryDirectory
        from pathlib import Path
        from tools.sign_model.train import dataset_sha256

        with TemporaryDirectory() as directory:
            path = Path(directory) / "consented-local.jsonl"
            path.write_bytes(b"local-records-v1")
            first = dataset_sha256(path)
            self.assertEqual(first, sha256(b"local-records-v1").hexdigest())
            path.write_bytes(b"local-records-v2")
            self.assertNotEqual(dataset_sha256(path), first)

    def test_test_classification_summary_saves_confusion_precision_and_recall(self):
        from tools.sign_model.evaluate import classification_summary

        summary = classification_summary(
            true_labels=["SIGN_A", "SIGN_A", "UNKNOWN", "BLANK"],
            predictions=[
                {"signId": "SIGN_A", "accepted": True},
                {"signId": "SIGN_A", "accepted": False},
                {"signId": "SIGN_A", "accepted": True},
                {"signId": "BLANK", "accepted": False},
            ],
            classes=["SIGN_A", "UNKNOWN", "BLANK", "PARTIAL"],
            allowed_signs=["SIGN_A"],
        )
        self.assertEqual(summary["confusionMatrix"]["UNKNOWN"]["SIGN_A"], 1)
        self.assertEqual(summary["perClass"]["SIGN_A"]["precision"], 0.5)
        self.assertEqual(summary["perClass"]["SIGN_A"]["recall"], 0.5)
        self.assertEqual(summary["macroF1"], 0.5)

    def test_training_gate_requires_reject_classes_to_cover_multiple_signers(self):
        from tools.sign_model.train import training_gate_errors

        items = [record("S01", "UNKNOWN"), record("S02", "BLANK"), record("S03", "PARTIAL")]
        errors = training_gate_errors({}, items)
        for label in ("UNKNOWN", "BLANK", "PARTIAL"):
            self.assertIn("negative_class_requires_three_signers:" + label, errors)

    def test_exported_model_contains_the_train_fitted_scaler(self):
        from tools.sign_model.export_onnx import ScaledSignModel
        from tools.sign_model.preprocess import apply_feature_scaler, fit_feature_scaler

        features = build_feature_names(LANDMARK_INDICES)
        raw = preprocess_record(record("S01", "SIGN_A"), LANDMARK_INDICES)
        scaler = fit_feature_scaler([raw], features, source_split="train")
        model = TemporalSignCNN(input_features=len(features), class_count=4).eval()
        fused = ScaledSignModel(model, scaler, features).eval()
        expected_input = torch.from_numpy(apply_feature_scaler(raw, scaler, features))
        with torch.no_grad():
            expected = model(expected_input)
            actual = fused(torch.from_numpy(raw))
        self.assertTrue(torch.allclose(actual, expected, atol=1e-6, rtol=1e-6))

    def test_model_manifest_verification_binds_the_train_scaler_identity(self):
        import hashlib
        from tools.sign_model.export_onnx import ModelManifestError, verify_model_manifest

        expected_preprocessing = {"preprocessVersion": "v1", "featureNames": ["pose.11.x"]}
        scaler = {"version": "train-visible-zscore-v1", "featureNames": ["pose.11.x"], "mean": [0.0], "scale": [1.0]}
        allowed_signs = ["SIGN_%02d" % value for value in range(20)]
        manifest = {
            "modelVersion": "pilot-v1", "modelFile": "sign-pilot.onnx",
            "mediaPipeModelVersion": "model-v1", "mediaPipeRuntimeVersion": "runtime-v1",
            "onnxRuntimeVersion": "1.22.0", "preprocessVersion": "v1",
            "preprocessingHash": preprocessing_hash(expected_preprocessing),
            "preprocessingManifest": expected_preprocessing, "landmarkNames": ["pose.11.x"],
            "featureScalerSha256": preprocessing_hash(scaler), "allowedSignIds": allowed_signs,
            "classIds": allowed_signs + ["UNKNOWN", "BLANK", "PARTIAL"], "confidenceThreshold": 0.7,
            "inferenceLocation": "on-device",
            "androidDevice": {"platform": "Android", "model": "Test Device"},
            "pilotMetrics": {"macroF1": 0.9, "falseAcceptanceRate": 0.02, "falseWordsPerMinute": 0.5, "lowConfidenceRejectionRate": 0.95, "p95ModelLatencyMs": 900},
        }
        model_bytes = make_test_onnx(manifest)
        manifest["sha256"] = hashlib.sha256(model_bytes).hexdigest()
        mismatch = {**scaler, "scale": [2.0]}
        with self.assertRaises(ModelManifestError):
            verify_model_manifest(manifest, model_bytes, expected_preprocessing, mismatch)
    def test_training_gate_returns_errors_for_malformed_manifest_and_records(self):
        from tools.sign_model.train import training_gate_errors

        errors = training_gate_errors(
            {"allowedSigns": [{"id": "SIGN_A"}], "signers": [{"code": "S01"}]},
            [{"signerCode": {"code": "S01"}, "signId": {"id": "SIGN_A"}}],
        )
        self.assertIn("pilot_requires_exactly_20_approved_signs", errors)
        self.assertIn("pilot_requires_at_least_20_approved_signers", errors)

    def test_preprocessing_rejects_boolean_frame_count(self):
        from tools.sign_model.preprocess import PreprocessError

        with self.assertRaises(PreprocessError):
            preprocessing_manifest(LANDMARK_INDICES, target_frames=True)

    def test_feature_scaler_rejects_malformed_statistics(self):
        from tools.sign_model.preprocess import PreprocessError, apply_feature_scaler

        features = build_feature_names(LANDMARK_INDICES)
        bad_scaler = {"version": "train-visible-zscore-v1", "featureNames": features, "mean": [0.0], "scale": [1.0]}
        with self.assertRaises(PreprocessError):
            apply_feature_scaler(preprocess_record(record("S01", "SIGN_A"), LANDMARK_INDICES), bad_scaler, features)

    def test_validation_threshold_preserves_clear_signs_while_rejecting_false_accepts(self):
        import numpy as np
        from tools.sign_model.train import calibrate_confidence_threshold

        logits = [[3.8, 0.0]] * 10 + [[1.1, 0.0], [0.0, 3.0]]
        labels = ["SIGN_A"] * 10 + ["UNKNOWN", "UNKNOWN"]
        threshold = calibrate_confidence_threshold(logits, labels, ["SIGN_A", "UNKNOWN"], ["SIGN_A"])
        self.assertGreater(threshold, 0.75)
        self.assertLess(threshold, 0.90)
        self.assertTrue(np.isfinite(threshold))

    def test_manifest_must_match_preprocessing_embedded_in_onnx(self):
        import hashlib
        from tools.sign_model.export_onnx import ModelManifestError, verify_model_manifest

        expected_preprocessing = {"preprocessVersion": "v1", "featureNames": ["pose.11.x"]}
        scaler = {"version": "train-visible-zscore-v1", "featureNames": ["pose.11.x"], "mean": [0.0], "scale": [1.0]}
        allowed_signs = ["SIGN_%02d" % value for value in range(20)]
        manifest = {
            "modelVersion": "pilot-v1", "modelFile": "sign-pilot.onnx",
            "mediaPipeModelVersion": "model-v1", "mediaPipeRuntimeVersion": "runtime-v1",
            "onnxRuntimeVersion": "1.22.0", "preprocessVersion": "v1",
            "preprocessingHash": preprocessing_hash(expected_preprocessing),
            "preprocessingManifest": expected_preprocessing, "landmarkNames": ["pose.11.x"],
            "featureScalerSha256": preprocessing_hash(scaler), "allowedSignIds": allowed_signs,
            "classIds": allowed_signs + ["UNKNOWN", "BLANK", "PARTIAL"], "confidenceThreshold": 0.7,
            "inferenceLocation": "on-device",
            "androidDevice": {"platform": "Android", "model": "Test Device"},
            "pilotMetrics": {"macroF1": 0.9, "falseAcceptanceRate": 0.02, "falseWordsPerMinute": 0.5, "lowConfidenceRejectionRate": 0.95, "p95ModelLatencyMs": 900},
        }
        mismatched_bytes = make_test_onnx(manifest, {
            "tidkopru.preprocessingManifest": "{\"featureNames\":[\"pose.11.x\"],\"preprocessVersion\":\"v2\"}"
        })
        manifest["sha256"] = hashlib.sha256(mismatched_bytes).hexdigest()
        with self.assertRaises(ModelManifestError):
            verify_model_manifest(manifest, mismatched_bytes, expected_preprocessing, scaler)

    def test_evaluation_rejects_invalid_prediction_shape_and_unapproved_true_label(self):
        from tools.sign_model.evaluate import classification_summary

        with self.assertRaises(ValueError):
            classification_summary(["SIGN_A"], [{"signId": [], "accepted": False}], ["SIGN_A"], ["SIGN_A"])
        with self.assertRaises(ValueError):
            evaluate_pilot_metrics(
                ["NOT_APPROVED"], [{"signId": "NOT_APPROVED", "confidence": 0.9, "accepted": False, "reason": "unknown_class"}],
                [], 1, [1], ["SIGN_A"], 0.7,
            )

if __name__ == "__main__":
    unittest.main()
