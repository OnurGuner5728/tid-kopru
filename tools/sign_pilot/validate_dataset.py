"""Validate a schema-only TİD sign-pilot landmark manifest."""

from __future__ import annotations

import math
import re
from collections.abc import Iterable, Mapping


SCHEMA_VERSION = "1.0"
_CODE = re.compile(r"^[A-Za-z0-9_-]{1,32}$")
_REQUIRED_RECORD_FIELDS = {
    "schemaVersion",
    "signerCode",
    "consentCode",
    "signId",
    "repetition",
    "conditions",
    "fps",
    "frames",
    "preprocessVersion",
}
_CONDITION_FIELDS = {"lightingCode", "distanceCode", "backgroundCode"}
_LANDMARK_GROUPS = (
    ("pose", "poseVisibility"),
    ("leftHand", "leftHandVisibility"),
    ("rightHand", "rightHandVisibility"),
    ("face", "faceVisibility"),
)
_FRAME_FIELDS = {
    "timestampMs",
    *(coordinate_field for coordinate_field, _ in _LANDMARK_GROUPS),
    *(visibility_field for _, visibility_field in _LANDMARK_GROUPS),
}
_PERSONAL_KEY_TERMS = {
    "name",
    "email",
    "phone",
    "telephone",
    "mobile",
    "contact",
    "address",
    "video",
    "recording",
    "filepath",
    "rawvideo",
    "blob",
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


def _has_personal_key(value: object) -> bool:
    if isinstance(value, dict):
        for key, nested in value.items():
            key_text = str(key).casefold()
            normalized = re.sub(r"[^a-z0-9]", "", key_text)
            if any(term in normalized for term in _PERSONAL_KEY_TERMS):
                return True
            if _has_personal_key(nested):
                return True
    elif isinstance(value, list):
        return any(_has_personal_key(item) for item in value)
    return False


def _is_finite_number(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _validate_record(record: object, signers: set[str], allowed_signs: set[str], allowed_conditions: dict[str, set[str]] | None, errors: list[str]) -> None:
    if not isinstance(record, dict):
        _add(errors, "invalid_record")
        return

    if _has_personal_key(record):
        _add(errors, "personal_data_field")
    if set(record) - _REQUIRED_RECORD_FIELDS:
        _add(errors, "unknown_field")
    missing_fields = _REQUIRED_RECORD_FIELDS - set(record)
    if "consentCode" in missing_fields:
        _add(errors, "missing_consent")
    if missing_fields - {"consentCode"}:
        _add(errors, "missing_required_field")

    if "schemaVersion" in record and record["schemaVersion"] != SCHEMA_VERSION:
        _add(errors, "unsupported_schema")

    signer_code = record.get("signerCode")
    if "signerCode" in record:
        if not isinstance(signer_code, str) or not _CODE.fullmatch(signer_code):
            _add(errors, "invalid_signer_code")
        elif signer_code not in signers:
            _add(errors, "unknown_signer")

    consent_code = record.get("consentCode")
    if "consentCode" in record:
        if not isinstance(consent_code, str) or not _CODE.fullmatch(consent_code):
            _add(errors, "missing_consent")

    sign_id = record.get("signId")
    if "signId" in record:
        if not isinstance(sign_id, str) or not _CODE.fullmatch(sign_id) or sign_id not in allowed_signs:
            _add(errors, "unknown_sign")

    if "repetition" in record:
        repetition = record["repetition"]
        if not isinstance(repetition, int) or isinstance(repetition, bool) or repetition < 1:
            _add(errors, "invalid_repetition")

    if "preprocessVersion" in record:
        version = record["preprocessVersion"]
        if not isinstance(version, str) or not _CODE.fullmatch(version):
            _add(errors, "invalid_preprocess_version")

    if "fps" in record:
        fps = record["fps"]
        if not _is_finite_number(fps) or not 0 < fps <= 120:
            _add(errors, "invalid_fps")

    if "conditions" in record:
        conditions = record["conditions"]
        if not isinstance(conditions, dict) or set(conditions) != _CONDITION_FIELDS:
            _add(errors, "invalid_conditions")
        elif any(not isinstance(value, str) or not _CODE.fullmatch(value) for value in conditions.values()):
            _add(errors, "invalid_conditions")
        elif allowed_conditions is not None and any(value not in allowed_conditions.get(field, set()) for field, value in conditions.items()):
            _add(errors, "invalid_conditions")

    frames = record.get("frames")
    if "frames" in record:
        if not isinstance(frames, list) or not frames:
            _add(errors, "invalid_frames")
        else:
            previous_timestamp = -math.inf
            for frame in frames:
                if not isinstance(frame, dict):
                    _add(errors, "invalid_frame")
                    continue
                if _has_personal_key(frame):
                    _add(errors, "personal_data_field")
                if set(frame) - _FRAME_FIELDS:
                    _add(errors, "unknown_field")
                if _FRAME_FIELDS - set(frame):
                    _add(errors, "invalid_frame")

                timestamp = frame.get("timestampMs")
                if not _is_finite_number(timestamp) or timestamp < 0 or timestamp <= previous_timestamp:
                    _add(errors, "invalid_timestamp")
                elif _is_finite_number(timestamp):
                    previous_timestamp = timestamp

                for coordinate_field, visibility_field in _LANDMARK_GROUPS:
                    coordinates = frame.get(coordinate_field)
                    visibility = frame.get(visibility_field)
                    valid_coordinates = (
                        isinstance(coordinates, list)
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


def validate_dataset(records: object, signers: Iterable[str], allowed_signs: Iterable[str], allowed_conditions: Mapping[str, Iterable[str]] | None = None) -> list[str]:
    """Return stable validation error codes for a list of consent-coded records.

    Signers and allowed signs are supplied by a separately approved manifest.
    This validator checks coded fields and shape only; it cannot establish that
    consent was informed, current, or broad enough for the proposed use.
    """
    errors: list[str] = []
    if not isinstance(records, (list, tuple)):
        return ["invalid_records"]

    signer_codes = _codes(signers)
    sign_ids = _codes(allowed_signs)
    condition_codes: dict[str, set[str]] | None = None
    if allowed_conditions is not None:
        if not isinstance(allowed_conditions, Mapping) or set(allowed_conditions) != _CONDITION_FIELDS:
            _add(errors, "invalid_condition_manifest")
            condition_codes = {}
        else:
            condition_codes = {field: _codes(allowed_conditions[field]) for field in _CONDITION_FIELDS}
    for record in records:
        _validate_record(record, signer_codes, sign_ids, condition_codes, errors)
    return errors
