from __future__ import annotations

from pathlib import Path
import tempfile
import unittest

import pymupdf

from reportlab.lib.pagesizes import A4
from reportlab.lib.colors import HexColor, white
from reportlab.pdfgen import canvas

from protocol import EngineRequest
from worker import handle_request
from write.pdf_report import analyze_pdf_report_pair
from write.pdf_form import fill_pdf_form


def _write_report(path: Path, *, values: bool, second_page: bool = False) -> None:
    document = canvas.Canvas(str(path), pagesize=A4)
    document.setFont("Helvetica", 10)
    document.drawString(48, 790, "Monthly report")
    document.drawString(48, 760, "Period")
    document.drawString(48, 700, "Customer")
    document.drawString(240, 700, "Revenue")
    if values:
        document.drawString(120, 760, "2026-08")
        document.drawString(48, 680, "Acme")
        document.drawString(240, 680, "1000")
        document.drawString(48, 660, "Beta")
        document.drawString(240, 660, "800")
    document.showPage()
    if second_page:
        document.drawString(48, 790, "Unexpected page")
        document.showPage()
    document.save()


def _draw_table(
    document: canvas.Canvas,
    *,
    x: float,
    top: float,
    width: float,
    rows: int,
    columns: tuple[str, ...],
    values: list[tuple[str, ...]],
) -> None:
    row_height = 20.0
    document.setFillColor(HexColor("#DDE7F5"))
    document.rect(x, top - row_height, width, row_height, stroke=0, fill=1)
    document.setFillColor(HexColor("#203154"))
    for index, label in enumerate(columns):
        document.drawString(x + 8 + index * (width / len(columns)), top - 14, label)
    for row_index in range(rows):
        y = top - row_height * (row_index + 2)
        document.setFillColor(white if row_index % 2 == 0 else HexColor("#F3F6FA"))
        document.rect(x, y, width, row_height, stroke=0, fill=1)
        if row_index >= len(values):
            continue
        document.setFillColor(HexColor("#203154"))
        for column_index, value in enumerate(values[row_index]):
            document.drawString(x + 8 + column_index * (width / len(columns)), y + 6, value)


def _write_geometric_report(path: Path, *, values: bool) -> None:
    document = canvas.Canvas(str(path), pagesize=A4)
    document.setFont("Helvetica", 9)
    document.drawString(40, 800, "Generated on")
    document.drawString(320, 800, "Period")
    document.drawString(40, 775, "Source")
    document.drawString(320, 775, "Status")
    if values:
        document.drawString(130, 800, "2031-04-02")
        document.drawString(390, 800, "2031-03")
        document.drawString(130, 775, "API plus DB")
        document.drawString(390, 775, "Draft")
    _draw_table(
        document,
        x=40,
        top=720,
        width=230,
        rows=3,
        columns=("Region", "Amount"),
        values=[("North", "100"), ("South", "80")] if values else [],
    )
    _draw_table(
        document,
        x=325,
        top=720,
        width=230,
        rows=2,
        columns=("Tier", "Count"),
        values=[("Gold", "3"), ("Silver", "7")] if values else [],
    )
    document.showPage()
    document.save()


class PdfReportPairTest(unittest.TestCase):
    def test_distinct_headers_do_not_merge_tables_at_same_columns(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            for name, filled in [("template", False), ("example", True)]:
                document = canvas.Canvas(str(root / f"{name}.pdf"), pagesize=A4)
                document.setFont("Helvetica", 9)
                for top, headers in [(720, ("Customer", "Revenue")), (500, ("Risk", "Count"))]:
                    _draw_table(document, x=40, top=top, width=400, rows=2,
                                columns=headers,
                                values=[("Alpha", "10"), ("Beta", "20")] if filled else [])
                document.showPage()
                document.save()
            pair = analyze_pdf_report_pair(root / "template.pdf", root / "example.pdf", root / "artifacts")
            self.assertEqual(len(pair["tableGroups"]), 2)
            self.assertEqual([group["rowCount"] for group in pair["tableGroups"]], [2, 2])

    def test_finds_dynamic_slots_and_repeated_table_rows_without_fixture_coordinates(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            template = root / "template.pdf"
            example = root / "example.pdf"
            artifacts = root / "artifacts"
            _write_report(template, values=False)
            _write_report(example, values=True)

            result = analyze_pdf_report_pair(template, example, artifacts)

            self.assertEqual(result["pageCount"], 1)
            self.assertEqual(len(result["tableGroups"]), 1)
            table = result["tableGroups"][0]
            self.assertEqual(table["columnCount"], 2)
            self.assertEqual(len(table["rows"]), 2)
            self.assertEqual(
                [[cell["exampleText"] for cell in row["cells"]] for row in table["rows"]],
                [["Acme", "1000"], ["Beta", "800"]],
            )
            self.assertEqual([slot["exampleText"] for slot in result["scalarSlots"]], ["2026-08"])
            self.assertTrue(Path(result["exampleImages"][0]).is_file())
            self.assertTrue(Path(result["templateImages"][0]).is_file())

    def test_rejects_a_pair_with_different_page_geometry(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            template = root / "template.pdf"
            example = root / "example.pdf"
            _write_report(template, values=False)
            _write_report(example, values=True, second_page=True)

            with self.assertRaisesRegex(ValueError, "report_pair_page_count_mismatch"):
                analyze_pdf_report_pair(template, example, root / "artifacts")

    def test_scalar_uses_free_template_space_without_crossing_a_border_or_label(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for name, filled in (("template", False), ("example", True)):
                document = canvas.Canvas(str(root / f"{name}.pdf"), pagesize=A4)
                document.setFont("Helvetica", 8)
                document.drawString(48, 740, "Status")
                document.rect(110, 730, 80, 25, stroke=1, fill=0)
                document.drawString(200, 740, "Protected label")
                if filled:
                    document.drawString(120, 740, "PASS")
                document.showPage()
                document.save()
            pair = analyze_pdf_report_pair(root / "template.pdf", root / "example.pdf", root / "artifacts")
            slot = pair["scalarSlots"][0]
            result = fill_pdf_form(root / "template.pdf", {
                "schemaVersion": 1, "coordinateSpace": "pdf-user-top-left-unrotated",
                "sourceHash": pair["templateHash"], "pageCount": 1, "pages": pair["pages"],
                "mode": "overlay", "fields": [{**slot, "name": slot["id"], "type": "text", "source": "layout_hint"}],
            }, {slot["id"]: "Pending review"}, root / "filled.pdf")
            self.assertTrue(result["verified"])
            self.assertLessEqual(slot["rect"]["x"] + slot["rect"]["width"], 188)
            with pymupdf.open(result["outputPath"]) as document:
                text = document[0].get_text()
                self.assertIn("Pending review", text)
                self.assertEqual(text.count("Protected label"), 1)
            with self.assertRaisesRegex(ValueError, "field_text_overflow"):
                fill_pdf_form(root / "template.pdf", {
                    "schemaVersion": 1, "coordinateSpace": "pdf-user-top-left-unrotated",
                    "sourceHash": pair["templateHash"], "pageCount": 1, "pages": pair["pages"],
                    "mode": "overlay", "fields": [{**slot, "name": slot["id"], "type": "text", "source": "layout_hint"}],
                }, {slot["id"]: "This value cannot fit inside the bordered field " * 10}, root / "overflow.pdf")

    def test_uses_template_row_geometry_to_split_adjacent_tables_and_keep_capacity(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            template = root / "template.pdf"
            example = root / "example.pdf"
            _write_geometric_report(template, values=False)
            _write_geometric_report(example, values=True)

            result = analyze_pdf_report_pair(template, example, root / "artifacts")

            self.assertEqual(len(result["tableGroups"]), 2)
            tables = sorted(result["tableGroups"], key=lambda table: table["rows"][0]["cells"][0]["rect"]["x"])
            self.assertEqual([table["columnCount"] for table in tables], [2, 2])
            self.assertEqual([table["rowCount"] for table in tables], [3, 2])
            self.assertEqual(
                [[cell["exampleText"] for cell in row["cells"]] for row in tables[0]["rows"]],
                [["North", "100"], ["South", "80"], ["", ""]],
            )
            self.assertEqual(
                [slot["exampleText"] for slot in result["scalarSlots"]],
                ["2031-04-02", "2031-03", "API plus DB", "Draft"],
            )

    def test_clips_overflowing_vector_table_regions_to_page_bounds(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            template = root / "template.pdf"
            example = root / "example.pdf"
            for path, values in ((template, False), (example, True)):
                document = canvas.Canvas(str(path), pagesize=A4)
                document.setFont("Helvetica", 9)
                _draw_table(
                    document,
                    x=360,
                    top=720,
                    width=260,
                    rows=3,
                    columns=("Tier", "Count"),
                    values=[("Gold", "3"), ("Silver", "7")] if values else [],
                )
                document.showPage()
                document.save()

            result = analyze_pdf_report_pair(template, example, root / "artifacts")
            page_width = result["pages"][0]["width"]
            self.assertEqual(len(result["tableGroups"]), 1)
            group = result["tableGroups"][0]
            for bound in group["pageBounds"]:
                self.assertLessEqual(bound["x"] + bound["width"], page_width + 0.01)
            for row in group["rows"]:
                for cell in row["cells"]:
                    rect = cell["rect"]
                    self.assertGreaterEqual(rect["x"], 0.0)
                    self.assertGreaterEqual(rect["y"], 0.0)
                    self.assertGreater(rect["width"], 0.0)
                    self.assertGreater(rect["height"], 0.0)
                    self.assertLessEqual(rect["x"] + rect["width"], page_width + 0.01)
                    self.assertLessEqual(rect["y"] + rect["height"], result["pages"][0]["height"] + 0.01)

    def test_rotated_pair_geometry_can_be_used_by_the_pdf_writer(self) -> None:
        for rotation in (90, 270):
            with self.subTest(rotation=rotation), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                template = root / "template.pdf"
                example = root / "example.pdf"
                for path, values in ((template, False), (example, True)):
                    _write_report(path, values=values)
                    with pymupdf.open(path) as document:
                        document[0].set_rotation(rotation)
                        document.saveIncr()
                pair = analyze_pdf_report_pair(template, example, root / "artifacts")
                slot = pair["scalarSlots"][0]
                result = fill_pdf_form(template, {
                    "schemaVersion": 1, "coordinateSpace": "pdf-user-top-left-unrotated",
                    "sourceHash": pair["templateHash"], "pageCount": pair["pageCount"],
                    "pages": pair["pages"], "mode": "overlay", "fields": [{
                        **slot, "name": slot["id"], "type": "text", "source": "layout_hint",
                    }],
                }, {slot["id"]: "2026-09"}, root / "filled.pdf")
                self.assertTrue(result["verified"])
                with pymupdf.open(result["outputPath"]) as document:
                    self.assertEqual(document[0].rotation, rotation)
                    self.assertIn("2026-09", document[0].get_text())

    def test_worker_exposes_the_pair_analysis_command(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            template = root / "template.pdf"
            example = root / "example.pdf"
            _write_report(template, values=False)
            _write_report(example, values=True)

            response = handle_request(
                EngineRequest(
                    id="report-pair",
                    command="pdf_report_analyze",
                    params={
                        "templatePath": str(template),
                        "examplePath": str(example),
                        "artifactRoot": str(root / "artifacts"),
                        "allowedPaths": [str(template), str(example)],
                        "allowedRoots": [str(root / "artifacts")],
                    },
                )
            )

            self.assertTrue(response.ok)
            self.assertEqual(response.data["pageCount"], 1)


if __name__ == "__main__":
    unittest.main()
