from __future__ import annotations

from typing import Any, Mapping

from ..primitives import PdfPageGeometry, _as_float, _as_string, _field_id


def _normalize_hint(
    hint: Mapping[str, Any],
    pages: list[PdfPageGeometry],
    ordinal: int,
) -> dict[str, Any] | None:
    try:
        page_index = int(hint.get("pageIndex", 0))
    except (TypeError, ValueError):
        return None
    if page_index < 0 or page_index >= len(pages):
        return None
    raw_rect = hint.get("rect")
    if isinstance(raw_rect, Mapping):
        x = _as_float(raw_rect.get("x"))
        y = _as_float(raw_rect.get("y"))
        width = _as_float(raw_rect.get("width"))
        height = _as_float(raw_rect.get("height"))
    elif isinstance(raw_rect, (list, tuple)) and len(raw_rect) >= 4:
        x, y, width, height = (_as_float(value) for value in raw_rect[:4])
    else:
        return None
    if width <= 0 or height <= 0 or x < 0 or y < 0:
        return None
    if x + width > pages[page_index].width + 0.5 or y + height > pages[page_index].height + 0.5:
        return None
    name = _as_string(hint.get("name") or hint.get("label") or f"field_{ordinal + 1}").strip()
    if not name:
        return None
    field_type = _as_string(hint.get("type") or "text")
    if field_type not in {"text", "textarea", "date", "number", "checkbox", "radio", "select"}:
        field_type = "text"
    return {
        "id": _as_string(hint.get("id") or _field_id(name, page_index, ordinal)),
        "name": name,
        "label": _as_string(hint.get("label") or name),
        "pageIndex": page_index,
        "rect": {"x": x, "y": y, "width": width, "height": height},
        "type": field_type,
        "source": "layout_hint",
        "confidence": min(max(_as_float(hint.get("confidence"), 0.7), 0.0), 1.0),
        "required": bool(hint.get("required", False)),
        "multiline": bool(hint.get("multiline", field_type == "textarea")),
    }
