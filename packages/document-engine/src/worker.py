from __future__ import annotations

import json
import sys
import traceback
from pathlib import Path
from typing import Any

from adapters import resolve_adapter
from artifact_store import artifact_dir, load_manifest, manifest_exists, sha256_file
from ingest_options import cache_usable, normalize_ocr
from protocol import EngineRequest, EngineResponse


def _configure_stdio() -> None:
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if callable(reconfigure):
            try:
                reconfigure(encoding="utf-8", errors="replace")
            except Exception:
                pass


def _write_json_response(response: EngineResponse) -> None:
    payload = json.dumps(response.to_dict(), ensure_ascii=False)
    if hasattr(sys.stdout, "buffer"):
        sys.stdout.buffer.write(payload.encode("utf-8"))
        sys.stdout.buffer.flush()
        return
    sys.stdout.write(payload)
    sys.stdout.flush()


def _chunk_by_id(manifest: dict[str, Any], chunk_id: str) -> dict[str, Any] | None:
    for chunk in manifest.get("chunks") or []:
        if chunk.get("id") == chunk_id:
            return chunk
    return None


def _page_by_index(manifest: dict[str, Any], page_index: int) -> dict[str, Any] | None:
    for page in manifest.get("pages") or []:
        if page.get("index") == page_index:
            return page
    return None


def _manifest_text(manifest: dict[str, Any]) -> str:
    return "\n\n".join(
        str(chunk.get("text") or "")
        for chunk in (manifest.get("chunks") or [])
    ).strip()


def _ingest_response_data(
    document_id: str,
    artifact_root: Path,
    manifest: dict[str, Any],
    *,
    cached: bool = False,
) -> dict[str, Any]:
    summary = manifest.get("summary") or {}
    data: dict[str, Any] = {
        "documentId": document_id,
        "artifactPath": str(artifact_dir(artifact_root, document_id)),
        "engine": manifest.get("engine") or summary.get("engine"),
        "summary": summary,
        "text": _manifest_text(manifest),
        "pages": manifest.get("pages") or [],
        "images": manifest.get("images") or [],
        "tables": manifest.get("tables") or [],
    }
    if cached:
        data["cached"] = True
    return data


def handle_request(request: EngineRequest) -> EngineResponse:
    try:
        if request.command == "ping":
            return EngineResponse(id=request.id, ok=True, data={"engine": "document-engine", "version": 1})

        if request.command == "ingest":
            source = request.params.get("path")
            if not source:
                return EngineResponse(id=request.id, ok=False, error="path_required")
            source_path = Path(str(source))
            if not source_path.is_file():
                return EngineResponse(id=request.id, ok=False, error="file_not_found")

            artifact_root = Path(str(request.params.get("artifactRoot") or ".ax-studio/documents"))
            document_id = sha256_file(source_path)
            options = dict(request.params.get("options") or {})
            engine = str(options.get("engine") or "auto")
            ocr_mode = normalize_ocr(options.get("ocr"))
            options["ocr"] = ocr_mode
            adapter = resolve_adapter(engine)
            if manifest_exists(artifact_root, document_id):
                manifest = load_manifest(artifact_root, document_id)
                if cache_usable(
                    manifest,
                    requested_engine=engine,
                    requested_ocr=ocr_mode,
                    resolved_engine=adapter.name,
                ):
                    return EngineResponse(
                        id=request.id,
                        ok=True,
                        data=_ingest_response_data(document_id, artifact_root, manifest, cached=True),
                    )
            try:
                result = adapter.ingest(source_path, artifact_root, options)
            except Exception:
                if engine != "auto" or adapter.name == "basic":
                    raise
                from adapters.basic import BasicAdapter

                result = BasicAdapter().ingest(source_path, artifact_root, options)
            return EngineResponse(
                id=request.id,
                ok=True,
                data=_ingest_response_data(result.document_id, artifact_root, result.manifest),
            )

        artifact_root = Path(str(request.params.get("artifactRoot") or ".ax-studio/documents"))
        document_id = str(request.params.get("documentId") or "")
        if not document_id:
            return EngineResponse(id=request.id, ok=False, error="document_id_required")

        if request.command == "get_chunk":
            chunk_id = str(request.params.get("chunkId") or "")
            if not chunk_id:
                return EngineResponse(id=request.id, ok=False, error="chunk_id_required")
            manifest = load_manifest(artifact_root, document_id)
            chunk = _chunk_by_id(manifest, chunk_id)
            if chunk is None:
                return EngineResponse(id=request.id, ok=False, error="chunk_not_found")
            return EngineResponse(id=request.id, ok=True, data={"chunk": chunk})

        if request.command == "get_page":
            page_index = request.params.get("pageIndex")
            if page_index is None:
                return EngineResponse(id=request.id, ok=False, error="page_index_required")
            manifest = load_manifest(artifact_root, document_id)
            page = _page_by_index(manifest, int(page_index))
            if page is None:
                return EngineResponse(id=request.id, ok=False, error="page_not_found")
            page_dir = artifact_dir(artifact_root, document_id) / "pages"
            text_path = page_dir / f"{int(page_index)}.txt"
            text = text_path.read_text(encoding="utf-8") if text_path.is_file() else None
            chunk_texts = [
                chunk.get("text", "")
                for chunk in manifest.get("chunks") or []
                if chunk.get("pageIndex") == int(page_index)
            ]
            return EngineResponse(
                id=request.id,
                ok=True,
                data={"page": page, "text": text or "\n".join(chunk_texts).strip() or None},
            )

        if request.command == "search":
            query = str(request.params.get("query") or "").strip().lower()
            manifest = load_manifest(artifact_root, document_id)
            hits = []
            query_terms = [term for term in query.split() if term]
            for chunk in manifest.get("chunks") or []:
                text = str(chunk.get("text") or "")
                lowered = text.lower()
                if query_terms and not all(term in lowered for term in query_terms):
                    continue
                overlap = sum(1 for term in query_terms if term in lowered)
                score = overlap / len(query_terms) if query_terms else 0.0
                hits.append(
                    {
                        "chunkId": chunk.get("id"),
                        "pageIndex": chunk.get("pageIndex"),
                        "snippet": text[:240],
                        "score": round(score, 3),
                    }
                )
            hits.sort(key=lambda item: item["score"], reverse=True)
            return EngineResponse(id=request.id, ok=True, data={"hits": hits})

        return EngineResponse(id=request.id, ok=False, error=f"unknown_command:{request.command}")
    except FileNotFoundError as error:
        return EngineResponse(id=request.id, ok=False, error=str(error))
    except Exception as error:
        traceback.print_exc(file=sys.stderr)
        return EngineResponse(id=request.id, ok=False, error=str(error))


def main() -> None:
    _configure_stdio()
    raw = sys.stdin.read()
    if not raw.strip():
        response = EngineResponse(id="", ok=False, error="empty_request")
        _write_json_response(response)
        sys.exit(1)

    payload = json.loads(raw)
    request = EngineRequest.from_dict(payload)
    response = handle_request(request)
    _write_json_response(response)
    sys.exit(0 if response.ok else 1)


if __name__ == "__main__":
    main()
