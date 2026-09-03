from __future__ import annotations

import re
from typing import Any, Mapping

from ..native import _native_widget_assignments, _radio_selected
from ..primitives import _TRUTHY, _as_string
from ..runtime import _pymupdf


def _widget_value_is_on(widget: Any) -> bool:
    value = getattr(widget, "field_value", None)
    if value is True:
        return True
    normalized = _as_string(value).strip().lstrip("/").casefold()
    return bool(normalized) and normalized not in {"off", "false", "0", "none"}


def _normalized_match(value: Any) -> str:
    return re.sub(r"\s+", " ", _as_string(value)).strip().casefold()


def _normalized_values(value: Any) -> tuple[str, ...]:
    if isinstance(value, (list, tuple)):
        return tuple(_normalized_match(item) for item in value)
    return (_normalized_match(value),)


def _values_match(actual: Any, expected: Any) -> bool:
    return _normalized_values(actual) == _normalized_values(expected)


def _verify_native_rendered_text(
    document: Any,
    page_index: int,
    widget: Any,
    expected: Any,
    key: str,
) -> None:
    expected_values = expected if isinstance(expected, (list, tuple)) else [expected]
    expected_texts = [
        _normalized_match(value)
        for value in expected_values
        if _normalized_match(value)
    ]
    if not expected_texts:
        return
    rect = getattr(widget, "rect", None)
    if rect is None:
        raise ValueError(f"output_text_render_verification_failed:{key}")
    pdf = _pymupdf()
    clip = pdf.Rect(
        max(0.0, rect.x0 - 2.0),
        max(0.0, rect.y0 - 2.0),
        rect.x1 + 2.0,
        rect.y1 + 2.0,
    )
    rendered = _normalized_match(document[page_index].get_text("text", clip=clip) or "")
    if any(expected_text not in rendered for expected_text in expected_texts):
        raise ValueError(f"output_text_render_verification_failed:{key}")


def _fields_for_key(
    fields: list[Mapping[str, Any]],
    key: str,
) -> list[Mapping[str, Any]]:
    by_id = [field for field in fields if _as_string(field.get("id")) == key]
    return by_id or [field for field in fields if _as_string(field.get("name")) == key]


def _verify_native_values(
    document: Any,
    template: Mapping[str, Any],
    values: Mapping[str, Any],
) -> None:
    assignments = _native_widget_assignments(document, template)
    fields = [
        field
        for field in template.get("fields") or []
        if isinstance(field, Mapping) and _as_string(field.get("source")) == "acroform"
    ]
    by_id: dict[str, tuple[int, Any, Mapping[str, Any]]] = {}
    by_name: dict[str, list[tuple[int, Any, Mapping[str, Any]]]] = {}
    for page_index, _page, widget, field in assignments:
        field_id = _as_string(field.get("id"))
        field_name = _as_string(field.get("name"))
        if field_id:
            by_id[field_id] = (page_index, widget, field)
        if field_name:
            by_name.setdefault(field_name, []).append((page_index, widget, field))

    for raw_key, expected in values.items():
        if expected is None:
            continue
        key = str(raw_key)
        candidates = _fields_for_key(fields, key)
        if not candidates:
            continue
        field_type = _as_string(candidates[0].get("type"))
        field_name = _as_string(candidates[0].get("name"))
        group_assignments = by_name.get(field_name) or []
        if not group_assignments:
            raise ValueError(f"output_field_verification_failed:{key}")

        if field_type == "radio":
            requested_by_id = any(_as_string(field.get("id")) == key for field in candidates)
            if requested_by_id:
                target = by_id.get(key)
                if target is None:
                    raise ValueError(f"output_field_verification_failed:{key}")
                _page_index, widget, target_field = target
                if _widget_value_is_on(widget) != _radio_selected(
                    target_field,
                    expected,
                    [target_field],
                    value_key="id",
                ):
                    raise ValueError(f"output_field_verification_failed:{key}")
                continue

            normalized_expected = _normalized_match(expected)
            if expected is False or normalized_expected in {"false", "off", "0", "no", "n"}:
                selected = not any(_widget_value_is_on(widget) for _, widget, _field in group_assignments)
            elif isinstance(expected, bool) or normalized_expected in _TRUTHY:
                selected = any(_widget_value_is_on(widget) for _, widget, _field in group_assignments)
            else:
                selected = any(
                    _widget_value_is_on(widget)
                    and (
                        _normalized_match(field.get("exportValue")) == normalized_expected
                        or _normalized_match(getattr(widget, "field_value", "")) == normalized_expected
                    )
                    for _, widget, field in group_assignments
                )
            if not selected:
                raise ValueError(f"output_field_verification_failed:{key}")
            continue

        target_assignments = [
            assignment
            for assignment in group_assignments
            if any(assignment[2] is candidate for candidate in candidates)
        ]
        if not target_assignments:
            raise ValueError(f"output_field_verification_failed:{key}")
        if len(target_assignments) > 1 and field_type not in {"checkbox", "radio"}:
            for page_index, widget, _field in target_assignments:
                if not _values_match(getattr(widget, "field_value", ""), expected):
                    raise ValueError(f"output_field_verification_failed:{key}")
                _verify_native_rendered_text(document, page_index, widget, expected, key)
            continue
        _page_index, target, _target_field = target_assignments[0]
        if field_type == "checkbox":
            expected_on = expected is True or _as_string(expected).strip().lower() in _TRUTHY
            if _widget_value_is_on(target) != expected_on:
                raise ValueError(f"output_field_verification_failed:{key}")
        elif not _values_match(getattr(target, "field_value", ""), expected):
            raise ValueError(f"output_field_verification_failed:{key}")
        elif field_type in {"text", "textarea", "date", "number", "select"}:
            _verify_native_rendered_text(document, _page_index, target, expected, key)
