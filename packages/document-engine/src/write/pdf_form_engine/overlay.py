from __future__ import annotations

from typing import Any, Mapping

from .fonts import _insert_textbox
from .primitives import _TRUTHY, _as_float, _as_string
from .runtime import _pymupdf, _pymupdf_rect
from .template import _value_for_field

def _draw_checkbox(page: Any, pdf: Any, rect: Any, value: Any, field_type: str) -> None:
    if not (value is True or str(value).strip().lower() in _TRUTHY):
        return
    color = (0.12, 0.16, 0.21)
    if field_type == "radio":
        center = pdf.Point((rect.x0 + rect.x1) / 2.0, (rect.y0 + rect.y1) / 2.0)
        radius = max(min(float(rect.width), float(rect.height)) * 0.28, 2.0)
        page.draw_circle(center, radius, color=color, fill=color, width=0.8, overlay=True)
        return
    page.draw_line(
        pdf.Point(rect.x0 + 3.0, rect.y1 - 3.0),
        pdf.Point(rect.x0 + rect.width * 0.45, rect.y0 + 3.0),
        color=color,
        width=1.4,
        overlay=True,
    )
    page.draw_line(
        pdf.Point(rect.x0 + rect.width * 0.45, rect.y0 + 3.0),
        pdf.Point(rect.x1 - 3.0, rect.y1 - 3.0),
        color=color,
        width=1.4,
        overlay=True,
    )

def _fill_overlay_fields(
    document: Any,
    template: Mapping[str, Any],
    values: Mapping[str, Any],
    *,
    font_path: str | None,
) -> None:
    pdf = _pymupdf()
    fields_by_page: dict[int, list[Mapping[str, Any]]] = {}
    for field in template.get("fields") or []:
        if isinstance(field, Mapping):
            page_index = int(_as_float(field.get("pageIndex"), -1))
            fields_by_page.setdefault(page_index, []).append(field)

    for page_index, fields in fields_by_page.items():
        if page_index < 0 or page_index >= len(document):
            raise ValueError(f"field_page_not_found:{page_index}")
        page = document[page_index]
        prepared: list[tuple[Mapping[str, Any], Any, Any]] = []
        for field in fields:
            value = _value_for_field(field, values)
            if value is None or value == "":
                continue
            raw_rect = field.get("rect")
            if not isinstance(raw_rect, Mapping):
                raise ValueError(f"field_rect_missing:{_as_string(field.get('name') or field.get('id'))}")
            rect = _pymupdf_rect(pdf, raw_rect)
            if rect.is_empty or rect.width <= 0 or rect.height <= 0:
                raise ValueError(f"field_rect_invalid:{_as_string(field.get('name') or field.get('id'))}")
            prepared.append((field, rect, value))

        # Placeholder text is part of the source PDF's text layer, so drawing
        # over it would leave the token visible in extraction and often in the
        # rendered result. Remove only that text layer region while preserving
        # vector lines/backgrounds, then reload the page before drawing.
        placeholders = [
            rect
            for field, rect, _value in prepared
            if _as_string(field.get("source")) == "digital_placeholder"
        ]
        if placeholders:
            for rect in placeholders:
                page.add_redact_annot(rect, fill=None, cross_out=False)
            page.apply_redactions(images=0, graphics=0, text=0)
            page = document.reload_page(page)

        for field, rect, value in prepared:
            field_type = _as_string(field.get("type"))
            if field_type in {"checkbox", "radio"}:
                _draw_checkbox(page, pdf, rect, value, field_type)
            else:
                _insert_textbox(page, pdf, rect, field, value, font_path=font_path)
