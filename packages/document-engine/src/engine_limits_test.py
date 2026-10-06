import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from engine_limits import (
    MAX_RENDER_PIXELS,
    MAX_SOURCE_PAGES,
    assert_source_within_limits,
    clamp_render_scale,
)
from protocol import EngineResponse
from worker_engine import projection
from worker_engine.stdio import MAX_RESPONSE_BYTES, _encode_response


class RenderScaleTest(unittest.TestCase):
    def test_normal_pages_keep_the_requested_scale(self) -> None:
        self.assertEqual(clamp_render_scale(595, 842, 2.0), 2.0)

    def test_huge_pages_are_clamped_under_the_pixel_budget(self) -> None:
        scale = clamp_render_scale(14_400, 14_400, 2.0)
        self.assertLess(scale, 2.0)
        self.assertLessEqual((14_400 * scale) * (14_400 * scale), MAX_RENDER_PIXELS * 1.0001)


class SourceLimitTest(unittest.TestCase):
    def test_rejects_pdfs_over_the_page_limit(self) -> None:
        from pypdf import PdfWriter

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "many.pdf"
            writer = PdfWriter()
            for _ in range(MAX_SOURCE_PAGES + 1):
                writer.add_blank_page(width=72, height=72)
            with path.open("wb") as handle:
                writer.write(handle)
            with self.assertRaisesRegex(ValueError, "document_too_many_pages"):
                assert_source_within_limits(path)

    def test_accepts_small_non_pdf_sources(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "note.txt"
            path.write_text("hello", encoding="utf-8")
            assert_source_within_limits(path)


class ResponseBoundTest(unittest.TestCase):
    def test_oversized_response_becomes_a_clean_error(self) -> None:
        response = EngineResponse(id="r1", ok=True, data={"html": "x" * (MAX_RESPONSE_BYTES + 1)})
        decoded = json.loads(_encode_response(response).decode("utf-8"))
        self.assertEqual(decoded["error"], "document_engine_response_too_large")
        self.assertFalse(decoded["ok"])

    def test_ingest_payload_drops_duplicated_text_then_truncates(self) -> None:
        page_text = "가" * 1_000_000
        manifest = {
            "chunks": [{"id": "c1", "text": page_text}] * 3,
            "pages": [{"index": index, "text": page_text} for index in range(3)],
        }
        with tempfile.TemporaryDirectory() as tmp:
            data = projection._ingest_response_data("a" * 64, Path(tmp), manifest)
        encoded = len(json.dumps(data, ensure_ascii=False).encode("utf-8"))
        self.assertLessEqual(encoded, projection.INGEST_RESPONSE_BUDGET_BYTES)
        self.assertTrue(data["textOmitted"])
        self.assertTrue(data["truncated"])
        self.assertEqual(len(manifest["pages"][0]["text"]), 1_000_000)


class StderrTailTest(unittest.TestCase):
    def test_worker_forwards_only_the_stderr_tail(self) -> None:
        src = Path(__file__).resolve().parent
        script = (
            "import os, sys\n"
            f"sys.path.insert(0, {str(src)!r})\n"
            "from worker_engine.stdio import capture_stderr_tail\n"
            "with capture_stderr_tail(1000):\n"
            "    os.write(2, b'x' * 200000 + b'TAIL')\n"
        )
        completed = subprocess.run([sys.executable, "-c", script], capture_output=True, timeout=60, env=dict(os.environ))
        self.assertEqual(completed.returncode, 0)
        self.assertLess(len(completed.stderr), 2_000)
        self.assertTrue(completed.stderr.endswith(b"TAIL"))


if __name__ == "__main__":
    unittest.main()
