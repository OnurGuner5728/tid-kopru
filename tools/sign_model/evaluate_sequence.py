"""Held-out gloss-sequence metrics and evaluation evidence binding."""

from __future__ import annotations

import hashlib
import json
import math
import re
from collections import Counter
from collections.abc import Mapping, Sequence


def sequence_edit_distance(reference: Sequence[str], hypothesis: Sequence[str]) -> int:
    previous = list(range(len(hypothesis) + 1))
    for row_index, reference_item in enumerate(reference, start=1):
        current = [row_index]
        for column_index, hypothesis_item in enumerate(hypothesis, start=1):
            current.append(min(
                current[-1] + 1,
                previous[column_index] + 1,
                previous[column_index - 1] + (reference_item != hypothesis_item),
            ))
        previous = current
    return previous[-1]


def phrase_confidence(events: Sequence[Mapping]) -> float:
    """Use the weakest timed gloss event as the phrase-level confidence."""
    if not isinstance(events, Sequence) or isinstance(events, (str, bytes)) or not events:
        raise ValueError("empty_gloss_sequence")
    confidences = []
    for event in events:
        if not isinstance(event, Mapping):
            raise ValueError("invalid_gloss_event")
        confidence = event.get("confidence")
        if (
            not isinstance(confidence, (int, float))
            or isinstance(confidence, bool)
            or not math.isfinite(confidence)
            or not 0 <= confidence <= 1
        ):
            raise ValueError("invalid_event_confidence")
        confidences.append(float(confidence))
    return min(confidences)


def sequence_metrics(
    references: Sequence[Sequence[str]],
    hypotheses: Sequence[Sequence[str]],
    sample_kinds: Sequence[str] | None = None,
) -> dict:
    if len(references) != len(hypotheses) or not references:
        raise ValueError("invalid_evaluation_sequences")
    if sample_kinds is None:
        sample_kinds = ["SIGN"] * len(references)
    if len(sample_kinds) != len(references):
        raise ValueError("invalid_sample_kinds")

    true_positive: Counter[str] = Counter()
    false_positive: Counter[str] = Counter()
    false_negative: Counter[str] = Counter()
    distances = []
    exact = 0
    rejected = 0
    reject_false_accepts: Counter[str] = Counter()
    reject_denominators: Counter[str] = Counter()
    for reference, hypothesis, kind in zip(references, hypotheses, sample_kinds, strict=True):
        if not isinstance(reference, Sequence) or isinstance(reference, (str, bytes)):
            raise ValueError("invalid_reference_sequence")
        if hypothesis is None:
            hypothesis = []
        if not isinstance(hypothesis, Sequence) or isinstance(hypothesis, (str, bytes)):
            raise ValueError("invalid_hypothesis_sequence")
        if any(not isinstance(gloss, str) or not gloss for gloss in (*reference, *hypothesis)):
            raise ValueError("invalid_gloss_id")
        if not isinstance(kind, str) or kind not in {"SIGN", "BLANK", "UNKNOWN", "PARTIAL"}:
            raise ValueError("invalid_sample_kind")
        if (kind == "SIGN" and not reference) or (kind != "SIGN" and reference):
            raise ValueError("sample_kind_target_mismatch")
        ref_counts, hyp_counts = Counter(reference), Counter(hypothesis)
        for gloss in ref_counts.keys() | hyp_counts.keys():
            matched = min(ref_counts[gloss], hyp_counts[gloss])
            true_positive[gloss] += matched
            false_positive[gloss] += hyp_counts[gloss] - matched
            false_negative[gloss] += ref_counts[gloss] - matched
        distances.append(sequence_edit_distance(reference, hypothesis))
        exact += reference == hypothesis
        rejected += not hypothesis
        if kind in {"BLANK", "UNKNOWN", "PARTIAL"}:
            reject_denominators[kind] += 1
            reject_false_accepts[kind] += bool(hypothesis)

    missing_reject_classes = [kind for kind in ("BLANK", "UNKNOWN", "PARTIAL") if not reject_denominators[kind]]
    if missing_reject_classes:
        raise ValueError("missing_reject_class:" + ",".join(missing_reject_classes))


    labels = sorted(true_positive.keys() | false_positive.keys() | false_negative.keys())
    per_gloss = {}
    for gloss in labels:
        precision_denominator = true_positive[gloss] + false_positive[gloss]
        recall_denominator = true_positive[gloss] + false_negative[gloss]
        per_gloss[gloss] = {
            "precision": true_positive[gloss] / precision_denominator if precision_denominator else 0.0,
            "recall": true_positive[gloss] / recall_denominator if recall_denominator else 0.0,
            "truePositive": true_positive[gloss],
            "falsePositive": false_positive[gloss],
            "falseNegative": false_negative[gloss],
        }
    precision_values = [entry["precision"] for entry in per_gloss.values()]
    recall_values = [entry["recall"] for entry in per_gloss.values()]
    false_acceptance = {
        kind: {
            "numerator": reject_false_accepts[kind],
            "denominator": reject_denominators[kind],
            "rate": reject_false_accepts[kind] / reject_denominators[kind] if reject_denominators[kind] else None,
        }
        for kind in ("BLANK", "UNKNOWN", "PARTIAL")
    }
    return {
        "utteranceCount": len(references),
        "sentenceGlossExactMatch": exact / len(references),
        "meanGlossEditDistance": sum(distances) / len(distances),
        "rejectionRate": rejected / len(references),
        "macroGlossPrecision": sum(precision_values) / len(precision_values) if precision_values else 0.0,
        "macroGlossRecall": sum(recall_values) / len(recall_values) if recall_values else 0.0,
        "perGloss": per_gloss,
        "falseAcceptance": false_acceptance,
    }


def calibrate_confidence_threshold(
    references: Sequence[Sequence[str]],
    event_sequences: Sequence[Sequence[Mapping]],
    sample_kinds: Sequence[str],
    candidate_thresholds: Sequence[float],
) -> dict:
    """Choose a validation-only threshold that first satisfies every reject gate."""
    if (
        len(references) != len(event_sequences)
        or len(references) != len(sample_kinds)
        or not references
        or not isinstance(candidate_thresholds, Sequence)
        or isinstance(candidate_thresholds, (str, bytes))
        or not candidate_thresholds
    ):
        raise ValueError("invalid_validation_sequences")
    thresholds = []
    for threshold in candidate_thresholds:
        if (
            not isinstance(threshold, (int, float))
            or isinstance(threshold, bool)
            or not math.isfinite(threshold)
            or not 0 <= threshold <= 1
        ):
            raise ValueError("invalid_confidence_threshold")
        thresholds.append(float(threshold))
    if len(set(thresholds)) != len(thresholds):
        raise ValueError("duplicate_confidence_threshold")

    validated_events = []
    for events in event_sequences:
        if not isinstance(events, Sequence) or isinstance(events, (str, bytes)):
            raise ValueError("invalid_validation_events")
        checked = []
        for event in events:
            if not isinstance(event, Mapping):
                raise ValueError("invalid_validation_event")
            gloss = event.get("glossId")
            confidence = event.get("confidence")
            if not isinstance(gloss, str) or not gloss:
                raise ValueError("invalid_gloss_id")
            if (
                not isinstance(confidence, (int, float))
                or isinstance(confidence, bool)
                or not math.isfinite(confidence)
                or not 0 <= confidence <= 1
            ):
                raise ValueError("invalid_event_confidence")
            checked.append((gloss, float(confidence)))
        validated_events.append(checked)

    best = None
    for threshold in sorted(thresholds):
        hypotheses = [
            [] if any(confidence < threshold for _gloss, confidence in events)
            else [gloss for gloss, _confidence in events]
            for events in validated_events
        ]
        metrics = sequence_metrics(references, hypotheses, sample_kinds)
        if any(
            metrics["falseAcceptance"][kind]["rate"] > 0.05
            for kind in ("BLANK", "UNKNOWN", "PARTIAL")
        ):
            continue
        candidate = {"threshold": threshold, "metrics": metrics}
        if best is None or (metrics["sentenceGlossExactMatch"], threshold) > (
            best["metrics"]["sentenceGlossExactMatch"], best["threshold"]
        ):
            best = candidate
    if best is None:
        raise ValueError("validation_false_acceptance_gate_failed")
    return best


def sha256_file(path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def bind_evaluation_evidence(metrics: Mapping, dataset_path, split_manifest: Mapping, checkpoint_path, android_measurements_path, *, synthetic: bool) -> dict:
    if not isinstance(metrics, Mapping) or not isinstance(split_manifest, Mapping) or not isinstance(synthetic, bool):
        raise ValueError("invalid_evaluation_evidence")
    utterance_count = metrics.get("utteranceCount")
    if not isinstance(utterance_count, int) or isinstance(utterance_count, bool) or utterance_count < 1:
        raise ValueError("invalid_evaluation_metrics")
    signer_splits = split_manifest.get("signers")
    if not isinstance(signer_splits, Mapping):
        raise ValueError("invalid_split_manifest")
    seen_signers = set()
    held_out_signers = None
    for split_name in ("train", "validation", "test"):
        values = signer_splits.get(split_name)
        if (
            not isinstance(values, list)
            or not values
            or any(not isinstance(value, str) or not value for value in values)
            or len(set(values)) != len(values)
        ):
            raise ValueError(f"invalid_split_manifest:{split_name}")
        overlap = seen_signers.intersection(values)
        if overlap:
            raise ValueError("signer_split_overlap")
        seen_signers.update(values)
        if split_name == "test":
            held_out_signers = len(values)
    if split_manifest.get("utteranceIds") is not None:
        utterance_splits = split_manifest["utteranceIds"]
        if not isinstance(utterance_splits, Mapping):
            raise ValueError("invalid_split_manifest")
        seen_utterance_ids = set()
        for split_name in ("train", "validation", "test"):
            values = utterance_splits.get(split_name)
            if (
                not isinstance(values, list)
                or any(not isinstance(value, str) or not value for value in values)
                or len(set(values)) != len(values)
            ):
                raise ValueError(f"invalid_split_manifest:{split_name}")
            if seen_utterance_ids.intersection(values):
                raise ValueError("utterance_split_overlap")
            seen_utterance_ids.update(values)
    for field in ("captureContractSha256", "preprocessHash", "runtimeFingerprint"):
        value = split_manifest.get(field)
        if not isinstance(value, str) or not re.fullmatch(r"[a-fA-F0-9]{64}", value):
            raise ValueError("invalid_split_fingerprint")
    with open(android_measurements_path, "r", encoding="utf-8") as handle:
        android = json.load(handle)
    device = android.get("androidDevice") if isinstance(android, Mapping) else None
    if not isinstance(device, Mapping) or device.get("platform") != "Android" or not device.get("model"):
        raise ValueError("android_measurement_required")
    canonical_splits = json.dumps(split_manifest, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode("utf-8")
    return {
        **dict(metrics),
        "synthetic": synthetic,
        "datasetSha256": sha256_file(dataset_path),
        "splitManifestSha256": hashlib.sha256(canonical_splits).hexdigest(),
        "checkpointSha256": sha256_file(checkpoint_path),
        "heldOutUtterances": utterance_count,
        "heldOutSigners": held_out_signers,
        "captureContractSha256": split_manifest.get("captureContractSha256"),
        "preprocessVersion": split_manifest.get("preprocessVersion"),
        "preprocessHash": split_manifest.get("preprocessHash"),
        "runtimeFingerprint": split_manifest.get("runtimeFingerprint"),
        "androidMeasurementSha256": sha256_file(android_measurements_path),
        "androidDevice": dict(device),
    }
