from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from artifact_store import artifact_dir
from protocol import EngineRequest
from worker import handle_request


class WorkerContractTest(unittest.TestCase):
    def test_artifact_id_must_be_a_sha256_hex_identifier(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "artifacts"
            with self.assertRaisesRegex(ValueError, "document_id_invalid"):
                artifact_dir(root, "../../outside")

            response = handle_request(
                EngineRequest(
                    id="request-invalid-document-id",
                    command="search",
                    params={"documentId": "../../outside", "query": "term"},
                )
            )

        self.assertFalse(response.ok)
        self.assertEqual(response.error, "document_id_invalid")

    def test_unknown_engine_is_rejected_instead_of_using_basic(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "report.txt"
            source.write_text("report", encoding="utf-8")
            response = handle_request(
                EngineRequest(
                    id="request-1",
                    command="ingest",
                    params={
                        "path": str(source),
                        "artifactRoot": str(Path(directory) / "artifacts"),
                        "options": {"engine": "unknown"},
                    },
                )
            )

        self.assertFalse(response.ok)
        self.assertEqual(response.error, "unsupported_engine:unknown")

    def test_unknown_ocr_is_rejected_instead_of_using_auto(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "report.txt"
            source.write_text("report", encoding="utf-8")
            response = handle_request(
                EngineRequest(
                    id="request-invalid-ocr",
                    command="ingest",
                    params={
                        "path": str(source),
                        "artifactRoot": str(Path(directory) / "artifacts"),
                        "options": {"engine": "basic", "ocr": "unknown"},
                    },
                )
            )

        self.assertFalse(response.ok)
        self.assertEqual(response.error, "unsupported_ocr:unknown")

    def test_empty_search_is_rejected_instead_of_matching_every_chunk(self) -> None:
        response = handle_request(
            EngineRequest(
                id="request-2",
                command="search",
                params={"documentId": "document-1", "query": "  "},
            )
        )

        self.assertFalse(response.ok)
        self.assertEqual(response.error, "query_required")

    def test_negative_page_index_is_rejected_before_manifest_lookup(self) -> None:
        response = handle_request(
            EngineRequest(
                id="request-3",
                command="get_page",
                params={"documentId": "document-1", "pageIndex": -1},
            )
        )

        self.assertFalse(response.ok)
        self.assertEqual(response.error, "page_index_invalid")


if __name__ == "__main__":
    unittest.main()
