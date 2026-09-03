from __future__ import annotations

from typing import Any, Iterable

from ..primitives import PdfPageGeometry, _as_float, _field_id


def _cluster_positions(values: Iterable[float], tolerance: float = 5.0) -> list[float]:
    clusters: list[list[float]] = []
    for value in sorted(values):
        if not clusters or value - clusters[-1][-1] > tolerance:
            clusters.append([value])
        else:
            clusters[-1].append(value)
    return [sum(cluster) / len(cluster) for cluster in clusters]


def _ocr_geometry_fields(
    page: PdfPageGeometry,
    image: Any,
    items: list[tuple[str, tuple[float, float, float, float], float]],
    *,
    scale: float,
) -> list[dict[str, Any]]:
    """Turn empty ruled regions into reviewable OCR field candidates.

    This deliberately uses only geometry found in the rendered page. It does
    not know any form labels or depend on a particular document layout.
    """
    try:
        import cv2
        import numpy as np
    except ImportError:
        return []
    pixels = np.asarray(image.convert("L") if hasattr(image, "convert") else image)
    if pixels.ndim != 2:
        pixels = cv2.cvtColor(pixels, cv2.COLOR_RGB2GRAY)
    height, width = pixels.shape[:2]
    _, binary = cv2.threshold(pixels, 220, 255, cv2.THRESH_BINARY_INV)
    horizontal_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (max(24, width // 10), 1))
    vertical_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, max(24, height // 16)))
    horizontal_mask = cv2.morphologyEx(binary, cv2.MORPH_OPEN, horizontal_kernel)
    vertical_mask = cv2.morphologyEx(binary, cv2.MORPH_OPEN, vertical_kernel)

    horizontal: list[tuple[float, float, float]] = []
    vertical: list[tuple[float, float, float]] = []
    for contour in cv2.findContours(horizontal_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)[0]:
        x, y, line_width, line_height = cv2.boundingRect(contour)
        if line_width >= max(40, width // 8) and line_height <= 8:
            horizontal.append((float(y + line_height / 2), float(x), float(x + line_width)))
    for contour in cv2.findContours(vertical_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)[0]:
        x, y, line_width, line_height = cv2.boundingRect(contour)
        if line_height >= max(30, height // 20) and line_width <= 8:
            vertical.append((float(x + line_width / 2), float(y), float(y + line_height)))
    long_horizontal = [
        line
        for line in horizontal
        if line[2] - line[1] >= max(100.0, width * 0.5)
    ]
    if len(long_horizontal) >= 2:
        horizontal = long_horizontal
    if len(horizontal) < 2:
        return []

    horizontal_y = _cluster_positions(line[0] for line in horizontal)
    vertical_x = _cluster_positions(line[0] for line in vertical)

    def horizontal_bounds(y: float) -> tuple[float, float] | None:
        matches = [line for line in horizontal if abs(line[0] - y) <= 6.0]
        if not matches:
            return None
        left = max(line[1] for line in matches)
        right = min(line[2] for line in matches)
        return (left, right) if right - left >= 50.0 else None

    def vertical_covers(x: float, top: float, bottom: float) -> bool:
        return any(
            abs(line_x - x) <= 6.0
            and line_top <= top + 8.0
            and line_bottom >= bottom - 8.0
            for line_x, line_top, line_bottom in vertical
        )

    def estimate_blank_start(left: float, right: float, top: float, bottom: float) -> float:
        """Estimate a shaded label-cell boundary without reading its label."""
        inner_top = int(min(max(top + 8.0, 0.0), height - 1))
        inner_bottom = int(max(min(bottom - 8.0, height), inner_top + 1))
        inner_left = int(min(max(left + 8.0, 0.0), width - 1))
        inner_right = int(max(min(right - 8.0, width), inner_left + 1))
        column_median = np.median(pixels[inner_top:inner_bottom, inner_left:inner_right], axis=0)
        run_start = max(0, int((right - left) * 0.08))
        run_length = max(12, int((right - left) * 0.02))
        run = 0
        for offset, value in enumerate(column_median[run_start:], start=run_start):
            if float(value) >= 248.0:
                run += 1
                if run >= run_length:
                    candidate = inner_left + offset - run + 1
                    previous = column_median[max(0, offset - run_length):offset - run_length + 1]
                    if len(previous) == 0 or float(np.median(previous)) < 248.0:
                        return float(candidate)
            else:
                run = 0
        return left + max(8.0, (right - left) * 0.28)

    def occupied(region: tuple[float, float, float, float]) -> bool:
        return any(
            item_box[0] < region[2]
            and item_box[2] > region[0]
            and item_box[1] < region[3]
            and item_box[3] > region[1]
            for _, item_box, _ in items
        )

    fields: list[dict[str, Any]] = []
    ordinal = 0
    for top, bottom in zip(horizontal_y, horizontal_y[1:]):
        if bottom - top < 24.0:
            continue
        top_bounds = horizontal_bounds(top)
        bottom_bounds = horizontal_bounds(bottom)
        if top_bounds is None or bottom_bounds is None:
            continue
        row_left = max(top_bounds[0], bottom_bounds[0])
        row_right = min(top_bounds[1], bottom_bounds[1])
        if row_right - row_left < 50.0:
            continue

        row_verticals = [
            x
            for x in vertical_x
            if row_left + 8.0 < x < row_right - 8.0
            and vertical_covers(x, top, bottom)
        ]
        if row_verticals:
            boundaries = [row_left, *row_verticals, row_right]
        else:
            boundaries = [estimate_blank_start(row_left, row_right, top, bottom), row_right]

        for left, right in zip(boundaries, boundaries[1:]):
            if right - left < 50.0:
                continue
            region = (left + 3.0, top + 3.0, right - 3.0, bottom - 3.0)
            if occupied(region):
                continue
            x = region[0] / scale
            y = region[1] / scale
            region_width = (region[2] - region[0]) / scale
            region_height = (region[3] - region[1]) / scale
            name = f"area_{page.index + 1}_{round(x, 1)}_{round(y, 1)}"
            fields.append(
                {
                    "id": _field_id(name, page.index, ordinal),
                    "name": name,
                    "label": "검토할 입력 영역",
                    "pageIndex": page.index,
                    "rect": {"x": x, "y": y, "width": region_width, "height": region_height},
                    "type": "text",
                    "source": "ocr_geometry",
                    "confidence": 0.72,
                    "required": False,
                    "multiline": region_height >= 36.0,
                }
            )
            ordinal += 1
    return fields
