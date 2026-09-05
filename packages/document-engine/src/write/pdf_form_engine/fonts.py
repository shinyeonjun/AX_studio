from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Mapping

from .primitives import _as_float, _as_string, _hash_text
from .runtime import _pymupdf

def _text_requires_unicode_font(text: str) -> bool:
    return any(ord(character) > 127 for character in text)

def _font_supports_text(font: Any, text: str) -> bool:
    for character in text:
        if character in {"\r", "\n", "\t"}:
            continue
        if not font.has_glyph(ord(character)):
            return False
    return True

def _builtin_unicode_font(text: str) -> Any:
    """Return PyMuPDF's embedded CJK fallback after checking its glyphs."""
    pdf = _pymupdf()
    try:
        font = pdf.Font("cjk")
    except Exception as error:
        raise ValueError("unicode_font_required") from error
    if not _font_supports_text(font, text):
        raise ValueError("font_glyph_missing")
    return font

def _find_font_path(explicit: str | None = None, text: str = "") -> Path | None:
    """Resolve a font without silently accepting a missing or partial font."""
    if explicit:
        path = Path(explicit)
        if not path.is_file():
            raise ValueError("font_not_found")
        try:
            font = _pymupdf().Font(fontfile=str(path))
        except Exception as error:
            raise ValueError("font_invalid") from error
        if _text_requires_unicode_font(text) and not _font_supports_text(font, text):
            raise ValueError("font_glyph_missing")
        return path

    windows_root = Path(os.environ.get("WINDIR", "C:/Windows"))
    candidates = [
        windows_root / "Fonts" / "malgun.ttf",
        windows_root / "Fonts" / "NanumGothic.ttf",
        Path("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"),
        Path("/usr/share/fonts/truetype/nanum/NanumGothic.ttf"),
    ]
    requires_unicode = _text_requires_unicode_font(text)
    for path in candidates:
        if not path.is_file():
            continue
        try:
            font = _pymupdf().Font(fontfile=str(path))
        except Exception:
            continue
        if not requires_unicode or _font_supports_text(font, text):
            return path

    if requires_unicode:
        # A portable PyMuPDF font is safer than an ASCII-only built-in font.
        # _insert_textbox installs this font from its in-process buffer.
        _builtin_unicode_font(text)
    return None

def _text_font_size(field: Mapping[str, Any], rect: Any) -> float:
    default = min(11.0, max(float(rect.height) - 4.0, 6.0))
    return min(max(_as_float(field.get("fontSize"), default), 5.0), 24.0)

def _insert_textbox(
    page: Any,
    pdf: Any,
    rect: Any,
    field: Mapping[str, Any],
    value: Any,
    *,
    font_path: str | None,
) -> None:
    text = _as_string(value).replace("\r\n", "\n").replace("\r", "\n")
    if not text:
        return

    requires_unicode = _text_requires_unicode_font(text)
    font_file = _find_font_path(font_path, text)
    font_size = _text_font_size(field, rect)
    fallback_font = None
    if font_file:
        font_name = f"AxFormFont{_hash_text(str(font_file))}"
    elif requires_unicode:
        font_name = f"AxFormCjk{_hash_text('pymupdf-cjk-fallback')}"
        fallback_font = _builtin_unicode_font(text)
        # Page.insert_textbox accepts a font file path, not a font buffer. Add
        # the portable CJK font to the page once through the lower-level API.
        page.insert_font(fontname=font_name, fontbuffer=fallback_font.buffer)
    else:
        font_name = "helv"
    # Never silently clip a value. Retry with a smaller font, and fail the
    # whole write if the value still cannot fit inside its detected region.
    while font_size >= 5.0:
        raw_color = field.get("textColor")
        color = None
        if isinstance(raw_color, (list, tuple)) and len(raw_color) == 3:
            color = tuple(min(max(float(component), 0.0), 1.0) for component in raw_color)
        raw_align = str(field.get("align") or "left").lower()
        alignment = {"left": 0, "center": 1, "right": 2}.get(raw_align, 0)
        kwargs: dict[str, Any] = {
            "fontname": font_name,
            "fontsize": font_size,
            "overlay": True,
            "align": alignment,
        }
        if color is not None:
            kwargs["color"] = color
        if font_file:
            kwargs["fontfile"] = str(font_file)
        result = page.insert_textbox(rect, text, **kwargs)
        if result >= 0:
            return
        font_size -= 0.5
    raise ValueError(f"field_text_overflow:{_as_string(field.get('name') or field.get('id'))}")
