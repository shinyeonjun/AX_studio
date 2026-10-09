from __future__ import annotations

from pathlib import Path
import tempfile
import unittest

from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

from pdf_form_test import _pdfium_text
from pdf_report_test import _write_report
from protocol import EngineRequest
from worker import handle_request
from write.pdf_report import analyze_pdf_report_pair
from write.pdf_report_single import blank_report_template, list_report_spans


def _write_labelled_total(path: Path) -> None:
    document = canvas.Canvas(str(path), pagesize=A4)
    document.setFont("Helvetica", 10)
    document.drawString(48, 790, "Monthly report")
    # Label and value in one run of text, as many generated reports write them.
    document.drawString(48, 760, "Total: 1800")
    document.showPage()
    document.save()


class SingleReportTest(unittest.TestCase):
    def test_last_months_report_alone_becomes_a_blank_form_with_the_values_as_slots(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            example = root / "august.pdf"
            _write_report(example, values=True)

            listed = list_report_spans(example, root / "artifacts")
            texts = [span["text"] for span in listed["spans"]]
            self.assertIn("Monthly report", texts)
            self.assertIn("1000", texts)
            self.assertTrue(all(Path(image).is_file() for image in listed["exampleImages"]))

            values = {"2026-08", "Acme", "1000", "Beta", "800"}
            removals = [
                {"pageIndex": span["pageIndex"], "rect": span["rect"], "text": span["text"]}
                for span in listed["spans"] if span["text"] in values
            ]
            blank = root / "blank.pdf"
            blank_report_template(example, removals, blank)

            blank_text = _pdfium_text(blank)
            for value in values:
                self.assertNotIn(value, blank_text)
            for label in ("Monthly report", "Period", "Customer", "Revenue"):
                self.assertIn(label, blank_text)

            pair = analyze_pdf_report_pair(blank, example, root / "artifacts")
            slots = [slot["exampleText"] for slot in pair["scalarSlots"]]
            cells = [cell["exampleText"] for group in pair["tableGroups"] for row in group["rows"] for cell in row["cells"]]
            self.assertEqual(sorted([*slots, *cells]), sorted(values))

    def test_only_the_value_leaves_a_line_that_also_holds_its_label(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            example = root / "total.pdf"
            _write_labelled_total(example)
            span = next(span for span in list_report_spans(example, root / "a")["spans"] if span["text"] == "Total: 1800")
            blank = root / "blank.pdf"
            blank_report_template(example, [{"pageIndex": 0, "rect": span["rect"], "text": "1800"}], blank)

            text = _pdfium_text(blank)
            self.assertIn("Total:", text)
            self.assertNotIn("1800", text)
            pair = analyze_pdf_report_pair(blank, example, root / "a")
            self.assertEqual([slot["exampleText"] for slot in pair["scalarSlots"]], ["1800"])

    def test_a_value_that_is_not_on_the_page_fails_instead_of_passing_as_blank(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            example = root / "august.pdf"
            _write_report(example, values=True)
            with self.assertRaisesRegex(ValueError, "report_value_not_removed"):
                blank_report_template(example, [
                    {"pageIndex": 0, "rect": {"x": 40, "y": 40, "width": 100, "height": 20}, "text": "9999"},
                ], root / "blank.pdf")

    def test_the_worker_lists_and_blanks_through_its_commands(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            example = root / "august.pdf"
            _write_report(example, values=True)
            listed = handle_request(EngineRequest(id="1", command="pdf_report_spans", params={
                "examplePath": str(example), "artifactRoot": str(root / "artifacts"),
                "allowedPaths": [str(example)], "allowedRoots": [str(root / "artifacts")],
            }))
            self.assertTrue(listed.ok, listed.error)
            span = next(span for span in listed.data["spans"] if span["text"] == "1000")
            blanked = handle_request(EngineRequest(id="2", command="pdf_report_blank", params={
                "examplePath": str(example), "outputPath": str(root / "blank.pdf"),
                "allowedPaths": [str(example), str(root / "blank.pdf")],
                "removals": [{"pageIndex": 0, "rect": span["rect"], "text": "1000"}],
            }))
            self.assertTrue(blanked.ok, blanked.error)
            self.assertNotIn("1000", _pdfium_text(root / "blank.pdf"))


if __name__ == "__main__":
    unittest.main()
