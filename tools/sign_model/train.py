"""Consent-gated sign-pilot temporal model; imported by tests without training data."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import random
import tempfile
from collections import Counter
from pathlib import Path
from typing import Sequence

import numpy as np
import torch
from torch import nn
from torch.utils.data import DataLoader, TensorDataset

from tools.sign_pilot.validate_dataset import validate_dataset
from tools.sign_model.preprocess import (
    apply_feature_scaler, build_feature_names, fit_feature_scaler, preprocess_record,
    preprocessing_hash, preprocessing_manifest,
)
from tools.sign_model.split_by_signer import assert_signer_disjoint, split_by_signer

RESERVED_LABELS = ("UNKNOWN", "BLANK", "PARTIAL")
REQUIRED_APPROVALS = (
    "advisorApproved", "participantConsentVerified", "dataRightsVerified",
    "mediaPipeMetricsConsentVerified", "mediaPipeAssetsRightsVerified", "androidDeviceVerified",
)


def dataset_sha256(path) -> str:
    """Return a stable content fingerprint for the local-only training dataset."""
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()

class TrainingGateError(RuntimeError):
    def __init__(self, errors: Sequence[str]):
        self.errors = list(dict.fromkeys(errors))
        super().__init__("training is blocked: " + "; ".join(self.errors))


class TemporalSignCNN(nn.Module):
    """Small 1D CNN. Input shape is [batch, 32 frames, manifest features]."""
    def __init__(self, input_features: int, class_count: int):
        super().__init__()
        if input_features < 1 or class_count < 2:
            raise ValueError("invalid feature or class count")
        self.input_features = input_features
        self.encoder = nn.Sequential(
            nn.Conv1d(input_features, 48, kernel_size=5, padding=2), nn.BatchNorm1d(48), nn.ReLU(),
            nn.Conv1d(48, 64, kernel_size=3, padding=1), nn.BatchNorm1d(64), nn.ReLU(),
            nn.Conv1d(64, 64, kernel_size=3, padding=1), nn.ReLU(),
            nn.AdaptiveAvgPool1d(1), nn.Flatten(), nn.Linear(64, class_count),
        )

    def forward(self, values: torch.Tensor) -> torch.Tensor:
        if values.ndim != 3 or tuple(values.shape[1:]) != (32, self.input_features):
            raise ValueError("input must be [batch, 32, manifest_feature_count]")
        if values.dtype != torch.float32 or not torch.isfinite(values).all():
            raise ValueError("input must contain finite float32 values")
        return self.encoder(values.transpose(1, 2).contiguous())


def predict_with_rejection(logits, class_ids, confidence_threshold, approved_signs=None):
    if not 0 <= confidence_threshold <= 1:
        raise ValueError("confidence_threshold must be within [0, 1]")
    scores = torch.as_tensor(logits, dtype=torch.float32).detach().cpu().reshape(-1)
    if scores.numel() != len(class_ids) or scores.numel() == 0 or not torch.isfinite(scores).all():
        raise ValueError("finite logits must match class_ids")
    probabilities = torch.softmax(scores, dim=0)
    index = int(torch.argmax(probabilities).item())
    sign_id, confidence = str(class_ids[index]), float(probabilities[index].item())
    allowed = set(approved_signs) if approved_signs is not None else set(class_ids) - set(RESERVED_LABELS)
    if sign_id in RESERVED_LABELS or sign_id not in allowed:
        accepted, reason = False, "unknown_class"
    elif confidence < confidence_threshold:
        accepted, reason = False, "low_confidence"
    else:
        accepted, reason = True, ""
    return {"signId": sign_id, "confidence": confidence, "accepted": accepted, "reason": reason}


def training_gate_errors(manifest, records, *, repo_root=None, dataset_path=None):
    errors = []
    if not isinstance(manifest, dict):
        return ["invalid_training_manifest"]
    errors.extend("approval_missing:" + key for key in REQUIRED_APPROVALS if manifest.get(key) is not True)
    signs = manifest.get("allowedSigns", [])
    signs = signs if isinstance(signs, list) else []
    valid_signs = all(isinstance(value, str) and value and value not in RESERVED_LABELS for value in signs)
    if not valid_signs or len(signs) != 20 or len(set(value for value in signs if isinstance(value, str))) != 20:
        errors.append("pilot_requires_exactly_20_approved_signs")
    signs = [value for value in signs if isinstance(value, str) and value and value not in RESERVED_LABELS]
    layout = manifest.get("landmarkIndices")
    try:
        expected_preprocessing = preprocessing_manifest(layout, 32)
        if manifest.get("preprocessVersion") != expected_preprocessing["preprocessVersion"]:
            errors.append("preprocessing_version_unsupported")
    except (TypeError, ValueError, KeyError):
        errors.append("landmark_layout_missing_or_invalid")
    signers = manifest.get("signers", [])
    signers = signers if isinstance(signers, list) else []
    if not all(isinstance(value, str) and value for value in signers) or len(set(value for value in signers if isinstance(value, str))) < 20:
        errors.append("pilot_requires_at_least_20_approved_signers")
    signers = [value for value in signers if isinstance(value, str) and value]
    consents = manifest.get("consentCodes", [])
    consents = [value for value in consents if isinstance(value, str) and value] if isinstance(consents, list) else []
    if not consents:
        errors.append("consent_codes_missing")
    conditions = manifest.get("conditions", {})
    if not isinstance(conditions, dict) or any(not isinstance(conditions.get(key), list) or not conditions[key] for key in ("lighting", "distance", "background")):
        errors.append("condition_codes_missing")
        conditions = {}
    condition_codes = {
        "lightingCode": conditions.get("lighting", []),
        "distanceCode": conditions.get("distance", []),
        "backgroundCode": conditions.get("background", []),
    }
    if not manifest.get("metricsDisclosureNoticeId"):
        errors.append("metrics_notice_missing")
    if not manifest.get("preprocessVersion"):
        errors.append("preprocess_version_missing")
    if not isinstance(records, Sequence) or not records:
        errors.append("dataset_missing")
        records = []
    if records:
        labels = [*signs, *RESERVED_LABELS]
        errors.extend("dataset:" + code for code in validate_dataset(records, signers, labels, allowed_conditions=condition_codes))
        if any(not isinstance(item, dict) or item.get("consentCode") not in consents for item in records):
            errors.append("record_consent_not_in_manifest")
        if any(not isinstance(item, dict) or item.get("preprocessVersion") != manifest.get("preprocessVersion") for item in records):
            errors.append("record_preprocessing_version_mismatch")
        if len({item.get("signerCode") for item in records if isinstance(item, dict) and isinstance(item.get("signerCode"), str)}) < 20:
            errors.append("dataset_requires_at_least_20_signers")
        repetitions = Counter((item.get("signerCode"), item.get("signId")) for item in records if isinstance(item, dict) and isinstance(item.get("signerCode"), str) and isinstance(item.get("signId"), str))
        if signs and any(repetitions[(signer, sign_id)] < 10 for signer in signers for sign_id in signs):
            errors.append("dataset_requires_10_repetitions_per_signer_and_sign")
        if not set(RESERVED_LABELS).issubset({item.get("signId") for item in records if isinstance(item, dict) and isinstance(item.get("signId"), str)}):
            errors.append("blank_partial_unknown_examples_required")
        for label in RESERVED_LABELS:
            negative_signers = {item.get("signerCode") for item in records
                                 if isinstance(item, dict) and isinstance(item.get("signerCode"), str) and item.get("signId") == label}
            if len(negative_signers) < 3:
                errors.append("negative_class_requires_three_signers:" + label)
    if dataset_path is not None:
        root = Path(repo_root).resolve() if repo_root else Path(__file__).resolve().parents[2]
        path = Path(dataset_path).resolve()
        if path == root or root in path.parents:
            errors.append("private_dataset_must_be_outside_repository")
    return list(dict.fromkeys(errors))


def validate_training_gate(manifest, records, **kwargs):
    errors = training_gate_errors(manifest, records, **kwargs)
    if errors:
        raise TrainingGateError(errors)


def _read_jsonl_outside_repo(dataset_path, repo_root=None):
    root = Path(repo_root).resolve() if repo_root else Path(__file__).resolve().parents[2]
    path = Path(dataset_path).resolve()
    if path == root or root in path.parents:
        raise TrainingGateError(["private_dataset_must_be_outside_repository"])
    records = []
    with path.open("r", encoding="utf-8") as stream:
        for line_number, line in enumerate(stream, 1):
            if line.strip():
                try:
                    records.append(json.loads(line))
                except json.JSONDecodeError as error:
                    raise TrainingGateError(["invalid_jsonl_line:" + str(line_number)]) from error
    return path, records


def calibrate_confidence_threshold(validation_logits, true_labels, class_ids, approved_signs):
    logits = np.asarray(validation_logits, dtype=np.float32)
    if logits.ndim != 2 or logits.shape != (len(true_labels), len(class_ids)) or not np.isfinite(logits).all():
        raise ValueError("validation logits, labels, and class IDs must align")
    valid_count = sum(label in approved_signs for label in true_labels)
    negative_count = len(true_labels) - valid_count
    if not valid_count or not negative_count:
        raise ValueError("validation signers need approved and reject examples")
    probs = torch.softmax(torch.from_numpy(logits), dim=1).numpy()
    top = probs.argmax(axis=1)
    names = [class_ids[index] for index in top]
    confidences = probs.max(axis=1)
    best = None
    for threshold in (index / 1000 for index in range(1001)):
        false_accepts = sum(name in approved_signs and confidence >= threshold and actual not in approved_signs
                            for name, confidence, actual in zip(names, confidences, true_labels, strict=True))
        accepted_signs = sum(actual in approved_signs and name in approved_signs and confidence >= threshold
                             for name, confidence, actual in zip(names, confidences, true_labels, strict=True))
        if false_accepts / negative_count <= 0.05:
            candidate = (accepted_signs, -threshold)
            if best is None or candidate > best[0]:
                best = (candidate, threshold)
    if best is None:
        raise ValueError("validation data cannot meet the false-acceptance gate")
    return best[1]


def train_model(dataset_path, manifest, output_path, *, repo_root=None, epochs=50, batch_size=32, learning_rate=0.001):
    """Actual training entry point; all gates run before any optimizer step or output."""
    path, records = _read_jsonl_outside_repo(dataset_path, repo_root)
    validate_training_gate(manifest, records, repo_root=repo_root, dataset_path=path)
    source_dataset_digest = dataset_sha256(path)
    output = Path(output_path).resolve()
    root = Path(repo_root).resolve() if repo_root else Path(__file__).resolve().parents[2]
    if output == root or root in output.parents:
        raise TrainingGateError(["private_checkpoint_must_be_outside_repository"])
    if output.exists():
        raise TrainingGateError(["checkpoint_output_already_exists"])
    if epochs < 1 or batch_size < 1 or learning_rate <= 0:
        raise ValueError("epochs, batch_size, and learning_rate must be positive")
    seed = manifest.get("randomSeed")
    if not isinstance(seed, int) or isinstance(seed, bool):
        raise TrainingGateError(["run_seed_missing"])
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    splits = split_by_signer(records, seed=seed)
    assert_signer_disjoint(splits)
    layout = manifest["landmarkIndices"]
    preproc = preprocessing_manifest(layout, 32)
    feature_names = preproc["featureNames"]
    raw = {name: [preprocess_record(record, layout, 32) for record in splits[name]["records"]]
           for name in ("train", "validation", "test")}
    scaler = fit_feature_scaler(raw["train"], feature_names, source_split="train")
    arrays = {name: [apply_feature_scaler(value, scaler, feature_names) for value in items] for name, items in raw.items()}
    classes = list(manifest["allowedSigns"]) + list(RESERVED_LABELS)
    class_map = {label: index for index, label in enumerate(classes)}
    model = TemporalSignCNN(len(feature_names), len(classes))
    optimizer = torch.optim.AdamW(model.parameters(), lr=learning_rate)
    loss_fn = nn.CrossEntropyLoss()
    x_train = torch.from_numpy(np.concatenate(arrays["train"], axis=0))
    y_train = torch.tensor([class_map[item["signId"]] for item in splits["train"]["records"]], dtype=torch.long)
    loader = DataLoader(TensorDataset(x_train, y_train), batch_size=batch_size, shuffle=True,
                        generator=torch.Generator().manual_seed(seed))
    for _ in range(epochs):
        model.train()
        for x_batch, y_batch in loader:
            optimizer.zero_grad(set_to_none=True)
            loss_fn(model(x_batch), y_batch).backward()
            optimizer.step()
    model.eval()
    with torch.no_grad():
        val_logits = model(torch.from_numpy(np.concatenate(arrays["validation"], axis=0))).cpu().numpy()
    val_labels = [item["signId"] for item in splits["validation"]["records"]]
    threshold = calibrate_confidence_threshold(val_logits, val_labels, classes, manifest["allowedSigns"])
    with torch.no_grad():
        test_logits = model(torch.from_numpy(np.concatenate(arrays["test"], axis=0))).cpu().numpy()
    test_labels = [item["signId"] for item in splits["test"]["records"]]
    test_predictions = [predict_with_rejection(row, classes, threshold, manifest["allowedSigns"]) for row in test_logits]
    from tools.sign_model.evaluate import classification_summary
    test_summary = classification_summary(test_labels, test_predictions, classes, manifest["allowedSigns"])
    if dataset_sha256(path) != source_dataset_digest:
        raise TrainingGateError(["dataset_changed_during_training"])
    output.parent.mkdir(parents=True, exist_ok=True)
    checkpoint_payload = {
        "state_dict": model.state_dict(), "classIds": classes, "featureNames": feature_names,
        "preprocessingManifest": preproc, "preprocessingHash": preprocessing_hash(preproc),
        "featureScaler": scaler, "confidenceThreshold": threshold, "randomSeed": seed,
        "datasetSha256": source_dataset_digest, "testClassificationSummary": test_summary,
        "signerCodes": {name: splits[name]["signerCodes"] for name in ("train", "validation", "test")},
    }
    handle, temporary_name = tempfile.mkstemp(prefix=".sign-pilot-checkpoint-", dir=str(output.parent))
    os.close(handle)
    try:
        torch.save(checkpoint_payload, temporary_name)
        os.replace(temporary_name, output)
    finally:
        Path(temporary_name).unlink(missing_ok=True)
    return {"checkpointPath": str(output), "classIds": classes, "confidenceThreshold": threshold}

def _main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Train the consent-gated sign-pilot checkpoint")
    parser.add_argument("--dataset", required=True, help="Local JSONL dataset outside the repository")
    parser.add_argument("--manifest", required=True, help="Advisor/consent/rights approval manifest outside the repository")
    parser.add_argument("--output", required=True, help="Private checkpoint path outside the repository")
    parser.add_argument("--epochs", type=int, default=50)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--learning-rate", type=float, default=0.001)
    parser.add_argument("--repo-root")
    args = parser.parse_args(argv)
    manifest = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
    result = train_model(
        args.dataset, manifest, args.output, repo_root=args.repo_root,
        epochs=args.epochs, batch_size=args.batch_size, learning_rate=args.learning_rate,
    )
    print(json.dumps({"checkpointPath": result["checkpointPath"], "confidenceThreshold": result["confidenceThreshold"]}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
