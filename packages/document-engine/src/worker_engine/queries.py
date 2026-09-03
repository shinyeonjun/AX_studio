from __future__ import annotations

from pathlib import Path

from artifact_store import artifact_dir, load_manifest
from ax_paths import default_document_root
from protocol import EngineRequest, EngineResponse

from .projection import _chunk_by_id, _page_by_index


def handle_document_query(request: EngineRequest) -> EngineResponse:
    artifact_root = Path(str(request.params.get("artifactRoot") or default_document_root()))
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
        if isinstance(page_index, bool):
            return EngineResponse(id=request.id, ok=False, error="page_index_invalid")
        try:
            normalized_page_index = int(page_index)
        except (TypeError, ValueError):
            return EngineResponse(id=request.id, ok=False, error="page_index_invalid")
        if normalized_page_index < 0:
            return EngineResponse(id=request.id, ok=False, error="page_index_invalid")
        manifest = load_manifest(artifact_root, document_id)
        page = _page_by_index(manifest, normalized_page_index)
        if page is None:
            return EngineResponse(id=request.id, ok=False, error="page_not_found")
        page_dir = artifact_dir(artifact_root, document_id) / "pages"
        text_path = page_dir / f"{normalized_page_index}.txt"
        text = text_path.read_text(encoding="utf-8") if text_path.is_file() else None
        chunk_texts = [
            chunk.get("text", "")
            for chunk in manifest.get("chunks") or []
            if chunk.get("pageIndex") == normalized_page_index
        ]
        return EngineResponse(
            id=request.id,
            ok=True,
            data={"page": page, "text": text or "\n".join(chunk_texts).strip() or None},
        )

    if request.command == "search":
        query = str(request.params.get("query") or "").strip().lower()
        if not query:
            return EngineResponse(id=request.id, ok=False, error="query_required")
        manifest = load_manifest(artifact_root, document_id)
        hits = []
        query_terms = [term for term in query.split() if term]
        for chunk in manifest.get("chunks") or []:
            text = str(chunk.get("text") or "")
            lowered = text.lower()
            if query_terms and not all(term in lowered for term in query_terms):
                continue
            overlap = sum(1 for term in query_terms if term in lowered)
            score = overlap / len(query_terms)
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
