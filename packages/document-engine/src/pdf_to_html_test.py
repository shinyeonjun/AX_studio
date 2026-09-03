from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from write.pdf_to_html import (
    _PDF_HTML_FORMAT_VERSION,
    _basic_pdf_to_html,
    _meta_usable,
    _roundtrip_html,
    convert_pdf_to_html,
)
from parser_config import parser_cache_fingerprint


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

    def test_roundtrip_html_is_page_oriented_and_editable(self) -> None:
        try:
            from pypdf import PdfWriter
        except ImportError:
            self.skipTest("pypdf not installed")

        class FakeDocument:
            def __init__(self) -> None:
                self.calls: list[dict[str, object]] = []

            def export_to_html(self, **kwargs: object) -> str:
                self.calls.append(kwargs)
                return (
                    "<html><head><style>.source { color: red; }</style></head>"
                    "<body><h2>보고서 페이지</h2><p>수정 가능한 내용</p></body></html>"
                )

        with tempfile.TemporaryDirectory() as tmp:
            pdf_path = Path(tmp) / "roundtrip.pdf"
            writer = PdfWriter()
            writer.add_blank_page(width=595.276, height=841.89)
            with pdf_path.open("wb") as handle:
                writer.write(handle)

            document = FakeDocument()
            html = _roundtrip_html(pdf_path, document, 1)

            self.assertIn('class="ax-pdf-page"', html)
            self.assertIn('data-page-index="0"', html)
            self.assertIn('contenteditable="true"', html)
            self.assertIn("@page { size: A4 portrait; margin: 0; }", html)
            self.assertIn("보고서 페이지", html)
            self.assertEqual(len(document.calls), 1)
            self.assertEqual(document.calls[0]["page_no"], 1)
            self.assertEqual(document.calls[0]["html_lang"], "ko")
            self.assertEqual(document.calls[0]["split_page_view"], False)

    def test_docling_cache_requires_current_roundtrip_format(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            html_path = Path(tmp) / "template.html"
            html_path.write_text("<html></html>", encoding="utf-8")
            metadata = {
                "sourceHash": "source-hash",
                "engine": "docling",
                "ocrMode": "auto",
                "htmlPath": str(html_path),
                **parser_cache_fingerprint(),
            }

            self.assertFalse(
                _meta_usable(
                    metadata,
                    source_hash="source-hash",
                    engine="docling",
                    ocr_mode="auto",
                )
            )
            metadata["htmlFormatVersion"] = _PDF_HTML_FORMAT_VERSION
            self.assertTrue(
                _meta_usable(
                    metadata,
                    source_hash="source-hash",
                    engine="docling",
                    ocr_mode="auto",
                )
            )


if __name__ == "__main__":
    unittest.main()
