import math
import unittest

from tools.sign_pilot.validate_dataset import validate_dataset


class ValidateDatasetTests(unittest.TestCase):
    def setUp(self):
        self.record = {
            "schemaVersion": "1.0",
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
