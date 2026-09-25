"""Fail-closed validation for reviewed Turkish–TİD content bundles.

The validator checks the release contract; it cannot establish that a gloss,
translation, license, or reviewer decision is substantively correct.
"""

from __future__ import annotations

import re
from collections.abc import Mapping


SCHEMA_VERSION = 1
_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_MEDIA_PATH = re.compile(r"^/assets/tid/[A-Za-z0-9._/-]+$")


def _is_text(value: object) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _is_index(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value >= 0


def _safe_same_origin_path(value: object) -> bool:
    if not isinstance(value, str) or not _MEDIA_PATH.fullmatch(value):
        return False
    return all(part not in {"", ".", ".."} for part in value.split("/")[1:])


def _append(errors: list[str], code: str) -> None:
    if code not in errors:
        errors.append(code)


def validate_entry(entry: object, media_manifest: object) -> list[str]:
    """Return stable validation error codes for one bundle entry."""
    errors: list[str] = []
    if not isinstance(entry, Mapping):
        return ["invalid_entry"]

    required = {"id", "source", "translation", "review", "media", "scope", "playable"}
    if not required.issubset(entry):
        _append(errors, "missing_field")
    if not _is_text(entry.get("id")):
        _append(errors, "invalid_entry")

    source = entry.get("source")
    if (
        not isinstance(source, Mapping)
        or not _is_text(source.get("text"))
        or source.get("locale") != "tr-TR"
    ):
        _append(errors, "invalid_entry")

    translation = entry.get("translation")
    glosses: list[object] = []
    if isinstance(translation, Mapping):
        glosses_value = translation.get("glosses")
        if isinstance(glosses_value, list):
            glosses = glosses_value
        if not _is_text(translation.get("glossText")) or not glosses or not all(_is_text(item) for item in glosses):
            _append(errors, "invalid_entry")
    else:
        _append(errors, "invalid_entry")

    scope = entry.get("scope")
    if not isinstance(scope, list) or not scope or not all(_is_text(item) for item in scope):
        _append(errors, "invalid_scope")
    playable = entry.get("playable")
    if not isinstance(playable, bool):
        _append(errors, "invalid_playable_flag")

    review = entry.get("review")
    if not isinstance(review, Mapping):
        review = {}
        _append(errors, "invalid_review")
    status = review.get("status")
    review_required = {"status", "reviewerCodes", "approvals", "disagreement", "adjudication"}
    if not review_required.issubset(review) or not isinstance(status, str) or status not in {"candidate", "approved", "rejected"}:
        _append(errors, "invalid_review")

    reviewer_codes = review.get("reviewerCodes", [])
    approvals = review.get("approvals", [])
    if not isinstance(reviewer_codes, list):
        reviewer_codes = []
        _append(errors, "invalid_review")
    elif not all(_is_text(code) for code in reviewer_codes):
        _append(errors, "invalid_review")
    elif len(reviewer_codes) != len(set(reviewer_codes)):
        _append(errors, "duplicate_reviewer")
    if not isinstance(approvals, list):
        approvals = []
        _append(errors, "invalid_review")
    elif any(
        not isinstance(item, Mapping)
        or not _is_text(item.get("reviewerCode"))
        or not isinstance(item.get("decision"), str)
        or item.get("decision") not in {"approve", "reject"}
        or not isinstance(item.get("independent"), bool)
        for item in approvals
    ):
        _append(errors, "invalid_review")

    if status == "approved" or playable is True:
        approval_codes = [
            item.get("reviewerCode")
            for item in approvals
            if isinstance(item, Mapping)
            and item.get("decision") == "approve"
            and item.get("independent") is True
        ]
        reviewer_set = set(reviewer_codes) if all(_is_text(code) for code in reviewer_codes) else set()
        if (
            len(reviewer_codes) != 2
            or len(reviewer_set) != 2
            or len(approval_codes) != 2
            or not all(_is_text(code) for code in approval_codes)
            or set(code for code in approval_codes if _is_text(code)) != reviewer_set
        ):
            _append(errors, "missing_approval")

    disagreement = review.get("disagreement")
    if not isinstance(disagreement, bool):
        _append(errors, "invalid_review")
    if disagreement is True:
        adjudication = review.get("adjudication")
        if not isinstance(adjudication, Mapping) or not _is_text(adjudication.get("reviewerCode")) or not _is_text(adjudication.get("resolution")):
            _append(errors, "unresolved_review")
        elif adjudication.get("reviewerCode") in reviewer_codes:
            _append(errors, "invalid_adjudicator")
    elif review.get("adjudication") not in (None, {}):
        _append(errors, "unexpected_adjudication")

    media = entry.get("media")
    if not isinstance(media, list):
        _append(errors, "invalid_media")
        media = []
    elif not media:
        _append(errors, "invalid_media")
    playable_segments = []
    has_text_only = False
    manifest = media_manifest if isinstance(media_manifest, Mapping) else {}
    for segment in media:
        if not isinstance(segment, Mapping):
            _append(errors, "invalid_media")
            continue
        kind = segment.get("kind")
        if kind == "text_only":
            has_text_only = True
            if not _is_text(segment.get("glossRef")):
                _append(errors, "invalid_media")
            continue
        if not isinstance(kind, str) or kind not in {"video", "avatar"}:
            _append(errors, "invalid_media")
            continue
        if kind == "avatar" and not _is_text(segment.get("animationId")):
            _append(errors, "invalid_media")

        playable_segments.append(segment)
        asset_id = segment.get("assetId")
        asset = manifest.get(asset_id) if isinstance(asset_id, str) else None
        if not isinstance(asset, Mapping):
            _append(errors, "unknown_media")
            asset = None
        if isinstance(asset, Mapping):
            if not _safe_same_origin_path(asset.get("path")):
                _append(errors, "unsafe_media_path")
            if not _is_text(asset.get("licenseId")) or asset.get("redistributionAllowed") is not True:
                _append(errors, "unlicensed_media")
            if not isinstance(asset.get("sha256"), str) or not _SHA256.fullmatch(asset["sha256"]):
                _append(errors, "invalid_media_hash")

        start = segment.get("startMs")
        end = segment.get("endMs")
        if not _is_index(start) or not _is_index(end) or end <= start:
            _append(errors, "missing_duration")
        elif isinstance(asset, Mapping) and _is_index(asset.get("durationMs")) and end > asset["durationMs"]:
            _append(errors, "time_out_of_bounds")

        gloss_start = segment.get("glossStart")
        gloss_end = segment.get("glossEnd")
        if (
            not _is_index(gloss_start)
            or not _is_index(gloss_end)
            or gloss_end <= gloss_start
            or gloss_end > len(glosses)
        ):
            _append(errors, "invalid_gloss_alignment")

        non_manual = segment.get("nonManual")
        if not isinstance(non_manual, list) or not non_manual:
            _append(errors, "missing_nonmanual")
        elif _is_index(start) and _is_index(end):
            for interval in non_manual:
                if not isinstance(interval, Mapping):
                    _append(errors, "invalid_nonmanual")
                    break
                interval_start = interval.get("startMs")
                interval_end = interval.get("endMs")
                if (
                    not _is_index(interval_start)
                    or not _is_index(interval_end)
                    or interval_start < start
                    or interval_end > end
                    or interval_end <= interval_start
                    or not _is_text(interval.get("face"))
                    or not _is_text(interval.get("head"))
                ):
                    _append(errors, "invalid_nonmanual")
                    break

    if has_text_only and playable_segments:
        _append(errors, "mixed_media_kind")
    if playable is True and not playable_segments:
        _append(errors, "text_only_not_playable")
    return errors


def validate_bundle(bundle: object, media_manifest: object) -> list[str]:
    """Validate bundle envelope, unique IDs, reviews, and referenced media."""
    if not isinstance(bundle, Mapping):
        return ["invalid_bundle"]

    errors: list[str] = []
    if type(bundle.get("schemaVersion")) is not int or bundle.get("schemaVersion") != SCHEMA_VERSION:
        _append(errors, "invalid_bundle_version")
    if not _is_text(bundle.get("contentVersion")) or not isinstance(bundle.get("entries"), list):
        _append(errors, "invalid_bundle")
        return errors

    seen_ids: set[str] = set()
    for entry in bundle["entries"]:
        if isinstance(entry, Mapping):
            entry_id = entry.get("id")
            if isinstance(entry_id, str) and entry_id in seen_ids:
                _append(errors, "duplicate_id")
            elif isinstance(entry_id, str):
                seen_ids.add(entry_id)
        for code in validate_entry(entry, media_manifest):
            _append(errors, code)
    return errors
