from __future__ import annotations

from dataclasses import dataclass
import hashlib
from statistics import median
from pathlib import Path
from typing import Any

import pymupdf


_POSITION_TOLERANCE = 1.5
_ROW_TOLERANCE = 1.75
_BAND_TOLERANCE = 1.5


@dataclass(frozen=True)
class _Span:
    page_index: int
    rect: tuple[float, float, float, float]
    text: str
    font_size: float
    font: str
    color: int
    block_index: int
    line_index: int
    span_index: int


@dataclass(frozen=True)
class _Band:
    page_index: int
    rect: tuple[float, float, float, float]
    fill: tuple[float, float, float] | None


@dataclass(frozen=True)
class _TableRegion:
    page_index: int
    rect: tuple[float, float, float, float]
    header: _Band
    data_rows: tuple[_Band, ...]
    headers: tuple[_Span, ...]


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _rect(raw: Any) -> tuple[float, float, float, float]:
    return tuple(round(float(value), 3) for value in raw[:4])  # type: ignore[return-value]


def _page_spans(page: Any, page_index: int) -> list[_Span]:
    spans: list[_Span] = []
    document = page.get_text("dict")
    for block_index, block in enumerate(document.get("blocks") or []):
        for line_index, line in enumerate(block.get("lines") or []):
            for span_index, span in enumerate(line.get("spans") or []):
                text = str(span.get("text") or "").strip()
                bbox = span.get("bbox")
                if not text or not isinstance(bbox, (tuple, list)) or len(bbox) < 4:
                    continue
                spans.append(
                    _Span(
                        page_index=page_index,
                        rect=_rect(bbox),
                        text=text,
                        font_size=round(float(span.get("size") or 10.0), 3),
                        font=str(span.get("font") or ""),
                        color=int(span.get("color") or 0),
                        block_index=block_index,
                        line_index=line_index,
                        span_index=span_index,
                    )
                )
    return spans


def _same_static_span(left: _Span, right: _Span) -> bool:
    if left.text != right.text:
        return False
    return all(abs(a - b) <= _POSITION_TOLERANCE for a, b in zip(left.rect, right.rect))


def _dynamic_spans(example: list[_Span], template: list[_Span]) -> list[_Span]:
    used: set[int] = set()
    dynamic: list[_Span] = []
    for candidate in example:
        match = next(
            (
                index
                for index, template_span in enumerate(template)
                if index not in used and _same_static_span(candidate, template_span)
            ),
            None,
        )
        if match is None:
            dynamic.append(candidate)
        else:
            used.add(match)
    return dynamic


def _slot_id(span: _Span) -> str:
    identity = ":".join(
        [
            str(span.page_index),
            *(f"{value:.3f}" for value in span.rect),
            str(span.block_index),
            str(span.line_index),
            str(span.span_index),
        ]
    )
    return "slot-" + hashlib.sha256(identity.encode("utf-8")).hexdigest()[:16]


def _span_payload(span: _Span) -> dict[str, Any]:
    x0, y0, x1, y1 = span.rect
    return {
        "id": _slot_id(span),
        "pageIndex": span.page_index,
        "rect": {
            "x": x0,
            "y": y0,
            "width": round(x1 - x0, 3),
            "height": round(y1 - y0, 3),
        },
        "exampleText": span.text,
        "fontSize": span.font_size,
        "font": span.font,
        "color": span.color,
    }


def _rows(spans: list[_Span]) -> list[list[_Span]]:
    rows: list[list[_Span]] = []
    for span in sorted(spans, key=lambda value: (value.page_index, value.rect[1], value.rect[0])):
        existing = next(
            (
                row
                for row in reversed(rows)
                if row[0].page_index == span.page_index
                and abs(row[0].rect[1] - span.rect[1]) <= _ROW_TOLERANCE
            ),
            None,
        )
        if existing is None:
            rows.append([span])
        else:
            existing.append(span)
    for row in rows:
        row.sort(key=lambda value: value.rect[0])
    return rows


def _contains(rect: tuple[float, float, float, float], span: _Span) -> bool:
    x0, y0, x1, y1 = rect
    center_x = (span.rect[0] + span.rect[2]) / 2.0
    center_y = (span.rect[1] + span.rect[3]) / 2.0
    return x0 - _BAND_TOLERANCE <= center_x <= x1 + _BAND_TOLERANCE and y0 - _BAND_TOLERANCE <= center_y <= y1 + _BAND_TOLERANCE


def _filled_bands(page: Any, page_index: int) -> list[_Band]:
    minimum_width = float(page.rect.width) * 0.15
    maximum_height = float(page.rect.height) * 0.08
    bands: list[_Band] = []
    for drawing in page.get_drawings():
        fill = drawing.get("fill")
        raw = drawing.get("rect")
        if fill is None or raw is None:
            continue
        rect = _rect(raw)
        width = rect[2] - rect[0]
        height = rect[3] - rect[1]
        if width < minimum_width or height < 8.0 or height > maximum_height:
            continue
        bands.append(
            _Band(
                page_index=page_index,
                rect=rect,
                fill=tuple(round(float(value), 4) for value in fill[:3]),
            )
        )
    return bands


def _horizontal_band_groups(bands: list[_Band]) -> list[list[_Band]]:
    groups: list[list[_Band]] = []
    for band in sorted(bands, key=lambda value: (value.rect[0], value.rect[2], value.rect[1])):
        matching = next(
            (
                group
                for group in groups
                if abs(group[0].rect[0] - band.rect[0]) <= _BAND_TOLERANCE
                and abs(group[0].rect[2] - band.rect[2]) <= _BAND_TOLERANCE
            ),
            None,
        )
        if matching is None:
            groups.append([band])
        else:
            matching.append(band)
    return groups


def _table_regions(page: Any, page_index: int, template_spans: list[_Span]) -> list[_TableRegion]:
    regions: list[_TableRegion] = []
    used_headers: set[tuple[float, float, float, float]] = set()
    for group in _horizontal_band_groups(_filled_bands(page, page_index)):
        ordered = sorted(group, key=lambda value: value.rect[1])
        for header_index, header in enumerate(ordered):
            if header.rect in used_headers:
                continue
            headers = sorted(
                (span for span in template_spans if _contains(header.rect, span)),
                key=lambda span: span.rect[0],
            )
            if len(headers) < 2:
                continue
            data_rows: list[_Band] = []
            expected_height: float | None = None
            bottom = header.rect[3]
            for candidate in ordered[header_index + 1 :]:
                if abs(candidate.rect[1] - bottom) > _BAND_TOLERANCE:
                    break
                height = candidate.rect[3] - candidate.rect[1]
                if expected_height is None:
                    expected_height = height
                elif abs(height - expected_height) > max(1.5, expected_height * 0.08):
                    break
                if any(_contains(candidate.rect, span) for span in template_spans):
                    break
                data_rows.append(candidate)
                bottom = candidate.rect[3]
            if len(data_rows) < 2:
                continue
            used_headers.add(header.rect)
            regions.append(
                _TableRegion(
                    page_index=page_index,
                    rect=(header.rect[0], header.rect[1], header.rect[2], data_rows[-1].rect[3]),
                    header=header,
                    data_rows=tuple(data_rows),
                    headers=tuple(headers),
                )
            )
    return regions


def _assign_row_cells(spans: list[_Span], anchors: list[float]) -> list[list[_Span]]:
    assigned: list[list[_Span]] = [[] for _ in anchors]
    ordered = sorted(spans, key=lambda span: span.rect[0])
    if len(ordered) == len(anchors):
        for index, span in enumerate(ordered):
            assigned[index].append(span)
        return assigned
    boundaries = [(anchors[index] + anchors[index + 1]) / 2.0 for index in range(len(anchors) - 1)]
    for span in ordered:
        center = (span.rect[0] + span.rect[2]) / 2.0
        column = next((index for index, boundary in enumerate(boundaries) if center < boundary), len(anchors) - 1)
        assigned[column].append(span)
    return assigned


def _merged_cell(
    values: list[_Span],
    *,
    page_index: int,
    row_index: int,
    column_index: int,
    x0: float,
    x1: float,
    band: _Band,
    fallback: _Span,
) -> _Span:
    if values:
        ordered = sorted(values, key=lambda span: span.rect[0])
        text = " ".join(span.text for span in ordered)
        y0 = min(span.rect[1] for span in ordered)
        y1 = max(span.rect[3] for span in ordered)
        style = ordered[0]
    else:
        text = ""
        style = fallback
        height = max(fallback.rect[3] - fallback.rect[1], fallback.font_size)
        y0 = band.rect[1] + max(((band.rect[3] - band.rect[1]) - height) / 2.0, 0.0)
        y1 = min(y0 + height, band.rect[3])
    return _Span(
        page_index=page_index,
        rect=(round(x0, 3), round(y0, 3), round(max(x1, x0 + 1.0), 3), round(y1, 3)),
        text=text,
        font_size=style.font_size,
        font=style.font,
        color=style.color,
        block_index=-1000,
        line_index=row_index,
        span_index=column_index,
    )


def _geometry_table_groups(
    template: Any,
    template_spans_by_page: list[list[_Span]],
    dynamic: list[_Span],
) -> tuple[list[dict[str, Any]], set[str]]:
    regions = [
        region
        for page_index in range(len(template))
        for region in _table_regions(template[page_index], page_index, template_spans_by_page[page_index])
    ]
    consumed: set[str] = set()
    materialized: list[tuple[tuple[Any, ...], _TableRegion, list[list[_Span]]]] = []
    for region in regions:
        header_anchors = [span.rect[0] for span in region.headers]
        row_assignments: list[list[list[_Span]]] = []
        observed_x: list[list[float]] = [[] for _ in header_anchors]
        for band in region.data_rows:
            row_spans = [
                span
                for span in dynamic
                if span.page_index == region.page_index and _contains(band.rect, span)
            ]
            assigned = _assign_row_cells(row_spans, header_anchors)
            row_assignments.append(assigned)
            for column_index, values in enumerate(assigned):
                observed_x[column_index].extend(span.rect[0] for span in values)
                consumed.update(_slot_id(span) for span in values)

        anchors = [
            round(float(median(values)), 3) if values else round(region.headers[index].rect[0], 3)
            for index, values in enumerate(observed_x)
        ]
        rows: list[list[_Span]] = []
        for row_index, (band, assigned) in enumerate(zip(region.data_rows, row_assignments)):
            cells: list[_Span] = []
            for column_index, values in enumerate(assigned):
                right = anchors[column_index + 1] - 2.0 if column_index + 1 < len(anchors) else region.rect[2] - 4.0
                cells.append(
                    _merged_cell(
                        values,
                        page_index=region.page_index,
                        row_index=row_index,
                        column_index=column_index,
                        x0=anchors[column_index],
                        x1=right,
                        band=band,
                        fallback=region.headers[column_index],
                    )
                )
            rows.append(cells)
        signature = (
            len(anchors),
            tuple(round(value / 2.0) * 2 for value in anchors),
            round(region.rect[0] / 2.0) * 2,
            round(region.rect[2] / 2.0) * 2,
        )
        materialized.append((signature, region, rows))

    grouped: dict[tuple[Any, ...], list[tuple[_TableRegion, list[list[_Span]]]]] = {}
    for signature, region, rows in materialized:
        grouped.setdefault(signature, []).append((region, rows))

    groups: list[dict[str, Any]] = []
    for signature, continuations in grouped.items():
        continuations.sort(key=lambda item: (item[0].page_index, item[0].rect[1]))
        identity = repr((signature, [(region.page_index, region.rect) for region, _rows_value in continuations]))
        group_id = "table-" + hashlib.sha256(identity.encode("utf-8")).hexdigest()[:16]
        payload_rows: list[dict[str, Any]] = []
        page_bounds: list[dict[str, Any]] = []
        for region, rows in continuations:
            page_bounds.append(
                {
                    "pageIndex": region.page_index,
                    "x": region.rect[0],
                    "width": round(region.rect[2] - region.rect[0], 3),
                }
            )
            for cells in rows:
                payload_rows.append(
                    {
                        "index": len(payload_rows),
                        "pageIndex": region.page_index,
                        "y": cells[0].rect[1],
                        "cells": [_span_payload(cell) for cell in cells],
                    }
                )
        groups.append(
            {
                "id": group_id,
                "columnCount": int(signature[0]),
                "rowCount": len(payload_rows),
                "rows": payload_rows,
                "pageBounds": page_bounds,
            }
        )
    groups.sort(key=lambda group: (group["rows"][0]["pageIndex"], group["rows"][0]["y"], group["pageBounds"][0]["x"]))
    return groups, consumed


def _row_signature(row: list[_Span]) -> tuple[Any, ...]:
    return (
        len(row),
        tuple(round(span.rect[0] / 2.0) * 2 for span in row),
        tuple(round(span.font_size * 2.0) / 2.0 for span in row),
    )


def _table_groups(rows: list[list[_Span]]) -> tuple[list[dict[str, Any]], set[str]]:
    candidates: dict[tuple[Any, ...], list[list[_Span]]] = {}
    for row in rows:
        if len(row) < 2:
            continue
        candidates.setdefault(_row_signature(row), []).append(row)

    groups: list[dict[str, Any]] = []
    table_slot_ids: set[str] = set()
    for signature, candidate_rows in candidates.items():
        candidate_rows.sort(key=lambda row: (row[0].page_index, row[0].rect[1]))
        matching_runs: list[list[list[_Span]]] = []
        for row in candidate_rows:
            if not matching_runs:
                matching_runs.append([row])
                continue
            previous = matching_runs[-1][-1]
            font_size = float(median([span.font_size for span in previous + row]))
            maximum_gap = max(24.0, font_size * 2.6)
            if row[0].page_index == previous[0].page_index and row[0].rect[1] - previous[0].rect[1] <= maximum_gap:
                matching_runs[-1].append(row)
            else:
                matching_runs.append([row])
        for matching_rows in matching_runs:
            if len(matching_rows) < 2:
                continue
            identity = ":".join(
                [
                    str(signature[0]),
                    ",".join(str(value) for value in signature[1]),
                    ",".join(str(row[0].page_index) + "@" + f"{row[0].rect[1]:.2f}" for row in matching_rows),
                ]
            )
            group_id = "table-" + hashlib.sha256(identity.encode("utf-8")).hexdigest()[:16]
            payload_rows: list[dict[str, Any]] = []
            for row_index, row in enumerate(matching_rows):
                cells = [_span_payload(span) for span in row]
                table_slot_ids.update(str(cell["id"]) for cell in cells)
                payload_rows.append(
                    {
                        "index": row_index,
                        "pageIndex": row[0].page_index,
                        "y": row[0].rect[1],
                        "cells": cells,
                    }
                )
            groups.append(
                {
                    "id": group_id,
                    "columnCount": len(matching_rows[0]),
                    "rowCount": len(payload_rows),
                    "rows": payload_rows,
                }
            )
    groups.sort(key=lambda group: (
        group["rows"][0]["pageIndex"],
        group["rows"][0]["y"],
    ))
    return groups, table_slot_ids


def _render_pages(document: Any, target: Path, prefix: str) -> list[str]:
    target.mkdir(parents=True, exist_ok=True)
    paths: list[str] = []
    matrix = pymupdf.Matrix(2.0, 2.0)
    for page_index, page in enumerate(document):
        output = target / f"{prefix}-page-{page_index + 1}.png"
        page.get_pixmap(matrix=matrix, alpha=False).save(str(output))
        paths.append(str(output))
    return paths


def _validate_pair(template: Any, example: Any) -> None:
    if len(template) != len(example):
        raise ValueError("report_pair_page_count_mismatch")
    for page_index in range(len(template)):
        left = template[page_index]
        right = example[page_index]
        if (
            abs(float(left.rect.width) - float(right.rect.width)) > 0.5
            or abs(float(left.rect.height) - float(right.rect.height)) > 0.5
            or int(left.rotation) != int(right.rotation)
        ):
            raise ValueError(f"report_pair_page_geometry_mismatch:{page_index}")


def analyze_pdf_report_pair(
    template_path: Path,
    example_path: Path,
    artifact_root: Path,
) -> dict[str, Any]:
    if not template_path.is_file() or not example_path.is_file():
        raise ValueError("report_pair_file_not_found")
    template_hash = _sha256(template_path)
    example_hash = _sha256(example_path)
    pair_id = hashlib.sha256(f"{template_hash}:{example_hash}".encode("ascii")).hexdigest()
    target = artifact_root / "report-pairs" / pair_id[:2] / pair_id

    with pymupdf.open(template_path) as template, pymupdf.open(example_path) as example:
        _validate_pair(template, example)
        dynamic: list[_Span] = []
        template_spans_by_page: list[list[_Span]] = []
        pages: list[dict[str, Any]] = []
        for page_index in range(len(template)):
            template_spans = _page_spans(template[page_index], page_index)
            template_spans_by_page.append(template_spans)
            dynamic.extend(
                _dynamic_spans(
                    _page_spans(example[page_index], page_index),
                    template_spans,
                )
            )
            page = template[page_index]
            pages.append(
                {
                    "index": page_index,
                    "width": round(float(page.rect.width), 3),
                    "height": round(float(page.rect.height), 3),
                    "rotation": int(page.rotation),
                }
            )

        geometry_groups, consumed_dynamic_ids = _geometry_table_groups(template, template_spans_by_page, dynamic)
        remaining = [span for span in dynamic if _slot_id(span) not in consumed_dynamic_ids]
        fallback_groups, fallback_slot_ids = _table_groups(_rows(remaining))
        table_groups = sorted(
            [*geometry_groups, *fallback_groups],
            key=lambda group: (group["rows"][0]["pageIndex"], group["rows"][0]["y"]),
        )
        scalar_slots = [
            _span_payload(span)
            for span in remaining
            if _slot_id(span) not in fallback_slot_ids
        ]
        scalar_slots.sort(key=lambda slot: (slot["pageIndex"], slot["rect"]["y"], slot["rect"]["x"]))

        return {
            "schemaVersion": 1,
            "pairId": pair_id,
            "templateHash": template_hash,
            "exampleHash": example_hash,
            "pageCount": len(template),
            "pages": pages,
            "scalarSlots": scalar_slots,
            "tableGroups": table_groups,
            "templateImages": _render_pages(template, target, "template"),
            "exampleImages": _render_pages(example, target, "example"),
        }
