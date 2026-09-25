import contextlib
import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

from tools.tid_translation.import_tulap import import_tulap_xlsx, main


NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NS_PACKAGE_REL = "http://schemas.openxmlformats.org/package/2006/relationships"


def make_minimal_xlsx(path, rows):
    shared_strings = []
    shared_indices = {}
    for row in rows:
        if row and row[0]:
            shared_indices[row[0]] = len(shared_strings)
            shared_strings.append(row[0])

    shared_root = ET.Element(f"{{{NS_MAIN}}}sst", {"count": str(len(shared_strings)), "uniqueCount": str(len(shared_strings))})
    for value in shared_strings:
        item = ET.SubElement(shared_root, f"{{{NS_MAIN}}}si")
        ET.SubElement(item, f"{{{NS_MAIN}}}t").text = value

    worksheet = ET.Element(f"{{{NS_MAIN}}}worksheet")
    sheet_data = ET.SubElement(worksheet, f"{{{NS_MAIN}}}sheetData")
    for row_number, cells in enumerate(rows, start=1):
        row_element = ET.SubElement(sheet_data, f"{{{NS_MAIN}}}row", {"r": str(row_number)})
        for column_number, value in enumerate(cells[:2], start=1):
            if not value:
                continue
            cell_ref = f"{'A' if column_number == 1 else 'B'}{row_number}"
            if column_number == 1:
                cell = ET.SubElement(row_element, f"{{{NS_MAIN}}}c", {"r": cell_ref, "t": "s"})
                ET.SubElement(cell, f"{{{NS_MAIN}}}v").text = str(shared_indices[value])
            else:
                cell = ET.SubElement(row_element, f"{{{NS_MAIN}}}c", {"r": cell_ref, "t": "inlineStr"})
                inline = ET.SubElement(cell, f"{{{NS_MAIN}}}is")
                ET.SubElement(inline, f"{{{NS_MAIN}}}t").text = value

    workbook_xml = (
        f'<workbook xmlns="{NS_MAIN}" xmlns:r="{NS_REL}">'
        '<sheets><sheet name="TID-TR" sheetId="1" r:id="rId1"/></sheets></workbook>'
    )
    relationships_xml = (
        f'<Relationships xmlns="{NS_PACKAGE_REL}">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
        '</Relationships>'
    )
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("xl/workbook.xml", workbook_xml)
        archive.writestr("xl/_rels/workbook.xml.rels", relationships_xml)
        archive.writestr("xl/sharedStrings.xml", ET.tostring(shared_root, encoding="utf-8", xml_declaration=True))
        archive.writestr("xl/worksheets/sheet1.xml", ET.tostring(worksheet, encoding="utf-8", xml_declaration=True))
    return path


class TulapImportTests(unittest.TestCase):
    def test_imported_rows_are_candidates_with_stable_source_rows(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            workbook = make_minimal_xlsx(
                Path(temp_dir) / "tiny.xlsx",
                [
                    ["Turkish sentence", "TID sentence"],
                    ["Sen iyisin", "REVIEW ME"],
                    ["", ""],
                    ["Bugün iyiyim", "ME TODAY GOOD"],
                ],
            )

            entries = import_tulap_xlsx(workbook, header_rows=1)

        self.assertEqual(len(entries), 2)
        self.assertEqual(entries[0]["sourceId"], "tulap:2")
        self.assertEqual(entries[0]["turkishText"], "Sen iyisin")
        self.assertEqual(entries[0]["tidTextCandidate"], "REVIEW ME")
        self.assertEqual(entries[0]["sourceLicense"], "Apache-2.0")
        self.assertEqual(entries[0]["sourceUrl"], "https://tulap.cmpe.boun.edu.tr/items/4bccab49-30e9-4c94-bdd0-ae5171e074f9/full")
        self.assertRegex(entries[0]["sourceSha256"], r"^[0-9a-f]{64}$")
        self.assertEqual(entries[0]["reviewStatus"], "candidate")
        self.assertNotIn("playable", entries[0])
        self.assertEqual(entries[1]["sourceId"], "tulap:4")

    def test_missing_header_cells_are_rejected(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            workbook = make_minimal_xlsx(
                Path(temp_dir) / "no-header.xlsx",
                [["", ""], ["Sen iyisin", "REVIEW ME"]],
            )

            with self.assertRaisesRegex(ValueError, "header"):
                import_tulap_xlsx(workbook, header_rows=1)

    def test_invalid_header_row_count_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            workbook = make_minimal_xlsx(Path(temp_dir) / "tiny.xlsx", [["Header", "Header"]])

            with self.assertRaisesRegex(ValueError, "header_rows"):
                import_tulap_xlsx(workbook, header_rows=0)

    def test_malformed_workbook_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            workbook = Path(temp_dir) / "broken.xlsx"
            workbook.write_bytes(b"not an Office Open XML archive")

            with self.assertRaises(ValueError):
                import_tulap_xlsx(workbook, header_rows=1)

    def test_command_writes_candidate_jsonl_outside_public(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            workbook = make_minimal_xlsx(
                Path(temp_dir) / "tiny.xlsx",
                [["Turkish sentence", "TID sentence"], ["Sen iyisin", "REVIEW ME"]],
            )
            output = Path(temp_dir) / "candidates.jsonl"

            self.assertEqual(
                main([str(workbook), "--header-rows", "1", "--output", str(output)]),
                0,
            )
            record = json.loads(output.read_text(encoding="utf-8"))

        self.assertEqual(record["reviewStatus"], "candidate")
        self.assertEqual(record["sourceLicense"], "Apache-2.0")

    def test_command_refuses_to_write_candidates_under_public(self):
        repository_root = Path(__file__).resolve().parents[1]
        output = repository_root / "public" / ".tulap-candidates-test.jsonl"
        self.assertFalse(output.exists())
        try:
            with tempfile.TemporaryDirectory() as temp_dir:
                workbook = make_minimal_xlsx(
                    Path(temp_dir) / "tiny.xlsx",
                    [["Turkish sentence", "TID sentence"], ["Sen iyisin", "REVIEW ME"]],
                )
                error_output = io.StringIO()
                with contextlib.redirect_stderr(error_output):
                    with self.assertRaises(SystemExit) as error:
                        main([str(workbook), "--header-rows", "1", "--output", str(output)])
                self.assertEqual(error.exception.code, 2)
                self.assertIn("candidate records must stay outside public/", error_output.getvalue())
            self.assertFalse(output.exists())
        finally:
            output.unlink(missing_ok=True)


if __name__ == "__main__":
    unittest.main()
