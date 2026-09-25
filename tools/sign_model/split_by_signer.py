"""Signer-grouped, deterministic dataset splits for controlled sign-pilot runs."""

from __future__ import annotations

import random
from collections import defaultdict
from collections.abc import Sequence

_SPLITS = ("train", "validation", "test")


def _allocate_counts(total: int, fractions: Sequence[float]) -> list[int]:
    if len(fractions) != len(_SPLITS) or any(value <= 0 for value in fractions):
        raise ValueError("fractions must contain three positive values")
    if abs(sum(fractions) - 1.0) > 1e-9:
        raise ValueError("fractions must sum to one")
    exact = [total * value for value in fractions]
    counts = [int(value) for value in exact]
    remainder = total - sum(counts)
    order = sorted(range(len(exact)), key=lambda index: (-(exact[index] - counts[index]), index))
    for index in order[:remainder]:
        counts[index] += 1
    return counts


def _partition(order: list[str], counts: list[int]) -> dict[str, list[str]]:
    result: dict[str, list[str]] = {}
    cursor = 0
    for name, count in zip(_SPLITS, counts, strict=True):
        result[name] = order[cursor : cursor + count]
        cursor += count
    return result


def _coverage_score(groups: dict[str, list[dict]], assignment: dict[str, list[str]]) -> tuple[int, int]:
    present = 0
    possible = 0
    for split_name in _SPLITS:
        signers = set(assignment[split_name])
        split_signs = {
            record["signId"]
            for signer in signers
            for record in groups[signer]
            if isinstance(record.get("signId"), str)
        }
        present += len(split_signs)
    all_signs = {record["signId"] for records in groups.values() for record in records if isinstance(record.get("signId"), str)}
    for sign_id in all_signs:
        signer_count = sum(any(record.get("signId") == sign_id for record in records) for records in groups.values())
        possible += min(len(_SPLITS), signer_count)
    return present, possible


def assert_signer_disjoint(split: dict) -> None:
    """Raise if a signer appears in more than one returned split."""
    seen: set[str] = set()
    for name in _SPLITS:
        if name not in split or not isinstance(split[name], dict):
            raise ValueError("split is missing " + name)
        signers = set(split[name].get("signerCodes", []))
        actual = {record.get("signerCode") for record in split[name].get("records", [])}
        if None in actual or actual != signers:
            raise ValueError("signerCodes do not match records in " + name)
        if seen.intersection(signers):
            raise ValueError("signer leakage across splits")
        seen.update(signers)


def split_by_signer(
    records: Sequence[dict],
    seed: int = 0,
    fractions: Sequence[float] = (0.6, 0.2, 0.2),
    *,
    search_attempts: int = 1024,
) -> dict:
    """Split complete signer groups; optimize sign coverage without clip leakage."""
    if not isinstance(records, Sequence) or isinstance(records, (str, bytes)) or not records:
        raise ValueError("records must be a non-empty sequence")
    if not isinstance(seed, int) or isinstance(seed, bool):
        raise ValueError("seed must be an integer")
    if not isinstance(search_attempts, int) or search_attempts < 1:
        raise ValueError("search_attempts must be a positive integer")

    groups: dict[str, list[dict]] = defaultdict(list)
    for record in records:
        if not isinstance(record, dict):
            raise ValueError("every record must be an object")
        signer = record.get("signerCode")
        if not isinstance(signer, str) or not signer:
            raise ValueError("every record must have a signerCode")
        groups[signer].append(record)
    if len(groups) < len(_SPLITS):
        raise ValueError("at least three distinct signers are required")

    counts = _allocate_counts(len(groups), fractions)
    if any(count == 0 for count in counts):
        raise ValueError("every split must contain at least one signer")
    signers = sorted(groups)
    rng = random.Random(seed)
    best_assignment: dict[str, list[str]] | None = None
    best_score = (-1, -1)
    for _ in range(search_attempts):
        order = signers[:]
        rng.shuffle(order)
        assignment = _partition(order, counts)
        score = _coverage_score(groups, assignment)
        if score > best_score:
            best_assignment = assignment
            best_score = score
        if score[0] == score[1]:
            break

    assert best_assignment is not None
    result = {
        name: {
            "records": [record for record in records if record["signerCode"] in set(best_assignment[name])],
            "signerCodes": sorted(best_assignment[name]),
        }
        for name in _SPLITS
    }
    result["seed"] = seed
    result["fractions"] = {name: fraction for name, fraction in zip(_SPLITS, fractions, strict=True)}
    assert_signer_disjoint(result)
    return result