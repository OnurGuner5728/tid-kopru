"""Train a signer-disjoint TİD gloss CTC model after external approval gates."""

from __future__ import annotations

import argparse
import json
import random
import re
from collections.abc import Mapping, Sequence
from pathlib import Path

import numpy as np
import torch

from tools.sign_model.sequence_data import build_sequence_splits, collate_sequences
from tools.sign_model.sequence_model import TemporalCtcModel, apply_sequence_scaler, ctc_batch_loss, fit_sequence_scaler
from tools.sign_pilot.validate_utterances import validate_utterances


_REQUIRED_APPROVALS = (
    "advisorApproved",
    "participantConsentVerified",
    "dataRightsVerified",
    "mediaPipeMetricsConsentVerified",
    "mediaPipeAssetsRightsVerified",
    "androidDeviceVerified",
)


def _load_jsonl(path: Path) -> list[dict]:
    rows = []
    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            if not line.strip():
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError as error:
                raise ValueError(f"invalid_jsonl:{line_number}") from error
    return rows


def _ensure_outside_repository(path: Path) -> None:
    repository = Path(__file__).resolve().parents[2]
    resolved = path.resolve()
    try:
        resolved.relative_to(repository)
    except ValueError:
        return
    raise ValueError("private_training_path_must_be_outside_repository")


def _assert_training_prerequisites(manifest: object, records: Sequence[Mapping]) -> tuple[list[str], dict[str, int], list[str]]:
    if not isinstance(manifest, Mapping) or any(manifest.get(field) is not True for field in _REQUIRED_APPROVALS):
        raise ValueError("real_approval_manifest_required")
    glosses = manifest.get("approvedGlosses")
    signers = manifest.get("signers")
    feature_names = manifest.get("featureNames")
    if (
        not isinstance(glosses, list)
        or not glosses
        or any(not isinstance(gloss, str) or not gloss for gloss in glosses)
        or len(set(glosses)) != len(glosses)
    ):
        raise ValueError("approved_gloss_manifest_required")
    if (
        not isinstance(signers, list)
        or any(not isinstance(signer, str) or not signer for signer in signers)
        or len(set(signers)) < 3
    ):
        raise ValueError("consented_signer_manifest_required")
    if (
        not isinstance(feature_names, list)
        or not feature_names
        or any(not isinstance(name, str) or not name for name in feature_names)
        or len(set(feature_names)) != len(feature_names)
    ):
        raise ValueError("feature_manifest_required")
    capture_contract = manifest.get("captureContractSha256")
    if not isinstance(capture_contract, str) or not re.fullmatch(r"[a-fA-F0-9]{64}", capture_contract):
        raise ValueError("capture_contract_required")
    errors = validate_utterances(records, signers, glosses)
    if errors:
        raise ValueError("invalid_utterance_dataset:" + ",".join(errors))
    preprocess_version = manifest.get("preprocessVersion")
    if not isinstance(preprocess_version, str) or any(record.get("preprocessVersion") != preprocess_version for record in records):
        raise ValueError("preprocess_version_mismatch")
    signer_codes = {record.get("signerCode") for record in records}
    if not signer_codes.issubset(set(signers)):
        raise ValueError("unknown_signer")
    return glosses, {gloss: index + 1 for index, gloss in enumerate(glosses)}, feature_names


def _assert_reject_class_coverage(splits: Mapping[str, Sequence[Mapping]]) -> None:
    required = ("BLANK", "UNKNOWN", "PARTIAL")
    for split_name in ("train", "validation", "test"):
        rows = splits.get(split_name)
        if not isinstance(rows, Sequence) or isinstance(rows, (str, bytes)):
            raise ValueError(f"invalid_split:{split_name}")
        kinds = set()
        for record in rows:
            if not isinstance(record, Mapping) or not isinstance(record.get("sampleKind"), str):
                raise ValueError(f"invalid_sample_kind:{split_name}")
            kinds.add(record["sampleKind"])
        missing = [kind for kind in required if kind not in kinds]
        if missing:
            raise ValueError(f"missing_reject_samples:{split_name}:" + ",".join(missing))


def train_sequence_model(
    records: Sequence[Mapping],
    approval_manifest: Mapping,
    output_path: str | Path,
    *,
    epochs: int = 30,
    batch_size: int = 8,
    target_frames: int = 256,
    seed: int = 17,
    learning_rate: float = 1e-3,
) -> dict:
    glosses, vocabulary, feature_names = _assert_training_prerequisites(approval_manifest, records)
    destination = Path(output_path)
    _ensure_outside_repository(destination)
    if epochs < 1 or batch_size < 1 or target_frames < 2 or learning_rate <= 0:
        raise ValueError("invalid_training_configuration")
    splits = build_sequence_splits(records, seed=seed, feature_names=feature_names, target_frames=target_frames)
    if splits["manifest"]["captureContractSha256"] != str(approval_manifest.get("captureContractSha256")).lower():
        raise ValueError("capture_contract_mismatch")
    _assert_reject_class_coverage(splits)

    train_batch = collate_sequences(splits["train"], vocabulary, feature_names=feature_names, target_frames=target_frames)
    scaler = fit_sequence_scaler(train_batch["features"], feature_names)
    input_features = len(feature_names)
    torch.manual_seed(seed)
    model = TemporalCtcModel(input_features, len(glosses) + 1)
    optimizer = torch.optim.AdamW(model.parameters(), lr=learning_rate)
    random_generator = random.Random(seed)
    losses = []

    for _epoch in range(epochs):
        model.train()
        order = list(range(len(splits["train"])))
        random_generator.shuffle(order)
        epoch_losses = []
        for offset in range(0, len(order), batch_size):
            batch_records = [splits["train"][index] for index in order[offset:offset + batch_size]]
            batch = collate_sequences(batch_records, vocabulary, feature_names=feature_names, target_frames=target_frames)
            features = torch.from_numpy(apply_sequence_scaler(batch["features"], scaler))
            targets = torch.from_numpy(batch["targetIds"])
            input_lengths = torch.from_numpy(batch["inputLengths"])
            target_lengths = torch.from_numpy(batch["targetLengths"])
            optimizer.zero_grad(set_to_none=True)
            logits = model(features)
            loss = ctc_batch_loss(logits, targets, input_lengths, target_lengths, blank_id=0)
            if not torch.isfinite(loss):
                raise ValueError("nonfinite_training_loss")
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 5.0)
            optimizer.step()
            epoch_losses.append(float(loss.detach()))
        losses.append(sum(epoch_losses) / len(epoch_losses))

    destination.parent.mkdir(parents=True, exist_ok=True)
    checkpoint = {
        "stateDict": model.state_dict(),
        "modelConfig": {"inputFeatures": input_features, "vocabularySize": len(glosses) + 1, "blankId": 0},
        "targetFrames": target_frames,
        "glossVocabulary": vocabulary,
        "featureNames": feature_names,
        "featureScaler": scaler,
        "splitManifest": splits["manifest"],
        "captureContractSha256": splits["manifest"]["captureContractSha256"],
        "preprocessHash": splits["manifest"]["preprocessHash"],
        "trainingSeed": seed,
        "trainingLosses": losses,
    }
    torch.save(checkpoint, destination)
    return {"checkpointPath": str(destination.resolve()), "splitManifest": splits["manifest"], "losses": losses}


def main() -> None:
    parser = argparse.ArgumentParser(description="Train an approved signer-disjoint TİD gloss CTC sequence model.")
    parser.add_argument("--dataset", required=True, type=Path, help="consented JSONL file stored outside Git")
    parser.add_argument("--approval-manifest", required=True, type=Path, help="private advisor/rights/consent manifest")
    parser.add_argument("--output", required=True, type=Path, help="private checkpoint path outside the repository")
    parser.add_argument("--epochs", type=int, default=30)
    parser.add_argument("--batch-size", type=int, default=8)
    args = parser.parse_args()
    _ensure_outside_repository(args.dataset)
    _ensure_outside_repository(args.approval_manifest)
    _ensure_outside_repository(args.output)
    records = _load_jsonl(args.dataset)
    approval = json.loads(args.approval_manifest.read_text(encoding="utf-8"))
    train_sequence_model(records, approval, args.output, epochs=args.epochs, batch_size=args.batch_size)


if __name__ == "__main__":
    main()
