from __future__ import annotations

from pathlib import Path
from typing import Any

from ..primitives import (
    PdfPageGeometry,
    _as_float,
    _field_id,
    _placeholder_fields_from_text,
)


def _pdfium_page_text(page: Any) -> tuple[str, list[tuple[float, float, float, float] | None]]:
    text_page = page.get_textpage()
    try:
        count = text_page.count_chars()
        text = text_page.get_text_range(0, count)
        boxes: list[tuple[float, float, float, float] | None] = []
        for index in range(count):
            try:
                raw = text_page.get_charbox(index)
                boxes.append(tuple(float(value) for value in raw[:4]))
            except (IndexError, TypeError, ValueError):
                boxes.append(None)
        return text, boxes
    finally:
        close = getattr(text_page, "close", None)
        if callable(close):
            close()


def _digital_placeholder_fields(
    source_path: Path,
    pages: list[PdfPageGeometry],
) -> tuple[list[dict[str, Any]], bool]:
    try:
        import pypdfium2 as pdfium
    except ImportError:
        return [], False
    document = pdfium.PdfDocument(str(source_path))
    fields: list[dict[str, Any]] = []
    has_native_text = False
    try:
        for page_geometry in pages:
            page = document[page_geometry.index]
            text, boxes = _pdfium_page_text(page)
            if text.strip():
                has_native_text = True
            fields.extend(
                _placeholder_fields_from_text(
                    text,
                    boxes,
                    page_geometry,
                    source="digital_placeholder",
                    confidence=0.98,
                )
            )
            close = getattr(page, "close", None)
            if callable(close):
                close()
    finally:
        close = getattr(document, "close", None)
        if callable(close):
            close()
    return fields, has_native_text


def _digital_geometry_fields(
    source_path: Path,
    pages: list[PdfPageGeometry],
) -> list[dict[str, Any]]:
    """Find generic line/box regions in a digital PDF without using labels."""
    try:
        import pypdfium2 as pdfium
    except ImportError:
        return []
    document = pdfium.PdfDocument(str(source_path))
    fields: list[dict[str, Any]] = []
    try:
        for page_geometry in pages:
            page = document[page_geometry.index]
            ordinal = 0
            try:
                objects = list(page.get_objects())
                for page_object in objects:
                    try:
                        if page_object.type != pdfium.raw.FPDF_PAGEOBJ_PATH:
                            continue
                        left, bottom, right, top = (
                            _as_float(value) for value in page_object.get_pos()
                        )
                        width = right - left
                        height = top - bottom
                        rect: dict[str, float] | None = None
                        confidence = 0.0
                        if height <= 4.0 and 50.0 <= width <= page_geometry.width * 0.9:
                            rect = {
                                "x": left,
                                "y": max(page_geometry.height - top - 20.0, 0.0),
                                "width": width,
                                "height": 18.0,
                            }
                            confidence = 0.45
                        elif width >= 50.0 and height >= 20.0 and width <= page_geometry.width * 0.95:
                            rect = {
                                "x": left + 2.0,
                                "y": max(page_geometry.height - top + 2.0, 0.0),
                                "width": width - 4.0,
                                "height": height - 4.0,
                            }
                            confidence = 0.55
                        if rect is None or rect["width"] <= 0 or rect["height"] <= 0:
                            continue
                        if rect["y"] + rect["height"] > page_geometry.height:
                            continue
                        fields.append(
                            {
                                "id": _field_id(
                                    f"area_{page_geometry.index + 1}_{ordinal}",
                                    page_geometry.index,
                                    ordinal,
                                ),
                                "name": f"area_{page_geometry.index + 1}_{ordinal}",
                                "label": f"입력 영역 {ordinal + 1}",
                                "pageIndex": page_geometry.index,
                                "rect": rect,
                                "type": "text",
                                "source": "digital_geometry",
                                "confidence": confidence,
                                "required": False,
                                "multiline": rect["height"] >= 36.0,
                            }
                        )
                        ordinal += 1
                    finally:
                        close_object = getattr(page_object, "close", None)
                        if callable(close_object):
                            close_object()
            finally:
                close_page = getattr(page, "close", None)
                if callable(close_page):
                    close_page()
    finally:
        close_document = getattr(document, "close", None)
        if callable(close_document):
            close_document()
    return fields
