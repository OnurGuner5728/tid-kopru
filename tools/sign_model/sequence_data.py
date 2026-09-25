"""Signer-disjoint sequence data preparation for reviewed TİD glosses."""

from __future__ import annotations

import hashlib
import json
import math
import random
import re
from collections.abc import Mapping, Sequence

import numpy as np


_GROUPS = {"pose", "leftHand", "rightHand", "face"}
_FEATURE = re.compile(r"^(pose|leftHand|rightHand|face)\.(\d+)\.(x|y|z|visible)$")
_SHA256 = re.compile(r"^[a-fA-F0-9]{64}$")
_SPLITS = ("train", "validation", "test")
_SEQUENCE_PREPROCESS_ALGORITHM = "linear-visible-mask-time-v1"


class SequenceDataError(ValueError):
    """Raised when utterance sequences cannot satisfy the fixed CTC contract."""


def _canonical_clip_hash(record: Mapping) -> str:
    frames = record.get("frames")
    if not isinstance(frames, list) or not frames:
        raise SequenceDataError("invalid_frames")
    canonical_frames = []
    for frame in frames:
        if not isinstance(frame, Mapping):
            raise SequenceDataError("invalid_frame")
        canonical_frames.append({key: value for key, value in frame.items() if key != "timestampMs"})
    encoded = json.dumps(canonical_frames, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _allocate_split_counts(total: int) -> dict[str, int]:
    exact = [total * 0.70, total * 0.15, total * 0.15]
    counts = [math.floor(value) for value in exact]
    remainder = total - sum(counts)
    order = sorted(range(3), key=lambda index: (-(exact[index] - counts[index]), index))
    for index in order[:remainder]:
        counts[index] += 1
    for index, count in enumerate(counts):
        if count:
            continue
        donor = max(range(3), key=lambda candidate: counts[candidate])
        if counts[donor] <= 1:
            raise SequenceDataError("insufficient_signers")
        counts[donor] -= 1
        counts[index] = 1
    return dict(zip(_SPLITS, counts, strict=True))


def sequence_preprocess_fingerprint(preprocess_version: str, feature_names: Sequence[str], target_frames: int) -> str:
    """Hash every sequence-resampling input that must match at inference."""
    if not isinstance(preprocess_version, str) or not preprocess_version:
        raise SequenceDataError("invalid_preprocess_version")
    if (
        not isinstance(feature_names, Sequence)
        or isinstance(feature_names, (str, bytes))
        or not feature_names
        or any(not isinstance(name, str) or not name for name in feature_names)
        or len(set(feature_names)) != len(feature_names)
    ):
        raise SequenceDataError("invalid_feature_names")
    if not isinstance(target_frames, int) or isinstance(target_frames, bool) or target_frames < 2:
        raise SequenceDataError("invalid_target_frames")
    contract = {
        "algorithm": _SEQUENCE_PREPROCESS_ALGORITHM,
        "preprocessVersion": preprocess_version,
        "featureNames": list(feature_names),
        "targetFrames": target_frames,
    }
    encoded = json.dumps(contract, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _phrase(record: Mapping) -> tuple[str, ...]:
    events = record.get("glossEvents", [])
    if not isinstance(events, list):
        raise SequenceDataError("invalid_gloss_events")
    phrase = []
    for event in events:
        if not isinstance(event, Mapping) or not isinstance(event.get("glossId"), str):
            raise SequenceDataError("invalid_gloss_events")
        phrase.append(event["glossId"])
    kind = record.get("sampleKind")
    if kind not in ("SIGN", "BLANK", "UNKNOWN", "PARTIAL"):
        raise SequenceDataError("invalid_sample_kind")
    if kind == "SIGN" and not phrase:
        raise SequenceDataError("invalid_gloss_events")
    if kind != "SIGN" and phrase:
        raise SequenceDataError("reject_sample_has_gloss")
    return tuple(phrase)


def build_sequence_splits(
    records: object,
    seed: int,
    *,
    feature_names: Sequence[str] | None = None,
    target_frames: int | None = None,
) -> dict:
    """Split complete utterances by signer and return a fingerprinted manifest."""
    if not isinstance(records, (list, tuple)) or not records:
        raise SequenceDataError("invalid_records")
    if not isinstance(seed, int) or isinstance(seed, bool):
        raise SequenceDataError("invalid_seed")
    if (feature_names is None) != (target_frames is None):
        raise SequenceDataError("preprocess_fingerprint_inputs_required")

    seen_ids: set[str] = set()
    seen_clip_hashes: set[str] = set()
    signer_groups: dict[str, list[Mapping]] = {}
    capture_contracts: set[str] = set()
    preprocess_versions: set[str] = set()
    phrases_by_record: dict[str, tuple[str, ...]] = {}

    for record in records:
        if not isinstance(record, Mapping) or record.get("schemaVersion") != 2:
            raise SequenceDataError("unsupported_utterance_schema")
        utterance_id = record.get("utteranceId")
        signer = record.get("signerCode")
        if not isinstance(utterance_id, str) or not utterance_id:
            raise SequenceDataError("invalid_utterance_id")
        if utterance_id in seen_ids:
            raise SequenceDataError("duplicate_utterance")
        seen_ids.add(utterance_id)
        if not isinstance(signer, str) or not signer:
            raise SequenceDataError("invalid_signer")
        clip_hash = _canonical_clip_hash(record)
        if clip_hash in seen_clip_hashes:
            raise SequenceDataError("duplicate_clip_content")
        seen_clip_hashes.add(clip_hash)
        contract = record.get("captureContractSha256")
        version = record.get("preprocessVersion")
        if not isinstance(contract, str) or not _SHA256.fullmatch(contract):
            raise SequenceDataError("invalid_capture_contract")
        if not isinstance(version, str) or not version:
            raise SequenceDataError("invalid_preprocess_version")
        capture_contracts.add(contract.lower())
        preprocess_versions.add(version)
        phrases_by_record[utterance_id] = _phrase(record)
        signer_groups.setdefault(signer, []).append(record)

    if len(capture_contracts) != 1:
        raise SequenceDataError("capture_contract_mismatch")
    if len(preprocess_versions) != 1:
        raise SequenceDataError("preprocess_version_mismatch")
    preprocess_hash = (
        sequence_preprocess_fingerprint(next(iter(preprocess_versions)), feature_names, target_frames)
        if feature_names is not None and target_frames is not None
        else None
    )
    if len(signer_groups) < 3:
        raise SequenceDataError("insufficient_signers")

    signers = sorted(signer_groups)
    random.Random(seed).shuffle(signers)
    counts = _allocate_split_counts(len(signers))
    partitions: dict[str, list[str]] = {}
    cursor = 0
    for split_name in _SPLITS:
        count = counts[split_name]
        partitions[split_name] = signers[cursor:cursor + count]
        cursor += count

    result: dict[str, object] = {}
    split_utterance_ids: dict[str, set[str]] = {}
    for split_name in _SPLITS:
        members = set(partitions[split_name])
        rows = [record for record in records if record["signerCode"] in members]
        rows.sort(key=lambda record: record["utteranceId"])
        result[split_name] = rows
        split_utterance_ids[split_name] = {record["utteranceId"] for record in rows}

    overlaps: dict[str, list[list[str]]] = {}
    for first_index, first in enumerate(_SPLITS):
        first_phrases = {
            phrases_by_record[utterance_id]
            for utterance_id in split_utterance_ids[first]
            if phrases_by_record[utterance_id]
        }
        for second in _SPLITS[first_index + 1:]:
            second_phrases = {
                phrases_by_record[utterance_id]
                for utterance_id in split_utterance_ids[second]
                if phrases_by_record[utterance_id]
            }
            shared = sorted(first_phrases & second_phrases)
            overlaps[f"{first}:{second}"] = [list(phrase) for phrase in shared]

    result["phraseOverlap"] = overlaps
    result["manifest"] = {
        "seed": seed,
        "captureContractSha256": next(iter(capture_contracts)),
        "preprocessVersion": next(iter(preprocess_versions)),
        "preprocessHash": preprocess_hash,
        "runtimeFingerprint": next(iter(capture_contracts)),
        "signers": {split: sorted(partitions[split]) for split in _SPLITS},
        "utteranceIds": {split: sorted(split_utterance_ids[split]) for split in _SPLITS},
        "phraseOverlap": overlaps,
    }
    return result


def _read_feature(frame: Mapping, feature_name: str, start_ms: float, duration_ms: float) -> tuple[float, str | None, tuple[int, int] | None]:
    if feature_name == "time.relative":
        timestamp = frame.get("timestampMs")
        return ((float(timestamp) - start_ms) / duration_ms if duration_ms > 0 else 0.0, None, None)
    match = _FEATURE.fullmatch(feature_name)
    if not match:
        raise SequenceDataError("invalid_feature_name")
    group, index_text, axis = match.groups()
    index = int(index_text)
    if group not in _GROUPS:
        raise SequenceDataError("invalid_feature_name")
    coordinates = frame.get(group)
    visibility = frame.get(group + "Visibility")
    if not isinstance(coordinates, list) or not isinstance(visibility, list) or index >= len(visibility) or (index + 1) * 3 > len(coordinates):
        raise SequenceDataError("feature_layout_mismatch")
    mask = visibility[index]
    if mask not in (0, 1) or isinstance(mask, bool):
        raise SequenceDataError("invalid_visibility")
    if axis == "visible":
        return float(mask), f"{group}.{index}.visible", None
    coordinate_index = index * 3 + {"x": 0, "y": 1, "z": 2}[axis]
    value = coordinates[coordinate_index]
    if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value):
        raise SequenceDataError("invalid_coordinate")
    return (float(value) if mask else 0.0, f"{group}.{index}.visible", (index, {"x": 0, "y": 1, "z": 2}[axis]))


def preprocess_utterance(record: Mapping, target_frames: int, feature_names: Sequence[str]) -> np.ndarray:
    """Resample a v2 utterance to float32[T,N], retaining masks and relative time."""
    if not isinstance(record, Mapping) or not isinstance(record.get("frames"), list) or not record["frames"]:
        raise SequenceDataError("invalid_frames")
    if not isinstance(target_frames, int) or isinstance(target_frames, bool) or target_frames < 1:
        raise SequenceDataError("invalid_target_frames")
    if not isinstance(feature_names, Sequence) or isinstance(feature_names, (str, bytes)) or not feature_names:
        raise SequenceDataError("invalid_feature_names")
    if any(not isinstance(name, str) for name in feature_names):
        raise SequenceDataError("invalid_feature_names")

    frames = record["frames"]
    timestamps = []
    for frame in frames:
        if not isinstance(frame, Mapping):
            raise SequenceDataError("invalid_frame")
        timestamp = frame.get("timestampMs")
        if not isinstance(timestamp, (int, float)) or isinstance(timestamp, bool) or not math.isfinite(timestamp):
            raise SequenceDataError("invalid_timestamp")
        timestamps.append(float(timestamp))
    if any(right <= left for left, right in zip(timestamps, timestamps[1:])):
        raise SequenceDataError("invalid_timestamp")
    duration = timestamps[-1] - timestamps[0]
    rows = []
    coordinate_info: dict[int, tuple[str, list[float]]] = {}
    for frame in frames:
        row = []
        for feature_index, feature_name in enumerate(feature_names):
            value, mask_name, coordinate = _read_feature(frame, feature_name, timestamps[0], duration)
            row.append(value)
            if coordinate is not None:
                if mask_name not in feature_names:
                    raise SequenceDataError("visibility_feature_required")
                coordinate_info[feature_index] = (
                    mask_name,
                    [float(_read_feature(current, mask_name, timestamps[0], duration)[0]) for current in frames],
                )
        rows.append(row)

    source = np.asarray(rows, dtype=np.float32)
    positions = np.linspace(0, len(frames) - 1, target_frames, dtype=np.float64)
    result = np.empty((target_frames, len(feature_names)), dtype=np.float32)
    # At exact midpoints prefer the earlier frame. This keeps a visible sample
    # from being discarded merely because the following frame is occluded.
    nearest = np.ceil(positions - 0.5).astype(np.int64)
    for feature_index, feature_name in enumerate(feature_names):
        if feature_name.endswith(".visible"):
            result[:, feature_index] = source[nearest, feature_index]
        elif feature_name == "time.relative":
            if len(frames) == 1:
                result[:, feature_index] = 0.0
            else:
                result[:, feature_index] = np.interp(positions, np.arange(len(frames)), source[:, feature_index])
        else:
            mask_name, source_masks = coordinate_info[feature_index]
            mask_index = feature_names.index(mask_name)
            for output_index, position in enumerate(positions):
                left = int(math.floor(position))
                right = min(left + 1, len(frames) - 1)
                fraction = float(position - left)
                if source_masks[left] and source_masks[right]:
                    result[output_index, feature_index] = source[left, feature_index] * (1 - fraction) + source[right, feature_index] * fraction
                elif source_masks[nearest[output_index]]:
                    result[output_index, feature_index] = source[nearest[output_index], feature_index]
                else:
                    result[output_index, feature_index] = 0.0
                if source_masks[nearest[output_index]] == 0:
                    result[output_index, feature_index] = 0.0
    if not np.isfinite(result).all():
        raise SequenceDataError("invalid_coordinate")
    return result.astype(np.float32, copy=False)


def _vocabulary_map(vocabulary: Mapping | Sequence[str]) -> dict[str, int]:
    if isinstance(vocabulary, Mapping):
        if all(isinstance(key, str) and isinstance(value, int) and not isinstance(value, bool) and value > 0 for key, value in vocabulary.items()):
            result = dict(vocabulary)
        elif all(isinstance(key, int) and not isinstance(key, bool) and key > 0 and isinstance(value, str) for key, value in vocabulary.items()):
            result = {value: key for key, value in vocabulary.items()}
        else:
            raise SequenceDataError("invalid_vocabulary")
    elif isinstance(vocabulary, Sequence) and not isinstance(vocabulary, (str, bytes)):
        result = {gloss: index + 1 for index, gloss in enumerate(vocabulary) if isinstance(gloss, str)}
        if len(result) != len(vocabulary):
            raise SequenceDataError("invalid_vocabulary")
    else:
        raise SequenceDataError("invalid_vocabulary")
    ids = list(result.values())
    if not result or len(ids) != len(set(ids)) or set(ids) != set(range(1, len(ids) + 1)):
        raise SequenceDataError("invalid_vocabulary")
    return result


def collate_sequences(
    records: Sequence[Mapping],
    vocabulary: Mapping | Sequence[str],
    *,
    feature_names: Sequence[str] | None = None,
    target_frames: int = 32,
) -> dict[str, np.ndarray]:
    """Pad utterances and flatten approved gloss target IDs for torch CTCLoss."""
    if not isinstance(records, Sequence) or isinstance(records, (str, bytes)) or not records:
        raise SequenceDataError("invalid_batch")
    gloss_ids = _vocabulary_map(vocabulary)
    normalized = []
    targets = []
    for record in records:
        names = feature_names or record.get("featureNames")
        if not names:
            raise SequenceDataError("feature_names_required")
        features = preprocess_utterance(record, target_frames, names)
        events = record.get("glossEvents", [])
        target = []
        previous_gloss = None
        minimum_frames = 0
        for event in events:
            gloss = event.get("glossId") if isinstance(event, Mapping) else None
            if gloss not in gloss_ids:
                raise SequenceDataError("unknown_gloss")
            token_id = gloss_ids[gloss]
            target.append(token_id)
            minimum_frames += 1 + (1 if gloss == previous_gloss else 0)
            previous_gloss = gloss
        if len(features) < minimum_frames:
            raise SequenceDataError("ctc_input_too_short")
        normalized.append(features)
        targets.append(target)

    width = normalized[0].shape[1]
    if any(features.shape[1] != width for features in normalized):
        raise SequenceDataError("feature_layout_mismatch")
    max_frames = max(features.shape[0] for features in normalized)
    padded = np.zeros((len(normalized), max_frames, width), dtype=np.float32)
    for index, features in enumerate(normalized):
        padded[index, :features.shape[0], :] = features
    input_lengths = np.asarray([features.shape[0] for features in normalized], dtype=np.int64)
    target_lengths = np.asarray([len(target) for target in targets], dtype=np.int64)
    flat_targets = np.asarray([token for target in targets for token in target], dtype=np.int64)
    return {
        "features": padded,
        "targetIds": flat_targets,
        "inputLengths": input_lengths,
        "targetLengths": target_lengths,
    }


def decode_gloss_ctc(
    logits: object,
    blank_id: int,
    vocabulary: Mapping[int, str] | Sequence[str | None],
    *,
    min_confidence: float = 0.0,
) -> list[dict]:
    """Greedy CTC decode logits into gloss events with inclusive-start/exclusive-end frames."""
    array = np.asarray(logits, dtype=np.float64)
    if array.ndim == 3:
        if array.shape[1] != 1:
            raise SequenceDataError("invalid_logits_shape")
        array = array[:, 0, :]
    if array.ndim != 2 or array.shape[0] == 0 or array.shape[1] == 0 or not np.isfinite(array).all():
        raise SequenceDataError("invalid_logits")
    if not isinstance(blank_id, int) or isinstance(blank_id, bool) or not 0 <= blank_id < array.shape[1]:
        raise SequenceDataError("invalid_blank_id")
    if not isinstance(min_confidence, (int, float)) or isinstance(min_confidence, bool) or not math.isfinite(min_confidence) or not 0 <= min_confidence <= 1:
        raise SequenceDataError("invalid_confidence_threshold")
    if isinstance(vocabulary, Mapping):
        class_map = dict(vocabulary)
    elif isinstance(vocabulary, Sequence) and not isinstance(vocabulary, (str, bytes)):
        class_map = {index: gloss for index, gloss in enumerate(vocabulary)}
    else:
        raise SequenceDataError("invalid_vocabulary")

    shifted = array - np.max(array, axis=1, keepdims=True)
    probabilities = np.exp(shifted)
    probabilities /= probabilities.sum(axis=1, keepdims=True)
    classes = np.argmax(array, axis=1).tolist()
    events = []
    start = None
    current = None
    scores = []

    def finish(end_frame: int) -> None:
        nonlocal start, current, scores
        if current is None:
            return
        gloss = class_map.get(current)
        if not isinstance(gloss, str) or not gloss:
            raise SequenceDataError("invalid_class")
        confidence = float(np.mean(scores))
        if confidence < min_confidence:
            raise SequenceDataError("low_confidence")
        events.append({"glossId": gloss, "startFrame": start, "endFrame": end_frame, "confidence": confidence})
        start = None
        current = None
        scores = []

    for frame_index, class_id in enumerate(classes):
        if class_id == blank_id:
            finish(frame_index)
            continue
        if class_id < 0 or class_id >= array.shape[1] or class_id not in class_map:
            raise SequenceDataError("invalid_class")
        if current == class_id:
            scores.append(float(probabilities[frame_index, class_id]))
        else:
            finish(frame_index)
            current = class_id
            start = frame_index
            scores = [float(probabilities[frame_index, class_id])]
    finish(len(classes))
    return events
