from __future__ import annotations

from typing import Any, Mapping

from .primitives import _TRUTHY, _as_float, _as_string
from .runtime import _pymupdf, _pymupdf_rect

def _native_field_distance(pdf: Any, field: Mapping[str, Any], widget: Any) -> float:
    raw_rect = field.get("rect")
    widget_rect = getattr(widget, "rect", None)
    if not isinstance(raw_rect, Mapping) or widget_rect is None:
        return float("inf")
    rect = _pymupdf_rect(pdf, raw_rect)
    return (
        abs(rect.x0 - widget_rect.x0)
        + abs(rect.y0 - widget_rect.y0)
        + abs(rect.x1 - widget_rect.x1)
        + abs(rect.y1 - widget_rect.y1)
    )

def _native_widget_assignments(
    document: Any,
    template: Mapping[str, Any],
) -> list[tuple[int, Any, Any, Mapping[str, Any]]]:
    """Associate each source AcroForm widget with one analyzed field.

    Radio buttons share a field name, so matching by name alone is unsafe. A
    stable one-to-one assignment by page, name, and rectangle lets an id-based
    request address exactly one widget while still allowing a name-based radio
    value such as ``"low"`` to select the matching export value.
    """
    pdf = _pymupdf()
    fields_by_group: dict[tuple[int, str], list[Mapping[str, Any]]] = {}
    for field in template.get("fields") or []:
        if not isinstance(field, Mapping) or _as_string(field.get("source")) != "acroform":
            continue
        page_index = int(_as_float(field.get("pageIndex"), -1))
        name = _as_string(field.get("name"))
        if page_index >= 0 and name:
            fields_by_group.setdefault((page_index, name), []).append(field)

    widgets_by_group: dict[tuple[int, str], list[tuple[Any, Any]]] = {}
    for page_index in range(len(document)):
        page = document[page_index]
        for widget in list(page.widgets() or []):
            name = _as_string(getattr(widget, "field_name", ""))
            if name:
                # Keep the page alive with the widget. PyMuPDF widget methods
                # use a weak page reference and otherwise fail at update().
                widgets_by_group.setdefault((page_index, name), []).append((page, widget))

    assignments: list[tuple[int, Any, Any, Mapping[str, Any]]] = []
    for group, fields in fields_by_group.items():
        page_index, _name = group
        widgets = widgets_by_group.get(group) or []
        pairs = sorted(
            (
                _native_field_distance(pdf, field, widget),
                widget_index,
                field_index,
            )
            for widget_index, (_page, widget) in enumerate(widgets)
            for field_index, field in enumerate(fields)
        )
        used_widgets: set[int] = set()
        used_fields: set[int] = set()
        for _distance, widget_index, field_index in pairs:
            if widget_index in used_widgets or field_index in used_fields:
                continue
            used_widgets.add(widget_index)
            used_fields.add(field_index)
            page, widget = widgets[widget_index]
            assignments.append((page_index, page, widget, fields[field_index]))
    return assignments

def _radio_selected(
    field: Mapping[str, Any],
    value: Any,
    candidates: list[Mapping[str, Any]],
    *,
    value_key: str,
) -> bool:
    if value_key == "name":
        if isinstance(value, bool):
            return value and field is candidates[0]
        normalized = _as_string(value).strip().lstrip("/").casefold()
        if normalized in _TRUTHY:
            return field is candidates[0]
        export_value = _as_string(field.get("exportValue")).strip().lstrip("/").casefold()
        return bool(export_value) and normalized == export_value
    if value is True or _as_string(value).strip().lower() in _TRUTHY:
        return True
    normalized = _as_string(value).strip().lstrip("/").casefold()
    export_value = _as_string(field.get("exportValue")).strip().lstrip("/").casefold()
    return bool(export_value) and normalized == export_value

def _fill_native_widgets(
    document: Any,
    template: Mapping[str, Any],
    values: Mapping[str, Any],
) -> int:
    assignments = _native_widget_assignments(document, template)
    requested_keys = {
        str(key)
        for key, value in values.items()
        if value is not None
    }
    radio_groups: dict[tuple[int, str], list[Mapping[str, Any]]] = {}
    for page_index, _page, _widget, field in assignments:
        if _as_string(field.get("type")) == "radio":
            radio_groups.setdefault((page_index, _as_string(field.get("name"))), []).append(field)
    radio_id_groups = {
        group
        for group, fields in radio_groups.items()
        if any(_as_string(field.get("id")) in values for field in fields)
    }
    updated = 0
    applied_keys: set[str] = set()
    operations: list[tuple[int, Any, Any, Mapping[str, Any], Any, str | None]] = []
    for page_index, _page, widget, field in assignments:
        field_id = _as_string(field.get("id"))
        field_name = _as_string(field.get("name"))
        field_type = _as_string(field.get("type"))
        group = (page_index, field_name)
        value_key: str | None = None
        value: Any = None
        should_apply = False
        if field_type == "radio" and group in radio_id_groups:
            # An id-addressed radio choice owns the whole group: clear every
            # other widget so a previously selected option cannot survive.
            if field_id in values:
                value = values[field_id]
                value_key = field_id
            else:
                value = False
            should_apply = True
        elif field_id in values:
            value = values[field_id]
            value_key = field_id
            should_apply = value is not None
        elif field_name in values:
            value = values[field_name]
            value_key = field_name
            should_apply = value is not None
        if not should_apply:
            continue
        operations.append((page_index, _page, widget, field, value, value_key))

    def operation_is_selected(operation: tuple[int, Any, Any, Mapping[str, Any], Any, str | None]) -> bool:
        page_index, _page, _widget, field, value, value_key = operation
        if _as_string(field.get("type")) != "radio":
            return False
        group = (page_index, _as_string(field.get("name")))
        candidates = radio_groups.get(group) or [field]
        field_id = _as_string(field.get("id"))
        return _radio_selected(
            field,
            value,
            candidates,
            value_key="id" if value_key == field_id else "name",
        )

    # PDF radio groups may reset the group value when an unselected widget is
    # updated after the selected widget. Apply off states first, then on.
    operations.sort(key=lambda operation: 1 if operation_is_selected(operation) else 0)
    for page_index, _page, widget, field, value, value_key in operations:
        field_id = _as_string(field.get("id"))
        field_type = _as_string(field.get("type"))
        group = (page_index, _as_string(field.get("name")))
        if field_type == "checkbox":
            if value is True or _as_string(value).strip().lower() in _TRUTHY:
                on_state = getattr(widget, "on_state", None)
                widget.field_value = on_state() if callable(on_state) else True
            else:
                widget.field_value = False
        elif field_type == "radio":
            candidates = radio_groups.get(group) or [field]
            on_state = getattr(widget, "on_state", None)
            if _radio_selected(field, value, candidates, value_key="id" if value_key == field_id else "name"):
                widget.field_value = on_state() if callable(on_state) else True
            else:
                widget.field_value = False
        else:
            widget.field_value = value if isinstance(value, list) else _as_string(value)
        widget.update()
        updated += 1
        if value_key:
            applied_keys.add(value_key)
    missing = sorted(requested_keys - applied_keys)
    if missing:
        raise ValueError(f"native_fields_not_applied:{','.join(missing)}")
    return updated
