from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from artifact_store import artifact_dir
from protocol import EngineRequest
from worker import handle_request


class WorkerContractTest(unittest.TestCase):
    def test_ping_does_not_import_command_handlers(self) -> None:
        code = (
            "import sys; from protocol import EngineRequest; from worker import handle_request; "
            "response = handle_request(EngineRequest(id='ping', command='ping', params={})); "
            "assert response.ok; "
            "unneeded = {'artifact_store', 'adapters', 'worker_engine.ingest', "
            "'worker_engine.pdf', 'worker_engine.queries'}; "
            "loaded = unneeded.intersection(sys.modules); "
            "assert not loaded, f'unused command modules imported for ping: {sorted(loaded)}'"
        )
        result = subprocess.run(
            [sys.executable, "-c", code],
            cwd=Path(__file__).resolve().parent,
            capture_output=True,
            text=True,
            check=False,
        )

        self.assertEqual(result.returncode, 0, result.stderr)

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
                        "allowedPaths": [str(source)],
                        "allowedRoots": [str(Path(directory) / "artifacts")],
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
                        "allowedPaths": [str(source)],
                        "allowedRoots": [str(Path(directory) / "artifacts")],
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

    def test_ingest_rejects_a_path_outside_the_host_allowlist(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "report.txt"
            source.write_text("report", encoding="utf-8")
            response = handle_request(
                EngineRequest(
                    id="request-disallowed-path",
                    command="ingest",
                    params={
                        "path": str(source),
                        "artifactRoot": str(Path(directory) / "artifacts"),
                        "allowedPaths": [str(Path(directory) / "other.txt")],
                        "allowedRoots": [str(Path(directory) / "artifacts")],
                        "options": {"engine": "basic"},
                    },
                )
            )

        self.assertFalse(response.ok)
        self.assertEqual(response.error, "document_path_not_allowed")


if __name__ == "__main__":
    unittest.main()
