"""Validate pseudonymous, consent-coded TİD utterance landmark records."""

from __future__ import annotations

import math
import re
from collections.abc import Iterable, Mapping


_CODE = re.compile(r"^[A-Za-z0-9_-]{1,32}$")
_SHA256 = re.compile(r"^[a-fA-F0-9]{64}$")
_PERSONAL_KEY_TERMS = {
    "name", "email", "phone", "telephone", "mobile", "contact", "address",
    "video", "recording", "filepath", "rawvideo", "blob", "identifier",
}
_FRAME_FIELDS = {
    "timestampMs", "pose", "poseVisibility", "leftHand", "leftHandVisibility",
    "rightHand", "rightHandVisibility", "face", "faceVisibility",
}
_LANDMARK_GROUPS = (
    ("pose", "poseVisibility"),
    ("leftHand", "leftHandVisibility"),
    ("rightHand", "rightHandVisibility"),
    ("face", "faceVisibility"),
)
_CONDITION_FIELDS = {"lightingCode", "distanceCode", "backgroundCode"}
_RECORD_SCHEMA = {
    "required": {
        "schemaVersion", "utteranceId", "signerCode", "consentCode", "scopeId", "fps",
        "frames", "glossEvents", "conditions", "preprocessVersion", "captureContractSha256",
    },
    "properties": {
        "schemaVersion", "utteranceId", "signerCode", "consentCode", "scopeId", "fps",
        "frames", "glossEvents", "conditions", "preprocessVersion", "captureContractSha256",
    },
}
_EVENT_SCHEMA = {
    "required": {"glossId", "startMs", "endMs", "dominantHand", "nonManual", "channel"},
    "properties": {
        "glossId", "startMs", "endMs", "dominantHand", "nonManual", "channel",
        "parallelGroup", "spatialReference",
    },
}
_FRAME_SCHEMA = {"required": _FRAME_FIELDS, "properties": _FRAME_FIELDS}

# Public code may import this constant for CLI and tooling introspection.
UTTERANCE_SCHEMA = {
    "version": 2,
    "record": _RECORD_SCHEMA,
    "frame": _FRAME_SCHEMA,
    "glossEvent": _EVENT_SCHEMA,
}


def _add(errors: list[str], code: str) -> None:
    if code not in errors:
        errors.append(code)


def _codes(values: Iterable[str] | str | None) -> set[str]:
    if values is None:
        return set()
    if isinstance(values, str):
        values = [values]
    try:
        return {value for value in values if isinstance(value, str)}
    except TypeError:
        return set()


def _is_finite_number(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _has_personal_key(value: object) -> bool:
    if isinstance(value, Mapping):
        for key, nested in value.items():
            normalized = re.sub(r"[^a-z0-9]", "", str(key).casefold())
            if any(term in normalized for term in _PERSONAL_KEY_TERMS):
                return True
            if _has_personal_key(nested):
                return True
    elif isinstance(value, (list, tuple)):
        return any(_has_personal_key(item) for item in value)
    return False


def validate_exact_schema(record: object, schema: Mapping[str, object]) -> list[str]:
    """Check an object's required and allowed keys without interpreting its values."""
    if not isinstance(record, Mapping):
        return ["invalid_record"]
    required = schema.get("required", set())
    properties = schema.get("properties", set())
    if not isinstance(required, (set, frozenset)) or not isinstance(properties, (set, frozenset)):
        return ["invalid_schema"]
    errors: list[str] = []
    if set(record) - properties:
        _add(errors, "unknown_field")
    if required - set(record):
        _add(errors, "missing_required_field")
    return errors


def _validate_frame(frame: object, errors: list[str]) -> float | None:
    if not isinstance(frame, Mapping):
        _add(errors, "invalid_frame")
        return None
    for code in validate_exact_schema(frame, _FRAME_SCHEMA):
        _add(errors, code)
    if _has_personal_key(frame):
        _add(errors, "personal_data_field")

    timestamp = frame.get("timestampMs")
    valid_timestamp = _is_finite_number(timestamp) and timestamp >= 0
    if not valid_timestamp:
        _add(errors, "invalid_timestamp")

    for coordinates_key, visibility_key in _LANDMARK_GROUPS:
        coordinates = frame.get(coordinates_key)
        visibility = frame.get(visibility_key)
        valid_coordinates = (
            isinstance(coordinates, list)
            and len(coordinates) >= 3
            and len(coordinates) % 3 == 0
            and all(_is_finite_number(value) for value in coordinates)
        )
        if not valid_coordinates:
            _add(errors, "invalid_coordinate")
            continue
        valid_visibility = (
            isinstance(visibility, list)
            and len(visibility) == len(coordinates) // 3
            and all(_is_finite_number(value) and value in (0, 1) for value in visibility)
        )
        if not valid_visibility:
            _add(errors, "invalid_visibility")
    return float(timestamp) if valid_timestamp else None


def validate_event_bounds(event: object, frames: object) -> list[str]:
    """Check event shape and timing against the captured clip's frame timeline."""
    errors: list[str] = []
    for code in validate_exact_schema(event, _EVENT_SCHEMA):
        _add(errors, code)
    if not isinstance(event, Mapping):
        return errors
    start = event.get("startMs")
    end = event.get("endMs")
    timestamps = []
    if isinstance(frames, list):
        for frame in frames:
            if isinstance(frame, Mapping) and _is_finite_number(frame.get("timestampMs")):
                timestamps.append(float(frame["timestampMs"]))
    if (
        not _is_finite_number(start)
        or not _is_finite_number(end)
        or start < 0
        or end <= start
        or not timestamps
        or start < timestamps[0]
        or end > timestamps[-1]
    ):
        _add(errors, "invalid_gloss_timing")

    dominant_hand = event.get("dominantHand")
    channel = event.get("channel")
    if dominant_hand not in ("left", "right", "both", "none"):
        _add(errors, "invalid_gloss_event")
    if channel not in ("manual", "nonManual"):
        _add(errors, "invalid_gloss_event")
    non_manual = event.get("nonManual")
    if not isinstance(non_manual, list) or any(not isinstance(code, str) or not _CODE.fullmatch(code) for code in non_manual):
        _add(errors, "invalid_gloss_event")
    elif (channel == "manual" and dominant_hand == "none") or (
        channel == "nonManual" and (dominant_hand != "none" or not non_manual)
    ):
        _add(errors, "invalid_gloss_event")
    gloss_id = event.get("glossId")
    if not isinstance(gloss_id, str) or not _CODE.fullmatch(gloss_id):
        _add(errors, "unknown_gloss")
    for optional_code in ("parallelGroup", "spatialReference"):
        if optional_code in event and (
            not isinstance(event[optional_code], str) or not _CODE.fullmatch(event[optional_code])
        ):
            _add(errors, "invalid_gloss_event")
    return errors


def _validate_overlap(events: list[Mapping[str, object]], errors: list[str]) -> None:
    valid_events = [
        event for event in events
        if _is_finite_number(event.get("startMs")) and _is_finite_number(event.get("endMs"))
    ]
    for index, first in enumerate(valid_events):
        for second in valid_events[index + 1:]:
            if max(first["startMs"], second["startMs"]) >= min(first["endMs"], second["endMs"]):
                continue
            group = first.get("parallelGroup")
            allowed = (
                isinstance(group, str)
                and _CODE.fullmatch(group) is not None
                and second.get("parallelGroup") == group
                and first.get("channel") in ("manual", "nonManual")
                and second.get("channel") in ("manual", "nonManual")
                and first.get("channel") != second.get("channel")
            )
            if not allowed:
                _add(errors, "unauthorized_overlap")


def validate_utterance(record: object, signers: Iterable[str], approved_glosses: Iterable[str]) -> list[str]:
    errors: list[str] = []
    if _has_personal_key(record):
        _add(errors, "personal_data_field")
    for code in validate_exact_schema(record, _RECORD_SCHEMA):
        _add(errors, code)
    if not isinstance(record, Mapping):
        return errors

    if record.get("schemaVersion") != 2:
        _add(errors, "unsupported_schema")
    for field in ("utteranceId", "signerCode", "consentCode", "scopeId", "preprocessVersion"):
        value = record.get(field)
        if not isinstance(value, str) or not _CODE.fullmatch(value):
            if field == "consentCode":
                _add(errors, "missing_consent")
            else:
                _add(errors, f"invalid_{field[0].lower()}{field[1:]}")

    signer = record.get("signerCode")
    if isinstance(signer, str) and _CODE.fullmatch(signer) and signer not in _codes(signers):
        _add(errors, "unknown_signer")
    consent = record.get("consentCode")
    if not isinstance(consent, str) or not _CODE.fullmatch(consent):
        _add(errors, "missing_consent")

    fps = record.get("fps")
    if not _is_finite_number(fps) or not 0 < fps <= 120:
        _add(errors, "invalid_fps")
    capture_contract = record.get("captureContractSha256")
    if not isinstance(capture_contract, str) or not _SHA256.fullmatch(capture_contract):
        _add(errors, "invalid_capture_contract")

    conditions = record.get("conditions")
    if not isinstance(conditions, Mapping) or set(conditions) != _CONDITION_FIELDS or any(
        not isinstance(value, str) or not _CODE.fullmatch(value) for value in conditions.values()
    ):
        _add(errors, "invalid_conditions")

    frames = record.get("frames")
    if not isinstance(frames, list) or not frames:
        _add(errors, "invalid_frames")
        frames = []
    previous = -math.inf
    for frame in frames:
        timestamp = _validate_frame(frame, errors)
        if timestamp is not None:
            if timestamp <= previous:
                _add(errors, "invalid_timestamp")
            previous = timestamp

    events = record.get("glossEvents")
    if not isinstance(events, list) or not events:
        _add(errors, "invalid_gloss_events")
        events = []
    allowed_glosses = _codes(approved_glosses)
    valid_event_mappings = []
    previous_start = -math.inf
    for event in events:
        for code in validate_event_bounds(event, frames):
            _add(errors, code)
        if not isinstance(event, Mapping):
            continue
        gloss_id = event.get("glossId")
        if isinstance(gloss_id, str) and _CODE.fullmatch(gloss_id) and gloss_id not in allowed_glosses:
            _add(errors, "unknown_gloss")
        start = event.get("startMs")
        if _is_finite_number(start):
            if start < previous_start:
                _add(errors, "invalid_event_order")
            previous_start = start
        valid_event_mappings.append(event)
    _validate_overlap(valid_event_mappings, errors)
    return errors


def validate_utterances(
    records: object,
    signers: Iterable[str],
    approved_glosses: Iterable[str],
) -> list[str]:
    if not isinstance(records, (list, tuple)):
        return ["invalid_records"]
    errors: list[str] = []
    seen_ids: set[str] = set()
    signer_codes = _codes(signers)
    approved_codes = _codes(approved_glosses)
    for record in records:
        for code in validate_utterance(record, signer_codes, approved_codes):
            _add(errors, code)
        if isinstance(record, Mapping):
            utterance_id = record.get("utteranceId")
            if isinstance(utterance_id, str) and _CODE.fullmatch(utterance_id):
                if utterance_id in seen_ids:
                    _add(errors, "duplicate_utterance")
                seen_ids.add(utterance_id)
    return errors


def validate_split_manifest(splits: object) -> list[str]:
    """Reject malformed or signer-overlapping train/validation/test partitions."""
    if not isinstance(splits, Mapping) or set(splits) != {"train", "validation", "test"}:
        return ["invalid_split_manifest"]
    normalized: dict[str, set[str]] = {}
    errors: list[str] = []
    for split_name, values in splits.items():
        if not isinstance(values, (list, tuple, set, frozenset)) or any(
            not isinstance(value, str) or not _CODE.fullmatch(value) for value in values
        ):
            _add(errors, "invalid_split_manifest")
            continue
        normalized[split_name] = set(values)
    partitions = list(normalized.values())
    if any(first & second for index, first in enumerate(partitions) for second in partitions[index + 1:]):
        _add(errors, "signer_split_overlap")
    return errors
