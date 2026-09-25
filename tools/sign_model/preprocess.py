"""Versioned landmark normalization and fixed-length sequence preparation."""

from __future__ import annotations

import hashlib
import json
import math
from collections.abc import Iterable, Mapping, Sequence

import numpy as np

GROUP_ORDER = ("pose", "leftHand", "rightHand", "face")
_VISIBILITY_SUFFIX = ".visible"
_NORMALIZATION_VALID = "normalization.shoulders_valid"
_PREPROCESS_VERSION = "v1"
_SHOULDER_INDICES = (11, 12)


class PreprocessError(ValueError):
    """Raised when a record cannot be mapped to the pinned feature layout."""


def _validated_indices(landmark_indices: Mapping[str, Sequence[int]]) -> dict[str, list[int]]:
    if not isinstance(landmark_indices, Mapping):
        raise PreprocessError("landmark indices must be a mapping")
    if set(landmark_indices) != set(GROUP_ORDER):
        raise PreprocessError("landmark indices must name pose, both hands, and face")
    normalized: dict[str, list[int]] = {}
    limits = {"pose": 32, "leftHand": 20, "rightHand": 20, "face": 477}
    for group in GROUP_ORDER:
        values = landmark_indices[group]
        if not isinstance(values, Sequence) or isinstance(values, (str, bytes)):
            raise PreprocessError("landmark index lists must be sequences")
        indices = list(values)
        if len(set(indices)) != len(indices) or any(
            not isinstance(index, int) or isinstance(index, bool) or index < 0 or index > limits[group]
            for index in indices
        ):
            raise PreprocessError("invalid or duplicate index in " + group)
        normalized[group] = indices
    if any(index not in normalized["pose"] for index in _SHOULDER_INDICES):
        raise PreprocessError("pose layout must include both shoulder indices 11 and 12")
    if len(normalized["face"]) > 32:
        raise PreprocessError("face layout must stay within the approved subset of at most 32 points")
    return normalized


def build_feature_names(landmark_indices: Mapping[str, Sequence[int]]) -> list[str]:
    """Return the ordered model feature names fixed by an approved layout."""
    indices = _validated_indices(landmark_indices)
    names: list[str] = []
    for group in GROUP_ORDER:
        for index in indices[group]:
            prefix = group + "." + str(index)
            names.extend((prefix + ".x", prefix + ".y", prefix + ".z", prefix + _VISIBILITY_SUFFIX))
    names.append(_NORMALIZATION_VALID)
    return names


def preprocessing_manifest(
    landmark_indices: Mapping[str, Sequence[int]],
    target_frames: int = 32,
    shoulder_indices: Sequence[int] = _SHOULDER_INDICES,
) -> dict:
    if not isinstance(target_frames, int) or isinstance(target_frames, bool) or target_frames < 1:
        raise PreprocessError("target_frames must be a positive integer")
    indices = _validated_indices(landmark_indices)
    if tuple(shoulder_indices) != _SHOULDER_INDICES:
        raise PreprocessError("preprocessing v1 uses MediaPipe pose shoulder indices 11 and 12")
    return {
        "preprocessVersion": _PREPROCESS_VERSION,
        "targetFrames": target_frames,
        "landmarkIndices": indices,
        "shoulderIndices": list(_SHOULDER_INDICES),
        "featureNames": build_feature_names(indices),
        "coordinateTransform": "subtract shoulder-center xyz and divide by shoulder width",
        "shoulderWidth": "euclidean xyz distance between pose landmarks 11 and 12",
        "missingJointPolicy": "zero xyz and preserve the binary visibility feature",
        "invalidShoulderPolicy": "zero normalized xyz; preserve visibility and set shoulders_valid to zero",
        "resampling": "uniform linear xyz interpolation; nearest-neighbor binary masks",
        "featureScaler": "fit coordinate mean and standard deviation on training split only",
    }


def preprocessing_hash(manifest: Mapping) -> str:
    encoded = json.dumps(manifest, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _point_map(frame: Mapping, indices: dict[str, list[int]]) -> dict[str, list[tuple[float, float, float, float]]]:
    mapped: dict[str, list[tuple[float, float, float, float]]] = {}
    for group in GROUP_ORDER:
        coordinates = frame.get(group)
        visibility = frame.get(group + "Visibility")
        expected = len(indices[group])
        if not isinstance(coordinates, list) or len(coordinates) != expected * 3:
            raise PreprocessError("coordinate count does not match the approved " + group + " layout")
        if not isinstance(visibility, list) or len(visibility) != expected:
            raise PreprocessError("visibility count does not match the approved " + group + " layout")
        points = []
        for position in range(expected):
            xyz = coordinates[position * 3 : position * 3 + 3]
            mask = visibility[position]
            if any(not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value) for value in xyz):
                raise PreprocessError("coordinates must be finite")
            if mask not in (0, 1) or isinstance(mask, bool):
                raise PreprocessError("visibility masks must be binary")
            points.append((float(xyz[0]), float(xyz[1]), float(xyz[2]), float(mask)))
        mapped[group] = points
    return mapped


def _normalize_frame(frame: Mapping, indices: dict[str, list[int]]) -> list[float]:
    points = _point_map(frame, indices)
    pose_positions = {landmark_index: position for position, landmark_index in enumerate(indices["pose"])}
    left_shoulder = points["pose"][pose_positions[11]]
    right_shoulder = points["pose"][pose_positions[12]]
    width = math.sqrt(sum((left_shoulder[axis] - right_shoulder[axis]) ** 2 for axis in range(3)))
    shoulders_valid = left_shoulder[3] == 1 and right_shoulder[3] == 1 and width > 1e-6
    center = tuple((left_shoulder[axis] + right_shoulder[axis]) / 2 for axis in range(3))

    values: list[float] = []
    for group in GROUP_ORDER:
        for x, y, z, visible in points[group]:
            if visible and shoulders_valid:
                values.extend(((x - center[0]) / width, (y - center[1]) / width, (z - center[2]) / width))
            else:
                values.extend((0.0, 0.0, 0.0))
            values.append(visible)
    values.append(1.0 if shoulders_valid else 0.0)
    return values


def resample_sequence(rows: Sequence[Sequence[float]], target_frames: int, feature_names: Sequence[str]) -> np.ndarray:
    """Uniformly resample coordinate channels and preserve binary masks."""
    array = np.asarray(rows, dtype=np.float32)
    if array.ndim != 2 or array.shape[0] == 0:
        raise PreprocessError("sequence must contain at least one feature row")
    if array.shape[1] != len(feature_names):
        raise PreprocessError("feature row width differs from feature manifest")
    if not isinstance(target_frames, int) or isinstance(target_frames, bool) or target_frames < 1:
        raise PreprocessError("target_frames must be a positive integer")
    if array.shape[0] == 1:
        return np.repeat(array, target_frames, axis=0)

    positions = np.linspace(0, array.shape[0] - 1, target_frames, dtype=np.float64)
    sampled = np.empty((target_frames, array.shape[1]), dtype=np.float32)
    nearest = np.rint(positions).astype(np.int64)
    for feature_index, feature_name in enumerate(feature_names):
        if feature_name.endswith(_VISIBILITY_SUFFIX) or feature_name == _NORMALIZATION_VALID:
            sampled[:, feature_index] = array[nearest, feature_index]
        else:
            sampled[:, feature_index] = np.interp(positions, np.arange(array.shape[0]), array[:, feature_index])
    lookup = {name: index for index, name in enumerate(feature_names)}
    normalization_index = lookup.get(_NORMALIZATION_VALID)
    for feature_index, feature_name in enumerate(feature_names):
        if not feature_name.endswith((".x", ".y", ".z")):
            continue
        prefix = feature_name.rsplit(".", 1)[0]
        visible_index = lookup.get(prefix + _VISIBILITY_SUFFIX)
        if visible_index is None:
            raise PreprocessError("coordinate feature has no matching visibility feature")
        valid = sampled[:, visible_index] > 0.5
        if normalization_index is not None:
            valid &= sampled[:, normalization_index] > 0.5
        sampled[:, feature_index] = np.where(valid, sampled[:, feature_index], 0.0)
    return sampled


def preprocess_record(
    record: Mapping,
    landmark_indices: Mapping[str, Sequence[int]],
    target_frames: int = 32,
) -> np.ndarray:
    """Return a float32 tensor shaped [1, target_frames, N]."""
    indices = _validated_indices(landmark_indices)
    frames = record.get("frames") if isinstance(record, Mapping) else None
    if not isinstance(frames, list) or not frames:
        raise PreprocessError("record must contain at least one frame")
    feature_names = build_feature_names(indices)
    rows = [_normalize_frame(frame, indices) for frame in frames]
    sequence = resample_sequence(rows, target_frames, feature_names)
    return np.expand_dims(sequence, axis=0).astype(np.float32, copy=False)


def fit_feature_scaler(train_tensors: Iterable[np.ndarray], feature_names: Sequence[str], *, source_split: str) -> dict:
    """Fit coordinate statistics on train-only visible values; masks remain binary."""
    if source_split != "train":
        raise PreprocessError("feature statistics may only be fitted on the training split")
    arrays = [np.asarray(tensor, dtype=np.float32) for tensor in train_tensors]
    if not arrays or any(array.ndim != 3 or array.shape[2] != len(feature_names) for array in arrays):
        raise PreprocessError("training tensors do not match the feature manifest")
    joined = np.concatenate(arrays, axis=0)
    features = list(feature_names)
    mean = [0.0] * len(features)
    scale = [1.0] * len(features)
    lookup = {name: index for index, name in enumerate(features)}
    for index, name in enumerate(features):
        if not name.endswith((".x", ".y", ".z")):
            continue
        prefix = name.rsplit(".", 1)[0]
        mask_index = lookup.get(prefix + _VISIBILITY_SUFFIX)
        if mask_index is None:
            raise PreprocessError("coordinate feature has no matching visibility feature")
        valid = joined[:, :, mask_index] > 0.5
        normalization_index = lookup.get(_NORMALIZATION_VALID)
        if normalization_index is not None:
            valid &= joined[:, :, normalization_index] > 0.5
        values = joined[:, :, index][valid]
        if values.size:
            mean[index] = float(values.mean())
            deviation = float(values.std())
            scale[index] = deviation if deviation > 1e-6 else 1.0
    return {"version": "train-visible-zscore-v1", "featureNames": features, "mean": mean, "scale": scale}


def apply_feature_scaler(tensor: np.ndarray, scaler: Mapping, feature_names: Sequence[str]) -> np.ndarray:
    if not isinstance(scaler, Mapping) or scaler.get("version") != "train-visible-zscore-v1" or list(scaler.get("featureNames", [])) != list(feature_names):
        raise PreprocessError("feature scaler does not match preprocessing identity")
    means, scales = scaler.get("mean"), scaler.get("scale")
    if (not isinstance(means, list) or not isinstance(scales, list) or
            len(means) != len(feature_names) or len(scales) != len(feature_names) or
            any(not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value) for value in means) or
            any(not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value) or value <= 0 for value in scales)):
        raise PreprocessError("feature scaler statistics are invalid")
    array = np.asarray(tensor, dtype=np.float32).copy()
    if array.ndim != 3 or array.shape[2] != len(feature_names):
        raise PreprocessError("tensor shape differs from feature manifest")
    lookup = {name: index for index, name in enumerate(feature_names)}
    valid_normalization_index = lookup.get(_NORMALIZATION_VALID)
    for index, name in enumerate(feature_names):
        if not name.endswith((".x", ".y", ".z")):
            continue
        prefix = name.rsplit(".", 1)[0]
        mask_index = lookup[prefix + _VISIBILITY_SUFFIX]
        valid = array[:, :, mask_index] > 0.5
        if valid_normalization_index is not None:
            valid &= array[:, :, valid_normalization_index] > 0.5
        transformed = (array[:, :, index] - float(scaler["mean"][index])) / float(scaler["scale"][index])
        array[:, :, index] = np.where(valid, transformed, 0.0)
    return array.astype(np.float32, copy=False)
