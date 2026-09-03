from __future__ import annotations

from pathlib import Path
from typing import Any

from ..primitives import (
    PdfPageGeometry,
    _PLACEHOLDER_RE,
    _as_float,
    _as_string,
    _field_id,
)


def _render_page(source_path: Path, page_index: int, scale: float = 2.0) -> Any:
    import pypdfium2 as pdfium

    document = pdfium.PdfDocument(str(source_path))
    try:
        page = document[page_index]
        bitmap = page.render(scale=scale)
        image = bitmap.to_pil()
        return image.copy()
    finally:
        close_page = locals().get("page")
        if close_page is not None and callable(getattr(close_page, "close", None)):
            close_page.close()
        close_document = getattr(document, "close", None)
        if callable(close_document):
            close_document()


def _ocr_items(image: Any) -> list[tuple[str, tuple[float, float, float, float], float]]:
    from rapidocr import RapidOCR

    output = RapidOCR()(image, return_word_box=False)
    boxes = getattr(output, "boxes", None)
    texts = getattr(output, "txts", None)
    scores = getattr(output, "scores", None)
    if boxes is None and isinstance(output, tuple) and len(output) >= 3:
        boxes, texts, scores = output[0], output[1], output[2]
    items: list[tuple[str, tuple[float, float, float, float], float]] = []
    box_values = boxes if boxes is not None else []
    text_values = texts if texts is not None else []
    score_values = scores if scores is not None else []
    for box, text, score in zip(box_values, text_values, score_values):
        points = [(_as_float(point[0]), _as_float(point[1])) for point in box]
        if len(points) < 4:
            continue
        xs = [point[0] for point in points]
        ys = [point[1] for point in points]
        items.append((_as_string(text).strip(), (min(xs), min(ys), max(xs), max(ys)), _as_float(score)))
    return [item for item in items if item[0]]


def _ocr_candidate_fields(
    page: PdfPageGeometry,
    items: list[tuple[str, tuple[float, float, float, float], float]],
    *,
    scale: float,
) -> list[dict[str, Any]]:
    fields: list[dict[str, Any]] = []
    seen: set[tuple[str, int, int]] = set()
    for ordinal, (text, box, score) in enumerate(items):
        explicit = list(_PLACEHOLDER_RE.finditer(text))
        if explicit:
            for match in explicit:
                name = (match.group(1) or match.group(2) or "field").strip()
                key = (name, round(box[0]), round(box[1]))
                if key in seen:
                    continue
                seen.add(key)
                fields.append(
                    {
                        "id": _field_id(name, page.index, ordinal),
                        "name": name,
                        "label": name,
                        "pageIndex": page.index,
                        "rect": {
                            "x": box[0] / scale,
                            "y": box[1] / scale,
                            "width": max((box[2] - box[0]) / scale, 24.0),
                            "height": max((box[3] - box[1]) / scale + 6.0, 18.0),
                        },
                        "type": "text",
                        "source": "ocr_placeholder",
                        "confidence": min(max(score, 0.0), 1.0),
                        "required": False,
                        "multiline": False,
                    }
                )
            continue
        normalized = text.strip().rstrip(":：")
        if not normalized or len(normalized) > 40:
            continue
        x0, y0, x1, y1 = box
        width = max(page.width * 0.28, 120.0)
        x = min(x1 / scale + 8.0, max(page.width - width - 8.0, 8.0))
        y = max(y0 / scale - 2.0, 0.0)
        height = max((y1 - y0) / scale + 10.0, 22.0)
        key = (normalized, round(x), round(y))
        if key in seen:
            continue
        seen.add(key)
        fields.append(
            {
                "id": _field_id(normalized, page.index, ordinal),
                "name": normalized,
                "label": normalized,
                "pageIndex": page.index,
                "rect": {"x": x, "y": y, "width": width, "height": height},
                "type": "text",
                "source": "ocr_label",
                "confidence": min(max(score * 0.85, 0.0), 0.85),
                "required": False,
                "multiline": False,
            }
        )
    return fields
