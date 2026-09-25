"""Compact temporal CTC encoder and train-only feature scaling helpers."""

from __future__ import annotations

from collections.abc import Sequence

import numpy as np
import torch
from torch import nn


class TemporalCtcModel(nn.Module):
    """Emit float32 logits shaped [T, B, V] from [B, T, N] features."""

    def __init__(self, input_features: int, vocabulary_size: int, hidden_channels: int = 64):
        super().__init__()
        if input_features < 1 or vocabulary_size < 2 or hidden_channels < 4:
            raise ValueError("invalid_model_dimensions")
        self.input_features = input_features
        self.vocabulary_size = vocabulary_size
        self.encoder = nn.Sequential(
            nn.Conv1d(input_features, hidden_channels, kernel_size=5, padding=2),
            nn.BatchNorm1d(hidden_channels),
            nn.GELU(),
            nn.Conv1d(hidden_channels, hidden_channels, kernel_size=3, padding=1),
            nn.GELU(),
            nn.Conv1d(hidden_channels, vocabulary_size, kernel_size=1),
        )

    def forward(self, features: torch.Tensor) -> torch.Tensor:
        if features.ndim != 3 or features.shape[2] != self.input_features:
            raise ValueError("features must have shape [B,T,N] matching the model manifest")
        if features.dtype != torch.float32 or not torch.isfinite(features).all():
            raise ValueError("features must contain finite float32 values")
        logits = self.encoder(features.transpose(1, 2)).transpose(1, 2)
        return logits.transpose(0, 1).contiguous()


def fit_sequence_scaler(train_features: np.ndarray, feature_names: Sequence[str]) -> dict:
    """Fit mean/std from training frames only; preserve timing and binary masks."""
    values = np.asarray(train_features, dtype=np.float32)
    if (
        values.ndim != 3
        or values.shape[0] == 0
        or values.shape[1] == 0
        or not isinstance(feature_names, Sequence)
        or isinstance(feature_names, (str, bytes))
        or values.shape[2] != len(feature_names)
        or any(not isinstance(name, str) for name in feature_names)
    ):
        raise ValueError("invalid_training_features")
    if not np.isfinite(values).all():
        raise ValueError("invalid_training_features")
    feature_indices = {name: index for index, name in enumerate(feature_names)}
    mean = np.zeros(values.shape[2], dtype=np.float32)
    scale = np.ones(values.shape[2], dtype=np.float32)
    for index, name in enumerate(feature_names):
        if not (name.endswith((".x", ".y", ".z"))):
            continue
        mask_name = name.rsplit(".", 1)[0] + ".visible"
        mask_index = feature_indices.get(mask_name)
        if mask_index is None:
            raise ValueError("visibility_feature_required")
        masks = values[:, :, mask_index]
        if not np.isin(masks, (0.0, 1.0)).all():
            raise ValueError("invalid_visibility")
        column = values[:, :, index][masks == 1.0]
        if column.size == 0:
            continue
        mean[index] = np.mean(column, dtype=np.float64)
        standard_deviation = float(np.std(column, dtype=np.float64))
        scale[index] = standard_deviation if standard_deviation > 1e-6 else 1.0
    return {
        "featureNames": list(feature_names),
        "mean": mean.tolist(),
        "scale": scale.tolist(),
        "fitPartition": "train",
    }


def apply_sequence_scaler(features: np.ndarray, scaler: dict) -> np.ndarray:
    values = np.asarray(features, dtype=np.float32)
    names = scaler.get("featureNames") if isinstance(scaler, dict) else None
    mean = np.asarray(scaler.get("mean") if isinstance(scaler, dict) else [], dtype=np.float32)
    scale = np.asarray(scaler.get("scale") if isinstance(scaler, dict) else [], dtype=np.float32)
    if (
        values.ndim < 2
        or not isinstance(names, list)
        or values.shape[-1] != len(names)
        or mean.shape != (len(names),)
        or scale.shape != (len(names),)
    ):
        raise ValueError("invalid_feature_scaler")
    if not np.isfinite(values).all() or not np.isfinite(mean).all() or not np.isfinite(scale).all() or np.any(scale <= 0):
        raise ValueError("invalid_feature_scaler")
    feature_indices = {name: index for index, name in enumerate(names) if isinstance(name, str)}
    result = values.copy()
    for index, name in enumerate(names):
        if not isinstance(name, str):
            raise ValueError("invalid_feature_scaler")
        if not name.endswith((".x", ".y", ".z")):
            continue
        mask_index = feature_indices.get(name.rsplit(".", 1)[0] + ".visible")
        if mask_index is None:
            raise ValueError("visibility_feature_required")
        mask = values[..., mask_index]
        if not np.isin(mask, (0.0, 1.0)).all():
            raise ValueError("invalid_visibility")
        normalized = (values[..., index] - mean[index]) / scale[index]
        result[..., index] = np.where(mask == 1.0, normalized, 0.0)
    return result.astype(np.float32, copy=False)


class NormalizedSequenceModel(nn.Module):
    """Apply the train-only scaler inside the exported model graph."""

    def __init__(self, model: nn.Module, scaler: dict):
        super().__init__()
        names = scaler.get("featureNames") if isinstance(scaler, dict) else None
        mean = np.asarray(scaler.get("mean") if isinstance(scaler, dict) else [], dtype=np.float32)
        scale = np.asarray(scaler.get("scale") if isinstance(scaler, dict) else [], dtype=np.float32)
        if (
            not isinstance(names, list)
            or not names
            or any(not isinstance(name, str) for name in names)
            or mean.shape != (len(names),)
            or scale.shape != (len(names),)
            or not np.isfinite(mean).all()
            or not np.isfinite(scale).all()
            or np.any(scale <= 0)
        ):
            raise ValueError("invalid_feature_scaler")
        if hasattr(model, "input_features") and model.input_features != len(names):
            raise ValueError("feature_scaler_model_mismatch")
        indices = {name: index for index, name in enumerate(names)}
        mask_indices = {}
        for index, name in enumerate(names):
            if name.endswith((".x", ".y", ".z")):
                mask_index = indices.get(name.rsplit(".", 1)[0] + ".visible")
                if mask_index is None:
                    raise ValueError("visibility_feature_required")
                mask_indices[index] = mask_index
        self.model = model
        self.feature_names = tuple(names)
        self.coordinate_mask_indices = mask_indices
        self.register_buffer("mean", torch.from_numpy(mean.copy()))
        self.register_buffer("scale", torch.from_numpy(scale.copy()))

    def forward(self, features: torch.Tensor) -> torch.Tensor:
        if features.ndim != 3 or features.shape[-1] != len(self.feature_names):
            raise ValueError("features must have shape [B,T,N] matching the scaler")
        if features.dtype != torch.float32 or not torch.isfinite(features).all():
            raise ValueError("features must contain finite float32 values")
        columns = []
        for index, name in enumerate(self.feature_names):
            if index in self.coordinate_mask_indices:
                normalized = (features[..., index] - self.mean[index]) / self.scale[index]
                visible = features[..., self.coordinate_mask_indices[index]] == 1.0
                columns.append(torch.where(visible, normalized, torch.zeros_like(normalized)))
            else:
                columns.append(features[..., index])
        return self.model(torch.stack(columns, dim=-1))


def ctc_batch_loss(
    logits: torch.Tensor,
    target_ids: torch.Tensor,
    input_lengths: torch.Tensor,
    target_lengths: torch.Tensor,
    *,
    blank_id: int = 0,
) -> torch.Tensor:
    if logits.ndim != 3 or logits.dtype != torch.float32:
        raise ValueError("logits must be float32[T,B,V]")
    if not torch.isfinite(logits).all():
        raise ValueError("invalid_logits")
    log_probabilities = logits.log_softmax(dim=-1)
    loss = nn.CTCLoss(blank=blank_id, zero_infinity=False)
    return loss(log_probabilities, target_ids, input_lengths, target_lengths)
