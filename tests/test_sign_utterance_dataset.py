import unittest

from tools.sign_pilot.validate_utterances import (
    validate_split_manifest,
    validate_utterances,
)


SIGNERS = {"S01", "S02", "S03"}
GLOSSES = {"HELLO", "BROW_RAISE", "YOU"}


def frame(timestamp_ms):
    return {
        "timestampMs": timestamp_ms,
        "pose": [0.0, 0.1, 0.2],
        "poseVisibility": [1],
        "leftHand": [0.0, 0.0, 0.0],
        "leftHandVisibility": [0],
        "rightHand": [0.1, 0.2, 0.3],
        "rightHandVisibility": [1],
        "face": [0.0, 0.0, 0.0],
        "faceVisibility": [1],
    }


def event(gloss_id="HELLO", start_ms=100, end_ms=900, *, channel="manual", parallel_group=None, non_manual=None):
    value = {
        "glossId": gloss_id,
        "startMs": start_ms,
        "endMs": end_ms,
        "dominantHand": "right" if channel == "manual" else "none",
        "nonManual": non_manual or [],
        "channel": channel,
    }
    if parallel_group is not None:
        value["parallelGroup"] = parallel_group
    return value


def utterance_record(**overrides):
    record = {
        "schemaVersion": 2,
        "utteranceId": "UTT_0001",
        "signerCode": "S01",
        "consentCode": "C01",
        "scopeId": "PILOT_1",
        "fps": 30,
        "frames": [frame(0), frame(1000)],
        "glossEvents": [event()],
        "conditions": {
            "lightingCode": "indoor",
            "distanceCode": "medium",
            "backgroundCode": "plain",
        },
        "preprocessVersion": "mp-v1",
        "captureContractSha256": "a" * 64,
    }
    record.update(overrides)
    return record


class ValidateUtterancesTests(unittest.TestCase):
    def test_accepts_one_approved_gloss_utterance(self):
        self.assertEqual(validate_utterances([utterance_record()], SIGNERS, GLOSSES), [])

    def test_allows_explicit_manual_and_nonmanual_parallel_annotation(self):
        record = utterance_record(glossEvents=[
            event("YOU", 100, 900, channel="manual", parallel_group="Q1"),
            event("BROW_RAISE", 100, 900, channel="nonManual", parallel_group="Q1", non_manual=["brow_raise"]),
        ])
        self.assertEqual(validate_utterances([record], SIGNERS, GLOSSES), [])

    def test_missing_consent_code_is_rejected(self):
        errors = validate_utterances([utterance_record(consentCode="")], SIGNERS, GLOSSES)
        self.assertIn("missing_consent", errors)

    def test_unknown_gloss_is_rejected(self):
        errors = validate_utterances([utterance_record(glossEvents=[event("NOT_APPROVED")])], SIGNERS, GLOSSES)
        self.assertIn("unknown_gloss", errors)

    def test_duplicate_utterance_ids_are_rejected(self):
        record = utterance_record()
        errors = validate_utterances([record, dict(record)], SIGNERS, GLOSSES)
        self.assertIn("duplicate_utterance", errors)

    def test_split_manifest_rejects_signer_overlap(self):
        errors = validate_split_manifest({
            "train": ["S01", "S02"],
            "validation": ["S03"],
            "test": ["S02"],
        })
        self.assertIn("signer_split_overlap", errors)

    def test_end_before_start_is_invalid(self):
        errors = validate_utterances([utterance_record(glossEvents=[event(start_ms=700, end_ms=600)])], SIGNERS, GLOSSES)
        self.assertIn("invalid_gloss_timing", errors)

    def test_gloss_event_cannot_extend_past_clip(self):
        errors = validate_utterances([utterance_record(glossEvents=[event(end_ms=1450)])], SIGNERS, GLOSSES)
        self.assertIn("invalid_gloss_timing", errors)

    def test_overlapping_manual_events_without_parallel_annotation_are_rejected(self):
        record = utterance_record(glossEvents=[
            event("YOU", 100, 700),
            event("HELLO", 500, 900),
        ])
        errors = validate_utterances([record], SIGNERS, GLOSSES)
        self.assertIn("unauthorized_overlap", errors)

    def test_malformed_event_values_are_rejected_without_crashing(self):
        malformed = event()
        malformed["channel"] = []
        malformed["dominantHand"] = {}
        errors = validate_utterances([utterance_record(glossEvents=[malformed])], SIGNERS, GLOSSES)
        self.assertIn("invalid_gloss_event", errors)

    def test_nonmanual_event_requires_a_nonmanual_marker(self):
        errors = validate_utterances([
            utterance_record(glossEvents=[event("BROW_RAISE", channel="nonManual")])
        ], SIGNERS, GLOSSES)
        self.assertIn("invalid_gloss_event", errors)

    def test_nonfinite_landmark_is_rejected(self):
        bad_frame = frame(0)
        bad_frame["pose"][0] = float("nan")
        errors = validate_utterances([utterance_record(frames=[bad_frame, frame(1000)])], SIGNERS, GLOSSES)
        self.assertIn("invalid_coordinate", errors)

    def test_personal_name_and_raw_video_path_are_rejected(self):
        record = utterance_record()
        record["participantName"] = "Example Person"
        record["videoPath"] = "private/video.mp4"
        errors = validate_utterances([record], SIGNERS, GLOSSES)
        self.assertIn("personal_data_field", errors)


if __name__ == "__main__":
    unittest.main()
