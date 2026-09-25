"""Import TULAP spreadsheet rows as unreviewed candidate records only."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import posixpath
import re
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET


TULAP_RECORD_URL = "https://tulap.cmpe.boun.edu.tr/items/4bccab49-30e9-4c94-bdd0-ae5171e074f9/full"
TULAP_LICENSE = "Apache-2.0"
_CELL_REF = re.compile(r"^([A-Z]+)[1-9][0-9]*$", re.IGNORECASE)
_RELATIONSHIP_ID = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _direct_children(element: ET.Element, name: str) -> list[ET.Element]:
    return [child for child in element if _local_name(child.tag) == name]


def _read_xml(archive: zipfile.ZipFile, member: str) -> ET.Element:
    try:
        raw = archive.read(member)
    except KeyError as error:
        raise ValueError(f"malformed workbook: missing {member}") from error
    try:
        return ET.fromstring(raw)
    except ET.ParseError as error:
        raise ValueError(f"malformed workbook XML: {member}") from error


def read_shared_strings(archive: zipfile.ZipFile) -> list[str]:
    """Read the optional shared string table from an open XLSX archive."""
    if "xl/sharedStrings.xml" not in archive.namelist():
        return []
    root = _read_xml(archive, "xl/sharedStrings.xml")
    strings = []
    for item in _direct_children(root, "si"):
        strings.append("".join(child.text or "" for child in item.iter() if _local_name(child.tag) == "t"))
    return strings


def _column_index(cell_reference: str) -> int:
    match = _CELL_REF.fullmatch(cell_reference)
    if match is None:
        raise ValueError(f"malformed workbook: invalid cell reference {cell_reference!r}")
    column = 0
    for letter in match.group(1).upper():
        column = column * 26 + ord(letter) - ord("A") + 1
    return column - 1


def _cell_text(cell: ET.Element, shared: list[str]) -> str:
    cell_type = cell.get("t", "")
    if cell_type == "inlineStr":
        inline = next((child for child in cell if _local_name(child.tag) == "is"), None)
        if inline is None:
            return ""
        return "".join(child.text or "" for child in inline.iter() if _local_name(child.tag) == "t")

    value = next((child for child in cell if _local_name(child.tag) == "v"), None)
    if value is None or value.text is None:
        return ""
    if cell_type == "s":
        try:
            return shared[int(value.text)]
        except (ValueError, IndexError) as error:
            raise ValueError("malformed workbook: shared string index is invalid") from error
    if cell_type == "e":
        raise ValueError("malformed workbook: worksheet contains an error cell")
    return value.text


def read_first_worksheet_rows(archive: zipfile.ZipFile, shared: list[str]) -> list[list[str]]:
    """Resolve the first sheet through workbook relationships and read its rows."""
    workbook = _read_xml(archive, "xl/workbook.xml")
    sheet = next((node for node in workbook.iter() if _local_name(node.tag) == "sheet"), None)
    if sheet is None:
        raise ValueError("malformed workbook: first worksheet is missing")
    relationship_id = sheet.get(_RELATIONSHIP_ID)
    if not relationship_id:
        raise ValueError("malformed workbook: first worksheet has no relationship")

    relationships = _read_xml(archive, "xl/_rels/workbook.xml.rels")
    relationship = next(
        (node for node in relationships.iter() if _local_name(node.tag) == "Relationship" and node.get("Id") == relationship_id),
        None,
    )
    if relationship is None or relationship.get("TargetMode", "Internal") == "External":
        raise ValueError("malformed workbook: first worksheet relationship is invalid")
    target = relationship.get("Target")
    if not target:
        raise ValueError("malformed workbook: first worksheet target is missing")
    worksheet_path = posixpath.normpath(target.lstrip("/") if target.startswith("/") else posixpath.join("xl", target))
    if not worksheet_path.startswith("xl/worksheets/"):
        raise ValueError("malformed workbook: worksheet target is outside the worksheets directory")

    worksheet = _read_xml(archive, worksheet_path)
    rows_by_number: dict[int, list[str]] = {}
    inferred_row_number = 0
    for row in (node for node in worksheet.iter() if _local_name(node.tag) == "row"):
        row_ref = row.get("r")
        try:
            row_number = int(row_ref) if row_ref is not None else inferred_row_number + 1
        except ValueError as error:
            raise ValueError("malformed workbook: worksheet row number is invalid") from error
        if row_number < 1 or row_number in rows_by_number:
            raise ValueError("malformed workbook: worksheet row number is duplicated or invalid")
        inferred_row_number = row_number
        values = ["", ""]
        for cell in _direct_children(row, "c"):
            cell_reference = cell.get("r")
            if not cell_reference:
                raise ValueError("malformed workbook: cell reference is missing")
            column = _column_index(cell_reference)
            if column < 2:
                values[column] = _cell_text(cell, shared)
        rows_by_number[row_number] = values

    if not rows_by_number:
        raise ValueError("malformed workbook: first worksheet has no rows")
    return [rows_by_number.get(row_number, ["", ""]) for row_number in range(1, max(rows_by_number) + 1)]


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def import_tulap_xlsx(path: str | Path, header_rows: int) -> list[dict[str, str]]:
    """Return TULAP rows as candidates; never creates approved/playable output."""
    if type(header_rows) is not int or header_rows < 1:
        raise ValueError("header_rows must be an explicit positive integer")
    workbook_path = Path(path)
    try:
        with zipfile.ZipFile(workbook_path) as archive:
            shared = read_shared_strings(archive)
            rows = read_first_worksheet_rows(archive, shared)
    except (OSError, zipfile.BadZipFile) as error:
        raise ValueError("malformed workbook: expected an Office Open XML XLSX archive") from error

    if len(rows) < header_rows or not rows[0][0].strip() or not rows[0][1].strip():
        raise ValueError("missing header row: inspect the first two worksheet columns and provide header_rows")

    source_checksum = _sha256_file(workbook_path)
    candidates = []
    for row_number, row in enumerate(rows[header_rows:], start=header_rows + 1):
        turkish_text, tid_candidate = row[0].strip(), row[1].strip()
        if not turkish_text or not tid_candidate:
            continue
        candidates.append(
            {
                "sourceId": f"tulap:{row_number}",
                "turkishText": turkish_text,
                "tidTextCandidate": tid_candidate,
                "sourceLicense": TULAP_LICENSE,
                "sourceUrl": TULAP_RECORD_URL,
                "sourceSha256": source_checksum,
                "reviewStatus": "candidate",
            }
        )
    return candidates


def _is_inside(path: Path, parent: Path) -> bool:
    return path == parent or parent in path.parents


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Import TULAP as unreviewed TİD text candidates.")
    parser.add_argument("workbook", type=Path, help="locally downloaded TULAP XLSX file")
    parser.add_argument("--header-rows", type=int, required=True, help="number of header rows, after inspecting the workbook")
    parser.add_argument("--output", type=Path, required=True, help="candidate JSONL destination outside public/")
    arguments = parser.parse_args(argv)

    try:
        records = import_tulap_xlsx(arguments.workbook, arguments.header_rows)
    except (OSError, ValueError) as error:
        parser.error(str(error))

    repository_root = Path(__file__).resolve().parents[2]
    public_root = repository_root / "public"
    output_absolute = Path.cwd() / arguments.output if not arguments.output.is_absolute() else arguments.output
    output_absolute = Path(os.path.abspath(output_absolute))
    output_resolved = output_absolute.resolve()
    if _is_inside(output_absolute, public_root) or _is_inside(output_resolved, public_root.resolve()):
        parser.error("candidate records must stay outside public/")
    if output_absolute.resolve() == arguments.workbook.resolve():
        parser.error("candidate output must not overwrite the source workbook")
    if not output_absolute.parent.is_dir():
        parser.error("candidate output directory must already exist")

    payload = "".join(json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n" for record in records)
    output_absolute.write_text(payload, encoding="utf-8", newline="\n")
    print(f"Wrote {len(records)} unreviewed candidate rows to {output_absolute}")
    if records:
        print(f"Source SHA-256: {records[0]['sourceSha256']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
