from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from pypdf import PdfReader, PdfWriter
from reportlab.pdfgen import canvas

from artifact_store import load_manifest, sha256_file
from protocol import EngineRequest
from worker import handle_request
from write.pdf_to_html_engine.engines import _basic_pdf_to_html


def _write_pdf(path: Path) -> None:
    document = canvas.Canvas(str(path), pagesize=(240, 320), pageCompression=1)
    for text in ("AX parser first page & source", "AX parser second page"):
        document.drawString(20, 280, text)
        document.showPage()
    document.save()
    reader = PdfReader(str(path))
    writer = PdfWriter()
    for index, page in enumerate(reader.pages):
        if index == 1:
            page.rotate(90)
        writer.add_page(page)
    writer.add_blank_page(width=240, height=320)
    temporary = path.with_suffix(".staged.pdf")
    with temporary.open("wb") as handle:
        writer.write(handle)
    temporary.replace(path)


class PdfParserCompatibilityTest(unittest.TestCase):
    def test_worker_ingests_compressed_rotated_and_blank_pages_without_source_mutation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source.pdf"
            artifacts = root / "artifacts"
            _write_pdf(source)
            original = source.read_bytes()
            source_hash = sha256_file(source)
            request = EngineRequest(
                id="parser-compatibility",
                command="ingest",
                params={
                    "path": str(source),
                    "artifactRoot": str(artifacts),
                    "allowedPaths": [str(source)],
                    "allowedRoots": [str(artifacts)],
                    "options": {"engine": "basic", "ocr": "off"},
                },
            )
            response = handle_request(request)
            self.assertTrue(response.ok, response.error)
            manifest = load_manifest(artifacts, source_hash)
            self.assertEqual(manifest["sourceHash"], source_hash)
            self.assertEqual(manifest["summary"]["pageCount"], 3)
            self.assertIn("AX parser first page & source", manifest["chunks"][0]["text"])
            self.assertIn("AX parser second page", manifest["chunks"][1]["text"])
            self.assertEqual(manifest["chunks"][2]["text"], "")
            self.assertTrue(handle_request(request).ok)
            self.assertEqual(source.read_bytes(), original)

    def test_basic_html_conversion_preserves_page_count_text_and_escaping(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.pdf"
            _write_pdf(source)
            original = source.read_bytes()
            html, page_count = _basic_pdf_to_html(source)
            self.assertEqual(page_count, 3)
            self.assertIn("AX parser first page &amp; source", html)
            self.assertIn("AX parser second page", html)
            self.assertIn('data-page-index="2"', html)
            self.assertEqual(source.read_bytes(), original)


if __name__ == "__main__":
    unittest.main()
