from __future__ import annotations

from pathlib import Path
from typing import Any

from ..primitives import PdfPageGeometry
from .ocr_geometry import _ocr_geometry_fields
from .ocr_text import _ocr_candidate_fields, _ocr_items, _render_page


def _ocr_fields(
    source_path: Path,
    pages: list[PdfPageGeometry],
) -> tuple[list[dict[str, Any]], str | None]:
    try:
        import rapidocr  # noqa: F401
    except ImportError:
        return [], "ocr_unavailable"
    fields: list[dict[str, Any]] = []
    for page in pages:
        try:
            image = _render_page(source_path, page.index)
            items = _ocr_items(image)
            geometry_fields = _ocr_geometry_fields(page, image, items, scale=2.0)
            fields.extend(geometry_fields or _ocr_candidate_fields(page, items, scale=2.0))
        except Exception as error:
            return fields, f"ocr_failed:{type(error).__name__}"
    return fields, None
