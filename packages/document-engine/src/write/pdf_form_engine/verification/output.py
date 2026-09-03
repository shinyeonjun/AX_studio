from __future__ import annotations

from pathlib import Path
from typing import Any, Mapping

from ..runtime import _pymupdf
from .geometry import _page_geometry_signature
from .native_values import _verify_native_values
from .overlay_values import _verify_overlay_values


def _verify_pymupdf_output(
    output_path: Path,
    template: Mapping[str, Any],
    values: Mapping[str, Any],
    *,
    page_count: int,
    page_geometry: list[tuple[float, float, int]],
    interactive: bool,
    source_path: Path,
) -> None:
    pdf = _pymupdf()
    document = pdf.open(str(output_path))
    source_document = None if interactive else pdf.open(str(source_path))
    try:
        if len(document) != page_count:
            raise ValueError("output_page_count_mismatch")
        actual_geometry = _page_geometry_signature(document)
        if len(actual_geometry) != len(page_geometry) or any(
            abs(actual[0] - expected[0]) > 0.01
            or abs(actual[1] - expected[1]) > 0.01
            or actual[2] != expected[2]
            for actual, expected in zip(actual_geometry, page_geometry)
        ):
            raise ValueError("output_page_geometry_mismatch")
        if interactive:
            _verify_native_values(document, template, values)
        else:
            _verify_overlay_values(document, template, values, source_document=source_document)
    finally:
        document.close()
        if source_document is not None:
            source_document.close()
