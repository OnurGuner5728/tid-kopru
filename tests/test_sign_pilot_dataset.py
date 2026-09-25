import math
import json
import unittest
from pathlib import Path

from tools.sign_pilot.validate_dataset import validate_dataset
from tools.sign_pilot.capture_contract import capture_contract_sha256


class ValidateDatasetTests(unittest.TestCase):
    def setUp(self):
        self.record = {
            "schemaVersion": "1.1",
            "captureId": "1" * 32,
            "captureContractSha256": "a" * 64,
            "signerCode": "S01",
            "consentCode": "C01",
            "signId": "SIGN_A",
            "repetition": 1,
            "conditions": {
                "lightingCode": "L1",
                "distanceCode": "D1",
                "backgroundCode": "B1",
            },
            "fps": 30,
            "frames": [
                {
                    "timestampMs": 0,
                    "pose": [0.1, 0.2, 0.3],
                    "poseVisibility": [1],
                    "leftHand": [0.0, 0.0, 0.0],
                    "leftHandVisibility": [0],
                    "rightHand": [0.4, 0.5, 0.6],
                    "rightHandVisibility": [1],
                    "face": [0.7, 0.8, 0.9],
                    "faceVisibility": [1],
                }
            ],
            "preprocessVersion": "v1",
        }
        self.signers = {"S01"}
        self.allowed_signs = {"SIGN_A"}

    def validate(self, record=None):
        return validate_dataset([record or self.record], self.signers, self.allowed_signs)

    def test_accepts_one_valid_schema_only_record(self):
        self.assertEqual(self.validate(), [])

    def test_missing_consent_is_an_error(self):
        record = dict(self.record)
        record.pop("consentCode")
        self.assertIn("missing_consent", self.validate(record))

    def test_unknown_sign_is_an_error(self):
        record = dict(self.record, signId="SIGN_NOT_APPROVED")
        self.assertIn("unknown_sign", self.validate(record))

    def test_negative_repetition_is_an_error(self):
        record = dict(self.record, repetition=-1)
        self.assertIn("invalid_repetition", self.validate(record))

    def test_non_finite_landmark_coordinate_is_an_error(self):
        frame = dict(self.record["frames"][0], pose=[math.inf, 0.2, 0.3])
        record = dict(self.record, frames=[frame])
        self.assertIn("invalid_coordinate", self.validate(record))

    def test_personal_name_field_is_rejected(self):
        record = dict(self.record, participantName="Example Person")
        self.assertIn("personal_data_field", self.validate(record))

    def test_requires_capture_identity_and_rejects_duplicate_clips(self):
        repeated = dict(self.record, captureId="2" * 32, repetition=2)
        errors = validate_dataset(
            [self.record, repeated], self.signers, self.allowed_signs,
            expected_capture_contract_sha256="a" * 64,
        )
        self.assertIn("duplicate_capture_content", errors)

    def test_requires_the_expected_capture_contract(self):
        errors = validate_dataset(
            [self.record], self.signers, self.allowed_signs,
            expected_capture_contract_sha256="b" * 64,
        )
        self.assertIn("capture_contract_mismatch", errors)

    def test_capture_contract_hash_matches_the_browser_fingerprint(self):
        self.assertEqual(
            capture_contract_sha256(
                preprocess_version="v1",
                landmark_indices={"pose": [11, 12], "leftHand": [0], "rightHand": [0], "face": []},
                model_version="holistic-v1",
                runtime_version="1.2.3",
                runtime_sha256="a" * 64,
                model_sha256="b" * 64,
                wasm_files=[
                    {"path": "vision_wasm_internal.js", "sha256": "c" * 64},
                    {"path": "vision_wasm_internal.wasm", "sha256": "d" * 64},
                    {"path": "vision_wasm_nosimd_internal.js", "sha256": "e" * 64},
                    {"path": "vision_wasm_nosimd_internal.wasm", "sha256": "f" * 64},
                ],
            ),
            "0f2ab397d2368a192308d81ae871c8355e9bfd5d933f64e5943137918dab0b6f",
        )

    def test_capture_ids_are_compared_without_hex_case(self):
        repeated = dict(self.record, captureId=self.record["captureId"].upper(), repetition=2)
        errors = validate_dataset([self.record, repeated], self.signers, self.allowed_signs)
        self.assertIn("duplicate_capture_id", errors)

    def test_duplicate_clip_detection_ignores_object_key_order_and_retiming(self):
        reordered = {
            **self.record,
            "captureId": "2" * 32,
            "repetition": 2,
            "conditions": {
                "backgroundCode": "B1", "distanceCode": "D1", "lightingCode": "L1",
            },
            "frames": [{
                "faceVisibility": [1], "face": [0.7, 0.8, 0.9],
                "rightHandVisibility": [1], "rightHand": [0.4, 0.5, 0.6],
                "leftHandVisibility": [0], "leftHand": [0.0, 0.0, 0.0],
                "poseVisibility": [1], "pose": [0.1, 0.2, 0.3], "timestampMs": 900,
            }],
            "fps": 60,
        }
        errors = validate_dataset([self.record, reordered], self.signers, self.allowed_signs)
        self.assertIn("duplicate_capture_content", errors)

    def test_python_validator_agrees_with_the_shared_browser_fixtures(self):
        fixtures = json.loads(Path(__file__).with_name("sign-pilot-validation-fixtures.json").read_text(encoding="utf-8"))
        manifest = fixtures["manifest"]
        allowed_conditions = {
            "lightingCode": manifest["conditions"]["lighting"],
            "distanceCode": manifest["conditions"]["distance"],
            "backgroundCode": manifest["conditions"]["background"],
        }
        arguments = (
            manifest["signers"], manifest["allowedSigns"], allowed_conditions,
            manifest["captureContractSha256"],
        )
        self.assertEqual(validate_dataset([fixtures["validRecord"]], *arguments), [])
        for item in fixtures["rejectedRecords"]:
            self.assertIn(item["error"], validate_dataset([item["record"]], *arguments))

    def test_rejects_condition_codes_outside_approved_manifest(self):
        errors = validate_dataset(
            [self.record],
            self.signers,
            self.allowed_signs,
            allowed_conditions={
                "lightingCode": {"L2"},
                "distanceCode": {"D1"},
                "backgroundCode": {"B1"},
            },
        )
        self.assertIn("invalid_conditions", errors)
if __name__ == "__main__":
    unittest.main()
