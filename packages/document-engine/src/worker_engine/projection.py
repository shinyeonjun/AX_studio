from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from artifact_store import artifact_dir

# Leave headroom below the stdio response cap for JSON escaping and metadata.
INGEST_RESPONSE_BUDGET_BYTES = 5 * 1024 * 1024
_FIELD_CHAR_CAP = 20_000


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


def _payload_bytes(data: dict[str, Any]) -> int:
    return len(json.dumps(data, ensure_ascii=False).encode("utf-8"))


def _truncate_text_fields(items: list[Any], key: str, cap: int) -> bool:
    changed = False
    for item in items:
        if isinstance(item, dict) and isinstance(item.get(key), str) and len(item[key]) > cap:
            item[key] = item[key][:cap]
            item[f"{key}Truncated"] = True
            changed = True
    return changed


def _bound_ingest_payload(data: dict[str, Any]) -> None:
    """Shrink an oversized ingest response in place instead of failing every retry.

    The manifest is cached, so an oversized response would otherwise fail
    permanently. Steps: drop the top-level text when pages already carry it
    (Docling duplicates page text there), then cap long per-page/OCR/table text.
    """
    if _payload_bytes(data) <= INGEST_RESPONSE_BUDGET_BYTES:
        return
    pages = [page for page in data.get("pages") or [] if isinstance(page, dict)]
    if data.get("text") and any(isinstance(page.get("text"), str) and page["text"].strip() for page in pages):
        data["text"] = ""
        data["textOmitted"] = True
        if _payload_bytes(data) <= INGEST_RESPONSE_BUDGET_BYTES:
            return
    cap = _FIELD_CHAR_CAP
    while cap >= 500:
        changed = _truncate_text_fields(data.get("pages") or [], "text", cap)
        changed = _truncate_text_fields(data.get("images") or [], "ocrText", cap) or changed
        changed = _truncate_text_fields(data.get("tables") or [], "text", cap) or changed
        if isinstance(data.get("text"), str) and len(data["text"]) > cap * 10:
            data["text"] = data["text"][: cap * 10]
            data["textTruncated"] = True
            changed = True
        if changed:
            data["truncated"] = True
        if _payload_bytes(data) <= INGEST_RESPONSE_BUDGET_BYTES:
            return
        cap //= 4


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
        # Shallow copies: bounding may truncate fields without touching the manifest.
        "pages": [dict(item) if isinstance(item, dict) else item for item in manifest.get("pages") or []],
        "images": [dict(item) if isinstance(item, dict) else item for item in manifest.get("images") or []],
        "tables": [dict(item) if isinstance(item, dict) else item for item in manifest.get("tables") or []],
    }
    _bound_ingest_payload(data)
    if cached:
        data["cached"] = True
    fallback_from = manifest.get("fallbackFrom")
    if isinstance(fallback_from, str) and fallback_from:
        data["fallbackFrom"] = fallback_from
    return data
