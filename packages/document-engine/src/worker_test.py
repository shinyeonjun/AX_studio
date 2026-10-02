from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from artifact_store import artifact_dir
from protocol import EngineRequest
from worker import handle_request


class WorkerContractTest(unittest.TestCase):
    def _run_worker_with_legacy_stdin(self, payload: dict, cwd: Path) -> subprocess.CompletedProcess:
        worker = Path(__file__).resolve().with_name("worker.py")
        # Emulate Windows pipe stdin's legacy codepage even on a UTF-8 host.
        code = (
            "import runpy, sys; "
            f"sys.path.insert(0, {str(worker.parent)!r}); "
            "sys.stdin.reconfigure(encoding='cp1252'); "
            f"runpy.run_path({str(worker)!r}, run_name='__main__')"
        )
        return subprocess.run(
            [sys.executable, "-E", "-s", "-c", code],
            input=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            cwd=cwd,
            capture_output=True,
            check=False,
        )

    def test_utf8_stdin_preserves_unicode_paths_and_normalizes_allowed_source(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "relocated payload 한글" / "sample 한글.txt"
            source.parent.mkdir()
            (source.parent / "nested").mkdir()
            source.write_text("AX packaged document smoke 한국어 café", encoding="utf-8")
            artifacts = source.parent / "artifacts 한글"
            cwd = root / "empty-cwd"
            cwd.mkdir()
            result = self._run_worker_with_legacy_stdin(
                {
                    "id": "request-한글",
                    "command": "ingest",
                    "params": {
                        "path": str(source.parent / "nested" / ".." / source.name),
                        "artifactRoot": str(source.parent / "nested" / ".." / artifacts.name),
                        "allowedPaths": [str(source.resolve())],
                        "allowedRoots": [str(artifacts.resolve())],
                        "options": {"engine": "basic", "ocr": "off"},
                    },
                },
                cwd,
            )

            self.assertEqual(result.returncode, 0, result.stdout.decode("utf-8"))
            response = json.loads(result.stdout.decode("utf-8"))
            self.assertTrue(response["ok"], response)
            self.assertEqual(response["id"], "request-한글")
            self.assertEqual(response["data"]["text"], "AX packaged document smoke 한국어 café")
            artifact_path = Path(response["data"]["artifactPath"]).resolve()
            self.assertTrue(artifact_path.is_relative_to(artifacts.resolve()))
            manifest = json.loads((artifact_path / "manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(manifest["sourcePath"], str(source.resolve()))

    def test_utf8_stdin_keeps_unicode_path_allowlist_enforcement(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "sample 한글.txt"
            source.write_text("AX document smoke", encoding="utf-8")
            artifacts = root / "artifacts 한글"
            cwd = root / "empty-cwd"
            cwd.mkdir()
            result = self._run_worker_with_legacy_stdin(
                {
                    "id": "request-disallowed-한글",
                    "command": "ingest",
                    "params": {
                        "path": str(source),
                        "artifactRoot": str(artifacts),
                        "allowedPaths": [str(root / "other.txt")],
                        "allowedRoots": [str(artifacts)],
                        "options": {"engine": "basic", "ocr": "off"},
                    },
                },
                cwd,
            )

            self.assertEqual(result.returncode, 1)
            response = json.loads(result.stdout.decode("utf-8"))
            self.assertEqual(response["id"], "request-disallowed-한글")
            self.assertFalse(response["ok"])
            self.assertEqual(response["error"], "document_path_not_allowed")
            self.assertFalse(artifacts.exists())

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
