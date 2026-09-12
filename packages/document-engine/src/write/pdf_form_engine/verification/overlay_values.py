from __future__ import annotations

from typing import Any, Mapping

from ...pdf_read import page_text, render_region
from ..primitives import _TRUTHY, _as_float, _as_string
from ..template import _value_for_field
from .native_values import _normalized_match


def _verify_overlay_values(document: Any, template: Mapping[str, Any], values: Mapping[str, Any],
                           *, source_document: Any, page_geometry: list[tuple[float, float, int]]) -> None:
    # Check every occurrence, including repeated names addressed by one key.
    for field in template.get("fields") or []:
        if not isinstance(field, Mapping):
            continue
        expected = _value_for_field(field, values)
        if expected is None or (expected == "" and field.get("source") != "digital_placeholder"):
            continue
        key = str(field.get("id") or field.get("name"))
        index = int(_as_float(field.get("pageIndex"), -1))
        raw = field.get("rect")
        if index < 0 or index >= len(document) or not isinstance(raw, Mapping):
            raise ValueError(f"output_field_verification_failed:{key}")
        rect = (float(raw["x"]), float(raw["y"]), float(raw["x"]) + float(raw["width"]),
                float(raw["y"]) + float(raw["height"]))
        page = document[index]
        try:
            if field.get("type") in {"checkbox", "radio"}:
                if expected is True or _as_string(expected).strip().lower() in _TRUTHY:
                    source = source_document[index]
                    try:
                        if render_region(source, rect, page_geometry[index]) == render_region(page, rect, page_geometry[index]):
                            raise ValueError(f"output_field_verification_failed:{key}")
                    finally:
                        source.close()
                continue
            clip = (rect[0] - 2, rect[1] - 2, rect[2] + 2, rect[3] + 2)
            output_text = page_text(page, clip, height=page_geometry[index][1])
            if expected == "" and _normalized_match(output_text):
                raise ValueError(f"output_field_verification_failed:{key}")
            if _normalized_match(expected) not in _normalized_match(output_text):
                raise ValueError(f"output_field_verification_failed:{key}")
        finally:
            page.close()
