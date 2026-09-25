"""Fail-closed ONNX export for a consented, measured sign-pilot model."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import shutil
import tempfile
from pathlib import Path
from collections.abc import Mapping, Sequence

import numpy as np
import onnx
import onnxruntime as ort
import torch

from tools.sign_model.preprocess import preprocessing_hash
from tools.sign_model.evaluate import evaluate_checkpoint
from tools.sign_model.train import (
    REQUIRED_APPROVALS,
    RESERVED_LABELS,
    TemporalSignCNN,
    TrainingGateError,
    _read_jsonl_outside_repo,
    dataset_sha256,
    validate_training_gate,
)
from tools.sign_pilot.capture_contract import capture_contract_sha256, capture_contract_sha256_from_manifest

_REQUIRED_METRICS = {
    "macroF1": (0.80, "min"),
    "falseAcceptanceRate": (0.05, "max"),
    "partialFalseAcceptanceRate": (0.05, "max"),
    "falseWordsPerMinute": (1.0, "max"),
    "lowConfidenceRejectionRate": (0.90, "min"),
    "p95ModelLatencyMs": (1500.0, "max"),
}
_REQUIRED_METRIC_GATES = {
    "macroF1": "macroF1",
    "falseAcceptanceRate": "falseAcceptanceRate",
    "partialFalseAcceptanceRate": "partialFalseAcceptanceRate",
    "falseWordsPerMinute": "falseWordsPerMinute",
    "lowConfidenceRejectionRate": "lowConfidenceRejectionRate",
    "p95ModelLatencyMs": "p95ModelLatencyMs",
}


class ExportGateError(RuntimeError):
    def __init__(self, errors: Sequence[str]):
        self.errors = list(dict.fromkeys(errors))
        super().__init__("ONNX export is blocked: " + "; ".join(self.errors))


class ModelManifestError(ValueError):
    """The model bytes or their manifest do not share the expected identity."""


def evaluation_gate_errors(report: Mapping, *, expected_metrics: Mapping | None = None) -> list[str]:
    """Recompute release thresholds; never trust a lone passesPilotGates flag."""
    errors: list[str] = []
    if not isinstance(report, Mapping):
        return ["evaluation_report_missing"]
    gates = report.get("gates")
    if not isinstance(gates, Mapping):
        gates = {}
    for metric, (threshold, direction) in _REQUIRED_METRICS.items():
        value = report.get(metric)
        if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value):
            errors.append("evaluation_metric_missing:" + metric)
            continue
        passed = value >= threshold if direction == "min" else value <= threshold
        if not passed:
            error_code = {
                "macroF1": "macro_f1_gate_failed",
                "falseAcceptanceRate": "false_acceptance_gate_failed",
                "partialFalseAcceptanceRate": "partial_false_acceptance_gate_failed",
                "falseWordsPerMinute": "false_words_per_minute_gate_failed",
                "lowConfidenceRejectionRate": "low_confidence_rejection_gate_failed",
                "p95ModelLatencyMs": "p95_model_latency_gate_failed",
            }[metric]
            errors.append(error_code)
        gate_key = _REQUIRED_METRIC_GATES[metric]
        if gates.get(gate_key) is not True:
            errors.append("evaluation_gate_not_passed:" + gate_key)
        if expected_metrics is not None:
            expected = expected_metrics.get(metric)
            if (not isinstance(expected, (int, float)) or isinstance(expected, bool)
                    or not math.isfinite(expected) or not math.isclose(value, expected, rel_tol=1e-9, abs_tol=1e-12)):
                errors.append("evaluation_metric_recomputed_mismatch:" + metric)
    if expected_metrics is not None:
        for field in (
            "confusionMatrix", "perClass", "gates", "passesPilotGates",
            "idleWindowsProcessed", "lowConfidenceRejectionInterpretation",
        ):
            if report.get(field) != expected_metrics.get(field):
                errors.append("evaluation_report_recomputed_mismatch:" + field)
    if report.get("passesPilotGates") is not True:
        errors.append("evaluation_did_not_pass_pilot_gates")
    return list(dict.fromkeys(errors))


class ScaledSignModel(torch.nn.Module):
    """Run the train-only coordinate scaler inside ONNX with its classifier."""
    def __init__(self, model, scaler: Mapping, feature_names: Sequence[str]):
        super().__init__()
        if (not isinstance(scaler, Mapping) or scaler.get("version") != "train-visible-zscore-v1" or
                list(scaler.get("featureNames", [])) != list(feature_names)):
            raise ModelManifestError("feature scaler does not match the ordered model features")
        means, scales = scaler.get("mean"), scaler.get("scale")
        if (not isinstance(means, list) or not isinstance(scales, list) or
                len(means) != len(feature_names) or len(scales) != len(feature_names) or
                any(not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value) for value in means) or
                any(not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value) or value <= 0 for value in scales)):
            raise ModelManifestError("feature scaler values are invalid")
        lookup = {name: index for index, name in enumerate(feature_names)}
        coordinates = []
        masks = []
        for index, name in enumerate(feature_names):
            if not name.endswith((".x", ".y", ".z")):
                continue
            mask_index = lookup.get(name.rsplit(".", 1)[0] + ".visible")
            if mask_index is None:
                raise ModelManifestError("coordinate feature has no visibility mask")
            coordinates.append(index)
            masks.append(mask_index)
        self.model = model
        self.feature_count = len(feature_names)
        self.coordinate_indices = coordinates
        self.visibility_indices = masks
        self.normalization_index = lookup.get("normalization.shoulders_valid")
        self.register_buffer("means", torch.tensor(means, dtype=torch.float32))
        self.register_buffer("scales", torch.tensor(scales, dtype=torch.float32))

    def forward(self, values: torch.Tensor) -> torch.Tensor:
        if values.ndim != 3 or tuple(values.shape[1:]) != (32, self.feature_count):
            raise ValueError("input must be [batch, 32, manifest_feature_count]")
        if values.dtype != torch.float32 or not torch.isfinite(values).all():
            raise ValueError("input must contain finite float32 values")
        coordinate_masks = dict(zip(self.coordinate_indices, self.visibility_indices, strict=True))
        features = []
        for index in range(self.feature_count):
            if index not in coordinate_masks:
                features.append(values[:, :, index])
                continue
            valid = values[:, :, coordinate_masks[index]] > 0.5
            if self.normalization_index is not None:
                valid = valid & (values[:, :, self.normalization_index] > 0.5)
            standardized = (values[:, :, index] - self.means[index]) / self.scales[index]
            features.append(torch.where(valid, standardized, torch.zeros_like(standardized)))
        return self.model(torch.stack(features, dim=-1))

def _canonical_json(value) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def _onnx_metadata_for_manifest(manifest: Mapping) -> dict[str, str]:
    return {
        "tidkopru.modelVersion": manifest["modelVersion"],
        "tidkopru.mediaPipeModelSha256": manifest["mediaPipeModelSha256"],
        "tidkopru.mediaPipeRuntimeSha256": manifest["mediaPipeRuntimeSha256"],
        "tidkopru.mediaPipeWasmFiles": _canonical_json(manifest["mediaPipeWasmFiles"]),
        "tidkopru.mediaPipeModelVersion": manifest["mediaPipeModelVersion"],
        "tidkopru.mediaPipeRuntimeVersion": manifest["mediaPipeRuntimeVersion"],
        "tidkopru.captureContractSha256": manifest["captureContractSha256"],
        "tidkopru.measurementSha256": manifest["measurementSha256"],
        "tidkopru.onnxRuntimeVersion": manifest["onnxRuntimeVersion"],
        "tidkopru.preprocessVersion": manifest["preprocessVersion"],
        "tidkopru.preprocessingHash": manifest["preprocessingHash"],
        "tidkopru.preprocessingManifest": _canonical_json(manifest["preprocessingManifest"]),
        "tidkopru.featureScalerSha256": manifest["featureScalerSha256"],
        "tidkopru.landmarkNames": _canonical_json(manifest["landmarkNames"]),
        "tidkopru.allowedSignIds": _canonical_json(manifest["allowedSignIds"]),
        "tidkopru.classIds": _canonical_json(manifest["classIds"]),
        "tidkopru.confidenceThreshold": _canonical_json(manifest["confidenceThreshold"]),
    }


def _onnx_value_shape(value_info) -> list[int | str | None]:
    shape = []
    for dimension in value_info.type.tensor_type.shape.dim:
        if dimension.dim_param:
            shape.append(dimension.dim_param)
        elif dimension.HasField("dim_value"):
            shape.append(int(dimension.dim_value))
        else:
            shape.append(None)
    return shape

def verify_model_manifest(manifest: Mapping | None, model_bytes: bytes, expected_preprocessing: Mapping, expected_scaler: Mapping | None = None) -> dict:
    """Validate a manifest against the actual model bytes and pinned preprocessing."""
    if not isinstance(manifest, Mapping):
        raise ModelManifestError("model manifest is missing or invalid")
    if not isinstance(model_bytes, bytes) or not model_bytes:
        raise ModelManifestError("model artifact is empty")
    if not isinstance(expected_preprocessing, Mapping):
        raise ModelManifestError("expected preprocessing identity is invalid")
    required_strings = (
        "modelVersion", "modelFile", "mediaPipeModelVersion", "mediaPipeRuntimeVersion",
        "mediaPipeModelSha256", "mediaPipeRuntimeSha256", "captureContractSha256",
        "onnxRuntimeVersion", "preprocessVersion", "preprocessingHash", "featureScalerSha256", "inferenceLocation",
        "measurementSha256",
    )
    for field in required_strings:
        if not isinstance(manifest.get(field), str) or not manifest[field]:
            raise ModelManifestError("missing manifest field: " + field)
    if Path(manifest["modelFile"]).name != manifest["modelFile"]:
        raise ModelManifestError("modelFile must be a plain filename")
    if manifest["modelFile"] != "sign-pilot.onnx":
        raise ModelManifestError("unexpected model filename")
    actual_digest = hashlib.sha256(model_bytes).hexdigest()
    if manifest.get("sha256") != actual_digest:
        raise ModelManifestError("model SHA-256 does not match the artifact")
    if not re.fullmatch(r"[a-f0-9]{64}", manifest["measurementSha256"]):
        raise ModelManifestError("measurement SHA-256 is invalid")
    expected_hash = preprocessing_hash(expected_preprocessing)
    if manifest.get("preprocessingManifest") != dict(expected_preprocessing):
        raise ModelManifestError("preprocessing metadata differs from the pinned identity")
    if manifest.get("preprocessingHash") != expected_hash:
        raise ModelManifestError("preprocessing hash does not match the pinned identity")
    if manifest.get("preprocessVersion") != expected_preprocessing.get("preprocessVersion"):
        raise ModelManifestError("preprocessing version mismatch")
    try:
        expected_contract_hash = capture_contract_sha256(
            preprocess_version=expected_preprocessing["preprocessVersion"],
            landmark_indices=expected_preprocessing["landmarkIndices"],
            model_version=manifest["mediaPipeModelVersion"],
            runtime_version=manifest["mediaPipeRuntimeVersion"],
            runtime_sha256=manifest["mediaPipeRuntimeSha256"],
            model_sha256=manifest["mediaPipeModelSha256"],
            wasm_files=manifest["mediaPipeWasmFiles"],
        )
    except (KeyError, TypeError, ValueError) as error:
        raise ModelManifestError("capture-contract identity is invalid") from error
    if manifest["captureContractSha256"] != expected_contract_hash:
        raise ModelManifestError("capture-contract fingerprint does not match the extraction identity")
    scaler_digest = manifest.get("featureScalerSha256")
    if (len(scaler_digest) != 64 or any(character not in "0123456789abcdef" for character in scaler_digest)):
        raise ModelManifestError("feature scaler SHA-256 is invalid")
    if expected_scaler is not None and scaler_digest != preprocessing_hash(expected_scaler):
        raise ModelManifestError("feature scaler identity mismatch")
    feature_names = expected_preprocessing.get("featureNames")
    if not isinstance(feature_names, list) or manifest.get("landmarkNames") != feature_names:
        raise ModelManifestError("ordered landmark names differ from the preprocessing identity")
    signs = manifest.get("allowedSignIds")
    if (not isinstance(signs, list) or len(signs) != 20 or
            not all(isinstance(value, str) and value and value not in RESERVED_LABELS for value in signs) or
            len(set(signs)) != 20):
        raise ModelManifestError("manifest must contain exactly 20 unique approved sign IDs")
    expected_classes = signs + list(RESERVED_LABELS)
    if manifest.get("classIds") != expected_classes:
        raise ModelManifestError("model class order does not match the approved sign list")
    threshold = manifest.get("confidenceThreshold")
    if not isinstance(threshold, (int, float)) or isinstance(threshold, bool) or not math.isfinite(threshold) or not 0 <= threshold <= 1:
        raise ModelManifestError("confidence threshold is invalid")
    if manifest.get("inferenceLocation") != "on-device":
        raise ModelManifestError("model must declare on-device inference")
    metrics = manifest.get("pilotMetrics")
    if not isinstance(metrics, Mapping):
        raise ModelManifestError("aggregate pilot metrics are missing")
    for metric, (minimum, direction) in _REQUIRED_METRICS.items():
        value = metrics.get(metric)
        if (not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value) or
                (value < minimum if direction == "min" else value > minimum)):
            raise ModelManifestError("pilot metric did not pass: " + metric)
    device = manifest.get("androidDevice")
    if not isinstance(device, Mapping) or device.get("platform") != "Android" or not isinstance(device.get("model"), str) or not device["model"].strip():
        raise ModelManifestError("verified Android device identity is missing")
    try:
        onnx_model = onnx.load_model_from_string(model_bytes)
        onnx.checker.check_model(onnx_model)
    except Exception as error:
        raise ModelManifestError("model bytes are not a valid ONNX graph") from error
    metadata_items = [(entry.key, entry.value) for entry in onnx_model.metadata_props]
    metadata = dict(metadata_items)
    if len(metadata) != len(metadata_items):
        raise ModelManifestError("ONNX metadata contains duplicate keys")
    for key, expected_value in _onnx_metadata_for_manifest(manifest).items():
        if metadata.get(key) != expected_value:
            raise ModelManifestError("ONNX embedded metadata mismatch: " + key)
    inputs = list(onnx_model.graph.input)
    outputs = list(onnx_model.graph.output)
    if (len(inputs) != 1 or inputs[0].name != "landmark_sequence" or
            _onnx_value_shape(inputs[0]) != [1, 32, len(feature_names)] or
            len(outputs) != 1 or outputs[0].name != "logits" or
            _onnx_value_shape(outputs[0]) != [1, len(expected_classes)]):
        raise ModelManifestError("ONNX tensor shape differs from the model manifest")
    return dict(manifest)


def _approval_errors(manifest: Mapping) -> list[str]:
    if not isinstance(manifest, Mapping):
        return ["approval_manifest_missing"]
    errors = ["approval_missing:" + key for key in REQUIRED_APPROVALS if manifest.get(key) is not True]
    signs = manifest.get("allowedSigns")
    if (not isinstance(signs, list) or len(signs) != 20 or
            not all(isinstance(value, str) and value and value not in RESERVED_LABELS for value in signs) or
            len(set(signs)) != 20):
        errors.append("pilot_requires_exactly_20_approved_signs")
    signers = manifest.get("signers")
    if not isinstance(signers, list) or not all(isinstance(value, str) and value for value in signers) or len(set(signers)) < 20:
        errors.append("pilot_requires_at_least_20_approved_signers")
    try:
        expected_capture_contract = capture_contract_sha256_from_manifest(manifest)
    except (TypeError, ValueError):
        errors.append("capture_contract_identity_missing")
        expected_capture_contract = None
    declared_capture_contract = manifest.get("captureContractSha256")
    if expected_capture_contract is None or declared_capture_contract != expected_capture_contract:
        errors.append("capture_contract_manifest_mismatch")
    return errors


def _runtime_errors(runtime: Mapping, installed_onnxruntime: str) -> list[str]:
    if not isinstance(runtime, Mapping):
        return ["runtime_metadata_missing"]
    errors = []
    for field in ("mediaPipeModelVersion", "mediaPipeRuntimeVersion", "mediaPipeModelSha256", "mediaPipeRuntimeSha256", "onnxRuntimeVersion"):
        if not isinstance(runtime.get(field), str) or not runtime[field]:
            errors.append("runtime_version_missing:" + field)
    if not isinstance(runtime.get("mediaPipeWasmFiles"), list) or len(runtime["mediaPipeWasmFiles"]) < 2:
        errors.append("runtime_wasm_hashes_missing")
    for field in ("mediaPipeModelSha256", "mediaPipeRuntimeSha256"):
        value = runtime.get(field)
        if not isinstance(value, str) or len(value) != 64 or any(character not in "0123456789abcdefABCDEF" for character in value):
            errors.append("runtime_hash_invalid:" + field)
    if runtime.get("onnxRuntimeVersion") != installed_onnxruntime:
        errors.append("onnx_runtime_version_mismatch")
    device = runtime.get("androidDevice")
    if not isinstance(device, Mapping) or device.get("platform") != "Android" or not isinstance(device.get("model"), str) or not device["model"].strip():
        errors.append("verified_android_device_metadata_missing")
    return errors


def _evaluation_binding_errors(report: Mapping, checkpoint_digest: str, data_digest: str, confidence_threshold: float,
                                capture_contract_digest: str, expected_metrics: Mapping | None = None) -> list[str]:
    errors = evaluation_gate_errors(report, expected_metrics=expected_metrics)
    if report.get("checkpointSha256") != checkpoint_digest:
        errors.append("evaluation_checkpoint_identity_mismatch")
    if report.get("datasetSha256") != data_digest:
        errors.append("evaluation_dataset_identity_mismatch")
    if report.get("captureContractSha256") != capture_contract_digest:
        errors.append("evaluation_capture_contract_identity_mismatch")
    if expected_metrics is not None and report.get("measurementSha256") != expected_metrics.get("measurementSha256"):
        errors.append("evaluation_measurement_identity_mismatch")
    if expected_metrics is not None and report.get("idleWindowsProcessed") != expected_metrics.get("idleWindowsProcessed"):
        errors.append("evaluation_idle_coverage_identity_mismatch")
    threshold = report.get("confidenceThreshold")
    if not isinstance(threshold, (int, float)) or isinstance(threshold, bool) or not math.isfinite(threshold) or threshold != confidence_threshold:
        errors.append("evaluation_confidence_threshold_mismatch")
    return list(dict.fromkeys(errors))


def export_onnx(
    checkpoint_path,
    output_dir,
    *,
    dataset_path=None,
    measurement_path=None,
    approval_manifest,
    evaluation_report,
    runtime_metadata,
    repo_root=None,
    model_version=None,
):
    """Export only a gated checkpoint after revalidating its consented dataset and metrics."""
    approval_errors = _approval_errors(approval_manifest)
    if approval_errors:
        raise ExportGateError(approval_errors)
    expected_capture_contract = capture_contract_sha256_from_manifest(approval_manifest)
    if dataset_path is None:
        raise ExportGateError(["consented_dataset_path_required"])
    if not isinstance(evaluation_report, Mapping):
        raise ExportGateError(["evaluation_report_missing"])
    if measurement_path is None:
        raise ExportGateError(["android_measurements_path_required"])
    if not isinstance(runtime_metadata, Mapping):
        raise ExportGateError(["runtime_metadata_missing"])

    root = Path(repo_root).resolve() if repo_root else Path(__file__).resolve().parents[2]
    destination = Path(output_dir).resolve()
    expected_destination = (root / "models" / "sign-pilot").resolve()
    if destination != expected_destination:
        raise ExportGateError(["export_target_must_be_models_sign_pilot"])
    if destination.exists() and any(destination.iterdir()):
        raise ExportGateError(["export_target_must_be_empty"])

    try:
        data_path, records = _read_jsonl_outside_repo(dataset_path, root)
        validate_training_gate(approval_manifest, records, repo_root=root, dataset_path=data_path)
    except (OSError, TrainingGateError) as error:
        raise ExportGateError(["training_dataset_not_valid:" + str(error)]) from error
    data_digest = dataset_sha256(data_path)
    measurements_file = Path(measurement_path).resolve()
    if measurements_file == root or root in measurements_file.parents or not measurements_file.is_file():
        raise ExportGateError(["android_measurements_must_be_outside_repository"])
    try:
        measurements_bytes = measurements_file.read_bytes()
        measurements = json.loads(measurements_bytes.decode("utf-8"))
        if not isinstance(measurements, Mapping):
            raise ValueError("measurement data must be an object")
    except (OSError, UnicodeDecodeError, json.JSONDecodeError, ValueError) as error:
        raise ExportGateError(["android_measurements_invalid:" + str(error)]) from error
    measurement_digest = hashlib.sha256(measurements_bytes).hexdigest()

    checkpoint = Path(checkpoint_path).resolve()
    if checkpoint == root or root in checkpoint.parents or not checkpoint.is_file():
        raise ExportGateError(["private_checkpoint_missing_or_inside_repository"])
    checkpoint_bytes_digest = hashlib.sha256(checkpoint.read_bytes()).hexdigest()
    try:
        payload = torch.load(checkpoint, map_location="cpu", weights_only=True)
    except (OSError, RuntimeError, ValueError, EOFError) as error:
        raise ExportGateError(["checkpoint_unreadable:" + str(error)]) from error
    if not isinstance(payload, dict):
        raise ExportGateError(["checkpoint_invalid"])
    for field in ("state_dict", "classIds", "featureNames", "preprocessingManifest", "preprocessingHash", "featureScaler", "confidenceThreshold", "randomSeed", "signerCodes", "datasetSha256", "captureContractSha256"):
        if field not in payload:
            raise ExportGateError(["checkpoint_field_missing:" + field])
    if payload["datasetSha256"] != data_digest:
        raise ExportGateError(["checkpoint_dataset_identity_mismatch"])
    if payload["captureContractSha256"] != expected_capture_contract:
        raise ExportGateError(["checkpoint_capture_contract_identity_mismatch"])
    if payload["classIds"] != list(approval_manifest["allowedSigns"]) + list(RESERVED_LABELS):
        raise ExportGateError(["checkpoint_sign_order_mismatch"])
    preprocessing = payload["preprocessingManifest"]
    if not isinstance(preprocessing, Mapping) or payload["preprocessingHash"] != preprocessing_hash(preprocessing):
        raise ExportGateError(["checkpoint_preprocessing_hash_mismatch"])
    if payload["featureNames"] != preprocessing.get("featureNames"):
        raise ExportGateError(["checkpoint_feature_order_mismatch"])
    if preprocessing.get("landmarkIndices") != approval_manifest.get("landmarkIndices"):
        raise ExportGateError(["checkpoint_landmark_layout_mismatch"])
    split_signers = payload["signerCodes"]
    if not isinstance(split_signers, Mapping) or any(not isinstance(split_signers.get(name), list) or not split_signers[name] for name in ("train", "validation", "test")):
        raise ExportGateError(["checkpoint_signer_splits_missing"])
    signer_sets = [set(split_signers[name]) for name in ("train", "validation", "test")]
    if any(signer_sets[left].intersection(signer_sets[right]) for left, right in ((0, 1), (0, 2), (1, 2))):
        raise ExportGateError(["checkpoint_signer_leakage"])
    if len(set.union(*signer_sets)) < 20:
        raise ExportGateError(["checkpoint_requires_20_distinct_signers"])

    threshold = payload["confidenceThreshold"]
    if not isinstance(threshold, (int, float)) or isinstance(threshold, bool) or not math.isfinite(threshold) or not 0 <= threshold <= 1:
        raise ExportGateError(["checkpoint_confidence_threshold_invalid"])
    if evaluation_report.get("measurementSha256") != measurement_digest:
        raise ExportGateError(["evaluation_measurement_identity_mismatch"])
    try:
        recomputed_report = evaluate_checkpoint(
            checkpoint, data_path, approval_manifest,
            idle_predictions=measurements["idlePredictions"],
            idle_windows_processed=measurements["idleWindowsProcessed"],
            idle_minutes=measurements["idleMinutes"],
            latency_ms=measurements["latencyMs"],
            android_device=measurements["androidDevice"],
            measurement_sha256=measurement_digest,
            repo_root=root,
        )
    except (KeyError, TypeError, ValueError, TrainingGateError, OSError) as error:
        raise ExportGateError(["evaluation_recomputation_failed:" + str(error)]) from error
    report_errors = _evaluation_binding_errors(
        evaluation_report, checkpoint_bytes_digest, data_digest, float(threshold), expected_capture_contract,
        expected_metrics=recomputed_report,
    )
    if report_errors:
        raise ExportGateError(report_errors)
    runtime_errors = _runtime_errors(runtime_metadata, ort.__version__)
    if runtime_errors:
        raise ExportGateError(runtime_errors)
    for field in ("mediaPipeModelVersion", "mediaPipeRuntimeVersion", "mediaPipeModelSha256", "mediaPipeRuntimeSha256", "mediaPipeWasmFiles"):
        if runtime_metadata.get(field) != approval_manifest.get(field):
            raise ExportGateError(["runtime_capture_contract_mismatch:" + field])
    if evaluation_report.get("androidDevice") != runtime_metadata.get("androidDevice"):
        raise ExportGateError(["evaluation_android_device_mismatch"])
    if evaluation_report.get("allowedSignIds") != approval_manifest.get("allowedSigns"):
        raise ExportGateError(["evaluation_sign_list_mismatch"])

    classes = payload["classIds"]
    if len(classes) < 2 or not isinstance(payload["state_dict"], Mapping):
        raise ExportGateError(["checkpoint_model_state_invalid"])
    model = TemporalSignCNN(input_features=len(payload["featureNames"]), class_count=len(classes))
    try:
        model.load_state_dict(payload["state_dict"], strict=True)
    except (RuntimeError, TypeError) as error:
        raise ExportGateError(["checkpoint_model_state_invalid:" + str(error)]) from error
    model.eval()
    exported_model = ScaledSignModel(model, payload["featureScaler"], payload["featureNames"]).eval()
    dummy = torch.zeros((1, 32, len(payload["featureNames"])), dtype=torch.float32)

    base_model_version = model_version or "controlled-pilot"
    if not isinstance(base_model_version, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}", base_model_version):
        raise ExportGateError(["invalid_model_version"])
    versioned_model_id = base_model_version + "-" + checkpoint_bytes_digest[:12]
    manifest = {
        "modelVersion": versioned_model_id,
        "modelFile": "sign-pilot.onnx",
        "mediaPipeModelVersion": runtime_metadata["mediaPipeModelVersion"],
        "mediaPipeRuntimeVersion": runtime_metadata["mediaPipeRuntimeVersion"],
        "mediaPipeModelSha256": runtime_metadata["mediaPipeModelSha256"].lower(),
        "mediaPipeRuntimeSha256": runtime_metadata["mediaPipeRuntimeSha256"].lower(),
        "mediaPipeWasmFiles": runtime_metadata["mediaPipeWasmFiles"],
        "captureContractSha256": expected_capture_contract,
        "measurementSha256": measurement_digest,
        "onnxRuntimeVersion": runtime_metadata["onnxRuntimeVersion"],
        "preprocessVersion": preprocessing["preprocessVersion"],
        "preprocessingHash": preprocessing_hash(preprocessing),
        "preprocessingManifest": preprocessing,
        "featureScalerSha256": preprocessing_hash(payload["featureScaler"]),
        "landmarkNames": list(payload["featureNames"]),
        "allowedSignIds": list(approval_manifest["allowedSigns"]),
        "classIds": list(classes),
        "confidenceThreshold": float(threshold),
        "pilotMetrics": {key: evaluation_report[key] for key in _REQUIRED_METRICS},
        "androidDevice": dict(runtime_metadata["androidDevice"]),
        "inferenceLocation": "on-device",
    }
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists() and any(destination.iterdir()):
        raise ExportGateError(["export_target_must_be_empty"])
    destination_was_present = destination.exists()
    staging = Path(tempfile.mkdtemp(prefix=".sign-pilot-export-", dir=str(destination.parent)))
    model_file = staging / "sign-pilot.onnx"
    manifest_file = staging / "model-manifest.json"
    published_files = []
    try:
        torch.onnx.export(
            exported_model, dummy, str(model_file), input_names=["landmark_sequence"],
            output_names=["logits"], opset_version=17, dynamo=False,
        )
        onnx_model = onnx.load(str(model_file))
        onnx.helper.set_model_props(onnx_model, _onnx_metadata_for_manifest(manifest))
        onnx.save(onnx_model, str(model_file))
        onnx.checker.check_model(str(model_file))
        session = ort.InferenceSession(str(model_file), providers=["CPUExecutionProvider"])
        model_inputs = session.get_inputs()
        model_outputs = session.get_outputs()
        if (len(model_inputs) != 1 or model_inputs[0].name != "landmark_sequence" or
                model_inputs[0].shape != [1, 32, len(payload["featureNames"])] or
                len(model_outputs) != 1 or model_outputs[0].name != "logits" or
                model_outputs[0].shape != [1, len(classes)]):
            raise ExportGateError(["onnx_tensor_identity_mismatch"])
        with torch.no_grad():
            expected_logits = exported_model(dummy).cpu().numpy()
        actual_logits = session.run(["logits"], {"landmark_sequence": dummy.numpy()})[0]
        if not np.allclose(expected_logits, actual_logits, rtol=1e-4, atol=1e-5):
            raise ExportGateError(["onnx_runtime_output_mismatch"])
        model_bytes = model_file.read_bytes()
        manifest["sha256"] = hashlib.sha256(model_bytes).hexdigest()
        verify_model_manifest(manifest, model_bytes, preprocessing, payload["featureScaler"])
        manifest_file.write_text(json.dumps(manifest, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + "\n", encoding="utf-8")
        destination.mkdir(parents=True, exist_ok=True)
        os.replace(model_file, destination / "sign-pilot.onnx")
        published_files.append(destination / "sign-pilot.onnx")
        try:
            os.replace(manifest_file, destination / "model-manifest.json")
            published_files.append(destination / "model-manifest.json")
        except OSError:
            raise
    except BaseException:
        for published_file in published_files:
            published_file.unlink(missing_ok=True)
        if not destination_was_present and destination.exists() and not any(destination.iterdir()):
            destination.rmdir()
        raise
    finally:
        shutil.rmtree(staging, ignore_errors=True)
    return {"modelPath": str(destination / "sign-pilot.onnx"), "manifestPath": str(destination / "model-manifest.json"), "sha256": manifest["sha256"]}

def _main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Export a consented and measured sign-pilot model to ONNX")
    parser.add_argument("--checkpoint", required=True)
    parser.add_argument("--dataset", required=True)
    parser.add_argument("--approval-manifest", required=True)
    parser.add_argument("--evaluation-report", required=True)
    parser.add_argument("--measurements", required=True)
    parser.add_argument("--runtime-metadata", required=True)
    parser.add_argument("--repo-root")
    parser.add_argument("--model-version")
    args = parser.parse_args(argv)
    def read_json(path):
        return json.loads(Path(path).read_text(encoding="utf-8"))
    result = export_onnx(
        args.checkpoint, (Path(args.repo_root) if args.repo_root else Path(__file__).resolve().parents[2]) / "models" / "sign-pilot",
        dataset_path=args.dataset, approval_manifest=read_json(args.approval_manifest),
        measurement_path=args.measurements,
        evaluation_report=read_json(args.evaluation_report), runtime_metadata=read_json(args.runtime_metadata),
        repo_root=args.repo_root, model_version=args.model_version,
    )
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
