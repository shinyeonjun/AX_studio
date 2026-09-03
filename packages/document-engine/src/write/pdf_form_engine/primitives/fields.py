from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable

from .constants import _PLACEHOLDER_RE
from .values import (
    _as_float,
    _as_string,
    _field_id,
    _field_rect,
    _form_field_type,
    _inherited,
    _object,
    _qualified_field_name,
    _widget_export_value,
    _widget_options,
)

@dataclass(frozen=True)
class PdfPageGeometry:
    index: int
    width: float
    height: float
    rotation: int

def _page_geometries(reader: Any) -> list[PdfPageGeometry]:
    pages: list[PdfPageGeometry] = []
    for index, page in enumerate(reader.pages):
        rotation = int(page.get("/Rotate", 0) or 0) % 360
        pages.append(
            PdfPageGeometry(
                index=index,
                width=_as_float(page.mediabox.width),
                height=_as_float(page.mediabox.height),
                rotation=rotation,
            )
        )
    return pages

def _acroform_fields(reader: Any, pages: list[PdfPageGeometry]) -> list[dict[str, Any]]:
    fields: list[dict[str, Any]] = []
    names: dict[str, int] = {}
    for page_index, page in enumerate(reader.pages):
        for annotation in page.get("/Annots") or []:
            widget = _object(annotation)
            if _as_string(widget.get("/Subtype")) != "/Widget":
                continue
            field_name = _qualified_field_name(widget) or f"page_{page_index + 1}_field"
            ordinal = names.get(field_name, 0)
            names[field_name] = ordinal + 1
            rect = _field_rect(widget.get("/Rect"), pages[page_index].height)
            if rect is None:
                continue
            flags = int(_as_float(_inherited(widget, "/Ff")))
            value = _inherited(widget, "/V")
            if value is not None:
                value = _as_string(value).lstrip("/")
            field: dict[str, Any] = {
                "id": _field_id(field_name, page_index, ordinal),
                "name": field_name,
                "label": field_name.rsplit(".", 1)[-1],
                "pageIndex": page_index,
                "rect": rect,
                "type": _form_field_type(widget),
                "source": "acroform",
                "confidence": 1.0,
                "required": bool(flags & 2),
                "multiline": bool(flags & (1 << 12)),
            }
            export_value = _widget_export_value(widget)
            if export_value:
                field["exportValue"] = export_value
            options = _widget_options(widget)
            if options:
                field["options"] = options
            if value not in (None, ""):
                field["originalValue"] = value
            fields.append(field)
    return fields

def _union_boxes(boxes: Iterable[tuple[float, float, float, float]]) -> tuple[float, float, float, float] | None:
    values = list(boxes)
    if not values:
        return None
    return (
        min(item[0] for item in values),
        min(item[1] for item in values),
        max(item[2] for item in values),
        max(item[3] for item in values),
    )

def _placeholder_fields_from_text(
    text: str,
    char_boxes: list[tuple[float, float, float, float] | None],
    page: PdfPageGeometry,
    *,
    source: str,
    confidence: float,
) -> list[dict[str, Any]]:
    fields: list[dict[str, Any]] = []
    for ordinal, match in enumerate(_PLACEHOLDER_RE.finditer(text)):
        name = (match.group(1) or match.group(2) or "field").strip()
        box = _union_boxes(
            box
            for box in char_boxes[match.start() : match.end()]
            if box is not None
        )
        if box is None:
            continue
        x0, y0, x1, y1 = box
        rect = {
            "x": min(x0, x1),
            "y": page.height - max(y0, y1),
            "width": max(abs(x1 - x0), 24.0),
            "height": max(abs(y1 - y0) + 6.0, 18.0),
        }
        fields.append(
            {
                "id": _field_id(name, page.index, ordinal),
                "name": name,
                "label": name,
                "pageIndex": page.index,
                "rect": rect,
                "type": "text",
                "source": source,
                "confidence": confidence,
                "required": False,
                "multiline": False,
            }
        )
    return fields
