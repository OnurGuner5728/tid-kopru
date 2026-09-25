"""Held-out signer evaluation, pilot release metrics, and report gates."""
from __future__ import annotations

import argparse
import json
import math
import numpy as np
from collections.abc import Mapping, Sequence
from pathlib import Path

PILOT_GATES = {
    "macroF1Minimum": 0.80,
    "falseAcceptanceRateMaximum": 0.05,
    "falseWordsPerMinuteMaximum": 1.0,
    "lowConfidenceRejectionRateMinimum": 0.90,
    "p95ModelLatencyMsMaximum": 1500.0,
}
RESERVED = {"UNKNOWN", "BLANK", "PARTIAL"}


def classification_summary(true_labels: Sequence[str], predictions: Sequence[dict], classes: Sequence[str],
                           allowed_signs: Sequence[str]) -> dict:
    """Return confusion counts, per-class precision/recall/F1, and approved-sign macro-F1."""
    if not true_labels or len(true_labels) != len(predictions):
        raise ValueError("true labels and predictions must have equal non-zero lengths")
    if (not classes or any(not isinstance(label, str) for label in classes) or len(set(classes)) != len(classes) or
            not allowed_signs or any(not isinstance(sign, str) for sign in allowed_signs) or not set(allowed_signs).issubset(classes)):
        raise ValueError("classes and approved signs must be unique and aligned")
    if any(not isinstance(label, str) or label not in classes for label in true_labels):
        raise ValueError("true labels must be present in the class list")
    confusion = {label: {predicted: 0 for predicted in classes} for label in classes}
    for actual, result in zip(true_labels, predictions, strict=True):
        if not isinstance(result, Mapping):
            raise ValueError("every prediction must be an object")
        raw_prediction = result.get("signId")
        if raw_prediction is not None and not isinstance(raw_prediction, str):
            raise ValueError("prediction signId must be a string")
        if not isinstance(result.get("accepted"), bool):
            raise ValueError("prediction accepted value must be boolean")
        predicted = raw_prediction if result["accepted"] is True or raw_prediction in RESERVED else "REJECTED"
        if predicted not in classes and predicted != "REJECTED":
            raise ValueError("accepted prediction is not a model class")
        confusion[actual].setdefault(predicted, 0)
        confusion[actual][predicted] += 1
    per_class = {}
    for label in classes:
        tp = confusion[label].get(label, 0)
        fp = sum(confusion[other].get(label, 0) for other in classes if other != label)
        fn = sum(count for predicted, count in confusion[label].items() if predicted != label)
        precision = tp / (tp + fp) if tp + fp else 0.0
        recall = tp / (tp + fn) if tp + fn else 0.0
        per_class[label] = {
            "precision": precision,
            "recall": recall,
            "f1": 2 * precision * recall / (precision + recall) if precision + recall else 0.0,
        }
    macro_f1 = sum(per_class[label]["f1"] for label in allowed_signs) / len(allowed_signs)
    return {"macroF1": macro_f1, "confusionMatrix": confusion, "perClass": per_class}


def evaluate_pilot_metrics(true_labels: Sequence[str], predictions: Sequence[dict], idle_predictions: Sequence[dict],
                           idle_minutes: float, latency_ms: Sequence[float], allowed_signs: Sequence[str],
                           confidence_threshold: float) -> dict:
    if not true_labels or len(true_labels) != len(predictions):
        raise ValueError("true labels and predictions must have equal non-zero lengths")
    if (not isinstance(allowed_signs, Sequence) or isinstance(allowed_signs, (str, bytes)) or
            not allowed_signs or any(not isinstance(sign, str) or not sign or sign in RESERVED for sign in allowed_signs) or
            len(set(allowed_signs)) != len(allowed_signs)):
        raise ValueError("approved sign IDs must be non-empty and unique")
    if any(not isinstance(label, str) or label not in set(allowed_signs) | RESERVED for label in true_labels):
        raise ValueError("true labels must be approved signs or reserved rejection classes")
    if not isinstance(idle_minutes, (int, float)) or isinstance(idle_minutes, bool) or idle_minutes <= 0 or not math.isfinite(idle_minutes):
        raise ValueError("positive finite idle duration is required")
    if not isinstance(idle_predictions, Sequence) or not isinstance(latency_ms, Sequence) or not latency_ms:
        raise ValueError("idle predictions and Android latency samples are required")
    if any(not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value) or value <= 0 for value in latency_ms):
        raise ValueError("latency samples must be finite and non-negative")
    if not isinstance(confidence_threshold, (int, float)) or isinstance(confidence_threshold, bool) or not math.isfinite(confidence_threshold) or not 0 <= confidence_threshold <= 1:
        raise ValueError("confidence threshold must be finite and within [0, 1]")
    if any(not isinstance(item, Mapping) for item in idle_predictions):
        raise ValueError("idle predictions must be objects")

    classes = sorted(set(true_labels) | set(allowed_signs) | RESERVED)
    summary = classification_summary(true_labels, predictions, classes, allowed_signs)
    negative = [index for index, label in enumerate(true_labels) if label not in allowed_signs]
    false_accepts = sum(predictions[index].get("accepted") is True and predictions[index].get("signId") in allowed_signs for index in negative)
    false_acceptance = false_accepts / len(negative) if negative else None
    for prediction in predictions:
        if not isinstance(prediction, Mapping):
            raise ValueError("predictions must be objects")
        confidence = prediction.get("confidence")
        if (not isinstance(confidence, (int, float)) or isinstance(confidence, bool) or
                not math.isfinite(confidence) or not 0 <= confidence <= 1):
            raise ValueError("prediction confidence must be finite and within [0, 1]")
        if not isinstance(prediction.get("accepted"), bool):
            raise ValueError("prediction accepted value must be boolean")
    low_confidence_predictions = [item for item in predictions if item["confidence"] < confidence_threshold]
    low_confidence_rate = (
        sum(item["accepted"] is not True for item in low_confidence_predictions) / len(low_confidence_predictions)
        if low_confidence_predictions else None
    )
    idle_words = sum(item.get("accepted") is True and item.get("signId") in allowed_signs for item in idle_predictions)
    false_words_per_minute = idle_words / idle_minutes
    latencies = sorted(float(value) for value in latency_ms)
    p95 = latencies[max(0, math.ceil(0.95 * len(latencies)) - 1)]
    gates = {
        "macroF1": summary["macroF1"] >= PILOT_GATES["macroF1Minimum"],
        "falseAcceptanceRate": false_acceptance is not None and false_acceptance <= PILOT_GATES["falseAcceptanceRateMaximum"],
        "falseWordsPerMinute": false_words_per_minute <= PILOT_GATES["falseWordsPerMinuteMaximum"],
        "lowConfidenceRejectionRate": low_confidence_rate is not None and low_confidence_rate >= PILOT_GATES["lowConfidenceRejectionRateMinimum"],
        "p95ModelLatencyMs": p95 <= PILOT_GATES["p95ModelLatencyMsMaximum"],
    }
    return {
        **summary,
        "falseAcceptanceRate": false_acceptance,
        "falseWordsPerMinute": false_words_per_minute,
        "lowConfidenceRejectionRate": low_confidence_rate,
        "p95ModelLatencyMs": p95,
        "confidenceThreshold": float(confidence_threshold),
        "gates": gates,
        "passesPilotGates": all(gates.values()),
    }


def evaluate_checkpoint(checkpoint_path, dataset_path, approval_manifest, *, idle_predictions,
                        idle_minutes, latency_ms, android_device, repo_root=None) -> dict:
    """Evaluate a trained checkpoint once on its signer-disjoint test partition."""
    import hashlib
    import torch

    from tools.sign_model.preprocess import apply_feature_scaler, preprocess_record, preprocessing_hash
    from tools.sign_model.split_by_signer import assert_signer_disjoint, split_by_signer
    from tools.sign_model.train import (
        RESERVED_LABELS, TemporalSignCNN, TrainingGateError, _read_jsonl_outside_repo,
        dataset_sha256, predict_with_rejection, validate_training_gate,
    )

    if not isinstance(android_device, Mapping) or android_device.get("platform") != "Android" or not isinstance(android_device.get("model"), str) or not android_device["model"].strip():
        raise ValueError("verified Android device metadata is required")
    root = Path(repo_root).resolve() if repo_root else Path(__file__).resolve().parents[2]
    data_path, records = _read_jsonl_outside_repo(dataset_path, root)
    validate_training_gate(approval_manifest, records, repo_root=root, dataset_path=data_path)
    data_digest = dataset_sha256(data_path)
    checkpoint = Path(checkpoint_path).resolve()
    if checkpoint == root or root in checkpoint.parents or not checkpoint.is_file():
        raise TrainingGateError(["private_checkpoint_missing_or_inside_repository"])
    checkpoint_digest = hashlib.sha256(checkpoint.read_bytes()).hexdigest()
    payload = torch.load(checkpoint, map_location="cpu", weights_only=True)
    if not isinstance(payload, dict) or payload.get("datasetSha256") != data_digest:
        raise TrainingGateError(["checkpoint_dataset_identity_mismatch"])
    seed = payload.get("randomSeed")
    if not isinstance(seed, int) or isinstance(seed, bool):
        raise TrainingGateError(["checkpoint_run_seed_missing"])
    splits = split_by_signer(records, seed=seed)
    assert_signer_disjoint(splits)
    expected_signers = {name: splits[name]["signerCodes"] for name in ("train", "validation", "test")}
    if payload.get("signerCodes") != expected_signers:
        raise TrainingGateError(["checkpoint_signer_split_identity_mismatch"])
    layout = approval_manifest["landmarkIndices"]
    preprocessing = payload.get("preprocessingManifest")
    feature_names = payload.get("featureNames")
    if (not isinstance(preprocessing, Mapping) or preprocessing.get("landmarkIndices") != layout or
            preprocessing.get("featureNames") != feature_names or payload.get("preprocessingHash") is None):
        raise TrainingGateError(["checkpoint_preprocessing_identity_mismatch"])
    if payload.get("classIds") != list(approval_manifest["allowedSigns"]) + list(RESERVED_LABELS):
        raise TrainingGateError(["checkpoint_sign_order_mismatch"])
    model = TemporalSignCNN(input_features=len(feature_names), class_count=len(payload["classIds"]))
    model.load_state_dict(payload["state_dict"], strict=True)
    model.eval()
    test_records = splits["test"]["records"]
    tensors = [apply_feature_scaler(preprocess_record(item, layout, 32), payload["featureScaler"], feature_names) for item in test_records]
    if not tensors:
        raise TrainingGateError(["held_out_test_split_empty"])
    with torch.no_grad():
        logits = model(torch.from_numpy(np.concatenate(tensors, axis=0))).cpu().numpy()
    class_ids = payload["classIds"]
    predictions = [predict_with_rejection(row, class_ids, payload["confidenceThreshold"], approval_manifest["allowedSigns"]) for row in logits]
    report = evaluate_pilot_metrics(
        [item["signId"] for item in test_records], predictions, idle_predictions, idle_minutes,
        latency_ms, approval_manifest["allowedSigns"], payload["confidenceThreshold"],
    )
    report["checkpointSha256"] = checkpoint_digest
    report["datasetSha256"] = data_digest
    report["androidDevice"] = dict(android_device)
    report["allowedSignIds"] = list(approval_manifest["allowedSigns"])
    return report


def _main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Evaluate a consented sign-pilot checkpoint on held-out signers")
    parser.add_argument("--checkpoint", required=True)
    parser.add_argument("--dataset", required=True)
    parser.add_argument("--approval-manifest", required=True)
    parser.add_argument("--measurements", required=True, help="JSON with idlePredictions, idleMinutes, latencyMs, androidDevice")
    parser.add_argument("--output", required=True, help="Aggregate JSON report path")
    parser.add_argument("--repo-root")
    args = parser.parse_args(argv)
    manifest = json.loads(Path(args.approval_manifest).read_text(encoding="utf-8"))
    measurements = json.loads(Path(args.measurements).read_text(encoding="utf-8"))
    report = evaluate_checkpoint(
        args.checkpoint, args.dataset, manifest,
        idle_predictions=measurements["idlePredictions"], idle_minutes=measurements["idleMinutes"],
        latency_ms=measurements["latencyMs"], android_device=measurements["androidDevice"],
        repo_root=args.repo_root,
    )
    Path(args.output).write_text(json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({"reportPath": str(Path(args.output).resolve()), "passesPilotGates": report["passesPilotGates"]}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
