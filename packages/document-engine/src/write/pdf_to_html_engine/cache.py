from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from artifact_store import artifact_dir
from parser_config import parser_cache_fingerprint

from .contracts import _PDF_HTML_FORMAT_VERSION


def _template_dir(template_root: Path, template_id: str) -> Path:
    return artifact_dir(template_root, template_id)


def _load_meta(meta_path: Path) -> dict[str, Any] | None:
    if not meta_path.is_file():
        return None
    try:
        return json.loads(meta_path.read_text(encoding="utf-8"))
    except Exception:
        return None


def _meta_usable(meta: dict[str, Any], *, source_hash: str, engine: str, ocr_mode: str) -> bool:
    if meta.get("sourceHash") != source_hash:
        return False
    if meta.get("engine") != engine:
        return False
    if meta.get("ocrMode") != ocr_mode:
        return False
    if engine == "docling" and meta.get("htmlFormatVersion") != _PDF_HTML_FORMAT_VERSION:
        return False
    fingerprint = parser_cache_fingerprint()
    for key, value in fingerprint.items():
        if meta.get(key) != value:
            return False
    html_path = Path(str(meta.get("htmlPath") or ""))
    return html_path.is_file()
