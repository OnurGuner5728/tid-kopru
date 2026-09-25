"""Fail-closed ONNX export for a real, reviewed TİD gloss-sequence evaluation."""

from __future__ import annotations

import hashlib
import json
import math
import re
from collections.abc import Mapping, Sequence
from pathlib import Path

import torch

from tools.sign_model.sequence_data import sequence_preprocess_fingerprint
from tools.sign_model.sequence_model import NormalizedSequenceModel


_SHA256 = re.compile(r"^[a-fA-F0-9]{64}$")
_REQUIRED_APPROVALS = (
    "advisorApproved",
    "participantConsentVerified",
    "dataRightsVerified",
    "mediaPipeMetricsConsentVerified",
    "mediaPipeAssetsRightsVerified",
    "androidDeviceVerified",
)


def verify_sequence_export_gate(report: object) -> None:
    if not isinstance(report, Mapping) or report.get("synthetic") is not False or report.get("passed") is not True:
        raise ValueError("real_evaluation_required")
    if not isinstance(report.get("androidMeasurementSha256"), str) or not _SHA256.fullmatch(report["androidMeasurementSha256"]):
        raise ValueError("android_measurement_required")
    if not isinstance(report.get("androidDevice"), Mapping) or report["androidDevice"].get("platform") != "Android" or not report["androidDevice"].get("model"):
        raise ValueError("android_measurement_required")
    held_out = report.get("heldOutUtterances")
    held_out_signers = report.get("heldOutSigners")
    semantic_acceptance = report.get("semanticAcceptanceAfterAdjudication")
    if (
        not isinstance(held_out_signers, int)
        or isinstance(held_out_signers, bool)
        or held_out_signers < 20
    ):
        raise ValueError("held_out_signer_gate_failed")
    if (
        not isinstance(held_out, int)
        or isinstance(held_out, bool)
        or held_out < 300
        or not isinstance(semantic_acceptance, (int, float))
        or isinstance(semantic_acceptance, bool)
        or not 0.90 <= semantic_acceptance <= 1.0
    ):
        raise ValueError("human_review_gate_failed")
    support_false_acceptance = report.get("supportOutsideFalseAcceptance")
    if (
        not isinstance(support_false_acceptance, (int, float))
        or isinstance(support_false_acceptance, bool)
        or not 0 <= support_false_acceptance <= 0.05
    ):
        raise ValueError("false_acceptance_gate_failed")
    class_metrics = report.get("falseAcceptance")
    if not isinstance(class_metrics, Mapping):
        raise ValueError("reject_class_evidence_required")
    for kind in ("BLANK", "UNKNOWN", "PARTIAL"):
        entry = class_metrics.get(kind)
        if (
            not isinstance(entry, Mapping)
            or not isinstance(entry.get("numerator"), int)
            or isinstance(entry.get("numerator"), bool)
            or entry["numerator"] < 0
            or not isinstance(entry.get("denominator"), int)
            or isinstance(entry.get("denominator"), bool)
            or entry["denominator"] < 1
            or entry["numerator"] > entry["denominator"]
            or not isinstance(entry.get("rate"), (int, float))
            or isinstance(entry.get("rate"), bool)
            or not 0 <= entry["rate"] <= 1
        ):
            raise ValueError("reject_class_evidence_required")
        if not math.isclose(entry["rate"], entry["numerator"] / entry["denominator"], rel_tol=0, abs_tol=1e-12):
            raise ValueError("false_acceptance_evidence_mismatch")
        if entry["rate"] > 0.05:
            raise ValueError("false_acceptance_gate_failed")
    decoder_threshold = report.get("decoderConfidenceThreshold")
    if (
        not isinstance(decoder_threshold, (int, float))
        or isinstance(decoder_threshold, bool)
        or not 0 <= decoder_threshold <= 1
    ):
        raise ValueError("validation_threshold_required")
    review = report.get("humanReview")
    if not isinstance(review, Mapping) or review.get("twoIndependentReviewers") is not True or review.get("adjudicationComplete") is not True:
        raise ValueError("human_review_required")
    for field in ("datasetSha256", "splitManifestSha256", "checkpointSha256", "captureContractSha256", "preprocessHash", "runtimeFingerprint"):
        if not isinstance(report.get(field), str) or not _SHA256.fullmatch(report[field]):
            raise ValueError("evaluation_fingerprint_missing")


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _assert_approvals(
    approval_manifest: object,
    report: Mapping,
    *,
    feature_names: Sequence[str],
    target_frames: int,
) -> None:
    if not isinstance(approval_manifest, Mapping) or any(approval_manifest.get(field) is not True for field in _REQUIRED_APPROVALS):
        raise ValueError("real_approval_manifest_required")
    if str(approval_manifest.get("captureContractSha256", "")).lower() != str(report.get("captureContractSha256", "")).lower():
        raise ValueError("capture_contract_mismatch")
    if approval_manifest.get("preprocessVersion") != report.get("preprocessVersion"):
        raise ValueError("preprocess_fingerprint_mismatch")
    if approval_manifest.get("featureNames") != list(feature_names):
        raise ValueError("feature_manifest_mismatch")
    expected_preprocess_hash = sequence_preprocess_fingerprint(
        report["preprocessVersion"], feature_names, target_frames
    )
    if report.get("preprocessHash") != expected_preprocess_hash:
        raise ValueError("preprocess_fingerprint_mismatch")


def export_sequence_onnx(
    model: torch.nn.Module,
    output_dir: str | Path,
    evaluation_report: Mapping,
    approval_manifest: Mapping,
    *,
    feature_names: Sequence[str],
    feature_scaler: Mapping,
    target_frames: int,
    vocabulary: Mapping[str, int],
    runtime_metadata: Mapping,
    blank_id: int = 0,
    confidence_threshold: float | None = None,
) -> dict:
    verify_sequence_export_gate(evaluation_report)
    _assert_approvals(
        approval_manifest,
        evaluation_report,
        feature_names=feature_names,
        target_frames=target_frames,
    )
    if not isinstance(feature_names, Sequence) or isinstance(feature_names, (str, bytes)) or not feature_names:
        raise ValueError("invalid_feature_manifest")
    if not isinstance(feature_scaler, Mapping) or feature_scaler.get("featureNames") != list(feature_names):
        raise ValueError("feature_scaler_mismatch")
    if not isinstance(vocabulary, Mapping) or not vocabulary or sorted(vocabulary.values()) != list(range(1, len(vocabulary) + 1)):
        raise ValueError("invalid_vocabulary")
    if blank_id != 0 or not isinstance(runtime_metadata, Mapping) or not runtime_metadata:
        raise ValueError("invalid_runtime_manifest")
    calibrated_threshold = evaluation_report["decoderConfidenceThreshold"]
    if confidence_threshold is not None and confidence_threshold != calibrated_threshold:
        raise ValueError("validation_threshold_mismatch")

    destination = Path(output_dir).resolve()
    destination.mkdir(parents=True, exist_ok=True)
    model_path = destination / "tid-gloss-sequence.onnx"
    manifest_path = destination / "sequence-model-manifest.json"
    normalized_model = NormalizedSequenceModel(model, dict(feature_scaler)).eval()
    example = torch.zeros((1, target_frames, len(feature_names)), dtype=torch.float32)
    torch.onnx.export(
        normalized_model,
        example,
        model_path,
        input_names=["features"],
        output_names=["logits"],
        dynamic_axes={"features": {0: "batch", 1: "time"}, "logits": {0: "time", 1: "batch"}},
        opset_version=17,
    )
    manifest = {
        "schemaVersion": "1.0",
        "modelVersion": "tid-gloss-sequence-1",
        "modelPath": "./tid-gloss-sequence.onnx",
        "modelSha256": _sha256(model_path),
        "captureContractSha256": evaluation_report["captureContractSha256"],
        "preprocessHash": evaluation_report["preprocessHash"],
        "runtimeFingerprint": evaluation_report["runtimeFingerprint"],
        "featureNames": list(feature_names),
        "featureScaler": dict(feature_scaler),
        "targetFrames": target_frames,
        "glossVocabulary": dict(vocabulary),
        "blankId": blank_id,
        "decoder": {"kind": "greedy_ctc", "confidenceThreshold": calibrated_threshold},
        "evaluationReportSha256": hashlib.sha256(json.dumps(evaluation_report, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")).hexdigest(),
        "androidMeasurementSha256": evaluation_report["androidMeasurementSha256"],
        "androidDevice": dict(evaluation_report["androidDevice"]),
        "runtime": dict(runtime_metadata),
    }
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    return manifest
