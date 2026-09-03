from __future__ import annotations

from pathlib import Path
from typing import Any

from artifact_store import artifact_dir


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
    fallback_from = manifest.get("fallbackFrom")
    if isinstance(fallback_from, str) and fallback_from:
        data["fallbackFrom"] = fallback_from
    return data
