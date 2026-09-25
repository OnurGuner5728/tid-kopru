import copy
import unittest

from tools.tid_translation.validate_content import validate_bundle


def candidate_entry(kind="text_only"):
    media = [{"kind": "text_only", "glossRef": "gloss-1"}]
    if kind == "video":
        media = [
            {
                "kind": "video",
                "assetId": "clip-1",
                "startMs": 0,
                "endMs": 800,
                "glossStart": 0,
                "glossEnd": 2,
                "nonManual": [
                    {"startMs": 0, "endMs": 800, "face": "neutral", "head": "neutral"}
                ],
            }
        ]
    return {
        "id": "sentence-1",
        "source": {"text": "Sen iyisin", "locale": "tr-TR"},
        "translation": {"glossText": "SEN IYI", "glosses": ["SEN", "IYI"]},
        "review": {
            "status": "candidate",
            "reviewerCodes": [],
            "approvals": [],
            "disagreement": False,
            "adjudication": None,
        },
        "media": media,
        "scope": ["greetings"],
        "playable": False,
    }


def approved_video_entry():
    entry = candidate_entry("video")
    entry["review"] = {
        "status": "approved",
        "reviewerCodes": ["reviewer-a", "reviewer-b"],
        "approvals": [
            {"reviewerCode": "reviewer-a", "decision": "approve", "independent": True},
            {"reviewerCode": "reviewer-b", "decision": "approve", "independent": True},
        ],
        "disagreement": False,
        "adjudication": None,
    }
    entry["playable"] = True
    return entry


def bundle_with(*entries):
    return {"schemaVersion": 1, "contentVersion": "test-v1", "entries": list(entries)}


def approved_media_manifest():
    return {
        "clip-1": {
            "path": "/assets/tid/clip-1.mp4",
            "sha256": "a" * 64,
            "licenseId": "CC-BY-4.0",
            "redistributionAllowed": True,
            "durationMs": 1000,
        }
    }


class ValidateTidContentTests(unittest.TestCase):
    def test_text_only_candidate_is_valid_until_marked_playable(self):
        entry = candidate_entry()
        self.assertEqual(validate_bundle(bundle_with(entry), {}), [])

        entry["playable"] = True
        self.assertIn("text_only_not_playable", validate_bundle(bundle_with(entry), {}))

    def test_two_independent_approvals_and_licensed_asset_allow_playable_entry(self):
        self.assertEqual(
            validate_bundle(bundle_with(approved_video_entry()), approved_media_manifest()), []
        )

    def test_duplicate_reviewer_code_is_rejected(self):
        entry = approved_video_entry()
        entry["review"]["reviewerCodes"] = ["reviewer-a", "reviewer-a"]

        self.assertIn(
            "duplicate_reviewer",
            validate_bundle(bundle_with(entry), approved_media_manifest()),
        )

    def test_missing_second_approval_is_rejected(self):
        entry = approved_video_entry()
        entry["review"]["approvals"] = entry["review"]["approvals"][:1]

        self.assertIn(
            "missing_approval",
            validate_bundle(bundle_with(entry), approved_media_manifest()),
        )

    def test_unresolved_reviewer_disagreement_is_rejected(self):
        entry = approved_video_entry()
        entry["review"]["disagreement"] = True

        self.assertIn(
            "unresolved_review",
            validate_bundle(bundle_with(entry), approved_media_manifest()),
        )

    def test_unknown_media_asset_is_rejected(self):
        entry = approved_video_entry()
        entry["media"][0]["assetId"] = "missing-clip"

        self.assertIn(
            "unknown_media",
            validate_bundle(bundle_with(entry), approved_media_manifest()),
        )

    def test_missing_segment_duration_is_rejected(self):
        entry = approved_video_entry()
        entry["media"][0]["endMs"] = 0

        self.assertIn(
            "missing_duration",
            validate_bundle(bundle_with(entry), approved_media_manifest()),
        )

    def test_duplicate_sentence_id_is_rejected(self):
        one = candidate_entry()
        two = copy.deepcopy(one)

        self.assertIn("duplicate_id", validate_bundle(bundle_with(one, two), {}))

    def test_external_media_path_is_rejected(self):
        manifest = approved_media_manifest()
        manifest["clip-1"]["path"] = "https://media.example/clip-1.mp4"

        self.assertIn(
            "unsafe_media_path",
            validate_bundle(bundle_with(approved_video_entry()), manifest),
        )

    def test_asset_without_redistribution_license_is_rejected(self):
        manifest = approved_media_manifest()
        manifest["clip-1"]["redistributionAllowed"] = False

        self.assertIn(
            "unlicensed_media",
            validate_bundle(bundle_with(approved_video_entry()), manifest),
        )

    def test_gloss_alignment_cannot_exceed_translation_tokens(self):
        entry = approved_video_entry()
        entry["media"][0]["glossEnd"] = 3

        self.assertIn(
            "invalid_gloss_alignment",
            validate_bundle(bundle_with(entry), approved_media_manifest()),
        )

    def test_playable_segment_requires_non_manual_timeline(self):
        entry = approved_video_entry()
        entry["media"][0]["nonManual"] = []

        self.assertIn(
            "missing_nonmanual",
            validate_bundle(bundle_with(entry), approved_media_manifest()),
        )

    def test_unsupported_bundle_schema_version_is_rejected(self):
        bundle = bundle_with(candidate_entry())
        bundle["schemaVersion"] = 99

        self.assertIn("invalid_bundle_version", validate_bundle(bundle, {}))

    def test_encoded_path_traversal_is_rejected(self):
        manifest = approved_media_manifest()
        manifest["clip-1"]["path"] = "/assets/tid/%2e%2e/private.mp4"

        self.assertIn(
            "unsafe_media_path",
            validate_bundle(bundle_with(approved_video_entry()), manifest),
        )

    def test_media_path_with_control_characters_is_rejected(self):
        manifest = approved_media_manifest()
        manifest["clip-1"]["path"] = "/assets/tid/clip.mp4\tprivate"

        self.assertIn(
            "unsafe_media_path",
            validate_bundle(bundle_with(approved_video_entry()), manifest),
        )

    def test_adjudicator_must_be_a_third_reviewer(self):
        entry = approved_video_entry()
        entry["review"]["disagreement"] = True
        entry["review"]["adjudication"] = {
            "reviewerCode": "reviewer-a",
            "resolution": "accepted wording",
        }

        self.assertIn(
            "invalid_adjudicator",
            validate_bundle(bundle_with(entry), approved_media_manifest()),
        )

    def test_empty_media_list_is_rejected(self):
        entry = candidate_entry()
        entry["media"] = []

        self.assertIn("invalid_media", validate_bundle(bundle_with(entry), {}))

    def test_text_only_and_playable_segments_cannot_be_mixed(self):
        entry = approved_video_entry()
        entry["media"].insert(0, {"kind": "text_only", "glossRef": "gloss-1"})

        self.assertIn(
            "mixed_media_kind",
            validate_bundle(bundle_with(entry), approved_media_manifest()),
        )

    def test_boolean_is_not_a_bundle_schema_version(self):
        bundle = bundle_with(candidate_entry())
        bundle["schemaVersion"] = True

        self.assertIn("invalid_bundle_version", validate_bundle(bundle, {}))

    def test_malformed_reviewer_codes_fail_closed_without_crashing(self):
        entry = approved_video_entry()
        entry["review"]["reviewerCodes"] = [{"unexpected": "object"}]
        entry["review"]["approvals"] = [
            {"reviewerCode": {"unexpected": "object"}, "decision": "approve", "independent": True},
            {"reviewerCode": "reviewer-b", "decision": "approve", "independent": True},
        ]

        self.assertIn(
            "invalid_review",
            validate_bundle(bundle_with(entry), approved_media_manifest()),
        )

    def test_source_locale_must_be_turkish(self):
        entry = candidate_entry()
        entry["source"]["locale"] = "en-US"

        self.assertIn("invalid_entry", validate_bundle(bundle_with(entry), {}))

    def test_avatar_segment_requires_a_validated_animation_id(self):
        entry = approved_video_entry()
        entry["media"][0]["kind"] = "avatar"

        self.assertIn(
            "invalid_media",
            validate_bundle(bundle_with(entry), approved_media_manifest()),
        )


if __name__ == "__main__":
    unittest.main()
