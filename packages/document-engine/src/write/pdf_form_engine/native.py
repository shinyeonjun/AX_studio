from __future__ import annotations

from typing import Any, Mapping

from .primitives import _TRUTHY, _as_float, _as_string
from .widgets import FormWidget
from .primitives import _object

def _native_field_distance(field: Mapping[str, Any], widget: FormWidget) -> float:
    raw = field.get("rect")
    if not isinstance(raw, Mapping):
        return float("inf")
    rect = (float(raw["x"]), float(raw["y"]), float(raw["x"]) + float(raw["width"]),
            float(raw["y"]) + float(raw["height"]))
    return sum(abs(a - b) for a, b in zip(rect, widget.rect))


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
    fields_by_group: dict[tuple[int, str], list[Mapping[str, Any]]] = {}
    for field in template.get("fields") or []:
        if not isinstance(field, Mapping) or _as_string(field.get("source")) != "acroform":
            continue
        page_index = int(_as_float(field.get("pageIndex"), -1))
        name = _as_string(field.get("name"))
        if page_index >= 0 and name:
            fields_by_group.setdefault((page_index, name), []).append(field)

    widgets_by_group: dict[tuple[int, str], list[tuple[Any, Any]]] = {}
    for page_index in range(len(document.pages)):
        page = document.pages[page_index]
        for reference in page.get("/Annots") or []:
            raw = _object(reference)
            if raw.get("/Subtype") != "/Widget":
                continue
            widget = FormWidget(raw, float(page.mediabox.height))
            if widget.field_name:
                widgets_by_group.setdefault((page_index, widget.field_name), []).append((page, widget))

    assignments: list[tuple[int, Any, Any, Mapping[str, Any]]] = []
    for group, fields in fields_by_group.items():
        page_index, _name = group
        widgets = widgets_by_group.get(group) or []
        pairs = sorted(
            (
                _native_field_distance(field, widget),
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
    *, font_path: str | None = None,
) -> int:
    assignments = _native_widget_assignments(document, template)
    requested_keys = {
        str(key)
        for key, value in values.items()
        if value is not None
    }
    radio_groups: dict[str, list[Mapping[str, Any]]] = {}
    for page_index, _page, _widget, field in assignments:
        if _as_string(field.get("type")) == "radio":
            radio_groups.setdefault(_as_string(field.get("name")), []).append(field)
    radio_id_groups = {
        group
        for group, fields in radio_groups.items()
        if any(values.get(_as_string(field.get("id"))) is not None for field in fields)
    }
    updated = 0
    applied_keys: set[str] = set()
    operations: list[tuple[int, Any, Any, Mapping[str, Any], Any, str | None]] = []
    for page_index, _page, widget, field in assignments:
        field_id = _as_string(field.get("id"))
        field_name = _as_string(field.get("name"))
        field_type = _as_string(field.get("type"))
        group = field_name
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

    # A terminal field has one canonical value even when it has widgets on
    # several pages. Addressing one widget must update all its appearances.
    canonical_values: dict[int, tuple[Any, str | None]] = {}
    for _index, _page, widget, field, value, key in operations:
        if field.get("type") == "radio":
            continue
        identity = id(widget.canonical)
        if identity in canonical_values and canonical_values[identity][0] != value:
            raise ValueError("native_field_value_conflict:" + widget.field_name)
        canonical_values[identity] = (value, key)
    existing = {id(widget.raw) for _, _, widget, _, _, _ in operations}
    for index, page, widget, field in assignments:
        if id(widget.raw) not in existing and id(widget.canonical) in canonical_values:
            value, _key = canonical_values[id(widget.canonical)]
            operations.append((index, page, widget, field, value, None))

    def operation_is_selected(operation: tuple[int, Any, Any, Mapping[str, Any], Any, str | None]) -> bool:
        page_index, _page, _widget, field, value, value_key = operation
        if _as_string(field.get("type")) != "radio":
            return False
        group = _as_string(field.get("name"))
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
        group = _as_string(field.get("name"))
        if field_type == "checkbox":
            if value is True or _as_string(value).strip().lower() in _TRUTHY:
                on_state = getattr(widget, "on_state", None)
                new_value = on_state() if callable(on_state) else True
            else:
                new_value = False
        elif field_type == "radio":
            candidates = radio_groups.get(group) or [field]
            on_state = getattr(widget, "on_state", None)
            if _radio_selected(field, value, candidates, value_key="id" if value_key == field_id else "name"):
                new_value = on_state() if callable(on_state) else True
            else:
                new_value = False
        else:
            new_value = value if isinstance(value, list) else _as_string(value)
        widget.write_value(document, new_value, field, font_path)
        updated += 1
        if value_key:
            applied_keys.add(value_key)
    missing = sorted(requested_keys - applied_keys)
    if missing:
        raise ValueError(f"native_fields_not_applied:{','.join(missing)}")
    return updated
