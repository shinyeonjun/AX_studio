from __future__ import annotations

from typing import Any

from parser_config import parser_cache_fingerprint


def normalize_ocr(value: Any) -> str:
    if value is True:
        return "force"
    if value is False:
        return "off"
    if value is None:
        return "auto"
    text = str(value).strip().lower()
    if text in {"", "auto"}:
        return "auto"
    if text in {"off", "false", "0", "none"}:
        return "off"
    if text in {"force", "on", "true", "1", "full"}:
        return "force"
    raise ValueError(f"unsupported_ocr:{value}")


def cache_usable(
    manifest: dict[str, Any],
    *,
    requested_engine: str,
    requested_ocr: str,
    resolved_engine: str,
) -> bool:
    stored_engine = str(manifest.get("engine") or "")
    stored_ocr = str(manifest.get("ocrMode") or "")
    if not stored_engine or not stored_ocr:
        return False
    if stored_engine != resolved_engine:
        return False
    if requested_engine not in {"auto", stored_engine}:
        return False
    if stored_ocr != requested_ocr:
        return False

    expected = parser_cache_fingerprint()
    for key, value in expected.items():
        if str(manifest.get(key) or "") != value:
            return False
    return True
