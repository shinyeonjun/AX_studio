from __future__ import annotations

from io import BytesIO
from typing import Any, Mapping

from pypdf import PdfReader
from reportlab.pdfgen import canvas

from .fonts import _draw_text
from .placeholders import remove_placeholders
from .primitives import _TRUTHY, _as_float, _as_string
from .template import _value_for_field


def _draw_checkbox(drawing: Any, rect: tuple, value: Any, field_type: str, height: float) -> None:
    if not (value is True or str(value).strip().lower() in _TRUTHY):
        return
    x0, y0, x1, y1 = rect
    drawing.setStrokeColorRGB(0.12, 0.16, 0.21)
    drawing.setFillColorRGB(0.12, 0.16, 0.21)
    if field_type == "radio":
        drawing.circle((x0 + x1) / 2, height - (y0 + y1) / 2,
                       min(x1 - x0, y1 - y0) * 0.28, stroke=1, fill=1)
    else:
        drawing.setLineWidth(1.4)
        drawing.line(x0 + 3, height - y1 + 3, x0 + (x1 - x0) * 0.45, height - y0 - 3)
        drawing.line(x0 + (x1 - x0) * 0.45, height - y0 - 3, x1 - 3, height - y1 + 3)


def _fill_overlay_fields(document: Any, template: Mapping[str, Any], values: Mapping[str, Any],
                         *, font_path: str | None) -> None:
    fields_by_page: dict[int, list[Mapping[str, Any]]] = {}
    for field in template.get("fields") or []:
        if isinstance(field, Mapping):
            fields_by_page.setdefault(int(_as_float(field.get("pageIndex"), -1)), []).append(field)
    for page_index, fields in fields_by_page.items():
        if page_index < 0 or page_index >= len(document.pages):
            raise ValueError(f"field_page_not_found:{page_index}")
        page = document.pages[page_index]
        prepared = []
        for field in fields:
            value = _value_for_field(field, values)
            if value is None or (value == "" and field.get("source") != "digital_placeholder"):
                continue
            raw = field.get("rect")
            if not isinstance(raw, Mapping):
                raise ValueError(f"field_rect_missing:{field.get('name') or field.get('id')}")
            rect = (float(raw["x"]), float(raw["y"]), float(raw["x"]) + float(raw["width"]),
                    float(raw["y"]) + float(raw["height"]))
            if rect[2] <= rect[0] or rect[3] <= rect[1]:
                raise ValueError(f"field_rect_invalid:{field.get('name') or field.get('id')}")
            prepared.append((field, rect, value))
        placeholders = [field for field, _rect, _value in prepared if field.get("source") == "digital_placeholder"]
        if placeholders:
            remove_placeholders(page, document, placeholders)
        if not any(value != "" for _, _, value in prepared):
            continue
        memory = BytesIO()
        width, height = float(page.mediabox.width), float(page.mediabox.height)
        drawing = canvas.Canvas(memory, pagesize=(width, height))
        for field, rect, value in prepared:
            if value == "":
                continue
            field_type = _as_string(field.get("type"))
            if field_type in {"checkbox", "radio"}:
                _draw_checkbox(drawing, rect, value, field_type, height)
            else:
                _draw_text(drawing, rect, field, value, page_height=height, font_path=font_path)
        drawing.showPage()
        drawing.save()
        page.merge_page(PdfReader(memory).pages[0], over=True)
