from __future__ import annotations

from typing import Any, Mapping

from ..primitives import _as_float, _as_string


def _page_geometry_signature(document: Any) -> list[tuple[float, float, int]]:
    signature: list[tuple[float, float, int]] = []
    for page in document.pages:
        mediabox = page.mediabox
        signature.append(
            (
                round(_as_float(mediabox.width), 4),
                round(_as_float(mediabox.height), 4),
                int(_as_float(getattr(page, "rotation", 0))) % 360,
            )
        )
    return signature


def _template_geometry_matches(
    template: Mapping[str, Any],
    page_geometry: list[tuple[float, float, int]],
) -> bool:
    raw_pages = template.get("pages")
    if not isinstance(raw_pages, list) or len(raw_pages) != len(page_geometry):
        return False
    for index, (width, height, rotation) in enumerate(page_geometry):
        raw_page = raw_pages[index]
        if not isinstance(raw_page, Mapping):
            return False
        if int(_as_float(raw_page.get("index"), -1)) != index:
            return False
        if abs(_as_float(raw_page.get("width"), -1.0) - width) > 0.01:
            return False
        if abs(_as_float(raw_page.get("height"), -1.0) - height) > 0.01:
            return False
        if int(_as_float(raw_page.get("rotation"), -1)) % 360 != rotation:
            return False
    return True


def _validate_template_fields(
    fields: list[Mapping[str, Any]],
    page_geometry: list[tuple[float, float, int]],
) -> None:
    seen_ids: set[str] = set()
    for field in fields:
        field_id = _as_string(field.get("id"))
        field_name = _as_string(field.get("name"))
        if not field_id or not field_name or field_id in seen_ids:
            raise ValueError(f"template_field_invalid:{field_id or field_name or 'unknown'}")
        seen_ids.add(field_id)
        page_index = int(_as_float(field.get("pageIndex"), -1))
        raw_rect = field.get("rect")
        if page_index < 0 or page_index >= len(page_geometry) or not isinstance(raw_rect, Mapping):
            raise ValueError(f"template_field_rect_invalid:{field_id}")
        x = _as_float(raw_rect.get("x"), -1.0)
        y = _as_float(raw_rect.get("y"), -1.0)
        width = _as_float(raw_rect.get("width"), -1.0)
        height = _as_float(raw_rect.get("height"), -1.0)
        page_width, page_height, _rotation = page_geometry[page_index]
        if (
            x < 0.0
            or y < 0.0
            or width <= 0.0
            or height <= 0.0
            or x + width > page_width + 0.01
            or y + height > page_height + 0.01
        ):
            raise ValueError(f"template_field_rect_invalid:{field_id}")
