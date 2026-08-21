from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from write.pdf_to_html import _basic_pdf_to_html, convert_pdf_to_html, default_template_root


class PdfToHtmlTest(unittest.TestCase):
    def test_basic_pdf_to_html_wraps_text(self) -> None:
        try:
            from pypdf import PdfWriter
        except ImportError:
            self.skipTest("pypdf not installed")

        with tempfile.TemporaryDirectory() as tmp:
            pdf_path = Path(tmp) / "sample.pdf"
            writer = PdfWriter()
            writer.add_blank_page(width=200, height=200)
            with pdf_path.open("wb") as handle:
                writer.write(handle)

            html, page_count = _basic_pdf_to_html(pdf_path)
            self.assertEqual(page_count, 1)
            self.assertIn("<html", html.lower())
            self.assertIn('class="page"', html)

    def test_convert_pdf_to_html_writes_template_artifacts(self) -> None:
        try:
            from pypdf import PdfWriter
        except ImportError:
            self.skipTest("pypdf not installed")

        with tempfile.TemporaryDirectory() as tmp:
            pdf_path = Path(tmp) / "report.pdf"
            template_root = Path(tmp) / "templates"
            writer = PdfWriter()
            writer.add_blank_page(width=200, height=200)
            with pdf_path.open("wb") as handle:
                writer.write(handle)

            result = convert_pdf_to_html(
                pdf_path,
                template_root,
                {"engine": "basic", "ocr": "off"},
            )
            self.assertTrue(Path(result.html_path).is_file())
            self.assertTrue(Path(result.original_pdf_path).is_file())
            self.assertTrue(Path(result.meta_path).is_file())
            self.assertEqual(result.engine, "basic")
            self.assertFalse(result.cached)

            cached = convert_pdf_to_html(
                pdf_path,
                template_root,
                {"engine": "basic", "ocr": "off"},
            )
            self.assertTrue(cached.cached)


if __name__ == "__main__":
    unittest.main()
