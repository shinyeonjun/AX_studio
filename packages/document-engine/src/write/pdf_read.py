"""PDFium inspection independent of the pypdf/ReportLab writer.

Coordinates exposed here are unrotated, top-left PDF user coordinates. Native
handles stay inside a document context; callers receive only ordinary values.
"""
from __future__ import annotations

import ctypes
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterator

import pypdfium2 as pdfium
from pypdf import PdfReader


@contextmanager
def open_pdf(source: str | Path | bytes) -> Iterator[Any]:
    document = pdfium.PdfDocument(str(source) if isinstance(source, Path) else source)
    try:
        document.init_forms()
        yield document
    finally:
        document.close()


def page_text(page: Any, rect: tuple[float, float, float, float] | None = None,
              *, height: float | None = None) -> str:
    text = page.get_textpage()
    try:
        if rect is None:
            return text.get_text_bounded()
        x0, y0, x1, y1 = rect
        h = height if height is not None else page.get_height()
        return text.get_text_bounded(x0, h - y1, x1, h - y0)
    finally:
        text.close()


def render_page(page: Any, *, scale: float = 2.0) -> Any:
    bitmap = page.render(scale=scale, draw_annots=True)
    try:
        return bitmap.to_pil().copy()
    finally:
        bitmap.close()


def render_region(page: Any, rect: tuple[float, float, float, float],
                  geometry: tuple[float, float, int]) -> bytes:
    width, height, rotation = geometry
    x0, y0, x1, y1 = rect
    if rotation == 90:
        x0, y0, x1, y1 = height - y1, x0, height - y0, x1
    elif rotation == 180:
        x0, y0, x1, y1 = width - x1, height - y1, width - x0, height - y0
    elif rotation == 270:
        x0, y0, x1, y1 = y0, width - x1, y1, width - x0
    image = render_page(page)
    try:
        clipped = image.crop((max(0, round(x0 * 2)), max(0, round(y0 * 2)),
                              min(image.width, round(x1 * 2)), min(image.height, round(y1 * 2))))
        try:
            return clipped.tobytes()
        finally:
            clipped.close()
    finally:
        image.close()


def text_spans(page: Any, height: float) -> list[dict[str, Any]]:
    """Group real PDFium character geometry, including nested Form XObjects."""
    result: list[dict[str, Any]] = []
    text = page.get_textpage()
    chars: list[str] = []
    boxes: list[tuple[float, float, float, float]] = []
    current_style: tuple[Any, ...] | None = None

    def flush() -> None:
        if boxes and ''.join(chars).strip() and current_style:
            result.append({'text': ''.join(chars).strip(),
                           'bbox': (min(b[0] for b in boxes), min(b[1] for b in boxes),
                                    max(b[2] for b in boxes), max(b[3] for b in boxes)),
                           'size': current_style[0], 'font': current_style[1], 'color': current_style[2]})
        chars.clear()
        boxes.clear()

    try:
        for index in range(text.count_chars()):
            character = chr(pdfium.raw.FPDFText_GetUnicode(text, index))
            if character in '\r\n\x00':
                flush()
                continue
            if character.isspace():
                if chars:
                    chars.append(character)
                continue
            size = pdfium.raw.FPDFText_GetFontSize(text, index)
            flags = ctypes.c_int()
            count = pdfium.raw.FPDFText_GetFontInfo(text, index, None, 0, flags)
            name = ctypes.create_string_buffer(count or 1)
            if count:
                pdfium.raw.FPDFText_GetFontInfo(text, index, name, count, flags)
            rgba = [ctypes.c_uint() for _ in range(4)]
            pdfium.raw.FPDFText_GetFillColor(text, index, *rgba)
            color = (rgba[0].value << 16) | (rgba[1].value << 8) | rgba[2].value
            style = (round(size, 3), name.value.decode('utf8', errors='replace'), color)
            left, bottom, right, top = text.get_charbox(index, loose=True)
            box = (left, height - top, right, height - bottom)
            if boxes and (style != current_style or box[0] - boxes[-1][2] > max(size, 1) * 1.1
                          or abs(box[3] - boxes[-1][3]) > max(size, 1) * 0.45):
                flush()
            current_style = style
            chars.append(character)
            boxes.append(box)
        flush()
        return result
    finally:
        text.close()


@dataclass
class InspectedPage:
    width: float
    height: float
    rotation: int
    spans: list[dict[str, Any]]
    drawings: list[dict[str, Any]]
    images: list[dict[str, Any]]


def inspect_pages(path: Path) -> list[InspectedPage]:
    reader = PdfReader(path)
    pages: list[InspectedPage] = []
    with open_pdf(path) as document:
        for index, source in enumerate(reader.pages):
            page = document[index]
            height = float(source.mediabox.height)
            drawings: list[dict[str, Any]] = []
            images: list[dict[str, Any]] = []
            try:
                parents = {0: pdfium.PdfMatrix()}
                for obj in page.get_objects(max_depth=32):
                    try:
                        parent = parents[obj.level]
                        matrix = obj.get_matrix().multiply(parent)
                        if obj.type == pdfium.raw.FPDF_PAGEOBJ_FORM:
                            if obj.level == 31 and pdfium.raw.FPDFFormObj_CountObjects(obj):
                                raise ValueError('pdf_object_nesting_limit')
                            parents[obj.level + 1] = matrix
                            continue
                        left, bottom, right, top = parent.on_rect(*obj.get_bounds())
                        rect = (left, height - top, right, height - bottom)
                        if obj.type == pdfium.raw.FPDF_PAGEOBJ_PATH:
                            points = []
                            for segment_index in range(pdfium.raw.FPDFPath_CountSegments(obj)):
                                segment = pdfium.raw.FPDFPath_GetPathSegment(obj, segment_index)
                                x, y = ctypes.c_float(), ctypes.c_float()
                                if pdfium.raw.FPDFPathSegment_GetPoint(segment, x, y):
                                    points.append((matrix.a * x.value + matrix.c * y.value + matrix.e,
                                                   matrix.b * x.value + matrix.d * y.value + matrix.f))
                            if points:
                                rect = (min(p[0] for p in points), height - max(p[1] for p in points),
                                        max(p[0] for p in points), height - min(p[1] for p in points))
                            mode, stroke = ctypes.c_int(), ctypes.c_int()
                            pdfium.raw.FPDFPath_GetDrawMode(obj, mode, stroke)
                            rgba = [ctypes.c_uint() for _ in range(4)]
                            pdfium.raw.FPDFPageObj_GetFillColor(obj, *rgba)
                            drawings.append({'rect': rect, 'fill': tuple(c.value / 255 for c in rgba[:3])
                                             if mode.value else None})
                        elif obj.type == pdfium.raw.FPDF_PAGEOBJ_IMAGE:
                            images.append({'bbox': rect})
                    finally:
                        # get_objects descends into a form after yielding it.
                        # Its page-owned native handle must stay alive until
                        # that traversal finishes; page.close owns its lifetime.
                        if obj.type != pdfium.raw.FPDF_PAGEOBJ_FORM:
                            obj.close()
                pages.append(InspectedPage(float(source.mediabox.width), height, int(source.rotation) % 360,
                                           text_spans(page, height), drawings, images))
            finally:
                page.close()
    return pages
