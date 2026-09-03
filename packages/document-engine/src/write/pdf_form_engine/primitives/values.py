from __future__ import annotations

import hashlib
from typing import Any

def _as_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default

def _as_string(value: Any) -> str:
    if value is None:
        return ""
    return str(value)

def _hash_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:16]

def _field_id(name: str, page_index: int, ordinal: int) -> str:
    return f"field-{_hash_text(f'{name}:{page_index}:{ordinal}') }"

def _object(value: Any) -> Any:
    getter = getattr(value, "get_object", None)
    return getter() if callable(getter) else value

def _inherited(widget: Any, key: str) -> Any:
    current = widget
    seen: set[int] = set()
    while current is not None:
        current = _object(current)
        marker = id(current)
        if marker in seen:
            break
        seen.add(marker)
        if hasattr(current, "get") and current.get(key) is not None:
            return current.get(key)
        current = current.get("/Parent") if hasattr(current, "get") else None
    return None

def _qualified_field_name(widget: Any) -> str:
    parts: list[str] = []
    current = widget
    seen: set[int] = set()
    while current is not None:
        current = _object(current)
        marker = id(current)
        if marker in seen:
            break
        seen.add(marker)
        name = current.get("/T") if hasattr(current, "get") else None
        if name is not None and _as_string(name):
            parts.insert(0, _as_string(name))
        current = current.get("/Parent") if hasattr(current, "get") else None
    return ".".join(parts)

def _form_field_type(widget: Any) -> str:
    field_type = _as_string(_inherited(widget, "/FT"))
    if field_type == "/Tx":
        return "text"
    if field_type == "/Ch":
        return "select"
    if field_type == "/Sig":
        return "signature"
    if field_type == "/Btn":
        flags = int(_as_float(_inherited(widget, "/Ff")))
        if flags & (1 << 16):
            return "button"
        if flags & (1 << 15):
            return "radio"
        return "checkbox"
    return "unknown"

def _field_rect(rect: Any, page_height: float) -> dict[str, float] | None:
    if not rect or len(rect) < 4:
        return None
    x0, y0, x1, y1 = (_as_float(value) for value in rect[:4])
    left = min(x0, x1)
    right = max(x0, x1)
    bottom = min(y0, y1)
    top = max(y0, y1)
    width = right - left
    height = top - bottom
    if width <= 0 or height <= 0:
        return None
    return {"x": left, "y": page_height - top, "width": width, "height": height}

def _widget_export_value(widget: Any) -> str | None:
    appearance = _object(widget.get("/AP")) if hasattr(widget, "get") else None
    normal = _object(appearance.get("/N")) if hasattr(appearance, "get") else None
    if hasattr(normal, "keys"):
        for key in normal.keys():
            value = _as_string(key)
            if value not in {"/Off", "Off"}:
                return value.lstrip("/")
    return None

def _widget_options(widget: Any) -> list[str]:
    raw_options = _inherited(widget, "/Opt")
    if not isinstance(raw_options, (list, tuple)):
        return []
    options: list[str] = []
    for raw_option in raw_options:
        option = _object(raw_option)
        if isinstance(option, (list, tuple)) and option:
            option = _object(option[0])
        value = _as_string(option)
        if value:
            options.append(value.lstrip("/"))
    return options
