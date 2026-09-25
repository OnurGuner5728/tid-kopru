import tarfile
import tempfile
import unittest
import zipfile
from pathlib import Path

from tools.offline_speech.prepare_model import build_model_archive


class BuildModelArchiveTests(unittest.TestCase):
    def test_repackages_model_under_single_model_root(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            source_zip = root / "source.zip"
            output_archive = root / "model.tar.gz"
            with zipfile.ZipFile(source_zip, "w") as archive:
                archive.writestr("model/", "")
                archive.writestr("model/conf/", "")
                archive.writestr("model/conf/model.conf", "model configuration")

            file_count, output_bytes = build_model_archive(source_zip, output_archive)
            second_archive = root / "second.tar.gz"
            build_model_archive(source_zip, second_archive)

            self.assertEqual(file_count, 1)
            self.assertEqual(output_bytes, output_archive.stat().st_size)
            self.assertEqual(output_archive.read_bytes(), second_archive.read_bytes())
            with tarfile.open(output_archive, "r:gz") as archive:
                self.assertEqual(
                    archive.getnames(),
                    ["model", "model/conf", "model/conf/model.conf"],
                )
                self.assertEqual(
                    archive.extractfile("model/conf/model.conf").read(),
                    b"model configuration",
                )

    def test_rejects_parent_traversal_without_writing_outside_temp_directory(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory) / "sandbox" / "workspace"
            root.mkdir(parents=True)
            source_zip = root / "malicious.zip"
            output_archive = root / "model.tar.gz"
            outside_file = Path(temporary_directory) / "outside.txt"
            if outside_file.exists():
                self.fail("test target unexpectedly exists before running")
            with zipfile.ZipFile(source_zip, "w") as archive:
                archive.writestr("model/conf/model.conf", "safe")
                archive.writestr("../../outside.txt", "not safe")

            with self.assertRaises(ValueError):
                build_model_archive(source_zip, output_archive)

            self.assertFalse(outside_file.exists())
            self.assertFalse(output_archive.exists())


if __name__ == "__main__":
    unittest.main()
