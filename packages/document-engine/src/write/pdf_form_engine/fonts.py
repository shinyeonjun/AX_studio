from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Mapping

from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

from .primitives import _as_float, _as_string, _hash_text

_BUNDLED_FONT = Path(__file__).resolve().parents[2] / "assets/fonts/NanumGothic-Regular.ttf"


def _load_font(path: Path) -> str:
    if not path.is_file():
        raise ValueError("font_not_found")
    stat = path.stat()
    name = "AxFont" + _hash_text(f"{path}:{stat.st_size}:{stat.st_mtime_ns}")
    if name not in pdfmetrics.getRegisteredFontNames():
        try:
            pdfmetrics.registerFont(TTFont(name, str(path)))
        except Exception as error:
            raise ValueError("font_invalid") from error
    return name


def _font_supports_text(name: str, text: str) -> bool:
    glyphs = pdfmetrics.getFont(name).face.charToGlyph
    return all(character in "\r\n\t" or bool(glyphs.get(ord(character))) for character in text)


def _find_font_path(explicit: str | None = None, text: str = "") -> Path | None:
    if explicit:
        path = Path(explicit)
        name = _load_font(path)
        if not _font_supports_text(name, text):
            raise ValueError("font_glyph_missing")
        return path
    windows_root = Path(os.environ.get("WINDIR", "C:/Windows"))
    for path in (_BUNDLED_FONT, windows_root / "Fonts/malgun.ttf",
                 Path("/usr/share/fonts/truetype/nanum/NanumGothic.ttf")):
        if path.is_file():
            try:
                if _font_supports_text(_load_font(path), text):
                    return path
            except ValueError:
                continue
    if any(ord(character) > 127 for character in text):
        raise ValueError("font_glyph_missing")
    return None


def _font_name(text: str, explicit: str | None = None) -> str:
    if explicit or any(ord(character) > 127 for character in text):
        path = _find_font_path(explicit, text)
        if path is None:
            raise ValueError("unicode_font_required")
        return _load_font(path)
    return "Helvetica"


def _wrap_text(text: str, name: str, size: float, width: float) -> list[str] | None:
    lines: list[str] = []
    for paragraph in text.split("\n"):
        remaining = paragraph
        if not remaining:
            lines.append("")
        while remaining:
            count = 0
            while count < len(remaining) and pdfmetrics.stringWidth(remaining[:count + 1], name, size) <= width:
                count += 1
            if count == 0:
                return None
            if count < len(remaining):
                space = remaining.rfind(" ", 0, count + 1)
                if space > 0:
                    count = space
            lines.append(remaining[:count])
            remaining = remaining[count:].lstrip(" ")
    return lines


def _draw_text(canvas: Any, rect: tuple[float, float, float, float], field: Mapping[str, Any],
               value: Any, *, page_height: float, font_path: str | None) -> None:
    text = _as_string(value).replace("\r\n", "\n").replace("\r", "\n").replace("\t", "    ")
    if not text:
        return
    name = _font_name(text, font_path)
    x0, y0, x1, y1 = rect
    size = min(max(_as_float(field.get("fontSize"), min(11, max(y1 - y0 - 4, 6))), 5), 24)
    while True:
        lines = _wrap_text(text, name, size, x1 - x0)
        ascent, descent = pdfmetrics.getAscentDescent(name, size)
        leading = size * 1.2
        needed = ascent - descent + (len(lines) - 1) * leading if lines else float("inf")
        # Glyph-derived rectangles may omit descent/leading. Keep the existing
        # <=2pt padding allowance, but never write a clipped or overflowing value.
        padding = min(max((y1 - y0) * 0.15, 1), 2)
        if needed <= y1 - y0 + padding and lines is not None:
            break
        if size == 5:
            raise ValueError(f"field_text_overflow:{_as_string(field.get('name') or field.get('id'))}")
        size = max(5, size - 0.5)
    color = field.get("textColor")
    if not isinstance(color, (list, tuple)) or len(color) != 3:
        color = (0, 0, 0)
    canvas.setFillColorRGB(*(min(max(float(c), 0), 1) for c in color))
    canvas.setFont(name, size)
    align = str(field.get("align") or "left").lower()
    baseline = page_height - y0 - ascent
    for line in lines:
        advance = pdfmetrics.stringWidth(line, name, size)
        x = x0 + ((x1 - x0 - advance) / 2 if align == "center" else x1 - x0 - advance if align == "right" else 0)
        canvas.drawString(x, baseline, line)
        baseline -= leading
