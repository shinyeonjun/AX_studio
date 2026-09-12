from __future__ import annotations

from pathlib import Path
from typing import Any, Mapping

from pypdf import PdfReader

from ...pdf_read import open_pdf
from .geometry import _page_geometry_signature
from .native_values import _verify_native_values
from .overlay_values import _verify_overlay_values


def _verify_pdf_output(output_path: Path, template: Mapping[str, Any], values: Mapping[str, Any],
                       *, page_count: int, page_geometry: list[tuple[float, float, int]],
                       interactive: bool, source_path: Path) -> None:
    reader = PdfReader(output_path)
    if len(reader.pages) != page_count:
        raise ValueError("output_page_count_mismatch")
    actual_geometry = _page_geometry_signature(reader)
    if len(actual_geometry) != len(page_geometry) or any(
        abs(actual[0] - expected[0]) > 0.01 or abs(actual[1] - expected[1]) > 0.01 or actual[2] != expected[2]
        for actual, expected in zip(actual_geometry, page_geometry)
    ):
        raise ValueError("output_page_geometry_mismatch")
    if interactive:
        _verify_native_values(reader, template, values)
    else:
        with open_pdf(output_path) as document, open_pdf(source_path) as source_document:
            _verify_overlay_values(document, template, values, source_document=source_document,
                                   page_geometry=page_geometry)
