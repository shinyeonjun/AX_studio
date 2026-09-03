from __future__ import annotations

from typing import Any, Mapping

from ..primitives import _TRUTHY, _as_float, _as_string
from ..runtime import _pymupdf, _pymupdf_rect
from .geometry import _render_clip_digest
from .native_values import _fields_for_key, _normalized_match


def _verify_overlay_values(
    document: Any,
    template: Mapping[str, Any],
    values: Mapping[str, Any],
    *,
    source_document: Any | None = None,
) -> None:
    pdf = _pymupdf()
    fields = [field for field in template.get("fields") or [] if isinstance(field, Mapping)]
    for raw_key, expected in values.items():
        if expected is None or expected == "":
            continue
        candidates = _fields_for_key(fields, str(raw_key))
        if not candidates:
            continue
        field = candidates[0]
        page_index = int(_as_float(field.get("pageIndex"), -1))
        raw_rect = field.get("rect")
        if page_index < 0 or page_index >= len(document) or not isinstance(raw_rect, Mapping):
            raise ValueError(f"output_field_verification_failed:{raw_key}")
        rect = _pymupdf_rect(pdf, raw_rect)
        page = document[page_index]
        field_type = _as_string(field.get("type"))
        if field_type in {"checkbox", "radio"}:
            if not (expected is True or _as_string(expected).strip().lower() in _TRUTHY):
                continue
            if source_document is not None:
                source_page = source_document[page_index]
                if _render_clip_digest(source_page, rect, pdf) == _render_clip_digest(page, rect, pdf):
                    raise ValueError(f"output_field_verification_failed:{raw_key}")
                continue
            marked = False
            for drawing in page.get_drawings():
                drawing_rect = drawing.get("rect") if isinstance(drawing, Mapping) else None
                if drawing_rect is not None and drawing_rect.x1 >= rect.x0 and drawing_rect.x0 <= rect.x1 \
                    and drawing_rect.y1 >= rect.y0 and drawing_rect.y0 <= rect.y1:
                    marked = True
                    break
            if not marked:
                raise ValueError(f"output_field_verification_failed:{raw_key}")
            continue
        clip = pdf.Rect(rect.x0 - 2.0, rect.y0 - 2.0, rect.x1 + 2.0, rect.y1 + 2.0)
        output_text = page.get_text("text", clip=clip) or ""
        if _normalized_match(expected) not in _normalized_match(output_text):
            raise ValueError(f"output_field_verification_failed:{raw_key}")
